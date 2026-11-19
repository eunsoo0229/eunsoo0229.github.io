// Free questions in the middle of a lesson ("AI 코치와 수업하기"), with the same tools
// as the conversation coach — and the lesson left exactly where it was.
//
// Split of responsibilities:
//   the lesson ENGINE (coachLesson/*) owns the lesson state: step, pending question,
//     understanding, progress, outcomes. Answers to its questions, "모르겠어요",
//     "다시 설명해 주세요", "준비됐어" go to it as before.
//   this module answers QUESTIONS: it reads a snapshot of the lesson (art, topic, the
//     technique being taught, step, what was learned / comes next, goals, earlier
//     questions) and runs the conversation coach with it. It never writes the run —
//     the caller only appends the question and the answer to the message log.
//   adding techniques changes the curriculum, so it is a PROPOSAL first; only the
//     learner's "추가" (button or "응, 추가해 줘") appends it.

import type { Technique } from '../../types';
import type { CoachDayRun, CoachMessage } from '../aiCoachDay/types';
import { classifyIntent } from '../coachLesson/intent';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { getUnifiedAllTechniques, resolveTechnique } from '../userTechniques/service';
import { categoryTopic, familyWord } from '../knowledgeBase/topics';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { readCombatTerms } from './combatTerms';
import { isLessonSideRequest, planTurn, type TurnPlan } from './router';

export interface LessonSnapshot {
  art: string | null;
  topic: string | null;
  goals: string[];
  current: Technique;
  step: string;
  stepLabel: string;
  learned: Technique[];
  upcoming: Technique[];
  pendingQuestion: string | null;
  recentQA: { q: string; a: string }[];
  /** Every technique id in the lesson (proposals never re-add one). */
  techniqueIds: string[];
  /** The engine's overall understanding per technique (read only). */
  understanding: Record<string, string>;
}

const STEP_LABEL: Record<string, string> = {
  explain: '설명', lesson: '설명·이해 확인', videos: '영상', quiz: '확인 질문', ready: '실습 준비', posture: '자세 설명', practice: '실습', practiced: '실습 후', review: '정리', mitt: '미트 연습', drill: '드릴', recap: '복습', summary: '요약',
};

export function lessonSnapshot(run: CoachDayRun, opts: { topic?: string | null; goals?: string[]; art?: string | null } = {}): LessonSnapshot | null {
  const current = resolveTechnique(run.techniqueIds[run.index] ?? '');
  if (!current) return null;
  const ids = (list: string[]) => list.map((id) => resolveTechnique(id)).filter((t): t is Technique => !!t);
  const pending = run.lessons?.[current.id]?.pending?.text ?? run.pendingQuiz ?? null;
  const recentQA: LessonSnapshot['recentQA'] = [];
  const msgs = run.messages;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'user') continue;
    const next = msgs.slice(i + 1).find((m) => m.role === 'coach');
    if (next?.kind === 'answer') recentQA.push({ q: msgs[i].text.slice(0, 200), a: next.text.slice(0, 300) });
  }
  return {
    art: opts.art ?? current.martialArt,
    topic: opts.topic ?? null,
    goals: (opts.goals ?? []).slice(0, 4),
    current,
    step: run.step,
    stepLabel: STEP_LABEL[run.step] ?? run.step,
    learned: ids(run.techniqueIds.slice(0, run.index)),
    upcoming: ids(run.techniqueIds.slice(run.index + 1)),
    pendingQuestion: pending,
    recentQA: recentQA.slice(-3),
    techniqueIds: [...run.techniqueIds],
    understanding: Object.fromEntries(Object.entries(run.lessons ?? {}).map(([id, l]) => [id, l.understanding.overall])),
  };
}

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

/** The lesson as the model / data answers see it (data only). */
export function lessonContextBlock(s: LessonSnapshot): string {
  return [
    s.topic ? `수업 주제: ${s.topic}` : '',
    `지금 배우는 기술: ${label(s.current)} (단계: ${s.stepLabel})`,
    s.learned.length ? `이미 배운 기술: ${s.learned.map(label).join(', ')}` : '',
    s.upcoming.length ? `이어서 배울 기술: ${s.upcoming.map(label).join(', ')}` : '',
    s.goals.length ? `학습 목표: ${s.goals.join(' / ')}` : '',
    s.pendingQuestion ? `코치가 학생에게 낸 질문(답변 대기): ${s.pendingQuestion}` : '',
    ...s.recentQA.map((x) => `이전 질문: ${x.q} → 답: ${x.a.slice(0, 160)}`),
  ].filter(Boolean).join('\n');
}

/** Does this text go to the conversation coach (a question / a side request) instead of the lesson engine? */
export function routeLessonInput(text: string, run: CoachDayRun, current: Technique): { to: 'engine' | 'question'; plan: TurnPlan } {
  const plan = planTurn(text, { martialArt: current.martialArt, inLesson: true, lessonTechnique: current });
  const pending = run.lessons?.[current.id]?.pending ?? null;
  // tools the engine does not have: always the coach
  if (['video', 'paper', 'fighter', 'web', 'lesson_add', 'prerequisite', 'related', 'review', 'compare', 'sequence', 'curriculum', 'pose_check', 'improve', 'my_progress'].includes(plan.intent)) return { to: 'question', plan };
  // a turn that needs a search, or asks the coach to explain / find / show something, is a question even
  // while the engine waits for an answer ("…대응해야 해? 관련 자료도 찾아서 설명해 줘." was graded as an answer)
  if (isLessonSideRequest(plan, text, !!pending) || (/(알려|설명해|찾아|보여|가르쳐)\s*(줘|주세요|줄래|줄 수)/.test(text) && !/(다시|한 ?번 ?더|천천히|쉽게)\s*(설명|말)/.test(text))) return { to: 'question', plan };
  // answers, "모르겠어요", "다시 설명해 주세요", "준비됐어", "응" stay with the engine
  const intent = classifyIntent(text, pending);
  return { to: intent === 'question' ? 'question' : 'engine', plan };
}

/** Everything about the run except its message log — must be identical before and after a question. */
export function lessonStateKey(run: CoachDayRun | null): string {
  if (!run) return 'null';
  const rest: Partial<CoachDayRun> = { ...run };
  delete rest.messages;
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------- additions (with consent)

export type AdditionKind = 'connected' | 'defense' | 'fighter_combo';

export interface LessonAddProposal {
  kind: AdditionKind;
  techniqueIds: string[];
  /** Per technique: why it is proposed (a recorded link / the fighter source). */
  reasons: Record<string, string>;
  /** Fighter combos: the source sentences behind them. */
  evidence?: { quote: string; url: string }[];
  status: 'pending' | 'accepted' | 'declined';
}

const DEFENSE_WORDS = /(방어|대응|카운터|막는|탈출|이스케이프|defen[cs]e|counter|escape)/i;

/**
 * What could be added to the lesson for this request — MARTIALDEX records only, each with
 * the recorded link that connects it. Nothing is added here.
 */
export function proposeLessonAddition(text: string, lessonIds: string[], current: Technique, index: KnowledgeIndex | null): LessonAddProposal | null {
  const inRun = new Set(lessonIds.map(canonicalTechniqueId));
  const art = current.martialArt;
  const picks = new Map<string, string>();
  const take = (t: Technique | undefined, why: string) => {
    if (!t || inRun.has(canonicalTechniqueId(t.id)) || picks.has(t.id) || picks.size >= 3) return;
    if (!(t.martialArts ?? [t.martialArt]).includes(art) || lessonReadiness(t).level === 'insufficient') return;
    picks.set(t.id, why);
  };
  // the learner NAMED a technique ("더블 레그도 같이 배우고 싶어"): that one first. It used to be ignored —
  // only records linked to the current technique were offered (42개 문제 B11/K34). Another art is allowed for a
  // technique asked for by name, and the reason says so; nothing is added before the learner agrees.
  if (!DEFENSE_WORDS.test(text)) {
    for (const t of exactTechniquesInText(readCombatTerms(text).lookupText, null).matches) {
      if (t.id === current.id || inRun.has(canonicalTechniqueId(t.id)) || picks.has(t.id) || picks.size >= 3 || lessonReadiness(t).level === 'insufficient') continue;
      const otherArt = !(t.martialArts ?? [t.martialArt]).includes(art);
      picks.set(t.id, `직접 요청한 기술${otherArt ? ` (${t.martialArt} 기술 — 지금 수업(${art})과 종목이 다름)` : ''}`);
    }
  }
  let conn: ReturnType<typeof getTechniqueConnections> | null = null;
  try {
    conn = getTechniqueConnections(current);
  } catch {
    conn = null;
  }
  if (DEFENSE_WORDS.test(text)) {
    for (const x of [...(conn?.counter ?? []), ...(conn?.escape ?? [])]) take(resolveTechnique(x.techniqueId), `${current.name}에 대한 상대의 대응으로 기록된 기술`);
    // the family's own defence record ("Single-Leg Down Defense" for the single-leg family)
    // or the record named like this one ("Single-Leg Position" → "Single-Leg Down Defense")
    const topic = categoryTopic(art, current.categoryByArt?.[art] ?? current.category);
    const words = [...new Set([topic ? familyWord(topic.members) : null, current.name.toLowerCase().split(/[^a-z]+/)[0]].filter((w): w is string => !!w && w.length >= 4))];
    for (const word of words) for (const t of getUnifiedAllTechniques()) if (t.id !== current.id && /defen[cs]e|counter/i.test(t.name) && new RegExp(`^${word}\\b`, 'i').test(t.name)) take(t, topic && word === familyWord(topic.members) ? `같은 계열(${topic.category})의 방어 기록` : `${current.name}과(와) 같은 이름 계열의 방어 기록`);
    for (const name of [...current.defenses, ...current.counters]) take(getUnifiedAllTechniques().find((t) => t.name.toLowerCase() === name.toLowerCase()), `${current.name} 기록의 방어·카운터 항목`);
    return picks.size ? { kind: 'defense', techniqueIds: [...picks.keys()], reasons: Object.fromEntries(picks), status: 'pending' } : null;
  }
  const k = index ? gatherTechniqueKnowledge(current.id, index, { art }) : null;
  for (const s of [...(k?.setupsInto ?? []), ...(k?.combos.map((c) => c.sequence) ?? [])]) for (const st of s.steps) take(resolveTechnique(st.techniqueId), `기록된 ${s.kind === 'setup' ? '셋업' : '콤보'} "${s.name}"의 동작`);
  for (const x of [...(conn?.next ?? []), ...(conn?.chain ?? [])]) take(resolveTechnique(x.techniqueId), `${current.name}에서 이어지는 기술(기술 연결 기록)`);
  return picks.size ? { kind: 'connected', techniqueIds: [...picks.keys()], reasons: Object.fromEntries(picks), status: 'pending' } : null;
}

/** Fighter combos → the MARTIALDEX records in them (from the evidence report's items). */
export function fighterComboProposal(lessonIds: string[], art: string, items: { kind: string; techniqueIds: string[]; quotes?: { quote: string; url: string; verified?: boolean }[]; text?: string }[]): LessonAddProposal | null {
  const inRun = new Set(lessonIds.map(canonicalTechniqueId));
  const reasons: Record<string, string> = {};
  const evidence: { quote: string; url: string }[] = [];
  for (const it of items.filter((i) => i.kind === 'combo' || i.kind === 'setup')) {
    for (const id of it.techniqueIds) {
      const t = resolveTechnique(id);
      if (!t || inRun.has(canonicalTechniqueId(t.id)) || reasons[t.id] || !(t.martialArts ?? [t.martialArt]).includes(art) || lessonReadiness(t).level === 'insufficient') continue;
      reasons[t.id] = `선수 분석 자료의 ${it.kind === 'combo' ? '콤비네이션' : '셋업'}${it.text ? ` "${it.text}"` : ''}`;
      const q = it.quotes?.find((x) => x.verified !== false);
      if (q && !evidence.some((e) => e.url === q.url)) evidence.push({ quote: q.quote, url: q.url });
      if (Object.keys(reasons).length >= 3) break;
    }
  }
  const ids = Object.keys(reasons);
  return ids.length ? { kind: 'fighter_combo', techniqueIds: ids, reasons, evidence: evidence.slice(0, 3), status: 'pending' } : null;
}

export function proposalText(p: LessonAddProposal): string {
  const head = p.kind === 'defense' ? '이 기술의 방어·대응으로 함께 배울 수 있는 기록입니다.' : p.kind === 'fighter_combo' ? '선수 분석 자료의 콤비네이션·셋업에 나온 MARTIALDEX 기술입니다.' : '지금 기술과 기록으로 연결된 기술입니다.';
  const lines = p.techniqueIds.map((id) => {
    const t = resolveTechnique(id);
    return `- ${t ? label(t) : id}: ${p.reasons[id]}`;
  });
  const ev = p.evidence?.length ? `\n근거 문장: ${p.evidence.map((e) => `"${e.quote.slice(0, 140)}" (${e.url})`).join(' / ')}` : '';
  return `${head}\n${lines.join('\n')}${ev}\n수업 순서 끝에 추가할까요? ("추가" 또는 "아니요") — 지금 진행 중인 단계와 기록은 바뀌지 않습니다.`;
}

const YES = /^(네|넵|응|예|좋아|좋아요|그래|그래요|오케이|ok|ㅇㅇ)*(추가(해|할게|하자|해요)?(줘|주세요)?|넣어(줘|주세요)?)?$/i;
const NO = /^(아니|아니요|아니오|아뇨|괜찮아|괜찮아요|됐어|됐어요|필요없어|필요없어요|안할래|안할래요|취소|추가하지마|빼줘)+$/;

/** A reply to a pending proposal: yes / no / something else (not about the proposal). */
export function consentOf(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase().replace(/[\s,.!~…]+/g, '');
  if (!t) return null;
  if (NO.test(t)) return 'no';
  if (YES.test(t)) return 'yes';
  return null;
}

/** The last proposal in the log still waiting for the learner. */
export function pendingProposal(messages: CoachMessage[]): CoachMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.proposal) return m.proposal.status === 'pending' ? m : null;
  }
  return null;
}
