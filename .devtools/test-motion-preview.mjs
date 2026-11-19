// Unit test — when a chat/lesson answer gets a 3D preview (src/lib/selfAi/preview.ts), with the real router and DB.
//   node .devtools/test-motion-preview.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));
const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.sessionStorage = globalThis.localStorage;
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { planTurn } = await server.ssrLoadModule('/src/lib/selfAi/router.ts');
  const { previewFor } = await server.ssrLoadModule('/src/lib/selfAi/preview.ts');
  const { resolveTechnique } = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
  const run = (text, art = 'boxing', lessonTechniqueId) => {
    const plan = planTurn(text, { martialArt: art, inLesson: !!lessonTechniqueId, lessonTechnique: lessonTechniqueId ? resolveTechnique(lessonTechniqueId) : null });
    return { plan, preview: previewFor(plan, text, lessonTechniqueId) };
  };
  let r = run('크로스 동작 보여줘');
  check('"크로스 동작 보여줘" → 크로스 3D, 바로 열림', r.preview?.items.length === 1 && /cross/.test(r.preview.items[0].techniqueId) && r.preview.items[0].clipId === 'boxing-cross-m2m-v3' && r.preview.open, { intent: r.plan.intent, preview: r.preview });
  r = run('훅은 어떻게 치는 거야?');
  check('"훅은 어떻게 치는 거야?" → 훅 3D 카드 (닫힌 상태)', r.preview?.items[0]?.clipId === 'boxing-hook-m2m-v4' && r.preview.open === false, { intent: r.plan.intent, ids: r.plan.techniques.map((t) => t.id), preview: r.preview });
  r = run('잽이랑 크로스 움직임 차이 보여줘');
  check('"잽이랑 크로스 차이" → 두 기술 각자의 3D (서로 섞이지 않음)', r.preview?.items.length === 2 && new Set(r.preview.items.map((i) => i.clipId)).size === 2 && r.preview.items.every((i) => i.clipId), { intent: r.plan.intent, preview: r.preview });
  r = run('어퍼컷 동작 보여줘');
  check('3D가 없는 기술 → clipId null (다른 기술로 대체 안 함)', r.preview?.items.length === 1 && r.preview.items[0].clipId === null && /uppercut/.test(r.preview.items[0].techniqueId), { intent: r.plan.intent, preview: r.preview });
  r = run('잽은 언제 쓰는 기술이야?');
  check('시각 요청이 없는 질문 → 프리뷰 없음', !r.preview, { intent: r.plan.intent });
  r = run('내 크로스 자세 측정해줘');
  check('자세 "측정" 요청(pose_check) → 프리뷰가 아니라 측정 흐름', !r.preview || r.plan.intent !== 'pose_check', { intent: r.plan.intent, preview: r.preview });
  r = run('안녕');
  check('일반 대화 → 프리뷰 없음', !r.preview);
  r = run('보여줘', 'boxing', 'boxing__hook');
  check('수업 중 기술 이름 없이 "보여줘" → 지금 배우는 기술(훅)', r.preview?.items[0]?.techniqueId === 'boxing__hook' && r.preview.items[0].clipId === 'boxing-hook-m2m-v4', { intent: r.plan.intent, preview: r.preview });
  const ids = new Set(['boxing-jab-m2m-v2', 'boxing-cross-m2m-v3', 'boxing-hook-m2m-v4', null]);
  check('프리뷰에는 카탈로그 clipId(또는 null)만 — 경로·URL 없음', [run('크로스 보여줘'), run('훅 보여줘'), run('잽 보여줘')].every((x) => x.preview?.items.every((i) => ids.has(i.clipId) && !/[/:]/.test(String(i.clipId)))));
} finally {
  await server.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
