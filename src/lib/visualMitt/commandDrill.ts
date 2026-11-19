import { wrestlingChains } from './wrestlingChains';
import { listDbCombos, type MittCombo } from './combos';
import { attackSingles, combosFor, defenseSingles, type DrillOptions, type DrillProfile } from './artDrills';
import { calloutFor, comboCallout } from './reaction';
import { kickExtraMs, restMsFor, tempoLabel, type MittTempo } from './tempo';
import { recordTrainingSession } from '../trainingHistory/service';

// 공격 지시 (pad-holder calls) — the mitt holder shouts what to throw ("잽!",
// "원투!", "훅!") at random moments and presents the mitt for it; the user
// throws on the call. Calls are real MARTIALDEX techniques or real combos (DB
// records, 사용자 공유 콤보) made only of the motions of the art picked — see artDrills.ts.
// Nothing watches the user — what was called and for how long is recorded.

export type CommandLevel = 'single' | 'mixed' | 'combo';
export const COMMAND_LEVEL_LABEL: Record<CommandLevel, string> = { single: '단타', mixed: '단타 + 콤보', combo: '콤보' };

const DEFENSE_EXTRA_MS = 600;

export interface CommandPoolOptions extends DrillOptions {
  profile: DrillProfile;
  /** 사용자 공유 콤보 the mitt can play as written (added to the DB combos). */
  extra?: MittCombo[];
}

/**
 * Everything that may be called at this level, for the art picked (종목별 형식): single attacks of that art,
 * real combos made only of its allowed motions, and — with 방어 포함 — its defenses and defense → counter combos.
 */
export function commandPool(level: CommandLevel, o: CommandPoolOptions): MittCombo[] {
  const all = [...listDbCombos(), ...(o.extra ?? [])];
  const singles = level === 'combo' ? [] : attackSingles(o.profile, o);
  const combos = level === 'single' ? [] : combosFor(o.profile, { ...o, withDefense: false }, all, 2, 5);
  const defense = !o.withDefense
    ? []
    : [...(level === 'combo' ? [] : defenseSingles(o.profile, o)), ...(level === 'single' ? [] : combosFor(o.profile, o, all, 2, 4).filter((c) => c.steps.some((s) => s.motion.archetype.kind === 'defense' || s.motion.archetype.kind === 'trap')))];
  // 레슬링: long chains of shots and answers to the holder's shot (wrestlingChains.ts)
  const chains = level === 'single' ? [] : wrestlingChains(o.profile, o);
  return [...singles, ...combos, ...defense, ...chains];
}

const isHead = (c: MittCombo) => c.steps.every((s) => s.motion.target === 'head');
const keysOf = (c: MittCombo) => c.steps.map((s) => s.motion.archetype.key).join('+');
// The short words pad holders actually shout for the most common punch sequences.
const SHORTHAND: Record<string, string> = { 'jab+jab': '더블 잽', 'jab+cross': '원투', 'jab+cross+leadHook': '원투 훅', 'jab+cross+leadHook+cross': '원투 훅 투' };

/** What the holder shouts for one call. */
export function commandCallout(c: MittCombo): string {
  if (isHead(c) && SHORTHAND[keysOf(c)]) return SHORTHAND[keysOf(c)];
  return c.steps.length === 1 ? calloutFor(c.steps[0]) : comboCallout(c);
}

type Tempo = Pick<MittTempo, 'stepMs' | 'callGapMs'>;

/** Timing of one call: call → mitt gap (the reaction window), one slot per strike (kicks a little longer), then recovery. */
export function commandTiming(c: MittCombo, tempo: Tempo): { reactMs: number; slots: number[]; restMs: number; totalMs: number } {
  // a defense step needs the holder's attack to be SEEN coming (MittStage draws it ~2.4× slower)
  const slots = c.steps.map((s) => tempo.stepMs + (s.motion.archetype.kind === 'defense' || s.motion.archetype.kind === 'trap' ? DEFENSE_EXTRA_MS : s.motion.archetype.limb === 'hand' ? 0 : kickExtraMs(tempo.stepMs)));
  const restMs = restMsFor(tempo.stepMs);
  return { reactMs: tempo.callGapMs, slots, restMs, totalMs: tempo.callGapMs + slots.reduce((a, b) => a + b, 0) + restMs };
}

/** Where `ms` (since the call) falls: which strike is on screen and how far into its slot; null slot = reaction window or recovery. */
export function commandPhase(c: MittCombo, tempo: Tempo, ms: number): { phase: 'react' | 'strike' | 'rest'; step: number; local: number } {
  const { reactMs, slots } = commandTiming(c, tempo);
  if (ms < reactMs) return { phase: 'react', step: 0, local: 0 };
  let t = ms - reactMs;
  for (let i = 0; i < slots.length; i++) {
    if (t < slots[i]) return { phase: 'strike', step: i, local: t };
    t -= slots[i];
  }
  return { phase: 'rest', step: slots.length - 1, local: t };
}

/** One round → one training_history entry (what was CALLED — self-reported, nothing measured). */
export function recordCommandSession(input: { called: MittCombo[]; seconds: number; finished: boolean; stepMs: number; level: CommandLevel }) {
  if (!input.called.length || input.seconds < 5) return null;
  const ids = [...new Set(input.called.flatMap((c) => c.steps.map((s) => s.techniqueId)))];
  const minutes = Math.max(1, Math.round(input.seconds / 60));
  const strikes = input.called.reduce((n, c) => n + c.steps.length, 0);
  return recordTrainingSession({
    curriculumId: null,
    dayNumber: null,
    techniqueIds: ids,
    completed: input.finished,
    estimatedMinutes: minutes,
    actualMinutes: minutes,
    notes: `AI Visualizing Mitt · 공격 지시 (${COMMAND_LEVEL_LABEL[input.level]}, ${tempoLabel(input.stepMs)} · 기술 간격 ${(input.stepMs / 1000).toFixed(2)}초) · 지시 ${input.called.length}번 · 타격 ${strikes}회 — 사용자 수행 기록, 동작 측정 아님`,
    source: 'visual_mitt',
    visualMitt: {
      comboId: null,
      comboName: `공격 지시 (${input.called.length}번)`,
      stepTechniqueIds: input.called.flatMap((c) => c.steps.map((s) => s.techniqueId)),
      completedSteps: [],
      repetitions: input.called.length,
      stance: 'orthodox',
      selfReported: true,
    },
  });
}
