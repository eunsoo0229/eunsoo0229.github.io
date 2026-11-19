// Shared timed pose capture — real Electron screen QA (hidden + muted, temporary profile, Chromium's FAKE camera:
// a test pattern with no person, so a completed capture ends in "다시 촬영" — which is itself checked: nothing saved).
//   capture length = reference length (3D clip: frames ÷ fps; video: designated segment), countdown 3-2-1, gauge only
//   while recording and draining, automatic stop on time, cancel saves nothing, angle ↔ 3D preview camera, no
//   reference → error (no fixed length), unusable video → 3D fallback, southpaw note, FormCompare uses the same capture.
// No AI call: the FormCompare capture is cancelled before its analysis step (which would call Gemini).
// Requires the Vite dev server :5173.   Run: node .devtools/qa-pose-capture.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 300) : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-capture-'))}`], env, timeout: 60000 });
const pageErrors = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForLoadState('load');
  const records = () => page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:pose-records') || '[]').length);
  const openModal = async (tech) => {
    await page.evaluate((h) => (location.hash = h), `#/arts/boxing/techniques/${tech}`);
    await page.waitForSelector('.detail-hero h1', { timeout: 60000 });
    await page.locator('button', { hasText: '내 자세 분석하기' }).first().click();
    await page.waitForSelector('[data-testid="pose-modal"]', { timeout: 15000 });
    await page.waitForFunction(() => /카메라 앞에 서서/.test(document.querySelector('[data-testid="pose-camera-frame"]')?.innerText ?? ''), null, { timeout: 30000 }).catch(() => {});
  };
  const closeModal = async () => {
    await page.click('[data-testid="pose-modal-close"]');
    await page.waitForSelector('[data-testid="pose-modal"]', { state: 'detached', timeout: 5000 });
  };
  // timeline of what the screen showed (performance.now() in the page)
  const watch = () =>
    page.evaluate(() => {
      const log = (window.__capLog = []);
      const seen = {};
      const mark = () => {
        const t = performance.now();
        for (const [k, sel] of Object.entries({ countdown: '[data-testid="pose-countdown"]', gauge: '[data-testid="capture-gauge"]', processing: '[data-testid="pose-processing"]', result: '[data-testid="pose-result"]' })) {
          const on = !!document.querySelector(sel);
          if (on !== !!seen[k]) (log.push({ k, on, t }), (seen[k] = on));
        }
        const g = document.querySelector('[data-testid="capture-gauge"]');
        if (g) log.push({ k: 'left', v: Number(g.getAttribute('data-remaining-ms')), w: parseFloat(g.querySelector('.capture-gauge__fill')?.style.width || '0'), t });
        const c = document.querySelector('[data-testid="pose-countdown"] .pose-countdown-overlay__number');
        if (c) log.push({ k: 'count', v: c.textContent, t });
      };
      window.__capObs?.disconnect();
      window.__capObs = new MutationObserver(mark);
      window.__capObs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });

  // ---------------------------------------------------------------- 3D reference (boxing cross)
  await openModal('boxing__cross');
  const kind = await page.getAttribute('[data-testid="pose-modal"]', 'data-reference-kind');
  const ms = Number(await page.getAttribute('[data-testid="pose-modal"]', 'data-capture-ms'));
  const lenText = await page.textContent('[data-testid="pose-capture-length"]');
  check('[C1] 기술 탭(크로스): 영상 없이 3D 기준(v2 오소독스), 촬영 길이 1333 ms = 40프레임 ÷ 30fps', (await page.getAttribute('[data-testid="pose-modal"]', 'data-reference-id')) === 'boxing-cross-m2m-v3' && kind === 'motion3d' && ms === 1333 && /1\.33초/.test(lenText) && /40프레임 ÷ 30fps/.test(lenText), { kind, ms, lenText });
  await page.waitForSelector('[data-testid="pose-capture-3d"] [data-testid="motion3d-stage"][data-loaded="true"]', { timeout: 60000 });
  check('[C2] 3D 미리보기 로딩 후 시작 버튼 활성', await page.isEnabled('[data-testid="pose-capture-start"]'));
  const az = async () => Number(await page.getAttribute('[data-testid="pose-capture-3d"] [data-testid="motion3d-stage"]', 'data-azimuth'));
  const a0 = await az();
  const angles = {};
  for (const a of ['diagonal', 'side', 'back', 'front']) {
    await page.click(`[data-testid="pose-angle-${a}"]`);
    await sleep(150);
    angles[a] = (((await az()) - a0 + 540) % 360) - 180;
  }
  check('[C3] 각도 선택 = 3D 미리보기 카메라 (45° / 90° / 180° / 정면 복귀)', Math.abs(angles.diagonal - 45) < 2 && Math.abs(angles.side - 90) < 2 && Math.abs(Math.abs(angles.back) - 180) < 2 && Math.abs(angles.front) < 2, angles);

  // cancel during the countdown
  const r0 = await records();
  await watch();
  await page.click('[data-testid="pose-capture-start"]');
  await page.waitForSelector('[data-testid="pose-countdown"]', { timeout: 3000 });
  await sleep(900);
  await page.click('[data-testid="pose-capture-cancel"]');
  await sleep(2600);
  const logA = await page.evaluate(() => window.__capLog);
  check('[C4] 카운트다운 중 취소 → 촬영 시작 안 함, 게이지·결과 없음, 저장 없음, 취소 안내', !logA.some((e) => e.k === 'gauge' && e.on) && (await page.locator('[data-testid="pose-result"]').count()) === 0 && (await records()) === r0 && (await page.locator('[data-testid="pose-capture-cancelled"]').count()) === 1);

  // cancel during recording (side angle, so the record would carry it)
  await page.click('[data-testid="pose-angle-side"]');
  await watch();
  await page.click('[data-testid="pose-capture-start"]');
  await page.waitForSelector('[data-testid="capture-gauge"]', { timeout: 6000 });
  await sleep(400);
  await page.click('[data-testid="pose-capture-cancel"]');
  await sleep(1500);
  check('[C5] 촬영 중 취소 → 게이지 사라짐, 결과·기록 없음', (await page.locator('[data-testid="capture-gauge"]').count()) === 0 && (await page.locator('[data-testid="pose-result"]').count()) === 0 && (await records()) === r0);

  // full capture
  await watch();
  const t0 = await page.evaluate(() => performance.now());
  await page.click('[data-testid="pose-capture-start"]');
  await page.waitForSelector('[data-testid="pose-result"]', { timeout: 15000 });
  const log = await page.evaluate(() => window.__capLog);
  const at = (k, on = true) => log.find((e) => e.k === k && e.on === on)?.t;
  const counts = [...new Set(log.filter((e) => e.k === 'count').map((e) => e.v))];
  check('[C6] 카운트다운 3 → 2 → 1', counts.join(',') === '3,2,1', counts);
  const gOn = at('gauge');
  const gOff = at('gauge', false);
  check('[C7] 게이지는 카운트다운이 끝난 뒤에만 표시 (시작 후 ≈3 s)', gOn - t0 >= 2950 && gOn >= at('countdown', false) - 5, { gaugeAfterMs: Math.round(gOn - t0) });
  const lefts = log.filter((e) => e.k === 'left');
  const dec = lefts.every((e, i) => i === 0 || e.v <= lefts[i - 1].v);
  check('[C8] 게이지가 남은 시간과 함께 줄어듦 (1333 → 0, 막대 100% → 0%)', lefts.length >= 5 && dec && lefts[0].v >= 1250 && lefts[0].w >= 90 && lefts.at(-1).v <= 120, { n: lefts.length, first: lefts[0], last: lefts.at(-1) });
  check('[C9] 자동 종료: 게이지 표시 시간 ≈ 1333 ms (±120), 종료 후 바로 처리', Math.abs(gOff - gOn - 1333) <= 120 && at('result') - gOff < 1500, { gaugeMs: Math.round(gOff - gOn), toResultMs: Math.round(at('result') - gOff) });
  const res = await page.evaluate(() => { const r = document.querySelector('[data-testid="pose-result"]'); return { method: r.dataset.method, ok: r.dataset.ok, planned: Number(r.dataset.plannedMs), actual: Number(r.dataset.actualMs), angle: r.dataset.angle, retake: [...r.querySelectorAll('[data-retake]')].map((x) => x.dataset.retake) }; });
  check('[C10] 기록된 촬영 구간 = 계획 길이 (단조 시계, 늦게 멈춰도 끝 시각 고정), 각도 = 측면', res.planned === 1333 && Math.abs(res.actual - 1333) <= 1 && res.angle === 'side', res);
  check('[C11] 사람 없는 화면 → "다시 촬영"(사람 인식 못 함), 점수·기록 없음', res.method === '3d' && res.ok === 'false' && res.retake.includes('no_person') && (await records()) === r0, { res, records: await records() });
  await page.click('[data-testid="pose-capture-retry"]');
  check('[C12] 다시 촬영 → 결과 지우고 시작 버튼', (await page.locator('[data-testid="pose-result"]').count()) === 0 && (await page.isEnabled('[data-testid="pose-capture-start"]')));
  await closeModal();

  // ---------------------------------------------------------------- no reference at all
  await openModal('boxing__uppercut');
  const noRef = await page.textContent('[data-testid="pose-capture-no-reference"]').catch(() => '');
  check('[C13] 3D·지정 영상 모두 없음(어퍼컷) → 오류, 시작 버튼 없음 (고정 시간 촬영 안 함)', /촬영 길이를 정할/.test(noRef) && (await page.locator('[data-testid="pose-capture-start"]').count()) === 0, noRef);
  await closeModal();

  // ---------------------------------------------------------------- registered video references
  await page.evaluate(() => {
    const base = { techniqueId: 'boxing__cross', martialArt: 'boxing', cameraView: 'side', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), profile: null, hasLocalMedia: false };
    localStorage.setItem('martialdex:form-reference-videos', JSON.stringify([
      { ...base, id: 'qa-long', source: { kind: 'youtube', videoId: 'aaaaaaaaaaa', url: '', title: 'Boxing lecture (QA)', channel: 'qa', lengthSeconds: 900 }, startSeconds: 0, endSeconds: 45 },
    ]));
  });
  await openModal('boxing__cross');
  check('[C14] 지정 구간이 45초(강의)인 영상만 있으면 → 3D 기준으로 대체', (await page.getAttribute('[data-testid="pose-modal"]', 'data-reference-kind')) === 'motion3d' && Number(await page.getAttribute('[data-testid="pose-modal"]', 'data-capture-ms')) === 1333);
  await closeModal();
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('martialdex:form-reference-videos'));
    // a minimal ready-made profile so the FormCompare reference step offers "촬영하기" without building criteria (no AI)
    const profile = { builtAt: new Date().toISOString(), model: 'gemini', techniqueVisible: true, matchesTechnique: true, observedTechnique: 'Cross', cameraView: 'side', visibleBodyParts: [], phases: [{ id: 'p1', name: '준비', description: '', startSec: null, endSec: null, startFraction: 0, endFraction: 0.3 }], criteria: [], excluded: [], summary: 'QA', active: { start: 0, end: 1 } };
    list.push({ ...list[0], id: 'qa-seg', source: { ...list[0].source, title: 'Cross only (QA)' }, startSeconds: 12.4, endSeconds: 14.1, profile });
    localStorage.setItem('martialdex:form-reference-videos', JSON.stringify(list));
  });
  await openModal('boxing__cross');
  const vKind = await page.getAttribute('[data-testid="pose-modal"]', 'data-reference-kind');
  const vMs = Number(await page.getAttribute('[data-testid="pose-modal"]', 'data-capture-ms'));
  check('[C15] 기술 한 번 구간(12.4–14.1 s)이 지정된 영상 → 영상 기준, 촬영 1700 ms, 3D로 바꿀 수 있음', vKind === 'video' && vMs === 1700 && (await page.locator('[data-testid="pose-ref-motion3d"]').count()) === 1 && (await page.locator('[data-testid="pose-capture-video"] iframe').count()) === 1, { vKind, vMs });
  await watch();
  await page.click('[data-testid="pose-capture-start"]');
  await page.waitForSelector('[data-testid="pose-result"]', { timeout: 15000 });
  const vlog = await page.evaluate(() => window.__capLog);
  const vg = [vlog.find((e) => e.k === 'gauge' && e.on)?.t, vlog.find((e) => e.k === 'gauge' && !e.on)?.t];
  const vres = await page.evaluate(() => { const r = document.querySelector('[data-testid="pose-result"]'); return { method: r.dataset.method, planned: Number(r.dataset.plannedMs), actual: Number(r.dataset.actualMs), angle: r.dataset.angle }; });
  check('[C16] 영상 기준 촬영도 같은 게이지·자동 종료, 길이 = 구간 길이 (1700 ms)', Math.abs(vg[1] - vg[0] - 1700) <= 120 && vres.planned === 1700 && Math.abs(vres.actual - 1700) <= 1 && vres.method === 'rules' && vres.angle === 'side', { gaugeMs: Math.round(vg[1] - vg[0]), vres });
  await page.click('[data-testid="pose-ref-motion3d"]').catch(() => {});
  await page.click('[data-testid="pose-capture-retry"]').catch(() => {});
  check('[C17] 기준을 3D로 전환 → 촬영 길이 1333 ms', Number(await page.getAttribute('[data-testid="pose-modal"]', 'data-capture-ms')) === 1333 && (await page.getAttribute('[data-testid="pose-modal"]', 'data-reference-kind')) === 'motion3d');
  await closeModal();

  // ---------------------------------------------------------------- FormCompare uses the same capture
  await openModal('boxing__cross');
  await page.click('[data-testid="pose-to-form-compare"]');
  await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 });
  await page.click('[data-testid="form-ref-next"]');
  const reached = await page.waitForSelector('[data-testid="form-capture"]', { timeout: 8000 }).then(() => true).catch(() => false);
  if (reached) {
    await page.click('[data-testid="form-camera-start"]');
    await page.waitForSelector('[data-testid="form-record-start"]', { timeout: 30000 });
    const fms = await page.getAttribute('[data-testid="form-record-start"]', 'data-capture-ms');
    const ftext = await page.textContent('[data-testid="form-record-start"]');
    check('[C18] 기준 영상 비교 촬영도 구간 길이로 고정 (선택 상자 없음)', (fms === '1700' && /1\.70초 자동 촬영/.test(ftext)) || (await page.locator('[data-testid="form-capture-length-error"]').count()) === 1, { fms, ftext, select: await page.locator('[data-testid="form-record-seconds"]').count() });
    if (fms) {
      await page.click('[data-testid="form-record-start"]');
      await page.waitForSelector('[data-testid="capture-gauge"]', { timeout: 6000 });
      const g = Number(await page.getAttribute('[data-testid="capture-gauge"]', 'data-duration-ms'));
      await page.click('[data-testid="form-record-cancel"]');
      await sleep(300);
      check('[C19] 같은 게이지(1700 ms) → 취소하면 분석으로 넘어가지 않음 (AI 호출 없음)', g === 1700 && (await page.locator('[data-testid="capture-gauge"]').count()) === 0 && (await page.getAttribute('[data-testid="form-capture"]', 'data-phase')) === 'ready', { g });
    }
  } else check('[C18] 기준 영상 비교 → 촬영 단계 진입', false, await page.textContent('[data-testid="form-compare"]').then((t) => t.slice(0, 300)));
  await page.locator('[data-testid="form-close"]').click().catch(() => {});
  await page.evaluate(() => localStorage.removeItem('martialdex:form-reference-videos'));

  // ---------------------------------------------------------------- southpaw profile
  const saved = await page.evaluate(async () => {
    const s = await import('/src/lib/fighterProfile/store.ts');
    const r = s.withItem(s.getProfile(), 'body.stance', { value: 'southpaw', state: 'answered' }, 'user');
    if (!r.ok) return r.message;
    s.saveProfile(r.profile);
    return 'ok';
  });
  await openModal('boxing__cross');
  const stanceText = await page.textContent('[data-testid="pose-capture-stance"]').catch(() => '');
  const spRef = await page.getAttribute('[data-testid="pose-modal"]', 'data-reference-id');
  check('[C20] 사우스포 프로필 → 사우스포 크로스 클립이 기준 (앞손 = 오른손, 크로스 뒷손 = 왼손)', saved === 'ok' && spRef === 'boxing-cross-m2m-v3-southpaw' && /사우스포/.test(stanceText) && /앞손 = 오른손/.test(stanceText) && /뒷손 = 왼손/.test(stanceText), { saved, spRef, stanceText });
  await page.waitForSelector('[data-testid="pose-capture-3d"] [data-testid="motion3d-stage"][data-loaded="true"]', { timeout: 60000 });
  check('[C21] 측정 3D 미리보기도 사우스포 시연', (await page.getAttribute('[data-testid="pose-capture-3d"] [data-testid="motion3d-viewer"]', 'data-clip')) === 'boxing-cross-m2m-v3-southpaw');
  await closeModal();
  await page.evaluate(() => (location.hash = '#/arts/boxing/techniques/boxing__jab'));
  await page.waitForSelector('[data-testid="motion3d-card"]', { timeout: 30000 });
  check('[C22] 기술 탭 3D 시연 기본값도 프로필 스탠스(사우스포 잽)', (await page.getAttribute('[data-testid="motion3d-card"]', 'data-clip')) === 'boxing-jab-m2m-v2-southpaw');
  check('페이지 오류 없음', pageErrors.length === 0, pageErrors);
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await app.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
