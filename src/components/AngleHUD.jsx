export default function AngleHUD({ angles }) {
  if (!angles) return null;

  const h = angles.horizontal;
  const v = angles.vertical;
  const hClass = h.label.toLowerCase();
  const vClass = v.label.toLowerCase();

  return (
    <div className="angle-hud">
      <div className="angle-hud__panel glass-panel">
        <div className={`angle-hud__label angle-hud__label--${hClass}`}>{h.label}</div>
        <div className={`angle-hud__value angle-hud__value--${hClass}`}>
          {h.value.toFixed(1)}°
        </div>
        <div className="angle-hud__fullname">{h.fullName}</div>
      </div>
      <div className="angle-hud__panel glass-panel">
        <div className={`angle-hud__label angle-hud__label--${vClass}`}>{v.label}</div>
        <div className={`angle-hud__value angle-hud__value--${vClass}`}>
          {v.value.toFixed(1)}°
        </div>
        <div className="angle-hud__fullname">{v.fullName}</div>
      </div>
    </div>
  );
}
