import { getUnifiedTechniquesByMartialArt } from '../userTechniques/service';
import { invalidateTaxonomy, registerTaxonomyExtension, type TaxonomyExtensionNode } from '../techniqueTaxonomy';
import { CUSTOM_CATEGORIES_EVENT, customCategoriesOf, getCustomCategory, resolveCategoryId } from './store';
import type { CustomCategory } from './types';

// Attaches the category registry to the computed technique taxonomy (techniqueTaxonomy/ owns the tree; it is never
// edited here):
//   • a top-level category is the Level-2 group the taxonomy builds from the technique's own `category` string
//     (categoryString "스크램블 (Scrambles)" → node `${art}/auto-scrambles`) — its id IS that node id
//   • a child category is a 'custom' node under its parent (built-in or custom), at Level 3 or 4
//   • a technique registered under a category (Technique.taxonomyNodeId) is attached to it; a merged category's
//     techniques follow the merge, an inactive one keeps its techniques visible
// The taxonomy shows a custom node only once a technique uses it; selection screens read the registry directly.

/** The same slug the taxonomy uses for auto groups. */
export function taxonomySlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** "스크램블 (Scrambles)" — the category string a top-level category gives its techniques. */
export function categoryStringOf(ko: string, en: string): string {
  return `${ko.trim()} (${en.trim()})`;
}

/** The taxonomy node id of a top-level category with this English name. */
export function topLevelIdOf(art: string, en: string): string {
  return `${art}/auto-${taxonomySlug(en)}`;
}

function depth(c: CustomCategory): number {
  let d = 0;
  for (let p = c.parentId ? getCustomCategory(c.parentId) : undefined; p && d < 10; p = p.parentId ? getCustomCategory(p.parentId) : undefined) d++;
  return d;
}

export function extensionNodes(art: string): TaxonomyExtensionNode[] {
  const children = customCategoriesOf(art).filter((c) => c.parentId && c.status !== 'merged');
  if (!children.length) return [];
  const placed = new Map<string, string[]>();
  for (const t of getUnifiedTechniquesByMartialArt(art)) {
    if (!t.taxonomyNodeId) continue;
    const target = resolveCategoryId(t.taxonomyNodeId);
    (placed.get(target) ?? placed.set(target, []).get(target)!).push(t.id);
  }
  // a category holds its own techniques and its sub-categories' (so a parent with only grand-children still shows)
  const under = (id: string): string[] => [...(placed.get(id) ?? []), ...children.filter((c) => c.parentId === id).flatMap((c) => under(c.id))];
  return [...children]
    .sort((a, b) => depth(a) - depth(b))
    .map((c) => ({ id: c.id, parentId: c.parentId!, ko: c.status === 'inactive' ? `${c.ko} (비활성)` : c.ko, en: c.en, techniqueIds: [...new Set(under(c.id))] }));
}

let registered = false;
/** Registered once by main.tsx (and by any module that needs it in tests). */
export function ensureCategoryExtension(): void {
  if (registered) return;
  registered = true;
  registerTaxonomyExtension(extensionNodes);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(CUSTOM_CATEGORIES_EVENT, invalidateTaxonomy);
    // a newly registered technique placed under a custom category
    for (const ev of ['martialdex:add-teq-cache-updated', 'martialdex:user-techniques-updated']) window.addEventListener(ev, invalidateTaxonomy);
  }
}
ensureCategoryExtension();
