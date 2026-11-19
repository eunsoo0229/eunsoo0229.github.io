import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ErrorState from '../ErrorState';
import LoadingState from '../LoadingState';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  CREATOR_STATUS_LABEL,
  GEAR_DISPUTE_LABEL,
  PRODUCT_STATUS_LABEL,
  PRODUCT_TYPE_LABEL,
  REPORT_REASON_LABEL,
  SETTLEMENT_STATUS_LABEL,
  admin,
  formatCoins,
  getConfig,
  listCoinPackages,
  listPlans,
  type CoinPackage,
  type CreatorProfile,
  type CreatorProduct,
  type MembershipPlan,
  type MonetizationConfig,
  type PartnerCampaign,
  type ProductType,
} from '../../lib/monetization/service';

const SECTIONS = [
  ['overview', '수익 분석'],
  ['settings', '요금제·코인·수수료'],
  ['creators', '창작자'],
  ['products', '콘텐츠 검수'],
  ['refunds', '환불'],
  ['settlements', '정산'],
  ['reports', '신고'],
  ['wallets', '지갑·원장'],
  ['partners', '제휴·광고'],
  ['gear', '장비 거래 분쟁'],
] as const;
type Section = (typeof SECTIONS)[number][0];

function useLoad<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    setError(null);
    void fn().then((r) => (r.ok ? setData(r.data) : setError(r.message)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, error, reload };
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="eco-stack">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export default function MonetizationAdmin() {
  const [section, setSection] = useState<Section>('overview');
  const [flash, setFlash] = useState<string | null>(null);
  const done = (r: { ok: boolean; message?: string }, ok: string) => setFlash(r.ok ? ok : (r as { message: string }).message);
  return (
    <div className="eco-stack" data-testid="monetization-admin">
      <p className="eco-notice">실결제·현금 지급은 정책으로 잠겨 있습니다 (DB 제약). 모든 결제는 테스트 결제, 정산은 시뮬레이션입니다.</p>
      <div className="eco-tabs" role="tablist" aria-label="수익화 관리">
        {SECTIONS.map(([k, label]) => (
          <button key={k} type="button" role="tab" className="eco-tab" aria-selected={section === k} onClick={() => { setSection(k); setFlash(null); }} data-testid={`mono-admin-${k}`}>{label}</button>
        ))}
      </div>
      {flash && <p className="eco-notice eco-notice--accent" role="status" data-testid="mono-admin-flash">{flash}</p>}
      {section === 'overview' && <Overview />}
      {section === 'settings' && <Settings done={done} />}
      {section === 'creators' && <Creators done={done} />}
      {section === 'products' && <Products done={done} />}
      {section === 'refunds' && <Refunds done={done} />}
      {section === 'settlements' && <Settlements done={done} />}
      {section === 'reports' && <Reports done={done} />}
      {section === 'wallets' && <Wallets done={done} />}
      {section === 'partners' && <Partners done={done} />}
      {section === 'gear' && <GearDisputes done={done} />}
    </div>
  );
}
type Done = (r: { ok: boolean; message?: string }, ok: string) => void;

function Overview() {
  const [days, setDays] = useState(30);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const { data, error, reload } = useLoad(() => admin.overview(from.toISOString(), new Date(to.getTime() + 60000).toISOString()), [days]);
  const g = (k: string) => (data?.[k] ?? {}) as Record<string, number>;
  const won = (n: unknown) => formatWon(Number(n ?? 0));
  const mc = (n: unknown) => `${formatCoins(Number(n ?? 0))} MC`;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  const row = (label: string, value: string, note?: string) => <div className="eco-metric"><span>{label}</span><strong>{value}</strong>{note && <small className="eco-meta--faint">{note}</small>}</div>;
  return (
    <div className="eco-stack" data-testid="mono-overview">
      <div className="eco-row">
        {[7, 30, 90, 365].map((d) => <button key={d} type="button" className={`btn btn-sm ${d === days ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setDays(d)}>{d}일</button>)}
        {data.all_test_payments === true && <span className="eco-pill eco-pill--warn">전부 테스트 결제</span>}
      </div>
      <Block title="① 구독 매출 (현금)">
        <div className="eco-metrics">
          {row('개인 구독', won(g('subscriptions').personal_paid_krw))}
          {row('체육관 사업자 구독', won(g('subscriptions').business_paid_krw))}
          {row('구독 환불', won(g('subscriptions').refunded_krw))}
          {row('유효 개인 구독', String(g('subscriptions').active_personal ?? 0))}
          {row('유효 사업자 구독', String(g('subscriptions').active_business ?? 0))}
          {row('결제 실패', String(g('subscriptions').failed_payments ?? 0))}
        </div>
      </Block>
      <Block title="② 코인 충전액 (현금 · 사용 전까지는 선수금)">
        <div className="eco-metrics">
          {row('코인 판매', won(g('coins').sales_krw))}
          {row('코인 환불', won(g('coins').refunded_krw))}
          {row('유료 발행 코인', mc(g('coins').issued_paid_coins))}
          {row('무료 지급 코인', mc(g('coins').issued_free_coins), '이벤트·프로모션·활동 보상')}
          {row('사용된 코인', mc(g('coins').spent_coins))}
          {row('미사용 코인 잔액', mc(g('coins').outstanding_coins), '전체 지갑 합계')}
        </div>
      </Block>
      <Block title="③ 플랫폼 수익">
        <div className="eco-metrics">
          {row('콘텐츠 수수료', mc(g('content').platform_fee_coins), `≈ ${won(g('content').platform_fee_krw_estimate)} (환산 추정)`)}
          {row('장비 거래 수수료 (배송 완료분)', won(g('gear').fee_realized_krw))}
          {row('장비 수수료 (진행 중)', won(g('gear').fee_pending_krw), '배송 완료 전 — 미실현')}
          {row('커리큘럼 마켓 수수료', won(g('curriculum_market').fee_krw))}
          {row('제휴·광고 계약', won(g('partners').contract_fee_krw), `진행 중 캠페인 ${g('partners').active_campaigns ?? 0}`)}
        </div>
      </Block>
      <Block title="④ 거래액 · 창작자 몫 (플랫폼 수익 아님)">
        <div className="eco-metrics">
          {row('콘텐츠 거래액', mc(g('content').gross_coins), `${g('content').sales_count ?? 0}건`)}
          {row('창작자 몫', mc(g('content').creator_share_coins))}
          {row('콘텐츠 환불', mc(g('content').refunded_coins))}
          {row('장비 거래액 (배송 완료)', won(g('gear').gmv_delivered_krw))}
          {row('장비 환불', won(g('gear').refunded_krw))}
          {row('커리큘럼 마켓 거래액', won(g('curriculum_market').gmv_krw))}
        </div>
      </Block>
      <Block title="⑤ 정산 (시뮬레이션)">
        <div className="eco-metrics">
          {row('정산 예정', mc(g('settlements').pending_coins), `≈ ${won(g('settlements').pending_krw_estimate)}`)}
          {row('지급 완료 (시뮬레이션)', won(g('settlements').paid_simulated_krw_estimate))}
          {row('창작자 보류 수익', mc(g('settlements').creator_held_coins))}
          {row('창작자 정산 가능', mc(g('settlements').creator_available_coins))}
          {row('장비 분쟁 진행', String(g('gear').open_disputes ?? 0))}
        </div>
      </Block>
      {data.privileged_excluded && (
        <Block title="⑥ 통계에서 제외된 내부 거래 (운영자·개발자 계정)">
          <div className="eco-metrics" data-testid="mono-privileged-excluded">
            {row('구독 결제', won(g('privileged_excluded').subscription_paid_krw))}
            {row('코인 구매', won(g('privileged_excluded').coin_sales_krw))}
            {row('무료 지급 코인', mc(g('privileged_excluded').issued_free_coins))}
            {row('원장 거래', String(g('privileged_excluded').ledger_entries ?? 0))}
            {row('콘텐츠 무상 이용', String(g('privileged_excluded').content_comps ?? 0))}
          </div>
        </Block>
      )}
    </div>
  );
}

function Settings({ done }: { done: Done }) {
  const cfg = useLoad(getConfig);
  const plans = useLoad(listPlans);
  const packs = useLoad(listCoinPackages);
  const rules = useLoad(admin.listCommissionRules);
  const [c, setC] = useState<Partial<MonetizationConfig>>({});
  const [rule, setRule] = useState({ scope: 'product_type', scope_key: 'document', commission_bp: '1000', ends_at: '', note: '' });
  useEffect(() => { if (cfg.data) setC(cfg.data); }, [cfg.data]);
  if (!cfg.data || !plans.data || !packs.data) return cfg.error ? <ErrorState text={cfg.error} /> : <LoadingState />;
  const num = (k: keyof MonetizationConfig, label: string, step = 1) => (
    <label key={k}>{label}<input type="number" step={step} value={String(c[k] ?? '')} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })} data-testid={`cfg-${k}`} /></label>
  );
  return (
    <div className="eco-stack">
      <Block title="기본 설정">
        <div className="eco-card eco-form">
          <div className="eco-form-grid">
            <label>코인 이름<input value={c.coin_name ?? ''} onChange={(e) => setC({ ...c, coin_name: e.target.value })} /></label>
            <label>코인 기호<input value={c.coin_symbol ?? ''} onChange={(e) => setC({ ...c, coin_symbol: e.target.value })} /></label>
            {num('default_commission_bp', '콘텐츠 기본 수수료 (bp, 1500=15%)')}
            {num('gear_fee_bp', '장비 거래 수수료 (bp)')}
            {num('coin_krw_rate', '정산 환산율 (1코인=원)', 0.01)}
            {num('earnings_hold_days', '수익 보류 기간 (일)')}
            {num('settlement_min_coins', '최소 정산 (코인)')}
            {num('daily_checkin_coins', '출석 보상 (코인/일)')}
            {num('past_due_grace_days', '결제 실패 유예 (일)')}
            {num('content_refund_days', '콘텐츠 환불 기간 (일)')}
            {num('free_gemini_daily_uses', 'FREE Gemini 코치 하루 횟수')}
            {num('gemini_use_window_seconds', 'Gemini 1회 묶음 시간 (초)')}
            {num('gemini_calls_per_use', 'Gemini 1회 묶음 최대 호출')}
          </div>
          <p className="eco-meta">실결제: <strong>{cfg.data.live_payments_enabled ? '켜짐' : '꺼짐 (잠김)'}</strong> · 현금 지급: <strong>{cfg.data.cash_payout_enabled ? '켜짐' : '꺼짐 (잠김)'}</strong> · 미성년 유료결제: <strong>{cfg.data.minor_paid_enabled ? '켜짐' : '꺼짐 (잠김)'}</strong> — 법률·결제사 검토 후 마이그레이션으로만 변경</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={async () => {
            const { coin_name, coin_symbol, default_commission_bp, gear_fee_bp, coin_krw_rate, earnings_hold_days, settlement_min_coins, daily_checkin_coins, past_due_grace_days, content_refund_days, free_gemini_daily_uses, gemini_use_window_seconds, gemini_calls_per_use } = c;
            done(await admin.updateConfig({ coin_name, coin_symbol, default_commission_bp, gear_fee_bp, coin_krw_rate, earnings_hold_days, settlement_min_coins, daily_checkin_coins, past_due_grace_days, content_refund_days, free_gemini_daily_uses, gemini_use_window_seconds, gemini_calls_per_use }), '설정을 저장했습니다. (이후 새 거래부터 적용)');
            cfg.reload();
          }} data-testid="cfg-save">설정 저장</button>
        </div>
      </Block>
      <Block title="요금제">
        {plans.data.map((p) => <PlanEditor key={p.id} p={p} done={done} reload={plans.reload} />)}
        <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await admin.expireSubscriptions().then((r) => done(r, r.ok ? `만료 처리 ${r.data}건` : '')); }}>만료 구독 정리 실행</button>
      </Block>
      <Block title="코인 상품">
        {packs.data.map((p) => <PackEditor key={p.id} p={p} done={done} reload={packs.reload} />)}
        <PackEditor p={{ id: '', name: '', coins: 1000, bonus_coins: 0, price_krw: 1000, active: false, sort: packs.data.length }} done={done} reload={packs.reload} isNew />
      </Block>
      <Block title="수수료 규칙 (우선순위: 창작자 특별 > 이벤트 > 상품 유형 > 기본)">
        {rules.data && rules.data.length > 0 && (
          <div className="eco-table-wrap"><table className="eco-table"><tbody>
            {rules.data.map((r) => (
              <tr key={r.id}><td>{r.scope === 'event' ? '이벤트' : '상품 유형'}</td><td>{r.scope_key}</td><td>{r.commission_bp / 100}%</td><td>{formatDate(r.starts_at)} ~ {r.ends_at ? formatDate(r.ends_at) : '계속'}</td><td>{r.active ? '적용' : '중지'}</td><td>{r.note}</td>
                <td>{r.active && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { done(await admin.saveCommissionRule({ id: r.id, active: false }), '규칙을 중지했습니다.'); rules.reload(); }}>중지</button>}</td></tr>
            ))}
          </tbody></table></div>
        )}
        <div className="eco-card eco-form-grid">
          <label>범위<select value={rule.scope} onChange={(e) => setRule({ ...rule, scope: e.target.value })}><option value="product_type">상품 유형</option><option value="event">이벤트</option></select></label>
          <label>대상<select value={rule.scope_key} onChange={(e) => setRule({ ...rule, scope_key: e.target.value })}>{rule.scope === 'event' && <option value="*">전체</option>}{(Object.keys(PRODUCT_TYPE_LABEL) as ProductType[]).map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}</select></label>
          <label>수수료 (bp)<input type="number" value={rule.commission_bp} onChange={(e) => setRule({ ...rule, commission_bp: e.target.value })} /></label>
          <label>종료일 (선택)<input type="date" value={rule.ends_at} onChange={(e) => setRule({ ...rule, ends_at: e.target.value })} /></label>
          <label>메모<input value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} /></label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { done(await admin.saveCommissionRule({ ...rule, commission_bp: Number(rule.commission_bp), ends_at: rule.ends_at || null }), '수수료 규칙을 추가했습니다. (새 거래부터)'); rules.reload(); }}>규칙 추가</button>
        </div>
      </Block>
    </div>
  );
}

function PlanEditor({ p, done, reload }: { p: MembershipPlan; done: Done; reload: () => void }) {
  const [v, setV] = useState({ ...p, featuresText: p.features.join(', ') });
  return (
    <div className="eco-card eco-form-grid" data-testid={`plan-edit-${p.id}`}>
      <label>{p.id} 이름<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label>월간 (원)<input type="number" value={v.price_monthly_krw} onChange={(e) => setV({ ...v, price_monthly_krw: Number(e.target.value) })} data-testid={`plan-${p.id}-monthly`} /></label>
      <label>연간 (원)<input type="number" value={v.price_yearly_krw} onChange={(e) => setV({ ...v, price_yearly_krw: Number(e.target.value) })} /></label>
      <label>기능 (쉼표)<input value={v.featuresText} onChange={(e) => setV({ ...v, featuresText: e.target.value })} /></label>
      <label className="eco-row"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> 판매</label>
      <button type="button" className="btn btn-secondary btn-sm" onClick={async () => {
        done(await admin.upsertPlan({ id: p.id, audience: p.audience, name: v.name, tagline: v.tagline, tier: v.tier, sort: v.sort, active: v.active, price_monthly_krw: v.price_monthly_krw, price_yearly_krw: v.price_yearly_krw, features: v.featuresText.split(',').map((s) => s.trim()).filter(Boolean) }), `${p.id} 요금제를 저장했습니다.`);
        reload();
      }} data-testid={`plan-${p.id}-save`}>저장</button>
    </div>
  );
}

function PackEditor({ p, done, reload, isNew }: { p: CoinPackage; done: Done; reload: () => void; isNew?: boolean }) {
  const [v, setV] = useState(p);
  return (
    <div className="eco-card eco-form-grid">
      <label>id<input value={v.id} disabled={!isNew} onChange={(e) => setV({ ...v, id: e.target.value })} placeholder="new-pack" /></label>
      <label>이름<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label>코인<input type="number" value={v.coins} onChange={(e) => setV({ ...v, coins: Number(e.target.value) })} /></label>
      <label>보너스<input type="number" value={v.bonus_coins} onChange={(e) => setV({ ...v, bonus_coins: Number(e.target.value) })} /></label>
      <label>가격 (원)<input type="number" value={v.price_krw} onChange={(e) => setV({ ...v, price_krw: Number(e.target.value) })} /></label>
      <label className="eco-row"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> 판매</label>
      <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { done(await admin.upsertCoinPackage(v), '코인 상품을 저장했습니다.'); reload(); }}>{isNew ? '추가' : '저장'}</button>
    </div>
  );
}

function Creators({ done }: { done: Done }) {
  const [filter, setFilter] = useState<CreatorProfile['status'] | ''>('pending');
  const list = useLoad(() => admin.listCreators(filter || undefined), [filter]);
  return (
    <div className="eco-stack">
      <select value={filter} onChange={(e) => setFilter(e.target.value as CreatorProfile['status'] | '')} aria-label="상태"><option value="">전체</option>{Object.entries(CREATOR_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {list.error && <ErrorState text={list.error} />}
      {list.data?.length === 0 && <p className="eco-meta">해당 상태의 창작자가 없습니다.</p>}
      {list.data?.map((c) => <CreatorRow key={c.user_id} c={c} done={done} reload={list.reload} />)}
    </div>
  );
}

function CreatorRow({ c, done, reload }: { c: CreatorProfile; done: Done; reload: () => void }) {
  const [note, setNote] = useState(c.review_note ?? '');
  const [bp, setBp] = useState(c.commission_bp_override?.toString() ?? '');
  const [verified, setVerified] = useState<boolean[]>(c.credentials.map((x) => c.verified_credentials.some((v) => v.title === x.title)));
  const decide = async (d: CreatorProfile['status']) => {
    done(await admin.reviewCreator(c.user_id, d, note || null, bp === '' ? null : Number(bp), c.credentials.filter((_, i) => verified[i]).map((x) => ({ ...x, verified: true }))), `${c.display_name}: ${CREATOR_STATUS_LABEL[d]}`);
    reload();
  };
  return (
    <div className="eco-card eco-stack" data-testid={`creator-row-${c.user_id}`}>
      <div className="eco-row eco-row--between"><strong>{c.display_name}</strong><span className="eco-pill">{CREATOR_STATUS_LABEL[c.status]}</span></div>
      <span className="eco-meta">{c.specialties.join(' · ')} · 수련 {c.years_training ?? '?'}년 · 신청 {formatDate(c.created_at)}{c.is_minor ? ` · 미성년${c.guardian_consent ? ' (보호자 동의 표시)' : ''}` : ''}</span>
      {c.bio && <p className="eco-meta">{c.bio}</p>}
      {c.credentials.map((x, i) => (
        <label key={i} className="eco-row"><input type="checkbox" checked={!!verified[i]} onChange={(e) => setVerified(verified.map((v, j) => (j === i ? e.target.checked : v)))} /> 검증 확인: {x.title}{x.issuer ? ` · ${x.issuer}` : ''}{x.year ? ` · ${x.year}` : ''}</label>
      ))}
      <div className="eco-form-grid">
        <label>메모<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label>특별 수수료 (bp, 빈칸=없음)<input type="number" value={bp} onChange={(e) => setBp(e.target.value)} /></label>
      </div>
      <div className="eco-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void decide('approved')} data-testid={`creator-approve-${c.user_id}`}>승인</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void decide('rejected')}>반려</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void decide('restricted')}>활동 제한</button>
      </div>
    </div>
  );
}

function Products({ done }: { done: Done }) {
  const [filter, setFilter] = useState<CreatorProduct['status'] | ''>('pending_review');
  const list = useLoad(() => admin.listProducts(filter || undefined), [filter]);
  return (
    <div className="eco-stack">
      <select value={filter} onChange={(e) => setFilter(e.target.value as CreatorProduct['status'] | '')} aria-label="상태"><option value="">전체</option>{Object.entries(PRODUCT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {list.error && <ErrorState text={list.error} />}
      {list.data?.length === 0 && <p className="eco-meta">해당 상태의 콘텐츠가 없습니다.</p>}
      {list.data?.map((p) => <ProductRow key={p.id} p={p} done={done} reload={list.reload} />)}
    </div>
  );
}

function ProductRow({ p, done, reload }: { p: CreatorProduct; done: Done; reload: () => void }) {
  const [note, setNote] = useState('');
  const act = async (d: 'approved' | 'rejected' | 'suspended', refund = false) => {
    done(await admin.reviewProduct(p.id, d, note || null, refund), `${p.title}: ${PRODUCT_STATUS_LABEL[d]}${refund ? ' + 구매자 환불' : ''}`);
    reload();
  };
  return (
    <div className="eco-card eco-stack" data-testid={`product-row-${p.id}`}>
      <div className="eco-row eco-row--between"><Link to={`/content/${p.id}`}><strong>{p.title}</strong></Link><span className="eco-pill">{PRODUCT_STATUS_LABEL[p.status]} · v{p.version}</span></div>
      <span className="eco-meta">{PRODUCT_TYPE_LABEL[p.product_type]} · {formatCoins(p.price_coins)} MC · 판매 {p.sales_count} · 저작권 확인 {p.rights_confirmed ? 'O' : 'X'}{p.pro_included ? ' · PRO 포함' : ''}</span>
      <label>검수 메모<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="eco-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void act('approved')} data-testid={`product-approve-${p.id}`}>승인</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act('rejected')}>반려</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act('suspended')}>판매 중지</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm('판매 중지하고 모든 구매자에게 환불할까요? (저작권 침해 등)') && void act('suspended', true)}>중지 + 전원 환불</button>
      </div>
    </div>
  );
}

function Refunds({ done }: { done: Done }) {
  const list = useLoad(admin.listRefundRequests);
  if (list.error) return <ErrorState text={list.error} />;
  if (!list.data) return <LoadingState />;
  if (!list.data.length) return <p className="eco-meta">대기 중인 환불 요청이 없습니다.</p>;
  return (
    <div className="eco-table-wrap"><table className="eco-table" data-testid="refund-requests"><tbody>
      {list.data.map((r) => (
        <tr key={r.id}><td>{formatDate(r.created_at)} 구매</td><td><Link to={`/content/${r.product_id}`}>상품</Link></td><td>{formatCoins(r.price_coins)} MC</td><td>{r.refund_reason}</td>
          <td className="eco-row">
            <button type="button" className="btn btn-primary btn-sm" onClick={async () => { done(await admin.resolveRefund(r.id, true, null), '환불 승인: 코인 반환·창작자 수익 회수'); list.reload(); }} data-testid={`refund-approve-${r.id}`}>승인</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { done(await admin.resolveRefund(r.id, false, null), '환불을 거절했습니다.'); list.reload(); }}>거절</button>
          </td></tr>
      ))}
    </tbody></table></div>
  );
}

function Settlements({ done }: { done: Done }) {
  const list = useLoad(admin.listSettlements);
  if (list.error) return <ErrorState text={list.error} />;
  if (!list.data) return <LoadingState />;
  if (!list.data.length) return <p className="eco-meta">정산 요청이 없습니다.</p>;
  const act = async (id: string, d: 'approved' | 'rejected' | 'paid_simulated' | 'on_hold') => {
    const reason = d === 'rejected' || d === 'on_hold' ? window.prompt('사유') : null;
    if ((d === 'rejected' || d === 'on_hold') && !reason) return;
    done(await admin.decideSettlement(id, d, reason), SETTLEMENT_STATUS_LABEL[d]);
    list.reload();
  };
  return (
    <div className="eco-table-wrap"><table className="eco-table" data-testid="settlement-admin"><tbody>
      {list.data.map((s) => (
        <tr key={s.id}><td>{formatDate(s.requested_at)}</td><td>{formatCoins(s.amount_coins)} MC</td><td>≈ {formatWon(Number(s.amount_krw_estimate))}</td><td>{SETTLEMENT_STATUS_LABEL[s.status]} (시뮬레이션)</td><td>{s.hold_reason ?? s.reject_reason ?? ''}</td>
          <td className="eco-row">
            {(s.status === 'requested' || s.status === 'on_hold') && <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(s.id, 'approved')}>승인</button>}
            {s.status === 'approved' && <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(s.id, 'paid_simulated')}>지급 완료 처리 (시뮬레이션)</button>}
            {(s.status === 'requested' || s.status === 'approved') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(s.id, 'on_hold')}>보류</button>}
            {s.status !== 'paid_simulated' && s.status !== 'rejected' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(s.id, 'rejected')}>거절</button>}
          </td></tr>
      ))}
    </tbody></table></div>
  );
}

function Reports({ done }: { done: Done }) {
  const list = useLoad(admin.listReports);
  if (list.error) return <ErrorState text={list.error} />;
  if (!list.data) return <LoadingState />;
  if (!list.data.length) return <p className="eco-meta">신고가 없습니다.</p>;
  return (
    <div className="eco-table-wrap"><table className="eco-table"><tbody>
      {list.data.map((r) => (
        <tr key={r.id}><td>{formatDate(r.created_at)}</td><td>{REPORT_REASON_LABEL[r.reason]}</td><td>{r.product_id ? <Link to={`/content/${r.product_id}`}>콘텐츠</Link> : '창작자'}</td><td>{r.detail}</td><td>{r.status}</td>
          <td className="eco-row">{r.status === 'open' && <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { done(await admin.resolveReport(r.id, 'actioned', null), '조치 완료로 처리했습니다. (판매 중지는 콘텐츠 검수 탭에서)'); list.reload(); }}>조치</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { done(await admin.resolveReport(r.id, 'dismissed', null), '기각했습니다.'); list.reload(); }}>기각</button>
          </>}</td></tr>
      ))}
    </tbody></table></div>
  );
}

function Wallets({ done }: { done: Done }) {
  const integ = useLoad(admin.integrity);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ user_id: string; nickname: string; handle: string | null }[]>([]);
  const [target, setTarget] = useState<string>('');
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('');
  const [campaign, setCampaign] = useState('');
  return (
    <div className="eco-stack">
      <Block title="원장 무결성 점검">
        <button type="button" className="btn btn-secondary btn-sm" onClick={integ.reload} data-testid="integrity-run">다시 점검</button>
        {integ.error && <ErrorState text={integ.error} />}
        {integ.data && (integ.data.length === 0 ? <p className="eco-notice eco-notice--accent" data-testid="integrity-ok">이상 없음 — 잔액=원장 합계, 원장 연쇄·중복·결제-지급 일치</p> : (
          <div className="eco-table-wrap"><table className="eco-table" data-testid="integrity-issues"><tbody>
            {integ.data.map((r, i) => <tr key={i}><td>{r.check_name}</td><td>{r.user_id?.slice(0, 8) ?? ''}</td><td>{r.ref ?? ''}</td><td>{r.detail}</td></tr>)}
          </tbody></table></div>
        ))}
      </Block>
      <Block title="지급 · 보정 (원장은 수정하지 않고 새 거래로 기록)">
        <div className="eco-card eco-form">
          <div className="eco-row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="닉네임/핸들" /><button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const r = await admin.findUserByHandle(q); setFound(r.ok ? r.data : []); }}>찾기</button></div>
          {found.map((u) => <label key={u.user_id} className="eco-row"><input type="radio" name="wallet-target" checked={target === u.user_id} onChange={() => setTarget(u.user_id)} /> {u.nickname}{u.handle ? ` @${u.handle}` : ''}</label>)}
          <div className="eco-form-grid">
            <label>코인 (보정은 음수 가능)<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label>캠페인 (지급용)<input value={campaign} onChange={(e) => setCampaign(e.target.value)} /></label>
            <label>사유 (보정용)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          </div>
          <div className="eco-row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={!target} onClick={async () => done(await admin.grantCoins(target, Number(amount), 'event_reward', campaign, String(Date.now())), '이벤트 코인을 지급했습니다.')}>이벤트 지급</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!target} onClick={async () => done(await admin.grantCoins(target, Number(amount), 'promo_grant', campaign, String(Date.now())), '프로모션 코인을 지급했습니다.')}>프로모션 지급</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!target} onClick={async () => done(await admin.adjustWallet(target, Number(amount), reason), '보정 거래를 기록했습니다.')}>보정 거래</button>
          </div>
        </div>
      </Block>
    </div>
  );
}

function Partners({ done }: { done: Done }) {
  const list = useLoad(admin.listCampaigns);
  const [v, setV] = useState({ partner_name: '', kind: 'brand', label: '광고', title: '', body: '', link_url: '', image_url: '', placement: 'gear', ends_at: '', fee_krw: '0', contract_reference: '' });
  const save = async (p: Record<string, unknown>, ok: string) => { done(await admin.saveCampaign(p), ok); list.reload(); };
  return (
    <div className="eco-stack">
      <p className="eco-meta">관리자 승인형 제휴만 노출됩니다. 광고 표시가 항상 붙고, 광고주에게 사용자 정보는 제공되지 않습니다(노출·클릭 합계만). 연령 타깃팅·성인 상품 광고는 하지 않습니다.</p>
      {list.data?.map((c: PartnerCampaign) => (
        <div key={c.id} className="eco-card eco-row eco-row--between">
          <span><span className="eco-pill">{c.label}</span> <strong>{c.title}</strong> · {c.partner_name} · {c.placement} · {c.status} · 노출 {c.impressions} · 클릭 {c.clicks}</span>
          <span className="eco-row">
            {c.status !== 'approved' && <button type="button" className="btn btn-primary btn-sm" onClick={() => void save({ id: c.id, status: 'approved' }, '캠페인을 승인했습니다.')}>승인·게시</button>}
            {c.status === 'approved' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save({ id: c.id, status: 'paused' }, '일시 중지했습니다.')}>중지</button>}
          </span>
        </div>
      ))}
      <div className="eco-card eco-form">
        <div className="eco-form-grid">
          <label>제휴사<input value={v.partner_name} onChange={(e) => setV({ ...v, partner_name: e.target.value })} /></label>
          <label>유형<select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="brand">용품 브랜드</option><option value="gym_promo">체육관 홍보</option><option value="content">교육 콘텐츠</option><option value="official_promo">공식 프로모션</option><option value="product">협력사 상품</option></select></label>
          <label>표시<select value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })}><option>광고</option><option>제휴</option><option>프로모션</option></select></label>
          <label>위치<select value={v.placement} onChange={(e) => setV({ ...v, placement: e.target.value })}><option value="gear">장비 마켓</option><option value="content">콘텐츠 마켓</option><option value="home">홈</option><option value="learning">학습</option></select></label>
          <label>제목<input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
          <label>링크 (https)<input value={v.link_url} onChange={(e) => setV({ ...v, link_url: e.target.value })} /></label>
          <label>이미지 (https)<input value={v.image_url} onChange={(e) => setV({ ...v, image_url: e.target.value })} /></label>
          <label>종료일<input type="date" value={v.ends_at} onChange={(e) => setV({ ...v, ends_at: e.target.value })} /></label>
          <label>계약 금액 (원)<input type="number" value={v.fee_krw} onChange={(e) => setV({ ...v, fee_krw: e.target.value })} /></label>
          <label>계약 번호<input value={v.contract_reference} onChange={(e) => setV({ ...v, contract_reference: e.target.value })} /></label>
        </div>
        <label>설명<input value={v.body} maxLength={500} onChange={(e) => setV({ ...v, body: e.target.value })} /></label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void save({ ...v, ends_at: v.ends_at || null, fee_krw: Number(v.fee_krw) }, '캠페인 초안을 만들었습니다. 승인해야 노출됩니다.')}>초안 만들기</button>
      </div>
    </div>
  );
}

function GearDisputes({ done }: { done: Done }) {
  const list = useLoad(admin.listGearDisputes);
  if (list.error) return <ErrorState text={list.error} />;
  if (!list.data) return <LoadingState />;
  if (!list.data.length) return <p className="eco-meta">장비 거래 분쟁이 없습니다.</p>;
  return (
    <div className="eco-stack">
      <p className="eco-meta">결제 취소(환불)는 결제사 승인이 필요해 발송 전 주문만 자동 처리됩니다. 발송 이후 환불 판정은 기록 후 결제사 콘솔에서 수동 처리합니다.</p>
      <div className="eco-table-wrap"><table className="eco-table"><tbody>
        {list.data.map((d) => (
          <tr key={d.id}><td>{formatDate(d.created_at)}</td><td>{d.order_id}</td><td>{GEAR_DISPUTE_LABEL[d.reason]}</td><td>{d.detail}</td><td>{d.status}</td>
            <td className="eco-row">{d.status === 'open' && <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { const n = window.prompt('판정 메모'); if (!n) return; done(await admin.resolveGearDispute(d.id, 'resolved_refund', n), '환불 판정을 기록했습니다.'); list.reload(); }}>환불 판정</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const n = window.prompt('판정 메모'); if (!n) return; done(await admin.resolveGearDispute(d.id, 'resolved_no_refund', n), '환불 없음으로 종결했습니다.'); list.reload(); }}>환불 없음</button>
            </>}</td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}
