import type { Technique } from '../../types';
import type { CurriculumDay, CurriculumPhaseRange } from '../curriculum/types';
import type { GoalIntensity, GoalTechniqueMatch } from './types';
import { resolveTechnique as getTechnique } from '../userTechniques/service';

// 검증된 기술이 적을 때의 일정 — the number of techniques and the number of days are managed separately.
// A 30-day plan built on 3 verified techniques does NOT invent 4 more: it teaches each verified technique once
// (its only appearance in techniqueIds), then works on it through the learning elements below, each day tied to
// real verified techniques and the technique's own posture data. Daily volume stays at the learner's chosen
// minutes — more days means more repetition, never more load per day.
//   기본 동작 이해 → 단계별 기술 수행 → 기술 연결 → 상황별 의사결정 → 상대 반응에 따른 선택 → 안전한 저강도 적용 → 복습·숙련도 확인

export type LearningElement = 'understand' | 'steps' | 'connect' | 'decide' | 'react' | 'low_intensity' | 'review';

export const ELEMENT_LABEL: Record<LearningElement, string> = {
  understand: '기본 동작 이해',
  steps: '단계별 기술 수행',
  connect: '기술 연결',
  decide: '상황별 의사결정',
  react: '상대 반응에 따른 선택',
  low_intensity: '안전한 저강도 적용',
  review: '복습 · 숙련도 확인',
};

export interface EvidencePlanPart {
  id: string;
  label: string;
  /** Pool technique ids of this part, best first. */
  techniqueIds: string[];
}

export interface PlanEvidenceCurriculumParams {
  subjectLabel: string;
  matches: GoalTechniqueMatch[];
  parts: EvidencePlanPart[];
  targetDays: number;
  intensity: GoalIntensity;
  dailyMinutes: number;
}

function short(t: Technique): string {
  const base = t.koreanName && t.koreanName !== t.name && t.koreanName.length <= 14 ? t.koreanName : t.name;
  const cut = base.split(' / ')[0].split(' (')[0];
  return cut.length > 24 ? `${cut.slice(0, 23)}…` : cut;
}
function clip(s: string, n = 100): string {
  const one = s.split('\n')[0].trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
const gradeNote = (m: GoalTechniqueMatch | undefined) => (m?.evidenceGrade === 'A' ? '웹 자료로 검증' : m?.evidenceGrade === 'B' ? 'MARTIALDEX DB로 확인' : '근거 확인');

interface DayDraft {
  element: LearningElement;
  newIds: string[];
  reviewIds: string[];
  title: string;
  description: string;
  goals: string[];
}

export function planEvidenceCurriculum(params: PlanEvidenceCurriculumParams): { days: CurriculumDay[]; phases: CurriculumPhaseRange[] } {
  const { targetDays, subjectLabel } = params;
  const byId = new Map(params.matches.map((m) => [m.techniqueId, m]));
  const tech = (id: string) => getTechnique(id);
  const parts = params.parts.map((p) => ({ ...p, techniqueIds: p.techniqueIds.filter((id) => !!tech(id)) })).filter((p) => p.techniqueIds.length > 0);
  const ordered = [...new Set(parts.flatMap((p) => p.techniqueIds))];
  // at most 2 new techniques a day, 1 on a light schedule — more days never means more load per day
  const perDay = params.intensity === 'light' ? 1 : 2;
  const names = (ids: string[]) => ids.map((id) => short(tech(id)!)).join(' · ');

  // ── one full pass over the elements ──
  const intro: DayDraft[] = [];
  for (let i = 0; i < ordered.length; i += perDay) {
    const ids = ordered.slice(i, i + perDay);
    intro.push({
      element: 'understand',
      newIds: ids,
      reviewIds: [],
      title: `${ELEMENT_LABEL.understand}: ${names(ids)}`,
      description: `'${subjectLabel}' — ${ids.map((id) => `${tech(id)!.name}(${gradeNote(byId.get(id))})`).join(', ')}의 시작 자세와 목적을 이해합니다.`,
      goals: ids.map((id) => {
        const t = tech(id)!;
        return clip(t.posture?.startingPosition || t.posture?.overview || t.purpose || t.description || `${short(t)}의 시작 자세와 목적을 설명할 수 있다.`);
      }),
    });
  }
  const steps: DayDraft[] = ordered.map((id) => {
    const t = tech(id)!;
    const s = (t.posture?.steps ?? []).slice(0, 3).map((x) => clip(x));
    return { element: 'steps', newIds: [], reviewIds: [id], title: `${ELEMENT_LABEL.steps}: ${short(t)}`, description: `${t.name}을(를) 자료의 단계 순서대로 천천히 반복합니다.`, goals: s.length > 0 ? s : [`${short(t)}을(를) 단계별로 끊어서 수행할 수 있다.`] };
  });
  const connect: DayDraft[] = [];
  for (const p of parts) {
    for (let i = 0; i + 1 < p.techniqueIds.length; i++) {
      const [a, b] = [p.techniqueIds[i], p.techniqueIds[i + 1]];
      connect.push({ element: 'connect', newIds: [], reviewIds: [a, b], title: `${ELEMENT_LABEL.connect}: ${short(tech(a)!)} → ${short(tech(b)!)}`, description: `'${p.label}' 안에서 두 기술을 한 흐름으로 이어서 연습합니다(연결 지점에서 자세가 무너지지 않는지 확인).`, goals: [`${short(tech(a)!)}에서 ${short(tech(b)!)}로 멈추지 않고 이어서 수행할 수 있다.`] });
    }
  }
  if (parts.length > 1) {
    // across parts: the core situation into the follow-up (the order the learner asked for)
    const a = parts[0].techniqueIds[0];
    const b = parts[1].techniqueIds[0];
    connect.push({ element: 'connect', newIds: [], reviewIds: [a, b], title: `${ELEMENT_LABEL.connect}: ${parts[0].label} → ${parts[1].label}`, description: `요청하신 순서대로 '${parts[0].label}'에서 '${parts[1].label}'(으)로 이어지는 흐름을 연습합니다.`, goals: [`${short(tech(a)!)} 이후 ${short(tech(b)!)}까지 한 번에 이어서 수행할 수 있다.`] });
  }
  const decide: DayDraft[] = parts.map((p) => {
    const ids = p.techniqueIds.slice(0, 4);
    return { element: 'decide', newIds: [], reviewIds: ids, title: `${ELEMENT_LABEL.decide}: ${p.label}`, description: `'${p.label}' 상황을 파트너와 만들어 두고, 배운 기술 중 무엇을 쓸지 고르는 연습을 합니다.`, goals: [`'${p.label}' 상황에서 ${names(ids)} 중 하나를 골라 이유와 함께 수행할 수 있다.`] };
  });
  const react: DayDraft[] = parts
    .filter((p) => p.techniqueIds.length >= 2)
    .map((p) => {
      const ids = p.techniqueIds.slice(0, 3);
      const mistakes = ids.flatMap((id) => tech(id)!.posture?.commonMistakes ?? []).slice(0, 2).map((x) => `흔한 실수 점검: ${clip(x, 80)}`);
      return { element: 'react', newIds: [], reviewIds: ids, title: `${ELEMENT_LABEL.react}: ${names(ids)}`, description: '파트너가 버티는 방향이나 그립을 바꿔 줄 때, 그 반응에 맞는 기술로 바꿔 선택하는 연습을 합니다.', goals: [`파트너의 반응이 바뀌면 ${names(ids)} 중 다른 기술로 전환할 수 있다.`, ...mistakes] };
    });
  const low: DayDraft = { element: 'low_intensity', newIds: [], reviewIds: ordered.slice(0, 4), title: `${ELEMENT_LABEL.low_intensity}: ${names(ordered.slice(0, 4))}`, description: '파트너 저항을 낮게(약 30~50%) 두고 실제 상황처럼 적용합니다. 시작 전에 탭·중단 신호를 약속하고, 관절기·조르기는 천천히 겁니다.', goals: ['낮은 저항에서 배운 기술을 끝까지 통제된 속도로 적용할 수 있다.', '탭·중단 신호에 즉시 멈출 수 있다.'] };
  const review = (n: number, of: number): DayDraft => ({
    element: 'review',
    newIds: [],
    reviewIds: ordered.slice(0, 8),
    title: of > 1 ? `${ELEMENT_LABEL.review} ${n}/${of}` : ELEMENT_LABEL.review,
    description: `'${subjectLabel}'에서 배운 검증된 기술을 처음부터 다시 수행하며 숙련도를 스스로 확인합니다.`,
    // each review day checks a different key point of the same techniques
    goals: ordered.slice(0, 3).map((id) => {
      const kps = tech(id)!.posture?.keyPoints ?? [];
      const kp = kps.length > 0 ? kps[(n - 1) % kps.length] : undefined;
      return kp ? `${short(tech(id)!)} 핵심 확인: ${clip(kp, 80)}` : `${short(tech(id)!)}을(를) 도움 없이 수행할 수 있다.`;
    }),
  });

  // ── fit the passes to the day count ──
  const practice = [...steps, ...connect, ...decide, ...react, low];
  const finalReviews = targetDays >= 14 ? 2 : 1;
  let middle: DayDraft[] = [];
  const room = Math.max(0, targetDays - intro.length - finalReviews);
  // repeat the practice elements in rounds (반복 연습) — every repeat names the round, never a "new" technique
  for (let round = 1; middle.length < room; round++) {
    for (const d of practice) {
      if (middle.length >= room) break;
      middle.push(round === 1 ? d : { ...d, title: `${d.title} (반복 ${round}회차)` });
    }
    if (practice.length === 0) break;
  }
  let drafts = [...intro, ...middle, ...Array.from({ length: finalReviews }, (_, i) => review(i + 1, finalReviews))];
  if (drafts.length > targetDays) {
    // fewer days than one pass: keep every introduction and the final review, then the earliest practice days
    const keepPractice = Math.max(0, targetDays - intro.length - 1);
    drafts = [...intro.slice(0, targetDays - 1), ...middle.slice(0, keepPractice), review(1, 1)].slice(0, targetDays);
    // an introduction that did not fit is taught on the final review day instead of being dropped silently
    const taught = new Set(drafts.flatMap((d) => d.newIds));
    const missing = ordered.filter((id) => !taught.has(id));
    if (missing.length > 0) drafts[drafts.length - 1].newIds = missing;
  }
  while (drafts.length < targetDays) drafts.splice(drafts.length - 1, 0, { ...low, title: `${low.title} (반복)` });

  const days: CurriculumDay[] = drafts.map((d, i) => ({
    day: i + 1,
    title: d.title,
    description: d.description,
    learningGoals: d.goals.length > 0 ? d.goals : [`${d.title}을(를) 수행할 수 있다.`],
    techniqueIds: d.newIds,
    reviewTechniqueIds: d.reviewIds.filter((id) => !d.newIds.includes(id)),
    difficulty: d.element === 'understand' || d.element === 'steps' ? 'beginner' : 'intermediate',
    estimatedMinutes: Math.max(15, Math.min(90, params.dailyMinutes)),
  }));

  const phases: CurriculumPhaseRange[] = [];
  const firstPractice = intro.length + 1;
  const lastPractice = targetDays - finalReviews;
  if (intro.length > 0) phases.push({ name: '기본 동작 이해', blurb: `검증된 기술 ${ordered.length}개의 시작 자세와 목적을 익힙니다.`, startDay: 1, endDay: Math.min(intro.length, targetDays) });
  if (lastPractice >= firstPractice) phases.push({ name: '수행 · 연결 · 상황 훈련', blurb: '같은 기술을 단계 수행 → 연결 → 상황 판단 → 반응 선택 → 저강도 적용 순서로 반복합니다.', startDay: firstPractice, endDay: lastPractice });
  if (targetDays > intro.length) phases.push({ name: '복습 · 숙련도 확인', blurb: '배운 기술을 다시 수행하며 숙련도를 확인합니다.', startDay: Math.max(firstPractice, lastPractice + 1), endDay: targetDays });
  return { days, phases };
}
