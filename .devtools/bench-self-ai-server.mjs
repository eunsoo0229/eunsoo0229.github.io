// Live measurement of the self-AI server on this Mac: the server (server/self-ai) in front of
// the user's real Ollama (qwen2.5:3b) and SearXNG — never stopped or reconfigured. Measures
// one request alone, two users at once with the model queue at 1 and at 2 parallel
// generations, search through the server, and the server process' memory.
// Writes data/audit/self-ai/server-bench.json.
// Run: node .devtools/bench-self-ai-server.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const auth = require(path.join(APP, 'server/self-ai/auth.cjs'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfai-bench-'));
const tokensFile = path.join(tmp, 'tokens.json');
const tA = auth.issue(tokensFile, 'user-a');
const tB = auth.issue(tokensFile, 'user-b');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SYSTEM = '너는 MARTIALDEX 코치다. 한국어 존댓말로 2~3문장 답한다. 자료에 없는 사실을 만들지 않는다.\n[MARTIALDEX 데이터]\n하이 싱글은 상대의 다리 허벅지 높은 위치를 잡아 서서 들어 올리는 싱글 레그 변형입니다. 핵심: 허벅지를 몸에 밀착시켜 놓치지 않기. 흔한 실수: 그립이 얕아 상대가 다리를 빼냄.';

async function start(parallel, port) {
  const child = spawn(process.execPath, [path.join(APP, 'server/self-ai/server.cjs')], { env: { ...process.env, SELF_AI_SERVER_PORT: String(port), SELF_AI_SERVER_TOKENS_FILE: tokensFile, SELF_AI_MAX_PARALLEL: String(parallel) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  for (let i = 0; i < 50 && !/self-AI server on/.test(out); i++) await sleep(100);
  return child;
}
function rss(pid) {
  try {
    return Math.round(Number(require('node:child_process').execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024);
  } catch {
    return null;
  }
}
async function chat(base, tok, id, question) {
  const t0 = Date.now();
  let first = null;
  let queued = null;
  const res = await fetch(`${base}/v1/chat`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: question }], maxTokens: 120, temperature: 0.3 }) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const e = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (e.type === 'queued') queued = e.position;
      if (e.type === 'delta' && first === null) first = Date.now() - t0;
      if (e.type === 'result') result = e.result;
    }
  }
  return { ms: Date.now() - t0, firstTokenMs: first, queued, ok: result?.ok ?? false, evalCount: result?.evalCount ?? 0, code: result?.code ?? null };
}

const report = { at: new Date().toISOString(), machine: `${os.cpus()[0].model} ×${os.cpus().length}, ${Math.round(os.totalmem() / 1e9)}GB`, runs: {} };
for (const parallel of [1, 2]) {
  const port = 18700 + parallel;
  const base = `http://127.0.0.1:${port}`;
  const child = await start(parallel, port);
  const warm = await chat(base, tA, `warm${parallel}`, '안녕하세요'); // model loaded / prompt cache
  const single = await chat(base, tA, `single${parallel}`, '하이 싱글의 핵심 포인트를 알려 주세요.');
  const t0 = Date.now();
  const [a, b] = await Promise.all([chat(base, tA, `pa${parallel}`, '하이 싱글의 흔한 실수는 무엇인가요?'), sleep(50).then(() => chat(base, tB, `pb${parallel}`, '하이 싱글을 어떻게 연습하나요?'))]);
  const both = Date.now() - t0;
  const s0 = Date.now();
  const search = await fetch(`${base}/v1/research/search`, { method: 'POST', headers: { authorization: `Bearer ${tA}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'single leg takedown wrestling tutorial', kind: 'video', maxResults: 6 }) }).then((r) => r.json());
  const searchMs = Date.now() - s0;
  report.runs[`parallel_${parallel}`] = { warm, single, twoUsers: { a, b, wallMs: both }, search: { ms: searchMs, ok: search.ok, results: search.results?.length ?? 0 }, serverRssMB: rss(child.pid) };
  console.log(`parallel=${parallel}`, JSON.stringify(report.runs[`parallel_${parallel}`]));
  child.kill();
  await sleep(500);
}
try {
  const ps = await fetch('http://127.0.0.1:11434/api/ps').then((r) => r.json());
  report.ollama = ps.models?.map((m) => ({ name: m.name, sizeGB: +(m.size / 1e9).toFixed(2) }));
} catch {
  report.ollama = null;
}
fs.writeFileSync(path.join(APP, 'data/audit/self-ai/server-bench.json'), JSON.stringify(report, null, 2));
console.log('saved data/audit/self-ai/server-bench.json', JSON.stringify(report.ollama));
