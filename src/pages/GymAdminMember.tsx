// 지도자용 회원 상세 (/gym/admin/:gymId/member/:userId) — 출석 이력, 회원이 동의해 공유한 진도 요약,
// 과제·피드백·AI 분석 검토 의견, 개별 메시지. 원본 기록(영상·세부 기록)은 여기서 볼 수 없다.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { getGym, listGymClasses } from '../lib/gymClass/service';
import type { Gym, GymClass } from '../lib/gymClass/types';
import {
  listAssignments,
  listMembers,
  listProgress,
  listSessionsAndAttendance,
  statusLabel,
  type Assignment,
  type AttendanceRow,
  type GymMemberRow,
  type ProgressSummary,
  type SessionRow,
} from '../lib/gymClass/adminService';
import { MASTERY_ORDER } from '../lib/skillProgress/types';
import { startConversation } from '../lib/social/dmService';
import BackButton from '../components/BackButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingState from '../components/LoadingState';
import Icon from '../components/Icon';
import AssignmentForm from '../components/gymAdmin/AssignmentForm';
import AssignmentList from '../components/gymAdmin/AssignmentList';
import { MetricCard, POSE_METHOD_LABEL, ROLE_LABEL, daysAgo, fmtDate, fmtDateTime } from '../components/gymAdmin/shared';

const HISTORY_DAYS = 180;

interface Data {
  gym: Gym;
  member: GymMemberRow | null;
  members: GymMemberRow[];
  sessions: SessionRow[];
  attendance: AttendanceRow[];
  classes: GymClass[];
  progress: { summary: ProgressSummary; updatedAt: string } | null;
  assignments: Assignment[];
}

export default function GymAdminMember() {
  const { gymId = '', userId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dmBusy, setDmBusy] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [g, m, sa, c, p, a] = await Promise.all([
      getGym(gymId),
      listMembers(gymId),
      listSessionsAndAttendance(gymId, daysAgo(HISTORY_DAYS)),
      listGymClasses(gymId),
      listProgress(gymId),
      listAssignments(gymId, userId),
    ]);
    if (!g.ok || !m.ok || !sa.ok || !c.ok || !p.ok || !a.ok) {
      const failed = [g, m, sa, c, p, a].find((r) => !r.ok) as { message: string } | undefined;
      setError(failed?.message ?? '불러오지 못했습니다.');
      setLoading(false);
      return;
    }
    if (!g.data) {
      setError('체육관을 찾을 수 없습니다.');
      setLoading(false);
      return;
    }
    setData({
      gym: g.data,
      member: m.data.find((x) => x.userId === userId) ?? null,
      members: m.data,
      sessions: sa.data.sessions,
      attendance: sa.data.attendance.filter((x) => x.studentUserId === userId),
      classes: c.data,
      progress: p.data.get(userId) ?? null,
      assignments: a.data,
    });
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, userId]);

  async function openDm() {
    setDmBusy(true);
    setDmError(null);
    const r = await startConversation(userId);
    setDmBusy(false);
    if (!r.ok) {
      setDmError(r.message);
      return;
    }
    navigate(`/messages/${r.data}`);
  }

  const history = useMemo(() => {
    if (!data?.member) return [];
    const joined = data.member.joinedAt.slice(0, 10);
    const byId = new Map(data.attendance.map((a) => [a.sessionId, a]));
    const title = new Map(data.classes.map((c) => [c.id, c.title]));
    return data.sessions
      .filter((s) => s.date >= joined || byId.has(s.id))
      .map((s) => ({ session: s, classTitle: title.get(s.gymClassId) ?? '수업', att: byId.get(s.id) ?? null }))
      .sort((a, b) => b.session.date.localeCompare(a.session.date));
  }, [data]);

  const wrap = (child: JSX.Element) => (
    <div className="page">
      <div className="container">
        <BackButton fallback={`/gym/admin/${gymId}?tab=members`} />
        {child}
      </div>
    </div>
  );

  if (!user) return wrap(<EmptyState icon="🔒" text="로그인이 필요합니다." />);
  if (loading && !data) return wrap(<LoadingState />);
  if (error) return wrap(<ErrorState text={error} onRetry={load} />);
  if (!data) return wrap(<LoadingState />);
  if (!data.member) {
    return wrap(
      <>
        <EmptyState icon="🔍" text="이 체육관의 회원이 아닙니다. 탈퇴했거나 내보낸 회원일 수 있습니다." />
        {data.assignments.length > 0 && <AssignmentList items={data.assignments} gymId={gymId} onChanged={load} />}
      </>,
    );
  }

  const { gym, member, progress } = data;
  const attended = history.filter((h) => h.att).length;
  const completed = history.filter((h) => h.att?.completed).length;
  const eligible = history.filter((h) => h.session.date >= member.joinedAt.slice(0, 10)).length;
  const s = progress?.summary;
  const weeklyMax = s ? Math.max(1, ...s.training.weekly) : 1;

  return wrap(
    <>
      <div className="breadcrumb">
        <Link to="/gym/admin">체육관 관리</Link>
        <span>/</span>
        <Link to={`/gym/admin/${gym.id}?tab=members`}>{gym.name}</Link>
        <span>/</span>
        <span>{member.nickname}</span>
      </div>

      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">회원 상세</div>
          <h2>
            <Icon name="user" /> {member.nickname}
          </h2>
          <p>
            <span className={member.role === 'instructor' ? 'eco-pill eco-pill--accent' : 'eco-pill'}>{ROLE_LABEL[member.role]}</span> · 가입 {fmtDate(member.joinedAt)}
            {member.userId === gym.ownerUserId && ' · 체육관 관리자'}
          </p>
        </div>
        {member.userId !== user.id && (
          <div className="eco-row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={dmBusy} onClick={openDm}>
              <Icon name="message" /> 개별 메시지
            </button>
          </div>
        )}
      </div>
      {dmError && <p className="gadm-error">{dmError}</p>}

      <div className="eco-section">
        <h3>
          <Icon name="calendar" /> 출석 이력
        </h3>
        <span className="eco-meta--faint">최근 {HISTORY_DAYS}일</span>
      </div>
      <div className="eco-metrics">
        <MetricCard label="출석률" value={eligible ? `${Math.round((attended / eligible) * 100)}%` : null} sub={`가입 이후 열린 수업 ${eligible}회 중 ${attended}회`} why="가입 이후 열린 수업이 없습니다." />
        <MetricCard label="완료한 수업" value={attended ? completed : null} sub={`출석 ${attended}회 중`} why="출석 기록이 없습니다." />
      </div>
      {history.length === 0 ? (
        <p className="eco-meta">최근 {HISTORY_DAYS}일 동안 이 회원이 가입한 뒤 열린 수업이 없습니다.</p>
      ) : (
        <div className="eco-table-wrap">
          <table className="eco-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>수업</th>
                <th>출석</th>
                <th>완료</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.session.id}>
                  <td>{fmtDate(h.session.date)}</td>
                  <td>{h.classTitle}</td>
                  <td>{h.att ? <span className="eco-pill eco-pill--good">출석</span> : <span className="eco-pill eco-pill--muted">기록 없음</span>}</td>
                  <td>{h.att ? (h.att.completed ? `완료${h.att.completedAt ? ` · ${fmtDateTime(h.att.completedAt)}` : ''}` : '미완료') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="eco-section">
        <h3>
          <Icon name="trend" /> 공유된 진도
        </h3>
        {progress && <span className="eco-meta--faint">공유 시점 {fmtDateTime(s?.generatedAt ?? progress.updatedAt)}</span>}
      </div>
      {!s ? (
        <div className="eco-notice">
          이 회원은 체육관에 진도를 공유하지 않았습니다. 학습·자세 분석·훈련 기록은 회원 기기에만 있으며, 회원이 체육관 화면(내 체육관)에서 <strong>진도 공유</strong>를 켜야 요약을 볼 수 있습니다. 출석 기록과 과제는 공유 여부와 관계없이 볼 수 있습니다.
        </div>
      ) : (
        <>
          <div className="eco-metrics">
            <MetricCard label="학습한 기술" value={s.learned} sub="한 번이라도 연습·분석한 기술" />
            {MASTERY_ORDER.filter((k) => k !== 'not_started').map((k) => (
              <MetricCard key={k} label={statusLabel(k)} value={s.counts[k] ?? 0} />
            ))}
            <MetricCard label="최근 30일 훈련" value={`${s.training.sessions30}회`} sub={`${s.training.minutes30}분 · 마지막 ${s.training.lastSessionAt ? fmtDate(s.training.lastSessionAt) : '기록 없음'}`} />
          </div>

          <h4 className="eco-meta">주별 훈련 횟수 (최근 8주)</h4>
          {s.training.weekly.every((n) => n === 0) ? (
            <p className="eco-meta">데이터 없음 — 최근 8주 동안 완료한 훈련 기록이 없습니다.</p>
          ) : (
            <div className="eco-bars gadm-bars">
              {s.training.weekly.map((n, i) => (
                <div key={i} className="eco-bar">
                  <span className="eco-bar__label">{i === s.training.weekly.length - 1 ? '이번 주' : `${s.training.weekly.length - 1 - i}주 전`}</span>
                  <span className="eco-bar__track">
                    <span className="eco-bar__fill eco-bar__fill--alt" style={{ width: `${(n / weeklyMax) * 100}%` }} />
                  </span>
                  <span className="eco-bar__value">{n}회</span>
                </div>
              ))}
            </div>
          )}

          <div className="eco-section">
            <h3>기술별 상태</h3>
            <span className="eco-meta--faint">{s.techniques.length}개</span>
          </div>
          {s.techniques.length === 0 ? (
            <p className="eco-meta">공유된 기술 학습 기록이 없습니다.</p>
          ) : (
            <div className="eco-table-wrap">
              <table className="eco-table">
                <thead>
                  <tr>
                    <th>기술</th>
                    <th>상태</th>
                    <th>최근 점수</th>
                    <th>마지막 연습</th>
                  </tr>
                </thead>
                <tbody>
                  {s.techniques.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>
                        <span className={t.status === 'proficient' ? 'eco-pill eco-pill--good' : t.status === 'needs_improvement' ? 'eco-pill eco-pill--warn' : 'eco-pill'}>{statusLabel(t.status)}</span>
                      </td>
                      <td className={t.latestScore === null ? 'eco-missing' : 'gadm-score'}>{t.latestScore === null ? '데이터 없음' : t.latestScore}</td>
                      <td>{fmtDate(t.lastPracticedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="eco-section">
            <h3>AI 자세 분석 점수</h3>
            <span className="eco-meta--faint">처음 → 최근</span>
          </div>
          <div className="eco-notice">점수는 앱의 자동 자세 분석 점수이며 기술 숙련도 인증이나 공식 평가가 아닙니다. 촬영 환경에 따라 달라질 수 있으니 지도자의 직접 확인과 함께 참고하세요.</div>
          {s.pose.length === 0 ? (
            <p className="eco-meta">공유된 자세 분석 기록이 없습니다.</p>
          ) : (
            <div className="eco-table-wrap">
              <table className="eco-table">
                <thead>
                  <tr>
                    <th>기술</th>
                    <th>분석 방식</th>
                    <th>점수 변화</th>
                    <th>측정</th>
                  </tr>
                </thead>
                <tbody>
                  {s.pose.map((p) => {
                    const diff = p.latest - p.first;
                    return (
                      <tr key={`${p.techniqueId}::${p.method}`}>
                        <td>{p.name}</td>
                        <td>{POSE_METHOD_LABEL[p.method] ?? p.method}</td>
                        <td className="gadm-score">
                          {p.first} → {p.latest}
                          {p.count > 1 && <span className="eco-meta--faint"> ({diff > 0 ? `+${diff}` : diff})</span>}
                        </td>
                        <td>
                          {p.count}회 · 최근 {fmtDate(p.latestAt)}
                          {p.lowReliability > 0 && <div className="eco-meta--faint gadm-danger">측정 신뢰도 낮음 {p.lowReliability}회</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="eco-section">
        <h3>
          <Icon name="check-square" /> 과제·피드백
        </h3>
        <span className="eco-meta--faint">{data.assignments.length}건</span>
      </div>
      <AssignmentForm gymId={gym.id} authorId={user.id} members={data.members} fixedMemberId={member.userId} poseItems={s?.pose} onCreated={load} />
      <div style={{ marginTop: 12 }}>
        <AssignmentList items={data.assignments} gymId={gym.id} onChanged={load} emptyText="이 회원에게 보낸 과제·피드백이 없습니다." />
      </div>
    </>,
  );
}
