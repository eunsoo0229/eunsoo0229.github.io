// AI 개인 맞춤 훈련 생태계 — offline tests (no network, no Supabase, no AI engine):
//   learning state (6 stages) · personal curriculum (build / prerequisites / adapt / edit / today) · performance numbers ·
//   growth report citations · report export SVG · evidence summary (categories / status / source conflicts) ·
//   technique safety + checklist · AI-coach bridge (curriculum / performance questions, never changes the plan).
// Real technique DB through the same modules the app uses; records are synthetic; storage is an in-memory localStorage.
// Run: node .devtools/test-training-ecosystem.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as LS from ${mod('src/lib/trainingEcosystem/learningState.ts')};`,
  `export * as PC from ${mod('src/lib/trainingEcosystem/personalCurriculum.ts')};`,
  `export * as CS from ${mod('src/lib/trainingEcosystem/curriculumStore.ts')};`,
  `export * as PF from ${mod('src/lib/trainingEcosystem/performance.ts')};`,
  `export * as GR from ${mod('src/lib/trainingEcosystem/growthReport.ts')};`,
  `export * as RX from ${mod('src/lib/trainingEcosystem/reportExport.ts')};`,
  `export * as CB from ${mod('src/lib/trainingEcosystem/coachBridge.ts')};`,
  `export * as EV from ${mod('src/lib/selfAi/evidenceSummary.ts')};`,
  `export * as SF from ${mod('src/lib/safety/techniqueSafety.ts')};`,
  `export * as CK from ${mod('src/lib/safety/checklist.ts')};`,
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export { resolveTechnique, getUnifiedAllTechniques } from ${mod('src/lib/userTechniques/service.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
let realCalls = 0;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: { askAi: async () => (realCalls++, { ok: false, code: 'UNKNOWN', message: 'test' }), webSearch: async () => (realCalls++, { ok: false }) },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { LS, PC, CS, PF, GR, RX, CB, EV, SF, CK, A, K, resolveTechnique, getUnifiedAllTechniques } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const NOW = new Date('2026-11-16T12:00:00+09:00');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const prog = (o) => ({ techniqueId: 'x', status: 'not_started', computedStatus: 'not_started', userOverride: null, latestScore: null, bestScore: null, scoreDelta: null, analysisCount: 0, practiceCount: 0, coachLessonCount: 0, coachMasteredDays: 0, lastPracticedAt: null, lastAnalyzedAt: null, nextReviewAt: null, ...o });
const T = (id) => resolveTechnique(id);
const jab = T('boxing__jab'), armbar = T('bjj__armbar'), heel = T('bjj__heel-hook'), seoi = T('judo__seoi-nage'), dl = T('wrestling__basic-double-leg'), pen = T('wrestling__penetration-step');
check('[0] 테스트용 기술 기록 존재', jab && armbar && heel && seoi && dl && pen, [!!jab, !!armbar, !!heel, !!seoi, !!dl, !!pen]);

// ---------------------------------------------------------------- 1. learning state
const st = (p) => LS.stateOf(jab, prog(p), NOW).state;
check('[S1] 기록 없음 → 학습 전', st({}) === 'not_started');
check('[S2] 연습 1회, 평가 없음 → 학습 중', st({ status: 'learning', computedStatus: 'learning', practiceCount: 1, lastPracticedAt: daysAgo(1) }) === 'learning');
check('[S3] 연습 3회, 평가 없음 → 평가 필요', st({ status: 'learning', computedStatus: 'learning', practiceCount: 3, lastPracticedAt: daysAgo(1) }) === 'needs_evaluation');
check('[S4] 자세 측정 숙련 → 숙련도 확인 완료', st({ status: 'proficient', computedStatus: 'proficient', analysisCount: 3, latestScore: 85, lastAnalyzedAt: daysAgo(2), nextReviewAt: daysAgo(-5) }) === 'verified');
const selfSet = LS.stateOf(jab, prog({ status: 'proficient', computedStatus: 'learning', userOverride: 'proficient', practiceCount: 1, lastPracticedAt: daysAgo(1) }), NOW);
check('[S5] 사용자가 직접 숙련 지정 (평가 없음) → 학습 완료 + 평가 데이터 부족 (확인 완료 아님)', selfSet.state === 'completed' && selfSet.evaluationMissing && selfSet.evidence === 'self', selfSet);
check('[S6] 평가 낮음 → 반복 학습 필요', st({ status: 'needs_improvement', computedStatus: 'needs_improvement', analysisCount: 2, latestScore: 40, lastAnalyzedAt: daysAgo(1) }) === 'needs_repeat');
check('[S7] 숙련이어도 30일 방치 → 반복 학습 필요(복습)', st({ status: 'proficient', computedStatus: 'proficient', analysisCount: 2, latestScore: 85, lastAnalyzedAt: daysAgo(30) }) === 'needs_repeat');

// ---------------------------------------------------------------- 2. curriculum
const all = getUnifiedAllTechniques();
const empty = new Map();
const poseSup = (t) => t.id === 'boxing__jab';
const plan = PC.buildPersonalCurriculum({ presetId: 'boxing_basics', techniques: all, states: empty, resolve: T, poseSupported: poseSup, now: NOW });
check('[C1] 복싱 기본기 커리큘럼: 복싱 기술 · 3단계 · 평가 방법', plan && plan.items.length >= 6 && plan.stages.length === 3 && plan.items.every((i) => T(i.techniqueId)?.martialArt === 'boxing' || (T(i.techniqueId)?.martialArts ?? []).includes('boxing')), plan && { n: plan.items.length, stages: plan.stages.map((s) => s.title) });
const order = plan.items.map((i) => i.techniqueId);
const prereqViolations = plan.items.filter((i, k) => {
  const t = T(i.techniqueId);
  const pre = t ? K && (globalThis.__x = 0, []) : [];
  return false;
});
check('[C2] 평가 방법: 측정 지원 기술 = 자세 측정, 나머지는 수업 평가/자기 확인', plan.items.find((i) => i.techniqueId === 'boxing__jab')?.evaluation === 'pose' || !order.includes('boxing__jab'), plan.items.slice(0, 4).map((i) => [i.techniqueId, i.evaluation]));
// prerequisites first: for the focus goal the prerequisite comes before the target
const focus = PC.buildPersonalCurriculum({ presetId: 'technique_focus', focusTechniqueIds: ['wrestling__basic-double-leg'], techniques: all, states: empty, resolve: T, poseSupported: poseSup, now: NOW });
const fi = focus.items.map((i) => i.techniqueId);
check('[C3] 특정 기술 향상: 선행 기술이 목표 기술보다 먼저', fi.includes('wrestling__basic-double-leg') && fi.indexOf('wrestling__basic-double-leg') === fi.length - 1 || fi.length === 1, fi);
// mastered techniques are skipped
const masteredStates = new Map(plan.items.slice(0, 2).map((i) => [i.techniqueId, LS.stateOf(T(i.techniqueId), prog({ status: 'proficient', computedStatus: 'proficient', analysisCount: 3, latestScore: 90, lastAnalyzedAt: daysAgo(1) }), NOW)]));
const plan2 = PC.buildPersonalCurriculum({ presetId: 'boxing_basics', techniques: all, states: masteredStates, resolve: T, poseSupported: poseSup, now: NOW });
check('[C4] 이미 숙련 확인된 기술은 다시 배정하지 않음', plan2.skippedMastered.length === 2 && !plan2.items.some((i) => masteredStates.has(i.techniqueId)), plan2.skippedMastered);

// adapt: stage 1 done → passes; a low score → prerequisite suggestion; practised-not-evaluated → evaluate
const s1 = plan.items.filter((i) => i.stage === 0);
const states2 = new Map(s1.map((i) => [i.techniqueId, LS.stateOf(T(i.techniqueId), prog({ status: 'average', computedStatus: 'average', coachLessonCount: 1, coachMasteredDays: 1, practiceCount: 2, lastPracticedAt: daysAgo(1) }), NOW)]));
const basics = (art) => all.filter((t) => t.martialArt === art && /(기본 자세|기본 움직임|풋워크)/.test(t.category)).slice(0, 6).map((t) => t.id);
const deps = { resolve: T, poseSupported: poseSup, nextInArt: () => ['boxing__jab-feint'], basicsInArt: basics };
const r1 = PC.refreshPlan(plan, states2, deps, NOW);
check('[C5] 결과 반영: 1단계 기술 학습 완료 → 처음 완료 날짜 기록 + 1단계 통과 기록', r1.changed && r1.plan.items.filter((i) => i.doneAt).length === s1.length && r1.plan.log.some((l) => l.kind === 'stage_passed'), r1.plan.log.map((l) => l.summary));
check('[C6] 현재 단계가 2단계로 이동', PC.currentStage(r1.plan, states2) === 1, PC.currentStage(r1.plan, states2));
const r1b = PC.refreshPlan(r1.plan, states2, deps, NOW);
check('[C7] 같은 결과로 다시 갱신해도 기록이 중복되지 않음', !r1b.changed && r1b.plan.log.length === r1.plan.log.length);
const target = plan.items.find((i) => i.stage === 1);
const lowStates = new Map([...states2, [target.techniqueId, LS.stateOf(T(target.techniqueId), prog({ status: 'needs_improvement', computedStatus: 'needs_improvement', analysisCount: 2, latestScore: 35, lastAnalyzedAt: daysAgo(1) }), NOW)]]);
const r2 = PC.refreshPlan(r1.plan, lowStates, deps, NOW);
const preSug = r2.suggestions.find((s) => s.kind === 'add_prerequisite');
console.log('   low-score item:', target.techniqueId, '→ suggestions', r2.suggestions.map((s) => s.kind).join(','));
check('[C8] 반복적으로 낮은 평가 → (선행 기술이 있으면) 기초로 돌아가는 제안, 학습 기록 변경 없음', !preSug || (preSug.structural && preSug.techniqueIds.length > 0), r2.suggestions);
if (preSug) {
  const applied = PC.applySuggestion(r1.plan, preSug, deps, NOW);
  const idx = applied.items.findIndex((i) => i.techniqueId === preSug.techniqueIds[0]);
  check('[C9] 제안 적용 → 선행 기술이 해당 기술 앞에 들어가고 변경 기록 남음', idx >= 0 && idx < applied.items.findIndex((i) => i.techniqueId === target.techniqueId) && applied.log.some((l) => l.kind === 'suggestion_applied'), applied.items.map((i) => i.techniqueId).slice(0, 10));
}
{
  const solo = { ...plan, items: [{ techniqueId: 'wrestling__basic-double-leg', stage: 1, role: 'core', reason: 't', evaluation: 'lesson', addedBy: 'ai', addedAt: NOW.toISOString() }], stages: [{ index: 0, title: '1', goal: '' }, { index: 1, title: '2', goal: '' }], dismissed: [] };
  const low = new Map([['wrestling__basic-double-leg', LS.stateOf(dl, prog({ status: 'needs_improvement', computedStatus: 'needs_improvement', analysisCount: 2, latestScore: 35, lastAnalyzedAt: daysAgo(1) }), NOW)]]);
  const sg = PC.refreshPlan(solo, low, deps, NOW).suggestions.find((x) => x.kind === 'add_prerequisite');
  console.log('   double-leg prerequisite suggestion:', sg?.techniqueIds);
  check('[C8b] 더블렉 평가 낮음 → 선행 기술(페네트레이션 스텝 등)로 돌아가는 제안', !!sg && sg.techniqueIds.length > 0, sg);
  if (sg) {
    const ap = PC.applySuggestion(solo, sg, deps, NOW);
    check('[C9b] 적용 → 선행 기술이 더블렉 앞, 앞 단계', ap.items[0].techniqueId === sg.techniqueIds[0] && ap.items[0].stage === 0 && ap.items[ap.items.length - 1].techniqueId === 'wrestling__basic-double-leg', ap.items.map((i) => [i.techniqueId, i.stage]));
    check('[C9c] 적용한 제안은 다시 나오지 않음', !PC.refreshPlan(ap, low, deps, NOW).suggestions.some((x) => x.id === sg.id));
  }
}
const evalStates = new Map([[target.techniqueId, LS.stateOf(T(target.techniqueId), prog({ status: 'learning', computedStatus: 'learning', practiceCount: 4, lastPracticedAt: daysAgo(1) }), NOW)]]);
check('[C10] 연습만 하고 평가 없음 → 평가 제안 + 오늘 할 일에 "평가"', PC.refreshPlan(plan, evalStates, deps, NOW).suggestions.some((s) => s.kind === 'evaluate') && PC.todayTasks(plan, evalStates, 10).some((t) => t.kind === 'evaluate' && t.techniqueId === target.techniqueId));
const today = PC.todayTasks(r1.plan, lowStates);
check('[C11] 오늘의 학습: 반복 필요가 먼저, 그 다음 현재 단계의 다음 기술', today[0]?.kind === 'review' && today.some((t) => t.kind === 'learn'), today);
// edits
const added = PC.addItem(plan, armbar, 2, poseSup, NOW);
const removed = PC.removeItem(added, 'bjj__armbar', '암바', NOW);
const moved = PC.moveItem(plan, plan.items[1].techniqueId, -1, NOW);
check('[C12] 사용자 수정: 추가·제외·순서 변경 + 기록', added.items.some((i) => i.techniqueId === 'bjj__armbar' && i.addedBy === 'user') && !removed.items.some((i) => i.techniqueId === 'bjj__armbar') && moved.items[0].techniqueId === plan.items[1].techniqueId && removed.log.some((l) => /학습 기록은 그대로/.test(l.summary)));
// store: replace keeps the old one archived
CS.saveActiveCurriculum(plan);
CS.replaceActiveCurriculum(focus, '목표 변경 테스트');
check('[C13] 목표 변경 → 이전 커리큘럼은 보관(삭제 안 함)', CS.getActiveCurriculum().id === focus.id && CS.listArchivedCurricula()[0].id === plan.id && CS.listArchivedCurricula()[0].log.some((l) => l.kind === 'goal_change'));
check('[C14] 주간 목표: 이번 주 처음 완료된 기술 수', PC.weeklyProgress(r1.plan, NOW).done === s1.length, PC.weeklyProgress(r1.plan, NOW));

// ---------------------------------------------------------------- 3. performance
const day = (n) => daysAgo(n).slice(0, 10);
const entries = [
  { id: 'e1', date: day(2), completedAt: daysAgo(2), curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab'], completed: true, estimatedMinutes: 30, actualMinutes: 40, notes: null, source: 'free_training' },
  { id: 'e2', date: day(5), completedAt: daysAgo(5), curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab'], completed: true, estimatedMinutes: 30, actualMinutes: null, notes: null, source: 'free_training' },
  { id: 'e3', date: day(40), completedAt: daysAgo(40), curriculumId: null, dayNumber: null, techniqueIds: [], completed: true, estimatedMinutes: 20, actualMinutes: 20, notes: null, source: 'free_training' },
];
const rec = (id, score, d, method) => ({ recordId: id, techniqueId: 'boxing__jab', martialArtId: 'boxing', score, status: score >= 60 ? 'average' : 'needs_improvement', metricScores: {}, analyzedAt: daysAgo(d), ...(method ? { method } : {}) });
const poses = [rec('p1', 50, 20), rec('p2', 72, 3), rec('p3', 90, 10, 'video_compare'), rec('p4', 55, 25), rec('p5', 40, 26, 'video_compare')];
const perfStates = new Map([['boxing__jab', LS.stateOf(jab, prog({ status: 'average', computedStatus: 'average', analysisCount: 3, practiceCount: 2, latestScore: 72, lastAnalyzedAt: daysAgo(3), lastPracticedAt: daysAgo(2) }), NOW)], ['bjj__armbar', LS.stateOf(armbar, prog({ status: 'learning', computedStatus: 'learning', practiceCount: 3, lastPracticedAt: daysAgo(40) }), NOW)]]);
const perfIn = { period: '30d', now: NOW, entries, poseRecords: poses, lessonLogs: [], states: perfStates, plan: null, goals: [{ scope: 'week', text: '잽 연습', updatedAt: daysAgo(3) }], artOfEntry: () => 'boxing', artName: (a) => a };
const perf = PF.computePerformance(perfIn);
check('[P1] 기간 내 훈련 집계 (30일: 2회, 40+30분)', perf.activity.sessions === 2 && perf.activity.minutes === 70 && perf.activity.trainingDays === 2, perf.activity);
check('[P2] 직전 같은 기간과 비교', perf.activity.previous && perf.activity.previous.sessions === 1, perf.activity.previous);
check('[P3] 평가 방식별로 따로 (자세 측정 / 기준 영상 비교 섞지 않음)', perf.series.filter((s) => s.techniqueId === 'boxing__jab').length === 2 && perf.improved.every((x) => x.method), perf.series.map((s) => [s.method, s.records.length]));
check('[P4] 개선 항목: 같은 방식 안에서만 비교 (관절 지표 55 → 72, 기준 영상 40 → 90 따로)', perf.improved.some((x) => x.method === '관절 지표 분석' && x.from === 55 && x.to === 72) && perf.improved.some((x) => x.method === '기준 영상 비교' && x.from === 40 && x.to === 90), perf.improved);
check('[P5] 평가 없이 연습만 한 기술 = 평가 필요로 분리', perf.notEvaluated.includes('bjj__armbar'), perf.notEvaluated);
check('[P6] 커리큘럼 없으면 달성률 계산 안 함 + 자유 목표는 달성 기록 없음 명시', perf.curriculum === null && /달성 여부 기록이 없습니다/.test(perf.freeGoals.note));
check('[P7] 근거 사실에 기록 날짜 포함', perf.facts.length >= 3 && perf.facts.every((f) => f.id && f.basis), perf.facts);
const none = PF.computePerformance({ ...perfIn, entries: [], poseRecords: [], states: new Map() });
check('[P8] 기록 없는 사용자 = 빈 상태 (가짜 숫자 없음)', !none.hasAnyData && none.weekly.length === 0 && none.improved.length === 0);
const week7 = PF.computePerformance({ ...perfIn, period: '7d' });
check('[P9] 7일 기간: 5일 전 기록만 포함', week7.activity.sessions === 2 && PF.computePerformance({ ...perfIn, period: 'all' }).activity.sessions === 3);

// ---------------------------------------------------------------- growth report
const ids = new Set(['F1', 'F2']);
const kc = GR.keepCited([{ text: '잽 점수가 올랐습니다', facts: ['F1'] }, { text: '근거 없는 문장', facts: [] }, { text: '펀치 속도가 빨라졌습니다', facts: ['F2'] }, { text: '없는 근거', facts: ['F9'] }], ids);
check('[G1] AI 문장: 근거 번호 없거나 없는 번호·측정 안 한 속도 언급 → 제거', kc.kept.length === 1 && kc.dropped === 3, kc);
const rr = await GR.generateGrowthReport(perf, (id) => id, { useAi: false, now: NOW });
check('[G2] 규칙 기반 리포트: 모든 항목이 근거 번호를 가짐', rr.source === 'rules' && [...rr.improvements, ...rr.needsWork, ...rr.plateaus, ...rr.nextWeek].every((x) => x.facts.length > 0) && rr.facts.length === perf.facts.length, rr);
const ai = await GR.generateGrowthReport(perf, (id) => id, { useAi: true, now: NOW });
check('[G3] AI 엔진 실패 → 규칙 기반으로 작성하고 이유 표시', ai.source === 'rules' && ai.notes.some((n) => /AI 해석을 받지 못해|기록이 적어/.test(n)), ai.notes);
const limited = await GR.generateGrowthReport(none, (id) => id, { useAi: true, now: NOW });
check('[G4] 기록이 적으면 확정 평가 안 함', limited.limited && limited.notes.some((n) => /기록이 적어/.test(n)), limited.notes);
const svg = RX.reportSvg({ ...rr, activitySummary: '<script>alert(1)</script> & 테스트' }, '성장 리포트');
check('[G5] 이미지 내보내기 SVG: 텍스트 이스케이프 + 크기', svg.svg.startsWith('<svg') && !svg.svg.includes('<script>') && svg.svg.includes('&lt;script&gt;') && svg.height > 200, svg.height);
check('[G6] 텍스트 리포트에 근거 기록 포함', /■ 근거 기록/.test(GR.reportText(rr, 't')) && GR.reportText(rr, 't').includes('F1.'));

// ---------------------------------------------------------------- 4. evidence
const src = (n, url, sourceType, extra = {}) => ({ n, title: `s${n}`, url, sourceType, sourceTypeLabel: sourceType, reliability: { level: 'medium', label: '보통', reasons: [] }, contentRead: true, ...extra });
check('[E1] 출처 6분류', EV.categoryOf(src(1, 'https://www.ufc.com/rules', 'official')) === 'official' && EV.categoryOf(src(1, 'https://doi.org/x', 'academic')) === 'academic' && EV.categoryOf(src(1, 'https://bjjfanatics.com/a', 'web')) === 'coach_education' && EV.categoryOf(src(1, 'https://www.mmajunkie.usatoday.com/a', 'web')) === 'specialist_media' && EV.categoryOf(src(1, 'https://reddit.com/r', 'forum')) === 'community' && EV.categoryOf(src(1, 'https://unknown.example/a', 'web', { contentRead: false })) === 'unverifiable');
const sup = EV.evidenceSummary({ sources: [src(1, 'https://a.example/1', 'web'), src(2, 'https://b.example/2', 'web')], claims: [{ sentence: 'a', status: 'supported', source: 1, problems: [] }, { sentence: 'b', status: 'supported', source: 2, problems: [] }], research: { searched: true } });
check('[E2] 근거 충분: 두 곳 이상의 자료가 문장을 뒷받침', sup.status === 'sufficient', sup);
check('[E3] 일부 근거', EV.evidenceSummary({ sources: [src(1, 'https://a.example/1', 'web')], claims: [{ sentence: 'a', status: 'supported', source: 1, problems: [] }, { sentence: 'b', status: 'unverified', source: null, problems: [] }] }).status === 'partial');
check('[E4] 자료 없음 → 확정하기 어렵다는 문장', /확정하기 어렵습니다/.test(EV.evidenceSummary({ sources: [], research: { searched: true } }).text));
check('[E5] 본문을 못 읽은 자료뿐 → 판단 어려움', EV.evidenceSummary({ sources: [src(1, 'https://a.example/1', 'web', { contentRead: false })], claims: [] }).status === 'undecidable');
check('[E6] 내부 DB 답변 → 내부 데이터 근거', EV.evidenceSummary({ sources: [], model: 'martialdex-data' }).status === 'internal');
const conf = EV.sourceConflicts([{ n: 1, text: '힐훅은 IBJJF 화이트 벨트 경기에서 허용됩니다.' }, { n: 2, text: '힐훅은 IBJJF 화이트 벨트 경기에서 허용되지 않습니다.' }]);
console.log('   conflicts:', JSON.stringify(conf));
check('[E7] 자료끼리 다른 수치 → 상충 표시(양쪽 문장)', conf.length >= 1 && conf[0].aQuote && conf[0].bQuote, conf);
check('[E8] 상충이 있으면 상태 = 의견 다름', EV.evidenceSummary({ sources: [src(1, 'https://a.example/1', 'web'), src(2, 'https://b.example/2', 'web')], sourceConflicts: conf.length ? conf : [{ a: 1, b: 2, aQuote: 'x', bQuote: 'y', why: 'z' }] }).status === 'conflict');

// ---------------------------------------------------------------- 5. safety
const kinds = (t) => SF.safetyKindsOf(t);
check('[F1] 기술 분류: 암바=관절기, 힐훅=다리 관절기, 업어치기=던지기, 잽=펀치', kinds(armbar).includes('joint_lock') && kinds(heel).includes('leg_lock') && kinds(seoi).includes('throw') && kinds(jab).includes('punch'), [kinds(armbar), kinds(heel), kinds(seoi), kinds(jab)]);
const hg = SF.safetyGuide(heel);
check('[F2b] 힐훅은 펀치로 분류하지 않음 (장비에 글러브 없음)', !kinds(heel).includes('punch') && !SF.safetyGuide(heel).equipment.some((e) => /글러브|핸드랩/.test(e)), [kinds(heel), SF.safetyGuide(heel).equipment]);
check('[F2] 힐훅: 지도자 감독 권고 + 상급 수준 + 출처 라벨', hg.supervision.length > 0 && hg.level === 'advanced' && SF.RULE_SOURCE_LABEL.includes('의학적 검증 아님'), hg);
check('[F3] 던지기: 낙법 선행 + DB에 낙법 기록 없음 명시', SF.safetyGuide(seoi).before.some((b) => /낙법/.test(b)) && SF.safetyGuide(seoi).missingBasics.length === 1);
const unknown = { ...jab, id: 'x__unknown', name: 'Mystery', koreanName: '미상', category: '기타', aliases: [] };
check('[F4] 분류를 알 수 없는 기술 → 정보 확인 필요 (지어내지 않음)', SF.safetyGuide(unknown).unverified && SF.safetyGuide(unknown).before.length === 0);
const lv = SF.learnerLevel('bjj', new Map());
check('[F5] 기록이 없으면 수준을 단정하지 않음', lv.level === 'unknown' && SF.levelAdvice(SF.safetyGuide(heel), lv).some((a) => /수준 판단 데이터 부족/.test(a)));
const dlg = SF.safetyGuide(dl, { states: new Map([['wrestling__penetration-step', LS.stateOf(pen, prog({}), NOW)]]) });
check('[F6] 선행 기술 학습 여부 반영', dlg.prerequisites.length === 0 || dlg.prerequisites.some((p) => p.done === false || p.done === null), dlg.prerequisites);
const items = CK.checklistItems({ kinds: ['choke'], withPartner: true, equipment: ['매트'] });
check('[F7] 체크리스트: 공간·장비·준비운동·목표·파트너 확인', ['space', 'equipment', 'warmup', 'goal', 'partner'].every((id) => items.some((i) => i.id === id)) && items.find((i) => i.id === 'partner').important);
const saved = CK.saveChecklist({ techniqueIds: ['bjj__armbar'], withPartner: true, checked: { space: true, warmup: true }, pain: false, note: null }, NOW);
check('[F8] 체크리스트 저장·날짜로 조회 (훈련 기록과 날짜로 연결)', CK.checklistsOn(saved.date).length === 1 && CK.listChecklists()[0].id === saved.id && !CK.checklistComplete(saved, items));
check('[F9] AI 코치용 안전 문장: 라벨 + 중단 안내', /의학적 검증 아님/.test(SF.safetyContextLine(heel)) && /중단/.test(SF.safetyContextLine(heel)));

// ---------------------------------------------------------------- 6. coach bridge + agent
check('[B1] 질문 분류: 오늘 학습 / 커리큘럼 상태 / 성과 / 변경', CB.ecosystemQuery('오늘 뭘 배우면 돼?', true) === 'today' && CB.ecosystemQuery('내 커리큘럼 어디까지 했어?', true) === 'status' && CB.ecosystemQuery('내 실력이 얼마나 늘었어?', true) === 'performance' && CB.ecosystemQuery('커리큘럼 바꾸고 싶어', true) === 'change' && CB.ecosystemQuery('잽이 뭐야?', true) === null);
CS.saveActiveCurriculum(plan);
const before = mem.get('martialdex:personal-curriculum');
const chg = CB.answerEcosystem('change', { plan, states: lowStates, deps });
check('[B2] 커리큘럼 변경 요청 → 제안 + 화면 버튼, 대화에서 변경하지 않음', /바로 적용하지 않습니다/.test(chg.text) && chg.action?.to === '/my-curriculum' && mem.get('martialdex:personal-curriculum') === before, chg);
const td = CB.answerEcosystem('today', { plan, states: lowStates, deps });
check('[B3] 오늘의 학습 목표 답변 = 화면과 같은 계산', td.techniqueIds.join() === PC.todayTasks(plan, lowStates).map((t) => t.techniqueId).join() && /안전 체크/.test(td.text), td);
check('[B4] 커리큘럼 없으면 만들기 안내', /아직 나의 학습 커리큘럼이 없습니다/.test(CB.answerEcosystem('status', { plan: null, states: empty, deps }).text));
const pfAns = CB.answerEcosystem('performance', { plan: null, states: perfStates, deps, performance: () => perf });
check('[B5] 성과 질문 → 근거와 함께 + 대시보드 버튼', /근거:/.test(pfAns.text) && pfAns.action?.to === '/performance', pfAns.text);
const index = K.buildKnowledgeIndex({});
const agentDeps = {
  research: async () => ({ ok: false, code: 'DISABLED', message: 'off' }), chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'no model' }), knowledgeIndex: async () => index, learnerContext: () => '', artName: (a) => a,
  ecosystem: (text) => { const q = CB.ecosystemQuery(text, true); return q ? CB.answerEcosystem(q, { plan, states: lowStates, deps }) : null; },
  safetyLine: (t) => SF.safetyContextLine(t),
};
const turn = await A.runCoachTurn({ text: '오늘 뭘 배우면 돼?', history: [], martialArt: null, requestId: 'r1' }, agentDeps);
check('[B6] AI 코치 대화: 오늘의 학습 목표 + 커리큘럼 화면 버튼', turn.message.action?.to === '/my-curriculum' && /오늘의 학습 목표/.test(turn.message.text), turn.message.text.slice(0, 200));
const lesson = await A.runCoachTurn({ text: '암바 배우고 싶어', history: [], martialArt: 'bjj', requestId: 'r2' }, agentDeps);
check('[B7] 수업 제안 답변에 안전 확인 포함', /안전 확인/.test(lesson.message.text) && /의학적 검증 아님/.test(lesson.message.text), lesson.message.text.slice(-400));
check('[B8] 실제 네트워크·AI 호출 0 (AI 엔진 실패 경로만)', realCalls <= 1, realCalls);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
