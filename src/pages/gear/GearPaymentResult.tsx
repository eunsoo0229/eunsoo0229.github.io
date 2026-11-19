import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import { confirmGearPayment, failGearPayment } from '../../lib/gear/orders';
import { tossReturnParams } from '../../lib/payments/tossCheckout';

type State = { phase: 'processing' } | { phase: 'success'; amount: number } | { phase: 'failed'; message: string };

/**
 * Toss 결제창의 successUrl·failUrl. 이 화면의 URL 자체는 아무것도 증명하지 않는다 —
 * paymentKey 를 서버(payment-verify gear_confirm)에 넘기고, 서버가 Toss 승인 API 로 금액·주문을 대조한 뒤에만 결제 완료.
 */
export default function GearPaymentResult() {
  const [hashParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ phase: 'processing' });
  const started = useRef(false);

  useEffect(() => {
    // the confirm/fail call must go out exactly once (React StrictMode runs effects twice in development)
    if (started.current) return;
    started.current = true;
    const p = tossReturnParams(hashParams);
    const orderId = p.get('orderId') ?? p.get('gearOrderId') ?? '';
    const paymentKey = p.get('paymentKey');
    const failCode = p.get('code');
    (async () => {
      if (!orderId) return setState({ phase: 'failed', message: '주문 정보가 없습니다.' });
      if (failCode) {
        await failGearPayment(orderId, p.get('message') ?? failCode);
        return setState({ phase: 'failed', message: p.get('message') ?? '결제가 취소되었거나 실패했습니다.' });
      }
      if (!paymentKey) return setState({ phase: 'failed', message: '결제 승인 정보를 받지 못했습니다.' });
      const r = await confirmGearPayment(orderId, paymentKey);
      if (!r.ok) return setState({ phase: 'failed', message: r.message });
      setState({ phase: 'success', amount: r.data.amount });
      setTimeout(() => navigate('/gear/orders'), 2500);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/gear" />
        {state.phase === 'processing' && <EmptyState icon="⏳" text="결제 승인을 서버에서 확인하는 중입니다..." />}
        {state.phase === 'success' && (
          <div className="eco-card" data-testid="gear-payment-success">
            <h3>결제가 완료되었습니다</h3>
            <p className="eco-meta">{state.amount.toLocaleString('ko-KR')}원 결제가 서버에서 확인되었습니다. 판매자가 발송하면 송장 번호가 표시됩니다. (테스트 결제)</p>
            <Link className="btn btn-primary" to="/gear/orders">내 주문 보기</Link>
          </div>
        )}
        {state.phase === 'failed' && (
          <div className="eco-card" data-testid="gear-payment-failed">
            <p className="ai-error" role="alert">결제를 완료하지 못했습니다: {state.message}</p>
            <Link className="btn btn-secondary" to="/gear">마켓으로 돌아가기</Link>
          </div>
        )}
      </div>
    </div>
  );
}
