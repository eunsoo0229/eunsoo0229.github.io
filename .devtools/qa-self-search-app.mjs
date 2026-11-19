// 자체 검색 ON/OFF — inside the real Electron app (hidden + muted automation launch, see main.cjs).
// Settings switch default OFF → coach research returns DISABLED (no search, no other service) →
// CoachChat status line says 꺼짐 → ON starts SearXNG (owned) → status 사용 가능 → OFF stops it →
// quitting with ON stops the app's own SearXNG. Only /healthz is touched — no search query is sent.
// Requires this folder's Vite dev server on :5173 and no SearXNG on :8888. Run: node .devtools/qa-self-search-app.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); // this checkout (original or a dev copy)
let pass = 0;
let fail = 0;
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  const d = info === undefined ? '' : typeof info === 'string' ? info : JSON.stringify(info);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${d ? ` :: ${d.slice(0, 300)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch('http://127.0.0.1:8888/healthz', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
if (await up()) {
  console.log('SKIP — a SearXNG already answers on :8888.');
  process.exit(0);
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-selfsearch-app-'));
const env = { ...process.env, MARTIALDEX_HEADLESS: '1', GEMINI_API_KEY: '', TAVILY_API_KEY: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${userData}`], env, timeout: 120000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/#/profile'); // HashRouter
await page.waitForSelector('[data-testid="self-search-phase"]', { timeout: 30000 });
check('설정 스위치 표시 · 기본 OFF', (await page.getAttribute('[data-testid="self-search-phase"]', 'data-phase')) === 'off' && !(await page.isChecked('[data-testid="self-search-toggle"]')));
check('앱 실행만으로 검색 서버를 띄우지 않음', !(await up()));

const research = () =>
  page.evaluate(async () => {
    const { selfResearchProvider } = await import('/src/lib/selfResearch/provider.ts');
    return selfResearchProvider.search({ query: 'jab', kind: 'video' });
  });
let r = await research();
check('OFF → 코치 검색은 DISABLED (다른 검색 서비스 사용 안 함)', !r.ok && r.code === 'DISABLED', r);

await page.goto('http://localhost:5173/#/coach/chat');
await page.waitForSelector('[data-testid="self-ai-status"]', { timeout: 30000 });
await page.waitForFunction(() => !/확인 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 20000 });
check('대화 화면 상태 줄: 자체 검색 꺼짐 안내', /자체 검색:\s*꺼짐 \(설정/.test(await page.textContent('[data-testid="self-ai-status"]')), await page.textContent('[data-testid="self-ai-status"]'));

await page.goto('http://localhost:5173/#/profile');
await page.waitForSelector('[data-testid="self-search-toggle"]');
let t0 = Date.now();
await page.click('[data-testid="self-search-toggle"]');
await page.waitForFunction(() => document.querySelector('[data-testid="self-search-phase"]')?.getAttribute('data-phase') === 'running', null, { timeout: 90000 });
check('ON → 검색 서버 실행 (MARTIALDEX가 실행)', (await up()) && /MARTIALDEX가 실행함/.test(await page.textContent('[data-testid="self-search-switch"]')), { ms: Date.now() - t0 });
const st = await page.evaluate(() => window.martialdex.research.status());
check('ON → 검색 상태 사용 가능', st.ok === true, st);

await page.click('[data-testid="self-search-toggle"]');
await page.waitForFunction(() => document.querySelector('[data-testid="self-search-phase"]')?.getAttribute('data-phase') === 'off', null, { timeout: 30000 });
await sleep(500);
check('OFF → 앱이 띄운 검색 서버 종료', !(await up()));

await page.click('[data-testid="self-search-toggle"]');
await page.waitForFunction(() => document.querySelector('[data-testid="self-search-phase"]')?.getAttribute('data-phase') === 'running', null, { timeout: 90000 });
const pid = JSON.parse(fs.readFileSync(path.join(userData, 'self-search.pid.json'), 'utf8')).pid;
check('페이지 오류 없음', errors.length === 0, errors);
await app.close();
await sleep(2000);
let alive = true;
try {
  process.kill(pid, 0);
} catch {
  alive = false;
}
check('ON 상태로 앱 종료 → 앱이 띄운 검색 서버 정리', !alive && !(await up()), { pid, alive });
const saved = JSON.parse(fs.readFileSync(path.join(userData, 'self-search-settings.json'), 'utf8'));
check('ON 선택은 저장됨 (다음 실행 때 다시 켬)', saved.enabled === true, saved);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
