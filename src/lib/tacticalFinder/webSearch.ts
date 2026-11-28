import { aiProvider } from '../ai/provider';
import type { AskAiRequest, AskAiResult, GroundingSource } from '../ai/types';
import { normalize } from './analyze';
import { resolveName } from './techniqueIndex';

// WEB SEARCH mode: one Gemini call with Google Search grounding (the same aiProvider → electron/gemini.cjs |
// supabase gemini-ask path every other grounded feature uses — no new key handling, no new endpoint).
// Honesty rules:
//  • the answer counts as a web search only when Gemini reports grounding sources (groundingChunks); without them
//    nothing is shown — "웹 검색이 실행되지 않음", never model-only knowledge dressed up as a web result
//  • a URL the model writes is shown as a source only when it matches a grounding source (same URL, or the same site
//    as a grounding chunk's site title); an item with no matching source is listed as AI 조합 / 출처 미확인
//  • results never mix with the app-DB results, are never saved automatically, and have their own cache.

export type WebTab = 'technique' | 'combo';
export type WebItemKind = 'technique' | 'setup' | 'combo';
export type Verification = 'verified' | 'partial' | 'unverified';

export interface WebStep {
  name: string;
  role: string;
  /** set when the name matches a technique in the MARTIALDEX DB (shown as a link; the item stays a web result) */
  techniqueId: string | null;
}

export interface WebSource {
  title: string;
  url: string;
  /** true = this URL is one of the grounding sources Gemini actually retrieved */
  grounded: boolean;
}

export interface WebItem {
  key: string;
  kind: WebItemKind;
  /** web-confirmed = backed by at least one retrieved source; ai-composed = the model's own combination */
  origin: 'web-confirmed' | 'ai-composed';
  name: string;
  purpose: string;
  steps: WebStep[];
  reason: string;
  sources: WebSource[];
  verification: Verification;
  verificationNote: string;
}

export type WebStatus = 'ok' | 'empty' | 'no-grounding' | 'error';

export interface WebSearchResult {
  tab: WebTab;
  query: string;
  status: WebStatus;
  items: WebItem[];
  /** every source Gemini's search retrieved, as returned (often vertexaisearch redirect links) */
  groundingSources: GroundingSource[];
  /** the real queries Gemini's search issued (empty when the API did not report them) */
  searchQueries: string[];
  error: { code: string; message: string } | null;
  elapsedMs: number;
  cached: boolean;
  at: number;
}

type Ask = (r: AskAiRequest) => Promise<AskAiResult>;

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, WebSearchResult>();
const inflight = new Map<string, Promise<WebSearchResult>>();

export function clearWebCache() {
  cache.clear();
  inflight.clear();
}

const SYSTEM = (tab: WebTab) =>
  [
    '당신은 격투기·무술 기술을 웹에서 조사하는 연구 도우미입니다. 반드시 Google 검색 도구로 실제 웹 자료를 찾아 답하세요.',
    '스포츠·훈련 규칙 안에서 쓰는 기술만 다룹니다. 상대를 다치게 하는 것이 목적인 요청이면 items를 빈 배열로 반환하세요.',
    tab === 'technique'
      ? '사용자의 목적에 맞는 기술(technique), 그 기술로 이어지는 셋업(setup)과 콤보(combo)를 찾으세요.'
      : '사용자가 말한 목적을 이루는 셋업(setup)과 콤보(combo)만 찾으세요. 단일 기술 설명은 넣지 마세요.',
    '출력은 JSON 객체 하나: {"items":[{"kind":"technique|setup|combo","name":"","purpose":"","steps":[{"name":"기술 영어 이름","role":"이 단계의 역할"}],"reason":"목적에 맞는 이유","sourceUrls":["실제로 참고한 페이지 URL"],"composed":false}]}',
    '규칙: 검색으로 찾은 자료에 실제로 나온 구성만 composed:false로 쓰고 sourceUrls에 그 페이지 URL을 넣으세요.',
    '자료에 그대로 나오지 않고 당신이 여러 자료를 조합해 만든 구성은 composed:true로 표시하세요. 지어낸 URL을 절대 쓰지 마세요.',
    '기술 이름은 널리 쓰이는 영어 이름으로 쓰고, 목적·역할·이유는 한국어로 짧게 쓰세요. 최대 8개.',
  ].join('\n');

/** The JSON object inside a grounded answer (grounded answers can't use JSON mode, so prose / fences may surround it). */
function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function host(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

const REDIRECT_HOST = /vertexaisearch\.cloud\.google\.com|google\.com$/;

/** The site a grounding source belongs to: its own host, or — for Google's redirect links — the chunk title (a domain). */
function siteOf(g: GroundingSource): string | null {
  const h = host(g.uri);
  if (h && !REDIRECT_HOST.test(h)) return h;
  const t = g.title.trim().toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? t : null;
}

function sameSite(a: string, b: string) {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

interface RawItem {
  kind?: unknown;
  name?: unknown;
  purpose?: unknown;
  steps?: unknown;
  reason?: unknown;
  sourceUrls?: unknown;
  composed?: unknown;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function toItem(raw: RawItem, grounding: GroundingSource[], tab: WebTab): WebItem | null {
  const name = str(raw.name, 120);
  if (!name) return null;
  let kind: WebItemKind = raw.kind === 'setup' || raw.kind === 'combo' || raw.kind === 'technique' ? raw.kind : 'combo';
  const steps: WebStep[] = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s) => {
      const n = typeof s === 'string' ? s.trim() : str((s as { name?: unknown })?.name, 80);
      if (!n) return null;
      const hit = resolveName(n);
      return { name: n, role: typeof s === 'string' ? '' : str((s as { role?: unknown })?.role, 160), techniqueId: hit?.t.id ?? null };
    })
    .filter((s): s is WebStep => !!s)
    .slice(0, 8);
  if (tab === 'combo' && kind === 'technique') {
    if (steps.length < 2) return null; // the combo tab lists setups and combos only
    kind = 'combo';
  }
  if (kind !== 'technique' && steps.length < 2) kind = 'technique';
  if (tab === 'combo' && kind === 'technique') return null;

  const sites = grounding.map((g) => ({ g, site: siteOf(g) }));
  const cited = (Array.isArray(raw.sourceUrls) ? raw.sourceUrls : []).filter((u): u is string => typeof u === 'string').slice(0, 6);
  const sources: WebSource[] = [];
  let unmatched = 0;
  for (const u of cited) {
    const exact = grounding.find((g) => g.uri === u);
    if (exact) {
      sources.push({ title: exact.title || host(u) || u, url: exact.uri, grounded: true });
      continue;
    }
    const h = host(u);
    const m = h ? sites.find((x) => x.site && sameSite(x.site, h)) : undefined;
    if (m && h) {
      // the cited page's SITE is one Gemini's search actually retrieved: only the retrieved page (grounding link) is
      // shown — the URL the model wrote is not itself a search result, so it is dropped
      if (!sources.some((s) => s.url === m.g.uri)) sources.push({ title: m.g.title || m.site!, url: m.g.uri, grounded: true });
    } else unmatched++;
  }
  const groundedCount = sources.filter((s) => s.grounded).length;
  const composed = raw.composed === true;
  let verification: Verification;
  let note: string;
  if (groundedCount && !unmatched) {
    verification = 'verified';
    note = '연결된 링크는 Gemini 검색이 실제로 찾은 페이지입니다. 이 구성·목적이 그 페이지에 그대로 나오는지는 앱이 대조하지 않았습니다 — 링크에서 확인하세요.';
  } else if (groundedCount) {
    verification = 'partial';
    note = `연결된 링크는 Gemini 검색이 실제로 찾은 페이지입니다 (내용 대조는 링크에서 확인). AI가 적은 출처 중 ${unmatched}개는 검색 결과에 없어 표시하지 않았습니다.`;
  } else {
    verification = 'unverified';
    note = cited.length ? 'AI가 적은 출처가 검색 결과와 일치하지 않아 표시하지 않았습니다.' : '인용 출처가 없습니다.';
  }
  const origin = !composed && groundedCount ? 'web-confirmed' : 'ai-composed';
  if (origin === 'ai-composed' && !composed) note = `출처 미확인 — ${note}`;
  return {
    key: '',
    kind,
    origin,
    name,
    purpose: str(raw.purpose),
    steps,
    reason: str(raw.reason, 500),
    sources,
    verification,
    verificationNote: note,
  };
}

/** The same item found on several pages: same step sequence (or, for single techniques, the same name) → one item, sources merged. */
function dedupe(items: WebItem[]): WebItem[] {
  const out = new Map<string, WebItem>();
  for (const it of items) {
    const seq = it.steps.length ? it.steps.map((s) => s.techniqueId ?? normalize(s.name)).join('>') : normalize(it.name);
    const k = `${it.kind === 'technique' ? 't' : 'c'}:${seq}`;
    const prev = out.get(k);
    if (!prev) {
      out.set(k, { ...it, key: `web:${k}` });
      continue;
    }
    for (const s of it.sources) if (!prev.sources.some((x) => x.url === s.url)) prev.sources.push(s);
    if (prev.origin === 'ai-composed' && it.origin === 'web-confirmed') {
      prev.origin = 'web-confirmed';
      prev.verification = it.verification;
      prev.verificationNote = it.verificationNote;
    }
    if (!prev.reason && it.reason) prev.reason = it.reason;
  }
  return [...out.values()];
}

const ERROR_TEXT: Record<string, string> = {
  NO_API_KEY: 'Gemini API 키가 설정되어 있지 않아 웹 검색을 할 수 없습니다.',
  INVALID_API_KEY: 'Gemini API 키가 올바르지 않아 웹 검색을 할 수 없습니다.',
  QUOTA_EXCEEDED: 'Gemini 사용 한도를 넘어 웹 검색을 할 수 없습니다.',
  // Gemini returns 429 both for a short burst limit and for an exhausted daily / plan quota (RESOURCE_EXHAUSTED —
  // seen in the live check), and the transport can't tell them apart — so say both
  RATE_LIMIT: 'Gemini 사용량 한도에 걸려 웹 검색을 하지 못했습니다 (요청 빈도 한도, 또는 API 키의 일일·요금제 한도 소진). 잠시 뒤에도 계속되면 API 키의 요금제·사용량을 확인해 주세요.',
  NETWORK: '네트워크에 연결할 수 없어 웹 검색을 하지 못했습니다.',
  TIMEOUT: '웹 검색 시간이 초과되었습니다.',
  UNAUTHORIZED: '로그인이 필요하거나 권한이 없어 웹 검색을 하지 못했습니다.',
  PARSE_ERROR: 'AI 응답을 읽을 수 없어 결과를 표시하지 않았습니다.',
};

export function webCacheKey(tab: WebTab, query: string) {
  return `web|${tab}|${normalize(query)}`;
}

export async function webSearch(query: string, tab: WebTab, opts: { ask?: Ask; signal?: AbortSignal; force?: boolean } = {}): Promise<WebSearchResult> {
  const q = query.trim();
  const key = webCacheKey(tab, q);
  const hit = cache.get(key);
  if (hit && !opts.force && Date.now() - hit.at < TTL_MS) return { ...hit, cached: true };
  const running = inflight.get(key);
  if (running && !opts.force) return running; // the same search clicked twice → one Gemini call
  const p = run(q, tab, opts.ask ?? ((r) => aiProvider.ask(r))).finally(() => inflight.delete(key));
  inflight.set(key, p);
  const r = await p;
  // only a real outcome is cached; errors are retried next time
  if (r.status === 'ok' || r.status === 'empty') cache.set(key, r);
  return r;
}

async function run(q: string, tab: WebTab, ask: Ask): Promise<WebSearchResult> {
  const t0 = performance.now();
  const base = { tab, query: q, items: [] as WebItem[], groundingSources: [] as GroundingSource[], searchQueries: [] as string[], error: null, cached: false, at: Date.now() };
  const done = (x: Partial<WebSearchResult> & { status: WebStatus }): WebSearchResult => ({ ...base, ...x, elapsedMs: Math.round(performance.now() - t0) });
  let res: AskAiResult;
  try {
    res = await ask({
      systemInstruction: SYSTEM(tab),
      contextText: '',
      history: [],
      question: `목적: ${q}`,
      useSearchGrounding: true,
      // WEB SEARCH is the user's explicit choice of the Gemini web search for this search (the local engine
      // cannot search the web) — never an automatic fallback from the app-DB mode
      engine: 'gemini',
      temperature: 0.2,
      maxOutputTokens: 4096,
    });
  } catch (e) {
    return done({ status: 'error', error: { code: 'UNKNOWN', message: `웹 검색 중 오류: ${e instanceof Error ? e.message : String(e)}` } });
  }
  if (!res.ok) return done({ status: 'error', error: { code: res.code, message: ERROR_TEXT[res.code] ?? res.message } });
  const grounding = (res.groundingSources ?? []).filter((g) => g.uri);
  const queries = res.webSearchQueries ?? [];
  if (!grounding.length) {
    // Gemini answered without retrieving anything — not a web search; its text is not shown
    return done({
      status: 'no-grounding',
      searchQueries: queries,
      error: { code: 'NO_GROUNDING', message: '웹 검색이 실행되지 않았습니다 (Gemini가 검색 출처를 돌려주지 않음). 검색 없이 만든 답은 웹 결과로 표시하지 않습니다.' },
    });
  }
  const json = extractJson(res.text) as { items?: unknown } | null;
  if (!json || !Array.isArray(json.items)) return done({ status: 'error', groundingSources: grounding, searchQueries: queries, error: { code: 'PARSE_ERROR', message: ERROR_TEXT.PARSE_ERROR } });
  const items = dedupe(json.items.map((x) => toItem((x ?? {}) as RawItem, grounding, tab)).filter((x): x is WebItem => !!x));
  return done({ status: items.length ? 'ok' : 'empty', items, groundingSources: grounding, searchQueries: queries });
}
