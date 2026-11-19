import type { CoachLessonState, PendingQuestion, StudentIntent } from './types';

// Classifies what the student said WITHOUT an API call. Voice transcripts
// and typed text go through the same function. Anything ambiguous while a
// question is pending is treated as an answer — the answer analyzer can
// still flag it as a question (AnswerAnalysis.kind === 'question').

/** Recognizes "I'm ready / start" in voice transcripts or typed text. */
export function isReadyIntent(text: string): boolean {
  // Whole short utterance only, so a question like "시작 자세가 뭐야?" is
  // answered, not mistaken for "start". Trailing punctuation from speech
  // transcription ("준비됐어.") is ignored.
  const t = text.toLowerCase().replace(/[\s.,!?~…"'“”]+/g, '');
  if (t.length === 0 || t.length > 14) return false;
  return /^(네|응|예|좋아|오케이|ok)?(준비(됐|되었|완료|끝났|다됐)(어|어요|습니다|음|다)?|시작(해|하자|할게|해줘|해주세요|합시다|할래|요)?|불러줘|불러주세요|레디|ready|go|letsgo|고고?)$/.test(t);
}

function norm(text: string): string {
  return text.toLowerCase().replace(/[\s.,!~…"'“”]+/g, '');
}

const UNDERSTOOD = /^(네|넵|예|응|어|ㅇㅇ|웅|맞아|그래|오케이|ok|okay|알겠(어|어요|습니다)?|알았(어|어요|습니다)?|이해(했|됐|되었|가 ?됐|가 ?돼)(어|어요|습니다|음|다)?|이해함|괜찮(아|아요|습니다)|충분(해|해요|합니다)|좋아(요)?)(요|네요)?[?]?$/;
const DONT_KNOW = /(모르겠|몰라|모름|잘 ?모르|헷갈|감이 ?안|이해(가|를)? ?(안|못)|어려워|어렵네|글쎄|^아니(요|오)?$|^아뇨$)/;
const REPEAT = /(다시 ?(설명|말|한 ?번|알려|해)|한 ?번 ?더|무슨 ?(말|뜻)|천천히 ?(설명|말)|쉽게 ?(설명|말)|예시)/;
const SKIP = /(건너뛰|넘어가|패스|스킵|skip|다음 ?(으로|단계|기술)|그만하|생략)/;
const QUESTION_LEAD = /^(근데|그런데|그럼|그러면|혹시|질문|궁금)/;
/** "이 기술에서 흔히 하는 실수는?", "순서는?" — asks for a piece of the technique's information (not a tentative answer like "팔꿈치?"). */
const TOPIC_QUESTION = /(실수|포인트|핵심|차이|순서|방법|단계|요령|주의할\s*점|주의점)(는|은|가|이|도)?\s*[?？]$/;
const INTERROGATIVE = /(왜(?!냐)|어떻게|어떤|뭐|무엇|무슨|언제|어디|어느|몇|누가|인가요|나요|까요|건가|거야\?|돼\?|되나|하나요|해야 ?(돼|하|할)|하면 ?(돼|되)|어때|맞아\?|맞나|니\?|냐\?)/;

export function classifyIntent(text: string, pending: PendingQuestion | null): StudentIntent {
  const t = text.trim();
  const n = norm(t);
  if (!n) return 'answer';
  if (isReadyIntent(t)) return 'ready';
  if (SKIP.test(t) && t.length <= 20) return 'skip';
  if (REPEAT.test(t) && t.length <= 30) return 'repeat';
  if (DONT_KNOW.test(t) && t.length <= 24) return 'dont_know';
  if (UNDERSTOOD.test(n)) return 'understood';
  const looksLikeQuestion = QUESTION_LEAD.test(t) || (INTERROGATIVE.test(t) && (/[?？]$/.test(t) || /(나요|까요|가요|인가|건가|어때|하죠|되죠|돼요)$/.test(n))) || TOPIC_QUESTION.test(t);
  if (looksLikeQuestion) return 'question';
  // With a question pending, a short "팔꿈치?" is a tentative answer, not a question.
  if (pending) return 'answer';
  return 'question';
}

// "다 했어", "실습 완료했어", "잽 끝났어", "이제 다음으로 넘어가자", "done" — the student telling the
// coach the practice that is running is over. Conservative: questions ("언제 끝나?"), negations
// ("아직 안 끝났어"), earlier events ("아까 끝냈었어"), and requests (explain / measure / start)
// are NOT a completion. Used only while a practice is actually running (the caller checks that).
const DONE_WORDS = /(다\s*했|다\s*끝|끝났|끝냈|끝(이야|이에요|입니다|임)?$|마쳤|마침|완료(했|됐|함|요|입니다)?|다음\s*(으로|단계로|기술로)?\s*(넘어가|가자|진행)|넘어가자|\bdone\b|\bfinished\b|\bcompleted?\b|\ball done\b|that'?s it|\bnext\b)/i;
const NOT_DONE = /(아직|안\s*(끝|했|됐|마)|못\s*(했|끝|마)|덜\s*(했|끝)|않았|안\s*되|언제|어떻게|왜|뭐|무엇|몇|어디|인가요|나요|까\s*[?？]?$|했나|됐나|맞아\s*[?？]|아까|전에|어제|지난번|예전에|었어|었다|었습니다|설명|알려|측정|확인|시작|보여|찾아|\bnot\b|n't\b|\byet\b|\bwhen\b|\bhow\b|\bwhat\b)/i;

export function isPracticeDoneIntent(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 30 || /[?？]/.test(t)) return false;
  if (NOT_DONE.test(t)) return false;
  return DONE_WORDS.test(t);
}

/**
 * "실습 완료했어" said AGAIN right after the practice was settled (the post-practice question is
 * waiting): a repeat of what was already handled, not an answer to that question. A clear request
 * to move on ("다음으로 넘어가자" → 'skip') is not a repeat — the lesson's own skip rule applies.
 */
export function isRepeatedPracticeDone(text: string, state: CoachLessonState | null | undefined): boolean {
  if (!state?.practiceDone || state.currentStage !== 'PRACTICE_REVIEW' || state.pending?.purpose !== 'practice_review') return false;
  return isPracticeDoneIntent(text) && classifyIntent(text, state.pending) !== 'skip';
}
