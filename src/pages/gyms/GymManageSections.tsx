// 체육관 관리자 화면의 가격·제휴·할인·쿠폰·통계 탭. GymManageListing.tsx 에서만 쓴다.
import { useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  COUPON_STATE_LABEL,
  PLAN_LABEL,
  applyPartnership,
  couponState,
  createOffer,
  getPartnership,
  getPricing,
  leadStats,
  listListingCoupons,
  listOwnerOffers,
  reapplyPartnership,
  redeemCoupon,
  savePricing,
  setOfferStatus,
  validateOffer,
  type GymCoupon,
  type GymListing,
  type GymOffer,
  type GymPricing,
  type GymPricingInput,
  type LeadStats,
  type OfferInput,
  type OfferPlan,
  type Partnership,
} from '../../lib/gymDirectory/service';
import { OFFER_STATUS_LABEL, OFFER_TARGET_LABEL, OfferPrice, offerDiscountText, offerLimitText, offerPeriodText } from './gymShared';

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <span className="eco-meta" role={msg.ok ? 'status' : 'alert'} style={msg.ok ? undefined : { color: 'var(--accent)' }}>
      {msg.text}
    </span>
  );
}

// ---------------- 가격 ----------------

const MONEY_FIELDS: [keyof GymPricingInput, string][] = [
  ['monthly', '월 회비 (원)'],
  ['threeMonth', '3개월 (원)'],
  ['sixMonth', '6개월 (원)'],
  ['yearly', '연간 (원)'],
  ['initiationFee', '입회비 (원)'],
  ['registrationFee', '등록비 (원)'],
  ['gearCost', '도복·장비 비용 (원)'],
  ['trialPrice', '체험 수업 가격 (원)'],
];
const BOOL_FIELDS: [keyof GymPricingInput, string][] = [
  ['openMat', '자유 연습(오픈매트)'],
  ['multiArt', '여러 종목 수강'],
  ['trialAvailable', '체험 수업'],
];
const NUM_KEYS = ['monthly', 'threeMonth', 'sixMonth', 'yearly', 'initiationFee', 'registrationFee', 'gearCost', 'trialPrice', 'sessionsPerWeek', 'minutesPerSession'] as const;
type NumKey = (typeof NUM_KEYS)[number];
type BoolKey = 'openMat' | 'multiArt' | 'trialAvailable';
type PricingForm = Record<NumKey, string> & Record<BoolKey, '' | 'yes' | 'no'> & { notes: string };

function pricingToForm(p: GymPricing | null): PricingForm {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const b = (v: boolean | null | undefined): '' | 'yes' | 'no' => (v === null || v === undefined ? '' : v ? 'yes' : 'no');
  return {
    monthly: n(p?.monthly),
    threeMonth: n(p?.threeMonth),
    sixMonth: n(p?.sixMonth),
    yearly: n(p?.yearly),
    initiationFee: n(p?.initiationFee),
    registrationFee: n(p?.registrationFee),
    gearCost: n(p?.gearCost),
    trialPrice: n(p?.trialPrice),
    sessionsPerWeek: n(p?.sessionsPerWeek),
    minutesPerSession: n(p?.minutesPerSession),
    openMat: b(p?.openMat),
    multiArt: b(p?.multiArt),
    trialAvailable: b(p?.trialAvailable),
    notes: p?.notes ?? '',
  };
}

function formToPricing(f: PricingForm): GymPricingInput | string {
  const out: Partial<Record<NumKey, number | null>> = {};
  for (const k of NUM_KEYS) {
    const raw = f[k].trim().replace(/,/g, '');
    if (raw === '') {
      out[k] = null;
      continue;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return '금액·횟수는 0 이상의 숫자로 입력해 주세요. 모르면 비워 두세요.';
    if (k === 'sessionsPerWeek') {
      if (v > 21 || Math.round(v * 10) !== v * 10) return '주당 수업 횟수는 0~21 사이, 소수점 한 자리까지 입력해 주세요.';
    } else if (!Number.isInteger(v)) return '금액과 수업 시간은 정수로 입력해 주세요.';
    if (k === 'minutesPerSession' && v > 600) return '1회 수업 시간은 600분 이하로 입력해 주세요.';
    if (k === 'trialPrice' && v > 10000000) return '체험 수업 가격이 너무 큽니다.';
    if (v > 100000000) return '금액이 너무 큽니다.';
    out[k] = v;
  }
  if (f.notes.length > 1000) return '비고는 1000자 이하로 입력해 주세요.';
  const b = (v: '' | 'yes' | 'no') => (v === '' ? null : v === 'yes');
  return {
    monthly: out.monthly ?? null,
    threeMonth: out.threeMonth ?? null,
    sixMonth: out.sixMonth ?? null,
    yearly: out.yearly ?? null,
    initiationFee: out.initiationFee ?? null,
    registrationFee: out.registrationFee ?? null,
    gearCost: out.gearCost ?? null,
    trialPrice: out.trialPrice ?? null,
    sessionsPerWeek: out.sessionsPerWeek ?? null,
    minutesPerSession: out.minutesPerSession ?? null,
    openMat: b(f.openMat),
    multiArt: b(f.multiArt),
    trialAvailable: b(f.trialAvailable),
    notes: f.notes,
  };
}

export function PricingSection({ listingId }: { listingId: string }) {
  const [pricing, setPricing] = useState<GymPricing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [f, setF] = useState<PricingForm>(() => pricingToForm(null));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const p = await getPricing(listingId);
    setPricing(p);
    setF(pricingToForm(p));
    setLoaded(true);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  async function handleSave() {
    setMsg(null);
    const input = formToPricing(f);
    if (typeof input === 'string') {
      setMsg({ ok: false, text: input });
      return;
    }
    if (pricing?.verifiedAt && !window.confirm('가격을 저장하면 플랫폼 가격 검증 표시가 해제되고 다시 검증을 받아야 합니다. 저장할까요?')) return;
    setBusy(true);
    const r = await savePricing(listingId, input, pricing !== null);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    await load();
    setMsg({ ok: true, text: '가격을 저장했습니다. 최종 확인일이 오늘로 바뀌었습니다.' });
  }

  if (!loaded) return <LoadingState text="가격 정보를 불러오는 중..." />;

  return (
    <div className="eco-form">
      <div className="eco-row">
        <span className="eco-meta">최종 확인일: {pricing ? formatDate(pricing.ownerConfirmedAt) : '아직 입력 전'}</span>
        <span className="eco-meta">·</span>
        <span className="eco-meta">플랫폼 가격 검증: {pricing?.verifiedAt ? `완료 (${formatDate(pricing.verifiedAt)})` : '미검증'}</span>
      </div>
      <div className="eco-notice">
        가격을 바꾸면 최종 확인일이 갱신되고 플랫폼 가격 검증이 해제됩니다. 할인 쿠폰은 검증된 원래 가격이 있어야 발급되므로, 진행 중인 할인이 있다면 다시 검증을 받을 때까지
        쿠폰 발급이 멈춥니다. 모르는 항목은 비워 두세요(추정값을 넣지 마세요).
      </div>
      <div className="eco-form-grid">
        {MONEY_FIELDS.map(([k, label]) => (
          <label key={k}>
            {label}
            <input inputMode="numeric" value={f[k as NumKey]} placeholder="정보 없음" onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
          </label>
        ))}
        <label>
          주당 수업 횟수
          <input inputMode="decimal" value={f.sessionsPerWeek} placeholder="정보 없음" onChange={(e) => setF((p) => ({ ...p, sessionsPerWeek: e.target.value }))} />
        </label>
        <label>
          1회 수업 시간 (분)
          <input inputMode="numeric" value={f.minutesPerSession} placeholder="정보 없음" onChange={(e) => setF((p) => ({ ...p, minutesPerSession: e.target.value }))} />
        </label>
        {BOOL_FIELDS.map(([k, label]) => (
          <label key={k}>
            {label}
            <select value={f[k as BoolKey]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value as '' | 'yes' | 'no' }))}>
              <option value="">모름</option>
              <option value="yes">예</option>
              <option value="no">아니오</option>
            </select>
          </label>
        ))}
      </div>
      <label>
        비고
        <textarea value={f.notes} maxLength={1000} placeholder="예: 부가세 포함, 가족 할인 별도 문의" onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
      </label>
      <div className="eco-row">
        <button type="button" className="btn btn-primary" data-testid="gym-pricing-save" disabled={busy} onClick={handleSave}>
          {busy ? '저장 중...' : '가격 저장'}
        </button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

// ---------------- 제휴 ----------------

const PARTNER_STATUS: Record<Partnership['status'], [string, string]> = {
  applied: ['검토 중', 'eco-pill eco-pill--warn'],
  active: ['제휴 중', 'eco-pill eco-pill--good'],
  rejected: ['반려', 'eco-pill eco-pill--accent'],
  ended: ['종료', 'eco-pill eco-pill--muted'],
};

export function PartnershipSection({ listing }: { listing: GymListing }) {
  const [p, setP] = useState<Partnership | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState<'basic' | 'premium'>('basic');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setP(await getPartnership(listing.id));
    setLoaded(true);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id]);

  async function handleApply() {
    setBusy(true);
    setMsg(null);
    const r = p ? await reapplyPartnership(listing.id, note) : await applyPartnership(listing.id, note, plan);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    setNote('');
    await load();
    setMsg({ ok: true, text: '제휴를 신청했습니다. 플랫폼 담당자가 연락드립니다.' });
  }

  return (
    <div className="eco-stack">
      <div className="eco-card">
        <h3>제휴는 이렇게 운영됩니다</h3>
        <ul className="eco-meta" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>신규 회원 유치 수수료: MARTIALDEX 쿠폰으로 실제 등록한 회원에 한해 계약한 비율의 수수료</li>
          <li>월 구독료: 제휴 체육관 표시와 할인·쿠폰 운영 도구 이용료</li>
          <li>프리미엄 노출(premium): 검색·할인 화면 상단 노출 등 추가 홍보</li>
          <li>프로모션: 기간 한정 할인, 체험 수업 쿠폰 등 공동 행사</li>
        </ul>
        <p className="eco-meta" style={{ marginTop: 8 }}>
          수수료율·월 구독료·기간 등 실제 조건은 신청 후 플랫폼과 계약을 맺고, 플랫폼이 계약을 확인해 제휴를 활성화할 때 정해집니다. 그 전에는 어떤 비용도 청구되지 않으며
          "제휴" 표시와 할인도 공개되지 않습니다.
        </p>
      </div>

      {!loaded ? (
        <LoadingState text="제휴 상태를 불러오는 중..." />
      ) : (
        <div className="eco-card eco-form">
          {p && (
            <div className="eco-stack">
              <div className="eco-row">
                <strong>제휴 상태</strong>
                <span className={PARTNER_STATUS[p.status][1]}>{PARTNER_STATUS[p.status][0]}</span>
                <span className="eco-pill">{p.plan === 'premium' ? '프리미엄' : '기본'}</span>
              </div>
              <div className="eco-meta">
                신청일 {formatDate(p.appliedAt)}
                {p.decidedAt ? ` · 결정일 ${formatDate(p.decidedAt)}` : ''}
              </div>
              {p.status === 'active' && (
                <div className="eco-meta">
                  계약 번호 {p.contractReference || '—'} · 기간 {formatDate(p.startsOn)} ~ {p.endsOn ? formatDate(p.endsOn) : '종료일 없음'}
                  {p.commissionRate !== null ? ` · 수수료 ${p.commissionRate}%` : ''}
                  {p.monthlyFee !== null ? ` · 월 구독료 ${formatWon(p.monthlyFee)}` : ''}
                </div>
              )}
              {p.status === 'applied' && <p className="eco-meta">플랫폼이 신청을 검토하고 있습니다. 계약이 확인되면 제휴가 활성화됩니다.</p>}
              {p.applicantNote && <p className="eco-meta" style={{ whiteSpace: 'pre-wrap' }}>신청 메모: {p.applicantNote}</p>}
            </div>
          )}
          {listing.status !== 'approved' && (
            <div className="eco-notice">체육관 등록이 승인되어야 제휴를 활성화할 수 있습니다. 신청은 미리 해 둘 수 있습니다.</div>
          )}
          {(!p || p.status === 'rejected' || p.status === 'ended') && (
            <>
              <strong>{p ? '제휴 다시 신청' : '제휴 신청'}</strong>
              {!p && (
                <label>
                  희망 플랜
                  <select value={plan} onChange={(e) => setPlan(e.target.value as 'basic' | 'premium')}>
                    <option value="basic">기본</option>
                    <option value="premium">프리미엄 (추가 노출)</option>
                  </select>
                </label>
              )}
              <label>
                신청 메모 (담당자 연락처, 희망 조건 등)
                <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="eco-row">
                <button type="button" className="btn btn-primary" data-testid="gym-partner-apply" disabled={busy} onClick={handleApply}>
                  {p ? '다시 신청' : '제휴 신청'}
                </button>
                <Msg msg={msg} />
              </div>
            </>
          )}
          {p && p.status !== 'rejected' && p.status !== 'ended' && <Msg msg={msg} />}
        </div>
      )}
    </div>
  );
}

// ---------------- 할인 ----------------

const dateInput = (d: Date) => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

export function OffersSection({ listingId }: { listingId: string }) {
  const [offers, setOffers] = useState<GymOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  const [title, setTitle] = useState('');
  const [plan, setPlan] = useState<OfferPlan>('monthly');
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [target, setTarget] = useState<'new_members' | 'everyone'>('new_members');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [startsOn, setStartsOn] = useState(() => dateInput(new Date()));
  const [endsOn, setEndsOn] = useState(() => dateInput(new Date(Date.now() + 30 * 86400000)));
  const [terms, setTerms] = useState('');

  async function load() {
    setError(null);
    const r = await listOwnerOffers(listingId);
    if (r.ok) setOffers(r.data);
    else setError(r.message);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  async function handleCreate() {
    setFormMsg(null);
    if (!startsOn || !endsOn) {
      setFormMsg({ ok: false, text: '시작일과 종료일을 입력해 주세요.' });
      return;
    }
    const input: OfferInput = {
      title,
      plan,
      discountType,
      discountValue: Number(discountValue.replace(/,/g, '')),
      target,
      maxRedemptions: maxRedemptions.trim() === '' ? null : Number(maxRedemptions),
      startsAt: new Date(`${startsOn}T00:00:00`).toISOString(),
      endsAt: new Date(`${endsOn}T23:59:59`).toISOString(),
      terms,
    };
    const invalid = validateOffer(input);
    if (invalid) {
      setFormMsg({ ok: false, text: invalid });
      return;
    }
    setBusy(true);
    const r = await createOffer(listingId, input);
    setBusy(false);
    if (!r.ok) {
      setFormMsg({ ok: false, text: r.message });
      return;
    }
    setTitle('');
    setDiscountValue('');
    setMaxRedemptions('');
    setTerms('');
    setFormMsg({ ok: true, text: '초안으로 만들었습니다. 아래 목록에서 진행을 시작할 수 있습니다.' });
    void load();
  }

  async function changeStatus(o: GymOffer, status: GymOffer['status']) {
    if (status === 'ended' && !window.confirm(`"${o.title}" 할인을 종료할까요? 종료한 할인은 다시 열 수 없습니다.`)) return;
    setBusy(true);
    setRowMsg((m) => ({ ...m, [o.id]: '' }));
    const r = await setOfferStatus(o.id, status);
    setBusy(false);
    if (!r.ok) {
      setRowMsg((m) => ({ ...m, [o.id]: r.message }));
      return;
    }
    void load();
  }

  return (
    <div className="eco-stack">
      <div className="eco-notice eco-notice--accent">
        할인은 플랫폼이 제휴 계약을 확인한 뒤에만 "진행 중"으로 바꿀 수 있습니다. 할인가는 플랫폼이 검증한 원래 가격에서 서버가 계산하므로, 해당 요금의 가격이 검증되지 않았으면
        쿠폰이 발급되지 않습니다.
      </div>

      <div className="eco-card eco-form">
        <h3>새 할인 만들기</h3>
        <label>
          할인 이름
          <input value={title} maxLength={80} placeholder="예: 신규 회원 첫 달 할인" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="eco-form-grid">
          <label>
            적용 요금
            <select value={plan} onChange={(e) => setPlan(e.target.value as OfferPlan)}>
              {(Object.keys(PLAN_LABEL) as OfferPlan[]).map((k) => (
                <option key={k} value={k}>
                  {PLAN_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            할인 방식
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as 'percent' | 'amount')}>
              <option value="percent">비율 (%)</option>
              <option value="amount">금액 (원)</option>
            </select>
          </label>
          <label>
            할인 값 {discountType === 'percent' ? '(%, 최대 90)' : '(원)'}
            <input inputMode="numeric" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
          </label>
          <label>
            대상
            <select value={target} onChange={(e) => setTarget(e.target.value as 'new_members' | 'everyone')}>
              <option value="new_members">신규 회원</option>
              <option value="everyone">누구나</option>
            </select>
          </label>
          <label>
            인원 제한 (비우면 제한 없음)
            <input inputMode="numeric" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
          </label>
          <label>
            시작일
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          <label>
            종료일
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
        </div>
        <label>
          조건·유의사항
          <textarea value={terms} maxLength={2000} placeholder="예: 첫 등록 시 1회 적용, 다른 할인과 중복 불가" onChange={(e) => setTerms(e.target.value)} />
        </label>
        <div className="eco-row">
          <button type="button" className="btn btn-primary" data-testid="gym-offer-create" disabled={busy} onClick={handleCreate}>
            <Icon name="plus" /> 초안 만들기
          </button>
          <Msg msg={formMsg} />
        </div>
      </div>

      <div className="eco-section">
        <h3>내 할인</h3>
      </div>
      {error ? (
        <ErrorState text={error} onRetry={() => void load()} />
      ) : !offers ? (
        <LoadingState text="할인을 불러오는 중..." />
      ) : offers.length === 0 ? (
        <EmptyState icon="📋" text="아직 만든 할인이 없습니다." />
      ) : (
        <div className="eco-stack">
          {offers.map((o) => (
            <div key={o.id} className="eco-card eco-stack">
              <div className="eco-row eco-row--between">
                <strong>{o.title}</strong>
                <span className={o.status === 'active' ? 'eco-pill eco-pill--good' : o.status === 'ended' ? 'eco-pill eco-pill--muted' : 'eco-pill eco-pill--warn'}>
                  {OFFER_STATUS_LABEL[o.status]}
                </span>
              </div>
              <div className="eco-row">
                <span className="eco-pill eco-pill--accent">{offerDiscountText(o)}</span>
                <span className="eco-meta">{OFFER_TARGET_LABEL[o.target]}</span>
              </div>
              <OfferPrice offer={o} />
              <div className="eco-meta">
                {offerPeriodText(o)} · {offerLimitText(o)}
              </div>
              {o.terms && <div className="eco-meta" style={{ whiteSpace: 'pre-wrap' }}>조건: {o.terms}</div>}
              {o.status !== 'ended' && (
                <div className="eco-row">
                  {o.status !== 'active' && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => changeStatus(o, 'active')}>
                      진행 시작
                    </button>
                  )}
                  {o.status === 'active' && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => changeStatus(o, 'paused')}>
                      일시 중지
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => changeStatus(o, 'ended')}>
                    종료
                  </button>
                </div>
              )}
              {rowMsg[o.id] && (
                <p className="eco-meta" role="alert" style={{ color: 'var(--accent)', margin: 0 }}>
                  {rowMsg[o.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- 쿠폰 ----------------

export function CouponsSection({ listingId }: { listingId: string }) {
  const [coupons, setCoupons] = useState<GymCoupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setError(null);
    const r = await listListingCoupons(listingId);
    if (r.ok) setCoupons(r.data);
    else setError(r.message);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  async function handleRedeem() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setMsg(null);
    const r = await redeemCoupon(c);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    setCode('');
    setMsg({ ok: true, text: `${c} 쿠폰을 사용 처리했습니다. 회원 화면에 "등록 확인"으로 표시됩니다.` });
    void load();
  }

  return (
    <div className="eco-stack">
      <div className="eco-card eco-form">
        <h3>쿠폰 사용 처리</h3>
        <p className="eco-meta" style={{ margin: 0 }}>
          회원이 실제로 등록하면 쿠폰 코드를 입력해 사용 처리하세요. 이 기록이 신규 회원 유치 수수료 정산의 근거가 됩니다.
        </p>
        <div className="eco-row">
          <input
            data-testid="gym-redeem-input"
            value={code}
            placeholder="예: AB12-CD34"
            aria-label="쿠폰 코드"
            style={{ flex: '1 1 180px', fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase' }}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRedeem();
            }}
          />
          <button type="button" className="btn btn-primary" data-testid="gym-redeem-go" disabled={busy || !code.trim()} onClick={handleRedeem}>
            사용 처리
          </button>
        </div>
        <Msg msg={msg} />
      </div>

      <div className="eco-section">
        <h3>발급된 쿠폰</h3>
      </div>
      {error ? (
        <ErrorState text={error} onRetry={() => void load()} />
      ) : !coupons ? (
        <LoadingState text="쿠폰을 불러오는 중..." />
      ) : coupons.length === 0 ? (
        <EmptyState icon="📭" text="아직 발급된 쿠폰이 없습니다." />
      ) : (
        <div className="eco-table-wrap">
          <table className="eco-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>회원</th>
                <th>원래 가격</th>
                <th>할인가</th>
                <th>상태</th>
                <th>발급일</th>
                <th>기한 / 사용일</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const st = couponState(c);
                return (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{c.code}</td>
                    <td>{c.userNickname || '회원'}</td>
                    <td>{formatWon(c.originalPrice)}</td>
                    <td>{formatWon(c.discountedPrice)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{COUPON_STATE_LABEL[st]}</td>
                    <td>{formatDate(c.issuedAt)}</td>
                    <td>{st === 'redeemed' ? formatDate(c.redeemedAt) : formatDate(c.expiresAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- 통계 ----------------

export function StatsSection({ listingId }: { listingId: string }) {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const r = await leadStats(listingId);
    if (r.ok) setStats(r.data);
    else setError(r.message);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  if (error) return <ErrorState text={error} onRetry={() => void load()} />;
  if (!stats) return <LoadingState text="통계를 불러오는 중..." />;

  const max = Math.max(1, ...stats.byMonth.flatMap((m) => [m.inquiries, m.issued, m.redeemed]));

  return (
    <div>
      <div className="eco-metrics">
        <div className="eco-metric">
          <div className="eco-metric__label">문의</div>
          <div className="eco-metric__value">{stats.inquiries.toLocaleString('ko-KR')}</div>
          <div className="eco-metric__sub">앱에서 시작된 DM 문의</div>
        </div>
        <div className="eco-metric">
          <div className="eco-metric__label">쿠폰 발급</div>
          <div className="eco-metric__value">{stats.couponsIssued.toLocaleString('ko-KR')}</div>
          <div className="eco-metric__sub">취소 제외</div>
        </div>
        <div className="eco-metric">
          <div className="eco-metric__label">사용(등록)</div>
          <div className="eco-metric__value">{stats.couponsRedeemed.toLocaleString('ko-KR')}</div>
          <div className="eco-metric__sub">체육관이 사용 처리한 쿠폰</div>
        </div>
        <div className="eco-metric">
          <div className="eco-metric__label">전환율</div>
          <div className="eco-metric__value">{stats.conversionRate === null ? '—' : `${stats.conversionRate}%`}</div>
          <div className="eco-metric__sub">사용 / 발급</div>
        </div>
      </div>

      <div className="eco-section">
        <h3>월별 추이</h3>
      </div>
      {stats.byMonth.length === 0 ? (
        <EmptyState icon="📊" text="아직 기록된 문의나 쿠폰이 없습니다." />
      ) : (
        <div className="eco-stack">
          <div className="eco-row eco-meta">
            <span className="eco-row">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', display: 'inline-block' }} /> 문의
            </span>
            <span className="eco-row">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--gold)', display: 'inline-block' }} /> 쿠폰 발급
            </span>
            <span className="eco-row">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--beginner)', display: 'inline-block' }} /> 사용(등록)
            </span>
          </div>
          {stats.byMonth.map((m) => (
            <div key={m.month} className="eco-card">
              <strong style={{ fontSize: 14 }}>{m.month.replace('-', '년 ')}월</strong>
              <div className="eco-bars">
                {(
                  [
                    ['문의', m.inquiries, ''],
                    ['쿠폰 발급', m.issued, ' eco-bar__fill--alt'],
                    ['사용(등록)', m.redeemed, ' eco-bar__fill--good'],
                  ] as const
                ).map(([label, v, cls]) => (
                  <div key={label} className="eco-bar">
                    <span className="eco-bar__label">{label}</span>
                    <span className="eco-bar__track">
                      <span className={`eco-bar__fill${cls}`} style={{ width: `${(v / max) * 100}%` }} />
                    </span>
                    <span className={v ? 'eco-bar__value' : 'eco-bar__value eco-bar__value--muted'}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
