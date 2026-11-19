// 자체 AI 코치 — 기술 질문 답변 · MARTIALDEX 기능 실행 요청 · 로컬 모델 기본 꺼짐 (offline, real data).
// Counts Gemini (askAi) and local-model (localAi.ask) calls through fake window bridges: both must stay 0
// on the default path. Every route the coach opens is checked against the real <Route>s in src/App.tsx.
// Run: node .devtools/test-coach-actions.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-actions-'));
const out = path.join(dir, 'a.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * from ${mod('src/lib/coachKnowledge/featureCatalog.ts')};`,
    `export * from ${mod('src/lib/coachKnowledge/questions.ts')};`,
    `export { martialdexCoach, geminiCoach } from ${mod('src/lib/coachProvider/backend.ts')};`,
    `export { localModelEnabled, LOCAL_MODEL_KEY } from ${mod('src/lib/coachProvider/localModel.ts')};`,
    `export { resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
    `export { classifyIntent } from ${mod('src/lib/coachLesson/intent.ts')};`,
  ].join('\n')
);
const calls = { gemini: 0, local: 0 };
const mem = new Map();
globalThis.window = {
  localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  dispatchEvent: () => true,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
  location: { href: 'http://localhost/', search: '', hash: '' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  // the Mac app's bridges, counted (Ollama "available" — the coach must still not call it by default)
  martialdex: {
    askAi: async () => {
      calls.gemini++;
      return { ok: false, code: 'UNEXPECTED', message: 'no Gemini in the 자체 코치' };
    },
    localAi: {
      status: async () => ({ ok: true, running: true, model: 'fake', models: ['fake'], reason: null }),
      ask: async () => {
        calls.local++;
        return { ok: true, text: '잽을 칠 때는 반대 손 가드를 끝까지 유지하세요.', model: 'fake', evalCount: 5, ms: 10 };
      },
    },
  },
};
globalThis.localStorage = window.localStorage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const K = await import(pathToFileURL(out).href);

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 360) : ''));
}
const T = (id) => K.resolveTechnique(id);
const ask = (current, q) => K.answerCoachQuestion(current, q, { useModel: false });
const act = (text, ctx = {}) => K.planCoachAction(text, { camera: true, ...ctx });

// real routes of the app
const appSrc = fs.readFileSync(path.join(APP, 'src/App.tsx'), 'utf8');
const routes = [...appSrc.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*');
const routeExists = (url) => {
  const p = decodeURIComponent(url.split('?')[0]);
  return routes.some((r) => new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}$`).test(p));
};

// =============================================================== 1. 기술 질문 (자료 기반)
{
  const jab = T('kickboxing__jab');
  let a = await ask(null, '잽은 어떻게 해?');
  check('[K1] 한국어 기술명 질문(수업 밖) "잽은 어떻게 해?" → 잽의 동작 단계 자료', a.kind === 'single' && a.techniqueIds[0] === jab.id && /동작 단계/.test(a.text) && /MARTIALDEX 자료에 따르면/.test(a.text), a.text);
  a = await ask(null, 'Jab의 핵심 포인트가 뭐야?');
  check('[K2] 영어 기술명 질문 → 같은 기술의 핵심 포인트', a.kind === 'single' && a.techniqueIds[0] === jab.id && /핵심 포인트/.test(a.text), a.text);
  a = await ask(null, '잽을 할 때 발은 어떻게 둬?');
  check('[K3] 세부 질문(발 위치) → 발 관련 자료만', a.kind === 'single' && /발 위치/.test(a.text) && /발/.test(a.text), a.text);
  a = await ask(jab, '이 기술에서 흔히 하는 실수는?');
  check('[K4] 수업 중 "이 기술" + 활용형("흔히 하는 실수") → 지금 기술의 흔한 실수', a.kind === 'single' && /흔한 실수/.test(a.text), a.text);
  a = await ask(null, '암바와 삼각조르기는 어떻게 달라?');
  check('[K5] 두 기술 비교 → 각 기술의 자료를 따로 확인해 나란히 (삼각조르기 = Triangle Choke)', a.kind === 'compare' && a.techniqueIds.includes('bjj__armbar') && a.techniqueIds.includes('bjj__triangle-choke') && /Armbar|암바/.test(a.text) && /Triangle|트라이앵글/.test(a.text) && /추측하지 않습니다/.test(a.text), a.text);
  a = await ask(T('bjj__armbar'), '이 기술 다음에 연결할 만한 기술이 있어?');
  check('[K6] 관련 기술 → 실제로 연결된 기술만 (데이터의 관련 기술)', a.kind === 'single' && /관련 기술/.test(a.text), a.text);
  a = await ask(null, '페인트는 어떻게 해?');
  check('[K7] 모호한 기술명 → 후보 제시, 자동 선택 없음', a.kind === 'ambiguous' && (a.candidates?.length ?? 0) >= 2, a.text);
  a = await ask(T('bjj__rear-naked-choke'), '발은 어떻게 해요?');
  check('[K8] 데이터에 없는 세부(RNC 발 위치) → "자료에 없음", 추측 없음', /내용이 없습니다/.test(a.text) && /추측/.test(a.text), a.text);
  a = await ask(T('bjj__rear-naked-choke'), '팔은 어디에 두고 발은 어떻게 해요?');
  check('[K9] 일부만 있는 질문 → 확인된 것(팔)과 확인되지 않은 것(발) 분리', /팔/.test(a.text) && /확인되지 않았습니다/.test(a.text), a.text);
  a = await ask(null, '클로즈드 가드에서 쓸 수 있는 기술은?');
  check('[K10] 상황별 기술 → 자료에 그 상황(포지션)으로 표시된 기술 목록', a.kind === 'situation' && a.techniqueIds.includes('bjj__armbar'), a.text);
  a = await ask(jab, '이 기술을 연습할 때 MARTIALDEX에서 어떤 기능을 쓰면 돼?');
  check('[K11] 연습 기능 질문 → 이 기술을 실제로 연습할 수 있는 MARTIALDEX 기능 (미트·복습·타이머 …)', a.kind === 'practice' && /Visualizing Mitt/.test(a.text) && /복습/.test(a.text), a.text);
  a = await ask(null, '어떻게 해?');
  check('[K12] 기술이 없는 질문 → 기술 이름을 물음 (추측 없음)', a.kind === 'no_technique', a.text);
  const pending = { conceptId: 'kp-0', type: 'explain', purpose: 'check', text: '핵심이 뭐였나요?', choice: null, tries: 1 };
  check('[K14] 코치 질문이 걸려 있어도 "이 기술에서 흔히 하는 실수는?"은 질문으로 인식 (짧은 추측 답 "팔꿈치?"는 그대로 답)', K.classifyIntent('이 기술에서 흔히 하는 실수는?', pending) === 'question' && K.classifyIntent('팔꿈치?', pending) === 'answer', [K.classifyIntent('이 기술에서 흔히 하는 실수는?', pending), K.classifyIntent('팔꿈치?', pending)]);
  check('[K13] 기술 질문은 기능 실행으로 오인하지 않음 (화면 이동 없음)', act('잽은 어떻게 해?') === null && act('이 기술을 연습할 때 어떤 기능을 쓰면 돼?') === null);
}

// =============================================================== 2. 기능 실행 요청
{
  let a = act('레슬링 솔로 드릴 하고 싶어');
  check('[A1] "레슬링 솔로 드릴 하고 싶어" → 기존 미트의 레슬링 공격 지시(솔로 드릴) 화면', a?.ok && a.featureId === 'mitt_command' && a.route === '/coach/mitt?tab=command&art=wrestling' && routeExists(a.route), a);
  a = act('잽 연습하고 싶어');
  check('[A2] "잽 연습하고 싶어" → Visualizing Mitt 단일 기술 (기존 combo=single:<id>)', a?.ok && a.featureId === 'mitt_technique' && decodeURIComponent(a.route) === '/coach/mitt?combo=single:kickboxing__jab', a);
  a = act('내 자세를 확인하고 싶어');
  check('[A3] 기술 없이 "내 자세 확인" → 어떤 기술인지 묻기 (실행한 척 없음)', a && !a.ok && a.reason === 'needs_choice', a);
  a = act('내 자세를 확인하고 싶어', { current: T('kickboxing__jab'), inLesson: true });
  check('[A4] 수업 중 자세 확인 → 이 기기 자세 분석(?open=pose), 수업 저장·복귀 안내 + 확인 요청', a?.ok && a.featureId === 'pose_check' && /open=pose/.test(a.route) && a.confirm && /뒤로 가기로 돌아오면/.test(a.message) && routeExists(a.route), a);
  a = act('내 자세를 확인하고 싶어', { current: T('kickboxing__jab'), camera: false });
  check('[A5] 카메라가 없는 기기 → 지원되지 않음을 알림 (열지 않음)', a && !a.ok && a.reason === 'unsupported', a);
  a = act('스파링 영상을 분석하고 싶어');
  check('[A6] 스파링 영상 분석 → /sparring, 그 기능이 쓰는 AI(Gemini) 사전 고지', a?.ok && a.route === '/sparring' && /Gemini/.test(a.message), a);
  a = act('방금 배운 기술을 복습하고 싶어', { current: T('bjj__armbar'), inLesson: true });
  check('[A7] 수업 중 "방금 배운 기술 복습" → 기존 복습 세션(지금 기술)', a?.ok && decodeURIComponent(a.route) === '/review/session?mode=training&ids=bjj__armbar' && routeExists(a.route), a);
  a = act('3분 훈련하고 1분 쉬고 싶어');
  check('[A8] "3분 훈련하고 1분 쉬고 싶어" → 라운드 타이머 180초/60초/3라운드', a?.ok && a.route === '/free-training/sparring?mode=timer&round=180&rest=60&rounds=3' && routeExists(a.route), a);
  a = act('60분 훈련하고 1분 쉬고 싶어');
  check('[A9] 허용 범위 밖 값(라운드 60분) → 거부, 열지 않음', a && !a.ok && a.reason === 'invalid_params', a);
  a = act('기준 영상과 비교하고 싶어');
  check('[A10] Gemini 기능(기준 영상 비교) → 자체 코치는 열지 않고 대안 안내', a && !a.ok && a.reason === 'needs_gemini', a);
  a = act('솔로 드릴 하고 싶어');
  check('[A11] 무술 없이 솔로 드릴 → 무술 선택지 (실제로 미트 드릴이 가능한 무술만)', a && !a.ok && a.reason === 'needs_choice' && a.choices.some((c) => c.label === '레슬링'), a.choices?.map((c) => c.label));
  check('[A12] 수업 요청은 기능 실행이 아님 ("잽 배우고 싶어" → 수업 만들기 그대로)', act('잽 배우고 싶어') === null && act('오늘 암바 수업하고 싶어') === null);
  const ok = ['레슬링 솔로 드릴 하고 싶어', '잽 연습하고 싶어', '스파링 영상을 분석하고 싶어', '기술을 복습하고 싶어', '3분 훈련하고 1분 쉬고 싶어', '무에타이 반응 훈련 하고 싶어'].map((x) => act(x)).filter((x) => x?.ok);
  check('[A13] 코치가 여는 경로는 모두 앱에 실제로 있는 화면 (새 기능 중복 구현 없음)', ok.length === 6 && ok.every((x) => routeExists(x.route)), ok.map((x) => x.route));
  check('[A14] 수업 밖 요청은 바로 열고, 수업 중 요청은 확인 후 이동', act('잽 연습하고 싶어').confirm === false && act('잽 연습하고 싶어', { inLesson: true }).confirm === true);
  const cat = Object.values(K.COACH_FEATURES);
  check('[A15] 카탈로그: Gemini 기능·미리 설정할 수 없는 기능은 실행 가능으로 표시하지 않음', cat.find((f) => f.id === 'form_compare').status === 'needs_gemini' && cat.find((f) => f.id === 'situation_recommend').status === 'needs_gemini' && cat.find((f) => f.id === 'combo_training').status === 'not_callable');
}

// =============================================================== 3. 로컬 모델 기본 꺼짐 · Gemini 0
{
  const jab = T('kickboxing__jab');
  calls.local = 0;
  const r1 = await K.martialdexCoach.answerQuestion({ technique: jab, question: '잽의 핵심 포인트가 뭐예요?', dayContext: '', history: [], place: '' });
  check('[L1] 기본값: 로컬 모델이 "사용 가능"이어도 자체 코치는 호출하지 않음 (자료 문장으로 답)', !K.localModelEnabled() && calls.local === 0 && r1.ok && r1.source === 'evidence' && /MARTIALDEX 자료에 따르면/.test(r1.text), { local: calls.local, text: r1.text });
  window.localStorage.setItem(K.LOCAL_MODEL_KEY, 'on');
  const r2 = await K.martialdexCoach.answerQuestion({ technique: jab, question: '잽의 핵심 포인트가 뭐예요?', dayContext: '', history: [], place: '' });
  check('[L2] 보존된 재활성화 경로: 이 기기에서 켜면(martialdex:coach-local-model=on) 로컬 모델을 다시 사용', K.localModelEnabled() && calls.local === 1 && r2.ok, { local: calls.local, source: r2.source });
  window.localStorage.removeItem(K.LOCAL_MODEL_KEY);
  check('[L3] 기술 질문·기능 요청 전 과정에서 Gemini(askAi) 호출 0회', calls.gemini === 0, calls);
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
