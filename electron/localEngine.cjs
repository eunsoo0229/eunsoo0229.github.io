// 통합 로컬 AI 엔진 (Mac · Windows) — MARTIALDEX starts, loads, unloads and stops the
// local Ollama server itself, so the user never opens a terminal. Main process only.
//
// Ownership is the core rule:
//   - a server MARTIALDEX spawned ("owned") is stopped by the in-app 종료 button and on quit;
//     its pid is written to userData so a crash leftover is cleaned up on the next launch;
//   - a server the user already runs ("external": Ollama.app, `ollama serve`, a service)
//     is never killed — MARTIALDEX only unloads the model it loaded itself.
// Nothing here runs at app start except the leftover check: the engine starts only when
// the user presses 시작 (or a feature the user started asks for it), and the model is
// downloaded only on an explicit 다운로드 click (sizes are shown first).
// The binary path is never hard-coded to one location: OLLAMA_BIN, PATH, then the
// standard install folders per OS, and each candidate is verified with `--version`.

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HOST = (process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const HOST_ADDR = (() => {
  try {
    const u = new URL(HOST);
    return `${u.hostname}:${u.port || '11434'}`;
  } catch {
    return '127.0.0.1:11434';
  }
})();
const MODEL_NAME = /^[\w.\-:/]{1,80}$/;

/** Models offered in the UI. qwen2.5:3b is the common model on every platform; the smaller ones are the user's choice only (never switched to automatically). Sizes = Ollama library download sizes (Q4_K_M). */
const MODELS = [
  { id: 'qwen2.5:3b', label: 'Qwen2.5 3B (기본 · 공통 모델)', downloadBytes: 1.9e9, minRamGb: 6 },
  { id: 'qwen2.5:1.5b', label: 'Qwen2.5 1.5B (가벼움 · 답변 품질 낮음)', downloadBytes: 0.99e9, minRamGb: 4 },
  { id: 'qwen2.5:0.5b', label: 'Qwen2.5 0.5B (매우 가벼움 · 간단한 답변만)', downloadBytes: 0.4e9, minRamGb: 3 },
];
const DEFAULT_MODEL = MODELS[0].id;
/** How long Ollama keeps the model in RAM after the last request while the engine is on. */
const KEEP_ALIVE = '30m';

let userDataDir = null;
/** { proc, pid, binary } while MARTIALDEX owns a running server. */
let owned = null;
/** state the UI shows: off · starting · running · loading · error */
let phase = 'off';
let lastError = null;
let starting = null; // in-flight start() promise
let modelLoadedByUs = null; // model name we loaded (unloaded again on stop/quit)
let pull = null; // { model, ctrl, completed, total, status }
const listeners = new Set();

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* window gone */
    }
  }
}
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function settingsPath() {
  return userDataDir ? path.join(userDataDir, 'local-engine-settings.json') : null;
}
function pidPath() {
  return userDataDir ? path.join(userDataDir, 'local-engine.pid.json') : null;
}

function readJson(p) {
  try {
    return p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch {
    return null;
  }
}
function writeJson(p, v) {
  if (!p) return;
  try {
    fs.writeFileSync(p, JSON.stringify(v));
  } catch {
    /* read-only / gone — ownership still held in memory */
  }
}
function removeFile(p) {
  try {
    if (p) fs.unlinkSync(p);
  } catch {
    /* already gone */
  }
}

/** Model chosen in the settings UI; OLLAMA_MODEL / SELF_AI_MODEL in .env still override (developer setting). */
function selectedModel() {
  const s = readJson(settingsPath());
  return s && typeof s.model === 'string' && MODEL_NAME.test(s.model) ? s.model : DEFAULT_MODEL;
}
function setModel(model) {
  if (!MODELS.some((m) => m.id === model)) return { ok: false, message: '지원하지 않는 모델입니다.' };
  writeJson(settingsPath(), { ...(readJson(settingsPath()) || {}), model });
  emit();
  return { ok: true };
}

// ---------------------------------------------------------------- binary discovery

function candidatePaths() {
  const out = [];
  const env = (process.env.OLLAMA_BIN || '').trim();
  if (env) out.push(env);
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) out.push(path.join(dir, exe));
  if (process.platform === 'darwin') {
    out.push('/Applications/Ollama.app/Contents/Resources/ollama', path.join(process.env.HOME || '', 'Applications/Ollama.app/Contents/Resources/ollama'), '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama');
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) out.push(path.join(local, 'Programs', 'Ollama', 'ollama.exe'));
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]) if (pf) out.push(path.join(pf, 'Ollama', 'ollama.exe'));
  } else {
    out.push('/usr/local/bin/ollama', '/usr/bin/ollama');
  }
  return [...new Set(out)];
}

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => resolve({ err, out: `${stdout || ''}${stderr || ''}` }));
  });
}

let binaryCache = null; // { path, version } | false
/** First candidate that exists and answers `--version` like Ollama. → { path, version } | null */
async function findBinary(force = false) {
  if (binaryCache !== null && !force) return binaryCache || null;
  for (const p of candidatePaths()) {
    try {
      if (!fs.statSync(p).isFile()) continue;
    } catch {
      continue;
    }
    const r = await run(p, ['--version'], 5000);
    const m = /version\s+(?:is\s+)?v?(\d+\.\d+\.\d+)/i.exec(r.out);
    if (m) {
      binaryCache = { path: p, version: m[1] };
      return binaryCache;
    }
  }
  binaryCache = false;
  return null;
}

// ---------------------------------------------------------------- server API

async function api(pathname, init = {}, timeoutMs = 2500) {
  const r = await fetch(`${HOST}${pathname}`, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: r.ok, status: r.status, json };
}

async function serverUp() {
  try {
    const r = await api('/api/version', {}, 1500);
    return r.ok && r.json && typeof r.json.version === 'string' ? r.json.version : null;
  } catch {
    return null;
  }
}

async function installedModels() {
  try {
    const r = await api('/api/tags');
    return r.ok && r.json && Array.isArray(r.json.models) ? r.json.models.map((m) => m && m.name).filter((n) => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** Models currently in RAM (Ollama /api/ps): [{ name, sizeBytes, vramBytes, expiresAt }] */
async function loadedModels() {
  try {
    const r = await api('/api/ps');
    return r.ok && r.json && Array.isArray(r.json.models)
      ? r.json.models.map((m) => ({ name: m.name, sizeBytes: Number(m.size) || 0, vramBytes: Number(m.size_vram) || 0, expiresAt: m.expires_at || null }))
      : [];
  } catch {
    return [];
  }
}

function sameModel(a, b) {
  const norm = (x) => (x.includes(':') ? x : `${x}:latest`);
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------- process ownership

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

/** Is `pid` an Ollama process? (guards against pid reuse before killing a leftover) */
async function isOllamaPid(pid) {
  if (process.platform === 'win32') {
    const r = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 5000);
    return /ollama/i.test(r.out);
  }
  const r = await run('ps', ['-p', String(pid), '-o', 'command='], 5000);
  return /ollama/i.test(r.out) && /\bserve\b/.test(r.out);
}

async function killTree(pid) {
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'], 8000);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM'); // ollama serve stops its runner children on SIGTERM
  } catch {
    return;
  }
  for (let i = 0; i < 30 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}

/** On launch: a server MARTIALDEX spawned before a crash (pid file still there) is stopped. External servers have no pid file. */
async function cleanupLeftover() {
  const rec = readJson(pidPath());
  if (!rec || !Number.isInteger(rec.pid)) return { cleaned: false };
  removeFile(pidPath());
  if (!alive(rec.pid) || !(await isOllamaPid(rec.pid))) return { cleaned: false };
  await killTree(rec.pid);
  return { cleaned: true, pid: rec.pid };
}

// ---------------------------------------------------------------- lifecycle

async function waitForServer(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await serverUp()) return true;
    if (owned && owned.proc.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function fail(code, message) {
  phase = 'error';
  lastError = { code, message };
  emit();
  return { ok: false, code, message };
}

/** Load `model` into RAM (keeps it for KEEP_ALIVE). */
async function loadModel(model) {
  phase = 'loading';
  emit();
  try {
    const r = await api('/api/generate', { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: KEEP_ALIVE, stream: false }) }, 300000);
    if (!r.ok) return fail('LOAD_FAILED', `모델을 메모리에 올리지 못했습니다 (${(r.json && r.json.error) || `HTTP ${r.status}`}).`);
  } catch (e) {
    return fail('LOAD_FAILED', e && e.name === 'TimeoutError' ? '모델 로딩이 5분 안에 끝나지 않았습니다.' : '모델 로딩 중 연결이 끊어졌습니다.');
  }
  modelLoadedByUs = model;
  phase = 'running';
  lastError = null;
  emit();
  return { ok: true };
}

/**
 * 시작: make sure a server is up (spawning one MARTIALDEX owns if none is), check the model,
 * and load it. Never downloads — MODEL_MISSING is returned so the UI can show the size first.
 */
async function start(opts = {}) {
  if (starting) return starting;
  starting = (async () => {
    phase = 'starting';
    lastError = null;
    emit();
    if (!(await serverUp())) {
      const bin = await findBinary(true);
      if (!bin) return fail('NOT_INSTALLED', 'Ollama가 이 컴퓨터에 설치되어 있지 않습니다. ollama.com에서 설치한 뒤 다시 시작을 눌러 주세요.');
      let proc;
      try {
        proc = spawn(bin.path, ['serve'], {
          env: { ...process.env, OLLAMA_HOST: HOST_ADDR },
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
          detached: false,
        });
      } catch {
        return fail('SPAWN_FAILED', 'Ollama를 실행하지 못했습니다.');
      }
      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr = (stderr + d).slice(-4000);
      });
      proc.on('error', () => {});
      proc.on('exit', () => {
        if (owned && owned.proc === proc) {
          owned = null;
          removeFile(pidPath());
          modelLoadedByUs = null;
          if (phase !== 'off') {
            phase = 'error';
            lastError = { code: 'EXITED', message: 'MARTIALDEX가 실행한 Ollama가 종료되었습니다.' };
          }
          emit();
        }
      });
      owned = { proc, pid: proc.pid, binary: bin.path };
      writeJson(pidPath(), { pid: proc.pid, binary: bin.path, startedAt: new Date().toISOString() });
      if (!(await waitForServer(20000))) {
        const portBusy = /address already in use|bind/i.test(stderr);
        await stop();
        return fail('SPAWN_FAILED', portBusy ? `포트 ${HOST_ADDR}를 다른 프로그램이 사용 중이라 Ollama를 시작하지 못했습니다.` : 'Ollama 서버가 20초 안에 응답하지 않았습니다.');
      }
    }
    const model = opts.model && MODEL_NAME.test(opts.model) ? opts.model : selectedModel();
    const models = await installedModels();
    if (!models.some((m) => sameModel(m, model))) {
      phase = 'running';
      emit();
      return { ok: false, code: 'MODEL_MISSING', message: `모델 ${model}이(가) 아직 설치되지 않았습니다.`, model };
    }
    if (opts.load === false) {
      phase = 'running';
      emit();
      return { ok: true };
    }
    return loadModel(model);
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** 종료: unload the model MARTIALDEX loaded; stop the server only if MARTIALDEX started it. */
async function stop() {
  cancelPull();
  const model = modelLoadedByUs;
  modelLoadedByUs = null;
  if (model && (await serverUp())) {
    try {
      await api('/api/generate', { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }, 10000);
    } catch {
      /* server already going away */
    }
  }
  const o = owned;
  owned = null;
  if (o) {
    await killTree(o.pid);
    removeFile(pidPath());
  }
  phase = 'off';
  lastError = null;
  emit();
  return { ok: true, stoppedServer: !!o };
}

/** Anything to clean up on quit (an owned server, or a model MARTIALDEX loaded into a user's own server)? */
function needsCleanup() {
  return !!owned || !!modelLoadedByUs || !!pull;
}

/** Synchronous best-effort stop for process exit (will-quit cannot await). */
function stopSync() {
  const o = owned;
  owned = null;
  if (!o) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(o.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(o.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  removeFile(pidPath());
}

// ---------------------------------------------------------------- model download

/** Explicit 다운로드 only. Streams progress to onProgress({ status, completed, total }). */
async function pullModel(model, onProgress) {
  if (!MODELS.some((m) => m.id === model)) return { ok: false, code: 'BAD_MODEL', message: '지원하지 않는 모델입니다.' };
  if (pull) return { ok: false, code: 'BUSY', message: '이미 다른 모델을 다운로드하고 있습니다.' };
  if (!(await serverUp())) {
    const r = await start({ model, load: false });
    if (!r.ok && r.code !== 'MODEL_MISSING') return r;
  }
  const ctrl = new AbortController();
  pull = { model, ctrl, completed: 0, total: 0, status: 'starting' };
  emit();
  try {
    const res = await fetch(`${HOST}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }), signal: ctrl.signal });
    if (!res.ok || !res.body) return { ok: false, code: 'PULL_FAILED', message: `다운로드를 시작하지 못했습니다 (HTTP ${res.status}).` };
    const decoder = new TextDecoder();
    let buf = '';
    let lastSent = 0;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.error) return { ok: false, code: 'PULL_FAILED', message: `다운로드 실패: ${j.error}` };
        pull.status = String(j.status || '');
        if (Number(j.total) > 0) {
          pull.total = Number(j.total);
          pull.completed = Number(j.completed) || 0;
        }
        const now = Date.now();
        if (onProgress && now - lastSent > 250) {
          lastSent = now;
          onProgress({ model, status: pull.status, completed: pull.completed, total: pull.total });
        }
        if (j.status === 'success') {
          if (onProgress) onProgress({ model, status: 'success', completed: pull.total, total: pull.total });
          return { ok: true };
        }
      }
    }
    return { ok: false, code: 'PULL_FAILED', message: '다운로드가 끝나기 전에 연결이 끊어졌습니다. 다시 누르면 이어서 받습니다.' };
  } catch {
    return ctrl.signal.aborted ? { ok: false, code: 'CANCELLED', message: '다운로드를 취소했습니다. 다시 누르면 이어서 받습니다.' } : { ok: false, code: 'PULL_FAILED', message: '다운로드 중 연결이 끊어졌습니다.' };
  } finally {
    pull = null;
    emit();
  }
}

function cancelPull() {
  if (!pull) return false;
  pull.ctrl.abort();
  return true;
}

// ---------------------------------------------------------------- status

async function status() {
  const model = selectedModel();
  const version = await serverUp();
  const base = {
    platform: process.platform,
    phase,
    error: lastError,
    model,
    models: MODELS,
    owned: !!owned,
    external: !!version && !owned,
    serverVersion: version,
    binary: null,
    installed: [],
    modelInstalled: false,
    loaded: null,
    pull: pull ? { model: pull.model, status: pull.status, completed: pull.completed, total: pull.total } : null,
    keepAlive: KEEP_ALIVE,
  };
  if (!version) {
    const bin = await findBinary();
    return { ...base, phase: phase === 'starting' || phase === 'error' ? phase : 'off', binary: bin ? bin.path : null, binaryVersion: bin ? bin.version : null };
  }
  const [installed, loaded] = await Promise.all([installedModels(), loadedModels()]);
  const mine = loaded.find((m) => sameModel(m.name, model)) || null;
  let shown = phase;
  // a server that is up with our model in RAM is "running" even when this launch didn't load it (external Ollama)
  if (phase === 'off' && mine) shown = 'running';
  if (phase === 'running' && !mine && !starting) shown = 'idle'; // server up, model unloaded (keep-alive expired)
  return { ...base, phase: shown, installed, modelInstalled: installed.some((m) => sameModel(m, model)), loaded: mine, binary: owned ? owned.binary : null };
}

/** Called once from main.cjs after app ready. */
function init(dir) {
  userDataDir = dir;
  return cleanupLeftover().catch(() => ({ cleaned: false }));
}

module.exports = { init, status, start, stop, stopSync, needsCleanup, pullModel, cancelPull, setModel, selectedModel, onChange, findBinary, candidatePaths, MODELS, DEFAULT_MODEL, KEEP_ALIVE, HOST };
