// A technique FAMILY named in a question ("레슬링 싱글렉을 배우고 싶어") is one of the
// art's official categories ("싱글 레그": High Single, Low Single, … 18 records), not
// a single record. Before, such a question resolved to whatever record happened to
// be called "Single Leg" — a stub in another art. This finds the category, its own
// encyclopedia paragraph and its sub-headings (data/curated/category-hierarchy.json,
// built from data/raw by scripts/build-knowledge-curation.mjs).

import type { Technique } from '../../types';
import hierarchyData from '../../../data/curated/category-hierarchy.json';
import { getUnifiedAllTechniques, resolveTechnique } from '../userTechniques/service';
import { approvedCandidates } from './approved';

interface HierarchySection {
  category: string;
  order: number;
  section: number | null;
  source: string;
  paragraph: string | null;
  subcategories: { title: string; order: number; techniqueIds: string[] }[];
  count: number;
}

const hierarchy = (hierarchyData as { arts: Record<string, HierarchySection[]> }).arts;

export interface CategoryTopic {
  art: string;
  category: string;
  /** The encyclopedia's own paragraph about the family (MARTIALDEX 내부 자료). */
  paragraph: string | null;
  source: string;
  subcategories: { title: string; techniques: Technique[]; approved: boolean }[];
  members: Technique[];
}

const categoryIn = (t: Technique, art: string) => t.categoryByArt?.[art] ?? t.category;

/** Spelling the learner types ↔ the category's spelling: spaces, "렉"/"레그", "렛그". */
function squash(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[\s\-_/·.,]+/g, '')
    .replace(/렛그|렉(?!스)/g, '레그');
}

function keysOf(category: string): string[] {
  const english = /\(([^)]+)\)/.exec(category)?.[1];
  const korean = category.split(/---|—/)[0];
  return [squash(korean), ...(english ? [squash(english)] : [])].filter((k) => k.length >= 4);
}

export function sectionOf(art: string, category: string): HierarchySection | null {
  return hierarchy[art]?.find((s) => s.category === category) ?? null;
}

export function categoryTopic(art: string, category: string): CategoryTopic | null {
  const sec = sectionOf(art, category);
  const members = getUnifiedAllTechniques().filter((t) => (t.martialArts ?? [t.martialArt]).includes(art) && categoryIn(t, art) === category);
  if (!members.length) return null;
  const subs: CategoryTopic['subcategories'] = (sec?.subcategories ?? []).map((s) => ({ title: s.title, approved: true, techniques: s.techniqueIds.map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t) }));
  // sub-categories a person approved from the candidates (never the unreviewed ones)
  for (const c of approvedCandidates('subcategory')) {
    if (c.martialArt !== art || c.subcategory?.parentCategory !== category) continue;
    subs.push({ title: c.subcategory.title, approved: true, techniques: c.subcategory.techniqueIds.map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t) });
  }
  return { art, category, paragraph: sec?.paragraph ?? null, source: sec?.source ?? `data/processed/${art}.json`, subcategories: subs, members };
}

/** Categories of `art` (or of any art when null) whose name appears in the text. Longest name first. */
export function categoryTopicsInText(text: string, art: string | null): CategoryTopic[] {
  const t = squash(text);
  const out: { topic: CategoryTopic; len: number }[] = [];
  for (const [a, sections] of Object.entries(hierarchy)) {
    if (art && a !== art) continue;
    for (const s of sections) {
      const hit = keysOf(s.category).find((k) => t.includes(k));
      if (!hit) continue;
      const topic = categoryTopic(a, s.category);
      if (topic) out.push({ topic, len: hit.length });
    }
  }
  return out.sort((x, y) => y.len - x.len).map((x) => x.topic);
}

/** The sub-heading a record sits under in its art's encyclopedia ("손싸움"), if any. */
export function subcategoryOf(t: Technique, art = t.martialArt): string | null {
  const sec = sectionOf(art, categoryIn(t, art));
  const ids = new Set(t.mergedIds ?? [t.id]);
  return sec?.subcategories.find((s) => s.techniqueIds.some((id) => ids.has(id)))?.title ?? null;
}

/** A word most of a family's names share ("single" in High Single, Low Single, Single to Double …), if there is one. */
export function familyWord(members: Technique[]): string | null {
  const count = new Map<string, number>();
  for (const t of members) for (const w of new Set(t.name.toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 4))) count.set(w, (count.get(w) ?? 0) + 1);
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= Math.max(3, members.length * 0.4) ? best[0] : null;
}
