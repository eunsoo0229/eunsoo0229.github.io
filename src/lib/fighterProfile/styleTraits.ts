// The fighter profile as COMPARISON DATA for the AI coach — not an answer of its own.
//
// "나와 비슷한 선수", "내 스타일은 얼마나 희귀해?", "내 스타일에 맞는 더블렉 셋업" all need the same thing: what
// the profile says about how this person fights, as a short list of traits with
//   - where each came from (the profile items, the coach's style tags),
//   - whether the user confirmed it,
//   - English words a fight article would use for it (for search and for matching sentences),
//   - which traits are physical (reach, height) — those alone never make two fighters "similar".
// Nothing here prints the profile; the answer decides what to show (사양 §2-2).

import { getProfile } from './store';
import { analyzeStyle } from './style';
import { ALL_FIELDS, fieldOf, formatValue, optionLabel, valueOf } from './catalog';
import type { FighterProfile } from './types';

export type TraitKind = 'style' | 'stance' | 'range' | 'striking' | 'kicking' | 'grappling' | 'defense' | 'movement' | 'physical';

export interface StyleTrait {
  id: string;
  kind: TraitKind;
  /** Korean, as shown to the user. */
  label: string;
  /** English words an article uses for this trait (lower case). Matched in sentences; the first ones go into searches. */
  en: string[];
  /** Profile keys / style tag this came from. */
  basis: string[];
  confirmed: boolean;
}

export interface WeakPoint {
  label: string;
  basis: string;
}

export interface StyleProfile {
  traits: StyleTrait[];
  /** What the profile says is uncomfortable / needs work — from the profile's own answers. */
  weakPoints: WeakPoint[];
  /** Arts the user trains (profile train.arts). */
  arts: string[];
  /** No usable style data at all. */
  empty: boolean;
  /** Profile items answered (all sections). */
  answered: number;
}

const TAG_EN: Record<string, { kind: TraitKind; en: string[] }> = {
  outfighter: { kind: 'range', en: ['out-fighter', 'outfighter', 'outside fighter', 'range fighter', 'long range', 'keeps distance'] },
  infighter: { kind: 'range', en: ['inside fighter', 'in-fighter', 'swarmer', 'close range', 'phone booth'] },
  counter: { kind: 'style', en: ['counter puncher', 'counter striker', 'counter-striker', 'counterpuncher', 'counter-punching', 'counters'] },
  pressure: { kind: 'style', en: ['pressure fighter', 'pressure', 'forward pressure', 'walks down', 'come-forward'] },
  distance: { kind: 'range', en: ['distance management', 'range management', 'manages distance', 'controls distance', 'footwork'] },
  kicker: { kind: 'kicking', en: ['kicker', 'kicking game', 'kicks', 'kickboxing', 'leg kicks', 'body kicks'] },
  boxer: { kind: 'striking', en: ['boxer', 'boxing', 'hands', 'jab', 'combinations'] },
  wrestler: { kind: 'grappling', en: ['wrestler', 'wrestling', 'takedowns', 'double leg', 'single leg'] },
  grappler: { kind: 'grappling', en: ['grappler', 'jiu-jitsu', 'submissions', 'ground game', 'bjj'] },
  switch: { kind: 'stance', en: ['switch hitter', 'switches stance', 'switching stances', 'stance switch', 'switch stance'] },
  clinch: { kind: 'style', en: ['clinch', 'clinch fighter', 'dirty boxing', 'clinch work'] },
  mover: { kind: 'movement', en: ['movement', 'footwork', 'lateral movement', 'mobile'] },
  allround: { kind: 'style', en: ['well-rounded', 'complete fighter', 'mixed martial artist', 'all-around'] },
};

const STANCE_EN: Record<string, { label: string; en: string[] }> = {
  orthodox: { label: '오소독스', en: ['orthodox'] },
  southpaw: { label: '사우스포', en: ['southpaw', 'left-handed stance'] },
  switch: { label: '스위치 스탠스', en: ['switch stance', 'switch hitter', 'switches stance'] },
};

const KICK_EN: Record<string, string[]> = {
  leadRound: ['lead leg kick', 'lead roundhouse'],
  rearRound: ['rear roundhouse', 'roundhouse kick'],
  teep: ['teep', 'front kick', 'push kick'],
  side: ['side kick'],
  low: ['leg kick', 'low kick', 'calf kick'],
  middle: ['body kick', 'middle kick'],
  high: ['head kick', 'high kick'],
};

const ENTRY_EN: Record<string, string[]> = {
  levelChange: ['level change', 'changes levels', 'shoots off strikes'],
  handFight: ['hand fighting', 'hand-fighting'],
  snap: ['snap down', 'fake'],
  counter: ['counter shot', 'counter takedown', 'reactive takedown'],
  clinch: ['clinch takedown', 'body lock'],
};

function str(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)];
}

function opt(key: string, v: string): string {
  const f = fieldOf(key);
  return f ? optionLabel(f, v) : v;
}

function fieldText(p: FighterProfile, key: string): string | null {
  const v = valueOf(p, key);
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return null;
  const f = ALL_FIELDS.find((x) => x.key === key);
  return formatValue(f, v);
}

/** The profile's style data as traits (read only). */
export function styleProfileOf(p: FighterProfile = getProfile()): StyleProfile {
  const traits: StyleTrait[] = [];
  const answered = Object.values(p.items).filter((it) => !it.deletedAt && it.state === 'answered').length;
  // the coach's own tags: the stored analysis when there is one (it may be user-confirmed), else computed from the items
  const stored = p.style?.tags?.length ? p.style : null;
  const analysis = stored ?? (answered ? analyzeStyle(p) : null);
  const confirmed = stored?.status === 'confirmed';
  for (const t of analysis?.tags ?? []) {
    const map = TAG_EN[t.id];
    if (!map) continue;
    traits.push({ id: `tag:${t.id}`, kind: map.kind, label: t.label, en: map.en, basis: t.basis, confirmed });
  }
  const stance = str(valueOf(p, 'body.stance'))[0];
  if (stance && STANCE_EN[stance] && !traits.some((t) => t.kind === 'stance' && stance === 'switch')) {
    traits.push({ id: `stance:${stance}`, kind: 'stance', label: STANCE_EN[stance].label, en: STANCE_EN[stance].en, basis: ['body.stance'], confirmed: true });
  }
  for (const k of str(valueOf(p, 'kick.favorite')).slice(0, 2)) {
    if (KICK_EN[k]) traits.push({ id: `kick:${k}`, kind: 'kicking', label: `${opt('kick.favorite', k)} 선호`, en: KICK_EN[k], basis: ['kick.favorite'], confirmed: true });
  }
  for (const k of str(valueOf(p, 'wr.entry')).slice(0, 2)) {
    if (ENTRY_EN[k]) traits.push({ id: `entry:${k}`, kind: 'grappling', label: `테이크다운 진입: ${opt('wr.entry', k)}`, en: ENTRY_EN[k], basis: ['wr.entry'], confirmed: true });
  }
  const strike = str(valueOf(p, 'mma.strikeStyle'))[0];
  if (strike === 'entry') traits.push({ id: 'mma:strikeToTD', kind: 'grappling', label: '타격을 테이크다운 셋업으로 씀', en: ['strikes to set up takedowns', 'mixes strikes and takedowns', 'level change'], basis: ['mma.strikeStyle'], confirmed: true });
  const reach = valueOf(p, 'body.apeIndex');
  if (typeof reach === 'number' && Math.abs(reach - 1) >= 0.03) {
    traits.push({ id: 'phys:reach', kind: 'physical', label: reach > 1 ? '키 대비 긴 리치' : '키 대비 짧은 리치', en: reach > 1 ? ['long reach', 'reach advantage'] : ['short reach'], basis: ['body.apeIndex'], confirmed: true });
  }

  const weakPoints: WeakPoint[] = [];
  const add = (key: string, prefix: string) => {
    const t = fieldText(p, key);
    if (t) weakPoints.push({ label: `${prefix}: ${t}`, basis: key });
  };
  add('def.uncomfortable', '불편한 방어');
  add('pos.uncomfortable', '불편한 포지션');
  add('train.improve', '본인이 꼽은 개선할 부분');
  if (str(valueOf(p, 'kick.recovery')).includes('unbalanced')) weakPoints.push({ label: '킥 후 균형이 자주 무너짐', basis: 'kick.recovery' });
  if (str(valueOf(p, 'mma.tdAwareness')).includes('little')) weakPoints.push({ label: '타격 중 테이크다운 경계를 별로 못 함', basis: 'mma.tdAwareness' });
  add('move.habits', '무의식적인 습관');

  const uniq = traits.filter((t, i) => traits.findIndex((x) => x.id === t.id) === i);
  return { traits: uniq, weakPoints, arts: str(valueOf(p, 'train.arts')), empty: !uniq.length, answered };
}

/** Traits that describe how someone FIGHTS (physical ones never make a match on their own). */
export const styleOnly = (s: StyleProfile) => s.traits.filter((t) => t.kind !== 'physical');
