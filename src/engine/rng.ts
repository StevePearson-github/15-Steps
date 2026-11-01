/**
 * Deterministic, serializable RNG (mulberry32). The RNG state is a plain
 * number stored in the game state, so games can be saved and replayed exactly.
 */
export function nextRandom(state: number): [value: number, nextState: number] {
  const t = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return [value, t];
}

/** Fisher-Yates shuffle. Returns a new array and the advanced RNG state. */
export function shuffle<T>(items: readonly T[], rngState: number): { items: T[]; rngState: number } {
  const out = items.slice();
  let state = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const [v, next] = nextRandom(state);
    state = next;
    const j = Math.floor(v * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return { items: out, rngState: state };
}
