// 자체 AI 코치 독립 평가 세트 (100+ 문항) — written BEFORE the 4th round of changes, so it is not tuned to them.
//  A. 종목별 기술 질문 (8 arts): techniques picked MECHANICALLY (first by id with key points + mistakes +
//     steps), phrased in casual / slang / English forms; the expected answer is the technique's own data.
//  B. hand-written real-user phrasing: situations, follow-ups, relations, review/records, mitt requests,
//     out-of-data questions.
// Checks are automatic: target technique, the requested field's first value verbatim, no invented words
// (same checker as test-coach-quality), grounded situation lists, routes, refusals, AI calls = 0.
// No overlap with test-coach-quality's 42 questions. Run: node .devtools/test-coach-eval100.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-eval100-'));
const out = path.join(dir, 'e.mjs');
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
    `export { exactTechniquesInText } from ${mod('src/lib/coachKnowledge/lookup.ts')};`,
  ].join('\n')
);
const calls = { gemini: 0, local: 0 };
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {},
  location: { href: 'http://localhost/', search: '', hash: '', reload() {} },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
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

// ---- invented-content checker (same rule as test-coach-quality)
const tok = (s) => (s.normalize('NFKC').toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g) ?? []).map((w) => w.replace(/(으로|에서|에게|까지|부터|이랑|하고|해서|하면|하는|하기|합니다|입니다|습니다|을|를|이|가|은|는|에|의|로|와|과|도|만|요)$/, '')).filter((w) => w.length >= 2);
const templateVocab = new Set();
for (const f of fs.readdirSync(path.join(APP, 'src/lib/coachKnowledge'))) {
  const code = fs.readFileSync(path.join(APP, 'src/lib/coachKnowledge', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/ .*$/gm, ' ');
  for (const w of tok(code)) templateVocab.add(w);
}
for (const a of K.martialArtSummaries) for (const w of tok(`${a.nameKo} ${a.nameEn ?? ''} ${a.id}`)) templateVocab.add(w);
function dataText(t) {
  const p = t.posture ?? {};
  return [t.name, t.koreanName ?? '', ...t.aliases, t.category, t.description, t.purpose ?? '', ...t.positions, ...t.principles, t.difficulty ?? '', p.overview ?? '', p.startingPosition ?? '', ...(p.steps ?? []), ...(p.keyPoints ?? []), ...(p.commonMistakes ?? []), ...Object.values(p.bodyPosition ?? {})].join(' ');
}
const covered = (w, pool) => pool.some((p) => p.includes(w) || (w.length >= 3 && w.includes(p) && p.length >= 2));
function invented(answer, question, techniques) {
  const pool = [...new Set([...tok(question), ...techniques.flatMap((t) => tok(dataText(t)))])];
  return [...new Set(tok(answer))].filter((w) => !templateVocab.has(w) && !covered(w, pool));
}

const results = [];
const CAT = {};
function check(cat, name, pass, detail = '') {
  results.push({ cat, name, pass });
  (CAT[cat] ??= { pass: 0, total: 0 }).total++;
  if (pass) CAT[cat].pass++;
  if (!pass || process.env.VERBOSE) console.log((pass ? 'PASS' : 'FAIL') + ` — [${cat}] ${name}` + (detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 260) : ''));
}
async function ask(current, q, context) {
  try {
    return await Q.answerCoachQuestion(current, q, { useModel: false, context });
  } catch (e) {
    return { kind: 'error', text: String(e), techniqueIds: [] };
  }
}
const techsOf = (a) => (a.techniqueIds ?? []).map(T).filter(Boolean);
const hasData = (a, current) => {
  const ts = techsOf(a);
  return ts.length ? ts : current ? [current] : [];
};

// =============================================================== A. 종목별 기술 질문 (mechanical selection)
const ARTS = ['boxing', 'kickboxing', 'muay-thai', 'mixed-martial-arts', 'wrestling', 'bjj', 'judo', 'sambo'];
const all = K.getUnifiedAllTechniques();
const TEMPLATES = [
  { field: 'keyPoints', q: (n) => `${n} 핵심 뭐임?` },
  { field: 'commonMistakes', q: (n) => `${n} 할 때 사람들이 많이 틀리는 거 있어?` },
  { field: 'steps', q: (n) => `${n} 어케 함` },
  { field: 'keyPoints', q: (n) => `${n} 잘하려면 뭐가 중요해?` },
  { field: 'commonMistakes', q: (n) => `${n} 하다가 뭘 조심해야 돼` },
  { field: 'steps', q: (n) => `${n} 순서 좀` },
];
let ti = 0;
for (const art of ARTS) {
  const picks = all
    .filter((t) => t.martialArt === art && (t.posture?.keyPoints?.length ?? 0) >= 1 && (t.posture?.commonMistakes?.length ?? 0) >= 1 && (t.posture?.steps?.length ?? 0) >= 2 && /^[A-Za-z][A-Za-z ]+$/.test(t.name))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 4);
  for (const t of picks) {
    for (const useKorean of [true, false]) {
      const tpl = TEMPLATES[ti++ % TEMPLATES.length];
      // the name a user would type: the record's / its data's Korean name, or the English name
      const named = K.exactTechniquesInText(t.name, null).matches;
      const ko = t.koreanName ?? (t.posture?.overview?.match(/^([가-힣]+(?: [가-힣]+){0,3})(은|는)\s/)?.[1] ?? null);
      const n = useKorean && ko ? ko : t.name;
      const q = tpl.q(n);
      const a = await ask(null, q);
      const resolved = K.exactTechniquesInText(n, null);
      const ambiguousName = resolved.ambiguous.length > 0 || resolved.matches.length > 1;
      const hit = (a.techniqueIds ?? []).some((id) => canon(id) === canon(t.id));
      const first = t.posture[tpl.field][0];
      const okTarget = hit || (ambiguousName && a.kind === 'ambiguous');
      const okField = !hit || a.text.includes(first.slice(0, Math.min(18, first.length)));
      const inv = hit ? invented(a.text, q, [t, ...techsOf(a)]) : [];
      check(`A.${art}`, `"${q}" (${t.id})`, okTarget && okField && inv.length === 0, { kind: a.kind, ids: a.techniqueIds, okTarget, okField, inv, text: a.text.slice(0, 120) });
      void named;
    }
  }
}

// =============================================================== B1. 상황 표현 (real phrasing)
const SITUATIONS = [
  ['태클 계속 들어오는데', ['태클', '테이크다운']],
  ['압박이 너무 심해', ['압박']],
  ['거리 못 잡겠어', ['거리']],
  ['가드 자꾸 열려', ['가드']],
  ['펀치를 너무 많이 맞아', ['펀치', '가드', '방어']],
  ['로우킥 맞으면 어떡해', ['로우킥', '로우 킥', '킥']],
  ['클린치 당하면 뭐 해야 돼?', ['클린치']],
  ['마운트 깔렸을 때 어떻게 빠져나와?', ['마운트']],
  ['백 잡혔을 때 탈출법', ['백']],
  ['상대가 키가 커서 거리 싸움이 안 돼', ['거리']],
];
for (const [q, terms] of SITUATIONS) {
  const a = await ask(null, q);
  const ts = techsOf(a);
  // a coaching answer: lists real techniques whose OWN data mentions what the student talked about
  const grounded = ts.length > 0 && ts.every((t) => terms.some((w) => dataText(t).toLowerCase().includes(w.toLowerCase())));
  const inv = invented(a.text, q, ts);
  check('B.상황', `"${q}" → 관련 기술(자료에 그 내용이 적힌 것만) 제시`, grounded && inv.length === 0 && a.kind !== 'no_technique', { kind: a.kind, ids: a.techniqueIds?.slice(0, 5), inv, text: a.text.slice(0, 140) });
}

// =============================================================== B2. 후속 질문 (chains)
const chains = [
  { steps: ['크로스 어떻게 쳐?', '발은 어디 둬?', '실수는?'], art: 'boxing__cross', check: (a, i) => (i === 0 ? (a.techniqueIds ?? []).some((id) => /cross/.test(id)) || a.kind === 'ambiguous' : true) },
  { steps: ['더블 레그 알려줘', '그거 하다 흔히 하는 실수?', '머리 위치는?'], id: 'wrestling__basic-double-leg' },
  { steps: ['트라이앵글 초크 어떻게 해', '다리는 어떻게 둬', '다음에 배울 거 추천'], id: 'bjj__triangle-choke' },
  { steps: ['오소토가리 설명해줘', '핵심 포인트는', '이거랑 오우치가리 차이'], id: 'judo__osoto-gari' },
  { steps: ['티프 어케 차', '왜 써?'], id: 'kickboxing__teep' },
];
for (const c of chains) {
  if (!c.id) continue;
  let ctx;
  let ok = true;
  const trace = [];
  for (let i = 0; i < c.steps.length; i++) {
    const a = await ask(null, c.steps[i], ctx);
    ctx = a.context;
    const about = (a.techniqueIds ?? []).some((id) => canon(id) === canon(c.id)) || (a.kind === 'compare' && (a.techniqueIds ?? []).map(canon).includes(canon(c.id))) || (a.kind === 'next' && ctx?.focusId && canon(ctx.focusId) === canon(c.id)) || (a.kind === 'next');
    trace.push({ q: c.steps[i], kind: a.kind, ids: a.techniqueIds?.slice(0, 3) });
    if (!about || a.kind === 'no_technique' || a.kind === 'error') ok = false;
  }
  check('B.후속', `${c.steps.join(' → ')}`, ok, trace);
}

// =============================================================== B3. 관계 (next / prerequisite / counter / escape / family)
const REL = [
  ['잽 다음엔 뭘 배워?', 'next'],
  ['로우킥 배우기 전에 먼저 해야 하는 거?', 'next'],
  ['암바 카운터 뭐 있어?', 'counter'],
  ['리어 네이키드 초크 걸렸을 때 탈출?', 'counter'],
  ['훅이랑 비슷한 기술 뭐 있어?', 'family'],
  ['오소토가리랑 같은 계열 기술', 'family'],
];
for (const [q] of REL) {
  const a = await ask(null, q);
  const ts = techsOf(a);
  const inv = invented(a.text, q, [...ts, ...(K.exactTechniquesInText(q, null).matches)]);
  // must not stop at "자료에 없습니다" when the data has related techniques; must not invent
  check('B.관계', `"${q}"`, ts.length > 0 && inv.length === 0 && a.kind !== 'no_technique', { kind: a.kind, ids: a.techniqueIds?.slice(0, 4), inv, text: a.text.slice(0, 140) });
}

// =============================================================== B4. 자료 밖 질문 (must refuse, not invent)
const OUT = ['잽 칠 때 심박수는 얼마나 올라가?', '암바 성공률 몇 퍼센트야?', '더블 레그 하다가 무릎 다치면 괜찮아?', '오소토가리는 누가 만들었어?', '티프 칠 때 몇 킬로 힘이 들어가?', '스프롤 하면 허리 안 다쳐?', '카프킥 맞으면 다리 부러져?', '크로스 몇 번 연습해야 늘어?'];
for (const q of OUT) {
  const a = await ask(null, q);
  const ts = hasData(a, null);
  const inv = invented(a.text, q, ts);
  const refused = /없습니다|찾지 못했습니다|추측하지 않겠|확인되지 않/.test(a.text);
  check('B.자료밖', `"${q}" → 추측 없이 거절`, refused && inv.length === 0 && !/괜찮습니다|안전합니다|\d+\s*(%|퍼센트|킬로)/.test(a.text), { kind: a.kind, text: a.text.slice(0, 150), inv });
}

// =============================================================== B5. 미트 요청 (per art)
const MITT = [
  ['킥복싱 미트 치고 싶어', /\/coach\/mitt\?.*art=kickboxing/],
  ['무에타이 반응 훈련 할래', /tab=react&art=muay-thai/],
  ['MMA 미트 하자', /\/coach\/mitt\?.*art=mixed-martial-arts/],
  ['복싱 콤보 미트 해줘', /tab=db&art=boxing/],
  ['카프킥 미트로 연습하고 싶어', /combo=single/],
  // (2026-10-25, after the first run: corrected — the app's mitt really has throw entries for judo/sambo
  //  (visualMitt/archetypes.ts osotoGari 'entry'); the first expectation "not on the mitt" was wrong)
  ['오소토가리 미트로 할래', /combo=single/],
  ['삼각조르기 미트로 연습하고 싶어', null],
  ['유도 메치기 미트 하고 싶어', /\/coach\/mitt\?.*art=judo/],
];
for (const [q, route] of MITT) {
  const a = F.planCoachAction(q, { camera: true });
  const ok = route ? !!a?.ok && route.test(decodeURIComponent(a.route)) : !!a && !a.ok;
  check('B.미트', `"${q}" → ${route ? '해당 종목 미트' : '미트로 열지 않음(그라운드/투기 메치기)'}`, ok, a);
}

// =============================================================== B6. 복습·기록 (seeded through the app's stores)
{
  let a = await ask(null, '요즘 내가 뭘 약하게 배웠지?');
  check('B.기록', '"요즘 내가 뭘 약하게 배웠지?" (기록 없음) → 기록 없다고 함', /기록|없습니다/.test(a.text) && !/개선 필요|약한 기술:/.test(a.text), a.text.slice(0, 120));
  const now = new Date().toISOString();
  K.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['kickboxing__teep'], completed: true, estimatedMinutes: 10, source: 'free_training' });
  K.saveLessonLog({ id: 'e-1', kind: 'one_off', title: '훅', date: now.slice(0, 10), startedAt: now, finishedAt: now, curriculumId: null, day: null, historyEntryId: null, techniques: [{ techniqueId: 'kickboxing__lead-hook', name: 'Lead Hook', overall: 'weak', practiced: true, concepts: [{ id: 'kp-0', label: '앞발 회전', explain: '', reference: '', status: 'weak' }] }], qa: [], recap: null, updatedAt: now, coachKind: 'martialdex' });
  a = await ask(null, '복습할 거 골라줘');
  check('B.기록', '"복습할 거 골라줘" → 기록상 약한 리드 훅', (a.techniqueIds ?? []).some((id) => canon(id) === canon('kickboxing__lead-hook')), { kind: a.kind, text: a.text.slice(0, 140) });
  a = await ask(null, '나 지금까지 뭐 배웠어?');
  check('B.기록', '"나 지금까지 뭐 배웠어?" → 실제 기록 요약', /기록이 있는 기술 \d+개/.test(a.text), a.text.slice(0, 140));
  const l = K.buildLocalOneOffLesson('킥복싱 수업 해줘', null);
  check('B.기록', '"킥복싱 수업 해줘" → 약한 리드 훅 복습 포함, 배운 티프는 새 기술로 다시 고르지 않음', l.ok && /훅|Hook/.test(l.lesson.intro) && canon(l.lesson.techniqueId) !== canon('kickboxing__teep'), l.ok ? { tech: l.lesson.techniqueId, intro: l.lesson.intro.slice(60, 220) } : l.code);
}

check('AI', 'Gemini 0 · 로컬 모델 0', calls.gemini === 0 && calls.local === 0, calls);

const failed = results.filter((x) => !x.pass);
console.log('\n카테고리별:', Object.entries(CAT).map(([c, v]) => `${c} ${v.pass}/${v.total}`).join(' · '));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
