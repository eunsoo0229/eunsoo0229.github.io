// Free questions in the middle of a lesson (spec 9-B) — offline, with the REAL technique DB,
// the REAL lesson engine and the REAL session store (localStorage mock); search / model /
// fighter analysis are fakes that record what they were asked.
//   - every question type of spec 3-1 is routed to the right tool, about the technique being taught
//   - the lesson state (step, index, pending question, understanding, outcomes, techniques) is
//     byte-identical after each question and after 3+ questions in a row; only messages grow
//   - the engine still gets answers / "모르겠어요" / "다시 설명해 주세요" after questions
//   - adding techniques: proposal first, nothing changes until "추가", appended at the end
// Run: node .devtools/test-lesson-free-question.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-free-q-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as S from ${mod('src/lib/aiCoachDay/sessionStore.ts')};`,
  `export * as LS from ${mod('src/lib/selfAi/lessonSession.ts')};`,
  `export * as CL from ${mod('src/lib/selfAi/chatLesson.ts')};`,
  `export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export { startLesson, lessonEvent } from ${mod('src/lib/coachLesson/service.ts')};`,
  `export { answerCoachQuestion } from ${mod('src/lib/coachKnowledge/questions.ts')};`,
  `export { buildKnowledgeIndex } from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export { resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}

// ---- a running lesson: wrestling High Single (taught), then Single to Double; engine started, question pending
const ids = ['wrestling__high-single', 'wrestling__single-to-double'];
M.S.startCoachDayRun('test-curriculum', 1, 'text', ids, null, [], 'martialdex');
const cur = M.resolveTechnique(ids[0]);
const started = M.startLesson(cur);
M.S.updateCoachDayRun((r) => ({ ...r, step: 'lesson', lessons: { [cur.id]: started.state } }));
const pendingBefore = M.S.getCoachDayRun().lessons[cur.id].pending?.text ?? null;

const index = M.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
const calls = { research: [], chat: 0, fighter: [] };
let searchDown = false;
const fakeResult = (kind, i) => ({ title: `${kind} result ${i}`, url: `https://example${i}.org/${kind}/${i}`, source: `example${i}.org`, snippet: 'single leg finish when the opponent sprawls', content: kind === 'web' ? 'When the opponent sprawls on your high single, run the pipe or switch to a double. The single leg takedown finish depends on the opponent reaction.' : undefined, sourceType: kind === 'video' ? 'video' : kind === 'paper' ? 'paper' : 'article', reliability: { level: 'medium', label: '보통', reasons: [] }, contentRead: kind === 'web', engines: ['x'], extraction: { status: kind === 'web' ? 'ok' : 'skipped' }, ...(kind === 'video' ? { video: { videoId: `vid${i}xxxxxx`.slice(0, 11), embed: 'embeddable', thumbnail: '', channel: 'ch' } } : {}) });
const deps = {
  research: async (req) => {
    calls.research.push(req);
    if (searchDown) return { ok: false, code: 'NOT_RUNNING', message: '자체 검색 서버(SearXNG)가 실행 중이 아닙니다.' };
    return { ok: true, kind: req.kind, results: [1, 2].map((i) => fakeResult(req.kind ?? 'web', i)), diagnostics: { rawCount: 2 } };
  },
  chat: async () => {
    calls.chat++;
    return { ok: true, text: '상대가 스프롤하면 파이프를 돌리거나 더블로 전환합니다 [1].', model: 'qwen2.5:3b', evalCount: 20, ms: 10 };
  },
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  artName: (a) => ({ wrestling: '레슬링' })[a] ?? a,
  dataAnswer: async (t, text, art) => (await M.answerCoachQuestion(t, text, { useModel: false, martialArt: art })).text,
  resolveName: async (n) => ({ ok: true, query: n, en: 'Conor McGregor' }),
  fighterStyle: async (f, art) => {
    calls.fighter.push(f);
    return { fighter: f, martialArt: art, items: [], videos: [], candidates: [], sources: [], limits: [], searched: true, webResults: [], videoResults: [], pagesRead: 0 };
  },
};

/** One question as the lesson screen asks it: route → coach with the lesson snapshot → append Q + A. */
async function ask(text) {
  const run = M.S.getCoachDayRun();
  const before = M.LS.lessonStateKey(run);
  const route = M.LS.routeLessonInput(text, run, cur);
  if (route.to !== 'question') return { route, before, after: before };
  const snap = M.LS.lessonSnapshot(run, { topic: '레슬링 싱글 레그', goals: ['싱글 레그 진입'], art: 'wrestling' });
  calls.research = [];
  const o = await M.runCoachTurn({ text, history: [], martialArt: 'wrestling', inLesson: true, lessonTechniqueId: cur.id, lesson: snap, requestId: `t-${Date.now()}` }, deps);
  M.S.appendMessages([{ role: 'user', text }, { role: 'coach', kind: 'answer', side: true, text: o.message.text, sources: o.message.sources, videos: o.message.videos, proposal: o.message.lessonAdd }]);
  return { route, o, before, after: M.LS.lessonStateKey(M.S.getCoachDayRun()), queries: calls.research.flatMap((r) => [r.query, ...(r.queries ?? [])]) };
}
const same = (r) => r.before === r.after;
const msgsBefore = M.S.getCoachDayRun().messages.length;

const q1 = await ask('이 기술이 정확히 어떤 원리로 작동해?');
check('[B1] 원리 질문 → 질문 경로, 지금 기술(High Single) 기록으로 답변(관련 기술 목록 아님)', q1.route.to === 'question' && q1.o.plan.techniques[0]?.id === cur.id && q1.o.message.model === 'martialdex-data' && !/^관련 기술은/.test(q1.o.message.text) && same(q1), [q1.route.plan.intent, q1.o?.message.text.slice(0, 200)]);
const q2 = await ask('상대가 방어하면 어떻게 대응해야 해?');
check('[B2] 상대 방어 질문 → 수업 기술 기록 + 그 기술로 겨냥한 검색, 상태 불변', q2.o.plan.intent === 'lesson_question' && q2.queries.some((q) => /high single/i.test(q)) && q2.o.message.text.includes('MARTIALDEX 기록') && same(q2), [q2.queries, q2.o.message.text.slice(0, 200)]);
const q3 = await ask('이 기술과 연결되는 다른 기술을 알려 줘.');
check('[B3] 연결 기술 질문 → 기록 기반(같은 분류 Single to Double 등), 검색 없음', q3.o.plan.intent === 'related' && q3.o.message.text.includes('MARTIALDEX 기록') && q3.queries.length === 0 && same(q3), q3.o.message.text.slice(0, 300));
const q4 = await ask('실제 선수들은 이 기술을 어떻게 활용해?');
check('[B4] 실제 활용 질문 → 그 기술의 실전 활용 검색(used in fights)', q4.queries.some((q) => /high single.*(used in fights|fight)/i.test(q)) && same(q4), [q4.o.plan.intent, q4.queries]);
const q5 = await ask('이 기술을 배우기 전에 알아야 하는 내용이 있어?');
check('[B5] 선행 지식 질문 → Single-Leg Position(같은 계열 시작 자세)', q5.o.plan.intent === 'prerequisite' && /Single-Leg Position/.test(q5.o.message.text) && same(q5), q5.o.message.text.slice(0, 300));
const r6 = M.LS.routeLessonInput('방금 설명한 내용을 더 쉽게 설명해 줘.', M.S.getCoachDayRun(), cur);
// with the engine's question pending, a request sentence ending in "…설명해 줘." is still a question (화면 테스트에서 발견: 답변으로 채점되던 문제)
check('[B6b] 엔진 질문 대기 중 "…상대가 방어하면 어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘." → 질문 경로(채점 안 함)', !!M.S.getCoachDayRun().lessons[cur.id].pending && M.LS.routeLessonInput('지금 배우는 기술에서 상대가 방어하면 어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘.', M.S.getCoachDayRun(), cur).to === 'question' && M.LS.routeLessonInput('이 기술 핵심 포인트 알려 줘', M.S.getCoachDayRun(), cur).to === 'question');
check('[B6] "더 쉽게 설명해 줘" → 수업 엔진의 재설명(기존 동작 유지)', r6.to === 'engine', r6.plan.intent);
const q7 = await ask('관련 교육 영상을 찾아 줘.');
check('[B7] 영상 요청 → 지금 기술 영상 검색, 영상 카드용 결과', q7.o.plan.intent === 'video' && q7.queries.some((q) => /high single|하이 싱글/i.test(q)) && (q7.o.message.sources ?? []).every((s) => s.sourceType === 'video') && q7.o.message.sources?.length === 2 && same(q7), [q7.queries, q7.o.message.sources?.length]);
const q8 = await ask('다른 기술과 비교해 줘.');
check('[B8] 비교 대상 없는 비교 요청 → 같은 분류 후보 제시(지어낸 비교 없음)', q8.o.plan.intent === 'compare' && /어떤 기술과 비교할까요/.test(q8.o.message.text) && same(q8), q8.o.message.text.slice(0, 200));
const q9 = await ask('이 기술을 연습하기 위한 셋업과 콤보를 알려 줘.');
check('[B9] 셋업·콤보 질문 → 지금 기술 기준 셋업·콤보 보고서', q9.o.plan.intent === 'sequence' && q9.o.plan.techniques[0]?.id === cur.id && same(q9), [q9.o.plan.intent, q9.queries]);
const q10 = await ask('지금까지 배운 내용을 복습시켜 줘.');
check('[B10] 복습 요청 → 지금 기술 핵심 포인트(기록) + 진도 영향 없음 안내', q10.o.plan.intent === 'review' && q10.o.message.text.includes('High Single') && q10.o.message.text.includes('진도에 영향을 주지 않습니다') && same(q10), q10.o.message.text.slice(0, 300));
const q11 = await ask('더블 레그는 뭐야?');
check('[B11] 다른(새) 기술 질문 → 그 기술(Double Leg) 기준', q11.o.plan.techniques.some((t) => /double/i.test(t.name)) && same(q11), q11.o.plan.techniques.map((t) => t.id));
const q12 = await ask('코너 맥그리거는 어떤 콤보를 자주 써?');
check('[B12] 선수 질문 → 선수 분석 도구(영문 이름 확인 후)', q12.o.plan.intent === 'fighter' && calls.fighter.includes('Conor McGregor') && same(q12), q12.o.plan.intent);
const q13 = await ask('싱글렉 관련 스포츠 과학 논문 찾아 줘.');
check('[B13] 논문 요청 → 영어 학술 질의(single leg)', q13.o.plan.intent === 'paper' && q13.queries.some((q) => /single leg/i.test(q)) && same(q13), q13.queries);

// ---- B14 / B15: many questions in a row, then the lesson continues
const run = M.S.getCoachDayRun();
const keyNow = M.LS.lessonStateKey(run);
check('[B14] 질문 12개 연속 후 수업 상태(단계·진도·대기 질문·이해도·결과·기술 목록) 동일', keyNow === M.LS.lessonStateKey({ ...run, messages: [] }) && run.step === 'lesson' && run.index === 0 && (run.lessons[cur.id].pending?.text ?? null) === pendingBefore, { step: run.step, index: run.index });
check('[B15] 질문·답변은 대화 기록에 저장(질문마다 2개)', run.messages.length - msgsBefore === 24, run.messages.length - msgsBefore);
check('[B16] 수업 복귀: "모르겠어요"·답변·"준비됐어"는 수업 엔진으로', ['모르겠어요', '양손으로 허벅지를 감싸 안아요', '준비됐어'].every((t) => M.LS.routeLessonInput(t, run, cur).to === 'engine'));
const after = M.lessonEvent(cur, run.lessons[cur.id], { type: 'SKIP' });
check('[B17] 질문 뒤에도 수업 엔진이 같은 대기 질문에서 이어짐(건너뛰기 → 다음 단계)', !!after?.state && after.state !== run.lessons[cur.id], after?.state?.currentStage);
const snap = M.LS.lessonSnapshot(M.S.getCoachDayRun(), { topic: 'x', goals: [], art: 'wrestling' });
check('[B18] 수업 맥락: 지금 기술·단계·이어서 배울 기술·이전 질문이 프롬프트 블록에', /High Single/.test(M.LS.lessonContextBlock(snap)) && /이어서 배울 기술: .*Single to Double/.test(M.LS.lessonContextBlock(snap)) && snap.recentQA.length === 3, M.LS.lessonContextBlock(snap));

// ---- B19 search down mid-lesson
searchDown = true;
const q19 = await ask('관련 교육 영상을 찾아 줘.');
searchDown = false;
check('[B19] 검색 서버 꺼짐 → 검색 못 했다고 말함(영상 목록 없음), 상태 불변', /검색/.test(q19.o.message.text) && !(q19.o.message.sources?.length) && same(q19), q19.o.message.text.slice(0, 200));

// ---- B20.. additions with consent
const q20 = await ask('이 기술의 방어와 대응도 같이 공부하고 싶어.');
const prop = q20.o.message.lessonAdd;
check('[B20] 방어·대응 추가 요청 → 제안(Single-Leg Down Defense 등), 아직 추가 안 됨', q20.o.plan.intent === 'lesson_add' && prop?.kind === 'defense' && prop.techniqueIds.some((id) => /single-leg-down-defense/.test(id)) && same(q20) && M.S.getCoachDayRun().techniqueIds.length === 2, [prop, q20.o.message.text.slice(0, 200)]);
check('[B21] 제안 문장에 근거(기록된 연결)와 "추가할까요"', /추가할까요/.test(q20.o.message.text) && prop && Object.values(prop.reasons).every((r) => r.length > 5));
const pend = M.LS.pendingProposal(M.S.getCoachDayRun().messages);
check('[B22] 대기 중인 제안 찾기 + 동의 문장 해석', !!pend && ['응, 추가해 줘', '추가해 주세요', '네 추가해주세요', '좋아요', '추가'].every((x) => M.LS.consentOf(x) === 'yes') && ['아니요', '괜찮아요', '아니'].every((x) => M.LS.consentOf(x) === 'no') && ['상대가 스프롤하면?', '추가로 질문 있어', ''].every((x) => M.LS.consentOf(x) === null), ['응, 추가해 줘', '추가해 주세요', '좋아요', '아니요', '추가로 질문 있어'].map((x) => [x, M.LS.consentOf(x)]));
const beforeAccept = M.S.getCoachDayRun();
const res = M.CL.acceptLessonAddition(pend.proposal);
const afterAccept = M.S.getCoachDayRun();
check('[B23] 동의 후 추가: 수업 끝에 붙고, 단계·현재 위치·대기 질문·기존 결과 그대로', res.added.length > 0 && afterAccept.techniqueIds.slice(0, 2).join() === ids.join() && afterAccept.index === beforeAccept.index && afterAccept.step === beforeAccept.step && JSON.stringify(afterAccept.lessons) === JSON.stringify(beforeAccept.lessons) && JSON.stringify(afterAccept.outcomes[ids[0]]) === JSON.stringify(beforeAccept.outcomes[ids[0]]), { added: res.added, ids: afterAccept.techniqueIds });
const q24 = await ask('이 기술과 연결되는 다른 기술도 배우고 싶어');
check('[B24] 연결 기술 추가 요청 → 제안(이미 수업에 있는 기술 제외)', q24.o.plan.intent === 'lesson_add' && (!q24.o.message.lessonAdd || q24.o.message.lessonAdd.techniqueIds.every((id) => !M.S.getCoachDayRun().techniqueIds.includes(id))) && same(q24), q24.o.message.lessonAdd ?? q24.o.message.text.slice(0, 200));
const n0 = M.S.getCoachDayRun().techniqueIds.length;
check('[B25] 거절하면 아무것도 바뀌지 않음(제안만 남음)', M.S.getCoachDayRun().techniqueIds.length === n0);
const q26 = await ask('이 선수의 대표적인 콤보를 추가해 줘');
check('[B26] 선수 이름 없는 선수 콤보 추가 → 이름을 물어봄, 추가 없음', /선수.*이름/.test(q26.o.message.text) && !q26.o.message.lessonAdd && same(q26), q26.o.message.text);
check('[B27] 모델 호출은 검색 본문 요약에만(코드 작성 답변이 대부분)', calls.chat <= 3, calls.chat);

const q28 = await ask('이 기술을 더 잘하려면 내가 뭘 연습해야 해?');
check('[B28] "더 잘하려면 뭘 연습해야 해?" → 내 기록(학습 상태·자세 점수)·연습 추천, 수업 상태 동일', q28.o.plan.intent === 'improve' && /내 기록/.test(q28.o.message.text) && /연습 추천/.test(q28.o.message.text) && /그대로 이어집니다/.test(q28.o.message.text) && same(q28), q28.o.message.text.slice(0, 400));
const q29 = await ask('이 기술 자세가 맞는지 확인하고 싶어');
check('[B29] 수업 중 자세 확인 요청 → 자세 확인 경로(측정 불가 기술은 안내만), 수업 상태 동일', q29.o.plan.intent === 'pose_check' && same(q29), [q29.o.plan.intent, q29.o.message.text.slice(0, 200)]);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
