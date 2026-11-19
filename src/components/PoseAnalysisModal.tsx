import Icon from './Icon';
import { ensureCameraAccess, openCameraSettings } from '../lib/media/cameraAccess';
import { SkillStatusGlyph } from './StatusGlyph';
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import type { Technique } from '../types';
import type { PoseAnalysisResult, PoseFrame } from '../lib/poseAnalysis/types';
import { POSE_CONNECTIONS } from '../lib/poseAnalysis/landmarks';
import { createPoseLandmarker, type PoseLandmarker } from '../lib/poseAnalysis/poseEstimator';
import { analyzeTechnique, type AnalyzeOutcome } from '../lib/poseAnalysis/analyzeTechnique';
import { saveAnalysisResult } from '../lib/poseAnalysis/recordsService';
import { STATUS_LABEL } from '../lib/poseAnalysis/scoring';
import { motionClipsFor } from '../lib/motion3d/catalog';
import type { MotionClip } from '../lib/motion3d/types';
import type { MotionEngine } from '../lib/motion3d/engine';
import { listReferences } from '../lib/formCompare/referenceStore';
import { ANGLE_LABEL, chooseCaptureReference, referenceFromClip, referenceFromVideo, type CaptureAngle, type CaptureRecord, type CaptureReference } from '../lib/timedCapture/reference';
import { clipToWindow, type CaptureClock } from '../lib/timedCapture/clock';
import { useTimedCapture } from '../lib/timedCapture/useTimedCapture';
import { compareToReference, toAnalysisResult, RETAKE_TEXT, type Compare3dResult } from '../lib/poseCompare3d/compare';
import { learnerStance } from '../lib/motion3d/stance';
import AiAskModal from './AiAskModal';
import PoseReferenceGuide from './PoseReferenceGuide';
import CaptureGauge from './timedCapture/CaptureGauge';
import YouTubeSegment from './formCompare/YouTubeSegment';
// loaded only when opened (keeps this page's first load unchanged)
const FormCompareModal = lazy(() => import('./formCompare/FormCompareModal'));
const MotionViewer = lazy(() => import('./motion3d/MotionViewer'));

// 카메라 자세 측정 — the ONE capture flow every camera measurement uses (technique tab, AI lesson suggestions,
// 자세 확인, today's training / review, curriculum day, situation recommendation):
//   reference (3D clip, or a registered single-technique video segment) → angle (3D: linked to the preview camera)
//   → guide → countdown 3-2-1 → recording for exactly the reference's length (draining gauge, monotonic clock)
//   → automatic stop → processing → result. Cancel at any point leaves no record.
// 3D reference: the learner's joints are compared with the clip's own joints (poseCompare3d). Video reference:
// the existing joint-rule analysis (analyzeTechnique) over a window as long as the segment.
// Camera frames live only in memory and are discarded on close; only a successful result is saved.

const REF_SAMPLE_FPS = 30;

type CameraPhase = 'requesting' | 'denied' | 'loading-model' | 'model-error' | 'ready';
type Outcome = { kind: '3d'; compare: Compare3dResult; result: PoseAnalysisResult | null; record: CaptureRecord } | { kind: 'rules'; analysis: AnalyzeOutcome; record: CaptureRecord };

/** The learner's stance version of a measurable clip, else the clip to mirror. */
function clipFor(clips: MotionClip[], stance: 'orthodox' | 'southpaw'): { clip: MotionClip; mirror: boolean } | null {
  const usable = clips.filter((c) => c.measure && c.actors.length === 1);
  const same = usable.find((c) => (c.stance ?? 'orthodox') === stance);
  if (same) return { clip: same, mirror: false };
  return usable[0] ? { clip: usable[0], mirror: true } : null;
}

export default function PoseAnalysisModal({ technique, onClose }: { technique: Technique; onClose: () => void }) {
  const [camPhase, setCamPhase] = useState<CameraPhase>('requesting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [processing, setProcessing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(true);
  const [cancelled, setCancelled] = useState(false);

  // ---- reference: designated video segment when usable, else the 3D clip (a video is never required)
  const profileStance = useMemo(learnerStance, []);
  const stance = profileStance ?? 'orthodox';
  const pick3d = useMemo(() => clipFor(motionClipsFor(technique.id), stance), [technique.id, stance]);
  const videos = useMemo(() => listReferences(technique.id), [technique.id]);
  const chosen = useMemo(() => chooseCaptureReference(technique.id, { clips: pick3d ? [pick3d.clip] : [], videos }), [technique.id, pick3d, videos]);
  const options = useMemo(() => {
    const out: CaptureReference[] = [];
    for (const v of videos) {
      const r = referenceFromVideo(v);
      if (r.ok) out.push(r.reference);
    }
    if (pick3d) {
      const r = referenceFromClip(pick3d.clip, technique.id);
      if (r.ok) out.push(r.reference);
    }
    return out;
  }, [videos, pick3d, technique.id]);
  const [refId, setRefId] = useState<string | null>(chosen.outcome.ok ? chosen.outcome.reference.id : null);
  const reference = options.find((o) => o.id === refId) ?? null;
  const refVideo = reference?.kind === 'video' ? videos.find((v) => v.id === reference.id) ?? null : null;
  const [angle, setAngle] = useState<CaptureAngle>('front');
  const captureAngle: CaptureAngle | null = reference?.kind === 'motion3d' ? angle : reference?.angles[0] ?? null;
  const engineRef = useRef<MotionEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const onEngine = useCallback((e: MotionEngine | null) => {
    engineRef.current = e;
    setEngineReady(!!e);
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const framesRef = useRef<PoseFrame[]>([]);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    landmarkerRef.current?.close();
    streamRef.current = null;
    landmarkerRef.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback(
    (clock: CaptureClock, stoppedAt: number) => {
      const frames = clipToWindow(clock, framesRef.current);
      framesRef.current = [];
      if (!reference) return;
      const record: CaptureRecord = {
        referenceKind: reference.kind,
        referenceId: reference.id,
        segmentStartSec: reference.segmentStartSec,
        segmentEndSec: reference.segmentEndSec,
        plannedMs: reference.durationMs,
        fps: reference.fps,
        angle: captureAngle,
        startedAtMs: clock.startAt,
        endedAtMs: Math.min(stoppedAt, clock.endAt),
        stopLatencyMs: Math.max(0, Math.round(stoppedAt - clock.endAt)),
        startedAtIso: new Date(Date.now() - (performance.now() - clock.startAt)).toISOString(),
      };
      setProcessing(true);
      // processing after the stop: let the "처리 중" state paint first
      window.setTimeout(() => {
        if (reference.kind === 'motion3d' && pick3d) {
          const track = engineRef.current?.referencePose(angle, REF_SAMPLE_FPS) ?? null;
          const v = videoRef.current;
          const aspect = v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
          const compare = track
            ? compareToReference({ frames, aspect, windowStartMs: clock.startAt, durationMs: clock.durationMs, reference: track, phases: pick3d.clip.phases, measure: pick3d.clip.measure!, clipLead: pick3d.clip.leadHand ?? 'left', mirror: pick3d.mirror })
            : null;
          if (!compare) {
            setErrorMessage('3D 기준 관절을 만들지 못했습니다. 3D 미리보기가 열린 상태에서 다시 시도해 주세요.');
            setProcessing(false);
            return;
          }
          const result = toAnalysisResult(technique.id, compare);
          if (result) saveAnalysisResult(technique.martialArt, result, { method: 'reference_3d', referenceId: reference.id, reliability: compare.reliability, capture: record });
          setOutcome({ kind: '3d', compare, result, record });
        } else {
          const analysis = analyzeTechnique(technique.id, frames);
          if (analysis.ok) saveAnalysisResult(technique.martialArt, analysis.result, { method: 'landmark', referenceId: reference.id, capture: record });
          setOutcome({ kind: 'rules', analysis, record });
        }
        setProcessing(false);
      }, 30);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reference, captureAngle, angle, pick3d, technique.id, technique.martialArt],
  );

  const capture = useTimedCapture({
    durationMs: reference?.durationMs ?? 0,
    onRecordStart: () => {
      framesRef.current = [];
      setCancelled(false);
    },
    onRecordEnd: finish,
    onCancel: () => {
      framesRef.current = [];
      setCancelled(true);
    },
  });
  const recordingRef = capture.recordingRef;

  // Live camera + skeleton every animation frame; frames are kept only inside the recording window.
  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (video && canvas && landmarker && video.readyState >= 2) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const now = performance.now();
        const frame = landmarker.detect(video, now);
        if (frame) {
          ctx.strokeStyle = '#e2564c';
          ctx.lineWidth = 3;
          for (const [a, b] of POSE_CONNECTIONS) {
            const pa = frame[a];
            const pb = frame[b];
            if (!pa || !pb) continue;
            ctx.beginPath();
            ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
            ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
            ctx.stroke();
          }
          ctx.fillStyle = '#f0c419';
          for (const key of Object.keys(frame)) {
            if (key === 'timestampMs') continue;
            const p = (frame as unknown as Record<string, { x: number; y: number; visibility: number }>)[key];
            if (!p || p.visibility < 0.5) continue;
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // a frame with nobody detected still counts (timestamp only): "no person" is a result, not silence
        if (recordingRef.current) framesRef.current.push(frame ? { ...frame, timestampMs: now } : { timestampMs: now });
      }
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, [recordingRef]);

  const requestCamera = useCallback(async () => {
    setCamPhase('requesting');
    setErrorMessage(null);
    // macOS는 앱이 TCC로 요청하기 전까지 비디오 장치를 숨긴다 — 먼저 묻지 않으면 웹캠이 있어도
    // NotFoundError("카메라를 찾을 수 없습니다")가 난다. 다른 OS에서는 통과만 한다.
    const access = await ensureCameraAccess();
    if (!access.ok) {
      setCamPhase('denied');
      setErrorMessage(access.message);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      const name = (err as DOMException)?.name;
      setCamPhase('denied');
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setErrorMessage('카메라 접근 권한이 거부되었습니다. 시스템/브라우저 설정에서 카메라 권한을 허용한 뒤 다시 시도해주세요.');
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setErrorMessage('카메라를 찾을 수 없습니다. 카메라가 연결되어 있는지 확인해주세요.');
      else setErrorMessage('카메라를 여는 중 문제가 발생했습니다.');
      return;
    }
    setCamPhase('loading-model');
    try {
      landmarkerRef.current = await createPoseLandmarker();
    } catch {
      setCamPhase('model-error');
      setErrorMessage('자세 분석 모듈을 불러오지 못했습니다. 앱을 다시 시작한 뒤 시도해주세요.');
      return;
    }
    setCamPhase('ready');
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(drawLoop);
  }, [drawLoop]);

  useEffect(() => {
    void requestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry() {
    setOutcome(null);
    setCancelled(false);
    capture.reset();
  }

  const busy = capture.phase === 'countdown' || capture.phase === 'recording' || processing;
  const needsEngine = reference?.kind === 'motion3d';
  const canStart = camPhase === 'ready' && !!reference && !busy && !outcome && (!needsEngine || engineReady);

  // Switched to the reference-video comparison (camera already released by cleanup()).
  if (compareOpen)
    return (
      <Suspense fallback={null}>
        <FormCompareModal technique={technique} onClose={onClose} />
      </Suspense>
    );

  const result = outcome?.kind === '3d' ? outcome.result : outcome?.kind === 'rules' && outcome.analysis.ok ? outcome.analysis.result : null;
  const sec = reference ? (reference.durationMs / 1000).toFixed(2) : null;

  // Layout only: the title and the action bar stay pinned, the middle scrolls on its own; the reference
  // panel is hidden with `hidden` (never unmounted) so toggling it touches neither the camera nor the session.
  return (
    <div className="modal-overlay pose-modal-overlay" onClick={onClose}>
      <div
        className={`modal-panel modal-panel--scrollable pose-modal${refOpen ? ' pose-modal--with-ref' : ''}`}
        onClick={(e) => e.stopPropagation()}
        data-testid="pose-modal"
        data-reference-kind={reference?.kind ?? ''}
        data-reference-id={reference?.id ?? ''}
        data-capture-ms={reference?.durationMs ?? ''}
        data-capture-phase={processing ? 'processing' : outcome ? 'result' : capture.phase}
      >
        <div className="pose-modal__head">
          <h3><Icon name="camera" /> {technique.name} 자세 분석</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefOpen((v) => !v)} aria-expanded={refOpen} data-testid="pose-ref-toggle">
            {refOpen ? '기준 숨기기' : <><Icon name="video" /> 기준 보기</>}
          </button>
        </div>
        <div className="modal-scroll-body pose-modal__body" data-testid="pose-modal-body">
          <div className="chip-row" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="chip"
              onClick={() => {
                capture.cancel();
                cleanup();
                setCompareOpen(true);
              }}
              data-testid="pose-to-form-compare"
            >
              <Icon name="video" /> 기준 시연 영상과 비교해 평가하기 (AI 비교)
            </button>
          </div>

          {/* reference + capture length */}
          <div className="card info-card pose-capture-ref" data-testid="pose-capture-reference">
            {reference ? (
              <>
                {options.length > 1 && (
                  <div className="chip-row" role="group" aria-label="측정 기준">
                    {options.map((o) => (
                      <button key={o.id} type="button" className={`chip${o.id === reference.id ? ' active' : ''}`} disabled={busy} onClick={() => (setRefId(o.id), setOutcome(null))} data-testid={`pose-ref-${o.kind}`}>
                        {o.kind === 'motion3d' ? <><Icon name="stance" /> 3D 시연 기준</> : <><Icon name="video" /> 기준 영상 구간</>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="pose-capture-ref__line" data-testid="pose-capture-length">
                  기준: <strong>{reference.kind === 'motion3d' ? `3D 시연 — ${reference.label}` : `기준 영상 — ${reference.label}`}</strong> · 촬영 길이 <strong>{sec}초</strong>
                  {reference.kind === 'motion3d' ? ` (${reference.frameCount}프레임 ÷ ${reference.fps}fps, 1.0배속 1회)` : ` (지정 구간 ${reference.segmentStartSec.toFixed(1)}–${reference.segmentEndSec.toFixed(1)}초)`}
                </p>
                {reference.kind === 'motion3d' && pick3d && (
                  <p className="video-status-message" data-testid="pose-capture-stance">
                    {pick3d.mirror
                      ? `프로필 스탠스: ${stance === 'southpaw' ? '사우스포' : '오소독스'} — 이 기술은 그 스탠스의 3D 시연이 아직 없어, 시연의 왼손·오른손을 바꾼 기준과 비교합니다. 3D 미리보기는 다른 스탠스 시연입니다.`
                      : `스탠스: ${(pick3d.clip.stance ?? 'orthodox') === 'southpaw' ? '사우스포' : '오소독스'} 시연 기준 (앞손 = ${pick3d.clip.leadHand === 'right' ? '오른손' : '왼손'}${pick3d.clip.measure?.strikeHand === 'rear' ? `, 이 기술은 뒷손 = ${pick3d.clip.rearHand === 'left' ? '왼손' : '오른손'}` : ''})${profileStance ? ' — 프로필의 기본 스탠스' : ' (프로필에 기본 스탠스가 없어 오소독스로 측정합니다)'}`}
                  </p>
                )}
              </>
            ) : (
              <div className="ai-error" role="alert" data-testid="pose-capture-no-reference">
                {chosen.outcome.ok ? '기준을 선택해 주세요.' : chosen.outcome.message} 촬영 길이를 정할 기준이 없어 측정을 시작하지 않습니다.
              </div>
            )}
          </div>

          <div className="pose-stage">
            <div className="pose-camera-frame" data-testid="pose-camera-frame">
              <video ref={videoRef} className="pose-video" muted playsInline />
              <canvas ref={canvasRef} className="pose-canvas" />
              {camPhase === 'requesting' && <div className="pose-overlay-message">카메라 권한을 요청하는 중…</div>}
              {camPhase === 'loading-model' && <div className="pose-overlay-message">분석 모듈을 불러오는 중…</div>}
              {(camPhase === 'denied' || camPhase === 'model-error') && <div className="pose-overlay-message pose-overlay-message--error">{errorMessage}</div>}
              {camPhase === 'ready' && capture.phase === 'idle' && !outcome && !processing && <div className="pose-overlay-message">카메라 앞에 서서 자세를 준비해주세요.</div>}
              {capture.phase === 'countdown' && (
                <div className="pose-countdown-overlay" data-testid="pose-countdown">
                  <div className="pose-countdown-overlay__label">{sec}초 동안 자동으로 촬영합니다</div>
                  <div key={capture.countdownLeft} className="pose-countdown-overlay__number">
                    {capture.countdownLeft}
                  </div>
                </div>
              )}
              {processing && <div className="pose-overlay-message" data-testid="pose-processing">촬영 끝 — 관절을 분석하는 중…</div>}
            </div>
            <div className="pose-stage__ref" hidden={!refOpen} data-testid="pose-reference-panel">
              {reference?.kind === 'motion3d' && pick3d && (
                <div className="pose-capture-preview" data-testid="pose-capture-3d">
                  <Suspense fallback={<p className="video-status-message">3D 뷰어 불러오는 중…</p>}>
                    <MotionViewer clip={pick3d.clip} view={angle} onReady={onEngine} />
                  </Suspense>
                </div>
              )}
              {reference?.kind === 'video' && refVideo && (
                <div className="pose-capture-preview" data-testid="pose-capture-video">
                  {refVideo.source.kind === 'youtube' ? (
                    <YouTubeSegment videoId={refVideo.source.videoId} start={refVideo.startSeconds} end={refVideo.endSeconds} title={refVideo.source.title} />
                  ) : (
                    <p className="video-status-message">기준 영상 파일: {refVideo.source.fileName} ({refVideo.startSeconds.toFixed(1)}–{refVideo.endSeconds.toFixed(1)}초) — 기준 영상 비교 화면에서 재생할 수 있습니다.</p>
                  )}
                </div>
              )}
              <PoseReferenceGuide technique={technique} />
            </div>
          </div>

          {/* angle + guide */}
          {reference && (
            <div className="card info-card pose-capture-guide" data-testid="pose-capture-guide">
              {reference.kind === 'motion3d' ? (
                <div className="chip-row" role="group" aria-label="촬영 각도">
                  {reference.angles.map((a) => (
                    <button key={a} type="button" className={`chip${a === angle ? ' active' : ''}`} disabled={busy} aria-pressed={a === angle} onClick={() => setAngle(a)} data-testid={`pose-angle-${a}`}>
                      {ANGLE_LABEL[a]}
                    </button>
                  ))}
                </div>
              ) : null}
              <ul>
                <li>
                  촬영 각도: <strong>{captureAngle ? ANGLE_LABEL[captureAngle] : '기준 영상의 방향을 알 수 없음'}</strong> —{' '}
                  {reference.kind === 'motion3d' ? '3D 미리보기 카메라와 같은 방향에서 카메라가 나를 보게 서 주세요 (정면 = 상대 쪽에 카메라).' : '기준 영상과 같은 방향에서 촬영해 주세요.'}
                </li>
                <li>머리부터 발끝까지 화면에 들어오게, 밝은 곳에서 서 주세요.</li>
                <li>
                  「촬영 시작」 → 3, 2, 1 → <strong>{sec}초</strong> 동안 자동 촬영 (아래 게이지가 줄어듭니다) → 자동 종료. 가드 자세에서 시작해 기술을 <strong>한 번</strong> 하고 가드로 돌아오세요.
                </li>
              </ul>
            </div>
          )}

          {capture.phase === 'recording' && <CaptureGauge remainingMs={capture.remainingMs} durationMs={capture.durationMs} />}
          {cancelled && !busy && !outcome && (
            <p className="video-status-message" data-testid="pose-capture-cancelled">
              촬영을 취소했습니다. 결과는 저장되지 않았습니다.
            </p>
          )}
          {errorMessage && camPhase === 'ready' && (
            <div className="ai-error" role="alert">
              {errorMessage}
            </div>
          )}

          {outcome && (
            <div
              className="pose-result"
              data-testid="pose-result"
              data-method={outcome.kind}
              data-ok={result ? 'true' : 'false'}
              data-score={result?.overallScore ?? ''}
              data-planned-ms={outcome.record.plannedMs}
              data-actual-ms={Math.round(outcome.record.endedAtMs - outcome.record.startedAtMs)}
              data-stop-latency-ms={outcome.record.stopLatencyMs}
              data-frames={outcome.kind === '3d' ? outcome.compare.frames.total : ''}
              data-angle={outcome.record.angle ?? ''}
            >
              {result ? (
                <>
                  <div className="pose-result__score">
                    <div className="pose-result__score-num">{result.overallScore} / 100</div>
                    <div className="pose-result__status">
                      <SkillStatusGlyph status={result.status} /> {STATUS_LABEL[result.status]}
                      {outcome.kind === '3d' && ` · 측정 신뢰도 ${{ high: '높음', medium: '보통', low: '낮음' }[outcome.compare.reliability]}`}
                    </div>
                  </div>
                  <div className="pose-metric-list">
                    {result.metricScores.map((m) => (
                      <div key={m.id} className="pose-metric-row">
                        <span className="pose-metric-row__name">{m.name}</span>
                        <div className="progress-track pose-metric-row__bar">
                          <div className="progress-fill" style={{ width: `${m.measured === false ? 0 : m.score}%` }} />
                        </div>
                        <span className="pose-metric-row__score">{m.measured === false ? '측정 불가' : m.score}</span>
                      </div>
                    ))}
                  </div>
                  {outcome.kind === '3d' ? (
                    <>
                      {outcome.compare.feedback.map((f) => (
                        <p key={f} className="pose-result__line" data-testid="pose-feedback">
                          {f}
                        </p>
                      ))}
                      {outcome.compare.reliabilityReasons.length > 0 && <p className="video-status-message">신뢰도 근거: {outcome.compare.reliabilityReasons.join(' · ')}</p>}
                      {outcome.compare.retake.map((r) => (
                        <p key={r} className="video-status-message">
                          참고: {RETAKE_TEXT[r]}
                        </p>
                      ))}
                      <p className="video-status-message">3D 시연과 같은 각도·같은 시간축에서 관절 위치를 비교한 일치도입니다. 기술 숙련도 전체를 평가한 점수는 아니며, 학습 기록·숙련도는 바뀌지 않습니다.</p>
                    </>
                  ) : (
                    <>
                      {result.strengths.length > 0 && <p className="pose-result__line"><Icon name="check" /> 잘한 부분: {result.strengths.join(', ')}</p>}
                      {result.improvements.length > 0 && <p className="pose-result__line"><Icon name="warn" /> 개선할 부분: {result.improvements.join(', ')}</p>}
                    </>
                  )}
                </>
              ) : (
                <div className="ai-error" role="alert" data-testid="pose-retake">
                  {outcome.kind === '3d' ? (
                    <>
                      다시 촬영해 주세요 — 점수와 기록은 바뀌지 않았습니다.
                      <ul>
                        {outcome.compare.retake.map((r) => (
                          <li key={r} data-retake={r}>
                            {RETAKE_TEXT[r]}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : !outcome.analysis.ok && outcome.analysis.reason === 'no_pose_detected' ? (
                    '카메라에서 자세를 충분히 인식하지 못했습니다. 몸 전체(어깨~발목)가 프레임에 나오도록 하고 다시 시도해주세요.'
                  ) : !outcome.analysis.ok && outcome.analysis.reason === 'insufficient_metrics' ? (
                    `평가에 필요한 관절을 충분히 인식하지 못해 점수를 내지 않았습니다(측정 불가: ${outcome.analysis.unmeasured.join(', ')}). 몸 전체가 보이게 다시 촬영해 주세요.`
                  ) : (
                    '이 기술은 기준 영상 구간으로는 카메라 관절 점수를 낼 수 없습니다(관절 규칙 미지원). 3D 시연 기준이나 「기준 시연 영상과 비교」를 이용해 주세요.'
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions pose-modal__footer" data-testid="pose-modal-footer">
          {!outcome && !processing && capture.phase === 'idle' && camPhase === 'ready' && reference && (
            <button className="btn btn-primary" onClick={capture.start} disabled={!canStart} data-testid="pose-capture-start" title={needsEngine && !engineReady ? '3D 기준을 불러오는 중입니다' : undefined}>
              <Icon name="play" /> 촬영/분석 시작{sec ? ` (${sec}초)` : ''}
            </button>
          )}
          {(capture.phase === 'countdown' || capture.phase === 'recording') && (
            <button className="btn btn-secondary" onClick={capture.cancel} data-testid="pose-capture-cancel">
              <Icon name="close" /> 촬영 취소
            </button>
          )}
          {camPhase === 'denied' && window.martialdex?.openCameraSettings && (
            /* 권한이 막힌 경우 "다시 시도"만으로는 풀 수 없다 — 설정을 바로 열어 준다 */
            <button className="btn btn-ghost" data-testid="pose-open-camera-settings" onClick={() => void openCameraSettings()}>
              시스템 설정 열기
            </button>
          )}
          {(camPhase === 'denied' || camPhase === 'model-error') && (
            <button className="btn btn-primary" onClick={requestCamera}>
              다시 시도
            </button>
          )}
          {outcome && (
            <>
              <button className="btn btn-secondary" onClick={handleRetry} data-testid="pose-capture-retry">
                다시 촬영
              </button>
              {result && (
                <button className="btn btn-secondary" onClick={() => setAiOpen(true)}>
                  <Icon name="spark" /> AI에게 질문하기
                </button>
              )}
            </>
          )}
          <button
            className={`btn ${outcome ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              capture.cancel();
              onClose();
            }}
            data-testid="pose-modal-close"
          >
            닫기
          </button>
        </div>
      </div>
      {aiOpen && result && <AiAskModal onClose={() => setAiOpen(false)} technique={technique} poseResult={result} />}
    </div>
  );
}
