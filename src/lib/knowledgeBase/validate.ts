// Quality gate for curation candidates (pure — the caller passes DB lookups, so the
// same checks run in build scripts, tests and the app). A candidate with an
// `error` issue is never offered for approval.

import type { CurationCandidate, CurationStatus } from './types';

export interface TechniqueRef {
  id: string;
  martialArt: string;
  martialArts?: string[];
  name: string;
  koreanName: string | null;
  aliases?: string[];
  category: string;
  /** A technique linked to several arts files it per art (techniqueCanonical). */
  categoryByArt?: Record<string, string>;
}

const categoryIn = (t: TechniqueRef, art: string) => t.categoryByArt?.[art] ?? t.category;

export interface ValidationContext {
  techniqueById: (id: string) => TechniqueRef | undefined;
  /** Every official technique of an art (for duplicate-name checks). */
  techniquesOfArt: (art: string) => TechniqueRef[];
  /** The art's official categories (data/processed). */
  categoriesOf: (art: string) => string[];
  /** Sub-categories already in the hierarchy: parent category → titles. */
  subcategoriesOf: (art: string, parent: string) => string[];
  normalize: (name: string) => string;
}

export type IssueCode =
  | 'duplicate_id'
  | 'status_missing'
  | 'status_unsupported'
  | 'source_missing'
  | 'empty_text'
  | 'unknown_target'
  | 'wrong_art'
  | 'unknown_relation_target'
  | 'self_relation'
  | 'parent_category_missing'
  | 'duplicate_category'
  | 'member_not_in_parent'
  | 'duplicate_technique'
  | 'unknown_variation';

export interface ValidationIssue {
  id: string;
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
}

const STATUSES: CurationStatus[] = ['verified', 'multi_source', 'single_source', 'needs_review', 'insufficient', 'cannot_generate'];

const siteOf = (ref: string) => {
  try {
    return new URL(ref).hostname.replace(/^(www|m)\./, '');
  } catch {
    return ref.split('#')[0];
  }
};

export function validateCandidates(list: CurationCandidate[], ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (id: string, code: IssueCode, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ id, code, severity, message });
  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.id)) add(c.id, 'duplicate_id', '같은 id의 후보가 둘 이상');
    seen.add(c.id);

    // ---- status ↔ sources
    if (!c.status || !STATUSES.includes(c.status)) add(c.id, 'status_missing', '검증 상태 없음');
    const needsSource = c.status !== 'insufficient' && c.status !== 'cannot_generate';
    if (needsSource && !c.sources?.length) add(c.id, 'source_missing', '출처 없음');
    for (const s of c.sources ?? []) if (!s.ref || !s.quote?.trim()) add(c.id, 'source_missing', `출처의 위치 또는 인용문이 비어 있음 (${s.ref || '?'})`);
    const sites = new Set((c.sources ?? []).filter((s) => s.kind !== 'web' || s.quoteInBody).map((s) => siteOf(s.ref)));
    if (c.status === 'multi_source' && sites.size < 2) add(c.id, 'status_unsupported', `복수 자료 확인인데 독립 출처가 ${sites.size}곳`);
    if (c.status === 'single_source' && sites.size < 1) add(c.id, 'status_unsupported', '단일 자료 확인인데 본문에서 확인된 출처가 없음');
    // 'verified' is a person's decision (knowledge-review.json), never a generated status.
    if (c.status === 'verified' && c.createdBy.startsWith('script:')) add(c.id, 'status_unsupported', '스크립트가 만든 후보는 검증 완료가 될 수 없음(사람 검토 필요)');

    // ---- target
    const target = ctx.techniqueById(c.targetId);
    if (c.kind !== 'technique' && c.kind !== 'subcategory') {
      if (!target) add(c.id, 'unknown_target', `존재하지 않는 기술 id: ${c.targetId}`);
      else if (![target.martialArt, ...(target.martialArts ?? [])].includes(c.martialArt)) add(c.id, 'wrong_art', `${c.targetId}은(는) ${c.martialArt} 기술이 아님`);
    }
    if ((c.kind === 'description' || c.kind === 'korean_name') && needsSource && !c.text?.trim()) add(c.id, 'empty_text', '내용이 비어 있음');

    // ---- relation
    if (c.kind === 'relation') {
      const to = c.relation ? ctx.techniqueById(c.relation.toId) : undefined;
      if (!c.relation || !to) add(c.id, 'unknown_relation_target', `연결 대상 id가 없음: ${c.relation?.toId ?? '-'}`);
      else if (to.id === target?.id && c.relation.kind !== 'answers_situation') add(c.id, 'self_relation', '자기 자신으로의 연결');
      else if (c.relation.kind === 'answers_situation' && !c.relation.condition?.trim()) add(c.id, 'empty_text', '상황 설명이 없음');
    }

    // ---- sub-category
    if (c.kind === 'subcategory') {
      const sc = c.subcategory;
      const cats = ctx.categoriesOf(c.martialArt);
      if (!sc || !cats.includes(sc.parentCategory)) add(c.id, 'parent_category_missing', `상위 분류가 없음: ${sc?.parentCategory ?? '-'}`);
      else {
        const key = ctx.normalize(sc.title);
        const clash = [...cats, ...ctx.subcategoriesOf(c.martialArt, sc.parentCategory)].find((x) => ctx.normalize(x) === key);
        if (clash) add(c.id, 'duplicate_category', `이미 있는 분류와 같은 이름: ${clash}`);
        for (const id of sc.techniqueIds) {
          const t = ctx.techniqueById(id);
          if (!t) add(c.id, 'unknown_target', `존재하지 않는 기술 id: ${id}`);
          else if (categoryIn(t, c.martialArt) !== sc.parentCategory) add(c.id, 'member_not_in_parent', `${t.name}은(는) ${sc.parentCategory} 분류가 아님(${categoryIn(t, c.martialArt)})`);
        }
      }
    }

    // ---- new technique
    if (c.kind === 'technique' && c.technique) {
      const tn = c.technique;
      if (!ctx.categoriesOf(c.martialArt).includes(tn.category)) add(c.id, 'parent_category_missing', `상위 분류가 없음: ${tn.category}`);
      const keys = [tn.name, tn.koreanName ?? ''].filter(Boolean).map(ctx.normalize);
      const dup = ctx.techniquesOfArt(c.martialArt).find((t) => [t.name, t.koreanName ?? '', ...(t.aliases ?? [])].filter(Boolean).some((n) => keys.includes(ctx.normalize(n))));
      if (dup) add(c.id, 'duplicate_technique', `같은 이름의 기술이 이미 있음: ${dup.name} [${dup.id}]`);
      for (const v of tn.variationIds ?? []) if (!ctx.techniqueById(v)) add(c.id, 'unknown_variation', `변형 기술 id가 없음: ${v}`);
      if (needsSource && !tn.description.trim()) add(c.id, 'empty_text', '기술 설명이 비어 있음');
    }
  }
  return issues;
}

/** Candidates that can be offered to a reviewer: no error issue, and a status that has support. */
export function reviewable(list: CurationCandidate[], issues: ValidationIssue[]): CurationCandidate[] {
  const bad = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.id));
  return list.filter((c) => !bad.has(c.id) && c.status !== 'insufficient' && c.status !== 'cannot_generate');
}
