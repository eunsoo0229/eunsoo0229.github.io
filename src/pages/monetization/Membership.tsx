import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { CheckoutPanel, MonoPage, TestPaymentNotice } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  getConfig,
  createSubscriptionCheckout,
  listMySubscriptionPayments,
  listPlans,
  setSubscriptionCancel,
  type MembershipPlan,
  type SubscriptionPayment,
} from '../../lib/monetization/service';
import { notifyMembershipChanged, useMembership } from '../../lib/monetization/useMembership';

export const FEATURE_LABEL: Record<string, string> = {
  encyclopedia: '기술 백과사전',
  learning_log: '기본 학습 기록',
  community: '공개 커뮤니티',
  coach_basic: '기본 AI 코치',
  curriculum_basic: '기본 커리큘럼',
  gear_market: '장비 마켓',
  profile: '사용자 프로필',
  coach_advanced: '고급 AI 코치',
  curriculum_personal: '개인 맞춤 커리큘럼',
  analytics_advanced: '고급 성과 분석',
  learning_report: '상세 학습 리포트',
  ai_extended: '확장 AI 학습 기능',
  pro_content: 'PRO 포함 프리미엄 콘텐츠',
  gemini_unlimited: 'Gemini 코치 무제한',
  gym_management: '체육관 회원 관리',
  gym_progress: '회원별 진도 관리',
  gym_business_reports: '사업자 통계·리포트',
  gym_content_sales: '체육관 콘텐츠 판매(예정)',
};

const STATUS_LABEL = { active: '이용 중', past_due: '결제 확인 필요', canceled: '종료', expired: '만료' } as const;
const PAY_STATUS: Record<SubscriptionPayment['status'], string> = { pending: '대기', paid: '결제 완료', failed: '실패', cancelled: '취소', refunded: '환불' };
const KIND_LABEL: Record<SubscriptionPayment['kind'], string> = { new: '신규', renewal: '갱신', change: '요금제 변경' };

export default function Membership() {
  const { user } = useAuth();
  const { membership, reload } = useMembership();
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [freeGemini, setFreeGemini] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const r = await listPlans();
    if (!r.ok) return setError(r.message);
    setPlans(r.data.filter((p) => p.active));
    if (user) {
      const pr = await listMySubscriptionPayments(user.id);
      if (pr.ok) setPayments(pr.data);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    void getConfig().then((r) => r.ok && r.data && setFreeGemini(r.data.free_gemini_daily_uses));
  }, []);

  const sub = membership?.subscription ?? null;
  const personal = (plans ?? []).filter((p) => p.audience === 'personal');

  async function toggleCancel(cancel: boolean) {
    if (!sub) return;
    const r = await setSubscriptionCancel(sub.id, cancel);
    if (!r.ok) return setError(r.message);
    setNotice(cancel ? `구독이 ${formatDate(sub.current_period_end)}까지 유지된 뒤 종료됩니다.` : '자동 갱신 예정으로 되돌렸습니다.');
    notifyMembershipChanged();
    reload();
  }

  return (
    <MonoPage kicker="MEMBERSHIP" title="멤버십" icon="star" lede="무료로 시작하고, 필요할 때 PRO 로 확장하세요. 권한은 서버에서 확인됩니다.">
      <TestPaymentNotice />
      {error && <ErrorState text={error} onRetry={() => { setError(null); void load(); }} />}
      {notice && <p className="eco-notice eco-notice--accent" role="status">{notice}</p>}

      {user && membership && (
        <section className="eco-card eco-stack" data-testid="membership-current">
          <div className="eco-row eco-row--between">
            <strong>내 요금제</strong>
            {membership.privileged ? (
              <span className="eco-pill eco-pill--accent" data-testid="membership-privileged">운영자·개발자 계정 · 모든 기능</span>
            ) : (
              <span className="eco-pill eco-pill--good" data-testid="membership-plan">{membership.plan_id.toUpperCase()}</span>
            )}
          </div>
          {sub ? (
            <>
              <div className="eco-meta">
                {sub.plan_id.toUpperCase()} · {sub.cycle === 'monthly' ? '월간' : '연간'} · {STATUS_LABEL[sub.status]} · {formatDate(sub.current_period_start)} ~ {formatDate(sub.current_period_end)}
                {sub.is_test && ' · 테스트 결제'}
              </div>
              {sub.status === 'past_due' && <p className="eco-notice">갱신 결제가 확인되지 않았습니다. 유예 기간 동안만 PRO 기능이 유지됩니다.</p>}
              <div className="eco-row">
                {sub.cancel_at_period_end ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggleCancel(false)}>해지 예약 취소</button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleCancel(true)} data-testid="membership-cancel">구독 해지 예약</button>
                )}
                {sub.cancel_at_period_end && <span className="eco-meta">기간 종료 시 해지 예정</span>}
              </div>
            </>
          ) : !membership.privileged ? (
            <div className="eco-meta">무료 요금제를 이용 중입니다.</div>
          ) : null}
        </section>
      )}

      <div className="eco-tabs" role="tablist" aria-label="결제 주기">
        {(['monthly', 'yearly'] as const).map((c) => (
          <button key={c} type="button" role="tab" className="eco-tab" aria-selected={cycle === c} onClick={() => setCycle(c)} data-testid={`cycle-${c}`}>
            {c === 'monthly' ? '월간' : '연간'}
          </button>
        ))}
      </div>

      {!plans ? (
        <LoadingState />
      ) : (
        <div className="mono-plans" data-testid="plan-grid">
          {personal.map((p) => {
            const price = cycle === 'monthly' ? p.price_monthly_krw : p.price_yearly_krw;
            const current = (sub?.plan_id ?? 'free') === p.id && (p.id === 'free' || sub?.cycle === cycle);
            return (
              <article key={p.id} className={`mono-plan${p.tier > 0 ? ' mono-plan--featured' : ''}`} data-testid={`plan-${p.id}`}>
                <header>
                  <h3>{p.name}</h3>
                  <p>{p.tagline}</p>
                </header>
                <div className="mono-plan__price">
                  {price > 0 ? (
                    <>
                      <strong>{formatWon(price)}</strong>
                      <span>/ {cycle === 'monthly' ? '월' : '년'}</span>
                      {cycle === 'yearly' && p.price_monthly_krw > 0 && price < p.price_monthly_krw * 12 && (
                        <span className="eco-pill eco-pill--good">{Math.round((1 - price / (p.price_monthly_krw * 12)) * 100)}% 할인</span>
                      )}
                    </>
                  ) : (
                    <strong>무료</strong>
                  )}
                </div>
                <ul className="mono-plan__features">
                  {p.features.map((f) => (
                    <li key={f}>
                      <Icon name="check" /> {FEATURE_LABEL[f] ?? f}
                    </li>
                  ))}
                  {!p.features.includes('gemini_unlimited') && freeGemini !== null && p.audience === 'personal' && (
                    <li data-testid={`plan-${p.id}-gemini-limit`}>
                      <Icon name="check" /> Gemini 코치 하루 {freeGemini}회
                    </li>
                  )}
                </ul>
                {current ? (
                  <span className="eco-pill eco-pill--muted">현재 요금제</span>
                ) : membership?.privileged ? (
                  <span className="eco-pill eco-pill--muted">구독 불필요 (모든 기능)</span>
                ) : price > 0 ? (
                  <CheckoutPanel
                    kind="subscription"
                    title={`${p.name} ${cycle === 'monthly' ? '월간' : '연간'} 구독${sub ? (sub.plan_id === p.id && sub.cycle === cycle ? ' 갱신' : ' 으로 변경') : ''}`}
                    create={() => createSubscriptionCheckout(p.id, cycle)}
                    onDone={() => {
                      setNotice(`${p.name} 구독이 시작되었습니다. (테스트 결제)`);
                      reload();
                      void load();
                    }}
                    testId={`checkout-plan-${p.id}`}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <p className="eco-meta--faint">요금제 변경 시 남은 기간의 차액은 정산하지 않고 새 요금제가 결제 시점부터 시작합니다. 체육관 사업자 요금제는 <Link to="/business">사업자 요금제</Link>에서 관리합니다.</p>

      {user && (
        <section className="eco-stack" data-testid="membership-payments">
          <h3>결제 내역 · 영수증</h3>
          {payments.length === 0 ? (
            <EmptyState icon="🧾" text="결제 내역이 없습니다." />
          ) : (
            <div className="eco-table-wrap">
              <table className="eco-table">
                <thead>
                  <tr><th>일시</th><th>내용</th><th>금액</th><th>상태</th><th>영수증</th></tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.paid_at ?? p.created_at)}</td>
                      <td>{p.plan_id.toUpperCase()} {p.cycle === 'monthly' ? '월간' : '연간'} · {KIND_LABEL[p.kind]}{p.gym_id ? ' · 사업자' : ''}</td>
                      <td>{formatWon(p.amount_krw)}</td>
                      <td>{PAY_STATUS[p.status]}{p.is_test ? ' (테스트)' : ''}{p.failure_reason ? ` · ${p.failure_reason}` : ''}</td>
                      <td>{p.status === 'paid' || p.status === 'refunded' ? <ReceiptButton p={p} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </MonoPage>
  );
}

function ReceiptButton({ p }: { p: SubscriptionPayment }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>{open ? '닫기' : '보기'}</button>
      {open && (
        <div className="mono-receipt" role="dialog" aria-label="영수증">
          <strong>MARTIALDEX 결제 영수증{p.is_test ? ' (테스트 결제 — 실제 청구 없음)' : ''}</strong>
          <dl>
            <dt>주문 번호</dt><dd>{p.id}</dd>
            <dt>상품</dt><dd>{p.plan_id.toUpperCase()} {p.cycle === 'monthly' ? '월간' : '연간'} 구독</dd>
            <dt>금액</dt><dd>{formatWon(p.amount_krw)}</dd>
            <dt>결제일</dt><dd>{formatDate(p.paid_at)}</dd>
            {p.refunded_at && (<><dt>환불일</dt><dd>{formatDate(p.refunded_at)}</dd></>)}
          </dl>
        </div>
      )}
    </>
  );
}
