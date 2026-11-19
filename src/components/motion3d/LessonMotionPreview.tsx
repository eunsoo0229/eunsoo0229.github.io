import Icon from '../Icon';
import type { Technique } from '../../types';
import { motionClipsFor } from '../../lib/motion3d/catalog';
import Motion3dDemo from './Motion3dDemo';

// The technique being taught, shown in 3D inside an AI lesson (same viewer as the technique page). Keyed by the
// lesson's technique id, so what is explained and what is shown are always the same technique. The posture points
// listed are the technique's own DB data (data/curated/posture.json), not text written for the animation.
export default function LessonMotionPreview({ technique, label }: { technique: Technique; label?: string }) {
  const clip = motionClipsFor(technique.id)[0];
  if (!clip) {
    return (
      <p className="video-status-message" data-testid="lesson-motion3d-missing" data-technique={technique.id}>
        <Icon name="stance" /> {label ?? technique.koreanName ?? technique.name}: 아직 3D 시연이 없습니다. 아래 영상 자료를 참고하세요.
      </p>
    );
  }
  const p = technique.posture;
  return (
    <div className="lesson-motion-preview" data-testid="lesson-motion-preview" data-technique={technique.id}>
      <Motion3dDemo techniqueId={technique.id} heading={`3D 시연 · ${label ?? technique.koreanName ?? technique.name}`} testId="lesson-motion3d-card" />
      {(p?.keyPoints?.length || p?.commonMistakes?.length) && (
        <details className="lesson-motion-preview__points">
          <summary>자세 포인트 (기술 DB)</summary>
          {p?.keyPoints?.length ? (
            <ul>
              {p.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          ) : null}
          {p?.commonMistakes?.length ? (
            <>
              <p className="muted">흔한 실수</p>
              <ul>
                {p.commonMistakes.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </>
          ) : null}
        </details>
      )}
    </div>
  );
}
