// 9차 — AI 코치 개인화 (공통 사용자 데이터) · 검색 신뢰성. Offline: real technique DB, real stores on an in-memory
// localStorage seeded with a FAKE learner (no account, no network); search and model are scripted fakes that record
// exactly what reached them. Checks the answer the learner sees AND what the model was given.
// Run: node .devtools/test-coach-personal-search.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-personal-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as R from ${mod('src/lib/selfAi/router.ts')};`,
    `export * as G from ${mod('src/lib/selfAi/guard.ts')};`,
    `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
    `export * as E from ${mod('src/lib/selfAi/evidenceCheck.ts')};`,
    `export * as PF from ${mod('src/lib/coachContext/personalFacts.ts')};`,
    `export * as UC from ${mod('src/lib/coachContext/userContext.ts')};`,
    `export * as FP from ${mod('src/lib/fighterProfile/store.ts')};`,
    `export * as GS from ${mod('src/lib/goals/store.ts')};`,
    `export * as GR from ${mod('src/lib/gymRoutine/service.ts')};`,
    `export * as TH from ${mod('src/lib/trainingHistory/service.ts')};`,
    `export * as PR from ${mod('src/lib/poseAnalysis/recordsRepository.ts')};`,
    `export * as RP from ${mod('src/lib/selfResearch/provider.ts')};`,
    `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  ].join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, clear: () => mem.clear(), get length() { return mem.size; } };
let researchUp = true;
let researchCalls = 0;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout, clearTimeout, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  // a fake desktop bridge for the research provider's cache test only
  martialdex: {
    selfAi: { status: async () => ({ ok: true }), chat: async () => ({ ok: false, code: 'UNKNOWN', message: 'unused' }), cancel: async () => true },
    research: {
      status: async () => ({ ok: researchUp, url: 'http://127.0.0.1:8888' }),
      search: async (req) => (researchCalls++, { ok: true, kind: 'web', results: [{ title: `R ${req.query}`, url: 'https://a.example/r', snippet: 's', source: 'a.example', engines: ['bing'], relevance: 1, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'not_attempted' } }], diagnostics: { backend: 'searxng' } }),
    },
  },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { R, G, A, E, PF, UC, FP, GS, GR, TH, PR, RP, K } = await import(pathToFileURL(out).href);

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const ask = (text) => {
  const q = PF.personalFactQuery(text);
  return q ? PF.answerPersonalFact(q, NOW) : null;
};
const NOW = new Date();
const today = NOW.toISOString().slice(0, 10);

// ---------- 0. empty learner: "없음" is said, never guessed
let a = ask('내 리치가 얼마야?');
check('[P0] 리치 없음 → "저장되어 있지 않습니다", 추측 안 함', a && /리치 정보가 저장되어 있지 않습니다/.test(a.text) && !/\d+\s*cm/.test(a.text) && !a.loadFailed, a);
a = ask('이번 주 목표가 뭐였지?');
check('[P0] 이번 주 목표 없음 → 없다고 표시', a && /이번 주 목표: 저장된 목표가 없습니다/.test(a.text), a);
check('[P0] 루틴 없음', /저장된 훈련 루틴이 없습니다/.test(ask('내 루틴 보여줘')?.text ?? ''));

// ---------- seed a FAKE learner through the stores' own write APIs
FP.setItem('body.wingspan', { value: 183, source: 'measured', measurement: { kind: 'body', unit: 'cm', method: null, measuredAt: today, confidence: 'high' } });
FP.setItem('body.stance', { value: 'southpaw', source: 'self_report' });
FP.setItem('body.height', { state: 'unknown', source: 'self_report' });
const week = GS.goalSlots(NOW).find((s) => s.slot === 'week');
const month = GS.goalSlots(NOW).find((s) => s.slot === 'month');
const year = GS.goalSlots(NOW).find((s) => s.slot === 'year');
const lt = GS.goalSlots(NOW).find((s) => s.slot === 'long_term');
GS.saveGoal('week', week.periodKey, '잽 정확도 올리기, 주 3회 훈련');
GS.saveGoal('month', month.periodKey, '아마추어 스파링 준비');
GS.saveGoal('year', year.periodKey, '첫 아마추어 경기 출전');
GS.saveGoal('long_term', lt.periodKey, '프로 데뷔');
const r = GR.createGymRoutine('QA 루틴');
GR.addExerciseToDay(GR.getGymRoutine(r.id), 1, { techniqueId: 'gym-바벨-백스쿼트', targetSets: 3, targetReps: [10, 10, 8], targetSeconds: null, targetWeightKg: [40, 45, 50], restSeconds: 60 });
GR.setActiveGymRoutine(r.id);
TH.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab'], completed: true, estimatedMinutes: 30, actualMinutes: 35, notes: 'QA 메모: 잽 후 가드 내려감', source: 'free_training' });
TH.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['boxing__cross'], completed: false, estimatedMinutes: 20, source: 'free_training' });
PR.poseRecordsRepository.add({ recordId: 'qa-pose-1', techniqueId: 'boxing__jab', martialArtId: 'boxing', score: 72, status: 'average', metricScores: {}, analyzedAt: NOW.toISOString(), method: 'landmark' });
const before = JSON.stringify([...mem.entries()]);

// ---------- 1. stored values, exactly
a = ask('내 리치가 얼마야?');
check('[P1] 리치 = 저장된 183cm + 측정 출처', a && /리치[^\n]*183/.test(a.text) && /직접 측정/.test(a.text) && /근거: 개인 파이터 프로필/.test(a.text), a?.text);
check('[P1] 저장 안 한 대화 내용은 반영 안 된다고 안내', /저장하기 전까지 여기에 반영되지 않습니다/.test(a?.text ?? ''));
a = ask('내 스탠스가 뭐였지?');
check('[P2] 스탠스 = 사우스포', a && /기본 스탠스: 사우스포/.test(a.text), a?.text);
a = ask('내 키는 몇이야?');
check('[P3] "모른다고 답함"과 "없음"을 구분', a && /모른다고 답하셨습니다/.test(a.text), a?.text);
a = ask('이번 주 목표가 뭐였지?');
check('[P4] 이번 주 목표 = 저장된 문장', a && a.text.includes('잽 정확도 올리기, 주 3회 훈련') && !a.text.includes('프로 데뷔'), a?.text);
check('[P5] 이번 달 목표', (ask('이번 달 목표 알려줘')?.text ?? '').includes('아마추어 스파링 준비'));
check('[P6] 올해 목표', (ask('올해 목표가 뭐야?')?.text ?? '').includes('첫 아마추어 경기 출전'));
check('[P7] 장기 목표', (ask('내 장기 목표는?')?.text ?? '').includes('프로 데뷔'));
a = ask('이번 주 목표 얼마나 달성했어?');
check('[P8] 달성률: 실제 기록 대조 + 근거 없는 % 계산 안 함', a && /완료 1회/.test(a.text) && /달성률\(%\)은 계산하지 않았습니다/.test(a.text) && !/\d+\s*%\s*달성/.test(a.text), a?.text);
a = ask('내 루틴 보여줘');
check('[P9] 루틴 = 저장된 요일·세트·무게, "계획이지 수행 기록 아님"', a && /QA 루틴 \(사용 중\)/.test(a.text) && /월:/.test(a.text) && /3세트×10\/10\/8/.test(a.text) && /40\/45\/50kg/.test(a.text) && /실제로 한 훈련은 훈련 기록/.test(a.text), a?.text);
a = ask('내 최근 훈련 기록 알려줘');
check('[P10] 최근 훈련 = 완료/미완료 구분 + 메모', a && /완료 1건 · 미완료 1건/.test(a.text) && /잽 후 가드 내려감/.test(a.text) && /기술을 익혔다는 판정은 아닙니다/.test(a.text), a?.text);
a = ask('내 자세 측정 결과 보여줘');
check('[P11] 자세 측정 = 저장된 72점', a && /72점/.test(a.text), a?.text);
check('[P12] 조회만 했고 저장 데이터는 그대로 (쓰기 0)', JSON.stringify([...mem.entries()]) === before);
check('[P13] "내 루틴 개선해 줘"는 조회가 아님 → 코치(모델)로', PF.personalFactQuery('내 루틴을 개선해 줘') === null && PF.personalFactQuery('이번 주 목표에 맞춰 수업 만들어 줘') === null);

// ---------- 2. load failure ≠ no data
const realGet = storage.getItem;
storage.getItem = (k) => {
  if (k === 'martialdex:gym-routines') throw new Error('disk');
  return realGet(k);
};
a = ask('내 루틴 보여줘');
storage.getItem = realGet;
check('[P14] 읽기 실패 → "불러오기에 실패" (없다고 하지 않음)', a && (a.loadFailed ? /읽지 못했습니다/.test(a.text) : /QA 루틴/.test(a.text)), a);

// ---------- 3. the common context: what the model receives
const uc = UC.userCoachContext({ martialArt: 'boxing', topic: '내 훈련 루틴을 개선해 줘' });
check('[C1] 공통 컨텍스트: 프로필·목표·배운 기술·루틴·훈련 메모 포함', uc.parts.profile && uc.parts.goals && uc.parts.routine && uc.parts.training && /183/.test(uc.text) && /잽 정확도/.test(uc.text) && /QA 루틴/.test(uc.text) && /가드 내려감/.test(uc.text), { parts: uc.parts, text: uc.text.slice(0, 600) });
check('[C2] 루틴은 "계획 (실제 수행 기록 아님)"으로 표시', /실제 수행 기록 아님/.test(uc.text));
check('[C3] 비밀값 없음 (자체 AI 서버 토큰)', (storage.setItem('martialdex:self-ai-server', JSON.stringify({ url: 'https://x.example', token: 'SECRET-TOKEN-123' })), !/SECRET-TOKEN-123/.test(UC.userCoachContext({ martialArt: 'boxing', topic: '아무거나' }).text)));
check('[C4] 주제와 무관한 영양 데이터는 빼고, 영양 질문에만 넣음', !UC.userCoachContext({ martialArt: 'boxing', topic: '잽 수업' }).parts.nutrition);

// coach turns: chat and lesson use the same layer
const index = K.buildKnowledgeIndex({});
const seen = [];
const deps = (over = {}) => ({
  research: async () => ({ ok: true, kind: 'web', results: [], diagnostics: { backend: 'searxng' } }),
  chat: async (req) => (seen.push(req.messages[0].content), { ok: true, text: '루틴을 이렇게 바꿔 보세요.', model: 'fake-3b', evalCount: 1, ms: 1 }),
  knowledgeIndex: async () => index,
  learnerContext: (art, topic) => UC.userCoachContext({ martialArt: art, topic, budget: { profile: 600, goals: 700, learning: 800 }, detailBudget: 900 }).text,
  personalFact: (text) => {
    const q = PF.personalFactQuery(text);
    return q ? PF.answerPersonalFact(q, NOW) : null;
  },
  lessonFit: (ids) => PF.lessonFitText(ids, NOW),
  ...over,
});
let t = await A.runCoachTurn({ text: '내 리치가 얼마야?', history: [], requestId: 'p1' }, deps());
check('[T1] 대화하기: 리치 질문 → 저장값 183, 모델 호출 0 (모델이 숫자를 바꿔 말할 수 없음)', /183/.test(t.message.text) && t.message.model === 'martialdex-data' && seen.length === 0 && t.message.personalData?.stores.includes('개인 파이터 프로필'), t.message);
const lesson = { title: 'QA 수업', current: index ? { id: 'boxing__jab', name: 'Jab', martialArt: 'boxing' } : null, art: 'boxing' };
t = await A.runCoachTurn({ text: '이번 주 목표가 뭐였지?', history: [], requestId: 'p2', inLesson: true, lessonTechniqueId: 'boxing__jab' }, deps());
check('[T2] 수업하기 중 질문: 같은 저장 목표 + 수업 이어짐', t.message.text.includes('잽 정확도 올리기') && /수업은 하던 단계에서 그대로 이어집니다/.test(t.message.text), t.message.text);
seen.length = 0;
t = await A.runCoachTurn({ text: '내 훈련 루틴을 개선해 줘', history: [], requestId: 'p3', martialArt: 'boxing' }, deps());
check('[T3] 개선 요청 → 모델에 실제 루틴·목표·훈련 메모가 전달됨', seen.length === 1 && /QA 루틴/.test(seen[0]) && /잽 정확도/.test(seen[0]) && /가드 내려감/.test(seen[0]) && /이 사용자에 대해 저장된 데이터/.test(seen[0]), seen[0]?.slice(0, 400));
t = await A.runCoachTurn({ text: '복싱 잽 수업 만들어 줘', history: [], requestId: 'p4', martialArt: 'boxing' }, deps());
check('[T4] 수업 계획에 "나에게 맞춘 점": 잽 학습 기록 · 이번 주 목표 연결 · 사우스포', /나에게 맞춘 점/.test(t.message.text) && /잽|Jab/.test(t.message.text) && /이번 주 목표\("잽 정확도[^)]*\)에 Jab/.test(t.message.text) && /사우스포/.test(t.message.text), t.message.text.slice(-600));
check('[T5] 코치 턴 전체에서 사용자 데이터 쓰기 0 (목표·루틴·기록·숙련도 그대로)', JSON.stringify([...mem.entries()].filter(([k]) => k !== 'martialdex:self-ai-server')) === before);

// ---------- 4. search: cache, claims, wording, routing, URL check
researchUp = true;
const q1 = await RP.selfResearchProvider.search({ query: 'cache-test', kind: 'web' });
researchUp = false;
const q2 = await RP.selfResearchProvider.search({ query: 'cache-test', kind: 'web' });
check('[S1] 캐시 사용 시 실제 검색 시각·만료·현재 서버 상태가 붙음 (새 검색 아님)', q1.ok && !q1.cache && q2.ok && q2.cache && q2.cache.serverUp === false && researchCalls === 1 && Date.parse(q2.cache.expiresAt) - Date.parse(q2.cache.searchedAt) === 600000, q2.cache);
const n1 = A.researchNotice({ searched: true, kind: 'web', queries: [], status: 'ok', reason: '', pagesRead: 1, cached: q2.cache }, 1);
check('[S2] 캐시 안내 문구: "이전 검색 결과 사용 중 … 검색 서버 현재 상태: 응답 없음 … 새로 검색한 결과가 아닙니다"', /^🔎 이전 검색 결과 사용 중/.test(n1) && /검색 서버 현재 상태: 응답 없음/.test(n1) && /새로 검색한 결과가 아닙니다/.test(n1), n1);
const n2 = A.researchNotice({ searched: true, kind: 'web', queries: [], status: 'failed', reason: '', message: 'SearXNG가 실행 중이 아닙니다.', failureCode: 'NOT_RUNNING' }, 0);
check('[S3] 실패 종류 구분 + "다시 시도하지 않았고"', /검색 서버 응답 없음/.test(n2) && /다시 시도하지 않았고/.test(n2), n2);
const n3 = A.researchNotice({ searched: true, kind: 'web', queries: [], status: 'empty', reason: '', rawCount: 0 }, 0);
check('[S4] 결과 없음은 실패와 다른 문구', /결과가 0건/.test(n3) && !/실패/.test(n3), n3);

// the 2026-11-07 distortion: "2% 이내로 회복" → "2%까지 하락"
const SRC3 = '전체 수분 손실을 체중의 3~5%로 제한하고 정밀한 리하이드레이션과 빠른 글리코겐 재보충을 병행하는 전략적 워터컷은 계체에서 체급 우위를 확보하면서도 경기 시간까지 경기력 지표를 기준치의 2% 이내로 회복시킬 수 있다.';
const SRC2 = '이른 시간 안에 체중이 줄어들지만 동시에 혈액량이 줄고 심박수가 비정상적으로 치솟는다.';
let cl = E.checkClaims('이는 경기력 지표가 기준치보다 2%까지 하락할 수 있다는 연구 결과도 있습니다.', [{ n: 3, text: SRC3 }]);
check('[E1] 8차 회귀: "2% 이내 회복" → "2%까지 하락" = 반대 방향 → contradicted (출처 [3])', cl[0]?.status === 'contradicted' && cl[0].problems.includes('direction_flip') && cl[0].source === 3, cl);
check('[E1b] 조건("이내") 누락도 표시', cl[0]?.problems.includes('condition_dropped'), cl);
cl = E.checkClaims('전략적 워터컷은 경기력 지표를 기준치의 2% 이내로 회복시킬 수 있습니다.', [{ n: 3, text: SRC3 }]);
check('[E2] 같은 의미는 supported [3]', cl[0]?.status === 'supported' && cl[0].source === 3 && !cl[0].problems.length, cl);
cl = E.checkClaims('급격한 감량은 혈액량이 줄고 심박수가 치솟게 만듭니다.', [{ n: 2, text: SRC2 }]);
check('[E3] 출처 번호 없이 쓴 문장도 앱이 [2]와 연결', cl[0]?.status === 'supported' && cl[0].source === 2, cl);
cl = E.checkClaims('이런 과정에서 선수들은 혈액량이 줄고 심박수가 높아질 수 있어 생리적 부담이 크다고 합니다.', [{ n: 4, text: SRC2 }]);
check('[E3b] 9차 실측 의역(혈액량·심박수 유지)도 [4]와 연결', cl[0]?.status === 'supported' && cl[0].source === 4, cl);
cl = E.checkClaims('체중을 줄이면 혈액량이 늘어납니다.', [{ n: 2, text: SRC2 }]);
check('[E4] 증가↔감소 반전 = contradicted', cl[0]?.status === 'contradicted' && cl[0].problems.includes('direction_flip'), cl);
cl = E.checkClaims('선수의 87%가 감량했습니다.', [{ n: 3, text: SRC3 }]);
check('[E5] 출처에 없는 수치 표시', cl[0]?.problems.includes('number_not_in_source'), cl);
cl = E.checkClaims('수분 손실을 3~5%로 제한하면 반드시 경기력이 유지됩니다.', [{ n: 3, text: SRC3 }]);
check('[E6] 출처보다 단정적 표현(반드시) 표시', cl[0]?.problems.includes('overclaim'), cl);
cl = E.checkClaims('혈액량이 줄기 때문에 체중이 줄어듭니다.', [{ n: 2, text: SRC2 }]);
check('[E7] 원문에 없는 인과관계 표시', cl[0]?.problems.includes('causal_added'), cl);
cl = E.checkClaims('일반인도 혈액량이 줄고 심박수가 치솟습니다.', [{ n: 2, text: '격투기 선수들은 이른 시간 안에 체중이 줄어들지만 동시에 혈액량이 줄고 심박수가 비정상적으로 치솟는다.' }]);
check('[E8] 선수 대상 내용을 일반인으로 일반화 표시', cl[0]?.problems.includes('scope_generalized'), cl);
cl = E.checkClaims('제 판단으로는 천천히 감량하는 편이 좋겠습니다.', [{ n: 2, text: SRC2 }]);
check('[E9] 코치 의견은 opinion (출처로 꾸미지 않음)', cl[0]?.status === 'opinion' || cl[0]?.status === 'unverified', cl);
cl = E.checkClaims('제 리치 183cm 기준으로 거리를 잡으세요.', [{ n: 2, text: SRC2 }], '- 리치: 183 cm');
check('[E10] 사용자 데이터의 수치(183cm)는 "출처에 없는 수치"로 오판하지 않음', !cl[0]?.problems.includes('number_not_in_source'), cl);

// end-to-end: the distorted sentence never reaches the learner
const RES = [
  { title: '워터컷 전략', url: 'https://research.example/w', snippet: SRC3, content: SRC3, source: 'research.example', engines: ['bing'], relevance: 1, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'ok' } },
];
t = await A.runCoachTurn({ text: '요즘 격투기 선수 급격한 체중 감량 위험성에 대한 최신 자료 찾아줘', history: [], requestId: 's1' }, deps({
  research: async () => ({ ok: true, kind: 'web', results: RES, diagnostics: { backend: 'searxng' } }),
  chat: async () => ({ ok: true, text: '감량은 위험합니다. 경기력 지표가 기준치보다 2%까지 하락할 수 있다는 연구 결과도 있습니다. 다시 시도해 보겠습니다.', model: 'fake-3b', evalCount: 1, ms: 1 }),
}));
check('[E11] 코치 답변에서 왜곡 문장 제거 + 원문과 함께 안내', !/2%까지 하락/.test(t.message.text) && t.message.guardNotes?.some((n) => /출처 \[1\]와 다른 내용이라 지운 문장/.test(n) && /회복/.test(n)), t.message);
check('[E12] "다시 시도해 보겠습니다" 제거 (실제로 재시도 안 함)', !/다시 시도해 보겠습니다/.test(t.message.text) && t.message.guardNotes?.some((n) => /약속한 문장/.test(n)), t.message.text);
check('[E13] 근거 대조(claims)가 메시지에 붙어 UI로 감', Array.isArray(t.message.claims) && t.message.claims.some((c) => c.status === 'contradicted'), t.message.claims);
const g = G.guardAnswer('자료를 찾아보겠습니다. 잽은 거리 조절에 씁니다.\n나중에 다시 알려드릴게요.', { sourceCount: 0, sourceUrls: [], searched: false });
check('[E14] guard: 약속 문장만 지우고 나머지·줄바꿈 유지', g.removedPromises.length === 1 && /잽은 거리 조절에 씁니다/.test(g.text), g);

// routing: a topic about athletes is not a fighter analysis
let p = R.planTurn('요즘 격투기 선수 급격한 체중 감량 위험성에 대한 최신 자료 찾아줘');
check('[Q1] "선수 체중 감량 위험성" = 웹 주제 검색 (선수 분석 아님), 검색 범위 유지', p.intent === 'web' && p.research.needed && p.research.kind === 'web' && !/선수·경기 분석/.test(p.research.reason), { intent: p.intent, reason: p.research.reason });
p = R.planTurn('Ilia Topuria 스타일 분석해줘');
check('[Q2] 특정 선수 스타일 분석은 그대로 fighter', p.intent === 'fighter', p.intent);
p = R.planTurn('UFC 선수 부상 회복 기간 자료 찾아줘');
check('[Q3] 선수 부상 회복 주제 = web', p.intent === 'web' && p.research.needed, p.intent);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
