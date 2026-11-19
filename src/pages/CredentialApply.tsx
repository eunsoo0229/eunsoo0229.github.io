// /verification — 지도자·숙련자 자격 신청 (로그인한 누구나). 플랫폼 관리자가 근거를 확인해 승인하면
// verified_credentials 에 기록된다(0055). 자기 신고 정보는 검증 배지로 쓰이지 않는다.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import {
  CREDENTIAL_ARTS,
  CREDENTIAL_TIERS,
  CRED_STATUS_LABEL,
  applyCredential,
  listMyCredentialApplications,
  type CredentialApplication,
  type CredentialTier,
} from '../lib/ecosystem/credentials';
import BackButton from '../components/BackButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingState from '../components/LoadingState';
import Icon from '../components/Icon';
import { fmtDateTime } from '../components/gymAdmin/shared';

export default function CredentialApply() {
  const { user, isConfigured } = useAuth();
  const [items, setItems] = useState<CredentialApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [art, setArt] = useState('*');
  const [tier, setTier] = useState<CredentialTier>('intermediate');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    const r = await listMyCredentialApplications(user.id);
    if (r.ok) setItems(r.data);
    else setLoadError(r.message);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const trimmed = evidence.trim();
  const hasPending = items.some((x) => x.status === 'pending' && x.martialArt === art);

  async function submit() {
    if (!user) return;
    if (trimmed.length < 10) {
      setError('근거를 10자 이상 적어 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    const r = await applyCredential(user.id, art, tier, trimmed);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setEvidence('');
    setDone(true);
    void load();
  }

  const shell = (child: JSX.Element) => (
    <div className="page">
      <div className="container">
        <BackButton fallback="/profile" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">자격 검증</div>
            <h2>
              <Icon name="verified" /> 지도자·숙련자 자격 신청
            </h2>
            <p>단증·지도자 자격·대회 경력 등 근거를 제출하면 플랫폼 관리자가 확인해 검증 배지를 부여합니다. 검증된 자격은 기술 평가 등에서 평가자 그룹을 나누는 데 쓰입니다.</p>
          </div>
        </div>
        {child}
      </div>
    </div>
  );

  if (!isConfigured) return shell(<EmptyState icon="🔒" text="자격 신청은 로그인/클라우드 설정이 필요합니다." />);
  if (!user)
    return shell(
      <>
        <EmptyState icon="🔒" text="자격을 신청하려면 로그인이 필요합니다." />
        <div className="eco-row">
          <Link className="btn btn-primary" to="/login">
            로그인
          </Link>
        </div>
      </>,
    );

  return shell(
    <>
      <div className="eco-card">
        <h3>새 신청</h3>
        <div className="eco-notice">
          프로필에 적은 수련 기간 같은 자기 신고 정보만으로는 검증되지 않습니다. 관리자가 확인할 수 있는 근거(소속 체육관과 관장 이름, 단·띠 등급과 발급 기관, 자격증 번호, 대회 기록 링크 등)를 구체적으로 적어 주세요. 근거는 본인과 플랫폼 관리자만 볼 수 있습니다.
        </div>
        <div className="eco-form">
          <div className="eco-form-grid">
            <label>
              종목
              <select value={art} onChange={(e) => setArt(e.target.value)}>
                {Object.entries(CREDENTIAL_ARTS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              신청 등급
              <select value={tier} onChange={(e) => setTier(e.target.value as CredentialTier)}>
                {(Object.keys(CREDENTIAL_TIERS) as CredentialTier[]).map((t) => (
                  <option key={t} value={t}>
                    {CREDENTIAL_TIERS[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            근거 ({trimmed.length}/2000자, 10자 이상)
            <textarea value={evidence} maxLength={2000} onChange={(e) => setEvidence(e.target.value)} placeholder="예: OO주짓수 소속, 브라운벨트(2023년 OOO 관장에게 수여), 2024 OO오픈 어덜트 브라운 동메달 — 결과 링크" />
          </label>
          {hasPending && <p className="eco-meta">이 종목으로 검토 대기 중인 신청이 이미 있습니다. 새로 신청하면 따로 검토됩니다.</p>}
          <div className="eco-row">
            <button type="button" className="btn btn-primary" data-testid="cred-apply-submit" disabled={busy || trimmed.length < 10} onClick={submit}>
              {busy ? '제출 중...' : '신청하기'}
            </button>
          </div>
          {error && <p className="gadm-error">{error}</p>}
          {done && <p className="gadm-ok">신청했습니다. 관리자 검토 후 결과가 아래 목록에 표시됩니다.</p>}
        </div>
      </div>

      <div className="eco-section">
        <h3>내 신청 내역</h3>
      </div>
      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState text={loadError} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState icon="📋" text="아직 신청한 자격이 없습니다." />
      ) : (
        <div className="eco-stack">
          {items.map((a) => (
            <div key={a.id} className="eco-card">
              <div className="eco-row eco-row--between">
                <div className="eco-row">
                  <strong>
                    {CREDENTIAL_ARTS[a.martialArt] ?? a.martialArt} · {CREDENTIAL_TIERS[a.requestedTier] ?? a.requestedTier}
                  </strong>
                  <span className={a.status === 'approved' ? 'eco-pill eco-pill--good' : a.status === 'rejected' ? 'eco-pill eco-pill--warn' : 'eco-pill eco-pill--accent'}>{CRED_STATUS_LABEL[a.status]}</span>
                </div>
                <span className="eco-meta--faint">{fmtDateTime(a.createdAt)}</span>
              </div>
              <p className="gadm-body">{a.evidence}</p>
              {a.status !== 'pending' && (
                <p className="eco-meta">
                  검토 {fmtDateTime(a.reviewedAt)}
                  {a.reviewNote ? ` · ${a.reviewNote}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>,
  );
}
