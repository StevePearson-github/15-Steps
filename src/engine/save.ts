import { type Action, type GameConfig, type GameState, applyAction, createGame } from './game';

export const SAVE_FORMAT = '15steps-save';
export const SAVE_VERSION = 1;

export function serializeGame(state: GameState): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, state });
}

export function deserializeGame(text: string): GameState {
  const data = JSON.parse(text) as { format?: string; version?: number; state?: GameState };
  if (data.format !== SAVE_FORMAT) throw new Error('Not a 15 Steps save file');
  if (data.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${data.version}`);
  if (!data.state) throw new Error('Save file has no game state');
  return data.state;
}

/** Rebuild a game from its config and the actions played. */
export function replay(config: GameConfig, actions: readonly Action[]): GameState {
  let state = createGame(config);
  for (const action of actions) {
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`Replay failed: ${r.error}`);
    state = r.state;
  }
  return state;
}
