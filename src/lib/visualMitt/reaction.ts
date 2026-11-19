import { wrestlingChains } from './wrestlingChains';
import type { MittCombo, MittStep } from './combos';
import { listDbCombos } from './combos';
import { attackSingles, combosFor, defenseSingles, type DrillOptions, type DrillProfile } from './artDrills';
import { recordTrainingSession } from '../trainingHistory/service';
import { kickExtraMs, tempoLabel } from './tempo';

// 반응 훈련 — the coach calls out a REAL combo picked at random (no fixed
// order to memorise) and the user throws it on reaction. Only combos that
// exist in MARTIALDEX (technique-DB combination records, published by the
// operator account as 사용자 콤보) are called, and only those made entirely of
// the basic attacks below — no spinning, flashy or rule-specific techniques.

/** Basic attacks allowed in a called combo (motion archetype keys). */
export const BASIC_ATTACKS = new Set([
  'jab', 'cross', 'leadHook', 'rearHook', 'leadUppercut', 'rearUppercut', // punches (body versions included — the step's target says body)
  'lowKick', 'leadLowKick', 'roundKick', 'highKick', 'teep', 'rearTeep', // calf / low / middle / high kicks, teeps
  'doubleLeg', 'singleLeg', // takedown entries
]);

const isCalf = (s: MittStep) => /calf|카프/i.test(`${s.technique.name} ${s.technique.koreanName ?? ''}`);

/** What the coach SAYS for one step — short, the words a coach shouts on pads. */
/** Coach words for defense / guard-control steps (the holder throws, you answer). */
const DEFENSE_CALL: Record<string, string> = {
  slip: '슬립', slipInside: '안쪽 슬립', doubleSlip: '더블 슬립', duck: '더킹', roll: '롤', leanBack: '스웨이', pull: '빼고', sideStep: '사이드 스텝', angleOut: '피벗',
  parry: '패리', leadParry: '앞손 패리', downParry: '아래 패리', catchPunch: '캐치', block: '블록', cover: '커버', elbowBlock: '엘보 블록', shoulderRoll: '숄더 롤',
  check: '체크', kickCatch: '킥 캐치', teepCatch: '팁 캐치', kickParry: '킥 패리',
  leadHandTrap: '앞손 트랩', rearHandTrap: '뒷손 트랩', paw: '포', guardPullDown: '가드 내려',
  sprawl: '스프롤', downBlock: '다운블락', jumpSprawl: '점프 스프롤', whizzer: '위저',
};

/** Coach words for the wider range of attacks (the holder shouts these on pads). */
const ATTACK_CALL: Record<string, string> = {
  overhand: '오버핸드', leadOverhand: '앞손 오버핸드', superman: '슈퍼맨', backfist: '백피스트', spinBackfist: '스피닝 백피스트', checkHook: '체크 훅', bolo: '볼로', corkscrew: '코크스크루', gazelle: '가젤 펀치',
  frontKick: '앞차기', leadRoundKick: '앞발 미들', switchKick: '스위치 킥', stepUpKick: '스텝업 킥', questionMark: '퀘스천 마크', sideKick: '사이드킥', backKick: '백킥', axeKick: '내려차기', obliqueKick: '오블리크',
  hookKick: '훅킥', spinHookKick: '스피닝 훅킥', crescentKick: '반달차기',
  rearKnee: '니', leadKnee: '앞 니', flyingKnee: '플라잉 니', sideKnee: '옆 니', spinKnee: '스피닝 니',
  hElbow: '엘보', upElbow: '올려 엘보', downElbow: '내려 엘보', spinElbow: '스피닝 엘보', spearElbow: '찌르는 엘보',
  handFeint: '페인트', kickFeint: '킥 페인트',
  highCrotch: '하이 크로치', snapDown: '스냅 다운', kneeTap: '니 탭', anklePick: '앵클 픽', duckUnder: '덕 언더', armDrag: '암 드래그', goBehind: '고 비하인드',
  bodyLock: '바디락', outsideTrip: '아웃사이드 트립', insideTrip: '인사이드 트립', lateralDrop: '래터럴 드롭', firemansCarry: '파이어맨 캐리', kosotoGari: '아웃사이드 트립',
};

export function calloutFor(s: MittStep): string {
  const def = DEFENSE_CALL[s.motion.archetype.key];
  if (def) return def;
  const body = s.motion.target === 'body' && s.motion.archetype.limb === 'hand' ? '바디 ' : '';
  switch (s.motion.archetype.key) {
    case 'jab': return `${body}잽`;
    case 'cross': return `${body}크로스`;
    case 'leadHook': return `${body}훅`;
    case 'rearHook': return `${body}뒷손 훅`;
    case 'leadUppercut': return `${body}어퍼`;
    case 'rearUppercut': return `${body}뒷손 어퍼`;
    case 'lowKick': return isCalf(s) ? '카프킥' : '로우킥';
    case 'leadLowKick': return isCalf(s) ? '앞발 카프킥' : '앞발 로우킥';
    case 'roundKick': return '미들킥';
    case 'highKick': return '하이킥';
    case 'teep': return '앞발 팁';
    case 'rearTeep': return '뒷발 팁';
    case 'doubleLeg': return /penetration|tackle|태클/i.test(s.technique.name) ? '태클' : /blast/i.test(s.technique.name) ? '블래스트 더블' : '더블렉';
    case 'singleLeg': return '싱글렉';
    case 'levelFeint': return /fake shot/i.test(s.technique.name) ? '페이크 슛' : '레벨 체인지';
    default: return ATTACK_CALL[s.motion.archetype.key] ?? s.technique.koreanName ?? s.technique.name;
  }
}

export function comboCallout(c: MittCombo): string {
  return c.steps.map(calloutFor).join(', ');
}

/** Every real combo the reaction drill may call: DB combos of basic attacks only, 2–5 steps. */
export function reactionPool(): MittCombo[] {
  return listDbCombos().filter((c) => c.steps.length >= 2 && c.steps.length <= 5 && c.steps.every((s) => BASIC_ATTACKS.has(s.motion.archetype.key)));
}

/**
 * The reaction drill's pool for the art picked (종목별): real combos (DB records + 사용자 공유 콤보
 * passed in `extra`) made only of that art's allowed motions — and, for arts where reacting to
 * ONE move is the drill (레슬링: the holder shoots → sprawl), single moves too.
 */
export function reactionPoolFor(profile: DrillProfile, o: DrillOptions, extra: MittCombo[] = []): MittCombo[] {
  const combos = combosFor(profile, o, [...listDbCombos(), ...extra]);
  if (!profile.reactionSingles) return combos;
  // 레슬링: long call-and-move chains too (태클 → 스프롤 → 다운블락 → 태클) — wrestlingChains.ts
  return [...attackSingles(profile, o), ...(o.withDefense ? defenseSingles(profile, o) : []), ...combos, ...wrestlingChains(profile, o)];
}

export type ReactionPace = 'slow' | 'normal' | 'fast';
/** Seconds per strike while the user throws it, and the recovery pause before the next call. */
export const REACTION_PACE: Record<ReactionPace, { label: string; perStep: number; rest: number }> = {
  slow: { label: '천천히', perStep: 1.1, rest: 2.6 },
  normal: { label: '보통', perStep: 0.8, rest: 1.8 },
  fast: { label: '빠르게', perStep: 0.55, rest: 1.1 },
};

/** What a call sounds like — two DB records with the same strikes (e.g. 킥복싱 and 무에타이 "Cross → Middle Kick") are the same call. */
const callSignature = (c: MittCombo) => c.steps.map((s) => `${s.motion.archetype.key}@${s.motion.target}`).join('+');

/** Random pick that never repeats the previous combo — nor a different record that would be called the same (when there is a choice). */
export function pickNext(pool: MittCombo[], previous: MittCombo | null, random: () => number = Math.random): MittCombo | null {
  if (!pool.length) return null;
  const sig = previous ? callSignature(previous) : null;
  const fresh = pool.filter((c) => c.id !== previous?.id && callSignature(c) !== sig);
  const choices = fresh.length ? fresh : pool.length > 1 ? pool.filter((c) => c.id !== previous?.id) : pool;
  return choices[Math.floor(random() * choices.length)] ?? choices[0];
}

/** One strike's slot on screen at this tempo (kicks/shots a little longer). */
export function reactionSlotMs(s: MittCombo['steps'][number], stepMs: number): number {
  return stepMs + (s.motion.archetype.limb === 'hand' ? 0 : kickExtraMs(stepMs));
}


/** One reaction round → one training_history entry (what was CALLED and for how long — self-reported, nothing measured). */
export function recordReactionSession(input: { called: MittCombo[]; seconds: number; finished: boolean; stepMs: number }) {
  if (!input.called.length || input.seconds < 5) return null;
  const ids = [...new Set(input.called.flatMap((c) => c.steps.map((s) => s.techniqueId)))];
  const minutes = Math.max(1, Math.round(input.seconds / 60));
  return recordTrainingSession({
    curriculumId: null,
    dayNumber: null,
    techniqueIds: ids,
    completed: input.finished,
    estimatedMinutes: minutes,
    actualMinutes: minutes,
    notes: `AI Visualizing Mitt · 반응 훈련 · 무작위 콤보 ${input.called.length}개 (${tempoLabel(input.stepMs)} · 기술 간격 ${(input.stepMs / 1000).toFixed(2)}초) — 사용자 수행 기록, 동작 측정 아님`,
    source: 'visual_mitt',
    visualMitt: {
      comboId: null,
      comboName: `반응 훈련 (무작위 콤보 ${input.called.length}개)`,
      stepTechniqueIds: input.called.flatMap((c) => c.steps.map((s) => s.techniqueId)),
      completedSteps: [],
      repetitions: input.called.length,
      stance: 'orthodox',
      selfReported: true,
    },
  });
}
