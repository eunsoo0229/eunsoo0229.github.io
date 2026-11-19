// Technique DB audit — what the app's unified technique corpus really holds, field by
// field, per art. Read-only: nothing in data/ is changed. Writes
// data/audit/knowledge-db/audit.json (+ prints a summary).
//  - per field: filled / empty / "not applicable" (a field that does not apply to the
//    record's kind is not counted as missing — e.g. counters of a stance drill)
//  - duplicates: same normalised name in one art; same name across arts not linked
//  - categories: per art, count, records whose category is not one of the art's own
//  - relations: related ids / transitions / counters / defenses that resolve to nothing
//  - lesson readiness (ready / thin / insufficient) and why
// Run: node .devtools/audit-technique-db.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-audit-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export { getUnifiedAllTechniques, resolveTechnique, normalizeTechniqueName } from ${mod('src/lib/userTechniques/service.ts')};`,
  `export { lessonReadiness } from ${mod('src/lib/coachLesson/lessonReadiness.ts')};`,
  `export { getTechniqueConnections } from ${mod('src/lib/techniqueGraph/buildGraph.ts')};`,
  `export { buildKnowledgeIndex, gatherTechniqueKnowledge } from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export { evidenceFor } from ${mod('src/lib/coachKnowledge/lookup.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);

const all = M.getUnifiedAllTechniques();
const index = M.buildKnowledgeIndex();
const officialCats = new Map();
for (const f of fs.readdirSync(path.join(APP, 'data/processed')).filter((f) => !f.startsWith('_') && f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(APP, 'data/processed', f), 'utf8'));
  officialCats.set(j.martialArt.id, [...new Set(j.techniques.map((t) => t.category))]);
}

// Kinds where some fields do not apply: a stance / grip / position is not "performed" against
// an opponent the way a strike or takedown is, so counters/defenses/setups are not expected.
const POSITIONAL = /(자세|스탠스|stance|포지션|position|grip|그립|tie|control|컨트롤|guard|가드|base|움직임|movement|footwork|풋워크)/i;
const kindOf = (t) => (POSITIONAL.test(`${t.category} ${t.name}`) ? 'position' : 'action');

const FIELDS = [
  ['name', (t) => !!t.name],
  ['koreanName', (t) => !!t.koreanName],
  ['koreanNameFromData', (t, x) => !!t.koreanName || /\(/.test(x.ev.displayName ?? '')],
  ['englishName', (t) => /[a-z]/i.test(t.name)],
  ['martialArt', (t) => !!t.martialArt],
  ['category', (t) => !!t.category],
  ['subcategory(positions)', (t) => t.positions.some((p) => p && p !== t.category)],
  ['description', (t) => !!t.description?.trim()],
  ['overview(posture)', (t) => !!t.posture?.overview?.trim()],
  ['purpose', (t) => !!t.purpose?.trim()],
  ['steps', (t) => (t.posture?.steps?.length ?? 0) >= 2],
  ['keyPoints', (t) => (t.posture?.keyPoints?.length ?? 0) >= 1],
  ['commonMistakes', (t) => (t.posture?.commonMistakes?.length ?? 0) >= 1],
  ['difficulty', (t) => !!t.difficulty],
  ['prerequisite', (t, x) => x.conn.prerequisite.length > 0],
  ['setups', (t, x) => (x.k?.setupsInto.length ?? 0) + (x.k?.setupsUsing.length ?? 0) > 0, 'action'],
  ['combos', (t, x) => (x.k?.combos.length ?? 0) > 0, 'action'],
  ['transitions/next', (t, x) => t.transitions.length + x.conn.next.length + x.conn.chain.length > 0],
  ['counters/defenses', (t, x) => t.counters.length + t.defenses.length + x.conn.counter.length + x.conn.escape.length > 0, 'action'],
  ['videos', (t) => (t.videos?.length ?? 0) > 0],
  ['source/verification', (t) => !!t.source || !!t.verification],
];

const rows = [];
for (const t of all) {
  let conn = { prerequisite: [], next: [], chain: [], counter: [], escape: [], samePosition: [] };
  try { conn = M.getTechniqueConnections(t); } catch { /* no graph */ }
  const k = M.gatherTechniqueKnowledge(t.id, index);
  const ev = M.evidenceFor(t);
  const x = { conn, k, ev };
  const kind = kindOf(t);
  const fields = {};
  for (const [name, has, appliesTo] of FIELDS) fields[name] = appliesTo && appliesTo !== kind ? 'n/a' : has(t, x) ? 'filled' : 'empty';
  const badRefs = [
    ...t.relatedTechniques.filter((id) => !M.resolveTechnique(id)).map((id) => `related:${id}`),
  ];
  rows.push({ id: t.id, art: t.martialArt, name: t.name, ko: t.koreanName, category: t.category, kind, official: !t.source, fields, readiness: M.lessonReadiness(t), badRefs });
}

// ---- per field / per art rates
const arts = [...new Set(rows.map((r) => r.art))].sort();
const rate = (list, f) => {
  const applicable = list.filter((r) => r.fields[f] !== 'n/a');
  const empty = applicable.filter((r) => r.fields[f] === 'empty').length;
  return { applicable: applicable.length, empty, emptyPct: applicable.length ? +((100 * empty) / applicable.length).toFixed(1) : 0 };
};
const fieldRates = Object.fromEntries(FIELDS.map(([f]) => [f, rate(rows, f)]));
const byArt = Object.fromEntries(arts.map((a) => {
  const list = rows.filter((r) => r.art === a);
  return [a, { count: list.length, ...Object.fromEntries(FIELDS.map(([f]) => [f, rate(list, f).emptyPct])) }];
}));

// ---- duplicates
const norm = (s) => M.normalizeTechniqueName(s ?? '');
const dupInArt = [];
const dupAcross = [];
const byKey = new Map();
for (const t of all) for (const n of [t.name, t.koreanName].filter(Boolean)) {
  const key = norm(n);
  if (!key) continue;
  byKey.set(key, [...(byKey.get(key) ?? []).filter((x) => x.id !== t.id), t]);
}
for (const [key, list] of byKey) {
  if (list.length < 2) continue;
  const perArt = new Map();
  for (const t of list) perArt.set(t.martialArt, [...(perArt.get(t.martialArt) ?? []), t.id]);
  for (const [art, ids] of perArt) if (ids.length > 1) dupInArt.push({ key, art, ids });
  const linked = list.every((t) => (t.martialArts ?? [t.martialArt]).length > 1 || list.some((o) => o !== t && (o.martialArts ?? []).includes(t.martialArt)));
  if (perArt.size > 1 && !linked) dupAcross.push({ key, ids: list.map((t) => t.id) });
}

// ---- categories
const categoryIssues = [];
const categories = {};
for (const a of arts) {
  const own = officialCats.get(a) ?? [];
  const list = rows.filter((r) => r.art === a);
  const counts = {};
  for (const r of list) counts[r.category] = (counts[r.category] ?? 0) + 1;
  categories[a] = counts;
  for (const r of list) if (!r.category) categoryIssues.push({ id: r.id, issue: 'category 없음' });
  else if (own.length && !own.includes(r.category)) categoryIssues.push({ id: r.id, issue: `공식 분류에 없는 category "${r.category}"`, official: r.official });
}

// ---- description gap breakdown
const descEmpty = rows.filter((r) => r.fields.description === 'empty');
const descGap = {
  total: descEmpty.length,
  hasPostureOverview: descEmpty.filter((r) => r.fields['overview(posture)'] === 'filled').length,
  noOverview: descEmpty.filter((r) => r.fields['overview(posture)'] === 'empty').map((r) => r.id),
};
const readiness = { ready: 0, thin: 0, insufficient: 0 };
const missingWhy = {};
for (const r of rows) {
  readiness[r.readiness.level]++;
  if (r.readiness.level === 'insufficient') for (const m of r.readiness.missing) missingWhy[m] = (missingWhy[m] ?? 0) + 1;
}
const result = {
  at: new Date().toISOString(),
  total: rows.length,
  official: rows.filter((r) => r.official).length,
  fieldRates, byArt, descGap, readiness, insufficientMissing: missingWhy,
  insufficient: rows.filter((r) => r.readiness.level === 'insufficient').map((r) => ({ id: r.id, missing: r.readiness.missing, rejected: r.readiness.rejected })),
  duplicates: { inArt: dupInArt, acrossArtsUnlinked: dupAcross },
  categories, categoryIssues,
  badRefs: rows.filter((r) => r.badRefs.length).map((r) => ({ id: r.id, refs: r.badRefs })),
  koreanNameMissing: rows.filter((r) => r.fields.koreanNameFromData === 'empty').map((r) => r.id),
};
const outDir = path.join(APP, 'data/audit/knowledge-db');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(result, null, 1));

console.log(`total ${result.total} (official ${result.official})`);
console.log('field                 applicable  empty  empty%');
for (const [f, r] of Object.entries(fieldRates)) console.log(`${f.padEnd(24)}${String(r.applicable).padStart(6)} ${String(r.empty).padStart(6)} ${String(r.emptyPct).padStart(6)}`);
console.log('description gap:', JSON.stringify({ ...descGap, noOverview: descGap.noOverview.length }));
console.log('readiness:', JSON.stringify(readiness), 'insufficient missing:', JSON.stringify(missingWhy));
console.log('dup in art:', dupInArt.length, 'dup across arts (unlinked):', dupAcross.length, 'category issues:', categoryIssues.length, 'bad refs:', result.badRefs.length, 'korean name missing (record+data):', result.koreanNameMissing.length);
console.log('per art empty%:');
for (const [a, v] of Object.entries(byArt)) console.log(`  ${a.padEnd(20)} n=${v.count} desc=${v.description} overview=${v['overview(posture)']} ko=${v.koreanName} koData=${v.koreanNameFromData} steps=${v.steps} keyPts=${v.keyPoints} mistakes=${v.commonMistakes} diff=${v.difficulty} prereq=${v.prerequisite} next=${v['transitions/next']} combos=${v.combos} videos=${v.videos}`);
console.log(`saved ${path.relative(APP, path.join(outDir, 'audit.json'))}`);
