// Contract of the local conversational model bridge (electron/selfAi.cjs, IPC selfai:*)
// and of the conversation coach built on it (coachAgent.ts).

import type { PaperInfo, ResearchKind, ResearchReliability, SourceType, VideoInfo } from '../selfResearch/types';

export interface SelfAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SelfAiChatRequest {
  requestId: string;
  messages: SelfAiMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export type SelfAiErrorCode = 'EMPTY' | 'NOT_RUNNING' | 'MODEL_MISSING' | 'TIMEOUT' | 'CANCELLED' | 'BAD_RESPONSE' | 'UNKNOWN' | 'UNSUPPORTED' | 'UNAUTHORIZED' | 'BUSY';

export type SelfAiChatResult =
  | { ok: true; text: string; model: string; evalCount: number; ms: number }
  | { ok: false; code: SelfAiErrorCode; message: string; partial?: string };

/** A source as shown under an answer — copied from the research result, never written by the model. */
export interface ChatSource {
  n: number;
  /** App-assigned source id (the search result's own) — the [n] shown is only its position in this answer. */
  sourceId?: string;
  fetchedAt?: string;
  title: string;
  url: string;
  source?: string;
  sourceType: SourceType;
  sourceTypeLabel: string;
  publishedAt?: string;
  reliability: ResearchReliability;
  /** Whether the page text itself was read (vs. only the search summary). */
  contentRead: boolean;
  /**
   * 이 답변이 실제로 이 자료의 문장을 근거로 썼는가 (사양 §5: 사용한 자료와 참고만 한 자료를 구분).
   * undefined 는 "구분하지 않은 경로" — 거짓이라는 뜻이 아니다.
   */
  used?: boolean;
  /** 관련성 평가(selfAi/relevance.ts)가 관찰한 이유 — 왜 썼는지/왜 참고로만 남겼는지. */
  relevanceWhy?: string[];
  video?: VideoInfo;
  paper?: PaperInfo;
}

export interface TurnResearchInfo {
  /** Did a search actually run this turn? */
  searched: boolean;
  kind: ResearchKind;
  queries: string[];
  /** 'disabled' = the user turned 자체 검색 off (설정) — nothing searched, nothing used in its place. */
  status: 'ok' | 'empty' | 'failed' | 'skipped' | 'unsupported' | 'disabled';
  reason: string;
  message?: string;
  failedEngines?: string[];
  duplicatesRemoved?: number;
  pagesRead?: number;
  /** Results the engines returned before filtering (0 = the engines found nothing). */
  rawCount?: number;
  /** Results dropped as off-topic, with a few of their titles. */
  irrelevantRemoved?: number;
  removedTitles?: string[];
  /** Failure code (NOT_RUNNING = 검색 서버 응답 없음, TIMEOUT, SEARCH_FAILED …) — failures are told apart. */
  failureCode?: string;
  /** An earlier search reused from the cache: not searched now (searchedAt = when it really ran). */
  cached?: { searchedAt: string; expiresAt: string; serverUp: boolean };
}

export interface LessonProposal {
  topic: string;
  martialArt: string | null;
  techniqueIds: string[];
  /** Knowledge sequence ids (setups / combos) found for the topic. */
  sequenceIds: string[];
  sourceUrls: string[];
  /** Web-found items not in the DB — kept as candidates with their status, never as verified data. */
  candidateIds: string[];
  /** Offered by the coach on its own (사양 §7-3), not asked for — the learner may decline. */
  suggested?: boolean;
  /** What the lesson is built from, in the learner's words (conversation topics, records, sources) — shown before starting. */
  summary?: string[];
  /** Video urls found in the conversation for this topic (the lesson shows them as reference — content not verified). */
  videoUrls?: string[];
}

/** What a turn was about — kept on the answer so the conversation's topics can be rebuilt (selfAi/conversationMemory.ts). */
export interface TurnMeta {
  intents: string[];
  topicKey: string | null;
  topicLabel: string | null;
  topicTechniqueIds?: string[];
  art: string | null;
  aspects: string[];
  /** A lesson offer made by the coach, and what became of it. */
  suggestion?: 'offered' | 'declined' | 'accepted';
}

/** A 3D demo the chat shows inline. clipId null = this technique has no 3D demo yet (shown as such, never replaced). */
export interface TechniquePreview {
  items: { techniqueId: string; name: string; clipId: string | null }[];
  /** true when the learner explicitly asked to SEE it (보여줘 / 시연 / 3D) — the viewer opens right away. */
  open: boolean;
}

export interface CoachChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  sources?: ChatSource[];
  /** Video results shown as cards with the in-app player. */
  videos?: ChatSource[];
  research?: TurnResearchInfo;
  techniqueIds?: string[];
  lessonProposal?: LessonProposal;
  /** In a lesson: techniques offered for THIS lesson (added only after the learner agrees). */
  lessonAdd?: import('./lessonSession').LessonAddProposal;
  /** 3D technique preview(s) chosen by code (selfAi/preview.ts) — only technique ids from the DB, never paths/URLs. */
  preview?: TechniquePreview;
  /** An existing MARTIALDEX screen that serves the request (e.g. AI 맞춤 커리큘럼), opened with this state. */
  /** autoRun: the learner asked the app to DO it (화면 열어줘) - the chat navigates right away (CoachChat). */
  action?: { label: string; to: string; state?: Record<string, unknown>; autoRun?: boolean };
  /** Which tools the code chose for this turn (router.ts) — shown for transparency. */
  tools?: string[];
  /** Set when the answer did not come from the local model (it was unavailable) — data-only reply. */
  dataOnly?: { reason: string };
  guardNotes?: string[];
  /** 근거 대조 — per answer sentence: which source supports it, or that none does (selfAi/evidenceCheck.ts, code-checked). */
  claims?: import('./evidenceCheck').ClaimCheck[];
  /** The answer was read from the learner's stored data (coachContext/personalFacts.ts) — which stores, and whether one failed to load. */
  personalData?: { stores: string[]; loadFailed: boolean };
  model?: string;
  turn?: TurnMeta;
  /** Sentences in one source that another source contradicts (selfAi/evidenceSummary.ts) — shown side by side, neither picked. */
  sourceConflicts?: import('./evidenceSummary').SourceConflict[];
  /** Composite turns: the parts of the request and what each produced (shown as a checklist above the answer). */
  tasks?: { label: string; status: 'done' | 'partial' | 'failed' | 'skipped'; note?: string }[];
  /** Web-found techniques / setups compared with MARTIALDEX (never added to the DB). */
  candidates?: { name: string; status: string; inDb: boolean; note: string }[];
}

export interface CoachConversation {
  id: string;
  title: string;
  martialArt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: CoachChatMessage[];
  /** Lesson session started from this conversation, if any. */
  lessonSessionId?: string;
}
