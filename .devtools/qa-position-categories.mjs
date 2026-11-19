// UI QA — position-first categories (BJJ · MMA) on the art page and the filtered technique list. Headless Chrome (no
// window, no sound) against the production build (`vite preview`), mobile 390 px and desktop 1280 px, light and dark.
//   npm run build && node .devtools/qa-position-categories.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4799;
const BASE = `http://localhost:${PORT}`;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const [label, viewport, theme] of [['데스크톱 1280px · 라이트', { width: 1280, height: 900 }, 'light'], ['모바일 390px · 다크', { width: 390, height: 844 }, 'dark']]) {
    const ctx = await browser.newContext({ viewport, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((t) => localStorage.setItem('martialdex:theme', t), theme);
    for (const art of ['bjj', 'mixed-martial-arts']) {
      await page.goto(`${BASE}/#/arts/${art}`);
      await page.waitForSelector('[data-testid="position-tree"]', { timeout: 20000 });
      const cards = await page.locator('[data-testid="position-card"]').count();
      const first = await page.locator('[data-testid="position-card"]').first().getAttribute('data-position');
      const stats = await page.textContent('[data-testid="position-tree-stats"]');
      check(`[${label}] ${art}: 포지션이 최상위 (카드 ${cards}개, 첫 카드 = 스탠딩), 통계 표시`, cards >= 15 && first === 'standing' && /포지션 \d+개/.test(stats), { cards, first, stats });
      check(`[${label}] ${art}: 기존 카테고리 목록·기존 계층 분류 그대로 제공`, (await page.locator('.taxonomy-legacy summary', { hasText: '기존 카테고리 목록' }).count()) === 1 && (await page.locator('[data-testid="taxonomy-hierarchy-legacy"]').count()) === 1);
      // expand one position → purposes; the counts lead to the filtered list
      const mount = page.locator('[data-testid="position-card"][data-position="mount"]');
      await mount.getByTestId('position-toggle').click();
      const purposes = await mount.locator('[data-testid="position-purpose"]').allInnerTexts();
      check(`[${label}] ${art}: 마운트 → 목적별 하위 분류 (서브미션·컨트롤·탈출…)`, purposes.some((x) => /서브미션/.test(x)) && purposes.some((x) => /컨트롤/.test(x)) && purposes.some((x) => /탈출/.test(x)), purposes);
      const sub = mount.locator('[data-testid="position-purpose"][data-purpose="submission"]');
      const n = Number((await sub.innerText()).match(/\((\d+)\)/)[1]);
      await sub.click();
      await page.waitForSelector('[data-testid="position-filter-bar"]', { timeout: 10000 });
      await page.waitForTimeout(400);
      const rows = await page.locator('[data-testid="technique-row"]').count();
      const h2 = await page.textContent('.section-title h2');
      check(`[${label}] ${art}: 마운트 › 서브미션 → 기술 목록 ${n}개 (카운트 일치), 제목에 위치 표시`, rows === Math.min(n, 30) && /마운트 › 서브미션/.test(h2), { n, rows, h2 });
      const siblings = await page.locator('[data-testid="position-sibling"]').count();
      check(`[${label}] ${art}: 같은 포지션의 다른 목적으로 이동 칩`, siblings >= 1);
      // favourite still works on the filtered list
      const fav = page.locator('[data-testid="technique-row"] .favorite-btn').first();
      const favBefore = await fav.getAttribute('class');
      await fav.click();
      const favAfter = await fav.getAttribute('class');
      await fav.click();
      check(`[${label}] ${art}: 필터된 목록에서 즐겨찾기 토글 동작`, favBefore !== favAfter);
      // detail page opens
      const firstId = await page.locator('[data-testid="technique-row"]').first().getAttribute('data-technique-id');
      await page.locator('[data-testid="technique-row"]').first().click();
      await page.waitForSelector('.detail-hero h1', { timeout: 10000 });
      check(`[${label}] ${art}: 기술 상세 페이지 열림 (ID 유지)`, page.url().includes(firstId));
      await page.goBack();
      await page.waitForSelector('[data-testid="position-filter-bar"]', { timeout: 10000 });
      await page.locator('[data-testid="position-filter-bar"] button', { hasText: '분류 해제' }).click();
      await page.waitForTimeout(400);
      check(`[${label}] ${art}: 분류 해제 → 전체 목록`, (await page.locator('[data-testid="position-filter-bar"]').count()) === 0 && (await page.locator('[data-testid="technique-row"]').count()) >= 20);
      // search on the art page covers every technique, not the open position
      await page.goto(`${BASE}/#/arts/${art}`);
      await page.waitForSelector('[data-testid="position-tree"]');
      await page.fill('[data-testid="position-search"]', art === 'bjj' ? 'kimura' : 'jab');
      await page.waitForSelector('[data-testid="position-search-results"]');
      const hits = await page.locator('[data-testid="position-search-hit"]').count();
      const where = await page.textContent('[data-testid="position-search-results"]');
      check(`[${label}] ${art}: 전체 기술 검색 (포지션과 무관) → 결과와 위치(포지션 › 목적) 표시`, hits >= 1 && /›/.test(where), { hits, where: where.slice(0, 120) });
      await page.fill('[data-testid="position-search"]', '');
      await page.click('[data-testid="position-expand-all"]');
      const expanded = await page.locator('[data-testid="position-card"][data-expanded="true"]').count();
      check(`[${label}] ${art}: 모든 포지션 펼치기`, expanded === cards, { expanded, cards });
      const review = await page.locator('[data-testid="position-review"]').count();
      const statsReview = Number((stats.match(/미분류 검토 (\d+)개/) ?? [])[1] ?? -1);
      check(`[${label}] ${art}: 미분류 검토 영역 = 통계 (0개면 영역 없음)`, statsReview === 0 ? review === 0 : review === 1, { statsReview, review });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(`[${label}] ${art}: 가로 스크롤 없음`, !overflow);
    }
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.position-card')).backgroundColor);
    check(`[${label}] 테마 적용 (${theme}: 카드 배경 ${bg})`, theme === 'dark' ? !/255, 255, 255/.test(bg) : true, bg);
    check(`[${label}] 페이지 오류 없음`, errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  check('실행', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  preview.kill();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
