// gemini-ask Edge Function 의 실제 코드로 Gemini 사용 한도(0066) 검증. Deno.serve/env 만 흉내 내고,
// Supabase 는 로컬 테스트 백엔드(PGlite + 실제 RLS), Gemini API 는 가짜 응답(호출 수만 센다). 실제 Gemini 호출 없음.
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-gemini-quota-function.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeJwt, makeServiceJwt, startPgliteSupabase } from './lib/pglite-supabase.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
if (!process.env.PGLITE_DIR) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
const U = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;
const users = [
  { id: U(1), email: 'free@test.local', password: 'pw', nickname: '무료' },
  { id: U(2), email: 'pro@test.local', password: 'pw', nickname: '프로' },
  { id: U(3), email: 'free2@test.local', password: 'pw', nickname: '무료2' },
];
const [FREE, PRO, FREE2] = users;
const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54393, users, appDir: APP });
const svc = async (q, p) => { await sb.sql(`select set_config('request.jwt.claim.role', 'service_role', false)`); try { return await sb.sql(q, p); } finally { await sb.sql(`select set_config('request.jwt.claim.role', '', false)`); } };
// PRO 구독 (서버 결제 확정 경로)
await sb.sql(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)`, [PRO.id]);
const order = ((await sb.sql(`select * from public.create_subscription_order('pro', 'monthly')`)).rows ?? [])[0];
await sb.sql(`select set_config('request.jwt.claim.sub', '', false)`);
await svc(`select public.finalize_subscription_payment($1, 'paid', 'pk_pro_quota')`, [order.id]);

// ---- Deno shim + Gemini mock
const ENV = { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: 'local-anon', GEMINI_API_KEY: 'mock-key', SUPABASE_SERVICE_ROLE_KEY: makeServiceJwt() };
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
let geminiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    geminiCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '모의 답변' }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
};
const req = createRequire(path.join(APP, 'package.json'));
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemfn-')), 'g.mjs');
await build({ entryPoints: [path.join(APP, 'supabase/functions/gemini-ask/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{ name: 'npm', setup(b) { b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: req.resolve('@supabase/supabase-js') })); } }] });
await import(pathToFileURL(out).href);
const ask = async (user, useId) => {
  const body = { systemInstruction: '코치', contextText: '', history: [], question: '잽은 어떻게 해?', ...(useId ? { useId } : {}) };
  const r = await handler(new Request('http://fn/gemini-ask', { method: 'POST', headers: { Authorization: `Bearer ${makeJwt(user.id, user.email)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return r.json();
};

try {
  check('함수 코드 로드', typeof handler === 'function');
  const r1 = await ask(FREE, 'action-aaaaaaaa');
  check('무료 사용자 첫 요청 → Gemini 답변', r1.ok === true && geminiCalls === 1, r1);
  for (let i = 0; i < 6; i++) await ask(FREE, 'action-aaaaaaaa');
  check('같은 작업의 후속 호출 6번 → 모두 답변, 1회만 차감', geminiCalls === 7 && ((await sb.sql(`select count(*)::int n from public.gemini_usage where user_id = $1`, [FREE.id])).rows ?? [])[0].n === 1);
  for (const id of ['action-bbbbbbbb', 'action-cccccccc', 'action-dddddddd', 'action-eeeeeeee']) await ask(FREE, id);
  const before = geminiCalls;
  const r6 = await ask(FREE, 'action-ffffffff');
  check('6번째 작업 → QUOTA_EXCEEDED, Gemini 호출 안 함', r6.ok === false && r6.code === 'QUOTA_EXCEEDED' && geminiCalls === before && /5회/.test(r6.message), r6);
  const r6b = await ask(FREE, 'action-aaaaaaaa');
  check('이미 쓴 작업 id 재사용(묶음 안) → 계속 허용 (같은 작업 진행 중)', r6b.ok === true);
  for (let i = 0; i < 10; i++) await ask(FREE, 'action-aaaaaaaa');
  const r6c = await ask(FREE, 'action-aaaaaaaa');
  check('묶음 상한(15회) 넘기면 새 1회로 셈 → 한도라 거부 (id 재사용 우회 불가)', r6c.ok === false && r6c.code === 'QUOTA_EXCEEDED', r6c);
  // id 없는 오래된 앱: 호출마다 1회
  for (let i = 0; i < 5; i++) await ask(FREE2, null);
  const legacy = await ask(FREE2, null);
  check('useId 없는 요청은 호출마다 1회 → 6번째 거부', legacy.code === 'QUOTA_EXCEEDED');
  // PRO 무제한
  let proOk = true;
  for (let i = 0; i < 8; i++) proOk = proOk && (await ask(PRO, `pro-action-${i}000000`)).ok === true;
  check('PRO: 8개 작업 모두 답변 (무제한)', proOk);
  // 비로그인
  const anon = await (await handler(new Request('http://fn/gemini-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: '', contextText: '', history: [], question: 'x' }) }))).json();
  check('비로그인 → UNAUTHORIZED, Gemini 호출 없음', anon.code === 'UNAUTHORIZED');
  // 사용량 확인 실패 → Gemini 부르지 않음 (비용 보호)
  await sb.sql(`alter function public.consume_gemini_use(text) rename to consume_gemini_use_off`);
  const b2 = geminiCalls;
  const failClosed = await ask(PRO, 'pro-action-xx000000');
  check('사용량 확인 실패 시 Gemini 호출 안 함 (실패 시 닫힘)', failClosed.ok === false && geminiCalls === b2, failClosed);
  await sb.sql(`alter function public.consume_gemini_use_off(text) rename to consume_gemini_use`);
} catch (e) {
  check('실행 중 예외 없음', false, e.stack?.slice(0, 300));
} finally {
  await sb.close();
}
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
