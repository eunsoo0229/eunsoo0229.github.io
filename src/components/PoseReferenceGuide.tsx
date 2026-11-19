import { useState } from 'react';
import type { Technique } from '../types';
import YouTubeLite from './YouTubeLite';
import { getTechniqueVideos } from '../lib/techniqueVideo/service';
import { captureGuide } from '../lib/poseCoach/poseCoach';

// The camera measurement's reference panel (PoseAnalysisModal): the technique's demonstration video
// — the SAME registered videos the technique page shows (getTechniqueVideos: the technique DB's
// videos + the ones the user added there), nothing searched, copied or generated — and the capture
// instructions the measurement itself needs (captureGuide: only conditions the engine checks).
// MARTIALDEX has no recorded camera direction per technique, so none is guessed. Display only:
// the measurement, its scoring and the reference-video comparison (formCompare) are not touched.

export default function PoseReferenceGuide({ technique }: { technique: Technique }) {
  const videos = getTechniqueVideos(technique).slice(0, 3);
  const [pick, setPick] = useState(0);
  const guide = captureGuide(technique);
  const current = videos[pick] ?? null;
  const start = technique.posture?.startingPosition?.trim();
  return (
    <div className="pose-reference" data-testid="pose-reference">
      <div className="pose-reference__title">기준 시연 영상</div>
      {current ? (
        <>
          <div className="video-embed__frame-wrap pose-reference__frame" data-testid="pose-reference-video" data-video-id={current.videoId}>
            <YouTubeLite key={current.videoId} videoId={current.videoId} title={current.title} />
          </div>
          <div className="pose-reference__caption">{current.title}{current.channel ? ` · ${current.channel}` : ''}</div>
          {videos.length > 1 && (
            <div className="chip-row">
              {videos.map((v, i) => (
                <button key={v.videoId} type="button" className={`chip${i === pick ? ' active' : ''}`} onClick={() => setPick(i)} data-testid="pose-reference-pick">
                  영상 {i + 1}
                </button>
              ))}
            </div>
          )}
          <p className="pose-reference__note">기술 상세 화면과 같은 MARTIALDEX 등록 영상입니다. 촬영 각도·자세를 참고하는 용도이며, 점수는 이 영상과 비교해 내지 않습니다.</p>
        </>
      ) : (
        <p className="pose-reference__none" data-testid="pose-reference-none">
          이 기술에는 MARTIALDEX에 등록된 기준 시연 영상이 없습니다. 다른 기술의 영상은 보여 드리지 않습니다.
        </p>
      )}
      {guide && (
        <ul className="pose-reference__guide" data-testid="pose-reference-guide">
          <li>화면 범위: {guide.bodyRange}</li>
          <li>카메라 높이: {guide.cameraHeight} · 거리: {guide.distance}</li>
          <li>위치: {guide.placement}</li>
          <li>동작: {guide.motion}</li>
          <li>
            촬영 방향: MARTIALDEX 자료에 이 기술의 촬영 방향은 등록되어 있지 않습니다.
            {current ? ' 위 기준 영상의 카메라 방향과 같게 맞춰 주세요.' : ' 정확한 방향은 추측해서 안내하지 않습니다.'} (측정은 촬영 방향을 비교하지 않습니다)
          </li>
          {start && <li>등록된 시작 자세: {start}</li>}
        </ul>
      )}
    </div>
  );
}
