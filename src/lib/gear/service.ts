// 격투기 장비 중고거래 (0057). 결제 없음 — 문의(기존 DM) + 거래 상태 + 후기 + 신고·차단.
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { callRpc, run, uploadImage } from '../ecosystem/common';
import { sendMessage } from '../social/dmService';

export const GEAR_CATEGORIES = {
  boxing_gloves: '복싱 글러브',
  mma_gloves: 'MMA 글러브',
  bjj_gi: '주짓수 도복',
  wrestling: '레슬링 용품',
  shin_guards: '정강이 보호대',
  headgear: '헤드기어',
  mouthguard: '마우스피스',
  protective: '보호 장비',
  apparel: '트레이닝 의류',
  other: '기타 격투기 장비',
} as const;
export type GearCategory = keyof typeof GEAR_CATEGORIES;

/** 상태 기준을 한 곳에서 정의해 모든 화면이 같은 말로 표시한다. */
export const GEAR_CONDITIONS = {
  new: { label: '새 상품', note: '개봉하지 않았거나 한 번도 쓰지 않음' },
  like_new: { label: '거의 새것', note: '몇 번 사용, 눈에 띄는 흔적 없음' },
  good: { label: '사용감 적음', note: '가벼운 사용 흔적, 기능 문제 없음' },
  fair: { label: '사용감 있음', note: '눈에 보이는 마모, 기능 문제 없음' },
  worn: { label: '많이 사용함', note: '마모·변형 있음, 설명 확인 필요' },
} as const;
export type GearCondition = keyof typeof GEAR_CONDITIONS;

export const GEAR_STATUS = { active: '판매 중', reserved: '예약 중', sold: '판매 완료', hidden: '숨김' } as const;
export type GearStatus = keyof typeof GEAR_STATUS;

export const GEAR_ARTS: { id: string; label: string }[] = [
  { id: 'boxing', label: '복싱' },
  { id: 'kickboxing', label: '킥복싱' },
  { id: 'muay-thai', label: '무에타이' },
  { id: 'bjj', label: '주짓수' },
  { id: 'wrestling', label: '레슬링' },
  { id: 'mixed-martial-arts', label: 'MMA' },
  { id: 'judo', label: '유도' },
  { id: 'taekwondo', label: '태권도' },
  { id: 'karate', label: '가라테' },
  { id: 'sambo', label: '삼보' },
];
export const gearArtLabel = (id: string | null) => (id ? GEAR_ARTS.find((a) => a.id === id)?.label ?? id : '공통');

/** 장비별 사이즈 입력 안내 (자유 입력이지만 무엇을 적어야 하는지 알려 준다) */
export const SIZE_HINT: Record<GearCategory, string> = {
  boxing_gloves: '온스(oz) — 예: 12oz, 16oz',
  mma_gloves: 'S/M/L/XL 또는 온스',
  bjj_gi: '도복 사이즈 — 예: A1, A2, F2',
  wrestling: '신발은 mm, 싱글렛은 S~XL',
  shin_guards: 'S/M/L/XL',
  headgear: 'S/M/L/XL',
  mouthguard: '성인/청소년, 끓여 맞추는 형식 여부',
  protective: 'S/M/L/XL',
  apparel: 'S/M/L/XL 또는 숫자 사이즈',
  other: '사이즈가 있다면 적어 주세요',
};

export interface GearListing {
  id: string;
  sellerId: string;
  sellerNickname: string;
  title: string;
  category: GearCategory;
  martialArt: string | null;
  brand: string;
  size: string;
  usageMonths: number | null;
  condition: GearCondition;
  price: number;
  description: string;
  images: string[];
  region: string;
  shippingAvailable: boolean;
  meetupAvailable: boolean;
  /** 택배 거래 시 구매자가 내는 배송비 (판매자가 정함, 0 = 무료배송) */
  shippingFee: number;
  status: GearStatus;
  buyerId: string | null;
  soldAt: string | null;
  favoriteCount: number;
  moderation: 'ok' | 'removed';
  createdAt: string;
  updatedAt: string;
}

export interface GearInput {
  title: string;
  category: GearCategory;
  martialArt: string | null;
  brand: string;
  size: string;
  usageMonths: number | null;
  condition: GearCondition;
  price: number;
  description: string;
  images: string[];
  region: string;
  shippingAvailable: boolean;
  meetupAvailable: boolean;
  shippingFee: number;
}

export interface GearFilters {
  q?: string;
  category?: GearCategory | '';
  martialArt?: string;
  brand?: string;
  size?: string;
  condition?: GearCondition | '';
  region?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  includeSold?: boolean;
  sort?: 'latest' | 'price_asc' | 'price_desc';
}

export function mapGear(r: Record<string, unknown>): GearListing {
  return {
    id: r.id as string,
    sellerId: r.seller_id as string,
    sellerNickname: (r.seller_nickname as string) ?? '',
    title: r.title as string,
    category: r.category as GearCategory,
    martialArt: (r.martial_art as string | null) ?? null,
    brand: (r.brand as string) ?? '',
    size: (r.size as string) ?? '',
    usageMonths: (r.usage_months as number | null) ?? null,
    condition: r.condition as GearCondition,
    price: Number(r.price ?? 0),
    description: (r.description as string) ?? '',
    images: (r.images as string[]) ?? [],
    region: (r.region as string) ?? '',
    shippingAvailable: !!r.shipping_available,
    meetupAvailable: !!r.meetup_available,
    shippingFee: Number(r.shipping_fee ?? 0),
    status: r.status as GearStatus,
    buyerId: (r.buyer_id as string | null) ?? null,
    soldAt: (r.sold_at as string | null) ?? null,
    favoriteCount: Number(r.favorite_count ?? 0),
    moderation: (r.moderation as 'ok' | 'removed') ?? 'ok',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** PostgREST `ilike` 패턴에서 와일드카드·구분자를 무력화 */
const likeSafe = (s: string) => s.replace(/[%_,()\\]/g, ' ').trim();

export function validateGearInput(i: GearInput): string | null {
  if (i.title.trim().length < 2) return '상품명을 2자 이상 입력해 주세요.';
  if (!Number.isInteger(i.price) || i.price < 0 || i.price > 100_000_000) return '가격은 0원 이상 1억 원 이하 정수로 입력해 주세요.';
  if (i.usageMonths !== null && (!Number.isInteger(i.usageMonths) || i.usageMonths < 0 || i.usageMonths > 600)) return '사용 기간(개월)을 확인해 주세요.';
  if (!i.shippingAvailable && !i.meetupAvailable) return '직거래와 택배 중 하나 이상 선택해 주세요.';
  if (!Number.isInteger(i.shippingFee) || i.shippingFee < 0 || i.shippingFee > 1_000_000) return '배송비는 0원 이상 100만 원 이하 정수로 입력해 주세요.';
  if (i.images.length > 8) return '사진은 8장까지 올릴 수 있습니다.';
  if (i.description.length > 3000) return '설명은 3000자 이하로 입력해 주세요.';
  return null;
}

const toRow = (i: GearInput) => ({
  title: i.title.trim(),
  category: i.category,
  martial_art: i.martialArt || null,
  brand: i.brand.trim(),
  size: i.size.trim(),
  usage_months: i.usageMonths,
  condition: i.condition,
  price: i.price,
  description: i.description.trim(),
  images: i.images,
  region: i.region.trim(),
  shipping_available: i.shippingAvailable,
  meetup_available: i.meetupAvailable,
  shipping_fee: i.shippingAvailable ? i.shippingFee : 0,
});

export async function searchGear(f: GearFilters, limit = 60): Promise<AuthResult<GearListing[]>> {
  return run<GearListing[]>(async () => {
    let q = supabase!.from('gear_listings').select('*').eq('moderation', 'ok').neq('status', 'hidden');
    if (!f.includeSold) q = q.neq('status', 'sold');
    if (f.category) q = q.eq('category', f.category);
    if (f.martialArt) q = q.eq('martial_art', f.martialArt);
    if (f.condition) q = q.eq('condition', f.condition);
    if (f.brand?.trim()) q = q.ilike('brand', `%${likeSafe(f.brand)}%`);
    if (f.size?.trim()) q = q.ilike('size', `%${likeSafe(f.size)}%`);
    if (f.region?.trim()) q = q.ilike('region', `%${likeSafe(f.region)}%`);
    if (typeof f.minPrice === 'number') q = q.gte('price', f.minPrice);
    if (typeof f.maxPrice === 'number') q = q.lte('price', f.maxPrice);
    if (f.q?.trim()) {
      const s = likeSafe(f.q);
      q = q.or(`title.ilike.%${s}%,brand.ilike.%${s}%,description.ilike.%${s}%`);
    }
    q = f.sort === 'price_asc' ? q.order('price', { ascending: true }) : f.sort === 'price_desc' ? q.order('price', { ascending: false }) : q.order('created_at', { ascending: false });
    const res = await q.limit(limit);
    return { data: (res.data ?? []).map(mapGear), error: res.error };
  });
}

export async function getGear(id: string): Promise<AuthResult<GearListing | null>> {
  return run<GearListing | null>(async () => {
    const res = await supabase!.from('gear_listings').select('*').eq('id', id).maybeSingle();
    return { data: res.data ? mapGear(res.data) : null, error: res.error };
  });
}

export async function createGear(sellerId: string, sellerNickname: string, input: GearInput): Promise<AuthResult<GearListing>> {
  const invalid = validateGearInput(input);
  if (invalid) return { ok: false, message: invalid };
  return run<GearListing>(async () => {
    const res = await supabase!.from('gear_listings').insert({ ...toRow(input), seller_id: sellerId, seller_nickname: sellerNickname }).select('*').single();
    return { data: res.data ? mapGear(res.data) : null, error: res.error };
  });
}

export async function updateGear(id: string, input: GearInput): Promise<AuthResult<void>> {
  const invalid = validateGearInput(input);
  if (invalid) return { ok: false, message: invalid };
  return run<void>(() => supabase!.from('gear_listings').update(toRow(input)).eq('id', id));
}

export async function setGearStatus(id: string, status: GearStatus, buyerId: string | null = null): Promise<AuthResult<void>> {
  const patch: Record<string, unknown> = { status };
  if (status === 'sold') patch.buyer_id = buyerId;
  return run<void>(() => supabase!.from('gear_listings').update(patch).eq('id', id));
}

export const deleteGear = (id: string) => run<void>(() => supabase!.from('gear_listings').delete().eq('id', id));

export async function listMyGear(userId: string): Promise<AuthResult<GearListing[]>> {
  return run<GearListing[]>(async () => {
    const res = await supabase!.from('gear_listings').select('*').eq('seller_id', userId).order('created_at', { ascending: false });
    return { data: (res.data ?? []).map(mapGear), error: res.error };
  });
}

export async function listPurchases(userId: string): Promise<AuthResult<GearListing[]>> {
  return run<GearListing[]>(async () => {
    const res = await supabase!.from('gear_listings').select('*').eq('buyer_id', userId).order('sold_at', { ascending: false });
    return { data: (res.data ?? []).map(mapGear), error: res.error };
  });
}

export async function listFavoriteIds(userId: string): Promise<Set<string>> {
  if (!supabase) return new Set();
  try {
    const { data } = await supabase.from('gear_favorites').select('listing_id').eq('user_id', userId);
    return new Set((data ?? []).map((r) => r.listing_id as string));
  } catch {
    return new Set();
  }
}

export async function listFavorites(userId: string): Promise<AuthResult<GearListing[]>> {
  const ids = [...(await listFavoriteIds(userId))];
  if (!ids.length) return { ok: true, data: [] };
  return run<GearListing[]>(async () => {
    const res = await supabase!.from('gear_listings').select('*').in('id', ids).order('created_at', { ascending: false });
    return { data: (res.data ?? []).map(mapGear), error: res.error };
  });
}

export const addFavorite = (listingId: string, userId: string) => run<void>(() => supabase!.from('gear_favorites').insert({ listing_id: listingId, user_id: userId }));
export const removeFavorite = (listingId: string, userId: string) => run<void>(() => supabase!.from('gear_favorites').delete().eq('listing_id', listingId).eq('user_id', userId));

export interface GearInquiry {
  listingId: string;
  buyerId: string;
  buyerNickname: string;
  conversationId: string | null;
  createdAt: string;
}
export async function listInquiries(listingId: string): Promise<AuthResult<GearInquiry[]>> {
  return run<GearInquiry[]>(async () => {
    const res = await supabase!.from('gear_inquiries').select('*').eq('listing_id', listingId).order('created_at', { ascending: false });
    return {
      data: (res.data ?? []).map((r) => ({ listingId: r.listing_id, buyerId: r.buyer_id, buyerNickname: r.buyer_nickname ?? '', conversationId: r.conversation_id ?? null, createdAt: r.created_at })),
      error: res.error,
    };
  });
}

/** 판매자 문의: 서버가 차단·본인 상품·판매 완료를 검사하고 기존 DM 대화방을 연다. 첫 메시지에 상품 카드를 붙인다. */
export async function inquire(listing: GearListing, myId: string, firstMessage: string): Promise<AuthResult<string>> {
  const r = await callRpc<string>('start_gear_inquiry', { p_listing: listing.id });
  if (!r.ok) return r;
  const text = firstMessage.trim() || `"${listing.title}" 상품 문의드립니다.`;
  const sent = await sendMessage(r.data, myId, text, null, { kind: 'gear', id: listing.id, title: listing.title, price: listing.price });
  // the conversation exists either way; say so if the first message didn't go through
  if (!sent.ok) return { ok: false, message: `대화방은 열렸지만 첫 메시지를 보내지 못했습니다: ${sent.message}` };
  return r;
}

export interface GearReview {
  listingId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  body: string;
  createdAt: string;
}
export async function listReviewsFor(userId: string): Promise<AuthResult<GearReview[]>> {
  return run<GearReview[]>(async () => {
    const res = await supabase!.from('gear_reviews').select('*').eq('reviewee_id', userId).order('created_at', { ascending: false }).limit(100);
    return {
      data: (res.data ?? []).map((r) => ({ listingId: r.listing_id, reviewerId: r.reviewer_id, revieweeId: r.reviewee_id, rating: r.rating, body: r.body ?? '', createdAt: r.created_at })),
      error: res.error,
    };
  });
}
export async function myReviewFor(listingId: string, userId: string): Promise<GearReview | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('gear_reviews').select('*').eq('listing_id', listingId).eq('reviewer_id', userId).maybeSingle();
  return data ? { listingId: data.listing_id, reviewerId: data.reviewer_id, revieweeId: data.reviewee_id, rating: data.rating, body: data.body ?? '', createdAt: data.created_at } : null;
}
export const writeReview = (listingId: string, reviewerId: string, revieweeId: string, rating: number, body: string) =>
  run<void>(() => supabase!.from('gear_reviews').insert({ listing_id: listingId, reviewer_id: reviewerId, reviewee_id: revieweeId, rating, body: body.trim().slice(0, 1000) }));

export const reportGear = (reporterId: string, listingId: string, reason: string, detail: string) =>
  run<void>(() => supabase!.from('user_reports').insert({ reporter_id: reporterId, target_type: 'gear_listing', target_id: listingId, reason, detail }));

export const uploadGearImage = (file: File, userId: string) => uploadImage('gear-media', file, userId);

export function sellerRating(reviews: GearReview[]): { avg: number | null; count: number } {
  if (!reviews.length) return { avg: null, count: 0 };
  return { avg: Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10, count: reviews.length };
}

export const SAFETY_TIPS = [
  '선입금 요구, 외부 메신저·링크로 이동 요청은 사기일 가능성이 높습니다.',
  '직거래는 사람이 많은 공개 장소에서, 낮 시간에 하세요.',
  '전화번호·주소·계좌 같은 개인정보는 거래가 확정되기 전에 보내지 마세요.',
  '마우스피스 등 위생용품은 새 상품이 아니면 거래하지 않는 것이 좋습니다.',
  '만 19세 미만이면 보호자와 함께 거래하세요. MARTIALDEX 는 결제를 대신하지 않습니다.',
];
