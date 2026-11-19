// 통합 플랫폼(체육관 운영·기술 평가·장비 거래·체육관 검색) 서비스 공통 도우미.
// 서버 RPC 가 던지는 영문 예외 메시지(0055–0058)를 사용자용 한국어로 바꾼다.
import { supabase } from '../supabase/client';
import { toKoreanAuthMessage } from '../auth/authErrors';
import type { AuthResult } from '../auth/authService';

export const NOT_CONFIGURED = 'Supabase 설정이 필요합니다.';
export const LOGIN_REQUIRED = '로그인이 필요합니다.';

const SERVER_MESSAGES: [RegExp, string][] = [
  [/not authenticated/, '로그인이 필요합니다.'],
  [/platform admin only/, '플랫폼 관리자만 할 수 있습니다.'],
  [/instructor only/, '이 체육관의 지도자만 할 수 있습니다.'],
  [/owner only|only the gym owner|only the gym can redeem/, '체육관 관리자만 할 수 있습니다.'],
  [/gym not found/, '체육관 코드를 찾을 수 없습니다.'],
  [/no pending request/, '대기 중인 가입 신청이 없습니다.'],
  [/self vote not allowed/, '내 콘텐츠에는 평가할 수 없습니다.'],
  [/evaluation closed/, '평가 기간이 아니거나 종료된 평가입니다.'],
  [/post not visible/, '볼 수 없는 게시물입니다.'],
  [/invalidated by moderation/, '운영 정책에 따라 무효 처리된 투표라 다시 투표할 수 없습니다.'],
  [/too many votes|daily vote limit/, '짧은 시간에 너무 많이 평가했습니다. 잠시 후 다시 시도해 주세요.'],
  [/must be an integer 0\.\.100/, '점수는 0~100 사이 정수여야 합니다.'],
  [/criteria and target cannot change/, '투표가 시작된 뒤에는 평가 대상과 항목을 바꿀 수 없습니다.'],
  [/cannot be reopened/, '종료된 평가는 다시 열 수 없습니다.'],
  [/^blocked$|blocked/, '차단 관계에서는 할 수 없습니다.'],
  [/cannot inquire on your own listing/, '내 상품에는 문의할 수 없습니다.'],
  [/listing already sold/, '이미 판매 완료된 상품입니다.'],
  [/listing not available/, '지금은 볼 수 없는 항목입니다.'],
  [/buyer must be someone who inquired/, '구매자는 이 상품에 문의한 사람 중에서만 고를 수 있습니다.'],
  [/recipient does not accept messages|only accepts messages/, '상대방이 메시지를 받지 않도록 설정했습니다.'],
  [/offer not active/, '지금은 진행 중이 아닌 할인입니다.'],
  [/no active partnership|only be activated under an active partnership/, '제휴 계약이 확인된 체육관만 할인을 진행할 수 있습니다.'],
  [/original price is not verified/, '원래 가격이 플랫폼에서 검증되지 않아 할인 쿠폰을 발급할 수 없습니다.'],
  [/offer is for new members only/, '신규 회원 전용 할인입니다.'],
  [/already claimed/, '이미 받은 할인 쿠폰입니다.'],
  [/offer limit reached/, '할인 인원이 모두 찼습니다.'],
  [/owners cannot claim/, '내 체육관의 할인은 받을 수 없습니다.'],
  [/coupon not found/, '쿠폰 코드를 찾을 수 없습니다.'],
  [/coupon expired/, '기간이 지난 쿠폰입니다.'],
  [/coupon is (redeemed|cancelled)/, '이미 사용했거나 취소된 쿠폰입니다.'],
  [/this is your gym/, '내 체육관입니다.'],
  [/listing must be approved first/, '체육관 등록 승인이 먼저 필요합니다.'],
  [/needs a contract reference and a start date/, '제휴를 활성화하려면 계약 번호와 시작일이 필요합니다.'],
  [/listing status is set by platform review/, '공개 상태는 플랫폼 검토로만 바뀝니다.'],
  [/cannot cancel/, '사용 가능한 상태의 내 쿠폰만 취소할 수 있습니다.'],
  [/nothing to reapply/, '반려되었거나 종료된 제휴만 다시 신청할 수 있습니다.'],
  [/can only link a gym you own/, '내가 관장인 체육관만 연결할 수 있습니다.'],
  [/owner cannot change|seller cannot change/, '등록자는 바꿀 수 없습니다.'],
  [/favorite_count is maintained/, '찜 수는 서버가 계산합니다.'],
  [/moderation is set by platform admins|removed listing cannot be reactivated/, '운영자가 내린 상품은 다시 공개할 수 없습니다.'],
  [/members can only update status/, '회원은 과제의 완료 여부와 메모만 바꿀 수 있습니다.'],
  [/cannot remove the owner|only the owner can remove/, '관장(체육관 owner)만 지도자를 내보낼 수 있고, owner 는 내보낼 수 없습니다.'],
  [/not a member/, '이 체육관 회원이 아닙니다.'],
  [/already reviewed/, '이미 처리된 신청입니다.'],
  [/row-level security|permission denied/, '권한이 없습니다.'],
];

export function serverMessage(e: unknown): string {
  const raw = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  for (const [re, ko] of SERVER_MESSAGES) if (re.test(raw)) return ko;
  return toKoreanAuthMessage(e);
}

/** Calls a SECURITY DEFINER RPC and maps its exception to Korean. */
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<AuthResult<T>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, message: serverMessage(error) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, message: serverMessage(e) };
  }
}

/** select/insert/update wrapper: run a query builder, map errors. */
export async function run<T>(q: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<AuthResult<T>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { data, error } = await q();
    if (error) return { ok: false, message: serverMessage(error) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, message: serverMessage(e) };
  }
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Client-side check (the bucket enforces the same limits server-side — 0057/0058). */
export function validateImage(file: File, allowGif = true): string | null {
  const types = allowGif ? IMAGE_TYPES : IMAGE_TYPES.filter((t) => t !== 'image/gif');
  if (!types.includes(file.type)) return 'JPG·PNG·WEBP' + (allowGif ? '·GIF' : '') + ' 이미지만 올릴 수 있습니다.';
  if (file.size > MAX_IMAGE_BYTES) return '이미지는 8MB 이하만 올릴 수 있습니다.';
  return null;
}

/** Uploads an image into `{bucket}/{userId}/…` (storage RLS only allows the user's own folder). */
export async function uploadImage(bucket: 'gear-media' | 'gym-media', file: File, userId: string): Promise<AuthResult<string>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const invalid = validateImage(file, bucket === 'gear-media');
  if (invalid) return { ok: false, message: invalid };
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  try {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { ok: false, message: serverMessage(error) };
    return { ok: true, data: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl };
  } catch (e) {
    return { ok: false, message: serverMessage(e) };
  }
}

export function formatWon(n: number | null | undefined): string {
  if (n === null || n === undefined) return '정보 없음';
  return `${n.toLocaleString('ko-KR')}원`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ko-KR');
}

/** Am I a platform admin? (reads my own platform_admins row — RLS lets each user see only their own) */
export async function amIPlatformAdmin(userId: string | null): Promise<boolean> {
  if (!supabase || !userId) return false;
  try {
    const { data } = await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}
