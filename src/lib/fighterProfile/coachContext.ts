import { getTechnique } from '../loadData';
import { listTrainingHistory } from '../trainingHistory/service';
import { DEFENSES, METHOD_LABEL, MEASURE_KIND_LABEL, POSITIONS, fieldOf, formatValue, valueOf } from './catalog';
import { effectiveStatus, getProfile, liveItem } from './store';
import type { FighterProfile, ProfileItem } from './types';

// 개인 파이터 프로필 → AI 코치. Each coaching request gets ONLY the profile
// items relevant to its art and topic (a boxing lesson never receives the
// user's guard-pull preferences), each labelled with where it came from, plus
// the rules for using it: it supports the coach's judgement, it is not proof
// of skill, and missing data stays missing.

export interface ProfileContextRequest {
  martialArt?: string | null;
  /** Lesson topic / technique name / category — narrows striking topics to punches or kicks. */
  topic?: string | null;
  /** Upper bound on profile lines (default 22). */
  max?: number;
  /** For tests: a profile instead of the stored one. */
  profile?: FighterProfile;
  /** For tests: training records to cross-check against (default: the stored history). */
  history?: { date: string; techniqueIds: string[] }[];
  now?: Date;
}

export interface ProfileContext {
  /** '' when the profile has nothing relevant — callers then add nothing. */
  text: string;
  /** The profile items that were sent (transparency + tests). */
  keys: string[];
  /** One-line, user-facing reason the lesson was personalized ("사우스포 · 스탠스 전환 자주"). */
  summary: string;
}

const COMMON = ['train.years', 'train.frequency', 'train.improve', 'train.wantToLearn', 'train.goalShort'];
const STANCE = ['body.stance', 'body.stanceSwitch', 'body.switchPurpose'];
const PUNCH = ['box.favoritePunches', 'box.comfortHand', 'box.powerHand', 'box.preferredRange', 'box.combos', 'box.uppercut', 'box.counter', 'box.feints', 'box.afterAttack', 'box.range.'];
const KICK = ['kick.', 'body.dominantFoot'];
const MOVE = ['move.'];
const DEF = ['def.main', 'def.uncomfortable', 'def.'];
const WRESTLE = ['wr.', 'mmag.scramble'];
const BJJ = ['bjj.', 'pos.'];

const BY_ART: Record<string, string[]> = {
  boxing: [...STANCE, 'body.dominantHand', 'body.wingspan', 'body.apeIndex', ...PUNCH, ...DEF, ...MOVE],
  kickboxing: [...STANCE, ...KICK, ...PUNCH, 'mma.punchToKick', 'mma.kickToPunch', ...DEF, ...MOVE],
  'muay-thai': [...STANCE, ...KICK, ...PUNCH, 'mma.punchToKick', 'mma.kickToPunch', 'mma.clinchEntry', 'pos.clinch', ...DEF, ...MOVE],
  taekwondo: [...STANCE, ...KICK, 'box.preferredRange', 'def.main', ...MOVE],
  karate: [...STANCE, ...KICK, 'box.favoritePunches', 'box.preferredRange', 'box.counter', 'def.main', ...MOVE],
  wrestling: ['body.stance', 'body.dominantFoot', 'body.height', 'body.weight', ...WRESTLE, 'bjj.escapes', 'pos.comfortable', 'pos.uncomfortable', 'pos.'],
  bjj: [...BJJ, 'wr.afterTD', 'wr.single', 'wr.double', 'body.height', 'body.weight'],
  judo: [...BJJ, ...WRESTLE, 'body.stance', 'body.height', 'body.weight'],
  sambo: [...BJJ, ...WRESTLE, 'body.stance', 'body.height', 'body.weight'],
  'mixed-martial-arts': [...STANCE, 'body.wingspan', 'body.apeIndex', 'box.favoritePunches', 'box.preferredRange', 'box.range.', 'kick.favorite', 'kick.range.', 'mma.', 'mmag.', 'wr.single', 'wr.double', 'wr.direction', 'wr.entry', 'bjj.topBottom', 'pos.comfortable', 'pos.uncomfortable', 'def.main'],
};
const GENERAL = [...STANCE, 'train.arts', 'box.preferredRange', 'bjj.topBottom'];

const KICK_TOPIC = /(킥|kick|차기|티프|teep|발)/i;
const PUNCH_TOPIC = /(펀치|punch|잽|jab|스트레이트|훅|hook|어퍼|uppercut|크로스|원투|복싱|boxing)/i;
/** 이 단어가 있으면 그 무술 안에서도 그래플링·포지션 쪽 수업. */
const GROUND_TOPIC = /(가드|guard|마운트|mount|사이드|side control|백|back|스윕|sweep|패스|pass|탈출|escape|초크|choke|암바|armbar|서브미션|submission|테이크다운|takedown|태클|싱글|single|더블|double)/i;

const SOURCE_LABEL: Record<ProfileItem['source'], string> = {
  self_report: '본인 답변',
  measured: '직접 측정',
  video_observed: '영상 관찰',
  system_calculated: '저장된 값으로 계산',
  coach_inferred: 'AI 추론',
};

function wanted(key: string, prefixes: string[]): boolean {
  return prefixes.some((x) => (x.endsWith('.') ? key.startsWith(x) : key === x));
}

/** Per-defense / per-position detail only for the ones the user named. */
function entityAllowed(p: FighterProfile, key: string): boolean {
  const d = key.match(/^def\.(\w+)\.\w+$/);
  if (d && DEFENSES.some((x) => x.value === d[1])) {
    const main = valueOf(p, 'def.main');
    return Array.isArray(main) && main.includes(d[1]);
  }
  const ps = key.match(/^pos\.(\w+)\.\w+$/);
  if (ps && POSITIONS.some((x) => x.value === ps[1])) {
    const named = [valueOf(p, 'pos.comfortable'), valueOf(p, 'pos.uncomfortable')].flatMap((v) => (Array.isArray(v) ? v : []));
    return named.includes(ps[1]);
  }
  return true;
}

function line(it: ProfileItem, now: Date): string {
  const f = fieldOf(it.key)!;
  const st = effectiveStatus(it, now.getTime());
  const flags = [SOURCE_LABEL[it.source]];
  if (it.measurement) {
    const m = it.measurement;
    flags.push(MEASURE_KIND_LABEL[m.kind]);
    if (m.limb) flags.push(m.limb === 'lead' ? '앞쪽' : '뒤쪽');
    if (m.side) flags.push(m.side === 'left' ? '왼쪽' : '오른쪽');
    flags.push(m.method ? METHOD_LABEL[m.method] : '측정 방법 모름');
    if (m.measuredAt) flags.push(m.measuredAt);
    flags.push(`신뢰도 ${({ high: '높음', medium: '보통', low: '낮음' } as const)[m.confidence]}`);
  }
  if (it.observation) flags.push(`관찰: ${it.observation.observed}${it.observation.interpretation ? ` / 해석: ${it.observation.interpretation}` : ''}`);
  if (st === 'needs_review') flags.push('확인 필요 — 관련 답변이 바뀜');
  if (st === 'outdated') flags.push('오래된 측정');
  if (st === 'unconfirmed') flags.push('사용자 미확인');
  return `- ${f.label}: ${formatValue(f, it.value)} (${flags.join(' · ')})`;
}

/** Profile vs training records — a mismatch is something to ASK about, never to resolve silently. */
function recordChecks(p: FighterProfile, art: string | null, history: { date: string; techniqueIds: string[] }[], now: Date): string[] {
  const out: string[] = [];
  const recent = history.filter((h) => now.getTime() - new Date(h.date).getTime() <= 28 * 86400000);
  const freq = valueOf(p, 'train.frequency');
  if (typeof freq === 'number' && history.length >= 3) {
    const perWeek = Math.round((recent.length / 4) * 10) / 10;
    if (freq >= 2 && perWeek < freq / 2) out.push(`- 프로필: 주 ${freq}회 훈련 / 앱 기록: 최근 4주 평균 주 ${perWeek}회 — 앱 밖에서 훈련했을 수 있으니 단정하지 말고 한 번 물어볼 것`);
  }
  if (art) {
    const practicedArt = recent.some((h) => h.techniqueIds.some((id) => getTechnique(id)?.martialArt === art));
    const arts = valueOf(p, 'train.arts');
    if (Array.isArray(arts) && arts.length && !arts.includes(art) && practicedArt) out.push(`- 프로필의 수련 종목에 이 무술이 없지만 최근 기록에는 이 무술 훈련이 있음 — 경험을 한 번 확인할 것`);
  }
  return out;
}

export function fighterProfileContext(req: ProfileContextRequest = {}): ProfileContext {
  const p = req.profile ?? getProfile();
  const now = req.now ?? new Date();
  const art = req.martialArt ?? null;
  let prefixes = [...(art && BY_ART[art] ? BY_ART[art] : GENERAL), ...COMMON];
  const topic = req.topic ?? '';
  if (topic && art && BY_ART[art] && art !== 'mixed-martial-arts') {
    const kick = KICK_TOPIC.test(topic);
    const punch = PUNCH_TOPIC.test(topic);
    // Narrow a striking lesson to its weapon: a kick lesson doesn't need punch ranges and vice versa.
    if (kick && !punch) prefixes = prefixes.filter((x) => !['box.range.', 'box.combos', 'box.uppercut', 'box.comfortHand', 'box.powerHand'].includes(x));
    if (punch && !kick) prefixes = prefixes.filter((x) => !x.startsWith('kick.') && x !== 'body.dominantFoot');
  }
  if (topic && art === 'mixed-martial-arts' && GROUND_TOPIC.test(topic)) prefixes = prefixes.filter((x) => !x.startsWith('box.range') && !x.startsWith('kick.range'));

  const live = Object.values(p.items).filter((it) => !it.deletedAt && fieldOf(it.key) && wanted(it.key, prefixes) && entityAllowed(p, it.key));
  const order = (k: string) => prefixes.findIndex((x) => (x.endsWith('.') ? k.startsWith(x) : k === x));
  const answered = live.filter((it) => it.state === 'answered').sort((a, b) => order(a.key) - order(b.key));
  const max = req.max ?? 22;
  const sent = answered.slice(0, max);
  const unknown = live.filter((it) => it.state === 'unknown').map((it) => fieldOf(it.key)!.label);
  const relevantStyle = p.style?.tags.filter((t) => t.role !== 'tendency' || t.basis.some((b) => wanted(b, prefixes))) ?? [];
  const checks = recordChecks(p, art, req.history ?? listTrainingHistory(), now);

  if (!sent.length && !relevantStyle.length) return { text: '', keys: [], summary: '' };

  const styleLine = relevantStyle.length
    ? p.style!.status === 'confirmed'
      ? `- 스타일 (AI 분석, 사용자 확인함): ${relevantStyle.map((t) => t.label).join(' · ')}`
      : `- 스타일 (AI 분석, 사용자 미확인 — 참고만): ${relevantStyle.map((t) => t.label).join(' · ')}`
    : null;
  const text = [
    '[개인 파이터 프로필 — 이번 수업과 관련된 항목만]',
    '사용 원칙: 수업을 이 사용자에게 맞추는 데 쓴다(예: 스탠스·편한 손발·선호 거리에 맞춘 설명과 연습 구성). 이미 자주 쓴다고 한 기술은 처음부터 반복하지 말고 한 단계 위를 다룬다. 선호 기술을 활용하되 그것에만 의존하게 만들지 않는다. 약하다고 한 부분은 쉬운 단계부터 보완한다.',
    '주의: 이것은 사용자의 자기 보고·측정 기록이며 실제 실력의 증거가 아니다. 프로필만으로 숙련도를 확정하거나 칭찬·평가하지 않는다. 없는 항목은 지어내지 말고 필요하면 물어본다. 프로필과 훈련 기록이 다르면 확인 질문을 한다. 프로필을 반영했다면 한 문장으로 짧게 밝힌다(예: "사우스포로 스탠스를 자주 바꾼다고 하셔서 …"). 프로필을 수정하거나 새 사실로 기록하지 않는다.',
    ...sent.map((it) => line(it, now)),
    ...(styleLine ? [styleLine] : []),
    ...(unknown.length ? [`- 미확인(사용자가 모른다고 함): ${unknown.slice(0, 8).join(', ')}`] : []),
    ...(checks.length ? ['[프로필과 훈련 기록의 차이 — 확인 질문 필요]', ...checks] : []),
  ].join('\n');
  const summary = sent
    .filter((it) => it.status === 'confirmed' && !it.measurement)
    .slice(0, 3)
    .map((it) => `${fieldOf(it.key)!.label} ${formatValue(fieldOf(it.key), it.value)}`)
    .join(' · ');
  return { text, keys: [...sent.map((it) => it.key), ...(styleLine ? ['style'] : [])], summary };
}

/** The block as one string to append to a coach request's context ('' when nothing relevant). */
export function profileContextBlock(martialArt: string | null | undefined, topic?: string | null): string {
  // 헬스·홈트 등 무술이 아닌 영역에는 파이터 프로필을 넣지 않는다.
  if (martialArt && !BY_ART[martialArt]) return '';
  try {
    const c = fighterProfileContext({ martialArt: martialArt ?? null, topic: topic ?? null });
    return c.text ? `\n\n${c.text}` : '';
  } catch {
    // A broken profile must never break a lesson.
    return '';
  }
}

export { liveItem };
