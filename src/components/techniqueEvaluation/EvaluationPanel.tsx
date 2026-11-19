import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { addComment } from '../../lib/communityPost/service';
import { REPORT_REASONS } from '../../lib/social/types';
import { CRITERIA, TIER_LABEL, TIER_ORDER, artLabel, reliabilityOf, type CriterionKey } from '../../lib/techniqueEvaluation/criteria';
import {
  castVote,
  diffFromAverage,
  getMyVote,
  getStats,
  invalidateEvaluation,
  isEvaluationOpen,
  listFeedback,
  markFeedbackHelpful,
  reportFeedback,
  updateEvaluationSettings,
  withdrawVote,
  type EvaluationStats,
  type FeedbackItem,
  type MyVote,
  type TechniqueEvaluation,
} from '../../lib/techniqueEvaluation/service';

const DIST_LABELS = ['0–19', '20–39', '40–59', '60–79', '80–100'];

/**
 * 게시물·숏폼의 기술 평가 영역 — 투표(0~100%) · 결과 막대그래프 · 그룹별 평균 · 내 평가 · 피드백.
 * 집계는 서버(get_technique_evaluation_stats)가 하고 이 컴포넌트는 표시만 한다.
 */
export default function EvaluationPanel({ evaluation, onChanged }: { evaluation: TechniqueEvaluation; onChanged?: (e: TechniqueEvaluation) => void }) {
  const { user, profile } = useAuth();
  const [ev, setEv] = useState(evaluation);
  const [stats, setStats] = useState<EvaluationStats | null | undefined>(undefined);
  const [mine, setMine] = useState<MyVote | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scores, setScores] = useState<Partial<Record<CriterionKey, number>>>({});
  const [touched, setTouched] = useState<Partial<Record<CriterionKey, boolean>>>({});
  const [notes, setNotes] = useState<Partial<Record<CriterionKey, string>>>({});
  const [comment, setComment] = useState('');
  const [alsoComment, setAlsoComment] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);

  const isAuthor = !!user && user.id === ev.authorId;
  const open = isEvaluationOpen(ev);
  const canVote = !!user && open && (!isAuthor || ev.allowSelfVote) && mine?.status !== 'invalidated';

  const load = useCallback(async () => {
    const [s, m, f] = await Promise.all([getStats(ev.postId), getMyVote(ev.postId, user?.id ?? null), listFeedback(ev.postId)]);
    if (s.ok) setStats(s.data);
    else {
      setStats(null);
      setError(s.message);
    }
    setMine(m);
    if (f.ok) setFeedback(f.data);
    if (m && m.status === 'valid') {
      setScores(m.scores);
      setNotes(m.feedback);
      setComment(m.comment);
      setTouched(Object.fromEntries(Object.keys(m.scores).map((k) => [k, true])));
    }
  }, [ev.postId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const diff = useMemo(() => diffFromAverage(mine?.status === 'valid' ? mine : null, stats ?? null), [mine, stats]);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const picked = Object.fromEntries(ev.criteria.filter((k) => touched[k]).map((k) => [k, scores[k] ?? 50])) as Partial<Record<CriterionKey, number>>;
    const r = await castVote(ev.postId, picked, notes, comment);
    if (r.ok && alsoComment && user) {
      const text = [
        `[기술 평가] ${ev.techniqueName}`,
        ...ev.criteria.filter((k) => picked[k] !== undefined).map((k) => `${CRITERIA[k].label} ${picked[k]}%${notes[k] ? ` — ${notes[k]}` : ''}`),
        comment,
      ].filter(Boolean).join('\n');
      await addComment(ev.postId, user.id, profile?.nickname ?? '회원', text.slice(0, 2000));
    }
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setNotice(mine ? '평가를 수정했습니다. 최신 점수만 집계됩니다.' : '평가를 제출했습니다.');
    setEditing(false);
    void load();
  }

  async function withdraw() {
    if (!confirm('내 평가를 철회할까요? 통계에서 빠집니다.')) return;
    setBusy(true);
    const r = await withdrawVote(ev.postId);
    setBusy(false);
    if (!r.ok) setError(r.message);
    else {
      setScores({});
      setTouched({});
      setNotes({});
      setComment('');
      void load();
    }
  }

  async function changeSettings(patch: { resultsVisibility?: 'public' | 'author_only'; close?: boolean }) {
    if (patch.close && !confirm('평가를 종료할까요? 종료하면 다시 열 수 없고 결과는 보존됩니다.')) return;
    setBusy(true);
    const r = await updateEvaluationSettings(ev.postId, patch);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    invalidateEvaluation(ev.postId);
    const next = { ...ev, ...(patch.resultsVisibility ? { resultsVisibility: patch.resultsVisibility } : {}), ...(patch.close ? { closedAt: new Date().toISOString() } : {}) };
    setEv(next);
    onChanged?.(next);
    void load();
  }

  async function report(fb: FeedbackItem, reason: string) {
    if (!user) return;
    const r = await reportFeedback(user.id, ev.postId, fb.feedbackId, reason);
    setReporting(null);
    setNotice(r.ok ? '신고가 접수되었습니다. 운영자가 확인 후 부정 투표는 통계에서 제외합니다.' : r.message);
  }

  const rel = reliabilityOf(stats?.participants ?? 0);
  const myValid = mine?.status === 'valid' ? mine : null;

  return (
    <section className="eco-card" style={{ marginTop: 12 }} data-testid="eval-panel">
      <div className="eco-row eco-row--between">
        <div>
          <div className="eco-kicker">기술 평가</div>
          <h3 style={{ margin: '2px 0 0' }}>{ev.techniqueName}</h3>
          <div className="eco-meta">
            {artLabel(ev.martialArt)}
            {ev.techniqueId && (
              <>
                {' · '}
                <Link to={`/arts/${ev.martialArt}/techniques/${ev.techniqueId}`}>기술 상세 보기</Link>
              </>
            )}
          </div>
        </div>
        <div className="eco-row">
          <span className={`eco-pill ${open ? 'eco-pill--good' : 'eco-pill--muted'}`} data-testid="eval-open-state">{open ? '투표 진행 중' : '평가 종료'}</span>
          {ev.closesAt && open && <span className="eco-pill">~{new Date(ev.closesAt).toLocaleDateString('ko-KR')}</span>}
          {ev.resultsVisibility === 'author_only' && <span className="eco-pill eco-pill--warn"><Icon name="lock" /> 결과 비공개</span>}
        </div>
      </div>

      <p className="eco-meta-faint eco-meta" style={{ margin: '8px 0 0' }}>
        외모·인기·친분이 아니라 영상 속 기술만 평가해 주세요. 결과는 커뮤니티 의견이며 실제 실력의 공식 점수가 아닙니다.
      </p>

      {error && <div className="ai-error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      {notice && <div className="eco-notice eco-notice--accent" role="status">{notice}</div>}

      {/* ---------- 결과 ---------- */}
      {stats === undefined ? (
        <p className="eco-meta">불러오는 중…</p>
      ) : stats === null ? (
        <p className="eco-meta">평가 결과를 볼 수 없습니다.</p>
      ) : stats.hidden ? (
        <div className="eco-notice" data-testid="eval-hidden">작성자가 결과를 비공개로 설정했습니다. 참여자 {stats.participants}명.</div>
      ) : (
        <div data-testid="eval-results">
          <div className="eco-row" style={{ marginTop: 12 }}>
            <span className="eco-pill eco-pill--accent" data-testid="eval-participants"><Icon name="users" /> 참여 {stats.participants}명</span>
            <span className={`eco-pill ${rel.level === 'good' || rel.level === 'moderate' ? 'eco-pill--good' : 'eco-pill--warn'}`} data-testid="eval-reliability">{rel.label}</span>
          </div>
          {rel.level !== 'good' && rel.level !== 'moderate' && <div className="eco-notice" data-testid="eval-small-sample">{rel.note}</div>}

          <div className="eco-section"><h3>전체 사용자 평균</h3><span className="eco-meta">세로선 = 내 점수</span></div>
          <div className="eco-bars" data-testid="eval-overall">
            {ev.criteria.map((k) => {
              const s = stats.overall?.[k];
              const my = myValid?.scores[k];
              return (
                <div key={k}>
                  <div className="eco-bar">
                    <span className="eco-bar__label" title={CRITERIA[k].hint}>{CRITERIA[k].label}</span>
                    <span className="eco-bar__track">
                      {s && <span className="eco-bar__fill" style={{ width: `${Number(s.avg)}%` }} />}
                      {typeof my === 'number' && <span className="eco-bar__marker" style={{ left: `calc(${my}% - 1px)` }} />}
                    </span>
                    <span className={`eco-bar__value${s ? '' : ' eco-bar__value--muted'}`}>{s ? `${Number(s.avg)}%` : '—'}</span>
                  </div>
                  {s && (
                    <details style={{ margin: '2px 0 0 0' }}>
                      <summary className="eco-meta" style={{ cursor: 'pointer', fontSize: 12 }}>응답 {s.n}명 · 점수 분포</summary>
                      <div style={{ maxWidth: 260, marginTop: 4 }}>
                        <div className="eco-dist">
                          {s.dist.map((c, i) => (
                            <span key={i} style={{ height: `${s.n ? Math.max(4, (c / s.n) * 100) : 4}%` }} title={`${DIST_LABELS[i]}: ${c}명`} />
                          ))}
                        </div>
                        <div className="eco-dist-labels">{DIST_LABELS.map((l) => <span key={l}>{l}</span>)}</div>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          <div className="eco-section"><h3>평가자 그룹별 평균</h3></div>
          <p className="eco-meta" style={{ marginTop: 0 }}>
            숙련도·지도자 그룹은 플랫폼이 검증한 자격만 사용합니다. {stats.minGroupSize ?? 3}명 미만 그룹은 개인 점수가 드러나지 않도록 평균을 숨깁니다.
          </p>
          <div className="eco-table-wrap" data-testid="eval-groups">
            <table className="eco-table">
              <thead>
                <tr>
                  <th>그룹</th>
                  <th>인원</th>
                  {ev.criteria.map((k) => <th key={k}>{CRITERIA[k].label}</th>)}
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.filter((t) => stats.groups?.[t]).map((t) => {
                  const g = stats.groups![t];
                  return (
                    <tr key={t}>
                      <td>{TIER_LABEL[t]}</td>
                      <td>{g.voters}명</td>
                      {ev.criteria.map((k) => (
                        <td key={k} className={g.suppressed || g.avg?.[k] === undefined ? 'eco-missing' : ''}>{g.suppressed ? '표본 부족' : g.avg?.[k] !== undefined ? `${g.avg[k]}%` : '—'}</td>
                      ))}
                    </tr>
                  );
                })}
                {stats.outsideGym && (stats.sameGymVoters ?? 0) > 0 && (
                  <tr>
                    <td>같은 체육관 회원 제외</td>
                    <td>{stats.outsideGym.voters}명</td>
                    {ev.criteria.map((k) => (
                      <td key={k} className={stats.outsideGym!.suppressed ? 'eco-missing' : ''}>{stats.outsideGym!.suppressed ? '표본 부족' : stats.outsideGym!.avg?.[k] !== undefined ? `${stats.outsideGym!.avg[k]}%` : '—'}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {(stats.sameGymVoters ?? 0) > 0 && <p className="eco-meta">작성자와 같은 체육관 회원 {stats.sameGymVoters}명이 참여했습니다. 서로 높게 주는 경향이 있을 수 있어 제외한 평균을 따로 보여 줍니다.</p>}
        </div>
      )}

      {/* ---------- 내 평가 ---------- */}
      <div className="eco-section"><h3>내 평가</h3>{myValid && <span className="eco-meta">수정 {myValid.revision - 1}회 · 최신 점수만 집계</span>}</div>
      {!user ? (
        <p className="eco-meta"><Link to="/login">로그인</Link>하면 평가에 참여할 수 있습니다.</p>
      ) : mine?.status === 'invalidated' ? (
        <div className="eco-notice">내 평가는 운영 정책에 따라 무효 처리되어 통계에서 제외되었습니다.</div>
      ) : isAuthor && !ev.allowSelfVote ? (
        <p className="eco-meta">내 콘텐츠에는 투표할 수 없습니다.</p>
      ) : myValid && !editing ? (
        <div data-testid="eval-my-vote">
          <div className="eco-bars">
            {ev.criteria.filter((k) => myValid.scores[k] !== undefined).map((k) => (
              <div key={k} className="eco-bar">
                <span className="eco-bar__label">{CRITERIA[k].label}</span>
                <span className="eco-bar__track"><span className="eco-bar__fill eco-bar__fill--alt" style={{ width: `${myValid.scores[k]}%` }} /></span>
                <span className="eco-bar__value">{myValid.scores[k]}%</span>
              </div>
            ))}
          </div>
          <div className="eco-row" data-testid="eval-my-diff">
            {ev.criteria.filter((k) => diff[k] !== undefined).map((k) => (
              <span key={k} className="eco-pill">
                {CRITERIA[k].label}: 평균보다 {diff[k] === null ? '— (평균 없음)' : `${diff[k]! > 0 ? '+' : ''}${diff[k]}`}
              </span>
            ))}
          </div>
          {open && (
            <div className="eco-row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} data-testid="eval-edit">평가 수정</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={withdraw} disabled={busy}>평가 철회</button>
            </div>
          )}
        </div>
      ) : canVote ? (
        <div className="eco-form" data-testid="eval-vote-form">
          <p className="eco-meta" style={{ margin: 0 }}>평가할 항목의 슬라이더를 움직이세요. 움직이지 않은 항목은 제출되지 않습니다.</p>
          {ev.criteria.map((k) => (
            <div key={k} className="eco-stack" style={{ gap: 4 }}>
              <div className="eco-slider">
                <span title={CRITERIA[k].hint}>{CRITERIA[k].label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={scores[k] ?? 50}
                  onChange={(e) => {
                    setScores((s) => ({ ...s, [k]: Number(e.target.value) }));
                    setTouched((t) => ({ ...t, [k]: true }));
                  }}
                  aria-label={`${CRITERIA[k].label} 점수`}
                  data-testid={`eval-slider-${k}`}
                />
                <output>{touched[k] ? `${scores[k] ?? 50}%` : '—'}</output>
              </div>
              {touched[k] && (
                <input value={notes[k] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))} placeholder={`${CRITERIA[k].label} 피드백 (선택, 300자)`} maxLength={300} />
              )}
            </div>
          ))}
          <label>
            개선 의견 (선택)
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="기술 개선을 위한 의견" />
          </label>
          <label className="eco-check">
            <input type="checkbox" checked={alsoComment} onChange={(e) => setAlsoComment(e.target.checked)} /> 댓글로도 남기기 (내 닉네임으로 공개)
          </label>
          <div className="eco-row">
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !Object.values(touched).some(Boolean)} data-testid="eval-submit">
              {busy ? '제출 중…' : myValid ? '수정 제출' : '평가 제출'}
            </button>
            {editing && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>취소</button>}
          </div>
          <p className="eco-meta">점수는 익명으로 집계되며 다른 사람은 내 개별 점수를 볼 수 없습니다.</p>
        </div>
      ) : (
        <p className="eco-meta">{open ? '평가할 수 없는 상태입니다.' : '평가가 종료되었습니다.'}</p>
      )}

      {/* ---------- 피드백 ---------- */}
      {feedback.length > 0 && (
        <>
          <div className="eco-section"><h3>항목별 피드백</h3><span className="eco-meta">익명 · {feedback.length}건</span></div>
          <div className="eco-stack" data-testid="eval-feedback">
            {feedback.map((f) => (
              <div key={f.feedbackId} className="eco-card" style={{ padding: 10, boxShadow: 'none' }}>
                {Object.entries(f.feedback).map(([k, text]) => (
                  <div key={k} className="eco-meta" style={{ color: 'var(--text)' }}><strong>{CRITERIA[k as CriterionKey]?.label ?? k}</strong> · {text}</div>
                ))}
                {f.comment && <div style={{ marginTop: 4, fontSize: 14 }}>{f.comment}</div>}
                <div className="eco-row" style={{ marginTop: 6 }}>
                  {f.helpful && <span className="eco-pill eco-pill--good"><Icon name="thumbs-up" /> 작성자가 유용하다고 표시</span>}
                  {isAuthor && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const r = await markFeedbackHelpful(ev.postId, f.feedbackId, !f.helpful); if (r.ok) void load(); else setError(r.message); }}>
                      {f.helpful ? '유용함 취소' : '유용함 표시'}
                    </button>
                  )}
                  {user && reporting !== f.feedbackId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReporting(f.feedbackId)}><Icon name="flag" /> 신고</button>}
                  {user && reporting === f.feedbackId && (
                    <select className="select" defaultValue="" onChange={(e) => e.target.value && void report(f, e.target.value)} aria-label="신고 사유">
                      <option value="">신고 사유 선택</option>
                      {['부정 투표 의심 (같은 사람·조직적 참여)', '기술과 무관한 평가 (외모·인신공격)', ...REPORT_REASONS].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------- 작성자 설정 ---------- */}
      {isAuthor && (
        <div className="eco-row" style={{ marginTop: 14 }} data-testid="eval-author-controls">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => changeSettings({ resultsVisibility: ev.resultsVisibility === 'public' ? 'author_only' : 'public' })}>
            {ev.resultsVisibility === 'public' ? '결과 비공개로 전환' : '결과 공개로 전환'}
          </button>
          {open && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => changeSettings({ close: true })} data-testid="eval-close">평가 종료</button>}
        </div>
      )}
    </section>
  );
}
