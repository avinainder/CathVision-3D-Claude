export default function DropOverlay({ visible }) {
  if (!visible) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-overlay__content">
        <div className="drop-overlay__icon">📁</div>
        <div className="drop-overlay__text">Drop STL file to load</div>
      </div>
    </div>
  );
}
