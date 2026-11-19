// Fighter style analysis — who does the technique (spec 9-E). Offline.
//  - a labelled set of analysis-style sentences (written for this test — NOT sentences
//    collected from real pages) scored for the old rule (2차: "the fighter or he/his/him in the
//    sentence, and no opponent word within 40 chars before the name") and the new attribution
//    (fighterStyle/actor.ts); the new rule must be strictly better and make no "opponent's
//    technique counted as the fighter's" error on the set
//  - pronouns across sentences, causatives, receiving verbs, possessives, generic sentences,
//    advice, video captions
//  - setup / combo / counter items only from the fighter's sentences; syndicated copies of one
//    sentence on two sites are not "여러 자료에서 공통 확인"; the report shows evidence sentences,
//    the excluded mentions and the categories it could not confirm
// Run: node .devtools/test-fighter-attribution.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fighter-attr-'));
const entry = path.join(dir, 'e.ts');
const out = path.join(dir, 'r.mjs');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [`export * as A from ${mod('src/lib/fighterStyle/actor.ts')};`, `export * as RE from ${mod('src/lib/fighterStyle/ruleExtract.ts')};`, `export * as ES from ${mod('src/lib/fighterStyle/evidenceStyle.ts')};`, `export { fighterReportText } from ${mod('src/lib/selfAi/fighterReport.ts')};`, `export { buildKnowledgeIndex } from ${mod('src/lib/martialdexKnowledge/index.ts')};`, `export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { A, RE, ES, fighterReportText, buildKnowledgeIndex, runCoachTurn } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const who = RE.nameVariants('Conor McGregor');

// ---- labelled set: [previous sentence or '', sentence, technique word, is it McGregor's?]
const SET = [
  ['', 'McGregor landed a left hook that dropped Aldo.', 'left hook', true],
  ['Diaz pressed forward.', 'He caught McGregor with a right hand.', 'right hand', false],
  ['', 'His straight left forced Aldo to slip into the strike.', 'slip', false],
  ['McGregor stayed calm.', 'His straight left forced Aldo to slip into the strike.', 'straight left', true],
  ['', 'The jab is the most important punch in boxing.', 'jab', false],
  ['', 'McGregor should use more leg kicks against wrestlers.', 'leg kicks', false],
  ['', 'McGregor ate a jab early in the round.', 'jab', false],
  ['', 'McGregor likes to throw the cross from southpaw stance.', 'cross', true],
  ['', "Aldo's jab kept McGregor at range.", 'jab', false],
  ['', "McGregor's left hand is his best weapon.", 'left hand', true],
  ['McGregor circles to his right.', 'He feints the jab to set up the left cross.', 'left cross', true],
  ['', 'When his opponent throws a jab, McGregor counters with a left hand.', 'jab', false],
  ['', 'When his opponent throws a jab, McGregor counters with a left hand.', 'left hand', true],
  ['', 'Aldo was dropped by a left hand from McGregor in 13 seconds.', 'left hand', true],
  ['', 'Fighters often use the teep to manage distance.', 'teep', false],
  ['Nate Diaz walked him down in the second round.', 'He landed a series of jabs that bloodied McGregor.', 'jabs', false],
  ['', 'McGregor uses the front kick to the body to keep opponents away.', 'front kick', true],
  ['', 'Poirier attacked the lead leg with calf kicks, and McGregor struggled to stand.', 'calf kicks', false],
  ['', 'McGregor threw a spinning back kick that missed.', 'spinning back kick', true],
  ['', 'The opponent answered with an overhand right.', 'overhand right', false],
  ['', 'Mendes secured a double leg takedown in the first round against McGregor.', 'double leg', false],
  ['', 'McGregor defended the takedown and landed an uppercut.', 'uppercut', true],
  ['McGregor is patient early.', 'He often throws the lead uppercut when opponents duck.', 'lead uppercut', true],
  ['', 'If McGregor throws the jab more often, he could control range.', 'jab', false],
  ['', 'Coaches recommend the jab for beginners.', 'jab', false],
  ['', "Poirier's counter hook rocked McGregor in the rematch.", 'counter hook', false],
  ['', 'McGregor was caught with a counter hook by Poirier.', 'counter hook', false],
  ['', 'Against Cerrone, McGregor used shoulder strikes in the clinch.', 'shoulder strikes', true],
];
/** The 2차 rule, as it was: sentence about him (name or he/his/him) and no opponent word within 40 chars before the name. */
const OLD_OPP = /\b(opponent'?s?|foe'?s?|rival'?s?|challenger'?s?|they|them)\b[^.,;]*$/i;
const oldRule = (s, at) => (who.test(s) || /\b(he|his|him)\b/i.test(s)) && !OLD_OPP.test(s.slice(Math.max(0, at - 40), at));
let oldOk = 0, newOk = 0, newOppAsFighter = 0, oldOppAsFighter = 0;
const wrong = [];
for (const [prev, s, word, truth] of SET) {
  const at = s.toLowerCase().indexOf(word);
  const ctx = { who, lastPerson: prev ? A.personAfter(prev, { who, lastPerson: null }) : null };
  const a = A.attribute(s, at, ctx);
  const isNew = a.actor === 'fighter' && A.FIGHTER_EVIDENCE.includes(a.evidence);
  const isOld = oldRule(s, at);
  if (isNew === truth) newOk++;
  else wrong.push({ s, word, truth, got: a });
  if (isOld === truth) oldOk++;
  if (isNew && !truth) newOppAsFighter++;
  if (isOld && !truth) oldOppAsFighter++;
}
console.log(`labelled ${SET.length}: old rule ${oldOk}/${SET.length} correct (not-his counted as his: ${oldOppAsFighter}); new ${newOk}/${SET.length} (not-his counted as his: ${newOppAsFighter})`);
check('[E1] 새 판별이 이전 규칙보다 정확(라벨 문장 세트)', newOk > oldOk, { oldOk, newOk });
check('[E2] 새 판별: 선수 기술이 아닌 것을 선수 기술로 센 경우 0', newOppAsFighter === 0, wrong);
check('[E3] 새 판별 정확도 90% 이상(이 세트 기준)', newOk / SET.length >= 0.9, wrong);
fs.writeFileSync(path.join(APP, 'data/audit/self-ai/fighter-attribution.json'), JSON.stringify({ at: new Date().toISOString(), note: 'labelled sentences written for the test (not collected from real pages)', total: SET.length, oldRule: { correct: oldOk, notHisCountedAsHis: oldOppAsFighter }, newRule: { correct: newOk, notHisCountedAsHis: newOppAsFighter }, wrong }, null, 2));

// ---- pronoun across sentences inside one page (personAfter chaining)
const page = (n, url, content, extra = {}) => ({ title: `page ${n}`, url, content, snippet: content.slice(0, 80), source: new URL(url).hostname, engines: ['x'], relevance: 1, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'ok' }, ...extra });
const arts = RE.artsForTopic('타격 스타일', null);
const p1 = page(1, 'https://a.example/x', 'Conor McGregor fights from a southpaw stance. Nate Diaz walked him down in the second round. He landed a series of jabs that bloodied McGregor. McGregor feints the jab to set up the left cross. McGregor counters with the cross when opponents rush in. McGregor throws a jab followed by a lead hook. The teep is a long-range kick used in muay thai. McGregor should throw more calf kicks.');
const r1 = RE.ruleBasedAnalysis(p1, 'Conor McGregor', arts);
const kinds = r1.items.map((i) => `${i.kind}:${(i.steps ?? []).join('>')}`);
check('[E4] 다음 문장의 "He"가 상대(Diaz)를 가리키면 그 잽은 상대 기술로 제외', r1.excluded.some((e) => /^Jab$/i.test(e.name) && e.evidence === 'opponent' && /bloodied/.test(e.quote)), r1.excluded);
check('[E5] 셋업(feint → cross)·콤비네이션(jab → lead hook)·카운터(cross)는 선수 문장에서', kinds.some((k) => k.startsWith('setup:')) && kinds.includes('combo:Jab>Lead Hook') && kinds.some((k) => k.startsWith('situation:')), kinds);
check('[E6] 일반 설명(teep)·조언(calf kicks)은 선수 기술이 아님(제외 목록에 일반/가정으로)', !kinds.some((k) => /Teep|Calf/i.test(k)) && r1.excluded.some((e) => /teep/i.test(e.name) && e.evidence === 'general') && r1.excluded.some((e) => /calf/i.test(e.name) && e.evidence === 'hypothetical'), r1.excluded.map((e) => [e.name, e.evidence]));
check('[E7] 선수 항목마다 근거 종류(실제 사용/분석) 기록', r1.items.every((i) => i.evidence === 'direct' || i.evidence === 'analysis'), r1.items.map((i) => i.evidence));
const vid = RE.ruleBasedAnalysis(page(2, 'https://www.youtube.com/watch?v=x', 'Conor McGregor knocks out Aldo with a left hand in 13 seconds.', { sourceType: 'video' }), 'Conor McGregor', arts);
check('[E8] 영상 제목·설명은 분석 근거가 아님(caption으로 제외)', !vid.items.length && vid.excluded.every((e) => e.evidence === 'caption'), vid);

// ---- independence: the same sentence syndicated on two sites ≠ "여러 자료에서 공통 확인"
const same = 'Conor McGregor relies on the left cross as his best weapon.';
const synd = [page(3, 'https://site-a.example/a', same), page(4, 'https://site-b.example/b', same)];
const mergedSynd = ES.mergeStyleItems(synd.map((p) => ({ page: p, items: RE.ruleBasedItems(p, 'Conor McGregor', arts) })), 'boxing');
const crossSynd = mergedSynd.find((i) => i.kind === 'technique' && /Cross/.test(i.text));
check('[E9] 같은 문장을 두 사이트가 옮겨 실은 경우 → 독립 출처 1곳(출처 1곳의 분석)', crossSynd?.support === 'source_analysis', crossSynd);
const indep = [page(5, 'https://site-c.example/c', same), page(6, 'https://site-d.example/d', 'McGregor counters with the cross when opponents rush in.')];
const mergedIndep = ES.mergeStyleItems(indep.map((p) => ({ page: p, items: RE.ruleBasedItems(p, 'Conor McGregor', arts) })), 'boxing');
check('[E10] 서로 다른 문장 두 사이트 → 여러 자료에서 공통 확인', mergedIndep.find((i) => i.kind === 'technique' && /Cross/.test(i.text))?.support === 'multi_source');
const oppOnly = [page(7, 'https://site-e.example/e', 'Conor McGregor met Poirier again. Poirier attacked the lead leg with calf kicks, and McGregor struggled to stand.'), page(8, 'https://site-f.example/f', 'Conor McGregor lost the rematch. Poirier landed calf kicks all night against McGregor.')];
const mergedOpp = ES.mergeStyleItems(oppOnly.map((p) => ({ page: p, items: RE.ruleBasedItems(p, 'Conor McGregor', RE.artsForTopic('', 'mixed-martial-arts')) })), 'mixed-martial-arts');
check('[E11] 두 사이트가 모두 상대의 기술로 쓴 Calf Kick은 선수 항목에 없음', !mergedOpp.some((i) => /calf/i.test(i.text)), mergedOpp.map((i) => i.text));

// ---- the report: evidence sentences, excluded mentions, categories not confirmed
const index = buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
const report = await ES.analyzeFighterStyleWithEvidence('Conor McGregor', 'mixed-martial-arts', {
  research: async (req) => (req.kind === 'video' ? { ok: true, kind: 'video', results: [], diagnostics: {} } : { ok: true, kind: 'web', results: [p1, page(9, 'https://b.example/y', 'Conor McGregor relies on the left cross as his best weapon. Aldo was dropped by a left hand from McGregor in 13 seconds.')], diagnostics: {} }),
  chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'off' }),
  knowledgeIndex: async () => index,
}, { fighterEn: 'Conor McGregor', arts });
const text = fighterReportText('맥그리거의 셋업, 콤비네이션, 카운터를 분석해 줘', report, { ok: true, query: '코너 맥그리거', en: 'Conor McGregor', ko: '코너 맥그레거', source: 'x' });
check('[E12] 보고서: 항목별 구역(주요 타격 기술·셋업·콤비네이션·카운터) + 근거 문장과 근거 종류', /■ 주요 타격 기술/.test(text) && /■ 셋업/.test(text) && /■ 콤비네이션/.test(text) && /■ 카운터/.test(text) && /근거: [a-z.]+\((실제 사용 서술|분석 자료의 설명)\) "/.test(text), text.slice(0, 900));
check('[E13] 확인할 수 없는 항목 표시(그래플링·경기 운영 등)', /■ 확인할 수 없는 항목: [^\n]*주요 그래플링 기술/.test(text), text.split('\n').filter((l) => /확인할 수 없는/.test(l)));
check('[E14] 상대 기술·일반 설명·가정은 "선수 기술에서 제외한 언급"으로 따로', /■ 선수 기술에서 제외한 언급/.test(text) && /상대가 사용한 기술 \d+건/.test(text) && /일반 기술 설명 \d+건/.test(text) && /가정·조언 \d+건/.test(text), text.slice(-900));
check('[E15] 영상 자체를 분석했다고 말하지 않음', /영상 자체를 분석하지 않음/.test(text) && !/영상에서 확인/.test(text.replace('"영상에서 확인됨"으로 표시하지 않습니다', '')));
check('[E16] 반복 패턴 구역(공통 확인 또는 빈도 표현이 없으면 없다고)', /■ 반복적으로 확인되는 패턴/.test(text));

// ---- 4차: search words, relevance, re-search, duplicates, failure causes, ambiguous names (fake search)
check('[E17] 검색어: 질문의 주제(타격·셋업·콤비네이션)만, 무관한 단어 없음', (() => { const q = ES.fighterQueries('Ilia Topuria', 'mixed-martial-arts', '토푸리아의 타격 스타일과 대표적인 셋업, 콤비네이션을 분석해 줘.', 1); return q[0] === 'Ilia Topuria striking breakdown' && /setups combinations/.test(q[1]) && !/interview|training/.test(q.join(' ')); })(), ES.fighterQueries('Ilia Topuria', 'mixed-martial-arts', '타격 셋업 콤비네이션', 1));
const tp = (n, url, title, content, extra = {}) => ({ ...page(n, url, content), title, ...extra });
let round = 0;
const searchedQueries = [];
const fakeResearch = async (req) => {
  if (req.kind === 'video') return { ok: true, kind: 'video', results: [], diagnostics: {} };
  round++;
  searchedQueries.push(req.query);
  if (round === 1) return { ok: true, kind: 'web', diagnostics: {}, results: [
    tp(11, 'https://notes.example/crypto', '암호화 메모장 사용법', 'This encrypted notepad stores your notes safely.'),
    tp(12, 'https://bio.example/oliveira', 'Charles Oliveira career', 'Charles Oliveira won many submissions in his career with the rear naked choke.'),
    tp(13, 'https://blocked.example/topuria', 'Ilia Topuria breakdown', '', { extraction: { status: 'blocked' }, content: undefined }),
    tp(14, 'https://a.example/topuria', 'Ilia Topuria striking breakdown', 'Ilia Topuria throws a jab followed by a lead hook to the body. Topuria uses the jab to set up the cross.'),
  ] };
  return { ok: true, kind: 'web', diagnostics: {}, results: [
    tp(15, 'https://b.example/topuria', 'How Topuria fights', 'Ilia Topuria relies on the left hook as his best weapon. Topuria counters with the cross when opponents rush in.'),
    tp(16, 'https://copy.example/topuria', 'Ilia Topuria striking breakdown (copy)', 'Ilia Topuria throws a jab followed by a lead hook to the body. Topuria uses the jab to set up the cross.'),
    tp(17, 'https://c.example/topuria', 'Topuria film study', 'Topuria doesn\'t rely on volume. Ilia Topuria throws a cross-weight discussion aside and fights from a southpaw stance.'),
  ] };
};
const rep2 = await ES.analyzeFighterStyleWithEvidence('Ilia Topuria', 'mixed-martial-arts', { research: fakeResearch, chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'off' }), knowledgeIndex: async () => index }, { fighterEn: 'Ilia Topuria', arts, question: '토푸리아의 타격 스타일과 셋업, 콤비네이션을 분석해 줘.' });
const log = rep2.searchLog;
check('[E18] 관련 본문 3곳 미만이면 다른 검색어로 재검색(2차), 최대 3회', log.rounds.length >= 2 && log.rounds.length <= 3 && searchedQueries[1] !== searchedQueries[0], log.rounds);
check('[E19] 무관한 결과(암호화 메모장·올리베이라 커리어)는 분석에서 제외, 실패 원인 "무관" 집계', log.failures.irrelevant >= 2 && !rep2.items.some((i) => i.quotes.some((q) => /notes|oliveira/.test(q.url))), log.failures);
check('[E20] 차단된 페이지는 "접근 실패"로 구분', log.failures.access >= 1, log.failures);
const hookItem = rep2.items.find((i) => i.kind === 'combo');
check('[E21] 같은 기사 사본(copy.example)은 독립 출처가 아님 → 콤비네이션은 출처 1곳', !!hookItem && hookItem.support === 'source_analysis', hookItem);
check('[E22] 부정문("doesn\'t rely on volume")·합성어("cross-weight")는 항목이 아님', !rep2.items.some((i) => /volume/.test(i.text)) && !rep2.items.some((i) => i.kind === 'technique' && /Cross/.test(i.text) && i.quotes.every((q) => /cross-weight/.test(q.quote))), rep2.items.map((i) => i.text));
const textT = fighterReportText('토푸리아의 타격 스타일과 셋업, 콤비네이션을 분석해 줘.', rep2, { ok: true, query: '토푸리아', en: 'Ilia Topuria', ko: '일리아 토푸리아', source: 'x', via: '"토푸리아" → 「일리아 토푸리아」(검색으로 찾은 전체 이름)' });
check('[E23] 보고서에 이름 확인 경로·검색 과정(회차·관련 건수)·사용 못한 이유', /이름 확인 경로: "토푸리아"/.test(textT) && /검색 과정: \d회 검색/.test(textT) && /사용하지 못한 이유: [^\n]*무관/.test(textT), textT.slice(0, 600));

const amb = [];
const ambOut = await runCoachTurn({ text: '존스의 타격 스타일을 분석해 줘', history: [], martialArt: null, requestId: 'amb' }, { research: async (r) => (amb.push(r), { ok: true, results: [], diagnostics: {} }), chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'off' }), knowledgeIndex: async () => index, learnerContext: () => '', resolveName: async (n) => ({ ok: false, query: n, reason: '여럿', candidates: ['존 존스', '타이런 존스'] }), fighterStyle: async () => { throw new Error('must not analyse'); } });
check('[E24] 동명이인(후보 여럿) → 선택하지 않고 전체 이름을 물어봄, 검색 안 함', /여럿입니다: 존 존스, 타이런 존스/.test(ambOut.message.text) && amb.length === 0, ambOut.message.text);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
