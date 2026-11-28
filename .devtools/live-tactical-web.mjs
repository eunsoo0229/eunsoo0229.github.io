// LIVE check of TACTICAL FINDER's WEB SEARCH against the REAL Gemini API + Google Search grounding.
// Costs real Gemini usage — runs only with LIVE_GEMINI=1, and a fetch guard lets at most MAX_CALLS HTTP requests
// reach generativelanguage.googleapis.com in total (an overload retry or the 429 model fallback counts too; any
// further call is refused locally and never sent).
//   LIVE_GEMINI=1 node .devtools/live-tactical-web.mjs        (writes data/audit/tactical-finder-web-live.json)
// Path: electron/gemini.cjs askGemini (the Mac app's main-process transport, key from the repo .env exactly as
// main.cjs loads it in dev) → src/lib/tacticalFinder/webSearch.ts (the same parsing / verification the page uses).
// The renderer's daily-use gate (consume_gemini_use on Supabase) is NOT run, so no production row is written.
// The API key is never printed or saved: the request URL (which carries it) is not logged.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

if (process.env.LIVE_GEMINI !== '1') {
  console.error('LIVE_GEMINI=1 이 없어서 실행하지 않습니다 (실제 Gemini 사용량 소모).');
  process.exit(2);
}
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(APP, '.env'), quiet: true });

const MAX_CALLS = 3;
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, init);
  const model = u.match(/models\/([^:]+):/)?.[1] ?? '?';
  if (calls.length >= MAX_CALLS) {
    calls.push({ n: calls.length + 1, model, refused: true });
    throw new Error(`live guard: Gemini HTTP call #${calls.length} refused (limit ${MAX_CALLS})`);
  }
  const rec = { n: calls.length + 1, model, refused: false, sentAt: new Date().toISOString() };
  calls.push(rec);
  const t0 = performance.now();
  const res = await realFetch(url, init);
  rec.httpStatus = res.status;
  rec.ms = Math.round(performance.now() - t0);
  try {
    const j = await res.clone().json();
    const c = j?.candidates?.[0];
    rec.finishReason = c?.finishReason ?? null;
    rec.usageMetadata = j?.usageMetadata ?? null;
    rec.groundingMetadata = c?.groundingMetadata ?? null;
    rec.rawText = c?.content?.parts?.map((p) => p.text || '').join('') ?? null;
    rec.apiError = j?.error ? { code: j.error.code, status: j.error.status, message: String(j.error.message).slice(0, 300) } : null;
  } catch {
    rec.parseFailed = true;
  }
  return res;
};

const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };

const QUERIES = ['더블렉 테이크다운을 위한 셋업', '잽 이후 연결할 수 있는 콤보', '상대가 압박할 때 사용할 카운터 셋업'];
const { askGemini } = require(path.join(APP, 'electron/gemini.cjs'));
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const out = [];
try {
  const W = await server.ssrLoadModule('/src/lib/tacticalFinder/webSearch.ts');
  for (const q of QUERIES) {
    if (calls.length >= MAX_CALLS) break;
    const before = calls.length;
    const t0 = performance.now();
    const r = await W.webSearch(q, 'combo', { ask: (req) => askGemini(req) });
    const ms = Math.round(performance.now() - t0);
    const http = calls.slice(before);
    out.push({ query: q, tab: 'combo', wallMs: ms, httpCalls: http.map(({ rawText, groundingMetadata, ...x }) => x), rawText: http.at(-1)?.rawText ?? null, groundingMetadata: http.at(-1)?.groundingMetadata ?? null, result: r });
    console.log(`\n=== ${q} — ${r.status} · ${ms}ms · HTTP ${http.map((h) => `${h.model}:${h.httpStatus ?? 'refused'}`).join(', ')}`);
    console.log(`grounding sources ${r.groundingSources.length} · queries ${JSON.stringify(r.searchQueries)}`);
    if (r.error) console.log('error:', r.error.code, r.error.message);
    for (const it of r.items) console.log(`  [${it.origin} / ${it.verification}] ${it.kind} ${it.name} :: ${it.steps.map((s) => `${s.name}${s.techniqueId ? '✓' : '✗'}`).join(' → ')} :: sources ${it.sources.length}`);
  }
} finally {
  await server.close();
}
const report = { generatedBy: '.devtools/live-tactical-web.mjs', at: new Date().toISOString(), geminiHttpCallsSent: calls.filter((c) => !c.refused).length, refused: calls.filter((c) => c.refused).length, calls: calls.map(({ rawText, groundingMetadata, ...x }) => x), runs: out };
fs.writeFileSync(path.join(APP, 'data/audit/tactical-finder-web-live.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`\nGemini HTTP calls sent: ${report.geminiHttpCallsSent} (refused locally: ${report.refused})`);
