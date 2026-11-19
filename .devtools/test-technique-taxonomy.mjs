// 계층형 기술 분류 테스트 (오프라인, API 호출 0). Expected classifications below are written from martial-arts
// knowledge (what each technique IS), not read off the classifier's output.
// Run: node .devtools/test-technique-taxonomy.mjs
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxo-test-'));
const entry = path.join(dir, 'e.ts');
const out = path.join(dir, 'o.mjs');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as TX from ${mod('src/lib/techniqueTaxonomy/index.ts')};`,
  `export { TAXONOMY_CONFIG } from ${mod('src/lib/techniqueTaxonomy/config.ts')};`,
  `export * as US from ${mod('src/lib/userTechniques/service.ts')};`,
  `export { techniqueCategoryInArt } from ${mod('src/lib/techniqueCanonical/index.ts')};`,
  `export { taxonomyListAnswer } from ${mod('src/lib/coachKnowledge/taxonomyAnswer.ts')};`,
  `export { answerCoachQuestion } from ${mod('src/lib/coachKnowledge/questions.ts')};`,
  `export { generateGoalCurriculumPreview } from ${mod('src/lib/aiCurriculum/service.ts')};`,
].join('\n'));
const mem = new Map();
const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
// the askAi stub below stands in for the Gemini bridge — since the engine defaults to local (localAi/enginePreference), pick Gemini explicitly
mem.set('martialdex:ai-engine', 'gemini');
const calls = { search: 0, analyze: 0, extract: 0, other: 0 };
let stubMode = 'none';
const HG_SOURCES = [
  { url: 'https://bjj-a.com/half-guard-sweeps', title: 'Half guard sweeps', content: 'From half guard, the old school sweep and the electric chair sweep are the classic sweeps. The plan B sweep follows when they post.', snippet: '' },
  { url: 'https://bjj-b.com/half-guard', title: 'Half guard sweep guide', content: 'Old school sweep: grab the ankle and drive. Electric chair sweep from the lockdown. John Wayne sweep when they base out.', snippet: '' },
];
globalThis.window = {
  localStorage: st, sessionStorage: st, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: (f) => 0, clearTimeout() {},
  location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: {
    webSearch: async () => (calls.search++, stubMode === 'curriculum' ? { ok: true, results: HG_SOURCES } : { ok: false, code: 'NO_API_KEY', message: 'none' }),
    askAi: async (req) => {
      if (stubMode !== 'curriculum') return (calls.other++, { ok: false, code: 'UNKNOWN', message: 'stub' });
      if (req.systemInstruction.includes('subGoals(학습 목표 분리)')) {
        calls.analyze++;
        return { ok: true, text: JSON.stringify({ martialArt: 'bjj', estimatedLevel: 'beginner', weaknesses: [], desiredStyle: [], desiredTechniques: ['하프 가드 스윕'], goals: ['하프 가드 스윕'], priority: ['하프 가드 스윕'], intents: ['attack'], diversityRequested: false, searchTopics: ['bjj half guard sweep'], subGoals: [{ label: '하프 가드 스윕', role: 'core', intents: ['attack'], searchTopics: ['bjj half guard sweep'], situation: 'bottom half guard' }], referencedFighterName: null, clarifyingQuestion: null, summary: '하프 가드 스윕 집중', suggestedDurationDays: 14, durationReason: 'x' }) };
      }
      if (req.systemInstruction.includes('사용자의 학습 목표는 아래 단계들로')) {
        calls.extract++;
        const items = [
          { name: 'Old School Sweep', partId: 'g1', sourceUrl: HG_SOURCES[0].url, quote: 'the old school sweep and the electric chair sweep are the classic sweeps', appliesWhen: 'half guard bottom', intentGuess: 'attack', fit: 'direct', confidence: 90, martialArtGuess: 'bjj', purpose: '' },
          { name: 'Electric Chair Sweep', partId: 'g1', sourceUrl: HG_SOURCES[1].url, quote: 'Electric chair sweep from the lockdown', appliesWhen: 'half guard bottom', intentGuess: 'attack', fit: 'direct', confidence: 90, martialArtGuess: 'bjj', purpose: '' },
        ];
        return { ok: true, text: JSON.stringify(items) };
      }
      calls.other++;
      return { ok: false, code: 'UNKNOWN', message: 'stub' };
    },
  },
};
globalThis.localStorage = st;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(out).href);
const { TX, US } = M;

const results = [];
function check(group, name, pass, detail = '') {
  results.push({ group, pass });
  if (!pass || process.env.VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'} — [${group}] ${name}${detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`);
}

// ── 1. 데이터 무결성 (모든 무술) ──
const arts = US.getUnifiedMartialArtSummaries().map((a) => a.id);
check('무결성', '등록된 10개 무술 모두 포함', ['bjj', 'mixed-martial-arts', 'wrestling', 'boxing', 'muay-thai', 'kickboxing', 'taekwondo', 'karate', 'judo', 'sambo'].every((a) => arts.includes(a) && M.TAXONOMY_CONFIG[a]), arts);
for (const art of arts) {
  const techniques = US.getUnifiedTechniquesByMartialArt(art);
  const tax = TX.getArtTaxonomy(art, techniques);
  const groupOf = new Map();
  let doubleGroup = 0;
  for (const r of tax.roots) for (const id of tax.nodeTechniques.get(r) ?? []) { if (groupOf.has(id)) doubleGroup++; groupOf.set(id, r); }
  const allIn = techniques.every((t) => groupOf.has(t.id));
  const noExtra = [...groupOf.keys()].every((id) => techniques.some((t) => t.id === id));
  const countsOk = [...tax.nodes.values()].every((n) => n.count === TX.techniqueIdsForNode(n.id).size && n.count > 0);
  const childInParent = [...tax.nodes.values()].every((n) => !n.parentId || [...TX.techniqueIdsForNode(n.id)].every((id) => TX.techniqueIdsForNode(n.parentId).has(id)));
  const relations = [...tax.nodes.values()].every((n) => !n.parentId || tax.nodes.get(n.parentId)?.children.includes(n.id));
  const cats = new Set(techniques.map((t) => M.techniqueCategoryInArt(t, art)));
  const mapped = [...cats].every((c) => tax.categoryNode.get(c));
  const noLow = [...tax.techniqueAssignments.values()].flat().every((a) => a.confidence !== 'LOW');
  const depthOk = [...tax.nodes.values()].every((n) => n.level <= 4);
  check('무결성', `${art}: 모든 기술(${techniques.length})이 정확히 한 그룹에, 다른 기술 없음`, allIn && noExtra && doubleGroup === 0, { allIn, noExtra, doubleGroup });
  check('무결성', `${art}: 노드 개수 = 하위 포함 고유 기술 수, 빈 노드 없음, 자식 ⊂ 부모`, countsOk && childInParent && relations && depthOk);
  check('무결성', `${art}: 기존 카테고리 ${cats.size}개 모두 새 노드에 매핑`, mapped);
  check('무결성', `${art}: LOW 확신도는 자동 배정 안 됨`, noLow);
}
const dataChanged = execSync('git diff --name-only HEAD -- data/processed data/curated/posture.json', { cwd: APP }).toString().trim();
check('무결성', '기술 데이터 파일(data/processed, posture.json) 변경 없음 (id·설명·영상·자세 보존)', dataChanged === '', dataChanged);

// ── 2. 분류 정답 (전문 지식 기준) ──
const where = (art, name) => {
  const t = US.getUnifiedTechniquesByMartialArt(art).find((x) => x.name === name);
  return t ? TX.classificationOf(t.id, art).map((c) => c.node.id.replace(`${art}/`, '')) : null;
};
const yes = (art, name, node) => check('분류', `${art} ${name} → ${node}`, (where(art, name) ?? []).includes(node), where(art, name));
const no = (art, name, node) => check('분류', `${art} ${name} ↛ ${node}`, where(art, name) !== null && !(where(art, name) ?? []).includes(node), where(art, name));
yes('bjj', 'Old School Sweep', 'half-guard/sweep');
yes('bjj', 'Hip Bump Sweep', 'closed-guard/sweep');
yes('bjj', 'Cross Collar Choke', 'closed-guard/submission');
yes('bjj', 'Americana', 'closed-guard/submission');
no('bjj', 'Americana', 'closed-guard/control');
yes('bjj', 'Knee Cut Pass', 'guard-passing/pass');
yes('bjj', 'Rear Naked Choke', 'back-control/submission');
no('bjj', 'Rear Naked Choke', 'back-control/control');
yes('bjj', 'Turtle → Back', 'back-control/back_take');
yes('bjj', 'Elbow-Knee Escape', 'mount/escape');
yes('bjj', 'Spider Guard', 'open-guard/guard_variant');
no('bjj', 'Spider Guard', 'open-guard/sweep');
no('bjj', 'Overhook', 'closed-guard/sweep');
yes('bjj', 'Kesa Gatame', 'side-control/control');
yes('bjj', 'Guillotine', 'front-headlock/submission');
yes('bjj', 'Deep Half Sweep', 'half-guard/m-deep-half-guard');
yes('mixed-martial-arts', 'Rear Naked Choke', 'submission/choke');
yes('mixed-martial-arts', 'Heel Hook', 'submission/leglock');
yes('mixed-martial-arts', 'Kimura', 'submission/shoulder_lock');
yes('mixed-martial-arts', 'Sprawl', 'defense/td_defense');
yes('mixed-martial-arts', 'Blast Double', 'takedown/double_leg');
yes('mixed-martial-arts', 'Calf Kick', 'kickboxing/low_kick');
no('mixed-martial-arts', 'Basic Double Leg', 'takedown/trip');
no('mixed-martial-arts', '잡힌 다리를 빠르게 접어 빼기', 'kickboxing/knee');
yes('wrestling', 'Running the Pipe', 'leg-attacks/m-0/finish');
yes('wrestling', 'Near-Side Cradle', 'top/pin');
yes('wrestling', 'Wrist Tilt', 'top/turn');
yes('wrestling', 'Spiral Ride', 'top/ride');
yes('boxing', 'Lead Hook', 'punches/hook');
yes('boxing', 'Slip Inside', 'defense/slip_roll');
yes('boxing', 'Lead Hand Parry', 'defense/parry');
no('kickboxing', 'Round Kick', 'kicks/spinning');
yes('judo', 'Uchi Mata', 'nage-waza/m-koshi-waza');
yes('judo', 'Okuri Eri Jime', 'shime-kansetsu/m-shime-waza');

// ── 3. 다중 분류 · 중복 집계 ──
{
  const tax = TX.getArtTaxonomy('bjj');
  const g = tax.nodes.get('bjj/closed-guard');
  const kids = g.children.map((c) => TX.techniqueIdsForNode(c));
  const sum = kids.reduce((n, s) => n + s.size, 0);
  const anyMulti = [...tax.techniqueAssignments.values()].some((as) => as.filter((a) => a.nodeId.startsWith('bjj/closed-guard/')).length >= 2);
  check('다중 분류', '클로즈드 가드: 여러 하위 분류에 속한 기술이 있어도 부모 개수는 고유 기술 수', anyMulti && g.count === TX.techniqueIdsForNode('bjj/closed-guard').size && sum >= g.count, { count: g.count, sumChildren: sum });
}

// ── 4. 사용자 무술 · 미등록 카테고리 자동 처리 ──
{
  const fake = [
    { id: 'my-art__a', martialArt: 'my-art', name: 'Spin Sweep', koreanName: null, aliases: [], category: '바닥 기술', positions: [], description: '', purpose: null, difficulty: 'beginner', tags: [] },
    { id: 'my-art__b', martialArt: 'my-art', name: 'Front Kick', koreanName: null, aliases: [], category: '발차기', positions: [], description: '', purpose: null, difficulty: 'beginner', tags: [] },
    { id: 'my-art__c', martialArt: 'my-art', name: 'Back Kick', koreanName: null, aliases: [], category: '발차기', positions: [], description: '', purpose: null, difficulty: 'beginner', tags: [] },
  ];
  const tax = TX.getArtTaxonomy('my-art', fake);
  check('사용자 무술', '설정 없는 무술도 기존 카테고리마다 그룹이 생기고 개수가 맞음', tax.roots.length === 2 && tax.roots.map((r) => tax.nodes.get(r).count).sort().join() === '1,2', tax.roots.map((r) => [tax.nodes.get(r).ko, tax.nodes.get(r).count]));
}

// ── 4b. 확장 노드 (사용자/관리자 카테고리) ──
{
  const sweeps = [...TX.techniqueIdsForNode('bjj/half-guard/sweep')];
  const outsider = US.getUnifiedTechniquesByMartialArt('bjj').find((t) => !TX.techniqueIdsForNode('bjj/half-guard').has(t.id)).id;
  const off = TX.registerTaxonomyExtension((art) => (art === 'bjj' ? [{ id: 'bjj/half-guard/sweep/custom-test', parentId: 'bjj/half-guard/sweep', ko: '내 스윕 모음', en: 'My Sweeps', techniqueIds: [sweeps[0], sweeps[1], outsider] }, { id: 'bjj/custom-root', parentId: 'bjj/none', ko: 'x', en: 'x', techniqueIds: [sweeps[0]] }] : []));
  const tax = TX.getArtTaxonomy('bjj');
  const n = tax.nodes.get('bjj/half-guard/sweep/custom-test');
  check('확장', '확장 노드가 기존 노드 아래 Level 4로 붙고, 그 그룹에 없는 기술은 제외', !!n && n.level === 4 && n.kind === 'custom' && n.count === 2 && !TX.techniqueIdsForNode(n.id).has(outsider), n);
  check('확장', '부모가 없는 확장 노드는 무시', !tax.nodes.has('bjj/custom-root'));
  check('확장', '부모 개수는 그대로 (고유 기술)', tax.nodes.get('bjj/half-guard').count === TX.techniqueIdsForNode('bjj/half-guard').size);
  off();
  // (a) attach to an existing node, (b) materialize a configured split dimension
  const other = [...TX.techniqueIdsForNode('bjj/closed-guard/_other')];
  const mountOne = [...TX.techniqueIdsForNode('bjj/open-guard')].slice(0, 1); // computed BEFORE registering (no taxonomy calls inside a provider)
  const off2 = TX.registerTaxonomyExtension((art) => (art === 'bjj' ? [{ id: 'bjj/closed-guard/sweep', parentId: 'bjj/closed-guard', ko: '', en: '', techniqueIds: other.slice(0, 1) }, { id: 'bjj/open-guard/retention', parentId: 'bjj/open-guard', ko: '', en: '', techniqueIds: mountOne }, { id: 'bjj/open-guard/not-a-dim', parentId: 'bjj/open-guard', ko: '내 분류', en: 'Mine', techniqueIds: mountOne }] : []));
  const t2 = TX.getArtTaxonomy('bjj');
  check('확장', '기존 노드 id → 그 노드에 기술 추가, 그룹의 "기타"에서는 빠짐', other.length > 0 && TX.techniqueIdsForNode('bjj/closed-guard/sweep').has(other[0]) && !(t2.nodeTechniques.get('bjj/closed-guard/_other') ?? new Set()).has(other[0]));
  const bt = t2.nodes.get('bjj/open-guard/retention');
  check('확장', '설정된 split 차원 id → 일반 split 노드로 생성 (custom 아님)', !!bt && bt.kind === 'split' && bt.dim === 'retention', bt);
  check('확장', '설정에 없는 id → custom 노드', t2.nodes.get('bjj/open-guard/not-a-dim')?.kind === 'custom');
  off2();
  check('확장', '해제하면 노드가 사라짐', !TX.getArtTaxonomy('bjj').nodes.has('bjj/half-guard/sweep/custom-test'));
}

// ── 5. 텍스트 → 분류 (AI 코치 · 커리큘럼) ──
{
  const n = TX.findTaxonomyNodesInText('하프 가드 스윕만 집중적으로 학습하고 싶어', ['bjj']);
  check('텍스트', '"하프 가드 스윕만 집중적으로" → bjj/half-guard/sweep', n[0]?.id === 'bjj/half-guard/sweep', n.slice(0, 3).map((x) => x.id));
  const m = TX.findTaxonomyNodesInText('MMA 테이크다운 방어 기술 뭐 있어', ['mixed-martial-arts']);
  check('텍스트', '"테이크다운 방어" → MMA defense/td_defense', m.some((x) => x.id === 'mixed-martial-arts/defense/td_defense'), m.slice(0, 3).map((x) => x.id));
  const none = TX.findTaxonomyNodesInText('잽은 어떻게 쳐?', ['boxing']).filter((x) => x.level >= 3);
  check('텍스트', '단일 기술 질문("잽은 어떻게 쳐?")은 하위 분류로 잡지 않음', none.length === 0, none.map((x) => x.id));
}

// ── 6. AI 코치 ──
{
  const a = M.taxonomyListAnswer('하프 가드 스윕 뭐 있어?', null);
  const ids = TX.techniqueIdsForNode('bjj/half-guard/sweep');
  check('AI 코치', '"하프 가드 스윕 뭐 있어?" → 해당 분류 기술 목록(난이도·연결·영상 정보)', !!a && a.node.id === 'bjj/half-guard/sweep' && a.techniqueIds.every((id) => ids.has(id)) && /Old School Sweep/.test(a.text) && /(초급|중급|고급)/.test(a.text) && /영상/.test(a.text), a?.text?.slice(0, 300));
  const q = await M.answerCoachQuestion(null, '하프 가드 스윕만 집중적으로 배우고 싶어', { useModel: false });
  check('AI 코치', '코치 질문 경로에서도 같은 분류 기술 목록', q.techniqueIds.length > 0 && q.techniqueIds.every((id) => ids.has(id)), { kind: q.kind, text: q.text.slice(0, 160) });
  const single = await M.answerCoachQuestion(null, '암바 어떻게 해?', { useModel: false });
  check('AI 코치', '단일 기술 질문("암바 어떻게 해?")은 목록 답변으로 바뀌지 않음', single.kind !== 'situation' || !/MARTIALDEX 분류/.test(single.text), { kind: single.kind, text: single.text.slice(0, 120) });
}

// ── 7. 커리큘럼 (스텁: 실제 API 호출 없음) ──
{
  stubMode = 'curriculum';
  const r = await M.generateGoalCurriculumPreview({ freeText: '하프 가드 스윕만 집중적으로 학습하고 싶어', martialArt: 'bjj', durationDays: 14, dailyMinutes: 30, skipClarifying: true });
  stubMode = 'none';
  const ids = TX.techniqueIdsForNode('bjj/half-guard/sweep');
  const scheduled = r.ok ? [...new Set(r.preview.days.flatMap((d) => [...d.techniqueIds, ...d.reviewTechniqueIds]))] : [];
  check('커리큘럼', '"하프 가드 스윕만 집중" → 일정의 모든 기술이 하프 가드 스윕 분류', r.ok && scheduled.length >= 2 && scheduled.every((id) => ids.has(id)), r.ok ? { scheduled: scheduled.map((id) => US.resolveTechnique(id)?.name) } : r);
  check('커리큘럼', '스텁 호출만 사용 (실제 API 없음)', calls.search > 0 && calls.analyze === 1, calls);
}

const failed = results.filter((r) => !r.pass);
const byGroup = {};
for (const r of results) { byGroup[r.group] ??= [0, 0]; byGroup[r.group][1]++; if (r.pass) byGroup[r.group][0]++; }
console.log('\n그룹별:', Object.entries(byGroup).map(([g, [p, n]]) => `${g} ${p}/${n}`).join(' · '));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
