// Migration 0043 (technique_categories + category_admins) in PGlite — RLS, tree rules, in-use delete guard.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-technique-categories-sql.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.env.PGLITE_DIR;
if (!dir) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(path.join(dir, '@electric-sql/pglite/dist/index.js')).href);
const db = new PGlite();
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));
const ADMIN = '11111111-1111-1111-1111-111111111111', U1 = '22222222-2222-2222-2222-222222222222', U2 = '33333333-3333-3333-3333-333333333333';
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${ADMIN}', 'martialdex@martialdex.local'), ('${U1}', 'a@x'), ('${U2}', 'b@x');
  -- stand-in for 0014 add_teq (only the columns the in-use check reads)
  create table public.add_teq (id text primary key, data jsonb not null);
`);
const sql = fs.readFileSync(path.join(APP, 'supabase/migrations/0043_technique_categories.sql'), 'utf8');
try {
  await db.exec(sql);
  await db.exec(sql);
  check('[0] 0043 실행 + 다시 실행해도 안전', true);
} catch (e) {
  check('[0] 0043 실행', false, e.message);
}
async function as(role, uid, q) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    const r = await db.query(q);
    return { ok: true, rows: r.rows, n: r.affectedRows };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await db.exec('reset role;');
  }
}
const ins = (uid, id, parent, ko, extra = {}) => {
  const art = id.split('/')[0];
  const cs = parent ? 'null' : `'${ko} (${extra.en ?? 'X'})'`;
  return as('authenticated', uid, `insert into public.technique_categories (id, art, parent_id, ko, en, category_string, created_by, origin) values ('${id}', '${art}', ${parent ? `'${parent}'` : 'null'}, '${ko}', '${extra.en ?? 'X'}', ${extra.cs ?? cs}, '${extra.by ?? uid}', '${extra.origin ?? 'user'}') returning id`);
};

let r = await as('authenticated', ADMIN, `select public.is_category_admin() as a`);
check('[권한] 운영자 계정이 관리자로 등록됨', r.ok && r.rows[0].a === true, r.rows ?? r.error);
r = await as('authenticated', U1, `select public.is_category_admin() as a`);
check('[권한] 일반 사용자는 관리자 아님', r.ok && r.rows[0].a === false);
r = await as('authenticated', U1, `select * from public.category_admins`);
check('[권한] 관리자 목록은 직접 읽을 수 없음', !r.ok || r.rows.length === 0);

r = await ins(U1, 'bjj/half-guard/c-underhook-a1', 'bjj/half-guard', '언더훅 공방');
check('[생성] 로그인 사용자 하위 카테고리 생성', r.ok, r.error);
r = await ins(U1, 'bjj/half-guard/c-underhook-a2', 'bjj/half-guard', '언더훅  공방');
check('[중복] 같은 위치 같은 이름(공백 차이) 거부', !r.ok, r.error);
r = await ins(U1, 'bjj/closed-guard/c-underhook-a3', 'bjj/closed-guard', '언더훅 공방');
check('[중복] 다른 위치의 같은 이름은 허용 (다른 개념일 수 있음)', r.ok, r.error);
r = await ins(U1, 'bjj/half-guard/c-x', 'bjj/half-guard', '남의 이름', { by: U2 });
check('[RLS] 다른 사람 명의로 생성 불가', !r.ok, r.error);
r = await ins(U1, 'bjj/half-guard/c-y', 'boxing/footwork', '다른 무술 부모');
check('[무결성] 다른 무술 상위 카테고리 거부', !r.ok, r.error);
r = await ins(U1, 'boxing/c-z', 'bjj/half-guard', 'id 무술 불일치');
check('[무결성] id와 상위의 무술 불일치 거부', !r.ok, r.error);
r = await ins(U1, 'bjj/auto-scrambles', null, '스크램블', { en: 'Scrambles' });
check('[생성] 새 대분류 (카테고리 이름 포함)', r.ok, r.error);
r = await ins(U1, 'bjj/auto-nocat', null, '이름없음', { cs: 'null' });
check('[무결성] 대분류는 카테고리 이름 필수', !r.ok, r.error);
r = await ins(U1, 'bjj/half-guard/c-l4', 'bjj/half-guard/c-underhook-a1', '4단계');
check('[무결성] 4단계 허용', r.ok, r.error);
r = await ins(U1, 'bjj/half-guard/c-l5', 'bjj/half-guard/c-l4', '5단계');
check('[무결성] 5단계 거부', !r.ok, r.error);
r = await ins(U1, 'bjj/half-guard/c-l5b', 'bjj/half-guard/sweep/x', '내장 4단계 아래');
check('[무결성] 내장 4단계 노드 아래 거부', !r.ok, r.error);
r = await ins(U1, 'bjj/c-adm', 'bjj/half-guard', '관리자 사칭', { origin: 'admin' });
check('[RLS] 일반 사용자가 admin 출처로 생성 불가', !r.ok, r.error);

r = await as('anon', null, `select * from public.technique_categories`);
check('[RLS] 비로그인 읽기 불가', !r.ok || r.rows.length === 0);
r = await as('authenticated', U2, `select count(*)::int as n from public.technique_categories`);
check('[RLS] 다른 로그인 사용자도 공용 카테고리 읽기', r.ok && r.rows[0].n >= 3, r.rows);

r = await as('authenticated', U1, `update public.technique_categories set ko = '바꿈' where id = 'bjj/half-guard/c-underhook-a1'`);
let row = await as('authenticated', U1, `select ko from public.technique_categories where id = 'bjj/half-guard/c-underhook-a1'`);
check('[RLS] 일반 사용자는 수정 불가 (만든 사람이어도)', row.rows[0].ko === '언더훅 공방');
r = await as('authenticated', ADMIN, `update public.technique_categories set ko = '언더훅 게임', en = 'Underhook Game' where id = 'bjj/half-guard/c-underhook-a1' returning ko`);
check('[관리] 관리자 이름 변경', r.ok && r.rows[0]?.ko === '언더훅 게임', r.error ?? r.rows);
r = await as('authenticated', ADMIN, `update public.technique_categories set parent_id = 'bjj/half-guard/c-l4' where id = 'bjj/half-guard/c-underhook-a1'`);
check('[무결성] 순환 참조 이동 거부', !r.ok, r.error);
r = await as('authenticated', ADMIN, `update public.technique_categories set status = 'merged', merged_into = 'bjj/closed-guard/c-underhook-a3' where id = 'bjj/half-guard/c-l4' returning status`);
check('[관리] 통합', r.ok && r.rows[0]?.status === 'merged', r.error);
r = await as('authenticated', ADMIN, `update public.technique_categories set status = 'merged', merged_into = 'bjj/half-guard/c-l4' where id = 'bjj/closed-guard/c-underhook-a3'`);
check('[무결성] 통합 순환 거부', !r.ok, r.error);
r = await as('authenticated', ADMIN, `update public.technique_categories set status = 'merged' where id = 'bjj/auto-scrambles'`);
check('[무결성] 통합 상태인데 대상 없음 거부', !r.ok, r.error);
r = await as('authenticated', ADMIN, `update public.technique_categories set status = 'inactive' where id = 'bjj/auto-scrambles' returning status`);
check('[관리] 비활성화', r.ok && r.rows[0]?.status === 'inactive');

await db.exec(`insert into public.add_teq values ('bjj__qa1', '{"technique": {"id": "bjj__qa1", "martialArt": "bjj", "category": "하프 가드 (Half Guard)", "taxonomyNodeId": "bjj/half-guard/c-underhook-a1"}}'), ('bjj__qa2', '{"technique": {"id": "bjj__qa2", "martialArt": "bjj", "category": "스크램블 (Scrambles)"}}')`);
r = await as('authenticated', ADMIN, `delete from public.technique_categories where id = 'bjj/half-guard/c-underhook-a1'`);
let n = await as('authenticated', ADMIN, `select count(*)::int as n from public.technique_categories where id = 'bjj/half-guard/c-underhook-a1'`);
check('[삭제] 기술이 있는 카테고리는 관리자도 삭제 불가', n.rows[0].n === 1);
r = await as('authenticated', ADMIN, `delete from public.technique_categories where id = 'bjj/auto-scrambles'`);
n = await as('authenticated', ADMIN, `select count(*)::int as n from public.technique_categories where id = 'bjj/auto-scrambles'`);
check('[삭제] 카테고리 이름을 쓰는 기술이 있으면 삭제 불가', n.rows[0].n === 1);
r = await as('authenticated', ADMIN, `delete from public.technique_categories where id = 'bjj/closed-guard/c-underhook-a3'`);
n = await as('authenticated', ADMIN, `select count(*)::int as n from public.technique_categories where id = 'bjj/closed-guard/c-underhook-a3'`);
check('[삭제] 다른 카테고리가 통합돼 있으면 삭제 불가', n.rows[0].n === 1);
await ins(U1, 'bjj/half-guard/c-temp', 'bjj/half-guard', '임시');
r = await as('authenticated', U2, `delete from public.technique_categories where id = 'bjj/half-guard/c-temp'`);
n = await as('authenticated', U1, `select count(*)::int as n from public.technique_categories where id = 'bjj/half-guard/c-temp'`);
check('[RLS] 남이 만든 카테고리 삭제 불가', n.rows[0].n === 1);
r = await as('authenticated', U1, `delete from public.technique_categories where id = 'bjj/half-guard/c-temp'`);
n = await as('authenticated', U1, `select count(*)::int as n from public.technique_categories where id = 'bjj/half-guard/c-temp'`);
check('[롤백] 만든 사람은 쓰이지 않는 자기 카테고리 삭제 가능', n.rows[0].n === 0);
const kept = await db.query(`select count(*)::int as n from public.add_teq`);
check('[보존] 기술 데이터 그대로', kept.rows[0].n === 2);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
