// 질문 의도 분류 + 도구 선택 (코드 라우팅) — offline, real technique DB, fake search/model.
//  1. planTurn: intent, tools, search kind, queries for many phrasings incl. the six user tests
//  2. runCoachTurn: which tool is really called per test (search kind / data engine / model / plan)
// Run: node .devtools/test-intent-routing.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-routing-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as R from ${mod('src/lib/selfAi/router.ts')};`,
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {},
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { R, A, K } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

const SIX = {
  A: 'BJJ의 암바를 설명해 줘. 기술의 원리, 주요 포인트, 흔한 실수와 대응 방법을 알려 줘.',
  B: '최근 그래플링 관련 스포츠 과학 논문을 찾아 줘. 제목, 연도, 핵심 내용, 원문 링크를 정리해 줘.',
  C: '레슬링 싱글렉을 배울 수 있는 교육 영상을 찾아 줘.',
  D: '레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어.',
  E: '지금 배우는 기술에서 상대가 방어하면 어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘.',
  F: '코너 맥그리거의 타격 스타일을 분석해 줘. 대표적인 셋업, 콤비네이션, 카운터와 근거 자료를 구분해서 정리해 줘.',
};

// ---- 1. classification table: [text, opts, intent, tools that must be chosen, research kind | null]
const CASES = [
  [SIX.A, {}, 'technique', ['db'], null],
  [SIX.B, {}, 'paper', ['paper_search'], 'paper'],
  [SIX.C, {}, 'video', ['video_search'], 'video'],
  [SIX.D, {}, 'lesson', ['lesson_plan', 'db'], 'web'],
  [SIX.E, { inLesson: true }, 'lesson_question', ['db', 'lesson_engine', 'web_search'], 'web'],
  [SIX.F, {}, 'fighter', ['fighter_research', 'db'], 'web'],
  ['안녕하세요', {}, 'smalltalk', [], null],
  ['고마워요!', {}, 'smalltalk', [], null],
  ['요즘 너무 지쳤어요 동기부여 좀 해줘', {}, 'motivation', [], null],
  ['잽은 어떻게 쳐?', { martialArt: 'boxing' }, 'technique', ['db'], null],
  ['암바와 트라이앵글 초크의 차이가 뭐야?', { martialArt: 'bjj' }, 'compare', ['db'], null],
  ['잽과 크로스 비교해줘', { martialArt: 'boxing' }, 'compare', ['db'], null],
  ['잽으로 시작하는 콤비네이션 알려줘', { martialArt: 'boxing' }, 'sequence', ['db', 'web_search'], 'web'],
  ['카프킥 셋업 연구해 보고 싶어', { martialArt: 'kickboxing' }, 'sequence', ['db', 'web_search'], 'web'],
  ['로마첸코 풋워크 영상 보여줘', {}, 'video', ['video_search'], 'video'],
  ['존 존스 하이라이트 영상', {}, 'video', ['video_search'], 'video'],
  ['Ilia Topuria 스타일 분석해줘', {}, 'fighter', ['fighter_research'], 'web'],
  ['하빕 누르마고메도프 선수의 레슬링 스타일 정리해 줘', {}, 'fighter', ['fighter_research'], 'web'],
  ['UFC 챔피언 중에 카운터 잘 치는 선수 누구야?', {}, 'fighter', ['fighter_research'], 'web'],
  ['잽 펀치 속도에 관한 논문 있어?', {}, 'paper', ['paper_search'], 'paper'],
  ['주짓수 부상에 대한 연구 결과 알려줘', {}, 'paper', ['paper_search'], 'paper'],
  ['systematic review on judo injuries', {}, 'paper', ['paper_search'], 'paper'],
  ['8주 동안 무에타이 커리큘럼 짜줘', {}, 'curriculum', ['curriculum_builder'], null],
  ['복싱 입문 로드맵 만들어 줘', {}, 'curriculum', ['curriculum_builder'], null],
  ['복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어', { martialArt: 'boxing' }, 'lesson', ['lesson_plan'], 'web'],
  ['이 콤보와 연결되는 다른 셋업도 현재 수업에 추가해 줘', { inLesson: true }, 'lesson_add', ['lesson_engine'], null],
  ['이 셋업이 실제 경기에서는 어떤 상황에서 사용돼?', { inLesson: true }, 'lesson_question', ['web_search'], 'web'],
  ['이 동작에서 무릎은 어떻게 해?', { inLesson: true }, 'lesson_question', ['lesson_engine'], null],
  ['최근 UFC 랭킹 알려줘', {}, 'fighter', ['fighter_research'], 'web'],
  ['요즘 유행하는 주짓수 대회 룰 변경 뉴스 찾아줘', {}, 'web', ['web_search'], 'web'],
  ['스파링 루틴 추천해줘', {}, 'training', [], null],
  ['내 스타일 분석해 줘', {}, 'general', [], null],
];
for (const [text, opts, intent, tools, kind] of CASES) {
  const p = R.planTurn(text, opts);
  const ok = p.intent === intent && tools.every((t) => p.tools.includes(t)) && (kind === null ? !p.research.needed : p.research.needed && p.research.kind === kind);
  check(`[I] "${text.slice(0, 34)}" → ${intent}${kind ? `/${kind}` : ''}`, ok, { intent: p.intent, tools: p.tools, research: p.research });
}

// ---- 2. specific routing properties of the six tests
const pB = R.planTurn(SIX.B);
check('[B1] 논문 질의는 영어 주제어 (요청어 "제목·연도·원문·링크" 없음)', pB.research.queries[0] === 'sports science grappling' && !pB.research.queries.some((q) => /제목|연도|원문|링크|정리|찾아/.test(q)), pB.research.queries);
check('[B2] "최근" = 최신 자료 우선 표시', pB.recent === true);
const pC = R.planTurn(SIX.C);
check('[C1] 교육 영상 = tutorial/강좌 질의 (하이라이트 아님)', pC.research.queries.some((q) => /tutorial/.test(q)) && pC.research.queries.some((q) => /강좌/.test(q)) && !pC.research.queries.some((q) => /highlights/.test(q)), pC.research.queries);
check('[C2] 질문의 무술(레슬링) 인식', pC.art === 'wrestling' && pC.research.queries.some((q) => /wrestling/.test(q)), [pC.art, pC.research.queries]);
const pD = R.planTurn(SIX.D);
check('[D1] 수업 요청 + 레슬링', pD.wantsLesson && pD.art === 'wrestling', [pD.intent, pD.art]);
check('[D2] 다른 무술의 기술(가라테 Choku-zuki)을 끌어오지 않음', !pD.techniques.some((t) => t.martialArt === 'karate'), pD.techniques.map((t) => t.id));
const pE = R.planTurn(SIX.E, { inLesson: true });
check('[E1] 수업 중 상대 대응 질문 → 수업 엔진 대신 대화 코치로 (검색 포함)', R.isLessonSideRequest(pE, SIX.E, true), pE.research);
check('[E2] 코치 질문에 대한 답("잘 모르겠어")은 수업 엔진에 남음', !R.isLessonSideRequest(R.planTurn('잘 모르겠어', { inLesson: true }), '잘 모르겠어', true));
const pF = R.planTurn(SIX.F);
check('[F1] 선수 이름 추출', pF.fighter === '코너 맥그리거', pF.fighter);
check('[F2] "근거 자료"가 있어도 논문 검색 아님', pF.research.kind !== 'paper' && !pF.tools.includes('paper_search'), pF);

// ---- 3. tools really used per test (fake search / model / data engine)
const index = K.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
function fakeDeps(log) {
  const result = (kind, i) => ({ title: `${kind} result ${i}`, url: `https://ex${i}.example/${kind}`, snippet: 'grappling single leg', source: `ex${i}.example`, engines: ['x'], relevance: 1, sourceType: kind === 'video' ? 'video' : kind === 'paper' ? 'academic' : 'web', sourceTypeLabel: kind, reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'not_attempted' } });
  return {
    research: async (req) => (log.push(`search:${req.kind}`), { ok: true, kind: req.kind, results: [1, 2, 3].map((i) => result(req.kind, i)), diagnostics: { backend: 'fake', rawCount: 3 } }),
    chat: async () => (log.push('model'), { ok: true, text: '모델 답변입니다.', model: 'fake', evalCount: 1, ms: 1 }),
    knowledgeIndex: async () => index,
    learnerContext: () => '',
    dataAnswer: async () => (log.push('data'), 'MARTIALDEX 자료 답변'),
    artName: (a) => a,
  };
}
const EXPECT = {
  A: { calls: ['data'], model: 'martialdex-data' },
  B: { calls: ['search:paper'], model: 'martialdex-list' },
  C: { calls: ['search:video'], model: 'martialdex-list' },
  D: { calls: ['search:web'], model: 'martialdex-plan' },
  F: { calls: ['search:web'], notText: /논문/ },
};
for (const [k, exp] of Object.entries(EXPECT)) {
  const log = [];
  const o = await A.runCoachTurn({ text: SIX[k], history: [], martialArt: null, requestId: k }, fakeDeps(log));
  const callsOk = exp.calls.every((c) => log.includes(c)) && !log.some((c) => c.startsWith('search:') && !exp.calls.includes(c));
  const modelOk = !exp.model || o.message.model === exp.model;
  const textOk = !exp.notText || !exp.notText.test(o.message.text);
  check(`[T] 테스트 ${k}: 사용한 도구 ${exp.calls.join('+')}${exp.model ? ` → ${exp.model}` : ''}`, callsOk && modelOk && textOk, { log, model: o.message.model, text: o.message.text.slice(0, 200) });
}
const cur = await A.runCoachTurn({ text: '8주 동안 무에타이 커리큘럼 짜줘', history: [], martialArt: null, requestId: 'c' }, fakeDeps([]));
check('[T] 커리큘럼 요청 → AI 맞춤 커리큘럼 화면으로 (요청 전달)', cur.message.action?.to === '/ai-curriculum' && cur.message.action.state.freeText.includes('무에타이'), cur.message.action);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
