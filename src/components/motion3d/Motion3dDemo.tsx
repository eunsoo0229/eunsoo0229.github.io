import Icon from '../Icon';
import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import { motionClipsFor } from '../../lib/motion3d/catalog';
import { clipForStance, learnerStance } from '../../lib/motion3d/stance';

// Technique detail entry point for the 3D demo. Renders nothing for a technique without a clip in
// data/curated/motion3d.json. Closed by default: no three.js, no GLB, no <canvas> until the user opens it.
const MotionViewer = lazy(() => import('./MotionViewer'));

class ViewerBoundary extends Component<{ children: ReactNode; onReset: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('[motion3d] viewer crashed', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="motion3d-overlay" data-testid="motion3d-error" role="alert">
        <p>3D 시연을 표시하지 못했습니다.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => (this.setState({ failed: false }), this.props.onReset())}>
          닫기
        </button>
      </div>
    );
  }
}

export default function Motion3dDemo({ techniqueId, defaultOpen = false, preferClipId = null, heading = '3D 시연', testId = 'motion3d-card' }: { techniqueId: string; defaultOpen?: boolean; preferClipId?: string | null; heading?: string; testId?: string }) {
  const clips = motionClipsFor(techniqueId);
  const [open, setOpen] = useState(defaultOpen);
  // default: the version in the learner's stance (fighter profile); the chips switch between versions
  const [clipId, setClipId] = useState<string | null>(() => preferClipId ?? clipForStance(clips, learnerStance())?.clipId ?? null);
  if (!clips.length) return null;
  const clip = clips.find((c) => c.clipId === clipId) ?? clips[0];
  return (
    <div className="card info-card motion3d-card" data-testid={testId} data-technique={techniqueId} data-clip={clip.clipId}>
      <h3>
        {clip.actors.length > 1 ? <><Icon name="stance" /><Icon name="stance" /></> : <Icon name="stance" />} {heading}
        {clip.actors.length > 1 && (
          <span className="badge motion3d-duo-badge" data-testid="motion3d-duo">
            2인 시연
          </span>
        )}
      </h3>
      {clips.length > 1 && (
        <div className="chip-row" role="group" aria-label="시연 버전">
          {clips.map((c) => (
            <button key={c.clipId} type="button" className={`chip${c.clipId === clip.clipId ? ' active' : ''}`} onClick={() => setClipId(c.clipId)}>
              {c.variant}
            </button>
          ))}
        </div>
      )}
      {open ? (
        <ViewerBoundary onReset={() => setOpen(false)}>
          <Suspense fallback={<p className="video-status-message">3D 뷰어 불러오는 중…</p>}>
            <MotionViewer key={clip.clipId} clip={clip} onClose={() => setOpen(false)} />
          </Suspense>
        </ViewerBoundary>
      ) : (
        <>
          <p className="video-status-message">
            {clip.title} — 360도 회전, 속도 조절, 프레임 이동, 관절 보기, 준비·실행·종료 구간별 보기
            {clip.actors.length > 1 && ` · ${clip.actors.map((a) => a.label).join(' / ')}`}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="motion3d-open" onClick={() => setOpen(true)}>
            3D 시연 보기
          </button>
        </>
      )}
    </div>
  );
}
