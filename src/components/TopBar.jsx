export default function TopBar({
  fileName,
  triCount,
  activeTool,
  onLoadSTL,
  onIsolate,
  isolating,
  isolated,
  onUndoIsolate,
  onToggleLabels,
  onToggleMeasure,
  onScreenshot,
  onResetView,
  reportOpen,
  onToggleReport,
  onToggleSettings,
}) {
  const fileInputId = 'stl-file-input';

  return (
    <div className="top-bar glass-panel">
      <span className="top-bar__version">v0.6</span>
      <span className="top-bar__title">Coronary 3D</span>
      {fileName && (
        <span className="top-bar__info">
          {fileName} — {triCount?.toLocaleString()} tris
        </span>
      )}
      <div className="top-bar__spacer" />

      <label className="top-bar__btn top-bar__btn--wide" htmlFor={fileInputId} title="Load STL file">
        📂<span className="top-bar__btn-text">Load STL</span>
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

      {fileName && !isolated && (
        <button
          className={`top-bar__btn top-bar__btn--wide ${isolating ? 'top-bar__btn--active' : ''}`}
          title="Isolate largest connected component (aorta + coronary tree)"
          aria-label="Isolate largest component"
          onClick={onIsolate}
          disabled={isolating}
        >
          {isolating ? '⏳' : '✂️'}<span className="top-bar__btn-text">Isolate</span>
        </button>
      )}
      {isolated && (
        <button
          className="top-bar__btn top-bar__btn--wide"
          title="Undo isolation — restore original mesh"
          aria-label="Undo isolation"
          onClick={onUndoIsolate}
        >
          ↩️<span className="top-bar__btn-text">Undo</span>
        </button>
      )}

      <button
        className={`top-bar__btn ${activeTool === 'label' ? 'top-bar__btn--active' : ''}`}
        title="Label tool"
        aria-label="Label tool"
        onClick={onToggleLabels}
      >
        🏷️
      </button>
      <button
        className={`top-bar__btn ${activeTool === 'measure' ? 'top-bar__btn--active' : ''}`}
        title="Measure tool"
        aria-label="Measure tool"
        onClick={onToggleMeasure}
      >
        📏
      </button>
      <button className="top-bar__btn" title="Screenshot" aria-label="Screenshot" onClick={onScreenshot}>
        📸
      </button>
      <button className="top-bar__btn" title="Reset view" aria-label="Reset view" onClick={onResetView}>
        🎯
      </button>
      <button
        className={`top-bar__btn ${reportOpen ? 'top-bar__btn--active' : ''}`}
        title="CAD-RADS report"
        aria-label="CAD-RADS report"
        onClick={onToggleReport}
      >
        📋
      </button>
      <button className="top-bar__btn" title="Settings" aria-label="Settings" onClick={onToggleSettings}>
        ⚙️
      </button>
    </div>
  );
}
