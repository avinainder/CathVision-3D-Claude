export default function ToolStatusBar({ tool, measureStep, onDone, onCancel }) {
  if (!tool) return null;

  const messages = {
    label: 'Click on the model surface to place a label',
    measure: measureStep === 0
      ? 'Click the first point on the model'
      : 'Click the second point to complete measurement',
  };

  return (
    <div className="tool-status glass-panel">
      <span className="tool-status__name">
        {tool === 'label' ? '🏷️ Label Mode' : '📏 Measure Mode'}
      </span>
      <span>{messages[tool]}</span>
      <button className="tool-status__btn" onClick={onDone}>Done</button>
      <button className="tool-status__btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}
