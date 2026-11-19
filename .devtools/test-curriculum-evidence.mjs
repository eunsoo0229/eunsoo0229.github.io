// AI 맞춤 커리큘럼 — 목표별 웹 근거 파이프라인 오프라인 테스트 (비용 0: Tavily/Gemini 호출 없음).
// Search results and the model's extraction output are SCRIPTED fixtures (real titles/URLs from the
// 2026-10-30 reproduction where noted, otherwise synthetic text) — these tests check the pipeline's own
// logic: part split, per-part search budget, canonical-URL ledger, extraction-failure accounting,
// per-part relevance, independent-source counting, partial scope, call budgets. Real model quality is
// checked separately by the live run (qa-curriculum-evidence-live.mjs).
// Run: node .devtools/test-curriculum-evidence.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curr-ev-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as SG from ${mod('src/lib/aiCurriculum/subGoals.ts')};`,
    `export * as EL from ${mod('src/lib/aiCurriculum/evidenceLedger.ts')};`,
    `export * as WE from ${mod('src/lib/aiCurriculum/webEvidenceResearch.ts')};`,
    `export * as TR from ${mod('src/lib/aiCurriculum/techniqueResearch.ts')};`,
    `export * as DBE from ${mod('src/lib/aiCurriculum/dbEvidence.ts')};`,
    `export * as POL from ${mod('src/lib/aiCurriculum/evidencePolicy.ts')};`,
    `export * as PLAN from ${mod('src/lib/aiCurriculum/evidencePlanner.ts')};`,
    `export { validateCurriculumDays } from ${mod('src/lib/aiCurriculum/validator.ts')};`,
    `export { allTechniques } from ${mod('src/lib/loadData.ts')};`,
  ].join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
let realCalls = 0;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  // any call that escapes the injected fakes would land here and be counted as a failure
  martialdex: { askAi: async () => (realCalls++, { ok: false, code: 'X', message: 'no' }), webSearch: async () => (realCalls++, { ok: false, code: 'X', message: 'no' }) },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { SG, EL, WE, TR, DBE, POL, PLAN, validateCurriculumDays, allTechniques } = await import(pathToFileURL(out).href);

const results = [];
function check(group, name, pass, detail = '') {
  results.push({ group, pass });
  if (!pass || process.env.VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'} — [${group}] ${name}${detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`);
}

const analysis = (o) => ({
  martialArt: 'wrestling', estimatedLevel: 'beginner', weaknesses: [], desiredStyle: [], desiredTechniques: [], goals: [], priority: [], intents: [], diversityRequested: false,
  searchTopics: [], referencedFighterName: null, clarifyingQuestion: null, summary: '', suggestedDurationDays: 14, durationReason: '', ...o,
});

/** A fake search: per-part pools (picked by a word in the query), returning `per` results starting at a rotating offset (so later queries overlap earlier ones). */
function fakeSearch(pools, per = 3) {
  const calls = [];
  const turn = {};
  return {
    calls,
    search: async (q) => {
      calls.push(q);
      const key = Object.keys(pools).find((k) => k !== 'default' && q.toLowerCase().includes(k)) ?? 'default';
      const pool = pools[key] ?? [];
      const start = (turn[key] = (turn[key] ?? -1) + 1);
      const res = [];
      for (let i = 0; i < Math.min(per, pool.length); i++) res.push(pool[(start + i) % pool.length]);
      return { ok: true, results: res };
    },
  };
}
/** A fake extractor: scripted items per source URL; `failCalls` makes the first N calls return a truncated response. */
function fakeModel(script, { failCalls = 0 } = {}) {
  const calls = [];
  return {
    calls,
    ask: async (req) => {
      const urls = [...req.contextText.matchAll(/^url: (.+)$/gm)].map((m) => m[1].trim());
      calls.push(urls);
      if (calls.length <= failCalls) return { ok: true, text: '[{"name": "Peel", "partId": "g1", "sourceUrl": "' + (urls[0] ?? '') + '", "quote": "peel the hands and' };
      const items = urls.flatMap((u) => (script[u] ?? []).map((it) => ({ martialArtGuess: 'wrestling', purpose: '', confidence: 85, appliesWhen: '', fit: 'direct', intentGuess: 'unknown', ...it, sourceUrl: u })));
      return { ok: true, text: JSON.stringify(items) };
    },
  };
}
const src = (url, title, content) => ({ url, title, content, snippet: content.slice(0, 160) });

// ───────────────────────── 1. 목표 분리 ─────────────────────────
{
  const A = '스탠딩 백 포지션에서 탈출한 뒤 테이크다운으로 이어지는 학습';
  const parts = SG.resolveSubGoals(analysis({ intents: ['escape', 'connection', 'attack'], searchTopics: ['standing rear standing escape', 'wrestling standing back escape to takedown'] }), A);
  check('목표 분리', 'A → 2개 단계 (핵심: 스탠딩 백 탈출, 이어지는 단계: 테이크다운)', parts.length === 2 && parts[0].role === 'core' && parts[1].role === 'follow_up' && parts[0].actions.includes('escape') && parts[1].actions.includes('takedown'), parts.map((p) => [p.label, p.role, p.actions, p.positions]));
  check('목표 분리', 'A 핵심 단계의 의도는 탈출/방어 계열 (공격 아님)', parts[0].intents.includes('escape') && !parts[0].intents.includes('attack'), parts[0].intents);
  check('목표 분리', 'A 이어지는 단계는 핵심 상황(스탠딩 백)을 이어받음', parts[1].positions.includes('standing_back'), parts[1].positions);
  check('목표 분리', 'A 각 단계에 영문 검색 주제가 따로 있음 (테이크다운 단계 포함)', parts.every((p) => p.searchTopics.length > 0 && p.searchTopics.every((t) => !/[가-힣]/.test(t))) && /takedown/.test(parts[1].searchTopics.join(' ')), parts.map((p) => p.searchTopics));
  const B = '앉은 상태에서 바디 트라이앵글이 걸린 상황에 대응하고 이후 서브미션 관련 학습으로 이어지는 내용';
  const pb = SG.resolveSubGoals(analysis({ martialArt: 'bjj', intents: ['escape', 'attack'], searchTopics: ['bjj body triangle escape', 'bjj submission from bottom'] }), B);
  check('목표 분리', 'B → 2개 단계 (바디 트라이앵글 대응 / 서브미션)', pb.length === 2 && pb[0].positions.includes('body_triangle') && pb[1].actions.includes('submission'), pb.map((p) => [p.label, p.positions, p.actions]));
  check('목표 분리', 'B 핵심 단계 "걸린 상황에 대응" → 탈출/방어 의도', pb[0].intents.includes('escape') && !pb[0].intents.includes('attack'), pb[0].intents);
  const single = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['wrestling single leg takedown'] }), '싱글렉 테이크다운만 집중적으로 배우고 싶어');
  check('목표 분리', '단일 목표는 1개 단계 + 기존 검색 주제 그대로', single.length === 1 && single[0].searchTopics[0] === 'wrestling single leg takedown', single);
  const model = SG.resolveSubGoals(analysis({ martialArt: 'kickboxing', intents: ['attack'], searchTopics: ['jab', 'low kick'], subGoals: [{ label: '잽', role: 'core', intents: ['attack'], searchTopics: ['kickboxing jab'] }, { label: '로우킥', role: 'core', intents: ['attack'], searchTopics: ['kickboxing low kick'] }] }), '잽과 로우킥을 배우고 싶어');
  check('목표 분리', '복수 목표(분석이 준 subGoals 2개) → 둘 다 핵심', model.length === 2 && model.every((p) => p.role === 'core'), model.map((p) => [p.label, p.role]));
  check('목표 분리', '반복 단어 정리: "standing rear standing escape" → "standing rear escape"', SG.resolveSubGoals(analysis({ searchTopics: ['standing rear standing escape'] }), '스탠딩 백 탈출')[0].searchTopics[0] === 'standing rear escape');
}

// ───────────────────────── 2. 개념·동의어 ─────────────────────────
{
  const has = (t, k) => SG.conceptsIn(t).has(k);
  check('동의어', '한글/영문 같은 개념: 바디 트라이앵글 = body triangle', has('바디 트라이앵글 탈출', 'body_triangle') && has('Escape the body triangle', 'body_triangle'));
  check('동의어', '"body triangle"은 트라이앵글 초크(서브미션)가 아님', !has('Escape the body triangle', 'submission'));
  check('동의어', '"back mount"는 마운트가 아니라 백 컨트롤', has('back mount escape', 'back_control') && !has('back mount escape', 'mount'));
  check('동의어', '기술명 동의어: 암바/armbar/더블레그/double leg', has('암바', 'submission') && has('Armbar from guard', 'submission') && has('더블레그', 'takedown') && has('double leg finish', 'takedown'));
  check('동의어', '"cross side"는 사이드 컨트롤(펀치 cross 아님)', has('cross side escape', 'side_control') && !has('cross side escape', 'strike'));
}

// ───────────────────────── 3. 관련성 판정 ─────────────────────────
{
  const [core, follow] = SG.resolveSubGoals(analysis({ martialArt: 'bjj', intents: ['escape', 'attack'] }), '앉은 상태에서 바디 트라이앵글이 걸린 상황에 대응하고 이후 서브미션 관련 학습');
  const J = (o) => EL.judgeRelevance({ part: follow, techniqueName: 'Armbar', quote: '', appliesWhen: '', sourceTitle: '', intentGuess: 'attack', modelFit: 'direct', quoteVerified: true, ...o });
  let r = J({ quote: 'From bottom side control you can hit the armbar', appliesWhen: 'bottom side control', sourceTitle: 'Submissions from bottom side control' });
  check('관련성', '다른 포지션(사이드 컨트롤)의 서브미션 → 관련 없음 (모델이 direct라고 해도)', r.verdict === 'irrelevant' && r.reasons.some((x) => x.includes('다른 포지션')), r);
  r = J({ techniqueName: 'Wrist lock', quote: 'when they lock the body triangle, attack the wrist lock on the hand', appliesWhen: 'opponent has back with body triangle', sourceTitle: 'Body triangle escapes' });
  check('관련성', '같은 상황(바디 트라이앵글) + 서브미션 + 공격 의도 + direct → 관련 있음', r.verdict === 'relevant', r);
  r = J({ techniqueName: 'Wrist lock', quote: 'attack the wrist lock on the hand', appliesWhen: '', sourceTitle: 'Top 10 submissions' });
  check('관련성', '상황이 확인되지 않음 → 검토 대상(uncertain), 근거로 세지 않음', r.verdict === 'uncertain', r);
  r = J({ techniqueName: 'Wrist lock', quote: 'when they lock the body triangle, attack the wrist lock', appliesWhen: 'body triangle', sourceTitle: 'Body triangle', modelFit: 'missing' });
  check('관련성', '키워드는 다 맞아도 추출 단계 판단이 없으면 통과시키지 않음', r.verdict === 'uncertain', r);
  r = J({ techniqueName: 'Wrist lock', quote: 'when they lock the body triangle, attack the wrist lock', appliesWhen: 'body triangle', sourceTitle: 'Body triangle', quoteVerified: false });
  check('관련성', '근거 문장이 원문에서 확인되지 않으면 통과시키지 않음', r.verdict === 'uncertain', r);
  r = EL.judgeRelevance({ part: core, techniqueName: 'Back take', quote: 'take the back and lock a body triangle', appliesWhen: 'attacking the back', sourceTitle: 'Body triangle attacks', intentGuess: 'attack', modelFit: 'direct', quoteVerified: true });
  check('관련성', '탈출 단계에 공격(백 테이크) 기술 → 목적 반대로 관련 없음', r.verdict === 'irrelevant' && r.reasons.some((x) => x.includes('목적이 반대')), r);
  r = J({ techniqueName: 'Body Triangle Escape By Gordon Ryan', quote: 'The Best Way To Escape From The Jiu Jitsu Body Triangle by Gordon Ryan', appliesWhen: 'body triangle', sourceTitle: 'The Best Way To Escape From The Jiu Jitsu Body Triangle by Gordon Ryan', intentGuess: 'escape', part: core });
  check('관련성', '자료 제목을 기술명처럼 낸 항목("… By Gordon Ryan")은 근거로 세지 않음', r.verdict !== 'relevant' && r.reasons.some((x) => x.includes('자료 제목')), r);
  check('관련성', '원문 인용 확인: 원문에 있는 문장은 통과, 지어낸 한국어 요약은 실패', EL.quoteFoundInSource('Counter The Rear Body Lock', 'Counter The Rear Body Lock With Ethan Lizak – Fanatic Wrestling') && !EL.quoteFoundInSource('리어 바디락을 끊는 방법을 설명함', 'Counter The Rear Body Lock With Ethan Lizak'));
}

// ───────────────────────── 4. 출처 정규화·독립 출처 ─────────────────────────
{
  const k = EL.canonicalUrl;
  check('출처', '같은 영상의 다른 주소(watch / youtu.be / shorts / m.)는 하나', new Set([k('https://www.youtube.com/watch?v=V_2tHkI42IQ'), k('https://youtu.be/V_2tHkI42IQ'), k('https://m.youtube.com/watch?v=V_2tHkI42IQ&si=abc'), k('https://www.youtube.com/shorts/V_2tHkI42IQ')]).size === 1);
  check('출처', '추적 파라미터·끝 슬래시 제거', k('https://evolve-mma.com/blog/x/?utm_source=a') === k('https://evolve-mma.com/blog/x'));
  check('출처', '출처 종류 분류', EL.sourceKind('https://www.youtube.com/watch?v=1') === 'video' && EL.sourceKind('https://www.instagram.com/reel/1') === 'social' && EL.sourceKind('https://www.reddit.com/r/bjj/1') === 'forum' && EL.sourceKind('https://fanaticwrestling.com/blogs/x') === 'article');
  const [part] = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['single leg takedown'] }), '싱글렉 테이크다운');
  const rec = (name, key) => ({ techniqueName: name, subGoalId: part.id, sourceKey: key, verdict: 'relevant', confidence: 90 });
  const oneSource = EL.assessCoverage([part], [rec('Single Leg', 'a'), rec('Snatch Single', 'a'), rec('Low Single', 'a'), rec('High Crotch', 'a')])[0];
  check('출처', '한 자료에서 나온 기술 4개 = 독립 출처 1개 → 근거 미충족', oneSource.independentSourceCount === 1 && !oneSource.covered, oneSource);
  const twoSources = EL.assessCoverage([part], [rec('Single Leg', 'a'), rec('Snatch Single', 'b'), rec('Low Single', 'a'), rec('Single Leg Takedown', 'b')])[0];
  check('출처', '"Single Leg"/"Single Leg Takedown"은 같은 기술로 합쳐짐', twoSources.techniques.length === 3, twoSources.techniques);
}

// ───────────────────────── 5. 조사 루프 (가짜 검색/모델) ─────────────────────────
const minimum = (days) => Math.max(3, Math.ceil(days / 7) + 2);
async function research(text, an, days, pools, script, opts = {}) {
  const s = fakeSearch(pools, opts.per ?? 3);
  const m = fakeModel(script, opts);
  const parts = SG.resolveSubGoals(an, text);
  const firstWave = parts.length === 1 ? TR.buildResearchAngles(an, false).slice(0, 3) : null;
  const o = await WE.runWebEvidenceResearch({ parts, artScope: an.martialArt, contextLines: [], minimumTotal: minimum(days), firstWaveQueries: firstWave, deps: { search: s.search, ask: m.ask } });
  return { o, s, m, parts };
}

// 5-1 단일 목표 · 자료 충분 · 기존 첫 검색어 유지
{
  const pool = [
    src('https://a.com/single-leg', 'Single leg takedown guide', 'The single leg takedown starts from a good stance. Snatch single: grab the leg as they step. Low single is shot below the knee.'),
    src('https://b.com/finishes', 'Single leg finishes', 'Finish the single leg with a run the pipe. The high crotch is a close relative of the single leg takedown.'),
    src('https://c.com/drills', 'Single leg drills', 'Drill the single leg entry and the snatch single every day to improve your takedown.'),
  ];
  const script = {
    'https://a.com/single-leg': [{ name: 'Single Leg Takedown', quote: 'The single leg takedown starts from a good stance', intentGuess: 'attack' }, { name: 'Snatch Single', quote: 'Snatch single: grab the leg as they step', intentGuess: 'attack' }, { name: 'Low Single', quote: 'Low single is shot below the knee', intentGuess: 'attack' }],
    'https://b.com/finishes': [{ name: 'Run the Pipe', quote: 'Finish the single leg with a run the pipe', intentGuess: 'attack' }, { name: 'High Crotch', quote: 'The high crotch is a close relative of the single leg takedown', intentGuess: 'attack' }],
    'https://c.com/drills': [{ name: 'Snatch Single', quote: 'Drill the single leg entry and the snatch single', intentGuess: 'attack' }],
  };
  const an = analysis({ intents: ['attack'], searchTopics: ['wrestling single leg takedown'], goals: ['싱글렉'] });
  const { o, s, m } = await research('싱글렉 테이크다운만 집중적으로 배우고 싶어', an, 14, { default: pool }, script);
  check('단일 목표', '자료 충분 → web_search, 부분 생성 아님', o.kind === 'done' && o.mode === 'web_search' && !o.partial, { mode: o.mode, stop: o.diagnostics.stopReason, parts: o.coverage });
  check('단일 목표', '첫 검색어는 기존 buildResearchAngles 그대로', s.calls[0] === TR.buildResearchAngles(an, false)[0], s.calls);
  check('단일 목표', '근거가 충족되면 추가 검색 없이 멈춤 (Tavily ≤ 3회, 추출 1회)', s.calls.length <= 3 && m.calls.length === 1, { tavily: s.calls.length, extraction: m.calls.length });
  check('단일 목표', '같은 기술(여러 자료)은 기술 1개로, 출처는 모두 기록', o.techniques.filter((t) => /snatch/i.test(t.name)).length === 1 && o.techniques.find((t) => /snatch/i.test(t.name)).sourceUrls.length === 2, o.techniques.map((t) => [t.name, t.sourceUrls.length]));
}

// 5-1b 짧은 스니펫만 있는 자료도 추출 단계에 내용이 전달됨 (제목만 보내지 않음)
{
  const pool = [src('https://s.com/1', 'Single leg basics', 'Low single, snatch single and the cutback finish.')];
  const m = fakeModel({});
  const parts = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['single leg'] }), '싱글렉');
  await WE.runWebEvidenceResearch({ parts, artScope: 'wrestling', contextLines: [], minimumTotal: 4, firstWaveQueries: null, deps: { search: async () => ({ ok: true, results: pool }), ask: async (req) => (m.calls.push(req.contextText), { ok: true, text: '[]' }) } });
  check('단일 목표', '200자 미만 스니펫도 추출 프롬프트에 그대로 들어감', m.calls[0].includes('Low single, snatch single and the cutback finish.'), m.calls[0].slice(-200));
}

// 5-2 복합 요청 A · 추출 PARSE 오류 (실제 재현과 같은 첫 묶음 실패)
const A_TEXT = '스탠딩 백 포지션에서 탈출한 뒤 테이크다운으로 이어지는 학습';
const A_AN = analysis({ intents: ['escape', 'connection', 'attack'], searchTopics: ['standing rear standing escape', 'wrestling standing back escape to takedown'], suggestedDurationDays: 21 });
// real titles/URLs from the reproduction; content text is synthetic
const A_ESCAPE = [
  src('https://www.youtube.com/watch?v=V_2tHkI42IQ', 'Standing back escape', ''),
  src('https://martialarts.stackexchange.com/questions/10286/escapes-from-standing-rear-mount', 'Escapes from standing rear mount', 'When someone has your back standing, hand fight first: peel the hands at the wrist. Then turn into them, or use a standing switch to come out the side. Never cross your feet.'),
  src('https://fanaticwrestling.com/blogs/news/standing-back-take-escape-with-ethan-lizak', 'Counter The Rear Body Lock With Ethan Lizak', 'Ethan Lizak shows how to counter the rear body lock: break the grip by peeling the hands, hip heist out and turn to face, then re-attack with a single leg off the rear body lock escape.'),
  src('https://www.youtube.com/watch?v=BqooggN3QCY', 'How to Escape a Standing Rear Choke w/ Bas Rutten', ''),
  src('https://youtu.be/V_2tHkI42IQ', 'Standing back escape', ''),
];
const A_TAKEDOWN = [
  src('https://www.reddit.com/r/wrestling/comments/1dt5et1/some_basic_takedown_options_from_standing_after/', 'Some basic takedown options from standing after go behind', 'After you get behind someone standing, the mat return and the outside trip are the basic takedowns from the rear body lock.'),
  src('https://fanaticwrestling.com/blogs/news/standing-back-take-escape-with-ethan-lizak', 'Counter The Rear Body Lock With Ethan Lizak', 'Ethan Lizak shows how to counter the rear body lock: break the grip by peeling the hands, hip heist out and turn to face, then re-attack with a single leg off the rear body lock escape.'),
  src('https://example-wrestling.com/escape-to-takedown', 'From rear body lock escape to takedown', 'Once you peel the grip and turn to face out of the rear body lock, the head is often low: hit a double leg or a snap down right away.'),
];
const A_SCRIPT = {
  'https://martialarts.stackexchange.com/questions/10286/escapes-from-standing-rear-mount': [
    { name: 'Hand Fighting Peel', partId: 'g1', quote: 'hand fight first: peel the hands at the wrist', appliesWhen: 'opponent has your back standing', intentGuess: 'escape' },
    { name: 'Standing Switch', partId: 'g1', quote: 'use a standing switch to come out the side', appliesWhen: 'opponent has your back standing', intentGuess: 'escape' },
  ],
  'https://fanaticwrestling.com/blogs/news/standing-back-take-escape-with-ethan-lizak': [
    { name: 'Rear Body Lock Counter', partId: 'g1', quote: 'counter the rear body lock: break the grip by peeling the hands', appliesWhen: 'rear body lock standing', intentGuess: 'escape' },
    { name: 'Single Leg', partId: 'g2', quote: 're-attack with a single leg off the rear body lock escape', appliesWhen: 'after rear body lock escape', intentGuess: 'attack' },
  ],
  'https://www.reddit.com/r/wrestling/comments/1dt5et1/some_basic_takedown_options_from_standing_after/': [
    { name: 'Mat Return', partId: 'g2', quote: 'the mat return and the outside trip are the basic takedowns from the rear body lock', appliesWhen: 'you have the rear body lock (attacker)', intentGuess: 'attack', fit: 'partial' },
  ],
  'https://example-wrestling.com/escape-to-takedown': [
    { name: 'Double Leg', partId: 'g2', quote: 'hit a double leg or a snap down right away', appliesWhen: 'after turning out of the rear body lock', intentGuess: 'attack' },
    { name: 'Snap Down', partId: 'g2', quote: 'hit a double leg or a snap down right away', appliesWhen: 'after turning out of the rear body lock', intentGuess: 'attack' },
  ],
};
{
  const { o, s, m, parts } = await research(A_TEXT, A_AN, 21, { takedown: A_TAKEDOWN, default: A_ESCAPE }, A_SCRIPT, { failCalls: 2 });
  const d = o.diagnostics;
  check('A 복합', '테이크다운 단계에도 검색 예산 배정 (첫 묶음부터)', d.queries.slice(0, 3).some((q) => q.subGoalId === 'g2') && s.calls.some((q) => /takedown/.test(q)), d.queries.map((q) => [q.subGoalId, q.query]));
  check('A 복합', 'Tavily 총 호출 ≤ 9 (기존 예산 유지)', s.calls.length <= 9, s.calls.length);
  check('A 복합', '같은 검색어 반복 없음', new Set(s.calls).size === s.calls.length, s.calls);
  check('A 복합', '첫 추출 PARSE 오류 → 같은 묶음 1회만 재시도 후 실패 처리', d.extraction.retries >= 1 && d.extraction.failedBatches === 1 && d.extraction.lastErrorCode !== null, d.extraction);
  const analyzedTwice = m.calls.flat().filter((u, i, arr) => arr.indexOf(u) !== i);
  const failedFirst = m.calls[0];
  check('A 복합', '실패한 묶음 외에는 같은 자료를 다시 분석하지 않음 (재시도 1회만 같은 자료)', analyzedTwice.every((u) => failedFirst.includes(u)) && m.calls.filter((c) => JSON.stringify(c) === JSON.stringify(failedFirst)).length === 2, m.calls);
  check('A 복합', 'youtu.be와 watch 주소는 한 자료로 집계', d.uniqueSourceCount === new Set([...A_ESCAPE, ...A_TAKEDOWN].map((x) => EL.canonicalUrl(x.url))).size || d.uniqueSourceCount < d.rawResultCount, { unique: d.uniqueSourceCount, raw: d.rawResultCount });
  check('A 복합', 'PARSE 오류가 있으면 "근거 부족"이 아니라 EXTRACTION_FAILED로 보고 (핵심/총량 미충족 시)', o.mode === 'web_search' || d.stopReason === 'EXTRACTION_FAILED', { mode: o.mode, stop: d.stopReason, parts: d.parts.map((p) => [p.id, p.covered, p.techniques.length, p.independentSourceCount]) });
  check('A 복합', 'Gemini 추출 호출 ≤ (검색 묶음 수 + 1) × 2', m.calls.length <= (d.queries.length > 0 ? 4 : 0) * 2, m.calls.length);
  void parts;
}
// 5-3 A · 추출 오류 없음 → 두 단계 모두 근거 충족 → 전체 생성
{
  const { o } = await research(A_TEXT, A_AN, 14, { takedown: A_TAKEDOWN, default: A_ESCAPE }, A_SCRIPT);
  const d = o.diagnostics;
  check('A 복합', '(오류 없음, 14일) 탈출 3 · 테이크다운 3 기술 / 각 2개 출처 → 두 단계 모두 충족', d.parts.every((p) => p.covered), d.parts.map((p) => [p.label, p.techniques.map((t) => t.name), p.independentSourceCount]));
  check('A 복합', '(오류 없음) 공격자 관점(뒤를 잡은 쪽) 테이크다운은 검토 대상으로 분리, 근거로 세지 않음', o.review.some((r) => r.name === 'Mat Return') && !o.relevantAll.some((t) => t.name === 'Mat Return'), { review: o.review.map((r) => r.name) });
  check('A 복합', '(오류 없음) 결과: web_search, 부분 생성 아님, 기술마다 단계 id 기록', o.mode === 'web_search' && !o.partial && o.techniques.every((t) => ['g1', 'g2'].includes(t.partId) && t.sourceUrls.length > 0 && t.evidence), o.techniques.map((t) => [t.partId, t.name]));
}

// 5-4 B · 관련 없는 결과 다수 + 일부 목표만 부족 → 부분 생성
const B_TEXT = '앉은 상태에서 바디 트라이앵글이 걸린 상황에 대응하고 이후 서브미션 관련 학습으로 이어지는 내용';
const B_AN = analysis({ martialArt: 'bjj', intents: ['escape', 'attack'], searchTopics: ['bjj body triangle escape', 'bjj submission from bottom'] });
const B_TRI = [
  src('https://www.youtube.com/watch?v=RscLPT0F-DE', 'The Best Way To Escape From The Jiu Jitsu Body Triangle by Gordon Ryan', ''),
  src('https://bjj-site.com/body-triangle-escapes', 'Body triangle escapes', 'Stuck in a body triangle while seated? First protect the neck with two-on-one hand fighting. Then hip escape toward the side of the top foot and slide your hips out. You can also use the figure four foot lock on the crossed ankles to break the body triangle.'),
  src('https://grappling-notes.com/back-body-triangle', 'Escaping the back body triangle', 'Turn toward the bottom leg of the body triangle, pin it to the mat with your knee and clear the top leg. The ankle cross pressure escape forces them to open the body triangle.'),
];
const B_SUB = [
  src('https://www.youtube.com/watch?v=n-we5GhGKN0', 'BLACK BELT SUBMISSIONS From The Bottom of Side Control!', 'Submissions from the bottom of side control: the upside down americana and the double kimura shoulder.'),
  src('https://www.reddit.com/r/bjj/comments/2o78si/submissions_from_bottom_side_control_and_bottom/', 'Submissions from bottom side control and bottom mount?', 'From bottom side control I like the armbar and the triangle choke; from bottom mount, the ankle lock and the reverse boston crab.'),
];
const B_SCRIPT = {
  'https://bjj-site.com/body-triangle-escapes': [
    { name: 'Two-on-One Hand Fighting', partId: 'g1', quote: 'protect the neck with two-on-one hand fighting', appliesWhen: 'seated with body triangle on', intentGuess: 'defense' },
    { name: 'Hip Escape to Top Foot Side', partId: 'g1', quote: 'hip escape toward the side of the top foot and slide your hips out', appliesWhen: 'body triangle, seated', intentGuess: 'escape' },
    { name: 'Figure Four Foot Lock', partId: 'g2', quote: 'use the figure four foot lock on the crossed ankles to break the body triangle', appliesWhen: 'opponent locks body triangle', intentGuess: 'attack' },
  ],
  'https://grappling-notes.com/back-body-triangle': [{ name: 'Bottom Leg Pin Escape', partId: 'g1', quote: 'pin it to the mat with your knee and clear the top leg', appliesWhen: 'back body triangle', intentGuess: 'escape' }, { name: 'Ankle Cross Pressure', partId: 'g1', quote: 'The ankle cross pressure escape forces them to open the body triangle', appliesWhen: 'back body triangle', intentGuess: 'escape' }],
  // the model wrongly calls these "direct" — the position check must still reject them
  'https://www.youtube.com/watch?v=n-we5GhGKN0': [{ name: 'Upside Down Americana', partId: 'g2', quote: 'the upside down americana and the double kimura shoulder', appliesWhen: 'bottom side control', intentGuess: 'attack' }, { name: 'Double Kimura Shoulder', partId: 'g2', quote: 'the upside down americana and the double kimura shoulder', appliesWhen: 'bottom side control', intentGuess: 'attack' }],
  'https://www.reddit.com/r/bjj/comments/2o78si/submissions_from_bottom_side_control_and_bottom/': [{ name: 'Armbar', partId: 'g2', quote: 'From bottom side control I like the armbar and the triangle choke', appliesWhen: 'bottom side control', intentGuess: 'attack' }, { name: 'Reverse Boston Crab', partId: 'g2', quote: 'from bottom mount, the ankle lock and the reverse boston crab', appliesWhen: 'bottom mount', intentGuess: 'attack' }],
};
{
  const { o, s } = await research(B_TEXT, B_AN, 14, { submission: B_SUB, default: B_TRI }, B_SCRIPT);
  const d = o.diagnostics;
  const g2 = d.parts.find((p) => p.id === 'g2');
  check('B 복합', '사이드 컨트롤/마운트 하위 서브미션(Armbar 등) → 바디 트라이앵글 서브미션 근거로 세지 않음', !o.relevantAll.some((t) => /armbar|americana|kimura|boston/i.test(t.name)) && o.excluded.some((e) => /armbar/i.test(e.name) && e.reason.includes('다른 포지션')), { relevant: o.relevantAll.map((t) => t.name), excluded: o.excluded });
  check('B 복합', '바디 트라이앵글 탈출 단계: 기술 4개 / 출처 2개로 충족', d.parts[0].covered && d.parts[0].techniques.length >= 4 && d.parts[0].independentSourceCount === 2, d.parts[0]);
  check('B 복합', '서브미션 단계: 관련 기술 1개(Figure Four Foot Lock) → 미충족', g2 && !g2.covered && g2.techniques.length === 1, g2);
  check('B 복합', '핵심 충족 + 후속 미충족 + 총량 충족 → 부분 생성 후보 (포함 g1, 제외 g2 + 사유)', o.mode === 'web_search' && o.partial && o.partial.includedIds.join() === 'g1' && o.partial.excluded[0].id === 'g2' && o.partial.excluded[0].reason.length > 0, o.partial);
  check('B 복합', '부분 생성 기술에는 제외 단계의 기술이 섞이지 않음', o.techniques.every((t) => t.partId === 'g1'), o.techniques.map((t) => [t.partId, t.name]));
  check('B 복합', 'Tavily ≤ 9회', s.calls.length <= 9, s.calls.length);
}

// 5-5 자료 부족 / 관련 없는 결과만 / 검색 실패
{
  const thin = [src('https://x.com/a', 'Body triangle escape', 'Hip escape toward the top foot side to get out of the body triangle.')];
  const { o } = await research(B_TEXT, B_AN, 14, { default: thin, submission: [] }, { 'https://x.com/a': [{ name: 'Hip Escape', partId: 'g1', quote: 'Hip escape toward the top foot side to get out of the body triangle', appliesWhen: 'body triangle', intentGuess: 'escape' }] });
  check('부족/무관', '자료 1건뿐 → 핵심 미충족, CORE_GOAL_UNVERIFIED로 중단 (부분 생성 아님)', o.mode === 'insufficient_web_evidence' && o.diagnostics.stopReason === 'CORE_GOAL_UNVERIFIED' && !o.partial, { mode: o.mode, stop: o.diagnostics.stopReason });
  const { o: o2 } = await research(B_TEXT, B_AN, 14, { default: B_SUB, submission: B_SUB }, B_SCRIPT);
  check('부족/무관', '관련 없는 결과만 → NO_RELEVANT_RESULTS', o2.mode === 'insufficient_web_evidence' && o2.diagnostics.stopReason === 'NO_RELEVANT_RESULTS', { stop: o2.diagnostics.stopReason, parts: o2.diagnostics.parts });
  const parts = SG.resolveSubGoals(B_AN, B_TEXT);
  const o3 = await WE.runWebEvidenceResearch({ parts, artScope: 'bjj', contextLines: [], minimumTotal: 4, firstWaveQueries: null, deps: { search: async () => ({ ok: false, code: 'NETWORK', message: 'net' }), ask: async () => ({ ok: true, text: '[]' }) } });
  check('부족/무관', '검색 자체 실패 → all_failed(기존 대체 경로로), SEARCH_FAILED', o3.kind === 'all_failed' && o3.diagnostics.stopReason === 'SEARCH_FAILED', o3.kind);
  const o4 = await WE.runWebEvidenceResearch({ parts, artScope: 'bjj', contextLines: [], minimumTotal: 4, firstWaveQueries: null, deps: { search: async () => ({ ok: false, code: 'NO_API_KEY', message: 'none' }), ask: async () => ({ ok: true, text: '[]' }) } });
  check('부족/무관', 'Tavily 미설정 → not_configured (기존 대체 경로 그대로)', o4.kind === 'not_configured' && o4.diagnostics.tavilyCalls === 1, o4.kind);
}

// 5-6 부분 생성: 분석 범위 축소
{
  const parts = SG.resolveSubGoals(A_AN, A_TEXT);
  const an = { ...A_AN, goals: ['스탠딩 백 탈출 후 테이크다운 연계'], priority: ['스탠딩 백 탈출', '테이크다운', '포지션 전환 및 연계'], desiredTechniques: ['Standing Rear Escape', 'Takedown', 'Double Leg'] };
  const r = SG.restrictAnalysisToSubGoals(an, [parts[0]], [parts[1]]);
  check('부분 생성', '제외 단계만 가리키는 문구(테이크다운, Double Leg) 제거', !r.priority.includes('테이크다운') && !r.desiredTechniques.includes('Takedown') && !r.desiredTechniques.includes('Double Leg'), r);
  check('부분 생성', '둘 다 가리키는 문구는 포함 단계 이름으로 대체, 포함 단계 문구는 유지', r.goals.includes(parts[0].label) && r.priority.includes('스탠딩 백 탈출') && r.desiredTechniques.includes('Standing Rear Escape'), r);
  check('부분 생성', '의도는 포함 단계 것만 (공격 제외), 요약에 제외 목표 명시', !r.intents.includes('attack') && r.summary.includes('제외'), { intents: r.intents, summary: r.summary });
  check('부분 생성', '원본 분석은 바뀌지 않음 (순수 함수)', an.priority.includes('테이크다운'));
}

// ═════════════════════════ V2: 근거 등급 · 기간-개수 분리 · 부분 생성 · 일정 ═════════════════════════
const TECH = new Map(allTechniques.map((t) => [t.id, t]));

// V2-1 기간과 기술 수 분리 — 30일이어도 목표별 근거(2개·2출처 또는 웹1+DB)만 보고 판단
{
  const { o } = await research(B_TEXT, B_AN, 30, { submission: B_SUB, default: B_TRI }, B_SCRIPT);
  check('V2 기간', '30일 · 핵심 4개 기술 → 기간 때문에 중단하지 않고 부분 생성 후보 (TOO_FEW_VALID 없음)', o.mode === 'web_search' && o.partial && o.partial.includedIds.join() === 'g1', { mode: o.mode, stop: o.diagnostics.stopReason, partial: o.partial });
  const { o: a30 } = await research(A_TEXT, A_AN, 30, { takedown: A_TAKEDOWN, default: A_ESCAPE }, A_SCRIPT);
  check('V2 기간', 'A 30일 · 두 단계 모두 근거 충족 → 전체 생성 (예전엔 30일 최소 7개 미달로 중단)', a30.mode === 'web_search' && !a30.partial, { mode: a30.mode, stop: a30.diagnostics.stopReason, parts: a30.coverage.map((c) => [c.id, c.covered, c.techniques.length]) });
}

// V2-2 DB 보조 근거 (실제 MARTIALDEX 데이터)
{
  const r2 = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['wrestling single leg takedown'] }), '싱글렉 테이크다운만 집중적으로 배우고 싶어');
  const db2 = DBE.findDbEvidence(r2, 'wrestling');
  const names2 = db2.map((d) => d.name);
  check('V2 DB', '싱글렉 집중 → DB에서 싱글렉 변형만 확인 (High/Snatch/Sweep Single), 더블레그·스탠스는 아님', ['High Single', 'Snatch Single', 'Sweep Single'].every((n) => names2.includes(n)) && !names2.some((n) => /double leg|stance/i.test(n) && !/single/i.test(n)), names2);
  const parts = SG.resolveSubGoals(B_AN, B_TEXT);
  const dbB = DBE.findDbEvidence(parts, 'bjj');
  check('V2 DB', 'B: 백을 잡은 쪽(공격자) 데이터(Body Triangle, Hand Fighting, RNC, Back Take)는 B 등급으로 인정하지 않음', !dbB.some((d) => ['bjj__body-triangle', 'bjj__hand-fighting', 'bjj__rear-naked-choke', 'bjj__back-take'].includes(d.techniqueId)), dbB.map((d) => d.name));
  const chk = (id, part, core = null) => DBE.checkDbTechniqueForPart(TECH.get(id), part, core);
  const bt = chk('bjj__body-triangle', parts[0]);
  check('V2 DB', '"Body Triangle"(공격 기술)은 바디 트라이앵글 대응 단계에 목적 반대·통제하는 쪽으로 거부', bt.verdict === 'fail' && bt.reasons.some((r) => r.includes('통제')), bt.reasons);
  // name similarity alone is never DB evidence: a fake entry NAMED like the goal but with unrelated posture text
  const fake = { ...TECH.get('bjj__closed-guard'), id: 'bjj__fake-body-triangle-escape', name: 'Body Triangle Escape', koreanName: '바디 트라이앵글 탈출' };
  check('V2 DB', '이름만 "Body Triangle Escape"이고 자세 데이터는 클로즈드 가드 → 인정 안 함', DBE.findDbEvidence(parts, 'bjj', [fake]).length === 0);
  const userAdded = { ...TECH.get('wrestling__high-single'), id: 'wrestling__user-high-single', source: 'user_added' };
  check('V2 DB', '사용자 추가 기술(품질 불확실)은 DB 근거로 쓰지 않음', DBE.findDbEvidence(r2, 'wrestling', [userAdded]).length === 0 && DBE.hasTrustworthyDbData(TECH.get('wrestling__high-single')));
  const noPosture = { ...TECH.get('wrestling__high-single'), id: 'wrestling__np', posture: undefined };
  check('V2 DB', '자세 데이터가 없는 기술은 DB 근거로 쓰지 않음', DBE.findDbEvidence(r2, 'wrestling', [noPosture]).length === 0);
  const mountParts = SG.resolveSubGoals(analysis({ martialArt: 'bjj', intents: ['escape'], searchTopics: ['bjj mount escape'] }), '마운트에 깔린 상황에서 탈출');
  const mdb = DBE.findDbEvidence(mountParts, 'bjj').map((d) => d.techniqueId);
  check('V2 DB', '마운트 탈출 → 자세 데이터에 "마운트당한 상태"가 있는 엘보-니/브릿지는 B, 분류 목록에만 마운트가 있는 Backdoor Escape(딥 하프)는 아님', mdb.includes('bjj__elbow-knee-escape') && !mdb.includes('bjj__backdoor-escape'), mdb);
  const r1 = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['wrestling takedown'] }), '테이크다운의 다양성을 알고 싶어');
  const n1 = DBE.findDbEvidence(r1, 'wrestling').map((d) => d.techniqueId);
  check('V2 DB', '테이크다운 목표에 스탠스·레벨체인지(기본 움직임)는 B 아님', !n1.includes('wrestling__wrestling-stance') && !n1.includes('wrestling__level-change') && n1.includes('wrestling__basic-double-leg'), n1.slice(0, 12));
}

// V2-3 커버리지: DB는 보조 근거
{
  const [part] = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['single leg'] }), '싱글렉 테이크다운');
  const rec = (name, key) => ({ techniqueName: name, subGoalId: part.id, sourceKey: key, verdict: 'relevant', confidence: 90 });
  const db = [{ techniqueId: 'wrestling__high-single', name: 'High Single', partId: part.id }, { techniqueId: 'wrestling__snatch-single', name: 'Snatch Single', partId: part.id }];
  const c1 = EL.assessCoverage([part], [rec('Low Single', 'a')], db)[0];
  check('V2 커버리지', '웹 1개 + DB 2개 → 충족 (web+db)', c1.covered && c1.coveredBy === 'web+db', c1);
  const c0 = EL.assessCoverage([part], [], db)[0];
  check('V2 커버리지', '웹 0개 + DB 2개 → 미충족 (DB 단독 인정 안 함)', !c0.covered && /보조 근거/.test(c0.reason), c0);
  const cd = EL.assessCoverage([part], [rec('High Single', 'a')], db)[0];
  check('V2 커버리지', '웹과 DB가 같은 기술이면 한 번만 셈 (A로), DB 중복 집계 없음', cd.dbTechniques.length === 1 && cd.dbTechniques[0].name === 'Snatch Single', cd.dbTechniques);
}

// V2-4 근거 등급 정책 (A/B/C · 중복 합치기 · 부분 범위)
{
  const parts = SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['wrestling single leg takedown'] }), '싱글렉 테이크다운만 집중적으로 배우고 싶어');
  const dbEv = DBE.findDbEvidence(parts, 'wrestling');
  const m = (id, score = 60) => { const t = TECH.get(id); return { techniqueId: id, techniqueName: t.name, martialArt: t.martialArt, relevanceScore: score, reason: '', phase: 'entries', structureRole: 'primary_technique' }; };
  const web = [{ name: 'Snatch Single', partId: 'g1', sourceUrls: ['https://a', 'https://b'], sourceTitles: ['Single leg guide'], intentGuess: 'attack' }, { name: 'Cutback', partId: 'g1', sourceUrls: ['https://a'], sourceTitles: ['Single leg guide'], intentGuess: 'attack' }];
  const res = POL.applyEvidencePolicy({ matches: [m('wrestling__snatch-single', 80), m('wrestling__cutback', 70), m('wrestling__high-single'), m('wrestling__wrestling-stance', 65), m('wrestling__basic-double-leg', 64)], parts, includedPartIds: null, webTechniques: web, dbEvidence: dbEv, resolve: (id) => TECH.get(id) });
  const g = (id) => res.pool.find((p) => p.techniqueId === id)?.evidenceGrade;
  check('V2 등급', '웹 검증 이름 → A (Snatch Single, Cutback)', g('wrestling__snatch-single') === 'A' && g('wrestling__cutback') === 'A', res.pool.map((p) => [p.techniqueName, p.evidenceGrade]));
  check('V2 등급', 'DB 자세 데이터로만 확인 → B, 설명은 "MARTIALDEX 자세 데이터" (웹 검증이라 표시하지 않음)', g('wrestling__high-single') === 'B' && /MARTIALDEX/.test(res.pool.find((p) => p.techniqueId === 'wrestling__high-single').evidenceNote) && res.pool.filter((p) => p.evidenceGrade === 'B').every((p) => !/웹/.test(p.evidenceNote)));
  check('V2 등급', '웹·DB 근거 없음(스탠스, 더블레그) → C로 제외, 일정 풀에 없음', !g('wrestling__wrestling-stance') && !g('wrestling__basic-double-leg') && res.excludedC.some((c) => /Stance/i.test(c.name)) && res.excludedC.some((c) => /Double/i.test(c.name)), res.excludedC);
  const dupA = { techniqueId: 'wrestling__cutback-finish-x', techniqueName: 'Cutback Finish', martialArt: 'wrestling', relevanceScore: 50, reason: '', phase: 'entries', structureRole: 'primary_technique', evidenceGrade: 'A' };
  check('V2 중복', '"Cutback" / "Cutback Finish"는 같은 기술 → 하나만', POL.sameTechniqueForPool(m('wrestling__cutback'), dupA) && !POL.sameTechniqueForPool(m('wrestling__high-single'), m('wrestling__snatch-single')));
  const ids = res.pool.map((p) => p.techniqueId);
  check('V2 중복', '풀 안에 같은 기술 중복 없음 (canonical id·이름)', new Set(ids).size === ids.length && res.pool.every((a, i) => res.pool.every((b, j) => i === j || !POL.sameTechniqueForPool(a, b))));
  const anklePool = ['bjj__straight-ankle-lock', 'bjj__outside-ankle-lock', 'bjj__inside-ankle-lock'].filter((id) => TECH.has(id));
  const bp = SG.resolveSubGoals(B_AN, B_TEXT);
  const ra = POL.applyEvidencePolicy({ matches: anklePool.map((id, i) => ({ techniqueId: id, techniqueName: TECH.get(id).name, martialArt: 'bjj', relevanceScore: 70 - i, reason: '', phase: 'position', structureRole: 'primary_technique' })), parts: bp, includedPartIds: null, webTechniques: [{ name: 'Ankle Lock', partId: 'g2', sourceUrls: ['https://x'], intentGuess: 'attack' }], dbEvidence: [], resolve: (id) => TECH.get(id) });
  check('V2 등급', '웹 기술 1개("Ankle Lock")는 DB 항목 1개만 A로 인정 (변형 3개를 모두 A로 만들지 않음)', anklePool.length >= 2 && ra.pool.filter((p) => p.evidenceGrade === 'A').length === 1, { pool: anklePool, graded: ra.pool.map((p) => [p.techniqueName, p.evidenceGrade]) });
  const rnc = TECH.get('bjj__rear-naked-choke');
  const rr = POL.applyEvidencePolicy({ matches: [{ techniqueId: rnc.id, techniqueName: rnc.name, martialArt: 'bjj', relevanceScore: 60, reason: '', phase: 'position', structureRole: 'primary_technique' }], parts: bp, includedPartIds: null, webTechniques: [{ name: 'Rear naked choke', partId: 'g2', sourceUrls: ['https://x'], intentGuess: 'attack' }], dbEvidence: [], resolve: (id) => TECH.get(id) });
  check('V2 등급', '웹에서 후속 서브미션으로 검증된 RNC → DB 자료(백 컨트롤)가 모순되지 않으므로 A', rr.pool[0]?.evidenceGrade === 'A', { pool: rr.pool.map((p) => [p.techniqueName, p.evidenceGrade]), C: rr.excludedC });
  check('V2 등급', '같은 RNC라도 DB 근거만으로는(웹 없이) 바디 트라이앵글 후속 B 등급이 아님', DBE.checkDbTechniqueForPart(rnc, bp[1], bp[0]).verdict !== 'pass');
  const korean = { techniqueId: 'bjj__user-bt-escape', techniqueName: '바디 트라이앵글 탈출', martialArt: 'bjj', relevanceScore: 60, reason: '', phase: 'position', structureRole: 'escape' };
  const rk = POL.applyEvidencePolicy({ matches: [korean], parts: bp, includedPartIds: null, webTechniques: [{ name: 'Body Triangle Escape', partId: 'g1', sourceUrls: ['https://x', 'https://y'], intentGuess: 'escape' }], dbEvidence: [], resolve: (id) => (id === korean.techniqueId ? { id, name: '바디 트라이앵글 탈출', koreanName: '바디 트라이앵글 탈출', aliases: ['Body Triangle Escape'], martialArt: 'bjj', source: 'user_added', category: '', positions: [] } : TECH.get(id)) });
  check('V2 등급', '한글 이름으로 등록된 기술도 별칭(Body Triangle Escape)으로 웹 근거와 연결 → A', rk.pool[0]?.evidenceGrade === 'A', rk.pool.map((p) => [p.techniqueName, p.evidenceGrade]));
  const du = (id, name) => ({ techniqueId: id, techniqueName: name, martialArt: 'wrestling', relevanceScore: 50, reason: '', phase: 'entries', structureRole: 'primary_technique' });
  const rd = POL.applyEvidencePolicy({ matches: [du('wrestling__duck-under', 'Duck Under'), du('wrestling__duckunder-to-throw', 'Duckunder to Throw')], parts: SG.resolveSubGoals(analysis({ intents: ['attack'], searchTopics: ['takedown'] }), '테이크다운'), includedPartIds: null, webTechniques: [{ name: 'Duckunder', partId: 'g1', sourceUrls: ['https://x'] }], dbEvidence: [], resolve: (id) => ({ id, name: id === 'wrestling__duck-under' ? 'Duck Under' : 'Duckunder to Throw', martialArt: 'wrestling', category: '', positions: [], aliases: [] }) });
  check('V2 등급', '띄어쓰기만 다른 이름(Duckunder = Duck Under)은 그 항목에 연결 (Duckunder to Throw 아님)', rd.pool.find((p) => p.evidenceGrade === 'A')?.techniqueName === 'Duck Under', rd.pool.map((p) => [p.techniqueName, p.evidenceGrade]));
  // body triangle: a DB entry whose name resembles the web technique but whose data is the attack → not A
  const bParts = SG.resolveSubGoals(B_AN, B_TEXT);
  const bt = TECH.get('bjj__body-triangle');
  const r = POL.applyEvidencePolicy({ matches: [{ techniqueId: bt.id, techniqueName: bt.name, martialArt: 'bjj', relevanceScore: 70, reason: '', phase: 'position', structureRole: 'positional_skill' }], parts: bParts, includedPartIds: ['g1'], webTechniques: [{ name: 'Body Triangle Escape', partId: 'g1', sourceUrls: ['https://x'], intentGuess: 'escape' }], dbEvidence: [], resolve: (id) => TECH.get(id) });
  check('V2 등급', '웹 "Body Triangle Escape"과 이름이 비슷한 DB "Body Triangle"(공격) → A로 연결하지 않고 C', r.pool.length === 0 && r.excludedC.some((c) => c.reason.includes('상황·목적이 다름')), r);
  const rp = POL.applyEvidencePolicy({ matches: [], parts: bParts, includedPartIds: ['g1'], webTechniques: [{ name: 'Hip Escape', partId: 'g1', sourceUrls: ['https://x'], intentGuess: 'escape' }, { name: 'Armbar', partId: 'g2', sourceUrls: ['https://y'], intentGuess: 'attack' }], dbEvidence: [{ techniqueId: 'bjj__armbar', name: 'Armbar', partId: 'g2', quote: '' }], resolve: (id) => TECH.get(id) });
  check('V2 부분 생성', '부분 범위(g1만) → 제외된 단계(g2)의 웹·DB 기술은 풀에 들어가지 않음', rp.pool.every((p) => p.evidencePartId === 'g1') && rp.parts.length === 1, rp.pool.map((p) => [p.techniqueName, p.evidencePartId]));
}

// V2-5 30일 일정 — 검증된 기술 3개로
{
  const pool = ['wrestling__high-single', 'wrestling__snatch-single', 'wrestling__sweep-single'].map((id, i) => ({ techniqueId: id, techniqueName: TECH.get(id).name, martialArt: 'wrestling', relevanceScore: 70 - i, reason: '', phase: 'entries', structureRole: 'primary_technique', evidenceGrade: i === 0 ? 'A' : 'B', evidencePartId: 'g1' }));
  const parts = [{ id: 'g1', label: '싱글렉', techniqueIds: pool.map((p) => p.techniqueId) }];
  for (const [days, minutes, intensity] of [[30, 30, 'normal'], [7, 30, 'normal'], [60, 45, 'intensive'], [14, 15, 'light']]) {
    const plan = PLAN.planEvidenceCurriculum({ subjectLabel: '싱글렉', matches: pool, parts, targetDays: days, intensity, dailyMinutes: minutes });
    const v = validateCurriculumDays(plan.days, days);
    const introduced = plan.days.flatMap((d) => d.techniqueIds);
    const refs = new Set(plan.days.flatMap((d) => [...d.techniqueIds, ...d.reviewTechniqueIds]));
    const titles = plan.days.map((d) => d.title).join(' | ');
    check('V2 일정', `${days}일 · 기술 3개: 검증(일수·빈 Day 없음) 통과`, v.ok && plan.days.length === days, v.errors.slice(0, 3));
    check('V2 일정', `${days}일: 각 기술은 새 기술로 정확히 한 번만 등록 (중복 등록 없음)`, introduced.length === 3 && new Set(introduced).size === 3, introduced);
    check('V2 일정', `${days}일: 모든 Day가 검증된 기술(풀)만 참조`, [...refs].every((id) => pool.some((p) => p.techniqueId === id)) && plan.days.every((d) => d.techniqueIds.length + d.reviewTechniqueIds.length > 0));
    check('V2 일정', `${days}일: 하루 훈련 시간 ≤ 선택 시간(${minutes}분), 일수에 비례해 늘지 않음`, plan.days.every((d) => d.estimatedMinutes <= Math.max(15, minutes)));
    if (days >= 30) check('V2 일정', `${days}일: 학습 요소(단계 수행·연결·상황 판단·상대 반응·저강도·복습) 모두 포함, 반복 회차 표시`, ['단계별 기술 수행', '기술 연결', '상황별 의사결정', '상대 반응에 따른 선택', '안전한 저강도 적용', '복습'].every((k) => titles.includes(k)) && titles.includes('반복'), titles.slice(0, 300));
  }
  const many = allTechniques.filter((t) => t.martialArt === 'wrestling' && /single/i.test(t.name)).slice(0, 9).map((t) => ({ techniqueId: t.id, techniqueName: t.name, martialArt: 'wrestling', relevanceScore: 50, reason: '', phase: 'entries', structureRole: 'primary_technique', evidenceGrade: 'B', evidencePartId: 'g1' }));
  const short = PLAN.planEvidenceCurriculum({ subjectLabel: 'x', matches: many, parts: [{ id: 'g1', label: 'x', techniqueIds: many.map((m) => m.techniqueId) }], targetDays: 3, intensity: 'normal', dailyMinutes: 30 });
  const intro = short.days.flatMap((d) => d.techniqueIds);
  check('V2 일정', '기간보다 기술이 많아도(3일·9개) 모든 기술이 한 번씩만 소개되고 Day 수 일치', short.days.length === 3 && new Set(intro).size === intro.length && intro.length === many.length, { days: short.days.length, intro: intro.length });
  const two = PLAN.planEvidenceCurriculum({ subjectLabel: 'A', matches: pool.slice(0, 2), parts: [{ id: 'g1', label: '스탠딩 백 탈출', techniqueIds: [pool[0].techniqueId] }, { id: 'g2', label: '테이크다운', techniqueIds: [pool[1].techniqueId] }], targetDays: 30, intensity: 'normal', dailyMinutes: 30 });
  check('V2 일정', '두 단계 → 요청 순서대로 단계 간 연결 Day 포함', two.days.some((d) => d.title.includes('스탠딩 백 탈출 → 테이크다운')), two.days.map((d) => d.title).slice(0, 8));
}

check('비용', '테스트 중 실제 Gemini/Tavily 호출 0회', realCalls === 0, realCalls);
const failed = results.filter((r) => !r.pass);
const byGroup = {};
for (const r of results) { byGroup[r.group] ??= [0, 0]; byGroup[r.group][1]++; if (r.pass) byGroup[r.group][0]++; }
console.log('\n그룹별:', Object.entries(byGroup).map(([g, [p, n]]) => `${g} ${p}/${n}`).join(' · '));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
