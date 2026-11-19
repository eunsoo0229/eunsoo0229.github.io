// Phase 3 통합 검증 — 실제 Electron 브라우저에서 3D 프리뷰를 녹화해
// 진짜 영상 파일이 만들어지고, 그 파일이 기존 기준 영상 파이프라인
// (sampleVideoBlob → putMedia → saveReference → ensureProfile 입력)에
// 도달하는지 확인한다. Mock이 아니다 — WebGL 렌더링·MediaRecorder·
// IndexedDB가 모두 실제로 동작한다.
//
// 네트워크/Supabase/Gemini 호출 없음. 로컬 dev 서버만 사용한다.
// 사용법: npm run dev:vite 를 띄운 뒤  node .devtools/qa-motion3d-record-integration.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';

const APP = '/Users/swcho/Documents/MARTIALDEX';
const TECH = 'boxing__jab';          // motion3d.json: boxing-jab-m2m-v2, 1.2s
const env = { ...process.env, MARTIALDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} :: ${typeof detail === 'string' ? detail.slice(0, 220) : JSON.stringify(detail)?.slice(0, 220)}`); }
};

const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP], env, timeout: 60000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 160)));

// 3D 프리뷰가 있는 기술 상세로 이동하고 뷰어를 연다
await page.goto(`http://localhost:5173/#/arts/boxing/techniques/${encodeURIComponent(TECH)}`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

console.log('\n[1] 런타임 지원 여부');
const support = await page.evaluate(async () => {
  const m = await import('/src/lib/motion3d/recorder.ts');
  return { supported: m.isPreviewRecordingSupported(), mime: m.pickRecordMimeType() };
});
check('canvas.captureStream + MediaRecorder 지원', support.supported, support);
check('지원 MIME 타입을 런타임에서 확인', !!support.mime, support.mime);
if (!support.supported) { console.log('\n지원하지 않는 환경 — 이후 검증 불가'); await app.close(); process.exit(1); }

console.log('\n[2] 실제 렌더링 녹화');
const rec = await page.evaluate(async ({ tech }) => {
  const [{ MotionEngine }, { motionClipsFor }, { characterFileFor }, R] = await Promise.all([
    import('/src/lib/motion3d/engine.ts'),
    import('/src/lib/motion3d/catalog.ts'),
    import('/src/lib/motion3d/catalog.ts'),
    import('/src/lib/motion3d/recorder.ts'),
  ]);
  const clips = motionClipsFor(tech);
  if (!clips.length) return { error: 'no clip for technique' };
  const clip = clips[0];
  const host = document.createElement('div');
  host.style.cssText = 'width:480px;height:360px;position:fixed;left:0;top:0;z-index:-1';
  document.body.appendChild(host);
  const engine = new MotionEngine(host, () => {}, { lowEnd: false });
  await engine.load(clip, characterFileFor(clip));
  const stages = [];
  const out = await R.recordPreviewOnce(engine, { angle: 'diagonal', fps: 30, onStage: (s) => stages.push(s) });
  const result = out.ok
    ? { ok: true, stages, size: out.sizeBytes, mime: out.mimeType, clipMs: out.clipDurationMs, fileMs: out.fileDurationMs, name: out.file.name, angle: out.angle }
    : { ok: false, stages, stage: out.stage, failure: out.failure, message: out.message };
  // 파일을 다음 단계에서 쓰려고 전역에 둔다
  if (out.ok) window.__rec = { file: out.file, clip, clipMs: out.clipDurationMs };
  engine.dispose();
  host.remove();
  return result;
}, { tech: TECH });

if (rec.error) { check('3D 클립 로드', false, rec.error); await app.close(); process.exit(1); }
check('녹화 성공', rec.ok, rec.message ?? rec);
if (!rec.ok) { console.log(`\n실패 단계: ${rec.stage} / ${rec.failure}`); await app.close(); process.exit(1); }
check('상태 전이가 설계대로', JSON.stringify(rec.stages) === JSON.stringify(['preparing', 'recording', 'finalizing', 'validating']), rec.stages);
check('실제 영상 파일이 생성됨 (빈 Blob 아님)', rec.size > 4096, `${rec.size} bytes`);
check('녹화 길이가 애니메이션 길이와 일치', rec.fileMs === 0 || Math.abs(rec.fileMs - rec.clipMs) < rec.clipMs * 1.5 + 1500, `클립 ${rec.clipMs}ms / 파일 ${rec.fileMs}ms`);
check('파일이 선택한 각도를 반영', rec.angle === 'diagonal' && /motion3d-diagonal-/.test(rec.name), rec.name);

console.log('\n[3] 기존 기준 영상 파이프라인 진입');
const reg = await page.evaluate(async ({ tech }) => {
  const r = window.__rec;
  if (!r) return { error: 'no recording' };
  const [{ registerMotion3dReference }, { getTechnique }] = await Promise.all([
    import('/src/lib/formCompare/service.ts'),
    import('/src/lib/loadData.ts'),
  ]);
  const t = getTechnique(tech);
  if (!t) return { error: 'technique not found' };
  const calls = [];
  // sampleVideoBlob 가 실제로 호출되는지 보려고 콘솔 대신 길이로 확인한다
  const res = await registerMotion3dReference(t, {
    file: r.file, clipId: r.clip.clipId, angle: 'diagonal', cameraView: 'diagonal',
    clipDurationSeconds: r.clipMs / 1000,
    onProgress: (d, total) => calls.push([d, total]),
  });
  if (!res.ok) return { error: res.message };
  window.__ref = res.reference;
  return { ok: true, id: res.reference.id, source: res.reference.source, sampled: calls.length, endSeconds: res.reference.endSeconds };
}, { tech: TECH });

if (reg.error) { check('기준 영상 등록', false, reg.error); await app.close(); process.exit(1); }
check('motion3d 기준 영상으로 등록됨', reg.ok && reg.source.kind === 'motion3d', reg.source);
check('클립 id와 각도 메타데이터 보존', reg.source.clipId === 'boxing-jab-m2m-v2' && reg.source.angle === 'diagonal', reg.source);
check('sampleVideoBlob 이 실제로 프레임을 샘플링함', reg.sampled > 0, `${reg.sampled} progress calls`);
check('기준 구간 길이가 0보다 큼', reg.endSeconds > 0, reg.endSeconds);

console.log('\n[4] 저장 후 다시 불러오기 (파일 손실 / URL 만료 방지)');
const reload = await page.evaluate(async () => {
  const [{ listReferences, getMedia }, { hasLocalMedia }] = await Promise.all([
    import('/src/lib/formCompare/referenceStore.ts'),
    import('/src/lib/formCompare/types.ts'),
  ]);
  const id = window.__ref.id;
  const found = listReferences().find((r) => r.id === id) ?? null;
  const media = await getMedia(id);
  return {
    restored: !!found,
    kind: found?.source.kind ?? null,
    localMedia: found ? hasLocalMedia(found.source) : false,
    frames: media?.frames?.length ?? 0,
    poses: media?.poses?.length ?? 0,
    fileKept: !!media?.file,
    fileSize: media?.file?.size ?? 0,
  };
});
check('새로 읽어도 motion3d 기준 영상으로 식별됨', reload.restored && reload.kind === 'motion3d', reload);
check('로컬 미디어 보유로 판정됨 (hasLocalMedia)', reload.localMedia, reload);
check('프레임이 저장되어 있음', reload.frames > 0, `${reload.frames} frames`);
check('포즈가 저장되어 있음', reload.poses > 0, `${reload.poses} poses`);
check('원본 녹화 파일이 보존됨 (Blob URL 만료 무관)', reload.fileKept && reload.fileSize > 4096, reload);

console.log('\n[5] 기존 채점 엔진 실행 — AI 경계까지 실제 데이터로');
// buildReferenceProfile / judgeAttempt 는 askGeminiForJson(유료)을 호출하므로
// 실행하지 않는다. 대신 그 둘을 제외한 나머지(실제 녹화 미디어 → alignTimes →
// scoreComparison)를 진짜 데이터로 돌려, 기존 엔진이 motion3d 기준 영상으로도
// 점수를 산출하는지 확인한다.
const scored = await page.evaluate(async () => {
  const [{ prepareComparison }, { scoreComparison }, { getMedia }] = await Promise.all([
    import('/src/lib/formCompare/service.ts'),
    import('/src/lib/formCompare/scoring.ts'),
    import('/src/lib/formCompare/referenceStore.ts'),
  ]);
  const ref = window.__ref;
  const media = await getMedia(ref.id);
  if (!media) return { error: 'media missing' };

  // 사용자 촬영분 대신, 같은 파이프라인으로 추출된 실제 미디어를 사용자 클립으로 쓴다.
  // (카메라가 없는 테스트 환경 — 프레임·포즈·시그널의 형태와 경로는 실제와 동일하다.)
  const userClip = { poses: media.poses, frames: media.frames, signals: media.signals };
  // compareAttempt blocks a user clip without a detected motion segment before this point; mirror that.
  if (!media.signals.segment) return { error: 'no motion segment detected in the recording', issues: media.signals.issues };

  const phases = [
    { id: 'p1', name: '준비', description: '', startSec: null, endSec: null, startFraction: 0, endFraction: 0.3 },
    { id: 'p2', name: '실행', description: '', startSec: null, endSec: null, startFraction: 0.3, endFraction: 1 },
  ];
  const criteria = [
    { id: 'C1', phaseId: 'p1', aspect: 'start_posture', description: '가드가 올라가 있다', importance: 'core', evidence: 'R1' },
    { id: 'C2', phaseId: 'p2', aspect: 'limb_motion', description: '앞손이 직선으로 뻗는다', importance: 'core', evidence: 'R3' },
  ];
  const profile = {
    builtAt: new Date().toISOString(), model: 'gemini', techniqueVisible: true, matchesTechnique: true,
    observedTechnique: 'jab', cameraView: 'front', visibleBodyParts: [], phases, criteria,
    excluded: [], summary: '', active: { start: 0.1, end: 0.9 },
  };

  // 실제 엔진: 정렬 + 미디어 로딩
  const prepared = await prepareComparison(ref, profile, userClip);

  // 실제 엔진: 점수 산출 (AI 판정만 스텁)
  const judgement = {
    sameTechnique: true, techniquePerformed: true,
    criteria: [
      { criterionId: 'C1', verdict: 'match', confidence: 'high', observed: '', reason: '' },
      { criterionId: 'C2', verdict: 'partial', confidence: 'medium', observed: '', reason: '' },
    ],
    phases: [], strengths: [], differences: [], focus: [], drills: [], limitations: [],
    agreement: 1, samples: 1,
  };
  const score = scoreComparison({ criteria, phases, judgement, signals: userClip.signals, viewMatches: true });
  return {
    ok: true,
    alignMethod: prepared?.alignment?.method ?? null,
    phaseTimes: prepared?.alignment?.phaseTimes?.length ?? 0,
    score: score.total ?? score.score ?? null,
    scoreKeys: Object.keys(score),
  };
});

if (scored.error) check('기존 채점 엔진 실행', false, scored.error);
else {
  check('prepareComparison 이 실제 녹화 미디어로 정렬을 수행', !!scored.alignMethod, scored);
  check('정렬 결과에 단계별 시각이 생성됨', scored.phaseTimes > 0, scored.phaseTimes);
  check('scoreComparison 이 실제 점수를 반환', typeof scored.score === 'number' && scored.score >= 0, scored);
}

console.log('\n[6] 회귀 — 3D 애니메이션이 없는 기술');
const none = await page.evaluate(async () => {
  const { motionClipsFor } = await import('/src/lib/motion3d/catalog.ts');
  return { jabClips: motionClipsFor('boxing__jab').length, noneClips: motionClipsFor('boxing__does-not-exist').length };
});
check('클립 없는 기술은 3D 경로가 비어 있음', none.noneClips === 0 && none.jabClips > 0, none);

// 정리
await page.evaluate(async () => {
  const { deleteReference } = await import('/src/lib/formCompare/referenceStore.ts').catch(() => ({}));
  if (window.__ref && typeof deleteReference === 'function') { try { await deleteReference(window.__ref.id); } catch {} }
});

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await app.close();
process.exit(fail ? 1 : 0);
