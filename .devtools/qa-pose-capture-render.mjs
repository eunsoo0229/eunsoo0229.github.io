// 3D-reference pose measurement end to end with a "person" on camera: the authored clips rendered on the character
// (scripts/motion3d/render_capture_frames.py, Workbench, webcam-like perspective) are fed to the measurement as the
// camera stream (getUserMedia → canvas.captureStream), starting the moment the capture gauge appears. Real MediaPipe,
// real reference joints from the GLB, real scoring — the check that the two joint sets line up.
// Hidden + muted Electron, temporary profile. Requires the Vite dev server :5173 and the rendered frames:
//   for c in cross hook; do for v in front side; do blender -b --factory-startup -P scripts/motion3d/render_capture_frames.py -- \
//     public/motion3d/characters/m2m-human-base-v1.glb public/motion3d/anims/boxing-$c-m2m-v1.glb <frames>/$c $v; done; done
//   node .devtools/qa-pose-capture-render.mjs <frames>
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES = process.argv[2];
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 400) : '')));
const frames = (clip, view) => fs.readdirSync(path.join(FRAMES, clip)).filter((f) => f.startsWith(`${view}-`)).sort().map((f) => 'data:image/png;base64,' + fs.readFileSync(path.join(FRAMES, clip, f)).toString('base64'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-capture-r-'))}`], env, timeout: 60000 });
const pageErrors = [];
const scores = {};
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForLoadState('load');
  // the fake camera: a canvas stream that plays the loaded frames at 30 fps from the moment the gauge appears
  await page.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = 640;
    cv.height = 480;
    const ctx = cv.getContext('2d');
    const cam = (window.__cam = { imgs: [], start: null, mirror: false });
    const draw = () => {
      if (cam.imgs.length) {
        const i = cam.start === null ? 0 : Math.min(cam.imgs.length - 1, Math.floor(((performance.now() - cam.start) / 1000) * 30));
        ctx.save();
        if (cam.mirror) (ctx.translate(640, 0), ctx.scale(-1, 1));
        ctx.drawImage(cam.imgs[i], 0, 0);
        ctx.restore();
      }
      requestAnimationFrame(draw);
    };
    draw();
    const stream = cv.captureStream(30);
    navigator.mediaDevices.getUserMedia = async () => stream.clone();
    new MutationObserver(() => {
      const g = !!document.querySelector('[data-testid="capture-gauge"]');
      if (g && cam.start === null) cam.start = performance.now();
      if (document.querySelector('[data-testid="pose-result"]')) cam.start = null;
    }).observe(document.body, { subtree: true, childList: true });
  });
  const load = (clip, view, mirror = false) =>
    page.evaluate(
      async ([urls, mirror]) => {
        window.__cam.imgs = await Promise.all(urls.map((u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; })));
        window.__cam.mirror = mirror;
        window.__cam.start = null;
      },
      [frames(clip, view), mirror],
    );
  const setStance = (v) =>
    page.evaluate(async (v) => {
      const s = await import('/src/lib/fighterProfile/store.ts');
      const r = s.withItem(s.getProfile(), 'body.stance', { value: v, state: 'answered' }, 'user');
      if (r.ok) s.saveProfile(r.profile);
      return r.ok;
    }, v);
  async function measure(label, { clip, view, angle, mirror = false }) {
    await load(clip, view, mirror);
    await page.evaluate(() => (location.hash = '#/arts/boxing/techniques/boxing__cross'));
    await page.waitForSelector('.detail-hero h1', { timeout: 60000 });
    await page.locator('button', { hasText: '내 자세 분석하기' }).first().click();
    await page.waitForSelector('[data-testid="pose-capture-3d"] [data-testid="motion3d-stage"][data-loaded="true"]', { timeout: 60000 });
    await page.waitForSelector('[data-testid="pose-capture-start"]:not([disabled])', { timeout: 30000 });
    await page.click(`[data-testid="pose-angle-${angle}"]`);
    await page.waitForTimeout(1500); // the pose model sees the guard pose before the start, like a person getting ready
    await page.click('[data-testid="pose-capture-start"]');
    await page.waitForSelector('[data-testid="pose-result"]', { timeout: 20000 });
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="pose-result"]');
      return { ok: el.dataset.ok, score: el.dataset.score === '' ? null : Number(el.dataset.score), retake: [...el.querySelectorAll('[data-retake]')].map((x) => x.dataset.retake), metrics: [...el.querySelectorAll('.pose-metric-row')].map((x) => x.innerText.replace(/\s+/g, ' ')), feedback: [...el.querySelectorAll('[data-testid="pose-feedback"]')].map((x) => x.innerText), text: el.innerText.slice(0, 300) };
    });
    scores[label] = r;
    console.log(`   ${label}: ${JSON.stringify(r).slice(0, 500)}`);
    await page.click('[data-testid="pose-modal-close"]');
    return r;
  }
  const records0 = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:pose-records') || '[]').length);
  const crossFront = await measure('cross→cross 정면', { clip: 'cross', view: 'front', angle: 'front' });
  check('[R1] 크로스 렌더 영상(정면)을 정면 3D 기준과 비교 → 점수가 나옴 (MediaPipe 관절 ↔ GLB 관절 정렬)', crossFront.ok === 'true' && crossFront.score >= 70, crossFront);
  const hookFront = await measure('hook→cross 정면', { clip: 'hook', view: 'front', angle: 'front' });
  check('[R2] 훅 영상을 크로스 기준과 비교 → 크로스보다 낮음', hookFront.score === null || hookFront.score <= crossFront.score - 10, { cross: crossFront.score, hook: hookFront.score });
  const crossSide = await measure('cross→cross 측면', { clip: 'cross', view: 'side', angle: 'side' });
  check('[R3] 측면: 크로스 영상 ↔ 측면 기준 → 점수', crossSide.ok === 'true' && crossSide.score >= 70, crossSide);
  const hookSide = await measure('hook→cross 측면', { clip: 'hook', view: 'side', angle: 'side' });
  check('[R4] 측면: 훅 영상 → 크로스보다 낮음', hookSide.score === null || hookSide.score <= crossSide.score - 10, { cross: crossSide.score, hook: hookSide.score });
  const wrongAngle = await measure('cross 측면 영상, 정면 선택', { clip: 'cross', view: 'side', angle: 'front' });
  check('[R5] 측면으로 찍고 정면 각도를 선택 → 각도 불일치 재촬영 또는 낮은 점수', wrongAngle.retake.includes('angle_mismatch') || wrongAngle.retake.includes('facing_reversed') || (wrongAngle.score ?? 0) <= crossSide.score - 15, wrongAngle);
  const records1 = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:pose-records') || '[]'));
  const scored = Object.values(scores).filter((s) => s.ok === 'true').length;
  check('[R6] 점수가 난 측정만 기록 저장 (method reference_3d, 촬영 구간 1333 ms)', records1.length - records0 === scored && records1.slice(records0).every((r) => r.method === 'reference_3d' && r.capture?.plannedMs === 1333 && Math.abs(r.capture.endedAtMs - r.capture.startedAtMs - 1333) <= 1), { added: records1.length - records0, scored, sample: records1.at(-1) });
  // southpaw: the mirror image of an orthodox cross is a southpaw cross
  await setStance('southpaw');
  const south = await measure('거울 크로스, 사우스포 프로필', { clip: 'cross', view: 'front', angle: 'front', mirror: true });
  check('[R7] 사우스포 프로필 + 사우스포(좌우 반전) 크로스 → 점수 (거울 기준)', south.ok === 'true' && south.score >= 70, south);
  await setStance('orthodox');
  const southAsOrth = await measure('거울 크로스, 오소독스 프로필', { clip: 'cross', view: 'front', angle: 'front', mirror: true });
  check('[R8] 오소독스 프로필인데 사우스포로 함 → 스탠스 불일치 안내 또는 낮은 점수', southAsOrth.retake.includes('stance_mismatch') || (southAsOrth.score ?? 0) <= south.score - 15, southAsOrth);
  check('페이지 오류 없음', pageErrors.length === 0, pageErrors);
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await app.close();
}
fs.writeFileSync(path.join(FRAMES, 'qa-scores.json'), JSON.stringify(scores, null, 1));
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
