import type { Technique } from '../../types';
import { normalizeTechniqueName, findNormalizedDuplicate, getUnifiedTechniquesByMartialArt } from '../userTechniques/service';
import { isTechniqueInArt } from '../techniqueCanonical';
import { namesLikelySame } from '../aiCurriculum/diversity';
import { runExpandedWebResearch } from '../webSearch/expandedSearch';
import type { SearchResult } from '../webSearch/types';
import { verifyRequestedTechniqueFromEvidence } from './aiVerification';
import { insertAddTeqTechnique } from '../addTeq/service';
import { withGiNoGi } from '../grappling/analyzeNewTechnique';
import { withOtherArts } from '../techniqueCanonical/otherArts';
import { saveUserTechnique } from '../userTechniques/service';
import type { AddTeqRecord } from '../addTeq/types';
import type { UserTechniqueRecord } from '../userTechniques/types';
import type { DiscoveredTechniqueCandidate, SingleTechniqueVerificationOutcome, WebEvidenceSource } from './types';

const DEBUG = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
function log(...args: unknown[]) {
  if (DEBUG) console.debug('[MartialArtDiscovery]', ...args);
}

// Bounded per request — real Tavily calls cost real quota (free tier is
// 1,000/month).
const MAX_SOURCES_PER_EXTRACTION = 10;

function toWebEvidenceSources(sources: SearchResult[], indexes: number[]): WebEvidenceSource[] {
  return indexes
    .map((i) => sources[i - 1])
    .filter((s): s is SearchResult => !!s)
    .map((s) => ({ title: s.title, url: s.url, snippet: (s.content ?? s.snippet ?? '').slice(0, 300) }));
}

function buildTechniqueFromCandidate(martialArtId: string, candidate: DiscoveredTechniqueCandidate, id: string): Technique {
  return {
    id,
    martialArt: martialArtId,
    name: candidate.name,
    koreanName: candidate.nameKo,
    aliases: [],
    category: candidate.category,
    positions: [],
    description: candidate.description,
    purpose: null,
    principles: [],
    variations: [],
    counters: [],
    defenses: [],
    transitions: [],
    relatedTechniques: [],
    relatedMartialArts: [],
    difficulty: candidate.difficulty,
    tags: [],
    youtubeSearchQuery: `${candidate.name} tutorial`,
    videos: [],
    posture: candidate.posture ?? undefined,
    source: 'ai_web_research',
  };
}

// ===== 없는 기술 요청 (missing technique request) =====

const MAX_MISSING_TECHNIQUE_WAVES = 3;

/**
 * Spec section 6/7's requested-technique query builder — the martial art's
 * own name is included in EVERY query (never a bare technique-name search),
 * so a technique famous under the same/similar name in a different martial
 * art doesn't get misattributed just from a generic search. `extraWave`
 * (spec section 20's "추가 검색") appends one more, differently-worded wave
 * (federation/syllabus/forms framing) — bounded by MAX_MISSING_TECHNIQUE_WAVES,
 * matching runExpandedWebResearch's "caller decides the bound, never
 * open-ended" contract.
 */
function buildRequestedTechniqueSearchQueries(martialArtNameKo: string, martialArtNameEn: string | null, requestedName: string, extraWave: boolean): string[][] {
  const art = martialArtNameEn || martialArtNameKo;
  const waves = [
    [`${art} ${requestedName}`, `${art} technique ${requestedName}`, `${requestedName} ${art} martial arts`],
    [`${art} ${requestedName} tutorial`, `${requestedName} technique tutorial`, `${art} ${requestedName} training`],
  ];
  if (extraWave) {
    waves.push([`${requestedName} ${art} federation syllabus`, `${requestedName} ${art} forms technique`, `${art} ${requestedName} official technique list`]);
  }
  return waves.slice(0, MAX_MISSING_TECHNIQUE_WAVES);
}

/**
 * Spec "MARTIALDEX — 신규 무술 미등록 기술 요청 기능" — verifies ONE specific
 * technique for a SPECIFIC martial art (the martial art's own name/id is
 * always included in every query, per that spec's section 5, so a
 * technique famous in a DIFFERENT martial art never gets misattributed
 * here just because it shares a name). Works identically for an official
 * martial art or an add_teq-only one — the caller
 * only ever passes martialArtId/nameKo/nameEn, never a hardcoded branch.
 */
function findExistingTechniqueMatch(martialArtId: string, requestedName: string): Technique | undefined {
  // Scoped-to-this-art check first (name/koreanName/alias — mirrors
  // findNormalizedDuplicate's own alias handling, spec section 4).
  const target = normalizeTechniqueName(requestedName);
  const inArt = getUnifiedTechniquesByMartialArt(martialArtId);
  const scoped = inArt.find(
    (t) => normalizeTechniqueName(t.name) === target || (!!t.koreanName && normalizeTechniqueName(t.koreanName) === target) || t.aliases.some((a) => normalizeTechniqueName(a) === target)
  );
  if (scoped) return scoped;
  // Global exact/alias match, but only treated as a duplicate here when it
  // already belongs to THIS martial art — a same-named technique filed
  // under a different art is not "already exists" for this one (that's the
  // wrong_martial_art path, decided from real evidence, not from a name
  // collision alone).
  const exactAnywhere = findNormalizedDuplicate(requestedName);
  if (exactAnywhere && isTechniqueInArt(exactAnywhere, martialArtId)) return exactAnywhere;
  // Spec section 4's "유사 기술" check — same significantNameTokens/0.6
  // threshold rule dedupeCandidates already uses (via namesLikelySame),
  // reused here so AI-canonicalized name variance for the SAME real
  // technique (e.g. "Zheng Ti Tui" vs "Zheng Ti") doesn't slip past an
  // exact-normalize-only check and get registered a second time.
  const similar = inArt.find((t) => namesLikelySame(t.name, requestedName) || (!!t.koreanName && namesLikelySame(t.koreanName, requestedName)));
  if (similar) return similar;
  return undefined;
}

/**
 * Spec "MARTIALDEX — 신규 무술 미등록 기술 요청" — verifies ONE requested
 * technique (exact name or natural-language description) for a SPECIFIC
 * martial art, purely from real Tavily evidence handed to Gemini
 * (verifyRequestedTechniqueFromEvidence — never useSearchGrounding:true,
 * never Gemini's own prior knowledge). Works identically for an official
 * martial art or an add_teq-only one. `extraSearch`
 * (spec section 20) re-runs with one additional, differently-worded query
 * wave when the caller (UI's "추가 검색" button) asks for it, still bounded.
 */
export async function verifyMissingTechnique(
  martialArtId: string,
  martialArtNameKo: string,
  martialArtNameEn: string | null,
  requestedName: string,
  opts?: { extraSearch?: boolean }
): Promise<SingleTechniqueVerificationOutcome> {
  // 1) Existing-technique dedup FIRST, before any network call (spec section 4).
  const existing = findExistingTechniqueMatch(martialArtId, requestedName);
  if (existing) {
    return { status: 'already_exists', existingTechniqueId: existing.id, existingTechniqueName: existing.name, executedQueries: [], wavesRun: 0 };
  }

  // 2) Real Tavily search WITH the martial art's own name in every query
  // (never a bare technique-name-only search — spec section 5/6's core rule).
  const queryWaves = buildRequestedTechniqueSearchQueries(martialArtNameKo, martialArtNameEn, requestedName, !!opts?.extraSearch);
  const research = await runExpandedWebResearch(queryWaves);
  if (!research.ok) {
    if (research.notConfigured) {
      return { status: 'search_unavailable', executedQueries: [], wavesRun: 0, errorMessage: 'Tavily 웹 검색이 설정되어 있지 않습니다.' };
    }
    return { status: 'insufficient_web_evidence', executedQueries: research.executedQueries, wavesRun: research.wavesRun, errorMessage: research.errorMessage };
  }

  const sourcesForVerification = research.collected.slice(0, MAX_SOURCES_PER_EXTRACTION);
  const verification = await verifyRequestedTechniqueFromEvidence(martialArtNameKo, martialArtNameEn, requestedName, sourcesForVerification);
  if (!verification.ok) {
    return { status: 'insufficient_web_evidence', executedQueries: research.executedQueries, wavesRun: research.wavesRun, errorMessage: verification.message };
  }

  const v = verification.verdict;
  log('requested technique verdict', v);

  if (v.verdict === 'wrong_martial_art') {
    return {
      status: 'wrong_martial_art',
      likelyMartialArt: v.likelyMartialArt,
      executedQueries: research.executedQueries,
      wavesRun: research.wavesRun,
      errorMessage: v.reason,
    };
  }
  if (v.verdict === 'not_a_technique') {
    return { status: 'not_a_technique', executedQueries: research.executedQueries, wavesRun: research.wavesRun, errorMessage: v.reason };
  }

  const CONFIDENCE_FLOOR = 50;
  const evidencedCandidates = v.verdict === 'confirmed' ? v.candidates.filter((c) => c.confidence >= CONFIDENCE_FLOOR && c.sourceIndexes.length > 0) : [];
  if (evidencedCandidates.length === 0) {
    return {
      status: 'insufficient_web_evidence',
      executedQueries: research.executedQueries,
      wavesRun: research.wavesRun,
      errorMessage: v.reason || `요청한 기술이 "${martialArtNameKo}"의 기술이라는 충분한 웹 근거를 찾지 못했습니다.`,
    };
  }

  const toCandidate = (c: (typeof evidencedCandidates)[number]): DiscoveredTechniqueCandidate => ({
    name: c.name,
    nameKo: c.nameKo,
    category: c.category,
    description: c.description,
    sources: toWebEvidenceSources(sourcesForVerification, c.sourceIndexes),
    confidence: c.confidence,
    selected: true,
    posture: c.posture,
    difficulty: c.difficulty,
  });

  if (evidencedCandidates.length > 1) {
    return { status: 'multiple_candidates', candidates: evidencedCandidates.map(toCandidate), executedQueries: research.executedQueries, wavesRun: research.wavesRun };
  }

  return { status: 'verified', candidate: toCandidate(evidencedCandidates[0]), executedQueries: research.executedQueries, wavesRun: research.wavesRun };
}

/** Registers a single verified missing-technique candidate — reuses the EXISTING add_teq/user_techniques dual-path (registerDiscoveredTechnique's own logic, mirrored here since that function expects a full UserTechniqueRecord with the OLD grounding-based verification shape). */
export async function registerMissingTechnique(
  martialArtId: string,
  candidate: DiscoveredTechniqueCandidate,
  userId: string | null
): Promise<{ ok: true; techniqueId: string } | { ok: false; code: 'already_exists'; existingTechniqueId: string; existingTechniqueName: string } | { ok: false; code: 'error'; message: string }> {
  // Spec section 23's "등록 직전 최종 중복 검사" — re-checks right before the
  // write, not just at request time, so two concurrent requests (or the same
  // user re-confirming a stale preview) never create a duplicate row.
  const dupe = findExistingTechniqueMatch(martialArtId, candidate.name) ?? (candidate.nameKo ? findExistingTechniqueMatch(martialArtId, candidate.nameKo) : undefined);
  if (dupe) {
    return { ok: false, code: 'already_exists', existingTechniqueId: dupe.id, existingTechniqueName: dupe.name };
  }

  const now = new Date().toISOString();
  const id = `${martialArtId}__${candidate.name.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'technique'}`;
  // Researched before saving (add_teq rows can't be updated later): Gi / No-Gi split + the sibling arts that also use it.
  const base = buildTechniqueFromCandidate(martialArtId, candidate, id);
  const [gi, arts] = await Promise.all([withGiNoGi(base), withOtherArts(base)]);
  const technique = { ...arts, ...(gi.giNoGi ? { giNoGi: gi.giNoGi } : {}) };
  const record: UserTechniqueRecord = {
    id,
    technique,
    status: 'approved',
    addedByUserId: userId,
    duplicateCheck: { isDuplicate: false, matchedTechniqueId: null, matchedTechniqueName: null, reason: '없는 기술 요청 — 웹 검색 기반으로 새로 발견됨' },
    verification: {
      verdict: 'confirmed',
      confidence: candidate.confidence,
      martialArtConfirmed: martialArtId,
      category: candidate.category,
      canonicalName: candidate.name,
      evidenceNotes: [candidate.description],
      groundingSources: candidate.sources.map((s) => ({ title: s.title, uri: s.url })),
      usedSearchGrounding: true,
      reason: candidate.description,
    },
    createdAt: now,
    updatedAt: now,
  };

  if (!userId) {
    const saved = saveUserTechnique(record, null);
    return { ok: true, techniqueId: saved.id };
  }
  const addTeqRecord: AddTeqRecord = { id: record.id, technique: record.technique, status: 'approved', duplicateCheck: record.duplicateCheck, verification: record.verification, createdAt: record.createdAt, updatedAt: record.updatedAt };
  const inserted = await insertAddTeqTechnique(addTeqRecord);
  if (inserted.ok) return { ok: true, techniqueId: addTeqRecord.id };
  const saved = saveUserTechnique(record, userId);
  return { ok: true, techniqueId: saved.id };
}
