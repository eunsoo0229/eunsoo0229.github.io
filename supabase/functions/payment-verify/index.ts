// Supabase Edge Function — the ONLY place in the whole system that may push
// a marketplace order to 'paid' (see migration 0010_payments.sql's
// finalize_marketplace_order: that transition is rejected unless the caller
// holds the service_role key, which lives ONLY here — never in the
// Electron/Android/Web client bundle, per spec section 8/10/11).
//
// This mirrors gemini-ask/index.ts and youtube-search/index.ts's shape
// exactly: same CORS headers, same "verify the caller's own Supabase JWT
// before doing anything" gate, same jsonResponse/errorResult convention.
//
// TossPayments V2 server-side confirmation lives in verifyWithPg() below:
// when PAYMENT_SECRET_KEY (a Supabase Edge Function secret — never in any
// client bundle) is unset, this stays in test/sandbox no-op mode exactly as
// before (TestPaymentProvider); once it's set, verifyWithPg() calls Toss's
// POST /v1/payments/confirm and cross-checks orderId/amount/status before
// anything is allowed to reach 'paid'. Everything else (auth gate, order
// lookup, RPC calls, response shape) is unchanged either way.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PaymentErrorCode =
  | 'UNAUTHORIZED'
  | 'LISTING_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'NOT_YOUR_ORDER'
  | 'ORDER_NOT_PENDING'
  | 'PG_VERIFICATION_FAILED'
  | 'UNKNOWN';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
function errorResult(code: PaymentErrorCode, message: string) {
  return { ok: false, code, message };
}

interface RequestBody {
  action:
    | 'create_pending' | 'confirm' | 'cancel' | 'simulate_failure' | 'refund'
    | 'gear_create' | 'gear_confirm' | 'gear_fail' | 'gear_refund'
    // 수익화 (0061·0062): 멤버십 구독 · MARTIAL COIN 구매
    | 'sub_create' | 'sub_confirm' | 'sub_fail'
    | 'coin_create' | 'coin_confirm' | 'coin_fail' | 'coin_refund';
  /** 구독 (0061) */
  planId?: string;
  cycle?: 'monthly' | 'yearly';
  gymId?: string | null;
  /** 코인 상품 (0062) */
  packageId?: string;
  curriculumId?: string;
  /** 장비 택배 거래 (0059) */
  listingId?: string;
  shipping?: { name?: string; phone?: string; address?: string; memo?: string };
  orderId?: string;
  /** Opaque, provider-specific confirmation the client received from its PaymentProvider step — for the test provider this is a fixed placeholder; a real provider would put its transaction/receipt id here. Never trusted on its own, only used as a lookup key when a real PG's confirm API is wired in. */
  providerReceipt?: string;
  reason?: string;
}

function isRequestBody(v: unknown): v is RequestBody {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return typeof b.action === 'string';
}

const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm';

/**
 * Where a real PG integration's server-to-server verification call goes.
 * Never trust the client's own "success" claim — always ask the PG itself.
 * PAYMENT_SECRET_KEY lives only in this function's Supabase secrets
 * (`supabase secrets set PAYMENT_SECRET_KEY=...`), never in .env's
 * VITE_-prefixed vars, never logged, never returned to the client.
 *
 * providerReceipt here is TossPayments' `paymentKey` (the client only ever
 * learns this from Toss's own successUrl redirect query params — it is
 * never derived or guessed client-side). orderId/expectedAmountKrw both
 * come from OUR OWN trusted order row (never from client input) — Toss's
 * response is cross-checked against them, not the other way around.
 */
async function verifyWithPg(orderId: string, providerReceipt: string | undefined, expectedAmountKrw: number): Promise<{ ok: true; paymentKey: string } | { ok: false; message: string }> {
  const secretKey = Deno.env.get('PAYMENT_SECRET_KEY');
  if (!secretKey) {
    // No PG under contract yet — test/sandbox mode (TestPaymentProvider).
    // The order itself was already created server-side with the real
    // listing price (see create_pending_marketplace_order), so there is
    // nothing further to "verify" against here; this branch is what the
    // real Toss call below replaces once PAYMENT_SECRET_KEY is set.
    return { ok: true, paymentKey: providerReceipt ?? 'TEST_RECEIPT' };
  }
  if (!providerReceipt) {
    return { ok: false, message: '결제 승인에 필요한 정보(paymentKey)가 없습니다.' };
  }

  let json: Record<string, unknown>;
  let res: Response;
  try {
    res = await fetch(TOSS_CONFIRM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey: providerReceipt, orderId, amount: expectedAmountKrw }),
    });
    json = await res.json();
  } catch {
    return { ok: false, message: '결제 승인 서버와 통신하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }

  if (!res.ok) {
    const message = typeof json.message === 'string' ? json.message : '결제 승인에 실패했습니다.';
    return { ok: false, message };
  }
  // Cross-check Toss's own response against OUR trusted values — never
  // trust orderId/amount the client sent, only what's in orderRow already.
  if (json.orderId !== orderId || json.totalAmount !== expectedAmountKrw || json.status !== 'DONE') {
    return { ok: false, message: '결제 승인 정보가 주문 내용과 일치하지 않습니다.' };
  }
  return { ok: true, paymentKey: providerReceipt };
}

/**
 * Toss 결제 취소(환불). PAYMENT_SECRET_KEY 가 없으면(테스트 공급자 모드) 취소할 PG 거래가 없으므로 그대로 성공.
 * paymentKey 는 우리 주문 행에 저장된 값만 쓴다(클라이언트가 보낸 값을 쓰지 않음).
 */
async function cancelWithPg(paymentKey: string | null, reason: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const secretKey = Deno.env.get('PAYMENT_SECRET_KEY');
  if (!secretKey || !paymentKey || paymentKey === 'TEST_RECEIPT') return { ok: true };
  try {
    const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${secretKey}:`)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason: reason.slice(0, 200) || '구매 취소' }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, message: typeof json.message === 'string' ? json.message : '결제 취소에 실패했습니다.' };
    if (json.status !== 'CANCELED' && json.status !== 'PARTIAL_CANCELED') return { ok: false, message: '결제 취소 상태를 확인하지 못했습니다.' };
    return { ok: true };
  } catch {
    return { ok: false, message: '결제 취소 서버와 통신하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

// ---------------- 수익화: 테스트/실결제 구분 ----------------
// PAYMENT_SECRET_KEY 가 없거나 Toss 테스트 키(test_sk_...)면 테스트 결제.
// live 키가 설정돼 있어도 monetization_config.live_payments_enabled 가 꺼져 있으면(마이그레이션 CHECK 로 잠김)
// 구독·코인 결제 승인을 거부한다 → 법률·결제사 검토 전에는 실제 돈이 오가지 않는다.
function paymentMode(): 'sandbox' | 'test' | 'live' {
  const k = Deno.env.get('PAYMENT_SECRET_KEY');
  if (!k) return 'sandbox';
  return k.startsWith('test_') ? 'test' : 'live';
}
// deno-lint-ignore no-explicit-any
async function liveBlocked(serviceClient: any): Promise<boolean> {
  if (paymentMode() !== 'live') return false;
  const { data } = await serviceClient.from('monetization_config').select('live_payments_enabled').maybeSingle();
  return !data?.live_payments_enabled;
}

// 샌드박스(결제 키 없음)에서는 영수증 검증이 불가능하다 → 새 구독·코인 결제는 관리자(테스터)만 확정할 수 있다.
// (기존 커리큘럼·장비 결제의 샌드박스 동작은 그대로 둔다.)
// deno-lint-ignore no-explicit-any
async function sandboxForbidden(serviceClient: any, userId: string): Promise<boolean> {
  if (paymentMode() !== 'sandbox') return false;
  const { data } = await serviceClient.rpc('is_platform_admin', { p_user: userId });
  return data !== true;
}

function subOrderOut(row: Record<string, unknown>) {
  return { orderId: row.id, planId: row.plan_id, cycle: row.cycle, gymId: row.gym_id ?? null, kind: row.kind, amountKrw: row.amount_krw, status: row.status, isTest: row.is_test, paidAt: row.paid_at ?? null };
}
function coinOrderOut(row: Record<string, unknown>) {
  return { orderId: row.id, packageId: row.package_id, coins: row.coins, bonusCoins: row.bonus_coins, amountKrw: row.amount_krw, status: row.status, isTest: row.is_test, paidAt: row.paid_at ?? null };
}
function mapMonetizationError(message: string) {
  if (message.includes('PLAN_UNAVAILABLE') || message.includes('PLAN_NOT_PURCHASABLE')) return errorResult('UNKNOWN', '구독할 수 없는 요금제입니다.');
  if (message.includes('NOT_GYM_OWNER')) return errorResult('UNKNOWN', '사업자 요금제는 체육관 관장만 구독할 수 있습니다.');
  if (message.includes('PERSONAL_PLAN_NO_GYM')) return errorResult('UNKNOWN', '개인 요금제에는 체육관을 지정할 수 없습니다.');
  if (message.includes('INVALID_CYCLE')) return errorResult('UNKNOWN', '결제 주기를 선택해주세요.');
  if (message.includes('PACKAGE_UNAVAILABLE')) return errorResult('UNKNOWN', '판매 중인 코인 상품이 아닙니다.');
  if (message.includes('ORDER_ALREADY_PAID')) return errorResult('ORDER_NOT_PENDING', '이미 결제된 주문입니다.');
  return mapRpcError(message);
}

function gearOrderOut(row: Record<string, unknown>) {
  return {
    orderId: row.id,
    listingId: row.listing_id,
    itemTitle: row.item_title,
    itemPrice: row.item_price,
    shippingFee: row.shipping_fee,
    amount: row.amount,
    status: row.status,
    paidAt: row.paid_at ?? null,
  };
}

function mapGearError(message: string) {
  if (message.includes('LISTING_UNAVAILABLE')) return errorResult('LISTING_NOT_FOUND', '판매 중이 아니거나 이미 판매된 상품입니다.');
  if (message.includes('SHIPPING_NOT_AVAILABLE')) return errorResult('UNKNOWN', '택배 거래를 하지 않는 상품입니다. 판매자에게 문의해 직거래하세요.');
  if (message.includes('OWN_LISTING')) return errorResult('UNKNOWN', '내 상품은 구매할 수 없습니다.');
  if (message.includes('BLOCKED')) return errorResult('UNKNOWN', '차단 관계에서는 거래할 수 없습니다.');
  if (message.includes('AMOUNT_TOO_SMALL')) return errorResult('UNKNOWN', '결제 금액이 너무 작습니다(100원 이상). 직거래를 이용하세요.');
  if (message.includes('ORDER_NOT_REFUNDABLE')) return errorResult('UNKNOWN', '발송 전 결제 완료 상태에서만 결제를 취소할 수 있습니다.');
  if (message.includes('check constraint') || message.includes('violates')) return errorResult('UNKNOWN', '배송 정보(이름·연락처·주소)를 확인해주세요.');
  return mapRpcError(message);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(errorResult('UNKNOWN', 'POST 요청만 허용됩니다.'), 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(errorResult('UNAUTHORIZED', '결제 기능을 사용하려면 로그인이 필요합니다.'), 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(errorResult('UNKNOWN', '서버 설정 오류입니다. 관리자에게 문의해주세요.'), 500);
  }

  // Acts AS the calling user for reads/writes that must stay scoped to them
  // (RLS + auth.uid() inside the RPCs below resolve to this user).
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse(errorResult('UNAUTHORIZED', '로그인 세션이 유효하지 않습니다. 다시 로그인해주세요.'), 401);
  }

  // Holds the service_role key — the ONLY caller that can ever push an order
  // to 'paid' (finalize_marketplace_order rejects that transition from
  // anyone else, see migration 0010). Used exclusively for the 'confirm'
  // action's final write, after this function's own PG-approval check above.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(errorResult('UNKNOWN', '요청 형식이 올바르지 않습니다.'), 400);
  }
  if (!isRequestBody(body)) return jsonResponse(errorResult('UNKNOWN', '요청 형식이 올바르지 않습니다.'), 400);

  try {
    if (body.action === 'create_pending') {
      if (!body.curriculumId) return jsonResponse(errorResult('UNKNOWN', '커리큘럼 id가 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('create_pending_marketplace_order', { p_curriculum_id: body.curriculumId });
      if (error) return jsonResponse(mapRpcError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: rowToOrder(row) });
    }

    if (body.action === 'confirm') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);

      // Look up the pending order (scoped to this user via RLS) to know the
      // real amount to verify against — never trust anything the client
      // sends about price here.
      const { data: orderRow, error: orderErr } = await userClient.from('marketplace_orders').select('*').eq('id', body.orderId).maybeSingle();
      if (orderErr) return jsonResponse(errorResult('UNKNOWN', '주문을 조회하지 못했습니다.'), 400);
      if (!orderRow) return jsonResponse(errorResult('ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.'), 404);
      if (orderRow.status === 'paid' || orderRow.status === 'completed') {
        return jsonResponse({ ok: true, order: rowToOrder(orderRow) }); // already finalized — idempotent
      }
      if (orderRow.status !== 'pending') {
        return jsonResponse(errorResult('ORDER_NOT_PENDING', '이미 처리된 주문입니다.'), 409);
      }

      const pgResult = await verifyWithPg(body.orderId, body.providerReceipt, orderRow.price_krw);
      if (!pgResult.ok) {
        await serviceClient.rpc('finalize_marketplace_order', { p_order_id: body.orderId, p_new_status: 'failed', p_reason: pgResult.message });
        return jsonResponse(errorResult('PG_VERIFICATION_FAILED', pgResult.message), 402);
      }

      const { data, error } = await serviceClient.rpc('finalize_marketplace_order', { p_order_id: body.orderId, p_new_status: 'paid', p_payment_key: pgResult.paymentKey });
      if (error) return jsonResponse(mapRpcError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: { ...rowToOrder(orderRow), status: row.status, paidAt: row.paid_at } });
    }

    if (body.action === 'cancel' || body.action === 'simulate_failure') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const newStatus = body.action === 'cancel' ? 'cancelled' : 'failed';
      const { data, error } = await userClient.rpc('finalize_marketplace_order', { p_order_id: body.orderId, p_new_status: newStatus, p_reason: body.reason ?? null });
      if (error) return jsonResponse(mapRpcError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: { orderId: row.order_id, status: row.status } });
    }

    if (body.action === 'refund') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('request_marketplace_refund', { p_order_id: body.orderId });
      if (error) return jsonResponse(mapRpcError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: { orderId: row.order_id, status: row.status } });
    }

    // ---------------- 장비 택배 거래 (0059) ----------------
    if (body.action === 'gear_create') {
      if (!body.listingId) return jsonResponse(errorResult('UNKNOWN', '상품 id가 필요합니다.'), 400);
      const sh = body.shipping ?? {};
      const { data, error } = await userClient.rpc('create_gear_order', {
        p_listing: body.listingId,
        p_name: sh.name ?? '',
        p_phone: sh.phone ?? '',
        p_address: sh.address ?? '',
        p_memo: sh.memo ?? '',
      });
      if (error) return jsonResponse(mapGearError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: gearOrderOut(row) });
    }

    if (body.action === 'gear_confirm') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data: orderRow, error: orderErr } = await userClient.from('gear_orders').select('*').eq('id', body.orderId).maybeSingle();
      if (orderErr) return jsonResponse(errorResult('UNKNOWN', '주문을 조회하지 못했습니다.'), 400);
      if (!orderRow) return jsonResponse(errorResult('ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.'), 404);
      if (orderRow.buyer_id !== userData.user.id) return jsonResponse(errorResult('NOT_YOUR_ORDER', '본인의 주문이 아닙니다.'), 403);
      if (['paid', 'shipped', 'delivered'].includes(orderRow.status)) return jsonResponse({ ok: true, order: gearOrderOut(orderRow) });
      if (orderRow.status !== 'pending') return jsonResponse(errorResult('ORDER_NOT_PENDING', '이미 처리된 주문입니다.'), 409);

      // amount comes from OUR order row (price + shipping fee computed by the DB), never from the client
      const pgResult = await verifyWithPg(body.orderId, body.providerReceipt, orderRow.amount);
      if (!pgResult.ok) {
        await serviceClient.rpc('finalize_gear_order', { p_order: body.orderId, p_new_status: 'failed', p_reason: pgResult.message });
        return jsonResponse(errorResult('PG_VERIFICATION_FAILED', pgResult.message), 402);
      }
      const { data, error } = await serviceClient.rpc('finalize_gear_order', { p_order: body.orderId, p_new_status: 'paid', p_payment_key: pgResult.paymentKey });
      if (error) {
        // Toss approved but the item can no longer be sold (sold to someone else meanwhile) → give the money back
        const cancel = await cancelWithPg(pgResult.paymentKey, '상품이 이미 판매되어 자동 취소');
        await serviceClient.rpc('finalize_gear_order', { p_order: body.orderId, p_new_status: 'failed', p_reason: cancel.ok ? '이미 판매된 상품 — 결제 자동 취소' : `이미 판매된 상품 — 자동 취소 실패: ${cancel.message}` });
        return jsonResponse(errorResult('PG_VERIFICATION_FAILED', cancel.ok ? '그 사이 다른 구매자에게 판매된 상품이라 결제를 자동으로 취소했습니다.' : `이미 판매된 상품입니다. 결제 취소에 실패했으니 고객센터에 문의해주세요. (${cancel.message})`), 409);
      }
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: gearOrderOut(row) });
    }

    if (body.action === 'gear_fail') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('finalize_gear_order', { p_order: body.orderId, p_new_status: 'failed', p_reason: body.reason ?? null });
      if (error) return jsonResponse(mapGearError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: gearOrderOut(row) });
    }

    if (body.action === 'gear_refund') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      // RLS: only the buyer or the seller of this order can read it
      const { data: orderRow, error: orderErr } = await userClient.from('gear_orders').select('*').eq('id', body.orderId).maybeSingle();
      if (orderErr) return jsonResponse(errorResult('UNKNOWN', '주문을 조회하지 못했습니다.'), 400);
      if (!orderRow) return jsonResponse(errorResult('ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.'), 404);
      if (orderRow.status === 'refunded') return jsonResponse({ ok: true, order: gearOrderOut(orderRow) });
      if (orderRow.status !== 'paid') return jsonResponse(mapGearError('ORDER_NOT_REFUNDABLE'), 409);
      const who = orderRow.buyer_id === userData.user.id ? '구매자' : '판매자';
      const reason = `${who} 요청: ${(body.reason ?? '').slice(0, 150) || '구매 취소'}`;
      const cancel = await cancelWithPg(orderRow.payment_key, reason);
      if (!cancel.ok) return jsonResponse(errorResult('PG_VERIFICATION_FAILED', cancel.message), 402);
      const { data, error } = await serviceClient.rpc('finalize_gear_order', { p_order: body.orderId, p_new_status: 'refunded', p_reason: reason });
      if (error) return jsonResponse(mapGearError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: gearOrderOut(row) });
    }

    // ---------------- 멤버십 구독 (0061) ----------------
    if (body.action === 'sub_create') {
      if (!body.planId || !body.cycle) return jsonResponse(errorResult('UNKNOWN', '요금제와 결제 주기가 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('create_subscription_order', { p_plan: body.planId, p_cycle: body.cycle, p_gym: body.gymId ?? null });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: subOrderOut(row), mode: paymentMode() });
    }

    if (body.action === 'sub_confirm') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data: orderRow, error: orderErr } = await userClient.from('subscription_payments').select('*').eq('id', body.orderId).maybeSingle();
      if (orderErr) return jsonResponse(errorResult('UNKNOWN', '주문을 조회하지 못했습니다.'), 400);
      if (!orderRow) return jsonResponse(errorResult('ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.'), 404);
      if (orderRow.user_id !== userData.user.id) return jsonResponse(errorResult('NOT_YOUR_ORDER', '본인의 주문이 아닙니다.'), 403);
      if (orderRow.status === 'paid') return jsonResponse({ ok: true, order: subOrderOut(orderRow) });
      if (orderRow.status !== 'pending') return jsonResponse(errorResult('ORDER_NOT_PENDING', '이미 처리된 주문입니다.'), 409);
      if (await liveBlocked(serviceClient)) return jsonResponse(errorResult('PG_VERIFICATION_FAILED', '실결제는 아직 활성화되지 않았습니다.'), 403);
      if (await sandboxForbidden(serviceClient, userData.user.id)) return jsonResponse(errorResult('PG_VERIFICATION_FAILED', '결제 서비스가 설정되지 않아 테스트 결제는 관리자만 할 수 있습니다.'), 403);
      const pgResult = await verifyWithPg(body.orderId, body.providerReceipt, orderRow.amount_krw);
      if (!pgResult.ok) {
        await serviceClient.rpc('finalize_subscription_payment', { p_order: body.orderId, p_status: 'failed', p_reason: pgResult.message });
        return jsonResponse(errorResult('PG_VERIFICATION_FAILED', pgResult.message), 402);
      }
      const { data, error } = await serviceClient.rpc('finalize_subscription_payment', { p_order: body.orderId, p_status: 'paid', p_payment_key: pgResult.paymentKey, p_is_test: paymentMode() !== 'live' });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: subOrderOut(row) });
    }

    if (body.action === 'sub_fail') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('finalize_subscription_payment', { p_order: body.orderId, p_status: 'failed', p_reason: body.reason ?? null });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: subOrderOut(row) });
    }

    // ---------------- MARTIAL COIN (0062) ----------------
    if (body.action === 'coin_create') {
      if (!body.packageId) return jsonResponse(errorResult('UNKNOWN', '코인 상품이 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('create_coin_order', { p_package: body.packageId });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: coinOrderOut(row), mode: paymentMode() });
    }

    if (body.action === 'coin_confirm') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data: orderRow, error: orderErr } = await userClient.from('coin_orders').select('*').eq('id', body.orderId).maybeSingle();
      if (orderErr) return jsonResponse(errorResult('UNKNOWN', '주문을 조회하지 못했습니다.'), 400);
      if (!orderRow) return jsonResponse(errorResult('ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.'), 404);
      if (orderRow.user_id !== userData.user.id) return jsonResponse(errorResult('NOT_YOUR_ORDER', '본인의 주문이 아닙니다.'), 403);
      if (orderRow.status === 'paid') return jsonResponse({ ok: true, order: coinOrderOut(orderRow) });
      if (orderRow.status !== 'pending') return jsonResponse(errorResult('ORDER_NOT_PENDING', '이미 처리된 주문입니다.'), 409);
      if (await liveBlocked(serviceClient)) return jsonResponse(errorResult('PG_VERIFICATION_FAILED', '실결제는 아직 활성화되지 않았습니다.'), 403);
      if (await sandboxForbidden(serviceClient, userData.user.id)) return jsonResponse(errorResult('PG_VERIFICATION_FAILED', '결제 서비스가 설정되지 않아 테스트 결제는 관리자만 할 수 있습니다.'), 403);
      const pgResult = await verifyWithPg(body.orderId, body.providerReceipt, orderRow.amount_krw);
      if (!pgResult.ok) {
        await serviceClient.rpc('finalize_coin_order', { p_order: body.orderId, p_status: 'failed', p_reason: pgResult.message });
        return jsonResponse(errorResult('PG_VERIFICATION_FAILED', pgResult.message), 402);
      }
      // 코인 지급은 DB 함수 안에서 원장(멱등 키 coin_order:<id>)으로 — 재시도해도 1회만 지급
      const { data, error } = await serviceClient.rpc('finalize_coin_order', { p_order: body.orderId, p_status: 'paid', p_payment_key: pgResult.paymentKey, p_is_test: paymentMode() !== 'live' });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: coinOrderOut(row) });
    }

    if (body.action === 'coin_fail') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      const { data, error } = await userClient.rpc('finalize_coin_order', { p_order: body.orderId, p_status: 'failed', p_reason: body.reason ?? null });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: coinOrderOut(row) });
    }

    if (body.action === 'coin_refund') {
      if (!body.orderId) return jsonResponse(errorResult('UNKNOWN', '주문 id가 필요합니다.'), 400);
      // 7일 이내 + 지급 코인을 쓰지 않았을 때만 (본인 또는 관리자). 판정은 DB 가 한다.
      const { data: ok, error: chkErr } = await userClient.rpc('coin_order_refundable', { p_order: body.orderId });
      if (chkErr) return jsonResponse(mapMonetizationError(chkErr.message), 400);
      if (!ok) return jsonResponse(errorResult('UNKNOWN', '환불할 수 없는 코인 주문입니다. (결제 후 7일 이내, 지급된 코인을 사용하지 않은 경우만)'), 409);
      const { data: orderRow } = await serviceClient.from('coin_orders').select('*').eq('id', body.orderId).maybeSingle();
      const cancel = await cancelWithPg(orderRow?.payment_key ?? null, (body.reason ?? '코인 구매 취소').slice(0, 150));
      if (!cancel.ok) return jsonResponse(errorResult('PG_VERIFICATION_FAILED', cancel.message), 402);
      const { data, error } = await serviceClient.rpc('finalize_coin_order', { p_order: body.orderId, p_status: 'refunded', p_reason: body.reason ?? '사용자 환불' });
      if (error) return jsonResponse(mapMonetizationError(error.message), 400);
      const row = Array.isArray(data) ? data[0] : data;
      return jsonResponse({ ok: true, order: coinOrderOut(row) });
    }

    return jsonResponse(errorResult('UNKNOWN', '알 수 없는 요청입니다.'), 400);
  } catch (e) {
    return jsonResponse(errorResult('UNKNOWN', e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.'), 500);
  }
});

function rowToOrder(row: Record<string, unknown>) {
  return {
    orderId: row.order_id ?? row.id,
    curriculumId: row.curriculum_id,
    priceKrw: row.price_krw,
    platformFeeKrw: row.platform_fee_krw,
    sellerEarningKrw: row.seller_earning_krw,
    status: row.status,
    alreadyPurchased: row.already_purchased ?? false,
    paidAt: row.paid_at ?? null,
  };
}

function mapRpcError(message: string) {
  if (message.includes('LISTING_NOT_FOUND')) return errorResult('LISTING_NOT_FOUND', '존재하지 않거나 판매가 중단된 커리큘럼입니다.');
  if (message.includes('ORDER_NOT_FOUND')) return errorResult('ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.');
  if (message.includes('NOT_YOUR_ORDER')) return errorResult('NOT_YOUR_ORDER', '본인의 주문이 아닙니다.');
  if (message.includes('ORDER_NOT_PENDING')) return errorResult('ORDER_NOT_PENDING', '이미 처리된 주문입니다.');
  if (message.includes('ORDER_NOT_REFUNDABLE')) return errorResult('UNKNOWN', '환불할 수 없는 주문 상태입니다.');
  if (message.includes('FORBIDDEN_DIRECT_PAID_TRANSITION')) return errorResult('UNAUTHORIZED', '허용되지 않은 요청입니다.');
  if (message.includes('AUTH_REQUIRED')) return errorResult('UNAUTHORIZED', '로그인이 필요합니다.');
  return errorResult('UNKNOWN', '요청을 처리하지 못했습니다.');
}
