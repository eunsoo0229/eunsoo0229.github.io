// 수익화 클라이언트 (0061–0064). 판단은 모두 서버가 한다 — 여기는 RPC·조회 래퍼와 표시용 변환뿐.
// 잔액·권한·가격·수수료를 클라이언트에서 계산하거나 쓰지 않는다.
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { NOT_CONFIGURED, callRpc, run, serverMessage } from '../ecosystem/common';
import { callPaymentVerify } from '../payments/paymentService';

// ---------------- 공통 ----------------
const MESSAGES: [RegExp, string][] = [
  [/INSUFFICIENT_COINS/, '코인이 부족합니다. 코인 스토어에서 충전해 주세요.'],
  [/PRODUCT_UNAVAILABLE/, '지금은 구매할 수 없는 콘텐츠입니다.'],
  [/OWN_PRODUCT/, '내 콘텐츠는 구매할 수 없습니다.'],
  [/CREATOR_PROFILE_REQUIRED/, '먼저 창작자 프로필을 등록해 주세요.'],
  [/CREATOR_NOT_APPROVED_OR_RIGHTS|CREATOR_NOT_APPROVED/, '창작자 승인과 저작권 확인이 필요합니다.'],
  [/RIGHTS_NOT_CONFIRMED/, '저작권 확인(직접 제작했거나 사용 권리가 있음)에 동의해야 검수를 요청할 수 있습니다.'],
  [/REVIEW_REQUIRED/, '수정된 콘텐츠는 다시 검수를 받아야 판매를 재개할 수 있습니다.'],
  [/HAS_PURCHASES_UNLIST_INSTEAD/, '구매자가 있는 콘텐츠는 삭제할 수 없습니다. 판매 중지를 이용하세요.'],
  [/PRODUCT_SUSPENDED/, '운영 정책으로 판매 중지된 콘텐츠는 수정할 수 없습니다.'],
  [/NOT_YOUR_PRODUCT/, '내 콘텐츠가 아닙니다.'],
  [/REFUND_WINDOW_CLOSED/, '환불 요청 기간이 지났습니다.'],
  [/NOT_REFUNDABLE/, '환불할 수 없는 구매입니다.'],
  [/REASON_REQUIRED/, '사유를 입력해 주세요.'],
  [/BELOW_SETTLEMENT_MINIMUM/, '정산 가능 금액이 최소 정산 금액보다 적습니다.'],
  [/SETTLEMENT_IN_PROGRESS/, '이미 진행 중인 정산 요청이 있습니다.'],
  [/MINOR_GUARDIAN_REQUIRED/, '미성년 창작자는 보호자 동의·계약 확인 전 정산할 수 없습니다.'],
  [/NOT_APPROVED/, '먼저 승인된 정산만 지급 완료 처리할 수 있습니다.'],
  [/BUSINESS_PLAN_REQUIRED/, '사업자 요금제를 구독한 체육관에서 쓸 수 있는 기능입니다.'],
  [/NOT_GYM_STAFF/, '이 체육관의 관장·지도자만 볼 수 있습니다.'],
  [/NOT_GYM_OWNER/, '사업자 요금제는 체육관 관장만 구독할 수 있습니다.'],
  [/SUBSCRIPTION_NOT_ACTIVE/, '진행 중인 구독이 아닙니다.'],
  [/NOT_YOUR_SUBSCRIPTION/, '내 구독이 아닙니다.'],
  [/REWARD_DISABLED/, '지금은 출석 보상이 꺼져 있습니다.'],
  [/LOCKED_BY_POLICY/, '실결제·현금 지급 설정은 정책상 잠겨 있습니다 (법률·결제사 검토 후 별도 반영).'],
  [/FREE_PLAN_MUST_BE_FREE/, 'FREE 요금제는 무료여야 합니다.'],
  [/INVALID_AMOUNT/, '금액이 올바르지 않습니다.'],
  [/CAMPAIGN_REQUIRED/, '캠페인 이름이 필요합니다.'],
  [/DISPUTE_WINDOW_CLOSED/, '분쟁 신고 기간(수령 후 14일)이 지났습니다.'],
  [/ORDER_NOT_DISPUTABLE/, '결제 완료 이후의 주문만 분쟁을 신고할 수 있습니다.'],
  [/duplicate key value.*gear_order_disputes/, '이미 처리 중인 분쟁이 있습니다.'],
  [/FORBIDDEN/, '권한이 없습니다.'],
];
function msg(e: unknown): string {
  const raw = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  for (const [re, ko] of MESSAGES) if (re.test(raw)) return ko;
  return serverMessage(e);
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<AuthResult<T>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, message: msg(error) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}
/** setof-returning RPC → its single row */
async function first<T>(p: Promise<AuthResult<T[] | T>>): Promise<AuthResult<T>> {
  const r = await p;
  return r.ok ? { ok: true, data: (Array.isArray(r.data) ? r.data[0] : r.data) as T } : r;
}

export function formatCoins(n: number | string | null | undefined): string {
  return `${Number(n ?? 0).toLocaleString('ko-KR')}`;
}

// ---------------- 설정 · 멤버십 ----------------
export interface MonetizationConfig {
  coin_name: string;
  coin_symbol: string;
  default_commission_bp: number;
  gear_fee_bp: number;
  coin_krw_rate: number;
  earnings_hold_days: number;
  settlement_min_coins: number;
  daily_checkin_coins: number;
  past_due_grace_days: number;
  content_refund_days: number;
  free_gemini_daily_uses: number;
  gemini_use_window_seconds: number;
  gemini_calls_per_use: number;
  live_payments_enabled: boolean;
  cash_payout_enabled: boolean;
  minor_paid_enabled: boolean;
}
export const getConfig = () => run<MonetizationConfig>(() => supabase!.from('monetization_config').select('*').maybeSingle());

export interface MembershipPlan {
  id: string;
  audience: 'personal' | 'business';
  name: string;
  tagline: string;
  tier: number;
  features: string[];
  price_monthly_krw: number;
  price_yearly_krw: number;
  active: boolean;
  sort: number;
}
export const listPlans = () => run<MembershipPlan[]>(() => supabase!.from('membership_plans').select('*').order('sort'));

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  cycle: 'monthly' | 'yearly';
  gym_id: string | null;
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  ended_reason: string | null;
  is_test: boolean;
  created_at: string;
}
export interface MyMembership {
  plan_id: string;
  privileged: boolean;
  is_admin: boolean;
  features: string[];
  subscription: Subscription | null;
}
export const getMyMembership = () => rpc<MyMembership>('my_membership');
export const hasEntitlement = (userId: string, feature: string) => rpc<boolean>('has_entitlement', { p_user: userId, p_feature: feature });

export const listMySubscriptions = (userId: string) =>
  run<Subscription[]>(() => supabase!.from('user_subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }));
export const listGymSubscriptions = (gymId: string) =>
  run<Subscription[]>(() => supabase!.from('user_subscriptions').select('*').eq('gym_id', gymId).order('created_at', { ascending: false }));

export interface SubscriptionPayment {
  id: string;
  plan_id: string;
  cycle: 'monthly' | 'yearly';
  gym_id: string | null;
  kind: 'new' | 'renewal' | 'change';
  amount_krw: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  payment_key: string | null;
  is_test: boolean;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
}
export const listMySubscriptionPayments = (userId: string) =>
  run<SubscriptionPayment[]>(() => supabase!.from('subscription_payments').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50));
export const setSubscriptionCancel = (subId: string, cancel: boolean) => first(rpc<Subscription[]>('set_subscription_cancel', { p_sub: subId, p_cancel: cancel }));

// ---------------- 결제 (payment-verify: sub_* / coin_*) ----------------
export interface CheckoutOrder {
  orderId: string;
  amountKrw: number;
  status: string;
  isTest: boolean;
  // 구독
  planId?: string;
  cycle?: 'monthly' | 'yearly';
  gymId?: string | null;
  kind?: 'new' | 'renewal' | 'change';
  // 코인
  packageId?: string;
  coins?: number;
  bonusCoins?: number;
}
export type CheckoutKind = 'subscription' | 'coin';
export const createSubscriptionCheckout = (planId: string, cycle: 'monthly' | 'yearly', gymId: string | null = null) =>
  callPaymentVerify<CheckoutOrder>('sub_create', { planId, cycle, gymId });
export const createCoinCheckout = (packageId: string) => callPaymentVerify<CheckoutOrder>('coin_create', { packageId });
export const confirmCheckout = (kind: CheckoutKind, orderId: string, paymentKey?: string | null) =>
  callPaymentVerify<CheckoutOrder>(kind === 'subscription' ? 'sub_confirm' : 'coin_confirm', { orderId, providerReceipt: paymentKey ?? undefined });
export const failCheckout = (kind: CheckoutKind, orderId: string, reason: string) =>
  callPaymentVerify<CheckoutOrder>(kind === 'subscription' ? 'sub_fail' : 'coin_fail', { orderId, reason });
export const refundCoinOrder = (orderId: string, reason: string) => callPaymentVerify<CheckoutOrder>('coin_refund', { orderId, reason });
export function checkoutKindOf(orderId: string): CheckoutKind | null {
  return orderId.startsWith('sub_') ? 'subscription' : orderId.startsWith('coin_') ? 'coin' : null;
}

// ---------------- 지갑 ----------------
export interface Wallet {
  user_id: string;
  balance: number;
  purchased_total: number;
  earned_total: number;
  spent_total: number;
  refunded_total: number;
  clawback_total: number;
}
export type LedgerType = 'coin_purchase' | 'event_reward' | 'promo_grant' | 'activity_reward' | 'content_purchase' | 'creator_earning' | 'refund' | 'clawback' | 'admin_adjustment' | 'test';
export interface LedgerEntry {
  id: string;
  seq: number;
  user_id: string;
  entry_type: LedgerType;
  amount: number;
  balance_before: number;
  balance_after: number;
  ref_type: string | null;
  ref_id: string | null;
  note: string;
  created_at: string;
}
export const LEDGER_LABEL: Record<LedgerType, string> = {
  coin_purchase: '코인 구매',
  event_reward: '이벤트 지급',
  promo_grant: '프로모션 지급',
  activity_reward: '활동 보상',
  content_purchase: '콘텐츠 구매',
  creator_earning: '판매 수익 전환',
  refund: '환불',
  clawback: '회수',
  admin_adjustment: '관리자 보정',
  test: '테스트',
};
export const getMyWallet = (userId: string) => run<Wallet | null>(() => supabase!.from('wallets').select('*').eq('user_id', userId).maybeSingle());
export const listMyLedger = (userId: string, limit = 50, beforeSeq?: number) =>
  run<LedgerEntry[]>(() => {
    let q = supabase!.from('wallet_ledger').select('*').eq('user_id', userId).order('seq', { ascending: false }).limit(limit);
    if (beforeSeq) q = q.lt('seq', beforeSeq);
    return q;
  });
export interface CoinPackage {
  id: string;
  name: string;
  coins: number;
  bonus_coins: number;
  price_krw: number;
  active: boolean;
  sort: number;
}
export const listCoinPackages = () => run<CoinPackage[]>(() => supabase!.from('coin_packages').select('*').order('sort'));
export interface CoinOrder {
  id: string;
  package_id: string;
  coins: number;
  bonus_coins: number;
  amount_krw: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  is_test: boolean;
  failure_reason: string | null;
  refund_shortfall: number;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
}
export const listMyCoinOrders = (userId: string) =>
  run<CoinOrder[]>(() => supabase!.from('coin_orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50));
export const claimDailyCheckin = () => rpc<LedgerEntry>('claim_daily_checkin');

// ---------------- 콘텐츠 마켓 ----------------
export type ProductType = 'curriculum' | 'course' | 'lecture' | 'technique_guide' | 'training_program' | 'tactics' | 'video_lecture' | 'document' | 'other';
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  curriculum: '맞춤 커리큘럼',
  course: '종목별 학습 코스',
  lecture: '기술 강의',
  technique_guide: '단계별 기술 자료',
  training_program: '훈련 프로그램',
  tactics: '콤보·전술 자료',
  video_lecture: '영상 강의',
  document: 'PDF·문서 자료',
  other: '기타',
};
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'all';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { beginner: '입문', intermediate: '중급', advanced: '상급', all: '전체' };
export type ProductStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended' | 'unlisted';
export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: '초안',
  pending_review: '검수 대기',
  approved: '판매 중',
  rejected: '반려',
  suspended: '운영 중지',
  unlisted: '판매 중지',
};
export interface ContentSection {
  title: string;
  text: string;
  technique_ids?: string[];
  video_url?: string;
}
export interface CreatorProduct {
  id: string;
  creator_id: string;
  product_type: ProductType;
  title: string;
  summary: string;
  description: string;
  target_audience: string;
  martial_art: string | null;
  difficulty: Difficulty;
  est_minutes: number | null;
  price_coins: number;
  pro_included: boolean;
  thumbnail_url: string | null;
  outline: string[];
  preview: { text?: string };
  technique_ids: string[];
  rights_confirmed: boolean;
  status: ProductStatus;
  review_note: string | null;
  version: number;
  approved_version: number | null;
  sales_count: number;
  rating_avg: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
}
export interface ProductContent {
  sections?: ContentSection[];
  files?: { name: string; url: string }[];
}
export const listApprovedProducts = (filters: { type?: string; art?: string; q?: string } = {}) =>
  run<CreatorProduct[]>(() => {
    let q = supabase!.from('creator_products').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(60);
    if (filters.type) q = q.eq('product_type', filters.type);
    if (filters.art) q = q.eq('martial_art', filters.art);
    if (filters.q) q = q.ilike('title', `%${filters.q}%`);
    return q;
  });
export const getProduct = (id: string) => run<CreatorProduct | null>(() => supabase!.from('creator_products').select('*').eq('id', id).maybeSingle());
/** null = 열람 권한 없음 (RLS) */
export const getProductContent = (id: string) =>
  run<{ body: ProductContent } | null>(() => supabase!.from('creator_product_content').select('body').eq('product_id', id).maybeSingle());
export interface ContentPurchase {
  id: string;
  product_id: string;
  buyer_id: string;
  creator_id: string;
  price_coins: number;
  commission_bp: number;
  platform_fee_coins: number;
  creator_earning_coins: number;
  product_version: number;
  privileged_comp: boolean;
  status: 'completed' | 'refunded';
  refund_status: 'none' | 'requested' | 'approved' | 'rejected';
  refund_reason: string | null;
  created_at: string;
  refunded_at: string | null;
}
export const purchaseProduct = (id: string) => first(rpc<ContentPurchase[]>('purchase_product', { p_product: id }));
export const getMyPurchaseOf = (productId: string, userId: string) =>
  run<ContentPurchase | null>(() => supabase!.from('content_purchases').select('*').eq('product_id', productId).eq('buyer_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle());
export const listMyLibrary = (userId: string) =>
  run<ContentPurchase[]>(() => supabase!.from('content_purchases').select('*').eq('buyer_id', userId).order('created_at', { ascending: false }));
export const getProductsByIds = (ids: string[]) =>
  ids.length ? run<CreatorProduct[]>(() => supabase!.from('creator_products').select('*').in('id', ids)) : Promise.resolve({ ok: true as const, data: [] as CreatorProduct[] });
export const requestContentRefund = (purchaseId: string, reason: string) => first(rpc<ContentPurchase[]>('request_content_refund', { p_purchase: purchaseId, p_reason: reason }));
export interface ProductReview {
  product_id: string;
  user_id: string;
  rating: number;
  body: string;
  created_at: string;
}
export const listReviews = (productId: string) =>
  run<ProductReview[]>(() => supabase!.from('product_reviews').select('*').eq('product_id', productId).order('created_at', { ascending: false }).limit(50));
export const addReview = (productId: string, userId: string, rating: number, body: string) =>
  run<null>(() => supabase!.from('product_reviews').insert({ product_id: productId, user_id: userId, rating, body }));
export type ReportReason = 'copyright' | 'unauthorized_media' | 'false_credentials' | 'inappropriate' | 'fraud' | 'other';
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  copyright: '저작권 침해',
  unauthorized_media: '타인 영상·이미지 무단 사용',
  false_credentials: '허위 자격·경력',
  inappropriate: '부적절한 내용',
  fraud: '사기·허위 상품',
  other: '기타',
};
export const reportContent = (target: { productId?: string; creatorId?: string }, reporterId: string, reason: ReportReason, detail: string) =>
  run<null>(() => supabase!.from('content_reports').insert({ product_id: target.productId ?? null, creator_id: target.creatorId ?? null, reporter_id: reporterId, reason, detail }));

// ---------------- 창작자 ----------------
export interface Credential {
  title: string;
  issuer?: string;
  year?: string;
  verified?: boolean;
}
export interface CreatorProfile {
  user_id: string;
  display_name: string;
  bio: string;
  specialties: string[];
  years_training: number | null;
  avatar_url: string | null;
  credentials: Credential[];
  verified_credentials: Credential[];
  is_minor: boolean;
  guardian_consent: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'restricted';
  commission_bp_override: number | null;
  review_note: string | null;
  created_at: string;
}
export const CREATOR_STATUS_LABEL: Record<CreatorProfile['status'], string> = { pending: '검토 대기', approved: '승인', rejected: '반려', restricted: '활동 제한' };
export const getCreatorProfile = (userId: string) => run<CreatorProfile | null>(() => supabase!.from('creator_profiles').select('*').eq('user_id', userId).maybeSingle());
export const saveMyCreatorProfile = (p: Partial<CreatorProfile>) => first(rpc<CreatorProfile[]>('upsert_my_creator_profile', { p }));
export const listMyProducts = (userId: string) =>
  run<CreatorProduct[]>(() => supabase!.from('creator_products').select('*').eq('creator_id', userId).order('updated_at', { ascending: false }));
export const listCreatorPublicProducts = (userId: string) =>
  run<CreatorProduct[]>(() => supabase!.from('creator_products').select('*').eq('creator_id', userId).eq('status', 'approved').order('created_at', { ascending: false }));
export const saveProduct = (p: Record<string, unknown>) => first(rpc<CreatorProduct[]>('save_creator_product', { p }));
export const submitProduct = (id: string) => first(rpc<CreatorProduct[]>('submit_product_for_review', { p_product: id }));
export const setProductOnSale = (id: string, onSale: boolean) => first(rpc<CreatorProduct[]>('set_product_on_sale', { p_product: id, p_on_sale: onSale }));
export const deleteProduct = (id: string) => rpc<null>('delete_creator_product', { p_product: id });
export interface CreatorSummary {
  gross_coins: number;
  sales_count: number;
  platform_fee_coins: number;
  refunded_coins: number;
  held_coins: number;
  available_coins: number;
  in_settlement_coins: number;
  settled_coins: number;
  converted_coins: number;
  coin_krw_rate: number;
  settlement_min_coins: number;
  cash_payout_enabled: boolean;
}
export const getMyCreatorSummary = () => rpc<CreatorSummary>('my_creator_summary');
export const listMySales = (userId: string) =>
  run<ContentPurchase[]>(() => supabase!.from('content_purchases').select('*').eq('creator_id', userId).order('created_at', { ascending: false }).limit(200));
export interface Settlement {
  id: string;
  creator_id: string;
  amount_coins: number;
  coin_krw_rate: number;
  amount_krw_estimate: number;
  mode: 'simulation';
  status: 'requested' | 'approved' | 'rejected' | 'paid_simulated' | 'on_hold';
  hold_reason: string | null;
  reject_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
  paid_simulated_at: string | null;
}
export const SETTLEMENT_STATUS_LABEL: Record<Settlement['status'], string> = {
  requested: '요청됨',
  approved: '승인',
  rejected: '거절',
  paid_simulated: '지급 완료 (시뮬레이션)',
  on_hold: '보류',
};
export const listMySettlements = (userId: string) =>
  run<Settlement[]>(() => supabase!.from('settlement_requests').select('*').eq('creator_id', userId).order('requested_at', { ascending: false }));
export const requestSettlement = () => first(rpc<Settlement[]>('request_settlement'));
export const convertEarningsToCoins = () => rpc<number>('convert_earnings_to_coins');

// ---------------- 사업자 ----------------
export interface OwnedGym {
  id: string;
  name: string;
}
export const listMyOwnedGyms = (userId: string) => run<OwnedGym[]>(() => supabase!.from('gyms').select('id, name').eq('owner_user_id', userId).order('name'));
export const getGymBusinessReport = (gymId: string) => rpc<Record<string, number | string | null>>('gym_business_report', { p_gym: gymId });

// ---------------- 제휴 ----------------
export interface PartnerCampaign {
  id: string;
  partner_name: string;
  kind: 'brand' | 'gym_promo' | 'content' | 'official_promo' | 'product';
  label: '광고' | '제휴' | '프로모션';
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  placement: 'home' | 'gear' | 'content' | 'learning';
  starts_at: string;
  ends_at: string | null;
  status: 'draft' | 'approved' | 'paused' | 'ended';
  impressions: number;
  clicks: number;
}
export const listCampaigns = (placement: PartnerCampaign['placement']) =>
  run<PartnerCampaign[]>(() => supabase!.from('partner_campaigns').select('*').eq('placement', placement).eq('status', 'approved').limit(3));
export const recordCampaignEvent = (id: string, event: 'impression' | 'click') => rpc<null>('record_campaign_event', { p_campaign: id, p_event: event });

// ---------------- 장비 마켓 분쟁 ----------------
export type GearDisputeReason = 'not_received' | 'not_as_described' | 'damaged' | 'seller_unresponsive' | 'buyer_unresponsive' | 'other';
export const GEAR_DISPUTE_LABEL: Record<GearDisputeReason, string> = {
  not_received: '물품 미수령',
  not_as_described: '설명과 다름',
  damaged: '파손',
  seller_unresponsive: '판매자 연락 두절',
  buyer_unresponsive: '구매자 연락 두절',
  other: '기타',
};
export interface GearDispute {
  id: string;
  order_id: string;
  opened_by: string;
  reason: GearDisputeReason;
  detail: string;
  status: 'open' | 'resolved_refund' | 'resolved_no_refund' | 'withdrawn';
  resolution_note: string | null;
  created_at: string;
}
export const openGearDispute = (orderId: string, reason: GearDisputeReason, detail: string) => first(rpc<GearDispute[]>('open_gear_dispute', { p_order: orderId, p_reason: reason, p_detail: detail }));
export const listDisputesForOrders = (orderIds: string[]) =>
  orderIds.length ? run<GearDispute[]>(() => supabase!.from('gear_order_disputes').select('*').in('order_id', orderIds)) : Promise.resolve({ ok: true as const, data: [] as GearDispute[] });

// ---------------- 관리자 ----------------
export const admin = {
  overview: (from: string, to: string) => rpc<Record<string, Record<string, number | boolean> | boolean>>('admin_revenue_overview', { p_from: from, p_to: to }),
  updateConfig: (p: Partial<MonetizationConfig>) => first(rpc<MonetizationConfig[]>('admin_update_monetization_config', { p })),
  upsertPlan: (p: Partial<MembershipPlan>) => first(rpc<MembershipPlan[]>('admin_upsert_plan', { p })),
  upsertCoinPackage: (p: Partial<CoinPackage>) => first(rpc<CoinPackage[]>('admin_upsert_coin_package', { p })),
  expireSubscriptions: () => rpc<number>('expire_due_subscriptions'),
  listSubscriptions: () => run<Subscription[]>(() => supabase!.from('user_subscriptions').select('*').order('created_at', { ascending: false }).limit(100)),
  listCreators: (status?: CreatorProfile['status']) =>
    run<CreatorProfile[]>(() => {
      let q = supabase!.from('creator_profiles').select('*').order('created_at', { ascending: false }).limit(100);
      if (status) q = q.eq('status', status);
      return q;
    }),
  reviewCreator: (userId: string, decision: CreatorProfile['status'], note: string | null, commissionBp: number | null, verified: Credential[] | null) =>
    first(rpc<CreatorProfile[]>('admin_review_creator', { p_user: userId, p_decision: decision, p_note: note, p_commission_bp: commissionBp, p_verified: verified })),
  listProducts: (status?: ProductStatus) =>
    run<CreatorProduct[]>(() => {
      let q = supabase!.from('creator_products').select('*').order('updated_at', { ascending: false }).limit(100);
      if (status) q = q.eq('status', status);
      return q;
    }),
  reviewProduct: (id: string, decision: 'approved' | 'rejected' | 'suspended', note: string | null, refundBuyers = false) =>
    first(rpc<CreatorProduct[]>('admin_review_product', { p_product: id, p_decision: decision, p_note: note, p_refund_buyers: refundBuyers })),
  listRefundRequests: () => run<ContentPurchase[]>(() => supabase!.from('content_purchases').select('*').eq('refund_status', 'requested').order('created_at')),
  resolveRefund: (purchaseId: string, approve: boolean, note: string | null) => first(rpc<ContentPurchase[]>('admin_resolve_content_refund', { p_purchase: purchaseId, p_approve: approve, p_note: note })),
  listSettlements: () => run<Settlement[]>(() => supabase!.from('settlement_requests').select('*').order('requested_at', { ascending: false }).limit(100)),
  decideSettlement: (id: string, decision: 'approved' | 'rejected' | 'paid_simulated' | 'on_hold', reason: string | null) =>
    first(rpc<Settlement[]>('admin_decide_settlement', { p_settlement: id, p_decision: decision, p_reason: reason })),
  listReports: () =>
    run<{ id: string; product_id: string | null; creator_id: string | null; reporter_id: string; reason: ReportReason; detail: string; status: string; created_at: string }[]>(() =>
      supabase!.from('content_reports').select('*').order('created_at', { ascending: false }).limit(100)),
  resolveReport: (id: string, status: 'dismissed' | 'actioned', note: string | null) => rpc<unknown>('admin_resolve_content_report', { p_report: id, p_status: status, p_note: note }),
  integrity: () => rpc<{ check_name: string; user_id: string | null; ref: string | null; detail: string }[]>('wallet_integrity_report'),
  grantCoins: (userId: string, amount: number, type: 'event_reward' | 'promo_grant', campaign: string, key: string) =>
    rpc<LedgerEntry>('admin_grant_coins', { p_user: userId, p_amount: amount, p_type: type, p_campaign: campaign, p_key: key }),
  adjustWallet: (userId: string, amount: number, reason: string) => rpc<LedgerEntry>('admin_adjust_wallet', { p_user: userId, p_amount: amount, p_reason: reason }),
  listCommissionRules: () =>
    run<{ id: string; scope: string; scope_key: string; commission_bp: number; starts_at: string; ends_at: string | null; active: boolean; note: string }[]>(() =>
      supabase!.from('commission_rules').select('*').order('created_at', { ascending: false })),
  saveCommissionRule: (p: Record<string, unknown>) => rpc<unknown>('admin_save_commission_rule', { p }),
  listCampaigns: () => run<PartnerCampaign[]>(() => supabase!.from('partner_campaigns').select('*').order('created_at', { ascending: false })),
  saveCampaign: (p: Record<string, unknown>) => first(rpc<PartnerCampaign[]>('admin_save_partner_campaign', { p })),
  listGearDisputes: () => run<GearDispute[]>(() => supabase!.from('gear_order_disputes').select('*').order('created_at', { ascending: false }).limit(100)),
  resolveGearDispute: (id: string, status: 'resolved_refund' | 'resolved_no_refund' | 'withdrawn', note: string) => first(rpc<GearDispute[]>('admin_resolve_gear_dispute', { p_dispute: id, p_status: status, p_note: note })),
  findUserByHandle: (handle: string) => {
    // only name characters reach the PostgREST or() filter (a comma/paren would change the filter itself)
    const h = handle.replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 40);
    if (!h) return Promise.resolve({ ok: true as const, data: [] as { user_id: string; nickname: string; handle: string | null }[] });
    return run<{ user_id: string; nickname: string; handle: string | null }[]>(() => supabase!.from('profiles').select('user_id, nickname, handle').or(`handle.ilike.${h},nickname.ilike.${h}`).limit(5));
  },
};

export { callRpc };
