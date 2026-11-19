// MARTIALDEX self-hosted research pipeline (Electron main process).
//
//   queries ─▶ SearXNG (web / video / paper) ─▶ dedup ─▶ rank ─▶ extract top pages
//           ─▶ label (source type, stated date, reliability + reasons) ─▶ diagnostics
//
// Every result keeps its original URL. Nothing is summarised here — the
// coach/LLM layer receives the extracted text and must cite these URLs.
// Failures are returned as failures (never an empty "success" that looks
// like "nothing exists on the web").

const crypto = require('node:crypto');
const { searxSearch, status: searxStatus } = require('./searxng.cjs');
const { extractPage } = require('./extract.cjs');
const { youtubeId, youtubeEmbedStatus, doiOf, doiStatus } = require('./media.cjs');
const { dedupResults, rankResults, sourceTypeOf, assessReliability, hostOf, queryOverlap, tokens, titleUrlMismatch, normalizeUrl } = require('./core.cjs');

// 10차: the app — not the model — names each source: a stable id from its normalized URL (same page = same id
// across searches and caches), kept with the result so answers, claims and the source list point at real records.
const sourceIdOf = (url) => `src-${crypto.createHash('sha1').update(normalizeUrl(url) || url).digest('hex').slice(0, 10)}`;

const MAX_QUERIES = 4;
const DEFAULT_EXTRACT = 4;
const EXTRACT_CONCURRENCY = 2;
const MAX_CONTENT_CHARS = 4000; // matches the legacy webSearch.cjs contract
// A result must share at least this share of words with one of the queries
// (engines return unrelated pages for broad Korean queries, e.g. 논문 search).
const MIN_QUERY_OVERLAP = 0.34;
const ACADEMIC_GENERIC = new Set(['sports', 'sport', 'science', 'sciences', 'athletes', 'athlete', 'study', 'studies', 'effects', 'effect', 'review', 'training', 'performance', 'analysis', '스포츠', '과학', '논문', '연구', '선수', '분석']);

function detectKind(q) {
  if (/(영상|동영상|비디오|유튜브|하이라이트|video|youtube|highlight|footage)/i.test(q)) return 'video';
  if (/(논문|연구|학술|저널|study|paper|journal|research)/i.test(q)) return 'paper';
  return 'web';
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

/**
 * research({ query, queries?, kind?, maxResults?, extractTop? })
 * → { ok:true, kind, results:[...], diagnostics } | { ok:false, code, message, diagnostics }
 */
async function research(input) {
  const base = typeof input === 'string' ? { query: input } : input || {};
  const queries = [...new Set([base.query, ...(Array.isArray(base.queries) ? base.queries : [])].filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim().slice(0, 300)))].slice(0, MAX_QUERIES);
  if (!queries.length) return { ok: false, code: 'EMPTY', message: '검색어가 비어 있습니다.', diagnostics: {} };
  const kind = ['web', 'video', 'paper'].includes(base.kind) ? base.kind : detectKind(queries[0]);
  const maxResults = Math.min(Math.max(Number(base.maxResults) || 8, 1), 20);
  const extractTop = kind === 'video' ? 0 : Math.min(Math.max(base.extractTop ?? DEFAULT_EXTRACT, 0), 8);

  const diagnostics = { backend: 'searxng', kind, queries, rawCount: 0, duplicatesRemoved: 0, failedEngines: [], failedQueries: [], extraction: {} };
  const raw = [];
  // queries run in parallel (one slow engine used to add its timeout once per query)
  const responses = await Promise.all(queries.map((q) => searxSearch(q, { kind })));
  for (const [qi, q] of queries.entries()) {
    const r = responses[qi];
    if (!r.ok) {
      diagnostics.failedQueries.push({ query: q, code: r.code, message: r.message });
      continue;
    }
    raw.push(...r.results);
    for (const [engine, reason] of r.unresponsive) {
      if (!diagnostics.failedEngines.some((e) => e.engine === engine)) diagnostics.failedEngines.push({ engine, reason });
    }
  }
  diagnostics.rawCount = raw.length;
  if (!raw.length) {
    const notRunning = diagnostics.failedQueries.find((f) => f.code === 'NOT_RUNNING');
    if (notRunning) return { ok: false, code: 'NOT_RUNNING', message: notRunning.message, diagnostics };
    if (diagnostics.failedQueries.length === queries.length) return { ok: false, code: 'SEARCH_FAILED', message: '모든 검색 요청이 실패했습니다.', diagnostics };
    // engines answered but found nothing — an honest empty result
    return { ok: true, kind, results: [], diagnostics };
  }

  const { results: dedupedAll, dropped } = dedupResults(raw);
  diagnostics.duplicatesRemoved = dropped;
  // title ≠ the page the URL opens (위키 대문 with an article title …) — removed, and counted
  const mismatched = [];
  const deduped = dedupedAll.filter((r) => {
    const why = titleUrlMismatch(r.url, r.title);
    if (why) mismatched.push({ title: r.title, url: r.url, reason: why });
    return !why;
  });
  diagnostics.titleUrlMismatch = mismatched.slice(0, 5);
  diagnostics.titleUrlMismatchRemoved = mismatched.length;
  // Papers are judged on the query's TOPIC words ("grappling"), not the field words every
  // paper index result shares ("sports science", "athletes", "study"): a grappling-injury
  // paper used to fall under the floor for not also saying "science", and a sleep study
  // passed it for saying "sports science".
  const topicQuery = (q) => tokens(q).filter((w) => !ACADEMIC_GENERIC.has(w)).join(' ');
  const overlapOf = (r) => Math.max(...queries.map((q) => queryOverlap(kind === 'paper' && topicQuery(q) ? topicQuery(q) : q, r.title, r.snippet)));
  let relevant = deduped.filter((r) => overlapOf(r) >= MIN_QUERY_OVERLAP);
  // what the relevance floor removed, so "nothing found" can say "found N, none on topic"
  diagnostics.removedTitles = deduped.filter((r) => !relevant.includes(r)).slice(0, 3).map((r) => r.title);
  diagnostics.irrelevantRemoved = deduped.length - relevant.length;
  if (kind === 'paper') {
    // the same paper is listed by several indexes (doi.org, publisher, pubmed …) — same DOI or same title = same paper
    const seen = new Set();
    const before = relevant.length;
    relevant = relevant.filter((r) => {
      const keys = [`t:${tokens(r.title).join(' ')}`, ...(doiOf(r) ? [`d:${doiOf(r).toLowerCase()}`] : [])];
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
    diagnostics.duplicatesRemoved += before - relevant.length;
  }
  let ranked = rankResults(queries.join(' '), relevant);
  // "최근 …": newest first among the relevant ones (undated last — a date is never guessed)
  if (base.recent) ranked = [...ranked].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  ranked = ranked.slice(0, maxResults);

  // Video: YouTube id + embed permission (oEmbed). Paper: DOI checked at doi.org. In parallel, bounded.
  const media = await mapLimit(ranked, 4, async (r) => {
    if (kind === 'video') {
      const id = youtubeId(r.url);
      return id ? { videoId: id, ...(await youtubeEmbedStatus(id)) } : null;
    }
    if (kind === 'paper') {
      const doi = doiOf(r);
      return doi ? { doi, doiStatus: await doiStatus(doi) } : null;
    }
    return null;
  });

  // Extract the top `extractTop` results that are readable pages (videos and PDFs are skipped, not counted).
  // 조건이 있으면 제목·요약이 그 말을 담은 결과부터 읽는다 (사양 §6) — 조건에 맞는 게 없으면 기존대로 상위 N건
  const requireTerms = (base.requireTerms || []).filter((t) => typeof t === 'string' && t.trim().length > 1);
  const readable = ranked
    .map((r, idx) => ({ idx, r, skip: sourceTypeOf(r.url).type === 'video' || /\.pdf($|\?)/i.test(r.url) }))
    .filter((x) => !x.skip);
  const wanted = requireTerms.length ? readable.filter((x) => requireTerms.some((t) => `${x.r.title || ''} ${x.r.snippet || ''}`.toLowerCase().includes(t.toLowerCase()))) : [];
  const extractable = new Set((wanted.length ? wanted : readable).slice(0, extractTop).map((x) => x.idx));
  const extracted = await mapLimit(ranked, EXTRACT_CONCURRENCY, async (r, idx) => (extractable.has(idx) ? extractPage(r.url) : { status: 'not_attempted' }));

  const fetchedAt = new Date().toISOString();
  const results = ranked.map((r, idx) => {
    const ex = extracted[idx] || { status: 'not_attempted' };
    diagnostics.extraction[ex.status] = (diagnostics.extraction[ex.status] || 0) + 1;
    const st = sourceTypeOf(r.url);
    const publishedAt = r.publishedAt || ex.publishedAt;
    const reliability = assessReliability({
      sourceType: st.type,
      engineCount: r.engines.length,
      extractionStatus: ex.status === 'not_attempted' && st.type === 'video' ? 'ok' : ex.status,
      publishedAt,
    });
    return {
      sourceId: sourceIdOf(r.url),
      fetchedAt,
      title: kind === 'video' ? r.title.replace(/\s+-\s+YouTube$/i, '') : r.title,
      url: r.url,
      snippet: r.snippet ? r.snippet.slice(0, MAX_CONTENT_CHARS) : undefined,
      content: ex.status === 'ok' ? ex.text.slice(0, MAX_CONTENT_CHARS) : undefined,
      source: hostOf(r.url),
      publishedAt,
      publishedAtSource: r.publishedAt ? 'search_engine' : ex.publishedAt ? 'page_metadata' : undefined,
      engines: r.engines,
      relevance: r.relevance,
      sourceType: st.type,
      sourceTypeLabel: st.label,
      reliability,
      extraction: { status: ex.status, reason: ex.reason, chars: ex.chars, method: ex.method },
      thumbnail: r.thumbnail,
      ...(kind === 'video' ? { video: videoInfo(r, media[idx]) } : {}),
      ...(kind === 'paper' ? { paper: paperInfo(r, media[idx], publishedAt) } : {}),
    };
  });
  return { ok: true, kind, results, diagnostics };
}

function videoInfo(r, m) {
  return {
    platform: m && m.videoId ? 'youtube' : 'other',
    videoId: m && m.videoId ? m.videoId : undefined,
    channel: r.author || (m && m.channel) || undefined,
    duration: r.length || undefined,
    // i.ytimg.com is the only thumbnail host the app's CSP allows (search engines' image proxies are not)
    thumbnail: m && m.videoId ? `https://i.ytimg.com/vi/${m.videoId}/hqdefault.jpg` : undefined,
    embed: m && m.videoId ? m.embed : 'not_supported',
  };
}

function paperInfo(r, m, publishedAt) {
  return {
    doi: m && m.doi ? m.doi : undefined,
    doiUrl: m && m.doi ? `https://doi.org/${m.doi}` : undefined,
    doiStatus: m && m.doi ? m.doiStatus : undefined,
    authors: r.authors && r.authors.length ? r.authors : undefined,
    journal: r.journal || undefined,
    publisher: r.publisher || undefined,
    year: publishedAt ? Number(String(publishedAt).slice(0, 4)) || undefined : undefined,
    // the index's abstract / summary, as given (the paper itself is not read)
    abstract: r.snippet ? r.snippet.slice(0, 600) : undefined,
    pdfUrl: r.pdfUrl || undefined,
  };
}

/** Legacy contract of electron/webSearch.cjs → { ok, results:[{title,url,snippet,content,source,publishedAt}] } */
async function selfWebSearch(query) {
  const r = await research({ query, kind: 'web' });
  if (!r.ok) return { ok: false, code: r.code === 'NOT_RUNNING' ? 'NETWORK' : 'UNKNOWN', message: r.message };
  return {
    ok: true,
    results: r.results.map(({ title, url, snippet, content, source, publishedAt }) => ({ title, url, snippet, content, source, publishedAt })),
  };
}

module.exports = { research, selfWebSearch, searxStatus, detectKind };
