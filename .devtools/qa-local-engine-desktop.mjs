// 통합 로컬 AI 엔진 (electron/localEngine.cjs) — REAL Ollama on this computer, no Electron window.
// Checks: auto start (owned) → model load + RAM → chat answer (selfAi.cjs) → stop (process gone, RAM freed)
//         · a user-started Ollama is never killed · a crash leftover (pid file) is cleaned on the next init.
// Local only: no network except 127.0.0.1, no model download (SKIPs if qwen2.5:3b is not installed), no paid API.
// Run: node .devtools/qa-local-engine-desktop.mjs [userDataDir]
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-engine-'));
let pass = 0;
let fail = 0;
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ` :: ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
};
const up = async () => fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fresh = () => {
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}electron${path.sep}`)) delete require.cache[k];
  return require('../electron/localEngine.cjs');
};

if (await up()) {
  console.log('SKIP — an Ollama server is already running on 11434 (stop it to run the ownership checks).');
  process.exit(0);
}

// 1. auto start + load
let engine = fresh();
await engine.init(dir);
const bin = await engine.findBinary(true);
check('Ollama 실행 파일 탐색·검증 (--version)', !!bin, bin);
let t0 = Date.now();
const r = await engine.start();
if (r.code === 'MODEL_MISSING') {
  console.log('SKIP — qwen2.5:3b is not installed (this QA never downloads).');
  await engine.stop();
  process.exit(0);
}
check('시작 → 서버 자동 실행 + 모델 로딩', r.ok, { ...r, ms: Date.now() - t0 });
let s = await engine.status();
check('상태: running · MARTIALDEX 소유 · 외부 아님', s.phase === 'running' && s.owned && !s.external, { phase: s.phase, owned: s.owned, external: s.external });
check('모델 RAM 보고 (/api/ps)', !!s.loaded && s.loaded.sizeBytes > 1e9, s.loaded);
const pidRec = JSON.parse(fs.readFileSync(path.join(dir, 'local-engine.pid.json'), 'utf8'));
check('pid 파일 기록', Number.isInteger(pidRec.pid) && alive(pidRec.pid), pidRec);

// 2. answer through the same path features use (selfAi.cjs)
const selfAi = require('../electron/selfAi.cjs');
t0 = Date.now();
let first = 0;
const a = await selfAi.chat({ requestId: 'qa1', messages: [{ role: 'system', content: '한국어로 짧게 답하세요.' }, { role: 'user', content: '주짓수에서 암바는 어떤 기술인지 한 문장으로 설명해 주세요.' }], maxTokens: 120 }, () => {
  if (!first) first = Date.now() - t0;
});
check('로컬 응답 (qwen2.5:3b, 스트리밍)', a.ok && a.text.length > 5, { model: a.model, firstTokenMs: first, totalMs: a.ms, tokens: a.evalCount, tokPerSec: a.ok ? +(a.evalCount / ((a.ms - first) / 1000)).toFixed(1) : null, text: a.ok ? a.text.slice(0, 80) : a.message });
const j = await selfAi.chat({ requestId: 'qa2', json: true, messages: [{ role: 'system', content: 'JSON만 출력하세요.' }, { role: 'user', content: '{"techniques": [기술 이름 2개]} 형식으로 복싱 기본 펀치 2개를 출력하세요.' }], maxTokens: 80 });
let parsed = null;
try {
  parsed = JSON.parse(j.text);
} catch {
  parsed = null;
}
check('JSON 모드 응답 파싱', !!parsed && Array.isArray(parsed.techniques), j.ok ? j.text.slice(0, 120) : j.message);

// 3. stop → process gone, RAM freed
t0 = Date.now();
const st = await engine.stop();
check('종료 → MARTIALDEX가 띄운 서버 종료', st.ok && st.stoppedServer && !alive(pidRec.pid) && !(await up()), { ...st, ms: Date.now() - t0, alive: alive(pidRec.pid) });
check('종료 후 pid 파일 삭제', !fs.existsSync(path.join(dir, 'local-engine.pid.json')));
const runners = execFileSync('ps', ['-axo', 'pid,command']).toString().split('\n').filter((l) => /^\s*\d+\s+\S*ollama\s+(runner|serve)\b/.test(l)); // the executable itself, not a shell line mentioning it
check('남은 ollama runner/serve 프로세스 없음', runners.length === 0, runners);

// 4. a user-started Ollama is protected
const userProc = spawn(bin.path, ['serve'], { stdio: 'ignore', env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } });
for (let i = 0; i < 50 && !(await up()); i++) await sleep(200);
engine = fresh();
await engine.init(dir);
const r2 = await engine.start();
s = await engine.status();
check('사용자 Ollama: external 로 인식, 소유 아님', r2.ok && s.external && !s.owned, { phase: s.phase, external: s.external, owned: s.owned });
await engine.stop();
check('사용자 Ollama: 종료 눌러도 서버 유지', alive(userProc.pid) && (await up()));
const ps = await fetch('http://127.0.0.1:11434/api/ps').then((x) => x.json());
check('사용자 Ollama: MARTIALDEX가 올린 모델만 메모리 해제', !ps.models.some((m) => m.name.startsWith('qwen2.5:3b')), ps.models.map((m) => m.name));
userProc.kill('SIGTERM');
for (let i = 0; i < 50 && (await up()); i++) await sleep(200);

// 5. crash leftover → cleaned on the next init
engine = fresh();
await engine.init(dir);
await engine.start({ load: false });
const leftover = JSON.parse(fs.readFileSync(path.join(dir, 'local-engine.pid.json'), 'utf8')).pid;
// simulate a crash: forget the module without stop()
engine = fresh();
const c = await engine.init(dir);
await sleep(500);
check('비정상 종료로 남은 서버 → 다음 실행 때 정리', c.cleaned && !alive(leftover) && !(await up()), { ...c, alive: alive(leftover) });

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
