// Rule-based style extraction from fetched analysis pages — no model.
//
// Finds MARTIALDEX technique names in the page text and keeps the WHOLE source
// sentence as the quote (so mergeStyleItems verifies it against the page):
//   combo      ≥2 technique names joined by a sequence word ("jab to the body,
//              followed by a left hook", "1-2", "→")
//   setup      a technique name with set-up words ("feints the jab to set up …")
//   situation  counter-punching / reacting ("counters with the left hand")
//   distance   range / stance / footwork sentences
//   technique  a technique the page names together with the fighter's name
// Measured: the 3B model's extraction returned 0 usable items for Lomachenko
// (repeat-limit, names not matching the DB); this path is deterministic, fast,
// and every item is a real sentence of a real page.
// 3차: every technique mention is attributed (actor.ts) — only what the FIGHTER does
// (a reported action or an analysis of his game) becomes a style item; the opponent's
// techniques, general explanations, advice / hypotheticals and video captions are kept
// apart with their sentences, never counted as the fighter's style.

import type { Technique } from '../../types';
import type { ResearchResult } from '../selfResearch/types';
import { getUnifiedAllTechniques } from '../userTechniques/service';
import { attribute, FIGHTER_EVIDENCE, opponentsIn, personAfter, type Attribution, type EvidenceKind } from './actor';

export interface RuleItem {
  kind: 'setup' | 'combo' | 'technique' | 'distance' | 'situation' | 'gameplan';
  text: string;
  steps?: string[];
  ids?: string[];
  quote: string;
  /** How the sentence supports it (actor.ts): direct / analysis for the fighter's items. */
  evidence?: EvidenceKind;
  /** The opponent's reaction the move answers / draws ("when opponents rush in"), from the sentence itself. */
  reaction?: string;
  reason?: string;
}

/** A technique named in a page but NOT done by the fighter (opponent / general / hypothetical / unclear / caption). */
export interface ExcludedMention {
  /** The page it came from (set by the caller). */
  url?: string;
  name: string;
  techniqueId: string;
  evidence: EvidenceKind;
  reason: string;
  quote: string;
}

// "when his opponent shells up, he goes to the body", "once Diaz was over-reacting to the low kick, McGregor …"
const REACTION = /\b(?:when|whenever|if|as|once|after)\s+((?:his|the)\s+opponents?|opponents|they|[A-Z][a-z]+)\s+((?:\w+[\s-]){0,5}?\w+?)(?=,|\s+(?:he|then)\b)/i;
const GAMEPLAN = /(?<![-\w])(pressure|pressur(?:es|ing)|aggressive|aggression|patient|patience|pace|volume|output|cardio|conditioning|forward|backs? (?:up|down)|counter-striker|counter puncher|front-foot|back-foot|takedown defen[cs]e|cage control|clinch work|ground game|wrestling|grappling|tempo|game ?plan|tactic|strategy|calculated|explosive)\b/i;

const STRIKING = ['boxing', 'kickboxing', 'muay-thai', 'mixed-martial-arts', 'karate', 'taekwondo'];
const GRAPPLING = ['wrestling', 'bjj', 'judo', 'sambo', 'mixed-martial-arts'];
/** Names that are ordinary words in an analysis text, not a specific technique. */
// ("evade strikes", "hopping in and out of range" are verbs here, not the records "Evade" / "In-and-Out")
const GENERIC_NAMES = new Set(['combination', 'combo', 'counter', 'stance', 'guard', 'footwork', 'defense', 'defence', 'basic', 'position', 'control', 'pressure', 'distance', 'range', 'timing', 'movement', 'evade', 'in-and-out', 'in and out', 'step', 'pivot', 'block', 'parry', 'feint', 'clinch', 'sprawl', 'base', 'frame', 'post', 'shot', 'entry', 'finish', 'escape', 'reversal', 'transition', 'drill', 'angle', 'turn', 'press', 'push', 'pull', 'touch', 'snap']);
const STANCE_NAME = /stance|southpaw|orthodox|footwork|shuffle|switch/i;

const SEQUENCE = /\b(followed by|to the body|to the head|into (a|the)|then|and then|behind (a|the)|off (a|the)|one-two|1-2|double)\b|→|->/i;
const SETUP = /\b(set(s|ting)? up|setup|feint(s|ed|ing)?|bait(s|ed|ing)?|draw(s|ing)? (him|them|out|the)|disguis|hide(s)? the|open(s|ed|ing)? up)\b/i;
const COUNTER = /\b(counter(s|ed|ing|-punch|punch(er|ing)?)?|catch(es)? (him|them|opponents?)|as (he|they|the opponent) (comes|steps|lunges|throws)|on the (way|break) in|pull counter)\b/i;
const DISTANCE = /(?<![-\w])(range|distance|stance|southpaw|orthodox|bladed|footwork|switch(es)? stance|in and out|angle(s)?|lateral|circle|circling|kicking range|pocket)\b/i;

export function artsForTopic(text: string, art: string | null): string[] {
  if (/(타격|striking|펀치|킥|복싱|boxing)/i.test(text)) return STRIKING;
  if (/(그래플링|grappling|레슬링|wrestling|주짓수|bjj|서브미션|테이크다운)/i.test(text)) return GRAPPLING;
  return art ? [art, ...(art === 'mixed-martial-arts' ? [...STRIKING, ...GRAPPLING] : [])] : [...new Set([...STRIKING, ...GRAPPLING])];
}

interface NameRef {
  re: RegExp;
  name: string;
  technique: Technique;
}

let cache: { key: string; refs: NameRef[] } | null = null;

/** Word-bounded English names (and aliases) of the techniques of these arts, longest first. */
function nameRefs(arts: string[]): NameRef[] {
  const all = getUnifiedAllTechniques();
  const key = `${arts.join(',')}|${all.length}`;
  if (cache?.key === key) return cache.refs;
  const seen = new Set<string>();
  const refs: NameRef[] = [];
  for (const t of all) {
    if (!arts.includes(t.martialArt)) continue;
    for (const n of [t.name, ...(t.aliases ?? [])]) {
      const name = n.trim();
      const low = name.toLowerCase();
      if (!/^[A-Za-z][A-Za-z0-9 '\-]{1,40}$/.test(name) || name.length < 3 || GENERIC_NAMES.has(low) || seen.has(low)) continue;
      seen.add(low);
      refs.push({ re: new RegExp(`\\b${low.replace(/[-\s]+/g, '[-\\s]?')}s?\\b`, 'i'), name, technique: t });
    }
  }
  refs.sort((a, b) => b.name.length - a.name.length);
  cache = { key, refs };
  return refs;
}

/**
 * "jab-cross", "jab / cross": two names joined only by a hyphen or slash read as a sequence.
 * Not a comma — "front kicks, side kicks, spinning attacks" is a list, not a combination.
 */
function adjacentPair(sentence: string, names: { at: number; end: number }[]): boolean {
  return names.some((n, i) => i > 0 && /^\s*[-–/]\s*$/.test(sentence.slice(names[i - 1].end, n.at)));
}

/** Technique names in a sentence, in order of appearance, longer names first ("Left Hook" before "Hook"). */
function namesIn(sentence: string, refs: NameRef[]): { name: string; technique: Technique; at: number; end: number }[] {
  const out: { name: string; technique: Technique; at: number; end: number }[] = [];
  for (const r of refs) {
    const m = r.re.exec(sentence);
    if (!m) continue;
    const at = m.index;
    const end = at + m[0].length;
    // "cross-weight", "cross-division": a word joined to the name, not a technique — unless the joined word starts another name ("jab-cross")
    const joined = /^-([a-z]+)/i.exec(sentence.slice(end));
    if (joined && !refs.some((x) => x.re.test(joined[1]))) continue;
    if (/[a-z]-$/i.test(sentence.slice(Math.max(0, at - 1), at)) && !refs.some((x) => x.re.test(sentence.slice(Math.max(0, at - 20), at - 1).split(/[\s-]/).pop() ?? ''))) continue;
    if (out.some((o) => at < o.end && end > o.at)) continue; // inside a longer name already found
    if (out.some((o) => o.technique.name === r.technique.name)) continue;
    out.push({ name: r.technique.name, technique: r.technique, at, end });
  }
  return out.sort((a, b) => a.at - b.at);
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 400);
}

/** The fighter as a page refers to them: full name, surname, first name (≥3 letters). */
export function nameVariants(fighterEn: string): RegExp {
  const parts = fighterEn.split(/\s+/).filter((p) => p.length >= 3);
  const alts = [fighterEn, ...parts].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${alts.join('|')})\\b`, 'i');
}

export function ruleBasedItems(page: ResearchResult, fighterEn: string | null, arts: string[]): RuleItem[] {
  return ruleBasedAnalysis(page, fighterEn, arts).items;
}

/** The fighter's items and, separately, every mention that is not the fighter's. */
export function ruleBasedAnalysis(page: ResearchResult, fighterEn: string | null, arts: string[]): { items: RuleItem[]; excluded: ExcludedMention[] } {
  const body = page.content ?? '';
  const empty = { items: [], excluded: [] };
  if (!body) return empty;
  const who = fighterEn ? nameVariants(fighterEn) : null;
  // a page that never names the fighter is not about them
  if (who && !who.test(body)) return empty;
  const refs = nameRefs(arts);
  const items: RuleItem[] = [];
  const excluded: ExcludedMention[] = [];
  // a video's text is its title / description — a caption, not an analysis of the fights
  const caption = page.sourceType === 'video';
  // pages are about the fighter: pronouns start with him; other people are only those the page
  // names as his opponents ("against Aldo", "Diaz bout") — not every capitalised word ("Celtic Cross")
  let lastPerson: 'fighter' | 'opponent' | null = 'fighter';
  const opponents = opponentsIn(body, who) ?? /(?!)/;
  for (const s of sentencesOf(body)) {
    const ctx = { who, lastPerson, caption, opponents };
    const all = namesIn(s, refs).map((n) => ({ ...n, a: attribute(s, n.at, ctx) as Attribution }));
    lastPerson = personAfter(s, ctx);
    for (const n of all.filter((x) => x.a.actor !== 'fighter' || !FIGHTER_EVIDENCE.includes(x.a.evidence))) excluded.push({ name: n.name, techniqueId: n.technique.id, evidence: n.a.actor === 'fighter' ? n.a.evidence : n.a.evidence, reason: n.a.reason, quote: s });
    const names = all.filter((x) => x.a.actor === 'fighter' && FIGHTER_EVIDENCE.includes(x.a.evidence));
    // the sentence's evidence: a reported action beats an analysis
    const evidence: EvidenceKind | undefined = names.some((x) => x.a.evidence === 'direct') ? 'direct' : names.length ? 'analysis' : undefined;
    const reason = names[0]?.a.reason;
    const stances = names.filter((n) => STANCE_NAME.test(n.name));
    const moves = names.filter((n) => !STANCE_NAME.test(n.name));
    const steps = moves.map((n) => n.name);
    const ids = moves.map((n) => n.technique.id);
    const rx = REACTION.exec(s);
    const reaction = rx && moves.some((m) => m.at > rx.index + rx[0].length - 1) ? `${rx[1]} ${rx[2]}`.replace(/\s+/g, ' ').trim() : undefined;
    const base = { quote: s, evidence, reason, ...(reaction ? { reaction } : {}) };
    if (moves.length >= 2 && (SEQUENCE.test(s) || adjacentPair(s, moves))) items.push({ kind: 'combo', text: `콤비네이션: ${steps.join(' → ')}`, steps, ids, ...base });
    else if (moves.length >= 1 && (SETUP.test(s) || reaction)) items.push({ kind: 'setup', text: reaction ? `셋업: 상대 반응(${reaction}) → ${steps.join(' → ')}` : `셋업: ${steps.join(' → ')}`, steps, ids, ...base });
    else if (moves.length >= 1 && COUNTER.test(s)) items.push({ kind: 'situation', text: `카운터: ${steps.join(', ')}`, steps, ids, ...base });
    // each technique the fighter uses is also a "주요 기술" item, so the same weapon named on two
    // sites is recognised as confirmed by both (whatever sentence shape each site used)
    for (const n of moves.slice(0, 2)) items.push({ kind: 'technique', text: `주요 기술: ${n.name}`, steps: [n.name], ids: [n.technique.id], quote: s, evidence: n.a.evidence, reason: n.a.reason });
    for (const n of stances.slice(0, 2)) items.push({ kind: 'distance', text: `거리·스탠스: ${n.name}`, steps: [n.name], ids: [n.technique.id], quote: s, evidence: n.a.evidence, reason: n.a.reason });
    // keyword-only sentences must name him (or say he/his) themselves — "Adjust volume based on your recovery" is not about him
    if (!all.length && who && !caption && (who.test(s) || /\b(he|his|him)\b/i.test(s))) {
      // sentences about how HE fights (no technique name): range / stance, game plan
      const d = DISTANCE.exec(s);
      const g = GAMEPLAN.exec(s);
      const hit = d ?? g;
      const negated = hit && /(?:\bnot\b|n't\b|\bnever\b|\brarely\b|\bno\b|\bwithout\b|\blacks?\b)(?:\s+\w+){0,3}\s*$/i.test(s.slice(Math.max(0, hit.index - 40), hit.index));
      const training = /\b(?:miles|sprints?|intervals?|workouts?|training camp|strength (?:and|&) conditioning|heart rate|reps|sets of|lifting)\b/i.test(s);
      if (hit && !negated && !training) {
        const a = attribute(s, hit.index, ctx);
        if (a.actor === 'fighter' && FIGHTER_EVIDENCE.includes(a.evidence)) {
          if (d) items.push({ kind: 'distance', text: `거리·스탠스: ${d[0].toLowerCase()}`, quote: s, evidence: a.evidence, reason: a.reason });
          else if (g) items.push({ kind: 'gameplan', text: `경기 운영: ${g[0].toLowerCase()}`, quote: s, evidence: a.evidence, reason: a.reason });
        }
      }
    }
  }
  return { items: items.slice(0, 30), excluded: excluded.slice(0, 40) };
}
