// Technique detail page load (phone-like): production build via `vite preview`, headless Chrome (no window, no sound),
// 390px viewport, CPU throttled. Measures hash navigation home → detail until the hero is painted, plus the JS the
// navigation pulled in (to prove the 3D viewer/three.js is NOT loaded until it is opened).
//   npm run build && node .devtools/perf-technique-detail.mjs <label> [throttle=6] [runs=7]
// Writes <label> results to $PERF_OUT (default: stdout only).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [label = 'run', throttleArg, runsArg] = process.argv.slice(2);
const THROTTLE = Number(throttleArg ?? 6);
const RUNS = Number(runsArg ?? 7);
const PORT = 4794;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--enable-unsafe-swiftshader'] });
const PAGES = [
  ['boxing__jab (3D 대상)', '#/arts/boxing/techniques/boxing__jab'],
  ['bjj__armbar (그래플링)', '#/arts/bjj/techniques/bjj__armbar'],
  ['kickboxing__front-kick', '#/arts/kickboxing/techniques/kickboxing__front-kick'],
];
const out = { label, throttle: THROTTLE, runs: RUNS, at: new Date().toISOString(), pages: [] };
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/#/`);
  await page.waitForSelector('.art-card, .page', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  for (const [name, hash] of PAGES) {
    const times = [];
    let scripts = [];
    for (let i = 0; i < RUNS; i++) {
      await page.evaluate(() => (location.hash = '#/'));
      await page.waitForSelector('.art-card, .page');
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => performance.getEntriesByType('resource').length);
      const t0 = Date.now();
      await page.evaluate((h) => (location.hash = h), hash);
      await page.waitForSelector('.detail-hero h1', { timeout: 60000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
      times.push(Date.now() - t0);
      if (i === 0) scripts = await page.evaluate((n) => performance.getEntriesByType('resource').slice(n).filter((e) => /\.js($|\?)/.test(e.name)).map((e) => e.name.split('/').pop()), before);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const all = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    out.pages.push({ name, medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1), all: times, firstVisitScripts: scripts, threeLoaded: all.some((n) => /three|Motion3d|motion3d/i.test(n)), canvasCount: await page.evaluate(() => document.querySelectorAll('canvas').length) });
  }
  // the 3D demo itself (same throttle): click → first frame (three.js chunk + GLB + parse), then playback fps
  if (process.env.PERF_VIEWER !== '0') {
    const viewer = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => (location.hash = '#/arts/boxing/techniques/boxing__jab'));
      await page.waitForSelector('[data-testid="motion3d-open"]', { timeout: 60000 });
      const t0 = Date.now();
      await page.click('[data-testid="motion3d-open"]');
      await page.waitForSelector('[data-testid="motion3d-stage"][data-loaded="true"]', { timeout: 120000 });
      const openMs = Date.now() - t0;
      const fps = await page.evaluate(
        () =>
          new Promise((r) => {
            let n = 0;
            const t = performance.now();
            const f = () => (performance.now() - t < 3000 ? (n++, requestAnimationFrame(f)) : r(n / ((performance.now() - t) / 1000)));
            requestAnimationFrame(f);
          }),
      );
      viewer.push({ openMs, fps: Math.round(fps * 10) / 10, cold: i === 0 });
      await page.click('[data-testid="motion3d-close"]');
    }
    out.viewer = { note: 'headless Chrome, WebGL = SwiftShader (CPU software rendering), not a phone GPU', runs: viewer };
  }
  await ctx.close();
} finally {
  await browser.close();
  preview.kill();
}
console.log(JSON.stringify(out, null, 1));
if (process.env.PERF_OUT) fs.writeFileSync(process.env.PERF_OUT, JSON.stringify(out, null, 1) + '\n');
