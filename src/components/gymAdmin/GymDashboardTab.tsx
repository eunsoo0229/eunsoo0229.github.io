// 체육관 운영 대시보드 — computeDashboard() 결과만 표시한다. 값이 없으면 "데이터 없음"과 이유를 쓴다.
import { Link } from 'react-router-dom';
import { INACTIVE_DAYS, type DashboardStats } from '../../lib/gymClass/adminService';
import EmptyState from '../EmptyState';
import Icon from '../Icon';
import { MetricCard, fmtDate, pct } from './shared';

export const DASHBOARD_DAYS = 56;

export default function GymDashboardTab({ gymId, stats }: { gymId: string; stats: DashboardStats }) {
  const shared = stats.members.filter((m) => m.role === 'student' && m.shared);
  const notShared = stats.members.filter((m) => m.role === 'student' && !m.shared).length;
  const noStudents = stats.students === 0;

  return (
    <div>
      <p className="eco-meta">
        최근 {DASHBOARD_DAYS}일 동안 이 체육관에서 열린 수업 {stats.sessions}회와 학생 출석 기록, 학생이 동의해 공유한 진도 요약으로 계산합니다. 출석률·활성 회원은 학생 기준입니다.
      </p>
      <div className="eco-metrics" data-testid="gym-dash-metrics">
        <MetricCard label="전체 회원" value={stats.totalMembers} sub={`학생 ${stats.students}명 · 지도자 ${stats.totalMembers - stats.students}명`} />
        <MetricCard
          label={`활성 회원 (최근 ${INACTIVE_DAYS}일)`}
          value={noStudents ? null : stats.activeMembers}
          sub={`학생 ${stats.students}명 중 · 수업 출석 또는 공유된 훈련 기록 기준`}
          why="아직 학생 회원이 없습니다."
        />
        <MetricCard
          label="출석률"
          value={pct(stats.attendanceRate)}
          sub="학생별 가입 이후 열린 수업 대비 출석"
          why={noStudents ? '아직 학생 회원이 없습니다.' : `최근 ${DASHBOARD_DAYS}일 동안 학생 가입 이후 열린 수업이 없습니다.`}
        />
        <MetricCard
          label="수업 참여(완료)율"
          value={pct(stats.participationRate)}
          sub="출석한 수업 중 끝까지 완료한 비율 · 현재 앱은 수업을 완료할 때 출석이 기록됩니다"
          why="출석 기록이 없어 계산할 수 없습니다."
        />
        <MetricCard
          label="기술 학습 완료율"
          value={pct(stats.learningCompletionRate)}
          sub={`숙련 / 학습한 기술 · 공유 회원 ${stats.sharedCount}명 기준`}
          why={stats.sharedCount === 0 ? '진도를 공유한 학생이 없습니다. 학생이 체육관 화면에서 진도 공유를 켜야 합니다.' : '공유한 학생들의 학습 기록이 아직 없습니다.'}
        />
        <MetricCard label="진도 공유 회원" value={stats.sharedCount} sub={noStudents ? '학생 없음' : `학생 ${stats.students}명 중 · 미공유 ${notShared}명`} />
      </div>

      <div className="eco-section">
        <h3>
          <Icon name="calendar" /> 주별 출석
        </h3>
        <span className="eco-meta--faint">주 시작일 기준 · 출석 / 출석 가능 인원</span>
      </div>
      {stats.weeklyAttendance.length === 0 ? (
        <p className="eco-meta">데이터 없음 — 최근 {DASHBOARD_DAYS}일 동안 열린 수업이 없습니다. 수업 탭에서 오늘 수업을 열면 출석이 기록됩니다.</p>
      ) : (
        <div className="eco-bars gadm-bars">
          {stats.weeklyAttendance.map((w) => {
            const rate = w.possible ? Math.round((w.attended / w.possible) * 100) : null;
            return (
              <div key={w.week} className="eco-bar">
                <span className="eco-bar__label">{fmtDate(w.week)} 주</span>
                <span className="eco-bar__track" title={`${w.attended} / ${w.possible}`}>
                  {rate !== null && <span className="eco-bar__fill" style={{ width: `${Math.min(100, rate)}%` }} />}
                </span>
                <span className={rate === null ? 'eco-bar__value eco-bar__value--muted' : 'eco-bar__value'}>{rate === null ? '데이터 없음' : `${rate}%`}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="eco-section">
        <h3>
          <Icon name="warn" /> 장기 미접속 학생
        </h3>
        <span className="eco-meta--faint">{INACTIVE_DAYS}일 이상 활동 없음</span>
      </div>
      {stats.inactive.length === 0 ? (
        <p className="eco-meta">{noStudents ? '아직 학생 회원이 없습니다.' : `최근 ${INACTIVE_DAYS}일 안에 모든 학생의 활동 기록이 있습니다.`}</p>
      ) : (
        <div className="eco-table-wrap">
          <table className="eco-table">
            <thead>
              <tr>
                <th>회원</th>
                <th>마지막 활동</th>
                <th>미접속</th>
              </tr>
            </thead>
            <tbody>
              {stats.inactive.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <Link className="gadm-cell-strong" to={`/gym/admin/${gymId}/member/${m.userId}`}>
                      {m.nickname}
                    </Link>
                  </td>
                  <td>{m.lastActivityAt ? fmtDate(m.lastActivityAt) : '기록 없음'}</td>
                  <td>{m.inactiveDays === null ? '기록 없음' : `${m.inactiveDays}일`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="eco-meta--faint" style={{ marginTop: 6 }}>
        활동은 최근 {DASHBOARD_DAYS}일 수업 출석과, 진도를 공유한 학생의 마지막 훈련 시각으로만 판단합니다. 공유하지 않은 학생의 개인 훈련은 보이지 않습니다.
      </p>

      <div className="eco-section">
        <h3>
          <Icon name="trend" /> 회원별 성장
        </h3>
        <span className="eco-meta--faint">숙련 / 학습한 기술</span>
      </div>
      {shared.length === 0 ? (
        <EmptyState icon="📈" text="진도를 공유한 학생이 없어 성장 데이터가 없습니다." />
      ) : (
        <div className="eco-bars gadm-bars">
          {shared.map((m) => {
            const rate = m.learned ? Math.round(((m.proficient ?? 0) / m.learned) * 100) : null;
            return (
              <div key={m.userId} className="eco-bar">
                <Link className="eco-bar__label" to={`/gym/admin/${gymId}/member/${m.userId}`}>
                  {m.nickname}
                </Link>
                <span className="eco-bar__track" title={`숙련 ${m.proficient ?? 0} / 학습 ${m.learned ?? 0}`}>
                  {rate !== null && <span className="eco-bar__fill eco-bar__fill--good" style={{ width: `${rate}%` }} />}
                </span>
                <span className={m.learned ? 'eco-bar__value' : 'eco-bar__value eco-bar__value--muted'}>{m.learned ? `${m.proficient ?? 0}/${m.learned}` : '기록 없음'}</span>
              </div>
            );
          })}
        </div>
      )}
      {notShared > 0 && shared.length > 0 && <p className="eco-meta--faint">진도를 공유하지 않은 학생 {notShared}명은 표시되지 않습니다.</p>}
    </div>
  );
}
