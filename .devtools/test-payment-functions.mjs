// 배포된 Edge Function 코드(payment-verify · payment-webhook) 를 그대로 Node 에서 실행해 검증한다.
//  - Deno.serve / Deno.env 만 얇게 흉내 내고, Supabase 는 로컬 테스트 백엔드(PGlite + 실제 RLS),
//    Toss API(api.tosspayments.com)는 가짜 응답으로 바꾼다. 운영·실제 Toss 호출 없음, 돈 이동 없음.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-payment-functions.mjs
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeJwt, makeServiceJwt, startPgliteSupabase } from './lib/pglite-supabase.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
if (!process.env.PGLITE_DIR) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const section = (t) => console.log(`\n## ${t}`);

const U = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const users = [
  { id: U(1), email: 'buyer@test.local', password: 'pw', nickname: '구매자' },
  { id: U(2), email: 'other@test.local', password: 'pw', nickname: '다른사람' },
  { id: U(3), email: 'admin@test.local', password: 'pw', nickname: '운영자' },
];
const [BUYER, OTHER, ADMIN] = users;
const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54396, users, appDir: APP, log: !!process.env.DB_LOG });
await sb.sql(`insert into public.platform_admins (user_id) values ($1)`, [ADMIN.id]);
const one = async (q, p = []) => { const r = await sb.sql(q, p); return (r.rows ?? r)[0]; };
const bal = async (uid) => Number((await one(`select coalesce((select balance from public.wallets where user_id = $1), 0) b`, [uid])).b);

// ---------- Deno shim + Toss mock ----------
const ENV = {};
const handlers = {};
let current = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handlers[current] = h; } };
const toss = { payments: new Map(), confirmCalls: 0, getCalls: 0, cancelCalls: 0, confirmOverride: null };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('https://api.tosspayments.com/')) return realFetch(input, init);
  const auth = (init.headers?.Authorization ?? init.headers?.authorization ?? '');
  if (!/^Basic /.test(auth)) return new Response(JSON.stringify({ code: 'UNAUTHORIZED_KEY' }), { status: 401 });
  const u = new URL(url);
  if (u.pathname === '/v1/payments/confirm') {
    toss.confirmCalls++;
    const b = JSON.parse(init.body);
    if (toss.confirmOverride) return toss.confirmOverride(b);
    const pay = { paymentKey: b.paymentKey, orderId: b.orderId, totalAmount: b.amount, status: 'DONE' };
    toss.payments.set(b.paymentKey, pay);
    return new Response(JSON.stringify(pay), { status: 200 });
  }
  const m = u.pathname.match(/^\/v1\/payments\/([^/]+)(\/cancel)?$/);
  if (m && m[2]) {
    toss.cancelCalls++;
    const pay = toss.payments.get(decodeURIComponent(m[1]));
    if (!pay) return new Response(JSON.stringify({ code: 'NOT_FOUND_PAYMENT', message: '결제 없음' }), { status: 404 });
    pay.status = 'CANCELED';
    return new Response(JSON.stringify(pay), { status: 200 });
  }
  if (m) {
    toss.getCalls++;
    const pay = toss.payments.get(decodeURIComponent(m[1]));
    return pay ? new Response(JSON.stringify(pay), { status: 200 }) : new Response(JSON.stringify({ code: 'NOT_FOUND_PAYMENT' }), { status: 404 });
  }
  return new Response('{}', { status: 404 });
};

const req = createRequire(path.join(APP, 'package.json'));
const supaPath = req.resolve('@supabase/supabase-js');
const npmAlias = { name: 'npm-alias', setup(b) { b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: supaPath })); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payfn-'));
for (const fn of ['payment-verify', 'payment-webhook']) {
  const out = path.join(dir, `${fn}.mjs`);
  await build({ entryPoints: [path.join(APP, `supabase/functions/${fn}/index.ts`)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', plugins: [npmAlias] });
  current = fn;
  await import(pathToFileURL(out).href);
}
check('두 함수 코드가 로드되어 핸들러 등록', typeof handlers['payment-verify'] === 'function' && typeof handlers['payment-webhook'] === 'function');

const baseEnv = { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: makeServiceJwt() };
const setEnv = (e) => { for (const k of Object.keys(ENV)) delete ENV[k]; Object.assign(ENV, baseEnv, e); };
const verify = async (user, body) => {
  const r = await handlers['payment-verify'](new Request('http://fn/payment-verify', { method: 'POST', headers: { Authorization: `Bearer ${user ? makeJwt(user.id, user.email) : ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() };
};
const webhook = async (body, headers = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const r = await handlers['payment-webhook'](new Request('http://fn/payment-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw }));
  return { status: r.status, json: await r.json() };
};
const event = (paymentKey, orderId) => ({ eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-11-17T10:00:00.000000', data: { paymentKey, orderId, status: 'DONE' } });

try {
  setEnv({ PAYMENT_SECRET_KEY: 'test_sk_mock' });

  section('1. 구독 결제 (Toss 테스트 키 모드)');
  const s1 = await verify(BUYER, { action: 'sub_create', planId: 'pro', cycle: 'monthly' });
  check('구독 주문: 서버 금액 9,900원, mode=test', s1.json.ok && s1.json.order.amountKrw === 9900 && s1.json.mode === 'test', s1.json);
  const c1 = await verify(BUYER, { action: 'sub_confirm', orderId: s1.json.order.orderId, providerReceipt: 'pk_sub_1' });
  check('Toss 승인 → 구독 확정, PRO 권한', c1.json.ok && c1.json.order.status === 'paid' && (await one(`select public.has_entitlement($1, 'coach_advanced') x`, [BUYER.id])).x === true, c1.json);
  const c1b = await verify(BUYER, { action: 'sub_confirm', orderId: s1.json.order.orderId, providerReceipt: 'pk_sub_1' });
  check('같은 주문 재확정(새로고침·중복 요청) → 그대로 성공, Toss 재승인 호출 없음', c1b.json.ok && toss.confirmCalls === 1);
  check('구독 1개만 존재', (await one(`select count(*)::int n from public.user_subscriptions where user_id = $1`, [BUYER.id])).n === 1);
  const other = await verify(OTHER, { action: 'sub_confirm', orderId: s1.json.order.orderId, providerReceipt: 'pk_sub_1' });
  check('남의 주문 확정 시도 → 거부', !other.json.ok && (other.status === 403 || other.status === 404), other);

  section('2. 금액 위변조·결제 실패');
  const s2 = await verify(OTHER, { action: 'sub_create', planId: 'pro', cycle: 'yearly' });
  toss.confirmOverride = (b) => new Response(JSON.stringify({ paymentKey: b.paymentKey, orderId: b.orderId, totalAmount: 100, status: 'DONE' }), { status: 200 });
  const c2 = await verify(OTHER, { action: 'sub_confirm', orderId: s2.json.order.orderId, providerReceipt: 'pk_tampered' });
  check('Toss 응답 금액이 주문과 다름 → 결제 실패 처리, 구독 없음', !c2.json.ok && c2.json.code === 'PG_VERIFICATION_FAILED' && (await one(`select status from public.subscription_payments where id = $1`, [s2.json.order.orderId])).status === 'failed'
    && (await one(`select count(*)::int n from public.user_subscriptions where user_id = $1`, [OTHER.id])).n === 0);
  toss.confirmOverride = () => new Response(JSON.stringify({ code: 'REJECT_CARD_COMPANY', message: '카드사 거절' }), { status: 400 });
  const s3 = await verify(OTHER, { action: 'coin_create', packageId: 'starter' });
  const c3 = await verify(OTHER, { action: 'coin_confirm', orderId: s3.json.order.orderId, providerReceipt: 'pk_rejected' });
  check('카드사 거절 → 주문 failed, 코인 0', !c3.json.ok && (await bal(OTHER.id)) === 0 && (await one(`select status from public.coin_orders where id = $1`, [s3.json.order.orderId])).status === 'failed');
  toss.confirmOverride = null;

  section('3. 코인 구매 → 지급 · 중복 방지');
  const k1 = await verify(BUYER, { action: 'coin_create', packageId: 'standard' });
  check('코인 주문 5,000원 (5,000+500)', k1.json.order.amountKrw === 5000 && k1.json.order.coins === 5000 && k1.json.order.bonusCoins === 500);
  const before = toss.confirmCalls;
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => verify(BUYER, { action: 'coin_confirm', orderId: k1.json.order.orderId, providerReceipt: 'pk_coin_1' })));
  check('같은 결제 확정 요청 5개 동시 → 전부 성공 응답, 코인은 1회만 (5,500)', burst.every((r) => r.json.ok) && (await bal(BUYER.id)) === 5500, burst.map((r) => r.status));
  check('원장에 이 주문 지급 1행', (await one(`select count(*)::int n from public.wallet_ledger where idempotency_key = $1`, [`coin_order:${k1.json.order.orderId}`])).n === 1);
  console.log('   (Toss 승인 API 호출 수:', toss.confirmCalls - before, '— 함수는 동시 요청을 막지 않지만 Toss 는 같은 paymentKey 를 한 번만 승인하고, DB 는 같은 키 재확정을 무시)');

  section('4. 결제 웹훅 · 중복 웹훅');
  const k2 = await verify(BUYER, { action: 'coin_create', packageId: 'starter' });
  toss.payments.set('pk_wh_1', { paymentKey: 'pk_wh_1', orderId: k2.json.order.orderId, totalAmount: 1000, status: 'DONE' });
  const w1 = await webhook(event('pk_wh_1', k2.json.order.orderId));
  check('서명 없는 웹훅 → Toss 결제 조회로 재검증 후 지급', w1.status === 200 && (await bal(BUYER.id)) === 6500, w1.json);
  const w2 = await webhook(event('pk_wh_1', k2.json.order.orderId));
  const w3 = await webhook(event('pk_wh_1', k2.json.order.orderId));
  check('같은 웹훅 재전송 2회 → 추가 지급 없음 (6,500 유지)', w2.status === 200 && w3.status === 200 && (await bal(BUYER.id)) === 6500);
  const c4 = await verify(BUYER, { action: 'coin_confirm', orderId: k2.json.order.orderId, providerReceipt: 'pk_wh_1' });
  check('웹훅 뒤 앱의 결제 확인이 늦게 와도 추가 지급 없음', c4.json.ok && (await bal(BUYER.id)) === 6500);
  const k3 = await verify(BUYER, { action: 'coin_create', packageId: 'starter' });
  toss.payments.set('pk_wh_2', { paymentKey: 'pk_wh_2', orderId: k3.json.order.orderId, totalAmount: 1000, status: 'DONE' });
  const race = await Promise.all([webhook(event('pk_wh_2', k3.json.order.orderId)), verify(BUYER, { action: 'coin_confirm', orderId: k3.json.order.orderId, providerReceipt: 'pk_wh_2' }), webhook(event('pk_wh_2', k3.json.order.orderId))]);
  check('웹훅 2개 + 앱 확인 동시 도착 → 1회 지급 (7,500)', (await bal(BUYER.id)) === 7500, race.map((r) => r.status));
  const k4 = await verify(BUYER, { action: 'coin_create', packageId: 'starter' });
  toss.payments.set('pk_wh_3', { paymentKey: 'pk_wh_3', orderId: k4.json.order.orderId, totalAmount: 999, status: 'DONE' });
  const w4 = await webhook(event('pk_wh_3', k4.json.order.orderId));
  check('Toss 금액 ≠ 주문 금액 → 409, 지급 없음', w4.status === 409 && (await bal(BUYER.id)) === 7500);
  toss.payments.set('pk_wh_4', { paymentKey: 'pk_wh_4', orderId: 'coin_someone_else', totalAmount: 1000, status: 'DONE' });
  const w5 = await webhook(event('pk_wh_4', k4.json.order.orderId));
  check('Toss 결제의 주문번호가 이벤트와 다름(다른 결제 키 끼워넣기) → 409', w5.status === 409 && (await one(`select status from public.coin_orders where id = $1`, [k4.json.order.orderId])).status === 'pending');
  const w6 = await webhook(event('pk_not_exists', k4.json.order.orderId));
  check('Toss 에 없는 결제 → 502, 변경 없음 (Toss 재시도 대상)', w6.status === 502 && (await one(`select status from public.coin_orders where id = $1`, [k4.json.order.orderId])).status === 'pending');
  const s4 = await verify(OTHER, { action: 'sub_create', planId: 'pro', cycle: 'monthly' });
  toss.payments.set('pk_wh_sub', { paymentKey: 'pk_wh_sub', orderId: s4.json.order.orderId, totalAmount: 9900, status: 'DONE' });
  await webhook(event('pk_wh_sub', s4.json.order.orderId));
  check('구독 결제도 웹훅으로 확정', (await one(`select status from public.subscription_payments where id = $1`, [s4.json.order.orderId])).status === 'paid');
  check('장비·커리큘럼 주문 웹훅은 무시(기존 경로 유지)', (await webhook(event('x', 'gear_123'))).json.ignored === 'gear');

  section('5. 웹훅 서명');
  const KEY = 'whsec_mock_key';
  const raw = JSON.stringify(event('pk_wh_1', k2.json.order.orderId));
  const t = '2026-11-17T10:00:01.000+09:00';
  const sig = 'v1:' + createHmac('sha256', KEY).update(`${raw}:${t}`).digest('base64');
  setEnv({ PAYMENT_SECRET_KEY: 'test_sk_mock' });
  check('보안 키 미설정 + 서명 헤더 → 503 (안전 실패)', (await webhook(raw, { 'tosspayments-webhook-signature': sig, 'tosspayments-webhook-transmission-time': t })).status === 503);
  setEnv({ PAYMENT_SECRET_KEY: 'test_sk_mock', TOSS_WEBHOOK_SECURITY_KEY: KEY });
  check('올바른 서명 → 처리 (200)', (await webhook(raw, { 'tosspayments-webhook-signature': sig, 'tosspayments-webhook-transmission-time': t })).status === 200);
  check('본문 변조 + 기존 서명 → 401', (await webhook(raw.replace('DONE', 'CANCELED'), { 'tosspayments-webhook-signature': sig, 'tosspayments-webhook-transmission-time': t })).status === 401);
  check('위조 서명 → 401', (await webhook(raw, { 'tosspayments-webhook-signature': 'v1:AAAA', 'tosspayments-webhook-transmission-time': t })).status === 401);

  section('6. 환불');
  const r1 = await verify(BUYER, { action: 'coin_refund', orderId: k1.json.order.orderId, reason: '테스트 환불' });
  check('미사용 코인 주문 환불 → Toss 취소 호출 + 5,500 회수', r1.json.ok && r1.json.order.status === 'refunded' && toss.cancelCalls === 1 && (await bal(BUYER.id)) === 2000, r1.json);
  const r2 = await verify(BUYER, { action: 'coin_refund', orderId: k1.json.order.orderId, reason: '중복' });
  check('같은 환불 재요청 → 거부, Toss 취소 추가 호출 없음', !r2.json.ok && toss.cancelCalls === 1);
  const r3 = await verify(OTHER, { action: 'coin_refund', orderId: k2.json.order.orderId, reason: '남의 주문' });
  check('남의 코인 주문 환불 → 거부', !r3.json.ok && toss.cancelCalls === 1);
  await sb.sql(`select public.post_ledger($1, 'content_purchase', -1500, 'test', 'spend', 'spend-for-refund-test')`, [BUYER.id]);
  const r4 = await verify(BUYER, { action: 'coin_refund', orderId: k2.json.order.orderId, reason: '이미 씀' });
  check('지급 코인을 쓴 주문은 환불 거부 (Toss 취소 안 함)', !r4.json.ok && toss.cancelCalls === 1, r4.json);
  // Toss 콘솔에서 취소 → CANCELED 웹훅
  const k5 = await verify(OTHER, { action: 'coin_create', packageId: 'starter' });
  toss.payments.set('pk_cancel', { paymentKey: 'pk_cancel', orderId: k5.json.order.orderId, totalAmount: 1000, status: 'DONE' });
  await webhook(event('pk_cancel', k5.json.order.orderId));
  const ob = await bal(OTHER.id);
  toss.payments.get('pk_cancel').status = 'CANCELED';
  await webhook(event('pk_cancel', k5.json.order.orderId));
  await webhook(event('pk_cancel', k5.json.order.orderId));
  check('결제사 취소 웹훅(2회) → 코인 1회 회수, 주문 refunded', (await bal(OTHER.id)) === ob - 1000 && (await one(`select status from public.coin_orders where id = $1`, [k5.json.order.orderId])).status === 'refunded');

  section('7. 실결제·샌드박스·시크릿 누락 — 안전 실패');
  setEnv({ PAYMENT_SECRET_KEY: 'live_sk_mock' });
  const calls = toss.confirmCalls;
  const k6 = await verify(BUYER, { action: 'coin_create', packageId: 'starter' });
  check('라이브 키 + 잠금 → 주문 생성은 가능하지만 mode=live', k6.json.mode === 'live');
  const l1 = await verify(BUYER, { action: 'coin_confirm', orderId: k6.json.order.orderId, providerReceipt: 'pk_live' });
  check('라이브 키 + 정책 잠금 → 결제 승인 거부, Toss 호출 없음, 코인 없음', !l1.json.ok && l1.status === 403 && toss.confirmCalls === calls && /실결제/.test(l1.json.message));
  const lw = await webhook(event('pk_live', k6.json.order.orderId));
  check('라이브 키 + 잠금 → 웹훅도 무시', lw.json.ignored === 'live payments disabled');
  setEnv({});
  const k7 = await verify(BUYER, { action: 'coin_create', packageId: 'starter' });
  const sb1 = await verify(BUYER, { action: 'coin_confirm', orderId: k7.json.order.orderId });
  check('결제 키 없음(샌드박스) + 일반 사용자 → 거부 (공짜 코인 방지)', !sb1.json.ok && sb1.status === 403);
  const ka = await verify(ADMIN, { action: 'coin_create', packageId: 'starter' });
  const sb2 = await verify(ADMIN, { action: 'coin_confirm', orderId: ka.json.order.orderId });
  check('샌드박스 + 관리자(테스터) → 테스트 승인 허용', sb2.json.ok && sb2.json.order.status === 'paid');
  check('결제 키 없음 → 웹훅 503 (검증 불가 시 변경 안 함)', (await webhook(event('pk_x', k7.json.order.orderId))).status === 503);
  setEnv({ PAYMENT_SECRET_KEY: 'test_sk_mock', SUPABASE_SERVICE_ROLE_KEY: '' });
  check('서버 설정 누락 → 500 (요청 처리 안 함)', (await verify(BUYER, { action: 'coin_create', packageId: 'starter' })).status === 500);
  setEnv({ PAYMENT_SECRET_KEY: 'test_sk_mock' });
  check('로그인 없음 → 401', (await verify(null, { action: 'coin_create', packageId: 'starter' })).status === 401);

  section('8. 원장 정합성');
  await sb.sql(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const integ = (await sb.sql(`select * from public.wallet_integrity_report()`)).rows ?? [];
  await sb.sql(`select set_config('request.jwt.claim.role', '', false)`);
  check('전체 흐름 뒤 원장 이상 0건 (잔액=원장 합계·연쇄·중복·결제-지급 일치)', integ.length === 0, integ);
} catch (e) {
  check('실행 중 예외 없음', false, e.stack?.slice(0, 400));
} finally {
  await sb.close();
}
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
