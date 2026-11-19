import Icon from '../Icon';
import { useMemo, useState } from 'react';
import { useSharedCombos, sharedMittId, sharedToMitt } from '../../lib/visualMitt/sharedMitt';
import { hasAuthorText, sharedComboText } from '../../lib/visualMitt/mittSourcing';
import { getMartialArt } from '../../lib/loadData';
import { useAuth } from '../../lib/auth/AuthProvider';

/**
 * 사용자 콤보·셋업 — combos/setups MARTIALDEX users shared, loaded into the
 * mitt. Ones whose steps are all drawable play as written; ones with a written
 * description are first read by the AI (it splits the text into mitt steps)
 * and the user picks the AI steps or the original.
 */
export default function SharedComboTab({ art, onPick }: { art: string; onPick: (id: string) => void }) {
  const { user } = useAuth();
  const { list, loading, error, reload } = useSharedCombos(user?.id ?? null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'combo' | 'setup'>('all');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      list
        .filter((c) => !art || c.martialArt === art || c.steps.some((s) => s.martialArt === art))
        .filter((c) => kind === 'all' || c.kind === kind)
        .filter((c) => !q || `${c.name} ${c.purpose} ${c.description} ${c.authorNickname} ${c.steps.map((s) => s.name).join(' ')}`.toLowerCase().includes(q))
        .map((c) => ({ c, playable: sharedToMitt(c), ai: hasAuthorText(sharedComboText(c)) }))
        .filter((x) => x.playable || x.ai)
        .sort((a, b) => b.c.likeCount - a.c.likeCount || b.c.createdAt.localeCompare(a.c.createdAt)),
    [list, art, kind, q],
  );
  return (
    <div className="card info-card" data-testid="mitt-shared" data-count={shown.length} data-state={loading ? 'loading' : error ? 'error' : 'ready'}>
      <p className="video-status-message" style={{ marginTop: 0 }}>
        MARTIALDEX 사용자들이 공유한 콤보·셋업을 미트로 연습합니다{art ? ` (${getMartialArt(art)?.nameKo ?? art})` : ''}. 설명이 있는 콤보·셋업은 AI가 설명을 읽고 미트 단계로 정리한 뒤, AI 단계와 원래 단계 중에서 고를 수 있습니다.
      </p>
      <div className="chip-row">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·목적·기술 검색" data-testid="mitt-shared-search" style={{ flex: 1, minWidth: 160 }} />
        {(['all', 'combo', 'setup'] as const).map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)} data-testid={`mitt-shared-kind-${k}`}>
            {k === 'all' ? '전체' : k === 'combo' ? '콤보' : '셋업'}
          </button>
        ))}
      </div>
      {loading && !list.length && <p className="video-status-message">사용자 콤보·셋업을 불러오는 중입니다…</p>}
      {error && (
        <div className="ai-inline-warning">
          사용자 콤보·셋업을 불러오지 못했습니다: {error}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}
      {!loading && !error && !shown.length && <p className="video-status-message" data-testid="mitt-shared-empty">조건에 맞는 공유 콤보·셋업이 없습니다.</p>}
      {shown.slice(0, 80).map(({ c, playable, ai }) => (
        <div key={c.id} className="technique-row" data-testid="mitt-shared-option" data-shared-id={c.id} data-playable={playable ? 'yes' : 'no'}>
          <div className="technique-row__main">
            <div className="technique-row__name">
              <span className="chip">{c.kind === 'setup' ? '셋업' : '콤보'}</span> {c.name}
            </div>
            <div className="technique-row__sub">
              by {c.authorNickname || '익명'} · <Icon name="heart-filled" label="하트" />{c.likeCount}
              {c.purpose ? ` · ${c.purpose}` : ''}
            </div>
            <div className="technique-row__sub">{c.steps.map((s) => s.name).join(' → ')}</div>
            {!playable && <div className="technique-row__sub">일부 단계는 미트로 바로 그릴 수 없어 AI가 설명을 읽고 단계를 정리합니다.</div>}
          </div>
          <div className="technique-row__right">
            <button className="btn btn-primary btn-sm" onClick={() => onPick(sharedMittId(c.id))} disabled={!playable && !ai} data-testid="mitt-shared-start">
              연습
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
