// 10차 — 전체 사용자 데이터 통합 · 개인화 코칭 · 계정 전환 보존 · 출처/의미 검증. Offline: real technique DB, real stores
// on in-memory localStorage, two FAKE learners (A: boxing, jab/cross proficient · B: wrestling, double leg learning).
// No account, no network; the model is a scripted fake that records exactly what it received.
// Run: node .devtools/test-coach-10th-integration.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-10th-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    ['A', 'src/lib/selfAi/coachAgent.ts'],
    ['E', 'src/lib/selfAi/evidenceCheck.ts'],
    ['TM', 'src/lib/selfAi/terminology.ts'],
    ['CD', 'src/lib/coachContext/coachData.ts'],
    ['CA', 'src/lib/coachContext/coachAnalysis.ts'],
    ['PF', 'src/lib/coachContext/personalFacts.ts'],
    ['UC', 'src/lib/coachContext/userContext.ts'],
    ['FP', 'src/lib/fighterProfile/store.ts'],
    ['GS', 'src/lib/goals/store.ts'],
    ['TH', 'src/lib/trainingHistory/service.ts'],
    ['OV', 'src/lib/skillProgress/overrideStore.ts'],
    ['CB', 'src/lib/combo/service.ts'],
    ['TC', 'src/lib/tactic/service.ts'],
    ['SS', 'src/lib/sparringSession/service.ts'],
    ['ML', 'src/lib/nutrition/mealService.ts'],
    ['NP', 'src/lib/nutrition/profileService.ts'],
    ['CS', 'src/lib/selfAi/conversationStore.ts'],
    ['LL', 'src/lib/coachLesson/lessonLog.ts'],
    ['DG', 'src/lib/auth/deviceAccountGuard.ts'],
    ['K', 'src/lib/martialdexKnowledge/index.ts'],
    ['FPm', 'src/lib/fighterProfile/store.ts'],
  ]
    .map(([n, p]) => `export * as ${n} from ${mod(p)};`)
    .join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, clear: () => mem.clear(), get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);
const { A, E, TM, CD, CA, PF, UC, FP, GS, TH, OV, CB, TC, SS, ML, NP, CS, LL, DG, K } = M;

let pass = 0;
let fail = 0;
const results = [];
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 700)}`}`);
}
const NOW = new Date();
const today = NOW.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);
const snapshot = () => JSON.stringify([...mem.entries()].sort());
const index = K.buildKnowledgeIndex({});

// ---------------------------------------------------------------- fake learners
function seedA() {
  FP.setItem('body.stance', { value: 'orthodox', source: 'self_report' });
  FP.setItem('box.preferredRange', { value: 'long', source: 'self_report' });
  const slots = GS.goalSlots(NOW);
  GS.saveGoal('week', slots.find((s) => s.slot === 'week').periodKey, '잽 다음 훅 연결 연습');
  GS.saveGoal('month', slots.find((s) => s.slot === 'month').periodKey, '스파링에서 가드 유지');
  for (let i = 0; i < 4; i++) TH.recordTrainingSession({ date: daysAgo(i + 1), curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab', 'boxing__cross'], completed: true, estimatedMinutes: 30, actualMinutes: 30, notes: i === 0 ? '잽 후 가드가 내려감' : null, source: 'free_training' });
  OV.setOverride('boxing__jab', 'proficient');
  OV.setOverride('boxing__cross', 'proficient');
  OV.setOverride('boxing__slip', 'needs_improvement');
  CB.createCombo({ name: '원투', description: '', techniqueIds: ['boxing__jab', 'boxing__cross'] });
  TC.createTactic({ name: '잽 카운터', situation: '상대가 먼 거리에서 잽을 던지면', techniqueIds: ['boxing__slip', 'boxing__cross'] });
  storage.setItem('martialdex:favorites', JSON.stringify(['boxing__lead-uppercut', 'boxing__jab']));
  const rules = { martialArt: 'boxing', sparringType: 'striking', plannedRounds: 3, roundDurationSeconds: 180, restDurationSeconds: 60, intensity: 'moderate', equipment: [], allowedTechniqueIds: [], prohibitedTechniqueIds: [], partnerName: null, notes: null };
  SS.recordPastSparringSession({ rules, date: daysAgo(6), actualRounds: 3, actualDurationSeconds: 540, usedTechniqueIds: ['boxing__jab', 'boxing__cross'], wentWell: '잽 거리 유지', toImprove: '가드가 내려감, 훅에 맞음' });
  SS.recordPastSparringSession({ rules, date: daysAgo(2), actualRounds: 3, actualDurationSeconds: 540, usedTechniqueIds: ['boxing__jab'], wentWell: null, toImprove: '훅 맞고 가드가 내려감' });
  ML.addMeal({ date: daysAgo(1), mealType: 'lunch', foods: [{ name: '닭가슴살 샐러드', amount: '1그릇', calories: 420, carbsG: 20, proteinG: 40, fatG: 15 }], source: 'manual' });
  const c = CS.createConversation('boxing', new Date(NOW.getTime() - 3 * 86400000));
  CS.appendMessage(c.id, { role: 'user', text: '슬립이 너무 어려워요 자꾸 맞아요' });
  CS.appendMessage(c.id, { role: 'user', text: '슬립 할 때 머리 위치 어떻게 해?' });
  CS.appendMessage(c.id, { role: 'user', text: '슬립 할 때 머리 위치는 어떻게 해요?' });
  CS.appendMessage(c.id, { role: 'user', text: '쉽게 설명해 줘' });
  LL.saveLessonLog({ id: 'qa-ll-1', kind: 'one_off', title: '복싱 슬립 기초', date: daysAgo(4), startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), curriculumId: null, day: null, historyEntryId: null, techniques: [{ techniqueId: 'boxing__slip', name: 'Slip', concepts: [{ id: 'c1', label: '머리를 바깥으로 이동', status: 'weak' }] }], qa: [], recap: null });
}
function seedB() {
  FP.setItem('body.stance', { value: 'southpaw', source: 'self_report' });
  const slots = GS.goalSlots(NOW);
  GS.saveGoal('week', slots.find((s) => s.slot === 'week').periodKey, '더블 레그 테이크다운 익히기');
  TH.recordTrainingSession({ date: daysAgo(1), curriculumId: null, dayNumber: null, techniqueIds: ['wrestling__basic-double-leg'], completed: true, estimatedMinutes: 40, actualMinutes: 40, notes: '레벨 체인지가 늦음', source: 'free_training' });
  OV.setOverride('wrestling__basic-double-leg', 'learning');
  OV.setOverride('wrestling__sprawl', 'average');
  const rules = { martialArt: 'wrestling', sparringType: 'grappling', plannedRounds: 2, roundDurationSeconds: 180, restDurationSeconds: 60, intensity: 'light', equipment: [], allowedTechniqueIds: [], prohibitedTechniqueIds: [], partnerName: null, notes: null };
  SS.recordPastSparringSession({ rules, date: daysAgo(3), actualRounds: 2, actualDurationSeconds: 360, usedTechniqueIds: ['wrestling__basic-double-leg'], wentWell: null, toImprove: '스프롤에 막힘, 레벨 체인지 늦음' });
  SS.recordPastSparringSession({ rules, date: daysAgo(1), actualRounds: 2, actualDurationSeconds: 360, usedTechniqueIds: ['wrestling__basic-double-leg'], wentWell: '태클 진입', toImprove: '스프롤에 또 막힘' });
}

const seen = [];
const deps = (over = {}) => ({
  research: async () => ({ ok: true, kind: 'web', results: [], diagnostics: { backend: 'searxng' } }),
  chat: async (req) => (seen.push(req.messages[0].content), { ok: true, text: '제 판단으로는 기록에 맞춰 연습하시면 좋겠습니다.', model: 'fake-3b', evalCount: 1, ms: 1 }),
  knowledgeIndex: async () => index,
  learnerContext: (art, topic) => UC.userCoachContext({ martialArt: art, topic, budget: { profile: 600, goals: 700, learning: 800 }, detailBudget: 1100 }).text,
  personalFact: (text) => {
    const q = PF.personalFactQuery(text);
    return q ? PF.answerPersonalFact(q, NOW) : null;
  },
  lessonFit: (ids) => PF.lessonFitText(ids, NOW),
  personalAnalysis: async (text, art) => {
    const kind = CA.analysisQuery(text);
    return kind ? CA.answerAnalysis(kind, { index: async () => index, art, now: NOW }) : null;
  },
  goalText: (q) => {
    for (const s of GS.goalSlots(NOW)) if (s.entry?.text.trim()) return { label: s.label, text: s.entry.text };
    return null;
  },
  terminology: (t) => TM.fixTerminology(t, []),
  personalComposite: (t) => CA.isPersonalComposite(t),
  ...over,
});
const turn = (text, extra = {}, over = {}) => A.runCoachTurn({ text, history: [], requestId: `t-${Math.random()}`, ...extra }, deps(over));

// ================================================================ A: boxing learner
storage.clear();
seedA();
const beforeA = snapshot();

// ---- A. data connection
const combos = CD.readCombos();
check('[D1] 콤보: 저장된 콤보·기술 존재·숙련도 읽힘', combos.length === 1 && combos[0].steps.every((s) => s.exists) && /숙련/.test(combos[0].steps[0].mastery), combos);
check('[D2] 콤보 메타: 계정에 안 올라간 기록은 local_only로 구분', combos[0].meta.syncStatus === 'local_only' && combos[0].meta.freshness === 'fresh', combos[0].meta);
check('[D3] 전술 읽힘 (상황·기술 순서)', /잽 카운터/.test(CD.analyzeTactics()) && /먼 거리/.test(CD.analyzeTactics()));
check('[D4] 즐겨찾기: 관심 표시 ≠ 숙련도', /관심 표시일 뿐 숙련도가 아닙니다/.test(CD.describeFavorites()) && /Lead Uppercut[^\n]*학습 기록 없음/.test(CD.describeFavorites()), CD.describeFavorites());
check('[D5] 스파링 기록 2회 읽힘 + 원문 그대로', (CD.analyzeSparring().match(/^- \d{4}-\d{2}-\d{2}/gm) ?? []).length === 2 && /개선할 점 "훅 맞고 가드가 내려감"/.test(CD.analyzeSparring()), CD.analyzeSparring());
check('[D6] 식사 기록: 기록한 날만, 추측 안 함 + 안전 문구', /닭가슴살 샐러드/.test(CD.describeMeals(NOW)) && /기록이 있는 날 1일/.test(CD.describeMeals(NOW)) && /극단적인 식단 제한/.test(CD.describeMeals(NOW)), CD.describeMeals(NOW));
const mem1 = CD.learningMemory();
check('[D7] 학습 메모리: 자주 물은 기술(슬립)·반복 질문·어려움·설명 방식', mem1.topics.some((t) => /slip/.test(t.techniqueId)) && mem1.repeated.some((r) => r.count >= 2) && mem1.difficulties.length >= 1 && mem1.preferences.some((p) => p.label === '쉽게 설명'), mem1);
check('[D8] 학습 메모리: 수업 약점 개념 연결', mem1.weakConcepts.some((w) => /머리를 바깥으로/.test(w.label)));
const uc = UC.userCoachContext({ martialArt: 'boxing', topic: '내 콤보로 새로운 조합 추천', detailBudget: 1100 });
check('[D9] 공통 컨텍스트: 콤보 질문이면 콤보 섹션이 먼저 들어감', uc.parts.combos && uc.text.indexOf('[내 콤보') > -1, uc.parts);
check('[D10] 공통 컨텍스트: 관련 없는 질문엔 식사·스파링 섹션 안 넣음', !UC.userCoachContext({ martialArt: 'boxing', topic: '잽 각도', detailBudget: 1100 }).parts.meals && !UC.userCoachContext({ martialArt: 'boxing', topic: '잽 각도', detailBudget: 1100 }).parts.sparring);
CB.createCombo({ name: '원투훅', description: '', techniqueIds: ['boxing__jab', 'boxing__cross', 'boxing__lead-hook'] });
check('[D11] 수정된 데이터가 다음 요청에 바로 반영 (새 콤보)', /원투훅/.test(UC.userCoachContext({ martialArt: 'boxing', topic: '내 콤보 분석', detailBudget: 1100 }).text));
const afterSeedA = snapshot();

// ---- B. personalization (A)
const Q = {};
const ask = async (key, text, extra) => (Q[key] = await turn(text, extra));
await ask('style', '내 파이팅 스타일을 분석해 줘');
check('[P1] 스타일: 저장 기록(숙련 기술) 근거 + 해석은 별도 라벨', /숙련 기록이 있는 기술: [^\n]*Jab/.test(Q.style.message.text) && /코치 해석 \(로컬 AI가 위 기록만 보고 쓴 의견/.test(Q.style.message.text), Q.style.message.text);
await ask('combos', '내가 저장한 콤보를 분석해 줘');
check('[P2] 콤보 분석: 원투·원투훅 + 단계별 숙련도', /■ 원투: Jab\(숙련\) → Cross\(숙련\)/.test(Q.combos.message.text) && /원투훅/.test(Q.combos.message.text), Q.combos.message.text);
check('[P3] 콤보 분석: 발전 방향은 기술 연결 기록에 있는 실제 기술만', !/undefined/.test(Q.combos.message.text) && Q.combos.message.model === 'martialdex-data');
await ask('rec', '내 숙련도를 기반으로 새로운 콤보를 추천해 줘', { martialArt: 'boxing' });
check('[P4] 콤보 추천: MARTIALDEX 기록 콤보만, 이미 저장한 원투/원투훅 제외', /MARTIALDEX에 기록된 콤보/.test(Q.rec.message.text) && !/- 원투:/.test(Q.rec.message.text) && !/Jab\(숙련\) → Cross\(숙련\)\s*·/.test(Q.rec.message.text.split('\n').find((l) => /→/.test(l) && l.split('→').length === 2) ?? ''), Q.rec.message.text);
check('[P5] 콤보 추천: 숙련 기술(Jab/Cross)이 들어간 콤보가 위에', /Jab\(숙련\)|Cross\(숙련\)/.test(Q.rec.message.text.split('\n')[1] ?? ''), Q.rec.message.text.split('\n').slice(0, 3));
await ask('tactic', '내 전술의 장단점을 분석해 줘');
check('[P6] 전술: 기록(상황→기술)과 앱의 판단(약점: Slip 개선 필요) 구분', /기록: 상황 "상대가 먼 거리에서 잽을 던지면"/.test(Q.tactic.message.text) && /앱의 판단: [^\n]*약점: [^\n]*Slip/.test(Q.tactic.message.text), Q.tactic.message.text);
check('[P7] 전술: 모델 해석은 기록 블록만 받음 (전술 원문 포함)', seen.at(-1)?.includes('상대가 먼 거리에서 잽을 던지면') && /기록에 없는 경기 결과/.test(seen.at(-1)));
await ask('fav', '내가 즐겨찾기한 기술을 활용해 학습 계획을 만들어 줘');
check('[P8] 즐겨찾기 계획: 학습 기록 없는 Lead Uppercut부터 제안, 숙련으로 오인 안 함', /학습 경로 제안: [^\n]*Lead Uppercut/.test(Q.fav.message.text) && !/Lead Uppercut[^\n]*숙련/.test(Q.fav.message.text), Q.fav.message.text);
await ask('spar', '최근 스파링 기록을 분석해 줘');
check('[P9] 스파링: 기록 원문 · 집계 · 앱의 판단 세 블록 분리', /■ 기록 \(/.test(Q.spar.message.text) && /■ 집계 \(/.test(Q.spar.message.text) && /■ 앱의 판단/.test(Q.spar.message.text), Q.spar.message.text);
check('[P10] 스파링: 반복된 말("가드가"/"내려감") 집계, 성공률·승패 없음', /"(가드|내려감|훅)" 2회/.test(Q.spar.message.text) && !/(승리|패배|성공률 \d|\d+%)/.test(Q.spar.message.text), Q.spar.message.text);
check('[P11b] 실측 회귀: 목표의 "잽"과 기록의 boxing__jab을 같은 기술로 셈 (사용 2회, 0회 아님)', /목표에 있는 Jab: 스파링에서 사용했다고 기록한 횟수 2회/.test(Q.spar.message.text), Q.spar.message.text.split('\n').filter((l) => /목표에 있는/.test(l)));
check('[P11] 스파링: 사용 기술 집계는 "사용했다고 기록한 횟수"로 표기', /Jab 2회/.test(Q.spar.message.text) && /성공률이 아니라/.test(Q.spar.message.text));
await ask('diff', '내가 반복적으로 어려워하는 상황을 찾아 줘');
check('[P12] 반복 어려움: 스파링 반복 + 대화 "슬립 어려워요" + 수업 약점 + 개선 필요 기술', /스파링 기록에서 반복/.test(Q.diff.message.text) && /슬립이 너무 어려워요/.test(Q.diff.message.text) && /머리를 바깥으로 이동/.test(Q.diff.message.text) && /Slip/.test(Q.diff.message.text), Q.diff.message.text);
await ask('next', '지난 훈련 기록을 기반으로 다음 훈련을 추천해 줘');
const recent14 = TH.listTrainingHistory().filter((e) => NOW.getTime() - new Date(`${e.date}T00:00:00`).getTime() <= 14 * 86400000).length; // incl. the rows past sparring writes
check('[P13] 다음 훈련: 실제 최근 기록 수 + 개선 필요 Slip 1순위 + 계획은 기록 아님', new RegExp(`최근 2주 훈련 기록 ${recent14}건`).test(Q.next.message.text) && /1\. Slip — 개선 필요/.test(Q.next.message.text) && /훈련 기록에 저장되지 않습니다/.test(Q.next.message.text), Q.next.message.text);
await ask('goalLesson', '이번 주 목표에 맞는 수업을 만들어 줘', { martialArt: 'boxing' });
check('[P14] 목표 수업: 이번 주 목표("잽 다음 훅") 기술로 수업 + 나에게 맞춘 점', /저장된 이번 주 목표\("잽 다음 훅 연결 연습"\)에 있는 기술로 수업을 만들었습니다/.test(Q.goalLesson.message.text) && /📘 수업 계획/.test(Q.goalLesson.message.text) && /나에게 맞춘 점/.test(Q.goalLesson.message.text), Q.goalLesson.message.text.slice(0, 500));
await ask('mem', '과거 AI 코치 대화를 참고해 현재 학습 상태를 분석해 줘');
check('[P15] 학습 상태: 지난 대화 주제(Slip)·반복 질문·끝낸 수업·현재 숙련도', /자주 물어본 기술: [^\n]*Slip/.test(Q.mem.message.text) && /끝낸 수업: [^\n]*복싱 슬립 기초/.test(Q.mem.message.text) && /현재 학습 상태/.test(Q.mem.message.text), Q.mem.message.text);
check('[P16] 학습 상태: 이미 한 수업을 처음부터 반복하지 말라고 명시', /처음부터 (반복하지|다시 만들지)/.test(Q.mem.message.text));
await ask('meal', '내 영양 기록을 참고해서 단백질 충분히 먹고 있어?');
check('[P17] 영양: 실제 식사 기록(닭가슴살 40g)만, 기록 없는 날 추측 안 함', /닭가슴살 샐러드/.test(Q.meal.message.text) && /단백질 40g/.test(Q.meal.message.text) && /기록 없는 날은 계산에서 뺍니다/.test(Q.meal.message.text), Q.meal.message.text);
await ask('mytech', '내가 만든 기술을 다른 기술과 연결해 줘');
check('[P18] 나만의 기술 없음 → 없다고 답함 (만들어 내지 않음)', /직접 만든 기술\(나만의 기술\)이 없습니다/.test(Q.mytech.message.text), Q.mytech.message.text);
await ask('lessonQ', '내 콤보 분석해 줘', { inLesson: true, lessonTechniqueId: 'boxing__jab' });
check('[P19] 수업하기 중에도 같은 분석 + 수업 이어짐', /■ 원투/.test(Q.lessonQ.message.text) && /수업은 하던 단계에서 그대로 이어집니다/.test(Q.lessonQ.message.text));
seen.length = 0;
await turn('내 콤보와 전술을 보고 다음 연습 방향을 같이 알려줘', { martialArt: 'boxing' });
const p20 = seen.at(-1) ?? '';
check('[P20] 복합 질문 → 모델 프롬프트에 콤보·전술이 함께 들어감', /\[내 콤보/.test(p20) && /\[내 전술/.test(p20), p20.slice(p20.indexOf('[이 사용자'), p20.indexOf('[이 사용자') + 600));
check('[P21] 모든 답변에 personalData(읽은 저장소)가 붙음', ['style', 'combos', 'rec', 'tactic', 'fav', 'spar', 'diff', 'next', 'mem', 'meal'].every((k) => Q[k].message.personalData?.stores?.length), Object.fromEntries(Object.entries(Q).map(([k, v]) => [k, v.message.personalData])));

// ---- C. accuracy (A)
check('[C1] 코치 턴 전체에서 저장 데이터 변경 0 (숙련도·완료·목표·콤보 그대로)', snapshot() === afterSeedA);
check('[C2] 존재하지 않는 기술 id가 든 콤보는 "MARTIALDEX에 없는 기술"로 표시', (() => {
  CB.createCombo({ name: '가짜', description: '', techniqueIds: ['boxing__jab', 'boxing__not-a-real-move'] });
  const t = CD.analyzeCombos();
  storage.setItem('martialdex:combos', JSON.stringify(JSON.parse(storage.getItem('martialdex:combos')).filter((c) => c.name !== '가짜')));
  return /MARTIALDEX에 없는 기술 id: boxing__not-a-real-move/.test(t);
})());
const oldSp = { ...JSON.parse(storage.getItem('martialdex:sparring-rule-sessions') ?? '[]')[0] };
check('[C3] 오래된 데이터 표시: 1년 전 콤보는 "오래된 기록"', CD.metaLine({ source: 'x', userId: 'u', createdAt: null, updatedAt: daysAgo(400), freshness: CD.freshnessOf(daysAgo(400) + 'T00:00:00Z'), syncStatus: 'account', confidence: 'user_entered' }).includes('오래된 기록'));
check('[C4] 가짜 스파링 결과 없음: 승패·성공률을 묻는 분석에도 기록 없음 표기', !/(이겼|졌|승률|성공률 \d)/.test(Q.spar.message.text) && Boolean(oldSp));

// ================================================================ B: wrestling learner (same questions → different answers)
const qA = { combos: Q.combos.message.text, spar: Q.spar.message.text, next: Q.next.message.text, style: Q.style.message.text };
storage.clear();
seedB();
const QB = {};
QB.spar = await turn('최근 스파링 기록을 분석해 줘');
QB.next = await turn('지난 훈련 기록을 기반으로 다음 훈련을 추천해 줘');
QB.combos = await turn('내가 저장한 콤보를 분석해 줘');
QB.reach = await turn('내 스탠스가 뭐였지?');
check('[X1] 같은 질문 · 다른 사용자 → 스파링 분석이 B 기록(스프롤에 막힘)으로', /스프롤에 (또 )?막힘/.test(QB.spar.message.text) && !/가드가 내려감/.test(QB.spar.message.text) && QB.spar.message.text !== qA.spar, QB.spar.message.text);
check('[X2] 같은 질문 · 다른 사용자 → 다음 훈련이 B의 더블 레그(목표·학습 중)', /Double Leg/.test(QB.next.message.text) && !/Slip/.test(QB.next.message.text), QB.next.message.text);
check('[X3] B는 콤보가 없음 → 없다고 답함 (A의 원투가 섞이지 않음)', /저장된 콤보가 없습니다/.test(QB.combos.message.text) && !/원투/.test(QB.combos.message.text));
check('[X4] B 스탠스 = 사우스포 (A는 오소독스)', /사우스포/.test(QB.reach.message.text) && !/오소독스/.test(QB.reach.message.text));

// ================================================================ account switch: unsynced data survives
storage.clear();
DG.guardAccountSwitch('user-A');
TH.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['boxing__jab'], completed: true, estimatedMinutes: 20, notes: 'A 미동기화 기록', source: 'free_training' });
check('[S0] A 기록 작성 (동기화 안 됨)', /A 미동기화 기록/.test(storage.getItem('martialdex:training-history') ?? ''));
// sign out: nothing is cleared · sign in as B on the same device
const switchedToB = DG.guardAccountSwitch('user-B');
check('[S1] B로 전환: A 데이터가 B에게 보이지 않음 (격리)', switchedToB && !/A 미동기화 기록/.test(storage.getItem('martialdex:training-history') ?? ''));
check('[S2] B로 전환: A 데이터는 A 전용 보관소에 보존 (martialdex: 접두사 밖 — 백업·동기화 대상 아님)', /A 미동기화 기록/.test(storage.getItem(`${DG.ACCOUNT_STASH_PREFIX}user-A`) ?? '') && ![...mem.keys()].some((k) => k.startsWith('martialdex:') && /A 미동기화/.test(mem.get(k))));
check('[S3] B의 AI 컨텍스트에 A 데이터 없음', !/A 미동기화 기록/.test(UC.userCoachContext({ topic: '최근 훈련 기록', detailBudget: 2000 }).text));
TH.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['wrestling__sprawl'], completed: true, estimatedMinutes: 20, notes: 'B 기록', source: 'free_training' });
const switchedToA = DG.guardAccountSwitch('user-A');
check('[S4] 다시 A로: A의 미동기화 기록 복원 (동기화가 이어서 올림)', switchedToA && /A 미동기화 기록/.test(storage.getItem('martialdex:training-history') ?? '') && !storage.getItem(`${DG.ACCOUNT_STASH_PREFIX}user-A`));
check('[S5] 다시 A로: B 기록은 A에게 안 보이고 B 보관소에 보존', !/B 기록/.test(storage.getItem('martialdex:training-history') ?? '') && /B 기록/.test(storage.getItem(`${DG.ACCOUNT_STASH_PREFIX}user-B`) ?? ''));
check('[S6] 같은 계정 재로그인(전환 아님): 아무것도 지우지 않음 · 중복 없음', !DG.guardAccountSwitch('user-A') && (storage.getItem('martialdex:training-history').match(/A 미동기화 기록/g) ?? []).length === 1);
check('[S7] 테마 같은 기기 설정은 전환 후에도 유지', (storage.setItem('martialdex:theme', 'dark'), DG.guardAccountSwitch('user-B'), storage.getItem('martialdex:theme') === 'dark'));
check('[S8] 보관 실패 기록 없음 (정상 경로)', DG.accountStashFailures().length === 0);

// ================================================================ sources · meaning · terminology
const SRC3 = '전체 수분 손실을 체중의 3~5%로 제한하고 정밀한 리하이드레이션과 빠른 글리코겐 재보충을 병행하는 전략적 워터컷은 계체에서 체급 우위를 확보하면서도 경기 시간까지 경기력 지표를 기준치의 2% 이내로 회복시킬 수 있다.';
let cl = E.checkClaims('이는 경기력 지표가 기준치보다 2%까지 하락할 수 있다는 연구 결과도 있습니다.', [{ n: 3, text: SRC3 }]);
check('[M1] 8차 2% 왜곡 회귀 유지 (contradicted · direction_flip · condition_dropped)', cl[0].status === 'contradicted' && cl[0].problems.includes('direction_flip') && cl[0].problems.includes('condition_dropped'), cl);
cl = E.checkClaims('정밀한 리하이드레이션은 경기력 지표 회복에 도움이 되지 않습니다.', [{ n: 3, text: '정밀한 리하이드레이션은 경기력 지표 회복에 도움이 된다.' }]);
check('[M2] 부정·긍정 반전 = contradicted (negation_mismatch)', cl[0].status === 'contradicted' && cl[0].problems.includes('negation_mismatch'), cl);
cl = E.checkClaims('격투기 선수는 하루 10시간 자야 합니다.', [{ n: 1, text: SRC3 }]);
check('[M3] 원문에 없는 내용 → unverified + 출처에 없는 수치', cl[0].status === 'unverified' && cl[0].problems.includes('number_not_in_source'), cl);
const sum = E.claimSummary([{ sentence: 'a', status: 'supported', source: 1, problems: [] }, { sentence: 'b', status: 'unverified', source: null, problems: [] }]);
check('[M4] 답변별 검증 요약: 확인 1 · 미확인 1 + "의미를 완전히 검증하지 못함" 명시', /확인된 문장 1개 · 출처에서 확인되지 않은 문장 1개/.test(sum) && /완전히 검증하지 못합니다/.test(sum), sum);
const RES = [{ sourceId: 'src-abc1234567', fetchedAt: NOW.toISOString(), title: '워터컷', url: 'https://r.example/w', snippet: SRC3, content: SRC3, source: 'r.example', engines: ['bing'], relevance: 1, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'ok' } }];
const st = await turn('요즘 격투기 선수 급격한 체중 감량 위험성에 대한 최신 자료 찾아줘', {}, { research: async () => ({ ok: true, kind: 'web', results: RES, diagnostics: { backend: 'searxng' } }), chat: async () => ({ ok: true, text: '전략적 워터컷은 경기력 지표를 기준치의 2% 이내로 회복시킬 수 있습니다. 경기력이 2%까지 하락합니다. 다시 검색해 보겠습니다.', model: 'fake-3b', evalCount: 1, ms: 1 }) });
check('[M5] 출처는 앱이 준 sourceId·검색 시각을 그대로 가짐', st.message.sources?.[0]?.sourceId === 'src-abc1234567' && st.message.sources[0].fetchedAt === RES[0].fetchedAt, st.message.sources);
check('[M6] 근거 대조 claim이 sourceId로 실제 자료를 가리킴', st.message.claims?.some((c) => c.status === 'supported' && c.sourceId === 'src-abc1234567'), st.message.claims);
check('[M7] 왜곡 문장 제거 · 약속 문장 제거 · 검증 요약 노트', !/2%까지 하락/.test(st.message.text) && !/다시 검색해 보겠습니다/.test(st.message.text) && st.message.guardNotes?.some((n) => /근거 대조: 출처 문장으로 확인된 문장/.test(n)), st.message);
const noSrc = await turn('요즘 격투기 선수 부상 회복 자료 찾아줘', {}, { research: async () => ({ ok: true, kind: 'web', results: [], diagnostics: { backend: 'searxng', rawCount: 0 } }) });
check('[M8] 검색 결과 없음 → 출처 없음 표시, 가짜 출처 없음', !noSrc.message.sources && /0건/.test(noSrc.message.text), noSrc.message.text.split('\n')[0]);

// terminology (official names from MARTIALDEX data only)
const jab = (await import(pathToFileURL(out).href)).A ? null : null;
const tJab = { id: 'boxing__jab', name: 'Jab', koreanName: '잽', martialArt: 'boxing' };
const tKimura = { id: 'bjj__kimura', name: 'Kimura', koreanName: '기무라', martialArt: 'bjj' };
let fx = TM.fixTerminology('Jab을 먼저 던지고 Jab 뒤에 쨉을 한 번 더.', [tJab]);
check('[K1] 영어 기술명 → "잽(Jab)" 한 번, 이후 "잽"; 쨉 → 잽', fx.text === '잽(Jab)을 먼저 던지고 잽 뒤에 잽을 한 번 더.', fx);
fx = TM.fixTerminology('키무라를 걸 때 팔꿈치를 고정합니다.', [tKimura]);
check('[K2] 키무라 → 기무라 (같은 소리, 다른 철자)', fx.text.startsWith('기무라를'), fx);
fx = TM.fixTerminology('잉크를 연습하세요. 잽은 거리 조절입니다.', [tJab]);
check('[K3] 규칙으로 알 수 없는 오기("잉크")는 추측해서 바꾸지 않음', fx.text.includes('잉크') && fx.notes.length === 0, fx);
fx = TM.fixTerminology('잭카운터 전술은 상대가 잭을 던질 때 씁니다. 잣을 막고 잘 피하세요. 잔 기술보다 잽이 먼저입니다.', [tJab]);
// "잣" differs in the vowel too (ㅏ vs ㅐ) — two differences are not corrected (guessing would be worse)
check('[K5] 받침만 다른 오기(잭) → 잽 · 모음까지 다른 "잣"과 흔한 단어(잘·잔)는 그대로', fx.text === '잽카운터 전술은 상대가 잽을 던질 때 씁니다. 잣을 막고 잘 피하세요. 잔 기술보다 잽이 먼저입니다.', fx);
fx = TM.fixTerminology('잘 맞추세요. 잠을 충분히 자고, 한 번 더.', [tJab]);
check('[K6] 오기가 없으면 아무것도 바꾸지 않음 (잘·잠·한)', fx.text === '잘 맞추세요. 잠을 충분히 자고, 한 번 더.' && !fx.notes.length, fx);
fx = TM.fixTerminology('스탠스를 낮추세요.', [{ id: 'x__stance', name: '스탠스', koreanName: '스탠스', martialArt: 'boxing' }]);
check('[K7] 이름이 이미 한국어인 기록은 "영어 기술명" 안내를 만들지 않음 (실측 오류 회귀)', fx.text === '스탠스를 낮추세요.' && !fx.notes.length, fx);
check('[K4] 표기 목록(glossary)은 데이터의 공식 이름만', /- 잽 \(Jab\)/.test(TM.glossaryBlock([tJab])) && TM.glossaryBlock([{ id: 'x', name: 'Unknown Move', martialArt: 'boxing' }]) === '');

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
fs.writeFileSync(path.join(os.tmpdir(), 'coach-10th-results.json'), JSON.stringify(results, null, 1));
process.exit(fail ? 1 : 0);
