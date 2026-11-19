// Reproduction: the in-lesson pose suggestion (4차) in the REAL lesson screen
// (CurriculumCoachSession, hidden + muted Electron, separate profile). No feature code is changed.
// Each scenario starts a real lesson run through the screen (place picker → run), then moves it
// with the screen's own inputs (typed text, the mitt runner's buttons) and reads the run state and
// whether the card [data-testid="lesson-pose-suggest"] is shown.
//   R1 대화형: "준비됐어" ×2 → practice starts → "실습 완료했어" typed      → expected by spec: suggestion
//   R2 버튼형: the practice's own stop/finish control                     → expected: suggestion
//   R3 practice running, not finished                                     → expected: none
//   R4 "나중에 하기"                                                       → expected: not again in this lesson
//   R5 a NEW jab lesson after declining                                   → expected: suggestion again
//   R6 High Single practised                                              → expected: none (not measurable)
//   R7 coach = Gemini, jab practised                                      → (shows the coach-kind gate)
//   R8 "자세 측정하기" → lesson state / learning proficiency unchanged
// Requires the Vite dev server :5173.  Run: node .devtools/qa-pose-suggest-repro.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const out = [];
function note(id, expected, observed, detail) {
  const match = expected === observed;
  out.push({ id, expected, observed, match, detail });
  console.log(`${match ? 'AS EXPECTED' : 'DIFFERS'} — ${id}: expected ${expected}, observed ${observed}${detail ? ` :: ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-pose-repro-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const errors = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.waitForLoadState('load');
  await page.setViewportSize({ width: 1200, height: 900 });
  const run = () => page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'));
  const cardShown = async () => (await page.locator('[data-testid="lesson-pose-suggest"]').count()) === 1;

  /** A real lesson for `ids` with `coach`, opened in the screen; returns when the lesson has started. */
  async function openLesson(curId, art, ids, coach) {
    await page.evaluate(async ({ curId, art, ids, coach }) => {
      localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: coach, remember: true }));
      const C = await import('/src/lib/curriculum/curriculumService.ts');
      const now = new Date().toISOString();
      C.saveCustomCurriculum({ id: curId, martialArt: art, title: `재현 ${curId}`, description: '', level: 'beginner', source: 'custom', authorName: 'qa', createdAt: now, updatedAt: now, days: [{ day: 1, title: 'd1', description: '', learningGoals: [], techniqueIds: ids, reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 20 }] });
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
  /** Put the current technique at the "ready to practise" point (engine state kept), then reload. */
  async function toReady() {
    await page.evaluate(async () => {
      const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
      S.updateCoachDayRun((r) => ({ ...r, step: 'ready', lessons: Object.fromEntries(Object.entries(r.lessons ?? {}).map(([k, v]) => [k, { ...v, pending: null }])) }));
    });
    await page.reload();
    await page.waitForSelector('[data-testid="coach-text-input"]', { timeout: 20000 });
    await sleep(1200);
  }
  async function type(text) {
    const n = await page.evaluate(() => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length);
    await page.fill('[data-testid="coach-text-input"]', text);
    await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length > n, n, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
  }
  const practiceState = async () => { const r = await run(); const id = r.techniqueIds[r.index]; return { step: r.step, current: id, practiceDone: !!r.lessons?.[id]?.practiceDone, coachKind: r.coachKind, runId: r.id }; };

  // ---- R1 / R3 / R2 — jab, MARTIALDEX coach
  await openLesson('repro-jab-1', 'boxing', ['boxing__jab', 'boxing__cross'], 'martialdex');
  await toReady();
  await type('준비됐어');
  await type('준비됐어');
  const started = await practiceState();
  note('R3 실습 시작 직후(미완료)', 'no card', (await cardShown()) ? 'card' : 'no card', started);
  await type('실습 완료했어');
  const afterTalk = await practiceState();
  const lastCoach = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg--model')].pop()?.innerText ?? '');
  note('R1 대화로 "실습 완료했어"', 'card', (await cardShown()) ? 'card' : 'no card', { before: started, after: afterTalk, coachReply: lastCoach.slice(0, 160) });
  // the practice's own control: mitt runner "stop", or the timer practice's stop button
  if (await page.locator('[data-testid="mitt-runner-stop"]').count()) await page.click('[data-testid="mitt-runner-stop"]');
  else if (await page.locator('button', { hasText: '그만' }).count()) await page.locator('button', { hasText: '그만' }).first().click();
  await sleep(2500);
  const afterButton = await practiceState();
  note('R2 실습 화면의 종료 버튼', 'card', (await cardShown()) ? 'card' : 'no card', afterButton);

  // ---- R8 accept → state / proficiency unchanged
  const learnBefore = await page.evaluate(async () => { const { loadLearnerModel } = await import('/src/lib/personalCoach/learnerStore.ts'); const l = loadLearnerModel().find((x) => /jab/.test(x.technique.id) && x.technique.martialArt === 'kickboxing' || x.technique.id === 'boxing__jab'); return l ? { p: l.proficiency, pose: l.pose } : null; });
  const keyOf = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'); const { messages, ...rest } = r; return JSON.stringify(rest); });
  if (await cardShown()) {
    const k0 = await keyOf();
    await page.click('[data-testid="lesson-pose-accept"]');
    await sleep(1500);
    const modal = (await page.locator('.pose-video, [class*="pose-"]').count()) > 0;
    await page.keyboard.press('Escape');
    const learnAfter = await page.evaluate(async () => { const { loadLearnerModel } = await import('/src/lib/personalCoach/learnerStore.ts'); const l = loadLearnerModel().find((x) => /jab/.test(x.technique.id) && x.technique.martialArt === 'kickboxing' || x.technique.id === 'boxing__jab'); return l ? { p: l.proficiency, pose: l.pose } : null; });
    note('R8 "자세 측정하기" → 기존 측정 화면, 수업 상태·학습 숙련도 불변', 'unchanged', k0 === (await keyOf()) && JSON.stringify(learnBefore) === JSON.stringify(learnAfter) && modal ? 'unchanged' : 'changed', { modal, learnBefore, learnAfter });
  } else note('R8 측정 수락', 'unchanged', 'not run (no card)');

  // ---- R4 decline in a lesson, R5 a new lesson afterwards
  await openLesson('repro-jab-2', 'boxing', ['boxing__jab', 'boxing__cross'], 'martialdex');
  await page.evaluate(async () => {
    const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
    S.updateCoachDayRun((r) => ({ ...r, step: 'practiced' }));
  });
  await page.reload();
  await sleep(3000);
  const r4a = await cardShown();
  if (r4a) await page.click('[data-testid="lesson-pose-decline"]');
  await page.reload();
  await sleep(2500);
  const r4 = await practiceState();
  note('R4 "나중에 하기" 후 같은 수업', 'no card', !r4a ? 'card never shown' : (await cardShown()) ? 'card' : 'no card', r4);
  await openLesson('repro-jab-3', 'boxing', ['boxing__jab', 'boxing__cross'], 'martialdex');
  await page.evaluate(async () => {
    const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
    S.updateCoachDayRun((r) => ({ ...r, step: 'practiced' }));
  });
  await page.reload();
  await sleep(3000);
  const r5 = await practiceState();
  note('R5 새 잽 수업(이전 거절과 별개)', 'card', (await cardShown()) ? 'card' : 'no card', { ...r5, previousRun: r4.runId });

  // ---- R6 High Single
  await openLesson('repro-single', 'wrestling', ['wrestling__high-single'], 'martialdex');
  await page.evaluate(async () => {
    const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
    S.updateCoachDayRun((r) => ({ ...r, step: 'practiced' }));
  });
  await page.reload();
  await sleep(3000);
  note('R6 하이 싱글 실습 완료(측정 기준 없음)', 'no card', (await cardShown()) ? 'card' : 'no card', await practiceState());

  // ---- R7 Gemini coach (no Gemini call is made: only the engine's local PRACTICE_DONE runs)
  await openLesson('repro-jab-gemini', 'boxing', ['boxing__jab'], 'gemini');
  await page.evaluate(async () => {
    const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
    S.updateCoachDayRun((r) => ({ ...r, step: 'practiced' }));
  });
  await page.reload();
  await sleep(3000);
  note('R7 Gemini 코치로 잽 실습 완료', 'card', (await cardShown()) ? 'card' : 'no card', await practiceState());
} finally {
  await app.close().catch(() => {});
}
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-pose-suggest-repro.json'), JSON.stringify({ at: new Date().toISOString(), results: out, pageErrors: errors }, null, 2));
console.log(`\npage errors: ${errors.length}\nsaved data/audit/self-ai/qa-pose-suggest-repro.json`);
