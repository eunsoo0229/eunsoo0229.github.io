// Adds web evidence to curation candidates (data/curated/knowledge-candidates.json)
// with the app's own self-hosted search (electron/selfSearch: SearXNG + page
// extraction, robots.txt respected, no CAPTCHA/login bypass).
//
// What code can check, and therefore what this claims:
//   technique candidate — pages (body text, not search snippets) that name the technique
//     in the art: ≥2 different sites → multi_source, 1 → single_source (existence/name).
//   description / korean_name — the same name check is recorded as `webChecked`, but the
//     status is NOT raised: whether an English page says the same thing as a Korean
//     description is a judgement a person makes when approving.
// Requires SearXNG (SEARXNG_URL, default http://127.0.0.1:8888).
// Run: node scripts/verify-candidates-web.mjs <candidate-id-prefix> [...]
//   e.g. node scripts/verify-candidates-web.mjs technique:wrestling__single-leg-takedown description:wrestling__high-single
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const { research } = require(path.join(APP, 'electron/selfSearch/index.cjs'));
const FILE = path.join(APP, 'data/curated/knowledge-candidates.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const prefixes = process.argv.slice(2);
if (!prefixes.length) {
  console.error('candidate id prefix required');
  process.exit(1);
}
const processed = Object.fromEntries(fs.readdirSync(path.join(APP, 'data/processed')).filter((f) => !f.startsWith('_')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(APP, 'data/processed', f), 'utf8')).techniques.map((t) => [t.id, t])));
const ART_EN = { wrestling: 'wrestling', bjj: 'bjj', judo: 'judo', boxing: 'boxing', kickboxing: 'kickboxing', 'muay-thai': 'muay thai', sambo: 'sambo', karate: 'karate', taekwondo: 'taekwondo' };
const site = (u) => { try { return new URL(u).hostname.replace(/^(www|m)\./, ''); } catch { return u; } };
const words = (s) => s.toLowerCase().replace(/[-_/]/g, ' ').split(/\s+/).filter(Boolean);
/** A body sentence that contains the technique's name (all its words, in order, adjacent) and the art. */
function nameSentence(text, name, art) {
  const target = words(name).join(' ');
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((s) => s.length >= 25 && s.length <= 400);
  const hits = sentences.filter((s) => ` ${words(s).join(' ')} `.includes(` ${target} `));
  const inArt = text.toLowerCase().includes(art.split(' ')[0]);
  return inArt ? hits[0] ?? null : null;
}

const targets = data.candidates.filter((c) => prefixes.some((p) => c.id.startsWith(p)));
console.log(`candidates: ${targets.length}`);
for (const c of targets) {
  const name = c.kind === 'technique' ? c.technique.name : processed[c.targetId]?.name ?? c.targetId;
  const art = ART_EN[c.martialArt] ?? c.martialArt;
  const t0 = Date.now();
  const res = await research({ query: `${name} ${art} technique`, kind: 'web', maxResults: 8, extractTop: 6, queries: [`how to ${name} ${art}`] }).catch((e) => ({ ok: false, message: String(e) }));
  if (!res.ok) {
    console.log(`${c.id}: search failed — ${res.message ?? res.code}`);
    continue;
  }
  const found = [];
  for (const r of res.results) {
    if (!r.content) continue; // only text that was really read
    const q = nameSentence(r.content, name, art);
    if (q && !found.some((f) => site(f.ref) === site(r.url))) found.push({ kind: 'web', ref: r.url, title: r.title, quote: q, quoteInBody: true });
  }
  const read = res.results.filter((r) => r.content).length;
  c.webChecked = { at: new Date().toISOString(), query: `${name} ${art} technique`, results: res.results.length, pagesRead: read, sitesNamingIt: found.map((f) => site(f.ref)) };
  if (c.kind === 'technique') {
    c.sources = [...c.sources.filter((s) => s.kind !== 'web'), ...found];
    const internal = c.sources.some((s) => s.kind !== 'web');
    const sites = new Set(found.map((f) => site(f.ref))).size + (internal ? 1 : 0);
    if (sites >= 2) {
      c.status = 'multi_source';
      c.statusReason = `기술의 존재·이름: 내부 백과사전${found.length ? ` + 외부 ${found.length}곳(${found.map((f) => site(f.ref)).join(', ')})의 본문` : ''}에서 확인. 설명 문장은 내부 백과사전 기준(사람 검토 필요)`;
    }
  } else {
    c.statusReason = `${c.statusReason.replace(/ \/ 외부:.*$/, '')} / 외부: 기술 이름이 본문에 나오는 곳 ${found.length}곳(설명 내용 대조는 하지 않음)`;
  }
  console.log(`${c.id}: ${Date.now() - t0}ms results=${res.results.length} read=${read} naming=${found.length} → ${c.status}`);
}
fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
console.log(`saved ${path.relative(APP, FILE)}`);
