import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import { MonoPage } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  SETTLEMENT_STATUS_LABEL,
  convertEarningsToCoins,
  formatCoins,
  getMyCreatorSummary,
  getProductsByIds,
  listMySales,
  listMySettlements,
  requestSettlement,
  type ContentPurchase,
  type CreatorSummary,
  type Settlement,
} from '../../lib/monetization/service';

export default function CreatorRevenue() {
  const { user } = useAuth();
  const [sum, setSum] = useState<CreatorSummary | null>(null);
  const [sales, setSales] = useState<ContentPurchase[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    const [s, sl, st] = await Promise.all([getMyCreatorSummary(), listMySales(user.id), listMySettlements(user.id)]);
    if (!s.ok) return setError(s.message);
    setSum(s.data);
    const rows = sl.ok ? sl.data : [];
    setSales(rows);
    setSettlements(st.ok ? st.data : []);
    const ps = await getProductsByIds([...new Set(rows.map((r) => r.product_id))]);
    setTitles(new Map((ps.ok ? ps.data : []).map((p) => [p.id, p.title])));
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const byProduct = useMemo(() => {
    const m = new Map<string, { count: number; gross: number; fee: number; earn: number }>();
    for (const s of sales) {
      if (s.status !== 'completed' || s.privileged_comp) continue;
      const e = m.get(s.product_id) ?? { count: 0, gross: 0, fee: 0, earn: 0 };
      m.set(s.product_id, { count: e.count + 1, gross: e.gross + s.price_coins, fee: e.fee + s.platform_fee_coins, earn: e.earn + s.creator_earning_coins });
    }
    return [...m.entries()].sort((a, b) => b[1].gross - a[1].gross);
  }, [sales]);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) if (s.status === 'completed' && !s.privileged_comp) m.set(s.created_at.slice(0, 7), (m.get(s.created_at.slice(0, 7)) ?? 0) + s.price_coins);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  }, [sales]);

  async function settle() {
    const r = await requestSettlement();
    if (!r.ok) return setError(r.message);
    setNotice(r.data.status === 'on_hold' ? `정산 요청이 보류되었습니다: ${r.data.hold_reason}` : '정산 요청이 접수되었습니다. (시뮬레이션 — 실제 지급 없음)');
    void load();
  }

  async function convert() {
    if (!window.confirm('정산 가능한 수익 전부를 MARTIAL COIN 으로 전환할까요? 전환한 수익은 현금 정산 대상에서 빠집니다.')) return;
    const r = await convertEarningsToCoins();
    if (!r.ok) return setError(r.message);
    setNotice(`${formatCoins(r.data)} MC 를 지갑으로 전환했습니다.`);
    void load();
  }

  if (!user) return <MonoPage kicker="CREATOR REVENUE" title="창작자 수익" icon="chart"><EmptyState icon="🔒" text="로그인 후 이용할 수 있습니다." /></MonoPage>;
  if (!sum && !error) return <MonoPage kicker="CREATOR REVENUE" title="창작자 수익" icon="chart"><LoadingState /></MonoPage>;
  const rate = Number(sum?.coin_krw_rate ?? 1);
  return (
    <MonoPage kicker="CREATOR REVENUE" title="창작자 수익" icon="chart" fallback="/creator" actions={<Link className="btn btn-ghost btn-sm" to="/creator">스튜디오</Link>}>
      <p className="eco-notice" data-testid="payout-disabled-notice">
        현금 정산(출금)은 법률·세무·지급대행·본인확인 검토 전까지 <strong>비활성</strong>입니다. 아래 정산은 금액 계산과 승인 절차만 확인하는 <strong>시뮬레이션</strong>이며 실제로 돈이 지급되지 않습니다.
      </p>
      {error && <ErrorState text={error} onRetry={() => { setError(null); void load(); }} />}
      {notice && <p className="eco-notice eco-notice--accent" role="status" data-testid="revenue-notice">{notice}</p>}
      {sum && (
        <>
          <div className="eco-metrics" data-testid="revenue-metrics">
            <div className="eco-metric"><span>총 판매 금액</span><strong>{formatCoins(sum.gross_coins)} MC</strong></div>
            <div className="eco-metric"><span>판매 건수</span><strong>{sum.sales_count}</strong></div>
            <div className="eco-metric"><span>플랫폼 수수료</span><strong>{formatCoins(sum.platform_fee_coins)} MC</strong></div>
            <div className="eco-metric"><span>환불 금액</span><strong>{formatCoins(sum.refunded_coins)} MC</strong></div>
            <div className="eco-metric"><span>보류 중 (환불 기간)</span><strong>{formatCoins(sum.held_coins)} MC</strong></div>
            <div className="eco-metric"><span>정산 예정 (가능)</span><strong data-testid="available-coins">{formatCoins(sum.available_coins)} MC</strong></div>
            <div className="eco-metric"><span>정산 진행 중</span><strong>{formatCoins(sum.in_settlement_coins)} MC</strong></div>
            <div className="eco-metric"><span>정산 완료 (시뮬레이션)</span><strong>{formatCoins(sum.settled_coins)} MC</strong></div>
            <div className="eco-metric"><span>코인 전환</span><strong>{formatCoins(sum.converted_coins)} MC</strong></div>
          </div>
          <p className="eco-meta">예상 정산액 = 코인 × {rate}원 (예상치, 확정 아님) · 최소 정산 {formatCoins(sum.settlement_min_coins)} MC</p>
          <div className="eco-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={Number(sum.available_coins) <= 0} onClick={() => void settle()} data-testid="request-settlement">
              정산 요청 (시뮬레이션) · 예상 {formatWon(Math.floor(Number(sum.available_coins) * rate))}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={Number(sum.available_coins) <= 0} onClick={() => void convert()} data-testid="convert-earnings">MARTIAL COIN 으로 전환</button>
          </div>
        </>
      )}

      <section className="eco-stack">
        <h3>상품별 수익</h3>
        {byProduct.length === 0 ? <EmptyState icon="📈" text="아직 판매가 없습니다." /> : (
          <div className="eco-table-wrap"><table className="eco-table">
            <thead><tr><th>상품</th><th>판매</th><th>거래액</th><th>수수료</th><th>내 몫</th></tr></thead>
            <tbody>{byProduct.map(([pid, v]) => <tr key={pid}><td><Link to={`/content/${pid}`}>{titles.get(pid) ?? pid.slice(0, 8)}</Link></td><td>{v.count}</td><td>{formatCoins(v.gross)}</td><td>{formatCoins(v.fee)}</td><td>{formatCoins(v.earn)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      {byMonth.length > 0 && (
        <section className="eco-stack">
          <h3>월별 거래액</h3>
          <div className="eco-table-wrap"><table className="eco-table"><tbody>{byMonth.map(([m, v]) => <tr key={m}><td>{m}</td><td>{formatCoins(v)} MC</td></tr>)}</tbody></table></div>
        </section>
      )}
      <section className="eco-stack">
        <h3>정산 내역</h3>
        {settlements.length === 0 ? <p className="eco-meta">정산 요청 내역이 없습니다.</p> : (
          <div className="eco-table-wrap"><table className="eco-table" data-testid="settlements">
            <thead><tr><th>요청일</th><th>코인</th><th>예상액</th><th>상태</th><th>사유</th></tr></thead>
            <tbody>{settlements.map((s) => <tr key={s.id}><td>{formatDate(s.requested_at)}</td><td>{formatCoins(s.amount_coins)}</td><td>{formatWon(Number(s.amount_krw_estimate))}</td><td>{SETTLEMENT_STATUS_LABEL[s.status]}</td><td>{s.hold_reason ?? s.reject_reason ?? ''}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </MonoPage>
  );
}
