// 4차 — personal AI coach (spec 10-2, 10-3). Offline, the REAL technique DB and the REAL record
// stores (lesson log, training history, review log, pose records, curricula — localStorage mock),
// written through the app's own services; search / model are fakes.
//   learner model (7 states, learning proficiency vs pose score, idempotent lesson completion,
//   gradual proficiency), personal questions answered from records only, data untouched by the AI,
//   training requests → lessons of the right art only (solo / partner / art / review / weakness),
//   the header "AI에게 묻기" path on the same coach, continuing a lesson.
// Run: node .devtools/test-personal-coach.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-coach-'));
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(path.join(dir, 'e.ts'), [
  `export * as LM from ${mod('src/lib/personalCoach/learnerModel.ts')};`,
  `export { loadLearnerModel } from ${mod('src/lib/personalCoach/learnerStore.ts')};`,
  `export * as PA from ${mod('src/lib/personalCoach/personalAnswers.ts')};`,
  `export * as TP from ${mod('src/lib/selfAi/trainingPlanner.ts')};`,
  `export { planTurn } from ${mod('src/lib/selfAi/router.ts')};`,
  `export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export { saveLessonLog } from ${mod('src/lib/coachLesson/lessonLog.ts')};`,
  `export { recordTrainingSession } from ${mod('src/lib/trainingHistory/service.ts')};`,
  `export { replaceReviewLog } from ${mod('src/lib/review/reviewLog.ts')};`,
  `export { poseRecordsRepository } from ${mod('src/lib/poseAnalysis/recordsRepository.ts')};`,
  `export { saveCustomCurriculum } from ${mod('src/lib/curriculum/curriculumService.ts')};`,
  `export { buildKnowledgeIndex } from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export { resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
  `export * as S from ${mod('src/lib/aiCoachDay/sessionStore.ts')};`,
  `export { appCoachDeps } from ${mod('src/lib/selfAi/deps.ts')};`,
  `export { askMartialdexWithWeb } from ${mod('src/lib/ai/martialdexAsk.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [path.join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(dir, 'r.mjs'), logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(path.join(dir, 'r.mjs')).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const T = (id) => M.resolveTechnique(id);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const lesson = (id, d, techs, extra = {}) => ({ id, kind: 'one_off', title: `수업 ${id}`, date: d, startedAt: `${d}T10:00:00Z`, finishedAt: `${d}T10:30:00Z`, curriculumId: null, day: null, historyEntryId: null, techniques: techs.map(([techniqueId, overall, practiced]) => ({ techniqueId, name: T(techniqueId)?.name ?? techniqueId, overall, practiced, concepts: [] })), qa: [], recap: null, updatedAt: `${d}T10:30:00Z`, ...extra });
const L = (id) => M.loadLearnerModel().find((l) => l.technique.id === T(id).id);

// ---- empty learner
const empty = M.PA.personalAnswer('learned', 'wrestling', '레슬링', M.loadLearnerModel(), null);
check('[P1] 기록 없음 → "기록이 없습니다"(학습 이력을 지어내지 않음)', /학습 기록이 없어/.test(empty.text) && /지어내지 않습니다/.test(empty.text), empty.text);

// ---- records: High Single learned over 3 days, Sprawl weak, Double Leg practised, pose on wrestling stance
M.saveLessonLog(lesson('l1', day(20), [['wrestling__high-single', 'understood', true], ['wrestling__sprawl', 'understood', true]]));
const once = L('wrestling__high-single').proficiency;
M.saveLessonLog(lesson('l1', day(20), [['wrestling__high-single', 'understood', true], ['wrestling__sprawl', 'understood', true]]));
check('[P2] 같은 수업 완료가 두 번 저장돼도 숙련도는 한 번만 반영(멱등)', L('wrestling__high-single').proficiency === once, [once, L('wrestling__high-single').proficiency]);
check('[P3] 수업 1회로 숙련도가 크게 오르지 않음(≤ 30)', once > 0 && once <= 30, once);
M.saveLessonLog(lesson('l2', day(10), [['wrestling__high-single', 'understood', true]]));
M.saveLessonLog(lesson('l3', day(2), [['wrestling__high-single', 'understood', true], ['wrestling__sprawl', 'weak', false]]));
const hs = L('wrestling__high-single');
check('[P4] 3일에 걸친 학습 → 점진적으로 상승(30 < 숙련도 < 80) + 학습 완료', hs.proficiency > 30 && hs.proficiency < 80 && hs.states.includes('learned'), hs);
check('[P5] 최근 2주 상승폭 → "숙련도 향상 중"', hs.states.includes('improving') && hs.proficiencyChange14d >= 10, [hs.states, hs.proficiencyChange14d]);
check('[P6] 최근 수업에서 이해 부족 → "숙련도 부족"', L('wrestling__sprawl').state === 'weak', L('wrestling__sprawl'));
M.recordTrainingSession({ date: day(5), curriculumId: null, dayNumber: null, techniqueIds: ['wrestling__basic-double-leg'], completed: true, estimatedMinutes: 20, source: 'free_training' });
check('[P7] 연습 기록만 있는 기술 → 학습 중', L('wrestling__basic-double-leg').state === 'learning', L('wrestling__basic-double-leg').state);
const profBefore = L('wrestling__wrestling-stance').proficiency;
M.poseRecordsRepository.add({ recordId: 'p1', techniqueId: 'wrestling__wrestling-stance', martialArtId: 'wrestling', score: 72, status: 'average', metricScores: {}, analyzedAt: new Date().toISOString(), method: 'landmark' });
const ws = L('wrestling__wrestling-stance');
check('[P8] 자세 측정은 자세 점수에만 반영, 학습 숙련도는 그대로(분리)', ws.pose?.latest === 72 && ws.proficiency === profBefore, ws);
M.saveCustomCurriculum({ id: 'cur-1', martialArt: 'wrestling', title: '내 레슬링', description: '', level: 'beginner', source: 'custom', authorName: 'me', createdAt: day(1), updatedAt: day(1), days: [{ day: 1, title: 'd1', description: '', learningGoals: [], techniqueIds: ['wrestling__fireman-s-carry'], reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 30 }] });
check('[P9] 내 커리큘럼의 아직 안 한 Day 기술 → 학습 예정', L('wrestling__fireman-s-carry')?.state === 'planned', L('wrestling__fireman-s-carry')?.state);

// ---- personal questions (routing + code answers)
const Q = {
  learned: '내가 지금까지 배운 레슬링 기술은?',
  unlearned: '아직 배우지 않은 레슬링 기술은?',
  weakest: '내가 가장 부족한 레슬링 기술은?',
  improved: '최근 내가 숙련도가 향상된 기술은?',
  review: '내가 복습이 필요한 기술은?',
  combos: '내가 배운 기술로 만들 수 있는 레슬링 콤보는?',
  next: '내가 아직 배우지 않은 기술 중 다음으로 무엇을 배우는 게 좋아?',
  analysis: '내 레슬링 실력에서 부족한 부분을 분석해 줘.',
};
const routed = Object.fromEntries(Object.entries(Q).map(([k, q]) => [k, M.planTurn(q).personal ?? M.planTurn(q).intent]));
check('[P10] 개인 질문 8종 → 내 학습 상태 의도(종류별)', Object.entries(routed).every(([k, v]) => v === k || (k === 'next' && v === 'unlearned')), routed);
const snapshot = JSON.stringify([...mem.entries()].sort());
const index = M.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [], myCombos: [{ id: 'mc1', name: '내 싱글→스프롤 연습', martialArt: 'wrestling', techniqueIds: ['wrestling__high-single', 'wrestling__sprawl'], description: '', createdAt: day(3), updatedAt: day(3) }] });
const deps = { ...M.appCoachDeps(), research: async () => ({ ok: true, results: [], diagnostics: {} }), chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'off' }), knowledgeIndex: async () => index };
const ans = {};
for (const [k, q] of Object.entries(Q)) ans[k] = (await M.runCoachTurn({ text: q, history: [], martialArt: null, requestId: k }, deps)).message;
check('[P11] 배운 기술: 기록된 것만(High Single 학습 완료), 기록 없는 기술 없음', /학습 완료 \d+개/.test(ans.learned.text) && /High Single/.test(ans.learned.text) && !/Fireman/.test(ans.learned.text.split('■ 학습 중')[0]) && ans.learned.model === 'martialdex-data', ans.learned.text);
check('[P12] 안 배운 기술: 개수·예정·먼저 배울 기술(배운 기술 제외)', /아직 배우지 않은 기술 \d+개/.test(ans.unlearned.text) && /Fireman/.test(ans.unlearned.text) && !/먼저 배우기 좋은 기술:[^\n]*High Single\(/.test(ans.unlearned.text), ans.unlearned.text);
check('[P13] 부족한 기술: Sprawl(숙련도 부족)과 자세 점수는 따로 표시', /Sprawl/.test(ans.weakest.text) && /자세 점수가 낮은 기술/.test(ans.weakest.text), ans.weakest.text);
check('[P14] 향상된 기술: High Single(+변화)', /High Single[^\n]*\+\d+/.test(ans.improved.text), ans.improved.text);
check('[P15] 콤보: 내 콤보(모두 배운 기술)·DB 콤보, 미학습 기술은 따로 표시', /내 싱글→스프롤 연습[^\n]*내 콤보[^\n]*모두 배운 기술/.test(ans.combos.text), ans.combos.text);
check('[P16] 다음 학습 추천 + 수업 시작 제안(수업 가능 기록)', ans.next.lessonProposal?.techniqueIds.length > 0 && ans.next.lessonProposal.techniqueIds.every((id) => (T(id).martialArts ?? [T(id).martialArt]).includes('wrestling')), ans.next);
check('[P17] 실력 분석(시나리오 A): 현황·부족(근거)·자세 측정·다음 수업 추천', /■ 현황/.test(ans.analysis.text) && /■ 부족한 부분/.test(ans.analysis.text) && /■ 자세 측정/.test(ans.analysis.text) && /■ 다음 수업 추천/.test(ans.analysis.text) && ans.analysis.lessonProposal, ans.analysis.text);
check('[P18] AI 답변은 사용자 기록을 바꾸지 않음(조회만)', JSON.stringify([...mem.entries()].sort()) === snapshot);

// ---- training → lessons of the right art (spec 10-3)
const art = (id) => T(id).martialArts ?? [T(id).martialArt];
async function plan(q) {
  const o = await M.runCoachTurn({ text: q, history: [], martialArt: null, requestId: 'tp' }, deps);
  return { o, ids: o.message.lessonProposal?.techniqueIds ?? [] };
}
const w = await plan('레슬링 솔로 드릴 훈련을 하고 싶어.');
check('[T1] 레슬링 솔로 드릴 → 수업 계획 + 시작 제안, 모두 레슬링 기록', w.o.plan.intent === 'training_plan' && w.o.plan.trainingType === 'solo' && w.ids.length >= 3 && w.ids.every((id) => art(id).includes('wrestling')), [w.o.plan.intent, w.ids]);
check('[T2] 솔로 드릴에 파트너 기술(손싸움·그립·테이크다운 완성 등) 없음', w.ids.every((id) => M.TP.soloCapable(T(id), 'wrestling')) && !w.ids.some((id) => /hand-fighting|collar|single-to|double-leg-finish/.test(id)), w.ids);
check('[T3] 개인화: 배운 기술 복습·부족 기술 보강·다음 준비 구분', /\[복습\]|\[보강\]|\[준비\]/.test(w.o.message.text) && /솔로 드릴 화면/.test(w.o.message.text) && w.o.message.action?.to === '/coach/mitt?tab=command&art=wrestling', w.o.message.text);
const wp = await plan('레슬링 파트너 드릴 훈련하고 싶어');
check('[T4] 레슬링 파트너 드릴 → 레슬링, 솔로 가능 동작 아님, 파트너 필요 안내', wp.o.plan.trainingType === 'partner' && wp.ids.length > 0 && wp.ids.every((id) => art(id).includes('wrestling') && !M.TP.soloCapable(T(id), 'wrestling')) && /파트너 1명 필요/.test(wp.o.message.text), [wp.ids, wp.o.message.text.slice(0, 200)]);
const bj = await plan('혼자 할 수 있는 주짓수 훈련을 하고 싶어');
check('[T5] 주짓수 솔로 → 주짓수 기록만', bj.o.plan.trainingType === 'solo' && bj.ids.length > 0 && bj.ids.every((id) => art(id).includes('bjj')), bj.ids);
const bx = await plan('복싱 솔로 드릴 수업 만들어 줘.');
check('[T6] 복싱 솔로 드릴 → 복싱 기록, 클린치·카운터 없음', bx.ids.length > 0 && bx.ids.every((id) => art(id).includes('boxing') && !/clinch|counter/i.test(id)), bx.ids);
const ju = await plan('오늘 주짓수 연습하자.');
check('[T7] "오늘 주짓수 연습하자" → 종목 훈련 수업(주짓수)', ju.o.plan.trainingType === 'art' && ju.ids.every((id) => art(id).includes('bjj')), [ju.o.plan.intent, ju.ids]);
const sl = await plan('싱글렉을 배우고 싶어.');
check('[T8] 특정 기술 학습("싱글렉을 배우고 싶어") → 기존 수업 계획 경로 유지', sl.o.plan.intent === 'lesson', sl.o.plan.intent);
const rv = await plan('레슬링 복습 수업 해 줘');
check('[T9] 복습 → 학습 완료 기술(High Single)', rv.o.plan.trainingType === 'review' && rv.ids.some((id) => /high-single/.test(id)), [rv.o.plan, rv.ids]);
const wk = await plan('내가 부족한 기술 위주로 수업해 줘.');
check('[T10] 약점 기반 → 숙련도 부족 기술(Sprawl)', wk.o.plan.trainingType === 'weakness' && wk.ids.some((id) => /sprawl/.test(id)), [wk.o.plan.intent, wk.o.plan.trainingType, wk.ids]);
const mixed = [w, wp, bj, bx, ju].flatMap((x) => x.ids.map((id) => [x.o.plan.art, id])).filter(([a, id]) => !art(id).includes(a));
check('[T11] 어떤 훈련에도 다른 무술 기술이 섞이지 않음', mixed.length === 0, mixed);
const none = await plan('레슬링 훈련하고 싶어');
check('[T12] "레슬링 훈련하고 싶어" → 레슬링 종목 훈련 수업', none.o.plan.trainingType === 'art' && none.ids.length > 0 && none.ids.every((id) => art(id).includes('wrestling')), none.ids);
const noArt = await plan('솔로 드릴 훈련하고 싶어');
check('[T13] 무술 없이 솔로 드릴 → 무술을 물어봄(엉뚱한 기술 목록 없음)', !noArt.ids.length && /어느 무술/.test(noArt.o.message.text), noArt.o.message.text);
// the header "AI에게 묻기" path is now the same coach
const ask = await M.askMartialdexWithWeb({ technique: null, question: '레슬링 솔로 드릴 훈련을 하고 싶어.' });
check('[T14] 헤더 "AI에게 묻기" 경로도 같은 코치: 레슬링 솔로 드릴 계획, 다른 무술 기술 없음', /레슬링 솔로 드릴 수업 계획/.test(ask.text) && !/Guillotine|Armbar|Gyaku|Round Kick/.test(ask.text) && /AI 코치와 대화하기/.test(ask.text), ask.text.slice(0, 400));
// continue a lesson
M.S.startCoachDayRun('cur-1', 1, 'text', ['wrestling__fireman-s-carry'], null, [], 'martialdex');
const cont = await plan('하던 수업 이어서 하자');
check('[T15] 수업 이어하기 → 진행 중인 수업으로 가는 버튼', cont.o.plan.intent === 'continue_lesson' && /\/learning\/wrestling\/cur-1\/coach\/1/.test(cont.o.message.action?.to ?? ''), cont.o.message);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
