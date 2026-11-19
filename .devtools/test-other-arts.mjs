// New technique → the sibling arts that also use it (techniqueCanonical/otherArts.ts).
// Offline: the AI / web search are mocked. Run: node .devtools/test-other-arts.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = new Map();
globalThis.window = globalThis;
const et = new EventTarget();
globalThis.addEventListener = (...a) => et.addEventListener(...a);
globalThis.removeEventListener = (...a) => et.removeEventListener(...a);
globalThis.dispatchEvent = (e) => et.dispatchEvent(e);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const OA = await server.ssrLoadModule('/src/lib/techniqueCanonical/otherArts.ts');
const R = await server.ssrLoadModule('/src/lib/addTeq/repository.ts');
const U = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
const TC = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const LD = await server.ssrLoadModule('/src/lib/loadData.ts');
await server.close();

const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
const tech = (o) => ({ id: 'kickboxing__qa-mid-kick', martialArt: 'kickboxing', name: 'QA Mid Kick', koreanName: 'QA 미들킥', aliases: [], category: '킥', positions: [], description: '몸통 높이로 차는 라운드 킥', purpose: null, principles: [], variations: [], counters: [], defenses: [], transitions: [], relatedTechniques: [], relatedMartialArts: [], difficulty: null, tags: [], youtubeSearchQuery: '', videos: [], ...o });
const asked = [];
const deps = (arts, { web = true, grounding = [] } = {}) => ({
  search: async () => (web ? { ok: true, results: [{ title: 'Middle kick guide', url: 'https://example.org/mid', snippet: 'The middle kick is used in Muay Thai, kickboxing and MMA' }] } : { ok: false }),
  askJson: async (p) => (asked.push(p), { ok: true, data: { arts }, groundingSources: grounding, usedSearchGrounding: !web, webSearchQueries: [] }),
});

check('[후보] 킥복싱 → 다른 타격 무술 + MMA', JSON.stringify(OA.siblingArtsOf('kickboxing')) === JSON.stringify(['boxing', 'muay-thai', 'karate', 'taekwondo', 'mixed-martial-arts']), OA.siblingArtsOf('kickboxing'));
check('[후보] BJJ → 다른 그래플링 무술 + MMA', OA.siblingArtsOf('bjj').join() === 'judo,wrestling,sambo,mixed-martial-arts');
check('[후보] 홈트·헬스는 없음', OA.siblingArtsOf('home-training').length === 0);

const mt = LD.getMartialArt('muay-thai').categories;
let r = await OA.researchOtherArts(tech(), deps([
  { art: 'muay-thai', used: true, confidence: 'high', category: '장거리 킥 (Round Kick / Low Kick 계열)', reason: '무에타이 미들킥', sourceIds: ['S1'] },
  { art: 'mixed-martial-arts', used: true, confidence: 'medium', category: 'MMA 킥복싱', reason: 'MMA에서 씀', sourceIds: ['S1'] },
  { art: 'boxing', used: false, confidence: 'high', category: null, reason: '복싱은 킥 금지', sourceIds: ['S1'] },
  { art: 'karate', used: true, confidence: 'low', category: null, reason: '애매', sourceIds: ['S1'] },
  { art: 'judo', used: true, confidence: 'high', category: null, reason: '후보 아님' },
]));
const got = r.arts.map((a) => a.martialArt).join();
check('[판단] 확신 높음/보통 + 사용됨만 추가 (무에타이·MMA)', got === 'muay-thai,mixed-martial-arts', r.arts);
check('[판단] 금지(복싱)·확신 낮음(가라테)·후보 밖(유도) 제외', !/boxing|karate|judo/.test(got));
check('[분류] 그 무술의 공식 분류로 정규화', r.arts.every((a) => LD.getMartialArt(a.martialArt).categories.includes(a.category)), r.arts.map((a) => a.category));
check('[근거] 인용된 웹 자료가 남음', r.sources.length === 1 && r.method === 'ai_web_sources');
check('[질문] 후보 무술 목록과 분류 목록을 AI에 전달', /muay-thai/.test(asked[0].contextText) && asked[0].contextText.includes(mt[0]));

r = await OA.researchOtherArts(tech(), deps([{ art: 'muay-thai', used: true, confidence: 'high', category: null, reason: 'x', sourceIds: [] }]));
check('[근거 없음] 인용 자료가 없으면 아무 무술도 추가 안 함', r.arts.length === 0 && r.method === 'skipped' && !!r.reason, r);
r = await OA.researchOtherArts(tech(), deps([{ art: 'muay-thai', used: true, confidence: 'high', category: null, reason: 'x' }], { web: false, grounding: [{ title: 'g', uri: 'https://example.org/g' }] }));
check('[grounding] 웹 검색이 없으면 Google 검색 grounding 근거로 판단', r.arts.length === 1 && r.method === 'ai_grounded');
r = await OA.researchOtherArts(tech(), { search: async () => ({ ok: false }), askJson: async () => ({ ok: false, code: 'RATE_LIMIT', message: '' }) });
check('[AI 실패] 추가 무술 없음 + 이유', r.arts.length === 0 && /한도/.test(r.reason ?? ''));

const existing = LD.getTechniquesByMartialArt('muay-thai')[0];
r = await OA.researchOtherArts(tech({ name: existing.name, koreanName: null }), deps([{ art: 'muay-thai', used: true, confidence: 'high', category: null, reason: 'x', sourceIds: ['S1'] }]));
check('[중복] 같은 이름 기술이 이미 있는 무술엔 두 번째 복사본을 만들지 않음', r.arts.length === 0, existing.name);

const t = await OA.withOtherArts(tech(), deps([
  { art: 'muay-thai', used: true, confidence: 'high', category: '장거리 킥 (Round Kick / Low Kick 계열)', reason: '무에타이 미들킥', sourceIds: ['S1'] },
  { art: 'mixed-martial-arts', used: true, confidence: 'high', category: 'MMA 킥복싱', reason: 'MMA', sourceIds: ['S1'] },
]));
check('[기록] martialArts = 킥복싱(주) + 무에타이 + MMA', t.martialArts.join() === 'kickboxing,muay-thai,mixed-martial-arts' && t.martialArt === 'kickboxing', t.martialArts);
check('[기록] 무술별 분류 (킥복싱은 원래 분류 유지)', t.categoryByArt.kickboxing === '킥' && t.categoryByArt['muay-thai'] === '장거리 킥 (Round Kick / Low Kick 계열)', t.categoryByArt);
const again = await OA.withOtherArts(t, { search: async () => { throw new Error('should not run'); }, askJson: async () => { throw new Error('should not run'); } });
check('[재조사 없음] 이미 조사된 기술은 그대로', again === t);
const gym = { ...tech(), martialArt: 'gym-training' };
check('[헬스] 무술이 아닌 영역은 조사하지 않음', (await OA.withOtherArts(gym, deps([]))) === gym);

// The saved library record shows up in every art's list (the bug: 킥복싱에만 들어감).
R.addTeqRepository.upsertMany([{ id: t.id, technique: t, status: 'approved', createdAt: '', updatedAt: '' }]);
const inArt = (a) => U.getUnifiedTechniquesByMartialArt(a).some((x) => x.id === t.id);
check('[목록] 킥복싱 목록에 있음', inArt('kickboxing'));
check('[목록] 무에타이 목록에도 있음', inArt('muay-thai'));
check('[목록] MMA 목록에도 있음', inArt('mixed-martial-arts'));
check('[목록] 복싱 목록엔 없음', !inArt('boxing'));
const saved = U.resolveTechnique(t.id);
check('[분류] 무에타이에선 무에타이 분류로 보임', TC.techniqueCategoryInArt(saved, 'muay-thai') === '장거리 킥 (Round Kick / Low Kick 계열)', TC.techniqueCategoryInArt(saved, 'muay-thai'));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
