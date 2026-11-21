import { memo, useMemo, useRef, useState } from 'react';
import {
  classify,
  DOMINANCE,
  findingColor,
  findingFor,
  hasHighRiskPlaque,
  HRP_FEATURES,
  PLAQUE_TYPES,
  reportText,
  SEGMENT_VIEWS,
  SEGMENTS,
  segmentsFor,
  STENOSIS_GRADES,
} from '../utils/cadrads';

// Schematic coronary tree, drawn as on an angiographic diagram: patient's
// right on the viewer's left. viewBox 0 0 320 252.
const MAP = {
  pRCA: { d: 'M 133,70 C 110,72 92,84 84,104', label: [80, 84, 'end'] },
  mRCA: { d: 'M 84,104 C 76,128 76,152 86,174', label: [70, 142, 'end'] },
  dRCA: { d: 'M 86,174 C 96,196 118,208 140,210', label: [94, 208, 'end'] },
  'R-PDA': { d: 'M 140,210 C 150,220 158,230 164,242', label: [170, 244, 'start'], text: 'PDA' },
  'R-PLB': { d: 'M 140,210 C 158,204 176,204 192,212', label: [196, 208, 'start'], text: 'PLB' },
  LM: { d: 'M 167,66 L 190,66', label: [178, 56, 'middle'], width: 9 },
  pLAD: { d: 'M 190,66 C 197,76 200,88 200,100', label: [190, 92, 'end'] },
  mLAD: { d: 'M 200,100 C 203,118 205,134 204,150', label: [195, 130, 'end'] },
  dLAD: { d: 'M 204,150 C 204,174 201,196 194,216', label: [194, 190, 'end'] },
  D1: { d: 'M 199,92 C 212,98 224,110 232,124', label: [236, 132, 'start'] },
  D2: { d: 'M 203,132 C 216,140 228,154 236,168', label: [240, 176, 'start'] },
  RI: { d: 'M 190,66 C 208,68 228,78 244,92', label: [248, 98, 'start'] },
  pCx: { d: 'M 190,66 C 206,52 230,44 252,48', label: [220, 38, 'middle'] },
  OM1: { d: 'M 252,48 C 262,66 266,86 262,108', label: [262, 122, 'middle'] },
  LCx: { d: 'M 252,48 C 282,50 300,80 302,116', label: [292, 60, 'start'] },
  OM2: { d: 'M 302,116 C 296,134 286,148 272,158', label: [268, 170, 'middle'] },
  'L-PLB': { d: 'M 302,116 C 308,142 302,168 290,188', label: [310, 160, 'start'], text: 'PLB' },
  'L-PDA': { d: 'M 290,188 C 280,208 262,222 242,230', label: [240, 244, 'end'], text: 'PDA' },
};

// Branches first, so the main vessels win where tap targets overlap.
const DRAW_ORDER = ['R-PDA', 'R-PLB', 'D1', 'D2', 'RI', 'OM1', 'OM2', 'L-PLB', 'L-PDA',
  'dRCA', 'mRCA', 'pRCA', 'dLAD', 'mLAD', 'pLAD', 'LCx', 'pCx', 'LM'];

function CoronaryMap({ report, selected, onSelect }) {
  const active = useMemo(() => new Set(segmentsFor(report.dominance).map((s) => s.id)), [report.dominance]);
  const ids = DRAW_ORDER.filter((id) => active.has(id));

  return (
    <svg className="coronary-map" viewBox="0 0 320 252" role="group" aria-label="Coronary segment map">
      <text x="8" y="16" className="coronary-map__side">R</text>
      <text x="312" y="16" textAnchor="end" className="coronary-map__side">L</text>
      <circle cx="150" cy="66" r="17" className="coronary-map__aorta" />
      <text x="150" y="69.5" textAnchor="middle" className="coronary-map__aorta-label">Ao</text>

      {ids.map((id) => {
        const finding = findingFor(report, id);
        const shape = MAP[id];
        const width = shape.width || 7;
        const color = findingColor(finding);
        return (
          <g key={id}>
            {selected === id && (
              <path d={shape.d} className="coronary-map__halo" strokeWidth={width + 7} />
            )}
            {finding.suggestion && (
              <path d={shape.d} className="coronary-map__suggested" strokeWidth={width + 7} />
            )}
            <path
              d={shape.d}
              className="coronary-map__segment"
              stroke={color}
              strokeWidth={width}
              strokeDasharray={finding.nondiagnostic ? '3 5' : undefined}
            />
            {finding.stent && <path d={shape.d} className="coronary-map__stent" />}
          </g>
        );
      })}

      {ids.map((id) => {
        const [x, y, anchor] = MAP[id].label;
        const segment = SEGMENTS.find((s) => s.id === id);
        return (
          <text
            key={id}
            x={x}
            y={y}
            textAnchor={anchor}
            className={`coronary-map__label ${selected === id ? 'coronary-map__label--selected' : ''}`}
          >
            {report.pins[id] ? '◆ ' : ''}{MAP[id].text || segment.short}
          </text>
        );
      })}

      {ids.map((id) => (
        <path
          key={id}
          d={MAP[id].d}
          className="coronary-map__hit"
          role="button"
          aria-label={SEGMENTS.find((s) => s.id === id).name}
          onClick={() => onSelect(id)}
        />
      ))}
    </svg>
  );
}

function Chips({ options, value, onPick, colored }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`chip ${value === o.id ? 'chip--on' : ''}`}
          style={colored && value === o.id ? { borderColor: o.color, color: o.color } : undefined}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SegmentEditor({
  segment, report, onFinding, hasModel, pinning, onStartPin, onCancelPin, onRemovePin, onFlyToView, onFlyToPin,
}) {
  const finding = findingFor(report, segment.id);
  const pinned = !!report.pins[segment.id];
  const suggestion = finding.suggestion;
  const suggestedGrade = suggestion && STENOSIS_GRADES.find((g) => g.id === suggestion.grade);

  return (
    <div className="segment-editor">
      <div className="segment-editor__title">
        <span className="segment-editor__dot" style={{ background: findingColor(finding) }} />
        {segment.name}
        <span className="segment-editor__number">segment {segment.n}</span>
      </div>

      {suggestion && (
        <div className="suggestion">
          <div>
            <strong>Video estimate, unverified:</strong>{' '}
            {suggestion.unresolved
              ? 'lumen not resolved — severe stenosis or occlusion'
              : `${suggestedGrade.label}${suggestion.percent != null ? ` (about ${suggestion.percent}%)` : ''}`}
            {suggestion.positionMm != null ? `, ${Math.round(suggestion.positionMm)} mm along the traced vessel` : ''}
            {suggestion.calcified ? ', calcium nearby' : ''}. Check against the source CCTA.
          </div>
          <div className="suggestion__actions">
            <button type="button" className="chip chip--on"
              onClick={() => onFinding(segment.id, { grade: suggestion.grade, suggestion: null })}>
              Use {suggestedGrade.label}
            </button>
            <button type="button" className="chip" onClick={() => onFinding(segment.id, { suggestion: null })}>
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="field-label">Stenosis</div>
      <Chips options={STENOSIS_GRADES} value={finding.nondiagnostic ? null : finding.grade} colored
        onPick={(grade) => onFinding(segment.id, { grade, nondiagnostic: false })} />

      <div className="field-label">Plaque</div>
      <Chips options={PLAQUE_TYPES} value={finding.plaque} onPick={(plaque) => onFinding(segment.id, { plaque })} />

      <div className="field-label">
        High-risk features
        <span className="field-label__note">
          {hasHighRiskPlaque(finding) ? 'HRP: two or more present' : 'HRP needs two or more'}
        </span>
      </div>
      <div className="chips">
        {HRP_FEATURES.map((f) => (
          <button key={f.id} type="button" className={`chip ${finding.hrp[f.id] ? 'chip--on' : ''}`}
            aria-pressed={!!finding.hrp[f.id]}
            onClick={() => onFinding(segment.id, { hrp: { ...finding.hrp, [f.id]: !finding.hrp[f.id] } })}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="chips chips--spaced">
        <button type="button" className={`chip ${finding.stent ? 'chip--on' : ''}`} aria-pressed={finding.stent}
          onClick={() => onFinding(segment.id, { stent: !finding.stent })}>
          Stent
        </button>
        <button type="button" className={`chip ${finding.nondiagnostic ? 'chip--on' : ''}`}
          aria-pressed={finding.nondiagnostic}
          onClick={() => onFinding(segment.id, { nondiagnostic: !finding.nondiagnostic })}>
          Non-diagnostic
        </button>
      </div>

      <div className="field-label">
        3D view
        <span className="field-label__note">typical working projections</span>
      </div>
      <div className="chips">
        {SEGMENT_VIEWS[segment.id].map((view) => (
          <button key={view.name} type="button" className="chip chip--view" disabled={!hasModel}
            onClick={() => onFlyToView(segment.id, view)}>
            {view.name}{view.hint ? ` (${view.hint})` : ''}
          </button>
        ))}
      </div>
      <div className="chips">
        {pinning ? (
          <button type="button" className="chip chip--on" onClick={onCancelPin}>
            Tap the model… (cancel)
          </button>
        ) : pinned ? (
          <>
            <button type="button" className="chip chip--view" onClick={() => onFlyToPin(segment.id)}>◆ Go to pinned view</button>
            <button type="button" className="chip" onClick={() => onStartPin(segment.id)}>Re-pin</button>
            <button type="button" className="chip" onClick={() => onRemovePin(segment.id)}>Unpin</button>
          </>
        ) : (
          <button type="button" className="chip" disabled={!hasModel} onClick={() => onStartPin(segment.id)}>
            ◆ Pin to model
          </button>
        )}
      </div>
      {!hasModel && <div className="hint">Load a model to use the 3D views and pins.</div>}
      {hasModel && !pinned && !pinning && (
        <div className="hint">
          Pinning marks this segment on the model and remembers the view you are looking from.
        </div>
      )}
    </div>
  );
}

function ReportPanel({
  open, onClose, report, onChange, selected, onSelect, hasModel, estimated, notes,
  pinningSegment, onStartPin, onCancelPin, onRemovePin, onFlyToView, onFlyToPin, onImportFile, onClear,
}) {
  const [tab, setTab] = useState('map');
  const [copied, setCopied] = useState(false);
  const fileInput = useRef(null);
  const result = useMemo(() => classify(report), [report]);
  const text = useMemo(() => reportText(report), [report]);
  const segment = SEGMENTS.find((s) => s.id === selected);
  const pending = segmentsFor(report.dominance).filter((s) => report.segments[s.id]?.suggestion);

  const setFinding = (id, patch) => onChange((r) => ({
    ...r,
    segments: { ...r.segments, [id]: { ...findingFor(r, id), ...patch } },
  }));
  const set = (patch) => onChange((r) => ({ ...r, ...patch }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be refused (permissions, insecure origin).
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`report-panel glass-panel ${open ? 'report-panel--open' : ''}`} aria-hidden={!open}>
      <div className="report-panel__header">
        <div className="report-panel__badge" title={result.meaning}>{result.label}</div>
        <div className="report-panel__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'map'}
            className={`report-tab ${tab === 'map' ? 'report-tab--on' : ''}`} onClick={() => setTab('map')}>
            Map
          </button>
          <button type="button" role="tab" aria-selected={tab === 'report'}
            className={`report-tab ${tab === 'report' ? 'report-tab--on' : ''}`} onClick={() => setTab('report')}>
            Report
          </button>
        </div>
        <button type="button" className="report-panel__close" aria-label="Close report" onClick={onClose}>✕</button>
      </div>

      <div className="report-panel__body">
        {tab === 'map' && (
          <>
            <div className="report-panel__meaning">{result.meaning}</div>
            {estimated && (
              <div className="notice">
                This model was reconstructed from a video. Its shape and scale are estimates;
                grade stenosis from the source CCTA.
              </div>
            )}
            {notes.map((note) => <div key={note} className="notice">{note}</div>)}
            {pending.length > 0 && (
              <div className="notice notice--action">
                {pending.length} unverified video estimate{pending.length > 1 ? 's' : ''}:{' '}
                {pending.map((s, i) => (
                  <button key={s.id} type="button" className="link" onClick={() => onSelect(s.id)}>
                    {s.short}{i < pending.length - 1 ? ', ' : ''}
                  </button>
                ))}
              </div>
            )}

            <CoronaryMap report={report} selected={selected} onSelect={onSelect} />
            <div className="legend">
              {STENOSIS_GRADES.map((g) => (
                <span key={g.id}><i style={{ background: g.color }} />{g.label}</span>
              ))}
            </div>

            {segment ? (
              <SegmentEditor
                segment={segment}
                report={report}
                onFinding={setFinding}
                hasModel={hasModel}
                pinning={pinningSegment === segment.id}
                onStartPin={onStartPin}
                onCancelPin={onCancelPin}
                onRemovePin={onRemovePin}
                onFlyToView={onFlyToView}
                onFlyToPin={onFlyToPin}
              />
            ) : (
              <div className="hint hint--center">Tap a segment to enter its findings.</div>
            )}

            <div className="field-label">Dominance</div>
            <Chips options={DOMINANCE} value={report.dominance} onPick={(dominance) => set({ dominance })} />

            <div className="field-label">
              Plaque burden
              <span className="field-label__note">
                {result.sis ? `segment involvement score ${result.sis}` : 'no plaque entered'}
              </span>
            </div>
            <Chips
              options={[
                { id: 0, label: result.plaqueBurdenFromSis ? `Auto (P${result.plaqueBurdenFromSis})` : 'Auto' },
                ...[1, 2, 3, 4].map((p) => ({ id: p, label: `P${p}` })),
              ]}
              value={report.plaqueBurden || 0}
              onPick={(p) => set({ plaqueBurden: p || null })}
            />

            <div className="field-label">
              Ischemia testing
              <span className="field-label__note">CT-FFR or CT perfusion</span>
            </div>
            <Chips
              options={[
                { id: 'none', label: 'Not done' }, { id: '+', label: 'I+' },
                { id: '-', label: 'I−' }, { id: '±', label: 'I±' },
              ]}
              value={report.ischemia || 'none'}
              onPick={(i) => set({ ischemia: i === 'none' ? null : i })}
            />

            <div className="chips chips--spaced">
              <button type="button" className={`chip ${report.grafts ? 'chip--on' : ''}`} aria-pressed={report.grafts}
                onClick={() => set({ grafts: !report.grafts })}>
                Bypass grafts (G)
              </button>
              <button type="button" className={`chip ${report.exception ? 'chip--on' : ''}`}
                aria-pressed={report.exception} onClick={() => set({ exception: !report.exception })}>
                Exception (E)
              </button>
            </div>
          </>
        )}

        {tab === 'report' && (
          <>
            <pre className="report-text">{text}</pre>
            <div className="chips">
              <button type="button" className="chip chip--on" onClick={copy}>{copied ? 'Copied' : 'Copy text'}</button>
              <button type="button" className="chip"
                onClick={() => download('coronary-cta-report.txt', text, 'text/plain')}>
                Download .txt
              </button>
              <button type="button" className="chip"
                onClick={() => download('coronary-cta-report.json',
                  JSON.stringify({ ...report, pins: {} }, null, 1), 'application/json')}>
                Export JSON
              </button>
            </div>
            <div className="field-label">Import</div>
            <div className="chips">
              <button type="button" className="chip" onClick={() => fileInput.current.click()}>
                Import findings or report…
              </button>
              <button type="button" className="chip chip--danger" onClick={onClear}>Clear report</button>
            </div>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden
              onChange={(e) => {
                if (e.target.files[0]) onImportFile(e.target.files[0]);
                e.target.value = '';
              }} />
            <div className="hint">
              Import a report exported here, or a findings file from <code>tools/video2stl</code>.
              Video findings arrive as unverified suggestions and do not change the classification
              until you accept them.
            </div>
          </>
        )}

        <div className="report-panel__footer">
          Findings are entered by you from the source CCTA and classified per CAD-RADS 2.0.
          CathVision does not measure stenosis and is not a diagnostic device.
        </div>
      </div>
    </div>
  );
}

export default memo(ReportPanel);
