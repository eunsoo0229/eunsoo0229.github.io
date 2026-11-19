// Pure research helpers for the on-device (Android) search pipeline — a TypeScript copy of
// electron/selfSearch/core.cjs (+ youtubeId / doiOf from media.cjs, detectKind from index.cjs).
// Keep in sync: .devtools/test-device-research.mjs runs both on the same inputs and fails on any
// difference. Nothing here decides that a page is "true" — it labels source type, query match and
// the date the page itself states.

import type { ResearchKind, ResearchReliability, SourceType } from './types';

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|ref_src|igshid|si|feature|spm)$/i;

/** Canonical form used for duplicate detection. Returns null for non-http(s) or unparseable URLs. */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
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

export function hostOf(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  } catch {
    return undefined;
  }
}

const STOP = new Set(
  ('the a an of and or to in on for with how what is are vs from by at as it this that ' +
    '은 는 이 가 을 를 의 에 와 과 도 로 으로 에서 하는 법 방법 ' +
    '관한 대한 관련 있어 있어요 있나요 있을까 알려줘 알려 보여줘 보여 해줘 찾아줘 좀 어떤 무슨 ' +
    '논문 연구 학술 영상 동영상 비디오 자료 study studies paper papers research video videos')
    .split(' ')
);

export function tokens(s: string | undefined): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Share of query tokens found in title+snippet (0..1). Korean tokens also match as substrings (조사 붙은 형태). */
export function queryOverlap(query: string, title?: string, snippet?: string): number {
  const q = [...new Set(tokens(query))];
  if (!q.length) return 0;
  const hay = `${title || ''} ${snippet || ''}`.toLowerCase();
  return q.filter((w) => hay.includes(w)).length / q.length;
}

const SOURCE_TYPES: { type: SourceType; label: string; test: (h: string) => boolean }[] = [
  { type: 'academic', label: '학술 자료', test: (h) => /(^|\.)(doi\.org|arxiv\.org|semanticscholar\.org|openalex\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|researchgate\.net|springer\.com|sciencedirect\.com|tandfonline\.com|frontiersin\.org|mdpi\.com|nature\.com|wiley\.com|journals\.sagepub\.com|crossref\.org|oadoi\.org|europepmc\.org|scholar\.archive\.org)$/.test(h) || /\.(edu|ac\.kr|ac\.uk)$/.test(h) },
  { type: 'official', label: '공식 기관', test: (h) => /(^|\.)(ufc\.com|olympics\.com|ibjjf\.com|worldtaekwondo\.org|ijf\.org|uww\.org|iba\.sport|ifma\.sport|wkf\.net|abcboxing\.org)$/.test(h) || /\.(gov|go\.kr)$/.test(h) },
  { type: 'records', label: '경기 기록 DB', test: (h) => /(^|\.)(sherdog\.com|tapology\.com|boxrec\.com|ufcstats\.com|bjjheroes\.com)$/.test(h) },
  { type: 'video', label: '영상', test: (h) => /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|bilibili\.com)$/.test(h) },
  { type: 'reference', label: '백과사전', test: (h) => /(^|\.)(wikipedia\.org|namu\.wiki|britannica\.com)$/.test(h) },
  { type: 'forum', label: '커뮤니티 글', test: (h) => /(^|\.)(reddit\.com|quora\.com|sherdog\.net|bjjee\.com\/forum|dcinside\.com|clien\.net|fmkorea\.com)$/.test(h) || /(^|\.)(forum|forums|community|cafe\.naver)\./.test(h) || h === 'cafe.naver.com' },
  { type: 'blog', label: '블로그·개인 글', test: (h) => /(^|\.)(medium\.com|substack\.com|blog\.naver\.com|tistory\.com|wordpress\.com|blogspot\.com|brunch\.co\.kr|velog\.io)$/.test(h) },
];

export function sourceTypeOf(url: string): { type: SourceType; label: string } {
  const h = hostOf(url) || '';
  const hit = SOURCE_TYPES.find((s) => s.test(h));
  return hit ? { type: hit.type, label: hit.label } : { type: 'web', label: '일반 웹' };
}

const TYPE_WEIGHT: Record<string, number> = { academic: 1, official: 0.9, records: 0.85, reference: 0.75, web: 0.6, video: 0.6, blog: 0.45, forum: 0.35 };

/** A label with reasons (높음/보통/낮음), from observed facts only: source type, engine count, page read, stated date. */
export function assessReliability({ sourceType, engineCount, extractionStatus, publishedAt }: { sourceType: SourceType; engineCount: number; extractionStatus: string; publishedAt?: string }): ResearchReliability {
  const reasons: string[] = [];
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
  return { level, label: ({ high: '높음', medium: '보통', low: '낮음' } as const)[level], reasons };
}

/** ISO date from a loose date string, or undefined. Never guesses a missing date. */
export function toIsoDate(v: unknown): string | undefined {
  if (!v) return undefined;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  if (y < 1990 || d.getTime() > Date.now() + 2 * 86400000) return undefined;
  return d.toISOString();
}

/** One engine result before dedup (the shape electron/selfSearch/searxng.cjs produces). */
export interface RawResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  engines: string[];
  position?: number;
  thumbnail?: string;
  category?: string;
  author?: string;
  length?: string;
  doi?: string;
  authors?: string[];
  journal?: string;
  publisher?: string;
  pdfUrl?: string;
  /** Publication year when the index gives a year but no full date (never turned into a day). */
  year?: number;
}

export interface DedupedResult extends Omit<RawResult, 'position'> {
  key: string;
  bestPosition: number;
}

const DETAIL_FIELDS = ['author', 'length', 'doi', 'authors', 'journal', 'publisher', 'pdfUrl', 'year'] as const;

/** Same normalized URL → one result with engines unioned; near-identical titles on one host also merged. */
export function dedupResults(raw: RawResult[]): { results: DedupedResult[]; dropped: number } {
  const byKey = new Map<string, DedupedResult>();
  const titleKey = new Map<string, string>();
  let dropped = 0;
  for (const r of raw) {
    const key = normalizeUrl(r.url);
    if (!key || !r.title) {
      dropped++;
      continue;
    }
    const tk = `${hostOf(r.url)}|${tokens(r.title).join(' ')}`;
    const existing = byKey.get(key) || byKey.get(titleKey.get(tk) ?? '');
    if (existing) {
      dropped++;
      for (const e of r.engines || []) if (!existing.engines.includes(e)) existing.engines.push(e);
      if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
      if (!existing.publishedAt && r.publishedAt) existing.publishedAt = r.publishedAt;
      if (!existing.thumbnail && r.thumbnail) existing.thumbnail = r.thumbnail;
      const ex = existing as unknown as Record<string, unknown>;
      for (const f of DETAIL_FIELDS) if (ex[f] === undefined && r[f] !== undefined) ex[f] = r[f];
      existing.bestPosition = Math.min(existing.bestPosition, r.position ?? 99);
      continue;
    }
    const item: DedupedResult = {
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

/** Query overlap first, then engine agreement, then engine position. */
export function rankResults<T extends { title: string; snippet?: string; engines: string[]; bestPosition: number }>(query: string, results: T[]): (T & { relevance: number })[] {
  return results
    .map((r) => {
      const overlap = queryOverlap(query, r.title, r.snippet);
      const relevance = Math.round(100 * Math.min(1, overlap * 0.75 + Math.min(r.engines.length, 3) * 0.06 + Math.max(0, 10 - r.bestPosition) * 0.007));
      return { ...r, relevance };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

export const CAPTCHA_MARKERS = /(captcha|are you a robot|verify you are human|unusual traffic|cf-chl-|challenge-platform|attention required! \| cloudflare|access denied)/i;

const WIKI_PAGE = [
  { host: /(^|\.)namu\.wiki$/, path: /^\/w\/(.+)$/, site: /\s*-\s*나무위키\s*$/ },
  { host: /(^|\.)wikipedia\.org$/, path: /^\/wiki\/(.+)$/, site: /\s*-\s*(위키백과|wikipedia).*$/i },
  { host: /(^|\.)namu\.moe$|(^|\.)wiki\.namu$/, path: /^\/w\/(.+)$/, site: /\s*-\s*나무위키\s*$/ },
];
const PORTAL = /^(나무위키:대문|대문|main[_ ]page|위키백과:대문|특수:|special:)/i;
const squash = (s: string) => s.toLowerCase().replace(/[\s_\-·()（）'"「」]/g, '');

/** A result whose URL is not the page its title names (wiki front page with an article title …) → the reason, else null. */
export function titleUrlMismatch(url: string, title: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const rule = WIKI_PAGE.find((w) => w.host.test(u.hostname));
  if (!rule) return null;
  const m = u.pathname.match(rule.path);
  if (!m) return u.pathname === '/' || u.pathname === '' ? 'URL이 위키 첫 페이지' : null;
  let page: string;
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

export function detectKind(q: string): ResearchKind {
  if (/(영상|동영상|비디오|유튜브|하이라이트|video|youtube|highlight|footage)/i.test(q)) return 'video';
  if (/(논문|연구|학술|저널|study|paper|journal|research)/i.test(q)) return 'paper';
  return 'web';
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
      return m ? m[1] : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

const DOI_RE = /^10\.\d{4,9}\/\S+$/;

export function cleanDoi(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return DOI_RE.test(d) ? d : null;
}

/** DOI from the index, or from a doi.org / oadoi.org link in the result URL. */
export function doiOf(result: { doi?: string; url?: string }): string | null {
  return cleanDoi(result.doi) || cleanDoi((String(result.url || '').match(/(?:doi\.org|oadoi\.org)\/(10\.\d{4,9}\/[^?#\s]+)/i) || [])[1]);
}

/** App-assigned source id from the normalized URL — same value as electron/selfSearch/index.cjs sourceIdOf. */
export async function sourceIdOf(url: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(normalizeUrl(url) || url)));
  return `src-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10)}`;
}
