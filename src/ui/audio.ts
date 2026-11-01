import type { GameEvent } from '../engine';
import type { SoundSettings } from './controller';

/**
 * Sound and music, all synthesised with the Web Audio API (no audio files to
 * ship). Browsers only allow audio after a click or key press, so the audio
 * context is created on the first one. Where Web Audio does not exist (tests),
 * every call quietly does nothing.
 */

export type Sfx = 'deal' | 'draw' | 'pickup' | 'discard' | 'base' | 'meld' | 'extend' | 'turn' | 'wentOut' | 'win' | 'lose' | 'shuffle';

/** Which sounds an engine event makes. `me` is the human's seat (-1 when only watching). */
export function sfxForEvent(e: GameEvent, me: number): Sfx | null {
  switch (e.type) {
    case 'roundStarted': return 'deal';
    case 'cardDrawn': return e.from === 'stock' ? 'draw' : 'pickup';
    case 'stockReshuffled': return 'shuffle';
    case 'baseLaid': return 'base';
    case 'meldLaid': return 'meld';
    case 'meldExtended': return 'extend';
    case 'cardDiscarded': return 'discard';
    case 'wentOut': return 'wentOut';
    case 'gameEnded': return me < 0 || e.winner === me ? 'win' : 'lose';
    default: return null;
  }
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

type Ctx = AudioContext;

class AudioEngine {
  private ctx: Ctx | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private settings: SoundSettings = { soundOn: true, soundVolume: 0.7, musicOn: true, musicVolume: 0.4 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar = 0;
  private bar = 0;

  /** Call from a click or key press. Safe to call many times. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        const ctx = new Ctor();
        this.ctx = ctx;
        this.sfxBus = ctx.createGain();
        this.sfxBus.connect(ctx.destination);
        this.musicBus = ctx.createGain();
        // A soft echo makes the music sound roomier.
        const delay = ctx.createDelay(1);
        delay.delayTime.value = 0.38;
        const fb = ctx.createGain();
        fb.gain.value = 0.3;
        const wet = ctx.createGain();
        wet.gain.value = 0.35;
        this.musicBus.connect(ctx.destination);
        this.musicBus.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(wet);
        wet.connect(ctx.destination);
        const len = ctx.sampleRate;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        document.addEventListener('visibilitychange', () => {
          if (!this.ctx) return;
          if (document.hidden) void this.ctx.suspend();
          else void this.ctx.resume();
        });
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.apply();
  }

  configure(s: SoundSettings): void {
    this.settings = s;
    this.apply();
  }

  private apply(): void {
    const { ctx, sfxBus, musicBus, settings: s } = this;
    if (!ctx || !sfxBus || !musicBus) return;
    const t = ctx.currentTime;
    sfxBus.gain.setTargetAtTime(s.soundOn ? s.soundVolume : 0, t, 0.02);
    // Music is mixed lower than the effects at the same slider position.
    musicBus.gain.setTargetAtTime(s.musicOn ? s.musicVolume * 0.5 : 0, t, 0.05);
    if (s.musicOn && s.musicVolume > 0) this.startMusic();
    else this.stopMusic();
  }

  // ---- Effects ----

  play(name: Sfx, delay = 0): void {
    const { ctx, sfxBus, settings } = this;
    if (!ctx || !sfxBus || !settings.soundOn || settings.soundVolume <= 0 || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    switch (name) {
      case 'deal': for (let i = 0; i < 5; i++) this.swish(t + i * 0.07, 0.5, 5000); break;
      case 'shuffle': for (let i = 0; i < 8; i++) this.swish(t + i * 0.06, 0.4, 3000 + (i % 3) * 800); break;
      case 'draw': this.swish(t, 0.7, 4000); break;
      case 'pickup': this.swish(t, 0.7, 2600); this.tone(t + 0.02, 330, 0.08, 'sine', 0.12); break;
      case 'discard': this.thump(t); break;
      case 'extend': this.tone(t, midi(84), 0.12, 'triangle', 0.3); this.tone(t + 0.05, midi(88), 0.14, 'triangle', 0.25); break;
      case 'meld': this.chime(t, [72, 76, 79], 0.06); break;
      case 'base': this.chime(t, [67, 72, 76, 79, 84], 0.07); break;
      case 'turn': this.tone(t, midi(88), 0.25, 'sine', 0.22); this.tone(t + 0.12, midi(93), 0.35, 'sine', 0.2); break;
      case 'wentOut': this.chime(t, [60, 64, 67, 72, 76, 79], 0.09); break;
      case 'win': this.chime(t, [60, 64, 67, 72, 67, 72, 76, 84], 0.13); break;
      case 'lose': this.chime(t, [67, 64, 62, 57], 0.18); break;
    }
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, gain: number): void {
    const { ctx, sfxBus } = this;
    if (!ctx || !sfxBus) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chime(t: number, notes: number[], gap: number): void {
    notes.forEach((n, i) => this.tone(t + i * gap, midi(n), 0.5, 'triangle', 0.22));
  }

  /** A card sliding: a short burst of band-passed noise. */
  private swish(t: number, gain: number, freq: number): void {
    const { ctx, sfxBus, noise } = this;
    if (!ctx || !sfxBus || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq * 0.6, t);
    f.frequency.exponentialRampToValueAtTime(freq, t + 0.09);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t, Math.random() * 0.5, 0.2);
  }

  /** A card landing on the pile: a soft low knock plus a bit of paper. */
  private thump(t: number): void {
    const { ctx, sfxBus } = this;
    if (!ctx || !sfxBus) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t);
    o.stop(t + 0.2);
    this.swish(t, 0.5, 6000);
  }

  // ---- Music ----
  // A gentle, endless loop: a slow chord pad, a soft bass, and a sparse pentatonic melody that never repeats exactly.

  private static readonly CHORDS = [
    { root: 48, notes: [60, 64, 67, 71] }, // C maj7
    { root: 45, notes: [57, 60, 64, 67] }, // A min7
    { root: 41, notes: [57, 60, 65, 69] }, // F maj7
    { root: 43, notes: [55, 59, 62, 67] }, // G
  ];
  private static readonly SCALE = [0, 2, 4, 7, 9]; // C major pentatonic
  private static readonly BEAT = 60 / 80;

  private startMusic(): void {
    if (this.timer || !this.ctx) return;
    this.nextBar = this.ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.schedule(), 400);
    this.schedule();
  }

  private stopMusic(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const { ctx } = this;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      this.nextBar = Math.max(this.nextBar, ctx.currentTime + 0.1);
      return;
    }
    while (this.nextBar < ctx.currentTime + 1.5) {
      this.playBar(this.nextBar, AudioEngine.CHORDS[this.bar % 4] ?? AudioEngine.CHORDS[0]!);
      this.nextBar += AudioEngine.BEAT * 4;
      this.bar++;
    }
  }

  private note(t: number, freq: number, dur: number, type: OscillatorType, peak: number, attack: number, cutoff = 4000): void {
    const { ctx, musicBus } = this;
    if (!ctx || !musicBus) return;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private playBar(t: number, chord: { root: number; notes: number[] }): void {
    const beat = AudioEngine.BEAT;
    const barLen = beat * 4;
    // Pad: each chord tone as a slightly detuned pair, swelling in and out.
    for (const n of chord.notes) {
      for (const detune of [-0.4, 0.4]) {
        this.note(t, midi(n) * 2 ** (detune / 12), barLen * 1.15, 'triangle', 0.05, barLen * 0.35, 1400);
      }
    }
    // Bass on beats 1 and 3.
    this.note(t, midi(chord.root), beat * 1.8, 'sine', 0.22, 0.03, 600);
    this.note(t + beat * 2, midi(chord.root + (Math.random() < 0.3 ? 7 : 0)), beat * 1.6, 'sine', 0.18, 0.03, 600);
    // Melody: plucked notes on the eighths, often resting.
    for (let i = 0; i < 8; i++) {
      if (Math.random() < 0.5) continue;
      const degree = AudioEngine.SCALE[Math.floor(Math.random() * 5)] ?? 0;
      const octave = Math.random() < 0.35 ? 84 : 72;
      this.note(t + i * beat * 0.5, midi(octave + degree), beat * 1.6, 'sine', 0.09, 0.01, 3000);
    }
  }
}

export const audio = new AudioEngine();
