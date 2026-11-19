import type { Technique } from '../../types';
import hierarchyData from '../../../data/curated/category-hierarchy.json';
import { getUnifiedTechniquesByMartialArt } from '../userTechniques/service';
import { techniqueCategoryInArt } from '../techniqueCanonical';
import { purposeTagsOf } from '../techniqueTaxonomy';
import { POSITION_TAXONOMY, type PositionTaxonomyConfig } from './config';

// 포지션 중심 카테고리 — see config.ts. getPositionTree(art) places every technique the art page shows:
//   position evidence  technique.category, technique.positions (encyclopedia sections), the curated hierarchy's
//                      sub-heading (e.g. 탈출 기술 모음 → 마운트), or the position named in the technique's own name
//   purpose evidence   the existing classifier's HIGH/MEDIUM purpose tags, else the purpose its category implies
// Several positions per technique are kept (a kimura is used from guard, side control and north-south). Techniques
// with no position evidence are listed in `review`; a position without purpose evidence goes to its "_other" bucket.

export const OTHER = '_other';
/** Entries that only keep techniques no specific position claimed. */
const FALLBACK = new Set(['ground-other', 'submission-chains', 'guard-passing']);

export interface PurposeBucket {
  id: string;
  ko: string;
  en: string;
  techniqueIds: string[];
}
export interface PositionNode {
  id: string;
  ko: string;
  en: string;
  /** distinct techniques in this position */
  count: number;
  purposes: PurposeBucket[];
}
export interface Placement {
  position: string;
  purpose: string;
  /** where the evidence came from (shown in review / tests) */
  basis: string;
}
export interface ReviewEntry {
  techniqueId: string;
  name: string;
  category: string;
  reason: string;
}
export interface PositionTree {
  art: string;
  positions: PositionNode[];
  placements: Map<string, Placement[]>;
  review: ReviewEntry[];
  stats: { techniques: number; placed: number; review: number; multiPosition: number; placements: number; positions: number; purposeBuckets: number; noPurpose: number };
}

const hierarchy = hierarchyData as unknown as { arts: Record<string, { category: string; subcategories: { title: string; techniqueIds: string[] }[] }[]> };
const subheadings = new Map<string, Map<string, string[]>>();
function subheadingsOf(art: string): Map<string, string[]> {
  let m = subheadings.get(art);
  if (m) return m;
  m = new Map();
  for (const sec of hierarchy.arts[art] ?? []) for (const sub of sec.subcategories) for (const id of sub.techniqueIds) m.set(id, [...(m.get(id) ?? []), `${sec.category} :: ${sub.title}`]);
  subheadings.set(art, m);
  return m;
}

export function hasPositionTaxonomy(art: string): boolean {
  return !!POSITION_TAXONOMY[art];
}

function place(t: Technique, art: string, cfg: PositionTaxonomyConfig): { placements: Placement[]; sources: string[] } {
  const category = techniqueCategoryInArt(t, art);
  const sources = [...new Set([category, ...(t.positions ?? []), ...(subheadingsOf(art).get(t.id) ?? [])])];
  const names = [t.name, t.koreanName ?? '', ...(t.aliases ?? [])].filter(Boolean);
  const positions: { id: string; basis: string }[] = [];
  for (const p of cfg.positions) {
    const src = sources.find((s) => p.sources.test(s));
    if (src) positions.push({ id: p.id, basis: `섹션: ${src}` });
    else if (p.names) {
      const n = names.find((x) => p.names!.test(x));
      if (n) positions.push({ id: p.id, basis: `이름: ${n}` });
    }
  }
  // catch-all entries ("…공통", "…미지정") only hold techniques that no specific position claimed
  const specific = positions.filter((p) => !FALLBACK.has(p.id));
  if (specific.length) positions.splice(0, positions.length, ...specific);
  const purposes = new Map<string, string>();
  const tags = purposeTagsOf(t.id, art);
  for (const u of cfg.purposes) {
    const e = tags.find((x) => u.dims.includes(x.dim));
    if (e) purposes.set(u.id, `분류기(${e.confidence}): ${e.dim}`);
  }
  if (purposes.size === 0)
    for (const [re, purpose] of cfg.categoryPurpose) {
      const src = sources.find((s) => re.test(s));
      if (src && !purposes.has(purpose)) purposes.set(purpose, `섹션: ${src}`);
    }
  const out: Placement[] = [];
  for (const p of positions) {
    if (purposes.size === 0) out.push({ position: p.id, purpose: OTHER, basis: `${p.basis} · 목적 근거 없음` });
    for (const [u, why] of purposes) {
      const q = cfg.purposeIn ? cfg.purposeIn(p.id, u) : u;
      if (!out.some((x) => x.position === p.id && x.purpose === q)) out.push({ position: p.id, purpose: q, basis: `${p.basis} · ${why}` });
    }
  }
  return { placements: out, sources };
}

const cache = new Map<string, { key: string; tree: PositionTree }>();

export function getPositionTree(art: string, techniques: Technique[] = getUnifiedTechniquesByMartialArt(art)): PositionTree | null {
  const cfg = POSITION_TAXONOMY[art];
  if (!cfg) return null;
  const key = `${techniques.length}:${techniques[0]?.id ?? ''}:${techniques[techniques.length - 1]?.id ?? ''}`;
  const hit = cache.get(art);
  if (hit && hit.key === key) return hit.tree;

  const placements = new Map<string, Placement[]>();
  const review: ReviewEntry[] = [];
  for (const t of techniques) {
    const { placements: ps, sources } = place(t, art, cfg);
    if (ps.length) placements.set(t.id, ps);
    else review.push({ techniqueId: t.id, name: t.koreanName || t.name, category: techniqueCategoryInArt(t, art), reason: `포지션을 나타내는 데이터 없음 (섹션: ${sources.join(' / ')})` });
  }
  const purposeOrder = cfg.purposes.map((u) => u.id);
  const positions: PositionNode[] = [];
  for (const p of cfg.positions) {
    const byPurpose = new Map<string, string[]>();
    const all = new Set<string>();
    for (const [id, ps] of placements)
      for (const x of ps)
        if (x.position === p.id) {
          all.add(id);
          const list = byPurpose.get(x.purpose) ?? byPurpose.set(x.purpose, []).get(x.purpose)!;
          if (!list.includes(id)) list.push(id);
        }
    if (all.size === 0) continue; // never an empty position
    const order = [...p.purposes, ...purposeOrder.filter((u) => !p.purposes.includes(u)), OTHER];
    const purposes: PurposeBucket[] = order
      .filter((u) => byPurpose.get(u)?.length)
      .map((u) => {
        const def = cfg.purposes.find((x) => x.id === u);
        return { id: u, ko: def?.ko ?? '목적 확인 필요', en: def?.en ?? 'Purpose to review', techniqueIds: byPurpose.get(u)! };
      });
    positions.push({ id: p.id, ko: p.ko, en: p.en, count: all.size, purposes });
  }
  const multiPosition = [...placements.values()].filter((ps) => new Set(ps.map((x) => x.position)).size > 1).length;
  const tree: PositionTree = {
    art,
    positions,
    placements,
    review,
    stats: {
      techniques: techniques.length,
      placed: placements.size,
      review: review.length,
      multiPosition,
      placements: [...placements.values()].reduce((a, ps) => a + ps.length, 0),
      positions: positions.length,
      purposeBuckets: positions.reduce((a, p) => a + p.purposes.length, 0),
      noPurpose: [...placements.values()].filter((ps) => ps.every((x) => x.purpose === OTHER)).length,
    },
  };
  cache.set(art, { key, tree });
  return tree;
}

/** Technique ids under a position (and purpose) — for the technique list filter `?pos=…&purpose=…`. */
export function techniqueIdsInPosition(art: string, position: string, purpose?: string | null): Set<string> {
  const tree = getPositionTree(art);
  const out = new Set<string>();
  if (!tree) return out;
  for (const [id, ps] of tree.placements) if (ps.some((x) => x.position === position && (!purpose || x.purpose === purpose))) out.add(id);
  return out;
}

export function reviewIds(art: string): Set<string> {
  return new Set(getPositionTree(art)?.review.map((r) => r.techniqueId) ?? []);
}

export function positionLabel(art: string, position: string, purpose?: string | null): string | null {
  const tree = getPositionTree(art);
  const p = tree?.positions.find((x) => x.id === position);
  if (!p) return null;
  const u = purpose ? p.purposes.find((x) => x.id === purpose) : null;
  return u ? `${p.ko} › ${u.ko}` : p.ko;
}
