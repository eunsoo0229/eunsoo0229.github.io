import { comboRepository } from '../combo/repository';
import { tacticRepository } from '../tactic/repository';
import { getMartialArt } from '../loadData';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { resolveTechnique } from '../userTechniques/service';
import { analyze, normalize } from './analyze';
import { curatedLibrary, type LibraryEntry } from './comboLibrary';
import { BEHAVIOR_LABEL, BEHAVIOR_RULES, FEATURE_LABEL, GOAL_LABEL, GOAL_WANTS, BEHAVIOR_WANTS, RECORD_FEATURE_RULES } from './lexicon';
import { indexedById, techniqueIndex } from './techniqueIndex';
import type { Analysis, Feature, StepRef } from './types';

// SETUP & COMBO FINDER (APP DATABASE): the user's WHOLE 콤보 북 and 전술 셋업 are searched — every saved item, read only
// (nothing is written back) — and every item that matches the purpose is returned, sorted by how directly it matches.
// No top-N cut. The sourced MARTIALDEX library is searched the same way but shown in its own section.
// Only the signed-in account's items are read (the local owner id); another account's items never reach the results.

export type Tier = 1 | 2 | 3 | 4;
export const TIER_LABEL: Record<Tier, string> = {
  1: '목적 직접 일치',
  2: '목적·구성 기술 강한 연결',
  3: '유사한 상황·전술 목적',
  4: '간접 활용 가능',
};

export interface LibraryHit {
  key: string;
  source: 'my-combo' | 'my-tactic' | 'curated-library';
  kind: 'combo' | 'setup';
  id: string | null;
  title: string;
  purpose: string;
  description: string;
  art: string;
  artLabel: string;
  difficulty: string | null;
  steps: StepRef[];
  tier: Tier;
  relevance: number;
  reasons: string[];
  sources: { label: string; url: string | null }[];
}

export interface LibrarySearchResult {
  query: string;
  analysis: Analysis;
  mySetups: LibraryHit[];
  myCombos: LibraryHit[];
  library: LibraryHit[];
  /** Weak (tier 4) matches kept apart as "관련 항목". */
  related: LibraryHit[];
  searched: { combos: number; tactics: number; library: number; otherAccount: number };
  notices: { tone: 'info' | 'warn'; text: string }[];
  elapsedMs: number;
}

const OWNER_KEY = 'mdx:last-auth-user-id';

function currentOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function step(id: string): StepRef {
  const t = resolveTechnique(id);
  return { name: t?.name ?? id, techniqueId: t ? t.id : null, martialArt: t?.martialArt ?? null, inDb: !!t, role: null, note: null, react: null };
}

interface Candidate {
  entry: LibraryEntry;
  id: string | null;
  difficulty: string | null;
  ownerOk: boolean;
}

/** Every saved combo and tactic of this account (all of them — the search filters, the reader does not). */
function readMine(): { list: Candidate[]; combos: number; tactics: number; other: number } {
  const owner = currentOwner();
  const list: Candidate[] = [];
  let other = 0;
  let combos = 0;
  let tactics = 0;
  for (const c of comboRepository.list()) {
    // a record stamped with another account's id is never searched (local data normally holds one account only —
    // guardAccountSwitch moves the rest to that account's stash — this is the second line of defence)
    if (c.userId && owner && c.userId !== owner) {
      other++;
      continue;
    }
    if (c.userId && !owner) {
      other++;
      continue;
    }
    combos++;
    const steps = c.techniqueIds.map(step);
    const kind = c.visualMittMeta?.type === 'setup' || c.sharedMeta?.kind === 'setup' ? 'setup' : 'combo';
    const purpose = c.sharedMeta?.purpose || c.visualMittMeta?.purpose || c.aiComboMeta?.goalText || '';
    const meta = [
      c.description,
      purpose,
      c.aiComboMeta?.stepReasons?.join(' '),
      c.aiComboMeta?.analysis ? flatText(c.aiComboMeta.analysis) : '',
      c.visualMittMeta?.coachingNote,
      ...(c.sharedMeta?.stepNotes ?? []).map((n) => `${n.note} ${n.opponentReaction ?? ''}`),
      ...(c.visualMittMeta?.stepNotes ?? []).map((n) => `${n.note} ${n.opponentReaction ?? ''}`),
    ]
      .filter(Boolean)
      .join(' ');
    const reacts = new Map((c.sharedMeta?.stepNotes ?? c.visualMittMeta?.stepNotes ?? []).map((n) => [n.techniqueId, n]));
    for (const s of steps) {
      const n = s.techniqueId ? reacts.get(s.techniqueId) : undefined;
      if (n) Object.assign(s, { note: n.note || null, react: n.opponentReaction });
    }
    const text = normalize(`${c.name} ${meta} ${steps.map((s) => s.name).join(' ')}`);
    list.push({
      entry: { key: `combo:${c.id}`, kind, art: steps.find((s) => s.martialArt)?.martialArt ?? '', title: c.name, purpose, desc: c.description, steps, features: featuresOf(text, steps), text, sources: [{ label: '내 콤보 북', url: null }], origin: 'my-combo', allInDb: steps.every((s) => s.inDb) },
      id: c.id,
      difficulty: c.sourceMeta?.difficulty ?? null,
      ownerOk: true,
    });
  }
  for (const t of tacticRepository.list()) {
    if (t.userId && t.userId !== owner) {
      other++;
      continue;
    }
    tactics++;
    const steps = t.techniqueIds.map(step);
    const text = normalize(`${t.name} ${t.situation} ${t.feedback ?? ''} ${steps.map((s) => s.name).join(' ')}`);
    list.push({
      entry: { key: `tactic:${t.id}`, kind: 'setup', art: steps.find((s) => s.martialArt)?.martialArt ?? '', title: t.name, purpose: t.situation, desc: t.feedback ?? '', steps, features: featuresOf(text, steps), text, sources: [{ label: '내 전술 셋업', url: null }], origin: 'my-tactic', allInDb: steps.every((s) => s.inDb) },
      id: t.id,
      difficulty: null,
      ownerOk: true,
    });
  }
  return { list, combos, tactics, other };
}

/** Every string inside a nested record (AI analysis objects hold arrays of objects). */
function flatText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(flatText).join(' ');
  if (v && typeof v === 'object') return Object.values(v).map(flatText).join(' ');
  return '';
}

function featuresOf(text: string, steps: StepRef[]): Set<Feature> {
  const f = new Set<Feature>();
  for (const r of RECORD_FEATURE_RULES) if (r.re.test(text)) f.add(r.value);
  for (const s of steps) if (s.techniqueId) for (const x of indexedById(s.techniqueId)?.features ?? []) f.add(x);
  if (steps.length > 1) f.add('combination');
  return f;
}

// ---- what the purpose asks for

/** Related expressions per technique family (both languages) — "더블렉 셋업" also means level change / 테이크다운 진입. */
const FAMILY_TERMS: [RegExp, string[]][] = [
  [/double\s?leg|더블\s?[렉랙]/, ['double leg', '더블렉', 'level change', '레벨 체인지', '테이크다운 진입', 'takedown entry', 'penetration', '태클', 'shot', '슛']],
  [/single\s?leg|싱글\s?[렉랙]/, ['single leg', '싱글렉', 'level change', '레벨 체인지', 'ankle pick', '테이크다운 진입', 'takedown entry', 'shot', '슛']],
  [/takedown|테이크\s?다운|태클|tackle/, ['takedown', '테이크다운', '태클', 'level change', '레벨 체인지', 'double leg', 'single leg', '더블렉', '싱글렉', 'trip', 'throw', 'body lock', '바디락']],
  [/clinch|클린치|칼라\s?타이|collar tie|목\s*(을\s*)?잡/, ['clinch', '클린치', 'collar tie', '칼라 타이', 'underhook', '언더훅', 'overhook', 'plum', '빰', 'body lock', '바디락']],
  [/\bjab\b|잽|쨉/, ['jab', '잽']],
  [/body|바디|몸통/, ['body', '바디', '몸통', '리버', 'liver', '명치']],
  [/sprawl|스프롤/, ['sprawl', '스프롤', 'whizzer', '위저', 'front headlock', '프론트 헤드락', 'snap down']],
];
const HEAD_RE = /헤드|얼굴|머리|턱|head|chin/;

interface Purpose {
  targets: { ids: Set<string>; label: string; position: 'end' | 'start' | 'any'; terms: string[] }[];
  concepts: (typeof CONCEPTS)[number][];
  /** "바디 공격 이후 헤드 공격": features that must appear in this order */
  order: { before: Feature | 'head'; after: Feature | 'head' } | null;
  wants: Partial<Record<Feature, number>>;
  kind: 'setup' | 'combo' | null;
}

function familyIds(id: string, name: string): Set<string> {
  const out = new Set<string>([id, canonicalTechniqueId(id)]);
  const low = name.toLowerCase();
  if (low.length >= 3) for (const it of techniqueIndex()) if (it.t.name.toLowerCase().includes(low)) out.add(it.t.id);
  return out;
}

/** Techniques whose English name contains the family's name ("sprawl" → Sprawl to Front Headlock …). */
function namedIds(term: string): Set<string> {
  const out = new Set<string>();
  if (term.length < 3) return out;
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  for (const it of techniqueIndex()) if (re.test(it.t.name)) out.add(it.t.id);
  return out;
}

/** Purposes that are about what the move does rather than which technique ends it. query: the wording in the request;
 *  item: the same idea in a saved purpose / description. */
const CONCEPTS: { label: string; q: RegExp; item: RegExp }[] = [
  { label: '가드 열기', q: /가드\s*(를|을)?\s*(여|열|깨|무너|뚫|내리|브레이크)|가드\s*브레이크|open(ing)? (the|his|their)? ?guard|guard break/, item: /가드\s*(를|을)?\s*(여|열|깨|무너|뚫|내리)|가드\s*브레이크|open(s|ing)? (the )?guard|guard break/ },
  { label: '후퇴 유도', q: /(후퇴|물러나|뒤로\s*(빠지|밀))[^.]{0,8}(유도|만들|만드|하게|시키|압박)|후퇴\s*유도|(유도|만들|압박)[^.]{0,10}(후퇴|물러나|뒤로\s*빠지)|(로프|코너|펜스|케이지)\s*(로|쪽으로)\s*(몰|모|밀)/, item: /후퇴|물러나|뒤로\s*(빠지|밀)|(로프|코너|펜스|케이지)\s*(로|쪽으로)\s*(몰|모|밀)/ },
  { label: '반응 유도', q: /페인트|페이크|속임|속이|feint|fake|반응을?\s*(끌어|유도|이끌)/, item: /페인트|페이크|속임|속이|feint|fake|반응을?\s*(끌어|유도|이끌)/ },
  { label: '클린치 진입', q: /클린치|clinch|칼라\s*타이|collar tie|목\s*(을\s*)?잡/, item: /클린치|clinch|칼라\s*타이|collar tie|빰|plum/ },
];

function readPurpose(a: Analysis): Purpose {
  const s = a.normalized;
  const targets: Purpose['targets'] = [];
  for (const m of a.mentioned) {
    const at = s.indexOf(m.term.toLowerCase());
    if (at > 0 && /[가-힣]/.test(m.term[0]) && /[가-힣]/.test(s[at - 1]) && !a.mentioned.some((o) => o !== m && o.term.includes(m.term))) {
      // "힐훅" ≠ "훅": a Korean name glued to a preceding syllable is part of another word — unless the whole word is a
      // known mention itself
      continue;
    }
    if (a.mentioned.some((o) => o !== m && o.term.length > m.term.length && o.term.includes(m.term))) continue;
    const after = at >= 0 ? s.slice(at + m.term.length, at + m.term.length + 14) : '';
    const before = at >= 0 ? s.slice(Math.max(0, at - 14), at) : '';
    let position: 'end' | 'start' | 'any' = 'any';
    if (/^\s*(을|를|으로|로)?\s*(위한|위해|노리|연결|끝나|마무리|들어가|셋업|진입|피니시)/.test(after) || /^\s*(을|를)?\s*(하기|걸기)/.test(after)) position = 'end';
    if (/^\s*(을|를)?\s*(이후|다음|뒤|후에|후|부터|로\s*시작|으로\s*시작|then|first|and then)/.test(after) || /(먼저|after|following)\s*(the|a)?\s*$/.test(before)) position = 'start';
    if (/(for|into|to set up|setting up|to)\s*(the|a)?\s*$/.test(before) || /^\s*(entry|finish|setup|set up)/.test(after)) position = position === 'start' ? 'start' : 'end';
    const fam = FAMILY_TERMS.find(([re]) => re.test(`${m.name.toLowerCase()} ${m.term}`));
    targets.push({ ids: familyIds(m.techniqueId, m.name), label: m.name, position, terms: fam ? fam[1] : [m.name.toLowerCase(), m.term] });
  }
  // a family named without resolving to one record ("테이크다운을 위한 셋업", "클린치 진입")
  for (const [re, terms] of FAMILY_TERMS) {
    if (!re.test(s)) continue;
    if (targets.some((t) => t.terms === terms)) continue;
    const at = s.search(re);
    const after = s.slice(at, at + 20);
    const pre = s.slice(Math.max(0, at - 14), at);
    const position = /(이후|다음|뒤|후에|부터|로\s*시작|then)/.test(after) || /(after|following)\s*(the|a)?\s*$/.test(pre) ? 'start' : /(위한|위해|진입|연결|셋업|끝나|마무리|entry|setup|finish)/.test(after) || /(for|into)\s*(the|a)?\s*$/.test(pre) ? 'end' : 'any';
    targets.push({ ids: namedIds(terms[0]), label: terms[1], position, terms });
  }
  let order: Purpose['order'] = null; // (computed below; body/head family targets are dropped when an order exists)
  const ord = s.match(/(바디|몸통|복부|body)[^.]{0,20}?(이후|다음|뒤|후에|후|then|to|into|→|->)[^.]{0,20}?(헤드|얼굴|머리|턱|head)/);
  if (ord) order = { before: 'body', after: 'head' };
  const ord2 = s.match(/(헤드|얼굴|머리|head)[^.]{0,20}?(이후|다음|뒤|후에|후|then|to|into|→|->)[^.]{0,20}?(바디|몸통|복부|body)/);
  if (ord2) order = { before: 'head', after: 'body' };
  const wants: Partial<Record<Feature, number>> = {};
  const add = (w: Partial<Record<Feature, number>>, k = 1) => {
    for (const [f, v] of Object.entries(w) as [Feature, number][]) wants[f] = (wants[f] ?? 0) + v * k;
  };
  for (const g of a.goals) add(GOAL_WANTS[g.value]);
  for (const b of a.behaviors) add(BEHAVIOR_WANTS[b.value]);
  for (const t of a.techniqueTypes) add({ [t.value]: 3 });
  if (/가드를?\s*(열|깨|무너|뚫)|가드\s*브레이크|open (the )?guard/.test(s)) add({ feint: 2.5, body: 2, combination: 1.5 });
  if (/후퇴(를|하게)?\s*유도|뒤로\s*물러나게|빠지게\s*만들/.test(s)) add({ pressure: 2.5, feint: 1.5, footwork: 1.5 });
  if (/포지션\s*(전환|바꾸|이동)|전환/.test(s)) add({ transition: 2, groundTop: 1.5, back: 1.5, sweep: 1 });
  const kind = /셋업|세팅|유도|setup|set up|entry/.test(s) ? 'setup' : /콤보|조합|연타|콤비네이션|combo|combination/.test(s) ? 'combo' : null;
  const concepts = CONCEPTS.filter((c) => c.q.test(s));
  // "바디 이후 헤드": the order check decides — a bare "body" family target would make any body strike direct
  const kept = order ? targets.filter((t) => !t.terms.includes('body')) : targets;
  return { targets: kept, order, wants, kind, concepts };
}

function stepFeatures(s: StepRef): Set<Feature | 'head'> {
  const f = new Set<Feature | 'head'>(s.techniqueId ? [...(indexedById(s.techniqueId)?.features ?? [])] : []);
  const low = s.name.toLowerCase();
  if (/body|바디|liver|리버/.test(low)) f.add('body');
  if ((f.has('punch') || f.has('kick') || f.has('knee') || f.has('elbow')) && !f.has('body')) f.add('head');
  if (HEAD_RE.test(`${low} ${s.note ?? ''}`)) f.add('head');
  return f;
}

function fit(w: Partial<Record<Feature, number>>, features: Set<Feature>): { ratio: number; hit: Feature[] } {
  const entries = (Object.entries(w) as [Feature, number][]).sort((x, y) => y[1] - x[1]);
  if (!entries.length) return { ratio: 0, hit: [] };
  const top = entries.slice(0, 3).reduce((a, [, v]) => a + v, 0);
  const hit = entries.filter(([f]) => features.has(f));
  return { ratio: Math.min(1, hit.reduce((a, [, v]) => a + v, 0) / top), hit: hit.map(([f]) => f) };
}

function judge(c: Candidate, a: Analysis, p: Purpose): { tier: Tier; relevance: number; reasons: string[] } | null {
  const e = c.entry;
  const reasons: string[] = [];
  let points = 0;
  let direct = false;
  let strong = false;
  for (const t of p.targets) {
    const isT = (s: StepRef) => !!s.techniqueId && (t.ids.has(s.techniqueId) || t.ids.has(canonicalTechniqueId(s.techniqueId)));
    // "X를 위한 셋업" is about the step that ends the item; "X 이후" about the one that starts it
    const idx = t.position === 'end' ? e.steps.map(isT).lastIndexOf(true) : e.steps.findIndex(isT);
    const textHit = t.terms.some((w) => e.text.includes(w.toLowerCase()));
    if (idx >= 0) {
      const last = idx === e.steps.length - 1 || e.steps.slice(idx + 1).every((s) => !s.techniqueId);
      const first = idx === 0;
      const posOk = t.position === 'any' || (t.position === 'end' && last) || (t.position === 'start' && first);
      if (posOk) {
        points += 50;
        direct = true;
        reasons.push(`${t.label}이(가) 구성 기술 ${idx + 1}번째${t.position === 'end' ? '(마무리)' : t.position === 'start' ? '(시작)' : ''}에 있음`);
      } else {
        points += 32;
        strong = true;
        reasons.push(`${t.label}이(가) 구성 기술에 있음 (${idx + 1}번째)`);
      }
    } else if (textHit) {
      const w = t.terms.find((x) => e.text.includes(x.toLowerCase()))!;
      points += 26;
      strong = true;
      reasons.push(`관련 표현 “${w}”이(가) ${e.purpose.toLowerCase().includes(w.toLowerCase()) ? '목적' : '설명·구성'}에 있음`);
    }
  }
  if (p.order) {
    const fs = e.steps.map(stepFeatures);
    const bi = fs.findIndex((f) => f.has(p.order!.before));
    const ai = fs.findIndex((f, i) => i > bi && f.has(p.order!.after));
    if (bi >= 0 && ai > bi) {
      points += 40;
      direct = true;
      reasons.push(`순서 일치: ${p.order.before === 'body' ? '몸통' : '헤드'} 공격(${e.steps[bi].name}) → ${p.order.after === 'body' ? '몸통' : '헤드'} 공격(${e.steps[ai].name})`);
    }
  }
  const savedPurpose = normalize(`${e.title} ${e.purpose}`);
  for (const c of p.concepts) {
    if (c.item.test(savedPurpose)) {
      points += 45;
      direct = true;
      reasons.push(`저장된 목적·이름이 같은 목적(${c.label})을 말함`);
    } else if (c.item.test(e.text)) {
      points += 28;
      strong = true;
      reasons.push(`설명·메모에 같은 목적(${c.label})이 있음`);
    }
  }
  const f = fit(p.wants, e.features);
  if (f.ratio > 0) {
    points += Math.round(30 * f.ratio);
    reasons.push(`목적(${[...a.goals.map((g) => GOAL_LABEL[g.value]), ...a.techniqueTypes.map((t) => FEATURE_LABEL[t.value])].join('·') || '전술 성격'})에 맞는 구성: ${f.hit.slice(0, 3).map((x) => FEATURE_LABEL[x]).join(', ')}`);
  }
  const beh = BEHAVIOR_RULES.filter((r) => a.behaviors.some((b) => b.value === r.value) && r.re.test(e.text));
  if (beh.length) {
    points += 18;
    reasons.push(`저장된 설명에 같은 상황: ${beh.map((r) => BEHAVIOR_LABEL[r.value]).join(', ')}`);
  }
  if (a.arts.length && e.art && a.arts.some((x) => x.value === e.art || (x.value === 'mixed-martial-arts' && ['boxing', 'kickboxing', 'muay-thai', 'wrestling', 'bjj'].includes(e.art)))) points += 6;
  else if (a.arts.length && e.art) return null; // the purpose names another art
  if (points === 0) return null;
  const hasTarget = p.targets.length > 0 || !!p.order || p.concepts.length > 0;
  // tiers: position-correct target / order → 1; target present or related wording → 2; purpose / situation fit → 3
  let tier: Tier = direct ? 1 : strong ? 2 : f.ratio >= 0.5 || beh.length ? 3 : 4;
  if (tier === 4 && (hasTarget || f.ratio < 0.25)) return null; // unrelated: only a stray feature in common
  // the purpose names a technique (or an order) the item neither contains nor mentions → only an indirect match
  if (tier === 3 && hasTarget) tier = 4;
  return { tier, relevance: Math.min(100, points), reasons };
}

function toHit(c: Candidate, j: { tier: Tier; relevance: number; reasons: string[] }): LibraryHit {
  const e = c.entry;
  return {
    key: e.key,
    source: e.origin as LibraryHit['source'],
    kind: e.kind,
    id: c.id,
    title: e.title,
    purpose: e.purpose,
    description: e.desc,
    art: e.art,
    artLabel: e.art ? getMartialArt(e.art)?.nameKo ?? e.art : '',
    difficulty: c.difficulty,
    steps: e.steps,
    tier: j.tier,
    relevance: j.relevance,
    reasons: j.reasons,
    sources: e.sources,
  };
}

const sortHits = (x: LibraryHit, y: LibraryHit) => x.tier - y.tier || y.relevance - x.relevance || x.title.localeCompare(y.title);

export function searchLibrary(query: string, opts: { includeCurated?: boolean } = {}): LibrarySearchResult {
  const t0 = performance.now();
  const a = analyze(query.replace(/가드\s*(를|을)?\s*무너뜨리?/g, '가드를 여'));
  const p = readPurpose(a);
  const notices: LibrarySearchResult['notices'] = [];
  const mine = readMine();
  const curated = opts.includeCurated === false ? [] : curatedLibrary().map((entry) => ({ entry, id: null, difficulty: null, ownerOk: true }) as Candidate);
  const empty = { query, analysis: a, mySetups: [], myCombos: [], library: [], related: [], searched: { combos: mine.combos, tactics: mine.tactics, library: curated.length, otherAccount: mine.other }, notices, elapsedMs: 0 };
  if (a.safety.blocked) {
    notices.push({ tone: 'warn', text: `상대를 다치게 하는 것을 목적으로 한 요청(“${a.safety.terms.join(', ')}”)에는 셋업·콤보를 찾지 않습니다.` });
    return { ...empty, elapsedMs: Math.round(performance.now() - t0) };
  }
  if (!p.targets.length && !p.order && !p.concepts.length && !Object.keys(p.wants).length) {
    notices.push({ tone: 'info', text: '입력에서 셋업·콤보의 목적을 찾지 못했습니다. “더블렉을 위한 셋업”, “잽 이후 연결할 콤보”처럼 목적을 적어 주세요.' });
    return { ...empty, elapsedMs: Math.round(performance.now() - t0) };
  }
  if (a.unknownTerms.length) notices.push({ tone: 'info', text: `기술 DB에서 찾지 못한 이름: ${a.unknownTerms.map((x) => `“${x}”`).join(', ')} — 나머지 목적으로 찾았습니다.` });
  const mineHits: LibraryHit[] = [];
  for (const c of mine.list) {
    const j = judge(c, a, p);
    if (j) mineHits.push(toHit(c, j));
  }
  const libHits: LibraryHit[] = [];
  for (const c of curated) {
    const j = judge(c, a, p);
    if (j) libHits.push(toHit(c, j));
  }
  // de-duplicate the library by step sequence (the same combo published twice)
  const seen = new Set<string>();
  const libUnique = libHits.sort(sortHits).filter((h) => {
    const k = h.steps.map((s) => s.techniqueId ?? s.name).join('>');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const strong = (h: LibraryHit) => h.tier < 4;
  const mySetups = mineHits.filter((h) => h.kind === 'setup' && strong(h)).sort(sortHits);
  const myCombos = mineHits.filter((h) => h.kind === 'combo' && strong(h)).sort(sortHits);
  // 관련 항목: indirect matches with real evidence only (a stray shared feature is not enough), at most 6
  const related = [...mineHits.filter((h) => !strong(h)), ...libUnique.filter((h) => !strong(h))].filter((h) => h.relevance >= 20).sort(sortHits).slice(0, 6);
  const library = libUnique.filter(strong);
  if (mine.combos + mine.tactics === 0) notices.push({ tone: 'info', text: '저장된 콤보·셋업이 없습니다. 아래는 MARTIALDEX 라이브러리 결과입니다.' });
  else if (!mySetups.length && !myCombos.length) notices.push({ tone: 'info', text: '현재 저장된 콤보와 셋업 중 이 목적에 직접적으로 부합하는 항목을 찾지 못했습니다.' });
  if (mine.other) notices.push({ tone: 'info', text: `다른 계정 소유로 표시된 항목 ${mine.other}개는 검색하지 않았습니다.` });
  return { query, analysis: a, mySetups, myCombos, library, related, searched: { combos: mine.combos, tactics: mine.tactics, library: curated.length, otherAccount: mine.other }, notices, elapsedMs: Math.round(performance.now() - t0) };
}
