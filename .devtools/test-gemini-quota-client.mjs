// 앱 쪽 Gemini 사용 묶음·Mac(Electron) 관문 검증 — src/lib/ai/provider.ts 를 그대로 번들, Supabase·fetch·시간은 가짜.
//   node .devtools/test-gemini-quota-client.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemcl-'));
fs.writeFileSync(path.join(dir, 'fakeClient.ts'), `
const st = (globalThis.__fake = globalThis.__fake || { session: null, rpc: [], allow: () => ({ allowed: true }) });
export const supabase = {
  auth: { getSession: async () => ({ data: { session: st.session } }) },
  rpc: async (fn, args) => { st.rpc.push([fn, args]); return { data: st.allow(args), error: null }; },
};`);
const entry = path.join(dir, 'e.ts');
fs.writeFileSync(entry, `export { aiProvider, GEMINI_QUOTA_EVENT } from ${JSON.stringify(path.join(APP, 'src/lib/ai/provider.ts'))};`);
const out = path.join(dir, 'o.mjs');
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
let events = 0;
globalThis.window = { localStorage: storage, dispatchEvent: () => { events++; return true; }, addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/' } };
globalThis.localStorage = storage;
globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }) },
  plugins: [viteGlobPlugin, { name: 'fake', setup(b) { b.onResolve({ filter: /supabase\/client$/ }, () => ({ path: path.join(dir, 'fakeClient.ts') })); } }] });
const M = await import(pathToFileURL(out).href);
const F = globalThis.__fake;
let now = 1_800_000_000_000;
Date.now = () => now;
const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(F.edgeReply ?? { ok: true, text: '답' })); };
const ask = () => M.aiProvider.ask({ engine: 'gemini', systemInstruction: '', contextText: '', history: [], question: 'q' });

// ---------- Android/웹 경로 (서버 함수) ----------
F.session = { access_token: 'tok' };
await ask(); now += 5_000; await ask(); now += 20_000; await ask();
check('한 작업 안의 연속 호출(5초·20초 간격) → 같은 useId', sent.length === 3 && new Set(sent.map((b) => b.useId)).size === 1, sent.map((b) => b.useId));
now += 100_000;
await ask();
check('90초 넘게 쉬고 다시 → 새 useId (새 1회)', sent[3].useId !== sent[0].useId);
for (let i = 0; i < 14; i++) { now += 1000; await ask(); }
check('한 묶음 14호출 넘으면 새 useId (서버 상한 15 안에서)', new Set(sent.slice(3).map((b) => b.useId)).size === 2);
check('useId 형식: 서버가 받는 영문·숫자 8~48자', sent.every((b) => /^[A-Za-z0-9_-]{8,48}$/.test(b.useId)));
F.edgeReply = { ok: false, code: 'QUOTA_EXCEEDED', message: '오늘 Gemini 코치 무료 사용 5회를 모두 썼습니다.' };
const q = await ask();
check('서버의 한도 초과 응답을 그대로 전달 (QUOTA_EXCEEDED)', q.ok === false && q.code === 'QUOTA_EXCEEDED');
check('호출마다 한도 갱신 이벤트', events >= sent.length);
const nSent = sent.length;
await M.aiProvider.ask({ engine: 'local', systemInstruction: '', contextText: '', history: [], question: 'q' });
check('로컬 엔진 선택 시에는 한도·서버 호출 없음', sent.length === nSent);

// ---------- Mac(Electron) 경로 ----------
let electronCalls = 0;
window.martialdex = { askAi: async () => { electronCalls++; return { ok: true, text: '기기 키 답' }; } };
F.session = null;
F.rpc = [];
now += 200_000;
const guest = [];
for (let i = 0; i < 6; i++) { now += 120_000; guest.push(await ask()); }
check('Mac·로그인 전: 이 기기에서 하루 5작업, 6번째 거부', guest.slice(0, 5).every((r) => r.ok) && guest[5].code === 'QUOTA_EXCEEDED' && electronCalls === 5 && F.rpc.length === 0);
F.session = { access_token: 'tok' };
F.allow = () => ({ allowed: false, reason: 'QUOTA_EXCEEDED', limit: 5 });
now += 120_000;
const blocked = await ask();
check('Mac·로그인: 서버 카운터(consume_gemini_use)로 판정 → 거부 시 기기 키로 호출 안 함', blocked.code === 'QUOTA_EXCEEDED' && electronCalls === 5 && F.rpc[0][0] === 'consume_gemini_use');
F.allow = () => ({ allowed: true });
const okMac = await ask();
check('Mac·로그인: 허용되면 기기 키로 답변', okMac.ok === true && electronCalls === 6);
F.allow = (a) => (a.p_use_id.includes('-') ? { allowed: true } : { allowed: false, reason: 'USE_EXPIRED' });
now += 120_000;
const exp = await ask();
check('Mac·로그인: 묶음 만료 응답이면 새 id 로 다시 확인 후 진행', exp.ok === true && F.rpc.at(-1)[1].p_use_id.includes('-'));

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
