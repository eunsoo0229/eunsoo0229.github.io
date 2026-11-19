// Builds, from the encyclopedia (data/raw) and the app's own curated data:
//   data/curated/category-hierarchy.json   — each art's categories with the sub-headings the
//                                            parser dropped and which records sit under each
//                                            (structure only; every record keeps its id)
//   data/curated/knowledge-candidates.json — description / Korean-name / relation /
//                                            sub-category / technique CANDIDATES with sources
//                                            and a verification status. Not applied to the
//                                            official DB — a person approves them
//                                            (scripts/review-knowledge-candidates.mjs).
// Then runs the quality gate (src/lib/knowledgeBase/validate.ts) and prints the result.
// Web evidence is added separately (scripts/verify-candidates-web.mjs) so this stays offline.
// Run: node scripts/build-knowledge-curation.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from '../.devtools/lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-build-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export { getUnifiedAllTechniques, resolveTechnique, normalizeTechniqueName } from ${mod('src/lib/userTechniques/service.ts')};`,
  `export { dataKoreanNames } from ${mod('src/lib/coachKnowledge/koreanNames.ts')};`,
  `export { lessonReadiness } from ${mod('src/lib/coachLesson/lessonReadiness.ts')};`,
  `export { getTechniqueConnections } from ${mod('src/lib/techniqueGraph/buildGraph.ts')};`,
  `export * as E from ${mod('src/lib/knowledgeBase/encyclopedia.ts')};`,
  `export * as V from ${mod('src/lib/knowledgeBase/validate.ts')};`,
].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);

const FILE_ART = { bjj: 'bjj', 가라테: 'karate', 레슬링: 'wrestling', 무에타이: 'muay-thai', 복싱: 'boxing', 삼보: 'sambo', 유도: 'judo', 킥복싱: 'kickboxing', 태권도: 'taekwondo' };
const norm = (s) => M.normalizeTechniqueName(s ?? '');
const all = M.getUnifiedAllTechniques();
const canonical = canonicalMap();
const posture = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/posture.json'), 'utf8'));
const relationsData = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/technique-canonical.json'), 'utf8'));
const splitNew = new Map((relationsData.newTechniques ?? []).map((n) => [n.id, n]));
const byArt = new Map();
for (const t of all) for (const a of t.martialArts ?? [t.martialArt]) byArt.set(a, [...(byArt.get(a) ?? []), t]);

function canonicalMap() {
  const m = new Map();
  for (const t of all) for (const id of t.mergedIds ?? [t.id]) m.set(id, t.id);
  return m;
}
const namesOf = (t) => [t.name, ...(t.aliases ?? [])].filter(Boolean);
const bulletName = (b) => b.split(/\s+---\s+|\s+—\s+|:\s/)[0].replace(/\(.*?\)/g, '').trim();

/** Name in a flow / bullet → the art's record: exact name or alias; "Crackdown" → the only "Crackdown Position". */
function resolveInArt(name, art) {
  const key = norm(name);
  if (!key) return null;
  const list = byArt.get(art) ?? [];
  const exact = list.filter((t) => namesOf(t).some((n) => norm(n) === key));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.find((t) => t.martialArt === art) ?? null;
  const pos = list.filter((t) => namesOf(t).some((n) => norm(n) === `${key}position`));
  return pos.length === 1 ? pos[0] : null;
}

// ---------------------------------------------------------------- hierarchy
const hierarchy = { version: 1, generatedAt: new Date().toISOString(), about: 'Per art: the encyclopedia sections (= the official categories, in the encyclopedia order) with the sub-headings inside them and the records under each. Built by scripts/build-knowledge-curation.mjs from data/raw; record ids are unchanged. New sub-categories are added only through approved candidates.', arts: {} };
const encyclopedia = {};
for (const f of fs.readdirSync(path.join(APP, 'data/raw')).filter((f) => f.endsWith('.md'))) {
  const art = FILE_ART[f.split('_')[0]];
  if (!art) continue;
  const sections = M.E.parseEncyclopedia(fs.readFileSync(path.join(APP, 'data/raw', f), 'utf8'));
  encyclopedia[art] = { file: f, sections };
  const catOf = (t) => t.categoryByArt?.[art] ?? t.category;
  const records = byArt.get(art) ?? [];
  const cats = [...new Set(records.map(catOf))];
  const outSections = [];
  for (const s of sections) {
    const cat = cats.find((c) => norm(c) === norm(s.title)) ?? cats.find((c) => norm(c).startsWith(norm(s.title)) || norm(s.title).startsWith(norm(c)));
    if (!cat) continue;
    const inCat = records.filter((t) => catOf(t) === cat);
    const subs = [];
    for (const sub of s.subsections) {
      const ids = [];
      for (const b of sub.bullets) {
        const t = inCat.find((x) => namesOf(x).some((n) => norm(n) === norm(bulletName(b))));
        if (t && !ids.includes(t.id)) ids.push(t.id);
      }
      if (ids.length) subs.push({ title: sub.title, order: sub.order, techniqueIds: ids });
    }
    outSections.push({ category: cat, order: s.order, section: s.number, source: `data/raw/${f}#${s.number}`, paragraph: s.paragraph || null, subcategories: subs, count: inCat.length });
  }
  hierarchy.arts[art] = outSections;
}

// ---------------------------------------------------------------- candidates
const candidates = [];
const by = 'script:build-knowledge-curation';
// Records that are not a single technique (an overview heading, a ruleset note, a form/poomsae) —
// reviewed one by one; a technique description cannot be written for them.
const NOT_A_TECHNIQUE = {
  'karate__특징': '가라테 개요 항목(기술이 아님)',
  'karate__대표-가타': '가타 목록 항목(단일 기술이 아님)',
  'boxing__센터라인-리스크': '전술 개념 항목',
  'boxing__아마추어': '규칙·경기 형식 항목',
  'boxing__프로': '규칙·경기 형식 항목',
  'boxing__실전-함의': '해설 항목',
  'bjj__상대의-중심-이동': '원리 항목(자세 자료에서도 의도적으로 제외됨)',
  'bjj__스크램블-시작': '상황 항목(자세 자료에서도 의도적으로 제외됨)',
  'bjj__포지션-회복': '상황 항목(자세 자료에서도 의도적으로 제외됨)',
};
for (let i = 1; i <= 8; i++) NOT_A_TECHNIQUE[`taekwondo__태극-${i}장`] = '품새(동작 연속 형식) — 단일 기술이 아님';

for (const t of all) {
  if (t.description?.trim()) continue;
  const id = `description:${t.id}`;
  if (NOT_A_TECHNIQUE[t.id]) {
    candidates.push({ id, kind: 'description', martialArt: t.martialArt, targetId: t.id, status: 'cannot_generate', statusReason: NOT_A_TECHNIQUE[t.id], sources: [], createdBy: by });
    continue;
  }
  const overview = (t.mergedIds ?? [t.id]).map((x) => posture[x]?.overview).find((x) => x?.trim());
  if (overview) {
    const named = [...namesOf(t), t.koreanName ?? '', ...M.dataKoreanNames(t)].filter(Boolean).some((n) => norm(overview).includes(norm(n)));
    candidates.push({
      id, kind: 'description', martialArt: t.martialArt, targetId: t.id, text: overview,
      status: named ? 'single_source' : 'needs_review',
      statusReason: named ? 'MARTIALDEX 자세 자료 1건(이 기술을 직접 설명하는 문장). 외부 자료 대조 전' : 'MARTIALDEX 자세 자료 1건이지만 문장에 기술 이름이 없어 이 기술 설명인지 확인 필요',
      sources: [{ kind: 'internal_posture', ref: `data/curated/posture.json#${t.id}.overview`, quote: overview }], createdBy: by,
    });
    continue;
  }
  // a record split out of a combined one: the source record's text, only where it names this technique
  const split = splitNew.get(t.id);
  if (split) {
    const keys = namesOf(t).map(norm).filter((k) => k.length >= 4);
    const srcTexts = split.sourceIds.flatMap((s) => { const p = posture[s]; return p ? [p.overview, ...(p.steps ?? []), ...(p.keyPoints ?? [])] : []; }).filter(Boolean);
    const hit = srcTexts.find((x) => keys.some((k) => norm(x).includes(k)));
    if (hit) {
      candidates.push({ id, kind: 'description', martialArt: t.martialArt, targetId: t.id, text: hit, status: 'needs_review', statusReason: `분리 전 기록(${split.sourceIds.join(', ')})의 자세 자료 중 이 기술 이름이 나오는 문장 — 이 기술만의 설명인지 확인 필요`, sources: [{ kind: 'internal_posture', ref: `data/curated/posture.json#${split.sourceIds[0]}`, quote: hit }], createdBy: by });
      continue;
    }
  }
  candidates.push({ id, kind: 'description', martialArt: t.martialArt, targetId: t.id, status: 'insufficient', statusReason: split ? `분리 생성 기록 — 분리 전 기록(${split.sourceIds.join(', ')})의 자료에 이 기술만의 설명이 없음` : 'MARTIALDEX 내부 자료에 설명 문장이 없음', sources: [], createdBy: by });
}

// Korean names the record's own posture text uses ("하이 싱글은 …") — already used for lookup at runtime; offered so the record can carry it.
for (const t of all) {
  if (t.koreanName) continue;
  const names = M.dataKoreanNames(t);
  if (!names.length) continue;
  const quote = (t.mergedIds ?? [t.id]).map((x) => posture[x]?.overview).find(Boolean);
  candidates.push({ id: `korean_name:${t.id}`, kind: 'korean_name', martialArt: t.martialArt, targetId: t.id, text: names[0], status: 'single_source', statusReason: 'MARTIALDEX 자세 자료가 이 기술을 부르는 이름(문장의 주어, 영어 이름과 발음 일치 확인)', sources: [{ kind: 'internal_posture', ref: `data/curated/posture.json#${t.id}.overview`, quote }], createdBy: by });
}

// Relations from the encyclopedia flow charts — only edges whose both ends resolve to a record of that art.
const unresolved = new Map();
for (const [art, { file, sections }] of Object.entries(encyclopedia)) {
  for (const s of sections) {
    for (const block of s.flows) {
      for (const e of M.E.flowEdges(block)) {
        const from = e.from.map((n) => [n, resolveInArt(n, art)]);
        const to = e.to.map((n) => [n, resolveInArt(n, art)]);
        for (const [n, r] of [...from, ...to]) if (!r) unresolved.set(`${art}:${n}`, (unresolved.get(`${art}:${n}`) ?? 0) + 1);
        // a situation line ("Opponent attacks Single") is the condition of the edges it starts
        const fromIsSituation = from.every(([, r]) => !r) && e.from.length === 1 && e.context === e.from[0];
        for (const [, a] of from) for (const [, b] of to) {
          if (!a || !b || a.id === b.id) continue;
          const cid = `relation:${a.id}:next:${b.id}`;
          if (candidates.some((c) => c.id === cid)) continue;
          let known = false;
          try { const c = M.getTechniqueConnections(a); known = [...c.next, ...c.chain].some((x) => x.techniqueId === b.id); } catch { /* no graph */ }
          candidates.push({ id: cid, kind: 'relation', martialArt: art, targetId: a.id, relation: { kind: 'next', toId: b.id, ...(fromIsSituation ? { condition: e.context } : {}) }, status: 'single_source', statusReason: `백과사전 §${s.number} 흐름도${known ? ' (기술 그래프에 이미 있는 연결)' : ''}`, sources: [{ kind: 'internal_encyclopedia', ref: `data/raw/${file}#${s.number}`, quote: e.quote }], createdBy: by, ...(known ? { alreadyInGraph: true } : {}) });
        }
        // situation → technique: the first real node answers the situation
        if (from.every(([, r]) => !r) && e.context === e.from.join(' / ')) {
          for (const [, b] of to) if (b) candidates.push({ id: `relation:${b.id}:answers:${norm(e.context)}`, kind: 'relation', martialArt: art, targetId: b.id, relation: { kind: 'answers_situation', toId: b.id, condition: e.context }, status: 'single_source', statusReason: `백과사전 §${s.number} 흐름도: "${e.context}" 상황의 대응`, sources: [{ kind: 'internal_encyclopedia', ref: `data/raw/${file}#${s.number}`, quote: e.quote }], createdBy: by });
        }
      }
    }
  }
}

// Wrestling single-leg family. The 18 records already exist under the official category "싱글 레그";
// the sub-groups below are a classification judgement made from their names and the §4 paragraph,
// so they are offered for review, not applied.
const SL = 'wrestling';
const slSection = encyclopedia[SL].sections.find((s) => s.title === '싱글 레그');
const ids = (names) => names.map((n) => resolveInArt(n, SL)?.id).filter(Boolean);
const slQuote = { kind: 'internal_encyclopedia', ref: `data/raw/${encyclopedia[SL].file}#${slSection.number}`, quote: slSection.paragraph };
const SUBS = [
  ['진입 변형 (잡는 위치·각도)', ['High Single', 'High Crotch', 'Low Single', 'Outside Single', 'Inside Single', 'Sweep Single', 'Snatch Single', 'Near Ankle', 'Far Ankle']],
  ['피니시', ['Running the Pipe', 'Knee Tap from Single', 'Back Trip', 'Lift and Return', 'Cutback', 'Switch-Off']],
  ['상대 반응 대응·전환', ['Crackdown Position', 'Single to Double', 'Single to Back Take']],
];
SUBS.forEach(([title, names], i) => candidates.push({ id: `subcategory:${SL}:싱글 레그:${title}`, kind: 'subcategory', martialArt: SL, targetId: '', subcategory: { parentCategory: '싱글 레그', title, order: i + 1, techniqueIds: ids(names) }, status: 'needs_review', statusReason: '기술 이름과 백과사전 §4 문단에 근거한 분류 판단(사람 검토 필요)', sources: [slQuote], createdBy: by }));
// variations → the base record they are variations of. The base (a plain "Single Leg" takedown record) does not exist in wrestling:
// offered as a technique candidate whose description is the encyclopedia's own definition.
const firstSentence = slSection.paragraph.split(/(?<=다\.|\.)\s/)[0];
candidates.push({
  id: `technique:${SL}__single-leg-takedown`, kind: 'technique', martialArt: SL, targetId: `${SL}__single-leg-takedown`,
  technique: { name: 'Single Leg Takedown', koreanName: '싱글 레그 테이크다운', category: '싱글 레그', variationIds: ids(SUBS[0][1]), description: firstSentence },
  status: 'single_source', statusReason: '백과사전 §4가 싱글 레그를 하나의 테이크다운으로 정의하고 18개 기록을 그 아래에 나열 — 계열의 기본 기록이 없음. 외부 자료 대조 전', sources: [{ ...slQuote, quote: firstSentence }], createdBy: by,
});

// ---------------------------------------------------------------- validate + write
const ctx = {
  techniqueById: (id) => M.resolveTechnique(canonical.get(id) ?? id),
  techniquesOfArt: (art) => byArt.get(art) ?? [],
  categoriesOf: (art) => [...new Set((byArt.get(art) ?? []).map((t) => t.categoryByArt?.[art] ?? t.category))],
  subcategoriesOf: (art, parent) => (hierarchy.arts[art] ?? []).find((s) => s.category === parent)?.subcategories.map((x) => x.title) ?? [],
  normalize: norm,
};
const issues = M.V.validateCandidates(candidates, ctx);
const file = { version: 1, generatedAt: new Date().toISOString(), about: 'Curation candidates for the technique DB — NOT applied to the official records. Statuses: verified(사람 검토)/multi_source/single_source/needs_review/insufficient/cannot_generate. Approve or reject with scripts/review-knowledge-candidates.mjs; only approved descriptions/Korean names are shown by the app. Built by scripts/build-knowledge-curation.mjs; web evidence by scripts/verify-candidates-web.mjs.', candidates };
// keep web evidence already gathered for a candidate (verify-candidates-web.mjs) across rebuilds
const prevPath = path.join(APP, 'data/curated/knowledge-candidates.json');
if (fs.existsSync(prevPath)) {
  const prev = new Map(JSON.parse(fs.readFileSync(prevPath, 'utf8')).candidates.map((c) => [c.id, c]));
  for (const c of candidates) {
    const p = prev.get(c.id);
    if (!p) continue;
    const web = p.sources.filter((s) => s.kind === 'web');
    if (web.length) { c.sources.push(...web); c.status = p.status; c.statusReason = p.statusReason; c.webChecked = p.webChecked; }
  }
}
fs.writeFileSync(path.join(APP, 'data/curated/category-hierarchy.json'), JSON.stringify(hierarchy, null, 1));
fs.writeFileSync(prevPath, JSON.stringify(file, null, 1));
const count = (f) => candidates.filter(f).length;
const statusCount = (kind) => Object.fromEntries(['verified', 'multi_source', 'single_source', 'needs_review', 'insufficient', 'cannot_generate'].map((s) => [s, count((c) => c.kind === kind && c.status === s)]));
console.log('hierarchy:', Object.entries(hierarchy.arts).map(([a, s]) => `${a} ${s.length} sections / ${s.reduce((n, x) => n + x.subcategories.length, 0)} subs / ${s.reduce((n, x) => n + x.subcategories.reduce((m, y) => m + y.techniqueIds.length, 0), 0)} placed`).join(' | '));
for (const k of ['description', 'korean_name', 'relation', 'subcategory', 'technique']) console.log(k.padEnd(12), count((c) => c.kind === k), JSON.stringify(statusCount(k)));
console.log('relations already in graph:', count((c) => c.alreadyInGraph), 'new:', count((c) => c.kind === 'relation' && !c.alreadyInGraph));
console.log('unresolved flow names:', unresolved.size, [...unresolved.keys()].slice(0, 25).join(', '));
console.log('validation issues:', issues.length, JSON.stringify(issues.slice(0, 10)));
fs.writeFileSync(path.join(APP, 'data/audit/knowledge-db/candidate-validation.json'), JSON.stringify({ at: new Date().toISOString(), issues, unresolvedFlowNames: Object.fromEntries(unresolved) }, null, 1));
