import type { GoalIntent } from './types';
import type { SubGoal } from './subGoals';
import { actionsOf, conceptsIn, positionsOf, relatedPositions } from './subGoals';
import { intentMultiplier } from './intentClassifier';
import { significantNameTokens } from './diversity';

// 목표별 근거 장부 — every web-search technique candidate is tied to ONE learning part (SubGoal), ONE
// canonical source URL, the verbatim sentence it came from and the source's kind, and judged on
// position/situation, technique family and purpose separately. A part is "covered" only by candidates
// judged relevant, counted as distinct techniques AND distinct sources (several techniques from one
// page are one source, not several).

export type SourceKind = 'video' | 'social' | 'forum' | 'article';

/** youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, m./www. → one key; tracking params and trailing slashes dropped. */
export function canonicalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();
  if (host === 'youtu.be') return `youtube:${u.pathname.slice(1).split('/')[0]}`;
  if (host.endsWith('youtube.com')) {
    const v = u.searchParams.get('v');
    if (v) return `youtube:${v}`;
    const m = /^\/(shorts|embed|live)\/([^/?#]+)/.exec(u.pathname);
    if (m) return `youtube:${m[2]}`;
    const list = u.searchParams.get('list');
    if (list) return `youtube-list:${list}`;
  }
  const keep = [...u.searchParams].filter(([k]) => !/^(utm_|fbclid|gclid|si$|feature$|ref$|igsh)/i.test(k));
  const qs = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  return `${host}${u.pathname.replace(/\/+$/, '')}${qs}`.toLowerCase();
}

export function sourceKind(url: string): SourceKind {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/.test(host)) return 'video';
  if (/instagram\.com|facebook\.com|tiktok\.com|twitter\.com|(^|\.)x\.com|threads\.net/.test(host)) return 'social';
  if (/reddit\.com|stackexchange\.com|quora\.com|forum|sherdog\.com\/forums|bjjheroes\.com\/forum/.test(host)) return 'forum';
  return 'article';
}

const QUOTE_WORD = /[a-z0-9가-힣']{2,}/g;
/** True when most of the quote's words really are in the source text that was handed to the extractor (anti-fabrication). */
export function quoteFoundInSource(quote: string, sourceText: string): boolean {
  const words = (quote.toLowerCase().match(QUOTE_WORD) ?? []).filter((w) => !['the', 'and', 'for', 'with', 'you', 'your', 'this', 'that'].includes(w));
  if (words.length === 0) return false;
  const hay = sourceText.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits / words.length >= 0.7;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();

export type DimResult = 'pass' | 'fail' | 'unknown' | 'na';
export type RelevanceVerdict = 'relevant' | 'uncertain' | 'irrelevant';

export interface EvidenceRecord {
  techniqueName: string;
  subGoalId: string;
  /** canonicalUrl() of the source. */
  sourceKey: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceKind: SourceKind;
  /** The extractor's verbatim sentence from the source. */
  quote: string;
  quoteVerified: boolean;
  /** Where the source says the technique is used (extractor's words). */
  appliesWhen: string;
  intentGuess: GoalIntent | 'unknown';
  purpose: string;
  martialArtGuess: string;
  /** The extractor's own fit judgement for this part. */
  modelFit: 'direct' | 'partial' | 'none' | 'missing';
  confidence: number;
  dims: { family: DimResult; position: DimResult; purpose: DimResult; model: DimResult };
  verdict: RelevanceVerdict;
  reasons: string[];
}

const ACTION_INTENT: Record<string, GoalIntent[]> = {
  escape: ['escape', 'defense', 'counter'],
  defense: ['defense', 'counter', 'escape'],
  takedown: ['attack', 'connection'],
  submission: ['attack'],
  sweep: ['attack', 'counter', 'escape'],
  guard_pass: ['attack'],
  strike: ['attack', 'counter'],
};

/**
 * Judges one candidate for one learning part on four separate axes — never on a single keyword hit:
 *  family    the candidate (name / quote / where-used) is the kind of technique the part asks for
 *  position  the quote, where-used text or the source title places it in the part's situation; naming only an
 *            unrelated position (side control for a body-triangle part) is a FAIL, naming none is UNKNOWN
 *  purpose   the candidate's own intent fits the part's intents (escape part ≠ attack technique)
 *  model     the extractor itself said it directly fits this part
 * relevant  = verified quote + model "direct" + no failing axis + every applicable axis passing
 * irrelevant = any axis failing
 * otherwise uncertain → shown for review, never counted as evidence.
 */
export function judgeRelevance(input: {
  part: SubGoal;
  techniqueName: string;
  quote: string;
  appliesWhen: string;
  sourceTitle: string;
  intentGuess: GoalIntent | 'unknown';
  modelFit: EvidenceRecord['modelFit'];
  quoteVerified: boolean;
}): { dims: EvidenceRecord['dims']; verdict: RelevanceVerdict; reasons: string[] } {
  const { part } = input;
  const reasons: string[] = [];
  const own = conceptsIn(`${input.techniqueName} ${input.quote} ${input.appliesWhen}`);
  const context = conceptsIn(`${input.quote} ${input.appliesWhen} ${input.sourceTitle}`);

  // technique family
  let family: DimResult = 'na';
  const wantedFamilies = part.actions.filter((a) => a !== 'defense' || part.actions.length === 1);
  if (wantedFamilies.length > 0) {
    const hasFamily = actionsOf(own).some((a) => wantedFamilies.includes(a));
    const viaIntent = input.intentGuess !== 'unknown' && wantedFamilies.some((a) => (a === 'escape' || a === 'defense') && ACTION_INTENT[a].includes(input.intentGuess as GoalIntent));
    family = hasFamily || viaIntent ? 'pass' : 'unknown';
    if (family === 'unknown') reasons.push(`요청한 기술 종류(${wantedFamilies.join('/')})로 확인되지 않음`);
  }

  // position / situation
  let position: DimResult = 'na';
  if (part.positions.length > 0) {
    const allowed = relatedPositions(part.positions);
    const named = positionsOf(context);
    if (named.some((p) => part.positions.includes(p) || allowed.has(p))) position = 'pass';
    else if (named.length > 0) {
      position = 'fail';
      reasons.push(`다른 포지션(${named.join(', ')})의 기술`);
    } else {
      position = 'unknown';
      reasons.push('자료에서 해당 상황/포지션이 확인되지 않음');
    }
  }

  // purpose
  let purpose: DimResult = 'na';
  if (part.intents.length > 0) {
    if (input.intentGuess === 'unknown') {
      purpose = 'unknown';
      reasons.push('기술의 목적이 불분명함');
    } else if (intentMultiplier(part.intents, [input.intentGuess]) === 0) {
      purpose = 'fail';
      reasons.push(`목적이 반대(${input.intentGuess})`);
    } else purpose = 'pass';
  }

  // a video/article title returned as if it were a technique name ("Body Triangle Escape By Gordon Ryan")
  const looksLikeTitle = / [Bb]y [A-Z][a-z]+|[|–]| - /.test(input.techniqueName) || (input.sourceTitle.length > 0 && norm(input.techniqueName) === norm(input.sourceTitle));
  if (looksLikeTitle) reasons.push('기술명이 아니라 자료 제목으로 보임');
  const model: DimResult = input.modelFit === 'direct' ? 'pass' : input.modelFit === 'none' ? 'fail' : 'unknown';
  if (model === 'fail') reasons.push('추출 단계에서 이 목표와 맞지 않는다고 판단');
  if (model === 'unknown') reasons.push('추출 단계에서 이 목표와의 직접 관련성이 확인되지 않음');
  if (!input.quoteVerified) reasons.push('근거 문장이 원문에서 확인되지 않음');

  const dims = { family, position, purpose, model };
  const axes = [family, position, purpose];
  let verdict: RelevanceVerdict;
  if (axes.includes('fail') || model === 'fail') verdict = 'irrelevant';
  else if (!looksLikeTitle && input.quoteVerified && model === 'pass' && axes.every((d) => d === 'pass' || d === 'na') && axes.some((d) => d === 'pass')) verdict = 'relevant';
  else verdict = 'uncertain';
  return { dims, verdict, reasons };
}

export interface PartCoverage {
  id: string;
  label: string;
  role: SubGoal['role'];
  covered: boolean;
  /** Distinct web-verified techniques (grade A, near-duplicate names merged). */
  techniques: { name: string; sources: string[] }[];
  /** Distinct canonical sources behind those techniques — one page with several techniques counts once. */
  independentSourceCount: number;
  /** MARTIALDEX DB-confirmed techniques for this part that are not already web-verified (grade B). */
  dbTechniques: { techniqueId: string; name: string }[];
  /** How the part was covered: web evidence alone, or web evidence supported by the DB. */
  coveredBy: 'web' | 'web+db' | null;
  required: { techniques: number; sources: number };
  reviewCount: number;
  irrelevantCount: number;
  /** Why it is not covered (null when covered). */
  reason: string | null;
}

/**
 * A part is covered by web evidence alone (2 techniques from 2 independent sources), or by at least one
 * web-verified technique plus MARTIALDEX DB confirmation making 2 distinct techniques. DB confirmation is
 * supporting evidence only: a part with no web-verified technique is never covered by the DB alone.
 * Deliberately independent of the curriculum's day count (a 30-day plan does not need 7 techniques).
 */
export const MIN_TECHNIQUES_PER_PART = 2;
export const MIN_SOURCES_PER_PART = 2;
export const MIN_WEB_TECHNIQUES_WITH_DB = 1;

function sameTechnique(a: string, b: string): boolean {
  const x = significantNameTokens(a);
  const y = significantNameTokens(b);
  if (x.size === 0 || y.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter) >= 0.6;
}

export function assessCoverage(parts: SubGoal[], records: EvidenceRecord[], db: { techniqueId: string; name: string; partId: string }[] = []): PartCoverage[] {
  return parts.map((part) => {
    const mine = records.filter((r) => r.subGoalId === part.id);
    const relevant = mine.filter((r) => r.verdict === 'relevant' && r.confidence >= 50);
    const techniques: { name: string; sources: string[] }[] = [];
    for (const r of relevant) {
      const t = techniques.find((x) => sameTechnique(x.name, r.techniqueName));
      if (t) {
        if (!t.sources.includes(r.sourceKey)) t.sources.push(r.sourceKey);
      } else techniques.push({ name: r.techniqueName, sources: [r.sourceKey] });
    }
    const independentSourceCount = new Set(techniques.flatMap((t) => t.sources)).size;
    const dbTechniques: { techniqueId: string; name: string }[] = [];
    for (const d of db) {
      if (d.partId !== part.id || dbTechniques.some((x) => x.techniqueId === d.techniqueId)) continue;
      if (techniques.some((t) => sameTechnique(t.name, d.name))) continue; // already web-verified → grade A, not counted twice
      dbTechniques.push({ techniqueId: d.techniqueId, name: d.name });
    }
    const required = { techniques: MIN_TECHNIQUES_PER_PART, sources: MIN_SOURCES_PER_PART };
    const byWeb = techniques.length >= required.techniques && independentSourceCount >= required.sources;
    // the DB must actually contribute — several techniques from ONE web page never stand in for a second source
    const byWebAndDb = !byWeb && dbTechniques.length > 0 && techniques.length >= MIN_WEB_TECHNIQUES_WITH_DB && techniques.length + dbTechniques.length >= required.techniques;
    const covered = byWeb || byWebAndDb;
    const reason = covered
      ? null
      : techniques.length === 0
        ? `웹에서 관련성이 검증된 기술 0개${dbTechniques.length > 0 ? ` (DB 확인 ${dbTechniques.length}개는 보조 근거라 단독으로 인정하지 않음)` : ''}`
        : techniques.length < required.techniques
          ? `웹 검증 기술 ${techniques.length}개 + DB 확인 ${dbTechniques.length}개 (필요 ${required.techniques}개)`
          : `서로 다른 출처 ${independentSourceCount}개 (필요 ${required.sources}개)`;
    return {
      id: part.id,
      label: part.label,
      role: part.role,
      covered,
      techniques,
      independentSourceCount,
      dbTechniques,
      coveredBy: byWeb ? 'web' : byWebAndDb ? 'web+db' : null,
      required,
      reviewCount: mine.filter((r) => r.verdict === 'uncertain').length,
      irrelevantCount: mine.filter((r) => r.verdict === 'irrelevant').length,
      reason,
    };
  });
}

export type ResearchStopReason =
  | 'SEARCH_FAILED'
  | 'NO_RESULTS'
  | 'EXTRACTION_FAILED'
  | 'NO_RELEVANT_RESULTS'
  | 'LOW_SOURCE_QUALITY'
  | 'CORE_GOAL_UNVERIFIED';

export const STOP_REASON_TEXT: Record<ResearchStopReason, string> = {
  SEARCH_FAILED: '웹 검색 요청 자체가 실패했습니다.',
  NO_RESULTS: '웹 검색은 성공했지만 결과가 없었습니다.',
  EXTRACTION_FAILED: '검색 자료를 분석하는 단계(AI 응답 형식 오류)가 실패했습니다. 자료가 부족하다는 뜻이 아니므로 잠시 후 다시 시도해 주세요.',
  NO_RELEVANT_RESULTS: '검색 자료는 있었지만 요청한 상황과 직접 관련된 기술이 확인되지 않았습니다.',
  LOW_SOURCE_QUALITY: '검색 자료가 대부분 본문이 없는 영상·SNS 게시물이라 기술을 확인할 근거가 부족했습니다.',
  CORE_GOAL_UNVERIFIED: '핵심 학습 목표의 근거가 기준(관련 기술·서로 다른 출처 수)을 충족하지 못했습니다.',
};

/** Per-stage numbers for one research run — returned on every outcome, shown on the stop / confirm screens. */
export interface ResearchDiagnostics {
  searchAttempted: boolean;
  searchSucceeded: boolean;
  tavilyCalls: number;
  queries: { query: string; subGoalId: string; ok: boolean; resultCount: number; newSourceCount: number }[];
  /** Every result the search provider returned (duplicates included). */
  rawResultCount: number;
  /** After canonical-URL de-duplication across all queries. */
  uniqueSourceCount: number;
  sourcesWithContent: number;
  sourceKinds: Record<SourceKind, number>;
  analyzedSourceCount: number;
  extraction: { calls: number; retries: number; failedBatches: number; failedSourceCount: number; lastErrorCode: string | null; lastErrorDetail: string | null };
  candidateRecords: number;
  relevantRecords: number;
  reviewRecords: number;
  irrelevantRecords: number;
  lowConfidenceRecords: number;
  parts: PartCoverage[];
  stopReason: ResearchStopReason | null;
}
