// Supabase Edge Function — TossPayments webhook receiver for the monetization orders (0061 구독 · 0062 코인).
//
// Flow (no user JWT — deploy with --no-verify-jwt):
//   1. If a signature header is present, it must verify (TOSS_WEBHOOK_SECURITY_KEY). A bad signature → 401.
//   2. Whether signed or not, the body is NEVER trusted: the payment is re-read from Toss with
//      PAYMENT_SECRET_KEY (GET /v1/payments/{paymentKey}) and orderId / totalAmount are cross-checked
//      against OUR order row. Without PAYMENT_SECRET_KEY nothing can be verified → 503, no change.
//   3. DONE → finalize '<kind>' order 'paid' (idempotent: same payment_key twice is a no-op),
//      CANCELED → 'refunded' (coins are clawed back in the DB function). Other states are only logged.
//   4. Answer 200 within Toss's 10 s window; Toss retries anything else (up to 7 times).
// Gear and curriculum orders keep their existing confirm/refund paths (payment-verify); this endpoint
// only acknowledges them.
//
// Live keys: if PAYMENT_SECRET_KEY is a live key and monetization_config.live_payments_enabled is false
// (locked by a CHECK constraint), the webhook makes no change.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { orderKind, targetStatus, verifyTossSignature } from './verify.ts';

const ok = (body: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, message: string) => new Response(JSON.stringify({ ok: false, message }), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return fail(405, 'POST only');
  const raw = await req.text();

  const securityKey = Deno.env.get('TOSS_WEBHOOK_SECURITY_KEY');
  const sig = req.headers.get('tosspayments-webhook-signature');
  if (sig) {
    if (!securityKey) return fail(503, 'signature present but TOSS_WEBHOOK_SECURITY_KEY is not configured');
    const valid = await verifyTossSignature(raw, req.headers.get('tosspayments-webhook-transmission-time'), sig, securityKey);
    if (!valid) return fail(401, 'invalid signature');
  }

  let event: { eventType?: string; data?: { paymentKey?: string; orderId?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid json');
  }
  if (event.eventType !== 'PAYMENT_STATUS_CHANGED') return ok({ ignored: event.eventType ?? 'unknown' });
  const paymentKey = event.data?.paymentKey;
  const orderId = event.data?.orderId;
  const kind = orderKind(orderId);
  if (!paymentKey || !orderId) return ok({ ignored: 'missing paymentKey/orderId' });
  if (kind !== 'subscription' && kind !== 'coin') return ok({ ignored: kind });

  const secretKey = Deno.env.get('PAYMENT_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secretKey || !supabaseUrl || !serviceRoleKey) return fail(503, 'payment verification is not configured');
  const service = createClient(supabaseUrl, serviceRoleKey);

  const live = !secretKey.startsWith('test_');
  if (live) {
    const { data: cfg } = await service.from('monetization_config').select('live_payments_enabled').maybeSingle();
    if (!cfg?.live_payments_enabled) return ok({ ignored: 'live payments disabled' });
  }

  // Re-read the payment from Toss — the only source we trust.
  let pay: Record<string, unknown>;
  try {
    const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
      headers: { Authorization: `Basic ${btoa(`${secretKey}:`)}` },
    });
    if (!res.ok) return fail(502, `payment lookup failed (${res.status})`);
    pay = await res.json();
  } catch {
    return fail(502, 'payment lookup failed');
  }
  if (pay.orderId !== orderId || pay.paymentKey !== paymentKey) return fail(409, 'payment does not match the event');

  const table = kind === 'subscription' ? 'subscription_payments' : 'coin_orders';
  const fn = kind === 'subscription' ? 'finalize_subscription_payment' : 'finalize_coin_order';
  const { data: order } = await service.from(table).select('*').eq('id', orderId).maybeSingle();
  if (!order) return ok({ ignored: 'unknown order' });
  if (pay.totalAmount !== order.amount_krw) return fail(409, 'amount mismatch');

  const target = targetStatus(pay.status as string | undefined);
  if (!target) return ok({ noted: pay.status });
  if (target === 'paid' && order.status === 'pending') {
    const { error } = await service.rpc(fn, { p_order: orderId, p_status: 'paid', p_payment_key: paymentKey, p_is_test: !live });
    if (error) return fail(500, error.message);
  } else if (target === 'refunded' && order.status === 'paid' && order.payment_key === paymentKey) {
    const { error } = await service.rpc(fn, { p_order: orderId, p_status: 'refunded', p_reason: 'Toss 결제 취소 웹훅' });
    if (error) return fail(500, error.message);
  }
  return ok({ orderId, status: target });
});
