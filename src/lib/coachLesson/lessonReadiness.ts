import type { Technique } from '../../types';
import { evidenceFor } from '../coachKnowledge/lookup';
import type { TechniqueEvidence } from '../coachKnowledge/evidence';
import { isMeaningless } from './lessonQuality';
import { contentTokens } from './text';

// Whether a technique's MARTIALDEX record has enough verified data to be TAUGHT.
// A stub record (no overview / steps / key points) used to produce a lesson made
// of the category name repeated in every stage. Nothing is filled in: what a
// lesson needs and the record lacks is reported as missing.

export type LessonReadiness = 'ready' | 'thin' | 'insufficient';

export interface ReadinessReport {
  techniqueId: string;
  level: LessonReadiness;
  /** Labels of what the record really has (자세 개요, 동작 단계 …). */
  have: string[];
  /** Labels of what a full lesson needs and the record lacks. */
  missing: string[];
  /** Fields whose text was rejected (placeholder / another category's paragraph). */
  rejected: string[];
}

const LESSON_FIELDS = [
  ['what', '기술 설명'],
  ['steps', '동작 단계'],
  ['keyPoints', '핵심 포인트'],
  ['commonMistakes', '흔한 실수'],
  ['positions', '사용 상황'],
] as const;

/** A description long enough to explain the technique (not "양손 베기" / "Single Leg"). */
function explainsItself(ev: TechniqueEvidence): boolean {
  const texts = [...(ev.fields.overview?.values ?? []), ...(ev.fields.description?.values ?? []), ...(ev.fields.purpose?.values ?? [])];
  return texts.some((x) => contentTokens(x).length >= 4 && !isMeaningless(x));
}

export function lessonReadiness(t: Technique): ReadinessReport {
  const ev = evidenceFor(t);
  const has = {
    what: explainsItself(ev),
    steps: (ev.fields.steps?.values.length ?? 0) >= 2,
    keyPoints: (ev.fields.keyPoints?.values.length ?? 0) >= 1,
    commonMistakes: (ev.fields.commonMistakes?.values.length ?? 0) >= 1,
    positions: (ev.fields.positions?.values.length ?? 0) >= 1,
  };
  const have = LESSON_FIELDS.filter(([k]) => has[k]).map(([, l]) => l);
  const missing = LESSON_FIELDS.filter(([k]) => !has[k]).map(([, l]) => l);
  // ready: explains itself + how to do it + what to watch; thin: explains itself and one of those.
  const level: LessonReadiness = has.what && has.keyPoints && (has.steps || has.commonMistakes) ? 'ready' : has.what && (has.keyPoints || has.steps) ? 'thin' : 'insufficient';
  return { techniqueId: t.id, level, have, missing, rejected: [...new Set(ev.rejected.map((r) => r.field))] };
}
