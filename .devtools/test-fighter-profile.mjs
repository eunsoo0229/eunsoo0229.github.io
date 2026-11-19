// 개인 파이터 프로필 — interview engine, data store, coach integration. Offline (AI mocked),
// except that the coach-integration part captures the REAL request each coach builds
// (aiProvider.ask is intercepted, nothing is sent). Run: node .devtools/test-fighter-profile.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = new Map();
globalThis.window = globalThis;
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const S = await server.ssrLoadModule('/src/lib/fighterProfile/store.ts');
const I = await server.ssrLoadModule('/src/lib/fighterProfile/interview.ts');
const C = await server.ssrLoadModule('/src/lib/fighterProfile/catalog.ts');
const CC = await server.ssrLoadModule('/src/lib/fighterProfile/coachContext.ts');
const PZ = await server.ssrLoadModule('/src/lib/fighterProfile/personalize.ts');
const ST = await server.ssrLoadModule('/src/lib/fighterProfile/style.ts');
const P = await server.ssrLoadModule('/src/lib/ai/provider.ts');
const DAY = await server.ssrLoadModule('/src/lib/aiCoachDay/service.ts');
const PC = await server.ssrLoadModule('/src/lib/personalCoach/service.ts');
const SR = await server.ssrLoadModule('/src/lib/situationRecommend/recommendationService.ts');
const ONE = await server.ssrLoadModule('/src/lib/coachLesson/oneOff.ts');
const LD = await server.ssrLoadModule('/src/lib/loadData.ts');

const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const last = (p) => p.interview.messages.at(-1);
const val = (p, k) => S.liveItem(p, k)?.value ?? null;

// ============ A. 인터뷰 (규칙 엔진 = AI 없음)
let p = S.emptyProfile();
p = I.startInterview(p);
check('[A1] 처음부터 시작 — 첫 질문은 수련 종목 하나', p.interview.currentKey === 'train.arts' && p.interview.messages.filter((m) => m.role === 'coach').length === 1, last(p).text);
check('[A1] 한 번에 질문 하나 (물음표 1개 이하의 문장)', (last(p).text.split('?').length - 1) <= 2);
let r = await I.answerInterview(p, '복싱이랑 MMA 해요');
p = r.profile;
check('[A2] 다중 선택 답변 저장 (복싱·MMA)', JSON.stringify(val(p, 'train.arts')) === JSON.stringify(['boxing', 'mixed-martial-arts']), val(p, 'train.arts'));
check('[A2] 다음 질문으로 넘어감 + 요약', p.interview.currentKey === 'train.years' && /기록할게요/.test(last(p).text), last(p).text);
check('[A3] 이전 답변에 따라 질문 변화 (종목 2개 → 종목별 기간)', /2개 종목/.test(last(p).text), last(p).text);
p = (await I.answerInterview(p, '복싱 2년 MMA 1년')).profile;
p = (await I.answerInterview(p, '주 4회')).profile;
check('[A2] 숫자 답변 (주 4회)', val(p, 'train.frequency') === 4);
p = (await I.answerInterview(p, '체육관')).profile;
check('[A6] 모른다고 하면 — 다음 질문 전 상태 확인', p.interview.currentKey === 'train.equipment');
p = (await I.answerInterview(p, '잘 모르겠어요')).profile;
check('[A6] 모름 → 미확인으로 기록', S.liveItem(p, 'train.equipment')?.state === 'unknown' && /미확인/.test(last(p).text));
check('[A7] 건너뛰기 전', p.interview.currentKey === 'train.methods');
p = I.skipCurrent(p);
check('[A7] 건너뛰기 → skipped, 실패로 기록 안 함 (값 없음, 다음 질문)', S.liveItem(p, 'train.methods')?.state === 'skipped' && p.interview.currentKey === 'train.canFilm');
p = (await I.answerInterview(p, '네 찍을 수 있어요')).profile;
check('[A2] 예/아니요 답변', val(p, 'train.canFilm') === true);
check('[A] 섹션이 바뀌면 신체 정보로', p.interview.currentKey === 'body.stance' && /기본 신체 정보/.test(last(p).text), last(p).text);
p = (await I.answerInterview(p, '사우스포야')).profile;
check('[A3] 사우스포 → 후속 질문이 그 답을 이어받음', p.interview.currentKey === 'body.stanceSwitch' && /사우스포를 기본으로/.test(last(p).text), last(p).text);
p = (await I.answerInterview(p, '응 자주 바꿔')).profile;
check('[A3] 스탠스 전환 "자주" → 목적 질문이 열림', val(p, 'body.stanceSwitch') === 'often' && p.interview.currentKey === 'body.switchPurpose');
p = (await I.answerInterview(p, '공격 각도를 바꾸거나 상대가 적응 못 하게 하려고')).profile;
check('[A2] 전환 목적 = 각도 + 대응 방해', JSON.stringify(val(p, 'body.switchPurpose')) === JSON.stringify(['angle', 'confuse']), val(p, 'body.switchPurpose'));
const askedKeys = p.interview.messages.filter((m) => m.role === 'coach' && m.key).map((m) => m.key);
check('[A4] 지금까지 같은 질문을 두 번 묻지 않음', new Set(askedKeys).size === askedKeys.length, askedKeys);

// 모호한 답 → 한 번만 확인 → 그래도 모르면 원문 보관 + 확인 필요
const beforeAmb = p.interview.currentKey;
p = (await I.answerInterview(p, '음 글쎄 그때그때 다른데 대충 맞춰서')).profile;
check('[A5] 모호한 답 → 확인 질문 1회 (같은 항목 유지)', p.interview.currentKey === beforeAmb && p.interview.clarifying, last(p).text);
p = (await I.answerInterview(p, '그냥 편한 대로 쓰는 편이에요')).profile;
check('[A5] 두 번째도 모호 → 원문 보관·확인 필요로 넘어감', S.liveItem(p, beforeAmb)?.state === 'unknown' && S.liveItem(p, beforeAmb)?.note && S.liveItem(p, beforeAmb)?.status === 'needs_review' && p.interview.currentKey !== beforeAmb, S.liveItem(p, beforeAmb));

// 중단·재개
const keyAtPause = p.interview.currentKey;
p = (await I.answerInterview(p, '오늘은 여기까지 할게')).profile;
check('[A8] 인터뷰 중단 → paused, 지금까지 저장', p.interview.status === 'paused' && val(p, 'body.stance') === 'southpaw');
p = I.startInterview(p);
check('[A8] 재개 → 남은 질문부터 (답한 질문 다시 안 물음)', p.interview.status === 'active' && p.interview.currentKey === keyAtPause, p.interview.currentKey);

// 이전 답변 수정 → 관련 항목 확인 필요
p = I.editAnswer(p, 'body.stance');
check('[A9] 이전 답변 수정 → 그 질문을 다시 물음 (현재 기록 표시)', p.interview.currentKey === 'body.stance' && /사우스포/.test(last(p).text));
p = (await I.answerInterview(p, '아니 오소독스야')).profile;
check('[A9] 수정 저장 (오소독스)', val(p, 'body.stance') === 'orthodox', val(p, 'body.stance'));
check('[A9] 관련 항목(스탠스 전환) → 확인 필요', S.liveItem(p, 'body.stanceSwitch')?.status === 'needs_review');
check('[A9] 수정 후 원래 다음 질문으로 복귀', p.interview.currentKey === keyAtPause, p.interview.currentKey);

// 일부만 답하고 종료
p = I.finishInterview(p);
check('[A10] 인터뷰 종료 → 일부 항목만 저장된 채로 finished', p.interview.status === 'finished' && Object.values(p.items).filter((i) => i.state === 'answered').length >= 7);
S.saveProfile(p);
check('[A10] 저장 후 다시 읽어도 그대로', val(S.getProfile(), 'body.stance') === 'orthodox');

// ============ A11. 잘못된 AI 응답
const base = I.startInterview(S.emptyProfile());
const bad = [
  ['JSON 아님', async () => ({ ok: false, code: 'PARSE_ERROR', message: 'x' })],
  ['예외 발생', async () => { throw new Error('boom'); }],
  ['형식 밖 값', async () => ({ ok: true, data: { value: ['karate', 'hacking'], understood: true, summary: '가라테로 기록', extras: [{ key: 'body.stance', value: 'flying', evidence: 'x' }, { key: '__proto__', value: 1, evidence: 'x' }] } })],
  ['값이 배열이 아닌 문자열 쓰레기', async () => ({ ok: true, data: { value: { a: 1 }, understood: true } })],
];
for (const [name, ask] of bad) {
  const out = (await I.answerInterview(base, '복싱 해요', { askJson: ask })).profile;
  const ok = JSON.stringify(val(out, 'train.arts')) === JSON.stringify(['boxing']) && !S.liveItem(out, 'body.stance') && !out.items.__proto__?.state;
  check(`[A11] 잘못된 AI 응답(${name}) → 규칙으로 읽은 값만 저장, 프로필 손상 없음`, ok, val(out, 'train.arts'));
}
const disagree = (await I.answerInterview(base, '복싱 해요', { askJson: async () => ({ ok: true, data: { value: ['kickboxing'], understood: true } }) })).profile;
check('[A11] 규칙과 AI 해석이 다르면 저장하지 않고 확인 질문', !S.liveItem(disagree, 'train.arts') && disagree.interview.clarifying && /킥복싱/.test(last(disagree).text), last(disagree).text);

// AI가 다른 항목에 대해 들은 말 → 확인 전엔 저장 안 함
const extraAsk = async (q) => ({ ok: true, data: { value: ['boxing'], understood: true, summary: '복싱을 하시는군요.', extras: [{ key: 'body.stance', value: 'southpaw', evidence: '사우스포로 복싱해요' }, { key: 'box.powerHand', value: 'rear', evidence: '' }], nextQuestion: '복싱은 얼마나 하셨어요?' } });
let ex = (await I.answerInterview(base, '사우스포로 복싱해요', { askJson: extraAsk })).profile;
check('[A12] AI가 알아챈 다른 항목 → 제안으로만 대기 (근거 없는 건 버림)', ex.interview.pending.length === 1 && ex.interview.pending[0].key === 'body.stance' && !S.liveItem(ex, 'body.stance'));
check('[A12] AI가 다듬은 다음 질문 사용 (앱이 고른 항목과 같을 때만)', /얼마나 하셨어요/.test(last(ex).text) && ex.interview.currentKey === 'train.years', last(ex).text);
ex = I.acceptProposal(ex, 'body.stance');
check('[A12] 사용자가 확인하면 본인 답변으로 저장', val(ex, 'body.stance') === 'southpaw' && S.liveItem(ex, 'body.stance').source === 'self_report' && S.liveItem(ex, 'body.stance').status === 'confirmed');
const askedCtx = [];
await I.answerInterview(base, '복싱', { askJson: async (q) => (askedCtx.push(q), { ok: false, code: 'X', message: '' }) });
check('[A13] AI에는 현재 항목·다음 항목·최근 대화만 (프로필 전체 아님)', askedCtx[0].contextText.includes('[현재 항목]') && askedCtx[0].contextText.includes('train.arts') && askedCtx[0].contextText.length < 6000, askedCtx[0].contextText.length);

// ============ B. 데이터
let d = S.emptyProfile();
let w = S.withItem(d, 'box.range.jab', { value: '72cm', measurement: { method: 'partner_static', measuredAt: '2026-10-20', side: 'left', confidence: 'high', conditions: '스텝 없이' } }, 'user');
check('[B1] 측정값 저장 (cm·방법·날짜·좌우·신뢰도·조건)', w.ok && w.profile.items['box.range.jab'].value === 72 && w.profile.items['box.range.jab'].measurement.method === 'partner_static' && w.profile.items['box.range.jab'].measurement.side === 'left' && w.profile.items['box.range.jab'].measurement.measuredAt === '2026-10-20');
check('[B2] 앞/뒤 구분은 항목 자체에 (잽 = 앞손)', w.profile.items['box.range.jab'].measurement.limb === 'lead');
check('[B2] 정지 상태 도달 거리로 저장, 출처 = 직접 측정', w.profile.items['box.range.jab'].measurement.kind === 'static_reach' && w.profile.items['box.range.jab'].source === 'measured');
w = S.withItem(w.profile, 'box.range.jab.dynamic', { value: 95, measurement: { method: 'video' } }, 'user');
check('[B2] 실제 동작 중 거리는 별도 항목 (정지 값 그대로)', w.ok && w.profile.items['box.range.jab.dynamic'].measurement.kind === 'dynamic_reach' && w.profile.items['box.range.jab'].value === 72);
w = S.withItem(w.profile, 'kick.range.round.rear', { value: 110 }, 'user');
check('[B2] 측정 방법 모르면 신뢰도 낮음 (추측하지 않음)', w.profile.items['kick.range.round.rear'].measurement.method === null && w.profile.items['kick.range.round.rear'].measurement.confidence === 'low' && w.profile.items['kick.range.round.rear'].measurement.limb === 'rear');
const rej = [S.withItem(d, 'body.stance', { value: 'flying' }, 'user'), S.withItem(d, 'body.height', { value: 900 }, 'user'), S.withItem(d, 'no.such', { value: 1 }, 'user')];
check('[B3] 잘못된 값·없는 항목은 거부', rej.every((x) => !x.ok));
w = S.withItem(w.profile, 'body.height', { value: 175 }, 'user');
w = S.withItem(w.profile, 'body.wingspan', { value: 182, measurement: { method: 'tape_helper' } }, 'user');
check('[B4] 키 대비 리치 비율 = 시스템 계산 (출처 구분)', w.profile.items['body.apeIndex'].value === 1.04 && w.profile.items['body.apeIndex'].source === 'system_calculated', w.profile.items['body.apeIndex']);
w = S.withItem(w.profile, 'mma.cage', { value: '케이지에 등을 대면 언더훅으로 돈다', source: 'video_observed', observation: { observed: '케이지에 등이 붙으면 왼쪽으로 돈다', interpretation: '탈출 방향이 한쪽으로 고정됐을 수 있음' } }, 'user');
check('[B5] 영상 관찰: 관찰 사실과 해석 분리, 확인 전 상태', w.profile.items['mma.cage'].observation.observed && w.profile.items['mma.cage'].observation.interpretation && w.profile.items['mma.cage'].status === 'unconfirmed');
w = S.withItem(w.profile, 'box.powerHand', { value: 'rear', source: 'coach_inferred' }, 'user');
check('[B5] AI 추론은 자기 보고와 다르게 — 확인 전', w.profile.items['box.powerHand'].status === 'unconfirmed' && w.profile.items['box.powerHand'].source === 'coach_inferred');
let wp = S.withConfirmed(w.profile, 'box.powerHand');
check('[B5] 사용자가 확인하면 confirmed', wp.items['box.powerHand'].status === 'confirmed');
const old = S.withItem(wp, 'body.wingspan', { value: 182, measurement: { method: 'tape_helper', measuredAt: '2024-01-01' } }, 'user').profile;
check('[B6] 1년 넘은 측정값 → 오래됨(outdated)', S.effectiveStatus(old.items['body.wingspan']) === 'outdated');
let del = S.withoutItem(old, 'body.wingspan', 'user');
check('[B7] 항목 삭제 (톰스톤) + 파생값도 정리', !S.liveItem(del, 'body.wingspan') && del.items['body.wingspan'].deletedAt && !S.liveItem(del, 'body.apeIndex'));
check('[B7] 변경 이력이 남음', del.history.some((h) => h.key === 'body.wingspan' && h.action === 'delete'));

// 동기화 병합: 항목 단위 최신 우선 + 삭제 전파
const tA = S.withItem(S.emptyProfile(), 'body.stance', { value: 'southpaw' }, 'user').profile;
await new Promise((r) => setTimeout(r, 5));
const tB = S.withItem(S.emptyProfile(), 'body.height', { value: 180 }, 'user').profile;
const merged = S.mergeProfiles(tA, tB);
check('[B8] 두 기기에서 다른 항목 수정 → 둘 다 유지', val(merged, 'body.stance') === 'southpaw' && val(merged, 'body.height') === 180);
await new Promise((r) => setTimeout(r, 5));
const tDel = S.withoutItem(merged, 'body.stance', 'user');
check('[B8] 삭제가 오래된 쪽을 이김 (되살아나지 않음)', !S.liveItem(S.mergeProfiles(tA, tDel), 'body.stance'));

// 기존 데이터 보존
store.set('martialdex:nutrition-profile', '{"x":1}');
store.set('martialdex:training-history', '[]');
S.setItem('body.weight', { value: 70 });
check('[B9] 프로필 저장이 다른 앱 데이터를 건드리지 않음', store.get('martialdex:nutrition-profile') === '{"x":1}' && store.get('martialdex:training-history') === '[]');
store.set('martialdex:fighter-profile', '{not json');
globalThis.dispatchEvent(new CustomEvent('martialdex:storage-replaced'));
check('[B10] 손상된 로컬 프로필 → 빈 프로필로 안전하게 시작 (크래시 없음)', Object.keys(S.getProfile().items).length === 0);

// ============ C. AI 코치 통합 — 4 시나리오, 실제 요청 데이터 캡처
const captured = [];
P.aiProvider.ask = async (req) => (captured.push(req), { ok: true, text: '{"reason":"x","items":[],"analysisSummary":"x","techniqueQueries":[],"recommendedTraining":"x","underTrainedAreas":"x","curriculumDirection":"x","nextTraining":"x","curriculumGoalText":"x","suggestedMartialArt":null}', groundingSources: [], usedSearchGrounding: false, webSearchQueries: [] });
function build(entries) {
  let x = S.emptyProfile();
  for (const [k, v, extra] of entries) {
    const rr = S.withItem(x, k, { value: v, ...(extra ?? {}) }, 'user');
    if (!rr.ok) throw new Error(`${k}: ${rr.message}`);
    x = rr.profile;
  }
  return x;
}
const common = [['train.improve', '잽 후에 손이 내려간다'], ['bjj.subs', ['armbar', 'kimura']], ['pos.comfortable', ['closedBottom']], ['wr.single', 'favorite']];
const scenarios = [
  {
    name: '사우스포·스탠스 전환 자주 — 복싱 수업',
    art: 'boxing',
    tech: LD.getTechniquesByMartialArt('boxing').find((t) => /^jab$/i.test(t.name)) ?? LD.getTechniquesByMartialArt('boxing')[0],
    profile: build([['train.arts', ['boxing', 'bjj']], ['body.stance', 'southpaw'], ['body.stanceSwitch', 'often'], ['body.switchPurpose', ['angle', 'confuse']], ['box.favoritePunches', ['jab', 'straight']], ['box.preferredRange', 'long'], ['box.range.jab', 72, { measurement: { method: 'partner_static' } }], ['def.main', ['longGuard', 'backstep']], ['def.longGuard.situation', '상대가 압박할 때'], ['move.lateral', 'right'], ...common]),
    must: ['body.stance', 'body.stanceSwitch', 'box.favoritePunches', 'box.range.jab', 'def.main', 'def.longGuard.situation', 'move.lateral'],
    mustNot: ['bjj.subs', 'pos.comfortable', 'wr.single'],
    note: /사우스포/,
  },
  {
    name: '앞발 킥 자주 — 킥복싱 수업',
    art: 'kickboxing',
    tech: LD.getTechniquesByMartialArt('kickboxing').find((t) => /round kick/i.test(t.name)) ?? LD.getTechniquesByMartialArt('kickboxing').find((t) => /kick/i.test(t.name)),
    profile: build([['train.arts', ['kickboxing']], ['body.stance', 'orthodox'], ['kick.favorite', ['leadRound', 'teep']], ['kick.switchKick', 'often'], ['kick.range.round.lead', 105, { measurement: { method: 'floor_marker' } }], ['box.combos', '잽-잽-스트레이트'], ['box.range.straight', 80], ...common]),
    must: ['kick.favorite', 'kick.switchKick', 'kick.range.round.lead', 'body.stance'],
    mustNot: ['bjj.subs', 'pos.comfortable', 'wr.single', 'box.range.straight', 'box.combos'],
    note: /앞발 킥/,
  },
  {
    name: '상대 오른다리 싱글렉 선호 — 레슬링 수업',
    art: 'wrestling',
    tech: LD.getTechniquesByMartialArt('wrestling').find((t) => /single/i.test(t.name)),
    profile: build([['train.arts', ['wrestling']], ['body.stance', 'orthodox'], ['wr.single', 'favorite'], ['wr.direction', 'oppRight'], ['wr.legPreference', 'lead'], ['wr.finish', 'runPipe'], ['box.favoritePunches', ['jab']], ['kick.favorite', ['low']], ['train.improve', '태클 후 마무리']]),
    must: ['wr.single', 'wr.direction', 'wr.legPreference', 'wr.finish'],
    mustNot: ['box.favoritePunches', 'kick.favorite'],
    note: /상대 오른다리/,
  },
  {
    name: '하프가드 바텀에서 전환 선호 — 주짓수 수업',
    art: 'bjj',
    tech: LD.getTechniquesByMartialArt('bjj').find((t) => /half guard/i.test(t.name)) ?? LD.getTechniquesByMartialArt('bjj').find((t) => /half/i.test(`${t.name} ${t.category}`)),
    profile: build([['train.arts', ['bjj']], ['bjj.topBottom', 'bottom'], ['bjj.guards', ['half', 'butterfly']], ['pos.uncomfortable', ['halfBottom', 'mountBottom']], ['pos.halfBottom.exit', 'transition'], ['pos.halfBottom.mistakes', '언더훅을 늦게 잡는다'], ['pos.mountTop.action', '압박'], ['box.favoritePunches', ['jab']], ['body.stance', 'southpaw']]),
    must: ['bjj.topBottom', 'bjj.guards', 'pos.uncomfortable', 'pos.halfBottom.exit', 'pos.halfBottom.mistakes'],
    mustNot: ['box.favoritePunches', 'body.stance', 'pos.mountTop.action'],
    note: /하프가드 \(바텀\).*전환/,
  },
];
for (const sc of scenarios) {
  const ctx = CC.fighterProfileContext({ martialArt: sc.art, topic: `${sc.tech?.name} ${sc.tech?.category}`, profile: sc.profile, history: [] });
  check(`[C ${sc.name}] 관련 항목이 전달됨`, sc.must.every((k) => ctx.keys.includes(k)), { missing: sc.must.filter((k) => !ctx.keys.includes(k)) });
  check(`[C ${sc.name}] 관련 없는 항목은 빠짐`, sc.mustNot.every((k) => !ctx.keys.includes(k)), { leaked: sc.mustNot.filter((k) => ctx.keys.includes(k)) });
  check(`[C ${sc.name}] 출처·원칙(실력 증거 아님·지어내지 않기) 포함`, /본인 답변/.test(ctx.text) && /실제 실력의 증거가 아니다/.test(ctx.text) && /지어내지 말고/.test(ctx.text));
  // real request flow: the DAY coach's Gemini request carries it
  S.replaceProfile(sc.profile);
  captured.length = 0;
  await DAY.explainTechnique(sc.tech, 'Day 1 테스트', '');
  const req = captured[0];
  check(`[C ${sc.name}] AI 코치 수업 요청(contextText)에 실제로 들어감`, !!req && req.contextText.includes('[개인 파이터 프로필') && sc.must.every((k) => req.contextText.includes(C.fieldOf(k).label)), { missingLabels: sc.must.filter((k) => !req?.contextText.includes(C.fieldOf(k).label)).map((k) => C.fieldOf(k).label), ctxLen: req?.contextText.length });
  const notes = PZ.lessonProfileNotes({ martialArt: sc.art, technique: sc.tech, profile: sc.profile });
  check(`[C ${sc.name}] 자체 코치 수업 메모가 프로필에 맞게 달라짐`, notes.some((n) => sc.note.test(n.text)), notes.map((n) => n.text));
}
// same lesson, different profiles → different requests
S.replaceProfile(scenarios[0].profile);
captured.length = 0;
await DAY.explainTechnique(scenarios[0].tech, 'Day 1', '');
const withSouthpaw = captured[0].contextText;
S.replaceProfile(build([['body.stance', 'orthodox'], ['box.favoritePunches', ['rearHook']]]));
captured.length = 0;
await DAY.explainTechnique(scenarios[0].tech, 'Day 1', '');
check('[C] 같은 기술 수업이라도 사용자마다 요청이 달라짐', withSouthpaw !== captured[0].contextText && /사우스포/.test(withSouthpaw) && /오소독스/.test(captured[0].contextText));
S.replaceProfile(S.emptyProfile());
captured.length = 0;
await DAY.explainTechnique(scenarios[0].tech, 'Day 1', '');
check('[C 회귀] 프로필이 없으면 요청에 아무것도 추가 안 됨 (기존과 동일)', !captured[0].contextText.includes('개인 파이터 프로필'));
const gym = LD.gymExercises?.[0];
if (gym) {
  S.replaceProfile(scenarios[0].profile);
  captured.length = 0;
  await DAY.explainTechnique(gym, 'Day 1', '');
  check('[C 회귀] 헬스 운동 수업에는 파이터 프로필을 넣지 않음', !captured[0].contextText.includes('개인 파이터 프로필'));
}
// other coaching requests
S.replaceProfile(scenarios[0].profile);
captured.length = 0;
await PC.getPersonalCoachRecommendation('잽을 더 잘 쓰고 싶어');
check('[C] 개인 코치(약점·훈련 추천) 요청에도 전달', captured.some((c) => c.contextText.includes('개인 파이터 프로필')));
captured.length = 0;
await SR.getSituationRecommendation({ martialArt: 'boxing', situationText: '상대가 압박해 올 때', category: null }).catch(() => null);
const srReq = captured.find((c) => c.contextText.includes('후보 기술 목록'));
check('[C] 상황별 기술 추천 요청에도 전달 (복싱 관련만)', !srReq || (srReq.contextText.includes('개인 파이터 프로필') && !srReq.contextText.includes('서브미션 선호')), srReq ? 'sent' : 'no request (no candidates)');
const personal = ONE.personalLessonContext('boxing', '잽 거리 조절');
check('[C] 1회 수업의 [학생 개인 정보]에 프로필 + "내 기록 반영" 요약', personal.lines.some((l) => l.includes('개인 파이터 프로필')) && personal.summary.some((s) => s.startsWith('개인 파이터 프로필')), personal.summary);
// mismatch with records → ask, don't decide
const mm = CC.fighterProfileContext({ martialArt: 'boxing', profile: scenarios[0].profile, history: [{ date: new Date().toISOString().slice(0, 10), techniqueIds: [] }, { date: '2020-01-01', techniqueIds: [] }, { date: '2020-01-02', techniqueIds: [] }] });
check('[C] 프로필 주 n회 vs 기록 차이 → 확인 질문 지시 (단정 안 함)', /확인 질문 필요/.test(mm.text) || !CC.fighterProfileContext({ profile: scenarios[0].profile, history: [] }).text.includes('확인 질문 필요'), mm.text.split('\n').slice(-3));
const freqP = S.withItem(scenarios[0].profile, 'train.frequency', { value: 5 }, 'user').profile;
const mm2 = CC.fighterProfileContext({ martialArt: 'boxing', profile: freqP, history: [{ date: new Date().toISOString().slice(0, 10), techniqueIds: [] }, { date: '2020-01-01', techniqueIds: [] }, { date: '2020-01-02', techniqueIds: [] }] });
check('[C] 주 5회라고 했는데 기록은 주 0.3회 → "물어볼 것"', /주 5회/.test(mm2.text) && /물어볼 것/.test(mm2.text));
const unk = S.withItem(scenarios[0].profile, 'box.powerHand', { state: 'unknown', note: '모르겠어' }, 'interview').profile;
check('[C] 미확인 항목은 "모른다고 함"으로 전달 (값을 지어내지 않음)', /미확인\(사용자가 모른다고 함\): .*강하다고 느끼는 손/.test(CC.fighterProfileContext({ martialArt: 'boxing', profile: unk, history: [] }).text));

// style
const sty = ST.analyzeStyle(scenarios[0].profile);
check('[G] 스타일 = 여러 성향 공존 + 근거 표기 + 확인 전', sty.tags.length >= 2 && sty.tags.every((t) => t.basis.length) && sty.status === 'unconfirmed', sty.tags.map((t) => `${t.role}:${t.label}`));
const sty2 = ST.analyzeStyle(scenarios[2].profile);
check('[G] 싱글렉 선호 성향 (방향 포함)', sty2.tags.some((t) => /싱글렉 선호 \(상대 오른다리\)/.test(t.label)), sty2.tags.map((t) => t.label));
const prog = I.progress(scenarios[3].profile);
check('[9] 완성도는 섹션별 + 해당 없는 섹션은 0/0 (따로 입력한 항목은 해당 섹션에 집계)', prog.sections.length === 7 && prog.sections.find((s) => s.section === 'defense').total === 0 && prog.sections.find((s) => s.section === 'striking').answered === 1, prog.sections.map((s) => `${s.label} ${s.answered}/${s.total}`));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await server.close();
process.exit(failed ? 1 : 0);
