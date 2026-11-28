// UI QA — TACTICAL FINDER in the production build (vite preview), headless Chrome (no window, no sound).
// Every request that is not to localhost is BLOCKED (route.abort): no Supabase, no Gemini, no web search — the page
// must work from the bundled technique DB alone, and a blocked AI call must be reported honestly.
//   npm run build && node .devtools/qa-tactical-finder.mjs
// Phone 390 px (touch), tablet 820 px, desktop 1280 px. Also checks the AI coach pages still open (regression).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4799;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.QA_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-tf-'));
fs.mkdirSync(SHOTS, { recursive: true });
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--enable-unsafe-swiftshader'] });
const timing = [];

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const [label, viewport] of [['모바일 390px', { width: 390, height: 844 }], ['태블릿 820px', { width: 820, height: 1180 }], ['데스크톱 1280px', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: label.startsWith('모바일') });
    const blocked = [];
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      blocked.push(u.split('?')[0]);
      return route.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tag = `[${label}]`;

    await page.goto(`${BASE}/#/tactical-finder`);
    await page.getByTestId('tactical-finder').waitFor({ timeout: 20000 });
    const hero = await page.locator('.tf-hero__title').innerText();
    check(`${tag} 독립 페이지: TACTICAL FINDER 제목·안내 문구·입력창·예시·카테고리 8개`, hero.includes('TACTICAL FINDER') && (await page.getByText('Find the right technique for your goal.').count()) === 1 && (await page.getByTestId('tf-input').count()) === 1 && (await page.getByTestId('tf-example').count()) === 6 && (await page.locator('[data-testid^="tf-cat-"]').count()) === 8);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} 가로 스크롤 없음 (반응형)`, scrollW <= 1, scrollW);

    // natural-language search
    const q = '상대가 압박할 때 거리를 유지하면서 카운터하고 싶어.';
    await page.getByTestId('tf-input').fill(q);
    const t0 = Date.now();
    await page.getByTestId('tf-submit').click();
    await page.getByTestId('tf-results').waitFor({ timeout: 15000 });
    timing.push(Date.now() - t0);
    const analysis = await page.getByTestId('tf-analysis').innerText();
    check(`${tag} 입력 분석 표시 (목적 카운터·거리 조절, 상대 압박, AI 미사용 표시)`, /카운터/.test(analysis) && /거리 조절/.test(analysis) && /압박/.test(analysis) && /AI 미사용/.test(analysis), analysis.slice(0, 160));
    const secT = await page.getByTestId('tf-sec-technique').getAttribute('data-count');
    const secC = await page.getByTestId('tf-sec-combo').count();
    check(`${tag} 기술·콤보 섹션과 카드 (기본 5개)`, Number(secT) === 5 && secC === 1, { secT, secC });
    const firstCard = page.getByTestId('tf-sec-technique').getByTestId('tf-card').first();
    check(`${tag} 카드: 추천 이유·근거 점수·출처 표시`, (await firstCard.getByTestId('tf-reasons').locator('li').count()) > 0 && (await firstCard.getByTestId('tf-score').count()) === 1 && /MARTIALDEX 기술 DB/.test(await firstCard.innerText()));
    await page.screenshot({ path: path.join(SHOTS, `${label.split(' ')[0]}-results.png`), fullPage: false });

    // count filter 3, kind filter combo, paging
    await page.getByTestId('tf-count-3').click();
    await page.waitForTimeout(150);
    check(`${tag} 추천 개수 3`, Number(await page.getByTestId('tf-sec-technique').getAttribute('data-count')) === 3);
    const firstKeys = await page.getByTestId('tf-sec-technique').getByTestId('tf-card').evaluateAll((els) => els.map((e) => e.dataset.key));
    await page.getByTestId('tf-more').click();
    await page.waitForTimeout(150);
    const nextKeys = await page.getByTestId('tf-sec-technique').getByTestId('tf-card').evaluateAll((els) => els.map((e) => e.dataset.key));
    check(`${tag} 다른 추천 보기 → 겹치지 않는 결과`, nextKeys.length > 0 && !nextKeys.some((k) => firstKeys.includes(k)), { firstKeys, nextKeys });
    await page.getByTestId('tf-filter-kind').selectOption('combo');
    await page.waitForTimeout(150);
    check(`${tag} 유형 필터(콤보) → 콤보만`, (await page.getByTestId('tf-sec-technique').count()) === 0 && (await page.getByTestId('tf-sec-combo').count()) === 1);
    await page.getByTestId('tf-filter-kind').selectOption('');
    await page.getByTestId('tf-count-5').click();

    // art filter
    await page.getByTestId('tf-filter-art').selectOption('boxing');
    await page.waitForTimeout(150);
    const arts = await page.getByTestId('tf-sec-technique').getByTestId('tf-card').evaluateAll((els) => els.map((e) => e.querySelector('.tf-art')?.textContent));
    check(`${tag} 종목 필터(복싱) → 복싱 기술만`, arts.length > 0 && arts.every((x) => x === '복싱'), arts);
    await page.getByTestId('tf-filter-art').selectOption('');

    // save / rating / favorite
    await page.waitForTimeout(150);
    const card = page.getByTestId('tf-sec-technique').getByTestId('tf-card').first();
    await card.getByTestId('tf-save').click();
    await card.getByTestId('tf-useful').click();
    await card.getByTestId('tf-favorite').click();
    const ls = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem('martialdex:tactical-saved') || '[]').length, fb: JSON.parse(localStorage.getItem('martialdex:tactical-feedback') || '[]'), fav: JSON.parse(localStorage.getItem('martialdex:favorites') || '[]').length, hist: JSON.parse(localStorage.getItem('martialdex:tactical-history') || '[]').length }));
    check(`${tag} 저장·유용성 평가·즐겨찾기(기존 저장소)·검색 기록`, ls.saved === 1 && ls.fb.length === 1 && ls.fb[0].useful === true && ls.fav === 1 && ls.hist >= 1, ls);
    // combo → existing 콤보 북
    const comboCard = page.getByTestId('tf-sec-combo').getByTestId('tf-card').first();
    const canSave = await comboCard.getByTestId('tf-save-library').isEnabled();
    if (canSave) await comboCard.getByTestId('tf-save-library').click();
    const combos = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:combos') || '[]'));
    check(`${tag} 콤보를 기존 콤보 북에 저장 (DB 기술 id만)`, canSave && combos.length === 1 && combos[0].techniqueIds.length >= 2 && /TACTICAL FINDER/.test(combos[0].description), combos[0]?.techniqueIds);

    // detail link → existing technique page
    const href = await card.getByTestId('tf-detail-link').getAttribute('href');
    await card.getByTestId('tf-detail-link').click();
    await page.locator('.detail-hero h1').waitFor({ timeout: 15000 });
    check(`${tag} 기술명 클릭 → 기존 기술 상세 페이지`, /#\/arts\/.+\/techniques\//.test(page.url()), href);
    await page.goBack();
    await page.getByTestId('tactical-finder').waitFor();

    // 3D animation (a goal whose top cards include a technique with a clip)
    await page.getByTestId('tf-input').fill('킥복싱 몸통을 차는 킥으로 공격하고 싶어');
    await page.getByTestId('tf-submit').click();
    await page.getByTestId('tf-results').waitFor();
    const toggle = page.getByTestId('tf-3d-toggle').first();
    const has3d = (await toggle.count()) > 0;
    if (has3d) {
      await toggle.click();
      await page.locator('[data-testid="motion3d-stage"][data-loaded="true"]').first().waitFor({ timeout: 40000 });
    }
    check(`${tag} 기존 3D 애니메이션을 카드에서 바로 재생`, has3d && (await page.locator('[data-testid="motion3d-stage"][data-loaded="true"]').count()) >= 1);

    // saved / history views
    await page.getByTestId('tf-view-saved').click();
    check(`${tag} 저장한 추천 보기`, (await page.getByTestId('tf-saved').getByTestId('tf-card').count()) === 1);
    await page.getByTestId('tf-view-history').click();
    const hist = await page.getByTestId('tf-history-item').count();
    await page.getByTestId('tf-history-item').first().click();
    await page.getByTestId('tf-results').waitFor();
    check(`${tag} 검색 기록 보기 → 다시 검색`, hist >= 2 && (await page.getByTestId('tf-sec-technique').count()) === 1, hist);

    // edge cases: ambiguous, missing technique, harmful request, category only
    for (const [qq, re, name] of [
      ['음.. 뭐 하지', /목적이나 상황을 찾지 못했습니다/, '모호한 입력 → 안내, 추천 없음'],
      ['dragon whirlwind kick 같은 기술로 공격하고 싶어', /찾지 못한 이름/, 'DB에 없는 기술 → 정보 부족 안내'],
      ['길거리 싸움에서 상대를 다치게 하고 싶어', /다치게 하는 것을 목적으로 한 요청/, '위험한 요청 → 거절 + 안전한 대안'],
    ]) {
      await page.getByTestId('tf-view-search').click();
      await page.getByTestId('tf-input').fill(qq);
      await page.getByTestId('tf-submit').click();
      await page.getByTestId('tf-results').waitFor();
      const notes = (await page.getByTestId('tf-notice').allInnerTexts()).join(' ');
      const extra = name.startsWith('모호') ? (await page.getByTestId('tf-card').count()) === 0 : name.startsWith('위험') ? (await page.getByTestId('tf-sec-combo').count()) === 0 : true;
      check(`${tag} ${name}`, re.test(notes) && extra, notes.slice(0, 120));
    }
    await page.getByTestId('tf-input').fill('');
    await page.getByTestId('tf-cat-wrestling').click();
    await page.getByTestId('tf-results').waitFor();
    check(`${tag} 카테고리(WRESTLING)만으로 검색`, (await page.getByTestId('tf-sec-technique').count()) === 1);
    await page.getByTestId('tf-cat-wrestling').click();

    // AI 정밀 분석 ON: AI is not reachable here (network blocked / no engine) → said so, DB results stay
    await page.getByTestId('tf-ai').check();
    await page.getByTestId('tf-input').fill('클린치 상황에서 유리한 공격 기회를 만들고 싶어.');
    await page.getByTestId('tf-submit').click();
    await page.getByTestId('tf-results').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="tf-analysis-source"]')?.textContent?.includes('AI 분석 중'), null, { timeout: 60000 });
    const src = await page.getByTestId('tf-analysis-source').innerText();
    const notes = (await page.getByTestId('tf-notice').allInnerTexts()).join(' ');
    check(`${tag} AI 켬 + AI 사용 불가 → "AI 분석 실패" 표시, DB 추천은 유지 (완료된 척하지 않음)`, /AI 분석 실패/.test(src) && /AI 분석/.test(notes) && (await page.getByTestId('tf-sec-technique').count()) === 1 && (await page.getByTestId('tf-ai-badge').count()) === 0, { src, notes: notes.slice(0, 140) });
    await page.getByTestId('tf-ai').uncheck();

    // personalization toggle reflected in the footer
    await page.getByTestId('tf-personal').uncheck();
    await page.waitForTimeout(150);
    const foot = await page.getByTestId('tf-timing').innerText();
    check(`${tag} 개인화 OFF 표시`, /개인화 꺼짐/.test(foot), foot);
    await page.getByTestId('tf-personal').check();

    // ---- 2차: tabs · search mode · SETUP & COMBO FINDER (APP DATABASE) · WEB SEARCH (network blocked here)
    // [TEST] fixture written into THIS throwaway browser context only (fresh profile, never the user's data)
    await page.evaluate(() => {
      const now = '2026-11-28T00:00:00.000Z';
      const c = (id, name, ids, extra = {}) => ({ id, userId: null, name: `[TEST] ${name}`, description: '', techniqueIds: ids, createdAt: now, updatedAt: now, ...extra });
      localStorage.setItem('martialdex:combos', JSON.stringify([
        c('qa-c6', '잽 더블렉', ['kickboxing__jab', 'wrestling__basic-double-leg']),
        c('qa-c1', '원투 훅', ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__lead-hook']),
        c('qa-s2', '원투 레벨 체인지 더블렉', ['kickboxing__jab', 'kickboxing__cross', 'mixed-martial-arts__level-change-double-leg'], { visualMittMeta: { createdAt: now, stance: 'orthodox', type: 'setup', purpose: '테이크다운 진입' } }),
        { ...c('qa-o1', '다른 계정 더블렉', ['kickboxing__jab', 'wrestling__basic-double-leg']), userId: 'qa-other-account' },
      ]));
      localStorage.setItem('martialdex:tactics', JSON.stringify([{ id: 'qa-s1', userId: null, name: '[TEST] 잽 페인트 더블렉', situation: '상대가 잽에 가드를 올릴 때 레벨 체인지로 더블렉 진입', techniqueIds: ['kickboxing__jab', 'wrestling__basic-double-leg'], feedback: null, feedbackGeneratedAt: null, createdAt: now, updatedAt: now }]));
    });
    await page.goto(`${BASE}/#/tactical-finder`);
    await page.getByTestId('tactical-finder').waitFor();
    const order = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="tf-mode"]');
      const i = document.querySelector('[data-testid="tf-input"]');
      return !!m && !!i && !!(m.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    check(`${tag} 2차: 탭 2개(TECHNIQUE FINDER / SETUP & COMBO FINDER) + 입력 전에 검색 모드 선택`, (await page.getByTestId('tf-tab-technique').count()) === 1 && (await page.getByTestId('tf-tab-combo').count()) === 1 && order && (await page.getByTestId('tf-mode-app').getAttribute('aria-checked')) === 'true');
    await page.getByTestId('tf-input').fill('상대가 압박할 때 카운터');
    await page.getByTestId('tf-submit').click();
    await page.getByTestId('tf-results').waitFor();
    check(`${tag} 2차: TECHNIQUE FINDER 결과에 APP DATABASE 표시`, (await page.getByTestId('tf-result-mode').first().getAttribute('data-mode')) === 'app');
    await page.getByTestId('tf-tab-combo').click();
    const lsBefore = await page.evaluate(() => localStorage.getItem('martialdex:combos') + localStorage.getItem('martialdex:tactics'));
    await page.getByTestId('tf-combo-input').fill('더블렉을 위한 셋업');
    const tc = Date.now();
    await page.getByTestId('tf-combo-submit').click();
    await page.getByTestId('tf-lib-results').waitFor({ timeout: 10000 });
    timing.push(Date.now() - tc);
    const setups = await page.getByTestId('tf-sec-my-setups').getByTestId('tf-hit').evaluateAll((els) => els.map((e) => e.dataset.key));
    const mycombos = await page.getByTestId('tf-sec-my-combos').getByTestId('tf-hit').evaluateAll((els) => els.map((e) => e.dataset.key));
    check(`${tag} 2차: SETUP & COMBO FINDER — MY SETUPS(전술 셋업·셋업 콤보)·MY COMBOS 전체 검색`, setups.includes('tactic:qa-s1') && setups.includes('combo:qa-s2') && mycombos.includes('combo:qa-c6'), { setups, mycombos });
    const allText = await page.getByTestId('tf-lib-results').innerText();
    check(`${tag} 2차: 다른 계정 항목 노출 안 됨 + 제외 안내`, !allText.includes('다른 계정 더블렉') && /다른 계정 소유로 표시된 항목 1개/.test(allText));
    const hit = page.getByTestId('tf-sec-my-setups').getByTestId('tf-hit').first();
    check(`${tag} 2차: 카드 — 저장된 목적·구성 단계·일치 이유·관련도·상세 링크`, (await hit.getByTestId('tf-reasons').locator('li').count()) > 0 && (await hit.getByTestId('tf-tier').count()) === 1 && (await hit.getByTestId('tf-hit-link').count()) >= 1 && (await hit.getByTestId('tf-step').count()) >= 2);
    check(`${tag} 2차: 결과에 APP DATABASE 표시 + 원투 훅(무관) 제외`, (await page.getByTestId('tf-lib-results').getByTestId('tf-result-mode').getAttribute('data-mode')) === 'app' && !mycombos.includes('combo:qa-c1'));
    const sw2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} 2차: 가로 스크롤 없음 (SETUP & COMBO 결과)`, sw2 <= 1, sw2);
    await page.screenshot({ path: path.join(SHOTS, `${label.split(' ')[0]}-combo-finder.png`), fullPage: false });
    await page.getByTestId('tf-combo-input').fill('힐훅을 위한 셋업');
    await page.getByTestId('tf-combo-submit').click();
    await page.waitForTimeout(200);
    check(`${tag} 2차: 맞는 항목 없음 → 정해진 안내 문장`, (await page.getByText('현재 저장된 콤보와 셋업 중 이 목적에 직접적으로 부합하는 항목을 찾지 못했습니다.').count()) === 1 && (await page.getByTestId('tf-sec-my-setups').count()) === 0);
    const lsAfter = await page.evaluate(() => localStorage.getItem('martialdex:combos') + localStorage.getItem('martialdex:tactics'));
    check(`${tag} 2차: 검색이 저장 데이터를 바꾸지 않음`, lsBefore === lsAfter);
    await page.getByTestId('tf-tab-technique').click();
    const keptText = await page.getByTestId('tf-input').inputValue();
    await page.getByTestId('tf-tab-combo').click();
    check(`${tag} 2차: 탭마다 입력·결과 따로 유지`, keptText === '상대가 압박할 때 카운터' && (await page.getByTestId('tf-combo-input').inputValue()) === '힐훅을 위한 셋업');

    // WEB SEARCH with every outside request blocked: must say it failed, never show app results as web results
    await page.getByTestId('tf-mode-web').click();
    check(`${tag} 2차: WEB 모드 선택 시 자동 검색 안 함 (Gemini 호출 없음)`, (await page.getByTestId('tf-web-results').count()) === 0 && (await page.getByTestId('tf-lib-results').count()) === 0);
    await page.getByTestId('tf-combo-input').fill('더블렉을 위한 셋업');
    await page.getByTestId('tf-combo-submit').click();
    await page.getByTestId('tf-web-results').waitFor({ timeout: 60000 });
    const ws = await page.getByTestId('tf-web-results').getAttribute('data-status');
    const werr = await page.getByTestId('tf-web-error').innerText().catch(() => '');
    check(`${tag} 2차: WEB 검색 불가(비로그인 → 인증 단계에서 중단, 외부 요청 차단) → 오류 안내, 웹 결과·앱 결과 표시 안 함`, (ws === 'error' || ws === 'no-grounding') && /웹 검색/.test(werr) && (await page.getByTestId('tf-web-item').count()) === 0 && (await page.getByTestId('tf-hit').count()) === 0 && (await page.getByTestId('tf-result-mode').getAttribute('data-mode')) === 'web', { ws, werr: werr.slice(0, 140) });
    await page.getByTestId('tf-tab-technique').click();
    check(`${tag} 2차: WEB 모드에서는 앱 DB 필터 숨김`, (await page.getByTestId('tf-filters').count()) === 0);
    await page.getByTestId('tf-mode-app').click();
    check(`${tag} 2차: APP 모드로 돌아오면 앱 결과 그대로 (모드별 결과 분리)`, (await page.getByTestId('tf-results').count()) === 1 && (await page.getByTestId('tf-web-results').count()) === 0);
    const dbWebSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:combos') || '[]').length);
    check(`${tag} 2차: 웹 결과 자동 저장 없음`, dbWebSaved === 4, dbWebSaved);

    // nav: the independent chapter is in the index menu
    const nav = await page.evaluate(() => [...document.querySelectorAll('[data-testid="index-chapter-tactical"]')].length);
    check(`${tag} 메뉴에 TACTICAL FINDER 챕터`, nav === 1, nav);

    // regression: AI coach pages and the old situation page still open, no page errors anywhere
    for (const [hash, sel] of [['#/coach', 'h1, h2'], ['#/coach/chat', 'textarea, input'], ['#/situation', 'h2'], ['#/techniques', 'h1, h2'], ['#/combos', 'h1, h2'], ['#/tactics', 'h1, h2']]) {
      await page.goto(`${BASE}/${hash}`);
      await page.locator(sel).first().waitFor({ timeout: 20000 });
    }
    check(`${tag} 회귀: AI 코치 홈·대화·상황 추천·기술 목록·콤보 북·전술 셋업 페이지 열림`, true);
    check(`${tag} 페이지 오류 없음`, errors.length === 0, errors.slice(0, 3));
    const ext = [...new Set(blocked.map((u) => new URL(u).host))];
    console.log(`  (${label} 차단한 외부 요청 호스트: ${ext.join(', ') || '없음'})`);
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
}
console.log('screenshots:', SHOTS, 'search→results ms:', timing);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
