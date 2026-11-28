import type { Technique } from '../../types';
import { allTechniques, browsable, isManagedMartialArt, isSyntheticTrainingDomain } from '../loadData';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { BEHAVIOR_RULES, RECORD_FEATURE_RULES } from './lexicon';
import type { Behavior, Feature, Range } from './types';

// Per-record tactical features, built ONCE (lazily, on the first search) from the technique DB's own fields. No
// copy of the DB is stored — the index keeps the record reference plus what was read from it.

export interface IndexedTechnique {
  t: Technique;
  features: Set<Feature>;
  /** How firmly the record has each feature: its name / category / tags 1, positions 0.6, a description sentence or a
   * connection record 0.5 (a sentence may describe the opponent's move, not this one). */
  weight: Partial<Record<Feature, number>>;
  /** For each feature, the record field that produced it (shown as evidence: "카테고리 '방어'"). */
  featureField: Partial<Record<Feature, string>>;
  range: Range | null;
  /** Lower-cased searchable text of the record (name, Korean name, aliases, category, purpose, description). */
  text: string;
  /** Has data beyond its name (purpose, description, principles, connections) — feeds the reliability score. */
  richness: number;
  /** Sentences of the DB text that are about THIS technique (its own purpose, or the lines of a shared category essay
   * that name it) — the situational evidence shown on the card. */
  ownText: string[];
  /** Opponent situations those sentences describe ("상대가 백스텝으로 물러날 때" → retreat). */
  behaviors: Set<Behavior>;
}

let index: IndexedTechnique[] | null = null;
let byId: Map<string, IndexedTechnique> | null = null;

// categories that are rules / stances / forms / concepts, not something to use in a fight
const NOT_TACTICAL = /규칙|룰|rules|품새|poomsae|kata|형\b|기본\s*서기|기본\s*자세|스탠스|stance|개념|용어|체급|대회|점수|역사|훈련법|warm|stretch|컨디셔닝|conditioning/i;

// Many records share one long category essay as `purpose` / `principles` (e.g. every kickboxing punch carries the
// same text naming Jab, Cross, Hook …). Read as a whole it would give every punch every feature, so a shared essay is
// cut down to the sentences that name this technique; a purpose written for this record alone is used as it is.
let sharedCount: Map<string, number> | null = null;
function shared(text: string): boolean {
  if (!sharedCount) {
    sharedCount = new Map();
    for (const t of allTechniques) for (const v of [t.purpose ?? '', ...(t.principles ?? [])]) if (v) sharedCount.set(v, (sharedCount.get(v) ?? 0) + 1);
  }
  return (sharedCount.get(text) ?? 0) >= 3;
}

function sentences(text: string): string[] {
  return text
    .replace(/\*\*/g, '')
    .split(/(?<=[.!?。])\s+|\n+|(?<=다\.)/)
    .map((x) => x.trim())
    .filter((x) => x.length > 6);
}

function namesTech(sentence: string, t: Technique): boolean {
  const low = sentence.toLowerCase();
  const names = [t.name, t.koreanName ?? '', ...(t.aliases ?? [])].filter((n) => n.length >= 3);
  for (const n of names) {
    const words = n.toLowerCase().split(/[\s/-]+/).filter((w) => w.length >= 2);
    if (!words.length) continue;
    if (low.includes(n.toLowerCase())) return true;
    // "Lead/Rear Hook" names Lead Hook and Rear Hook: every word of the name appears in the sentence
    if (words.length >= 2 && words.every((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(low))) return true;
  }
  return false;
}

function ownSentences(t: Technique): string[] {
  const out: string[] = [];
  for (const v of [t.purpose ?? '', ...(t.principles ?? []), t.description ?? '']) {
    if (!v) continue;
    if (!shared(v)) {
      out.push(...sentences(v));
      continue;
    }
    for (const sn of sentences(v)) if (namesTech(sn, t) && !out.includes(sn)) out.push(sn);
  }
  return out.slice(0, 6);
}

function fieldsOf(t: Technique, own: string[]): [string, string][] {
  return [
    ['기술명', `${t.name} ${t.koreanName ?? ''} ${(t.aliases ?? []).join(' ')}`],
    ['카테고리', t.category ?? ''],
    ['포지션', (t.positions ?? []).join(' ')],
    ['DB 설명', own.join(' ')],
    ['태그', (t.tags ?? []).filter((x) => !x.startsWith('martialArt:') && !x.startsWith('category:')).join(' ')],
    ['연결 기록', [...(t.transitions ?? []), ...(t.counters ?? []), ...(t.defenses ?? [])].join(' ')],
  ];
}

function rangeOf(features: Set<Feature>, text: string): Range | null {
  if (/mount|guard|side control|그라운드|마운트|가드\s*\(|바닥|ne.?waza|turtle|터틀|back control|백 컨트롤/.test(text) || features.has('groundTop') || features.has('sweep') || features.has('pass')) return 'ground';
  if (features.has('clinch') || features.has('knee') || /clinch|클린치/.test(text)) return 'clinch';
  if (features.has('elbow') || /uppercut|어퍼|근거리|short|inside/.test(text)) return 'close';
  if (/teep|티프|jab|잽|front kick|push kick|장거리|long/.test(text)) return 'long';
  if (features.has('punch') || features.has('kick')) return 'mid';
  return null;
}

function build(t: Technique): IndexedTechnique {
  const own = ownSentences(t);
  const fields = fieldsOf(t, own);
  const features = new Set<Feature>();
  const featureField: Partial<Record<Feature, string>> = {};
  const weight: Partial<Record<Feature, number>> = {};
  const FIELD_WEIGHT: Record<string, number> = { 기술명: 1, 카테고리: 1, 태그: 1, 포지션: 0.6, 'DB 설명': 0.5, '연결 기록': 0.5 };
  for (const [label, raw] of fields) {
    const v = raw.toLowerCase();
    if (!v.trim()) continue;
    for (const r of RECORD_FEATURE_RULES) {
      if (features.has(r.value)) continue;
      // connection records only say "this technique links on" (transition / counter) — not what it is
      if (label === '연결 기록' && r.value !== 'transition' && r.value !== 'counter') continue;
      // a description sentence can mention other moves ("…잽으로 재압박"); only the technique's own type fields
      // (name, category, positions, tags) decide punch / kick / knee / elbow
      if (label === 'DB 설명' && ['punch', 'kick', 'knee', 'elbow', 'takedown', 'submission'].includes(r.value)) continue;
      if (r.re.test(v)) {
        features.add(r.value);
        featureField[r.value] = label;
        weight[r.value] = FIELD_WEIGHT[label] ?? 0.5;
      }
    }
  }
  if ((t.transitions ?? []).length) {
    features.add('transition');
    featureField.transition ??= '연결 기록';
    weight.transition ??= 0.5;
  }
  const behaviors = new Set<Behavior>();
  const ownLow = own.join(' ').toLowerCase();
  for (const r of BEHAVIOR_RULES) if (r.value !== 'retreat' && r.value !== 'pressure' && r.value !== 'guardHigh' && r.re.test(ownLow)) behaviors.add(r.value);
  // the essay's "상대가 … 물러나며" etc. without "상대가" in front still describes the opponent
  // only sentences about the OPPONENT ("상대가 백스텝으로 물러나며") — "백스텝으로 빠진다" describing the move itself is not
  if (/상대[가이의는]?[^.]{0,30}(물러나|백스텝|뒤로 빠|거리를 벌리)/.test(ownLow)) behaviors.add('retreat');
  if (/상대[가이의는]?[^.]{0,30}(압박해|전진|밀고 들어|붙어올|앞으로 붙)|전진하는 상대/.test(ownLow)) behaviors.add('pressure');
  if (/상대[가이의는]?[^.]{0,30}(하이가드|가드를 (올|굳)|정면을 좁게)/.test(ownLow)) behaviors.add('guardHigh');
  const text = fields
    .slice(0, 4)
    .map(([, v]) => v)
    .join(' ')
    .toLowerCase();
  const richness = (own.length ? 1 : 0) + (own.length >= 2 ? 1 : 0) + (t.description ? 1 : 0) + ((t.transitions ?? []).length || (t.counters ?? []).length || (t.defenses ?? []).length ? 1 : 0) + ((t.videos ?? []).length ? 1 : 0);
  return { t, features, weight, featureField, range: rangeOf(features, text), text, richness, ownText: own, behaviors };
}

export function techniqueIndex(): IndexedTechnique[] {
  if (!index) {
    index = browsable(allTechniques)
      .filter((t) => !isSyntheticTrainingDomain(t.martialArt) && isManagedMartialArt(t.martialArt))
      .filter((t) => !NOT_TACTICAL.test(t.category ?? '') || /방어|카운터|counter|defen/i.test(t.category ?? ''))
      .map(build);
    byId = new Map(index.map((x) => [x.t.id, x]));
  }
  return index;
}

export function indexedById(id: string): IndexedTechnique | undefined {
  techniqueIndex();
  return byId!.get(canonicalTechniqueId(id)) ?? byId!.get(id);
}

// ---- name lookup (mentioned techniques, curated combo steps)

/** Korean terms users type → English names as they appear in the DB (resolved at runtime; unresolved = not used). */
export const KOREAN_TERMS: [RegExp, string[]][] = [
  [/원투/, ['Jab', 'Cross']],
  [/잽/, ['Jab']],
  [/크로스|스트레이트/, ['Cross']],
  [/리드\s*훅|앞손\s*훅/, ['Lead Hook']],
  [/힐\s*훅/, ['Heel Hook']],
  [/(?<!(리드\s*|힐\s*|언더|오버))훅/, ['Hook']],
  [/어퍼컷|어퍼/, ['Uppercut']],
  [/오버핸드/, ['Overhand']],
  [/로우킥/, ['Low Kick']],
  [/미들킥|바디킥/, ['Body Kick']],
  [/하이킥/, ['High Kick']],
  [/티프|푸시\s*킥/, ['Teep']],
  [/니킥/, ['Straight Knee']],
  [/엘보/, ['Elbow']],
  [/더블\s?[렉랙]/, ['Double Leg']],
  [/앵클\s*픽/, ['Ankle Pick']],
  [/칼라\s*타이/, ['Collar Tie']],
  [/싱글\s?[렉랙]/, ['Single Leg']],
  [/스프롤/, ['Sprawl']],
  [/언더훅/, ['Underhook']],
  [/오버훅/, ['Overhook']],
  [/바디락/, ['Body Lock']],
  [/암바/, ['Armbar']],
  [/트라이앵글/, ['Triangle']],
  [/기무라/, ['Kimura']],
  [/길로틴/, ['Guillotine']],
  [/리어\s*네이키드|rnc/, ['Rear Naked Choke']],
  [/새우\s*빼기|힙\s*이스케이프/, ['Hip Escape']],
  [/브릿지|우파/, ['Bridge']],
  [/슬립/, ['Slip']],
  [/패리/, ['Parry']],
  [/위빙|더킹/, ['Roll']],
  [/체크/, ['Check']],
  [/프론트\s*헤드락/, ['Front Headlock']],
  [/니\s*탭/, ['Knee Tap']],
  [/스위치\s*킥/, ['Switch Kick']],
  [/테크니컬\s*스탠드업/, ['Technical Stand-Up']],
];

let nameIndex: { key: string; it: IndexedTechnique }[] | null = null;

function nameKeys(it: IndexedTechnique): string[] {
  const t = it.t;
  return [t.name, t.koreanName ?? '', ...(t.aliases ?? [])].map((s) => s.toLowerCase().trim()).filter((s) => s.length >= 2);
}

function ensureNames() {
  if (!nameIndex) {
    nameIndex = techniqueIndex().flatMap((it) => nameKeys(it).map((key) => ({ key, it })));
    nameIndex.sort((a, b) => b.key.length - a.key.length);
  }
  return nameIndex;
}

let words: Set<string> | null = null;
/** Every word used in a DB technique name (lower-case) — to tell a misspelt / unknown name from a list of real ones. */
export function dbNameWords(): Set<string> {
  if (!words) {
    words = new Set();
    for (const it of techniqueIndex()) for (const w of `${it.t.name} ${(it.t.aliases ?? []).join(' ')}`.toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) words.add(w);
  }
  return words;
}

/** Exact DB name (case-insensitive), preferring the given arts; null when the DB has no such record. */
export function resolveName(name: string, preferArts: string[] = []): IndexedTechnique | null {
  const [base, pinned] = name.split('@');
  const key = base.toLowerCase().trim();
  const hits = ensureNames().filter((n) => n.key === key);
  if (!hits.length) return null;
  const arts = pinned ? [pinned, ...preferArts] : preferArts;
  for (const a of arts) {
    const h = hits.find((x) => x.it.t.martialArt === a);
    if (h) return h.it;
  }
  return hits[0].it;
}

/** Techniques named in free text (English DB names / Korean names / Korean terms), resolved against the DB only. */
export function findMentioned(text: string, preferArts: string[]): { it: IndexedTechnique; term: string }[] {
  const lower = text.toLowerCase();
  const out = new Map<string, { it: IndexedTechnique; term: string }>();
  for (const n of ensureNames()) {
    if (n.key.length < 4 && !/[가-힣]/.test(n.key)) continue; // short English names ("Jab") come via KOREAN_TERMS / word match below
    if (/[가-힣]/.test(n.key) ? lower.includes(n.key) : new RegExp(`\\b${n.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      if (![...out.values()].some((o) => o.term.includes(n.key))) out.set(n.it.t.id, { it: n.it, term: n.key });
    }
  }
  for (const w of lower.match(/\b[a-z]{3,}\b/g) ?? []) {
    const it = resolveName(w, preferArts);
    // a word inside a longer name already found ("hook" in "heel hook") is not a second mention
    if (it && !out.has(it.t.id) && ![...out.values()].some((o) => o.term !== w && o.term.includes(w))) out.set(it.t.id, { it, term: w });
  }
  const compact = lower.replace(/\s+/g, '');
  for (const [re, names] of KOREAN_TERMS) {
    const m = lower.match(re) ?? compact.match(re);
    if (!m) continue;
    for (const nm of names) {
      const it = resolveName(nm, preferArts);
      if (it && !out.has(it.t.id)) out.set(it.t.id, { it, term: m[0] });
    }
  }
  return [...out.values()];
}
