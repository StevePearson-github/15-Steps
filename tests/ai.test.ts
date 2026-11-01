import { describe, expect, it } from 'vitest';
import { type Difficulty, createAI } from '../src/ai/player';
import { planPlay } from '../src/ai/plan';
import { runGame } from '../src/sim/run';
import { type GameState, applyAction, createGame, deserializeGame, replay, serializeGame, viewFor } from '../src/engine';
import { cards, run, set } from './helpers';

const cardCount = (g: GameState) =>
  g.stock.length + g.discard.length + g.melds.reduce((n, m) => n + m.cards.length, 0) +
  g.players.reduce((n, p) => n + p.hand.length, 0);

describe('turn planning', () => {
  const base = { step: 1, baseLaid: false, melds: [], nextMeldId: 1, me: 0 };
  it('lays the base when it can, and keeps a card to discard', () => {
    const plan = planPlay({ ...base, hand: cards('7S 7H 7D 8S 8H 8D 4C 9C KD') });
    expect(plan.actions[0]?.type).toBe('layBase');
    expect(plan.remaining.length).toBeGreaterThanOrEqual(1);
  });
  it('does nothing without a base', () => {
    const plan = planPlay({ ...base, hand: cards('7S 8H 9D 3S 4H 6D JC KC') });
    expect(plan.actions).toEqual([]);
    expect(plan.baseLaid).toBe(false);
  });
  it('holds the base when asked', () => {
    const plan = planPlay({ ...base, hand: cards('7S 7H 7D 8S 8H 8D 4C 9C KD'), holdBase: true });
    expect(plan.actions).toEqual([]);
  });
  it('can go out in one turn: base, extra meld, builds, one card left', () => {
    const plan = planPlay({ ...base, hand: cards('7S 7H 7D 8S 8H 8D 4C 4D 4H 9C') });
    expect(plan.actions.map((a) => a.type)).toEqual(['layBase', 'layMeld']);
    expect(plan.remaining).toHaveLength(1);
  });
  it('sheds wilds and spare cards by building onto the table', () => {
    const table = [set(1, 1, 7, '7S 7H 7D'), run(2, 1, 'H', 5, '5H 6H 7H')];
    const plan = planPlay({
      step: 1, baseLaid: true, me: 0, melds: table, nextMeldId: 3,
      hand: cards('X 7C 8H 3S 9D'),
    });
    const kinds = plan.actions.map((a) => a.type);
    expect(kinds.every((k) => k === 'build')).toBe(true);
    // X, 7C and 8H are placed; 3S and 9D fit nothing on the table.
    expect(plan.remaining.map((c) => c.id).sort()).toEqual(['3S.1', '9D.1']);
  });
  it('never plays its last card', () => {
    const plan = planPlay({
      step: 1, baseLaid: true, me: 0, melds: [set(1, 1, 7, '7S 7H 7D')], nextMeldId: 2,
      hand: cards('7C'),
    });
    expect(plan.actions).toEqual([]);
    expect(plan.remaining).toHaveLength(1);
  });
});

describe('AI players always make legal moves', () => {
  for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`${level}: plays whole rounds without an illegal action`, () => {
      const players = [createAI(level, 1), createAI(level, 2), createAI(level, 3)];
      const result = runGame({ playerNames: ['A', 'B', 'C'], seed: 11 }, players, { maxRounds: 4 });
      expect(cardCount(result.state)).toBe(108);
      expect(result.rounds).toBeGreaterThanOrEqual(2);
    });
  }
  it('decides from a hidden-information view only', () => {
    const g = createGame({ playerNames: ['A', 'B'], seed: 3 });
    const action = createAI('hard').decide(viewFor(g, g.current));
    expect(applyAction(g, action).ok).toBe(true);
  });
  it('is deterministic for a seed', () => {
    const play = () =>
      runGame({ playerNames: ['A', 'B'], seed: 5 }, [createAI('medium', 1), createAI('easy', 2)], { maxRounds: 3 });
    expect(play().state).toEqual(play().state);
  });
});

describe('simulation', () => {
  const levels: Difficulty[] = ['easy', 'medium', 'hard'];

  it('whole games finish, with a winner who went out on step 15', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const result = runGame(
        { playerNames: ['A', 'B', 'C'], seed },
        levels.map((l, i) => createAI(l, seed * 3 + i)),
      );
      expect(result.finished).toBe(true);
      expect(cardCount(result.state)).toBe(108);
      const winner = result.state.winner as number;
      expect(result.state.lastRound?.wentOut).toBe(winner);
      const scores = result.state.players.map((p) => p.score);
      expect(scores[winner]).toBeLessThan(Math.min(...scores.filter((_, i) => i !== winner)));
    }
  });

  it('AI vs AI works for 2 to 6 players', () => {
    for (let n = 2; n <= 6; n++) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`);
      const result = runGame({ playerNames: names, seed: n }, names.map((_, i) => createAI('hard', i)));
      expect(result.finished).toBe(true);
      expect(cardCount(result.state)).toBe(108);
    }
  });

  it('harder levels win more: hard beats easy, medium beats easy', () => {
    const wins = { easy: 0, medium: 0, hard: 0 };
    // A fixed, seeded sample (so never flaky): large enough that the levels separate clearly.
    for (let g = 0; g < 75; g++) {
      const order = levels.map((_, i) => levels[(i + g) % 3] as Difficulty);
      const result = runGame(
        { playerNames: ['A', 'B', 'C'], seed: 500 + g },
        order.map((l, i) => createAI(l, g * 7 + i)),
      );
      wins[order[result.state.winner as number] as Difficulty]++;
    }
    expect(wins.hard).toBeGreaterThan(wins.easy);
    expect(wins.medium).toBeGreaterThan(wins.easy);
    expect(wins.hard).toBeGreaterThan(wins.medium);
  }, 30_000);

  it('a game can be saved midway, resumed, and finish the same way', () => {
    const config = { playerNames: ['A', 'B'], seed: 77 };
    const make = () => [createAI('hard', 1), createAI('medium', 2)];
    const full = runGame(config, make());
    const half = replay(config, full.state.actionLog.slice(0, 200));
    const resumed = deserializeGame(serializeGame(half));
    expect(replay(config, full.state.actionLog)).toEqual(full.state);
    expect(resumed).toEqual(half);
  });
});
