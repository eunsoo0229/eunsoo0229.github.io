// Phase 5 — 실제 Gemini로 3D 자세 측정 파이프라인 전체를 한 번 검증한다.
//
//   3D 미리보기 → recordPreviewOnce → File → registerMotion3dReference → sampleVideoBlob
//   → ensureProfile/buildReferenceProfile (Gemini 실호출 #1)
//   → 사용자 영상 sampleVideoBlob → compareAttempt → prepareComparison/alignTimes
//   → judgeAttempt (Gemini 실호출 #2) → scoreComparison → 점수
//
// 유료 호출이 나가는 스크립트다. 사용자가 Phase 5에서 실호출을 승인했다.
//   - 재시도 루프 없음. 논리 호출은 정확히 2회(평가 기준 1 + 판정 1, samples 기본값 1).
//   - 메인 프로세스 fetch를 계측해 실제 HTTP 요청 수·모델·상태·토큰 사용량을 기록한다.
//     URL에는 API 키가 들어 있으므로 모델명만 정규식으로 뽑고 URL은 절대 기록하지 않는다.
//
// 실제 프로필 보호 (Electron은 사용자의 실제 프로필로 뜬다):
//   - 아래 4개 localStorage 키를 시작 시 원문 그대로 저장하고, 끝나면 정확히 그 상태로 되돌린다.
//     form-compare-records 는 기술당 개수 상한이 있어 테스트 기록이 실제 기록을 밀어낼 수 있고,
//     pose-records 는 숙련도 계산에 쓰이는 학습 기록이라 테스트 점수가 남으면 안 된다.
//   - 이 테스트가 만든 기준 영상의 IndexedDB 미디어는 deleteReference()로 지운다.
//   - 페이지의 Supabase 요청을 차단해 테스트 기록이 클라우드 백업으로 나가지 않게 한다.
//
// 실행: MARTIALDEX_QA_ALLOW_GEMINI=qa-motion3d-gemini-e2e node .devtools/qa-motion3d-gemini-e2e.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

if (process.env.MARTIALDEX_QA_ALLOW_GEMINI !== 'qa-motion3d-gemini-e2e') {
  console.log('SKIP — 유료 Gemini 호출 스크립트. 승인 후 MARTIALDEX_QA_ALLOW_GEMINI=qa-motion3d-gemini-e2e 로 실행한다.');
  process.exit(0);
}

const APP = '/Users/swcho/Documents/MARTIALDEX';
// 1차 실행(front)에서 잽이 카메라 쪽으로 뻗어 보이지 않아 Gemini가 '가드 자세'로 판정 → 45° 대각선.
const ANGLE = process.env.MOTION3D_ANGLE || 'diagonal';
const USER_VIDEO = path.join(APP, '.devtools/fixtures-form/jab_good.webm');
const KEYS = ['martialdex:form-reference-videos', 'martialdex:form-compare-records', 'martialdex:pose-records', 'martialdex:ai-engine'];
const env = { ...process.env, MARTIALDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const log = [];
const step = (name, data) => { log.push({ name, ...data }); console.log(`\n[${name}]`, JSON.stringify(data, null, 0).slice(0, 900)); };

const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP], env, timeout: 60000 });

// ---- 메인 프로세스 fetch 계측 (키 비노출)
await app.evaluate(() => {
  const g = globalThis;
  g.__geminiCalls = [];
  const orig = g.fetch;
  g.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (!/generativelanguage\.googleapis\.com/.test(url)) return orig(input, init);
    const model = (url.match(/\/models\/([^:/?]+):/) || [])[1] ?? '?';
    const started = Date.now();
    const rec = { model, status: null, ms: null, usage: null };
    g.__geminiCalls.push(rec);
    const res = await orig(input, init);
    rec.status = res.status;
    rec.ms = Date.now() - started;
    try {
      const j = await res.clone().json();
      const u = j?.usageMetadata;
      if (u) rec.usage = { prompt: u.promptTokenCount ?? null, output: u.candidatesTokenCount ?? null, thoughts: u.thoughtsTokenCount ?? null, total: u.totalTokenCount ?? null };
    } catch { /* non-JSON body */ }
    return res;
  };
});

const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
await page.route(/supabase\.co/, (r) => r.abort());

const snapshot = await page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), KEYS);
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:form-reference-videos') || '[]').map((r) => r.id));
step('시작 상태', {
  기준영상: before.length,
  비교기록: JSON.parse(snapshot['martialdex:form-compare-records'] || '[]').length,
  자세기록: JSON.parse(snapshot['martialdex:pose-records'] || '[]').length,
  AI엔진설정: snapshot['martialdex:ai-engine'] ?? '(없음 = local 기본값)',
});

let exitCode = 1;
try {
  // 채점은 영상 입력이 필요해 로컬 엔진이 거부한다(LOCAL_UNSUPPORTED_INPUT). 테스트 동안만 Gemini로.
  await page.evaluate(() => localStorage.setItem('martialdex:ai-engine', 'gemini'));

  const b64 = fs.readFileSync(USER_VIDEO).toString('base64');
  const r = await page.evaluate(async ({ b64, angle }) => {
    const ANGLE = angle;
    const out = {};
    const [{ MotionEngine }, cat, R, S, { getTechnique }, store] = await Promise.all([
      import('/src/lib/motion3d/engine.ts'),
      import('/src/lib/motion3d/catalog.ts'),
      import('/src/lib/motion3d/recorder.ts'),
      import('/src/lib/formCompare/service.ts'),
      import('/src/lib/loadData.ts'),
      import('/src/lib/formCompare/referenceStore.ts'),
    ]);
    const { sampleVideoBlob } = await import('/src/lib/formCompare/clipCapture.ts');

    // 기술 상세 페이지가 쓰는 것과 같은 정규 id (boxing__jab → kickboxing__jab)
    const t = getTechnique('kickboxing__jab') ?? getTechnique('boxing__jab');
    const clip = cat.motionClipsFor(t.id)[0];
    out.technique = t.id;
    out.clipId = clip?.clipId;

    // 1) 실제 3D 렌더링 녹화
    const host = document.createElement('div');
    host.style.cssText = 'width:640px;height:480px;position:fixed;left:0;top:0;z-index:-1';
    document.body.appendChild(host);
    const engine = new MotionEngine(host, () => {}, { lowEnd: false });
    await engine.load(clip, cat.characterFileFor(clip));
    const rec = await R.recordPreviewOnce(engine, { angle: ANGLE, fps: 30 });
    engine.dispose(); host.remove();
    if (!rec.ok) { out.error = `녹화 실패: ${rec.failure} ${rec.message}`; return out; }
    out.recording = { angle: ANGLE, bytes: rec.sizeBytes, mime: rec.mimeType, clipMs: rec.clipDurationMs, fileMs: rec.fileDurationMs, leadInMs: rec.leadInMs };

    // 2) motion3d 기준 영상 등록 (sampleVideoBlob 포함)
    const reg = await S.registerMotion3dReference(t, { file: rec.file, clipId: clip.clipId, angle: ANGLE, cameraView: ANGLE, clipDurationSeconds: rec.clipDurationMs / 1000 });
    if (!reg.ok) { out.error = `등록 실패: ${reg.message}`; return out; }
    out.refId = reg.reference.id;
    out.sourceKind = reg.reference.source.kind;

    // 3) Gemini 실호출 #1 — 평가 기준 생성 (기존 ensureProfile → buildReferenceProfile)
    const prof = await S.ensureProfile(t, reg.reference);
    if (!prof.ok) { out.error = `평가 기준 생성 실패: ${prof.message}`; return out; }
    const p = prof.reference.profile;
    out.profile = {
      matchesTechnique: p.matchesTechnique, observedTechnique: p.observedTechnique, techniqueVisible: p.techniqueVisible,
      cameraView: p.cameraView, phases: p.phases.map((x) => x.name), active: p.active,
      criteria: p.criteria.map((c) => `${c.id}[${c.importance}·${c.aspect}] ${c.description}`),
      excluded: p.excluded, summary: p.summary,
    };
    // 저장 후 다시 불러와지는가
    const reloaded = store.getReference(prof.reference.id);
    out.profileReloaded = !!reloaded?.profile && reloaded.profile.criteria.length === p.criteria.length;

    // 4) 사용자 영상 — 업로드와 같은 경로 (sampleVideoBlob, fps 12)
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const userFile = new File([bytes], 'jab_good.webm', { type: 'video/webm' });
    const userClip = await sampleVideoBlob(userFile, { fps: 12 });
    out.userClip = { frames: userClip.frames.length, poses: userClip.poses.length, durationSeconds: userClip.durationSeconds, segment: userClip.signals.segment, cameraView: userClip.signals.cameraView };

    // 5) Gemini 실호출 #2 — 판정 + 점수 (기존 compareAttempt → prepareComparison → judgeAttempt → scoreComparison)
    const cmp = await S.compareAttempt(t, prof.reference, userClip);
    if (!cmp.ok) { out.error = `판정 실패: ${cmp.message}`; out.retake = cmp.retake ?? null; return out; }
    const rcd = cmp.outcome.record;
    out.record = {
      keys: Object.keys(rcd),
      score: rcd.score ?? rcd.breakdown ?? null,
      alignment: rcd.alignment ? { method: rcd.alignment.method, speedRatio: rcd.alignment.speedRatio, phases: rcd.alignment.phaseTimes?.length } : null,
      judgementCriteria: rcd.judgement?.criteria?.map((c) => `${c.criterionId}:${c.verdict}/${c.confidence}`) ?? null,
      strengths: rcd.judgement?.strengths ?? null,
      differences: rcd.judgement?.differences?.map((d) => d.what) ?? null,
      focus: rcd.judgement?.focus ?? null,
      sameTechnique: rcd.judgement?.sameTechnique, techniquePerformed: rcd.judgement?.techniquePerformed,
    };
    return out;
  }, { b64, angle: ANGLE });

  const calls = await app.evaluate(() => globalThis.__geminiCalls ?? []);
  step('결과', r);
  step('Gemini HTTP 호출', { 횟수: calls.length, 호출: calls });
  exitCode = r.error ? 1 : 0;
  fs.writeFileSync(path.join(APP, '.devtools/qa-motion3d-gemini-e2e.last.json'), JSON.stringify({ at: new Date().toISOString(), result: r, geminiCalls: calls }, null, 2));
} finally {
  // ---- 실제 프로필을 시작 상태로 되돌린다
  const restored = await page.evaluate(async ({ snapshot, before }) => {
    const { deleteReference } = await import('/src/lib/formCompare/referenceStore.ts');
    const mine = JSON.parse(localStorage.getItem('martialdex:form-reference-videos') || '[]').filter((r) => !before.includes(r.id)).map((r) => r.id);
    for (const id of mine) await deleteReference(id); // IndexedDB 미디어까지
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    }
    const same = Object.entries(snapshot).every(([k, v]) => localStorage.getItem(k) === v);
    return { 테스트가_만든_기준영상_삭제: mine.length, 네_개_키_원상복구: same };
  }, { snapshot, before }).catch((e) => ({ error: String(e) }));
  step('정리', restored);
  await app.close();
}
process.exit(exitCode);
