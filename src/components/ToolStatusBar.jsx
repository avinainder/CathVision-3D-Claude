export default function ToolStatusBar({ tool, measureStep, pinningName, onDone, onCancel }) {
  if (!tool) return null;

  const names = {
    label: '🏷️ Label Mode',
    measure: '📏 Measure Mode',
    pin: '◆ Pin',
  };
  const messages = {
    label: 'Tap the model surface to place a label',
    measure: measureStep === 0
      ? 'Tap the first point on the model'
      : 'Tap the second point to complete measurement',
    pin: `Tap the model at the ${pinningName || 'segment'}`,
  };

  return (
    <div className="tool-status glass-panel">
      <span className="tool-status__name">{names[tool]}</span>
      <span className="tool-status__message">{messages[tool]}</span>
      {tool !== 'pin' && <button className="tool-status__btn" onClick={onDone}>Done</button>}
      <button className="tool-status__btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}
