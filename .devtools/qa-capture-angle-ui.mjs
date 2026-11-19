// Phase 6 UI — 사용자가 고른 3D 기준 각도가 촬영 안내까지 이어지는지 실제 클릭 흐름으로 검증한다.
//   기술 상세 → 자세 분석 → 기준 영상 비교 → 3D 시연 녹화(각도 선택·실제 녹화·등록)
//   → 촬영 화면의 각도 안내 → "다른 각도로 기준 영상 다시 녹화" → 새 기준 → 재조회 → 다른 기술
//
// 외부 호출 없음: Gemini·Supabase 요청을 page.route 로 차단한다. 그래서 등록 직후의 평가 기준
// 생성(유료)은 실패하고, 촬영 화면에 들어가기 위해 테스트가 "UI 테스트용 고정 기준"을 기준 영상에
// 넣는다. 이것은 AI 결과가 아니며 채점에 쓰이지 않는다(이 테스트는 판정·채점을 실행하지 않는다).
//
// 비파괴: Electron은 사용자의 실제 프로필로 뜬다. 시작 시점의 기준 영상 id를 기록하고 이 테스트가
// 만든 기준 영상만 deleteReference()로 지운다. 비교 기록·자세 기록은 만들지 않는다(종료 시 확인).
//   node .devtools/qa-capture-angle-ui.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
const APP = '/Users/swcho/Documents/MARTIALDEX';
const KEY = 'martialdex:form-reference-videos';
const OTHER_KEYS = ['martialdex:form-compare-records', 'martialdex:pose-records'];
const env = { ...process.env, MARTIALDEX_HEADLESS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 240)}`); } };

const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP], env, timeout: 60000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
await page.route(/generativelanguage\.googleapis|functions\/v1\/gemini|supabase\.co/, (r) => r.abort());

const listRefs = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY);
const before = new Set((await listRefs()).map((r) => r.id));
const otherBefore = await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), OTHER_KEYS);
const tid = (id) => page.getByTestId(id);
const attr = (id, a) => tid(id).first().getAttribute(a, { timeout: 5000 }).catch(() => null);

async function openCompare(techPath) {
  await page.goto(`http://localhost:5173/#/arts/${techPath}?open=pose`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await tid('pose-to-form-compare').waitFor({ state: 'visible', timeout: 20000 });
  await tid('pose-to-form-compare').click();
  await tid('form-compare').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
}

/** In the 3D recorder: pick the angle, record for real, wait until registered. Returns the new reference. */
async function record3d(angle) {
  const known = new Set((await listRefs()).map((r) => r.id));
  await tid(`form-ref-3d-angle-${angle}`).click();
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="form-ref-3d-record"]'); return !!b && !b.disabled; }, null, { timeout: 30000 });
  await tid('form-ref-3d-record').click();
  await page.waitForFunction((known) => JSON.parse(localStorage.getItem('martialdex:form-reference-videos') || '[]').some((r) => !known.includes(r.id)), [...known], { timeout: 90000 });
  await page.waitForTimeout(1500); // the (blocked) criteria build fails and the reference step shows
  return (await listRefs()).find((r) => !known.has(r.id));
}

/** Test fixture so the capture screen can open without a paid AI call. Not an AI result, never scored. */
async function giveFixtureProfile(id) {
  await page.evaluate(async (id) => {
    const { getReference, saveReference } = await import('/src/lib/formCompare/referenceStore.ts');
    const r = getReference(id);
    saveReference({ ...r, profile: {
      builtAt: new Date().toISOString(), model: 'gemini', techniqueVisible: true, matchesTechnique: true, observedTechnique: '잽',
      cameraView: 'front', // deliberately NOT the 3D angle: the guide must follow the user's chosen angle, not this
      visibleBodyParts: [], summary: '[UI 테스트용 고정 기준 — AI 결과 아님]', excluded: [], active: { start: 0.2, end: 0.7 },
      phases: [{ id: 'P1', name: '준비 자세', description: '', startSec: null, endSec: null, startFraction: 0, endFraction: 0.3 }, { id: 'P2', name: '뻗기', description: '', startSec: null, endSec: null, startFraction: 0.3, endFraction: 1 }],
      criteria: [{ id: 'C1', phaseId: 'P1', aspect: 'start_posture', description: '가드', importance: 'core', evidence: '' }, { id: 'C2', phaseId: 'P2', aspect: 'limb_motion', description: '뻗기', importance: 'core', evidence: '' }],
    } });
  }, id);
  await page.waitForTimeout(400);
}

async function toCapture() {
  await tid('form-ref-next').click();
  await tid('form-capture-angle').waitFor({ timeout: 10000 });
}

const GUIDE_WORD = { front: '정면', diagonal: '45°', side: '옆' };
async function checkCaptureGuide(angle, label) {
  check(`${label}: 촬영 화면의 기준 각도 = ${angle}`, (await attr('form-capture-angle', 'data-angle')) === angle, await attr('form-capture-angle', 'data-angle'));
  check(`${label}: 각도 출처 = 사용자가 고른 3D 각도`, (await attr('form-capture-angle', 'data-angle-source')) === 'motion3d');
  const placement = await tid('form-capture-placement').innerText().catch(() => '');
  check(`${label}: 카메라 배치 안내가 각도에 맞음`, placement.includes(GUIDE_WORD[angle]), placement);
  check(`${label}: 배치 그림 표시`, (await tid('form-capture-angle-diagram').getAttribute('aria-label').catch(() => '')).includes(angle === 'diagonal' ? '대각선' : angle === 'side' ? '측면' : '정면'));
  check(`${label}: 기준 영상 미리보기 표시`, (await tid('form-capture-ref-preview').count()) === 1);
  check(`${label}: 촬영 전 확인 사항 표시`, (await tid('form-capture-checklist').locator('li').count()) >= 4);
  check(`${label}: 각도 확인 전에는 파일 업로드 비활성`, await (async () => { await tid('form-capture-file-mode').click(); const d = await tid('form-capture-file').isDisabled(); return d; })());
  await tid('form-capture-angle-confirm').check();
  check(`${label}: 각도 확인 후 파일 업로드 활성`, !(await tid('form-capture-file').isDisabled()));
  await tid('form-capture-angle-confirm').uncheck();
  await tid('form-capture-camera').click();
}

const created = [];
try {
  console.log('\n[1] 정면 기준 영상 → 정면 촬영 안내');
  await openCompare('boxing/techniques/boxing__jab');
  if (await tid('form-ref-add').count()) await tid('form-ref-add').click();
  await tid('form-ref-kind-motion3d').click();
  check('3D 녹화 기본 각도는 대각선(정면은 잽 길이가 안 보임)', (await attr('form-ref-3d-angle-diagonal', 'aria-pressed')) === 'true');
  check('각도가 저장·촬영 안내에 쓰인다는 설명 표시', (await tid('form-ref-3d-angle-note').innerText()).includes('같은 각도'));
  const front = await record3d('front');
  created.push(front.id);
  check('정면 기준 영상 저장 (source.angle=front)', front?.source.kind === 'motion3d' && front.source.angle === 'front', front?.source);
  check('기준 영상 카드에 고른 각도 표시', (await attr('form-ref-current', 'data-angle')) === 'front');
  await giveFixtureProfile(front.id);
  await toCapture();
  await checkCaptureGuide('front', '정면');
  check('카메라 촬영 시작 버튼은 카메라를 켠 뒤에만 — 각도 확인 체크가 있다', (await tid('form-capture-angle-confirm').count()) === 1);

  console.log('\n[4·2] 각도 변경 → 새 기준 영상(45° 대각선) → 대각선 촬영 안내');
  await tid('form-capture-reangle').click();
  await tid('form-ref-3d').waitFor({ timeout: 10000 });
  check('"다른 각도로 다시 녹화" → 3D 녹화 화면으로 바로 이동', (await tid('form-ref-3d').count()) === 1);
  check('지금 쓰는 기준의 각도와 "새 기준으로 추가" 안내', /정면 각도입니다.*추가/.test(await tid('form-ref-3d-angle-note').innerText()));
  const diag = await record3d('diagonal');
  created.push(diag.id);
  const refsNow = await listRefs();
  check('새 기준 영상이 추가로 생성됨 (기존 정면 기준 유지)', refsNow.some((r) => r.id === front.id) && diag.source.angle === 'diagonal', refsNow.map((r) => r.source.angle));
  check('새 기준 영상이 선택됨', (await attr('form-ref-current', 'data-angle')) === 'diagonal');
  await giveFixtureProfile(diag.id);
  await toCapture();
  await checkCaptureGuide('diagonal', '45° 대각선');

  console.log('\n[3] 측면 기준 영상 → 측면 촬영 안내');
  await tid('form-capture-reangle').click();
  await tid('form-ref-3d').waitFor({ timeout: 10000 });
  const side = await record3d('side');
  created.push(side.id);
  await giveFixtureProfile(side.id);
  await toCapture();
  await checkCaptureGuide('side', '측면');

  console.log('\n[5] 저장 후 재조회 — 앱을 새로 읽어도 각도 유지');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const stored = (await listRefs()).filter((r) => created.includes(r.id)).map((r) => [r.id, r.source.angle, r.cameraView]);
  check('저장된 3개 기준의 각도 유지 (front/diagonal/side)', JSON.stringify(stored.map((x) => x[1]).sort()) === JSON.stringify(['diagonal', 'front', 'side']), stored);
  await openCompare('boxing/techniques/boxing__jab');
  for (const [id, angle] of stored) {
    const chips = tid('form-ref-pick');
    const n = await chips.count();
    let picked = false;
    for (let i = 0; i < n && !picked; i++) {
      await chips.nth(i).click();
      await page.waitForTimeout(200);
      if ((await attr('form-ref-current', 'data-angle')) === angle && (await page.evaluate(() => 1))) picked = true;
    }
    check(`재조회 후 ${angle} 기준 선택 가능, 카드 각도 = ${angle}`, picked);
    if (picked) {
      await toCapture();
      check(`재조회 후 ${angle} 기준 → 촬영 안내 각도 = ${angle}`, (await attr('form-capture-angle', 'data-angle')) === angle);
      await page.getByText('← 기준 영상으로').click();
      await page.waitForTimeout(300);
    }
    void id;
  }

  console.log('\n[6] 기술 변경 — 이전 기술의 각도가 적용되지 않음');
  // 잽의 측면 기준으로 촬영 화면까지 연 상태에서(측면 각도가 화면에 있는 상태) 기술만 바꾼다.
  // 비교 모달은 열린 채로 남아 새 기술을 받는다 — 그 모달이 잽의 상태를 끌고 오면 안 된다.
  await tid('form-ref-pick').first().waitFor({ timeout: 5000 }).catch(() => {});
  const sideChipCount = await tid('form-ref-pick').count();
  for (let i = 0; i < sideChipCount; i++) { await tid('form-ref-pick').nth(i).click(); await page.waitForTimeout(150); if ((await attr('form-ref-current', 'data-angle')) === 'side') break; }
  await toCapture();
  check('(전제) 잽 측면 기준의 촬영 화면이 열려 있음', (await attr('form-capture-angle', 'data-angle')) === 'side');
  await page.goto('http://localhost:5173/#/arts/kickboxing/techniques/kickboxing__cross?open=pose', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  if (!(await tid('form-compare').count())) { await tid('pose-to-form-compare').click(); await tid('form-compare').waitFor({ timeout: 10000 }); }
  check('모달이 크로스 기준으로 바뀜', (await page.locator('[data-testid=form-compare] h3').innerText()).includes('Cross'));
  check('잽의 촬영 화면(측면 안내)이 크로스로 넘어오지 않음', (await tid('form-capture-angle').count()) === 0 && (await attr('form-compare', 'data-step')) === 'reference');
  const crossRefs = (await listRefs()).filter((r) => r.techniqueId.includes('cross'));
  const cardAngle = await attr('form-ref-current', 'data-angle');
  check('다른 기술(크로스)에는 잽 기준 영상이 보이지 않음', crossRefs.length === 0 ? (await tid('form-ref-current').count()) === 0 : !created.includes(cardAngle), { crossRefs: crossRefs.length, cardAngle });
  if (await tid('form-ref-add').count()) await tid('form-ref-add').click();
  if (await tid('form-ref-kind-motion3d').count()) {
    await tid('form-ref-kind-motion3d').click();
    await page.waitForTimeout(500);
    check('크로스의 3D 녹화 각도는 마지막 잽 선택(측면)이 아니라 기본값(대각선)', (await attr('form-ref-3d-angle-diagonal', 'aria-pressed')) === 'true' && (await attr('form-ref-3d-angle-side', 'aria-pressed')) !== 'true');
    check('크로스 녹화 화면에 "지금 쓰는 기준" 안내가 잽 각도로 뜨지 않음', !/각도입니다/.test(await tid('form-ref-3d-angle-note').innerText()));
  }
} catch (e) {
  fail++;
  console.log('  FAIL  예외 ::', String(e).slice(0, 400));
} finally {
  const removed = await page.evaluate(async ({ k, before }) => {
    const { deleteReference } = await import('/src/lib/formCompare/referenceStore.ts');
    const mine = JSON.parse(localStorage.getItem(k) || '[]').filter((r) => !before.includes(r.id)).map((r) => r.id);
    for (const id of mine) await deleteReference(id);
    return mine.length;
  }, { k: KEY, before: [...before] }).catch(() => -1);
  const after = (await listRefs().catch(() => [])).map((r) => r.id);
  const otherAfter = await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), OTHER_KEYS).catch(() => null);
  console.log(`\n[정리] 테스트가 만든 기준 영상 ${removed}개 삭제 · 기존 ${before.size}개 유지: ${[...before].every((id) => after.includes(id))} · 비교/자세 기록 변화 없음: ${JSON.stringify(otherAfter) === JSON.stringify(otherBefore)}`);
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await app.close();
process.exit(fail ? 1 : 0);
