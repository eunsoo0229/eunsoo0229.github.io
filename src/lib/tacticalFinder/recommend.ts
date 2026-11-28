import { getMartialArt } from '../loadData';
import { hasMotion3d } from '../motion3d/catalog';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { analyze } from './analyze';
import { curatedLibrary, personalLibrary, type LibraryEntry } from './comboLibrary';
import { BEHAVIOR_LABEL, BEHAVIOR_RULES, BEHAVIOR_WANTS, CATEGORY_WANTS, DIFFICULTY_LABEL, FEATURE_LABEL, GOAL_LABEL, GOAL_WANTS, MMA_ARTS, RANGE_LABEL, RANGE_WANTS } from './lexicon';
import { masteryLabel, readPersonal, type PersonalContext } from './personal';
import { indexedById, resolveName, techniqueIndex, type IndexedTechnique } from './techniqueIndex';
import type { Analysis, Feature, Filters, FinderResult, Recommendation, ScorePart, StepRef } from './types';

// Ranking = points the evidence earns, nothing else. Each card shows its parts (목적 · 상황 · 연결 · 종목 · 난이도 ·
// 데이터 신뢰도 · 개인화); a part the input says nothing about is left out of the total instead of being guessed, and the
// final number is points earned ÷ points possible. No success rate or probability is ever shown.

type Wants = Partial<Record<Feature, number>>;

const DEFAULT_FILTERS: Filters = { art: null, difficulty: null, kind: null, count: 5, personal: true, category: null };
const cache = new Map<string, FinderResult>();
const CACHE_MAX = 40;

function add(into: Wants, w: Wants, scale = 1) {
  for (const [k, v] of Object.entries(w) as [Feature, number][]) into[k] = (into[k] ?? 0) + v * scale;
}

function wantsOf(a: Analysis, category: Filters['category']): { goal: Wants; situation: Wants } {
  const goal: Wants = {};
  const situation: Wants = {};
  for (const g of a.goals) add(goal, GOAL_WANTS[g.value]);
  for (const t of a.techniqueTypes) add(goal, { [t.value]: 3 });
  if (category) add(goal, CATEGORY_WANTS[category].wants, a.goals.length ? 0.6 : 1.2);
  for (const b of a.behaviors) add(situation, BEHAVIOR_WANTS[b.value]);
  if (a.range) add(situation, RANGE_WANTS[a.range.value], 0.8);
  return { goal, situation };
}

/** Share of the top wanted weight a feature set covers (0..1) + which wanted features it has. */
function fit(w: Wants, features: Set<Feature>, fw?: Partial<Record<Feature, number>>): { ratio: number; hit: Feature[] } {
  const entries = (Object.entries(w) as [Feature, number][]).sort((x, y) => y[1] - x[1]);
  if (!entries.length) return { ratio: 0, hit: [] };
  const top = entries.slice(0, 3).reduce((s, [, v]) => s + v, 0);
  const hit = entries.filter(([f]) => features.has(f));
  const got = hit.reduce((s, [f, v]) => s + v * (fw?.[f] ?? 1), 0);
  return { ratio: Math.min(1, got / top), hit: hit.map(([f]) => f) };
}

function allowedArts(a: Analysis): string[] | null {
  if (!a.arts.length) return null;
  return [...new Set(a.arts.flatMap((x) => (x.value === 'mixed-martial-arts' ? MMA_ARTS : [x.value])))];
}

function artLabel(id: string): string {
  return getMartialArt(id)?.nameKo ?? id;
}

const DIFF_ORDER = ['beginner', 'intermediate', 'advanced'];

interface Scored<T> {
  item: T;
  parts: ScorePart[];
  score: number;
  reasons: string[];
}

function total(parts: ScorePart[]): number {
  const max = parts.reduce((s, p) => s + p.max, 0);
  return max ? Math.round((100 * parts.reduce((s, p) => s + p.points, 0)) / max) : 0;
}

function mentionedLinks(a: Analysis): Map<string, string> {
  const links = new Map<string, string>();
  for (const m of a.mentioned) {
    const it = indexedById(m.techniqueId);
    if (!it) continue;
    const c = getTechniqueConnections(it.t);
    for (const x of c.counter) links.set(x.techniqueId, `언급한 ${m.name}의 카운터로 DB에 기록됨`);
    for (const x of c.escape) links.set(x.techniqueId, `언급한 ${m.name}의 방어·탈출로 DB에 기록됨`);
    for (const x of c.next) if (!links.has(x.techniqueId)) links.set(x.techniqueId, `언급한 ${m.name} 다음 연결로 DB에 기록됨`);
    for (const x of c.prerequisite) if (!links.has(x.techniqueId)) links.set(x.techniqueId, `언급한 ${m.name}로 이어지는 기술로 DB에 기록됨`);
  }
  return links;
}

function featureEvidence(it: IndexedTechnique, hit: Feature[]): string {
  return hit
    .slice(0, 3)
    .map((f) => `${FEATURE_LABEL[f]}(${it.featureField[f] ?? '기록'})`)
    .join(', ');
}

const GROUND_FEATURES: Feature[] = ['guard', 'sweep', 'submission', 'groundTop', 'pass', 'back'];
const STAND_BEHAVIORS = ['retreat', 'pressure', 'guardHigh', 'jabReaction', 'kicks', 'punches', 'counterWaiting', 'taller', 'blocks'];
const GROUND_BEHAVIORS = ['bottom', 'top', 'inGuard', 'onBack'];

/** Standing or on the mat, from the input: a standing situation never gets ground techniques and vice versa. */
function phaseOf(a: Analysis): 'stand' | 'ground' | null {
  const groundGoal = a.goals.some((g) => ['sweep', 'submission', 'escape', 'position'].includes(g.value));
  if (a.range?.value === 'ground' || a.behaviors.some((b) => GROUND_BEHAVIORS.includes(b.value))) return 'ground';
  if (a.range) return groundGoal ? null : 'stand';
  if (a.behaviors.some((b) => STAND_BEHAVIORS.includes(b.value)) && !groundGoal) return 'stand';
  if (a.techniqueTypes.some((t) => ['punch', 'kick', 'knee', 'elbow'].includes(t.value)) && !groundGoal) return 'stand';
  return null;
}

function isGroundTech(it: IndexedTechnique): boolean {
  return it.range === 'ground' || GROUND_FEATURES.some((f) => it.features.has(f));
}
function isStrikeOnly(it: IndexedTechnique): boolean {
  return ['punch', 'kick', 'knee', 'elbow'].some((f) => it.features.has(f as Feature)) && !GROUND_FEATURES.some((f) => it.features.has(f)) && it.range !== 'ground';
}

function scoreTechnique(it: IndexedTechnique, a: Analysis, w: { goal: Wants; situation: Wants }, arts: string[] | null, links: Map<string, string>, personal: PersonalContext | null, phase: 'stand' | 'ground' | null): Scored<IndexedTechnique> | null {
  const t = it.t;
  if (arts && !arts.includes(t.martialArt)) return null;
  if (phase === 'stand' && isGroundTech(it) && !links.has(t.id)) return null;
  if (phase === 'ground' && isStrikeOnly(it)) return null;
  const g = fit(w.goal, it.features, it.weight);
  const s = fit(w.situation, it.features, it.weight);
  const family = a.mentioned.find((m) => m.wanted && (t.id === m.techniqueId || t.name.toLowerCase().includes(m.name.toLowerCase())));
  const link = links.get(t.id) ?? (family ? `요청한 기술${t.id === family.techniqueId ? '' : ` (${family.name} 계열)`}` : null);
  const hasGoal = Object.keys(w.goal).length > 0;
  const hasSit = Object.keys(w.situation).length > 0;
  if (!link && g.ratio === 0 && s.ratio === 0 && !a.behaviors.some((b) => it.behaviors.has(b.value))) return null;
  if (hasGoal && g.ratio === 0 && !link) return null; // a technique that serves none of the stated purposes is not offered
  const parts: ScorePart[] = [];
  const reasons: string[] = [];
  if (hasGoal) {
    parts.push({ key: 'goal', label: '목적 적합성', points: Math.round(35 * Math.max(g.ratio, family ? 0.7 : 0)), max: 35 });
    if (g.hit.length) reasons.push(`목적(${a.goals.map((x) => GOAL_LABEL[x.value]).join('·') || '선택한 유형'})에 맞는 특성: ${featureEvidence(it, g.hit)}`);
  }
  const behHit = a.behaviors.filter((b) => it.behaviors.has(b.value));
  if (hasSit) {
    const ratio = Math.max(s.ratio, behHit.length ? 1 : 0);
    parts.push({ key: 'situation', label: '상황 적합성', points: Math.round(25 * ratio), max: 25 });
    if (behHit.length) {
      const sent = it.ownText.find((x) => BEHAVIOR_RULES.some((r) => behHit.some((b) => b.value === r.value) && r.re.test(x.toLowerCase())) || /물러나|백스텝|압박|붙어|하이가드/.test(x)) ?? it.ownText[0];
      reasons.push(`DB 설명에 같은 상황(${behHit.map((b) => BEHAVIOR_LABEL[b.value]).join('·')})이 적혀 있음${sent ? `: “${sent.length > 110 ? `${sent.slice(0, 110)}…` : sent}”` : ''}`);
    } else if (s.hit.length) reasons.push(`상황(${[...a.behaviors.map((b) => BEHAVIOR_LABEL[b.value]), a.range ? RANGE_LABEL[a.range.value] : ''].filter(Boolean).join('·')})에 맞는 특성: ${featureEvidence(it, s.hit)}`);
  }
  if (a.mentioned.length) {
    parts.push({ key: 'connection', label: '기술 연결 관계', points: link ? 15 : 0, max: 15 });
    if (link) reasons.push(link);
  } else {
    const linkable = (t.transitions ?? []).length + (t.counters ?? []).length + (t.defenses ?? []).length > 0;
    parts.push({ key: 'connection', label: '기술 연결 관계', points: linkable ? 5 : 0, max: 5 });
    if (linkable) reasons.push('DB에 다음 연결·카운터 기록이 있어 다른 기술과 이어 쓸 수 있음');
  }
  if (arts) {
    const exact = a.arts.some((x) => x.value === t.martialArt);
    parts.push({ key: 'art', label: '종목 적합성', points: exact ? 15 : 12, max: 15 });
  }
  if (a.difficulty) {
    const want = DIFF_ORDER.indexOf(a.difficulty.value);
    const have = t.difficulty ? DIFF_ORDER.indexOf(t.difficulty) : -1;
    parts.push({ key: 'difficulty', label: '난이도 적합성', points: have < 0 ? 2 : have === want ? 5 : Math.abs(have - want) === 1 ? 2 : 0, max: 5 });
  }
  parts.push({ key: 'reliability', label: '데이터 신뢰도', points: Math.round((10 * it.richness) / 5), max: 10 });
  if (personal) {
    let p = 0;
    if (personal.arts.includes(t.martialArt)) p += 4;
    const m = personal.mastery.get(t.id);
    if (m && m !== 'proficient') p += 3;
    else if (m === 'proficient') p += 2;
    if (personal.favorites.has(t.id)) p += 3;
    parts.push({ key: 'personal', label: '개인화', points: p, max: 10 });
    if (p) reasons.push(`개인화: ${[personal.arts.includes(t.martialArt) ? '수련 종목' : '', m ? `숙련도 기록(${masteryLabel(personal, t.id)})` : '', personal.favorites.has(t.id) ? '즐겨찾기' : ''].filter(Boolean).join(', ')}`);
  }
  return { item: it, parts, score: total(parts), reasons };
}

function stepFromIt(it: IndexedTechnique): StepRef {
  return { name: it.t.name, techniqueId: it.t.id, martialArt: it.t.martialArt, inDb: true, role: null, note: null, react: null };
}

/** Role of each step, read from the step's own features and its place in the sequence (labelled as such in the UI). */
function withRoles(steps: StepRef[]): StepRef[] {
  return steps.map((s, i) => {
    if (s.role) return s;
    const f = s.techniqueId ? indexedById(s.techniqueId)?.features : null;
    const last = i === steps.length - 1;
    let role: string;
    if (s.react) role = '상대 반응 유도';
    else if (f?.has('feint')) role = '반응 유도 (페인트)';
    else if (f?.has('defense') && i === 0) role = '방어로 시작';
    else if (f?.has('tdDefense')) role = '테이크다운 차단';
    else if (f?.has('footwork')) role = '각도·거리 만들기';
    else if (i === 0 && /jab|잽/i.test(s.name)) role = '거리 측정·시야 가리기';
    else if (last && (f?.has('takedown') || f?.has('submission'))) role = '마무리 (테이크다운/서브미션)';
    else if (last) role = '마무리 공격';
    else if (i === 0) role = '시작 공격';
    else role = '연결 공격';
    return { ...s, role };
  });
}

function conditionsOf(e: { steps: StepRef[]; desc: string; purpose: string }): string[] {
  const out: string[] = [];
  for (const s of e.steps) if (s.react) out.push(`${s.react} (→ ${s.name})`);
  for (const sentence of `${e.purpose}. ${e.desc}`.split(/(?<=[.。!?])\s+/)) {
    const x = sentence.trim();
    if (x && /때|면\b|경우|순간|하면|굳으면|올라가면|내려가면|들어올/.test(x) && !out.includes(x)) out.push(x);
  }
  return out.slice(0, 3);
}

function libraryBehaviors(text: string): Set<string> {
  const s = new Set<string>();
  for (const r of BEHAVIOR_RULES) if (r.re.test(text)) s.add(r.value);
  return s;
}

function scoreEntry(e: LibraryEntry, a: Analysis, w: { goal: Wants; situation: Wants }, arts: string[] | null, mentionedIds: Set<string>, phase: 'stand' | 'ground' | null): Scored<LibraryEntry> | null {
  if (arts && e.art && !arts.includes(e.art)) return null;
  const its = e.steps.map((st) => (st.techniqueId ? indexedById(st.techniqueId) : undefined)).filter((x): x is IndexedTechnique => !!x);
  if (phase === 'ground' && !its.some(isGroundTech)) return null;
  if (phase === 'stand' && its.length && its.every(isGroundTech)) return null;
  const g = fit(w.goal, e.features);
  const s = fit(w.situation, e.features);
  const beh = libraryBehaviors(e.text);
  const behHit = a.behaviors.filter((b) => beh.has(b.value));
  const mention = e.steps.some((st) => st.techniqueId && mentionedIds.has(st.techniqueId));
  const hasGoal = Object.keys(w.goal).length > 0;
  const hasSit = Object.keys(w.situation).length > 0;
  if (!mention && g.ratio === 0 && s.ratio === 0 && !behHit.length) return null;
  if (hasGoal && g.ratio === 0 && !mention && !behHit.length) return null;
  const parts: ScorePart[] = [];
  const reasons: string[] = [];
  if (hasGoal) {
    parts.push({ key: 'goal', label: '목적 적합성', points: Math.round(35 * g.ratio), max: 35 });
    if (g.hit.length) reasons.push(`목적에 맞는 구성: ${g.hit.slice(0, 3).map((f) => FEATURE_LABEL[f]).join(', ')}`);
  }
  if (hasSit) {
    const sp = Math.max(s.ratio, behHit.length ? 1 : 0);
    parts.push({ key: 'situation', label: '상황 적합성', points: Math.round(25 * sp), max: 25 });
    if (behHit.length) reasons.push(`설명에 같은 상황이 적혀 있음: ${behHit.map((b) => BEHAVIOR_LABEL[b.value]).join(', ')}`);
    else if (s.hit.length) reasons.push(`상황에 맞는 구성: ${s.hit.slice(0, 3).map((f) => FEATURE_LABEL[f]).join(', ')}`);
  }
  parts.push({ key: 'connection', label: '기술 연결 관계', points: mention ? 15 : e.allInDb ? 10 : 4, max: 15 });
  if (mention) reasons.push('언급한 기술이 이 구성에 들어 있음');
  if (arts) parts.push({ key: 'art', label: '종목 적합성', points: a.arts.some((x) => x.value === e.art) ? 15 : 12, max: 15 });
  const sourced = e.sources.some((x) => x.url);
  parts.push({ key: 'reliability', label: '데이터 신뢰도', points: e.origin !== 'curated-library' ? 7 : !e.allInDb ? 3 : sourced ? 10 : 7, max: 10 });
  if (e.purpose) reasons.push(`목적: ${e.purpose}`);
  return { item: e, parts, score: total(parts), reasons };
}

function originLabel(o: Recommendation['origin'], e?: LibraryEntry): string {
  switch (o) {
    case 'technique-db':
      return 'MARTIALDEX 기술 DB';
    case 'curated-library':
      return e?.sources.some((s) => s.url) ? '출처 있는 콤보·셋업 라이브러리' : '운영자 정리 콤보·셋업 (특정 문헌 인용 아님)';
    case 'my-combo':
      return '내 콤보 북';
    case 'my-tactic':
      return '내 전술 셋업';
    case 'graph':
      return '시스템 생성 조합 — DB의 기술 연결 기록으로 이은 것';
    case 'ai-generated':
      return 'AI GENERATED COMBINATION';
  }
}

function techniqueCard(sc: Scored<IndexedTechnique>, personal: PersonalContext | null): Recommendation {
  const t = sc.item.t;
  const conn = getTechniqueConnections(t);
  return {
    key: `t:${t.id}`,
    kind: 'technique',
    techniqueId: t.id,
    title: t.name,
    martialArt: t.martialArt,
    artLabel: artLabel(t.martialArt),
    steps: [stepFromIt(sc.item)],
    reasons: sc.reasons,
    situations: [...new Set([t.category, ...(t.positions ?? [])].filter(Boolean))].slice(0, 4),
    difficulty: t.difficulty ? DIFFICULTY_LABEL[t.difficulty as keyof typeof DIFFICULTY_LABEL] ?? t.difficulty : null,
    score: sc.score,
    scoreParts: sc.parts,
    origin: 'technique-db',
    originLabel: originLabel('technique-db'),
    sourceLinks: [],
    purpose: sc.item.ownText[0] ?? null,
    expectedReaction: null,
    followUps: conn.next.slice(0, 3).map((c) => ({ name: c.techniqueName, techniqueId: c.techniqueId, martialArt: c.martialArt, inDb: true, role: null, note: null, react: null })),
    successConditions: [],
    ifDifferent: conn.counter.length ? [{ label: '상대가 이 기술에 대응하면 (DB의 카운터 기록)', steps: conn.counter.slice(0, 3).map((c) => ({ name: c.techniqueName, techniqueId: c.techniqueId, martialArt: c.martialArt, inDb: true, role: null, note: null, react: null })) }] : [],
    hasMotion3d: hasMotion3d(t.id),
    mastery: masteryLabel(personal, t.id),
  };
}

function entryCard(sc: Scored<LibraryEntry>, all: LibraryEntry[]): Recommendation {
  const e = sc.item;
  const steps = withRoles(e.steps);
  const firstId = e.steps[0]?.techniqueId;
  const lastId = e.steps[e.steps.length - 1]?.techniqueId;
  const alt = firstId ? all.filter((x) => x.key !== e.key && x.allInDb && x.steps[0]?.techniqueId === firstId && x.steps.map((s) => s.techniqueId).join() !== e.steps.map((s) => s.techniqueId).join()).slice(0, 2) : [];
  const lastIt = lastId ? indexedById(lastId) : undefined;
  const follow = lastIt ? getTechniqueConnections(lastIt.t).next.slice(0, 3) : [];
  return {
    key: e.key,
    kind: e.kind,
    techniqueId: null,
    title: e.title,
    martialArt: e.art,
    artLabel: e.art ? artLabel(e.art) : '',
    steps,
    reasons: sc.reasons,
    situations: [],
    difficulty: null,
    score: sc.score,
    scoreParts: sc.parts,
    origin: e.origin,
    originLabel: originLabel(e.origin, e),
    sourceLinks: e.sources,
    purpose: e.purpose || null,
    expectedReaction: e.steps.map((s) => s.react).filter(Boolean).join(' / ') || null,
    followUps: follow.map((c) => ({ name: c.techniqueName, techniqueId: c.techniqueId, martialArt: c.martialArt, inDb: true, role: null, note: null, react: null })),
    successConditions: conditionsOf(e),
    ifDifferent: alt.map((x) => ({ label: `같은 시작에서 다른 연결: ${x.title}`, steps: withRoles(x.steps) })),
    hasMotion3d: e.steps.some((s) => s.techniqueId && hasMotion3d(s.techniqueId)),
    mastery: null,
  };
}

/** DB records that ARE a combination ("Jab → Cross → Low Kick"): steps from the name, each resolved to a record. */
function dbComboSteps(it: IndexedTechnique): StepRef[] | null {
  if (!/→|->|--/.test(it.t.name)) return null;
  const parts = it.t.name.split(/\s*(?:→|->|--)\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((p) => {
    const r = resolveName(p, [it.t.martialArt]);
    return r ? stepFromIt(r) : { name: p, techniqueId: null, martialArt: null, inDb: false, role: null, note: null, react: null };
  });
}

function seqKey(steps: StepRef[]): string {
  return steps.map((s) => s.techniqueId ?? s.name.toLowerCase()).join('>');
}

const SAFE_WANTS: Wants = { defense: 3, escape: 2.5, footwork: 2, distance: 2, tdDefense: 1.5 };

export function runEngine(a: Analysis, filters: Filters, page: number, opts: { extraNotices?: FinderResult['notices'] } = {}): FinderResult {
  const t0 = performance.now();
  const notices: FinderResult['notices'] = [...(opts.extraNotices ?? [])];
  const personal = filters.personal ? readPersonal() : null;
  let w = wantsOf(a, filters.category);
  if (a.safety.blocked) {
    notices.push({ tone: 'warn', text: `상대를 다치게 하는 것을 목적으로 한 요청(“${a.safety.terms.join(', ')}”)에는 기술을 추천하지 않습니다. 대신 스포츠 훈련으로 안전하게 연습할 수 있는 방어·거리 조절·탈출 기술을 보여 드립니다.` });
    w = { goal: SAFE_WANTS, situation: {} };
  }
  const noSignal = !Object.keys(w.goal).length && !Object.keys(w.situation).length && !a.mentioned.length;
  const empty = (): FinderResult => ({ query: a.text, filters, analysis: a, techniques: [], setups: [], combos: [], alternatives: [], notices, page, hasMore: false, elapsedMs: Math.round(performance.now() - t0), cached: false, personalApplied: personal?.applied ?? [] });
  if (a.unknownTerms.length) notices.push({ tone: 'info', text: `기술 DB에서 찾지 못한 이름: ${a.unknownTerms.map((x) => `“${x}”`).join(', ')} — 이 기술의 설명은 제공하지 않습니다 (정보 부족).${noSignal ? '' : ' 나머지 조건으로 찾았습니다.'}` });
  if (noSignal) {
    notices.push({ tone: 'info', text: '입력에서 목적이나 상황을 찾지 못했습니다. “상대가 ○○할 때 ○○하고 싶어”처럼 상황과 목적을 적거나, 아래 카테고리를 골라 주세요.' });
    return empty();
  }

  const arts = a.safety.blocked ? null : allowedArts(a);
  const links = mentionedLinks(a);
  const phase = phaseOf(a);
  const mentionedIds = new Set(a.mentioned.map((m) => m.techniqueId));

  // ---- techniques
  let scoredT = techniqueIndex()
    .map((it) => scoreTechnique(it, a, w, arts, links, personal, phase))
    .filter((x): x is Scored<IndexedTechnique> => !!x);
  if (a.safety.blocked) scoredT = scoredT.filter((x) => !['punch', 'kick', 'knee', 'elbow', 'submission', 'takedown'].some((f) => x.item.features.has(f as Feature)));
  if (filters.difficulty) {
    const before = scoredT.length;
    scoredT = scoredT.filter((x) => x.item.t.difficulty === filters.difficulty);
    if (scoredT.length < before) notices.push({ tone: 'info', text: `난이도 필터(${DIFFICULTY_LABEL[filters.difficulty]})는 난이도가 기록된 기술에만 적용됩니다 — 기술 DB의 대부분은 난이도 정보가 없어 결과가 줄 수 있습니다.` });
  }
  scoredT.sort((x, y) => y.score - x.score || y.item.richness - x.item.richness || x.item.t.name.localeCompare(y.item.t.name));
  const dbCombos: Scored<IndexedTechnique>[] = [];
  const singles: Scored<IndexedTechnique>[] = [];
  for (const x of scoredT) (dbComboSteps(x.item) ? dbCombos : singles).push(x);
  // one card per technique name (the same move in several arts): keep the best-scoring art
  const seenName = new Set<string>();
  const uniqSingles = singles.filter((x) => {
    const k = x.item.t.name.toLowerCase();
    if (seenName.has(k)) return false;
    seenName.add(k);
    return true;
  });

  // ---- setups and combos (library + mine + DB combination records + graph chains)
  const lib = a.safety.blocked ? [] : [...personalLibrary(), ...curatedLibrary()];
  const scoredE = lib.map((e) => scoreEntry(e, a, w, arts, mentionedIds, phase)).filter((x): x is Scored<LibraryEntry> => !!x);
  scoredE.sort((x, y) => y.score - x.score || Number(y.item.allInDb) - Number(x.item.allInDb));
  const seenSeq = new Set<string>();
  const setups: Recommendation[] = [];
  const combos: Recommendation[] = [];
  for (const sc of scoredE) {
    const k = seqKey(sc.item.steps);
    if (seenSeq.has(k)) continue;
    seenSeq.add(k);
    (sc.item.kind === 'setup' ? setups : combos).push(entryCard(sc, lib));
  }
  if (!a.safety.blocked) {
    for (const x of dbCombos) {
      const steps = dbComboSteps(x.item)!;
      const k = seqKey(steps);
      if (seenSeq.has(k)) continue;
      seenSeq.add(k);
      const card = techniqueCard(x, personal);
      combos.push({ ...card, kind: 'combo', key: `dbc:${x.item.t.id}`, steps: withRoles(steps), originLabel: 'MARTIALDEX 기술 DB에 등록된 콤비네이션' });
    }
    // graph chains: a recommended technique + a next technique the DB records for it
    for (const x of uniqSingles.slice(0, 8)) {
      const nexts = getTechniqueConnections(x.item.t).next.filter((n) => !arts || arts.includes(n.martialArt)).slice(0, 2);
      for (const n of nexts) {
        const nIt = indexedById(n.techniqueId);
        if (!nIt) continue;
        const steps = withRoles([stepFromIt(x.item), stepFromIt(nIt)]);
        const k = seqKey(steps);
        if (seenSeq.has(k)) continue;
        seenSeq.add(k);
        const parts: ScorePart[] = [...x.parts.filter((p) => p.key !== 'connection'), { key: 'connection', label: '기술 연결 관계', points: 15, max: 15 }];
        combos.push({
          ...techniqueCard(x, personal),
          key: `g:${x.item.t.id}>${nIt.t.id}`,
          kind: 'combo',
          techniqueId: null,
          title: `${x.item.t.name} → ${nIt.t.name}`,
          steps,
          reasons: [`DB 기록: ${x.item.t.name}의 다음 연결(transitions)에 ${nIt.t.name}이(가) 있음`, ...x.reasons.slice(0, 2)],
          score: Math.round(total(parts) * 0.95),
          scoreParts: parts,
          origin: 'graph',
          originLabel: originLabel('graph'),
          successConditions: [],
          ifDifferent: [],
          hasMotion3d: hasMotion3d(x.item.t.id) || hasMotion3d(nIt.t.id),
        });
      }
    }
  }
  combos.sort((x, y) => y.score - x.score);
  setups.sort((x, y) => y.score - x.score);

  const n = filters.count;
  const sliceP = <T,>(list: T[]) => list.slice(page * n, page * n + n);
  const techCards = uniqSingles.map((x) => techniqueCard(x, personal));
  let techniques = sliceP(techCards);
  let setupsP = sliceP(setups);
  let combosP = sliceP(combos);
  // alternatives: the next-best techniques whose main feature differs from what the top cards already cover
  const covered = new Set(techniques.flatMap((r) => [...(indexedById(r.techniqueId ?? '')?.features ?? [])].slice(0, 2)));
  const altPool = techCards.slice(page * n + n).filter((r) => {
    const f = [...(indexedById(r.techniqueId ?? '')?.features ?? [])];
    return f.some((x) => !covered.has(x));
  });
  let alternatives = altPool.slice(0, Math.min(3, n)).map((r) => ({ ...r, kind: 'alternative' as const, key: `alt:${r.key}`, reasons: ['위 추천과 다른 접근(다른 기술 성격)의 선택지', ...r.reasons] }));
  if (filters.kind) {
    if (filters.kind !== 'technique') techniques = [];
    if (filters.kind !== 'setup') setupsP = [];
    if (filters.kind !== 'combo') combosP = [];
    if (filters.kind !== 'alternative' && filters.kind !== 'technique') alternatives = [];
  }
  const hasMore = techCards.length > (page + 1) * n || setups.length > (page + 1) * n || combos.length > (page + 1) * n;
  if (!techniques.length && !setupsP.length && !combosP.length) notices.push({ tone: 'info', text: page > 0 ? '더 보여 드릴 다른 추천이 없습니다.' : '조건에 맞는 기술을 기술 DB에서 찾지 못했습니다. 종목·난이도 필터를 풀거나 상황을 다르게 적어 보세요.' });
  if (a.wantsKind?.value === 'setup' && !setups.length && !a.safety.blocked) notices.push({ tone: 'info', text: '이 조건에 맞는 셋업이 라이브러리에 없습니다 — 기술·콤보 추천만 표시합니다.' });

  return {
    query: a.text,
    filters,
    analysis: a,
    techniques,
    setups: setupsP,
    combos: combosP,
    alternatives,
    notices,
    page,
    hasMore,
    elapsedMs: Math.round(performance.now() - t0),
    cached: false,
    personalApplied: personal?.applied ?? [],
  };
}

const PERSONAL_TTL_MS = 60_000;
const cachedAt = new Map<string, number>();

/** Rule analysis + DB search (no model call). The same query + filters + page within a minute → served from memory. */
export function findTactics(query: string, filters: Partial<Filters> = {}, page = 0): FinderResult {
  const f: Filters = { ...DEFAULT_FILTERS, ...filters };
  const key = JSON.stringify([query.trim().toLowerCase(), f, page]);
  const hit = cache.get(key);
  // personalised results depend on the user's records, which change — kept for a minute only
  if (hit && (!f.personal || Date.now() - (cachedAt.get(key) ?? 0) < PERSONAL_TTL_MS)) return { ...hit, cached: true, elapsedMs: 0 };
  const t0 = performance.now();
  const a = analyze(query, { category: f.category, art: f.art });
  const result = runEngine(a, f, page);
  result.elapsedMs = Math.round(performance.now() - t0);
  cache.set(key, result);
  cachedAt.set(key, Date.now());
  if (cache.size > CACHE_MAX) {
    const old = cache.keys().next().value as string;
    cache.delete(old);
    cachedAt.delete(old);
  }
  return result;
}

/**
 * With "AI 정밀 분석" on: the rule analysis is refined by the app's AI engine (fields it left empty only), the DB search
 * runs again on the refined analysis, and the AI may add one combination built from the recommended ids. The DB search
 * never waits on the model to start — the caller shows findTactics() first and replaces it with this when it arrives.
 */
export async function findTacticsWithAi(query: string, filters: Partial<Filters> = {}, page = 0): Promise<FinderResult> {
  const { refineAnalysis, aiCombination } = await import('./aiRefine');
  const f: Filters = { ...DEFAULT_FILTERS, ...filters };
  const t0 = performance.now();
  const base = analyze(query, { category: f.category, art: f.art });
  if (base.safety.blocked) return { ...runEngine(base, f, page), elapsedMs: Math.round(performance.now() - t0) };
  const refined = await refineAnalysis(base);
  const notices: FinderResult['notices'] = [];
  if (!refined.ai.ok) notices.push({ tone: 'warn', text: refined.ai.message ?? 'AI 분석을 하지 못했습니다. 규칙 분석과 기술 DB 검색 결과만 표시합니다.' });
  else if (refined.ai.message) notices.push({ tone: 'info', text: refined.ai.message });
  const result = runEngine(refined, f, page, { extraNotices: notices });
  if (refined.ai.ok && (!f.kind || f.kind === 'combo')) {
    const combo = await aiCombination(result);
    if (combo) result.combos = [combo, ...result.combos].slice(0, f.count);
    else if (refined.ai.ok) result.notices.push({ tone: 'info', text: 'AI가 DB에 있는 기술만으로 된 조합을 만들지 못해 AI 조합은 표시하지 않습니다.' });
  }
  result.elapsedMs = Math.round(performance.now() - t0);
  return result;
}

export { DEFAULT_FILTERS };
