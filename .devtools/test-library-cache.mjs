// In-memory technique-library cache (addTeq / userTechniques repositories + techniqueCanonical):
// must never serve stale data. Offline. Run: node .devtools/test-library-cache.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = new Map();
let reads = 0;
globalThis.window = globalThis;
const et = new EventTarget();
globalThis.addEventListener = (...a) => et.addEventListener(...a);
globalThis.removeEventListener = (...a) => et.removeEventListener(...a);
globalThis.dispatchEvent = (e) => et.dispatchEvent(e);
globalThis.localStorage = { getItem: (k) => (reads++, store.get(k) ?? null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const R = await server.ssrLoadModule('/src/lib/addTeq/repository.ts');
const UR = await server.ssrLoadModule('/src/lib/userTechniques/repository.ts');
const TC = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
const U = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
const SE = await server.ssrLoadModule('/src/lib/storageEvents.ts');
await server.close();

const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 200) : '')));
const tech = (id, name) => ({ id, technique: { id, martialArt: 'bjj', name, koreanName: null, aliases: [], category: '스윕', positions: [], description: '', purpose: null, principles: [], variations: [], counters: [], defenses: [], transitions: [], relatedTechniques: [], relatedMartialArts: [], difficulty: null, tags: [], youtubeSearchQuery: '', videos: [] }, status: 'approved', createdAt: '', updatedAt: '' });

check('[초기] 비어 있으면 없음', !U.resolveTechnique('bjj__qa-one'));
R.addTeqRepository.upsertMany([tech('bjj__qa-one', 'QA One')]);
check('[쓰기] 저장 직후 바로 조회됨', U.resolveTechnique('bjj__qa-one')?.name === 'QA One');
reads = 0;
for (let i = 0; i < 2000; i++) {
  U.resolveTechnique('bjj__qa-one');
  TC.libraryTechniques();
  TC.canonicalTechniqueId('bjj__qa-one');
}
check('[성능] 조회 6,000번 동안 localStorage 읽기 0번 (전에는 매번 읽음)', reads === 0, reads);
R.addTeqRepository.upsertMany([tech('bjj__qa-one', 'QA One (수정)'), tech('bjj__qa-two', 'QA Two')]);
check('[갱신] 같은 기술을 다시 받으면 바뀐 내용이 보임', U.resolveTechnique('bjj__qa-one')?.name === 'QA One (수정)' && !!U.resolveTechnique('bjj__qa-two'));
// another tab / restore writes localStorage directly
store.set('martialdex:add-teq-cache', JSON.stringify([tech('bjj__qa-three', 'QA Three')]));
globalThis.dispatchEvent(Object.assign(new Event('storage'), { key: 'martialdex:add-teq-cache' }));
check('[다른 탭] storage 이벤트 후 새 데이터', !!U.resolveTechnique('bjj__qa-three') && !U.resolveTechnique('bjj__qa-two'));
store.delete('martialdex:add-teq-cache');
SE.announceStorageReplaced();
check('[계정 전환·복원] 일괄 교체 알림 후 지워진 데이터가 남지 않음', !U.resolveTechnique('bjj__qa-three') && TC.libraryTechniques().addTeq.length === 0);
UR.userTechniqueRepository.save({ ...tech('bjj__qa-mine', 'QA Mine'), addedByUserId: null });
check('[내 기술] 저장 즉시 조회 + 라이브러리 반영', U.resolveTechnique('bjj__qa-mine')?.name === 'QA Mine' && TC.libraryTechniques().mine.some((t) => t.id === 'bjj__qa-mine'));
const before = UR.userTechniqueRepository.list();
UR.userTechniqueRepository.save({ ...tech('bjj__qa-mine2', 'QA Mine 2'), addedByUserId: null });
check('[내 기술] 이전에 받은 목록은 바뀌지 않음 (저장 시 복사)', before.length === 1 && UR.userTechniqueRepository.list().length === 2);
UR.userTechniqueRepository.delete('bjj__qa-mine');
check('[내 기술] 삭제 즉시 반영', !U.resolveTechnique('bjj__qa-mine') && !!U.resolveTechnique('bjj__qa-mine2'));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
