// 헬스 AI 트레이너 — offline unit tests (fake AI, real gym exercise library). No Electron.
// Run: node .devtools/test-gym-trainer.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const et = new EventTarget();
globalThis.addEventListener = (...a) => et.addEventListener(...a);
globalThis.removeEventListener = (...a) => et.removeEventListener(...a);
globalThis.dispatchEvent = (e) => et.dispatchEvent(e);
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const T = await server.ssrLoadModule('/src/lib/gymTrainer/trainer.ts');
const P = await server.ssrLoadModule('/src/lib/gymTrainer/planner.ts');
const L = await server.ssrLoadModule('/src/lib/gymTraining/library.ts');
const R = await server.ssrLoadModule('/src/lib/gymRoutine/service.ts');
await server.close();

const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const lib = L.GYM_TRAINING_FILE.techniques;
const bench = lib.find((t) => /벤치/.test(t.name) && t.gymBodyPart === 'chest') ?? lib.find((t) => t.gymBodyPart === 'chest');
const set = { setNumber: 2, totalSets: 4, weightKg: 60, reps: 8, rpe: 8 };
let lastPrompt = null;
const fakeAi = (data) => async (p) => ((lastPrompt = p), { ok: true, data, groundingSources: [], usedSearchGrounding: false, webSearchQueries: [] });

// ---- trainer: doubt "my form is correct"
let r = await T.askTrainer({ technique: bench, set, history: [], userText: '벤치할 때 어깨가 아파요. 자세는 정확하게 하고 있어요.', askJson: fakeAi({ mode: 'probe', message: '자세가 맞다고 하셨지만 어깨 통증은 보통 각도 문제에서 옵니다. 몇 가지만 확인할게요.', checks: [{ question: '바를 내릴 때 어깨와 팔(팔꿈치) 각도가 90도로 벌어져 있나요?', why: '90도로 벌어지면 어깨 앞쪽에 부담이 몰립니다.' }, { question: '날개뼈를 모은 상태를 끝까지 유지하나요?', why: '' }], cues: [], nextSet: null, safety: null }) });
check('[의심] "자세는 맞다"+통증 → 확인 질문(probe) 모드', r.mode === 'probe' && r.checks.length === 2 && /90도/.test(r.checks[0].question), r);
check('[의심] AI에게 운동·부위·방금 세트(60kg×8, RPE 8)·의심 규칙이 전달됨', /가슴/.test(lastPrompt.contextText) && /60kg × 8회/.test(lastPrompt.contextText) && /그대로 믿지 않는다/.test(lastPrompt.systemInstruction) && /90도/.test(lastPrompt.systemInstruction));
const ans = T.answerText(r.checks[0], 'yes');
check('[답변] 예/아니요 버튼 → 질문과 답이 함께 다음 턴으로', ans.includes('90도') && ans.endsWith('예'), ans);
r = await T.askTrainer({ technique: bench, set, history: [{ role: 'user', text: '어깨가 아파요' }, { role: 'trainer', text: '확인할게요', reply: { mode: 'probe', message: '', checks: [{ question: '팔꿈치 90도?', why: '' }], cues: [], nextSet: null, safety: null, source: 'ai' } }], userText: ans, askJson: fakeAi({ mode: 'correct', message: '그게 원인입니다.', checks: [], cues: ['팔꿈치를 몸통 쪽으로 45~70도로 모으기', '바를 명치 쪽으로 내리기'], nextSet: '무게를 10% 줄여 자세 확인', safety: null }) });
check('[교정] 원인 확인 뒤 교정 지시 + 다음 세트 조정', r.mode === 'correct' && r.cues.length === 2 && !!r.nextSet);
check('[대화] 이전 확인 질문이 대화 기록으로 AI에 전달(같은 질문 반복 방지)', /트레이너 확인 질문: 팔꿈치 90도\?/.test(lastPrompt.question));

// ---- danger signs → stop, without AI
let called = false;
r = await T.askTrainer({ technique: bench, set, history: [], userText: '어깨에서 뚝 소리가 나고 팔이 저려요', askJson: async () => ((called = true), { ok: false, code: 'X', message: '' }) });
check('[안전] 뚝 소리·저림 → AI 호출 없이 즉시 중단 + 진료 권고', r.mode === 'stop' && !called && /진료/.test(r.safety ?? ''), r.message);
check('[안전] 평범한 "자극이 안 와요"는 중단하지 않음', T.redFlag('가슴에 자극이 안 와요') === null && T.redFlag('어깨가 좀 아파요') === null);
check('[안전] 가슴 답답함·어지러움 → 중단', !!T.redFlag('갑자기 어지러워요') && !!T.redFlag('가슴이 답답해요'));

// ---- AI down → general checks
r = await T.askTrainer({ technique: bench, set, history: [], userText: '자극이 안 와요', askJson: async () => ({ ok: false, code: 'RATE_LIMIT', message: '' }) });
check('[오프라인] AI 연결 실패 → 그 부위 일반 점검 질문 (90도 각도 포함)', r.source === 'rules' && r.mode === 'probe' && r.checks.some((c) => /90도/.test(c.question)), r.checks.map((c) => c.question));
r = await T.askTrainer({ technique: bench, set, history: [], userText: '자극이 안 와요', askJson: fakeAi({ message: '   ', checks: [] }) });
check('[오프라인] 빈 답변도 일반 점검으로 대체', r.source === 'rules');

// ---- routine: only real library exercises
const pool = P.exercisePool(lib, 'gym');
const real = pool.slice(0, 4).map((t) => t.id);
const plan = P.validatePlan({ name: '근비대 3분할', summary: 's', days: [{ weekday: 1, focus: '가슴', exercises: [{ id: real[0], sets: 4, reps: 10, restSeconds: 90 }, { id: 'gym-가짜-운동', sets: 3, reps: 10 }, { id: real[0], sets: 3, reps: 8 }] }, { weekday: 1, focus: '중복 요일', exercises: [{ id: real[1] }] }, { weekday: 3, focus: '등', exercises: [{ id: real[2], sets: 99, reps: 500, restSeconds: 5 }] }, { weekday: 5, focus: '빈 날', exercises: [{ id: 'nope' }] }] }, pool, 3);
check('[루틴] 라이브러리에 없는 운동은 빼고 기록 (지어내지 않음)', plan.dropped.includes('gym-가짜-운동') && plan.days.every((d) => d.exercises.every((e) => pool.some((t) => t.id === e.techniqueId))), plan.dropped);
check('[루틴] 같은 요일·같은 운동 중복 제거, 운동 없는 날 제외', plan.days.map((d) => d.weekday).join() === '1,3' && plan.days[0].exercises.length === 1);
check('[루틴] 비정상 숫자 보정 (99세트→8, 500회→50, 휴식 5초→20)', plan.days[1].exercises[0].sets === 8 && plan.days[1].exercises[0].reps === 50 && plan.days[1].exercises[0].restSeconds === 20, plan.days[1].exercises[0]);
const bw = P.exercisePool(lib, 'bodyweight');
check('[장비] 맨몸만 → 바벨·머신 운동 제외', bw.length > 0 && bw.every((t) => (t.gymEquipment ?? []).every((e) => e === '맨몸' || e === '철봉')), bw.length);
const tpl = await P.generateGymPlan({ goal: 'strength', daysPerWeek: 3, level: 'beginner', equipment: 'gym', minutes: 60, cautions: '' }, lib, async () => ({ ok: false, code: 'X', message: '' }));
check('[루틴] AI 연결 실패 → 기본 템플릿 (주 3회, 근력=5회·150초)', tpl.source === 'template' && tpl.days.length === 3 && tpl.days[0].exercises.every((e) => e.restSeconds === 150 && (e.reps === 5 || e.seconds)) && tpl.days.every((d) => d.exercises.every((e) => !lib.find((t) => t.id === e.techniqueId)?.gymDifficulty?.includes('고급'))), tpl.days.map((d) => d.exercises.length));
let sys = '';
await P.generateGymPlan({ goal: 'fatloss', daysPerWeek: 4, level: 'intermediate', equipment: 'dumbbell', minutes: 45, cautions: '오른쪽 어깨 통증' }, lib, async (p) => ((sys = p.systemInstruction + p.question + p.contextText), { ok: false, code: 'X', message: '' }));
check('[루틴] 주의 부위·목적·장비 목록이 AI에 전달', /오른쪽 어깨 통증/.test(sys) && /체지방 감량/.test(sys) && /정확히 4일/.test(sys) && !/바벨 \|/.test(sys));

// save into 헬스 루틴 → 오늘의 훈련 uses the active one
const saved = await P.savePlanAsRoutine(plan, true);
const active = R.getActiveGymRoutine();
check('[저장] 헬스 루틴으로 저장 + 활성화 (오늘의 훈련이 요일별로 불러옴)', active?.id === saved.id && active.days.length === 2 && active.days.find((d) => d.weekday === 1)?.exercises[0].targetSets === 4);
check('[저장] 무게는 비워 두고(첫 운동 때 결정) 세트 수만큼 반복 목표', saved.days[0].exercises[0].targetWeightKg.every((w) => w === null) && saved.days[0].exercises[0].targetReps.length === 4);

// ---- diet targets: never invent calories
let t = P.dietTargets('hypertrophy', { calorieGoal: null, proteinGoalG: null, carbGoalG: null, fatGoalG: null, bodyWeightKg: 70 });
check('[식단] 칼로리 목표가 없으면 숫자를 만들지 않음 + 단백질은 체중×1.8g(근비대)', t.calorieGoal === null && t.proteinGoalG === 126 && t.basis.some((b) => /1\.6~2\.2g\/kg/.test(b)), t);
t = P.dietTargets('fatloss', { calorieGoal: 1900, proteinGoalG: 150, carbGoalG: null, fatGoalG: null, bodyWeightKg: 80 });
check('[식단] 사용자가 정한 영양 목표가 있으면 그 값을 그대로 사용', t.calorieGoal === 1900 && t.proteinGoalG === 150 && t.basis[0].includes('영양 목표'));
check('[식단] 요청 문장에 목적·체중·주당 횟수 포함', /체지방 감량/.test(P.dietRequest('fatloss', plan, { bodyWeightKg: 80 })) && /주 2회/.test(P.dietRequest('fatloss', plan, { bodyWeightKg: 80 })));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
