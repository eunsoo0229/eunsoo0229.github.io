import { listLessonLog, type LessonLogEntry } from '../coachLesson/lessonLog';
import type { ConceptStatus } from '../coachLesson/types';
import { canonicalTechniqueId } from '../techniqueCanonical';
import type { MasteryStatus } from './types';

// AI 코치 수업 → 숙련도. Each finished AI 코치 lesson (curriculum Day or
// 「수업하고 싶은 거 입력하기」) is saved as a lesson log with, per technique,
// the understanding the lesson's grader recorded and whether the practice
// part was done. That is real evidence of learning, so it counts toward
// mastery — never invented, never inferred from simply opening a lesson:
//   보통 (average)     understood AND practiced in a lesson on ≥ 1 day
//   숙련 (proficient)  understood AND practiced on ≥ 3 different days
//   보완 필요          the latest lesson showed weak understanding
// When the lesson was rated at its end (coachLesson/lessonAssessment.ts — the
// AI coach's 이해도·숙련도 rating, capped by the same evidence rules), the
// latest lesson's rating IS the mastery from AI 코치 lessons.
// A camera pose analysis (measured form) keeps priority when it exists, and
// a user-set status always wins (computeSkillProgress.ts).

export interface CoachEvidence {
  lessons: number;
  /** Distinct days on which the technique was understood AND practiced in a lesson. */
  masteredDays: number;
  latestOverall: ConceptStatus;
  latestPracticed: boolean;
  lastLessonAt: string;
  /** The latest lesson's end-of-lesson rating of this technique (absent when that lesson wasn't rated). */
  assessed?: { status: MasteryStatus; understanding: string; at: string; method: 'ai' | 'rules' };
}

export const PROFICIENT_DAYS = 3;

export function buildCoachEvidenceIndex(logs: LessonLogEntry[] = listLessonLog()): Map<string, CoachEvidence> {
  const acc = new Map<string, { lessons: number; days: Set<string>; latest: { at: string; overall: ConceptStatus; practiced: boolean; assessed?: CoachEvidence['assessed'] } }>();
  for (const log of logs) {
    const at = log.finishedAt || log.updatedAt || log.date;
    const day = (log.date || at).slice(0, 10);
    for (const t of log.techniques) {
      if (!t.techniqueId) continue;
      const id = canonicalTechniqueId(t.techniqueId);
      const cur = acc.get(id) ?? { lessons: 0, days: new Set<string>(), latest: { at: '', overall: 'unknown' as ConceptStatus, practiced: false } };
      cur.lessons++;
      if (t.overall === 'understood' && t.practiced) cur.days.add(day);
      if (at >= cur.latest.at) {
        const a = log.assessment?.items.find((x) => canonicalTechniqueId(x.techniqueId) === id);
        cur.latest = { at, overall: t.overall, practiced: t.practiced, ...(a && log.assessment ? { assessed: { status: a.proficiency, understanding: a.understanding, at: log.assessment.at, method: log.assessment.method } } : {}) };
      }
      acc.set(id, cur);
    }
  }
  const out = new Map<string, CoachEvidence>();
  for (const [id, v] of acc) out.set(id, { lessons: v.lessons, masteredDays: v.days.size, latestOverall: v.latest.overall, latestPracticed: v.latest.practiced, lastLessonAt: v.latest.at, ...(v.latest.assessed ? { assessed: v.latest.assessed } : {}) });
  return out;
}

export function getCoachEvidence(techniqueId: string): CoachEvidence | null {
  return buildCoachEvidenceIndex().get(canonicalTechniqueId(techniqueId)) ?? null;
}

/** Mastery from AI 코치 lessons alone (null = no lesson on this technique). */
export function coachMastery(e: CoachEvidence | null): MasteryStatus | null {
  if (!e) return null;
  if (e.assessed) return e.assessed.status; // the latest lesson's end-of-lesson rating
  if (e.latestOverall === 'weak') return 'needs_improvement';
  if (e.masteredDays >= PROFICIENT_DAYS && e.latestOverall === 'understood') return 'proficient';
  if (e.masteredDays >= 1) return 'average'; // a shaky later review doesn't wipe it out, but caps it
  return 'learning';
}
