// 장비 택배 거래 결제 (0059) — 기존 TossPayments 연동(payment-verify Edge Function)을 그대로 쓴다.
// 금액은 서버가 상품 가격 + 배송비로 계산하고, 'paid' 확정은 Edge Function 이 Toss 승인 API 로 확인한 뒤에만 한다.
// 이 파일은 요청을 보내고 결과를 표시용으로 바꾸기만 한다.
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { callPaymentVerify } from '../payments/paymentService';
import { callRpc, run } from '../ecosystem/common';

export type GearOrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'failed' | 'refunded';

export const ORDER_STATUS_LABEL: Record<GearOrderStatus, string> = {
  pending: '결제 대기',
  paid: '결제 완료 · 발송 대기',
  shipped: '발송됨',
  delivered: '거래 완료',
  cancelled: '취소됨',
  failed: '결제 실패',
  refunded: '결제 취소(환불)',
};

export interface ShippingInfo {
  name: string;
  phone: string;
  address: string;
  memo: string;
}

/** Edge Function 응답 (결제창에 넘길 최소 정보) */
export interface GearCheckoutOrder {
  orderId: string;
  listingId: string;
  itemTitle: string;
  itemPrice: number;
  shippingFee: number;
  amount: number;
  status: GearOrderStatus;
}

export interface GearOrder extends GearCheckoutOrder {
  buyerId: string;
  sellerId: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  deliveryMemo: string;
  courier: string | null;
  trackingNumber: string | null;
  statusReason: string | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  refundedAt: string | null;
}

function mapOrder(r: Record<string, unknown>): GearOrder {
  return {
    orderId: r.id as string,
    listingId: r.listing_id as string,
    itemTitle: r.item_title as string,
    itemPrice: Number(r.item_price),
    shippingFee: Number(r.shipping_fee),
    amount: Number(r.amount),
    status: r.status as GearOrderStatus,
    buyerId: r.buyer_id as string,
    sellerId: r.seller_id as string,
    recipientName: r.recipient_name as string,
    recipientPhone: r.recipient_phone as string,
    address: r.address as string,
    deliveryMemo: (r.delivery_memo as string) ?? '',
    courier: (r.courier as string | null) ?? null,
    trackingNumber: (r.tracking_number as string | null) ?? null,
    statusReason: (r.status_reason as string | null) ?? null,
    createdAt: r.created_at as string,
    paidAt: (r.paid_at as string | null) ?? null,
    shippedAt: (r.shipped_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    refundedAt: (r.refunded_at as string | null) ?? null,
  };
}

export function validateShipping(s: ShippingInfo): string | null {
  if (!s.name.trim()) return '받는 분 이름을 입력해 주세요.';
  if (!/^[0-9+\- ]{8,20}$/.test(s.phone.trim())) return '연락처를 숫자로 입력해 주세요 (예: 010-1234-5678).';
  if (s.address.trim().length < 5) return '배송 주소를 입력해 주세요.';
  return null;
}

export async function createGearOrder(listingId: string, shipping: ShippingInfo): Promise<AuthResult<GearCheckoutOrder>> {
  const invalid = validateShipping(shipping);
  if (invalid) return { ok: false, message: invalid };
  return callPaymentVerify<GearCheckoutOrder>('gear_create', { listingId, shipping });
}

/** Toss 가 successUrl 로 돌려준 paymentKey 를 서버에 넘긴다. 승인 판단은 서버(Toss 승인 API)가 한다. */
export const confirmGearPayment = (orderId: string, paymentKey: string) => callPaymentVerify<GearCheckoutOrder>('gear_confirm', { orderId, providerReceipt: paymentKey });
export const failGearPayment = (orderId: string, reason: string) => callPaymentVerify<GearCheckoutOrder>('gear_fail', { orderId, reason });
/** 발송 전 결제 취소 (구매자·판매자). 서버가 Toss 결제 취소 API 를 부른 뒤 환불 처리한다. */
export const refundGearOrder = (orderId: string, reason: string) => callPaymentVerify<GearCheckoutOrder>('gear_refund', { orderId, reason });

export const markShipped = (orderId: string, courier: string, tracking: string) => callRpc<void>('mark_gear_order_shipped', { p_order: orderId, p_courier: courier, p_tracking: tracking });
export const confirmReceived = (orderId: string) => callRpc<void>('confirm_gear_order_received', { p_order: orderId });

export async function listMyOrders(userId: string, role: 'buyer' | 'seller'): Promise<AuthResult<GearOrder[]>> {
  const r = await run<Record<string, unknown>[]>(() =>
    supabase!
      .from('gear_orders')
      .select('*')
      .eq(role === 'buyer' ? 'buyer_id' : 'seller_id', userId)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200),
  );
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapOrder) } : r;
}

export async function getOrder(orderId: string): Promise<AuthResult<GearOrder | null>> {
  const r = await run<Record<string, unknown> | null>(() => supabase!.from('gear_orders').select('*').eq('id', orderId).maybeSingle());
  return r.ok ? { ok: true, data: r.data ? mapOrder(r.data) : null } : r;
}

/** 이 상품에 대한 내(구매자 또는 판매자) 결제 진행 주문 */
export async function activeOrderForListing(listingId: string): Promise<GearOrder | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from('gear_orders').select('*').eq('listing_id', listingId).in('status', ['paid', 'shipped', 'delivered']).maybeSingle();
    return data ? mapOrder(data) : null;
  } catch {
    return null;
  }
}

export const COURIERS = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', '경동택배', 'CU 편의점택배', 'GS25 반값택배', '기타'];
