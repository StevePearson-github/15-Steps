import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Action, type GameConfig, type GameState, applyAction, createGame,
  deserializeGame, replay, serializeGame, simpleLegalActions, viewFor,
} from '../src/engine';

const config: GameConfig = { playerNames: ['A', 'B', 'C'], seed: 99 };

/** Play draw/discard turns choosing among legal actions with a deterministic pick. */
function play(state: GameState, picks: number[]): GameState {
  let s = state;
  for (const pick of picks) {
    const legal = simpleLegalActions(s);
    if (legal.length === 0) break;
    const r = applyAction(s, legal[pick % legal.length] as Action);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

const cardCount = (g: GameState) =>
  g.stock.length + g.discard.length + g.melds.reduce((n, m) => n + m.cards.length, 0) +
  g.players.reduce((n, p) => n + p.hand.length, 0);

describe('save and resume', () => {
  it('round-trips through JSON', () => {
    const g = play(createGame(config), [0, 3, 1, 2, 5, 0, 1, 1]);
    expect(deserializeGame(serializeGame(g))).toEqual(g);
  });
  it('a resumed game keeps playing identically', () => {
    const g = play(createGame(config), [0, 1, 2, 3]);
    const resumed = deserializeGame(serializeGame(g));
    expect(play(resumed, [1, 2, 3, 4])).toEqual(play(g, [1, 2, 3, 4]));
  });
  it('replaying seed + actions gives the same state', () => {
    const g = play(createGame(config), [0, 3, 1, 2, 5, 0, 1, 1, 4, 2]);
    expect(replay(config, g.actionLog)).toEqual(g);
  });
  it('rejects unknown files and versions', () => {
    expect(() => deserializeGame('{"format":"nope"}')).toThrow(/save file/);
    expect(() => deserializeGame('{"format":"15steps-save","version":99}')).toThrow(/version/);
  });
});

describe('invariants under random play', () => {
  it('conserves all 108 cards and keeps turns valid', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.array(fc.nat(50), { maxLength: 400 }), fc.integer({ min: 2, max: 6 }), (seed, picks, n) => {
        const names = Array.from({ length: n }, (_, i) => `P${i}`);
        let s = createGame({ playerNames: names, seed });
        for (const pick of picks) {
          s = play(s, [pick]);
          expect(cardCount(s)).toBe(108);
          expect(s.current).toBeLessThan(n);
          if (s.phase === 'draw') expect(s.players.every((p) => p.hand.length === 13)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });
  it('is deterministic: same seed and picks, same game', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.array(fc.nat(50), { maxLength: 100 }), (seed, picks) => {
        const a = play(createGame({ playerNames: ['A', 'B'], seed }), picks);
        const b = play(createGame({ playerNames: ['A', 'B'], seed }), picks);
        expect(a).toEqual(b);
      }),
      { numRuns: 30 },
    );
  });
});

describe('player view', () => {
  it('hides other hands and the stock but shows your own hand', () => {
    const g = createGame(config);
    const v = viewFor(g, 1);
    expect(v.players[1]?.hand).toHaveLength(13);
    expect(v.players[0]?.hand).toBeNull();
    expect(v.players[0]?.handSize).toBe(13);
    expect(v.stockSize).toBe(g.stock.length);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(g.players[0]?.hand[0]));
    expect('stock' in v).toBe(false);
  });
});
