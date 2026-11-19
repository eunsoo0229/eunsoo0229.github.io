// 자체 검색 ON/OFF (electron/selfSearch/service.cjs) — REAL SearXNG runtime on this computer
// (~/.martialdex-ai, services/searxng/run.sh layout), no Electron window, no search queries sent
// (only /healthz), no paid API: every fetch is recorded and any Tavily host fails the run.
// Checks: default OFF · OFF → DISABLED everywhere, no Tavily even with a key · ON starts and owns
// SearXNG · OFF stops it · choice persists · a user-started SearXNG is never stopped · crash leftover
// cleaned on next init. Run: node .devtools/qa-self-search-switch.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-selfsearch-'));
let pass = 0;
let fail = 0;
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ` :: ${JSON.stringify(info).slice(0, 300)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;
const hosts = [];
globalThis.fetch = (url, init) => {
  hosts.push(new URL(String(url)).host);
  return realFetch(url, init);
};
const up = async () => realFetch('http://127.0.0.1:8888/healthz', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const fresh = () => {
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}electron${path.sep}`)) delete require.cache[k];
  return { svc: require('../electron/selfSearch/service.cjs'), web: require('../electron/webSearch.cjs') };
};

if (await up()) {
  console.log('SKIP — a SearXNG already answers on :8888 (stop it to run the ownership checks).');
  process.exit(0);
}
process.env.TAVILY_API_KEY = 'qa-fake-key-never-used';
delete process.env.MARTIALDEX_SEARCH_BACKEND;

let { svc, web } = fresh();
await svc.init(dir);
let s = await svc.status();
check('기본값 OFF · 아무것도 시작하지 않음', !s.enabled && s.phase === 'off' && !(await up()), s);
check('OFF → 검색 요청은 DISABLED', svc.offOutcome()?.code === 'DISABLED');
const w = await web.webSearch('jab boxing');
check('OFF → 웹 검색도 실패로 보고 (Tavily 키가 있어도 사용 안 함)', !w.ok && /꺼져/.test(w.message) && !hosts.some((h) => /tavily/i.test(h)), { w, hosts });

let t0 = Date.now();
const on = await svc.setEnabled(true);
s = await svc.status();
check('ON → SearXNG 실행 (MARTIALDEX 소유)', on.ok && s.running && s.owned && !s.external, { on, ms: Date.now() - t0, phase: s.phase });
const pid = JSON.parse(fs.readFileSync(path.join(dir, 'self-search.pid.json'), 'utf8')).pid;
check('pid 파일 기록', Number.isInteger(pid) && alive(pid), pid);
check('ON → offOutcome 없음 (검색 허용)', svc.offOutcome() === null);

const off = await svc.setEnabled(false);
await sleep(500);
check('OFF → MARTIALDEX가 띄운 서버 종료', off.ok && off.stoppedServer && !alive(pid) && !(await up()), { off, alive: alive(pid) });
check('OFF 상태 저장 (재시작 후에도 OFF)', (() => {
  ({ svc, web } = fresh());
  return true;
})() && (await svc.init(dir), !svc.enabled()));

// ON persisted → restored on the next launch (after the 3 s startup delay)
await svc.setEnabled(true);
await svc.setEnabled(false).then(() => svc.setEnabled(true));
const pid2 = JSON.parse(fs.readFileSync(path.join(dir, 'self-search.pid.json'), 'utf8')).pid;
await svc.stopOwned();
({ svc, web } = fresh());
await svc.init(dir);
let restored = false;
for (let i = 0; i < 60 && !restored; i++) {
  await sleep(500);
  restored = (await svc.status()).running;
}
check('ON 저장 → 다음 실행 때 자동으로 다시 켬', restored && svc.enabled(), { pid2 });
const wDown = await (async () => {
  const pidNow = JSON.parse(fs.readFileSync(path.join(dir, 'self-search.pid.json'), 'utf8')).pid;
  process.kill(pidNow, 'SIGTERM'); // the server dies while the switch stays ON
  for (let i = 0; i < 30 && (await up()); i++) await sleep(200);
  return web.webSearch('jab boxing');
})();
check('ON인데 서버가 죽음 → 실패 보고, Tavily로 넘어가지 않음', !wDown.ok && !hosts.some((h) => /tavily/i.test(h)), wDown);
await svc.setEnabled(false);

// a user-started SearXNG is never stopped
const rt = path.join(os.homedir(), '.martialdex-ai');
const secret = fs.readFileSync(path.join(rt, 'searxng.secret'), 'utf8').trim();
const userProc = spawn(path.join(rt, 'venv-searxng/bin/python'), ['-m', 'searx.webapp'], { cwd: path.join(rt, 'searxng-src'), stdio: 'ignore', env: { ...process.env, SEARXNG_SECRET: secret, SEARXNG_SETTINGS_PATH: path.resolve('services/searxng/settings.yml') } });
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
({ svc, web } = fresh());
await svc.init(dir);
await svc.setEnabled(true);
s = await svc.status();
check('사용자 SearXNG: external 로 인식', s.running && s.external && !s.owned, s);
await svc.setEnabled(false);
check('사용자 SearXNG: OFF 해도 서버 유지 (앱은 검색만 중단)', alive(userProc.pid) && (await up()) && svc.offOutcome()?.code === 'DISABLED');
userProc.kill('SIGTERM');
for (let i = 0; i < 30 && (await up()); i++) await sleep(200);

// crash leftover
({ svc, web } = fresh());
await svc.init(dir);
await svc.setEnabled(true);
const leftover = JSON.parse(fs.readFileSync(path.join(dir, 'self-search.pid.json'), 'utf8')).pid;
({ svc, web } = fresh()); // crash: module forgotten without stopping
fs.writeFileSync(path.join(dir, 'self-search-settings.json'), JSON.stringify({ enabled: false }));
const c = await svc.init(dir).then(() => sleep(500)).then(() => ({ alive: alive(leftover) }));
check('비정상 종료로 남은 SearXNG → 다음 실행 때 정리', !c.alive && !(await up()), { leftover, ...c });
check('Tavily 호출 0회 (전체 실행)', !hosts.some((h) => /tavily/i.test(h)), [...new Set(hosts)]);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
