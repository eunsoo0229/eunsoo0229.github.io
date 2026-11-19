import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { createGymClass, getGym, listGymClasses, openTodaySession } from '../lib/gymClass/service';
import type { Gym, GymClass } from '../lib/gymClass/types';
import { searchTechniques } from '../lib/search';
import { getDefaultExerciseConfig } from '../lib/todayTraining/exerciseDefaults';
import type { ExerciseConfig } from '../lib/curriculum/types';
import type { Technique } from '../types';
import BackButton from '../components/BackButton';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import GymLivePanel from '../components/gymLive/GymLivePanel';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import GymDashboardTab, { DASHBOARD_DAYS } from '../components/gymAdmin/GymDashboardTab';
import GymMembersTab from '../components/gymAdmin/GymMembersTab';
import GymJoinRequestsTab from '../components/gymAdmin/GymJoinRequestsTab';
import GymAnnouncementsTab from '../components/gymAdmin/GymAnnouncementsTab';
import AssignmentForm from '../components/gymAdmin/AssignmentForm';
import AssignmentList from '../components/gymAdmin/AssignmentList';
import { daysAgo } from '../components/gymAdmin/shared';
import {
  computeDashboard,
  listAssignments,
  listMembers,
  listProgress,
  listSessionsAndAttendance,
  type Assignment,
  type AttendanceRow,
  type GymMemberRow,
  type ProgressSummary,
  type SessionRow,
} from '../lib/gymClass/adminService';

const TABS = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'members', label: '회원' },
  { key: 'requests', label: '가입 신청' },
  { key: 'assignments', label: '과제·피드백' },
  { key: 'announcements', label: '공지' },
  { key: 'classes', label: '수업' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface OpsData {
  members: GymMemberRow[];
  sessions: SessionRow[];
  attendance: AttendanceRow[];
  progress: Map<string, { summary: ProgressSummary; updatedAt: string }>;
  assignments: Assignment[];
}

// Instructor's per-gym class management (spec item 13/14): create classes
// (reusing searchTechniques() — the same search index SearchBar.tsx uses,
// no new technique-picking logic) and open today's session for one.
// 0055: tabs for the operations dashboard (members, join requests, assignments,
// announcements) — the class tools above live unchanged under "수업".
export default function GymAdminDetail() {
  const { gymId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'dashboard';
  const [ops, setOps] = useState<OpsData | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [assignFilter, setAssignFilter] = useState<'all' | Assignment['status']>('all');
  const [gym, setGym] = useState<Gym | null>(null);
  const [classes, setClasses] = useState<GymClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Technique[]>([]);

  const searchResults = useMemo(() => (query.trim() ? searchTechniques(query, 15) : []), [query]);

  async function refresh() {
    setLoading(true);
    const [gymResult, classResult] = await Promise.all([getGym(gymId), listGymClasses(gymId)]);
    if (gymResult.ok) setGym(gymResult.data);
    if (classResult.ok) setClasses(classResult.data);
    setLoading(false);
  }

  async function loadOps() {
    setOpsLoading(true);
    setOpsError(null);
    const [m, sa, p, a] = await Promise.all([listMembers(gymId), listSessionsAndAttendance(gymId, daysAgo(DASHBOARD_DAYS)), listProgress(gymId), listAssignments(gymId)]);
    const failed = [m, sa, p, a].find((r) => !r.ok) as { ok: false; message: string } | undefined;
    if (failed || !m.ok || !sa.ok || !p.ok || !a.ok) {
      setOpsError(failed?.message ?? '운영 데이터를 불러오지 못했습니다.');
      setOpsLoading(false);
      return;
    }
    setOps({ members: m.data, sessions: sa.data.sessions, attendance: sa.data.attendance, progress: p.data, assignments: a.data });
    setOpsLoading(false);
  }

  useEffect(() => {
    void refresh();
    void loadOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  const stats = useMemo(() => (ops ? computeDashboard(ops.members, ops.sessions, ops.attendance, ops.progress, ops.assignments) : null), [ops]);
  const memberNames = useMemo(() => new Map((ops?.members ?? []).map((m) => [m.userId, m.nickname])), [ops]);

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams);
    if (key === 'dashboard') next.delete('tab');
    else next.set('tab', key);
    setSearchParams(next, { replace: true });
  }

  function renderOps(render: (data: OpsData, s: NonNullable<typeof stats>) => JSX.Element) {
    if (opsLoading && !ops) return <LoadingState />;
    if (opsError) return <ErrorState text={opsError} onRetry={loadOps} />;
    if (!ops || !stats) return <LoadingState />;
    return render(ops, stats);
  }

  function addTechnique(t: Technique) {
    if (picked.some((p) => p.id === t.id)) return;
    setPicked((prev) => [...prev, t]);
    setQuery('');
  }
  function removeTechnique(id: string) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleCreateClass() {
    if (!user || !title.trim() || picked.length === 0) return;
    setBusy(true);
    setError(null);
    const exerciseConfig: Record<string, ExerciseConfig> = {};
    for (const t of picked) exerciseConfig[t.id] = getDefaultExerciseConfig(t);
    const result = await createGymClass(gymId, title, { techniqueIds: picked.map((t) => t.id), exerciseConfig }, user.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setTitle('');
    setPicked([]);
    void refresh();
  }

  async function handleOpenSession(gymClass: GymClass) {
    if (!user) return;
    setBusy(true);
    setError(null);
    const result = await openTodaySession(gymClass, user.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    navigate(`/gym/admin/session/${result.data.id}`);
  }

  if (loading && !gym) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gym/admin" />
          <LoadingState />
        </div>
      </div>
    );
  }
  if (!gym) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gym/admin" />
          <EmptyState icon="🏛" text="체육관을 찾을 수 없습니다." />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/gym/admin" />
        <div className="breadcrumb">
          <Link to="/gym/admin">체육관 관리</Link>
          <span>/</span>
          <span>{gym.name}</span>
        </div>
        <div className="section-title">
          <h2>{gym.name}</h2>
        </div>
        <div className="card info-card">
          <p>가입 코드: <strong>{gym.joinCode}</strong></p>
          <p className="video-status-message">학생에게 이 코드를 공유하면 체육관에 참가할 수 있습니다.</p>
        </div>
        {user && gym.ownerUserId === user.id && (
          <p className="eco-meta" data-testid="gym-business-link">
            사업자 통계·리포트 등 추가 기능은 <Link to={`/business?gym=${encodeURIComponent(gym.id)}`}>사업자 요금제</Link>에서 관리합니다. 지금 쓰는 회원·과제·공지 관리 기능은 요금제와 관계없이 그대로 이용할 수 있습니다.
          </p>
        )}

        <div className="eco-tabs" role="tablist" aria-label="체육관 운영">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" className="eco-tab" aria-selected={tab === t.key} onClick={() => selectTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && renderOps((_d, st) => <GymDashboardTab gymId={gym.id} stats={st} />)}

        {tab === 'members' && user && renderOps((_d, st) => <GymMembersTab gymId={gym.id} stats={st} ownerUserId={gym.ownerUserId} myUserId={user.id} onChanged={loadOps} />)}

        {tab === 'requests' && <GymJoinRequestsTab gymId={gym.id} isOwner={!!user && gym.ownerUserId === user.id} onDecided={loadOps} />}

        {tab === 'assignments' &&
          user &&
          renderOps((d) => {
            const filtered = assignFilter === 'all' ? d.assignments : d.assignments.filter((a) => a.status === assignFilter);
            const counts = { open: 0, done: 0, dismissed: 0 } as Record<Assignment['status'], number>;
            for (const a of d.assignments) counts[a.status]++;
            return (
              <div>
                <AssignmentForm gymId={gym.id} authorId={user.id} members={d.members} onCreated={loadOps} />
                <div className="eco-section">
                  <h3>
                    <Icon name="check-square" /> 보낸 과제·피드백
                  </h3>
                  <span className="eco-meta--faint">
                    진행 중 {counts.open} · 완료 {counts.done} · 종료 {counts.dismissed}
                  </span>
                </div>
                <div className="eco-filters">
                  <select value={assignFilter} onChange={(e) => setAssignFilter(e.target.value as typeof assignFilter)} aria-label="상태 필터">
                    <option value="all">전체 상태</option>
                    <option value="open">진행 중</option>
                    <option value="done">완료</option>
                    <option value="dismissed">종료</option>
                  </select>
                </div>
                <AssignmentList items={filtered} gymId={gym.id} memberNames={memberNames} onChanged={loadOps} emptyText={assignFilter === 'all' ? '아직 보낸 과제·피드백이 없습니다.' : '이 상태의 과제가 없습니다.'} />
              </div>
            );
          })}

        {tab === 'announcements' && user && <GymAnnouncementsTab gymId={gym.id} authorId={user.id} />}

        {tab === 'classes' && (
        <>
        <GymLivePanel gymId={gym.id} />

        <div className="card info-card">
          <h3>새 클래스 만들기</h3>
          <input className="select" style={{ width: '100%', marginBottom: 8 }} placeholder="클래스 이름 (예: 복싱 초급반)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="select" style={{ width: '100%' }} placeholder="기술/운동 검색해서 추가" value={query} onChange={(e) => setQuery(e.target.value)} />
          {searchResults.length > 0 && (
            <div className="stack gap-2" style={{ marginTop: 6 }}>
              {searchResults.map((t) => (
                <button key={t.id} type="button" className="chip" onClick={() => addTechnique(t)}>
                  + {t.name}
                </button>
              ))}
            </div>
          )}
          {picked.length > 0 && (
            <div className="chip-row" style={{ marginTop: 8 }}>
              {picked.map((t) => (
                <span key={t.id} className="chip active">
                  {t.name}{' '}
                  <button type="button" onClick={() => removeTechnique(t.id)} aria-label="제거" style={{ marginLeft: 4 }}>
                    <Icon name="close" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="modal-actions modal-actions--start">
            <button className="btn btn-primary" disabled={busy || !title.trim() || picked.length === 0} onClick={handleCreateClass}>
              클래스 만들기
            </button>
          </div>
          {error && <p className="video-status-message" style={{ color: 'var(--accent, #e53e3e)' }}>{error}</p>}
        </div>

        <div className="section-title">
          <h2>클래스 목록</h2>
        </div>
        {classes.length === 0 ? (
          <EmptyState icon="📋" text="아직 만든 클래스가 없습니다." />
        ) : (
          <div className="stack gap-2">
            {classes.map((c) => (
              <div key={c.id} className="card info-card">
                <strong>{c.title}</strong>
                <p className="video-status-message">{c.plan.techniqueIds.length}개 운동</p>
                <div className="modal-actions modal-actions--start">
                  <button className="btn btn-primary" disabled={busy} onClick={() => handleOpenSession(c)}>
                    오늘 수업 열기
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
