// 수업 중 질문(사용자 테스트 E) + 선수 분석(사용자 테스트 F) — offline, real technique DB,
// real lesson session store, scripted search pages and model.
// Run: node .devtools/test-lesson-question-fighter.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-fighter-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as LQ from ${mod('src/lib/selfAi/lessonQuestion.ts')};`,
  `export * as RE from ${mod('src/lib/fighterStyle/ruleExtract.ts')};`,
  `export * as ES from ${mod('src/lib/fighterStyle/evidenceStyle.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export * as SS from ${mod('src/lib/aiCoachDay/sessionStore.ts')};`,
  `export { resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { A, LQ, RE, ES, K, SS, resolveTechnique } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const index = K.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
const page = (n, url, content, extra = {}) => ({ title: `page ${n}`, url, content, snippet: content.slice(0, 100), source: new URL(url).hostname, engines: ['x'], relevance: 1, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'ok' }, ...extra });

// ---------------- E: in-lesson question
const E = '지금 배우는 기술에서 상대가 방어하면 어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘.';
const SL = 'wrestling__single-leg-position';
const searches = [];
const chats = [];
const depsE = (chatOk = true) => ({
  research: async (req) => (searches.push(req), { ok: true, kind: 'web', results: [page(1, 'https://wr.example/sl', 'When your opponent sprawls on the single leg, keep the leg tight to your chest and run the pipe or switch to a high crotch. If he defends with a whizzer, circle away.')], diagnostics: { backend: 'fake', rawCount: 1 } }),
  chat: async (req) => (chats.push(req), chatOk ? { ok: true, text: '상대가 스프롤하면 다리를 가슴에 붙이고 파이프 피니시나 하이 크로치로 전환합니다 [1]. 위저로 막으면 바깥으로 돌아 나갑니다 [1].', model: 'fake-model', evalCount: 1, ms: 1 } : { ok: false, code: 'NOT_RUNNING', message: '로컬 AI 꺼짐' }),
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  dataAnswer: async () => '관련 기술은 세 가지입니다.',
});
// a running lesson whose state must not change
SS.startCoachDayRun('c1', 1, 'text', [SL, 'wrestling__single-leg-down-defense']);
const before = JSON.stringify(SS.getCoachDayRun());
const e = await A.runCoachTurn({ text: E, history: [], martialArt: 'wrestling', inLesson: true, lessonTechniqueId: SL, requestId: 'e' }, depsE());
check('[E1] 수업 중 질문으로 분류 + 검색 수행', e.plan.intent === 'lesson_question' && searches.length === 1, [e.plan.intent, searches.length]);
check('[E2] 검색어는 지금 배우는 기술 기준 (영어 이름 + 레슬링 + 상대 방어 시 공격자 쪽)', /^single-leg position wrestling .*(defends|defense)/i.test(searches[0].query) && searches[0].queries.some((q) => /방어 대응/.test(q)), searches[0]);
check('[E3] 답변에 수업 기술의 MARTIALDEX 기록 (상대 반응을 다룬 원문 문장)', /■ MARTIALDEX 기록/.test(e.message.text) && /수업 기술: .*Single-Leg Position/.test(e.message.text) && /상대가 다리를 회수함/.test(e.message.text), e.message.text);
check('[E4] 관련 기술 목록만 내놓지 않음 (예전 답변)', !/^관련 기술은 세 가지입니다/.test(e.message.text) && /■ 검색 자료 요약/.test(e.message.text), e.message.text);
check('[E5] 요약은 검색 자료 번호로 인용, 출처 첨부', /\[1\]/.test(e.message.text) && e.message.sources?.length === 1 && !e.message.guardNotes);
check('[E6] 모델에는 질문·수업 기술·검색 자료만 (짧은 요약 요청)', chats.length === 1 && chats[0].maxTokens <= 400 && /Single-Leg Position/.test(chats[0].messages[0].content) && /\[검색 자료\]/.test(chats[0].messages[0].content), chats[0]?.maxTokens);
check('[E7] 수업으로 복귀 안내', /수업은 하던 단계에서 그대로 이어집니다/.test(e.message.text));
check('[E8] 수업 상태(단계·진행·기록) 그대로', before !== 'null' && JSON.stringify(SS.getCoachDayRun()) === before);
const eOff = await A.runCoachTurn({ text: E, history: [], martialArt: 'wrestling', inLesson: true, lessonTechniqueId: SL, requestId: 'e2' }, depsE(false));
check('[E9] 로컬 AI 꺼짐: 기록 + "요약하지 못함" + 출처 (지어내지 않음)', /■ MARTIALDEX 기록/.test(eOff.message.text) && /요약하지 못했습니다/.test(eOff.message.text) && eOff.message.sources?.length === 1, eOff.message.text);
const facts = LQ.lessonTechniqueFacts(resolveTechnique('bjj__armbar'), index, E);
check('[E10] 기록된 전환(Armbar → Triangle)을 이어지는 기술로', facts.lines.some((l) => /이어지는 기술.*Triangle/.test(l)), facts.lines);
const bare = { id: 'user__bare', martialArt: 'wrestling', name: 'Bare Record', koreanName: null, aliases: [], category: 'x', positions: [], description: '', purpose: null, principles: [], variations: [], counters: [], defenses: [], transitions: [], relatedTechniques: [], relatedMartialArts: [], tags: [] };
const stub = LQ.lessonTechniqueFacts(bare, index, E);
check('[E11] 연결 기록이 없으면 없다고 말함', !stub.hasData && stub.lines.some((l) => /대응·연결 기술이 없습니다/.test(l)), stub.lines);
const sambo = LQ.lessonTechniqueFacts(resolveTechnique('sambo__single-leg'), index, E);
check('[E12] 기술 그래프의 실제 연결은 그대로 보고', sambo.hasData && sambo.lines.some((l) => /이어지는 기술.*Basic Double Leg/.test(l)), sambo.lines);

// ---------------- rule-based style extraction
const arts = RE.artsForTopic('타격 스타일', null);
const items = RE.ruleBasedItems(page(1, 'https://a.example/x', 'Conor McGregor throws a jab followed by a lead hook to the head. He loves to evade strikes and set up the cross with a feint. McGregor counters with the cross as opponents step in. His opponent tried to slip the jab every time. Conor McGregor fights from a southpaw stance.'), 'Conor McGregor', arts);
const kinds = items.map((i) => `${i.kind}:${(i.steps ?? []).join('>')}`);
check('[R1] 콤비네이션: "jab followed by a lead hook"', kinds.includes('combo:Jab>Lead Hook'), kinds);
check('[R2] 셋업: "set up the cross with a feint"', kinds.some((k) => k.startsWith('setup:') && k.includes('Cross')), kinds);
check('[R3] 카운터: "counters with the cross"', kinds.some((k) => k.startsWith('situation:') && k.includes('Cross')), kinds);
check('[R4] 일반 동사("evade")는 기술로 보지 않음', !kinds.some((k) => /Evade/.test(k)), kinds);
check('[R5] 상대의 동작("His opponent tried to slip")은 이 선수 기술 아님', !kinds.some((k) => /Slip/.test(k)), kinds);
check('[R6] 스탠스는 거리·스탠스 항목', kinds.some((k) => k.startsWith('distance:') && /Southpaw/i.test(k)), kinds);
check('[R7] 인용은 원문 문장 그대로', items.every((i) => /Conor McGregor|McGregor|He |His /.test(i.quote)));
const hy = RE.ruleBasedItems(page(4, 'https://d.example/w', 'Conor McGregor likes the jab-cross down the middle.'), 'Conor McGregor', arts).map((i) => `${i.kind}:${(i.steps ?? []).join('>')}`);
check('[R9] "jab-cross" 표기도 콤비네이션', hy.includes('combo:Jab>Cross'), hy);
const list = RE.ruleBasedItems(page(5, 'https://e.example/v', 'McGregor attacks with a wide variety of kicks, ranging from front kicks, side kicks and roundhouse kicks.'), 'Conor McGregor', arts).filter((i) => i.kind === 'combo');
check('[R10] 쉼표로 나열한 기술 목록은 콤비네이션이 아님', list.length === 0, list);
check('[R8] 선수 이름이 없는 페이지는 사용 안 함', RE.ruleBasedItems(page(2, 'https://b.example/y', 'Khabib Nurmagomedov uses a double leg followed by a single leg to finish takedowns all the time.'), 'Conor McGregor', arts).length === 0);

// ---------------- F: fighter analysis turn
const F = '코너 맥그리거의 타격 스타일을 분석해 줘. 대표적인 셋업, 콤비네이션, 카운터와 근거 자료를 구분해서 정리해 줘.';
const fSearches = [];
const PAGES = [
  page(1, 'https://evolve.example/mcgregor', 'Conor McGregor relies on the left cross as his best weapon. McGregor throws a jab followed by a lead hook to finish exchanges.'),
  page(2, 'https://bloody.example/mcgregor', 'McGregor counters with the cross when opponents rush in. His opponent tried to slip the jab every time.'),
];
const depsF = {
  research: async (req) => (fSearches.push(req), req.kind === 'video'
    ? { ok: true, kind: 'video', results: [{ ...page(9, 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'x'), sourceType: 'video', video: { platform: 'youtube', videoId: 'AAAAAAAAAAA', embed: 'embeddable' } }], diagnostics: { backend: 'fake' } }
    : { ok: true, kind: 'web', results: PAGES, diagnostics: { backend: 'fake', rawCount: 2 } }),
  chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'off' }),
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  resolveName: async (n) => ({ ok: true, query: n, en: 'Conor McGregor', ko: '코너 맥그레거', source: 'https://ko.wikipedia.org/wiki/x' }),
  fighterStyle: (fighter, art, opts) => ES.analyzeFighterStyleWithEvidence(fighter, art, { research: depsF.research, chat: depsF.chat, knowledgeIndex: depsF.knowledgeIndex }, opts),
};
const f = await A.runCoachTurn({ text: F, history: [], martialArt: null, requestId: 'f' }, depsF);
const ft = f.message.text;
check('[F1] 선수 분석 도구 사용 (논문 검색 없음)', f.plan.intent === 'fighter' && f.message.model === 'martialdex-evidence' && !fSearches.some((r) => r.kind === 'paper'), [f.plan.intent, fSearches.map((r) => r.kind)]);
check('[F2] 영문 이름 확인 근거(위키백과) + 영문 이름으로 검색', /Conor McGregor \(위키백과 한국어 문서/.test(ft) && fSearches.some((r) => /Conor McGregor/.test(r.query)), fSearches.map((r) => r.query));
// (3차: 보고서가 근거 수준별 → 항목별(주요 타격 기술·셋업·콤비네이션·카운터 …) 구성으로 바뀜. 근거 수준은 각 줄에 그대로 표시)
check('[F3] 두 사이트에서 확인된 Cross = "여러 자료에서 공통 확인"', /■ 주요 타격 기술\n- Cross · 여러 자료에서 공통 확인/.test(ft), ft);
check('[F4] 한 곳에서만 나온 콤비네이션 = "출처 1곳의 분석" + 원문 근거', /■ 콤비네이션\n- Jab → Lead Hook · 출처 1곳의 분석\n  근거: evolve\.example/.test(ft), ft);
check('[F5] 요청 항목별 요약 (셋업 없으면 "확인 못함")', /■ 요청하신 항목: 셋업: 자료에서 확인 못함 \/ 콤비네이션 1건 \/ 카운터 1건/.test(ft), ft.split('\n').filter((l) => l.includes('요청하신')));
check('[F6] "논문을 찾지 못했습니다" 같은 잘못된 문구 없음', !/논문/.test(ft));
check('[F7] 영상은 카드로, 내용 미확인 명시', f.message.videos?.length === 1 && /영상 내용 미확인/.test(ft), f.message.videos);
const fighterPart = ft.split('■ 선수 기술에서 제외한 언급')[0];
check('[F8] 상대의 동작(slip)은 선수 기술로 기록하지 않음 — 분석 항목에 없고, "상대가 사용한 기술"로만', !/Slip/.test(fighterPart) && /상대가 사용한 기술 \d+건: [^\n]*Slip/.test(ft), ft.slice(-700));
check('[F9] 선수 기술을 MARTIALDEX 기술 id로 연결', f.message.techniqueIds.some((id) => /cross/.test(id)), f.message.techniqueIds);
const fEmpty = await A.runCoachTurn({ text: F, history: [], martialArt: null, requestId: 'f2' }, { ...depsF, fighterStyle: (fighter, art, opts) => ES.analyzeFighterStyleWithEvidence(fighter, art, { research: async (req) => ({ ok: true, kind: req.kind, results: req.kind === 'web' ? [page(3, 'https://c.example/z', 'Conor McGregor is a famous athlete from Ireland who likes music and fashion.')] : [], diagnostics: { backend: 'fake' } }), chat: depsF.chat, knowledgeIndex: depsF.knowledgeIndex }, opts) });
check('[F10] 근거가 없으면 이유와 함께 빈 결과 (지어내지 않음)', /근거 없는 분석은 만들지 않았습니다/.test(fEmpty.message.text) && /기술 이름을 찾지 못했습니다/.test(fEmpty.message.text), fEmpty.message.text);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
