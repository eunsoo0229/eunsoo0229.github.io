import type { Technique } from '../../types';
import { askCoach, gradeQuizAnswer, type QuizGrade } from '../aiCoachDay/service';
import type { CoachMessage } from '../aiCoachDay/types';
import { analyzeAnswer, gradeRecap as gradeRecapWithGemini, type AnalyzeInput } from '../coachLesson/analyzer';
import { keyPointsReference } from '../coachLesson/concepts';
import type { RecapPlan } from '../coachLesson/engine';
import { evidenceAnalysis, gradeByEvidence, recapHitsByEvidence, reconcileAnalysis } from '../coachLesson/evidenceGrader';
import type { AnswerAnalysis, ScenarioItem } from '../coachLesson/types';
import { answerCoachQuestion, dialogAfterAction, type CoachDialogContext } from '../coachKnowledge/questions';
import type { CoachAction } from '../coachKnowledge/featureCatalog';

/** The 자체 코치's conversation context inside the current lesson (which technique a short follow-up refers to). */
let lessonDialog: { lessonTechniqueId: string | null; context: CoachDialogContext } = { lessonTechniqueId: null, context: { focusId: null, listedIds: [] } };
/** A training the student opened from this lesson (for a later "왜?" / "끝났어"). */
export function rememberLessonAction(lessonTechniqueId: string, action: CoachAction): void {
  if (!action.ok) return;
  const base = lessonDialog.lessonTechniqueId === lessonTechniqueId ? lessonDialog.context : { focusId: lessonTechniqueId, listedIds: [] };
  lessonDialog = { lessonTechniqueId, context: dialogAfterAction(base, action) };
}

/** Techniques the 자체 코치 last listed in this lesson ("그거 연습하고 싶어"). */
export function lastListedTechniqueIds(lessonTechniqueId: string): string[] {
  return lessonDialog.lessonTechniqueId === lessonTechniqueId ? lessonDialog.context.listedIds : [];
}
import { namesOf } from '../coachKnowledge/lookup';
import { localModelEnabled } from './localModel';
import type { CoachKind } from './types';

// One lesson engine, two coaches. Everything a lesson asks a "coach" to do
// goes through this interface; the deterministic parts (lesson flow, choice
// grading, required-element grading) are shared, the language-model parts
// are split per coach:
//   gemini     → the existing Gemini functions, unchanged (grading is then
//                bounded by the deterministic grade — reconcileAnalysis).
//   martialdex → technique evidence + deterministic grading. The local model
//                is off by default (localModelEnabled). No Gemini module is called.

export interface CoachAnswer {
  ok: true;
  text: string;
  /** Extra transparency for the UI/tests: where the answer came from. */
  source: 'gemini' | 'evidence' | 'local_model';
}
export type CoachAnswerResult = CoachAnswer | { ok: false; message: string };

export interface CoachGradeInput extends AnalyzeInput {
  scenario?: ScenarioItem | null;
}

/** aiCoachDay's QuizGrade, plus 'evidence' for the deterministic grader. */
export type QuizGradeResult = Omit<QuizGrade, 'method'> & { method: QuizGrade['method'] | 'evidence' };

export interface CoachBackend {
  kind: CoachKind;
  /** A student's free question about the technique being taught. */
  answerQuestion(input: { technique: Technique; question: string; dayContext: string; history: CoachMessage[]; place: string }): Promise<CoachAnswerResult>;
  /** A short answer to the coach's question → the engine's analysis (deterministic grade is the authority). */
  gradeAnswer(input: CoachGradeInput): Promise<AnswerAnalysis>;
  /** End-of-day recap → the labels of the core points the student named. */
  gradeRecap(technique: Technique | null, plan: RecapPlan, answer: string): Promise<string[]>;
  /** Legacy quiz (runs saved before the lesson engine existed). */
  gradeQuiz(t: Technique, question: string, answer: string): Promise<QuizGradeResult>;
}

/** Registered names + Korean names from the technique's own data ("암바") — saying the name is not answer content. */
function techniqueNames(t: Technique | null): string[] {
  return t ? namesOf(t) : [];
}

function deterministic(input: CoachGradeInput) {
  return gradeByEvidence({
    concept: input.concept,
    scenario: input.scenario ?? null,
    reference: input.reference,
    mistakes: input.technique?.posture?.commonMistakes ?? [],
    points: input.technique?.posture?.keyPoints ?? [],
    names: techniqueNames(input.technique),
    questionType: input.pending?.type ?? null,
    answer: input.answer,
  });
}

export const geminiCoach: CoachBackend = {
  kind: 'gemini',
  async answerQuestion({ technique, question, dayContext, history, place }) {
    // the user picked the Gemini coach for this lesson — an explicit choice, so these calls go to Gemini
    const r = await askCoach(technique, dayContext, history, question, place, 'gemini');
    return r.ok ? { ok: true, text: r.text, source: 'gemini' } : r;
  },
  async gradeAnswer(input) {
    const grade = deterministic(input);
    const model = await analyzeAnswer({ ...input, engine: 'gemini' });
    return reconcileAnalysis(grade, model, input.answer);
  },
  gradeRecap: (technique, plan, answer) => gradeRecapWithGemini(technique, plan, answer, 'gemini'),
  gradeQuiz: (t, question, answer) => gradeQuizAnswer(t, question, answer, 'gemini'),
};

export const martialdexCoach: CoachBackend = {
  kind: 'martialdex',
  async answerQuestion({ technique, question }) {
    // comparison / situation / practice-feature / single-technique questions, all from the data (questions.ts);
    // the lesson's own technique is the focus, the last listed techniques let "그거" be resolved.
    const ctx = lessonDialog.lessonTechniqueId === technique.id ? lessonDialog.context : { focusId: technique.id, listedIds: [] };
    const a = await answerCoachQuestion(technique, question, { useModel: localModelEnabled(), context: ctx });
    lessonDialog = { lessonTechniqueId: technique.id, context: a.context ?? ctx };
    const g = a.grounded;
    return { ok: true, text: g?.modelNote ? `${a.text} (${g.modelNote})` : a.text, source: g?.source ?? 'evidence' };
  },
  async gradeAnswer(input) {
    return evidenceAnalysis(deterministic(input));
  },
  async gradeRecap(_technique, plan, answer) {
    return recapHitsByEvidence(plan.points, answer);
  },
  async gradeQuiz(t, _question, answer) {
    const g = gradeByEvidence({ concept: null, reference: keyPointsReference(t), mistakes: t.posture?.commonMistakes ?? [], points: t.posture?.keyPoints ?? [], names: techniqueNames(t), answer });
    const verdict = g.verdict === 'understood' ? 'correct' : g.verdict === 'partial' ? 'partial' : 'incorrect';
    const head = verdict === 'correct' ? '맞습니다.' : verdict === 'partial' ? '맞는 부분이 있습니다.' : '조금 다릅니다.';
    return { verdict, correct: verdict === 'correct', feedback: `${head} ${g.reason}`, method: 'evidence' };
  },
};

export function coachBackend(kind: CoachKind): CoachBackend {
  return kind === 'martialdex' ? martialdexCoach : geminiCoach;
}
