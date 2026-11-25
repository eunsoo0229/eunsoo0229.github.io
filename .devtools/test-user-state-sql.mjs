// 마이그레이션 0067 (user_state) — PGlite 로 실제 Postgres + RLS 를 돌려 본다.
// 운영 DB 에는 `supabase db push` 로 한 번에 올라가고 되돌리기 어려우므로, 올리기 전에 여기서 확인한다.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-user-state-sql.mjs
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
const check = (n, p, d = '') => (results.push(!!p), console.log(`${p ? 'PASS' : 'FAIL'} — ${n}${d !== '' ? ` :: ${JSON.stringify(d).slice(0, 220)}` : ''}`));

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
  -- 기존 백업본 표 (0003) — 자동 동기화가 이것을 건드리면 안 된다
  create table public.user_backups (user_id uuid primary key, data jsonb not null, updated_at timestamptz not null default now());
  insert into public.user_backups values ('11111111-1111-1111-1111-111111111111', '{"백업본":"유지"}');
  grant select on public.user_backups to authenticated;
`);
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const sql = fs.readFileSync(path.join(APP, 'supabase/migrations/0067_user_state.sql'), 'utf8');
try {
  await db.exec(sql);
  check('[0] 0067 실행', true);
  await db.exec(sql);
  check('[0] 다시 실행해도 안전 (if not exists · drop policy if exists)', true);
} catch (e) {
  check('[0] 0067 실행', false, e.message);
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
const doc = (v) => `'{"martialdex:training-history":"${v}"}'::jsonb`;

let r = await as('authenticated', U1, `insert into public.user_state (user_id, data, device_id, device_name) values ('${U1}', ${doc('v1')}, 'dev-a', '맥북') returning user_id`);
check('[RLS] 본인 상태 생성', r.ok, r.error);
r = await as('authenticated', U1, `select data->>'martialdex:training-history' as v, device_name from public.user_state`);
check('[RLS] 본인 상태 조회', r.ok && r.rows[0]?.v === 'v1' && r.rows[0]?.device_name === '맥북', r.rows ?? r.error);
r = await as('authenticated', U2, `select * from public.user_state`);
check('[RLS] 다른 사용자 상태는 보이지 않음', r.ok && r.rows.length === 0, r.rows ?? r.error);
r = await as('authenticated', U2, `insert into public.user_state (user_id, data) values ('${U1}', ${doc('위조')})`);
check('[RLS] 다른 사용자 id 로 행을 만들 수 없음', !r.ok, r.error ?? r.rows);
r = await as('authenticated', U2, `update public.user_state set data = ${doc('덮어쓰기')} where user_id = '${U1}'`);
check('[RLS] 남의 상태를 수정할 수 없음', r.ok && r.affected === 0, { affected: r.affected, error: r.error });
r = await as('anon', null, `select * from public.user_state`);
check('[RLS] 비로그인은 접근 불가', !r.ok, r.error ?? r.rows);

r = await as('authenticated', U1, `update public.user_state set data = '[]'::jsonb where user_id = '${U1}'`);
check('[검증] data 는 객체여야 함', !r.ok, r.error);

const t0 = await as('authenticated', U1, `select updated_at from public.user_state where user_id = '${U1}'`);
await new Promise((res) => setTimeout(res, 20));
r = await as('authenticated', U1, `update public.user_state set data = ${doc('v2')} where user_id = '${U1}' returning updated_at`);
check('[갱신] 본인 상태 갱신', r.ok, r.error);
check('[갱신] updated_at 은 서버가 올린다 (기기 시계를 믿지 않음)', r.ok && new Date(r.rows[0].updated_at) > new Date(t0.rows[0].updated_at), { before: t0.rows?.[0]?.updated_at, after: r.rows?.[0]?.updated_at });

r = await as('authenticated', U1, `insert into public.user_state (user_id, data) values ('${U1}', ${doc('두 번째 행')})`);
check('[구조] 사용자당 한 행', !r.ok, r.error);

r = await as('authenticated', U1, `select data->>'백업본' as v from public.user_backups where user_id = '${U1}'`);
check('[보존] 기존 백업본 표(0003)는 그대로', r.ok && r.rows[0]?.v === '유지', r.rows ?? r.error);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
