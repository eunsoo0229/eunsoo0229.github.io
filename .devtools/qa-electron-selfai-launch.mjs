// Real Electron start-up + self-AI search in the actual main process.
// Regression for ERR_REQUIRE_ESM (linkedom → css-select 7) that crashed the
// main process before any window existed. Checks: main process starts without an
// uncaught exception, the window loads the app, the self-search IPC runs a real
// SearXNG search and extracts page text with linkedom + Readability, and the
// self-AI / coach / lesson screens render.
// Launch is hidden + muted (Playwright → isAutomation in electron/main.cjs).
// Requires the Vite dev server on :5173 and SearXNG on :8888.
// Run: node .devtools/qa-electron-selfai-launch.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d ? ' :: ' + d.slice(0, 400) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-selfai-launch-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
  let mainLog = '';
  app.process().stderr.on('data', (b) => { mainLog += b; });
  app.process().stdout.on('data', (b) => { mainLog += b; });
  try {
    const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.waitForLoadState('load');
    await sleep(1500);

    const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible(), muted: w.webContents.isAudioMuted() })));
    check('[L1] 메인 프로세스 시작, 앱 창 생성', wins.some((w) => w.url.startsWith('http://localhost:5173')), wins);
    check('[L2] QA 실행은 숨김·음소거 (사용자 화면에 안 뜸)', wins.every((w) => !w.visible && w.muted), wins);
    const root = await page.evaluate(() => ({ len: document.getElementById('root')?.innerText.length ?? 0, crashed: document.body.innerText.includes('화면을 표시할 수 없습니다') }));
    check('[L3] 앱 화면 렌더링 (빈 화면·에러 화면 아님)', root.len > 50 && !root.crashed, root);

    const st = await page.evaluate(() => window.martialdex.research.status());
    check('[S1] 자체 검색 상태 IPC — SearXNG 연결', st.ok === true, st);
    const r = await page.evaluate(() => window.martialdex.research.search({ query: 'boxing jab setup drills', kind: 'web', maxResults: 6, extractTop: 3 }));
    const ex = (r.results || []).map((x) => ({ host: x.source, status: x.extraction?.status, method: x.extraction?.method, chars: x.extraction?.chars }));
    check('[S2] 실제 웹 검색 결과 수신 (메인 프로세스)', r.ok === true && r.results.length > 0, r.ok ? ex : r);
    check('[S3] linkedom + Readability 본문 추출 성공 1건 이상', ex.some((x) => x.status === 'ok' && x.method === 'readability' && x.chars > 200), ex);
    check('[S4] 본문 추출기 로드 실패 없음', !ex.some((x) => x.status === 'failed' && /추출기 로드 실패/.test(JSON.stringify(r))), ex);
    const ai = await page.evaluate(() => window.martialdex.selfAi.status());
    check('[S5] 자체 AI 상태 IPC 응답', typeof ai?.ok === 'boolean', ai);

    // text outside the header must contain the screen's own heading
    // (the app's CSP forbids eval, so the probe is written out inline)
    for (const [hash, label, expect] of [['#/coach/chat', '자체 AI 대화 코치', 'MARTIALDEX 자체 AI 코치'], ['#/coach', 'AI 코치 탭', 'AI 기능을 모두'], ['#/coach/class', 'AI 코치 수업', '어디에서 운동할까요'], ['#/learning', '학습(커리큘럼)', '추천 학습 순서']]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      // routes are lazy chunks — wait for the content instead of a fixed delay
      await page.waitForFunction((e) => (document.getElementById('root')?.innerText ?? '').replace(document.querySelector('#root header')?.innerText ?? '', '').includes(e), expect, { timeout: 15000 }).catch(() => {});
      const s = await page.evaluate((e) => {
        const t = (document.getElementById('root')?.innerText ?? '').replace(document.querySelector('#root header')?.innerText ?? '', '');
        return { has: t.includes(e), len: t.length, head: t.trim().slice(0, 60), crashed: document.body.innerText.includes('화면을 표시할 수 없습니다') };
      }, expect);
      check(`[R] ${label} 화면 렌더링 (${hash})`, s.has && !s.crashed, s);
    }
    check('[R9] 페이지 에러 없음', errors.length === 0, errors);
  } finally {
    await app.close().catch(() => {});
  }
  check('[L9] 메인 프로세스 로그에 Uncaught/ERR_REQUIRE_ESM 없음', !/Uncaught|ERR_REQUIRE_ESM|A JavaScript error occurred/.test(mainLog), mainLog.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 5));
  const passed = results.filter((x) => x.pass).length;
  console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
