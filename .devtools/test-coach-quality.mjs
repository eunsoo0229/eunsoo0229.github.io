// 자체 AI 코치 품질 평가 — 의도 · 기술 식별 · 근거 · 완전성 · 원문 보존 · 지어낸 내용 · 후속 질문 ·
// 기능 라우팅 · 자료 부족 거절 · 미트 연동 · 개인화 · AI 호출 0. Real MARTIALDEX data + the app's real stores.
//
// "지어낸 내용" is measured, not eyeballed: every content word of an answer must come from
//   (the data of the techniques the answer is about) ∪ (the question) ∪ (the coach's own template
//   vocabulary — Hangul words in the string literals of src/lib/coachKnowledge/*.ts) ∪ (technique / art names).
//
// BEFORE=1 runs the SAME cases on the pre-change copies of the coach modules (scratchpad snapshot,
// path in BEFORE_DIR) — used to report before/after. Run: node .devtools/test-coach-quality.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BEFORE = process.env.BEFORE === '1';
const BEFORE_DIR = process.env.BEFORE_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-quality-'));
const out = path.join(dir, 'q.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
const has = (p) => fs.existsSync(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as Q from ${mod('src/lib/coachKnowledge/questions.ts')};`,
    `export * as F from ${mod('src/lib/coachKnowledge/featureCatalog.ts')};`,
    `export { buildLocalOneOffLesson } from ${mod('src/lib/coachLesson/oneOff.ts')};`,
    `export { oneOffPractice } from ${mod('src/lib/coachLesson/oneOffMitt.ts')};`,
    `export { planPractice } from ${mod('src/lib/aiCoachDay/practicePlan.ts')};`,
    `export { resolveTechnique, getUnifiedAllTechniques } from ${mod('src/lib/userTechniques/service.ts')};`,
    `export { saveLessonLog } from ${mod('src/lib/coachLesson/lessonLog.ts')};`,
    `export { recordTrainingSession } from ${mod('src/lib/trainingHistory/service.ts')};`,
    `export { guardAccountSwitch } from ${mod('src/lib/auth/deviceAccountGuard.ts')};`,
    `export { martialdexCoach } from ${mod('src/lib/coachProvider/backend.ts')};`,
    `export { martialArtSummaries } from ${mod('src/lib/loadData.ts')};`,
  ].join('\n')
);
// BEFORE: serve the snapshot's source for these files (relative imports still resolve from the real folder)
const SNAPSHOT = { 'src/lib/coachKnowledge/answerability.ts': 'answerability.ts', 'src/lib/coachKnowledge/questions.ts': 'questions.ts', 'src/lib/coachKnowledge/featureCatalog.ts': 'featureCatalog.ts', 'src/lib/coachKnowledge/lookup.ts': 'lookup.ts', 'src/lib/coachLesson/oneOff.ts': 'oneOff.ts' };
const beforePlugin = {
  name: 'before-snapshot',
  setup(b) {
    if (!BEFORE) return;
    for (const [rel, file] of Object.entries(SNAPSHOT)) {
      const abs = path.join(APP, rel);
      b.onLoad({ filter: new RegExp(`^${abs.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`) }, () => ({ contents: fs.readFileSync(path.join(BEFORE_DIR, file), 'utf8'), loader: 'ts', resolveDir: path.dirname(abs) }));
    }
  },
};

// ---- browser globals (storage with key()/length for the account guard), counted AI bridges
const calls = { gemini: 0, local: 0, web: 0 };
const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
globalThis.window = {
  localStorage: storage,
  dispatchEvent: () => true,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
  location: { href: 'http://localhost/', search: '', hash: '', reload() {} },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: {
    askAi: async () => (calls.gemini++, { ok: false, code: 'X', message: 'no' }),
    webSearch: async () => (calls.web++, { ok: false }),
    localAi: { status: async () => ({ ok: true, running: true, model: 'fake', models: ['fake'], reason: null }), ask: async () => (calls.local++, { ok: true, text: 'x', model: 'fake', evalCount: 1, ms: 1 }) },
  },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [beforePlugin, viteGlobPlugin] });
const K = await import(pathToFileURL(out).href);
const { Q, F } = K;
const T = (id) => K.resolveTechnique(id);

// ---- the "invented content" checker
const tok = (s) => (s.normalize('NFKC').toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g) ?? []).map((w) => w.replace(/(으로|에서|에게|까지|부터|이랑|하고|해서|하면|하는|하기|합니다|입니다|습니다|을|를|이|가|은|는|에|의|로|와|과|도|만|요)$/, '')).filter((w) => w.length >= 2);
const templateVocab = new Set();
for (const f of fs.readdirSync(path.join(APP, 'src/lib/coachKnowledge'))) {
  // the code's Hangul words with comments removed (= the coach's own sentence templates and labels)
  const code = fs.readFileSync(path.join(APP, 'src/lib/coachKnowledge', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/ .*$/gm, ' ');
  for (const w of tok(code)) templateVocab.add(w);
}
for (const a of K.martialArtSummaries) for (const w of tok(`${a.nameKo} ${a.nameEn ?? ''} ${a.id}`)) templateVocab.add(w);
function dataText(t) {
  const p = t.posture ?? {};
  return [t.name, t.koreanName ?? '', ...t.aliases, t.category, t.description, t.purpose ?? '', ...t.positions, ...t.principles, t.difficulty ?? '', p.overview ?? '', p.startingPosition ?? '', ...(p.steps ?? []), ...(p.keyPoints ?? []), ...(p.commonMistakes ?? []), ...Object.values(p.bodyPosition ?? {})].join(' ');
}
const covered = (word, pool) => pool.some((p) => p.includes(word) || (word.length >= 3 && word.includes(p) && p.length >= 2));
/** Content words of `answer` found in none of the allowed sources (should be []). */
function invented(answer, question, techniques) {
  const pool = [...new Set([...tok(question), ...techniques.flatMap((t) => tok(dataText(t)))])];
  const allNames = techniques.length ? [] : [];
  return [...new Set(tok(answer))].filter((w) => !templateVocab.has(w) && !covered(w, pool) && !allNames.includes(w));
}

const results = [];
const CAT = {};
function check(cat, name, pass, detail = '') {
  results.push({ cat, name, pass });
  (CAT[cat] ??= { pass: 0, total: 0 }).total++;
  if (pass) CAT[cat].pass++;
  console.log((pass ? 'PASS' : 'FAIL') + ` — [${cat}] ${name}` + (detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''));
}
async function ask(current, q, context) {
  try {
    return await Q.answerCoachQuestion(current, q, { useModel: false, context });
  } catch (e) {
    return { kind: 'error', text: String(e), techniqueIds: [] };
  }
}
const techsOf = (a) => (a.techniqueIds ?? []).map(T).filter(Boolean);
const jab = T('kickboxing__jab');

// =============================================================== 1-6, 9: single questions
{
  let a = await ask(null, '잽 어떻게 해?');
  const jp = jab.posture;
  check('의도', '"잽 어떻게 해?" → 수행 방법(단일 기술)', a.kind === 'single' && a.techniqueIds?.[0] === jab.id, a.kind);
  check('완전성', '수행 방법 답에 자료의 개요·단계·핵심 포인트·흔한 실수가 모두 들어감', !!jp && [jp.overview?.slice(0, 20), jp.steps?.[0]?.slice(0, 15), jp.keyPoints?.[0]?.slice(0, 12), jp.commonMistakes?.[0]?.slice(0, 12)].filter(Boolean).every((x) => a.text.includes(x)), a.text.slice(0, 200));
  check('지어낸 내용', '"잽 어떻게 해?" 답에 근거 없는 단어 없음', invented(a.text, '잽 어떻게 해?', [jab]).length === 0, invented(a.text, '잽 어떻게 해?', [jab]));
  const ctx1 = a.context;
  a = await ask(null, '칠 때 발은?', ctx1);
  check('후속 질문', '"잽 어떻게 해?" 뒤 "칠 때 발은?" → 잽의 발 자료', a.techniqueIds?.[0] === jab.id && /발/.test(a.text) && !/수행 방법/.test(a.text), a.text.slice(0, 160));
  a = await ask(null, '흔한 실수는?', a.context ?? ctx1);
  check('후속 질문', '이어서 "흔한 실수는?" → 같은 기술의 흔한 실수 (자료 원문)', a.techniqueIds?.[0] === jab.id && jp.commonMistakes.slice(0, 1).every((m) => a.text.includes(m)), a.text.slice(0, 160));
  a = await ask(null, 'Jab은 어떻게 쳐?');
  check('기술 식별', '영어 기술명 "Jab" → 잽', a.techniqueIds?.[0] === jab.id, a.techniqueIds);
  a = await ask(jab, '왜 자꾸 균형이 무너지지?');
  check('근거 정확성', '"왜 자꾸 균형이 무너지지?" → 사용 목적·포지션 목록으로 답하지 않음 (개선 전 오답)', !/거리별 포지션|사용 목적·상황/.test(a.text) && a.kind !== 'error', a.text.slice(0, 200));
  check('지어낸 내용', '균형 질문 답에 근거 없는 단어 없음', invented(a.text, '왜 자꾸 균형이 무너지지?', [jab]).length === 0, invented(a.text, '왜 자꾸 균형이 무너지지?', [jab]));
  a = await ask(jab, '이거랑 더블렉은 뭐가 달라?');
  check('기술 식별', '"이거랑 더블렉은 뭐가 달라?" → 잽과 더블 레그 비교 (표기 "더블렉")', a.kind === 'compare' && a.techniqueIds?.includes('wrestling__basic-double-leg'), { kind: a.kind, ids: a.techniqueIds });
  check('원문 보존', '비교 답의 각 기술 설명은 그 기술 자료 원문', a.kind === 'compare' && techsOf(a).every((t) => !t.posture?.overview || a.text.includes(t.posture.overview.slice(0, 20))), a.text.slice(0, 160));
  a = await ask(jab, '상대가 계속 태클 걸면?');
  check('근거 정확성', '"상대가 계속 태클 걸면?" → 자료에 테이크다운 방어로 적힌 스프롤 포함, 페인트 제외', a.techniqueIds?.includes('wrestling__sprawl') && !a.techniqueIds?.includes('kickboxing__level-change-feint'), a.techniqueIds);
  check('지어낸 내용', '태클 대처 답에 근거 없는 단어 없음', invented(a.text, '상대가 계속 태클 걸면?', techsOf(a)).length === 0, invented(a.text, '상대가 계속 태클 걸면?', techsOf(a)));
  a = await ask(jab, '이 기술 다음엔 뭘 배우는 게 좋아?');
  check('근거 정확성', '"이 기술 다음엔 뭘 배우는 게 좋아?" → 기술 관계 자료의 다음 기술(크로스 등), 관계 종류 표시', a.kind === 'next' && a.techniqueIds?.includes('kickboxing__cross') && /다음 기술|연결 기술/.test(a.text), a.text.slice(0, 200));
  a = await ask(null, '잽의 목적은?');
  check('자료 부족', '"잽의 목적은?" → 포지션 목록을 목적이라고 답하지 않음', !/거리별 포지션/.test(a.text), a.text.slice(0, 160));
  a = await ask(null, '잽 칠 때 숨은 어떻게 쉬어?');
  check('자료 부족', '자료에 없는 질문(호흡) → 찾지 못했다고 거절, 다른 필드로 억지 답변 없음', /찾지 못했습니다|내용이 없습니다/.test(a.text) && !/견제 펀치/.test(a.text), a.text.slice(0, 160));
  a = await ask(null, '페인트는 어떻게 해?');
  check('기술 식별', '모호한 이름("페인트") → 후보 제시, 자동 선택 없음', a.kind === 'ambiguous', a.kind);
  a = await ask(T('bjj__rear-naked-choke'), '발은 어떻게 해요?');
  check('자료 부족', 'RNC 발 위치(자료 없음) → 거절', /내용이 없습니다/.test(a.text), a.text.slice(0, 120));
  a = await ask(T('bjj__rear-naked-choke'), '팔은 어디에 두고 발은 어떻게 해요?');
  check('자료 부족', '일부만 있는 질문 → 확인된 것과 안 된 것 분리', /확인되지 않았습니다/.test(a.text) && /팔/.test(a.text), a.text.slice(0, 160));
  a = await ask(null, '클로즈드 가드에서 쓸 수 있는 기술은?');
  check('근거 정확성', '상황별 기술 → 그 상황으로 표시된 기술만', a.kind === 'situation' && techsOf(a).length > 0 && techsOf(a).every((t) => t.positions.some((p) => /클로즈드 가드|Closed Guard/i.test(p))), a.techniqueIds?.slice(0, 4));
  const listCtx = a.context;
  a = await ask(null, '그거 어떻게 해?', listCtx);
  check('후속 질문', '여러 기술을 나열한 뒤 "그거" → 임의 선택 없이 확인', a.kind === 'ambiguous', a.kind);
  a = await ask(null, '암바 어떻게 해?', listCtx);
  const armCtx = a.context;
  const act = F.planCoachAction('그거 연습하고 싶어', { current: armCtx?.focusId ? T(armCtx.focusId) : null, listed: (armCtx?.listedIds ?? []).map(T) });
  check('후속 질문', '"암바 어떻게 해?" 뒤 "그거 연습하고 싶어" → 암바를 대상으로 처리 (그라운드라 미트로 열지 않음)', act && !act.ok && /암바|Armbar/.test(act.message), act);
}

// =============================================================== 8. 기능 라우팅 + 미트 연동
{
  const r = (t, c = {}) => F.planCoachAction(t, { camera: true, ...c });
  check('라우팅', '"레슬링 솔로 드릴 하고 싶어" → 미트 공격 지시(레슬링)', r('레슬링 솔로 드릴 하고 싶어')?.route === '/coach/mitt?tab=command&art=wrestling');
  check('미트 연동', '"복싱 미트 훈련 하고 싶어" → 복싱 미트 공격 지시', r('복싱 미트 훈련 하고 싶어')?.route === '/coach/mitt?tab=command&art=boxing', r('복싱 미트 훈련 하고 싶어'));
  check('미트 연동', '"무에타이 콤보 미트 하고 싶어" → 무에타이 추천 콤보 탭', r('무에타이 콤보 미트 하고 싶어')?.route === '/coach/mitt?tab=db&art=muay-thai', r('무에타이 콤보 미트 하고 싶어'));
  check('미트 연동', '"더블렉 연습하고 싶어" → 미트 테이크다운 진입(단일 기술)', decodeURIComponent(r('더블렉 연습하고 싶어')?.route ?? '') === '/coach/mitt?combo=single:wrestling__basic-double-leg');
  check('미트 연동', '그라운드 기술("암바 미트로 연습하고 싶어")은 미트로 열지 않음', r('암바 미트로 연습하고 싶어')?.ok === false);
  check('미트 연동', '"주짓수 그라운드 미트 하고 싶어" → 지원하지 않음을 알림', r('주짓수 그라운드 미트 하고 싶어')?.ok === false && r('주짓수 그라운드 미트 하고 싶어')?.reason === 'unsupported');
  check('라우팅', '기술 질문은 화면을 열지 않음', r('잽 어떻게 해?') === null && r('상대가 계속 태클 걸면?') === null);
}

// =============================================================== lesson plans: own coach vs the Gemini coach's mitt choice
{
  const lesson = (req) => K.buildLocalOneOffLesson(req, null);
  const mitt = (l) => (l.ok ? K.oneOffPractice(l.lesson) : null);
  let l = lesson('MMA 타격 수업 하고 싶어');
  check('미트 연동', '"MMA 타격 수업 하고 싶어" → 자체 코치가 DB 기술로 수업을 만들고 실습은 기존 미트 (개선 전: 거절)', l.ok && !!mitt(l)?.mitt, l.ok ? { tech: l.lesson.techniqueId, mitt: mitt(l)?.mitt?.techniqueIds } : l.code);
  l = lesson('레슬링 테이크다운 수업');
  check('미트 연동', '"레슬링 테이크다운 수업" → 테이크다운 진입을 미트로', l.ok && !!mitt(l)?.mitt, l.ok ? l.lesson.techniqueId : l.code);
  l = lesson('주짓수 그라운드 수업');
  check('미트 연동', '"주짓수 그라운드 수업" → 그라운드 기술, 미트 아님', l.ok && !mitt(l)?.mitt, l.ok ? { tech: l.lesson.techniqueId, mode: mitt(l)?.mode } : l.code);
  l = lesson('오늘은 거리 조절 전략을 배우고 싶어');
  check('자료 부족', '자료에 없는 주제 → 자체 코치는 거절 (억지 수업 없음)', !l.ok && l.code === 'NOT_IN_DB', l.code);
  // the same techniques: the Gemini coach's practice plan (planPractice) vs the 자체 코치's lesson practice
  const ids = ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__low-kick', 'kickboxing__teep', 'wrestling__basic-double-leg', 'bjj__armbar'];
  const diff = [];
  for (const id of ids) {
    const t = T(id);
    const gem = !!K.planPractice(t, { location: null, mma: false, submissionGoal: false, seconds: 120, art: t.martialArt }).mitt;
    // the technique given by id (a name like "크로스" exists in several arts → the student would pick first)
    const own = K.buildLocalOneOffLesson(`${t.koreanName ?? t.name} 배우고 싶어`, null, { techniqueId: id });
    const o = own.ok ? !!mitt(own)?.mitt : null;
    if (gem !== o) diff.push({ id, gemini: gem, own: o });
  }
  check('미트 연동', 'Gemini 코치가 미트를 쓰는 기술은 자체 코치 수업도 미트를 씀 (같은 실습 계획)', diff.length === 0, diff);
}

// =============================================================== personalization (the app's real stores)
{
  const noRecords = K.buildLocalOneOffLesson('MMA 타격 수업 하고 싶어', null);
  check('개인화', '기록이 없으면 수준을 단정하지 않음 ("학습 기록 없음")', noRecords.ok && /학습 기록이 없어|기록 없음/.test(`${noRecords.lesson.intro} ${noRecords.lesson.personalization}`), noRecords.ok ? noRecords.lesson.personalization : noRecords.code);
  let r = await ask(null, '내 학습 기록 알려줘');
  check('개인화', '기록이 없을 때 "내 학습 기록" → 없음 (지어내지 않음)', /학습 기록이 없습니다/.test(r.text), r.text.slice(0, 120));
  // seed real records: jab practiced (training history), cross weak in an AI coach lesson
  const today = new Date().toISOString().slice(0, 10);
  try {
    K.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ['kickboxing__jab'], completed: true, estimatedMinutes: 10, source: 'free_training' });
    K.saveLessonLog({ id: 'q-1', kind: 'one_off', title: '크로스', date: today, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), curriculumId: null, day: null, historyEntryId: null, techniques: [{ techniqueId: 'kickboxing__cross', name: 'Cross', overall: 'weak', practiced: true, concepts: [{ id: 'kp-0', label: '뒷발 회전', explain: '', reference: '', status: 'weak' }] }], qa: [], recap: null, updatedAt: new Date().toISOString(), coachKind: 'martialdex' });
  } catch (e) {
    console.log('seed error', String(e));
  }
  r = await ask(null, '내 학습 기록 알려줘');
  check('개인화', '기록이 생기면 실제 저장소에서 읽은 숫자로 요약 (숙달 단정 없음)', /기록이 있는 기술 \d+개/.test(r.text) && /숙달로 보지 않습니다/.test(r.text), r.text.slice(0, 200));
  r = await ask(null, '뭘 복습하면 좋을까?');
  check('개인화', '"뭘 복습하면 좋을까?" → 기록상 약한 크로스 + 기록의 이유', r.kind === 'review' && r.techniqueIds?.includes('kickboxing__cross') && /뒷발 회전|이해|약/.test(r.text), r.text.slice(0, 200));
  const l = K.buildLocalOneOffLesson('MMA 타격 수업 하고 싶어', null);
  check('개인화', '기록이 있으면 MMA 타격 수업 = 복습(크로스) + 새 기술(배운 잽 제외), 실습은 미트', l.ok && /복습/.test(l.lesson.intro) && /크로스|Cross/.test(l.lesson.intro) && l.lesson.techniqueId !== 'kickboxing__jab' && !!K.oneOffPractice(l.lesson)?.mitt, l.ok ? { tech: l.lesson.techniqueId, intro: l.lesson.intro.slice(60, 260), mitt: K.oneOffPractice(l.lesson)?.mitt?.techniqueIds } : l.code);
  r = await ask(jab, '이 기술 다음엔 뭘 배우는 게 좋아?');
  // (2026-10-25, 5th round: answer format changed to "크로스(Cross) — <relation>, 기록: …"; the record status is still required)
  check('개인화', '다음 기술 추천에 각 기술의 실제 기록 상태 표시 (크로스: 기록 있음)', r.kind === 'next' && /크로스\(Cross\) — [^/]*기록: /.test(r.text), r.text.slice(0, 220));
  // another account signs in on this device → the app clears the previous user's local data
  window.localStorage.setItem('mdx:last-auth-user-id', 'user-a');
  K.guardAccountSwitch('user-b');
  r = await ask(null, '내 학습 기록 알려줘');
  check('개인화', '다른 계정으로 로그인하면 이전 사용자의 기록을 쓰지 않음 (앱의 계정 전환 처리)', /학습 기록이 없습니다/.test(r.text), r.text.slice(0, 120));
  // a corrupted store must not make the coach invent records
  window.localStorage.setItem('martialdex:training-history', '{not json');
  r = await ask(null, '내 학습 기록 알려줘');
  check('개인화', '저장소 읽기 실패 → 기록을 지어내지 않음', r.kind !== 'error' && !/기록이 있는 기술 [1-9]/.test(r.text), r.text.slice(0, 120));
}

// =============================================================== 10. no AI on the 자체 코치's direct path
{
  await K.martialdexCoach.answerQuestion({ technique: jab, question: '잽 어떻게 해?', dayContext: '', history: [], place: '' });
  check('AI 호출', '전 과정에서 Gemini 0 · 웹 검색 0 · 로컬 모델 0', calls.gemini === 0 && calls.web === 0 && calls.local === 0, calls);
}

const failed = results.filter((x) => !x.pass);
console.log('\n카테고리별:', Object.entries(CAT).map(([c, v]) => `${c} ${v.pass}/${v.total}`).join(' · '));
console.log(`${results.length - failed.length}/${results.length} passed${BEFORE ? ' (BEFORE snapshot)' : ''}`);
process.exit(failed.length ? 1 : 0);
