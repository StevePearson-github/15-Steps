import { describe, expect, it } from 'vitest';
import {
  type Session, aiStep, apply, cardLabel, createSession, describeSpec, describeStep, deserializeSession,
  DEFAULT_SETUP, SETUP_PREFS_KEY, loadUiOptions, saveUiOptions, sanitizeUiOptions, loadSetupPrefs, saveSetupPrefs, sanitizeSetup, SORTERS, moveCards, verb, arrangeHand, baseFromSelection, canUndo, dropIndex, stepKinds, undo, humanSeat, makePlayers, meldOptions, moveCard, orderForBuild, serializeSession,
  sortHand, sortHandByRank, sortHandByRuns, sortHandBySets, sortHandSmart, stagedMeetBase,
} from '../src/ui/controller';
import type { Card, MeldSpec } from '../src/engine';
import { cards, ids, run, scenario, set } from './helpers';

const newSession = (seed = 4): Session =>
  createSession({ name: 'Sam', opponents: ['hard', 'easy'], seed });

describe('sessions', () => {
  it('seats the human first, then the computers', () => {
    const s = newSession();
    expect(s.seats.map((x) => x.kind)).toEqual(['human', 'hard', 'easy']);
    expect(s.seats[0]?.name).toBe('Sam');
    expect(humanSeat(s)).toBe(0);
    expect(s.state.players).toHaveLength(3);
  });
  it('can be all computers (spectate)', () => {
    const s = createSession({ name: '', opponents: ['hard', 'medium'], seed: 1, spectate: true });
    expect(humanSeat(s)).toBe(-1);
    expect(s.seats).toHaveLength(2);
  });
  it('defaults an empty name', () => {
    expect(createSession({ name: '  ', opponents: ['easy'], seed: 1 }).seats[0]?.name).toBe('You');
  });
  it('computers play until it is the human’s turn', () => {
    let s = newSession();
    const players = makePlayers(s.seats, 4);
    for (let i = 0; i < 200 && s.seats[s.state.current]?.kind !== 'human'; i++) {
      s = aiStep(s, players) ?? s;
    }
    expect(s.seats[s.state.current]?.kind).toBe('human');
    expect(s.log.length).toBeGreaterThan(1);
  });
  it('aiStep does nothing on a human seat', () => {
    const s = newSession();
    const human = { ...s, state: { ...s.state, current: 0 } };
    expect(aiStep(human, makePlayers(s.seats, 4))).toBeNull();
  });
  it('apply reports engine errors and logs events', () => {
    let s = newSession();
    s = { ...s, state: { ...s.state, current: 0 } };
    const bad = apply(s, { type: 'discard', cardId: 'nope' });
    expect(bad.ok).toBe(false);
    const good = apply(s, { type: 'drawStock' });
    // the human is told which card they drew
    const drawn = good.ok ? good.session.state.players[0]?.hand.at(-1) : undefined;
    expect(drawn).toBeTruthy();
    expect(good.ok && good.session.log.at(-1)).toBe(`Sam drew ${cardLabel(drawn as Card)} from the stock.`);
  });
  it('a computer’s draw from the stock does not name the card, but a draw from the discard does', () => {
    const s = newSession();
    const ai = { ...s, state: { ...s.state, current: 1, phase: 'draw' as const } };
    const fromStock = apply(ai, { type: 'drawStock' });
    expect(fromStock.ok && fromStock.session.log.at(-1)).toBe('Ada drew a card from the stock.');
    const top = ai.state.discard.at(-1) as Card;
    const fromDiscard = apply(ai, { type: 'drawDiscard' });
    expect(fromDiscard.ok && fromDiscard.session.log.at(-1)).toBe(`Ada drew ${cardLabel(top)} from the discard pile.`);
  });
  it('keeps the log short', () => {
    let s = newSession();
    const players = makePlayers(s.seats, 1);
    for (let i = 0; i < 100; i++) s = aiStep(s, players) ?? s;
    expect(s.log.length).toBeLessThanOrEqual(8);
  });
  it('round-trips a save', () => {
    const s = newSession();
    expect(deserializeSession(serializeSession(s))).toEqual(s);
    expect(deserializeSession('not json')).toBeNull();
    expect(deserializeSession('{"format":"x"}')).toBeNull();
  });
});

describe('describing things', () => {
  it.each([
    [1, 'two sets of 3'],
    [2, 'one set of 3 + one run of 3'],
    [4, 'five pairs'],
    [8, 'two runs of 4'],
    [9, 'two runs of 3 + one set of 3'],
    [15, 'one run of 10'],
  ])('step %i', (step, text) => expect(describeStep(step)).toBe(text));
  it('describes melds', () => {
    expect(describeSpec({ kind: 'set', rank: 7, cardIds: ['a', 'b', 'c'] })).toBe('Set of 3: 7s');
    expect(describeSpec({ kind: 'pair', rank: 13, cardIds: ['a', 'b'] })).toBe('Pair: Ks');
    expect(describeSpec({ kind: 'run', suit: 'H', start: 5, cardIds: ['a', 'b', 'c'] })).toBe('Run of 3: 5–7 ♥');
    expect(describeSpec({ kind: 'run', suit: 'S', start: 12, cardIds: ['a', 'b', 'c'] })).toBe('Run of 3: Q–A ♠');
  });
});

describe('selecting cards', () => {
  it('offers sets and runs for a selection; pairs only when allowed', () => {
    expect(meldOptions(cards('7S 7H 7D'), false).map((m) => m.kind)).toEqual(['set']);
    expect(meldOptions(cards('5H 6H 7H'), false).map((m) => m.kind)).toEqual(['run']);
    expect(meldOptions(cards('9S 9H'), true).map((m) => m.kind)).toEqual(['pair']);
    expect(meldOptions(cards('9S 9H'), false)).toEqual([]);
    expect(meldOptions(cards('5H 9S 7C'), true)).toEqual([]);
  });
  it('is ambiguous only when it truly is', () => {
    expect(meldOptions(cards('5H X 7H'), false)).toHaveLength(1);
    expect(meldOptions(cards('X X.2 2S'), false).length).toBeGreaterThan(1);
  });
  it('checks staged melds against the step', () => {
    const hand = cards('7S 7H 7D 8S 8H 8D 4C');
    const spec = (rank: number, t: string): MeldSpec => ({ kind: 'set', rank, cardIds: ids(t) });
    expect(stagedMeetBase([spec(7, '7S 7H 7D'), spec(8, '8S 8H 8D')], hand, 1)).toBe(true);
    expect(stagedMeetBase([spec(7, '7S 7H 7D')], hand, 1)).toBe(false);
    expect(stagedMeetBase([spec(7, '7S 7H 7D'), spec(8, '8S 8H 8D')], hand, 5)).toBe(false);
    expect(stagedMeetBase([spec(7, '7S 7H 7D'), spec(9, '9S 9H 9D')], hand, 1)).toBe(false);
  });
  it('orders cards to extend a run, whatever order they were picked in', () => {
    const meld = run(1, 0, 'H', 5, '5H 6H 7H');
    expect(orderForBuild(meld, cards('9H 8H'), 'high')?.map((c) => c.id)).toEqual(['8H.1', '9H.1']);
    expect(orderForBuild(meld, cards('3H 4H'), 'low')?.map((c) => c.id)).toEqual(['4H.1', '3H.1']);
    expect(orderForBuild(meld, cards('X 8H'), 'high')?.map((c) => c.id)).toEqual(['8H.1', 'X.1']);
    expect(orderForBuild(meld, cards('9H'), 'high')).toBeNull();
    expect(orderForBuild(meld, cards('8H'))).toBeNull();
    const s = set(2, 0, 7, '7S 7H 7D');
    expect(orderForBuild(s, cards('7C'))).toHaveLength(1);
  });
  it('sorts a hand by suit and rank with wilds at the end', () => {
    const sorted = sortHand(cards('KH X 3S 2C AS 9H')).map((c) => c.id);
    expect(sorted).toEqual(['3S.1', 'AS.1', '9H.1', 'KH.1', '2C.1', 'X.1']); // the ace is high
  });
});

describe('arranging your hand', () => {
  const idsOf = (cs: { id: string }[]) => cs.map((c) => c.id);
  it('sorts by suit, or by rank', () => {
    expect(idsOf(sortHandByRank(cards('KH 3S X 9H 3D 2C')))).toEqual(['3S.1', '3D.1', '9H.1', 'KH.1', '2C.1', 'X.1']);
  });
  it('sorts when you have not arranged anything yet', () => {
    expect(idsOf(arrangeHand(cards('KH 3S'), []))).toEqual(['3S.1', 'KH.1']);
  });
  it('keeps your order, puts new cards on the end, and forgets cards you no longer hold', () => {
    const order = ['KH.1', '3S.1', '9D.1'];
    expect(idsOf(arrangeHand(cards('3S KH 5C'), order))).toEqual(['KH.1', '3S.1', '5C.1']);
  });
  it('starts fresh (sorted) when none of your old cards remain', () => {
    expect(idsOf(arrangeHand(cards('KH 3S'), ['9D.1']))).toEqual(['3S.1', 'KH.1']);
  });
  it('moves a card to an insertion point', () => {
    const ids5 = ['a', 'b', 'c', 'd', 'e'];
    expect(moveCard(ids5, 'a', 3)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(moveCard(ids5, 'e', 0)).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(moveCard(ids5, 'c', 5)).toEqual(['a', 'b', 'd', 'e', 'c']);
    expect(moveCard(ids5, 'c', 2)).toEqual(ids5);
    expect(moveCard(ids5, 'c', 3)).toEqual(ids5);
    expect(moveCard(ids5, 'zz', 1)).toEqual(ids5);
  });
  it('finds the drop point from the pointer, across wrapped rows', () => {
    const row = (top: number) => [0, 1, 2].map((i) => ({ left: i * 70, top, width: 60, height: 80 }));
    const boxes = [...row(0), ...row(100)]; // 3 cards per row, 2 rows
    expect(dropIndex(boxes, 5, 40)).toBe(0); // left half of the first card
    expect(dropIndex(boxes, 50, 40)).toBe(1); // right half of the first card
    expect(dropIndex(boxes, 150, 40)).toBe(2); // just before the third card
    expect(dropIndex(boxes, 300, 40)).toBe(3); // past the end of row one
    expect(dropIndex(boxes, 80, 140)).toBe(4); // left half of the second card on row two
    expect(dropIndex(boxes, 999, 140)).toBe(6); // far right, bottom row: the very end
    expect(dropIndex([], 5, 5)).toBe(0);
  });
});

describe('sorting by sets and runs', () => {
  const idsOf = (cs: { id: string }[]) => cs.map((c) => c.id.split('.')[0]);
  it('sets: matching ranks together, biggest groups first, wilds last', () => {
    const sorted = idsOf(sortHandBySets(cards('9S KH 5D 9H X 5C 9D 9C 2S 5S 7C')));
    expect(sorted).toEqual(['9S', '9H', '9D', '9C', '5S', '5D', '5C', '7C', 'KH', '2S', 'X']);
  });
  it('sets: equal-sized groups go low to high', () => {
    expect(idsOf(sortHandBySets(cards('KH 4S KD 4D 8C 8S')))).toEqual(['4S', '4D', '8S', '8C', 'KH', 'KD']);
  });
  it('smart: the base first, then extra melds, then leftovers for the discard', () => {
    const sorted = idsOf(sortHandSmart(cards('3C KH 5S 9C 7D 5H KS 9D JH 5D 9S KC'), 1, false));
    const rankOf = (c?: string) => (c ?? '').slice(0, -1);
    // three sets in the hand: two make the base, the third is an extra meld, all of them whole
    for (const g of [sorted.slice(0, 3), sorted.slice(3, 6), sorted.slice(6, 9)]) expect(new Set(g.map(rankOf)).size).toBe(1);
    expect(new Set(sorted.slice(0, 9).map(rankOf))).toEqual(new Set(['5', '9', 'K']));
    expect(sorted.slice(9)).toEqual(['JH', '7D', '3C']); // what is left to discard, in suit order
  });
  it('smart: a base the hand cannot complete is built as far as it goes, wilds filling gaps', () => {
    const sorted = idsOf(sortHandSmart(cards('KH 5S 9C 5H 3C 9D 4D X'), 1, false));
    expect(sorted.slice(0, 5).sort()).toEqual(['5H', '5S', '9C', '9D', 'X']);
    expect(sorted.slice(5)).toEqual(['KH', '4D', '3C']); // leftovers in suit order
  });
  it('smart: once the base is down, the hand is just extra melds then leftovers', () => {
    const sorted = idsOf(sortHandSmart(cards('3C 5S 9D 5H 5D 8C 9C 9H'), 1, true));
    expect(sorted.slice(6)).toEqual(['3C', '8C']);
  });
  it('smart: keeps every card exactly once', () => {
    const hand = cards('3C KH 5S 9C 7D 5H KS 9D JH 5D 9S KC X 2H');
    const sorted = sortHandSmart(hand, 3, false);
    expect(sorted.map((c) => c.id).sort()).toEqual(hand.map((c) => c.id).sort());
  });
  it('runs: consecutive cards of one suit are lined up, longest first', () => {
    const sorted = idsOf(sortHandByRuns(cards('5H 9S 6H 7H 3S 4S 8H KC 5S X')));
    // 3-4-5S, 5-6-7-8H (longest first), then 9S, KC loose, then the joker
    expect(sorted).toEqual(['5H', '6H', '7H', '8H', '3S', '4S', '5S', '9S', 'KC', 'X']);
  });
  it('runs: an ace follows a king, and two-card chains come after runs', () => {
    const sorted = idsOf(sortHandByRuns(cards('QS KS AS 9H TH 4C')));
    expect(sorted).toEqual(['QS', 'KS', 'AS', '9H', 'TH', '4C']);
  });
  it('runs: duplicate cards from the two decks start a second chain', () => {
    const sorted = sortHandByRuns(cards('5H 6H 7H 5H.2 6H.2 7H.2')).map((c) => c.id);
    expect(sorted).toEqual(['5H.1', '6H.1', '7H.1', '5H.2', '6H.2', '7H.2']);
  });
  it('keeps every card exactly once', () => {
    const hand = cards('5H 9S 6H 7H 3S 4S 8H KC 5S X 2D AS AH');
    for (const sort of [sortHandBySets, sortHandByRuns]) {
      expect(sort(hand).map((c) => c.id).sort()).toEqual(hand.map((c) => c.id).sort());
    }
  });
});

describe('undo', () => {
  const human = (hand: string, extra: Partial<Parameters<typeof scenario>[0]> = {}): Session => ({
    state: scenario({ phase: 'play', hands: [hand, '5H 6H'], ...extra }),
    seats: [{ name: 'Sam', kind: 'human' }, { name: 'Ada', kind: 'medium' }],
    log: [],
    undoStack: [],
  });
  const base = { type: 'layBase' as const, melds: [
    { kind: 'set' as const, rank: 7, cardIds: ids('7S 7H 7D') },
    { kind: 'set' as const, rank: 8, cardIds: ids('8S 8H 8D') },
  ] };
  const ok = (s: Session, a: Parameters<typeof apply>[1]) => {
    const r = apply(s, a);
    if (!r.ok) throw new Error(r.error);
    return r.session;
  };

  it('puts the game back exactly as it was before the play', () => {
    const s0 = human('7S 7H 7D 8S 8H 8D 4C 9C');
    const s1 = ok(s0, base);
    expect(s1.state.melds).toHaveLength(2);
    expect(canUndo(s1)).toBe(true);
    const s2 = undo(s1);
    expect(s2.state).toEqual(s0.state);
    expect(canUndo(s2)).toBe(false);
  });
  it('undoes laying melds and building too, one at a time', () => {
    let s = human('7S 7H 7D 8S 8H 8D 4S 4H 4D 7C 9C');
    const stages = [s.state];
    s = ok(s, base);
    stages.push(s.state);
    s = ok(s, { type: 'layMeld', meld: { kind: 'set', rank: 4, cardIds: ids('4S 4H 4D') } });
    stages.push(s.state);
    s = ok(s, { type: 'build', meldId: 1, cardIds: ids('7C') });
    for (let i = 2; i >= 0; i--) {
      s = undo(s);
      expect(s.state).toEqual(stages[i]);
    }
    expect(canUndo(s)).toBe(false);
  });
  it('does nothing when there is nothing to undo', () => {
    const s = human('7S 7H 7D 8S 8H 8D 4C 9C');
    expect(undo(s)).toBe(s);
  });
  it('cannot take back a draw (that would let you peek at the stock)', () => {
    const s0 = human('7S 7H 7D 8S 8H 8D 4C 9C', { phase: 'draw' });
    const s1 = ok(s0, { type: 'drawStock' });
    expect(canUndo(s1)).toBe(false);
    const s2 = ok(ok(s1, base), { type: 'discard', cardId: '4C.1' });
    expect(s2.undoStack).toEqual([]);
  });
  it('is cleared when your turn ends, and by the computer’s moves', () => {
    const s1 = ok(human('7S 7H 7D 8S 8H 8D 4C 9C'), base);
    expect(s1.undoStack).toHaveLength(1);
    const next = ok(s1, { type: 'discard', cardId: '9C.1' });
    expect(next.undoStack).toEqual([]);
    expect(canUndo(next)).toBe(false);
    // The computer lays down a base on its turn: nothing to undo for the human.
    const ai = ok({ ...human('3S', {}), state: scenario({ phase: 'play', hands: ['3S 4S', '7S 7H 7D 8S 8H 8D 4C 9C'], current: 1 }) }, base);
    expect(ai.undoStack).toEqual([]);
  });
  it('survives saving and loading, including old saves without an undo history', () => {
    const s1 = ok(human('7S 7H 7D 8S 8H 8D 4C 9C'), base);
    expect(deserializeSession(serializeSession(s1))?.undoStack).toHaveLength(1);
    const legacy = JSON.parse(serializeSession(s1));
    delete legacy.session.undoStack;
    expect(deserializeSession(JSON.stringify(legacy))?.undoStack).toEqual([]);
  });
  it('is limited in size', () => {
    let s = human('7S 7H 7D 8S 8H 8D 4S 4H 4D 7C 9C 3S 3H 3D 5C');
    s = ok(s, base);
    for (let i = 0; i < 40; i++) s = { ...s, undoStack: [...s.undoStack, s.state] };
    s = ok(s, { type: 'layMeld', meld: { kind: 'set', rank: 4, cardIds: ids('4S 4H 4D') } });
    expect(s.undoStack.length).toBeLessThanOrEqual(30);
  });
});

describe('sort directions', () => {
  const idsOf = (cs: { id: string }[]) => cs.map((c) => c.id.split('.')[0]);
  const hand = cards('9S KH 5D 3S 9H X 2C 5S 7C');
  it('suit: ascending is spades..clubs low to high; descending reverses both', () => {
    expect(idsOf(sortHand(hand, 'asc'))).toEqual(['3S', '5S', '9S', '9H', 'KH', '5D', '7C', '2C', 'X']);
    expect(idsOf(sortHand(hand, 'desc'))).toEqual(['7C', '5D', 'KH', '9H', '9S', '5S', '3S', '2C', 'X']);
  });
  it('rank: low to high, or exactly reversed, wilds always last', () => {
    expect(idsOf(sortHandByRank(hand, 'asc'))).toEqual(['3S', '5S', '5D', '7C', '9S', '9H', 'KH', '2C', 'X']);
    expect(idsOf(sortHandByRank(hand, 'desc'))).toEqual(['KH', '9H', '9S', '7C', '5D', '5S', '3S', '2C', 'X']);
  });
  it('sets: biggest groups stay first; direction orders ranks within the same size', () => {
    const h = cards('4S 4H KD KC 8S 8H 8D 3C');
    expect(idsOf(sortHandBySets(h, 'asc'))).toEqual(['8S', '8H', '8D', '4S', '4H', 'KD', 'KC', '3C']);
    expect(idsOf(sortHandBySets(h, 'desc'))).toEqual(['8S', '8H', '8D', 'KD', 'KC', '4S', '4H', '3C']);
  });
  it('runs: descending lists each run high to low', () => {
    const h = cards('5H 6H 7H 3S 4S 5S 9C');
    expect(idsOf(sortHandByRuns(h, 'asc'))).toEqual(['3S', '4S', '5S', '5H', '6H', '7H', '9C']);
    expect(idsOf(sortHandByRuns(h, 'desc'))).toEqual(['7H', '6H', '5H', '5S', '4S', '3S', '9C']);
  });
  it('every sort keeps every card exactly once, in both directions', () => {
    const all = cards('5H 9S 6H 7H 3S 4S 8H KC 5S X 2D AS AH 9S.2');
    for (const key of ['sets', 'runs', 'suit', 'rank'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        expect(SORTERS[key](all, dir).map((c) => c.id).sort()).toEqual(all.map((c) => c.id).sort());
      }
    }
  });
});

describe('laying the base from a selection', () => {
  it('finds the base among exactly the selected cards, wilds included', () => {
    const sel = cards('7S 9S 9H X 2C 2D');
    expect(baseFromSelection(sel, 1)).not.toBeNull();
  });
  it('is null if the selection does not make the base, or has extra cards', () => {
    expect(baseFromSelection(cards('7S 7H 7D 8S 8H'), 1)).toBeNull();
    expect(baseFromSelection(cards('7S 7H 7D 8S 8H 8D 4C'), 1)).toBeNull();
    expect(baseFromSelection([], 1)).toBeNull();
  });
  it('knows which kinds of meld a step is made of', () => {
    expect(stepKinds(1)).toEqual(['set']);
    expect(stepKinds(2)).toEqual(['set', 'run']);
    expect(stepKinds(4)).toEqual(['pair']);
    expect(meldOptions(cards('X X.2 2S'), false, stepKinds(1)).every((o) => o.kind === 'set')).toBe(true);
    expect(meldOptions(cards('X X.2 2S'), false, ['run']).every((o) => o.kind === 'run')).toBe(true);
  });
});

describe('the log reads naturally for you and for the computers', () => {
  const play = (human: boolean) => {
    const s0 = createSession({ name: human ? '' : 'Sam', opponents: ['easy'], seed: 3 });
    const seat = human ? 0 : 0;
    const state = scenario({ phase: 'play', hands: ['7S 7H 7D 8S 8H 8D 4C 9C', '5H 6H'], current: seat });
    const r = apply({ ...s0, state }, {
      type: 'layBase',
      melds: [
        { kind: 'set', rank: 7, cardIds: ids('7S 7H 7D') },
        { kind: 'set', rank: 8, cardIds: ids('8S 8H 8D') },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    return r.session.log.at(-1);
  };
  it('says "You laid down your base", not "their"', () => expect(play(true)).toBe('You laid down your base.'));
  it('says "Sam laid down their base" for a named player', () => expect(play(false)).toBe('Sam laid down their base.'));
  it('"You win", "Ada wins"', () => {
    expect(verb('You', 'win', 'wins')).toBe('win');
    expect(verb('Ada', 'win', 'wins')).toBe('wins');
  });
  it('starts the game with "You deal" or "Ada deals"', () => {
    const lines = [0, 1, 2, 3, 4, 5].map((seed) => createSession({ name: '', opponents: ['easy'], seed }).log[0]);
    expect(lines.some((l) => /^Round 1\. You deal\.$/.test(l ?? ''))).toBe(true);
    expect(lines.some((l) => /^Round 1\. Ada deals\.$/.test(l ?? ''))).toBe(true);
  });
});

describe('aces sort high', () => {
  const idsOf = (cs: { id: string }[]) => cs.map((c) => c.id.split('.')[0]);
  const hand = cards('AS 3S KS AH 9H KH AD 5D 2C X');
  it('by suit, an ace comes after the king (and first when descending)', () => {
    expect(idsOf(sortHand(hand, 'asc'))).toEqual(['3S', 'KS', 'AS', '9H', 'KH', 'AH', '5D', 'AD', '2C', 'X']);
    expect(idsOf(sortHand(hand, 'desc'))).toEqual(['AD', '5D', 'AH', 'KH', '9H', 'AS', 'KS', '3S', '2C', 'X']);
  });
  it('by rank, aces are the highest cards', () => {
    expect(idsOf(sortHandByRank(hand, 'asc'))).toEqual(['3S', '5D', '9H', 'KS', 'KH', 'AS', 'AH', 'AD', '2C', 'X']);
    expect(idsOf(sortHandByRank(hand, 'desc'))).toEqual(['AD', 'AH', 'AS', 'KH', 'KS', '9H', '5D', '3S', '2C', 'X']);
  });
  it('by sets, a group of aces ranks above kings among groups of the same size', () => {
    const h = cards('AS AH KS KH 5C 5D');
    expect(idsOf(sortHandBySets(h, 'asc'))).toEqual(['5D', '5C', 'KS', 'KH', 'AS', 'AH']);
    expect(idsOf(sortHandBySets(h, 'desc'))).toEqual(['AS', 'AH', 'KS', 'KH', '5D', '5C']);
  });
  it('by runs, an ace sits after the king and the run reads Q-K-A', () => {
    expect(idsOf(sortHandByRuns(cards('AS QS KS 4H'), 'asc'))).toEqual(['QS', 'KS', 'AS', '4H']);
    expect(idsOf(sortHandByRuns(cards('AS QS KS 4H'), 'desc'))).toEqual(['AS', 'KS', 'QS', '4H']);
  });
  it('the starting order for a new hand also puts aces high', () => {
    expect(idsOf(arrangeHand(cards('AS 3S'), []))).toEqual(['3S', 'AS']);
  });
});

describe('moving several cards at once', () => {
  const row = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('moves a group to the front, the end, or the middle, keeping their order', () => {
    expect(moveCards(row, ['d', 'f'], 0)).toEqual(['d', 'f', 'a', 'b', 'c', 'e']);
    expect(moveCards(row, ['a', 'c'], 6)).toEqual(['b', 'd', 'e', 'f', 'a', 'c']);
    expect(moveCards(row, ['a', 'b'], 4)).toEqual(['c', 'd', 'a', 'b', 'e', 'f']);
  });
  it('gathers cards that were scattered into one block', () => {
    expect(moveCards(row, ['b', 'e', 'f'], 3)).toEqual(['a', 'c', 'b', 'e', 'f', 'd']);
  });
  it('keeps the cards in their current order, whatever order they are named in', () => {
    expect(moveCards(row, ['f', 'b'], 0)).toEqual(['b', 'f', 'a', 'c', 'd', 'e']);
  });
  it('dropping a group where it already is changes nothing', () => {
    expect(moveCards(row, ['c', 'd'], 2)).toEqual(row);
    expect(moveCards(row, ['c', 'd'], 3)).toEqual(row);
    expect(moveCards(row, ['c', 'd'], 4)).toEqual(row);
  });
  it('ignores unknown cards, an empty group, and out-of-range points', () => {
    expect(moveCards(row, [], 2)).toEqual(row);
    expect(moveCards(row, ['zz'], 2)).toEqual(row);
    expect(moveCards(row, ['a'], 99)).toEqual(['b', 'c', 'd', 'e', 'f', 'a']);
    expect(moveCards(row, ['f'], -5)).toEqual(['f', 'a', 'b', 'c', 'd', 'e']);
  });
  it('always keeps every card exactly once', () => {
    for (const group of [['a'], ['a', 'f'], ['b', 'c', 'd'], row]) {
      for (let at = 0; at <= row.length; at++) {
        expect(moveCards(row, group, at).slice().sort()).toEqual(row);
      }
    }
  });
});

describe('remembering the new-game settings', () => {
  /** A stand-in for the browser's localStorage. */
  const fakeStore = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  };

  it('options: default to showing activity, remember a change, and ignore junk', () => {
    const store = fakeStore();
    expect(loadUiOptions(store)).toEqual({ showActivity: true, animations: true });
    saveUiOptions({ showActivity: false, animations: true }, store);
    expect(loadUiOptions(store)).toEqual({ showActivity: false, animations: true });
    expect(sanitizeUiOptions({ showActivity: 'no' })).toEqual({ showActivity: true, animations: true });
    expect(sanitizeUiOptions(null)).toEqual({ showActivity: true, animations: true });
  });
  it('defaults to a 2-player game: you against one Medium computer', () => {
    expect(DEFAULT_SETUP).toEqual({ name: 'You', opponents: ['medium'], spectate: false });
    expect(loadSetupPrefs(fakeStore())).toEqual(DEFAULT_SETUP);
  });
  it('gives back the settings that were saved', () => {
    const store = fakeStore();
    saveSetupPrefs({ name: 'Steve', opponents: ['hard', 'easy', 'medium'], spectate: false }, store);
    expect(loadSetupPrefs(store)).toEqual({ name: 'Steve', opponents: ['hard', 'easy', 'medium'], spectate: false });
  });
  it('remembers watch-only mode too', () => {
    const store = fakeStore();
    saveSetupPrefs({ name: 'You', opponents: ['hard', 'hard'], spectate: true }, store);
    expect(loadSetupPrefs(store).spectate).toBe(true);
  });
  it('the defaults are not shared, so changing them cannot change the defaults', () => {
    const a = loadSetupPrefs(fakeStore());
    a.opponents.push('hard');
    expect(loadSetupPrefs(fakeStore()).opponents).toEqual(['medium']);
    expect(DEFAULT_SETUP.opponents).toEqual(['medium']);
  });
  it('falls back to the defaults for missing, corrupt or unreadable data', () => {
    expect(loadSetupPrefs(fakeStore({ [SETUP_PREFS_KEY]: 'not json {' }))).toEqual(DEFAULT_SETUP);
    expect(loadSetupPrefs(fakeStore({ [SETUP_PREFS_KEY]: 'null' }))).toEqual(DEFAULT_SETUP);
    expect(loadSetupPrefs(fakeStore({ [SETUP_PREFS_KEY]: '42' }))).toEqual(DEFAULT_SETUP);
    expect(loadSetupPrefs(null)).toEqual(DEFAULT_SETUP);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSetupPrefs(throwing)).toEqual(DEFAULT_SETUP);
    expect(() => saveSetupPrefs(DEFAULT_SETUP, throwing)).not.toThrow(); // saving must never break the game
    expect(() => saveSetupPrefs(DEFAULT_SETUP, null)).not.toThrow();
  });
  it('repairs bad values piece by piece', () => {
    expect(sanitizeSetup({ name: 5, opponents: ['hard', 'bogus', 'easy'], spectate: 'yes' })).toEqual({ name: 'You', opponents: ['hard', 'easy'], spectate: false });
    expect(sanitizeSetup({ opponents: [] }).opponents).toEqual(['medium']);
    expect(sanitizeSetup({ name: 'x'.repeat(40) }).name).toHaveLength(16);
  });
  it('keeps the number of opponents within what is allowed', () => {
    expect(sanitizeSetup({ opponents: Array(9).fill('easy') }).opponents).toHaveLength(5); // with you: up to 5
    expect(sanitizeSetup({ opponents: Array(9).fill('easy'), spectate: true }).opponents).toHaveLength(6);
    expect(sanitizeSetup({ opponents: ['hard'], spectate: true }).opponents).toEqual(['hard', 'medium']); // watching needs at least 2
  });
});

describe('watching speed', () => {
  it('labels each level as a multiple of normal speed, with 1× in the default place', async () => {
    const { SPEED_FACTORS, DEFAULT_SPEED, speedLabel } = await import('../src/ui/controller');
    expect(SPEED_FACTORS.map((_, i) => speedLabel(i))).toEqual(['0.5×', '0.7×', '1×', '1.5×', '2.9×', '6.7×']);
    expect(speedLabel(DEFAULT_SPEED)).toBe('1×');
    expect([...SPEED_FACTORS]).toEqual([...SPEED_FACTORS].sort((a, b) => b - a)); // slower to faster
  });

  it('remembers the speed, and ignores anything that is not a valid level', async () => {
    const { loadSpeed, saveSpeed, DEFAULT_SPEED } = await import('../src/ui/controller');
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadSpeed(store)).toBe(DEFAULT_SPEED);
    saveSpeed(4, store);
    expect(loadSpeed(store)).toBe(4);
    saveSpeed(99, store);
    expect(loadSpeed(store)).toBe(DEFAULT_SPEED);
    mem.set('15steps.speed.v1', 'fast');
    expect(loadSpeed(store)).toBe(DEFAULT_SPEED);
  });
});
