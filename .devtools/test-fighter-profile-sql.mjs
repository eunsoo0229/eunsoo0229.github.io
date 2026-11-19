// Migration 0041 (fighter_profiles) in PGlite — own-row RLS, checks, re-run safety.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-fighter-profile-sql.mjs
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
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
  -- an existing table that must stay untouched
  create table public.nutrition_profiles (user_id uuid primary key, data jsonb not null, updated_at timestamptz not null default now());
  insert into public.nutrition_profiles values ('11111111-1111-1111-1111-111111111111', '{"kept":true}');
`);
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
const sql = fs.readFileSync(path.join(APP, 'supabase/migrations/0041_fighter_profiles.sql'), 'utf8');
try {
  await db.exec(sql);
  check('[0] 0041 실행', true);
  await db.exec(sql);
  check('[0] 0041 다시 실행해도 안전', true);
} catch (e) {
  check('[0] 0041 실행', false, e.message);
}
async function as(role, uid, q) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    const r = await db.query(q);
    return { ok: true, rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await db.exec('reset role;');
  }
}
const doc = (stance) => `'{"version":1,"items":{"body.stance":{"key":"body.stance","state":"answered","value":"${stance}"}},"style":null,"history":[],"interview":{"status":"idle"}}'::jsonb`;
let r = await as('authenticated', U1, `insert into public.fighter_profiles (user_id, data) values ('${U1}', ${doc('southpaw')}) returning user_id`);
check('[RLS] 본인 프로필 생성', r.ok, r.error);
r = await as('authenticated', U1, `select data->'items'->'body.stance'->>'value' as v from public.fighter_profiles`);
check('[RLS] 본인 프로필 조회', r.ok && r.rows.length === 1 && r.rows[0].v === 'southpaw', r.rows ?? r.error);
r = await as('authenticated', U2, `select * from public.fighter_profiles`);
check('[RLS] 다른 사용자는 남의 프로필을 볼 수 없음', r.ok && r.rows.length === 0, r.rows ?? r.error);
r = await as('authenticated', U2, `insert into public.fighter_profiles (user_id, data) values ('${U1}', ${doc('orthodox')})`);
check('[RLS] 남의 user_id로 생성 불가', !r.ok, r.error);
r = await as('authenticated', U2, `update public.fighter_profiles set data = ${doc('orthodox')} where user_id = '${U1}'`);
const after = await as('authenticated', U1, `select data->'items'->'body.stance'->>'value' as v from public.fighter_profiles`);
check('[RLS] 남의 프로필 수정 불가 (값 그대로)', after.rows[0].v === 'southpaw');
r = await as('authenticated', U1, `update public.fighter_profiles set user_id = '${U2}' where user_id = '${U1}'`);
check('[RLS] 본인 행을 남에게 넘기기 불가 (with check)', !r.ok, r.error);
r = await as('authenticated', U2, `delete from public.fighter_profiles where user_id = '${U1}'`);
const still = await as('authenticated', U1, `select count(*)::int as n from public.fighter_profiles`);
check('[RLS] 남의 프로필 삭제 불가', still.rows[0].n === 1);
r = await as('anon', null, `select * from public.fighter_profiles`);
check('[RLS] 비로그인(anon) 접근 불가', !r.ok || r.rows.length === 0, r.error ?? r.rows);
r = await as('authenticated', U1, `update public.fighter_profiles set data = ${doc('orthodox')}, updated_at = now() where user_id = '${U1}' returning data->'items'->'body.stance'->>'value' as v`);
check('[수정] 본인 프로필 수정', r.ok && r.rows[0]?.v === 'orthodox', r.rows ?? r.error);
r = await as('authenticated', U1, `insert into public.fighter_profiles (user_id, data) values ('${U1}', '[1,2]'::jsonb) on conflict (user_id) do update set data = excluded.data`);
check('[검증] 객체가 아닌 data 거부', !r.ok, r.error);
r = await as('authenticated', U1, `update public.fighter_profiles set data = '{"items":[]}'::jsonb where user_id = '${U1}'`);
check('[검증] items가 객체가 아니면 거부', !r.ok, r.error);
r = await as('authenticated', U2, `insert into public.fighter_profiles (user_id, data) values ('${U2}', ${doc('switch')}) on conflict (user_id) do update set data = excluded.data returning user_id`);
check('[RLS] 두 번째 사용자도 자기 행 생성 (upsert)', r.ok, r.error);
r = await as('authenticated', U1, `delete from public.fighter_profiles where user_id = '${U1}'`);
const gone = await as('authenticated', U1, `select count(*)::int as n from public.fighter_profiles`);
check('[삭제] 본인 프로필 삭제', gone.rows[0].n === 0);
const kept = await db.query(`select data->>'kept' as k from public.nutrition_profiles`);
check('[보존] 기존 테이블 데이터 그대로', kept.rows[0].k === 'true');
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
