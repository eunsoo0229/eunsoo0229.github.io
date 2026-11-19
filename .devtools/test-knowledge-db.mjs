// Knowledge DB curation — offline, over the real DB, the real encyclopedia files and
// the generated candidate / hierarchy files (spec 9-A):
//   empty descriptions all accounted for, duplicates caught, category relations,
//   adding a sub-category (and its rejections), wrestling single-leg family,
//   setup / combo / flow relations, sources and verification status, and that only a
//   person's approval changes what the app shows (temp review file, never the real one).
// Run: node .devtools/test-knowledge-db.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const mod = (p) => JSON.stringify(path.join(APP, p));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };

/** Bundle the app modules; `reviewFile` replaces data/curated/knowledge-review.json (approval simulation). */
async function load(reviewFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
  const entry = path.join(dir, 'entry.ts');
  const out = path.join(dir, 'r.mjs');
  fs.writeFileSync(entry, [
    `export { getUnifiedAllTechniques, resolveTechnique, normalizeTechniqueName } from ${mod('src/lib/userTechniques/service.ts')};`,
    `export * as V from ${mod('src/lib/knowledgeBase/validate.ts')};`,
    `export * as E from ${mod('src/lib/knowledgeBase/encyclopedia.ts')};`,
    `export * as T from ${mod('src/lib/knowledgeBase/topics.ts')};`,
    `export * as P from ${mod('src/lib/selfAi/lessonPlanner.ts')};`,
    `export * as F from ${mod('src/lib/selfAi/familyAnswer.ts')};`,
    `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
    `export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  ].join('\n'));
  const swap = reviewFile ? [{ name: 'review-swap', setup(b) { b.onResolve({ filter: /knowledge-review\.json$/ }, () => ({ path: reviewFile })); } }] : [];
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin, ...swap] });
  return import(pathToFileURL(out).href);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

const M = await load(null);
const cand = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/knowledge-candidates.json'), 'utf8')).candidates;
const hierarchy = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/category-hierarchy.json'), 'utf8')).arts;
const review = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/knowledge-review.json'), 'utf8'));
const all = M.getUnifiedAllTechniques();
const byArt = new Map();
for (const t of all) for (const a of t.martialArts ?? [t.martialArt]) byArt.set(a, [...(byArt.get(a) ?? []), t]);
const ctx = {
  techniqueById: (id) => M.resolveTechnique(id),
  techniquesOfArt: (art) => byArt.get(art) ?? [],
  categoriesOf: (art) => [...new Set((byArt.get(art) ?? []).map((t) => t.categoryByArt?.[art] ?? t.category))],
  subcategoriesOf: (art, parent) => (hierarchy[art] ?? []).find((s) => s.category === parent)?.subcategories.map((x) => x.title) ?? [],
  normalize: (s) => M.normalizeTechniqueName(s),
};
const codes = (list) => M.V.validateCandidates(list, ctx).map((i) => i.code);

// ---- A1 빈 description 조사: every empty description has exactly one candidate with a status
const empty = all.filter((t) => !t.description?.trim());
const descCand = new Map(cand.filter((c) => c.kind === 'description').map((c) => [c.targetId, c]));
check('[A1] 빈 description 기록마다 후보 1개(상태 포함)', empty.length > 0 && empty.every((t) => descCand.has(t.id)), { empty: empty.length, missing: empty.filter((t) => !descCand.has(t.id)).map((t) => t.id).slice(0, 5) });
const statusOf = (s) => cand.filter((c) => c.kind === 'description' && c.status === s).length;
check('[A2] 설명 후보 상태가 6단계 중 하나, 스크립트가 "검증 완료"를 만들지 않음', cand.every((c) => ['multi_source', 'single_source', 'needs_review', 'insufficient', 'cannot_generate'].includes(c.status)), [...new Set(cand.map((c) => c.status))]);
check('[A3] 자료 없는 기록은 설명을 만들지 않음(자료 부족·생성 불가는 text 없음)', cand.filter((c) => c.status === 'insufficient' || c.status === 'cannot_generate').every((c) => !c.text && !c.sources.length), statusOf('insufficient'));
check('[A4] 설명 후보 문장은 출처 인용과 글자 그대로 같음(지어낸 문장 없음)', cand.filter((c) => c.kind === 'description' && c.text).every((c) => c.sources.some((s) => s.quote === c.text)));
check('[A5] 공식 DB 미반영: 승인 0건이면 description이 빈 기록 수는 감사와 같음', review.decisions.filter((d) => d.decision === 'approved').length > 0 || empty.length === JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/knowledge-db/audit.json'), 'utf8')).descGap.total, empty.length);

// ---- A6 중복 검사
const dupTech = { id: 'technique:wrestling__high-single-2', kind: 'technique', martialArt: 'wrestling', targetId: 'x', technique: { name: 'High Single', koreanName: null, category: '싱글 레그', description: '테스트' }, status: 'single_source', statusReason: '', sources: [{ kind: 'internal_encyclopedia', ref: 'x#1', quote: 'q' }], createdBy: 'test' };
check('[A6] 이미 있는 기술 이름의 새 기술 후보 → duplicate_technique', codes([dupTech]).includes('duplicate_technique'));
const jab = M.resolveTechnique('boxing__jab');
check('[A7] 한국어 이름으로도 중복 감지(복싱 "잽")', !!jab?.koreanName && codes([{ ...dupTech, martialArt: 'boxing', technique: { ...dupTech.technique, name: 'Lead Straight X', koreanName: jab.koreanName, category: jab.category } }]).includes('duplicate_technique'), jab?.koreanName);
check('[A8] 다른 무술 기록을 대상으로 한 후보 → wrong_art', codes([{ ...cand.find((c) => c.kind === 'description' && c.targetId === 'wrestling__high-single'), martialArt: 'boxing' }]).includes('wrong_art'));

// ---- A9 카테고리 관계
const sectionsOk = Object.entries(hierarchy).every(([art, secs]) => secs.every((s) => ctx.categoriesOf(art).includes(s.category)));
check('[A9] 계층의 모든 상위 분류 = 그 무술의 공식 분류', sectionsOk);
const membersOk = Object.entries(hierarchy).every(([art, secs]) => secs.every((s) => s.subcategories.every((sub) => sub.techniqueIds.every((id) => { const t = M.resolveTechnique(id); return t && (t.categoryByArt?.[art] ?? t.category) === s.category; }))));
check('[A10] 하위 분류의 기록은 모두 그 상위 분류 소속, 존재하는 id', membersOk);
check('[A11] 계층 정렬 순서가 1부터 증가(무술별)', Object.values(hierarchy).every((secs) => secs.every((s, i) => i === 0 || s.order > secs[i - 1].order)));
check('[A12] 9개 무술 모두 계층 있음(MMA는 원본 백과사전 없음)', ['bjj', 'boxing', 'judo', 'karate', 'kickboxing', 'muay-thai', 'sambo', 'taekwondo', 'wrestling'].every((a) => hierarchy[a]?.length > 0), Object.keys(hierarchy));

// ---- A13 새 하위 분류 추가
const subs = cand.filter((c) => c.kind === 'subcategory');
check('[A13] 싱글 레그 하위 분류 후보 3개, 검사 통과, 상태 = 검토 필요', subs.length === 3 && codes(subs).length === 0 && subs.every((s) => s.status === 'needs_review'), codes(subs));
check('[A14] 기존 분류와 같은 이름의 하위 분류 → duplicate_category', codes([{ ...subs[0], id: 'x1', subcategory: { ...subs[0].subcategory, title: '더블 레그' } }]).includes('duplicate_category'));
check('[A15] 없는 상위 분류 → parent_category_missing', codes([{ ...subs[0], id: 'x2', subcategory: { ...subs[0].subcategory, parentCategory: '없는 분류' } }]).includes('parent_category_missing'));
check('[A16] 다른 분류 기록을 넣은 하위 분류 → member_not_in_parent', codes([{ ...subs[0], id: 'x3', subcategory: { ...subs[0].subcategory, techniqueIds: ['wrestling__sprawl'] } }]).includes('member_not_in_parent'));
check('[A17] 미승인 하위 분류는 앱 계열 정보에 나오지 않음', !M.T.categoryTopic('wrestling', '싱글 레그').subcategories.some((s) => s.title.startsWith('진입 변형')));

// ---- A18 레슬링 싱글 레그
const topic = M.T.categoryTopicsInText('레슬링 싱글렉 배우고 싶어', 'wrestling')[0];
check('[A18] "싱글렉" → 레슬링 공식 분류 "싱글 레그"(18개 이상 기록)', topic?.category === '싱글 레그' && topic.members.length >= 18, topic && [topic.category, topic.members.length]);
check('[A19] "상대가 방어하면" 같은 일반어는 계열로 잡지 않음', M.T.categoryTopicsInText('상대가 방어하면 어떻게 대응해?', 'wrestling').length === 0);
const sl = cand.find((c) => c.id === 'technique:wrestling__single-leg-takedown');
check('[A20] 기본 기록 "Single Leg Takedown"은 후보로만(공식 DB에 없음)', !!sl && !M.resolveTechnique('wrestling__single-leg-takedown'), sl?.status);
check('[A21] 기본 기록 후보: 중복 아님, 변형 9개 연결, 백과사전 인용', !!sl && codes([sl]).length === 0 && sl.technique.variationIds.length >= 9 && sl.sources.some((s) => s.kind === 'internal_encyclopedia'), sl && codes([sl]));
check('[A22] "복수 자료 확인"이면 외부 본문 출처가 실제로 있음', !sl || sl.status !== 'multi_source' || sl.sources.some((s) => s.kind === 'web' && s.quoteInBody && /single leg/i.test(s.quote)), sl?.sources.map((s) => s.ref));
const plan = M.P.planLesson('레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어.', { index: M.K.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] }) });
check('[A23] 싱글렉 수업: 계열 기록으로 선행(Single-Leg Position)→핵심→응용', plan.family?.category === '싱글 레그' && plan.items[0]?.technique.id === 'wrestling__single-leg-position' && plan.items.some((i) => i.role === 'core') && plan.items.some((i) => i.role === 'application'), plan.items.map((i) => [i.role, i.technique.id]));
const planText = M.P.lessonPlanText(plan, () => '레슬링');
check('[A24] 계획에 백과사전 계열 설명(인용)과 이어서 배울 기록', planText.includes('MARTIALDEX 레슬링 백과사전') && planText.includes('이어서 배울 수 있는 싱글 레그 기록'), planText.slice(0, 400));
const fam = M.F.familyAnswerText(topic, '레슬링');
check('[A25] 계열 질문 답변: 기록 목록 + 다른 분류의 관련 기록(Single-Leg Down Defense)', fam.includes('High Single') && fam.includes('Single-Leg Down Defense'), fam.slice(0, 500));

// ---- A26 셋업·콤보·연결 관계
const rel = cand.filter((c) => c.kind === 'relation');
check('[A26] 흐름도 관계 후보: 양 끝이 존재하는 기록, 자기 연결 없음', rel.length > 0 && codes(rel).length === 0, codes(rel).slice(0, 3));
check('[A27] 관계 후보마다 백과사전 흐름도 인용(→ 포함)', rel.every((c) => c.sources.length && c.sources.every((s) => s.kind === 'internal_encyclopedia' && s.quote.includes('→'))));
const flow = M.E.flowEdges(['Sprawl', ' → Front Headlock', '   ├─ → Go-Behind → Back Take', '   └─ → Near-Side Crank → Top Position']);
check('[A28] 흐름도 분기 해석(Front Headlock → Go-Behind, Front Headlock → Near-Side Crank)', flow.some((e) => e.from.includes('Front Headlock') && e.to.includes('Go-Behind')) && flow.some((e) => e.from.includes('Front Headlock') && e.to.includes('Near-Side Crank')) && !flow.some((e) => e.from.includes('Back Take') && e.to.includes('Near-Side Crank')), flow.map((e) => `${e.from}→${e.to}`));
const bogus = { ...rel[0], id: 'relx', relation: { kind: 'next', toId: 'wrestling__no-such-thing' } };
check('[A29] 존재하지 않는 연결 대상 → unknown_relation_target', codes([bogus]).includes('unknown_relation_target'));

// ---- A30 출처·검증 상태
check('[A30] 출처 없는 후보(자료 부족·생성 불가 제외) 0건', cand.filter((c) => !['insufficient', 'cannot_generate'].includes(c.status) && !c.sources.length).length === 0);
check('[A31] 출처 누락·상태 누락 후보 → source_missing / status_missing', codes([{ ...dupTech, id: 'y1', sources: [] }]).includes('source_missing') && codes([{ ...dupTech, id: 'y2', status: undefined }]).includes('status_missing'));
check('[A32] 단일 출처를 "복수 자료 확인"으로 표시 → status_unsupported', codes([{ ...descCand.get('wrestling__high-single'), id: 'y3', status: 'multi_source' }]).includes('status_unsupported'));
check('[A33] 전체 후보 검사 오류 0건', M.V.validateCandidates(cand, ctx).filter((i) => i.severity === 'error').length === 0);

// ---- A34 승인 흐름(임시 검토 파일 — 실제 검토 파일은 건드리지 않음)
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-review-')), 'knowledge-review.json');
const hs = descCand.get('wrestling__high-single');
const subApproved = subs[0];
const official = all.find((t) => t.description?.trim() && t.martialArt === 'wrestling');
fs.writeFileSync(tmp, JSON.stringify({ version: 1, decisions: [
  { id: hs.id, decision: 'approved', by: 'tester', at: '2026-11-01T00:00:00Z', candidate: { ...hs, status: 'verified' } },
  { id: subApproved.id, decision: 'approved', by: 'tester', at: '2026-11-01T00:00:00Z', candidate: { ...subApproved, status: 'verified' } },
  { id: 'description:official', decision: 'approved', by: 'tester', at: '2026-11-01T00:00:00Z', candidate: { ...hs, id: 'description:official', targetId: official.id, text: '덮어쓰면 안 되는 문장' } },
] }));
const A = await load(tmp);
const hsA = A.resolveTechnique('wrestling__high-single');
check('[A34] 승인된 설명만 기록에 반영 + 출처·검토자 표시', hsA.description === hs.text && hsA.curation?.description?.reviewedBy === 'tester', hsA.description);
check('[A35] 공식 설명이 있는 기록은 승인 후보로도 덮어쓰지 않음', A.resolveTechnique(official.id).description === official.description);
check('[A36] 승인된 하위 분류는 계열 정보에 나타남', A.T.categoryTopic('wrestling', '싱글 레그').subcategories.some((s) => s.title === subApproved.subcategory.title));
check('[A37] 승인 안 된 기록은 그대로(Low Single 설명 빈 상태)', !A.resolveTechnique('bjj__low-single').description?.trim());

// ---- A38 대화 코치: 계열 질문
const deps = { research: async () => ({ ok: true, results: [], diagnostics: {} }), chat: async () => ({ ok: false, code: 'UNSUPPORTED', message: 'x' }), knowledgeIndex: async () => M.K.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] }), learnerContext: () => '', artName: (a) => ({ wrestling: '레슬링' })[a] ?? a, dataAnswer: async () => '데이터 엔진 답변' };
const o = await M.runCoachTurn({ text: '레슬링 싱글렉이 뭐야?', history: [], martialArt: null, requestId: 't1' }, deps);
check('[A38] "레슬링 싱글렉이 뭐야?" → 계열 답변(모델·검색 없이, 다른 무술 기록 아님)', o.message.model === 'martialdex-data' && o.message.text.includes('싱글 레그') && o.message.text.includes('High Single') && !/sambo|삼보/.test(o.message.text), [o.plan.intent, o.message.text.slice(0, 300)]);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
