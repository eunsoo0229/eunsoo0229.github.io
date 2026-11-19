import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon, { type IconName } from '../Icon';
import { getMartialArt } from '../../lib/loadData';
import { decodeShareCode, ShareCodeError } from '../../lib/curriculum/shareCode';
import { curriculumRepository } from '../../lib/curriculum/repository';
import { ATTACHMENT_LABEL, type MessageAttachment } from '../../lib/social/types';

const ICON: Record<MessageAttachment['kind'], IconName> = {
  post: 'list',
  combo: 'link',
  technique: 'gi',
  curriculum: 'book',
  gear: 'cart',
  gym: 'pin',
  market: 'book',
};

/**
 * A shared item inside a chat bubble. Opening one navigates to the real
 * screen, which re-reads the original through RLS — so a post the sender
 * could see but the reader cannot simply fails to open there. Nothing here
 * grants access; the snapshot is only a label.
 */
export default function AttachmentCard({ attachment }: { attachment: MessageAttachment }) {
  const navigate = useNavigate();
  const [note, setNote] = useState('');

  function importCurriculum() {
    if (attachment.kind !== 'curriculum') return;
    try {
      const { curriculum, removedInvalidIds } = decodeShareCode(attachment.shareCode);
      // A copy, with a fresh id so it never collides with the sender's row.
      const copy = { ...curriculum, id: `shared-${Date.now()}`, visibility: 'private' as const, basedOnCurriculumId: curriculum.id };
      curriculumRepository.saveCustom(copy);
      setNote(removedInvalidIds.length > 0
        ? `가져왔습니다. 이 기기에 없는 기술 ${removedInvalidIds.length}개는 제외했습니다.`
        : '내 커리큘럼으로 가져왔습니다.');
    } catch (e) {
      setNote(e instanceof ShareCodeError ? '공유 코드를 읽을 수 없습니다.' : '가져오지 못했습니다.');
    }
  }

  function open() {
    switch (attachment.kind) {
      case 'post':
        navigate(`/community/post/${attachment.id}`); break;
      case 'combo':
        navigate(`/user-combos/${attachment.id}`); break;
      case 'technique':
        navigate(`/arts/${attachment.martialArt}/techniques/${attachment.id}`); break;
      case 'curriculum':
        importCurriculum(); break;
      case 'gear':
        navigate(`/gear/${attachment.id}`); break;
      case 'gym':
        navigate(`/gyms/${attachment.id}`); break;
      case 'market':
        navigate(`/marketplace/${attachment.id}`); break;
    }
  }

  const sub =
    attachment.kind === 'technique' ? (getMartialArt(attachment.martialArt)?.nameKo ?? attachment.martialArt)
    : attachment.kind === 'combo' ? (attachment.comboKind === 'setup' ? '셋업' : '콤보')
    : attachment.kind === 'curriculum' ? `${attachment.totalDays}일 · 기술 ${attachment.techniqueCount}개`
    : attachment.kind === 'gear' ? `${attachment.price.toLocaleString('ko-KR')}원`
    : attachment.kind === 'gym' ? (attachment.region || '체육관')
    : attachment.kind === 'market' ? `${getMartialArt(attachment.martialArt)?.nameKo ?? attachment.martialArt} · ${attachment.price > 0 ? `${attachment.price.toLocaleString('ko-KR')}원` : '무료'}`
    : '게시물';

  const title = attachment.kind === 'post' || attachment.kind === 'gear' || attachment.kind === 'market' ? attachment.title
    : attachment.kind === 'curriculum' ? attachment.title
    : attachment.name;

  return (
    <div className="attach-card">
      <button type="button" className="attach-card__main" onClick={open}>
        <span className="attach-card__icon"><Icon name={ICON[attachment.kind]} /></span>
        <span className="attach-card__text">
          <span className="attach-card__kind">{ATTACHMENT_LABEL[attachment.kind]}</span>
          <strong className="attach-card__title">{title}</strong>
          <span className="attach-card__sub">{sub}</span>
        </span>
      </button>
      {attachment.kind === 'curriculum' && (
        <span className="attach-card__cta">눌러서 내 커리큘럼으로 가져오기</span>
      )}
      {note && <span className="attach-card__note">{note}</span>}
    </div>
  );
}
