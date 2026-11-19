// On-device (Android) research — src/lib/selfResearch/researchCore.ts + deviceResearch.ts.
//   1. parity  : researchCore.ts gives exactly what electron/selfSearch/core.cjs gives on the same inputs
//   2. offline : the pipeline with a fake HTTP layer (fixtures; any unexpected URL fails the request)
//   3. --live  : the same pipeline against the real public sources (Bing, DuckDuckGo, Wikipedia, YouTube,
//                Crossref, OpenAlex, arXiv, doi.org) with Node's fetch. No account, no API key, no paid
//                service, nothing written anywhere. Skipped without --live.
// Run: node .devtools/test-device-research.mjs [--live]
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LIVE = process.argv.includes('--live');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-research-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
fs.writeFileSync(entry, `export * as C from ${JSON.stringify(path.join(APP, 'src/lib/selfResearch/researchCore.ts'))};\nexport * as D from ${JSON.stringify(path.join(APP, 'src/lib/selfResearch/deviceResearch.ts'))};\n`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { C, D } = await import(pathToFileURL(out).href);
const core = require(path.join(APP, 'electron/selfSearch/core.cjs'));
const media = require(path.join(APP, 'electron/selfSearch/media.cjs'));
const { detectKind } = require(path.join(APP, 'electron/selfSearch/index.cjs'));
const { DOMParser } = require('linkedom');
const { Readability } = require('@mozilla/readability');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- 1. parity with core.cjs
const urls = ['https://www.example.com/a/?utm_source=x&b=2#top', 'https://youtu.be/abc123?t=4', 'https://m.youtube.com/watch?v=abc123&feature=share', 'javascript:alert(1)', 'nope', 'https://ko.wikipedia.org/wiki/%EC%9E%BD', 'https://namu.wiki/w/나무위키:대문', 'https://www.mdpi.com/x', 'https://dept.snu.ac.kr/p', 'https://www.tapology.com/f', 'https://www.reddit.com/r/bjj', 'https://cafe.naver.com/x', 'https://blog.naver.com/y', 'https://www.ufc.com/athlete', 'https://someblog.xyz', 'https://doi.org/10.1234/abc.5', 'https://www.youtube.com/shorts/abcdefghijk', 'https://youtu.be/abcdefghijk'];
check('normalizeUrl 동일', same(urls.map(C.normalizeUrl), urls.map(core.normalizeUrl)));
check('hostOf 동일', same(urls.map(C.hostOf), urls.map(core.hostOf)));
check('sourceTypeOf 동일', same(urls.map(C.sourceTypeOf), urls.map(core.sourceTypeOf)));
const texts = ['How to throw a JAB — setup', '잽 연습 방법 알려줘', '코너 맥그리거 영상 보여줘', '그래플링 부상 논문', 'Muay Thai clinch study'];
check('tokens 동일', same(texts.map(C.tokens), texts.map(core.tokens)));
check('queryOverlap 동일', same(texts.map((t) => C.queryOverlap(t, 'Jab setup for boxing', '잽 연습')), texts.map((t) => core.queryOverlap(t, 'Jab setup for boxing', '잽 연습'))));
check('detectKind 동일', same(texts.map(C.detectKind), texts.map(detectKind)));
check('youtubeId 동일', same(urls.map(C.youtubeId), urls.map(media.youtubeId)));
const dois = [{ doi: '10.1000/xyz' }, { url: 'https://doi.org/10.1234/abc.5' }, { doi: 'doi: 10.55/zz' }, { doi: 'bad' }, {}];
check('doiOf 동일', same(dois.map(C.doiOf), dois.map(media.doiOf)));
const dates = ['not a date', '', '2099-01-01', '2025-04-04', '1980-01-01', '2024-02-03T10:00:00Z'];
check('toIsoDate 동일', same(dates.map(C.toIsoDate), dates.map(core.toIsoDate)));
const rel = [
  { sourceType: 'academic', engineCount: 2, extractionStatus: 'ok', publishedAt: '2024-01-02T00:00:00Z' },
  { sourceType: 'forum', engineCount: 1, extractionStatus: 'blocked' },
  { sourceType: 'video', engineCount: 1, extractionStatus: 'ok' },
  { sourceType: 'web', engineCount: 3, extractionStatus: 'failed' },
];
check('assessReliability 동일', same(rel.map(C.assessReliability), rel.map(core.assessReliability)));
const raw = [
  { title: 'Jab Setups', url: 'https://www.a.com/jab?utm_medium=x', engines: ['bing'], position: 2 },
  { title: 'Jab Setups', url: 'https://a.com/jab', engines: ['yahoo'], position: 0, snippet: 's', publishedAt: '2024-05-01' },
  { title: 'Jab setups!', url: 'https://a.com/jab-2', engines: ['naver'], position: 5 },
  { title: 'Other', url: 'https://b.com/x', engines: ['bing'], position: 1, doi: '10.1/x', authors: ['A'] },
  { title: '', url: 'https://c.com', engines: ['bing'] },
];
const clone = () => JSON.parse(JSON.stringify(raw));
const dTs = C.dedupResults(clone());
const dJs = core.dedupResults(clone());
check('dedupResults 동일', same(dTs, dJs), { dTs, dJs });
check('rankResults 동일', same(C.rankResults('jab setup boxing', dTs.results), core.rankResults('jab setup boxing', dJs.results)));
const mm = [['https://namu.wiki/w/나무위키:대문', '체중 감량 - 나무위키'], ['https://ko.wikipedia.org/wiki/잽', '잽 - 위키백과'], ['https://ko.wikipedia.org/wiki/훅', '잽 - 위키백과'], ['https://namu.wiki/', '무엇 - 나무위키'], ['https://x.com/a', 'b']];
check('titleUrlMismatch 동일', same(mm.map(([u, t]) => C.titleUrlMismatch(u, t)), mm.map(([u, t]) => core.titleUrlMismatch(u, t))));
const sid = (u) => `src-${crypto.createHash('sha1').update(core.normalizeUrl(u) || u).digest('hex').slice(0, 10)}`;
check('sourceId = 데스크톱과 같은 값', same(await Promise.all(urls.slice(0, 6).map(C.sourceIdOf)), urls.slice(0, 6).map(sid)));

// ---------------------------------------------------------------- shared deps
const parse = (text, type) => new DOMParser().parseFromString(text, type === 'text/xml' ? 'text/xml' : 'text/html');
const readability = async () => Readability;

function fakeHttp(routes, log) {
  return {
    async request(url, opts) {
      log.push(url);
      for (const [re, res] of routes) if (re.test(url)) return typeof res === 'function' ? res(url, opts) : res;
      throw new Error(`unexpected ${url}`);
    },
  };
}
const html = (text) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, text });
const json = (obj) => ({ status: 200, headers: { 'content-type': 'application/json' }, text: JSON.stringify(obj) });
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ARTICLE = `<html><head><title>Jab guide</title><meta property="article:published_time" content="2024-03-05T00:00:00Z"></head><body><article><h1>How to throw the jab</h1>${'<p>The jab is the lead straight punch in boxing. Keep the rear hand at the chin, rotate the lead shoulder and return the fist along the same line. Practise the jab slowly before adding speed.</p>'.repeat(6)}</article></body></html>`;

// ---------------------------------------------------------------- 2. offline pipeline
{
  const log = [];
  const http = fakeHttp(
    [
      [/bing\.com\/search/, html(`<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=x&u=a1${b64('https://boxing.example.com/jab-guide')}&ntb=1">How to throw the jab - boxing guide</a></h2><div class="b_caption"><p>Jab setup and technique for boxing beginners.</p></div></li><li class="b_algo"><h2><a href="https://www.youtube.com/watch?v=abcdefghijk">Jab drill video</a></h2><p>jab</p></li><li class="b_algo"><h2><a href="https://cooking.example.com/pasta">Pasta recipe</a></h2><p>dinner</p></li></ol>`)],
      [/duckduckgo\.com\/html/, html(`<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://boxing.example.com/jab-guide?utm_source=ddg')}&rut=1">How to throw the jab</a><a class="result__snippet">jab technique boxing</a></div><div class="result result--ad"><a class="result__a" href="https://ads.example.com">jab ad</a></div>`)],
      [/en\.wikipedia\.org\/w\/api\.php/, json({ query: { search: [{ title: 'Jab', snippet: 'A <span class="searchmatch">jab</span> is a type of punch used in boxing' }] } })],
      [/robots\.txt$/, (u) => (u.includes('wikipedia') ? { status: 200, headers: {}, text: 'User-agent: *\nDisallow: /wiki/Jab' } : { status: 404, headers: {}, text: '' })],
      [/boxing\.example\.com\/jab-guide/, html(ARTICLE)],
    ],
    log
  );
  const r = await D.deviceResearch({ http, parse, readability }, { query: 'jab setup boxing' });
  check('웹: 성공 + backend=device', r.ok && r.diagnostics.backend === 'device' && r.kind === 'web', r);
  const guide = r.ok && r.results.find((x) => x.url === 'https://boxing.example.com/jab-guide');
  check('Bing 리디렉트 URL 해독 + DuckDuckGo 결과와 병합(엔진 2곳)', guide && guide.engines.includes('bing') && guide.engines.includes('duckduckgo'), r.ok && r.results.map((x) => [x.url, x.engines]));
  check('광고 결과 제외', r.ok && !r.results.some((x) => x.url.includes('ads.example')));
  check('관련 없는 결과(파스타) 제거·집계', r.ok && !r.results.some((x) => x.url.includes('pasta')) && r.diagnostics.irrelevantRemoved >= 1, r.diagnostics);
  check('본문 추출 + 페이지 게시일', guide && guide.extraction.status === 'ok' && guide.content?.includes('lead straight punch') && guide.publishedAt?.startsWith('2024-03-05') && guide.publishedAtSource === 'page_metadata', guide);
  const wiki = r.ok && r.results.find((x) => x.url.includes('wikipedia'));
  check('robots.txt 금지 페이지는 읽지 않음', wiki && wiki.extraction.status === 'robots' && !log.some((u) => /wikipedia\.org\/wiki\/Jab$/.test(u)), wiki);
  check('sourceId·fetchedAt 부여', r.ok && r.results.every((x) => /^src-[0-9a-f]{10}$/.test(x.sourceId) && x.fetchedAt) && guide.sourceId === sid(guide.url));
  check('영상 URL은 본문 추출 안 함', r.ok && r.results.filter((x) => x.sourceType === 'video').every((x) => x.extraction.status === 'not_attempted'));
}
{
  // one engine walled, others fine → reported, not retried
  const log = [];
  const http = fakeHttp(
    [
      [/bing\.com/, { status: 429, headers: {}, text: '' }],
      [/duckduckgo/, html('<html><body>If this error persists, please let us know: anomaly-modal</body></html>')],
      [/wikipedia\.org\/w\/api/, json({ query: { search: [{ title: 'Jab', snippet: 'jab boxing punch' }] } })],
      [/robots\.txt/, { status: 404, headers: {}, text: '' }],
      [/wikipedia\.org\/wiki\//, html(ARTICLE)],
    ],
    log
  );
  const r = await D.deviceResearch({ http, parse, readability }, { query: 'jab boxing' });
  check('차단된 엔진 보고(재시도 없음)', r.ok && r.diagnostics.failedEngines.map((f) => f.engine).sort().join() === 'bing,duckduckgo' && log.filter((u) => u.includes('bing')).length === 1, r.ok && r.diagnostics.failedEngines);
  check('남은 엔진 결과로 답함', r.ok && r.results.length === 1 && r.results[0].engines[0] === 'wikipedia');
}
{
  const http = { request: async () => { throw new Error('connect failed'); } };
  const r = await D.deviceResearch({ http, parse, readability }, { query: '잽 연습' });
  check('오프라인 = SEARCH_FAILED + 인터넷 연결 안내 (빈 성공 아님)', !r.ok && r.code === 'SEARCH_FAILED' && r.message.includes('인터넷'), r);
}
{
  const yt = { contents: { a: [{ videoRenderer: { videoId: 'abcdefghijk', title: { runs: [{ text: 'Jab tutorial for beginners' }] }, ownerText: { runs: [{ text: 'Coach K' }] }, lengthText: { simpleText: '4:12' } } }, { videoRenderer: { videoId: 'zzzzzzzzzzz', title: { runs: [{ text: 'Jab mistakes' }] }, ownerText: { runs: [{ text: 'X' }] } } }] } };
  const http = fakeHttp(
    [
      [/youtube\.com\/results/, html(`<script>var ytInitialData = ${JSON.stringify(yt)};</script>`)],
      [/oembed.*abcdefghijk/, json({ author_name: 'Coach K' })],
      [/oembed.*zzzzzzzzzzz/, { status: 401, headers: {}, text: '' }],
    ],
    []
  );
  const r = await D.deviceResearch({ http, parse, readability }, { query: 'jab 영상', kind: 'video' });
  const a = r.ok && r.results.find((x) => x.video?.videoId === 'abcdefghijk');
  const z = r.ok && r.results.find((x) => x.video?.videoId === 'zzzzzzzzzzz');
  check('영상: YouTube id·채널·길이·썸네일', a && a.video.channel === 'Coach K' && a.video.duration === '4:12' && a.video.thumbnail === 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', r);
  check('영상: 퍼가기 허용/금지 구분', a?.video.embed === 'embeddable' && z?.video.embed === 'not_embeddable', [a?.video, z?.video]);
}
{
  const http = fakeHttp(
    [
      [/api\.crossref\.org/, json({ message: { items: [{ DOI: '10.1234/grap', title: ['Grappling injuries in competition'], author: [{ given: 'A', family: 'Kim' }], 'container-title': ['J Sports'], publisher: 'P', issued: { 'date-parts': [[2021]] } }] } })],
      [/api\.openalex\.org/, json({ results: [{ display_name: 'Grappling injuries in competition', doi: 'https://doi.org/10.1234/grap', publication_year: 2021, authorships: [] }, { display_name: 'Injury epidemiology of grappling athletes', doi: 'https://doi.org/10.5678/epi', publication_date: '2020-06-01', publication_year: 2020, abstract_inverted_index: { grappling: [0], injuries: [1] }, authorships: [{ author: { display_name: 'B Lee' } }] }] })],
      [/export\.arxiv\.org/, { status: 200, headers: {}, text: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2101.00001v1</id><published>2021-01-01T00:00:00Z</published><title>Pose estimation for grappling injuries</title><summary>grappling</summary><author><name>C Park</name></author></entry></feed>' }],
      [/doi\.org\/10\.1234\/grap/, { status: 302, headers: {}, text: '' }],
      [/doi\.org\/10\.5678\/epi/, { status: 404, headers: {}, text: '' }],
    ],
    []
  );
  const r = await D.deviceResearch({ http, parse, readability }, { query: 'grappling injuries study', kind: 'paper' });
  const g = r.ok && r.results.find((x) => x.paper?.doi === '10.1234/grap');
  check('논문: 같은 DOI는 하나로 (Crossref+OpenAlex 병합)', r.ok && r.results.filter((x) => x.paper?.doi === '10.1234/grap').length === 1, r.ok && r.results.map((x) => x.url));
  check('논문: 연도만 있으면 날짜를 만들지 않음 (year만)', g && !g.publishedAt && g.paper.year === 2021, g);
  check('논문: DOI 확인 결과(등록/없음)', g?.paper.doiStatus === 'registered' && r.results.find((x) => x.paper?.doi === '10.5678/epi')?.paper.doiStatus === 'not_found');
  check('논문: arXiv 결과 포함', r.ok && r.results.some((x) => x.engines.includes('arxiv')), r.ok && r.diagnostics);
}
{
  const http = fakeHttp(
    [
      [/titles=%EC%BD%94%EB%84%88/, json({ query: { pages: { 1: { title: '코너 맥그레거', extract: '아일랜드의 종합격투기 선수', langlinks: [{ '*': 'Conor McGregor' }] } } } })],
      [/titles=%ED%86%A0%ED%91%B8%EB%A6%AC%EC%95%84$/, json({ query: { pages: { '-1': { title: '토푸리아', missing: '' } } } })],
      [/srsearch=/, json({ query: { search: [{ title: '일리아 토푸리아' }, { title: '토푸리아' }] } })],
      [/titles=%EC%9D%BC%EB%A6%AC%EC%95%84/, json({ query: { pages: { 2: { title: '일리아 토푸리아', extract: '조지아-스페인의 종합격투기 선수', langlinks: [{ '*': 'Ilia Topuria' }] } } } })],
    ],
    []
  );
  const deps = { http, parse, readability };
  const a = await D.deviceEntity(deps, '코너 맥그리거');
  check('이름: 위키백과 영어 문서 연결로 영문명', a.ok && a.en === 'Conor McGregor' && a.ko === '코너 맥그레거' && a.source.startsWith('https://ko.wikipedia.org/wiki/'), a);
  const b = await D.deviceEntity(deps, '토푸리아');
  check('이름: 부분 이름 → 전체 이름 문서 (via 표시)', b.ok && b.en === 'Ilia Topuria' && b.via?.includes('일리아 토푸리아'), b);
}
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const def = D.deviceSearchEnabled();
  D.setDeviceSearchEnabled(false);
  const off = D.deviceSearchEnabled();
  D.setDeviceSearchEnabled(true);
  check('스위치: 기본 ON, 끄기/켜기 저장', def === true && off === false && D.deviceSearchEnabled() === true);
}
{
  // the app's own wiring on Android: @capacitor/core replaced by a stub that says "android, native";
  // CapacitorHttp answers the DuckDuckGo fixture only (everything else fails as a network error)
  const stub = path.join(dir, 'capacitor-stub.mjs');
  fs.writeFileSync(
    stub,
    `export const Capacitor = { getPlatform: () => globalThis.__platform, isNativePlatform: () => globalThis.__platform !== 'web', isPluginAvailable: () => false };
export const CapacitorHttp = { request: async (o) => { globalThis.__httpLog.push(o); if (o.url.includes('duckduckgo')) return { status: 200, headers: { 'Content-Type': 'text/html' }, data: '<div class="result"><a class="result__a" href="https://jab.example.com/guide">Jab guide boxing</a><a class="result__snippet">jab boxing</a></div>' }; throw new Error('offline'); } };
export const registerPlugin = () => new Proxy({}, { get: () => async () => ({}) });
export class WebPlugin {}
`
  );
  const wEntry = path.join(dir, 'wiring.ts');
  const wOut = path.join(dir, 'wiring.mjs');
  fs.writeFileSync(wEntry, `export * as T from ${JSON.stringify(path.join(APP, 'src/lib/selfAi/transport.ts'))};\nexport * as S from ${JSON.stringify(path.join(APP, 'src/lib/selfResearch/searchSwitch.ts'))};\nexport * as P from ${JSON.stringify(path.join(APP, 'src/lib/selfResearch/provider.ts'))};\n`);
  await build({ entryPoints: [wEntry], bundle: true, format: 'esm', platform: 'node', outfile: wOut, logLevel: 'error', alias: { '@capacitor/core': stub }, external: ['@mozilla/readability'] });
  globalThis.window = globalThis;
  globalThis.DOMParser = DOMParser;
  globalThis.__httpLog = [];
  globalThis.__platform = 'android';
  const { T, S, P } = await import(pathToFileURL(wOut).href);
  check('Android(서버 없음): 검색 백엔드 사용 가능', T.selfAiBackend().research.available === true && P.selfResearchProvider.available());
  const st = await S.getSelfSearchStatus();
  check('Android: 스위치 사용 가능 · 켜짐 · via=device', st.supported && st.enabled && st.phase === 'running' && st.via?.kind === 'device', st);
  const r = await P.selfResearchProvider.search({ query: 'jab boxing guide', extractTop: 0 });
  check('Android: 코치 검색이 기기에서 실행 (CapacitorHttp)', r.ok && r.diagnostics.backend === 'device' && r.results[0]?.url === 'https://jab.example.com/guide' && globalThis.__httpLog.some((o) => o.url.includes('duckduckgo') && o.responseType === 'text'), r);
  await S.setSelfSearchEnabled(false);
  const st2 = await S.getSelfSearchStatus();
  const r2 = await P.selfResearchProvider.search({ query: 'other query' });
  check('Android: 끄면 DISABLED (다른 검색으로 바꾸지 않음)', !st2.enabled && st2.phase === 'off' && !r2.ok && r2.code === 'DISABLED', [st2, r2]);
  await S.setSelfSearchEnabled(true);
  localStorage.setItem('martialdex:self-ai-server', JSON.stringify({ url: 'https://ai.example.com', token: 't' }));
  const st3 = await S.getSelfSearchStatus().catch(() => null);
  check('Android + 자체 AI 서버 연결: 서버 검색 우선', st3?.via?.kind === 'server', st3);
  localStorage.removeItem('martialdex:self-ai-server');
  globalThis.__platform = 'web';
  check('웹 브라우저: 기존대로 사용 불가', T.selfAiBackend().research.available === false && !(await S.getSelfSearchStatus()).supported);
}

// ---------------------------------------------------------------- 3. live
if (LIVE) {
  const http = {
    async request(url, { headers, timeoutMs, method = 'GET', noRedirect }) {
      const r = await fetch(url, { method, headers, redirect: noRedirect ? 'manual' : 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const text = method === 'HEAD' ? '' : await r.text();
      return { status: r.status, headers: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])), text };
    },
  };
  const deps = { http, parse, readability };
  const show = (r) => (r.ok ? `${r.results.length}건 · 엔진실패 ${JSON.stringify(r.diagnostics.failedEngines)} · 본문 ${JSON.stringify(r.diagnostics.extraction)}` : `${r.code} ${r.message}`);
  for (const [q, kind] of [['잽 펀치 기술', 'web'], ['muay thai clinch technique', 'web'], ['jab tutorial boxing', 'video'], ['grappling injury', 'paper']]) {
    const t = Date.now();
    const r = await D.deviceResearch(deps, { query: q, kind });
    console.log(`  live ${kind} "${q}": ${show(r)} · ${Date.now() - t}ms`);
    if (r.ok) for (const x of r.results.slice(0, 3)) console.log(`    - [${x.engines.join('+')}] ${x.title.slice(0, 70)} · ${x.url.slice(0, 90)}${x.video ? ` · embed=${x.video.embed}` : ''}${x.paper?.doi ? ` · doi=${x.paper.doiStatus}` : ''}`);
    check(`live ${kind} "${q}": 결과 있음`, r.ok && r.results.length > 0, r.ok ? r.diagnostics : r);
  }
  const e = await D.deviceEntity(deps, '코너 맥그리거');
  console.log(`  live entity: ${JSON.stringify(e)}`);
  check('live 이름 확인: 코너 맥그리거 → Conor McGregor', e.ok && e.en === 'Conor McGregor', e);
} else console.log('(live 생략 — --live로 실제 공개 검색 소스 호출)');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
