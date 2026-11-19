// 리디자인 화면 점검 — 개발 서버(localhost:5173)의 주요 라우트를 데스크톱(1440)·모바일(390)에서 열어
// 스크린샷 저장, 런타임 오류·가로 스크롤·브랜드 셸 렌더 여부를 확인한다. 외부 요청(Supabase·Gemini 등)은 차단(비로그인 상태).
//   SHOT_DIR=/path node .devtools/qa-redesign-screens.mjs [route…]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/', '/arts', '/arts/boxing', '/arts/boxing/techniques', '/arts/boxing/techniques/boxing__jab', '/techniques', '/learning',
  '/coach', '/coach/chat', '/training', '/program', '/progress', '/my-skills', '/stats', '/community', '/gyms', '/gyms/deals',
  '/gear', '/fighter-profile', '/profile', '/login', '/signup', '/favorites', '/combos', '/graph', '/nutrition', '/gym', '/does-not-exist',
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 200)}`); } };
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1 });
  await ctx.route(/supabase\.co|generativelanguage|functions\/v1|youtube\.com|ytimg\.com|tosspayments\.com|searx|duckduckgo\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const r of ROUTES) {
    errors.length = 0;
    await page.goto(`http://localhost:5173/#${r}`);
    await page.waitForTimeout(r === '/' ? 2600 : 1600);
    const shell = await page.locator('[data-testid="app-shell"]').count();
    const crashed = await page.locator('text=/문제가 발생했습니다|Something went wrong/').count();
    const noH = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`${vp.name} ${r} 브랜드 셸`, shell === 1, shell);
    check(`${vp.name} ${r} 오류 화면 없음`, crashed === 0 && errors.length === 0, errors.slice(0, 2));
    check(`${vp.name} ${r} 가로 스크롤 없음`, noH, await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.name}${r.replace(/[/:]/g, '_') || '_home'}.png`), fullPage: vp.name === 'desktop' ? false : false });
  }
  await ctx.close();
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await browser.close();
process.exit(fail ? 1 : 0);
