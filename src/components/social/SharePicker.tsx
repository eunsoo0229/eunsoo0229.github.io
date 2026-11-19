import { useMemo, useState } from 'react';
import BottomSheet from '../BottomSheet';
import Icon from '../Icon';
import { searchTechniques } from '../../lib/search';
import { getMartialArt } from '../../lib/loadData';
import { useMyCurricula } from '../../lib/curriculum/useCurriculum';
import { encodeShareCode } from '../../lib/curriculum/shareCode';
import { listSharedCombos } from '../../lib/sharedCombo/service';
import { listFeed } from '../../lib/communityPost/service';
import { ATTACHMENT_LABEL, type MessageAttachment } from '../../lib/social/types';
import type { SharedCombo } from '../../lib/sharedCombo/types';
import type { CommunityFeedItem } from '../../lib/communityPost/types';

type Tab = MessageAttachment['kind'];
const TABS: Tab[] = ['technique', 'combo', 'curriculum', 'post'];

/**
 * Picks something to attach to a chat message. What leaves this sheet is a
 * reference plus a short display snapshot — never the content itself. The
 * one exception is a curriculum, which cannot be referenced by id because
 * `curricula` is own-row-only, so its existing share code travels instead.
 */
export default function SharePicker({
  viewerId,
  onPick,
  onClose,
}: {
  viewerId: string | null;
  onPick: (a: MessageAttachment) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('technique');
  const [q, setQ] = useState('');
  const [combos, setCombos] = useState<SharedCombo[] | null>(null);
  const [posts, setPosts] = useState<CommunityFeedItem[] | null>(null);
  const myCurricula = useMyCurricula();

  const techniques = useMemo(() => (q.trim() ? searchTechniques(q, 20) : searchTechniques('', 20)), [q]);

  function load(next: Tab) {
    setTab(next);
    if (next === 'combo' && combos === null) {
      void listSharedCombos(viewerId).then((r) => setCombos(r.ok ? r.data : []));
    }
    if (next === 'post' && posts === null) {
      void listFeed(viewerId, { authorId: viewerId ?? undefined, limit: 20 }).then((r) => setPosts(r.ok ? r.data.items : []));
    }
  }

  const filter = q.trim().toLowerCase();

  return (
    <BottomSheet onClose={onClose}>
      <h3 style={{ marginTop: 0 }}><Icon name="link" /> 공유할 항목 선택</h3>
      <div className="chip-row">
        {TABS.map((t) => (
          <button key={t} type="button" className={`chip${tab === t ? ' active' : ''}`} onClick={() => load(t)}>
            {ATTACHMENT_LABEL[t]}
          </button>
        ))}
      </div>
      <input className="field-full" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '10px 0' }} />

      <div className="share-picker__list">
        {tab === 'technique' && techniques.map((t) => (
          <button key={t.id} type="button" className="technique-row" onClick={() => onPick({ kind: 'technique', id: t.id, name: t.name, martialArt: t.martialArt })}>
            <div className="technique-row__main">
              <div className="technique-row__name">{t.koreanName || t.name}</div>
              <div className="technique-row__sub">{getMartialArt(t.martialArt)?.nameKo ?? t.martialArt}</div>
            </div>
          </button>
        ))}

        {tab === 'combo' && (combos === null ? <p className="video-status-message">불러오는 중…</p>
          : combos.filter((c) => !filter || c.name.toLowerCase().includes(filter)).map((c) => (
            <button key={c.id} type="button" className="technique-row" onClick={() => onPick({ kind: 'combo', id: c.id, name: c.name, comboKind: c.kind, martialArt: c.martialArt })}>
              <div className="technique-row__main">
                <div className="technique-row__name">{c.name}</div>
                <div className="technique-row__sub">{c.kind === 'setup' ? '셋업' : '콤보'} · {c.purpose}</div>
              </div>
            </button>
          )))}

        {tab === 'curriculum' && myCurricula
          .filter((c) => !filter || c.title.toLowerCase().includes(filter))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              className="technique-row"
              onClick={() => onPick({
                kind: 'curriculum',
                title: c.title,
                martialArt: c.martialArt,
                totalDays: c.totalDays,
                techniqueCount: c.techniqueCount,
                shareCode: encodeShareCode(c),
              })}
            >
              <div className="technique-row__main">
                <div className="technique-row__name">{c.title}</div>
                <div className="technique-row__sub">{c.totalDays}일 · 기술 {c.techniqueCount}개</div>
              </div>
            </button>
          ))}

        {tab === 'post' && (posts === null ? <p className="video-status-message">불러오는 중…</p>
          : posts.length === 0 ? <p className="video-status-message">공유할 내 게시물이 없습니다.</p>
          : posts.map((item) => {
            if (item.kind !== 'post') return null;
            const title = item.post.content.slice(0, 60) || '(사진/영상 게시물)';
            return (
              <button key={item.post.id} type="button" className="technique-row" onClick={() => onPick({ kind: 'post', id: item.post.id, title })}>
                <div className="technique-row__main">
                  <div className="technique-row__name">{title}</div>
                  <div className="technique-row__sub">
                    {item.post.visibility === 'public' ? '전체 공개' : item.post.visibility === 'followers' ? '팔로워 공개' : '비공개'}
                  </div>
                </div>
              </button>
            );
          }))}
      </div>

      {tab === 'curriculum' && (
        <p className="technique-row__sub" style={{ marginTop: 8 }}>
          커리큘럼은 공유 코드로 전달됩니다 — 받는 사람이 자기 커리큘럼으로 복사해 사용합니다.
        </p>
      )}
      {tab === 'post' && (
        <p className="technique-row__sub" style={{ marginTop: 8 }}>
          비공개·팔로워 공개 게시물은 공유해도 볼 권한이 없는 상대에게는 열리지 않습니다.
        </p>
      )}
    </BottomSheet>
  );
}
