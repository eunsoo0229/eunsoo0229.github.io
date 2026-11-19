// Phase 4 UI 통합 — 실제 사용자 클릭 흐름으로 3D 기준 영상 녹화·등록을 검증한다.
// 기술 상세 → 자세 분석 모달 → "기준 시연 영상과 비교" → 기준 등록 → "3D 시연 녹화"
// → 각도 선택 → 녹화 버튼(중복 클릭 포함) → 단계 표시 → 등록 → 저장 확인.
//
// 비파괴: Electron은 사용자의 실제 프로필로 뜬다. 시작 시점의 기준 영상 id를 기록하고
// 이 테스트가 새로 만든 id만 deleteReference()로 지운다. 기존 데이터는 건드리지 않는다.
// 외부 호출 없음: Gemini 엔드포인트를 page.route 로 차단한다(등록 후 프로필 생성은 유료라 실행하지 않음).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
const APP = '/Users/swcho/Documents/MARTIALDEX';
const KEY = 'martialdex:form-reference-videos';
const env = { ...process.env, MARTIALDEX_HEADLESS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 200)}`); } };

const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP], env, timeout: 60000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
await page.route(/generativelanguage\.googleapis|functions\/v1\/gemini/, (r) => r.abort());

const listIds = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]').map((r) => r.id), KEY);
const before = new Set(await listIds());

try {
  await page.goto('http://localhost:5173/#/arts/boxing/techniques/boxing__jab?open=pose', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  console.log('\n[1] 진입');
  const toCompare = page.getByTestId('pose-to-form-compare');
  const hasEntry = await toCompare.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  check('자세 분석 모달에 기준 영상 비교 진입점', hasEntry);
  await toCompare.click();
  await page.waitForTimeout(1500);
  check('기준 영상 비교 모달 열림', (await page.getByTestId('form-compare').count()) > 0);
  if (await page.getByTestId('form-ref-add').count()) await page.getByTestId('form-ref-add').click();

  console.log('\n[2] 3D 녹화 선택');
  const kind3d = page.getByTestId('form-ref-kind-motion3d');
  check('3D 시연이 있는 기술에 "3D 시연 녹화" 선택지', (await kind3d.count()) > 0);
  await kind3d.click();
  await page.getByTestId('form-ref-3d-angle-side').click();
  check('각도 선택(측면) 반영', (await page.getByTestId('form-ref-3d-angle-side').getAttribute('aria-pressed')) === 'true');

  const btn = page.getByTestId('form-ref-3d-record');
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="form-ref-3d-record"]'); return !!b && !b.disabled; }, null, { timeout: 30000 }).catch(() => {});
  check('3D 엔진 준비 후 녹화 버튼 활성화', !(await btn.isDisabled()));

  console.log('\n[3] 녹화 → 등록 (중복 클릭 포함)');
  const seen = new Set();
  const watch = setInterval(async () => { try { const s = await page.getByTestId('form-ref-3d-stage').getAttribute('data-stage', { timeout: 50 }); if (s) seen.add(s); } catch {} }, 60);
  await btn.click();
  await btn.click({ force: true, timeout: 500 }).catch(() => {});
  const finalStage = await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="form-ref-3d-stage"]')?.getAttribute('data-stage');
    if (s === 'ready' || s === 'failed') return s;
    return document.querySelector('[data-testid="form-ref-3d"]') ? null : 'left';
  }, null, { timeout: 90000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
  clearInterval(watch);
  console.log('  관측된 단계:', [...seen].join(' → ') || '(없음)', '| 최종:', finalStage);
  check('녹화 진행 단계가 화면에 표시됨', ['recording', 'validating', 'registering', 'ready'].some((s) => seen.has(s)) || finalStage === 'left', [...seen]);
  check('등록 완료 후 다음 단계로 진행', finalStage === 'ready' || finalStage === 'left', finalStage);

  const created = await page.evaluate(({ k, before }) => JSON.parse(localStorage.getItem(k) || '[]').filter((r) => !before.includes(r.id)).map((r) => ({ id: r.id, kind: r.source.kind, angle: r.source.angle, tech: r.techniqueId })), { k: KEY, before: [...before] });
  check('motion3d 기준 영상이 정확히 1개 등록 (중복 클릭이 두 번 등록하지 않음)', created.filter((r) => r.kind === 'motion3d').length === 1, created);
  check('선택한 각도(측면)로 저장', created.find((r) => r.kind === 'motion3d')?.angle === 'side', created);
  // boxing__jab 은 technique-canonical.json 에서 kickboxing__jab 으로 합쳐진다 — 기존
  // YouTube·파일 기준 영상도 같은 정규 id로 저장되므로 그쪽과 일치하는지 본다.
  check('기술 id가 정규 id(kickboxing__jab)로 저장 — 기존 기준 영상과 동일 규칙', created.find((r) => r.kind === 'motion3d')?.tech === 'kickboxing__jab', created);

  console.log('\n[4] 3D 없는 기술');
  await page.goto('http://localhost:5173/#/arts/boxing/techniques/boxing__shoulder-roll?open=pose', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  if (await page.getByTestId('pose-to-form-compare').count()) {
    await page.getByTestId('pose-to-form-compare').click(); await page.waitForTimeout(1200);
    if (await page.getByTestId('form-ref-add').count()) await page.getByTestId('form-ref-add').click();
    check('3D 시연이 없으면 "3D 시연 녹화" 선택지가 없음', (await page.getByTestId('form-ref-kind-motion3d').count()) === 0);
  } else console.log('  (이 기술은 자세 분석 진입이 없음 — 생략)');
} finally {
  // 이 테스트가 만든 기준 영상만 정리 — 기존 데이터는 그대로
  const removed = await page.evaluate(async ({ k, before }) => {
    const { deleteReference } = await import('/src/lib/formCompare/referenceStore.ts');
    const mine = JSON.parse(localStorage.getItem(k) || '[]').filter((r) => !before.includes(r.id)).map((r) => r.id);
    for (const id of mine) await deleteReference(id);
    return mine.length;
  }, { k: KEY, before: [...before] }).catch(() => -1);
  const after = await listIds().catch(() => []);
  console.log(`\n[정리] 테스트가 만든 기준 영상 ${removed}개 삭제 · 기존 ${before.size}개 유지 확인: ${[...before].every((id) => after.includes(id))}`);
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await app.close();
process.exit(fail ? 1 : 0);
