// Measures per-engine success of the local SearXNG (services/searxng/run.sh must be running).
// Real network, no mocks. Run: node .devtools/bench-searxng-engines.mjs [outJson]
import { writeFileSync } from 'node:fs';

const BASE = process.env.SEARXNG_URL || 'http://127.0.0.1:8888';
const ENGINES = (process.env.ENGINES ||
  'google,bing,duckduckgo,brave,startpage,mojeek,qwant,yahoo,presearch,wikipedia,youtube,google videos').split(',');
const QUERIES = [
  'jab setup combinations boxing',
  '복싱 잽 셋업 콤보',
  'Lomachenko footwork angles analysis',
  'kimura trap system bjj',
  '무에타이 티프 카운터',
  'Ilia Topuria boxing style breakdown',
];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
for (const engine of ENGINES) {
  const row = { engine, ok: 0, empty: 0, failed: 0, results: 0, ms: 0, errors: [] };
  for (const q of QUERIES) {
    const url = `${BASE}/search?format=json&q=${encodeURIComponent(q)}&engines=${encodeURIComponent(engine)}`;
    const t = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      row.ms += Date.now() - t;
      const n = (j.results || []).length;
      const un = (j.unresponsive_engines || []).map((u) => u.join(': '));
      if (un.length) { row.failed++; row.errors.push(un[0]); }
      else if (n === 0) row.empty++;
      else { row.ok++; row.results += n; }
    } catch (e) {
      row.failed++; row.errors.push(String(e.message || e));
    }
    await pause(1500); // be polite to upstream engines
  }
  row.avgMs = Math.round(row.ms / QUERIES.length);
  row.errors = [...new Set(row.errors)].slice(0, 3);
  rows.push(row);
  console.log(`${engine.padEnd(14)} ok ${row.ok}/${QUERIES.length} empty ${row.empty} failed ${row.failed} results ${row.results} avg ${row.avgMs}ms ${row.errors.join(' | ')}`);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), queries: QUERIES, rows }, null, 2));
