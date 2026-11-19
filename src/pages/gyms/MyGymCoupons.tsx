import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import { COUPON_STATE_LABEL, cancelCoupon, couponState, listMyCoupons, type GymCoupon } from '../../lib/gymDirectory/service';
import { GymPage, NotConfigured } from './gymShared';

type Row = GymCoupon & { listingName: string; offerTitle: string };

const STATE_PILL = {
  issued: 'eco-pill eco-pill--accent',
  redeemed: 'eco-pill eco-pill--good',
  cancelled: 'eco-pill eco-pill--muted',
  expired: 'eco-pill eco-pill--muted',
} as const;

export default function MyGymCoupons() {
  const { user, isConfigured } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setError(null);
    const r = await listMyCoupons(user.id);
    if (r.ok) setRows(r.data);
    else setError(r.message);
  }

  useEffect(() => {
    if (!isConfigured || !user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, user?.id]);

  if (!isConfigured) return <NotConfigured />;
  if (!user) {
    return (
      <GymPage>
        <EmptyState icon="🔒" text="내 할인 쿠폰을 보려면 로그인이 필요합니다." />
        <div className="eco-row">
          <Link className="btn btn-primary" to="/login">
            로그인
          </Link>
        </div>
      </GymPage>
    );
  }

  async function handleCancel(c: Row) {
    if (!window.confirm(`${c.listingName} 쿠폰(${c.code})을 취소할까요? 취소하면 다시 받을 수 없습니다.`)) return;
    setBusy(c.id);
    setActionMsg(null);
    const r = await cancelCoupon(c.id);
    setBusy(null);
    if (!r.ok) {
      setActionMsg(`쿠폰을 취소하지 못했습니다. 이미 사용했거나 취소된 쿠폰일 수 있습니다.`);
      return;
    }
    void load();
  }

  return (
    <GymPage>
      <div className="breadcrumb">
        <Link to="/gyms">체육관 검색</Link>
        <span>/</span>
        <span>내 쿠폰</span>
      </div>
      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">MARTIALDEX 제휴</div>
          <h2>내 체육관 할인 쿠폰</h2>
          <p>체육관에 등록할 때 쿠폰 코드를 보여 주세요. 체육관이 코드를 확인하면 "사용 완료 · 등록 확인"으로 바뀝니다.</p>
        </div>
        <Link className="btn btn-secondary btn-sm" to="/gyms/deals">
          제휴 할인 보기
        </Link>
      </div>
      {actionMsg && (
        <p className="eco-meta" role="alert">
          {actionMsg}
        </p>
      )}

      {error ? (
        <ErrorState text={error} onRetry={() => void load()} />
      ) : !rows ? (
        <LoadingState text="쿠폰을 불러오는 중..." />
      ) : rows.length === 0 ? (
        <EmptyState icon="📭" text="받은 쿠폰이 없습니다. 제휴 체육관의 할인 페이지에서 쿠폰을 받을 수 있습니다." />
      ) : (
        <div className="eco-grid">
          {rows.map((c) => {
            const st = couponState(c);
            return (
              <div key={c.id} className="eco-card eco-stack">
                <div className="eco-row eco-row--between">
                  <span className={STATE_PILL[st]}>{COUPON_STATE_LABEL[st]}</span>
                  <span className="eco-meta--faint">발급 {formatDate(c.issuedAt)}</span>
                </div>
                <div className="gym-coupon-code" data-testid="gym-coupon-code" style={st === 'issued' ? undefined : { color: 'var(--text-faint)' }}>
                  {c.code}
                </div>
                <div>
                  <Link to={`/gyms/${c.listingId}`}>
                    <strong>{c.listingName}</strong>
                  </Link>
                  {c.offerTitle && <div className="eco-meta">{c.offerTitle}</div>}
                </div>
                <div className="eco-row">
                  <span className="eco-price eco-price--strike">{formatWon(c.originalPrice)}</span>
                  <span className="eco-price">{formatWon(c.discountedPrice)}</span>
                </div>
                <div className="eco-meta">
                  {st === 'redeemed' && c.redeemedAt ? `등록 확인일 ${formatDate(c.redeemedAt)}` : `사용 기한 ${formatDate(c.expiresAt)}까지`}
                </div>
                {st === 'issued' && (
                  <div>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => handleCancel(c)}>
                      쿠폰 취소
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </GymPage>
  );
}
