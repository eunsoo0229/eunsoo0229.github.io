import Icon from '../Icon';
import { MasteryGlyph } from '../StatusGlyph';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ensureLessonAssessment, UNDERSTANDING_LABEL, type LessonAssessment } from '../../lib/coachLesson/lessonAssessment';
import { getLessonLog } from '../../lib/coachLesson/lessonLog';
import { MASTERY_LABEL } from '../../lib/skillProgress/types';
import { resolveTechnique } from '../../lib/userTechniques/service';

/** 수업 마무리: the AI coach's rating of each technique's 이해도·숙련도 — saved and applied to mastery. */
export default function LessonAssessmentCard({ logId, auto = true }: { logId: string; /** false = show a saved rating only; rating an older lesson waits for the user's click. */ auto?: boolean }) {
  const saved = getLessonLog(logId)?.assessment ?? null;
  const [state, setState] = useState<{ busy: boolean; result: LessonAssessment | null; error: string | null }>({ busy: auto || !!saved, result: null, error: null });
  const [nonce, setNonce] = useState(0);
  const [started, setStarted] = useState(auto || !!saved);
  useEffect(() => {
    if (!started) return;
    let alive = true;
    setState({ busy: true, result: null, error: null });
    ensureLessonAssessment(logId, { force: nonce > 0 })
      .then((r) => alive && setState({ busy: false, result: r, error: null }))
      .catch((e) => alive && setState({ busy: false, result: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [logId, nonce, started]);
  const r = state.result;
  if (!started) {
    return (
      <div className="card info-card" data-testid="lesson-assessment" data-state="idle">
        <h3 style={{ marginTop: 0 }}><Icon name="list" /> 수업 숙련도 평가</h3>
        <p className="video-status-message" style={{ margin: '0 0 6px' }}>이 수업은 아직 숙련도 평가를 하지 않았습니다. 평가하면 결과가 기술 숙련도에 반영됩니다.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStarted(true)} data-testid="lesson-assessment-start">
          이 수업 숙련도 평가하기
        </button>
      </div>
    );
  }
  if (!state.busy && !r && !state.error) return null; // nothing to rate (no technique in this lesson)
  return (
    <div className="card info-card" data-testid="lesson-assessment" data-state={state.busy ? 'busy' : r ? 'done' : 'error'} data-method={r?.method ?? ''}>
      <h3 style={{ marginTop: 0 }}><Icon name="list" /> 오늘 수업 숙련도 평가</h3>
      {state.busy && (
        <p className="video-status-message" data-testid="lesson-assessment-busy">
          <span className="spinner" /> AI 코치가 오늘 수업 기록으로 기술 이해도와 숙련도를 판단하는 중입니다…
        </p>
      )}
      {state.error && <div className="ai-inline-warning">평가하지 못했습니다: {state.error}</div>}
      {r && (
        <>
          <p className="video-status-message" style={{ margin: '0 0 6px' }}>
            {r.method === 'ai' ? 'AI 코치가 오늘 수업의 답변·실습 기록을 보고 매겼습니다.' : r.note} 매긴 숙련도는 각 기술의 숙련도에 반영했습니다. 몸의 동작을 측정한 결과는 아닙니다 (카메라 자세 분석이나 직접 정한 숙련도가 있으면 그것이 우선입니다).
          </p>
          {r.items.map((it) => (
            <div key={it.techniqueId} className="technique-row" data-testid="lesson-assessment-item" data-technique-id={it.techniqueId} data-proficiency={it.proficiency} data-understanding={it.understanding}>
              <div className="technique-row__main">
                <div className="technique-row__name">
                  {(() => {
                    const t = resolveTechnique(it.techniqueId);
                    return t ? <Link to={`/arts/${t.martialArt}/techniques/${encodeURIComponent(t.id)}`}>{it.name}</Link> : it.name;
                  })()}
                </div>
                <div className="technique-row__sub">
                  이해도: <strong>{UNDERSTANDING_LABEL[it.understanding]}</strong>
                  {it.understandingScore !== null ? ` (${it.understandingScore}점)` : ''} · 숙련도:{' '}
                  <strong data-testid="lesson-assessment-mastery">
                    <MasteryGlyph status={it.proficiency} /> {MASTERY_LABEL[it.proficiency]}
                  </strong>
                </div>
                <div style={{ margin: '2px 0' }}>{it.reason}</div>
                {it.capped && <div className="technique-row__sub" data-testid="lesson-assessment-capped">{it.capped}</div>}
                {it.evidence.length > 0 && (
                  <details>
                    <summary className="technique-row__sub">판단 근거</summary>
                    <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                      {it.evidence.map((e) => (
                        <li key={e} className="technique-row__sub">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNonce((n) => n + 1)} data-testid="lesson-assessment-retry">
            다시 평가
          </button>
        </>
      )}
    </div>
  );
}
