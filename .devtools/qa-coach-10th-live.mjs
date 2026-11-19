// 10차 — 전체 사용자 데이터 통합, live: real Electron app (hidden + muted), a FRESH profile (temp --user-data-dir, never signed
// in), a FAKE learner seeded through the stores' own write APIs, the real local model started by the app's engine
// control. Checks what the model received and what the learner sees, in 대화하기 and inside a lesson, and that the
// coach wrote nothing. Supabase / Gemini / Tavily hosts are blocked (main + renderer). Self-search stays OFF.
// Requires this folder's Vite dev server on :5173, nothing on :11434, qwen2.5:3b installed.
// Run: node .devtools/qa-coach-10th-live.mjs
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

// FAKE learner A (boxing), written through each store's own API
await page.evaluate(async () => {
  const FP = await import('/src/lib/fighterProfile/store.ts');
  const GS = await import('/src/lib/goals/store.ts');
  const TH = await import('/src/lib/trainingHistory/service.ts');
  const OV = await import('/src/lib/skillProgress/overrideStore.ts');
  const CB = await import('/src/lib/combo/service.ts');
  const TC = await import('/src/lib/tactic/service.ts');
  const SS = await import('/src/lib/sparringSession/service.ts');
  const CS = await import('/src/lib/selfAi/conversationStore.ts');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  FP.setItem('body.stance', { value: 'orthodox', source: 'self_report' });
  const slots = GS.goalSlots(new Date());
  GS.saveGoal('week', slots.find((s) => s.slot === 'week').periodKey, '잽 다음 훅 연결 연습');
  for (let i = 0; i < 3; i++) TH.recordTrainingSession({ date: day(i + 1), curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab', 'boxing__cross'], completed: true, estimatedMinutes: 30, actualMinutes: 30, notes: null, source: 'free_training' });
  OV.setOverride('boxing__jab', 'proficient');
  OV.setOverride('boxing__cross', 'proficient');
  OV.setOverride('boxing__slip', 'needs_improvement');
  CB.createCombo({ name: '원투', description: '', techniqueIds: ['boxing__jab', 'boxing__cross'] });
  TC.createTactic({ name: '잽 카운터', situation: '상대가 먼 거리에서 잽을 던지면', techniqueIds: ['boxing__slip', 'boxing__cross'] });
  const rules = { martialArt: 'boxing', sparringType: 'striking', plannedRounds: 3, roundDurationSeconds: 180, restDurationSeconds: 60, intensity: 'moderate', equipment: [], allowedTechniqueIds: [], prohibitedTechniqueIds: [], partnerName: null, notes: null };
  SS.recordPastSparringSession({ rules, date: day(6), actualRounds: 3, actualDurationSeconds: 540, usedTechniqueIds: ['boxing__jab', 'boxing__cross'], wentWell: '잽 거리 유지', toImprove: '가드가 내려감, 훅에 맞음' });
  SS.recordPastSparringSession({ rules, date: day(2), actualRounds: 3, actualDurationSeconds: 540, usedTechniqueIds: ['boxing__jab'], wentWell: null, toImprove: '훅 맞고 가드가 내려감' });
  const c = CS.createConversation('boxing');
  CS.appendMessage(c.id, { role: 'user', text: '슬립이 너무 어려워요 자꾸 맞아요' });
});
const snapshot = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => /fighter-profile|training-goals|training-history|skill-status|combos|tactics|sparring-rule/.test(k)).sort().map((k) => [k, localStorage.getItem(k)])));
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
      return { ms: Date.now() - t, text: out.message.text, model: out.message.model, personalData: out.message.personalData ?? null, guardNotes: out.message.guardNotes ?? [], claims: out.message.claims ?? [], prompts };
    },
    { text, extra }
  );
let r = await turn('최근 스파링 기록을 분석해 줘');
report.turns.sparring = r;
check('스파링 분석: 기록 원문·집계·앱의 판단 (실제 앱)', /■ 기록 \(/.test(r.text) && /가드가 내려감/.test(r.text) && /■ 앱의 판단/.test(r.text), r.text.slice(0, 300));
check('스파링 분석: 실제 3B 모델 해석은 "기록이 아님" 라벨로 따로', r.model && !/^martialdex-/.test(r.model) ? /■ 코치 해석 \(로컬 AI가 위 기록만 보고 쓴 의견 — 기록이 아님\)/.test(r.text) : r.guardNotes.some((n) => /해석은 붙이지 않았습니다/.test(n)), { model: r.model, ms: r.ms, tail: r.text.slice(-300) });
check('스파링 분석: 목표 기술 사용 횟수를 기록대로 (Jab 2회)', /목표에 있는 Jab: 스파링에서 사용했다고 기록한 횟수 2회/.test(r.text), r.text.split('\n').filter((l) => /목표에 있는/.test(l)));
check('기술명: 실제 모델 답변에 "잭"·영어 Jab 단독 표기 없음 (고쳤으면 안내)', !/잭/.test(r.text.split('■ 코치 해석')[1] ?? '') && !/(?<![(])\bJab\b(?![)])/.test(r.text.split('■ 코치 해석')[1] ?? ''), r.text.split('■ 코치 해석')[1]);
check('스파링 분석: 승패·성공률을 만들지 않음', !/(승리|패배|이겼|졌습니다|성공률\s*\d|\d+\s*%)/.test(r.text), r.text.slice(-300));
r = await turn('내 전술의 장단점을 분석해 줘');
report.turns.tactic = r;
check('전술 장단점: 기록 + 앱의 판단(Slip 개선 필요) + 모델 해석', /상대가 먼 거리에서 잽을 던지면/.test(r.text) && /약점: [^\n]*Slip/.test(r.text) && r.prompts.length === 1, { model: r.model, tail: r.text.slice(-300) });
r = await turn('내 숙련도를 기반으로 새로운 콤보를 추천해 줘', { martialArt: 'boxing' });
report.turns.recommend = r;
check('콤보 추천: MARTIALDEX 기록 콤보 · 저장한 원투 제외 · 모델 없이 코드', /MARTIALDEX에 기록된 콤보/.test(r.text) && r.model === 'martialdex-data' && !/^- 원투:/m.test(r.text), r.text.slice(0, 400));
r = await turn('내 콤보와 전술을 보고 다음 연습 방향을 같이 알려줘', { martialArt: 'boxing' });
report.turns.composite = r;
const p = r.prompts.at(-1) ?? '';
check('복합 질문: 실제 모델 프롬프트에 콤보·전술이 함께', /\[내 콤보/.test(p) && /\[내 전술/.test(p), p.slice(p.indexOf('[이 사용자'), p.indexOf('[이 사용자') + 500));
check('복합 질문: 실제 3B 답변 생성', r.model && !/^martialdex-/.test(r.model) && r.text.length > 40, { model: r.model, ms: r.ms, text: r.text.slice(0, 300) });
r = await turn('내가 반복적으로 어려워하는 상황을 찾아 줘');
report.turns.difficulties = r;
check('반복 어려움: 스파링 반복 + 대화 "슬립 어려워요"', /스파링 기록에서 반복/.test(r.text) && /슬립이 너무 어려워요/.test(r.text), r.text.slice(0, 400));
const after = await snapshot();
check('코치가 사용자 데이터를 바꾸지 않음 (숙련도·기록·콤보·전술·스파링 그대로)', before === after);
const blocked = await app.evaluate(() => globalThis.__blocked);
check('Gemini·Tavily·Supabase 요청 0건 (메인)', blocked.length === 0, blocked);
check('페이지 오류 없음', errors.length === 0, errors);
await app.close();
await new Promise((res) => setTimeout(res, 2500));
check('종료 후 앱이 띄운 Ollama 없음', !(await answers('http://127.0.0.1:11434/api/version')));
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nreport: ${OUT}\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
