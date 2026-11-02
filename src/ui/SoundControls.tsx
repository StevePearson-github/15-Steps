import type { SoundSettings } from './controller';

export interface SoundProps {
  settings: SoundSettings;
  onChange: (s: SoundSettings) => void;
}

/** On/off and volume for sound effects and for music. Used on the setup screen and in Options. */
export function SoundControls({ settings, onChange }: SoundProps) {
  const row = (label: string, on: keyof SoundSettings, vol: keyof SoundSettings) => (
    <div className="sound-row">
      <label className="sound-toggle">
        <input
          type="checkbox"
          checked={settings[on] as boolean}
          onChange={(e) => onChange({ ...settings, [on]: e.target.checked })}
        />
        <strong>{label}</strong>
      </label>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label={`${label} volume`}
        value={Math.round((settings[vol] as number) * 100)}
        disabled={!settings[on]}
        onChange={(e) => onChange({ ...settings, [vol]: Number(e.target.value) / 100 })}
      />
    </div>
  );
  return (
    <div className="sound-controls">
      {row('Sound effects', 'soundOn', 'soundVolume')}
      {row('Music', 'musicOn', 'musicVolume')}
    </div>
  );
}
