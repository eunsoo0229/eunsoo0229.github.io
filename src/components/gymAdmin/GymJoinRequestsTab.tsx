// 가입 신청 — 승인제 켜기/끄기(관리자) · 대기 중 신청 승인/거절(지도자).
import { useEffect, useState } from 'react';
import { decideJoin, getJoinApproval, listJoinRequests, setJoinApproval, type JoinRequest } from '../../lib/gymClass/adminService';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import LoadingState from '../LoadingState';
import Icon from '../Icon';
import { fmtDateTime } from './shared';

export default function GymJoinRequestsTab({ gymId, isOwner, onDecided }: { gymId: string; isOwner: boolean; onDecided: () => void }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [approval, setApproval] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const [r, a] = await Promise.all([listJoinRequests(gymId), getJoinApproval(gymId)]);
    if (r.ok) setRequests(r.data);
    else setLoadError(r.message);
    setApproval(a);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  async function toggle() {
    if (approval === null) return;
    setBusy('approval');
    setError(null);
    const r = await setJoinApproval(gymId, !approval);
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setApproval(!approval);
  }

  async function decide(req: JoinRequest, approve: boolean) {
    setBusy(req.userId);
    setError(null);
    const r = await decideJoin(gymId, req.userId, approve);
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setRequests((prev) => prev.filter((x) => x.userId !== req.userId));
    if (approve) onDecided();
  }

  if (loading) return <LoadingState />;
  if (loadError) return <ErrorState text={loadError} onRetry={load} />;

  return (
    <div>
      <div className="eco-card">
        <div className="gadm-toggle">
          <div>
            <h3>
              <Icon name="lock" /> 가입 승인제
            </h3>
            <p className="eco-meta">
              {approval === null
                ? '현재 설정을 불러오지 못했습니다.'
                : approval
                  ? '켜짐 — 가입 코드를 입력한 사람은 신청 상태로 대기하고, 지도자가 승인해야 참가됩니다.'
                  : '꺼짐 — 가입 코드를 아는 사람은 바로 학생으로 참가합니다.'}
            </p>
            {!isOwner && <p className="eco-meta--faint">승인제 설정은 체육관 관리자만 바꿀 수 있습니다. 신청 승인·거절은 지도자도 할 수 있습니다.</p>}
          </div>
          {isOwner && approval !== null && (
            <button type="button" className={approval ? 'btn btn-secondary' : 'btn btn-primary'} disabled={busy === 'approval'} onClick={toggle}>
              {approval ? '승인제 끄기' : '승인제 켜기'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="gadm-error">{error}</p>}

      <div className="eco-section">
        <h3>
          <Icon name="user-plus" /> 대기 중인 신청 {requests.length}건
        </h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          새로고침
        </button>
      </div>
      {requests.length === 0 ? (
        <EmptyState icon="📭" text="대기 중인 가입 신청이 없습니다." />
      ) : (
        <div className="eco-stack">
          {requests.map((req) => (
            <div key={req.userId} className="eco-card">
              <div className="eco-row eco-row--between">
                <strong>{req.nickname}</strong>
                <span className="eco-meta--faint">{fmtDateTime(req.createdAt)}</span>
              </div>
              {req.message ? <p className="gadm-body">{req.message}</p> : <p className="eco-meta">남긴 메시지 없음</p>}
              <div className="gadm-actions">
                <button type="button" className="btn btn-primary btn-sm" data-testid="gym-join-approve" disabled={busy === req.userId} onClick={() => decide(req, true)}>
                  <Icon name="check" /> 승인
                </button>
                <button type="button" className="btn btn-ghost btn-sm gadm-btn-danger" disabled={busy === req.userId} onClick={() => decide(req, false)}>
                  <Icon name="close" /> 거절
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
