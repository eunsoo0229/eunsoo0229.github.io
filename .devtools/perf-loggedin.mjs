// Phone-like (CPU ×6) startup WHILE LOGGED IN — the case perf-mobile.mjs (logged out) misses:
// login sync fires many "...-updated" events and every listener recomputes.
// Needs: vite preview on :4173 (unminified build gives function names) and an account:
//   LOGIN_ID=... LOGIN_PW=... node .devtools/perf-loggedin.mjs [throttle]   (fresh profile: sync only pulls)
import fs from 'node:fs';
import { _electron as electron } from 'playwright-core';
const THROTTLE = Number(process.argv[2] ?? 6);
const acc = { email: process.env.LOGIN_ID, password: process.env.LOGIN_PW };
if (!acc.email || !acc.password) { console.error('LOGIN_ID / LOGIN_PW required'); process.exit(2); }
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', args: ['.', `--user-data-dir=${fs.mkdtempSync('/tmp/mdex-perf-')}`], env });
await new Promise((r) => setTimeout(r, 3000));
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${process.env.PREVIEW_URL ?? 'http://localhost:4173'}/#/login`, { waitUntil: 'load' });
await page.waitForSelector('input[autocomplete="username"], input[type="email"]');
await page.fill('input[autocomplete="username"], input[type="email"]', acc.email);
await page.fill('input[type=password]', acc.password);
await page.keyboard.press('Enter');
await page.waitForTimeout(8000);
await page.evaluate(() => [...document.querySelectorAll('.modal-overlay button')].find((b) => b.textContent?.trim() === '나중에')?.click());
await page.waitForTimeout(2000);
// count custom events + long main-thread blocks from the very start of a cold reload
await page.addInitScript(() => {
  window.__ev = {}; const orig = window.dispatchEvent.bind(window);
  window.dispatchEvent = (e) => { window.__ev[e.type] = (window.__ev[e.type] ?? 0) + 1; return orig(e); };
  window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((x) => window.__lt.push(Math.round(x.duration)))).observe({ type: 'longtask', buffered: true }); } catch {}
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 400 });
await cdp.send('Profiler.start');
const t0 = Date.now();
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.page', { timeout: 120000 });
const firstPaint = Date.now() - t0;
await page.waitForTimeout(12000); // let the login sync land
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map();
profile.samples.forEach((id, i) => { const cf = byId.get(id).callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
// inclusive time per function name (top of stacks) — find the expensive callers
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
profile.samples.forEach((id, i) => { const seen = new Set(); let cur = id; while (cur) { const cf = byId.get(cur).callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`; if (cf.url && !seen.has(k)) { incl.set(k, (incl.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); seen.add(k); } cur = parent.get(cur); } });
// screen switches (logged in, same throttle) — time until the route's content is up and the main thread is free
const NAV_SCREENS = [['기술 목록', '#/techniques'], ['기술 상세', '#/arts/bjj/techniques/bjj__armbar'], ['AI 코치', '#/coach'], ['나의 기술', '#/my-skills'], ['복습', '#/review'], ['홈', '#/']];
const nav = {};
for (const [label, hash] of NAV_SCREENS) {
  const t = Date.now();
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(80);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  nav[label] = Date.now() - t;
}
const ev = await page.evaluate(() => window.__ev);
const lt = await page.evaluate(() => window.__lt);
console.log(JSON.stringify({ throttle: THROTTLE, firstPaintMs: firstPaint, nav, longTasks: { count: lt.length, totalMs: lt.reduce((a, b) => a + b, 0), max: Math.max(0, ...lt) }, events: ev }, null, 1));
console.log('-- self'); console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${Math.round(v)}ms ${k}`).join('\n'));
console.log('-- inclusive (app code)'); console.log([...incl].filter(([k]) => /\.js:/.test(k) && !/^\(anon\)|^(r|s|o|i|a|l|c|u|d)\s/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v)}ms ${k}`).join('\n'));
await app.close();
