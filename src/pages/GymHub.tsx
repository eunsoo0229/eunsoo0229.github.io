import Icon from '../components/Icon';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { joinGymByCode, listMyGyms, listOpenSessionsForStudent } from '../lib/gymClass/service';
import type { MyGymMembership, OpenSessionForStudent } from '../lib/gymClass/types';
import BackButton from '../components/BackButton';
import EmptyState from '../components/EmptyState';
import GymMemberPanel from '../components/gymAdmin/GymMemberPanel';

// Student-facing entry point (spec item 13/14) — join a gym by code, see my
// gyms, and see today's open sessions across all of them. Live-fetched from
// Supabase on mount only (see plan's perf note — no polling/subscription;
// an instructor opening a session is a rare, low-frequency event).
export default function GymHub() {
  const navigate = useNavigate();
  const { user, profile, isConfigured } = useAuth();
  const [memberships, setMemberships] = useState<MyGymMembership[]>([]);
  const [openSessions, setOpenSessions] = useState<OpenSessionForStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    const [memberResult, sessionResult] = await Promise.all([listMyGyms(user.id), listOpenSessionsForStudent(user.id)]);
    if (memberResult.ok) {
      setMemberships(memberResult.data);
      const studentGyms = memberResult.data.filter((m) => m.role !== 'instructor');
      if (studentGyms.length === 1) setExpanded((v) => v ?? studentGyms[0].gym.id);
    }
    if (sessionResult.ok) setOpenSessions(sessionResult.data);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleJoin() {
    if (!user || !joinCode.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await joinGymByCode(joinCode, user.id, profile?.nickname ?? '학생');
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(result.data.pending ? '가입 신청을 보냈습니다. 관장님 승인 후 참가됩니다.' : `${result.data.name}에 참가했습니다.`);
    setJoinCode('');
    void refresh();
  }

  if (!isConfigured) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/training" />
          <EmptyState icon="🏛" text="체육관 기능은 로그인/클라우드 설정이 필요합니다." />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/training" />
          <EmptyState icon="🏛" text="체육관에 참가하려면 로그인이 필요합니다." />
          <div className="modal-actions modal-actions--start">
            <Link className="btn btn-primary" to="/login">
              로그인
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/training" />
        <div className="breadcrumb">
          <Link to="/">홈</Link>
          <span>/</span>
          <Link to="/training">훈련</Link>
          <span>/</span>
          <span>체육관</span>
        </div>
        <div className="section-title">
          <h2><Icon name="building" /> 체육관</h2>
          <Link to="/gym/admin" className="see-all">
            관장님이신가요? →
          </Link>
        </div>

        <div className="card info-card">
          <h3>체육관 참가하기</h3>
          <p className="video-status-message">관장님께 받은 6자리 코드를 입력하세요.</p>
          <div className="chip-row">
            <input
              className="select"
              style={{ flex: 1, minWidth: 140 }}
              placeholder="예: AB12CD"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={6}
            />
            <button className="btn btn-primary" disabled={busy || !joinCode.trim()} onClick={handleJoin}>
              참가
            </button>
          </div>
          {error && <p className="video-status-message" style={{ color: 'var(--accent, #e53e3e)' }}>{error}</p>}
          {notice && (
            <p className="video-status-message" role="status">
              {notice}
            </p>
          )}
        </div>

        <Link to="/gyms" className="eco-card eco-card--link gadm-link-card" style={{ marginTop: 12 }}>
          <Icon name="search" />
          <div>
            <strong>체육관 찾기·가격 비교</strong>
            <p className="eco-meta" style={{ margin: '2px 0 0' }}>
              지역·종목별 체육관을 찾고 플랫폼이 검증한 가격을 비교합니다.
            </p>
          </div>
        </Link>

        <div className="section-title">
          <h2>오늘 열린 수업</h2>
        </div>
        {loading ? (
          <p className="video-status-message">불러오는 중...</p>
        ) : openSessions.length === 0 ? (
          <EmptyState icon="📭" art="no-gym" text="오늘 열린 수업이 없습니다." />
        ) : (
          <div className="stack gap-2">
            {openSessions.map((s) => (
              <div key={s.session.id} className="card info-card">
                <strong>{s.gymName} · {s.classTitle}</strong>
                <p className="video-status-message">{s.alreadyCompleted ? <>오늘 완료했습니다 <Icon name="check" /></> : '아직 시작 전'}</p>
                <div className="modal-actions modal-actions--start">
                  <button className="btn btn-primary" disabled={s.alreadyCompleted} onClick={() => navigate(`/gym/session/${s.session.id}`)}>
                    {s.alreadyCompleted ? '완료됨' : '수업 시작'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="section-title">
          <h2>내 체육관</h2>
        </div>
        {memberships.length === 0 ? (
          <EmptyState icon="🏛" text="아직 참가한 체육관이 없습니다." />
        ) : (
          <div className="stack gap-2">
            {memberships.map((m) => (
              <div key={m.gym.id} className="card info-card">
                <div className="gym-row">
                  <span className="gym-logo" role="img" aria-label="" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{m.gym.name}</strong>
                    <p className="video-status-message">{m.role === 'instructor' ? '관장님' : '학생'}으로 참여 중</p>
                  </div>
                  {m.role === 'instructor' ? (
                    <Link className="btn btn-secondary btn-sm" to={`/gym/admin/${m.gym.id}`}>
                      운영 화면
                    </Link>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" aria-expanded={expanded === m.gym.id} onClick={() => setExpanded((v) => (v === m.gym.id ? null : m.gym.id))}>
                      {expanded === m.gym.id ? '접기' : '공지·과제·진도 공유'}
                    </button>
                  )}
                </div>
                {m.role !== 'instructor' && expanded === m.gym.id && <GymMemberPanel gymId={m.gym.id} gymName={m.gym.name} userId={user.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
