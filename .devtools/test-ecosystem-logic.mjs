// 통합 플랫폼 — 결정론적 로직 테스트 (네트워크·Supabase·AI 호출 없음).
// 개인 훈련 프로그램 엔진 · 훈련 성과 분석 · 체육관 가격 비교 · 유입 통계 · 체육관 대시보드 · 기술 평가 항목/신뢰도
//   node .devtools/test-ecosystem-logic.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'e.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as PE from ${mod('src/lib/trainingProgram/engine.ts')};`,
  `export * as PS from ${mod('src/lib/trainingProgram/store.ts')};`,
  `export * as PR from ${mod('src/lib/progressReport/analysis.ts')};`,
  `export * as GD from ${mod('src/lib/gymDirectory/service.ts')};`,
  `export * as GA from ${mod('src/lib/gymClass/adminService.ts')};`,
  `export * as EC from ${mod('src/lib/techniqueEvaluation/criteria.ts')};`,
  `export * as ES from ${mod('src/lib/techniqueEvaluation/service.ts')};`,
  `export * as GR from ${mod('src/lib/gear/service.ts')};`,
  `export * as CM from ${mod('src/lib/ecosystem/common.ts')};`,
  `export * as TH from ${mod('src/lib/trainingHistory/service.ts')};`,
].join('\n'));
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
globalThis.localStorage ??= { _d: new Map(), getItem(k) { return this._d.get(k) ?? null; }, setItem(k, v) { this._d.set(k, String(v)); }, removeItem(k) { this._d.delete(k); }, clear() { this._d.clear(); }, key() { return null; }, get length() { return this._d.size; } };
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, setTimeout: () => 0, clearTimeout() {}, localStorage: globalThis.localStorage };
const { PE, PS, PR, GD, GA, EC, ES, GR, CM, TH } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n} :: ${JSON.stringify(d)?.slice(0, 300)}`); } };

// ---------------- C. 개인 훈련 프로그램 엔진 ----------------
console.log('\n[C] 개인 훈련 프로그램');
const cand = (id, status, extra = {}) => ({ techniqueId: id, name: id, martialArt: 'boxing', status, nextReviewAt: null, difficulty: 2, favorite: false, weakRank: null, ...extra });
const base = {
  weekStart: '2026-11-16',
  settings: { ...PE.DEFAULT_SETTINGS, daysPerWeek: 3, sessionMinutes: 30, newPerWeek: 2, fixedRestWeekdays: [6] },
  candidates: [
    cand('jab', 'needs_improvement', { weakRank: 0 }),
    cand('cross', 'learning', { nextReviewAt: '2026-11-18T00:00:00Z' }),
    cand('hook', 'proficient', { nextReviewAt: '2026-12-30T00:00:00Z' }),
    cand('uppercut', 'not_started', { difficulty: 1 }),
    cand('slip', 'not_started', { difficulty: 3, favorite: true }),
    cand('bodyshot', 'not_started', { difficulty: 2 }),
    cand('armbar', 'not_started', { martialArt: 'bjj', difficulty: 1 }),
  ],
  combos: [{ id: 'c1', name: '원투', martialArt: 'boxing' }],
  assignments: [{ id: 'a1', techniqueId: 'hook', title: '훅 거리 연습' }],
  recentMinutes: [0, 0, 0, 0, 0, 0, 0],
  previous: null,
};
const now = new Date('2026-11-15T12:00:00Z');
const w1 = PE.generateWeek(base, now);
const w1b = PE.generateWeek(base, now);
check('C1 같은 입력 → 같은 계획 (결정론)', JSON.stringify(w1) === JSON.stringify(w1b));
check('C2 7일 · 훈련일 3일 · 일요일 휴식', w1.days.length === 7 && w1.days.filter((d) => !d.rest).length === 3 && w1.days[6].rest);
check('C3 연속 훈련일 피함 (월·수·금)', JSON.stringify(w1.days.map((d, i) => (d.rest ? null : i)).filter((x) => x !== null)) === '[0,2,4]', w1.days.map((d) => d.rest));
const all1 = w1.days.flatMap((d) => d.items);
check('C4 체육관 과제가 가장 먼저', all1[0]?.kind === 'assignment' && all1[0].techniqueId === 'hook', all1[0]);
check('C5 약점(개선 필요) 포함', all1.some((i) => i.kind === 'weak' && i.techniqueId === 'jab'));
check('C6 복습 예정일이 이번 주인 기술만 복습 (hook 은 12월이라 복습 아님)', all1.some((i) => i.kind === 'review' && i.techniqueId === 'cross') && !all1.some((i) => i.kind === 'review' && i.techniqueId === 'hook'));
const news = all1.filter((i) => i.kind === 'new').map((i) => i.techniqueId);
check('C7 새 기술: 즐겨찾기 먼저, 그다음 쉬운 난이도 (주당 2개, 집중 종목 없음 = 전 종목)', JSON.stringify(news) === '["slip","armbar"]', news);
check('C8 하루 분량 = 30분 / 10분 = 3개 이하', w1.days.every((d) => d.items.length <= 3));
check('C9 같은 기술이 한 주에 두 번 나오지 않음', new Set(all1.filter((i) => i.techniqueId).map((i) => i.techniqueId)).size === all1.filter((i) => i.techniqueId).length);
const focus = PE.generateWeek({ ...base, settings: { ...base.settings, focusArt: 'bjj' } }, now);
check('C10 집중 종목 설정 시 다른 종목 새 기술 제외', focus.days.flatMap((d) => d.items).filter((i) => i.kind === 'new').every((i) => i.techniqueId === 'armbar'));
// adjustment: low completion → fewer items; carry-over
const prev = JSON.parse(JSON.stringify(w1));
prev.weekStart = '2026-11-09';
const w2 = PE.generateWeek({ ...base, weekStart: '2026-11-23', previous: prev }, now);
check('C11 지난주 완료율 0% → 하루 항목 1개 줄임', w2.notes.some((n) => n.includes('완료율 0%')) && w2.days.every((d) => d.items.length <= 2), w2.notes);
check('C12 못한 약점·복습은 다음 주로 넘어감', w2.days.flatMap((d) => d.items).some((i) => i.reason.startsWith('지난주에 못한 항목')));
const allDone = JSON.parse(JSON.stringify(w1));
allDone.days.forEach((d) => d.items.forEach((i) => { i.done = true; }));
const w3 = PE.generateWeek({ ...base, settings: { ...base.settings, sessionMinutes: 60 }, weekStart: '2026-11-23', previous: allDone }, now);
check('C13 완료율 100% → 새 기술 1개 추가', w3.days.flatMap((d) => d.items).filter((i) => i.kind === 'new').length === 3 && w3.notes.some((n) => n.includes('새 기술 1개')), w3.notes);
const tired = PE.generateWeek({ ...base, recentMinutes: [0, 0, 0, 0, 60, 60, 60] }, now);
check('C14 최근 3일 연속 훈련 → 훈련일 하루 줄여 회복', tired.days.filter((d) => !d.rest).length === 2 && tired.notes.some((n) => n.includes('회복') || n.includes('쉬도록')), tired.notes);
check('C15 고정 휴식 요일 존중', PE.pickTrainingWeekdays(3, [0, 2]).every((d) => d !== 0 && d !== 2) && PE.pickTrainingWeekdays(3, [0, 2]).length === 3, PE.pickTrainingWeekdays(3, [0, 2]));
// keep user edits on regeneration
const edited = JSON.parse(JSON.stringify(w1));
edited.days[0].items[0].done = true;
edited.days[5].rest = false; edited.days[5].userSet = true; edited.days[5].items = [{ id: 'cu-x', kind: 'custom', techniqueId: 'bodyshot', comboId: null, title: 'bodyshot', minutes: 10, reason: '직접 추가', done: false, doneAt: null, pinned: true }];
const regen = PE.regenerateKeeping(edited, PE.generateWeek(base, now));
check('C16 다시 만들어도 완료한 항목 유지', regen.days[0].items.some((i) => i.id === edited.days[0].items[0].id && i.done));
check('C17 다시 만들어도 직접 추가·요일 변경 유지', !regen.days[5].rest && regen.days[5].items.some((i) => i.id === 'cu-x'));
check('C18 mondayOf', PE.mondayOf(new Date(2026, 10, 15)) === '2026-11-09' && PE.mondayOf(new Date(2026, 10, 16)) === '2026-11-16');
// store: log a day into the real training history (single source of truth)
localStorage.clear();
const ws = PE.mondayOf(new Date());
PS.saveSettings({ daysPerWeek: 3 });
const wk = PS.buildWeek(ws);
const day = wk.days.find((d) => !d.rest);
PS.addTechniqueItem(ws, day.date, 'boxing__jab', 'Jab');
const item = PS.getWeek(ws).days.find((d) => d.date === day.date).items.find((i) => i.techniqueId === 'boxing__jab');
PS.toggleItemDone(ws, item.id);
const entryId = PS.logDay(ws, day.date);
PS.logDay(ws, day.date);
const hist = TH.listTrainingHistory().filter((e) => e.source === 'program');
check('C19 하루 완료 → 기존 훈련 기록에 1건 (다시 눌러도 중복 없음)', !!entryId && hist.length === 1 && hist[0].techniqueIds.includes('boxing__jab'), hist);
check('C20 코치 컨텍스트 요약 줄 생성', PS.programContextLine().includes('개인 훈련 프로그램') && PS.programContextLine().includes('완료'));

// ---------------- B. 훈련 성과 분석 ----------------
console.log('\n[B] 훈련 성과 분석');
const rec = (id, at, score, m, extra = {}) => ({ recordId: id, techniqueId: 'boxing__jab', martialArtId: 'boxing', score, status: 'average', metricScores: m, analyzedAt: at, ...extra });
const recs = [
  rec('r1', '2026-10-01T00:00:00Z', 50, { guard: 40, extension: 55 }),
  rec('r2', '2026-10-10T00:00:00Z', 58, { guard: 45, extension: 70 }),
  rec('r3', '2026-10-20T00:00:00Z', 64, { guard: 50, extension: 78 }),
  rec('r4', '2026-11-01T00:00:00Z', 70, { guard: 52, extension: 85 }),
  rec('v1', '2026-10-05T00:00:00Z', 90, { c1: 100 }, { method: 'video_compare' }),
];
const series = PR.buildSeries(recs, (_t, m) => m);
check('B1 측정 방식이 다르면 다른 묶음 (섞지 않음)', series.length === 2 && series.some((s) => s.method === 'video_compare' && s.records.length === 1));
const s = series.find((x) => x.method === 'landmark');
check('B2 최초 50 → 최근 70, 변화 +20', s.first.score === 50 && s.latest.score === 70 && s.scoreDelta === 20);
check('B3 개선 항목: extension +30', s.improved[0]?.metricId === 'extension' && s.improved[0].delta === 30, s.improved);
check('B4 반복 약점: guard 4/4회 60 미만', s.recurringWeak.some((m) => m.metricId === 'guard' && m.weakCount === 4));
check('B5 1회 측정 묶음은 판단 불가', series.find((x) => x.method === 'video_compare').confidence.level === 'insufficient');
const noisy = PR.analyzeSeries([rec('n1', '2026-10-01T00:00:00Z', 40, {}), rec('n2', '2026-10-02T00:00:00Z', 85, {}), rec('n3', '2026-10-03T00:00:00Z', 45, {}), rec('n4', '2026-10-04T00:00:00Z', 90, {})], (_t, m) => m);
check('B6 편차 큰 반복 측정 → 불안정 · 신뢰도 낮음', noisy.consistency === 'unstable' && noisy.confidence.level === 'low', noisy.spread);
const lowRel = PR.analyzeSeries([rec('l1', '2026-10-01T00:00:00Z', 60, {}, { reliability: 'low' }), rec('l2', '2026-10-02T00:00:00Z', 61, {}), rec('l3', '2026-10-03T00:00:00Z', 62, {}, { reliability: 'low' }), rec('l4', '2026-10-04T00:00:00Z', 62, {})], (_t, m) => m);
check('B7 신뢰도 낮은 측정이 많으면 신뢰도 낮음 + 사유', lowRel.confidence.level === 'low' && lowRel.confidence.reasons.some((r) => r.includes('신뢰도가 낮')));
const per = PR.periodSummary(recs, 30, new Date('2026-11-02T00:00:00Z').getTime());
check('B8 기간 요약: 최근 30일 측정 4회, 2회 이상 측정된 묶음만 변화 계산', per.measurements === 4 && per.changes.length === 1 && per.changes[0].delta === 12, per);

// ---------------- F. 체육관 가격 비교 · 유입 통계 ----------------
console.log('\n[F] 가격 비교 · 유입 통계');
const p = (o) => ({ listingId: 'x', monthly: null, threeMonth: null, sixMonth: null, yearly: null, initiationFee: null, registrationFee: null, gearCost: null, sessionsPerWeek: null, minutesPerSession: null, openMat: null, multiArt: null, trialAvailable: null, trialPrice: null, notes: '', ownerConfirmedAt: '2026-11-01', verifiedAt: null, ...o });
const A = p({ monthly: 150000, yearly: 1500000, initiationFee: 50000, registrationFee: 0, gearCost: 100000, sessionsPerWeek: 3 });
const B = p({ monthly: 130000, yearly: 1400000, initiationFee: null, registrationFee: 0, gearCost: 0, sessionsPerWeek: 5 });
const rows = GD.buildComparison([{ pricing: A }, { pricing: B }, { pricing: null }]);
const row = (k) => rows.find((r) => r.key === k);
check('F1 월 회비 최저 표시 (B)', row('monthly').best === 1 && row('monthly').values[2] === null);
check('F2 첫 1년 총비용: 모르는 항목이 있으면 계산 안 함 (추정 금지)', row('first_year').values[0] === '1,650,000원' && row('first_year').values[1] === null && row('first_year').best === null, row('first_year'));
check('F3 1회 수업당 비용 = 월회비 / (주당 × 4.345)', GD.monthlyPerSession(A) === Math.round(150000 / (3 * 4.345)) && row('per_session').best === 1);
check('F4 값이 하나뿐이면 "최저" 표시 안 함', GD.buildComparison([{ pricing: A }, { pricing: null }]).find((r) => r.key === 'monthly').best === null);
const ls = GD.computeLeadStats(['2026-10-03T00:00:00Z', '2026-11-01T00:00:00Z'], [
  { status: 'redeemed', issuedAt: '2026-10-05T00:00:00Z', redeemedAt: '2026-11-02T00:00:00Z' },
  { status: 'issued', issuedAt: '2026-11-03T00:00:00Z', redeemedAt: null },
  { status: 'cancelled', issuedAt: '2026-11-04T00:00:00Z', redeemedAt: null },
]);
check('F5 유입 통계: 문의 2 · 발급 2(취소 제외) · 사용 1 · 전환 50%', ls.inquiries === 2 && ls.couponsIssued === 2 && ls.couponsRedeemed === 1 && ls.conversionRate === 50, ls);
check('F6 월별 묶음', ls.byMonth.length === 2 && ls.byMonth[1].redeemed === 1, ls.byMonth);
check('F7 쿠폰 만료 상태 계산', GD.couponState({ status: 'issued', expiresAt: '2020-01-01T00:00:00Z' }) === 'expired' && GD.couponState({ status: 'redeemed', expiresAt: '2020-01-01T00:00:00Z' }) === 'redeemed');
check('F8 할인 검증: 90% 초과·종료일 역전 거절', !!GD.validateOffer({ title: '할인', plan: 'monthly', discountType: 'percent', discountValue: 95, target: 'everyone', maxRedemptions: null, startsAt: '2026-11-01', endsAt: '2026-12-01', terms: '' }) && !!GD.validateOffer({ title: '할인', plan: 'monthly', discountType: 'amount', discountValue: 1000, target: 'everyone', maxRedemptions: null, startsAt: '2026-12-01', endsAt: '2026-11-01', terms: '' }));
check('F9 체육관 등록 검증: 홈페이지 형식', !!GD.validateListing({ name: '체육관', arts: ['boxing'], address: '서울 어딘가 1', region: '서울', website: 'naver.com', lat: null, lng: null, description: '', coverImageUrl: null, phone: '', sns: {}, hours: '', facilities: [], instructors: [], schedule: [], gymId: null }));

// ---------------- A. 체육관 대시보드 ----------------
console.log('\n[A] 체육관 대시보드');
const members = [
  { gymId: 'g', userId: 'own', role: 'instructor', nickname: '관장', joinedAt: '2026-09-01T00:00:00Z' },
  { gymId: 'g', userId: 's1', role: 'student', nickname: '학생1', joinedAt: '2026-09-01T00:00:00Z' },
  { gymId: 'g', userId: 's2', role: 'student', nickname: '학생2', joinedAt: '2026-11-05T00:00:00Z' },
];
const sessions = [{ id: 'x1', date: '2026-11-01', gymClassId: 'c' }, { id: 'x2', date: '2026-11-08', gymClassId: 'c' }, { id: 'x3', date: '2026-11-10', gymClassId: 'c' }];
const att = [
  { sessionId: 'x1', studentUserId: 's1', completed: true, completedAt: '2026-11-01T10:00:00Z' },
  { sessionId: 'x2', studentUserId: 's1', completed: false, completedAt: null },
  { sessionId: 'x3', studentUserId: 's2', completed: true, completedAt: '2026-11-10T10:00:00Z' },
];
const prog = new Map([['s1', { summary: { counts: { not_started: 0, learning: 3, average: 1, proficient: 2, needs_improvement: 0 }, learned: 6, training: { lastSessionAt: null } }, updatedAt: '2026-11-09' }]]);
const dash = GA.computeDashboard(members, sessions, att, prog, [{ memberId: 's1', status: 'open' }], new Date('2026-11-15T00:00:00Z'));
check('A1 전체 회원 3 · 학생 2', dash.totalMembers === 3 && dash.students === 2);
check('A2 출석률: 가입 후 열린 수업만 분모 (s1 3회 중 2, s2 2회 중 1 → 3/5 = 60%)', dash.attendanceRate === 60, dash.attendanceRate);
check('A3 수업 참여(완료)율: 출석 3건 중 완료 2건 = 67%', dash.participationRate === 67, dash.participationRate);
check('A4 기술 학습 완료율: 공유 회원 숙련 2 / 학습 6 = 33%', dash.learningCompletionRate === 33 && dash.sharedCount === 1);
check('A5 활성 회원(최근 14일 활동) 2명', dash.activeMembers === 2, dash.members.map((m) => [m.userId, m.inactiveDays]));
const dash2 = GA.computeDashboard(members, [], [], new Map(), [], new Date('2026-11-15T00:00:00Z'));
check('A6 데이터가 없으면 비율은 null (0% 로 꾸미지 않음)', dash2.attendanceRate === null && dash2.participationRate === null && dash2.learningCompletionRate === null);
check('A7 활동 기록 없는 학생은 장기 미접속 목록', dash2.inactive.length === 2);
check('A8 회원별 열린 과제 수', dash.members.find((m) => m.userId === 's1').openAssignments === 1);
const summary = GA.buildProgressSummary();
check('A9 진도 공유 요약: 기기 기록에서 생성 (원본 영상·식단 없음)', summary.version === 1 && Array.isArray(summary.techniques) && !('videos' in summary) && !('nutrition' in summary) && JSON.stringify(summary).length < 204800);

// ---------------- D. 기술 평가 (클라이언트 쪽) ----------------
console.log('\n[D] 기술 평가 항목 · 신뢰도 표시');
const migration = fs.readFileSync(path.join(APP, 'supabase/migrations/0056_technique_evaluations.sql'), 'utf8');
const allowed = migration.match(/criteria <@ array\[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map((x) => x.slice(1, -1));
check('D1 클라이언트 평가 항목 = DB 허용 목록', JSON.stringify([...EC.CRITERION_KEYS].sort()) === JSON.stringify([...allowed].sort()), { client: EC.CRITERION_KEYS, db: allowed });
check('D2 종목별 기본 템플릿이 서로 다름 (복싱 ≠ 주짓수)', JSON.stringify(EC.templateFor('boxing')) !== JSON.stringify(EC.templateFor('bjj')) && EC.templateFor('bjj').includes('grip'));
check('D3 모든 템플릿이 8개 이하·허용 항목만', Object.values(EC.TEMPLATES).every((t) => t.length <= EC.MAX_CRITERIA && t.every((k) => allowed.includes(k))));
check('D4 참여자 1~2명 = 표본 부족', EC.reliabilityOf(1).level === 'insufficient' && EC.reliabilityOf(2).level === 'insufficient' && EC.reliabilityOf(3).level === 'low' && EC.reliabilityOf(30).level === 'good');
check('D5 표본 충분해도 "공식 인증 아님" 문구', EC.reliabilityOf(50).note.includes('공식 인증이 아닙니다'));
const diff = ES.diffFromAverage({ scores: { stance: 90, timing: 40 } }, { overall: { stance: { avg: 80 }, timing: { avg: 50.5 } } });
check('D6 내 점수와 평균 차이', diff.stance === 10 && diff.timing === -10.5, diff);
check('D7 평균이 없으면 차이 null', ES.diffFromAverage({ scores: { stance: 90 } }, { overall: {} }).stance === null);
check('D8 평가 기간 판정', ES.isEvaluationOpen({ closedAt: null, closesAt: null, opensAt: '2020-01-01' }) && !ES.isEvaluationOpen({ closedAt: '2026-01-01', closesAt: null, opensAt: '2020-01-01' }) && !ES.isEvaluationOpen({ closedAt: null, closesAt: '2020-02-01', opensAt: '2020-01-01' }));

// ---------------- E. 장비 거래 입력 검증 ----------------
console.log('\n[E] 장비 거래');
const gi = { title: '16oz 글러브', category: 'boxing_gloves', martialArt: 'boxing', brand: '', size: '16oz', usageMonths: 3, condition: 'good', price: 50000, description: '', images: [], region: '서울', shippingAvailable: true, meetupAvailable: false, shippingFee: 3500 };
check('E1 정상 입력 통과', GR.validateGearInput(gi) === null);
check('E2 가격 음수·소수 거절', !!GR.validateGearInput({ ...gi, price: -1 }) && !!GR.validateGearInput({ ...gi, price: 10.5 }));
check('E3 거래 방식 하나 이상 필수', !!GR.validateGearInput({ ...gi, shippingAvailable: false, meetupAvailable: false }));
check('E4 사진 8장 초과 거절', !!GR.validateGearInput({ ...gi, images: Array(9).fill('u') }));
check('E4b 배송비 음수·소수 거절', !!GR.validateGearInput({ ...gi, shippingFee: -1 }) && !!GR.validateGearInput({ ...gi, shippingFee: 10.5 }));
check('E5 상품 카테고리 = DB 체크 목록', (() => { const sql = fs.readFileSync(path.join(APP, 'supabase/migrations/0057_gear_market.sql'), 'utf8'); const m = sql.match(/category in \(([^)]+)\)/)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1)); return JSON.stringify(m.sort()) === JSON.stringify(Object.keys(GR.GEAR_CATEGORIES).sort()); })());
const fakeFile = (type, size) => ({ type, size, name: 'a' });
check('E6 이미지 검증: 형식·8MB', CM.validateImage(fakeFile('image/png', 1000)) === null && !!CM.validateImage(fakeFile('video/mp4', 1000)) && !!CM.validateImage(fakeFile('image/png', 9 * 1024 * 1024)));
check('E7 서버 오류 문구 한국어 변환', CM.serverMessage({ message: 'self vote not allowed' }).includes('내 콘텐츠') && CM.serverMessage({ message: 'original price is not verified' }).includes('검증'));
check('E8 체육관 종목 = DB 체크 목록', (() => { const sql = fs.readFileSync(path.join(APP, 'supabase/migrations/0058_gym_directory_partnerships.sql'), 'utf8'); const m = sql.match(/arts <@ array\[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1)); return JSON.stringify(m.sort()) === JSON.stringify(Object.keys(GD.GYM_ARTS).sort()); })());

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
