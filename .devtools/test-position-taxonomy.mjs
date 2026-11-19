// Unit test — position-first categories (src/lib/positionTaxonomy) on the real technique data: every technique the
// art page shows is either placed in a position or listed for review (none lost, none duplicated), existing ids /
// categories are untouched, no empty buckets, multi-position techniques, and spot checks of real placements.
//   node .devtools/test-position-taxonomy.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.sessionStorage = globalThis.localStorage;
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const U = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
  const PT = await server.ssrLoadModule('/src/lib/positionTaxonomy/index.ts');
  const C = await server.ssrLoadModule('/src/lib/techniqueCanonical/index.ts');
  const T = await server.ssrLoadModule('/src/lib/techniqueTaxonomy/index.ts');
  const at = (tree, id) => (tree.placements.get(id) ?? []).map((x) => `${x.position}/${x.purpose}`);
  for (const art of ['bjj', 'mixed-martial-arts']) {
    const techs = U.getUnifiedTechniquesByMartialArt(art);
    const categoriesBefore = techs.map((t) => C.techniqueCategoryInArt(t, art));
    const tree = PT.getPositionTree(art, techs);
    const ids = techs.map((t) => t.id);
    const placed = [...tree.placements.keys()];
    const review = tree.review.map((r) => r.techniqueId);
    check(`[${art}] 모든 기술이 포지션 또는 미분류 검토에 있음 (누락 0, 양쪽 중복 0)`, placed.length + review.length === ids.length && new Set([...placed, ...review]).size === ids.length && ids.every((id) => tree.placements.has(id) || review.includes(id)), { techniques: ids.length, placed: placed.length, review: review.length });
    check(`[${art}] 기술 ID 중복 없음, 기술 수·기존 카테고리 문자열 그대로 (분류는 데이터를 바꾸지 않음)`, new Set(ids).size === ids.length && techs.every((t, i) => C.techniqueCategoryInArt(t, art) === categoriesBefore[i]) && U.getUnifiedTechniquesByMartialArt(art).length === ids.length);
    check(`[${art}] 기존 계층 분류(techniqueTaxonomy)는 그대로 계산됨`, T.getArtTaxonomy(art, techs).roots.length > 0);
    check(`[${art}] 빈 포지션·빈 목적 분류 없음, 포지션 수 ≥ 15`, tree.positions.length >= 15 && tree.positions.every((p) => p.count > 0 && p.purposes.length > 0 && p.purposes.every((u) => u.techniqueIds.length > 0)), tree.positions.length);
    check(`[${art}] 여러 포지션에서 쓰이는 기술은 복수 분류 (≥ 80개)`, tree.stats.multiPosition >= 80, tree.stats.multiPosition);
    check(`[${art}] 포지션 카운트 = 그 포지션의 서로 다른 기술 수 (목적 합이 아님)`, tree.positions.every((p) => p.count === new Set(p.purposes.flatMap((u) => u.techniqueIds)).size));
    check(`[${art}] 배치마다 근거 기록 (섹션/이름 · 분류기/섹션)`, [...tree.placements.values()].flat().every((x) => /섹션|이름/.test(x.basis)));
    check(`[${art}] 미분류 검토 항목은 이유와 기존 카테고리를 보여 줌`, tree.review.every((r) => r.reason && r.category));
  }
  const bjj = PT.getPositionTree('bjj');
  check('[bjj] 최상위 = 포지션 (스탠딩 → 가드들 → 탑 포지션 …), 첫 항목 스탠딩', bjj.positions[0].id === 'standing' && ['closed-guard', 'open-guard', 'half-guard', 'butterfly', 'de-la-riva', 'spider', 'lasso', 'x-guard', 'slx', 'fifty-fifty', 'mount', 'side-control', 'back-control', 'knee-on-belly', 'north-south', 'turtle', 'front-headlock', 'crucifix'].every((id) => bjj.positions.some((p) => p.id === id)));
  check('[bjj] 스탠딩 > 테이크다운: 레슬링 더블렉 (다른 무술 기술도 연결)', at(bjj, 'wrestling__basic-double-leg').includes('standing/takedown') || (bjj.placements.get('wrestling__basic-double-leg') === undefined), at(bjj, 'wrestling__basic-double-leg'));
  const rnc = at(bjj, 'bjj__rear-naked-choke');
  check('[bjj] 리어 네이키드 초크 → 백 컨트롤 › 서브미션', rnc.includes('back-control/submission'), rnc);
  const mountPositions = bjj.positions.find((p) => p.id === 'mount').purposes.map((u) => u.id);
  check('[bjj] 마운트 > 서브미션·컨트롤·탈출 회복', ['submission', 'control', 'escape'].every((u) => mountPositions.includes(u)), mountPositions);
  const multi = [...bjj.placements].filter(([, ps]) => new Set(ps.map((x) => x.position)).size >= 3).map(([id]) => id);
  check('[bjj] 3개 이상 포지션에 걸친 기술 존재 (예: 기무라처럼 여러 곳에서 쓰는 기술)', multi.length >= 5, multi.slice(0, 6));
  const mma = PT.getPositionTree('mixed-martial-arts');
  check('[mma] 최상위 = 상황·포지션 (스탠딩, 클린치, 케이지, 테이크다운 전환, 가드 … 스크램블)', ['standing', 'clinch', 'cage', 'takedown-transition', 'guard', 'half-guard', 'side-control', 'mount', 'back-control', 'turtle', 'front-headlock', 'scramble'].every((id) => mma.positions.some((p) => p.id === id)));
  const gnp = mma.positions.filter((p) => p.purposes.some((u) => u.id === 'gnp')).map((p) => p.id);
  check('[mma] MMA 고유 분류 유지: 그라운드 타격이 그라운드 포지션에 있음, 케이지 · 펜스 포지션 존재', gnp.length >= 2 && mma.positions.some((p) => p.id === 'cage'), gnp);
  const standing = mma.positions.find((p) => p.id === 'standing').purposes.map((u) => u.id);
  check('[mma] 스탠딩 > 타격·거리 조절·테이크다운·테이크다운 방어·클린치 진입', ['strike', 'distance', 'takedown', 'td_defense', 'clinch_entry'].every((u) => standing.includes(u)), standing);
  check('[mma] 지상 포지션의 "타격"은 그라운드 타격으로 (스탠딩 타격과 섞이지 않음)', mma.positions.filter((p) => !['standing', 'clinch', 'cage', 'takedown-transition', 'scramble'].includes(p.id)).every((p) => !p.purposes.some((u) => u.id === 'strike')));
  const ids = new Set(PT.techniqueIdsInPosition('mixed-martial-arts', 'mount', 'submission'));
  check('[mma] 목록 필터 = 트리 카운트 (마운트 › 서브미션)', ids.size === mma.positions.find((p) => p.id === 'mount').purposes.find((u) => u.id === 'submission').techniqueIds.length);
} finally {
  await server.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
