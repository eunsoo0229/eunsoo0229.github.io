// Library (add_teq) techniques that, after canonicalization, are still in ONE official art → judgement pack.
import fs from 'node:fs';
import { createServer } from 'vite';
const store = new Map();
globalThis.window = globalThis;
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
const R = await server.ssrLoadModule('/src/lib/addTeq/repository.ts');
const tc = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const OA = await server.ssrLoadModule('/src/lib/techniqueCanonical/otherArts.ts');
R.addTeqRepository.upsertMany(JSON.parse(fs.readFileSync('data/audit/sibling-packs/add-teq-live.json', 'utf8')));
const items = [];
for (const t of tc.libraryTechniques().addTeq) {
  const arts = tc.techniqueArts(t);
  const candidates = OA.siblingArtsOf(t.martialArt, t).filter((a) => !arts.includes(a));
  if (!candidates.length) continue;
  items.push({ id: t.id, name: t.name, koreanName: t.koreanName ?? null, art: t.martialArt, currentArts: arts, category: t.category, positions: t.positions ?? [], description: `${t.posture?.overview ?? t.description ?? ''}`.replace(/\s+/g, ' ').slice(0, 260), candidates });
}
fs.writeFileSync('data/audit/sibling-packs/pack-library-1.json', JSON.stringify(items, null, 1));
console.log('library items', items.length, 'pairs', items.reduce((s, x) => s + x.candidates.length, 0), 'single-art', items.filter((x) => x.currentArts.length === 1).length);
console.log(items.map((x) => `${x.id} [${x.currentArts}]`).join('\n'));
await server.close();
