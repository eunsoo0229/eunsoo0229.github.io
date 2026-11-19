// Migration 0044 (training_goals) in PGlite — own-row RLS, checks, re-run safety, existing tables untouched.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-training-goals-sql.mjs
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
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
  -- an existing table that must stay untouched (0041 shape)
  create table public.fighter_profiles (user_id uuid primary key, data jsonb not null, updated_at timestamptz not null default now());
  insert into public.fighter_profiles values ('11111111-1111-1111-1111-111111111111', '{"kept":true}');
  grant select on public.fighter_profiles to authenticated;
`);
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
const sql = fs.readFileSync(path.join(APP, 'supabase/migrations/0044_training_goals.sql'), 'utf8');
try {
  await db.exec(sql);
  check('[0] 0044 실행', true);
  await db.exec(sql);
  check('[0] 0044 다시 실행해도 안전 (create if not exists · drop policy if exists)', true);
} catch (e) {
  check('[0] 0044 실행', false, e.message);
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
const doc = (text, period = '2026-W45') =>
  `'{"version":1,"entries":[{"id":"a","scope":"week","periodKey":"${period}","text":"${text}","createdAt":"2026-11-07T00:00:00.000Z","updatedAt":"2026-11-07T00:00:00.000Z"}],"updatedAt":"2026-11-07T00:00:00.000Z"}'::jsonb`;

let r = await as('authenticated', U1, `insert into public.training_goals (user_id, data) values ('${U1}', ${doc('더블렉 진입')}) returning user_id`);
check('[RLS] 본인 목표 생성', r.ok, r.error);
r = await as('authenticated', U1, `select data->'entries'->0->>'text' as v from public.training_goals`);
check('[RLS] 본인 목표 조회', r.ok && r.rows.length === 1 && r.rows[0].v === '더블렉 진입', r.rows ?? r.error);
r = await as('authenticated', U2, `select * from public.training_goals`);
check('[RLS] 다른 사용자는 남의 목표를 볼 수 없음 (개인정보 격리)', r.ok && r.rows.length === 0, r.rows ?? r.error);
r = await as('authenticated', U2, `insert into public.training_goals (user_id, data) values ('${U1}', ${doc('남의 행 위조')})`);
check('[RLS] 다른 사용자 id로 행을 만들 수 없음', !r.ok, r.error ?? r.rows);
r = await as('authenticated', U2, `update public.training_goals set data = ${doc('덮어쓰기 시도')} where user_id = '${U1}'`);
check('[RLS] 남의 목표를 수정할 수 없음', r.ok && r.affected === 0, { affected: r.affected, error: r.error });
r = await as('authenticated', U2, `delete from public.training_goals where user_id = '${U1}'`);
check('[RLS] 남의 목표를 지울 수 없음', r.ok && r.affected === 0, { affected: r.affected, error: r.error });
r = await as('anon', null, `select * from public.training_goals`);
check('[RLS] 비로그인(anon)은 접근 불가', !r.ok, r.error ?? r.rows);

r = await as('authenticated', U1, `update public.training_goals set data = '[]'::jsonb where user_id = '${U1}'`);
check('[검증] data 는 객체여야 함', !r.ok, r.error);
r = await as('authenticated', U1, `update public.training_goals set data = '{"version":1,"entries":{}}'::jsonb where user_id = '${U1}'`);
check('[검증] entries 는 배열이어야 함', !r.ok, r.error);
r = await as('authenticated', U1, `update public.training_goals set data = ${doc('수정됨')} where user_id = '${U1}' returning data->'entries'->0->>'text' as v`);
check('[수정] 본인 목표 갱신', r.ok && r.rows[0].v === '수정됨', r.rows ?? r.error);
r = await as('authenticated', U1, `insert into public.training_goals (user_id, data) values ('${U1}', ${doc('두 번째 행')})`);
check('[구조] 사용자당 한 행 (user_id 기본키)', !r.ok, r.error);

r = await as('authenticated', U1, `select data->>'kept' as v from public.fighter_profiles where user_id = '${U1}'`);
check('[보존] 기존 테이블(0041)은 건드리지 않음', r.ok && r.rows[0]?.v === 'true', r.rows ?? r.error);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
