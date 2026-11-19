import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { listAllActiveOffers, type GymListing, type GymOffer } from '../../lib/gymDirectory/service';
import { ArtPills, GymPage, NotConfigured, OFFER_TARGET_LABEL, OfferPrice, offerDiscountText, offerLimitText, offerPeriodText } from './gymShared';

// 제휴 할인 모아 보기 — 플랫폼이 계약을 확인한(활성 제휴) 체육관의 진행 중 할인만 서버가 내려 준다.
export default function GymDeals() {
  const { user, isConfigured } = useAuth();
  const [rows, setRows] = useState<{ offer: GymOffer; listing: GymListing }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    setError(null);
    setRows(null);
    void listAllActiveOffers().then((r) => {
      if (cancelled) return;
      if (r.ok) setRows(r.data);
      else setError(r.message);
    });
    return () => {
      cancelled = true;
    };
  }, [isConfigured, reloadKey]);

  const groups = useMemo(() => {
    const m = new Map<string, { listing: GymListing; offers: GymOffer[] }>();
    for (const r of rows ?? []) {
      const g = m.get(r.listing.id) ?? { listing: r.listing, offers: [] };
      g.offers.push(r.offer);
      m.set(r.listing.id, g);
    }
    return [...m.values()];
  }, [rows]);

  if (!isConfigured) return <NotConfigured />;

  return (
    <GymPage>
      <div className="breadcrumb">
        <Link to="/gyms">체육관 검색</Link>
        <span>/</span>
        <span>제휴 할인</span>
      </div>
      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">MARTIALDEX 제휴</div>
          <h2>제휴 체육관 할인</h2>
          <p>플랫폼이 제휴 계약을 확인한 체육관만 이곳에 할인을 올릴 수 있습니다. 할인가는 플랫폼이 검증한 원래 가격에서 서버가 계산합니다.</p>
        </div>
        <Link className="btn btn-secondary btn-sm" to="/gyms/coupons">
          <Icon name="card" /> 내 쿠폰
        </Link>
      </div>

      <div className="eco-notice eco-notice--accent gym-example" aria-label="화면 예시">
        <div className="gym-example__label">화면 예시</div>
        <div className="eco-row" style={{ margin: '6px 0' }}>
          <span>일반 가격</span>
          <span className="eco-price eco-price--strike">150,000원</span>
          <span aria-hidden="true">→</span>
          <span>MARTIALDEX 제휴 가격</span>
          <span className="eco-price">120,000원</span>
        </div>
        <div className="eco-meta">예시이며 실제 체육관 가격이 아닙니다. 할인이 이런 형태로 표시된다는 것만 보여 줍니다.</div>
      </div>

      <div className="eco-section">
        <h3>진행 중인 할인</h3>
      </div>
      {error ? (
        <ErrorState text={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !rows ? (
        <LoadingState text="할인을 불러오는 중..." />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="🏛"
          text="지금 진행 중인 제휴 할인이 없습니다. 체육관이 제휴를 신청하고 플랫폼이 계약을 확인한 뒤에만 할인이 공개됩니다."
        />
      ) : (
        <div className="eco-stack">
          {groups.map(({ listing, offers }) => (
            <div key={listing.id} className="eco-card eco-stack">
              <div className="eco-row eco-row--between">
                <h3 style={{ margin: 0 }}>
                  <Link to={`/gyms/${listing.id}`}>{listing.name}</Link>
                </h3>
                <span className="eco-pill eco-pill--accent">제휴</span>
              </div>
              <div className="eco-row">
                <span className="eco-meta">
                  <Icon name="pin" /> {listing.region}
                </span>
                <ArtPills arts={listing.arts} />
              </div>
              {offers.map((o) => (
                <div key={o.id} className="eco-stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div className="eco-row eco-row--between">
                    <strong>{o.title}</strong>
                    <span className="eco-pill">{offerDiscountText(o)}</span>
                  </div>
                  <OfferPrice offer={o} />
                  <div className="eco-meta">
                    {offerPeriodText(o)} · {OFFER_TARGET_LABEL[o.target]} · {offerLimitText(o)}
                  </div>
                  {o.terms && <div className="eco-meta" style={{ whiteSpace: 'pre-wrap' }}>조건: {o.terms}</div>}
                </div>
              ))}
              <div className="eco-row">
                <Link className="btn btn-primary btn-sm" to={`/gyms/${listing.id}`}>
                  {user ? '쿠폰 받으러 가기' : '자세히 보기'}
                </Link>
                {!user && (
                  <span className="eco-meta">
                    쿠폰을 받으려면 <Link to="/login">로그인</Link>이 필요합니다.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GymPage>
  );
}
