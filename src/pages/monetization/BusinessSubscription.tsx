import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { CheckoutPanel, MonoPage, TestPaymentNotice } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  createSubscriptionCheckout,
  getGymBusinessReport,
  listGymSubscriptions,
  listMyOwnedGyms,
  listPlans,
  setSubscriptionCancel,
  type MembershipPlan,
  type OwnedGym,
  type Subscription,
} from '../../lib/monetization/service';
import { useMembership } from '../../lib/monetization/useMembership';
import { FEATURE_LABEL } from './Membership';

const REPORT_LABEL: [string, string][] = [
  ['members', '전체 회원'], ['students', '학생'], ['instructors', '지도자'], ['new_members_30d', '30일 신규'],
  ['active_learners_30d', '30일 학습 활동'], ['assignments_open', '진행 중 과제'], ['assignments_done_30d', '30일 완료 과제'],
  ['join_requests_pending', '가입 대기'], ['announcements_30d', '30일 공지'], ['leads_30d', '30일 문의 유입'], ['review_avg', '후기 평균'], ['review_count', '후기 수'],
];

/** 사업자 요금제 — 기존 체육관 운영 대시보드(/gym/admin)는 그대로 쓰고, 여기서는 요금제와 사업자 리포트만 다룬다. */
export default function BusinessSubscription() {
  const { user } = useAuth();
  const { membership } = useMembership();
  const [params, setParams] = useSearchParams();
  const [gyms, setGyms] = useState<OwnedGym[] | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [report, setReport] = useState<Record<string, number | string | null> | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const gymId = params.get('gym') ?? gyms?.[0]?.id ?? null;

  useEffect(() => {
    if (!user) return;
    void Promise.all([listMyOwnedGyms(user.id), listPlans()]).then(([g, p]) => {
      if (!g.ok) return setError(g.message);
      setGyms(g.data);
      setPlans(p.ok ? p.data.filter((x) => x.audience === 'business' && x.active) : []);
    });
  }, [user?.id]);

  async function loadGym() {
    if (!gymId) return;
    const [s, r] = await Promise.all([listGymSubscriptions(gymId), getGymBusinessReport(gymId)]);
    setSubs(s.ok ? s.data : []);
    if (r.ok) {
      setReport(r.data);
      setReportErr(null);
    } else {
      setReport(null);
      setReportErr(r.message);
    }
  }
  useEffect(() => {
    void loadGym();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  if (!user) return <MonoPage kicker="BUSINESS" title="사업자 요금제" icon="building"><EmptyState icon="🔒" text="로그인 후 이용할 수 있습니다." /></MonoPage>;
  if (!gyms) return <MonoPage kicker="BUSINESS" title="사업자 요금제" icon="building">{error ? <ErrorState text={error} /> : <LoadingState />}</MonoPage>;

  const live = subs.find((s) => s.status === 'active' || s.status === 'past_due');
  return (
    <MonoPage kicker="BUSINESS" title="체육관 사업자 요금제" icon="building" fallback="/gym/admin" lede="회원·지도자·과제 관리는 기존 체육관 운영 대시보드에서 그대로 이용합니다. 사업자 요금제는 사업자 통계·리포트 등 추가 기능을 엽니다." actions={<Link className="btn btn-secondary btn-sm" to="/gym/admin">체육관 운영 대시보드</Link>}>
      <TestPaymentNotice />
      {error && <ErrorState text={error} />}
      {notice && <p className="eco-notice eco-notice--accent" role="status" data-testid="business-notice">{notice}</p>}
      {gyms.length === 0 ? (
        <EmptyState icon="🏢" text="관장으로 등록된 체육관이 없습니다. 체육관 운영 대시보드에서 체육관을 먼저 만드세요." />
      ) : (
        <>
          {gyms.length > 1 && (
            <select value={gymId ?? ''} onChange={(e) => setParams({ gym: e.target.value })} aria-label="체육관 선택">
              {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <section className="eco-card eco-stack" data-testid="business-status">
            <div className="eco-row eco-row--between">
              <strong>{gyms.find((g) => g.id === gymId)?.name}</strong>
              {live ? <span className="eco-pill eco-pill--good">사업자 요금제 이용 중</span> : membership?.privileged ? <span className="eco-pill eco-pill--accent">운영자·개발자 계정 · 모든 기능</span> : <span className="eco-pill eco-pill--muted">요금제 없음 (기본 관리 기능)</span>}
            </div>
            {live && (
              <>
                <div className="eco-meta">{live.cycle === 'monthly' ? '월간' : '연간'} · {formatDate(live.current_period_start)} ~ {formatDate(live.current_period_end)}{live.is_test ? ' · 테스트 결제' : ''}{live.cancel_at_period_end ? ' · 기간 종료 시 해지' : ''}</div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const r = await setSubscriptionCancel(live.id, !live.cancel_at_period_end); if (!r.ok) return setError(r.message); void loadGym(); }}>
                  {live.cancel_at_period_end ? '해지 예약 취소' : '해지 예약'}
                </button>
              </>
            )}
          </section>

          {!live && !membership?.privileged && plans.map((p) => (
            <section key={p.id} className="mono-plan mono-plan--featured" data-testid={`business-plan-${p.id}`}>
              <h3>{p.name}</h3>
              <p>{p.tagline}</p>
              <ul className="mono-plan__features">{p.features.map((f) => <li key={f}><Icon name="check" /> {FEATURE_LABEL[f] ?? f}</li>)}</ul>
              <div className="mono-plan__price">월 {formatWon(p.price_monthly_krw)} · 연 {formatWon(p.price_yearly_krw)}</div>
              {gymId && (
                <div className="eco-row">
                  <CheckoutPanel kind="subscription" title="월간 구독" create={() => createSubscriptionCheckout(p.id, 'monthly', gymId)} onDone={() => { setNotice('사업자 요금제가 시작되었습니다. (테스트 결제)'); void loadGym(); }} testId="business-checkout-monthly" />
                  <CheckoutPanel kind="subscription" title="연간 구독" create={() => createSubscriptionCheckout(p.id, 'yearly', gymId)} onDone={() => { setNotice('사업자 요금제가 시작되었습니다. (테스트 결제)'); void loadGym(); }} testId="business-checkout-yearly" />
                </div>
              )}
            </section>
          ))}

          <section className="eco-stack" data-testid="business-report">
            <h3>사업자 리포트</h3>
            {report ? (
              <div className="eco-metrics">
                {REPORT_LABEL.map(([k, label]) => <div key={k} className="eco-metric"><span>{label}</span><strong>{report[k] ?? '—'}</strong></div>)}
              </div>
            ) : (
              <p className="eco-meta"><Icon name="lock" /> {reportErr ?? '사업자 요금제가 필요합니다.'}</p>
            )}
          </section>

          {subs.length > 0 && (
            <section className="eco-stack">
              <h3>구독 이력</h3>
              <div className="eco-table-wrap"><table className="eco-table"><tbody>
                {subs.map((s) => <tr key={s.id}><td>{formatDate(s.created_at)}</td><td>{s.cycle === 'monthly' ? '월간' : '연간'}</td><td>{s.status}</td><td>{formatDate(s.current_period_end)}까지</td></tr>)}
              </tbody></table></div>
              <p className="eco-meta--faint">결제 내역·영수증은 <Link to="/membership">멤버십</Link> 화면의 결제 내역에서 확인할 수 있습니다.</p>
            </section>
          )}
        </>
      )}
    </MonoPage>
  );
}
