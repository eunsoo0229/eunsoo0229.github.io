// 수익화 E2E — 실제 앱 화면(헤드리스 Chrome)을 로컬 테스트 백엔드(PGlite + 전체 마이그레이션 + 실제 RLS)에 붙여
// 사용자처럼 조작한다. 운영 Supabase·Toss·Gemini 는 호출하지 않는다(외부 요청 전부 차단).
// 결제는 하네스의 payment-verify 스텁(Toss 테스트 승인과 같은 DB 호출)으로 확정된다.
//   PGLITE_DIR=/path/to/node_modules [SHOT_DIR=/dir] node .devtools/qa-monetization-e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { startPgliteSupabase } from './lib/pglite-supabase.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOT_DIR ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!process.env.PGLITE_DIR) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
const U = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const users = [
  { id: U(1), email: 'creator@test.local', password: 'pw', nickname: '코치K' },
  { id: U(2), email: 'buyer@test.local', password: 'pw', nickname: '구매자' },
  { id: U(3), email: 'admin@test.local', password: 'pw', nickname: '운영자' },
  { id: U(4), email: 'dev@test.local', password: 'pw', nickname: '개발자' },
  { id: U(5), email: 'owner@test.local', password: 'pw', nickname: '관장' },
];
const [CREATOR, BUYER, ADMIN, DEV, OWNER] = users;

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d !== undefined ? ' :: ' + JSON.stringify(d).slice(0, 300) : ''}`); } };

const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54398, users, appDir: APP, log: !!process.env.DB_LOG });
const mine = sb.failedMigrations.filter((m) => /^006[1-9]_/.test(m));
check('수익화 마이그레이션 0061–0064 적용', mine.length === 0, mine);
await sb.sql(`insert into public.platform_admins (user_id) values ($1)`, [ADMIN.id]);
// 하네스는 사용자를 마이그레이션 뒤에 만든다 → 운영자·개발자 지정(0061 seed)을 같은 방식으로 재현
await sb.sql(`insert into public.privileged_accounts (user_id, label) values ($1, 'developer')`, [DEV.id]);
await sb.sql(`insert into public.gyms (id, name, owner_user_id, join_code) values ('gym-e2e', 'E2E 복싱', $1, 'E2EJOIN')`, [OWNER.id]);

process.env.VITE_SUPABASE_URL = sb.url;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-test-anon-key';
process.env.VITE_TOSS_CLIENT_KEY = ''; // Toss 위젯 대신 서버 테스트 승인 경로 (외부 결제창은 테스트 환경에서 열 수 없음)
const vite = await createServer({ root: APP, configFile: path.join(APP, 'vite.config.ts'), server: { port: 5198, strictPort: true, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
await vite.listen();
const BASE = 'http://127.0.0.1:5198/#';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
const pageErrors = [];
async function ctxFor(user, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, bypassCSP: true });
  await ctx.route((url) => !/^(http:\/\/(127\.0\.0\.1:5198|localhost:54398)|data:|blob:)/.test(url.href), (r) => r.abort());
  if (user) {
    const s = sb.session(user);
    await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ['sb-localhost-auth-token', JSON.stringify(s)]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${user?.nickname ?? 'anon'}: ${e.message}`));
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('테스트 사유입니다') : d.accept()));
  return { ctx, page };
}
const go = async (page, hash) => {
  if (page.url() === `${BASE}${hash}`) await page.reload();
  else await page.goto(`${BASE}${hash}`);
  await page.waitForTimeout(1100);
  const modal = page.locator('.modal-overlay');
  if (await modal.filter({ hasText: '기존 데이터를 계정에 저장할까요' }).count()) {
    await modal.locator('.btn-ghost').first().click();
    await page.waitForTimeout(300);
  }
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const text = (page) => page.locator('body').innerText();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const one = async (q, p = []) => (await sb.sql(q, p)).rows?.[0] ?? (await sb.sql(q, p))[0];
const bal = async (uid) => Number((await one(`select coalesce((select balance from public.wallets where user_id = $1), 0) b`, [uid])).b);

try {
  const anon = await ctxFor(null);
  const buyer = await ctxFor(BUYER);
  const creator = await ctxFor(CREATOR);
  const admin = await ctxFor(ADMIN);
  const dev = await ctxFor(DEV);
  const owner = await ctxFor(OWNER);

  console.log('\n[1] 비로그인');
  await go(anon.page, '/membership');
  check('요금제 비교: FREE/PRO 카드 + 테스트 결제 안내', (await anon.page.getByTestId('plan-free').count()) === 1 && (await anon.page.getByTestId('plan-pro').count()) === 1 && (await anon.page.getByTestId('test-payment-notice').count()) === 1);
  await anon.page.getByTestId('cycle-yearly').click();
  check('FREE 카드: Gemini 코치 하루 5회 / PRO 카드: Gemini 코치 무제한', /Gemini 코치 하루 5회/.test(await anon.page.getByTestId('plan-free').innerText()) && /Gemini 코치 무제한/.test(await anon.page.getByTestId('plan-pro').innerText()));
  check('연간 탭: PRO 99,000원 + 할인 표시', /99,000원/.test(await anon.page.getByTestId('plan-pro').innerText()) && /할인/.test(await anon.page.getByTestId('plan-pro').innerText()));
  await go(anon.page, '/content');
  check('비로그인 콘텐츠 마켓: 오류 없이 빈 목록 (RLS 정책 버그 회귀 확인)', /아직 없습니다/.test(await text(anon.page)) && !(await anon.page.locator('[role=alert]').count()));

  console.log('\n[2] 지갑 · 출석 · 코인 구매');
  await go(buyer.page, '/wallet');
  check('새 사용자 지갑 0 MC', /보유 코인/.test(await text(buyer.page)) && (await buyer.page.getByTestId('coin-amount').first().innerText()).includes('0'));
  await buyer.page.getByTestId('wallet-checkin').click();
  await buyer.page.waitForTimeout(800);
  await buyer.page.getByTestId('wallet-checkin').click();
  await buyer.page.waitForTimeout(800);
  check('출석 보상 두 번 눌러도 10 MC 1회', (await bal(BUYER.id)) === 10);
  await go(buyer.page, '/wallet/store');
  await buyer.page.getByTestId('checkout-pack-standard').getByTestId('checkout-start').click();
  await buyer.page.waitForTimeout(800);
  check('코인 주문: 서버 금액 5,000원 표시', /5,000원/.test(await buyer.page.getByTestId('checkout-pack-standard').innerText()));
  await buyer.page.getByTestId('checkout-pack-standard').getByTestId('checkout-pay-test').click();
  await buyer.page.waitForTimeout(1200);
  check('코인 구매 확정 → 5,500 MC 지급 (서버 원장)', (await bal(BUYER.id)) === 5510 && /5,500 MC/.test(await buyer.page.getByTestId('store-notice').innerText()));
  await shot(buyer.page, 'coin-store');
  await go(buyer.page, '/wallet/history');
  check('거래 내역: 코인 구매·활동 보상 원장 행', /코인 구매/.test(await text(buyer.page)) && /활동 보상/.test(await text(buyer.page)));

  console.log('\n[3] PRO 구독');
  await go(buyer.page, '/membership');
  await buyer.page.getByTestId('checkout-plan-pro').getByTestId('checkout-start').click();
  await buyer.page.waitForTimeout(800);
  await buyer.page.getByTestId('checkout-plan-pro').getByTestId('checkout-pay-test').click();
  await buyer.page.waitForTimeout(1500);
  check('구독 후 내 요금제 PRO', (await buyer.page.getByTestId('membership-plan').innerText()).includes('PRO'));
  check('결제 내역에 9,900원 결제 완료(테스트)', /9,900원/.test(await buyer.page.getByTestId('membership-payments').innerText()) && /결제 완료 \(테스트\)/.test(await buyer.page.getByTestId('membership-payments').innerText()));
  await buyer.page.getByTestId('membership-payments').getByRole('button', { name: '보기' }).first().click();
  check('영수증 표시', /결제 영수증/.test(await text(buyer.page)));
  await buyer.page.getByTestId('membership-cancel').click();
  await buyer.page.waitForTimeout(800);
  check('해지 예약 → 기간 종료까지 유지 안내', /유지된 뒤 종료/.test(await text(buyer.page)));
  check('서버 권한: 구매자는 PRO 기능 보유', (await one(`select public.has_entitlement($1, 'coach_advanced') x`, [BUYER.id])).x === true);
  await shot(buyer.page, 'membership');

  console.log('\n[4] 창작자 신청 → 승인 → 콘텐츠 등록 → 검수');
  await go(creator.page, '/creator');
  await creator.page.getByTestId('creator-name').fill('코치K');
  await creator.page.getByLabel('소개').fill('복싱 지도 10년');
  await creator.page.getByRole('button', { name: '+ 자격 추가' }).click();
  await creator.page.getByPlaceholder('자격명').fill('생활체육지도자 2급');
  await creator.page.getByTestId('creator-save').click();
  await creator.page.waitForTimeout(1000);
  check('창작자 신청 → 검토 대기', (await creator.page.getByTestId('creator-status').innerText()).includes('검토 대기'));
  await go(admin.page, '/admin/platform?tab=monetization');
  await admin.page.getByTestId('mono-admin-creators').click();
  await admin.page.waitForTimeout(800);
  await admin.page.getByTestId(`creator-row-${CREATOR.id}`).locator('input[type=checkbox]').first().check();
  await admin.page.getByTestId(`creator-approve-${CREATOR.id}`).click();
  await admin.page.waitForTimeout(1000);
  check('관리자 창작자 승인 + 자격 검증 표시', (await one(`select status, jsonb_array_length(verified_credentials) v from public.creator_profiles where user_id = $1`, [CREATOR.id])).v === 1);
  await go(creator.page, '/creator/products/new');
  await creator.page.getByTestId('editor-title').fill('잽 마스터 4주');
  await creator.page.getByTestId('editor-price').fill('1000');
  await creator.page.getByTestId('editor-preview').fill('1주차 맛보기: 잽의 기본 자세');
  await creator.page.getByTestId('section-title-0').fill('잽 기본');
  await creator.page.getByTestId('section-text-0').fill('구매자만 보는 전체 본문입니다.');
  await creator.page.getByTestId('editor-submit').click();
  await creator.page.waitForTimeout(1000);
  check('저작권 확인 없이 검수 요청 → 막힘', /저작권 확인/.test(await creator.page.getByTestId('editor-error').innerText()));
  await creator.page.getByTestId('editor-rights').check();
  await creator.page.getByTestId('editor-submit').click();
  await creator.page.waitForTimeout(1500);
  const prod = await one(`select id, status from public.creator_products where creator_id = $1`, [CREATOR.id]);
  check('콘텐츠 저장 + 검수 대기', prod?.status === 'pending_review', prod);
  await go(buyer.page, `/content/${prod.id}`);
  check('검수 전 콘텐츠는 구매자에게 안 보임', /찾을 수 없거나/.test(await text(buyer.page)));
  await go(admin.page, '/admin/platform?tab=monetization');
  await admin.page.getByTestId('mono-admin-products').click();
  await admin.page.waitForTimeout(800);
  await admin.page.getByTestId(`product-approve-${prod.id}`).click();
  await admin.page.waitForTimeout(1000);
  check('관리자 콘텐츠 승인', (await one(`select status from public.creator_products where id = $1`, [prod.id])).status === 'approved');

  console.log('\n[5] 코인으로 콘텐츠 구매');
  await go(buyer.page, '/content');
  check('마켓 목록에 승인된 콘텐츠', (await buyer.page.getByTestId(`product-${prod.id}`).count()) === 1);
  await go(buyer.page, `/content/${prod.id}`);
  check('구매 전: 미리보기만, 본문 없음', (await buyer.page.getByTestId('product-preview').count()) === 1 && (await buyer.page.getByTestId('product-full-content').count()) === 0);
  check('창작자 자격: 운영자 검증 / 본인 입력 구분 표시', /운영자 검증/.test(await buyer.page.getByTestId('creator-box').innerText()) && /본인 입력/.test(await buyer.page.getByTestId('creator-box').innerText()));
  await buyer.page.getByTestId('buy-product').click();
  await buyer.page.waitForTimeout(1500);
  check('구매 후 본문 열람 + 구매 완료 표시', (await buyer.page.getByTestId('product-full-content').count()) === 1 && /구매자만 보는 전체 본문/.test(await text(buyer.page)) && (await buyer.page.getByTestId('owned-badge').count()) === 1);
  check('잔액 5,510 → 4,510', (await bal(BUYER.id)) === 4510);
  const pu = await one(`select * from public.content_purchases where buyer_id = $1`, [BUYER.id]);
  check('수수료 15% (150) / 창작자 850 서버 계산', pu.platform_fee_coins === 150 && pu.creator_earning_coins === 850);
  await buyer.page.getByTestId('review-form').locator('textarea').fill('설명이 친절해요');
  await buyer.page.getByTestId('review-form').getByRole('button', { name: '후기 등록' }).click();
  await buyer.page.waitForTimeout(1000);
  check('구매자 후기 등록', /설명이 친절해요/.test(await text(buyer.page)));
  await go(buyer.page, '/library');
  check('내 라이브러리에 추가됨', (await buyer.page.getByTestId(`product-${prod.id}`).count()) === 1);
  await shot(buyer.page, 'library');

  console.log('\n[6] 개발자 계정 = 모든 기능 · 무제한 크레딧');
  await go(dev.page, '/wallet');
  check('지갑: ∞ 무제한 표시', (await dev.page.getByTestId('wallet-card').innerText()).includes('∞'));
  await go(dev.page, '/membership');
  check('멤버십: 운영자·개발자 계정 · 모든 기능', (await dev.page.getByTestId('membership-privileged').count()) === 1);
  await go(dev.page, `/content/${prod.id}`);
  check('구매 전에도 본문 열람 (모든 기능)', (await dev.page.getByTestId('product-full-content').count()) === 1);
  await dev.page.getByTestId('buy-product').click();
  await dev.page.waitForTimeout(1200);
  check('무제한 계정 구매: 코인 0 유지, 창작자 수익 미발생', (await bal(DEV.id)) === 0 && (await one(`select privileged_comp p from public.content_purchases where buyer_id = $1`, [DEV.id])).p === true);
  await go(dev.page, '/business');
  check('개발자 계정 사업자 화면 접근(체육관 없음 안내)', /관장으로 등록된 체육관이 없습니다/.test(await text(dev.page)));

  console.log('\n[7] 환불 요청 → 관리자 승인');
  await go(buyer.page, `/content/${prod.id}`);
  await buyer.page.getByTestId('refund-request').click();
  await buyer.page.waitForTimeout(1000);
  check('환불 요청 접수', /환불 요청이 접수/.test(await buyer.page.getByTestId('content-notice').innerText()));
  await go(admin.page, '/admin/platform?tab=monetization');
  await admin.page.getByTestId('mono-admin-refunds').click();
  await admin.page.waitForTimeout(800);
  await admin.page.getByTestId(`refund-approve-${pu.id}`).click();
  await admin.page.waitForTimeout(1200);
  check('환불 승인 → 1,000 MC 반환', (await bal(BUYER.id)) === 5510);
  await go(buyer.page, `/content/${prod.id}`);
  check('환불 후 본문 열람 불가', (await buyer.page.getByTestId('product-full-content').count()) === 0 && (await buyer.page.getByTestId('product-preview').count()) === 1);

  console.log('\n[8] 창작자 수익 화면');
  await go(creator.page, '/creator/revenue');
  check('현금 출금 비활성 안내 + 지표', (await creator.page.getByTestId('payout-disabled-notice').count()) === 1 && (await creator.page.getByTestId('revenue-metrics').count()) === 1);
  check('출금(현금) 버튼 없음 — 정산은 시뮬레이션 문구', !/출금하기/.test(await text(creator.page)) && /시뮬레이션/.test(await creator.page.getByTestId('request-settlement').innerText()));
  await shot(creator.page, 'creator-revenue');

  console.log('\n[9] 체육관 사업자 요금제 (기존 체육관 연결)');
  await go(owner.page, '/business');
  await owner.page.waitForTimeout(800);
  check('요금제 전: 사업자 리포트 잠김 (서버가 거부)', /사업자 요금제/.test(await owner.page.getByTestId('business-report').innerText()) && !/전체 회원/.test(await owner.page.getByTestId('business-report').innerText()));
  await owner.page.getByTestId('business-checkout-monthly').getByTestId('checkout-start').click();
  await owner.page.waitForTimeout(800);
  await owner.page.getByTestId('business-checkout-monthly').getByTestId('checkout-pay-test').click();
  await owner.page.waitForTimeout(1500);
  check('사업자 구독 후 리포트 표시', /전체 회원/.test(await owner.page.getByTestId('business-report').innerText()));
  await go(owner.page, '/gym/admin/gym-e2e');
  check('기존 체육관 운영 화면에 사업자 요금제 연결', (await owner.page.getByTestId('gym-business-link').count()) === 1);

  console.log('\n[10] 관리자 수익 분석 · 무결성 · 가격 변경');
  await go(admin.page, '/admin/platform?tab=monetization');
  const ov = await admin.page.getByTestId('mono-overview').innerText();
  check('수익 분석: 구독(개인 9,900 / 사업자 49,000) · 코인 충전 5,000 구분', /9,900원/.test(ov) && /49,000원/.test(ov) && /5,000원/.test(ov) && /전부 테스트 결제/.test(ov));
  await admin.page.getByTestId('mono-admin-wallets').click();
  await admin.page.waitForTimeout(1000);
  check('원장 무결성 점검: 이상 없음', (await admin.page.getByTestId('integrity-ok').count()) === 1);
  await admin.page.getByTestId('mono-admin-settings').click();
  await admin.page.waitForTimeout(1000);
  await admin.page.getByTestId('plan-pro-monthly').fill('12900');
  await admin.page.getByTestId('plan-pro-save').click();
  await admin.page.waitForTimeout(800);
  await go(anon.page, '/membership');
  check('관리자 가격 변경 → 요금제 화면 즉시 반영 (12,900원)', /12,900원/.test(await anon.page.getByTestId('plan-pro').innerText()));
  await go(buyer.page, '/admin/platform?tab=monetization');
  check('일반 사용자는 관리자 수익화 화면 불가', (await buyer.page.getByTestId('monetization-admin').count()) === 0);

  console.log('\n[11] 모바일 레이아웃');
  const mob = await ctxFor(BUYER, { width: 390, height: 844 });
  for (const r of ['/membership', '/wallet', '/wallet/store', '/content', `/content/${prod.id}`, '/library', '/creator']) {
    await go(mob.page, r);
    check(`모바일 ${r} 가로 스크롤 없음`, await noHScroll(mob.page));
  }
  await shot(mob.page, 'mobile-content');
  check('페이지 런타임 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 3));
} catch (e) {
  check('E2E 실행 중 예외 없음', false, e.message);
} finally {
  await browser.close();
  await vite.close();
  await sb.close();
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
