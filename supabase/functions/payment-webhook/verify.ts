// Pure helpers for payment-webhook (no Deno APIs — also run under Node in .devtools/test-payment-webhook.mjs).
//
// TossPayments webhook headers (docs.tosspayments.com/reference/using-api/webhook-events, checked 2026-11-16):
//   tosspayments-webhook-signature: "v1:<base64>[,v1:<base64>...]"
//   tosspayments-webhook-transmission-time
// signature = HMAC-SHA256("{raw body}:{transmission-time}", 보안 키). Any one matching value is valid.
// The docs do not say whether PAYMENT_STATUS_CHANGED carries a signature, so the function never trusts the
// body alone: it always re-reads the payment from Toss with the secret key before changing anything.

const enc = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyTossSignature(rawBody: string, transmissionTime: string | null, signatureHeader: string | null, securityKey: string): Promise<boolean> {
  if (!transmissionTime || !signatureHeader || !securityKey) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(securityKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${rawBody}:${transmissionTime}`)));
  return signatureHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('v1:'))
    .some((s) => {
      const got = b64ToBytes(s.slice(3));
      return !!got && sameBytes(got, mac);
    });
}

export type WebhookOrderKind = 'subscription' | 'coin' | 'gear' | 'curriculum' | 'unknown';

/** Our order ids carry their kind as a prefix (sub_ / coin_ / gear_); curriculum orders are uuids. */
export function orderKind(orderId: string | undefined | null): WebhookOrderKind {
  if (!orderId) return 'unknown';
  if (orderId.startsWith('sub_')) return 'subscription';
  if (orderId.startsWith('coin_')) return 'coin';
  if (orderId.startsWith('gear_')) return 'gear';
  if (/^[0-9a-f-]{36}$/i.test(orderId)) return 'curriculum';
  return 'unknown';
}

/** Which of our order states a verified Toss status maps to. Anything else is ignored (acknowledged, no change). */
export function targetStatus(tossStatus: string | undefined): 'paid' | 'refunded' | null {
  if (tossStatus === 'DONE') return 'paid';
  if (tossStatus === 'CANCELED') return 'refunded';
  return null; // PARTIAL_CANCELED, WAITING_FOR_DEPOSIT, EXPIRED ... → admin review, never automatic
}
