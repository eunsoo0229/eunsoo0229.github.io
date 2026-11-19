import { askGeminiForJsonWithGrounding } from '../userTechniques/geminiJson';
import type { AiErrorCode, GroundingSource } from '../ai/types';
import type { GoalAnalysis, GoalIntent, ResearchMode, SearchStatus } from './types';
import { intentMultiplier } from './intentClassifier';
import { significantNameTokens } from './diversity';
import { MMA_MARTIAL_ART_ID, MMA_SOURCE_MARTIAL_ARTS } from '../mmaCurriculum/types';
import { getMartialArt } from '../loadData';
import { webSearchProvider } from '../webSearch/provider';
import { aiProvider } from '../ai/provider';
import { resolveSubGoals, type SubGoal } from './subGoals';
import { MAX_QUERIES_PER_WAVE, queriesForPart, runWebEvidenceResearch, type ReviewItem, type WebEvidenceDeps } from './webEvidenceResearch';
import type { ResearchDiagnostics, SourceKind } from './evidenceLedger';
import { findDbEvidence, type DbEvidenceTechnique } from './dbEvidence';

const DEBUG = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
function log(...args: unknown[]) {
  // Dev-only pipeline trace (spec section 19) — never logs API keys/tokens,
  // only the same goal/technique text already visible in the UI.
  if (DEBUG) console.debug('[CurriculumResearch]', ...args);
}

/**
 * Structured `[CURRICULUM_*] key=value ...` trace lines (spec section 27) —
 * grep-able by tag, dev-only, and never includes the API key or raw request
 * headers (only the same query text/counts already surfaced in the UI).
 */
function structuredLog(tag: string, fields: Record<string, string | number | boolean>) {
  if (!DEBUG) return;
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`);
  console.debug(`[${tag}] ${parts.join(' ')}`);
}

export interface ResearchedTechnique {
  name: string;
  martialArtGuess: string;
  purpose: string;
  intentGuess: GoalIntent | 'unknown';
  /** Free-text provenance note (site name/URL, or "general knowledge (no live search)" for the ungrounded fallback) — kept for backward compatibility; prefer sourceUrls/sourceTitles below when researchMode is 'web_search'. */
  source: string;
  /** Real URLs the technique was actually found in (web_search mode only — never fabricated; empty for grounded/knowledge_fallback since those don't retrieve real pages). */
  sourceUrls?: string[];
  sourceTitles?: string[];
  /** Short quote/paraphrase of what in the source actually mentions this technique — required for web_search mode to count as more than a name-drop. */
  evidence?: string;
  /** 0-100, Gemini's own confidence that this is a real, correctly-named technique given the evidence available. Candidates below CONFIDENCE_UNCERTAIN_THRESHOLD are marked 'uncertain' and excluded from auto-merge (spec section 13/14). */
  confidence?: number;
  /** web_search only: the learning part (SubGoal id) this technique is evidence for. */
  partId?: string;
  sourceKinds?: SourceKind[];
}

export interface ExcludedResearchTechnique {
  name: string;
  reason: string;
}

export interface TechniqueResearchOutcome {
  ok: boolean;
  status: SearchStatus;
  /** After goal-opposite exclusion + de-dup — safe to merge into desiredTechniques. */
  techniques: ResearchedTechnique[];
  /** Dropped for conflicting with the goal's intent, or as a near-duplicate of an already-kept name — spec sections 4/15's "제외된 항목" transparency. */
  excluded: ExcludedResearchTechnique[];
  /** How many Gemini returned before any filtering below ran. */
  rawCount: number;
  /** Researched results dropped because their own intentGuess directly conflicts with the goal's intents (spec 1-4). Subset of `excluded`. */
  excludedOppositeCampCount: number;
  usedSearchGrounding: boolean;
  groundingSources: GroundingSource[];
  /** The angle-queries this call explicitly instructed Gemini's search tool to cover (spec section 4) — a PLAN, not a guarantee of what Gemini's tool actually ran; see `actualSearchQueries` for that. */
  plannedQueries: string[];
  /** Gemini's own `groundingMetadata.webSearchQueries` — the REAL queries its search tool issued, when the API reports them. Empty when unavailable (never fabricated to match plannedQueries). */
  actualSearchQueries: string[];
  errorMessage?: string;
  /** How these candidates were obtained — see ResearchMode's doc comment in types.ts. */
  researchMode: ResearchMode;
  /** True only for researchMode 'web_search' — a real webSearchProvider call actually ran and returned >=1 result. Never true when results came from Gemini's own knowledge (spec section 25). */
  usedExternalWebSearch: boolean;
  /** The literal query strings actually sent to the web search provider (web_search mode) — ground truth, not inferred, unlike actualSearchQueries above which depends on Gemini self-reporting what its grounding tool did. */
  executedQueries: string[];
  /** Raw result count returned by the web search provider, before any extraction/filtering (web_search mode only; 0 otherwise). */
  searchResultCount: number;
  /** How many distinct sources were actually fed to Gemini for technique extraction (web_search mode only; 0 otherwise). */
  analyzedSourceCount: number;
  /** How many search waves actually ran (1 = initial only, up to 1 + MAX_EXPANSION_WAVES) — spec section 9/26's expansion-search accounting. 0 for non-web_search/insufficient_web_evidence modes. */
  wavesRun: number;
  /** The request's learning parts (subGoals.ts) — set whenever web search was attempted. */
  subGoals?: SubGoal[];
  /** Per-stage numbers and per-part coverage of the web search (evidenceLedger.ts). */
  diagnostics?: ResearchDiagnostics;
  /** Candidates whose relevance could not be confirmed — shown for review, never counted or merged. */
  review?: ReviewItem[];
  /** Every core part has evidence but some follow-up parts do not: the curriculum may be built from the covered parts only, after the user confirms. */
  partial?: { includedIds: string[]; excluded: { id: string; label: string; reason: string }[] } | null;
  /** Grade-B candidates: MARTIALDEX DB techniques whose own posture data matches a learning part (dbEvidence.ts). */
  dbEvidence?: DbEvidenceTechnique[];
}

// A topic phrase containing any Hangul syllable is exactly the "Korean text
// mechanically glued into an English search template" bug this function
// used to produce (e.g. "다양한 테이크다운 스타일 techniques") — filtered out
// as a last-resort defensive check even though analysis.searchTopics is
// supposed to already be clean (goalAnalysis.ts's prompt instructs Gemini
// to keep it English/romanized-only); a stray Korean topic is dropped
// rather than shipped as a broken query.
const HANGUL_RE = /[가-힣]/;

/**
 * Deterministic, code-level floor — never depends on any single Gemini JSON
 * field. `analysis.martialArt` is always a real resolved id by the time this
 * runs (analyzeGoal always sets it, defaulting to the user's own dropdown
 * choice), so this can never come back empty. This is what guarantees Tavily
 * is actually attempted on every real generation (spec section 1's mandatory
 * pipeline order) instead of silently skipping web search whenever Gemini's
 * `searchTopics` happens to come back empty/thin AND every legacy phrase
 * happens to be Korean (this was the confirmed root cause of curricula
 * showing "AI 기본 지식 사용" even when Tavily was correctly configured —
 * attemptWebSearch()'s very first line returns null when plannedQueries is
 * empty, which fell through to Google Search grounding, which is
 * billing-gated on the free tier, which then fell to knowledge_fallback).
 */
function buildDeterministicFallbackAngles(martialArtId: string, intents: GoalIntent[]): string[] {
  const artTerm = martialArtId === MMA_MARTIAL_ART_ID ? 'mixed martial arts (MMA)' : martialArtId.replace(/-/g, ' ');
  const angles = [`${artTerm} techniques`];
  const intentTerm = intents.find((i) => VALID_GOAL_INTENTS.has(i));
  if (intentTerm) angles.push(`${artTerm} ${intentTerm} techniques`);
  return angles;
}

/**
 * spec section 4/5: never a single "user text verbatim" query, and never a
 * Korean phrase mechanically glued into an English template. Builds from
 * `analysis.searchTopics` — the clean, search-engine-friendly English/
 * romanized phrases goalAnalysis.ts's prompt asks Gemini to produce
 * specifically for this purpose (kept separate from desiredTechniques/goals/
 * priority, which preserve the user's own wording — including Korean and
 * diversity-adjective clutter — for relevance-scoring, not for search).
 * Falls back to the old priority/goals/weaknesses/desiredTechniques phrases
 * when searchTopics came back empty, and even then, drops any topic that
 * still contains Hangul rather than building a mashup query from it. If
 * BOTH of those come up empty (a real, observed failure mode — Gemini is
 * not guaranteed to populate searchTopics, and a Korean-speaking user's
 * legacy phrases are usually Korean), falls all the way to
 * buildDeterministicFallbackAngles so this function can never return [].
 */
function extractCleanOrLegacyTopics(analysis: GoalAnalysis): string[] {
  const cleanTopics = (analysis.searchTopics ?? []).filter((t) => typeof t === 'string' && t.trim() && !HANGUL_RE.test(t));
  const legacyTopics = [...new Set([...analysis.priority, ...analysis.goals, ...analysis.weaknesses, ...analysis.desiredTechniques])]
    .filter((t) => t.trim() && !HANGUL_RE.test(t));
  return (cleanTopics.length > 0 ? cleanTopics : legacyTopics).slice(0, 3);
}

export function buildResearchAngles(analysis: GoalAnalysis, diversityRequested: boolean): string[] {
  const topics = extractCleanOrLegacyTopics(analysis);
  if (topics.length === 0) return buildDeterministicFallbackAngles(analysis.martialArt, analysis.intents ?? []);
  const angles: string[] = [];
  for (const topic of topics) {
    // searchTopics sometimes already ends in "technique(s)" (Gemini's own
    // phrasing) — avoid the redundant "wrestling takedown techniques
    // techniques" query this produced before.
    const withTechniques = /techniques?$/i.test(topic.trim()) ? topic.trim() : `${topic} techniques`;
    angles.push(withTechniques);
    if (diversityRequested) {
      angles.push(`different types of ${topic}`);
      angles.push(`${topic} variations`);
    }
  }
  return [...new Set(angles)].slice(0, diversityRequested ? 9 : 6);
}

const VALID_GOAL_INTENTS = new Set<string>(['attack', 'defense', 'escape', 'counter', 'connection', 'fundamentals']);
const VALID_INTENT_GUESS = new Set<string>([...VALID_GOAL_INTENTS, 'unknown']);

function isResearchArray(v: unknown): v is ResearchedTechnique[] {
  return (
    Array.isArray(v) &&
    v.every((x) => {
      if (!x || typeof x !== 'object') return false;
      const o = x as Record<string, unknown>;
      return (
        typeof o.name === 'string' &&
        o.name.trim().length > 0 &&
        typeof o.martialArtGuess === 'string' &&
        typeof o.purpose === 'string' &&
        typeof o.intentGuess === 'string' &&
        VALID_INTENT_GUESS.has(o.intentGuess) &&
        typeof o.source === 'string'
      );
    })
  );
}

// Below this, a web_search-mode candidate is excluded outright (spec section
// 14's "uncertain은 자동 포함하지 않는다") rather than merely flagged low.
const CONFIDENCE_UNCERTAIN_THRESHOLD = 50;

// Codes that mean search couldn't even be ATTEMPTED (config/auth problem),
// as opposed to an attempt that ran and failed — see SearchStatus's doc
// comment in types.ts. Exported so the UI/tests can reason about the same
// classification without duplicating it.
const SEARCH_UNAVAILABLE_CODES = new Set<AiErrorCode | 'PARSE_ERROR'>(['NO_API_KEY', 'INVALID_API_KEY', 'UNAUTHORIZED']);
// Codes plausibly transient/format-related — worth exactly one retry with a
// reformulated prompt. RATE_LIMIT/NETWORK/NO_API_KEY/INVALID_API_KEY/
// UNAUTHORIZED are deliberately excluded: retrying an unchanged request
// against the same failure mode just burns another call (and, for
// RATE_LIMIT, more of an already-exhausted quota) without fixing anything.
const RETRYABLE_CODES = new Set<AiErrorCode | 'PARSE_ERROR'>(['EMPTY_RESPONSE', 'PARSE_ERROR', 'UNKNOWN']);

/**
 * Same rawCount/keptCount → SUCCESS/PARTIAL/FAILED thresholds used by both
 * the primary grounded flow (deriveSearchStatus below) and the knowledge-
 * fallback flow (researchTechniquesForGoal's ungrounded retry) — extracted
 * so the two paths can never silently drift apart. Behavior-preserving
 * extraction: deriveSearchStatus's own test suite still exercises the exact
 * same thresholds through this function.
 */
function bucketByCount(rawCount: number, keptCount: number): SearchStatus {
  // Test 3 (spec section 12): an empty array is NOT success, even though
  // the HTTP call itself succeeded — the old behavior conflated these.
  if (rawCount === 0) return 'SEARCH_FAILED';
  if (keptCount === 0) return 'SEARCH_PARTIAL';
  // Most of what came back was filtered out as opposite-camp/duplicate —
  // the attempt wasn't a failure, but it was thin (Test 4).
  if (keptCount < Math.max(2, Math.ceil(rawCount * 0.34))) return 'SEARCH_PARTIAL';
  return 'SEARCH_SUCCESS';
}

/**
 * Pure, side-effect-free — the ONLY place a raw Gemini outcome becomes a
 * SearchStatus, so it's unit-testable without a network call (spec section
 * 12's Test 1-5) and every caller agrees on the same classification.
 * `rawCount` is Gemini's own array length before any filtering; `keptCount`
 * is what survived opposite-camp exclusion + near-duplicate dedup.
 */
export function deriveSearchStatus(params: {
  ok: boolean;
  code?: AiErrorCode | 'PARSE_ERROR';
  usedSearchGrounding: boolean;
  rawCount: number;
  keptCount: number;
}): SearchStatus {
  if (!params.ok) {
    return params.code && SEARCH_UNAVAILABLE_CODES.has(params.code) ? 'SEARCH_NOT_AVAILABLE' : 'SEARCH_FAILED';
  }
  // Requested grounding but the API didn't actually report running it —
  // treat as unavailable rather than silently presenting an ungrounded
  // (AI-prior-knowledge) response as if it were a real search result. Only
  // applies to THIS (primary, grounding-requested) path — the deliberate
  // knowledge-fallback attempt below is a separate, explicitly-labeled mode
  // and never runs through this function.
  if (!params.usedSearchGrounding) return 'SEARCH_NOT_AVAILABLE';
  return bucketByCount(params.rawCount, params.keptCount);
}

/**
 * Section 1-3's "인터넷에서 목적에 필요한 실제 기술 조사" — the one genuinely
 * missing stage identified by investigating the existing pipeline (matching,
 * discovery/verification, hard intent exclusion, phase planning all already
 * exist and are left untouched — see techniqueMatcher.ts/intentClassifier.ts/
 * curriculumPlanner.ts). Runs Gemini WITH Google Search grounding — the same
 * `useSearchGrounding` flag userTechniques/verification.ts already uses to
 * verify a single technique's existence — one step earlier, to discover
 * candidate technique NAMES for the analyzed goal instead of confirming one
 * name already in hand.
 *
 * Best-effort for CURRICULUM GENERATION — a failed/thin research call never
 * blocks generation, the caller continues with the AI's-prior-knowledge-only
 * desiredTechniques it already had. It is NOT silently treated as success,
 * though: `status` always reflects what genuinely happened (spec section
 * 2/17 — "검색 실패를 검색 성공으로 취급하지 않는다"), and the caller
 * (service.ts) surfaces that status to the user instead of the old blanket
 * "AI 기존 지식만으로 진행 (품질 영향 없음)" claim.
 */
export async function researchTechniquesForGoal(
  analysis: GoalAnalysis,
  martialArt: string,
  // kept for callers; evidence sufficiency no longer depends on the day count (per-part coverage instead)
  _totalDays: number = 14,
  opts: { freeText?: string; deps?: Partial<WebEvidenceDeps> } = {}
): Promise<TechniqueResearchOutcome> {
  const artScope =
    martialArt === MMA_MARTIAL_ART_ID
      ? `MMA(다음 실제 무술들의 조합 — ${MMA_SOURCE_MARTIAL_ARTS.join(', ')})`
      : (getMartialArt(martialArt)?.nameKo ?? martialArt);

  const diversityRequested = analysis.diversityRequested === true;
  const plannedQueries = buildResearchAngles(analysis, diversityRequested);

  /**
   * The SAME intent + confidence + near-duplicate filtering the final
   * return value always applied (spec sections 11/13/14) — extracted so the
   * web-search expansion loop below can run it cumulatively after every
   * wave to decide "do we have enough validated evidence yet", using the
   * exact same rules the final result will be judged by, not a looser
   * preview check.
   */
  function filterResearchedTechniques(
    raw: ResearchedTechnique[],
    mode: ResearchMode
  ): { techniques: ResearchedTechnique[]; excluded: ExcludedResearchTechnique[]; excludedOppositeCampCount: number } {
    const excluded: ExcludedResearchTechnique[] = [];
    let excludedOppositeCampCount = 0;
    const afterIntentFilter = raw.filter((r) => {
      if (!VALID_GOAL_INTENTS.has(r.intentGuess)) return true; // 'unknown' — let downstream classification decide
      const conflicts = intentMultiplier(analysis.intents, [r.intentGuess as GoalIntent]) === 0;
      if (conflicts) {
        excludedOppositeCampCount++;
        excluded.push({ name: r.name, reason: `목표와 반대되는 의도(${r.intentGuess})로 조사됨` });
      }
      return !conflicts;
    });

    // Spec section 14's "uncertain은 최종 커리큘럼에 자동 포함하지 마라" — only
    // meaningful for web_search-sourced candidates, where confidence is
    // grounded in actual retrieved evidence rather than Gemini's own
    // self-assessment of its prior knowledge.
    const afterConfidenceFilter = afterIntentFilter.filter((r) => {
      if (mode !== 'web_search' || typeof r.confidence !== 'number') return true;
      const uncertain = r.confidence < CONFIDENCE_UNCERTAIN_THRESHOLD || !r.evidence?.trim() || !r.sourceUrls?.length;
      if (uncertain) excluded.push({ name: r.name, reason: `근거가 충분하지 않아 확정할 수 없음(confidence ${r.confidence})` });
      return !uncertain;
    });

    // Spec section 10/15's dedup applied AT THE RESEARCH STAGE too — Gemini
    // itself sometimes returns near-duplicate names ("Double Leg" /
    // "Double-Leg Takedown" / "Basic Double Leg") across different search
    // angles/waves.
    const kept: ResearchedTechnique[] = [];
    const keptTokenSets: Set<string>[] = [];
    for (const r of afterConfidenceFilter) {
      const tokens = significantNameTokens(r.name);
      const dupIndex = keptTokenSets.findIndex((existing) => {
        if (existing.size === 0 || tokens.size === 0) return false;
        let intersection = 0;
        for (const t of tokens) if (existing.has(t)) intersection++;
        return intersection / (existing.size + tokens.size - intersection) >= 0.6;
      });
      if (dupIndex >= 0) {
        excluded.push({ name: r.name, reason: `이미 조사된 "${kept[dupIndex].name}"와 사실상 동일한 기술(중복)` });
        continue;
      }
      kept.push(r);
      keptTokenSets.push(tokens);
    }

    return { techniques: kept, excluded, excludedOppositeCampCount };
  }

  const intentLine =
    analysis.intents.length > 0
      ? `이 목적의 훈련 의도는 [${analysis.intents.join(', ')}] 중심이다 — 반드시 이 의도에 맞는 기술만 조사한다(반대 의도의 기술은 ` +
        '절대 포함하지 않는다. 예: 의도가 "defense"인데 상대를 제압하는 "attack" 성격의 진입 기술을 포함하면 안 된다).'
      : '';

  // Spec section 6/7's core fix: explicitly tells the researcher to
  // distinguish "이 목적을 위해 배워야 하는 사전 준비 동작"에서 "그 주제 자체인
  // 핵심 기술"을 구분하고, 다양성이 요청된 경우 서로 다른 메커니즘을 우선하라고
  // 지시한다 — Gemini's own research call was previously given NO signal at
  // all about this distinction, so it had no reason not to return generic
  // supporting skills as if they were on-topic finds.
  const diversityLine = diversityRequested
    ? [
        '사용자가 이 주제 "안에서의 다양성/폭"을 명시적으로 요청했다 — 다음을 반드시 지킨다:',
        '1) 핸드파이팅/그립 싸움, 브릿지, 히프 이스케이프, 기본 자세/스탠스, 풋워크, 컨디셔닝 같은 "이 주제를 배우기 위한 사전',
        '   준비 동작"은 절대 포함하지 않는다 — 오직 그 주제 자체인 구체적이고 서로 다른 명명된 기술만 조사한다.',
        '2) 같은 기술의 사소한 변형(예: "Double Leg" / "Double Leg Variation 1/2/3")을 여러 개 채워 넣지 않는다 — 가능한 한',
        '   서로 다른 메커니즘/진입 방식의 기술을 우선한다(예: 더블레그, 싱글렉, 발목픽, 바디락, 던지기 계열을 고르게).',
        '3) 위 planned research angles(아래 목록)의 각 관점을 실제로 검색해서 서로 다른 기술을 찾아본다.',
      ].join('\n')
    : [
        '사용자가 이 주제를 "처음부터 배우는" 목적이면(다양성 요청이 아니면) 사전 준비 동작(스탠스/핸드파이팅/그립 등)도',
        '정당한 결과다 — 이 경우 위 2)/3)의 다양성 제약은 적용하지 않는다.',
      ].join('\n');

  const anglesLine = plannedQueries.length > 0 ? `참고할 조사 관점(이 목록의 각 항목을 실제로 검색해볼 것): ${plannedQueries.join(' | ')}` : '';

  // Grounding with Google Search requires a billing-enabled Gemini project
  // — confirmed both by Google's own pricing page (ai.google.dev/gemini-api/
  // docs/pricing: "Not available" on the free tier for gemini-3.6-flash and
  // gemini-3.1-flash-lite) and by direct empirical testing (identical 429
  // RESOURCE_EXHAUSTED regardless of the tools[] key casing, while the exact
  // same ungrounded request on the same key succeeds). MARTIALDEX ships with
  // a free-tier key (see .env.example), so grounding can genuinely never
  // succeed on it without enabling billing — not a code bug. `groundedInstruction`
  // is used for the primary attempt; if that's gated, `attempt(..., false)`
  // below builds a DELIBERATELY different, explicitly-non-grounded prompt
  // (never the same text with the tool silently dropped) so a human reading
  // the prompt/response can never mistake this for "we searched the web".
  function buildSystemInstruction(grounded: boolean): string {
    const openingLine = grounded
      ? 'Google 검색을 사용해 실제로 존재하는 무술 기술만 조사하는 리서처 역할을 한다. 절대 기술을 지어내지 않는다.'
      : [
          '실시간 인터넷 검색은 이번 요청에서 사용할 수 없다 — 당신이 이미 알고 있는 지식만으로 답해야 한다.',
          '따라서 확신이 없거나 잘 알려지지 않은 기술은 절대 포함하지 마라. 오직 해당 무술에서 널리 알려진, 표준적인 정식',
          '기술명만 담는다(교재/도장에서 흔히 쓰이는 이름). 조금이라도 불확실하면 차라리 빼라 — 지어내는 것보다 적게',
          '보고하는 것이 낫다.',
        ].join('\n');
    const sourceLine = grounded
      ? '- source: 근거로 삼은 검색 결과의 출처(사이트명 또는 URL). 검색 없이 이미 확실히 아는 표준 기술이면 "general knowledge"'
      : '- source: 항상 "general knowledge (no live search)"로 고정한다 — 실시간 검색을 하지 않았으므로 검색 출처를 지어내지 않는다.';
    return [
      openingLine,
      `조사 대상 무술: ${artScope}`,
      intentLine,
      diversityLine,
      anglesLine,
      '',
      '사용자의 목표/부족한 부분/원하는 스타일을 바탕으로, 이 목적을 달성하는 데 실제로 필요한 표준 기술 이름을 찾는다.',
      grounded ? '모델이 이미 알고 있는 사전 지식이 아니라 실제 검색 결과에 근거해야 한다. 각 기술에 대해 다음을 담는다:' : '각 기술에 대해 다음을 담는다:',
      '- name: 표준 영문 또는 로마자 기술명(검색으로 확인된 실제 명칭)',
      '- martialArtGuess: 그 기술이 실제로 속한 무술(위 조사 대상 무술 범위 내에서만)',
      '- purpose: 이 기술이 왜 이 목적에 도움이 되는지 설명하는 한국어 1문장',
      '- intentGuess: "attack"|"defense"|"escape"|"counter"|"connection"|"fundamentals"|"unknown" 중 이 기술의 실제 성격',
      sourceLine,
      '',
      '다음은 절대 포함하지 않는다: 목적과 무관한 기술, 조사 대상 무술 범위 밖의 기술, 기술이 아닌 것(개념/전략 설명), 중복(같은',
      '기술의 다른 표기), 실제 존재 여부를 확인할 수 없는 기술, 목적과 반대되는 의도의 기술.',
      '최소 0개, 최대 12개의 기술을 담은 JSON 배열만 출력한다. 확실한 기술이 적으면 있는 만큼만 출력하고, 억지로 채우지 않는다.',
      '',
      '출력 형식: [{ "name": string, "martialArtGuess": string, "purpose": string, "intentGuess": string, "source": string }, ...]',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const systemInstruction = buildSystemInstruction(true);
  const fallbackSystemInstruction = buildSystemInstruction(false);

  const contextParts = [
    `목표 요약: ${analysis.summary}`,
    analysis.goals.length > 0 ? `훈련 목표: ${analysis.goals.join(', ')}` : '',
    analysis.weaknesses.length > 0 ? `부족한 부분: ${analysis.weaknesses.join(', ')}` : '',
    analysis.desiredStyle.length > 0 ? `원하는 스타일: ${analysis.desiredStyle.join(', ')}` : '',
    analysis.desiredTechniques.length > 0 ? `이미 알고 있는 원하는 기술: ${analysis.desiredTechniques.join(', ')}` : '',
  ].filter(Boolean);

  const question = '위 목표를 달성하는 데 실제로 필요한 기술을 인터넷에서 조사해줘.';
  const retryQuestion = '위 목표를 달성하는 데 실제로 필요한 기술을 인터넷에서 조사해줘. 구체적으로 이름이 있는 실제 기술을 최소 5개 이상 찾아봐.';

  log('intent parsed', { intents: analysis.intents, diversityRequested });
  log('search angles planned', plannedQueries);

  async function attempt(q: string, grounded = true) {
    log('search request started', { grounded });
    return askGeminiForJsonWithGrounding<ResearchedTechnique[]>({
      systemInstruction: grounded ? systemInstruction : fallbackSystemInstruction,
      contextText: contextParts.join('\n'),
      question: q,
      useSearchGrounding: grounded,
      validate: isResearchArray,
    });
  }

  // ===== Priority 1: real external web search (webSearchProvider, Tavily by
  // default), attempted BEFORE Google Search grounding (billing-gated — see
  // buildSystemInstruction's doc comment). Searched and judged per learning
  // part (subGoals.ts / webEvidenceResearch.ts): one shared 9-call budget
  // handed to the parts still lacking evidence, one canonical-URL ledger,
  // per-part relevance (position + technique family + purpose + the
  // extractor's own fit), and extraction failures kept apart from "not
  // enough evidence". Not configured / every call failed → falls through to
  // the existing grounded → knowledge_fallback chain below, unchanged.
  const parts = resolveSubGoals(analysis, opts.freeText ?? analysis.summary);
  log('learning parts', parts.map((p) => ({ id: p.id, role: p.role, label: p.label, topics: p.searchTopics, positions: p.positions, actions: p.actions, intents: p.intents })));
  // grade-B (MARTIALDEX DB) confirmation per part — local data only, computed before searching so a part the
  // DB already supports needs fewer web searches
  const dbEvidence = findDbEvidence(parts, martialArt);
  log('db evidence', parts.map((p) => ({ id: p.id, db: dbEvidence.filter((d) => d.partId === p.id).map((d) => d.name) })));
  const web = await runWebEvidenceResearch({
    parts,
    artScope,
    contextLines: contextParts,
    dbEvidence,
    firstWaveQueries: plannedQueries.slice(0, MAX_QUERIES_PER_WAVE),
    deps: { search: opts.deps?.search ?? ((q) => webSearchProvider.search(q)), ask: opts.deps?.ask ?? ((r) => aiProvider.ask(r)) },
    log: structuredLog,
  });
  const plannedForReport = parts.length === 1 ? plannedQueries : parts.flatMap((p) => queriesForPart(p, 0, null));

  if (web.kind === 'done') {
    const techniques: ResearchedTechnique[] = web.techniques.map((t) => ({
      name: t.name,
      martialArtGuess: t.martialArtGuess,
      purpose: t.purpose,
      intentGuess: t.intentGuess,
      source: t.sourceUrls[0] ?? '',
      sourceUrls: t.sourceUrls,
      sourceTitles: t.sourceTitles,
      sourceKinds: t.sourceKinds,
      evidence: t.evidence,
      confidence: t.confidence,
      partId: t.partId,
    }));
    const status = bucketByCount(web.rawCount, techniques.length);
    log('web evidence research', { mode: web.mode, stopReason: web.diagnostics.stopReason, partial: !!web.partial, techniques: techniques.map((t) => `${t.partId}:${t.name}`) });
    return {
      ok: status === 'SEARCH_SUCCESS' || status === 'SEARCH_PARTIAL',
      status,
      techniques,
      excluded: web.excluded,
      rawCount: web.rawCount,
      excludedOppositeCampCount: web.excluded.filter((e) => e.reason.includes('목적이 반대')).length,
      usedSearchGrounding: false,
      groundingSources: [],
      plannedQueries: plannedForReport,
      actualSearchQueries: [],
      researchMode: web.mode,
      usedExternalWebSearch: true,
      executedQueries: web.executedQueries,
      wavesRun: web.wavesRun,
      searchResultCount: web.diagnostics.uniqueSourceCount,
      analyzedSourceCount: web.diagnostics.analyzedSourceCount,
      subGoals: web.parts,
      diagnostics: web.diagnostics,
      review: web.review,
      partial: web.partial,
      dbEvidence,
    };
  }

  let researchMode: ResearchMode = 'grounded';
  let rawTechniques: ResearchedTechnique[] = [];
  let usedSearchGroundingFinal = false;
  let groundingSourcesFinal: GroundingSource[] = [];
  let actualSearchQueriesFinal: string[] = [];

  {
    // Web search wasn't configured, found nothing, or extraction failed —
    // fall through to the existing grounded -> knowledge_fallback chain
    // (unchanged behavior from before this addition).
    let result: Awaited<ReturnType<typeof attempt>>;
    try {
      result = await attempt(question);
      // Bounded single retry (spec section 3's "재검색 / 다른 검색어 시도") —
      // only for plausibly-transient/format failures, and only ONCE, so this
      // can never loop or meaningfully add to the free-tier request budget.
      if (!result.ok && RETRYABLE_CODES.has(result.code)) {
        log('search response failed, retrying once', { code: result.code });
        result = await attempt(retryQuestion);
      } else if (result.ok && result.data.length === 0) {
        log('search response empty, retrying once with a stronger prompt');
        const retried = await attempt(retryQuestion);
        if (retried.ok && retried.data.length > 0) result = retried;
      }

      // Grounding is billing-gated on this project's free-tier key (see
      // buildSystemInstruction's doc comment) — RATE_LIMIT/NETWORK on a
      // grounded attempt is exactly that signature, not a transient blip worth
      // retrying with the SAME (grounded) request again. Falls back ONCE to an
      // explicitly ungrounded attempt (never retried further) so the feature
      // degrades gracefully instead of failing outright.
      if (!result.ok && (result.code === 'RATE_LIMIT' || result.code === 'NETWORK')) {
        log('grounding unavailable, falling back to one ungrounded attempt', { code: result.code });
        const fallback = await attempt(question, false);
        if (fallback.ok) {
          result = fallback;
          researchMode = 'knowledge_fallback';
        } else {
          researchMode = 'unavailable';
        }
      } else if (!result.ok) {
        researchMode = 'unavailable';
      }
    } catch (e) {
      log('search request threw', e instanceof Error ? e.message : String(e));
      return {
        ok: false,
        status: 'SEARCH_FAILED',
        techniques: [],
        excluded: [],
        rawCount: 0,
        excludedOppositeCampCount: 0,
        usedSearchGrounding: false,
        groundingSources: [],
        plannedQueries,
        actualSearchQueries: [],
        errorMessage: e instanceof Error ? e.message : String(e),
        researchMode: 'unavailable',
        usedExternalWebSearch: false,
        executedQueries: [],
        searchResultCount: 0,
        analyzedSourceCount: 0,
        wavesRun: 0,
      };
    }

    if (!result.ok) {
      return {
        ok: false,
        status: deriveSearchStatus({ ok: false, code: result.code, usedSearchGrounding: false, rawCount: 0, keptCount: 0 }),
        techniques: [],
        excluded: [],
        rawCount: 0,
        excludedOppositeCampCount: 0,
        usedSearchGrounding: false,
        groundingSources: [],
        plannedQueries,
        actualSearchQueries: [],
        errorMessage: result.message,
        researchMode,
        usedExternalWebSearch: false,
        executedQueries: web.diagnostics.queries.filter((q) => q.ok).map((q) => q.query),
        searchResultCount: web.diagnostics.uniqueSourceCount,
        analyzedSourceCount: web.diagnostics.analyzedSourceCount,
        wavesRun: 0,
        subGoals: parts,
        diagnostics: web.diagnostics,
      };
    }

    log('search response ok', { results: result.data.length, actualQueries: result.webSearchQueries });
    rawTechniques = result.data;
    usedSearchGroundingFinal = result.usedSearchGrounding;
    groundingSourcesFinal = result.groundingSources;
    actualSearchQueriesFinal = result.webSearchQueries ?? [];
  }

  // Uses the SAME filterResearchedTechniques() the expansion loop above used
  // to decide sufficiency — never a second, looser pass. `filterMode` is
  // 'web_search' for BOTH researchMode 'web_search' and
  // 'insufficient_web_evidence' (both are real-evidence-sourced; only the
  // sufficiency verdict differs), so confidence filtering never gets
  // silently skipped for the insufficient case.
  const { techniques, excluded, excludedOppositeCampCount } = filterResearchedTechniques(rawTechniques, researchMode);

  // The knowledge-fallback attempt is deliberately ungrounded, and the
  // web-search extraction call is deliberately ungrounded too (real content
  // already in hand) — feeding usedSearchGrounding:false through
  // deriveSearchStatus for either would trip its "requested grounding but
  // didn't happen" rule and mislabel a successful, intentional result as
  // SEARCH_NOT_AVAILABLE. bucketByCount applies the same count thresholds
  // without that grounding-mismatch check. Also covers 'insufficient_web_evidence'
  // — that mode's status naturally comes out SEARCH_PARTIAL/SEARCH_FAILED
  // from the thin count, which is honest; researchMode (not status) is what
  // service.ts gates the hard "stop generation" decision on.
  const status =
    researchMode === 'knowledge_fallback'
      ? bucketByCount(rawTechniques.length, techniques.length)
      : deriveSearchStatus({
          ok: true,
          usedSearchGrounding: usedSearchGroundingFinal,
          rawCount: rawTechniques.length,
          keptCount: techniques.length,
        });
  log('candidate techniques after intent+confidence+dedup filter', techniques.map((t) => t.name));
  log('search status', { status, researchMode });
  structuredLog('CURRICULUM_CANDIDATES', {
    candidateCount: rawTechniques.length,
    validatedCount: techniques.length,
    researchMode,
    status,
    fallbackCandidates: 0,
  });

  return {
    ok: status === 'SEARCH_SUCCESS' || status === 'SEARCH_PARTIAL',
    status,
    techniques,
    excluded,
    rawCount: rawTechniques.length,
    excludedOppositeCampCount,
    usedSearchGrounding: usedSearchGroundingFinal,
    groundingSources: groundingSourcesFinal,
    plannedQueries,
    actualSearchQueries: actualSearchQueriesFinal,
    researchMode,
    usedExternalWebSearch: false,
    executedQueries: web.diagnostics.queries.filter((q) => q.ok).map((q) => q.query),
    wavesRun: 0,
    searchResultCount: web.diagnostics.uniqueSourceCount,
    analyzedSourceCount: web.diagnostics.analyzedSourceCount,
    subGoals: parts,
    diagnostics: web.diagnostics,
  };
}

/**
 * Merges researched technique names into analysis.desiredTechniques
 * (case-insensitive de-dupe against what's already there) — additive only,
 * never replaces the AI's own prior-knowledge phrases. Every downstream
 * consumer (matchGoalToTechniques's weight-45 desiredTechniques field,
 * discoverMissingDesiredTechniques's per-phrase verification loop) reads
 * analysis.desiredTechniques as-is, so merging here — and nowhere else — is
 * enough to route researched names through the EXISTING matching/discovery/
 * intent-filtering pipeline completely unchanged.
 */
export function mergeResearchedTechniques(analysis: GoalAnalysis, researched: ResearchedTechnique[]): number {
  const existingLower = new Set(analysis.desiredTechniques.map((t) => t.toLowerCase().trim()));
  let merged = 0;
  for (const r of researched) {
    const name = r.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (existingLower.has(key)) continue;
    existingLower.add(key);
    analysis.desiredTechniques.push(name);
    merged++;
  }
  return merged;
}
