// /admin/platform — 플랫폼 관리자 콘솔: 체육관 등록 검토 · 제휴 계약 · 자격 검증 · 신고 처리.
// 화면 게이트는 편의일 뿐이고, 모든 쓰기는 서버 RPC 가 is_platform_admin() 으로 다시 검사한다.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { supabase } from '../lib/supabase/client';
import { amIPlatformAdmin, callRpc, formatWon, run } from '../lib/ecosystem/common';
import {
  GYM_ARTS,
  adminListListings,
  adminListPartnerships,
  decidePartnership,
  getPricing,
  reviewListing,
  verifyPricing,
  type GymListing,
  type GymPricing,
  type Partnership,
} from '../lib/gymDirectory/service';
import { CREDENTIAL_ARTS, CREDENTIAL_TIERS, adminListPendingCredentials, reviewCredential, type CredentialApplication } from '../lib/ecosystem/credentials';
import BackButton from '../components/BackButton';
import MonetizationAdmin from '../components/admin/MonetizationAdmin';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingState from '../components/LoadingState';
import Icon from '../components/Icon';
import { fmtDate, fmtDateTime } from '../components/gymAdmin/shared';

const TABS = [
  { key: 'listings', label: '체육관 등록 검토' },
  { key: 'partnerships', label: '제휴 계약' },
  { key: 'credentials', label: '자격 검증' },
  { key: 'reports', label: '신고' },
  { key: 'monetization', label: '수익화' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const LISTING_STATUS: Record<GymListing['status'], string> = { pending: '검토 대기', approved: '승인', rejected: '반려', suspended: '게시 중단' };
const PARTNER_STATUS: Record<Partnership['status'], string> = { applied: '신청', active: '활성', rejected: '거절', ended: '종료' };

function useAsync<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    setLoading(true);
    setError(null);
    const r = await fn();
    if (r.ok) setData(r.data);
    else setError(r.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error, reload };
}

// ---------------- 체육관 등록 검토 ----------------

const PRICE_ROWS: [keyof GymPricing, string][] = [
  ['monthly', '월 회비'],
  ['threeMonth', '3개월'],
  ['sixMonth', '6개월'],
  ['yearly', '연간'],
  ['initiationFee', '입회비'],
  ['registrationFee', '등록비'],
  ['gearCost', '장비 비용'],
  ['trialPrice', '체험 수업'],
];

function ListingReview({ listing, onChanged }: { listing: GymListing; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [pricing, setPricing] = useState<GymPricing | null | undefined>(undefined);
  const [note, setNote] = useState(listing.reviewNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadPricing() {
    setPricing(undefined);
    setPricing(await getPricing(listing.id));
  }

  useEffect(() => {
    if (open && pricing === undefined) void loadPricing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function decide(status: GymListing['status']) {
    if ((status === 'rejected' || status === 'suspended') && !note.trim()) {
      setError('반려·게시 중단 시에는 체육관 관리자에게 보일 사유를 적어 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    const r = await reviewListing(listing.id, status, note.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onChanged();
  }

  async function verify() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const r = await verifyPricing(listing.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setMsg('가격을 검증 완료로 표시했습니다.');
    void loadPricing();
  }

  return (
    <div className="eco-card">
      <div className="eco-row eco-row--between">
        <div className="eco-row">
          <strong>{listing.name}</strong>
          <span className={listing.status === 'approved' ? 'eco-pill eco-pill--good' : listing.status === 'pending' ? 'eco-pill eco-pill--accent' : 'eco-pill eco-pill--warn'}>{LISTING_STATUS[listing.status]}</span>
        </div>
        <span className="eco-meta--faint">등록 {fmtDate(listing.createdAt)}</span>
      </div>
      <p className="eco-meta">
        {listing.region || '지역 미입력'} · {listing.address || '주소 미입력'} · {listing.arts.map((a) => GYM_ARTS[a] ?? a).join(', ') || '종목 미입력'}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '접기' : '상세·가격 보기'}
      </button>
      {open && (
        <div className="eco-stack" style={{ marginTop: 8 }}>
          {listing.description && <p className="gadm-body">{listing.description}</p>}
          <ul className="gadm-subtle-list">
            <li>전화: {listing.phone || '없음'}</li>
            <li>웹사이트: {listing.website || '없음'}</li>
            <li>운영 시간: {listing.hours || '없음'}</li>
            <li>시설: {listing.facilities.join(', ') || '없음'}</li>
            <li>
              지도자: {listing.instructors.length ? listing.instructors.map((i) => `${i.name}${i.title ? ` (${i.title})` : ''}`).join(', ') : '없음'}
            </li>
            <li>시간표: {listing.schedule.length}개 수업</li>
            {listing.gymId && <li>연결된 MARTIALDEX 체육관 있음</li>}
          </ul>
          {pricing === undefined ? (
            <LoadingState text="가격 정보를 불러오는 중..." />
          ) : pricing === null ? (
            <p className="eco-meta">체육관 관리자가 아직 가격을 등록하지 않았습니다.</p>
          ) : (
            <div>
              <div className="eco-row">
                <strong>가격</strong>
                {pricing.verifiedAt ? <span className="eco-pill eco-pill--good">검증됨 {fmtDate(pricing.verifiedAt)}</span> : <span className="eco-pill eco-pill--warn">미검증</span>}
                <span className="eco-meta--faint">관리자 확인 {fmtDate(pricing.ownerConfirmedAt)}</span>
              </div>
              <div className="eco-table-wrap" style={{ marginTop: 6 }}>
                <table className="eco-table">
                  <tbody>
                    {PRICE_ROWS.map(([k, label]) => (
                      <tr key={k}>
                        <th>{label}</th>
                        <td className={pricing[k] === null ? 'eco-missing' : ''}>{formatWon(pricing[k] as number | null)}</td>
                      </tr>
                    ))}
                    <tr>
                      <th>주당 수업</th>
                      <td>{pricing.sessionsPerWeek ?? '정보 없음'}{pricing.minutesPerSession ? ` · 회당 ${pricing.minutesPerSession}분` : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {pricing.notes && <p className="eco-meta">{pricing.notes}</p>}
              <div className="gadm-actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={verify}>
                  <Icon name="verified" /> 가격 검증
                </button>
              </div>
              <p className="eco-meta--faint">체육관 공식 자료나 직접 확인으로 가격이 맞는 것을 확인한 경우에만 검증하세요. 검증된 가격만 할인 쿠폰의 기준이 됩니다.</p>
            </div>
          )}
        </div>
      )}
      <div className="eco-form" style={{ marginTop: 10 }}>
        <label>
          검토 메모 (체육관 관리자에게 보입니다)
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="반려·중단 사유 또는 확인 내용" />
        </label>
      </div>
      <div className="gadm-actions">
        {listing.status !== 'approved' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('approved')}>
            <Icon name="check" /> 승인
          </button>
        )}
        {listing.status !== 'rejected' && listing.status !== 'approved' && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide('rejected')}>
            반려
          </button>
        )}
        {listing.status !== 'suspended' && listing.status !== 'pending' && (
          <button type="button" className="btn btn-ghost btn-sm gadm-btn-danger" disabled={busy} onClick={() => decide('suspended')}>
            게시 중단
          </button>
        )}
      </div>
      {error && <p className="gadm-error">{error}</p>}
      {msg && <p className="gadm-ok">{msg}</p>}
    </div>
  );
}

function ListingsTab() {
  const [filter, setFilter] = useState<GymListing['status'] | 'all'>('pending');
  const { data, loading, error, reload } = useAsync(() => adminListListings(filter), [filter]);
  return (
    <div>
      <div className="eco-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="상태">
          <option value="pending">검토 대기</option>
          <option value="all">전체</option>
          <option value="approved">승인</option>
          <option value="rejected">반려</option>
          <option value="suspended">게시 중단</option>
        </select>
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState text={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState icon="🏛" text={filter === 'pending' ? '검토 대기 중인 체육관 등록이 없습니다.' : '해당 상태의 체육관이 없습니다.'} />
      ) : (
        <div className="eco-stack">
          {data.map((l) => (
            <ListingReview key={`${l.id}:${l.updatedAt}:${l.status}`} listing={l} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- 제휴 계약 ----------------

function PartnershipItem({ p, name, onChanged }: { p: Partnership; name: string; onChanged: () => void }) {
  const [contract, setContract] = useState(p.contractReference);
  const [commission, setCommission] = useState(p.commissionRate === null ? '' : String(p.commissionRate));
  const [fee, setFee] = useState(p.monthlyFee === null ? '' : String(p.monthlyFee));
  const [starts, setStarts] = useState(p.startsOn ?? '');
  const [ends, setEnds] = useState(p.endsOn ?? '');
  const [plan, setPlan] = useState<Partnership['plan']>(p.plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: 'active' | 'rejected' | 'ended') {
    const c = commission.trim() === '' ? null : Number(commission);
    const f = fee.trim() === '' ? null : Number(fee);
    if (c !== null && (!Number.isFinite(c) || c < 0 || c > 100)) {
      setError('수수료는 0~100 사이 숫자로 입력해 주세요.');
      return;
    }
    if (f !== null && (!Number.isInteger(f) || f < 0)) {
      setError('월 이용료는 0 이상의 정수(원)로 입력해 주세요.');
      return;
    }
    if (status === 'active' && (!contract.trim() || !starts)) {
      setError('활성화하려면 서명된 계약서의 계약 번호와 시작일이 필요합니다.');
      return;
    }
    if (ends && starts && ends < starts) {
      setError('종료일이 시작일보다 빠릅니다.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await decidePartnership(p.listingId, status, { contractReference: contract.trim(), commission: c, monthlyFee: f, startsOn: starts || null, endsOn: ends || null, plan });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onChanged();
  }

  return (
    <div className="eco-card">
      <div className="eco-row eco-row--between">
        <div className="eco-row">
          <strong>{name}</strong>
          <span className={p.status === 'active' ? 'eco-pill eco-pill--good' : p.status === 'applied' ? 'eco-pill eco-pill--accent' : 'eco-pill eco-pill--muted'}>{PARTNER_STATUS[p.status]}</span>
          <span className="eco-pill">{p.plan === 'premium' ? '프리미엄' : '기본'} 신청</span>
        </div>
        <span className="eco-meta--faint">신청 {fmtDate(p.appliedAt)}</span>
      </div>
      {p.applicantNote && <p className="gadm-body">{p.applicantNote}</p>}
      {p.decidedAt && <p className="eco-meta">마지막 결정 {fmtDateTime(p.decidedAt)}</p>}
      <div className="eco-form" style={{ marginTop: 8 }}>
        <div className="eco-form-grid">
          <label>
            계약 번호
            <input value={contract} onChange={(e) => setContract(e.target.value)} placeholder="서명된 계약서 번호" />
          </label>
          <label>
            요금제
            <select value={plan} onChange={(e) => setPlan(e.target.value as Partnership['plan'])}>
              <option value="basic">기본</option>
              <option value="premium">프리미엄</option>
            </select>
          </label>
          <label>
            수수료 (%)
            <input type="number" inputMode="decimal" min={0} max={100} step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} />
          </label>
          <label>
            월 이용료 (원)
            <input type="number" inputMode="numeric" min={0} step={1000} value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          <label>
            시작일
            <input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </label>
          <label>
            종료일 (선택)
            <input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="gadm-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('active')}>
          {p.status === 'active' ? '계약 조건 저장' : '활성화'}
        </button>
        {p.status === 'applied' && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide('rejected')}>
            거절
          </button>
        )}
        {p.status === 'active' && (
          <button type="button" className="btn btn-ghost btn-sm gadm-btn-danger" disabled={busy} onClick={() => window.confirm('제휴를 종료할까요? 진행 중인 할인도 더 이상 발급되지 않습니다.') && void decide('ended')}>
            제휴 종료
          </button>
        )}
      </div>
      {error && <p className="gadm-error">{error}</p>}
    </div>
  );
}

function PartnershipsTab() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [p, l] = await Promise.all([adminListPartnerships(), adminListListings('all')]);
    if (!p.ok) return p;
    const names = new Map(l.ok ? l.data.map((x) => [x.id, x.name]) : []);
    return { ok: true as const, data: { items: p.data, names } };
  }, []);
  const [filter, setFilter] = useState<Partnership['status'] | 'all'>('applied');
  const items = useMemo(() => (data ? (filter === 'all' ? data.items : data.items.filter((x) => x.status === filter)) : []), [data, filter]);
  return (
    <div>
      <div className="eco-notice">
        제휴 활성화는 체육관과 서명한 계약이 확인된 경우에만 하세요. 계약 번호와 시작일이 없으면 서버가 활성화를 거부하며, 체육관 등록이 승인된 상태여야 합니다. 활성 제휴인 체육관만 할인 쿠폰을 발급할 수 있습니다.
      </div>
      <div className="eco-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="상태">
          <option value="applied">신청</option>
          <option value="active">활성</option>
          <option value="all">전체</option>
          <option value="rejected">거절</option>
          <option value="ended">종료</option>
        </select>
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState text={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon="📋" text="해당 상태의 제휴가 없습니다." />
      ) : (
        <div className="eco-stack">
          {items.map((p) => (
            <PartnershipItem key={`${p.listingId}:${p.decidedAt ?? ''}:${p.status}`} p={p} name={data?.names.get(p.listingId) ?? '(체육관 정보 없음)'} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- 자격 검증 ----------------

function CredentialItem({ a, onChanged }: { a: CredentialApplication; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    if (!approve && !note.trim()) {
      setError('반려 사유를 적어 주세요. 신청자에게 보입니다.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await reviewCredential(a.id, approve, note.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onChanged();
  }
  return (
    <div className="eco-card">
      <div className="eco-row eco-row--between">
        <strong>
          {CREDENTIAL_ARTS[a.martialArt] ?? a.martialArt} · {CREDENTIAL_TIERS[a.requestedTier] ?? a.requestedTier}
        </strong>
        <span className="eco-meta--faint">{fmtDateTime(a.createdAt)}</span>
      </div>
      <p className="eco-meta">
        신청자: <Link to={`/u/${a.userId}`}>프로필 보기</Link>
      </p>
      <div className="eco-notice eco-notice--accent">
        <strong>제출한 근거</strong>
        <p className="gadm-body">{a.evidence}</p>
      </div>
      <div className="eco-form">
        <label>
          검토 메모 (신청자에게 보입니다)
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="확인한 내용 또는 반려 사유" />
        </label>
      </div>
      <div className="gadm-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(true)}>
          <Icon name="verified" /> 승인
        </button>
        <button type="button" className="btn btn-ghost btn-sm gadm-btn-danger" disabled={busy} onClick={() => decide(false)}>
          반려
        </button>
      </div>
      {error && <p className="gadm-error">{error}</p>}
    </div>
  );
}

function CredentialsTab() {
  const { data, loading, error, reload } = useAsync(adminListPendingCredentials, []);
  return (
    <div>
      <p className="eco-meta">근거를 직접 확인할 수 있는 경우(발급 기관 조회, 소속 체육관 확인, 대회 기록 확인 등)에만 승인하세요. 승인하면 해당 종목의 검증 자격이 기록됩니다.</p>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState text={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState icon="📭" text="검토 대기 중인 자격 신청이 없습니다." />
      ) : (
        <div className="eco-stack">
          {data.map((a) => (
            <CredentialItem key={a.id} a={a} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- 신고 ----------------

interface Report {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string;
  createdAt: string;
}

const TARGET_LABEL: Record<string, string> = {
  user: '사용자',
  post: '게시물',
  comment: '댓글',
  message: '메시지',
  clan: '클랜',
  technique_vote: '기술 평가 투표',
  technique_feedback: '기술 평가 피드백',
  gear_listing: '장비 거래 상품',
  gym_listing: '체육관 등록',
  gym_review: '체육관 후기',
};

async function listOpenReports() {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('user_reports').select('*').is('resolved_at', null).order('created_at', { ascending: false }).limit(200));
  if (!r.ok) return r;
  return {
    ok: true as const,
    data: (r.data ?? []).map((x): Report => ({
      id: x.id as string,
      reporterId: x.reporter_id as string,
      targetType: x.target_type as string,
      targetId: x.target_id as string,
      reason: (x.reason as string) ?? '',
      detail: (x.detail as string) ?? '',
      createdAt: x.created_at as string,
    })),
  };
}

function splitVoteTarget(id: string): [string, string] | null {
  const i = id.lastIndexOf(':');
  if (i <= 0 || i === id.length - 1) return null;
  return [id.slice(0, i), id.slice(i + 1)];
}

function ReportItem({ r, onChanged }: { r: Report; onChanged: () => void }) {
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);

  async function act(label: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setActions((prev) => [...prev, label]);
    setResolution((prev) => (prev ? `${prev} / ${label}` : label));
  }

  async function resolve() {
    setBusy(true);
    setError(null);
    const res = await callRpc<void>('resolve_user_report', { p_id: r.id, p_resolution: resolution.trim() || '확인 완료 · 조치 없음' });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onChanged();
  }

  const vote = r.targetType === 'technique_vote' || r.targetType === 'technique_feedback' ? splitVoteTarget(r.targetId) : null;

  return (
    <div className="eco-card">
      <div className="eco-row eco-row--between">
        <div className="eco-row">
          <span className="eco-pill eco-pill--warn">
            <Icon name="flag" /> {TARGET_LABEL[r.targetType] ?? r.targetType}
          </span>
          <strong>{r.reason}</strong>
        </div>
        <span className="eco-meta--faint">{fmtDateTime(r.createdAt)}</span>
      </div>
      {r.detail && <p className="gadm-body">{r.detail}</p>}
      <p className="eco-meta--faint" style={{ wordBreak: 'break-all' }}>
        대상 ID: {r.targetId}
      </p>

      <div className="gadm-actions">
        {r.targetType === 'gear_listing' && (
          <>
            <Link className="btn btn-ghost btn-sm" to={`/gear/${r.targetId}`}>
              상품 보기
            </Link>
            <button type="button" className="btn btn-secondary btn-sm gadm-btn-danger" disabled={busy} onClick={() => act('상품 숨김', () => callRpc<void>('moderate_gear_listing', { p_listing: r.targetId, p_remove: true }))}>
              상품 숨김
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('상품 숨김 해제', () => callRpc<void>('moderate_gear_listing', { p_listing: r.targetId, p_remove: false }))}>
              숨김 해제
            </button>
          </>
        )}
        {vote && (
          <>
            <Link className="btn btn-ghost btn-sm" to={`/community/post/${vote[0]}`}>
              게시물 보기
            </Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm gadm-btn-danger"
              disabled={busy}
              onClick={() => window.confirm('이 투표를 무효 처리할까요? 평가 점수 계산에서 제외됩니다.') && void act('투표 무효 처리', () => callRpc<void>('invalidate_technique_vote', { p_post: vote[0], p_feedback_id: vote[1], p_reason: r.reason }))}
            >
              투표 무효 처리
            </button>
          </>
        )}
        {(r.targetType === 'technique_vote' || r.targetType === 'technique_feedback') && !vote && <span className="eco-meta">대상 형식을 알 수 없어 자동 조치를 할 수 없습니다.</span>}
        {r.targetType === 'post' && (
          <Link className="btn btn-ghost btn-sm" to={`/community/post/${r.targetId}`}>
            게시물 보기
          </Link>
        )}
        {r.targetType === 'user' && (
          <Link className="btn btn-ghost btn-sm" to={`/u/${r.targetId}`}>
            사용자 프로필
          </Link>
        )}
        {r.targetType === 'gym_listing' && (
          <>
            <Link className="btn btn-ghost btn-sm" to={`/gyms/${r.targetId}`}>
              체육관 보기
            </Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm gadm-btn-danger"
              disabled={busy}
              onClick={() => window.confirm('이 체육관의 게시를 중단할까요?') && void act('체육관 게시 중단', () => reviewListing(r.targetId, 'suspended', `신고 처리: ${r.reason}`))}
            >
              게시 중단
            </button>
          </>
        )}
      </div>
      {actions.length > 0 && <p className="gadm-ok">완료한 조치: {actions.join(', ')}</p>}

      <div className="eco-form" style={{ marginTop: 10 }}>
        <label>
          처리 내용
          <input value={resolution} maxLength={500} onChange={(e) => setResolution(e.target.value)} placeholder="비워 두면 '확인 완료 · 조치 없음'으로 기록됩니다" />
        </label>
      </div>
      <div className="gadm-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={resolve}>
          <Icon name="check" /> 처리 완료
        </button>
      </div>
      {error && <p className="gadm-error">{error}</p>}
    </div>
  );
}

function ReportsTab() {
  const { data, loading, error, reload } = useAsync(listOpenReports, []);
  const [type, setType] = useState('all');
  const items = useMemo(() => (data ? (type === 'all' ? data : data.filter((r) => r.targetType === type)) : []), [data, type]);
  return (
    <div>
      <div className="eco-filters">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="신고 대상">
          <option value="all">전체 대상</option>
          {Object.entries(TARGET_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState text={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon="📭" text="처리 대기 중인 신고가 없습니다." />
      ) : (
        <div className="eco-stack">
          <p className="eco-meta">처리 대기 {items.length}건 · 최신순</p>
          {items.map((r) => (
            <ReportItem key={r.id} r={r} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- 페이지 ----------------

export default function PlatformAdmin() {
  const { user, isConfigured } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'listings';

  useEffect(() => {
    let alive = true;
    setIsAdmin(null);
    void amIPlatformAdmin(user?.id ?? null).then((v) => alive && setIsAdmin(v));
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const head = (
    <div className="eco-page-head">
      <div>
        <div className="eco-kicker">플랫폼 관리</div>
        <h2>
          <Icon name="shield" /> 관리자 콘솔
        </h2>
        <p>체육관 등록·가격 검증, 제휴 계약, 자격 검증, 신고를 처리합니다.</p>
      </div>
      <Link className="btn btn-secondary btn-sm" to="/verification">
        <Icon name="verified" /> 자격 신청 화면
      </Link>
    </div>
  );

  let body: JSX.Element;
  if (!isConfigured) body = <EmptyState icon="🔒" text="관리자 콘솔은 클라우드 설정이 필요합니다." />;
  else if (!user) body = <EmptyState icon="🔒" text="로그인이 필요합니다." />;
  else if (isAdmin === null) body = <LoadingState text="권한을 확인하는 중..." />;
  else if (!isAdmin)
    body = (
      <>
        <EmptyState icon="🔒" text="플랫폼 관리자만 볼 수 있는 화면입니다." />
        <p className="eco-meta" style={{ textAlign: 'center' }}>
          지도자·숙련자 자격을 신청하려면 <Link to="/verification">자격 신청 화면</Link>으로 이동하세요.
        </p>
      </>
    );
  else
    body = (
      <>
        <div className="eco-tabs" role="tablist" aria-label="관리 메뉴">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              className="eco-tab"
              data-testid={`platform-tab-${t.key}`}
              aria-selected={tab === t.key}
              onClick={() => setSearchParams(t.key === 'listings' ? {} : { tab: t.key }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'listings' && <ListingsTab />}
        {tab === 'partnerships' && <PartnershipsTab />}
        {tab === 'credentials' && <CredentialsTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'monetization' && <MonetizationAdmin />}
      </>
    );

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/" />
        {head}
        {body}
      </div>
    </div>
  );
}
