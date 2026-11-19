import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { MonoPage } from '../../components/monetization/shared';
import { tossReturnParams } from '../../lib/payments/tossCheckout';
import { checkoutKindOf, confirmCheckout, failCheckout, formatCoins, type CheckoutOrder } from '../../lib/monetization/service';
import { notifyMembershipChanged } from '../../lib/monetization/useMembership';

type State = { phase: 'processing' } | { phase: 'success'; order: CheckoutOrder } | { phase: 'failed'; message: string };

/**
 * Toss successUrl/failUrl for 구독·코인. The URL proves nothing: paymentKey goes to the server
 * (payment-verify sub_confirm / coin_confirm), which checks amount and order with Toss before granting.
 */
export default function BillingResult() {
  const [hashParams] = useSearchParams();
  const [state, setState] = useState<State>({ phase: 'processing' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const p = tossReturnParams(hashParams);
    const orderId = p.get('orderId') ?? '';
    const kind = checkoutKindOf(orderId);
    (async () => {
      if (!orderId || !kind) return setState({ phase: 'failed', message: '주문 정보가 없습니다.' });
      if (p.get('code')) {
        await failCheckout(kind, orderId, p.get('message') ?? p.get('code') ?? '결제 실패');
        return setState({ phase: 'failed', message: p.get('message') ?? '결제가 취소되었거나 실패했습니다.' });
      }
      const paymentKey = p.get('paymentKey');
      if (!paymentKey) return setState({ phase: 'failed', message: '결제 승인 정보를 받지 못했습니다.' });
      const r = await confirmCheckout(kind, orderId, paymentKey);
      if (!r.ok) return setState({ phase: 'failed', message: r.message });
      notifyMembershipChanged();
      setState({ phase: 'success', order: r.data });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MonoPage kicker="BILLING" title="결제 결과" icon="card">
      {state.phase === 'processing' && <EmptyState icon="⏳" text="결제 승인을 서버에서 확인하는 중입니다..." />}
      {state.phase === 'success' && (
        <div className="eco-card eco-stack" data-testid="billing-success">
          <h3>결제가 완료되었습니다{state.order.isTest ? ' (테스트 결제)' : ''}</h3>
          {state.order.coins != null ? (
            <p className="eco-meta">{formatCoins((state.order.coins ?? 0) + (state.order.bonusCoins ?? 0))} MC 가 지갑에 지급되었습니다.</p>
          ) : (
            <p className="eco-meta">{state.order.planId?.toUpperCase()} 구독이 서버에서 확인되었습니다.</p>
          )}
          <Link className="btn btn-primary" to={state.order.coins != null ? '/wallet' : state.order.gymId ? '/business' : '/membership'}>확인</Link>
        </div>
      )}
      {state.phase === 'failed' && (
        <div className="eco-card" data-testid="billing-failed">
          <p className="ai-error" role="alert">결제를 완료하지 못했습니다: {state.message}</p>
          <Link className="btn btn-secondary" to="/membership">돌아가기</Link>
        </div>
      )}
    </MonoPage>
  );
}
