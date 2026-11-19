// LIVE: AI 코치 대화 파이프라인 (11차) — 사양 §10 시나리오 A–E를 실제 로컬 모델(Ollama) + 실제 자체 검색(SearXNG) +
// 실제 기술 DB로, 앱과 같은 runCoachTurn 경로에서 대화를 이어 가며 실행한다. 프로필은 테스트용(메모리 localStorage).
// Gemini·Tavily·Supabase 호출 없음. 필요: `ollama serve`, services/searxng/run.sh.
// Run: node .devtools/live-coach-conversation.mjs [outJson]
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const selfAi = require(path.join(APP, 'electron/selfAi.cjs'));
const selfSearch = require(path.join(APP, 'electron/selfSearch/index.cjs'));
const { resolvePerson } = require(path.join(APP, 'electron/selfSearch/entity.cjs'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-coach11-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export * as P from ${mod('src/lib/fighterProfile/store.ts')};`,
  `export * as ST from ${mod('src/lib/fighterProfile/styleTraits.ts')};`,
  `export * as PF from ${mod('src/lib/coachContext/personalFacts.ts')};`,
  `export * as CA from ${mod('src/lib/coachContext/coachAnalysis.ts')};`,
  `export * as CL from ${mod('src/lib/selfAi/chatLesson.ts')};`,
  `export { answerCoachQuestion } from ${mod('src/lib/coachKnowledge/questions.ts')};`,
  `export { getMartialArt } from ${mod('src/lib/loadData.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { A, K, P, ST, PF, CA, CL, answerCoachQuestion, getMartialArt } = await import(pathToFileURL(out).href);

const st = await selfAi.status();
const ss = await selfSearch.searxStatus();
console.log(`model ${st.model} ok=${st.ok} · searxng ok=${ss.ok}`);
if (!st.ok || !ss.ok) { console.log('SKIP — local model or SearXNG not running'); process.exit(2); }

for (const [k, v] of [['body.stance', 'southpaw'], ['body.stanceSwitch', 'often'], ['kick.favorite', ['low', 'middle']], ['mma.strikeStyle', 'entry'], ['wr.entry', ['levelChange']], ['box.counter', 'often'], ['move.counterAfterDefense', 'often'], ['train.arts', ['mixed-martial-arts', 'wrestling']], ['train.improve', '클린치에서 버티는 힘']]) P.setItem(k, { value: v, source: 'self_report' });

const index = K.buildKnowledgeIndex({});
const deps = {
  research: (req) => selfSearch.research(req),
  chat: (req, onDelta) => selfAi.chat(req, onDelta),
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  dataAnswer: async (t, text, art) => (await answerCoachQuestion(t, text, { useModel: false, martialArt: art })).text || null,
  artName: (art) => getMartialArt(art)?.nameKo ?? art,
  personalFact: (text) => { const q = PF.personalFactQuery(text); return q ? PF.answerPersonalFact(q) : null; },
  styleProfile: () => ST.styleProfileOf(),
  lessonFit: (ids) => PF.lessonFitText(ids),
  resolveName: (name) => resolvePerson(name),
  // same as src/lib/selfAi/deps.ts
  personalAnalysis: async (text, art) => { const k = CA.analysisQuery(text); return k ? CA.answerAnalysis(k, { index: async () => index, art }) : null; },
  styleRecords: async () => (await CA.answerAnalysis('style', { index: async () => index, art: null }))?.text ?? null,
};

const report = [];
let pass = 0, fail = 0;
async function say(history, text, checks, extra = {}) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(text)) return history;
  const t = Date.now();
  const o = await A.runCoachTurn({ text, history, martialArt: null, requestId: `live-${Date.now()}`, ...extra }, deps);
  const m = o.message;
  const res = Object.fromEntries(Object.entries(checks).map(([k, f]) => [k, !!f(m, o)]));
  const ok = Object.values(res).every(Boolean);
  ok ? pass++ : fail++;
  const ms = Date.now() - t;
  report.push({ text, ok, checks: res, ms, model: m.model, tasks: m.tasks, research: m.research, sources: m.sources?.map((s) => ({ title: s.title, url: s.url })), videos: m.videos?.map((v) => ({ title: v.title, url: v.url, channel: v.video?.channel })), lessonProposal: m.lessonProposal, turn: m.turn, guardNotes: m.guardNotes, answer: m.text });
  console.log(`${ok ? 'PASS' : 'FAIL'} — "${text}" ${Math.round(ms / 1000)}s model=${m.model} sources=${m.sources?.length ?? 0} videos=${m.videos?.length ?? 0} lesson=${m.lessonProposal ? (m.lessonProposal.suggested ? 'suggested' : 'yes') : 'no'} ${ok ? '' : JSON.stringify(res)}`);
  console.log('   ' + m.text.replace(/\s+/g, ' ').slice(0, 300));
  return [...history, { id: `u${report.length}`, role: 'user', text, createdAt: '' }, { id: `a${report.length}`, createdAt: '', ...m }];
}
const notProfileDump = (m) => m.model !== 'martialdex-data' || !/^.{0,40}(스타일|프로필)/.test(m.text);

console.log('\n--- A: 프로필과 의도 분리');
await say([], '내 파이팅 스타일을 분석해 줘.', { analysis: (m) => /프로필 답변으로 계산한 스타일|프로필 스타일/.test(m.text), noWebSearch: (m) => !m.research?.searched });
await say([], '나와 비슷한 UFC 선수는?', { noGarbageNames: (m) => !/\d\. (Are |Pocket |Build |How |Why )/.test(m.text), comparison: (m) => (m.tasks ?? []).some((t) => /비슷한 스타일의 선수/.test(t.label)), searched: (m) => m.research?.searched, notDump: notProfileDump });
await say([], '내 파이팅 스타일은 얼마나 희귀해?', { rarity: (m) => /희귀성/.test(m.text), noFakePercentile: (m) => !/상위\s*\d+\s*%/.test(m.text), noEstimateWithoutStats: (m) => !/통계를 찾지 못했습니다/.test(m.text) || !/(희귀할 것|드물 것|추정됩니다)/.test(m.text.split('코치 정리')[1] ?? '') });
await say([], '내 스타일의 약점은?', { weakness: (m) => /약점/.test(m.text), notDump: notProfileDump });
await say([], '내 스타일에 맞는 더블렉 셋업을 찾아줘.', { setup: (m) => /셋업/.test(m.text) && (m.tasks ?? []).length >= 2, notDump: notProfileDump });

console.log('\n--- B: 내부 DB + 외부 검색 + 영상 + 비교');
let h = [];
h = await say(h, '더블렉 관련 기술을 MARTIALDEX에서 찾아줘.', { db: (m) => /double|더블/i.test(m.text) });
h = await say(h, 'MMA에서 활용되는 더블렉 셋업도 조사해 줘.', { both: (m) => /MARTIALDEX 내부 기록/.test(m.text) && /외부 자료/.test(m.text), searched: (m) => m.research?.searched });
h = await say(h, '더블렉 셋업을 설명하는 유튜브 강의도 찾아줘.', { videos: (m) => (m.videos ?? []).length > 0, honest: (m) => /내용 확인/.test(m.text) });
h = await say(h, '내부 DB에 없는 기술이 있는지 비교해 줘.', { compare: (m) => /MARTIALDEX 비교/.test(m.text) });

console.log('\n--- C: 대화 기억');
h = [];
h = await say(h, '더블렉 테이크다운에 대해 알려줘', {});
h = await say(h, '더블렉 셋업과 연계 기술도 조사해 줘', {});
h = await say(h, 'MMA에서 더블렉을 실제로 어떻게 활용하는지 찾아줘', {});
h = await say(h, '잽은 뭐야?', {});
h = await say(h, '아까 이야기했던 내용으로 수업하고 싶어', { restored: (m) => !!m.lessonProposal && m.lessonProposal.techniqueIds.some((id) => /double/i.test(id)), summary: (m) => (m.lessonProposal?.summary ?? []).length > 0 });
const lastC = report[report.length - 1];
if (lastC.lessonProposal) {
  const cur = CL.buildLessonCurriculum(lastC.lessonProposal, index, [], 'live');
  const ok = !!cur && cur.days[0].techniqueIds.length > 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — 수업 시작 → 기존 수업 엔진 커리큘럼 (${cur?.days[0].techniqueIds.join(', ')})`);
}

console.log('\n--- D: 수업 제안');
h = [];
h = await say(h, '싱글렉 테이크다운은 어떤 기술이야?', {});
h = await say(h, '싱글렉 셋업도 알려줘', {});
h = await say(h, 'MMA에서 싱글렉을 어떻게 쓰는지 조사해 줘', { offered: (m) => !!m.lessonProposal?.suggested || h.some((x) => x.lessonProposal?.suggested) });
const offered = h.filter((x) => x.lessonProposal?.suggested).pop();
if (offered) {
  const at = h.lastIndexOf(offered);
  await say(h.slice(0, at + 1), '아니, 괜찮아', { declined: (m) => /대화를 이어갈게요/.test(m.text) && !m.lessonProposal });
  await say(h.slice(0, at + 1), '좋아', { accepted: (m) => !!m.lessonProposal });
}
const single = report.find((r) => /싱글렉 테이크다운/.test(r.text));
await say([], '이 기술을 MMA에서 쓰는 선수 자료도 찾아줘', { keepsLesson: (m) => /수업은 하던 단계에서 그대로 이어집니다/.test(m.text) || /수업/.test(m.text) }, { inLesson: true, lessonTechniqueId: single?.turn?.topicTechniqueIds?.[0] ?? 'wrestling__basic-double-leg' });

console.log('\n--- E: 복합 질문');
await say([], '내 파이팅 스타일과 비슷한 선수들의 더블렉 셋업을 찾아보고, 관련 MMA 강의 영상까지 조사해서 나에게 맞는 수업으로 만들어 줘.', {
  multi: (m) => (m.tasks ?? []).length >= 3,
  lesson: (m) => !!m.lessonProposal,
  videosOrHonest: (m) => (m.videos ?? []).length > 0 || /영상/.test(m.text),
});

if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), model: st.model, report }, null, 2));
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
