// What the learner has learned — for the 자체 AI 코치's personal answers, training plans and
// lesson suggestions. READ ONLY: it reads the records the app already keeps on this device for
// the signed-in account (AI 코치 수업 기록, 연습 기록, 복습 결과, 카메라 자세 측정, 직접 지정 상태,
// 내 커리큘럼) and never writes them. Nothing is invented: a technique with no record is 미학습.
//
// Two numbers, kept apart (the app's 5-level mastery mixes them; that screen is unchanged):
//   학습 숙련도 (learning proficiency, 0–100) — only learning evidence: lessons understood /
//     practised, practice sessions, review results, spacing. One lesson cannot make it high.
//   자세 점수 (pose score) — only camera measurements (poseAnalysis records), as recorded.
//
// Learning proficiency, per technique (documented in docs/self-ai/PHASE4.md):
//   evidence is grouped by calendar day; each day counts ONCE, with its strongest event:
//     lesson understood + practised 30 · lesson understood 18 · practice session 12 ·
//     review answered well 15 · AI 코치 end-of-lesson rating proficient 30 / average 20
//   a positive day moves the score toward 100: score += gain × (1 − score/100)
//   a negative day (weak lesson, review marked 어려워요 / answered wrong) multiplies by 0.85
//   → 1 good lesson ≈ 30, 3 good days ≈ 66, 5 ≈ 83. Repeating the same day adds nothing.
//   Shown value decays 10% per 30 days after the first 30 without study (not stored).

import type { Technique } from '../../types';
import type { TechniqueSkillEntry } from '../skillProgress/weaknessEngine';
import type { LessonLogEntry } from '../coachLesson/lessonLog';
import type { ReviewLogEntry } from '../review/reviewLog';
import type { TrainingHistoryEntry } from '../trainingHistory/types';
import type { Curriculum } from '../curriculum/types';
import { canonicalTechniqueId } from '../techniqueCanonical';

export type LearningState = 'not_started' | 'planned' | 'learning' | 'learned' | 'review_due' | 'weak' | 'improving';

export const LEARNING_STATE_LABEL: Record<LearningState, string> = {
  not_started: '미학습',
  planned: '학습 예정',
  learning: '학습 중',
  learned: '학습 완료',
  review_due: '복습 필요',
  weak: '숙련도 부족',
  improving: '숙련도 향상 중',
};

export interface LearningEvent {
  day: string;
  kind: 'lesson_mastered' | 'lesson_understood' | 'lesson_weak' | 'lesson_seen' | 'practice' | 'review_good' | 'review_bad' | 'assessed';
  gain: number;
  source: string;
}

export interface TechniqueLearning {
  technique: Technique;
  /** The one state shown first (precedence: 숙련도 부족 > 복습 필요 > 향상 중 > 학습 완료 > 학습 중 > 학습 예정 > 미학습). */
  state: LearningState;
  /** Every state that applies. */
  states: LearningState[];
  /** 학습 숙련도 0–100 (null = no learning evidence). */
  proficiency: number | null;
  /** Change over the last 14 days (null when there was nothing before). */
  proficiencyChange14d: number | null;
  /** 자세 점수 — camera measurements only. */
  pose: { latest: number; best: number | null; count: number; lastAt: string | null } | null;
  lessonDays: number;
  practiceDays: number;
  lastStudiedAt: string | null;
  nextReviewAt: string | null;
  /** Why (each a real record): "AI 코치 수업 2일(이해·실습 1일)", "복습 1회" … */
  evidence: string[];
}

export interface LearnerInputs {
  entries: TechniqueSkillEntry[];
  lessonLogs: LessonLogEntry[];
  reviewLogs: ReviewLogEntry[];
  history: TrainingHistoryEntry[];
  curricula: Curriculum[];
  now: Date;
}

const DAY_MS = 86400000;
const LESSON_GAIN: Partial<Record<LearningEvent['kind'], number>> & Record<'lesson_mastered' | 'lesson_understood' | 'lesson_weak' | 'lesson_seen', number> = { lesson_mastered: 30, lesson_understood: 18, lesson_weak: -1, lesson_seen: 8 };
const cid = canonicalTechniqueId;

/** Learning events per technique id (canonical), from the stored records. */
export function learningEvents(inputs: Omit<LearnerInputs, 'entries' | 'curricula' | 'now'>): Map<string, LearningEvent[]> {
  const out = new Map<string, LearningEvent[]>();
  const push = (id: string, e: LearningEvent) => out.set(cid(id), [...(out.get(cid(id)) ?? []), e]);
  // a lesson log is keyed by its id — re-saving the same lesson replaces it, so it is counted once
  const seenLogs = new Set<string>();
  for (const log of inputs.lessonLogs) {
    if (seenLogs.has(log.id)) continue;
    seenLogs.add(log.id);
    const day = (log.date || log.finishedAt || '').slice(0, 10);
    for (const t of log.techniques) {
      if (!t.techniqueId) continue;
      const kind: LearningEvent['kind'] = t.overall === 'understood' && t.practiced ? 'lesson_mastered' : t.overall === 'understood' ? 'lesson_understood' : t.overall === 'weak' ? 'lesson_weak' : 'lesson_seen';
      push(t.techniqueId, { day, kind, gain: LESSON_GAIN[kind as 'lesson_seen'], source: `수업 「${log.title}」` });
      const a = log.assessment?.items.find((x) => cid(x.techniqueId) === cid(t.techniqueId!));
      if (a) push(t.techniqueId, { day, kind: 'assessed', gain: a.proficiency === 'proficient' ? 30 : a.proficiency === 'average' ? 20 : a.proficiency === 'needs_improvement' ? -1 : 10, source: `수업 「${log.title}」 종료 평가` });
    }
  }
  const lessonHistoryIds = new Set(inputs.lessonLogs.map((l) => l.historyEntryId).filter(Boolean));
  for (const h of inputs.history) {
    if (lessonHistoryIds.has(h.id)) continue; // the lesson already counted that session
    for (const id of h.techniqueIds) push(id, { day: h.date, kind: 'practice', gain: 12, source: '연습 기록' });
  }
  for (const r of inputs.reviewLogs) {
    const day = (r.finishedAt ?? r.updatedAt).slice(0, 10);
    for (const id of r.difficultTechniqueIds) push(id, { day, kind: 'review_bad', gain: -1, source: '복습에서 "아직 어려워요"' });
    for (const res of r.results) push(res.techniqueId, { day, kind: res.verdict === 'understood' ? 'review_good' : res.verdict === 'weak' ? 'review_bad' : 'lesson_seen', gain: res.verdict === 'understood' ? 15 : res.verdict === 'weak' ? -1 : 5, source: '복습 질문' });
    for (const id of r.completedTechniqueIds) if (!r.results.some((x) => x.techniqueId === id) && !r.difficultTechniqueIds.includes(id)) push(id, { day, kind: 'review_good', gain: 8, source: '복습 완료' });
  }
  return out;
}

/** Learning proficiency from events up to `until` (inclusive day). */
export function proficiencyOf(events: LearningEvent[], until?: string): number | null {
  const byDay = new Map<string, LearningEvent[]>();
  for (const e of events) if (!until || e.day <= until) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  if (!byDay.size) return null;
  let score = 0;
  for (const day of [...byDay.keys()].sort()) {
    const evs = byDay.get(day)!;
    // a day with a negative event and no positive one lowers; otherwise the strongest gain counts once
    const best = Math.max(...evs.map((e) => e.gain));
    if (best < 0) score *= 0.85;
    else score += best * (1 - score / 100);
  }
  return Math.round(score);
}

function decayed(score: number, lastDay: string | null, now: Date): number {
  if (!lastDay) return score;
  const idleDays = (now.getTime() - new Date(lastDay).getTime()) / DAY_MS - 30;
  return idleDays > 0 ? Math.round(score * Math.pow(0.9, idleDays / 30)) : score;
}

/** Techniques in the learner's own curricula on days not done yet = 학습 예정. */
export function plannedTechniqueIds(curricula: Curriculum[], history: TrainingHistoryEntry[]): Set<string> {
  const done = new Set(history.filter((h) => h.curriculumId).map((h) => `${h.curriculumId}#${h.dayNumber}`));
  const out = new Set<string>();
  for (const c of curricula) for (const d of c.days) if (!done.has(`${c.id}#${d.day}`)) for (const id of d.techniqueIds) out.add(cid(id));
  return out;
}

export function buildLearnerModel(inputs: LearnerInputs): TechniqueLearning[] {
  const events = learningEvents(inputs);
  const planned = plannedTechniqueIds(inputs.curricula, inputs.history);
  const now = inputs.now;
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS).toISOString().slice(0, 10);
  return inputs.entries.map(({ technique, progress }) => {
    const id = cid(technique.id);
    const evs = events.get(id) ?? [];
    const raw = proficiencyOf(evs);
    const lastDay = evs.map((e) => e.day).sort().at(-1) ?? null;
    const proficiency = raw === null ? null : decayed(raw, lastDay, now);
    const before = proficiencyOf(evs, twoWeeksAgo);
    const change = raw !== null && before !== null ? raw - before : null;
    const lessonDays = new Set(evs.filter((e) => e.kind.startsWith('lesson') || e.kind === 'assessed').map((e) => e.day)).size;
    const masteredDays = new Set(evs.filter((e) => e.kind === 'lesson_mastered').map((e) => e.day)).size;
    const practiceDays = new Set(evs.filter((e) => e.kind === 'practice').map((e) => e.day)).size;
    const latest = [...evs].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
    const latestDayEvents = evs.filter((e) => e.day === latest?.day);
    const latestNegative = !!latest && latestDayEvents.every((e) => e.gain < 0);
    const pose = progress.analysisCount > 0 && progress.latestScore !== null ? { latest: progress.latestScore, best: progress.bestScore, count: progress.analysisCount, lastAt: progress.lastAnalyzedAt } : null;
    const studied = evs.length > 0 || (progress.userOverride !== null && progress.userOverride !== 'not_started');
    const states: LearningState[] = [];
    if (studied && (latestNegative || (proficiency !== null && proficiency < 35 && evs.length >= 2) || progress.userOverride === 'needs_improvement')) states.push('weak');
    const learned = (masteredDays >= 1 && (proficiency ?? 0) >= 30) || progress.userOverride === 'proficient' || progress.userOverride === 'average';
    if (learned && progress.nextReviewAt && new Date(progress.nextReviewAt) <= now) states.push('review_due');
    if (change !== null && change >= 10 && !latestNegative) states.push('improving');
    if (learned) states.push('learned');
    else if (studied) states.push('learning');
    else if (planned.has(id)) states.push('planned');
    else states.push('not_started');
    const evidence: string[] = [];
    if (lessonDays) evidence.push(`AI 코치 수업 ${lessonDays}일(이해·실습 ${masteredDays}일)`);
    if (practiceDays) evidence.push(`연습 기록 ${practiceDays}일`);
    const reviews = evs.filter((e) => e.kind === 'review_good' || e.kind === 'review_bad').length;
    if (reviews) evidence.push(`복습 ${reviews}회`);
    if (progress.userOverride) evidence.push('직접 지정한 숙련도 있음');
    if (pose) evidence.push(`자세 측정 ${pose.count}회(최근 ${pose.latest}점)`);
    return {
      technique,
      state: states[0],
      states,
      proficiency,
      proficiencyChange14d: change,
      pose,
      lessonDays,
      practiceDays,
      lastStudiedAt: lastDay,
      nextReviewAt: progress.nextReviewAt,
      evidence,
    };
  });
}

export const inArt = (t: Technique, art: string) => (t.martialArts ?? [t.martialArt]).includes(art);
