// 4차 performance / memory on this Mac (hidden + muted Electron, separate profile):
//   - code-only turns (personal / training / pose request): time, and renderer JS heap after GC
//     before and after 40 repeated turns (a leak shows as steady growth)
//   - model turns (smalltalk, motivation) with qwen2.5:3b: first token, total, output tokens
//   - Ollama resident model size, system swap
// Writes data/audit/self-ai/bench-phase4.json.  Requires Vite :5173, Ollama, SearXNG.
import { _electron as electron } from 'playwright-core';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-bench4-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const swap = () => execSync('sysctl -n vm.swapusage').toString().trim();
const report = { at: new Date().toISOString(), swapBefore: swap() };
const app = await electron.launch({ executablePath: electronBin, args: ['--js-flags=--expose-gc', APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!window.martialdex?.research, null, { timeout: 20000 });
  const r = await page.evaluate(async () => {
    const { runCoachTurn } = await import('/src/lib/selfAi/coachAgent.ts');
    const { appCoachDeps } = await import('/src/lib/selfAi/deps.ts');
    const deps = appCoachDeps();
    const heap = () => { window.gc?.(); return Math.round(performance.memory.usedJSHeapSize / 1e6); };
    const code = ['내 레슬링 실력에서 부족한 부분을 분석해 줘.', '레슬링 솔로 드릴 훈련을 하고 싶어.', '복싱 솔로 드릴 수업 만들어 줘.', '내가 배운 기술로 만들 수 있는 레슬링 콤보는?'];
    const times = {};
    for (const q of code) { const t0 = performance.now(); await runCoachTurn({ text: q, history: [], martialArt: null, requestId: `b${Date.now()}` }, deps); times[q] = Math.round(performance.now() - t0); }
    const h0 = heap();
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) await runCoachTurn({ text: code[i % code.length], history: [], martialArt: null, requestId: `r${i}` }, deps);
    const loopMs = Math.round(performance.now() - t0);
    const h1 = heap();
    const model = {};
    for (const q of ['안녕하세요', '요즘 훈련이 너무 힘들어서 그만두고 싶어']) {
      let first = null; let ev = 0; const s = performance.now();
      await runCoachTurn({ text: q, history: [], martialArt: null, requestId: `m${Date.now()}`, onDelta: () => { first ??= Math.round(performance.now() - s); } }, { ...deps, chat: async (req, d) => { const res = await deps.chat(req, (x) => { first ??= Math.round(performance.now() - s); d?.(x); }); if (res.ok) ev = res.evalCount; return res; } });
      model[q] = { totalMs: Math.round(performance.now() - s), firstTokenMs: first, outputTokens: ev };
    }
    return { codeTurnMs: times, heapMB: { before40: h0, after40: h1 }, fortyTurnsMs: loopMs, model };
  });
  Object.assign(report, r);
  const mem = await app.evaluate(async ({ app: a }) => a.getAppMetrics().reduce((n, p) => n + p.memory.workingSetSize, 0));
  report.electronWorkingSetMB = Math.round(mem / 1024);
} finally {
  await app.close().catch(() => {});
}
try {
  const ps = await fetch('http://127.0.0.1:11434/api/ps').then((x) => x.json());
  report.ollama = ps.models?.map((m) => ({ name: m.name, sizeGB: +(m.size / 1e9).toFixed(2) }));
} catch { report.ollama = null; }
report.swapAfter = swap();
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/bench-phase4.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
