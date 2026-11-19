import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const ld = await server.ssrLoadModule('/src/lib/loadData.ts');
const tc = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const arts = ld.martialArtSummaries.map(a => a.id);
console.log('arts', arts.join(','));
const single = {}; let multi = 0;
for (const t of ld.allTechniques) { const a = tc.techniqueArts(t); if (a.length === 1) single[a[0]] = (single[a[0]]||0)+1; else multi++; }
console.log('total', ld.allTechniques.length, 'multi', multi, 'single', JSON.stringify(single));
for (const a of ld.martialArtSummaries) console.log(a.id, '|', (a.categories||[]).join(' / '));
await server.close();
