// 6차 — multi-part practice ended by a word, and the word repeated after the practice, in the REAL screens
// (hidden + muted Electron, a fresh temporary profile: no real user data read or written).
//   A1-A3 regular lesson, High Single (mitt → solo drill): word in the mitt / mitt stop button / word in the drill
//   A4-A6 free lesson /coach/lesson, Armbar + submission goal (takedown mitt → timer): word in the mitt / mitt stop / word in the timer
//   B1-B4 after the practice: same word again, "다 했어" again, a question, "다음으로 넘어가자"
//   C1-C5 coaches (자체 AI / Gemini) and the existing single-part ends (mitt / drill / timer, manual + auto)
//   P     pose suggestion card (shown, accept → modal → form compare, decline, no duplicate)
// "준비 상태 설정" = the saved run / session of this temporary profile moved to "ready to practise".
// Requires the Vite dev server :5173.  Run: node .devtools/qa-practice-done-phase6.mjs
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-p6-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const pageErrors = [];
const aiRequests = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { if (/generativelanguage|functions\/v1|supabase\.co/i.test(r.url())) aiRequests.push(r.url().slice(0, 120)); });
  await page.waitForLoadState('load');
  await page.setViewportSize({ width: 1200, height: 900 });
  const cardCount = () => page.locator('[data-testid="lesson-pose-suggest"]').count();

  // ---------------- regular lesson helpers
  async function openLesson(curId, art, ids, coach = 'martialdex') {
    await page.evaluate(async ({ curId, art, ids, coach }) => {
      localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: coach, remember: true }));
      const C = await import('/src/lib/curriculum/curriculumService.ts');
      const now = new Date().toISOString();
      C.saveCustomCurriculum({ id: curId, martialArt: art, title: `6차 ${curId}`, description: '', level: 'beginner', source: 'custom', authorName: 'qa', createdAt: now, updatedAt: now, days: [{ day: 1, title: 'd1', description: '', learningGoals: [], techniqueIds: ids, reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 20 }] });
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
    // 준비 상태 설정
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
  const st = () => page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run'));
    const id = r.techniqueIds[r.index];
    const l = r.lessons?.[id];
    const texts = r.messages.map((m) => m.text);
    return {
      step: r.step, cur: id, index: r.index, done: !!l?.practiceDone, stage: l?.currentStage ?? null, pending: l?.pending?.text ?? null, after: r.practiceSetup?.after ?? null,
      mitt: (r.mittSessions ?? []).length, drill: (r.drillSessions ?? []).length, outcome: r.outcomes?.[id] ?? null, drillPlan: !!r.drillPlan, practice: !!r.practice,
      drillStarted: texts.filter((t) => /솔로 드릴을 시작합니다/.test(t)).length,
      practiceDoneEvents: texts.filter((t) => /^(수고하셨습니다\.|여기까지 하신 것도 좋습니다\.)/.test(t)).length,
      reAsk: texts.filter((t) => /실습은 이미 마친 것으로 처리했습니다/.test(t)).length,
      skippedNote: texts.filter((t) => /시작하지 않았습니다/.test(t)).length,
      msgs: r.messages.length,
    };
  });
  const toMitt = async () => { await type('준비됐어'); await type('준비됐어'); return st(); };

  // ================= A1 — High Single, word in the mitt
  await openLesson('p6-a1', 'wrestling', ['wrestling__high-single']);
  const a1b = await toMitt();
  await type('실습 완료했어');
  const a1 = await st();
  rec('A1', '정규 수업 하이 싱글(미트→드릴) 미트 중 "실습 완료했어"', '드릴 없이 전체 실습 종료 → 확인 단계', `${a1b.step}(after=${a1b.after})→${a1.step}/done=${a1.done}/드릴 시작 ${a1.drillStarted}/drillPlan=${a1.drillPlan}/미트 기록 ${a1.mitt}/드릴 기록 ${a1.drill}/completed=${a1.outcome?.completed}/PRACTICE_DONE ${a1.practiceDoneEvents}회`, a1b.step === 'mitt' && a1b.after === 'drill' && a1.done && a1.step === 'review' && a1.drillStarted === 0 && !a1.drillPlan && a1.mitt === 0 && a1.drill === 0 && a1.outcome?.completed === false && a1.practiceDoneEvents === 1 && a1.skippedNote === 1, { a1b, a1 });
  rec('A1-t', '실습 시간 기록', '미트 진행 시간만(1초 이상, 드릴 시간 없음)', `practicedSeconds=${a1.outcome?.practicedSeconds}`, (a1.outcome?.practicedSeconds ?? 0) >= 1 && (a1.outcome?.practicedSeconds ?? 0) < 120);
  rec('A1-c', '하이 싱글 자세 측정 제안', '없음(측정 미지원)', `카드 ${await cardCount()}개`, (await cardCount()) === 0);

  // ================= A2 / A3 — mitt stop button → drill (unchanged), then word in the drill
  await openLesson('p6-a2', 'wrestling', ['wrestling__high-single']);
  await toMitt();
  await page.click('[data-testid="mitt-runner-stop"]');
  await sleep(2500);
  const a2 = await st();
  rec('A2', '정규 수업 하이 싱글 미트 "■ 종료" 버튼', '기존대로 드릴 시작', `${a2.step}/drillPlan=${a2.drillPlan}/드릴 시작 ${a2.drillStarted}/미트 기록 ${a2.mitt}/done=${a2.done}`, a2.step === 'drill' && a2.drillPlan && a2.drillStarted === 1 && a2.mitt === 1 && !a2.done, a2);
  await type('실습 완료했어');
  const a3 = await st();
  rec('A3', '이어진 드릴 중 "실습 완료했어"', '전체 실습 종료(드릴 기록 없음, 미트 기록 1 그대로)', `${a3.step}/done=${a3.done}/미트 ${a3.mitt}/드릴 ${a3.drill}/PRACTICE_DONE ${a3.practiceDoneEvents}회`, a3.step === 'review' && a3.done && a3.mitt === 1 && a3.drill === 0 && a3.practiceDoneEvents === 1, a3);

  // ================= B1-B4 (regular) — jab lesson, after the practice
  await openLesson('p6-b', 'boxing', ['boxing__jab', 'boxing__cross']);
  await toMitt();
  await type('실습 완료했어');
  const b0 = await st();
  rec('C1', '자체 AI 코치 잽 미트 중 "실습 완료했어"', '실습 완료 → 확인 단계 + 자세 측정 제안', `${b0.step}/done=${b0.done}/stage=${b0.stage}/카드 ${await cardCount()}개`, b0.step === 'review' && b0.done && b0.stage === 'PRACTICE_REVIEW' && (await cardCount()) === 1, b0);
  await type('실습 완료했어');
  const b1 = await st();
  rec('B1', '실습 직후 "실습 완료했어" 반복', '확인 단계 유지(같은 기술·같은 질문), 이벤트·기록 중복 없음', `${b1.step}/기술 ${b1.cur}/stage=${b1.stage}/같은 질문=${b1.pending === b0.pending}/재안내 ${b1.reAsk}/PRACTICE_DONE ${b1.practiceDoneEvents}/미트 ${b1.mitt}/카드 ${await cardCount()}`, b1.step === 'review' && b1.cur === b0.cur && b1.stage === 'PRACTICE_REVIEW' && b1.pending === b0.pending && b1.reAsk === 1 && b1.practiceDoneEvents === 1 && b1.mitt === b0.mitt && (await cardCount()) <= 1, { b0, b1 });
  await type('다 했어');
  const b2 = await st();
  rec('B2', '실습 직후 "다 했어" 반복', '확인 단계 유지', `${b2.step}/기술 ${b2.cur}/stage=${b2.stage}/재안내 ${b2.reAsk}`, b2.step === 'review' && b2.cur === b0.cur && b2.stage === 'PRACTICE_REVIEW' && b2.reAsk === 2 && b2.practiceDoneEvents === 1, b2);
  // P — the pose card on this lesson
  if ((await cardCount()) === 1) {
    const pose0 = await page.evaluate(() => [localStorage.getItem('martialdex:pose-records'), localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records')]);
    await page.click('[data-testid="lesson-pose-accept"]');
    await page.waitForSelector('[data-testid="pose-to-form-compare"]', { timeout: 15000 }).catch(() => {});
    const title = (await page.textContent('.pose-modal h3').catch(() => '')) ?? '';
    let formOpened = false;
    if (await page.locator('[data-testid="pose-to-form-compare"]').count()) {
      await page.click('[data-testid="pose-to-form-compare"]');
      await page.waitForSelector('[data-testid="form-compare"]', { timeout: 15000 }).catch(() => {});
      formOpened = (await page.locator('[data-testid="form-compare"]').count()) > 0;
      if (await page.locator('[data-testid="form-close"]').count()) await page.click('[data-testid="form-close"]');
      await sleep(1000);
    }
    const p1 = await st();
    const pose1 = await page.evaluate(() => [localStorage.getItem('martialdex:pose-records'), localStorage.getItem('martialdex:form-reference-videos'), localStorage.getItem('martialdex:form-compare-records')]);
    rec('P1', '제안 카드 "자세 측정하기" → 측정 창 → 기준 영상 비교 → 닫기', 'Jab 측정 창, 비교 화면 열림, 수업 상태·저장값 불변, 카드 다시 안 뜸', `title="${title.trim()}"/비교 화면=${formOpened}/step=${p1.step}/stage=${p1.stage}/저장값 동일=${JSON.stringify(pose0) === JSON.stringify(pose1)}/카드 ${await cardCount()}`, /Jab/.test(title) && formOpened && p1.step === 'review' && p1.stage === 'PRACTICE_REVIEW' && JSON.stringify(pose0) === JSON.stringify(pose1) && (await cardCount()) === 0);
  } else rec('P1', '제안 카드 수락', '—', '카드 없음', false);
  const q0 = await st();
  await type('잽을 뻗을 때 턱은 어떻게 해?', 3000);
  const b3 = await st();
  const b3reply = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg--model')].pop()?.innerText ?? '');
  rec('B3', '실습 후 일반 질문', '기존처럼 질문에 답변(반복 안내 아님, 진행 안 함)', `답변 있음=${b3.msgs > q0.msgs + 1}/재안내 ${b3.reAsk}(전 ${q0.reAsk})/기술 ${b3.cur}`, b3.msgs > q0.msgs + 1 && b3.reAsk === q0.reAsk && b3.cur === q0.cur, { reply: b3reply.slice(0, 160) });
  await type('다음으로 넘어가자', 3000);
  const b4 = await st();
  const b4texts = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg--model')].slice(-4).map((e) => e.innerText));
  rec('B4', '실습 후 "다음으로 넘어가자"', '기존 진행 규칙(질문 건너뛰기 → 다음 진행), 반복 안내 아님', `stage=${b4.stage}/기술 ${b4.cur}/step ${b4.step}/재안내 ${b4.reAsk}/"넘어가겠습니다"=${b4texts.some((t) => /넘어가겠습니다/.test(t))}`, b4.reAsk === b3.reAsk && (b4.stage !== 'PRACTICE_REVIEW' || b4.cur !== b3.cur) && b4texts.some((t) => /넘어가겠습니다/.test(t)), { b4, b4texts });

  // ================= C2 — Gemini coach: chain + repeat (no Gemini call expected for these inputs)
  const ai0 = aiRequests.length;
  await openLesson('p6-c2', 'wrestling', ['wrestling__high-single'], 'gemini');
  await toMitt();
  await type('실습 완료했어');
  const c2 = await st();
  await type('실습 완료했어');
  const c2b = await st();
  rec('C2', 'Gemini 코치 하이 싱글 미트 중 완료 → 반복', '자체 AI와 같은 처리(드릴 없이 종료, 반복은 확인 단계 유지), Gemini 요청 없음', `${c2.step}/done=${c2.done}/드릴 시작 ${c2.drillStarted}/반복 후 stage=${c2b.stage}/재안내 ${c2b.reAsk}/Gemini 요청 ${aiRequests.length - ai0}`, c2.step === 'review' && c2.done && c2.drillStarted === 0 && c2b.stage === 'PRACTICE_REVIEW' && c2b.reAsk === 1 && aiRequests.length === ai0, { c2, c2b });

  // ================= C3 — single mitt stop button (jab)
  await openLesson('p6-c3', 'boxing', ['boxing__jab']);
  await toMitt();
  await page.click('[data-testid="mitt-runner-stop"]');
  await sleep(2500);
  const c3 = await st();
  rec('C3', '단일 미트(잽) "■ 종료" 버튼', '기존 기록 유지(미트 기록 1, 확인 단계, 카드)', `${c3.step}/done=${c3.done}/미트 ${c3.mitt}/카드 ${await cardCount()}/PRACTICE_DONE ${c3.practiceDoneEvents}`, c3.step === 'review' && c3.done && c3.mitt === 1 && (await cardCount()) === 1 && c3.practiceDoneEvents === 1, c3);
  if ((await cardCount()) === 1) {
    await page.click('[data-testid="lesson-pose-decline"]');
    await page.reload();
    await sleep(2500);
    rec('P2', '"나중에 하기" → 새로고침', '같은 수업에서 다시 제안 안 함', `카드 ${await cardCount()}개`, (await cardCount()) === 0);
  }

  // ================= C4 — single drill (a technique whose practice is the drill alone)
  const drillOnly = await page.evaluate(async () => {
    const P = await import('/src/lib/aiCoachDay/practicePlan.ts');
    const { getUnifiedTechniquesByMartialArt } = await import('/src/lib/userTechniques/service.ts');
    for (const art of ['wrestling', 'bjj', 'judo', 'sambo']) for (const t of getUnifiedTechniquesByMartialArt(art)) {
      const s = P.planPractice(t, { location: 'home', mma: false, submissionGoal: false, seconds: 60, art });
      if (!s.mitt && s.drill) return { id: t.id, art };
    }
    return null;
  });
  if (drillOnly) {
    await openLesson('p6-c4', drillOnly.art, [drillOnly.id]);
    await type('준비됐어');
    await type('준비됐어');
    const c4a = await st();
    if (c4a.step === 'drill') {
      if (await page.locator('[data-testid="solo-drill-start"]').count()) { await page.click('[data-testid="solo-drill-start"]'); await sleep(2000); }
      await page.click('[data-testid="solo-drill-stop"]');
      await sleep(2500);
      const c4 = await st();
      rec('C4', `단일 드릴(${drillOnly.id}) "종료" 버튼`, '기존 기록 유지(드릴 기록 1, 확인 단계)', `${c4.step}/done=${c4.done}/드릴 ${c4.drill}/PRACTICE_DONE ${c4.practiceDoneEvents}`, c4.step === 'review' && c4.done && c4.drill === 1 && c4.practiceDoneEvents === 1, c4);
    } else rec('C4', '단일 드릴', '—', `드릴 단계 아님(${c4a.step})`, null, c4a);
  } else rec('C4', '단일 드릴 기술 찾기', '—', '드릴만 쓰는 기술 없음', null);

  // ================= C5 — single timer: manual stop and auto end (bjj armbar)
  await openLesson('p6-c5', 'bjj', ['bjj__armbar']);
  await type('준비됐어');
  await type('준비됐어');
  if ((await st()).step === 'practice') {
    await page.locator('button', { hasText: '여기서 끝내기' }).click();
    await sleep(2500);
    const c5 = await st();
    rec('C5-a', '단일 타이머 "■ 여기서 끝내기"', '기존대로 확인 단계, completed=false', `${c5.step}/done=${c5.done}/completed=${c5.outcome?.completed}`, c5.step === 'review' && c5.done && c5.outcome?.completed === false, c5);
  } else rec('C5-a', '단일 타이머', '—', `타이머 단계 아님(${(await st()).step})`, null);
  await openLesson('p6-c5b', 'bjj', ['bjj__armbar']);
  await type('준비됐어');
  await type('준비됐어');
  if ((await st()).step === 'practice') {
    await page.evaluate(async () => { const S = await import('/src/lib/aiCoachDay/sessionStore.ts'); S.updateCoachDayRun((r) => (r.practice ? { ...r, practice: { ...r.practice, phaseEndTimestamp: Date.now() - 1, firedCueIds: [] } } : r)); });
    await sleep(3000);
    const c5b = await st();
    rec('C5-b', '단일 타이머 자동 종료(남은 시간 0으로 설정)', '기존대로 확인 단계, completed=true', `${c5b.step}/done=${c5b.done}/completed=${c5b.outcome?.completed}`, c5b.step === 'review' && c5b.done && c5b.outcome?.completed === true, c5b);
  } else rec('C5-b', '타이머 자동 종료', '—', '타이머 단계 아님', null);

  // ---------------- free lesson helpers
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
    // 준비 상태 설정: the engine at PRACTICE (→ directive 'ready')
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session'));
      s.directive = 'ready';
      s.state = { ...s.state, currentStage: 'PRACTICE', pending: null, practiceDone: false };
      localStorage.setItem('martialdex:coach-oneoff-session', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForSelector('[data-testid="oneoff-answer"]', { timeout: 20000 });
    await sleep(1500);
    const info = await page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session'));
      const M = await import('/src/lib/coachLesson/oneOffMitt.ts');
      const p = M.oneOffPractice(s.lesson);
      return { techniqueId: s.lesson.techniqueId, after: p?.after ?? null, mitt: !!p?.mitt };
    });
    if ((await fst()).mitt === 'posture') await freeType('준비됐어');
    return info;
  }
  async function freeType(text, wait = 3000) {
    await page.fill('[data-testid="oneoff-answer"]', text);
    await page.keyboard.press('Enter');
    await sleep(wait);
  }
  const fst = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') || 'null');
    if (!s) return null;
    const texts = s.messages.map((m) => m.text);
    return {
      id: s.lesson.id, directive: s.directive, stage: s.state.currentStage, done: !!s.state.practiceDone, pending: s.state.pending?.text ?? null, mitt: s.mitt?.phase ?? null, mittResult: s.mitt?.result ?? null,
      plan: !!s.plan, run: s.run?.phase ?? null, workout: s.workoutResult ? { worked: s.workoutResult.workedSeconds } : null,
      practiceDoneEvents: texts.filter((t) => /^(수고하셨습니다\.|여기까지 하신 것도 좋습니다\.)/.test(t)).length,
      reAsk: texts.filter((t) => /실습은 이미 마친 것으로 처리했습니다/.test(t)).length,
      skippedNote: texts.filter((t) => /시작하지 않/.test(t)).length,
      completedHead: texts.filter((t) => /^수고하셨습니다\./.test(t)).length,
    };
  });

  // ================= A4 — free lesson Armbar with a submission goal (takedown mitt → timer), word in the mitt
  const f4 = await freeLesson('주짓수 암바 서브미션 배우고 싶어');
  const a4b = await fst();
  if (f4.after) {
    await freeType('실습 완료했어');
    const a4 = await fst();
    rec('A4', `자유 수업 ${f4.techniqueId}(미트→${f4.after}) 미트 중 "실습 완료했어"`, '타이머 시작 없이 전체 실습 종료', `mitt ${a4b.mitt}→${a4.mitt}/result=${JSON.stringify(a4.mittResult)}/plan=${a4.plan}/run=${a4.run}/done=${a4.done}/directive=${a4.directive}/PRACTICE_DONE ${a4.practiceDoneEvents}/completed 머리말 ${a4.completedHead}`, a4b.mitt === 'running' && a4.mitt === 'done' && a4.mittResult === null && !a4.plan && a4.run === null && a4.done && a4.directive === 'review' && a4.practiceDoneEvents === 1 && a4.completedHead === 0 && a4.skippedNote === 1, { f4, a4b, a4 });
    // B1 (free) — repeat, then reload
    await freeType('실습 완료했어');
    const fb1 = await fst();
    await page.reload();
    await page.waitForSelector('[data-testid="oneoff-answer"]', { timeout: 20000 });
    await sleep(1500);
    const fb1r = await fst();
    rec('B1-free', '자유 수업 실습 직후 "실습 완료했어" 반복 → 새로고침', '확인 단계 유지, 이벤트 중복 없음, 새로고침 후 같은 상태', `stage=${fb1.stage}/같은 질문=${fb1.pending === a4.pending}/재안내 ${fb1.reAsk}/PRACTICE_DONE ${fb1.practiceDoneEvents}/새로고침 후 동일=${JSON.stringify(fb1) === JSON.stringify(fb1r)}`, fb1.stage === 'PRACTICE_REVIEW' && fb1.pending === a4.pending && fb1.reAsk === 1 && fb1.practiceDoneEvents === 1 && JSON.stringify(fb1) === JSON.stringify(fb1r), { fb1, fb1r });
    await freeType('다 했어');
    const fb2 = await fst();
    rec('B2-free', '자유 수업 실습 직후 "다 했어" 반복', '확인 단계 유지', `stage=${fb2.stage}/재안내 ${fb2.reAsk}`, fb2.stage === 'PRACTICE_REVIEW' && fb2.reAsk === 2 && fb2.practiceDoneEvents === 1, fb2);
  } else rec('A4', '자유 수업 미트→타이머 수업', '—', `이 수업의 실습에 연결 단계 없음(${JSON.stringify(f4)})`, null);

  // ================= A5 / A6 — free lesson: mitt stop button → timer plan; start; word in the timer
  const f5 = await freeLesson('주짓수 암바 서브미션 배우고 싶어');
  if (f5.after && (await page.locator('[data-testid="mitt-runner-stop"]').count())) {
    await page.click('[data-testid="mitt-runner-stop"]');
    await sleep(2500);
    const a5 = await fst();
    rec('A5', '자유 수업 미트 "■ 종료" 버튼', '기존대로 타이머(마무리 반복) 계획 → 실습 계속', `mitt=${a5.mitt}/result=${!!a5.mittResult}/plan=${a5.plan}/done=${a5.done}/directive=${a5.directive}`, a5.mitt === 'done' && !!a5.mittResult && a5.plan && !a5.done && a5.directive === 'ready', a5);
    await freeType('시작');
    const a6a = await fst();
    if (a6a.run && a6a.run !== 'done') {
      await sleep(2000);
      await freeType('실습 완료했어');
      const a6 = await fst();
      rec('A6', '자유 수업 타이머 중 "실습 완료했어"', '타이머 종료(실제 시간만) + 전체 실습 종료', `run ${a6a.run}→${a6.run}/workout=${JSON.stringify(a6.workout)}/done=${a6.done}/directive=${a6.directive}/PRACTICE_DONE ${a6.practiceDoneEvents}`, a6.run === 'done' && a6.done && a6.directive === 'review' && a6.practiceDoneEvents === 1, a6);
    } else rec('A6', '자유 수업 타이머 시작', '—', `타이머가 시작되지 않음(run=${a6a.run})`, null, a6a);
  } else rec('A5/A6', '자유 수업 미트 종료 버튼', '—', `연결 실습 없음 또는 미트 화면 없음(${JSON.stringify(f5)})`, null);

  // ================= A5b — mitt stop → timer planned but never started → word → not completed
  const f5b = await freeLesson('주짓수 암바 서브미션 배우고 싶어');
  if (f5b.after && (await page.locator('[data-testid="mitt-runner-stop"]').count())) {
    await page.click('[data-testid="mitt-runner-stop"]');
    await sleep(2500);
    await freeType('실습 완료했어');
    const a5b = await fst();
    rec('A5b', '자유 수업 미트 버튼 종료 후 타이머 시작 전 "실습 완료했어"', '전체 종료, 하지 않은 타이머는 완료로 기록 안 함', `done=${a5b.done}/run=${a5b.run}/workout=${JSON.stringify(a5b.workout)}/완료 머리말 ${a5b.completedHead}/안내 ${a5b.skippedNote}`, a5b.done && a5b.run === null && a5b.workout === null && a5b.completedHead === 0 && a5b.skippedNote === 1, a5b);
  }

  // ================= free lesson pose card (jab) still offered
  await freeLesson('잽 배우고 싶어');
  await freeType('실습 완료했어');
  const fj = await fst();
  rec('P3', '자유 수업(잽) 완료 → 자세 측정 제안', '카드 1개', `done=${fj.done}/카드 ${await cardCount()}`, fj.done && (await cardCount()) === 1);
} finally {
  await app.close().catch(() => {});
}
console.log(`\nGemini/Supabase 요청: ${aiRequests.length}건`, JSON.stringify(aiRequests.slice(0, 5)));
console.log(`페이지 오류: ${pageErrors.length}`, JSON.stringify(pageErrors.slice(0, 3)));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-practice-done-phase6.json'), JSON.stringify({ at: new Date().toISOString(), profile: 'temporary (fresh user-data-dir)', results, aiRequests, pageErrors }, null, 2));
const c = (r) => results.filter((x) => x.result === r).length;
console.log(`\n=== PASS ${c('PASS')} / FAIL ${c('FAIL')} / NOT RUN ${c('NOT RUN')} ===`);
