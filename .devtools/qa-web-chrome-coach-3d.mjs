// 42개 문제 — Web(브라우저) 플랫폼 검증. 설치된 Google Chrome 을 헤드리스·새 프로필로 띄워
// 개발 서버(localhost:5173)의 웹 앱을 연다. 사용자의 실제 브라우저 프로필·데이터는 쓰지 않는다.
//   1. 자체 AI 코치 채팅: 3D 프리뷰가 채팅 안에서 열리고 그려지는가, "상세 화면 열어줘"가 실제로 이동하는가
//   2. 3D 캔버스 녹화: captureStream/MediaRecorder 지원 형식, recordPreviewOnce 로 실제 파일 생성, 길이 검증
//   3. 녹화 파일 → registerMotion3dReference (sampleVideoBlob + MediaPipe) → 기준 영상 저장·재조회
// Gemini 판정은 웹에서 운영 Edge Function(gemini-ask)과 로그인이 필요해 실행하지 않는다 (보고서에 미검증으로 기록).
//   node .devtools/qa-web-chrome-coach-3d.mjs
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 240)}`); } };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
await page.route(/generativelanguage|supabase\.co|functions\/v1/, (r) => r.abort());
console.log('Chrome:', browser.version());
try {
  await page.goto('http://localhost:5173/#/coach/chat', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const ua = await page.evaluate(() => ({ electron: !!window.martialdex, ua: navigator.userAgent.slice(0, 80) }));
  check('Electron 브리지 없음 (순수 웹 환경)', !ua.electron, ua);

  console.log('\n[1] 채팅 앱 액션 (웹)');
  await page.getByTestId('self-ai-input').fill('JAB의 3D 프리뷰 화면 띄워줘');
  await page.getByTestId('self-ai-send').click();
  const canvasOk = await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('[data-testid="chat-motion3d-card"] canvas')].pop();
    return !!c && c.width > 0;
  }, null, { timeout: 40000 }).then(() => true).catch(() => false);
  check('웹에서도 채팅 안에 3D 시연이 열리고 캔버스가 그려짐', canvasOk);
  await page.getByTestId('self-ai-input').fill('잽 기술 상세 화면 열어줘');
  await page.getByTestId('self-ai-send').click();
  const moved = await page.waitForFunction(() => location.hash.includes('/techniques/kickboxing__jab'), null, { timeout: 30000 }).then(() => true).catch(() => false);
  check('웹에서 기술 상세 화면으로 실제 이동', moved);

  console.log('\n[2] 3D 캔버스 녹화 (웹)');
  const rec = await page.evaluate(async () => {
    const [{ MotionEngine }, cat, R, S, { getTechnique }, store] = await Promise.all([
      import('/src/lib/motion3d/engine.ts'), import('/src/lib/motion3d/catalog.ts'), import('/src/lib/motion3d/recorder.ts'),
      import('/src/lib/formCompare/service.ts'), import('/src/lib/loadData.ts'), import('/src/lib/formCompare/referenceStore.ts'),
    ]);
    const out = { supported: R.isPreviewRecordingSupported(), mime: R.pickRecordMimeType() };
    const t = getTechnique('kickboxing__jab');
    const clip = cat.motionClipsFor(t.id)[0];
    const host = document.createElement('div');
    host.style.cssText = 'width:640px;height:480px;position:fixed;left:0;top:0;z-index:-1';
    document.body.appendChild(host);
    const e = new MotionEngine(host, () => {}, { lowEnd: false });
    await e.load(clip, cat.characterFileFor(clip));
    const r = await R.recordPreviewOnce(e, { angle: 'diagonal', fps: 30 });
    e.dispose(); host.remove();
    if (!r.ok) return { ...out, error: r.message };
    out.file = { bytes: r.sizeBytes, mime: r.mimeType, clipMs: r.clipDurationMs, fileMs: r.fileDurationMs, leadInMs: r.leadInMs };
    const reg = await S.registerMotion3dReference(t, { file: r.file, clipId: clip.clipId, angle: 'diagonal', cameraView: 'diagonal', clipDurationSeconds: r.clipDurationMs / 1000 });
    if (!reg.ok) return { ...out, error: reg.message };
    const media = await store.getMedia(reg.reference.id);
    out.reg = { kind: reg.reference.source.kind, angle: reg.reference.source.angle, frames: media?.frames.length ?? 0, poses: media?.poses.length ?? 0, segment: media?.signals.segment ?? null, fileKept: !!media?.file };
    out.reloaded = store.getReference(reg.reference.id)?.source.angle ?? null;
    await store.deleteReference(reg.reference.id);
    return out;
  });
  console.log('  ', JSON.stringify(rec));
  check('웹에서 3D 미리보기 녹화 지원 (captureStream + MediaRecorder)', rec.supported && !!rec.mime, rec);
  check('실제 녹화 파일 생성 (4KB 이상, 동작 길이 검증 통과)', !rec.error && rec.file?.bytes > 4096 && rec.file.fileMs >= rec.file.clipMs * 0.9, rec);
  check('녹화 파일 → 기준 영상 등록 (기존 sampleVideoBlob·MediaPipe 경로)', rec.reg?.kind === 'motion3d' && rec.reg.frames > 0 && rec.reg.poses > 0 && rec.reg.fileKept, rec.reg);
  check('기준 영상 동작 구간 확보 (자세 추정 또는 3D 클립 정보)', !!rec.reg?.segment, rec.reg?.segment);
  check('선택한 각도(대각선) 저장·재조회', rec.reloaded === 'diagonal', rec.reloaded);
} catch (e) {
  fail++;
  console.log('  FAIL  예외 ::', String(e).slice(0, 300));
}
console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
await browser.close();
process.exit(fail ? 1 : 0);
