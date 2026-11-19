// 42개 문제 통합 개선 — EXCLUSIVE 의도 4종 (통증 §13 / 정서 §14 / 소셜 §16 / 회상 §4-1).
// 분류만이 아니라 "실행 경로가 실제로 바뀌는지"를 본다: 검색이 호출되지 않는지,
// 답변의 출처가 무엇인지, 수업 제안이 붙지 않는지.
// 오프라인 — 네트워크·Supabase·Gemini 호출 없음.
import { build } from 'esbuild';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excl-'));
const out = path.join(dir, 'r.mjs'); const entry = path.join(dir, 'e.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as I from ${mod('src/lib/selfAi/intents.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
].join('\n'));
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
globalThis.localStorage ??= { _d: new Map(), getItem(k){return this._d.get(k)??null;}, setItem(k,v){this._d.set(k,String(v));}, removeItem(k){this._d.delete(k);}, clear(){this._d.clear();} };
const { A, I, K } = await import(pathToFileURL(out).href);
const index = K.buildKnowledgeIndex({});

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} :: ${JSON.stringify(detail)?.slice(0,200)}`); } };

let researchCalls = [], chatCalls = [];
const deps = (over = {}) => ({
  research: async (req) => { researchCalls.push(req); return { ok: true, results: [], queries: [], diagnostics: { failedEngines: [], engines: [] } }; },
  chat: async (req) => { chatCalls.push(req); return { ok: true, text: '모델 답변', model: 'fake' }; },
  knowledgeIndex: async () => index,
  learnerContext: () => '최근 학습: 잽 기초 3회',
  toSources: () => [],
  ...over,
});
const reset = () => { researchCalls = []; chatCalls = []; };

console.log('\n[1] 통증 (§13)');
reset();
const pain = await A.runCoachTurn({ text: '스피닝 백 피스트를 샌드백에 쳤는데 암바 걸린 것처럼 팔이 아파.', history: [], martialArt: 'boxing', requestId: 'p1' }, deps());
check('통증 질문은 검색을 하지 않는다', researchCalls.length === 0, researchCalls);
check('통증 질문은 모델을 호출하지 않는다 (진단처럼 들릴 위험)', chatCalls.length === 0, chatCalls);
check('동작 중단을 먼저 안내한다', /멈추고/.test(pain.message.text), pain.message.text.slice(0,60));
check('의료진 평가를 안내한다', /의료진/.test(pain.message.text));
check('원인을 단정하지 않는다', /단정하지 않/.test(pain.message.text));
check('암바 기술 설명을 하지 않는다', !/암바(는|란|의 )/.test(pain.message.text), pain.message.text.slice(0,120));
check('수업 제안이 붙지 않는다', !pain.message.lessonProposal);

console.log('\n[2] 정서 (§14)');
reset();
const emo = await A.runCoachTurn({ text: '내가 격투기에 재능이 없는 것 같아서 힘들어.', history: [], martialArt: null, requestId: 'e1' }, deps());
check('정서 질문은 검색을 하지 않는다', researchCalls.length === 0, researchCalls);
check('모델을 쓰되 공감 규칙을 넘긴다', chatCalls.length === 1 && /공감/.test(chatCalls[0].messages[0].content));
check('실제 학습 기록을 맥락으로 넘긴다', /잽 기초/.test(chatCalls[0].messages[0].content));
check('추측 금지 규칙이 들어간다', /추측하지 않는다/.test(chatCalls[0].messages[0].content));
check('기술 목록 나열 금지 규칙이 들어간다', /나열하지 않는다/.test(chatCalls[0].messages[0].content));
check('수업 제안이 붙지 않는다', !emo.message.lessonProposal);

console.log('\n[3] 소셜 집계 (§16)');
reset();
const trend = await A.runCoachTurn(
  { text: '이번 주 하트 가장 많은 콤보, 셋업이랑 게시물 뭐야?', history: [], martialArt: null, requestId: 's1' },
  deps({ socialTrending: async (period) => { researchCalls.push({ social: period }); return { ok: true, items: [
    { kind: 'post', id: 'p1', title: '오늘 스파링 기록', author: '은수', hearts: 12, createdAt: '2026-11-08T00:00:00Z' },
    { kind: 'combo', id: 'c1', title: '원투-로우킥', author: '민준', hearts: 7, createdAt: '2026-11-07T00:00:00Z' },
    { kind: 'setup', id: 's1', title: '더블렉 셋업', author: '지후', hearts: 4, createdAt: '2026-11-06T00:00:00Z' },
  ] }; } }),
);
check('웹 검색이 아니라 내부 집계를 호출한다', researchCalls.length === 1 && researchCalls[0].social === 'week', researchCalls);
check('모델을 호출하지 않는다 (집계는 결정론적)', chatCalls.length === 0);
check('게시물·콤보·셋업을 구분해 보여준다', /게시물/.test(trend.message.text) && /콤보/.test(trend.message.text) && /셋업/.test(trend.message.text));
check('하트 수와 작성자를 표시한다', /하트 12/.test(trend.message.text) && /은수/.test(trend.message.text));

reset();
const empty = await A.runCoachTurn({ text: '이번 주 하트 가장 많은 게시물 알려줘', history: [], martialArt: null, requestId: 's2' },
  deps({ socialTrending: async () => ({ ok: true, items: [] }) }));
check('데이터 없음과 조회 실패를 구분한다 (없음)', /기록이 없는 것입니다/.test(empty.message.text), empty.message.text);
reset();
const broke = await A.runCoachTurn({ text: '이번 주 하트 가장 많은 게시물 알려줘', history: [], martialArt: null, requestId: 's3' },
  deps({ socialTrending: async () => ({ ok: false, reason: 'timeout', items: [] }) }));
check('데이터 없음과 조회 실패를 구분한다 (실패)', /불러오지 못했습니다/.test(broke.message.text) && /외부 검색으로 대신하지는 않았습니다/.test(broke.message.text), broke.message.text);

console.log('\n[4] 대화 회상 (§4-1)');
reset();
const hist = [
  { id: '1', role: 'user', text: '더블렉 셋업 알려줘', createdAt: '' },
  { id: '2', role: 'assistant', text: '더블렉 셋업은…', createdAt: '' },
  { id: '3', role: 'user', text: '싱글렉 셋업도 알려줘', createdAt: '' },
  { id: '4', role: 'assistant', text: '싱글렉 셋업은…', createdAt: '' },
];
const rec = await A.runCoachTurn({ text: '아까 내가 처음에 무슨 셋업 알려달라고 했었지?', history: hist, martialArt: null, requestId: 'r1' }, deps());
check('회상 질문은 검색을 하지 않는다', researchCalls.length === 0, researchCalls);
check('회상 질문은 모델을 호출하지 않는다', chatCalls.length === 0, chatCalls);
check('처음 주제를 답한다', /처음 물어보신 것은/.test(rec.message.text), rec.message.text.slice(0,80));

console.log('\n[5] 기존 경로 보존');
reset();
await A.runCoachTurn({ text: '더블렉 셋업 알려줘', history: [], martialArt: 'wrestling', requestId: 'n1' }, deps());
check('평범한 셋업 질문은 여전히 검색을 탄다', researchCalls.length > 0, researchCalls.length);
const ia = I.analyzeIntents('아까 말한 기술로 수업 만들어줘', { hasConversation: true });
check('"수업 만들어줘"는 회상으로 가로채지 않는다', !ia.intents.includes('CONVERSATION_RECALL'), ia.intents);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
