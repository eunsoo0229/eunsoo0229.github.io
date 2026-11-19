// 신규 기술 카테고리 — hierarchical selection, new categories, duplicate check, recommendation, management,
// registration with rollback, taxonomy / AI coach integration. Offline (logged out → device-local categories;
// AI mocked). Run: node .devtools/test-technique-categories.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = new Map();
globalThis.window = globalThis;
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
await load('/src/lib/categoryRegistry/taxonomy.ts');
const SV = await load('/src/lib/categoryRegistry/service.ts');
const ST = await load('/src/lib/categoryRegistry/store.ts');
const RG = await load('/src/lib/categoryRegistry/register.ts');
const RC = await load('/src/lib/categoryRegistry/recommend.ts');
const CO = await load('/src/lib/categoryRegistry/coach.ts');
const TX = await load('/src/lib/techniqueTaxonomy/index.ts');
const R = await load('/src/lib/addTeq/repository.ts');
const U = await load('/src/lib/userTechniques/service.ts');
const TC = await load('/src/lib/techniqueCanonical/index.ts');
const Q = await load('/src/lib/coachKnowledge/questions.ts');
const SE = await load('/src/lib/search.ts');
const LD = await load('/src/lib/loadData.ts');

const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const flat = (art) => SV.flattenPicker(SV.categoryPickerTree(art));
const node = (art, id) => flat(art).find((n) => n.id === id);
const tech = (o) => ({ id: 'bjj__qa-underhook-sweep', martialArt: 'bjj', name: 'QA Underhook Sweep', koreanName: 'QA 언더훅 스윕', aliases: [], category: '하프 가드 (Half Guard)', positions: ['하프 가드 (Half Guard)'], description: '하프 가드 바텀에서 언더훅을 잡고 상대를 넘기는 스윕입니다.', purpose: null, principles: [], variations: [], counters: [], defenses: [], transitions: [], relatedTechniques: [], relatedMartialArts: [], difficulty: 'intermediate', tags: [], youtubeSearchQuery: '', videos: [], source: 'user_added', ...o });
const rec = (t) => ({ id: t.id, technique: t, status: 'approved', addedByUserId: null, duplicateCheck: { isDuplicate: false, matchedTechniqueId: null, matchedTechniqueName: null, reason: '' }, verification: { verdict: 'confirmed', confidence: 90, martialArtConfirmed: t.martialArt, category: t.category, canonicalName: t.name, evidenceNotes: [], groundingSources: [], usedSearchGrounding: true, reason: '' }, createdAt: '', updatedAt: '' });
// stand-in for registerDiscoveredTechnique: the shared library insert (local cache)
const register = async (r) => (R.addTeqRepository.upsertMany([{ id: r.id, technique: r.technique, status: 'approved', createdAt: '', updatedAt: '' }]), { id: r.id, techniqueName: r.technique.name, technique: r.technique });

// ---------------- 1. 계층형 선택
const hg = node('bjj', 'bjj/half-guard');
check('[1] BJJ → 하프 가드 대분류', !!hg && hg.level === 2 && hg.categoryString === '하프 가드 (Half Guard)', hg && { id: hg.id, cat: hg.categoryString });
check('[1] 하프 가드 → 스윕 하위 (기존 또는 자동 분류 항목)', hg?.children.some((c) => c.id === 'bjj/half-guard/sweep'), hg?.children.map((c) => c.id));
check('[1] 하위 노드는 상위의 카테고리 이름을 이어받음 (기존 필터 호환)', node('bjj', 'bjj/half-guard/sweep')?.categoryString === '하프 가드 (Half Guard)');
const cg = node('bjj', 'bjj/closed-guard');
check('[1] 클로즈드 가드 → 서브미션 하위', cg?.children.some((c) => c.dim === 'submission'), cg?.children.map((c) => c.ko));
const mmaClinch = flat('mixed-martial-arts').find((n) => /클린치/.test(n.ko) && n.level === 2);
check('[1] MMA → 클린치 → 테이크다운 계열 선택지', !!mmaClinch && (mmaClinch.children.some((c) => /테이크다운|takedown/i.test(`${c.ko} ${c.en}`)) || flat('mixed-martial-arts').some((n) => /테이크다운/.test(n.ko))), mmaClinch && mmaClinch.children.map((c) => c.ko));
const ARTS = ['bjj', 'mixed-martial-arts', 'wrestling', 'boxing', 'muay-thai', 'kickboxing', 'taekwondo', 'karate', 'sambo', 'judo'];
check('[9] 등록된 모든 무술에 카테고리 트리', ARTS.every((a) => SV.categoryPickerTree(a).length >= 3), Object.fromEntries(ARTS.map((a) => [a, SV.categoryPickerTree(a).length])));
check('[7] 한 무술의 선택지에 다른 무술 카테고리가 섞이지 않음', ARTS.every((a) => flat(a).every((n) => n.id.startsWith(`${a}/`))));

// ---------------- 5. 중복 검사
const m = (o) => SV.findCategoryMatches({ art: 'bjj', parentId: 'bjj/half-guard', ko: '', en: '', ...o });
check('[5] "Half Guard Sweep" (하프 가드 아래) = 기존 스윕', m({ en: 'Half Guard Sweep' }).some((x) => x.kind === 'same' && x.nodeId === 'bjj/half-guard/sweep'), m({ en: 'Half Guard Sweep' }));
check('[5] "Half Guard Sweeps" = 기존 스윕', m({ en: 'Half Guard Sweeps' }).some((x) => x.kind === 'same'));
check('[5] "스윕" = 기존 스윕 (같은 개념)', m({ ko: '스윕' }).some((x) => x.kind === 'same' && x.nodeId === 'bjj/half-guard/sweep'));
check('[5] 새 대분류 "하프 가드 스윕" = 기존 하프 가드 › 스윕 (전체 경로)', SV.findCategoryMatches({ art: 'bjj', parentId: null, ko: '하프 가드 스윕', en: '' }).some((x) => x.kind === 'same' && x.nodeId === 'bjj/half-guard/sweep'));
check('[5] 클로즈드 가드 아래 "하프 가드 스윕"은 같은 개념으로 막지 않음 (다른 개념 통합 금지)', !SV.findCategoryMatches({ art: 'bjj', parentId: 'bjj/closed-guard', ko: '언더훅 스윕', en: '' }).some((x) => x.kind === 'same'));
check('[5] 다른 무술 카테고리와는 비교하지 않음', !SV.findCategoryMatches({ art: 'boxing', parentId: null, ko: '하프 가드', en: 'Half Guard' }).some((x) => x.nodeId.startsWith('bjj/')));
let v = SV.validateNewCategory({ art: 'bjj', parentId: 'bjj/half-guard', ko: '스윕', en: 'Sweeps' });
check('[5] 같은 카테고리 생성 차단 + 기존 카테고리 안내', !v.ok && /이미 같은 카테고리/.test(v.message) && v.matches?.length, v);
v = SV.validateNewCategory({ art: 'bjj', parentId: 'boxing/basic-punches', ko: 'X', en: 'X' });
check('[7] 다른 무술 상위 카테고리 거부', !v.ok && /다른 무술/.test(v.message));
v = SV.validateNewCategory({ art: 'bjj', parentId: null, ko: '스크램블', en: '' });
check('[4] 새 대분류는 영어 이름 필요', !v.ok);

// ---------------- 3/4. 새 카테고리 생성 (로그아웃 = 이 기기)
let c1 = await SV.createCategory({ art: 'bjj', parentId: 'bjj/half-guard', ko: '언더훅 게임', en: 'Underhook Game', description: '하프 가드 바텀 언더훅 공방' }, null);
check('[3] 하위 카테고리 생성', c1.ok && c1.value.parentId === 'bjj/half-guard' && c1.value.id.startsWith('bjj/half-guard/c-') && c1.value.local, c1.ok ? c1.value : c1.message);
check('[3] 만든 직후 선택지에 나타남 (기술 없어도)', !!node('bjj', c1.value.id) && node('bjj', 'bjj/half-guard').children.some((x) => x.id === c1.value.id));
const again = await SV.createCategory({ art: 'bjj', parentId: 'bjj/half-guard', ko: '언더훅게임', en: '' }, null);
check('[5] 같은 이름 다시 생성 차단 (띄어쓰기 차이)', !again.ok, again.message);
const c2 = await SV.createCategory({ art: 'bjj', parentId: c1.value.id, ko: '언더훅 스윕', en: 'Underhook Sweeps' }, null);
check('[3] 하위 카테고리 안에 세부 카테고리 (4단계)', c2.ok && node('bjj', c2.value.id)?.level === 4, c2.ok ? node('bjj', c2.value.id)?.path : c2.message);
const c3 = await SV.createCategory({ art: 'bjj', parentId: c2.value.id, ko: '더 깊게', en: 'Deeper' }, null);
check('[10] 4단계를 넘는 카테고리 거부', !c3.ok, c3.message);
const top = await SV.createCategory({ art: 'bjj', parentId: null, ko: '스크램블', en: 'Scrambles' }, null);
check('[4] 새 대분류 생성 (카테고리 이름 "스크램블 (Scrambles)")', top.ok && top.value.id === 'bjj/auto-scrambles' && top.value.categoryString === '스크램블 (Scrambles)', top.ok ? top.value : top.message);
check('[4] 새 대분류가 선택지 최상위에', SV.categoryPickerTree('bjj').some((r) => r.id === 'bjj/auto-scrambles'));

// ---------------- 6. 자동 추천
const r1 = RC.recommendCategory('bjj', tech());
check('[6] 설명이 "…스윕입니다" → 하프 가드 › 스윕 추천 + 이유 + 확신도', r1.nodeId === 'bjj/half-guard/sweep' && r1.confidence !== 'low' && r1.reasons.length >= 2 && r1.useExisting, r1);
const r2 = RC.recommendCategory('bjj', tech({ id: 'bjj__qa-x', name: 'QA Mystery', koreanName: 'QA 미스터리', category: '없는 분류', description: '무엇인지 알 수 없는 동작' }));
check('[6] 맞는 카테고리 없음 → 확신도 낮음, 자동 확정 안 함', r2.nodeId === null && r2.confidence === 'low' && !r2.useExisting);
const ai = async () => ({ ok: true, data: { nodeId: 'bjj/does-not-exist', confidence: 'high', reason: 'x', newCategory: { parentId: 'bjj/half-guard', ko: '스윕', en: 'Sweeps', reason: '새로 필요' } } });
const r3 = await RC.recommendCategoryWithAi('bjj', tech(), ai);
check('[6] AI가 없는 카테고리를 고르면 무시 (규칙 추천 유지)', r3.nodeId === 'bjj/half-guard/sweep');
check('[6] AI가 제안한 새 카테고리 = 제안만, 중복이면 표시', r3.proposal && r3.proposal.duplicateOf === 'bjj/half-guard/sweep' && !flat('bjj').some((n) => n.ko === '스윕' && n.custom));
const r4 = await RC.recommendCategoryWithAi('bjj', tech(), async () => ({ ok: true, data: { nodeId: 'bjj/closed-guard', confidence: 'high', reason: '다름', newCategory: null } }));
check('[6] 규칙과 AI가 다르면 확신도 낮음 (사용자 확인)', r4.confidence === 'low' && r4.reasons.some((x) => /직접 확인/.test(x)));

// ---------------- 1/2/3. 등록 (카테고리와 함께)
let reg = await RG.registerWithCategory(rec(tech()), { nodeId: 'bjj/half-guard/sweep', draft: null, tags: ['sweep'] }, null, register);
check('[2] 하위 카테고리(하프 가드 › 스윕)로 등록 — 카테고리 이름·노드·태그 기록', reg.ok && reg.saved.technique.category === '하프 가드 (Half Guard)' && reg.saved.technique.taxonomyNodeId === 'bjj/half-guard/sweep' && reg.saved.technique.taxonomyTags[0] === 'sweep', reg.ok ? reg.saved.technique.taxonomyNodeId : reg.message);
const sweepIds = TX.techniqueIdsForNode('bjj/half-guard/sweep');
check('[1] 기존 카테고리 등록 기술이 트리에 보임 (설명 근거로 스윕)', sweepIds.has('bjj__qa-underhook-sweep') && TX.techniqueIdsForNode('bjj/half-guard').has('bjj__qa-underhook-sweep'));
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-underhook-sweep' })), { nodeId: 'bjj/half-guard', draft: null, tags: [] }, null, register);
check('[6] 같은 기술 다시 등록 차단', !reg.ok && /이미 이 무술에/.test(reg.message), reg.message);
const armbar = U.getUnifiedTechniquesByMartialArt('bjj').find((t) => /^armbar$/i.test(t.name));
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-armbar', name: armbar?.name ?? 'Armbar', koreanName: null })), { nodeId: 'bjj/half-guard', draft: null, tags: [] }, null, register);
check('[6] 기존 기술과 같은 이름 등록 차단 (Armbar)', !reg.ok && reg.duplicateOf, reg.message);
const before = TX.getArtTaxonomy('bjj').nodes.get('bjj/half-guard').count;
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-hook-roll', name: 'QA Hook Roll', koreanName: 'QA 훅 롤', description: '언더훅으로 굴려 넘기는 동작' })), { nodeId: c2.value.id, draft: null, tags: [] }, null, register);
const tax = TX.getArtTaxonomy('bjj');
check('[3] 새로 만든 하위 카테고리로 등록 → 트리에 사용자 노드 (4단계)', reg.ok && tax.nodes.get(c2.value.id)?.kind === 'custom' && tax.nodes.get(c2.value.id)?.level === 4 && TX.techniqueIdsForNode(c2.value.id).has('bjj__qa-hook-roll'), tax.nodes.get(c2.value.id));
check('[9] 상위 카테고리 기술 수 갱신 (하프 가드 +1, 중간 사용자 카테고리 포함)', tax.nodes.get('bjj/half-guard').count === before + 1 && tax.nodes.get(c1.value.id)?.count === 1, { before, after: tax.nodes.get('bjj/half-guard').count });
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-scramble', name: 'QA Funk Roll', koreanName: 'QA 펑크 롤', category: 'x', description: '스크램블 상황에서 굴러 빠져나가는 동작' })), { nodeId: null, draft: null, tags: [] }, null, register);
check('[10] 카테고리 미선택 등록 거부', !reg.ok && /선택/.test(reg.message));
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-scramble', name: 'QA Funk Roll', koreanName: 'QA 펑크 롤', category: 'x', description: '스크램블 상황에서 굴러 빠져나가는 동작' })), { nodeId: 'bjj/auto-scrambles', draft: null, tags: [] }, null, register);
const scrambleTech = U.resolveTechnique('bjj__qa-scramble');
check('[4] 새 대분류로 등록 — 카테고리 이름이 정규화로 바뀌지 않음', reg.ok && scrambleTech?.category === '스크램블 (Scrambles)', scrambleTech?.category);
check('[4] 새 대분류가 트리 Level 2 그룹이 됨 (기술 1)', TX.getArtTaxonomy('bjj').nodes.get('bjj/auto-scrambles')?.level === 2 && TX.getArtTaxonomy('bjj').nodes.get('bjj/auto-scrambles')?.count === 1);
// draft + failure → rollback
const failing = async () => { throw new Error('network down'); };
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-fail', name: 'QA Fail Sweep', koreanName: 'QA 실패 스윕' })), { nodeId: 'bjj/half-guard', draft: { art: 'bjj', parentId: 'bjj/half-guard', ko: '롤백 테스트', en: 'Rollback Test' }, tags: [] }, null, failing);
check('[10] 등록 실패 → 새로 만든 카테고리 롤백', !reg.ok && reg.rolledBack && !ST.listCustomCategories().some((c) => c.ko === '롤백 테스트'), reg.message);
reg = await RG.registerWithCategory(rec(tech({ id: 'bjj__qa-draft', name: 'QA Draft Sweep', koreanName: 'QA 초안 스윕' })), { nodeId: 'bjj/half-guard', draft: { art: 'bjj', parentId: 'bjj/half-guard', ko: '초안 카테고리', en: 'Draft Category' }, tags: [] }, null, register);
check('[3] 등록 화면에서 만든 새 카테고리 → 기술 저장과 함께 생성·자동 선택', reg.ok && reg.createdCategory && reg.saved.technique.taxonomyNodeId === reg.createdCategory.id);
const draftCatId = reg.createdCategory.id;

// ---------------- 10. 검색 / 상세 데이터
check('[10] 신규 기술 검색', U.searchAllTechniques('QA Hook Roll').some((t) => t.id === 'bjj__qa-hook-roll'));
check('[11] 신규 기술 상세 조회 (id 그대로)', U.resolveTechnique('bjj__qa-hook-roll')?.taxonomyNodeId === c2.value.id);
check('[11] 상세의 분류 위치 (classificationOf)', TX.classificationOf('bjj__qa-hook-roll', 'bjj').some((x) => x.node.id === c2.value.id));

// ---------------- 7. 관리 (이 기기 카테고리 = 소유자 편집)
let u = await SV.updateCategory(c1.value.id, { ko: '언더훅 공방', en: 'Underhook Battles' }, null);
check('[7] 이름 변경 (한·영) — 기술 ID·소속 유지', u.ok && node('bjj', c1.value.id)?.ko === '언더훅 공방' && TX.techniqueIdsForNode(c2.value.id).has('bjj__qa-hook-roll'));
u = await SV.updateCategory(c1.value.id, { ko: '딥 하프 가드' }, null);
check('[7] 이름 변경도 중복 검사 (형제와 같은 이름 거부)', !u.ok, u.message);
let mv = await SV.moveCategory(c1.value.id, c2.value.id, null);
check('[10] 순환 참조 이동 거부 (자기 하위로)', !mv.ok && /순환/.test(mv.message), mv.message);
mv = await SV.moveCategory(c1.value.id, 'boxing/footwork', null);
check('[10] 다른 무술로 이동 거부', !mv.ok);
mv = await SV.moveCategory(c1.value.id, 'bjj/closed-guard', null);
check('[10] 다른 대분류로 이동 거부 (기술의 카테고리와 어긋남)', !mv.ok && /같은 대분류/.test(mv.message), mv.message);
mv = await SV.moveCategory(c2.value.id, 'bjj/half-guard', null);
check('[7] 상위 카테고리 변경 (언더훅 공방 › 언더훅 스윕 → 하프 가드 바로 아래)', mv.ok && node('bjj', c2.value.id)?.level === 3, mv.ok ? node('bjj', c2.value.id)?.path : mv.message);
check('[7] 이동 후 기술 ID 그대로 · 새 위치에 보임', U.resolveTechnique('bjj__qa-hook-roll') && TX.taxonomyBreadcrumb(c2.value.id).map((n) => n.ko).join(' › ') === '하프 가드 › 언더훅 스윕', TX.taxonomyBreadcrumb(c2.value.id).map((n) => n.ko));
mv = await SV.moveCategory(c2.value.id, c1.value.id, null);
check('[7] 다시 원래 위치로 이동', mv.ok && node('bjj', c2.value.id)?.level === 4);
let mg = await SV.mergeCategory(draftCatId, c2.value.id, null);
check('[7] 통합 → 기술이 대상 카테고리로', mg.ok && TX.techniqueIdsForNode(c2.value.id).has('bjj__qa-draft') && !TX.getArtTaxonomy('bjj').nodes.has(draftCatId));
let del = await SV.deleteCategory(c2.value.id, null);
check('[7] 기술이 있는 카테고리 삭제 거부', !del.ok, del.message);
del = await SV.deleteCategory(draftCatId, null);
check('[7] 통합된 카테고리는 기술이 가리키는 동안 삭제 거부 (전달 기록 유지)', !del.ok, del.message);
let act = await SV.setCategoryActive(c1.value.id, false, null);
check('[7] 비활성화 → 새 선택지에서 빠짐, 기존 기술은 그대로 보임', act.ok && !node('bjj', c1.value.id) && TX.techniqueIdsForNode(c2.value.id).has('bjj__qa-hook-roll'));
v = SV.validateNewCategory({ art: 'bjj', parentId: c1.value.id, ko: '새거', en: 'New' });
check('[7] 비활성 카테고리 아래 새 카테고리 거부', !v.ok);
check('[5] 비활성 카테고리도 중복 검사 대상 (다시 만들지 않고 재활성화 유도)', SV.findCategoryMatches({ art: 'bjj', parentId: 'bjj/half-guard', ko: '언더훅 공방', en: '' }).some((x) => x.kind === 'same'));
await SV.setCategoryActive(c1.value.id, true, null);
const empty = await SV.createCategory({ art: 'bjj', parentId: 'bjj/half-guard', ko: '빈 카테고리', en: 'Empty' }, null);
del = await SV.deleteCategory(empty.value.id, null);
check('[7] 빈 카테고리 삭제', del.ok && !ST.getCustomCategory(empty.value.id));
check('[7] 카테고리별 기술 수·목록', SV.categoryTechniques(c2.value.id).length === 2 && TX.techniquesForNode(c2.value.id).length === 2);

// ---------------- 9. 모든 무술에서 생성
const made = [];
for (const a of ARTS) {
  const parent = SV.categoryPickerTree(a)[0];
  const r = await SV.createCategory({ art: a, parentId: parent.id, ko: `QA ${a} 세부`, en: `QA ${a} detail` }, null);
  made.push(r.ok);
}
check('[9] 10개 무술 모두 하위 카테고리 생성', made.every(Boolean), made);

// ---------------- 8. AI 코치
const ans = CO.techniqueAddAnswer('하프 가드에서 쓸 수 있는 새로운 스윕 기술을 추가하고 싶어', 'bjj');
check('[8] "하프 가드 새 스윕 기술 추가" → 카테고리 경로·기술 수·등록 링크, 아무것도 만들지 않음', ans && /하프 가드 › 스윕/.test(ans.text) && /임의로 기술이나 카테고리를 만들지는 않습니다/.test(ans.text) && ans.link?.includes('node=bjj%2Fhalf-guard%2Fsweep'), ans);
const exists = CO.techniqueAddAnswer('암바 기술 추가하고 싶어', 'bjj');
check('[8] 이미 있는 기술 추가 요청 → 있다고 알려 줌 (중복 생성 안 함)', exists && /이미 MARTIALDEX에 있는 기술/.test(exists.text), exists?.text);
const viaCoach = await Q.answerCoachQuestion(null, '하프 가드에서 쓸 수 있는 새로운 스윕 기술을 추가하고 싶어', { useModel: false, martialArt: 'bjj' });
check('[8] AI 코치 질문 경로(answerCoachQuestion)에서도 같은 안내', /하프 가드 › 스윕/.test(viaCoach.text), viaCoach.text.slice(0, 160));
const node2 = TX.findTaxonomyNodesInText('하프 가드 언더훅 공방 기술 뭐 있어', ['bjj']);
check('[12] AI 코치가 새 사용자 카테고리를 인식 (이름으로 찾기)', node2.some((n) => n.id === c1.value.id), node2.map((n) => n.id));

// ---------------- 10. 기존 데이터 보존
check('[10] 공식 기술 수 그대로', LD.allTechniques.length === 1138, LD.allTechniques.length);
check('[10] 기존 기술 카테고리 그대로 (공식 데이터 불변)', LD.getTechnique('bjj__armbar')?.category === LD.getTechniquesByMartialArt('bjj').find((t) => t.id === 'bjj__armbar')?.category);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await server.close();
process.exit(failed ? 1 : 0);
