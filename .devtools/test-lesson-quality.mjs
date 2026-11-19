// Lesson content quality — offline, over the real technique DB and the real lesson engine.
//  - text checks (repeat / near-repeat / meaningless / empty quote / other technique's definition)
//  - readiness: stub records are not taught
//  - 사용자 테스트 D: "레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어."
//  - every lesson the engine runs (sample of DB records + the D plan) has no repeated /
//    empty / meaningless coach sentences
// Run: node .devtools/test-lesson-quality.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-quality-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as Q from ${mod('src/lib/coachLesson/lessonQuality.ts')};`,
  `export * as R from ${mod('src/lib/coachLesson/lessonReadiness.ts')};`,
  `export * as S from ${mod('src/lib/coachLesson/service.ts')};`,
  `export * as E from ${mod('src/lib/coachLesson/engine.ts')};`,
  `export * as P from ${mod('src/lib/selfAi/lessonPlanner.ts')};`,
  `export * as L from ${mod('src/lib/selfAi/chatLesson.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export { answerCoachQuestion } from ${mod('src/lib/coachKnowledge/questions.ts')};`,
  `export { getUnifiedAllTechniques, resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {},
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { Q, R, S, E, P, L, K, answerCoachQuestion, getUnifiedAllTechniques, resolveTechnique } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const kinds = (issues) => issues.map((i) => i.kind);

// ---- text checks
check('[T1] 같은 문장 반복 감지', kinds(Q.checkText(['무릎을 좁게 조여 팔이 빠지지 않게 합니다.', '고관절을 들어 올려 압박을 만듭니다.', '무릎을 좁게 조여 팔이 빠지지 않게 합니다.'])).includes('repeat'));
check('[T2] 유사 문장 반복 감지', kinds(Q.checkText('다리를 상대 머리 위로 완전히 넘기기 바랍니다. 그리고 다리를 상대의 머리 위로 완전히 넘겨야 합니다.')).includes('near_repeat'));
check('[T3] 분류 이름뿐인 문장 = 무의미', kinds(Q.checkText('Single Leg은 테이크다운 진입 (레슬링 계열) 분류의 기술입니다.')).includes('meaningless'));
check('[T4] 빈 인용("") 감지', kinds(Q.checkText('이 기술의 핵심을 다시 정리하면 ""입니다.')).includes('empty_quote'));
check('[T5] 다른 기술의 정의를 설명으로 사용 감지', kinds(Q.checkText(['더블 레그 테이크다운은 양다리를 감싸 안는 기술입니다.'], { technique: { name: 'Single Leg', koreanName: null, aliases: [] }, otherNames: ['더블 레그'] })).includes('name_mismatch'));
check('[T6] 짧은 확인 질문 반복은 허용', Q.checkText(['여기까지 이해되셨습니까?', '여기까지 이해되셨습니까?']).length === 0);
check('[T7] 너무 짧은 내용 감지', kinds(Q.checkText('잽.', { minTokens: 6 })).includes('too_short'));
check('[T8] 반복 제거는 첫 문장을 남김', Q.dedupeSentences(['고관절을 들어 올려 압박을 만듭니다.', '고관절을 들어 올려 압박을 만듭니다. 무릎을 조입니다 꽉 단단하게.']).join(' | ') === '고관절을 들어 올려 압박을 만듭니다. | 무릎을 조입니다 꽉 단단하게.');

// ---- readiness
const stub = resolveTechnique('sambo__single-leg');
const pos = resolveTechnique('wrestling__single-leg-position');
check('[R1] 빈 기록(sambo Single Leg) = 수업 불가', R.lessonReadiness(stub).level === 'insufficient', R.lessonReadiness(stub));
check('[R2] 자료 있는 기록(Single-Leg Position) = 수업 가능', R.lessonReadiness(pos).level === 'ready', R.lessonReadiness(pos));
check('[R3] 부족한 항목을 이름으로 보고', R.lessonReadiness(stub).missing.includes('핵심 포인트'));

// ---- test D plan
const D = '레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어.';
const index = K.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
const plan = P.planLesson(D, { index });
check('[D1] 질문의 무술(레슬링) 사용', plan.art === 'wrestling', plan.art);
check('[D2] 수업 기술은 모두 레슬링 + 수업 가능 기록', plan.items.length > 0 && plan.items.every((i) => (i.technique.martialArts ?? [i.technique.martialArt]).includes('wrestling') && i.readiness.level !== 'insufficient'), plan.items.map((i) => [i.technique.id, i.readiness.level]));
check('[D3] 다른 무술 기록(삼보 빈 기록·가라테 Choku-zuki)으로 대체하지 않음', !plan.items.some((i) => /sambo|karate/.test(i.technique.id)));
const planText = P.lessonPlanText(plan, (a) => ({ wrestling: '레슬링' })[a] ?? a);
check('[D4] 계획에 학습 목표·선수 지식·순서·셋업/콤보·상황·복습 항목', ['학습 목표', '선수 지식', '진행 순서', '셋업·콤보', '상황별 적용', '복습'].every((k) => planText.includes(k)), planText);
check('[D5] 없는 셋업·콤보는 "기록 없음"으로 명시 (지어내지 않음)', plan.sequences.length > 0 || planText.includes('셋업·콤보 기록이 아직 없습니다'));
check('[D6] 계획 문장 반복 없음', Q.checkText(planText.split('\n')).length === 0, Q.checkText(planText.split('\n')));
check('[D7] 무술 이름은 한국어로 표시', planText.includes('레슬링') && !planText.includes('— wrestling'), planText.split('\n')[0]);

// ---- the lesson engine run itself
// What the coach SAYS (explanations + feedback). Quiz lines are questions and may be re-asked;
// lines that restate the answer on purpose (after misses / video / recap) are marked by RESTATE.
const RESTATE = /^(정리하면|이 기술의 핵심을 다시 정리하면|영상에서는|.*수업은 여기까지입니다)/;
// Feedback is a short reaction ("조금 다른 방향입니다.") chosen in turn from a few wordings: it must
// not repeat back to back; explanations must not repeat anywhere in the lesson.
const said = (r) => S.actionsToMessages(r.actions).filter((m) => m.kind !== 'quiz' && m.kind !== 'feedback').map((m) => m.text);
const feedbackOf = (r) => S.actionsToMessages(r.actions).filter((m) => m.kind === 'feedback').map((m) => m.text);
function runLesson(t, answer = '1') {
  let r = S.startLesson(t);
  const lines = said(r);
  const feedback = feedbackOf(r);
  for (let i = 0; i < 24 && r.state.currentStage !== 'COMPLETE'; i++) {
    const ev = r.state.pending ? { type: 'STUDENT', text: answer, intent: 'answer' } : r.state.currentStage === 'VIDEO' ? { type: 'VIDEO_DONE' } : r.state.currentStage === 'PRACTICE' ? { type: 'PRACTICE_DONE', completed: true } : { type: 'STUDENT', text: '이해했어', intent: 'understood' };
    r = E.lessonStep(r.state, S.lessonContextFor(t), ev);
    lines.push(...said(r));
    feedback.push(...feedbackOf(r));
  }
  const backToBack = feedback.filter((f, i) => i > 0 && f === feedback[i - 1]);
  return { lines, stage: r.state.currentStage, backToBack };
}
const BAD = ['repeat', 'near_repeat', 'empty_quote', 'meaningless'];
for (const it of plan.items) {
  for (const ans of ['1', '모르겠어']) {
    const { lines, stage, backToBack } = runLesson(it.technique, ans);
    const issues = Q.checkText(lines, { restate: RESTATE }).filter((i) => BAD.includes(i.kind));
    check(`[D8] ${it.technique.name} 수업(답 "${ans}") — 반복·빈 인용·무의미 문장 없음, 같은 피드백 연속 없음, 완료까지 진행`, issues.length === 0 && !backToBack.length && stage === 'COMPLETE', { stage, issues: issues.slice(0, 4), backToBack });
  }
}
// the D lesson as the old build produced it: stub record → refused, not taught
const refused = L.startLessonFromProposal({ topic: D, martialArt: 'sambo', techniqueIds: ['sambo__single-leg'], sequenceIds: [], sourceUrls: [], candidateIds: [] }, index, [], 'c1');
check('[D9] 빈 기록만으로는 수업을 만들지 않고 자료 부족 안내', refused.ok === false && /자료/.test(refused.message), refused);
const started = L.startLessonFromProposal({ topic: D, martialArt: 'wrestling', techniqueIds: plan.items.map((i) => i.technique.id).concat('sambo__single-leg'), sequenceIds: [], sourceUrls: [], candidateIds: [] }, index, [], 'c1');
check('[D10] 계획 기술로 수업 생성, 빈 기록은 빠짐', started.ok && !started.curriculum.days[0].techniqueIds.includes('sambo__single-leg') && started.curriculum.days[0].techniqueIds.length === plan.items.length, started.ok ? started.curriculum.days[0].techniqueIds : started);

// ---- 사용자 테스트 A: 기술 질문 (MARTIALDEX 데이터 답변)
const A = 'BJJ의 암바를 설명해 줘. 기술의 원리, 주요 포인트, 흔한 실수와 대응 방법을 알려 줘.';
const armbar = resolveTechnique('bjj__armbar');
const a = await answerCoachQuestion(armbar, A, { useModel: false, martialArt: 'bjj' });
check('[A1] 질문한 항목별 구역(설명·원리·핵심 포인트·실수와 대응)', ['■ 기술 설명', '■ 원리', '■ 핵심 포인트', '■ 흔한 실수와 대응'].every((h) => a.text.includes(h)), a.text);
check('[A2] 같은 자료 문장 반복 없음 (예전: 핵심 포인트·실수·설명이 두 번씩)', Q.checkText(a.text.split('\n')).filter((i) => i.kind === 'repeat').length === 0, Q.checkText(a.text.split('\n')));
check('[A3] 설명은 가장 적합한 1개만 (별칭 조각 "---" 제외)', !a.text.includes('---') && (a.text.match(/■ 기술 설명\n/g) ?? []).length === 1, a.text);
check('[A4] 대응은 자료 항목이 아니라 연결임을 밝힘 (사실/연결 구분)', /자료에 따로 있는 항목이 아니라/.test(a.text));
check('[A6] 같은 핵심 포인트 문장을 다시 쓰지 않고 번호로 가리킴', (a.text.match(/다리를 상대 머리 위로 완전히 넘기기\./g) ?? []).length === 1 && /바로잡기: 위 핵심 포인트 1번/.test(a.text), a.text);
check('[A5] 모든 문장이 기술 기록의 문장 (기록에 없는 내용 추가 없음)', (() => {
  const p = armbar.posture;
  const pool = [p.overview, armbar.description, ...(p.keyPoints ?? []), ...(p.commonMistakes ?? []), ...armbar.principles].join(' ');
  return a.text.split('\n').filter((l) => /^- |^\d+\. |^  → 바로잡기: (?!위 핵심)/.test(l)).every((l) => pool.includes(l.replace(/^- (실수: )?|^\d+\. |^  → 바로잡기: /, '').replace(/\.$/, '')));
})(), a.text);

// ---- sweep: lessons over a fixed sample of teachable DB records
const all = getUnifiedAllTechniques().filter((t) => R.lessonReadiness(t).level !== 'insufficient');
const step = Math.max(1, Math.floor(all.length / 60));
const sample = all.filter((_, i) => i % step === 0).slice(0, 60);
const bad = [];
for (const t of sample) {
  for (const ans of ['1', '모르겠어']) {
    const run = runLesson(t, ans);
    const issues = Q.checkText(run.lines, { restate: RESTATE }).filter((i) => BAD.includes(i.kind));
    if (issues.length || run.backToBack.length) bad.push({ id: t.id, ans, issues: issues.slice(0, 2), backToBack: run.backToBack });
  }
}
check(`[S1] DB 기록 ${sample.length}개 수업 — 반복·빈 인용·무의미 문장 없음`, bad.length === 0, { count: bad.length, first: bad.slice(0, 3) });

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
