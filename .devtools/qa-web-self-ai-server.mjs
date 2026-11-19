// Web client → MARTIALDEX self-AI server, real browser (headless Chrome — nothing shown),
// real server (server/self-ai) in front of the user's real Ollama + SearXNG (not stopped:
// the server process is stopped / restarted, not the user's services).
//   connect in settings → status → video search (cards + in-app player) → technique answer
//   (code) → model answer → a lesson question with video cards → server down → honest error →
//   server back → works; two users in separate browser profiles are separate users.
// Requires: Vite dev server :5173 (the dev clone), Ollama, SearXNG, Google Chrome.
// Run: node .devtools/qa-web-self-ai-server.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const auth = require(path.join(APP, 'server/self-ai/auth.cjs'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfai-web-'));
const tokensFile = path.join(tmp, 'tokens.json');
const tokA = auth.issue(tokensFile, 'web-user-a');
const tokB = auth.issue(tokensFile, 'web-user-b');
const PORT = 8787;
const SERVER = `http://localhost:${PORT}`;
const results = [];
const timings = {};
function check(name, pass, detail = '') {
  results.push({ name, pass });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d && !pass ? ' :: ' + d.slice(0, 500) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverLog = '';
let server = null;
async function startServer() {
  server = spawn(process.execPath, [path.join(APP, 'server/self-ai/server.cjs')], { env: { ...process.env, SELF_AI_SERVER_PORT: String(PORT), SELF_AI_SERVER_TOKENS_FILE: tokensFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let started = '';
  server.stdout.on('data', (d) => {
    serverLog += d;
    started += d;
  });
  for (let i = 0; i < 50 && !/self-AI server on/.test(started); i++) await sleep(100);
}
const stopServer = () => new Promise((r) => { server.once('exit', r); server.kill(); });

await startServer();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [];
try {
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctxA.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('http://localhost:5173/#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]', { timeout: 30000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? '확인 중'), null, { timeout: 15000 });
  const st0 = await page.textContent('[data-testid="self-ai-status"]');
  check('[W1] 웹(서버 미연결): 로컬 AI·검색 미지원 표시 + 서버 연결 설정 표시', /미지원/.test(st0) && (await page.locator('[data-testid="self-ai-server-url"]').count()) === 1, st0);

  await page.fill('[data-testid="self-ai-server-url"]', SERVER);
  await page.fill('[data-testid="self-ai-server-token"]', 'mdx_wrongtokenwrongtoken');
  await page.click('[data-testid="self-ai-server-connect"]');
  await page.waitForSelector('[data-testid="self-ai-server-msg"]');
  check('[W2] 틀린 토큰 → 연결 거부 안내', /토큰이 올바르지 않습니다/.test(await page.textContent('[data-testid="self-ai-server-msg"]')));
  await page.fill('[data-testid="self-ai-server-token"]', tokA);
  await page.click('[data-testid="self-ai-server-connect"]');
  await page.waitForFunction(() => /연결됨/.test(document.querySelector('[data-testid="self-ai-server-msg"]')?.textContent ?? ''), null, { timeout: 10000 });
  await page.waitForFunction(() => /자체 AI 서버 · 로컬 AI: 실행 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 15000 });
  const st1 = await page.textContent('[data-testid="self-ai-status"]');
  check('[W3] 올바른 토큰 → 서버 연결, 상태: 자체 AI 서버 · 로컬 AI 실행 중 · 자체 검색 사용 가능', /qwen2\.5:3b/.test(st1) && /자체 검색: 사용 가능/.test(st1), st1);

  const ANSWERS = '[data-testid="self-ai-chat"] .ai-msg--model:not(.ai-msg--pending)';
  async function ask(id, text, timeout = 240000) {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, ANSWERS);
    await page.fill('[data-testid="self-ai-input"]', text);
    const t0 = Date.now();
    await page.click('[data-testid="self-ai-send"]');
    await page.waitForFunction(([n, sel]) => document.querySelectorAll(sel).length > n && !document.querySelector('[data-testid="self-ai-busy"]'), [n, ANSWERS], { timeout });
    timings[id] = Date.now() - t0;
    return page.evaluate((sel) => [...document.querySelectorAll(sel)].pop()?.innerText ?? '', ANSWERS);
  }
  const v = await ask('web_video', '레슬링 싱글렉을 배울 수 있는 교육 영상을 찾아 줘.');
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="self-ai-videos"]')].pop()?.querySelectorAll('.video-card').length ?? 0);
  check('[W4] 웹에서 영상 검색(서버의 SearXNG) → 카드', /찾은 영상 \d+개/.test(v) && cards >= 2, { cards, v: v.slice(0, 160) });
  const play = page.locator('[data-testid="self-ai-videos"] .video-card[data-embed="embeddable"] [data-testid="video-card-play"]');
  if (await play.count()) {
    await play.first().click();
    await page.waitForSelector('[data-testid="video-results-player"] iframe', { timeout: 10000 });
    let player = null;
    for (let i = 0; i < 30 && !player?.video; i++) {
      await sleep(500);
      const frame = page.frames().find((f) => /youtube\.com\/embed\//.test(f.url()));
      player = frame ? await frame.evaluate(() => ({ video: !!document.querySelector('video'), error: document.querySelector('.ytp-error')?.textContent?.trim() || null })).catch((e) => ({ video: false, error: String(e) })) : null;
    }
    check('[W5] 웹에서 앱 내 재생(YouTube 플레이어 video 요소, 오류 없음)', !!player?.video && !player.error, player);
  } else check('[W5] 재생 가능한 영상', false, v.slice(0, 200));
  const t = await ask('web_technique', 'BJJ의 암바를 설명해 줘. 기술의 원리, 주요 포인트, 흔한 실수와 대응 방법을 알려 줘.');
  check('[W6] 기술 질문 → 같은 코드 답변(구역별)', /■ 기술 설명/.test(t) && /■ 핵심 포인트/.test(t), t.slice(0, 200));
  const g = await ask('web_model', '안녕하세요');
  check('[W7] 모델 답변이 서버의 qwen2.5:3b로', g.trim().length > 0 && !/사용할 수 없/.test(g), g.slice(0, 200));

  // server down → honest error → back up → works
  await stopServer();
  const off = await ask('web_down', '로마첸코 풋워크 영상 보여줘', 60000);
  await page.waitForFunction(() => /로컬 AI: 꺼짐|자체 검색: 꺼짐/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const stOff = await page.textContent('[data-testid="self-ai-status"]');
  check('[W8] 서버 종료 → 검색 실패를 그대로 안내(지어낸 영상 없음), 상태 갱신', /검색을 시도했지만 실패했습니다|연결할 수 없습니다/.test(off) && !/찾은 영상/.test(off) && /꺼짐/.test(stOff), { off: off.slice(0, 200), stOff });
  await startServer();
  const back = await ask('web_up', '로마첸코 풋워크 영상 보여줘', 120000);
  check('[W9] 서버 재시작 → 같은 화면에서 바로 복구', /찾은 영상 \d+개/.test(back), back.slice(0, 200));

  // a second user in another browser profile
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pb = await ctxB.newPage();
  pb.on('pageerror', (e) => pageErrors.push(e.message));
  await pb.goto('http://localhost:5173/#/coach/chat');
  await pb.waitForSelector('[data-testid="self-ai-server-url"]', { timeout: 30000 });
  await pb.fill('[data-testid="self-ai-server-url"]', SERVER);
  await pb.fill('[data-testid="self-ai-server-token"]', tokB);
  await pb.click('[data-testid="self-ai-server-connect"]');
  await pb.waitForFunction(() => /연결됨 — 사용자 web-user-b/.test(document.querySelector('[data-testid="self-ai-server-msg"]')?.textContent ?? ''), null, { timeout: 15000 });
  const bChats = await pb.evaluate(() => document.querySelectorAll('[data-testid="self-ai-chat"] .ai-msg').length);
  const mobile = await pb.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('[W10] 다른 사용자(별도 브라우저·토큰)는 서버에서 다른 사용자로 구분, 대화 기록 분리, 모바일 폭 가로 스크롤 없음', bChats === 0 && /web-user-a/.test(serverLog) && /web-user-b/.test(serverLog) && mobile.sw <= mobile.cw + 1, { bChats, mobile });
  await ctxB.close();
  check('[W11] 진행 중 페이지 에러 없음', pageErrors.length === 0, pageErrors);
} finally {
  await browser.close().catch(() => {});
  if (server && server.exitCode === null) server.kill();
}
const passed = results.filter((r) => r.pass).length;
console.log('\nUI timings (send → rendered, ms):', JSON.stringify(timings));
fs.writeFileSync(path.join(APP, 'data/audit/self-ai/qa-web-self-ai-server.json'), JSON.stringify({ at: new Date().toISOString(), results, timings, serverLog: serverLog.split('\n').filter(Boolean).slice(0, 80) }, null, 2));
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
