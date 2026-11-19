// 기술별 안전 가이드 (사양 §5-1, §5-2, §5-4).
//
// The technique DB has no safety fields, so nothing here pretends to be a verified risk rating or medical advice.
// What the guide shows, each with where it came from:
//   1. 기술 분류 기반 일반 수칙 — the technique's kind (throw, joint lock, choke, kick …) is read from its category /
//      name; for that kind, widely taught training-safety practice (tap and release, breakfalls before throws, shin
//      guards for kicks …) is listed. Labelled "MARTIALDEX 일반 안전 수칙 · 기술 분류 기반 · 의학적 검증 아님".
//   2. 기술 기록의 원문 — sentences of the technique's own record that mention safety / injury (posture mistakes,
//      description), quoted as written.
//   3. Gi/No-Gi 연구 자료 — the grappling records' safety line (AI-researched from web sources, not reviewed by a
//      person — labelled so, with its sources).
//   4. 선행 기술 — from the technique graph, with the learner's own state for each.
// When the kind cannot be told from the record, the guide says "정보 확인 필요" instead of guessing.

import type { Technique } from '../../types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { isDone, type TechniqueState } from '../trainingEcosystem/learningState';

export type SafetyKind = 'throw' | 'takedown' | 'joint_lock' | 'leg_lock' | 'choke' | 'neck' | 'punch' | 'kick' | 'elbow_knee' | 'ground_strike' | 'clinch' | 'movement' | 'defense' | 'position';

export const SAFETY_KIND_LABEL: Record<SafetyKind, string> = {
  throw: '던지기·투사',
  takedown: '테이크다운',
  joint_lock: '관절기',
  leg_lock: '다리 관절기',
  choke: '조르기',
  neck: '목·척추에 힘이 실리는 기술',
  punch: '펀치',
  kick: '킥',
  elbow_knee: '팔꿈치·무릎 타격',
  ground_strike: '그라운드 타격',
  clinch: '클린치',
  movement: '자세·움직임',
  defense: '방어',
  position: '그래플링 포지션',
};

const KIND_RULES: [SafetyKind, RegExp][] = [
  ['neck', /(넥\s*크랭크|neck crank|캔\s*오프너|can opener|슬램|slam|피기백 슬램|파일드라이버)/i],
  ['leg_lock', /(힐\s*훅|heel hook|레그\s*락|leg ?lock|니\s*바|knee ?bar|토\s*홀드|toe ?hold|아시\s*가라미|ashi garami|앵클\s*락|ankle ?lock|카프 슬라이서|calf slicer|50\/50|싱글 레그 x|slx)/i],
  ['choke', /(초크|choke|조르기|길로틴|guillotine|트라이앵글|triangle|리어 네이키드|rear naked|다스|d'arce|아나콘다|anaconda|에제키엘|ezekiel|보 앤 애로|bow and arrow|시메|jime|목조르)/i],
  ['joint_lock', /(암\s*바|armbar|arm bar|기무라|kimura|아메리카나|americana|키\s*락|key ?lock|오모플라타|omoplata|리스트\s*락|wrist ?lock|관절|간세츠|kansetsu|juji|쥬지)/i],
  ['throw', /(던지기|투사|업어치기|메치기|nage|seoi|throw|힙\s*토스|hip toss|수플렉스|suplex|오소토|osoto|우치마타|uchi mata|하라이|harai|tomoe|토모에|바디락 투사|사포|sacrifice)/i],
  ['takedown', /(테이크다운|takedown|싱글\s*레그|single ?leg|더블\s*레그|double ?leg|하이 크로치|high crotch|앵클 픽|ankle pick|레벨 체인지|level change|트립|trip|스윕|sweep|리샷|reshot|발목·무릎 공격)/i],
  ['ground_strike', /(그라운드 앤 파운드|ground ?(and|&) ?pound|파운드|pound|엘보 다운)/i],
  ['elbow_knee', /(엘보|팔꿈치|elbow|니킥|knee strike|무릎 차기|teep knee|플라잉 니|flying knee|티 카오|khao|sok)/i],
  ['kick', /(킥|kick|차기|돌려차기|옆차기|앞차기|뒤차기|내려차기|chagi|geri|게리|teep|티프|로우킥|미들킥|하이킥)/i],
  // "Heel Hook", "Underhook", "Overhook", "Butterfly Hook" are not punches
  ['punch', /(펀치|punch|잽|jab|크로스|cross|(?<!(힐|언더|오버|버터플라이)\s?)훅|(?<!(heel|under|over|butterfly|leg|foot|seat|back)\s?)\bhooks?\b|어퍼|upper|스트레이트|straight|오버핸드|overhand|조합|콤보|combination|지르기|zuki|tsuki)/i],
  ['clinch', /(클린치|clinch|플럼|plum|바디락|body ?lock|언더훅|underhook|오버훅|overhook|케이지 워크|cage)/i],
  ['defense', /(방어|가드|블록|block|패리|parry|슬립|slip|위빙|weav|롤링|스프롤|sprawl|막기|uke\b)/i],
  ['position', /(포지션|position|마운트|mount|사이드 컨트롤|side control|백 컨트롤|back control|터틀|turtle|가드 패스|guard pass|탈출|escape|하프 가드|half guard|클로즈드 가드|오픈 가드)/i],
  ['movement', /(자세|스탠스|stance|풋워크|footwork|움직임|movement|스텝|step|피벗|pivot|서기|dachi)/i],
];

export function safetyKindsOf(t: Technique): SafetyKind[] {
  const text = `${t.category} ${t.name} ${t.koreanName ?? ''} ${t.aliases.join(' ')}`;
  const kinds = KIND_RULES.filter(([, re]) => re.test(text)).map(([k]) => k);
  // a technique is one kind first: the most specific match leads (rules are ordered most → least specific)
  return [...new Set(kinds)].slice(0, 2);
}

interface KindGuide {
  before: string[];
  equipment: string[];
  partner: string[];
  supervision: string[];
  overuse: string[];
  /** The level at which the kind is usually introduced (common teaching practice, not a rating). */
  level: 'beginner' | 'intermediate' | 'advanced';
}

const GUIDE: Record<SafetyKind, KindGuide> = {
  throw: {
    before: ['낙법(앞·뒤·옆 낙법)을 먼저 익히고, 받는 사람도 낙법을 할 수 있어야 합니다.', '무게 중심 무너뜨리기(쿠즈시)와 기본 자세를 먼저 연습합니다.'],
    equipment: ['충격을 흡수하는 매트(타타미)', '(Gi 기술) 도복'],
    partner: ['처음에는 천천히, 던지는 방향과 착지 위치를 미리 정합니다.', '상대 머리·목이 먼저 떨어지지 않도록 소매나 깃을 끝까지 잡아 줍니다.'],
    supervision: ['매트가 없는 곳에서 연습하지 않습니다.', '처음 배울 때와 빠른 속도로 연습할 때는 지도자가 있는 곳에서 합니다.'],
    overuse: ['반복 던지기는 받는 사람의 몸에 누적 충격을 줍니다 — 세트 사이 휴식과 역할 교대를 둡니다.'],
    level: 'intermediate',
  },
  takedown: {
    before: ['기본 스탠스·레벨 체인지·페네트레이션 스텝을 먼저 익힙니다.', '스프롤 등 기본 방어를 함께 배웁니다.'],
    equipment: ['매트'],
    partner: ['머리를 바깥쪽에 두고, 머리로 들이받지 않습니다.', '처음에는 상대가 협조하는 속도로, 마무리(넘어뜨리기)는 매트 위에서만 합니다.'],
    supervision: ['실전 속도의 테이크다운 스파링은 지도자 감독 아래에서 합니다.'],
    overuse: ['무릎 꿇는 동작이 반복되므로 무릎 보호대를 고려하고, 무릎 통증이 있으면 횟수를 줄입니다.'],
    level: 'beginner',
  },
  joint_lock: {
    before: ['포지션 컨트롤을 먼저 익히고, 관절기는 컨트롤된 상태에서만 겁니다.', '탭(손·발로 두드리기·말로 알리기) 규칙을 파트너와 확인합니다.'],
    equipment: ['매트'],
    partner: ['천천히 걸고, 상대가 탭하면 즉시 풉니다.', '탭하는 쪽은 아프기 전에 일찍 탭합니다.'],
    supervision: ['스파링에서 처음 쓰기 전에 지도자에게 거는 방법을 확인받습니다.'],
    overuse: ['관절에 통증이 남으면 그 날은 같은 관절에 대한 연습을 멈춥니다.'],
    level: 'intermediate',
  },
  leg_lock: {
    before: ['다리 얽기(아시 가라미) 포지션과 탈출을 먼저 익힙니다.', '무릎·발목 관절기는 아프다고 느끼기 전에 손상이 생길 수 있다는 점을 알고 시작합니다.'],
    equipment: ['매트'],
    partner: ['비틀기 계열(힐훅 등)은 아주 천천히 걸고, 탭하면 즉시 풉니다.', '탭하는 쪽은 압박을 느끼는 즉시 탭합니다 — 버티지 않습니다.'],
    supervision: ['비틀기 계열 다리 관절기는 지도자 감독 아래에서만 연습합니다.', '대회·체육관마다 허용 규정이 다르니 규정을 확인합니다.'],
    overuse: ['무릎·발목에 이상한 느낌이 있으면 즉시 중단합니다.'],
    level: 'advanced',
  },
  choke: {
    before: ['포지션 컨트롤을 먼저 익힙니다.', '탭 규칙과 "의식이 흐려지기 전에 풀기"를 파트너와 확인합니다.'],
    equipment: ['매트'],
    partner: ['천천히 조이고, 탭하면 즉시 풉니다.', '상대 반응이 없으면 바로 풀고 상태를 확인합니다.'],
    supervision: ['혼자 또는 지켜보는 사람 없이 조르기 연습을 하지 않습니다.', '처음 배울 때는 지도자 감독 아래에서 합니다.'],
    overuse: ['목 앞쪽을 누르는 압박(기도)보다 경동맥 쪽으로 정확히 거는 법을 지도자에게 확인받습니다.'],
    level: 'intermediate',
  },
  neck: {
    before: ['목과 척추에 직접 힘이 실리는 기술입니다. 기초 포지션과 방어를 충분히 익힌 뒤에만 다룹니다.'],
    equipment: ['매트'],
    partner: ['파트너에게 실제 힘을 싣지 않고, 위치와 원리만 확인하는 수준으로 연습합니다.'],
    supervision: ['반드시 지도자 감독 아래에서 다룹니다.', '많은 대회·체육관에서 금지되거나 제한되는 기술입니다 — 규정을 확인합니다.'],
    overuse: ['목에 통증이나 저림이 생기면 즉시 중단하고 전문가의 진료를 받습니다.'],
    level: 'advanced',
  },
  punch: {
    before: ['기본 스탠스와 주먹 쥐는 법, 손목을 곧게 유지하는 법을 먼저 익힙니다.'],
    equipment: ['핸드랩', '글러브 (샌드백·미트·스파링)', '스파링 시 마우스피스', '(스파링) 헤드기어 — 체육관 규정에 따름'],
    partner: ['미트·파트너 연습은 강도를 미리 합의합니다.', '스파링은 가볍게(테크니컬) 시작합니다.'],
    supervision: ['처음 스파링은 지도자가 있는 곳에서 합니다.'],
    overuse: ['손목·손가락 관절에 통증이 있으면 샌드백 강타를 쉽니다.'],
    level: 'beginner',
  },
  kick: {
    before: ['균형과 스탠스 복귀, 고관절·햄스트링 준비운동을 먼저 합니다.', '기본 킥의 축발 회전을 익힌 뒤 높이를 올립니다.'],
    equipment: ['정강이 보호대 (파트너·미트 연습)', '킥 미트 / 샌드백', '스파링 시 마우스피스'],
    partner: ['미트 잡는 사람의 팔 위치를 확인하고, 처음에는 낮은 강도로 찹니다.', '파트너에게 차는 연습은 정강이 보호대를 서로 착용합니다.'],
    supervision: ['높은 킥·회전 킥의 스파링 사용은 지도자 감독 아래에서 시작합니다.'],
    overuse: ['정강이 단련을 목적으로 무리하게 딱딱한 물체를 차지 않습니다.'],
    level: 'beginner',
  },
  elbow_knee: {
    before: ['클린치 기본과 거리 조절을 먼저 익힙니다.'],
    equipment: ['팔꿈치 보호대', '무릎·정강이 보호대', '미트 / 샌드백'],
    partner: ['파트너에게는 실제로 맞히지 않고, 미트·패드에만 강하게 칩니다.'],
    supervision: ['팔꿈치·무릎 타격의 스파링 사용은 지도자 판단에 따릅니다 — 많은 체육관에서 제한합니다.'],
    overuse: ['팔꿈치·무릎 관절에 통증이 있으면 강타를 쉽니다.'],
    level: 'intermediate',
  },
  ground_strike: {
    before: ['탑 포지션 컨트롤(마운트·사이드·가드 안)을 먼저 익힙니다.'],
    equipment: ['MMA 글러브', '헤드기어·마우스피스 (스파링)', '그라운드 백·더미'],
    partner: ['파트너에게는 아주 가볍게, 또는 더미에만 칩니다.'],
    supervision: ['그라운드 타격이 포함된 스파링은 지도자 감독 아래에서만 합니다.'],
    overuse: [],
    level: 'intermediate',
  },
  clinch: {
    before: ['기본 스탠스와 머리 위치, 균형 유지를 먼저 익힙니다.'],
    equipment: ['마우스피스 (스파링)'],
    partner: ['목을 당기는 동작은 천천히, 상대 목을 비틀지 않습니다.'],
    supervision: [],
    overuse: [],
    level: 'beginner',
  },
  defense: {
    before: ['기본 가드와 스탠스를 먼저 익힙니다.'],
    equipment: ['파트너 연습 시 글러브·마우스피스'],
    partner: ['방어 연습에서 공격하는 쪽은 합의한 속도·강도를 지킵니다.'],
    supervision: [],
    overuse: [],
    level: 'beginner',
  },
  position: {
    before: ['기본 움직임(새우빼기·브릿지 등)과 탈출을 먼저 익힙니다.'],
    equipment: ['매트'],
    partner: ['체중을 실을 때 상대의 목·얼굴을 누르지 않습니다.', '스파링 강도를 미리 합의합니다.'],
    supervision: [],
    overuse: [],
    level: 'beginner',
  },
  movement: {
    before: ['주변에 부딪힐 물건이 없는 공간을 확보합니다.'],
    equipment: [],
    partner: [],
    supervision: [],
    overuse: [],
    level: 'beginner',
  },
};

export const STOP_RULE = '날카로운 통증, 어지러움, 저림, 관절이 빠지는 느낌이 있으면 즉시 중단하세요. MARTIALDEX는 의료 진단이나 부상 치료를 대신하지 않습니다 — 증상이 계속되면 의료 전문가에게 상담하세요.';
export const RULE_SOURCE_LABEL = 'MARTIALDEX 일반 안전 수칙 · 기술 분류 기반 · 의학적 검증 아님';
const SAFETY_WORDS = /(안전|부상|다치|위험|통증|관절에 무리|목에 무리|금지|조심|주의)/;

export interface SafetyGuide {
  techniqueId: string;
  kinds: SafetyKind[];
  /** No kind could be told from the record: the rule sections are "정보 확인 필요". */
  unverified: boolean;
  level: 'beginner' | 'intermediate' | 'advanced' | null;
  levelSource: 'record' | 'kind' | null;
  before: string[];
  equipment: string[];
  partner: string[];
  supervision: string[];
  overuse: string[];
  stopRule: string;
  /** The record's own sentences about safety, quoted. */
  recordNotes: string[];
  /** The Gi/No-Gi research safety lines (AI-researched, not reviewed by a person). */
  researched: { style: string; text: string; sources: { title: string; url: string }[] }[];
  prerequisites: { techniqueId: string; name: string; done: boolean | null }[];
  /** Breakfalls etc. that the guide names but MARTIALDEX has no record of. */
  missingBasics: string[];
}

export function safetyGuide(t: Technique, opts: { states?: Map<string, TechniqueState>; resolveName?: (id: string) => string } = {}): SafetyGuide {
  const kinds = safetyKindsOf(t);
  const g = kinds.map((k) => GUIDE[k]);
  const merge = (f: keyof Omit<KindGuide, 'level'>) => [...new Set(g.flatMap((x) => x[f]))];
  const recordNotes = [t.description, t.purpose ?? '', ...(t.posture?.commonMistakes ?? []), ...(t.posture?.keyPoints ?? [])]
    .flatMap((s) => s.split(/(?<=[.!?。])\s+|\n/))
    .map((s) => s.trim())
    .filter((s) => s.length > 8 && SAFETY_WORDS.test(s))
    .slice(0, 4);
  const gng = t.giNoGi;
  const researched = gng
    ? (['gi', 'noGi'] as const)
        .map((k) => ({ style: k === 'gi' ? 'Gi' : 'No-Gi', p: gng.postures?.[k] }))
        .filter((x) => x.p?.safety)
        .map((x) => ({ style: x.style, text: x.p!.safety!, sources: x.p!.sources ?? [] }))
    : [];
  let prerequisites: SafetyGuide['prerequisites'] = [];
  try {
    prerequisites = getTechniqueConnections(t).prerequisite.slice(0, 5).map((p) => ({ techniqueId: p.techniqueId, name: opts.resolveName?.(p.techniqueId) ?? p.techniqueName, done: opts.states ? isDone(opts.states.get(p.techniqueId)) : null }));
  } catch {
    prerequisites = [];
  }
  const levelRank = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  const kindLevel = g.length ? g.map((x) => x.level).sort((a, b) => levelRank[b] - levelRank[a])[0] : null;
  const recordLevel = t.difficulty ?? null;
  return {
    techniqueId: t.id,
    kinds,
    unverified: !kinds.length,
    level: recordLevel ?? kindLevel,
    levelSource: recordLevel ? 'record' : kindLevel ? 'kind' : null,
    before: merge('before'),
    equipment: merge('equipment'),
    partner: merge('partner'),
    supervision: merge('supervision'),
    overuse: merge('overuse'),
    stopRule: STOP_RULE,
    recordNotes,
    researched,
    prerequisites,
    missingBasics: kinds.includes('throw') ? ['낙법 — MARTIALDEX에 유도·레슬링 낙법 기록이 아직 없어 연결하지 못했습니다'] : [],
  };
}

export const LEVEL_LABEL: Record<'beginner' | 'intermediate' | 'advanced', string> = { beginner: '초보자', intermediate: '중급자', advanced: '상급자' };

export type LearnerLevel = 'beginner' | 'intermediate' | 'advanced' | 'unknown';

/** The learner's level in an art from their own records — 'unknown' when there is too little to tell (never guessed). */
export function learnerLevel(art: string, states: Map<string, TechniqueState>): { level: LearnerLevel; basis: string } {
  const inArt = [...states.values()].filter((s) => s.technique.martialArt === art && s.state !== 'not_started');
  const done = inArt.filter((s) => isDone(s)).length;
  const verified = inArt.filter((s) => s.state === 'verified').length;
  if (inArt.length < 3) return { level: 'unknown', basis: `이 무술의 학습 기록이 ${inArt.length}개뿐이라 수준을 판단하지 않았습니다` };
  if (verified >= 15 || done >= 30) return { level: 'advanced', basis: `학습 완료 ${done}개 · 숙련도 확인 ${verified}개` };
  if (done >= 8) return { level: 'intermediate', basis: `학습 완료 ${done}개 · 숙련도 확인 ${verified}개` };
  return { level: 'beginner', basis: `학습 완료 ${done}개 · 숙련도 확인 ${verified}개` };
}

/** Level-adjusted advice for this technique (사양 §5-2). */
export function levelAdvice(guide: SafetyGuide, learner: { level: LearnerLevel; basis: string }): string[] {
  const out: string[] = [];
  const undone = guide.prerequisites.filter((p) => p.done === false);
  if (learner.level === 'unknown') out.push(`수준 판단 데이터 부족 — ${learner.basis}. 처음 배우는 기술이라면 기초 자세와 움직임부터 확인하세요.`);
  if (learner.level === 'beginner') {
    out.push('초보자 단계: 기본 동작을 정확하게 익히는 것을 우선하고, 파트너 연습은 지도자가 있는 곳에서 하세요.');
    if (guide.level === 'advanced') out.push('이 기술은 보통 상급 단계에서 다룹니다 — 지금은 선행 기술과 기초를 먼저 권합니다.');
  }
  if (learner.level === 'intermediate') out.push('중급자 단계: 배운 기초 기술을 확인한 뒤 연결 동작을 단계적으로 늘리세요.');
  if (learner.level === 'advanced') out.push('상급자 단계: 숙련도와 목표에 맞춰 강도를 정하되, 피로가 쌓인 상태의 무리한 반복은 피하세요.');
  if (undone.length) out.push(`아직 학습 완료가 아닌 선행 기술: ${undone.map((p) => p.name).join(', ')} — 먼저 익히는 것을 권합니다.`);
  return out;
}

/** Compact text for the AI coach's context (code-written, labelled). */
export function safetyContextLine(t: Technique, states?: Map<string, TechniqueState>): string {
  const g = safetyGuide(t, { states });
  if (g.unverified) return `[안전] ${t.name}: 기술 분류를 알 수 없어 안전 정보 확인 필요. 통증 시 중단·의료 상담 안내.`;
  const undone = g.prerequisites.filter((p) => p.done === false).map((p) => p.name);
  return `[안전 — ${RULE_SOURCE_LABEL}] ${t.name}(${g.kinds.map((k) => SAFETY_KIND_LABEL[k]).join('·')}): ${[...g.before.slice(0, 1), ...g.supervision.slice(0, 1), ...g.partner.slice(0, 1)].join(' ')}${undone.length ? ` 아직 학습 완료가 아닌 선행 기술: ${undone.join(', ')}.` : ''} 통증·어지러움 시 즉시 중단.`;
}
