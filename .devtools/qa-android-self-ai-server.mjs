// Android app (debug APK, Capacitor WebView) → MARTIALDEX self-AI server — on the Android
// EMULATOR (headless: -no-window -no-audio), not a real phone. The app reaches the server
// on this Mac through `adb reverse tcp:8787 tcp:8787` (http://localhost:8787 inside the
// device), the way a USB-connected phone would; a phone on Wi-Fi needs the HTTPS setup in
// docs/self-ai/SERVER.md instead. The server runs in front of the user's real Ollama +
// SearXNG (only the server process is stopped / restarted).
// Requires: emulator booted with the APK installed, `adb reverse tcp:8787 tcp:8787`.
// Run: node .devtools/qa-android-self-ai-server.mjs
import { _android as android } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const auth = require(path.join(APP, 'server/self-ai/auth.cjs'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfai-android-'));
const tokensFile = path.join(tmp, 'tokens.json');
const token = auth.issue(tokensFile, 'android-emulator');
const PKG = 'com.martialdex.testbuild';
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
  server = spawn(process.execPath, [path.join(APP, 'server/self-ai/server.cjs')], { env: { ...process.env, SELF_AI_SERVER_PORT: '8787', SELF_AI_SERVER_TOKENS_FILE: tokensFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let started = '';
  server.stdout.on('data', (d) => {
    serverLog += d;
    started += d;
  });
  for (let i = 0; i < 50 && !/self-AI server on/.test(started); i++) await sleep(100);
}
const stopServer = () => new Promise((r) => { server.once('exit', r); server.kill(); });

await startServer();
const [device] = await android.devices();
if (!device) throw new Error('no Android device / emulator');
const pageErrors = [];
try {
  check('[A0] 실행 환경: Android 에뮬레이터(실기기 아님)', /emulator/.test(device.serial()) , device.serial());
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`am start -n ${PKG}/.MainActivity`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  const page = await webview.page();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForLoadState('load');
  await page.evaluate(() => { window.location.hash = '#/coach/chat'; });
  await page.waitForSelector('[data-testid="self-ai-input"]', { timeout: 60000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? '확인 중'), null, { timeout: 30000 });
  const st0 = await page.textContent('[data-testid="self-ai-status"]');
  check('[A1] Android 앱(서버 미연결): 로컬 모델·검색 미지원 표시 + 서버 연결 설정', /미지원/.test(st0) && (await page.locator('[data-testid="self-ai-server-url"]').count()) === 1, st0);

  await page.fill('[data-testid="self-ai-server-url"]', 'http://localhost:8787');
  await page.fill('[data-testid="self-ai-server-token"]', token);
  await page.click('[data-testid="self-ai-server-connect"]');
  await page.waitForFunction(() => /연결됨/.test(document.querySelector('[data-testid="self-ai-server-msg"]')?.textContent ?? '') || /연결할 수 없습니다|올바르지/.test(document.querySelector('[data-testid="self-ai-server-msg"]')?.textContent ?? ''), null, { timeout: 30000 });
  const msg = await page.textContent('[data-testid="self-ai-server-msg"]');
  check('[A2] Android 앱 → 자체 AI 서버 연결(토큰 인증, 사용자 android-emulator)', /연결됨 — 사용자 android-emulator/.test(msg), msg);
  await page.waitForFunction(() => /자체 AI 서버 · 로컬 AI: 실행 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  check('[A3] 상태: 자체 AI 서버 · qwen2.5:3b · 자체 검색 사용 가능', /qwen2\.5:3b/.test(await page.textContent('[data-testid="self-ai-status"]')) && /자체 검색: 사용 가능/.test(await page.textContent('[data-testid="self-ai-status"]')));

  const ANSWERS = '[data-testid="self-ai-chat"] .ai-msg--model:not(.ai-msg--pending)';
  async function ask(id, text, timeout = 300000) {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, ANSWERS);
    await page.fill('[data-testid="self-ai-input"]', text);
    const t0 = Date.now();
    await page.click('[data-testid="self-ai-send"]');
    await page.waitForFunction(([n, sel]) => document.querySelectorAll(sel).length > n && !document.querySelector('[data-testid="self-ai-busy"]'), [n, ANSWERS], { timeout });
    timings[id] = Date.now() - t0;
    return page.evaluate((sel) => [...document.querySelectorAll(sel)].pop()?.innerText ?? '', ANSWERS);
  }
  const v = await ask('android_video', '레슬링 싱글렉을 배울 수 있는 교육 영상을 찾아 줘.');
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="self-ai-videos"]')].pop()?.querySelectorAll('.video-card').length ?? 0);
  check('[A4] Android에서 영상 검색(서버) → 카드', /찾은 영상 \d+개/.test(v) && cards >= 2, { cards, v: v.slice(0, 160) });
  const play = page.locator('[data-testid="self-ai-videos"] .video-card[data-embed="embeddable"] [data-testid="video-card-play"]');
  if (await play.count()) {
    await play.first().click();
    await page.waitForSelector('[data-testid="video-results-player"] iframe', { timeout: 15000 });
    const src = await page.getAttribute('[data-testid="video-results-player"] iframe', 'src');
    check('[A5] Android 앱 안 플레이어 iframe 열림(YouTube embed)', /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}/.test(src ?? ''), src);
  } else check('[A5] 재생 가능한 영상', false, v.slice(0, 160));
  const sources = await page.evaluate(() => [...document.querySelectorAll('[data-testid="self-ai-videos"] .video-card a[href]')].map((a) => a.getAttribute('href')).slice(0, 3));
  check('[A6] 검색 결과 출처(원본 링크) 보존', sources.length > 0 && sources.every((h) => /^https:\/\//.test(h ?? '')), sources);
  const t = await ask('android_technique', '레슬링 싱글렉이 뭐야?');
  check('[A7] 기술 계열 질문 → 같은 코드 답변(레슬링 싱글 레그 기록)', /싱글 레그/.test(t) && /High Single/.test(t), t.slice(0, 200));
  const g = await ask('android_model', '안녕하세요');
  check('[A8] 모델 답변이 서버의 qwen2.5:3b로(폰에서 모델 실행 안 함)', g.trim().length > 0 && !/사용할 수 없/.test(g) && /android-emulator POST \/v1\/chat 200/.test(serverLog), g.slice(0, 160));

  await stopServer();
  const off = await ask('android_down', '로마첸코 풋워크 영상 보여줘', 90000);
  check('[A9] 서버 종료 → 연결 실패를 그대로 안내(지어낸 결과 없음)', /실패했습니다|연결할 수 없습니다/.test(off) && !/찾은 영상/.test(off), off.slice(0, 200));
  await startServer();
  const back = await ask('android_up', '로마첸코 풋워크 영상 보여줘', 180000);
  check('[A10] 서버 재시작 → 앱에서 바로 복구', /찾은 영상 \d+개/.test(back), back.slice(0, 200));
  const solo = await ask('android_solo', '레슬링 솔로 드릴 훈련을 하고 싶어.');
  check('[A13] (4차) Android: 레슬링 솔로 드릴 → 레슬링 수업 계획, 다른 무술 기술 없음, 수업 시작 버튼', /레슬링 솔로 드릴 수업 계획/.test(solo) && !/Guillotine|Armbar|Gyaku|Round Kick/.test(solo) && (await page.locator('[data-testid="self-ai-start-lesson"]').count()) > 0, solo.slice(0, 300));
  const tp = await ask('android_topuria', '토푸리아의 타격 스타일과 대표적인 셋업, 콤비네이션을 분석해 줘.', 300000);
  check('[A14] (4차) Android: 토푸리아 → 서버 검색으로 Ilia Topuria 분석', /Ilia Topuria/.test(tp) && /검색 과정/.test(tp), tp.slice(0, 300));
  const layout = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('[A11] 폰 화면 폭에서 가로 스크롤 없음', layout.sw <= layout.cw + 1, layout);
  check('[A12] 진행 중 페이지 에러 없음', pageErrors.length === 0, pageErrors);
} finally {
  await device.shell(`am force-stop ${PKG}`).catch(() => {});
  await device.close().catch(() => {});
  if (server && server.exitCode === null) server.kill();
}
const passed = results.filter((r) => r.pass).length;
console.log('\nUI timings (send → rendered, ms):', JSON.stringify(timings));
fs.writeFileSync(path.join(APP, 'data/audit/self-ai/qa-android-self-ai-server.json'), JSON.stringify({ at: new Date().toISOString(), device: 'Android emulator Pixel_3a_API_33_x86_64 (headless) — not a real phone', results, timings }, null, 2));
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
