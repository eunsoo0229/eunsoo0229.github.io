// Runs every offline .devtools/test-*.mjs (no browser, no Electron) with a per-test time limit and records a
// one-line result per test — used as a before/after baseline around large merges.
//   node .devtools/run-unit-tests.mjs <out.json> [--skip name,name] [--timeout 240]
// Tests that need live services are skipped by default (test-review-logs-live: real Supabase).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const skip = new Set(['test-review-logs-live', ...String(opt('--skip', '')).split(',').filter(Boolean)]);
const limit = Number(opt('--timeout', 240)) * 1000;
const tests = fs.readdirSync(path.join(APP, '.devtools')).filter((f) => /^test-.*\.mjs$/.test(f) && !skip.has(f.replace(/\.mjs$/, ''))).sort();

const run = (f) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join('.devtools', f)], { cwd: APP, env: process.env });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.stderr.on('data', (d) => (buf += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), limit);
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      const lines = buf.trim().split('\n');
      const summary = [...lines].reverse().find((l) => /\d+\s*\/\s*\d+|passed|failed|PASS|FAIL/i.test(l)) ?? lines.at(-1) ?? '';
      resolve({ test: f, code, timedOut: signal === 'SIGKILL', ms: Date.now() - t0, summary: summary.slice(0, 200), failLines: lines.filter((l) => /^FAIL|✗|AssertionError|Error:/.test(l)).slice(0, 5) });
    });
  });

const results = [];
for (const f of tests) {
  const r = await run(f);
  results.push(r);
  console.log(`${r.code === 0 ? 'OK  ' : 'FAIL'} ${f.padEnd(42)} ${r.timedOut ? 'TIMEOUT ' : ''}${r.summary}`);
}
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
console.log(`\n${results.filter((r) => r.code === 0).length}/${results.length} exited 0`);
