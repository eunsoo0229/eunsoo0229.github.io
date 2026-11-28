import { getMartialArt } from '../loadData';
import {
  ART_RULES,
  BEHAVIOR_LABEL,
  BEHAVIOR_RULES,
  BEHAVIOR_WANTS,
  CATEGORY_WANTS,
  DIFFICULTY_LABEL,
  DIFFICULTY_RULES,
  FEATURE_LABEL,
  GOAL_LABEL,
  GOAL_RULES,
  GOAL_WANTS,
  HARM_RE,
  KIND_RULES,
  MMA_ARTS,
  RANGE_LABEL,
  RANGE_RULES,
  RANGE_WANTS,
  TYPE_RULES,
  TYPO_FIXES,
  type Rule,
} from './lexicon';
import { dbNameWords, findMentioned, KOREAN_TERMS, resolveName } from './techniqueIndex';
import type { Analysis, Feature, FieldValue, Goal, QuickCategory } from './types';

// Rule-based reading of the user's sentence: every field is set only by words that are actually in it (the
// evidence is kept and shown). A field the user did not give stays empty — "선택적 조건", never filled with a guess.

export function normalize(text: string): string {
  let s = text.normalize('NFC').toLowerCase().replace(/[“”"'`]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of TYPO_FIXES) s = s.replace(re, to);
  return s;
}

function matchAll<T>(rules: Rule<T>[], s: string, compact: string): FieldValue<T>[] {
  const out: FieldValue<T>[] = [];
  for (const r of rules) {
    const m = s.match(r.re) ?? compact.match(r.re);
    if (m && !out.some((o) => o.value === r.value)) out.push({ value: r.value, evidence: [m[0].trim()], source: 'rule' });
  }
  return out;
}

function first<T>(rules: Rule<T>[], s: string, compact: string): FieldValue<T> | null {
  return matchAll(rules, s, compact)[0] ?? null;
}

function addWants(into: Partial<Record<Feature, number>>, add: Partial<Record<Feature, number>>, scale = 1) {
  for (const [k, v] of Object.entries(add) as [Feature, number][]) into[k] = (into[k] ?? 0) + v * scale;
}

/** Technique-like names the DB has no record for: Latin phrases and "○○ 기술 / ○○킥" words that resolved to nothing. */
function unknownTechniqueTerms(raw: string, resolvedTerms: string[]): string[] {
  const out = new Set<string>();
  const known = resolvedTerms.map((t) => t.toLowerCase());
  const lower = raw.toLowerCase();
  const COMMON = /^(mma|ufc|bjj|jab|kick|punch|combo|setup|guard|counter|takedown|clinch|defense|attack|boxing|wrestling|judo|karate|sambo|muay|thai|and|the|for|with|when|my|me|to|of|a|an|in|on|is|it|i|want|how|what|range|step|body|high|low|best)$/;
  for (const m of lower.matchAll(/\b([a-z]{3,}(?:[ -][a-z]{3,}){0,3})\b/g)) {
    const phrase = m[1];
    const words = phrase.split(/[ -]/);
    if (words.every((w) => COMMON.test(w))) continue;
    if (resolveName(phrase) || known.includes(phrase)) continue;
    // every word belongs to some DB name ("jab cross", "lead hook") → it names real moves, not an unknown one
    if (words.every((w) => COMMON.test(w) || dbNameWords().has(w))) continue;
    out.add(phrase);
  }
  for (const m of raw.matchAll(/([가-힣A-Za-z][가-힣A-Za-z\s]{1,18}?)\s*(?:라는|이라는)\s*기술/g)) {
    const phrase = m[1].trim();
    if (!known.some((k) => phrase.toLowerCase().includes(k)) && !KOREAN_TERMS.some(([re]) => re.test(phrase))) out.add(phrase);
  }
  return [...out].slice(0, 4);
}

export function analyze(text: string, opts: { category?: QuickCategory | null; art?: string | null } = {}): Analysis {
  const normalized = normalize(text);
  const compact = normalized.replace(/\s+/g, '');
  const goals = matchAll(GOAL_RULES, normalized, compact);
  const behaviors = matchAll(BEHAVIOR_RULES, normalized, compact);
  // "마운트에서 깔렸을 때": being under someone in a position is the bottom, not the top
  if (behaviors.some((b) => b.value === 'bottom') && behaviors.some((b) => b.value === 'top') && /깔|당|밑|아래/.test(normalized)) behaviors.splice(behaviors.findIndex((b) => b.value === 'top'), 1);
  const range = first(RANGE_RULES, normalized, compact);
  let arts = matchAll(ART_RULES, normalized, compact);
  // "니를 막고", "킥을 캐치" — the opponent's attack the user wants to stop, not a technique type they want to use
  const techniqueTypes = matchAll(TYPE_RULES, normalized, compact).filter((tt) => {
    const at = normalized.indexOf(tt.evidence[0]);
    const after = at >= 0 ? normalized.slice(at + tt.evidence[0].length, at + tt.evidence[0].length + 8) : '';
    const before = at >= 0 ? normalized.slice(Math.max(0, at - 8), at) : '';
    return !/^\s*(을|를|이|가)?\s*(막|방어|피하|캐치|잡|흘리|체크|버티)/.test(after) && !/상대(가|의|는)?\s*\S*\s*$/.test(before);
  });
  const difficulty = first(DIFFICULTY_RULES, normalized, compact);
  const wantsKind = first(KIND_RULES, normalized, compact);
  const stanceM = normalized.match(/사우스포|southpaw/) ? 'southpaw' : normalized.match(/오소독스|orthodox/) ? 'orthodox' : null;
  const stance = stanceM ? { value: stanceM as 'orthodox' | 'southpaw', evidence: [stanceM === 'southpaw' ? '사우스포' : '오소독스'], source: 'rule' as const } : null;

  // a takedown named as the opponent's action is a behaviour, not the user's goal
  if (behaviors.some((b) => b.value === 'takedownAttempt')) {
    const i = goals.findIndex((g) => g.value === 'takedown');
    if (i >= 0 && !/내가.{0,10}(테이크다운|태클)/.test(normalized)) goals.splice(i, 1);
    if (!goals.some((g) => g.value === 'tdDefense' || g.value === 'counter' || g.value === 'position')) goals.unshift({ value: 'tdDefense', evidence: behaviors.find((b) => b.value === 'takedownAttempt')!.evidence, source: 'rule' });
  }
  // "방어한 뒤 … 포지션" style: keep both; "피한 뒤 반격" already reads as counter
  if (goals.some((g) => g.value === 'tdDefense')) {
    const i = goals.findIndex((g) => g.value === 'defense');
    if (i >= 0) goals.splice(i, 1);
  }

  if (opts.art) arts = [{ value: opts.art, evidence: ['필터'], source: 'filter' }, ...arts.filter((a) => a.value !== opts.art)];
  const cat = opts.category ? CATEGORY_WANTS[opts.category] : null;
  if (cat?.arts && !arts.length) arts = cat.arts.slice(0, 1).map((a) => ({ value: a, evidence: [cat.label], source: 'category' as const }));

  const offenseGoals: Goal[] = ['attack', 'takedown', 'submission', 'position', 'clinch'];
  const defenseGoals: Goal[] = ['defense', 'tdDefense', 'escape', 'counter', 'distance'];
  const off = goals.some((g) => offenseGoals.includes(g.value));
  const def = goals.some((g) => defenseGoals.includes(g.value));
  const intent: Analysis['intent'] = off || def ? { value: off && def ? 'mixed' : off ? 'offense' : 'defense', evidence: goals.map((g) => g.evidence[0]), source: 'rule' } : null;

  const preferArts = arts.flatMap((a) => (a.value === 'mixed-martial-arts' ? MMA_ARTS : [a.value]));
  const found = findMentioned(normalized, preferArts);
  // a named technique the user wants to USE (not "상대가 X", not "내 X에 반응" = the move before) → asked-for family
  const mentioned = found.map(({ it, term }) => {
    const at = normalized.indexOf(term.toLowerCase());
    const before = at >= 0 ? normalized.slice(Math.max(0, at - 10), at) : '';
    const after = at >= 0 ? normalized.slice(at + term.length, at + term.length + 10) : '';
    const opponents = /상대(가|의|는)?\s*\S*\s*$/.test(before) || /^\s*(을|를|이|가)?\s*(막|방어|피하|캐치|흘리|체크|버티|많이|자주)/.test(after);
    const preceding = /내\s*$/.test(before) || /^\s*(에|을|를)?\s*(반응|다음|후|뒤|이후)/.test(after) || /^\s*(다음|후|뒤|이후)/.test(after);
    return { techniqueId: it.t.id, name: it.t.name, martialArt: it.t.martialArt, term, wanted: !opponents && !preceding };
  });
  const unknownTerms = unknownTechniqueTerms(text, found.map((f) => f.term).concat(found.map((f) => f.it.t.name)));

  const harm = normalized.match(HARM_RE);
  const safety = { blocked: !!harm, terms: harm ? [harm[0].trim()] : [] };

  const wanted: Partial<Record<Feature, number>> = {};
  for (const g of goals) addWants(wanted, GOAL_WANTS[g.value]);
  for (const b of behaviors) addWants(wanted, BEHAVIOR_WANTS[b.value]);
  if (range) addWants(wanted, RANGE_WANTS[range.value], 0.7);
  for (const tt of techniqueTypes) addWants(wanted, { [tt.value]: 3 });
  if (cat) addWants(wanted, cat.wants, goals.length || behaviors.length ? 0.6 : 1.2);

  const summary: Analysis['summary'] = [];
  if (goals.length) summary.push({ label: '원하는 목적', value: goals.map((g) => GOAL_LABEL[g.value]).join(' · ') });
  if (behaviors.length) summary.push({ label: '상황·상대 행동', value: behaviors.map((b) => BEHAVIOR_LABEL[b.value]).join(' · ') });
  if (range) summary.push({ label: '거리', value: RANGE_LABEL[range.value] });
  if (arts.length) summary.push({ label: '관련 종목', value: arts.map((a) => getMartialArt(a.value)?.nameKo ?? a.value).join(' · ') });
  if (intent) summary.push({ label: '공격/방어', value: intent.value === 'mixed' ? '공격·방어 모두' : intent.value === 'offense' ? '공격' : '방어' });
  if (techniqueTypes.length) summary.push({ label: '원하는 기술 유형', value: techniqueTypes.map((t) => FEATURE_LABEL[t.value]).join(' · ') });
  if (difficulty) summary.push({ label: '난이도', value: DIFFICULTY_LABEL[difficulty.value] });
  if (wantsKind) summary.push({ label: '추천 형태', value: wantsKind.value === 'setup' ? '셋업' : wantsKind.value === 'combo' ? '콤보' : '단일 기술' });
  if (mentioned.length) summary.push({ label: '언급한 기술', value: mentioned.map((m) => m.name).join(' · ') });
  const topWanted = (Object.entries(wanted) as [Feature, number][]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (topWanted.length) summary.push({ label: '전술 유형 (찾는 기술 성격)', value: topWanted.map(([f]) => FEATURE_LABEL[f]).join(' · ') });

  const signals = goals.length + behaviors.length + (range ? 1 : 0) + arts.length + techniqueTypes.length + mentioned.length + (cat ? 1 : 0);
  const confidence = Math.min(1, signals / 4);

  return {
    text,
    normalized,
    goals,
    behaviors,
    range,
    arts,
    intent,
    techniqueTypes,
    difficulty,
    stance,
    wantsKind,
    mentioned,
    unknownTerms,
    summary,
    safety,
    wanted,
    confidence,
    ai: { used: false, ok: false, message: null },
  };
}
