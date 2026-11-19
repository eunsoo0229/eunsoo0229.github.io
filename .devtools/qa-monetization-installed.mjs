// 설치본(패키징된 Mac 앱 · Android APK) 수익화 화면 점검.
//  - 비로그인: 설치본이 운영 Supabase 를 그대로 읽는다(공개 테이블 조회만, 쓰기 없음).
//  - 로그인: 운영 계정 비밀번호를 쓰지 않고 계정도 만들지 않기 위해, 설치본의 Supabase 요청만 로컬 테스트
//    백엔드(PGlite + 전체 마이그레이션 + 실제 RLS)로 돌린다. 앱 바이너리·번들은 손대지 않는다.
//  - Toss 결제창은 열지 않는다(실제 돈 없음). Mac 은 숨김·무음(MARTIALDEX_HEADLESS=1), Android 는 창 없는 에뮬레이터.
//   PGLITE_DIR=… MAC_APP=…/MARTIALDEX.app APK=…/app-debug.apk [ONLY=mac|android] node .devtools/qa-monetization-installed.mjs
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPgliteSupabase } from './lib/pglite-supabase.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROD = 'https://dxazzyzsgmfqhagbpeux.supabase.co';
const STORAGE_KEY = 'sb-dxazzyzsgmfqhagbpeux-auth-token';
const ONLY = process.env.ONLY;
if (!process.env.PGLITE_DIR) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d !== undefined ? ' :: ' + JSON.stringify(d).slice(0, 300) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 로컬 테스트 백엔드 + 시드 ----------
const U = (n) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`;
const users = [
  { id: U(1), email: 'buyer@test.local', password: 'pw', nickname: '구매자' },
  { id: U(2), email: 'creator@test.local', password: 'pw', nickname: '코치K' },
];
const [BUYER, CREATOR] = users;
const sb = await startPgliteSupabase({ pgliteDir: process.env.PGLITE_DIR, port: 54394, users, appDir: APP });
const svc = async (q, p) => { await sb.sql(`select set_config('request.jwt.claim.role', 'service_role', false)`); try { return await sb.sql(q, p); } finally { await sb.sql(`select set_config('request.jwt.claim.role', '', false)`); } };
await sb.sql(`insert into public.creator_profiles (user_id, display_name, status, credentials) values ($1, '코치K', 'approved', '[{"title":"생활체육지도자 2급"}]')`, [CREATOR.id]);
const prod = ((await sb.sql(`insert into public.creator_products (creator_id, product_type, title, summary, price_coins, rights_confirmed, status, approved_version, preview, outline) values ($1, 'course', '설치본 테스트 코스', '잽 4주', 800, true, 'approved', 1, '{"text":"맛보기"}', '["잽 기본"]') returning id`, [CREATOR.id])).rows ?? [])[0].id;
await sb.sql(`insert into public.creator_product_content (product_id, body) values ($1, '{"sections":[{"title":"잽 기본","text":"설치본 본문 확인용"}]}')`, [prod]);
await svc(`select public.post_ledger($1, 'event_reward', 3000, 'campaign', 'installed-qa', 'seed-installed-buyer')`, [BUYER.id]);
const bal = async () => Number(((await sb.sql(`select coalesce((select balance from public.wallets where user_id = $1), 0) b`, [BUYER.id])).rows ?? [])[0].b);

// 설치본의 운영 Supabase 요청 → 로컬 백엔드
async function proxy(method, url, headers, body) {
  const u = new URL(url);
  const h = { ...headers };
  delete h.host; delete h.origin; delete h.referer;
  const r = await fetch(`${sb.url}${u.pathname}${u.search}`, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
  const buf = Buffer.from(await r.arrayBuffer());
  const out = {};
  r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v; });
  out['access-control-allow-origin'] = '*';
  out['access-control-allow-headers'] = '*';
  out['access-control-allow-methods'] = 'GET,POST,PATCH,DELETE,OPTIONS';
  out['access-control-expose-headers'] = 'content-range';
  return { status: r.status === 204 && method === 'OPTIONS' ? 200 : r.status, headers: out, body: buf };
}

const SCREENS = [
  ['/membership', '멤버십', /FREE/, 'plan-grid'],
  ['/wallet', '지갑', /보유 코인/, 'wallet-card'],
  ['/wallet/store', '코인 스토어', /starter|standard/i, 'coin-packages'],
  ['/wallet/history', '거래 내역', /거래 내역|전체 원장/, 'ledger-table'],
  ['/content', '디지털 콘텐츠 마켓', /설치본 테스트 코스/, 'product-grid'],
  ['/creator', '창작자 스튜디오', /크리에이터 스튜디오/, null],
  ['/creator/revenue', '창작자 수익 대시보드', /현금 정산|시뮬레이션/, 'revenue-metrics'],
  ['/library', '구매한 콘텐츠', /내 라이브러리/, 'library-grid'],
];

// ======================= Mac =======================
async function mac() {
  const MAC_APP = process.env.MAC_APP;
  if (!MAC_APP || !fs.existsSync(MAC_APP)) return console.log('\n[Mac] SKIP — MAC_APP 없음');
  console.log('\n[Mac] 설치본:', path.basename(path.dirname(path.dirname(MAC_APP))) + '/' + path.basename(MAC_APP));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-mono-mac-'));
  const env = { ...process.env, MARTIALDEX_HEADLESS: '1', GEMINI_API_KEY: '', TAVILY_API_KEY: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.join(MAC_APP, 'Contents/MacOS/MARTIALDEX'), args: [`--user-data-dir=${userData}`], env, timeout: 120000 });
  try {
    check('[Mac] 패키징된 앱 실행 (isPackaged)', await app.evaluate(({ app: a }) => a.isPackaged));
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(2500); };
    const body = () => page.locator('body').innerText();
    await page.waitForSelector('#root > *', { timeout: 60000 });

    // ---- 비로그인: 운영 서버 그대로 (읽기만)
    await go('#/membership');
    check('[Mac·운영 비로그인] 멤버십: 운영 요금제(FREE/PRO 9,900원) 표시', /9,900원/.test(await body()) && (await page.getByTestId('plan-pro').count()) === 1);
    await go('#/wallet/store');
    check('[Mac·운영 비로그인] 코인 스토어: 운영 코인 상품 4종', (await page.locator('[data-testid^="pack-"]').count()) === 4);
    await go('#/content');
    check('[Mac·운영 비로그인] 콘텐츠 마켓: 오류 없이 열림', /디지털 콘텐츠 마켓/.test(await body()) && !(await page.locator('[role=alert]').count()));
    await go('#/wallet');
    check('[Mac·운영 비로그인] 지갑: 로그인 안내', /로그인 후 이용/.test(await body()));

    // ---- 로그인: 운영 Supabase 요청을 로컬 백엔드로
    await app.context().route((u) => u.href.startsWith(PROD), async (route) => {
      const r = route.request();
      const res = await proxy(r.method(), r.url(), await r.allHeaders(), r.postDataBuffer() ?? undefined);
      await route.fulfill({ status: res.status, headers: res.headers, body: res.body });
    });
    const login = async (u) => { await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(sb.session(u))]); await page.reload(); await sleep(3000); };
    await login(BUYER);
    for (const [hash, name, re, tid] of SCREENS) {
      await go('#' + hash);
      if (tid && hash !== '/library') await page.waitForSelector(`[data-testid="${tid}"]`, { timeout: 10000 }).catch(() => {});
      const t = await body();
      const ok = re.test(t) && (!tid || (await page.getByTestId(tid).count()) > 0 || hash === '/library');
      check(`[Mac·로그인] ${name} 화면`, ok, ok ? '' : await page.locator('.mono-page, .page').first().innerText().catch(() => t.slice(0, 300)));
      if (hash === '/wallet') check('[Mac·로그인] 지갑 잔액 3,000 MC (서버 원장 값)', (await page.getByTestId('wallet-card').innerText()).includes('3,000'));
    }
    await go(`#/content/${prod}`);
    check('[Mac·로그인] 구매 전: 미리보기만', (await page.getByTestId('product-preview').count()) === 1 && (await page.getByTestId('product-full-content').count()) === 0);
    await page.getByTestId('buy-product').click();
    await sleep(2500);
    check('[Mac·로그인] 코인으로 콘텐츠 구매 → 본문 열람, 잔액 2,200', (await page.getByTestId('product-full-content').count()) === 1 && (await bal()) === 2200);
    await go('#/library');
    check('[Mac·로그인] 구매한 콘텐츠 목록에 표시', (await page.getByTestId(`product-${prod}`).count()) === 1);
    await go('#/wallet/store');
    await page.getByTestId('checkout-pack-starter').getByTestId('checkout-start').click();
    await sleep(2500);
    const pend = ((await sb.sql(`select amount_krw, status from public.coin_orders where user_id = $1 order by created_at desc limit 1`, [BUYER.id])).rows ?? [])[0];
    check('[Mac·로그인] 코인 구매: 서버가 1,000원 주문 생성 (Toss 테스트 위젯 단계 — 결제창은 열지 않음)', pend?.amount_krw === 1000 && pend?.status === 'pending' && /1,000원/.test(await page.getByTestId('checkout-pack-starter').innerText()), pend);
    await login(CREATOR);
    await go('#/creator');
    check('[Mac·로그인 창작자] 스튜디오: 승인 상태 + 내 콘텐츠', /승인/.test(await body()) && /설치본 테스트 코스/.test(await body()));
    await go('#/creator/revenue');
    check('[Mac·로그인 창작자] 수익: 판매 1건, 수수료 120, 출금 비활성 안내', /120 MC/.test(await body()) && (await page.getByTestId('payout-disabled-notice').count()) === 1);
    check('[Mac] 화면 런타임 오류 없음', errors.length === 0, errors.slice(0, 2));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

// ======================= Android =======================
async function android() {
  const APK = process.env.APK;
  if (!APK || !fs.existsSync(APK)) return console.log('\n[Android] SKIP — APK 없음');
  const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
  const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
  const PKG = 'com.martialdex.testbuild';
  let booted = '';
  try { booted = adb('shell', 'getprop', 'sys.boot_completed'); } catch { booted = ''; }
  if (booted !== '1') return console.log('\n[Android] SKIP — 부팅된 에뮬레이터 없음');
  console.log('\n[Android]', adb('shell', 'getprop', 'ro.product.model'), '· Android', adb('shell', 'getprop', 'ro.build.version.release'), '·', path.basename(APK));
  adb('install', '-r', '-g', APK);
  adb('shell', 'pm', 'clear', PKG);
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  let sock = null;
  for (let i = 0; i < 40 && !sock; i++) {
    await sleep(1000);
    let pid = '';
    try { pid = adb('shell', 'pidof', PKG); } catch { pid = ''; }
    if (pid) sock = adb('shell', 'cat', '/proc/net/unix').split('\n').map((l) => l.trim().split(/\s+/).pop()).find((s) => s === `@webview_devtools_remote_${pid}`);
  }
  if (!sock) return check('[Android] WebView 디버그 소켓', false, '없음 (release 빌드는 WebView 디버깅이 꺼져 있을 수 있음)');
  const PORT = 9341;
  try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* none */ }
  adb('forward', `tcp:${PORT}`, `localabstract:${sock.slice(1)}`);
  let target = null;
  for (let i = 0; i < 20 && !target; i++) { await sleep(1000); target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => [])).find((t) => t.type === 'page'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  let intercept = false;
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Fetch.requestPaused') {
      const rq = d.params.request;
      if (!intercept || !rq.url.startsWith(PROD)) return send('Fetch.continueRequest', { requestId: d.params.requestId });
      try {
        const res = await proxy(rq.method, rq.url, rq.headers, rq.postData);
        send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: res.status, responseHeaders: Object.entries(res.headers).map(([name, value]) => ({ name, value: String(value) })), body: res.body.toString('base64') });
      } catch (e) {
        send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'Failed' });
      }
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error');
    return r.result?.result?.value;
  };
  const waitFor = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(`return !!(${cond});`).catch(() => false)) return true; await sleep(500); } return false; };
  const body = () => ev(`return document.body.innerText;`);
  const count = (sel) => ev(`return document.querySelectorAll(${JSON.stringify(sel)}).length;`);
  const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}; return true;`); await sleep(3500); };
  try {
    await waitFor(`document.readyState === 'complete' && document.querySelector('#root')?.children.length`, 40000);
    const env = await ev(`return { cap: !!window.Capacitor, platform: window.Capacitor?.getPlatform?.(), w: innerWidth };`);
    check('[Android] Capacitor Android WebView', env.cap && env.platform === 'android', env);
    await ev(`window.__errs = []; addEventListener('error', (e) => __errs.push(String(e.message))); return true;`);

    await go('#/membership');
    await waitFor(`document.querySelector('[data-testid="plan-pro"]')`, 20000);
    const mt = await body();
    check('[Android·운영 비로그인] 멤버십: 운영 요금제 표시', /9,900원/.test(mt), mt.slice(0, 300));
    await go('#/wallet/store');
    await waitFor(`document.querySelectorAll('[data-testid^="pack-"]').length === 4`, 20000);
    check('[Android·운영 비로그인] 코인 스토어: 운영 코인 상품 4종', (await count('[data-testid^="pack-"]')) === 4, await ev(`return (document.querySelector('.mono-page')?.innerText ?? '').slice(0, 300) + ' | net: ' + (await fetch('${PROD}/rest/v1/', { method: 'HEAD' }).then((r) => r.status).catch((e) => String(e)));`).catch((e) => String(e)));
    await go('#/content');
    check('[Android·운영 비로그인] 콘텐츠 마켓 열림', /디지털 콘텐츠 마켓/.test(await body()));

    await send('Fetch.enable', { patterns: [{ urlPattern: `${PROD}/*` }] });
    intercept = true;
    const login = async (u) => { await ev(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(sb.session(u)))}); location.reload(); return true;`).catch(() => {}); await sleep(5000); await waitFor(`document.querySelector('#root')?.children.length`, 30000); };
    await login(BUYER);
    for (const [hash, name, re, tid] of SCREENS) {
      await go('#' + hash);
      if (tid && hash !== '/library') await waitFor(`document.querySelector('[data-testid="${tid}"]')`, 10000);
      const t = await body();
      const ok = re.test(t) && (!tid || (await count(`[data-testid="${tid}"]`)) > 0 || hash === '/library');
      check(`[Android·로그인] ${name} 화면`, ok, t.slice(0, 160));
      const noH = await ev(`return document.documentElement.scrollWidth <= innerWidth + 1;`);
      if (!noH) check(`[Android] ${name} 가로 스크롤 없음`, false);
    }
    await go(`#/content/${prod}`);
    const owned = (await count('[data-testid="owned-badge"]')) === 1;
    if (!owned) {
      await ev(`document.querySelector('[data-testid="buy-product"]').click(); return true;`);
      await sleep(3500);
    }
    check('[Android·로그인] 구매한 콘텐츠 본문 열람', (await count('[data-testid="product-full-content"]')) === 1);
    await login(CREATOR);
    await go('#/creator/revenue');
    await waitFor(`document.querySelector('[data-testid="revenue-metrics"]')`, 20000);
    check('[Android·로그인 창작자] 수익 대시보드 + 출금 비활성 안내', (await count('[data-testid="payout-disabled-notice"]')) === 1 && (await count('[data-testid="revenue-metrics"]')) === 1);
    const errs = await ev(`return window.__errs ?? [];`).catch(() => []);
    check('[Android] 화면 런타임 오류 없음', errs.length === 0, errs.slice(0, 2));
  } finally {
    intercept = false;
    try { ws.close(); } catch { /* ignore */ }
    try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* ignore */ }
  }
}

try {
  if (ONLY !== 'android') await mac();
  if (ONLY !== 'mac') await android();
} catch (e) {
  check('실행 중 예외 없음', false, e.stack?.slice(0, 300));
} finally {
  await sb.close();
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
