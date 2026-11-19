// AI 코치 수업 방향 (복습만 / 새 기술만) + 수업 마지막 숙련도 평가 — offline logic (real technique DB, no AI calls).
// Run: node .devtools/test-coach-focus-assessment.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k), key: () => null, length: 0 };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const S = await server.ssrLoadModule('/src/lib/aiCoachCurriculum/service.ts');
const A = await server.ssrLoadModule('/src/lib/coachLesson/lessonAssessment.ts');
const L = await server.ssrLoadModule('/src/lib/coachLesson/lessonLog.ts');
const E = await server.ssrLoadModule('/src/lib/skillProgress/coachEvidence.ts');
const ld = await server.ssrLoadModule('/src/lib/loadData.ts');
await server.close();

const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 300) : '')));
const T = (id) => ld.allTechniques.find((t) => t.id === id);
const boxing = ld.getTechniquesByMartialArt('boxing');
const jab = boxing.find((t) => t.name === 'Jab');
const cross = boxing.find((t) => t.name === 'Cross');
const hook = boxing.find((t) => /^(Lead )?Hook$/.test(t.name));
const profile = { martialArt: 'boxing', learned: [jab, cross].map((t) => ({ technique: t, status: 'learning', practiceCount: 2, lastPracticedAt: null })), previousClasses: ['2026-10-20 AI 코치 수업(집): Jab, Cross — 끝까지 완료'] };
const base = { martialArt: 'boxing', location: 'home', equipment: [], goal: '', sessionMinutes: 30, days: 3 };
const drills = S.drillPool('home', []);
const learnedIds = new Set([jab.id, cross.id]);

// ---- 1. 새 기술 기준
const newPool = S.newTechniquePool(profile, { exclude: learnedIds, limit: 13 });
check('[새 기술] 후보에 배운 기술(Jab·Cross) 없음', newPool.length > 3 && !newPool.some((t) => learnedIds.has(t.id)), newPool.map((t) => t.name));
const ctxNew = S.buildPlanContext({ ...base, focus: 'new' }, profile, newPool, drills);
check('[새 기술] AI에게 주는 자료에 배운 기술 목록·이전 수업 기록이 없음', !ctxNew.includes('[배운 기술]') && !ctxNew.includes('[이전 AI 코치 수업]') && !ctxNew.includes(jab.id) && !ctxNew.includes(cross.id));
check('[새 기술] 수업 방향 규칙 포함', ctxNew.includes('[수업 방향: 새 기술 기준]'));
const raw = [
  { techniqueId: drills[0].id, role: 'warmup', instruction: '가볍게', minutes: 4 },
  { techniqueId: jab.id, role: 'review', instruction: '잽 복습', minutes: 5 },
  { techniqueId: cross.id, role: 'connection', linkedTechniqueId: jab.id, instruction: '원투', minutes: 5 },
  { techniqueId: newPool[0].id, role: 'new', instruction: `${jab.name}처럼 손을 뻗습니다`, minutes: 6 },
  { techniqueId: newPool[1].id, role: 'new', instruction: '천천히', minutes: 6 },
  { techniqueId: jab.id, role: 'application', instruction: '응용', minutes: 5 },
  { techniqueId: newPool[0].id, role: 'application', instruction: '응용', minutes: 5 },
];
const vNew = S.validatePlanDay(raw, { ...base, focus: 'new' }, learnedIds, new Set(newPool.map((t) => t.id)), new Set(drills.map((t) => t.id)), [jab, cross]);
check('[새 기술] 검증: 배운 기술을 쓰는 단계(복습·연결·응용)는 모두 제외', !vNew.items.some((i) => learnedIds.has(i.techniqueId)) && vNew.dropped === 3, vNew.items.map((i) => `${i.role}:${i.techniqueId}`));
check('[새 기술] 하루 새 기술 2개 허용 (기본 방식은 1개)', vNew.items.filter((i) => i.role === 'new').length === 2);
check('[새 기술] 배운 기술 이름을 언급한 AI 문장은 기본 안내로 교체', !vNew.items.some((i) => i.instruction.includes(`${jab.name}처럼`)), vNew.items.map((i) => i.instruction));
check('[새 기술] 계획된 기술 이름 안의 글자("Jab Feint" ⊃ "Jab")는 언급으로 보지 않음', !S.mentionsLearned('새 기술 Jab Feint입니다', [jab], [{ name: 'Jab Feint' }]) && S.mentionsLearned('Jab Feint 뒤 Jab', [jab], [{ name: 'Jab Feint' }]));
check('[새 기술] 배운 기술로 된 조합 기록("1--2" 등)은 새 기술 후보에서 제외', !newPool.some((t) => /--|→/.test(t.name)), newPool.map((t) => t.name));
const fbNew = S.fallbackDay(0, { ...base, focus: 'new' }, profile, newPool, drills);
check('[새 기술] AI 없이 만든 기본 Day에도 배운 기술 없음, 새 기술 포함', fbNew.some((i) => i.role === 'new') && !fbNew.some((i) => learnedIds.has(i.techniqueId)), fbNew.map((i) => `${i.role}:${i.techniqueId}`));
check('[새 기술] 이름 언급 검사', S.mentionsLearned('오늘은 잽 대신 Jab 말고', [jab]) && !S.mentionsLearned('새 기술 훅', [jab]));

// ---- 2. 배운 기술만 복습
const ctxRev = S.buildPlanContext({ ...base, focus: 'review' }, profile, [], drills);
check('[복습만] AI 자료에 새 기술 후보 없음 + 복습 규칙', !ctxRev.includes('[새 기술 후보]') && ctxRev.includes('[수업 방향: 배운 기술만 복습]') && ctxRev.includes(jab.id));
const vRev = S.validatePlanDay(raw, { ...base, focus: 'review' }, learnedIds, new Set(newPool.map((t) => t.id)), new Set(drills.map((t) => t.id)));
check('[복습만] 검증: 새 기술 단계 제외, 배운 기술 복습·연결·응용은 유지', !vRev.items.some((i) => i.role === 'new') && vRev.items.some((i) => i.role === 'review') && vRev.items.some((i) => i.role === 'connection'), vRev.items.map((i) => `${i.role}:${i.techniqueId}`));
const fbRev = S.fallbackDay(1, { ...base, focus: 'review' }, profile, newPool, drills);
check('[복습만] 기본 Day에 새 기술 없음 (홀수 Day에도)', !fbRev.some((i) => i.role === 'new') && fbRev.some((i) => i.role === 'review'));
const vMix = S.validatePlanDay(raw, base, learnedIds, new Set(newPool.map((t) => t.id)), new Set(drills.map((t) => t.id)));
check('[기본] 방향을 안 고르면 기존 규칙 그대로 (새 기술 하루 1개)', vMix.items.filter((i) => i.role === 'new').length === 1 && vMix.items.some((i) => i.role === 'review'));

// ---- 3. 수업 마지막 숙련도 평가 (규칙 · 상한)
const tech = (o) => ({ techniqueId: hook.id, name: hook.name, overall: 'understood', practiced: true, concepts: [{ id: 'a', label: '팔꿈치 높이', explain: '', reference: '', status: 'understood', evidence: '팔꿈치를 어깨 높이로' }, { id: 'b', label: '앞발 회전', explain: '', reference: '', status: 'understood' }], ...o });
const r1 = A.ruleAssessment(tech({}), null);
check('[평가] 이해 + 실습 첫 수업 → 이해도 잘 이해함 · 숙련도 보통', r1.understanding === 'high' && r1.proficiency === 'average' && r1.understandingScore === 100, r1);
const r2 = A.ruleAssessment(tech({ practiced: false }), null);
check('[평가] 실습 안 함 → 학습 중까지만', r2.proficiency === 'learning');
const r3 = A.ruleAssessment(tech({ overall: 'weak', concepts: [{ id: 'a', label: 'x', explain: '', reference: '', status: 'weak' }] }), null);
check('[평가] 이해 부족 → 보완 필요', r3.understanding === 'low' && r3.proficiency === 'needs_improvement');
const r4 = A.ruleAssessment(tech({}), { lessons: 3, masteredDays: 2, latestOverall: 'understood', latestPracticed: true, lastLessonAt: '' });
check('[평가] 이전 2일 + 오늘 → 3일 이해+실습 → 숙련', r4.proficiency === 'proficient');
const r5 = A.ruleAssessment(tech({ overall: 'unknown', concepts: [] }), null);
check('[평가] 확인한 질문이 없으면 이해도 "확인 안 됨", 학습 중', r5.understanding === 'unknown' && r5.proficiency === 'learning' && r5.understandingScore === null);
check('[평가 상한] 숙련은 3일 미만이면 보통까지', A.masteryCap(tech({}), 'high', null).max === 'average' && A.masteryCap(tech({ practiced: false }), 'high', null).max === 'learning');

// ---- 4. 저장 → 숙련도 반영 (자체 코치 수업 = 외부 AI 없이 규칙)
const now = new Date().toISOString();
L.saveLessonLog({ id: 'lesson_t1', kind: 'one_off', title: '훅 수업', date: now.slice(0, 10), startedAt: now, finishedAt: now, curriculumId: null, day: null, historyEntryId: null, techniques: [tech({ practiced: false })], qa: [], recap: null, updatedAt: now, coachKind: 'martialdex' });
check('[반영 전] 평가 없을 때는 기존 규칙(이해했지만 실습 안 함 → 학습 중)', E.coachMastery(E.getCoachEvidence(hook.id)) === 'learning');
const asm = await A.ensureLessonAssessment('lesson_t1');
check('[자체 코치] 외부 AI 없이 규칙으로 평가하고 그렇다고 표시', asm.method === 'rules' && /외부 AI 없이/.test(asm.note ?? ''), asm);
check('[저장] 평가가 수업 기록에 저장됨', L.getLessonLog('lesson_t1').assessment?.items[0].proficiency === 'learning');
// a stronger rating saved on the lesson becomes the mastery
L.updateLessonLog('lesson_t1', { assessment: { ...asm, items: [{ ...asm.items[0], proficiency: 'needs_improvement' }] } });
check('[반영] 최신 수업 평가가 그 기술의 AI 코치 숙련도가 됨', E.coachMastery(E.getCoachEvidence(hook.id)) === 'needs_improvement');
L.saveLessonLog({ ...L.getLessonLog('lesson_t1'), assessment: undefined });
check('[재저장] 같은 수업을 다시 저장해도 평가 유지', !!L.getLessonLog('lesson_t1').assessment);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
