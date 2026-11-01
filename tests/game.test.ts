import { describe, expect, it } from 'vitest';
import { type Action, type GameState, applyAction, createGame, simpleLegalActions } from '../src/engine';
import { ids, run, scenario, set } from './helpers';

function must(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.state;
}
function rejected(state: GameState, action: Action): string {
  const r = applyAction(state, action);
  if (r.ok) throw new Error('Expected rejection');
  return r.error;
}
const total = (g: GameState) =>
  g.stock.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0) +
  g.melds.reduce((n, m) => n + m.cards.length, 0);

describe('setup', () => {
  const g = createGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 7, dealer: 2 });
  it('deals 13 cards each and turns up one discard', () => {
    expect(g.players.every((p) => p.hand.length === 13)).toBe(true);
    expect(g.discard).toHaveLength(1);
    expect(total(g)).toBe(108);
  });
  it('starts everyone on step 1 with no score', () => {
    expect(g.players.every((p) => p.step === 1 && p.score === 0 && !p.baseLaid)).toBe(true);
  });
  it('starts with the player to the left of the dealer, in the draw phase', () => {
    expect(g.current).toBe(3);
    expect(g.phase).toBe('draw');
  });
  it('supports 2 to 6 players only', () => {
    expect(() => createGame({ playerNames: ['A'], seed: 1 })).toThrow();
    expect(() => createGame({ playerNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], seed: 1 })).toThrow();
    expect(createGame({ playerNames: ['A', 'B', 'C', 'D', 'E', 'F'], seed: 1 }).players).toHaveLength(6);
  });
  it('is deterministic for a seed', () => {
    const a = createGame({ playerNames: ['A', 'B'], seed: 5 });
    const b = createGame({ playerNames: ['A', 'B'], seed: 5 });
    expect(a).toEqual(b);
  });
});

describe('turn flow', () => {
  it('draw from stock, then discard, passes the turn clockwise', () => {
    const g0 = scenario({ hands: ['3S 4S', '5H 6H', '7D 8D'] });
    const g1 = must(g0, { type: 'drawStock' });
    expect(g1.players[0]?.hand).toHaveLength(3);
    expect(g1.phase).toBe('play');
    const g2 = must(g1, { type: 'discard', cardId: '3S.1' });
    expect(g2.current).toBe(1);
    expect(g2.phase).toBe('draw');
    expect(g2.discard.at(-1)?.id).toBe('3S.1');
  });
  it('can take the top of the discard pile', () => {
    const g1 = must(scenario({ hands: ['3S 4S', '5H 6H'], discard: 'KD' }), { type: 'drawDiscard' });
    expect(g1.players[0]?.hand.map((c) => c.id)).toContain('KD.1');
    expect(g1.discard).toHaveLength(0);
  });
  it('only allows one draw, and no discard before drawing', () => {
    const g0 = scenario({ hands: ['3S 4S', '5H 6H'] });
    expect(rejected(g0, { type: 'discard', cardId: '3S.1' })).toMatch(/draw/i);
    expect(rejected(must(g0, { type: 'drawStock' }), { type: 'drawStock' })).toMatch(/already drawn/i);
  });
  it('rejects discarding a card you do not hold', () => {
    const g1 = must(scenario({ hands: ['3S 4S', '5H 6H'] }), { type: 'drawStock' });
    expect(rejected(g1, { type: 'discard', cardId: 'KD.1' })).toMatch(/hold/i);
  });
  it('does not mutate the previous state', () => {
    const g0 = scenario({ hands: ['3S 4S', '5H 6H'] });
    const snapshot = JSON.stringify(g0);
    must(g0, { type: 'drawStock' });
    expect(JSON.stringify(g0)).toBe(snapshot);
  });
  it('reshuffles the discard pile into the stock, keeping the top card', () => {
    const g0 = scenario({ hands: ['3S 4S', '5H 6H'], stock: '', discard: '7C 8C 9C TC' });
    const r = applyAction(g0, { type: 'drawStock' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.some((e) => e.type === 'stockReshuffled')).toBe(true);
    expect(r.state.discard.map((c) => c.id)).toEqual(['TC.1']);
    expect(r.state.stock).toHaveLength(2);
    expect(r.state.players[0]?.hand).toHaveLength(3);
  });
  it('rejects drawing from an empty stock when nothing can be reshuffled', () => {
    const g0 = scenario({ hands: ['3S 4S', '5H 6H'], stock: '', discard: 'TC' });
    expect(rejected(g0, { type: 'drawStock' })).toMatch(/empty/i);
    expect(simpleLegalActions(g0)).toEqual([{ type: 'drawDiscard' }]);
  });
});

describe('laying down the base', () => {
  const step1Hand = '7S 7H 7D 8S 8H 8D 4C 5C 9C JD KD QH AH 3S';
  const base = (): Action => ({
    type: 'layBase',
    melds: [
      { kind: 'set', rank: 7, cardIds: ids('7S 7H 7D') },
      { kind: 'set', rank: 8, cardIds: ids('8S 8H 8D') },
    ],
  });
  const playing = (extra: Partial<Parameters<typeof scenario>[0]> = {}) =>
    scenario({ hands: [step1Hand, '5H 6H'], phase: 'play', ...extra });

  it('lays down two sets of three for step 1 and flags the player', () => {
    const g = must(playing(), base());
    expect(g.players[0]?.baseLaid).toBe(true);
    expect(g.players[0]?.hand).toHaveLength(8);
    expect(g.melds).toHaveLength(2);
    expect(g.melds.every((m) => m.owner === 0)).toBe(true);
  });
  it('rejects melds that are not the step requirement', () => {
    const bad: Action = { type: 'layBase', melds: [{ kind: 'set', rank: 7, cardIds: ids('7S 7H 7D') }] };
    expect(rejected(playing(), bad)).toMatch(/Step 1/);
  });
  it('rejects cards the player does not hold', () => {
    const bad: Action = {
      type: 'layBase',
      melds: [
        { kind: 'set', rank: 7, cardIds: ids('7S 7H 7C') },
        { kind: 'set', rank: 8, cardIds: ids('8S 8H 8D') },
      ],
    };
    expect(rejected(playing(), bad)).toMatch(/hold/i);
  });
  it('rejects the same card used twice', () => {
    const bad: Action = {
      type: 'layBase',
      melds: [
        { kind: 'set', rank: 7, cardIds: ids('7S 7H 7D') },
        { kind: 'set', rank: 7, cardIds: ids('7S 7H 7D') },
      ],
    };
    expect(rejected(playing(), bad)).toMatch(/hold/i);
  });
  it('cannot lay a base twice', () => {
    expect(rejected(must(playing(), base()), base())).toMatch(/already/i);
  });
  it('cannot lay a base before drawing', () => {
    expect(rejected(playing({ phase: 'draw' }), base())).toMatch(/draw/i);
  });
  it('must keep a card to discard', () => {
    const g = scenario({ hands: ['7S 7H 7D 8S 8H 8D', '5H'], phase: 'play' });
    expect(rejected(g, base())).toMatch(/keep a card/i);
  });
  it('step 4 takes five pairs, any ranks, and a set of four counts as two pairs', () => {
    const g = scenario({
      hands: ['9S 9H 9D 9C 5S 5H TS TH 2S 2H 4C', '5H'],
      steps: [4], phase: 'play',
    });
    const pair = (rank: number, t: string) => ({ kind: 'pair' as const, rank, cardIds: ids(t) });
    const next = must(g, {
      type: 'layBase',
      melds: [pair(9, '9S 9H'), pair(9, '9D 9C'), pair(5, '5S 5H'), pair(10, 'TS TH'), pair(2, '2S 2H')],
    });
    expect(next.melds).toHaveLength(5);
  });
});

describe('extra melds and building', () => {
  it('cannot lay extra melds or build before the base', () => {
    const g = scenario({ hands: ['4S 4H 4D 9S', '5H'], phase: 'play', melds: [set(1, 1, 7, '7S 7H 7D')] });
    expect(rejected(g, { type: 'layMeld', meld: { kind: 'set', rank: 4, cardIds: ids('4S 4H 4D') } })).toMatch(/base/i);
    expect(rejected(g, { type: 'build', meldId: 1, cardIds: ids('9S') })).toMatch(/base/i);
  });
  it('lays down extra sets and runs after the base, in the same turn', () => {
    const g = scenario({
      hands: ['7S 7H 7D 8S 8H 8D 4S 4H 4D 5C 6C 7C 9S 3D', '5H'], phase: 'play',
    });
    const g1 = must(g, {
      type: 'layBase',
      melds: [
        { kind: 'set', rank: 7, cardIds: ids('7S 7H 7D') },
        { kind: 'set', rank: 8, cardIds: ids('8S 8H 8D') },
      ],
    });
    const g2 = must(g1, { type: 'layMeld', meld: { kind: 'set', rank: 4, cardIds: ids('4S 4H 4D') } });
    const g3 = must(g2, { type: 'layMeld', meld: { kind: 'run', suit: 'C', start: 5, cardIds: ids('5C 6C 7C') } });
    expect(g3.melds).toHaveLength(4);
    expect(g3.players[0]?.hand).toHaveLength(2);
  });
  it('does not allow extra pairs', () => {
    const g = scenario({ hands: ['9S 9H 3D 4D', '5H'], phase: 'play', baseLaid: [true] });
    expect(rejected(g, { type: 'layMeld', meld: { kind: 'pair', rank: 9, cardIds: ids('9S 9H') } })).toMatch(/sets or runs/i);
  });
  it("builds on another player's set and run", () => {
    const g = scenario({
      hands: ['3S 8H 9H 4D', '5H 6H'], phase: 'play', baseLaid: [true],
      melds: [set(1, 1, 3, '3C 3D 3C.2'), run(2, 1, 'H', 5, '5H 6H 7H')],
    });
    const g1 = must(g, { type: 'build', meldId: 1, cardIds: ids('3S') });
    expect(g1.melds[0]?.cards).toHaveLength(4);
    const g2 = must(g1, { type: 'build', meldId: 2, cardIds: ids('8H 9H'), side: 'high' });
    expect(g2.melds[1]?.cards).toHaveLength(5);
    expect(g2.players[0]?.hand).toHaveLength(1);
  });
  it('a player on step 1 can build on a step 4 pairs meld', () => {
    const g = scenario({
      hands: ['5S 9D 3C', '5H 6H'], phase: 'play', baseLaid: [true, true], steps: [1, 4],
      melds: [set(1, 1, 5, '5H 5D')],
    });
    const g1 = must(g, { type: 'build', meldId: 1, cardIds: ids('5S') });
    expect(g1.melds[0]?.kind).toBe('set');
  });
  it('rejects building a card that does not fit, and unknown melds', () => {
    const g = scenario({ hands: ['4S 9D 3C', '5H 6H'], phase: 'play', baseLaid: [true], melds: [set(1, 1, 5, '5H 5D 5C')] });
    expect(rejected(g, { type: 'build', meldId: 1, cardIds: ids('4S') })).toMatch(/match/i);
    expect(rejected(g, { type: 'build', meldId: 99, cardIds: ids('4S') })).toMatch(/no such meld/i);
  });
  it('cannot build away the last card', () => {
    const g = scenario({ hands: ['5S', '5H'], phase: 'play', baseLaid: [true], melds: [set(1, 1, 5, '5H 5D 5C')] });
    expect(rejected(g, { type: 'build', meldId: 1, cardIds: ids('5S') })).toMatch(/keep a card/i);
  });
});

describe('going out and scoring', () => {
  const out = (opts: Parameters<typeof scenario>[0]) =>
    must(scenario({ phase: 'play', ...opts }), { type: 'discard', cardId: ids(opts.hands[0] ?? '')[0] ?? '' });

  it('ends the round when a player discards their last card', () => {
    const g = out({ hands: ['3S', '5H 6H'], baseLaid: [true, false] });
    expect(g.phase).toBe('roundOver');
    expect(g.lastRound?.wentOut).toBe(0);
  });
  it('charges others for cards left in hand; the player going out takes nothing', () => {
    const g = out({ hands: ['3S', 'X 2S AH KD 5C', '9D'], baseLaid: [true, false, false] });
    expect(g.players.map((p) => p.score)).toEqual([0, 50 + 20 + 15 + 10 + 5, 5]);
  });
  it('scores accumulate across rounds', () => {
    const g = out({ hands: ['3S', '5H'], scores: [10, 7], baseLaid: [true, false] });
    expect(g.players.map((p) => p.score)).toEqual([10, 12]);
  });
  it('advances players who laid their base; others repeat their step', () => {
    const g = out({ hands: ['3S', '5H', '6H'], steps: [1, 1, 3], baseLaid: [true, true, false] });
    expect(g.players.map((p) => p.step)).toEqual([2, 2, 3]);
  });
  it('the next round deals again, rotates the dealer and resets bases', () => {
    const g = must(out({ hands: ['3S', '5H'], baseLaid: [true, true], current: 0 }), { type: 'nextRound' });
    expect(g.round).toBe(2);
    expect(g.phase).toBe('draw');
    expect(g.players.every((p) => p.hand.length === 13 && !p.baseLaid)).toBe(true);
    expect(g.players.map((p) => p.step)).toEqual([2, 2]);
    expect(g.dealer).toBe(1);
    expect(g.current).toBe(0);
    expect(total(g)).toBe(108);
  });
  it('rejects actions while waiting for the next round', () => {
    const g = out({ hands: ['3S', '5H'], baseLaid: [true, false] });
    expect(rejected(g, { type: 'drawStock' })).toMatch(/over/i);
    expect(rejected(scenario({ hands: ['3S', '5H'] }), { type: 'nextRound' })).toMatch(/not over/i);
  });
});

describe('winning', () => {
  const finalRound = (scores: number[], steps = [15, 15], baseLaid = [true, false]) => {
    const g = scenario({ hands: ['3S', '9H'], steps, scores, baseLaid, phase: 'play' });
    return must(g, { type: 'discard', cardId: '3S.1' });
  };
  it('ends the game when a player goes out on step 15 with the lowest score', () => {
    const g = finalRound([10, 0]);
    expect(g.players.map((p) => p.score)).toEqual([10, 5]);
    // goer has 10, other has 5 -> goer is not lowest, so play continues
    expect(g.phase).toBe('roundOver');
    const win = finalRound([0, 0]);
    expect(win.phase).toBe('gameOver');
    expect(win.winner).toBe(0);
  });
  it('continues (repeating step 15) when the player who went out does not have the lowest score', () => {
    const g = finalRound([40, 0]);
    expect(g.phase).toBe('roundOver');
    expect(g.players.map((p) => p.step)).toEqual([15, 15]);
  });
  it('a tie for lowest does not end the game', () => {
    const g = scenario({ hands: ['3S', '9H', '4D'], steps: [15, 15, 15], scores: [5, 0, 5], baseLaid: [true, false, false], phase: 'play' });
    const done = must(g, { type: 'discard', cardId: '3S.1' });
    // scores: goer 5, p1 5, p2 10 -> goer ties p1
    expect(done.players.map((p) => p.score)).toEqual([5, 5, 10]);
    expect(done.phase).toBe('roundOver');
  });
  it('going out earlier than step 15 never ends the game', () => {
    const g = finalRound([0, 100], [14, 14]);
    expect(g.phase).toBe('roundOver');
    expect(g.players.map((p) => p.step)).toEqual([15, 14]);
  });
  it('step 15 is the last step: nobody advances past it', () => {
    expect(finalRound([40, 0]).players.every((p) => p.step <= 15)).toBe(true);
  });
  it('no actions are allowed after the game is over', () => {
    expect(rejected(finalRound([0, 0]), { type: 'nextRound' })).toMatch(/over/i);
  });
});

describe('events', () => {
  it('reports what happened, for sound and animation', () => {
    const r = applyAction(scenario({ hands: ['3S 4S', '5H'] }), { type: 'drawStock' });
    expect(r.ok && r.events).toEqual([{ type: 'cardDrawn', player: 0, from: 'stock' }]);
  });
  it('a run laid down is also reported', () => {
    const g = scenario({ hands: ['5C 6C 7C 3S', '5H'], phase: 'play', baseLaid: [true] });
    const r = applyAction(g, { type: 'layMeld', meld: { kind: 'run', suit: 'C', start: 5, cardIds: ids('5C 6C 7C') } });
    expect(r.ok && r.events[0]?.type).toBe('meldLaid');
  });
});
