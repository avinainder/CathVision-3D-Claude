/**
 * CAD-RADS 2.0 structured reporting for coronary CTA.
 *
 * Reference: Cury RC et al., "CAD-RADS 2.0 - 2022 Coronary Artery
 * Disease-Reporting and Data System", JACC Cardiovasc Imaging 2022.
 *
 * Everything here is bookkeeping over findings the reader enters from the
 * source CCTA. Nothing in this file looks at the 3D mesh: a surface model is
 * a thresholded rendering and cannot support stenosis grading.
 */

export const STENOSIS_GRADES = [
  { id: '0', label: '0%', name: 'none', color: '#6b7689' },
  { id: '1-24', label: '1–24%', name: 'minimal', color: '#5fbf8f' },
  { id: '25-49', label: '25–49%', name: 'mild', color: '#e6c84f' },
  { id: '50-69', label: '50–69%', name: 'moderate', color: '#f2994a' },
  { id: '70-99', label: '70–99%', name: 'severe', color: '#eb5757' },
  { id: '100', label: '100%', name: 'occluded', color: '#b05cff' },
];
export const NONDIAGNOSTIC_COLOR = '#8f93a3';

const GRADE_RANK = Object.fromEntries(STENOSIS_GRADES.map((g, i) => [g.id, i]));
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export const PLAQUE_TYPES = [
  { id: 'none', label: 'None' },
  { id: 'calcified', label: 'Calcified' },
  { id: 'noncalcified', label: 'Non-calcified' },
  { id: 'mixed', label: 'Mixed' },
];

// High-risk plaque needs two or more of these in the same plaque.
export const HRP_FEATURES = [
  { id: 'lowAttenuation', label: 'Low attenuation' },
  { id: 'positiveRemodeling', label: 'Positive remodeling' },
  { id: 'spottyCalcification', label: 'Spotty calcification' },
  { id: 'napkinRing', label: 'Napkin-ring sign' },
];

// SCCT 18-segment model. `dominance` lists the patterns in which the segment
// exists; segments without it exist in all.
export const SEGMENTS = [
  { id: 'pRCA', n: 1, name: 'Proximal RCA', short: 'pRCA', vessel: 'RCA' },
  { id: 'mRCA', n: 2, name: 'Mid RCA', short: 'mRCA', vessel: 'RCA' },
  { id: 'dRCA', n: 3, name: 'Distal RCA', short: 'dRCA', vessel: 'RCA' },
  { id: 'R-PDA', n: 4, name: 'PDA (from RCA)', short: 'R-PDA', vessel: 'RCA', dominance: ['right', 'co'] },
  { id: 'R-PLB', n: 16, name: 'Posterolateral branch (from RCA)', short: 'R-PLB', vessel: 'RCA', dominance: ['right'] },
  { id: 'LM', n: 5, name: 'Left main', short: 'LM', vessel: 'LM' },
  { id: 'pLAD', n: 6, name: 'Proximal LAD', short: 'pLAD', vessel: 'LAD' },
  { id: 'mLAD', n: 7, name: 'Mid LAD', short: 'mLAD', vessel: 'LAD' },
  { id: 'dLAD', n: 8, name: 'Distal LAD', short: 'dLAD', vessel: 'LAD' },
  { id: 'D1', n: 9, name: 'First diagonal', short: 'D1', vessel: 'LAD' },
  { id: 'D2', n: 10, name: 'Second diagonal', short: 'D2', vessel: 'LAD' },
  { id: 'RI', n: 17, name: 'Ramus intermedius', short: 'RI', vessel: 'LCx' },
  { id: 'pCx', n: 11, name: 'Proximal LCx', short: 'pCx', vessel: 'LCx' },
  { id: 'OM1', n: 12, name: 'First obtuse marginal', short: 'OM1', vessel: 'LCx' },
  { id: 'LCx', n: 13, name: 'Mid and distal LCx', short: 'dCx', vessel: 'LCx' },
  { id: 'OM2', n: 14, name: 'Second obtuse marginal', short: 'OM2', vessel: 'LCx' },
  { id: 'L-PLB', n: 18, name: 'Posterolateral branch (from LCx)', short: 'L-PLB', vessel: 'LCx', dominance: ['left', 'co'] },
  { id: 'L-PDA', n: 15, name: 'PDA (from LCx)', short: 'L-PDA', vessel: 'LCx', dominance: ['left'] },
];

export const VESSELS = [
  { id: 'RCA', name: 'Right coronary artery' },
  { id: 'LM', name: 'Left main' },
  { id: 'LAD', name: 'Left anterior descending' },
  { id: 'LCx', name: 'Left circumflex' },
];

const SEGMENT_BY_ID = Object.fromEntries(SEGMENTS.map((s) => [s.id, s]));

export const DOMINANCE = [
  { id: 'right', label: 'Right' },
  { id: 'left', label: 'Left' },
  { id: 'co', label: 'Co-dominant' },
];

const CATEGORY_MEANING = {
  0: 'No plaque or stenosis',
  1: 'Minimal non-obstructive coronary artery disease',
  2: 'Mild non-obstructive coronary artery disease',
  3: 'Moderate stenosis',
  '4A': 'Severe stenosis',
  '4B': 'Left main ≥50% or three-vessel obstructive (≥70%) disease',
  5: 'Total coronary occlusion',
  N: 'Non-diagnostic study: obstructive disease cannot be excluded',
};

const PLAQUE_BURDEN_NAME = { 1: 'mild', 2: 'moderate', 3: 'severe', 4: 'extensive' };

export function emptyFinding() {
  return {
    grade: '0',
    plaque: 'none',
    stent: false,
    nondiagnostic: false,
    hrp: {},
    suggestion: null,
  };
}

export function emptyReport() {
  return {
    version: 1,
    dominance: 'right',
    segments: {},       // id -> finding (absent = no plaque or stenosis)
    plaqueBurden: null, // null = from segment involvement score; else 1-4
    ischemia: null,     // null | '+' | '-' | '±'
    grafts: false,
    exception: false,
    pins: {},           // id -> { local: [x,y,z], view: {theta, phi, radius, target}, flipped }
  };
}

function isEmptyFinding(finding) {
  return !finding || (finding.grade === '0' && finding.plaque === 'none' && !finding.stent
    && !finding.nondiagnostic && !hasHrpFeature(finding) && !finding.suggestion);
}

/**
 * Does the report say anything yet? Segments that were touched and set back
 * to normal do not count; a changed dominance or modifier does.
 */
export function isEmptyReport(report) {
  return Object.values(report.segments).every(isEmptyFinding)
    && Object.keys(report.pins).length === 0
    && report.dominance === 'right' && !report.plaqueBurden && !report.ischemia
    && !report.grafts && !report.exception;
}

export function segmentsFor(dominance) {
  return SEGMENTS.filter((s) => !s.dominance || s.dominance.includes(dominance));
}

export function findingFor(report, segmentId) {
  return { ...emptyFinding(), ...(report.segments[segmentId] || {}) };
}

/** Display colour for a segment's finding. */
export function findingColor(finding) {
  if (finding.nondiagnostic) return NONDIAGNOSTIC_COLOR;
  return STENOSIS_GRADES[GRADE_RANK[finding.grade]].color;
}

export function hasHighRiskPlaque(finding) {
  return HRP_FEATURES.filter((f) => finding.hrp?.[f.id]).length >= 2;
}

function hasHrpFeature(finding) {
  return HRP_FEATURES.some((f) => finding.hrp?.[f.id]);
}

// A stenosis grade, a plaque type or a high-risk feature each mean plaque is
// there. A non-diagnostic segment has no grade to go by, so only what the
// reader explicitly marked counts.
function hasPlaque(finding) {
  const marked = finding.plaque !== 'none' || hasHrpFeature(finding);
  return finding.nondiagnostic ? marked : marked || GRADE_RANK[finding.grade] > 0;
}

// The posterior descending and posterolateral branches come off the RCA or
// the LCx depending on dominance; each is one segment under two names.
const POSTERIOR_BRANCHES = [
  { right: 'R-PDA', co: 'R-PDA', left: 'L-PDA' },
  { right: 'R-PLB', co: 'L-PLB', left: 'L-PLB' },
];

/** The id a segment goes by under a dominance pattern. */
export function segmentUnderDominance(segmentId, dominance) {
  const branch = POSTERIOR_BRANCHES.find((b) => Object.values(b).includes(segmentId));
  return branch ? branch[dominance] : segmentId;
}

/**
 * Change dominance, carrying PDA/PLB findings and pins over to the segment
 * that branch becomes. Without this a graded lesion would vanish from the
 * classification the moment dominance changed.
 */
export function withDominance(report, dominance) {
  const segments = { ...report.segments };
  const pins = { ...report.pins };
  for (const branch of POSTERIOR_BRANCHES) {
    const to = branch[dominance];
    for (const from of new Set(Object.values(branch))) {
      if (from === to) continue;
      // If both names somehow hold something, the one that says something wins.
      if (segments[from] && isEmptyFinding(segments[to])) segments[to] = segments[from];
      if (pins[from] && !pins[to]) pins[to] = pins[from];
      delete segments[from];
      delete pins[from];
    }
  }
  return { ...report, dominance, segments, pins };
}

function isAbnormal(finding) {
  return hasPlaque(finding) || finding.stent || finding.nondiagnostic;
}

/**
 * Derive the CAD-RADS classification from a report.
 *
 * Returns { category, plaqueBurden, sis, modifiers, label, meaning }.
 */
export function classify(report) {
  const active = segmentsFor(report.dominance).map((s) => ({ ...s, f: findingFor(report, s.id) }));
  // A non-diagnostic segment contributes no stenosis grade.
  const graded = active.filter((s) => !s.f.nondiagnostic);
  const rank = (s) => GRADE_RANK[s.f.grade];
  const worst = Math.max(0, ...graded.map(rank));
  const worstIn = (vessel) => Math.max(0, ...graded.filter((s) => s.vessel === vessel).map(rank));
  const SEVERE = GRADE_RANK['70-99'];
  const MODERATE = GRADE_RANK['50-69'];

  let category;
  if (worst === GRADE_RANK['100']) category = '5';
  else if (worstIn('LM') >= MODERATE || ['RCA', 'LAD', 'LCx'].every((v) => worstIn(v) >= SEVERE)) category = '4B';
  else if (worst >= SEVERE) category = '4A';
  else if (worst === MODERATE) category = '3';
  else if (worst === GRADE_RANK['25-49']) category = '2';
  // Plaque without measurable stenosis is still CAD-RADS 1.
  else if (worst === GRADE_RANK['1-24'] || graded.some((s) => hasPlaque(s.f))) category = '1';
  // A stent alone stays 0/S: the consensus document grades by stenosis and
  // sets no floor for a patent stent.
  else category = '0';

  const sis = active.filter((s) => hasPlaque(s.f)).length;
  const fromSis = sis === 0 ? null : sis <= 2 ? 1 : sis <= 4 ? 2 : sis <= 7 ? 3 : 4;
  // No plaque-burden score without plaque; a reader override can only apply to plaque.
  const plaqueBurden = sis === 0 ? null : report.plaqueBurden || fromSis;

  const nondiagnostic = active.some((s) => s.f.nondiagnostic);
  // With no stenosis of 50% or more elsewhere, a non-diagnostic segment makes
  // the whole study N; otherwise the stenosis category stands and N is added.
  const studyNondiagnostic = nondiagnostic && worst < MODERATE;
  if (studyNondiagnostic) category = 'N';

  const modifiers = [];
  if (nondiagnostic && !studyNondiagnostic) modifiers.push('N');
  if (active.some((s) => hasHighRiskPlaque(s.f))) modifiers.push('HRP');
  if (report.ischemia) modifiers.push(`I${report.ischemia}`);
  if (active.some((s) => s.f.stent)) modifiers.push('S');
  if (report.grafts) modifiers.push('G');
  if (report.exception) modifiers.push('E');

  const parts = [category];
  if (plaqueBurden) parts.push(`P${plaqueBurden}`);
  const label = `CAD-RADS ${[...parts, ...modifiers].join('/')}`;

  return {
    category,
    plaqueBurden,
    plaqueBurdenFromSis: fromSis,
    sis,
    modifiers,
    label,
    meaning: CATEGORY_MEANING[category],
  };
}

function describeFinding(segment, finding) {
  const bits = [];
  if (finding.nondiagnostic) {
    bits.push('non-diagnostic');
  } else {
    const grade = STENOSIS_GRADES[GRADE_RANK[finding.grade]];
    if (finding.grade === '100') bits.push('total occlusion');
    else if (finding.grade === '0') bits.push(hasPlaque(finding) ? 'plaque without stenosis' : 'no stenosis');
    else bits.push(`${grade.label} (${grade.name}) stenosis`);
  }
  if (finding.plaque !== 'none') {
    bits.push(`${PLAQUE_TYPES.find((p) => p.id === finding.plaque).label.toLowerCase()} plaque`);
  }
  if (hasHighRiskPlaque(finding)) {
    const features = HRP_FEATURES.filter((f) => finding.hrp[f.id]).map((f) => f.label.toLowerCase());
    bits.push(`high-risk features (${features.join(', ')})`);
  }
  if (finding.stent) bits.push('stent');
  return `${segment.name}: ${bits.join(', ')}.`;
}

/** Plain-text structured report. Contains no patient or file identifiers. */
export function reportText(report) {
  const result = classify(report);
  const active = segmentsFor(report.dominance);
  const lines = ['CORONARY CTA - STRUCTURED FINDINGS', ''];
  lines.push(`Dominance: ${DOMINANCE.find((d) => d.id === report.dominance).label.toLowerCase()}.`, '');

  for (const vessel of VESSELS) {
    const segments = active.filter((s) => s.vessel === vessel.id);
    const abnormal = segments.filter((s) => isAbnormal(findingFor(report, s.id)));
    lines.push(`${vessel.name} (${vessel.id}):`);
    if (abnormal.length === 0) {
      lines.push('  No plaque or stenosis.');
    } else {
      for (const s of abnormal) lines.push(`  ${describeFinding(s, findingFor(report, s.id))}`);
      if (abnormal.length < segments.length) lines.push('  Remaining segments: no plaque or stenosis.');
    }
  }

  lines.push('', 'IMPRESSION', `${result.label} - ${result.meaning}.`);
  if (result.plaqueBurden) {
    const source = report.plaqueBurden ? 'reader assessment' : `segment involvement score ${result.sis}`;
    lines.push(`Plaque burden: P${result.plaqueBurden} (${PLAQUE_BURDEN_NAME[result.plaqueBurden]}; ${source}).`);
  }
  const notes = [];
  if (result.modifiers.includes('HRP')) notes.push('high-risk plaque present');
  if (report.ischemia === '+') notes.push('lesion-specific ischemia present (CT-FFR or CT perfusion)');
  if (report.ischemia === '-') notes.push('no lesion-specific ischemia (CT-FFR or CT perfusion)');
  if (report.ischemia === '±') notes.push('borderline ischemia testing');
  if (result.modifiers.includes('S')) notes.push('coronary stent present');
  if (report.grafts) notes.push('coronary bypass graft(s) present');
  if (report.exception) notes.push('non-atherosclerotic finding present (exception modifier), described separately');
  if (notes.length) lines.push(`Modifiers: ${notes.join('; ')}.`);

  lines.push('', 'Findings were entered by the reader from the source CCTA and classified per CAD-RADS 2.0.');
  return lines.join('\n');
}

/**
 * Typical angiographic working views per segment, as preset angles
 * (rao > 0 = RAO, rao < 0 = LAO; cra > 0 = cranial, cra < 0 = caudal).
 * Starting points only: the best projection depends on the patient.
 */
const VIEW = {
  spider: { name: 'LAO 45 CAU 30', rao: -45, cra: -30, hint: 'spider' },
  apCaudal: { name: 'AP CAU 25', rao: 0, cra: -25 },
  raoCaudal: { name: 'RAO 20 CAU 20', rao: 20, cra: -20 },
  apCranial: { name: 'AP CRA 35', rao: 0, cra: 35 },
  raoCranial: { name: 'RAO 10 CRA 38', rao: 10, cra: 38 },
  laoCranial: { name: 'LAO 45 CRA 28', rao: -45, cra: 28 },
  lao: { name: 'LAO 30', rao: -30, cra: 0 },
  rao: { name: 'RAO 30', rao: 30, cra: 0 },
  laoCranialRca: { name: 'LAO 30 CRA 20', rao: -30, cra: 20 },
  apCranialRca: { name: 'AP CRA 25', rao: 0, cra: 25 },
};

export const SEGMENT_VIEWS = {
  pRCA: [VIEW.lao, VIEW.rao],
  mRCA: [VIEW.lao, VIEW.rao],
  dRCA: [VIEW.laoCranialRca, VIEW.apCranialRca],
  'R-PDA': [VIEW.apCranialRca, VIEW.laoCranialRca],
  'R-PLB': [VIEW.laoCranialRca, VIEW.apCranialRca],
  LM: [VIEW.spider, VIEW.apCaudal],
  pLAD: [VIEW.raoCranial, VIEW.laoCranial],
  mLAD: [VIEW.raoCranial, VIEW.laoCranial],
  dLAD: [VIEW.apCranial, VIEW.raoCranial],
  D1: [VIEW.laoCranial, VIEW.raoCranial],
  D2: [VIEW.laoCranial, VIEW.raoCranial],
  RI: [VIEW.spider, VIEW.raoCaudal],
  pCx: [VIEW.raoCaudal, VIEW.spider],
  OM1: [VIEW.raoCaudal, VIEW.apCaudal],
  LCx: [VIEW.raoCaudal, VIEW.apCaudal],
  OM2: [VIEW.raoCaudal, VIEW.apCaudal],
  'L-PLB': [VIEW.laoCranialRca, VIEW.apCranialRca],
  'L-PDA': [VIEW.laoCranialRca, VIEW.apCranialRca],
};

/**
 * Turn a tools/video2stl findings file into per-segment suggestions.
 * They are estimates from a compressed video, so they are attached as
 * suggestions for the reader to accept or discard, never applied as grades.
 * Returns { suggestions: {segmentId: suggestion}, warnings: string[] }.
 */
export function suggestionsFromVideoFindings(findings) {
  if (findings?.schema !== 'cathvision.video2stl.findings/v1') {
    throw new Error('Not a video2stl findings file');
  }
  // A lumen the video could not resolve has no grade, only a lower bound;
  // it outranks any graded lesion in the same segment, since it may be worse.
  // (short only of an occlusion).
  const weight = (s) => (s.unresolved ? GRADE_RANK['100'] - 0.5 : GRADE_RANK[s.grade]);
  const suggestions = {};
  for (const lesion of Array.isArray(findings.lesions) ? findings.lesions : []) {
    if (!lesion || typeof lesion !== 'object' || !SEGMENT_BY_ID[lesion.segment]) continue;
    const unresolved = lesion.unresolved === true;
    if (!unresolved && GRADE_RANK[lesion.grade] === undefined) continue;
    const suggestion = {
      source: 'video2stl',
      grade: unresolved ? null : lesion.grade,
      percent: !unresolved && isNumber(lesion.percent_stenosis) ? lesion.percent_stenosis : null,
      percentAtLeast: unresolved && isNumber(lesion.percent_at_least) ? lesion.percent_at_least : null,
      positionMm: isNumber(lesion.s_mm) ? lesion.s_mm : null,
      calcified: !!lesion.calcified,
      unresolved,
    };
    const current = suggestions[lesion.segment];
    if (!current || weight(suggestion) > weight(current)) suggestions[lesion.segment] = suggestion;
  }
  const warnings = Array.isArray(findings.warnings) ? findings.warnings.filter((w) => typeof w === 'string') : [];
  return { suggestions, warnings };
}

/** Is this a report exported from the panel? */
export function isReport(value) {
  return !!value && value.version === 1 && typeof value.segments === 'object' && typeof value.dominance === 'string';
}

const isVector = (v) => Array.isArray(v) && v.length === 3 && v.every(isNumber);

/**
 * Rebuild a report from parsed JSON, keeping only fields and values this
 * version understands. Imported and stored reports go through here, so a
 * damaged or hand-edited file degrades to defaults instead of breaking the UI.
 */
export function sanitizeReport(value) {
  const report = emptyReport();
  if (!value || typeof value !== 'object') return report;
  if (DOMINANCE.some((d) => d.id === value.dominance)) report.dominance = value.dominance;
  if ([1, 2, 3, 4].includes(value.plaqueBurden)) report.plaqueBurden = value.plaqueBurden;
  if (['+', '-', '±'].includes(value.ischemia)) report.ischemia = value.ischemia;
  report.grafts = value.grafts === true;
  report.exception = value.exception === true;

  for (const segment of SEGMENTS) {
    const raw = value.segments?.[segment.id];
    if (raw && typeof raw === 'object') {
      const finding = emptyFinding();
      if (GRADE_RANK[raw.grade] !== undefined) finding.grade = raw.grade;
      if (PLAQUE_TYPES.some((p) => p.id === raw.plaque)) finding.plaque = raw.plaque;
      finding.stent = raw.stent === true;
      finding.nondiagnostic = raw.nondiagnostic === true;
      for (const feature of HRP_FEATURES) {
        if (raw.hrp?.[feature.id] === true) finding.hrp[feature.id] = true;
      }
      const s = raw.suggestion;
      const unresolved = s?.unresolved === true;
      if (s && typeof s === 'object' && (unresolved || GRADE_RANK[s.grade] !== undefined)) {
        finding.suggestion = {
          source: 'video2stl',
          grade: unresolved ? null : s.grade,
          percent: !unresolved && isNumber(s.percent) ? s.percent : null,
          percentAtLeast: unresolved && isNumber(s.percentAtLeast) ? s.percentAtLeast : null,
          positionMm: isNumber(s.positionMm) ? s.positionMm : null,
          calcified: s.calcified === true,
          unresolved,
        };
      }
      report.segments[segment.id] = finding;
    }

    const pin = value.pins?.[segment.id];
    const view = pin?.view;
    if (pin && isVector(pin.local) && view && isVector(view.target)
        && isNumber(view.theta) && isNumber(view.phi) && isNumber(view.radius)) {
      report.pins[segment.id] = {
        local: [...pin.local],
        view: { theta: view.theta, phi: view.phi, radius: view.radius, target: [...view.target] },
        flipped: pin.flipped === true,
      };
    }
  }
  // Drop anything filed under a segment the dominance does not have.
  return withDominance(report, report.dominance);
}
