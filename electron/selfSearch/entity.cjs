// A person's name as written in another language, from a fetched source — never guessed.
// "코너 맥그리거" → SearXNG's Wikipedia infobox points at the Korean article ("코너 맥그레거");
// that page's interlanguage link to English Wikipedia gives "Conor McGregor".
// Used so fighter research can search English analysis sites with the right name.

const { searxSearch, baseUrl } = require('./searxng.cjs');
const { robotsAllows } = require('./extract.cjs');

const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; MARTIALDEX-Research/0.1; +local self-hosted study assistant)';

async function wikipediaInfobox(name) {
  try {
    const params = new URLSearchParams({ q: name, format: 'json', engines: 'wikipedia', language: 'ko' });
    const r = await fetch(`${baseUrl()}/search?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
    const j = await r.json();
    for (const box of j.infoboxes || []) {
      const u = (box.urls || []).find((x) => /^https:\/\/ko\.wikipedia\.org\/wiki\//.test(x.url));
      if (u) return { title: box.infobox, url: u.url };
    }
  } catch {
    /* search server down / no JSON */
  }
  return null;
}

const COMBAT = /(종합격투기|격투기|권투|복싱|킥복싱|무에타이|레슬링|주짓수|유도|삼보|UFC|ONE 챔피언십|파이터)/;
const squash = (s) => String(s || '').replace(/\s+/g, '');

/** A Korean Wikipedia article → its English counterpart (interlanguage link), checking it is about a fighter. */
async function fromKoArticle(query, title, url, requireCombat) {
  if (!(await robotsAllows(url))) return { ok: false, query, reason: 'robots.txt가 문서 수집을 허용하지 않습니다.' };
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!r.ok) return { ok: false, query, reason: `위키백과 문서를 열지 못했습니다 (HTTP ${r.status}).` };
  const html = await r.text();
  if (requireCombat && !COMBAT.test(html.slice(0, 200000))) return { ok: false, query, ko: title, reason: `「${title}」 문서가 격투기 선수 문서가 아닙니다.` };
  const link = html.match(/<a[^>]*href="https:\/\/en\.wikipedia\.org\/wiki\/([^"#?]+)"[^>]*hreflang="en"/) || html.match(/<a[^>]*hreflang="en"[^>]*href="https:\/\/en\.wikipedia\.org\/wiki\/([^"#?]+)"/);
  if (!link) return { ok: false, query, ko: title, reason: '한국어 문서에 영어 문서 연결이 없습니다.' };
  const en = decodeURIComponent(link[1]).replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
  return { ok: true, query, en, ko: title, source: url };
}

/**
 * A short / partial name ("토푸리아", "맥그리거"): a web search for "<name> 격투기 선수 위키백과",
 * full names on Korean Wikipedia / Namuwiki article titles that contain it. One person → that
 * article; several → ambiguous (never picked at random); a surname-only page is skipped.
 */
async function candidatesFor(query) {
  const r = await searxSearch(`${query} 격투기 선수 위키백과`, { kind: 'web' });
  if (!r.ok) return { failed: r.message || '검색 실패', names: [] };
  const names = new Map();
  for (const x of r.results || []) {
    let title = null;
    let wikiUrl = null;
    try {
      const u = new URL(x.url);
      const path = decodeURIComponent(u.pathname);
      if (u.hostname === 'ko.wikipedia.org' && path.startsWith('/wiki/')) {
        title = path.slice(6).replace(/_/g, ' ');
        wikiUrl = x.url;
      } else if (u.hostname === 'namu.wiki' && path.startsWith('/w/')) title = path.slice(3);
    } catch {
      continue;
    }
    if (!title || /[:/]/.test(title) || title.length > 30) continue;
    title = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
    // a full name containing what was typed, not the bare surname page
    if (squash(title) === squash(query) || !squash(title).includes(squash(query))) continue;
    const prev = names.get(title);
    names.set(title, { title, wikiUrl: prev?.wikiUrl ?? wikiUrl });
  }
  return { failed: null, names: [...names.values()] };
}

/** → { ok:true, query, en, ko, source, via? } | { ok:false, query, reason, candidates? } */
async function resolvePerson(name) {
  const query = String(name || '').trim().slice(0, 80);
  if (!query) return { ok: false, query, reason: '이름이 비어 있습니다.' };
  if (/^[A-Za-z][A-Za-z .'-]+$/.test(query)) return { ok: true, query, en: query, ko: null, source: null };
  try {
    const box = await wikipediaInfobox(query);
    if (box) {
      const r = await fromKoArticle(query, box.title, box.url, false);
      if (r.ok || !/찾지 못/.test(r.reason)) return r;
    }
    const found = await candidatesFor(query);
    if (found.failed) return { ok: false, query, reason: `위키백과에서 이 이름의 문서를 찾지 못했고, 이름 검색도 실패했습니다 (${found.failed}).` };
    if (!found.names.length) return { ok: false, query, reason: '위키백과에서 이 이름의 격투기 선수 문서를 찾지 못했습니다.' };
    if (found.names.length > 1) return { ok: false, query, reason: `같은 이름이 들어간 사람이 여럿입니다: ${found.names.map((n) => n.title).join(', ')} — 전체 이름으로 다시 물어봐 주세요.`, candidates: found.names.map((n) => n.title) };
    const one = found.names[0];
    // the full name's own article (infobox route), else the Wikipedia link the search gave
    const box2 = await wikipediaInfobox(one.title);
    const url = box2?.url ?? one.wikiUrl;
    if (!url) return { ok: false, query, ko: one.title, reason: `「${one.title}」의 위키백과 문서를 찾지 못했습니다.` };
    const r = await fromKoArticle(query, box2?.title ?? one.title, url, true);
    return r.ok ? { ...r, via: `"${query}" → 「${one.title}」(검색으로 찾은 전체 이름)` } : r;
  } catch {
    return { ok: false, query, reason: '위키백과 문서를 읽는 중 오류가 발생했습니다.' };
  }
}

module.exports = { resolvePerson, candidatesFor };
