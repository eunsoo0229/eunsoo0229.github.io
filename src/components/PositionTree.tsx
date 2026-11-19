import Icon from './Icon';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Technique } from '../types';
import { OTHER, type PositionTree as Tree } from '../lib/positionTaxonomy';

// 포지션별 카테고리 (BJJ · MMA): position → purpose → technique list. Positions are the top level; opening one shows
// the purposes that actually have techniques there (never an empty bucket). Every bucket links to the technique list
// filtered to it. The search box searches ALL of the art's techniques (not only the open position) and shows where
// each match sits. Techniques with no position evidence are listed in 미분류 검토, with the reason.

const href = (art: string, pos: string, purpose?: string) => `/arts/${art}/techniques?pos=${encodeURIComponent(pos)}${purpose ? `&purpose=${encodeURIComponent(purpose)}` : ''}`;

export default function PositionTree({ tree, techniques }: { tree: Tree; techniques: Technique[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const allOpen = tree.positions.every((p) => open.has(p.id));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const label = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of tree.positions) {
      m.set(p.id, p.ko);
      for (const u of p.purposes) m.set(`${p.id}/${u.id}`, `${p.ko} › ${u.ko}`);
    }
    return m;
  }, [tree]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return techniques
      .filter((t) => [t.name, t.koreanName ?? '', ...(t.aliases ?? [])].some((n) => n.toLowerCase().includes(s)))
      .slice(0, 20)
      .map((t) => ({ t, where: (tree.placements.get(t.id) ?? []).map((x) => label.get(`${x.position}/${x.purpose}`) ?? label.get(x.position) ?? x.position) }));
  }, [q, techniques, tree, label]);
  const s = tree.stats;

  return (
    <div className="position-tree" data-testid="position-tree">
      <p className="video-status-message" data-testid="position-tree-stats">
        포지션 {s.positions}개 · 기술 {s.techniques}개 (여러 포지션에서 쓰이는 기술 {s.multiPosition}개) · 미분류 검토 {s.review}개
      </p>
      <div className="position-tree__tools">
        <input
          className="select filter-text-input position-tree__search"
          type="search"
          placeholder="이 무술의 전체 기술에서 검색 (포지션과 관계없이)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="position-search"
          aria-label="전체 기술 검색"
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(allOpen ? new Set() : new Set(tree.positions.map((p) => p.id)))} data-testid="position-expand-all">
          {allOpen ? '모두 접기' : '모든 포지션 펼치기'}
        </button>
      </div>
      {q.trim().length >= 2 && (
        <div className="card position-tree__results" data-testid="position-search-results">
          {matches.length === 0 ? (
            <p className="video-status-message">검색 결과가 없습니다.</p>
          ) : (
            <ul>
              {matches.map(({ t, where }) => (
                <li key={t.id}>
                  <Link to={`/arts/${tree.art}/techniques/${t.id}`} data-testid="position-search-hit">
                    {t.koreanName || t.name}
                  </Link>{' '}
                  <span className="video-status-message">{where.length ? where.join(' · ') : '미분류 검토'}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/arts/${tree.art}/techniques?q=${encodeURIComponent(q.trim())}`} className="see-all">
            전체 기술 목록에서 검색 →
          </Link>
        </div>
      )}
      <div className="position-tree__grid">
        {tree.positions.map((p) => {
          const expanded = open.has(p.id);
          return (
            <div key={p.id} className="card position-card" data-testid="position-card" data-position={p.id} data-expanded={expanded ? 'true' : 'false'}>
              <div className="position-card__head">
                <Link to={href(tree.art, p.id)} className="position-card__name">
                  {p.ko} <span className="taxonomy-count">({p.count})</span>
                </Link>
                <button type="button" className="taxonomy-toggle" aria-expanded={expanded} aria-label={`${p.ko} 목적별 분류 ${expanded ? '접기' : '펼치기'}`} onClick={() => toggle(p.id)} data-testid="position-toggle">
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} /> {p.purposes.length}
                </button>
              </div>
              {expanded && (
                <ul className="position-card__purposes" data-testid="position-purposes">
                  {p.purposes.map((u) => (
                    <li key={u.id}>
                      <Link to={href(tree.art, p.id, u.id)} className={`chip chip--sm${u.id === OTHER ? ' taxonomy-other' : ''}`} data-testid="position-purpose" data-purpose={u.id}>
                        {u.ko} ({u.techniqueIds.length})
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {tree.review.length > 0 && (
        <details className="card position-tree__review" data-testid="position-review">
          <summary>
            미분류 검토 ({tree.review.length}) — 포지션을 나타내는 데이터가 없는 기술 (숨기지 않음)
          </summary>
          <ul>
            {tree.review.map((r) => (
              <li key={r.techniqueId}>
                <Link to={`/arts/${tree.art}/techniques/${r.techniqueId}`}>{r.name}</Link> <span className="video-status-message">기존 카테고리: {r.category}</span>
              </li>
            ))}
          </ul>
          <Link to={href(tree.art, '_review')} className="see-all">
            목록으로 보기 →
          </Link>
        </details>
      )}
    </div>
  );
}
