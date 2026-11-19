import { STORAGE_REPLACED_EVENT } from '../storageEvents';
import type { CustomCategory } from './types';

// Local copy of the shared category registry (Supabase technique_categories, 0043) plus categories made on this
// device while logged out. Same in-memory memo pattern as the technique repositories (no localStorage read per call).

const KEY = 'martialdex:custom-categories';
export const CUSTOM_CATEGORIES_EVENT = 'martialdex:custom-categories-updated';

let memo: CustomCategory[] | null = null;
let version = 0;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) {
      memo = null;
      version++;
    }
  });
  window.addEventListener(STORAGE_REPLACED_EVENT, () => {
    memo = null;
    version++;
  });
}

const valid = (x: unknown): x is CustomCategory => {
  const c = x as CustomCategory;
  return !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.art === 'string' && typeof c.ko === 'string' && typeof c.en === 'string' && c.id.startsWith(`${c.art}/`);
};

export function listCustomCategories(): CustomCategory[] {
  if (memo) return memo;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    memo = Array.isArray(v) ? v.filter(valid) : [];
  } catch {
    memo = [];
  }
  return memo;
}

/** Bumped on every change — taxonomy caches key on it. */
export function customCategoriesVersion(): number {
  return version;
}

export function replaceCustomCategories(list: CustomCategory[]): void {
  memo = list.filter(valid);
  version++;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memo));
  } catch {
    // storage full — kept for this session
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_CATEGORIES_EVENT));
}

export function upsertCustomCategory(c: CustomCategory): void {
  replaceCustomCategories([...listCustomCategories().filter((x) => x.id !== c.id), c]);
}

export function removeCustomCategory(id: string): void {
  replaceCustomCategories(listCustomCategories().filter((x) => x.id !== id));
}

export function customCategoriesOf(art: string): CustomCategory[] {
  return listCustomCategories().filter((c) => c.art === art);
}

export function getCustomCategory(id: string): CustomCategory | undefined {
  return listCustomCategories().find((c) => c.id === id);
}

/** Follows merges to the category a technique filed under `id` now belongs to (cycle-safe). */
export function resolveCategoryId(id: string): string {
  const seen = new Set<string>();
  let cur = id;
  for (let c = getCustomCategory(cur); c?.status === 'merged' && c.mergedInto && !seen.has(cur); c = getCustomCategory(cur)) {
    seen.add(cur);
    cur = c.mergedInto;
  }
  return cur;
}
