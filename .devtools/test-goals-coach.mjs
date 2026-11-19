// 개인 목표 저장 + AI 코치 전달 — offline test. Real stores (fake localStorage), real coachAgent, real lesson
// service; the model and the search are fakes and nothing goes to the network. Proves the user's own written
// goals actually reach the AI request context in BOTH 대화하기 and 수업하기, not just that a function returned.
//   node .devtools/test-goals-coach.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as S from ${mod('src/lib/goals/store.ts')};`,
    `export * as GC from ${mod('src/lib/goals/coachContext.ts')};`,
    `export * as UC from ${mod('src/lib/coachContext/userContext.ts')};`,
    `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
    `export * as D from ${mod('src/lib/selfAi/deps.ts')};`,
    `export * as DAY from ${mod('src/lib/aiCoachDay/service.ts')};`,
    `export * as P from ${mod('src/lib/ai/provider.ts')};`,
    `export * as T from ${mod('src/lib/userTechniques/service.ts')};`,
    `export * as FP from ${mod('src/lib/fighterProfile/store.ts')};`,
    `export * as SY from ${mod('src/lib/cloudSync/goalsSync.ts')};`,
  ].join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
};
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { S, GC, UC, A, D, DAY, P, T, FP, SY } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 500)}`}`);
};

// ---------------------------------------------------------------- A. 기간 계산과 저장
const NOV = new Date('2026-11-07T10:00:00+09:00'); // 2026-W45, 2026-11, 2026 / 내년 2027
check('[A1] 기간 키를 오늘 날짜로 계산 (ISO 주 · 월 · 올해 · 내년)', S.isoWeekKey(NOV) === '2026-W45' && S.monthKey(NOV) === '2026-11' && S.currentSlots(NOV).map((s) => `${s.slot}:${s.periodKey}`).join() === 'week:2026-W45,month:2026-11,year:2026,next_year:2027,long_term:', S.currentSlots(NOV).map((s) => s.periodKey));
check('[A2] 연도를 글에 박아 넣지 않음 — 슬롯 라벨이 날짜에서 나옴', S.currentSlots(new Date('2027-01-04T10:00:00+09:00')).find((s) => s.slot === 'next_year').periodKey === '2028');

const slots = S.currentSlots(NOV);
const put = (slot, text) => { const s = slots.find((x) => x.slot === slot); return S.saveGoal(s.scope, s.periodKey, text); };
put('week', '이번 주에는 더블렉 테이크다운의 진입과 마무리를 개선하고 싶다.');
put('month', '이번 달은 레슬링 진입 능력을 체계적으로 끌어올린다.');
put('year', '올해 안에 스파링에서 테이크다운 성공률을 눈에 띄게 올린다.');
put('next_year', '내년에는 종합격투기 실력을 한 단계 높이고 싶다.');
put('long_term', '앞으로 MMA에서 타격과 레슬링을 자연스럽게 연결하는 선수가 되고 싶다.');
check('[A3] 5개 영역 저장 + 마지막 수정 시간 기록', S.goalSlots(NOV).every((s) => s.entry && s.entry.text && s.entry.updatedAt), S.goalSlots(NOV).map((s) => !!s.entry));
check('[A4] 자유 텍스트 그대로 보관 (요약·변형 없음)', S.findGoal('week', '2026-W45').text === '이번 주에는 더블렉 테이크다운의 진입과 마무리를 개선하고 싶다.');

put('week', '이번 주 목표를 수정했다: 더블렉 진입만 집중.');
check('[A5] 수정하면 같은 기간 항목이 갱신 (중복 생성 아님)', S.listGoals().filter((e) => e.scope === 'week').length === 1 && /진입만 집중/.test(S.findGoal('week', '2026-W45').text));
const beforeDelete = S.listGoals().length;
S.deleteGoal('month', '2026-11');
check('[A6] 삭제 = 해당 영역만 사라지고 나머지는 유지 (동기화용 tombstone 유지)', S.findGoal('month', '2026-11') === null && S.listGoals().length === beforeDelete - 1 && S.getGoalsData().entries.some((e) => e.scope === 'month' && e.deletedAt));
put('month', '이번 달은 레슬링 진입 능력을 체계적으로 끌어올린다.');
check('[A7] 삭제 후 다시 작성 가능', !!S.findGoal('month', '2026-11'));
check('[A8] 빈 칸 허용 — 빈 목표를 만들지 않음', S.saveGoal('week', '2027-W01', '   ') === null && S.findGoal('week', '2027-W01') === null);

// ---------------------------------------------------------------- B. 지난 목표
const LATER = new Date('2026-12-20T10:00:00+09:00'); // 주·달은 지났고 2026년은 아직
const past = S.pastGoals(LATER);
check('[B1] 기간이 지나면 지난 목표로 분류 (주·달)', past.length === 2 && past.every((e) => ['week', 'month'].includes(e.scope)), past.map((e) => e.scope));
check('[B2] 지난 목표를 자동 삭제하지 않음 — 그대로 보관', S.findGoal('week', '2026-W45') !== null && S.listGoals().length === 5);
check('[B3] 올해 목표는 연말까지 현재 목표, 장기 목표는 기간이 지나지 않음', !S.isPast(S.findGoal('year', '2026'), LATER) && !S.isPast(S.findGoal('long_term', ''), LATER));
const NEXT_YEAR = new Date('2027-03-02T10:00:00+09:00');
check('[B4] 해가 바뀌면 작년 목표는 지난 목표, "내년 목표"는 그 해의 올해 목표가 됨', S.isPast(S.findGoal('year', '2026'), NEXT_YEAR) && S.goalSlots(NEXT_YEAR).find((s) => s.slot === 'year').entry?.text === '내년에는 종합격투기 실력을 한 단계 높이고 싶다.');

// ---------------------------------------------------------------- C. 컨텍스트 우선순위
const ctx = GC.goalsContext({ now: NOV });
check('[C1] 우선순위대로 (이번 주 → 이번 달 → 올해 → 내년 → 앞으로)', ctx.slots.map((s) => s.split(' ')[0]).join() === '이번,이번,올해,내년,앞으로의', ctx.slots);
check('[C2] 사용 원칙 포함 — 코치는 읽기만, 지어내지 않음', /목표를 고치거나 새로 만들거나 지우지 않는다/.test(ctx.text) && /지어내지 말고/.test(ctx.text));
const tight = GC.goalsContext({ now: NOV, max: 320 });
check('[C3] 분량이 모자라면 뒤 순위를 빼되, 생략했다고 명시 (없다고 오해 금지)', tight.omitted.length > 0 && /생략된 것이므로 "목표가 없다"고 답하지 않는다/.test(tight.text) && tight.slots[0].startsWith('이번 주'), { sent: tight.slots, omitted: tight.omitted });
check('[C4] 목표가 하나도 없으면 빈 문자열 (없는 목표를 만들지 않음)', GC.goalsContext({ now: NOV, goals: [] }).text === '');

// ---------------------------------------------------------------- D. 공통 사용자 컨텍스트
FP.saveProfile(FP.withItem(FP.getProfile(), 'body.stance', { value: 'southpaw', state: 'answered' }, 'user').profile);
const uc = UC.userCoachContext({ martialArt: 'wrestling', topic: '더블렉' });
check('[D1] 프로필 · 목표 · 학습 기록을 한 블록으로 (대화·수업 공통)', uc.parts.goals && uc.parts.profile && /개인 목표/.test(uc.text) && /개인 파이터 프로필/.test(uc.text), uc.parts);
check('[D2] 로딩 실패와 미등록을 구분', uc.loadErrors.length === 0 && typeof uc.parts.learning === 'boolean');

// ---------------------------------------------------------------- E. 대화하기가 실제로 목표를 받는가
const chatCalls = [];
const fakeDeps = () => ({
  ...D.appCoachDeps(),
  research: async () => ({ ok: true, results: [], diagnostics: { failedEngines: [], queries: [] } }),
  chat: async (req) => (chatCalls.push(req), { ok: true, text: '네, 목표에 맞춰 설명드리겠습니다.', model: 'fake' }),
  knowledgeIndex: async () => null,
  dataAnswer: async () => null,
});
chatCalls.length = 0;
await A.runCoachTurn({ text: '더블렉 테이크다운 어떻게 연습해야 해?', history: [], martialArt: 'wrestling', requestId: 'g1' }, fakeDeps());
const chatPrompt = chatCalls[0]?.messages?.[0]?.content ?? '';
check('[E1] 대화 요청의 시스템 프롬프트에 이번 주 목표 원문이 들어감', /더블렉 진입만 집중/.test(chatPrompt), chatPrompt.slice(0, 200));
check('[E2] 장기 목표도 함께 전달 (현재 훈련 방향에 영향)', /타격과 레슬링을 자연스럽게 연결/.test(chatPrompt));
check('[E3] 프로필도 같은 요청에 포함 (목표와 함께 참조)', /사우스포|스탠스/.test(chatPrompt));
check('[E4] 지어내지 말라는 지시가 함께 전달됨', /없는 항목은 지어내지 않는다|지어내지 말/.test(chatPrompt));

chatCalls.length = 0;
await A.runCoachTurn({ text: '효도르 경기 영상 찾아줘', history: [], martialArt: null, requestId: 'g2' }, fakeDeps());
const videoPrompt = chatCalls[0]?.messages?.[0]?.content ?? '';
check('[E5] 개인 데이터가 쓸모없는 질문(영상 검색)에는 넣지 않아 프롬프트를 아끼는가', !/더블렉 진입만 집중/.test(videoPrompt), videoPrompt.slice(0, 120));

// ---------------------------------------------------------------- F. 수업하기가 실제로 목표를 받는가
const askCalls = [];
const realAsk = P.aiProvider.ask;
P.aiProvider.ask = async (req) => (askCalls.push(req), { ok: true, text: '목표를 참고해 답변드립니다.' });
const tech = T.resolveTechnique('wrestling__basic-double-leg');
const lessonRes = await DAY.askCoach(tech, '[오늘 DAY] 더블렉', [], '제 목표에 맞게 뭘 더 하면 좋을까요?');
P.aiProvider.ask = realAsk;
const lessonCtx = askCalls[0]?.contextText ?? '';
check('[F1] 수업 중 질문의 컨텍스트에 개인 목표가 들어감', lessonRes.ok && /더블렉 진입만 집중/.test(lessonCtx), lessonCtx.slice(-300));
check('[F2] 수업 컨텍스트에 프로필도 함께 (둘 다 참조)', /개인 파이터 프로필/.test(lessonCtx) && /개인 목표/.test(lessonCtx));
check('[F3] 수업 기술 데이터는 그대로 유지 (기존 동작 보존)', /기술 데이터/.test(lessonCtx) && /오늘 DAY/.test(lessonCtx));

// ---------------------------------------------------------------- G. 동기화 병합
const a = { version: 1, entries: [{ id: '1', scope: 'week', periodKey: '2026-W45', text: 'local 최신', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' }], updatedAt: '2026-11-07T00:00:00.000Z' };
const b = { version: 1, entries: [{ id: '1', scope: 'week', periodKey: '2026-W45', text: 'cloud 과거', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' }, { id: '2', scope: 'year', periodKey: '2027', text: '다른 기기에서 쓴 내년 목표', createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z' }], updatedAt: '2026-11-06T00:00:00.000Z' };
const merged = SY.mergeGoals(a, b);
check('[G1] 기기 간 병합: 기간별로 최신이 이기고, 다른 기기의 다른 기간 목표는 보존', merged.entries.length === 2 && merged.entries.find((e) => e.periodKey === '2026-W45').text === 'local 최신' && merged.entries.some((e) => e.periodKey === '2027'), merged.entries.map((e) => `${e.periodKey}:${e.text}`));
const withTomb = SY.mergeGoals(a, { version: 1, entries: [{ ...a.entries[0], text: '', deletedAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }], updatedAt: '2026-11-08T00:00:00.000Z' });
check('[G2] 삭제(tombstone)도 전파', !!withTomb.entries[0].deletedAt);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
