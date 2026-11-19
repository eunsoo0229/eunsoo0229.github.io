import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import BottomSheet from '../BottomSheet';
import EvaluationPanel from './EvaluationPanel';
import { CRITERIA, reliabilityOf } from '../../lib/techniqueEvaluation/criteria';
import { getStats, invalidateEvaluation, isEvaluationOpen, loadEvaluation, type EvaluationStats, type TechniqueEvaluation } from '../../lib/techniqueEvaluation/service';

const CHANGED = 'mx-evaluation-changed';

/** Tell every mounted card / detail / short showing `postId` to re-read its evaluation. */
export function announceEvaluationChanged(postId: string): void {
  invalidateEvaluation(postId);
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: postId }));
}

/** The evaluation attached to a post (batched lookup; null when the post has none). */
export function usePostEvaluation(postId: string): TechniqueEvaluation | null {
  const [ev, setEv] = useState<TechniqueEvaluation | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === postId) setRev((n) => n + 1);
    };
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [postId]);
  useEffect(() => {
    let alive = true;
    void loadEvaluation(postId).then((e) => alive && setEv(e));
    return () => {
      alive = false;
    };
  }, [postId, rev]);
  return ev;
}

/** 피드 카드용 요약: 참여자 수 · 신뢰도 · 항목 평균 미니 막대 + 평가 열기 */
export function EvaluationPreview({ evaluation, onOpen, dark = false }: { evaluation: TechniqueEvaluation; onOpen: () => void; dark?: boolean }) {
  const [stats, setStats] = useState<EvaluationStats | null>(null);
  useEffect(() => {
    let alive = true;
    void getStats(evaluation.postId).then((r) => alive && r.ok && setStats(r.data));
    return () => {
      alive = false;
    };
  }, [evaluation.postId]);
  const n = stats?.participants ?? 0;
  const rel = reliabilityOf(n);
  const top = evaluation.criteria.slice(0, 3);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="eco-card"
      style={{ width: '100%', textAlign: 'left', padding: 10, marginTop: 8, cursor: 'pointer', ...(dark ? { background: 'rgba(0,0,0,0.45)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' } : {}) }}
      data-testid="eval-preview"
    >
      <div className="eco-row eco-row--between">
        <strong style={{ fontSize: 14 }}><Icon name="chart" /> 기술 평가 · {evaluation.techniqueName}</strong>
        <span className="eco-pill" style={dark ? { background: 'rgba(255,255,255,0.15)', color: '#fff' } : undefined}>{isEvaluationOpen(evaluation) ? '투표 중' : '종료'} · {n}명 · {rel.label}</span>
      </div>
      {stats && !stats.hidden && n > 0 ? (
        <div className="eco-bars" style={{ marginTop: 6 }}>
          {top.map((k) => {
            const s = stats.overall?.[k];
            return (
              <div key={k} className="eco-bar">
                <span className="eco-bar__label" style={dark ? { color: '#ddd' } : undefined}>{CRITERIA[k].label}</span>
                <span className="eco-bar__track">{s && <span className="eco-bar__fill" style={{ width: `${Number(s.avg)}%` }} />}</span>
                <span className="eco-bar__value">{s ? `${Number(s.avg)}%` : '—'}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="eco-meta" style={{ marginTop: 4, ...(dark ? { color: '#ddd' } : {}) }}>{stats?.hidden ? '결과 비공개' : '아직 평가가 없습니다. 눌러서 평가하기'}</div>
      )}
    </button>
  );
}

/** 숏폼·카드에서 여는 평가 시트 */
export function EvaluationSheet({ evaluation, onClose }: { evaluation: TechniqueEvaluation; onClose: () => void }) {
  return createPortal(
    <BottomSheet onClose={onClose} className="eval-sheet">
      <div style={{ maxHeight: '78vh', overflowY: 'auto' }}>
        <EvaluationPanel evaluation={evaluation} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>닫기</button>
      </div>
    </BottomSheet>,
    document.body,
  );
}
