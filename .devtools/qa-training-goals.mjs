// UI QA — 개인 목표 화면 (pages/TrainingGoals). Headless Chrome (no window, no sound) against the production
// build (`vite preview`), desktop + mobile, light + dark. Checks writing, autosave, reload persistence, editing,
// deleting, the unsaved-draft survival when leaving the screen, and 지난 목표 never being auto-deleted.
//   npm run build && node .devtools/qa-training-goals.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4801;
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
  for (const [label, viewport, theme] of [['데스크톱 · 라이트', { width: 1280, height: 950 }, 'light'], ['모바일 390px · 다크', { width: 390, height: 844 }, 'dark']]) {
    const ctx = await browser.newContext({ viewport, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((t) => localStorage.setItem('martialdex:theme', t), theme);

    await page.goto(`${BASE}/#/goals`);
    await page.waitForSelector('[data-testid="training-goals"]', { timeout: 20000 });
    const cards = await page.locator('[data-testid="goal-card"]').count();
    const slotIds = await page.locator('[data-testid="goal-card"]').evaluateAll((els) => els.map((e) => e.dataset.slot));
    check(`[${label}] 5개 영역 (이번 주 · 이번 달 · 올해 · 내년 · 앞으로)`, cards === 5 && slotIds.join() === 'week,month,year,next_year,long_term', slotIds);
    const labels = await page.locator('[data-testid="goal-card"] h3').allInnerTexts();
    const yearNow = new Date().getFullYear();
    check(`[${label}] 연도는 오늘 날짜로 계산 (올해 ${yearNow} · 내년 ${yearNow + 1})`, labels[2].includes(String(yearNow)) && labels[3].includes(String(yearNow + 1)), labels);
    check(`[${label}] 모두 빈 칸이어도 정상 (필수 입력 아님)`, (await page.locator('[data-testid="goal-input"]').evaluateAll((els) => els.every((e) => e.value === ''))) && (await page.locator('[data-testid="goals-past"]').count()) === 0);

    // write the week goal: autosave, no button needed
    const week = page.locator('[data-testid="goal-card"][data-slot="week"]');
    await week.locator('[data-testid="goal-input"]').fill('이번 주는 더블렉 진입과 마무리.\n- 매일 10분 섀도우\n- 스파링 2회');
    check(`[${label}] 저장 전에는 "저장 안 됨" 표시`, (await week.locator('[data-testid="goal-state"]').innerText()).includes('저장 안 됨'));
    await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('martialdex:training-goals') || '{"entries":[]}').entries.length, null, { timeout: 8000 });
    check(`[${label}] 1.5초 뒤 자동 저장 (여러 줄 그대로)`, (await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:training-goals')).entries[0].text)).includes('\n- 매일 10분 섀도우'));

    // long-term via the explicit save button
    const lt = page.locator('[data-testid="goal-card"][data-slot="long_term"]');
    await lt.locator('[data-testid="goal-input"]').fill('MMA에서 타격과 레슬링을 자연스럽게 연결하는 선수가 되고 싶다.');
    await lt.locator('[data-testid="goal-save"]').click();
    check(`[${label}] 저장 버튼으로도 저장`, (await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:training-goals')).entries.length)) === 2);

    // leave mid-sentence → come back: the unsaved draft is still there
    const month = page.locator('[data-testid="goal-card"][data-slot="month"]');
    await month.locator('[data-testid="goal-input"]').evaluate((el) => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '아직 쓰는 중인 이번 달 목표');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => (location.hash = '#/profile'));
    await page.waitForTimeout(500);
    await page.evaluate(() => (location.hash = '#/goals'));
    await page.waitForSelector('[data-testid="training-goals"]');
    const monthBack = await page.locator('[data-testid="goal-card"][data-slot="month"] [data-testid="goal-input"]').inputValue();
    check(`[${label}] 작성 중 다른 화면에 갔다 와도 내용이 남아 있음`, monthBack === '아직 쓰는 중인 이번 달 목표', monthBack);

    // reload = app restart
    await page.reload();
    await page.waitForSelector('[data-testid="training-goals"]');
    const afterReload = await page.locator('[data-testid="goal-card"][data-slot="week"] [data-testid="goal-input"]').inputValue();
    const stateText = await page.locator('[data-testid="goal-card"][data-slot="week"] [data-testid="goal-state"]').innerText();
    check(`[${label}] 앱 재실행(새로고침) 후에도 저장된 목표 유지 + 마지막 수정 시간 표시`, afterReload.startsWith('이번 주는 더블렉') && /마지막 수정 \d{4}-\d{2}-\d{2}/.test(stateText), { afterReload: afterReload.slice(0, 30), stateText });

    // edit then delete
    await page.locator('[data-testid="goal-card"][data-slot="week"] [data-testid="goal-input"]').fill('수정된 이번 주 목표');
    await page.locator('[data-testid="goal-card"][data-slot="week"] [data-testid="goal-save"]').click();
    const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:training-goals')).entries.filter((e) => e.scope === 'week' && !e.deletedAt));
    check(`[${label}] 수정 — 같은 기간 항목 하나만 갱신`, edited.length === 1 && edited[0].text === '수정된 이번 주 목표', edited.map((e) => e.text));
    await page.locator('[data-testid="goal-card"][data-slot="week"] [data-testid="goal-delete"]').click();
    await page.waitForTimeout(200);
    check(`[${label}] 삭제 — 그 영역만 비고 나머지는 유지`, (await page.locator('[data-testid="goal-card"][data-slot="week"] [data-testid="goal-input"]').inputValue()) === '' && (await page.locator('[data-testid="goal-card"][data-slot="long_term"] [data-testid="goal-input"]').inputValue()).startsWith('MMA에서'));

    // a goal from a period that has ended must still be there, listed as 지난 목표
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('martialdex:training-goals'));
      d.entries.push({ id: 'old-1', scope: 'week', periodKey: '2020-W01', text: '지난 주에 썼던 목표', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' });
      localStorage.setItem('martialdex:training-goals', JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('[data-testid="training-goals"]');
    await page.locator('[data-testid="goals-past"]').evaluate((el) => (el.open = true)); // collapsed <details> hides its text from innerText
    const pastCount = await page.locator('[data-testid="goal-past-item"]').count();
    const pastText = await page.locator('[data-testid="goals-past"]').innerText();
    check(`[${label}] 기간이 끝난 목표는 "지난 목표"로 보관 (삭제하지 않음)`, pastCount === 1 && /지난 주에 썼던 목표/.test(pastText) && /2020년 1주차/.test(pastText), pastText.slice(0, 120));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.goal-card__text')).backgroundColor);
    check(`[${label}] 가로 스크롤 없음 · 테마 적용 (${bg})`, !overflow && (theme === 'dark' ? !/255, 255, 255/.test(bg) : true));
    check(`[${label}] 프로필에서 목표 화면으로 가는 링크`, (await page.evaluate(async () => { location.hash = '#/profile'; await new Promise((r) => setTimeout(r, 600)); return !!document.querySelector('[data-testid="profile-goals-link"]'); })));
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
