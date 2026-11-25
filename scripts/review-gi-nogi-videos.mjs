// Gi / No-Gi 영상 검수 — 제목만으로 "unknown" 으로 남은 영상을 **실제 영상 설명**까지 읽어 다시 판정한다.
//
// 왜 필요한가. data/curated/gi-nogi.json 의 videoStyles 는 영상 제목만 보고 만들어져서 389개 중 349개가
// unknown 이었다. 기술 화면에는 "스타일(Gi/No-Gi)이 확인되지 않은 영상 N개"로 묶여 버린다. 그런데 유튜브
// 영상은 설명·태그에 "no gi", "gi", "kimono" 를 적어 두는 경우가 많다 — 읽어 보면 판정할 수 있다.
//
// 판정 규칙은 새로 만들지 않는다. src/lib/grappling/giNoGi.ts 의 detectVideoStyle 을 그대로 불러 쓴다
// (규칙이 갈라지면 앱과 데이터가 어긋난다). 근거가 없으면 unknown 으로 둔다 — 추측하지 않는다.
//
//   node scripts/review-gi-nogi-videos.mjs            # 검수만 하고 결과를 보여 준다 (파일 수정 없음)
//   node scripts/review-gi-nogi-videos.mjs --write    # data/curated/gi-nogi.json 갱신
//   node scripts/review-gi-nogi-videos.mjs --limit 20 # 일부만 (시험용)
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const { getVideoInfo } = require(path.join(ROOT, 'electron/youtubeSearch.cjs'));

const WRITE = process.argv.includes('--write');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

// 앱이 실제로 쓰는 판정 규칙을 그대로 가져온다
const server = await createServer({ root: ROOT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
let detectVideoStyle;
try {
  ({ detectVideoStyle } = await server.ssrLoadModule('/src/lib/grappling/giNoGi.ts'));
} finally {
  await server.close();
}

const FILE = path.join(ROOT, 'data/curated/gi-nogi.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const styles = data.videoStyles;
const todo = Object.entries(styles).filter(([, v]) => (v?.style ?? 'unknown') === 'unknown').slice(0, LIMIT);

console.log(`검수 대상: ${todo.length}개 (전체 ${Object.keys(styles).length}개 중 unknown)`);
console.log('각 영상의 공개 설명·태그를 읽어 같은 규칙으로 다시 판정합니다. 근거가 없으면 unknown 으로 둡니다.\n');

/** 판정 근거가 된 짧은 구절 — 어디서 그렇게 봤는지 남긴다. */
function evidenceFor(style, parts) {
  const RE = {
    nogi: /[^.]*\b(no[\s-]?gi|nogi|노\s?기)\b[^.]*/i,
    gi: /[^.]*(\bgi\b|kimono|도복|(collar|lapel|sleeve)\s?(grip|choke|drag))[^.]*/i,
    both: /[^.]*(gi\s*(&|and|\/|or|vs\.?)\s*no[\s-]?gi|no[\s-]?gi\s*(&|and|\/|or|vs\.?)\s*gi)[^.]*/i,
  }[style];
  for (const [where, text] of parts) {
    const m = RE?.exec(text ?? '');
    if (m) return { where, quote: m[0].trim().replace(/\s+/g, ' ').slice(0, 160) };
  }
  return null;
}

const out = { gi: 0, nogi: 0, both: 0, unknown: 0, failed: 0 };
const changes = [];
let n = 0;
for (const [videoId, entry] of todo) {
  n++;
  let info = null;
  try {
    const r = await getVideoInfo(videoId);
    info = r?.ok ? r.info : null;
    if (!r?.ok) out.failed++;
  } catch {
    out.failed++;
  }
  if (!info) {
    if (n % 25 === 0) console.log(`  ${n}/${todo.length} …`);
    continue;
  }
  const parts = [
    ['제목', info.title ?? ''],
    ['설명', info.description ?? ''],
    ['태그', (info.keywords ?? []).join(', ')],
  ];
  // 제목 → 설명 → 태그 순으로, 처음 근거가 나오는 곳의 판정을 쓴다
  let style = 'unknown';
  let basis = null;
  for (const [where, text] of parts) {
    const s = detectVideoStyle(text);
    if (s !== 'unknown') {
      style = s;
      basis = evidenceFor(s, [[where, text]]);
      break;
    }
  }
  out[style]++;
  if (style !== 'unknown') {
    changes.push({ videoId, techniqueId: entry.techniqueId, style, basis, title: info.title });
    console.log(`  ${style.toUpperCase().padEnd(7)} ${(info.title ?? '').slice(0, 58)}`);
    console.log(`          근거(${basis?.where}): "${basis?.quote?.slice(0, 80) ?? ''}"`);
  }
  if (n % 25 === 0) console.log(`  … ${n}/${todo.length} 진행`);
}

console.log('\n=== 검수 결과 ===');
console.log(`  gi      ${out.gi}`);
console.log(`  nogi    ${out.nogi}`);
console.log(`  both    ${out.both}`);
console.log(`  unknown ${out.unknown}  (설명에도 근거가 없어 그대로 둠)`);
console.log(`  조회 실패 ${out.failed}  (삭제·비공개 영상일 수 있음)`);
console.log(`  새로 판정된 영상: ${changes.length}개`);

if (!WRITE) {
  console.log('\n--write 를 붙이면 data/curated/gi-nogi.json 에 반영합니다. (지금은 파일을 바꾸지 않았습니다)');
  process.exit(0);
}
for (const c of changes) {
  styles[c.videoId] = { techniqueId: c.techniqueId, style: c.style, basis: { source: 'video_metadata', where: c.basis?.where ?? null, quote: c.basis?.quote ?? null, reviewedAt: new Date().toISOString() } };
}
data.reviewedAt = new Date().toISOString();
data.note = `${data.note} videoStyles 의 unknown 은 scripts/review-gi-nogi-videos.mjs 가 영상 설명·태그까지 읽어 재판정했으며, 근거(basis)가 있는 것만 바꿉니다.`;
fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
console.log(`\ndata/curated/gi-nogi.json 갱신: ${changes.length}개 반영`);
