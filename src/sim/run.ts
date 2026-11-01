import type { Player } from '../ai/player';
import { type Action, type GameConfig, type GameState, applyAction, createGame, viewFor } from '../engine';

export interface SimResult {
  state: GameState;
  /** True if the game reached a winner before the round limit. */
  finished: boolean;
  rounds: number;
  actions: number;
}

export interface SimOptions {
  maxRounds?: number;
  maxActions?: number;
  onAction?: (action: Action, state: GameState) => void;
}

/** Play a whole game headlessly with one Player per seat (humans can be stubs). */
export function runGame(config: GameConfig, players: Player[], opts: SimOptions = {}): SimResult {
  const maxRounds = opts.maxRounds ?? 300;
  const maxActions = opts.maxActions ?? 200_000;
  let state = createGame(config);
  let actions = 0;
  while (state.phase !== 'gameOver' && state.round <= maxRounds && actions < maxActions) {
    const seat = state.phase === 'roundOver' ? state.current : state.current;
    const player = players[seat];
    if (!player) throw new Error(`No player for seat ${seat}`);
    const action = state.phase === 'roundOver' ? ({ type: 'nextRound' } as Action) : player.decide(viewFor(state, seat));
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(`Illegal action by seat ${seat}: ${result.error} (${JSON.stringify(action)})`);
    state = result.state;
    actions++;
    opts.onAction?.(action, state);
  }
  return { state, finished: state.phase === 'gameOver', rounds: state.round, actions };
}
