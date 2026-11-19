import type { MotionEngine } from './engine';
import type { CaptureAngle } from '../timedCapture/reference';

/**
 * Records ONE playthrough of the 3D preview as a real video file.
 *
 * This exists so the 3D path can use the SAME reference-video pipeline as a
 * YouTube/file reference (formCompare): the recording becomes the reference
 * video, and both sides are then compared as video. It deliberately does not
 * export joint coordinates — poseCompare3d does that, and it stays where it is
 * for the techniques and features that already rely on it.
 *
 * The capture source is the engine's own WebGLRenderer canvas, so what is
 * recorded is exactly what was rendered at the chosen camera angle.
 */

export type RecordStage = 'idle' | 'preparing' | 'recording' | 'finalizing' | 'validating' | 'registering' | 'ready' | 'failed';

export type RecordFailure =
  | 'unsupported'      // captureStream / MediaRecorder missing in this runtime
  | 'no_clip'          // engine has no animation loaded
  | 'empty'            // recorder produced no data (the Electron trap clipExtractor.ts warns about)
  | 'too_small'        // produced a file too small to be real frames
  | 'undecodable'      // the blob will not decode as video
  | 'duration_mismatch'
  | 'aborted'
  | 'recorder_error'
  | 'timeout';

export interface RecordOk {
  ok: true;
  file: File;
  mimeType: string;
  /** Length the engine played, in ms. */
  clipDurationMs: number;
  /** Length the produced file decodes to, in ms (0 when the container omits it). */
  fileDurationMs: number;
  sizeBytes: number;
  angle: CaptureAngle;
  /** How long the first frame was held while the encoder started (idle lead-in at the head of the file). */
  leadInMs: number;
}

export interface RecordFail {
  ok: false;
  stage: RecordStage;
  failure: RecordFailure;
  message: string;
}

export type RecordResult = RecordOk | RecordFail;

// Video-only, same lesson as clipExtractor.ts: an audio track that never
// delivers data makes MediaRecorder silently record nothing in Chromium.
const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

/** Smaller than this is not a real recording — an empty container is ~hundreds of bytes. */
const MIN_BYTES = 4096;
const FAIL_TEXT: Record<RecordFailure, string> = {
  unsupported: '이 환경에서는 3D 미리보기 녹화를 지원하지 않습니다 (captureStream/MediaRecorder 없음). 기존 기준 영상을 등록해 사용해 주세요.',
  no_clip: '3D 미리보기가 아직 준비되지 않았습니다. 미리보기가 열린 뒤 다시 시도해 주세요.',
  empty: '녹화된 영상이 비어 있습니다. 3D 미리보기 화면이 보이는 상태에서 다시 시도해 주세요.',
  too_small: '녹화 파일이 정상적인 영상으로 보이지 않습니다. 다시 시도해 주세요.',
  undecodable: '녹화한 영상을 재생할 수 없습니다. 이 기기의 녹화 코덱 문제일 수 있습니다.',
  duration_mismatch: '녹화 길이가 동작 길이와 크게 다릅니다. 다시 시도해 주세요.',
  aborted: '녹화를 취소했습니다.',
  recorder_error: '녹화 중 오류가 발생했습니다.',
  timeout: '녹화가 제한 시간을 넘겼습니다.',
};

type RecordableCanvas = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };

export function pickRecordMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Can this runtime record the preview at all? Checked before anything is offered in the UI. */
export function isPreviewRecordingSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas') as RecordableCanvas;
  return typeof c.captureStream === 'function' && !!pickRecordMimeType();
}

/** Decoded length of a produced blob, or 0 when the container carries no duration. */
export async function probeBlobDurationMs(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(ms);
    };
    const timer = window.setTimeout(() => done(0), 8000);
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      // MediaRecorder WebM often has no duration header — seeking far makes the
      // browser compute it (same workaround clipExtractor.ts uses).
      if (!Number.isFinite(v.duration) || v.duration === 0) {
        v.onseeked = () => {
          window.clearTimeout(timer);
          done(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
        };
        v.currentTime = 1e101;
        return;
      }
      window.clearTimeout(timer);
      done(Math.round(v.duration * 1000));
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(-1); // undecodable
    };
    v.src = url;
  });
}

const fail = (stage: RecordStage, failure: RecordFailure, extra?: string): RecordFail => ({
  ok: false, stage, failure, message: extra ? `${FAIL_TEXT[failure]} (${extra})` : FAIL_TEXT[failure],
});

/**
 * Accepts a file only when it covers the whole motion: at least 90% of the clip
 * (container rounding) and no more than the clip plus the lead-in actually held
 * while the encoder started (plus 1s of slack for container rounding / the tail).
 */
export function durationAcceptable(fileMs: number, clipMs: number, leadInMs: number = MAX_LEAD_IN_MS): boolean {
  return fileMs >= clipMs * 0.9 && fileMs <= clipMs + Math.max(0, leadInMs) + 1000;
}

/**
 * MediaRecorder drops the frames it receives while its encoder initialises, and
 * the file's timeline starts at the first frame it actually encodes. Measured in
 * Electron 32: ~400ms lost at the start — for a 1.2s jab that is the whole
 * wind-up. So the first frame is held until the encoder has produced data, and
 * only then does the motion start. The held copies that survive become a short
 * idle lead-in, which the comparison pipeline already treats as idle.
 */
//
// Time to the first encoded chunk varies a lot: measured 146–1268ms in a freshly
// started Electron process (the first recording of a process is the slowest). A
// 1500ms cap failed 2 of 3 cold recordings, so the cap is generous and the
// duration check uses the lead-in actually held instead of the cap.
//
// Android System WebView (measured 2026-11-15, WebView 103 on an x86_64 API 33 emulator with a software GPU)
// ignores the 100ms timeslice: with timeslice alone the first data came after 3.4–6.2s or never within 8s,
// which failed every recording at the old 5s cap. Asking for the buffer with requestData() every 250ms made
// the encoded data surface as soon as the encoder had it (VP8 1.3s, VP9 2.7–4.4s there; Electron unchanged).
// The cap is 10s for such slow devices; the file length check still uses the lead-in actually held.
const MAX_LEAD_IN_MS = 10_000;
/** Returns the ms the first frame was held, or null when the encoder never produced data. */
async function warmUpEncoder(hasData: () => boolean, pushHeldFrame: () => void, frameMs: number, signal?: AbortSignal, flush?: () => void): Promise<number | null> {
  const started = performance.now();
  let lastFlush = started;
  while (!hasData()) {
    if (signal?.aborted) return null;
    if (performance.now() - started > MAX_LEAD_IN_MS) return null;
    pushHeldFrame();
    if (flush && performance.now() - lastFlush >= 250) {
      lastFlush = performance.now();
      try {
        flush();
      } catch {
        /* recorder not in a state that can flush — keep waiting */
      }
    }
    await new Promise((r) => window.setTimeout(r, frameMs));
  }
  return Math.round(performance.now() - started);
}

export interface RecordOptions {
  angle: CaptureAngle;
  /** Frames per second asked of captureStream. */
  fps?: number;
  onStage?: (stage: RecordStage) => void;
  signal?: AbortSignal;
}

/**
 * Plays the clip once at `angle` while recording the canvas.
 *
 * Playback and recording are tied together: the recorder starts before play()
 * and stops when the engine reports playback finished, so the file covers
 * exactly one playthrough.
 */
export async function recordPreviewOnce(engine: MotionEngine, opts: RecordOptions): Promise<RecordResult> {
  const stage = (s: RecordStage) => opts.onStage?.(s);
  stage('preparing');

  const mimeType = pickRecordMimeType();
  const canvas = engine.canvas as RecordableCanvas;
  if (!mimeType || typeof canvas.captureStream !== 'function') return fail('preparing', 'unsupported');
  const clipDurationMs = Math.round(engine.duration * 1000);
  if (!(clipDurationMs > 0)) return fail('preparing', 'no_clip');
  if (opts.signal?.aborted) return fail('preparing', 'aborted');

  // One playthrough from the start, at the requested angle. Playback is driven
  // by renderAt() below, so loop/speed are set only to leave the viewer in a
  // sane state afterwards.
  engine.setCamera(opts.angle);
  engine.setLoop(false);
  engine.setSpeed(1);
  engine.seek(0);
  engine.renderAt(0);
  // let the first frame of the new camera actually render before capture starts
  await new Promise((r) => window.setTimeout(r, 60));

  // captureStream(0) gives a track whose frames are pushed explicitly with
  // requestFrame(). Letting the browser auto-sample at an fps depends on the
  // page actually compositing, which a hidden/background window may not do —
  // measured: the same 1200ms clip produced 35ms and 396ms files that way.
  // Pushing each rendered frame makes the capture independent of compositing.
  const stream = canvas.captureStream(0);
  const videoOnly = new MediaStream(stream.getVideoTracks());
  const track = videoOnly.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  if (!track) return fail('preparing', 'empty', '비디오 트랙 없음');
  const pushFrame = typeof track.requestFrame === 'function' ? () => track.requestFrame!() : null;
  if (!pushFrame) {
    // No manual push available — fall back to timed sampling at a real fps.
    stream.getTracks().forEach((t) => t.stop());
    const auto = canvas.captureStream(opts.fps ?? 30);
    videoOnly.getTracks().forEach((t) => t.stop());
    return recordWithAutoCapture(engine, auto, mimeType, clipDurationMs, opts, stage);
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(videoOnly, { mimeType, videoBitsPerSecond: 2_500_000 });
  } catch (e) {
    return fail('preparing', 'recorder_error', e instanceof Error ? e.message : String(e));
  }

  const chunks: BlobPart[] = [];
  let recorderError: string | null = null;
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onerror = (e) => { recorderError = (e as unknown as { error?: Error }).error?.message ?? '알 수 없는 녹화 오류'; };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  stage('recording');
  recorder.start(100); // timeslice so data arrives even if the clip is short
  const warmed = await warmUpEncoder(() => chunks.length > 0, () => { engine.renderAt(0); pushFrame(); }, 1000 / (opts.fps ?? 30), opts.signal, () => recorder.requestData());
  if (warmed === null) {
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
    await stopped;
    videoOnly.getTracks().forEach((t) => t.stop());
    stream.getTracks().forEach((t) => t.stop());
    return fail('recording', opts.signal?.aborted ? 'aborted' : 'empty', '인코더가 프레임을 받지 못했습니다');
  }

  // The recorder drives the frames itself rather than calling engine.play():
  // the engine's rAF loop refuses to run while the window is hidden or the
  // viewer is offscreen, and a suspended loop produces an empty recording
  // (measured: a 1200ms clip came out as a 35ms file). Driving renderAt() here
  // paces one playthrough in real time regardless of that state, so the file's
  // length matches the animation's length.
  const ended = await new Promise<RecordFailure | null>((resolve) => {
    const startedAt = performance.now();
    const hardDeadline = window.setTimeout(() => resolve('timeout'), clipDurationMs * 3 + 10_000);
    // setTimeout, not rAF: rAF is throttled or paused while the window is hidden,
    // which truncated the recording. The app disables background throttling for
    // automation, and for a real user the window is visible anyway.
    const frameMs = 1000 / (opts.fps ?? 30);
    const tick = () => {
      if (opts.signal?.aborted) { window.clearTimeout(hardDeadline); resolve('aborted'); return; }
      if (recorderError) { window.clearTimeout(hardDeadline); resolve('recorder_error'); return; }
      const elapsedMs = performance.now() - startedAt;
      engine.renderAt(Math.min(elapsedMs / 1000, engine.duration));
      pushFrame();
      if (elapsedMs >= clipDurationMs) { window.clearTimeout(hardDeadline); resolve(null); return; }
      window.setTimeout(tick, frameMs);
    };
    tick();
  });

  stage('finalizing');
  // let the last pushed frame reach the recorder before stopping
  await new Promise((r) => window.setTimeout(r, 120));
  try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
  await stopped;
  videoOnly.getTracks().forEach((t) => t.stop());
  stream.getTracks().forEach((t) => t.stop());

  if (ended) return fail('finalizing', ended, recorderError ?? undefined);

  stage('validating');
  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) return fail('validating', 'empty');
  if (blob.size < MIN_BYTES) return fail('validating', 'too_small', `${blob.size}바이트`);

  const fileDurationMs = await probeBlobDurationMs(blob);
  if (fileDurationMs < 0) return fail('validating', 'undecodable');
  // The file must hold the WHOLE motion at real speed. The old bound (≥ 0.5×)
  // passed a 1200ms clip recorded as 728ms — a reference ~1.6× too fast whose
  // wind-up had been dropped, which Gemini then read as "no jab". A short file
  // means frames were lost, so it is rejected rather than registered.
  if (fileDurationMs > 0 && !durationAcceptable(fileDurationMs, clipDurationMs, warmed)) {
    return fail('validating', 'duration_mismatch', `동작 ${clipDurationMs}ms / 파일 ${fileDurationMs}ms`);
  }

  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `motion3d-${opts.angle}-${Date.now()}.${ext}`, { type: mimeType.split(';')[0] });
  return { ok: true, file, mimeType, clipDurationMs, fileDurationMs, sizeBytes: blob.size, angle: opts.angle, leadInMs: warmed };
}


/**
 * Fallback for runtimes without MediaStreamTrack.requestFrame(): let the browser
 * sample the canvas at a fixed fps while the engine is driven in real time. Less
 * reliable in a background window, which is why it is only the fallback.
 */
async function recordWithAutoCapture(
  engine: MotionEngine,
  stream: MediaStream,
  mimeType: string,
  clipDurationMs: number,
  opts: RecordOptions,
  stage: (s: RecordStage) => void,
): Promise<RecordResult> {
  const videoOnly = new MediaStream(stream.getVideoTracks());
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(videoOnly, { mimeType, videoBitsPerSecond: 2_500_000 });
  } catch (e) {
    return fail('preparing', 'recorder_error', e instanceof Error ? e.message : String(e));
  }
  const chunks: BlobPart[] = [];
  let recorderError: string | null = null;
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onerror = (e) => { recorderError = (e as unknown as { error?: Error }).error?.message ?? '알 수 없는 녹화 오류'; };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  stage('recording');
  recorder.start(100);
  const frameMs = 1000 / (opts.fps ?? 30);
  const warmed = await warmUpEncoder(() => chunks.length > 0, () => engine.renderAt(0), frameMs, opts.signal, () => recorder.requestData());
  if (warmed === null) {
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
    await stopped;
    videoOnly.getTracks().forEach((t) => t.stop());
    stream.getTracks().forEach((t) => t.stop());
    return fail('recording', opts.signal?.aborted ? 'aborted' : 'empty', '인코더가 프레임을 받지 못했습니다');
  }
  const startedAt = performance.now();
  const ended = await new Promise<RecordFailure | null>((resolve) => {
    const deadline = window.setTimeout(() => resolve('timeout'), clipDurationMs * 3 + 10_000);
    const tick = () => {
      if (opts.signal?.aborted) { window.clearTimeout(deadline); resolve('aborted'); return; }
      if (recorderError) { window.clearTimeout(deadline); resolve('recorder_error'); return; }
      const elapsedMs = performance.now() - startedAt;
      engine.renderAt(Math.min(elapsedMs / 1000, engine.duration));
      if (elapsedMs >= clipDurationMs) { window.clearTimeout(deadline); resolve(null); return; }
      window.setTimeout(tick, frameMs);
    };
    tick();
  });

  stage('finalizing');
  await new Promise((r) => window.setTimeout(r, 120));
  try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
  await stopped;
  videoOnly.getTracks().forEach((t) => t.stop());
  stream.getTracks().forEach((t) => t.stop());
  if (ended) return fail('finalizing', ended, recorderError ?? undefined);

  stage('validating');
  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) return fail('validating', 'empty');
  if (blob.size < MIN_BYTES) return fail('validating', 'too_small', `${blob.size}바이트`);
  const fileDurationMs = await probeBlobDurationMs(blob);
  if (fileDurationMs < 0) return fail('validating', 'undecodable');
  if (fileDurationMs > 0 && !durationAcceptable(fileDurationMs, clipDurationMs, warmed)) {
    return fail('validating', 'duration_mismatch', `동작 ${clipDurationMs}ms / 파일 ${fileDurationMs}ms`);
  }
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `motion3d-${opts.angle}-${Date.now()}.${ext}`, { type: mimeType.split(';')[0] });
  return { ok: true, file, mimeType, clipDurationMs, fileDurationMs, sizeBytes: blob.size, angle: opts.angle, leadInMs: warmed };
}
