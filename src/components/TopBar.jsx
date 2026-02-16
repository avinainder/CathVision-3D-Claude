export default function TopBar({
  fileName,
  triCount,
  activeTool,
  onLoadSTL,
  onToggleLabels,
  onToggleMeasure,
  onScreenshot,
  onResetView,
  onToggleSettings,
}) {
  const fileInputId = 'stl-file-input';

  return (
    <div className="top-bar glass-panel">
      <span className="top-bar__version">v0.2</span>
      <span className="top-bar__title">Coronary 3D</span>
      {fileName && (
        <span className="top-bar__info">
          {fileName} — {triCount?.toLocaleString()} tris
        </span>
      )}
      <div className="top-bar__spacer" />

      <label className="top-bar__btn top-bar__btn--load" htmlFor={fileInputId} title="Load STL file">
        📂 Load STL
      </label>
      <input
        id={fileInputId}
        type="file"
        accept=".stl"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files[0]) onLoadSTL(e.target.files[0]);
          e.target.value = '';
        }}
      />

      <button
        className={`top-bar__btn ${activeTool === 'label' ? 'top-bar__btn--active' : ''}`}
        title="Label tool"
        onClick={onToggleLabels}
      >
        🏷️
      </button>
      <button
        className={`top-bar__btn ${activeTool === 'measure' ? 'top-bar__btn--active' : ''}`}
        title="Measure tool"
        onClick={onToggleMeasure}
      >
        📏
      </button>
      <button className="top-bar__btn" title="Screenshot" onClick={onScreenshot}>
        📸
      </button>
      <button className="top-bar__btn" title="Reset view" onClick={onResetView}>
        🎯
      </button>
      <button className="top-bar__btn" title="Settings" onClick={onToggleSettings}>
        ⚙️
      </button>
    </div>
  );
}
