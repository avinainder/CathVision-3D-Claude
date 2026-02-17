import Slider from './ui/Slider';
import Toggle from './ui/Toggle';

const COLOR_THEMES = [
  { name: 'Arterial Red', color: '#cc3333', bg: '#0d0808' },
  { name: 'Warm Coral', color: '#e8a87c', bg: '#0d0b08' },
  { name: 'Angio Blue', color: '#44aadd', bg: '#080a0d' },
  { name: 'Surgical Green', color: '#55cc88', bg: '#080d0a' },
  { name: 'Silver', color: '#cccccc', bg: '#0a0a0a' },
  { name: 'Gold', color: '#ddaa44', bg: '#0d0b08' },
];

export default function SettingsPanel({
  open,
  onClose,
  opacity,
  onOpacityChange,
  wireframe,
  onWireframeChange,
  showLabels,
  onShowLabelsChange,
  activeColor,
  onColorChange,
  labels,
  onDeleteLabel,
  measurements,
  onDeleteMeasurement,
  onClearMeasurements,
}) {
  return (
    <>
      <div
        className={`settings-overlay ${open ? 'settings-overlay--open' : ''}`}
        onClick={onClose}
      />
      <div className={`settings-panel ${open ? 'settings-panel--open' : ''}`}>
        <h3>Display</h3>

        <div className="settings-row">
          <span className="settings-row__label">Opacity</span>
          <Slider value={opacity} min={0.05} max={1} step={0.05} onChange={onOpacityChange} />
        </div>

        <div className="settings-row">
          <span className="settings-row__label">Wireframe</span>
          <Toggle value={wireframe} onChange={onWireframeChange} />
        </div>

        <div className="settings-row">
          <span className="settings-row__label">Show Labels</span>
          <Toggle value={showLabels} onChange={onShowLabelsChange} />
        </div>

        <h3>Color Theme</h3>
        <div className="color-grid">
          {COLOR_THEMES.map((t) => (
            <button
              key={t.name}
              className={`color-swatch ${activeColor === t.color ? 'color-swatch--active' : ''}`}
              style={{ background: t.color }}
              title={t.name}
              onClick={() => onColorChange(t.color, t.bg)}
            />
          ))}
        </div>

        <h3>Labels ({labels.length})</h3>
        <div className="item-list">
          {labels.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No labels placed</span>
          )}
          {labels.map((l) => (
            <div key={l.id} className="item-row">
              <span>{l.text}</span>
              <button className="item-row__delete" onClick={() => onDeleteLabel(l.id)}>✕</button>
            </div>
          ))}
        </div>

        <h3>Measurements ({measurements.length})</h3>
        <div className="item-list">
          {measurements.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No measurements</span>
          )}
          {measurements.map((m) => (
            <div key={m.id} className="item-row">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{m.distance.toFixed(1)} mm</span>
              <button className="item-row__delete" onClick={() => onDeleteMeasurement(m.id)}>✕</button>
            </div>
          ))}
          {measurements.length > 0 && (
            <button
              className="tool-status__btn"
              style={{ marginTop: 4, alignSelf: 'flex-start' }}
              onClick={onClearMeasurements}
            >
              Clear all
            </button>
          )}
        </div>

        <h3>Controls</h3>
        <div className="controls-ref">
          <div><kbd>Drag</kbd> Rotate</div>
          <div><kbd>Scroll</kbd> Zoom</div>
          <div><kbd>Right-drag</kbd> / <kbd>Shift+drag</kbd> Pan</div>
          <div><kbd>Touch</kbd> 1-finger rotate, 2-finger zoom+pan</div>
        </div>

        <h3 style={{ marginTop: 24 }}>Creator</h3>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          <div>Avinainder Singh</div>
          <div style={{ opacity: 0.7 }}>Co-created with Claude (Anthropic)</div>
        </div>
      </div>
    </>
  );
}

export { COLOR_THEMES };
