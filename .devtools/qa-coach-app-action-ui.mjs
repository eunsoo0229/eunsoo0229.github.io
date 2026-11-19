// 42개 문제 I24 — 앱 액션을 실제 Electron 채팅 화면에서 검증한다 (숨김 창, 음소거).
//   1. "JAB의 3D 프리뷰 화면 띄워줘" → 채팅 안에 잽 3D 시연이 열리고 실제 three.js 캔버스가 그려지는가
//   2. "잽 기술 상세 화면 열어줘" → 답변 직후 앱이 기술 상세 화면으로 실제 이동하는가 (URL·제목 확인)
//   3. "암바 3D 시연 보여줘" → 3D가 없는 기술은 열지 않고 그렇다고 답하는가
// 외부 호출 없음: 검색·Gemini·Supabase 요청은 page.route 로 막는다 (이 경로들은 모델·검색을 쓰지 않는다).
// 비파괴: 실제 프로필로 뜬다. 시작 시 대화 목록을 기록하고, 이 테스트가 만든 대화만 지운다.
//   node .devtools/qa-coach-app-action-ui.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
const APP = '/Users/swcho/Documents/MARTIALDEX';
const KEY = 'martialdex:coach-conversations';
const env = { ...process.env, MARTIALDEX_HEADLESS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 240)}`); } };

const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP], env, timeout: 60000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
await page.route(/generativelanguage|supabase\.co|functions\/v1|:8888|searx|duckduckgo|bing\.com|google\.com\/search/, (r) => r.abort());
const convIds = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]').map((c) => c.id), KEY);
const before = new Set(await convIds());

async function ask(text) {
  await page.getByTestId('self-ai-input').fill(text);
  await page.getByTestId('self-ai-send').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="self-ai-busy"]'), null, { timeout: 60000 });
  await page.waitForTimeout(600);
}

try {
  await page.goto('http://localhost:5173/#/coach/chat', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.getByTestId('self-ai-new').click();
  await page.waitForTimeout(400);

  console.log('\n[1] 3D 프리뷰');
  await ask('JAB의 3D 프리뷰 화면 띄워줘');
  const card = page.getByTestId('chat-motion3d-card').last();
  const hasCard = await card.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check('채팅 안에 3D 시연 카드가 붙음', hasCard);
  check('잽 클립', (await card.getAttribute('data-technique').catch(() => '')) === 'kickboxing__jab', await card.getAttribute('data-technique').catch(() => ''));
  const canvasOk = await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('[data-testid="chat-motion3d-card"] canvas')].pop();
    return !!c && c.width > 0 && c.height > 0;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  check('열린 상태로 실제 3D 캔버스가 그려짐 (사용자가 "열기"를 누를 필요 없음)', canvasOk);
  const lastText = await page.locator('.ai-msg--model').last().innerText();
  check('답변이 코드가 쓴 실행 결과 (모델 문장 아님)', /3D 시연을 아래에 열었습니다/.test(lastText), lastText.slice(0, 120));

  console.log('\n[2] 3D 없는 기술');
  await ask('암바 3D 시연 보여줘');
  const t2 = await page.locator('.ai-msg--model').last().innerText();
  check('3D가 없으면 열지 않고 그렇다고 답함', /3D 시연이 없어 열지 않았습니다/.test(t2) || /아직 3D 시연이 없습니다/.test(t2), t2.slice(0, 160));

  console.log('\n[3] 기술 상세 화면 열기 (화면 이동)');
  await page.getByTestId('self-ai-input').fill('잽 기술 상세 화면 열어줘');
  await page.getByTestId('self-ai-send').click();
  const moved = await page.waitForFunction(() => location.hash.includes('/techniques/kickboxing__jab'), null, { timeout: 30000 }).then(() => true).catch(() => false);
  check('답변 직후 기술 상세 화면으로 실제 이동', moved, await page.evaluate(() => location.hash));
  await page.waitForFunction(() => /jab/i.test(document.querySelector('h1')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const title = await page.locator('h1').first().innerText().catch(() => '');
  check('이동한 화면의 제목 = Jab', /jab/i.test(title), title);
} catch (e) {
  fail++;
  console.log('  FAIL  예외 ::', String(e).slice(0, 300));
} finally {
  const removed = await page.evaluate(({ k, before }) => {
    const all = JSON.parse(localStorage.getItem(k) || '[]');
    const keep = all.filter((c) => before.includes(c.id));
    localStorage.setItem(k, JSON.stringify(keep));
    return all.length - keep.length;
  }, { k: KEY, before: [...before] }).catch(() => -1);
  const after = await convIds().catch(() => []);
  console.log(`\n[정리] 테스트가 만든 대화 ${removed}개 삭제 · 기존 ${before.size}개 유지: ${[...before].every((id) => after.includes(id))}`);
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await app.close();
process.exit(fail ? 1 : 0);
