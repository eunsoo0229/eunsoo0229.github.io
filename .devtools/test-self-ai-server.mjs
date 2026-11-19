// MARTIALDEX self-AI server (server/self-ai) + the client transport (src/lib/selfAi/transport.ts)
// — offline: fake Ollama, fake SearXNG and a fake llama.cpp server on local ports (the user's
// own Ollama / SearXNG are never contacted). Checks access control, per-user isolation, the
// model queue, cancel, outage + recovery, search with sources preserved, rate limits, CORS,
// body limits, binding, the alternative runner, token storage, logs, and the client side
// (a coach turn from a "phone/web" client through the server).
// Run: node .devtools/test-self-ai-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

// ---- fakes
let firstTokenDelay = 0;
let tokenDelay = 60;
const ollama = http.createServer(async (req, res) => {
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
  if (req.url === '/api/chat') {
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body);
    const words = ['싱글 ', '레그는 ', '한쪽 ', '다리를 ', '잡습니다.'];
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    await sleep(firstTokenDelay);
    for (const w of words) {
      if (res.destroyed) return;
      res.write(JSON.stringify({ message: { content: w }, done: false }) + '\n');
      await sleep(tokenDelay);
    }
    res.end(JSON.stringify({ message: { content: '' }, done: true, eval_count: words.length, model: j.model }) + '\n');
    return;
  }
  res.statusCode = 404;
  res.end();
});
const searx = http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ query: q, results: [
    { url: 'https://example.org/single-leg-guide', title: 'Single leg takedown guide', content: 'How to finish a single leg takedown in wrestling.', engine: 'bing', engines: ['bing'], score: 1 },
    { url: 'https://wrestling.example.com/high-single', title: 'High single wrestling', content: 'High single leg finish when the opponent sprawls.', engine: 'yahoo', engines: ['yahoo'], score: 0.8 },
  ], unresponsive_engines: [] }));
});
const llama = http.createServer(async (req, res) => {
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'qwen2.5-3b-instruct-q4_k_m.gguf' }] }));
  if (req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const w of ['로우 ', '싱글입니다.']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
      await sleep(30);
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  res.statusCode = 404;
  res.end();
});
let ollamaPort = await listen(ollama);
const searxPort = await listen(searx);
const llamaPort = await listen(llama);

// env BEFORE the server modules load (selfAi.cjs reads OLLAMA_HOST_URL at load)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfai-server-'));
const tokensFile = path.join(tmp, 'tokens.json');
process.env.OLLAMA_HOST_URL = `http://127.0.0.1:${ollamaPort}`;
process.env.SEARXNG_URL = `http://127.0.0.1:${searxPort}`;
process.env.SELF_AI_SERVER_TOKENS_FILE = tokensFile;
const auth = require(path.join(APP, 'server/self-ai/auth.cjs'));
const { createServer } = require(path.join(APP, 'server/self-ai/server.cjs'));
const { openAiCompatibleRunner } = require(path.join(APP, 'server/self-ai/runners.cjs'));
const tokA = auth.issue(tokensFile, 'alice', 'phone');
const tokB = auth.issue(tokensFile, 'bob', 'web');
const logs = [];
const fakeEntity = { resolvePerson: async (name) => ({ ok: true, query: name, en: 'Conor McGregor', source: 'https://ko.wikipedia.org/wiki/x' }) };
const env = { ...process.env, SELF_AI_MAX_WAITING: '1', SELF_AI_SEARCH_PER_MIN: '4' };
const { server } = createServer(env, { entity: fakeEntity, log: (l) => logs.push(l) });
const port = await listen(server);
const base = `http://127.0.0.1:${port}`;
const H = (tok) => ({ authorization: `Bearer ${tok}`, 'content-type': 'application/json' });

async function chat(tok, requestId, opts = {}) {
  const events = [];
  const res = await fetch(`${base}/v1/chat`, { method: 'POST', headers: H(tok), body: JSON.stringify({ requestId, messages: [{ role: 'user', content: '싱글 레그 설명해 줘' }], maxTokens: 64 }) });
  const text = await res.text();
  for (const l of text.split('\n').filter(Boolean)) events.push(JSON.parse(l));
  const result = events.find((e) => e.type === 'result')?.result;
  return { status: res.status, events, result, t: Date.now(), ...opts };
}

// ---- S1–S2 access
const health = await fetch(`${base}/v1/health`).then((r) => r.json());
check('[S1] /v1/health는 토큰 없이 응답, 비밀 정보 없음', health.ok && !JSON.stringify(health).includes('mdx_') && !('user' in health), health);
const noTok = await fetch(`${base}/v1/status`);
const badTok = await fetch(`${base}/v1/status`, { headers: H('mdx_wrongwrongwrongwrong') });
const okTok = await fetch(`${base}/v1/status`, { headers: H(tokA) }).then((r) => r.json());
check('[S2] 토큰 없음·틀린 토큰 → 401, 올바른 토큰 → 사용자 구분 + 모델·검색 상태', noTok.status === 401 && badTok.status === 401 && okTok.user === 'alice' && okTok.model.ok && okTok.search.ok, okTok);
const tokenFile = fs.readFileSync(tokensFile, 'utf8');
check('[S3] 토큰 파일에는 해시만 저장(토큰 원문 없음), 권한 600', !tokenFile.includes(tokA) && /tokenSha256/.test(tokenFile) && (fs.statSync(tokensFile).mode & 0o777) === 0o600, (fs.statSync(tokensFile).mode & 0o777).toString(8));

// ---- S4 streaming
const c1 = await chat(tokA, 'r1');
check('[S4] 대화 스트리밍: started → delta들 → result(ok, 전체 문장)', c1.status === 200 && c1.events[0].type === 'started' && c1.events.filter((e) => e.type === 'delta').length === 5 && c1.result?.ok && c1.result.text === '싱글 레그는 한쪽 다리를 잡습니다.', c1.events.map((e) => e.type));

// ---- S5–S7 queue / per-user
tokenDelay = 150;
const [qa, qb] = await Promise.all([chat(tokA, 'q1'), sleep(80).then(() => chat(tokB, 'q2'))]);
check('[S5] 두 사용자 동시 요청: 둘째는 대기열 1번 → 첫째 끝난 뒤 실행, 둘 다 완료', qa.result?.ok && qb.result?.ok && qb.events[0].type === 'queued' && qb.events[0].position === 1 && qb.events.some((e) => e.type === 'started'), [qa.events.map((e) => e.type), qb.events.map((e) => e.type)]);
const [s1, s2] = await Promise.all([chat(tokA, 'same1'), sleep(50).then(() => chat(tokA, 'same2'))]);
check('[S6] 같은 사용자의 동시 두 번째 요청 → BUSY(이전 답변 진행 중)', s1.result?.ok && s2.result?.code === 'BUSY', s2.result);
auth.issue(tokensFile, 'carol');
const tokC = auth.issue(tokensFile, 'carol');
const [f1, f2, f3] = await Promise.all([chat(tokA, 'f1'), sleep(40).then(() => chat(tokB, 'f2')), sleep(80).then(() => chat(tokC, 'f3'))]);
check('[S7] 대기열 가득(대기 1개 한도) → 셋째 사용자 BUSY, 앞의 둘은 완료', f1.result?.ok && f2.result?.ok && f3.result?.code === 'BUSY', [f1.result?.ok, f2.result?.ok, f3.result]);

// ---- S8 cancel isolation
tokenDelay = 400;
const pending = chat(tokA, 'cx');
await sleep(300);
const bobCancel = await fetch(`${base}/v1/chat/cancel`, { method: 'POST', headers: H(tokB), body: JSON.stringify({ requestId: 'cx' }) }).then((r) => r.json());
const aliceCancel = await fetch(`${base}/v1/chat/cancel`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ requestId: 'cx' }) }).then((r) => r.json());
const cancelled = await pending;
check('[S8] 다른 사용자는 취소 불가, 본인은 취소 → CANCELLED', bobCancel.ok === false && aliceCancel.ok === true && cancelled.result?.code === 'CANCELLED', [bobCancel, aliceCancel, cancelled.result]);
tokenDelay = 60;

// ---- S9 model reload wait (heartbeat before the first token)
firstTokenDelay = 5600;
const slow = await chat(tokA, 'slow');
firstTokenDelay = 0;
check('[S9] 첫 토큰이 늦으면(모델 로딩) 5초마다 waiting 알림, 이후 정상 답변', slow.events.some((e) => e.type === 'waiting' && e.seconds >= 5) && slow.result?.ok, slow.events.map((e) => e.type));

// ---- S10 outage + recovery
await new Promise((r) => ollama.close(r));
ollama.closeAllConnections?.();
const down = await chat(tokA, 'down');
const stDown = await fetch(`${base}/v1/status`, { headers: H(tokA) }).then((r) => r.json());
await new Promise((r) => ollama.listen(ollamaPort, '127.0.0.1', r));
const up = await chat(tokA, 'up');
check('[S10] 모델 실행기 꺼짐 → NOT_RUNNING(다른 모델 대체 없음), 상태 표시 · 다시 켜면 같은 서버로 정상', down.result?.code === 'NOT_RUNNING' && stDown.model.ok === false && up.result?.ok, [down.result, stDown.model, up.result?.ok]);

// ---- S11–S12 search (the real self-search pipeline against the fake SearXNG)
const sr = await fetch(`${base}/v1/research/search`, { method: 'POST', headers: H(tokB), body: JSON.stringify({ query: 'single leg takedown wrestling', kind: 'web', maxResults: 5, extractTop: 0 }) }).then((r) => r.json());
check('[S11] 검색: 같은 결과 형식(제목·원문 URL·출처·신뢰도·출처 유형), 원문 URL 보존', sr.ok && sr.results.length === 2 && sr.results.every((r) => /^https:\/\//.test(r.url) && r.source && r.reliability?.label && r.sourceType) && sr.results.some((r) => r.url === 'https://example.org/single-leg-guide'), sr);
const ent = await fetch(`${base}/v1/research/entity`, { method: 'POST', headers: H(tokB), body: JSON.stringify({ name: '코너 맥그리거' }) }).then((r) => r.json());
check('[S12] 이름 확인 경로', ent.ok && ent.en === 'Conor McGregor', ent);
const codes = [];
for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/v1/research/search`, { method: 'POST', headers: H(tokB), body: JSON.stringify({ query: 'x', kind: 'web', extractTop: 0 }) })).status);
const otherUser = (await fetch(`${base}/v1/research/search`, { method: 'POST', headers: H(tokC), body: JSON.stringify({ query: 'x', kind: 'web', extractTop: 0 }) })).status;
check('[S13] 검색 요청 한도(사용자별, 분당 4) 초과 → 429, 다른 사용자는 영향 없음', codes.includes(429) && otherUser === 200, [codes, otherUser]);

// ---- S14–S16 CORS / body / logs
const ok = await fetch(`${base}/v1/health`, { headers: { origin: 'http://localhost:5173' } });
const bad = await fetch(`${base}/v1/health`, { headers: { origin: 'https://evil.example' } });
const pre = await fetch(`${base}/v1/chat`, { method: 'OPTIONS', headers: { origin: 'https://localhost', 'access-control-request-method': 'POST' } });
check('[S14] CORS: 허용 출처만 응답 헤더(앱·Capacitor), 다른 출처 없음, 사전 요청 204', ok.headers.get('access-control-allow-origin') === 'http://localhost:5173' && !bad.headers.get('access-control-allow-origin') && pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://localhost');
const big = await fetch(`${base}/v1/research/search`, { method: 'POST', headers: H(tokC), body: JSON.stringify({ query: 'x'.repeat(300 * 1024) }) }).catch(() => ({ status: 'reset' }));
check('[S15] 256KB 넘는 요청 → 413(또는 연결 차단)', big.status === 413 || big.status === 'reset', big.status);
check('[S16] 로그: 사용자·경로·상태·시간만(질문 내용·토큰 없음)', logs.length > 10 && logs.every((l) => !/싱글|mdx_|single leg/i.test(l)) && logs.some((l) => / alice POST \/v1\/chat 200 /.test(l)), logs.slice(0, 3));

// ---- S17 alternative runner (llama.cpp server, OpenAI-compatible)
const lr = openAiCompatibleRunner(`http://127.0.0.1:${llamaPort}`, 'qwen2.5-3b-instruct');
const lst = await lr.status();
let ldeltas = '';
const lres = await lr.chat({ requestId: 'l1', messages: [{ role: 'user', content: 'x' }] }, (d) => (ldeltas += d));
check('[S17] 다른 실행기(llama.cpp 서버, OpenAI 호환)로도 같은 계약: 상태·스트리밍·결과', lst.ok && lres.ok && lres.text === '로우 싱글입니다.' && ldeltas === lres.text, [lst, lres]);
const lrDown = openAiCompatibleRunner('http://127.0.0.1:1', 'x');
check('[S18] 그 실행기가 꺼져 있으면 NOT_RUNNING', (await lrDown.chat({ requestId: 'l2', messages: [{ role: 'user', content: 'x' }] })).code === 'NOT_RUNNING');

// ---- S19 default binding (the CLI): 127.0.0.1 only
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const cliPort = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [path.join(APP, 'server/self-ai/server.cjs')], { env: { ...process.env, SELF_AI_SERVER_PORT: String(cliPort), SELF_AI_SERVER_HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 40 && !/self-AI server on/.test(out); i++) await sleep(100);
const local = await fetch(`http://127.0.0.1:${cliPort}/v1/health`).then((r) => r.status).catch(() => 0);
const viaLan = lan ? await fetch(`http://${lan}:${cliPort}/v1/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.status).catch(() => 0) : 0;
child.kill();
check('[S19] 기본 실행은 127.0.0.1만 수신(같은 컴퓨터), 외부 주소로는 접속 불가', local === 200 && viaLan === 0 && /127\.0\.0\.1/.test(out), { local, viaLan, lan, out: out.trim() });

// ---- S20+ the client side: a phone / web client through the server (transport.ts)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-'));
const entry = path.join(dir, 'e.ts');
const outFile = path.join(dir, 'r.mjs');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [`export * as T from ${mod('src/lib/selfAi/transport.ts')};`, `export { selfResearchProvider } from ${mod('src/lib/selfResearch/provider.ts')};`, `export { appCoachDeps } from ${mod('src/lib/selfAi/deps.ts')};`, `export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`].join('\n'));
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
const events = [];
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: (e) => { events.push(e.detail); return true; }, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = storage;
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: outFile, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const C = await import(pathToFileURL(outFile).href);
check('[S20] 서버 미연결 + 데스크톱 아님 → none(모델·검색 UNSUPPORTED)', C.T.selfAiBackend().kind === 'none' && (await C.selfResearchProvider.search({ query: 'x' })).code === 'UNSUPPORTED');
C.T.setServerConfig({ url: base, token: tokC });
const be = C.T.selfAiBackend();
let cd = '';
const cr = await be.chat({ requestId: 'web1', messages: [{ role: 'user', content: 'x' }] }, (d) => (cd += d));
check('[S21] 서버 연결 후 → server, 스트리밍 대화 결과', be.kind === 'server' && cr.ok && cd === cr.text, cr);
const ms = await be.modelStatus();
const rs = await C.selfResearchProvider.search({ query: 'high single wrestling', kind: 'web', extractTop: 0 });
check('[S22] 서버 경유 모델 상태·검색(출처 형식 동일)', ms?.ok && rs.ok && rs.results[0].url.startsWith('https://'), [ms, rs.ok]);
const deps = C.appCoachDeps();
const turn = await C.runCoachTurn({ text: '안녕하세요', history: [], martialArt: null, requestId: 'web2' }, deps);
check('[S23] 앱 코치 한 턴이 서버의 모델로 답변(웹·Android와 같은 코드 경로)', !!turn.message.text && turn.message.model === 'qwen2.5:3b', turn.message);
C.T.setServerConfig({ url: base, token: 'mdx_notavalidtokenxxxx' });
const unauth = await C.T.selfAiBackend().chat({ requestId: 'web3', messages: [{ role: 'user', content: 'x' }] });
check('[S24] 틀린 토큰 → UNAUTHORIZED 안내', unauth.code === 'UNAUTHORIZED' && /토큰/.test(unauth.message), unauth);
C.T.setServerConfig({ url: 'http://127.0.0.1:1', token: tokC });
const off = await C.T.selfAiBackend().chat({ requestId: 'web4', messages: [{ role: 'user', content: 'x' }] });
const offSearch = await C.selfResearchProvider.search({ query: 'zz', kind: 'web' });
check('[S25] 서버 꺼짐 → "연결할 수 없습니다"(모델·검색 모두, 다른 제공자 대체 없음)', off.code === 'NOT_RUNNING' && /연결할 수 없습니다/.test(off.message) && offSearch.code === 'NOT_RUNNING', [off, offSearch]);

server.close();
ollama.close();
searx.close();
llama.close();
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
