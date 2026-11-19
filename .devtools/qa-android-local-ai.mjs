// Android 로컬 AI 엔진 + 성능 측정 — the installed MARTIALDEX APK on a device/emulator over adb.
// Talks to the app's WebView through Chrome DevTools (debug builds enable WebView debugging).
//
//   node .devtools/qa-android-local-ai.mjs [--serial <id>] [--phase baseline|engine|model] [--label <name>]
//
//   baseline : AI unused — cold start (am start -W), screen transitions (home → 기술 목록 → 기술 상세 →
//              AI 코치 → Visual Mitt → 자세 측정), app PSS. Run on the old and the new APK to compare.
//   engine   : engine wiring without any download — plugin present, status, a download WITHOUT approval
//              is refused, start without a model → MODEL_MISSING, Gemini never involved.
//   model    : needs a model the USER downloaded in the app — load time, PSS before/after load, CPU,
//              tokens/s, temperature, battery, 종료 → memory back, the common provider answers.
// Results: data/audit/android-local-ai/<label>-<phase>-<serial>.json. Never downloads a model, never
// calls a paid API (GEMINI is not touched), never writes to Supabase.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ADB = path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb');
const PKG = 'com.martialdex.testbuild';
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const serial = arg('--serial', execFileSync(ADB, ['devices']).toString().split('\n').slice(1).find((l) => /\tdevice$/.test(l))?.split('\t')[0]);
const phase = arg('--phase', 'engine');
const label = arg('--label', 'current');
if (!serial) {
  console.log('SKIP — no adb device');
  process.exit(0);
}
const adb = (...a) => execFileSync(ADB, ['-s', serial, ...a], { maxBuffer: 1 << 24 }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { serial, phase, label, at: new Date().toISOString(), device: {}, checks: [], metrics: {} };
let fail = 0;
const check = (name, ok, info) => {
  if (!ok) fail++;
  results.checks.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ` :: ${JSON.stringify(info).slice(0, 300)}` : ''}`);
};
const metric = (k, v) => {
  results.metrics[k] = v;
  console.log(`METRIC ${k} = ${JSON.stringify(v)}`);
};

results.device = {
  model: adb('shell', 'getprop', 'ro.product.model').trim(),
  android: adb('shell', 'getprop', 'ro.build.version.release').trim(),
  abi: adb('shell', 'getprop', 'ro.product.cpu.abi').trim(),
  emulator: adb('shell', 'getprop', 'ro.kernel.qemu').trim() === '1' || serial.startsWith('emulator-'),
  ramKb: Number(/MemTotal:\s+(\d+)/.exec(adb('shell', 'cat', '/proc/meminfo'))?.[1] ?? 0),
};
console.log(`DEVICE ${JSON.stringify(results.device)} — ${results.device.emulator ? '에뮬레이터 (성능 수치는 실기기 대표값 아님)' : '실기기'}`);

const pssKb = () => Number(/TOTAL PSS:\s+(\d+)|TOTAL\s+(\d+)/.exec(adb('shell', 'dumpsys', 'meminfo', PKG))?.slice(1).find(Boolean) ?? 0);
const appCpu = () => {
  const pid = adb('shell', 'pidof', PKG).trim();
  if (!pid) return null;
  const line = adb('shell', 'top', '-b', '-n', '1', '-p', pid).split('\n').find((l) => l.trim().startsWith(pid));
  return line ? Number(line.trim().split(/\s+/)[8]) : null; // %CPU column (of all cores ×100)
};
const battery = () => {
  const d = adb('shell', 'dumpsys', 'battery');
  return { level: Number(/level: (\d+)/.exec(d)?.[1]), tempC: Number(/temperature: (\d+)/.exec(d)?.[1]) / 10 };
};
const thermal = () => {
  const d = adb('shell', 'dumpsys', 'thermalservice');
  return Number(/Thermal Status: (\d+)/.exec(d)?.[1] ?? -1);
};

async function connect() {
  let sock = null;
  for (let i = 0; i < 30 && !sock; i++) {
    const pid = adb('shell', 'pidof', PKG).trim();
    sock = adb('shell', 'cat', '/proc/net/unix').split('\n').map((l) => /@(webview_devtools_remote_\d+)/.exec(l)?.[1]).find((x) => x && pid && x.endsWith(`_${pid}`));
    if (!sock) await sleep(1000);
  }
  if (!sock) throw new Error('WebView devtools socket not found (debug build?)');
  adb('forward', 'tcp:9333', `localabstract:${sock}`);
  // a raw CDP session on the page target (Playwright's browser-level CDP is not supported by Android WebView)
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const target = targets.find((t) => t.type === 'page' && /localhost/.test(t.url)) ?? targets.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  };
  const send = (method, params) =>
    new Promise((res) => {
      const n = ++id;
      waiting.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  /** evaluate `fn(arg)` in the page (fn is serialized; arg must be JSON). */
  async function evaluate(fn, arg) {
    const r = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result?.result?.value;
  }
  const page = {
    evaluate,
    async waitForSelector(sel, { timeout = 20000 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await evaluate((q) => !!document.querySelector(q), sel)) return true;
        await sleep(250);
      }
      throw new Error(`timeout waiting for ${sel}`);
    },
    click: (sel) => evaluate((q) => document.querySelector(q).click(), sel),
    textContent: (sel) => evaluate((q) => document.querySelector(q)?.textContent ?? '', sel),
  };
  return { browser: { close: async () => ws.close() }, page };
}

async function coldStart() {
  adb('shell', 'am', 'force-stop', PKG);
  await sleep(1500);
  const out = adb('shell', 'am', 'start', '-S', '-W', '-n', `${PKG}/.MainActivity`);
  // TotalTime can read 0 when the launch is folded into the splash screen — WaitTime is then the usable figure
  const total = Number(/TotalTime: (\d+)/.exec(out)?.[1] ?? 0);
  return total || Number(/WaitTime: (\d+)/.exec(out)?.[1] ?? 0);
}

/** hash route → ms until `selector` is visible (React lazy route + render). */
async function transition(page, hash, selector) {
  return page.evaluate(
    async ([h, sel]) => {
      const t0 = performance.now();
      location.hash = h;
      for (;;) {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().height > 0) return Math.round(performance.now() - t0);
        if (performance.now() - t0 > 20000) return -1;
        await new Promise((r) => requestAnimationFrame(r));
      }
    },
    [hash, selector],
  );
}

const plugin = (page, method, opts = {}) => page.evaluate(([m, o]) => window.Capacitor.Plugins.LocalLlm[m](o), [method, opts]);

// ------------------------------------------------------------------ run
metric('coldStartMs', await coldStart());
await sleep(4000);
const { browser, page } = await connect();
await page.waitForSelector('h1, h2', { timeout: 30000 });

if (phase === 'baseline' || phase === 'model') {
  const routes = [
    ['home', '#/', 'h1'],
    ['techniqueList', '#/arts/boxing/techniques', '[data-testid="technique-card"], .technique-card, .card'],
    ['techniqueDetail', '#/arts/boxing/techniques/boxing__jab', 'h1'],
    ['aiCoach', '#/coach/lesson', 'h1, h2'],
    ['visualMitt', '#/visual-mitt', 'h1, h2'],
    ['poseAnalysis', '#/pose-analysis', 'h1, h2'],
  ];
  const times = {};
  for (let round = 0; round < 3; round++) {
    for (const [name, hash, sel] of routes) {
      await transition(page, '#/profile', 'h2');
      const ms = await transition(page, hash, sel);
      (times[name] ??= []).push(ms);
    }
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  metric('transitionsMedianMs', Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)])));
  await sleep(2000);
  metric('pssKbAiOff', pssKb());
}

const hasPlugin = await page.evaluate(() => !!window.Capacitor?.isPluginAvailable?.('LocalLlm'));
check('LocalLlm 플러그인 등록됨', hasPlugin);
const st = await plugin(page, 'status');
check('앱 시작만으로 엔진이 켜지지 않음', st.phase === 'off' && !st.loaded, { phase: st.phase, loaded: st.loaded });
metric('device', { ramBytes: st.deviceRamBytes, availRamBytes: st.availRamBytes, freeStorageBytes: st.freeStorageBytes, metered: st.metered });

if (phase === 'engine') {
  const noApproval = await plugin(page, 'download', { model: 'qwen2.5:3b' });
  check('승인 없는 다운로드는 거부', !noApproval.ok && noApproval.code === 'NOT_APPROVED', noApproval);
  const st2 = await plugin(page, 'status');
  check('거부 후 다운로드 진행 없음', !st2.pull, st2.pull);
  if (!st.modelInstalled) {
    const start = await plugin(page, 'start', {});
    check('모델 없음 → 시작 시 MODEL_MISSING (자동 다운로드 없음)', !start.ok && start.code === 'MODEL_MISSING', start);
    await page.evaluate(() => { location.hash = '#/profile'; });
    await page.waitForSelector('[data-testid="local-ai-panel"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="local-ai-download"]', { timeout: 20000 });
    await page.click('[data-testid="local-ai-download"]');
    await page.waitForSelector('[data-testid="model-consent"]', { timeout: 10000 });
    const consentText = await page.textContent('[data-testid="model-consent"]');
    check('승인 화면: 이름·크기·저장 공간·목적 표시', /Qwen2\.5 3B/.test(consentText) && /2\.1GB/.test(consentText) && /저장 공간/.test(consentText) && /사용 목적/.test(consentText), consentText.slice(0, 200));
    await page.click('[data-testid="model-consent-later"]');
    const st3 = await plugin(page, 'status');
    check('[나중에] → 다운로드 시작 안 함', !st3.pull);
  }
}

if (phase === 'model') {
  const s0 = await plugin(page, 'status');
  if (!s0.modelInstalled) {
    console.log('SKIP model phase — the selected model is not installed (download it in the app first).');
  } else {
    const before = pssKb();
    const b0 = battery();
    const t0 = Date.now();
    const start = await plugin(page, 'start', {});
    metric('loadMs', Date.now() - t0);
    check('모델 로딩', start.ok, start);
    await sleep(1500);
    const loaded = pssKb();
    metric('pssKb', { aiOff: before, modelLoaded: loaded, delta: loaded - before });
    const cpu = [];
    const sampler = setInterval(() => {
      try {
        cpu.push(appCpu());
      } catch {
        /* busy */
      }
    }, 1000);
    const runs = [];
    for (const q of ['잽은 언제 써? 두 문장으로 답해줘.', '로우킥을 막는 방법을 세 가지 짧게 알려줘.', '암바의 핵심 포인트를 설명해줘.']) {
      const r = await plugin(page, 'chat', { requestId: `qa-${runs.length}`, messages: [{ role: 'system', content: '당신은 MARTIALDEX 코치입니다. 한국어로 짧게 답하세요.' }, { role: 'user', content: q }], maxTokens: 160 });
      const d = await plugin(page, 'diagnostics');
      runs.push({ ok: r.ok, ms: r.ms, pieces: r.evalCount, ...d.lastRun, text: r.ok ? r.text.slice(0, 60) : r.message });
    }
    clearInterval(sampler);
    const during = pssKb();
    metric('generation', runs);
    metric('cpuPercentSamples', cpu.filter((x) => x !== null));
    metric('pssKbDuringGeneration', during);
    const diag = await plugin(page, 'diagnostics');
    metric('engineConfig', { threads: diag.threads, cores: diag.cores, contextSize: diag.contextSize, loadMsNative: diag.loadMs });
    const b1 = battery();
    metric('battery', { before: b0, after: b1, thermalStatus: thermal() });
    check('응답 3회 성공', runs.every((r) => r.ok), runs.map((r) => r.text));
    const stop = await plugin(page, 'stop', {});
    await sleep(3000);
    const after = pssKb();
    metric('pssKbAfterStop', after);
    check('종료 → 메모리 회복 (모델 로딩 전 +150MB 이내)', stop.ok && after < before + 150 * 1024, { before, loaded, after });
    const s1 = await plugin(page, 'status');
    check('종료 후 상태 꺼짐', s1.phase === 'off' && !s1.loaded, s1.phase);
  }
}

await browser.close().catch(() => {});
adb('forward', '--remove', 'tcp:9333');
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data/audit/android-local-ai');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${label}-${phase}-${serial.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify(results, null, 2));
console.log(`\n${results.checks.length - fail}/${results.checks.length} passed`);
process.exit(fail ? 1 : 0);
