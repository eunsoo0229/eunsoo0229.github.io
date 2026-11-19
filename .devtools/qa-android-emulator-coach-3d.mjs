// 42개 문제 — Android(Capacitor WebView) 플랫폼 검증. 에뮬레이터(창 없음)에 현재 코드로 빌드한 debug APK를
// 설치하고, WebView 원격 디버깅의 "페이지" CDP(Runtime.evaluate)로 실제 앱 화면을 사용자처럼 조작한다.
// (에뮬레이터 시스템 WebView 103은 Playwright의 브라우저 수준 CDP 연결을 지원하지 않아 페이지 CDP를 직접 쓴다.)
//   1. 자체 AI 코치 채팅: "JAB의 3D 프리뷰 화면 띄워줘" → 채팅 안 3D 캔버스 / "잽 기술 상세 화면 열어줘" → 화면 이동
//   2. 기술 상세 → 자세 분석 → 기준 영상 비교 → 3D 시연 녹화(측면) → 실제 녹화·등록 → 저장된 기준(각도·크기)
//   3. 촬영 화면: 기준 각도(측면) 안내
// 실기기가 아니라 에뮬레이터(x86_64, API 33)다. 카메라 촬영·Gemini 판정은 하지 않는다(로그인·유료 호출 필요).
// 앱 데이터는 에뮬레이터 안의 테스트 설치본에만 생긴다(사용자 기기·계정과 무관).
//   node .devtools/qa-android-emulator-coach-3d.mjs
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
const APK = '/Users/swcho/Documents/MARTIALDEX/android/app/build/outputs/apk/debug/app-debug.apk';
const PKG = 'com.martialdex.testbuild';
const PORT = 9333;
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 260)}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('device:', adb('shell', 'getprop', 'ro.product.model'), '· Android', adb('shell', 'getprop', 'ro.build.version.release'));
adb('install', '-r', '-g', APK);
adb('shell', 'pm', 'clear', PKG); // fresh test install data
adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
let sock = null;
for (let i = 0; i < 40 && !sock; i++) {
  await sleep(1500);
  let pid = '';
  try { pid = adb('shell', 'pidof', PKG); } catch { pid = ''; }
  if (pid) sock = adb('shell', 'cat', '/proc/net/unix').split('\n').map((l) => l.trim().split(/\s+/).pop()).find((s) => s === `@webview_devtools_remote_${pid}`);
}
check('앱 실행 + WebView 원격 디버깅 소켓', !!sock, sock);
try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* none */ }
adb('forward', `tcp:${PORT}`, `localabstract:${sock.slice(1)}`);
let target = null;
for (let i = 0; i < 20 && !target; i++) {
  await sleep(1000);
  const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => []);
  target = list.find((t) => t.type === 'page');
}
const ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
console.log('WebView:', ver.Browser);

// ---- minimal page CDP client
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error');
  return r.result?.result?.value;
};
const waitFor = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(`return !!(${cond});`).catch(() => false)) return true; await sleep(500); } return false; };
const tid = (id) => `document.querySelector('[data-testid="${id}"]')`;
const click = (id) => ev(`${tid(id)}.click(); return true;`);
// React-controlled textarea: use the native value setter, then an input event
const type = (id, text) => ev(`const el = ${tid(id)}; const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}; return true;`); await sleep(3000); };

try {
  await waitFor(`document.readyState === 'complete' && document.querySelector('#root')?.children.length`, 30000);
  const env = await ev(`return { capacitor: !!window.Capacitor, platform: window.Capacitor?.getPlatform?.(), electron: !!window.martialdex };`);
  check('Capacitor Android 환경 (Electron 아님)', env.capacitor && env.platform === 'android' && !env.electron, env);

  console.log('\n[1] 채팅 앱 액션 (Android)');
  await go('#/coach/chat');
  await waitFor(tid('self-ai-input'), 20000);
  await type('self-ai-input', 'JAB의 3D 프리뷰 화면 띄워줘');
  await click('self-ai-send');
  const canvasOk = await waitFor(`[...document.querySelectorAll('[data-testid="chat-motion3d-card"] canvas')].some((c) => c.width > 0)`, 90000);
  check('Android에서 채팅 안에 3D 시연이 열리고 캔버스가 그려짐', canvasOk, await ev(`return document.querySelector('.ai-msg--model:last-of-type')?.innerText?.slice(0, 120) ?? null;`).catch(() => null));
  await type('self-ai-input', '잽 기술 상세 화면 열어줘');
  await click('self-ai-send');
  const moved = await waitFor(`location.hash.includes('/techniques/kickboxing__jab')`, 60000);
  check('Android에서 기술 상세 화면으로 실제 이동', moved, await ev('return location.hash;'));

  console.log('\n[2] 3D 기준 영상 녹화·등록 (Android)');
  const caps = await ev(`return { captureStream: typeof HTMLCanvasElement.prototype.captureStream === 'function', recorder: typeof MediaRecorder !== 'undefined', vp9: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'), vp8: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8'), mp4: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4'), requestFrame: typeof CanvasCaptureMediaStreamTrack !== 'undefined' && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype };`);
  console.log('   ', JSON.stringify(caps));
  check('WebView captureStream + MediaRecorder 지원', caps.captureStream && caps.recorder && (caps.vp9 || caps.vp8 || caps.mp4), caps);
  await go('#/');
  await go('#/arts/boxing/techniques/boxing__jab?open=pose');
  check('자세 분석에서 기준 영상 비교 진입점', await waitFor(tid('pose-to-form-compare'), 30000));
  await click('pose-to-form-compare');
  await waitFor(tid('form-compare'), 15000);
  if (await ev(`return !!${tid('form-ref-add')};`)) await click('form-ref-add');
  await waitFor(tid('form-ref-kind-motion3d'), 10000);
  await click('form-ref-kind-motion3d');
  await waitFor(tid('form-ref-3d-angle-side'), 20000);
  await click('form-ref-3d-angle-side');
  const ready = await waitFor(`${tid('form-ref-3d-record')} && !${tid('form-ref-3d-record')}.disabled`, 90000);
  check('3D 엔진 준비 후 녹화 버튼 활성화', ready);
  await click('form-ref-3d-record');
  const done = await waitFor(`JSON.parse(localStorage.getItem('martialdex:form-reference-videos') || '[]').some((r) => r.source?.kind === 'motion3d') || ${tid('form-ref-3d-stage')}?.dataset.stage === 'failed'`, 150000);
  const created = await ev(`return JSON.parse(localStorage.getItem('martialdex:form-reference-videos') || '[]').find((r) => r.source?.kind === 'motion3d') ?? { stage: ${tid('form-ref-3d-stage')}?.dataset.stage ?? null, text: ${tid('form-ref-3d-stage')}?.innerText ?? null };`);
  check('Android에서 3D 녹화 → 기준 영상 등록 (motion3d · 측면 · 실제 파일)', done && created?.source?.kind === 'motion3d' && created.source.angle === 'side' && created.source.sizeBytes > 4096, created?.source ?? created);
  if (created?.source) console.log('    녹화 파일:', JSON.stringify({ bytes: created.source.sizeBytes, mime: created.source.mimeType, durationSeconds: created.source.durationSeconds, clipDurationSeconds: created.source.clipDurationSeconds }));
  const stored = await ev(`return await new Promise((res) => { const rq = indexedDB.open('martialdex-form-compare'); rq.onerror = () => res(null); rq.onsuccess = () => { try { const db = rq.result; const names = [...db.objectStoreNames]; res(names); } catch { res(null); } }; });`).catch(() => null);
  console.log('    IndexedDB stores:', JSON.stringify(stored));

  console.log('\n[3] 촬영 화면 각도 안내 (Android)');
  const hasNext = await waitFor(tid('form-ref-next') + ' || ' + tid('form-ref-build'), 30000);
  // the criteria build needs Gemini (login + paid) — not run here; the reference card shows the chosen angle
  check('등록 후 기준 영상 카드에 고른 각도(측면) 표시', hasNext && (await ev(`return ${tid('form-ref-current')}?.dataset.angle ?? null;`)) === 'side');
} catch (e) {
  fail++;
  console.log('  FAIL  예외 ::', String(e).slice(0, 300));
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
ws.close();
try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
