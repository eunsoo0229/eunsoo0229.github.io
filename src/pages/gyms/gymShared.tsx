// 체육관 검색·제휴 화면 공용 조각. 실제 데이터는 전부 gymDirectory/service.ts 에서 오며,
// 여기서는 표시 규칙(특히 "검증된 원래 가격이 있을 때만 할인가 표시")만 한 곳에 모은다.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import { GYM_ARTS, PLAN_LABEL, type GymArt, type GymListing, type GymOffer, type GymPricing } from '../../lib/gymDirectory/service';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function GymPage({ children, back = '/gyms' }: { children: ReactNode; back?: string }) {
  return (
    <div className="page">
      <div className="container">
        <BackButton fallback={back} />
        {children}
      </div>
    </div>
  );
}

export function NotConfigured({ back = '/gyms' }: { back?: string }) {
  return (
    <GymPage back={back}>
      <EmptyState icon="🏛" text="체육관 검색·제휴 기능은 Supabase(클라우드) 설정이 필요합니다. 앱 관리자에게 설정을 요청해 주세요." />
    </GymPage>
  );
}

export function LoginLink({ text }: { text: string }) {
  return (
    <p className="eco-meta">
      {text} <Link to="/login">로그인</Link>
    </p>
  );
}

export function ArtPills({ arts }: { arts: GymArt[] }) {
  return (
    <>
      {arts.map((a) => (
        <span key={a} className="eco-pill">
          {GYM_ARTS[a] ?? a}
        </span>
      ))}
    </>
  );
}

export function PricingVerifiedPill({ pricing }: { pricing: GymPricing | null }) {
  if (!pricing) return <span className="eco-pill eco-pill--muted">가격 미등록</span>;
  if (pricing.verifiedAt) return <span className="eco-pill eco-pill--good">가격 플랫폼 검증</span>;
  return <span className="eco-pill eco-pill--warn">가격 미검증</span>;
}

export const OFFER_TARGET_LABEL: Record<GymOffer['target'], string> = { new_members: '신규 회원 대상', everyone: '누구나' };
export const OFFER_STATUS_LABEL: Record<GymOffer['status'], string> = { draft: '초안', active: '진행 중', paused: '일시 중지', ended: '종료' };
export const LISTING_STATUS_LABEL: Record<GymListing['status'], string> = { pending: '검토 중', approved: '공개', rejected: '반려', suspended: '정지' };
export const LISTING_STATUS_PILL: Record<GymListing['status'], string> = {
  pending: 'eco-pill eco-pill--warn',
  approved: 'eco-pill eco-pill--good',
  rejected: 'eco-pill eco-pill--accent',
  suspended: 'eco-pill eco-pill--muted',
};

export function offerDiscountText(o: Pick<GymOffer, 'discountType' | 'discountValue' | 'plan'>): string {
  const amount = o.discountType === 'percent' ? `${o.discountValue}% 할인` : `${o.discountValue.toLocaleString('ko-KR')}원 할인`;
  return `${PLAN_LABEL[o.plan] ?? o.plan} ${amount}`;
}

/** 공개 쪽에서는 발급 수를 볼 수 없으므로 상한만 알린다(남은 수량을 추정하지 않는다). */
export function offerLimitText(o: GymOffer): string {
  return o.maxRedemptions === null ? '인원 제한 없음' : `선착순 ${o.maxRedemptions.toLocaleString('ko-KR')}명 한정 · 다 차면 발급이 마감됩니다`;
}

export function offerPeriodText(o: GymOffer): string {
  return `${formatDate(o.startsAt)} ~ ${formatDate(o.endsAt)}`;
}

export function isOfferLive(o: GymOffer, now = Date.now()): boolean {
  return o.status === 'active' && new Date(o.startsAt).getTime() <= now && new Date(o.endsAt).getTime() >= now;
}

/** 원래 가격이 플랫폼 검증되고 서버가 할인가를 계산했을 때만 금액을 보여 준다. */
export function OfferPrice({ offer }: { offer: GymOffer }) {
  if (offer.priceVerified && offer.discountedPrice != null && offer.originalPrice != null) {
    return (
      <div className="eco-row">
        <span className="eco-price--strike eco-price">{formatWon(offer.originalPrice)}</span>
        <span className="eco-price">{formatWon(offer.discountedPrice)}</span>
        <span className="eco-pill eco-pill--accent">MARTIALDEX 제휴 가격</span>
      </div>
    );
  }
  return <p className="eco-meta">원래 가격 검증 전이라 할인가를 표시하지 않습니다.</p>;
}

/** http(s) 주소만 링크로 만든다(javascript: 등 차단). */
export function safeHref(v: string): string | null {
  const s = v.trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

export function mapHref(l: Pick<GymListing, 'lat' | 'lng' | 'address'>): string {
  if (l.lat !== null && l.lng !== null) return `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=17/${l.lat}/${l.lng}`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(l.address)}`;
}
