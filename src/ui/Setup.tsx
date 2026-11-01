import { useEffect, useState } from 'react';
import type { Difficulty } from '../ai/player';
import { MAX_NAME_LENGTH, type SetupOptions, type SetupPrefs, loadSetupPrefs, opponentRange, saveSetupPrefs } from './controller';

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

interface SetupProps {
  onStart: (opts: SetupOptions) => void;
  onContinue?: () => void;
}

export function Setup({ onStart, onContinue }: SetupProps) {
  // Start from whatever was used last time (a 2-player game against Medium the first time).
  const [prefs, setPrefs] = useState<SetupPrefs>(() => loadSetupPrefs());
  const { name, opponents, spectate } = prefs;
  const { min, max } = opponentRange(spectate);

  // Remember every change straight away, so closing the program at any point keeps it.
  useEffect(() => saveSetupPrefs(prefs), [prefs]);

  const setCount = (n: number, from: SetupPrefs = prefs) =>
    setPrefs({ ...from, opponents: Array.from({ length: n }, (_, i) => from.opponents[i] ?? 'medium') });

  return (
    <main className="setup">
      <h1>15 Steps</h1>
      <p className="tagline">Complete all 15 steps with the lowest score.</p>
      {onContinue && (
        <button type="button" className="primary" onClick={onContinue}>
          Continue saved game
        </button>
      )}
      <fieldset>
        <legend>New game</legend>
        <label>
          <input
            type="checkbox"
            checked={spectate}
            onChange={(e) => {
              const next = { ...prefs, spectate: e.target.checked };
              const range = opponentRange(e.target.checked);
              setCount(Math.min(Math.max(opponents.length, range.min), range.max), next);
            }}
          />{' '}
          Watch the computer players play (no human seat)
        </label>
        {!spectate && (
          <label>
            Your name{' '}
            <input value={name} onChange={(e) => setPrefs({ ...prefs, name: e.target.value })} maxLength={MAX_NAME_LENGTH} />
          </label>
        )}
        <label>
          {spectate ? 'Players' : 'Opponents'}{' '}
          <select value={opponents.length} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        {opponents.map((level, i) => (
          <label key={i}>
            Computer {i + 1}{' '}
            <select
              value={level}
              onChange={(e) => setPrefs({ ...prefs, opponents: opponents.map((o, j) => (j === i ? (e.target.value as Difficulty) : o)) })}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l[0]?.toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          className="primary"
          onClick={() => onStart({ name, opponents, seed: Math.floor(Math.random() * 2 ** 31), spectate })}
        >
          Start game
        </button>
      </fieldset>
    </main>
  );
}
