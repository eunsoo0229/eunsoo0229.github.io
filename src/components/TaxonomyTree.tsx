import Icon from './Icon';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArtTaxonomy, TaxonomyNode } from '../lib/techniqueTaxonomy';

// 계층형 카테고리 — the art page's category list: Level-2 groups by section, each with its real (distinct) technique
// count, expandable into Level-3 / Level-4 children. Every entry links to the technique list filtered to that node.

function nodeHref(n: TaxonomyNode): string {
  return `/arts/${n.art}/techniques?node=${encodeURIComponent(n.id)}`;
}

function Children({ tax, ids, depth }: { tax: ArtTaxonomy; ids: string[]; depth: number }) {
  return (
    <ul className={`taxonomy-children taxonomy-children--d${depth}`}>
      {ids.map((id) => {
        const n = tax.nodes.get(id)!;
        return (
          <li key={id}>
            <Link to={nodeHref(n)} className={`chip chip--sm${n.kind === 'other' ? ' taxonomy-other' : ''}`} data-testid="taxonomy-node" data-node={id}>
              {n.ko} ({n.count})
            </Link>
            {n.children.length > 0 && <Children tax={tax} ids={n.children} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

export default function TaxonomyTree({ tax }: { tax: ArtTaxonomy }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allOpen = tax.roots.filter((r) => tax.nodes.get(r)!.children.length > 0).every((r) => open.has(r));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="taxonomy-tree" data-testid="taxonomy-tree">
      <div className="taxonomy-tree__tools">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(allOpen ? new Set() : new Set(tax.roots))}>
          {allOpen ? '모두 접기' : '하위 분류 모두 펼치기'}
        </button>
      </div>
      {tax.sections.map((section) => {
        const roots = tax.roots.filter((r) => tax.nodes.get(r)!.section === section.id);
        if (roots.length === 0) return null;
        return (
          <div key={section.id} className="taxonomy-section">
            <h3 className="taxonomy-section__title">{section.ko}</h3>
            <div className="taxonomy-groups">
              {roots.map((id) => {
                const n = tax.nodes.get(id)!;
                const expanded = open.has(id);
                return (
                  <div key={id} className="taxonomy-group card" data-testid="taxonomy-group" data-node={id}>
                    <div className="taxonomy-group__head">
                      <Link to={nodeHref(n)} className="taxonomy-group__name">
                        {n.ko} <span className="taxonomy-count">({n.count})</span>
                      </Link>
                      {n.children.length > 0 && (
                        <button type="button" className="taxonomy-toggle" aria-expanded={expanded} aria-label={`${n.ko} 하위 분류 ${expanded ? '접기' : '펼치기'}`} onClick={() => toggle(id)} data-testid="taxonomy-toggle">
                          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} /> {n.children.length}
                        </button>
                      )}
                    </div>
                    {expanded && <Children tax={tax} ids={n.children} depth={3} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
