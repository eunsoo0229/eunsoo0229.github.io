// 자체 AI 코치 — (1) HELD-OUT 검증 문항: written after the 4th-round changes and run ONCE without tuning
// (techniques 5-6th by id per art — eval100 used the first 4 — and new phrasings / situations);
// (2) feature checks for this round: saved-goal lesson planning, session follow-ups
// ("잽 연습" → "왜?" → "그럼 미트 할래" → "끝났어" → "다음 뭐 하지?"), record-verified "끝났어".
// Run: node .devtools/test-coach-heldout.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-heldout-'));
const out = path.join(dir, 'h.mjs');
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
    `export { recordTrainingSession } from ${mod('src/lib/trainingHistory/service.ts')};`,
    `export { martialArtSummaries } from ${mod('src/lib/loadData.ts')};`,
    `export { exactTechniquesInText } from ${mod('src/lib/coachKnowledge/lookup.ts')};`,
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
const CAT = {};
function check(cat, name, pass, detail = '') {
  results.push({ cat, name, pass });
  (CAT[cat] ??= { pass: 0, total: 0 }).total++;
  if (pass) CAT[cat].pass++;
  if (!pass || process.env.VERBOSE) console.log((pass ? 'PASS' : 'FAIL') + ` — [${cat}] ${name}` + (detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 260) : ''));
}
const ask = async (cur, q, ctx) => { try { return await Q.answerCoachQuestion(cur, q, { useModel: false, context: ctx }); } catch (e) { return { kind: 'error', text: String(e), techniqueIds: [] }; } };

// =============================================================== 1. HELD-OUT (run once, not tuned)
const ARTS = ['boxing', 'kickboxing', 'muay-thai', 'mixed-martial-arts', 'wrestling', 'bjj', 'judo', 'sambo'];
const TPL = [
  { field: 'keyPoints', q: (n) => `${n} 하는 요령 알려줘` },
  { field: 'commonMistakes', q: (n) => `${n} 할 때 주의할 점 있음?` },
  { field: 'steps', q: (n) => `${n} 단계별로 설명 좀` },
];
let i = 0;
for (const art of ARTS) {
  const picks = K.getUnifiedAllTechniques()
    .filter((t) => t.martialArt === art && (t.posture?.keyPoints?.length ?? 0) >= 1 && (t.posture?.commonMistakes?.length ?? 0) >= 1 && (t.posture?.steps?.length ?? 0) >= 2 && /^[A-Za-z][A-Za-z ]+$/.test(t.name))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(4, 6);
  for (const t of picks) {
    const tpl = TPL[i++ % TPL.length];
    const n = t.koreanName ?? t.name;
    const q = tpl.q(n);
    const a = await ask(null, q);
    const r = K.exactTechniquesInText(n, null);
    const hit = (a.techniqueIds ?? []).some((id) => canon(id) === canon(t.id));
    const okTarget = hit || ((r.ambiguous.length > 0 || r.matches.length > 1) && a.kind === 'ambiguous');
    const first = t.posture[tpl.field][0];
    const okField = !hit || a.text.includes(first.slice(0, Math.min(18, first.length)));
    const inv = hit ? invented(a.text, q, [t, ...techsOf(a)]) : [];
    check(`H.${art}`, `"${q}" (${t.id})`, okTarget && okField && inv.length === 0, { kind: a.kind, ids: a.techniqueIds, okTarget, okField, inv, text: a.text.slice(0, 120) });
  }
}
const H_SIT = [
  ['인파이터한테 자꾸 밀려서 압박당해', ['압박']],
  ['케이지에 몰렸을 때 어떻게 해?', ['케이지', '펜스', 'cage']],
  ['사이드 컨트롤 깔렸어 어떡해', ['사이드']],
  ['상대 잽에 계속 맞아', ['잽', 'jab']],
  ['킥 캐치 당하면 어떡해', ['캐치', 'catch']],
  ['거리를 어떻게 유지해야 할지 모르겠어', ['거리']],
];
for (const [q, terms] of H_SIT) {
  const a = await ask(null, q);
  const ts = techsOf(a);
  const grounded = ts.length > 0 && ts.every((t) => terms.some((w) => dataText(t).toLowerCase().includes(w.toLowerCase())));
  const refused = !ts.length && /찾지 못했습니다|없습니다/.test(a.text);
  const inv = invented(a.text, q, ts);
  check('H.상황', `"${q}"`, (grounded || refused) && inv.length === 0 && a.kind !== 'no_technique', { kind: a.kind, ids: a.techniqueIds?.slice(0, 4), inv, text: a.text.slice(0, 140) });
}
const H_OUT = ['스위치 킥 칠 때 칼로리 얼마나 타?', '하이킥 맞으면 기절해?'];
for (const q of H_OUT) {
  const a = await ask(null, q);
  check('H.자료밖', `"${q}"`, /없습니다|찾지 못했습니다|확인되지 않/.test(a.text) && !/\d+\s*(kcal|칼로리|%)/.test(a.text), a.text.slice(0, 140));
}

// =============================================================== 2. feature checks of this round
// saved goal → lesson plan (the goal lives in the student's curricula, read by latestKnownGoal)
const setGoal = (goal) => mem.set('martialdex:curricula:custom', JSON.stringify([{ id: 'g1', title: '목표', martialArt: 'mixed-martial-arts', days: [], totalDays: 0, createdAt: '2026-10-01', updatedAt: '2026-10-20', aiGoalMeta: { goalText: goal } }]));
{
  let l = K.buildLocalOneOffLesson('오늘 수업 해줘', null);
  check('기능.목표', '목표가 없으면 종목을 물음 (기존 동작)', !l.ok && l.code === 'NEED_INFO', l.code);
  setGoal('타격 위주로 실력 늘리기');
  l = K.buildLocalOneOffLesson('오늘 수업 해줘', null);
  const p1 = l.ok ? K.oneOffPractice(l.lesson) : null;
  check('기능.목표', '"타격 위주" → 스탠딩 타격 기술 + 미트, 목표 반영 표시', l.ok && !!p1?.mitt && /저장된 목표/.test(l.lesson.intro), l.ok ? { tech: l.lesson.techniqueId, mitt: p1?.mitt?.techniqueIds } : l.code);
  setGoal('MMA 시합 레슬링 대비');
  l = K.buildLocalOneOffLesson('오늘 수업 해줘', null);
  check('기능.목표', '"MMA 레슬링 대비" → 테이크다운 방어 기술', l.ok && /방어|sprawl|스프롤|defen/i.test(`${l.lesson.techniqueId} ${l.lesson.intro}`), l.ok ? { tech: l.lesson.techniqueId } : l.code);
  setGoal('BJJ 위주로 배우고 싶어');
  l = K.buildLocalOneOffLesson('오늘 수업 해줘', null);
  check('기능.목표', '"BJJ 위주" → 그라운드 기술, 미트 아님', l.ok && l.lesson.martialArt === 'bjj' && !K.oneOffPractice(l.lesson)?.mitt, l.ok ? { tech: l.lesson.techniqueId } : l.code);
  l = K.buildLocalOneOffLesson('복싱 타격 수업', null);
  check('기능.목표', '요청에 종목·영역이 있으면 요청이 목표보다 우선 (BJJ 목표여도 복싱 타격)', l.ok && /boxing|kickboxing/.test(l.lesson.techniqueId), l.ok ? l.lesson.techniqueId : l.code);
  mem.delete('martialdex:curricula:custom');
}
// session flow: 잽 연습 → 왜? → 그럼 미트 할래 → 끝났어 → 다음 뭐 하지?
{
  let ctx = Q.EMPTY_DIALOG;
  let a = await ask(null, '잽 어떻게 해?', ctx);
  ctx = a.context;
  const act1 = F.planCoachAction('잽 연습하고 싶어', { current: T(ctx.focusId), camera: true });
  ctx = Q.dialogAfterAction(ctx, act1);
  a = await ask(null, '왜?', ctx);
  check('기능.세션', '"잽 연습"(미트) 뒤 "왜?" → 그 훈련을 고른 이유 + 자료 핵심 포인트', /Visualizing Mitt|미트/.test(a.text) && /핵심 포인트/.test(a.text), a.text.slice(0, 200));
  ctx = a.context ?? ctx;
  const act2 = F.planCoachAction('그럼 미트 할래', { current: T(ctx.focusId), camera: true });
  check('기능.세션', '"그럼 미트 할래" → 지금 기술(잽)로 미트', act2?.ok && /single%3Akickboxing__jab|single:kickboxing__jab/.test(act2.route), act2?.route);
  ctx = Q.dialogAfterAction(ctx, act2);
  a = await ask(null, '끝났어', ctx);
  check('기능.세션', '"끝났어" (저장된 기록 없음) → 완료라고 단정하지 않음', /확인되지 않습니다/.test(a.text), a.text.slice(0, 160));
  K.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['kickboxing__jab'], completed: true, estimatedMinutes: 5, actualMinutes: 4, source: 'free_training', visualMitt: { comboId: 'single:kickboxing__jab', comboName: '잽', stepTechniqueIds: ['kickboxing__jab'], completedSteps: [0], repetitions: 12, stance: 'orthodox' } });
  a = await ask(null, '끝났어', ctx);
  check('기능.세션', '"끝났어" (미트 기록 저장 후) → 실제 기록으로 확인', /기록 확인/.test(a.text) && /12회/.test(a.text), a.text.slice(0, 160));
  ctx = a.context ?? ctx;
  a = await ask(null, '다음 뭐 하지?', ctx);
  check('기능.세션', '"다음 뭐 하지?" → 같은 기술(잽)의 다음 기술 추천', a.kind === 'next' && /잽|Jab/.test(a.text), a.text.slice(0, 160));
  // stored for the browser session (mitt → back keeps it)
  Q.saveDialog(ctx);
  check('기능.세션', '대화 문맥은 앱 세션 동안 저장되어 화면을 다녀와도 유지', Q.loadDialog().lastAction?.techniqueId === 'kickboxing__jab', Q.loadDialog().lastAction);
}
check('AI', 'Gemini 0 · 로컬 모델 0', calls.gemini === 0 && calls.local === 0, calls);

const failed = results.filter((x) => !x.pass);
console.log('\n카테고리별:', Object.entries(CAT).map(([c, v]) => `${c} ${v.pass}/${v.total}`).join(' · '));
const held = results.filter((r) => r.cat.startsWith('H.'));
console.log(`held-out ${held.filter((r) => r.pass).length}/${held.length} · 기능 ${results.filter((r) => !r.cat.startsWith('H.') && r.pass).length}/${results.filter((r) => !r.cat.startsWith('H.')).length}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
