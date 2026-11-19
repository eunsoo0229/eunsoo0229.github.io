// Migration 0040 (사용자 콤보·셋업 연결) on top of 0037 — runs the REAL SQL files in
// PGlite (Postgres compiled to WASM) with a minimal stand-in for Supabase's
// auth schema (auth.users, auth.uid() from a session setting, anon /
// authenticated roles), then checks the link table's RLS, constraints and
// cascade as two different users and as a signed-out visitor.
//
// PGlite is not a project dependency: install it anywhere and point PGLITE_DIR
// at that folder's node_modules, e.g.
//   (cd /tmp/pg && npm i @electric-sql/pglite@0.2)
//   PGLITE_DIR=/tmp/pg/node_modules node .devtools/test-combo-links-sql.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.env.PGLITE_DIR;
if (!dir) {
  console.log('NOT TESTED — set PGLITE_DIR to a node_modules folder containing @electric-sql/pglite');
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(path.join(dir, '@electric-sql/pglite/dist/index.js')).href);
const db = new PGlite();

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (detail !== '' ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''));
}


// ---- Supabase stand-ins (same as test-shared-combos-sql.mjs)
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
`);
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

for (const f of ['0037_shared_combos.sql', '0040_shared_combo_links.sql']) {
  try {
    await db.exec(fs.readFileSync(path.join(APP, 'supabase/migrations', f), 'utf8'));
  } catch (e) {
    check(`[0] ${f} 실행`, false, e.message);
    process.exit(1);
  }
}
check('[0] 0037 + 0040 마이그레이션 실행', true);
try {
  await db.exec(fs.readFileSync(path.join(APP, 'supabase/migrations/0040_shared_combo_links.sql'), 'utf8'));
  check('[0b] 0040을 다시 실행해도 안전', true);
} catch (e) {
  check('[0b] 0040을 다시 실행해도 안전', false, e.message);
}

async function as(role, uid, query) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try {
    const r = await db.query(query);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await db.exec('reset role;');
  }
}
const steps = JSON.stringify([{ techniqueId: 'boxing__jab', name: 'Jab', martialArt: 'boxing' }]);
for (const [id, who] of [['a', U1], ['b', U2], ['c', U2]]) {
  await as('authenticated', who, `insert into public.shared_combos (id, author_id, author_nickname, kind, name, purpose, steps) values ('${id}', '${who}', 'n', 'combo', '${id}', 'p', '${steps}'::jsonb)`);
}
const link = (id, author, from, to, rel = 'follow_up') => `insert into public.shared_combo_links (id, author_id, author_nickname, from_id, to_id, relation, note) values ('${id}', '${author}', 'n', '${from}', '${to}', '${rel}', '') returning author_id`;

let r = await as('authenticated', U1, link('l1', U1, 'a', 'b'));
check('[1] 로그인 사용자: 내 콤보 → 남의 콤보 연결 가능', r.ok, r.error);
r = await as('authenticated', U1, link('l2', U2, 'b', 'c'));
check('[2] 남의 이름으로 연결을 넣어도 작성자는 나로 저장됨 (트리거)', r.ok && r.rows[0]?.author_id === U1, r.rows ?? r.error);
r = await as('anon', null, link('l3', U1, 'a', 'c'));
check('[3] 로그아웃 상태에서는 연결 불가', !r.ok, r.error);
r = await as('authenticated', U1, link('l4', U1, 'a', 'b'));
check('[4] 같은 사람이 같은 A→B·관계를 두 번 만들 수 없음', !r.ok && /duplicate|unique/i.test(r.error), r.error);
r = await as('authenticated', U1, link('l5', U1, 'a', 'b', 'if_blocked'));
check('[5] 같은 A→B라도 관계가 다르면 가능', r.ok, r.error);
r = await as('authenticated', U2, link('l6', U2, 'a', 'b'));
check('[6] 다른 사람은 같은 연결을 만들 수 있음 (지지 수)', r.ok, r.error);
r = await as('authenticated', U1, link('l7', U1, 'a', 'a'));
check('[7] 자기 자신과 연결 불가', !r.ok && /check/i.test(r.error), r.error);
r = await as('authenticated', U1, link('l8', U1, 'a', 'zz'));
check('[8] 없는 콤보와 연결 불가 (FK)', !r.ok && /foreign key/i.test(r.error), r.error);
r = await as('authenticated', U1, link('l9', U1, 'a', 'c', 'hack'));
check('[9] 정해진 관계(follow_up/opens/if_blocked) 외에는 불가', !r.ok, r.error);
r = await as('anon', null, `select id from public.shared_combo_links order by id`);
check('[10] 로그아웃 상태에서도 연결 목록 보기 가능 (공개)', r.ok && r.rows.length === 4, r.rows ?? r.error);
r = await as('authenticated', U2, `delete from public.shared_combo_links where id = 'l1' returning id`);
check('[11] 남의 연결은 삭제 불가', r.ok && r.rows.length === 0, r);
r = await as('authenticated', U1, `update public.shared_combo_links set note = 'x' where id = 'l1' returning id`);
check('[12] 연결은 수정 불가 (삭제 후 다시 만들기)', !r.ok || r.rows.length === 0, r);
r = await as('authenticated', U1, `delete from public.shared_combo_links where id = 'l5' returning id`);
check('[13] 내 연결은 삭제 가능', r.ok && r.rows.length === 1, r);
await as('authenticated', U2, `delete from public.shared_combos where id = 'b'`);
r = await as('anon', null, `select id from public.shared_combo_links`);
check('[14] 연결된 콤보가 공유 취소되면 연결도 함께 삭제 (cascade)', r.ok && r.rows.length === 0, r.rows);

const passed = results.filter((x) => x.pass).length;
console.log(`=== SUMMARY: ${passed}/${results.length} PASSED ===`);
process.exit(passed === results.length ? 0 : 1);
