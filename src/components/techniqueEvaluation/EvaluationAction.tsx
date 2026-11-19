import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import BottomSheet from '../BottomSheet';
import EvaluationSettings, { emptyEvaluationDraft, type EvaluationDraft } from './EvaluationSettings';
import { EvaluationSheet, announceEvaluationChanged } from './EvaluationPreview';
import { createEvaluation, type TechniqueEvaluation } from '../../lib/techniqueEvaluation/service';
import { EVAL_ARTS, templateFor } from '../../lib/techniqueEvaluation/criteria';
import type { PostTag } from '../../lib/communityPost/types';

/** 이미 올린 내 게시물·숏폼에 기술 평가를 연다(작성 화면의 "기술 평가 받기"와 같은 설정). */
function EvaluationStartSheet({ postId, authorId, tags, onClose }: { postId: string; authorId: string; tags: PostTag[]; onClose: () => void }) {
  const [draft, setDraft] = useState<EvaluationDraft>(() => {
    const base = emptyEvaluationDraft();
    const t = tags.find((x) => x.type === 'technique') ?? tags[0];
    const art = t?.martialArt && EVAL_ARTS.some((a) => a.id === t.martialArt) ? t.martialArt : base.martialArt;
    return { ...base, enabled: true, martialArt: art, criteria: templateFor(art), techniqueName: t?.name ?? '', techniqueId: t?.type === 'technique' ? t.id : null };
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function start() {
    setBusy(true);
    setErr('');
    const r = await createEvaluation(postId, authorId, draft);
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    announceEvaluationChanged(postId);
    onClose();
  }

  return createPortal(
    <BottomSheet onClose={onClose} className="eval-sheet">
      <h3 style={{ marginTop: 0 }}><Icon name="chart" /> 이 영상으로 기술 평가 받기</h3>
      <div style={{ maxHeight: '64vh', overflowY: 'auto' }}>
        <EvaluationSettings value={draft} onChange={(v) => setDraft({ ...v, enabled: true })} />
      </div>
      {err && <p className="video-status-message" role="alert">{err}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn btn-primary" disabled={busy || !draft.enabled} onClick={() => void start()} data-testid="eval-start-submit">
          {busy ? '여는 중…' : '평가 열기'}
        </button>
      </div>
    </BottomSheet>,
    document.body,
  );
}

function EvaluationClosedInfo({ onClose }: { onClose: () => void }) {
  return createPortal(
    <BottomSheet onClose={onClose}>
      <h3 style={{ marginTop: 0 }}><Icon name="chart" /> 기술 평가</h3>
      <p>작성자가 이 영상에 기술 평가를 열지 않았습니다.</p>
      <p className="technique-row__sub">기술 평가는 영상 주인이 허락한 게시물에서만 받을 수 있습니다. 좋아요·댓글로 의견을 남겨 주세요.</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>확인</button>
      </div>
    </BottomSheet>,
    document.body,
  );
}

/**
 * 게시물 카드 액션 줄 / 숏폼 레일의 "평가" 버튼.
 *   - 평가가 열린 게시물 → 평가 시트(투표·결과)
 *   - 평가가 없는 내 영상 게시물 → 지금 평가 열기
 *   - 평가가 없는 남의 영상 게시물 → 작성자가 열지 않았다는 안내 (동의 없는 평가는 받지 않는다)
 * 영상도 평가도 없는 글에는 나타나지 않는다.
 */
export default function EvaluationAction({
  postId,
  authorId,
  currentUserId,
  hasVideo,
  tags,
  evaluation,
  variant,
}: {
  postId: string;
  authorId: string;
  currentUserId: string | null;
  hasVideo: boolean;
  tags: PostTag[];
  evaluation: TechniqueEvaluation | null;
  variant: 'action' | 'rail';
}) {
  const [open, setOpen] = useState<null | 'vote' | 'start' | 'info'>(null);
  if (!evaluation && !hasVideo) return null;
  const isOwn = !!currentUserId && currentUserId === authorId;
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(evaluation ? 'vote' : isOwn ? 'start' : 'info');
  };
  const label = evaluation ? '평가' : isOwn ? '평가 열기' : '평가';
  return (
    <>
      <button
        type="button"
        className={`${variant === 'rail' ? 'short__act' : 'community-post-card__action-btn'}${evaluation ? ' is-eval-open' : ''}`}
        onClick={click}
        aria-label={evaluation ? `기술 평가 · ${evaluation.techniqueName}` : label}
        data-testid={variant === 'rail' ? 'short-evaluate' : 'post-evaluate'}
      >
        <Icon name="chart" />
        {variant === 'rail' ? <small>{label}</small> : <span>{label}</span>}
      </button>
      {open === 'vote' && evaluation && <EvaluationSheet evaluation={evaluation} onClose={() => setOpen(null)} />}
      {open === 'start' && currentUserId && <EvaluationStartSheet postId={postId} authorId={currentUserId} tags={tags} onClose={() => setOpen(null)} />}
      {open === 'info' && <EvaluationClosedInfo onClose={() => setOpen(null)} />}
    </>
  );
}
