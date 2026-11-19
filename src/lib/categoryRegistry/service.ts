import type { Technique } from '../../types';
import { supabase } from '../supabase/client';
import { getArtTaxonomy, type TaxonomyNode } from '../techniqueTaxonomy';
import { TAXONOMY_CONFIG } from '../techniqueTaxonomy/config';
import { DIMENSIONS, DIMENSION_BY_ID } from '../techniqueTaxonomy/dimensions';
import { getUnifiedMartialArt, getUnifiedTechniquesByMartialArt } from '../userTechniques/service';
import { customCategoriesOf, getCustomCategory, listCustomCategories, removeCustomCategory, replaceCustomCategories, resolveCategoryId, upsertCustomCategory } from './store';
import { categoryStringOf, taxonomySlug, topLevelIdOf } from './taxonomy';
import type { CategoryMatch, CustomCategory, NewCategoryInput } from './types';

// Category selection, validation, duplicate check and management for new-technique registration. The built-in tree
// (techniqueTaxonomy/) is read-only here; only registry categories (store.ts) are created / edited.

const MAX_LEVEL = 4;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- picker tree

export interface PickerNode {
  id: string;
  art: string;
  level: number;
  ko: string;
  en: string;
  /** "하프 가드 › 스윕" */
  path: string;
  kind: TaxonomyNode['kind'] | 'potential';
  /** The `technique.category` a technique filed here gets (nearest category-bearing ancestor). */
  categoryString: string;
  /** Distinct techniques under it now (children included). */
  count: number;
  custom: CustomCategory | null;
  /** Configured purpose / type split (dimension id) — also for one not populated yet. */
  dim: string | null;
  children: PickerNode[];
}

function groupCategoryString(art: string, node: TaxonomyNode, categoryNode: Map<string, string>): string | null {
  const cfg = TAXONOMY_CONFIG[art]?.groups.find((g) => `${art}/${g.id}` === node.id);
  if (cfg) return cfg.legacy[0];
  const custom = getCustomCategory(node.id);
  if (custom?.categoryString) return custom.categoryString;
  for (const [cat, id] of categoryNode) if (id === node.id) return cat;
  return null;
}

/**
 * The art's categories for selection: the built-in taxonomy (without 기타), each group's configured purpose splits
 * that have no techniques yet ("potential"), and the registry's active categories — top-level ones even before any
 * technique uses them. Inactive and merged categories are not offered.
 */
export function categoryPickerTree(art: string): PickerNode[] {
  const tax = getArtTaxonomy(art);
  const build = (n: TaxonomyNode, parent: PickerNode | null): PickerNode | null => {
    if (n.kind === 'other') return null;
    const custom = getCustomCategory(n.id) ?? null;
    if (custom && custom.status !== 'active') return null;
    const categoryString = n.category ?? (n.level === 2 ? groupCategoryString(art, n, tax.categoryNode) : null) ?? parent?.categoryString ?? '';
    const p: PickerNode = { id: n.id, art, level: n.level, ko: custom?.ko ?? n.ko, en: custom?.en ?? n.en, path: parent ? `${parent.path} › ${custom?.ko ?? n.ko}` : custom?.ko ?? n.ko, kind: n.kind, categoryString, count: n.count, custom, dim: n.dim ?? null, children: [] };
    p.children = n.children.map((c) => build(tax.nodes.get(c)!, p)).filter((x): x is PickerNode => !!x);
    return p;
  };
  const roots = tax.roots.map((r) => build(tax.nodes.get(r)!, null)).filter((x): x is PickerNode => !!x);
  const index = new Map<string, PickerNode>();
  const walk = (x: PickerNode) => {
    index.set(x.id, x);
    x.children.forEach(walk);
  };
  roots.forEach(walk);
  // configured splits with no techniques yet
  for (const g of TAXONOMY_CONFIG[art]?.groups ?? []) {
    const group = index.get(`${art}/${g.id}`);
    if (!group) continue;
    for (const dim of g.split ?? []) {
      const id = `${group.id}/${dim}`;
      if (index.has(id) || !DIMENSION_BY_ID.get(dim)) continue;
      const d = DIMENSION_BY_ID.get(dim)!;
      const p: PickerNode = { id, art, level: 3, ko: d.ko, en: d.en, path: `${group.path} › ${d.ko}`, kind: 'potential', categoryString: group.categoryString, count: 0, custom: null, dim, children: [] };
      group.children.push(p);
      index.set(id, p);
    }
  }
  // registry categories not in the computed tree yet (no technique uses them)
  const pending = customCategoriesOf(art).filter((c) => c.status === 'active' && !index.has(c.id));
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    for (const c of [...pending]) {
      const parent = c.parentId ? index.get(c.parentId) : null;
      if (c.parentId && !parent) continue;
      const p: PickerNode = { id: c.id, art, level: parent ? parent.level + 1 : 2, ko: c.ko, en: c.en, path: parent ? `${parent.path} › ${c.ko}` : c.ko, kind: parent ? 'custom' : 'group', categoryString: c.categoryString ?? parent?.categoryString ?? '', count: 0, custom: c, dim: null, children: [] };
      if (parent) parent.children.push(p);
      else roots.push(p);
      index.set(c.id, p);
      pending.splice(pending.indexOf(c), 1);
    }
  }
  return roots;
}

export function flattenPicker(roots: PickerNode[]): PickerNode[] {
  const out: PickerNode[] = [];
  const walk = (x: PickerNode) => {
    out.push(x);
    x.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

export function findPickerNode(art: string, id: string): PickerNode | undefined {
  return flattenPicker(categoryPickerTree(art)).find((n) => n.id === resolveCategoryId(id));
}

// ---------------------------------------------------------------- duplicate check

const KO_SUFFIX = /(기술모음|기술|모음|계열|류|들|종류)$/;
/** Spelling-level key: case, spaces, punctuation, plural "s", Korean "~기술/모음/계열" don't make a different category. */
export function categoryKey(s: string): string {
  const base = s.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, ' ');
  const en = base.replace(/[a-z]+/g, (w) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && /(ses|xes|ches|shes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return en.replace(/[^\p{L}\p{N}]/gu, '').replace(KO_SUFFIX, '');
}

/** Purpose / type concept a name stands for ("스윕", "Sweeps", "하프 가드 스윕" under 하프 가드 → sweep). */
function conceptOf(name: string, parentNames: string[]): string | null {
  let key = categoryKey(name);
  for (const p of parentNames.map(categoryKey).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) key = key.replace(p, '');
  if (!key) return null;
  for (const d of DIMENSIONS) if ([d.ko, d.en, ...d.termsKo.filter((x) => !/[$^]/.test(x)), ...d.termsEn].some((t) => categoryKey(t) === key)) return d.id;
  return null;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/**
 * Existing categories of the SAME art the new one would duplicate. "same" blocks creation: same name (spelling /
 * language / plural variants) or the same purpose concept among siblings ("Half Guard Sweep" ≈ "스윕" under 하프 가드),
 * or the same full path anywhere ("하프 가드 스윕" as a new top level = 하프 가드 › 스윕). A same name under a DIFFERENT
 * parent is only "similar" — 클로즈드 가드 스윕 and 하프 가드 스윕 are different categories.
 */
export function findCategoryMatches(input: { art: string; parentId: string | null; ko: string; en: string }, exceptId?: string): CategoryMatch[] {
  const all = flattenPicker(categoryPickerTree(input.art));
  // inactive registry categories still count as existing (re-activate instead of re-creating)
  for (const c of customCategoriesOf(input.art)) if (c.status === 'inactive' && !all.some((n) => n.id === c.id)) all.push({ id: c.id, art: c.art, level: 0, ko: c.ko, en: c.en, path: `${c.ko} (비활성)`, kind: 'custom', categoryString: c.categoryString ?? '', count: 0, custom: c, dim: null, children: [] });
  const parent = input.parentId ? all.find((n) => n.id === input.parentId) : null;
  const parentNames = parent ? [parent.ko, parent.en, ...parent.path.split(' › ')] : [];
  const names = [input.ko, input.en].filter((x) => x.trim());
  const keys = names.map(categoryKey).filter(Boolean);
  const fullKeys = parent ? names.map((n) => categoryKey(`${parent.path.replace(/ › /g, ' ')} ${n}`)) : keys;
  const concept = names.map((n) => conceptOf(n, parentNames)).find(Boolean) ?? null;
  const out: CategoryMatch[] = [];
  const push = (n: PickerNode, kind: CategoryMatch['kind'], reason: string) => {
    if (n.id === exceptId || out.some((m) => m.nodeId === n.id)) return;
    out.push({ nodeId: n.id, label: `${n.ko}${n.en && n.en !== n.ko ? ` (${n.en})` : ''}`, path: n.path, kind, reason });
  };
  for (const n of all) {
    const sibling = (n.custom?.parentId ?? (n.level === 2 ? null : parentIdOf(n, all))) === (input.parentId ?? null);
    const nKeys = [n.ko, n.en].map(categoryKey).filter(Boolean);
    const nFull = categoryKey(n.path.replace(/ › /g, ' '));
    if (parent && n.id === parent.id && keys.some((k) => nKeys.includes(k))) push(n, 'same', '상위 카테고리와 같은 이름입니다');
    else if (sibling && keys.some((k) => nKeys.includes(k))) push(n, 'same', '같은 위치에 같은 이름(철자·언어·단복수 차이만)의 카테고리가 있습니다');
    else if (sibling && concept && (n.dim === concept || conceptOf(n.ko, parentNames) === concept || conceptOf(n.en, parentNames) === concept)) push(n, 'same', `같은 위치에 같은 개념(${DIMENSION_BY_ID.get(concept)?.ko})의 카테고리가 있습니다`);
    else if (fullKeys.some((k) => k === nFull || nKeys.includes(k))) push(n, sibling || !parent ? 'same' : 'similar', '전체 경로가 같은 카테고리가 있습니다');
    else if (sibling && keys.some((k) => nKeys.some((nk) => k.length >= 3 && nk.length >= 3 && (nk.includes(k) || k.includes(nk) || levenshtein(k, nk) <= 1)))) push(n, 'similar', '같은 위치에 이름이 비슷한 카테고리가 있습니다');
    else if (!sibling && keys.some((k) => nKeys.includes(k))) push(n, 'similar', '다른 위치에 같은 이름이 있습니다 — 다른 개념일 수 있어 막지는 않습니다');
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'same' ? -1 : 1));
}

function parentIdOf(n: PickerNode, all: PickerNode[]): string | null {
  return all.find((p) => p.children.some((c) => c.id === n.id))?.id ?? null;
}

// ---------------------------------------------------------------- validation

export type Result<T> = { ok: true; value: T; warning?: string } | { ok: false; message: string; matches?: CategoryMatch[] };

const ASCII_WORD = /[a-z]/i;

export function validateNewCategory(input: NewCategoryInput): Result<{ parent: PickerNode | null; matches: CategoryMatch[] }> {
  if (!getUnifiedMartialArt(input.art)) return { ok: false, message: '등록된 무술이 아닙니다.' };
  const ko = input.ko.trim();
  const en = input.en.trim();
  if (!ko || ko.length > 40) return { ok: false, message: '한국어 이름을 1~40자로 입력해 주세요.' };
  if (en.length > 60) return { ok: false, message: '영어 이름은 60자 이하로 입력해 주세요.' };
  if (/[›/]/.test(ko + en)) return { ok: false, message: '이름에 "›" 또는 "/"는 쓸 수 없습니다.' };
  let parent: PickerNode | null = null;
  if (input.parentId) {
    if (!input.parentId.startsWith(`${input.art}/`)) return { ok: false, message: '다른 무술의 카테고리 아래에는 만들 수 없습니다.' };
    parent = flattenPicker(categoryPickerTree(input.art)).find((n) => n.id === input.parentId) ?? null;
    if (!parent) return { ok: false, message: '상위 카테고리를 찾을 수 없습니다 (비활성·통합된 카테고리 아래에는 만들 수 없습니다).' };
    if (parent.level >= MAX_LEVEL) return { ok: false, message: `카테고리는 ${MAX_LEVEL}단계까지만 만들 수 있습니다.` };
  } else if (!ASCII_WORD.test(en)) {
    return { ok: false, message: '새 대분류는 영어 이름이 필요합니다 (분류 경로를 영구적으로 구분하는 데 쓰입니다).' };
  }
  const matches = findCategoryMatches({ art: input.art, parentId: input.parentId, ko, en });
  const same = matches.filter((m) => m.kind === 'same');
  if (same.length) return { ok: false, message: `이미 같은 카테고리가 있습니다: ${same[0].path}. 기존 카테고리를 사용해 주세요.`, matches };
  if (!input.parentId && listCustomCategories().some((c) => c.id === topLevelIdOf(input.art, en))) return { ok: false, message: '같은 영어 이름의 대분류가 이미 있습니다.', matches };
  return { ok: true, value: { parent, matches } };
}

// ---------------------------------------------------------------- persistence

interface Row {
  id: string;
  art: string;
  parent_id: string | null;
  ko: string;
  en: string;
  description: string;
  status: CustomCategory['status'];
  merged_into: string | null;
  category_string: string | null;
  origin: CustomCategory['origin'];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
const toRow = (c: CustomCategory): Row => ({ id: c.id, art: c.art, parent_id: c.parentId, ko: c.ko, en: c.en, description: c.description, status: c.status, merged_into: c.mergedInto, category_string: c.categoryString, origin: c.origin, created_by: c.createdBy, created_at: c.createdAt, updated_at: c.updatedAt });
const fromRow = (r: Row): CustomCategory => ({ id: r.id, art: r.art, parentId: r.parent_id, ko: r.ko, en: r.en, description: r.description ?? '', status: r.status, mergedInto: r.merged_into, categoryString: r.category_string, origin: r.origin, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

/** Shared categories → local copy (categories made on this device while logged out are kept). */
export async function pullCustomCategories(): Promise<Result<number>> {
  if (!supabase) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
  const { data, error } = await supabase.from('technique_categories').select('*');
  if (error) return { ok: false, message: error.message };
  const shared = (data as Row[]).map(fromRow);
  replaceCustomCategories([...shared, ...listCustomCategories().filter((c) => c.local && !shared.some((s) => s.id === c.id))]);
  return { ok: true, value: shared.length };
}

/** After login: local-only categories become shared (each re-checked; one that now duplicates stays local). */
export async function pushLocalCategories(userId: string): Promise<Result<number>> {
  if (!supabase) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
  let pushed = 0;
  for (const c of listCustomCategories().filter((x) => x.local)) {
    const { error } = await supabase.from('technique_categories').insert({ ...toRow({ ...c, createdBy: userId }) });
    if (!error) {
      upsertCustomCategory({ ...c, createdBy: userId, local: false });
      pushed++;
    }
  }
  return { ok: true, value: pushed };
}

let adminCache: { userId: string; admin: boolean } | null = null;
/** Category administrators (0043 category_admins) may edit / move / merge / deactivate / delete shared categories. */
export async function isCategoryAdmin(userId: string | null): Promise<boolean> {
  if (!userId || !supabase) return false;
  if (adminCache?.userId === userId) return adminCache.admin;
  const { data, error } = await supabase.rpc('is_category_admin');
  const admin = !error && data === true;
  adminCache = { userId, admin };
  return admin;
}

/** The Level-2 group a node sits in (itself for a group) — a technique's category string fixes its group. */
export function groupIdOf(art: string, nodeId: string): string | null {
  const all = flattenPicker(categoryPickerTree(art));
  let cur = all.find((n) => n.id === nodeId);
  while (cur && cur.level > 2) {
    const id = cur.id;
    cur = all.find((p) => p.children.some((c) => c.id === id));
  }
  return cur?.id ?? null;
}

/**
 * Stable ids. A sub-category's id starts with its group's id ("bjj/half-guard/c-underhook-sweeps-x1y2z3") — the
 * taxonomy attaches it inside that group, and it never leaves the group (moves stay inside it).
 */
function newId(art: string, parentId: string | null, en: string): string {
  if (!parentId) return topLevelIdOf(art, en);
  const slug = taxonomySlug(en) || 'category';
  return `${groupIdOf(art, parentId) ?? art}/c-${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a category after validation + duplicate check. Logged in → shared table (everyone sees it); logged out
 * (or the table isn't deployed) → this device only.
 */
export async function createCategory(input: NewCategoryInput, userId: string | null): Promise<Result<CustomCategory>> {
  const v = validateNewCategory(input);
  if (!v.ok) return v;
  const at = now();
  const ko = input.ko.trim();
  const en = input.en.trim() || ko;
  const c: CustomCategory = {
    id: newId(input.art, input.parentId, en),
    art: input.art,
    parentId: input.parentId,
    ko,
    en,
    description: (input.description ?? '').trim().slice(0, 300),
    status: 'active',
    mergedInto: null,
    categoryString: input.parentId ? null : categoryStringOf(ko, en),
    createdBy: userId,
    origin: input.origin ?? 'user',
    createdAt: at,
    updatedAt: at,
  };
  if (userId && supabase) {
    const { error } = await supabase.from('technique_categories').insert(toRow(c));
    if (!error) {
      upsertCustomCategory(c);
      return { ok: true, value: c };
    }
    if (!/does not exist|schema cache|relation/i.test(error.message)) return { ok: false, message: `카테고리를 저장하지 못했습니다: ${error.message}` };
    upsertCustomCategory({ ...c, local: true });
    return { ok: true, value: { ...c, local: true }, warning: '서버 카테고리 표가 아직 준비되지 않아 이 기기에만 저장했습니다.' };
  }
  upsertCustomCategory({ ...c, local: true });
  return { ok: true, value: { ...c, local: true }, warning: '로그인하지 않아 이 기기에만 저장했습니다.' };
}

// ---------------------------------------------------------------- usage

/** Techniques filed under a registry category: placed there (incl. via merges) or carrying its category string. */
export function categoryTechniques(id: string): Technique[] {
  const c = getCustomCategory(id);
  if (!c) return [];
  return getUnifiedTechniquesByMartialArt(c.art).filter((t) => (t.taxonomyNodeId && resolveCategoryId(t.taxonomyNodeId) === id) || (!!c.categoryString && t.category === c.categoryString));
}

function descendants(id: string): CustomCategory[] {
  const direct = listCustomCategories().filter((c) => c.parentId === id);
  return [...direct, ...direct.flatMap((c) => descendants(c.id))];
}

// ---------------------------------------------------------------- management (administrators; or the device owner for local ones)

async function saveChange(next: CustomCategory, userId: string | null): Promise<Result<CustomCategory>> {
  if (next.local) {
    upsertCustomCategory(next);
    return { ok: true, value: next };
  }
  if (!(await isCategoryAdmin(userId))) return { ok: false, message: '공용 카테고리는 관리자만 바꿀 수 있습니다.' };
  const { error } = await supabase!.from('technique_categories').update(toRow(next)).eq('id', next.id);
  if (error) return { ok: false, message: error.message };
  upsertCustomCategory(next);
  return { ok: true, value: next };
}

/** Rename / describe. The category string of a top-level category never changes (its techniques keep pointing at it). */
export async function updateCategory(id: string, patch: { ko?: string; en?: string; description?: string }, userId: string | null): Promise<Result<CustomCategory>> {
  const c = getCustomCategory(id);
  if (!c) return { ok: false, message: '카테고리를 찾을 수 없습니다.' };
  const ko = (patch.ko ?? c.ko).trim();
  const en = (patch.en ?? c.en).trim();
  if (!ko || ko.length > 40 || en.length > 60) return { ok: false, message: '이름 길이를 확인해 주세요 (한국어 1~40자, 영어 60자 이하).' };
  if (ko !== c.ko || en !== c.en) {
    const same = findCategoryMatches({ art: c.art, parentId: c.parentId, ko, en }, id).filter((m) => m.kind === 'same' && !descendants(id).some((d) => d.id === m.nodeId));
    if (same.length) return { ok: false, message: `같은 이름의 카테고리가 이미 있습니다: ${same[0].path}`, matches: same };
  }
  return saveChange({ ...c, ko, en, description: (patch.description ?? c.description).trim().slice(0, 300), updatedAt: now() }, userId);
}

/** Moves a sub-category under another parent of the same art (never under itself / its own sub-categories). */
export async function moveCategory(id: string, newParentId: string, userId: string | null): Promise<Result<CustomCategory>> {
  const c = getCustomCategory(id);
  if (!c) return { ok: false, message: '카테고리를 찾을 수 없습니다.' };
  if (!c.parentId) return { ok: false, message: '대분류는 옮길 수 없습니다 (소속 기술의 카테고리 이름으로 정해진 분류입니다).' };
  if (!newParentId.startsWith(`${c.art}/`)) return { ok: false, message: '다른 무술의 카테고리로는 옮길 수 없습니다.' };
  if (newParentId === id || descendants(id).some((d) => d.id === newParentId)) return { ok: false, message: '자기 자신이나 하위 카테고리 아래로는 옮길 수 없습니다 (순환 참조).' };
  const parent = flattenPicker(categoryPickerTree(c.art)).find((n) => n.id === newParentId);
  if (!parent) return { ok: false, message: '옮길 상위 카테고리를 찾을 수 없습니다.' };
  // its techniques carry the group's category string (shared-library rows can't be rewritten) — so it stays in its group
  if (groupIdOf(c.art, newParentId) !== groupIdOf(c.art, c.parentId)) return { ok: false, message: '같은 대분류 안에서만 옮길 수 있습니다 (소속 기술의 카테고리가 대분류로 정해져 있어, 다른 대분류로 옮기면 기술과 분류가 어긋납니다). 다른 대분류의 카테고리와는 새로 만들어 등록해 주세요.' };
  const height = (x: string): number => 1 + Math.max(0, ...listCustomCategories().filter((d) => d.parentId === x).map((d) => height(d.id)));
  if (parent.level + height(id) > MAX_LEVEL) return { ok: false, message: `옮기면 ${MAX_LEVEL}단계를 넘습니다.` };
  const same = findCategoryMatches({ art: c.art, parentId: newParentId, ko: c.ko, en: c.en }, id).filter((m) => m.kind === 'same');
  if (same.length) return { ok: false, message: `옮길 위치에 같은 카테고리가 있습니다: ${same[0].path} — 통합을 사용해 주세요.`, matches: same };
  return saveChange({ ...c, parentId: newParentId, updatedAt: now() }, userId);
}

/** Merges a sub-category into another registry category of the same art; its techniques follow (ids unchanged). */
export async function mergeCategory(id: string, targetId: string, userId: string | null): Promise<Result<CustomCategory>> {
  const c = getCustomCategory(id);
  const target = getCustomCategory(resolveCategoryId(targetId));
  if (!c || !target) return { ok: false, message: '카테고리를 찾을 수 없습니다 (통합 대상은 사용자 카테고리여야 합니다).' };
  if (!c.parentId) return { ok: false, message: '대분류는 통합할 수 없습니다 (소속 기술의 카테고리 이름이 바뀌지 않기 때문입니다).' };
  if (c.art !== target.art) return { ok: false, message: '다른 무술의 카테고리와는 통합할 수 없습니다.' };
  if (groupIdOf(c.art, c.parentId) !== groupIdOf(c.art, target.parentId ?? target.id)) return { ok: false, message: '같은 대분류 안의 카테고리끼리만 통합할 수 있습니다.' };
  if (target.id === id || descendants(id).some((d) => d.id === target.id)) return { ok: false, message: '자기 자신이나 하위 카테고리로는 통합할 수 없습니다.' };
  if (descendants(id).length) return { ok: false, message: '하위 카테고리가 있는 카테고리는 먼저 하위 카테고리를 옮겨 주세요.' };
  return saveChange({ ...c, status: 'merged', mergedInto: target.id, updatedAt: now() }, userId);
}

export async function setCategoryActive(id: string, active: boolean, userId: string | null): Promise<Result<CustomCategory>> {
  const c = getCustomCategory(id);
  if (!c || c.status === 'merged') return { ok: false, message: '카테고리를 찾을 수 없습니다.' };
  return saveChange({ ...c, status: active ? 'active' : 'inactive', updatedAt: now() }, userId);
}

/** Only an unused category: no technique, no sub-category, nothing merged into it. */
export async function deleteCategory(id: string, userId: string | null, opts: { rollback?: boolean } = {}): Promise<Result<true>> {
  const c = getCustomCategory(id);
  if (!c) return { ok: false, message: '카테고리를 찾을 수 없습니다.' };
  if (categoryTechniques(id).length) return { ok: false, message: '이 카테고리에 기술이 있습니다. 다른 카테고리로 통합하거나 비활성화해 주세요.' };
  // a merged category stays as the forwarding record its techniques still point at
  if (getUnifiedTechniquesByMartialArt(c.art).some((t) => t.taxonomyNodeId === id)) return { ok: false, message: '이 카테고리를 가리키는 기술이 있어 삭제할 수 없습니다 (통합 기록은 남겨 둡니다).' };
  if (listCustomCategories().some((x) => x.parentId === id)) return { ok: false, message: '하위 카테고리가 있습니다. 먼저 옮기거나 삭제해 주세요.' };
  if (listCustomCategories().some((x) => x.mergedInto === id)) return { ok: false, message: '다른 카테고리가 이 카테고리로 통합되어 있어 삭제할 수 없습니다.' };
  if (!c.local) {
    // a creator may remove their own just-made, unused category (rollback of a failed registration)
    if (!opts.rollback && !(await isCategoryAdmin(userId))) return { ok: false, message: '공용 카테고리는 관리자만 삭제할 수 있습니다.' };
    const { error } = await supabase!.from('technique_categories').delete().eq('id', id);
    if (error) return { ok: false, message: error.message };
  }
  removeCustomCategory(id);
  return { ok: true, value: true };
}
