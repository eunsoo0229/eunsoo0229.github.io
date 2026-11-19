// 7차 — the camera measurement modal: reference video + capture guide, and the pinned action bar at
// several screen sizes. Hidden + muted Electron, a fresh temporary profile, Chromium's FAKE camera
// (a test pattern, no person — so no real camera and normally no score: the result screen shows the
// "not detected" message). Android sizes are the viewport sizes emulated in Electron, not a device.
// The camera opening waits for the ready message only: in dev (React StrictMode) the first of two camera
// requests is interrupted and shows the generic camera error for a moment before the second one is ready.
// Requires the Vite dev server :5173.  Run: node .devtools/qa-pose-modal-phase7.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
function rec(id, action, expected, actual, pass, detail) {
  results.push({ id, action, expected, actual, result: pass === null ? 'NOT RUN' : pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass === null ? 'NOT RUN' : pass ? 'PASS' : 'FAIL'} — ${id}: ${action} | 기대: ${expected} | 실제: ${actual}${detail && !pass ? ` :: ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-p7-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const pageErrors = [];
const SIZES = [
  { name: '데스크톱 일반 창', w: 1280, h: 800 },
  { name: '데스크톱 작은 창', w: 820, h: 520 },
  { name: 'Android 세로(모사)', w: 393, h: 851 },
  { name: 'Android 가로(모사)', w: 851, h: 393 },
  { name: '작은 높이', w: 1024, h: 420 },
];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.waitForLoadState('load');
  await page.setViewportSize({ width: 1280, height: 800 });

  const info = await page.evaluate(async () => {
    const C = await import('/src/lib/poseAnalysis/poseAnalysisConfig.ts');
    const V = await import('/src/lib/techniqueVideo/service.ts');
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    const jab = resolveTechnique('kickboxing__jab');
    const supported = C.listSupportedTechniqueIds().map((id) => resolveTechnique(id)).filter(Boolean);
    const noVideo = supported.find((t) => V.getTechniqueVideos(t).length === 0) ?? null;
    return { jab: { id: jab.id, art: jab.martialArt, videos: V.getTechniqueVideos(jab).map((v) => v.videoId) }, noVideo: noVideo && { id: noVideo.id, art: noVideo.martialArt }, supported: supported.map((t) => [t.id, V.getTechniqueVideos(t).length]) };
  });

  async function openDetail(t) {
    await page.evaluate((h) => { window.location.hash = h; }, `#/arts/${t.art}/techniques/${t.id}`);
    await page.waitForSelector('button:has-text("내 자세 분석하기")', { timeout: 20000 });
    await sleep(800);
  }
  async function openModal() {
    await page.locator('button', { hasText: '내 자세 분석하기' }).click();
    await page.waitForSelector('[data-testid="pose-modal"]', { timeout: 15000 });
    await page.waitForFunction(() => /카메라 앞에 서서/.test(document.querySelector('[data-testid="pose-camera-frame"]')?.innerText ?? ''), null, { timeout: 30000 }).catch(() => {});
  }
  const phaseText = () => page.evaluate(() => document.querySelector('[data-testid="pose-camera-frame"]')?.innerText ?? '');
  const box = (sel) => page.locator(sel).first().boundingBox();
  /** The pinned close button is fully on screen, inside the panel, and is what a tap at its centre hits. */
  async function closeReachable() {
    return page.evaluate(() => {
      const b = document.querySelector('[data-testid="pose-modal-close"]');
      const panel = document.querySelector('[data-testid="pose-modal"]');
      if (!b || !panel) return { ok: false, why: 'missing' };
      const r = b.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const inView = r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw;
      const inPanel = r.top >= p.top && r.bottom <= p.bottom + 0.5;
      const panelInView = p.top >= 0 && p.bottom <= vh + 0.5;
      return { ok: inView && inPanel && panelInView && hit === b, inView, inPanel, panelInView, hitIsButton: hit === b, btn: [Math.round(r.top), Math.round(r.bottom)], panel: [Math.round(p.top), Math.round(p.bottom)], vh };
    });
  }
  const bodyScroll = () => page.evaluate(() => { const b = document.querySelector('[data-testid="pose-modal-body"]'); return { sh: b.scrollHeight, ch: b.clientHeight, top: b.scrollTop }; });

  // ================= R-1 technique page videos (regression) + V1..V4 at desktop size
  await openDetail(info.jab);
  const detailVideos = await page.evaluate(() => [...document.querySelectorAll('[data-testid="related-videos"] [data-video-id]')].map((e) => e.getAttribute('data-video-id')));
  rec('R-1', '기술 상세(잽) 관련 영상 표시', '등록 영상 그대로 표시', `상세 화면 영상 ${detailVideos.length}개 / 등록 ${info.jab.videos.length}개`, detailVideos.length > 0 && info.jab.videos.every((v) => detailVideos.includes(v)), { detailVideos, reg: info.jab.videos });
  await openModal();
  const refId = await page.getAttribute('[data-testid="pose-reference-video"]', 'data-video-id').catch(() => null);
  rec('V1', '잽 자세 측정 창 — 기준 시연 영상', '잽에 등록된 영상(기술 상세와 같은 영상)', `영상 ${refId}, 등록 목록 첫 영상=${refId === info.jab.videos[0]}`, !!refId && refId === info.jab.videos[0]);
  const guide = await page.textContent('[data-testid="pose-reference-guide"]').catch(() => '');
  rec('V5', '촬영 안내', '범위·높이·거리·위치·동작·방향(추측 없음)', guide.replace(/\s+/g, ' ').slice(0, 140) + '…', /화면 범위/.test(guide) && /거리/.test(guide) && /촬영 방향: MARTIALDEX 자료에 이 기술의 촬영 방향은 등록되어 있지 않습니다/.test(guide) && /같게 맞춰/.test(guide));
  const cam0 = await phaseText();
  const streamId0 = await page.evaluate(() => document.querySelector('.pose-video')?.srcObject?.id ?? null);
  const cb = await box('[data-testid="pose-camera-frame"]');
  const rb = await box('[data-testid="pose-reference-video"]');
  const overlap = cb && rb && !(cb.x + cb.width <= rb.x || rb.x + rb.width <= cb.x || cb.y + cb.height <= rb.y || rb.y + rb.height <= cb.y);
  rec('V3', '카메라 미리보기 + 기준 영상 동시 확인(1280×800)', '나란히, 서로 겹치지 않음, 카메라 동작', `카메라=${/카메라 앞에 서서/.test(cam0) ? '준비됨' : cam0.slice(0, 30)}/stream=${!!streamId0}/겹침=${!!overlap}/카메라 x=${Math.round(cb?.x)} 영상 x=${Math.round(rb?.x)}`, /카메라 앞에 서서/.test(cam0) && !!streamId0 && !overlap && rb.x < cb.x, { cb, rb });
  // play / pause (YouTube's own player — cross-origin frame read through the browser)
  await page.click('[data-testid="pose-reference-video"] [data-testid="youtube-lite"]');
  await page.waitForSelector('[data-testid="pose-reference-video"] iframe[data-testid="youtube-player"]', { timeout: 15000 }).catch(() => {});
  const src = await page.getAttribute('[data-testid="pose-reference-video"] iframe', 'src').catch(() => null);
  let played = null, paused = null;
  const ytFrame = async () => page.frames().find((f) => /youtube\.com\/embed\//.test(f.url()));
  for (let i = 0; i < 20 && played !== true; i++) {
    await sleep(1000);
    const f = await ytFrame();
    if (f) played = await f.evaluate(() => { const v = document.querySelector('video'); return v ? !v.paused && v.currentTime > 0 : null; }).catch(() => null);
  }
  if (played) {
    const f = await ytFrame();
    await f.evaluate(() => document.querySelector('video')?.pause());
    await sleep(800);
    paused = await f.evaluate(() => document.querySelector('video')?.paused ?? null).catch(() => null);
    await f.evaluate(() => document.querySelector('video')?.play());
    await sleep(1200);
  }
  rec('V2', '기준 영상 재생 → 일시정지', '앱 안 YouTube 플레이어로 재생·일시정지', `iframe=${src ? src.replace(/\?.*/, '') : '없음'}/재생=${played}/일시정지=${paused}`, !!src && src.includes(refId) && played === true && paused === true);
  // V4 measurement → hide / show the reference meanwhile: the session goes on with the same camera stream
  await page.locator('[data-testid="pose-modal-footer"] button', { hasText: '촬영/분석 시작' }).click();
  await sleep(1500);
  await page.click('[data-testid="pose-ref-toggle"]');
  const hidden = await page.isHidden('[data-testid="pose-reference"]');
  await sleep(1000);
  await page.click('[data-testid="pose-ref-toggle"]');
  const reshown = await page.isVisible('[data-testid="pose-reference"]');
  const mid = await phaseText();
  const streamId1 = await page.evaluate(() => document.querySelector('.pose-video')?.srcObject?.id ?? null);
  const stillPlaying = await (async () => { const f = await ytFrame(); return f ? f.evaluate(() => !document.querySelector('video')?.paused).catch(() => null) : null; })();
  rec('V4', '측정(카운트다운) 중 기준 영상 숨기기 → 다시 보기', '측정 계속(초기화 없음), 같은 카메라 스트림, 영상 위치 유지', `숨김=${hidden}/다시 보임=${reshown}/측정 화면="${mid.replace(/\s+/g, ' ').slice(0, 24)}"/같은 스트림=${streamId1 === streamId0}/영상 계속 재생=${stillPlaying}`, hidden && reshown && /분석을 시작합니다|자세를 분석하고 있습니다|자동으로 촬영합니다/.test(mid) && streamId1 === streamId0);
  const pose0 = await page.evaluate(() => localStorage.getItem('martialdex:pose-records'));
  await page.waitForSelector('[data-testid="pose-result"]', { timeout: 30000 }).catch(() => {});
  const resultText = (await page.textContent('[data-testid="pose-result"]').catch(() => '')) ?? '';
  const pose1 = await page.evaluate(() => localStorage.getItem('martialdex:pose-records'));
  const okScore = /\/ 100/.test(resultText);
  rec('S-1', '측정 완료(가짜 카메라: 사람 없음)', '기존 결과 화면·저장 규칙(실패면 기록 없음, 성공이면 기존대로 저장)', `${okScore ? '점수 있음' : resultText.slice(0, 60)}/기록 ${pose0 === pose1 ? '변화 없음' : '추가됨'}`, okScore ? pose0 !== pose1 : pose0 === pose1);

  // ================= L — result screen at each size (resize with the result open)
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await sleep(700);
    const r0 = await closeReachable();
    const sc = await bodyScroll();
    let scrolled = null, after = null;
    if (sc.sh > sc.ch + 2) {
      const bb = await box('[data-testid="pose-modal-body"]');
      await page.mouse.move(bb.x + bb.width / 2, bb.y + Math.min(bb.height / 2, 60));
      await page.mouse.wheel(0, 2000);
      await sleep(600);
      scrolled = (await bodyScroll()).top > sc.top;
      after = await closeReachable();
      await page.evaluate(() => { document.querySelector('[data-testid="pose-modal-body"]').scrollTop = 0; });
    }
    const resultVisibleAtEnd = sc.sh > sc.ch + 2 ? await page.evaluate(() => { const b = document.querySelector('[data-testid="pose-modal-body"]'); b.scrollTop = b.scrollHeight; const r = document.querySelector('[data-testid="pose-result"]').getBoundingClientRect(); const br = b.getBoundingClientRect(); const ok = r.bottom <= br.bottom + 1 && r.top >= br.top - r.height; b.scrollTop = 0; return ok; }) : true;
    rec(`L-${s.w}x${s.h}`, `결과 화면 — ${s.name}`, '모달이 화면 안, 닫기 버튼 항상 보임·눌림, 내용은 따로 스크롤', `닫기 보임=${r0.ok}(패널 ${r0.panel} / 화면 ${r0.vh})/본문 스크롤 ${sc.sh > sc.ch + 2 ? `필요→휠로 스크롤=${scrolled}, 스크롤 중 닫기=${after?.ok}, 결과 끝까지=${resultVisibleAtEnd}` : '불필요'}`, r0.ok && (sc.sh <= sc.ch + 2 || (scrolled && after?.ok && resultVisibleAtEnd)), { r0, sc, after });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(500);
  // the footer's own buttons (다시 분석 etc.) and the close
  const footerBtns = await page.$$eval('[data-testid="pose-modal-footer"] button', (bs) => bs.map((b) => b.innerText.trim()));
  rec('L-btn', '결과 화면 하단 버튼', '다시 분석·닫기 고정 영역에 표시', footerBtns.join(' | '), (footerBtns.includes('다시 분석') || footerBtns.includes('다시 촬영')) && footerBtns.includes('닫기'));
  await page.click('[data-testid="pose-modal-close"]');
  await sleep(800);
  rec('L-close', '닫기', '모달 닫힘, 기술 상세 화면 유지', `모달=${await page.locator('[data-testid="pose-modal"]').count()}/상세 버튼=${await page.locator('button', { hasText: '내 자세 분석하기' }).count()}`, (await page.locator('[data-testid="pose-modal"]').count()) === 0 && (await page.locator('button', { hasText: '내 자세 분석하기' }).count()) > 0);

  // ================= L — ready screen at each size (reference + camera + guide: the tallest content)
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await sleep(400);
    await openModal();
    const r0 = await closeReachable();
    const sc = await bodyScroll();
    const start = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="pose-modal-footer"] button')].find((x) => /촬영\/분석 시작/.test(x.innerText)); if (!b) return false; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b && r.bottom <= window.innerHeight; });
    const cb2 = await box('[data-testid="pose-camera-frame"]');
    const rb2 = await box('[data-testid="pose-reference-video"]');
    const ov = cb2 && rb2 && !(cb2.x + cb2.width <= rb2.x || rb2.x + rb2.width <= cb2.x || cb2.y + cb2.height <= rb2.y || rb2.y + rb2.height <= cb2.y);
    const layout = cb2 && rb2 ? (Math.abs(cb2.y - rb2.y) < 40 ? '좌우' : '상하') : '?';
    // the whole camera preview fits in the visible (scrolling) body area
    const camFits = cb2 && cb2.height <= sc.ch + 1;
    rec(`M-${s.w}x${s.h}`, `측정 전 화면 — ${s.name}`, '닫기·촬영 시작 버튼 보임, 카메라와 기준 영상 겹치지 않음, 카메라 전체가 보이는 영역 안', `닫기=${r0.ok}/촬영 시작=${start}/배치=${layout}/겹침=${!!ov}/카메라 높이 ${Math.round(cb2?.height)} ≤ 본문 ${sc.ch}=${camFits}/본문 스크롤 ${sc.sh > sc.ch + 2 ? '있음' : '없음'}`, r0.ok && start && !ov && camFits, { r0, cb2, rb2, sc });
    await page.click('[data-testid="pose-modal-close"]');
    await sleep(500);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // ================= V6 — a measurable technique with no registered video
  if (info.noVideo) {
    await openDetail(info.noVideo);
    await openModal();
    const none = await page.locator('[data-testid="pose-reference-none"]').count();
    const vid = await page.locator('[data-testid="pose-reference-video"]').count();
    const g = (await page.textContent('[data-testid="pose-reference-guide"]').catch(() => '')) ?? '';
    rec('V6', `기준 영상 없는 기술(${info.noVideo.id})`, '"등록된 기준 시연 영상이 없습니다", 다른 영상 없음, 방향 추측 없음', `없음 안내=${none}/영상=${vid}/방향 문구=${/추측해서 안내하지 않습니다/.test(g)}`, none === 1 && vid === 0 && /추측해서 안내하지 않습니다/.test(g));
    await page.click('[data-testid="pose-modal-close"]');
  } else rec('V6', '기준 영상 없는 측정 지원 기술', '—', `측정 지원 ${info.supported.length}개 기술 모두 등록 영상 있음 → 실제 화면 확인 불가`, null, info.supported);

  // ================= F — the reference-video comparison from the modal
  await openDetail(info.jab);
  await openModal();
  const fc0 = await page.evaluate(() => [localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records')]);
  await page.click('[data-testid="pose-to-form-compare"]');
  await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 }).catch(() => {});
  const fOpen = (await page.locator('[data-testid="form-compare"]').count()) > 0;
  if (await page.locator('[data-testid="form-close"]').count()) await page.click('[data-testid="form-close"]');
  await sleep(600);
  const fc1 = await page.evaluate(() => [localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records')]);
  rec('F-1', '측정 창 → "기준 시연 영상과 비교해 평가하기"', '기존 기준 영상 비교 화면, 저장값 불변', `비교 화면=${fOpen}/저장값 동일=${JSON.stringify(fc0) === JSON.stringify(fc1)}`, fOpen && JSON.stringify(fc0) === JSON.stringify(fc1));
  await page.evaluate(() => { window.location.hash = '#/arts/kickboxing/techniques/kickboxing__jab'; });
  await sleep(1000);
  if (await page.locator('[data-testid="form-compare-open"]').count()) {
    await page.click('[data-testid="form-compare-open"]');
    await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 }).catch(() => {});
    rec('F-2', '기술 상세 → "기준 영상과 비교해 평가"', '기존 비교 화면', `열림=${(await page.locator('[data-testid="form-compare"]').count()) > 0}`, (await page.locator('[data-testid="form-compare"]').count()) > 0);
    if (await page.locator('[data-testid="form-close"]').count()) await page.click('[data-testid="form-close"]');
  } else rec('F-2', '기술 상세 비교 버튼', '—', '버튼 없음', false);

  // ================= C — from a lesson: close the modal → the lesson is unchanged
  await page.evaluate(async () => {
    localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true }));
    const C = await import('/src/lib/curriculum/curriculumService.ts');
    const now = new Date().toISOString();
    C.saveCustomCurriculum({ id: 'p7-jab', martialArt: 'boxing', title: '7차 잽', description: '', level: 'beginner', source: 'custom', authorName: 'qa', createdAt: now, updatedAt: now, days: [{ day: 1, title: 'd1', description: '', learningGoals: [], techniqueIds: ['boxing__jab'], reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 20 }] });
    window.location.hash = '#/learning/boxing/p7-jab/coach/1?mode=text';
  });
  for (let i = 0; i < 8; i++) {
    if (await page.locator('[data-testid="coach-location-home"]').count()) { await page.locator('[data-testid="coach-location-home"]').click(); await page.locator('[data-testid="coach-location-confirm"]').click(); }
    if (await page.locator('[data-testid="coach-chat"] .ai-msg').count()) break;
    await sleep(1000);
  }
  // 준비 상태 설정 → practice settled (the 'practiced' step runs the lesson's own PRACTICE_DONE)
  await page.evaluate(async () => { const S = await import('/src/lib/aiCoachDay/sessionStore.ts'); S.updateCoachDayRun((r) => ({ ...r, step: 'practiced' })); });
  await page.reload();
  await page.waitForSelector('[data-testid="lesson-pose-suggest"]', { timeout: 20000 }).catch(() => {});
  if (await page.locator('[data-testid="lesson-pose-suggest"]').count()) {
    const k0 = await page.evaluate(() => { const { messages, ...r } = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run')); return JSON.stringify(r); });
    await page.click('[data-testid="lesson-pose-accept"]');
    await page.waitForSelector('[data-testid="pose-modal"]', { timeout: 15000 });
    await sleep(1500);
    await page.click('[data-testid="pose-modal-close"]');
    await sleep(800);
    const k1 = await page.evaluate(() => { const { messages, ...r } = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run')); return JSON.stringify(r); });
    rec('C-1', '수업 제안 카드 → 측정 창 → 하단 닫기', '수업 화면·상태 그대로', `수업 화면=${(await page.locator('[data-testid="coach-chat"]').count()) > 0}/상태 동일=${k0 === k1}`, (await page.locator('[data-testid="coach-chat"]').count()) > 0 && k0 === k1);
  } else rec('C-1', '수업 제안 카드', '—', '카드가 나오지 않음', false);
} finally {
  await app.close().catch(() => {});
}
console.log(`페이지 오류: ${pageErrors.length}`, JSON.stringify(pageErrors.slice(0, 3)));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-pose-modal-phase7.json'), JSON.stringify({ at: new Date().toISOString(), profile: 'temporary (fresh user-data-dir), fake camera', results, pageErrors }, null, 2));
const c = (r) => results.filter((x) => x.result === r).length;
console.log(`\n=== PASS ${c('PASS')} / FAIL ${c('FAIL')} / NOT RUN ${c('NOT RUN')} ===`);
