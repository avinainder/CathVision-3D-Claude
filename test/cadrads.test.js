import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  emptyReport,
  reportText,
  sanitizeReport,
  segmentsFor,
  segmentUnderDominance,
  suggestionsFromVideoFindings,
  SEGMENTS,
  SEGMENT_VIEWS,
  withDominance,
} from '../src/utils/cadrads.js';
import { computeAngles, presetToSpherical } from '../src/utils/carmAngles.js';

function reportWith(segments, extra = {}) {
  return { ...emptyReport(), segments, ...extra };
}

const grade = (g, more = {}) => ({ grade: g, plaque: 'none', stent: false, nondiagnostic: false, hrp: {}, ...more });

test('no findings is CAD-RADS 0 with no plaque-burden score', () => {
  const r = classify(emptyReport());
  assert.equal(r.label, 'CAD-RADS 0');
  assert.equal(r.plaqueBurden, null);
});

test('stenosis bands map to categories 1, 2, 3 and 4A', () => {
  assert.equal(classify(reportWith({ mLAD: grade('1-24') })).category, '1');
  assert.equal(classify(reportWith({ mLAD: grade('25-49') })).category, '2');
  assert.equal(classify(reportWith({ mLAD: grade('50-69') })).category, '3');
  assert.equal(classify(reportWith({ mLAD: grade('70-99') })).category, '4A');
});

test('plaque with no stenosis is CAD-RADS 1, not 0', () => {
  const r = classify(reportWith({ pRCA: grade('0', { plaque: 'calcified' }) }));
  assert.equal(r.label, 'CAD-RADS 1/P1');
});

test('left main 50% or more is 4B', () => {
  assert.equal(classify(reportWith({ LM: grade('50-69') })).category, '4B');
  assert.equal(classify(reportWith({ LM: grade('25-49') })).category, '2');
});

test('severe disease in two vessels is 4A; in all three it is 4B', () => {
  const two = reportWith({ pRCA: grade('70-99'), mLAD: grade('70-99') });
  assert.equal(classify(two).category, '4A');
  const three = reportWith({ pRCA: grade('70-99'), D1: grade('70-99'), OM1: grade('70-99') });
  assert.equal(classify(three).category, '4B');
});

test('occlusion outranks 4B', () => {
  const r = reportWith({ LM: grade('50-69'), dRCA: grade('100') });
  assert.equal(classify(r).category, '5');
});

test('dominance decides which vessel a posterior branch counts toward', () => {
  // A severe PDA lesion completes three-vessel disease through the RCA in
  // right dominance, but belongs to the LCx (already severe) in left dominance.
  const segments = { mLAD: grade('70-99'), OM1: grade('70-99'), 'R-PDA': grade('70-99'), 'L-PDA': grade('70-99') };
  assert.equal(classify(reportWith(segments, { dominance: 'right' })).category, '4B');
  assert.equal(classify(reportWith(segments, { dominance: 'left' })).category, '4A');
});

test('segments follow dominance', () => {
  const ids = (d) => segmentsFor(d).map((s) => s.id);
  assert.ok(ids('right').includes('R-PDA') && ids('right').includes('R-PLB'));
  assert.ok(!ids('right').includes('L-PDA') && !ids('right').includes('L-PLB'));
  assert.ok(ids('left').includes('L-PDA') && ids('left').includes('L-PLB') && !ids('left').includes('R-PDA'));
  assert.ok(ids('co').includes('R-PDA') && ids('co').includes('L-PLB') && !ids('co').includes('L-PDA'));
  assert.equal(new Set(SEGMENTS.map((s) => s.n)).size, 18);
});

test('plaque burden follows the segment involvement score', () => {
  const withPlaque = (n) => {
    const segments = {};
    for (const s of segmentsFor('right').slice(0, n)) segments[s.id] = grade('1-24');
    return classify(reportWith(segments));
  };
  assert.equal(withPlaque(1).plaqueBurden, 1);
  assert.equal(withPlaque(2).plaqueBurden, 1);
  assert.equal(withPlaque(3).plaqueBurden, 2);
  assert.equal(withPlaque(4).plaqueBurden, 2);
  assert.equal(withPlaque(5).plaqueBurden, 3);
  assert.equal(withPlaque(7).plaqueBurden, 3);
  assert.equal(withPlaque(8).plaqueBurden, 4);
});

test('a reader override sets plaque burden, but never without plaque', () => {
  assert.equal(classify(reportWith({ pRCA: grade('1-24') }, { plaqueBurden: 3 })).label, 'CAD-RADS 1/P3');
  assert.equal(classify(reportWith({}, { plaqueBurden: 3 })).label, 'CAD-RADS 0');
});

test('a non-diagnostic segment makes the study N unless stenosis is 50% or more elsewhere', () => {
  const mild = reportWith({ mRCA: grade('0', { nondiagnostic: true }), pLAD: grade('25-49') });
  assert.equal(classify(mild).label, 'CAD-RADS N/P1');
  const moderate = reportWith({ mRCA: grade('0', { nondiagnostic: true }), pLAD: grade('50-69') });
  assert.equal(classify(moderate).label, 'CAD-RADS 3/P1/N');
});

test('a non-diagnostic segment does not contribute its grade', () => {
  const r = reportWith({ mRCA: grade('70-99', { nondiagnostic: true }) });
  assert.equal(classify(r).category, 'N');
});

test('modifiers are listed in the order N, HRP, I, S, G, E', () => {
  const r = reportWith(
    {
      pLAD: grade('70-99', { plaque: 'noncalcified', hrp: { lowAttenuation: true, positiveRemodeling: true } }),
      mRCA: grade('0', { stent: true }),
      dRCA: grade('0', { nondiagnostic: true }),
    },
    { ischemia: '+', grafts: true, exception: true }
  );
  assert.equal(classify(r).label, 'CAD-RADS 4A/P1/N/HRP/I+/S/G/E');
});

test('high-risk plaque needs two features in the same segment', () => {
  const one = reportWith({ pLAD: grade('25-49', { hrp: { napkinRing: true } }) });
  assert.ok(!classify(one).modifiers.includes('HRP'));
  const split = reportWith({
    pLAD: grade('25-49', { hrp: { napkinRing: true } }),
    mLAD: grade('25-49', { hrp: { lowAttenuation: true } }),
  });
  assert.ok(!classify(split).modifiers.includes('HRP'));
  const two = reportWith({ pLAD: grade('25-49', { hrp: { napkinRing: true, spottyCalcification: true } }) });
  assert.ok(classify(two).modifiers.includes('HRP'));
});

test('a stent alone adds S without implying plaque', () => {
  assert.equal(classify(reportWith({ mLAD: grade('0', { stent: true }) })).label, 'CAD-RADS 0/S');
});

test('report text states findings, the classification and nothing identifying', () => {
  const text = reportText(reportWith({ pRCA: grade('25-49', { plaque: 'mixed' }), mLAD: grade('1-24') }));
  assert.match(text, /Proximal RCA: 25–49% \(mild\) stenosis, mixed plaque\./);
  assert.match(text, /Remaining segments: no plaque or stenosis\./);
  assert.match(text, /Left circumflex \(LCx\):\n {2}No plaque or stenosis\./);
  assert.match(text, /CAD-RADS 2\/P1 - Mild non-obstructive/);
  assert.match(text, /segment involvement score 2/);
});

test('every active segment has two working views that survive the angle round trip', () => {
  for (const segment of SEGMENTS) {
    const views = SEGMENT_VIEWS[segment.id];
    assert.equal(views?.length, 2, segment.id);
    for (const view of views) {
      const { theta, phi } = presetToSpherical(view.rao, view.cra);
      const camera = {
        x: 30 * Math.sin(phi) * Math.sin(theta),
        y: 30 * Math.cos(phi),
        z: 30 * Math.sin(phi) * Math.cos(theta),
      };
      const angles = computeAngles(camera, { x: 0, y: 0, z: 0 });
      // The name on the button must be what the HUD will read.
      const h = view.rao === 0 ? 'AP' : `${angles.horizontal.label} ${Math.round(angles.horizontal.value)}`;
      const v = view.cra === 0 ? '' : ` ${angles.vertical.label} ${Math.round(angles.vertical.value)}`;
      assert.equal(`${h}${v}`, view.name, segment.id);
    }
  }
});

test('video findings become suggestions, keeping the worst lesion per segment', () => {
  const { suggestions, warnings } = suggestionsFromVideoFindings({
    schema: 'cathvision.video2stl.findings/v1',
    warnings: ['trace reconnected'],
    lesions: [
      { segment: 'pRCA', grade: '25-49', percent_stenosis: 29, s_mm: 36.4, calcified: true, unresolved: false },
      { segment: 'pRCA', grade: '1-24', percent_stenosis: 18, s_mm: 12, calcified: false, unresolved: false },
      { segment: 'mRCA', grade: '70-99', percent_stenosis: 72, s_mm: 55, calcified: false, unresolved: false },
      { segment: 'mRCA', grade: null, percent_stenosis: null, percent_at_least: 40, s_mm: 61, unresolved: true },
      { segment: 'nonsense', grade: '70-99', percent_stenosis: 80, s_mm: 5 },
    ],
  });
  assert.deepEqual(Object.keys(suggestions).sort(), ['mRCA', 'pRCA']);
  assert.equal(suggestions.pRCA.percent, 29);
  // An unresolved lumen has no grade, only a lower bound, and outranks a graded lesion.
  assert.ok(suggestions.mRCA.unresolved);
  assert.equal(suggestions.mRCA.grade, null);
  assert.equal(suggestions.mRCA.percent, null);
  assert.equal(suggestions.mRCA.percentAtLeast, 40);
  assert.deepEqual(warnings, ['trace reconnected']);
  assert.throws(() => suggestionsFromVideoFindings({ schema: 'something else' }));
});

test('an unresolved suggestion survives storage with no grade', () => {
  const stored = sanitizeReport({
    version: 1,
    dominance: 'right',
    segments: { mRCA: { grade: '0', suggestion: { unresolved: true, grade: null, percentAtLeast: 40, positionMm: 61 } } },
  });
  assert.deepEqual(stored.segments.mRCA.suggestion, {
    source: 'video2stl', grade: null, percent: null, percentAtLeast: 40, positionMm: 61, calcified: false, unresolved: true,
  });
  assert.equal(classify(stored).label, 'CAD-RADS 0');
});

test('a suggestion never changes the classification until it is accepted', () => {
  const r = reportWith({ pRCA: grade('0', { suggestion: { source: 'video2stl', grade: '70-99' } }) });
  assert.equal(classify(r).label, 'CAD-RADS 0');
});

test('sanitizeReport keeps valid content and drops everything else', () => {
  const clean = sanitizeReport({
    version: 1,
    dominance: 'sideways',
    plaqueBurden: 9,
    ischemia: '+',
    grafts: 'yes',
    segments: {
      pRCA: { grade: '25-49', plaque: 'mixed', stent: true, hrp: { napkinRing: true, bogus: true } },
      mLAD: { grade: 'huge', plaque: 42 },
      notASegment: { grade: '100' },
    },
    pins: {
      pRCA: { local: [1, 2, 3], view: { theta: 0.5, phi: 1.2, radius: 30, target: [0, 0, 0] }, flipped: true },
      mLAD: { local: [1, 'x', 3], view: {} },
    },
  });
  assert.equal(clean.dominance, 'right');
  assert.equal(clean.plaqueBurden, null);
  assert.equal(clean.ischemia, '+');
  assert.equal(clean.grafts, false);
  assert.deepEqual(clean.segments.pRCA.hrp, { napkinRing: true });
  assert.equal(clean.segments.pRCA.grade, '25-49');
  assert.equal(clean.segments.mLAD.grade, '0');
  assert.equal(clean.segments.mLAD.plaque, 'none');
  assert.equal(clean.segments.notASegment, undefined);
  assert.deepEqual(Object.keys(clean.pins), ['pRCA']);
  assert.equal(classify(clean).category, '2');
  assert.deepEqual(sanitizeReport(null), emptyReport());
});

test('changing dominance carries PDA and PLB findings to the vessel they now arise from', () => {
  const pin = { local: [1, 2, 3], view: { theta: 0, phi: 1, radius: 30, target: [0, 0, 0] }, flipped: false };
  const right = reportWith({ 'R-PDA': grade('70-99'), 'R-PLB': grade('25-49') }, { pins: { 'R-PDA': pin } });
  assert.equal(classify(right).category, '4A');

  const left = withDominance(right, 'left');
  assert.deepEqual(Object.keys(left.segments).sort(), ['L-PDA', 'L-PLB']);
  assert.deepEqual(Object.keys(left.pins), ['L-PDA']);
  assert.equal(classify(left).category, '4A');
  assert.match(reportText(left), /PDA \(from LCx\): 70–99%/);

  const co = withDominance(left, 'co');
  assert.deepEqual(Object.keys(co.segments).sort(), ['L-PLB', 'R-PDA']);
  assert.equal(classify(co).category, '4A');

  assert.deepEqual(withDominance(co, 'right').segments, right.segments);
  assert.equal(segmentUnderDominance('R-PLB', 'co'), 'L-PLB');
  assert.equal(segmentUnderDominance('mLAD', 'left'), 'mLAD');
});

test('sanitizeReport drops findings filed under a segment the dominance does not have', () => {
  const clean = sanitizeReport({ version: 1, dominance: 'left', segments: { 'R-PDA': { grade: '70-99' } }, pins: {} });
  assert.deepEqual(Object.keys(clean.segments), ['L-PDA']);
  assert.equal(classify(clean).category, '4A');
});

test('a high-risk feature implies plaque, so it cannot sit on CAD-RADS 0', () => {
  const r = reportWith({ pLAD: grade('0', { hrp: { lowAttenuation: true, napkinRing: true } }) });
  assert.equal(classify(r).label, 'CAD-RADS 1/P1/HRP');
  assert.match(reportText(r), /Proximal LAD: plaque without stenosis, high-risk features/);
});

test('a grade left behind on a non-diagnostic segment counts for nothing', () => {
  const hidden = reportWith({ mRCA: grade('70-99', { nondiagnostic: true }) });
  assert.equal(classify(hidden).label, 'CAD-RADS N');
  assert.equal(classify(hidden).sis, 0);
  const marked = reportWith({ mRCA: grade('0', { nondiagnostic: true, plaque: 'calcified' }) });
  assert.equal(classify(marked).label, 'CAD-RADS N/P1');
});

test('damaged video findings do not throw', () => {
  const schema = 'cathvision.video2stl.findings/v1';
  for (const lesions of [5, {}, [null], [{ segment: 'pRCA' }], 'x']) {
    assert.deepEqual(suggestionsFromVideoFindings({ schema, lesions, warnings: 'x' }), { suggestions: {}, warnings: [] });
  }
  const odd = suggestionsFromVideoFindings({
    schema,
    lesions: [{ segment: 'pRCA', grade: '25-49', percent_stenosis: 'lots', s_mm: null }],
    warnings: ['ok', 7],
  });
  assert.equal(odd.suggestions.pRCA.percent, null);
  assert.equal(odd.suggestions.pRCA.positionMm, null);
  assert.deepEqual(odd.warnings, ['ok']);
});
