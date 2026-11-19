// 대화 → 수업, 수업 중 추가, 근거 기반 선수 스타일 — offline tests over the real
// technique DB and the real lesson session store. Search/model are scripted fakes.
// Run: node .devtools/test-self-ai-lesson-style.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-lesson-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as L from ${mod('src/lib/selfAi/chatLesson.ts')};`,
  `export * as SS from ${mod('src/lib/aiCoachDay/sessionStore.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export * as FS from ${mod('src/lib/fighterStyle/evidenceStyle.ts')};`,
  `export { getCurriculum } from ${mod('src/lib/curriculum/curriculumService.ts')};`,
  `export { resolveTechniqueName } from ${mod('src/lib/sharedCombo/dbCombos.ts')};`,
].join('\n'));
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
const { L, SS, K, FS, getCurriculum, resolveTechniqueName } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

const jab = resolveTechniqueName('Jab', 'boxing');
const cross = resolveTechniqueName('Cross', 'boxing');
const hook = resolveTechniqueName('Lead Hook', 'boxing');
const uppercut = resolveTechniqueName('Rear Uppercut', 'boxing');
const shared = [
  { id: 's1', kind: 'setup', name: '잽 페인트 → 리드 훅', purpose: '패리 습관을 훅으로', martialArt: 'boxing', likeCount: 5, sourceRef: null,
    steps: [{ techniqueId: jab.id, name: 'Jab', opponentReaction: '뒷손 패리' }, { techniqueId: hook.id, name: 'Lead Hook' }] },
  { id: 's2', kind: 'combo', name: '잽-어퍼-훅', purpose: 'x', martialArt: 'boxing', likeCount: 1, sourceRef: null,
    steps: [{ techniqueId: jab.id, name: 'Jab' }, { techniqueId: uppercut.id, name: 'Rear Uppercut' }, { techniqueId: hook.id, name: 'Lead Hook' }] },
];
const index = K.buildKnowledgeIndex({ sharedCombos: shared, comboLinks: [] });

// ---- proposal → lesson curriculum
const sources = [{ n: 1, title: 'Jab setups', url: 'https://a.example/jab', sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { level: 'medium', label: '보통', reasons: [] }, contentRead: true }];
const proposal = { topic: '잽 셋업과 콤보', martialArt: 'boxing', techniqueIds: [jab.id], sequenceIds: ['shared:s1'], sourceUrls: ['https://a.example/jab'], candidateIds: [] };
const started = L.startLessonFromProposal(proposal, index, sources, 'conv1');
check('[L1] 수업 커리큘럼 생성 + 수업 경로', started.ok && /\/coach\/1\?mode=text$/.test(started.route), started);
const c = getCurriculum(started.curriculum.id);
check('[L2] 셋업 단계 기술(리드 훅)도 수업 기술에 포함', c.days[0].techniqueIds.includes(jab.id) && c.days[0].techniqueIds.some((id) => id.endsWith('lead-hook')), c.days[0].techniqueIds);
check('[L3] 셋업 드릴(상대 반응) 포함', c.days[0].drills?.some((d) => d.sequenceId === 'shared:s1' && d.steps[0].opponentReaction === '뒷손 패리'), c.days[0].drills);
check('[L4] 출처 원문 링크·신뢰도 저장', c.chatLessonMeta?.sources[0].url === 'https://a.example/jab' && c.chatLessonMeta.sources[0].reliabilityLabel === '보통' && c.chatLessonMeta.conversationId === 'conv1');
const none = L.startLessonFromProposal({ ...proposal, techniqueIds: [], sequenceIds: [] }, index, [], 'conv1');
check('[L5] 연결된 기술이 없으면 수업을 만들지 않음', !none.ok, none);

// ---- lesson in progress: add connected items without touching progress
const run = SS.startCoachDayRun(c.id, 1, 'text', c.days[0].techniqueIds);
SS.updateCoachDayRun((r) => ({ ...r, index: 1, step: 'quiz', outcomes: { ...r.outcomes, [r.techniqueIds[0]]: { practicedSeconds: 90, completed: true, quiz: 'correct' } } }));
const before = SS.getCoachDayRun();
const res = L.addConnectedToActiveLesson(jab.id, index, { art: 'boxing' });
const after = SS.getCoachDayRun();
check('[L6] 연결 콤보의 빠진 기술(어퍼컷) 추가', res.added.some((a) => a.techniqueId.endsWith('rear-uppercut')), res);
check('[L7] 진행 상태 불변: index·step·완료 기록', after.index === before.index && after.step === 'quiz' && after.outcomes[before.techniqueIds[0]].completed === true && after.outcomes[before.techniqueIds[0]].practicedSeconds === 90, after);
check('[L8] 새 항목은 기존 항목 뒤에만', JSON.stringify(after.techniqueIds.slice(0, before.techniqueIds.length)) === JSON.stringify(before.techniqueIds));
check('[L9] 이미 있는 기술은 다시 추가 안 함', new Set(after.techniqueIds).size === after.techniqueIds.length);
const c2 = getCurriculum(c.id);
check('[L10] 수업 Day에도 반영(기술+드릴)', res.added.every((a) => c2.days[0].techniqueIds.includes(a.techniqueId)) && c2.days[0].drills.some((d) => d.sequenceId === 'shared:s2'), c2.days[0]);
const again = L.addConnectedToActiveLesson(jab.id, index, { art: 'boxing' });
check('[L11] 더 추가할 게 없으면 정직하게 안내', again.added.length === 0 && /찾지 못해/.test(again.message), again.message);
SS.updateCoachDayRun((r) => ({ ...r, step: 'recap' }));
check('[L12] 마무리 단계에서는 추가 안 함', L.addConnectedToActiveLesson(jab.id, index).added.length === 0);
check('[L13] 수업 컨텍스트 문구', /수업 기술:/.test(L.activeLessonContext() ?? ''));

// ---- evidence style
const PAGE_A = 'Breakdown: Topuria often uses the jab to the body to set up the lead hook. He walks opponents down and cuts off the ring.';
const PAGE_B = 'Analysts note Topuria likes to throw the lead hook after a body jab, and his counter right hand off the slip.';
const pages = [
  { title: 'A', url: 'https://a.example/t', content: PAGE_A, extraction: { status: 'ok' }, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { label: '보통' } },
  { title: 'B', url: 'https://b.example/t', content: PAGE_B, extraction: { status: 'ok' }, sourceType: 'web', sourceTypeLabel: '일반 웹', reliability: { label: '보통' } },
];
const merged = FS.mergeStyleItems([
  { page: pages[0], items: [{ kind: 'setup', text: 'body jab sets up lead hook', steps: ['Jab', 'Lead Hook'], quote: 'uses the jab to the body to set up the lead hook' }, { kind: 'distance', text: 'cuts off the ring', quote: 'walks opponents down and cuts off the ring' }, { kind: 'combo', text: 'fake', steps: ['Jab', 'Cross'], quote: 'throws a spinning back fist after every cross' }] },
  { page: pages[1], items: [{ kind: 'setup', text: 'lead hook after body jab', steps: ['Jab', 'Lead Hook'], quote: 'throw the lead hook after a body jab' }] },
], 'boxing');
const setup = merged.find((i) => i.kind === 'setup');
check('[F1] 두 사이트 인용 확인 = 여러 자료 공통', setup.support === 'multi_source' && setup.techniqueIds.length === 2, setup);
check('[F2] 출처가 "often"이라고 쓴 경우만 빈도 표시', setup.frequencyStated === true && merged.find((i) => i.kind === 'distance').frequencyStated === false);
check('[F3] 한 곳만 = 출처 1곳의 분석', merged.find((i) => i.kind === 'distance').support === 'source_analysis');
check('[F4] 원문에 없는 인용 = 확인 못함', merged.find((i) => i.kind === 'combo').support === 'unconfirmed');
const inferred = FS.inferConnections(merged, index, 'boxing');
check('[F5] DB 기록 기반 연결은 AI 추론으로 표시', inferred.length > 0 && inferred.every((i) => i.support === 'ai_inference' && /자료는 아님/.test(i.text)), inferred);

const fakeDeps = {
  research: async (req) => req.kind === 'video'
    ? { ok: true, kind: 'video', results: [{ title: 'Topuria highlights', url: 'https://youtube.com/watch?v=1', extraction: { status: 'not_attempted' }, sourceType: 'video', sourceTypeLabel: '영상', reliability: { label: '보통' } }], diagnostics: {} }
    : { ok: true, kind: 'web', results: pages, diagnostics: {} },
  chat: async (req) => ({ ok: true, model: 'fake', evalCount: 1, ms: 1, text: JSON.stringify({ items: req.messages[0].content.includes('Analysts') ? [{ kind: 'setup', text: 'x', steps: ['Jab', 'Lead Hook'], quote: 'throw the lead hook after a body jab' }] : [{ kind: 'setup', text: 'y', steps: ['Jab', 'Lead Hook'], quote: 'uses the jab to the body to set up the lead hook' }] }) }),
  knowledgeIndex: async () => index,
};
const rep = await FS.analyzeFighterStyleWithEvidence('Ilia Topuria', 'boxing', fakeDeps);
check('[F6] 영상은 링크만 + "영상 내용 미확인"', rep.videos.length === 1 && /미확인/.test(rep.videos[0].note) && rep.limits.some((l) => /영상 내용은 앱이 직접 보지 않습니다/.test(l)), rep);
check('[F7] DB 비교 후보 생성(중복/신규 상태)', rep.candidates.length > 0 && rep.candidates.every((c) => ['duplicate', 'verified', 'partially_verified', 'pending', 'insufficient'].includes(c.status)), rep.candidates.map((c) => c.status));
const failRep = await FS.analyzeFighterStyleWithEvidence('X', 'boxing', { ...fakeDeps, research: async () => ({ ok: false, code: 'NOT_RUNNING', message: '검색 서버 꺼짐' }) });
check('[F8] 검색 실패 = 분석 항목 없음 + 사유', failRep.items.length === 0 && !failRep.searched && failRep.limits.some((l) => /검색 서버 꺼짐/.test(l)), failRep);
check('[F9] 종목 → 무술 id', FS.artFromSport('MMA (UFC)') === 'mixed-martial-arts' && FS.artFromSport('Boxing') === 'boxing');
check('[S] 실제 Gemini/Tavily 호출 0', realCalls === 0);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
