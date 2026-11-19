import type { Technique } from '../../types';
import { getUnifiedMartialArt, getUnifiedTechniquesByMartialArt, resolveTechnique } from '../userTechniques/service';
import { techniqueCategoryInArt } from '../techniqueCanonical';
import { TAXONOMY_CONFIG, type GroupDef } from './config';
import { DIMENSION_BY_ID } from './dimensions';
import { classifyDimensions, techniqueTexts, type Confidence, type DimEvidence } from './classify';

// 계층형 기술 분류 — computed from each art's EXISTING category strings (config.ts) plus data-based classification
// (classify.ts). Nothing in the technique data changes: ids, categories, videos, posture, relations stay as they are,
// and `?category=<string>` filters keep working. Every technique of an art sits in exactly one Level-2 group (its
// category's group) and in any number of Level-3/4 children it has HIGH/MEDIUM evidence for; parent counts are
// distinct techniques (never a sum of children). LOW evidence is never assigned — it is reported for review.
//   L1 art → L2 group (main position / technique area) → L3 member category, purpose or technique type → L4 family

export type NodeKind = 'group' | 'member' | 'split' | 'other' | 'custom';

/**
 * Extension point for categories created by users / admins (stored elsewhere): extra Level-3/4 nodes hung under an
 * EXISTING node. A brand-new top-level category is expressed by the technique's own category string instead (that
 * creates a Level-2 group automatically), so every technique still belongs to exactly one group.
 */
export interface TaxonomyExtensionNode {
  /** Unique, e.g. "bjj/half-guard/custom-<uuid>" */
  id: string;
  parentId: string;
  ko: string;
  en: string;
  techniqueIds: string[];
}
type TaxonomyExtension = (art: string) => TaxonomyExtensionNode[];
const extensions: TaxonomyExtension[] = [];

/** Adds a provider of extra nodes; returns an unregister function. Call invalidateTaxonomy() when its data changes. */
export function registerTaxonomyExtension(fn: TaxonomyExtension): () => void {
  extensions.push(fn);
  invalidateTaxonomy();
  return () => {
    const i = extensions.indexOf(fn);
    if (i >= 0) extensions.splice(i, 1);
    invalidateTaxonomy();
  };
}

/** Drops every memoized taxonomy (after extension data changes). */
export function invalidateTaxonomy(): void {
  cache.clear();
}

export interface TaxonomyNode {
  id: string;
  art: string;
  level: 2 | 3 | 4;
  kind: NodeKind;
  parentId: string | null;
  /** short label shown inside the tree ("스윕") */
  ko: string;
  en: string;
  /** full label for search, breadcrumbs and the AI coach ("하프 가드 스윕") */
  fullKo: string;
  fullEn: string;
  section: string;
  /** member nodes: the existing category string they stand for */
  category?: string;
  /** split nodes: the dimension id */
  dim?: string;
  children: string[];
  /** distinct techniques under this node, children included */
  count: number;
}

export interface Assignment {
  nodeId: string;
  confidence: Confidence | 'CATEGORY';
  basis: string;
}

export interface ReviewItem {
  techniqueId: string;
  name: string;
  art: string;
  groupId: string;
  reason: string;
  candidates: DimEvidence[];
}

export interface ArtTaxonomy {
  art: string;
  sections: { id: string; ko: string; en: string }[];
  nodes: Map<string, TaxonomyNode>;
  roots: string[];
  nodeTechniques: Map<string, Set<string>>;
  techniqueAssignments: Map<string, Assignment[]>;
  /** purpose / family tags per technique (HIGH/MEDIUM), for cross-cutting filters and search */
  techniqueTags: Map<string, DimEvidence[]>;
  review: ReviewItem[];
  /** existing category string → the node that holds it */
  categoryNode: Map<string, string>;
}

const MIN_GROUP_FOR_SPLIT = 6;
const MIN_SPLIT_CHILD = 2;
const MIN_PARENT_FOR_L4 = 8;

/** "딥 하프 가드 (Deep Half Guard)" → ko/en; "발기술 --- Ashi Waza" → ko/en. */
export function parseCategoryLabel(category: string): { ko: string; en: string } {
  const dash = category.split(/\s+---\s+/);
  if (dash.length > 1) return { ko: dash[0].trim(), en: dash.slice(1).join(' ').trim() };
  // only a TRAILING "(English)" is a translation — "기(Gi)에서 특히 중요한 기술" keeps its wording
  const paren = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(category);
  if (paren && paren[1].trim() && /[a-z]/i.test(paren[2])) return { ko: paren[1].trim(), en: paren[2].trim() };
  return { ko: category.trim(), en: category.trim() };
}
function slug(s: string, fallback: string): string {
  const v = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return v || fallback;
}

const cache = new Map<string, { key: string; tax: ArtTaxonomy }>();

function autoGroup(category: string, index: number): GroupDef {
  const l = parseCategoryLabel(category);
  return { id: `auto-${slug(l.en, String(index))}`, ko: l.ko, en: l.en, section: 'other', legacy: [category] };
}

/** Builds (memoized) the taxonomy of one art from the techniques the art page shows. */
export function getArtTaxonomy(art: string, techniques: Technique[] = getUnifiedTechniquesByMartialArt(art)): ArtTaxonomy {
  const key = `${techniques.length}:${techniques[0]?.id ?? ''}:${techniques[techniques.length - 1]?.id ?? ''}`;
  const hit = cache.get(art);
  if (hit && hit.key === key) return hit.tax;

  const cfg = TAXONOMY_CONFIG[art];
  const groups: GroupDef[] = cfg ? [...cfg.groups] : [];
  const sections = cfg ? [...cfg.sections] : [];
  const byCategory = new Map<string, GroupDef>();
  for (const g of groups) for (const c of g.legacy) byCategory.set(c, g);

  // every category the art actually shows; unknown ones become their own group
  const categoryOf = new Map<string, string>();
  for (const t of techniques) categoryOf.set(t.id, techniqueCategoryInArt(t, art));
  let autoIndex = 0;
  for (const c of new Set(categoryOf.values())) {
    if (!byCategory.has(c)) {
      const g = autoGroup(c, autoIndex++);
      groups.push(g);
      byCategory.set(c, g);
    }
  }
  if (groups.some((g) => g.section === 'other') && !sections.some((s) => s.id === 'other')) sections.push({ id: 'other', ko: '기타', en: 'Other' });

  const nodes = new Map<string, TaxonomyNode>();
  const nodeTechniques = new Map<string, Set<string>>();
  const techniqueAssignments = new Map<string, Assignment[]>();
  const techniqueTags = new Map<string, DimEvidence[]>();
  const review: ReviewItem[] = [];
  const categoryNode = new Map<string, string>();
  const add = (nodeId: string, techId: string, confidence: Assignment['confidence'], basis: string) => {
    (nodeTechniques.get(nodeId) ?? nodeTechniques.set(nodeId, new Set()).get(nodeId)!).add(techId);
    const list = techniqueAssignments.get(techId) ?? techniqueAssignments.set(techId, []).get(techId)!;
    if (!list.some((a) => a.nodeId === nodeId)) list.push({ nodeId, confidence, basis });
  };
  const join = (a: string, b: string) => (a.includes(b) ? a : b.includes(a) ? b : `${a} ${b}`);
  const mk = (n: Omit<TaxonomyNode, 'children' | 'count' | 'fullKo' | 'fullEn'>): TaxonomyNode => {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    const full = !parent ? { fullKo: n.ko, fullEn: n.en } : n.kind === 'member' ? { fullKo: n.ko, fullEn: n.en } : { fullKo: join(parent.fullKo, n.ko), fullEn: join(parent.fullEn, n.en) };
    const node: TaxonomyNode = { ...n, ...full, children: [], count: 0 };
    nodes.set(node.id, node);
    if (n.parentId) nodes.get(n.parentId)!.children.push(node.id);
    return node;
  };

  // description / purpose paragraphs repeated on 3+ techniques are category text, not the technique's own
  const freq = new Map<string, number>();
  for (const t of techniques) for (const x of [t.description, t.purpose]) if (x?.trim()) freq.set(x.trim(), (freq.get(x.trim()) ?? 0) + 1);
  const shared = new Set([...freq].filter(([, n]) => n >= 3).map(([x]) => x));
  const texts = new Map<string, ReturnType<typeof techniqueTexts>>();
  const textOf = (t: Technique) => texts.get(t.id) ?? texts.set(t.id, techniqueTexts(t, shared)).get(t.id)!;

  // cross-cutting tags (purpose filter / search)
  for (const t of techniques) {
    if (!cfg) continue;
    techniqueTags.set(t.id, classifyDimensions(t, cfg.tags, cfg.tags, textOf(t)).filter((e) => e.confidence !== 'LOW'));
  }

  const roots: string[] = [];
  for (const g of groups) {
    const members = techniques.filter((t) => g.legacy.includes(categoryOf.get(t.id)!));
    if (members.length === 0) continue; // never show an empty group
    const groupId = `${art}/${g.id}`;
    mk({ id: groupId, art, level: 2, kind: 'group', parentId: null, ko: g.ko, en: g.en, section: g.section });
    roots.push(groupId);
    for (const t of members) add(groupId, t.id, 'CATEGORY', `기존 카테고리: ${categoryOf.get(t.id)}`);

    // Level 3 — member categories
    const memberCats = g.children === 'all' ? g.legacy : g.children === 'secondary' ? g.legacy.slice(1) : [];
    memberCats.forEach((c, i) => {
      const inCat = members.filter((t) => categoryOf.get(t.id) === c);
      if (inCat.length === 0) return;
      const l = parseCategoryLabel(c);
      const id = `${groupId}/m-${slug(l.en, String(i))}`;
      mk({ id, art, level: 3, kind: 'member', parentId: groupId, ko: l.ko, en: l.en, section: g.section, category: c });
      categoryNode.set(c, id);
      for (const t of inCat) add(id, t.id, 'CATEGORY', `기존 카테고리: ${c}`);
      // Level 4 under a member category
      const sub = g.subSplit?.[c];
      if (sub && inCat.length >= MIN_PARENT_FOR_L4) splitInto(id, inCat, sub, 4, g);
    });
    for (const c of g.legacy) if (!categoryNode.has(c)) categoryNode.set(c, groupId);

    // Level 3 — purpose / family / position splits
    if (g.split && members.length >= MIN_GROUP_FOR_SPLIT) splitInto(groupId, members, g.split, 3, g);

    // Level 3 — "기타": group members that no child holds (only when the group has children)
    const node = nodes.get(groupId)!;
    if (node.children.length > 0) {
      const covered = new Set(node.children.flatMap((c) => [...(nodeTechniques.get(c) ?? [])]));
      const rest = members.filter((t) => !covered.has(t.id));
      if (rest.length > 0) {
        const id = `${groupId}/_other`;
        mk({ id, art, level: 3, kind: 'other', parentId: groupId, ko: '기타 · 세부 분류 없음', en: 'Other / Unsorted', section: g.section });
        for (const t of rest) add(id, t.id, 'CATEGORY', '하위 분류 근거 없음 (그룹에만 속함)');
      }
    }
  }

  function splitInto(parentId: string, pool: Technique[], dims: string[], level: 3 | 4, g: GroupDef) {
    const evidence = new Map<string, DimEvidence[]>();
    for (const t of pool) evidence.set(t.id, classifyDimensions(t, dims, dims, textOf(t)));
    for (const dim of dims) {
      const holders = pool.filter((t) => evidence.get(t.id)!.some((e) => e.dim === dim && e.confidence !== 'LOW'));
      if (holders.length < MIN_SPLIT_CHILD) continue; // no thin subcategories
      const d = DIMENSION_BY_ID.get(dim)!;
      const parent = nodes.get(parentId)!;
      const id = `${parentId}/${dim}`;
      mk({ id, art, level, kind: 'split', parentId, ko: d.ko, en: d.en, section: parent.section, dim });
      for (const t of holders) {
        const e = evidence.get(t.id)!.find((x) => x.dim === dim)!;
        add(id, t.id, e.confidence, e.basis);
      }
      const sub = g.subSplit?.[dim];
      if (level === 3 && sub && holders.length >= MIN_PARENT_FOR_L4) splitInto(id, holders, sub, 4, g);
    }
    // review: a technique of a split pool with no assignable evidence but LOW candidates (or none at all)
    if (level === 3) {
      for (const t of pool) {
        const ev = evidence.get(t.id)!;
        if (ev.some((e) => e.confidence !== 'LOW')) continue;
        review.push({ techniqueId: t.id, name: t.name, art, groupId: parentId, reason: ev.length > 0 ? '근거가 약함 (LOW) — 자동 확정하지 않음' : '세부 분류 근거 없음', candidates: ev });
      }
    }
  }

  // extension nodes (user / admin categories) — only under an existing node, never deeper than Level 4, and only
  // with techniques the art actually shows
  // An extension node may also (a) name an EXISTING node — its techniques are attached there (a user filing a
  // technique under "하프 가드 › 스윕"), or (b) name "<group>/<dim>" for a dimension the group's config splits on —
  // the regular split node is created even if the data alone had too few holders. Techniques attached this way leave
  // the group's "기타" node.
  const shown = new Set(techniques.map((t) => t.id));
  const attached = new Set<string>();
  for (const ext of extensions) {
    for (const x of ext(art)) {
      if (!x.id.startsWith(`${art}/`)) continue;
      const existing = nodes.get(x.id);
      const parent = existing ? (existing.parentId ? nodes.get(existing.parentId) : undefined) : nodes.get(x.parentId);
      const groupId = x.id.split('/').slice(0, 2).join('/');
      const inGroup = (id: string) => shown.has(id) && (nodeTechniques.get(groupId) ?? new Set()).has(id);
      const ids = x.techniqueIds.filter(inGroup);
      if (ids.length === 0) continue;
      let target = existing;
      if (!target) {
        if (!parent || parent.level >= 4) continue;
        const g = groups.find((gg) => `${art}/${gg.id}` === groupId);
        const dim = x.id.slice(groupId.length + 1);
        const isSplitDim = parent.id === groupId && !!g?.split?.includes(dim) && DIMENSION_BY_ID.has(dim);
        target = isSplitDim
          ? mk({ id: x.id, art, level: 3, kind: 'split', parentId: parent.id, ko: DIMENSION_BY_ID.get(dim)!.ko, en: DIMENSION_BY_ID.get(dim)!.en, section: parent.section, dim })
          : mk({ id: x.id, art, level: (parent.level + 1) as 3 | 4, kind: 'custom', parentId: parent.id, ko: x.ko, en: x.en, section: parent.section });
      }
      if (target.kind === 'other') continue;
      for (const id of ids) {
        add(target.id, id, 'CATEGORY', '사용자 지정 분류');
        attached.add(`${groupId}|${id}`);
      }
    }
  }
  if (attached.size > 0) {
    for (const r of roots) {
      const other = nodeTechniques.get(`${r}/_other`);
      if (!other) continue;
      for (const id of [...other]) if (attached.has(`${r}|${id}`)) other.delete(id);
      if (other.size === 0) {
        nodes.delete(`${r}/_other`);
        nodeTechniques.delete(`${r}/_other`);
        const g = nodes.get(r)!;
        g.children = g.children.filter((c) => c !== `${r}/_other`);
      }
    }
  }

  // counts: distinct techniques under each node, children included
  const countOf = (id: string): Set<string> => {
    const node = nodes.get(id)!;
    const all = new Set(nodeTechniques.get(id) ?? []);
    for (const c of node.children) for (const x of countOf(c)) all.add(x);
    node.count = all.size;
    return all;
  };
  for (const r of roots) countOf(r);
  const sectionRank = (s: string) => {
    const i = sections.findIndex((x) => x.id === s);
    return i < 0 ? sections.length : i;
  };
  roots.sort((a, b) => sectionRank(nodes.get(a)!.section) - sectionRank(nodes.get(b)!.section));

  const tax: ArtTaxonomy = { art, sections, nodes, roots, nodeTechniques, techniqueAssignments, techniqueTags, review, categoryNode };
  cache.set(art, { key, tax });
  return tax;
}

export function artOfNode(nodeId: string): string {
  return nodeId.split('/')[0];
}

export function getTaxonomyNode(nodeId: string): TaxonomyNode | undefined {
  return getArtTaxonomy(artOfNode(nodeId)).nodes.get(nodeId);
}

/** Distinct techniques of a node, its children included. */
export function techniqueIdsForNode(nodeId: string): Set<string> {
  const tax = getArtTaxonomy(artOfNode(nodeId));
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const x of tax.nodeTechniques.get(id) ?? []) out.add(x);
    for (const c of tax.nodes.get(id)?.children ?? []) walk(c);
  };
  walk(nodeId);
  return out;
}

export function techniquesForNode(nodeId: string): Technique[] {
  return [...techniqueIdsForNode(nodeId)].map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t);
}

export function taxonomyBreadcrumb(nodeId: string): TaxonomyNode[] {
  const tax = getArtTaxonomy(artOfNode(nodeId));
  const out: TaxonomyNode[] = [];
  for (let n = tax.nodes.get(nodeId); n; n = n.parentId ? tax.nodes.get(n.parentId) : undefined) out.unshift(n);
  return out;
}

/** Where a technique sits in an art: its group and every child it was assigned to (with confidence). */
export function classificationOf(techniqueId: string, art: string): { node: TaxonomyNode; assignment: Assignment }[] {
  const tax = getArtTaxonomy(art);
  return (tax.techniqueAssignments.get(techniqueId) ?? []).map((a) => ({ node: tax.nodes.get(a.nodeId)!, assignment: a })).filter((x) => !!x.node);
}

export function purposeTagsOf(techniqueId: string, art: string): DimEvidence[] {
  return getArtTaxonomy(art).techniqueTags.get(techniqueId) ?? [];
}

/** Tag options for a purpose / type filter: only dimensions some technique of the art actually has. */
export function tagOptions(art: string): { id: string; ko: string; en: string; count: number }[] {
  const tax = getArtTaxonomy(art);
  const counts = new Map<string, number>();
  for (const tags of tax.techniqueTags.values()) for (const e of tags) counts.set(e.dim, (counts.get(e.dim) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n >= MIN_SPLIT_CHILD)
    .map(([id, count]) => ({ id, ko: DIMENSION_BY_ID.get(id)!.ko, en: DIMENSION_BY_ID.get(id)!.en, count }))
    .sort((a, b) => b.count - a.count);
}

/** The node that stands for an existing category string (member node, or the group holding it). */
export function nodeForCategory(art: string, category: string): string | undefined {
  return getArtTaxonomy(art).categoryNode.get(category);
}

// a name's own words: the whole name, and its "·"/"/" parts of 3+ characters — "기본 자세 · 가드" must not answer
// to every "가드", "스윕 / 전환" not to every "스윕"
function groupTerms(n: TaxonomyNode): string[] {
  const core = (s: string) => {
    const whole = s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = whole.split(/[·/]/).map((x) => x.trim()).filter((x) => x.replace(/\s+/g, '').length >= 3);
    return [whole, ...parts];
  };
  return [...core(n.ko), ...core(n.en).map((x) => x.toLowerCase())];
}

/**
 * Taxonomy nodes named in free text ("하프 가드 스윕만 집중적으로" → bjj/half-guard/sweep). A split node needs BOTH
 * its group (e.g. 하프 가드) and its dimension (스윕) in the text; a member node needs its own name; a group needs
 * its name. Most specific first. Used by the AI coach and the curriculum generator.
 */
export function findTaxonomyNodesInText(text: string, arts?: string[]): TaxonomyNode[] {
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const squash = lower.replace(/\s+/g, '');
  const has = (term: string) => term.length >= 2 && (lower.includes(term.toLowerCase()) || squash.includes(term.toLowerCase().replace(/\s+/g, '')));
  const out: TaxonomyNode[] = [];
  for (const art of arts ?? Object.keys(TAXONOMY_CONFIG)) {
    if (!getUnifiedMartialArt(art)) continue;
    const tax = getArtTaxonomy(art);
    for (const n of tax.nodes.values()) {
      if (n.kind === 'other') continue;
      const group = n.level === 2 ? n : tax.nodes.get(n.id.split('/').slice(0, 2).join('/'))!;
      const groupHit = groupTerms(group).some(has);
      if (n.kind === 'group' && groupHit) out.push(n);
      else if ((n.kind === 'member' || n.kind === 'custom') && groupTerms(n).some(has)) out.push(n);
      else if (n.kind === 'split' && n.dim) {
        const d = DIMENSION_BY_ID.get(n.dim)!;
        const parent = n.parentId ? tax.nodes.get(n.parentId) : undefined;
        const parentHit = parent && parent.kind !== 'group' ? groupTerms(parent).some(has) || groupHit : groupHit;
        if (parentHit && [d.ko, ...d.termsKo, ...d.termsEn].some(has)) out.push(n);
      }
    }
  }
  return out.sort((a, b) => b.level - a.level || a.count - b.count);
}
