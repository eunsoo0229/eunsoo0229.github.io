import Icon from '../Icon';
import { useEffect, useRef, useState } from 'react';
import { MotionEngine, MotionLoadError, isLowEndDevice, type CameraPreset, type EngineSnapshot, type LoadedInfo, type ViewMode } from '../../lib/motion3d/engine';
import { PLAYBACK_SPEEDS, frameAt, phaseAt, realDuration, stepFrame } from '../../lib/motion3d/timeline';
import type { MotionClip } from '../../lib/motion3d/types';
import { characterFileFor } from '../../lib/motion3d/catalog';

// The 3D demo viewer itself. Loaded with React.lazy from Motion3dDemo, so three.js and the GLB are fetched only
// when the user opens a demo; unmounting (closing) disposes the engine — loop, listeners, GPU resources.

const ERROR_TEXT: Record<MotionLoadError['kind'], string> = {
  network: '3D 시연 파일을 불러오지 못했습니다.',
  parse: '3D 시연 파일이 손상되어 표시할 수 없습니다.',
  animation: '이 시연 파일에 재생할 동작 정보가 없습니다.',
  rig: '시연 동작과 캐릭터의 뼈대가 맞지 않아 재생할 수 없습니다.',
  webgl: '이 기기에서는 3D 화면(WebGL)을 사용할 수 없습니다.',
};
const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: 'front', label: '정면' },
  { id: 'diagonal', label: '45°' },
  { id: 'side', label: '측면' },
  { id: 'back', label: '후면' },
];

/**
 * `view` (pose measurement): the camera follows the chosen capture angle; `onReady` hands the loaded engine to the
 * measurement, which samples the clip's reference joints from it (engine.referencePose).
 */
export default function MotionViewer({ clip, onClose, view, onReady }: { clip: MotionClip; onClose?: () => void; view?: CameraPreset; onReady?: (engine: MotionEngine | null) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MotionEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot>({ time: 0, playing: false, loop: clip.actors.length <= 1, speed: 1, mode: 'character', azimuthDeg: 0, distance: 0 });
  const [info, setInfo] = useState<LoadedInfo | null>(null);
  const [error, setError] = useState<MotionLoadError['kind'] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let engine: MotionEngine | null = null;
    let cancelled = false;
    setInfo(null);
    setError(null);
    try {
      engine = new MotionEngine(el, setSnap, { lowEnd: isLowEndDevice() });
      engineRef.current = engine;
      engine
        .load(clip, characterFileFor(clip))
        .then((i) => {
          if (cancelled) return;
          setInfo(i);
          readyRef.current?.(engine);
          if (i.durationSec !== clip.durationSec) console.warn('[motion3d] durationSec in motion3d.json differs from the GLB; using the file', clip.clipId, clip.durationSec, i.durationFromFile);
          engine!.play();
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn('[motion3d] load failed', clip.clipId, e);
          setError(e instanceof MotionLoadError ? e.kind : 'parse');
        });
    } catch (e) {
      setError(e instanceof MotionLoadError ? e.kind : 'webgl');
    }
    return () => {
      cancelled = true;
      readyRef.current?.(null);
      engine?.dispose();
      engineRef.current = null;
    };
  }, [clip, attempt]);
  // the capture angle drives the camera (after load, and whenever the learner picks another angle)
  useEffect(() => {
    if (view && info) engineRef.current?.setCamera(view);
  }, [view, info]);

  const e = engineRef.current;
  const ready = !!info && !error;
  const duration = info?.durationSec ?? clip.durationSec;
  const frameCount = Math.round(duration * clip.fps);
  const frame = frameAt(snap.time, clip.fps, frameCount);
  const phase = phaseAt(snap.time, clip.phases);

  return (
    <div className="motion3d-viewer" data-testid="motion3d-viewer" data-clip={clip.clipId}>
      <div className="motion3d-stage" ref={stageRef} data-testid="motion3d-stage" data-loaded={ready ? 'true' : 'false'} aria-label={`${clip.title} 3D 시연 — 드래그해서 회전, 휠·두 손가락으로 확대/축소`}>
        {!ready && !error && <p className="motion3d-overlay">3D 시연 불러오는 중…</p>}
        {error && (
          <div className="motion3d-overlay" data-testid="motion3d-error" role="alert">
            <p>{ERROR_TEXT[error]}</p>
            {error !== 'webgl' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}>
                다시 시도
              </button>
            )}
          </div>
        )}
      </div>

      {clip.actors.length > 1 && (
        <ul className="motion3d-roles" data-testid="motion3d-roles" aria-label="등장 인물">
          {clip.actors.map((a) => (
            <li key={a.id} data-role={a.role}>
              <span className="motion3d-roles__swatch" style={{ background: a.color ?? 'var(--text-muted)' }} aria-hidden="true" />
              {a.label}
            </li>
          ))}
        </ul>
      )}
      <div className="motion3d-controls" aria-disabled={!ready}>
        <div className="motion3d-row">
          <button type="button" className="btn btn-primary btn-sm" data-testid="motion3d-play" disabled={!ready} onClick={() => (snap.playing ? e?.pause() : e?.play())}>
            {snap.playing ? <><Icon name="pause" /> 일시정지</> : <><Icon name="play" /> 재생</>}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="motion3d-restart" disabled={!ready} onClick={() => e?.restart()}>
            <Icon name="refresh" /> 처음부터
          </button>
          <button type="button" className={`chip${snap.loop ? ' active' : ''}`} data-testid="motion3d-loop" disabled={!ready} aria-pressed={snap.loop} onClick={() => e?.setLoop(!snap.loop)}>
            <Icon name="repeat" /> 반복 재생
          </button>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="motion3d-prev-frame" disabled={!ready} aria-label="이전 프레임" onClick={() => (e?.pause(), e?.seek(stepFrame(snap.time, -1, clip.fps, frameCount, duration)))}>
            <Icon name="prev" />
          </button>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="motion3d-next-frame" disabled={!ready} aria-label="다음 프레임" onClick={() => (e?.pause(), e?.seek(stepFrame(snap.time, 1, clip.fps, frameCount, duration)))}>
            <Icon name="next" />
          </button>
          <label className="motion3d-speed">
            속도
            <select data-testid="motion3d-speed" value={snap.speed} disabled={!ready} onChange={(ev) => e?.setSpeed(Number(ev.target.value))}>
              {PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </label>
        </div>

        <input
          type="range"
          className="motion3d-timeline"
          data-testid="motion3d-timeline"
          min={0}
          max={duration}
          step={1 / clip.fps}
          value={snap.time}
          disabled={!ready}
          aria-label="타임라인"
          onPointerDown={() => e?.pause()}
          onChange={(ev) => e?.seek(Number(ev.target.value))}
        />
        <div className="motion3d-readout" data-testid="motion3d-readout">
          <span data-testid="motion3d-frame">
            프레임 {frame} / {frameCount}
          </span>
          <span>
            {snap.time.toFixed(2)}s / {duration.toFixed(2)}s
            {snap.speed !== 1 && ` (${snap.speed}x 재생 시 ${realDuration(duration, snap.speed).toFixed(2)}초)`}
          </span>
          {phase && <span data-testid="motion3d-current-phase">{phase.label}</span>}
        </div>

        <div className="motion3d-row" role="group" aria-label="구간">
          {clip.phases.map((p) => (
            <button
              key={p.name}
              type="button"
              className={`chip${phase?.name === p.name ? ' active' : ''}`}
              data-testid={`motion3d-phase-${p.name}`}
              disabled={!ready}
              onClick={() => (e?.pause(), e?.seek(p.startSec))}
            >
              {p.label} {p.startSec.toFixed(2)}–{p.endSec.toFixed(2)}s
            </button>
          ))}
        </div>

        <div className="motion3d-row" role="group" aria-label="시점">
          {CAMERAS.map((c) => (
            <button key={c.id} type="button" className="btn btn-ghost btn-sm" data-testid={`motion3d-camera-${c.id}`} disabled={!ready} onClick={() => e?.setCamera(c.id)}>
              {c.label}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" data-testid="motion3d-rotate" disabled={!ready} aria-label="오른쪽으로 45도 회전" onClick={() => e?.rotateBy(45)}>
            ⟳ 45°
          </button>
          <button type="button" className="btn btn-ghost btn-sm" data-testid="motion3d-zoom-in" disabled={!ready} aria-label="확대" onClick={() => e?.zoomBy(0.8)}>
            ＋
          </button>
          <button type="button" className="btn btn-ghost btn-sm" data-testid="motion3d-zoom-out" disabled={!ready} aria-label="축소" onClick={() => e?.zoomBy(1.25)}>
            －
          </button>
          <button
            type="button"
            className={`chip${snap.mode === 'skeleton' ? ' active' : ''}`}
            data-testid="motion3d-mode"
            disabled={!ready}
            aria-pressed={snap.mode === 'skeleton'}
            onClick={() => e?.setMode((snap.mode === 'skeleton' ? 'character' : 'skeleton') as ViewMode)}
          >
            {snap.mode === 'skeleton' ? <><Icon name="stance" /> 캐릭터 보기</> : <><Icon name="graph" /> 관절 보기</>}
          </button>
        </div>
      </div>

      <div className="motion3d-footer">
        <p className="video-status-message">
          {clip.pipeline.name === 'martialdex-keyframe' ? 'MARTIALDEX 자체 제작 키프레임 애니메이션' : `${clip.pipeline.name} ${clip.pipeline.version.split(' ')[0]} 모션 캡처`} · {clip.stance === 'southpaw' ? '사우스포 · ' : ''}
          {clip.fps}fps
          {!clip.quality.verified && ' · 검수 전 시연'}
        </p>
        {onClose && (
          <button type="button" className="btn btn-ghost btn-sm" data-testid="motion3d-close" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
    </div>
  );
}
