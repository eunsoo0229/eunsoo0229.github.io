// 6차 — "실습 완료했어" said again right after the practice was settled (offline, no AI, no browser).
// Bundles the pure lesson modules (engine + intent) and drives a real jab lesson to its
// post-practice question (PRACTICE_REVIEW), then checks which inputs are a REPEAT
// (isRepeatedPracticeDone → the screens re-ask the question, the engine is not called)
// and which keep the existing rules (skip / question / answer).
// Run: node .devtools/test-practice-done-repeat.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'practice-repeat-')), 'lesson.mjs');
const entry = path.join(path.dirname(out), 'entry.ts');
fs.writeFileSync(entry, ['engine', 'concepts', 'scenario', 'intent'].map((m) => `export * from ${JSON.stringify(path.join(APP, 'src/lib/coachLesson', m + '.ts'))};`).join('\n'));
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const L = await import(pathToFileURL(out).href);

const posture = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/posture.json'), 'utf8'));
const arr = JSON.parse(fs.readFileSync(path.join(APP, 'data/processed/boxing.json'), 'utf8'));
const list = Array.isArray(arr) ? arr : arr.techniques ?? Object.values(arr);
const jab = { ...list.find((x) => x.id === 'boxing__jab'), videos: [], posture: posture.boxing__jab };
const ctx = { name: L.lessonName(jab), concepts: L.buildConcepts(jab, { distractors: ['상대의 다리를 잡아 넘어뜨리는 테이크다운입니다.', '상대의 목을 조르는 기술입니다.'] }), scenarios: L.buildScenarios(jab), keyPointsReference: L.keyPointsReference(jab), prior: null };

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (detail && !pass ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''));
}

// a lesson at "ready to practise" → PRACTICE_DONE (once) → the post-practice question
let r = L.lessonStep(L.createLessonState(jab.id, ctx), ctx, { type: 'START' });
for (let i = 0; i < 40 && r.directive !== 'ready'; i++) {
  if (r.directive === 'video') r = L.lessonStep(r.state, ctx, { type: 'VIDEO_DONE' });
  else r = L.lessonStep(r.state, ctx, { type: 'STUDENT', text: '건너뛸게', intent: 'skip' });
}
check('[R0] 수업이 실습 대기(ready)까지 진행', r.directive === 'ready', r.state.currentStage);
const before = r.state;
check('[R0b] 실습 중(practiceDone=false)에는 반복으로 보지 않음', !L.isRepeatedPracticeDone('실습 완료했어', before));
const done = L.lessonStep(before, ctx, { type: 'PRACTICE_DONE', completed: true });
const s = done.state;
check('[R1] PRACTICE_DONE → PRACTICE_REVIEW, 실습 후 질문 대기', s.practiceDone && s.currentStage === 'PRACTICE_REVIEW' && s.pending?.purpose === 'practice_review', { stage: s.currentStage, pending: s.pending });

for (const t of ['실습 완료했어', '다 했어', '끝났어', '마쳤어', '실습 끝났어요', '완료']) check(`[B1/B2] 실습 직후 "${t}" → 반복(확인 단계 유지)`, L.isRepeatedPracticeDone(t, s));
check('[B4] "다음으로 넘어가자" → 반복 아님(기존 skip 규칙 유지)', !L.isRepeatedPracticeDone('다음으로 넘어가자', s) && L.classifyIntent('다음으로 넘어가자', s.pending) === 'skip');
const skipped = L.lessonStep(s, ctx, { type: 'STUDENT', text: '다음으로 넘어가자', intent: 'skip' });
check('[B4b] 기존 엔진: skip → "이 질문은 넘어가겠습니다" 후 다음 진행', skipped.actions.some((a) => /넘어가겠습니다/.test(a.content ?? '')) && skipped.state.currentStage !== 'PRACTICE_REVIEW', skipped.state.currentStage);
for (const t of ['잽을 뻗을 때 턱은 어떻게 해?', '언제 끝나?', '아직 안 끝났어']) check(`[B3] "${t}" → 반복 아님(기존 처리)`, !L.isRepeatedPracticeDone(t, s));
check('[B3b] 실제 답변("앞손을 빠르게 뻗고 바로 회수했어요") → 반복 아님', !L.isRepeatedPracticeDone('앞손을 빠르게 뻗고 바로 회수했어요', s));
// after the review question was answered/skipped, the guard is off
check('[B5] 확인 단계를 지난 뒤에는 반복 처리하지 않음', !L.isRepeatedPracticeDone('실습 완료했어', skipped.state));
// the guard does not touch the state (the screens do not call the engine): PRACTICE_DONE fired once
const again = L.isRepeatedPracticeDone('실습 완료했어', s) ? s : L.lessonStep(s, ctx, { type: 'STUDENT', text: '실습 완료했어', intent: 'answer' }).state;
check('[B6] 반복 발화 후 상태 그대로(PRACTICE_REVIEW, 같은 질문)', again === s && again.pending?.text === s.pending?.text);
// without the guard (old path), the repeat would be graded as an answer — the bug the guard prevents
check('[B7] 참고: 가드가 없으면 같은 발화가 확인 질문의 "답변"으로 분류됨', L.classifyIntent('실습 완료했어', s.pending) === 'answer');

const passed = results.filter((x) => x.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
