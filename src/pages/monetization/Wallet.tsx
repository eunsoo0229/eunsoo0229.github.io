import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import { CoinAmount, MonoPage } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  LEDGER_LABEL,
  claimDailyCheckin,
  formatCoins,
  getMyWallet,
  listMyCoinOrders,
  listMyLedger,
  refundCoinOrder,
  type CoinOrder,
  type LedgerEntry,
  type Wallet as WalletRow,
} from '../../lib/monetization/service';
import { useMembership } from '../../lib/monetization/useMembership';

const ORDER_STATUS: Record<CoinOrder['status'], string> = { pending: '결제 대기', paid: '결제 완료', failed: '실패', cancelled: '취소', refunded: '환불' };

export default function Wallet() {
  const { user, isConfigured } = useAuth();
  const { membership } = useMembership();
  const { pathname } = useLocation();
  const historyOnly = pathname.endsWith('/history');
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [orders, setOrders] = useState<CoinOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [more, setMore] = useState(true);

  async function load() {
    if (!user) return;
    const [w, l, o] = await Promise.all([getMyWallet(user.id), listMyLedger(user.id, historyOnly ? 100 : 20), listMyCoinOrders(user.id)]);
    if (!w.ok) return setError(w.message);
    setWallet(w.data);
    setLedger(l.ok ? l.data : []);
    setMore(l.ok && l.data.length === (historyOnly ? 100 : 20));
    setOrders(o.ok ? o.data : []);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, historyOnly]);

  async function loadMore() {
    if (!user || !ledger?.length) return;
    const r = await listMyLedger(user.id, 100, ledger[ledger.length - 1].seq);
    if (r.ok) {
      setLedger([...ledger, ...r.data]);
      setMore(r.data.length === 100);
    }
  }

  async function checkin() {
    const r = await claimDailyCheckin();
    if (!r.ok) return setError(r.message);
    setNotice(`출석 보상 ${formatCoins(r.data.amount)} MC (하루 1회)`);
    void load();
  }

  async function refund(o: CoinOrder) {
    const reason = window.prompt('환불 사유를 입력해 주세요. (결제 후 7일 이내, 지급된 코인을 사용하지 않은 경우만)');
    if (!reason) return;
    const r = await refundCoinOrder(o.id, reason);
    if (!r.ok) return setError(r.message);
    setNotice('코인 구매가 환불되고 지급된 코인이 회수되었습니다.');
    void load();
  }

  if (!isConfigured) return <MonoPage kicker="WALLET" title="내 지갑" icon="coin"><EmptyState icon="🌐" text="클라우드 설정이 필요합니다." /></MonoPage>;
  if (!user) return <MonoPage kicker="WALLET" title="내 지갑" icon="coin"><EmptyState icon="🔒" text="로그인 후 이용할 수 있습니다." /></MonoPage>;

  const unlimited = !!membership?.privileged;
  const pendingOrders = orders.filter((o) => o.status === 'pending');
  return (
    <MonoPage
      kicker="MARTIAL COIN"
      title={historyOnly ? '거래 내역' : '내 지갑'}
      icon="coin"
      lede="모든 코인 변동은 서버 원장에 기록됩니다. 코인은 MARTIALDEX 안에서만 쓰이며 현금으로 바꿀 수 없습니다."
      actions={
        <>
          <Link className="btn btn-primary btn-sm" to="/wallet/store" data-testid="wallet-to-store">코인 충전</Link>
          {historyOnly ? <Link className="btn btn-ghost btn-sm" to="/wallet">지갑</Link> : <Link className="btn btn-ghost btn-sm" to="/wallet/history">전체 거래 내역</Link>}
        </>
      }
    >
      {error && <ErrorState text={error} onRetry={() => { setError(null); void load(); }} />}
      {notice && <p className="eco-notice eco-notice--accent" role="status" data-testid="wallet-notice">{notice}</p>}
      {!historyOnly && (
        <section className="mono-wallet" data-testid="wallet-card">
          <div className="mono-wallet__balance">
            <span className="eco-kicker">보유 코인</span>
            <CoinAmount value={wallet?.balance ?? 0} unlimited={unlimited} size="lg" />
            {unlimited && <span className="eco-pill eco-pill--accent">운영자·개발자 계정: 무제한 (구매 시 0코인으로 기록)</span>}
          </div>
          <div className="eco-metrics">
            <div className="eco-metric"><span>구매한 코인</span><strong>{formatCoins(wallet?.purchased_total)}</strong></div>
            <div className="eco-metric"><span>획득한 코인</span><strong>{formatCoins(wallet?.earned_total)}</strong></div>
            <div className="eco-metric"><span>사용한 코인</span><strong>{formatCoins(wallet?.spent_total)}</strong></div>
            <div className="eco-metric"><span>환불받은 코인</span><strong>{formatCoins(wallet?.refunded_total)}</strong></div>
            <div className="eco-metric"><span>회수된 코인</span><strong>{formatCoins(wallet?.clawback_total)}</strong></div>
            <div className="eco-metric"><span>보류 중 결제</span><strong>{pendingOrders.length}건</strong></div>
          </div>
          <div className="eco-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void checkin()} data-testid="wallet-checkin">출석 보상 받기</button>
            <Link className="btn btn-ghost btn-sm" to="/creator/revenue">판매 수익·정산</Link>
          </div>
        </section>
      )}

      <section className="eco-stack">
        <h3>{historyOnly ? '전체 원장' : '최근 거래'}</h3>
        {!ledger ? (
          <LoadingState />
        ) : ledger.length === 0 ? (
          <EmptyState icon="🪙" text="아직 코인 거래가 없습니다." />
        ) : (
          <div className="eco-table-wrap">
            <table className="eco-table" data-testid="ledger-table">
              <thead>
                <tr><th>일시</th><th>유형</th><th>내용</th><th>변동</th><th>잔액</th></tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.created_at).toLocaleString('ko-KR')}</td>
                    <td>{LEDGER_LABEL[e.entry_type]}</td>
                    <td>{e.note}</td>
                    <td className={e.amount < 0 ? 'mono-neg' : 'mono-pos'}>{e.amount > 0 ? '+' : ''}{formatCoins(e.amount)}</td>
                    <td>{formatCoins(e.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {historyOnly && more && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadMore()}>더 보기</button>}
      </section>

      <section className="eco-stack">
        <h3>코인 구매·환불 내역</h3>
        {orders.length === 0 ? (
          <EmptyState icon="🧾" text="코인 구매 내역이 없습니다." />
        ) : (
          <div className="eco-table-wrap">
            <table className="eco-table" data-testid="coin-orders">
              <thead>
                <tr><th>일시</th><th>상품</th><th>금액</th><th>상태</th><th></th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{formatDate(o.paid_at ?? o.created_at)}</td>
                    <td>{formatCoins(o.coins + o.bonus_coins)} MC</td>
                    <td>{formatWon(o.amount_krw)}</td>
                    <td>{ORDER_STATUS[o.status]}{o.is_test ? ' (테스트)' : ''}{o.refund_shortfall > 0 ? ` · 미회수 ${formatCoins(o.refund_shortfall)}` : ''}</td>
                    <td>{o.status === 'paid' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refund(o)}>환불 요청</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </MonoPage>
  );
}
