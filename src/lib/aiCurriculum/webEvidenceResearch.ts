import type { AskAiRequest, AskAiResult } from '../ai/types';
import type { WebSearchOutcome } from '../webSearch/types';
import type { GoalIntent } from './types';
import type { SubGoal } from './subGoals';
import {
  assessCoverage,
  canonicalUrl,
  judgeRelevance,
  quoteFoundInSource,
  sourceKind,
  type EvidenceRecord,
  type PartCoverage,
  type ResearchDiagnostics,
  type ResearchStopReason,
  type SourceKind,
} from './evidenceLedger';

// Real web-evidence research for a curriculum goal, per learning part (subGoals.ts):
//  - one shared Tavily budget (MAX_WAVES × MAX_QUERIES_PER_WAVE — unchanged 9 calls), handed out round-robin
//    to the parts that are still uncovered, so a follow-up part ("테이크다운 연결") is always searched
//  - one canonical-URL ledger: a page found by several queries is analyzed once, never re-analyzed
//  - one extraction call per batch of new pages for ALL parts at once, retried at most once; a batch that
//    still fails is reported as EXTRACTION_FAILED — never counted as "not enough evidence"
//  - each candidate is judged per part (evidenceLedger.ts judgeRelevance); only "relevant" ones count
// Search and the model are injected so the whole loop runs offline in tests.

export interface WebEvidenceDeps {
  search(query: string): Promise<WebSearchOutcome>;
  ask(req: AskAiRequest): Promise<AskAiResult>;
}

export const MAX_WAVES = 3;
export const MAX_QUERIES_PER_WAVE = 3;
const MAX_SOURCES_PER_EXTRACTION = 8;
const SOURCE_CHARS = 1500;
const EXTRACTION_MAX_OUTPUT_TOKENS = 4096;
const VALID_INTENT_GUESS = new Set(['attack', 'defense', 'escape', 'counter', 'connection', 'fundamentals', 'unknown']);
// a retry cannot fix these — the same request would fail the same way and spend another call
const NOT_RETRYABLE = new Set(['RATE_LIMIT', 'NO_API_KEY', 'INVALID_API_KEY', 'UNAUTHORIZED', 'NETWORK']);

interface LedgerSource {
  key: string;
  url: string;
  title: string;
  text: string;
  hasContent: boolean;
  kind: SourceKind;
  /** Page text (raw content, else the search snippet) — always handed to the extractor when present. */
  /** hasContent: 200+ characters of text, used only for the "본문 있는 자료" diagnostics count. */
  /** Parts whose queries found this page. */
  partIds: string[];
  state: 'pending' | 'analyzed' | 'failed';
}

export interface ReviewItem {
  name: string;
  partId: string;
  partLabel: string;
  url: string;
  reasons: string[];
}

export interface WebEvidenceTechnique {
  name: string;
  martialArtGuess: string;
  purpose: string;
  intentGuess: GoalIntent | 'unknown';
  partId: string;
  sourceUrls: string[];
  sourceTitles: string[];
  sourceKinds: SourceKind[];
  evidence: string;
  confidence: number;
}

export type WebEvidenceOutcome =
  | { kind: 'not_configured'; diagnostics: ResearchDiagnostics }
  | { kind: 'all_failed'; errorMessage: string; diagnostics: ResearchDiagnostics }
  | {
      kind: 'done';
      mode: 'web_search' | 'insufficient_web_evidence';
      /** Relevant techniques of the parts the curriculum may use (all covered parts). */
      techniques: WebEvidenceTechnique[];
      /** Relevant techniques of every part, covered or not — for the stop screen. */
      relevantAll: WebEvidenceTechnique[];
      excluded: { name: string; reason: string }[];
      review: ReviewItem[];
      rawCount: number;
      parts: SubGoal[];
      coverage: PartCoverage[];
      /** Set when some follow-up parts are uncovered but every core part is covered (부분 생성 후보). */
      partial: { includedIds: string[]; excluded: { id: string; label: string; reason: string }[] } | null;
      executedQueries: string[];
      wavesRun: number;
      diagnostics: ResearchDiagnostics;
    };

/** Queries for one part in one wave — the part's own topics, a different framing each wave. */
export function queriesForPart(part: SubGoal, wave: number, firstWaveOverride: string[] | null): string[] {
  if (wave === 0 && firstWaveOverride) return firstWaveOverride;
  const templates: ((t: string) => string)[][] = [
    [(t) => t, (t) => `${t} techniques`],
    [(t) => `${t} tutorial`, (t) => `${t} explained`],
    [(t) => `${t} drill breakdown`, (t) => `${t} details`],
  ];
  const tpl = templates[Math.min(wave, templates.length - 1)];
  // topic-major round-robin: topic1/tpl1, topic2/tpl1, topic1/tpl2 … so every topic gets a query
  const out: string[] = [];
  for (const fn of tpl) for (const t of part.searchTopics) out.push(fn(t).trim());
  return [...new Set(out)];
}

function emptyDiagnostics(): ResearchDiagnostics {
  return {
    searchAttempted: false,
    searchSucceeded: false,
    tavilyCalls: 0,
    queries: [],
    rawResultCount: 0,
    uniqueSourceCount: 0,
    sourcesWithContent: 0,
    sourceKinds: { video: 0, social: 0, forum: 0, article: 0 },
    analyzedSourceCount: 0,
    extraction: { calls: 0, retries: 0, failedBatches: 0, failedSourceCount: 0, lastErrorCode: null, lastErrorDetail: null },
    candidateRecords: 0,
    relevantRecords: 0,
    reviewRecords: 0,
    irrelevantRecords: 0,
    lowConfidenceRecords: 0,
    parts: [],
    stopReason: null,
  };
}

function extractionInstruction(artScope: string, parts: SubGoal[]): string {
  return [
    '아래 contextText에 실제 웹 검색으로 얻은 자료(번호/제목/URL/본문 발췌)가 주어진다. 자료에 실제로 등장하는 무술 기술만 추출한다.',
    '자료에 없는 기술을 지어내면 절대 안 된다.',
    `조사 대상 무술: ${artScope}`,
    '',
    '사용자의 학습 목표는 아래 단계들로 나뉜다. 각 기술은 그 기술이 실제로 해당하는 단계(partId)에만 담는다:',
    ...parts.map((p) => `- ${p.id} (${p.role === 'core' ? '핵심 상황' : '이어지는 단계'}): ${p.label} — 상황/포지션: ${p.positions.join(', ') || '특정 없음'}, 의도: ${p.intents.join(', ') || '특정 없음'}`),
    '',
    '각 항목(JSON 객체)의 필드:',
    '- name: 표준 영문 또는 로마자 기술명',
    '- martialArtGuess: 그 기술이 속한 무술',
    '- purpose: 이 기술이 그 단계에 어떻게 쓰이는지 한국어 한 문장(60자 이내)',
    '- intentGuess: "attack"|"defense"|"escape"|"counter"|"connection"|"fundamentals"|"unknown" 중 이 기술의 실제 성격',
    '- partId: 위 단계 id 중 하나',
    '- sourceUrl: 이 기술이 언급된 자료의 url 하나(제공된 url 그대로). 같은 기술이 두 자료에 나오면 항목을 두 개 만든다.',
    '- sourceTitle: 그 자료의 title 그대로',
    '- quote: 그 자료의 제목이나 본문에서 이 기술을 언급한 부분을 원문 그대로 복사(번역·요약 금지, 200자 이내)',
    '- appliesWhen: 자료에 따르면 이 기술을 쓰는 상황/포지션(영문, 80자 이내)',
    '- fit: 이 기술이 그 단계의 상황과 목적에 직접 해당하면 "direct", 관련은 있지만 상황이나 목적이 다르면 "partial", 해당하지 않으면 "none"',
    '- confidence: 0-100, 자료만으로 이 기술이 실존한다고 확신하는 정도',
    '',
    '다른 포지션/상황의 기술(예: 사이드 컨트롤 하위의 서브미션을 바디 트라이앵글 대응 단계에 넣는 것)은 fit을 "none"으로 한다.',
    '최대 14개 항목의 JSON 배열만 출력한다. 근거가 없으면 빈 배열 [] 을 출력한다.',
  ].join('\n');
}

type ExtractedItem = {
  name: string;
  martialArtGuess: string;
  purpose: string;
  intentGuess: GoalIntent | 'unknown';
  partId: string;
  sourceUrl: string;
  sourceTitle: string;
  quote: string;
  appliesWhen: string;
  fit: EvidenceRecord['modelFit'];
  confidence: number;
};

/** Lenient per-item parse: one malformed item is dropped, not the whole batch. Only an unparsable response fails. */
export function parseExtraction(text: string, batch: LedgerSourceLike[], parts: SubGoal[]): { ok: true; items: ExtractedItem[]; dropped: number } | { ok: false; detail: string } {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end <= start) return { ok: false, detail: `no JSON array (len=${text.length}, endsWith="${text.trim().slice(-1)}")` };
  let data: unknown;
  try {
    data = JSON.parse(t.slice(start, end + 1));
  } catch {
    return { ok: false, detail: `invalid JSON (len=${text.length}, endsWith="${text.trim().slice(-1)}")` };
  }
  if (!Array.isArray(data)) return { ok: false, detail: 'not an array' };
  const byKey = new Map(batch.map((s) => [s.key, s]));
  const partIds = new Set(parts.map((p) => p.id));
  const items: ExtractedItem[] = [];
  let dropped = 0;
  for (const x of data) {
    const o = (x ?? {}) as Record<string, unknown>;
    const src = typeof o.sourceUrl === 'string' ? byKey.get(canonicalUrl(o.sourceUrl)) : undefined;
    const partId = typeof o.partId === 'string' && partIds.has(o.partId) ? o.partId : parts.length === 1 ? parts[0].id : null;
    if (typeof o.name !== 'string' || !o.name.trim() || !src || !partId || typeof o.quote !== 'string') {
      dropped++;
      continue;
    }
    items.push({
      name: o.name.trim(),
      martialArtGuess: typeof o.martialArtGuess === 'string' ? o.martialArtGuess : '',
      purpose: typeof o.purpose === 'string' ? o.purpose : '',
      intentGuess: typeof o.intentGuess === 'string' && VALID_INTENT_GUESS.has(o.intentGuess) ? (o.intentGuess as GoalIntent | 'unknown') : 'unknown',
      partId,
      sourceUrl: src.url,
      sourceTitle: src.title,
      quote: o.quote,
      appliesWhen: typeof o.appliesWhen === 'string' ? o.appliesWhen : '',
      fit: o.fit === 'direct' || o.fit === 'partial' || o.fit === 'none' ? o.fit : 'missing',
      confidence: typeof o.confidence === 'number' ? o.confidence : 0,
    });
  }
  return { ok: true, items, dropped };
}
type LedgerSourceLike = Pick<LedgerSource, 'key' | 'url' | 'title'>;

export async function runWebEvidenceResearch(input: {
  parts: SubGoal[];
  artScope: string;
  contextLines: string[];
  /** MARTIALDEX DB-confirmed techniques per part (dbEvidence.ts) — supporting evidence for coverage. */
  dbEvidence?: { techniqueId: string; name: string; partId: string }[];
  /** The single-part request's existing first-wave queries (kept so ordinary requests search exactly as before). */
  firstWaveQueries: string[] | null;
  deps: WebEvidenceDeps;
  log?: (tag: string, fields: Record<string, string | number | boolean>) => void;
}): Promise<WebEvidenceOutcome> {
  const { parts, deps } = input;
  const log = input.log ?? (() => {});
  const diag = emptyDiagnostics();
  const db = input.dbEvidence ?? [];
  const ledger = new Map<string, LedgerSource>();
  const records: EvidenceRecord[] = [];
  const executed: string[] = [];
  let notConfigured = false;
  let lastError: string | null = null;
  let wavesRun = 0;
  let coverage: PartCoverage[] = assessCoverage(parts, records, db);
  // every part covered → stop searching (the day count never asks for more techniques)
  const done = (cov: PartCoverage[]) => cov.every((c) => c.covered);

  async function extract(batch: LedgerSource[]): Promise<void> {
    const block = batch
      .map((s, i) => `[${i + 1}] title: ${s.title}\nurl: ${s.url}\ncontent: ${s.text.trim() ? s.text.slice(0, SOURCE_CHARS) : '(내용 없음 — 제목만 근거로 쓸 수 있음)'}`)
      .join('\n\n');
    const req: AskAiRequest = {
      systemInstruction: `반드시 JSON만 출력한다(설명 문장, 코드 펜스 금지).\n\n${extractionInstruction(input.artScope, parts)}`,
      contextText: `${input.contextLines.join('\n')}\n\n=== 실제 검색 결과 자료 ===\n${block}`,
      history: [],
      question: '위 자료에서 실제로 언급된 기술만 단계별로 추출해줘. 자료에 없는 기술은 지어내지 마라.',
      temperature: 0.2,
      maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    };
    let attempt = 0;
    for (;;) {
      diag.extraction.calls++;
      const res = await deps.ask(req);
      const parsed = res.ok ? parseExtraction(res.text, batch, parts) : null;
      if (parsed?.ok) {
        for (const s of batch) s.state = 'analyzed';
        diag.analyzedSourceCount += batch.length;
        for (const it of parsed.items) {
          const part = parts.find((p) => p.id === it.partId)!;
          const src = ledger.get(canonicalUrl(it.sourceUrl))!;
          const quoteVerified = quoteFoundInSource(it.quote, `${src.title} ${src.text.slice(0, SOURCE_CHARS)}`);
          const j = judgeRelevance({ part, techniqueName: it.name, quote: it.quote, appliesWhen: it.appliesWhen, sourceTitle: src.title, intentGuess: it.intentGuess, modelFit: it.fit, quoteVerified });
          records.push({
            techniqueName: it.name,
            subGoalId: part.id,
            sourceKey: src.key,
            sourceUrl: src.url,
            sourceTitle: src.title,
            sourceKind: src.kind,
            quote: it.quote,
            quoteVerified,
            appliesWhen: it.appliesWhen,
            intentGuess: it.intentGuess,
            purpose: it.purpose,
            martialArtGuess: it.martialArtGuess,
            modelFit: it.fit,
            confidence: it.confidence,
            dims: j.dims,
            verdict: j.verdict,
            reasons: j.reasons,
          });
        }
        log('CURRICULUM_EXTRACTION', { sources: batch.length, items: parsed.items.length, dropped: parsed.dropped, retry: attempt });
        return;
      }
      const code = res.ok ? 'PARSE_ERROR' : res.code;
      diag.extraction.lastErrorCode = code;
      diag.extraction.lastErrorDetail = res.ok ? (parsed && !parsed.ok ? parsed.detail : null) : res.message;
      log('CURRICULUM_EXTRACTION', { sources: batch.length, status: 'failed', code, detail: diag.extraction.lastErrorDetail ?? '', retry: attempt });
      if (attempt >= 1 || NOT_RETRYABLE.has(code)) {
        for (const s of batch) s.state = 'failed';
        diag.extraction.failedBatches++;
        diag.extraction.failedSourceCount += batch.length;
        return;
      }
      attempt++;
      diag.extraction.retries++;
    }
  }

  for (let wave = 0; wave < MAX_WAVES; wave++) {
    const open = coverage.filter((c) => !c.covered).map((c) => parts.find((p) => p.id === c.id)!);
    // parts still needing evidence (core first); once all parts are covered only the total can still be short
    const targets = open.length > 0 ? open.sort((a, b) => Number(a.role !== 'core') - Number(b.role !== 'core')) : parts;
    const lists = targets.map((p) => ({ p, qs: queriesForPart(p, wave, parts.length === 1 ? input.firstWaveQueries : null).filter((q) => !executed.includes(q)) }));
    const chosen: { q: string; p: SubGoal }[] = [];
    for (let i = 0; chosen.length < MAX_QUERIES_PER_WAVE && lists.some((l) => l.qs.length > i); i++) {
      for (const l of lists) if (l.qs[i] && chosen.length < MAX_QUERIES_PER_WAVE) chosen.push({ q: l.qs[i], p: l.p });
    }
    const pendingBefore = [...ledger.values()].some((s) => s.state === 'pending');
    if (chosen.length === 0 && !pendingBefore) break;

    for (const { q, p } of chosen) {
      diag.searchAttempted = true;
      diag.tavilyCalls++;
      const outcome = await deps.search(q);
      if (!outcome.ok) {
        diag.queries.push({ query: q, subGoalId: p.id, ok: false, resultCount: 0, newSourceCount: 0 });
        log('CURRICULUM_RESEARCH', { query: q, part: p.id, status: 'failed', code: outcome.code });
        if (outcome.code === 'NO_API_KEY') {
          notConfigured = true;
          break;
        }
        lastError = outcome.message;
        continue;
      }
      diag.searchSucceeded = true;
      executed.push(q);
      diag.rawResultCount += outcome.results.length;
      let fresh = 0;
      for (const r of outcome.results) {
        const key = canonicalUrl(r.url);
        const seen = ledger.get(key);
        if (seen) {
          if (!seen.partIds.includes(p.id)) seen.partIds.push(p.id);
          continue;
        }
        const text = r.content ?? r.snippet ?? '';
        ledger.set(key, { key, url: r.url, title: r.title ?? '', text, hasContent: text.trim().length >= 200, kind: sourceKind(r.url), partIds: [p.id], state: 'pending' });
        fresh++;
      }
      diag.queries.push({ query: q, subGoalId: p.id, ok: true, resultCount: outcome.results.length, newSourceCount: fresh });
      log('CURRICULUM_RESEARCH', { query: q, part: p.id, results: outcome.results.length, newSources: fresh, status: 'success' });
    }
    if (notConfigured) break;
    wavesRun++;

    // pages with real text first; at most one batch per wave, the rest wait for the next wave (never dropped)
    const pending = [...ledger.values()].filter((s) => s.state === 'pending').sort((a, b) => Number(b.hasContent) - Number(a.hasContent));
    if (pending.length > 0) await extract(pending.slice(0, MAX_SOURCES_PER_EXTRACTION));
    coverage = assessCoverage(parts, records, db);
    log('CURRICULUM_COVERAGE', { wave, ...Object.fromEntries(coverage.map((c) => [c.id, `${c.covered ? 'covered' : 'open'} t=${c.techniques.length} s=${c.independentSourceCount}`])) });
    if (done(coverage)) break;
  }

  // a final pass over pages that arrived in the last wave but did not fit its batch — no new searches
  const leftover = [...ledger.values()].filter((s) => s.state === 'pending');
  if (!done(coverage) && leftover.length > 0 && diag.searchSucceeded) {
    await extract(leftover.slice(0, MAX_SOURCES_PER_EXTRACTION));
    coverage = assessCoverage(parts, records, db);
  }

  const sources = [...ledger.values()];
  diag.uniqueSourceCount = sources.length;
  diag.sourcesWithContent = sources.filter((s) => s.hasContent).length;
  for (const s of sources) diag.sourceKinds[s.kind]++;
  diag.candidateRecords = records.length;
  diag.relevantRecords = records.filter((r) => r.verdict === 'relevant' && r.confidence >= 50).length;
  diag.reviewRecords = records.filter((r) => r.verdict === 'uncertain').length;
  diag.irrelevantRecords = records.filter((r) => r.verdict === 'irrelevant').length;
  diag.lowConfidenceRecords = records.filter((r) => r.verdict === 'relevant' && r.confidence < 50).length;
  diag.parts = coverage;

  if (notConfigured || !diag.searchAttempted) return { kind: 'not_configured', diagnostics: diag };
  if (!diag.searchSucceeded) {
    diag.stopReason = 'SEARCH_FAILED';
    return { kind: 'all_failed', errorMessage: lastError ?? '검색 결과가 없습니다.', diagnostics: diag };
  }

  // relevant techniques per part, sources merged (one entry per technique per part)
  const toTechniques = (partIds: Set<string>): WebEvidenceTechnique[] => {
    const out: WebEvidenceTechnique[] = [];
    for (const c of coverage) {
      if (!partIds.has(c.id)) continue;
      for (const t of c.techniques) {
        const recs = records.filter((r) => r.subGoalId === c.id && r.verdict === 'relevant' && t.sources.includes(r.sourceKey) && r.confidence >= 50);
        const first = recs.find((r) => r.techniqueName === t.name) ?? recs[0];
        if (!first) continue;
        out.push({
          name: t.name,
          martialArtGuess: first.martialArtGuess,
          purpose: first.purpose,
          intentGuess: first.intentGuess,
          partId: c.id,
          sourceUrls: [...new Set(recs.map((r) => r.sourceUrl))],
          sourceTitles: [...new Set(recs.map((r) => r.sourceTitle))],
          sourceKinds: [...new Set(recs.map((r) => r.sourceKind))],
          evidence: first.quote,
          confidence: Math.max(...recs.map((r) => r.confidence)),
        });
      }
    }
    return out;
  };
  const partLabel = (id: string) => parts.find((p) => p.id === id)?.label ?? id;
  const review: ReviewItem[] = records.filter((r) => r.verdict === 'uncertain').map((r) => ({ name: r.techniqueName, partId: r.subGoalId, partLabel: partLabel(r.subGoalId), url: r.sourceUrl, reasons: r.reasons }));
  const excludedMap = new Map<string, { name: string; reason: string }>();
  for (const r of records) {
    if (r.verdict === 'irrelevant') excludedMap.set(`${r.techniqueName}|${r.subGoalId}`, { name: r.techniqueName, reason: `[${partLabel(r.subGoalId)}] ${r.reasons.join(' · ')}` });
    else if (r.verdict === 'relevant' && r.confidence < 50) excludedMap.set(`${r.techniqueName}|${r.subGoalId}`, { name: r.techniqueName, reason: `근거가 충분하지 않아 확정할 수 없음(confidence ${r.confidence})` });
  }
  const excluded = [...excludedMap.values()];
  const rawCount = new Set(records.map((r) => `${r.techniqueName.toLowerCase()}|${r.subGoalId}`)).size;
  const allIds = new Set(parts.map((p) => p.id));
  const relevantAll = toTechniques(allIds);

  const coreIds = coverage.filter((c) => c.role === 'core').map((c) => c.id);
  const coresCovered = coverage.filter((c) => c.role === 'core').every((c) => c.covered);
  const coveredIds = new Set(coverage.filter((c) => c.covered).map((c) => c.id));
  const base = { relevantAll, excluded, review, rawCount, parts, coverage, executedQueries: executed, wavesRun, diagnostics: diag };

  const stopWith = (reason: ResearchStopReason) => {
    diag.stopReason = reason;
    log('CURRICULUM_STOP', { reason, uniqueSources: diag.uniqueSourceCount, relevant: diag.relevantRecords, failedExtractionSources: diag.extraction.failedSourceCount });
    return { kind: 'done' as const, mode: 'insufficient_web_evidence' as const, techniques: relevantAll, partial: null, ...base };
  };

  if (!coresCovered) {
    if (diag.uniqueSourceCount === 0) return stopWith('NO_RESULTS');
    // pages the extractor could not read are not "missing evidence" — say so instead of blaming the evidence
    if (diag.extraction.failedSourceCount > 0) return stopWith('EXTRACTION_FAILED');
    const coreRelevant = coverage.filter((c) => coreIds.includes(c.id)).reduce((n, c) => n + c.techniques.length, 0);
    // nothing could even be extracted and the pages had no text (title-only videos / social posts)
    if (coreRelevant === 0 && diag.candidateRecords === 0 && diag.sourcesWithContent === 0) return stopWith('LOW_SOURCE_QUALITY');
    if (coreRelevant === 0) return stopWith('NO_RELEVANT_RESULTS');
    return stopWith('CORE_GOAL_UNVERIFIED');
  }
  const uncovered = coverage.filter((c) => !c.covered);
  const partial = uncovered.length > 0 ? { includedIds: [...coveredIds], excluded: uncovered.map((c) => ({ id: c.id, label: c.label, reason: `${c.reason ?? ''}${diag.extraction.failedSourceCount > 0 ? ' (일부 자료는 분석 단계 오류로 확인하지 못함)' : ''}` })) } : null;
  return { kind: 'done', mode: 'web_search', techniques: toTechniques(coveredIds), partial, ...base };
}
