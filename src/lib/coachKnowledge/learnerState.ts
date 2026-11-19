import { canonicalTechniqueId } from '../techniqueCanonical';
import { computeAllSkillProgress, type TechniqueSkillEntry } from '../skillProgress/weaknessEngine';
import { weakTechniques, type WeakTechnique } from '../review/sources';
import { listMyActiveProgress } from '../curriculum/curriculumService';
import { latestKnownGoal } from '../aiCoachCurriculum/profile';
import { MASTERY_LABEL, type MasteryStatus } from '../skillProgress/types';

// 자체 AI 코치가 읽는 "이 사용자"의 학습 상태 — READ ONLY, through the app's
// existing pure readers (no new storage, no network, no AI):
//   - 숙련도·연습 기록  computeAllSkillProgress()  (pose scores, lesson ratings, practice, the user's own mark)
//   - 복습이 필요한 기술 weakTechniques()           (lesson / review / user-marked / pose evidence, with reasons)
//   - 진행 중인 커리큘럼 listMyActiveProgress()
//   - 목표 문장        latestKnownGoal()
// All of it lives in this device's local storage; it belongs to the signed-in
// user because the app clears it when another account signs in
// (auth/deviceAccountGuard.ts). Nothing here invents a level: no record →
// `hasRecords: false`, and the coach says it has no record to go on.
// Read only when a question / lesson request needs it (computeAllSkillProgress
// walks the catalog once).

export interface LearnedInfo {
  techniqueId: string;
  status: MasteryStatus;
  statusLabel: string;
  /** Completed practices recorded in training history. */
  practiceCount: number;
  coachLessonCount: number;
  lastPracticedAt: string | null;
  /** Where the status came from — reported honestly ("한 번 완료" ≠ "숙달"). */
  basis: string;
}

export interface LearnerState {
  hasRecords: boolean;
  /** canonical id → what the records say (only techniques with ANY record). */
  learned: Map<string, LearnedInfo>;
  /** Techniques the records say need review, highest priority first. */
  weak: WeakTechnique[];
  activeCurricula: { id: string; title: string; martialArt: string; currentDay: number; completed: boolean }[];
  goal: string | null;
}

function basisOf(e: TechniqueSkillEntry): string {
  const p = e.progress;
  if (p.userOverride) return '사용자가 직접 표시한 숙련도';
  if (p.analysisCount > 0) return `자세 분석 ${p.analysisCount}회`;
  if (p.coachLessonCount > 0) return `AI 코치 수업 ${p.coachLessonCount}회`;
  if (p.practiceCount > 0) return `훈련 기록 ${p.practiceCount}회`;
  return '기록 없음';
}

/** The current user's learning state from this device's records. Never throws: a failed read = no records. */
export function readLearnerState(): LearnerState {
  const learned = new Map<string, LearnedInfo>();
  let weak: WeakTechnique[] = [];
  let activeCurricula: LearnerState['activeCurricula'] = [];
  let goal: string | null = null;
  try {
    for (const e of computeAllSkillProgress()) {
      const p = e.progress;
      const any = p.status !== 'not_started' || p.practiceCount > 0 || p.analysisCount > 0 || p.coachLessonCount > 0;
      if (!any) continue;
      const id = canonicalTechniqueId(e.technique.id);
      learned.set(id, {
        techniqueId: id,
        status: p.status,
        statusLabel: MASTERY_LABEL[p.status],
        practiceCount: p.practiceCount,
        coachLessonCount: p.coachLessonCount,
        lastPracticedAt: p.lastPracticedAt,
        basis: basisOf(e),
      });
    }
  } catch {
    learned.clear();
  }
  try {
    weak = weakTechniques();
  } catch {
    weak = [];
  }
  try {
    activeCurricula = listMyActiveProgress().map(({ curriculum, progress }) => ({
      id: curriculum.id,
      title: curriculum.title,
      martialArt: curriculum.martialArt,
      currentDay: progress.currentDay,
      completed: progress.progress >= 100 || progress.completedDays.length >= (curriculum.days?.length ?? Infinity),
    }));
  } catch {
    activeCurricula = [];
  }
  try {
    goal = latestKnownGoal().trim() || null;
  } catch {
    goal = null;
  }
  return { hasRecords: learned.size > 0 || weak.length > 0, learned, weak, activeCurricula, goal };
}

export function learnedInfo(state: LearnerState, techniqueId: string): LearnedInfo | null {
  return state.learned.get(canonicalTechniqueId(techniqueId)) ?? null;
}
