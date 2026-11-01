import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from '../ai/player';
import type { Action } from '../engine';
import { Setup } from './Setup';
import { Table } from './Table';
import { setMotionScale } from './motion';
import {
  SESSION_SAVE_KEY, SPEED_FACTORS, loadSpeed, saveSpeed, speedLabel, type Session, type SetupOptions, aiStep, apply, createSession,
  deserializeSession, humanSeat, makePlayers, serializeSession, undo,
} from './controller';

function loadSaved(): Session | null {
  try {
    const text = localStorage.getItem(SESSION_SAVE_KEY);
    const s = text ? deserializeSession(text) : null;
    return s && s.state.phase !== 'gameOver' ? s : null;
  } catch {
    return null;
  }
}

function save(session: Session | null) {
  try {
    if (session && session.state.phase !== 'gameOver') localStorage.setItem(SESSION_SAVE_KEY, serializeSession(session));
    else localStorage.removeItem(SESSION_SAVE_KEY);
  } catch {
    /* storage unavailable: the game still works, it just can't be resumed */
  }
}

export function App({ aiDelayMs = 700 }: { aiDelayMs?: number }) {
  const [session, setSession] = useState<Session | null>(null);
  const players = useRef<(Player | null)[]>([]);
  const saved = useMemo(loadSaved, []);
  // Watching only: hold the computers still so you can study the table.
  const [paused, setPaused] = useState(false);
  // Watching: how fast the computers play (and how fast the cards fly), changed with the arrows beside Pause.
  const [speed, setSpeed] = useState(() => loadSpeed());
  const factor = SPEED_FACTORS[speed] ?? 1;
  useEffect(() => { setMotionScale(factor); saveSpeed(speed); }, [speed, factor]);

  const start = (opts: SetupOptions) => {
    const s = createSession(opts);
    players.current = makePlayers(s.seats, opts.seed);
    setPaused(false);
    setSession(s);
  };

  const resume = () => {
    if (!saved) return;
    players.current = makePlayers(saved.seats, saved.state.seed);
    setPaused(false);
    setSession(saved);
  };

  useEffect(() => save(session), [session]);

  /** Play one computer move, or start the next round when watching. */
  const advance = () =>
    setSession((s) => {
      if (!s) return s;
      if (s.state.phase === 'roundOver') {
        const r = humanSeat(s) < 0 ? apply(s, { type: 'nextRound' }) : null;
        return r?.ok ? r.session : s;
      }
      return aiStep(s, players.current) ?? s;
    });

  // Computer players move on a timer, so a person can follow the game. Pausing stops the timer.
  useEffect(() => {
    if (!session || paused) return;
    const { state, seats } = session;
    if (state.phase === 'gameOver') return;
    const watching = humanSeat(session) < 0;
    let delay: number | null = null;
    if (state.phase === 'roundOver') {
      if (watching) delay = Math.max(aiDelayMs * factor * 3, 0);
    } else if (seats[state.current]?.kind !== 'human') {
      delay = aiDelayMs * factor;
    }
    if (delay === null) return;
    const timer = setTimeout(advance, delay);
    return () => clearTimeout(timer);
  }, [session, aiDelayMs, paused, factor]);

  if (!session) return <Setup onStart={start} {...(saved ? { onContinue: resume } : {})} />;

  const onAction = (action: Action): string | null => {
    const r = apply(session, action);
    if (!r.ok) return r.error;
    setSession(r.session);
    return null;
  };

  return (
    <Table
      session={session}
      onAction={onAction}
      onNewGame={() => {
        setPaused(false);
        setSession(null);
      }}
      onUndo={() => setSession((s) => (s ? undo(s) : s))}
      speed={{
        label: speedLabel(speed),
        canSlower: speed > 0,
        canFaster: speed < SPEED_FACTORS.length - 1,
        onSlower: () => setSpeed((s) => Math.max(0, s - 1)),
        onFaster: () => setSpeed((s) => Math.min(SPEED_FACTORS.length - 1, s + 1)),
      }}
      watch={{
        paused,
        onTogglePause: () => setPaused((p) => !p),
        onStep: advance,
      }}
    />
  );
}
