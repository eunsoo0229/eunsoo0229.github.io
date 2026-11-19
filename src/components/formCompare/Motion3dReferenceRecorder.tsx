import { Suspense, lazy, useCallback, useRef, useState } from 'react';
import Icon from '../Icon';
import type { Technique } from '../../types';
import type { MotionClip } from '../../lib/motion3d/types';
import type { MotionEngine } from '../../lib/motion3d/engine';
import { motionClipsFor } from '../../lib/motion3d/catalog';
import { isPreviewRecordingSupported, recordPreviewOnce, type RecordStage } from '../../lib/motion3d/recorder';
import { registerMotion3dReference } from '../../lib/formCompare/service';
import { ANGLE_LABEL, type CaptureAngle } from '../../lib/timedCapture/reference';
import type { CameraView, ReferenceVideo } from '../../lib/formCompare/types';

const MotionViewer = lazy(() => import('../motion3d/MotionViewer'));

/** Used when a clip does not list its own capture angles. */
const DEFAULT_ANGLES: CaptureAngle[] = ['diagonal', 'side', 'front', 'back'];
/**
 * Preferred starting angle. Measured in Phase 5: a jab recorded from the front
 * is foreshortened (the arm moves toward the camera), and Gemini read it as
 * "guard stance, no jab". The 45° view shows both the reach and the body.
 */
const PREFERRED_ANGLE: CaptureAngle = 'diagonal';
/** The capture angle decides how the recorded render should be read as a camera view. */
const VIEW_OF: Record<CaptureAngle, CameraView> = { front: 'front', side: 'side', diagonal: 'diagonal', back: 'back' };

function anglesOf(clip: MotionClip | undefined): CaptureAngle[] {
  return clip?.captureAngles?.length ? clip.captureAngles : DEFAULT_ANGLES;
}
function startAngle(clip: MotionClip | undefined): CaptureAngle {
  const list = anglesOf(clip);
  return list.includes(PREFERRED_ANGLE) ? PREFERRED_ANGLE : list[0];
}

const STAGE_TEXT: Record<RecordStage, string> = {
  idle: '',
  preparing: '준비 중…',
  recording: '3D 미리보기를 녹화하는 중…',
  finalizing: '녹화를 마무리하는 중…',
  validating: '녹화한 영상을 검증하는 중…',
  registering: '기준 영상으로 등록하는 중…',
  ready: '등록 완료',
  failed: '실패',
};

/**
 * Makes a reference video out of the app's own 3D preview.
 *
 * It records the rendered canvas (motion3d/recorder.ts) and registers the file
 * through registerMotion3dReference(), so the result is an ordinary reference
 * video and the comparison afterwards is the same video pipeline a YouTube or
 * uploaded reference uses. No separate scoring path is introduced here.
 */
export default function Motion3dReferenceRecorder({
  technique,
  replaceId,
  currentAngle,
  onRegistered,
  onError,
}: {
  technique: Technique;
  replaceId?: string | null;
  /** Angle of the 3D reference in use, when re-recording at another angle. */
  currentAngle?: CameraView | null;
  onRegistered: (ref: ReferenceVideo) => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const clips = motionClipsFor(technique.id);
  const [clipIndex, setClipIndex] = useState(0);
  const [angleChoice, setAngle] = useState<CaptureAngle | null>(null);
  const [stage, setStage] = useState<RecordStage>('idle');
  const [note, setNote] = useState<string | null>(null);
  const engineRef = useRef<MotionEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  // Guards a second click while a recording is in flight (§3 중복 클릭 방지).
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const onEngine = useCallback((e: MotionEngine | null) => {
    engineRef.current = e;
    setEngineReady(!!e);
  }, []);

  const supported = isPreviewRecordingSupported();
  const clip: MotionClip | undefined = clips[clipIndex];
  const angles = anglesOf(clip);
  // A choice the current clip does not offer falls back to the clip's start angle.
  const angle: CaptureAngle = angleChoice && angles.includes(angleChoice) ? angleChoice : startAngle(clip);
  const busy = stage !== 'idle' && stage !== 'ready' && stage !== 'failed';

  async function run() {
    if (runningRef.current || !clip) return;
    const engine = engineRef.current;
    if (!engine) {
      onError('3D 미리보기가 아직 준비되지 않았습니다. 미리보기가 보인 뒤 다시 눌러 주세요.');
      return;
    }
    runningRef.current = true;
    abortRef.current = new AbortController();
    onError(null);
    setNote(null);
    try {
      const rec = await recordPreviewOnce(engine, { angle, fps: 30, onStage: setStage, signal: abortRef.current.signal });
      if (!rec.ok) {
        setStage('failed');
        onError(rec.message);
        return;
      }
      setStage('registering');
      const res = await registerMotion3dReference(technique, {
        file: rec.file,
        clipId: clip.clipId,
        angle,
        cameraView: VIEW_OF[angle],
        clipDurationSeconds: rec.clipDurationMs / 1000,
        replaceId: replaceId ?? null,
        onProgress: (d, t) => setNote(`녹화 영상에서 자세를 추출하는 중… ${Math.round((d / t) * 100)}%`),
      });
      if (!res.ok) {
        setStage('failed');
        onError(res.message);
        return;
      }
      setStage('ready');
      setNote(`${ANGLE_LABEL[angle]} 기준 영상으로 등록했습니다 (${(rec.sizeBytes / 1024).toFixed(0)}KB).`);
      await onRegistered(res.reference);
    } catch (e) {
      setStage('failed');
      onError(e instanceof Error ? e.message : '3D 기준 영상을 만들지 못했습니다.');
    } finally {
      runningRef.current = false;
      abortRef.current = null;
    }
  }

  if (clips.length === 0) {
    return (
      <p className="video-status-message" data-testid="form-ref-3d-none">
        이 기술에는 3D 시연이 없습니다. YouTube 주소나 영상 파일로 기준 영상을 등록해 주세요.
      </p>
    );
  }

  if (!supported) {
    return (
      <p className="ai-error" role="alert" data-testid="form-ref-3d-unsupported">
        이 환경에서는 3D 미리보기 녹화를 지원하지 않습니다 (canvas 녹화 미지원). YouTube 주소나 영상 파일로 등록해 주세요.
      </p>
    );
  }

  return (
    <div data-testid="form-ref-3d">
      {clips.length > 1 && (
        <div className="chip-row" style={{ marginTop: 8 }} role="group" aria-label="3D 시연 선택">
          {clips.map((c, i) => (
            <button key={c.clipId} type="button" className={`chip${i === clipIndex ? ' active' : ''}`} disabled={busy} onClick={() => setClipIndex(i)} data-testid="form-ref-3d-clip">
              {c.title ?? c.clipId}
            </button>
          ))}
        </div>
      )}

      <div className="chip-row" style={{ marginTop: 8 }} role="group" aria-label="촬영 각도">
        {angles.map((a) => (
          <button key={a} type="button" className={`chip${a === angle ? ' active' : ''}`} disabled={busy} aria-pressed={a === angle} onClick={() => setAngle(a)} data-testid={`form-ref-3d-angle-${a}`}>
            {ANGLE_LABEL[a]}
          </button>
        ))}
      </div>
      <p className="video-status-message" style={{ marginTop: 4 }} data-testid="form-ref-3d-angle-note">
        고른 각도(<strong>{ANGLE_LABEL[angle]}</strong>)는 기준 영상과 함께 저장되고, 내 자세를 촬영할 때 같은 각도로 찍도록 안내됩니다.
        {currentAngle && !replaceId && ` 지금 쓰는 3D 기준 영상은 ${ANGLE_LABEL[currentAngle as CaptureAngle] ?? currentAngle} 각도입니다 — 새로 녹화하면 별도의 기준 영상으로 추가되고 기존 것은 남습니다.`}
      </p>
      {angle === 'front' && (
        <p className="video-status-message" style={{ marginTop: 4 }} data-testid="form-ref-3d-angle-hint">
          정면에서는 카메라 쪽으로 뻗는 동작(잽·스트레이트 등)의 길이가 잘 보이지 않습니다. 대각선이나 측면을 권장합니다.
        </p>
      )}

      <div className="pose-capture-preview" style={{ marginTop: 8 }} data-testid="form-ref-3d-preview">
        <Suspense fallback={<p className="video-status-message">3D 뷰어 불러오는 중…</p>}>
          {clip && <MotionViewer clip={clip} view={angle} onReady={onEngine} />}
        </Suspense>
      </div>

      <div className="modal-actions modal-actions--start" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !engineReady}
          onClick={() => void run()}
          data-testid="form-ref-3d-record"
        >
          <Icon name="camera" /> {ANGLE_LABEL[angle]}에서 3D 기준 영상 녹화
        </button>
      </div>

      {stage !== 'idle' && (
        <p className={stage === 'failed' ? 'ai-error' : 'video-status-message'} role={stage === 'failed' ? 'alert' : undefined} data-testid="form-ref-3d-stage" data-stage={stage}>
          {STAGE_TEXT[stage]}{note ? ` ${note}` : ''}
        </p>
      )}
      {!engineReady && <p className="video-status-message">3D 미리보기를 준비하는 중입니다…</p>}
    </div>
  );
}
