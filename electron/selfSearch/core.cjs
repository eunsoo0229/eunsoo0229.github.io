// MARTIALDEX self-hosted search — pure helpers (no I/O), shared by the
// Electron main process and the offline tests (.devtools/test-self-search.mjs).
//
// Nothing here decides that a page is "true". It only labels what kind of
// source a URL is, how well it matches the query, and what date the page
// itself states — the coach shows those labels instead of inventing trust.

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|ref_src|igshid|si|feature|spm)$/i;

/** Canonical form used for duplicate detection. Returns null for non-http(s) or unparseable URLs. */
function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  // youtu.be/<id> and youtube.com/watch?v=<id> are the same video
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? `youtube.com/watch?v=${id}` : null;
  }
  if (u.hostname === 'youtube.com' && u.pathname === '/watch') {
    const id = u.searchParams.get('v');
    return id ? `youtube.com/watch?v=${id}` : null;
  }
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, '') || '';
  const qs = u.searchParams.toString();
  return `${u.hostname}${path}${qs ? `?${qs}` : ''}`;
}

function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  } catch {
    return undefined;
  }
}

const STOP = new Set(
  ('the a an of and or to in on for with how what is are vs from by at as it this that ' +
    '은 는 이 가 을 를 의 에 와 과 도 로 으로 에서 하는 법 방법 ' +
    // question wording and words that only name the KIND of search — they say nothing about the topic
    '관한 대한 관련 있어 있어요 있나요 있을까 알려줘 알려 보여줘 보여 해줘 찾아줘 좀 어떤 무슨 ' +
    '논문 연구 학술 영상 동영상 비디오 자료 study studies paper papers research video videos')
    .split(' ')
);

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Share of query tokens found in title+snippet (0..1). Korean tokens also match as substrings (조사 붙은 형태). */
function queryOverlap(query, title, snippet) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return 0;
  const hay = `${title || ''} ${snippet || ''}`.toLowerCase();
  const hit = q.filter((w) => hay.includes(w)).length;
  return hit / q.length;
}

// Source types, not truth claims. Lists are deliberately short and explicit;
// anything unknown is "web" (일반 웹) and is shown as such.
const SOURCE_TYPES = [
  { type: 'academic', label: '학술 자료', test: (h) => /(^|\.)(doi\.org|arxiv\.org|semanticscholar\.org|openalex\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|researchgate\.net|springer\.com|sciencedirect\.com|tandfonline\.com|frontiersin\.org|mdpi\.com|nature\.com|wiley\.com|journals\.sagepub\.com|crossref\.org|oadoi\.org|europepmc\.org|scholar\.archive\.org)$/.test(h) || /\.(edu|ac\.kr|ac\.uk)$/.test(h) },
  { type: 'official', label: '공식 기관', test: (h) => /(^|\.)(ufc\.com|olympics\.com|ibjjf\.com|worldtaekwondo\.org|ijf\.org|uww\.org|iba\.sport|ifma\.sport|wkf\.net|abcboxing\.org)$/.test(h) || /\.(gov|go\.kr)$/.test(h) },
  { type: 'records', label: '경기 기록 DB', test: (h) => /(^|\.)(sherdog\.com|tapology\.com|boxrec\.com|ufcstats\.com|bjjheroes\.com)$/.test(h) },
  { type: 'video', label: '영상', test: (h) => /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|bilibili\.com)$/.test(h) },
  { type: 'reference', label: '백과사전', test: (h) => /(^|\.)(wikipedia\.org|namu\.wiki|britannica\.com)$/.test(h) },
  { type: 'forum', label: '커뮤니티 글', test: (h) => /(^|\.)(reddit\.com|quora\.com|sherdog\.net|bjjee\.com\/forum|dcinside\.com|clien\.net|fmkorea\.com)$/.test(h) || /(^|\.)(forum|forums|community|cafe\.naver)\./.test(h) || h === 'cafe.naver.com' },
  { type: 'blog', label: '블로그·개인 글', test: (h) => /(^|\.)(medium\.com|substack\.com|blog\.naver\.com|tistory\.com|wordpress\.com|blogspot\.com|brunch\.co\.kr|velog\.io)$/.test(h) },
];

function sourceTypeOf(url) {
  const h = hostOf(url) || '';
  const hit = SOURCE_TYPES.find((s) => s.test(h));
  return hit ? { type: hit.type, label: hit.label } : { type: 'web', label: '일반 웹' };
}

const TYPE_WEIGHT = { academic: 1, official: 0.9, records: 0.85, reference: 0.75, web: 0.6, video: 0.6, blog: 0.45, forum: 0.35 };

/**
 * Reliability is a *label with reasons* (높음/보통/낮음), computed only from
 * facts we actually observed: source type, how many engines returned the URL,
 * whether we could read the page, whether the page states a date.
 */
function assessReliability({ sourceType, engineCount, extractionStatus, publishedAt }) {
  const reasons = [];
  let s = TYPE_WEIGHT[sourceType] ?? 0.5;
  reasons.push(`출처 유형: ${(SOURCE_TYPES.find((t) => t.type === sourceType) || { label: '일반 웹' }).label}`);
  if (engineCount >= 2) {
    s += 0.1;
    reasons.push(`검색 엔진 ${engineCount}곳에서 함께 검색됨`);
  }
  if (extractionStatus === 'ok') reasons.push('원문 본문 확인');
  else {
    s -= 0.15;
    reasons.push(extractionStatus === 'blocked' ? '사이트가 자동 접근을 막아 본문 미확인' : '본문을 읽지 못해 검색 요약만 있음');
  }
  if (publishedAt) reasons.push(`게시일 표기: ${publishedAt.slice(0, 10)}`);
  else reasons.push('게시일 확인 안 됨');
  const level = s >= 0.8 ? 'high' : s >= 0.55 ? 'medium' : 'low';
  return { level, label: { high: '높음', medium: '보통', low: '낮음' }[level], reasons };
}

/** ISO date (YYYY-MM-DD…) from a loose date string, or undefined. Never guesses a missing date. */
function toIsoDate(v) {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  if (y < 1990 || d.getTime() > Date.now() + 2 * 86400000) return undefined;
  return d.toISOString();
}

/**
 * Merge raw engine results: same normalized URL → one result whose engines
 * are unioned; near-identical titles on the same host are also merged.
 */
// Engine-given details kept through dedup (video channel / length; paper DOI, authors, journal …).
const DETAIL_FIELDS = ['author', 'length', 'doi', 'authors', 'journal', 'publisher', 'pdfUrl'];

function dedupResults(raw) {
  const byKey = new Map();
  const titleKey = new Map();
  let dropped = 0;
  for (const r of raw) {
    const key = normalizeUrl(r.url);
    if (!key || !r.title) {
      dropped++;
      continue;
    }
    const host = hostOf(r.url);
    const tk = `${host}|${tokens(r.title).join(' ')}`;
    const existing = byKey.get(key) || byKey.get(titleKey.get(tk));
    if (existing) {
      dropped++;
      for (const e of r.engines || []) if (!existing.engines.includes(e)) existing.engines.push(e);
      if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
      if (!existing.publishedAt && r.publishedAt) existing.publishedAt = r.publishedAt;
      if (!existing.thumbnail && r.thumbnail) existing.thumbnail = r.thumbnail;
      // bibliographic / video fields another engine had for the same result
      for (const f of DETAIL_FIELDS) if (existing[f] === undefined && r[f] !== undefined) existing[f] = r[f];
      existing.bestPosition = Math.min(existing.bestPosition, r.position ?? 99);
      continue;
    }
    const item = {
      title: String(r.title).trim(),
      url: r.url,
      key,
      snippet: r.snippet ? String(r.snippet).trim() : undefined,
      publishedAt: toIsoDate(r.publishedAt),
      engines: [...new Set(r.engines || [])],
      bestPosition: r.position ?? 99,
      thumbnail: r.thumbnail,
      ...Object.fromEntries(DETAIL_FIELDS.filter((f) => r[f] !== undefined).map((f) => [f, r[f]])),
      category: r.category,
    };
    byKey.set(key, item);
    titleKey.set(tk, key);
  }
  return { results: [...byKey.values()], dropped };
}

/** Rank deduped results: query overlap first, then engine agreement, then engine position. */
function rankResults(query, results) {
  return results
    .map((r) => {
      const overlap = queryOverlap(query, r.title, r.snippet);
      const relevance = Math.round(100 * Math.min(1, overlap * 0.75 + Math.min(r.engines.length, 3) * 0.06 + Math.max(0, 10 - r.bestPosition) * 0.007));
      return { ...r, relevance };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

const CAPTCHA_MARKERS = /(captcha|are you a robot|verify you are human|unusual traffic|cf-chl-|challenge-platform|attention required! \| cloudflare|access denied)/i;

// A result whose URL is not the page its title names — measured 2026-11-07: "체중 감량 - 나무위키" pointing at
// namu.wiki/w/나무위키:대문 (the wiki's front page). Checked where the URL carries the page name (wikis); a portal
// page carrying an article title is never the article. Returns the reason, or null when nothing contradicts.
const WIKI_PAGE = [
  { host: /(^|\.)namu\.wiki$/, path: /^\/w\/(.+)$/, site: /\s*-\s*나무위키\s*$/ },
  { host: /(^|\.)wikipedia\.org$/, path: /^\/wiki\/(.+)$/, site: /\s*-\s*(위키백과|wikipedia).*$/i },
  { host: /(^|\.)namu\.moe$|(^|\.)wiki\.namu$/, path: /^\/w\/(.+)$/, site: /\s*-\s*나무위키\s*$/ },
];
const PORTAL = /^(나무위키:대문|대문|main[_ ]page|위키백과:대문|특수:|special:)/i;
const squash = (s) => s.toLowerCase().replace(/[\s_\-·()（）'"「」]/g, '');

function titleUrlMismatch(url, title) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const rule = WIKI_PAGE.find((w) => w.host.test(u.hostname));
  if (!rule) return null;
  const m = u.pathname.match(rule.path);
  if (!m) return u.pathname === '/' || u.pathname === '' ? 'URL이 위키 첫 페이지' : null;
  let page;
  try {
    page = decodeURIComponent(m[1]).split('#')[0];
  } catch {
    return null;
  }
  const article = String(title || '').replace(rule.site, '').trim();
  if (PORTAL.test(page)) return PORTAL.test(article) ? null : `URL이 위키 대문(${page})이고 제목(${article})의 문서가 아님`;
  const a = squash(article);
  const p = squash(page.replace(/\/.*$/, ''));
  if (!a || !p) return null;
  return a.includes(p) || p.includes(a) ? null : `URL 문서(${page})와 제목(${article})이 다름`;
}

module.exports = {
  titleUrlMismatch,
  normalizeUrl,
  hostOf,
  tokens,
  queryOverlap,
  sourceTypeOf,
  assessReliability,
  toIsoDate,
  dedupResults,
  rankResults,
  CAPTCHA_MARKERS,
};
