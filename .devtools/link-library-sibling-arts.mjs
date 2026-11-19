// Links shared-library (add_teq) techniques to the sibling arts that also use them — the
// "add" judgements in data/audit/judgements-library/*.json (criteria:
// data/audit/judgement-criteria/SIBLING-CRITERIA.md). add_teq rows can't be updated, so each
// link is a NEW link record (id link__<art>__<technique id>, technique.linkOf = the technique),
// the same record the app's "다른 무술에 연결" flow writes. Existing rows are never changed.
//
//   ADMIN_ID=MARTIALDEX ADMIN_PASSWORD=... node .devtools/link-library-sibling-arts.mjs            # dry run (default)
//   ADMIN_ID=MARTIALDEX ADMIN_PASSWORD=... node .devtools/link-library-sibling-arts.mjs --publish
// The password is read from the environment only — never written anywhere. No Electron.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const publish = process.argv.includes('--publish');
const { ADMIN_ID: id, ADMIN_PASSWORD: password } = process.env;
if (!id || !password) {
  console.error('ADMIN_ID and ADMIN_PASSWORD are required');
  process.exit(2);
}
const store = new Map();
globalThis.window = globalThis;
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const { supabase } = await server.ssrLoadModule('/src/lib/supabase/client.ts');
const auth = await server.ssrLoadModule('/src/lib/auth/authService.ts');
const addTeq = await server.ssrLoadModule('/src/lib/addTeq/service.ts');
const tc = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const al = await server.ssrLoadModule('/src/lib/techniqueCanonical/artLink.ts');
const cat = await server.ssrLoadModule('/src/lib/techniqueCanonical/category.ts');

const report = { publish, links: [], skipped: [], errors: [] };
try {
  const signIn = await supabase.auth.signInWithPassword({ email: auth.loginEmailFor(id), password });
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  const pulled = await addTeq.pullAddTeqFromCloud();
  if (!pulled.ok) throw new Error(`pull add_teq: ${pulled.message}`);
  const dir = path.join(APP, 'data/audit/judgements-library');
  const judged = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map((j) => ({ ...j, source: f })));
  const now = new Date().toISOString();
  for (const j of judged.filter((x) => x.decision === 'add' && (x.confidence === 'A' || x.confidence === 'B'))) {
    const t = tc.redirectedTechnique(j.id) ?? addTeq.resolveAddTeqTechnique(j.id);
    if (!t) {
      report.skipped.push({ id: j.id, art: j.art, why: 'technique not in the library' });
      continue;
    }
    if (tc.isTechniqueInArt(t, j.art)) {
      report.skipped.push({ id: j.id, art: j.art, why: 'already in art' });
      continue;
    }
    const category = j.category && cat.officialCategoriesOf(j.art).includes(j.category) ? j.category : al.linkCategoryFor(t, j.art);
    const technique = al.linkTechniqueOf(t, j.art, category);
    const record = {
      id: technique.id,
      technique,
      status: 'approved',
      duplicateCheck: { isDuplicate: true, matchedTechniqueId: t.id, matchedTechniqueName: t.name, reason: `기존 기술 '${t.name}'에 무술을 연결 (형제 무술 전수 감사)` },
      verification: { verdict: 'confirmed', confidence: j.confidence === 'A' ? 90 : 75, martialArtConfirmed: j.art, category, canonicalName: t.name, evidenceNotes: [j.reason, j.evidence].filter(Boolean), groundingSources: [], usedSearchGrounding: false, reason: `형제 무술 감사 ${j.confidence}: ${j.reason}` },
      createdAt: now,
      updatedAt: now,
    };
    const line = { id: record.id, technique: t.id, name: t.name, art: j.art, category, confidence: j.confidence, reason: j.reason };
    if (!publish) {
      report.links.push(line);
      continue;
    }
    const r = await addTeq.insertAddTeqTechnique(record);
    if (r.ok) report.links.push(line);
    else report.errors.push({ ...line, error: r.message });
  }
} catch (e) {
  report.errors.push({ error: String(e?.message ?? e) });
} finally {
  await supabase.auth.signOut().catch(() => {});
  await server.close();
}
const out = path.join(APP, `data/audit/library-sibling-links-${publish ? 'publish' : 'dryrun'}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ publish, links: report.links.length, skipped: report.skipped.length, errors: report.errors.length, out: path.relative(APP, out) }));
