// 근거 대조 — code checks each sentence of the local model's answer against the source text the model was given.
// The small model often writes no [n] at all, and once turned "경기력이 기준치의 2% 이내로 회복" into "2%까지 하락"
// (measured 2026-11-07). Nothing here asks a model; it compares text:
//
//   supported    the sentence matches a source sentence (character-bigram coverage) — that source's number is shown
//   unverified   no source sentence says it (may still be the model's own advice — the learner is told to check)
//   contradicted the matching source says the opposite / a different figure → the sentence is removed from the answer
//
// Cautions (shown, sentence kept — heuristic, can be wrong): figure not in any source, certainty the source does not
// have, a cause the source does not state, a claim widened from athletes to everyone, a condition left out.

export interface EvidenceSource {
  n: number;
  /** The text the model saw for this source (page sentences or search summary). */
  text: string;
}

export type ClaimProblem =
  | 'direction_flip' // 증가↔감소, 회복↔하락 against the source sentence with the same figure
  | 'unit_mismatch' // same number, different unit
  | 'number_not_in_source' // a figure no source (and no MARTIALDEX data) contains
  | 'overclaim' // 반드시 / 확실히 / 증명 … the source does not say
  | 'causal_added' // 때문에 / 원인 … the matched source sentence has no cause
  | 'scope_generalized' // source about athletes, answer about everyone
  | 'condition_dropped' // source figure had a condition (이내 / 이상 / 경우 …) the answer left out
  | 'negation_mismatch'; // the same term, negated in one and not the other (않 / 없 / 못 / 아니)

export interface ClaimCheck {
  sentence: string;
  status: 'supported' | 'unverified' | 'contradicted' | 'opinion';
  /** Best matching source number (supported / contradicted). */
  source: number | null;
  /** The app-assigned id of that source (set by the caller from the source list). */
  sourceId?: string;
  /** The source sentence it was compared with. */
  quote?: string;
  problems: ClaimProblem[];
}

export const PROBLEM_LABEL: Record<ClaimProblem, string> = {
  direction_flip: '출처와 반대 방향(증가↔감소·회복↔하락)',
  unit_mismatch: '출처와 단위가 다름',
  number_not_in_source: '출처에 없는 수치',
  overclaim: '출처보다 단정적인 표현',
  causal_added: '출처에 없는 인과관계',
  scope_generalized: '선수 대상 내용을 일반화',
  condition_dropped: '출처의 조건이 빠짐',
  negation_mismatch: '출처와 부정·긍정이 반대',
};

const CONTRADICTION: ClaimProblem[] = ['direction_flip', 'unit_mismatch', 'negation_mismatch'];
const SUPPORT_MIN = 0.42;
const UP = /(증가|상승|높(아|게|고|은|이)|늘(어|었|리|고|며|면|게|린)|향상|회복|개선|좋아|커지|커진|치솟|올라|올리)/;
const DOWN = /(감소|하락|저하|낮(아|게|고|은|추)|줄(어|었|이|고|며|면|게|인|일)|악화|떨어|약해|작아|손실|내려)/;
const CERTAIN = /(반드시|확실히|틀림없이|증명|입증|항상|무조건|100\s*%|모든 선수|누구나)/;
const CAUSE = /(때문에|때문이|로 인해|으로 인해|원인|탓에|그래서|따라서|야기|초래)/;
const CAUSE_SRC = /(때문|인해|원인|초래|야기|이어지|유발|결과로|cause|lead|result)/i;
const EVERYONE = /(일반인|누구나|모든 사람|여러분|우리 모두|사람들은)/;
const ATHLETE = /(선수|파이터|athlete|fighter|대상자|참가자)/i;
const CONDITION = /(이내|이상|이하|미만|초과|경우|때에만|조건|한해|한정)/;
const OPINION = /^(제 판단으로는|제 생각에는|제 판단에|저라면|추천드리|권장드리)/;
const NUM = /(\d+(?:[.,]\d+)?)\s*(%|퍼센트|kg|킬로|㎏|cm|센티|시간|분|초|일|주|개월|년|명|배|회|번)?/g;

const UNIT_OF: Record<string, string> = { '%': '%', 퍼센트: '%', kg: 'kg', 킬로: 'kg', '㎏': 'kg', cm: 'cm', 센티: 'cm' };

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/[^0-9A-Za-z가-힣%]/g, '').toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function coverage(claim: Set<string>, src: Set<string>): number {
  if (!claim.size) return 0;
  let hit = 0;
  for (const b of claim) if (src.has(b)) hit++;
  return hit / claim.size;
}

function numbers(s: string): { value: string; unit: string | null; at: number }[] {
  const out: { value: string; unit: string | null; at: number }[] = [];
  for (const m of s.matchAll(NUM)) {
    const value = m[1].replace(',', '.');
    const unit = m[2] ? UNIT_OF[m[2]] ?? m[2] : null;
    out.push({ value, unit, at: m.index ?? 0 });
  }
  return out;
}

/** Up / down meaning of the words around position `at` (±28 chars), or of the whole sentence. */
function polarity(s: string, at?: number): 'up' | 'down' | null {
  const w = at === undefined ? s : s.slice(Math.max(0, at - 28), at + 28);
  const up = UP.test(w);
  const down = DOWN.test(w);
  return up && !down ? 'up' : down && !up ? 'down' : null;
}

const PARTICLE = /(이|가|을|를|은|는|도|의|에|에서|으로|로|와|과)$/;
const COMMON = new Set(['선수들', '때문에', '경우에', '그리고', '하지만', '있습니다', '합니다', '것입니다', '수있습니다', '격투기']);

/** Distinctive words (3+ chars after the particle) — what a faithful paraphrase keeps. */
function anchorTerms(s: string): string[] {
  return [...new Set(s.split(/\s+/).map((w) => w.replace(/[^0-9A-Za-z가-힣]/g, '').replace(PARTICLE, '')).filter((w) => w.length >= 3 && !COMMON.has(w) && !/(니다|어요|해요|습니|있어|없어|합니)$/.test(w)))];
}

/** A shared key term whose following words move in opposite directions in the two sentences (returns the term). */
function termFlip(claim: string, src: string): string | null {
  const words = claim.split(/\s+/).map((w) => w.replace(/[^0-9A-Za-z가-힣]/g, '').replace(PARTICLE, '')).filter((w) => w.length >= 2);
  for (const w of words) {
    const ia = claim.indexOf(w);
    const is = src.indexOf(w);
    if (ia < 0 || is < 0) continue;
    const pa = polarityAfter(claim, ia + w.length);
    const ps = polarityAfter(src, is + w.length);
    if (pa && ps && pa !== ps) return w;
  }
  return null;
}

const NEGATION = /(않|없|못하|못 |아니|안 (된|돼|되|한|해))/;

/** A shared distinctive term (3+ chars) negated right after it in exactly one of the two sentences. */
function negationFlip(claim: string, src: string): string | null {
  for (const w of anchorTerms(claim)) {
    const ia = claim.indexOf(w);
    const is = src.indexOf(w);
    if (ia < 0 || is < 0) continue;
    const na = NEGATION.test(claim.slice(ia + w.length, ia + w.length + 12));
    const ns = NEGATION.test(src.slice(is + w.length, is + w.length + 12));
    if (na !== ns) return w;
  }
  return null;
}

/** Is the sentence's predicate negated ("도움이 되지 않습니다")? — compared only between closely matching sentences. */
function finalNegation(s: string): boolean {
  return /(않|없|못하|아니|안 된|안 돼)[가-힣]{0,6}[.!?。]?\s*$/.test(s.trim());
}

/** One line for the answer: how much of it the sources confirmed. */
export function claimSummary(checks: ClaimCheck[]): string | null {
  const facts = checks.filter((c) => c.status !== 'opinion');
  if (!facts.length) return null;
  const sup = facts.filter((c) => c.status === 'supported').length;
  const unv = facts.filter((c) => c.status === 'unverified').length;
  const con = facts.filter((c) => c.status === 'contradicted').length;
  return `근거 대조: 출처 문장으로 확인된 문장 ${sup}개 · 출처에서 확인되지 않은 문장 ${unv}개${con ? ` · 출처와 달라 지운 문장 ${con}개` : ''}${unv ? ' — 확인되지 않은 문장은 사실로 받아들이기 전에 원문을 확인하세요 (앱의 대조는 단어·수치 비교라 의미를 완전히 검증하지 못합니다).' : ''}`;
}

function polarityAfter(s: string, at: number): 'up' | 'down' | null {
  const w = s.slice(at, at + 14);
  const up = UP.test(w);
  const down = DOWN.test(w);
  return up && !down ? 'up' : down && !up ? 'down' : null;
}

/**
 * Check every answer sentence. `extraFacts` = other text the answer may legitimately take figures from
 * (the MARTIALDEX data / the learner's own records), so "내 리치 180cm" is not called a figure without a source.
 */
export function checkClaims(answer: string, sources: EvidenceSource[], extraFacts = ''): ClaimCheck[] {
  const srcSentences = sources.flatMap((s) => sentences(s.text).map((text) => ({ n: s.n, text, grams: bigrams(text) })));
  const allSourceText = sources.map((s) => s.text).join('\n');
  const checks: ClaimCheck[] = [];
  for (const sentence of sentences(answer)) {
    const body = sentence.replace(/\[\d{1,2}\]/g, '').trim();
    if (body.startsWith('🔎') || body.startsWith('※')) continue;
    const grams = bigrams(body);
    let best: { n: number; text: string; score: number } | null = null;
    const anchors = anchorTerms(body);
    for (const s of srcSentences) {
      let score = coverage(grams, s.grams);
      // a paraphrase keeps the distinctive terms ("혈액량", "심박수") but not the wording — measured live 2026-11-07:
      // "혈액량이 줄고 심박수가 높아질 수 있어" vs the source's "혈액량이 줄고 심박수가 비정상적으로 치솟는다" = 0.30 coverage
      if (score >= 0.15 && score < SUPPORT_MIN && anchors.filter((w) => s.text.includes(w)).length >= 2) score = SUPPORT_MIN;
      if (!best || score > best.score) best = { n: s.n, text: s.text, score };
    }
    const problems = new Set<ClaimProblem>();
    let contradictedBy: { n: number; text: string } | null = null;

    // figures: the source sentence carrying the same number decides direction and unit
    for (const num of numbers(body)) {
      const withNum = srcSentences.filter((s) => new RegExp(`(^|[^0-9.])${num.value.replace('.', '\\.')}(?![0-9])`).test(s.text));
      if (!withNum.length) {
        if (num.unit && !new RegExp(`(^|[^0-9.])${num.value.replace('.', '\\.')}(?![0-9])`).test(extraFacts)) problems.add('number_not_in_source');
        continue;
      }
      for (const s of withNum) {
        const srcNum = numbers(s.text).find((x) => x.value === num.value);
        if (!srcNum) continue;
        if (num.unit && srcNum.unit && num.unit !== srcNum.unit) {
          problems.add('unit_mismatch');
          contradictedBy = s;
        }
        const pa = polarity(body, num.at);
        const ps = polarity(s.text, srcNum.at);
        if (pa && ps && pa !== ps) {
          problems.add('direction_flip');
          contradictedBy = s;
        }
        if (CONDITION.test(s.text.slice(Math.max(0, srcNum.at - 20), srcNum.at + 20)) && !CONDITION.test(body)) problems.add('condition_dropped');
        if (!best || best.score < SUPPORT_MIN) best = { n: s.n, text: s.text, score: SUPPORT_MIN };
      }
    }

    // term-anchored direction: a key term both sentences share ("혈액량"), followed by opposite movement words
    if (!contradictedBy) {
      for (const s of srcSentences) {
        if (coverage(grams, s.grams) < 0.25) continue;
        const flip = termFlip(body, s.text);
        if (flip) {
          problems.add('direction_flip');
          contradictedBy = s;
          break;
        }
        if (coverage(grams, s.grams) >= 0.3 && (negationFlip(body, s.text) || (coverage(grams, s.grams) >= 0.5 && finalNegation(body) !== finalNegation(s.text)))) {
          problems.add('negation_mismatch');
          contradictedBy = s;
          break;
        }
      }
    }

    const matched = best && best.score >= SUPPORT_MIN ? best : null;
    if (matched && !contradictedBy) {
      const pa = polarity(body);
      const ps = polarity(matched.text);
      if (pa && ps && pa !== ps && !numbers(body).length) {
        problems.add('direction_flip');
        contradictedBy = matched;
      }
      if (CAUSE.test(body) && !CAUSE_SRC.test(matched.text)) problems.add('causal_added');
    }
    if (CERTAIN.test(body) && !CERTAIN.test(allSourceText)) problems.add('overclaim');
    if (EVERYONE.test(body) && matched && ATHLETE.test(matched.text) && !EVERYONE.test(matched.text)) problems.add('scope_generalized');

    const isOpinion = OPINION.test(body);
    const status: ClaimCheck['status'] = [...problems].some((p) => CONTRADICTION.includes(p)) ? 'contradicted' : matched ? 'supported' : isOpinion ? 'opinion' : 'unverified';
    const ref = contradictedBy ?? matched;
    checks.push({ sentence, status, source: ref ? ref.n : null, ...(ref ? { quote: ref.text.slice(0, 220) } : {}), problems: [...problems] });
  }
  return checks;
}

/** Removes contradicted sentences from the answer; returns the cleaned text and what was removed. */
export function dropContradicted(answer: string, checks: ClaimCheck[]): { text: string; removed: ClaimCheck[] } {
  const removed = checks.filter((c) => c.status === 'contradicted');
  let text = answer;
  for (const c of removed) text = text.replace(c.sentence, '');
  return { text: text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), removed };
}
