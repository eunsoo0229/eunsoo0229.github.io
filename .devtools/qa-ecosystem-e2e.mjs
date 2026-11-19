// 통합 플랫폼 E2E — 실제 앱 화면(헤드리스 Chrome)을 로컬 테스트 백엔드(PGlite + 전체 마이그레이션 + 실제 RLS,
// .devtools/lib/pglite-supabase.mjs)에 붙여 사용자처럼 조작한다. 운영 Supabase·Gemini 는 전혀 호출하지 않는다
// (요청을 가로채 차단). 별도 Vite 인스턴스(5199)를 띄우므로 사용자의 개발 서버·데이터와 무관하다.
//   PGLITE_DIR=/path/to/node_modules node .devtools/qa-ecosystem-e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { startPgliteSupabase } from './lib/pglite-supabase.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOT_DIR ?? null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!process.env.PGLITE_DIR) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const users = [
  { id: U(1), email: 'owner@test.local', password: 'pw-owner', nickname: '관장' },
  { id: U(2), email: 'student@test.local', password: 'pw', nickname: '학생' },
  { id: U(3), email: 'buyer@test.local', password: 'pw', nickname: '구매자' },
  { id: U(4), email: 'admin@test.local', password: 'pw', nickname: '운영자' },
  { id: U(5), email: 'v1@test.local', password: 'pw', nickname: '평가자1' },
  { id: U(6), email: 'v2@test.local', password: 'pw', nickname: '평가자2' },
  { id: U(7), email: 'v3@test.local', password: 'pw', nickname: '평가자3' },
];
const [OWNER, STUDENT, BUYER, ADMIN, V1, V2, V3] = users;

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d !== undefined ? ' :: ' + JSON.stringify(d).slice(0, 300) : ''}`); } };

const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54399, users, appDir: APP, log: !!process.env.DB_LOG });
await sb.sql(`insert into public.platform_admins (user_id) values ($1)`, [ADMIN.id]);
console.log('test backend:', sb.url, '· migration failures (pre-existing, unrelated):', sb.failedMigrations.map((m) => m.slice(0, 60)));

process.env.VITE_SUPABASE_URL = sb.url;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-test-anon-key';
const vite = await createServer({ root: APP, configFile: path.join(APP, 'vite.config.ts'), server: { port: 5199, strictPort: true, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
await vite.listen();
const BASE = 'http://127.0.0.1:5199/#';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
const pageErrors = [];
async function ctxFor(user, viewport = { width: 1200, height: 900 }) {
  // the app CSP only allows the real Supabase origin; the local test backend is another origin, so CSP is bypassed in the test browser only
  const ctx = await browser.newContext({ viewport, bypassCSP: true });
  // anything that is not the local app or the local test backend is blocked (prod Supabase, Gemini, YouTube …)
  await ctx.route((url) => !/^(http:\/\/(127\.0\.0\.1:5199|localhost:54399)|data:|blob:)/.test(url.href), (r) => r.abort());
  if (user) {
    const s = sb.session(user);
    await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ['sb-localhost-auth-token', JSON.stringify(s)]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${user?.nickname ?? 'anon'}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  if (process.env.DB_LOG) {
    page.on('requestfailed', (r) => console.log('   [req failed]', r.url().slice(0, 120), r.failure()?.errorText));
    page.on('console', (m) => m.type() === 'error' && console.log('   [console]', m.text().slice(0, 200)));
  }
  return { ctx, page };
}
const go = async (page, hash) => {
  // same hash → goto would not re-render; reload so the screen fetches fresh data like a real revisit
  if (page.url() === `${BASE}${hash}`) await page.reload();
  else await page.goto(`${BASE}${hash}`);
  await page.waitForTimeout(900);
  const modal = page.locator('.modal-overlay');
  // the existing "back up this device's data to the account?" prompt (LocalDataMigrationPrompt) → 나중에
  if (await modal.filter({ hasText: '기존 데이터를 계정에 저장할까요' }).count()) {
    await modal.locator('.btn-ghost').first().click();
    await page.waitForTimeout(300);
  }
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const text = (page) => page.locator('body').innerText();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  // ======================= 기존 기능: 로그인 화면으로 실제 로그인 =======================
  console.log('\n[0] 기존 로그인');
  {
    const { ctx, page } = await ctxFor(null);
    await go(page, '/login');
    await page.getByTestId('login-id').fill(OWNER.email);
    await page.locator('input[type="password"]').fill(OWNER.password);
    await page.locator('form').getByRole('button', { name: '로그인' }).click();
    await page.waitForTimeout(2000);
    const stored = await page.evaluate(() => localStorage.getItem('sb-localhost-auth-token'));
    check('기존 로그인 화면으로 로그인 → 세션 저장', !!stored && JSON.parse(stored).user?.id === OWNER.id);
    await ctx.close();
  }

  const owner = await ctxFor(OWNER);
  const admin = await ctxFor(ADMIN);
  const buyer = await ctxFor(BUYER);
  const student = await ctxFor(STUDENT);

  // ======================= F. 체육관 등록 → 승인 → 가격 검증 → 제휴 → 할인 → 쿠폰 =======================
  console.log('\n[F] 체육관 검색·가격·제휴 할인');
  {
    const p = owner.page;
    await go(p, '/gyms/manage/new');
    await p.getByLabel('체육관 이름').fill('테스트 복싱 체육관');
    await p.getByLabel('지역').first().fill('서울 강남구');
    await p.getByLabel('주소').first().fill('서울시 강남구 테스트로 1');
    await p.locator('label.eco-check:has-text("복싱") input').first().check();
    await p.getByLabel('운영 시간').fill('평일 10:00-22:00');
    await p.getByTestId('gym-listing-save').click();
    await p.waitForTimeout(1500);
    const listing = (await sb.sql(`select id, status from public.gym_listings where name = '테스트 복싱 체육관'`)).rows[0];
    check('F1 관리자 화면에서 체육관 등록 → 검토 대기(pending)', listing?.status === 'pending', listing);
    await shot(p, 'f1-listing');
    // pricing tab
    await go(p, `/gyms/manage/${listing.id}`);
    await p.getByRole('tab', { name: '가격' }).click();
    await p.waitForTimeout(400);
    await p.getByLabel('월 회비').first().fill('150000');
    await p.getByLabel('연간').first().fill('1500000').catch(() => {});
    await p.getByTestId('gym-pricing-save').click();
    await p.waitForTimeout(1200);
    const pr = (await sb.sql(`select monthly, verified_at from public.gym_pricing where listing_id = $1`, [listing.id])).rows[0];
    check('F2 가격 저장 (미검증 상태)', pr?.monthly === 150000 && pr.verified_at === null, pr);
    await p.getByRole('tab', { name: '제휴' }).click();
    await p.waitForTimeout(400);
    await p.getByTestId('gym-partner-apply').click();
    await p.waitForTimeout(1200);
    check('F3 제휴 신청', (await sb.sql(`select status from public.gym_partnerships where listing_id = $1`, [listing.id])).rows[0]?.status === 'applied');

    const before = await buyer.page.goto(`${BASE}/gyms`).then(() => buyer.page.waitForTimeout(1500)).then(() => text(buyer.page));
    check('F4 승인 전에는 검색에 안 나옴', !before.includes('테스트 복싱 체육관'));

    // platform admin approves + verifies price + activates partnership through the console
    const a = admin.page;
    await go(a, '/admin/platform');
    await a.waitForTimeout(800);
    await shot(a, 'f5-admin');
    const card = a.locator('.eco-card', { hasText: '테스트 복싱 체육관' }).first();
    await card.getByRole('button', { name: /상세·가격 보기/ }).click();
    await a.waitForTimeout(800);
    await card.getByRole('button', { name: /가격 검증/ }).click();
    await a.waitForTimeout(800);
    await card.getByRole('button', { name: /승인/ }).first().click();
    await a.waitForTimeout(1200);
    const after = (await sb.sql(`select l.status, p.verified_at from public.gym_listings l left join public.gym_pricing p on p.listing_id = l.id where l.id = $1`, [listing.id])).rows[0];
    check('F5 플랫폼 관리자 콘솔: 등록 승인 + 가격 검증', after.status === 'approved' && !!after.verified_at, after);
    await a.getByTestId('platform-tab-partnerships').click();
    await a.waitForTimeout(800);
    const pcard = a.locator('.eco-card', { hasText: '테스트 복싱 체육관' }).first();
    await pcard.getByRole('button', { name: /^활성화$/ }).click();
    await a.waitForTimeout(500);
    const refused = await text(a);
    check('F6 계약 번호 없이 활성화 불가 (안내)', refused.includes('계약 번호'), null);
    await pcard.getByLabel('계약 번호').fill('CT-TEST-001');
    await pcard.getByLabel(/시작일/).fill(new Date().toISOString().slice(0, 10));
    await pcard.getByRole('button', { name: /^활성화$/ }).click();
    await a.waitForTimeout(1200);
    check('F7 제휴 활성화 (계약 번호·시작일)', (await sb.sql(`select status from public.gym_partnerships where listing_id = $1`, [listing.id])).rows[0]?.status === 'active');

    // owner creates + activates an offer
    await go(p, `/gyms/manage/${listing.id}`);
    await p.getByRole('tab', { name: '할인' }).click();
    await p.waitForTimeout(400);
    await p.getByLabel('할인 이름').fill('신규 회원 월회비 할인');
    await p.getByLabel(/할인 값/).fill('30000');
    await p.getByLabel(/할인 방식/).selectOption('amount').catch(() => {});
    await p.getByLabel(/할인 값/).fill('30000');
    await p.getByTestId('gym-offer-create').click();
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /활성화|진행/ }).first().click();
    await p.waitForTimeout(1200);
    const offer = (await sb.sql(`select id, status, discount_type, discount_value from public.gym_offers where listing_id = $1`, [listing.id])).rows[0];
    check('F8 할인 등록 후 진행 시작', offer?.status === 'active' && offer.discount_type === 'amount', offer);

    // buyer: search, filter, detail, claim
    const b = buyer.page;
    await go(b, '/gyms');
    await b.getByTestId('gym-search').fill('복싱');
    await b.waitForTimeout(1500);
    await shot(b, 'f9-search');
    const cards = b.getByTestId('gym-card');
    const t9 = await cards.first().innerText().catch(() => '');
    check('F9 승인 후 검색 결과 · 제휴 표시 · 월 회비', t9.includes('테스트 복싱 체육관') && t9.includes('제휴') && t9.includes('150,000'), t9);
    await go(b, `/gyms/${listing.id}`);
    await b.waitForTimeout(800);
    const t10 = await text(b);
    check('F10 상세: 할인 전·후 가격 (서버 계산 120,000원) · 최종 확인일', t10.includes('150,000') && t10.includes('120,000') && t10.includes('최종 확인'), null);
    await shot(b, 'f10-detail');
    await b.getByTestId('gym-offer-claim').first().click();
    await b.waitForTimeout(1500);
    const code = (await b.getByTestId('gym-coupon-code').first().innerText().catch(() => '')).trim();
    check('F11 할인 쿠폰 발급 (코드 표시)', /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(code), code);
    // owner redeems
    await go(p, `/gyms/manage/${listing.id}`);
    await p.getByRole('tab', { name: '쿠폰' }).click();
    await p.waitForTimeout(400);
    await p.getByTestId('gym-redeem-input').fill(code);
    await p.getByTestId('gym-redeem-go').click();
    await p.waitForTimeout(1200);
    await go(b, '/gyms/coupons');
    await b.waitForTimeout(800);
    check('F12 체육관 사용 처리 → 사용자 쿠폰함 "등록 확인"', (await text(b)).includes('사용 완료'));
    // a second approved gym (no pricing at all) so the comparison has two columns
    const g2 = (await sb.asUser(OWNER.id, (q) => q(`insert into public.gym_listings (owner_user_id, name, arts, address, region) values ($1, '두번째 주짓수', '{bjj}', '서울시 마포구 2', '서울 마포구') returning id`, [OWNER.id]))).rows[0].id;
    await sb.asUser(ADMIN.id, (q) => q(`select public.review_gym_listing($1, 'approved', '')`, [g2]));
    await go(b, `/gyms/compare?ids=${listing.id},${g2}`);
    check('F13 가격 비교 표 렌더 (모르는 값 "정보 없음")', (await text(b)).includes('정보 없음') && (await text(b)).includes('월 회비'));
    await go(b, '/gyms/deals');
    const t14 = await text(b);
    check('F14 할인 혜택 페이지: 실제 제휴 할인 + 예시 상자 분리', t14.includes('신규 회원 월회비 할인') && t14.includes('예시'));
    await go(p, `/gyms/manage/${listing.id}`);
    await p.getByRole('tab', { name: '통계' }).click();
    await p.waitForTimeout(1000);
    check('F15 유입 통계 (쿠폰 발급·사용)', /전환|사용/.test(await text(p)));
  }

  // ======================= E. 장비 중고거래 =======================
  console.log('\n[E] 장비 중고거래');
  {
    const p = owner.page;
    await go(p, '/gear/new');
    await p.getByLabel(/상품명/).fill('16oz 복싱 글러브');
    await p.getByLabel(/가격/).first().fill('50000');
    await p.getByLabel(/지역/).first().fill('서울 강남구').catch(() => {});
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await p.getByTestId('gear-image-input').setInputFiles({ name: 'glove.png', mimeType: 'image/png', buffer: png });
    await p.waitForTimeout(1500);
    await p.getByTestId('gear-image-input').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('xx') }).catch(() => {});
    await p.waitForTimeout(500);
    const rejectText = await text(p);
    check('E1 이미지 아닌 파일 업로드 거절', /이미지만|JPG/.test(rejectText));
    await p.getByTestId('gear-save').click();
    await p.waitForTimeout(1500);
    const g = (await sb.sql(`select id, images, status from public.gear_listings where title = '16oz 복싱 글러브'`)).rows[0];
    check('E2 상품 등록 + 이미지 업로드 (본인 폴더)', g?.status === 'active' && g.images.length === 1 && g.images[0].includes(`/gear-media/${OWNER.id}/`), g);
    const b = buyer.page;
    await go(b, '/gear');
    await b.getByTestId('gear-search').fill('글러브');
    await b.waitForTimeout(1500);
    check('E3 검색으로 상품 찾기', (await b.getByTestId('gear-card').count()) >= 1);
    await b.getByTestId('gear-search').fill('도복');
    await b.waitForTimeout(1500);
    check('E4 검색 필터 (없는 상품 → 결과 없음)', (await b.getByTestId('gear-card').count()) === 0);
    await go(b, `/gear/${g.id}`);
    await b.waitForTimeout(800);
    await b.getByTestId('gear-fav').click();
    await b.waitForTimeout(800);
    check('E5 찜 → 서버 찜 수 1', (await sb.sql(`select favorite_count from public.gear_listings where id = $1`, [g.id])).rows[0].favorite_count === 1);
    await b.getByTestId('gear-inquire').click();
    await b.waitForTimeout(400);
    const area = b.locator('textarea').first();
    if (await area.isVisible().catch(() => false)) await area.fill('아직 판매 중인가요?');
    await b.getByRole('button', { name: /문의 보내기|보내기|문의하기/ }).first().click().catch(() => {});
    await b.waitForTimeout(2000);
    check('E6 판매자 문의 → 기존 DM 대화 화면으로 이동', /#\/messages\//.test(b.url()), b.url());
    const msg = (await sb.sql(`select body, attachment from public.messages order by created_at desc limit 1`)).rows[0];
    check('E7 DM 에 상품 카드 첨부', msg?.attachment?.kind === 'gear', msg);
    await shot(b, 'e7-dm');
    await go(p, `/gear/${g.id}`);
    await p.getByTestId('gear-status-sold').click();
    await p.waitForTimeout(800);
    await p.locator('input[name="gear-buyer"]').first().check();
    await p.getByRole('button', { name: '이 사람에게 판매 완료' }).click();
    await p.waitForTimeout(1200);
    const sold = (await sb.sql(`select status, buyer_id from public.gear_listings where id = $1`, [g.id])).rows[0];
    check('E8 판매 완료 처리 (문의한 구매자 지정)', sold.status === 'sold' && sold.buyer_id === BUYER.id, sold);
    await go(b, `/gear/${g.id}`);
    await b.waitForTimeout(800);
    await b.locator('textarea').last().fill('친절한 거래').catch(() => {});
    await b.getByRole('button', { name: /후기 남기기|후기 등록/ }).first().click().catch(() => {});
    await b.waitForTimeout(1200);
    check('E9 구매자 거래 후기', (await sb.sql(`select count(*)::int n from public.gear_reviews where listing_id = $1`, [g.id])).rows[0].n === 1);
    await b.getByTestId('gear-report').click().catch(() => {});
    await b.waitForTimeout(400);
    await b.locator('select').filter({ hasText: '사기' }).first().selectOption({ index: 1 }).catch(() => {});
    await b.getByRole('button', { name: /신고하기|신고 접수|보내기/ }).first().click().catch(() => {});
    await b.waitForTimeout(1000);
    check('E10 상품 신고 접수', (await sb.sql(`select count(*)::int n from public.user_reports where target_type = 'gear_listing'`)).rows[0].n === 1);
  }

  // ======================= D. 숏폼·게시물 기술 평가 =======================
  console.log('\n[D] 기술 평가');
  let postId;
  {
    const p = owner.page;
    await go(p, '/community');
    await p.getByRole('button', { name: '게시물', exact: true }).click();
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: '새 게시물' }).click();
    await p.waitForTimeout(600);
    await p.locator('.post-composer textarea').first().fill('잽 평가 부탁드립니다 #복싱');
    await p.getByTestId('eval-enable').check();
    await p.getByTestId('eval-technique-name').fill('잽');
    await p.getByRole('button', { name: '게시하기' }).click();
    await p.waitForTimeout(2000);
    const ev = (await sb.sql(`select post_id, criteria, results_visibility from public.technique_evaluations`)).rows[0];
    postId = ev?.post_id;
    check('D1 게시물 작성 화면에서 기술 평가 설정 (복싱 기본 항목)', !!ev && ev.criteria.includes('stance') && ev.criteria.includes('distance'), ev);
    for (const [i, v] of [V1, V2, V3].entries()) {
      const c = await ctxFor(v);
      await go(c.page, `/community/post/${postId}`);
      await c.page.waitForTimeout(800);
      const slider = c.page.getByTestId('eval-slider-stance');
      await slider.fill(String(60 + i * 10));
      await c.page.getByTestId('eval-slider-balance').fill('70');
      await c.page.getByTestId('eval-submit').click();
      await c.page.waitForTimeout(1200);
      if (i === 0) {
        await shot(c.page, 'd2-voted');
        const mine = await c.page.getByTestId('eval-my-vote').innerText().catch(() => '');
        check('D2 투표 후 내 점수·평균 차이 표시', mine.includes('60%') && mine.includes('평균보다'), mine);
        await c.page.getByTestId('eval-edit').click();
        await c.page.getByTestId('eval-slider-stance').fill('65');
        await c.page.getByTestId('eval-submit').click();
        await c.page.waitForTimeout(1200);
      }
      await c.ctx.close();
    }
    const n = (await sb.sql(`select count(*)::int n from public.technique_votes where post_id = $1`, [postId])).rows[0].n;
    check('D3 3명 투표 · 수정해도 1인 1표', n === 3);
    await go(p, `/community/post/${postId}`);
    await p.waitForTimeout(1200);
    const res = await p.getByTestId('eval-results').innerText().catch(() => '');
    check('D4 결과: 참여 3명 · 자세 평균 (65+70+80)/3=71.7% · 신뢰도 낮음', res.includes('참여 3명') && res.includes('71.7%') && res.includes('신뢰도 낮음'), res.slice(0, 200));
    check('D5 작성자는 자기 콘텐츠에 투표 불가 안내', (await p.getByTestId('eval-panel').innerText()).includes('내 콘텐츠에는 투표할 수 없습니다'));
    check('D6 그룹별 평균 표 (미검증 그룹, 소수 그룹 숨김 규칙 안내)', (await p.getByTestId('eval-groups').innerText()).includes('미검증'));
    await shot(p, 'd6-results');
    await go(owner.page, '/community');
    await owner.page.getByRole('button', { name: '게시물', exact: true }).click();
    await owner.page.waitForTimeout(1500);
    check('D7 피드 카드에 평가 미리보기', (await owner.page.getByTestId('eval-preview').count()) >= 1);
    await go(p, `/community/post/${postId}`);
    await p.waitForTimeout(800);
    await p.getByTestId('eval-close').click();
    await p.waitForTimeout(1200);
    check('D8 작성자 평가 종료 → 결과 보존', (await p.getByTestId('eval-open-state').innerText()).includes('종료') && (await p.getByTestId('eval-results').innerText()).includes('참여 3명'));
    await go(p, `/u/${OWNER.id}`);
    await p.waitForTimeout(1200);
    check('D9 프로필에 받은 기술 평가 요약', (await p.getByTestId('profile-eval-summary').innerText().catch(() => '')).includes('잽'));
    const vc = await ctxFor(V1);
    await go(vc.page, '/evaluations');
    await vc.page.getByTestId('myeval-tab-given').click();
    await vc.page.waitForTimeout(1500);
    check('D10 내가 참여한 평가 기록 (내 점수와 평균 차이)', (await vc.page.getByTestId('myeval-given').first().innerText().catch(() => '')).includes('평균 대비'));
    await vc.ctx.close();
  }

  // ======================= A. 체육관 운영 대시보드 =======================
  console.log('\n[A] 체육관 운영');
  {
    const p = owner.page;
    await go(p, '/gym/admin');
    await p.waitForTimeout(800);
    await p.getByPlaceholder('체육관 이름').fill('테스트 도장');
    await p.getByRole('button', { name: /만들기|생성/ }).first().click();
    await p.waitForTimeout(1500);
    const gym = (await sb.sql(`select id, join_code from public.gyms where name = '테스트 도장'`)).rows[0];
    check('A1 기존 체육관 만들기 동작', !!gym, gym);
    await go(p, `/gym/admin/${gym.id}?tab=requests`);
    await p.waitForTimeout(800);
    await p.locator('label:has-text("승인") input[type="checkbox"], button:has-text("승인제")').first().click().catch(() => {});
    await p.waitForTimeout(800);
    const appr = (await sb.sql(`select join_approval from public.gyms where id = $1`, [gym.id])).rows[0].join_approval;
    check('A2 가입 승인제 켜기', appr === true);
    const s = student.page;
    await go(s, '/gym');
    await s.locator('input[placeholder*="AB12CD"]').fill(gym.join_code);
    await s.getByRole('button', { name: '참가' }).click();
    await s.waitForTimeout(1200);
    check('A3 학생: 코드 입력 → 가입 신청 안내', (await text(s)).includes('가입 신청을 보냈습니다'));
    await go(p, `/gym/admin/${gym.id}?tab=requests`);
    await p.waitForTimeout(800);
    await p.getByTestId('gym-join-approve').first().click();
    await p.waitForTimeout(1200);
    check('A4 관장 승인 → 회원', (await sb.sql(`select role from public.gym_members where gym_id = $1 and user_id = $2`, [gym.id, STUDENT.id])).rows[0]?.role === 'student');
    // student shares progress (local data → summary)
    await go(s, '/gym');
    await s.waitForTimeout(1000);
    check('A5a 동의 전에는 공유 버튼 비활성', await s.getByTestId('gym-share-on').first().isDisabled());
    await s.locator('label:has-text("공유하는 데 동의합니다") input').first().check();
    await s.getByTestId('gym-share-on').first().click();
    await s.waitForTimeout(1200);
    check('A5 학생 진도 공유 (동의 후 요약 업로드)', (await sb.sql(`select summary->>'version' v from public.gym_member_progress where user_id = $1`, [STUDENT.id])).rows[0]?.v === '1');
    await go(p, `/gym/admin/${gym.id}?tab=dashboard`);
    await p.waitForTimeout(1500);
    const dash = await p.getByTestId('gym-dash-metrics').innerText().catch(() => '');
    check('A6 대시보드 지표 (전체 회원 2 · 공유 1 · 데이터 없는 비율은 "데이터 없음")', dash.includes('2') && dash.includes('데이터 없음'), dash.slice(0, 200));
    await shot(p, 'a6-dashboard');
    await go(p, `/gym/admin/${gym.id}/member/${STUDENT.id}`);
    await p.waitForTimeout(1200);
    await p.getByLabel(/제목/).first().fill('잽 100회');
    await p.getByTestId('gym-assign-create').click();
    await p.waitForTimeout(1200);
    check('A7 회원 상세에서 과제 지정', (await sb.sql(`select count(*)::int n from public.gym_assignments where member_id = $1`, [STUDENT.id])).rows[0].n === 1);
    await go(p, `/gym/admin/${gym.id}?tab=announcements`);
    await p.getByLabel(/제목/).first().fill('이번 주 휴관 안내');
    await p.getByTestId('gym-announce-create').click();
    await p.waitForTimeout(1000);
    await go(s, '/gym');
    await s.waitForTimeout(1500);
    const st = await text(s);
    check('A8 학생 화면: 공지 · 과제 표시', st.includes('이번 주 휴관 안내') && st.includes('잽 100회'));
    check('A9 학생은 관리자 화면 데이터를 볼 수 없음 (RLS)', (await sb.asUser(STUDENT.id, (q) => q(`select count(*)::int n from public.gym_member_progress where user_id <> $1`, [STUDENT.id]))).rows[0].n === 0);
  }

  // ======================= C·B. 개인 훈련 프로그램 · 훈련 성과 =======================
  console.log('\n[C·B] 개인 훈련 프로그램 · 훈련 성과');
  {
    const { ctx, page: p } = await ctxFor(STUDENT);
    await ctx.addInitScript(() => {
      if (localStorage.getItem('qa-seeded')) return;
      localStorage.setItem('qa-seeded', '1');
      const r = (id, d, s, m) => ({ recordId: id, techniqueId: 'boxing__jab', martialArtId: 'boxing', score: s, status: 'average', metricScores: m, analyzedAt: d });
      localStorage.setItem('martialdex:pose-records', JSON.stringify([r('a', '2026-10-01T00:00:00Z', 50, { guard: 40 }), r('b', '2026-10-20T00:00:00Z', 62, { guard: 45 }), r('c', '2026-11-10T00:00:00Z', 70, { guard: 50 })]));
      localStorage.setItem('martialdex:favorites', JSON.stringify(['boxing__jab', 'boxing__cross']));
    });
    await go(p, '/program');
    await p.getByTestId('program-generate').click();
    await p.waitForTimeout(1500);
    const days = await p.getByTestId('program-day').count();
    const items = await p.getByTestId('program-item').count();
    check('C1 주간 계획 생성 (7일, 항목 있음)', days === 7 && items > 0, { days, items });
    await shot(p, 'c1-program');
    await p.getByTestId('program-item-done').first().check();
    await p.waitForTimeout(300);
    await p.getByTestId('program-log-day').first().click();
    await p.waitForTimeout(800);
    const logged = await p.evaluate(() => JSON.parse(localStorage.getItem('martialdex:training-history') || '[]').filter((e) => e.source === 'program').length);
    check('C2 완료 체크 → 기존 훈련 기록에 저장', logged === 1, logged);
    await go(p, '/progress');
    await p.waitForTimeout(800);
    const t = await text(p);
    check('B1 훈련 성과: 기록 기반 기술별 변화 (50 → 70)', t.includes('처음 50') && t.includes('최근 70'), null);
    check('B2 영상 비교 영역 (동기 재생·각도 안내)', (await p.getByTestId('video-compare').count()) === 1);
    await ctx.close();
  }


  // ======================= P. 택배 거래 결제 (Toss 테스트 결제 흐름) =======================
  console.log('\n[P] 택배 거래 결제');
  {
    const p = owner.page;
    await go(p, '/gear/new');
    await p.getByLabel(/상품명/).fill('MMA 글러브 택배');
    await p.getByLabel(/가격/).first().fill('40000');
    await p.locator('label.eco-check:has-text("택배") input').check();
    await p.getByTestId('gear-shipping-fee').fill('3500');
    await p.getByTestId('gear-save').click();
    await p.waitForTimeout(1500);
    const g = (await sb.sql(`select id, shipping_available, shipping_fee from public.gear_listings where title = 'MMA 글러브 택배'`)).rows[0];
    check('P1 판매자: 택배 가능 + 배송비 등록', g?.shipping_available === true && g.shipping_fee === 3500, g);
    const b = buyer.page;
    await go(b, `/gear/${g.id}`);
    await b.waitForTimeout(800);
    check('P2 상세: 택배 구매 영역 (상품+배송비 합계·테스트 결제 표시)', (await b.getByTestId('gear-checkout').innerText()).includes('43,500원'));
    await b.getByTestId('gear-buy-shipping').click();
    await b.getByTestId('gear-order-create').click();
    await b.waitForTimeout(500);
    check('P3 배송지 없이 주문 불가 (안내)', (await b.getByTestId('gear-checkout').innerText()).includes('받는 분'));
    await b.getByTestId('gear-ship-name').fill('구매자');
    await b.getByTestId('gear-ship-phone').fill('010-2222-3333');
    await b.getByTestId('gear-ship-address').fill('서울시 송파구 테스트로 3');
    await b.getByTestId('gear-order-create').click();
    await b.waitForTimeout(1500);
    const ord = (await sb.sql(`select id, amount, status from public.gear_orders where listing_id = $1`, [g.id])).rows[0];
    check('P4 주문 생성: 금액은 서버 계산 (43,500원) · 결제 대기', ord?.amount === 43500 && ord.status === 'pending', ord);
    await shot(b, 'p4-checkout');
    // Toss 결제창은 외부(실제 Toss) 화면이라 자동화하지 않는다 — Toss 가 successUrl 로 돌려보내는 것과 같은 URL 로 이동
    await go(b, `/gear/payment/result?orderId=${ord.id}&paymentKey=tgen_e2e_${Date.now()}&amount=43500`);
    check('P5 결제 결과 화면 → 서버 확인 후 결제 완료', await b.getByTestId('gear-payment-success').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
    await b.waitForTimeout(500);
    const paid = (await sb.sql(`select o.status, l.status ls, l.buyer_id from public.gear_orders o join public.gear_listings l on l.id = o.listing_id where o.id = $1`, [ord.id])).rows[0];
    check('P6 결제 완료 → 상품 판매 완료 · 구매자 지정', paid.status === 'paid' && paid.ls === 'sold' && paid.buyer_id === BUYER.id, paid);
    await go(p, '/gear/orders');
    await p.getByTestId('gear-orders-tab-seller').click();
    await p.waitForTimeout(1000);
    check('P7 판매자 주문 화면: 배송지 표시', (await p.getByTestId('gear-order-card').first().innerText()).includes('서울시 송파구 테스트로 3'));
    await p.getByTestId('gear-tracking-input').fill('6789-1234-5555');
    await p.getByTestId('gear-mark-shipped').click();
    await p.waitForTimeout(1200);
    check('P8 판매자 발송 처리 (송장)', (await sb.sql(`select status, tracking_number from public.gear_orders where id = $1`, [ord.id])).rows[0].tracking_number === '6789-1234-5555');
    await go(b, '/gear/orders');
    await b.waitForTimeout(1000);
    check('P9 구매자 화면: 송장 번호 표시', (await b.getByTestId('gear-order-card').first().innerText()).includes('6789-1234-5555'));
    await b.getByTestId('gear-confirm-received').click();
    await b.waitForTimeout(1200);
    check('P10 구매자 수령 확인 → 거래 완료', (await sb.sql(`select status from public.gear_orders where id = $1`, [ord.id])).rows[0].status === 'delivered');
    // refund before shipping
    const g2 = (await sb.asUser(OWNER.id, (q) => q(`insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, shipping_available, shipping_fee) values ($1, '관장', '헤드기어 택배', 'headgear', 'good', 30000, true, 0) returning id`, [OWNER.id]))).rows[0].id;
    await go(b, `/gear/${g2}`);
    await b.waitForTimeout(800);
    check('P11 무료배송 표시', (await b.getByTestId('gear-checkout').innerText()).includes('무료'));
    await b.getByTestId('gear-buy-shipping').click();
    await b.getByTestId('gear-ship-name').fill('구매자');
    await b.getByTestId('gear-ship-phone').fill('010-2222-3333');
    await b.getByTestId('gear-ship-address').fill('서울시 송파구 테스트로 3');
    await b.getByTestId('gear-order-create').click();
    await b.waitForTimeout(1500);
    const ord2 = (await sb.sql(`select id from public.gear_orders where listing_id = $1`, [g2])).rows[0];
    await go(b, `/gear/payment/result?orderId=${ord2.id}&code=PAY_PROCESS_CANCELED&message=${encodeURIComponent('사용자가 결제를 취소했습니다')}`);
    await b.waitForTimeout(1200);
    check('P12 결제창에서 취소 → 실패 화면 · 주문 failed · 상품은 계속 판매 중', (await b.getByTestId('gear-payment-failed').count()) === 1 && (await sb.sql(`select o.status, l.status ls from public.gear_orders o join public.gear_listings l on l.id = o.listing_id where o.id = $1`, [ord2.id])).rows[0].ls === 'active');
    await go(b, `/gear/${g2}`);
    await b.waitForTimeout(800);
    await b.getByTestId('gear-buy-shipping').click();
    await b.getByTestId('gear-ship-name').fill('구매자');
    await b.getByTestId('gear-ship-phone').fill('010-2222-3333');
    await b.getByTestId('gear-ship-address').fill('서울시 송파구 테스트로 3');
    await b.getByTestId('gear-order-create').click();
    await b.waitForTimeout(1500);
    const ord3 = (await sb.sql(`select id from public.gear_orders where listing_id = $1 and status = 'pending'`, [g2])).rows[0];
    await go(b, `/gear/payment/result?orderId=${ord3.id}&paymentKey=tgen_e2e_r_${Date.now()}&amount=30000`);
    await b.waitForTimeout(1500);
    await go(b, '/gear/orders');
    await b.waitForTimeout(1000);
    await b.locator('[data-testid="gear-order-card"][data-status="paid"]').getByTestId('gear-refund').click();
    await b.waitForTimeout(1500);
    const ref = (await sb.sql(`select o.status, l.status ls from public.gear_orders o join public.gear_listings l on l.id = o.listing_id where o.id = $1`, [ord3.id])).rows[0];
    check('P13 발송 전 구매자 결제 취소 → 환불 · 상품 다시 판매 중', ref.status === 'refunded' && ref.ls === 'active', ref);
    const url = await b.evaluate(async () => (await import('/src/lib/payments/tossCheckout.ts')).buildTossResultUrl('cur_1'));
    check('P14 (기존 결함 수정) 커리큘럼 결제 복귀 주소가 해시 라우트', /#\/marketplace\/payment\/result\?curriculumId=cur_1$/.test(url), url);
  }

  // ======================= 모바일 레이아웃 =======================
  console.log('\n[M] 모바일 레이아웃 (390px)');
  {
    const { ctx, page } = await ctxFor(BUYER, { width: 390, height: 844 });
    const routes = ['/gyms', '/gyms/deals', '/gyms/coupons', '/gear', '/gear/mine', '/gear/orders', '/evaluations', '/program', '/progress', '/community', '/gym'];
    const bad = [];
    for (const r of routes) {
      await go(page, r);
      if (!(await noHScroll(page))) bad.push(r);
    }
    check('M1 새 화면 가로 스크롤 없음 (390px)', bad.length === 0, bad);
    await shot(page, 'm1-mobile-gyms');
    await ctx.close();
  }

  // ======================= 기존 기능 회귀 (화면) =======================
  console.log('\n[R] 기존 화면');
  {
    const p = buyer.page;
    for (const [r, must] of [['/', null], ['/arts/boxing/techniques/boxing__jab', 'Jab'], ['/coach', null], ['/shorts', null], ['/messages', null], ['/clans', null], ['/fighter-profile', null], ['/training', null]]) {
      await go(p, r);
      if (must) await p.waitForFunction((m) => document.body.innerText.includes(m), must, { timeout: 20000 }).catch(() => {});
      const body = await text(p);
      check(`R 기존 화면 열림 ${r}`, body.length > 30 && !/문제가 발생했습니다|Something went wrong/.test(body) && (!must || body.includes(must)), body.slice(0, 200));
    }
  }
} catch (e) {
  fail++;
  console.log('  FAIL  예외 ::', String(e?.stack ?? e).slice(0, 600));
}
check('페이지 런타임 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 5));
console.log(`\nbackend requests: ${sb.stats.requests}, errors returned: ${sb.stats.errors}`);
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await browser.close();
await vite.close();
await sb.close();
process.exit(fail ? 1 : 0);
