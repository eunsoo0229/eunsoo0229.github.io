// 수익화 마이그레이션 0061–0064 를 PGlite(실제 Postgres + RLS)에서 검증한다. 운영 DB 무관.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-monetization-sql.mjs
// 사용자는 마이그레이션 전에 만든다 → 0061 의 운영자·개발자 계정 지정(seed)까지 확인.
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
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const section = (t) => console.log(`\n## ${t}`);

export const U = {
  op: '11111111-0000-0000-0000-000000000001', // martialdex@martialdex.local
  dev: '11111111-0000-0000-0000-000000000002', // joeunsu232@gmail.com
  buyer: '11111111-0000-0000-0000-000000000003',
  creator: '11111111-0000-0000-0000-000000000004',
  other: '11111111-0000-0000-0000-000000000005',
  owner: '11111111-0000-0000-0000-000000000006', // gym owner
  instr: '11111111-0000-0000-0000-000000000007',
  seller: '11111111-0000-0000-0000-000000000008',
  imposter: '11111111-0000-0000-0000-000000000009',
};
await db.exec(`
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
const emails = { op: 'martialdex@martialdex.local', dev: 'joeunsu232@gmail.com', imposter: 'joeunsu232@gmail.com.evil.test' };
for (const [k, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, emails[k] ?? `${k}@test.local`]);

const failed = [];
for (const f of fs.readdirSync(path.join(APP, 'supabase/migrations')).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(APP, 'supabase/migrations', f), 'utf8'));
  } catch (e) {
    failed.push(`${f}: ${e.message}`);
  }
}
await db.exec(`grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;`);
for (const [k, id] of Object.entries(U)) await db.query('insert into public.profiles (user_id, nickname) values ($1, $2) on conflict do nothing', [id, k]);

section('0. 마이그레이션');
const mine = failed.filter((m) => /^006[1-9]_/.test(m));
check('0061–0069 전부 적용', mine.length === 0, mine);

// helpers
async function as(uid, q, params = []) {
  const role = uid === 'service' ? 'service_role' : uid ? 'authenticated' : 'anon';
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid && uid !== 'service' ? uid : ''}', false); select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try {
    return (await db.query(q, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.role', '', false); select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function fails(uid, q, params = [], re) {
  try {
    await as(uid, q, params);
    return 'NO_ERROR';
  } catch (e) {
    return re ? (re.test(e.message) ? true : e.message) : true;
  }
}
const one = async (q, params = []) => (await db.query(q, params)).rows[0];
const bal = async (uid) => Number((await one('select balance from public.wallets where user_id = $1', [uid]))?.balance ?? 0);
const sumLedger = async (uid) => Number((await one('select coalesce(sum(amount),0) s from public.wallet_ledger where user_id = $1', [uid])).s);

// ================= 0061 =================
section('1. 운영자·개발자 계정');
const priv = (await db.query('select user_id::text, label from public.privileged_accounts order by label')).rows;
check('martialdex·joeunsu232 두 계정이 특권 계정으로 지정', priv.length === 2 && priv.some((r) => r.user_id === U.op && r.label === 'operator') && priv.some((r) => r.user_id === U.dev && r.label === 'developer'), priv);
check('비슷한 이메일(사칭)은 지정 안 됨', !priv.some((r) => r.user_id === U.imposter));
check('두 계정 모두 플랫폼 관리자', (await one('select count(*)::int n from public.platform_admins where user_id = any($1)', [[U.op, U.dev]])).n === 2);
check('특권 계정: 모든 유료 기능 권한', (await as(U.dev, `select public.has_entitlement($1, 'coach_advanced') a, public.has_entitlement($1, 'gym_business_reports') b, public.has_entitlement($1, 'pro_content') c`, [U.dev]))[0].a === true);
const mm = (await as(U.dev, 'select public.my_membership() m'))[0].m;
check('my_membership: privileged + 관리자 + 전체 기능', mm.privileged === true && mm.is_admin === true && mm.features.includes('gym_business_reports') && mm.features.includes('coach_advanced'), mm);
check('사용자는 특권 계정 표를 직접 못 씀', (await fails(U.buyer, `insert into public.privileged_accounts (user_id) values ($1)`, [U.buyer])) === true);

section('2. 요금제·권한');
check('요금제 3종 (FREE/PRO/GYM), 가격은 DB 설정', (await db.query(`select id from public.membership_plans order by sort`)).rows.map((r) => r.id).join() === 'free,pro,gym');
check('무료 사용자: 무료 기능 O', (await as(U.buyer, `select public.has_entitlement($1, 'encyclopedia') x`, [U.buyer]))[0].x === true);
check('무료 사용자: PRO 기능 X', (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === false);
check('사용자는 요금제 가격을 못 바꿈', (await fails(U.buyer, `update public.membership_plans set price_monthly_krw = 1 where id = 'pro'`)) === true || (await one(`select price_monthly_krw p from public.membership_plans where id='pro'`)).p === 9900);
check('관리자 아닌 사용자: 요금제 RPC 거부', (await fails(U.buyer, `select public.admin_upsert_plan('{"id":"pro","price_monthly_krw":1}'::jsonb)`, [], /FORBIDDEN/)) === true);
check('실결제·현금지급은 관리자도 못 켬 (정책 잠금)', (await fails(U.op, `select public.admin_update_monetization_config('{"cash_payout_enabled":true}'::jsonb)`, [], /LOCKED_BY_POLICY/)) === true
  && (await fails(null, `update public.monetization_config set live_payments_enabled = true`)) === true);
check('DB 제약으로도 잠금 (service_role 직접 UPDATE 도 실패)', (await fails('service', `update public.monetization_config set cash_payout_enabled = true`, [], /monetization_cash_payout_locked/)) === true);

section('3. 구독: 주문 → 결제 확정 → 권한');
const [so] = await as(U.buyer, `select * from public.create_subscription_order('pro', 'monthly')`);
check('구독 주문: 서버가 금액 계산 (PRO 월 9,900원, pending)', so.amount_krw === 9900 && so.status === 'pending' && so.kind === 'new', so);
check('같은 주문 반복 생성 시 pending 재사용', (await as(U.buyer, `select id from public.create_subscription_order('pro', 'monthly')`))[0].id === so.id);
check('사용자가 직접 paid 처리 불가', (await fails(U.buyer, `select public.finalize_subscription_payment($1, 'paid', 'pk_x')`, [so.id], /FORBIDDEN_DIRECT_PAID_TRANSITION/)) === true);
check('결제 전에는 PRO 기능 없음', (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === false);
await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_sub_1')`, [so.id]);
check('결제 확정 후 PRO 기능 권한', (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === true);
const sub1 = await one(`select * from public.user_subscriptions where user_id = $1 and status = 'active'`, [U.buyer]);
check('구독 기간 1개월', sub1 && Math.round((new Date(sub1.current_period_end) - new Date(sub1.current_period_start)) / 86400000) >= 28);
await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_sub_1')`, [so.id]);
check('같은 결제 확정 재시도(웹훅 중복) → 구독 1개 유지', (await one(`select count(*)::int n from public.user_subscriptions where user_id = $1`, [U.buyer])).n === 1);
check('다른 payment_key 로 재확정 → 거부', (await fails('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_other')`, [so.id], /ORDER_ALREADY_PAID/)) === true);
check('다른 사용자는 내 구독을 못 봄', (await as(U.other, `select count(*)::int n from public.user_subscriptions where user_id = $1`, [U.buyer]))[0].n === 0);
// 갱신
const [ren] = await as(U.buyer, `select * from public.create_subscription_order('pro', 'monthly')`);
check('같은 요금제 재결제 = 갱신 주문', ren.kind === 'renewal' && ren.id !== so.id, ren);
await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_sub_2')`, [ren.id]);
const sub2 = await one(`select * from public.user_subscriptions where id = $1`, [sub1.id]);
check('갱신 → 같은 구독의 기간이 뒤로 연장', new Date(sub2.current_period_end) > new Date(sub1.current_period_end) && (await one(`select count(*)::int n from public.user_subscriptions where user_id = $1`, [U.buyer])).n === 1);
// 취소 예약 / 해제
await as(U.buyer, `select * from public.set_subscription_cancel($1, true)`, [sub1.id]);
check('취소 예약: 기간 끝까지 권한 유지', (await one(`select cancel_at_period_end c from public.user_subscriptions where id=$1`, [sub1.id])).c === true && (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === true);
check('남의 구독은 취소 불가', (await fails(U.other, `select * from public.set_subscription_cancel($1, true)`, [sub1.id], /NOT_YOUR_SUBSCRIPTION/)) === true);
// 만료: 기간을 과거로 돌려서 확인
await db.query(`update public.user_subscriptions set current_period_end = now() - interval '1 day' where id = $1`, [sub1.id]);
check('취소 예약한 구독은 기간 종료 즉시 권한 없음 (유예 없음)', (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === false);
await as(U.buyer, `select * from public.set_subscription_cancel($1, false)`, [sub1.id]);
check('취소 안 한 구독(결제 실패 대비)은 기간 종료 후 3일 유예', (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === true);
await db.query(`update public.user_subscriptions set current_period_end = now() - interval '4 days' where id = $1`, [sub1.id]);
check('유예기간(3일) 지나면 권한 없음', (await as(U.buyer, `select public.has_entitlement($1, 'coach_advanced') x`, [U.buyer]))[0].x === false);
check('만료 처리 함수: 관리자 아닌 사용자 거부', (await fails(U.buyer, `select public.expire_due_subscriptions()`, [], /FORBIDDEN/)) === true);
await as(U.op, `select public.expire_due_subscriptions()`);
check('만료 처리 → status=expired', (await one(`select status from public.user_subscriptions where id=$1`, [sub1.id])).status === 'expired');
// 결제 실패
const [f1] = await as(U.other, `select * from public.create_subscription_order('pro', 'yearly')`);
check('연간 주문 금액 99,000원', f1.amount_krw === 99000);
await as(U.other, `select public.finalize_subscription_payment($1, 'failed', null, '카드 한도 초과')`, [f1.id]);
check('결제 실패 → 주문 failed, 구독 없음', (await one(`select status from public.subscription_payments where id=$1`, [f1.id])).status === 'failed' && (await one(`select count(*)::int n from public.user_subscriptions where user_id=$1`, [U.other])).n === 0);
check('남의 주문 실패 처리 불가', (await fails(U.buyer, `select public.finalize_subscription_payment($1, 'cancelled')`, [f1.id], /NOT_YOUR_ORDER|ORDER_NOT_PENDING/)) === true);
// 요금제 변경 (월→연)
const [n2] = await as(U.other, `select * from public.create_subscription_order('pro', 'monthly')`);
await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_sub_3')`, [n2.id]);
const [chg] = await as(U.other, `select * from public.create_subscription_order('pro', 'yearly')`);
check('월간 → 연간은 변경 주문', chg.kind === 'change');
await as('service', `select public.finalize_subscription_payment($1, 'paid', 'pk_sub_4')`, [chg.id]);
const subsOther = (await db.query(`select status, cycle, ended_reason from public.user_subscriptions where user_id=$1 order by created_at`, [U.other])).rows;
check('변경 → 이전 구독 replaced, 새 연간 구독 active 1개', subsOther.length === 2 && subsOther[0].ended_reason === 'replaced' && subsOther[1].cycle === 'yearly' && subsOther[1].status === 'active', subsOther);
// 환불
await as('service', `select public.finalize_subscription_payment($1, 'refunded', null, '테스트 환불')`, [chg.id]);
check('구독 결제 환불 → 구독 즉시 종료, 권한 없음', (await as(U.other, `select public.has_entitlement($1, 'coach_advanced') x`, [U.other]))[0].x === false);
check('환불은 사용자가 직접 못 함', (await fails(U.other, `select public.finalize_subscription_payment($1, 'refunded')`, [n2.id], /FORBIDDEN/)) === true);

// ================= 0062 =================
section('4. 지갑·원장');
check('남의 지갑/원장 조회 불가 + 직접 쓰기 불가', (await fails(U.buyer, `update public.wallets set balance = 999999 where user_id = $1`, [U.buyer])) === true
  && (await fails(U.buyer, `insert into public.wallet_ledger (user_id, entry_type, amount, balance_before, balance_after, idempotency_key) values ($1, 'test', 100, 0, 100, 'hack1')`, [U.buyer])) === true
  && (await fails(U.buyer, `select public.post_ledger($1, 'test', 100, null, null, 'hack2')`, [U.buyer])) === true);
const [co] = await as(U.buyer, `select * from public.create_coin_order('standard')`);
check('코인 주문: 서버 가격 (Standard 5,000원 → 5,000+500)', co.amount_krw === 5000 && co.coins === 5000 && co.bonus_coins === 500);
check('사용자가 코인 주문 paid 처리 불가', (await fails(U.buyer, `select public.finalize_coin_order($1, 'paid', 'pk')`, [co.id], /FORBIDDEN_DIRECT_PAID_TRANSITION/)) === true);
await as('service', `select public.finalize_coin_order($1, 'paid', 'pk_coin_1')`, [co.id]);
await as('service', `select public.finalize_coin_order($1, 'paid', 'pk_coin_1')`, [co.id]);
check('결제 확정(웹훅 2회) → 5,500 코인 1회만 지급', (await bal(U.buyer)) === 5500 && (await sumLedger(U.buyer)) === 5500, await bal(U.buyer));
const r1 = (await as(U.buyer, `select (public.claim_daily_checkin()).amount a`))[0];
const r2 = (await as(U.buyer, `select (public.claim_daily_checkin()).amount a`))[0];
check('출석 보상: 하루에 1회만 (두 번째 호출은 같은 거래 반환)', r1.a == 10 && r2.a == 10 && (await bal(U.buyer)) === 5510);
check('원장은 수정·삭제 불가 (관리자·service 포함)', (await fails('service', `update public.wallet_ledger set amount = 1`, [], /LEDGER_IMMUTABLE/)) === true && (await fails('service', `delete from public.wallet_ledger`, [], /LEDGER_IMMUTABLE/)) === true);
check('같은 멱등 키를 다른 금액으로 재사용 → 거부', (await fails('service', `select public.post_ledger($1, 'activity_reward', 999, 'daily_checkin', 'x', (select idempotency_key from public.wallet_ledger where user_id=$1 and entry_type='activity_reward' limit 1))`, [U.buyer], /IDEMPOTENCY_KEY_REUSED/)) === true);
check('잔액 부족 차감 거부', (await fails('service', `select public.post_ledger($1, 'content_purchase', -999999, 'x', 'y', 'big-spend-1')`, [U.buyer], /INSUFFICIENT_COINS/)) === true);
// 연속 거래 (단일 연결이라 진짜 병렬은 아님 — 잠금 + 원장 연쇄로 순서 보장 확인)
for (let i = 0; i < 20; i++) await as('service', `select public.post_ledger($1, $2, $3, 'stress', $4, $5)`, [U.buyer, i % 2 ? 'content_purchase' : 'event_reward', i % 2 ? -7 : 11, String(i), `stress-${i}`]);
check('연속 거래 20건 후 잔액 = 원장 합계', (await bal(U.buyer)) === (await sumLedger(U.buyer)), [await bal(U.buyer), await sumLedger(U.buyer)]);
const integrity0 = await as(U.op, `select * from public.wallet_integrity_report()`);
check('무결성 점검: 정상 상태에서 문제 0건', integrity0.length === 0, integrity0);
check('무결성 점검: 일반 사용자 거부', (await fails(U.buyer, `select * from public.wallet_integrity_report()`, [], /FORBIDDEN/)) === true);
// 이상 탐지: 원장 없이 잔액 조작(슈퍼유저가 직접) → 탐지
await db.query(`update public.wallets set balance = balance + 777 where user_id = $1`, [U.other]).catch(() => {});
await db.query(`insert into public.wallets (user_id, balance) values ($1, 777) on conflict (user_id) do update set balance = public.wallets.balance + 777`, [U.seller]);
const integrity1 = await as(U.op, `select * from public.wallet_integrity_report()`);
check('무결성 점검: 원장 없는 잔액 변경 탐지', integrity1.some((r) => r.check_name === 'balance_mismatch' && r.user_id === U.seller), integrity1);
await db.query(`update public.wallets set balance = 0 where user_id = $1`, [U.seller]);
// 관리자 지급·보정
check('이벤트 지급: 관리자만', (await fails(U.buyer, `select public.admin_grant_coins($1, 100, 'event_reward', 'launch', 'a')`, [U.other], /FORBIDDEN/)) === true);
await as(U.op, `select public.admin_grant_coins($1, 300, 'event_reward', 'launch-event', 'k1')`, [U.other]);
await as(U.op, `select public.admin_grant_coins($1, 300, 'event_reward', 'launch-event', 'k1')`, [U.other]);
check('같은 캠페인·키 중복 지급 방지', (await bal(U.other)) === 300);
await as(U.op, `select public.admin_adjust_wallet($1, -50, '오지급 보정')`, [U.other]);
check('관리자 보정 = 새 보정 거래 (원장 수정 아님)', (await bal(U.other)) === 250 && (await one(`select count(*)::int n from public.wallet_ledger where user_id=$1 and entry_type='admin_adjustment'`, [U.other])).n === 1);
check('보정 사유 없으면 거부', (await fails(U.op, `select public.admin_adjust_wallet($1, 10, '')`, [U.other], /REASON_REQUIRED/)) === true);
// 코인 환불
check('사용하지 않은 코인 주문은 환불 가능', (await as(U.buyer, `select public.coin_order_refundable($1) r`, [co.id]))[0].r === true);
check('남의 코인 주문 환불 가능 여부 조회 → false', (await as(U.other, `select public.coin_order_refundable($1) r`, [co.id]))[0].r === false);
const before = await bal(U.buyer);
await as('service', `select public.finalize_coin_order($1, 'refunded', null, '테스트 환불')`, [co.id]);
check('코인 환불 → 지급분 회수(clawback), 원장 기록', (await bal(U.buyer)) === before - 5500 && (await one(`select count(*)::int n from public.wallet_ledger where user_id=$1 and entry_type='clawback'`, [U.buyer])).n === 1);
// 쓴 코인 환불 → 부족분 기록
const [co2] = await as(U.seller, `select * from public.create_coin_order('starter')`);
await as('service', `select public.finalize_coin_order($1, 'paid', 'pk_coin_2')`, [co2.id]);
await as('service', `select public.post_ledger($1, 'content_purchase', -600, 'x', 'spent', 'spend-seller-1')`, [U.seller]);
check('코인을 쓴 주문은 환불 불가로 판정', (await as(U.seller, `select public.coin_order_refundable($1) r`, [co2.id]))[0].r === false);
await as('service', `select public.finalize_coin_order($1, 'refunded', null, '강제 환불')`, [co2.id]);
const rep = await as(U.op, `select * from public.wallet_integrity_report() where check_name = 'refund_shortfall'`);
check('강제 환불 시 잔액 0까지 회수 + 부족분 600 탐지', (await bal(U.seller)) === 0 && rep.some((r) => r.ref === co2.id && /600/.test(r.detail)), rep);
// 회원 탈퇴 cascade 는 허용
await db.query(`insert into auth.users (id, email) values ('11111111-0000-0000-0000-0000000000ff', 'leaver@test.local')`);
await as('service', `select public.post_ledger('11111111-0000-0000-0000-0000000000ff', 'event_reward', 5, 'x', 'y', 'leaver-1')`);
let leaverOk = true;
try {
  await db.query(`delete from auth.users where id = '11111111-0000-0000-0000-0000000000ff'`);
} catch (e) {
  leaverOk = e.message;
}
check('회원 탈퇴 시에는 원장 cascade 삭제 허용', leaverOk === true, leaverOk);

export { db, as, fails, one, bal, sumLedger, check, section, results };
if (process.env.MONETIZATION_SQL_PART !== 'base') {
  const more = path.join(APP, '.devtools/test-monetization-sql-market.mjs');
  if (fs.existsSync(more)) await (await import(pathToFileURL(more).href)).run({ db, as, fails, one, bal, sumLedger, check, section, U });
}
const failedN = results.filter((p) => !p).length;
console.log(`\n${results.length - failedN}/${results.length} passed`);
process.exit(failedN ? 1 : 0);
