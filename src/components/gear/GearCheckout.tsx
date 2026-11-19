import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatWon } from '../../lib/ecosystem/common';
import type { GearListing } from '../../lib/gear/service';
import { createGearOrder, failGearPayment, validateShipping, type GearCheckoutOrder, type ShippingInfo } from '../../lib/gear/orders';
import { hashRouteUrl, loadTossWidgets } from '../../lib/payments/tossCheckout';
import { isTossConfigured } from '../../lib/payments/tossConfig';

/**
 * 택배 거래 결제 — 배송지 입력 → 서버가 주문(상품 가격 + 배송비) 생성 → Toss 결제위젯 → Toss 결제창 →
 * #/gear/payment/result 에서 서버 승인 확인. 이 컴포넌트는 결제 성공을 판단하지 않는다.
 */
export default function GearCheckout({ listing }: { listing: GearListing }) {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [ship, setShip] = useState<ShippingInfo>({ name: profile?.nickname ?? '', phone: '', address: '', memo: '' });
  const [order, setOrder] = useState<GearCheckoutOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const widgetsRef = useRef<Awaited<ReturnType<typeof loadTossWidgets>> | null>(null);

  const total = listing.price + listing.shippingFee;

  useEffect(() => {
    if (!order || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const widgets = await loadTossWidgets(user.id);
        if (cancelled) return;
        widgetsRef.current = widgets;
        await widgets.setAmount({ currency: 'KRW', value: order.amount });
        await widgets.renderPaymentMethods({ selector: '#gear-toss-method' });
        await widgets.renderAgreement({ selector: '#gear-toss-agreement' });
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '결제 화면을 불러오지 못했습니다.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.orderId, user?.id]);

  if (!listing.shippingAvailable || listing.status !== 'active') return null;

  async function startOrder() {
    const invalid = validateShipping(ship);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    const r = await createGearOrder(listing.id, ship);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setReady(false);
    setOrder(r.data);
  }

  async function pay() {
    const widgets = widgetsRef.current;
    if (!widgets || !order) return;
    setBusy(true);
    try {
      const resultUrl = hashRouteUrl('/gear/payment/result', { gearOrderId: order.orderId });
      await widgets.requestPayment({ orderId: order.orderId, orderName: `[MARTIALDEX 중고] ${order.itemTitle}`.slice(0, 100), successUrl: resultUrl, failUrl: resultUrl });
      // success → the page redirects away
    } catch (e) {
      const reason = e instanceof Error ? e.message : '결제창을 여는 중 오류가 발생했습니다.';
      await failGearPayment(order.orderId, reason);
      setOrder(null);
      setError(`결제를 진행하지 못했습니다: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="eco-card eco-stack" data-testid="gear-checkout">
      <div className="eco-row eco-row--between">
        <strong><Icon name="card" /> 택배로 구매하기</strong>
        <span className="eco-pill eco-pill--warn">테스트 결제</span>
      </div>
      <div className="eco-meta">
        상품 {formatWon(listing.price)} + 배송비 {listing.shippingFee ? formatWon(listing.shippingFee) : '무료'} = <strong>{formatWon(total)}</strong>
      </div>
      {!isTossConfigured() ? (
        <p className="eco-meta">결제 기능이 설정되지 않은 환경입니다. 판매자에게 문의해 거래해 주세요.</p>
      ) : !user ? (
        <p className="eco-meta">택배 구매는 로그인 후 이용할 수 있습니다.</p>
      ) : total < 100 ? (
        <p className="eco-meta">100원 미만 상품은 결제할 수 없습니다. 판매자에게 문의해 직거래하세요.</p>
      ) : !open ? (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="gear-buy-shipping">택배로 구매 (결제)</button>
      ) : !order ? (
        <div className="eco-form">
          <div className="eco-form-grid">
            <label>받는 분<input value={ship.name} maxLength={40} onChange={(e) => setShip({ ...ship, name: e.target.value })} data-testid="gear-ship-name" /></label>
            <label>연락처<input value={ship.phone} maxLength={20} inputMode="tel" onChange={(e) => setShip({ ...ship, phone: e.target.value })} placeholder="010-0000-0000" data-testid="gear-ship-phone" /></label>
          </div>
          <label>주소<input value={ship.address} maxLength={200} onChange={(e) => setShip({ ...ship, address: e.target.value })} placeholder="도로명 주소와 상세 주소" data-testid="gear-ship-address" /></label>
          <label>배송 메모 (선택)<input value={ship.memo} maxLength={200} onChange={(e) => setShip({ ...ship, memo: e.target.value })} /></label>
          <p className="eco-meta--faint">배송지는 이 주문의 판매자에게만 보입니다. 결제 대금은 MARTIALDEX 가 받으며, 판매자가 발송하기 전에는 결제를 취소할 수 있습니다.</p>
          <div className="eco-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startOrder()} data-testid="gear-order-create">{busy ? '주문 만드는 중…' : '결제 단계로'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="eco-stack">
          <div className="eco-meta">주문 금액 {formatWon(order.amount)} (서버 계산)</div>
          <div id="gear-toss-method" />
          <div id="gear-toss-agreement" />
          <div className="eco-row">
            <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void pay()} data-testid="gear-pay">{busy ? '처리 중…' : `${order.amount.toLocaleString('ko-KR')}원 결제하기`}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={async () => { await failGearPayment(order.orderId, '사용자가 결제 전 취소'); setOrder(null); }}>
              돌아가기
            </button>
          </div>
        </div>
      )}
      {error && <p className="gear-error" role="alert">{error}</p>}
    </div>
  );
}
