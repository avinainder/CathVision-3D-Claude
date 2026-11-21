#!/usr/bin/env node
/**
 * End-to-end check of the report panel against a running build, on a desktop
 * (mouse) and a phone (touch) viewport.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e-report.mjs --stl model.stl --findings findings.json [--shots dir] [--url http://localhost:4173]
 *
 * The STL and findings come from tools/video2stl (run it on the output of
 * make_phantom.py). Needs Playwright with Chromium; it is not a dependency
 * of the app, so it is resolved from the project or from the global install.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

function loadPlaywright() {
  const roots = [process.cwd() + '/', execSync('npm root -g').toString().trim() + '/'];
  for (const root of roots) {
    try {
      return createRequire(root)('playwright');
    } catch {
      // try the next location
    }
  }
  throw new Error('Playwright not found. Install it with: npm install -g playwright');
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), [])
);
if (!args.stl || !args.findings) {
  console.error('usage: node scripts/e2e-report.mjs --stl model.stl --findings findings.json [--shots dir] [--url URL]');
  process.exit(2);
}
const url = args.url || 'http://localhost:4173';
const shots = args.shots;
if (shots) mkdirSync(shots, { recursive: true });

const { chromium } = loadPlaywright();
const results = [];
function check(profile, name, ok, detail = '') {
  results.push({ profile, name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${profile}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function hud(page) {
  const [h, v] = await page.locator('.angle-hud__panel').evaluateAll((panels) =>
    panels.map((p) => `${p.querySelector('.angle-hud__label').textContent} ${p.querySelector('.angle-hud__value').textContent}`));
  return `${h} / ${v}`;
}

async function run(profile, context, touch) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${profile}-${name}.png`) });
  const tap = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const size = page.viewportSize();
  const narrow = size.width <= 760;

  // Points spread over the part of the canvas the panel leaves visible.
  function grid() {
    const w = narrow ? size.width : size.width - 372;
    const h = narrow ? size.height * 0.54 : size.height;
    const points = [];
    for (let iy = 1; iy < 12; iy++) for (let ix = 1; ix < 12; ix++) points.push([(w * ix) / 12, 60 + ((h - 60) * iy) / 12]);
    // Start near the middle, where the model is.
    return points.sort((a, b) => Math.hypot(a[0] - w / 2, a[1] - h / 2) - Math.hypot(b[0] - w / 2, b[1] - h / 2));
  }
  // Tap around until `done` reports that a tap landed on the model.
  async function tapModel(done, skip = []) {
    for (const [x, y] of grid()) {
      if (skip.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 30)) continue;
      await tap(x, y);
      await page.waitForTimeout(60);
      if (await done()) return [x, y];
    }
    return null;
  }

  await page.goto(url);
  await page.setInputFiles('#stl-file-input', args.stl);
  await page.waitForFunction(() => document.querySelector('.debug-readout')?.textContent.includes('SPACE='));
  await page.waitForTimeout(900);
  check(profile, 'coordinate space read from the STL header', (await page.locator('.debug-readout').textContent()).includes('SPACE=LPS'));
  check(profile, 'video-derived model is flagged as estimated', await page.locator('.estimate-badge').isVisible());
  check(profile, 'model opens in the AP view', (await hud(page)).replace(/[A-Z]+ /g, '') === '0.0° / 0.0°', await hud(page));
  await shot('1-model');

  // The canvas must follow its container.
  const fits = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    return Math.abs(c.width - Math.round(c.parentElement.clientWidth * Math.min(devicePixelRatio, 2))) <= 1;
  });
  await page.setViewportSize({ width: size.width - 100, height: size.height - 60 });
  await page.waitForTimeout(250);
  check(profile, 'canvas follows a viewport resize', await fits());
  await page.setViewportSize(size);
  await page.waitForTimeout(250);

  // Grade a segment.
  await page.click('[aria-label="CAD-RADS report"]');
  await page.locator('.coronary-map [aria-label="Mid RCA"]').dispatchEvent('click');
  await page.locator('.segment-editor .chip', { hasText: '50–69%' }).click();
  const badge = () => page.locator('.report-panel__badge').textContent();
  check(profile, 'grading a segment classifies the study', (await badge()) === 'CAD-RADS 3/P1', await badge());
  check(profile, 'the 3D view stays visible beside the panel', await page.evaluate(() => {
    const panel = document.querySelector('.report-panel').getBoundingClientRect();
    return panel.width * panel.height < 0.55 * innerWidth * innerHeight;
  }));

  // Fly to a working projection.
  await page.locator('.segment-editor .chip--view', { hasText: 'LAO 30' }).click();
  await page.waitForTimeout(900);
  check(profile, 'a working-view button flies the camera there', (await hud(page)).startsWith('LAO 30.0°'), await hud(page));

  // Pin the segment to the model and come back to it.
  await page.locator('.segment-editor .chip', { hasText: 'Pin to model' }).click();
  const pinned = await tapModel(() => page.locator('.chip', { hasText: 'Go to pinned view' }).isVisible());
  check(profile, `${touch ? 'touch tap' : 'click'} on the model pins the segment`, !!pinned);
  check(profile, 'pinned segment is marked on the map', (await page.locator('.coronary-map').textContent()).includes('◆ mRCA'));
  await shot('2-pinned');
  await page.locator('.preset-btn', { hasText: 'RAO CAU' }).click();
  await page.waitForTimeout(900);
  const away = await hud(page);
  await page.locator('.chip', { hasText: 'Go to pinned view' }).click();
  await page.waitForTimeout(900);
  check(profile, 'pinned view is restored after moving away', away.startsWith('RAO') && (await hud(page)).startsWith('LAO 30.0°'),
    `${away} -> ${await hud(page)}`);

  // Tapping the marker in the 3D view selects its segment.
  // Tapping near the marker in the 3D view selects its segment: a marker is
  // only a few pixels wide on a phone, so a tap need not land exactly on it.
  await page.locator('.coronary-map [aria-label="Proximal LAD"]').dispatchEvent('click');
  const off = touch ? 14 : 8;
  if (pinned) await tap(pinned[0] + off, pinned[1] - off);
  await page.waitForTimeout(150);
  check(profile, 'tapping near a 3D marker selects its segment',
    (await page.locator('.segment-editor__title').textContent()).includes('Mid RCA'));

  // Changing dominance must not lose a graded posterior branch.
  await page.locator('.coronary-map [aria-label="PDA (from RCA)"]').dispatchEvent('click');
  await page.locator('.segment-editor .chip', { hasText: '70–99%' }).click();
  await page.locator('.chip', { hasText: /^Left$/ }).click();
  check(profile, 'a graded PDA follows a change of dominance',
    (await badge()).startsWith('CAD-RADS 4A') && (await page.locator('.segment-editor__title').textContent()).includes('PDA (from LCx)'),
    await badge());
  await page.locator('.segment-editor .chip', { hasText: /^0%$/ }).click();
  await page.locator('.chip', { hasText: /^Right$/ }).click();
  await page.locator('.coronary-map [aria-label="Mid RCA"]').dispatchEvent('click');
  if (narrow) {
    // The sheet scrolls smoothly, so wait for it to settle rather than for a fixed time.
    const inView = await page.waitForFunction(() => {
      const title = document.querySelector('.segment-editor__title').getBoundingClientRect();
      const body = document.querySelector('.report-panel__body').getBoundingClientRect();
      return title.top >= body.top - 2 && title.bottom <= body.bottom;
    }, null, { timeout: 3000 }).then(() => true, () => false);
    check(profile, 'choosing a segment brings its editor into view on a phone', inView);
  }

  // A drag must orbit, not pin.
  await page.locator('.segment-editor .chip', { hasText: 'Re-pin' }).click();
  if (pinned && !touch) {
    await page.mouse.move(pinned[0], pinned[1]);
    await page.mouse.down();
    await page.mouse.move(pinned[0] + 80, pinned[1] + 10, { steps: 5 });
    await page.mouse.up();
    check(profile, 'a drag orbits instead of pinning', await page.locator('.chip', { hasText: 'cancel' }).isVisible());
  }
  await page.locator('.tool-status__btn', { hasText: 'Cancel' }).click();

  // Import video findings: suggestions only, until accepted.
  await page.locator('.report-tab', { hasText: 'Report' }).click();
  await page.setInputFiles('.report-panel input[type=file]', args.findings);
  await page.locator('.report-tab', { hasText: 'Map' }).click();
  await page.waitForSelector('.suggestion');
  check(profile, 'video findings arrive as suggestions without changing the classification',
    (await badge()) === 'CAD-RADS 3/P1' && (await page.locator('.notice').allTextContents()).join(' ').includes('suggestion'), await badge());
  await shot('3-suggestion');
  await page.locator('.suggestion .chip--on').click();
  check(profile, 'accepting a suggestion grades the segment', (await badge()) === 'CAD-RADS 3/P1' && !(await page.locator('.suggestion').count()));

  await page.locator('.report-tab', { hasText: 'Report' }).click();
  const text = await page.locator('.report-text').textContent();
  check(profile, 'structured report lists the findings',
    text.includes('Mid RCA: 50–69% (moderate) stenosis.') && text.includes('Proximal RCA:') && text.includes('CAD-RADS 3/P1'));
  await shot('4-report');

  // A lumen the video could not resolve is offered as non-diagnostic, never as a grade.
  const unresolved = path.join(mkdtempSync(path.join(tmpdir(), 'cathvision-e2e-')), 'unresolved.json');
  writeFileSync(unresolved, JSON.stringify({
    schema: 'cathvision.video2stl.findings/v1',
    warnings: [],
    lesions: [{ segment: 'dRCA', grade: null, unresolved: true, percent_stenosis: null, percent_at_least: 40, s_mm: 95 }],
  }));
  await page.setInputFiles('.report-panel input[type=file]', unresolved);
  await page.locator('.report-tab', { hasText: 'Map' }).click();
  await page.waitForSelector('.suggestion');
  const offer = await page.locator('.suggestion').textContent();
  await page.locator('.suggestion .chip', { hasText: 'Mark non-diagnostic' }).click();
  check(profile, 'an unresolved video lesion is offered as non-diagnostic',
    offer.includes('at least 40%') && (await badge()) === 'CAD-RADS 3/P1/N', `${await badge()}`);
  await page.locator('.report-panel__close').click();

  // Measure: millimetres, marked as approximate on an estimated model.
  await page.click('[title="Measure tool"]');
  const status = () => page.locator('.tool-status').textContent();
  const first = await tapModel(async () => (await status()).includes('second point'));
  const second = first && await tapModel(async () => (await status()).includes('first point'), [first]);
  await page.locator('.tool-status__btn', { hasText: 'Done' }).click();
  await page.click('[title="Settings"]');
  const measured = await page.locator('.settings-panel .item-row span').allTextContents();
  const mm = parseFloat((measured.find((t) => t.includes('mm')) || '').replace('~', ''));
  check(profile, 'measure tool reports plausible millimetres, marked approximate',
    !!second && mm > 1 && mm < 130 && measured.join(' ').includes('~'), measured.join(' | '));
  await page.locator('.settings-overlay').click({ position: { x: 5, y: 300 } });

  // The report belongs to the model: it is there again after a reload.
  await page.reload();
  await page.setInputFiles('#stl-file-input', args.stl);
  await page.waitForFunction(() => document.querySelector('.debug-readout')?.textContent.includes('SPACE='));
  await page.click('[aria-label="CAD-RADS report"]');
  check(profile, 'report and pin are restored after a reload',
    (await badge()) === 'CAD-RADS 3/P1/N' && (await page.locator('.coronary-map').textContent()).includes('◆ mRCA'), await badge());
  await page.waitForTimeout(900);
  await shot('5-restored');

  // Findings typed before loading a model that already has a saved report:
  // the reader is asked which to keep, and either answer is honoured.
  const typeThenLoad = async (answer) => {
    await page.reload();
    await page.click('[aria-label="CAD-RADS report"]');
    await page.locator('.coronary-map [aria-label="Left main"]').dispatchEvent('click');
    await page.locator('.segment-editor .chip', { hasText: '50–69%' }).click();
    let asked = false;
    page.once('dialog', (dialog) => {
      asked = true;
      return answer === 'saved' ? dialog.accept() : dialog.dismiss();
    });
    await page.setInputFiles('#stl-file-input', args.stl);
    await page.waitForFunction(() => document.querySelector('.debug-readout')?.textContent.includes('SPACE='));
    await page.waitForTimeout(200);
    return asked;
  };
  const askedFirst = await typeThenLoad('saved');
  check(profile, 'choosing the saved report restores it untouched', askedFirst && (await badge()) === 'CAD-RADS 3/P1/N', await badge());
  const askedAgain = await typeThenLoad('typed');
  check(profile, 'choosing the typed findings keeps them, with the model\'s pins',
    askedAgain && (await badge()).startsWith('CAD-RADS 4B')
    && (await page.locator('.coronary-map').textContent()).includes('◆ mRCA'), await badge());

  // A stray tap that changes nothing must not count as "findings entered".
  await page.reload();
  await page.click('[aria-label="CAD-RADS report"]');
  await page.locator('.coronary-map [aria-label="Left main"]').dispatchEvent('click');
  await page.locator('.segment-editor .chip', { hasText: /^0%$/ }).click();
  let strayAsked = false;
  page.once('dialog', (dialog) => { strayAsked = true; return dialog.dismiss(); });
  await page.setInputFiles('#stl-file-input', args.stl);
  await page.waitForFunction(() => document.querySelector('.debug-readout')?.textContent.includes('SPACE='));
  await page.waitForTimeout(200);
  check(profile, 'a tap that changes nothing does not displace the saved report',
    !strayAsked && (await badge()).startsWith('CAD-RADS 4B'), await badge());

  check(profile, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const profiles = [
  ['desktop', { viewport: { width: 1280, height: 800 } }, false],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, true],
];
try {
  for (const [name, options, touch] of profiles) {
    const context = await browser.newContext(options);
    context.setDefaultTimeout(8000);
    try {
      await run(name, context, touch);
    } catch (error) {
      check(name, 'flow completed', false, error.message.split('\n')[0]);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
