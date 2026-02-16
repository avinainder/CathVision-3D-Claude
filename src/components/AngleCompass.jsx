export default function AngleCompass({ angles }) {
  if (!angles) return null;

  // Map angles to position on 80x80 grid
  // Slicer convention: hRaw negative = RAO, positive = LAO
  //                    vRaw negative = CRA, positive = CAU
  // Layout: R (RAO) on left, L (LAO) on right, C (CRA) on top, U (CAU) on bottom
  const hRaw = angles.horizontal.raw;
  const vRaw = angles.vertical.raw;

  // negative hRaw (RAO) → left, negative vRaw (CRA) → up
  const cx = 40 + (hRaw / 90) * 30;
  const cy = 40 + (vRaw / 90) * 30;

  const hColor = hRaw < 0 ? 'var(--color-rao)' : 'var(--color-lao)';
  const vColor = vRaw < 0 ? 'var(--color-cra)' : 'var(--color-cau)';

  return (
    <div className="angle-compass glass-panel" style={{ padding: 8 }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        {/* Grid lines */}
        <line x1="10" y1="40" x2="70" y2="40" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <line x1="40" y1="10" x2="40" y2="70" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <circle cx="40" cy="40" r="20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />

        {/* Axis labels */}
        <text x="4" y="43" fill="var(--color-rao)" fontSize="7" fontFamily="var(--font-mono)">R</text>
        <text x="72" y="43" fill="var(--color-lao)" fontSize="7" fontFamily="var(--font-mono)">L</text>
        <text x="37" y="9" fill="var(--color-cra)" fontSize="7" fontFamily="var(--font-mono)">C</text>
        <text x="36" y="78" fill="var(--color-cau)" fontSize="7" fontFamily="var(--font-mono)">U</text>

        {/* Crosshair lines from center to dot */}
        <line x1="40" y1="40" x2={cx} y2="40" stroke={hColor} strokeWidth="1" opacity="0.4" />
        <line x1={cx} y1="40" x2={cx} y2={cy} stroke={vColor} strokeWidth="1" opacity="0.4" />

        {/* Position dot */}
        <circle cx={cx} cy={cy} r="3.5" fill="white" opacity="0.9" />
        <circle cx={cx} cy={cy} r="2" fill={hColor} />
      </svg>
    </div>
  );
}
