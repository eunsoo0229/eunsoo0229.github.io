// MARTIALDEX 내부 지식 통합 — offline tests over the REAL technique DB:
// setups/combos around a technique, follow-ups, shared-combo merge, and the
// web-candidate classifier (duplicate / verified / partial / pending / insufficient).
// Web pages are fixtures; no network. Run: node .devtools/test-martialdex-knowledge.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-knowledge-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(
  entry,
  [
    `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
    `export * as C from ${mod('src/lib/martialdexKnowledge/candidates.ts')};`,
    `export * as ST from ${mod('src/lib/martialdexKnowledge/candidateStore.ts')};`,
    `export * as D from ${mod('src/lib/martialdexKnowledge/drills.ts')};`,
    `export { resolveTechniqueName } from ${mod('src/lib/sharedCombo/dbCombos.ts')};`,
  ].join('\n')
);
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
let realCalls = 0;
globalThis.window = {
  localStorage: storage, sessionStorage: storage, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }),
  martialdex: { askAi: async () => (realCalls++, { ok: false }), webSearch: async () => (realCalls++, { ok: false }) },
};
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const { K, C, ST, D, resolveTechniqueName } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}

// ---- name resolution (real DB)
const jab = resolveTechniqueName('Jab', 'boxing');
const cross = resolveTechniqueName('Cross', 'boxing');
const leadHook = resolveTechniqueName('Lead Hook', 'boxing');
check('[R1] Jab/Cross/Lead Hook → 실제 복싱 기술', jab && cross && leadHook, [jab?.id, cross?.id, leadHook?.id]);
check('[R2] 없는 이름은 null (비슷한 이름으로 추측 안 함)', resolveTechniqueName('Quantum Jab Feint 9000', 'boxing') === null);

// ---- index from the real DB only (shared combos unavailable)
const idx0 = K.buildKnowledgeIndex({});
check('[I1] DB 콤보 기록이 시퀀스로 들어옴', idx0.sequences.filter((s) => s.origin === 'technique_db').length >= 10, idx0.sequences.length);
check('[I2] 불러오지 못한 출처는 ok:false 로 기록', idx0.sources.find((s) => s.origin === 'shared_combo')?.ok === false && idx0.sources.find((s) => s.origin === 'combo_links')?.ok === false);
check('[I3] 모든 시퀀스 단계 = 실제 기술 id', idx0.sequences.every((s) => s.steps.every((st) => typeof st.techniqueId === 'string' && st.techniqueId.includes('__'))));

// ---- shared combos (fixture shaped like shared_combos rows; ids are real)
const shared = [
  { id: 's1', kind: 'setup', name: '잽 페인트 → 리드 훅', purpose: '패리 습관을 훅으로', martialArt: 'boxing', likeCount: 5, sourceRef: 'curated-v1:x1',
    steps: [{ techniqueId: jab.id, name: 'Jab', note: '페인트', opponentReaction: '뒷손을 올려 패리' }, { techniqueId: leadHook.id, name: 'Lead Hook' }] },
  { id: 's2', kind: 'combo', name: '1-2-3', purpose: '기본 3연타', martialArt: 'boxing', likeCount: 2, sourceRef: 'curated-v1:x2',
    steps: [{ techniqueId: jab.id, name: 'Jab' }, { techniqueId: cross.id, name: 'Cross' }, { techniqueId: leadHook.id, name: 'Lead Hook' }] },
];
const links = [{ id: 'l1', fromId: 's1', toId: 's2', relation: 'follow_up', note: '', authorId: 'a', authorNickname: 'a', createdAt: '' }, { id: 'l2', fromId: 's1', toId: 's2', relation: 'follow_up', note: '', authorId: 'b', authorNickname: 'b', createdAt: '' }];
const idx = K.buildKnowledgeIndex({ sharedCombos: shared, comboLinks: links, myCombos: [{ id: 'm1', name: '내 원투', description: '', techniqueIds: [jab.id, cross.id], userId: null, createdAt: '', updatedAt: '' }] });
const kHook = K.gatherTechniqueKnowledge(leadHook.id, idx, { art: 'boxing' });
check('[G1] 리드 훅으로 들어가는 셋업 = 잽 페인트 셋업 (상대 반응 보존)', kHook.setupsInto.some((s) => s.id === 'shared:s1' && s.steps[0].opponentReaction === '뒷손을 올려 패리'), kHook.setupsInto.map((s) => s.id));
const kJab = K.gatherTechniqueKnowledge(jab.id, idx, { art: 'boxing' });
check('[G2] 잽이 포함된 콤보에 사용자 콤보·DB 콤보·내 콤보 모두', ['shared_combo', 'technique_db', 'my_combo'].every((o) => kJab.combos.some((c) => c.sequence.origin === o)), [...new Set(kJab.combos.map((c) => c.sequence.origin))]);
check('[G3] 잽 다음 동작에 크로스가 기록됨', kJab.followUps.some((f) => f.techniqueId === cross.id), kJab.followUps.slice(0, 5));
check('[G4] 잽을 사용하는 셋업(마지막 단계 아님)', kJab.setupsUsing.some((s) => s.id === 'shared:s1'));
check('[G5] 공유 연결 지지 수 합산', K.linkedSequences('shared:s1', idx)[0]?.link.support === 2);
const block = K.knowledgeContextBlock(kJab);
check('[G6] 프롬프트 블록에 셋업/콤보/다음 동작 포함, 출처 id 포함', /포함된 콤보/.test(block) && /다음 동작/.test(block) && /\[shared:s2\]/.test(block), block);

// ---- candidates
const PAGE_A = 'Coaches teach the jab feint to draw the parry, then throw the lead hook over the lowered hand. The jab to the body lowers the guard.';
const PAGE_B = 'A classic setup: feint the jab, wait for the parry, then land the lead hook.';
const sources = [
  { url: 'https://a.example/jab', content: PAGE_A, sourceType: 'web' },
  { url: 'https://b.example/setups', content: PAGE_B, sourceType: 'blog' },
  { url: 'https://c.example/s', snippet: 'jab feint lead hook shoulder roll pull counter', sourceType: 'web' },
];
const dup = C.classifyCandidate({ kind: 'technique', name: 'Jab', martialArt: 'boxing', evidence: [{ url: 'https://a.example/jab', quote: 'jab feint' }] }, sources, idx);
check('[C1] 이미 있는 기술 = 기존 데이터와 중복', dup[0].status === 'duplicate' && dup[0].duplicateOf.id === jab.id, dup[0]);
const dupSeq = C.classifyCandidate({ kind: 'combo', name: 'one-two-hook', martialArt: 'boxing', steps: ['Jab', 'Cross', 'Lead Hook'], evidence: [] }, sources, idx);
check('[C2] 같은 순서 콤보 = 중복 (DB 기록 1-2-3이 이미 있음)', dupSeq[0].status === 'duplicate' && dupSeq[0].duplicateOf.kind === 'sequence' && ['db:martialdex-db:boxing__1-2-3', 'shared:s2'].includes(dupSeq[0].duplicateOf.id), dupSeq[0]);
const two = C.classifyCandidate({ kind: 'setup', name: 'Body jab → Lead Hook', martialArt: 'boxing', steps: ['Jab', 'Lead Hook', 'Cross'], evidence: [
  { url: 'https://a.example/jab', quote: 'throw the lead hook over the lowered hand' },
  { url: 'https://b.example/setups', quote: 'feint the jab, wait for the parry, then land the lead hook' },
] }, sources, idx);
check('[C3] 두 사이트 본문 인용 확인 + 새 순서 = 검증 완료', two[0].status === 'verified' && two[0].unresolvedSteps.length === 0, two[0]);
const one = C.classifyCandidate({ kind: 'setup', name: 'x', martialArt: 'boxing', steps: ['Jab', 'Cross', 'Cross'], evidence: [{ url: 'https://a.example/jab', quote: 'jab to the body lowers the guard' }] }, sources, idx);
check('[C4] 한 사이트만 = 일부 정보 확인', one[0].status === 'partially_verified', one[0]);
const snip = C.classifyCandidate({ kind: 'combo', name: 'y', martialArt: 'boxing', steps: ['Jab', 'Lead Hook', 'Lead Hook', 'Cross'], evidence: [{ url: 'https://c.example/s', quote: 'jab feint lead hook' }] }, sources, idx);
check('[C5] 검색 요약에서만 확인 = 검증 대기', snip[0].status === 'pending' && snip[0].evidence[0].checkedAgainst === 'snippet', snip[0]);
const fake = C.classifyCandidate({ kind: 'combo', name: 'z', martialArt: 'boxing', steps: ['Jab', 'Cross', 'Jab', 'Lead Hook'], evidence: [{ url: 'https://a.example/jab', quote: 'spinning back fist off the cage walk' }] }, sources, idx);
check('[C6] 원문에 없는 인용 = 검증 대기(검증 완료 아님)', fake[0].status === 'pending', fake[0]);
const none = C.classifyCandidate({ kind: 'technique', name: 'Shoulder Roll Pull Counter X', martialArt: 'boxing', evidence: [] }, sources, idx);
check('[C7] 근거 없는 신규 기술 = 자료 부족', none[0].status === 'insufficient', none[0]);
const withNew = C.classifyCandidate({ kind: 'setup', name: 'n', martialArt: 'boxing', steps: ['Jab', 'Zorblax Step', 'Lead Hook'], evidence: [
  { url: 'https://a.example/jab', quote: 'throw the lead hook over the lowered hand' }, { url: 'https://b.example/setups', quote: 'feint the jab, wait for the parry' }] }, sources, idx);
check('[C8] DB에 없는 단계 포함 → 셋업은 최대 일부 확인 + 그 단계는 별도 기술 후보', withNew[0].status === 'partially_verified' && withNew[0].unresolvedSteps[0] === 'Zorblax Step' && withNew.some((c) => c.kind === 'technique' && c.name === 'Zorblax Step'), withNew.map((c) => [c.kind, c.name, c.status]));

// ---- curriculum drills (real DB + fixture shared combos)
const day = (n, ids, review = []) => ({ day: n, title: `D${n}`, description: '', learningGoals: [], techniqueIds: ids, reviewTechniqueIds: review, difficulty: null, estimatedMinutes: 30 });
const plan = [day(1, [jab.id]), day(2, [cross.id]), day(3, [leadHook.id])];
const att = D.attachSequenceDrills(plan, idx, { art: 'boxing' });
const allDrills = att.days.flatMap((d) => d.drills ?? []);
check('[D1] 셋업·콤보·연결 중 하나 이상 붙음', att.totalDrills > 0 && allDrills.length === att.totalDrills, att.totalDrills);
check('[D2] 하루 최대 3개', att.days.every((d) => (d.drills ?? []).length <= D.MAX_DRILLS_PER_DAY));
const taughtBy = (n) => new Set(plan.filter((d) => d.day <= n).flatMap((d) => d.techniqueIds.map((x) => x)));
check('[D3] 콤보 단계는 그날까지 배운 기술만 (단계적 난이도)', att.days.every((d) => (d.drills ?? []).filter((x) => x.kind === 'combo').every((x) => x.steps.every((st) => [...taughtBy(d.day)].some((t) => t === st.techniqueId || t.endsWith(st.techniqueId.split('__')[1]))))), att.days.map((d) => (d.drills ?? []).map((x) => [x.kind, x.steps.map((s) => s.techniqueId)])));
check('[D4] Day 3 리드 훅: 잽 페인트 셋업(상대 반응 포함)', (att.days[2].drills ?? []).some((x) => x.kind === 'setup' && x.sequenceId === 'shared:s1' && x.steps[0].opponentReaction), att.days[2].drills);
check('[D5] 같은 시퀀스 중복 사용 없음', new Set(allDrills.map((x) => x.sequenceId)).size === allDrills.length);
check('[D6] 모든 드릴 단계 = 실제 기술 id', allDrills.every((x) => x.steps.every((st) => st.techniqueId.includes('__'))));
const lonely = D.attachSequenceDrills([day(1, ['bjj__armbar'])], K.buildKnowledgeIndex({}), { art: 'boxing' });
check('[D7] 맞는 기록이 없으면 만들지 않고 daysWithoutDrills 로 보고', lonely.totalDrills === 0 && lonely.daysWithoutDrills.join() === '1', lonely);
check('[D8] 셋업/콤보 요청 문장 감지', D.goalAsksForSequences('복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어') && !D.goalAsksForSequences('암바 배우기'));

// ---- store
ST.upsertCandidates([...two, ...one]);
ST.upsertCandidates([{ ...one[0], id: 'other', evidence: [{ url: 'https://b.example/setups', quote: 'q', quoteVerified: true, checkedAgainst: 'content' }] }]);
const listed = ST.listCandidates();
check('[S1] 같은 후보는 합쳐지고 근거 URL 합집합', listed.length === 2 && listed.find((c) => c.name === 'x').evidence.length === 2, listed.map((c) => [c.name, c.evidence.length]));
check('[S2] 실제 네트워크·AI 호출 0', realCalls === 0, realCalls);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
