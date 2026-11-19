// Android 작은 화면 가림 점검 — 로컬 테스트 백엔드(PGlite, 운영 Supabase·Gemini 호출 없음)에 로그인 상태로 붙여
// 모든 라우트를 작은 Android 뷰포트(360×640, 320×568)에서 열고 다음을 찾는다.
//   1) 가로 스크롤 / 화면 밖으로 밀려난 버튼·입력
//   2) 스크롤해도 고정 요소(상단 바·하단 탭바·플로팅 버튼)에 덮여 누를 수 없는 버튼·입력
//   3) overflow:hidden 으로 잘린 글자(말줄임 없이)
//   PGLITE_DIR=/path/to/node_modules [SHOT_DIR=…] node .devtools/qa-android-small-screens.mjs [route…]
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { startPgliteSupabase } from './lib/pglite-supabase.mjs';
import { inspect } from './lib/occlusion-inspect.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOT_DIR ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
if (!process.env.PGLITE_DIR) { console.log('NOT TESTED — set PGLITE_DIR'); process.exit(2); }

const ME = { id: '00000000-0000-4000-8000-000000000001', email: 'me@test.local', password: 'pw', nickname: '작은화면' };
const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54398, users: [ME], appDir: APP });
await sb.sql(`insert into public.platform_admins (user_id) values ($1)`, [ME.id]);
const seed = async (label, fn) => { try { return await fn(); } catch (e) { console.log(`  (seed ${label} skipped: ${e.message.slice(0, 90)})`); return null; } };
const gymListing = await seed('gym listing', async () => {
  const id = (await sb.asUser(ME.id, (q) => q(`insert into public.gym_listings (owner_user_id, name, arts, address, region) values ($1, '아주 긴 이름의 종합격투기 앤 주짓수 퍼포먼스 트레이닝 센터 강남 본점', '{boxing,bjj,mma}', '서울시 강남구 테헤란로 123 지하 1층', '서울 강남구') returning id`, [ME.id]))).rows[0].id;
  await sb.asUser(ME.id, (q) => q(`select public.review_gym_listing($1, 'approved', '')`, [id]));
  return id;
});
const gear = await seed('gear', async () => (await sb.asUser(ME.id, (q) => q(`insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, description, region, shipping_available) values ($1, $2, '거의 새것 16온스 프로 스파링 글러브 (벨크로) 정품 박스 포함', 'boxing_gloves', 'like_new', 1250000, '한 달 사용', '서울 마포구', true) returning id`, [ME.id, ME.nickname]))).rows[0].id);

process.env.VITE_SUPABASE_URL = sb.url;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-test-anon-key';
const vite = await createServer({ root: APP, configFile: path.join(APP, 'vite.config.ts'), server: { port: 5198, strictPort: true, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
await vite.listen();
const BASE = 'http://127.0.0.1:5198/#';

const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/', '/arts', '/arts/boxing', '/arts/boxing/techniques', '/arts/boxing/techniques/boxing__jab', '/techniques', '/techniques/request',
  '/free-training', '/ai-combo', '/user-combos', '/favorites', '/ai-history', '/combos', '/combos/new', '/skill-tree', '/tactics', '/tactics/new',
  '/training-analytics', '/training-analytics/history', '/dashboard', '/personal-coach', '/marketplace', '/learning', '/learning/new', '/learning/boxing',
  '/community', '/my-skills', '/learned-techniques', '/fighter-style', '/ai-curriculum', '/home-training', '/training', '/training/routines',
  '/training/trainer', '/fighter-profile', '/goals', '/categories', '/training/exercises', '/gym', '/gym/admin', '/nutrition', '/nutrition/goals',
  '/coach', '/coach/class', '/coach/chat', '/coach/lesson', '/coach/mitt', '/today-training', '/sparring', '/sparring/record', '/sparring/videos',
  '/graph', '/situation', '/stats', '/review', '/review/ai', '/review/training', '/review/lessons', '/review/gym', '/review/weak', '/my-style',
  `/u/${ME.id}`, '/messages', '/clans', '/notifications', '/evaluations', '/admin/platform', '/verification', '/progress', '/program',
  '/gyms', '/gyms/compare', '/gyms/deals', '/gyms/coupons', '/gyms/manage', '/gyms/manage/new', ...(gymListing ? [`/gyms/${gymListing}`, `/gyms/manage/${gymListing}`] : []),
  '/gear', '/gear/new', '/gear/mine', '/gear/orders', ...(gear ? [`/gear/${gear}`, `/gear/${gear}/edit`] : []),
  '/profile', '/does-not-exist',
];
const ANON_ROUTES = ['/login', '/signup', '/reset-password'];
const VIEWPORTS = [
  { name: '360', width: 360, height: 640 },
  { name: '320', width: 320, height: 568 },
];

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });
let pass = 0, fail = 0;
const report = {};
for (const vp of VIEWPORTS) {
  for (const [who, routes] of [['me', ROUTES], ['anon', ANON_ROUTES]]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, bypassCSP: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
    await ctx.route((url) => !/^(http:\/\/(127\.0\.0\.1:5198|localhost:54398)|data:|blob:)/.test(url.href), (r) => r.abort());
    if (who === 'me') await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ['sb-localhost-auth-token', JSON.stringify(sb.session(ME))]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.dismiss());
    for (const r of routes) {
      errors.length = 0;
      await page.goto(`${BASE}${r}`);
      await page.waitForTimeout(1500);
      const modal = page.locator('.modal-overlay').filter({ hasText: '기존 데이터를 계정에 저장할까요' });
      if (await modal.count()) { await modal.locator('.btn-ghost').first().click(); await page.waitForTimeout(300); }
      const probs = await page.evaluate(inspect);
      if (errors.length) probs.push(`런타임 오류: ${errors[0].slice(0, 120)}`);
      const key = `${vp.name} ${r}`;
      if (probs.length) { fail++; report[key] = probs; console.log(`  FAIL  ${key}`); for (const p of probs.slice(0, 12)) console.log(`        - ${p}`); if (probs.length > 12) console.log(`        … +${probs.length - 12}`); }
      else pass++;
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${vp.name}${r.replace(/[/:]/g, '_') || '_home'}.png`), fullPage: true });
    }
    if (who === 'me') {
      // toasts (clan invite …) must not cover the tab bar buttons
      await page.goto(`${BASE}/`); await page.waitForTimeout(800);
      const overlap = await page.evaluate(() => {
        const t = document.createElement('div'); t.className = 'notif-toast mx-toast'; t.textContent = '클랜 초대가 왔습니다. 수락 거절';
        document.body.appendChild(t);
        const a = t.getBoundingClientRect(), bar = document.querySelector('.mx-tabbar')?.getBoundingClientRect();
        t.remove();
        return bar && bar.height ? Math.max(0, a.bottom - bar.top) : 0;
      });
      const key = `${vp.name} 토스트 vs 탭바`;
      if (overlap > 0) { fail++; report[key] = [`토스트가 탭바를 ${Math.round(overlap)}px 덮음`]; console.log(`  FAIL  ${key} :: ${Math.round(overlap)}px`); } else pass++;
    }
    await ctx.close();
  }
}
if (process.env.REPORT_JSON) fs.writeFileSync(process.env.REPORT_JSON, JSON.stringify(report, null, 2));
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} screens clean ===`);
await browser.close();
await vite.close();
await sb.close?.();
process.exit(fail ? 1 : 0);
