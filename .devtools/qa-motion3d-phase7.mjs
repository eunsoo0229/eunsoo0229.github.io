// UI QA — Phase 7 3D clips (RNC v3 + 10 new techniques) in the real app, plus a regression pass over the earlier
// clips. Headless Chrome (no window, no sound; WebGL via SwiftShader) against the production build (`vite preview`).
// Local only: no sign-in, no Supabase / AI calls — the technique pages and the 3D files are bundled.
//   npm run build && node .devtools/qa-motion3d-phase7.mjs
// Per clip, at a phone (390 px, touch) and a desktop (1280 px) viewport: the detail page shows the clip, it loads,
// plays, pauses and resumes, the speed changes the clip-time rate, repeat wraps the end to the start, the camera
// presets turn the view, the canvas is drawn (front and side screenshots differ), and no page error is raised.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4798;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.QA_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-m3d-p7-'));
fs.mkdirSync(SHOTS, { recursive: true });
const data = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/motion3d.json'), 'utf8'));
const P7 = data.clips.filter((c) => c.pipeline.version === '4 (Phase 7)');
const OLD = ['boxing-jab-m2m-v2', 'boxing-cross-m2m-v3', 'boxing-hook-m2m-v4', 'wrestling-double-leg-m2m-v2'].map((id) => data.clips.find((c) => c.clipId === id));
const art = (id) => id.split('__')[0];
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--enable-unsafe-swiftshader'] });
const ds = (page) => page.getByTestId('motion3d-stage').evaluate((el) => ({ ...el.dataset }));
const time = async (page) => Number((await ds(page)).time);
const diff = (a, b) => (((a - b) % 360) + 360) % 360;

async function openClip(page, clip) {
  const tid = clip.techniqueIds[0];
  await page.goto(`${BASE}/#/arts/${art(tid)}/techniques/${tid}`);
  await page.locator('.detail-hero h1').waitFor({ timeout: 20000 });
  const card = page.getByTestId('motion3d-card');
  await card.waitFor({ timeout: 10000 });
  if ((await card.getAttribute('data-clip')) !== clip.clipId) {
    const chip = page.locator('[data-testid="motion3d-card"] .chip-row .chip', { hasText: clip.variant });
    if (await chip.count()) await chip.first().click();
  }
  await page.getByTestId('motion3d-open').dispatchEvent('click'); // the detail page can keep shifting while it loads; a DOM click does not wait for it
  await page.locator('[data-testid="motion3d-stage"][data-loaded="true"]').waitFor({ timeout: 40000 });
  // the engine pauses rendering while the stage is off screen (by design): keep it in view for the checks
  await page.getByTestId('motion3d-stage').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const [label, viewport] of [['모바일 390px', { width: 390, height: 844 }], ['데스크톱 1280px', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: label.startsWith('모바일') });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'warning' && /\[motion3d\] (clip ignored|load failed)/.test(m.text()) && errors.push(m.text()));
    for (const clip of P7) {
      const tag = `[${label}] ${clip.clipId}`;
      await openClip(page, clip);
      const viewerClip = await page.getByTestId('motion3d-viewer').getAttribute('data-clip');
      check(`${tag} 기술 상세 페이지에서 이 클립이 열림`, viewerClip === clip.clipId, viewerClip);
      // autoplay → time moves (two-person clips stop at the end, so start again from the beginning first)
      await page.getByTestId('motion3d-restart').click();
      const t0 = await time(page);
      await page.waitForTimeout(500);
      const t1 = await time(page);
      check(`${tag} 자동 재생 — 시간 진행`, (await ds(page)).playing === 'true' && t1 !== t0, { t0, t1 });
      // pause / resume
      await page.getByTestId('motion3d-play').click();
      const p0 = await time(page);
      await page.waitForTimeout(400);
      const paused = (await ds(page)).playing === 'false' && (await time(page)) === p0;
      await page.getByTestId('motion3d-play').click();
      await page.waitForTimeout(400);
      check(`${tag} 일시정지 → 시간 멈춤, 다시 재생 → 진행`, paused && (await ds(page)).playing === 'true' && (await time(page)) !== p0);
      // speed: 2x runs clip time about 4x faster than 0.5x
      // software WebGL in headless Chrome renders unevenly; measure over 0.8 s and take the better of two tries
      const rate1 = async (speed) => {
        await page.getByTestId('motion3d-speed').selectOption(String(speed));
        await page.getByTestId('motion3d-timeline').fill('0');
        if ((await ds(page)).playing !== 'true') await page.getByTestId('motion3d-play').click();
        const a = await time(page);
        const w0 = Date.now();
        await page.waitForTimeout(speed >= 2 ? 400 : 800);
        const b = await time(page);
        return (b - a) / ((Date.now() - w0) / 1000);
      };
      const rate = async (speed) => {
        const a = await rate1(speed);
        const b = await rate1(speed);
        return Math.abs(a - speed) < Math.abs(b - speed) ? a : b; // the try with the steadier frame rate
      };
      const r05 = await rate(0.5);
      const r2 = await rate(2);
      check(`${tag} 속도: 2x가 0.5x의 약 4배로 진행`, r2 / r05 > 3 && r2 / r05 < 5.5, { r05: r05.toFixed(3), r2: r2.toFixed(3) });
      await page.getByTestId('motion3d-speed').selectOption('1');
      // repeat: on → wraps from the end back to the start (two-person clips start with repeat off)
      if ((await ds(page)).loop !== 'true') await page.getByTestId('motion3d-loop').click();
      if ((await ds(page)).playing === 'true') await page.getByTestId('motion3d-play').click();
      await page.getByTestId('motion3d-timeline').fill(String(Math.max(0, Math.floor(clip.durationSec - 0.2))));
      await page.getByTestId('motion3d-play').click();
      let wrapped = false;
      for (let i = 0; i < 60 && !wrapped; i++) {
        await page.waitForTimeout(50);
        wrapped = (await time(page)) < 0.5;
      }
      check(`${tag} 반복 재생: 끝에서 처음으로 이어짐`, (await ds(page)).loop === 'true' && wrapped);
      // phases: one chip per phase
      check(`${tag} 구간 칩 ${clip.phases.length}개`, (await page.locator('[data-testid^="motion3d-phase-"]').count()) === clip.phases.length);
      // camera presets + drawn canvas (paused: the screenshots compare two views of the same frame)
      if ((await ds(page)).playing === 'true') await page.getByTestId('motion3d-play').click();
      const az = async (id) => {
        await page.getByTestId(`motion3d-camera-${id}`).click();
        await page.waitForTimeout(200);
        return Number((await ds(page)).azimuth);
      };
      const aF = await az('front');
      // screenshots of a still frame (a playing canvas never counts as a "stable" element)
      if ((await ds(page)).playing === 'true') await page.getByTestId('motion3d-play').click();
      const stage = page.getByTestId('motion3d-stage');
      // the detail page keeps shifting by sub-pixels (so Playwright never calls the element "stable"): centre the stage
      // and capture the viewport instead
      await stage.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const snap = async (name) => page.screenshot({ path: path.join(SHOTS, `${label.split(' ')[0]}-${clip.clipId}-${name}.png`) });
      const shotF = await snap('front');
      const aS = await az('side');
      const shotS = await snap('side');
      const aB = await az('back');
      const aD = await az('diagonal');
      check(`${tag} 카메라: 측면 = 정면+90°, 후면 = +180°, 45° 사선, 화면이 그려짐 (정면·측면 캡처가 다름)`, Math.abs(diff(aS, aF) - 90) < 1 && Math.abs(diff(aB, aF) - 180) < 1 && Math.abs(diff(aD, aF) - 45) < 1 && shotF.length > 5000 && !shotF.equals(shotS), { aF, aS, aB, aD });
      if (clip.cameraElevationDeg) {
        const dist = Number((await ds(page)).distance);
        check(`${tag} 바닥 기술 카메라 (고도 ${clip.cameraElevationDeg}°, 몸 전체가 보이는 거리)`, dist > 1.5 && dist < 7.5, dist);
      }
      await page.getByTestId('motion3d-close').click();
    }
    // regression: the earlier clips still open and play
    for (const clip of OLD) {
      await openClip(page, clip);
      // two-person clips stop on their last frame: repeat on, then start again, so the check sees time moving
      if ((await ds(page)).loop !== 'true') await page.getByTestId('motion3d-loop').dispatchEvent('click');
      await page.getByTestId('motion3d-restart').dispatchEvent('click');
      const t0 = await time(page);
      await page.waitForTimeout(400);
      const opened = await page.getByTestId('motion3d-viewer').getAttribute('data-clip');
      const t1 = await time(page);
      check(`[${label}] 회귀: ${clip.clipId} 열림·재생`, opened === clip.clipId && t1 !== t0, { opened, t0, t1 });
      await page.getByTestId('motion3d-close').click();
    }
    check(`[${label}] 페이지 오류·클립 무시/로드 실패 경고 없음`, errors.length === 0, errors.slice(0, 3));
    const stats = await page.evaluate(() => window.__motion3dStats);
    check(`[${label}] 뷰어를 닫을 때마다 엔진 정리 (생성 수 = 정리 수)`, stats && stats.created === stats.disposed, stats);
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
}
console.log('screenshots:', SHOTS);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
