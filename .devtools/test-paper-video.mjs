// 논문 검색 출처 관리 + 영상 카드/앱 내 재생 판정 — offline (fake network).
//  - electron/selfSearch/media.cjs: YouTube id, DOI parsing
//  - research(): paper DOI check at doi.org, same-DOI dedup, topic-word relevance, newest first,
//    removed titles; video embed status from oEmbed (200 / 401 / 404), thumbnail, title cleanup
//  - coachAgent: paper list fields; "0건" vs "N건 찾았지만 주제와 맞지 않아 제외"
// Run: node .devtools/test-paper-video.mjs
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}

const M = require('../electron/selfSearch/media.cjs');
check('[M1] YouTube id: watch / youtu.be / shorts / embed', ['https://www.youtube.com/watch?v=WsTqgJLhOaY&t=3', 'https://youtu.be/WsTqgJLhOaY', 'https://www.youtube.com/shorts/WsTqgJLhOaY', 'https://www.youtube-nocookie.com/embed/WsTqgJLhOaY'].every((u) => M.youtubeId(u) === 'WsTqgJLhOaY'));
check('[M2] YouTube 아닌 주소 = null', M.youtubeId('https://www.dailymotion.com/video/x8') === null && M.youtubeId('nope') === null);
check('[M3] DOI 정규화 (doi.org 링크·doi: 접두어)', M.cleanDoi('https://doi.org/10.1007/s40279-016-0493-1') === '10.1007/s40279-016-0493-1' && M.cleanDoi('doi: 10.1080/1357.2026') === '10.1080/1357.2026' && M.cleanDoi('not a doi') === null);
check('[M4] 결과 URL(oadoi)에서 DOI 추출', M.doiOf({ url: 'https://oadoi.org/10.54751/revistafoco.v19n3-045' }) === '10.54751/revistafoco.v19n3-045');

// ---- fake network
const resp = (status, body, ct = 'application/json') => ({ ok: status < 400, status, headers: new Map([['content-type', ct]]), text: async () => body, json: async () => JSON.parse(body) });
const PAPERS = [
  { title: 'Injuries amongst grappling athletes', url: 'https://oadoi.org/10.1000/inj.1', content: 'grappling athletes injuries in competition', doi: '10.1000/inj.1', authors: ['A. Kim', 'B. Lee', 'C. Park', 'D. Choi'], journal: 'J Combat Sports', publishedDate: '2024-05-01', engines: ['crossref'] },
  { title: 'Injuries amongst grappling athletes', url: 'https://publisher.example/inj', content: 'same paper, another index', doi: '10.1000/INJ.1', engines: ['openalex'] },
  { title: 'Genetic polymorphisms in grappling sports', url: 'https://oadoi.org/10.1000/gen.2', content: 'grappling sports genetics review', publishedDate: '2026-03-17', engines: ['openalex'] },
  { title: 'Sports science of sleep in students', url: 'https://kr.example/sleep', content: 'sports science sleep regularity', publishedDate: '2026-01-01', engines: ['crossref'] },
  { title: 'Ghost paper on grappling', url: 'https://x.example/ghost', content: 'grappling ghost', doi: '10.9999/ghost', publishedDate: '2020-01-01', engines: ['crossref'] },
];
const VIDEOS = [
  { title: 'Single Leg Basics - YouTube', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', author: 'Coach A', length: '4:12', engines: ['youtube'] },
  { title: 'Single Leg Blocked', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', engines: ['youtube'] },
  { title: 'Single Leg Removed', url: 'https://youtu.be/CCCCCCCCCCC', engines: ['bing videos'] },
  { title: 'Single Leg dup', url: 'https://m.youtube.com/watch?v=AAAAAAAAAAA&feature=share', engines: ['bing videos'] },
  { title: 'Single Leg on dailymotion', url: 'https://www.dailymotion.com/video/x9', engines: ['dailymotion'] },
];
let mode = 'paper';
const unexpected = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1:8888/search')) return resp(200, JSON.stringify({ results: mode === 'paper' ? PAPERS : mode === 'video' ? VIDEOS : PAPERS.slice(3, 4), unresponsive_engines: [] }));
  if (u.startsWith('https://doi.org/')) return resp(u.includes('ghost') ? 404 : 302, '', 'text/html');
  if (u.startsWith('https://www.youtube.com/oembed')) {
    if (u.includes('AAAAAAAAAAA')) return resp(200, JSON.stringify({ author_name: 'Coach A (oEmbed)' }));
    if (u.includes('BBBBBBBBBBB')) return resp(401, 'Unauthorized', 'text/plain');
    return resp(404, 'Not Found', 'text/plain');
  }
  // paper pages are read for their text too (robots.txt first) — these fake pages do not exist
  if (/^https:\/\/(oadoi\.org|x\.example|publisher\.example|kr\.example)\//.test(u)) return resp(404, '', 'text/html');
  unexpected.push(u);
  throw new Error('unexpected ' + u);
};
const { research } = require('../electron/selfSearch/index.cjs');
const p = await research({ query: 'grappling sports science', kind: 'paper', recent: true });
const byTitle = (t) => p.results.find((r) => r.title.startsWith(t));
check('[P1] 같은 DOI(대소문자 무관) = 같은 논문 1건', p.results.filter((r) => r.title.startsWith('Injuries')).length === 1, p.results.map((r) => r.title));
check('[P2] 분야어("sports science")만 맞는 결과는 제외 + 제외 제목 기록', !byTitle('Sports science of sleep') && p.diagnostics.removedTitles.includes('Sports science of sleep in students'), p.diagnostics);
check('[P3] doi.org 등록 확인 / 없는 DOI 표시', byTitle('Injuries').paper.doiStatus === 'registered' && byTitle('Ghost').paper.doiStatus === 'not_found', p.results.map((r) => r.paper));
check('[P4] 서지 정보는 색인 값 그대로 (저자·학술지·연도·초록)', byTitle('Injuries').paper.authors.length === 4 && byTitle('Injuries').paper.journal === 'J Combat Sports' && byTitle('Injuries').paper.year === 2024 && /injuries/.test(byTitle('Injuries').paper.abstract));
check('[P5] 색인이 안 준 정보는 비워 둠 (지어내지 않음)', byTitle('Genetic').paper.authors === undefined && byTitle('Genetic').paper.journal === undefined);
check('[P6] "최근" = 최신순', p.results[0].title.startsWith('Genetic'), p.results.map((r) => [r.title, r.publishedAt]));
check('[P7] 원문 URL 보존 + DOI 링크', byTitle('Injuries').url === 'https://oadoi.org/10.1000/inj.1' && byTitle('Injuries').paper.doiUrl === 'https://doi.org/10.1000/inj.1');

mode = 'video';
const v = await research({ query: 'single leg tutorial', kind: 'video' });
const vid = (id) => v.results.find((r) => r.video?.videoId === id);
check('[V1] 같은 영상(다른 주소) 한 번만', v.results.filter((r) => r.video?.videoId === 'AAAAAAAAAAA').length === 1, v.results.map((r) => r.url));
check('[V2] oEmbed 200 = 앱에서 재생 / 401 = 외부 재생 불가 / 404 = 재생 불가', vid('AAAAAAAAAAA').video.embed === 'embeddable' && vid('BBBBBBBBBBB').video.embed === 'not_embeddable' && vid('CCCCCCCCCCC').video.embed === 'unavailable', v.results.map((r) => r.video));
check('[V3] 다른 플랫폼 = 앱 내 재생 미지원(원본 링크)', v.results.find((r) => r.url.includes('dailymotion')).video.embed === 'not_supported');
check('[V4] 썸네일은 CSP 허용 주소(i.ytimg.com), 채널·길이 보존, 제목의 " - YouTube" 제거', vid('AAAAAAAAAAA').video.thumbnail === 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg' && vid('AAAAAAAAAAA').video.channel === 'Coach A' && vid('AAAAAAAAAAA').video.duration === '4:12' && vid('AAAAAAAAAAA').title === 'Single Leg Basics');
check('[V5] 예상 밖 네트워크 요청 없음', unexpected.length === 0, unexpected);

mode = 'offtopic';
const off = await research({ query: 'grappling sports science', kind: 'paper' });
check('[E1] 결과는 있었지만 주제와 맞지 않음 → ok + 0건 + 제외 수 기록', off.ok && off.results.length === 0 && off.diagnostics.rawCount === 1 && off.diagnostics.irrelevantRemoved === 1, off.diagnostics);

// ---- renderer side: answer texts
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-video-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
fs.writeFileSync(entry, `export * as A from ${JSON.stringify(path.join(APP, 'src/lib/selfAi/coachAgent.ts'))};\nexport { dedupeVideos } from ${JSON.stringify(path.join(APP, 'src/components/video/VideoResultCards.tsx'))};`);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v2) => mem.set(k, String(v2)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin], jsx: 'automatic' });
const { A, dedupeVideos } = await import(pathToFileURL(out).href);
const deps = (outcome) => ({ research: async () => outcome, chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'x' }), knowledgeIndex: async () => ({ sequences: [], sources: [] }), learnerContext: () => '' });
const B = '최근 그래플링 관련 스포츠 과학 논문을 찾아 줘. 제목, 연도, 핵심 내용, 원문 링크를 정리해 줘.';
const ok = await A.runCoachTurn({ text: B, history: [], martialArt: null, requestId: 'b' }, deps(p));
const t = ok.message.text;
check('[A1] 논문 답변: 제목·연도·저자·학술지·DOI 확인·초록·확인 수준', /Injuries amongst grappling athletes \(2024\)/.test(t) && /A\. Kim, B\. Lee, C\. Park 외/.test(t) && /J Combat Sports/.test(t) && /doi\.org 등록 확인/.test(t) && /초록 일부:/.test(t) && /확인 수준:/.test(t), t);
check('[A2] 없는 DOI는 경고, 색인이 안 준 저자는 "정보 없음"', /doi\.org에 없음/.test(t) && /저자 정보 없음/.test(t));
check('[A3] 논문 본문을 읽었다고 하지 않음', /본문은 읽지 않았습니다/.test(t) && !/논문에 따르면/.test(t));
const empty = await A.runCoachTurn({ text: B, history: [], martialArt: null, requestId: 'b2' }, deps(off));
check('[A4] 결과가 걸러진 경우: "N건 찾았지만 주제와 맞지 않아 제외"', /1건을 찾았지만 질문 주제와 맞지 않아 모두 제외/.test(empty.message.text) && !/찾은 결과가 0건/.test(empty.message.text), empty.message.text);
const zero = await A.runCoachTurn({ text: B, history: [], martialArt: null, requestId: 'b3' }, deps({ ok: true, kind: 'paper', results: [], diagnostics: { backend: 'x', rawCount: 0, irrelevantRemoved: 0 } }));
check('[A5] 엔진 결과 자체가 0건인 경우는 그렇게 말함', /찾은 결과가 0건/.test(zero.message.text), zero.message.text);
const vt = await A.runCoachTurn({ text: '레슬링 싱글렉을 배울 수 있는 교육 영상을 찾아 줘.', history: [], martialArt: null, requestId: 'c' }, deps(v));
check('[A6] 영상 답변: 재생 가능 수, 채널·길이, 재생 불가 사유, 영상 내용 미확인 명시', /앱에서 바로 재생 가능 1개/.test(vt.message.text) && /Coach A/.test(vt.message.text) && /소유자가 외부 재생을 막음/.test(vt.message.text) && /영상 내용 자체는 확인하지 않았습니다/.test(vt.message.text) && vt.message.sources.every((s) => s.video), vt.message.text);
check('[A7] 카드 목록에서 같은 영상 중복 제거', dedupeVideos([{ title: 'a', url: 'u1', video: { videoId: 'X', embed: 'embeddable' } }, { title: 'b', url: 'u2', video: { videoId: 'X', embed: 'embeddable' } }, { title: 'c', url: 'u3' }]).length === 2);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
