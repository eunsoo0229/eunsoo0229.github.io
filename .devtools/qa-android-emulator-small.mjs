// Android 작은 화면 가림 점검 (실제 Capacitor WebView). 에뮬레이터(창 없음)의 화면을 360×640dp · 320×568dp 로 줄이고
// 현재 코드로 빌드한 debug APK 를 설치·실행해, 페이지 CDP 로 각 라우트를 열어 .devtools/lib/occlusion-inspect.mjs 검사를 돌린다.
// 비로그인 상태로만 연다(로그인·가입·AI 호출 없음). 공개 카탈로그 읽기만 운영 Supabase 로 나간다(앱의 평소 비로그인 동작).
// 끝나면 에뮬레이터 화면 크기·밀도를 원래대로 되돌린다.
//   SHOT_DIR=/path node .devtools/qa-android-emulator-small.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from './lib/occlusion-inspect.mjs';

const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
const APK = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../android/app/build/outputs/apk/debug/app-debug.apk');
const PKG = 'com.martialdex.testbuild';
const PORT = 9334;
const SHOTS = process.env.SHOT_DIR ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const adbRaw = (...a) => execFileSync(ADB, a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;

const ROUTES = [
  '/', '/arts', '/arts/boxing', '/arts/boxing/techniques', '/arts/boxing/techniques/boxing__jab', '/techniques', '/learning', '/learning/boxing',
  '/coach', '/coach/chat', '/training', '/program', '/progress', '/my-skills', '/stats', '/community', '/gyms', '/gyms/deals', '/gyms/compare',
  '/gear', '/fighter-profile', '/profile', '/favorites', '/combos', '/graph', '/nutrition', '/gym', '/sparring', '/review', '/marketplace',
  '/login', '/signup', '/reset-password', '/does-not-exist',
];
const SIZES = [
  { name: '360x640dp', size: '720x1280', density: '320' },
  { name: '320x568dp', size: '640x1136', density: '320' },
];

async function launch() {
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  let sock = null;
  for (let i = 0; i < 40 && !sock; i++) {
    await sleep(1500);
    let pid = '';
    try { pid = adb('shell', 'pidof', PKG); } catch { pid = ''; }
    if (pid) sock = adb('shell', 'cat', '/proc/net/unix').split('\n').map((l) => l.trim().split(/\s+/).pop()).find((s) => s === `@webview_devtools_remote_${pid}`);
  }
  if (!sock) throw new Error('WebView devtools socket not found');
  try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* none */ }
  adb('forward', `tcp:${PORT}`, `localabstract:${sock.slice(1)}`);
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    await sleep(1000);
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => []);
    target = list.find((t) => t.type === 'page');
  }
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
  return { ws, ev };
}

console.log('device:', adb('shell', 'getprop', 'ro.product.model'), '· Android', adb('shell', 'getprop', 'ro.build.version.release'));
adb('install', '-r', '-g', APK);
adb('shell', 'pm', 'clear', PKG);
try {
  for (const sz of SIZES) {
    adb('shell', 'wm', 'size', sz.size);
    adb('shell', 'wm', 'density', sz.density);
    await sleep(1500);
    const { ws, ev } = await launch();
    await sleep(4000);
    const env = await ev(`return { w: innerWidth, h: innerHeight, sat: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'), barTop: document.querySelector('.mx-bar')?.getBoundingClientRect().top, ua: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] };`);
    console.log(`\n[${sz.name}] viewport ${env.w}×${env.h} · WebView ${env.ua} · safe-area-top '${env.sat}' · 상단 바 top ${env.barTop}`);
    for (const r of ROUTES) {
      await ev(`location.hash = '#${r}'; return true;`);
      await sleep(2200);
      await ev(`const m = [...document.querySelectorAll('.modal-overlay')].find((x) => x.innerText.includes('기존 데이터를 계정에 저장할까요')); m?.querySelector('.btn-ghost')?.click(); return true;`);
      const probs = await ev(`return (${inspect.toString()})();`);
      if (probs.length) { fail++; console.log(`  FAIL  ${sz.name} ${r}`); for (const p of probs.slice(0, 10)) console.log(`        - ${p}`); }
      else pass++;
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${sz.name}${r.replace(/[/:]/g, '_') || '_home'}.png`), adbRaw('exec-out', 'screencap', '-p'));
    }
    // toast vs tab bar
    await ev(`location.hash = '#/'; return true;`);
    await sleep(1500);
    const overlap = await ev(`const t = document.createElement('div'); t.className = 'notif-toast mx-toast'; t.textContent = '클랜 초대가 왔습니다. 수락 거절'; document.body.appendChild(t);
      const a = t.getBoundingClientRect(), bar = document.querySelector('.mx-tabbar')?.getBoundingClientRect(); t.remove(); return bar && bar.height ? Math.max(0, a.bottom - bar.top) : 0;`);
    if (overlap > 0) { fail++; console.log(`  FAIL  ${sz.name} 토스트가 탭바를 ${Math.round(overlap)}px 덮음`); } else pass++;
    ws.close();
  }
} finally {
  adb('shell', 'wm', 'size', 'reset');
  adb('shell', 'wm', 'density', 'reset');
  try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* none */ }
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} screens clean ===`);
process.exit(fail ? 1 : 0);
