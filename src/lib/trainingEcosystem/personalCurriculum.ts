// 나의 학습 커리큘럼 — an adaptive learning path (사양 §2).
//
// A goal (preset or chosen techniques) becomes a roadmap of stages: techniques picked from the official DB for that
// goal, ordered so prerequisites come first (techniqueGraph) and easier records before harder ones, each with how it is
// evaluated (pose measurement / AI-coach lesson assessment / self-check) and a stage gate. The plan never stores the
// learner's level: every screen reads it live from the records (learningState.ts), so the curriculum, the dashboard and
// the coach always agree. What the plan does keep is the structure, when each item was first seen done, and a change log.
//
// Adapting: refreshPlan() records progress it observes (an item reaching 학습 완료, a stage gate passed) and produces
// suggestions — go back to a prerequisite when a technique keeps needing repeats, review what was left alone, evaluate
// what was practised but never measured, add next techniques when the path is finished. Structural changes are applied
// only when the learner presses 적용 (or edits the plan); nothing here touches learning records.

import type { Technique } from '../../types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { ledFrom } from '../coachKnowledge/relations';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { ECO_STATE_LABEL, isDone, type TechniqueState } from './learningState';

export type GoalPresetId = 'boxing_basics' | 'wrestling_basics' | 'bjj_guard' | 'mma_complete' | 'strike_grapple' | 'technique_focus' | 'all_round_basics';

interface Pick {
  art: string;
  category: RegExp;
  exclude?: RegExp;
  max: number;
}

export interface GoalPreset {
  id: GoalPresetId;
  label: string;
  description: string;
  picks: Pick[];
}

export const GOAL_PRESETS: GoalPreset[] = [
  { id: 'boxing_basics', label: '복싱 기본기 습득', description: '기본 자세 · 펀치 · 풋워크 · 방어 · 기본 조합', picks: [{ art: 'boxing', category: /(기본 자세|기본 펀치|풋워크|^방어|조합)/, max: 15 }] },
  { id: 'wrestling_basics', label: '레슬링 기초 습득', description: '기본 자세와 움직임 · 그립 · 진입 · 싱글/더블 레그 · 방어', picks: [{ art: 'wrestling', category: /(기본 자세|스탠딩 포지션|공격 진입|싱글 레그|더블 레그|^방어)/, max: 15 }] },
  { id: 'bjj_guard', label: 'BJJ 가드 플레이 학습', description: '기본 움직임 · 클로즈드/오픈/하프/버터플라이 가드 · 스윕', picks: [{ art: 'bjj', category: /(기본 움직임|클로즈드 가드|오픈 가드|하프 가드|버터플라이|스윕)/, exclude: /(패스|Passing)/, max: 15 }] },
  {
    id: 'mma_complete',
    label: 'MMA 종합 기술 학습',
    description: '타격 기본 · 테이크다운 · 그라운드 컨트롤 · 서브미션 · 케이지',
    picks: [
      { art: 'boxing', category: /(기본 자세|기본 펀치)/, max: 4 },
      { art: 'wrestling', category: /(싱글 레그|더블 레그|공격 진입)/, max: 4 },
      { art: 'bjj', category: /(기본 움직임|탈출)/, max: 3 },
      { art: 'mixed-martial-arts', category: /./, max: 10 },
    ],
  },
  {
    id: 'strike_grapple',
    label: '타격과 그래플링의 연결',
    description: '타격 조합 → 진입 → 테이크다운 → 케이지·클린치 전환',
    picks: [
      { art: 'boxing', category: /(조합|페인트)/, max: 3 },
      { art: 'wrestling', category: /(공격 진입|더블 레그|싱글 레그|바디락)/, max: 6 },
      { art: 'mixed-martial-arts', category: /(전환|테이크다운|클린치|케이지|스크램블)/, max: 8 },
    ],
  },
  { id: 'technique_focus', label: '특정 기술 숙련도 향상', description: '고른 기술과 그 선행 기술', picks: [] },
  {
    id: 'all_round_basics',
    label: '종합적인 무술 기초 완성',
    description: '복싱 · 레슬링 · BJJ 의 기본 자세와 움직임',
    picks: [
      { art: 'boxing', category: /(기본 자세|기본 펀치|풋워크)/, max: 5 },
      { art: 'wrestling', category: /(기본 자세|싱글 레그|더블 레그)/, max: 5 },
      { art: 'bjj', category: /(기본 움직임|클로즈드 가드|탈출)/, max: 5 },
    ],
  },
];

export type EvaluationMethod = 'pose' | 'lesson' | 'self';
export const EVALUATION_LABEL: Record<EvaluationMethod, string> = {
  pose: '카메라 자세 측정',
  lesson: 'AI 코치 수업 평가',
  self: '직접 연습 후 자기 확인 (평가 데이터 부족으로 표시)',
};

export type ItemRole = 'prerequisite' | 'core' | 'application' | 'review';
export const ROLE_LABEL: Record<ItemRole, string> = { prerequisite: '선행 기초', core: '핵심', application: '응용', review: '복습' };

export interface PlanItem {
  techniqueId: string;
  stage: number;
  role: ItemRole;
  reason: string;
  evaluation: EvaluationMethod;
  addedBy: 'ai' | 'user';
  addedAt: string;
  /** First time the learner was seen at 학습 완료 or better on it (observed, never set by hand). */
  doneAt?: string;
}

export interface PlanStage {
  index: number;
  title: string;
  goal: string;
}

export type SuggestionKind = 'add_prerequisite' | 'review' | 'evaluate' | 'add_next' | 'remove_mastered';
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  techniqueIds: string[];
  /** The item the suggestion is about. */
  forTechniqueId?: string;
  stage?: number;
  text: string;
  /** Structural suggestions change the plan when applied; the others are today's tasks. */
  structural: boolean;
}

export interface ChangeLogEntry {
  at: string;
  kind: 'created' | 'stage_passed' | 'item_done' | 'suggestion_applied' | 'user_edit' | 'goal_change';
  summary: string;
}

export interface PersonalCurriculum {
  id: string;
  version: 1;
  goal: { presetId: GoalPresetId; label: string; arts: string[]; focusTechniqueIds?: string[] };
  stages: PlanStage[];
  items: PlanItem[];
  /** Items the planner left out because the records already show them mastered. */
  skippedMastered: string[];
  weeklyTarget: number;
  dismissed: string[];
  log: ChangeLogEntry[];
  createdAt: string;
  updatedAt: string;
}

const DIFF_RANK: Record<string, number> = { beginner: 0, intermediate: 2, advanced: 3 };
const diffRank = (t: Technique) => (t.difficulty ? DIFF_RANK[t.difficulty] ?? 1 : 1);
const inArt = (t: Technique, art: string) => (t.martialArts ?? [t.martialArt]).includes(art) || t.martialArt === art;
const teachable = (t: Technique) => !t.notTechnique && lessonReadiness(t).level !== 'insufficient';
const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

/** Prerequisites the data states: the graph's (reversed "next" links) and techniques whose record says they lead into it. */
function prereqIds(t: Technique): string[] {
  const out: string[] = [];
  try {
    out.push(...getTechniqueConnections(t).prerequisite.map((c) => c.techniqueId));
  } catch {
    /* no graph */
  }
  try {
    out.push(...ledFrom(t).map((r) => r.techniqueId));
  } catch {
    /* no relation index */
  }
  return [...new Set(out)].filter((id) => id !== t.id);
}

export function evaluationFor(t: Technique, poseSupported: (t: Technique) => boolean): EvaluationMethod {
  if (poseSupported(t)) return 'pose';
  return lessonReadiness(t).level === 'ready' ? 'lesson' : 'self';
}

/** Prerequisites first (inside the set), then easier, then the data's own order (which lists basics first). */
export function orderByPrerequisites(list: Technique[]): Technique[] {
  const ids = new Set(list.map((t) => t.id));
  const pos = new Map(list.map((t, i) => [t.id, i]));
  const deps = new Map(list.map((t) => [t.id, prereqIds(t).filter((p) => ids.has(p) && p !== t.id)]));
  const out: Technique[] = [];
  const placed = new Set<string>();
  const byId = new Map(list.map((t) => [t.id, t]));
  const visiting = new Set<string>();
  const visit = (t: Technique) => {
    if (placed.has(t.id) || visiting.has(t.id)) return; // a cycle in the graph is broken at the first repeat
    visiting.add(t.id);
    for (const d of deps.get(t.id) ?? []) visit(byId.get(d)!);
    visiting.delete(t.id);
    placed.add(t.id);
    out.push(t);
  };
  for (const t of [...list].sort((a, b) => diffRank(a) - diffRank(b) || pos.get(a.id)! - pos.get(b.id)!)) visit(t);
  return out;
}

export interface BuildInput {
  presetId: GoalPresetId;
  /** For technique_focus. */
  focusTechniqueIds?: string[];
  techniques: Technique[];
  states: Map<string, TechniqueState>;
  resolve: (id: string) => Technique | undefined;
  poseSupported: (t: Technique) => boolean;
  now?: Date;
  weeklyTarget?: number;
}

const STAGE_TITLES = ['1단계 · 기초', '2단계 · 핵심', '3단계 · 응용'];

/** A new plan for a goal from the learner's current states. Returns null when the goal finds no teachable technique. */
export function buildPersonalCurriculum(input: BuildInput): PersonalCurriculum | null {
  const now = (input.now ?? new Date()).toISOString();
  const preset = GOAL_PRESETS.find((p) => p.id === input.presetId)!;
  let picked: Technique[] = [];
  const reasons = new Map<string, string>();
  if (preset.id === 'technique_focus') {
    const focus = (input.focusTechniqueIds ?? []).map((id) => input.resolve(id)).filter((t): t is Technique => !!t);
    for (const t of focus) {
      // the technique's own prerequisites first (one level, then their prerequisites), unless already learned
      for (const p of prereqIds(t)) {
        const pt = input.resolve(p);
        if (!pt || !teachable(pt) || picked.some((x) => x.id === pt.id)) continue;
        picked.push(pt);
        reasons.set(pt.id, `${label(t)}의 선행 기술`);
        for (const pp of prereqIds(pt).slice(0, 2)) {
          const ppt = input.resolve(pp);
          if (ppt && teachable(ppt) && !picked.some((x) => x.id === ppt.id)) {
            picked.push(ppt);
            reasons.set(ppt.id, `${label(pt)}의 선행 기술`);
          }
        }
      }
      if (!picked.some((x) => x.id === t.id)) picked.push(t);
      reasons.set(t.id, '선택한 목표 기술');
    }
  } else {
    for (const p of preset.picks) {
      const pool = input.techniques.filter((t) => inArt(t, p.art) && p.category.test(t.category) && !(p.exclude && p.exclude.test(t.category)) && teachable(t));
      // spread over the goal's categories (round-robin, easier first inside each) — one category must not fill the plan
      const byCat = new Map<string, Technique[]>();
      for (const t of pool) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);
      for (const list of byCat.values()) list.sort((a, b) => diffRank(a) - diffRank(b));
      const sorted: Technique[] = [];
      for (let k = 0; sorted.length < pool.length; k++) {
        let added = false;
        for (const list of byCat.values()) if (list[k]) (sorted.push(list[k]), (added = true));
        if (!added) break;
      }
      for (const t of sorted.slice(0, p.max)) {
        if (picked.some((x) => canonicalTechniqueId(x.id) === canonicalTechniqueId(t.id))) continue;
        picked.push(t);
        reasons.set(t.id, `${t.category} — 목표 "${preset.label}"에 포함`);
      }
    }
  }
  if (!picked.length) return null;
  const skippedMastered = picked.filter((t) => input.states.get(t.id)?.state === 'verified').map((t) => t.id);
  // mastered (verified) techniques are not assigned again — they still count as met prerequisites
  const toLearn = orderByPrerequisites(picked.filter((t) => !skippedMastered.includes(t.id) || preset.id === 'technique_focus' && (input.focusTechniqueIds ?? []).includes(t.id)));
  const n = toLearn.length;
  const stageOf = (i: number) => (n <= 4 ? 0 : Math.min(2, Math.floor((i * 3) / n)));
  const items: PlanItem[] = toLearn.map((t, i) => ({
    techniqueId: t.id,
    stage: stageOf(i),
    role: reasons.get(t.id)?.includes('선행') ? 'prerequisite' : stageOf(i) === 0 ? 'prerequisite' : stageOf(i) === 2 ? 'application' : 'core',
    reason: reasons.get(t.id) ?? '',
    evaluation: evaluationFor(t, input.poseSupported),
    addedBy: 'ai',
    addedAt: now,
  }));
  const usedStages = [...new Set(items.map((i) => i.stage))].sort();
  const stages: PlanStage[] = usedStages.map((s, k) => ({ index: s, title: usedStages.length === 1 ? '1단계' : STAGE_TITLES[s], goal: stageGoal(items.filter((i) => i.stage === s), input.resolve, k) }));
  return {
    id: `pc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    version: 1,
    goal: { presetId: preset.id, label: preset.id === 'technique_focus' ? `${(input.focusTechniqueIds ?? []).map((id) => input.resolve(id)?.koreanName ?? input.resolve(id)?.name ?? id).join(', ')} 숙련도 향상` : preset.label, arts: [...new Set(toLearn.map((t) => t.martialArt))], ...(input.focusTechniqueIds?.length ? { focusTechniqueIds: input.focusTechniqueIds } : {}) },
    stages,
    items,
    skippedMastered,
    weeklyTarget: input.weeklyTarget ?? 3,
    dismissed: [],
    log: [{ at: now, kind: 'created', summary: `"${preset.label}" 커리큘럼 생성 — 기술 ${items.length}개, ${stages.length}단계${skippedMastered.length ? ` (이미 숙련 확인된 ${skippedMastered.length}개 제외)` : ''}` }],
    createdAt: now,
    updatedAt: now,
  };
}

function stageGoal(items: PlanItem[], resolve: (id: string) => Technique | undefined, k: number): string {
  const names = items.slice(0, 3).map((i) => resolve(i.techniqueId)?.koreanName ?? resolve(i.techniqueId)?.name ?? i.techniqueId);
  const lead = k === 0 ? '기초 자세와 움직임을 익히고' : k === 1 ? '핵심 기술을 정확하게 수행하고' : '배운 기술을 연결해 응용하고';
  return `${lead} ${names.join(', ')}${items.length > 3 ? ` 외 ${items.length - 3}개` : ''}를 학습 완료 이상으로`;
}

/** Stage gate: ≥80% of the stage's items at 학습 완료 or better, and none of them waiting for a repeat. */
export const STAGE_PASS_RATIO = 0.8;
export function stageProgress(plan: PersonalCurriculum, stage: number, states: Map<string, TechniqueState>) {
  const items = plan.items.filter((i) => i.stage === stage);
  const done = items.filter((i) => isDone(states.get(i.techniqueId))).length;
  const repeat = items.filter((i) => states.get(i.techniqueId)?.state === 'needs_repeat').length;
  const passed = items.length > 0 && done / items.length >= STAGE_PASS_RATIO && repeat === 0;
  return { total: items.length, done, repeat, passed, ratio: items.length ? done / items.length : 0 };
}

export function currentStage(plan: PersonalCurriculum, states: Map<string, TechniqueState>): number | null {
  for (const s of plan.stages) if (!stageProgress(plan, s.index, states).passed) return s.index;
  return null; // every stage passed
}

export const advanceRuleText = `단계 기술의 ${Math.round(STAGE_PASS_RATIO * 100)}% 이상이 "학습 완료" 이상이고 "반복 학습 필요"인 기술이 없을 때 다음 단계로 넘어갑니다. 숙련도는 실제 평가(자세 측정·수업 평가)가 있을 때만 "확인 완료"가 됩니다.`;

export interface TodayTask {
  techniqueId: string;
  kind: 'review' | 'learn' | 'evaluate';
  reason: string;
  evaluation: EvaluationMethod;
}

/** Today's targets: what must be repeated first, then the next unlearned items of the current stage, then evaluations. */
export function todayTasks(plan: PersonalCurriculum, states: Map<string, TechniqueState>, max = 3): TodayTask[] {
  const out: TodayTask[] = [];
  const cur = currentStage(plan, states);
  const add = (t: TodayTask) => {
    if (out.length < max && !out.some((x) => x.techniqueId === t.techniqueId)) out.push(t);
  };
  for (const i of plan.items) {
    const s = states.get(i.techniqueId);
    if (s?.state === 'needs_repeat' && i.stage <= (cur ?? 99)) add({ techniqueId: i.techniqueId, kind: 'review', reason: s.reviewDue ? '복습 주기가 지남' : s.idleDays !== null && s.idleDays >= 21 ? `${s.idleDays}일 동안 연습 기록 없음` : '최근 평가가 낮음', evaluation: i.evaluation });
  }
  if (cur !== null) {
    for (const i of plan.items.filter((x) => x.stage === cur)) {
      const s = states.get(i.techniqueId);
      if (!s || s.state === 'not_started' || s.state === 'learning') add({ techniqueId: i.techniqueId, kind: 'learn', reason: s?.state === 'learning' ? '학습 중 — 이어서 연습' : `${ROLE_LABEL[i.role]} · 아직 학습 전`, evaluation: i.evaluation });
    }
  }
  for (const i of plan.items) if (states.get(i.techniqueId)?.state === 'needs_evaluation') add({ techniqueId: i.techniqueId, kind: 'evaluate', reason: '연습했지만 평가 기록이 없음', evaluation: i.evaluation });
  return out;
}

/** Items first seen done this ISO week, against the weekly target. */
export function weeklyProgress(plan: PersonalCurriculum, now = new Date()) {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
  const done = plan.items.filter((i) => i.doneAt && new Date(i.doneAt).getTime() >= monday).length;
  return { done, target: plan.weeklyTarget, weekStart: new Date(monday).toISOString().slice(0, 10) };
}

export interface RefreshDeps {
  resolve: (id: string) => Technique | undefined;
  /** Next techniques to learn in an art (personalAnswers.nextToLearn). */
  nextInArt?: (art: string, exclude: Set<string>) => string[];
  poseSupported: (t: Technique) => boolean;
  /** The art's foundational records (기본 자세·움직임) — used when the data states no prerequisite. */
  basicsInArt?: (art: string) => string[];
}

/**
 * Observe progress (doneAt, stage gates — logged once) and work out suggestions. Pure: returns the updated plan and the
 * suggestions; the caller saves the plan when `changed`.
 */
export function refreshPlan(plan: PersonalCurriculum, states: Map<string, TechniqueState>, deps: RefreshDeps, now = new Date()): { plan: PersonalCurriculum; changed: boolean; suggestions: Suggestion[] } {
  const at = now.toISOString();
  let changed = false;
  const next: PersonalCurriculum = { ...plan, items: plan.items.map((i) => ({ ...i })), log: [...plan.log] };
  const passedBefore = new Set(plan.log.filter((l) => l.kind === 'stage_passed').map((l) => l.summary.match(/^(\d+)/)?.[1]));
  for (const i of next.items) {
    if (!i.doneAt && isDone(states.get(i.techniqueId))) {
      i.doneAt = at;
      changed = true;
      next.log.push({ at, kind: 'item_done', summary: `${deps.resolve(i.techniqueId)?.name ?? i.techniqueId} — ${ECO_STATE_LABEL[states.get(i.techniqueId)!.state]}` });
    }
  }
  for (const s of next.stages) {
    if (stageProgress(next, s.index, states).passed && !passedBefore.has(String(s.index + 1))) {
      next.log.push({ at, kind: 'stage_passed', summary: `${s.index + 1}단계 통과 — ${s.title}` });
      changed = true;
    }
  }
  if (changed) next.updatedAt = at;

  const sug: Suggestion[] = [];
  const inPlan = new Set(next.items.map((i) => i.techniqueId));
  for (const i of next.items) {
    const s = states.get(i.techniqueId);
    if (!s) continue;
    const t = s.technique;
    // a technique that keeps getting a low evaluation → go back to its prerequisites that are not learned
    if (s.state === 'needs_repeat' && s.mastery === 'needs_improvement') {
      const notReady = (ids: string[]) => ids.filter((p) => !inPlan.has(p) && !isDone(states.get(p))).map((p) => deps.resolve(p)).filter((x): x is Technique => !!x && teachable(x) && x.id !== t.id).slice(0, 2);
      let missing = notReady(prereqIds(t));
      // no prerequisite in the data → the art's own basics (stance · movement), said as such
      const fromBasics = !missing.length && !!deps.basicsInArt;
      if (fromBasics) missing = notReady(deps.basicsInArt!(t.martialArt));
      if (missing.length) sug.push({ id: `pre:${i.techniqueId}`, kind: 'add_prerequisite', techniqueIds: missing.map((m) => m.id), forTechniqueId: i.techniqueId, stage: Math.max(0, i.stage - 1), structural: true, text: `${label(t)}의 평가가 낮습니다. ${fromBasics ? `기록된 선행 기술이 없어 같은 무술의 기본 자세·움직임 ` : '선행 기술 '}${missing.map(label).join(', ')}을(를) 앞 단계에 넣고 기초부터 다시 다지는 것을 제안합니다.` });
    }
    if (s.state === 'needs_evaluation') sug.push({ id: `eval:${i.techniqueId}`, kind: 'evaluate', techniqueIds: [i.techniqueId], forTechniqueId: i.techniqueId, structural: false, text: `${label(t)}은(는) ${s.practiceCount}번 연습했지만 평가 기록이 없습니다 — ${EVALUATION_LABEL[i.evaluation]}으로 숙련도를 확인해 보세요.` });
    if (s.state === 'needs_repeat' && s.mastery !== 'needs_improvement') sug.push({ id: `rev:${i.techniqueId}`, kind: 'review', techniqueIds: [i.techniqueId], forTechniqueId: i.techniqueId, structural: false, text: `${label(t)} 복습 — ${s.reviewDue ? '복습 주기가 지났습니다' : `${s.idleDays}일 동안 연습하지 않았습니다`}.` });
  }
  if (currentStage(next, states) === null && deps.nextInArt) {
    const art = next.goal.arts[0];
    const more = art ? deps.nextInArt(art, inPlan).slice(0, 3) : [];
    if (more.length) sug.push({ id: `next:${more.join(',')}`, kind: 'add_next', techniqueIds: more, stage: Math.max(...next.stages.map((s) => s.index)), structural: true, text: `모든 단계를 통과했습니다. 다음으로 배울 기술 ${more.map((id) => deps.resolve(id)?.name ?? id).join(', ')}을(를) 마지막 단계에 추가할까요?` });
  }
  return { plan: next, changed, suggestions: sug.filter((x) => !next.dismissed.includes(x.id)) };
}

/** Apply a structural suggestion (learner pressed 적용). Learning records are untouched; the change is logged. */
export function applySuggestion(plan: PersonalCurriculum, s: Suggestion, deps: RefreshDeps, now = new Date()): PersonalCurriculum {
  const at = now.toISOString();
  const items = plan.items.map((i) => ({ ...i }));
  const stages = [...plan.stages];
  for (const id of s.techniqueIds) {
    if (items.some((i) => i.techniqueId === id)) continue;
    const t = deps.resolve(id);
    if (!t) continue;
    const stage = s.stage ?? 0;
    if (!stages.some((x) => x.index === stage)) stages.push({ index: stage, title: STAGE_TITLES[stage] ?? `${stage + 1}단계`, goal: '추가된 기술을 학습 완료 이상으로' });
    const at0 = s.kind === 'add_prerequisite' ? items.findIndex((i) => i.techniqueId === s.forTechniqueId) : items.length;
    items.splice(at0 < 0 ? items.length : at0, 0, { techniqueId: id, stage, role: s.kind === 'add_prerequisite' ? 'prerequisite' : 'application', reason: s.kind === 'add_prerequisite' ? `${deps.resolve(s.forTechniqueId ?? '')?.name ?? ''}의 선행 기술 (평가가 낮아 추가)` : '모든 단계 통과 후 다음 기술', evaluation: evaluationFor(t, deps.poseSupported), addedBy: 'ai', addedAt: at });
  }
  stages.sort((a, b) => a.index - b.index);
  return { ...plan, items, stages, dismissed: [...plan.dismissed, s.id], updatedAt: at, log: [...plan.log, { at, kind: 'suggestion_applied', summary: s.text }] };
}

export function dismissSuggestion(plan: PersonalCurriculum, id: string): PersonalCurriculum {
  return { ...plan, dismissed: [...new Set([...plan.dismissed, id])], updatedAt: new Date().toISOString() };
}

// ---- learner edits (사양 §2-4: 사용자가 직접 커리큘럼을 수정하거나 기술을 추가)

export function addItem(plan: PersonalCurriculum, technique: Technique, stage: number, poseSupported: (t: Technique) => boolean, now = new Date()): PersonalCurriculum {
  if (plan.items.some((i) => i.techniqueId === technique.id)) return plan;
  const at = now.toISOString();
  const stages = plan.stages.some((s) => s.index === stage) ? plan.stages : [...plan.stages, { index: stage, title: STAGE_TITLES[stage] ?? `${stage + 1}단계`, goal: '추가한 기술을 학습 완료 이상으로' }].sort((a, b) => a.index - b.index);
  return { ...plan, stages, items: [...plan.items, { techniqueId: technique.id, stage, role: 'core', reason: '직접 추가한 기술', evaluation: evaluationFor(technique, poseSupported), addedBy: 'user', addedAt: at }], updatedAt: at, log: [...plan.log, { at, kind: 'user_edit', summary: `${technique.name} 추가 (${stage + 1}단계)` }] };
}

export function removeItem(plan: PersonalCurriculum, techniqueId: string, name: string, now = new Date()): PersonalCurriculum {
  const at = now.toISOString();
  return { ...plan, items: plan.items.filter((i) => i.techniqueId !== techniqueId), updatedAt: at, log: [...plan.log, { at, kind: 'user_edit', summary: `${name} 제외 (학습 기록은 그대로)` }] };
}

export function moveItem(plan: PersonalCurriculum, techniqueId: string, dir: -1 | 1, now = new Date()): PersonalCurriculum {
  const items = [...plan.items];
  const i = items.findIndex((x) => x.techniqueId === techniqueId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return plan;
  // moving across a stage boundary takes the item into that stage
  const moved = { ...items[i], stage: items[j].stage };
  items[i] = items[j];
  items[j] = moved;
  return { ...plan, items, updatedAt: now.toISOString() };
}

export function setWeeklyTarget(plan: PersonalCurriculum, n: number): PersonalCurriculum {
  return { ...plan, weeklyTarget: Math.max(1, Math.min(14, Math.round(n))), updatedAt: new Date().toISOString() };
}
