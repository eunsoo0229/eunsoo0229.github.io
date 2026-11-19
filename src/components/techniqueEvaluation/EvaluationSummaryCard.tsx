import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { artLabel, reliabilityOf } from '../../lib/techniqueEvaluation/criteria';
import { getUserEvaluationSummary, type EvaluationSummary } from '../../lib/techniqueEvaluation/service';

/** 프로필: 이 사용자가 받은 기술 평가 요약 (결과 공개 평가만, 본인에게는 비공개 평가도). */
export default function EvaluationSummaryCard({ userId, isMe }: { userId: string; isMe: boolean }) {
  const [sum, setSum] = useState<EvaluationSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void getUserEvaluationSummary(userId).then((r) => alive && setSum(r.ok ? r.data : null));
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!sum || sum.evaluations === 0) {
    return isMe ? (
      <div className="eco-card" style={{ margin: '12px 0' }} data-testid="profile-eval-summary">
        <strong><Icon name="chart" /> 받은 기술 평가</strong>
        <p className="eco-meta">아직 받은 기술 평가가 없습니다. 게시물이나 숏폼을 올릴 때 "기술 평가 받기"를 켜 보세요. <Link to="/evaluations">내 평가 기록</Link></p>
      </div>
    ) : null;
  }
  return (
    <div className="eco-card" style={{ margin: '12px 0' }} data-testid="profile-eval-summary">
      <div className="eco-row eco-row--between">
        <strong><Icon name="chart" /> 받은 기술 평가</strong>
        {isMe && <Link to="/evaluations" className="eco-meta">전체 기록</Link>}
      </div>
      <div className="eco-meta">평가 {sum.evaluations}건 · 누적 참여 {sum.totalVoters}명 · 커뮤니티 의견이며 공식 인증이 아닙니다</div>
      <div className="eco-stack" style={{ marginTop: 8, gap: 6 }}>
        {sum.items.slice(0, 5).map((it) => (
          <Link key={it.postId} to={`/community/post/${it.postId}`} className="eco-row eco-row--between" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span>{it.techniqueName} <span className="eco-meta">· {artLabel(it.martialArt)}</span></span>
            <span className="eco-row">
              <span className="eco-meta">{it.voters}명</span>
              <span className={`eco-pill ${it.voters >= 10 ? 'eco-pill--good' : 'eco-pill--warn'}`}>{it.avg !== null ? `평균 ${it.avg}%` : '평가 없음'} · {reliabilityOf(it.voters).label}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
