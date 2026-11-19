import { arts, valueOf } from './catalog';
import type { FighterProfile, StyleAnalysis, StyleTag } from './types';

// 개인 전투 스타일 — concluded from the user's own answers by fixed rules
// (every tag names the answers it came from), so it is reproducible and never
// a model's impression. Several styles can coexist; it is shown as
// unconfirmed until the user says it fits.

const has = (p: FighterProfile, key: string, ...vals: string[]) => {
  const v = valueOf(p, key);
  return Array.isArray(v) ? v.some((x) => vals.includes(x)) : v !== null && vals.includes(String(v));
};
const answered = (p: FighterProfile, key: string) => valueOf(p, key) !== null;
const list = (p: FighterProfile, key: string) => {
  const v = valueOf(p, key);
  return Array.isArray(v) ? v : [];
};

interface Rule {
  id: string;
  label: string;
  checks: [string, (p: FighterProfile) => boolean][];
}

const STYLES: Rule[] = [
  { id: 'outfighter', label: '아웃파이터', checks: [['box.preferredRange', (p) => has(p, 'box.preferredRange', 'long')], ['move.backward', (p) => has(p, 'move.backward', 'often')], ['def.main', (p) => has(p, 'def.main', 'backstep', 'distance', 'longGuard')], ['kick.favorite', (p) => has(p, 'kick.favorite', 'teep', 'side')]] },
  { id: 'infighter', label: '인파이터', checks: [['box.preferredRange', (p) => has(p, 'box.preferredRange', 'close')], ['move.forward', (p) => has(p, 'move.forward', 'often')], ['box.favoritePunches', (p) => has(p, 'box.favoritePunches', 'leadHook', 'rearHook', 'uppercut', 'body')], ['def.main', (p) => has(p, 'def.main', 'peekaboo', 'weave', 'roll', 'shell')]] },
  { id: 'counter', label: '카운터 파이터', checks: [['box.counter', (p) => has(p, 'box.counter', 'often')], ['move.counterAfterDefense', (p) => has(p, 'move.counterAfterDefense', 'often')], ['def.main', (p) => has(p, 'def.main', 'counter', 'bait', 'parry')], ['mma.strikeStyle', (p) => has(p, 'mma.strikeStyle', 'counter')]] },
  { id: 'pressure', label: '압박형 파이터', checks: [['move.forward', (p) => has(p, 'move.forward', 'often')], ['move.pressure', (p) => answered(p, 'move.pressure')], ['box.afterAttack', (p) => has(p, 'box.afterAttack', 'press')]] },
  { id: 'distance', label: '거리 조절형 파이터', checks: [['box.preferredRange', (p) => has(p, 'box.preferredRange', 'long', 'varies')], ['move.distance', (p) => answered(p, 'move.distance')], ['def.main', (p) => has(p, 'def.main', 'distance', 'backstep', 'sidestep')], ['box.afterAttack', (p) => has(p, 'box.afterAttack', 'back', 'angle')]] },
  { id: 'kicker', label: '킥 중심형', checks: [['kick.favorite', (p) => list(p, 'kick.favorite').length >= 2], ['mma.strikeStyle', (p) => has(p, 'mma.strikeStyle', 'kicking')], ['kick.middleKick', (p) => has(p, 'kick.middleKick', 'favorite') || has(p, 'kick.lowKick', 'favorite')], ['kick.switchKick', (p) => has(p, 'kick.switchKick', 'often')]] },
  { id: 'boxer', label: '복싱 중심형', checks: [['box.favoritePunches', (p) => list(p, 'box.favoritePunches').length >= 2], ['mma.strikeStyle', (p) => has(p, 'mma.strikeStyle', 'boxing')], ['train.arts', (p) => arts(p).includes('boxing')]] },
  { id: 'wrestler', label: '레슬링 중심형', checks: [['wr.single', (p) => has(p, 'wr.single', 'favorite') || has(p, 'wr.double', 'favorite')], ['train.arts', (p) => arts(p).includes('wrestling')], ['mma.strikeStyle', (p) => has(p, 'mma.strikeStyle', 'entry')], ['mmag.cageWrestling', (p) => has(p, 'mmag.cageWrestling', 'high')]] },
  { id: 'grappler', label: '그래플링 중심형', checks: [['train.arts', (p) => arts(p).some((a) => ['bjj', 'judo', 'sambo'].includes(a))], ['bjj.subs', (p) => list(p, 'bjj.subs').length >= 2], ['pos.comfortable', (p) => list(p, 'pos.comfortable').length >= 1], ['mmag.topControl', (p) => has(p, 'mmag.topControl', 'high')]] },
  { id: 'switch', label: '스위치 히터', checks: [['body.stanceSwitch', (p) => has(p, 'body.stanceSwitch', 'often')], ['body.stance', (p) => has(p, 'body.stance', 'switch')], ['body.switchPurpose', (p) => has(p, 'body.switchPurpose', 'angle', 'confuse', 'power')]] },
  { id: 'clinch', label: '클린치 중심형', checks: [['mma.clinchEntry', (p) => has(p, 'mma.clinchEntry', 'often')], ['pos.comfortable', (p) => has(p, 'pos.comfortable', 'clinch', 'cageTop')], ['box.afterAttack', (p) => has(p, 'box.afterAttack', 'clinch')]] },
  { id: 'mover', label: '움직임 중심형', checks: [['move.circle', (p) => has(p, 'move.circle', 'often')], ['move.pivot', (p) => has(p, 'move.pivot', 'often')], ['move.lateral', (p) => has(p, 'move.lateral', 'left', 'right', 'both')], ['def.main', (p) => has(p, 'def.main', 'sidestep')]] },
];

/** Concrete tendencies worth carrying into lessons (each names its source answers). */
function tendencies(p: FighterProfile): StyleTag[] {
  const out: StyleTag[] = [];
  const add = (id: string, label: string, basis: string[]) => out.push({ id, label, role: 'tendency', basis });
  if (has(p, 'kick.favorite', 'leadRound', 'teep', 'side') || has(p, 'kick.switchKick', 'often')) add('leadKick', '타격 성향: 앞발 킥 활용', ['kick.favorite', 'kick.switchKick']);
  if (has(p, 'wr.single', 'favorite')) {
    const dir = valueOf(p, 'wr.direction');
    add('single', `그래플링 성향: 싱글렉 선호${dir === 'oppRight' ? ' (상대 오른다리)' : dir === 'oppLeft' ? ' (상대 왼다리)' : ''}`, ['wr.single', 'wr.direction']);
  }
  const bottomExit = Object.keys(p.items).filter((k) => /^pos\.(\w+Bottom|cageBottom)\.exit$/.test(k) && has(p, k, 'transition', 'sweep', 'escape'));
  if (bottomExit.length) add('bottomExit', '포지션 성향: 바텀에서 탈출·전환 선호', bottomExit);
  if (has(p, 'bjj.topBottom', 'top')) add('top', '포지션 성향: 탑 선호', ['bjj.topBottom']);
  if (has(p, 'bjj.topBottom', 'bottom')) add('guard', '포지션 성향: 가드(바텀) 선호', ['bjj.topBottom']);
  if (has(p, 'box.feints', 'often') || has(p, 'kick.feints', 'often')) add('feint', '타격 성향: 페인트 활용', ['box.feints', 'kick.feints']);
  return out;
}

export function analyzeStyle(p: FighterProfile): StyleAnalysis {
  const scored = STYLES.map((r) => {
    const hit = r.checks.filter(([, f]) => f(p)).map(([k]) => k);
    return { r, hit };
  })
    .filter((x) => x.hit.length >= 2)
    .sort((a, b) => b.hit.length - a.hit.length);
  const tags: StyleTag[] = scored.slice(0, 3).map((x, i) => ({ id: x.r.id, label: x.r.label, role: i === 0 ? 'primary' : 'secondary', basis: [...new Set(x.hit)] }));
  const striking = scored.some((x) => ['boxer', 'kicker', 'outfighter', 'infighter'].includes(x.r.id));
  const grappling = scored.some((x) => ['wrestler', 'grappler'].includes(x.r.id));
  if (striking && grappling && !tags.some((t) => t.id === 'allround')) tags.push({ id: 'allround', label: '올라운더', role: 'secondary', basis: ['train.arts'] });
  const at = new Date().toISOString();
  return { tags: [...tags, ...tendencies(p)], source: 'coach_inferred', status: 'unconfirmed', analyzedAt: at, confirmedAt: null, updatedAt: at };
}
