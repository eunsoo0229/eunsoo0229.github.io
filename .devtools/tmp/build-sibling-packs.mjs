// Builds judgement packs: single-art techniques × sibling arts not yet judged.
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
const ld = await server.ssrLoadModule('/src/lib/loadData.ts');
const tc = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const STRIKING = ['boxing', 'kickboxing', 'muay-thai', 'karate', 'taekwondo'];
const GRAPPLING = ['bjj', 'judo', 'wrestling', 'sambo'];
const ALL = [...STRIKING, ...GRAPPLING];
const judged = new Set(JSON.parse(fs.readFileSync('data/audit/technique-art-decisions.json', 'utf8')).decisions.map((d) => `${d.techniqueId}|${d.art}`));
const out = 'data/audit/sibling-packs';
fs.mkdirSync(out, { recursive: true });
const items = [];
for (const t of ld.allTechniques) {
  const arts = tc.techniqueArts(t);
  if (arts.length !== 1) continue;
  const a = arts[0];
  const sib = a === 'mixed-martial-arts' ? ALL : STRIKING.includes(a) ? STRIKING : GRAPPLING.includes(a) ? GRAPPLING : [];
  const candidates = sib.filter((x) => x !== a && !judged.has(`${t.id}|${x}`));
  if (!candidates.length) continue;
  items.push({ id: t.id, name: t.name, koreanName: t.koreanName ?? null, art: a, category: t.category, positions: t.positions ?? [], description: `${t.posture?.overview ?? t.description ?? ''}`.replace(/\s+/g, ' ').slice(0, 260), candidates });
}
// catalogs: every technique each art already has (to spot same technique under another name)
for (const a of ALL) {
  const list = ld.getTechniquesByMartialArt(a).map((t) => `${t.id}\t${t.name}${t.koreanName ? ` / ${t.koreanName}` : ''}\t[${tc.techniqueCategoryInArt(t, a)}]`);
  fs.writeFileSync(`${out}/catalog-${a}.tsv`, list.join('\n') + '\n');
}
const groups = [['striking', items.filter((i) => STRIKING.includes(i.art))], ['grappling', items.filter((i) => GRAPPLING.includes(i.art))], ['mma', items.filter((i) => i.art === 'mixed-martial-arts')]];
let n = 0;
for (const [g, list] of groups) {
  const size = 75;
  for (let i = 0; i < list.length; i += size) {
    n++;
    fs.writeFileSync(`${out}/pack-${g}-${Math.floor(i / size) + 1}.json`, JSON.stringify(list.slice(i, i + size), null, 1));
  }
  console.log(g, list.length, 'items', list.reduce((s, x) => s + x.candidates.length, 0), 'pairs');
}
console.log('packs', n);
await server.close();
