// Position-first category report (read only): for each art with a position taxonomy — the tree, placements,
// multi-position techniques, review list, and the integrity check against the technique set the art page shows.
//   node .devtools/report-position-taxonomy.mjs <out.json> [--print]
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [out, flag] = process.argv.slice(2);
const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.sessionStorage = globalThis.localStorage;
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const U = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
  const PT = await server.ssrLoadModule('/src/lib/positionTaxonomy/index.ts');
  const report = { at: new Date().toISOString(), arts: {} };
  for (const art of ['bjj', 'mixed-martial-arts']) {
    const techs = U.getUnifiedTechniquesByMartialArt(art);
    const tree = PT.getPositionTree(art, techs);
    const ids = techs.map((t) => t.id);
    const accounted = new Set([...tree.placements.keys(), ...tree.review.map((r) => r.techniqueId)]);
    report.arts[art] = {
      stats: tree.stats,
      integrity: { techniques: ids.length, distinctIds: new Set(ids).size, duplicateIds: ids.length - new Set(ids).size, accounted: accounted.size, missing: ids.filter((id) => !accounted.has(id)) },
      positions: tree.positions.map((p) => ({ id: p.id, ko: p.ko, count: p.count, purposes: p.purposes.map((u) => ({ id: u.id, ko: u.ko, count: u.techniqueIds.length })) })),
      review: tree.review,
      placements: Object.fromEntries([...tree.placements].map(([id, ps]) => [id, ps])),
    };
    if (flag === '--print') {
      console.log(`== ${art}`, JSON.stringify(tree.stats), 'missing', report.arts[art].integrity.missing.length);
      for (const p of report.arts[art].positions) console.log(`  ${p.ko} (${p.count}): ${p.purposes.map((u) => `${u.ko} ${u.count}`).join(' | ')}`);
    }
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
} finally {
  await server.close();
}
