// 자체 검색 ON/OFF (Mac · Windows) — the user's switch for the self-hosted SearXNG that
// MARTIALDEX's research pipeline uses. Main process only. Same ownership rules as the
// local AI engine (electron/localEngine.cjs):
//   - ON  : persists the choice and starts SearXNG from the local runtime (~/.martialdex-ai,
//           see services/searxng/run.sh) unless one already answers — that one is "external";
//   - OFF : persists the choice and stops ONLY a SearXNG MARTIALDEX started; a user-started
//           one keeps running, the app just stops sending searches to it;
//   - the choice survives restarts (userData/self-search-settings.json); a crash leftover the
//     app started is stopped on the next launch (pid file).
// While OFF nothing is searched at all — no SearXNG, no Wikipedia lookup, and no Tavily or
// Gemini in its place. Local AI chat and the in-app technique DB do not depend on this.

const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { status: probe } = require('./searxng.cjs');

let userDataDir = null;
/** { proc, pid } while MARTIALDEX owns a running SearXNG. */
let owned = null;
let phase = 'off'; // off · starting · running · error
let lastError = null;
let starting = null;
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

const settingsPath = () => (userDataDir ? path.join(userDataDir, 'self-search-settings.json') : null);
const pidPath = () => (userDataDir ? path.join(userDataDir, 'self-search.pid.json') : null);

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
    /* unwritable — the in-memory state still applies */
  }
}
function removeFile(p) {
  try {
    if (p) fs.unlinkSync(p);
  } catch {
    /* already gone */
  }
}

/** The user's switch. Default OFF: nothing is started or searched until the user turns it on. */
function enabled() {
  const s = readJson(settingsPath());
  return !!(s && s.enabled === true);
}

// ---------------------------------------------------------------- runtime (services/searxng/run.sh layout)

function runtime() {
  const home = (process.env.MARTIALDEX_AI_HOME || '').trim() || path.join(os.homedir(), '.martialdex-ai');
  const python = process.platform === 'win32' ? path.join(home, 'venv-searxng', 'Scripts', 'python.exe') : path.join(home, 'venv-searxng', 'bin', 'python');
  const src = path.join(home, 'searxng-src');
  // dev: <repo>/services/searxng/settings.yml · packaged: next to the app resources when shipped
  const settings = [path.join(__dirname, '..', '..', 'services', 'searxng', 'settings.yml'), path.join(process.resourcesPath || '', 'services', 'searxng', 'settings.yml')].find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  const exists = (p) => {
    try {
      return fs.statSync(p).isFile() || fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const missing = [!exists(python) && 'Python 가상환경(venv-searxng)', !exists(src) && 'SearXNG 소스(searxng-src)', !settings && '검색 설정 파일(settings.yml)'].filter(Boolean);
  return { home, python, src, settings, missing };
}

/** run.sh keeps the secret in <home>/searxng.secret — same file, created the same way when absent. */
function secret(home) {
  const f = path.join(home, 'searxng.secret');
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(f, `${s}\n`, { mode: 0o600 });
    } catch {
      /* read-only home — still usable for this run */
    }
    return s;
  }
}

// ---------------------------------------------------------------- process ownership (as in localEngine.cjs)

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => resolve({ err, out: `${stdout || ''}${stderr || ''}` }));
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

/** Is `pid` a SearXNG webapp? (guards against pid reuse before stopping a leftover) */
async function isSearxPid(pid) {
  if (process.platform === 'win32') {
    // SearXNG runs as python.exe, so the COMMAND LINE decides. wmic is gone from recent Windows 11 builds: fall back to
    // PowerShell's CIM query. Neither answering → false (the leftover is left alone — never a blind kill).
    const r = await run('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'], 5000);
    if (!r.err && /CommandLine/i.test(r.out)) return /searx\.webapp/.test(r.out);
    const ps = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], 8000);
    return !ps.err && /searx\.webapp/.test(ps.out);
  }
  const r = await run('ps', ['-p', String(pid), '-o', 'command='], 5000);
  return /searx\.webapp/.test(r.out);
}

async function killTree(pid) {
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'], 8000);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
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

async function cleanupLeftover() {
  const rec = readJson(pidPath());
  if (!rec || !Number.isInteger(rec.pid)) return { cleaned: false };
  removeFile(pidPath());
  if (!alive(rec.pid) || !(await isSearxPid(rec.pid))) return { cleaned: false };
  await killTree(rec.pid);
  return { cleaned: true, pid: rec.pid };
}

// ---------------------------------------------------------------- lifecycle

function fail(code, message) {
  phase = 'error';
  lastError = { code, message };
  emit();
  return { ok: false, code, message };
}

async function start() {
  if (starting) return starting;
  starting = (async () => {
    phase = 'starting';
    lastError = null;
    emit();
    if ((await probe()).ok) {
      phase = 'running';
      emit();
      return { ok: true, external: !owned };
    }
    const rt = runtime();
    if (rt.missing.length) return fail('NOT_INSTALLED', `자체 검색 실행 환경이 이 컴퓨터에 없습니다: ${rt.missing.join(', ')} (${rt.home}). 설치 방법은 docs/self-ai 문서를 참고해 주세요.`);
    let proc;
    try {
      proc = spawn(rt.python, ['-m', 'searx.webapp'], {
        cwd: rt.src,
        env: { ...process.env, SEARXNG_SECRET: secret(rt.home), SEARXNG_SETTINGS_PATH: rt.settings },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        detached: false,
      });
    } catch {
      return fail('SPAWN_FAILED', '자체 검색 서버(SearXNG)를 실행하지 못했습니다.');
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
        if (phase !== 'off') {
          phase = 'error';
          lastError = { code: 'EXITED', message: 'MARTIALDEX가 실행한 자체 검색 서버가 종료되었습니다.' };
        }
        emit();
      }
    });
    owned = { proc, pid: proc.pid };
    writeJson(pidPath(), { pid: proc.pid, startedAt: new Date().toISOString() });
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if ((await probe()).ok) {
        phase = 'running';
        emit();
        return { ok: true, external: false };
      }
      if (proc.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const portBusy = /address already in use/i.test(stderr);
    await stopOwned();
    return fail('SPAWN_FAILED', portBusy ? '검색 서버 포트(8888)를 다른 프로그램이 사용 중입니다.' : '자체 검색 서버가 30초 안에 응답하지 않았습니다.');
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function stopOwned() {
  const o = owned;
  owned = null;
  if (o) {
    await killTree(o.pid);
    removeFile(pidPath());
  }
  return !!o;
}

/** The switch. ON starts (or adopts) SearXNG; OFF stops only the one MARTIALDEX started. */
async function setEnabled(on) {
  writeJson(settingsPath(), { ...(readJson(settingsPath()) || {}), enabled: !!on });
  if (on) return start();
  const stopped = await stopOwned();
  phase = 'off';
  lastError = null;
  emit();
  return { ok: true, stoppedServer: stopped };
}

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

async function status() {
  const on = enabled();
  const up = (await probe()).ok;
  const rt = runtime();
  let shown = phase;
  if (!on) shown = 'off';
  else if (phase !== 'starting') shown = up ? 'running' : phase === 'error' ? 'error' : 'stopped';
  return {
    supported: true,
    enabled: on,
    phase: shown,
    running: up,
    owned: !!owned,
    // a SearXNG answers but MARTIALDEX did not start it (the user's own) — never stopped by the app
    external: up && !owned,
    installed: rt.missing.length === 0,
    missing: rt.missing,
    error: lastError,
  };
}

/** Called once after app ready: clean a crash leftover, then honour a persisted ON (in the background). */
async function init(dir) {
  userDataDir = dir;
  await cleanupLeftover().catch(() => null);
  if (enabled()) setTimeout(() => void start(), 3000); // after the window is up, never blocking startup
}

function needsCleanup() {
  return !!owned;
}

/** For the search paths: null when searching is allowed, else the failure every caller returns as-is. */
function offOutcome() {
  return enabled() ? null : { ok: false, code: 'DISABLED', message: '자체 검색이 꺼져 있습니다. 설정 > AI 엔진에서 켤 수 있습니다.' };
}

module.exports = { init, status, setEnabled, start, stopOwned, stopSync, needsCleanup, enabled, offOutcome, onChange };
