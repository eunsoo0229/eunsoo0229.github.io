import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
const ld = await server.ssrLoadModule('/src/lib/loadData.ts');
const tc = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const lib = Object.fromEntries(JSON.parse(fs.readFileSync('data/audit/sibling-packs/add-teq-live.json','utf8')).map(r=>[r.id,r.technique]));
const j = JSON.parse(fs.readFileSync('data/audit/judgements-library/sibling-library-1.json','utf8')).filter(x=>x.duplicateOf);
for (const x of j) { const c = ld.getTechnique(x.duplicateOf); const l = lib[x.id]; console.log(`${x.id} (${l?.name}/${l?.koreanName}) → ${x.art}: ${x.duplicateOf} = ${c?.name}/${c?.koreanName} [${c?tc.techniqueArts(c):''}] | ${x.reason}`); }
await server.close();
