import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import GearOrderExtras from '../../components/monetization/GearOrderExtras';
import { COURIERS, ORDER_STATUS_LABEL, confirmReceived, listMyOrders, markShipped, refundGearOrder, type GearOrder } from '../../lib/gear/orders';

/** 택배 거래 주문 관리 — 구매: 결제 내역·송장·수령 확인·발송 전 취소 / 판매: 배송지·발송 처리·발송 전 취소 */
export default function GearOrders() {
  const { user, isConfigured } = useAuth();
  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer');
  const [orders, setOrders] = useState<GearOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setOrders(null);
    setError(null);
    const r = await listMyOrders(user.id, tab);
    if (r.ok) setOrders(r.data);
    else setError(r.message);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tab]);

  if (!isConfigured || !user) {
    return (
      <div className="page"><div className="container">
        <BackButton fallback="/gear" />
        <EmptyState icon="🔒" text="로그인하면 택배 거래 주문을 볼 수 있습니다." />
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/gear/mine" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">장비 중고거래</div>
            <h2>택배 거래 주문</h2>
            <p>현재 Toss 테스트 결제입니다. 실제 돈은 빠져나가지 않습니다.</p>
          </div>
          <Link to="/gear/mine" className="btn btn-secondary btn-sm">내 거래 관리</Link>
        </div>
        <div className="eco-tabs" role="tablist">
          <button type="button" role="tab" className="eco-tab" aria-selected={tab === 'buyer'} onClick={() => setTab('buyer')} data-testid="gear-orders-tab-buyer">구매한 주문</button>
          <button type="button" role="tab" className="eco-tab" aria-selected={tab === 'seller'} onClick={() => setTab('seller')} data-testid="gear-orders-tab-seller">판매한 주문</button>
        </div>
        {notice && <div className="eco-notice eco-notice--accent" role="status">{notice}</div>}
        {error && <ErrorState text={error} onRetry={load} />}
        {!error && orders === null && <p className="eco-meta">불러오는 중…</p>}
        {orders && orders.length === 0 && <EmptyState icon="📭" text={tab === 'buyer' ? '택배로 구매한 주문이 없습니다.' : '택배로 판매한 주문이 없습니다.'} />}
        <div className="eco-stack">
          {orders?.map((o) => <OrderCard key={o.orderId} o={o} role={tab} onDone={(m) => { setNotice(m); void load(); }} />)}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ o, role, onDone }: { o: GearOrder; role: 'buyer' | 'seller'; onDone: (msg: string) => void }) {
  const [courier, setCourier] = useState(COURIERS[0]);
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    setBusy(true);
    setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setErr(r.message ?? '처리하지 못했습니다.');
    else onDone(done);
  }

  return (
    <div className="eco-card" data-testid="gear-order-card" data-status={o.status}>
      <div className="eco-row eco-row--between">
        <Link to={`/gear/${o.listingId}`}><strong>{o.itemTitle}</strong></Link>
        <span className={`eco-pill ${o.status === 'delivered' ? 'eco-pill--good' : o.status === 'paid' || o.status === 'shipped' ? 'eco-pill--accent' : 'eco-pill--muted'}`} data-testid="gear-order-status">{ORDER_STATUS_LABEL[o.status]}</span>
      </div>
      <div className="eco-meta">
        상품 {formatWon(o.itemPrice)} + 배송비 {formatWon(o.shippingFee)} = <strong>{formatWon(o.amount)}</strong> · 주문 {formatDate(o.createdAt)}
        {o.paidAt && ` · 결제 ${formatDate(o.paidAt)}`}
      </div>
      {role === 'seller' && (o.status === 'paid' || o.status === 'shipped') && (
        <div className="eco-meta" style={{ marginTop: 6, color: 'var(--text)' }}>
          <Icon name="pin" /> {o.recipientName} · {o.recipientPhone} · {o.address}{o.deliveryMemo ? ` (${o.deliveryMemo})` : ''}
        </div>
      )}
      {o.trackingNumber && <div className="eco-meta" style={{ marginTop: 4 }}>송장: {o.courier} {o.trackingNumber}{o.shippedAt ? ` · 발송 ${formatDate(o.shippedAt)}` : ''}</div>}
      {o.statusReason && (o.status === 'refunded' || o.status === 'cancelled' || o.status === 'failed') && <div className="eco-meta">사유: {o.statusReason}</div>}

      {role === 'seller' && o.status === 'paid' && (
        <div className="eco-form" style={{ marginTop: 8 }}>
          <div className="eco-form-grid">
            <label>택배사<select value={courier} onChange={(e) => setCourier(e.target.value)}>{COURIERS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>송장 번호<input value={tracking} maxLength={40} onChange={(e) => setTracking(e.target.value)} data-testid="gear-tracking-input" /></label>
          </div>
          <div className="eco-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || tracking.trim().length < 4} onClick={() => void act(() => markShipped(o.orderId, courier, tracking), '발송 처리했습니다.')} data-testid="gear-mark-shipped">발송 처리</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => confirm('결제를 취소하고 구매자에게 환불할까요?') && void act(() => refundGearOrder(o.orderId, '판매자 사정'), '결제를 취소했습니다. 상품은 다시 판매 중입니다.')} data-testid="gear-refund">결제 취소(환불)</button>
          </div>
        </div>
      )}
      {role === 'buyer' && o.status === 'paid' && (
        <div className="eco-row" style={{ marginTop: 8 }}>
          <span className="eco-meta">판매자가 발송하기 전입니다.</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => confirm('결제를 취소할까요? 발송 전이라 바로 환불됩니다.') && void act(() => refundGearOrder(o.orderId, '구매자 변심'), '결제를 취소했습니다.')} data-testid="gear-refund">결제 취소</button>
        </div>
      )}
      {role === 'buyer' && o.status === 'shipped' && (
        <div className="eco-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(() => confirmReceived(o.orderId), '수령을 확인했습니다. 거래 후기를 남겨 주세요.')} data-testid="gear-confirm-received">상품 받았어요 (수령 확인)</button>
          <span className="eco-meta--faint">발송 후 문제가 있으면 판매자에게 DM 하거나 상품을 신고해 주세요.</span>
        </div>
      )}
      <GearOrderExtras orderId={o.orderId} status={o.status} role={role} />
      {err && <p className="gear-error" role="alert">{err}</p>}
    </div>
  );
}
