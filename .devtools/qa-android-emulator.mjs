// Android (Capacitor WebView) smoke QA on a HEADLESS emulator — not a real device. The debug APK's WebView is driven
// over the page's DevTools websocket (adb forward; the emulator's WebView 103 has no browser-level CDP endpoint, so
// this is a minimal Runtime.evaluate client instead of Playwright); the emulator's emulated camera is the camera (a test scene, no person).
//   emulator -avd <avd> -no-window -no-audio -camera-front emulated -camera-back emulated
//   adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell pm grant com.martialdex.testbuild android.permission.CAMERA
//   adb root && adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>   (the app must be running)
//   node .devtools/qa-android-emulator.mjs
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 300) : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const target = targets.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description?.slice(0, 200));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
const waitFor = async (expression, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await ev(expression).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
};
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const click = (sel) => ev(`${q(sel)}.click()`);
await send('Runtime.enable');
try {
  check('[A0] Capacitor WebView 연결', /localhost|capacitor/.test(target.url), target.url);
  const ua = await ev('navigator.userAgent');
  check('[A0] Android WebView', /Android/.test(ua) && /wv\)/.test(ua), ua);
  await ev(`localStorage.removeItem('martialdex:pose-records')`);
  await ev(`(location.hash = '#/arts/boxing/techniques/boxing__cross')`);
  await waitFor(`!!${q('[data-testid="motion3d-card"]')}`, 60000);
  check('[A1] 기술 탭 3D 카드 (크로스 v2 오소독스 기본)', (await ev(`${q('[data-testid="motion3d-card"]')}?.dataset.clip`)) === 'boxing-cross-m2m-v3');
  await click('[data-testid="motion3d-open"]');
  await waitFor(`!!document.querySelector('[data-testid="motion3d-stage"][data-loaded="true"], [data-testid="motion3d-error"]')`, 90000);
  const err = await ev(`${q('[data-testid="motion3d-error"]')}?.innerText ?? null`);
  // the engine pauses while the stage is off screen (by design) — on a phone the opened viewer is below the fold
  await ev(`${q('[data-testid="motion3d-stage"]')}.scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const t0 = Number(await ev(`${q('[data-testid="motion3d-stage"]')}.dataset.time`));
  await sleep(1500);
  const t1 = Number(await ev(`${q('[data-testid="motion3d-stage"]')}.dataset.time`));
  check('[A2] WebView에서 캐릭터+애니메이션 GLB 로딩·재생 (WebGL)', !err && t1 !== t0, { err, t0, t1 });
  await click('[data-testid="motion3d-close"]');
  await sleep(300);
  check('[A3] 닫기 → canvas 해제', (await ev(`document.querySelectorAll('canvas').length`)) === 0);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('내 자세 분석하기')).click()`);
  await waitFor(`!!${q('[data-testid="pose-modal"]')}`, 20000);
  const ready = await waitFor(`!!document.querySelector('[data-testid="pose-capture-start"]:not([disabled])')`, 120000);
  const camText = await ev(`${q('[data-testid="pose-camera-frame"]')}?.innerText`);
  if (!ready) console.log('   camera probe:', await ev(`navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }).then((s) => (s.getTracks().forEach((t) => t.stop()), 'ok')).catch((e) => e.name + ': ' + e.message)`));
  check('[A4] 카메라 권한·MediaPipe 모델·3D 기준 준비 → 시작 버튼 활성 (1.33초)', ready && /1\.33초/.test(await ev(`${q('[data-testid="pose-capture-start"]')}.innerText`)), { camText });
  if (ready) {
    // timing measured inside the page (no DevTools round trip)
    await ev(`(() => { const log = (window.__t = {}); log.start = performance.now(); new MutationObserver(() => { const g = !!document.querySelector('[data-testid="capture-gauge"]'); if (g && !log.on) log.on = performance.now(); if (!g && log.on && !log.off) log.off = performance.now(); }).observe(document.body, { subtree: true, childList: true }); return true; })()`);
    await click('[data-testid="pose-capture-start"]');
    await waitFor(`!!${q('[data-testid="pose-result"]')}`, 30000);
    const t = await ev('window.__t');
    const r = await ev(`(() => { const e = ${q('[data-testid="pose-result"]')}; return { ok: e.dataset.ok, planned: Number(e.dataset.plannedMs), actual: Number(e.dataset.actualMs), retake: [...e.querySelectorAll('[data-retake]')].map((x) => x.dataset.retake) }; })()`);
    const rec = await ev(`(() => { const e = ${q('[data-testid="pose-result"]')}; return { latency: Number(e.dataset.stopLatencyMs), frames: Number(e.dataset.frames) }; })()`);
    // screen timings are as the page saw them; a slow CPU (software-rendered emulator running MediaPipe on the main
    // thread) delays both — the recorded window must still be exactly the reference length
    check('[A5] 촬영 구간 = 기준 길이 1333 ms (단조 시계로 고정, 늦은 종료 지연은 기록)', r.planned === 1333 && Math.abs(r.actual - 1333) <= 1 && Number.isFinite(rec.latency) && t.on - t.start >= 2900, { countdownSeenMs: Math.round(t.on - t.start), gaugeSeenMs: Math.round(t.off - t.on), stopLatencyMs: rec.latency, frames: rec.frames, r });
    check('[A6] 사람 없는 에뮬레이터 카메라 → 다시 촬영 안내, 점수·기록 없음', r.ok === 'false' && (await ev(`JSON.parse(localStorage.getItem('martialdex:pose-records') || '[]').length`)) === 0, r);
  }
  await click('[data-testid="pose-modal-close"]');
  check('[A7] 페이지 오류 없음', errors.length === 0, errors);
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  ws.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
