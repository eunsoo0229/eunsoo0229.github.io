// 검색 관련성 평가 + 근거 검증 — offline test (real relevance.ts + real evidenceStyle.ts + real fighterReport.ts;
// the search engine and the model are fakes so the fixtures reproduce exactly the cases the spec names).
//
// 사양 §7 의 A~F 를 모두 다루고, 검색 결과만이 아니라 "실제 답변 문장이 자료를 정확히 반영하는가"까지 본다.
//   node .devtools/test-search-relevance.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relevance-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as REL from ${mod('src/lib/selfAi/relevance.ts')};`,
    `export * as ES from ${mod('src/lib/fighterStyle/evidenceStyle.ts')};`,
    `export * as FR from ${mod('src/lib/selfAi/fighterReport.ts')};`,
    `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
    `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  ].join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: 'http://localhost/', search: '', hash: '' } };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { REL, ES, FR, A, K } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? pass++ : fail++;
  console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${c ? '' : ` :: ${JSON.stringify(d)?.slice(0, 500)}`}`);
};

// ---------------------------------------------------------------- 자료 대역
const page = (o) => ({
  title: o.title,
  url: o.url,
  snippet: o.snippet ?? '',
  content: o.content,
  source: new URL(o.url).hostname,
  engines: o.engines ?? ['duckduckgo'],
  relevance: 50,
  sourceType: o.sourceType ?? 'web',
  sourceTypeLabel: '일반 웹',
  reliability: { level: 'medium', label: '보통', reasons: [] },
  extraction: { status: o.content ? 'ok' : 'blocked', chars: o.content?.length ?? 0 },
});

// 사양 §2 가 "쓰면 안 된다"고 지목한 네 종류 + 쓸 수 있는 자료
const POIRIER_GUARD_DIRECT = page({
  title: 'Dustin Poirier technical breakdown: the high guard',
  url: 'https://bloodyelbow.com/poirier-guard',
  snippet: 'A look at how Poirier defends.',
  content:
    'Dustin Poirier has changed a great deal since the featherweight days. Poirier often brings his hands up into a tight high guard when pressured, absorbing shots on the forearms before countering with the left hook. ' +
    'This is a departure from the lower hands he showed earlier in his career. The jab remains his range finder.',
});
const POIRIER_GUARD_SECOND = page({
  title: 'Film study: Poirier under fire',
  url: 'https://mmajunkie.usatoday.com/poirier-film',
  snippet: 'Film study.',
  content: 'When the exchange gets wild, Poirier habitually raises a high guard and walks forward through it. He then answers with hooks to the body.',
  engines: ['duckduckgo', 'brave'],
});
// (1) 선수는 맞지만 가드 얘기가 없는 소개 글
const POIRIER_INTRO = page({
  title: 'Dustin Poirier: biography, record and career highlights',
  url: 'https://sherdog.com/poirier',
  snippet: 'Dustin Poirier is an American mixed martial artist.',
  content: 'Dustin Poirier was born in Lafayette, Louisiana. He holds notable wins over Conor McGregor and Max Holloway. Poirier has competed for the UFC lightweight title on three occasions and owns a hot sauce company.',
  sourceType: 'records',
});
// (2) 가드 얘기지만 이 선수와 무관한 일반 커뮤니티 글
const GENERAL_GUARD = page({
  title: 'What is the best guard in boxing? High guard vs philly shell',
  url: 'https://reddit.com/r/boxing/guards',
  snippet: 'Discussion about guards.',
  content: 'The high guard keeps both hands up near the temples. The philly shell drops the lead hand and rolls the shoulder. Beginners should keep their hands up at all times.',
  sourceType: 'forum',
});
// (3) 같은 이름의 다른 기술 — 주짓수 바닥 가드
const BJJ_GUARD = page({
  title: 'Closed guard fundamentals and guard passing',
  url: 'https://bjjfanatics.com/closed-guard',
  snippet: 'Closed guard basics.',
  content: 'From closed guard you control posture with the legs. Passing the guard begins with breaking the ankles open. Half guard is a common recovery position.',
});
// (4) 다른 선수의 가드 분석
const MCGREGOR_GUARD = page({
  title: 'Conor McGregor and the long guard',
  url: 'https://theathletic.com/mcgregor-guard',
  snippet: 'McGregor long guard.',
  content: 'Conor McGregor often extends a long guard with the lead hand to measure distance before the left cross. He keeps the rear hand high at the chin.',
});

const fakeIndex = async () => ({ techniques: [], sequences: [], byId: new Map() });
const chatUnused = async () => ({ ok: false, message: '로컬 모델 미사용' });
function searcher(byKind) {
  const log = [];
  return {
    log,
    research: async (req) => {
      log.push({ kind: req.kind ?? 'web', queries: [req.query, ...(req.queries ?? [])], requireTerms: req.requireTerms });
      const results = req.kind === 'video' ? [] : byKind;
      return { ok: true, kind: req.kind ?? 'web', results, diagnostics: { backend: 'searxng' } };
    },
  };
}
const run = (results, question, fighter = 'Dustin Poirier', art = 'mixed-martial-arts') => {
  const s = searcher(results);
  return ES.analyzeFighterStyleWithEvidence(fighter, art, { research: s.research, chat: chatUnused, knowledgeIndex: fakeIndex }, { fighterEn: fighter, question, arts: ['boxing', 'kickboxing', 'muay-thai', 'mixed-martial-arts'] }).then((r) => ({ report: r, log: s.log }));
};

// ================================================================ A. 포이리에 가드 습관
console.log('\n=== A. "더스틴 포이리에가 습관적으로 올리는 가드가 어떤 가드인지 알려줘" ===');
const QA = '더스틴 포이리에가 습관적으로 올리는 가드가 어떤 가드인지 알려줘';
const focusA = REL.focusOf(QA, 'Dustin Poirier');
check('[A1] 질문의 주제를 "가드"로 인식 (기존에는 어떤 주제에도 걸리지 않았음)', focusA.topics.some((t) => t.key === 'guard'), focusA.topics.map((t) => t.key));
check('[A2] 반복성(습관)을 물었다고 인식 — 자료 한 곳으로 단정하면 안 되는 질문', focusA.habit === true);
check('[A3] 검색어에 guard/defense 가 들어감 (질문 주제가 검색 엔진까지 전달)', ES.fighterQueries('Dustin Poirier', 'mixed-martial-arts', QA, 1).join(' ').toLowerCase().includes('guard'), ES.fighterQueries('Dustin Poirier', 'mixed-martial-arts', QA, 1));

const sA = (r) => REL.scoreResult(r, focusA);
check('[A4] 본문에서 선수+가드를 함께 말한 자료 = 근거', sA(POIRIER_GUARD_DIRECT).verdict === 'evidence', sA(POIRIER_GUARD_DIRECT));
check('[A5] 선수 소개 글(가드 언급 없음)은 근거가 아님 — 사양 §2(1)', sA(POIRIER_INTRO).verdict !== 'evidence', sA(POIRIER_INTRO));
check('[A6] 무관한 일반 복싱 커뮤니티 글은 버림 — 사양 §2(2)', sA(GENERAL_GUARD).verdict === 'drop', sA(GENERAL_GUARD));
check('[A7] 다른 선수의 가드 분석은 버림 — 사양 §2(3)', sA(MCGREGOR_GUARD).verdict === 'drop', sA(MCGREGOR_GUARD));
check('[A8] 같은 이름의 다른 기술(주짓수 가드)은 버림 — 사양 §2/§7F', sA(BJJ_GUARD).verdict === 'drop', sA(BJJ_GUARD));
check('[A9] 단순 키워드 일치보다 본문 직접 근거가 높은 점수', sA(POIRIER_GUARD_DIRECT).score > sA(POIRIER_INTRO).score && sA(POIRIER_INTRO).score > sA(GENERAL_GUARD).score, { direct: sA(POIRIER_GUARD_DIRECT).score, intro: sA(POIRIER_INTRO).score, general: sA(GENERAL_GUARD).score });
check('[A10] 제목만 맞은 자료를 본문 확인으로 치지 않음', sA(page({ title: 'Dustin Poirier guard breakdown', url: 'https://x.com/a', snippet: 'guard' })).axes.body === 0);

// 자료가 1곳뿐일 때: 습관으로 단정하지 않는다
const A1 = await run([POIRIER_GUARD_DIRECT, POIRIER_INTRO, GENERAL_GUARD, BJJ_GUARD, MCGREGOR_GUARD], QA);
const textA1 = FR.fighterReportText(QA, A1.report, { ok: true, query: '더스틴 포이리에', en: 'Dustin Poirier', ko: '더스틴 포이리에', source: 'wiki' });
check('[A11] 근거 자료 1곳 → "습관"으로 단정하지 않음 (사양 §4: 단일 자료로 습관 단정 금지)', /습관.*확인 불가|습관으로 단정하지 않|"습관적으로 그렇게 한다"고 말하지 않/.test(textA1), textA1.split('\n').filter((l) => /습관/.test(l)));
check('[A12] 그래도 확인된 문장은 보여 줌 (근거 있는 사실은 숨기지 않음)', /high guard/i.test(textA1), textA1.slice(0, 400));
check('[A13] 근거에서 제외한 자료와 이유를 밝힘', /근거에서 제외/.test(textA1) && /다루지 않은 자료|다른 기술을 다룬 자료/.test(textA1), textA1.split('\n').filter((l) => /제외/.test(l)));
check('[A14] 출처 목록이 "실제 사용"과 "참고만"을 구분 — 사양 §5', A1.report.sources.some((s) => s.used) && A1.report.sources.some((s) => !s.used), A1.report.sources.map((s) => ({ t: s.title.slice(0, 30), used: s.used, rel: s.relevance })));
check('[A15] 제외된 자료마다 관찰된 이유가 붙음', A1.report.sources.filter((s) => !s.used).every((s) => s.why.length > 0), A1.report.sources.filter((s) => !s.used).map((s) => s.why));
check('[A16] 선수 소개 글 / 일반 글 / 다른 선수 글을 본문 분석에 쓰지 않음', (A1.report.pagesRead ?? 0) <= 2 && !A1.report.sources.find((s) => s.url === GENERAL_GUARD.url)?.used && !A1.report.sources.find((s) => s.url === MCGREGOR_GUARD.url)?.used, { pagesRead: A1.report.pagesRead });

// 자료가 2곳일 때: 반복으로 말할 수 있다
const A2 = await run([POIRIER_GUARD_DIRECT, POIRIER_GUARD_SECOND, POIRIER_INTRO], QA);
const textA2 = FR.fighterReportText(QA, A2.report, null);
check('[A17] 서로 다른 자료 2곳 → 반복을 말할 수 있음', A2.report.topicEvidence.directSites >= 2 && /서로 다른 자료 2곳/.test(textA2), { sites: A2.report.topicEvidence.directSites });
check('[A18] 원문의 빈도 표현("habitually","often")을 근거로 표시', /빈도 표현/.test(textA2), textA2.split('\n').filter((l) => /빈도/.test(l)));

// 주제 자료가 아예 없을 때
const A3 = await run([POIRIER_INTRO, GENERAL_GUARD, BJJ_GUARD], QA);
const textA3 = FR.fighterReportText(QA, A3.report, null);
check('[A19] 근거가 없으면 "확인 불가"라고 말함 (추측 금지) — 사양 §2/§5', /확인 불가/.test(textA3), textA3.split('\n').filter((l) => /확인 불가/.test(l)));
check('[A20] 확인 불가일 때 MARTIALDEX 기록은 무시하지 않음 — 사양 §5', (A3.report.topicRecords ?? []).length > 0 && /MARTIALDEX에 있는/.test(textA3), (A3.report.topicRecords ?? []).map((r) => r.name).slice(0, 5));
check('[A21] 그 DB 기록을 선수의 근거로 제시하지 않음', /이 선수가 무엇을 쓰는지에 대한 근거가 아닙니다/.test(textA3));
check('[A22] 주짓수 가드를 타격 가드 질문의 DB 기록으로 내놓지 않음', !(A3.report.topicRecords ?? []).some((r) => r.martialArt === 'bjj'), (A3.report.topicRecords ?? []).map((r) => r.martialArt));

// ================================================================ B. 맥그리거 파이팅 스타일 (주제를 좁히지 않은 질문 → 회귀 없음)
console.log('\n=== B. "코너 맥그리거의 파이팅 스타일 알려줘" ===');
const QB = '코너 맥그리거의 파이팅 스타일을 알려줘';
const focusB = REL.focusOf(QB, 'Conor McGregor');
const B = await run([MCGREGOR_GUARD, page({ title: 'McGregor left hand', url: 'https://bloodyelbow.com/mcg', content: 'Conor McGregor sets up the left cross with a long guard and lead-hand feints. He often steps out to the left before firing.' })], QB, 'Conor McGregor');
const textB = FR.fighterReportText(QB, B.report, null);
check('[B1] 주제를 좁히지 않은 질문은 주제 필터로 자료를 잃지 않음 (회귀 방지)', (B.report.pagesRead ?? 0) === 2, { pagesRead: B.report.pagesRead, topics: focusB.topics.map((t) => t.key) });
check('[B2] 이 선수의 자료는 모두 근거 후보', REL.scoreResult(MCGREGOR_GUARD, focusB).verdict !== 'drop', REL.scoreResult(MCGREGOR_GUARD, focusB));
check('[B3] 검색 과정과 사용/참고 자료 수를 밝힘', /검색 과정:/.test(textB) && /실제로 문장을 인용해 쓴 자료/.test(textB), textB.split('\n').filter((l) => /인용해 쓴/.test(l)));

// ================================================================ C. 포이리에 vs 맥그리거 비교
console.log('\n=== C. "포이리에와 맥그리거의 가드를 비교해줘" ===');
const QC = '더스틴 포이리에와 코너 맥그리거의 가드를 비교해줘';
const focusC = REL.focusOf(QC, 'Dustin Poirier', ['Conor McGregor']);
check('[C1] 비교 질문은 두 선수를 모두 인물 축에 넣음', focusC.subjects.includes('Poirier') && focusC.subjects.includes('McGregor'), focusC.subjects);
check('[C2] 맥그리거 가드 분석이 비교 질문에서는 근거가 됨 (A7과 반대 — 질문이 달라졌기 때문)', REL.scoreResult(MCGREGOR_GUARD, focusC).verdict === 'evidence', REL.scoreResult(MCGREGOR_GUARD, focusC));
check('[C3] 포이리에 가드 분석도 그대로 근거', REL.scoreResult(POIRIER_GUARD_DIRECT, focusC).verdict === 'evidence');
check('[C4] 비교 질문에서도 무관한 일반 글·주짓수 가드는 버림', REL.scoreResult(GENERAL_GUARD, focusC).verdict === 'drop' && REL.scoreResult(BJJ_GUARD, focusC).verdict === 'drop');

// ================================================================ D. 앞손 운용
console.log('\n=== D. "포이리에는 앞손을 어떻게 쓰는지" ===');
const QD = '포이리에는 앞손(리드 핸드)을 어떻게 쓰는지 알려줘';
const focusD = REL.focusOf(QD, 'Dustin Poirier');
const LEAD = page({ title: 'Poirier jab mechanics', url: 'https://bloodyelbow.com/poirier-jab', content: 'Poirier uses the lead hand to paw at range, and the jab to the body opens the left hook upstairs.' });
check('[D1] 앞손·리드 핸드를 주제로 인식', focusD.topics.some((t) => t.key === 'lead_hand'), focusD.topics.map((t) => t.key));
check('[D2] 검색어에 lead hand 가 들어감', ES.fighterQueries('Dustin Poirier', 'mixed-martial-arts', QD, 1).join(' ').toLowerCase().includes('lead hand'), ES.fighterQueries('Dustin Poirier', 'mixed-martial-arts', QD, 1));
check('[D3] 앞손을 다룬 본문은 근거', REL.scoreResult(LEAD, focusD).verdict === 'evidence', REL.scoreResult(LEAD, focusD));
check('[D4] 가드만 다룬 글은 앞손 질문의 근거가 아님 (주제가 다름)', REL.scoreResult(POIRIER_GUARD_SECOND, focusD).verdict !== 'evidence', REL.scoreResult(POIRIER_GUARD_SECOND, focusD));
const D = await run([LEAD, POIRIER_INTRO], QD);
check('[D5] 습관을 묻지 않은 질문은 1곳 자료로도 확인된 사실로 말함', /같은 문장으로 확인/.test(FR.fighterReportText(QD, D.report, null)), FR.fighterReportText(QD, D.report, null).split('\n').filter((l) => /확인/.test(l)).slice(0, 3));

// ================================================================ E. 공격 셋업
console.log('\n=== E. "포이리에의 공격 셋업" ===');
const QE = '포이리에가 어떤 셋업으로 공격을 시작하는지 알려줘';
const focusE = REL.focusOf(QE, 'Dustin Poirier');
const SETUP = page({ title: 'Poirier entries', url: 'https://bloodyelbow.com/poirier-setup', content: 'Poirier sets up the left hand with a feint of the jab, then steps in behind a low kick.' });
check('[E1] 셋업을 주제로 인식하고 검색어에 setups 를 넣음', focusE.topics.some((t) => t.key === 'setup') && ES.fighterQueries('Dustin Poirier', 'mixed-martial-arts', QE, 1).join(' ').includes('setups'), ES.fighterQueries('Dustin Poirier', 'mixed-martial-arts', QE, 1));
check('[E2] 셋업 본문은 근거', REL.scoreResult(SETUP, focusE).verdict === 'evidence', REL.scoreResult(SETUP, focusE));
check('[E3] 선수 소개 글은 셋업 질문에서도 근거가 아님', REL.scoreResult(POIRIER_INTRO, focusE).verdict !== 'evidence');

// ================================================================ F. 동명 기술 / 무관한 일반 자료만 돌아온 경우
console.log('\n=== F. 같은 이름의 다른 기술·무관한 일반 자료만 반환 ===');
const F = await run([BJJ_GUARD, GENERAL_GUARD], QA);
const textF = FR.fighterReportText(QA, F.report, null);
check('[F1] 쓸 수 있는 자료가 하나도 없으면 분석을 만들지 않음', (F.report.pagesRead ?? 0) === 0 && F.report.items.filter((i) => i.support !== 'ai_inference').length === 0, { pagesRead: F.report.pagesRead, items: F.report.items.length });
check('[F2] "확인 불가"로 답하고 추측하지 않음', /확인 불가/.test(textF) && !/포이리에는 .*가드를 씁니다/.test(textF), textF.split('\n').filter((l) => /확인 불가/.test(l)));
check('[F3] 왜 못 썼는지 종류별로 밝힘 (사양 §5: 실패 원인 분석)', /다른 기술을 다룬 자료|이 선수와 무관|다루지 않은/.test(textF), textF.split('\n').filter((l) => /이유|제외|무관/.test(l)));
check('[F4] 주짓수 가드 문장을 포이리에의 가드로 인용하지 않음', !/closed guard|passing the guard/i.test(textF), textF.match(/closed guard|passing the guard/gi));
check('[F5] 일반 복싱 글의 문장을 이 선수의 특징으로 인용하지 않음', !/Beginners should keep their hands up/i.test(textF));

// ================================================================ G. 검색 효율 (사양 §6)
console.log('\n=== G. 검색 효율 ===');
// 사양 §6: 제목·요약에 이 선수 이름이 없는 결과는 애초에 본문을 읽지 않도록 검색 요청에 조건을 실어 보낸다
const webReq = A1.log.find((x) => x.kind === 'web');
check('[G1] 본문 추출 조건으로 선수 이름을 검색 백엔드에 전달 (불필요한 추출 방지)', (webReq?.requireTerms ?? []).includes('Poirier'), webReq?.requireTerms);
check('[G2] 근거가 충분하면 추가 검색을 하지 않음 (중복 검색 방지)', A2.log.filter((x) => x.kind === 'web').length === 1, A2.log.map((x) => x.queries));
check('[G3] 근거가 모자라면 다른 검색어로 다시 찾음 (정확도를 위한 재검색은 허용)', A3.log.filter((x) => x.kind === 'web').length > 1, A3.log.filter((x) => x.kind === 'web').map((x) => x.queries));
check('[G4] 재검색 때도 질문 주제를 유지 (엉뚱한 검색어로 바뀌지 않음)', A3.log.filter((x) => x.kind === 'web').every((x) => x.queries.join(' ').toLowerCase().includes('guard')), A3.log.filter((x) => x.kind === 'web').map((x) => x.queries));

// ================================================================ H. 근거 검증 (사양 §5) — 실제 대화 한 턴
console.log('\n=== H. 답변 문장 ↔ 자료 대조 ===');
const JAB_PAGE = page({ title: 'The jab and the lead hook', url: 'https://example.org/jab', snippet: 'jab', content: 'The jab sets up the lead hook by occupying the opponent guard. A long jab keeps the opponent at range.' });
const coachDeps = (chatText, results) => ({
  research: async () => ({ ok: true, kind: 'web', results, diagnostics: { failedEngines: [], queries: [] } }),
  chat: async () => ({ ok: true, text: chatText, model: 'fake' }),
  knowledgeIndex: () => K.loadKnowledgeIndex(),
  learnerContext: () => '',
  dataAnswer: async () => null,
  artName: (a) => a,
});
const ask = (text, chatText, results) => A.runCoachTurn({ text, history: [], martialArt: 'boxing', requestId: `h${Math.random()}` }, coachDeps(chatText, results));

// 자료와 전혀 겹치지 않는 답변 → "근거 매칭 0건"을 숨기지 않고 왜 그런지 밝힌다
const H1 = await ask('복싱 잽 훈련법에 대한 자료 찾아줘', '잽은 발을 어깨너비로 벌리고 호흡을 고르는 명상 동작입니다. 이것은 마음을 다스리는 수련입니다.', [JAB_PAGE]);
const notes1 = (H1.message.guardNotes ?? []).join(' | ');
check('[H1] 근거 매칭 0건이면 정상 답변으로 취급하지 않고 알림', /근거 매칭 0건/.test(notes1), notes1.slice(0, 300));
check('[H2] 왜 대조에 실패했는지 이유를 적음 (사양 §5)', /겹치지 않|본문을 한 곳도 읽지 못|질문을 다룬 문장을 찾지 못/.test(notes1), notes1.slice(0, 300));
check('[H3] 그 경우 "출처로 확인된 내용이 아니다"라고 밝힘', /출처로 확인된 내용이 아니/.test(notes1), notes1.slice(0, 300));

// 자료와 겹치는 답변 → 매칭 0건 경고가 뜨지 않는다 (거짓 경보 없음)
const H2 = await ask('복싱 잽 훈련법에 대한 자료 찾아줘', '잽은 상대의 가드를 차지해 리드 훅을 열어 줍니다. The jab sets up the lead hook by occupying the opponent guard.', [JAB_PAGE]);
check('[H4] 근거가 대조되면 0건 경고를 띄우지 않음 (거짓 경보 없음)', !/근거 매칭 0건/.test((H2.message.guardNotes ?? []).join(' ')), (H2.message.guardNotes ?? []).join(' | ').slice(0, 200));
check('[H5] 출처 목록이 "답변에 사용"인지 표시함 — 사양 §5', H2.message.sources?.every((x) => typeof x.used === 'boolean'), H2.message.sources?.map((x) => ({ t: x.title.slice(0, 20), used: x.used })));
check('[H6] 모델이 읽지 않은 자료는 "사용"으로 표시하지 않음', (await ask('복싱 잽 훈련법에 대한 자료 찾아줘', '잽 설명입니다.', [JAB_PAGE, page({ title: 'Unrelated cooking blog', url: 'https://example.org/food', content: 'How to bake sourdough bread at home with a starter.' })])).message.sources?.find((x) => /cooking/i.test(x.title))?.used === false);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
