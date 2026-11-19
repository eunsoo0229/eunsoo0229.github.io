// The learner model from this device's records of the signed-in account (read only).
// Another account on the same device never sees these: auth/deviceAccountGuard.ts clears
// local data when a different account signs in, and cloud sync is per account (RLS).

import { listLessonLog } from '../coachLesson/lessonLog';
import { listMyCurricula } from '../curriculum/curriculumService';
import { listReviewLog } from '../review/reviewLog';
import { computeAllSkillProgress } from '../skillProgress/weaknessEngine';
import { listTrainingHistory } from '../trainingHistory/service';
import { buildLearnerModel, type TechniqueLearning } from './learnerModel';

export function loadLearnerModel(now = new Date()): TechniqueLearning[] {
  return buildLearnerModel({
    entries: computeAllSkillProgress(),
    lessonLogs: listLessonLog(),
    reviewLogs: listReviewLog(),
    history: listTrainingHistory(),
    curricula: listMyCurricula(),
    now,
  });
}
