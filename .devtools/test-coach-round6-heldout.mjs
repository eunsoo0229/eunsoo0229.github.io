// 자체 AI 코치 6차 — 새 검증 세트. Written and FROZEN before the 6th-round changes (sha256 in the report),
// run ONCE at the end. Same failure TYPES as the 5th-round validation failures, but different words,
// techniques and phrasings — it checks that the fixes generalise instead of matching those 9 questions.
// Expected answers come from the technique data / the app's features, not from the coach's code.
// Run: node .devtools/test-coach-round6-heldout.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-r6-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as Q from ${mod('src/lib/coachKnowledge/questions.ts')};`,
    `export * as F from ${mod('src/lib/coachKnowledge/featureCatalog.ts')};`,
    `export { resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
    `export { canonicalTechniqueId } from ${mod('src/lib/techniqueCanonical/index.ts')};`,
    `export { saveLessonLog } from ${mod('src/lib/coachLesson/lessonLog.ts')};`,
    `export { martialArtSummaries } from ${mod('src/lib/loadData.ts')};`,
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
const dataText = (t) => { const p = t.posture ?? {}; return [t.name, t.koreanName ?? '', ...t.aliases, t.category, t.description, t.purpose ?? '', ...t.positions, p.overview ?? '', p.startingPosition ?? '', ...(p.steps ?? []), ...(p.keyPoints ?? []), ...(p.commonMistakes ?? []), ...Object.values(p.bodyPosition ?? {})].join(' ').toLowerCase(); };

const results = [];
function check(type, name, pass, detail = '') {
  results.push({ type, pass });
  if (!pass || process.env.VERBOSE) console.log((pass ? 'PASS' : 'FAIL') + ` — [${type}] ${name}` + (detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 240) : ''));
}
const ask = async (cur, q, ctx) => { try { return await Q.answerCoachQuestion(cur, q, { useModel: false, context: ctx }); } catch (e) { return { kind: 'error', text: String(e), techniqueIds: [] }; } };
const about = (a, id) => (a.techniqueIds ?? []).some((x) => canon(x) === canon(id));
const firstStep = (id) => (T(id)?.posture?.steps ?? [])[0] ?? '';
const has = (text, s) => !!s && text.includes(s.slice(0, Math.min(14, s.length)));

// 1. 수행 방법 활용형 → the technique's steps
for (const [q, id] of [
  ['어퍼컷 어떻게 쳐요', 'boxing__uppercut'],
  ['미들킥 차는 법 알려줘', 'kickboxing__body-kick'],
  ['트라이앵글 초크 거는 법', 'bjj__triangle-choke'],
  ['스프롤 하는 법 좀', 'wrestling__sprawl'],
  ['오소토가리 어떻게 걸어?', 'judo__osoto-gari'],
]) {
  const a = await ask(null, q);
  const ok = about(a, id) && has(a.text, firstStep(id));
  check('수행 방법', `"${q}"`, ok || (a.kind === 'ambiguous' && !about(a, id) && /골라|어느/.test(a.text)), { kind: a.kind, ids: a.techniqueIds, text: a.text.slice(0, 120) });
}

// 2. 안전 — body-safety questions are answered within the data's limits; everyday negatives are not "safety"
for (const [q, id] of [['더블 레그 하면 허리에 무리 가?', 'wrestling__basic-double-leg'], ['암바 당하면 팔꿈치 괜찮아?', 'bjj__armbar'], ['로우킥 많이 차면 정강이 아파?', 'kickboxing__low-kick']]) {
  const a = await ask(null, q);
  check('안전', `"${q}" → 자료로 확인할 수 없는 범위를 밝히고 자세 설명으로 대신하지 않음`, /확인되지 않|자료에는 .*없습니다/.test(a.text) && !/괜찮습니다|안전합니다|문제없/.test(a.text) && !/^MARTIALDEX 자료에 따르면 .*(다리·무릎|팔·손|골반·엉덩이)/.test(a.text), a.text.slice(0, 150));
  void id;
}
{
  const a = await ask(T('kickboxing__jab'), '오늘 컨디션이 좀 안 좋아');
  check('안전', '"오늘 컨디션이 좀 안 좋아"(수업 중) → 안전·부상 답변으로 분류하지 않음', !/안전 여부/.test(a.text), a.text.slice(0, 120));
}

// 3. 이름 유래·정의 — not the how-to; no etymology in the data → says so
for (const q of ['크로스는 왜 크로스라고 불러?', '주지가타메 이름 뜻이 뭐야?', '카무라라는 이름은 어디서 왔어?']) {
  const a = await ask(null, q);
  check('이름 유래', `"${q}" → 유래 자료가 없다고 답함 (동작 설명으로 대신하지 않음)`, /유래|어원|이름/.test(a.text) && /없습니다|확인되지 않/.test(a.text) && !/동작 단계/.test(a.text), a.text.slice(0, 150));
}

// 4. 기록 기반 — real records or "no record"
{
  let a = await ask(null, '내 약점이 뭐야?');
  check('기록', '"내 약점이 뭐야?"(기록 없음) → 기록이 없다고 함', /기록/.test(a.text) && /없습니다/.test(a.text) && (a.techniqueIds ?? []).length === 0, a.text.slice(0, 120));
  const now = new Date().toISOString();
  K.saveLessonLog({ id: 'r6', kind: 'one_off', title: '어퍼컷', date: now.slice(0, 10), startedAt: now, finishedAt: now, curriculumId: null, day: null, historyEntryId: null, techniques: [{ techniqueId: 'boxing__uppercut', name: 'Uppercut', overall: 'weak', practiced: true, concepts: [{ id: 'kp-0', label: '무릎 반동', explain: '', reference: '', status: 'weak' }] }], qa: [], recap: null, updatedAt: now, coachKind: 'martialdex' });
  a = await ask(null, '어떤 걸 보완해야 해?');
  check('기록', '"어떤 걸 보완해야 해?" → 기록상 약한 어퍼컷', (a.techniqueIds ?? []).some((x) => canon(x) === canon('boxing__uppercut')), { kind: a.kind, text: a.text.slice(0, 120) });
  a = await ask(null, '나 뭐가 모자라?');
  check('기록', '"나 뭐가 모자라?" → 기록상 약한 어퍼컷', (a.techniqueIds ?? []).some((x) => canon(x) === canon('boxing__uppercut')), { kind: a.kind, text: a.text.slice(0, 120) });
}

// 5. 상황 — grounded techniques, the situation's own words
for (const [q, terms] of [
  ['상대가 자꾸 붙으면 킥을 못 차겠어', ['클린치', '근거리', '인사이드', '거리', 'clinch', '붙']],
  ['사이드 컨트롤에 깔렸어 탈출 어떻게 해', ['사이드', 'side']],
  ['백 컨트롤 잡혔어 어떻게 나와', ['백', 'back']],
]) {
  const a = await ask(null, q);
  const ts = (a.techniqueIds ?? []).map(T).filter(Boolean);
  const grounded = ts.length > 0 && ts.every((t) => terms.some((w) => dataText(t).includes(w.toLowerCase())));
  check('상황', `"${q}"`, grounded || (ts.length === 0 && /찾지 못했습니다|없습니다/.test(a.text)), { kind: a.kind, ids: a.techniqueIds?.slice(0, 4), text: a.text.slice(0, 140) });
}
{
  const a = await ask(null, '상대가 계속 붙어서 잽을 못 쓰겠어');
  check('상황', '"…붙어서 잽을 못 쓰겠어" → 내 잽을 상대 공격으로 보고 "잽 대응"을 답하지 않음', !/잽 대응|잽\(Jab\) 대응/.test(a.text), a.text.slice(0, 140));
}

// 6. 기능 라우팅 — noun commands open the right mode; unknown names never open a generic screen
const R = (t, c = {}) => F.planCoachAction(t, { camera: true, ...c });
{
  const a = R('미들킥 미트 연습');
  check('라우팅', '"미들킥 미트 연습" → 미트 단일 기술', !!a?.ok && /combo=single/.test(a.route), a);
  const b = R('하이킥 미트 훈련');
  check('라우팅', '"하이킥 미트 훈련" → 미트 단일 기술', !!b?.ok && /combo=single/.test(b.route), b);
  const c = R('카무라 미트로 할래');
  check('라우팅', '"카무라 미트로 할래"(없는 이름) → 미트 화면을 열지 않고 확인', !c?.ok, c);
  const d = R('스핀블라블라 미트 하자');
  check('라우팅', '"스핀블라블라 미트 하자"(없는 이름) → 미트 화면을 열지 않고 확인', !d?.ok, d);
  const e = R('미트 하고 싶어');
  check('라우팅', '"미트 하고 싶어"(이름 없음) → 기존 미트 화면 열기는 그대로', !!e?.ok, e);
  const f = R('그거 해줘');
  check('라우팅', '"그거 해줘"(문맥 없음) → 아무 기능도 실행하지 않음', !f?.ok, f);
}

// 7. 비슷한 표기 — the right technique or a question, never another technique
for (const [q, id] of [['키뮤라 어떻게 해', 'bjj__kimura'], ['스프롤ㄹ 실수', 'wrestling__sprawl']]) {
  const a = await ask(null, q);
  const ids = a.techniqueIds ?? [];
  check('표기', `"${q}" → 맞는 기술이거나 확인 질문`, ids.length === 0 || ids.some((x) => canon(x) === canon(id)), { kind: a.kind, ids, text: a.text.slice(0, 120) });
}

check('AI 호출', 'Gemini 0 · 로컬 모델 0', calls.gemini === 0 && calls.local === 0, calls);
const failed = results.filter((r) => !r.pass);
const byType = {};
for (const r of results) { byType[r.type] ??= [0, 0]; byType[r.type][1]++; if (r.pass) byType[r.type][0]++; }
console.log('\n유형별:', Object.entries(byType).map(([t, [p, n]]) => `${t} ${p}/${n}`).join(' · '));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
