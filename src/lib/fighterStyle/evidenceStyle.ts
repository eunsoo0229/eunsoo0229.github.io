// 근거 기반 선수 스타일 분석 (MARTIALDEX 자체 AI).
//
// Unlike styleAnalysis.ts (one ungrounded model call), every statement here is
// tied to fetched sources and sorted by how it is supported:
//   multi_source     same pattern quoted from page text on ≥2 independent sites
//   source_analysis  quoted from page text on exactly one site
//   ai_inference     connection proposed by the app from MARTIALDEX records (labelled as inference)
//   unconfirmed      only in a search summary, or the quote was not found in the page
// "Seen in fight footage" is NOT a category we can fill: the app does not watch
// videos. Video results are listed as links only and said to be unreviewed.
// Frequency words ("자주", "often") are kept only when the source sentence says so.

import { quoteFoundInSource } from '../aiCurriculum/evidenceLedger';
import { classifyCandidate } from '../martialdexKnowledge/candidates';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeCandidate, KnowledgeIndex } from '../martialdexKnowledge/types';
import { resolveTechniqueName } from '../sharedCombo/dbCombos';
import { getUnifiedAllTechniques } from '../userTechniques/service';
import type { ResearchOutcome, ResearchRequest, ResearchResult } from '../selfResearch/types';
import type { SelfAiChatRequest, SelfAiChatResult } from '../selfAi/types';
import { ruleBasedAnalysis, type ExcludedMention } from './ruleExtract';
import { FIGHTER_EVIDENCE, type EvidenceKind } from './actor';
import { focusOf, nameForms, scoreResult, type QuestionFocus, type RelevanceScore } from '../selfAi/relevance';

export type StyleItemKind = 'setup' | 'combo' | 'technique' | 'distance' | 'situation' | 'connection' | 'gameplan';
export type StyleSupport = 'multi_source' | 'source_analysis' | 'ai_inference' | 'unconfirmed';

export const STYLE_SUPPORT_LABEL: Record<StyleSupport, string> = {
  multi_source: '여러 자료에서 공통 확인',
  source_analysis: '출처 1곳의 분석',
  ai_inference: 'AI 추론 (MARTIALDEX 기록 기반)',
  unconfirmed: '자료 부족 — 확인 못함',
};

export const STYLE_KIND_LABEL: Record<StyleItemKind, string> = {
  setup: '셋업',
  combo: '콤보',
  technique: '주요 기술',
  distance: '거리 조절',
  situation: '상황별 선택',
  connection: '기술 연결',
  gameplan: '경기 운영',
};

export interface StyleQuote {
  url: string;
  title: string;
  site: string;
  quote: string;
  verified: boolean;
  /** The source sentence containing the quote uses a frequency word (자주 / often …). */
  frequencyInSentence?: boolean;
  /** Rule extraction: how the sentence supports it — a reported action or an analysis (actor.ts). */
  evidence?: EvidenceKind;
  reason?: string;
}

export interface StyleItem {
  kind: StyleItemKind;
  /** Short description in the extractor's words (Korean or English). */
  text: string;
  /** For setup / combo / technique / connection: step names in order. */
  steps?: string[];
  support: StyleSupport;
  quotes: StyleQuote[];
  /** MARTIALDEX technique ids the steps resolved to. */
  techniqueIds: string[];
  /** True only when a verified source sentence itself uses a frequency word. */
  frequencyStated: boolean;
}

export interface EvidenceStyleReport {
  fighter: string;
  martialArt: string;
  items: StyleItem[];
  videos: { title: string; url: string; note: string }[];
  candidates: KnowledgeCandidate[];
  /**
   * Every source kept, each saying whether the analysis actually USED it or only lists it for reference
   * (사양 §5: 실제 사용된 자료와 참고만 한 자료를 구분). `why` holds the observed reasons behind that call.
   */
  sources: { title: string; url: string; sourceTypeLabel: string; reliabilityLabel: string; contentRead: boolean; publishedAt?: string; used: boolean; relevance: number; why: string[] }[];
  /** What the question asked about and whether the sources confirmed it. */
  topicEvidence?: TopicEvidence;
  /**
   * MARTIALDEX records for the asked topic, listed when the search could not confirm what THIS fighter does
   * (사양 §5: 검색 결과가 없다고 기존 MARTIALDEX DB를 무시하지 않는다). These are the app's own technique
   * records — never presented as something the fighter was observed doing.
   */
  topicRecords?: { id: string; name: string; martialArt: string }[];
  limits: string[];
  searched: boolean;
  /** The research results themselves (sources under the chat answer, video cards). */
  webResults?: ResearchResult[];
  videoResults?: ResearchResult[];
  /** Pages whose text was read. */
  pagesRead?: number;
  /** Techniques the pages name that are NOT the fighter's (the opponent's, general explanations, advice, captions, unclear subject). */
  excluded?: ExcludedMention[];
  /** Search rounds and why results could not be used. */
  searchLog?: FighterSearchLog;
}

export interface EvidenceStyleDeps {
  research: (req: ResearchRequest) => Promise<ResearchOutcome>;
  chat: (req: SelfAiChatRequest) => Promise<SelfAiChatResult>;
  knowledgeIndex: () => Promise<KnowledgeIndex>;
}

const MAX_PAGES = 6;
const PAGE_CHARS = 3500;
const FREQUENCY = /(자주|주로|즐겨|often|frequently|favorite|favourite|signature|go-to|bread and butter|staple|habitually|always)/i;
const KINDS: StyleItemKind[] = ['setup', 'combo', 'technique', 'distance', 'situation', 'connection', 'gameplan'];

/**
 * What the question asks about, as English search words (only the topics actually asked).
 *
 * The narrow topics come from the relevance lexicon (selfAi/relevance.ts), so a question about 가드 / 앞손 /
 * 클린치 reaches the search engine as "guard defense" / "lead hand jab" / "clinch". Before 2026-11-08 this list
 * knew only 7 topics and "가드" matched none of them, so "포이리에가 습관적으로 올리는 가드" was searched as
 * "Dustin Poirier striking breakdown" — the question's actual subject never left the app.
 */
export function topicTerms(question: string): string[] {
  const t: string[] = [];
  if (/(타격|striking)/i.test(question)) t.push('striking');
  if (/(복싱|boxing|펀치)/i.test(question)) t.push('boxing');
  if (/(그래플링|레슬링|테이크다운|grappling|wrestling)/i.test(question)) t.push('grappling');
  return [...new Set([...t, ...focusOf(question, null).queryWords])];
}

/** Search rounds for a fighter: the asked topics first, then other phrasings — never unrelated words. */
export function fighterQueries(en: string, art: string, question: string, round: number): string[] {
  const sport = art === 'mixed-martial-arts' ? 'mma' : art.replace(/-/g, ' ');
  const topics = topicTerms(question);
  const explicit = topics.filter((x) => x === 'striking' || x === 'boxing' || x === 'grappling')[0];
  const main = explicit ?? 'striking';
  // the asked topic leads the query; a long list of words only makes the engine match fewer pages, so take 3
  const detail = topics.filter((x) => x !== main).slice(0, 3).join(' ');
  // 질문이 타격·복싱·그래플링을 직접 말했으면 그것이 첫 검색어의 중심이고, 좁은 주제는 두 번째 검색어가 받는다.
  // 그런 큰 말이 없을 때만 좁은 주제가 첫 검색어를 이끈다 — "가드"처럼 큰 말이 없는 질문이 기본값 'striking'
  // 으로 덮여 주제가 검색 엔진까지 가지 못하던 문제를 고치면서, 기존 질문의 검색어 순서는 그대로 둔다.
  const lead = explicit ?? detail ?? main;
  if (round === 1) return [`${en} ${lead} breakdown`, `${en} fight analysis ${detail || 'setups combinations'}`];
  if (round === 2) return [`${en} ${detail || 'technique'} breakdown film study`, `${en} ${sport} ${detail || main} style analysis`];
  return [`how ${en} fights ${detail || main}`, `${en} fighting style ${detail}`.trim()];
}

export type FighterFailure = 'access' | 'extract' | 'irrelevant' | 'name_missing' | 'no_technique' | 'off_topic' | 'same_name_other' | 'indirect';
export const FIGHTER_FAILURE_LABEL: Record<FighterFailure, string> = {
  access: '페이지 접근 실패(차단·robots·연결)',
  extract: '본문 추출 실패',
  irrelevant: '검색 결과가 이 선수와 무관',
  name_missing: '본문에 선수 이름 없음',
  no_technique: '본문에 분석 대상 기술 없음',
  off_topic: '선수는 맞지만 질문한 주제를 다루지 않음',
  same_name_other: '같은 이름의 다른 기술을 다룬 자료',
  indirect: '선수와 주제가 한 문장에서 연결되지 않음 (간접 근거)',
};

export interface FighterSearchLog {
  rounds: { queries: string[]; results: number; relevant: number; read: number }[];
  failures: Record<FighterFailure, number>;
}

/** 질문한 주제를 자료에서 확인했는가 — 사양 §2·§5의 "확인 불가"를 코드가 판정한 결과. */
export interface TopicEvidence {
  /** 질문이 말한 주제 (가드·방어 자세 …). 주제를 말하지 않았으면 비어 있다. */
  labels: string[];
  /** 질문이 반복성(습관·자주)을 물었는가. */
  habitAsked: boolean;
  /** 본문에서 선수와 주제가 같은 문장으로 확인된 자료 수. */
  directSources: number;
  /** 그 중 서로 다른 사이트 수 — 습관 주장은 2곳 이상이어야 한다. */
  directSites: number;
  /** 선수와 주제가 함께 나온 본문 문장 (사이트별 1개, 최대 4개). */
  sentences: { site: string; url: string; title: string; sentence: string; frequency: boolean }[];
  /** 주제를 다루지 않아 근거에서 뺀 자료 수 (선수 이름만 나온 소개 글 등). */
  offTopic: number;
  /** 같은 이름의 다른 기술이라 뺀 자료 수. */
  sameNameOther: number;
}

/** The fighter as written in a page: full name or surname (≥ 3 letters). */
export function namesFighter(text: string, en: string): boolean {
  const parts = en.split(/\s+/).filter((p) => p.length >= 3);
  return [en, ...parts.slice(-1)].some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}

export function styleQueries(fighter: string, art: string): string[] {
  const sport = art === 'mixed-martial-arts' ? 'mma' : art.replace(/-/g, ' ');
  return [`${fighter} ${sport} style breakdown`, `${fighter} fight analysis setups combinations`, `${fighter} interview technique training`];
}

const EXTRACT_PROMPT = (fighter: string, text: string) =>
  `다음 자료에서 선수 "${fighter}"의 경기 스타일에 대한 내용만 JSON으로 추출하세요.
형식: {"items":[{"kind":"setup|combo|technique|distance|situation|connection","text":"짧은 설명","steps":["기술 이름(영어)", "..."],"quote":"자료 원문 그대로의 문장 일부(영어 원문이면 영어 그대로)"}]}
규칙: 자료에 실제로 쓰인 내용만, 항목은 최대 6개, quote는 원문을 바꾸지 말고 짧게 그대로 복사. 이 선수에 대한 내용이 없으면 {"items":[]}.

자료:
${text}`;

interface RawItem {
  kind?: string;
  text?: string;
  steps?: unknown;
  quote?: string;
  /** Already-resolved MARTIALDEX ids (rule-based extraction found the names in the DB). */
  ids?: string[];
  evidence?: EvidenceKind;
  reason?: string;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    return url;
  }
}

const keyOf = (kind: string, steps: string[] | undefined, text: string) =>
  `${kind}|${steps?.length ? steps.map((s) => s.toLowerCase().trim()).join('>') : text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 6).join(' ')}`;

/** Merge per-page extractions and decide support from re-checked quotes. Pure. */
export function mergeStyleItems(perPage: { page: ResearchResult; items: RawItem[] }[], art: string): StyleItem[] {
  const groups = new Map<string, { kind: StyleItemKind; text: string; steps?: string[]; ids?: string[]; quotes: StyleQuote[] }>();
  for (const { page, items } of perPage) {
    const body = page.content ?? '';
    for (const it of items) {
      const kind = KINDS.includes(it.kind as StyleItemKind) ? (it.kind as StyleItemKind) : null;
      const text = typeof it.text === 'string' ? it.text.trim().slice(0, 200) : '';
      const quote = typeof it.quote === 'string' ? it.quote.trim().slice(0, 400) : '';
      if (!kind || !text || !quote) continue;
      const steps = Array.isArray(it.steps) ? it.steps.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 8) : undefined;
      const k = keyOf(kind, steps, text);
      const g = groups.get(k) ?? { kind, text, steps: steps?.length ? steps : undefined, ids: it.ids?.length ? it.ids : undefined, quotes: [] };
      if (g.quotes.some((q) => q.url === page.url && q.quote === quote)) continue;
      const verified = !!body && quoteFoundInSource(quote, body);
      const sentence = verified ? body.split(/(?<=[.!?。])\s+/).find((x) => quoteFoundInSource(quote, x)) : undefined;
      g.quotes.push({ url: page.url, title: page.title, site: siteOf(page.url), quote, verified, frequencyInSentence: !!sentence && FREQUENCY.test(sentence), ...(it.evidence ? { evidence: it.evidence, reason: it.reason } : {}) });
      groups.set(k, g);
    }
  }
  return [...groups.values()].map((g) => {
    // independent support: verified quotes about what the FIGHTER does, from different sites —
    // the same sentence republished on two sites (syndication) counts once
    const fighterQuotes = g.quotes.filter((q) => q.verified && (!q.evidence || FIGHTER_EVIDENCE.includes(q.evidence)));
    const seenText = new Set<string>();
    const verifiedSites = new Set<string>();
    for (const q of fighterQuotes) {
      const t = q.quote.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenText.has(t)) continue;
      seenText.add(t);
      verifiedSites.add(q.site);
    }
    const support: StyleSupport = verifiedSites.size >= 2 ? 'multi_source' : verifiedSites.size === 1 ? 'source_analysis' : 'unconfirmed';
    const techniqueIds = g.ids ?? (g.steps ?? []).map((s) => resolveTechniqueName(s, art)?.id).filter((x): x is string => !!x);
    return {
      kind: g.kind,
      text: g.text,
      steps: g.steps,
      support,
      quotes: g.quotes,
      techniqueIds,
      frequencyStated: g.quotes.some((q) => q.verified && (q.frequencyInSentence || FREQUENCY.test(q.quote))),
    };
  });
}

/** App-made connection suggestions between verified techniques, from MARTIALDEX sequences — labelled ai_inference. */
export function inferConnections(items: StyleItem[], index: KnowledgeIndex, art: string): StyleItem[] {
  const verified = new Set(items.filter((i) => i.support !== 'unconfirmed').flatMap((i) => i.techniqueIds));
  const out: StyleItem[] = [];
  const seen = new Set<string>();
  for (const id of verified) {
    const k = gatherTechniqueKnowledge(id, index, { art });
    if (!k) continue;
    for (const s of [...k.setupsInto, ...k.combos.map((c) => c.sequence)]) {
      const ids = s.steps.map((st) => st.techniqueId);
      if (seen.has(s.id) || ids.filter((x) => verified.has(x)).length < 2) continue;
      seen.add(s.id);
      out.push({
        kind: 'connection',
        text: `확인된 기술들이 MARTIALDEX의 「${s.name}」 기록으로 이어질 수 있습니다 (선수가 실제로 이 순서를 쓴다는 자료는 아님).`,
        steps: s.steps.map((st) => st.name),
        support: 'ai_inference',
        quotes: [],
        techniqueIds: ids,
        frequencyStated: false,
      });
      if (out.length >= 4) return out;
    }
  }
  return out;
}

export interface EvidenceStyleOptions {
  onStatus?: (s: string) => void;
  /** English name from a fetched source (Wikipedia) — used for English analysis sites. */
  fighterEn?: string | null;
  /** Arts whose technique names the pages are read for (타격 → striking arts …). */
  arts?: string[];
  /** Also ask the local model to extract items (slow on CPU; rule-based extraction always runs). */
  useModel?: boolean;
  /** The learner's question — its topics shape the search words. */
  question?: string;
}

export async function analyzeFighterStyleWithEvidence(fighter: string, martialArt: string, deps: EvidenceStyleDeps, opts: EvidenceStyleOptions | ((s: string) => void) = {}): Promise<EvidenceStyleReport> {
  const o: EvidenceStyleOptions = typeof opts === 'function' ? { onStatus: opts, useModel: true } : { useModel: false, ...opts };
  const onStatus = o.onStatus;
  const searchName = o.fighterEn ?? fighter;
  const limits: string[] = ['영상 내용은 앱이 직접 보지 않습니다 — 영상은 링크만 제공하며 "영상에서 확인됨"으로 표시하지 않습니다.'];
  onStatus?.('분석 자료 검색 중…');
  // Search in rounds: results that do not name the fighter are dropped, the same page / copy
  // counted once; a round that leaves fewer than 3 readable relevant pages leads to another
  // phrasing (at most 3 rounds). robots.txt / blocking rules of the search pipeline apply.
  const question = o.question ?? '';
  const searchLog: FighterSearchLog = { rounds: [], failures: { access: 0, extract: 0, irrelevant: 0, name_missing: 0, no_technique: 0, off_topic: 0, same_name_other: 0, indirect: 0 } };
  // 사양 §3·§4: 이름이 나온다는 이유만으로 근거가 되지 않는다. 질문이 말한 주제까지 본문에서 확인된 자료만
  // 분석에 쓰고, 선수는 맞지만 주제를 다루지 않는 글은 "참고"로만 남긴다.
  const focus = focusOf(question, searchName, [fighter]);
  const seenUrl = new Set<string>();
  const seenText = new Set<string>();
  const kept: ResearchResult[] = [];
  const scoreOf = new Map<string, RelevanceScore>();
  const pages: ResearchResult[] = [];
  /** 선수는 맞고 본문도 읽었으나 질문 주제를 확인하지 못한 자료 — 주제 근거가 하나도 없을 때만 넓혀 읽는다. */
  const topicless: ResearchResult[] = [];
  let anyOk = false;
  let lastError: string | null = null;
  const [video, index] = await Promise.all([deps.research({ query: `${searchName} fight highlights`, kind: 'video', maxResults: 6 }), deps.knowledgeIndex()]);
  // 언제 그만 찾는가 (사양 §6): 주제를 물은 질문은 서로 다른 자료 2곳에서 선수+주제가 직접 확인되면 충분하다.
  // 주제를 좁히지 않은 질문은 예전처럼 본문 3곳을 모은다. 근거가 모자랄 때만 다른 검색어로 더 찾는다.
  const directSites = () => new Set(pages.map((p) => scoreOf.get(p.url)?.directSentence && siteOf(p.url)).filter(Boolean)).size;
  const enough = () => (focus.topics.length ? directSites() >= 2 : false) || pages.length >= 3;
  for (let round = 1; round <= 3 && !enough(); round++) {
    const qs = fighterQueries(searchName, martialArt, question, round);
    if (round > 1) onStatus?.(`관련 자료가 부족해 다른 검색어로 다시 찾는 중… (${round}/3)`);
    // 이 선수의 이름이 제목·요약에 없는 결과는 본문을 읽지 않는다 — 읽어 봐야 이 질문의 근거가 못 된다 (사양 §6)
    const web = await deps.research({ query: qs[0], queries: qs.slice(1), kind: 'web', maxResults: 10, extractTop: MAX_PAGES, requireTerms: nameForms(searchName) });
    const log = { queries: qs, results: 0, relevant: 0, read: 0 };
    searchLog.rounds.push(log);
    if (!web.ok) {
      lastError = web.message;
      continue;
    }
    anyOk = true;
    log.results = web.results.length;
    for (const r of web.results) {
      if (seenUrl.has(r.url)) continue;
      seenUrl.add(r.url);
      const head = `${r.title} ${r.snippet ?? ''}`;
      const okBody = r.extraction.status === 'ok' && !!r.content;
      if (!namesFighter(head, searchName) && !(okBody && namesFighter(r.content!, searchName))) {
        searchLog.failures.irrelevant++;
        continue;
      }
      const rel = scoreResult(r, focus);
      scoreOf.set(r.url, rel);
      log.relevant++;
      kept.push(r);
      if (!okBody) {
        searchLog.failures[['too_short', 'not_html'].includes(r.extraction.status) ? 'extract' : 'access']++;
        continue;
      }
      if (!namesFighter(r.content!, searchName)) {
        searchLog.failures.name_missing++;
        continue;
      }
      // a republished copy of the same article is one source
      const sig = r.content!.replace(/\s+/g, ' ').slice(0, 400).toLowerCase();
      if (seenText.has(sig)) continue;
      seenText.add(sig);
      // 질문이 주제를 말했는데 이 페이지가 그 주제를 다루지 않으면 뒤로 미룬다. 버리지는 않는다 — 읽어서
      // 해로울 것은 없고(항목은 각자 원문 문장을 달고 나온다), 주제 판정·습관 판정은 "선수와 주제가 한 문장에
      // 있는" 자료로만 하기 때문이다. 자리는 주제를 다룬 자료가 먼저 가져간다 (사양 §4·§6).
      if (focus.topics.length && rel.axes.topic < 1) {
        searchLog.failures[rel.reasons.some((x) => x.startsWith('같은 이름의')) ? 'same_name_other' : 'off_topic']++;
        topicless.push(r);
        continue;
      }
      if (focus.topics.length && rel.axes.directness < 0.5) searchLog.failures.indirect++;
      if (pages.length < MAX_PAGES) {
        pages.push(r);
        log.read++;
      }
    }
  }
  // 남은 자리는 주제를 확인하지 못한 자료가 채운다 — 선수에 관한 분석은 그대로 뽑되, 질문한 주제의
  // 근거로는 세지 않는다. 주제 자료가 하나도 없었다면 그 사실을 한계로 분명히 적는다 (사양 §5).
  const onTopic = pages.length;
  if (focus.topics.length && topicless.length && pages.length < MAX_PAGES) pages.push(...topicless.slice(0, MAX_PAGES - pages.length));
  if (focus.topics.length && !onTopic && pages.length) {
    limits.push(`질문하신 ${focus.topics.map((t) => t.label).join('·')}를 본문에서 다룬 자료를 찾지 못해, 이 선수에 관한 일반 분석 자료 ${pages.length}곳만 읽었습니다. 아래 내용은 질문하신 주제의 근거가 아닙니다.`);
  }
  const web = anyOk ? ({ ok: true as const, kind: 'web' as const, results: kept, diagnostics: {} as never }) : ({ ok: false as const, code: 'SEARCH_FAILED' as const, message: lastError ?? '검색 실패' });
  if (!web.ok) limits.push(`웹 검색 실패: ${web.message}`);
  if (web.ok && !pages.length) limits.push('관련 자료의 본문을 읽지 못해 분석 근거가 없습니다.');

  const perPage: { page: ResearchResult; items: RawItem[] }[] = [];
  // Rule-based: MARTIALDEX technique names in the page's own sentences (no model, quotes are whole sentences).
  const arts = o.arts ?? [martialArt];
  const excluded: ExcludedMention[] = [];
  for (const page of pages) {
    const found = ruleBasedAnalysis(page, o.fighterEn ?? (/^[A-Za-z]/.test(fighter) ? fighter : null), arts);
    if (found.items.length) perPage.push({ page, items: found.items });
    else searchLog.failures.no_technique++;
    excluded.push(...found.excluded.map((e) => ({ ...e, quote: e.quote, url: page.url })));
  }
  if (pages.length && !perPage.length) limits.push(`읽은 자료 ${pages.length}곳에서 이 선수와 함께 쓰인 MARTIALDEX 기술 이름을 찾지 못했습니다.`);
  if (perPage.length) limits.push('항목은 원문 문장에서 기술 이름을 찾고, 그 동작을 한 사람(이 선수·상대·일반 설명)을 문장 구조 규칙으로 판별해 뽑았습니다. 복잡한 문장에서는 판별이 틀릴 수 있으니 근거 문장을 함께 확인해 주세요.');
  for (const [i, page] of (o.useModel ? pages : []).entries()) {
    onStatus?.(`자료 분석 중… (${i + 1}/${pages.length})`);
    // One retry: a small model sometimes runs out of tokens mid-JSON.
    let parsed: RawItem[] | null = null;
    let failure = '';
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const r = await deps.chat({ requestId: `style-${Date.now()}-${i}-${attempt}`, json: true, maxTokens: 900, temperature: 0.1, messages: [{ role: 'user', content: EXTRACT_PROMPT(fighter, (page.content ?? '').slice(0, attempt ? PAGE_CHARS / 2 : PAGE_CHARS)) }] });
      if (!r.ok) {
        failure = `분석 실패: ${r.message}`;
        break;
      }
      try {
        const j = JSON.parse(r.text) as { items?: RawItem[] };
        parsed = Array.isArray(j.items) ? j.items : [];
      } catch {
        failure = 'AI 추출 결과를 읽지 못함 (재시도 포함)';
      }
    }
    if (parsed) perPage.push({ page, items: parsed });
    else limits.push(`${siteOf(page.url)}: ${failure}`);
  }
  // A setup / combo / technique / connection must name at least one real MARTIALDEX technique;
  // headings like "Coordination And Reflexes" are not style items.
  const merged = mergeStyleItems(perPage, martialArt);
  const needsTechnique = (i: StyleItem) => i.kind === 'setup' || i.kind === 'combo' || i.kind === 'technique' || i.kind === 'connection';
  const items = merged.filter((i) => !needsTechnique(i) || i.techniqueIds.length > 0);
  if (items.length < merged.length) limits.push(`MARTIALDEX 기술로 확인되지 않은 추출 ${merged.length - items.length}건은 제외했습니다.`);
  const inferred = inferConnections(items, index, martialArt);
  const usedUrls = new Set(perPage.map((p) => p.page.url));
  const sources = web.ok
    ? web.results.map((r) => {
        const rel = scoreOf.get(r.url);
        return {
          title: r.title,
          url: r.url,
          sourceTypeLabel: r.sourceTypeLabel,
          reliabilityLabel: r.reliability.label,
          contentRead: r.extraction.status === 'ok',
          publishedAt: r.publishedAt,
          // "사용" = 이 자료의 본문 문장에서 실제로 항목을 뽑았다는 뜻. 나머지는 참고 목록일 뿐이다.
          used: usedUrls.has(r.url),
          relevance: rel?.score ?? 0,
          why: rel?.reasons ?? [],
        };
      })
    : [];
  const topicEvidence = buildTopicEvidence(focus, pages, scoreOf, searchLog);
  const candidates = items
    .filter((i): i is StyleItem & { kind: 'setup' | 'combo' | 'technique' } => (i.kind === 'setup' || i.kind === 'combo' || i.kind === 'technique') && !!i.steps?.length)
    .flatMap((i) =>
      classifyCandidate(
        { kind: i.kind, name: i.kind === 'technique' ? i.steps![0] : i.steps!.join(' → '), martialArt, steps: i.kind === 'technique' ? undefined : i.steps, evidence: i.quotes.map((q) => ({ url: q.url, title: q.title, quote: q.quote })) },
        pages.map((p) => ({ url: p.url, title: p.title, content: p.content, snippet: p.snippet, sourceType: p.sourceType, publishedAt: p.publishedAt })),
        index
      )
    );
  if (!items.some((i) => i.support === 'multi_source')) limits.push('두 곳 이상의 독립 자료에서 공통으로 확인된 패턴은 없습니다.');
  return {
    fighter,
    martialArt,
    items: [...items, ...inferred],
    videos: video.ok ? video.results.map((v) => ({ title: v.title, url: v.url, note: '제목·설명만 확인 (영상 내용 미확인)' })) : [],
    candidates,
    sources,
    limits,
    searched: web.ok,
    webResults: web.ok ? web.results : [],
    videoResults: video.ok ? video.results : [],
    pagesRead: pages.length,
    excluded,
    searchLog,
    topicEvidence,
    // 검색이 이 선수의 것을 확인하지 못했을 때만 — 무엇을 못 찾았는지와 함께 앱이 가진 기록을 보여 준다
    ...(focus.topics.length && !topicEvidence.sentences.length ? { topicRecords: topicRecords(focus, arts) } : {}),
  };
}

/** 질문한 주제에 해당하는 MARTIALDEX 기술 기록 (이 선수가 쓴다는 근거가 아니라, 앱이 가진 기록 목록). */
function topicRecords(focus: QuestionFocus, arts: string[]): { id: string; name: string; martialArt: string }[] {
  const set = new Set(arts);
  const out: { id: string; name: string; martialArt: string }[] = [];
  for (const t of getUnifiedAllTechniques()) {
    if (!set.has(t.martialArt)) continue;
    const name = `${t.name} ${t.koreanName ?? ''}`;
    // 동명 다른 기술은 뺀다 — 타격 가드를 물었는데 주짓수 클로즈드 가드를 내놓지 않도록
    if (!focus.topics.some((x) => x.match.test(name) && !(x.conflict && x.conflict.test(name)))) continue;
    out.push({ id: t.id, name: t.koreanName ? `${t.name} (${t.koreanName})` : t.name, martialArt: t.martialArt });
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * 질문한 주제가 본문에서 확인됐는지 집계한다. 습관(자주·습관적)을 물은 질문은 서로 다른 사이트 2곳 이상에서
 * 같은 특징이 보여야 "반복"이라고 말할 수 있다 — 자료 한 곳의 한 문장은 그 경기의 서술일 수 있기 때문이다
 * (사양 §4: 단일 클립·단일 자료로 습관을 단정하지 않는다).
 */
function buildTopicEvidence(focus: QuestionFocus, pages: ResearchResult[], scoreOf: Map<string, RelevanceScore>, log: FighterSearchLog): TopicEvidence {
  const FREQ = FREQUENCY;
  const sentences: TopicEvidence['sentences'] = [];
  const sites = new Set<string>();
  let direct = 0;
  for (const p of pages) {
    const rel = scoreOf.get(p.url);
    if (!rel?.directSentence) continue;
    direct++;
    const site = siteOf(p.url);
    if (sites.has(site)) continue;
    sites.add(site);
    if (sentences.length < 4) sentences.push({ site, url: p.url, title: p.title, sentence: rel.directSentence, frequency: FREQ.test(rel.directSentence) });
  }
  return {
    labels: focus.topics.map((t) => t.label),
    habitAsked: focus.habit,
    directSources: direct,
    directSites: sites.size,
    sentences,
    offTopic: log.failures.off_topic,
    sameNameOther: log.failures.same_name_other,
  };
}

/** MARTIALDEX art id for a fighter's sport label ("Boxing", "MMA (UFC)", "Muay Thai" …). */
export function artFromSport(sport: string): string {
  const s = sport.toLowerCase();
  if (/mma|ufc|종합/.test(s)) return 'mixed-martial-arts';
  if (/muay|무에타이/.test(s)) return 'muay-thai';
  if (/kick|킥복싱/.test(s)) return 'kickboxing';
  if (/box|복싱/.test(s)) return 'boxing';
  if (/jiu|bjj|주짓수/.test(s)) return 'bjj';
  if (/wrest|레슬링/.test(s)) return 'wrestling';
  if (/judo|유도/.test(s)) return 'judo';
  if (/taekwondo|태권도/.test(s)) return 'taekwondo';
  if (/karate|가라테/.test(s)) return 'karate';
  return 'mixed-martial-arts';
}
