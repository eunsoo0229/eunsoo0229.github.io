// Compares techniques / setups / combos found on the web with the MARTIALDEX
// DB and gives each one an honest status. Candidates live in their own
// local store and are NEVER merged into the verified technique DB here.
//
// Status rules (evidence = quotes the extractor returned, re-checked in code):
//   duplicate          the same technique / same ordered sequence already exists
//   verified           quote verified in fetched page text on ≥2 independent sites
//   partially_verified quote verified in page text on exactly 1 site
//   pending            quotes only match search-engine snippets, or failed verification
//   insufficient       no evidence at all

import { quoteFoundInSource } from '../aiCurriculum/evidenceLedger';
import { resolveTechniqueName } from '../sharedCombo/dbCombos';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { findSameSequence } from './index';
import type { CandidateEvidence, CandidateStatus, KnowledgeCandidate, KnowledgeIndex, RawCandidate } from './types';

export interface SourceText {
  url: string;
  title?: string;
  content?: string;
  snippet?: string;
  sourceType?: string;
  publishedAt?: string;
}

export const MIN_VERIFIED_SITES = 2;

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
  } catch {
    return url;
  }
}

function checkEvidence(raw: RawCandidate['evidence'], sources: SourceText[]): CandidateEvidence[] {
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  return raw.map((e) => {
    const src = byUrl.get(e.url);
    if (!src) return { ...e, quoteVerified: false, checkedAgainst: 'none' as const };
    if (src.content && quoteFoundInSource(e.quote, src.content)) {
      return { ...e, title: e.title ?? src.title, sourceType: src.sourceType, publishedAt: src.publishedAt, quoteVerified: true, checkedAgainst: 'content' as const };
    }
    const inSnippet = !!src.snippet && quoteFoundInSource(e.quote, src.snippet);
    return { ...e, title: e.title ?? src.title, sourceType: src.sourceType, publishedAt: src.publishedAt, quoteVerified: false, checkedAgainst: inSnippet ? ('snippet' as const) : src.content ? ('content' as const) : ('none' as const) };
  });
}

function statusFromEvidence(ev: CandidateEvidence[]): { status: CandidateStatus; reasons: string[] } {
  if (!ev.length) return { status: 'insufficient', reasons: ['근거 자료 없음'] };
  const verifiedSites = new Set(ev.filter((e) => e.quoteVerified).map((e) => siteOf(e.url)));
  const snippetOnly = ev.filter((e) => !e.quoteVerified && e.checkedAgainst === 'snippet').length;
  if (verifiedSites.size >= MIN_VERIFIED_SITES) return { status: 'verified', reasons: [`서로 다른 사이트 ${verifiedSites.size}곳의 본문에서 인용 확인`] };
  if (verifiedSites.size === 1) return { status: 'partially_verified', reasons: [`본문 인용 확인 1곳(${[...verifiedSites][0]}) — 독립 출처 1곳 더 필요`] };
  if (snippetOnly) return { status: 'pending', reasons: ['검색 요약에서만 언급 확인 — 원문 본문 미확인'] };
  return { status: 'pending', reasons: ['인용문이 가져온 원문에서 확인되지 않음'] };
}

let seq = 0;
const newId = () => `cand_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * Classify one raw candidate. Unresolved steps of a combo/setup are returned
 * as separate technique candidates (never silently mapped to a near name).
 */
export function classifyCandidate(raw: RawCandidate, sources: SourceText[], index: KnowledgeIndex, now = new Date()): KnowledgeCandidate[] {
  const evidence = checkEvidence(raw.evidence, sources);
  const base = statusFromEvidence(evidence);
  const createdAt = now.toISOString();

  if (raw.kind === 'technique') {
    const hit = resolveTechniqueName(raw.name, raw.martialArt);
    if (hit) {
      return [{ id: newId(), kind: 'technique', name: raw.name, martialArt: raw.martialArt, status: 'duplicate', statusReasons: [`DB에 이미 있음: ${hit.name} [${hit.id}]`], evidence, duplicateOf: { kind: 'technique', id: hit.id, name: hit.name }, linkedTechniqueIds: [hit.id], unresolvedSteps: [], createdAt }];
    }
    return [{ id: newId(), kind: 'technique', name: raw.name, martialArt: raw.martialArt, status: base.status, statusReasons: ['DB에 없는 기술', ...base.reasons], evidence, linkedTechniqueIds: [], unresolvedSteps: [], createdAt }];
  }

  const names = (raw.steps ?? []).map((s) => s.trim()).filter(Boolean);
  const resolved = names.map((n) => resolveTechniqueName(n, raw.martialArt));
  const steps = names.map((n, i) => ({ name: n, techniqueId: resolved[i] ? canonicalTechniqueId(resolved[i]!.id) : null }));
  const unresolved = names.filter((_, i) => !resolved[i]);
  const linked = [...new Set(steps.map((s) => s.techniqueId).filter((x): x is string => !!x))];

  if (names.length < 2) {
    return [{ id: newId(), kind: raw.kind, name: raw.name, martialArt: raw.martialArt, steps, status: 'insufficient', statusReasons: ['동작 순서가 2단계 미만이라 셋업/콤보로 볼 수 없음'], evidence, linkedTechniqueIds: linked, unresolvedSteps: unresolved, createdAt }];
  }
  if (!unresolved.length) {
    const same = findSameSequence(steps.map((s) => s.techniqueId!), index);
    if (same) {
      return [{ id: newId(), kind: raw.kind, name: raw.name, martialArt: raw.martialArt, steps, status: 'duplicate', statusReasons: [`같은 순서가 이미 있음: ${same.name} [${same.id}]`], evidence, duplicateOf: { kind: 'sequence', id: same.id, name: same.name }, linkedTechniqueIds: linked, unresolvedSteps: [], createdAt }];
    }
  }
  const reasons = [unresolved.length ? `DB에 없는 단계 ${unresolved.length}개: ${unresolved.join(', ')}` : '모든 단계가 DB 기술과 연결됨 — 새 순서', ...base.reasons];
  // A sequence with unknown steps can't be fully verified until those techniques are.
  const status: CandidateStatus = unresolved.length && base.status === 'verified' ? 'partially_verified' : base.status;
  const out: KnowledgeCandidate[] = [{ id: newId(), kind: raw.kind, name: raw.name, martialArt: raw.martialArt, steps, status, statusReasons: reasons, evidence, linkedTechniqueIds: linked, unresolvedSteps: unresolved, createdAt }];
  for (const n of unresolved) {
    const forStep = raw.evidence.filter((e) => quoteFoundInSource(n, e.quote) || e.quote.toLowerCase().includes(n.toLowerCase()));
    out.push(...classifyCandidate({ kind: 'technique', name: n, martialArt: raw.martialArt, evidence: forStep }, sources, index, now));
  }
  return out;
}
