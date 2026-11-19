// 자체 AI 코치 — 독립 검증 세트 (5차). Written and FROZEN before the 5th-round changes; its sha256 is
// recorded in the report. It was NOT run while the coach was being changed — the first run is the result.
// Expected answers come from the technique data and the app's real features, not from the coach's code.
//   categories: 구어/오타/혼합 이름 · 여러 턴 · 상황 추천 · 사용자 데이터 수업 · 미트 선택 · 자료 없음 ·
//               일반 낱말 오인식 · 근거 없는 내용 · AI 호출 0
// Run: node .devtools/test-coach-validation.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-validation-'));
const out = path.join(dir, 'v.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as Q from ${mod('src/lib/coachKnowledge/questions.ts')};`,
    `export * as F from ${mod('src/lib/coachKnowledge/featureCatalog.ts')};`,
    `export { buildLocalOneOffLesson } from ${mod('src/lib/coachLesson/oneOff.ts')};`,
    `export { oneOffPractice } from ${mod('src/lib/coachLesson/oneOffMitt.ts')};`,
    `export { resolveTechnique, getUnifiedAllTechniques } from ${mod('src/lib/userTechniques/service.ts')};`,
    `export { canonicalTechniqueId } from ${mod('src/lib/techniqueCanonical/index.ts')};`,
    `export { saveLessonLog } from ${mod('src/lib/coachLesson/lessonLog.ts')};`,
    `export { recordTrainingSession } from ${mod('src/lib/trainingHistory/service.ts')};`,
    `export { martialArtSummaries } from ${mod('src/lib/loadData.ts')};`,
    `export { motionForTechnique } from ${mod('src/lib/visualMitt/archetypes.ts')};`,
  ].join('\n')
);
const calls = { gemini: 0, local: 0 };
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {},
  location: { href: 'http://localhost/', search: '', hash: '', reload() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: { askAi: async () => (calls.gemini++, { ok: false, code: 'X', message: 'no' }), localAi: { status: async () => ({ ok: true, running: true, model: 'f', models: ['f'], reason: null }), ask: async () => (calls.local++, { ok: true, text: 'x', model: 'f', evalCount: 1, ms: 1 }) } },
};
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const K = await import(pathToFileURL(out).href);
const { Q, F } = K;
const T = (id) => K.resolveTechnique(id);
const canon = (id) => K.canonicalTechniqueId(id);

// ---- the same invented-word rule as the earlier evals (template vocabulary = the coach code's Hangul words)
const tok = (s) => (s.normalize('NFKC').toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g) ?? []).map((w) => w.replace(/(으로|에서|에게|까지|부터|이랑|하고|해서|하면|하는|하기|합니다|입니다|습니다|을|를|이|가|은|는|에|의|로|와|과|도|만|요)$/, '')).filter((w) => w.length >= 2);
const templateVocab = new Set();
for (const f of fs.readdirSync(path.join(APP, 'src/lib/coachKnowledge'))) {
  const code = fs.readFileSync(path.join(APP, 'src/lib/coachKnowledge', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/ .*$/gm, ' ');
  for (const w of tok(code)) templateVocab.add(w);
}
for (const a of K.martialArtSummaries) for (const w of tok(`${a.nameKo} ${a.nameEn ?? ''} ${a.id}`)) templateVocab.add(w);
const dataText = (t) => { const p = t.posture ?? {}; return [t.name, t.koreanName ?? '', ...t.aliases, t.category, t.description, t.purpose ?? '', ...t.positions, ...t.principles, t.difficulty ?? '', p.overview ?? '', p.startingPosition ?? '', ...(p.steps ?? []), ...(p.keyPoints ?? []), ...(p.commonMistakes ?? []), ...Object.values(p.bodyPosition ?? {})].join(' '); };
const covered = (w, pool) => pool.some((p) => p.includes(w) || (w.length >= 3 && w.includes(p) && p.length >= 2));
const invented = (answer, question, ts) => { const pool = [...new Set([...tok(question), ...ts.flatMap((t) => tok(dataText(t)))])]; return [...new Set(tok(answer))].filter((w) => !templateVocab.has(w) && !covered(w, pool)); };
const techsOf = (a) => (a.techniqueIds ?? []).map(T).filter(Boolean);

const results = [];
function check(cat, failType, name, pass, detail = '') {
  results.push({ cat, failType: pass ? null : failType, name, pass });
  if (!pass || process.env.VERBOSE) console.log((pass ? 'PASS' : 'FAIL') + ` — [${cat}] ${name}` + (detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 260) : ''));
}
const ask = async (cur, q, ctx) => { try { return await Q.answerCoachQuestion(cur, q, { useModel: false, context: ctx }); } catch (e) { return { kind: 'error', text: String(e), techniqueIds: [] }; } };
const about = (a, id) => (a.techniqueIds ?? []).some((x) => canon(x) === canon(id));
const firstOf = (id, field) => (T(id)?.posture?.[field] ?? [])[0] ?? null;
const contains = (text, s) => !!s && text.includes(s.slice(0, Math.min(16, s.length)));

// =============================================================== 1. 구어·오타·혼합 이름 (target + requested field from the data)
const NAMES = [
  ['크로스 칠 때 젤 중요한 게 뭐임', 'kickboxing__cross', 'keyPoints'],
  ['로우킥 차는 법 좀 ㅠ', 'kickboxing__low-kick', 'steps'],
  ['rear naked choke 할 때 실수 머 있음?', 'bjj__rear-naked-choke', 'commonMistakes'],
  ['트라이앵글초크 핵심', 'bjj__triangle-choke', 'keyPoints'],
  ['기무라 말고 키무라 할 때 조심할 거', 'bjj__kimura', 'commonMistakes'],
  ['더블 레그 테이크다운 어케 들어가?', 'wrestling__basic-double-leg', 'steps'],
  ['osoto gari 포인트', 'judo__osoto-gari', 'keyPoints'],
  ['스프롤 할때 많이 하는 실수', 'wrestling__sprawl', 'commonMistakes'],
  ['길로틴 초크 순서', 'bjj__guillotine', 'steps'],
  ['티프 어떻게 차요', 'kickboxing__teep', 'steps'],
];
for (const [q, id, field] of NAMES) {
  const a = await ask(null, q);
  const ok = about(a, id) && (a.kind !== 'single' || contains(a.text, firstOf(id, field)));
  check('구어·이름', ok ? null : about(a, id) ? '필드 누락' : '기술 식별', `"${q}" → ${id} ${field}`, ok, { kind: a.kind, ids: a.techniqueIds, text: a.text.slice(0, 120) });
}
// typos: either the right technique or an honest "which one?" — never another technique
const TYPOS = [
  ['더블래그 어떻게 해', 'wrestling__basic-double-leg'],
  ['암바ㅏ 핵심 알려줘', 'bjj__armbar'],
  ['쨉 어케 쳐', 'kickboxing__jab'],
  ['트라이엥글 초크 실수', 'bjj__triangle-choke'],
];
for (const [q, id] of TYPOS) {
  const a = await ask(null, q);
  const ids = a.techniqueIds ?? [];
  const ok = (ids.length === 0 && a.kind !== 'single') || ids.some((x) => canon(x) === canon(id));
  check('구어·이름', '오타→다른 기술', `"${q}" (오타) → 맞는 기술이거나 되묻기`, ok, { kind: a.kind, ids, text: a.text.slice(0, 100) });
}

// =============================================================== 2. 일반 낱말이 기술로 오인되지 않음
const COMMON = ['오늘 기분이 별로야', '말 좀 해봐', '배가 고파서 운동 못 하겠어', '그냥 아무거나 추천해줘', '줄 서서 기다리는 중', '오늘 힘이 하나도 없어', '덕분에 많이 늘었어', '무슨 뜻이야?'];
for (const q of COMMON) {
  const a = await ask(null, q);
  check('오인식', '일반 낱말→기술', `"${q}" → 기술로 확정하지 않음`, (a.techniqueIds ?? []).length === 0 || a.kind === 'next' || a.kind === 'review' || a.kind === 'records', { kind: a.kind, ids: a.techniqueIds, text: a.text.slice(0, 100) });
}

// =============================================================== 3. 여러 턴
{
  const steps = [['오소토가리 설명해줘', 'judo__osoto-gari'], ['그럼 실수는?', 'judo__osoto-gari'], ['다리는 어떻게 써?', 'judo__osoto-gari']];
  let ctx;
  let ok = true;
  for (const [q, id] of steps) {
    const a = await ask(null, q, ctx);
    ctx = a.context;
    if (!about(a, id)) ok = false;
  }
  check('여러 턴', '문맥 유실', '오소토가리 설명 → "그럼 실수는?" → "다리는 어떻게 써?" 같은 기술 유지', ok);
}
{
  let a = await ask(null, '티프 알려줘');
  a = await ask(null, '그거랑 프론트킥은 뭐가 달라?', a.context);
  check('여러 턴', '문맥 유실', '"티프 알려줘" → "그거랑 프론트킥은 뭐가 달라?" → 두 기술 비교', a.kind === 'compare' && about(a, 'kickboxing__teep'), { kind: a.kind, ids: a.techniqueIds });
}
{
  let a = await ask(null, '클린치에서 쓸 수 있는 기술 있어?');
  const listed = a.techniqueIds ?? [];
  a = await ask(null, '그거 연습하고 싶어', a.context);
  check('여러 턴', '임의 선택', '여러 기술을 추천한 뒤 "그거" → 임의로 고르지 않음', listed.length < 2 || a.kind === 'ambiguous' || a.kind === 'no_technique', { listed: listed.length, kind: a.kind });
}
{
  let ctx = Q.EMPTY_DIALOG;
  let a = await ask(null, '훅 어떻게 쳐?', ctx);
  ctx = a.context;
  const act = F.planCoachAction('그거 미트로 할래', { current: ctx?.focusId ? T(ctx.focusId) : null, camera: true });
  check('여러 턴', '문맥 유실', '"훅 어떻게 쳐?" → "그거 미트로 할래" → 훅을 미트로', !!act?.ok && /combo=single/.test(act.route) && /hook/i.test(decodeURIComponent(act.route)), act);
}

// =============================================================== 4. 상황 추천 (grounded: every listed technique's own data mentions it)
const SIT = [
  ['상대가 자꾸 싱글렉 들어와', ['싱글', 'single', '테이크다운', 'takedown', '태클']],
  ['니킥 계속 맞는데 어떡하지', ['니킥', '니 킥', 'knee', '무릎']],
  ['상대가 너무 붙어서 펀치를 못 치겠어', ['거리', '클린치', '붙', '근접', '인사이드', 'range', 'clinch']],
  ['사이드에 깔렸을 때 탈출하는 법', ['사이드', 'side']],
  ['백 마운트 당했어 빠져나가는 방법', ['백', 'back']],
  ['프론트킥 막는 방법', ['프론트킥', '프론트 킥', 'front kick', '킥', 'kick', '티프', 'teep']],
  ['상대 오버핸드 대처법', ['오버핸드', 'overhand', '훅', '펀치']],
  ['케이지 벽에 자꾸 몰려', ['케이지', '펜스', 'cage', '벽']],
];
for (const [q, terms] of SIT) {
  const a = await ask(null, q);
  const ts = techsOf(a);
  const grounded = ts.every((t) => terms.some((w) => dataText(t).toLowerCase().includes(w.toLowerCase())));
  const honestNone = ts.length === 0 && /찾지 못했습니다|없습니다|기록되어 있지 않/.test(a.text);
  const inv = invented(a.text, q, ts);
  const ok = ((ts.length > 0 && grounded) || honestNone) && inv.length === 0 && a.kind !== 'no_technique';
  check('상황', !grounded ? '관련 없는 기술' : inv.length ? '근거 없는 내용' : '처리 못 함', `"${q}"`, ok, { kind: a.kind, ids: a.techniqueIds?.slice(0, 5), inv, text: a.text.slice(0, 140) });
}
// a related-but-not-direct technique must not be presented as a direct counter
{
  const a = await ask(null, '트라이앵글 초크 걸리면 어떻게 빠져?');
  const direct = /직접|자료에 .*(막|탈출|빠져)/.test(a.text);
  const relatedOnly = /직접 막는 방법이라는 뜻은 아닙니다|관련 기술|같은 (포지션|분류)/.test(a.text);
  check('상황', '관련을 직접 대응처럼 제시', '"트라이앵글 초크 걸리면 어떻게 빠져?" → 직접 대응이 없으면 관련 기술임을 밝힘', /찾지 못했습니다|없습니다/.test(a.text) || relatedOnly || direct, a.text.slice(0, 200));
}

// =============================================================== 5. 자료 없는 질문 (refuse, no numbers / guarantees)
const NODATA = ['훅 칠 때 몇 kg 힘이 들어가?', '스프롤 하면 무릎에 안 좋아?', '기무라는 왜 이름이 기무라야?', '오소토가리 올림픽에서 몇 번 나왔어?', '로우킥 맞고 다리 멍들면 언제 나아?'];
for (const q of NODATA) {
  const a = await ask(null, q);
  const ts = techsOf(a);
  const ok = /없습니다|찾지 못했습니다|확인되지 않|추측하지 않/.test(a.text) && !/\d+\s*(kg|킬로|번|일|%)/.test(a.text) && !/괜찮습니다|안전합니다|문제없/.test(a.text) && invented(a.text, q, ts).length === 0;
  check('자료 없음', '추측·보장', `"${q}" → 추측 없이 부족한 정보를 밝힘`, ok, a.text.slice(0, 150));
}

// =============================================================== 6. 미트 선택 (the app's real modes; ground never on the mitt)
const MITT = [
  ['킥복싱 반응 훈련 미트 하자', (a) => a?.ok && /tab=react&art=kickboxing/.test(a.route)],
  ['로우킥 미트 연습', (a) => a?.ok && /combo=single/.test(a.route) && /low-kick/.test(decodeURIComponent(a.route))],
  ['MMA 콤보 미트 하고 싶어', (a) => a?.ok && /tab=db&art=mixed-martial-arts/.test(a.route)],
  ['싱글렉 미트로 들어가는 연습 할래', (a) => (a?.ok && /combo=single/.test(a.route)) || (a && !a.ok)],
  ['기무라 미트로 할래', (a) => !!a && !a.ok],
  ['그라운드 앤 파운드 미트 해볼래', (a) => !!a],
];
for (const [q, ok] of MITT) {
  const a = F.planCoachAction(q, { camera: true });
  check('미트', '잘못된 모드', `"${q}"`, !!ok(a), a);
}
{
  const a = await ask(T('kickboxing__cross'), '이거 미트로도 연습 돼?');
  check('미트', '질문 미인식', '"이거 미트로도 연습 돼?" (크로스) → 미트 연습 가능 안내', /Visualizing Mitt|미트/.test(a.text) && a.kind !== 'single', { kind: a.kind, text: a.text.slice(0, 120) });
}

// =============================================================== 7. 사용자 데이터 기반 수업 (the app's real stores)
{
  const lessonNoData = K.buildLocalOneOffLesson('무에타이 수업 하고 싶어', null);
  check('사용자 데이터', '수준 단정', '기록 없음 → 무에타이 수업을 만들되 수준을 단정하지 않음', lessonNoData.ok && /학습 기록 없음|기록이 없어/.test(`${lessonNoData.lesson.intro} ${lessonNoData.lesson.personalization}`), lessonNoData.ok ? lessonNoData.lesson.personalization : lessonNoData.code);
  const now = new Date().toISOString();
  K.saveLessonLog({ id: 'v-1', kind: 'one_off', title: '티프', date: now.slice(0, 10), startedAt: now, finishedAt: now, curriculumId: null, day: null, historyEntryId: null, techniques: [{ techniqueId: 'kickboxing__teep', name: 'Teep', overall: 'weak', practiced: true, concepts: [{ id: 'kp-0', label: '미는 감각', explain: '', reference: '', status: 'weak' }] }], qa: [], recap: null, updatedAt: now, coachKind: 'martialdex' });
  K.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['kickboxing__cross'], completed: true, estimatedMinutes: 10, source: 'free_training' });
  const l = K.buildLocalOneOffLesson('킥복싱 타격 수업 하고 싶어', null);
  check('사용자 데이터', '기록 미반영', '기록(티프 약함, 크로스 연습) → 티프 복습 포함, 크로스를 새 기술로 다시 고르지 않음', l.ok && /티프|Teep/.test(l.lesson.intro) && canon(l.lesson.techniqueId) !== canon('kickboxing__cross'), l.ok ? { tech: l.lesson.techniqueId, intro: l.lesson.intro.slice(60, 200) } : l.code);
  const p = l.ok ? K.oneOffPractice(l.lesson) : null;
  check('사용자 데이터', '미트 미연결', '그 수업의 실습 = 기존 Visualizing Mitt', !!p?.mitt, p?.mode);
  const a = await ask(null, '요즘 뭐가 부족해?');
  check('사용자 데이터', '기록 미반영', '"요즘 뭐가 부족해?" → 기록상 약한 티프', (a.techniqueIds ?? []).some((x) => canon(x) === canon('kickboxing__teep')), { kind: a.kind, text: a.text.slice(0, 120) });
  mem.set('martialdex:curricula:custom', JSON.stringify([{ id: 'g', title: '목표', martialArt: 'bjj', days: [], totalDays: 0, createdAt: '2026-10-01', updatedAt: '2026-10-21', aiGoalMeta: { goalText: '주짓수 위주로 그래플링 실력 키우기' } }]));
  const g = K.buildLocalOneOffLesson('오늘 수업 해줘', null);
  check('사용자 데이터', '목표 미반영', '저장된 목표(주짓수 그래플링) → BJJ 그라운드 수업, 미트 아님', g.ok && g.lesson.martialArt === 'bjj' && !K.oneOffPractice(g.lesson)?.mitt, g.ok ? { art: g.lesson.martialArt, tech: g.lesson.techniqueId } : g.code);
  const g2 = K.buildLocalOneOffLesson('무에타이 수업 해줘', null);
  check('사용자 데이터', '요청 우선순위', '목표가 BJJ여도 "무에타이 수업" 요청이 우선', g2.ok && /muay-thai|kickboxing/.test(g2.lesson.techniqueId), g2.ok ? g2.lesson.techniqueId : g2.code);
}

// =============================================================== 8. naturalness essentials (structure, not wording)
{
  const a = await ask(null, '훅 어떻게 쳐?');
  const t = T(a.techniqueIds?.[0] ?? '');
  const p = t?.posture ?? {};
  const allPresent = [p.overview, p.steps?.[0], p.keyPoints?.[0], p.commonMistakes?.[0]].filter(Boolean).every((x) => contains(a.text, x));
  check('자연스러움', '완성도', '"훅 어떻게 쳐?" → 개요·단계·핵심·실수가 모두 원문 그대로 들어감', !!t && allPresent, a.text.slice(0, 200));
  const b = await ask(null, '크로스랑 잽 차이?');
  check('자연스러움', '비교 구조', '"크로스랑 잽 차이?" → 두 기술 모두 다룸', b.kind === 'compare' && (b.techniqueIds ?? []).length === 2, { kind: b.kind });
  const c = await ask(T('kickboxing__jab'), '뭐 조심해야 돼?');
  check('자연스러움', '의도', '"뭐 조심해야 돼?"(잽) → 잽의 흔한 실수 우선', contains(c.text, firstOf('kickboxing__jab', 'commonMistakes')), c.text.slice(0, 140));
}

check('AI 호출', 'AI 호출', 'Gemini 0 · 로컬 모델 0', calls.gemini === 0 && calls.local === 0, calls);

const failed = results.filter((x) => !x.pass);
const byCat = {};
for (const r of results) { byCat[r.cat] ??= [0, 0]; byCat[r.cat][1]++; if (r.pass) byCat[r.cat][0]++; }
const byFail = {};
for (const r of failed) byFail[r.failType] = (byFail[r.failType] ?? 0) + 1;
console.log('\n카테고리별:', Object.entries(byCat).map(([c, [p, n]]) => `${c} ${p}/${n}`).join(' · '));
console.log('실패 유형별:', JSON.stringify(byFail));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
