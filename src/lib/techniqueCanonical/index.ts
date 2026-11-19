import type { Technique } from '../../types';
import canonicalData from '../../../data/curated/technique-canonical.json';
import { canonicalOfficialId, categoryInArt, getTechnique, isManagedMartialArt, isSyntheticTrainingDomain } from '../loadData';
import { addTeqRepository, storeVersion as addTeqStoreVersion } from '../addTeq/repository';
import { userTechniqueRepository, storeVersion as mineStoreVersion } from '../userTechniques/repository';
import { canonicalCategoryFor, officialCategoriesOf, unifyCustomCategory } from './category';
import { customCategoriesOf, customCategoriesVersion } from '../categoryRegistry/store';

// Runtime half of canonical techniques. loadData.ts merges the OFFICIAL
// duplicates statically; this layer adds what lives in the shared library
// (Supabase add_teq) and this device's user_techniques:
//   - a record that re-registered an existing official technique
//     (technique-canonical.json addTeqDuplicates) → resolves to the
//     canonical technique; its art becomes a link,
//   - a link record (technique.linkOf, written by 기술 요청 when the
//     technique exists but not yet in that art) → adds that art,
//   - every other record gets its AI-written category filed into the art's
//     canonical category (category.ts).
// Every id that ever existed keeps resolving — nothing is deleted. A record
// filed under an art the app no longer manages (우슈·택견, added through the
// removed 무술 추가 feature) is left out of the library and adds no link.

const ADD_TEQ_DUPLICATES = new Map((canonicalData as { addTeqDuplicates: { id: string; canonical: string }[] }).addTeqDuplicates.map((d) => [d.id, d.canonical]));

export interface ArtLink {
  martialArt: string;
  category: string;
  /** The library record that created the link. */
  sourceId: string;
}

interface LibraryState {
  /** Normal (non-duplicate, non-link) records with canonical categories. */
  addTeq: Technique[];
  mine: Technique[];
  /** record id → canonical technique id, for duplicate/link records. */
  redirect: Map<string, string>;
  /** canonical id → arts linked through the library. */
  links: Map<string, ArtLink[]>;
}

// Rebuilt only when either store changed (their in-memory version numbers) — reading both raw
// strings from localStorage and comparing them on EVERY lookup was the hot path on phones.
let cache: { addTeqVersion: number; mineVersion: number; categoryVersion: number; state: LibraryState } | null = null;

function linkCategory(art: string, canonical: Technique | undefined, recordCategory: string): string {
  if (canonical?.categoryByArt?.[art]) return canonical.categoryByArt[art];
  return canonicalCategoryFor(art, recordCategory, canonical) ?? (canonical ? canonicalCategoryFor(art, canonical.category, canonical) : null) ?? recordCategory;
}

function buildState(): LibraryState {
  const redirect = new Map<string, string>();
  const links = new Map<string, ArtLink[]>();
  const customCategories = new Map<string, string[]>();
  const addLink = (canonicalId: string, link: ArtLink) => {
    const list = links.get(canonicalId) ?? [];
    if (!list.some((l) => l.martialArt === link.martialArt)) list.push(link);
    links.set(canonicalId, list);
  };
  const addTeqRecords = addTeqRepository.list();
  const mineRecords = userTechniqueRepository.list();
  // Link targets can be library techniques too (a shared-library technique linked to a sibling art), not only official ones.
  const libraryById = new Map<string, Technique>();
  for (const r of [...addTeqRecords, ...mineRecords]) if (!r.technique.linkOf && !ADD_TEQ_DUPLICATES.has(r.technique.id)) libraryById.set(r.technique.id, r.technique);
  const normalize = (t: Technique): Technique | null => {
    const target = t.linkOf ?? ADD_TEQ_DUPLICATES.get(t.id);
    if (target) {
      const canonicalId = canonicalOfficialId(target);
      const canonical = getTechnique(canonicalId) ?? libraryById.get(canonicalId);
      redirect.set(t.id, canonicalId);
      if (canonical && isManagedMartialArt(t.martialArt) && !(canonical.martialArts ?? [canonical.martialArt]).includes(t.martialArt)) addLink(canonicalId, { martialArt: t.martialArt, category: linkCategory(t.martialArt, canonical, t.category), sourceId: t.id });
      return null;
    }
    if (!isManagedMartialArt(t.martialArt)) return null;
    if (isSyntheticTrainingDomain(t.martialArt)) return t;
    // A category created in the category registry for this art is a real category, not an AI misspelling to remap.
    if (customCategoriesOf(t.martialArt).some((c) => c.categoryString === t.category)) return t;
    if (officialCategoriesOf(t.martialArt).length > 0) {
      const category = canonicalCategoryFor(t.martialArt, t.category, t);
      return category && category !== t.category ? { ...t, category } : t;
    }
    const existing = customCategories.get(t.martialArt) ?? [];
    const category = unifyCustomCategory(t.category, existing);
    if (!existing.includes(category)) customCategories.set(t.martialArt, [...existing, category]);
    return category !== t.category ? { ...t, category } : t;
  };
  const addTeq = addTeqRecords.map((r) => normalize(r.technique)).filter((t): t is Technique => !!t);
  const mine = mineRecords.map((r) => normalize(r.technique)).filter((t): t is Technique => !!t);
  return { addTeq, mine, redirect, links };
}

function state(): LibraryState {
  const addTeqVersion = addTeqStoreVersion();
  const mineVersion = mineStoreVersion();
  if (!cache || cache.addTeqVersion !== addTeqVersion || cache.mineVersion !== mineVersion || cache.categoryVersion !== customCategoriesVersion()) {
    const st = buildState();
    // read the versions AFTER building: building reads (and so may load) the stores
    cache = { addTeqVersion: addTeqStoreVersion(), mineVersion: mineStoreVersion(), categoryVersion: customCategoriesVersion(), state: st };
  }
  return cache.state;
}

/** Shared-library + this device's own techniques, canonicalized: duplicates and link records removed, categories canonical. */
export function libraryTechniques(): { addTeq: Technique[]; mine: Technique[] } {
  const s = state();
  return { addTeq: s.addTeq, mine: s.mine };
}

/** The canonical id for ANY technique id — official merged-away ids, library duplicates and link records included. */
export function canonicalTechniqueId(id: string): string {
  const official = canonicalOfficialId(id);
  if (official !== id) return official;
  return state().redirect.get(id) ?? id;
}

/** Canonical technique for a duplicate/link library record id, if it is one. */
export function redirectedTechnique(id: string): Technique | undefined {
  const target = state().redirect.get(id);
  return target ? getTechnique(target) : undefined;
}

export function libraryLinksOf(canonicalId: string): ArtLink[] {
  return state().links.get(canonicalId) ?? [];
}

/** Every art a technique belongs to, primary first (official merge + library links). */
export function techniqueArts(t: Technique): string[] {
  return [...new Set([t.martialArt, ...(t.martialArts ?? []), ...libraryLinksOf(t.id).map((l) => l.martialArt)])];
}

export function isTechniqueInArt(t: Technique, martialArtId: string): boolean {
  return t.martialArt === martialArtId || (t.martialArts?.includes(martialArtId) ?? false) || libraryLinksOf(t.id).some((l) => l.martialArt === martialArtId);
}

/** The category this technique is filed under within one art. */
export function techniqueCategoryInArt(t: Technique, martialArtId: string): string {
  if (t.categoryByArt?.[martialArtId]) return categoryInArt(t, martialArtId);
  return libraryLinksOf(t.id).find((l) => l.martialArt === martialArtId)?.category ?? t.category;
}

/** Ids that are the same technique as `id` (for data keyed by technique id: video picks, overrides…). */
export function equivalentTechniqueIds(id: string): string[] {
  const canonicalId = canonicalTechniqueId(id);
  const t = getTechnique(canonicalId);
  const ids = new Set([canonicalId, id, ...(t?.mergedIds ?? [])]);
  for (const [from, to] of state().redirect) if (to === canonicalId) ids.add(from);
  return [...ids];
}

/**
 * How a technique is named on a screen about one art: that art's own record
 * name first (Karate → "Mae Geri" · 앞차기), then the other names it is known
 * by (canonical name, other arts' names) so the shared identity stays visible.
 * Without an art (or for an art linked without its own record) → canonical name.
 */
export function techniqueNameInArt(t: Technique, martialArtId?: string | null): { name: string; koreanName: string | null; otherNames: string[] } {
  const own = martialArtId ? t.namesByArt?.[martialArtId] : undefined;
  const name = own?.name ?? t.name;
  const koreanName = own ? (own.koreanName ?? (own.name === t.name ? t.koreanName : null)) : t.koreanName;
  const shown = new Set([name, koreanName].filter(Boolean).map((n) => n!.trim().toLowerCase()));
  const otherNames: string[] = [];
  for (const n of [t.name, ...Object.values(t.namesByArt ?? {}).map((x) => x.name)]) {
    const k = n.trim().toLowerCase();
    if (shown.has(k)) continue;
    shown.add(k);
    otherNames.push(n);
  }
  return { name, koreanName: koreanName && koreanName !== name ? koreanName : null, otherNames };
}
