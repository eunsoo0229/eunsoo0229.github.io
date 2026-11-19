import type { Technique } from '../../types';
import { getUnifiedAllTechniques, normalizeTechniqueName } from '../userTechniques/service';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { namesOf } from './lookup';

// Technique relations READ from the technique data's own sentences — no new data, nothing guessed.
// The technique graph (techniqueGraph/buildGraph.ts) only reads the short transitions / counters /
// defenses fields, which are almost empty (counter edges on 2 of 1,138 techniques). The hand-written
// posture texts often NAME another technique ("스프롤로 상대의 테이크다운을 막은 뒤 … 프론트 헤드락으로
// 연결"). Each such mention becomes a relation that carries its source sentence:
//   next     the sentence connects / transitions to the named technique (연결·전환·이어·후속 …)
//   counter  the sentence stops / escapes / answers the named technique (막·방어·탈출·카운터 …)
//            → stored on the NAMED technique as "countered by" this one
//   mention  named without either kind of word (shown only as "자료에 함께 언급됨")
// Only names of 3+ characters that are not everyday position words are matched.

export type DerivedKind = 'next' | 'counter' | 'mention';
export interface DerivedRelation {
  kind: DerivedKind;
  /** The other technique. */
  techniqueId: string;
  /** The data sentence the relation comes from (verbatim). */
  sentence: string;
  /** The technique whose data holds the sentence. */
  sourceId: string;
}

/** Names too general to mean one technique inside a sentence. */
const TOO_GENERAL = new Set(['가드', '그립', '스탠스', '프레임', '베이스', '포지션', '컨트롤', '피벗', '스텝', '클린치', '펀치', '킥', '훅', '콤비네이션', '콤보', '페인트', '방어', '카운터', '탈출', '테이크다운', '서브미션']);

interface Index {
  count: number;
  names: { key: string; raw: string; ids: string[] }[];
  outgoing: Map<string, DerivedRelation[]>;
  counteredBy: Map<string, DerivedRelation[]>;
  ledFrom: Map<string, DerivedRelation[]>;
}
let cache: Index | null = null;

function sentencesOf(t: Technique): string[] {
  const p = t.posture;
  return [p?.overview, p?.startingPosition, ...(p?.steps ?? []), ...(p?.keyPoints ?? []), ...(p?.commonMistakes ?? []), t.description, t.purpose]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .flatMap((x) => x.split(/(?<=[.!?。])\s+/));
}

/** What the sentence says about the named technique, read right after EACH mention of the name. */
function kindAt(sentence: string, name: string): DerivedKind {
  const re = new RegExp(name.trim().split('').map((ch) => (/\s/.test(ch) ? '\\s*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join(''), 'gi');
  let best: DerivedKind = 'mention';
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
    const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 20);
    // "로우킥을 직접 막아내는", "니킥이나 로우킥을" → the named technique is what gets stopped
    // ("크로스페이스로 … 막아" uses it as the tool; "Ouchi Gari가 막히면" is it being blocked)
    const stop = /^\s*(을|를|이나|나)\s*([^.]{0,10}?)(막(아|는|기|을|은|고|으)|방어|피하|피해|벗어나|탈출|되받|무력화|흘려)/.exec(after);
    // "언더훅을 확보해 … 막기" uses it as the tool — not something being stopped
    // a feint ("로우킥을 암시해 … 방어를 유도") is not a counter either
    if (stop && !/막히|막혀|막힐/.test(after) && !/확보|이용|사용|써서|잡아|잡고|만들어|걸어|암시|유도|처럼|보이게/.test(stop[2])) return 'counter';
    // "… 버터플라이 스윕으로 연결", "바 암으로 전환", "하이킥으로 마무리"
    // also a list: "프론트 헤드락이나 백으로 연결"
    if (/^\s*((이나|나|또는|,|와|과)\s*[^.]{0,12}?)?(으로|로)\s*[^.]{0,8}?(연결|전환|이어|넘어|마무리|들어가)/.test(after)) best = 'next';
  }
  return best;
}

function build(): Index {
  const all = getUnifiedAllTechniques().filter((t) => !/home-training|gym/.test(t.martialArt));
  if (cache && cache.count === all.length) return cache;
  const byKey = new Map<string, { raw: string; ids: Set<string> }>();
  for (const t of all) {
    for (const n of namesOf(t)) {
      const key = normalizeTechniqueName(n);
      if (key.length < 3 || TOO_GENERAL.has(n.trim())) continue;
      const e = byKey.get(key) ?? { raw: n, ids: new Set<string>() };
      e.ids.add(canonicalTechniqueId(t.id));
      byKey.set(key, e);
    }
  }
  // longest names first so "스프롤 투 프론트 헤드락" wins over "스프롤"
  const names = [...byKey].map(([key, e]) => ({ key, raw: e.raw, ids: [...e.ids] })).sort((a, b) => b.key.length - a.key.length);
  const outgoing = new Map<string, DerivedRelation[]>();
  const counteredBy = new Map<string, DerivedRelation[]>();
  const ledFrom = new Map<string, DerivedRelation[]>();
  // sentences repeated on 3+ techniques are category paragraphs, not this technique's own statement
  const seen = new Map<string, number>();
  for (const t of all) for (const x of new Set(sentencesOf(t).map((y) => y.trim()))) seen.set(x, (seen.get(x) ?? 0) + 1);
  for (const t of all) {
    const self = canonicalTechniqueId(t.id);
    const rels: DerivedRelation[] = [];
    for (const sentence of sentencesOf(t)) {
      if ((seen.get(sentence.trim()) ?? 0) >= 3) continue;
      let flat = normalizeTechniqueName(sentence);
      for (const n of names) {
        if (!flat.includes(n.key)) continue;
        flat = flat.split(n.key).join('|'); // consumed: shorter names inside it don't count again
        if (n.ids.length !== 1 || n.ids[0] === self) continue; // ambiguous names / itself
        const kind = kindAt(sentence, n.raw);
        if (!rels.some((r) => r.techniqueId === n.ids[0] && r.kind === kind)) rels.push({ kind, techniqueId: n.ids[0], sentence: sentence.trim(), sourceId: self });
      }
    }
    outgoing.set(self, rels);
    for (const r of rels) if (r.kind === 'counter') counteredBy.set(r.techniqueId, [...(counteredBy.get(r.techniqueId) ?? []), r]);
    for (const r of rels) if (r.kind === 'next') ledFrom.set(r.techniqueId, [...(ledFrom.get(r.techniqueId) ?? []), r]);
  }
  cache = { count: all.length, names, outgoing, counteredBy, ledFrom };
  return cache;
}

/** Relations this technique's own data states (next / counter-of / mention), each with its sentence. */
export function derivedRelations(t: Technique): DerivedRelation[] {
  return build().outgoing.get(canonicalTechniqueId(t.id)) ?? [];
}

/** Techniques whose own data says they stop / escape / answer `t` — with that sentence. */
export function counteredBy(t: Technique): DerivedRelation[] {
  return build().counteredBy.get(canonicalTechniqueId(t.id)) ?? [];
}

/** Techniques whose own data says they lead INTO `t` ("… 바 암으로 전환") — the closest thing to a prerequisite the data states. */
export function ledFrom(t: Technique): DerivedRelation[] {
  return build().ledFrom.get(canonicalTechniqueId(t.id)) ?? [];
}
