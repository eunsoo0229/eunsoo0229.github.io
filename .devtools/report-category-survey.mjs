// Category survey (read only): per art — techniques the art page shows, existing category strings, the current
// hierarchical taxonomy (techniqueTaxonomy), duplicates / unassigned / multi-placed techniques.
//   node .devtools/report-category-survey.mjs <out.json> [art,art]
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [out, artsArg] = process.argv.slice(2);
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
  const T = await server.ssrLoadModule('/src/lib/techniqueTaxonomy/index.ts');
  const C = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
  const arts = artsArg ? artsArg.split(',') : U.getUnifiedMartialArts?.().map((a) => a.id) ?? [];
  const report = { at: new Date().toISOString(), arts: {} };
  let total = 0;
  for (const art of arts) {
    const techs = U.getUnifiedTechniquesByMartialArt(art);
    total += techs.length;
    const ids = techs.map((t) => t.id);
    const cats = {};
    for (const t of techs) {
      const c = C.techniqueCategoryInArt(t, art);
      (cats[c] ??= []).push(t.id);
    }
    const tax = T.getArtTaxonomy(art, techs);
    const nodes = [...tax.nodes.values()];
    const placed = new Set([...tax.techniqueAssignments.keys()]);
    const multi = [...tax.techniqueAssignments.entries()].filter(([, a]) => new Set(a.filter((x) => tax.nodes.get(x.nodeId)?.level === 2).map((x) => x.nodeId)).size > 1).length;
    const tree = (id, d = 0) => { const n = tax.nodes.get(id); return [`${'  '.repeat(d)}${n.ko} (${n.count})${n.kind !== 'group' ? ' [' + n.kind + ']' : ''}`, ...n.children.flatMap((c) => tree(c, d + 1))]; };
    report.arts[art] = {
      techniques: techs.length,
      ownTechniques: techs.filter((t) => t.martialArt === art).length,
      fromOtherArts: techs.filter((t) => t.martialArt !== art).length,
      duplicateIds: ids.length - new Set(ids).size,
      categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v.length])),
      categoryCount: Object.keys(cats).length,
      taxonomy: { level2: tax.roots.length, nodes: nodes.length, byLevel: { 2: nodes.filter((n) => n.level === 2).length, 3: nodes.filter((n) => n.level === 3).length, 4: nodes.filter((n) => n.level === 4).length }, placed: placed.size, unplaced: techs.filter((t) => !placed.has(t.id)).length, inSeveralGroups: multi, review: tax.review.length },
      tree: tax.roots.flatMap((r) => tree(r)),
      techniqueCategories: Object.fromEntries(techs.map((t) => [t.id, { name: t.koreanName || t.name, art: t.martialArt, category: C.techniqueCategoryInArt(t, art), positions: t.positions }])),
    };
  }
  report.totalTechniquesShown = total;
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  for (const [a, r] of Object.entries(report.arts)) console.log(a.padEnd(20), 'tech', r.techniques, `(own ${r.ownTechniques}, other ${r.fromOtherArts})`, 'cats', r.categoryCount, 'L2', r.taxonomy.level2, 'nodes', r.taxonomy.nodes, 'unplaced', r.taxonomy.unplaced, 'multiGroup', r.taxonomy.inSeveralGroups, 'review', r.taxonomy.review, 'dupIds', r.duplicateIds);
} finally {
  await server.close();
}
