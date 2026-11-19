// Client for the user's own SearXNG instance (services/searxng/run.sh).
// The URL comes from SEARXNG_URL (default http://127.0.0.1:8888). No API key.
// Engines that refuse automated access (CAPTCHA / access denied) are disabled
// in services/searxng/settings.yml — this client never retries around them.

const DEFAULT_URL = 'http://127.0.0.1:8888';
const TIMEOUT_MS = 12000;

// Which SearXNG engines serve which kind of search (measured 2026-10-31,
// data/audit/self-ai/searxng-engines-*.json). Empty list = instance defaults.
const KIND_ENGINES = {
  web: ['bing', 'yahoo', 'naver', 'brave', 'wikipedia'],
  video: ['youtube', 'bing videos', 'dailymotion'],
  paper: ['crossref', 'arxiv', 'semantic scholar', 'openalex'],
};

function baseUrl() {
  const u = (process.env.SEARXNG_URL || '').trim();
  return /^https?:\/\/[\w.\-:[\]]+(\/[\w.\-/]*)?$/.test(u) ? u.replace(/\/+$/, '') : DEFAULT_URL;
}

async function status() {
  try {
    const r = await fetch(`${baseUrl()}/healthz`, { signal: AbortSignal.timeout(2500) });
    return { ok: r.ok, url: baseUrl() };
  } catch {
    return { ok: false, url: baseUrl() };
  }
}

/**
 * → { ok:true, results:[{title,url,snippet,publishedAt,engines,position,thumbnail,category}], unresponsive:[[engine,reason]] }
 *   { ok:false, code:'NOT_RUNNING'|'TIMEOUT'|'BAD_RESPONSE', message }
 */
async function searxSearch(query, { kind = 'web', language = 'auto', pageno = 1 } = {}) {
  const params = new URLSearchParams({ q: query, format: 'json', pageno: String(pageno), language });
  const engines = KIND_ENGINES[kind] || [];
  if (engines.length) params.set('engines', engines.join(','));
  if (kind === 'video') params.set('categories', 'videos');
  if (kind === 'paper') params.set('categories', 'science');
  let res;
  try {
    res = await fetch(`${baseUrl()}/search?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      code: timeout ? 'TIMEOUT' : 'NOT_RUNNING',
      message: timeout ? '자체 검색 서버 응답이 너무 늦습니다.' : '자체 검색 서버(SearXNG)가 실행 중이 아닙니다.',
    };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !json || !Array.isArray(json.results)) {
    return { ok: false, code: 'BAD_RESPONSE', message: `자체 검색 서버 응답 오류 (${res.status})` };
  }
  const results = json.results
    .filter((r) => r && typeof r.url === 'string' && typeof r.title === 'string')
    .map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: typeof r.content === 'string' ? r.content : undefined,
      publishedAt: r.publishedDate || r.pubdate || undefined,
      engines: Array.isArray(r.engines) ? r.engines : r.engine ? [r.engine] : [],
      position: i,
      thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : undefined,
      category: r.category,
      // video engines: channel / duration; science engines: bibliographic fields (kept as given, never filled in)
      author: typeof r.author === 'string' && r.author.trim() ? r.author.trim() : undefined,
      length: typeof r.length === 'string' && r.length.trim() ? r.length.trim() : undefined,
      doi: typeof r.doi === 'string' && r.doi.trim() ? r.doi.trim() : undefined,
      authors: Array.isArray(r.authors) ? r.authors.filter((a) => typeof a === 'string' && a.trim()).slice(0, 12) : undefined,
      journal: typeof r.journal === 'string' && r.journal.trim() ? r.journal.trim() : undefined,
      publisher: typeof r.publisher === 'string' && r.publisher.trim() ? r.publisher.trim() : undefined,
      pdfUrl: typeof r.pdf_url === 'string' && /^https?:/.test(r.pdf_url) ? r.pdf_url : undefined,
    }));
  return { ok: true, results, unresponsive: Array.isArray(json.unresponsive_engines) ? json.unresponsive_engines : [] };
}

module.exports = { searxSearch, status, baseUrl, KIND_ENGINES };
