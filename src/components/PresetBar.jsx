import { PRESETS } from '../utils/carmAngles';

export default function PresetBar({ onSelect }) {
  return (
    <div className="preset-bar glass-panel">
      {PRESETS.map((p) => (
        <button
          key={p.name}
          className="preset-btn"
          title={p.tip}
          onClick={() => onSelect(p)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
