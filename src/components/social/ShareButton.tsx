import { useState } from 'react';
import PaperPlane from '../icons/PaperPlane';
import ShareSheet from './ShareSheet';
import type { MessageAttachment } from '../../lib/social/types';

/**
 * 종이비행기 공유 버튼. `attachment` 는 누를 때 만든다(목록·카드에서 미리 만들 필요 없음).
 *   variant 'action' — 게시물 카드 액션 줄 / 'rail' — 숏폼 오른쪽 레일 / 'button' — 상세 화면 헤더 버튼
 */
export default function ShareButton({
  attachment,
  variant = 'button',
  className = '',
}: {
  attachment: () => MessageAttachment | null;
  variant?: 'action' | 'rail' | 'button';
  className?: string;
}) {
  const [open, setOpen] = useState<MessageAttachment | null>(null);
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = attachment();
    if (a) setOpen(a);
  };
  const cls =
    variant === 'action' ? 'community-post-card__action-btn'
    : variant === 'rail' ? 'short__act'
    : 'btn btn-secondary btn-sm';
  return (
    <>
      <button type="button" className={`${cls} mx-share-btn ${className}`.trim()} onClick={click} aria-label="공유" data-testid="share-button">
        <PaperPlane />
        {variant === 'rail' ? <small>공유</small> : variant === 'button' ? ' 공유' : null}
      </button>
      {open && <ShareSheet attachment={open} onClose={() => setOpen(null)} />}
    </>
  );
}
