// 체육관 검색 · 가격 비교 · 제휴 할인 · 쿠폰 (0058).
// 실제 업체·가격 데이터는 코드에 하나도 없다 — 체육관 관리자가 등록하고 플랫폼 관리자가 승인·검증한다.
// 할인가는 서버(gym_offer_prices)가 검증된 원래 가격으로 계산하며, 이 파일은 그 값을 표시만 한다.
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { callRpc, run, uploadImage } from '../ecosystem/common';

export const GYM_ARTS = {
  mma: 'MMA',
  boxing: '복싱',
  kickboxing: '킥복싱',
  muay_thai: '무에타이',
  bjj: '주짓수',
  wrestling: '레슬링',
  judo: '유도',
  taekwondo: '태권도',
  karate: '가라테',
  sambo: '삼보',
  mixed: '종합 무술',
} as const;
export type GymArt = keyof typeof GYM_ARTS;

export const PLAN_LABEL = {
  monthly: '월 회비',
  three_month: '3개월',
  six_month: '6개월',
  yearly: '연간',
  initiation_fee: '입회비',
  registration_fee: '등록비',
  trial_price: '체험 수업',
} as const;
export type OfferPlan = keyof typeof PLAN_LABEL;

export interface InstructorInfo {
  name: string;
  title: string;
  career: string;
}
export interface ScheduleItem {
  day: string;
  time: string;
  className: string;
}

export interface GymListing {
  id: string;
  ownerUserId: string;
  gymId: string | null;
  name: string;
  arts: GymArt[];
  description: string;
  coverImageUrl: string | null;
  address: string;
  region: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  website: string;
  sns: Record<string, string>;
  hours: string;
  facilities: string[];
  instructors: InstructorInfo[];
  schedule: ScheduleItem[];
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GymPricing {
  listingId: string;
  monthly: number | null;
  threeMonth: number | null;
  sixMonth: number | null;
  yearly: number | null;
  initiationFee: number | null;
  registrationFee: number | null;
  gearCost: number | null;
  sessionsPerWeek: number | null;
  minutesPerSession: number | null;
  openMat: boolean | null;
  multiArt: boolean | null;
  trialAvailable: boolean | null;
  trialPrice: number | null;
  notes: string;
  ownerConfirmedAt: string;
  verifiedAt: string | null;
}
export type GymPricingInput = Omit<GymPricing, 'listingId' | 'ownerConfirmedAt' | 'verifiedAt'>;

export interface GymOffer {
  id: string;
  listingId: string;
  title: string;
  plan: OfferPlan;
  discountType: 'percent' | 'amount';
  discountValue: number;
  target: 'new_members' | 'everyone';
  maxRedemptions: number | null;
  startsAt: string;
  endsAt: string;
  terms: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
  createdAt: string;
  /** server-computed (gym_offer_prices) */
  originalPrice?: number | null;
  discountedPrice?: number | null;
  priceVerified?: boolean;
}

export interface GymCoupon {
  id: string;
  code: string;
  offerId: string;
  listingId: string;
  userId: string;
  userNickname: string;
  originalPrice: number;
  discountedPrice: number;
  status: 'issued' | 'redeemed' | 'cancelled';
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
}

export interface GymReview {
  listingId: string;
  userId: string;
  userNickname: string;
  rating: number;
  body: string;
  verifiedMember: boolean;
  createdAt: string;
}

export interface Partnership {
  listingId: string;
  status: 'applied' | 'active' | 'rejected' | 'ended';
  applicantNote: string;
  plan: 'basic' | 'premium';
  contractReference: string;
  commissionRate: number | null;
  monthlyFee: number | null;
  startsOn: string | null;
  endsOn: string | null;
  appliedAt: string;
  decidedAt: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function mapListing(r: Record<string, unknown>): GymListing {
  return {
    id: r.id as string,
    ownerUserId: r.owner_user_id as string,
    gymId: (r.gym_id as string | null) ?? null,
    name: r.name as string,
    arts: (r.arts as GymArt[]) ?? [],
    description: (r.description as string) ?? '',
    coverImageUrl: (r.cover_image_url as string | null) ?? null,
    address: r.address as string,
    region: r.region as string,
    lat: num(r.lat),
    lng: num(r.lng),
    phone: (r.phone as string) ?? '',
    website: (r.website as string) ?? '',
    sns: (r.sns as Record<string, string>) ?? {},
    hours: (r.hours as string) ?? '',
    facilities: (r.facilities as string[]) ?? [],
    instructors: (r.instructors as InstructorInfo[]) ?? [],
    schedule: (r.schedule as ScheduleItem[]) ?? [],
    status: r.status as GymListing['status'],
    reviewNote: (r.review_note as string) ?? '',
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapPricing(r: Record<string, unknown>): GymPricing {
  return {
    listingId: r.listing_id as string,
    monthly: num(r.monthly),
    threeMonth: num(r.three_month),
    sixMonth: num(r.six_month),
    yearly: num(r.yearly),
    initiationFee: num(r.initiation_fee),
    registrationFee: num(r.registration_fee),
    gearCost: num(r.gear_cost),
    sessionsPerWeek: num(r.sessions_per_week),
    minutesPerSession: num(r.minutes_per_session),
    openMat: (r.open_mat as boolean | null) ?? null,
    multiArt: (r.multi_art as boolean | null) ?? null,
    trialAvailable: (r.trial_available as boolean | null) ?? null,
    trialPrice: num(r.trial_price),
    notes: (r.notes as string) ?? '',
    ownerConfirmedAt: r.owner_confirmed_at as string,
    verifiedAt: (r.verified_at as string | null) ?? null,
  };
}

function mapOffer(r: Record<string, unknown>): GymOffer {
  return {
    id: r.id as string,
    listingId: r.listing_id as string,
    title: r.title as string,
    plan: r.plan as OfferPlan,
    discountType: r.discount_type as GymOffer['discountType'],
    discountValue: Number(r.discount_value),
    target: r.target as GymOffer['target'],
    maxRedemptions: num(r.max_redemptions),
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    terms: (r.terms as string) ?? '',
    status: r.status as GymOffer['status'],
    createdAt: r.created_at as string,
  };
}

function mapCoupon(r: Record<string, unknown>): GymCoupon {
  return {
    id: r.id as string,
    code: r.code as string,
    offerId: r.offer_id as string,
    listingId: r.listing_id as string,
    userId: r.user_id as string,
    userNickname: (r.user_nickname as string) ?? '',
    originalPrice: Number(r.original_price),
    discountedPrice: Number(r.discounted_price),
    status: r.status as GymCoupon['status'],
    issuedAt: r.issued_at as string,
    expiresAt: r.expires_at as string,
    redeemedAt: (r.redeemed_at as string | null) ?? null,
  };
}

function mapPartnership(r: Record<string, unknown>): Partnership {
  return {
    listingId: r.listing_id as string,
    status: r.status as Partnership['status'],
    applicantNote: (r.applicant_note as string) ?? '',
    plan: (r.plan as Partnership['plan']) ?? 'basic',
    contractReference: (r.contract_reference as string) ?? '',
    commissionRate: num(r.commission_rate),
    monthlyFee: num(r.monthly_fee),
    startsOn: (r.starts_on as string | null) ?? null,
    endsOn: (r.ends_on as string | null) ?? null,
    appliedAt: r.applied_at as string,
    decidedAt: (r.decided_at as string | null) ?? null,
  };
}

/** 쿠폰의 실제 표시 상태 — 발급 상태인데 기간이 지났으면 만료 */
export function couponState(c: GymCoupon, now = Date.now()): 'issued' | 'redeemed' | 'cancelled' | 'expired' {
  if (c.status === 'issued' && new Date(c.expiresAt).getTime() < now) return 'expired';
  return c.status;
}
export const COUPON_STATE_LABEL = { issued: '사용 가능', redeemed: '사용 완료 · 등록 확인', cancelled: '취소됨', expired: '기간 만료' } as const;

const likeSafe = (s: string) => s.replace(/[%_,()\\]/g, ' ').trim();

export interface GymSearch {
  q?: string;
  art?: GymArt | '';
  region?: string;
  partnerOnly?: boolean;
  trialOnly?: boolean;
  openMatOnly?: boolean;
  maxMonthly?: number | null;
  sort?: 'name' | 'monthly_asc' | 'latest';
}

export interface GymSearchRow {
  listing: GymListing;
  pricing: GymPricing | null;
  isPartner: boolean;
  rating: { avg: number | null; count: number };
}

export async function activePartnerIds(): Promise<Set<string>> {
  const r = await callRpc<string[] | { active_gym_partner_ids: string }[]>('active_gym_partner_ids', {});
  if (!r.ok || !Array.isArray(r.data)) return new Set();
  return new Set(r.data.map((x) => (typeof x === 'string' ? x : (x as { active_gym_partner_ids: string }).active_gym_partner_ids)));
}

/** 승인된 체육관만 (RLS). 필터는 서버 쿼리 + 가격·제휴 조건은 결합 후 적용. */
export async function searchGyms(s: GymSearch): Promise<AuthResult<GymSearchRow[]>> {
  const r = await run<Record<string, unknown>[]>(async () => {
    let q = supabase!.from('gym_listings').select('*').eq('status', 'approved');
    if (s.art) q = q.contains('arts', [s.art]);
    if (s.region?.trim()) q = q.or(`region.ilike.%${likeSafe(s.region)}%,address.ilike.%${likeSafe(s.region)}%`);
    return q.order('name').limit(200);
  });
  if (!r.ok) return r;
  // name/description text filter is applied here: a second PostgREST `or` filter next to the region one is ambiguous
  const needle = s.q?.trim().toLowerCase() ?? '';
  const listings = (r.data ?? []).map(mapListing).filter((l) => !needle || `${l.name} ${l.description} ${l.arts.map((a) => GYM_ARTS[a]).join(' ')}`.toLowerCase().includes(needle));
  const ids = listings.map((l) => l.id);
  const [pricing, partners, ratings] = await Promise.all([getPricingMany(ids), activePartnerIds(), getRatings(ids)]);
  let rows: GymSearchRow[] = listings.map((l) => ({ listing: l, pricing: pricing.get(l.id) ?? null, isPartner: partners.has(l.id), rating: ratings.get(l.id) ?? { avg: null, count: 0 } }));
  if (s.partnerOnly) rows = rows.filter((x) => x.isPartner);
  if (s.trialOnly) rows = rows.filter((x) => x.pricing?.trialAvailable === true);
  if (s.openMatOnly) rows = rows.filter((x) => x.pricing?.openMat === true);
  if (typeof s.maxMonthly === 'number') rows = rows.filter((x) => x.pricing?.monthly !== null && x.pricing?.monthly !== undefined && x.pricing.monthly <= s.maxMonthly!);
  if (s.sort === 'monthly_asc') rows.sort((a, b) => (a.pricing?.monthly ?? Infinity) - (b.pricing?.monthly ?? Infinity));
  else if (s.sort === 'latest') rows.sort((a, b) => b.listing.createdAt.localeCompare(a.listing.createdAt));
  return { ok: true, data: rows };
}

export async function getPricingMany(ids: string[]): Promise<Map<string, GymPricing>> {
  const out = new Map<string, GymPricing>();
  if (!supabase || !ids.length) return out;
  const { data } = await supabase.from('gym_pricing').select('*').in('listing_id', ids);
  for (const r of data ?? []) out.set(r.listing_id as string, mapPricing(r));
  return out;
}

async function getRatings(ids: string[]): Promise<Map<string, { avg: number | null; count: number }>> {
  const out = new Map<string, { avg: number | null; count: number }>();
  if (!supabase || !ids.length) return out;
  const { data } = await supabase.from('gym_reviews').select('listing_id, rating').in('listing_id', ids);
  const acc = new Map<string, number[]>();
  for (const r of data ?? []) acc.set(r.listing_id as string, [...(acc.get(r.listing_id as string) ?? []), Number(r.rating)]);
  for (const [k, v] of acc) out.set(k, { avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, count: v.length });
  return out;
}

export async function getGymListing(id: string): Promise<AuthResult<GymListing | null>> {
  return run<GymListing | null>(async () => {
    const res = await supabase!.from('gym_listings').select('*').eq('id', id).maybeSingle();
    return { data: res.data ? mapListing(res.data) : null, error: res.error };
  });
}

export async function getPricing(id: string): Promise<GymPricing | null> {
  return (await getPricingMany([id])).get(id) ?? null;
}

export async function isActivePartner(id: string): Promise<boolean> {
  const r = await callRpc<boolean>('is_active_gym_partner', { p_listing: id });
  return r.ok && r.data === true;
}

async function withPrices(offers: GymOffer[]): Promise<GymOffer[]> {
  return Promise.all(
    offers.map(async (o) => {
      const p = await callRpc<{ original_price: number | null; discounted_price: number | null; price_verified: boolean }[]>('gym_offer_prices', { p_offer: o.id });
      const row = p.ok && Array.isArray(p.data) ? p.data[0] : null;
      return { ...o, originalPrice: row?.original_price ?? null, discountedPrice: row?.discounted_price ?? null, priceVerified: !!row?.price_verified };
    }),
  );
}

/** 사용자에게 보이는 할인 (RLS: 활성 제휴 + 진행 기간 중인 것만) */
export async function listOffers(listingId: string): Promise<AuthResult<GymOffer[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_offers').select('*').eq('listing_id', listingId).order('created_at', { ascending: false }));
  if (!r.ok) return r;
  return { ok: true, data: await withPrices((r.data ?? []).map(mapOffer)) };
}

/** 할인 혜택 페이지: 지금 받을 수 있는 모든 제휴 할인 */
export async function listAllActiveOffers(): Promise<AuthResult<{ offer: GymOffer; listing: GymListing }[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_offers').select('*, gym_listings(*)').eq('status', 'active').order('ends_at'));
  if (!r.ok) return r;
  const now = Date.now();
  const rows = (r.data ?? [])
    .filter((x) => x.gym_listings && new Date(x.starts_at as string).getTime() <= now && new Date(x.ends_at as string).getTime() >= now)
    .map((x) => ({ offer: mapOffer(x), listing: mapListing(x.gym_listings as Record<string, unknown>) }));
  const priced = await withPrices(rows.map((x) => x.offer));
  return { ok: true, data: rows.map((x, i) => ({ ...x, offer: priced[i] })) };
}

export async function claimOffer(offerId: string): Promise<AuthResult<{ couponId: string; code: string }>> {
  const r = await callRpc<{ coupon_id: string; code: string }[]>('claim_gym_offer', { p_offer: offerId });
  if (!r.ok) return r;
  const row = Array.isArray(r.data) ? r.data[0] : null;
  return row ? { ok: true, data: { couponId: row.coupon_id, code: row.code } } : { ok: false, message: '쿠폰을 발급하지 못했습니다.' };
}

export async function listMyCoupons(userId: string): Promise<AuthResult<(GymCoupon & { listingName: string; offerTitle: string })[]>> {
  const r = await run<Record<string, unknown>[]>(() =>
    supabase!.from('gym_coupons').select('*, gym_listings(name), gym_offers(title)').eq('user_id', userId).order('issued_at', { ascending: false }),
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: (r.data ?? []).map((x) => ({
      ...mapCoupon(x),
      listingName: ((x.gym_listings as { name?: string } | null)?.name as string) ?? '체육관',
      offerTitle: ((x.gym_offers as { title?: string } | null)?.title as string) ?? '',
    })),
  };
}

export const cancelCoupon = (couponId: string) => callRpc<void>('cancel_gym_coupon', { p_coupon: couponId });
export const redeemCoupon = (code: string) => callRpc<string>('redeem_gym_coupon', { p_code: code });
export const startInquiry = (listingId: string) => callRpc<string>('start_gym_inquiry', { p_listing: listingId });

export async function listReviews(listingId: string): Promise<AuthResult<GymReview[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_reviews').select('*').eq('listing_id', listingId).order('created_at', { ascending: false }));
  if (!r.ok) return r;
  return {
    ok: true,
    data: (r.data ?? []).map((x) => ({
      listingId: x.listing_id as string,
      userId: x.user_id as string,
      userNickname: (x.user_nickname as string) ?? '',
      rating: Number(x.rating),
      body: (x.body as string) ?? '',
      verifiedMember: !!x.verified_member,
      createdAt: x.created_at as string,
    })),
  };
}
export const writeGymReview = (listingId: string, userId: string, nickname: string, rating: number, body: string) =>
  run<void>(() =>
    supabase!.from('gym_reviews').upsert({ listing_id: listingId, user_id: userId, user_nickname: nickname, rating, body: body.trim().slice(0, 1500) }, { onConflict: 'listing_id,user_id' }),
  );
export const reportGym = (reporterId: string, targetType: 'gym_listing' | 'gym_review', targetId: string, reason: string, detail = '') =>
  run<void>(() => supabase!.from('user_reports').insert({ reporter_id: reporterId, target_type: targetType, target_id: targetId, reason, detail }));

// ---------------- 체육관 관리자 ----------------

export type GymListingInput = Omit<GymListing, 'id' | 'ownerUserId' | 'status' | 'reviewNote' | 'reviewedAt' | 'createdAt' | 'updatedAt'>;

export function validateListing(i: GymListingInput): string | null {
  if (i.name.trim().length < 2) return '체육관 이름을 2자 이상 입력해 주세요.';
  if (!i.arts.length) return '제공 종목을 하나 이상 골라 주세요.';
  if (i.address.trim().length < 4) return '주소를 입력해 주세요.';
  if (!i.region.trim()) return '지역(예: 서울 강남구)을 입력해 주세요.';
  if (i.website && !/^https?:\/\//i.test(i.website.trim())) return '홈페이지 주소는 http:// 또는 https:// 로 시작해야 합니다.';
  if ((i.lat === null) !== (i.lng === null)) return '위도와 경도는 함께 입력해 주세요.';
  return null;
}

const listingRow = (i: GymListingInput) => ({
  gym_id: i.gymId,
  name: i.name.trim(),
  arts: i.arts,
  description: i.description.trim(),
  cover_image_url: i.coverImageUrl,
  address: i.address.trim(),
  region: i.region.trim(),
  lat: i.lat,
  lng: i.lng,
  phone: i.phone.trim(),
  website: i.website.trim(),
  sns: i.sns,
  hours: i.hours.trim(),
  facilities: i.facilities,
  instructors: i.instructors,
  schedule: i.schedule,
});

export async function createListing(ownerId: string, input: GymListingInput): Promise<AuthResult<GymListing>> {
  const invalid = validateListing(input);
  if (invalid) return { ok: false, message: invalid };
  return run<GymListing>(async () => {
    const res = await supabase!.from('gym_listings').insert({ ...listingRow(input), owner_user_id: ownerId }).select('*').single();
    return { data: res.data ? mapListing(res.data) : null, error: res.error };
  });
}

export async function updateListing(id: string, input: GymListingInput): Promise<AuthResult<void>> {
  const invalid = validateListing(input);
  if (invalid) return { ok: false, message: invalid };
  return run<void>(() => supabase!.from('gym_listings').update(listingRow(input)).eq('id', id));
}

export async function listMyListings(ownerId: string): Promise<AuthResult<GymListing[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_listings').select('*').eq('owner_user_id', ownerId).order('created_at', { ascending: false }));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapListing) } : r;
}

export async function savePricing(listingId: string, p: GymPricingInput, exists: boolean): Promise<AuthResult<void>> {
  const row = {
    listing_id: listingId,
    monthly: p.monthly,
    three_month: p.threeMonth,
    six_month: p.sixMonth,
    yearly: p.yearly,
    initiation_fee: p.initiationFee,
    registration_fee: p.registrationFee,
    gear_cost: p.gearCost,
    sessions_per_week: p.sessionsPerWeek,
    minutes_per_session: p.minutesPerSession,
    open_mat: p.openMat,
    multi_art: p.multiArt,
    trial_available: p.trialAvailable,
    trial_price: p.trialPrice,
    notes: p.notes.trim(),
  };
  return exists ? run<void>(() => supabase!.from('gym_pricing').update(row).eq('listing_id', listingId)) : run<void>(() => supabase!.from('gym_pricing').insert(row));
}

export async function getPartnership(listingId: string): Promise<Partnership | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('gym_partnerships').select('*').eq('listing_id', listingId).maybeSingle();
  return data ? mapPartnership(data) : null;
}
export const applyPartnership = (listingId: string, note: string, plan: 'basic' | 'premium') =>
  run<void>(() => supabase!.from('gym_partnerships').insert({ listing_id: listingId, applicant_note: note.trim().slice(0, 2000), plan }));
export const reapplyPartnership = (listingId: string, note: string) => callRpc<void>('reapply_gym_partnership', { p_listing: listingId, p_note: note });

/** 관리자 화면: 내 체육관의 모든 할인(초안 포함) */
export async function listOwnerOffers(listingId: string): Promise<AuthResult<GymOffer[]>> {
  return listOffers(listingId);
}

export interface OfferInput {
  title: string;
  plan: OfferPlan;
  discountType: 'percent' | 'amount';
  discountValue: number;
  target: 'new_members' | 'everyone';
  maxRedemptions: number | null;
  startsAt: string;
  endsAt: string;
  terms: string;
}
export function validateOffer(o: OfferInput): string | null {
  if (o.title.trim().length < 2) return '할인 이름을 입력해 주세요.';
  if (!Number.isInteger(o.discountValue) || o.discountValue <= 0) return '할인 값은 1 이상 정수여야 합니다.';
  if (o.discountType === 'percent' && o.discountValue > 90) return '할인율은 90% 이하로 설정해 주세요.';
  if (new Date(o.endsAt).getTime() <= new Date(o.startsAt).getTime()) return '종료일이 시작일보다 늦어야 합니다.';
  if (o.maxRedemptions !== null && (!Number.isInteger(o.maxRedemptions) || o.maxRedemptions <= 0)) return '인원 제한은 1 이상 정수로 입력해 주세요.';
  return null;
}
export async function createOffer(listingId: string, o: OfferInput): Promise<AuthResult<void>> {
  const invalid = validateOffer(o);
  if (invalid) return { ok: false, message: invalid };
  return run<void>(() =>
    supabase!.from('gym_offers').insert({
      listing_id: listingId,
      title: o.title.trim(),
      plan: o.plan,
      discount_type: o.discountType,
      discount_value: o.discountValue,
      target: o.target,
      max_redemptions: o.maxRedemptions,
      starts_at: o.startsAt,
      ends_at: o.endsAt,
      terms: o.terms.trim(),
      status: 'draft',
    }),
  );
}
export const setOfferStatus = (offerId: string, status: GymOffer['status']) => run<void>(() => supabase!.from('gym_offers').update({ status }).eq('id', offerId));

export async function listListingCoupons(listingId: string): Promise<AuthResult<GymCoupon[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_coupons').select('*').eq('listing_id', listingId).order('issued_at', { ascending: false }));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapCoupon) } : r;
}

export interface LeadStats {
  inquiries: number;
  couponsIssued: number;
  couponsRedeemed: number;
  conversionRate: number | null;
  byMonth: { month: string; inquiries: number; issued: number; redeemed: number }[];
}
export async function leadStats(listingId: string): Promise<AuthResult<LeadStats>> {
  if (!supabase) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
  const [leads, coupons] = await Promise.all([
    run<Record<string, unknown>[]>(() => supabase!.from('gym_leads').select('created_at').eq('listing_id', listingId)),
    listListingCoupons(listingId),
  ]);
  if (!leads.ok) return leads;
  if (!coupons.ok) return coupons;
  return { ok: true, data: computeLeadStats((leads.data ?? []).map((l) => l.created_at as string), coupons.data) };
}

/** 순수 계산 (테스트 대상) */
export function computeLeadStats(inquiryDates: string[], coupons: Pick<GymCoupon, 'status' | 'issuedAt' | 'redeemedAt'>[]): LeadStats {
  const m = new Map<string, { inquiries: number; issued: number; redeemed: number }>();
  const bucket = (iso: string) => {
    const k = iso.slice(0, 7);
    if (!m.has(k)) m.set(k, { inquiries: 0, issued: 0, redeemed: 0 });
    return m.get(k)!;
  };
  for (const d of inquiryDates) bucket(d).inquiries++;
  for (const c of coupons) {
    if (c.status !== 'cancelled') bucket(c.issuedAt).issued++;
    if (c.status === 'redeemed' && c.redeemedAt) bucket(c.redeemedAt).redeemed++;
  }
  const issued = coupons.filter((c) => c.status !== 'cancelled').length;
  const redeemed = coupons.filter((c) => c.status === 'redeemed').length;
  return {
    inquiries: inquiryDates.length,
    couponsIssued: issued,
    couponsRedeemed: redeemed,
    conversionRate: issued ? Math.round((redeemed / issued) * 1000) / 10 : null,
    byMonth: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
  };
}

export const uploadGymImage = (file: File, userId: string) => uploadImage('gym-media', file, userId);

// ---------------- 가격 비교 (순수 계산) ----------------

export interface CompareRow {
  key: string;
  label: string;
  values: (string | null)[];
  /** index of the best (lowest-cost) value, when comparable */
  best: number | null;
}

/** 총비용 = 입회비 + 등록비 + 장비 + 기간 요금. 하나라도 모르면 계산하지 않는다(추정 금지). */
export function firstYearCost(p: GymPricing | null): number | null {
  if (!p) return null;
  const base = p.yearly ?? null;
  if (base === null) return null;
  if (p.initiationFee === null || p.registrationFee === null || p.gearCost === null) return null;
  return base + p.initiationFee + p.registrationFee + p.gearCost;
}
export function monthlyPerSession(p: GymPricing | null): number | null {
  if (!p || p.monthly === null || !p.sessionsPerWeek) return null;
  return Math.round(p.monthly / (p.sessionsPerWeek * 4.345));
}

export function buildComparison(rows: { pricing: GymPricing | null }[]): CompareRow[] {
  const won = (n: number | null) => (n === null ? null : `${n.toLocaleString('ko-KR')}원`);
  const yn = (b: boolean | null) => (b === null ? null : b ? '가능' : '불가');
  const minIdx = (vals: (number | null)[]) => {
    let best: number | null = null;
    vals.forEach((v, i) => {
      if (v !== null && (best === null || v < (vals[best] as number))) best = i;
    });
    return vals.filter((v) => v !== null).length >= 2 ? best : null;
  };
  const moneyRow = (key: string, label: string, pick: (p: GymPricing) => number | null): CompareRow => {
    const vals = rows.map((r) => (r.pricing ? pick(r.pricing) : null));
    return { key, label, values: vals.map(won), best: minIdx(vals) };
  };
  return [
    moneyRow('monthly', '월 회비', (p) => p.monthly),
    moneyRow('three_month', '3개월', (p) => p.threeMonth),
    moneyRow('six_month', '6개월', (p) => p.sixMonth),
    moneyRow('yearly', '연간', (p) => p.yearly),
    moneyRow('initiation_fee', '입회비', (p) => p.initiationFee),
    moneyRow('registration_fee', '등록비', (p) => p.registrationFee),
    moneyRow('gear_cost', '도복·장비 비용', (p) => p.gearCost),
    (() => {
      const vals = rows.map((r) => firstYearCost(r.pricing));
      return { key: 'first_year', label: '첫 1년 총비용 (연간+입회+등록+장비)', values: vals.map(won), best: minIdx(vals) };
    })(),
    (() => {
      const vals = rows.map((r) => monthlyPerSession(r.pricing));
      return { key: 'per_session', label: '월 회비 기준 1회 수업당', values: vals.map(won), best: minIdx(vals) };
    })(),
    { key: 'sessions', label: '주당 수업 횟수', values: rows.map((r) => (r.pricing?.sessionsPerWeek != null ? `${r.pricing.sessionsPerWeek}회` : null)), best: null },
    { key: 'minutes', label: '1회 수업 시간', values: rows.map((r) => (r.pricing?.minutesPerSession != null ? `${r.pricing.minutesPerSession}분` : null)), best: null },
    { key: 'open_mat', label: '자유 연습', values: rows.map((r) => yn(r.pricing?.openMat ?? null)), best: null },
    { key: 'multi_art', label: '여러 종목 수강', values: rows.map((r) => yn(r.pricing?.multiArt ?? null)), best: null },
    { key: 'trial', label: '체험 수업', values: rows.map((r) => (r.pricing?.trialAvailable ? (r.pricing.trialPrice != null ? `가능 · ${r.pricing.trialPrice.toLocaleString('ko-KR')}원` : '가능') : yn(r.pricing?.trialAvailable ?? null))), best: null },
  ];
}

// ---------------- 플랫폼 관리자 ----------------

export async function adminListListings(status: GymListing['status'] | 'all'): Promise<AuthResult<GymListing[]>> {
  const r = await run<Record<string, unknown>[]>(() => {
    let q = supabase!.from('gym_listings').select('*').order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') q = q.eq('status', status);
    return q;
  });
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapListing) } : r;
}
export async function adminListPartnerships(): Promise<AuthResult<Partnership[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_partnerships').select('*').order('applied_at', { ascending: false }));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapPartnership) } : r;
}
export const reviewListing = (id: string, status: GymListing['status'], note: string) => callRpc<void>('review_gym_listing', { p_listing: id, p_status: status, p_note: note });
export const verifyPricing = (id: string) => callRpc<void>('verify_gym_pricing', { p_listing: id });
export const decidePartnership = (id: string, status: 'active' | 'rejected' | 'ended', terms: { contractReference: string; commission: number | null; monthlyFee: number | null; startsOn: string | null; endsOn: string | null; plan: 'basic' | 'premium' }) =>
  callRpc<void>('decide_gym_partnership', {
    p_listing: id,
    p_status: status,
    p_contract_reference: terms.contractReference,
    p_commission: terms.commission,
    p_monthly_fee: terms.monthlyFee,
    p_starts: terms.startsOn,
    p_ends: terms.endsOn,
    p_plan: terms.plan,
  });
