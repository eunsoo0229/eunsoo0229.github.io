// Result shape of the self-hosted research pipeline (electron/selfSearch/index.cjs,
// IPC 'research:search'). Labels describe what was observed about a source —
// they are never claims that the content is correct.

export type ResearchKind = 'web' | 'video' | 'paper';

export type SourceType = 'academic' | 'official' | 'records' | 'reference' | 'web' | 'video' | 'blog' | 'forum';

export type ExtractionStatus = 'ok' | 'blocked' | 'robots' | 'not_html' | 'too_short' | 'failed' | 'not_attempted';

export interface ResearchReliability {
  level: 'high' | 'medium' | 'low';
  label: '높음' | '보통' | '낮음';
  /** Observed facts behind the label (출처 유형, 엔진 수, 본문 확인 여부, 게시일) */
  reasons: string[];
}

export interface ResearchResult {
  /** App-assigned id from the normalized URL (electron/selfSearch/index.cjs) — answers and claims point at this. */
  sourceId?: string;
  /** When this search ran (ISO) — a cached reuse keeps the original time. */
  fetchedAt?: string;
  title: string;
  url: string;
  snippet?: string;
  /** Extracted page text (only when extraction.status === 'ok') */
  content?: string;
  source?: string;
  /** ISO date stated by the search engine or by the page's own metadata — never estimated */
  publishedAt?: string;
  publishedAtSource?: 'search_engine' | 'page_metadata';
  engines: string[];
  relevance: number;
  sourceType: SourceType;
  sourceTypeLabel: string;
  reliability: ResearchReliability;
  extraction: { status: ExtractionStatus; reason?: string; chars?: number; method?: string };
  thumbnail?: string;
  /** Video results: platform id, channel / duration as the engine gave them, embed permission (YouTube oEmbed). */
  video?: VideoInfo;
  /** Paper results: bibliographic fields as the index gave them (never filled in) + DOI check at doi.org. */
  paper?: PaperInfo;
}

export type EmbedStatus = 'embeddable' | 'not_embeddable' | 'unavailable' | 'unknown' | 'not_supported';

export interface VideoInfo {
  platform: 'youtube' | 'other';
  videoId?: string;
  channel?: string;
  duration?: string;
  thumbnail?: string;
  embed: EmbedStatus;
}

export interface PaperInfo {
  doi?: string;
  doiUrl?: string;
  /** registered = doi.org resolves it; not_found = doi.org does not know it */
  doiStatus?: 'registered' | 'not_found' | 'unchecked';
  authors?: string[];
  journal?: string;
  publisher?: string;
  year?: number;
  /** The index's abstract / summary as given — the paper itself was not read. */
  abstract?: string;
  pdfUrl?: string;
}

export interface ResearchDiagnostics {
  backend: 'searxng' | string;
  kind?: ResearchKind;
  queries?: string[];
  rawCount?: number;
  duplicatesRemoved?: number;
  /** Results dropped for sharing too few words with every query. */
  irrelevantRemoved?: number;
  /** Titles of a few of those (so "nothing found" can show what was found and why it was dropped). */
  removedTitles?: string[];
  failedEngines?: { engine: string; reason: string }[];
  /** Results removed because the URL does not open the page the title names (위키 대문 with an article title …). */
  titleUrlMismatchRemoved?: number;
  titleUrlMismatch?: { title: string; url: string; reason: string }[];
  failedQueries?: { query: string; code: string; message: string }[];
  extraction?: Partial<Record<ExtractionStatus, number>>;
}

export interface ResearchRequest {
  query: string;
  queries?: string[];
  kind?: ResearchKind;
  maxResults?: number;
  extractTop?: number;
  /** Newest first (the question said 최근 / 최신). */
  recent?: boolean;
  /**
   * 본문을 추출할 가치가 있는 결과를 고르는 조건 — 제목·검색요약에 이 중 하나라도 없으면 본문을 읽지 않는다
   * (사양 §6: 불필요한 페이지 본문 추출을 줄인다). 선수 질문이면 그 선수의 이름 표기들이 들어온다.
   * 조건에 맞는 결과가 하나도 없으면 무시하고 기존대로 상위 N건을 읽는다 — 조건 때문에 아무것도 못 읽는 일은 없다.
   */
  requireTerms?: string[];
}

export interface ResearchCacheInfo {
  /** When the reused search actually ran (ISO). */
  searchedAt: string;
  /** Until when the cache keeps it (ISO). */
  expiresAt: string;
  /** The search server's state NOW (checked when the cache was used). */
  serverUp: boolean;
}

export type ResearchOutcome =
  | {
      ok: true;
      kind: ResearchKind;
      results: ResearchResult[];
      diagnostics: ResearchDiagnostics;
      /** Set when this is an earlier search reused from the renderer's cache (selfResearch/provider.ts) — NOT a new search. */
      cache?: ResearchCacheInfo;
    }
  | { ok: false; code: 'EMPTY' | 'NOT_RUNNING' | 'SEARCH_FAILED' | 'TIMEOUT' | 'BAD_RESPONSE' | 'UNSUPPORTED' | 'DISABLED' | 'UNKNOWN'; message: string; diagnostics?: ResearchDiagnostics };

/** A person's name in English, taken from a fetched source (Wikipedia interlanguage link) — never guessed. */
export type PersonName = { ok: true; query: string; en: string; ko: string | null; source: string | null; /** How a partial name was matched to the full one. */ via?: string } | { ok: false; query: string; ko?: string; reason: string; /** Several people matched — never picked at random. */ candidates?: string[] };
