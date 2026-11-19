// 무술 추가 기능 제거 + 우슈·택견 정리 — offline checks, nothing touches Supabase.
//  1. app: the shared-library snapshot (data/audit/sibling-packs/add-teq-live.json)
//     loaded into the local cache → no 우슈/택견 art, technique, count or link;
//     personal records and ids still resolve; other arts unchanged.
//  2. source: no 무술 추가 route / page / service left.
//  3. SQL (PGlite, if PGLITE_DIR is set): migration 0048 archives, keeps a
//     technique another art refers to, never touches personal tables, closes
//     inserts; the restore script brings the rows back.
// Run: node .devtools/test-retire-custom-arts.mjs   (PGLITE_DIR=/path/to/node_modules for part 3)
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
const RETIRED = ['wushu', 'taekkyon'];
const isRetired = (id) => RETIRED.some((a) => id === a || id.startsWith(a + '__'));

// ---------- 1. app ----------
const live = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/sibling-packs/add-teq-live.json'), 'utf8'));
const retiredLive = live.filter((r) => RETIRED.includes(r.technique.martialArt));
// a link record filed under 우슈 pointing at an official technique must not add 우슈 to it
const official = JSON.parse(fs.readFileSync(path.join(APP, 'data/processed/boxing.json'), 'utf8')).techniques[0];
const linkRecord = { ...retiredLive[0], id: 'wushu__link-test', technique: { ...retiredLive[0].technique, id: 'wushu__link-test', linkOf: official.id } };
const personal = {
  id: 'wushu__my-own',
  technique: { ...retiredLive[0].technique, id: 'wushu__my-own', name: 'My Wushu Form' },
  status: 'approved',
  addedByUserId: null,
  duplicateCheck: retiredLive[0].duplicateCheck,
  verification: retiredLive[0].verification,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-arts-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export { getUnifiedAllTechniques, getUnifiedMartialArtSummaries, getUnifiedMartialArt, getUnifiedTechniquesByMartialArt, resolveTechnique, searchAllTechniques } from ${mod('src/lib/userTechniques/service.ts')};`,
  `export { techniqueArts } from ${mod('src/lib/techniqueCanonical/index.ts')};`,
  `export { RETIRED_MARTIAL_ART_IDS, isManagedMartialArt, martialArtSummaries } from ${mod('src/lib/loadData.ts')};`,
  `export { AI_FEATURES } from ${mod('src/lib/aiCoach/aiFeatureCatalog.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
mem.set('martialdex:add-teq-cache', JSON.stringify([...live, linkRecord]));
mem.set('martialdex:user-techniques', JSON.stringify([personal]));
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);

check('[app] 스냅샷에 우슈·택견 기술이 실제로 있음 (테스트 전제)', retiredLive.length === 18, retiredLive.length);
const summaries = M.getUnifiedMartialArtSummaries();
check('[app] 무술 목록 = 공식 무술만', summaries.length === M.martialArtSummaries.length && summaries.every((a) => M.isManagedMartialArt(a.id)), summaries.map((a) => a.id));
check('[app] 무술 목록에 우슈·택견 없음', !summaries.some((a) => RETIRED.includes(a.id)));
check('[app] 우슈·택견 상세 조회 → 없음 (목록으로 리다이렉트)', RETIRED.every((a) => M.getUnifiedMartialArt(a) === undefined));
check('[app] RETIRED_MARTIAL_ART_IDS 는 관리 무술이 아님', [...M.RETIRED_MARTIAL_ART_IDS].every((a) => !M.isManagedMartialArt(a)), [...M.RETIRED_MARTIAL_ART_IDS]);
const all = M.getUnifiedAllTechniques();
check('[app] 전체 기술 목록에 우슈·택견 기술 없음', !all.some((t) => RETIRED.includes(t.martialArt)), all.filter((t) => RETIRED.includes(t.martialArt)).map((t) => t.id));
check('[app] 기술 검색에 안 나옴 (품밟기·정제퇴)', !M.searchAllTechniques('품밟기').some((t) => isRetired(t.id)) && !M.searchAllTechniques('Zheng Ti Tui').some((t) => isRetired(t.id)));
check('[app] 우슈 무술별 기술 = 0', M.getUnifiedTechniquesByMartialArt('wushu').length === 0);
check('[app] 우슈 링크 레코드가 공식 기술에 우슈를 붙이지 않음', !M.techniqueArts(M.resolveTechnique(official.id)).includes('wushu'), M.techniqueArts(M.resolveTechnique(official.id)));
check('[app] 링크 레코드 id 는 여전히 공식 기술로 연결', !!M.resolveTechnique(official.id) && M.resolveTechnique('wushu__link-test')?.id === M.resolveTechnique(official.id).id, M.resolveTechnique('wushu__link-test')?.id);
check('[app] 기존 공유 기술 id 는 여전히 조회됨 (학습 기록 표시용)', retiredLive.every((r) => M.resolveTechnique(r.id)?.id === r.id));
check('[app] 개인 기술 데이터 보존 + id 조회 가능', JSON.parse(mem.get('martialdex:user-techniques')).length === 1 && M.resolveTechnique('wushu__my-own')?.name === 'My Wushu Form');
const otherLive = live.filter((r) => !RETIRED.includes(r.technique.martialArt) && !r.technique.linkOf);
const bjjLib = otherLive.filter((r) => r.technique.martialArt === 'bjj').map((r) => r.id);
check('[app] 다른 무술의 공유 기술은 그대로 (bjj)', bjjLib.length > 0 && bjjLib.every((id) => M.resolveTechnique(id)), bjjLib.length);
check('[app] AI 기능 목록에 무술 추가 없음', !M.AI_FEATURES.some((f) => f.to === '/arts/add' || f.id === 'art-request'));

// ---------- 2. source ----------
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');
const app = read('src/App.tsx');
check('[src] AddMartialArt 페이지/모듈 삭제', !fs.existsSync(path.join(APP, 'src/pages/AddMartialArt.tsx')) && !fs.existsSync(path.join(APP, 'src/lib/customMartialArt')) && !fs.existsSync(path.join(APP, 'src/lib/cloudSync/customMartialArtSync.ts')));
check('[src] /arts/add 는 무술 목록으로 리다이렉트만', !app.includes('AddMartialArt') && /path="\/arts\/add" element=\{<Navigate to="\/arts" replace \/>\}/.test(app));
check('[src] 무술 목록에 "+ 무술 추가" 버튼 없음', !read('src/pages/MartialArtsList.tsx').includes('/arts/add'));
const svc = read('src/lib/martialArtDiscovery/service.ts');
check('[src] 새 무술 검증·등록 함수 삭제, 기술 요청은 유지', !/verifyNewMartialArt|registerNewMartialArt|researchTechniquesForMartialArt|custom_martial_arts|insertCustomMartialArt/.test(svc) && /export async function verifyMissingTechnique/.test(svc) && /export async function registerMissingTechnique/.test(svc));
const srcFiles = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : /\.(ts|tsx)$/.test(f.name) && srcFiles.push(path.join(d, f.name)); })(path.join(APP, 'src'));
const writers = srcFiles.filter((f) => /from\('custom_martial_arts'\)/.test(fs.readFileSync(f, 'utf8')));
check('[src] custom_martial_arts 를 읽거나 쓰는 코드 없음', writers.length === 0, writers.map((f) => path.relative(APP, f)));
check('[src] 시작 시 공유 레지스트리 로컬 사본 정리', read('src/main.tsx').includes("removeItem('martialdex:custom-martial-arts-cache')"));

// ---------- 3. SQL ----------
const pgDir = process.env.PGLITE_DIR;
if (!pgDir) {
  console.log('NOT TESTED — SQL part (set PGLITE_DIR)');
} else {
  // the browser-like globals above make PGlite take its browser code path
  delete globalThis.window;
  delete globalThis.localStorage;
  const { PGlite } = await import(pathToFileURL(path.join(pgDir, '@electric-sql/pglite/dist/index.js')).href);
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('11111111-1111-1111-1111-111111111111');
  `);
  await db.exec(read('supabase/migrations/0014_add_teq.sql'));
  await db.exec(read('supabase/migrations/0031_custom_martial_arts.sql'));
  await db.exec(read('supabase/migrations/0005_user_techniques.sql'));
  const U = '11111111-1111-1111-1111-111111111111';
  const addTeqCols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='add_teq' and is_nullable='NO' and column_default is null`)).rows.map((r) => r.column_name);
  const insertTeq = async (id, art, data = {}) => {
    const vals = { id, martial_art: art, name: id, data: JSON.stringify({ id, martialArt: art, ...data }) };
    const cols = [...new Set(['id', 'martial_art', 'name', 'data', ...addTeqCols])];
    await db.query(`insert into public.add_teq (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map((c) => vals[c] ?? (c === 'status' ? 'approved' : c.endsWith('_at') ? new Date().toISOString() : c === 'category' ? 'other' : '')));
  };
  try {
    for (const art of RETIRED) await db.query(`insert into public.custom_martial_arts (id, name_ko, description, added_by, data) values ($1, $1, 'x', $2, '{}')`, [art, U]);
    await insertTeq('wushu__a', 'wushu');
    await insertTeq('wushu__kept', 'wushu');
    await insertTeq('taekkyon__b', 'taekkyon');
    await insertTeq('bjj__x', 'bjj', { relatedTechniques: ['wushu__kept'] });
    await insertTeq('boxing__y', 'boxing');
    const utCols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='user_techniques'`)).rows.map((r) => r.column_name);
    await db.query(`insert into public.user_techniques (id, user_id, technique_id, martial_art, data${utCols.includes('status') ? ', status' : ''}) values ('wushu__mine', $1, 'wushu__mine', 'wushu', '{}'${utCols.includes('status') ? ", 'approved'" : ''})`, [U]);
    check('[sql] 시드 준비', true);
  } catch (e) {
    check('[sql] 시드 준비', false, e.message);
  }
  const count = async (q) => Number((await db.query(q)).rows[0].n);
  const mig = read('supabase/migrations/0048_retire_custom_martial_arts.sql');
  try {
    await db.exec(mig);
    check('[sql] 0048 실행', true);
  } catch (e) {
    check('[sql] 0048 실행', false, e.message);
  }
  check('[sql] 레지스트리 행 삭제', (await count(`select count(*) n from public.custom_martial_arts`)) === 0);
  check('[sql] 우슈·택견 공유 기술 삭제', (await count(`select count(*) n from public.add_teq where id in ('wushu__a','taekkyon__b')`)) === 0);
  check('[sql] 다른 무술이 참조하는 기술은 유지', (await count(`select count(*) n from public.add_teq where id = 'wushu__kept'`)) === 1);
  check('[sql] 다른 무술 기술 유지', (await count(`select count(*) n from public.add_teq where id in ('bjj__x','boxing__y')`)) === 2);
  check('[sql] 개인 데이터(user_techniques) 유지', (await count(`select count(*) n from public.user_techniques where technique_id = 'wushu__mine'`)) === 1);
  check('[sql] 백업: 레지스트리 2 + 기술 2 (전체 행)', (await count(`select count(*) n from public.retired_records_archive`)) === 4 && (await count(`select count(*) n from public.retired_records_archive where row_data ? 'data' and row_data ? 'martial_art'`)) === 2);
  try {
    await db.exec(mig);
    check('[sql] 0048 다시 실행해도 안전 (백업 중복 없음)', (await count(`select count(*) n from public.retired_records_archive`)) === 4);
  } catch (e) {
    check('[sql] 0048 다시 실행해도 안전', false, e.message);
  }
  let blocked = false;
  await db.exec(`select set_config('request.jwt.claim.sub', '${U}', false); set role authenticated;`);
  try {
    await db.query(`insert into public.custom_martial_arts (id, name_ko, description, added_by, data) values ('kungfu', 'k', 'x', '${U}', '{}')`);
  } catch {
    blocked = true;
  }
  let archiveHidden = false;
  try {
    await db.query(`select * from public.retired_records_archive`);
  } catch {
    archiveHidden = true;
  }
  await db.exec(`reset role;`);
  check('[sql] 앱 사용자는 무술을 더 추가할 수 없음', blocked);
  check('[sql] 백업 테이블은 앱 사용자에게 안 보임', archiveHidden);
  try {
    await db.exec(read('supabase/maintenance/0048_restore_retired_arts.sql'));
    check('[sql] 복구 스크립트 실행', true);
  } catch (e) {
    check('[sql] 복구 스크립트 실행', false, e.message);
  }
  check('[sql] 복구: 레지스트리 2 + 기술 2 돌아옴', (await count(`select count(*) n from public.custom_martial_arts`)) === 2 && (await count(`select count(*) n from public.add_teq where id in ('wushu__a','taekkyon__b')`)) === 2);
  try {
    // minimal stand-ins for the other tables the survey reads (only the columns it uses)
    await db.exec(`
      create table public.shared_combos (id text, martial_art text, technique_ids text[]);
      create table public.community_posts (id text, tags jsonb);
      create table public.technique_reports (technique_id text);
      create table public.technique_video_picks (technique_id text, user_id uuid);
      create table public.curricula (user_id uuid, martial_art text, data jsonb);
      create table public.training_history (user_id uuid, data jsonb);
      create table public.combos (user_id uuid, data jsonb);
    `);
    await db.exec(read('supabase/maintenance/0048_survey_retired_arts.sql'));
    check('[sql] 사전 조사 SQL 실행 (읽기 전용)', true);
  } catch (e) {
    check('[sql] 사전 조사 SQL 문법', false, e.message);
  }
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
