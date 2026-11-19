// Page text extraction for self-hosted search (Electron main process).
//
// Static fetch + Mozilla Readability (linkedom DOM) — no browser, low memory.
// Rules:
// - robots.txt is honoured (User-agent * / MARTIALDEX rules, Disallow prefixes).
// - CAPTCHA / bot walls / 401 / 403 / 429 are reported as `blocked` and never retried around.
// - Only text/html, at most MAX_BYTES, TIMEOUT_MS per page.
// Optional heavy tier (Crawl4AI, a separate on-demand Python process) lives in
// crawl4ai.cjs and is only used when MARTIALDEX_CRAWL4AI=on.

const { CAPTCHA_MARKERS, toIsoDate } = require('./core.cjs');

// The DOM parser is loaded on first use, not when main.cjs starts: a broken
// parser dependency (e.g. an ESM-only release that Electron's Node cannot
// require()) must only fail page extraction, never stop the app from launching.
let parser = null;
function loadParser() {
  if (!parser) {
    try {
      parser = { Readability: require('@mozilla/readability').Readability, parseHTML: require('linkedom').parseHTML };
    } catch (err) {
      parser = { error: (err && err.code) || 'LOAD_FAILED' };
      console.error('[selfSearch] page parser unavailable:', err && err.message);
    }
  }
  return parser;
}

const UA = 'Mozilla/5.0 (compatible; MARTIALDEX-Research/0.1; +local self-hosted study assistant)';
const TIMEOUT_MS = 10000;
const MAX_BYTES = 2_000_000;
const MAX_TEXT = 12000;

const robotsCache = new Map(); // origin -> { at, rules: string[] | null }
const ROBOTS_TTL = 6 * 3600 * 1000;

function parseRobots(txt) {
  // Collect Disallow rules from groups that apply to "*" or "martialdex".
  const rules = [];
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

async function robotsAllows(url) {
  const u = new URL(url);
  const origin = u.origin;
  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.at > ROBOTS_TTL) {
    let rules = [];
    try {
      const r = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': UA } });
      if (r.ok) rules = parseRobots(await r.text());
      else if (r.status === 401 || r.status === 403) rules = ['/'];
    } catch {
      rules = []; // unreachable robots.txt = no rules published
    }
    entry = { at: Date.now(), rules };
    robotsCache.set(origin, entry);
  }
  const path = u.pathname + u.search;
  return !entry.rules.some((rule) => {
    const prefix = rule.replace(/\*.*$/, '').replace(/\$$/, '');
    return prefix && path.startsWith(prefix);
  });
}

function metaDate(document) {
  const sel = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[itemprop="datePublished"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[property="og:published_time"]',
    'time[datetime]',
  ];
  for (const s of sel) {
    const el = document.querySelector(s);
    const v = el && (el.getAttribute('content') || el.getAttribute('datetime'));
    const iso = toIsoDate(v);
    if (iso) return iso;
  }
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(el.textContent || '');
      const arr = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      for (const o of arr) {
        const iso = toIsoDate(o && (o.datePublished || o.uploadDate || o.dateCreated));
        if (iso) return iso;
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return undefined;
}

/**
 * → { status:'ok', text, title, byline, siteName, publishedAt, chars, method:'readability' }
 *   { status:'blocked'|'robots'|'not_html'|'too_short'|'failed', reason }
 */
async function extractPage(url) {
  const { Readability, parseHTML, error: parserError } = loadParser();
  if (parserError) return { status: 'failed', reason: `본문 추출기 로드 실패(${parserError})` };
  try {
    if (!(await robotsAllows(url))) return { status: 'robots', reason: 'robots.txt가 자동 수집을 허용하지 않음' };
  } catch {
    return { status: 'failed', reason: 'URL 오류' };
  }
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ko,en;q=0.8' },
    });
  } catch (err) {
    return { status: 'failed', reason: err && err.name === 'TimeoutError' ? '시간 초과' : '연결 실패' };
  }
  if ([401, 403, 429, 503].includes(res.status)) return { status: 'blocked', reason: `HTTP ${res.status}` };
  if (!res.ok) return { status: 'failed', reason: `HTTP ${res.status}` };
  const ct = res.headers.get('content-type') || '';
  if (!/html|xml/i.test(ct)) return { status: 'not_html', reason: ct || 'unknown content-type' };
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return { status: 'failed', reason: '페이지가 너무 큼' };
  let html = await res.text();
  if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);
  if (CAPTCHA_MARKERS.test(html.slice(0, 20000)) && html.length < 60000) return { status: 'blocked', reason: '봇 확인/CAPTCHA 페이지' };

  try {
    const { document } = parseHTML(html);
    const publishedAt = metaDate(document);
    const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || undefined;
    const article = new Readability(document, { charThreshold: 300 }).parse();
    const text = (article && article.textContent ? article.textContent : '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 200) return { status: 'too_short', reason: '본문이 거의 없음(스크립트로 그리는 페이지일 수 있음)', publishedAt };
    return {
      status: 'ok',
      text: text.slice(0, MAX_TEXT),
      chars: text.length,
      title: article.title || undefined,
      byline: article.byline || undefined,
      siteName: article.siteName || siteName,
      publishedAt: publishedAt || toIsoDate(article.publishedTime),
      method: 'readability',
    };
  } catch {
    return { status: 'failed', reason: '본문 해석 실패' };
  }
}

module.exports = { extractPage, parseRobots, robotsAllows };
