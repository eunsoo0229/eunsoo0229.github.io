// 5차 verification, follow-up to qa-pose-suggest-phase5.mjs (same rules: hidden + muted Electron, a fresh
// temporary profile, no feature code changed).
//   B  free lesson again, with the "ready to practise" setup matching the engine (state.currentStage = 'PRACTICE',
//      from which the engine derives directive 'ready'); the first run only set `directive`, which the engine
//      recomputed to 'teach' on the next input — a setup error, not an app result
//   B-4 a free lesson with no technique ID (the saved lesson's techniqueId cleared — "기술 ID 제거" setup)
//   C  High Single (mitt → solo drill chain): completion said during the mitt and then during the drill
//   D-2 the solo drill's own stop button (finishDrill) on the same chain
//   F-2 the pose modal's "기준 시연 영상과 비교해 평가하기" opened from the lesson card (no camera started)
// Requires the Vite dev server :5173.  Run: node .devtools/qa-pose-suggest-phase5b.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
function rec(id, action, expected, actual, pass, detail) {
  results.push({ id, action, expected, actual, result: pass === null ? '미실행' : pass ? '통과' : '실패', detail });
  console.log(`${pass === null ? 'SKIP' : pass ? 'PASS' : 'FAIL'} — ${id}: ${action} | 기대: ${expected} | 실제: ${actual}${detail ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-pose5b-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const pageErrors = [];
const external = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) external.push(r.url().slice(0, 120)); });
  await page.waitForLoadState('load');
  await page.setViewportSize({ width: 1200, height: 900 });
  const card = async () => (await page.locator('[data-testid="lesson-pose-suggest"]').count()) === 1;

  // ================= B — free lesson
  async function freeLesson(request) {
    await page.evaluate(() => { localStorage.removeItem('martialdex:coach-oneoff-session'); localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })); });
    await page.evaluate(() => { window.location.hash = '#/coach/lesson'; });
    await page.reload();
    await page.waitForSelector('[data-testid="oneoff-request"]', { timeout: 20000 });
    await page.fill('[data-testid="oneoff-request"]', request);
    await page.click('[data-testid="oneoff-build"]');
    for (let i = 0; i < 40; i++) {
      if (await page.locator('[data-testid="oneoff-lesson"]').count()) break;
      if (await page.locator('[data-testid="oneoff-technique-choice"]').count()) await page.locator('[data-testid="oneoff-technique-choice"]').first().click();
      await sleep(1000);
    }
    return page.evaluate(() => { const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') || 'null'); return s && { id: s.lesson.id, techniqueId: s.lesson.techniqueId }; });
  }
  /** 준비 상태 설정: the engine at its PRACTICE stage (→ directive 'ready'); optionally the technique ID cleared. */
  async function freeToReady(clearTechnique = false) {
    await page.evaluate((clear) => {
      const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session'));
      s.directive = 'ready';
      s.state = { ...s.state, currentStage: 'PRACTICE', pending: null, practiceDone: false };
      if (clear) s.lesson = { ...s.lesson, techniqueId: null };
      localStorage.setItem('martialdex:coach-oneoff-session', JSON.stringify(s));
    }, clearTechnique);
    await page.reload();
    await page.waitForSelector('[data-testid="oneoff-answer"]', { timeout: 20000 });
    await sleep(1500);
  }
  async function freeType(text) {
    await page.fill('[data-testid="oneoff-answer"]', text);
    await page.keyboard.press('Enter');
    await sleep(3000);
  }
  const fs_ = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') || 'null'); return s && { directive: s.directive, stage: s.state.currentStage, done: !!s.state.practiceDone, mitt: s.mitt?.phase ?? null, mittResult: s.mitt?.result ?? null, run: s.run?.phase ?? null, endMsgs: s.messages.filter((m) => /실습을 마쳤다고 하셔서/.test(m.text)).length }; });
  const mittShown = async () => (await page.locator('[data-testid="mitt-runner"]').count()) > 0;

  const f0 = await freeLesson('잽 배우고 싶어');
  await freeToReady();
  let a = await fs_();
  rec('B-0a', '자유 수업 준비 상태(PRACTICE 단계)', 'directive ready, 미트 자세 안내 또는 실습 패널', `directive=${a.directive}/mitt=${a.mitt}`, a.directive === 'ready', { f0, a });
  if (a.mitt === 'posture') { await freeType('준비됐어'); a = await fs_(); }
  rec('B-0b', '"준비됐어"', '미트 실행(running), 미트 화면 표시', `mitt=${a.mitt}/화면=${await mittShown()}`, a.mitt === 'running' && (await mittShown()), a);
  for (const [i, q] of ['아직 안 끝났어', '언제 끝나?', '실습을 어떻게 해?', '잽 자세를 설명해 줘', '아까 끝냈었어'].entries()) {
    await freeType(q);
    const n = await fs_();
    rec(`B-N${i + 1}`, `자유 수업 미트 중 "${q}"`, '완료 안 함, 미트 계속, 카드 없음', `done=${n.done}/mitt=${n.mitt}/directive=${n.directive}/화면=${await mittShown()}/card=${await card()}`, !n.done && n.mitt === 'running' && !(await card()), n);
  }
  await freeType('실습 완료했어');
  const b1 = await fs_();
  rec('B-1', '자유 수업(잽) "실습 완료했어"', '미트 종료(횟수 기록 없음)·PRACTICE_DONE·제안 카드', `mitt=${b1.mitt}/result=${JSON.stringify(b1.mittResult)}/done=${b1.done}/종료 안내 ${b1.endMsgs}회/card=${await card()}`, b1.done && b1.mitt === 'done' && b1.mittResult === null && (await card()), b1);
  await freeType('실습 완료했어');
  const b1b = await fs_();
  rec('B-1b', '"실습 완료했어" 한 번 더', '중복 종료·카드 중복 없음', `종료 안내 ${b1b.endMsgs}회/카드 ${await page.locator('[data-testid="lesson-pose-suggest"]').count()}개`, b1b.endMsgs === 1 && (await page.locator('[data-testid="lesson-pose-suggest"]').count()) <= 1, b1b);
  if (await card()) await page.click('[data-testid="lesson-pose-decline"]');
  await sleep(500);
  const afterDecline = await card();
  await page.reload();
  await sleep(2500);
  rec('B-2', '"나중에 하기" → 같은 세션(즉시·새로고침 후)', '재제안 없음', `즉시 card=${afterDecline}/새로고침 후 card=${await card()}`, !afterDecline && !(await card()));
  const f1 = await freeLesson('잽 배우고 싶어');
  await freeToReady();
  let g = await fs_();
  if (g.mitt === 'posture') { await freeType('준비됐어'); g = await fs_(); }
  await freeType('다 했어');
  const g1 = await fs_();
  rec('B-3', '새 자유 수업에서 "다 했어"', '새 세션 → 다시 제안', `세션 ${f0.id === f1.id ? '같음' : '다름'}/done=${g1.done}/card=${await card()}`, f0.id !== f1.id && g1.done && (await card()), g1);

  // ---- F-2 on this card: accept → pose modal → the form-compare switch (no camera started)
  if (await card()) {
    const fc0 = await page.evaluate(() => [localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records'), localStorage.getItem('martialdex:pose-records')]);
    await page.click('[data-testid="lesson-pose-accept"]');
    await page.waitForSelector('[data-testid="pose-to-form-compare"]', { timeout: 15000 }).catch(() => {});
    const title = await page.textContent('.pose-modal h3').catch(() => '');
    rec('E-3', '자유 수업 카드 "자세 측정하기"', 'PoseAnalysisModal(잽)', title?.trim() ?? '(없음)', /Jab|잽/.test(title ?? ''));
    if (await page.locator('[data-testid="pose-to-form-compare"]').count()) {
      await page.click('[data-testid="pose-to-form-compare"]');
      await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 }).catch(() => {});
      const opened = (await page.locator('[data-testid="form-compare"]').count()) > 0;
      rec('F-2', '자세 측정 창 → "기준 시연 영상과 비교해 평가하기"', '기존 formCompare 화면(가로채지 않음)', `opened=${opened}, step=${await page.getAttribute('[data-testid="form-compare"]', 'data-step').catch(() => null)}`, opened);
      if (await page.locator('[data-testid="form-close"]').count()) await page.click('[data-testid="form-close"]');
      await sleep(1000);
    } else rec('F-2', '측정 창의 비교 버튼', '—', '버튼 없음', false);
    const after = await fs_();
    const fc1 = await page.evaluate(() => [localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records'), localStorage.getItem('martialdex:pose-records')]);
    rec('E-4', '비교 화면 닫은 뒤 자유 수업', '수업 화면·상태 유지, 기록 불변', `수업 화면=${(await page.locator('[data-testid="oneoff-lesson"]').count()) > 0}/done=${after.done}/저장값 동일=${JSON.stringify(fc0) === JSON.stringify(fc1)}`, (await page.locator('[data-testid="oneoff-lesson"]').count()) > 0 && after.done && JSON.stringify(fc0) === JSON.stringify(fc1));
  } else rec('F-2', '측정 창 열기', '—', '카드 없음', null);

  // ---- B-4 a lesson with no technique ID
  await freeLesson('잽 배우고 싶어');
  await freeToReady(true);
  let h = await fs_();
  if (h.mitt === 'posture') { await freeType('준비됐어'); h = await fs_(); }
  await freeType('실습 완료했어');
  if (!(await fs_()).done && (await page.locator('button', { hasText: '완료' }).count())) { /* manual "완료" if the panel shows it */ }
  const h1 = await fs_();
  rec('B-4', '기술 ID 없는 자유 수업(기술 ID 제거 설정) "실습 완료했어"', '제안 없음', `mitt=${h.mitt}→${h1.mitt}/done=${h1.done}/card=${await card()}`, !(await card()), { h, h1 });

  // ================= C / D-2 — High Single chain (mitt → drill)
  async function openLesson(curId, art, ids) {
    await page.evaluate(async ({ curId, art, ids }) => {
      localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true }));
      const C = await import('/src/lib/curriculum/curriculumService.ts');
      const now = new Date().toISOString();
      C.saveCustomCurriculum({ id: curId, martialArt: art, title: `검증 ${curId}`, description: '', level: 'beginner', source: 'custom', authorName: 'qa', createdAt: now, updatedAt: now, days: [{ day: 1, title: 'd1', description: '', learningGoals: [], techniqueIds: ids, reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 20 }] });
    }, { curId, art, ids });
    await page.evaluate((h) => { window.location.hash = h; }, `#/learning/${art}/${curId}/coach/1?mode=text`);
    for (let i = 0; i < 8; i++) {
      if (await page.locator('[data-testid="coach-location-home"]').count()) {
        await page.locator('[data-testid="coach-location-home"]').click();
        await page.locator('[data-testid="coach-location-confirm"]').click();
      }
      if (await page.locator('[data-testid="coach-chat"] .ai-msg').count()) break;
      await sleep(1000);
    }
    await page.waitForSelector('[data-testid="coach-chat"] .ai-msg', { timeout: 30000 });
    await page.evaluate(async () => { const S = await import('/src/lib/aiCoachDay/sessionStore.ts'); S.updateCoachDayRun((r) => ({ ...r, step: 'ready', lessons: Object.fromEntries(Object.entries(r.lessons ?? {}).map(([k, v]) => [k, { ...v, pending: null }])) })); });
    await page.reload();
    await page.waitForSelector('[data-testid="coach-text-input"]', { timeout: 20000 });
    await sleep(1200);
  }
  async function type(text, wait = 2500) {
    const n = await page.evaluate(() => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length);
    await page.fill('[data-testid="coach-text-input"]', text);
    await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length > n + 1, n, { timeout: 60000 }).catch(() => {});
    await sleep(wait);
  }
  const st = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run')); const id = r.techniqueIds[r.index]; return { step: r.step, cur: id, done: !!r.lessons?.[id]?.practiceDone, after: r.practiceSetup?.after ?? null, mitt: (r.mittSessions ?? []).length, drill: (r.drillSessions ?? []).length, outcome: r.outcomes?.[id] ?? null }; });

  await openLesson('p5b-single', 'wrestling', ['wrestling__high-single']);
  await type('준비됐어');
  await type('준비됐어');
  const c0 = await st();
  await type('실습 완료했어');
  const c1 = await st();
  rec('C-1a', '하이 싱글(미트→드릴 연결 실습) 미트 중 "실습 완료했어"', '실습 전체 종료(확인 단계)', `${c0.step}(after=${c0.after})→${c1.step}/done=${c1.done}/card=${await card()}`, c1.done, { c0, c1 });
  if (c1.step === 'drill') {
    await type('실습 완료했어');
    const c2 = await st();
    rec('C-1b', '이어 시작된 드릴 중 "실습 완료했어"(두 번째)', '실습 종료, 제안 카드 없음, 수업 계속', `${c2.step}/done=${c2.done}/drill기록 ${c2.drill}/card=${await card()}`, c2.done && !(await card()) && c2.step !== 'drill', c2);
  }
  await openLesson('p5b-single2', 'wrestling', ['wrestling__high-single']);
  await type('준비됐어');
  await type('준비됐어');
  if (await page.locator('[data-testid="mitt-runner-stop"]').count()) { await page.click('[data-testid="mitt-runner-stop"]'); await sleep(2500); }
  const d0 = await st();
  if (d0.step === 'drill') {
    if (await page.locator('[data-testid="solo-drill-start"]').count()) { await page.click('[data-testid="solo-drill-start"]'); await sleep(2000); }
    if (await page.locator('[data-testid="solo-drill-stop"]').count()) {
      await page.click('[data-testid="solo-drill-stop"]');
      await sleep(2500);
      const d1 = await st();
      rec('D-2', '솔로 드릴 "종료" 버튼(finishDrill, 미트 종료 버튼 뒤)', 'practiced→확인 단계, 미트·드릴 기록 각 1건, 카드 없음(하이 싱글)', `${d1.step}/done=${d1.done}/mitt ${d1.mitt}/drill ${d1.drill}/card=${await card()}`, d1.done && d1.mitt === 1 && d1.drill === 1 && !(await card()), d1);
    } else rec('D-2', '드릴 종료 버튼', '—', '버튼 없음', false);
  } else rec('D-2', '미트 종료 후 드릴', '—', `드릴 단계 아님(${d0.step})`, null, d0);
} finally {
  await app.close().catch(() => {});
}
console.log(`\n외부(localhost 외) 요청: ${external.length}건`, JSON.stringify(external.slice(0, 5)));
console.log(`페이지 오류: ${pageErrors.length}`, JSON.stringify(pageErrors.slice(0, 3)));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-pose-suggest-phase5b.json'), JSON.stringify({ at: new Date().toISOString(), profile: 'temporary (fresh user-data-dir)', results, external, pageErrors }, null, 2));
const c = (r) => results.filter((x) => x.result === r).length;
console.log(`\n=== 통과 ${c('통과')} / 실패 ${c('실패')} / 미실행 ${c('미실행')} ===`);
