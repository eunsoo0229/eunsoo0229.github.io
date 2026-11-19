import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Icon from '../components/Icon';
import { useAuth } from '../lib/auth/AuthProvider';
import { CRITERIA, artLabel, reliabilityOf, type CriterionKey } from '../lib/techniqueEvaluation/criteria';
import { getStats, isEvaluationOpen, listMyEvaluations, listMyVotes, type EvaluationStats, type MyVoteHistoryItem, type TechniqueEvaluation } from '../lib/techniqueEvaluation/service';

type Tab = 'received' | 'given' | 'byArt';

/** 내 기술 평가 기록: 받은 평가 · 내가 참여한 평가(내 점수와 평균 차이) · 종목별 */
export default function MyEvaluations() {
  const { user, isConfigured } = useAuth();
  const [tab, setTab] = useState<Tab>('received');
  const [mine, setMine] = useState<TechniqueEvaluation[] | null>(null);
  const [votes, setVotes] = useState<MyVoteHistoryItem[] | null>(null);
  const [stats, setStats] = useState<Map<string, EvaluationStats | null>>(new Map());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setError(null);
    const [a, b] = await Promise.all([listMyEvaluations(user.id), listMyVotes(user.id)]);
    if (!a.ok) return setError(a.message);
    if (!b.ok) return setError(b.message);
    setMine(a.data);
    setVotes(b.data);
    const ids = [...new Set([...a.data.map((e) => e.postId), ...b.data.map((v) => v.postId)])].slice(0, 60);
    const pairs = await Promise.all(
      ids.map(async (id) => {
        const r = await getStats(id);
        return [id, r.ok ? r.data : null] as const;
      }),
    );
    setStats(new Map(pairs));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const byArt = useMemo(() => {
    const m = new Map<string, { given: number; received: number }>();
    for (const v of votes ?? []) if (v.evaluation && v.status === 'valid') m.set(v.evaluation.martialArt, { given: (m.get(v.evaluation.martialArt)?.given ?? 0) + 1, received: m.get(v.evaluation.martialArt)?.received ?? 0 });
    for (const e of mine ?? []) m.set(e.martialArt, { given: m.get(e.martialArt)?.given ?? 0, received: (m.get(e.martialArt)?.received ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].given + b[1].received - (a[1].given + a[1].received));
  }, [votes, mine]);

  if (!isConfigured || !user) {
    return (
      <div className="page"><div className="container">
        <BackButton fallback="/community" />
        <EmptyState icon="🔒" text={!isConfigured ? '기술 평가는 클라우드 설정이 필요합니다.' : '로그인하면 내 평가 기록을 볼 수 있습니다.'} />
        {isConfigured && <Link className="btn btn-primary" to="/login">로그인</Link>}
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/community" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">커뮤니티 기술 평가</div>
            <h2>내 평가 기록</h2>
            <p>점수는 커뮤니티 의견입니다. 참여자가 적으면 신뢰도가 낮다고 함께 표시합니다.</p>
          </div>
        </div>
        <div className="eco-tabs" role="tablist">
          {([['received', '내가 받은 평가'], ['given', '내가 참여한 평가'], ['byArt', '종목별']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" className="eco-tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`myeval-tab-${k}`}>{l}</button>
          ))}
        </div>
        {error && <ErrorState text={error} onRetry={load} />}
        {!error && (mine === null || votes === null) && <p className="eco-meta">불러오는 중…</p>}

        {tab === 'received' && mine && (mine.length === 0 ? (
          <EmptyState icon="📭" text="아직 기술 평가를 받은 게시물이 없습니다." />
        ) : (
          <div className="eco-stack">
            {mine.map((e) => {
              const s = stats.get(e.postId);
              const n = s?.participants ?? 0;
              return (
                <Link key={e.postId} to={`/community/post/${e.postId}`} className="eco-card eco-card--link" data-testid="myeval-received">
                  <div className="eco-row eco-row--between">
                    <strong>{e.techniqueName}</strong>
                    <span className="eco-row">
                      <span className="eco-pill">{artLabel(e.martialArt)}</span>
                      <span className={`eco-pill ${isEvaluationOpen(e) ? 'eco-pill--good' : 'eco-pill--muted'}`}>{isEvaluationOpen(e) ? '진행 중' : '종료'}</span>
                      {e.resultsVisibility === 'author_only' && <span className="eco-pill eco-pill--warn"><Icon name="lock" /> 비공개</span>}
                    </span>
                  </div>
                  <div className="eco-meta">참여 {n}명 · {reliabilityOf(n).label}</div>
                  {s?.overall && n > 0 && (
                    <div className="eco-bars">
                      {e.criteria.map((k) => (
                        <div key={k} className="eco-bar">
                          <span className="eco-bar__label">{CRITERIA[k].label}</span>
                          <span className="eco-bar__track">{s.overall?.[k] && <span className="eco-bar__fill" style={{ width: `${Number(s.overall[k]!.avg)}%` }} />}</span>
                          <span className="eco-bar__value">{s.overall?.[k] ? `${Number(s.overall[k]!.avg)}%` : '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        {tab === 'given' && votes && (votes.length === 0 ? (
          <EmptyState icon="📭" text="아직 참여한 평가가 없습니다. 숏폼이나 게시물의 기술 평가에 참여해 보세요." />
        ) : (
          <div className="eco-stack">
            {votes.map((v) => {
              const s = stats.get(v.postId);
              return (
                <Link key={v.postId} to={`/community/post/${v.postId}`} className="eco-card eco-card--link" data-testid="myeval-given">
                  <div className="eco-row eco-row--between">
                    <strong>{v.evaluation?.techniqueName ?? '삭제되었거나 볼 수 없는 게시물'}</strong>
                    <span className="eco-row">
                      {v.status !== 'valid' && <span className="eco-pill eco-pill--warn">{v.status === 'withdrawn' ? '철회함' : '무효 처리됨'}</span>}
                      <span className="eco-meta">{new Date(v.updatedAt).toLocaleDateString('ko-KR')}</span>
                    </span>
                  </div>
                  <div className="eco-row" style={{ marginTop: 6 }}>
                    {(Object.entries(v.scores) as [CriterionKey, number][]).map(([k, score]) => {
                      const avg = s && !s.hidden ? s.overall?.[k]?.avg : undefined;
                      const d = typeof avg === 'number' ? Math.round((score - Number(avg)) * 10) / 10 : null;
                      return (
                        <span key={k} className="eco-pill">
                          {CRITERIA[k]?.label ?? k} 내 점수 {score}%{d !== null ? ` (평균 대비 ${d > 0 ? '+' : ''}${d})` : s?.hidden ? ' (결과 비공개)' : ''}
                        </span>
                      );
                    })}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}

        {tab === 'byArt' && (byArt.length === 0 ? (
          <EmptyState icon="📭" text="종목별로 보여 줄 평가 기록이 없습니다." />
        ) : (
          <div className="eco-table-wrap">
            <table className="eco-table">
              <thead><tr><th>종목</th><th>내가 참여</th><th>내가 받음</th></tr></thead>
              <tbody>
                {byArt.map(([art, c]) => (
                  <tr key={art}><td>{artLabel(art)}</td><td>{c.given}건</td><td>{c.received}건</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
