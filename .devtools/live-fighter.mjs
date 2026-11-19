// Live fighter-style analysis from Node — the app's own code (coachAgent → evidenceStyle →
// ruleExtract) with the real self-hosted search (electron/selfSearch: SearXNG + extraction,
// robots.txt respected) and the real name lookup. No model (rule-based path). Prints the answer
// and saves data/audit/self-ai/live-fighter-<label>.json.
// Requires SearXNG. Run: node .devtools/live-fighter.mjs <label> "<question>"
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const [label = 'run', question = '토푸리아의 타격 스타일과 대표적인 셋업, 콤비네이션을 분석해 줘.'] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-fighter-'));
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(path.join(dir, 'e.ts'), [`export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`, `export { analyzeFighterStyleWithEvidence } from ${mod('src/lib/fighterStyle/evidenceStyle.ts')};`, `export { buildKnowledgeIndex } from ${mod('src/lib/martialdexKnowledge/index.ts')};`].join('\n'));
const mem = new Map();
const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, get length() { return 0; } };
globalThis.window = { localStorage: st, sessionStorage: st, setTimeout: () => 0, clearTimeout() {}, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = st;
globalThis.CustomEvent ??= class {};
await build({ entryPoints: [path.join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(dir, 'r.mjs'), logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(path.join(dir, 'r.mjs')).href);
const { research } = require(path.join(APP, 'electron/selfSearch/index.cjs'));
const { resolvePerson } = require(path.join(APP, 'electron/selfSearch/entity.cjs'));
const index = M.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
const searches = [];
const deps = {
  research: async (req) => (searches.push(req), research(req)),
  chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'model not used' }),
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  artName: (a) => a,
  resolveName: resolvePerson,
  fighterStyle: (f, art, o) => M.analyzeFighterStyleWithEvidence(f, art, { research: deps.research, chat: deps.chat, knowledgeIndex: async () => index }, o),
};
const t0 = Date.now();
const o = await M.runCoachTurn({ text: question, history: [], martialArt: null, requestId: 'live' }, deps);
const ms = Date.now() - t0;
console.log(`intent=${o.plan.intent} fighter=${o.plan.fighter} ${ms}ms searches=${searches.length}\n`);
console.log(o.message.text);
fs.writeFileSync(path.join(APP, `data/audit/self-ai/live-fighter-${label}.json`), JSON.stringify({ at: new Date().toISOString(), question, ms, intent: o.plan.intent, searches: searches.map((s) => [s.kind, s.query, ...(s.queries ?? [])]), text: o.message.text, sources: (o.message.sources ?? []).map((s) => s.url) }, null, 2));
