// 전술 분석 — 사용자가 만든 셋업·콤보 평가 (§8), 상대 패턴 대응·상황 분석 (§11).
//
// 측정(2026-11-15, 42개 문제 최종): "내가 만든 원투 이후 더블렉 셋업 평가해줘"는 '평가' 때문에 자세
// 측정으로 갔고, "슬립 어퍼를 자주 쓰는 상대 대처법"은 슬립 설명으로, "허리후리기를 하는데 상대 중심이
// 뒤로 빠질 때"와 "페인트에 예민하게 반응해"는 웹 검색 + 자유 생성으로 갔다.
//
// 여기서는 답을 세 층으로 나눠 쓴다. 섞지 않는다.
//   1. MARTIALDEX 기록 — 기술 DB·지식 인덱스에 실제로 있는 것 (코드가 씀)
//   2. 앱의 원리 판단 — 아래 규칙 표에 적힌 일반적인 격투 원리 (코드가 씀, "판단"이라고 표시)
//   3. AI 해석 — 로컬 모델이 1·2만 보고 쓴 의견 (선택, 근거 대조 후 표시)
// 셋업은 "앞 동작이 끌어내는 상대 반응이 다음 기술을 연다"는 설명이 있을 때만 셋업이라 부른다.

import type { Technique } from '../../types';
import { allTechniques } from '../loadData';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeIndex, KnowledgeSequence } from '../martialdexKnowledge/types';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { canonicalTechniqueId } from '../techniqueCanonical';

export type StepKind = 'jab' | 'straight' | 'hook' | 'uppercut' | 'punch' | 'kick' | 'knee' | 'elbow' | 'leg_takedown' | 'upper_takedown' | 'throw' | 'submission' | 'defense' | 'feint' | 'movement' | 'other';

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

/** What kind of action a technique is — from its name and category (DB fields only). */
export function stepKind(t: Technique): StepKind {
  const n = `${t.name} ${t.aliases.join(' ')}`.toLowerCase();
  const c = (t.category ?? '').toLowerCase();
  if (/(defen[cs]e|방어|막기|블록|block|parry|slip|roll|duck|sprawl|whizzer)/.test(`${n} ${c}`) && !/(→|->)/.test(n)) return 'defense';
  if (/feint|페인트|fake/.test(n)) return 'feint';
  if (/(single|double|ankle|crotch|knee tap|leg pick|fireman|low single|blast|snatch)/.test(n)) return 'leg_takedown';
  if (/(body ?lock|bear ?hug|underhook takedown|lat drop|suplex|duck under)/.test(n)) return 'upper_takedown';
  if (/(gari|goshi|nage|otoshi|guruma|gaeshi|makikomi|throw|hip toss|던지기|메치)/.test(`${n} ${c}`)) return 'throw';
  if (/(choke|armbar|kimura|americana|triangle|lock|submission|조르기|관절|초크)/.test(`${n} ${c}`)) return 'submission';
  if (/(jab|잽)/.test(n)) return 'jab';
  if (/(cross|straight|스트레이트|크로스)/.test(n)) return 'straight';
  if (/(uppercut|어퍼)/.test(n)) return 'uppercut';
  if (/(hook|훅)/.test(n)) return 'hook';
  if (/(punch|zuki|tsuki|펀치|backfist|overhand)/.test(n)) return 'punch';
  if (/(knee|니킥|무릎)/.test(n)) return 'knee';
  if (/(elbow|팔꿈치|엘보)/.test(n)) return 'elbow';
  if (/(kick|geri|teep|킥|차기)/.test(n)) return 'kick';
  if (/(step|footwork|pivot|스텝|이동)/.test(`${n} ${c}`)) return 'movement';
  return 'other';
}

const STRIKES: StepKind[] = ['jab', 'straight', 'hook', 'uppercut', 'punch', 'kick', 'knee', 'elbow'];
const HIGH_STRIKES: StepKind[] = ['jab', 'straight', 'hook', 'uppercut', 'punch'];
const GRAPPLE: StepKind[] = ['leg_takedown', 'upper_takedown', 'throw', 'submission'];
const KIND_KO: Record<StepKind, string> = { jab: '잽', straight: '스트레이트', hook: '훅', uppercut: '어퍼컷', punch: '펀치', kick: '킥', knee: '니킥', elbow: '팔꿈치', leg_takedown: '하체 태클', upper_takedown: '상체 테이크다운', throw: '던지기', submission: '서브미션', defense: '방어', feint: '페인트', movement: '이동', other: '기타' };

/** Techniques of the text in the order the learner said them ("원투 이후 더블렉" → 잽, 크로스, 더블 레그). */
export function orderedTechniques(lookupText: string, techniques: Technique[]): Technique[] {
  const want = new Map(techniques.map((t) => [t.id, t]));
  const words = lookupText.split(/\s+/).filter(Boolean);
  const pos = new Map<string, number>();
  for (let i = 0; i < words.length && pos.size < want.size; i++) {
    for (const n of [3, 2, 1]) {
      const phrase = words.slice(i, i + n).join(' ');
      for (const m of exactTechniquesInText(phrase, null).matches) if (want.has(m.id) && !pos.has(m.id)) pos.set(m.id, i);
    }
  }
  return [...techniques].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
}

// ---------------------------------------------------------------- rules (앱의 원리 판단)

interface TransitionRule {
  from: (k: StepKind) => boolean;
  to: (k: StepKind) => boolean;
  /** The opponent reaction the earlier steps are meant to draw — what makes it a SETUP. */
  reaction: string;
  logic: string;
  distanceTiming: string;
  conditions: string[];
  risks: string[];
  improve: string[];
}

const RULES: TransitionRule[] = [
  {
    from: (k) => HIGH_STRIKES.includes(k),
    to: (k) => k === 'leg_takedown',
    reaction: '얼굴로 오는 펀치에 상대가 가드를 올리거나 상체를 세우고 맞받아치려 할 때, 시선과 손이 위로 가고 하체가 비게 된다',
    logic: '높이 변화(레벨 체인지) 원리 — 위를 위협해 반응을 위로 끌어올린 뒤 낮은 자세로 하체를 잡는다',
    distanceTiming: '마지막 펀치가 태클이 닿는 거리까지 데려다줘야 한다. 펀치를 뻗은 자리에서 바로 무릎을 굽혀 들어가고, 상대가 가드를 올리거나 반격하려고 체중을 싣는 순간을 노린다',
    conditions: ['펀치가 실제로 위협이 되어 상대가 반응해야 한다 (반응이 없으면 하체가 열리지 않는다)', '펀치 뒤 거리가 태클 거리 안이어야 한다', '레벨 체인지 때 머리가 앞으로 숙여지지 않고 등이 곧게 유지되어야 한다'],
    risks: ['너무 먼 거리에서 들어가면 스프롤에 막힌다', '머리를 숙이며 들어가면 니킥·어퍼컷 카운터에 노출된다 (MMA·무에타이 규칙)', '펀치를 던지자마자 손을 내리면 태클 의도가 읽힌다'],
    improve: ['마지막 펀치를 한 발 들어가며 치는 펀치로 바꿔 거리를 줄인다', '같은 원투를 태클 없이도 자주 보여 줘 상대가 펀치에 반응하게 만든다', '더블이 막히면 싱글 레그·러닝 더블로 이어 가는 다음 단계를 정해 둔다'],
  },
  {
    from: (k) => k === 'jab' || k === 'feint',
    to: (k) => STRIKES.includes(k),
    reaction: '잽(또는 페인트)에 상대가 손을 뻗어 막거나(패리) 한쪽으로 피하면, 그 반대쪽 경로가 열린다',
    logic: '앞 동작으로 상대의 손·머리 위치를 정한 뒤 열린 경로로 다음 타격을 넣는다',
    distanceTiming: '첫 동작이 닿는 거리에서 두 번째 타격이 바로 이어져야 한다. 상대 반응(패리·슬립)이 끝나기 전에 다음 타격이 출발해야 한다',
    conditions: ['첫 동작이 상대가 반응할 만큼 진짜처럼 보여야 한다', '두 번째 타격이 첫 동작으로 열린 쪽을 향해야 한다'],
    risks: ['첫 동작 뒤 손 회수가 늦으면 같은 쪽으로 카운터를 맞는다', '상대가 반응하지 않으면 단순 연타일 뿐이다'],
    improve: ['상대가 어느 쪽으로 반응하는지 먼저 확인하고 그 반대쪽 타격을 고른다'],
  },
  {
    from: (k) => STRIKES.includes(k),
    to: (k) => STRIKES.includes(k),
    reaction: '',
    logic: '타격 연결 — 앞 타격이 끌어내는 상대 반응이 정해져 있지 않으면 셋업이라기보다 연타(콤보)다',
    distanceTiming: '각 타격 뒤 체중이 다음 타격을 칠 수 있는 위치에 남아 있어야 한다',
    conditions: ['각 타격이 끝난 자세에서 다음 타격이 자연스럽게 출발해야 한다'],
    risks: ['연타 중 가드가 내려가면 카운터에 노출된다'],
    improve: ['앞 타격으로 어떤 반응(가드 이동·슬립·뒷걸음)을 끌어낼지 정하면 셋업이 된다'],
  },
];

export interface SequenceEvaluation {
  steps: Technique[];
  kinds: StepKind[];
  isSetup: boolean;
  recordedLinks: string[];
  recordedSetupsIntoLast: { name: string; reaction: string | null }[];
  defensesOfLast: Technique[];
  ruleFit: string[];
  rule: TransitionRule | null;
}

function sequencesWithPair(a: string, b: string, index: KnowledgeIndex | null): KnowledgeSequence[] {
  if (!index) return [];
  const A = canonicalTechniqueId(a);
  const B = canonicalTechniqueId(b);
  return index.sequences.filter((s) => s.steps.some((st, i) => canonicalTechniqueId(st.techniqueId) === A && canonicalTechniqueId(s.steps[i + 1]?.techniqueId ?? '') === B));
}

/** Defense / counter records in the DB that answer a technique (by its family word: "Double-Leg Down Defense", "Sprawl"). */
export function defensesFor(t: Technique): Technique[] {
  const k = stepKind(t);
  const famWord = t.name.toLowerCase().match(/(single|double|ankle|crotch|uppercut|hook|jab|cross|kick|harai|goshi|slip)/)?.[1] ?? null;
  const own = [...t.counters, ...t.defenses].map((n) => allTechniques.find((x) => x.name.toLowerCase() === n.toLowerCase())).filter((x): x is Technique => !!x);
  const byName = allTechniques.filter((x) => {
    if (x.id === t.id) return false;
    const n = x.name.toLowerCase();
    const c = (x.category ?? '').toLowerCase();
    const defensive = /(defen[cs]e|방어|카운터|counter|kaeshi|gaeshi|되잡기)/.test(`${n} ${c}`);
    if (!defensive) return false;
    if (famWord && n.includes(famWord)) return true;
    if (k === 'leg_takedown' && /(sprawl|whizzer|down defense)/.test(n)) return true;
    return false;
  });
  return [...new Map([...own, ...byName].map((x) => [x.id, x])).values()].slice(0, 6);
}

const STRIKING_ARTS = new Set(['boxing', 'kickboxing', 'muay-thai', 'karate', 'taekwondo']);
const GRAPPLING_ARTS = new Set(['wrestling', 'judo', 'bjj', 'sambo']);

/** Which rule sets allow every step (code, from the step kinds — no sport rulebook is quoted). */
export function ruleFit(kinds: StepKind[]): string[] {
  const strikes = kinds.some((k) => STRIKES.includes(k));
  const kicks = kinds.some((k) => k === 'kick' || k === 'knee' || k === 'elbow');
  const grapples = kinds.some((k) => GRAPPLE.includes(k));
  const out: string[] = [];
  if (strikes && grapples) {
    out.push('MMA: 타격과 테이크다운이 모두 허용되므로 그대로 쓸 수 있습니다.');
    out.push('복싱·킥복싱: 태클·던지기가 반칙이라 이 연결은 쓸 수 없습니다.');
    out.push('레슬링·유도·주짓수: 타격이 허용되지 않아 앞의 타격 부분을 쓸 수 없습니다.');
  } else if (strikes) {
    out.push(kicks ? '킥복싱·무에타이·MMA에서 쓸 수 있습니다. 복싱에서는 킥·니킥이 반칙입니다.' : '복싱·킥복싱·무에타이·MMA 모두에서 쓸 수 있는 타격 연결입니다.');
  } else if (grapples) {
    out.push('그래플링 종목과 MMA에서 쓸 수 있습니다. 종목마다 다리 잡기 허용 여부가 다릅니다 (예: 유도 국제 규칙은 다리를 직접 잡는 기술을 제한).');
  }
  return out;
}

export function evaluateSequence(steps: Technique[], index: KnowledgeIndex | null): SequenceEvaluation {
  const kinds = steps.map(stepKind);
  const last = steps[steps.length - 1];
  const recordedLinks: string[] = [];
  for (let i = 0; i + 1 < steps.length; i++) {
    for (const s of sequencesWithPair(steps[i].id, steps[i + 1].id, index).slice(0, 2)) recordedLinks.push(`${s.kind === 'setup' ? '셋업' : '콤보'} 「${s.name}」: ${s.steps.map((x) => x.name).join(' → ')}`);
  }
  const k = last && index ? gatherTechniqueKnowledge(last.id, index) : null;
  const recordedSetupsIntoLast = (k?.setupsInto ?? []).slice(0, 4).map((s) => ({ name: `${s.name} (${s.steps.map((x) => x.name).join(' → ')})`, reaction: s.steps.map((x) => x.opponentReaction).filter(Boolean).join(' / ') || null }));
  // the rule: the earlier steps as a whole → the last step
  const pre = kinds.slice(0, -1);
  const rule = pre.length ? RULES.find((r) => pre.every((k2) => r.from(k2) || k2 === 'movement') && r.to(kinds[kinds.length - 1])) ?? null : null;
  return { steps, kinds, isSetup: !!rule?.reaction, recordedLinks, recordedSetupsIntoLast, defensesOfLast: last ? defensesFor(last) : [], ruleFit: ruleFit(kinds), rule };
}

export function evaluationText(e: SequenceEvaluation, artName: (a: string) => string): string {
  const seq = e.steps.map(label).join(' → ');
  const lines: string[] = [`■ 평가한 연결: ${seq}`, `  (${e.steps.map((s, i) => `${KIND_KO[e.kinds[i]]} · ${artName(s.martialArt)}`).join(' / ')})`];
  lines.push('', '■ MARTIALDEX 기록 (사실)');
  lines.push(e.recordedLinks.length ? e.recordedLinks.map((x) => `- 기록된 연결: ${x}`).join('\n') : '- 이 순서 그대로 기록된 셋업·콤보는 없습니다 (새로 만든 연결로 봅니다).');
  if (e.recordedSetupsIntoLast.length) lines.push(`- ${label(e.steps[e.steps.length - 1])}(으)로 들어가는 기록된 셋업: ${e.recordedSetupsIntoLast.map((s) => `${s.name}${s.reaction ? ` — 노리는 반응: ${s.reaction}` : ''}`).join(' / ')}`);
  if (e.defensesOfLast.length) lines.push(`- 마지막 기술에 대한 방어·대응 기록: ${e.defensesOfLast.map(label).join(', ')}`);
  lines.push('', '■ 셋업인가, 단순 연결인가 (앱의 판단)');
  if (!e.rule) {
    lines.push('- 앞 동작이 어떤 상대 반응을 끌어내 마지막 기술을 여는지 정해진 원리를 찾지 못했습니다. 지금으로서는 셋업이라기보다 기술을 이어 붙인 연결입니다. 앞 동작으로 어떤 반응(가드 이동·뒷걸음·체중 이동)을 끌어낼지 정하면 셋업이 됩니다.');
  } else if (e.isSetup) {
    lines.push(`- 셋업으로 볼 수 있습니다. 노리는 상대 반응: ${e.rule.reaction}.`);
    lines.push(`- 전술 논리: ${e.rule.logic}.`);
  } else {
    lines.push(`- ${e.rule.logic}.`);
  }
  if (e.rule) {
    lines.push('', '■ 거리와 타이밍 (앱의 판단)', `- ${e.rule.distanceTiming}.`);
    lines.push('', '■ 성공 조건 (앱의 판단)', ...e.rule.conditions.map((x) => `- ${x}`));
    lines.push('', '■ 상대의 대응·위험 (앱의 판단)', ...e.rule.risks.map((x) => `- ${x}`));
    if (e.defensesOfLast.length) lines.push(`- 기록상 상대가 쓸 수 있는 대응: ${e.defensesOfLast.map(label).join(', ')}`);
    lines.push('', '■ 개선점 (앱의 판단)', ...e.rule.improve.map((x) => `- ${x}`));
  }
  if (e.ruleFit.length) lines.push('', '■ 종목·규칙 적합성', ...e.ruleFit.map((x) => `- ${x}`));
  return lines.join('\n');
}

// ---------------------------------------------------------------- situations (상대 패턴 · 반응)

export interface SituationOption {
  name: string;
  how: string;
  pros: string;
  cons: string;
  /** MARTIALDEX technique ids the option uses (looked up, never invented). */
  techniqueIds: string[];
}

export interface Situation {
  key: string;
  title: string;
  definition: string;
  principle: string;
  options: SituationOption[];
  /** Search queries for outside material (counter / situation). */
  queries: string[];
  safety: string | null;
}

const byNames = (...names: string[]): string[] =>
  names.map((n) => allTechniques.find((t) => t.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x);

/** The situation the learner described, from the techniques / patterns / words in it — null when none fits. */
export function situationOf(text: string, techniques: Technique[], patterns: { phrase: string }[], feint: boolean): Situation | null {
  const kinds = techniques.map(stepKind);
  const slipUpper = patterns.some((p) => p.phrase === '슬립 어퍼') || (kinds.includes('defense') && kinds.includes('uppercut'));
  if (slipUpper) {
    return {
      key: 'slip_uppercut',
      title: '상대가 슬립 후 어퍼컷으로 받아칠 때',
      definition: '내가 스트레이트(또는 잽)를 뻗으면 상대가 머리를 옆으로 빼며(슬립) 안쪽으로 들어와 어퍼컷으로 반격하는 패턴입니다. 내 펀치가 상대의 반격 신호가 되는 상황입니다.',
      principle: '상대의 반격은 내 펀치에 대한 "반응"이다 — 같은 펀치를 보여 주되 다음 동작을 준비해 두면 그 반응을 역이용할 수 있고, 펀치를 덜 노출하면 반응 자체를 줄일 수 있다',
      options: [
        { name: '펀치 회수와 뒷손 가드 고정', how: '스트레이트를 뻗은 뒤 회수를 빠르게 하고, 반대 손은 턱 앞에, 팔꿈치는 몸통 가까이 둡니다. 어퍼컷이 올라오는 길(턱 아래·몸통 앞)을 막는 것입니다.', pros: '어떤 종목에서도 바로 적용되고 위험이 가장 적습니다.', cons: '수비적인 대책이라 상대 패턴 자체를 깨지는 못합니다.', techniqueIds: byNames('High Guard', 'Elbow Block') },
        { name: '페인트로 슬립을 먼저 끌어내고 슬립 쪽으로 훅', how: '잽 페인트나 반쯤 뻗은 스트레이트로 상대가 슬립하게 만든 뒤, 상대가 피한 쪽으로 리드 훅을 칩니다.', pros: '상대의 습관을 공격 기회로 바꿉니다.', cons: '타이밍이 어긋나면 상대 어퍼컷과 정면으로 맞부딪힙니다. 상대의 슬립 방향을 먼저 여러 번 확인해야 합니다.', techniqueIds: byNames('Jab Feint', 'Lead Hook', 'Hook') },
        { name: '각도·거리 바꾸기', how: '스트레이트 뒤 같은 자리에 머물지 않고 반 발 빠지거나 바깥쪽으로 각도를 틉니다. 어퍼컷은 짧은 거리 기술이라 거리를 벗어나면 닿지 않습니다.', pros: '반격 거리 자체를 없앱니다.', cons: '내 공격 압박도 함께 줄어듭니다.', techniqueIds: byNames('Pivot', 'Step Back') },
        { name: '들어오는 순간 무릎·클린치 (무에타이·MMA 규칙)', how: '상대가 슬립하며 안쪽으로 들어올 때 무릎을 세우거나 목을 잡아 클린치합니다.', pros: '안으로 들어오는 습관을 직접 벌합니다.', cons: '복싱·일부 킥복싱 규칙에서는 쓸 수 없고, 클린치 실력이 필요합니다.', techniqueIds: byNames('Straight Knee', 'Clinch') },
      ],
      queries: ['how to counter slip uppercut counter boxing', 'boxing defend uppercut counter after straight'],
      safety: null,
    };
  }
  const forwardThrow = techniques.find((t) => /(harai goshi|uchi mata|seoi nage|tai otoshi|koshi guruma|o goshi|harai)/i.test(t.name));
  if (forwardThrow && /(뒤로|빠지|빠질|버티|허리를 빼|엉덩이를 빼)/.test(text)) {
    return {
      key: 'forward_throw_back_weight',
      title: `${label(forwardThrow)}을(를) 시도할 때 상대 중심이 뒤로 빠지는 상황`,
      definition: `${label(forwardThrow)}은(는) 상대 체중을 앞(앞 모서리)으로 끌어낸 상태에서 들어가는 앞으로 던지는 기술입니다. 상대가 허리를 빼고 체중을 뒤로 두면 들어가도 상대가 업히지 않고 버티게 됩니다.`,
      principle: '연락기(렌라쿠와자) — 상대가 한 방향으로 버티는 반응을 보이면 그 반대 방향, 즉 상대가 이미 기울어 있는 쪽으로 던지는 기술로 바꾼다. 또는 반대 방향 기술을 먼저 보여 줘 상대를 앞으로 나오게 만든다',
      options: [
        { name: '뒤로 던지는 기술로 바꾸기', how: '상대 체중이 뒤에 있을 때 안다리(오우치가리)·밭다리(오소토가리)처럼 뒤쪽으로 넘기는 기술로 연결합니다.', pros: '상대의 반응을 그대로 이용하므로 힘이 덜 듭니다.', cons: '뒤로 던지는 기술을 미리 연습해 두어야 하고, 들어가는 발의 위치가 달라 전환이 늦으면 막힙니다.', techniqueIds: byNames('Ouchi Gari', 'Osoto Gari', 'Kosoto Gari', 'Kouchi Gari') },
        { name: '뒤 기술을 먼저 보여 앞으로 끌어내기', how: '안다리·밭다리를 먼저 시도해 상대가 버티며 앞으로 체중을 실으면, 그 순간 원래 노리던 앞으로 던지는 기술로 들어갑니다.', pros: '원래 노리던 기술을 살릴 수 있습니다.', cons: '첫 기술이 진짜 위협이 아니면 상대가 반응하지 않습니다.', techniqueIds: byNames('Ouchi Gari', 'Kouchi Gari') },
        { name: '끌기(쿠즈시)부터 다시 만들기', how: '깃·소매를 당기는 방향과 타이밍을 바꿔 상대가 한 발 앞으로 딛게 만든 뒤 들어갑니다. 상대가 버틸 때 억지로 들어가지 않습니다.', pros: '기술 자체의 성공률을 높이는 기본입니다.', cons: '시간이 걸리고, 상대가 계속 뒤로 빠지면 다른 기술이 필요합니다.', techniqueIds: [] },
      ],
      queries: [`judo ${forwardThrow.name} opponent leaning back combination`, 'judo renraku waza backward throw when opponent pulls back'],
      safety: '던지기 연습은 매트에서, 낙법을 익힌 파트너와 지도자 지도 아래에서 해 주세요.',
    };
  }
  if (feint || /페인트|페이크|feint/i.test(text)) {
    return {
      key: 'feint_overreaction',
      title: '상대의 페인트에 너무 크게 반응하는 상황',
      definition: '상대가 공격하는 척(페인트)만 해도 가드를 크게 움직이거나 뒤로 물러나 버려, 실제 공격이 들어올 빈틈이 생기거나 주도권을 잃는 상황입니다.',
      principle: '페인트는 반응을 끌어내기 위한 동작이다 — 반응의 크기를 줄이고, 반응하더라도 정해 둔 짧은 동작만 하면 페인트의 효과가 사라진다',
      options: [
        { name: '손이 아니라 어깨·골반·발을 보기', how: '진짜 공격은 체중 이동(어깨·골반이 같이 움직이고 앞발이 들어옴)이 따라옵니다. 손만 움직이고 몸이 따라오지 않으면 페인트일 가능성이 큽니다.', pros: '원인(속는 이유)을 직접 줄입니다.', cons: '익숙해질 때까지 반응이 늦어진다고 느낄 수 있습니다.', techniqueIds: [] },
        { name: '거리로 반응을 줄이기', how: '상대 공격이 닿지 않는 거리에서는 반응하지 않기로 정합니다. 거리 밖의 페인트는 무시해도 맞지 않습니다.', pros: '반응할 필요 자체를 줄입니다.', cons: '거리 감각이 정확해야 합니다.', techniqueIds: byNames('Range Management') },
        { name: '정해 둔 작은 반응만 하기', how: '반응하더라도 가드를 턱 앞에 고정하거나 반 발만 빠지는 식으로 동작을 작게 정해 둡니다. 크게 피하지 않으니 빈틈이 생기지 않습니다.', pros: '반응해도 위험이 작습니다.', cons: '같은 반응만 반복하면 상대가 그 반응을 다시 노릴 수 있습니다.', techniqueIds: byNames('High Guard') },
        { name: '내가 먼저 페인트로 주도권 가져오기', how: '상대가 페인트를 걸기 전에 내가 먼저 페인트·잽으로 상대를 반응하게 만듭니다.', pros: '상대가 페인트를 쓸 여유를 줄입니다.', cons: '공격적인 운영이라 체력 소모가 큽니다.', techniqueIds: byNames('Jab Feint', 'Shoulder Feint', 'Hand Feint') },
      ],
      queries: ['how to stop reacting to feints boxing', 'reading feints combat sports drill'],
      safety: null,
    };
  }
  return null;
}

export function situationText(s: Situation, stance: string | null): string {
  const tech = (ids: string[]) => ids.map((id) => allTechniques.find((t) => t.id === id)).filter((t): t is Technique => !!t).map(label);
  const lines = [`■ 상황 정의 — ${s.title}`, s.definition, '', `■ 핵심 원리 (앱의 판단)`, `- ${s.principle}.`, '', '■ 대응 선택지와 장단점 (앱의 판단)'];
  s.options.forEach((o, i) => {
    const t = tech(o.techniqueIds);
    lines.push(`${i + 1}. ${o.name}`, `   방법: ${o.how}`, `   장점: ${o.pros}`, `   단점: ${o.cons}`, ...(t.length ? [`   MARTIALDEX 관련 기록: ${t.join(', ')}`] : []));
  });
  if (stance) lines.push('', `■ 내 프로필과 연결`, `- 프로필의 기본 스탠스는 ${stance}입니다. 위 선택지에서 "앞손·앞발"은 ${stance === '오소독스' ? '왼손·왼발' : stance === '사우스포' ? '오른손·오른발' : '그때 앞에 있는 쪽'}을 뜻합니다.`);
  if (s.safety) lines.push('', `※ ${s.safety}`);
  return lines.join('\n');
}

void STRIKING_ARTS;
void GRAPPLING_ARTS;
