// Packaged Electron app (release/mac, file:// renderer) — the 3D demo loads its GLB and plays.
// Playwright launch → main.cjs automation mode: hidden window, muted, temp profile.
//   npx electron-builder --mac --x64 --dir --config electron-builder.config.cjs && node .devtools/qa-motion3d-electron.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const exe = path.join(APP, 'release/mac/MARTIALDEX.app/Contents/MacOS/MARTIALDEX');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 240) : '')));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-m3d-'))}`], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  check('패키지 앱이 file:// 로 렌더러 로드', page.url().startsWith('file://'), page.url().slice(0, 60));
  await page.evaluate(() => (location.hash = '#/arts/boxing/techniques/boxing__jab'));
  await page.waitForSelector('.detail-hero h1', { timeout: 60000 });
  check('기본 상태 canvas 0', (await page.locator('canvas').count()) === 0);
  await page.click('[data-testid="motion3d-open"]');
  await page.waitForSelector('[data-testid="motion3d-stage"][data-loaded="true"], [data-testid="motion3d-error"]', { timeout: 60000 });
  const err = await page.locator('[data-testid="motion3d-error"]').count();
  check('file:// 에서 Jab GLB 로딩', err === 0 && (await page.locator('canvas').count()) === 1, err ? await page.locator('[data-testid="motion3d-error"]').innerText() : '');
  const t0 = Number(await page.getAttribute('[data-testid="motion3d-stage"]', 'data-time'));
  await page.waitForTimeout(700);
  const t1 = Number(await page.getAttribute('[data-testid="motion3d-stage"]', 'data-time'));
  check('재생 진행', t1 !== t0, { t0, t1 });
  await page.click('[data-testid="motion3d-mode"]');
  check('관절 모드', (await page.getAttribute('[data-testid="motion3d-stage"]', 'data-mode')) === 'skeleton');
  await page.click('[data-testid="motion3d-close"]');
  const stats = await page.evaluate(() => window.__motion3dStats);
  check('닫기 → 해제', (await page.locator('canvas').count()) === 0 && stats.created === stats.disposed, stats);
  // Phase 1.3: authored clips — separate character + animation GLBs under file://
  for (const tech of ['boxing__cross', 'boxing__hook', 'wrestling__basic-double-leg']) {
    const art = tech.split('__')[0];
    await page.evaluate((h) => (location.hash = h), `#/arts/${art}/techniques/${tech}`);
    await page.waitForSelector('[data-testid="motion3d-open"]', { timeout: 60000 });
    await page.click('[data-testid="motion3d-open"]');
    await page.waitForSelector('[data-testid="motion3d-stage"][data-loaded="true"], [data-testid="motion3d-error"]', { timeout: 60000 });
    const e2 = await page.locator('[data-testid="motion3d-error"]').count();
    const a = Number(await page.getAttribute('[data-testid="motion3d-stage"]', 'data-time'));
    await page.waitForTimeout(600);
    const b = Number(await page.getAttribute('[data-testid="motion3d-stage"]', 'data-time'));
    check(`${tech}: file:// 에서 캐릭터+애니메이션 로딩·재생`, e2 === 0 && b !== a, { a, b });
    await page.click('[data-testid="motion3d-close"]');
  }
  check('페이지 오류 없음', errors.length === 0, errors);
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await app.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
