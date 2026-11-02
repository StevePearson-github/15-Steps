import { describe, expect, it } from 'vitest';
import { sfxForEvent } from '../src/ui/audio';
import { DEFAULT_SOUND, SOUND_KEY, loadSound, sanitizeSound, saveSound, serializeSession, createSession, deserializeSession } from '../src/ui/controller';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('sound settings', () => {
  it('defaults when nothing is stored or it is garbage', () => {
    expect(loadSound(memory())).toEqual(DEFAULT_SOUND);
    const bad = memory();
    bad.setItem(SOUND_KEY, '{nope');
    expect(loadSound(bad)).toEqual(DEFAULT_SOUND);
  });
  it('remembers what was saved', () => {
    const store = memory();
    const s = { soundOn: false, soundVolume: 0.25, musicOn: true, musicVolume: 0 };
    saveSound(s, store);
    expect(loadSound(store)).toEqual(s);
  });
  it('clamps volumes and ignores wrong types', () => {
    expect(sanitizeSound({ soundVolume: 5, musicVolume: -1, soundOn: 'yes' })).toEqual({ ...DEFAULT_SOUND, soundVolume: 1, musicVolume: 0 });
  });
});

describe('sound events', () => {
  it('maps engine events to effects', () => {
    expect(sfxForEvent({ type: 'cardDrawn', player: 0, from: 'discard' }, 0)).toBe('pickup');
    expect(sfxForEvent({ type: 'gameEnded', winner: 1 }, 0)).toBe('lose');
    expect(sfxForEvent({ type: 'gameEnded', winner: 1 }, -1)).toBe('win');
  });
  it('never saves the transient events', () => {
    const s = { ...createSession({ name: 'A', opponents: ['easy'], seed: 1, spectate: false }), events: [{ type: 'wentOut' as const, player: 0 }] };
    expect(serializeSession(s)).not.toContain('wentOut');
    expect(deserializeSession(serializeSession(s))).not.toBeNull();
  });
});
