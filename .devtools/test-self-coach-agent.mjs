// MARTIALDEX 자체 AI 코치 (대화) — offline tests: tool routing, search honesty,
// citation guard, data-only fallback, lesson proposal, memory hand-off.
// Real technique DB; search and model are scripted fakes; no network.
// Run: node .devtools/test-self-coach-agent.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-coach-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as R from ${mod('src/lib/selfAi/router.ts')};`,
  `export * as G from ${mod('src/lib/selfAi/guard.ts')};`,
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as CS from ${mod('src/lib/selfAi/conversationStore.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
let realCalls = 0;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: { askAi: async () => (realCalls++, { ok: false }), webSearch: async () => (realCalls++, { ok: false }) },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { R, G, A, CS, K } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

// ---- routing
const p1 = R.planTurn('안녕하세요');
check('[R1] 인사 = 검색 안 함', p1.intent === 'smalltalk' && !p1.research.needed, p1);
const p2 = R.planTurn('요즘 너무 지쳤어요 동기부여 좀 해줘');
check('[R2] 동기부여 = 검색 안 함', p2.intent === 'motivation' && !p2.research.needed, p2.intent);
const p3 = R.planTurn('로마첸코 풋워크 영상 보여줘');
check('[R3] 영상 요청 = video 검색', p3.research.needed && p3.research.kind === 'video', p3.research);
const p4 = R.planTurn('잽 펀치 속도에 관한 논문 있어?');
check('[R4] 논문 요청 = paper 검색', p4.research.kind === 'paper' && p4.research.needed, p4.research);
const p5 = R.planTurn('Ilia Topuria 스타일 분석해줘');
check('[R5] 선수 질문 = 웹 검색 + 영어 질의 포함', p5.intent === 'fighter' && p5.research.needed && p5.research.queries.some((q) => /Topuria/.test(q) && /style/.test(q)), p5.research);
const p6 = R.planTurn('암바 할 때 엉덩이는 어떻게 해?', { martialArt: 'bjj' });
check('[R6] DB 기술 질문 = 기술 인식, 검색 안 함', p6.techniques.some((t) => /armbar/i.test(t.id)) && !p6.research.needed, [p6.techniques.map((t) => t.id), p6.research]);
const p7 = R.planTurn('이 셋업이 실제 경기에서는 어떤 상황에서 사용돼?', { inLesson: true });
check('[R7] 실제 활용 질문 = 검색', p7.research.needed, p7.research);
const p8 = R.planTurn('복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어', { martialArt: 'boxing' });
check('[R8] 수업 의도 + 잽 인식 + 검색', p8.wantsLesson && p8.techniques.length > 0 && p8.research.needed, [p8.intent, p8.techniques.map((t) => t.id)]);
const p9 = R.planTurn('이 콤보와 연결되는 다른 셋업도 현재 수업에 추가해 줘', { inLesson: true });
check('[R9] 수업 중 추가 요청', p9.wantsAddToLesson && p9.intent === 'lesson_add', p9.intent);

const p10 = R.planTurn('로마첸코 풋워크 영상 보여줘');
check('[R10] 영어 보조 질의에 번역 안 된 주제어(선수 이름) 유지', p10.research.queries.some((q) => /로마첸코/.test(q) && /footwork/.test(q)), p10.research.queries);

// ---- guard
const g3 = G.guardAnswer('훈련负荷가 큽니다', { sourceCount: 0, sourceUrls: [], searched: false });
check('[G3] 한자 혼입 감지', g3.foreignScript === true);
const g1 = G.guardAnswer('잽은 거리를 잽니다 [1]. 훅으로 이어집니다 [3]. https://evil.example/x 참고', { sourceCount: 2, sourceUrls: ['https://a.example/1'], searched: true });
check('[G1] 없는 번호·없는 링크 제거', g1.removedCitations.join() === '3' && g1.removedUrls.length === 1 && !/evil/.test(g1.text) && g1.cited.join() === '1', g1);
const g2 = G.guardAnswer('검색해보니 이 선수는 잽을 자주 씁니다.', { sourceCount: 0, sourceUrls: [], searched: false });
check('[G2] 검색 안 했는데 검색했다고 하면 표시', g2.falseSearchClaim, g2);

// ---- agent with fakes
const index = K.buildKnowledgeIndex({});
const RESULTS = [
  { title: 'Jab setups', url: 'https://a.example/jab', snippet: 's', content: 'The jab sets up the lead hook.', source: 'a.example', engines: ['bing'], relevance: 80, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'ok' } },
  { title: 'Video', url: 'https://youtube.com/watch?v=x', snippet: 'v', source: 'youtube.com', engines: ['youtube'], relevance: 70, sourceType: 'video', sourceTypeLabel: '영상', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'not_attempted' } },
];
let researchCalls = [];
let chatCalls = [];
const deps = (over = {}) => ({
  research: async (req) => (researchCalls.push(req), { ok: true, kind: req.kind ?? 'web', results: RESULTS, diagnostics: { backend: 'searxng', duplicatesRemoved: 1, failedEngines: [{ engine: 'brave', reason: '429' }] } }),
  chat: async (req, onDelta) => { chatCalls.push(req); onDelta?.('잽'); return { ok: true, text: '잽으로 훅을 엽니다 [1]. 영상도 있습니다 [2]. 없는 근거 [5].', model: 'fake', evalCount: 10, ms: 5 }; },
  knowledgeIndex: async () => index,
  learnerContext: () => '최근 수업: 2026-10-30 잽 기초',
  ...over,
});
researchCalls = []; chatCalls = [];
let deltas = '';
// (a setup question now gets the code-written setup report — this one reaches the model)
const t1 = await A.runCoachTurn({ text: '잽이 실제 경기에서 어떻게 쓰여?', history: [], martialArt: 'boxing', requestId: 'r1', onDelta: (d) => (deltas += d) }, deps());
check('[A1] 검색 실행 + 출처 2개 코드로 첨부', researchCalls.length === 1 && t1.message.sources?.length === 2 && t1.message.sources[0].url === 'https://a.example/jab', t1.message.sources);
check('[A2] 검색 안내 문구(본문 확인 수) 진짜 값', /검색 결과 2건 \(본문 확인 1건\)/.test(t1.message.text), t1.message.text);
check('[A3] 없는 출처 번호 [5] 제거 + 안내', !/\[5\]/.test(t1.message.text) && t1.message.guardNotes?.some((n) => n.includes('5')), t1.message);
// 2026-11-07: 대화하기도 수업하기와 같은 사용자 데이터(프로필·개인 목표·학습 기록·최근 수업)를 받는다 —
// 예전에는 동기부여·훈련 질문에만 넣었고, 그래서 "내 리치가 얼마였지?" 같은 질문에 개인 데이터가 빠졌다.
// 검색·선수·영상 등 개인 데이터가 쓸모없는 intent는 여전히 제외한다 (coachAgent NO_USER_CONTEXT).
check('[A4] 시스템 프롬프트에 DB 데이터 + 질문 관련 검색 문장 + 사용자 데이터(기술 질문에도)', /\[MARTIALDEX 데이터\]/.test(chatCalls[0].messages[0].content) && /이 사용자에 대해 저장된 데이터/.test(chatCalls[0].messages[0].content) && /잽 기초/.test(chatCalls[0].messages[0].content) && /The jab sets up the lead hook/.test(chatCalls[0].messages[0].content), chatCalls[0]?.messages[0].content.slice(0, 300));
check('[A5] 스트리밍 델타 전달', deltas === '잽');
check('[A6] 실패 엔진 기록', t1.message.research.failedEngines?.includes('brave'));

researchCalls = []; chatCalls = [];
const t2 = await A.runCoachTurn({ text: '안녕하세요', history: [], martialArt: null, requestId: 'r2' }, deps({ chat: async (req) => (chatCalls.push(req), { ok: true, text: '검색해보니 반갑습니다!', model: 'fake', evalCount: 1, ms: 1 }) }));
check('[A7] 인사 = 검색 0회, 검색 주장 경고', researchCalls.length === 0 && t2.message.research.searched === false && t2.message.guardNotes?.some((n) => /검색 자료 없이/.test(n)), t2.message);

const t3 = await A.runCoachTurn({ text: 'Lomachenko footwork 영상', history: [], martialArt: 'boxing', requestId: 'r3' }, deps({ research: async () => ({ ok: false, code: 'UNSUPPORTED', message: '데스크톱 앱에서 지원' }) }));
check('[A8] 검색 불가 기기 = "검색하지 않았습니다" 명시, 출처 없음', /검색하지 않았습니다/.test(t3.message.text) && !t3.message.sources && t3.message.research.searched === false, t3.message);

const t4 = await A.runCoachTurn({ text: 'Lomachenko footwork 영상', history: [], martialArt: 'boxing', requestId: 'r4' }, deps({ research: async () => ({ ok: false, code: 'NOT_RUNNING', message: '자체 검색 서버가 꺼져 있음' }) }));
check('[A9] 검색 실패 = 실패 사실 명시', /검색을 시도했지만 실패/.test(t4.message.text) && t4.message.research.status === 'failed', t4.message.text);

const t5 = await A.runCoachTurn({ text: '암바 할 때 엉덩이는?', history: [], martialArt: 'bjj', requestId: 'r5' }, deps({ chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: '로컬 AI(Ollama)가 실행 중이 아닙니다.' }) }));
check('[A10] 로컬 AI 꺼짐 = Gemini 없이 데이터만 + 사유', t5.message.dataOnly && /로컬 AI 모델을 사용할 수 없어/.test(t5.message.text) && realCalls === 0, t5.message);

const t6 = await A.runCoachTurn({ text: '복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어', history: [], martialArt: 'boxing', requestId: 'r6' }, deps());
check('[A11] 수업 제안: 기술 id + 시퀀스 id + 출처', t6.message.lessonProposal && t6.message.lessonProposal.techniqueIds.length > 0 && t6.message.lessonProposal.sequenceIds.length > 0 && t6.message.lessonProposal.sourceUrls.length === 2, t6.message.lessonProposal);

// video / paper = code-written list; technique question = data engine (no free generation)
chatCalls = [];
const tv = await A.runCoachTurn({ text: 'Lomachenko footwork 영상 보여줘', history: [], martialArt: 'boxing', requestId: 'rv' }, deps());
check('[A13] 영상 요청 = 코드가 쓴 번호 목록, 모델 호출 0', tv.message.model === 'martialdex-list' && /\[1\] Jab setups/.test(tv.message.text) && /영상 내용(은 직접| 자체는) 확인하지 않았습니다/.test(tv.message.text) && chatCalls.length === 0, tv.message.text);
chatCalls = [];
const td = await A.runCoachTurn({ text: '암바 할 때 엉덩이는?', history: [], martialArt: 'bjj', requestId: 'rd' }, deps({ dataAnswer: async () => '데이터 엔진 답변' }));
check('[A14] 검색 불필요 기술 질문 = 데이터 엔진 답변, 모델 호출 0', td.message.text === '데이터 엔진 답변' && td.message.model === 'martialdex-data' && chatCalls.length === 0, td.message);
chatCalls = [];
await A.runCoachTurn({ text: '잽이 실제 경기에서 어떻게 쓰여?', history: [], martialArt: 'boxing', requestId: 'ra' }, deps({ artName: () => '복싱' }));
check('[A15] 프롬프트에 질문한 무술(한국어 이름) 명시, "합쇼체" 용어 없음', /\[질문한 무술\] 복싱/.test(chatCalls[0].messages[0].content) && !/합쇼체/.test(chatCalls[0].messages[0].content));
chatCalls = [];
await A.runCoachTurn({ text: '요즘 훈련이 너무 힘들어서 그만두고 싶어', history: [], martialArt: null, requestId: 'rm' }, deps());
check('[A15b] 동기부여 질문에는 학습자 기록 포함', /잽 기초/.test(chatCalls[0]?.messages[0].content ?? ''));

// memory: history is passed, 🔎 notices stripped
chatCalls = [];
await A.runCoachTurn({ text: '그럼 다음은?', history: [{ id: '1', role: 'user', text: '제 이름은 민준', createdAt: '' }, { id: '2', role: 'assistant', text: '🔎 웹 검색 결과 2건\n\n반갑습니다 민준님', createdAt: '' }], martialArt: null, requestId: 'r7' }, deps());
const hist = chatCalls[0].messages.slice(1, -1);
check('[A12] 대화 기록 전달, 검색 안내 문구는 제외', hist.length === 2 && hist[1].content === '반갑습니다 민준님', hist);

// ---- conversation store
const c = CS.createConversation('boxing');
CS.appendMessage(c.id, { role: 'user', text: '잽 셋업 알려줘' });
CS.appendMessage(c.id, { role: 'assistant', text: '네' });
const back = CS.getConversation(c.id);
check('[S1] 대화 저장·제목 자동·순서 유지', back.messages.length === 2 && back.title === '잽 셋업 알려줘' && back.messages[0].role === 'user');
check('[S2] 실제 Gemini/Tavily 호출 0', realCalls === 0, realCalls);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
