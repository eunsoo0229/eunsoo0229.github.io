// 통합 플랫폼 — Electron(창 숨김·음소거, MARTIALDEX_HEADLESS=1) 에서 새 화면이 열리고 깨지지 않는지 확인한다.
// 개발 서버(localhost:5173) 를 쓰는 기존 QA 와 같은 방식. Supabase·Gemini 등 외부 요청은 page.route 로 모두 막으므로
// 서버 화면은 "불러오지 못함/빈 상태" 로 정상 처리되는지, 로컬 기능(개인 훈련 프로그램·훈련 성과)은 끝까지 동작하는지 본다.
//   node .devtools/qa-ecosystem-electron.mjs
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 240)}`); } };
const env = { ...process.env, MARTIALDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP], env, timeout: 60000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.route(/generativelanguage|supabase\.co|functions\/v1|:8888|searx|duckduckgo|bing\.com|google\.com\/search/, (r) => r.abort());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.waitForLoadState('domcontentloaded');
  const isElectron = await page.evaluate(() => !!window.martialdex);
  check('Electron 렌더러 (preload 브리지 있음)', isElectron);
  const routes = [
    ['/gyms', '체육관'], ['/gyms/deals', '할인'], ['/gyms/coupons', '쿠폰'], ['/gyms/manage', '체육관'],
    ['/gear', '장비'], ['/gear/new', ''], ['/gear/mine', ''], ['/evaluations', '평가'],
    ['/admin/platform', ''], ['/verification', ''], ['/gym', '체육관'], ['/gym/admin', '체육관'],
    ['/program', '훈련 계획'], ['/progress', '성장 기록'], ['/community', '커뮤니티'], ['/shorts', ''],
  ];
  for (const [r, must] of routes) {
    await page.evaluate((h) => { location.hash = h; }, r);
    await page.waitForTimeout(1500);
    const body = await page.locator('body').innerText();
    check(`Electron 화면 열림 ${r}`, body.length > 40 && !/문제가 발생했습니다|Something went wrong/.test(body) && (!must || body.includes(must)), body.slice(0, 160));
  }
  await page.evaluate(() => { location.hash = '/program'; });
  await page.waitForTimeout(1200);
  await page.getByTestId('program-generate').click();
  await page.waitForTimeout(1200);
  check('Electron: 개인 훈련 프로그램 생성 (로컬, 서버 없이)', (await page.getByTestId('program-day').count()) === 7);
} catch (e) {
  fail++;
  console.log('  FAIL  예외 ::', String(e).slice(0, 300));
}
check('Electron 페이지 런타임 오류 없음', errors.length === 0, errors.slice(0, 3));
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await app.close();
process.exit(fail ? 1 : 0);
