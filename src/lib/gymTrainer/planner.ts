import type { Technique } from '../../types';
import type { Weekday } from '../dateUtil';
import { GYM_BODY_PART_LABEL } from '../gymTraining/recovery';
import type { GeminiJsonOutcome } from '../userTechniques/geminiJson';
import type { GymRoutine } from '../gymRoutine/types';
import type { NutritionProfile } from '../nutrition/types';

// AI 트레이너 — 목적에 맞는 헬스 루틴과 식단.
// The routine uses ONLY exercises in MARTIALDEX's gym library (ids checked; anything else is dropped),
// so it saves straight into 헬스 루틴 and runs in 오늘의 훈련. The meal plan reuses the existing
// AI 식단 생성; its targets come from the user's own 영양 목표 when set — a calorie number is never
// invented here (no activity data exists to justify one).

export type TrainingGoal = 'hypertrophy' | 'strength' | 'fatloss' | 'conditioning' | 'martial';
export const GOAL_LABEL: Record<TrainingGoal, string> = {
  hypertrophy: '근비대 (몸 키우기)',
  strength: '근력 향상',
  fatloss: '체지방 감량',
  conditioning: '체력·컨디셔닝',
  martial: '무술 보강 (파워·코어)',
};
export type Level = 'beginner' | 'intermediate' | 'advanced';
export const LEVEL_LABEL: Record<Level, string> = { beginner: '초급 (6개월 미만)', intermediate: '중급', advanced: '고급' };
export type Equipment = 'gym' | 'dumbbell' | 'bodyweight';
export const EQUIPMENT_LABEL: Record<Equipment, string> = { gym: '헬스장 (모든 기구)', dumbbell: '덤벨·맨몸', bodyweight: '맨몸만' };

export interface PlanInput {
  goal: TrainingGoal;
  daysPerWeek: number;
  level: Level;
  equipment: Equipment;
  minutes: number;
  /** pain / injuries / things to avoid, free text */
  cautions: string;
}

export interface PlannedExercise {
  techniqueId: string;
  name: string;
  sets: number;
  reps: number | null;
  seconds: number | null;
  restSeconds: number;
  note: string | null;
}
export interface PlannedDay {
  weekday: Weekday;
  focus: string;
  exercises: PlannedExercise[];
}
export interface GymPlan {
  name: string;
  summary: string;
  days: PlannedDay[];
  notes: string[];
  source: 'ai' | 'template';
  /** ids the AI used that aren't in the library (dropped) */
  dropped: string[];
}

/** Exercises the user can actually do with that equipment. */
export function exercisePool(all: Technique[], equipment: Equipment): Technique[] {
  const ok = (eq: string[]) => (equipment === 'gym' ? true : equipment === 'dumbbell' ? eq.every((e) => e === '덤벨' || e === '맨몸' || e === '케틀벨' || e === '원판') : eq.every((e) => e === '맨몸' || e === '철봉'));
  return all.filter((t) => t.gymBodyPart && ok(t.gymEquipment ?? []));
}

const clampInt = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);

interface RawPlan {
  name?: unknown;
  summary?: unknown;
  days?: unknown;
  notes?: unknown;
}
const isRawPlan = (d: unknown): d is RawPlan => !!d && typeof d === 'object' && Array.isArray((d as RawPlan).days);

/** Keeps only real library exercises, sane numbers, one entry per weekday (pure — tested). */
export function validatePlan(raw: RawPlan, pool: Technique[], daysPerWeek: number): GymPlan {
  const byId = new Map(pool.map((t) => [t.id, t]));
  const dropped: string[] = [];
  const seen = new Set<number>();
  const days: PlannedDay[] = [];
  for (const d of (raw.days as unknown[]) ?? []) {
    if (!d || typeof d !== 'object') continue;
    const o = d as { weekday?: unknown; focus?: unknown; exercises?: unknown };
    const weekday = clampInt(o.weekday, 1, 7) as Weekday | null;
    if (!weekday || seen.has(weekday)) continue;
    const exercises: PlannedExercise[] = [];
    for (const e of Array.isArray(o.exercises) ? o.exercises : []) {
      const x = e as { id?: unknown; sets?: unknown; reps?: unknown; seconds?: unknown; restSeconds?: unknown; note?: unknown };
      const t = typeof x.id === 'string' ? byId.get(x.id) : undefined;
      if (!t) {
        if (typeof x.id === 'string') dropped.push(x.id);
        continue;
      }
      if (exercises.some((y) => y.techniqueId === t.id)) continue;
      const seconds = clampInt(x.seconds, 10, 3600);
      const reps = seconds ? null : clampInt(x.reps, 1, 50) ?? t.recommendedReps ?? 10;
      exercises.push({ techniqueId: t.id, name: t.name, sets: clampInt(x.sets, 1, 8) ?? t.recommendedSets ?? 3, reps, seconds, restSeconds: clampInt(x.restSeconds, 20, 300) ?? t.recommendedRestSeconds ?? 90, note: typeof x.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 120) : null });
      if (exercises.length >= 8) break;
    }
    if (!exercises.length) continue;
    seen.add(weekday);
    days.push({ weekday, focus: typeof o.focus === 'string' ? o.focus.trim().slice(0, 40) : '', exercises });
  }
  days.sort((a, b) => a.weekday - b.weekday);
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : 'AI 트레이너 루틴',
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    days: days.slice(0, Math.max(1, daysPerWeek)),
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string' && !!n.trim()).slice(0, 5) : [],
    source: 'ai',
    dropped,
  };
}

const SPLIT_DAYS: Record<number, Weekday[]> = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };

/** Offline template (AI unavailable): full-body days rotating the big muscle groups, library exercises only. */
export function templatePlan(input: PlanInput, pool: Technique[]): GymPlan {
  const n = Math.max(1, Math.min(6, input.daysPerWeek));
  const groups: NonNullable<Technique['gymBodyPart']>[][] = [
    ['chest', 'back', 'quads', 'shoulders', 'abs'],
    ['back', 'hamstrings', 'chest', 'glutes', 'triceps'],
    ['quads', 'shoulders', 'back', 'biceps', 'abs'],
  ];
  const easy = (t: Technique) => (input.level === 'beginner' ? t.gymDifficulty !== '고급' : true);
  const reps = input.goal === 'strength' ? 5 : input.goal === 'hypertrophy' ? 10 : 12;
  const rest = input.goal === 'strength' ? 150 : input.goal === 'fatloss' || input.goal === 'conditioning' ? 60 : 90;
  const perDay = input.minutes >= 70 ? 6 : input.minutes >= 45 ? 5 : 4;
  const days: PlannedDay[] = SPLIT_DAYS[n].map((weekday, i) => {
    const used = new Set<string>();
    const exercises: PlannedExercise[] = [];
    for (const part of groups[i % groups.length]) {
      const t = pool.find((x) => x.gymBodyPart === part && easy(x) && !used.has(x.id) && x.gymExerciseKind !== '유산소');
      if (!t) continue;
      used.add(t.id);
      exercises.push({ techniqueId: t.id, name: t.name, sets: input.goal === 'strength' ? 5 : 3, reps: t.recommendedDurationSeconds ? null : reps, seconds: t.recommendedDurationSeconds ?? null, restSeconds: rest, note: null });
      if (exercises.length >= perDay) break;
    }
    return { weekday, focus: groups[i % groups.length].slice(0, 3).map((p) => GYM_BODY_PART_LABEL[p]).join('·'), exercises };
  });
  return { name: `${GOAL_LABEL[input.goal].split(' ')[0]} 기본 루틴`, summary: 'AI 트레이너에 연결되지 않아 기본 전신 분할 템플릿으로 만들었습니다. 무게는 첫 주에 정해 주세요.', days: days.filter((d) => d.exercises.length), notes: [], source: 'template', dropped: [] };
}

type AskJson = <T>(p: { systemInstruction: string; contextText: string; question: string; useSearchGrounding?: boolean; validate?: (d: unknown) => d is T }) => Promise<GeminiJsonOutcome<T>>;

export async function generateGymPlan(input: PlanInput, library: Technique[], askJson?: AskJson): Promise<GymPlan> {
  const pool = exercisePool(library, input.equipment);
  if (!pool.length) return { ...templatePlan(input, pool), summary: '이 장비 조건에 맞는 운동이 라이브러리에 없습니다.' };
  const ask = askJson ?? (await import('../userTechniques/geminiJson')).askGeminiForJsonWithGrounding;
  const list = pool.map((t) => `${t.id} | ${t.name} | ${t.gymBodyPart ? GYM_BODY_PART_LABEL[t.gymBodyPart] : ''} | ${(t.gymEquipment ?? []).join('/')} | ${t.gymDifficulty ?? ''} | ${t.gymExerciseKind ?? ''}`).join('\n');
  const r = await ask<RawPlan>({
    systemInstruction: [
      '너는 퍼스널 트레이너다. 회원의 목적·주당 횟수·수준·시간·주의 부위에 맞춰 일주일 헬스 루틴을 짠다.',
      '운동은 반드시 [운동 목록]의 id만 쓴다(목록에 없는 운동은 만들지 않는다). 주의할 부위·통증이 있으면 그 부위에 부담이 큰 운동은 빼고 note에 이유를 적는다.',
      '목적별 일반 원칙: 근력=낮은 반복(3~6)·긴 휴식(120~180초), 근비대=8~12회·60~90초, 체지방 감량·체력=12~15회·짧은 휴식과 유산소 포함, 무술 보강=복합 다관절 운동·코어·폭발력.',
      `weekday는 1(월)~7(일), 정확히 ${input.daysPerWeek}일. 하루 운동 수는 시간에 맞게(약 ${Math.max(3, Math.min(8, Math.round(input.minutes / 10)))}개). 초급자는 고급 운동을 피한다.`,
      '출력(JSON만): {"name":string,"summary":string,"days":[{"weekday":number,"focus":string,"exercises":[{"id":string,"sets":number,"reps":number|null,"seconds":number|null,"restSeconds":number,"note":string|null}]}],"notes":[string]} — 문장은 한국어 존댓말.',
    ].join('\n'),
    contextText: `[운동 목록] id | 이름 | 부위 | 장비 | 난이도 | 유형\n${list}`,
    question: `목적: ${GOAL_LABEL[input.goal]}\n주 ${input.daysPerWeek}회 · 수준: ${LEVEL_LABEL[input.level]} · 장비: ${EQUIPMENT_LABEL[input.equipment]} · 1회 ${input.minutes}분\n주의할 부위/통증: ${input.cautions.trim() || '없음'}`,
    useSearchGrounding: false,
    validate: isRawPlan,
  });
  if (!r.ok) return templatePlan(input, pool);
  const plan = validatePlan(r.data, pool, input.daysPerWeek);
  return plan.days.length ? plan : templatePlan(input, pool);
}

/** Saves the plan as a 헬스 루틴 (optionally the active one, which 오늘의 훈련 loads). */
export async function savePlanAsRoutine(plan: GymPlan, activate: boolean): Promise<GymRoutine> {
  const svc = await import('../gymRoutine/service');
  let routine = svc.createGymRoutine(plan.name);
  for (const d of plan.days) {
    for (const e of d.exercises) {
      routine = svc.addExerciseToDay(routine, d.weekday, {
        techniqueId: e.techniqueId,
        targetSets: e.sets,
        targetReps: Array.from({ length: e.sets }, () => e.reps),
        targetSeconds: e.seconds,
        targetWeightKg: Array.from({ length: e.sets }, () => null), // the lifter sets the load on day one
        restSeconds: e.restSeconds,
      });
    }
  }
  if (activate) svc.setActiveGymRoutine(routine.id);
  return svc.getGymRoutine(routine.id) ?? routine;
}

// ---------- diet

export interface DietTargets {
  calorieGoal: number | null;
  proteinGoalG: number | null;
  carbGoalG: number | null;
  fatGoalG: number | null;
  /** where each number came from, shown to the user */
  basis: string[];
}

/** The user's own 영양 목표 first; protein from body weight (1.6–2.2 g/kg guideline) only when not set. */
export function dietTargets(goal: TrainingGoal, profile: Pick<NutritionProfile, 'calorieGoal' | 'proteinGoalG' | 'carbGoalG' | 'fatGoalG' | 'bodyWeightKg'>): DietTargets {
  const basis: string[] = [];
  let protein = profile.proteinGoalG;
  if (protein != null) basis.push(`단백질 ${protein}g — 영양 목표`);
  else if (profile.bodyWeightKg) {
    const perKg = goal === 'fatloss' ? 2.0 : goal === 'hypertrophy' || goal === 'strength' ? 1.8 : 1.6;
    protein = Math.round(profile.bodyWeightKg * perKg);
    basis.push(`단백질 ${protein}g — 체중 ${profile.bodyWeightKg}kg × ${perKg}g (일반 권장 범위 1.6~2.2g/kg)`);
  }
  if (profile.calorieGoal != null) basis.push(`칼로리 ${profile.calorieGoal}kcal — 영양 목표`);
  else basis.push('칼로리 목표가 없어 AI가 목적에 맞춰 추정합니다 (영양 목표에서 설정하면 그 값을 씁니다)');
  return { calorieGoal: profile.calorieGoal, proteinGoalG: protein ?? null, carbGoalG: profile.carbGoalG, fatGoalG: profile.fatGoalG, basis };
}

export function dietRequest(goal: TrainingGoal, plan: GymPlan | null, profile: Pick<NutritionProfile, 'bodyWeightKg'>): string {
  return [
    `헬스 목적: ${GOAL_LABEL[goal]}.`,
    profile.bodyWeightKg ? `체중 ${profile.bodyWeightKg}kg.` : '',
    plan ? `주 ${plan.days.length}회 웨이트 트레이닝을 합니다.` : '',
    goal === 'fatloss' ? '포만감이 높고 단백질이 충분한 감량 식단으로 짜 주세요.' : goal === 'hypertrophy' ? '운동 전후 탄수화물과 단백질이 충분한 증량 식단으로 짜 주세요.' : '운동 수행을 돕는 균형 잡힌 식단으로 짜 주세요.',
  ]
    .filter(Boolean)
    .join(' ');
}
