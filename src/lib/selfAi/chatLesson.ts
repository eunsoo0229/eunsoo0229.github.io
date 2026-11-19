// Conversation ⇄ lesson bridge for the 자체 AI 코치.
//
// - A lesson proposed in the chat becomes a one-Day "대화 수업" curriculum run by
//   the existing lesson engine (CurriculumCoachSession), so lesson state,
//   progress and records stay owned by that engine — never by the model.
// - Mid-lesson questions that need the web are answered by the conversation coach
//   and only APPEND messages (the step / pending question / progress are untouched).
// - "이것도 수업에 추가해 줘" adds only techniques that exist in MARTIALDEX, after
//   everything already in the run (aiCoachDay/sessionStore.appendTechniquesToCoachDayRun);
//   web-only findings are kept as candidates with their verification status.

import type { LessonAddProposal } from './lessonSession';
import type { Curriculum, CurriculumDrill } from '../curriculum/types';
import { getAuthorName, getCurriculum, saveCustomCurriculum } from '../curriculum/curriculumService';
import { appendTechniquesToCoachDayRun, getCoachDayRun } from '../aiCoachDay/sessionStore';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import { attachSequenceDrills } from '../martialdexKnowledge/drills';
import type { KnowledgeIndex, KnowledgeSequence } from '../martialdexKnowledge/types';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { resolveTechnique } from '../userTechniques/service';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import type { ChatSource, LessonProposal } from './types';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function drillFrom(kind: CurriculumDrill['kind'], focus: string, s: KnowledgeSequence): CurriculumDrill {
  return { kind, focusTechniqueId: focus, steps: s.steps.map((st) => ({ ...st })), title: s.name, purpose: s.purpose, sequenceId: s.id, origin: s.origin };
}

/** Builds (does not save) the one-Day lesson curriculum for a proposal. Null when no MARTIALDEX technique backs it. */
export function buildLessonCurriculum(p: LessonProposal, index: KnowledgeIndex, sources: ChatSource[], conversationId: string, now = new Date()): Curriculum | null {
  // Only records with enough data to teach (a stub record made a lesson of repeated category text).
  const teachable = (id: string) => {
    const t = resolveTechnique(id);
    return !!t && lessonReadiness(t).level !== 'insufficient';
  };
  const techniqueIds = [...new Set(p.techniqueIds.filter(teachable).map((id) => resolveTechnique(id)!.id))];
  // Steps of the proposal's setups/combos join the lesson so they can actually be practised.
  const seqs = p.sequenceIds.map((id) => index.sequences.find((s) => s.id === id)).filter((s): s is KnowledgeSequence => !!s).slice(0, 4);
  const stepIds = seqs.flatMap((s) => s.steps.map((st) => st.techniqueId)).filter(teachable);
  const all = [...new Set([...techniqueIds, ...stepIds])].slice(0, 6);
  if (!all.length) return null;
  const art = p.martialArt ?? resolveTechnique(all[0])?.martialArt ?? 'boxing';
  const focus = canonicalTechniqueId(techniqueIds[0] ?? all[0]);
  const proposalDrills = seqs.map((s) => drillFrom(s.kind === 'setup' ? 'setup' : 'combo', focus, s));
  const base = {
    day: 1,
    title: p.topic,
    description: `대화에서 시작한 수업입니다. MARTIALDEX 기술 기록${sources.length || p.sourceUrls.length ? `과 검색 자료 ${Math.max(sources.length, p.sourceUrls.length)}건` : ''}을 바탕으로 구성했습니다.${p.summary?.length ? `\n${p.summary.slice(0, 5).map((x) => `· ${x}`).join('\n')}` : ''}`,
    learningGoals: [`${all.map((id) => resolveTechnique(id)?.name ?? id).join(', ')} 익히기`, ...(proposalDrills.length ? ['셋업·콤보로 연결해서 써 보기'] : [])],
    techniqueIds: all,
    reviewTechniqueIds: [],
    difficulty: null,
    estimatedMinutes: Math.min(60, 10 + all.length * 8),
  };
  // Proposal sequences first; then any other recorded drill that fits the lesson's techniques.
  const extra = attachSequenceDrills([base], index, { art }).days[0].drills ?? [];
  const drills = [...proposalDrills, ...extra.filter((d) => !proposalDrills.some((x) => x.sequenceId === d.sequenceId))].slice(0, 4);
  const iso = now.toISOString();
  return {
    id: `chatlesson-${newId()}`,
    martialArt: art,
    title: `💬 ${p.topic}`.slice(0, 80),
    subtitle: '자체 AI 코치 대화 수업',
    description: base.description,
    source: 'custom',
    visibility: 'private',
    authorName: getAuthorName(),
    coverIcon: '💬',
    totalDays: 1,
    estimatedWeeks: 1,
    phases: [],
    days: [{ ...base, ...(drills.length ? { drills } : {}) }],
    techniqueCount: all.length,
    createdAt: iso,
    updatedAt: iso,
    chatLessonMeta: {
      conversationId,
      topic: p.topic,
      sources: sources.map((s) => ({ title: s.title, url: s.url, sourceTypeLabel: s.sourceTypeLabel, reliabilityLabel: s.reliability.label, publishedAt: s.publishedAt })),
      candidateIds: p.candidateIds,
      createdAt: iso,
    },
  };
}

/**
 * The sources a lesson started from a chat message is built with: that message's own sources plus every source
 * found EARLIER in the conversation that the proposal names (proposal.sourceUrls) — a lesson proposed a turn
 * after the research ("이걸로 수업 만들어줘") otherwise lost the research (42개 문제 K32).
 */
export function lessonSourcesFor(p: LessonProposal, message: { sources?: ChatSource[] }, conversation: { sources?: ChatSource[] }[]): ChatSource[] {
  const wanted = new Set(p.sourceUrls);
  const earlier = conversation.flatMap((x) => x.sources ?? []).filter((s) => wanted.has(s.url));
  return [...new Map([...(message.sources ?? []), ...earlier].map((s) => [s.url, s])).values()];
}

/** Saves the lesson curriculum and returns the route of its coach session. */
export function startLessonFromProposal(p: LessonProposal, index: KnowledgeIndex, sources: ChatSource[], conversationId: string, mode: 'text' | 'voice' = 'text'): { ok: true; curriculum: Curriculum; route: string } | { ok: false; message: string } {
  const c = buildLessonCurriculum(p, index, sources, conversationId);
  if (!c) return { ok: false, message: '이 주제에는 수업으로 가르칠 만큼 자료(설명·동작 단계·핵심 포인트)가 있는 MARTIALDEX 기술이 없어 수업을 만들지 않았습니다. 기술 이름을 함께 말씀해 주세요.' };
  const saved = saveCustomCurriculum(c);
  return { ok: true, curriculum: saved, route: `/learning/${saved.martialArt}/${saved.id}/coach/1?mode=${mode}` };
}

export interface AddToLessonResult {
  added: { techniqueId: string; name: string; via: string }[];
  skippedExisting: string[];
  drillsAdded: CurriculumDrill[];
  message: string;
}

/**
 * Finds setups / combos / follow-ups connected to the current technique in the
 * MARTIALDEX records and adds the missing techniques to the running lesson.
 */
export function addConnectedToActiveLesson(currentTechniqueId: string, index: KnowledgeIndex, opts: { art?: string; max?: number } = {}): AddToLessonResult {
  const run = getCoachDayRun();
  if (!run || run.finishedAt) return { added: [], skippedExisting: [], drillsAdded: [], message: '진행 중인 수업이 없습니다.' };
  if (run.step === 'recap') return { added: [], skippedExisting: [], drillsAdded: [], message: '수업이 마무리 단계라 지금은 추가하지 않았습니다. 다음 수업에서 이어서 다뤄 보세요.' };
  const k = gatherTechniqueKnowledge(currentTechniqueId, index, { art: opts.art });
  if (!k) return { added: [], skippedExisting: [], drillsAdded: [], message: '현재 기술을 MARTIALDEX에서 찾지 못했습니다.' };
  const inRun = new Set(run.techniqueIds.map(canonicalTechniqueId));
  const seqs = [...k.setupsInto, ...k.combos.map((c) => c.sequence), ...k.setupsUsing];
  const picks: { techniqueId: string; via: string }[] = [];
  const drillsAdded: CurriculumDrill[] = [];
  for (const s of seqs) {
    const missing = s.steps.map((st) => st.techniqueId).filter((id) => !inRun.has(id) && !picks.some((p) => p.techniqueId === id) && resolveTechnique(id));
    if (!missing.length) continue;
    for (const id of missing) picks.push({ techniqueId: id, via: s.name });
    drillsAdded.push(drillFrom(s.kind === 'setup' ? 'setup' : 'combo', canonicalTechniqueId(k.technique.id), s));
    if (picks.length >= (opts.max ?? 3)) break;
  }
  const skippedExisting = seqs.flatMap((s) => s.steps.map((st) => st.techniqueId)).filter((id) => inRun.has(id) && id !== canonicalTechniqueId(k.technique.id));
  const addedIds = appendTechniquesToCoachDayRun(picks.map((p) => p.techniqueId));
  const added = picks.filter((p) => addedIds.includes(p.techniqueId)).map((p) => ({ ...p, name: resolveTechnique(p.techniqueId)?.name ?? p.techniqueId }));
  // Keep the lesson's Day in sync so Day detail shows the same items (custom curricula only).
  const c = getCurriculum(run.curriculumId);
  if (added.length && c && c.source === 'custom') {
    saveCustomCurriculum({
      ...c,
      days: c.days.map((d) =>
        d.day === run.day
          ? { ...d, techniqueIds: [...new Set([...d.techniqueIds, ...added.map((a) => a.techniqueId)])], drills: [...(d.drills ?? []), ...drillsAdded.filter((x) => !(d.drills ?? []).some((y) => y.sequenceId === x.sequenceId))] }
          : d
      ),
    });
  }
  const message = added.length
    ? `현재 수업 뒤에 ${added.map((a) => `${a.name}(「${a.via}」에서)`).join(', ')}을(를) 추가했습니다. 지금 하던 단계는 그대로 이어집니다.`
    : 'MARTIALDEX 기록에서 지금 수업에 없는 연결 셋업·콤보를 찾지 못해 추가하지 않았습니다.';
  return { added, skippedExisting: [...new Set(skippedExisting)], drillsAdded, message };
}

/**
 * The learner agreed to a proposal (lessonSession.proposeLessonAddition): append its techniques to
 * the END of the running lesson. The current step, pending question, progress and outcomes are
 * not touched; the custom curriculum's Day gets the same techniques so Day detail matches.
 */
export function acceptLessonAddition(p: LessonAddProposal): AddToLessonResult {
  const run = getCoachDayRun();
  if (!run || run.finishedAt) return { added: [], skippedExisting: [], drillsAdded: [], message: '진행 중인 수업이 없습니다.' };
  if (run.step === 'recap') return { added: [], skippedExisting: [], drillsAdded: [], message: '수업이 마무리 단계라 지금은 추가하지 않았습니다. 다음 수업에서 이어서 다뤄 보세요.' };
  const addedIds = appendTechniquesToCoachDayRun(p.techniqueIds.filter((id) => !!resolveTechnique(id)));
  const added = addedIds.map((id) => ({ techniqueId: id, name: resolveTechnique(id)?.name ?? id, via: p.reasons[id] ?? '' }));
  const c = getCurriculum(run.curriculumId);
  if (added.length && c && c.source === 'custom') {
    saveCustomCurriculum({ ...c, days: c.days.map((d) => (d.day === run.day ? { ...d, techniqueIds: [...new Set([...d.techniqueIds, ...addedIds])] } : d)) });
  }
  const skippedExisting = p.techniqueIds.filter((id) => !addedIds.includes(id));
  return {
    added,
    skippedExisting,
    drillsAdded: [],
    message: added.length ? `수업 순서 끝에 ${added.map((a) => a.name).join(', ')}을(를) 추가했습니다. 지금 하던 단계는 그대로 이어집니다.` : '이미 수업에 있는 기술이라 추가하지 않았습니다.',
  };
}

/** Short text describing the running lesson, for the conversation coach's prompt. */
export function activeLessonContext(): string | null {
  const run = getCoachDayRun();
  if (!run || run.finishedAt) return null;
  const cur = resolveTechnique(run.techniqueIds[run.index] ?? '');
  const names = run.techniqueIds.map((id) => resolveTechnique(id)?.name ?? id);
  return `수업 기술: ${names.join(', ')} / 현재: ${cur?.name ?? '-'} (단계 ${run.step})`;
}
