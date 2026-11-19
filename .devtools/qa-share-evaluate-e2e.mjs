// 공유(종이비행기) + 게시물·숏폼 기술 평가 버튼 E2E — 실제 앱 화면(헤드리스 Chrome, 모바일 390px)을 로컬 테스트 백엔드
// (PGlite + 전체 마이그레이션 + 실제 RLS)에 붙여 사용자처럼 누른다. 운영 Supabase·Gemini 호출 없음(요청 차단).
//   PGLITE_DIR=/path/to/node_modules [SHOT_DIR=…] node .devtools/qa-share-evaluate-e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { startPgliteSupabase } from './lib/pglite-supabase.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOT_DIR ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
if (!process.env.PGLITE_DIR) { console.log('NOT TESTED — set PGLITE_DIR'); process.exit(2); }
const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const A = { id: U(1), email: 'a@test.local', password: 'pw', nickname: '작성자' };
const B = { id: U(2), email: 'b@test.local', password: 'pw', nickname: '보는사람' };
const C = { id: U(3), email: 'c@test.local', password: 'pw', nickname: '친구씨' };

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d !== undefined ? ' :: ' + JSON.stringify(d).slice(0, 300) : ''}`); } };

const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54397, users: [A, B, C], appDir: APP });
await sb.sql(`insert into public.platform_admins (user_id) values ($1)`, [A.id]);
// A: 영상 게시물 2개 (평가 없음)
for (const [id, text, order] of [['pv1', '잽 연습 영상 — 피드백 부탁해요', 1], ['pv2', '훅 드릴', 2]]) {
  await sb.asUser(A.id, (q) => q(`insert into public.community_posts (id, author_id, author_nickname, content, post_type, created_at) values ($1, $2, $3, $4, 'media', now() - ($5 || ' minutes')::interval)`, [id, A.id, A.nickname, text, String(order)]));
  await sb.asUser(A.id, (q) => q(`insert into public.community_post_media (id, post_id, type, url, order_index) values ($1, $2, 'video', 'http://127.0.0.1:5197/none.mp4', 0)`, [`m-${id}`, id]));
}
const gymId = (await sb.asUser(A.id, (q) => q(`insert into public.gym_listings (owner_user_id, name, arts, address, region) values ($1, '공유 테스트 복싱짐', '{boxing}', '서울시 마포구 1', '서울 마포구') returning id`, [A.id]))).rows[0].id;
await sb.asUser(A.id, (q) => q(`select public.review_gym_listing($1, 'approved', '')`, [gymId]));
const gearId = (await sb.asUser(A.id, (q) => q(`insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, region) values ($1, $2, '16온스 글러브', 'boxing_gloves', 'good', 45000, '서울') returning id`, [A.id, A.nickname]))).rows[0].id;
const clanId = (await sb.sql(`insert into public.clans (name, slug, owner_id) values ('공유 클랜', 'share-clan', $1) returning id`, [B.id])).rows[0].id;
await sb.sql(`insert into public.clan_members (clan_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`, [clanId, B.id]);

process.env.VITE_SUPABASE_URL = sb.url;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-test-anon-key';
const vite = await createServer({ root: APP, configFile: path.join(APP, 'vite.config.ts'), server: { port: 5197, strictPort: true, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
await vite.listen();
const BASE = 'http://127.0.0.1:5197/#';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });
const errors = [];
async function ctxFor(user) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
  await ctx.route((url) => !/^(http:\/\/(127\.0\.0\.1:5197|localhost:54397)|data:|blob:)/.test(url.href), (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ['sb-localhost-auth-token', JSON.stringify(sb.session(user))]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${user.nickname}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const go = async (page, hash) => {
  if (page.url() === `${BASE}${hash}`) await page.reload(); else await page.goto(`${BASE}${hash}`);
  await page.waitForTimeout(1200);
  const modal = page.locator('.modal-overlay').filter({ hasText: '기존 데이터를 계정에 저장할까요' });
  if (await modal.count()) { await modal.locator('.btn-ghost').first().click(); await page.waitForTimeout(300); }
};
const feed = async (page) => {
  await go(page, '/community');
  await page.locator('.community-tab-switcher').getByRole('button', { name: '게시물' }).click();
  await page.waitForTimeout(1200);
};
const shot = (page, n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
const card = (page, text) => page.locator('.community-post-card').filter({ hasText: text }).first();
// the sheet must be the top-most thing at its own centre (not hidden behind the shorts layer etc.)
const sheetOnTop = (page) => page.evaluate(() => {
  const p = [...document.querySelectorAll('.modal-panel')].pop();
  if (!p) return false;
  const r = p.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
  return !!hit && p.contains(hit);
});
const lastMessage = async (table = 'messages') => (await sb.sql(`select attachment, body from public.${table} order by created_at desc limit 1`)).rows[0];

try {
  const a = await ctxFor(A), b = await ctxFor(B), c = await ctxFor(C);

  console.log('\n[E] 게시물·숏폼 기술 평가 버튼');
  await feed(b.page);
  const bCard = card(b.page, '훅 드릴');
  check('E1 남의 영상 게시물에 평가 버튼이 보인다', await bCard.getByTestId('post-evaluate').count() === 1);
  await bCard.getByTestId('post-evaluate').click();
  await b.page.waitForTimeout(400);
  check('E2 평가가 안 열린 게시물 → 작성자 동의 안내', await b.page.getByText('작성자가 이 영상에 기술 평가를 열지 않았습니다').count() === 1);
  await b.page.getByRole('button', { name: '확인' }).click();

  await feed(a.page);
  const aCard = card(a.page, '잽 연습 영상');
  check('E3 내 영상 게시물에는 "평가 열기"', (await aCard.getByTestId('post-evaluate').innerText()).includes('평가 열기'));
  await aCard.getByTestId('post-evaluate').click();
  await a.page.waitForTimeout(400);
  await a.page.getByTestId('eval-technique-name').fill('잽');
  await shot(a.page, 'e-start-sheet');
  await a.page.getByTestId('eval-start-submit').click();
  await a.page.waitForTimeout(1200);
  const ev = (await sb.sql(`select technique_name, criteria, author_id from public.technique_evaluations where post_id = 'pv1'`)).rows[0];
  check('E4 올린 뒤에 평가 열기 → technique_evaluations 생성', ev?.technique_name === '잽' && ev?.author_id === A.id, ev);
  check('E5 카드가 바로 평가 미리보기로 바뀜', await card(a.page, '잽 연습 영상').getByTestId('eval-preview').count() === 1);

  await feed(b.page);
  await card(b.page, '잽 연습 영상').getByTestId('post-evaluate').click();
  await b.page.waitForTimeout(800);
  check('E6 다른 사용자: 평가 버튼 → 평가 시트(투표) 열림', await b.page.locator('.eval-sheet').count() === 1 && await sheetOnTop(b.page));
  await b.page.locator('.eval-sheet').getByRole('button', { name: '닫기' }).click();

  await go(b.page, '/shorts');
  await b.page.waitForTimeout(800);
  const short = b.page.locator('[data-testid="short"][data-active="true"]');
  check('E7 숏폼 레일에 평가·공유 버튼', await short.getByTestId('short-evaluate').count() === 1 && await short.getByTestId('share-button').count() === 1);
  await short.getByTestId('short-evaluate').click();
  await b.page.waitForTimeout(800);
  check('E8 숏폼에서 연 시트가 영상 위에 보인다(가려지지 않음)', await sheetOnTop(b.page));
  await shot(b.page, 'e-shorts-sheet');
  await b.page.keyboard.press('Escape');
  await feed(b.page);

  console.log('\n[S] 종이비행기 공유');
  // 게시물 → 사용자 검색 → C 에게 DM
  await card(b.page, '훅 드릴').getByTestId('share-button').click();
  await b.page.waitForTimeout(500);
  check('S1 공유 시트 열림 + 종이비행기 아이콘', await b.page.locator('.mx-share .mx-plane').count() >= 1 && await sheetOnTop(b.page));
  await b.page.getByTestId('share-note').fill('이거 봐');
  await b.page.getByTestId('share-search').fill('친구');
  await b.page.waitForTimeout(800);
  await b.page.locator('.mx-share__row').filter({ hasText: C.nickname }).getByTestId('share-send').click();
  await b.page.waitForTimeout(1200);
  let m = await lastMessage();
  check('S2 게시물 → DM 첨부(post) + 메시지', m?.attachment?.kind === 'post' && m.attachment.id === 'pv2' && m.body === '이거 봐', m);
  check('S3 버튼이 "보냄"으로 바뀜', (await b.page.locator('.mx-share__row').filter({ hasText: C.nickname }).getByTestId('share-send').innerText()).includes('보냄'));
  await shot(b.page, 's-sheet');
  await b.page.locator('.mx-share').getByRole('button', { name: '닫기' }).click();

  // 숏폼 → 최근 대화
  await go(b.page, '/shorts');
  await b.page.locator('[data-testid="short"][data-active="true"]').getByTestId('share-button').click();
  await b.page.waitForTimeout(800);
  await b.page.getByTestId('share-conv').first().getByTestId('share-send').click();
  await b.page.waitForTimeout(1000);
  m = await lastMessage();
  check('S4 숏폼 → 최근 대화로 공유(post)', m?.attachment?.kind === 'post', m);
  await b.page.keyboard.press('Escape');

  // 체육관 (0060 새 종류)
  await go(b.page, `/gyms/${gymId}`);
  await b.page.getByTestId('share-button').click();
  await b.page.waitForTimeout(800);
  await b.page.getByTestId('share-conv').first().getByTestId('share-send').click();
  await b.page.waitForTimeout(1000);
  m = await lastMessage();
  check('S5 체육관 → DM (gym)', m?.attachment?.kind === 'gym' && m.attachment.id === gymId, m);
  // 클랜 채팅으로도
  await b.page.getByTestId('share-clan').first().getByTestId('share-send').click();
  await b.page.waitForTimeout(1000);
  m = await lastMessage('clan_messages');
  check('S6 체육관 → 클랜 채팅 (gym)', m?.attachment?.kind === 'gym', m);

  // 중고 장비 → 클랜 (0060 이전엔 클랜에서 거절되던 종류)
  await go(b.page, `/gear/${gearId}`);
  await b.page.getByTestId('share-button').click();
  await b.page.waitForTimeout(800);
  await b.page.getByTestId('share-clan').first().getByTestId('share-send').click();
  await b.page.waitForTimeout(1000);
  m = await lastMessage('clan_messages');
  check('S7 중고 장비 → 클랜 채팅 (gear)', m?.attachment?.kind === 'gear' && m.attachment.price === 45000, m);
  await b.page.getByTestId('share-conv').first().getByTestId('share-send').click();
  await b.page.waitForTimeout(1000);
  check('S8 중고 장비 → DM (gear)', (await lastMessage())?.attachment?.kind === 'gear');

  // 커리큘럼 → 공유 코드 첨부
  await go(b.page, '/learning/boxing/official__boxing');
  await b.page.getByTestId('share-button').click();
  await b.page.waitForTimeout(800);
  await b.page.getByTestId('share-conv').first().getByTestId('share-send').click();
  await b.page.waitForTimeout(1000);
  m = await lastMessage();
  check('S9 커리큘럼 → DM (curriculum + 공유 코드)', m?.attachment?.kind === 'curriculum' && m.attachment.shareCode?.length > 20, m?.attachment?.kind);

  // 받는 사람: 대화방의 카드 → 원본 화면
  const conv = (await sb.sql(`select conversation_id from public.messages order by created_at desc limit 1`)).rows[0].conversation_id;
  await go(c.page, `/messages/${conv}`);
  const cards = c.page.locator('.attach-card');
  await cards.nth(4).waitFor({ timeout: 10000 }).catch(() => {});
  check('S10 받는 사람 대화방에 공유 카드들', await cards.count() >= 5, await cards.count());
  await shot(c.page, 's-received');
  await c.page.locator('.attach-card').filter({ hasText: '공유 테스트 복싱짐' }).locator('.attach-card__main').click();
  await c.page.waitForTimeout(1200);
  check('S11 체육관 카드 → 체육관 상세로 이동', c.page.url().includes(`/gyms/${gymId}`) && await c.page.getByText('공유 테스트 복싱짐').count() > 0);
  const preview = (await sb.sql(`select last_message_preview from public.conversations where id = $1`, [conv])).rows[0];
  check('S12 대화 목록 미리보기 문구', typeof preview?.last_message_preview === 'string' && preview.last_message_preview.length > 0, preview);

  await b.page.setViewportSize({ width: 320, height: 640 });
  await feed(b.page);
  const over = await b.page.evaluate(() => [...document.querySelectorAll('.community-post-card__actions')].map((r) => {
    const box = r.getBoundingClientRect();
    return [...r.children].some((ch) => { const c = ch.getBoundingClientRect(); return c.right > box.right + 1 || c.left < box.left - 1; });
  }));
  check('S13 320px 화면: 액션 줄(평가·공유 포함)이 카드 밖으로 넘치지 않음', over.length > 0 && over.every((x) => !x), over);
  await shot(b.page, 's-320-card');
  check('런타임 오류 없음', errors.length === 0, errors.slice(0, 3));
} finally {
  await browser.close();
  await vite.close();
  await sb.close?.();
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
