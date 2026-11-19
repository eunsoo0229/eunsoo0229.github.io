// /gear/mine — 내 장비 거래: 판매 상품 / 관심 상품 / 구매 내역 / 받은 후기
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate } from '../../lib/ecosystem/common';
import {
  GEAR_STATUS,
  listFavorites,
  listMyGear,
  listPurchases,
  listReviewsFor,
  sellerRating,
  setGearStatus,
  type GearListing,
  type GearReview,
  type GearStatus,
} from '../../lib/gear/service';
import { GearCard, NotConfigured, Stars } from './gearShared';

type Tab = 'selling' | 'favorites' | 'purchases' | 'reviews';
const TABS: { id: Tab; label: string }[] = [
  { id: 'selling', label: '판매 상품' },
  { id: 'favorites', label: '관심 상품' },
  { id: 'purchases', label: '구매 내역' },
  { id: 'reviews', label: '받은 후기' },
];

type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T };

export default function MyGear() {
  const { user, isConfigured } = useAuth();
  const [tab, setTab] = useState<Tab>('selling');
  const [listings, setListings] = useState<Loaded<GearListing[]>>({ state: 'loading' });
  const [reviews, setReviews] = useState<Loaded<GearReview[]>>({ state: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!user || !isConfigured) return;
    if (tab === 'reviews') {
      setReviews({ state: 'loading' });
      const r = await listReviewsFor(user.id);
      setReviews(r.ok ? { state: 'ok', data: r.data } : { state: 'error', message: r.message });
      return;
    }
    setListings({ state: 'loading' });
    const r = tab === 'selling' ? await listMyGear(user.id) : tab === 'favorites' ? await listFavorites(user.id) : await listPurchases(user.id);
    setListings(r.ok ? { state: 'ok', data: r.data } : { state: 'error', message: r.message });
  }, [tab, user, isConfigured]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isConfigured) return <NotConfigured fallback="/gear" />;
  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <EmptyState icon="🔒" text="내 거래 내역을 보려면 로그인이 필요합니다." />
          <div className="eco-row gear-center">
            <Link className="btn btn-primary" to="/login">
              로그인
            </Link>
          </div>
        </div>
      </div>
    );
  }

  async function quickStatus(item: GearListing, status: GearStatus) {
    setBusyId(item.id);
    setRowError(null);
    const r = await setGearStatus(item.id, status);
    setBusyId(null);
    if (!r.ok) {
      setRowError({ id: item.id, message: r.message });
      return;
    }
    setListings((cur) =>
      cur.state === 'ok'
        ? { state: 'ok', data: cur.data.map((g) => (g.id === item.id ? { ...g, status, buyerId: status === 'sold' ? g.buyerId : null } : g)) }
        : cur,
    );
  }

  function sellerControls(item: GearListing) {
    const removed = item.moderation === 'removed';
    return (
      <div className="gear-quick">
        <label className="gear-quick__label">
          <span className="eco-meta">상태</span>
          <select
            value={item.status}
            disabled={busyId === item.id}
            onChange={(e) => void quickStatus(item, e.target.value as GearStatus)}
            aria-label={`${item.title} 거래 상태`}
            data-testid={`gear-status-select-${item.id}`}
          >
            {(Object.keys(GEAR_STATUS) as GearStatus[])
              // 판매 완료(구매자 지정)는 상세 화면에서 처리한다
              .filter((s) => s !== 'sold' || item.status === 'sold')
              .map((s) => (
                <option key={s} value={s} disabled={removed && s !== 'hidden' && s !== item.status}>
                  {GEAR_STATUS[s]}
                </option>
              ))}
          </select>
        </label>
        {item.status !== 'sold' && !removed && (
          <Link to={`/gear/${item.id}`} className="btn btn-ghost btn-sm">
            판매 완료 처리
          </Link>
        )}
        {rowError?.id === item.id && <p className="gear-error">{rowError.message}</p>}
      </div>
    );
  }

  const emptyText: Record<Exclude<Tab, 'reviews'>, string> = {
    selling: '아직 올린 상품이 없습니다.',
    favorites: '찜한 상품이 없습니다. 마음에 드는 상품의 찜 버튼을 눌러 보세요.',
    purchases: '구매 내역이 없습니다. 판매자가 거래 완료 시 구매자로 지정하면 여기에 표시됩니다.',
  };

  return (
    <div className="page gear-page">
      <div className="container">
        <BackButton fallback="/gear" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">장비 거래</div>
            <h2>내 거래</h2>
          </div>
          <div className="eco-row">
            <Link className="btn btn-secondary btn-sm" to="/gear">
              <Icon name="search" /> 상품 보기
            </Link>
            <Link className="btn btn-secondary btn-sm" to="/gear/orders">
              <Icon name="card" /> 택배 거래 주문
            </Link>
            <Link className="btn btn-primary btn-sm" to="/gear/new">
              <Icon name="plus" /> 판매하기
            </Link>
          </div>
        </div>

        <div className="eco-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="eco-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'reviews' ? (
          reviews.state === 'loading' ? (
            <LoadingState />
          ) : reviews.state === 'error' ? (
            <ErrorState text={reviews.message} onRetry={() => void load()} />
          ) : reviews.data.length === 0 ? (
            <EmptyState icon="★" text="아직 받은 거래 후기가 없습니다." />
          ) : (
            <>
              {(() => {
                const sr = sellerRating(reviews.data);
                return (
                  <div className="eco-metrics">
                    <div className="eco-metric">
                      <div className="eco-metric__label">평균 별점</div>
                      <div className="eco-metric__value">{sr.avg?.toFixed(1) ?? '-'}</div>
                      <div className="eco-metric__sub">후기 {sr.count}개</div>
                    </div>
                  </div>
                );
              })()}
              <ul className="gear-reviews eco-card">
                {reviews.data.map((rv) => (
                  <li key={rv.listingId + rv.reviewerId}>
                    <div className="eco-row eco-row--between">
                      <Stars value={rv.rating} />
                      <span className="eco-meta--faint">{formatDate(rv.createdAt)}</span>
                    </div>
                    {rv.body ? <p>{rv.body}</p> : <p className="eco-meta--faint">내용 없는 별점 후기</p>}
                    <Link to={`/gear/${rv.listingId}`} className="eco-meta">
                      거래 상품 보기
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : listings.state === 'loading' ? (
          <LoadingState />
        ) : listings.state === 'error' ? (
          <ErrorState text={listings.message} onRetry={() => void load()} />
        ) : listings.data.length === 0 ? (
          <div>
            <EmptyState icon={tab === 'favorites' ? '☆' : '🛒'} text={emptyText[tab]} />
            {tab === 'selling' && (
              <div className="eco-row gear-center">
                <Link className="btn btn-primary btn-sm" to="/gear/new">
                  첫 상품 올리기
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="eco-grid eco-grid--tight gear-grid">
            {listings.data.map((it) => (
              <GearCard key={it.id} item={it} extra={tab === 'selling' ? sellerControls(it) : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
