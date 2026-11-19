import type { MasteryStatus } from '../skillProgress/types';
import { MASTERY_LABEL } from '../skillProgress/types';
import { buildCoachEvidenceIndex, PROFICIENT_DAYS, type CoachEvidence } from '../skillProgress/coachEvidence';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { askGeminiForJson } from '../fighterStyle/geminiJson';
import { politeFix } from '../aiCoachDay/politeSpeech';
import { coachKindOf } from '../coachProvider/types';
import { getLessonLog, listLessonLog, updateLessonLog, type LessonLogEntry, type LessonLogTechnique } from './lessonLog';

// 수업 마지막 숙련도 평가 — when an AI 코치 lesson (review or new technique)
// ends, each technique taught is rated for 이해도 (understanding) and
// 숙련도 (proficiency), and that rating becomes the technique's mastery from
// AI 코치 lessons (skillProgress/coachEvidence.ts).
//
// What it is judged on — only what happened in the lesson, nothing measured
// about the body: the grader's check of each key point and the student's own
// answers, whether the practice part was done (self-reported), the closing
// recap answer, the student's questions, and earlier AI 코치 lessons on the
// same technique. The AI (Gemini) reads that and rates; code then caps the
// rating to what the evidence can support:
//   - practice not done in this lesson        → at most 학습 중
//   - 숙련 needs understanding + practice on ≥ PROFICIENT_DAYS lesson days
//   - nothing was checked                     → 이해도 "확인 안 됨"
// Lessons taught by the MARTIALDEX own coach use no external AI — they are
// rated by the same rules without Gemini, and say so.

export type UnderstandingLevel = 'high' | 'medium' | 'low' | 'unknown';
export const UNDERSTANDING_LABEL: Record<UnderstandingLevel, string> = { high: '잘 이해함', medium: '부분적으로 이해함', low: '이해 부족', unknown: '확인 안 됨' };

export type AssessedMastery = Exclude<MasteryStatus, 'not_started'>;

export interface TechniqueAssessment {
  techniqueId: string;
  name: string;
  understanding: UnderstandingLevel;
  /** 0–100, null when nothing was checked. */
  understandingScore: number | null;
  /** The mastery this lesson assigns. */
  proficiency: AssessedMastery;
  reason: string;
  /** Short facts from the lesson the rating rests on. */
  evidence: string[];
  /** Set when code lowered the AI's rating (what the evidence could not support). */
  capped: string | null;
}

export interface LessonAssessment {
  at: string;
  method: 'ai' | 'rules';
  items: TechniqueAssessment[];
  /** Why rules were used instead of the AI (own coach / AI unavailable). */
  note: string | null;
}

const RANK: Record<AssessedMastery, number> = { needs_improvement: 0, learning: 1, average: 2, proficient: 3 };

/** Understanding from the grader's key-point checks (understood 1 · partial ½ · weak 0; unchecked points ignored). */
export function understandingFrom(t: LessonLogTechnique): { level: UnderstandingLevel; score: number | null } {
  const checked = t.concepts.filter((c) => c.status !== 'unknown');
  if (!checked.length) return t.overall === 'unknown' ? { level: 'unknown', score: null } : { level: t.overall === 'understood' ? 'high' : t.overall === 'partial' ? 'medium' : 'low', score: null };
  const score = Math.round((checked.reduce((n, c) => n + (c.status === 'understood' ? 1 : c.status === 'partial' ? 0.5 : 0), 0) / checked.length) * 100);
  const level: UnderstandingLevel = t.overall === 'weak' || score < 40 ? 'low' : score >= 75 ? 'high' : 'medium';
  return { level, score };
}

/** The highest mastery this lesson's evidence can support, and why (null reason = no cap below 숙련). */
export function masteryCap(t: LessonLogTechnique, u: UnderstandingLevel, prior: CoachEvidence | null): { max: AssessedMastery; why: string | null } {
  if (!t.practiced) return { max: 'learning', why: '이번 수업에서 실습을 하지 않아 학습 중까지만 매길 수 있습니다' };
  if (u === 'unknown') return { max: 'learning', why: '이해도를 확인한 질문이 없어 학습 중까지만 매길 수 있습니다' };
  const days = (prior?.masteredDays ?? 0) + (u === 'high' ? 1 : 0);
  if (days < PROFICIENT_DAYS) return { max: 'average', why: `숙련은 이해와 실습이 서로 다른 ${PROFICIENT_DAYS}일 이상 확인되어야 합니다 (지금 ${days}일)` };
  return { max: 'proficient', why: null };
}

/** Rule rating (own coach, or when the AI is unavailable). */
export function ruleAssessment(t: LessonLogTechnique, prior: CoachEvidence | null): TechniqueAssessment {
  const u = understandingFrom(t);
  const cap = masteryCap(t, u.level, prior);
  let p: AssessedMastery = u.level === 'low' ? 'needs_improvement' : u.level === 'high' && t.practiced ? 'average' : 'learning';
  if (p === 'average' && cap.max === 'proficient') p = 'proficient';
  if (p !== 'needs_improvement' && RANK[p] > RANK[cap.max]) p = cap.max;
  return {
    techniqueId: t.techniqueId!,
    name: t.name,
    understanding: u.level,
    understandingScore: u.score,
    proficiency: p,
    reason: ruleReason(t, u.level, p, cap.why),
    evidence: evidenceLines(t, prior),
    capped: null,
  };
}

function ruleReason(t: LessonLogTechnique, u: UnderstandingLevel, p: AssessedMastery, capWhy: string | null): string {
  const checked = t.concepts.filter((c) => c.status !== 'unknown');
  const ok = checked.filter((c) => c.status === 'understood').length;
  const head = checked.length ? `핵심 포인트 ${checked.length}개 중 ${ok}개를 정확히 설명하셨고` : '핵심 포인트를 확인한 질문은 없었고';
  return `${head}, 실습은 ${t.practiced ? '마치셨습니다' : '하지 않으셨습니다'}. 그래서 이해도는 "${UNDERSTANDING_LABEL[u]}", 숙련도는 "${MASTERY_LABEL[p]}" 단계로 매겼습니다.${capWhy && p !== 'needs_improvement' && RANK[p] < 3 ? ` 참고: ${capWhy}.` : ''}`;
}

function evidenceLines(t: LessonLogTechnique, prior: CoachEvidence | null): string[] {
  const lines = t.concepts.filter((c) => c.status !== 'unknown').map((c) => `${c.label}: ${c.status === 'understood' ? '이해' : c.status === 'partial' ? '부분 이해' : '이해 부족'}${c.evidence ? ` — "${c.evidence.slice(0, 60)}"` : ''}`);
  lines.push(`실습: ${t.practiced ? '완료 (사용자 수행 기록)' : '하지 않음'}`);
  if (prior?.lessons) lines.push(`이전 AI 코치 수업 ${prior.lessons}회 · 이해+실습 확인 ${prior.masteredDays}일`);
  return lines.slice(0, 8);
}

// ---------------- AI rating ----------------

interface RawItem {
  techniqueId: string;
  understanding: string;
  understandingScore?: number | null;
  proficiency: string;
  reason: string;
  evidence?: unknown[];
}
const isRaw = (v: unknown): v is { items: RawItem[] } => {
  const o = v as { items: RawItem[] };
  return !!o && typeof o === 'object' && Array.isArray(o.items);
};
const LEVELS: UnderstandingLevel[] = ['high', 'medium', 'low', 'unknown'];
const MASTERIES: AssessedMastery[] = ['needs_improvement', 'learning', 'average', 'proficient'];

function lessonText(log: LessonLogEntry, techs: LessonLogTechnique[], priors: Map<string, CoachEvidence>): string {
  const blocks = techs.map((t) => {
    const p = priors.get(canonicalTechniqueId(t.techniqueId!)) ?? null;
    const cap = masteryCap(t, understandingFrom(t).level, p);
    return [
      `■ ${t.techniqueId} | ${t.name}`,
      `실습: ${t.practiced ? '완료(사용자 수행 기록)' : '하지 않음'} | 수업 채점기 종합 이해: ${t.overall}`,
      ...t.concepts.map((c) => `- 핵심 포인트 "${c.label}" (정답 요소: ${c.reference.slice(0, 120)}) → 판정 ${c.status}${c.evidence ? ` / 학생 답: "${c.evidence.slice(0, 200)}"` : ''}`),
      `이전 AI 코치 수업: ${p ? `${p.lessons}회, 이해+실습 확인 ${p.masteredDays}일, 직전 판정 ${p.latestOverall}` : '없음'}`,
      `매길 수 있는 최고 숙련도: ${cap.max}${cap.why ? ` (${cap.why})` : ''}`,
    ].join('\n');
  });
  const qa = log.qa.map((x) => `학생 질문: ${x.question}\n코치 답: ${x.answer.slice(0, 200)}`).join('\n');
  return [`[수업] ${log.title} (${log.date})`, ...blocks, log.recap ? `[마무리 복습]\n질문: ${log.recap.question}\n피드백: ${log.recap.feedback}` : '', qa ? `[학생 질문]\n${qa}` : ''].filter(Boolean).join('\n\n');
}

async function aiAssessment(log: LessonLogEntry, techs: LessonLogTechnique[], priors: Map<string, CoachEvidence>): Promise<TechniqueAssessment[] | null> {
  const r = await askGeminiForJson<{ items: RawItem[] }>({
    systemInstruction: [
      '당신은 MARTIALDEX AI 코치다. 방금 끝난 수업 기록만 보고, 기술마다 학생의 이해도와 숙련도를 판정한다.',
      '- 근거는 수업 기록뿐이다: 핵심 포인트 판정과 학생의 실제 답, 실습 완료 여부, 마무리 복습, 학생 질문, 이전 수업 기록. 기록에 없는 것을 추측하지 않는다. 몸의 동작은 측정되지 않았다.',
      '- understanding: "high"(핵심을 정확히 설명) | "medium"(일부만) | "low"(틀리거나 거의 모름) | "unknown"(확인한 질문이 없음). understandingScore는 0~100 또는 null.',
      '- proficiency: "needs_improvement"(이해 부족·잘못 알고 있음) | "learning"(익히는 중) | "average"(이해+실습 완료, 기본 수행 가능) | "proficient"(여러 수업에 걸쳐 이해+실습이 확인됨). 기술마다 적힌 "매길 수 있는 최고 숙련도"를 넘기지 않는다.',
      '- reason: 학생에게 보여 줄 1~2문장 한국어 존댓말. 어떤 답·기록 때문에 그렇게 매겼는지 구체적으로. evidence: 근거가 된 기록 1~4개를 짧게.',
      '출력: {"items": [{"techniqueId": string, "understanding": string, "understandingScore": number|null, "proficiency": string, "reason": string, "evidence": string[]}]}',
    ].join('\n'),
    contextText: lessonText(log, techs, priors),
    question: `위 수업의 기술 ${techs.length}개 각각의 이해도와 숙련도를 판정해 주세요.`,
    validate: isRaw,
    temperature: 0.2,
  });
  if (!r.ok) return null;
  const out: TechniqueAssessment[] = [];
  for (const t of techs) {
    const raw = r.data.items.find((x) => x.techniqueId === t.techniqueId);
    const base = ruleAssessment(t, priors.get(canonicalTechniqueId(t.techniqueId!)) ?? null);
    if (!raw || !MASTERIES.includes(raw.proficiency as AssessedMastery) || typeof raw.reason !== 'string') {
      out.push(base);
      continue;
    }
    const measured = understandingFrom(t);
    // nothing was checked → the AI may not claim it was understood
    const understanding: UnderstandingLevel = measured.level === 'unknown' && t.concepts.every((c) => c.status === 'unknown') && !log.recap ? 'unknown' : LEVELS.includes(raw.understanding as UnderstandingLevel) ? (raw.understanding as UnderstandingLevel) : measured.level;
    const cap = masteryCap(t, understanding, priors.get(canonicalTechniqueId(t.techniqueId!)) ?? null);
    let proficiency = raw.proficiency as AssessedMastery;
    let capped: string | null = null;
    if (proficiency !== 'needs_improvement' && RANK[proficiency] > RANK[cap.max]) {
      capped = `AI는 "${MASTERY_LABEL[proficiency]}"로 판단했지만, ${cap.why ?? '근거가 부족해'} "${MASTERY_LABEL[cap.max]}"로 맞췄습니다.`;
      proficiency = cap.max;
    }
    const score = typeof raw.understandingScore === 'number' && Number.isFinite(raw.understandingScore) ? Math.max(0, Math.min(100, Math.round(raw.understandingScore))) : measured.score;
    out.push({
      techniqueId: t.techniqueId!,
      name: t.name,
      understanding,
      understandingScore: understanding === 'unknown' ? null : score,
      proficiency,
      reason: politeFix(raw.reason.trim()) || base.reason,
      evidence: (raw.evidence ?? []).filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 4).map((x) => x.slice(0, 120)),
      capped,
    });
  }
  return out;
}

// ---------------- run + save ----------------

const inflight = new Map<string, Promise<LessonAssessment | null>>();

/**
 * The lesson's end-of-lesson assessment: the saved one, or rated now and saved into the lesson log
 * (which updates mastery). null = the lesson has no technique to rate.
 */
export function ensureLessonAssessment(logId: string, opts: { force?: boolean } = {}): Promise<LessonAssessment | null> {
  const log = getLessonLog(logId);
  if (!log) return Promise.resolve(null);
  if (log.assessment && !opts.force) return Promise.resolve(log.assessment);
  const running = inflight.get(logId);
  if (running) return running;
  const p = (async () => {
    const techs = log.techniques.filter((t) => !!t.techniqueId);
    if (!techs.length) return null;
    // earlier lessons only — this one must not count as its own prior evidence
    const priors = buildCoachEvidenceIndex(listLessonLog().filter((l) => l.id !== log.id && l.finishedAt <= log.finishedAt));
    const prior = (t: LessonLogTechnique) => priors.get(canonicalTechniqueId(t.techniqueId!)) ?? null;
    let items: TechniqueAssessment[] | null = null;
    let note: string | null = null;
    if (coachKindOf(log) === 'martialdex') note = 'MARTIALDEX 자체 AI 코치 수업이라 외부 AI 없이 수업 기록(핵심 포인트 판정·실습 여부)으로 매겼습니다.';
    else {
      items = await aiAssessment(log, techs, priors);
      if (!items) note = 'AI 평가를 받지 못해 수업 기록(핵심 포인트 판정·실습 여부)으로 매겼습니다.';
    }
    const assessment: LessonAssessment = { at: new Date().toISOString(), method: items ? 'ai' : 'rules', items: items ?? techs.map((t) => ruleAssessment(t, prior(t))), note };
    updateLessonLog(log.id, { assessment });
    return assessment;
  })().finally(() => inflight.delete(logId));
  inflight.set(logId, p);
  return p;
}
