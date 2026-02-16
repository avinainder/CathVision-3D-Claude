export default function Toggle({ value, onChange }) {
  return (
    <button
      className={`toggle ${value ? 'toggle--on' : ''}`}
      onClick={() => onChange(!value)}
      type="button"
    >
      <span className="toggle__knob" />
    </button>
  );
}
