// 실제 Postgres 17(다중 연결)에서 수익화 원장·구매의 동시성 검증. PGlite 는 단일 연결이라 진짜 동시 트랜잭션을 못 만든다.
//   EMBEDDED_PG_DIR=/path/to/node_modules (embedded-postgres + @embedded-postgres/darwin-x64 + pg) node .devtools/test-ledger-concurrency.mjs
// 임시 데이터 디렉터리에 새 클러스터를 만들고 끝나면 지운다. 운영 DB 무관.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MOD = process.env.EMBEDDED_PG_DIR;
if (!MOD) {
  console.log('NOT TESTED — set EMBEDDED_PG_DIR');
  process.exit(2);
}
const req = createRequire(path.join(MOD, 'x.js'));
const EmbeddedPostgres = (await import(req.resolve('embedded-postgres'))).default;
const pg = req('pg');
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const section = (t) => console.log(`\n## ${t}`);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-pg-'));
const PORT = 54395;
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'local', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
await server.initialise();
await server.start();
const admin = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'local', database: 'postgres' });
await admin.connect();
const U = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;
try {
  await admin.query(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz default now(), created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
    grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role; grant execute on function auth.role() to anon, authenticated, service_role;
    create publication supabase_realtime;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  `);
  for (let i = 1; i <= 40; i++) await admin.query('insert into auth.users (id, email) values ($1, $2)', [U(i), `u${i}@test.local`]);
  const failed = [];
  for (const f of fs.readdirSync(path.join(APP, 'supabase/migrations')).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    try {
      await admin.query(fs.readFileSync(path.join(APP, 'supabase/migrations', f), 'utf8'));
    } catch (e) {
      failed.push(`${f}: ${e.message}`);
    }
  }
  await admin.query(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role;`);
  for (let i = 1; i <= 40; i++) await admin.query('insert into public.profiles (user_id, nickname) values ($1, $2) on conflict do nothing', [U(i), `u${i}`]);
  section('0. 실제 Postgres 17 에 전체 마이그레이션');
  check('0061–0065 적용', !failed.some((m) => /^006[1-9]_/.test(m)), failed.filter((m) => /^006/.test(m)));

  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'local', database: 'postgres', max: 25 });
  // one transaction per call, as a given role — like PostgREST does per request
  async function call(as, sql, params = []) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const role = as === 'service' ? 'service_role' : 'authenticated';
      await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [as === 'service' ? '' : as, role]);
      await c.query(`set local role ${role}`);
      const r = await c.query(sql, params);
      await c.query('commit');
      return { ok: true, rows: r.rows };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      c.release();
    }
  }
  const all = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  const bal = async (u) => Number((await admin.query(`select coalesce((select balance from public.wallets where user_id = $1), 0) b`, [u])).rows[0].b);
  const integrity = async () => (await call('service', `select * from public.wallet_integrity_report()`)).rows;

  section('1. 같은 지갑에 동시 거래 300건');
  const A = U(1);
  await call('service', `select public.post_ledger($1, 'event_reward', 10000, 'seed', 'a', 'seed-A')`, [A]);
  const ops = await all(300, (i) => call('service', `select public.post_ledger($1, $2, $3, 'stress', $4, $5)`, [A, i % 3 ? 'event_reward' : 'content_purchase', i % 3 ? 7 : -13, String(i), `stress-A-${i}`]));
  const okN = ops.filter((r) => r.ok).length;
  const expected = 10000 + 200 * 7 - 100 * 13;
  check('300건 모두 성공 (교착·직렬화 오류 없음)', okN === 300, ops.filter((r) => !r.ok).slice(0, 2));
  check(`최종 잔액 = 기대값 ${expected} = 원장 합계`, (await bal(A)) === expected && Number((await admin.query(`select sum(amount) s from public.wallet_ledger where user_id = $1`, [A])).rows[0].s) === expected);
  check('원장 연쇄 끊김 없음 (모든 before = 직전 after)', (await integrity()).filter((r) => r.check_name === 'chain_break').length === 0);

  section('2. 같은 멱등 키 동시 30회 (웹훅·재시도 폭주)');
  const B = U(2);
  const same = await all(30, () => call('service', `select (public.post_ledger($1, 'event_reward', 500, 'campaign', 'x', 'dup-key-B')).id`, [B]));
  check('지급은 정확히 1회 (잔액 500, 원장 1행)', (await bal(B)) === 500 && Number((await admin.query(`select count(*) n from public.wallet_ledger where idempotency_key = 'dup-key-B'`)).rows[0].n) === 1);
  const errs = [...new Set(same.filter((r) => !r.ok).map((r) => r.error.replace(/".*"/, '"…"')))];
  console.log(`   (성공 응답 ${same.filter((r) => r.ok).length}/30${errs.length ? ', 오류: ' + errs.join(' | ') : ''})`);
  check('동시 요청 30개 모두 같은 거래를 돌려받음 (오류 없음)', same.every((r) => r.ok) && new Set(same.map((r) => r.rows[0].id)).size === 1, same.filter((r) => !r.ok).slice(0, 2));

  section('3. 잔액보다 많은 동시 지출');
  const C = U(3);
  await call('service', `select public.post_ledger($1, 'event_reward', 1000, 'seed', 'c', 'seed-C')`, [C]);
  const spends = await all(40, (i) => call('service', `select public.post_ledger($1, 'content_purchase', -100, 'spend', $2, $3)`, [C, String(i), `spend-C-${i}`]));
  check('정확히 10건 성공, 30건 잔액 부족, 잔액 0 (음수 없음)', spends.filter((r) => r.ok).length === 10 && spends.filter((r) => !r.ok && /INSUFFICIENT_COINS/.test(r.error)).length === 30 && (await bal(C)) === 0);

  section('4. 코인 결제 확정 동시 50회 (같은 주문·같은 결제 키)');
  const D = U(4);
  const order = (await call(D, `select * from public.create_coin_order('premium')`)).rows[0];
  const fin = await all(50, () => call('service', `select status from public.finalize_coin_order($1, 'paid', 'pk_conc_1')`, [order.id]));
  check('모두 paid 응답 + 코인 12,000 1회 지급', fin.every((r) => r.ok && r.rows[0].status === 'paid') && (await bal(D)) === 12000, fin.filter((r) => !r.ok).slice(0, 2));
  const fin2 = await call('service', `select status from public.finalize_coin_order($1, 'paid', 'pk_other_key')`, [order.id]);
  check('다른 결제 키로 재확정 → 거부', !fin2.ok && /ORDER_ALREADY_PAID/.test(fin2.error));

  section('5. 콘텐츠 동시 구매');
  const CR = U(5);
  await admin.query(`insert into public.creator_profiles (user_id, display_name, status) values ($1, '코치', 'approved')`, [CR]);
  const prod = (await admin.query(`insert into public.creator_products (creator_id, product_type, title, price_coins, rights_confirmed, status, approved_version) values ($1, 'course', '동시성 코스', 300, true, 'approved', 1) returning id`, [CR])).rows[0].id;
  const E = U(6);
  await call('service', `select public.post_ledger($1, 'event_reward', 1000, 'seed', 'e', 'seed-E')`, [E]);
  const dupBuy = await all(20, () => call(E, `select id from public.purchase_product($1)`, [prod]));
  const ids = new Set(dupBuy.filter((r) => r.ok).map((r) => r.rows[0].id));
  check('같은 구매자 동시 20회 → 구매 1건, 차감 1회 (700 남음)', ids.size === 1 && (await bal(E)) === 700 && Number((await admin.query(`select count(*) n from public.content_purchases where buyer_id = $1`, [E])).rows[0].n) === 1, dupBuy.filter((r) => !r.ok).slice(0, 2));
  const buyers = Array.from({ length: 20 }, (_, i) => U(10 + i));
  for (const b of buyers) await call('service', `select public.post_ledger($1, 'event_reward', 300, 'seed', 'b', $2)`, [b, `seed-${b}`]);
  const many = await all(20, (i) => call(buyers[i], `select platform_fee_coins f, creator_earning_coins e from public.purchase_product($1)`, [prod]));
  check('다른 구매자 20명 동시 구매 → 전부 성공', many.every((r) => r.ok), many.filter((r) => !r.ok).slice(0, 2));
  const agg = (await admin.query(`select count(*)::int n, sum(platform_fee_coins)::int f, sum(creator_earning_coins)::int e, (select sales_count from public.creator_products where id = $1) sc from public.content_purchases where product_id = $1 and status = 'completed'`, [prod])).rows[0];
  check('판매 21건: 수수료 45×21=945, 창작자 255×21=5,355, 판매 수 21', agg.n === 21 && agg.f === 945 && agg.e === 5355 && agg.sc === 21, agg);
  check('창작자 수익 행 21개 (구매당 1개)', Number((await admin.query(`select count(*) n from public.creator_earnings where creator_id = $1`, [CR])).rows[0].n) === 21);

  section('6. 구독 동시 결제 (같은 사용자 두 요금제)');
  const F = U(7);
  const o1 = (await call(F, `select * from public.create_subscription_order('pro', 'monthly')`)).rows[0];
  const o2 = (await call(F, `select * from public.create_subscription_order('pro', 'yearly')`)).rows[0];
  await all(10, (i) => call('service', `select status from public.finalize_subscription_payment($1, 'paid', $2)`, [i % 2 ? o1.id : o2.id, i % 2 ? 'pk_s1' : 'pk_s2']));
  const live = Number((await admin.query(`select count(*) n from public.user_subscriptions where user_id = $1 and status in ('active', 'past_due')`, [F])).rows[0].n);
  check('동시 결제에도 유효 개인 구독은 1개', live === 1, live);

  section('6b. Gemini 사용 한도 동시 요청 (0066)');
  const Q = U(8);
  const burst = await all(20, (i) => call(Q, `select (public.consume_gemini_use($1))->>'allowed' a`, [`conc-action-${String(i).padStart(3, '0')}`]));
  const allowedN = burst.filter((r) => r.ok && r.rows[0].a === 'true').length;
  check('무료 사용자의 서로 다른 작업 20개 동시 → 정확히 5개만 허용', allowedN === 5 && Number((await admin.query(`select count(*) n from public.gemini_usage where user_id = $1`, [Q])).rows[0].n) === 5, { allowedN, errors: burst.filter((r) => !r.ok).slice(0, 2) });
  const sameUse = await all(15, () => call(Q, `select (public.consume_gemini_use('conc-action-000'))->>'allowed' a`));
  check('이미 허용된 작업 id 의 동시 후속 호출 → 차감 없이 처리 (오류 없음)', sameUse.every((r) => r.ok) && Number((await admin.query(`select count(*) n from public.gemini_usage where user_id = $1`, [Q])).rows[0].n) === 5, sameUse.filter((r) => !r.ok).slice(0, 2));

  section('7. 최종 원장 정합성');
  const rep = await integrity();
  check('잔액=원장 합계 · 연쇄 · 중복 참조 · 결제-지급 불일치 0건', rep.length === 0, rep.slice(0, 3));
  await pool.end();
} catch (e) {
  check('실행 중 예외 없음', false, e.stack?.slice(0, 400));
} finally {
  await admin.end().catch(() => {});
  await server.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
const failedN = results.filter((p) => !p).length;
console.log(`\n${results.length - failedN}/${results.length} passed`);
process.exit(failedN ? 1 : 0);
