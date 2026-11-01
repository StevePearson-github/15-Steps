import type { Card } from './cards';
import type { GameState, PlayerState } from './game';

export interface PlayerView extends Omit<GameState, 'players' | 'stock' | 'actionLog' | 'rngState' | 'seed'> {
  me: number;
  players: (Omit<PlayerState, 'hand'> & { hand: Card[] | null; handSize: number })[];
  stockSize: number;
}

/** The game as one player may see it: other hands and the stock are hidden. */
export function viewFor(state: GameState, player: number): PlayerView {
  const { players, stock, actionLog: _log, rngState: _rng, seed: _seed, ...rest } = state;
  return {
    ...rest,
    me: player,
    stockSize: stock.length,
    players: players.map((p, i) => ({
      ...p,
      hand: i === player ? p.hand : null,
      handSize: p.hand.length,
    })),
  };
}
