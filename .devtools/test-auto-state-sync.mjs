// 계정 데이터 자동 동기화 — offline test (실제 autoState.ts; Supabase 와 기기 정보만 대역).
//
// 가장 중요한 것은 **덮어쓰기 규칙**이다. 자동 복원은 기록을 지울 수 있으므로:
//   · 클라우드가 더 새롭고 이 기기는 안 바뀌었다 → 적용
//   · 양쪽 다 바뀌었다 → conflict (아무것도 덮어쓰지 않는다)
//   · 비밀값(자체 AI 서버 토큰)·기기 전용 값은 아예 올리지 않는다
//   node .devtools/test-auto-state-sync.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostate-'));
const out = path.join(dir, 'r.mjs');
const entry = path.join(dir, 'entry.ts');

// Supabase·기기 정보 대역. 전역에 둔 테이블 하나를 보고 쓴다.
const stub = path.join(dir, 'stub-supabase.ts');
fs.writeFileSync(stub, `
declare const globalThis: any;
export const supabase: any = {
  from(_name: string) {
    return {
      upsert(v: any) {
        globalThis.__row = { ...v, updated_at: globalThis.__nextUpdatedAt ?? new Date().toISOString() };
        globalThis.__upserts = (globalThis.__upserts ?? 0) + 1;
        return { select: () => ({ maybeSingle: async () => ({ data: { updated_at: globalThis.__row.updated_at }, error: null }) }) };
      },
      select() {
        return { eq: () => ({ maybeSingle: async () => ({ data: globalThis.__row ?? null, error: globalThis.__selectError ?? null }) }) };
      },
    };
  },
};
`);
const stubDevice = path.join(dir, 'stub-device.ts');
fs.writeFileSync(stubDevice, `export async function getDeviceInfo() { return { deviceName: '테스트 기기', platform: 'test', appVersion: '0.0.0' }; }`);
const stubGuard = path.join(dir, 'stub-guard.ts');
fs.writeFileSync(stubGuard, `export function isStillCurrentUser(_id: string) { return true; }`);

fs.writeFileSync(entry, `export * as A from ${JSON.stringify(path.join(APP, 'src/lib/cloudSync/autoState.ts'))};`);

const alias = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /supabase\/client$/ }, () => ({ path: stub }));
    b.onResolve({ filter: /device\/deviceInfo$/ }, () => ({ path: stubDevice }));
    b.onResolve({ filter: /cloudSync\/syncGuard$|\.\/syncGuard$/ }, () => ({ path: stubGuard }));
  },
};

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { href: 'http://localhost/', search: '', hash: '' },
};
globalThis.localStorage = storage;
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };

await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [alias, viteGlobPlugin] });
const { A } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (n, c, d) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} — ${n}${c ? '' : ` :: ${JSON.stringify(d)?.slice(0, 300)}`}`); };
const reset = () => { mem.clear(); globalThis.__row = null; globalThis.__upserts = 0; globalThis.__selectError = null; globalThis.__nextUpdatedAt = null; };
const USER = 'u1';

// ---------------------------------------------------------------- A. 올리는 범위
console.log('\n=== A. 무엇을 올리는가 ===');
reset();
localStorage.setItem('martialdex:training-history', '[{"a":1}]');
localStorage.setItem('martialdex:training-goals', '{"g":1}');
localStorage.setItem('martialdex:self-ai-server', '{"token":"비밀값"}');
localStorage.setItem('martialdex:local-model-pick', 'qwen');
localStorage.setItem('other:unrelated', 'x');
const snap = A.snapshotForSync();
check('[A1] 훈련 기록·목표는 올린다', !!snap['martialdex:training-history'] && !!snap['martialdex:training-goals'], Object.keys(snap));
check('[A2] 자체 AI 서버 토큰은 올리지 않는다 (비밀값이 서버로 가면 안 된다)', !('martialdex:self-ai-server' in snap), Object.keys(snap));
check('[A3] 기기 전용 값은 올리지 않는다', !('martialdex:local-model-pick' in snap), Object.keys(snap));
check('[A4] martialdex: 가 아닌 키는 건드리지 않는다', !('other:unrelated' in snap));

// ---------------------------------------------------------------- B. 바뀐 것이 있을 때만
console.log('\n=== B. 불필요한 업로드를 하지 않는가 ===');
reset();
localStorage.setItem('martialdex:a', '1');
check('[B1] 한 번도 올린 적 없으면 올릴 것이 있다', A.needsPush() === true);
let r = await A.pushState(USER);
check('[B2] 올리기 성공', r.ok === true && r.keyCount === 1, r);
check('[B3] 올린 직후에는 올릴 것이 없다', A.needsPush() === false);
const before = globalThis.__upserts;
r = await A.pushState(USER);
check('[B4] 변경이 없으면 네트워크를 쓰지 않는다', r.ok === false && globalThis.__upserts === before, { r, upserts: globalThis.__upserts });
localStorage.setItem('martialdex:a', '2');
check('[B5] 값이 바뀌면 다시 올릴 것이 생긴다', A.needsPush() === true);

// ---------------------------------------------------------------- C. 덮어쓰기 규칙 (가장 중요)
console.log('\n=== C. 자동 복원이 기록을 지우지 않는가 ===');
// C-1 다른 기기가 올린 더 새로운 상태 + 이 기기는 안 바뀜 → 적용
reset();
localStorage.setItem('martialdex:x', 'old');
await A.pushState(USER);                       // 이 기기가 올림
const cloudData = { 'martialdex:x': 'new-from-other-device', 'martialdex:y': 'added' };
globalThis.__row = { user_id: USER, data: cloudData, device_name: '다른 기기', updated_at: new Date(Date.now() + 60000).toISOString() };
let p = await A.pullState(USER);
check('[C1] 이 기기가 안 바뀌었으면 새 상태를 받아 적용한다', p.kind === 'applied' && localStorage.getItem('martialdex:x') === 'new-from-other-device', p);
check('[C2] 받은 상태에 있던 새 항목도 들어온다', localStorage.getItem('martialdex:y') === 'added');

// C-2 양쪽 다 바뀜 → conflict, 아무것도 덮어쓰지 않음
reset();
localStorage.setItem('martialdex:x', 'mine-v1');
await A.pushState(USER);
localStorage.setItem('martialdex:x', 'mine-v2-changed-here');   // 이 기기에서 변경
globalThis.__row = { user_id: USER, data: { 'martialdex:x': 'theirs' }, device_name: '다른 기기', updated_at: new Date(Date.now() + 60000).toISOString() };
p = await A.pullState(USER);
check('[C3] 양쪽 다 바뀌면 conflict 로 알린다', p.kind === 'conflict', p);
check('[C4] conflict 일 때 로컬 기록을 덮어쓰지 않는다 (기록 보존)', localStorage.getItem('martialdex:x') === 'mine-v2-changed-here', localStorage.getItem('martialdex:x'));
check('[C5] 어느 기기 것인지 알려 준다', p.kind === 'conflict' && p.cloud.deviceName === '다른 기기', p);

// C-3 사용자가 "클라우드 것으로" 선택 → force 로 덮어쓴다
p = await A.pullState(USER, { force: true });
check('[C6] 사용자가 직접 고르면 그때는 덮어쓴다', p.kind === 'applied' && localStorage.getItem('martialdex:x') === 'theirs', p);

// C-4 이미 받은 상태면 다시 적용하지 않는다
p = await A.pullState(USER);
check('[C7] 이미 최신이면 아무것도 하지 않는다', p.kind === 'up_to_date', p);

// C-5 클라우드에 아무것도 없으면 로컬을 지우지 않는다
reset();
localStorage.setItem('martialdex:keep', 'me');
p = await A.pullState(USER);
check('[C8] 클라우드가 비어 있으면 로컬을 지우지 않는다', p.kind === 'none' && localStorage.getItem('martialdex:keep') === 'me', p);

// C-6 받아 적용할 때도 비밀값·기기 전용 값은 건드리지 않는다
reset();
localStorage.setItem('martialdex:self-ai-server', '{"token":"내 토큰"}');
localStorage.setItem('martialdex:local-model-pick', 'qwen');
localStorage.setItem('martialdex:data', 'old');
await A.pushState(USER);
globalThis.__row = { user_id: USER, data: { 'martialdex:data': 'new' }, device_name: '다른 기기', updated_at: new Date(Date.now() + 60000).toISOString() };
p = await A.pullState(USER);
check('[C9] 복원해도 기기의 토큰은 남는다', localStorage.getItem('martialdex:self-ai-server') === '{"token":"내 토큰"}', localStorage.getItem('martialdex:self-ai-server'));
check('[C10] 복원해도 기기 전용 값은 남는다', localStorage.getItem('martialdex:local-model-pick') === 'qwen');
check('[C11] 동기화 대상 값은 바뀐다', localStorage.getItem('martialdex:data') === 'new');

// ---------------------------------------------------------------- D. 기기 정보
console.log('\n=== D. 어느 기기가 올렸는지 ===');
reset();
localStorage.setItem('martialdex:a', '1');
await A.pushState(USER);
check('[D1] 올릴 때 기기 이름을 함께 남긴다', globalThis.__row?.device_name === '테스트 기기', globalThis.__row?.device_name);
check('[D2] 기기 식별자도 남긴다', typeof globalThis.__row?.device_id === 'string' && globalThis.__row.device_id.length > 0);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
