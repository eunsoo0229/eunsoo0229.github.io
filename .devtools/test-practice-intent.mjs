// 기술 연습 의도 → 수업 제안 — offline test (real router + real coachAgent + real technique DB; the model and the
// search are fakes, no network). Covers the reported bug: "체크훅을 연습하고 싶어" used to be answered with a dry
// technique description (or "자료를 찾지 못했습니다") instead of offering the lesson the learner asked for.
//   node .devtools/test-practice-intent.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as R from ${mod('src/lib/selfAi/router.ts')};`,
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
const { R, A, K } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? pass++ : fail++;
  console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${c ? '' : ` :: ${JSON.stringify(d)?.slice(0, 400)}`}`);
};
let searched = 0;
const deps = () => ({
  research: async () => (searched++, { ok: true, results: [], diagnostics: { failedEngines: [], queries: [] } }),
  chat: async () => ({ ok: true, text: '(모델 답변)', model: 'fake' }),
  knowledgeIndex: () => K.loadKnowledgeIndex(),
  learnerContext: () => '',
  dataAnswer: async () => null,
  artName: (a) => a,
});
const intentOf = (t, opts = {}) => R.planTurn(t, opts).intent;

// ---------------------------------------------------------------- A. 의도 인식 (사양 §6)
// the learner does not have to use a command form; these are all "I want to train this technique"
const PRACTICE = ['체크훅을 연습하고 싶어', '체크훅 좀 익히고 싶다', '체크훅 훈련해 볼까?', '더블렉 연습하고 싶어', '체크훅 마스터하고 싶어'];
for (const t of PRACTICE) check(`[A] 연습 의도로 인식: "${t}"`, intentOf(t) === 'practice', { got: intentOf(t) });
check('[A] "배우고 싶어"는 기존 수업 의도 유지 (회귀 없음)', intentOf('더블렉을 배우고 싶어') === 'lesson', { got: intentOf('더블렉을 배우고 싶어') });

// a description request must NOT become a lesson offer
const EXPLAIN = ['잽은 어떻게 쳐?', '체크훅이 뭐야?', '잽 연습 방법 알려줘', '체크훅과 잽의 차이 설명해줘'];
for (const t of EXPLAIN) check(`[A] 설명 요청은 연습 의도가 아님: "${t}"`, intentOf(t) !== 'practice', { got: intentOf(t) });
check('[A] 수업 중에는 연습 의도로 가로채지 않음 (수업 흐름 유지)', intentOf('체크훅을 연습하고 싶어', { inLesson: true }) !== 'practice');
check('[A] 기술 이름이 없으면 연습 의도가 아님 (기존 훈련 계획 경로 유지)', intentOf('오늘 훈련하고 싶어') !== 'practice', { got: intentOf('오늘 훈련하고 싶어') });

// ---------------------------------------------------------------- B. 수업 제안 (사양 §7)
searched = 0;
const r = await A.runCoachTurn({ text: '체크훅을 연습하고 싶어', history: [], martialArt: null, requestId: 't1' }, deps());
check('[B] 설명이 아니라 수업 제안으로 답함', r.plan.intent === 'practice' && r.message.model === 'martialdex-plan', { intent: r.plan.intent, model: r.message.model });
check('[B] 요청한 기술이 수업 제안에 들어감 ("이 주제로 수업 시작" 버튼의 근거)', !!r.message.lessonProposal && r.message.lessonProposal.techniqueIds.some((id) => /check-hook/.test(id)), r.message.lessonProposal);
check('[B] 사용자의 의도를 먼저 받아 줌 (기술 이름 + 연습)', /체크훅.*연습이군요/.test(r.message.text), r.message.text.slice(0, 120));
check('[B] 무엇을 다루는지 단계가 보임 (수업 계획)', /수업 계획/.test(r.message.text) && /진행 순서/.test(r.message.text));
check('[B] 연습 요청에 "자료를 찾지 못했습니다"로 끝내지 않음 (사양 §8)', !/찾지 못했습니다\s*$/.test(r.message.text.trim()));
check('[B] 이미 DB에 있는 기술 연습 요청에는 웹 검색을 하지 않음 (속도·관련성)', searched === 0, { searched });
check('[B] 기존 결정론적 수업 엔진에 넘길 뿐, 진도·완료를 코치가 정하지 않음', !/완료|숙련도를 올렸|통과했습니다/.test(r.message.text));

// ---------------------------------------------------------------- C. 회귀 (설명 경로는 그대로)
searched = 0;
const r2 = await A.runCoachTurn({ text: '잽은 어떻게 쳐?', history: [], martialArt: 'boxing', requestId: 't2' }, deps());
check('[C] 기술 설명 질문은 기존대로 모델 답변', r2.plan.intent === 'technique' && !r2.message.lessonProposal, { intent: r2.plan.intent, proposal: r2.message.lessonProposal });

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
