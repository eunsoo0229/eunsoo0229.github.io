// UI QA — 3D technique demo viewer on the technique detail page (spec "3D Motion System Phase 1" §6, items 1–15).
// Headless Chrome (no window, no sound; WebGL via SwiftShader) against the production build (`vite preview`).
//   npm run build && node .devtools/qa-motion3d.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4797;
const BASE = `http://localhost:${PORT}`;
const JAB = '#/arts/boxing/techniques/boxing__jab';
const SHOTS = process.env.QA_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-m3d-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--enable-unsafe-swiftshader'] });

// A valid GLB that has a scene but no animation (for "잘못된 애니메이션 정보").
function glbWithoutAnimation() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'empty' }] }));
  const pad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const chunk = Buffer.concat([json, pad]);
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, chunk]);
}

// Real touch input (CDP): fingers move from `from` to `to` in 8 steps.
async function touchGesture(cdp, from, to) {
  const at = (k) => from.map(([x, y], i) => ({ x: x + ((to[i][0] - x) * k) / 8, y: y + ((to[i][1] - y) * k) / 8, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let k = 1; k <= 8; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const ds = (page) => page.getByTestId('motion3d-stage').evaluate((el) => ({ ...el.dataset }));
const time = async (page) => Number((await ds(page)).time);

async function openViewer(page) {
  await page.getByTestId('motion3d-open').click();
  await page.locator('[data-testid="motion3d-stage"][data-loaded="true"]').waitFor({ timeout: 30000 });
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const [label, viewport] of [['모바일 390px', { width: 390, height: 844 }], ['데스크톱 1280px', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: label.startsWith('모바일') });
    const page = await ctx.newPage();
    const touch = label.startsWith('모바일');
    const cdp = await ctx.newCDPSession(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const glbRequests = [];
    page.on('request', (r) => r.url().endsWith('.glb') && glbRequests.push(r.url()));

    // ---- 15. regression: default detail page unchanged, no 3D loaded
    await page.goto(`${BASE}/${JAB}`);
    await page.locator('.detail-hero h1').waitFor();
    const before = await page.evaluate(() => ({
      canvas: document.querySelectorAll('canvas').length,
      viewer: !!document.querySelector('[data-testid="motion3d-viewer"]'),
      three: performance.getEntriesByType('resource').some((e) => /MotionViewer|three/i.test(e.name)),
      posture: [...document.querySelectorAll('.info-card h3')].some((h) => h.textContent.includes('자세')),
      mastery: [...document.querySelectorAll('.info-card h3')].some((h) => h.textContent.includes('숙련도')),
    }));
    check(`[${label}] 15 기본 상태: <canvas> 0개, 뷰어 없음, three.js·GLB 미로딩`, before.canvas === 0 && !before.viewer && !before.three && glbRequests.length === 0, before);
    check(`[${label}] 15 기존 자세·숙련도 섹션 그대로`, before.posture && before.mastery);
    check(`[${label}] 15 3D 시연 카드는 닫힌 상태로 표시`, await page.getByTestId('motion3d-open').isVisible());
    // Phase 4: the default jab is the re-authored Mesh2Motion clip; the mocap jab stays as a selectable version.
    // The checks below are about the mocap clip (55 frames, embedded character), so it is picked explicitly.
    const defaultClip = await page.getByTestId('motion3d-card').getAttribute('data-clip');
    const chips = await page.locator('[data-testid="motion3d-card"] .chip-row .chip').allInnerTexts();
    check(`[${label}] Phase 4 기본 잽 = 자체 제작(오소독스), 사우스포·이전 모캡 버전 선택 가능`, defaultClip === 'boxing-jab-m2m-v2' && chips.join() === '오소독스,사우스포,모션 캡처 (이전)', { defaultClip, chips });
    await page.locator('[data-testid="motion3d-card"] .chip-row .chip', { hasText: '모션 캡처 (이전)' }).click();

    // ---- 1. load
    await openViewer(page);
    const loaded = await page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, three: performance.getEntriesByType('resource').some((e) => /MotionViewer/.test(e.name)) }));
    check(`[${label}] 1 Jab GLB 로딩 (열었을 때만 three.js·GLB 요청)`, loaded.canvas === 1 && loaded.three && glbRequests.length === 1, { ...loaded, glb: glbRequests.length });
    check(`[${label}] 1 Phase 1.2 전신 수정 GLB 사용`, glbRequests.length === 1 && glbRequests[0].endsWith('/motion3d/boxing-jab-nw-v2-fullbody.glb'), glbRequests);
    // ---- 2. play
    const t0 = await time(page);
    await page.waitForTimeout(600);
    const t1 = await time(page);
    check(`[${label}] 2 자동 재생 — 시간 진행`, (await ds(page)).playing === 'true' && t1 !== t0, { t0, t1 });
    // ---- 3. pause
    await page.getByTestId('motion3d-play').click();
    const p0 = await time(page);
    await page.waitForTimeout(500);
    check(`[${label}] 3 일시정지 — 시간 멈춤`, (await ds(page)).playing === 'false' && (await time(page)) === p0);
    // ---- 4. speed: clip-time rate follows the speed; total duration text never changes
    const rate = async (speed) => {
      await page.getByTestId('motion3d-speed').selectOption(String(speed));
      await page.getByTestId('motion3d-timeline').fill('0');
      await page.getByTestId('motion3d-play').click();
      const a = await time(page);
      const w0 = Date.now();
      await page.waitForTimeout(700);
      const b = await time(page);
      const w = (Date.now() - w0) / 1000;
      await page.getByTestId('motion3d-play').click();
      return (b - a) / w;
    };
    const r05 = await rate(0.5);
    const r2 = await rate(2);
    const readout = await page.getByTestId('motion3d-readout').innerText();
    check(`[${label}] 4 속도 2x는 0.5x의 약 4배로 진행 (실측 비율)`, r2 / r05 > 3 && r2 / r05 < 5.5, { r05: r05.toFixed(3), r2: r2.toFixed(3), ratio: (r2 / r05).toFixed(2), rendering: (await ds(page)).rendering });
    check(`[${label}] 4 속도를 바꿔도 클립 전체 시간 1.83s 유지, 실제 재생 시간 별도 표시`, /\/ 1\.83s/.test(readout) && /2x 재생 시 0\.92초/.test(readout), readout);
    const speeds = await page.getByTestId('motion3d-speed').locator('option').allInnerTexts();
    check(`[${label}] 4 속도 7단계 0.25x~2x`, speeds.join(',') === '0.25x,0.5x,0.75x,1x,1.25x,1.5x,2x', speeds);
    await page.getByTestId('motion3d-speed').selectOption('1');
    // ---- 5. timeline
    await page.getByTestId('motion3d-timeline').fill('1');
    check(`[${label}] 5 타임라인 이동 → 1.00s, 프레임 30`, Math.abs((await time(page)) - 1) < 1e-3 && /프레임 30 \/ 55/.test(await page.getByTestId('motion3d-frame').innerText()));
    // ---- 6. frame step
    await page.getByTestId('motion3d-next-frame').click();
    const f31 = await page.getByTestId('motion3d-frame').innerText();
    await page.getByTestId('motion3d-prev-frame').click();
    await page.getByTestId('motion3d-prev-frame').click();
    const f29 = await page.getByTestId('motion3d-frame').innerText();
    await page.getByTestId('motion3d-timeline').fill('0');
    await page.getByTestId('motion3d-prev-frame').click();
    const fStart = await time(page);
    check(`[${label}] 6 한 프레임 앞/뒤 (30→31→29), 처음에서 더 뒤로 안 감`, /프레임 31/.test(f31) && /프레임 29/.test(f29) && fStart === 0, [f31, f29, fStart]);
    // ---- 7. camera presets: front = measured chest direction; side/back = +90/+180
    const az = async (id) => {
      await page.getByTestId(`motion3d-camera-${id}`).click();
      await page.waitForTimeout(150);
      return Number((await ds(page)).azimuth);
    };
    const aF = await az('front');
    const aS = await az('side');
    const aB = await az('back');
    const diff = (a, b) => (((a - b) % 360) + 360) % 360;
    check(`[${label}] 7 정면/측면/후면 프리셋 (측면 = 정면+90°, 후면 = +180°)`, Math.abs(diff(aS, aF) - 90) < 1 && Math.abs(diff(aB, aF) - 180) < 1, { aF, aS, aB });
    // ---- 8. 360° rotation: 8 × 45° returns to the start; a drag rotates too
    await az('front');
    for (let i = 0; i < 8; i++) await page.getByTestId('motion3d-rotate').click();
    const aFull = Number((await ds(page)).azimuth);
    await page.getByTestId('motion3d-canvas').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = await page.getByTestId('motion3d-canvas').boundingBox();
    let cx = box.x + box.width / 2;
    let cy = box.y + box.height / 2;
    const aDrag0 = Number((await ds(page)).azimuth);
    if (touch) await touchGesture(cdp, [[cx, cy]], [[cx + 120, cy]]);
    else {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 120, cy, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForTimeout(500);
    const aDrag1 = Number((await ds(page)).azimuth);
    check(`[${label}] 8 360도 회전 (45°×8 = 원위치) + ${touch ? '한 손가락 터치' : '마우스'} 드래그 회전`, Math.min(diff(aFull, aF), 360 - diff(aFull, aF)) < 1 && Math.min(diff(aDrag1, aDrag0), 360 - diff(aDrag1, aDrag0)) > 10, { aF, aFull, aDrag0, aDrag1 });
    // ---- 9. zoom
    await az('front');
    const d0 = Number((await ds(page)).distance);
    await page.getByTestId('motion3d-zoom-in').click();
    const d1 = Number((await ds(page)).distance);
    // wheel (desktop) / two-finger pinch-in (phone) → zoom out. Re-measure: the button clicks above scrolled the page.
    await page.getByTestId('motion3d-canvas').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const zb = await page.getByTestId('motion3d-canvas').boundingBox();
    [cx, cy] = [zb.x + zb.width / 2, zb.y + zb.height / 2];
    if (touch) await touchGesture(cdp, [[cx - 80, cy], [cx + 80, cy]], [[cx - 20, cy], [cx + 20, cy]]);
    else {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, 600);
    }
    await page.waitForTimeout(500);
    const d2 = Number((await ds(page)).distance);
    for (let i = 0; i < 20; i++) await page.getByTestId('motion3d-zoom-in').click();
    const dMin = Number((await ds(page)).distance);
    check(`[${label}] 9 확대·축소 (버튼, ${touch ? '두 손가락 핀치' : '휠'}) + 최소 거리 제한`, d1 < d0 && d2 > d1 && Math.abs(dMin - 1.2) < 0.01, { d0, d1, d2, dMin });
    await az('front');
    // ---- 10. skeleton mode, animation keeps running
    const shotChar = await page.getByTestId('motion3d-canvas').screenshot();
    await page.getByTestId('motion3d-mode').click();
    await page.getByTestId('motion3d-play').click();
    const s0 = await time(page);
    await page.waitForTimeout(500);
    const s1 = await time(page);
    await page.getByTestId('motion3d-play').click();
    const shotSkel = await page.getByTestId('motion3d-canvas').screenshot();
    check(`[${label}] 10 관절 모드 전환 + 재생 유지`, (await ds(page)).mode === 'skeleton' && s1 !== s0 && !shotChar.equals(shotSkel), { s0, s1 });
    // 9: the skeleton really follows the animation (joints at the guard vs at full extension differ on screen)
    const setTime = (t) => page.getByTestId('motion3d-timeline').evaluate((el, v) => (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)), el.dispatchEvent(new Event('input', { bubbles: true }))), t);
    await setTime(0.3);
    await page.waitForTimeout(150);
    const skGuard = await page.getByTestId('motion3d-canvas').screenshot();
    await setTime(0.9333333333333333);
    await page.waitForTimeout(150);
    const skExt = await page.getByTestId('motion3d-canvas').screenshot();
    check(`[${label}] 9 관절 모드에서 시간 이동 시 관절 표시가 따라 움직임 (가드 ≠ 최대 신전)`, !skGuard.equals(skExt) && Math.abs((await time(page)) - 0.9333) < 1e-3);
    await page.getByTestId('motion3d-mode').click();
    check(`[${label}] 10 캐릭터 모드로 복귀`, (await ds(page)).mode === 'character');
    // ---- 11. phases
    await page.getByTestId('motion3d-phase-execute').click();
    const ph = { t: await time(page), label: await page.getByTestId('motion3d-current-phase').innerText(), frame: await page.getByTestId('motion3d-frame').innerText() };
    await page.getByTestId('motion3d-phase-finish').click();
    const ph2 = await page.getByTestId('motion3d-current-phase').innerText();
    check(`[${label}] 11 구간 이동 (실행 0.533s=프레임 16, 종료)`, Math.abs(ph.t - 0.533) < 1e-3 && ph.label === '실행' && /프레임 16/.test(ph.frame) && ph2 === '종료', { ...ph, ph2 });
    // ---- 5b. hidden tab / offscreen → loop stops
    await page.getByTestId('motion3d-play').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = (await ds(page)).rendering;
    const th0 = await time(page);
    await page.waitForTimeout(400);
    const th1 = await time(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check(`[${label}] 성능 화면 숨김 시 렌더링 중지, 복귀 시 재개`, hidden === 'off' && th0 === th1 && (await ds(page)).rendering === 'on', { hidden, th0, th1 });
    await page.getByTestId('motion3d-play').click();
    check(`[${label}] 뷰어 연 상태 가로 스크롤 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

    // ---- 12. close → resources released; reopen uses the cached bytes (no second GLB request)
    await page.getByTestId('motion3d-close').click();
    const closed = await page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, stats: window.__motion3dStats }));
    check(`[${label}] 12 닫기 → canvas 제거, 엔진 dispose (생성=해제)`, closed.canvas === 0 && closed.stats.created === closed.stats.disposed, closed);
    await openViewer(page);
    check(`[${label}] 12 다시 열기 → GLB 재요청 없음 (캐시)`, glbRequests.length === 1, glbRequests.length);
    await page.getByTestId('motion3d-close').click();
    for (let i = 0; i < 3; i++) {
      await openViewer(page);
      await page.getByTestId('motion3d-close').click();
    }
    const cycled = await page.evaluate(() => window.__motion3dStats);
    check(`[${label}] 12 열고 닫기 반복 후 남은 엔진 0`, cycled.created === cycled.disposed && cycled.created === 5, cycled);

    // ---- 13. GLB failures: missing file, damaged file, no animation → message, page alive, retry works
    const page2 = await ctx.newPage();
    page2.on('pageerror', (e) => errors.push(e.message));
    let mode = 404;
    await page2.route(/\/motion3d\/.*\.glb$/, (route) => {
      if (mode === 404) return route.fulfill({ status: 404, body: 'nope' });
      if (mode === 'corrupt') return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from('glTF-not-really-a-model') });
      if (mode === 'noanim') return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: glbWithoutAnimation() });
      return route.continue();
    });
    await page2.goto(`${BASE}/${JAB}`);
    await page2.getByTestId('motion3d-open').click();
    await page2.getByTestId('motion3d-error').waitFor({ timeout: 20000 });
    const e404 = await page2.getByTestId('motion3d-error').innerText();
    mode = 'corrupt';
    await page2.getByRole('button', { name: '다시 시도' }).click();
    await page2.waitForFunction(() => /손상/.test(document.querySelector('[data-testid="motion3d-error"]')?.textContent ?? ''), null, { timeout: 20000 });
    const eCorrupt = await page2.getByTestId('motion3d-error').innerText();
    mode = 'noanim';
    await page2.getByRole('button', { name: '다시 시도' }).click();
    await page2.waitForFunction(() => /동작 정보가 없습니다/.test(document.querySelector('[data-testid="motion3d-error"]')?.textContent ?? ''), null, { timeout: 20000 });
    const eNoAnim = await page2.getByTestId('motion3d-error').innerText();
    const alive = await page2.locator('.detail-hero h1').isVisible();
    mode = 'ok';
    await page2.getByRole('button', { name: '다시 시도' }).click();
    await page2.locator('[data-testid="motion3d-stage"][data-loaded="true"]').waitFor({ timeout: 30000 });
    check(`[${label}] 13 GLB 없음 → 안내`, /불러오지 못했습니다/.test(e404), e404);
    check(`[${label}] 13 손상된 GLB → 안내`, /손상/.test(eCorrupt), eCorrupt);
    check(`[${label}] 13 애니메이션 없는 GLB → 안내`, /동작 정보가 없습니다/.test(eNoAnim), eNoAnim);
    check(`[${label}] 13 실패해도 페이지 정상 + 다시 시도로 복구`, alive && (await page2.locator('canvas').count()) === 1);
    await page2.close();

    // ---- 14. technique without motion data
    for (const hash of ['#/arts/bjj/techniques/bjj__armbar', '#/arts/kickboxing/techniques/kickboxing__front-kick', '#/arts/boxing/techniques/boxing__uppercut']) {
      await page.goto(`${BASE}/${hash}`);
      await page.locator('.detail-hero h1').waitFor();
      check(`[${label}] 14 모션 없는 기술: 3D 카드·canvas 없음 (${hash.split('/').pop()})`, (await page.getByTestId('motion3d-card').count()) === 0 && (await page.locator('canvas').count()) === 0);
    }
    // navigating away with the viewer open disposes it too
    await page.goto(`${BASE}/${JAB}`);
    await openViewer(page);
    await page.evaluate(() => (location.hash = '#/arts/bjj/techniques/bjj__armbar'));
    await page.locator('.detail-hero h1').waitFor();
    await page.waitForTimeout(300);
    const nav = await page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, stats: window.__motion3dStats }));
    check(`[${label}] 12 뷰어 연 채 다른 기술로 이동 → 해제`, nav.canvas === 0 && nav.stats.created === nav.stats.disposed, nav);
    // ---- Phase 1.3: authored cross / hook on the separate Mesh2Motion character
    for (const [tech, art, clip, hand] of [['boxing__cross', 'boxing', 'boxing-cross-m2m-v3', 'right'], ['boxing__hook', 'boxing', 'boxing-hook-m2m-v4', 'left']]) {
      const before = glbRequests.length;
      await page.goto(`${BASE}/#/arts/${art}/techniques/${tech}`);
      await page.locator('.detail-hero h1').waitFor();
      check(`[${label}] ${clip}: 기본 상태 canvas 0`, (await page.locator('canvas').count()) === 0);
      await openViewer(page);
      const reqs = glbRequests.slice(before).map((u) => u.split('/motion3d/')[1]).sort();
      check(`[${label}] ${clip}: 캐릭터 + 애니메이션 GLB 분리 로드`, reqs.includes(`anims/${clip}.glb`) && (reqs.includes('characters/m2m-human-base-v1.glb') || glbRequests.slice(0, before).some((u) => u.endsWith('characters/m2m-human-base-v1.glb'))), reqs);
      const a0 = await time(page);
      await page.waitForTimeout(400);
      check(`[${label}] ${clip}: 재생`, (await ds(page)).playing === 'true' && (await time(page)) !== a0);
      const phases = await page.locator('[data-testid^="motion3d-phase-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('motion3d-phase-', '')));
      await page.getByTestId('motion3d-phase-execute').click();
      const ex = { t: await time(page), f: await page.getByTestId('motion3d-frame').innerText() };
      await page.getByTestId('motion3d-phase-guard_return').click();
      const gr = await page.getByTestId('motion3d-current-phase').innerText();
      check(`[${label}] ${clip}: 4단계 구간 (준비·실행·회수·가드 복귀) 이동`, phases.join(',') === 'prepare,execute,recover,guard_return' && Math.abs(ex.t - 0.3333) < 1e-3 && /프레임 10 \/ 40/.test(ex.f) && gr === '가드 복귀', { phases, ex, gr });
      const azs = {};
      for (const cam of ['front', 'side', 'back']) {
        await page.getByTestId(`motion3d-camera-${cam}`).click();
        await page.waitForTimeout(120);
        azs[cam] = Number((await ds(page)).azimuth);
      }
      const dd = (a, b) => ((((a - b) % 360) + 360) % 360);
      // authored clips: 정면 = the rig's forward = towards the opponent (azimuth 0, camera on +Z)
      check(`[${label}] ${clip}: 정면(상대 방향)/측면/후면 프리셋`, Math.min(azs.front, 360 - azs.front) < 1 && Math.abs(dd(azs.side, azs.front) - 90) < 1 && Math.abs(dd(azs.back, azs.front) - 180) < 1, azs);
      // skeleton mode at contact, front + side (saved as review images on the desktop run)
      const setT = (t) => page.getByTestId('motion3d-timeline').evaluate((el, v) => (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)), el.dispatchEvent(new Event('input', { bubbles: true }))), t);
      await page.getByTestId('motion3d-mode').click();
      await setT(0);
      await page.waitForTimeout(150);
      const s0 = await page.getByTestId('motion3d-canvas').screenshot();
      await setT(0.6);
      await page.waitForTimeout(150);
      const s1 = await page.getByTestId('motion3d-canvas').screenshot();
      check(`[${label}] ${clip}: 관절 모드 + 시간 이동 시 관절이 움직임`, (await ds(page)).mode === 'skeleton' && !s0.equals(s1));
      if (!touch) {
        fs.writeFileSync(path.join(APP, `data/audit/motion3d-${clip.includes('cross') ? 'cross' : 'hook'}-m2m-skeleton-front.png`), s1);
        await page.getByTestId('motion3d-camera-side').click();
        await page.waitForTimeout(150);
        fs.writeFileSync(path.join(APP, `data/audit/motion3d-${clip.includes('cross') ? 'cross' : 'hook'}-m2m-skeleton-side.png`), await page.getByTestId('motion3d-canvas').screenshot());
      }
      await page.getByTestId('motion3d-mode').click();
      const st = await page.evaluate(() => window.__motion3dStats);
      await page.getByTestId('motion3d-close').click();
      const st2 = await page.evaluate(() => window.__motion3dStats);
      check(`[${label}] ${clip}: 닫기 → 해제`, st2.created === st2.disposed && (await page.locator('canvas').count()) === 0, { st, st2 });
      void hand;
    }
    // ---- Phase 5: two-person demos (performer white / partner red, one timeline)
    for (const [hash, clip] of [['#/arts/wrestling/techniques/wrestling__basic-double-leg', 'wrestling-double-leg-m2m-v2'], ['#/arts/bjj/techniques/bjj__rear-naked-choke', 'bjj-rear-naked-choke-m2m-v3']]) {
      await page.goto(`${BASE}/${hash}`);
      await page.locator('.detail-hero h1').waitFor();
      const card = page.locator(`[data-testid="motion3d-card"][data-clip="${clip}"]`);
      check(`[${label}] ${clip}: 3D 카드에 "2인 시연" 표시, 기본 canvas 0`, (await card.count()) === 1 && (await card.locator('[data-testid="motion3d-duo"]').count()) === 1 && (await page.locator('canvas').count()) === 0);
      if (clip.startsWith('wrestling')) {
        const vchips = await card.locator('.chip-row .chip').allInnerTexts();
        check(`[${label}] ${clip}: 오소독스 / 사우스포 2인 시연을 같은 카드에서 선택 (Phase 6)`, vchips.join() === '2인 시연 · 오소독스,2인 시연 · 사우스포', vchips);
      }
      await card.getByTestId('motion3d-open').click();
      await page.locator('[data-testid="motion3d-stage"][data-loaded="true"], [data-testid="motion3d-error"]').first().waitFor({ timeout: 30000 });
      // the engine pauses while the stage is off screen (by design) — keep it in view for the timing checks
      await page.getByTestId('motion3d-stage').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const err = await page.getByTestId('motion3d-error').count();
      const roles = await page.locator('[data-testid="motion3d-roles"] li').allInnerTexts();
      check(`[${label}] ${clip}: 두 캐릭터 로딩, 역할 표시 (흰색 시연자 / 빨간색 상대)`, err === 0 && roles.length === 2 && /흰색.*시연자/.test(roles[0]) && /빨간색.*상대/.test(roles[1]), { err, roles });
      const d0 = await ds(page);
      check(`[${label}] ${clip}: 반복 재생 기본 꺼짐 (끝에서 원위치로 튀지 않음)`, d0.loop === 'false' && (await page.getByTestId('motion3d-loop').getAttribute('aria-pressed')) === 'false');
      await page.getByTestId('motion3d-speed').selectOption('2');
      await page.waitForFunction(() => document.querySelector('[data-testid="motion3d-stage"]')?.dataset.playing === 'false', null, { timeout: 15000 });
      const end = await ds(page);
      check(`[${label}] ${clip}: 끝까지 재생 후 마지막 프레임에서 멈춤`, end.playing === 'false' && Number(end.time) > 2.9, end.time);
      // back to 1x for the timing checks below (at 2x, click latency on a loaded machine alone covers ~1 s of clip time)
      await page.getByTestId('motion3d-speed').selectOption('1');
      await page.getByTestId('motion3d-play').click();
      await page.waitForTimeout(300);
      const dsEnd = await ds(page);
      check(`[${label}] ${clip}: 끝에서 재생 → 처음부터 다시`, Number(dsEnd.time) < 1.5 && dsEnd.playing === 'true', { time: dsEnd.time, playing: dsEnd.playing, rendering: dsEnd.rendering, inView: await page.getByTestId('motion3d-stage').evaluate((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }) });
      await page.getByTestId('motion3d-loop').click();
      check(`[${label}] ${clip}: 반복 재생 켜기`, (await ds(page)).loop === 'true');
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="motion3d-stage"]')?.dataset.time) > 2.6, null, { timeout: 15000 });
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="motion3d-stage"]')?.dataset.time) < 1, null, { timeout: 15000 });
      check(`[${label}] ${clip}: 반복 켜면 끝에서 처음으로 이어서 재생`, (await ds(page)).playing === 'true');
      await page.getByTestId('motion3d-play').click();
      const tp = await time(page);
      await page.waitForTimeout(300);
      check(`[${label}] ${clip}: 일시정지`, (await ds(page)).playing === 'false' && (await time(page)) === tp);
      await page.getByTestId('motion3d-restart').click();
      await page.waitForTimeout(200);
      check(`[${label}] ${clip}: 처음으로`, Number((await ds(page)).time) < 0.5);
      const az = {};
      for (const cam of ['front', 'diagonal', 'side', 'back']) {
        await page.getByTestId(`motion3d-camera-${cam}`).click();
        await page.waitForTimeout(150);
        az[cam] = Number((await ds(page)).azimuth);
      }
      const rel = (a) => (((a - az.front) % 360) + 360) % 360;
      check(`[${label}] ${clip}: 정면·45°·측면·후면 시점`, Math.abs(rel(az.diagonal) - 45) < 2 && Math.abs(rel(az.side) - 90) < 2 && Math.abs(rel(az.back) - 180) < 2, az);
      await page.getByTestId('motion3d-camera-diagonal').click();
      await page.getByTestId('motion3d-play').click();
      await page.waitForTimeout(1200);
      if (!touch) await page.getByTestId('motion3d-stage').screenshot({ path: path.join(SHOTS, `${clip}-diagonal.png`) });
      await page.getByTestId('motion3d-close').click();
      const st = await page.evaluate(() => window.__motion3dStats);
      check(`[${label}] ${clip}: 닫기 → 해제`, st.created === st.disposed && (await page.locator('canvas').count()) === 0, st);
    }
    const before2 = glbRequests.length;
    await openViewer(page);
    check(`[${label}] 다시 열기: 캐릭터·애니메이션 GLB 재요청 없음 (캐시)`, glbRequests.length === before2, glbRequests.slice(before2));
    await page.getByTestId('motion3d-close').click();
    check(`[${label}] 페이지 오류 없음`, errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  check('실행', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  preview.kill();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
