// Every npm package the Electron main process require()s must load in Electron's
// OWN Node runtime (Electron 32 = Node 20.18, which cannot require() an ES module),
// not just in the system Node used by the other tests (Node 22.12+/24 can).
// Regression guard for linkedom 0.18.13+ → css-select 7 (ESM-only) → ERR_REQUIRE_ESM
// at app start. Runs Electron with ELECTRON_RUN_AS_NODE — no window is created.
// Run: node .devtools/test-electron-runtime-requires.mjs
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(ROOT, 'node_modules/.bin/electron');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.c?js$/.test(e.name) ? [p] : [];
  });
}

const builtins = new Set(builtinModules);
const packages = new Set();
for (const file of walk(path.join(ROOT, 'electron'))) {
  for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (spec.startsWith('.') || spec.startsWith('node:') || builtins.has(spec.split('/')[0]) || spec === 'electron') continue;
    packages.add(spec);
  }
}

const probe = `
const out = { node: process.versions.node, results: {} };
for (const p of ${JSON.stringify([...packages])}) {
  try { require(p); out.results[p] = 'ok'; } catch (e) { out.results[p] = (e.code || 'ERROR') + ': ' + String(e.message).split('\\n')[0]; }
}
console.log(JSON.stringify(out));`;
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
const raw = execFileSync(electronBin, ['-e', probe], { cwd: ROOT, env, encoding: 'utf8' });
const { node, results } = JSON.parse(raw.trim().split('\n').pop());

let fail = 0;
console.log(`Electron runtime Node ${node} — ${packages.size} packages`);
for (const [p, r] of Object.entries(results)) {
  if (r !== 'ok') fail++;
  console.log(`${r === 'ok' ? 'PASS' : 'FAIL'} — require('${p}')${r === 'ok' ? '' : ` :: ${r}`}`);
}
console.log(`\n=== SUMMARY: ${packages.size - fail}/${packages.size} passed ===`);
process.exit(fail || packages.size === 0 ? 1 : 0);
