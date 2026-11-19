import type { Curriculum } from '../curriculum/types';
import type { PendingOrder } from './types';
import { getTossClientKey, isTossConfigured } from './tossConfig';
import { reportTossPaymentFailure, startPurchaseOrder } from './paymentService';

export type TossOrderOutcome =
  | { outcome: 'already_purchased'; curriculum: Curriculum | null }
  | { outcome: 'ready'; order: PendingOrder }
  | { outcome: 'error'; message: string };

/** Step 1 — create/reuse the pending order before ever touching the Toss SDK. Same already-purchased short-circuit as the test-payment pipeline. */
export async function beginTossOrder(curriculumId: string): Promise<TossOrderOutcome> {
  if (!isTossConfigured()) {
    return { outcome: 'error', message: '결제 기능이 아직 설정되지 않았습니다. 잠시 후 다시 시도해주세요.' };
  }
  const start = await startPurchaseOrder(curriculumId);
  if (start.status === 'failed') return { outcome: 'error', message: start.message };
  if (start.status === 'already_purchased') return { outcome: 'already_purchased', curriculum: start.curriculum };
  return { outcome: 'ready', order: start.order };
}

/**
 * Widgets, not the "API 개별 연동" payment() method — Toss client keys come
 * in two incompatible flavors (결제위젯 연동 키 vs API 개별 연동 키), and the
 * widget flavor is what's actually configured (payment() rejects it with
 * "API 개별 연동 키의 클라이언트 키로 SDK를 연동해주세요"). This still stays a
 * full-page redirect on requestPayment(), same as before — only the SDK
 * surface used to open it changes, everything after the redirect
 * (MarketplacePaymentResult.tsx, confirmTossPayment, payment-verify's
 * verifyWithPg) is untouched.
 */
export async function loadTossWidgets(customerKey: string) {
  const clientKey = getTossClientKey();
  if (!clientKey) throw new Error('결제 기능이 아직 설정되지 않았습니다.');
  const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
  const tossPayments = await loadTossPayments(clientKey);
  return tossPayments.widgets({ customerKey });
}

/**
 * The app runs on a HashRouter, so the return route must live in the hash (`…/#/marketplace/payment/result`).
 * The old value (`<origin>/marketplace/payment/result`) put the route in the path, which the HashRouter
 * never matches — after paying, Toss sent the user back to the home screen instead of the confirm page.
 */
export function hashRouteUrl(route: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `${window.location.origin}${window.location.pathname}#${route}${q ? `?${q}` : ''}`;
}

export function buildTossResultUrl(curriculumId: string): string {
  return hashRouteUrl('/marketplace/payment/result', { curriculumId });
}

/**
 * Toss appends paymentKey/orderId/amount (or code/message) to successUrl/failUrl. Depending on how it joins
 * them with a hash URL they land either in the hash query or in `location.search` — read both.
 */
export function tossReturnParams(hashParams: URLSearchParams): URLSearchParams {
  const merged = new URLSearchParams(window.location.search);
  hashParams.forEach((v, k) => merged.set(k, v));
  return merged;
}

/** requestPayment() itself rejected before any redirect happened (e.g. the user closed the widget's checkout overlay, or a validation error) — mark the order failed server-side so it never lingers as 'pending'. */
export async function reportTossWidgetFailure(orderId: string, e: unknown): Promise<string> {
  const reason = e instanceof Error ? e.message : '결제창을 여는 중 오류가 발생했습니다.';
  await reportTossPaymentFailure(orderId, reason);
  return reason;
}
