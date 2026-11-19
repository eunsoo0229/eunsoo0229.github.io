// AI 코치 대화 파이프라인 (11차) — offline: multi-intent routing, profile as comparison data, DB + web + video
// as separate searches merged into one answer, conversation memory, lesson from the conversation, the coach's own
// lesson offer (accept / decline), lesson context kept. Real technique DB; search and model are scripted fakes;
// the fighter profile is a test profile in an in-memory localStorage. No network, no Supabase, no Gemini.
// Run: node .devtools/test-coach-conversation-pipeline.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach11-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as I from ${mod('src/lib/selfAi/intents.ts')};`,
  `export * as M from ${mod('src/lib/selfAi/conversationMemory.ts')};`,
  `export * as P from ${mod('src/lib/fighterProfile/store.ts')};`,
  `export * as ST from ${mod('src/lib/fighterProfile/styleTraits.ts')};`,
  `export * as PF from ${mod('src/lib/coachContext/personalFacts.ts')};`,
  `export * as CL from ${mod('src/lib/selfAi/chatLesson.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export * as L from ${mod('src/lib/coachKnowledge/lookup.ts')};`,
  `export * as CA from ${mod('src/lib/coachContext/coachAnalysis.ts')};`,
  `export * as CR from ${mod('src/lib/selfAi/compositeResearch.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
let realCalls = 0;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: { askAi: async () => (realCalls++, { ok: false }), webSearch: async () => (realCalls++, { ok: false }) },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { A, I, M, P, ST, PF, CL, K, L, CR, CA } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}

// ---- test profile: southpaw, switches often, kicks, wrestling entries off strikes
for (const [k, v] of [
  ['body.stance', 'southpaw'], ['body.stanceSwitch', 'often'], ['kick.favorite', ['low', 'middle']], ['mma.strikeStyle', 'entry'],
  ['wr.entry', ['levelChange', 'snap']], ['box.counter', 'often'], ['move.counterAfterDefense', 'often'], ['train.arts', ['mixed-martial-arts', 'wrestling']],
]) {
  const r = P.setItem(k, { value: v, source: 'self_report' });
  if (!r.ok) console.log('profile set failed', k, r.message);
}
const sp = ST.styleProfileOf();
check('[P1] 프로필 → 비교용 특징(사우스포·킥·레벨 체인지 진입)', sp.traits.some((t) => t.id === 'stance:southpaw') && sp.traits.some((t) => t.kind === 'kicking') && sp.traits.some((t) => t.id === 'entry:levelChange'), sp.traits.map((t) => t.id));

// ---- fakes
const page = (url, title, content, extra = {}) => ({ title, url, content, snippet: content.slice(0, 140), source: new URL(url).hostname, engines: ['fake'], relevance: 1, sourceType: 'article', sourceTypeLabel: '기사', reliability: { level: 'medium', label: '보통' }, extraction: { status: 'ok' }, ...extra });
const video = (id, title, channel, snippet = '') => ({ title, url: `https://www.youtube.com/watch?v=${id}`, snippet, source: 'youtube.com', engines: ['fake'], relevance: 1, sourceType: 'video', sourceTypeLabel: '영상', reliability: { level: 'medium', label: '보통' }, extraction: { status: 'skipped' }, video: { platform: 'youtube', videoId: id, channel, duration: '8:12', embed: 'embeddable' } });
const searches = [];
const research = async (req) => {
  searches.push(req);
  const q = [req.query, ...(req.queries ?? [])].join(' | ').toLowerCase();
  if (req.kind === 'video') {
    return { ok: true, kind: 'video', diagnostics: { rawCount: 4 }, results: [
      video('aaaaaaa1', 'Double Leg Setup Tutorial for MMA — level change off the jab', 'Grappling Lab', 'how to set up the double leg in MMA'),
      video('aaaaaaa2', 'UFC Fight Night full highlights', 'Fight Channel'),
      video('aaaaaaa3', 'MMA Wrestling Instructional: Double Leg Entries', 'Cage Wrestling Academy', 'double leg entries drill'),
      video('aaaaaaa1', 'Double Leg Setup Tutorial for MMA — level change off the jab', 'Grappling Lab'),
    ] };
  }
  if (/percentage|how common|rare in mma/.test(q)) {
    return { ok: true, kind: 'web', diagnostics: {}, results: [page('https://stats.example/southpaw', 'Southpaws in MMA', 'Roughly 20 percent of fighters on the roster compete from a southpaw stance. Southpaw fighters are less common than orthodox fighters.')] };
  }
  if (/ufc fighters|fighter style|fighters ufc/.test(q)) {
    return { ok: true, kind: 'web', diagnostics: {}, results: [
      page('https://style-a.example/x', 'Southpaw counter strikers', 'Kai Morrow is a southpaw counter puncher who loves leg kicks before he shoots a level change double. Dario Lenz fights orthodox and is known as a pressure fighter.'),
      page('https://style-b.example/y', 'Fighters who switch stance', 'Kai Morrow switches stance mid-exchange and lands body kicks. Tomas Quill is a southpaw kicker with a strong counter game.'),
    ] };
  }
  if (/morrow|quill/.test(q)) {
    return { ok: true, kind: 'web', diagnostics: {}, results: [page('https://fighter-setups.example/morrow', 'Kai Morrow takedowns', 'Kai Morrow sets up the double leg with a jab and a level change. He also uses a collar tie snap down before the double leg.')] };
  }
  if (/double leg/.test(q)) {
    return { ok: true, kind: 'web', diagnostics: {}, results: [
      page('https://mma-wrestling.example/double', 'Double leg setups in MMA', 'In MMA the double leg is often set up with a jab followed by a level change. Fighters throw the overhand to hide the level change before the double leg. A collar tie snap down can open the double leg. Running the pipe is a common finish after the shot.'),
      page('https://coach-blog.example/dl', 'Five double leg entries', 'The jab to double leg is the classic entry. Use an underhook against the cage, then change levels for the double leg. Blast double off the opponent\'s punch is a counter entry.'),
    ] };
  }
  return { ok: true, kind: req.kind ?? 'web', diagnostics: {}, results: [] };
};
const chatCalls = [];
const chat = async (req) => {
  chatCalls.push(req);
  return { ok: true, text: '제 판단으로는 레벨 체인지 진입이 프로필과 잘 맞습니다.', model: 'fake', evalCount: 1, ms: 1 };
};
const index = K.buildKnowledgeIndex({});
const baseDeps = {
  research, chat, knowledgeIndex: async () => index, learnerContext: () => '', artName: (a) => a,
  personalFact: (text) => { const q = PF.personalFactQuery(text); return q ? PF.answerPersonalFact(q) : null; },
  styleProfile: () => ST.styleProfileOf(), lessonFit: () => '',
  personalAnalysis: async (text, art) => { const k = CA.analysisQuery(text); return k ? CA.answerAnalysis(k, { index: async () => index, art }) : null; },
};
let n = 0;
async function turn(history, text, extra = {}) {
  const o = await A.runCoachTurn({ text, history, martialArt: null, requestId: `t${n++}`, ...extra }, { ...baseDeps, ...(extra.deps ?? {}) });
  const user = { id: `u${n}`, role: 'user', text, createdAt: '' };
  const msg = { id: `a${n}`, createdAt: '', ...o.message };
  return { out: o, history: [...history, user, msg], msg };
}

// ---- intents (no word decides the whole turn)
const ia1 = I.analyzeIntents('내 파이팅 스타일과 비슷한 선수들을 찾아보고, 그 선수들의 더블렉 셋업도 조사해 줘.');
check('[I1] 복합 의도: 선수 비교 + 셋업 조사 (프로필 조회 아님)', ia1.composite && ia1.intents.includes('FIGHTER_COMPARISON') && ia1.intents.includes('SETUP_RESEARCH') && !ia1.intents.includes('PROFILE_LOOKUP'), ia1);
const ia2 = I.analyzeIntents('내 파이팅 스타일 보여줘');
check('[I2] "보여줘"만 = 프로필 조회', ia2.intents.join() === 'PROFILE_LOOKUP' && !ia2.composite, ia2);
const ia3 = I.analyzeIntents('잽이 뭐야?');
check('[I3] 단순 질문 = 복합 아님 (기존 경로)', !ia3.composite, ia3);
const ia4 = I.analyzeIntents('복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어');
check('[I4] 셋업 수업 요청 하나 = 기존 수업 경로 유지', !ia4.composite, ia4);
const ia5 = I.analyzeIntents('이 셋업이 실제 경기에서는 어떤 상황에서 사용돼?', { inLesson: true });
check('[I5] 수업 중 질문은 수업 질문 경로 유지', !ia5.composite, ia5);

// ---- Test A: profile vs intent
let h = [];
let r = await turn([], '내 파이팅 스타일을 분석해 줘.');
check('[A1] 스타일 분석 = 기록 기반 분석 + 프로필로 계산한 스타일 (값 출력 아님)', /파이팅 스타일/.test(r.msg.text) && /프로필 답변으로 계산한 스타일/.test(r.msg.text) && /근거:/.test(r.msg.text), r.msg.text.slice(0, 400));
r = await turn([], '나와 비슷한 UFC 선수는?');
check('[A2] 비슷한 선수 = 선수 비교 검색 + 근거 문장', /비슷한 스타일의 선수/.test(r.msg.text) && /Kai Morrow/.test(r.msg.text) && /근거\(/.test(r.msg.text), r.msg.text.slice(0, 600));
check('[A2b] 다른 점도 설명 (오소독스 선수는 다름 표시)', !/1\. Dario Lenz/.test(r.msg.text), r.msg.text);
check('[A2c] 키·리치만으로 비교하지 않음 (근거는 스타일 특징)', /비교 기준\(내 프로필\)/.test(r.msg.text));
r = await turn([], '내 파이팅 스타일은 얼마나 희귀해?');
check('[A3] 희귀성 = 자료 수치는 원문 인용, 임의 백분위 없음', /스타일 희귀성/.test(r.msg.text) && /20 percent/.test(r.msg.text) && !/상위\s*\d+\s*%/.test(r.msg.text), r.msg.text.slice(0, 500));
r = await turn([], '내 스타일의 약점은?');
check('[A4] 약점 = 분석 (프로필 약점 항목 또는 기록 없음 명시) — 스타일 값 출력이 아님', /약점/.test(r.msg.text) && /(불편한 방어|약점을 기록으로 말할 수 없습니다|본인이 꼽은)/.test(r.msg.text) && r.msg.model !== 'martialdex-data', [r.msg.model, r.msg.text.slice(0, 300)]);
r = await turn([], '내 스타일에 맞는 더블렉 셋업을 찾아줘.');
check('[A5] 내 스타일에 맞는 셋업 = 셋업 조사 + 기록 (프로필 출력 아님)', /셋업/.test(r.msg.text) && /MARTIALDEX 내부 기록/.test(r.msg.text) && r.out.plan.techniques.length > 0, [r.msg.tasks, r.msg.text.slice(0, 300)]);
const fact = await turn([], '내 파이팅 스타일 보여줘');
check('[A6] 명시적 프로필 조회는 그대로 저장값 답변', fact.msg.model === 'martialdex-data' && fact.msg.personalData, fact.msg);

// ---- Test B: internal DB + external search + video + comparison
r = await turn([], '더블렉 관련 기술을 MARTIALDEX에서 찾아줘.');
check('[B1] 내부 검색 = MARTIALDEX 기록 (더블렉 인식)', r.out.plan.techniques.some((t) => /double/i.test(t.id)) || /double/i.test(r.msg.text), [r.out.plan.techniques.map((t) => t.id), r.msg.text.slice(0, 200)]);
h = r.history;
r = await turn(h, 'MMA에서 활용되는 더블렉 셋업도 조사해 줘.');
check('[B2] MMA 셋업 = 내부 기록 + 외부 검색 둘 다', /MARTIALDEX 내부 기록/.test(r.msg.text) && /외부 자료/.test(r.msg.text) && searches.some((s) => /MMA double leg setup/i.test(s.query)), [r.msg.tasks, searches.slice(-2)]);
check('[B2b] 외부 문장 근거로 셋업 추출 (잽 → 더블렉 등)', /근거:/.test(r.msg.text) || /jab/i.test(r.msg.text), r.msg.text.slice(0, 900));
h = r.history;
r = await turn(h, '더블렉 셋업을 설명하는 유튜브 강의도 찾아줘.');
const vs = searches.filter((s) => s.kind === 'video').pop();
check('[B3] 영상 = 여러 검색어 (MMA/코칭/강좌)', vs && [vs.query, ...(vs.queries ?? [])].length >= 3, vs);
check('[B3b] 경기 하이라이트·중복 제거, 강의 영상 우선, 내용 확인 불가 표시', r.msg.videos?.length === 2 && /내용 확인: 안 함/.test(r.msg.text) && !/full highlights/.test(r.msg.text.split('■ 유튜브 강의 영상')[1] ?? ''), [r.msg.videos?.map((v) => v.title), r.msg.text.slice(-600)]);
h = r.history;
r = await turn(h, '내부 DB에 없는 기술이 있는지 비교해 줘.');
check('[B4] DB 비교 = 대화 주제(더블렉) 복원 + 없는 기술 후보 (DB 변경 없음)', /외부 자료 ↔ MARTIALDEX 비교/.test(r.msg.text) && /(신규 등록 후보|이미 있는 것)/.test(r.msg.text) && /DB는 바꾸지 않았습니다/.test(r.msg.text) && /double/i.test(r.msg.text.split('비교')[1] ?? ''), r.msg.text.slice(0, 1200));
const lastB = r;

// ---- Test D (continues the double-leg thread): the coach offers a lesson on its own
check('[D1] 같은 주제를 여러 번 깊게 다룸 → AI가 먼저 수업 제안', !!lastB.msg.lessonProposal?.suggested && /수업으로 구성해 볼 수 있어요/.test(lastB.msg.text) || [r.history.slice(-6)].some((x) => x.some((m) => m.lessonProposal?.suggested)), r.history.filter((m) => m.role === 'assistant').map((m) => [m.turn?.topicKey, m.turn?.suggestion]));
const offered = r.history.filter((m) => m.lessonProposal?.suggested).pop();
check('[D2] 제안에 실제 작동하는 수업 데이터 (기술·시퀀스)', offered && offered.lessonProposal.techniqueIds.length > 0, offered?.lessonProposal);
if (offered) {
  const cur = CL.buildLessonCurriculum(offered.lessonProposal, index, offered.sources ?? [], 'conv_test');
  check('[D3] 수업 시작 버튼 → 기존 수업 엔진용 커리큘럼 생성', !!cur && cur.days?.[0]?.techniqueIds?.length > 0, cur && { days: cur.days?.length, ids: cur.days?.[0]?.techniqueIds });
}
// decline → plain talk, and no re-offer for that topic
const offerAt = r.history.findLastIndex((m) => m.lessonProposal?.suggested);
const hOffer = r.history.slice(0, offerAt + 1);
let dec = await turn(hOffer, '아니, 괜찮아');
check('[D4] 제안 거절 → 일반 대화 계속', /대화를 이어갈게요/.test(dec.msg.text) && !dec.msg.lessonProposal, dec.msg.text);
let after = await turn(dec.history, 'MMA에서 더블렉 셋업 영상 하나만 더 찾아줘');
check('[D5] 거절한 주제는 다시 제안하지 않음', !after.msg.lessonProposal?.suggested, [after.msg.turn, after.msg.text.slice(-200)]);
// accept → the button
const acc = await turn(hOffer, '좋아');
check('[D6] 제안 수락 → 수업 시작 버튼', !!acc.msg.lessonProposal && /수업 시작/.test(acc.msg.text), acc.msg.text);
// in a lesson: answered, the lesson untouched
const tech = r.out.plan.techniques[0] ?? L.exactTechniquesInText('더블렉', null).matches[0];
const inLesson = await turn([], '내 파이팅 스타일과 비슷한 선수도 알려줘', { inLesson: true, lessonTechniqueId: tech?.id });
check('[D7] 수업 중 새 질문 → 답하고 수업 유지 (새 수업 제안 없음)', /수업은 하던 단계에서 그대로 이어집니다/.test(inLesson.msg.text) && !inLesson.msg.lessonProposal, inLesson.msg.text.slice(-200));

// ---- Test C: memory across an unrelated question
h = [];
r = await turn(h, '더블렉은 어떤 기술이야?'); h = r.history;
r = await turn(h, '더블렉 셋업과 연계 기술도 조사해 줘'); h = r.history;
r = await turn(h, 'MMA에서 더블렉 활용 사례도 찾아줘'); h = r.history;
r = await turn(h, '잽은 뭐야?'); h = r.history;
r = await turn(h, '아까 이야기했던 내용으로 수업하고 싶어');
check('[C1] 다른 질문 뒤에도 "아까" 주제(더블렉) 복원 → 수업 제안', !!r.msg.lessonProposal && r.msg.lessonProposal.techniqueIds.some((id) => /double/i.test(id)) && /더블|Double/i.test(r.msg.lessonProposal.topic), [r.msg.lessonProposal, r.msg.text.slice(0, 300)]);
check('[C2] 수업 구성에 대화 내용 반영 (다룬 측면·질문)', (r.msg.lessonProposal?.summary ?? []).some((s) => /셋업|MMA/.test(s)), r.msg.lessonProposal?.summary);
const memC = M.buildConversationMemory(h);
check('[C3] 대화 기억: 주제·측면 구조화', memC.topics.some((t) => /double/i.test(t.key) && t.turns >= 3 && t.aspects.includes('setup') && t.aspects.includes('mma')), memC.topics.map((t) => [t.key, t.turns, t.aspects]));
const r2 = await turn(h, '그럼 이걸 수업으로 만들어 줘');
check('[C4] "이걸 수업으로" = 최근 주제로 수업', !!r2.msg.lessonProposal, r2.msg.text.slice(0, 200));

// ---- Test E: everything at once
const before = searches.length;
const e = await turn([], '내 파이팅 스타일과 비슷한 선수들의 더블렉 셋업을 찾아보고, 관련 MMA 강의 영상까지 조사해서 나에게 맞는 수업으로 만들어 줘.');
const tasks = (e.msg.tasks ?? []).map((t) => t.label).join(' | ');
check('[E1] 한 번에: 선수 비교 + 선수별 셋업 + 영상 + 수업', /비슷한 스타일의 선수/.test(tasks) && /셋업/.test(tasks) && /유튜브/.test(tasks) && /수업 구성/.test(tasks) && !!e.msg.lessonProposal, [tasks, e.msg.lessonProposal]);
const eSearches = searches.slice(before);
check('[E2] 각 검색은 별도 요청 (캐시 충돌 방지)', eSearches.length >= 3 && new Set(eSearches.map((s) => JSON.stringify(s))).size === eSearches.length, eSearches.map((s) => s.query));
check('[E3] 모델 요약은 조사 결과만 근거로 + 라벨', /코치 정리/.test(e.msg.text) && chatCalls.some((c) => /\[조사 결과\]/.test(c.messages[0].content)), e.msg.text.slice(-400));
check('[E4] 프로필 원문 전체를 출력하지 않음', !/기본 스탠스:|주로 쓰는 킥:/.test(e.msg.text), e.msg.text.slice(0, 400));

// ---- external vs DB: a term MARTIALDEX lacks becomes a candidate with its quote; DB terms link to the record
{
  const pg = [page('https://a.example/1', 'x', 'He uses a wall walk to stand up, then a mat return after the double leg. The jab sets it up.'), page('https://b.example/2', 'y', 'A mat return finishes the takedown against the cage.')];
  const ex = CR.externalVsDb(pg, 'wrestling', index);
  const names = ex.map((e) => `${e.name}:${e.inDb}`);
  console.log('   external terms:', names.join(', '));
  check('[B5] DB에 없는 용어 = 후보(근거 문장·사이트 수), 있는 용어 = 기존 기록 연결', ex.some((e) => !e.inDb && e.sites.length >= 1 && e.quote) && ex.some((e) => e.inDb && e.dbName), ex);
  check('[B5b] 후보 텍스트에 DB 미변경 명시', /DB는 바꾸지 않았습니다/.test(CR.externalVsDbText(ex)), CR.externalVsDbText(ex));
}

// ---- live-run regressions (2026-11-08): list sentences, non-names, MMA research without web
{
  const pg = [page('https://arch.example/a', 'archetypes', 'Build Your Own Style: pick a gym. Commentators say Arlo Venn came up as a kickboxer, Mika Torres came out of sambo and wrestling.')];
  const ms = CR.similarFighters(pg, ST.styleProfileOf());
  const venn = ms.find((x) => x.name === 'Arlo Venn');
  check('[L1] 여러 선수를 나열한 문장: 다른 선수의 특징(레슬링)을 붙이지 않음', !venn || !venn.shared.some((x) => /wrestler/.test(x.trait.id)), ms.map((x) => [x.name, x.shared.map((y) => y.trait.id)]));
  check('[L2] "Build Your Own" 같은 문구는 선수 이름이 아님', !ms.some((x) => /Build/.test(x.name)), ms.map((x) => x.name));
  const pg2 = [page('https://mj.example/a', 'best', 'That said, Edwards, akin to the previous selection Kamaru Usman, is also your classic southpaw counter fighter in UFC.'), page('https://mj.example/c', 'run-on', 'That said, Edwards is your classic southpaw counter fighter.Edwards, as seen in the latter parts of his series with pound-for-pound great Kamaru Usman, got a lot better at building off of his southpaw arsenal.'), page('https://lh.example/b', 'lefties', 'Lyoto Machida The Brazilian-Japanese Shotokan karateka built one of the most distinctive styles in UFC history around his southpaw stance.')];
  const ms2 = CR.similarFighters(pg2, ST.styleProfileOf());
  console.log('   live-case names:', ms2.map((x) => `${x.name}[${x.shared.map((y) => y.trait.id).join(',')}]`).join(' '));
  check('[L4] 문장 주어가 다른 선수면 뒤에 나온 이름에 특징을 붙이지 않음 (Edwards 문장 → Usman 아님)', !ms2.some((x) => x.name === 'Kamaru Usman' && x.shared.some((y) => y.trait.id === 'stance:southpaw')), ms2.map((x) => [x.name, x.shared.map((y) => y.trait.id)]));
  check('[L5] "Lyoto Machida The …" → 이름만 남기고 사우스포 근거 연결, "Japanese Shotokan"은 이름 아님', ms2.some((x) => x.name === 'Lyoto Machida') && !ms2.some((x) => /Shotokan|Japanese/.test(x.name)), ms2.map((x) => x.name));
  const ia = I.analyzeIntents('MMA에서 싱글렉을 어떻게 쓰는지 조사해 줘', { namesTechnique: true });
  check('[L3] 기술 + MMA 조사 = 복합(내부 기록 + 외부 검색)', ia.composite && ia.intents.includes('MMA_STRATEGY_RESEARCH'), ia);
}

// ---- honesty when search is off
const off = await turn([], 'MMA에서 활용되는 더블렉 셋업과 유튜브 강의도 찾아줘', { deps: { research: async () => ({ ok: false, code: 'DISABLED', message: '자체 검색 꺼짐' }) } });
check('[H1] 검색 꺼짐 → 검색했다고 말하지 않고 실패 표시', /검색 실패|검색하지 못했습니다/.test(off.msg.text) && off.msg.tasks?.some((t) => t.status === 'failed'), off.msg.tasks);
check('[H2] 실제 네트워크 호출 0', realCalls === 0, realCalls);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
