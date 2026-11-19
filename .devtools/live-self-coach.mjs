// LIVE end-to-end check of the 자체 AI 코치: real local model (Ollama) + real
// self-hosted search (SearXNG) + real technique DB, through the same coachAgent
// the app uses. No mocks, no Gemini/Tavily. Needs `ollama serve` and
// services/searxng/run.sh. Run: node .devtools/live-self-coach.mjs [outJson]
//   STYLE=1 also runs the evidence-based fighter style analysis (slow on CPU).
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-self-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export * as FS from ${mod('src/lib/fighterStyle/evidenceStyle.ts')};`,
  `export { answerCoachQuestion } from ${mod('src/lib/coachKnowledge/questions.ts')};`,
  `export { getMartialArt } from ${mod('src/lib/loadData.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { A, K, FS, answerCoachQuestion, getMartialArt } = await import(pathToFileURL(out).href);

const st = await selfAi.status();
const ss = await selfSearch.searxStatus();
console.log(`model ${st.model} ok=${st.ok} · searxng ok=${ss.ok}`);
if (!st.ok || !ss.ok) { console.log('SKIP — local model or SearXNG not running'); process.exit(2); }

const index = K.buildKnowledgeIndex({});
const deps = {
  research: (req) => selfSearch.research(req),
  chat: (req, onDelta) => selfAi.chat(req, onDelta),
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  // same wiring as src/lib/selfAi/deps.ts (data engine; local-model rewording off like the app default)
  dataAnswer: async (t, text, art) => (await answerCoachQuestion(t, text, { useModel: false, martialArt: art })).text || null,
  artName: (art) => getMartialArt(art)?.nameKo ?? art,
};
const CASES = [
  { text: '안녕하세요', art: null, expectSearch: false, mustNot: /합쇼/ },
  { text: '암바 할 때 엉덩이는 어떻게 해야 해?', art: 'bjj', expectSearch: false, expectModel: 'martialdex-data' },
  { text: '복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어', art: 'boxing', expectSearch: true, expectLesson: true, mustNot: /킥복싱/ },
  { text: '로마첸코 풋워크 영상 보여줘', art: 'boxing', expectSearch: true, expectModel: 'martialdex-list', mustHave: /\[1\]/ },
  { text: '잽 펀치 속도에 관한 연구 논문 있어?', art: 'boxing', expectSearch: true, expectModel: 'martialdex-list', mustHave: /\[1\]/ },
  { text: '요즘 훈련이 너무 힘들어서 그만두고 싶어', art: null, expectSearch: false },
];
let pass = 0, fail = 0;
const report = [];
for (const c of CASES) {
  const t = Date.now();
  let first = 0;
  const o = await A.runCoachTurn({ text: c.text, history: [], martialArt: c.art, requestId: `live-${Date.now()}`, onDelta: () => { if (!first) first = Date.now() - t; } }, deps);
  const m = o.message;
  const urls = new Set((m.sources ?? []).map((s) => s.url));
  const checks = {
    searchAsExpected: m.research.searched === c.expectSearch,
    modelAnswered: !m.dataOnly,
    engine: c.expectModel ? m.model === c.expectModel : true,
    mustNot: c.mustNot ? !c.mustNot.test(m.text) : true,
    mustHave: c.mustHave ? c.mustHave.test(m.text) : true,
    sourcesAreRetrieved: (m.sources ?? []).every((s) => o.results.some((r) => r.url === s.url)),
    noUnknownUrlsInText: [...m.text.matchAll(/https?:\/\/\S+/g)].every((u) => urls.has(u[0])),
    lesson: c.expectLesson ? !!m.lessonProposal : true,
    korean: m.model === 'martialdex-list' || ((m.text.match(/[가-힣]/g) ?? []).length / Math.max(1, (m.text.match(/[A-Za-z가-힣]/g) ?? []).length)) > 0.6,
  };
  const ok = Object.values(checks).every(Boolean);
  ok ? pass++ : fail++;
  const ms = Date.now() - t;
  report.push({ ...c, ok, checks, ms, firstTokenMs: first, research: m.research, sources: m.sources?.map((s) => ({ title: s.title, url: s.url, type: s.sourceTypeLabel, reliability: s.reliability.label, contentRead: s.contentRead })), guardNotes: m.guardNotes, text: m.text });
  console.log(`${ok ? 'PASS' : 'FAIL'} — "${c.text}" ${ms}ms (first token ${first}ms) sources=${m.sources?.length ?? 0} ${ok ? '' : JSON.stringify(checks)}`);
  console.log('   ' + m.text.replace(/\s+/g, ' ').slice(0, 260));
  if (m.guardNotes) console.log('   guard: ' + m.guardNotes.join(' / '));
}
if (process.env.STYLE) {
  const t = Date.now();
  const rep = await FS.analyzeFighterStyleWithEvidence('Vasyl Lomachenko', 'boxing', { research: deps.research, chat: (r) => selfAi.chat(r), knowledgeIndex: deps.knowledgeIndex }, (s) => console.log('   …' + s));
  const counts = rep.items.reduce((a, i) => ((a[i.support] = (a[i.support] ?? 0) + 1), a), {});
  console.log(`STYLE Lomachenko ${Date.now() - t}ms items=${JSON.stringify(counts)} videos=${rep.videos.length} candidates=${rep.candidates.length} limits=${rep.limits.length}`);
  for (const i of rep.items.slice(0, 8)) console.log(`   [${i.support}] ${i.kind} ${i.steps?.join('→') ?? ''} ${i.text.slice(0, 80)} ${i.quotes.filter((q) => q.verified).map((q) => q.site).join(',')}`);
  report.push({ style: { ms: Date.now() - t, counts, items: rep.items, videos: rep.videos, limits: rep.limits, candidates: rep.candidates.map((c) => ({ name: c.name, kind: c.kind, status: c.status })) } });
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), model: st.model, report }, null, 2));
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
