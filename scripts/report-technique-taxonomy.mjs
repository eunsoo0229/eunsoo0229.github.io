// 기술 계층 분류 리포트 — builds every art's taxonomy with the app's own code (no API calls, nothing written to the
// technique data) and writes data/audit/technique-taxonomy-report.json: per art the old/new category counts, the
// tree with real counts, multi-classified techniques, review (LOW / no evidence) items, and integrity checks.
// Run: node scripts/report-technique-taxonomy.mjs [--print]
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from '../.devtools/lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxonomy-'));
const entry = path.join(dir, 'e.ts');
const out = path.join(dir, 'o.mjs');
fs.writeFileSync(entry, [
  `export * as TX from ${JSON.stringify(path.join(APP, 'src/lib/techniqueTaxonomy/index.ts'))};`,
  `export { getUnifiedMartialArtSummaries, getUnifiedTechniquesByMartialArt } from ${JSON.stringify(path.join(APP, 'src/lib/userTechniques/service.ts'))};`,
  `export { techniqueCategoryInArt } from ${JSON.stringify(path.join(APP, 'src/lib/techniqueCanonical/index.ts'))};`,
].join('\n'));
const mem = new Map();
const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: st, sessionStorage: st, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: '', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = st;
globalThis.CustomEvent ??= class {};
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);
const { TX } = M;

const report = { generatedAt: new Date().toISOString(), arts: [] };
for (const a of M.getUnifiedMartialArtSummaries()) {
  const techniques = M.getUnifiedTechniquesByMartialArt(a.id);
  const tax = TX.getArtTaxonomy(a.id, techniques);
  const oldCats = new Set(techniques.map((t) => M.techniqueCategoryInArt(t, a.id)));
  const nodes = [...tax.nodes.values()];
  const tree = (id, depth = 0) => {
    const n = tax.nodes.get(id);
    return { id: n.id, level: n.level, kind: n.kind, ko: n.ko, en: n.en, count: n.count, children: n.children.map((c) => tree(c, depth + 1)) };
  };
  const childAssigned = new Set();
  const multi = [];
  for (const [tid, as] of tax.techniqueAssignments) {
    const below = as.filter((x) => tax.nodes.get(x.nodeId)?.level >= 3 && tax.nodes.get(x.nodeId)?.kind !== 'other');
    if (below.length > 0) childAssigned.add(tid);
    const purposeKids = below.filter((x) => tax.nodes.get(x.nodeId)?.kind === 'split' && tax.nodes.get(x.nodeId)?.level === 3);
    if (purposeKids.length > 1) multi.push({ id: tid, nodes: purposeKids.map((x) => tax.nodes.get(x.nodeId).ko) });
  }
  // integrity
  const issues = [];
  const inGroups = new Set(tax.roots.flatMap((r) => [...TX.techniqueIdsForNode(r)]));
  for (const t of techniques) if (!inGroups.has(t.id)) issues.push(`기술이 어떤 그룹에도 없음: ${t.id}`);
  for (const r of tax.roots) {
    const ids = TX.techniqueIdsForNode(r);
    if (ids.size !== tax.nodes.get(r).count) issues.push(`그룹 개수 불일치: ${r}`);
    const own = tax.nodeTechniques.get(r) ?? new Set();
    for (const x of ids) if (!own.has(x)) issues.push(`하위 분류에만 있고 그룹 소속이 아님: ${r} ${x}`);
  }
  const groupOf = new Map();
  for (const r of tax.roots) for (const x of tax.nodeTechniques.get(r) ?? []) {
    if (groupOf.has(x)) issues.push(`한 기술이 두 그룹에: ${x} (${groupOf.get(x)}, ${r})`);
    groupOf.set(x, r);
  }
  for (const n of nodes) if (n.count === 0) issues.push(`빈 노드: ${n.id}`);
  for (const n of nodes) if (n.parentId && !tax.nodes.get(n.parentId)?.children.includes(n.id)) issues.push(`부모-자식 관계 오류: ${n.id}`);
  for (const c of oldCats) if (!tax.categoryNode.get(c)) issues.push(`기존 카테고리 매핑 없음: ${c}`);
  report.arts.push({
    art: a.id,
    nameKo: a.nameKo,
    techniqueCount: techniques.length,
    oldCategoryCount: oldCats.size,
    newGroupCount: tax.roots.length,
    newNodeCount: nodes.length,
    levelCounts: { l2: nodes.filter((n) => n.level === 2).length, l3: nodes.filter((n) => n.level === 3 && n.kind !== 'other').length, l4: nodes.filter((n) => n.level === 4).length },
    reclassifiedCount: childAssigned.size,
    multiClassifiedCount: multi.length,
    reviewCount: tax.review.length,
    categoryMapping: Object.fromEntries([...oldCats].map((c) => [c, tax.categoryNode.get(c)])),
    tree: tax.roots.map((r) => tree(r)),
    multiClassified: multi,
    review: tax.review.map((r) => ({ id: r.techniqueId, name: r.name, group: tax.nodes.get(r.groupId)?.ko, reason: r.reason, candidates: r.candidates.map((c) => `${c.dim}:${c.confidence}`) })),
    integrityIssues: issues,
  });
}
fs.mkdirSync(path.join(APP, 'data/audit'), { recursive: true });
fs.writeFileSync(path.join(APP, 'data/audit/technique-taxonomy-report.json'), JSON.stringify(report, null, 2));
for (const r of report.arts) console.log(`${r.art.padEnd(20)} 기술 ${String(r.techniqueCount).padStart(4)} · 기존 카테고리 ${String(r.oldCategoryCount).padStart(3)} → L2 ${r.levelCounts.l2} / L3 ${r.levelCounts.l3} / L4 ${r.levelCounts.l4} · 세부 분류됨 ${r.reclassifiedCount} · 다중 ${r.multiClassifiedCount} · 검토 ${r.reviewCount} · 무결성 오류 ${r.integrityIssues.length}`);
if (process.argv.includes('--print')) {
  const show = (n, d = 0) => { console.log(`${'  '.repeat(d)}- ${n.ko} (${n.count})`); for (const c of n.children) show(c, d + 1); };
  for (const r of report.arts) { console.log(`\n### ${r.art}`); for (const t of r.tree) show(t); }
}
if (process.argv.includes('--members')) {
  const art = process.argv[process.argv.indexOf('--members') + 1];
  const tax = TX.getArtTaxonomy(art);
  for (const n of tax.nodes.values()) {
    if (n.kind !== 'split' && n.kind !== 'other') continue;
    const ids = [...(tax.nodeTechniques.get(n.id) ?? [])];
    const names = ids.map((id) => { const t = M.getUnifiedTechniquesByMartialArt(art).find((x) => x.id === id); const a = (tax.techniqueAssignments.get(id) ?? []).find((x) => x.nodeId === n.id); return `${t?.name}${a?.confidence === 'MEDIUM' ? '·M' : ''}`; });
    console.log(`■ ${n.id.replace(art + '/', '')} (${ids.length}): ${names.join(', ')}`);
  }
}
if (process.argv.includes('--debug')) {
  const C = await import(pathToFileURL(out).href);
  const ids = process.argv[process.argv.indexOf('--debug') + 1].split(',');
  const all = M.getUnifiedTechniquesByMartialArt(process.argv[process.argv.indexOf('--debug') + 2] ?? 'bjj');
  for (const id of ids) { const t = all.find((x) => x.name === id || x.id === id); if (!t) { console.log('?', id); continue; } const a = TX.classificationOf(t.id, t.martialArt === 'mixed-martial-arts' ? 'mixed-martial-arts' : process.argv[process.argv.indexOf('--debug') + 2] ?? 'bjj'); console.log(`\n${t.name} | overview: ${t.posture?.overview}`); for (const x of a) console.log(`   → ${x.node.id} ${x.assignment.confidence} ${x.assignment.basis}`); }
}
