// Offline tests for the self-hosted search helpers (electron/selfSearch/core.cjs,
// extract.cjs robots parsing, index.cjs pipeline with a fake SearXNG + fake pages).
// No network: global fetch is replaced and any unexpected URL fails the test.
// Run: node .devtools/test-self-search.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

const core = require('../electron/selfSearch/core.cjs');

// --- URL normalisation / dedup
check('utm·fragment·www 제거', core.normalizeUrl('https://www.example.com/a/?utm_source=x&b=2#top') === 'example.com/a?b=2');
check('youtu.be = youtube watch', core.normalizeUrl('https://youtu.be/abc123?t=4') === core.normalizeUrl('https://m.youtube.com/watch?v=abc123&feature=share'));
check('non-http 거부', core.normalizeUrl('javascript:alert(1)') === null && core.normalizeUrl('nope') === null);
const d = core.dedupResults([
  { title: 'Jab Setups', url: 'https://www.a.com/jab?utm_medium=x', engines: ['bing'], position: 2 },
  { title: 'Jab Setups', url: 'https://a.com/jab', engines: ['yahoo'], position: 0, snippet: 's' },
  { title: 'Jab setups!', url: 'https://a.com/jab-2', engines: ['naver'], position: 5 },
  { title: 'Other', url: 'https://b.com/x', engines: ['bing'], position: 1 },
  { title: '', url: 'https://c.com', engines: ['bing'] },
]);
check('같은 URL 병합 + 엔진 합침', d.results.length === 2 && d.results[0].engines.join() === 'bing,yahoo,naver' && d.results[0].bestPosition === 0, d);
check('제거 수 집계', d.dropped === 3, d.dropped);
check('검색 요약 보존', d.results[0].snippet === 's');

// --- source type / reliability
check('학술 분류', core.sourceTypeOf('https://www.mdpi.com/x').type === 'academic' && core.sourceTypeOf('https://dept.snu.ac.kr/p').type === 'academic');
check('경기 기록 DB 분류', core.sourceTypeOf('https://www.tapology.com/fightcenter').type === 'records');
check('커뮤니티 분류', core.sourceTypeOf('https://www.reddit.com/r/bjj').type === 'forum');
check('모르는 도메인 = 일반 웹', core.sourceTypeOf('https://someblog.xyz').type === 'web');
const rel1 = core.assessReliability({ sourceType: 'academic', engineCount: 2, extractionStatus: 'ok', publishedAt: '2024-01-02T00:00:00Z' });
const rel2 = core.assessReliability({ sourceType: 'forum', engineCount: 1, extractionStatus: 'blocked' });
check('학술+본문확인 = 높음', rel1.level === 'high', rel1);
check('커뮤니티+차단 = 낮음 + 사유', rel2.level === 'low' && rel2.reasons.some((r) => r.includes('막아')) && rel2.reasons.includes('게시일 확인 안 됨'), rel2);

// --- dates never guessed
check('잘못된 날짜 = undefined', core.toIsoDate('not a date') === undefined && core.toIsoDate('') === undefined);
check('미래 날짜 거부', core.toIsoDate('2099-01-01') === undefined);
check('정상 날짜', core.toIsoDate('2025-04-04')?.startsWith('2025-04-04'));

// --- ranking
const ranked = core.rankResults('jab setup boxing', [
  { title: 'Cooking pasta', url: 'https://x.com/1', snippet: 'recipe', engines: ['bing'], bestPosition: 0 },
  { title: 'Boxing jab setup drills', url: 'https://y.com/2', snippet: 'jab', engines: ['bing', 'yahoo'], bestPosition: 3 },
]);
check('관련 결과가 위로', ranked[0].url === 'https://y.com/2' && ranked[0].relevance > ranked[1].relevance, ranked.map((r) => r.relevance));
check('한국어 조사 붙은 형태 매칭', core.queryOverlap('잽 셋업', '잽을 이용한 셋업과 콤보', '') === 1);

// --- robots
const { parseRobots } = require('../electron/selfSearch/extract.cjs');
const rules = parseRobots('User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /private\nDisallow:\n\nUser-agent: MARTIALDEX\nDisallow: /m');
check('robots: * 와 MARTIALDEX 규칙만', rules.join() === '/private,/m', rules);

// --- pipeline with fake network
const PAGES = {
  'https://good.example/jab': `<html><head><meta property="article:published_time" content="2025-02-03"><title>Jab</title></head><body><article><h1>Jab setups</h1>${'<p>The jab sets up the cross and the lead hook. Feint the jab, then hook. </p>'.repeat(12)}</article></body></html>`,
  'https://wall.example/jab': '<html><body>Please verify you are human. captcha</body></html>',
};
const ROBOTS = { 'https://good.example': 'User-agent: *\nDisallow: /admin', 'https://wall.example': '', 'https://blocked.example': 'User-agent: *\nDisallow: /' };
let unexpected = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  const resp = (status, body, ct = 'text/html') => ({ ok: status < 400, status, headers: new Map([['content-type', ct]]), text: async () => body, json: async () => JSON.parse(body) });
  if (u.startsWith('http://127.0.0.1:8888/healthz')) return resp(200, 'OK', 'text/plain');
  if (u.startsWith('http://127.0.0.1:8888/search')) {
    return resp(200, JSON.stringify({
      results: [
        { title: 'Jab setups', url: 'https://good.example/jab', content: 'jab setup', engines: ['bing', 'yahoo'] },
        { title: 'Jab wall', url: 'https://wall.example/jab', content: 'jab', engines: ['bing'] },
        { title: 'Jab robots', url: 'https://blocked.example/jab', content: 'jab setup', engines: ['naver'] },
        { title: 'Jab setups', url: 'https://www.good.example/jab?utm_source=z', content: 'dup', engines: ['naver'] },
        { title: '아이콘개발에 관한 연구', url: 'https://junk.example/icon', content: '사용자 인지도', engines: ['crossref'] },
      ],
      unresponsive_engines: [['brave', 'too many requests']],
    }), 'application/json');
  }
  const origin = u.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  if (u.endsWith('/robots.txt')) return resp(200, ROBOTS[origin] ?? '', 'text/plain');
  if (PAGES[u]) return resp(200, PAGES[u]);
  unexpected.push(u);
  throw new Error('unexpected fetch ' + u);
};
// Map.get works for headers.get
const { research, selfWebSearch } = require('../electron/selfSearch/index.cjs');
const r = await research({ query: 'jab setup', kind: 'web' });
check('파이프라인 성공', r.ok === true, r);
const byHost = Object.fromEntries((r.results || []).map((x) => [x.source, x]));
check('중복 URL 제거됨', r.diagnostics.duplicatesRemoved === 1 && r.results.length === 3, r.diagnostics);
check('본문 추출 ok + 게시일(페이지 메타)', byHost['good.example']?.extraction.status === 'ok' && byHost['good.example'].publishedAtSource === 'page_metadata', byHost['good.example']);
check('CAPTCHA 페이지 = blocked, 본문 없음', byHost['wall.example']?.extraction.status === 'blocked' && !byHost['wall.example'].content, byHost['wall.example']);
check('robots 거부 = robots, 페이지 요청 안 함', byHost['blocked.example']?.extraction.status === 'robots', byHost['blocked.example']);
check('질의와 무관한 결과 제거(관련성 하한)', r.diagnostics.irrelevantRemoved === 1 && !r.results.some((x) => x.source === 'junk.example'), r.diagnostics);
check('실패 엔진 기록', r.diagnostics.failedEngines.some((e) => e.engine === 'brave'), r.diagnostics.failedEngines);
check('원문 URL 보존', r.results.every((x) => /^https:\/\//.test(x.url)));
const legacy = await selfWebSearch('jab setup');
check('기존 webSearch 계약 형태', legacy.ok && legacy.results.every((x) => Object.keys(x).every((k) => ['title', 'url', 'snippet', 'content', 'source', 'publishedAt'].includes(k))), legacy);
check('예상 밖 네트워크 요청 없음', unexpected.length === 0, unexpected);

// --- SearXNG down → honest failure, not empty success
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
const down = await research('jab');
check('검색 서버 꺼짐 = NOT_RUNNING 실패', down.ok === false && down.code === 'NOT_RUNNING', down);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
