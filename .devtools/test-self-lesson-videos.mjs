// 자체 AI 코치의 단일 기술 영상 찾기 — offline test (real selfTechniqueVideos + real pickReferenceVideos +
// real lesson engine; the search is a fake so no network).
//
// 보고된 문제: 자체 코치가 "MARTIALDEX에 등록된 영상이 없습니다 … Gemini로 영상 내용을 확인하는 검색을
// 하지 않으므로"로 끝낸 뒤, 바로 "영상에서 가장 눈에 띈 핵심 동작은?"이라고 물었다. 보여 준 적 없는 영상을
// 물은 것이고, 기술 하나짜리 수업이면 기술 이름 검색으로 대개 튜토리얼이 나온다.
//   node .devtools/test-self-lesson-videos.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfvid-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as SV from ${mod('src/lib/techniqueVideo/selfTechniqueVideos.ts')};`,
    `export * as PC from ${mod('src/lib/poseCoach/poseCoach.ts')};`,
    `export * as CA from ${mod('src/lib/selfAi/coachAgent.ts')};`,
    `export * as P from ${mod('src/lib/selfResearch/provider.ts')};`,
  ].join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };
let searchCalls = [];
let searchResult = null;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: 'http://localhost/', search: '', hash: '' },
  // the self-AI transport looks here for the desktop backend — this fake IS the search server
  martialdex: {
    selfAi: { chat: async () => ({ ok: false, code: 'UNSUPPORTED', message: 'n/a' }), cancel: async () => true, status: async () => null },
    research: {
      status: async () => ({ ok: true, url: 'fake' }),
      search: async (req) => (searchCalls.push(req), searchResult),
      entity: async (n) => ({ ok: false, query: n, reason: 'n/a' }),
    },
  },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { SV, PC, CA } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? pass++ : fail++;
  console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${c ? '' : ` :: ${JSON.stringify(d)?.slice(0, 400)}`}`);
};

const TECH = { id: 'boxing__jab', name: 'Jab', koreanName: '잽', martialArt: 'boxing', aliases: [] };
// selfResearchProvider 는 같은 요청을 10분간 캐시한다(정상 동작). 구역마다 다른 기술을 써서 캐시를 피한다.
const tech = (name, korean) => ({ ...TECH, id: `boxing__${name.toLowerCase()}`, name, koreanName: korean });
const vid = (title, videoId, o = {}) => ({
  title, url: `https://www.youtube.com/watch?v=${videoId}`, snippet: '', engines: ['youtube'], relevance: 60,
  sourceType: 'video', sourceTypeLabel: '영상', reliability: { level: 'medium', label: '보통', reasons: [] },
  extraction: { status: 'not_attempted' },
  video: { platform: 'youtube', videoId, channel: o.channel ?? 'Coach Ch', duration: o.duration ?? '5:12', embed: o.embed ?? 'embeddable' },
});

// ---------------------------------------------------------------- A. 검색어
console.log('\n=== A. 기술 이름으로 검색 ===');
const qs = SV.selfVideoQueries(TECH);
check('[A1] 기술 영어 이름 + 무술로 검색어를 만듦', qs[0] === 'Jab boxing technique tutorial', qs);
check('[A2] "how to" 형태도 함께 (유튜브에서 흔한 제목)', qs.includes('how to Jab boxing'), qs);
check('[A3] 한글 이름이 있으면 한국어 검색어도', qs.includes('잽 기술 설명'), qs);

// ---------------------------------------------------------------- B. 영상을 찾는다 (보고된 문제의 핵심)
console.log('\n=== B. 단일 기술 영상 찾기 ===');
searchCalls = [];
searchResult = { ok: true, kind: 'video', results: [vid('How to Jab - Boxing Basics', 'AAAAAAAAAAA'), vid('Jab tutorial for beginners', 'BBBBBBBBBBB')], diagnostics: { backend: 'fake' } };
const B = await SV.findSelfTechniqueVideos(TECH);
check('[B1] 등록 영상이 없어도 자체 검색으로 영상을 찾음 (보고된 문제)', B.videos.length > 0, B);
check('[B2] 영상 검색(kind: video)으로 요청', searchCalls[0]?.kind === 'video', searchCalls[0]);
check('[B3] 찾은 영상은 "자체 검색"으로 표시 — 등록 영상이나 확인된 영상으로 위장하지 않음', B.videos.every((v) => v.source === 'self_search'), B.videos.map((v) => v.source));
check('[B4] 내용을 확인하지 않았다고 각 영상에 적음', B.videos.every((v) => /영상 내용은 확인하지 않았습니다/.test(v.reason ?? '')), B.videos.map((v) => v.reason));
check('[B5] 재생에 필요한 videoId가 들어 있음', B.videos.every((v) => /^[\w-]{11}$/.test(v.video.videoId)), B.videos.map((v) => v.video.videoId));
check('[B6] 찾았으면 실패 메모는 없음', B.note === null, B.note);

// ---------------------------------------------------------------- C. 아무 영상이나 쓰지는 않는다
console.log('\n=== C. 단일 기술 영상만 ===');
searchResult = {
  ok: true, kind: 'video',
  results: [
    vid('Top 50 knockouts compilation', 'CCCCCCCCCCC'), // 여러 기술 모음
    vid('How to Cross - full seminar', 'DDDDDDDDDDD', { duration: '1:24:00' }), // 10분 이상
    vid('Cross tutorial', 'EEEEEEEEEEE', { embed: 'not_embeddable' }), // 앱에서 재생 불가
    vid('Muay Thai teep basics', 'FFFFFFFFFFF'), // 제목에 이 기술 이름 없음
  ],
  diagnostics: { backend: 'fake' },
};
const TC = tech('Cross', '크로스');
const C = await SV.findSelfTechniqueVideos(TC);
check('[C1] 모음·장시간·재생불가·다른 기술 영상은 쓰지 않음', C.videos.length === 0, C.videos.map((v) => v.video.title));
check('[C2] 왜 못 썼는지 밝힘 ("없다"로 끝내지 않음)', /단일 기술 영상이 없었습니다/.test(C.note ?? '') && /여러 기술|10분|재생 불가|기술 이름/.test(C.note ?? ''), C.note);

searchResult = { ok: true, kind: 'video', results: [], diagnostics: { backend: 'fake' } };
const C3 = await SV.findSelfTechniqueVideos(tech('Hook', '훅'));
check('[C3] 결과 자체가 없으면 그렇게 말함', /검색 결과가 없었습니다/.test(C3.note ?? ''), C3.note);

searchResult = { ok: false, code: 'NOT_RUNNING', message: '검색 서버가 꺼져 있습니다' };
const E = await SV.findSelfTechniqueVideos(tech('Uppercut', '어퍼컷'));
check('[C4] 검색 실패는 실패라고 말함 (영상이 없다고 하지 않음)', E.videos.length === 0 && /검색에 실패했습니다/.test(E.note ?? ''), E.note);

// ---------------------------------------------------------------- D. 기존 거르개를 그대로 씀 (중복 구현 없음)
console.log('\n=== D. 기존 단일 기술 거르개 재사용 ===');
const { picked, rejected } = PC.pickReferenceVideos(CA.toSources([vid('How to Jab', 'GGGGGGGGGGG'), vid('Best 20 combos', 'HHHHHHHHHHH')]), TECH);
check('[D1] poseCoach.pickReferenceVideos 를 그대로 사용 (같은 기준)', picked.length === 1 && rejected.length === 1, { picked: picked.map((p) => p.title), rejected });

// ---------------------------------------------------------------- E. 콤보·셋업: 단계별 + 연결
console.log('\n=== E. 콤보 수업 자료 영상 (잽 → 더블렉) ===');
const EQ = SV.comboVideoQueries([{ ...TECH, name: 'Jab', koreanName: '잽' }, { id: 'wrestling__double-leg', name: 'Double Leg', koreanName: '더블렉', martialArt: 'wrestling', aliases: [] }], 'mixed-martial-arts');
check('[E1] 연결 자체를 찾는 검색어를 만듦 ("Jab to Double Leg")', /Jab to Double Leg/.test(EQ[0]), EQ);
check('[E2] "앞 기술로 뒤 기술을 셋업" 형태도 검색', /how to set up Double Leg with Jab/.test(EQ[1]), EQ);
check('[E3] 한글 이름이 다 있으면 한국어 검색어도', EQ.includes('잽 더블렉 콤비네이션'), EQ);

// 단계 영상 2개 + 연결 영상 1개가 모두 잡히는 경우.
// 호출 순서가 아니라 "검색어 내용"으로 응답한다 — 단계 검색은 Promise.all 로 동시에 나가고,
// provider 는 10분 캐시가 있어 호출 순서/횟수로 대역을 만들면 테스트가 실제 동작과 어긋난다.
searchCalls = [];
const byQuery = (map) => async (req) => {
  searchCalls.push(req);
  const q = [req.query, ...(req.queries ?? [])].join(' ');
  for (const [needle, results] of map) if (needle.every((n) => q.includes(n))) return { ok: true, kind: 'video', results, diagnostics: {} };
  return { ok: true, kind: 'video', results: [], diagnostics: {} };
};
window.martialdex.research.search = byQuery([
  [['Lead Hook', 'Double Leg'], [vid('Setting up the Double Leg with the Lead Hook', 'C1CCCCCCCCC')]], // 연결(두 기술 모두)
  [['Lead Hook'], [vid('How to Lead Hook - Boxing Basics', 'J1JJJJJJJJJ')]],
  [['Double Leg'], [vid('Double Leg takedown tutorial', 'D1DDDDDDDDD')]],
]);
const LH = tech('Lead Hook', '리드훅');
const DL = { id: 'wrestling__double-leg', name: 'Double Leg', koreanName: '더블렉', martialArt: 'wrestling', aliases: [] };
const EQ2 = SV.comboVideoQueries([LH, DL], 'mixed-martial-arts');
const CB = await SV.findSelfComboVideos([LH, DL], { martialArt: 'mixed-martial-arts' });
check('[E4] 단계 기술마다 영상 1개씩 찾음 (리드훅 1개, 더블렉 1개)', CB.steps.length === 2 && CB.steps.every((s) => s.videos.length === 1), CB.steps.map((s) => ({ t: s.technique.name, n: s.videos.length })));
check('[E5] 두 기술을 연결한 영상도 따로 찾음', CB.connection.videos.length === 1 && /Setting up the Double Leg with the Lead Hook/.test(CB.connection.videos[0].video.title), CB.connection);
check('[E6] 연결 영상을 단계 영상과 섞지 않음 (따로 보여 줄 수 있게)', !CB.steps.some((s) => s.videos.some((v) => v.video.videoId === 'C1CCCCCCCCC')), CB.steps.map((s) => s.videos.map((v) => v.video.videoId)));
check('[E7] 전부 "자체 검색"으로 표시 — 내용 확인 안 했다고 유지', [...CB.steps.flatMap((s) => s.videos), ...CB.connection.videos].every((v) => v.source === 'self_search'));
check('[E8] 단계 검색 2회 + 연결 검색 1회', searchCalls.length === 3, { n: searchCalls.length, queries: searchCalls.map((c) => c.query) });

// 연결 영상이 없을 때: 단계 영상은 그대로 두고 연결만 "못 찾음"
searchCalls = [];
const LH2 = tech('Overhand', '오버핸드');
const SL = { id: 'wrestling__single-leg', name: 'Single Leg', koreanName: '싱글렉', martialArt: 'wrestling', aliases: [] };
window.martialdex.research.search = byQuery([
  [['Overhand', 'Single Leg'], [vid('Single Leg defense only', 'X1XXXXXXXXX')]], // 연결 검색인데 기술 하나만
  [['Overhand'], [vid('How to Overhand - Boxing', 'H1HHHHHHHHH')]],
  [['Single Leg'], [vid('Single Leg takedown tutorial', 'S1SSSSSSSSS')]],
]);
const CB2 = await SV.findSelfComboVideos([LH2, SL], { martialArt: 'mixed-martial-arts' });
check('[E9] 연결 영상이 없어도 단계 영상은 그대로 보여 줌', CB2.steps.every((s) => s.videos.length === 1), CB2.steps.map((s) => s.videos.length));
check('[E10] 제목에 기술이 하나만 있는 영상을 연결 영상으로 쓰지 않음', CB2.connection.videos.length === 0, CB2.connection.videos);
check('[E11] 연결을 못 찾았으면 그 사실과 대안을 말함', /연결을 함께 다룬 영상을 찾지 못했습니다/.test(CB2.connection.note ?? '') && /단계별 영상으로 각각 익힌 뒤/.test(CB2.connection.note ?? ''), CB2.connection.note);

// 같은 기술이 두 번 나오는 콤보는 한 번만 검색
searchCalls = [];
const UP = tech('Spinning Elbow', '스피닝 엘보');
window.martialdex.research.search = byQuery([]);
await SV.findSelfComboVideos([UP, UP, tech('Teep', '팁')], { martialArt: 'muay-thai' });
check('[E12] 같은 기술이 반복되는 콤보는 중복 검색하지 않음 (A → A → B = 단계 2회 + 연결 1회)', searchCalls.length === 3, { n: searchCalls.length, queries: searchCalls.map((c) => c.query) });

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
