import type { Technique } from '../../types';
import { DIMENSION_BY_ID, type Dimension } from './dimensions';

// Data-based classification of ONE technique along the taxonomy's dimensions — never from the name alone when the
// technique has its own description. Evidence, strongest first:
//   HIGH    the defining clause of the technique's own overview ("… 상대를 넘기는 스윕입니다", the last words before
//           the sentence's predicate) names the dimension
//   MEDIUM  the technique's names (name / Korean name / aliases) name it, and the defining clause does not name a
//           different dimension of the same split
//   LOW     only its steps, key points or other sentences mention it ("…으로 서브미션을 시도합니다") — never assigned
//           automatically, kept as a review candidate
// The existing category string is never used as purpose evidence (a "백 컨트롤" category says where, not what for).

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DimEvidence {
  dim: string;
  confidence: Confidence;
  basis: string;
}

const PREDICATE_END = /(입니다|이다|합니다|됩니다|한다|된다|이에요|예요)[.!]?/;
const WINDOW = 34;

// "…스윕과 서브미션을 노리는 그립입니다" — what a technique LEADS TO is not what it IS: only the words after the last
// lead-to marker are the definition ("그립")
// … and what it DEFENDS AGAINST is not what it is either ("로우킥을 막는 가드" is a guard, not a low kick)
const LEADS_TO = /(노리는|노리기|노립|위한|위해|준비하는|연결하는|연결되는|연결할|이어지는|이어가는|만드는|열어주는|여는|시도하는|시도할|대비하는|막기 위|만들어|막는|막아내는|방어하는|대응하는|피하는|흘리는|받아내는|차단하는)\s*/g;

/** The defining clause of a description: the words right before the first sentence's predicate, after the last lead-to marker. */
export function definingClause(text: string | null | undefined): string {
  if (!text) return '';
  const first = text.split(/(?<=[.!?。])\s+|\n/)[0] ?? '';
  const m = PREDICATE_END.exec(first);
  // "아메리카나는 … 제압하는 관절기로, 주로 …에서 시도됩니다" — the definition ends at the appositive "~로, / ~이며,"
  const appositive = /(으로|로|이며|이고|이자),\s/.exec(first);
  const end = Math.min(m ? m.index : first.length, appositive && appositive.index >= 10 ? appositive.index : Infinity);
  const window = first.slice(Math.max(0, end - WINDOW), end);
  let cut = 0;
  for (let x = LEADS_TO.exec(window); x; x = LEADS_TO.exec(window)) cut = x.index + x[0].length;
  LEADS_TO.lastIndex = 0;
  return window.slice(cut);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const enCache = new Map<string, RegExp>();
function enRe(term: string): RegExp {
  let re = enCache.get(term);
  if (!re) {
    re = /^[a-z0-9]/i.test(term) ? new RegExp(`(^|[^a-z])${escapeRe(term).replace(/\s+/g, '[\\s-]*')}(?![a-z])`, 'i') : new RegExp(escapeRe(term), 'i');
    enCache.set(term, re);
  }
  return re;
}

/** The dimension's term found in the text and where its LAST occurrence ends (for "closest to the predicate"). */
export function findDimension(dim: Dimension, text: string): { term: string; end: number } | null {
  if (!text) return null;
  let t = text.toLowerCase();
  for (const m of dim.mask ?? []) t = t.split(m.toLowerCase()).join(' '.repeat(m.length));
  let best: { term: string; end: number } | null = null;
  for (const raw of dim.termsKo) {
    // "포지션$": only as the clause's last word (the head noun), never "포지션을 벗어나는"
    const atEnd = raw.endsWith('$');
    const k = atEnd ? raw.slice(0, -1) : raw;
    const i = t.lastIndexOf(k.toLowerCase());
    if (i < 0 || (atEnd && t.trimEnd().length !== i + k.length)) continue;
    if (!best || i + k.length > best.end) best = { term: k, end: i + k.length, weak: atEnd } as { term: string; end: number };
  }
  for (const e of dim.termsEn) {
    const re = new RegExp(enRe(e).source, 'gi');
    for (let x = re.exec(t); x; x = re.exec(t)) if (!best || x.index + x[0].length > best.end) best = { term: e, end: x.index + x[0].length };
  }
  return best;
}

export function matchesDimension(dim: Dimension, text: string): string | null {
  return findDimension(dim, text)?.term ?? null;
}

export interface TechniqueTexts {
  /** Defining clauses, strongest source first: the technique's own overview, then its own description / purpose. */
  definings: string[];
  names: string;
  body: string;
}

/**
 * `shared` = description / purpose paragraphs that several techniques of the art carry verbatim — those describe the
 * CATEGORY ("상대의 몸통 위에 올라가 상위권을 확보하는 핵심 포지션."), not the technique, and are never evidence.
 */
export function techniqueTexts(t: Technique, shared: Set<string> = new Set()): TechniqueTexts {
  const p = t.posture;
  const overview = p?.overview ?? '';
  const own = (x: string | null | undefined) => (x && !shared.has(x.trim()) ? x : '');
  const definings = [definingClause(overview), definingClause(own(t.description)), definingClause(own(t.purpose))].filter(Boolean);
  const names = [t.name, t.koreanName ?? '', ...(t.aliases ?? [])].join(' | ');
  const body = [overview, p?.startingPosition ?? '', ...(p?.steps ?? []), ...(p?.keyPoints ?? []), own(t.description), own(t.purpose)].join(' | ');
  return { definings, names, body };
}

/** Evidence for each requested dimension; `among` = the dimensions competing in the same split (for the MEDIUM rule). */
export function classifyDimensions(t: Technique, dims: string[], among: string[] = dims, texts: TechniqueTexts = techniqueTexts(t)): DimEvidence[] {
  const out: DimEvidence[] = [];
  // the definition's head: of the competing dimensions found in the defining clause, the one closest to the predicate
  // ("팔을 고정해 팔꿈치를 펴는 관절기" → 관절기, not 고정); the others there are description, not definition
  // the first defining clause (own overview first) that names any competing dimension is THE definition
  let defining = '';
  let found: { id: string; hit: { term: string; end: number } }[] = [];
  for (const clause of texts.definings) {
    found = among
      .map((id) => ({ id, hit: DIMENSION_BY_ID.get(id) ? findDimension(DIMENSION_BY_ID.get(id)!, clause) : null }))
      .filter((x): x is { id: string; hit: { term: string; end: number } } => !!x.hit);
    if (found.length > 0) {
      defining = clause;
      break;
    }
  }
  let headEnd = Math.max(-1, ...found.map((x) => x.hit.end));
  // a generic head noun ("…패스 포지션") yields to the specific term right before it
  const head = found.filter((x) => x.hit.end === headEnd);
  if (head.every((x) => (x.hit as { weak?: boolean }).weak)) {
    const near = found.filter((x) => !(x.hit as { weak?: boolean }).weak && headEnd - x.hit.end <= 12);
    if (near.length > 0) headEnd = Math.max(...near.map((x) => x.hit.end));
  }
  const definingHits = new Set(found.filter((x) => x.hit.end === headEnd).map((x) => x.id));
  for (const id of dims) {
    const d = DIMENSION_BY_ID.get(id);
    if (!d) continue;
    const inDefining = found.find((x) => x.id === id)?.hit;
    if (inDefining && definingHits.has(id)) {
      out.push({ dim: id, confidence: 'HIGH', basis: `설명의 정의 문장: "${defining.trim()}" (${inDefining.term})` });
      continue;
    }
    if (inDefining) {
      out.push({ dim: id, confidence: 'LOW', basis: `설명에 부수적으로 언급: ${inDefining.term}` });
      continue;
    }
    const inName = matchesDimension(d, texts.names);
    if (inName) {
      // the description defines it as something else of the same split → the name alone is not enough
      const contradicted = [...definingHits].some((other) => other !== id);
      out.push({ dim: id, confidence: contradicted ? 'LOW' : 'MEDIUM', basis: contradicted ? `이름(${inName})과 설명의 정의가 다름` : `기술명/별칭: ${inName}` });
      continue;
    }
    const inBody = matchesDimension(d, texts.body);
    if (inBody) out.push({ dim: id, confidence: 'LOW', basis: `단계·설명 일부에만 언급: ${inBody}` });
  }
  return out;
}
