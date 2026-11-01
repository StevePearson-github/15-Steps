import { describe, expect, it } from 'vitest';
import { type MeldSpec, buildMeld, extendMeld, meldsSatisfy, stepRequirements } from '../src/engine';
import { cards, ids, run, set } from './helpers';

const build = (spec: MeldSpec, tokens: string) => buildMeld(spec, cards(tokens), 1, 0);
const setSpec = (rank: number, tokens: string): MeldSpec => ({ kind: 'set', rank, cardIds: ids(tokens) });
const runSpec = (suit: 'S' | 'H' | 'D' | 'C', start: number, tokens: string): MeldSpec => ({
  kind: 'run', suit, start, cardIds: ids(tokens),
});

describe('sets', () => {
  it('accepts three of a rank, with duplicate suits from two decks', () => {
    expect(build(setSpec(7, '7S 7H 7H.2'), '7S 7H 7H.2').ok).toBe(true);
  });
  it('accepts sets longer than eight', () => {
    const t = '9S 9H 9D 9C 9S.2 9H.2 9D.2 9C.2 X X.2 2S';
    expect(build(setSpec(9, t), t).ok).toBe(true);
  });
  it('rejects fewer than three cards', () => {
    expect(build(setSpec(7, '7S 7H'), '7S 7H').ok).toBe(false);
  });
  it('rejects mixed ranks', () => {
    expect(build(setSpec(7, '7S 7H 8D'), '7S 7H 8D').ok).toBe(false);
  });
  it('accepts jokers and 2s as wilds', () => {
    expect(build(setSpec(7, '7S X 2H'), '7S X 2H').ok).toBe(true);
  });
  it('accepts three wilds as a set', () => {
    expect(build(setSpec(9, 'X X.2 2S'), 'X X.2 2S').ok).toBe(true);
  });
  it('accepts a 2 played as itself', () => {
    expect(build(setSpec(2, '2S 2H 2D'), '2S 2H 2D').ok).toBe(true);
  });
  it('rejects a natural card of the wrong rank in a set of 2s', () => {
    expect(build(setSpec(2, '2S 2H 3D'), '2S 2H 3D').ok).toBe(false);
  });
});

describe('pairs', () => {
  it('is exactly two cards of one rank', () => {
    expect(build({ kind: 'pair', rank: 9, cardIds: ids('9S 9H') }, '9S 9H').ok).toBe(true);
    expect(build({ kind: 'pair', rank: 9, cardIds: ids('9S 9H 9D') }, '9S 9H 9D').ok).toBe(false);
    expect(build({ kind: 'pair', rank: 9, cardIds: ids('9S 8H') }, '9S 8H').ok).toBe(false);
  });
  it('becomes a set when a card is added, then keeps growing', () => {
    const pair = set(1, 0, 5, '5S 5H');
    const three = extendMeld(pair, cards('5D'));
    expect(three.ok && three.value.kind).toBe('set');
    const four = extendMeld((three as { ok: true; value: typeof pair }).value, cards('X'));
    expect(four.ok && four.value.cards).toHaveLength(4);
  });
});

describe('runs', () => {
  it('accepts consecutive cards of one suit', () => {
    expect(build(runSpec('H', 5, '5H 6H 7H'), '5H 6H 7H').ok).toBe(true);
  });
  it('rejects mixed suits', () => {
    expect(build(runSpec('H', 5, '5H 6S 7H'), '5H 6S 7H').ok).toBe(false);
  });
  it('rejects gaps', () => {
    expect(build(runSpec('H', 5, '5H 6H 8H'), '5H 6H 8H').ok).toBe(false);
  });
  it('accepts ace low (A-2-3) and ace high (Q-K-A)', () => {
    expect(build(runSpec('S', 1, 'AS 2S 3S'), 'AS 2S 3S').ok).toBe(true);
    expect(build(runSpec('S', 12, 'QS KS AS'), 'QS KS AS').ok).toBe(true);
  });
  it('rejects wrap-around (K-A-2)', () => {
    expect(build(runSpec('S', 13, 'KS AS 2S'), 'KS AS 2S').ok).toBe(false);
    expect(build(runSpec('S', 14, 'KS AS 2S'), 'KS AS 2S').ok).toBe(false);
  });
  it('rejects an ace-low start used with high placement mismatch', () => {
    expect(build(runSpec('S', 2, 'AS 2S 3S'), 'AS 2S 3S').ok).toBe(false);
  });
  it('lets wilds fill gaps in any suit', () => {
    expect(build(runSpec('H', 5, '5H X 7H'), '5H X 7H').ok).toBe(true);
    expect(build(runSpec('H', 5, '5H 2S 7H'), '5H 2S 7H').ok).toBe(true);
  });
  it('accepts a natural 2 in its place', () => {
    expect(build(runSpec('H', 1, 'AH 2H 3H'), 'AH 2H 3H').ok).toBe(true);
  });
  it('accepts a run made only of wilds when a suit is declared', () => {
    expect(build(runSpec('D', 4, 'X X.2 2S'), 'X X.2 2S').ok).toBe(true);
  });
  it('rejects runs shorter than three or past the ace', () => {
    expect(build(runSpec('H', 5, '5H 6H'), '5H 6H').ok).toBe(false);
    expect(build(runSpec('H', 13, 'KH AH X'), 'KH AH X').ok).toBe(false);
  });
});

describe('extending runs', () => {
  const base = () => run(1, 0, 'H', 5, '5H X 7H'); // X stands for the 6
  it('extends at the high end', () => {
    const r = extendMeld(base(), cards('8H 9H TH'), 'high');
    expect(r.ok && r.value.kind === 'run' && r.value.cards).toHaveLength(6);
  });
  it('extends at the low end', () => {
    const r = extendMeld(base(), cards('4H 3H'), 'low');
    expect(r.ok && r.value.kind === 'run' && r.value.start).toBe(3);
  });
  it('keeps the wild fixed as 6', () => {
    const r = extendMeld(base(), cards('8H'), 'high');
    expect(r.ok && r.value.kind === 'run' && r.value.cards[1]?.id).toBe('X.1');
  });
  it('rejects the wrong suit or rank', () => {
    expect(extendMeld(base(), cards('8S'), 'high').ok).toBe(false);
    expect(extendMeld(base(), cards('9H'), 'high').ok).toBe(false);
  });
  it('requires a side and respects the ace limits', () => {
    expect(extendMeld(base(), cards('8H')).ok).toBe(false);
    expect(extendMeld(run(1, 0, 'S', 1, 'AS 2S 3S'), cards('KS'), 'low').ok).toBe(false);
    expect(extendMeld(run(1, 0, 'S', 12, 'QS KS AS'), cards('2S'), 'high').ok).toBe(false);
  });
  it('can extend a high run with an ace and a low run with an ace', () => {
    expect(extendMeld(run(1, 0, 'S', 11, 'JS QS KS'), cards('AS'), 'high').ok).toBe(true);
    expect(extendMeld(run(1, 0, 'S', 2, '2S 3S 4S'), cards('AS'), 'low').ok).toBe(true);
  });
});

describe('base requirements', () => {
  const m = (tokens: string, rank = 7) => set(1, 0, rank, tokens);
  it('matches step 1: two sets of three', () => {
    expect(meldsSatisfy([m('7S 7H 7D'), m('8S 8H 8D', 8)], stepRequirements(1))).toBe(true);
  });
  it('allows larger melds than required', () => {
    expect(meldsSatisfy([m('7S 7H 7D 7C'), m('8S 8H 8D', 8)], stepRequirements(1))).toBe(true);
  });
  it('rejects the wrong number or kind of melds', () => {
    expect(meldsSatisfy([m('7S 7H 7D')], stepRequirements(1))).toBe(false);
    expect(meldsSatisfy([m('7S 7H 7D'), run(2, 0, 'H', 5, '5H 6H 7H')], stepRequirements(1))).toBe(false);
  });
  it('matches set-of-four + run-of-three regardless of order', () => {
    const ms = [run(2, 0, 'H', 5, '5H 6H 7H'), m('7S 7H 7D 7C')];
    expect(meldsSatisfy(ms, stepRequirements(7))).toBe(true);
  });
  it('does not let a short meld fill a long requirement', () => {
    const ms = [m('7S 7H 7D'), m('8S 8H 8D', 8)];
    expect(meldsSatisfy(ms, stepRequirements(10))).toBe(false);
  });
});
