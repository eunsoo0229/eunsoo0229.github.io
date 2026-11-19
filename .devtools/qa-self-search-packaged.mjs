// 자체 검색 ON/OFF — in the PACKAGED Mac app (electron-builder --dir output), hidden + muted (MARTIALDEX_HEADLESS=1).
// Checks: settings.yml is found inside the app (services/searxng), the runtime from ~/.martialdex-ai is used, ON starts
// an app-owned SearXNG, one real search answers, OFF stops it, quit with ON cleans up, the choice persists.
// Gemini / Tavily / Supabase hosts are blocked in the main process. Nothing signs in.
// Requires nothing on :8888. Run: PKG_APP=<path to MARTIALDEX.app> node .devtools/qa-self-search-packaged.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.PKG_APP;
if (!APP || !fs.existsSync(APP)) {
  console.log('SKIP — PKG_APP (packaged MARTIALDEX.app) not given');
  process.exit(0);
}
let pass = 0;
let fail = 0;
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  const d = info === undefined ? '' : typeof info === 'string' ? info : JSON.stringify(info);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${d ? ` :: ${d.slice(0, 300)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () =>
  new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8888/healthz', { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
if (await up()) {
  console.log('SKIP — a SearXNG already answers on :8888 (not ours; left untouched).');
  process.exit(0);
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-selfsearch-pkg-'));
const env = { ...process.env, MARTIALDEX_HEADLESS: '1', GEMINI_API_KEY: '', TAVILY_API_KEY: '' };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: path.join(APP, 'Contents/MacOS/MARTIALDEX'), args: [`--user-data-dir=${userData}`], env, timeout: 120000 });
let app = await launch();
await app.evaluate(() => {
  const orig = globalThis.fetch;
  globalThis.__blocked = [];
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/generativelanguage\.googleapis\.com|api\.tavily\.com|supabase\.co/i.test(url)) {
      globalThis.__blocked.push(url);
      return Promise.reject(new TypeError('blocked by QA'));
    }
    return orig(input, init);
  };
});
const isPackaged = await app.evaluate(({ app: a }) => a.isPackaged);
check('패키징된 앱으로 실행 (app.isPackaged)', isPackaged === true);
const page = await app.firstWindow();
await page.waitForFunction(() => !!window.martialdex?.selfSearch, null, { timeout: 60000 });
let st = await page.evaluate(() => window.martialdex.selfSearch.status());
check('설정 파일·실행 환경 확인 (missing 없음)', st.supported && st.installed && st.missing.length === 0, { installed: st.installed, missing: st.missing });
check('기본 OFF · 실행만으로 서버 안 띄움', !st.enabled && !(await up()));
let t0 = Date.now();
const on = await page.evaluate(() => window.martialdex.selfSearch.setEnabled(true));
st = await page.evaluate(() => window.martialdex.selfSearch.status());
check('ON → 앱이 SearXNG 실행 (owned)', on.ok && st.phase === 'running' && st.owned, { on, ms: Date.now() - t0 });
const r = await page.evaluate(() => window.martialdex.research.search({ query: 'boxing jab technique', kind: 'web', maxResults: 5, extractTop: 0 }));
check('패키징 앱에서 실제 검색 결과 수신', r.ok && r.results.length > 0, r.ok ? r.results.slice(0, 2).map((x) => [x.title, x.url]) : r);
const off = await page.evaluate(() => window.martialdex.selfSearch.setEnabled(false));
await sleep(600);
check('OFF → 앱이 띄운 서버 종료', off.ok && off.stoppedServer && !(await up()), off);
await page.evaluate(() => window.martialdex.selfSearch.setEnabled(true));
const pid = JSON.parse(fs.readFileSync(path.join(userData, 'self-search.pid.json'), 'utf8')).pid;
const blocked = await app.evaluate(() => globalThis.__blocked);
await app.close();
await sleep(2500);
let alive = true;
try {
  process.kill(pid, 0);
} catch {
  alive = false;
}
check('ON 상태로 종료 → 서버 정리', !alive && !(await up()), { pid, alive });
check('ON 선택 저장', JSON.parse(fs.readFileSync(path.join(userData, 'self-search-settings.json'), 'utf8')).enabled === true);
// next launch restores ON (3 s after ready), then quit again
app = await launch();
const page2 = await app.firstWindow();
await page2.waitForFunction(() => !!window.martialdex?.selfSearch, null, { timeout: 60000 });
let restored = false;
for (let i = 0; i < 60 && !restored; i++) {
  restored = (await page2.evaluate(() => window.martialdex.selfSearch.status())).phase === 'running';
  if (!restored) await sleep(1000);
}
check('다음 실행 때 ON 복원 (자동 시작)', restored);
await page2.evaluate(() => window.martialdex.selfSearch.setEnabled(false));
await app.close();
await sleep(1500);
check('Gemini·Tavily·Supabase 요청 0건 (메인)', blocked.length === 0, blocked);
check('종료 후 SearXNG 없음', !(await up()));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
