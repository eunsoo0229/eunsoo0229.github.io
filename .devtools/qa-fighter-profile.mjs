// UI QA — 개인 파이터 프로필 in headless Chrome (no window, no sound) against the built
// renderer served by `vite preview`. Rules engine only (no AI call), logged out.
//   npm run build && node .devtools/qa-fighter-profile.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4791;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 200) : '')));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const [label, viewport] of [['모바일 390px', { width: 390, height: 844 }], ['데스크톱 1280px', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: false })));
    await page.goto(`http://localhost:${PORT}/#/fighter-profile`);
    await page.getByTestId('fighter-profile').waitFor({ timeout: 20000 });
    check(`[${label}] 프로필 홈 — 빈 상태 안내`, await page.getByTestId('fp-empty').isVisible());
    check(`[${label}] 가로 스크롤 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    await page.getByTestId('fp-home-start').click();
    await page.getByTestId('fp-start').click();
    await page.getByTestId('fp-coach-msg').first().waitFor();
    check(`[${label}] 인터뷰 시작 — 질문 하나`, (await page.getByTestId('fp-coach-msg').count()) === 1);
    check(`[${label}] 엔진 = MARTIALDEX 자체 (AI 호출 없음)`, (await page.getByTestId('fp-engine').inputValue()) === 'martialdex');
    await page.getByTestId('fp-input').fill('킥복싱이랑 주짓수');
    await page.getByTestId('fp-send').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="fp-coach-msg"]').length >= 2);
    const t2 = await page.getByTestId('fp-coach-msg').last().innerText();
    check(`[${label}] 답변 요약 + 다음 질문`, /기록할게요/.test(t2) && /종목별로/.test(t2), t2);
    await page.getByTestId('fp-skip').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="fp-coach-msg"]').length >= 3);
    check(`[${label}] 건너뛰기`, /넘어갈게요/.test(await page.getByTestId('fp-coach-msg').last().innerText()));
    await page.getByTestId('fp-input').fill('주 3회');
    await page.getByTestId('fp-send').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="fp-coach-msg"]').length >= 4);
    // quick-choice chip for a choice question
    await page.locator('.fp-quick .chip', { hasText: '체육관' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="fp-coach-msg"]').length >= 5);
    check(`[${label}] 선택 칩으로 답변`, /체육관/.test(await page.getByTestId('fp-user-msg').last().innerText()));
    await page.getByTestId('fp-unknown').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="fp-coach-msg"]').length >= 6);
    check(`[${label}] 모르겠어요 → 미확인`, /미확인/.test(await page.getByTestId('fp-coach-msg').last().innerText()));
    await page.getByTestId('fp-pause').click();
    check(`[${label}] 임시 저장`, (await page.getByTestId('fp-start').innerText()).includes('이어서'));
    // detail: edit + delete
    await page.getByTestId('fp-tab-detail').click();
    await page.getByTestId('fp-section-training').waitFor();
    const freq = page.locator('[data-testid="fp-item"][data-key="train.frequency"]');
    check(`[${label}] 상세 — 기록된 항목 표시 (출처 배지)`, /3회/.test(await freq.innerText()) && /본인 답변/.test(await freq.innerText()));
    await freq.getByTestId('fp-edit').click();
    await freq.getByTestId('fp-edit-value').fill('5');
    await freq.getByTestId('fp-edit-save').click();
    await page.waitForFunction(() => /5회/.test(document.querySelector('[data-key="train.frequency"]')?.textContent ?? ''));
    check(`[${label}] 항목 수정`, true);
    page.once('dialog', (d) => d.accept());
    await freq.getByTestId('fp-delete').click();
    await page.waitForFunction(() => !document.querySelector('[data-key="train.frequency"]'));
    check(`[${label}] 항목 삭제`, true);
    // measurement with guide
    await page.locator('label', { hasText: '비어 있는 항목도 보기' }).locator('input').check();
    await page.getByRole('button', { name: /기본 신체 정보/ }).click();
    const wing = page.locator('[data-testid="fp-item"][data-key="body.wingspan"]');
    await wing.getByTestId('fp-edit').click();
    check(`[${label}] 측정 가이드 표시`, /양팔을 어깨높이/.test(await wing.innerText()));
    await wing.getByTestId('fp-edit-value').fill('181');
    await wing.getByTestId('fp-edit-method').selectOption('tape_helper');
    await wing.getByTestId('fp-edit-save').click();
    await page.waitForFunction(() => /181cm/.test(document.querySelector('[data-key="body.wingspan"]')?.textContent ?? ''));
    check(`[${label}] 측정값 저장 (방법 표시)`, /다른 사람이 줄자로/.test(await wing.innerText()));
    // home
    await page.getByTestId('fp-tab-home').click();
    const comp = await page.getByTestId('fp-completeness').innerText();
    check(`[${label}] 홈 — 섹션별 완성도 (등급 아님 안내)`, /실력이나 등급이 아니라/.test(comp) && /건너뜀 1/.test(comp), comp.slice(0, 200));
    check(`[${label}] 홈 — 신체 측정값 카드`, /181cm/.test(await page.getByTestId('fp-measurements').innerText()));
    check(`[${label}] 홈에서도 가로 스크롤 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check(`[${label}] 페이지 오류 없음`, errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await browser.close();
  preview.kill();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
