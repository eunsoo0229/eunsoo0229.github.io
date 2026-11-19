// One conversation turn of the MARTIALDEX 자체 AI 코치:
//   plan (code) → MARTIALDEX DB + knowledge index → self-hosted search (when the
//   plan says so) → local model writes the answer from that material → guard
//   checks citations / search claims → sources are attached by code.
//
// Small local models were measured to get martial-arts facts wrong on their
// own (data/audit/self-ai/local-models-*.json), so the model is only ever the
// writer: facts come from the DB and from pages that were actually fetched.

import type { Technique } from '../../types';
import { previewFor } from './preview';
import { buildTechniqueContext } from '../ai/context';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { gatherTechniqueKnowledge, knowledgeContextBlock } from '../martialdexKnowledge/index';
import type { PersonName, ResearchOutcome, ResearchRequest, ResearchResult } from '../selfResearch/types';
import { guardAnswer } from './guard';
import { fighterReportText } from './fighterReport';
import { artsForTopic } from '../fighterStyle/ruleExtract';
import { styleQueries, type EvidenceStyleOptions, type EvidenceStyleReport } from '../fighterStyle/evidenceStyle';
import { dedupeSentences } from '../coachLesson/lessonQuality';
import { focusedBlock, focusSources } from './sourceFocus';
import { checkClaims, claimSummary, dropContradicted, PROBLEM_LABEL, type ClaimCheck, type EvidenceSource } from './evidenceCheck';
import { fixTerminology, glossaryBlock } from './terminology';
import { sequenceReport } from './sequenceReport';
import { planTurn, type TurnIntent, type TurnPlan } from './router';
import { runExclusiveTurn, type SocialPeriod, type SocialTrendingResult } from './exclusiveTurn';
import { lessonPlanText, planLesson, type LessonPlan } from './lessonPlanner';
import { familyAnswerText } from './familyAnswer';
import { categoryTopicsInText } from '../knowledgeBase/topics';
import { artIn } from '../coachKnowledge/featureCatalog';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { lessonQuestionPrompt, lessonQuestionQueries, lessonTechniqueFacts } from './lessonQuestion';
import { resolveTechnique } from '../userTechniques/service';
import { fighterComboProposal, lessonContextBlock, proposalText, proposeLessonAddition, type LessonSnapshot } from './lessonSession';
import { compareTargetAnswer, prerequisiteAnswer, relatedAnswer, reviewAnswer } from './lessonAnswers';
import type { TechniqueLearning } from '../personalCoach/learnerModel';
import { personalAnswer, recentArt } from '../personalCoach/personalAnswers';
import { planTraining, trainingPlanText, trainingTechniqueIds } from './trainingPlanner';
import { improveAnswer } from '../personalCoach/improveAnswer';
import { captureGuide, pickReferenceVideos, poseSupport } from '../poseCoach/poseCoach';
import { listSupportedTechniqueIds } from '../poseAnalysis/poseAnalysisConfig';
import type { ChatSource, CoachChatMessage, LessonProposal, SelfAiChatRequest, SelfAiChatResult, SelfAiMessage, TurnMeta, TurnResearchInfo } from './types';
import { analyzeIntents, type IntentAnalysis } from './intents';
import { sourceConflicts } from './evidenceSummary';
import { ACCEPT, buildConversationMemory, DECLINE, memoryBlock, type Aspect, type ConversationMemory, type TopicThread } from './conversationMemory';
import { compositeTurn, proposalFromTopic, topicSummary } from './compositeTurn';
import type { StyleProfile } from '../fighterProfile/styleTraits';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { runSkillTurn, type BodyProfile } from './skillTurn';

export interface CoachAgentDeps {
  research: (req: ResearchRequest) => Promise<ResearchOutcome>;
  chat: (req: SelfAiChatRequest, onDelta?: (d: string) => void) => Promise<SelfAiChatResult>;
  knowledgeIndex: () => Promise<KnowledgeIndex>;
  /** Learner memory: training records, fighter profile, recent lessons (data only). */
  learnerContext: (art: string | null, topic: string) => string;
  /** Lesson currently in progress, if the chat runs inside a lesson. */
  lessonContext?: () => string | null;
  /**
   * Answer from MARTIALDEX data alone (coachKnowledge — the tested deterministic
   * engine) for technique questions that need no search. Measured: the local
   * model contradicts the technique data when writing freely, so these questions
   * never go to free generation.
   */
  dataAnswer?: (technique: Technique | null, text: string, art: string | null) => Promise<string | null>;
  /** Korean display name of an art id ("boxing" → "복싱"). */
  artName?: (art: string) => string;
  /**
   * MARTIALDEX's own social tables — "이번 주 하트 많은 콤보/게시물" is an internal
   * aggregation, never a web search (§16). Optional so every existing caller and
   * test keeps working; without it the turn says the lookup is unavailable rather
   * than quietly falling back to search.
   */
  socialTrending?: (period: SocialPeriod) => Promise<SocialTrendingResult>;
  /** A person's English name from a fetched source (Wikipedia link). */
  resolveName?: (name: string) => Promise<PersonName>;
  /** The learner's own records as a read-only model (personalCoach/learnerModel.ts). */
  learner?: () => TechniqueLearning[];
  /** The learner's finished AI 코치 lessons (read only). */
  lessonLogs?: () => import('../coachLesson/lessonLog').LessonLogEntry[];
  /** The lesson in progress, for "하던 수업 이어서 하자". */
  activeLesson?: () => { title: string; route: string; current: string | null; stepLabel: string } | null;
  /** Evidence-based fighter style analysis (fighterStyle/evidenceStyle.ts). */
  fighterStyle?: (fighter: string, art: string, opts: EvidenceStyleOptions) => Promise<EvidenceStyleReport>;
  /** A question whose answer is a stored value (프로필 · 목표 · 루틴 · 훈련 기록 · 자세 측정) → the code-written answer, else null. */
  personalFact?: (text: string) => { text: string; stores: string[]; loadFailed: boolean } | null;
  /** "나에게 맞춘 점" lines for a planned lesson (coachContext/personalFacts.ts lessonFitText) — '' when nothing stored. */
  lessonFit?: (techniqueIds: string[]) => string;
  /** 10차: analysis of the learner's own data (coachContext/coachAnalysis.ts) — null when the question is not one. */
  personalAnalysis?: (text: string, art: string | null) => Promise<import('../coachContext/coachAnalysis').AnalysisAnswer | null>;
  /** 10차: the stored goal a "목표에 맞는 수업" request refers to (이번 주 → 이번 달 → …). */
  goalText?: (question: string) => { label: string; text: string } | null;
  /** 10차: official technique names in the model's Korean (selfAi/terminology.ts). */
  terminology?: (text: string, context?: string) => { text: string; notes: string[] };
  /** Techniques a text names (coachKnowledge exactTechniquesInText) — the names "in play" for terminology. */
  namedIn?: (text: string) => Technique[];
  /** 10차: a question about several of the learner's own data domains at once (coachAnalysis.ts isPersonalComposite). */
  personalComposite?: (text: string) => boolean;
  /** The fighter profile as comparison data (fighterProfile/styleTraits.ts) — never printed as a whole. */
  styleProfile?: () => StyleProfile;
  /** The record-based style answer (coachContext/coachAnalysis 'style'). */
  styleRecords?: () => Promise<string | null>;
  /** Topics of the user's other recent conversations (long-term memory line). */
  pastTopics?: () => string;
  /** 나의 학습 커리큘럼 · 오늘의 학습 · 성과 questions (trainingEcosystem/coachBridge.ts) — code-written, never changes the plan. */
  ecosystem?: (text: string) => { text: string; stores: string[]; techniqueIds: string[]; action?: { label: string; to: string } } | null;
  /** Safety line for a technique (safety/techniqueSafety.ts): general rules by its kind + the learner's prerequisite states. */
  safetyLine?: (t: Technique) => string;
  /** 체격 비교: the stored body values (fighter profile) — read only. */
  bodyProfile?: () => BodyProfile;
  /** Technique ids of the lesson running now (CoachDayRun), for "방금 찾은 내용을 수업에 추가해줘" outside the lesson. */
  activeLessonTechniqueIds?: () => string[] | null;
}

export interface TurnInput {
  text: string;
  history: CoachChatMessage[];
  martialArt: string | null;
  inLesson?: boolean;
  /** In a lesson: the technique being taught right now (its records + a search aimed at it answer the question). */
  lessonTechniqueId?: string;
  /** In a lesson: the whole lesson as the question sees it (read only — the agent never changes the lesson). */
  lesson?: LessonSnapshot;
  requestId: string;
  onDelta?: (d: string) => void;
  onStatus?: (s: string) => void;
}

export interface TurnOutput {
  message: Omit<CoachChatMessage, 'id' | 'createdAt'>;
  plan: TurnPlan;
  /** Raw research results (for lesson / candidate building by the caller). */
  results: ResearchResult[];
}

const MAX_SOURCES = 6;
const SOURCE_CHARS = 1400;
const HISTORY_TURNS = 4;

export const SYSTEM_RULES = [
  '너는 MARTIALDEX 자체 AI 코치다. 한국어 존댓말로 친절하고 간결하게 답한다.',
  '규칙:',
  '1. 사실은 아래 [MARTIALDEX 데이터]와 [검색 자료]에 있는 내용만 말한다. 자료에 없는 기술 설명, 선수 기록, 사용 빈도, 경기 사례를 만들지 않는다.',
  '2. [검색 자료]의 내용을 쓸 때는 그 문장 끝에 [번호]를 붙인다. 없는 번호를 쓰지 않는다.',
  '3. 자료를 바탕으로 한 너의 해석이나 조언은 "제 판단으로는"처럼 추론임을 밝힌다.',
  '4. [검색 자료]가 없으면 검색했다고 말하지 않는다. 자료가 부족하면 부족하다고 말한다.',
  '5. 링크(URL)를 직접 쓰지 않는다. 출처 목록은 앱이 답변 아래에 붙인다.',
  '6. 부상 위험이 있는 기술은 지도자와 안전한 환경에서 연습하라고 짧게 덧붙인다.',
].join('\n');

export function toSources(results: ResearchResult[]): ChatSource[] {
  return results.slice(0, MAX_SOURCES).map((r, i) => ({
    n: i + 1,
    ...(r.sourceId ? { sourceId: r.sourceId } : {}),
    ...(r.fetchedAt ? { fetchedAt: r.fetchedAt } : {}),
    title: r.title,
    url: r.url,
    source: r.source,
    sourceType: r.sourceType,
    sourceTypeLabel: r.sourceTypeLabel,
    publishedAt: r.publishedAt,
    reliability: r.reliability,
    contentRead: r.extraction.status === 'ok',
    ...(r.video ? { video: r.video } : {}),
    ...(r.paper ? { paper: r.paper } : {}),
  }));
}

/**
 * 출처 목록에 "실제로 답변의 근거로 쓴 자료"를 표시한다 (사양 §5).
 * 쓴 자료 = 그 본문 문장이 모델에게 근거로 넘어갔거나(focusSources) 분석이 문장을 인용한 자료.
 * 나머지는 "참고" — 검색에 걸렸을 뿐 이 답변이 기대고 있지 않다는 뜻이다.
 */
function markUsed(sources: ChatSource[], usedUrls: Set<string>, why?: Map<string, string[]>): ChatSource[] {
  for (const s of sources) {
    s.used = usedUrls.has(s.url);
    const w = why?.get(s.url);
    if (w?.length) s.relevanceWhy = w;
  }
  return sources;
}

/** Intents whose answer never depends on who the learner is — the personal block is skipped to keep the prompt small. */
const NO_USER_CONTEXT = new Set<TurnIntent>(['smalltalk', 'video', 'paper', 'fighter', 'web', 'curriculum', 'lesson', 'continue_lesson', 'lesson_add', 'pose_check']);

function sourcesBlock(results: ResearchResult[], max = MAX_SOURCES, chars = SOURCE_CHARS): string {
  return results
    .slice(0, max)
    .map((r, i) => {
      const body = (r.content ?? r.snippet ?? '').replace(/\s+/g, ' ').slice(0, chars);
      const meta = [r.sourceTypeLabel, r.publishedAt ? `게시일 ${r.publishedAt.slice(0, 10)}` : '게시일 미확인', r.content ? '본문' : '검색 요약만'].join(' · ');
      return `[${i + 1}] ${r.title} (${r.source ?? ''}; ${meta})\n${body}`;
    })
    .join('\n\n');
}

function techniqueBlock(techniques: Technique[], index: KnowledgeIndex | null, art: string | null): string {
  return techniques
    .slice(0, 3)
    .map((t) => {
      const k = index ? gatherTechniqueKnowledge(t.id, index, { art: art ?? undefined }) : null;
      return [buildTechniqueContext(t).slice(0, 1800), k ? knowledgeContextBlock(k, 4) : ''].filter(Boolean).join('\n');
    })
    .join('\n\n---\n\n');
}

function historyMessages(history: CoachChatMessage[]): SelfAiMessage[] {
  // The 🔎 search notice is app-written status, not part of the conversation.
  return history.slice(-HISTORY_TURNS * 2).map((m) => ({ role: m.role, content: m.text.split('\n').filter((l) => !l.startsWith('🔎')).join('\n').trim().slice(0, 500) }));
}

function researchInfo(plan: TurnPlan, outcome: ResearchOutcome | null): TurnResearchInfo {
  const base = { kind: plan.research.kind, queries: plan.research.queries, reason: plan.research.reason };
  if (!plan.research.needed) return { ...base, searched: false, status: 'skipped', reason: '검색이 필요 없는 질문' };
  if (!outcome) return { ...base, searched: false, status: 'skipped' };
  if (!outcome.ok) {
    if (outcome.code === 'DISABLED') return { ...base, searched: false, status: 'disabled', message: outcome.message };
    return { ...base, searched: outcome.code !== 'UNSUPPORTED', status: outcome.code === 'UNSUPPORTED' ? 'unsupported' : 'failed', message: outcome.message, failureCode: outcome.code };
  }
  return {
    ...base,
    searched: true,
    status: outcome.results.length ? 'ok' : 'empty',
    failedEngines: outcome.diagnostics.failedEngines?.map((e) => e.engine),
    duplicatesRemoved: outcome.diagnostics.duplicatesRemoved,
    pagesRead: outcome.results.filter((r) => r.extraction.status === 'ok').length,
    rawCount: outcome.diagnostics.rawCount,
    irrelevantRemoved: outcome.diagnostics.irrelevantRemoved,
    removedTitles: outcome.diagnostics.removedTitles,
    ...(outcome.cache ? { cached: outcome.cache } : {}),
  };
}

/** What the learner is told about the search before the answer (code-written, always truthful). */
export function researchNotice(info: TurnResearchInfo, sourceCount: number): string | null {
  if (info.status === 'skipped') return null;
  if (info.status === 'unsupported') return `🔎 이 기기에서는 실시간 검색을 할 수 없어 검색하지 않았습니다. (${info.message ?? ''})`;
  if (info.status === 'disabled') return '🔎 자체 검색이 꺼져 있어 검색하지 않았습니다 (설정 > AI 엔진에서 켤 수 있습니다). 아래 답변은 MARTIALDEX 데이터만 근거로 합니다.';
  if (info.status === 'failed') return `🔎 검색을 시도했지만 실패했습니다${FAILURE_KIND[info.failureCode ?? ''] ? ` (${FAILURE_KIND[info.failureCode ?? '']})` : ''}: ${info.message ?? '알 수 없는 오류'} — 다시 시도하지 않았고, 아래 답변은 MARTIALDEX 데이터만 근거로 합니다.`;
  if (info.status === 'empty') {
    // "the engines found nothing" and "found N, none on topic" are different answers
    if (info.rawCount && info.irrelevantRemoved) {
      const seen = info.removedTitles?.length ? ` (예: ${info.removedTitles.slice(0, 2).map((t) => `「${t.slice(0, 50)}」`).join(', ')})` : '';
      return `🔎 검색 엔진이 ${info.rawCount}건을 찾았지만 질문 주제와 맞지 않아 모두 제외했습니다${seen}. 관련 자료로 볼 수 있는 결과는 0건입니다.`;
    }
    return `🔎 검색했지만 검색 엔진이 찾은 결과가 0건입니다.${info.failedEngines?.length ? ` (응답하지 않은 엔진: ${info.failedEngines.join(', ')})` : ''}`;
  }
  const what = info.kind === 'video' ? '영상' : info.kind === 'paper' ? '논문·연구 자료' : '웹';
  // a reused search is never shown as a new one: when it ran, until when it is kept, and the server's state now
  if (info.cached) {
    return `🔎 이전 검색 결과 사용 중 — ${clock(info.cached.searchedAt)}에 검색한 ${what} 결과 ${sourceCount}건 (본문 확인 ${info.pagesRead ?? 0}건) · 캐시 유효 ${clock(info.cached.expiresAt)}까지 · 검색 서버 현재 상태: ${info.cached.serverUp ? '응답함' : '응답 없음'}. 지금 새로 검색한 결과가 아닙니다.`;
  }
  return `🔎 ${what} 검색 결과 ${sourceCount}건 (본문 확인 ${info.pagesRead ?? 0}건)`;
}

const FAILURE_KIND: Record<string, string> = { NOT_RUNNING: '검색 서버 응답 없음', TIMEOUT: '검색 서버 응답 지연', BAD_RESPONSE: '검색 서버 응답 오류', SEARCH_FAILED: '모든 검색 요청 실패' };

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dataOnlyAnswer(plan: TurnPlan, techniques: Technique[], sources: ChatSource[], reason: string): string {
  const lines = [`로컬 AI 모델을 사용할 수 없어 수집한 자료만 보여드립니다. (${reason})`];
  for (const t of techniques.slice(0, 2)) {
    lines.push(`\n■ ${t.name}${t.koreanName ? ` (${t.koreanName})` : ''}`);
    if (t.description) lines.push(t.description.slice(0, 400));
  }
  if (sources.length) lines.push('\n검색 자료는 아래 출처 목록에서 원문으로 확인해 주세요.');
  if (!techniques.length && !sources.length) lines.push('\nMARTIALDEX 데이터와 검색에서 이 질문에 답할 자료를 찾지 못했습니다.');
  if (plan.ambiguous.length) lines.push(`\n'${plan.ambiguous[0].phrase}'는 여러 무술에 있습니다: ${plan.ambiguous[0].candidates.map((c) => `${c.name}(${c.martialArt})`).join(', ')}`);
  return lines.join('\n');
}

const EMBED_LABEL: Record<string, string> = {
  embeddable: '앱에서 재생 가능',
  not_embeddable: '소유자가 외부 재생을 막음 — 원본에서 시청',
  unavailable: '삭제·비공개 등으로 재생 불가',
  unknown: '재생 가능 여부 확인 못 함',
  not_supported: '앱 내 재생 미지원 플랫폼 — 원본에서 시청',
};

/** Video / paper requests: the list itself is the answer — written by code, never by the model. */
function listAnswer(kind: 'video' | 'paper', sources: ChatSource[]): string {
  if (!sources.length) return '';
  if (kind === 'video') {
    const playable = sources.filter((x) => x.video?.embed === 'embeddable').length;
    return [
      `찾은 영상 ${sources.length}개입니다 (앱에서 바로 재생 가능 ${playable}개). 제목·채널·길이는 검색 결과와 YouTube가 알려 준 정보이고, 영상 내용 자체는 확인하지 않았습니다.`,
      ...sources.map((x) => `[${x.n}] ${x.title}${x.video?.channel ? ` — ${x.video.channel}` : ''}${x.video?.duration ? ` (${x.video.duration})` : ''} · ${EMBED_LABEL[x.video?.embed ?? 'not_supported']}`),
    ].join('\n');
  }
  const lines = [`찾은 논문·연구 자료 ${sources.length}건입니다. 초록은 학술 검색 색인이 제공한 내용이며, 논문 본문은 읽지 않았습니다.`];
  for (const x of sources) {
    const p = x.paper;
    const who = p?.authors?.length ? `${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' 외' : ''}` : '저자 정보 없음(색인 미제공)';
    const where = p?.journal ?? p?.publisher ?? x.source ?? '출처 미상';
    const doi = p?.doi ? `DOI ${p.doi}${p.doiStatus === 'registered' ? ' (doi.org 등록 확인)' : p.doiStatus === 'not_found' ? ' (doi.org에 없음 — 주의)' : ' (확인 못 함)'}` : 'DOI 없음 — 원문 링크만';
    const abstract = p?.abstract ? `\n   초록 일부: ${p.abstract.replace(/\s+/g, ' ').slice(0, 220)}${p.abstract.length > 220 ? '…' : ''}` : '\n   초록: 색인에 없음';
    const level = p?.doiStatus === 'registered' && p.abstract ? '서지 정보·초록 확인' : p?.doiStatus === 'registered' ? '서지 정보 확인, 초록 없음' : '검색 결과만 확인';
    lines.push(`[${x.n}] ${x.title} (${p?.year ?? '연도 미상'})\n   ${who} · ${where}\n   ${doi}${abstract}\n   확인 수준: ${level} · 출처 신뢰도 ${x.reliability.label}`);
  }
  return lines.join('\n');
}

/** A lesson request: the plan (code, MARTIALDEX data only) and the proposal the "수업 시작" button uses. */
function lessonFor(plan: TurnPlan, text: string, art: string | null, index: KnowledgeIndex | null, sources: ChatSource[]): { lesson: LessonPlan; proposal?: LessonProposal } | null {
  if (!plan.wantsLesson) return null;
  const lesson = planLesson(text, { art, index });
  if (!lesson.items.length) return { lesson };
  return {
    lesson,
    proposal: {
      topic: text.slice(0, 80),
      martialArt: lesson.art ?? art,
      techniqueIds: lesson.items.map((i) => i.technique.id),
      sequenceIds: lesson.sequences.map((s) => s.id),
      sourceUrls: sources.map((s) => s.url),
      candidateIds: [],
    },
  };
}

/** 사양 §5-5: a lesson plan answer carries the safety notes of its techniques (code-written, labelled). */
function safetyBlock(techniques: Technique[], deps: CoachAgentDeps): string {
  if (!deps.safetyLine || !techniques.length) return '';
  const lines = [...new Set(techniques.slice(0, 3).map((t) => deps.safetyLine!(t)))];
  return `■ 안전 확인\n${lines.join('\n')}`;
}

/** One chat turn. Every branch's reply gets the same, code-decided 3D preview rule (selfAi/preview.ts). */
export async function runCoachTurn(input: TurnInput, deps: CoachAgentDeps): Promise<TurnOutput> {
  const inLesson = !!input.inLesson || !!input.lesson;
  const memory = buildConversationMemory(input.history ?? []);
  const lessonCurrent = input.lesson?.current ?? (input.lessonTechniqueId ? resolveTechnique(input.lessonTechniqueId) ?? null : null);
  const plan = planTurn(input.text, { martialArt: input.martialArt, inLesson, lessonTechnique: lessonCurrent });
  const ia = analyzeIntents(input.text, { inLesson, namesTechnique: plan.techniques.length > 0, hasConversation: memory.topics.length > 0, hasHistory: (input.history?.length ?? 0) > 0, feint: !!plan.feint });
  // 선수 질문은 router 의 선수 분석 경로가 처리한다 — 의도 목록에도 그것이 보이게 한다
  if (plan.intent === 'fighter' && plan.fighter && !ia.intents.includes('FIGHTER_TECHNIQUE_ANALYSIS') && ia.intents.every((i) => !['INJURY_OR_PAIN_QUESTION', 'EMOTIONAL_SUPPORT', 'SOCIAL_TRENDING', 'CONVERSATION_RECALL'].includes(i))) ia.intents = ['FIGHTER_TECHNIQUE_ANALYSIS', ...ia.intents.filter((i) => i !== 'GENERAL_CONVERSATION')];
  // a lesson request that names no technique, in a conversation that has a topic, is about that topic
  if (!inLesson && ia.intents.includes('LESSON_REQUEST') && !plan.techniques.length && memory.topics.length && plan.intent !== 'training_plan' && plan.intent !== 'continue_lesson') ia.composite = true;

  let out: TurnOutput;
  const answered = !inLesson ? suggestionReply(input.text, memory, plan) : null;
  // Exclusive intents (pain, emotional, social lookup, recall) answer from their own
  // source and must not reach the research pipeline — classifying them without
  // changing the execution path is exactly what §3-1 rules out.
  const exclusive = answered ? null : await runExclusiveTurn(ia.intents[0], input, deps, plan, memory);
  // 실행 경로 의도 (skillTurn.ts): 각자의 데이터·도구로 답하고, 연구·복합 경로로 넘어가지 않는다
  let skill: TurnOutput | null = null;
  if (!answered && !exclusive) {
    let idx: KnowledgeIndex | null = null;
    try {
      idx = await deps.knowledgeIndex();
    } catch {
      idx = null;
    }
    skill = await runSkillTurn(ia.intents[0], { text: input.text, history: input.history ?? [], requestId: input.requestId, onStatus: input.onStatus, inLesson }, { research: deps.research, chat: deps.chat, learner: deps.learner, bodyProfile: deps.bodyProfile, artName: deps.artName, toSources, activeLessonTechniqueIds: deps.activeLessonTechniqueIds, activeLesson: deps.activeLesson }, plan, memory, idx);
  }
  if (answered) out = answered;
  else if (exclusive) out = exclusive;
  else if (skill) out = skill;
  else if (ia.composite) out = await runComposite(input, deps, plan, ia, memory, inLesson);
  else out = await runCoachTurnInner(input, deps, memory);
  if (!out.message.preview) {
    const lessonId = input.lesson?.current?.id ?? (input.inLesson ? input.lessonTechniqueId : undefined);
    const preview = previewFor(out.plan, input.text, lessonId);
    if (preview) out.message.preview = preview;
  }
  out.message.turn = { ...turnMetaOf(input.text, out, ia), ...(out.message.turn ?? {}) } as TurnMeta;
  // 격투기 용어를 어떻게 이해했는지 (combatTerms.ts) — 답을 만든 경로가 따로 밝히지 않았으면 앞에 붙인다
  if (plan.readingNotes?.length && !out.message.text.startsWith('📝')) out.message.text = `📝 이해한 내용: ${plan.readingNotes.join(' ')}\n\n${out.message.text}`;
  if (!inLesson && !answered && !exclusive && !skill) maybeSuggestLesson(input.text, out, memory, ia, deps);
  return out;
}

const aspectsIn = (text: string): Aspect[] => {
  const a: Aspect[] = [];
  if (/(셋업|진입|연계|콤보|콤비네이션)/.test(text)) a.push('setup');
  if (/(mma|ufc|종합\s*격투기|실전|실제 경기)/i.test(text)) a.push('mma');
  if (/(영상|유튜브|강의|youtube)/i.test(text)) a.push('video');
  if (/(조사|찾아|검색|자료)/.test(text)) a.push('web');
  if (/(내|나의)\s*(파이팅\s*)?스타일|나(한테|에게) 맞/.test(text)) a.push('fit');
  return a;
};

function turnMetaOf(text: string, out: TurnOutput, ia: IntentAnalysis): TurnMeta {
  const ids = [...new Set((out.message.techniqueIds ?? []).map((id) => canonicalTechniqueId(id)))];
  const t = ids[0] ? resolveTechnique(ids[0]) : null;
  const fighter = out.plan.intent === 'fighter' && out.plan.fighter ? out.plan.fighter : null;
  const key = t ? `tech:${ids[0]}` : fighter ? `fighter:${fighter}` : null;
  return { intents: ia.intents, topicKey: key, topicLabel: t ? (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name) : fighter, topicTechniqueIds: ids.slice(0, 4), art: out.plan.art ?? t?.martialArt ?? null, aspects: aspectsIn(text) };
}

/** The learner's answer to the coach's own lesson offer: "응, 시작하자" → the button again; "아니 괜찮아" → back to talking. */
function suggestionReply(text: string, memory: ConversationMemory, plan: TurnPlan): TurnOutput | null {
  const p = memory.pendingSuggestion;
  const t = text.trim();
  if (!p || t.length > 30) return null;
  const base = { role: 'assistant' as const, research: { kind: 'web' as const, queries: [], reason: '수업 제안에 대한 답', searched: false, status: 'skipped' as const }, tools: ['lesson_plan'], model: 'martialdex-route' };
  const last = memory.latest;
  const turnBase = { intents: ['LESSON_REQUEST'], topicKey: last?.key ?? null, topicLabel: last?.label ?? null, topicTechniqueIds: last?.techniqueIds, art: last?.art ?? null, aspects: [] };
  if (DECLINE.test(t)) {
    return { plan, results: [], message: { ...base, text: '알겠습니다. 수업 없이 지금처럼 대화를 이어갈게요. 더 궁금한 점을 편하게 물어보세요.', turn: { ...turnBase, suggestion: 'declined' } } };
  }
  if (ACCEPT.test(t)) {
    return { plan, results: [], message: { ...base, text: `좋습니다. 아래 "이 주제로 수업 시작"을 누르면 「${p.proposal.topic}」 수업을 기존 수업 화면에서 시작합니다.${p.proposal.summary?.length ? `\n\n수업에 반영할 내용:\n${p.proposal.summary.map((x) => `- ${x}`).join('\n')}` : ''}`, lessonProposal: { ...p.proposal, suggested: false }, techniqueIds: p.proposal.techniqueIds, turn: { ...turnBase, suggestion: 'accepted' } } };
  }
  return null;
}

/**
 * 사양 §7-3: the coach offers a lesson on its own when a topic has been dug into — asked about several times,
 * or looked at from several sides (셋업 · MMA · 영상 · 내 스타일) — never on a one-off fact, never twice for a
 * topic the learner declined, never when this answer already carries a lesson button or a screen hand-off.
 */
function maybeSuggestLesson(text: string, out: TurnOutput, memory: ConversationMemory, ia: IntentAnalysis, deps: CoachAgentDeps): void {
  const m = out.message;
  if (m.lessonProposal || m.action || m.lessonAdd || m.dataOnly) return;
  if (['smalltalk', 'motivation', 'my_progress', 'pose_check', 'continue_lesson', 'training_plan', 'curriculum', 'lesson', 'practice'].includes(out.plan.intent) && !ia.composite) return;
  const key = m.turn?.topicKey;
  if (!key?.startsWith('tech:')) return;
  const prev = memory.topics.find((t) => t.key === key);
  if (prev?.declined || prev?.started) return;
  // offered for this topic in the last few answers already → don't repeat
  if (prev?.offered && memory.latest?.key === key) return;
  const turns = (prev?.turns ?? 0) + 1;
  // 'web' ("찾아줘") is how the user asked, not a side of the topic
  const aspects = new Set([...(prev?.aspects ?? []), ...(m.turn?.aspects ?? [])].filter((a) => a !== 'explain' && a !== 'lesson' && a !== 'web'));
  const researchDone = (m.tasks ?? []).filter((x) => x.status === 'done').length;
  if (!(turns >= 3 || aspects.size >= 3 || (turns >= 2 && aspects.size >= 2) || researchDone >= 3)) return;
  if (text.trim().length < 6) return;
  const ids = m.turn?.topicTechniqueIds?.length ? m.turn.topicTechniqueIds : prev?.techniqueIds ?? [];
  const techniques = ids.map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t);
  if (!techniques.length) return;
  const thread: TopicThread = prev ? { ...prev, turns, aspects: [...aspects] as Aspect[], questions: [...prev.questions, text.slice(0, 80)] } : { key, label: m.turn?.topicLabel ?? techniques[0].name, art: m.turn?.art ?? null, techniqueIds: ids, turns, firstIndex: 0, lastIndex: 0, aspects: [...aspects] as Aspect[], questions: [text.slice(0, 80)], sourceUrls: [], videoUrls: [], declined: false, offered: false, started: false };
  const sourceUrls = [...new Set([...(m.sources ?? []).map((s) => s.url), ...thread.sourceUrls])];
  const videoUrls = [...new Set([...(m.videos ?? []).map((s) => s.url), ...thread.videoUrls])];
  const { proposal } = proposalFromTopic({ topicLabel: thread.label, techniques, art: thread.art, index: null, sourceUrls, videoUrls, summary: topicSummary({ ...thread, sourceUrls, videoUrls }) });
  if (!proposal) return;
  const seen = [...aspects].map((a) => ({ setup: '셋업', mma: 'MMA에서의 활용', video: '강의 영상', web: '외부 자료', fit: '내 스타일과의 적합성', compare: '비교', fighter: '선수 분석' } as Record<string, string>)[a]).filter(Boolean);
  m.lessonProposal = { ...proposal, suggested: true };
  m.text += `\n\n💡 지금까지 ${thread.label}${seen.length ? `의 ${seen.join(', ')}까지` : '에 대해 여러 번'} 살펴봤으니 이 내용을 하나의 수업으로 구성해 볼 수 있어요. 관련 기술${videoUrls.length ? '과 영상' : ''}도 함께 넣을게요. 원하면 아래 버튼을 누르거나 "좋아"라고 답해 주세요. 수업 없이 계속 이야기해도 괜찮습니다.`;
  m.turn = { ...(m.turn as TurnMeta), suggestion: 'offered' };
  void deps;
}

async function runComposite(input: TurnInput, deps: CoachAgentDeps, plan: TurnPlan, ia: IntentAnalysis, memory: ConversationMemory, inLesson: boolean): Promise<TurnOutput> {
  let index: KnowledgeIndex | null = null;
  try {
    index = await deps.knowledgeIndex();
  } catch {
    index = null;
  }
  const r = await compositeTurn(
    { text: input.text, plan, analysis: ia, memory, index, inLesson, requestId: input.requestId, onStatus: input.onStatus, onDelta: input.onDelta },
    { research: deps.research, chat: deps.chat, artName: deps.artName, styleProfile: deps.styleProfile, styleRecords: deps.styleRecords, lessonFit: deps.lessonFit, toSources, ...(deps.resolveName ? { isPerson: async (n: string) => (await deps.resolveName!(n)).ok } : {}) }
  );
  const msg = r.message;
  if (r.topic) msg.turn = { intents: ia.intents, topicKey: r.topic.key, topicLabel: r.topic.label, topicTechniqueIds: r.topic.techniqueIds, art: r.topic.art, aspects: aspectsIn(input.text) };
  return { plan: { ...plan, techniques: r.topic?.techniqueIds.map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t) ?? plan.techniques }, results: r.results, message: msg };
}

async function runCoachTurnInner(input: TurnInput, deps: CoachAgentDeps, memory?: ConversationMemory): Promise<TurnOutput> {
  const lessonCurrent = input.lesson?.current ?? (input.lessonTechniqueId ? resolveTechnique(input.lessonTechniqueId) ?? null : null);
  const plan = planTurn(input.text, { martialArt: input.martialArt, inLesson: input.inLesson || !!input.lesson, lessonTechnique: lessonCurrent });
  const art = plan.art ?? plan.techniques[0]?.martialArt ?? null;

  let index: KnowledgeIndex | null = null;
  try {
    index = await deps.knowledgeIndex();
  } catch {
    index = null;
  }

  // In a lesson the question is about the technique being taught: search for THAT technique.
  // the opponent's reaction / material to look up → records + a search aimed at the technique; any other
  // lesson question ("이 기술 원리가 뭐야?") is a technique question about it (data engine below)
  const lessonTech = plan.intent === 'lesson_question' && (plan.research.needed || /(방어|막으면|막히면|대응|카운터|반격|피하면|버티면)/.test(input.text)) ? lessonCurrent : null;
  if (lessonTech && plan.research.needed) plan.research.queries = lessonQuestionQueries(lessonTech, input.text);

  // Personal / training / continue — code from the learner's own records (read only), no model, no search.
  const artLabel = (a: string) => (deps.artName ? deps.artName(a) : a);
  const skipped: TurnResearchInfo = { kind: 'web', queries: [], reason: 'MARTIALDEX 기록·내 학습 기록', searched: false, status: 'skipped' };
  // A stored value (프로필 · 목표 · 루틴 · 훈련 기록 · 자세 측정) — read by code, never paraphrased by a model. Same in a lesson.
  const eco = deps.ecosystem?.(input.text) ?? null;
  if (eco) {
    return { plan, results: [], message: { role: 'assistant', text: eco.text + (input.lesson || input.inLesson ? '\n\n질문에 답했습니다. 수업은 하던 단계에서 그대로 이어집니다.' : ''), research: { ...skipped, reason: `MARTIALDEX 저장 데이터: ${eco.stores.join(' · ')}` }, tools: ['db'], model: 'martialdex-data', techniqueIds: eco.techniqueIds, personalData: { stores: eco.stores, loadFailed: false }, ...(eco.action && !input.lesson ? { action: eco.action } : {}) } };
  }
  const fact = deps.personalFact?.(input.text) ?? null;
  if (fact) {
    return { plan, results: [], message: { role: 'assistant', text: fact.text + (input.lesson || input.inLesson ? '\n\n질문에 답했습니다. 수업은 하던 단계에서 그대로 이어집니다.' : ''), research: { ...skipped, reason: `MARTIALDEX 저장 데이터: ${fact.stores.join(' · ')}` }, tools: ['db'], model: 'martialdex-data', personalData: { stores: fact.stores, loadFailed: fact.loadFailed } } };
  }
  // 10차: an analysis of the learner's own data (콤보 · 전술 · 스파링 · 지난 대화 · 식사 …) — facts and the app's labelled
  // judgement written by code; for 장단점 / 개선 방향 / 스타일 a model adds a labelled interpretation of THOSE facts only.
  const analysis = plan.personal ? null : ((await deps.personalAnalysis?.(input.text, art).catch(() => null)) ?? null);
  if (analysis) {
    const parts = [analysis.text];
    const notes: string[] = [];
    let model = 'martialdex-data';
    let claims: ClaimCheck[] | undefined;
    if (analysis.narrativeFacts) {
      input.onStatus?.('기록을 바탕으로 해석 중…');
      const sys = [
        '너는 MARTIALDEX AI 코치다. 한국어 존댓말로 2~4문장만 쓴다.',
        '아래 [기록과 앱의 판단]만 근거로 이 사용자에게 맞는 해석과 다음 연습 방향을 말한다.',
        '기록에 없는 경기 결과, 승패, 성공률, 수치, 기술을 만들지 않는다. 기록을 바꿔 말하지 않는다.',
        '해석과 조언 문장은 "제 판단으로는"으로 시작한다. 사용자의 기록을 수정하거나 완료로 처리했다고 말하지 않는다.',
        `\n[기록과 앱의 판단]\n${analysis.narrativeFacts.slice(0, 2200)}`,
      ].join('\n');
      const res = await deps.chat({ requestId: input.requestId, messages: [{ role: 'system', content: sys }, { role: 'user', content: input.text }], maxTokens: 260, temperature: 0.2 }, input.onDelta);
      if (res.ok) {
        const g = guardAnswer(res.text, { sourceCount: 0, sourceUrls: [], searched: false });
        claims = checkClaims(g.text, [{ n: 1, text: analysis.narrativeFacts }]);
        const kept = dropContradicted(g.text, claims);
        for (const c of kept.removed) notes.push(`기록과 다른 내용이라 지운 문장: "${c.sentence.slice(0, 80)}" — ${c.problems.map((p) => PROBLEM_LABEL[p]).join(', ')}`);
        if (g.removedPromises.length) notes.push(`실제로 하지 않는 동작을 약속한 문장 ${g.removedPromises.length}개를 지웠습니다.`);
        const clean = deps.terminology ? deps.terminology(kept.text, analysis.narrativeFacts) : { text: kept.text, notes: [] };
        notes.push(...clean.notes);
        if (clean.text.trim()) parts.push(`■ 코치 해석 (로컬 AI가 위 기록만 보고 쓴 의견 — 기록이 아님)\n${clean.text.trim()}`);
        model = res.model;
      } else {
        notes.push(`로컬 AI를 사용할 수 없어 해석은 붙이지 않았습니다 (${res.message}). 위 기록과 앱의 판단은 그대로입니다.`);
      }
    }
    return { plan, results: [], message: { role: 'assistant', text: parts.join('\n\n') + (input.lesson || input.inLesson ? '\n\n질문에 답했습니다. 수업은 하던 단계에서 그대로 이어집니다.' : ''), research: { ...skipped, reason: `MARTIALDEX 저장 데이터: ${analysis.stores.join(' · ')}` }, tools: ['db'], model, personalData: { stores: analysis.stores, loadFailed: analysis.loadFailed }, ...(notes.length ? { guardNotes: notes } : {}), ...(claims?.length ? { claims } : {}) } };
  }
  // several of the learner's own data domains asked together: the coach answers from the whole user context (no search,
  // not the generic combo-research route)
  if (!analysis && deps.personalComposite?.(input.text)) {
    plan.intent = 'general';
    plan.research = { ...plan.research, needed: false, queries: [], reason: '내 데이터 종합 질문' };
    plan.wantsLesson = false;
  }
  if (plan.intent === 'my_progress' && plan.personal) {
    const learner = deps.learner?.() ?? [];
    // no art in the question: the art the learner studied most recently (said in the answer)
    const needsArt = !['weakest', 'review', 'improved', 'learned'].includes(plan.personal);
    const pArt = art ?? (needsArt ? recentArt(learner) : null);
    const a = personalAnswer(plan.personal, pArt, pArt ? artLabel(pArt) : '', learner, index);
    if (!art && pArt) a.text = `(질문에 무술이 없어 최근 학습한 ${artLabel(pArt)} 기준으로 답합니다)\n${a.text}`;
    const proposal: LessonProposal | undefined = a.lessonTechniqueIds.length ? { topic: input.text.slice(0, 80), martialArt: pArt, techniqueIds: a.lessonTechniqueIds, sequenceIds: [], sourceUrls: [], candidateIds: [] } : undefined;
    return { plan, results: [], message: { role: 'assistant', text: a.text + (proposal ? '\n\n아래 "이 주제로 수업 시작"으로 이 기술들로 수업을 만들 수 있습니다.' : ''), research: skipped, techniqueIds: a.lessonTechniqueIds, tools: plan.tools, model: 'martialdex-data', lessonProposal: proposal } };
  }
  if (plan.intent === 'training_plan' && plan.trainingType) {
    const tp = planTraining(plan.trainingType, art, deps.learner?.() ?? []);
    const ids = tp.ok ? trainingTechniqueIds(tp) : [];
    const proposal: LessonProposal | undefined = ids.length ? { topic: input.text.slice(0, 80), martialArt: art, techniqueIds: ids, sequenceIds: [], sourceUrls: [], candidateIds: [] } : undefined;
    return { plan, results: [], message: { role: 'assistant', text: trainingPlanText(tp, artLabel), research: skipped, techniqueIds: ids, tools: plan.tools, model: 'martialdex-plan', lessonProposal: proposal, ...(tp.drillRoute ? { action: { label: '솔로 드릴 화면 열기', to: tp.drillRoute } } : {}) } };
  }
  if (plan.intent === 'improve') {
    const t = plan.techniques[0] ?? lessonCurrent;
    if (t) return { plan, results: [], message: { role: 'assistant', text: improveAnswer(t, deps.learner?.() ?? [], deps.lessonLogs?.() ?? [], index) + (input.lesson ? '\n\n질문에 답했습니다. 수업은 하던 단계에서 그대로 이어집니다.' : ''), research: skipped, techniqueIds: [t.id], tools: plan.tools, model: 'martialdex-data' } };
  }
  if (plan.intent === 'pose_check') return poseCheckTurn(plan, input, deps, lessonCurrent, skipped);
  if (plan.intent === 'continue_lesson') {
    const live = deps.activeLesson?.() ?? null;
    return { plan, results: [], message: { role: 'assistant', text: live ? `진행 중인 수업 「${live.title}」이 있습니다${live.current ? ` — ${live.current} · ${live.stepLabel} 단계` : ''}. 아래 버튼으로 하던 단계에서 이어서 합니다.` : '이 기기에 진행 중인 수업이 없습니다. "… 배우고 싶어" 또는 "… 훈련하고 싶어"로 새 수업을 만들 수 있습니다.', research: skipped, tools: plan.tools, model: 'martialdex-route', ...(live ? { action: { label: '수업 이어하기', to: live.route } } : {}) } };
  }

  // In a lesson: "… 도 배우고 싶어 / 추가해 줘" → a proposal for THIS lesson (records only, added after consent).
  if (plan.intent === 'lesson_add' && input.lesson) {
    const L = input.lesson;
    let proposal = null as ReturnType<typeof proposeLessonAddition>;
    let report: EvidenceStyleReport | null = null;
    if (plan.fighter && deps.fighterStyle) {
      input.onStatus?.('선수 분석 자료 확인 중…');
      const name = deps.resolveName ? await deps.resolveName(plan.fighter) : null;
      report = await deps.fighterStyle(name?.ok ? name.en : plan.fighter, L.art ?? 'mixed-martial-arts', { onStatus: input.onStatus, fighterEn: name?.ok ? name.en : null, arts: artsForTopic(input.text, L.art) });
      proposal = fighterComboProposal(L.techniqueIds, L.art ?? L.current.martialArt, report.items);
    } else {
      proposal = proposeLessonAddition(input.text, L.techniqueIds, L.current, index);
    }
    const web = report?.webResults ?? [];
    const sources = toSources(web);
    const text = proposal
      ? proposalText(proposal)
      : plan.fighter
        ? `${plan.fighter} 분석 자료에서 이 수업의 무술로 연결되는 콤비네이션·셋업 기록을 찾지 못했습니다${report?.searched ? '' : ' (검색하지 못함)'}. 수업은 바뀌지 않았습니다.`
        : /선수|파이터/.test(input.text)
          ? '어느 선수의 콤보인지 이름을 함께 말씀해 주세요. 예: "코너 맥그리거의 대표 콤보를 수업에 추가해 줘". 수업은 바뀌지 않았습니다.'
          : `MARTIALDEX 기록에서 ${L.current.name}과(와) 연결되어 수업에 더할 수 있는 기술을 찾지 못했습니다(이미 수업에 있는 기술은 제외). 수업은 바뀌지 않았습니다.`;
    const info: TurnResearchInfo = report ? { kind: 'web', queries: styleQueries(plan.fighter ?? '', L.art ?? 'mixed-martial-arts'), reason: '선수 콤보 → 수업 추가 제안', searched: report.searched, status: report.searched ? (web.length ? 'ok' : 'empty') : 'failed', pagesRead: report.pagesRead } : { kind: 'web', queries: [], reason: 'MARTIALDEX 기록', searched: false, status: 'skipped' };
    return { plan, results: web, message: { role: 'assistant', text, sources: sources.length ? sources : undefined, research: info, techniqueIds: proposal?.techniqueIds ?? [], tools: plan.tools, model: 'martialdex-data', lessonAdd: proposal ?? undefined } };
  }

  // Fighter style: the evidence pipeline searches analysis pages + videos itself.
  if (plan.intent === 'fighter' && plan.fighter && deps.fighterStyle) {
    input.onStatus?.('선수 이름 확인 중…');
    const name = deps.resolveName ? await deps.resolveName(plan.fighter) : null;
    const en = name?.ok ? name.en : null;
    // several people match the name: ask, never pick one or search under the ambiguous name
    if (name && !name.ok && name.candidates?.length) {
      return { plan, results: [], message: { role: 'assistant', text: `"${plan.fighter}"(으)로 찾은 선수가 여럿입니다: ${name.candidates.join(', ')}.\n어느 선수인지 전체 이름으로 다시 물어봐 주세요. 이름이 확실하지 않아 검색·분석은 하지 않았습니다.`, research: { kind: 'web', queries: [], reason: '선수 이름 확인', searched: false, status: 'skipped' }, tools: plan.tools, model: 'martialdex-route' } };
    }
    const report = await deps.fighterStyle(en ?? plan.fighter, plan.art ?? 'mixed-martial-arts', { onStatus: input.onStatus, fighterEn: en, arts: artsForTopic(input.text, plan.art), question: input.text });
    const web = report.webResults ?? [];
    const info: TurnResearchInfo = { kind: 'web', queries: report.searchLog?.rounds.flatMap((r) => r.queries) ?? styleQueries(en ?? plan.fighter, plan.art ?? 'mixed-martial-arts'), reason: plan.research.reason, searched: report.searched, status: report.searched ? (web.length ? 'ok' : 'empty') : 'failed', pagesRead: report.pagesRead };
    // 분석이 문장을 인용한 자료만 "사용" — 선수 이름만 나온 소개 글은 검색에 걸렸을 뿐 근거가 아니다 (사양 §5)
    const sources = markUsed(toSources(web), new Set(report.sources.filter((x) => x.used).map((x) => x.url)), new Map(report.sources.map((x) => [x.url, x.why])));
    const notice = researchNotice(info, sources.length);
    // "…콤보를 찾아서 수업으로 만들어줘": the lesson is built from what the analysis FOUND (its MARTIALDEX techniques,
    // the sources it quoted, the videos) — never from techniques the analysis did not find
    const wantsLessonToo = /(수업|레슨)(으로|을|를)?\s*(만들|구성|짜|하자|해\s*줘|시작)/.test(input.text);
    const foundIds = [...new Set(report.items.flatMap((i) => i.techniqueIds))].filter((id) => {
      const t = resolveTechnique(id);
      return !!t && lessonReadiness(t).level !== 'insufficient';
    });
    const fighterLesson: LessonProposal | undefined = wantsLessonToo && foundIds.length
      ? { topic: `${plan.fighter} 콤보·셋업`.slice(0, 80), martialArt: plan.art ?? resolveTechnique(foundIds[0])?.martialArt ?? null, techniqueIds: foundIds.slice(0, 6), sequenceIds: [], sourceUrls: sources.filter((s) => s.used).map((s) => s.url), candidateIds: [], videoUrls: (report.videoResults ?? []).map((v) => v.url).slice(0, 6), summary: [`${plan.fighter} 분석 자료에서 찾은 기술 ${foundIds.length}개`, `근거로 쓴 자료 ${sources.filter((s) => s.used).length}건`] }
      : undefined;
    const lessonNote = wantsLessonToo ? (fighterLesson ? `\n\n■ 수업 구성\n위 분석에서 확인된 MARTIALDEX 기술(${foundIds.slice(0, 6).map((id) => resolveTechnique(id)?.name ?? id).join(', ')})로 수업을 구성했습니다. 아래 "이 주제로 수업 시작"을 누르면 시작합니다. 분석에서 확인되지 않은 기술은 넣지 않았습니다.` : '\n\n■ 수업 구성\n분석 자료에서 MARTIALDEX 기술로 확인된 콤보가 없어 수업을 만들지 않았습니다. 확인되지 않은 콤보로 수업을 만들지 않습니다.') : '';
    return {
      plan,
      results: web,
      message: {
        role: 'assistant',
        ...(fighterLesson ? { lessonProposal: fighterLesson } : {}),
        text: [notice, fighterReportText(input.text, report, name) + lessonNote].filter(Boolean).join('\n\n'),
        sources: sources.length ? sources : undefined,
        videos: report.videoResults?.length ? toSources(report.videoResults) : undefined,
        research: info,
        techniqueIds: [...new Set(report.items.flatMap((i) => i.techniqueIds))],
        tools: plan.tools,
        model: 'martialdex-evidence',
      },
    };
  }

  let outcome: ResearchOutcome | null = null;
  if (plan.research.needed) {
    input.onStatus?.(plan.research.kind === 'video' ? '영상 검색 중…' : plan.research.kind === 'paper' ? '논문·연구 자료 검색 중…' : '웹 검색 중…');
    outcome = await deps.research({ query: plan.research.queries[0], queries: plan.research.queries.slice(1), kind: plan.research.kind, maxResults: 8, ...(plan.recent ? { recent: true } : {}) });
  }
  const results = outcome && outcome.ok ? outcome.results : [];
  const info = researchInfo(plan, outcome);
  const sources = toSources(results);
  const notice = researchNotice(info, sources.length);

  const dataParts: string[] = [];
  if (art) dataParts.push(`[질문한 무술] ${deps.artName ? deps.artName(art) : art} — 다른 무술 이름으로 바꿔 부르지 않는다.`);
  const tBlock = techniqueBlock(plan.techniques, index, art);
  if (tBlock) dataParts.push(tBlock);
  // 사양 §5-5: the technique's safety guidance (and whether its prerequisites are learned) is part of the material
  if (deps.safetyLine) for (const t of plan.techniques.slice(0, 2)) dataParts.push(deps.safetyLine(t));
  const lesson = input.lesson ? lessonContextBlock(input.lesson) : deps.lessonContext?.();
  if (lesson) dataParts.push(`[진행 중인 수업]\n${lesson}`);
  // Who this learner is (프로필 · 개인 목표 · 학습 기록 · 최근 수업) — the same block the lessons get. Left out
  // only where it cannot help the answer (small talk, a video/paper/fighter lookup, a screen hand-off), so a
  // question like "내 리치가 얼마였지?" or "나한테 맞는 타격 스타일" is answered from the user's own data.
  const learner = NO_USER_CONTEXT.has(plan.intent) ? '' : deps.learnerContext(art, input.text).slice(0, 3200);

  // sentences about the question only (prompt reading dominates the wait on CPU)
  const queryTerms = [...plan.techniques.flatMap((t) => [t.name, t.koreanName ?? '']), ...plan.research.queries.slice(1).join(' ').split(/\s+/)].filter((w) => w.length >= 2);
  const focused = focusSources(results, queryTerms, { max: 4, perSource: 600 });
  const promptSources = focused.length ? focusedBlock(focused) : sourcesBlock(results, 3, 400);
  // exactly the source text the model sees — the answer's sentences are checked against this (evidenceCheck.ts)
  const evidence: EvidenceSource[] = focused.length ? focused.map((f) => ({ n: f.n, text: f.excerpt })) : results.slice(0, 3).map((r, i) => ({ n: i + 1, text: (r.content ?? r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 400) }));
  // 모델이 실제로 읽은 자료만 "사용"으로 — 나머지는 검색에 걸렸을 뿐이다
  markUsed(sources, new Set((focused.length ? focused.map((f) => f.result) : results.slice(0, 3)).map((r) => r.url)));
  const system = [
    SYSTEM_RULES,
    `\n[MARTIALDEX 데이터]\n${dataParts.join('\n\n') || '(이 질문과 직접 연결된 기술 기록 없음)'}`,
    memory ? `\n${memoryBlock(memory)}` : '',
    deps.pastTopics && plan.intent !== 'smalltalk' ? `\n${deps.pastTopics()}` : '',
    learner ? `\n[이 사용자에 대해 저장된 데이터 — 아래 내용만 사실로 쓰고, 없는 항목은 지어내지 않는다]\n${learner}` : '',
    `\n[검색 자료]\n${sources.length ? promptSources : `(없음 — ${notice ?? '이번 질문은 검색하지 않았습니다.'})`}`,
    glossaryBlock([...plan.techniques, ...(lessonCurrent ? [lessonCurrent] : [])]) ? `\n${glossaryBlock([...plan.techniques, ...(lessonCurrent ? [lessonCurrent] : [])])}` : '',
  ].join('\n');

  let lessonPlan = lessonFor(plan, input.text, art, index, sources);
  // "이번 주 목표에 맞는 수업" names no technique: the techniques the stored goal names make the lesson (same planner)
  let goalNote = '';
  if (lessonPlan && !lessonPlan.lesson.items.length && /목표/.test(input.text) && deps.goalText) {
    const g = deps.goalText(input.text);
    if (g) {
      const byGoal = lessonFor(plan, g.text, art, index, sources);
      if (byGoal?.lesson.items.length) {
        lessonPlan = byGoal;
        goalNote = `저장된 ${g.label}("${g.text.slice(0, 60)}")에 있는 기술로 수업을 만들었습니다.`;
      } else goalNote = `저장된 ${g.label}("${g.text.slice(0, 60)}")에서 MARTIALDEX 기술 이름을 찾지 못해 목표에 맞춘 수업을 만들지 못했습니다. 목표에 기술 이름(예: 잽, 싱글 레그)을 적으면 그 기술로 만듭니다.`;
    } else goalNote = '저장된 목표가 없어 목표에 맞춘 수업을 만들지 못했습니다.';
  }
  const proposal = lessonPlan?.proposal;
  const base = { role: 'assistant' as const, sources: sources.length ? sources : undefined, research: info, techniqueIds: plan.techniques.map((t) => t.id), lessonProposal: proposal, tools: plan.tools };

  // A curriculum is built by the existing AI 맞춤 커리큘럼 (goal analysis + evidence checks) — handed the request.
  if (plan.intent === 'curriculum') {
    const text = `여러 날에 걸친 커리큘럼은 "AI 맞춤 커리큘럼"에서 만듭니다. 목표 분석과 근거 검증을 거쳐 Day별 기술·셋업·콤보 연습을 구성합니다. 아래 버튼을 누르면 이 요청이 입력된 상태로 열립니다.${plan.techniques.length ? `\n질문에서 찾은 MARTIALDEX 기술: ${plan.techniques.map((t) => t.name).join(', ')}` : ''}`;
    return { plan, results, message: { ...base, text, model: 'martialdex-route', action: { label: 'AI 맞춤 커리큘럼 만들기', to: '/ai-curriculum', state: { freeText: input.text, ...(plan.art ? { martialArt: plan.art } : {}) } } } };
  }

  // 기술 연습 의도 — the learner wants to TRAIN this technique, not have it described. Offer the lesson (the
  // "이 주제로 수업 시작" button rides on base.lessonProposal) instead of a dry explanation. Thin records limit
  // what the lesson can COVER; they are never a reason to answer a practice wish with "자료를 찾지 못했습니다",
  // so the offer and what IS on record are said first either way.
  if (plan.intent === 'practice' && lessonPlan) {
    const names = plan.techniques.map((t) => t.koreanName || t.name).join(', ');
    const ready = lessonPlan.lesson.items.length > 0;
    const offer = ready
      ? `${names} 연습이군요. 아래 구성으로 단계별 수업을 만들 수 있습니다 — "이 주제로 수업 시작"을 누르면 지금 기록과 숙련도에 맞춰 시작합니다.`
      : `${names} 연습이군요. 다만 MARTIALDEX에 있는 이 기술의 기록만으로는 수업 단계를 구성하기에 자료가 모자랍니다. 아래에 무엇이 비어 있는지 적어 두었습니다.`;
    return { plan, results, message: { ...base, text: [notice, goalNote, offer, lessonPlanText(lessonPlan.lesson, deps.artName), safetyBlock(lessonPlan.lesson.items.map((i) => i.technique), deps)].filter(Boolean).join('\n\n'), model: 'martialdex-plan' } };
  }

  // Lesson questions the records answer directly (code-written).
  const subject = plan.techniques[0] ?? lessonCurrent;
  const subjectArt = art ?? subject?.martialArt ?? null;
  if (plan.intent === 'review' && input.lesson) return { plan, results, message: { ...base, text: reviewAnswer(input.lesson, input.lesson.understanding), model: 'martialdex-data' } };
  if (plan.intent === 'prerequisite' && subject && subjectArt) return { plan, results, message: { ...base, text: prerequisiteAnswer(subject, subjectArt), model: 'martialdex-data' } };
  if (plan.intent === 'related' && subject && subjectArt) return { plan, results, message: { ...base, text: relatedAnswer(subject, subjectArt, index), model: 'martialdex-data' } };
  if (plan.intent === 'compare' && input.lesson && plan.techniques.length < 2) return { plan, results, message: { ...base, text: compareTargetAnswer(input.lesson.current, input.lesson.art ?? input.lesson.current.martialArt), model: 'martialdex-data' } };

  if (lessonTech) {
    const facts = lessonTechniqueFacts(lessonTech, index, input.text);
    const parts: string[] = [notice ?? '', `■ MARTIALDEX 기록\n${facts.lines.join('\n')}`];
    const guardNotes: string[] = [];
    let model = 'martialdex-data';
    // only the page sentences about this technique / the opponent's reaction go to the model
    const terms = [...lessonTech.name.split(/[\s-]+/), lessonTech.name, ...lessonTech.aliases, 'defend', 'defense', 'sprawl', 'counter', 'block', 'whizzer', 'finish', 're-attack', 'reshot', 'opponent', '방어', '대응', '막'];
    const focused = focusSources(results, terms, { max: 4, perSource: 500, contentOnly: true });
    const readPages = results.filter((r) => r.content).length;
    let lessonClaimsOut: ClaimCheck[] | undefined;
    if (sources.length && !readPages) {
      parts.push('■ 검색 자료\n찾은 자료가 영상이거나 사이트가 자동 수집을 허용하지 않아(robots.txt) 본문을 읽은 자료가 없습니다. 요약하지 않았습니다 — 아래 출처 원문을 직접 확인해 주세요.');
    } else if (sources.length && !focused.length) {
      parts.push(`■ 검색 자료\n본문을 읽은 자료 ${readPages}곳에서 이 기술과 상대의 대응을 다룬 문장을 찾지 못해 요약하지 않았습니다. 아래 출처 원문을 참고해 주세요.`);
    } else if (focused.length) {
      input.onStatus?.('검색 자료 요약 중…');
      const res = await deps.chat(
        { requestId: input.requestId, messages: [{ role: 'system', content: lessonQuestionPrompt(facts, input.text, focusedBlock(focused)) }, { role: 'user', content: input.text }], maxTokens: 320, temperature: 0.2 },
        input.onDelta
      );
      if (res.ok) {
        const g = guardAnswer(res.text, { sourceCount: sources.length, sourceUrls: sources.map((x) => x.url), searched: true });
        const lessonClaims = checkClaims(g.text, focused.map((f) => ({ n: f.n, text: f.excerpt })), facts.lines.join('\n'));
        const kept = dropContradicted(g.text, lessonClaims);
        g.text = kept.text;
        for (const c of kept.removed) guardNotes.push(`출처 [${c.source}]와 다른 내용이라 지운 문장: "${c.sentence.slice(0, 90)}" — ${c.problems.map((p) => PROBLEM_LABEL[p]).join(', ')}`);
        if (g.removedPromises.length) guardNotes.push(`실제로 하지 않는 동작을 약속한 문장 ${g.removedPromises.length}개를 지웠습니다.`);
        lessonClaimsOut = lessonClaims;
        parts.push(`■ 검색 자료 요약 (로컬 AI가 아래 출처를 요약했습니다 — 원문으로 확인해 주세요)\n${dedupeSentences([g.text]).join(' ')}`);
        if (!g.cited.length) guardNotes.push('요약에 출처 번호가 없습니다. 아래 출처와 직접 대조해 주세요.');
        if (g.removedCitations.length) guardNotes.push(`없는 출처 번호 ${g.removedCitations.join(', ')}를 지웠습니다.`);
        if (g.foreignScript) guardNotes.push('요약에 한자·일본어 문자가 섞였습니다 (로컬 모델 출력 오류).');
        model = res.model;
      } else {
        parts.push(`■ 검색 자료\n로컬 AI를 사용할 수 없어 요약하지 못했습니다(${res.message}). 아래 출처 원문을 확인해 주세요.`);
      }
    }
    parts.push('질문에 답했습니다. 수업은 하던 단계에서 그대로 이어집니다.');
    return { plan, results, message: { ...base, text: parts.filter(Boolean).join('\n\n'), model, guardNotes: guardNotes.length ? guardNotes : undefined, ...(lessonClaimsOut?.length ? { claims: lessonClaimsOut } : {}) } };
  }
  // Setup / combo research: records + the pages' own combination sentences (no free generation).
  if (plan.intent === 'sequence' && info.status !== 'unsupported' && info.status !== 'disabled') {
    const rep = sequenceReport(input.text, plan.techniques, art, index, results);
    return { plan, results, message: { ...base, text: [notice, rep.text].filter(Boolean).join('\n\n'), techniqueIds: rep.techniqueIds, model: 'martialdex-evidence' } };
  }
  // A lesson request is answered with the plan itself — measured: the model's free
  // text here was vague filler that also named the wrong art (107 s on CPU).
  if (plan.intent === 'lesson' && lessonPlan) {
    const fit = deps.lessonFit?.(lessonPlan.lesson.items.map((i) => i.technique.id)) ?? '';
    const proposal2 = lessonPlan.proposal;
    return { plan, results, message: { ...base, lessonProposal: proposal2, text: [notice, goalNote, lessonPlanText(lessonPlan.lesson, deps.artName), fit, safetyBlock(lessonPlan.lesson.items.map((i) => i.technique), deps)].filter(Boolean).join('\n\n'), model: 'martialdex-plan' } };
  }
  // Video / paper requests are answered by the search itself — when it could not run, say so (no model text).
  if ((plan.intent === 'video' || plan.intent === 'paper') && (info.status === 'failed' || info.status === 'unsupported' || info.status === 'disabled')) {
    const what = plan.intent === 'video' ? '영상' : '논문·연구 자료';
    const text =
      info.status === 'disabled'
        ? `${notice}\n\n${what}은 실시간 검색으로만 찾습니다. 자체 검색을 켠 뒤 다시 물어봐 주세요.`
        : info.status === 'unsupported'
        ? `${notice}\n\n${what}은 실시간 검색으로만 찾습니다. 데스크톱 앱에서 다시 물어봐 주세요.`
        : `🔎 검색을 시도했지만 실패했습니다: ${info.message ?? '알 수 없는 오류'}\n\n${what}은 실시간 검색으로만 찾습니다. 검색 서버가 다시 연결되면 같은 질문을 다시 보내 주세요.`;
    return { plan, results, message: { ...base, text, model: 'martialdex-list' } };
  }
  if ((plan.intent === 'video' || plan.intent === 'paper') && info.status !== 'failed' && info.status !== 'unsupported' && info.status !== 'disabled') {
    return { plan, results, message: { ...base, text: [notice, listAnswer(plan.intent, sources)].filter(Boolean).join('\n\n'), model: 'martialdex-list' } };
  }
  // A family named ("레슬링 싱글렉이 뭐야?" = the category 싱글 레그) and no teachable record of the art by that name.
  if (plan.intent === 'technique' && !plan.research.needed && art) {
    const topic = categoryTopicsInText(input.text, art)[0];
    const recordNamed = plan.techniques.some((t) => (t.martialArts ?? [t.martialArt]).includes(art) && lessonReadiness(t).level !== 'insufficient');
    if (topic && !recordNamed) return { plan, results, message: { ...base, text: familyAnswerText(topic, deps.artName ? deps.artName(art) : art), techniqueIds: topic.members.map((t) => t.id), model: 'martialdex-data' } };
  }
  // technique / comparison questions that need no search: the tested data engine (no free generation)
  if ((plan.intent === 'technique' || plan.intent === 'compare' || (plan.intent === 'lesson_question' && !lessonTech)) && !plan.research.needed && deps.dataAnswer) {
    const own = await deps.dataAnswer(plan.techniques[0] ?? lessonCurrent ?? null, input.text, art).catch(() => null);
    if (own) return { plan, results, message: { ...base, text: own, model: 'martialdex-data' } };
  }

  input.onStatus?.('답변 작성 중…');
  const res = await deps.chat(
    { requestId: input.requestId, messages: [{ role: 'system', content: system }, ...historyMessages(input.history), { role: 'user', content: input.text }], maxTokens: 450, temperature: 0.3 },
    input.onDelta
  );

  if (!res.ok) {
    if (res.code === 'CANCELLED') return { plan, results, message: { ...base, text: (res.partial ?? '').trim() || '(답변을 취소했습니다)', guardNotes: ['사용자가 답변을 취소함'] } };
    const text = [notice, dataOnlyAnswer(plan, plan.techniques, sources, res.message)].filter(Boolean).join('\n\n');
    return { plan, results, message: { ...base, text, dataOnly: { reason: res.message } } };
  }

  const g = guardAnswer(res.text, { sourceCount: sources.length, sourceUrls: sources.map((s) => s.url), searched: info.searched && sources.length > 0 });
  const guardNotes: string[] = [];
  // the small model sometimes repeats a sentence; repeats are removed and the learner is told
  const deduped = dedupeSentences(g.text.split('\n')).join('\n');
  const removedRepeats = g.text.split(/(?<=[.!?。])\s+|\n/).filter((x) => x.trim()).length - deduped.split(/(?<=[.!?。])\s+|\n/).filter((x) => x.trim()).length;
  if (removedRepeats > 0) {
    g.text = deduped;
    guardNotes.push(`로컬 모델이 반복한 문장 ${removedRepeats}개를 지웠습니다.`);
  }
  if (g.removedCitations.length) guardNotes.push(`없는 출처 번호 ${g.removedCitations.join(', ')}를 답변에서 지웠습니다.`);
  if (g.removedUrls.length) guardNotes.push(`검색 결과에 없는 링크 ${g.removedUrls.length}개를 지웠습니다.`);
  if (g.falseSearchClaim) guardNotes.push('이번 답변은 검색 자료 없이 작성되었습니다. "검색/자료에 따르면" 같은 표현은 사실이 아닙니다.');
  if (g.foreignScript) guardNotes.push('답변에 한자·일본어 문자가 섞였습니다 (로컬 모델 출력 오류).');
  if (g.removedPromises.length) guardNotes.push(`실제로 하지 않는 동작을 약속한 문장 ${g.removedPromises.length}개를 지웠습니다 (답변 뒤에 다시 검색·시도하지 않습니다).`);
  // official technique names (MARTIALDEX data) — English names and sound-alike misspellings normalized
  // names in play: the question's techniques, the lesson's, and those the learner data names (a composite answer
  // about "내 콤보와 전술" names no technique in the question)
  // namedIn 은 기술 이름을 찾으려고 구절마다 기술 DB를 훑는다 — 단어당 약 60ms 다(2026-11-08 측정).
  // 여기에 개인 컨텍스트 블록(프로필 + 목표 + 학습 기록, 1,200자 안팎)까지 넘기면 한 턴에 수 분이 걸렸고,
  // test-goals-coach 가 120초를 넘겨 멈췄다. 고치려는 대상은 답변의 표기이므로 답변만 넘긴다 —
  // 개인 컨텍스트는 앱이 만든 글이라 이미 정식 명칭을 쓰고, 그 자체를 교정할 일이 없다.
  const terms = fixTerminology(g.text, [...plan.techniques, ...(lessonCurrent ? [lessonCurrent] : []), ...(deps.namedIn ? deps.namedIn(g.text) : [])]);
  g.text = terms.text;
  guardNotes.push(...terms.notes);
  // 근거 대조: each sentence vs the source text the model saw; a sentence that says the opposite of its source is removed
  let claims: ClaimCheck[] | undefined;
  if (sources.length) {
    claims = checkClaims(g.text, evidence, [dataParts.join('\n'), learner].join('\n')).map((c) => ({ ...c, ...(c.source ? { sourceId: sources.find((s) => s.n === c.source)?.sourceId } : {}) }));
    const dropped = dropContradicted(g.text, claims);
    g.text = dropped.text;
    for (const c of dropped.removed) guardNotes.push(`출처 [${c.source}]와 다른 내용이라 지운 문장: "${c.sentence.slice(0, 90)}" — ${c.problems.map((p) => PROBLEM_LABEL[p]).join(', ')} (원문: "${(c.quote ?? '').slice(0, 120)}")`);
    if (!g.cited.length) guardNotes.push('답변에 출처 번호가 없습니다. 아래 "근거 대조"에서 앱이 문장별로 대조한 결과를 확인해 주세요.');
    const sum = claimSummary(claims);
    if (sum) guardNotes.push(sum);
    // 사양 §5: 근거 매칭 0건은 정상 답변이 아니다. 자료를 붙여 놓고 한 문장도 대조되지 않았다면 왜 그런지
    // 관찰 가능한 사실로 적는다 — 그래야 "출처가 있으니 맞는 말"로 읽히지 않는다.
    const facts = claims.filter((c) => c.status !== 'opinion');
    if (facts.length && !facts.some((c) => c.status === 'supported')) {
      const read = results.filter((r) => r.extraction.status === 'ok' && r.content).length;
      const why = !read
        ? `찾은 자료 ${sources.length}건의 본문을 한 곳도 읽지 못했습니다 (영상이거나 사이트가 자동 수집을 막음). 대조할 원문 자체가 없었습니다`
        : !focused.length
          ? `본문을 읽은 자료 ${read}곳에서 이 질문을 다룬 문장을 찾지 못해, 모델에게 넘긴 근거가 검색 요약뿐이었습니다`
          : `모델이 쓴 문장이 출처 문장과 단어·수치 어느 쪽으로도 겹치지 않았습니다 (자료에 없는 내용을 말했을 수 있습니다)`;
      guardNotes.push(`근거 매칭 0건 — ${why}. 아래 답변은 출처로 확인된 내용이 아니므로 사실로 받아들이기 전에 출처 원문을 확인해 주세요.`);
    }
  }
  // 사양 §4-3: where the sources themselves disagree, both sides are shown and neither is picked
  const conflicts = sources.length >= 2 ? sourceConflicts(evidence) : [];
  const text = [notice, g.text].filter(Boolean).join('\n\n');
  return { plan, results, message: { ...base, text, guardNotes: guardNotes.length ? guardNotes : undefined, model: res.model, ...(claims?.length ? { claims } : {}), ...(conflicts.length ? { sourceConflicts: conflicts } : {}) } };
}

/**
 * "내 잽 자세가 맞는지 확인하고 싶어" — the existing pose measurement, when the technique has one:
 * a single-technique demonstration video (judged from title / description), the capture guide
 * from the measurement config, and the button that opens the measurement. No reference → no start.
 */
async function poseCheckTurn(plan: TurnPlan, input: TurnInput, deps: CoachAgentDeps, lessonCurrent: Technique | null, skipped: TurnResearchInfo): Promise<TurnOutput> {
  const base = { role: 'assistant' as const, tools: plan.tools, model: 'martialdex-route' };
  const t = plan.techniques[0] ?? lessonCurrent;
  const back = input.lesson ? '\n\n수업은 하던 단계에서 그대로 이어집니다.' : '';
  // a family named ("싱글렉 자세") — the measurement exists per technique, none of this family's records has one
  const fam = !t ? categoryTopicsInText(input.text, artIn(input.text))[0] ?? null : null;
  if (!t && fam) {
    const measurable = fam.members.filter((m) => poseSupport(m).supported);
    if (!measurable.length) {
      const alt = poseSupport(fam.members[0]).alternatives;
      return { plan, results: [], message: { ...base, research: skipped, text: `${fam.category} 계열 기록에는 MARTIALDEX 자세 측정(카메라 관절 분석) 기준이 없는 기술입니다. 측정하지 않았고 점수도 만들지 않습니다.${alt.length ? `\n같은 무술에서 측정할 수 있는 기술: ${alt.map((a) => a.name).join(', ')}` : ''}${back}` } };
    }
  }
  if (!t) {
    const names = listSupportedTechniqueIds().map((id) => resolveTechnique(id)?.name).filter(Boolean);
    return { plan, results: [], message: { ...base, research: skipped, text: `어떤 기술의 자세를 확인할까요? 카메라 자세 측정이 가능한 기술: ${[...new Set(names)].join(', ')}${back}` } };
  }
  const sup = poseSupport(t);
  if (!sup.supported) {
    return { plan, results: [], message: { ...base, research: skipped, techniqueIds: [t.id], text: `${sup.reason}${sup.alternatives.length ? `\n같은 무술에서 측정할 수 있는 기술: ${sup.alternatives.map((a) => a.name).join(', ')}` : ''}\n(외부 AI로 기준 영상과 비교하는 기존 "기준 영상 비교" 기능은 자체 AI에서 자동으로 시작하지 않습니다.)${back}` } };
  }
  const guide = captureGuide(t)!;
  input.onStatus?.('기준 영상 검색 중…');
  const sport = t.martialArt === 'mixed-martial-arts' ? 'mma' : t.martialArt.replace(/-/g, ' ');
  const outcome = await deps.research({ query: `${t.name} ${sport} technique tutorial`, queries: [`how to ${t.name} ${sport}`], kind: 'video', maxResults: 8 });
  const info = researchInfo({ ...plan, research: { needed: true, kind: 'video', queries: [`${t.name} ${sport} technique tutorial`, `how to ${t.name} ${sport}`], reason: '자세 측정 기준 영상' } }, outcome);
  const all = outcome.ok ? toSources(outcome.results) : [];
  const { picked, rejected } = pickReferenceVideos(all, t);
  if (!outcome.ok) return { plan, results: [], message: { ...base, research: info, techniqueIds: [t.id], text: `기준 영상을 검색하지 못해(${outcome.message}) 자세 측정을 시작하지 않았습니다. 검색 서버가 연결되면 다시 요청해 주세요.${back}` } };
  if (!picked.length) {
    const why = [...new Set(rejected.map((r) => r.why))].join(', ') || '검색 결과 없음';
    return { plan, results: outcome.results, message: { ...base, research: info, techniqueIds: [t.id], text: `${t.name} 한 가지를 보여 주는 기준 영상을 찾지 못해 자세 측정을 시작하지 않았습니다(찾은 영상 ${all.length}개: ${why}).${back}` } };
  }
  const text = [
    `■ ${t.koreanName ?? t.name} 자세 측정 준비`,
    `기준 영상 ${picked.length}개 — 제목·설명으로 고른 단일 기술 시연 영상이며, 영상 속 자세는 앱이 확인하지 않았습니다. 점수는 기준 영상과의 비교가 아니라 MARTIALDEX 자세 기준(${guide.measures.join(', ')})으로 냅니다.`,
    '■ 촬영 안내',
    `- 화면에 들어와야 하는 범위: ${guide.bodyRange}`,
    `- 카메라 높이: ${guide.cameraHeight} · 거리: ${guide.distance}`,
    `- 위치: ${guide.placement}`,
    `- 동작: ${guide.motion}`,
    `- 방향: ${guide.direction}`,
    '아래 "자세 측정 시작"에서 카메라로 측정하거나 촬영한 영상 파일을 올릴 수 있습니다. 영상은 이 기기에서만 분석하고 저장·공유하지 않습니다.',
  ].join('\n');
  return { plan, results: outcome.results, message: { ...base, research: info, techniqueIds: [t.id], videos: picked, text: text + back, action: { label: '자세 측정 시작', to: `/pose-check/${encodeURIComponent(t.id)}`, state: { references: picked } } } };
}
