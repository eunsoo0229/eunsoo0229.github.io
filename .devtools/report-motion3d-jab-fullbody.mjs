// Phase 1.2 evidence for the jab clip: metrics before/after (V2, Phase 1.1, Phase 1.2), per-key joint data, mesh
// contacts, the refinement/clearance logs, and a chart sheet (fist path 3D/front/side, head rotation, guard).
//   node .devtools/report-motion3d-jab-fullbody.mjs <contactP11.json> <contactP12.json> <refineReport.json> <clearance.json>
// (contact files: scripts/motion3d/mesh_contact_audit.py; refine: scripts/motion3d/refine_motion.py --report;
//  clearance: retarget_hand_observed.py --guard-clearance). Writes data/audit/motion3d-jab-fullbody.{json,png}.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { analyze, fullBodyReport } from './analyze-motion3d-glb.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [cP11, cP12, refineP, clearP] = process.argv.slice(2).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
const FILES = { v2: 'public/motion3d/boxing-jab-nw-v2.glb', p11: 'public/motion3d/boxing-jab-nw-v2-hand-observed.glb', p12: 'public/motion3d/boxing-jab-nw-v2-fullbody.glb' };
const fb = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fullBodyReport(path.join(APP, f))]));
const wrist = (f, side) => {
  const r = analyze(path.join(APP, f), { side });
  return { maxBendDeg: Math.max(...r.frames.map((x) => x.wristBendDeg)), maxHandDeltaDegPerKey: Math.max(...r.frames.slice(1).map((x) => x.delta[`${side}Hand`])), bend: r.frames.map((x) => x.wristBendDeg) };
};
const contactSummary = (c) => Object.fromEntries(Object.keys(c.frames[0]).filter((k) => k.includes('~')).map((k) => [k, { keysWithIntersection: c.frames.filter((f) => f[k] > 0).length, maxTriPairs: Math.max(...c.frames.map((f) => f[k])), perKey: c.frames.map((f) => f[k]) }]));
const fastTurn = (r) => Math.max(...r.frames.slice(r.guardKey, r.extensionKey + 1).filter((f) => (f.fistSpeed ?? 0) >= 1.5 && f.fistTurnDeg !== null).map((f) => f.fistTurnDeg));
const summary = (k) => ({ ...fb[k].punch, maxTurnDegWhileFast: fastTurn(fb[k]), ...fb[k].head, guardFrontOfChestCm: fb[k].guard.rearFistFrontOfChestCm, extensionKey: fb[k].extensionKey });

const doc = {
  generatedBy: '.devtools/report-motion3d-jab-fullbody.mjs (2026-11-01)',
  files: FILES,
  sha256: Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, f))).digest('hex')])),
  causes: {
    head: {
      stage: '2D 검출(MediaPipe) — 재구성은 정상',
      evidence: '키 19–34에서 양 귀가 모두 "삼각측량됨"인데 귀 사이 거리 9.6 cm(중앙값) → 최저 1.1 cm(키 26). 재투영 오차 ≤ 11 px: 가려진 귀를 두 카메라 모두 보이는 귀 옆에 검출했고, 그 2D가 그대로 삼각측량됨. 머리 프레임의 옆 축(오른귀→왼귀)이 1 cm 벡터가 되어 Head가 키 28에 82°/키 회전.',
      fix: 'refine_motion.py: 귀 거리/중앙값으로 신뢰도 r(0.6–0.9 램프). r<1 프레임은 코(정상 측정)에서 귀까지의 가슴 좌표계 오프셋을 앞뒤 신뢰 프레임 사이 보간 → 측정값과 r로 혼합. 머리 위치·몸통은 그대로.',
    },
    fistPath: {
      stage: '재구성(깊이 미관측) + 2D 검출 잡음 — 리타게팅은 방향만 전달',
      evidence: '잽 손목·팔꿈치가 키 12–25 대부분 ray+prior/interpolated. 삼각측량 프레임도 카메라 b 재투영 16–25 px(상대 선수 글러브 근처). 키 11→26 직선 기준 원본 손목 옆 이탈이 −7.0 → +13.9 cm로 부호를 바꾸며 흔들림, GLB 주먹 경로/직선 1.89, 빠른 구간 방향 반전 127°.',
      fix: 'refine_motion.py: 팔꿈치·손목의 주성분 축 수직 성분만 신뢰도 가중 Whittaker(λ=1; 삼각측량 1/(1+(잔차/12px)²), ray 0.05, interpolated 0). 축 방향(진행·타이밍)은 측정값 유지. 직선 강제 없음.',
    },
    guard: {
      stage: '리타게팅(몸 비율) + 재구성(가드 팔은 전 구간 깊이 미관측)',
      evidence: '원본 어깨 너비 33.1 cm, 캐릭터 43.9 cm(근육형, 가슴 두꺼움). 방향만 복사하므로 가드 손목은 어깨선 앞 약 11 cm로 원본과 같지만 이 캐릭터에선 가슴 속. Phase 1.1 GLB에서 오른손–몸통 메시 교차 55/55 키(최대 510 삼각형 쌍), 오른전완–몸통 55/55 키. 오른팔꿈치·손목은 한 번도 삼각측량되지 않음.',
      fix: 'guard_clearance.py(리타게팅 단계): 레스트 몸통 볼록 단면(1 cm 높이별)과 손 표본(손목·주먹·너클·엄지 3마디)이 겹치면 2-본 IK로 주먹을 가슴 정면 방향으로 최소 이동, 전완은 1.5 cm 연조직 접촉 초과분만 팔꿈치 스위블(누적 ≤ 45°). 접촉 없는 프레임은 그대로.',
    },
  },
  metrics: { v2: summary('v2'), phase11: summary('p11'), phase12: summary('p12') },
  wrist: { phase11: { left: wrist(FILES.p11, 'Left'), right: wrist(FILES.p11, 'Right') }, phase12: { left: wrist(FILES.p12, 'Left'), right: wrist(FILES.p12, 'Right') } },
  meshContacts: { phase11: contactSummary(cP11), phase12: contactSummary(cP12) },
  refinement: {
    earDistanceCm: { before: refineP.head.earDistanceCm, after: refineP.head.earDistanceAfterCm, unreliableKeys: refineP.head.unreliableFrames },
    armMaxMoveCm: Object.fromEntries(Object.entries({ ...refineP.arms.left, ...refineP.arms.right }).map(([k, v]) => [k, v.maxMoveCm])),
  },
  guardClearance: { pushCm: clearP.pushM.map((x) => +(x.right * 100).toFixed(1)), elbowSwivelDeg: clearP.pushM.map((x) => x.rightSwivelDeg), forearmContactMm: clearP.pushM.map((x) => x.rightResidualMm) },
  perKey: { phase11: fb.p11.frames, phase12: fb.p12.frames },
};
const out = path.join(APP, 'data/audit/motion3d-jab-fullbody.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');

// ---- chart sheet (inline SVG → PNG via headless Chrome)
const W = 560, H = 230, PAD = 34;
function chart(title, series, { xLabel = 'time (s)', yLabel = '', xs = null, square = false } = {}) {
  const pts = series.flatMap((s) => s.points);
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  let [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  if (y0 === y1) y1 = y0 + 1;
  let sx = (W - 2 * PAD) / (x1 - x0 || 1), sy = (H - 2 * PAD) / (y1 - y0);
  if (square) sx = sy = Math.min(sx, sy);
  const X = (x) => PAD + (x - x0) * sx, Y = (y) => H - PAD - (y - y0) * sy;
  const lines = series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.6}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} points="${s.points.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
  const legend = series.map((s, i) => `<text x="${PAD + 4 + i * 120}" y="14" font-size="11" fill="${s.color}">■ ${s.name}</text>`).join('');
  return `<figure><figcaption>${title}</figcaption><svg width="${W}" height="${H}" style="background:#fff"><line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#bbb"/><line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#bbb"/>${y0 < 0 && y1 > 0 ? `<line x1="${PAD}" y1="${Y(0)}" x2="${W - PAD}" y2="${Y(0)}" stroke="#eee"/>` : ''}${lines}${legend}<text x="${W - PAD}" y="${H - 8}" font-size="10" text-anchor="end" fill="#666">${xLabel}</text><text x="4" y="${PAD - 6}" font-size="10" fill="#666">${yLabel} [${y0.toFixed(1)} … ${y1.toFixed(1)}]</text></svg></figure>`;
}
const C11 = '#c0392b', C12 = '#1f6fb2';
const fr11 = fb.p11.frames, fr12 = fb.p12.frames;
const t = (f) => f.time;
const charts = [
  chart('1. 주먹 진행 방향 이동(가드 키 10 기준, cm)', [{ name: 'Phase 1.1', color: C11, points: fr11.map((f) => [t(f), f.fistAlongCm]) }, { name: 'Phase 1.2', color: C12, points: fr12.map((f) => [t(f), f.fistAlongCm]) }], { yLabel: 'cm' }),
  chart('1b. 주먹 옆 이탈(cm, 진행 방향 수직·수평)', [{ name: 'Phase 1.1', color: C11, points: fr11.map((f) => [t(f), f.fistLateralCm]) }, { name: 'Phase 1.2', color: C12, points: fr12.map((f) => [t(f), f.fistLateralCm]) }], { yLabel: 'cm' }),
  chart('2. 3D 궤적 위에서 본 모습(가드→최대 신전, 진행 vs 옆, cm, 같은 축척)', [{ name: 'Phase 1.1', color: C11, points: fr11.slice(fb.p11.guardKey, fb.p11.extensionKey + 1).map((f) => [f.fistAlongCm, f.fistLateralCm]) }, { name: 'Phase 1.2', color: C12, points: fr12.slice(fb.p12.guardKey, fb.p12.extensionKey + 1).map((f) => [f.fistAlongCm, f.fistLateralCm]) }], { xLabel: '진행(cm)', yLabel: '옆', square: true }),
  chart('3a. 정면 투영 궤적(캐릭터 좌우 x 위아래, cm)', [{ name: 'Phase 1.1', color: C11, points: fr11.slice(10, 30).map((f) => f.fistFront) }, { name: 'Phase 1.2', color: C12, points: fr12.slice(10, 30).map((f) => f.fistFront) }], { xLabel: '좌우(cm)', yLabel: '위아래', square: true }),
  chart('3b. 측면 투영 궤적(캐릭터 앞뒤 x 위아래, cm)', [{ name: 'Phase 1.1', color: C11, points: fr11.slice(10, 30).map((f) => f.fistSide) }, { name: 'Phase 1.2', color: C12, points: fr12.slice(10, 30).map((f) => f.fistSide) }], { xLabel: '앞뒤(cm)', yLabel: '위아래', square: true }),
  chart('4. 머리 회전 변화량(°/키)과 목', [{ name: 'Head 1.1', color: C11, points: fr11.slice(1).map((f) => [t(f), f.headDeltaDeg]) }, { name: 'Head 1.2', color: C12, points: fr12.slice(1).map((f) => [t(f), f.headDeltaDeg]) }, { name: 'Neck 1.2', color: '#7f8c8d', dash: true, points: fr12.slice(1).map((f) => [t(f), f.neckDeltaDeg]) }], { yLabel: '°' }),
  chart('4b. 가슴 대비 머리 방향(키 0 기준, °)', [{ name: 'Phase 1.1', color: C11, points: fr11.map((f) => [t(f), f.headVsChestDeg]) }, { name: 'Phase 1.2', color: C12, points: fr12.map((f) => [t(f), f.headVsChestDeg]) }], { yLabel: '°' }),
  chart('5. 가드 주먹의 가슴(Spine2) 앞 거리(cm)', [{ name: 'Phase 1.1', color: C11, points: fr11.map((f) => [t(f), f.rearFistFrontOfChestCm]) }, { name: 'Phase 1.2', color: C12, points: fr12.map((f) => [t(f), f.rearFistFrontOfChestCm]) }], { yLabel: 'cm' }),
  chart('6. 메시 교차 삼각형 쌍 수(오른손·오른전완 vs 몸통)', [{ name: '손 1.1', color: C11, points: cP11.frames.map((f, i) => [i, f['rightHand~torso']]) }, { name: '손 1.2', color: C12, points: cP12.frames.map((f, i) => [i, f['rightHand~torso']]) }, { name: '전완 1.1', color: C11, dash: true, points: cP11.frames.map((f, i) => [i, f['rightForearm~torso']]) }, { name: '전완 1.2', color: C12, dash: true, points: cP12.frames.map((f, i) => [i, f['rightForearm~torso']]) }], { xLabel: 'key', yLabel: 'pairs' }),
  chart('7. 잽 팔 관절 진행 방향 위치(cm): 어깨·팔꿈치·손목 (Phase 1.2)', ['leadShoulder', 'leadElbow', 'leadWrist'].map((j, i) => ({ name: j.replace('lead', ''), color: ['#16a085', '#8e44ad', C12][i], points: fr12.map((f) => { const g = fr12[10][j]; const d = [fr12[fb.p12.extensionKey].fist[0] - fr12[10].fist[0], fr12[fb.p12.extensionKey].fist[2] - fr12[10].fist[2]]; const l = Math.hypot(...d); return [t(f), (((f[j][0] - g[0]) * d[0] + (f[j][2] - g[2]) * d[1]) / l) * 100]; }) })), { yLabel: 'cm' }),
];
const html = `<!doctype html><meta charset="utf-8"><style>body{font:12px -apple-system,sans-serif;margin:8px;background:#f4f2ee}h1{font-size:15px;margin:4px 0 8px}main{display:grid;grid-template-columns:repeat(2,${W}px);gap:8px}figure{margin:0}figcaption{font-weight:600;margin:2px 0}</style><h1>boxing__jab Phase 1.1 vs 1.2 — ${new Date().toISOString().slice(0, 10)}</h1><main>${charts.join('')}</main>`;
const htmlPath = path.join(APP, 'data/audit/motion3d-jab-fullbody.html');
fs.writeFileSync(htmlPath, html);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 2 * W + 40, height: 800 } });
await page.goto('file://' + htmlPath);
await page.screenshot({ path: path.join(APP, 'data/audit/motion3d-jab-fullbody.png'), fullPage: true });
await browser.close();
fs.unlinkSync(htmlPath);
console.log(JSON.stringify(doc.metrics, null, 1));
console.log('wrist', JSON.stringify({ p11: { L: doc.wrist.phase11.left.maxBendDeg, Ld: doc.wrist.phase11.left.maxHandDeltaDegPerKey }, p12: { L: doc.wrist.phase12.left.maxBendDeg, Ld: doc.wrist.phase12.left.maxHandDeltaDegPerKey, R: doc.wrist.phase12.right.maxBendDeg } }));
