// 회원 관리 — 검색, 역할·출석률·마지막 활동·공유 여부·진행 중 과제, 역할 변경(관리자) · 내보내기.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { INACTIVE_DAYS, removeMember, setMemberRole, type DashboardStats } from '../../lib/gymClass/adminService';
import EmptyState from '../EmptyState';
import Icon from '../Icon';
import { ROLE_LABEL, fmtDate } from './shared';

export default function GymMembersTab({
  gymId,
  stats,
  ownerUserId,
  myUserId,
  onChanged,
}: {
  gymId: string;
  stats: DashboardStats;
  ownerUserId: string;
  myUserId: string;
  onChanged: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = ownerUserId === myUserId;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return stats.members
      .filter((m) => !s || m.nickname.toLowerCase().includes(s))
      .sort((a, b) => (a.role === b.role ? a.nickname.localeCompare(b.nickname, 'ko') : a.role === 'instructor' ? -1 : 1));
  }, [stats.members, q]);

  async function act(userId: string, fn: () => Promise<{ ok: boolean }>, failMsg: string) {
    setBusy(userId);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) {
      setError((r as { message?: string }).message ?? failMsg);
      return;
    }
    onChanged();
  }

  return (
    <div>
      <div className="eco-filters">
        <label className="gadm-search">
          <Icon name="search" />
          <input type="search" placeholder="닉네임 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회원 닉네임 검색" />
        </label>
      </div>
      <p className="eco-meta">
        회원 {stats.members.length}명{q.trim() ? ` 중 ${rows.length}명 표시` : ''}. 출석률은 최근 56일, 가입 이후 열린 수업 기준입니다. {isOwner ? '' : '역할 변경은 체육관 관리자만 할 수 있습니다.'}
      </p>
      {error && <p className="gadm-error">{error}</p>}
      {rows.length === 0 ? (
        <EmptyState icon="🔍" text={q.trim() ? '검색 결과가 없습니다.' : '아직 회원이 없습니다.'} />
      ) : (
        <div className="eco-table-wrap">
          <table className="eco-table">
            <thead>
              <tr>
                <th>회원</th>
                <th>역할</th>
                <th>출석률</th>
                <th>마지막 활동</th>
                <th>진도 공유</th>
                <th>진행 중 과제</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isGymOwner = m.userId === ownerUserId;
                const isMe = m.userId === myUserId;
                const canRemove = !isGymOwner && !isMe && (isOwner || m.role === 'student');
                const canRole = isOwner && !isGymOwner;
                return (
                  <tr key={m.userId} data-testid="gym-member-row">
                    <td>
                      <Link className="gadm-cell-strong" to={`/gym/admin/${gymId}/member/${m.userId}`}>
                        {m.nickname}
                      </Link>
                      {isGymOwner && <div className="eco-meta--faint">관리자</div>}
                      {isMe && !isGymOwner && <div className="eco-meta--faint">나</div>}
                    </td>
                    <td>
                      <span className={m.role === 'instructor' ? 'eco-pill eco-pill--accent' : 'eco-pill'}>{ROLE_LABEL[m.role]}</span>
                    </td>
                    <td>{m.role === 'instructor' ? <span className="eco-meta--faint">해당 없음</span> : m.attendanceRate === null ? <span className="eco-meta--faint">데이터 없음</span> : `${m.attendanceRate}% (${m.attended}회)`}</td>
                    <td>
                      {m.lastActivityAt ? fmtDate(m.lastActivityAt) : <span className="eco-meta--faint">기록 없음</span>}
                      {m.inactiveDays !== null && (
                        <div className={m.inactiveDays >= INACTIVE_DAYS ? 'eco-meta--faint gadm-danger' : 'eco-meta--faint'}>{m.inactiveDays === 0 ? '오늘' : `${m.inactiveDays}일 전`}</div>
                      )}
                    </td>
                    <td>{m.shared ? <span className="eco-pill eco-pill--good">공유 중</span> : <span className="eco-pill eco-pill--muted">미공유</span>}</td>
                    <td>{m.openAssignments}</td>
                    <td>
                      <div className="gadm-table-actions">
                        {canRole && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy === m.userId}
                            onClick={() => {
                              const next = m.role === 'instructor' ? 'student' : 'instructor';
                              if (window.confirm(`${m.nickname} 님을 ${ROLE_LABEL[next]}(으)로 바꿀까요?`)) void act(m.userId, () => setMemberRole(gymId, m.userId, next), '역할을 바꾸지 못했습니다.');
                            }}
                          >
                            {m.role === 'instructor' ? '학생으로' : '지도자로'}
                          </button>
                        )}
                        {canRemove && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm gadm-btn-danger"
                            disabled={busy === m.userId}
                            onClick={() => {
                              if (window.confirm(`${m.nickname} 님을 체육관에서 내보낼까요? 공유된 진도 요약도 함께 삭제됩니다.`)) void act(m.userId, () => removeMember(gymId, m.userId), '내보내지 못했습니다.');
                            }}
                          >
                            내보내기
                          </button>
                        )}
                        {!canRole && !canRemove && <span className="eco-meta--faint">—</span>}
                      </div>
                    </td>
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
