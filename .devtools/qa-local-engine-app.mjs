// 통합 로컬 AI 엔진 — inside the real Electron app (hidden + muted automation launch, see main.cjs).
// Settings panel → 로컬 AI 시작 (Ollama spawned by the app) → the common provider (aiProvider.ask)
// answers with the local model · image input refused · engine off → guidance (never Gemini)
// · Gemini only by explicit engine · quitting the app stops the Ollama it started.
// GEMINI_API_KEY is blanked for this launch, so any Gemini call would show up as NO_API_KEY (no paid call possible).
// Requires the Vite dev server of THIS folder on :5173 and no other Ollama on 11434.
// Run: node .devtools/qa-local-engine-app.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = '/Users/swcho/Documents/MARTIALDEX';
let pass = 0;
let fail = 0;
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  const d = info === undefined ? '' : typeof info === 'string' ? info : JSON.stringify(info);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${d ? ` :: ${d.slice(0, 400)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
if (await up()) {
  console.log('SKIP — an Ollama server already runs on 11434 (stop it so the app can own one).');
  process.exit(0);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-localengine-'));
const env = { ...process.env, MARTIALDEX_HEADLESS: '1', GEMINI_API_KEY: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${userData}`], env, timeout: 120000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.waitForLoadState('domcontentloaded');
check('앱 실행 직후 Ollama를 띄우지 않음 (AI 미사용 상태)', !(await up()));

await page.goto('http://localhost:5173/#/profile'); // HashRouter
await page.waitForSelector('[data-testid="local-ai-panel"]', { timeout: 30000 });
await page.waitForSelector('[data-testid="local-ai-phase"]', { timeout: 30000 });
check('설정 패널 표시 · 상태 꺼짐', (await page.getAttribute('[data-testid="local-ai-phase"]', 'data-phase')) === 'off');
check('기본 엔진 = 로컬', (await page.getAttribute('[data-testid="ai-engine-choice-local"]', 'aria-checked')) === 'true');

const ask = (req) =>
  page.evaluate(async (r) => {
    const { aiProvider } = await import('/src/lib/ai/provider.ts');
    const t0 = Date.now();
    const out = await aiProvider.ask({ systemInstruction: '', contextText: '', history: [], ...r });
    return { ...out, ms: Date.now() - t0 };
  }, req);

// engine off + model already installed → the app starts it by itself (no approval prompt), never Gemini
let t0 = Date.now();
let r = await ask({ systemInstruction: '한국어로 한 문장만 답하세요.', question: '잽이 뭐야?', maxOutputTokens: 60 });
check('엔진 꺼짐 + 모델 설치됨 → 앱이 자동 시작 후 로컬 답변', r.ok && (await up()), { ...r, ms: Date.now() - t0 });
check('설치된 모델이면 다운로드 승인 화면을 띄우지 않음', !(await page.$('[data-testid="local-ai-setup"]')));
await page.click('[data-testid="local-ai-stop"]').catch(() => {});
await page.waitForFunction(() => document.querySelector('[data-testid="local-ai-phase"]')?.getAttribute('data-phase') === 'off', null, { timeout: 30000 });

t0 = Date.now();
await page.click('[data-testid="local-ai-start"]');
await page.waitForFunction(() => document.querySelector('[data-testid="local-ai-phase"]')?.getAttribute('data-phase') === 'running', null, { timeout: 300000 });
check('[로컬 AI 시작] → 실행 중 (MARTIALDEX가 실행)', /MARTIALDEX가 실행함/.test(await page.textContent('[data-testid="local-ai-phase"]')), { ms: Date.now() - t0 });
await sleep(4500);
const ram = await page.textContent('[data-testid="local-ai-ram"]');
check('모델 메모리 표시', /GB|MB/.test(ram), ram);

r = await ask({
  systemInstruction: '당신은 MARTIALDEX 코치입니다. [MARTIALDEX 자료]에 있는 내용으로만 2문장 이내로 답하세요.',
  contextText: '기술: 잽(Jab). 앞손으로 곧게 뻗는 가장 빠른 펀치. 거리 측정과 다음 공격 연결에 쓴다. 핵심: 턱을 당기고 반대 손은 얼굴 가드.',
  question: '잽은 언제 써?',
});
check('공통 Provider → 로컬 모델 답변 (자료 기반)', r.ok && /거리|연결/.test(r.text), r);

r = await ask({ question: '이 사진 자세 봐줘', imageParts: [{ mimeType: 'image/jpeg', data: 'AAAA' }] });
check('이미지 입력 → 로컬 처리 불가 안내 (Gemini 호출 없음)', !r.ok && r.code === 'LOCAL_UNSUPPORTED_INPUT', r);

r = await ask({ question: '{"ok": true} 를 그대로 출력', responseFormat: 'json', maxOutputTokens: 30 });
check('JSON 기능 요청 → 로컬 JSON 모드', r.ok && (() => { try { return JSON.parse(r.text).ok === true; } catch { return false; } })(), r);

r = await ask({ question: '안녕', engine: 'gemini' });
check('명시적 Gemini 선택일 때만 Gemini 경로 (키 없음 → NO_API_KEY)', !r.ok && r.code === 'NO_API_KEY', r);

// 종료 버튼 → 정지, 다시 시작 후 앱 종료로 정리
await page.click('[data-testid="local-ai-stop"]');
await page.waitForFunction(() => document.querySelector('[data-testid="local-ai-phase"]')?.getAttribute('data-phase') === 'off', null, { timeout: 30000 });
check('[로컬 AI 종료] → 꺼짐 · 서버 종료', !(await up()));
await page.click('[data-testid="local-ai-start"]');
await page.waitForFunction(() => document.querySelector('[data-testid="local-ai-phase"]')?.getAttribute('data-phase') === 'running', null, { timeout: 300000 });
const pid = JSON.parse(fs.readFileSync(path.join(userData, 'local-engine.pid.json'), 'utf8')).pid;
check('페이지 오류 없음', errors.length === 0, errors);
await app.close();
await sleep(1500);
let alive = true;
try {
  process.kill(pid, 0);
} catch {
  alive = false;
}
check('앱 종료 → 앱이 띄운 Ollama 정리', !alive && !(await up()), { pid, alive });

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
