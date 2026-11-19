import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../BackButton';
import Icon from '../Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatWon } from '../../lib/ecosystem/common';
import { hashRouteUrl, loadTossWidgets } from '../../lib/payments/tossCheckout';
import { isTossConfigured } from '../../lib/payments/tossConfig';
import {
  confirmCheckout,
  failCheckout,
  formatCoins,
  listCampaigns,
  recordCampaignEvent,
  type CheckoutKind,
  type CheckoutOrder,
  type PartnerCampaign,
} from '../../lib/monetization/service';
import { notifyMembershipChanged } from '../../lib/monetization/useMembership';
import type { AuthResult } from '../../lib/auth/authService';

export function MonoPage({ kicker, title, icon, lede, actions, fallback = '/', children }: { kicker: string; title: string; icon?: Parameters<typeof Icon>[0]['name']; lede?: ReactNode; actions?: ReactNode; fallback?: string; children: ReactNode }) {
  return (
    <div className="page mono-page">
      <div className="container">
        <BackButton fallback={fallback} />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">{kicker}</div>
            <h2>
              {icon && <Icon name={icon} />} {title}
            </h2>
            {lede && <p>{lede}</p>}
          </div>
          {actions && <div className="eco-row">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function CoinAmount({ value, unlimited, size = 'md' }: { value: number | null | undefined; unlimited?: boolean; size?: 'md' | 'lg' }) {
  return (
    <span className={`mono-coins mono-coins--${size}`} data-testid="coin-amount">
      <Icon name="coin" />
      {unlimited ? <strong title="운영자·개발자 계정: 무제한">∞</strong> : <strong>{formatCoins(value)}</strong>}
      <small>MC</small>
    </span>
  );
}

export function TestPaymentNotice() {
  return (
    <p className="eco-notice" data-testid="test-payment-notice">
      <Icon name="info" /> 지금은 <strong>테스트 결제</strong>만 가능합니다. 실제 돈은 청구되지 않으며, 실결제는 법률·결제사 검토 후 별도로 활성화됩니다.
    </p>
  );
}

/**
 * 구독·코인 결제. 주문은 서버가 만들고(금액도 서버 계산), 결제 성공 여부도 서버(payment-verify)가 판정한다.
 *  - Toss 클라이언트 키가 있으면: Toss 결제위젯 → 결제창 → #/billing/result 에서 서버 승인 확인
 *  - 없으면: 테스트 결제 버튼 → 서버 샌드박스(결제 키 미설정 시 관리자 계정만 허용)
 */
export function CheckoutPanel({ kind, title, create, onDone, testId }: { kind: CheckoutKind; title: string; create: () => Promise<AuthResult<CheckoutOrder>>; onDone?: (o: CheckoutOrder) => void; testId?: string }) {
  const { user } = useAuth();
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const widgetsRef = useRef<Awaited<ReturnType<typeof loadTossWidgets>> | null>(null);
  const toss = isTossConfigured();
  const sel = `mono-toss-${kind}`;

  useEffect(() => {
    if (!order || !user || !toss) return;
    let cancelled = false;
    (async () => {
      try {
        const widgets = await loadTossWidgets(user.id);
        if (cancelled) return;
        widgetsRef.current = widgets;
        await widgets.setAmount({ currency: 'KRW', value: order.amountKrw });
        await widgets.renderPaymentMethods({ selector: `#${sel}-method` });
        await widgets.renderAgreement({ selector: `#${sel}-agreement` });
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '결제 화면을 불러오지 못했습니다.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.orderId, user?.id, toss]);

  async function start() {
    setBusy(true);
    setError(null);
    const r = await create();
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setReady(false);
    setOrder(r.data);
  }

  async function payWithToss() {
    const widgets = widgetsRef.current;
    if (!widgets || !order) return;
    setBusy(true);
    try {
      const url = hashRouteUrl('/billing/result', { kind });
      await widgets.requestPayment({ orderId: order.orderId, orderName: `[MARTIALDEX] ${title}`.slice(0, 100), successUrl: url, failUrl: url });
    } catch (e) {
      const reason = e instanceof Error ? e.message : '결제창을 여는 중 오류가 발생했습니다.';
      await failCheckout(kind, order.orderId, reason);
      setOrder(null);
      setError(`결제를 진행하지 못했습니다: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function payTest() {
    if (!order) return;
    setBusy(true);
    setError(null);
    const r = await confirmCheckout(kind, order.orderId, null);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setOrder(null);
    notifyMembershipChanged();
    onDone?.(r.data);
  }

  async function cancel() {
    if (order) await failCheckout(kind, order.orderId, '사용자가 결제 전 취소');
    setOrder(null);
  }

  if (!user) return <p className="eco-meta">결제는 로그인 후 이용할 수 있습니다. <Link to="/login">로그인</Link></p>;
  return (
    <div className="eco-stack mono-checkout" data-testid={testId ?? `checkout-${kind}`}>
      {!order ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()} data-testid="checkout-start">
          {busy ? '주문 만드는 중…' : title}
        </button>
      ) : (
        <div className="eco-card eco-stack">
          <div className="eco-row eco-row--between">
            <strong>{title}</strong>
            <span className="eco-pill eco-pill--warn">테스트 결제</span>
          </div>
          <div className="eco-meta">
            결제 금액 <strong>{formatWon(order.amountKrw)}</strong> (서버 계산)
            {order.coins != null && ` · 지급 ${formatCoins((order.coins ?? 0) + (order.bonusCoins ?? 0))} MC`}
          </div>
          {toss ? (
            <>
              <div id={`${sel}-method`} />
              <div id={`${sel}-agreement`} />
              <div className="eco-row">
                <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void payWithToss()} data-testid="checkout-pay-toss">
                  {busy ? '처리 중…' : `${order.amountKrw.toLocaleString('ko-KR')}원 결제하기`}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void cancel()}>돌아가기</button>
              </div>
            </>
          ) : (
            <>
              <p className="eco-meta--faint">결제사 키가 설정되지 않은 환경입니다. 아래 버튼은 실제 결제 없이 서버의 테스트 승인 경로를 거칩니다.</p>
              <div className="eco-row">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void payTest()} data-testid="checkout-pay-test">
                  {busy ? '처리 중…' : '테스트 결제 진행'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void cancel()}>돌아가기</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="gear-error" role="alert" data-testid="checkout-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** 관리자 승인 제휴·광고 슬롯. 항상 '광고/제휴' 표시를 붙이고, 노출·클릭은 합계만 남긴다. */
export function PartnerSlot({ placement }: { placement: PartnerCampaign['placement'] }) {
  const [items, setItems] = useState<PartnerCampaign[]>([]);
  useEffect(() => {
    let alive = true;
    void listCampaigns(placement).then((r) => {
      if (!alive || !r.ok) return;
      setItems(r.data);
      for (const c of r.data) void recordCampaignEvent(c.id, 'impression');
    });
    return () => {
      alive = false;
    };
  }, [placement]);
  if (!items.length) return null;
  return (
    <aside className="mono-partner" aria-label="제휴·광고" data-testid={`partner-slot-${placement}`}>
      {items.map((c) => (
        <a
          key={c.id}
          className="mono-partner__item"
          href={c.link_url ?? undefined}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() => void recordCampaignEvent(c.id, 'click')}
        >
          <span className="eco-pill eco-pill--muted">{c.label}</span>
          {c.image_url && <img src={c.image_url} alt="" loading="lazy" />}
          <span className="mono-partner__text">
            <strong>{c.title}</strong>
            {c.body && <span>{c.body}</span>}
            <small>{c.partner_name}</small>
          </span>
        </a>
      ))}
    </aside>
  );
}
