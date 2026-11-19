// The learner's state per technique, in the six stages the training ecosystem uses (사양 §2-2):
//   학습 전 · 학습 중 · 학습 완료 · 반복 학습 필요 · 평가 필요 · 숙련도 확인 완료
// computed — never stored — from what the app already records (skillProgress: pose scores, AI-coach lesson
// assessments, training history, the user's own setting). A proficiency is only called "확인" when a real
// evaluation backs it; a technique that was practised but never evaluated is "평가 필요", and a self-set level
// without an evaluation is shown with "평가 데이터 부족" instead of being presented as a measured result.

import type { Technique } from '../../types';
import type { MasteryStatus, SkillProgress } from '../skillProgress/types';
import type { TechniqueSkillEntry } from '../skillProgress/weaknessEngine';

export type EcoState = 'not_started' | 'learning' | 'completed' | 'needs_repeat' | 'needs_evaluation' | 'verified';

export const ECO_STATE_LABEL: Record<EcoState, string> = {
  not_started: '학습 전',
  learning: '학습 중',
  completed: '학습 완료',
  needs_repeat: '반복 학습 필요',
  needs_evaluation: '평가 필요',
  verified: '숙련도 확인 완료',
};

/** Order used to rank "how far along" (higher = further). needs_repeat sits below completed: it must be redone. */
export const ECO_STATE_RANK: Record<EcoState, number> = { not_started: 0, learning: 1, needs_evaluation: 2, needs_repeat: 2, completed: 3, verified: 4 };

export type EvidenceKind = 'pose' | 'lesson' | 'practice' | 'self' | 'none';

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  pose: '자세 측정',
  lesson: 'AI 코치 수업 평가',
  practice: '연습 기록만',
  self: '사용자가 직접 지정',
  none: '기록 없음',
};

export interface TechniqueState {
  techniqueId: string;
  technique: Technique;
  state: EcoState;
  /** What the state rests on. */
  evidence: EvidenceKind;
  /** True when no evaluation (pose / lesson assessment) backs the level — shown as "평가 데이터 부족". */
  evaluationMissing: boolean;
  /** The skill engine's own mastery status (kept for links to existing screens). */
  mastery: MasteryStatus;
  latestScore: number | null;
  analysisCount: number;
  practiceCount: number;
  lessonCount: number;
  lastActivityAt: string | null;
  /** Review is due (skill engine's spacing) — an overdue technique counts as needs_repeat. */
  reviewDue: boolean;
  /** Days since the last practice / evaluation, null when never. */
  idleDays: number | null;
}

/** A technique that has not been touched for this long is suggested for review even if it was learned. */
export const STALE_DAYS = 21;

const days = (from: string | null, now: Date) => (from ? Math.floor((now.getTime() - new Date(from).getTime()) / 86400000) : null);

function latest(...dates: (string | null)[]): string | null {
  return dates.filter((d): d is string => !!d).sort().pop() ?? null;
}

/** The six-stage state of one technique from its skill progress (pure). */
export function stateOf(technique: Technique, p: SkillProgress, now = new Date()): TechniqueState {
  const evaluated = p.analysisCount > 0 || p.coachMasteredDays > 0 || (p.coachLessonCount > 0 && p.computedStatus !== 'learning' && p.computedStatus !== 'not_started');
  const evidence: EvidenceKind = p.userOverride ? 'self' : p.analysisCount > 0 ? 'pose' : p.coachLessonCount > 0 ? 'lesson' : p.practiceCount > 0 ? 'practice' : 'none';
  const lastActivityAt = latest(p.lastPracticedAt, p.lastAnalyzedAt);
  const idleDays = days(lastActivityAt, now);
  const reviewDue = !!p.nextReviewAt && new Date(p.nextReviewAt).getTime() <= now.getTime();
  let state: EcoState;
  switch (p.status) {
    case 'not_started':
      state = 'not_started';
      break;
    case 'needs_improvement':
      state = 'needs_repeat';
      break;
    case 'proficient':
      // proficient by a real evaluation = verified; by the user's own word only = completed (evaluation missing)
      state = evaluated && !p.userOverride ? 'verified' : 'completed';
      break;
    case 'average':
      state = evaluated || p.userOverride ? 'completed' : 'needs_evaluation';
      break;
    case 'learning':
    default:
      // practised several times and never evaluated → it is time to evaluate it
      state = !evaluated && p.practiceCount >= 2 ? 'needs_evaluation' : 'learning';
  }
  // a learned technique left alone too long, or overdue for its spaced review, has to be repeated
  if ((state === 'completed' || state === 'verified') && ((idleDays !== null && idleDays >= STALE_DAYS) || (reviewDue && state === 'completed'))) state = 'needs_repeat';
  return {
    techniqueId: technique.id,
    technique,
    state,
    evidence,
    evaluationMissing: !evaluated,
    mastery: p.status,
    latestScore: p.latestScore,
    analysisCount: p.analysisCount,
    practiceCount: p.practiceCount,
    lessonCount: p.coachLessonCount,
    lastActivityAt,
    reviewDue,
    idleDays,
  };
}

/** States for every technique the skill engine knows (pass computeAllSkillProgress()). */
export function statesOf(entries: TechniqueSkillEntry[], now = new Date()): Map<string, TechniqueState> {
  return new Map(entries.map((e) => [e.technique.id, stateOf(e.technique, e.progress, now)]));
}

export function stateCounts(states: Iterable<TechniqueState>): Record<EcoState, number> {
  const out: Record<EcoState, number> = { not_started: 0, learning: 0, completed: 0, needs_repeat: 0, needs_evaluation: 0, verified: 0 };
  for (const s of states) out[s.state]++;
  return out;
}

/** Has the learner reached at least "학습 완료" on it (a stage gate)? */
export const isDone = (s: TechniqueState | undefined) => !!s && (s.state === 'completed' || s.state === 'verified');
