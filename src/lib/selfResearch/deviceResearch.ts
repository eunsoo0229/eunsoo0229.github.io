// On-device research (Android app) — the same pipeline as electron/selfSearch/index.cjs, without a
// SearXNG server: the phone queries the public sources itself through Capacitor's native HTTP (no
// CORS, the phone's own network). No API key, no paid service, no MARTIALDEX server in between.
//
//   web   : Bing + DuckDuckGo result pages, Wikipedia search API
//   video : YouTube's search-results page (ytInitialData), embed permission from YouTube oEmbed
//   paper : Crossref, OpenAlex, arXiv APIs; DOI checked at doi.org
//   pages : robots.txt honoured, CAPTCHA / 401 / 403 / 429 reported as `blocked`, Readability text
//
// Same request / result contract (ResearchOutcome); an engine that fails is reported in
// diagnostics.failedEngines, never retried around. The ON/OFF choice is kept on this device.

import { dedupResults, rankResults, sourceTypeOf, assessReliability, hostOf, queryOverlap, tokens, titleUrlMismatch, toIsoDate, detectKind, youtubeId, doiOf, sourceIdOf, CAPTCHA_MARKERS, type RawResult, type DedupedResult } from './researchCore';
import type { ExtractionStatus, PaperInfo, PersonName, ResearchKind, ResearchOutcome, ResearchRequest, ResearchResult, VideoInfo, ResearchDiagnostics } from './types';

export interface HttpResponse {
  status: number;
  /** lower-case header names */
  headers: Record<string, string>;
  text: string;
}
export interface DeviceHttp {
  request(url: string, opts: { headers?: Record<string, string>; timeoutMs: number; method?: 'GET' | 'HEAD'; noRedirect?: boolean }): Promise<HttpResponse>;
}
export interface DeviceResearchDeps {
  http: DeviceHttp;
  /** HTML / XML → Document (DOMParser in the WebView). */
  parse: (text: string, type: 'text/html' | 'text/xml') => Document;
  /** Mozilla Readability, loaded on first page extraction. */
  readability: () => Promise<new (doc: Document, opts?: { charThreshold?: number }) => { parse(): { textContent?: string | null; title?: string | null; byline?: string | null; siteName?: string | null; publishedTime?: string | null } | null }>;
}

const MAX_QUERIES = 4;
const DEFAULT_EXTRACT = 4;
const EXTRACT_CONCURRENCY = 2;
const MAX_CONTENT_CHARS = 4000;
const MIN_QUERY_OVERLAP = 0.34;
const ENGINE_TIMEOUT = 12000;
const PAGE_TIMEOUT = 10000;
const MAX_TEXT = 12000;
const MAX_BYTES = 2_000_000;
const ACADEMIC_GENERIC = new Set(['sports', 'sport', 'science', 'sciences', 'athletes', 'athlete', 'study', 'studies', 'effects', 'effect', 'review', 'training', 'performance', 'analysis', '스포츠', '과학', '논문', '연구', '선수', '분석']);

// search pages answer a browser; APIs and page reads say who is asking
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BOT_UA = 'Mozilla/5.0 (compatible; MARTIALDEX-Research/0.1; +on-device study assistant)';

const hasHangul = (s: string) => /[가-힣]/.test(s);
const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

type EngineResult = { ok: true; results: RawResult[] } | { ok: false; reason: string };
type Engine = { name: string; run: (deps: DeviceResearchDeps, q: string) => Promise<EngineResult> };

async function getText(deps: DeviceResearchDeps, url: string, headers: Record<string, string>): Promise<HttpResponse | { error: string }> {
  try {
    return await deps.http.request(url, { headers, timeoutMs: ENGINE_TIMEOUT });
  } catch (err) {
    return { error: err instanceof Error && /time/i.test(err.message) ? '시간 초과' : '연결 실패' };
  }
}

async function getJson(deps: DeviceResearchDeps, url: string): Promise<{ ok: true; json: any } | { ok: false; reason: string }> {
  const r = await getText(deps, url, { 'User-Agent': BOT_UA, Accept: 'application/json' });
  if ('error' in r) return { ok: false, reason: r.error };
  if (r.status !== 200) return { ok: false, reason: `HTTP ${r.status}` };
  try {
    return { ok: true, json: JSON.parse(r.text) };
  } catch {
    return { ok: false, reason: '응답 해석 실패' };
  }
}

/** A result page that answered with a bot wall instead of results. */
function walled(r: HttpResponse): string | null {
  if ([401, 403, 429, 503].includes(r.status)) return `HTTP ${r.status} (자동 접근 차단)`;
  if (r.status !== 200) return `HTTP ${r.status}`;
  return null;
}

function bingTarget(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://www.bing.com');
    if (/(^|\.)bing\.com$/.test(u.hostname)) {
      const p = u.pathname.startsWith('/ck/a') ? u.searchParams.get('u') : null;
      if (!p || !p.startsWith('a1')) return null;
      const b = p.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      return atob(b.padEnd(Math.ceil(b.length / 4) * 4, '='));
    }
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const bing: Engine = {
  name: 'bing',
  async run(deps, q) {
    // market cookies + pq as SearXNG's bing engine sends them — without them Bing answers a script with
    // unrelated pages (measured 2026-11-07: store-finder results for "muay thai clinch technique")
    const mkt = hasHangul(q) ? 'ko-kr' : 'en-us';
    const r = await getText(deps, `https://www.bing.com/search?q=${encodeURIComponent(q)}&pq=${encodeURIComponent(q)}`, { 'User-Agent': BROWSER_UA, 'Accept-Language': hasHangul(q) ? 'ko,en;q=0.8' : 'en-US,en;q=0.8', Accept: 'text/html', Cookie: `_EDGE_CD=m=${mkt}&u=${mkt}; _EDGE_S=mkt=${mkt}&ui=${mkt}` });
    if ('error' in r) return { ok: false, reason: r.error };
    const wall = walled(r);
    if (wall) return { ok: false, reason: wall };
    const doc = deps.parse(r.text, 'text/html');
    const results: RawResult[] = [];
    doc.querySelectorAll('li.b_algo').forEach((li) => {
      const a = li.querySelector('h2 a');
      const url = bingTarget(a?.getAttribute('href') ?? null);
      const title = a?.textContent?.trim();
      if (!url || !title) return;
      const snippet = li.querySelector('.b_caption p, p')?.textContent?.trim() || undefined;
      results.push({ title, url, snippet, engines: ['bing'], position: results.length });
    });
    if (!results.length && CAPTCHA_MARKERS.test(r.text.slice(0, 30000))) return { ok: false, reason: '봇 확인/CAPTCHA 페이지' };
    return { ok: true, results };
  },
};

const duckduckgo: Engine = {
  name: 'duckduckgo',
  async run(deps, q) {
    const r = await getText(deps, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}${hasHangul(q) ? '&kl=kr-kr' : ''}`, { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ko,en;q=0.8', Accept: 'text/html' });
    if ('error' in r) return { ok: false, reason: r.error };
    const wall = walled(r);
    if (wall) return { ok: false, reason: wall };
    const doc = deps.parse(r.text, 'text/html');
    const results: RawResult[] = [];
    doc.querySelectorAll('.result').forEach((el) => {
      if (el.classList.contains('result--ad')) return;
      const a = el.querySelector('a.result__a');
      const href = a?.getAttribute('href') ?? '';
      let url: string | null = null;
      try {
        const u = new URL(href, 'https://duckduckgo.com');
        url = u.searchParams.get('uddg') || (/^https?:$/.test(u.protocol) && !/duckduckgo\.com$/.test(u.hostname) ? u.href : null);
      } catch {
        url = null;
      }
      const title = a?.textContent?.trim();
      if (!url || !title) return;
      results.push({ title, url, snippet: el.querySelector('.result__snippet')?.textContent?.trim() || undefined, engines: ['duckduckgo'], position: results.length });
    });
    // DuckDuckGo answers automated requests with an "anomaly" challenge page (HTTP 200, no results)
    if (!results.length && /anomaly|challenge/i.test(r.text.slice(0, 30000))) return { ok: false, reason: '봇 확인 페이지' };
    return { ok: true, results };
  },
};

const wikipedia: Engine = {
  name: 'wikipedia',
  async run(deps, q) {
    const lang = hasHangul(q) ? 'ko' : 'en';
    const j = await getJson(deps, `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&srprop=snippet&format=json&utf8=1`);
    if (!j.ok) return j;
    const hits = (j.json?.query?.search ?? []) as { title: string; snippet?: string }[];
    return {
      ok: true,
      results: hits.map((h, i) => ({
        title: lang === 'ko' ? `${h.title} - 위키백과` : `${h.title} - Wikipedia`,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
        snippet: h.snippet ? stripTags(h.snippet) : undefined,
        engines: ['wikipedia'],
        position: i,
      })),
    };
  },
};

function findVideoRenderers(node: unknown, out: any[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.videoRenderer) out.push(n.videoRenderer);
  for (const key in n) if (key !== 'videoRenderer') findVideoRenderers(n[key], out);
}

const youtube: Engine = {
  name: 'youtube',
  async run(deps, q) {
    const r = await getText(deps, `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ko,en;q=0.8' });
    if ('error' in r) return { ok: false, reason: r.error };
    const wall = walled(r);
    if (wall) return { ok: false, reason: wall };
    const m = r.text.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (!m) return { ok: false, reason: '검색 결과를 해석하지 못함' };
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      return { ok: false, reason: '검색 결과를 해석하지 못함' };
    }
    const renderers: any[] = [];
    findVideoRenderers(data, renderers);
    const runs = (x: any): string => (x?.runs ?? []).map((t: any) => t?.text ?? '').join('').trim();
    return {
      ok: true,
      results: renderers
        .filter((v) => v?.videoId && runs(v.title))
        .slice(0, 15)
        .map((v, i) => ({
          title: runs(v.title),
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          snippet: runs(v.detailedMetadataSnippets?.[0]?.snippetText) || runs(v.descriptionSnippet) || undefined,
          author: runs(v.ownerText) || runs(v.longBylineText) || undefined,
          length: v.lengthText?.simpleText || undefined,
          engines: ['youtube'],
          position: i,
          category: 'videos',
        })),
    };
  },
};

const crossref: Engine = {
  name: 'crossref',
  async run(deps, q) {
    const j = await getJson(deps, `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=10&select=DOI,title,author,container-title,publisher,issued,abstract`);
    if (!j.ok) return j;
    const items = (j.json?.message?.items ?? []) as any[];
    return {
      ok: true,
      results: items
        .filter((it) => it?.DOI && it?.title?.[0])
        .map((it, i) => {
          const dp: number[] = it.issued?.['date-parts']?.[0] ?? [];
          return {
            title: stripTags(String(it.title[0])),
            url: `https://doi.org/${it.DOI}`,
            snippet: it.abstract ? stripTags(String(it.abstract)) : undefined,
            // a full date only when the index gives one; a bare year stays a year
            publishedAt: dp.length === 3 ? `${dp[0]}-${String(dp[1]).padStart(2, '0')}-${String(dp[2]).padStart(2, '0')}` : undefined,
            year: dp[0] || undefined,
            doi: it.DOI,
            authors: (it.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 12),
            journal: it['container-title']?.[0] || undefined,
            publisher: it.publisher || undefined,
            engines: ['crossref'],
            position: i,
          };
        }),
    };
  },
};

const openalex: Engine = {
  name: 'openalex',
  async run(deps, q) {
    const j = await getJson(deps, `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=10`);
    if (!j.ok) return j;
    const items = (j.json?.results ?? []) as any[];
    const abstractOf = (inv: Record<string, number[]> | null | undefined) => {
      if (!inv) return undefined;
      const words: string[] = [];
      for (const [w, at] of Object.entries(inv)) for (const p of at) words[p] = w;
      return words.filter(Boolean).join(' ') || undefined;
    };
    return {
      ok: true,
      results: items
        .filter((it) => it?.display_name && (it.doi || it.id))
        .map((it, i) => ({
          title: stripTags(String(it.display_name)),
          url: it.doi || it.id,
          snippet: abstractOf(it.abstract_inverted_index),
          publishedAt: it.publication_date || undefined,
          year: it.publication_year || undefined,
          doi: it.doi || undefined,
          authors: (it.authorships ?? []).map((a: any) => a?.author?.display_name).filter(Boolean).slice(0, 12),
          journal: it.primary_location?.source?.display_name || undefined,
          publisher: it.primary_location?.source?.host_organization_name || undefined,
          pdfUrl: it.best_oa_location?.pdf_url || undefined,
          engines: ['openalex'],
          position: i,
        })),
    };
  },
};

const arxiv: Engine = {
  name: 'arxiv',
  async run(deps, q) {
    const r = await getText(deps, `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${q}`)}&max_results=8`, { 'User-Agent': BOT_UA });
    if ('error' in r) return { ok: false, reason: r.error };
    if (r.status !== 200) return { ok: false, reason: `HTTP ${r.status}` };
    const doc = deps.parse(r.text, 'text/xml');
    const kids = (el: Element, name: string) => [...el.children].filter((c) => (c.localName || c.tagName).replace(/^.*:/, '') === name);
    const text = (el: Element, name: string) => kids(el, name)[0]?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
    const entries = [...doc.getElementsByTagName('entry')];
    return {
      ok: true,
      results: entries
        .map((e, i) => ({
          title: text(e, 'title') ?? '',
          url: text(e, 'id') ?? '',
          snippet: text(e, 'summary'),
          publishedAt: text(e, 'published'),
          doi: text(e, 'doi'),
          authors: kids(e, 'author').map((a) => text(a, 'name')).filter((x): x is string => !!x).slice(0, 12),
          pdfUrl: kids(e, 'link').find((l) => l.getAttribute('title') === 'pdf')?.getAttribute('href') || undefined,
          engines: ['arxiv'],
          position: i,
        }))
        .filter((x) => x.title && /^https?:/.test(x.url)),
    };
  },
};

const ENGINES: Record<ResearchKind, Engine[]> = { web: [bing, duckduckgo, wikipedia], video: [youtube], paper: [crossref, openalex, arxiv] };

// ---------------------------------------------------------------- page extraction (extract.cjs rules)

const robotsCache = new Map<string, { at: number; rules: string[] }>();
const ROBOTS_TTL = 6 * 3600 * 1000;

export function parseRobots(txt: string): string[] {
  const rules: string[] = [];
  let applies = false;
  let inAgents = false;
  for (const line of String(txt).split(/\r?\n/)) {
    const m = line.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') {
      if (!inAgents) applies = false;
      inAgents = true;
      if (v === '*' || /martialdex/i.test(v)) applies = true;
    } else {
      inAgents = false;
      if (applies && k === 'disallow' && v) rules.push(v);
    }
  }
  return rules;
}

async function robotsAllows(deps: DeviceResearchDeps, url: string): Promise<boolean> {
  const u = new URL(url);
  let entry = robotsCache.get(u.origin);
  if (!entry || Date.now() - entry.at > ROBOTS_TTL) {
    let rules: string[] = [];
    try {
      const r = await deps.http.request(`${u.origin}/robots.txt`, { headers: { 'User-Agent': BOT_UA }, timeoutMs: 4000 });
      if (r.status === 200) rules = parseRobots(r.text);
      else if (r.status === 401 || r.status === 403) rules = ['/'];
    } catch {
      rules = [];
    }
    entry = { at: Date.now(), rules };
    robotsCache.set(u.origin, entry);
  }
  const path = u.pathname + u.search;
  return !entry.rules.some((rule) => {
    const prefix = rule.replace(/\*.*$/, '').replace(/\$$/, '');
    return prefix && path.startsWith(prefix);
  });
}

function metaDate(doc: Document): string | undefined {
  for (const s of ['meta[property="article:published_time"]', 'meta[name="article:published_time"]', 'meta[itemprop="datePublished"]', 'meta[name="date"]', 'meta[name="pubdate"]', 'meta[property="og:published_time"]', 'time[datetime]']) {
    const el = doc.querySelector(s);
    const iso = toIsoDate(el && (el.getAttribute('content') || el.getAttribute('datetime')));
    if (iso) return iso;
  }
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(el.textContent || '');
      for (const o of Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j]) {
        const iso = toIsoDate(o && (o.datePublished || o.uploadDate || o.dateCreated));
        if (iso) return iso;
      }
    } catch {
      /* malformed JSON-LD */
    }
  }
  return undefined;
}

type Extracted = { status: ExtractionStatus; reason?: string; text?: string; chars?: number; publishedAt?: string; method?: string };

async function extractPage(deps: DeviceResearchDeps, url: string): Promise<Extracted> {
  try {
    if (!(await robotsAllows(deps, url))) return { status: 'robots', reason: 'robots.txt가 자동 수집을 허용하지 않음' };
  } catch {
    return { status: 'failed', reason: 'URL 오류' };
  }
  let res: HttpResponse;
  try {
    res = await deps.http.request(url, { headers: { 'User-Agent': BOT_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ko,en;q=0.8' }, timeoutMs: PAGE_TIMEOUT });
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error && /time/i.test(err.message) ? '시간 초과' : '연결 실패' };
  }
  if ([401, 403, 429, 503].includes(res.status)) return { status: 'blocked', reason: `HTTP ${res.status}` };
  if (res.status < 200 || res.status >= 300) return { status: 'failed', reason: `HTTP ${res.status}` };
  const ct = res.headers['content-type'] || '';
  if (!/html|xml/i.test(ct)) return { status: 'not_html', reason: ct || 'unknown content-type' };
  const html = res.text.length > MAX_BYTES ? res.text.slice(0, MAX_BYTES) : res.text;
  if (CAPTCHA_MARKERS.test(html.slice(0, 20000)) && html.length < 60000) return { status: 'blocked', reason: '봇 확인/CAPTCHA 페이지' };
  try {
    const Readability = await deps.readability();
    const doc = deps.parse(html, 'text/html');
    const publishedAt = metaDate(doc);
    const article = new Readability(doc, { charThreshold: 300 }).parse();
    const text = (article?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 200) return { status: 'too_short', reason: '본문이 거의 없음(스크립트로 그리는 페이지일 수 있음)', publishedAt };
    return { status: 'ok', text: text.slice(0, MAX_TEXT), chars: text.length, publishedAt: publishedAt || toIsoDate(article?.publishedTime), method: 'readability' };
  } catch {
    return { status: 'failed', reason: '본문 해석 실패' };
  }
}

// ---------------------------------------------------------------- video / paper checks (media.cjs rules)

async function youtubeEmbedStatus(deps: DeviceResearchDeps, videoId: string): Promise<{ embed: VideoInfo['embed']; channel?: string }> {
  try {
    const r = await deps.http.request(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { timeoutMs: 5000 });
    if (r.status === 200) {
      let channel: string | undefined;
      try {
        const j = JSON.parse(r.text);
        channel = typeof j.author_name === 'string' ? j.author_name : undefined;
      } catch {
        /* no channel */
      }
      return { embed: 'embeddable', channel };
    }
    if (r.status === 401 || r.status === 403) return { embed: 'not_embeddable' };
    if (r.status === 404 || r.status === 400) return { embed: 'unavailable' };
    return { embed: 'unknown' };
  } catch {
    return { embed: 'unknown' };
  }
}

async function doiStatus(deps: DeviceResearchDeps, doi: string): Promise<NonNullable<PaperInfo['doiStatus']>> {
  try {
    const r = await deps.http.request(`https://doi.org/${encodeURI(doi)}`, { method: 'HEAD', noRedirect: true, timeoutMs: 5000 });
    if (r.status >= 300 && r.status < 400) return 'registered';
    if (r.status === 404) return 'not_found';
    return 'unchecked';
  } catch {
    return 'unchecked';
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
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

// ---------------------------------------------------------------- pipeline (index.cjs research)

export async function deviceResearch(deps: DeviceResearchDeps, input: ResearchRequest): Promise<ResearchOutcome> {
  const queries = [...new Set([input.query, ...(input.queries ?? [])].filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim().slice(0, 300)))].slice(0, MAX_QUERIES);
  if (!queries.length) return { ok: false, code: 'EMPTY', message: '검색어가 비어 있습니다.', diagnostics: {} as ResearchDiagnostics };
  const kind: ResearchKind = input.kind && ['web', 'video', 'paper'].includes(input.kind) ? input.kind : detectKind(queries[0]);
  const maxResults = Math.min(Math.max(Number(input.maxResults) || 8, 1), 20);
  const extractTop = kind === 'video' ? 0 : Math.min(Math.max(input.extractTop ?? DEFAULT_EXTRACT, 0), 8);

  const diagnostics: Required<Pick<ResearchDiagnostics, 'failedEngines' | 'failedQueries' | 'extraction'>> & ResearchDiagnostics = { backend: 'device', kind, queries, rawCount: 0, duplicatesRemoved: 0, failedEngines: [], failedQueries: [], extraction: {} };
  const raw: RawResult[] = [];
  // arXiv asks clients not to burst — only the first query goes there
  const responses = await Promise.all(queries.map((q, qi) => Promise.all(ENGINES[kind].filter((e) => e.name !== 'arxiv' || qi === 0).map(async (e) => ({ engine: e.name, r: await e.run(deps, q).catch((): EngineResult => ({ ok: false, reason: '오류' })) })))));
  for (const [qi, q] of queries.entries()) {
    const per = responses[qi];
    for (const { engine, r } of per) {
      if (r.ok) raw.push(...r.results);
      else if (!diagnostics.failedEngines.some((f) => f.engine === engine)) diagnostics.failedEngines.push({ engine, reason: r.reason });
    }
    if (per.every((x) => !x.r.ok)) diagnostics.failedQueries.push({ query: q, code: 'SEARCH_FAILED', message: per.map((x) => `${x.engine}: ${(x.r as { reason: string }).reason}`).join(', ') });
  }
  diagnostics.rawCount = raw.length;
  if (!raw.length) {
    if (diagnostics.failedQueries.length === queries.length) {
      const offline = diagnostics.failedEngines.every((f) => f.reason === '연결 실패' || f.reason === '시간 초과');
      return { ok: false, code: 'SEARCH_FAILED', message: offline ? '인터넷에 연결할 수 없어 검색하지 못했습니다.' : `모든 검색 요청이 실패했습니다 (${diagnostics.failedEngines.map((f) => `${f.engine}: ${f.reason}`).join(', ')}).`, diagnostics };
    }
    return { ok: true, kind, results: [], diagnostics };
  }

  const { results: dedupedAll, dropped } = dedupResults(raw);
  diagnostics.duplicatesRemoved = dropped;
  const mismatched: { title: string; url: string; reason: string }[] = [];
  const deduped = dedupedAll.filter((r) => {
    const why = titleUrlMismatch(r.url, r.title);
    if (why) mismatched.push({ title: r.title, url: r.url, reason: why });
    return !why;
  });
  diagnostics.titleUrlMismatch = mismatched.slice(0, 5);
  diagnostics.titleUrlMismatchRemoved = mismatched.length;
  const topicQuery = (q: string) => tokens(q).filter((w) => !ACADEMIC_GENERIC.has(w)).join(' ');
  const overlapOf = (r: DedupedResult) => Math.max(...queries.map((q) => queryOverlap(kind === 'paper' && topicQuery(q) ? topicQuery(q) : q, r.title, r.snippet)));
  let relevant = deduped.filter((r) => overlapOf(r) >= MIN_QUERY_OVERLAP);
  diagnostics.removedTitles = deduped.filter((r) => !relevant.includes(r)).slice(0, 3).map((r) => r.title);
  diagnostics.irrelevantRemoved = deduped.length - relevant.length;
  if (kind === 'paper') {
    const seen = new Set<string>();
    const before = relevant.length;
    relevant = relevant.filter((r) => {
      const d = doiOf(r);
      const keys = [`t:${tokens(r.title).join(' ')}`, ...(d ? [`d:${d.toLowerCase()}`] : [])];
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
    diagnostics.duplicatesRemoved = (diagnostics.duplicatesRemoved ?? 0) + before - relevant.length;
  }
  let ranked = rankResults(queries.join(' '), relevant);
  if (input.recent) ranked = [...ranked].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  ranked = ranked.slice(0, maxResults);

  const media = await mapLimit(ranked, 4, async (r) => {
    if (kind === 'video') {
      const id = youtubeId(r.url);
      return id ? { videoId: id, ...(await youtubeEmbedStatus(deps, id)) } : null;
    }
    if (kind === 'paper') {
      const doi = doiOf(r);
      return doi ? { doi, doiStatus: await doiStatus(deps, doi) } : null;
    }
    return null;
  });

  // 조건이 있으면 제목·요약이 그 말을 담은 결과부터 읽는다 (사양 §6) — 조건에 맞는 게 없으면 기존대로 상위 N건
  const requireTerms = (input.requireTerms || []).filter((t) => typeof t === 'string' && t.trim().length > 1);
  const readable = ranked
    .map((r, idx) => ({ idx, r, skip: sourceTypeOf(r.url).type === 'video' || /\.pdf($|\?)/i.test(r.url) }))
    .filter((x) => !x.skip);
  const wanted = requireTerms.length ? readable.filter((x) => requireTerms.some((t) => `${x.r.title || ''} ${x.r.snippet || ''}`.toLowerCase().includes(t.toLowerCase()))) : [];
  const extractable = new Set((wanted.length ? wanted : readable).slice(0, extractTop).map((x) => x.idx));
  const extracted = await mapLimit(ranked, EXTRACT_CONCURRENCY, async (r, idx): Promise<Extracted> => (extractable.has(idx) ? extractPage(deps, r.url) : { status: 'not_attempted' }));

  const fetchedAt = new Date().toISOString();
  const results: ResearchResult[] = await Promise.all(
    ranked.map(async (r, idx) => {
      const ex = extracted[idx] || { status: 'not_attempted' };
      diagnostics.extraction[ex.status] = (diagnostics.extraction[ex.status] || 0) + 1;
      const st = sourceTypeOf(r.url);
      const publishedAt = r.publishedAt || ex.publishedAt;
      const m = media[idx] as { videoId?: string; embed?: VideoInfo['embed']; channel?: string; doi?: string; doiStatus?: PaperInfo['doiStatus'] } | null;
      return {
        sourceId: await sourceIdOf(r.url),
        fetchedAt,
        title: kind === 'video' ? r.title.replace(/\s+-\s+YouTube$/i, '') : r.title,
        url: r.url,
        snippet: r.snippet ? r.snippet.slice(0, MAX_CONTENT_CHARS) : undefined,
        content: ex.status === 'ok' && ex.text ? ex.text.slice(0, MAX_CONTENT_CHARS) : undefined,
        source: hostOf(r.url),
        publishedAt,
        publishedAtSource: r.publishedAt ? 'search_engine' : ex.publishedAt ? 'page_metadata' : undefined,
        engines: r.engines,
        relevance: r.relevance,
        sourceType: st.type,
        sourceTypeLabel: st.label,
        reliability: assessReliability({ sourceType: st.type, engineCount: r.engines.length, extractionStatus: ex.status === 'not_attempted' && st.type === 'video' ? 'ok' : ex.status, publishedAt }),
        extraction: { status: ex.status, reason: ex.reason, chars: ex.chars, method: ex.method },
        thumbnail: r.thumbnail,
        ...(kind === 'video'
          ? {
              video: {
                platform: m?.videoId ? 'youtube' : 'other',
                videoId: m?.videoId,
                channel: r.author || m?.channel || undefined,
                duration: r.length || undefined,
                thumbnail: m?.videoId ? `https://i.ytimg.com/vi/${m.videoId}/hqdefault.jpg` : undefined,
                embed: m?.videoId ? (m.embed ?? 'unknown') : 'not_supported',
              } satisfies VideoInfo,
            }
          : {}),
        ...(kind === 'paper'
          ? {
              paper: {
                doi: m?.doi,
                doiUrl: m?.doi ? `https://doi.org/${m.doi}` : undefined,
                doiStatus: m?.doi ? m.doiStatus : undefined,
                authors: r.authors?.length ? r.authors : undefined,
                journal: r.journal || undefined,
                publisher: r.publisher || undefined,
                year: (publishedAt ? Number(String(publishedAt).slice(0, 4)) || undefined : undefined) ?? r.year,
                abstract: r.snippet ? r.snippet.slice(0, 600) : undefined,
                pdfUrl: r.pdfUrl || undefined,
              } satisfies PaperInfo,
            }
          : {}),
      };
    })
  );
  return { ok: true, kind, results, diagnostics };
}

// ---------------------------------------------------------------- person names (entity.cjs, via the Wikipedia API)

const COMBAT = /(종합격투기|격투기|권투|복싱|킥복싱|무에타이|레슬링|주짓수|유도|삼보|UFC|ONE 챔피언십|파이터)/;
const squashName = (s: string) => String(s || '').replace(/\s+/g, '');
const KO_API = 'https://ko.wikipedia.org/w/api.php?format=json&utf8=1&action=query';
const koUrl = (title: string) => `https://ko.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** A Korean Wikipedia article (followed through redirects) → its English counterpart from the interlanguage link. */
async function koArticle(deps: DeviceResearchDeps, query: string, title: string, requireCombat: boolean): Promise<PersonName | null> {
  const j = await getJson(deps, `${KO_API}&redirects=1&prop=langlinks|extracts|pageprops&lllang=en&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}`);
  if (!j.ok) return { ok: false, query, reason: `위키백과 문서를 열지 못했습니다 (${j.reason}).` };
  const page = Object.values((j.json?.query?.pages ?? {}) as Record<string, any>)[0];
  if (!page || 'missing' in page || page.pageprops?.disambiguation !== undefined) return null;
  const ko = String(page.title);
  if (requireCombat && !COMBAT.test(String(page.extract ?? ''))) return { ok: false, query, ko, reason: `「${ko}」 문서가 격투기 선수 문서가 아닙니다.` };
  const link = page.langlinks?.[0]?.['*'] as string | undefined;
  if (!link) return { ok: false, query, ko, reason: '한국어 문서에 영어 문서 연결이 없습니다.' };
  return { ok: true, query, en: link.replace(/\s*\([^)]*\)\s*$/, '').trim(), ko, source: koUrl(ko) };
}

export async function deviceEntity(deps: DeviceResearchDeps, name: string): Promise<PersonName> {
  const query = String(name || '').trim().slice(0, 80);
  if (!query) return { ok: false, query, reason: '이름이 비어 있습니다.' };
  if (/^[A-Za-z][A-Za-z .'-]+$/.test(query)) return { ok: true, query, en: query, ko: null, source: null };
  try {
    const direct = await koArticle(deps, query, query, false);
    if (direct) return direct;
    // a short / partial name: full-name article titles containing it; several → ambiguous, never picked at random
    const j = await getJson(deps, `${KO_API}&list=search&srlimit=10&srsearch=${encodeURIComponent(`${query} 격투기 선수`)}`);
    if (!j.ok) return { ok: false, query, reason: `위키백과에서 이 이름의 문서를 찾지 못했고, 이름 검색도 실패했습니다 (${j.reason}).` };
    const names = [
      ...new Set(
        ((j.json?.query?.search ?? []) as { title: string }[])
          .map((h) => h.title.replace(/\s*\([^)]*\)\s*$/, '').trim())
          .filter((t) => t.length <= 30 && !/[:/]/.test(t) && squashName(t) !== squashName(query) && squashName(t).includes(squashName(query)))
      ),
    ];
    if (!names.length) return { ok: false, query, reason: '위키백과에서 이 이름의 격투기 선수 문서를 찾지 못했습니다.' };
    if (names.length > 1) return { ok: false, query, reason: `같은 이름이 들어간 사람이 여럿입니다: ${names.join(', ')} — 전체 이름으로 다시 물어봐 주세요.`, candidates: names };
    const r = await koArticle(deps, query, names[0], true);
    if (!r) return { ok: false, query, ko: names[0], reason: `「${names[0]}」의 위키백과 문서를 찾지 못했습니다.` };
    return r.ok ? { ...r, via: `"${query}" → 「${names[0]}」(검색으로 찾은 전체 이름)` } : r;
  } catch {
    return { ok: false, query, reason: '위키백과 문서를 읽는 중 오류가 발생했습니다.' };
  }
}

// ---------------------------------------------------------------- ON/OFF on this device

const SWITCH_KEY = 'martialdex:device-search';

/** ON unless the user turned it off on this device (no server to start — a search runs only when the coach asks). */
export function deviceSearchEnabled(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setDeviceSearchEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SWITCH_KEY);
    else localStorage.setItem(SWITCH_KEY, 'off');
  } catch {
    /* storage unavailable — stays at the default */
  }
}

export const DEVICE_SEARCH_DISABLED = '기기 검색이 꺼져 있습니다. 설정 > AI 엔진에서 켤 수 있습니다.';
