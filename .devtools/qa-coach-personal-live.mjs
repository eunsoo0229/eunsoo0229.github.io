// 9차 — AI 코치 개인화, live: real Electron app (hidden + muted), a FRESH profile (temp --user-data-dir, never signed
// in), a FAKE learner seeded through the stores' own write APIs, the real local model started by the app's engine
// control. Checks what the model received and what the learner sees, in 대화하기 and inside a lesson, and that the
// coach wrote nothing. Supabase / Gemini / Tavily hosts are blocked (main + renderer). Self-search stays OFF.
// Requires this folder's Vite dev server on :5173, nothing on :11434, qwen2.5:3b installed.
// Run: node .devtools/qa-coach-personal-live.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); // this checkout (original or a dev copy)
const OUT = process.env.QA_OUT || path.join(os.tmpdir(), 'mdex-coach-personal-live.json');
const BLOCKED = /generativelanguage\.googleapis\.com|api\.tavily\.com|supabase\.co/i;
let pass = 0;
let fail = 0;
const report = { checks: [], turns: {} };
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  report.checks.push({ name, ok, info });
  const d = info === undefined ? '' : typeof info === 'string' ? info : JSON.stringify(info);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${d ? ` :: ${d.slice(0, 400)}` : ''}`);
};
const answers = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
if (await answers('http://127.0.0.1:11434/api/version')) {
  console.log('SKIP — something already answers on :11434 (not ours; left untouched).');
  process.exit(0);
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-coach-personal-'));
const env = { ...process.env, MARTIALDEX_HEADLESS: '1', GEMINI_API_KEY: '', TAVILY_API_KEY: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${userData}`], env, timeout: 120000 });
await app.evaluate(() => {
  const orig = globalThis.fetch;
  globalThis.__blocked = [];
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/generativelanguage\.googleapis\.com|api\.tavily\.com|supabase\.co/i.test(url)) {
      globalThis.__blocked.push(url);
      return Promise.reject(new TypeError('blocked by QA'));
    }
    return orig(input, init);
  };
});
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.route(BLOCKED, (route) => route.abort());
await page.goto('http://localhost:5173/#/coach/chat');
await page.waitForSelector('[data-testid="self-ai-status"]', { timeout: 60000 });
const signedIn = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase/client.ts');
  const s = supabase ? await supabase.auth.getSession().catch(() => null) : null;
  return !!s?.data?.session;
});
check('준비: 로그인 안 한 새 프로필 (운영 계정 사용 안 함)', signedIn === false);
const eng = await page.evaluate(() => window.martialdex.localEngine.start({}));
check('준비: 로컬 AI 엔진 시작 (앱 소유)', eng.ok === true, eng);

// FAKE learner, written through each store's own API
await page.evaluate(async () => {
  const FP = await import('/src/lib/fighterProfile/store.ts');
  const GS = await import('/src/lib/goals/store.ts');
  const GR = await import('/src/lib/gymRoutine/service.ts');
  const TH = await import('/src/lib/trainingHistory/service.ts');
  const today = new Date().toISOString().slice(0, 10);
  FP.setItem('body.wingspan', { value: 183, source: 'measured', measurement: { kind: 'body', unit: 'cm', method: null, measuredAt: today, confidence: 'high' } });
  FP.setItem('body.stance', { value: 'southpaw', source: 'self_report' });
  const slots = GS.goalSlots(new Date());
  GS.saveGoal('week', slots.find((s) => s.slot === 'week').periodKey, '잽 정확도 올리기, 주 3회 훈련');
  GS.saveGoal('month', slots.find((s) => s.slot === 'month').periodKey, '아마추어 스파링 준비');
  const r = GR.createGymRoutine('QA 근력 루틴');
  GR.addExerciseToDay(GR.getGymRoutine(r.id), 1, { techniqueId: 'gym-바벨-백스쿼트', targetSets: 3, targetReps: [10, 10, 8], targetSeconds: null, targetWeightKg: [40, 45, 50], restSeconds: 60 });
  GR.setActiveGymRoutine(r.id);
  TH.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab'], completed: true, estimatedMinutes: 30, actualMinutes: 35, notes: 'QA 메모: 잽 후 가드가 내려감', source: 'free_training' });
});
const snapshot = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => /fighter-profile|training-goals|gym-routines|training-history|pose-records|skill-status/.test(k)).sort().map((k) => [k, localStorage.getItem(k)])));
const before = await snapshot();

const turn = (text, extra = {}) =>
  page.evaluate(
    async ({ text, extra }) => {
      const { runCoachTurn } = await import('/src/lib/selfAi/coachAgent.ts');
      const { appCoachDeps } = await import('/src/lib/selfAi/deps.ts');
      const deps = appCoachDeps();
      const prompts = [];
      const chat = deps.chat;
      deps.chat = (req, onDelta) => (prompts.push(req.messages[0].content), chat(req, onDelta));
      const t = Date.now();
      const out = await runCoachTurn({ text, history: [], requestId: `qa-${Date.now()}`, ...extra }, deps);
      return { ms: Date.now() - t, text: out.message.text, model: out.message.model, personalData: out.message.personalData ?? null, guardNotes: out.message.guardNotes ?? [], prompts };
    },
    { text, extra }
  );

let r = await turn('내 리치가 얼마야?');
report.turns.reach = r;
check('대화하기: 리치 = 저장된 183cm (코드 답변, 모델이 숫자를 바꿔 말하지 않음)', /183/.test(r.text) && r.model === 'martialdex-data' && r.prompts.length === 0, r.text.slice(0, 200));
r = await turn('이번 주 목표가 뭐였지?', { inLesson: true, lessonTechniqueId: 'boxing__jab' });
report.turns.goalInLesson = r;
check('수업하기 중 질문: 같은 저장 목표 + 수업 이어짐', r.text.includes('잽 정확도 올리기') && /수업은 하던 단계에서 그대로 이어집니다/.test(r.text), r.text.slice(0, 200));
r = await turn('이번 달 목표 얼마나 달성했어?');
report.turns.monthProgress = r;
check('달성률: 기록 대조 + 근거 없는 % 계산 안 함', /완료 1회/.test(r.text) && /달성률\(%\)은 계산하지 않았습니다/.test(r.text), r.text.slice(0, 300));
r = await turn('내 훈련 루틴을 개선해 줘');
report.turns.routineImprove = r;
const p = r.prompts[0] ?? '';
check('루틴 개선: 모델 프롬프트에 실제 루틴·목표·훈련 메모가 들어감', /QA 근력 루틴/.test(p) && /잽 정확도/.test(p) && /가드가 내려감/.test(p), p.slice(p.indexOf('[이 사용자'), p.indexOf('[이 사용자') + 500));
check('루틴 개선: 로컬 AI 답변 생성 (실제 모델)', r.model && !/^martialdex-/.test(r.model) && r.text.length > 60, { model: r.model, ms: r.ms });
check('루틴 개선: 답변이 저장된 루틴/목표를 실제로 언급 (스쿼트·루틴 이름·잽·주 3회 중 하나)', /(스쿼트|squat|QA 근력 루틴|잽|주 3회)/i.test(r.text), r.text.slice(0, 400));
r = await turn('복싱 잽 수업 만들어 줘', { martialArt: 'boxing' });
report.turns.lessonPlan = r;
check('수업 계획: "나에게 맞춘 점" — 잽 학습 기록 · 이번 주 목표 연결 · 사우스포', /나에게 맞춘 점/.test(r.text) && /Jab: /.test(r.text) && /이번 주 목표/.test(r.text) && /사우스포/.test(r.text), r.text.slice(r.text.indexOf('• 나에게')).slice(0, 400));
const after = await snapshot();
check('코치가 사용자 데이터를 바꾸지 않음 (목표·루틴·기록·프로필·숙련도 그대로)', before === after);
const blocked = await app.evaluate(() => globalThis.__blocked);
check('Gemini·Tavily·Supabase 요청 0건 (메인)', blocked.length === 0, blocked);
check('페이지 오류 없음', errors.length === 0, errors);
await app.close();
await new Promise((res) => setTimeout(res, 2500));
check('종료 후 앱이 띄운 Ollama 없음', !(await answers('http://127.0.0.1:11434/api/version')));
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nreport: ${OUT}\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
