import { useEffect, useState } from 'react';
import type { Difficulty } from '../ai/player';
import { useCompact } from './compact';
import { SoundControls, type SoundProps } from './SoundControls';
import {
  DEFAULT_COMPUTER_NAMES, MAX_NAME_LENGTH, type SetupOptions, type SetupPrefs, loadComputerNames, loadSetupPrefs, opponentRange, sanitizeComputerNames, saveComputerNames, saveSetupPrefs,
} from './controller';

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

interface SetupProps {
  onStart: (opts: SetupOptions) => void;
  onContinue?: () => void;
  /** Set when a game is already under way: go back to it instead of starting a new one. */
  onCancel?: () => void;
  sound?: SoundProps;
}

export function Setup({ onStart, onContinue, onCancel, sound }: SetupProps) {
  // Start from whatever was used last time (a 2-player game against Medium the first time).
  const [prefs, setPrefs] = useState<SetupPrefs>(() => loadSetupPrefs());
  const { name, opponents, spectate } = prefs;
  // A phone held sideways has room for fewer players (see opponentRange).
  const compact = useCompact();
  const { min, max } = opponentRange(spectate, compact);
  // The computers' names have a screen of their own; like everything here they are remembered as they are typed.
  const [names, setNames] = useState<string[]>(() => loadComputerNames());
  const [editingNames, setEditingNames] = useState(false);
  useEffect(() => saveComputerNames(names), [names]);

  // Remember every change straight away, so closing the program at any point keeps it.
  useEffect(() => saveSetupPrefs(prefs), [prefs]);

  const setCount = (n: number, from: SetupPrefs = prefs) =>
    setPrefs({ ...from, opponents: Array.from({ length: n }, (_, i) => from.opponents[i] ?? 'medium') });
  // Settings remembered from a bigger screen (or before the phone was turned sideways) may name more players than fit.
  useEffect(() => {
    if (opponents.length > max) setCount(max);
  }, [opponents.length, max]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editingNames) {
    return (
      <main className="setup">
        <h1>15 Steps</h1>
        <fieldset>
          <legend>Computer names</legend>
          {DEFAULT_COMPUTER_NAMES.map((dflt, i) => (
            <label key={i}>
              Computer {i + 1}{' '}
              <input
                value={names[i] ?? ''}
                placeholder={dflt}
                maxLength={MAX_NAME_LENGTH}
                onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
              />
            </label>
          ))}
          <button type="button" onClick={() => setNames([...DEFAULT_COMPUTER_NAMES])}>Reset to the defaults</button>
          <button type="button" className="primary" onClick={() => { setNames(sanitizeComputerNames(names)); setEditingNames(false); }}>Done</button>
        </fieldset>
      </main>
    );
  }

  return (
    <main className="setup">
      <h1>15 Steps</h1>
      <p className="tagline">Complete all 15 steps with the lowest score.</p>
      {onCancel && (
        <button type="button" className="primary" onClick={onCancel}>
          Back to game
        </button>
      )}
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
              const range = opponentRange(e.target.checked, compact);
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
        <button type="button" onClick={() => setEditingNames(true)}>Computer names…</button>
        <button
          type="button"
          className="primary"
          onClick={() => onStart({ name, opponents, seed: Math.floor(Math.random() * 2 ** 31), spectate, computerNames: sanitizeComputerNames(names) })}
        >
          Start game
        </button>
      </fieldset>
      {sound && (
        <fieldset>
          <legend>Sound</legend>
          <SoundControls {...sound} />
        </fieldset>
      )}
    </main>
  );
}
