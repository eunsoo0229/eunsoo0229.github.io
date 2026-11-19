// Migration 0053 in PGlite — an invitee can read a PRIVATE clan while the invite is pending
// (clan name in 알림 / clan page opens), and loses it again once the invite is gone.
// Also checks the 0051 trigger really writes the invitee's clan_invite notification.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-clan-invitee-sql.mjs
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
const OWNER = '11111111-1111-1111-1111-111111111111', INVITEE = '22222222-2222-2222-2222-222222222222', STRANGER = '33333333-3333-3333-3333-333333333333';
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_user::text $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${OWNER}'), ('${INVITEE}'), ('${STRANGER}');
  create publication supabase_realtime;
  -- the bits of Supabase storage the older migrations reference
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
`);
const read = (f) => fs.readFileSync(path.join(APP, 'supabase/migrations', f), 'utf8');
// every migration up to 0053, in order (0052 belongs to another feature and is left out)
const migrations = fs.readdirSync(path.join(APP, 'supabase/migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f <= '0053' + '~' && !f.startsWith('0052')).sort();
const failedMigrations = [];
for (const f of migrations) {
  try {
    await db.exec(read(f));
  } catch (e) {
    failedMigrations.push(`${f}: ${e.message}`);
  }
}
// unrelated older files may need Supabase pieces PGlite lacks; the ones this test relies on must all apply
const needed = ['0045_', '0047_', '0051_', '0053_'];
check('[0] 0045·0047·0051·0053 실행', !failedMigrations.some((m) => needed.some((n) => m.startsWith(n))), failedMigrations);
try {
  await db.exec(read('0053_clan_invitee_can_see_clan.sql'));
  check('[0] 0053 다시 실행해도 안전', true);
} catch (e) {
  check('[0] 0053 다시 실행해도 안전', false, e.message);
}

async function as(uid, q, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query(q, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

// a private, invite-only clan owned by OWNER
const clanCols = (await db.query(`select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='clans'`)).rows;
const vals = { name: '비밀 도장', slug: 'secret-dojang', owner_id: OWNER, is_public: false, join_policy: 'invite' };
const cols = Object.keys(vals).filter((c) => clanCols.some((x) => x.column_name === c));
const [{ id: CLAN }] = (await db.query(`insert into public.clans (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, cols.map((c) => vals[c]))).rows;
const ownerIsMember = (await db.query(`select count(*)::int n from public.clan_members where clan_id = $1 and user_id = $2`, [CLAN, OWNER])).rows[0].n;
if (!ownerIsMember) await db.query(`insert into public.clan_members (clan_id, user_id, role) values ($1, $2, 'owner')`, [CLAN, OWNER]);

check('[1] 초대 전: 초대받을 사람은 비공개 클랜을 못 봄', (await as(INVITEE, `select id from public.clans where id = $1`, [CLAN])).length === 0);
await as(OWNER, `insert into public.clan_invitations (clan_id, invitee_id, inviter_id) values ($1, $2, $3)`, [CLAN, INVITEE, OWNER]);
const notes = await as(INVITEE, `select type, entity_type, entity_id, body from public.notifications`);
check('[1] 초대 → 당사자에게 clan_invite 알림 생성 (0051 트리거)', notes.length === 1 && notes[0].type === 'clan_invite' && notes[0].entity_id === CLAN && notes[0].body === '비밀 도장', notes);
check('[1] 초대 대기 중: 당사자는 클랜 이름을 볼 수 있음', (await as(INVITEE, `select name from public.clans where id = $1`, [CLAN]))[0]?.name === '비밀 도장');
check('[1] 무관한 사용자는 여전히 못 봄', (await as(STRANGER, `select id from public.clans where id = $1`, [CLAN])).length === 0);
check('[1] 비공개 클랜은 탐색 목록에 안 나옴 (당사자 제외)', (await as(STRANGER, `select id from public.clans`)).length === 0);
await as(INVITEE, `select public.accept_clan_invitation($1)`, [CLAN]);
check('[1] 수락 후 멤버로서 계속 보임', (await as(INVITEE, `select id from public.clans where id = $1`, [CLAN])).length === 1);
// second invitee declines → visibility goes away again
await as(OWNER, `insert into public.clan_invitations (clan_id, invitee_id, inviter_id) values ($1, $2, $3)`, [CLAN, STRANGER, OWNER]);
check('[1] 다른 초대 대기자도 볼 수 있음', (await as(STRANGER, `select id from public.clans where id = $1`, [CLAN])).length === 1);
await as(STRANGER, `delete from public.clan_invitations where clan_id = $1 and invitee_id = auth.uid()`, [CLAN]);
check('[1] 거절하면 다시 못 봄', (await as(STRANGER, `select id from public.clans where id = $1`, [CLAN])).length === 0);
let cannotProbe = false;
try {
  await as(STRANGER, `select public.has_clan_invitation($1, $2)`, [CLAN, INVITEE]);
} catch {
  cannotProbe = true;
}
check('[1] 도우미 함수는 anon에 열려 있지 않음', (await db.query(`select has_function_privilege('anon', 'public.has_clan_invitation(uuid, uuid)', 'execute') as x`)).rows[0].x === false, { authenticatedCanCall: !cannotProbe });

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
