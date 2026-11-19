// 학생용 체육관 패널 — 공지, 나에게 온 과제(완료·메모), 진도 공유(명시적 동의).
import { useEffect, useState } from 'react';
import {
  ASSIGNMENT_KIND_LABEL,
  getMyShare,
  listAnnouncements,
  listMyAssignments,
  shareProgress,
  stopSharing,
  updateAssignment,
  type Announcement,
  type Assignment,
} from '../../lib/gymClass/adminService';
import { getTechnique } from '../../lib/loadData';
import Icon from '../Icon';
import { STATUS_LABEL, fmtDate, fmtDateTime, statusPillClass } from './shared';

function MyAssignment({ a, onChanged }: { a: Assignment; onChanged: (next: Assignment) => void }) {
  const [note, setNote] = useState(a.memberNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const tech = a.techniqueId ? getTechnique(a.techniqueId)?.name ?? null : null;

  async function patch(p: { status?: Assignment['status']; memberNote?: string }) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await updateAssignment(a.id, p);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    if (p.memberNote !== undefined) setSaved(true);
    onChanged({ ...a, ...p });
  }

  return (
    <div className={a.status === 'done' ? 'eco-item eco-item--done' : 'eco-item'}>
      <Icon name={a.status === 'done' ? 'check-square' : 'square'} />
      <div style={{ minWidth: 0 }}>
        <div className="eco-item__title">{a.title}</div>
        <div className="eco-row" style={{ marginTop: 2 }}>
          <span className="eco-pill">{ASSIGNMENT_KIND_LABEL[a.kind]}</span>
          <span className={statusPillClass(a.status)}>{STATUS_LABEL[a.status]}</span>
          {tech && <span className="eco-pill eco-pill--muted">{tech}</span>}
          {a.dueDate && <span className="eco-meta--faint">마감 {fmtDate(a.dueDate)}</span>}
        </div>
        {a.body && <p className="gadm-body">{a.body}</p>}
        <div className="eco-form" style={{ marginTop: 8 }}>
          <label>
            내 메모 (지도자에게 보입니다)
            <textarea value={note} maxLength={1000} style={{ minHeight: 60 }} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="eco-row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || note === a.memberNote} onClick={() => patch({ memberNote: note.trim() })}>
              메모 저장
            </button>
            {saved && <span className="gadm-ok">저장했습니다.</span>}
          </div>
        </div>
        {error && <p className="gadm-error">{error}</p>}
      </div>
      <div>
        {a.status === 'open' ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => patch({ status: 'done' })}>
            <Icon name="check" /> 완료
          </button>
        ) : a.status === 'done' ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => patch({ status: 'open' })}>
            완료 취소
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function GymMemberPanel({ gymId, gymName, userId }: { gymId: string; gymName: string; userId: string }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [share, setShare] = useState<{ updatedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [showDone, setShowDone] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const [an, as, sh] = await Promise.all([listAnnouncements(gymId), listMyAssignments(userId), getMyShare(gymId, userId)]);
    if (an.ok) setAnnouncements(an.data);
    if (as.ok) setAssignments(as.data.filter((a) => a.gymId === gymId));
    if (!an.ok || !as.ok) setLoadError((!an.ok ? an.message : !as.ok ? as.message : '') || '불러오지 못했습니다.');
    setShare(sh);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, userId]);

  async function doShare() {
    setBusy(true);
    setShareError(null);
    const r = await shareProgress(gymId, userId);
    if (!r.ok) {
      setBusy(false);
      setShareError(r.message);
      return;
    }
    setShare(await getMyShare(gymId, userId) ?? { updatedAt: new Date().toISOString() });
    setBusy(false);
  }

  async function doStop() {
    if (!window.confirm(`${gymName}에 공유한 진도 요약을 삭제하고 공유를 중지할까요?`)) return;
    setBusy(true);
    setShareError(null);
    const r = await stopSharing(gymId, userId);
    setBusy(false);
    if (!r.ok) {
      setShareError(r.message);
      return;
    }
    setShare(null);
    setConsent(false);
  }

  const open = assignments.filter((a) => a.status === 'open');
  const closed = assignments.filter((a) => a.status !== 'open');

  if (loading) return <p className="eco-meta">불러오는 중...</p>;

  return (
    <div className="eco-stack gadm-section-card">
      {loadError && (
        <p className="gadm-error">
          {loadError}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
            다시 시도
          </button>
        </p>
      )}

      <div>
        <h4 className="eco-row" style={{ margin: '0 0 6px' }}>
          <Icon name="bell" /> 공지
        </h4>
        {announcements.length === 0 ? (
          <p className="eco-meta">공지가 없습니다.</p>
        ) : (
          <div className="eco-stack">
            {announcements.slice(0, 5).map((a) => (
              <div key={a.id}>
                <div className="eco-row">
                  {a.pinned && <span className="eco-pill eco-pill--accent">고정</span>}
                  <strong>{a.title}</strong>
                  <span className="eco-meta--faint">{fmtDate(a.createdAt)}</span>
                </div>
                {a.body && <p className="gadm-body">{a.body}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="eco-row" style={{ margin: '0 0 6px' }}>
          <Icon name="check-square" /> 나에게 온 과제·피드백 {open.length > 0 && <span className="eco-pill eco-pill--accent">진행 중 {open.length}</span>}
        </h4>
        {assignments.length === 0 ? (
          <p className="eco-meta">받은 과제·피드백이 없습니다.</p>
        ) : (
          <>
            {open.length === 0 && <p className="eco-meta">진행 중인 과제가 없습니다.</p>}
            {open.map((a) => (
              <MyAssignment key={a.id} a={a} onChanged={(n) => setAssignments((prev) => prev.map((x) => (x.id === n.id ? n : x)))} />
            ))}
            {closed.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDone((v) => !v)}>
                {showDone ? '완료·종료된 항목 숨기기' : `완료·종료된 항목 ${closed.length}개 보기`}
              </button>
            )}
            {showDone &&
              closed.map((a) => <MyAssignment key={a.id} a={a} onChanged={(n) => setAssignments((prev) => prev.map((x) => (x.id === n.id ? n : x)))} />)}
          </>
        )}
      </div>

      <div className="eco-card">
        <div className="gadm-toggle">
          <h4 className="eco-row" style={{ margin: 0 }}>
            <Icon name="shield" /> 진도 공유
          </h4>
          {share ? <span className="eco-pill eco-pill--good">공유 중</span> : <span className="eco-pill eco-pill--muted">공유 안 함</span>}
        </div>
        <div className="gadm-consent">
          <p className="eco-meta" style={{ margin: '6px 0 0' }}>
            {gymName}의 관장님·지도자에게 내 기기에서 계산한 진도 요약을 보냅니다. 공유는 버튼을 누를 때만 그 시점의 요약으로 갱신되며, 자동으로 보내지지 않습니다.
          </p>
          <h4>공유되는 정보</h4>
          <ul>
            <li>기술 학습 상태별 개수 (학습 중·보통·숙련·개선 필요)</li>
            <li>기술별 학습 상태와 최근 점수 (최대 80개)</li>
            <li>AI 자세 분석 점수: 기술별 처음 점수와 최근 점수, 측정 횟수, 분석 방식, 신뢰도 낮은 측정 횟수</li>
            <li>최근 30일 훈련 횟수·시간, 최근 8주 주별 훈련 횟수, 마지막 훈련 시각</li>
          </ul>
          <h4>공유되지 않는 정보</h4>
          <ul>
            <li>촬영한 영상과 사진</li>
            <li>자세 분석·훈련의 원본 기록과 세부 내용</li>
            <li>식단·영양 기록</li>
            <li>AI 코치 대화와 메시지</li>
          </ul>
          <p className="eco-meta--faint">공유를 중지하면 체육관에 저장된 요약이 바로 삭제됩니다. 체육관을 나가도 함께 삭제됩니다.</p>
        </div>
        {share && <p className="eco-meta">마지막 공유: {fmtDateTime(share.updatedAt)}</p>}
        {!share && (
          <div className="eco-form" style={{ marginTop: 8 }}>
            <label className="eco-check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> 위 정보를 {gymName}에 공유하는 데 동의합니다.
            </label>
          </div>
        )}
        <div className="gadm-actions">
          {share ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" data-testid="gym-share-on" disabled={busy} onClick={doShare}>
                <Icon name="refresh" /> 지금 상태로 업데이트
              </button>
              <button type="button" className="btn btn-ghost btn-sm gadm-btn-danger" data-testid="gym-share-off" disabled={busy} onClick={doStop}>
                공유 중지
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" data-testid="gym-share-on" disabled={busy || !consent} onClick={doShare}>
              공유하기
            </button>
          )}
        </div>
        {shareError && <p className="gadm-error">{shareError}</p>}
      </div>
    </div>
  );
}
