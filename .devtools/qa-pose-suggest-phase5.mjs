// 5차 verification — the pose suggestion paths in the REAL screens (hidden + muted Electron, a fresh
// temporary profile: no real user data is read or written). Test only: no feature code is changed.
//   A  regular lesson, 자체 AI 코치 and Gemini 코치: spoken completion vs questions / negations, duplicates
//   B  free lesson /coach/lesson: completion → card → "나중에 하기" → none in the session → new lesson → card
//   C  High Single (not measurable): no card, the lesson goes on
//   D  existing ends: mitt stop (finishMitt), drill stop (finishDrill), "여기서 끝내기" (stopPracticeEarly), timer end
//   E  accepting: PoseAnalysisModal for the right technique, closing keeps the lesson, no score / proficiency change
//   F  reference-video comparison (formCompare) still opens from the technique page and the pose modal
// Lessons are started by the screen itself (place picker → run); moving the engine to "ready to practise"
// is done by editing the saved run of this temporary profile (marked "준비 상태 설정" in the results).
// Requires the Vite dev server :5173.  Run: node .devtools/qa-pose-suggest-phase5.mjs
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-pose5-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const pageErrors = [];
const external = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { if (/gemini|generativelanguage|functions\/v1|supabase\.co/i.test(r.url())) external.push({ url: r.url().slice(0, 120), at: Date.now() }); });
  await page.waitForLoadState('load');
  await page.setViewportSize({ width: 1200, height: 900 });

  const run = () => page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'));
  const card = async () => (await page.locator('[data-testid="lesson-pose-suggest"]').count()) === 1;
  const st = async () => { const r = await run(); const id = r.techniqueIds[r.index]; return { step: r.step, cur: id, done: !!r.lessons?.[id]?.practiceDone, coach: r.coachKind, mitt: (r.mittSessions ?? []).length, drill: (r.drillSessions ?? []).length, msgs: r.messages.length }; };
  async function openLesson(curId, art, ids, coach) {
    await page.evaluate(async ({ curId, art, ids, coach }) => {
      localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: coach, remember: true }));
      const C = await import('/src/lib/curriculum/curriculumService.ts');
      const now = new Date().toISOString();
      C.saveCustomCurriculum({ id: curId, martialArt: art, title: `검증 ${curId}`, description: '', level: 'beginner', source: 'custom', authorName: 'qa', createdAt: now, updatedAt: now, days: [{ day: 1, title: 'd1', description: '', learningGoals: [], techniqueIds: ids, reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 20 }] });
    }, { curId, art, ids, coach });
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
  }
  /** 준비 상태 설정: the current technique's explanation is done (engine state kept, pending question cleared). */
  async function toReady() {
    await page.evaluate(async () => {
      const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
      S.updateCoachDayRun((r) => ({ ...r, step: 'ready', lessons: Object.fromEntries(Object.entries(r.lessons ?? {}).map(([k, v]) => [k, { ...v, pending: null }])) }));
    });
    await page.reload();
    await page.waitForSelector('[data-testid="coach-text-input"]', { timeout: 20000 });
    await sleep(1200);
  }
  async function type(text, wait = 1500) {
    const n = await page.evaluate(() => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length);
    await page.fill('[data-testid="coach-text-input"]', text);
    await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length > n + 1, n, { timeout: 60000 }).catch(() => {});
    await sleep(wait);
  }
  const lastCoach = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg--model')].pop()?.innerText ?? '');
  const toPractice = async () => { await type('준비됐어'); await type('준비됐어'); return st(); };

  // ================= A — 자체 AI 코치
  await openLesson('p5-jab-md', 'boxing', ['boxing__jab', 'boxing__cross'], 'martialdex');
  await toReady();
  const a0 = await toPractice();
  rec('A-MD-0', '"준비됐어" ×2 (준비 상태 설정 후)', '실습 단계 진입(mitt/practice/drill)', a0.step, ['mitt', 'practice', 'drill'].includes(a0.step), a0);
  for (const [i, q] of ['아직 안 끝났어', '언제 끝나?', '실습을 어떻게 해?', '잽 자세를 설명해 줘', '아까 끝냈었어'].entries()) {
    const before = await st();
    await type(q);
    const after = await st();
    rec(`A-MD-N${i + 1}`, `"${q}"`, '완료 처리 안 함(단계·practiceDone 그대로, 카드 없음)', `${after.step}/done=${after.done}/card=${await card()}`, after.step === before.step && !after.done && !(await card()), { reply: (await lastCoach()).slice(0, 120) });
  }
  const extBefore = external.length;
  await type('실습 완료했어', 2500);
  const a1 = await st();
  const a1msg = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].map((e) => e.innerText).filter((t) => /실습을 마쳤다고 하셔서/.test(t)).length);
  rec('A-MD-1', '"실습 완료했어"', '실습 종료 → 확인 단계, practiceDone, 제안 카드', `${a1.step}/done=${a1.done}/card=${await card()}`, a1.done && a1.step !== 'mitt' && (await card()) && a1msg === 1, { ...a1, endMsgs: a1msg });
  const k1 = { ...a1 };
  await type('실습 완료했어', 2500);
  const a2 = await st();
  const endMsgs2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].map((e) => e.innerText).filter((t) => /실습을 마쳤다고 하셔서/.test(t)).length);
  const cards = await page.locator('[data-testid="lesson-pose-suggest"]').count();
  rec('A-MD-2', '"실습 완료했어" 한 번 더', '실습 종료·기록·카드 중복 없음', `종료 안내 ${endMsgs2}회, mitt 기록 ${a2.mitt}, 카드 ${cards}개, step ${a2.step}`, endMsgs2 === 1 && a2.mitt === k1.mitt && cards <= 1, { before: k1, after: a2, reply: (await lastCoach()).slice(0, 160) });

  // ---- E (on this lesson's card, if still shown — else on a fresh one below)
  let eDone = false;
  async function checkAccept(label) {
    if (!(await card())) return false;
    const r0 = await run();
    const { messages, ...rest0 } = r0;
    const learn0 = await page.evaluate(async () => { const { loadLearnerModel } = await import('/src/lib/personalCoach/learnerStore.ts'); return JSON.stringify(loadLearnerModel().filter((l) => /jab/.test(l.technique.id)).map((l) => [l.technique.id, l.proficiency, l.pose])); });
    const pose0 = await page.evaluate(() => localStorage.getItem('martialdex:pose-records'));
    await page.click('[data-testid="lesson-pose-accept"]');
    await page.waitForSelector('.pose-modal', { timeout: 15000 }).catch(() => {});
    const title = await page.textContent('.pose-modal h3').catch(() => '');
    const cur = r0.techniqueIds[r0.index];
    const curName = await page.evaluate(async (id) => { const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts'); return resolveTechnique(id)?.name; }, cur);
    rec(`E-1${label}`, '"자세 측정하기"', '기존 PoseAnalysisModal, 현재 기술', title?.trim() ?? '(없음)', !!title && title.includes(curName), { cur, curName });
    // close: the modal's own close button
    if (await page.locator('.pose-modal button', { hasText: '닫기' }).count()) await page.locator('.pose-modal button', { hasText: '닫기' }).last().click();
    else await page.mouse.click(5, 5);
    await sleep(1200);
    const r1 = await run();
    const { messages: m1, ...rest1 } = r1;
    const learn1 = await page.evaluate(async () => { const { loadLearnerModel } = await import('/src/lib/personalCoach/learnerStore.ts'); return JSON.stringify(loadLearnerModel().filter((l) => /jab/.test(l.technique.id)).map((l) => [l.technique.id, l.proficiency, l.pose])); });
    const pose1 = await page.evaluate(() => localStorage.getItem('martialdex:pose-records'));
    rec(`E-2${label}`, '측정 화면 닫기', '수업 유지·상태 불변·숙련도/자세 기록 불변', `run 동일=${JSON.stringify(rest0) === JSON.stringify(rest1)}, 숙련도 동일=${learn0 === learn1}, 자세 기록 동일=${pose0 === pose1}, 수업 화면=${(await page.locator('[data-testid="coach-chat"]').count()) > 0}`, JSON.stringify(rest0) === JSON.stringify(rest1) && learn0 === learn1 && pose0 === pose1 && (await page.locator('[data-testid="coach-chat"]').count()) > 0);
    return true;
  }

  // ================= A — Gemini 코치
  await openLesson('p5-jab-gm', 'boxing', ['boxing__jab', 'boxing__cross'], 'gemini');
  await toReady();
  const g0 = await toPractice();
  const extG0 = external.length;
  await type('실습 완료했어', 2500);
  const g1 = await st();
  const extG1 = external.length;
  rec('A-GM-1', 'Gemini 코치, "실습 완료했어"', '실습 종료·제안 카드, 외부(Gemini) 요청 없음', `${g1.step}/done=${g1.done}/card=${await card()}/외부요청 ${extG1 - extG0}건`, g1.coach === 'gemini' && g1.done && (await card()) && extG1 === extG0, { g0, g1 });
  eDone = await checkAccept('(Gemini 수업)');

  // ---- "다음으로 넘어가자" as a completion
  await openLesson('p5-jab-next', 'boxing', ['boxing__jab', 'boxing__cross'], 'martialdex');
  await toReady();
  await toPractice();
  await type('다음으로 넘어가자', 2500);
  const n1 = await st();
  rec('A-MD-3', '"다음으로 넘어가자"', '완료로 처리 + 카드', `${n1.step}/done=${n1.done}/card=${await card()}`, n1.done && (await card()));
  if (!eDone) eDone = await checkAccept('(자체 AI 수업)');

  // ================= C — High Single
  await openLesson('p5-single', 'wrestling', ['wrestling__high-single'], 'martialdex');
  await toReady();
  const c0 = await toPractice();
  await type('실습 완료했어', 2500);
  const c1 = await st();
  rec('C-1', '하이 싱글 실습 중 "실습 완료했어"', '실습은 종료, 제안 카드 없음, 수업 계속(확인 질문)', `${c0.step}→${c1.step}/done=${c1.done}/card=${await card()}`, c1.done && !(await card()), { c0, c1, reply: (await lastCoach()).slice(0, 140) });

  // ================= D — existing ends
  await openLesson('p5-d-mitt', 'boxing', ['boxing__jab'], 'martialdex');
  await toReady();
  const dm0 = await toPractice();
  if (await page.locator('[data-testid="mitt-runner-stop"]').count()) {
    await page.click('[data-testid="mitt-runner-stop"]');
    await sleep(2500);
    const dm1 = await st();
    rec('D-1', '미트 "■ 종료"(finishMitt)', 'practiced→확인 단계, 미트 기록 1건, 카드', `${dm1.step}/done=${dm1.done}/mitt기록 ${dm1.mitt}/card=${await card()}`, dm1.done && dm1.mitt === dm0.mitt + 1 && (await card()));
  } else rec('D-1', '미트 종료 버튼', '—', `미트 화면 아님(${dm0.step})`, null);
  await openLesson('p5-d-drill', 'wrestling', ['wrestling__sprawl'], 'martialdex');
  await toReady();
  const dd0 = await toPractice();
  if (await page.locator('[data-testid="solo-drill-stop"]').count() || await page.locator('[data-testid="solo-drill-start"]').count()) {
    if (await page.locator('[data-testid="solo-drill-start"]').count()) { await page.click('[data-testid="solo-drill-start"]'); await sleep(1500); }
    await page.click('[data-testid="solo-drill-stop"]');
    await sleep(2500);
    const dd1 = await st();
    rec('D-2', '솔로 드릴 "종료"(finishDrill)', 'practiced→확인 단계, 드릴 기록 1건', `${dd1.step}/done=${dd1.done}/drill기록 ${dd1.drill}`, dd1.done && dd1.drill === dd0.drill + 1);
  } else rec('D-2', '솔로 드릴 종료 버튼', '—', `드릴 화면 아님(${dd0.step})`, null);
  // a technique whose practice is the timer: picked by the app's own practice planner
  const timerId = await page.evaluate(async () => {
    const P = await import('/src/lib/aiCoachDay/practicePlan.ts');
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    for (const id of ['bjj__armbar', 'bjj__triangle-choke', 'judo__osoto-gari', 'bjj__kimura', 'bjj__closed-guard', 'judo__seoi-nage', 'sambo__armbar']) {
      const t = resolveTechnique(id);
      if (!t) continue;
      const s = P.planPractice(t, { location: 'home', mma: false, submissionGoal: false, seconds: 60, art: t.martialArt });
      if (!s.mitt && !s.drill && s.after !== 'drill') return { id, art: t.martialArt };
    }
    return null;
  });
  if (timerId) {
    await openLesson('p5-d-timer', timerId.art, [timerId.id], 'martialdex');
    await toReady();
    const dt0 = await toPractice();
    if (dt0.step === 'practice' && (await page.locator('button', { hasText: '여기서 끝내기' }).count())) {
      await page.locator('button', { hasText: '여기서 끝내기' }).click();
      await sleep(2500);
      const dt1 = await st();
      rec('D-3', '"■ 여기서 끝내기"(stopPracticeEarly)', 'practiced→확인 단계(완료=false 기록)', `${dt1.step}/done=${dt1.done}`, dt1.done && dt1.step !== 'practice', { tech: timerId.id });
    } else rec('D-3', '타이머 실습 종료 버튼', '—', `타이머 단계 아님(${dt0.step})`, null, { tech: timerId.id });
    await openLesson('p5-d-timer2', timerId.art, [timerId.id], 'martialdex');
    await toReady();
    const dt2 = await toPractice();
    if (dt2.step === 'practice') {
      await page.evaluate(async () => { const S = await import('/src/lib/aiCoachDay/sessionStore.ts'); S.updateCoachDayRun((r) => (r.practice ? { ...r, practice: { ...r.practice, phaseEndTimestamp: Date.now() - 1, firedCueIds: [] } } : r)); });
      await sleep(3000);
      const dt3 = await st();
      rec('D-4', '타이머 자동 종료(남은 시간 0으로 설정)', 'practiced→확인 단계, 완료 기록', `${dt3.step}/done=${dt3.done}`, dt3.done && dt3.step !== 'practice', { tech: timerId.id, completed: (await run()).outcomes[timerId.id]?.completed });
    } else rec('D-4', '타이머 자동 종료', '—', `타이머 단계 아님(${dt2.step})`, null);
  } else rec('D-3/D-4', '타이머 실습 기술 찾기', '—', '앱의 실습 계획에서 타이머 실습 기술을 찾지 못함', null);

  // ================= B — free lesson /coach/lesson
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
      if (await page.locator('[data-testid="oneoff-error"]').count()) break;
      await sleep(1000);
    }
    return page.evaluate(() => { const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') || 'null'); return s && { id: s.lesson.id, techniqueId: s.lesson.techniqueId, directive: s.directive, coach: s.coachKind }; });
  }
  /** 준비 상태 설정 for the free lesson: the lesson waits for its practice. */
  async function freeToReady() {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session')); s.directive = 'ready'; s.state = { ...s.state, pending: null }; localStorage.setItem('martialdex:coach-oneoff-session', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('[data-testid="oneoff-answer"]', { timeout: 20000 });
    await sleep(1500);
  }
  async function freeType(text) {
    await page.fill('[data-testid="oneoff-answer"]', text);
    await page.keyboard.press('Enter');
    await sleep(2500);
  }
  const freeState = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') || 'null'); return s && { directive: s.directive, done: !!s.state.practiceDone, mitt: s.mitt?.phase ?? null, mittResult: s.mitt?.result ?? null, id: s.lesson.id }; });
  const fb0 = await freeLesson('잽 배우고 싶어');
  if (fb0?.techniqueId) {
    await freeToReady();
    let f = await freeState();
    if (f.mitt === 'posture') { await freeType('준비됐어'); f = await freeState(); }
    await freeType('아직 안 끝났어');
    const fNeg = await freeState();
    rec('B-0', '자유 수업 실습 중 "아직 안 끝났어"', '완료 안 함, 카드 없음', `done=${fNeg.done}/card=${await card()}`, !fNeg.done && !(await card()), fNeg);
    await freeType('실습 완료했어');
    const f1 = await freeState();
    rec('B-1', `자유 수업(${fb0.techniqueId}) "실습 완료했어"`, 'PRACTICE_DONE·제안 카드', `mitt=${f.mitt}→${f1.mitt}/done=${f1.done}/card=${await card()}`, f1.done && (await card()), { before: f, after: f1 });
    if (await card()) await page.click('[data-testid="lesson-pose-decline"]');
    await page.reload();
    await sleep(2500);
    rec('B-2', '"나중에 하기" 후 같은 세션(새로고침)', '재제안 없음', `card=${await card()}`, !(await card()));
    const fb1 = await freeLesson('잽 배우고 싶어');
    await freeToReady();
    let g = await freeState();
    if (g.mitt === 'posture') { await freeType('준비됐어'); g = await freeState(); }
    await freeType('다 했어');
    const g1 = await freeState();
    rec('B-3', '새 자유 수업에서 "다 했어"', '새 세션 → 다시 제안', `세션 ${fb0.id === fb1.id ? '같음' : '다름'}/done=${g1.done}/card=${await card()}`, fb0.id !== fb1.id && g1.done && (await card()));
  } else rec('B-1~3', '자유 수업 "잽 배우고 싶어"', '잽 기술 ID가 있는 수업', `수업 기술 ID 없음(${JSON.stringify(fb0)})`, null);
  const fm = await freeLesson('복싱 기본 공격 여러 개를 섞어서 연습하고 싶어');
  if (fm && !fm.techniqueId) {
    await freeToReady();
    let h = await freeState();
    if (h.mitt === 'posture') { await freeType('준비됐어'); h = await freeState(); }
    await freeType('실습 완료했어');
    const h1 = await freeState();
    rec('B-4', '기술 ID 없는 자유 수업 "실습 완료했어"', '제안 없음', `done=${h1.done}/card=${await card()}`, !(await card()), h1);
  } else rec('B-4', '기술 ID 없는 자유 수업 만들기', '—', `만들어진 수업에 기술 ID 있음 또는 실패(${JSON.stringify(fm)})`, null);

  // ================= F — formCompare
  const fc0 = await page.evaluate(() => [localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records')]);
  await page.evaluate(() => { window.location.hash = '#/arts/boxing/techniques/boxing__jab'; });
  await sleep(2500);
  if (await page.locator('[data-testid="form-compare-open"]').count()) {
    await page.click('[data-testid="form-compare-open"]');
    await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 }).catch(() => {});
    const opened = (await page.locator('[data-testid="form-compare"]').count()) > 0;
    const regOrList = (await page.locator('[data-testid="form-ref-register"]').count()) + (await page.locator('[data-testid="form-compare"] .card').count());
    rec('F-1', '기술 상세 → "기준 영상과 비교해 평가"', '기존 비교 화면(기준 영상 등록/목록)', `opened=${opened}, 카드 ${regOrList}개, step=${await page.getAttribute('[data-testid="form-compare"]', 'data-step').catch(() => null)}`, opened && regOrList > 0);
    if (await page.locator('[data-testid="form-close"]').count()) await page.click('[data-testid="form-close"]');
  } else rec('F-1', '기술 상세의 기준 영상 비교 버튼', '—', '버튼 없음', false);
  await sleep(800);
  await page.evaluate(() => { window.location.hash = '#/pose-check/boxing__jab'; });
  await page.waitForSelector('[data-testid="pose-check-camera"]', { timeout: 20000 }).catch(() => {});
  const camEnabled = await page.isEnabled('[data-testid="pose-check-camera"]').catch(() => false);
  if (camEnabled) {
    await page.click('[data-testid="pose-check-camera"]');
    await page.waitForSelector('[data-testid="pose-to-form-compare"]', { timeout: 15000 }).catch(() => {});
    if (await page.locator('[data-testid="pose-to-form-compare"]').count()) {
      await page.click('[data-testid="pose-to-form-compare"]');
      await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 }).catch(() => {});
      rec('F-2', '자세 측정 창 → "기준 시연 영상과 비교해 평가하기"', '기존 formCompare 화면이 열림(가로채지 않음)', `opened=${(await page.locator('[data-testid="form-compare"]').count()) > 0}`, (await page.locator('[data-testid="form-compare"]').count()) > 0);
      if (await page.locator('[data-testid="form-close"]').count()) await page.click('[data-testid="form-close"]');
    } else rec('F-2', '자세 측정 창의 비교 버튼', '—', '측정 창의 비교 버튼 없음', false);
  } else rec('F-2', '자세 측정 창 열기', '—', '기준 영상을 찾지 못해 측정 버튼 비활성(검색 상태에 따름)', null);
  const fc1 = await page.evaluate(() => [localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records')]);
  rec('F-3', '테스트 전후 기준 영상·비교 기록 저장값', '변경 없음', fc0[0] === fc1[0] && fc0[1] === fc1[1] ? '동일' : '변경됨', fc0[0] === fc1[0] && fc0[1] === fc1[1], { fc0, fc1 });
} finally {
  await app.close().catch(() => {});
}
console.log(`\n외부(Gemini/Supabase) 요청: ${external.length}건`, JSON.stringify(external.slice(0, 5)));
console.log(`페이지 오류: ${pageErrors.length}`, JSON.stringify(pageErrors.slice(0, 3)));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-pose-suggest-phase5.json'), JSON.stringify({ at: new Date().toISOString(), profile: 'temporary (fresh user-data-dir)', results, external, pageErrors }, null, 2));
const c = (r) => results.filter((x) => x.result === r).length;
console.log(`\n=== 통과 ${c('통과')} / 실패 ${c('실패')} / 미실행 ${c('미실행')} ===`);
