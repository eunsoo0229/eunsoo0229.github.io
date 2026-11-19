import type { Technique } from '../../types';
import { ARCHETYPES, motionForTechnique } from './archetypes';
import { listVisualizableTechniques, singleCombo, type MittCombo } from './combos';
import { isTechniqueInArt } from '../techniqueCanonical';

// 종목별 미트 형식 — what the mitt holder calls (공격 지시) and what the
// reaction drill throws depend on the art picked in Visualizing Mitt:
//   입식 타격 (default) → punches + kicks, striking defenses
//   복싱              → punches only, boxing defenses (slip / roll / parry / shoulder roll …)
//   킥복싱 · 무에타이  → punches + kicks (+ knees / elbows in 무에타이), kick checks / catches
//   MMA               → strikes + takedown entries + takedown defense (sprawl / down block)
//   레슬링            → wrestling drills: shots (태클 · 싱글 · 하이 크로치), snap down, level change,
//                       and reacting to the holder's shot (스프롤 · 다운블락 · 점프 스프롤 · 위저)
//   other arts        → that art's own visualizable techniques
// Every call is still a REAL MARTIALDEX technique record (picked per motion
// archetype below) or a real combo (DB / 사용자 공유) made only of allowed motions.

export type DrillRange = 'basic' | 'wide';
export const DRILL_RANGE_LABEL: Record<DrillRange, string> = { basic: '기본 기술', wide: '확장 기술 (더 많은 기술)' };

/** One callable motion: an archetype key, optionally narrowed to a technique name (e.g. "Penetration Step" = 태클) or the body version. */
export type DrillPick = string | { key: string; name?: RegExp; body?: boolean };

export interface DrillProfile {
  id: 'striking' | 'boxing' | 'kickboxing' | 'muay-thai' | 'mma' | 'wrestling' | 'art';
  label: string;
  /** Technique records of this art are preferred when several share a motion. */
  art: string | null;
  /** off = never kicks (복싱 · 레슬링); on/toggle = the 킥 포함 switch starts on/off. */
  kicks: 'off' | 'on' | 'toggle';
  attacks: Record<DrillRange, DrillPick[]>;
  defenses: Record<DrillRange, DrillPick[]>;
  /** 방어 포함 starts on (레슬링: reacting to the shot IS the drill). */
  defenseDefault: boolean;
  /** The reaction drill may call ONE move (the holder shoots → sprawl), not only 2–5 step combos. */
  reactionSingles: boolean;
  /** What the drill is about, shown above the controls. */
  summary: string;
}

const PUNCHES: DrillPick[] = ['jab', 'cross', 'leadHook', 'rearHook', 'leadUppercut', 'rearUppercut', { key: 'jab', body: true }, { key: 'leadHook', body: true }, { key: 'rearHook', body: true }];
const BASIC_KICKS: DrillPick[] = ['lowKick', 'roundKick', 'highKick', 'teep'];
const PUNCH_DEFENSES: DrillPick[] = ['slip', 'slipInside', 'duck', 'roll', 'leanBack', 'parry', 'catchPunch', 'block', 'cover'];
const WIDE_PUNCH_DEFENSES: DrillPick[] = ['doubleSlip', 'pull', 'sideStep', 'angleOut', 'leadParry', 'downParry', 'elbowBlock', 'shoulderRoll', 'leadHandTrap', 'paw', 'guardPullDown'];
const KICK_DEFENSES: DrillPick[] = ['check', 'kickCatch'];
const SHOT_DEFENSES: DrillPick[] = ['sprawl', 'downBlock'];

const PROFILES: Record<Exclude<DrillProfile['id'], 'art'>, DrillProfile> = {
  striking: {
    id: 'striking',
    label: '입식 타격',
    art: null,
    kicks: 'toggle',
    attacks: { basic: [...PUNCHES, ...BASIC_KICKS], wide: ['overhand', 'superman', 'backfist', 'spinBackfist', 'checkHook', 'leadLowKick', 'leadRoundKick', 'switchKick', 'rearTeep', 'questionMark', 'sideKick', 'backKick', 'obliqueKick', 'axeKick', 'rearKnee', 'leadKnee', 'flyingKnee'] },
    defenses: { basic: [...PUNCH_DEFENSES, ...KICK_DEFENSES], wide: [...WIDE_PUNCH_DEFENSES, 'teepCatch', 'kickParry'] },
    defenseDefault: false,
    reactionSingles: false,
    summary: '펀치·킥 위주의 입식 타격 미트입니다.',
  },
  boxing: {
    id: 'boxing',
    label: '복싱',
    art: 'boxing',
    kicks: 'off',
    attacks: { basic: PUNCHES, wide: ['overhand', 'leadOverhand', 'checkHook', 'bolo', 'corkscrew', 'gazelle', { key: 'leadUppercut', body: true }, { key: 'rearUppercut', body: true }, { key: 'cross', body: true }] },
    defenses: { basic: PUNCH_DEFENSES, wide: [...WIDE_PUNCH_DEFENSES.filter((k) => k !== 'guardPullDown'), 'rearHandTrap'] },
    defenseDefault: false,
    reactionSingles: false,
    summary: '펀치만 부릅니다 (킥 없음). 방어를 켜면 슬립·롤·패리·숄더 롤 같은 복싱 방어 뒤 카운터가 나옵니다.',
  },
  kickboxing: {
    id: 'kickboxing',
    label: '킥복싱',
    art: 'kickboxing',
    kicks: 'on',
    attacks: { basic: [...PUNCHES, ...BASIC_KICKS, 'leadLowKick'], wide: ['switchKick', 'questionMark', 'leadRoundKick', 'rearTeep', 'spinBackfist', 'superman', 'overhand', 'checkHook', 'sideKick', 'backKick', 'axeKick', 'spinHookKick', 'rearKnee', 'leadKnee', 'flyingKnee'] },
    defenses: { basic: [...PUNCH_DEFENSES, ...KICK_DEFENSES], wide: [...WIDE_PUNCH_DEFENSES, 'teepCatch', 'kickParry'] },
    defenseDefault: false,
    reactionSingles: false,
    summary: '펀치와 킥을 섞어 부릅니다. 방어를 켜면 체크·킥 캐치도 나옵니다.',
  },
  'muay-thai': {
    id: 'muay-thai',
    label: '무에타이',
    art: 'muay-thai',
    kicks: 'on',
    attacks: { basic: [...PUNCHES, ...BASIC_KICKS, 'rearKnee', 'hElbow'], wide: ['leadRoundKick', 'switchKick', 'rearTeep', 'leadKnee', 'sideKnee', 'flyingKnee', 'upElbow', 'downElbow', 'spinElbow', 'spearElbow', 'superman', 'spinBackfist', 'leadLowKick'] },
    defenses: { basic: [...PUNCH_DEFENSES.filter((k) => k !== 'roll'), 'check', 'teepCatch', 'kickCatch'], wide: ['roll', 'kickParry', 'elbowBlock', 'pull', 'leadParry', 'guardPullDown', 'paw'] },
    defenseDefault: false,
    reactionSingles: false,
    summary: '펀치·킥에 니킥·엘보까지 부릅니다. 방어를 켜면 체크·팁 캐치·킥 캐치가 나옵니다.',
  },
  mma: {
    id: 'mma',
    label: 'MMA',
    art: 'mixed-martial-arts',
    kicks: 'on',
    attacks: {
      basic: [...PUNCHES, 'overhand', 'lowKick', 'roundKick', 'teep', 'doubleLeg', 'singleLeg', 'levelFeint'],
      wide: ['superman', 'spinBackfist', 'obliqueKick', 'highKick', 'switchKick', 'questionMark', 'rearKnee', 'flyingKnee', 'hElbow', 'checkHook', 'highCrotch', 'bodyLock', 'anklePick', 'kneeTap', 'snapDown', 'duckUnder', 'outsideTrip'],
    },
    defenses: { basic: ['slip', 'duck', 'roll', 'parry', 'block', 'cover', 'check', ...SHOT_DEFENSES], wide: ['slipInside', 'leanBack', 'pull', 'shoulderRoll', 'kickCatch', 'jumpSprawl', 'whizzer', 'angleOut'] },
    defenseDefault: false,
    reactionSingles: false,
    summary: '타격과 테이크다운을 섞어 부릅니다 (원투 → 더블렉 같은 타격→태클 연결 포함). 방어를 켜면 코치가 태클을 들어올 때 스프롤·다운블락도 나옵니다.',
  },
  wrestling: {
    id: 'wrestling',
    label: '레슬링',
    art: 'wrestling',
    kicks: 'off',
    attacks: {
      basic: [{ key: 'doubleLeg', name: /penetration step/i }, { key: 'doubleLeg', name: /^basic double leg$/i }, { key: 'singleLeg', name: /high single/i }, 'highCrotch', 'snapDown', { key: 'levelFeint', name: /^level change$/i }, { key: 'levelFeint', name: /fake shot/i }],
      wide: [{ key: 'doubleLeg', name: /blast double/i }, { key: 'singleLeg', name: /sweep single/i }, 'anklePick', 'goBehind', 'kneeTap', 'duckUnder', 'armDrag', 'bodyLock', 'outsideTrip', 'insideTrip', 'lateralDrop', 'firemansCarry'],
    },
    defenses: { basic: ['sprawl', 'downBlock', 'jumpSprawl', 'whizzer'], wide: [] },
    defenseDefault: true,
    reactionSingles: true,
    summary: '레슬링 드릴: 태클(페네트레이션)·싱글·하이 크로치·스냅 다운·레벨 체인지를 부르고, 코치가 슛을 들어오면 스프롤·다운블락·점프 스프롤·위저로 막습니다. 타격은 없습니다.',
  },
};

const STYLE_BY_ART: Record<string, keyof typeof PROFILES> = { boxing: 'boxing', kickboxing: 'kickboxing', 'muay-thai': 'muay-thai', 'mixed-martial-arts': 'mma', wrestling: 'wrestling' };

const keyOf = (p: DrillPick) => (typeof p === 'string' ? p : p.key);
const isKickKey = (k: string) => ARCHETYPES[k]?.limb === 'foot' || ARCHETYPES[k]?.limb === 'knee';

/** Any other art: its own visualizable motions, split into attacks and defenses (the wide range = all of them). */
function artProfile(art: string, techniques: Technique[]): DrillProfile {
  const keys = new Map<string, number>();
  for (const t of techniques) {
    if (!isTechniqueInArt(t, art)) continue;
    const k = motionForTechnique(t)?.archetype.key;
    if (k) keys.set(k, (keys.get(k) ?? 0) + 1);
  }
  const all = [...keys.keys()];
  const attacks = all.filter((k) => ARCHETYPES[k].kind !== 'defense' && ARCHETYPES[k].kind !== 'trap');
  const defenses = all.filter((k) => ARCHETYPES[k].kind === 'defense' || ARCHETYPES[k].kind === 'trap');
  // basic = the motions this art records most often
  const top = [...attacks].sort((a, b) => (keys.get(b) ?? 0) - (keys.get(a) ?? 0));
  const basic = top.slice(0, 10);
  return {
    id: 'art',
    label: art,
    art,
    kicks: attacks.some(isKickKey) && attacks.some((k) => !isKickKey(k)) ? 'on' : 'off',
    attacks: { basic, wide: top.slice(10) },
    defenses: { basic: defenses, wide: [] },
    defenseDefault: false,
    reactionSingles: !attacks.some((k) => ARCHETYPES[k].kind === 'strike'),
    summary: '이 무술에 등록된 기술 중 미트로 그릴 수 있는 동작만 부릅니다.',
  };
}

/** The drill profile for the art picked in Visualizing Mitt ('' = 전체 → 입식 타격). */
export function drillProfile(art: string | null | undefined, techniques: Technique[] = listVisualizableTechniques()): DrillProfile {
  if (!art) return PROFILES.striking;
  const style = STYLE_BY_ART[art];
  return style ? PROFILES[style] : artProfile(art, techniques);
}

export interface DrillOptions {
  range: DrillRange;
  withKicks: boolean;
  withDefense: boolean;
}

function picksFor(list: Record<DrillRange, DrillPick[]>, profile: DrillProfile, o: Pick<DrillOptions, 'range' | 'withKicks'>): DrillPick[] {
  const picks = o.range === 'wide' ? [...list.basic, ...list.wide] : list.basic;
  const kicks = profile.kicks !== 'off' && o.withKicks;
  return picks.filter((p) => kicks || !isKickKey(keyOf(p)));
}

/** Motion keys a called combo may contain (attacks, plus defenses when they are on). */
export function allowedKeys(profile: DrillProfile, o: DrillOptions): Set<string> {
  const keys = picksFor(profile.attacks, profile, o).map(keyOf);
  if (o.withDefense) keys.push(...picksFor(profile.defenses, profile, o).map(keyOf));
  return new Set(keys);
}

// Where a technique of each kind is most likely recorded under its plain name.
const PREFERRED_ART: Record<string, string[]> = { hand: ['boxing', 'kickboxing', 'muay-thai'], foot: ['kickboxing', 'muay-thai', 'mixed-martial-arts'], knee: ['muay-thai', 'kickboxing'], elbow: ['muay-thai'], body: ['wrestling', 'mixed-martial-arts', 'judo'] };

/** The one real technique record a pick stands for (null = the DB has none). */
export function techniqueForPick(pick: DrillPick, profile: DrillProfile, techniques: Technique[]): Technique | null {
  const p = typeof pick === 'string' ? { key: pick } : pick;
  const hits = techniques.filter((t) => {
    const m = motionForTechnique(t);
    if (m?.archetype.key !== p.key) return false;
    if (p.name && ![t.name, ...(t.aliases ?? [])].some((n) => p.name!.test(n))) return false;
    return p.body ? m.target === 'body' : m.target === m.archetype.target;
  });
  if (!hits.length) return null;
  const limb = ARCHETYPES[p.key].limb;
  const order = [...(profile.art ? [profile.art] : []), ...(PREFERRED_ART[limb] ?? [])];
  const rank = (t: Technique) => {
    const i = order.findIndex((a) => isTechniqueInArt(t, a));
    return i < 0 ? 99 : i;
  };
  return [...hits].sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)[0];
}

function singlesFor(picks: DrillPick[], profile: DrillProfile, techniques: Technique[]): MittCombo[] {
  const out: MittCombo[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const t = techniqueForPick(p, profile, techniques);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    const c = singleCombo(t.id);
    if (c) out.push(c);
  }
  return out;
}

/** One real technique per callable attack of this profile. */
export function attackSingles(profile: DrillProfile, o: Pick<DrillOptions, 'range' | 'withKicks'>, techniques: Technique[] = listVisualizableTechniques()): MittCombo[] {
  return singlesFor(picksFor(profile.attacks, profile, o), profile, techniques);
}

/** One real technique per defense of this profile (the holder attacks, you answer). */
export function defenseSingles(profile: DrillProfile, o: Pick<DrillOptions, 'range' | 'withKicks'>, techniques: Technique[] = listVisualizableTechniques()): MittCombo[] {
  return singlesFor(picksFor(profile.defenses, profile, o), profile, techniques);
}

/** Combos (DB records, 사용자 공유 콤보) whose every step is an allowed motion of this profile. */
export function combosFor(profile: DrillProfile, o: DrillOptions, combos: MittCombo[], minSteps = 2, maxSteps = 5): MittCombo[] {
  const keys = allowedKeys(profile, o);
  return combos.filter((c) => c.steps.length >= minSteps && c.steps.length <= maxSteps && c.steps.every((s) => keys.has(s.motion.archetype.key)));
}
