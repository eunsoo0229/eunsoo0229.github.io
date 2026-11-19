import type { Curriculum, CurriculumPhaseRange, CurriculumDay } from '../curriculum/types';
import type { AiGoalCurriculumMeta, GoalAnalysis, GoalDurationMode, GoalIntensity, GoalIntent, GoalTechniqueMatch, ResearchMode, SearchStatus } from './types';
import { GOAL_MAX_DURATION_DAYS, GOAL_MIN_DURATION_DAYS } from './types';
import { analyzeGoal } from './goalAnalysis';
import { discoverMissingDesiredTechniques, fallbackTechniquePool, matchGoalToTechniques } from './techniqueMatcher';
import { classifyTechniqueIntents, isOppositeCamp, resolveGoalIntents } from './intentClassifier';
import { classifyTechniqueStructure, STRUCTURE_ROLE_LABEL_KO, STRUCTURE_ROLE_WEIGHT, type TechniqueStructureRole } from './structureClassifier';
import { resolveDiversityRequested, selectDiverseTechniques, namesLikelySame, isLowPriorityStructureRole } from './diversity';
import { mergeResearchedTechniques, researchTechniquesForGoal, type ExcludedResearchTechnique, type TechniqueResearchOutcome } from './techniqueResearch';
import { restrictAnalysisToSubGoals } from './subGoals';
import { applyEvidencePolicy, type EvidencePolicyResult } from './evidencePolicy';
import { findTaxonomyNodesInText, getArtTaxonomy, techniqueIdsForNode } from '../techniqueTaxonomy';
import { classifyPhase } from '../fighterStyle/phaseClassifier';
import { planEvidenceCurriculum } from './evidencePlanner';
import type { ResearchDiagnostics } from './evidenceLedger';
import type { ReviewItem } from './webEvidenceResearch';
import { planGoalCurriculum, INTENSITY_PER_DAY } from './curriculumPlanner';
import { validateCurriculumDays, validateCurriculumQuality } from './validator';
import { resolveTechnique, getUnifiedMartialArtSummaries } from '../userTechniques/service';
import { curriculumRepository } from '../curriculum/repository';
import { getAuthorName, listMyCurricula } from '../curriculum/curriculumService';
import { getMartialArt, martialArtSummaries } from '../loadData';
import { identifyFighterCandidates } from '../fighterStyle/fighterIdentification';
import { getOrGenerateStyleAnalysis } from '../fighterStyle/styleAnalysis';
import { matchStyleToTechniques } from '../fighterStyle/techniqueMatcher';
import { MMA_MARTIAL_ART_ID, MMA_SOURCE_MARTIAL_ARTS, type MmaArea } from '../mmaCurriculum/types';
import { classifyMmaArea } from '../mmaCurriculum/areaClassifier';
import { isSubmissionGoal } from '../aiCoachDay/practicePlan';
import type { MasteryStatus } from '../skillProgress/types';
import { computeAllSkillProgress } from '../skillProgress/weaknessEngine';
import { loadKnowledgeIndex } from '../martialdexKnowledge/loadIndex';
import { attachSequenceDrills, goalAsksForSequences } from '../martialdexKnowledge/drills';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';

// How many real techniques a duration/intensity combo needs to stay
// new-content-driven rather than falling back to blanket review days once
// planGoalCurriculum's per-phase capacity capping runs out of pool to draw
// from. ~90% of the average daily technique count, since review days reuse
// already-introduced ids rather than consuming new ones.
function estimateNeededPoolSize(targetDays: number, intensity: GoalIntensity): number {
  const [lo, hi] = INTENSITY_PER_DAY[intensity];
  const avgPerDay = (lo + hi) / 2;
  return Math.ceil(Math.max(6, targetDays * avgPerDay * 0.9));
}

function buildMasteryMap(): Map<string, MasteryStatus> {
  const map = new Map<string, MasteryStatus>();
  for (const { technique, progress } of computeAllSkillProgress()) map.set(technique.id, progress.status);
  return map;
}

function newId(): string {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `custom__${rand}`;
}

function intensityFromDailyMinutes(minutes: number): GoalIntensity {
  if (minutes <= 20) return 'light';
  if (minutes <= 50) return 'normal';
  return 'intensive';
}

// Only managed martial arts count — an AI-proposed art outside the list
// falls back to input.martialArt.
function isRealMartialArt(id: string): boolean {
  return getUnifiedMartialArtSummaries().some((a) => a.id === id);
}

const DEBUG = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
function log(...args: unknown[]) {
  if (DEBUG) console.debug('[CurriculumResearch]', ...args);
}

/** Structured `[CURRICULUM_*]` trace lines (spec section 27) — see techniqueResearch.ts's identical helper. Dev-only, never logs secrets. */
function structuredLog(tag: string, fields: Record<string, string | number | boolean>) {
  if (!DEBUG) return;
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`);
  console.debug(`[${tag}] ${parts.join(' ')}`);
}

// Section 10's "검증 강화" — checks whether the ACTUAL scheduled Day content
// (not just "is every Day non-empty") matches the goal's intent. This is a
// safety net, not the primary fix: matchGoalToTechniques/fallbackTechniquePool
// already score/filter by intent, so this should rarely trigger in practice.
function checkIntentAlignment(days: CurriculumDay[], goalIntents: GoalIntent[]): { ok: boolean; conflictingRatio: number } {
  if (goalIntents.length === 0) return { ok: true, conflictingRatio: 0 };
  const ids = [...new Set(days.flatMap((d) => d.techniqueIds))];
  if (ids.length === 0) return { ok: true, conflictingRatio: 0 };
  let conflicting = 0;
  for (const id of ids) {
    const technique = resolveTechnique(id);
    if (technique && isOppositeCamp(goalIntents, classifyTechniqueIntents(technique))) conflicting++;
  }
  const conflictingRatio = conflicting / ids.length;
  // A clear single-intent goal (e.g. pure "테이크다운 방어") should see almost
  // no opposite-camp content — a little is tolerable (a rare comparison/
  // context technique slipping past the per-phase filler cap), but the old
  // 0.45 threshold was loose enough to let genuinely reversed curricula
  // ("테이크다운 방어" full of Double Leg/Single Leg entries) silently pass.
  // Tightened per the reported bug's root-cause analysis; when even the
  // stricter re-match retry below can't clear this, the caller now surfaces
  // an honest contentWarning instead of silently keeping the flagged result.
  return { ok: conflictingRatio <= 0.15, conflictingRatio };
}

// MMA + a submission goal: within each Day the takedowns come first and the
// submissions last (striking → clinch → takedown → ground → submission), so
// the Day is taught — and practised by the AI coach — as takedown → submission.
// Only the ORDER changes; no technique is added or removed.
const MMA_FLOW: (MmaArea | null)[] = ['striking', 'clinch', 'takedown', 'takedown_defense', 'transition', null, 'ground', 'ground_and_pound', 'submission'];
function takedownBeforeSubmission(day: CurriculumDay): CurriculumDay {
  const rank = (id: string) => {
    const t = resolveTechnique(id);
    return MMA_FLOW.indexOf(t ? classifyMmaArea(t) : null);
  };
  const order = (ids: string[]) => ids.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id);
  return { ...day, techniqueIds: order(day.techniqueIds) };
}

function deriveTitle(martialArt: string, analysis: GoalAnalysis): string {
  const artName = martialArt === MMA_MARTIAL_ART_ID ? 'MMA' : getMartialArt(martialArt)?.nameKo ?? martialArt;
  const topics = [...analysis.priority, ...analysis.goals, ...analysis.weaknesses].filter(Boolean).slice(0, 2);
  return topics.length > 0 ? `${artName} ${topics.join(' · ')} 커리큘럼` : `${artName} 맞춤 커리큘럼`;
}

// Best-effort only — never blocks curriculum generation. If the user's text
// named a real fighter to emulate (analysis.referencedFighterName), pull in
// extra matched techniques from the EXISTING "선수 스타일 학습" pipeline
// (spec section 11's tail), filtered to the same martial art. Any failure
// (ambiguous name, no candidates, AI error) is swallowed silently — the
// goal-based matches alone are always enough to build a curriculum.
async function tryEnrichWithFighterStyle(referencedFighterName: string, martialArt: string, userId: string | null): Promise<GoalTechniqueMatch[]> {
  try {
    const candidatesResult = await identifyFighterCandidates(referencedFighterName);
    if (!candidatesResult.ok || candidatesResult.data.candidates.length === 0) return [];
    const fighter = candidatesResult.data.candidates[0];
    const analysisResult = await getOrGenerateStyleAnalysis(fighter);
    if (!analysisResult.ok) return [];
    const styleMatches = await matchStyleToTechniques(analysisResult.data, userId);
    const relevantArts = martialArt === MMA_MARTIAL_ART_ID ? MMA_SOURCE_MARTIAL_ARTS : [martialArt];
    return styleMatches
      .filter((m) => relevantArts.includes(m.martialArt))
      .map((m) => {
        const technique = resolveTechnique(m.techniqueId);
        return {
          ...m,
          reason: `${fighter.name} 스타일 참고 — ${m.reason}`,
          // fighterStyle's own TechniqueMatch has no structural-role concept
          // (that axis only exists in aiCurriculum, see structureClassifier.ts)
          // — classify it fresh from the real resolved technique so every
          // GoalTechniqueMatch in this pipeline carries one consistently.
          structureRole: technique ? classifyTechniqueStructure(technique) : 'primary_technique',
        };
      });
  } catch {
    return [];
  }
}

export interface GenerateGoalCurriculumInput {
  freeText: string;
  martialArt: string;
  /** 'ai_recommended' means "let AI pick the duration" — a fixed number here is NEVER overridden (spec section 4). */
  durationDays: number | 'ai_recommended';
  dailyMinutes: number;
  clarifyingAnswer?: string;
  /** Skips surfacing another clarifying question even if the AI wants to ask one (the "건너뛰기" path). */
  skipClarifying?: boolean;
  /** Present when regenerating an in-progress (not-yet-saved) preview — appended to context, oldest first. */
  refinementHistory?: string[];
  /** Needed to register a genuinely-missing desiredTechniques technique into the shared add_teq library — null (logged out) falls back to the existing local-only user_techniques path. */
  userId?: string | null;
  /** "이미 학습한 기술 커리큘럼에 넣지 않기" checkbox — when true, any technique the user has already trained at all (skillProgress status other than 'not_started', see computeAllSkillProgress()) is excluded from the CANDIDATE pool itself, before planGoalCurriculum ever sees it — never just hidden in the UI after the fact. Default false (existing behavior/UX unchanged unless the user opts in). */
  excludeLearnedTechniques?: boolean;
  /** PartialEvidenceSummary.token — continue the stopped run with only the parts that have evidence. */
  partialToken?: string;
}

/** One researched technique's outcome for the "발견한 기술" list in the UI (spec section 11). */
export interface GoalCurriculumFoundTechnique {
  name: string;
  /** True once this name ended up matched to a real, scheduled Martialdex technique (spec section 8's DB_MATCHED bucket) — false means "found by search text, but Martialdex has no matching/verifiable technique" (EXTERNAL_ONLY, spec section 9). */
  matchedToDatabase: boolean;
  structureRole?: TechniqueStructureRole;
  /** Real URLs this technique was actually found in — set only for researchMode 'web_search' (spec sections 20-22's "실제 출처 URL 표시"). Never fabricated; empty for grounded/knowledge_fallback since those don't retrieve real pages. */
  sourceUrls?: string[];
  /** Short quote/paraphrase of what in the source actually mentions this technique, straight from techniqueResearch.ts's extraction — never invented here. */
  evidence?: string;
}

/**
 * Section 1-3/1-14/2/10/11/17's "조사 결과" transparency data — sourced
 * directly from the real pipeline, never a log scrape, and never collapsed
 * into a single ok/fail boolean (see SearchStatus's doc comment in
 * types.ts for exactly why that was the root cause of "조사 실패"를 "조사
 * 완료"처럼 보여주는 문제).
 */
export interface GoalCurriculumResearchSummary {
  status: SearchStatus;
  /** How these candidates were obtained (grounded web search / ungrounded knowledge fallback / unavailable) — see ResearchMode's doc comment. Never let the UI imply a real web search happened when this is 'knowledge_fallback'. */
  researchMode: ResearchMode;
  /** Real technique names the internet-research stage (techniqueResearch.ts) found via Google Search grounding, before any filtering. */
  researchedCount: number;
  /** Survived intent + near-duplicate filtering — what actually got a chance to merge in. */
  validResearchedCount: number;
  /** Researched results dropped for directly conflicting with the goal's own intent (attack found for a defense goal, etc). */
  excludedOppositeCampCount: number;
  /** Researched names that were new (not already present in the AI's own desiredTechniques phrases) and got merged in. */
  mergedIntoDesiredCount: number;
  usedSearchGrounding: boolean;
  groundingSourceCount: number;
  /** The angle-queries this call instructed Gemini's search tool to cover — a PLAN, distinct from `actualSearchQueries` below. */
  plannedQueries: string[];
  /** Gemini's own reported search-tool queries — the REAL thing that was searched, when the API provides it (never fabricated/backfilled). */
  actualSearchQueries: string[];
  /** name + human-readable reason, straight from techniqueResearch.ts's own filtering (spec section 11's "제외된 항목"). */
  excludedTechniques: ExcludedResearchTechnique[];
  /** Every researched name plus whether it ended up as a real, matched technique (spec sections 8/9/11). */
  foundTechniques: GoalCurriculumFoundTechnique[];
  /** True only when `status` is SEARCH_SUCCESS or SEARCH_PARTIAL — kept for compatibility with existing "did research contribute" call sites; prefer `status` for anything user-facing. */
  ok: boolean;
  /** True only for researchMode 'web_search' — spec section 25's honesty metadata. Never true when candidates came from Gemini's own knowledge. */
  usedExternalWebSearch: boolean;
  /** The literal query strings actually sent to the web search provider (web_search mode only) — ground truth, distinct from plannedQueries (a plan) and actualSearchQueries (Gemini's grounding self-report). */
  executedQueries: string[];
  /** Raw result count from the web search provider itself, before any extraction (web_search mode only; 0 otherwise). */
  searchResultCount: number;
  /** Distinct sources actually fed to Gemini for technique extraction (web_search mode only; 0 otherwise). */
  analyzedSourceCount: number;
  /** Of foundTechniques, how many matched an existing Martialdex technique. */
  registeredCount: number;
  /** Of foundTechniques, how many were found but have no matching Martialdex technique yet. */
  externalOnlyCount: number;
  /** Candidates dropped for insufficient evidence/confidence (spec section 13/14's "uncertain") — never merged into the curriculum; counted here (from excludedTechniques) so the UI can report them separately from ordinary exclusions. */
  uncertainCount: number;
  /** Per-stage numbers and per-part coverage (web search runs only). */
  diagnostics?: ResearchDiagnostics;
  /** Candidates whose relevance could not be confirmed — shown for review, never scheduled. */
  review?: ReviewItem[];
}

/** Section 1-5/1-6's "MARTIALDEX 존재 확인 → 없는 기술 검증 → 등록" numbers, read straight from discoverMissingDesiredTechniques's real result. */
export interface GoalCurriculumDiscoveryStats {
  /** desiredTechniques phrases that discoverMissingDesiredTechniques resolved to a real technique (already-existing or newly-registered). */
  discoveredCount: number;
  /** Of those, how many were genuinely new to Martialdex and got verified + registered via the existing techniqueDiscovery pipeline. */
  newlyRegisteredCount: number;
  /** Of newlyRegisteredCount, how many got a real, verified reference video attached (never fabricated — see techniqueDiscovery's attachDiscoveredVideo). */
  videosAttachedCount: number;
}

export interface GoalCurriculumPreview {
  title: string;
  martialArt: string;
  analysis: GoalAnalysis;
  matchedTechniques: GoalTechniqueMatch[];
  days: CurriculumDay[];
  phases: CurriculumPhaseRange[];
  totalDays: number;
  intensity: GoalIntensity;
  dailyMinutes: number;
  durationMode: GoalDurationMode;
  goalText: string;
  refinementHistory: string[];
  research: GoalCurriculumResearchSummary;
  discoveryStats: GoalCurriculumDiscoveryStats;
  /** Set (never silently dropped) when the final scheduled Days still exceed the intent-alignment threshold after the bounded re-match retry — spec 1-11/1-12's "정직하게 표시" requirement. */
  contentWarning?: { offCampRatio: number; message: string };
  /** Set when the user confirmed building from only the learning parts that had evidence (부분 생성). */
  partialScope?: { included: string[]; excluded: { label: string; reason: string }[] };
  /**
   * 근거 등급 summary for web-evidence curricula: how many scheduled techniques are web-verified (A) vs.
   * MARTIALDEX-DB-confirmed (B), the C candidates left out, near-duplicates merged, and whether the short-pool
   * focused schedule (repetition / connection / situations) was used.
   */
  evidence?: {
    counts: { A: number; B: number };
    excludedC: { name: string; reason: string }[];
    duplicatesMerged: { kept: string; dropped: string }[];
    scheduleMode: 'standard' | 'focused';
    fullScope: boolean;
  };
  /** Separate from contentWarning above (that one is offense-vs-defense camp; this one is validateCurriculumQuality's primary-vs-supporting-technique ratio, spec section 20) — set when a diversity-requested curriculum still ended up majority supporting-skill content after the bounded stricter-pool retry. */
  qualityWarning?: { primaryRatio: number; message: string };
  /** Set when the goal-relevant technique pool came up short even after the fallback top-up — spec 1-12's "정확성이 기간보다 우선": never force-filled, honestly flagged instead. */
  insufficientContent?: boolean;
  /** How many otherwise-relevant candidates were removed for being already-learned — only meaningful when input.excludeLearnedTechniques was true; 0 otherwise. */
  excludedLearnedTechniqueCount: number;  /**
   * Setup / combo / connection drills attached from recorded MARTIALDEX sequences
   * (martialdexKnowledge/drills.ts). `warning` is set when the goal asked for
   * setups or combos but no recorded sequence fit — never filled with invented ones.
   */
  sequenceDrills?: {
    totalDrills: number;
    daysWithoutDrills: number[];
    sources: KnowledgeIndex['sources'];
    warning?: string;
  };
}

/** Section 18's "검색 결과: N개 / 관련 기술: N개 / 검증 통과: N개" transparency data for the INSUFFICIENT_WEB_EVIDENCE abort screen — lets the user tell "검색 자체가 안 됨" apart from "검색은 됐지만 관련 기술이 부족함". */
export interface InsufficientWebEvidenceSummary {
  searchResultCount: number;
  analyzedSourceCount: number;
  researchedCount: number;
  validResearchedCount: number;
  executedQueries: string[];
  wavesRun: number;
  /** Per-stage numbers, per-part coverage and the exact stop reason (evidenceLedger.ts). */
  diagnostics?: ResearchDiagnostics;
  /** Candidates whose relevance could not be confirmed (검토 대상). */
  review: ReviewItem[];
}

/** 부분 생성 확인 — what would be built and what would be left out, before anything is generated. */
export interface PartialEvidenceSummary {
  /** Pass back as input.partialToken to continue with the covered parts only. */
  token: string;
  included: { label: string; techniques: string[] }[];
  excluded: { label: string; reason: string }[];
  diagnostics?: ResearchDiagnostics;
}

export type GenerateGoalCurriculumOutcome =
  | { ok: true; preview: GoalCurriculumPreview }
  | { ok: false; code: 'CLARIFYING_NEEDED'; question: string }
  | { ok: false; code: 'VALIDATION_FAILED'; errors: string[] }
  | { ok: false; code: 'AI_ERROR'; message: string }
  /** Spec section 4/13/16/20 — Tavily genuinely ran but never produced enough validated evidence even after bounded expansion search. Generation stops outright: never padded with MARTIALDEX's whole technique DB. */
  | { ok: false; code: 'INSUFFICIENT_WEB_EVIDENCE'; research: InsufficientWebEvidenceSummary }
  /** Every core learning part has evidence but some follow-up parts do not — ask before building a narrower curriculum. */
  | { ok: false; code: 'PARTIAL_EVIDENCE'; partial: PartialEvidenceSummary };

// 부분 생성 확인 대기 중인 실행 — kept in memory only (30 min), keyed by a random token.
interface PendingPartial {
  analysis: GoalAnalysis;
  researchOutcome: TechniqueResearchOutcome;
  martialArt: string;
  totalDays: number;
  freeText: string;
  partial: NonNullable<TechniqueResearchOutcome['partial']>;
  createdAt: number;
}
const pendingPartials = new Map<string, PendingPartial>();
const PENDING_PARTIAL_TTL_MS = 30 * 60 * 1000;

function stashPendingPartial(p: Omit<PendingPartial, 'createdAt'>): string {
  const now = Date.now();
  for (const [k, v] of pendingPartials) if (now - v.createdAt > PENDING_PARTIAL_TTL_MS) pendingPartials.delete(k);
  const token = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
  pendingPartials.set(token, { ...p, createdAt: now });
  return token;
}

function takePendingPartial(token: string, freeText: string): PendingPartial | null {
  const p = pendingPartials.get(token);
  if (!p || Date.now() - p.createdAt > PENDING_PARTIAL_TTL_MS || p.freeText !== freeText) return null;
  pendingPartials.delete(token);
  return p;
}

export async function generateGoalCurriculumPreview(input: GenerateGoalCurriculumInput): Promise<GenerateGoalCurriculumOutcome> {
  // 부분 생성 확인 후 이어서 만들기 — reuses the stopped run's analysis + research (no second Gemini analysis,
  // no second Tavily search) and narrows the analysis to the parts that have evidence.
  const resumed = input.partialToken ? takePendingPartial(input.partialToken, input.freeText) : null;
  if (input.partialToken && !resumed) {
    return { ok: false, code: 'AI_ERROR', message: '부분 생성 확인 정보가 만료되었습니다. 커리큘럼을 다시 생성해 주세요.' };
  }
  let analysis: GoalAnalysis;
  let martialArt: string;
  let totalDays: number;
  let researchOutcome: TechniqueResearchOutcome;
  let partialScope: GoalCurriculumPreview['partialScope'];
  if (resumed) {
    const parts = resumed.researchOutcome.subGoals ?? [];
    const included = parts.filter((p) => resumed.partial.includedIds.includes(p.id));
    const excludedParts = parts.filter((p) => !resumed.partial.includedIds.includes(p.id));
    analysis = restrictAnalysisToSubGoals(resumed.analysis, included, excludedParts);
    martialArt = resumed.martialArt;
    totalDays = resumed.totalDays;
    researchOutcome = resumed.researchOutcome;
    partialScope = { included: included.map((p) => p.label), excluded: resumed.partial.excluded.map((e) => ({ label: e.label, reason: e.reason })) };
    log('resumed partial-scope generation', { included: partialScope.included, excluded: partialScope.excluded.map((e) => e.label) });
  } else {
    const analysisResult = await analyzeGoal({
      freeText: input.freeText,
      martialArtHint: input.martialArt,
      dailyMinutes: input.dailyMinutes,
      clarifyingAnswer: input.clarifyingAnswer,
      refinementHistory: input.refinementHistory,
    });
    if (!analysisResult.ok) return { ok: false, code: 'AI_ERROR', message: analysisResult.message };
    analysis = analysisResult.data;
    // Sanitizes Gemini's own intents output (or derives it from the raw text
    // when Gemini left it empty) ONCE, here — every downstream consumer
    // (technique matching, the fallback pool top-up, post-generation
    // alignment check) reads analysis.intents rather than re-deriving it.
    analysis.intents = resolveGoalIntents(analysis, input.freeText);
    // Same "AI field + deterministic floor" pattern, one line below, for the
    // diversity axis (spec section 6) — see diversity.ts's doc comment for
    // why an explicit "다양하게"/"variety" in the user's own words must never
    // be missed just because Gemini's own JSON field happened to say false.
    analysis.diversityRequested = resolveDiversityRequested(analysis, input.freeText);

    if (analysis.clarifyingQuestion && !input.skipClarifying && !input.clarifyingAnswer) {
      return { ok: false, code: 'CLARIFYING_NEEDED', question: analysis.clarifyingQuestion };
    }

    martialArt = isRealMartialArt(analysis.martialArt) ? analysis.martialArt : input.martialArt;
    log('intent resolved', { intents: analysis.intents, diversityRequested: analysis.diversityRequested, martialArt });

    // `let`, not `const` — see the diversity-mode duration recompute below
    // (after the real technique pool is known), which only ever SHRINKS this,
    // and only when durationMode is 'ai_recommended' — a user-FIXED day count
    // (input.durationDays a real number) is never touched, per spec section
    // 4's "고정된 날짜 수는 절대 덮어쓰지 않는다". Computed BEFORE the research
    // call below (moved up from its old position after research) purely so
    // researchTechniquesForGoal can size its duration-scaled minimum-evidence
    // floor off a real totalDays instead of a hardcoded guess — this doesn't
    // change totalDays' own value or the later diversity-mode shrink logic.
    totalDays =
      input.durationDays === 'ai_recommended'
        ? Math.round(Math.max(GOAL_MIN_DURATION_DAYS, Math.min(GOAL_MAX_DURATION_DAYS, analysis.suggestedDurationDays)))
        : input.durationDays;

    // Section 1-3's genuinely new stage — runs BEFORE matching/discovery so its
    // output flows through the exact same downstream pipeline (matchGoalToTechniques's
    // weighted search, discoverMissingDesiredTechniques's verify-and-register loop,
    // intentClassifier's hard opposite-camp exclusion) as every other desiredTechniques
    // phrase. Best-effort: a failed/thin research call never blocks generation, it
    // just leaves desiredTechniques exactly as analyzeGoal() produced it — but the
    // real `status` (never silently upgraded to "success") is still surfaced to the
    // user at the end of this function, per spec section 2/17.
    researchOutcome = await researchTechniquesForGoal(analysis, martialArt, totalDays, { freeText: input.freeText });

    // Spec section 20's final gate — MUST run before fallbackTechniquePool
    // (below) has any chance to execute. Tavily genuinely ran (real HTTP
    // success across the initial + bounded expansion waves — see
    // techniqueResearch.ts) but never produced enough validated,
    // evidence-backed candidates. Generation stops outright here: MARTIALDEX's
    // whole-technique-DB fallback must never quietly stand in for missing real
    // search evidence (spec sections 4/13/33). This does NOT apply to
    // 'knowledge_fallback' (Tavily itself failed/unavailable) — that keeps the
    // existing, separately-decided graceful-degradation policy unchanged.
    if (researchOutcome.researchMode === 'insufficient_web_evidence') {
      return {
        ok: false,
        code: 'INSUFFICIENT_WEB_EVIDENCE',
        research: {
          searchResultCount: researchOutcome.searchResultCount,
          analyzedSourceCount: researchOutcome.analyzedSourceCount,
          researchedCount: researchOutcome.rawCount,
          validResearchedCount: researchOutcome.techniques.length,
          executedQueries: researchOutcome.executedQueries,
          wavesRun: researchOutcome.wavesRun,
          diagnostics: researchOutcome.diagnostics,
          review: researchOutcome.review ?? [],
        },
      };
    }

    // Every core part has evidence but a follow-up part does not — never fill the missing part with unverified
    // content: stop and show the user exactly what would be included / left out, and continue only on consent.
    if (researchOutcome.partial) {
      const token = stashPendingPartial({ analysis, researchOutcome, martialArt, totalDays, freeText: input.freeText, partial: researchOutcome.partial });
      const parts = researchOutcome.subGoals ?? [];
      return {
        ok: false,
        code: 'PARTIAL_EVIDENCE',
        partial: {
          token,
          included: parts.filter((p) => researchOutcome.partial!.includedIds.includes(p.id)).map((p) => ({ label: p.label, techniques: researchOutcome.techniques.filter((t) => t.partId === p.id).map((t) => t.name) })),
          excluded: researchOutcome.partial.excluded.map((e) => ({ label: e.label, reason: e.reason })),
          diagnostics: researchOutcome.diagnostics,
        },
      };
    }
  }
  const durationMode: GoalDurationMode = input.durationDays === 'ai_recommended' ? 'ai_recommended' : 'user_selected';
  const intensity = intensityFromDailyMinutes(input.dailyMinutes);
  const title = deriveTitle(martialArt, analysis);

  const mergedIntoDesiredCount = researchOutcome.ok ? mergeResearchedTechniques(analysis, researchOutcome.techniques) : 0;

  // Real mastery data (never sent to Gemini — purely local, deterministic
  // reweighting) so the curriculum favors techniques the user hasn't
  // learned or is weak at, and doesn't waste review days re-covering ones
  // they're already 'proficient' in.
  const masteryByTechniqueId = buildMasteryMap();

  let matches = matchGoalToTechniques(analysis, martialArt, masteryByTechniqueId);
  if (analysis.referencedFighterName) {
    const enrichment = await tryEnrichWithFighterStyle(analysis.referencedFighterName, martialArt, input.userId ?? null);
    const byId = new Map(matches.map((m) => [m.techniqueId, m]));
    for (const m of enrichment) {
      const existing = byId.get(m.techniqueId);
      if (!existing || m.relevanceScore > existing.relevanceScore) byId.set(m.techniqueId, m);
    }
    matches = [...byId.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  // A technique the user named literally (desiredTechniques) but that
  // matched nothing in the library must not simply be dropped — spec
  // section 8 requires the Discovery Service to research/verify/register
  // it so it can appear on its own merits (e.g. a specific Day 3 wrestling
  // technique), never as a fabricated id or a bare string.
  const discovered = await discoverMissingDesiredTechniques(analysis.desiredTechniques, martialArt, input.userId ?? null, matches, analysis.intents);
  if (discovered.length > 0) {
    const byId = new Map(matches.map((m) => [m.techniqueId, m]));
    for (const m of discovered) if (!byId.has(m.techniqueId)) byId.set(m.techniqueId, m);
    matches = [...byId.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  // Read straight off discovered's own reason text (set by discoverMissingDesiredTechniques
  // itself, based on techniqueDiscovery's real 'existing' vs newly-verified-and-registered
  // outcome) — no parallel bookkeeping, no log scraping.
  const discoveryStats: GoalCurriculumDiscoveryStats = {
    discoveredCount: discovered.length,
    newlyRegisteredCount: discovered.filter((m) => m.reason.includes('새로 발견해 등록함')).length,
    videosAttachedCount: discovered.filter((m) => m.videoAttached === true).length,
  };

  // 계층형 분류: a request that names a taxonomy category ("하프 가드 스윕만 집중적으로") puts that category's
  // techniques at the centre of the pool — and, with "만 / 집중", keeps the pool to them when there are enough
  const taxonomyNode = findTaxonomyNodesInText(input.freeText, [martialArt]).find((n) => n.level >= 3 && n.kind !== 'other') ?? null;
  const taxonomyIds = taxonomyNode ? techniqueIdsForNode(taxonomyNode.id) : new Set<string>();
  const taxonomyFocus = !!taxonomyNode && /만\s*(집중|배우|공부|연습|하고)|집중적으로|\bonly\b/i.test(input.freeText);
  if (taxonomyNode && taxonomyIds.size > 0) {
    const byId = new Map(matches.map((m) => [m.techniqueId, m]));
    for (const id of taxonomyIds) {
      const t = resolveTechnique(id);
      if (!t) continue;
      const existing = byId.get(id);
      const reason = `MARTIALDEX 분류 '${taxonomyNode.fullKo}'에 속함`;
      byId.set(id, existing ? { ...existing, relevanceScore: Math.min(100, existing.relevanceScore + 20), reason } : { techniqueId: id, techniqueName: t.name, martialArt: t.martialArt, relevanceScore: 80, reason, phase: classifyPhase(t), structureRole: classifyTechniqueStructure(t) });
    }
    matches = [...byId.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
    if (taxonomyFocus) {
      const focused = matches.filter((m) => taxonomyIds.has(m.techniqueId));
      if (focused.length >= 2) matches = focused;
    }
    log('taxonomy category in goal', { node: taxonomyNode.id, techniques: taxonomyIds.size, pool: matches.length });
  }

  // "이미 학습한 기술 커리큘럼에 넣지 않기" (spec section 10/11) — removed from
  // the CANDIDATE POOL itself, here, before the fallback top-up/diversity
  // gate/planGoalCurriculum ever see these ids, never just hidden in the UI
  // after generation. "이미 학습한" = any real training history at all
  // (skillProgress status other than 'not_started' — masteryByTechniqueId
  // is the exact same real per-technique mastery data every other part of
  // this pipeline already uses for score-weighting, see buildMasteryMap()
  // above); a technique the user has merely seen but never trained
  // ('not_started') is not excluded, since the checkbox's own label is
  // about LEARNED techniques, not merely-known-to-exist ones.
  let excludedLearnedTechniqueCount = 0;
  if (input.excludeLearnedTechniques) {
    const beforeCount = matches.length;
    matches = matches.filter((m) => (masteryByTechniqueId.get(m.techniqueId) ?? 'not_started') === 'not_started');
    excludedLearnedTechniqueCount = beforeCount - matches.length;
    log('excluded already-learned techniques from candidate pool', { excludedLearnedTechniqueCount, remaining: matches.length });
  }

  // 근거 등급 정책 (web-evidence runs): the pool keeps only web-verified (A) and MARTIALDEX-DB-confirmed (B)
  // techniques of the parts in scope, one entry per real technique; everything else is listed as C and never
  // scheduled. The DB-wide fallback padding below never runs for these curricula.
  const evidenceMode = researchOutcome.researchMode === 'web_search' && !!researchOutcome.subGoals && researchOutcome.subGoals.length > 0;
  let evidencePolicy: EvidencePolicyResult | null = null;
  if (evidenceMode) {
    evidencePolicy = applyEvidencePolicy({
      matches,
      parts: researchOutcome.subGoals!,
      includedPartIds: researchOutcome.partial && resumed ? researchOutcome.partial.includedIds : null,
      webTechniques: researchOutcome.techniques,
      // the named category's members whose OWN posture data defines them as that category (HIGH) are DB-confirmed
      // for the core part; name-only (MEDIUM) members are not
      dbEvidence: [
        ...(researchOutcome.dbEvidence ?? []),
        ...(taxonomyNode && researchOutcome.subGoals?.[0]
          ? [...taxonomyIds]
              .map((id) => ({ id, a: (getArtTaxonomy(martialArt).techniqueAssignments.get(id) ?? []).find((x) => x.nodeId === taxonomyNode.id) }))
              .filter((x) => x.a?.confidence === 'HIGH')
              .map((x) => ({ techniqueId: x.id, name: resolveTechnique(x.id)?.name ?? x.id, partId: researchOutcome.subGoals![0].id, quote: x.a!.basis, checks: { family: 'pass' as const, focus: 'na' as const, position: 'pass' as const, purpose: 'na' as const, perspective: 'na' as const, kind: 'na' as const } }))
          : []),
      ],
      resolve: (id) => resolveTechnique(id) ?? undefined,
    });
    if (input.excludeLearnedTechniques) evidencePolicy.pool = evidencePolicy.pool.filter((m) => (masteryByTechniqueId.get(m.techniqueId) ?? 'not_started') === 'not_started');
    // "…만 집중": the DB-confirmed additions stay inside the named category too
    if (taxonomyFocus) {
      const focused = evidencePolicy.pool.filter((m) => taxonomyIds.has(m.techniqueId));
      if (focused.length >= 2) {
        evidencePolicy.pool = focused;
        evidencePolicy.parts = evidencePolicy.parts.map((p) => ({ ...p, techniqueIds: p.techniqueIds.filter((id) => taxonomyIds.has(id)) }));
      }
    }
    matches = evidencePolicy.pool;
    log('evidence policy', { A: evidencePolicy.counts.A, B: evidencePolicy.counts.B, C: evidencePolicy.excludedC.length, merged: evidencePolicy.duplicatesMerged });
    if (matches.length === 0) {
      const names = researchOutcome.techniques.map((t) => t.name).slice(0, 6).join(', ');
      return {
        ok: false,
        code: 'AI_ERROR',
        message: `웹에서 검증된 기술(${names})을 MARTIALDEX 기술로 등록·연결하지 못했고, MARTIALDEX 자체 데이터에서도 이 상황의 기술이 확인되지 않아 일정을 만들지 않았습니다. 확인되지 않은 기술로 채우지 않기 위한 중단입니다.`,
      };
    }
  }

  // Top up to a duration-scaled pool size (not just "at least 6") — a short
  // free-text goal was previously leaving long curricula with far too few
  // real techniques to fill their requested day count with new content,
  // which showed up as excess review-only days later in planGoalCurriculum.
  //
  // Skipped when researchMode === 'web_search' AND there's already a real,
  // non-trivial evidence-backed pool: this DB-wide pool draws from the
  // ENTIRE Martialdex technique DB with no connection to any search evidence
  // at all, so padding an already-working evidence-based pool with
  // un-evidenced DB techniques is exactly the "관련 없는 기술 추가" bug
  // reported — spec section 14's "evidence가 없는 기술은 후보군에 넣지 않는다"
  // applies here. A shortfall is reported honestly via `insufficientContent`
  // below instead of silently backfilled.
  //
  // BUT: if the evidence-backed pool came back genuinely empty/negligible
  // (the phrase-matcher + merged research names happened to resolve to zero
  // real DB techniques — e.g. a style/movement-heavy goal like "아웃복싱
  // 스타일" whose desiredTechniques don't fuzzy-match anything), skipping
  // unconditionally left planGoalCurriculum with nothing to schedule at all
  // — every Day came back empty and generation failed outright
  // (VALIDATION_FAILED), which is strictly worse than a DB-sourced
  // curriculum honestly flagged via insufficientContent. Same "never let the
  // pool collapse to zero" floor already used elsewhere in this function
  // (see the diversity strict-gate above).
  const MIN_EVIDENCE_POOL_BEFORE_SKIPPING_PADDING = 3;
  const neededPoolSize = estimateNeededPoolSize(totalDays, intensity);
  const skipFallbackPadding = evidenceMode || (researchOutcome.researchMode === 'web_search' && matches.length >= MIN_EVIDENCE_POOL_BEFORE_SKIPPING_PADDING);
  if (matches.length < neededPoolSize && !skipFallbackPadding) {
    const evidencePoolSizeBeforeFallback = matches.length;
    const fallback = fallbackTechniquePool(martialArt, analysis.estimatedLevel, {
      masteryByTechniqueId,
      limit: neededPoolSize,
      intents: analysis.intents,
      diversityRequested: analysis.diversityRequested,
      excludeLearned: input.excludeLearnedTechniques === true,
    });
    const byId = new Map(matches.map((m) => [m.techniqueId, m]));
    for (const m of fallback) if (!byId.has(m.techniqueId)) byId.set(m.techniqueId, m);
    matches = [...byId.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
    if (researchOutcome.researchMode === 'web_search') {
      log('web_search evidence pool was too small to stand on its own — used DB fallback as a safety net', { evidencePoolSizeBeforeFallback, neededPoolSize });
    }
  } else if (matches.length < neededPoolSize) {
    log('skipped DB-wide fallback padding — researchMode is web_search with a workable evidence-backed pool already', { poolSize: matches.length, neededPoolSize });
  }
  // Uniform, unconditional gate — the fix for the reported bug's actual
  // remaining leak: matchGoalToTechniques's per-role threshold and
  // fallbackTechniquePool's own scoring formula each had their OWN idea of
  // "good enough," and neither was re-checked once merged together, so a
  // primary_technique scoring 35 (matchGoalToTechniques never floors
  // primary-role items above 15) or a fallback-sourced counter/escape item
  // scoring 15 (fallbackTechniquePool's positional score formula) both
  // slipped through untouched. This is the single authoritative checkpoint
  // every candidate passes through regardless of which stage produced it —
  // <40 is rejected outright when diversity was requested, never merely
  // reported as "낮음" while still being scheduled.
  if (analysis.diversityRequested && !evidenceMode) {
    const beforeCount = matches.length;
    const strict = matches.filter((m) => m.relevanceScore >= 40);
    // Never let this collapse an otherwise-workable pool to zero — keep the
    // single best-scoring candidate as an absolute last resort so the
    // function still returns SOMETHING rather than erroring out; this is
    // an extreme edge case (would require every match to score under 40)
    // and insufficientContent/qualityWarning below still report it honestly.
    matches = strict.length > 0 ? strict : matches.slice(0, 1);
    log('strict relevance gate applied (diversity mode, >=40 only)', { before: beforeCount, after: matches.length });
  }

  // Spec 1-12: even after the fallback top-up, a genuinely narrow goal
  // (e.g. wrestling's ~30 defense/counter/escape/fundamentals techniques out
  // of 189) can still fall short of the target pool size — that's reported
  // honestly below rather than force-filled with off-topic content.
  // evidence curricula with a short pool use the focused schedule (repetition / connection / situations) instead
  // — when its techniques would teach on fewer than 60% of the days, so the standard planner would pad with review
  const [perDayLo, perDayHi] = INTENSITY_PER_DAY[intensity];
  const focusedSchedule = evidenceMode && Math.ceil(matches.length / ((perDayLo + perDayHi) / 2)) < totalDays * 0.6;
  const poolShortfall = !focusedSchedule && matches.length < neededPoolSize;

  // Spec sections 6/14/15 — only reorders (never drops) when the goal
  // explicitly asked for topic breadth: pushes excess near-duplicate-family
  // matches (e.g. four different "Double Leg ..." variants) toward the tail
  // so genuinely different mechanisms schedule first. A no-op for every
  // other goal (see diversity.ts's guard on the `diversityRequested` flag).
  matches = selectDiverseTechniques(matches, { diversityRequested: analysis.diversityRequested, maxPerFamily: 2 });
  log('diversity selection applied', { diversityRequested: analysis.diversityRequested, poolSize: matches.length });

  // Spec sections 6/7 — a duration Gemini suggested BEFORE any real
  // technique matching happened (analyzeGoal's suggestedDurationDays is
  // pure free-text judgment) must not be trusted blindly once the REAL,
  // strictly-filtered pool turns out too thin to fill it with genuine new
  // content — that mismatch is exactly what produced "60일, 새 기술 34일 ·
  // 복습 전용 26일": the planner has no choice but to convert the days it
  // can't fill into review once totalDays is fixed too high. Only ever
  // SHRINKS, and only when the user didn't fix a specific number
  // (durationMode 'ai_recommended') — a user-typed day count is never
  // second-guessed here, same rule as everywhere else in this pipeline.
  if (durationMode === 'ai_recommended' && analysis.diversityRequested) {
    const [lo, hi] = INTENSITY_PER_DAY[intensity];
    const avgPerDay = (lo + hi) / 2;
    // Enough days to teach every qualified technique once, plus a modest
    // (not dominant) review allowance — matches curriculumPlanner.ts's own
    // ~8% final-review-day ratio instead of inventing a second formula.
    const daysThePoolCanFill = Math.ceil(matches.length / avgPerDay);
    const withReviewAllowance = Math.ceil(daysThePoolCanFill * 1.15);
    const recommendedDays = Math.max(GOAL_MIN_DURATION_DAYS, Math.min(totalDays, withReviewAllowance));
    if (recommendedDays < totalDays) {
      log('duration recomputed from real pool size (ai_recommended, diversity mode)', { original: totalDays, recomputed: recommendedDays, poolSize: matches.length });
      totalDays = recommendedDays;
    }
  }

  const subjectLabel = title.replace(/ 커리큘럼$/, '');

  function planAndValidate(pool: GoalTechniqueMatch[]) {
    if (focusedSchedule && evidencePolicy) {
      const ids = new Set(pool.map((m) => m.techniqueId));
      const planned = planEvidenceCurriculum({
        subjectLabel,
        matches: pool,
        parts: evidencePolicy.parts.map((p) => ({ ...p, techniqueIds: p.techniqueIds.filter((id) => ids.has(id)) })),
        targetDays: totalDays,
        intensity,
        dailyMinutes: input.dailyMinutes,
      });
      return { ...planned, validation: validateCurriculumDays(planned.days, totalDays) };
    }
    const { days, phases } = planGoalCurriculum({
      subjectLabel,
      matches: pool,
      targetDays: totalDays,
      intensity,
      userLevel: analysis.estimatedLevel,
      masteryByTechniqueId,
      diversityRequested: analysis.diversityRequested,
      goalIntents: analysis.intents,
    });
    const validation = validateCurriculumDays(days, totalDays);
    return { days, phases, validation };
  }

  let pool = matches;
  let attempt = planAndValidate(pool);

  // Self-healing retry (belt-and-suspenders, spec section 4) — never
  // re-prompts Gemini (planGoalCurriculum is deterministic given the same
  // pool, so retrying with an UNCHANGED pool would just fail identically).
  // Instead, when validation reports a technique id that doesn't actually
  // resolve (e.g. a discovery that raced/failed after being added to the
  // pool), drop exactly those ids from the pool and re-plan ONCE — the pool
  // strictly shrinks each attempt so this can never loop more than once.
  if (!attempt.validation.ok) {
    const resolvablePool = pool.filter((m) => !!resolveTechnique(m.techniqueId));
    if (resolvablePool.length < pool.length) {
      pool = resolvablePool;
      attempt = planAndValidate(pool);
    }
  }

  // Section 10's re-match safety net: if the scheduled Days ended up
  // dominated by the opposite intent camp (e.g. a "테이크다운 방어" goal
  // whose Days are mostly Double Leg/Single Leg-style attack techniques),
  // hard-exclude every remaining opposite-camp match from the pool and
  // re-plan ONCE. Bounded (the pool only ever shrinks), and only adopted if
  // it actually validates AND measurably improves alignment — otherwise the
  // original attempt is kept rather than risking a worse/invalid result.
  // Tracks the intent-alignment result of whichever attempt (original or
  // stricter re-match) actually ends up adopted below — used after this
  // block to build an honest contentWarning instead of silently keeping a
  // still-flagged result (spec 1-11/1-12).
  let finalAlignment: { ok: boolean; conflictingRatio: number } = { ok: true, conflictingRatio: 0 };
  if (attempt.validation.ok && analysis.intents.length > 0) {
    const alignment = checkIntentAlignment(attempt.days, analysis.intents);
    finalAlignment = alignment;
    if (!alignment.ok) {
      const strictPool = pool.filter((m) => {
        const technique = resolveTechnique(m.techniqueId);
        return !technique || !isOppositeCamp(analysis.intents, classifyTechniqueIntents(technique));
      });
      if (strictPool.length < pool.length) {
        const strictAttempt = planAndValidate(strictPool);
        const contentDays = (d: CurriculumDay[]) => d.filter((day) => day.techniqueIds.length > 0).length;
        const originalContentDays = contentDays(attempt.days);
        const strictContentDays = contentDays(strictAttempt.days);
        // Only adopt the stricter re-match if it doesn't gut the
        // curriculum's actual content density — dropping from e.g. 28
        // content days to 9 (and the rest becoming near-duplicate review
        // days off a tiny sample) is a worse outcome than keeping some
        // residual off-camp content alongside a curriculum that's actually
        // full of real, varied material.
        if (strictAttempt.validation.ok && strictContentDays >= originalContentDays * 0.7) {
          const strictAlignment = checkIntentAlignment(strictAttempt.days, analysis.intents);
          if (strictAlignment.conflictingRatio < alignment.conflictingRatio) {
            pool = strictPool;
            attempt = strictAttempt;
            finalAlignment = strictAlignment;
          }
        }
      }
    }
  }

  // Spec section 20's quality gate — separate axis from the intent-camp
  // retry above (that one catches "attack technique in a defense goal";
  // this one catches "grip/stance/position filler in a diversity goal" —
  // the exact reported bug, where 67/68 candidates were "낮음(<40)" yet
  // still got scheduled). Same bounded-retry shape: try once with a
  // primary/entry/counter/escape-only pool, adopt only if it validates and
  // doesn't gut content density, otherwise keep the original and report
  // the real ratio honestly via qualityWarning below.
  let finalQuality = validateCurriculumQuality(attempt.days, new Map(pool.map((m) => [m.techniqueId, m])), analysis.diversityRequested);
  if (attempt.validation.ok && analysis.diversityRequested && !finalQuality.ok) {
    const PRIMARY_ADJACENT_ROLES = new Set(['primary_technique', 'entry', 'counter', 'escape']);
    const strictPool = pool.filter((m) => PRIMARY_ADJACENT_ROLES.has(m.structureRole));
    if (strictPool.length > 0 && strictPool.length < pool.length) {
      const strictAttempt = planAndValidate(strictPool);
      const contentDays = (d: CurriculumDay[]) => d.filter((day) => day.techniqueIds.length > 0).length;
      const originalContentDays = contentDays(attempt.days);
      const strictContentDays = contentDays(strictAttempt.days);
      if (strictAttempt.validation.ok && strictContentDays >= originalContentDays * 0.5) {
        const strictQuality = validateCurriculumQuality(strictAttempt.days, new Map(strictPool.map((m) => [m.techniqueId, m])), analysis.diversityRequested);
        if (strictQuality.primaryRatio > finalQuality.primaryRatio) {
          pool = strictPool;
          attempt = strictAttempt;
          finalQuality = strictQuality;
        }
      }
    }
  }

  if (!attempt.validation.ok) {
    return { ok: false, code: 'VALIDATION_FAILED', errors: attempt.validation.errors };
  }

  const qualityWarning = !finalQuality.ok
    ? {
        primaryRatio: finalQuality.primaryRatio,
        message: `생성된 커리큘럼에 포함된 새 기술 중 실제로 요청하신 핵심 기술(예: 테이크다운 자체)의 비중이 약 ${Math.round(finalQuality.primaryRatio * 100)}%로 낮고, 나머지는 그립·포지션·기초 동작 같은 보조 기술입니다. 목표를 더 구체적으로 입력해 다시 만들어보시는 것을 권장합니다.`,
      }
    : undefined;

  // Spec 1-11/1-12's "정직하게 표시" — the old behavior silently kept
  // whatever the original (still up-to-45%-conflicting) attempt was when the
  // stricter re-match didn't clear the bar above. Saving is still allowed
  // (this never returns VALIDATION_FAILED for a content-quality issue), but
  // the preview now always surfaces the real number instead of hiding it.
  const contentWarning = !finalAlignment.ok
    ? {
        offCampRatio: finalAlignment.conflictingRatio,
        message: `생성된 커리큘럼에 포함된 기술 중 약 ${Math.round(finalAlignment.conflictingRatio * 100)}%가 입력하신 목표와 반대되는 성격(예: 방어 목표에 공격 기술)을 가질 수 있습니다. 목표를 더 구체적으로 입력해 다시 만들어보시는 것을 권장합니다.`,
      }
    : undefined;

  const finalContentDays = attempt.days.filter((d) => d.techniqueIds.length > 0).length;
  const insufficientContent = !focusedSchedule && (poolShortfall || finalContentDays < totalDays * 0.5);
  const scheduledIds = new Set(attempt.days.flatMap((d) => [...d.techniqueIds, ...d.reviewTechniqueIds]));
  const evidenceSummary: GoalCurriculumPreview['evidence'] = evidencePolicy
    ? {
        counts: {
          A: pool.filter((m) => m.evidenceGrade === 'A' && scheduledIds.has(m.techniqueId)).length,
          B: pool.filter((m) => m.evidenceGrade === 'B' && scheduledIds.has(m.techniqueId)).length,
        },
        excludedC: evidencePolicy.excludedC,
        duplicatesMerged: evidencePolicy.duplicatesMerged,
        scheduleMode: focusedSchedule ? 'focused' : 'standard',
        fullScope: !partialScope,
      }
    : undefined;

  // Built here, at the very end, because it needs the FINAL pool/days —
  // "which researched name ended up matched" and "which matched technique
  // actually made it into the schedule" can only be answered once
  // everything upstream (matching, discovery, diversity reordering, the
  // intent re-match retry) has settled. Spec sections 8/9/11.
  const finalTechniqueIds = new Set(attempt.days.flatMap((d) => [...d.techniqueIds, ...d.reviewTechniqueIds]));
  const foundTechniques: GoalCurriculumFoundTechnique[] = researchOutcome.techniques.map((rt) => {
    const match = pool.find((m) => namesLikelySame(m.techniqueName, rt.name));
    return {
      name: rt.name,
      matchedToDatabase: !!match,
      structureRole: match?.structureRole,
      sourceUrls: researchOutcome.researchMode === 'web_search' ? rt.sourceUrls : undefined,
      evidence: researchOutcome.researchMode === 'web_search' ? rt.evidence : undefined,
    };
  });
  // Only meaningful when diversity mode actually demoted anything — a
  // matched-but-unscheduled researched technique under a non-diversity goal
  // just means the day-count/pool ran out of room, not that it was
  // deprioritized for being generic (spec section 11's example format is
  // specifically about the structural-role reason, not every possible
  // reason a technique might not make the final cut).
  const structuralExclusions: ExcludedResearchTechnique[] = [];
  if (analysis.diversityRequested) {
    for (const rt of researchOutcome.techniques) {
      const match = pool.find((m) => namesLikelySame(m.techniqueName, rt.name));
      if (!match || finalTechniqueIds.has(match.techniqueId)) continue;
      if (isLowPriorityStructureRole(STRUCTURE_ROLE_WEIGHT[match.structureRole])) {
        structuralExclusions.push({ name: rt.name, reason: `${STRUCTURE_ROLE_LABEL_KO[match.structureRole]}(으)로 분류되어 우선순위가 낮아짐` });
      }
    }
  }

  const registeredCount = foundTechniques.filter((t) => t.matchedToDatabase).length;
  const researchSummary: GoalCurriculumResearchSummary = {
    status: researchOutcome.status,
    researchMode: researchOutcome.researchMode,
    researchedCount: researchOutcome.rawCount,
    validResearchedCount: researchOutcome.techniques.length,
    excludedOppositeCampCount: researchOutcome.excludedOppositeCampCount,
    mergedIntoDesiredCount,
    usedSearchGrounding: researchOutcome.usedSearchGrounding,
    groundingSourceCount: researchOutcome.groundingSources.length,
    plannedQueries: researchOutcome.plannedQueries,
    actualSearchQueries: researchOutcome.actualSearchQueries,
    excludedTechniques: [...researchOutcome.excluded, ...structuralExclusions],
    foundTechniques,
    ok: researchOutcome.ok,
    usedExternalWebSearch: researchOutcome.usedExternalWebSearch,
    executedQueries: researchOutcome.executedQueries,
    searchResultCount: researchOutcome.searchResultCount,
    analyzedSourceCount: researchOutcome.analyzedSourceCount,
    registeredCount,
    externalOnlyCount: foundTechniques.length - registeredCount,
    uncertainCount: researchOutcome.excluded.filter((e) => e.reason.includes('근거가 충분하지 않아')).length,
    diagnostics: researchOutcome.diagnostics,
    review: researchOutcome.review,
  };
  log('final candidates', { totalMatched: pool.length, scheduledDays: attempt.days.length, researchStatus: researchOutcome.status });
  const finalScheduledTechniqueCount = new Set(attempt.days.flatMap((d) => d.techniqueIds)).size;
  structuredLog('CURRICULUM_GENERATION', { candidateCount: pool.length, selectedCount: finalScheduledTechniqueCount, researchMode: researchOutcome.researchMode });
  structuredLog('CURRICULUM_VALIDATION', {
    status: finalAlignment.ok && finalQuality.ok ? 'passed' : 'warning',
    intentAlignment: finalAlignment.ok ? 'ok' : `conflictingRatio=${finalAlignment.conflictingRatio.toFixed(2)}`,
    quality: finalQuality.ok ? 'ok' : `primaryRatio=${finalQuality.primaryRatio.toFixed(2)}`,
  });

  const orderedDays = martialArt === MMA_MARTIAL_ART_ID && isSubmissionGoal(input.freeText) ? attempt.days.map(takedownBeforeSubmission) : attempt.days;
  // Setups / combos / connections from recorded MARTIALDEX sequences. Additive and
  // best-effort: a failure here never blocks the curriculum, it is only reported.
  let finalDays = orderedDays;
  let sequenceDrills: GoalCurriculumPreview['sequenceDrills'];
  try {
    const knowledge = await loadKnowledgeIndex();
    const attached = attachSequenceDrills(orderedDays, knowledge, { art: martialArt });
    finalDays = attached.days;
    sequenceDrills = {
      totalDrills: attached.totalDrills,
      daysWithoutDrills: attached.daysWithoutDrills,
      sources: knowledge.sources,
      warning:
        goalAsksForSequences(input.freeText) && attached.totalDrills === 0
          ? 'MARTIALDEX에 기록된 셋업·콤보 중 이 커리큘럼 기술과 이어지는 것을 찾지 못했습니다. 확인되지 않은 셋업·콤보를 만들어 넣지 않았습니다.'
          : undefined,
    };
  } catch (e) {
    log('sequence drills skipped', { error: String(e) });
  }

  return {
    ok: true,
    preview: {
      title,
      martialArt,
      analysis,
      matchedTechniques: pool,
      days: finalDays,
      phases: attempt.phases,
      totalDays,
      intensity,
      dailyMinutes: input.dailyMinutes,
      durationMode,
      goalText: input.freeText,
      refinementHistory: input.refinementHistory ?? [],
      research: researchSummary,
      discoveryStats,
      contentWarning,
      qualityWarning,
      partialScope,
      evidence: evidenceSummary,
      insufficientContent,
      excludedLearnedTechniqueCount,
      sequenceDrills,
    },
  };
}

/** Saves a preview as a real Curriculum — identical repository path as every other curriculum (official/custom/style). */
export function saveGoalCurriculumPreview(preview: GoalCurriculumPreview, existingId?: string): Curriculum {
  const now = new Date().toISOString();
  const techniqueCount = new Set(preview.days.flatMap((d) => d.techniqueIds)).size;

  const aiGoalMeta: AiGoalCurriculumMeta = {
    goalText: preview.goalText,
    analysis: preview.analysis,
    matchedTechniques: preview.matchedTechniques,
    durationMode: preview.durationMode,
    intensity: preview.intensity,
    dailyMinutes: preview.dailyMinutes,
    generatedAt: now,
    refinementHistory: preview.refinementHistory,
    partialScope: preview.partialScope,
    evidence: preview.evidence,
  };
  const scopeNote = preview.partialScope
    ? ` ⚠ 전체 목표 중 일부만 반영된 커리큘럼입니다 — 포함: ${preview.partialScope.included.join(', ')} / 근거 부족으로 제외: ${preview.partialScope.excluded.map((e) => e.label).join(', ')}.`
    : '';
  const gradeNote = preview.evidence ? ` 근거: 웹 자료로 검증된 기술 ${preview.evidence.counts.A}개 · MARTIALDEX DB로 확인된 기술 ${preview.evidence.counts.B}개.` : '';

  const curriculum: Curriculum = {
    id: existingId ?? newId(),
    martialArt: preview.martialArt,
    title: preview.title,
    subtitle: 'AI 맞춤 커리큘럼',
    description:
      `${preview.analysis.summary} 사용자가 입력한 목표와 Martialdex의 기술 데이터를 바탕으로 AI가 생성한 학습 커리큘럼입니다.${scopeNote}${gradeNote} ` +
      '실제 훈련은 반드시 전문 지도자의 지도와 안전한 환경에서 진행해야 합니다.',
    source: 'custom',
    visibility: 'private',
    authorName: getAuthorName(),
    coverIcon: '🧠',
    totalDays: preview.days.length,
    estimatedWeeks: Math.max(1, Math.ceil(preview.days.length / 4)),
    phases: preview.phases,
    days: preview.days,
    techniqueCount,
    createdAt: now,
    updatedAt: now,
    aiGoalMeta,
  };

  curriculumRepository.saveCustom(curriculum);
  return curriculum;
}

export function listMyGoalCurricula(): Curriculum[] {
  return listMyCurricula().filter((c) => !!c.aiGoalMeta);
}
