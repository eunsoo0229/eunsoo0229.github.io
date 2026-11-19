// React wiring for the training ecosystem: live learning states (recomputed when any record changes) and the app
// dependencies the pure modules take (technique lookup, pose-measurement support, next-technique recommender).

import { useEffect, useMemo, useState } from 'react';
import type { Technique } from '../../types';
import { computeAllSkillProgress } from '../skillProgress/weaknessEngine';
import { ADD_TEQ_CACHE_EVENT } from '../addTeq/repository';
import { LESSON_LOG_EVENT } from '../coachLesson/lessonLog';
import { getUnifiedAllTechniques, resolveTechnique } from '../userTechniques/service';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { poseSupport } from '../poseCoach/poseCoach';
import { nextToLearn } from '../personalCoach/personalAnswers';
import { loadLearnerModel } from '../personalCoach/learnerStore';
import { statesOf, type TechniqueState } from './learningState';
import type { RefreshDeps } from './personalCurriculum';

const EVENTS = ['martialdex:pose-records-updated', 'martialdex:training-history-updated', 'martialdex:skill-overrides-updated', ADD_TEQ_CACHE_EVENT, LESSON_LOG_EVENT, 'storage'];

export function computeEcoStates(now = new Date()): Map<string, TechniqueState> {
  return statesOf(computeAllSkillProgress(), now);
}

/** Learning states of every technique, kept current as records change. */
export function useEcoStates(): Map<string, TechniqueState> {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    for (const e of EVENTS) window.addEventListener(e, on);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, on);
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeEcoStates(), [tick]);
}

export const resolve = (id: string): Technique | undefined => resolveTechnique(id) ?? undefined;
export const poseSupported = (t: Technique) => {
  try {
    return poseSupport(t).supported;
  } catch {
    return false;
  }
};

export function appRefreshDeps(): RefreshDeps {
  return {
    resolve,
    poseSupported,
    basicsInArt: (art) => basicsInArt(art),
    nextInArt: (art, exclude) => {
      try {
        return nextToLearn(art, loadLearnerModel(), 8)
          .map((x) => x.technique.id)
          .filter((id) => !exclude.has(id));
      } catch {
        return [];
      }
    },
  };
}

/** The art's foundational records: 기본 자세 · 기본 움직임 · 풋워크 categories, teachable, easier first. */
export function basicsInArt(art: string, all: Technique[] = getUnifiedAllTechniques()): string[] {
  const rank = (t: Technique) => (t.difficulty === 'beginner' ? 0 : t.difficulty ? 2 : 1);
  return all
    .filter((t) => (t.martialArts ?? [t.martialArt]).includes(art) && /(기본 자세|기본 움직임|기본 자세와 움직임|풋워크|stance|movement)/i.test(t.category) && !t.notTechnique && lessonReadiness(t).level !== 'insufficient')
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6)
    .map((t) => t.id);
}

export const techniqueRoute = (t: Technique) => `/arts/${t.martialArt}/techniques/${encodeURIComponent(t.id)}`;
