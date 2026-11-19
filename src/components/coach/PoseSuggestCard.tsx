import { lazy, Suspense, useState } from 'react';
import type { Technique } from '../../types';
import { markPoseSuggest, poseSuggestMarks, shouldSuggestPose } from '../../lib/poseCoach/poseCoach';

// "자세 측정해 볼까요?" — offered once per technique per lesson session after its practice is done,
// on every lesson screen and with any coach (자체 AI 코치 or Gemini): the measurement is the app's
// existing local camera measurement (PoseAnalysisModal), so no AI call and no cost depends on the
// coach. "나중에 하기" is remembered for this lesson session only; neither choice changes the lesson
// state, the learning records or any pose score.

const PoseAnalysisModal = lazy(() => import('../PoseAnalysisModal'));

export default function PoseSuggestCard({ technique, sessionKey, practiced, label }: { technique: Technique; sessionKey: string; practiced: boolean; label?: string }) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const marks = poseSuggestMarks(sessionKey);
  const mark = (m: 'shown' | 'declined') => {
    markPoseSuggest(sessionKey, technique.id, m);
    setTick((n) => n + 1);
  };
  const show = shouldSuggestPose(technique, { practiced, declined: marks[technique.id] === 'declined', alreadySuggested: marks[technique.id] === 'shown' });
  const name = label ?? technique.koreanName ?? technique.name;
  return (
    <>
      {show && (
        <div className="card info-card lesson-pose-suggest" data-testid="lesson-pose-suggest">
          <p>
            이번에는 {name} 동작을 연습했어요. {name}은(는) MARTIALDEX 카메라 자세 측정을 지원하는 기술이라, 실제 자세가 기준에 맞는지 측정해 볼 수 있습니다. 측정해 볼까요? (선택 사항 — 측정하지 않아도 수업 기록에는 영향이 없습니다)
          </p>
          <div className="lesson-return__actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                mark('shown');
                setOpen(true);
              }}
              data-testid="lesson-pose-accept"
            >
              자세 측정하기
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark('declined')} data-testid="lesson-pose-decline">
              나중에 하기
            </button>
          </div>
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <PoseAnalysisModal technique={technique} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
