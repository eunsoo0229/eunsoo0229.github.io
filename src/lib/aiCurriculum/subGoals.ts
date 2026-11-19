import type { GoalAnalysis, GoalIntent, RawSubGoal } from './types';
import { classifyIntentsFromText } from './intentClassifier';
import { MMA_MARTIAL_ART_ID } from '../mmaCurriculum/types';

// 복합 자연어 요청의 학습 목표 분리 — "스탠딩 백에서 탈출한 뒤 테이크다운으로
// 이어지는 학습"은 서로 다른 두 목표(탈출 / 테이크다운 연결)라서, 하나의 검색
// 묶음과 하나의 근거 개수로 판정하면 한쪽 목표가 통째로 검색되지 않거나(실제
// 재현: 추가 검색 6회가 모두 탈출 주제) 다른 상황의 자료가 근거로 섞인다(사이드
// 컨트롤 하위의 서브미션이 바디 트라이앵글 대응의 근거로 통과).
// Gemini의 목표 분석(analyzeGoal — 같은 호출, 추가 비용 없음)이 subGoals를 주면
// 그것을 쓰고, 없거나 연결어로 나눈 것보다 적으면 아래의 결정적 분해를 쓴다.

/** A fixed, small vocabulary of positions / situations and technique families, Korean + English + common technique names. */
export type ConceptKind = 'position' | 'action';
export interface Concept {
  key: string;
  kind: ConceptKind;
  /** English terms, matched on word boundaries. */
  en: string[];
  /** Korean terms, matched as substrings. */
  ko: string[];
  /** Clean English phrase for a search query. */
  searchTerm: string;
}

export const CONCEPTS: Concept[] = [
  // positions / situations
  { key: 'standing_back', kind: 'position', searchTerm: 'standing back control', en: ['standing back', 'standing rear', 'rear body lock', 'rear bodylock', 'body lock from behind', 'from behind', 'go behind', 'standing back take', 'rear waist lock', 'waist lock from behind'], ko: ['스탠딩 백', '스탠딩백', '서서 백', '서 있는 상태에서 백', '리어 바디락', '뒤에서 잡', '뒤를 잡힌', '백 바디락', '허리를 뒤에서'] },
  { key: 'back_control', kind: 'position', searchTerm: 'back control', en: ['back control', 'back mount', 'rear mount', 'back position', 'taking the back', 'back take', 'seatbelt', 'seat belt', 'rear naked'], ko: ['백 컨트롤', '백컨트롤', '백 마운트', '백마운트', '백 포지션', '백포지션', '백을 잡', '백 잡', '백테이크', '백 테이크', '시트벨트'] },
  { key: 'body_triangle', kind: 'position', searchTerm: 'body triangle', en: ['body triangle'], ko: ['바디 트라이앵글', '바디트라이앵글'] },
  { key: 'seated', kind: 'position', searchTerm: 'seated', en: ['seated', 'sitting', 'sit up', 'sit-up'], ko: ['앉은', '앉아', '앉은 상태'] },
  { key: 'mount', kind: 'position', searchTerm: 'mount', en: ['full mount', 'mount', 'mounted'], ko: ['마운트'] },
  { key: 'side_control', kind: 'position', searchTerm: 'side control', en: ['side control', 'side mount', 'cross side', 'kesa gatame', '100 kilos'], ko: ['사이드 컨트롤', '사이드컨트롤', '사이드 마운트', '곁누르기'] },
  { key: 'guard', kind: 'position', searchTerm: 'guard', en: ['closed guard', 'half guard', 'butterfly guard', 'open guard', 'de la riva', 'spider guard', 'guard'], ko: ['클로즈드 가드', '하프 가드', '하프가드', '버터플라이', '오픈 가드', '가드'] },
  { key: 'turtle', kind: 'position', searchTerm: 'turtle position', en: ['turtle'], ko: ['터틀', '거북'] },
  { key: 'north_south', kind: 'position', searchTerm: 'north south', en: ['north south', 'north-south'], ko: ['노스 사우스', '노스사우스'] },
  { key: 'knee_on_belly', kind: 'position', searchTerm: 'knee on belly', en: ['knee on belly', 'knee-on-belly', 'knee ride'], ko: ['니 온 벨리', '니온벨리'] },
  { key: 'clinch', kind: 'position', searchTerm: 'clinch', en: ['clinch', 'plum', 'collar tie', 'over under', 'over-under', 'underhook', 'overhook'], ko: ['클린치', '빰', '칼라 타이', '언더훅', '오버훅'] },
  { key: 'cage', kind: 'position', searchTerm: 'against the cage', en: ['cage', 'fence'], ko: ['케이지', '펜스', '철창'] },
  { key: 'front_headlock', kind: 'position', searchTerm: 'front headlock', en: ['front headlock', 'front head lock', 'snap down'], ko: ['프론트 헤드락', '프론트헤드락', '스냅 다운'] },
  { key: 'open_stance', kind: 'position', searchTerm: 'standing range', en: ['outside range', 'long range', 'kicking range', 'boxing range'], ko: ['원거리', '중거리', '타격 거리'] },
  // technique families / actions
  { key: 'escape', kind: 'action', searchTerm: 'escape', en: ['escape', 'escapes', 'escaping', 'get out', 'getting out', 'break free', 'break the lock', 'breaking the lock', 'peel', 'peeling', 'unlock', 'survive', 'sit out', 'sit-out', 'switch', 'granby', 'stand up', 'stand-up', 'hand fight', 'hand fighting', 'break the grip', 'strip the grip'], ko: ['탈출', '빠져나', '빠져 나', '이스케이프', '풀어', '풀기', '벗어나', '스위치', '시트아웃', '시트 아웃', '그랜비', '스탠드업', '그립을 끊', '그립 끊'] },
  { key: 'defense', kind: 'action', searchTerm: 'defense', en: ['defense', 'defence', 'defend', 'defending', 'block', 'prevent', 'counter', 'stop'], ko: ['방어', '디펜스', '막기', '막는', '막아', '대응', '카운터'] },
  { key: 'takedown', kind: 'action', searchTerm: 'takedown', en: ['takedown', 'takedowns', 'take down', 'double leg', 'single leg', 'ankle pick', 'body lock takedown', 'fireman', "fireman's carry", 'high crotch', 'duck under', 'trip', 'throw', 'suplex', 'mat return', 'outside trip', 'inside trip', 'foot sweep', 'hip toss', 'knee tap', 'snatch single'], ko: ['테이크다운', '태클', '더블레그', '더블 레그', '싱글렉', '싱글 렉', '앵클 픽', '앵클픽', '던지기', '메치기', '넘기기', '바디락 테이크다운', '매트 리턴', '싱글 레그', '싱글레그', '더블 레그', '더블레그 테이크다운'] },
  { key: 'submission', kind: 'action', searchTerm: 'submission', en: ['submission', 'submissions', 'choke', 'strangle', 'armbar', 'arm bar', 'kimura', 'americana', 'triangle choke', 'guillotine', 'arm lock', 'armlock', 'ankle lock', 'foot lock', 'footlock', 'leg lock', 'wrist lock', 'heel hook', 'omoplata', 'crank', 'arm triangle', 'darce', "d'arce", 'anaconda', 'ezekiel', 'bow and arrow', 'calf slicer', 'toe hold', 'kneebar', 'knee bar'], ko: ['서브미션', '초크', '조르기', '암바', '기무라', '아메리카나', '트라이앵글 초크', '길로틴', '관절기', '암락', '앵클락', '앵클 락', '풋락', '레그락', '힐훅', '오모플라타', '니바', '다스', '아나콘다', '에제키엘'] },
  { key: 'sweep', kind: 'action', searchTerm: 'sweep', en: ['sweep', 'sweeps', 'reversal'], ko: ['스윕', '리버설'] },
  { key: 'guard_pass', kind: 'action', searchTerm: 'guard pass', en: ['guard pass', 'passing', 'pass the guard'], ko: ['가드 패스', '가드패스', '패스'] },
  { key: 'strike', kind: 'action', searchTerm: 'striking', en: ['punch', 'jab', 'cross', 'uppercut', 'kick', 'knee strike', 'elbow', 'strike', 'striking', 'combo', 'combination'], ko: ['펀치', '잽', '훅', '어퍼', '킥', '니킥', '엘보', '타격', '콤비네이션', '콤보'] },
];

const BY_KEY = new Map(CONCEPTS.map((c) => [c.key, c]));

/** Positions that describe the same situation family — mentioning one of these is NOT a different position. */
const RELATED_POSITIONS: Record<string, string[]> = {
  standing_back: ['back_control', 'clinch', 'cage'],
  back_control: ['standing_back', 'body_triangle', 'seated', 'turtle'],
  body_triangle: ['back_control', 'seated'],
  seated: ['body_triangle', 'back_control', 'guard'],
  turtle: ['back_control', 'front_headlock'],
  front_headlock: ['turtle'],
  clinch: ['cage', 'standing_back'],
  cage: ['clinch', 'standing_back'],
  mount: [],
  side_control: ['north_south', 'knee_on_belly'],
  north_south: ['side_control'],
  knee_on_belly: ['side_control'],
  guard: ['seated'],
  open_stance: [],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const EN_RE = new Map<string, RegExp>();
function enRe(term: string): RegExp {
  let re = EN_RE.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z])${escapeRe(term).replace(/\\ |\s+/g, '[\\s-]*')}([^a-z]|$)`, 'i');
    EN_RE.set(term, re);
  }
  return re;
}

/** Concept keys named in a text. "back mount" is back_control, never also mount; "body triangle" is never a triangle choke. */
// longer, more specific phrases first so their words don't also count as a shorter concept
const ENTRIES = CONCEPTS.flatMap((c) => [...c.en.map((t) => ({ c, t, en: true })), ...c.ko.map((t) => ({ c, t, en: false }))]).sort((a, b) => b.t.length - a.t.length);

export function conceptsIn(text: string): Set<string> {
  const found = new Set<string>();
  if (!text) return found;
  let lower = text.toLowerCase();
  for (const { c, t, en } of ENTRIES) {
    if (en ? enRe(t).test(lower) : lower.includes(t)) {
      found.add(c.key);
      // consume the matched phrase so "back mount" doesn't leave "mount" behind
      lower = en ? lower.replace(new RegExp(escapeRe(t).replace(/\\ |\s+/g, '[\\s-]*'), 'gi'), ' # ') : lower.split(t).join(' # ');
    }
  }
  return found;
}

export function positionsOf(keys: Iterable<string>): string[] {
  return [...keys].filter((k) => BY_KEY.get(k)?.kind === 'position');
}
export function actionsOf(keys: Iterable<string>): string[] {
  return [...keys].filter((k) => BY_KEY.get(k)?.kind === 'action');
}
/** Most specific first — the situation a part is really about when it names several ("앉은 상태 + 바디 트라이앵글"). */
const POSITION_SPECIFICITY = ['body_triangle', 'standing_back', 'front_headlock', 'knee_on_belly', 'north_south', 'turtle', 'side_control', 'mount', 'back_control', 'clinch', 'cage', 'guard', 'seated', 'open_stance'];
export function mostSpecificPosition(keys: string[]): string | null {
  return POSITION_SPECIFICITY.find((k) => keys.includes(k)) ?? keys[0] ?? null;
}

export function relatedPositions(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    out.add(k);
    for (const r of RELATED_POSITIONS[k] ?? []) out.add(r);
  }
  return out;
}

/**
 * Specific named techniques a learning part can be ABOUT ("싱글렉만 집중") — narrower than a technique family:
 * a part naming one of these only accepts DB techniques that are that technique.
 */
const FOCUS: { key: string; en: string[]; ko: string[] }[] = [
  { key: 'single_leg', en: ['single leg', 'single-leg', 'high single', 'low single', 'snatch single'], ko: ['싱글렉', '싱글 렉', '싱글 레그', '싱글레그'] },
  { key: 'double_leg', en: ['double leg', 'double-leg', 'blast double'], ko: ['더블렉', '더블 렉', '더블 레그', '더블레그'] },
  { key: 'ankle_pick', en: ['ankle pick'], ko: ['앵클 픽', '앵클픽'] },
  { key: 'high_crotch', en: ['high crotch'], ko: ['하이 크로치', '하이크로치'] },
  { key: 'armbar', en: ['armbar', 'arm bar', 'juji gatame'], ko: ['암바', '십자꺾기', '주지가타메'] },
  { key: 'kimura', en: ['kimura'], ko: ['기무라', '키무라'] },
  { key: 'triangle_choke', en: ['triangle choke', 'sankaku'], ko: ['트라이앵글 초크', '삼각조르기'] },
  { key: 'rear_naked_choke', en: ['rear naked choke', 'rnc'], ko: ['리어 네이키드 초크', '리어네이키드'] },
  { key: 'guillotine', en: ['guillotine'], ko: ['길로틴'] },
  { key: 'jab', en: ['jab'], ko: ['잽'] },
  { key: 'low_kick', en: ['low kick', 'leg kick'], ko: ['로우킥', '로우 킥'] },
  { key: 'teep', en: ['teep', 'push kick', 'front kick'], ko: ['팁', '푸시킥', '프론트킥', '앞차기'] },
];
export function focusIn(text: string): string[] {
  const lower = text.toLowerCase();
  return FOCUS.filter((f) => f.en.some((t) => enRe(t).test(lower)) || f.ko.some((t) => lower.includes(t))).map((f) => f.key);
}

export type SubGoalRole = 'core' | 'follow_up';
export interface SubGoal {
  id: string;
  /** The learner's own words for this part (Korean as typed). */
  label: string;
  role: SubGoalRole;
  intents: GoalIntent[];
  /** Clean English phrases for web search (never Hangul). */
  searchTopics: string[];
  /** Position / situation concepts this part happens in — a follow-up also inherits the core part's positions. */
  positions: string[];
  /** Technique families this part asks for (escape, takedown, submission …). */
  actions: string[];
  /** Specific named techniques the part is limited to ("싱글렉" → single_leg); empty = any technique of the family. */
  focus: string[];
}

const HANGUL = /[가-힣]/;
const VALID_INTENTS: GoalIntent[] = ['attack', 'defense', 'escape', 'counter', 'connection', 'fundamentals'];
// "A한 뒤 B", "A 이후 B", "A에서 B로 이어지는", "A하고 나서 B" — sequence connectors between learning parts
const CONNECTOR = /\s*(?:(?:한|하고|된|당한)\s*)?(?:뒤에?|후에?|이후에?|다음에?|나서)\s+|\s*(?:으로|로)\s*이어(?:지는|지고|서|진)?\s*|\s+이어서\s+|\s+그리고\s+|\s*,\s*|\s+then\s+|\s+after\s+that\s+/i;
// "걸린/당한/잡힌 상황에 대응" — being caught in a position means escaping/defending it
const CAUGHT = /걸린|걸렸|당한|당했|잡힌|잡혔|깔린|깔렸|갇힌|붙잡|trapped|caught|stuck/i;

function cleanTopic(t: string): string {
  // "standing rear standing escape" → "standing rear escape" (observed Gemini output repeated words)
  const seen = new Set<string>();
  return t
    .trim()
    .split(/\s+/)
    .filter((w) => {
      const k = w.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(' ');
}

function artTerm(martialArt: string): string {
  if (martialArt === MMA_MARTIAL_ART_ID) return 'MMA';
  return martialArt === 'bjj' ? 'bjj' : martialArt.replace(/-/g, ' ');
}

function intentsForSegment(text: string, actions: string[]): GoalIntent[] {
  const set = new Set<GoalIntent>(classifyIntentsFromText(text));
  if (CAUGHT.test(text) || actions.includes('escape')) set.add('escape');
  if (actions.includes('defense') || /대응/.test(text)) set.add('defense');
  if (actions.some((a) => ['takedown', 'submission', 'strike', 'sweep', 'guard_pass'].includes(a))) set.add('attack');
  // a part that both escapes and attacks gets both — but "대응/탈출" parts never pick up attack from the sentence's other half
  return VALID_INTENTS.filter((i) => set.has(i));
}

function composeTopic(martialArt: string, positions: string[], actions: string[], after: string | null): string {
  const pos = positions.map((k) => BY_KEY.get(k)!.searchTerm);
  const act = actions.filter((a) => a !== 'defense' || actions.length === 1).map((k) => BY_KEY.get(k)!.searchTerm);
  const core = [...pos, ...act].join(' ');
  const base = after ? `${act.join(' ') || core} after ${after}` : core;
  return cleanTopic(`${artTerm(martialArt)} ${base}`);
}

/** Deterministic split on sequence connectors; parts naming no position or technique family ("학습", "내용") are dropped. */
export function splitGoalText(freeText: string): { text: string; positions: string[]; actions: string[] }[] {
  return freeText
    .split(CONNECTOR)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => {
      const c = conceptsIn(text);
      // "스탠딩 백" also implies back control for relevance, but keep the more specific one only
      return { text, positions: positionsOf(c), actions: actionsOf(c) };
    })
    .filter((s) => s.positions.length > 0 || s.actions.length > 0);
}

function sanitizeRaw(raw: unknown): RawSubGoal[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      label: typeof x.label === 'string' ? x.label.trim() : '',
      role: x.role === 'follow_up' ? ('follow_up' as const) : ('core' as const),
      intents: Array.isArray(x.intents) ? (x.intents.filter((i) => VALID_INTENTS.includes(i as GoalIntent)) as GoalIntent[]) : [],
      searchTopics: Array.isArray(x.searchTopics) ? x.searchTopics.filter((t): t is string => typeof t === 'string' && !!t.trim() && !HANGUL.test(t)).map(cleanTopic) : [],
      situation: typeof x.situation === 'string' ? x.situation : '',
    }))
    .filter((x) => x.label.length > 0);
}

/**
 * The learning parts of one request. A single-part request returns exactly one core part built from the
 * existing analysis (same topics as before), so ordinary requests keep their old search plan.
 */
export function resolveSubGoals(analysis: Pick<GoalAnalysis, 'subGoals' | 'searchTopics' | 'intents' | 'martialArt' | 'summary' | 'goals'>, freeText: string): SubGoal[] {
  const split = splitGoalText(freeText);
  const fromModel = sanitizeRaw(analysis.subGoals);
  const useModel = fromModel.length >= Math.max(2, split.length);
  let parts: SubGoal[];
  if (useModel) {
    parts = fromModel.map((r, i) => {
      const c = conceptsIn(`${r.label} ${r.situation ?? ''} ${r.searchTopics.join(' ')}`);
      const actions = actionsOf(c);
      return {
        id: `g${i + 1}`,
        label: r.label,
        role: i === 0 ? 'core' : r.role,
        intents: r.intents.length > 0 ? r.intents : intentsForSegment(r.label, actions),
        searchTopics: r.searchTopics.length > 0 ? r.searchTopics.slice(0, 2) : [],
        positions: positionsOf(c),
        actions,
        focus: focusIn(r.label),
      };
    });
  } else if (split.length >= 2) {
    parts = split.map((s, i) => ({
      id: `g${i + 1}`,
      label: s.text,
      role: i === 0 ? 'core' : 'follow_up',
      intents: intentsForSegment(s.text, s.actions),
      searchTopics: [],
      positions: s.positions,
      actions: s.actions,
      focus: focusIn(s.text),
    }));
  } else {
    const c = conceptsIn(`${freeText} ${analysis.goals.join(' ')} ${analysis.searchTopics.join(' ')}`);
    return [
      {
        id: 'g1',
        label: freeText.trim(),
        role: 'core',
        intents: [...analysis.intents],
        searchTopics: analysis.searchTopics.filter((t) => t.trim() && !HANGUL.test(t)).map(cleanTopic).slice(0, 3),
        positions: positionsOf(c),
        actions: actionsOf(c),
        focus: focusIn(freeText),
      },
    ];
  }
  // a follow-up continues from the core situation: it inherits the core's positions for relevance,
  // and gets a search topic phrased "<its technique family> after <core topic>" when it has none
  const core = parts[0];
  const coreTopic = composeTopic(analysis.martialArt, core.positions, core.actions, null).replace(new RegExp(`^${escapeRe(artTerm(analysis.martialArt))}\\s+`, 'i'), '');
  for (const p of parts) {
    if (p.role === 'follow_up') p.positions = [...new Set([...p.positions, ...core.positions])];
    if (p.searchTopics.length === 0) {
      p.searchTopics = [p === core || p.role === 'core' ? composeTopic(analysis.martialArt, p.positions, p.actions, null) : composeTopic(analysis.martialArt, [], p.actions, coreTopic)];
    }
  }
  return parts;
}

/**
 * The analysis narrowed to the parts that have evidence (부분 생성): phrases that only name an excluded part's
 * technique family are dropped, a phrase naming both is replaced by the included part's label, and the intents /
 * search topics come from the included parts. Pure — returns a new object.
 */
export function restrictAnalysisToSubGoals(analysis: GoalAnalysis, included: SubGoal[], excluded: SubGoal[]): GoalAnalysis {
  const inActions = new Set(included.flatMap((g) => g.actions));
  const exActions = new Set(excluded.flatMap((g) => g.actions).filter((a) => !inActions.has(a)));
  const fix = (phrases: string[]) => {
    const out: string[] = [];
    for (const p of phrases) {
      const acts = actionsOf(conceptsIn(p));
      const namesExcluded = acts.some((a) => exActions.has(a));
      const namesIncluded = acts.some((a) => inActions.has(a));
      if (namesExcluded && !namesIncluded) continue;
      if (namesExcluded && namesIncluded) out.push(...included.map((g) => g.label));
      else out.push(p);
    }
    return [...new Set(out)];
  };
  const intents = [...new Set(included.flatMap((g) => g.intents))];
  return {
    ...analysis,
    weaknesses: fix(analysis.weaknesses),
    desiredStyle: fix(analysis.desiredStyle),
    desiredTechniques: fix(analysis.desiredTechniques),
    goals: fix(analysis.goals).length > 0 ? fix(analysis.goals) : included.map((g) => g.label),
    priority: fix(analysis.priority),
    intents: intents.length > 0 ? intents : analysis.intents,
    searchTopics: included.flatMap((g) => g.searchTopics),
    summary: `${analysis.summary} (근거 부족으로 제외: ${excluded.map((g) => g.label).join(', ')})`,
  };
}
