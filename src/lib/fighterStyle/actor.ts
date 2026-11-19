// Who does the technique in an analysis sentence — the fighter being analysed, the
// opponent, a commentator/coach — or is it a general explanation, a hypothetical, a
// video caption? A technique name in a sentence is NOT evidence that the fighter uses it.
//
// Measured problem (2차): "…causing him to slip into the strike" put Slip into the
// fighter's style; the pronoun pointed at the opponent named in the sentence before.
// Rules (deterministic, no model):
//   - the clause holding the technique is found (split at , ; and/but/while/as/when/after …)
//   - its subject: the fighter's name, an opponent cue ("his opponent", another person's
//     name, "they"), a pronoun resolved to the person named last (this or the previous
//     sentence), a generic subject ("fighters", "you", "the jab is …")
//   - receiving verbs flip it ("ate a jab", "was dropped by a hook", "caught with a left")
//   - a possessive names the owner ("Aldo's jab", "his opponent's hook")
//   - modal / conditional wording is a hypothetical ("should", "could", "if he …")
//   - a video's title / description is a caption, not an analysis

export type Actor = 'fighter' | 'opponent' | 'commentator' | 'general' | 'unknown';

export type EvidenceKind =
  /** The fighter did it — a reported action ("landed", "threw", "knocked … out with"). */
  | 'direct'
  /** An analysis describes it as the fighter's ("his jab is his best weapon", "likes to …"). */
  | 'analysis'
  /** The opponent's technique — never the fighter's style. */
  | 'opponent'
  /** A general explanation of the technique, about nobody in particular. */
  | 'general'
  /** Advice / what could happen ("should use the jab", "if he throws …"). */
  | 'hypothetical'
  /** A video title / description. */
  | 'caption'
  /** The subject could not be told. */
  | 'unclear';

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  direct: '실제 사용 서술',
  analysis: '분석 자료의 설명',
  opponent: '상대가 사용',
  general: '일반 기술 설명',
  hypothetical: '가정·조언',
  caption: '영상 제목·설명',
  unclear: '주체 불명확',
};

/** Counts as evidence of the FIGHTER's style. */
export const FIGHTER_EVIDENCE: EvidenceKind[] = ['direct', 'analysis'];

export interface Attribution {
  actor: Actor;
  evidence: EvidenceKind;
  reason: string;
}

const CLAUSE_SPLIT = /[,;:()—–]|\b(?:and|but|while|whereas|as|when|after|before|because|which|who|until|then|only for)\b/gi;
const OPPONENT_WORD = /\b(?:(?:his|her|the|an?)\s+)?(?:opponents?|foes?|rivals?|challengers?|counterparts?|adversar(?:y|ies)|the other (?:man|fighter))\b/i;
const PRONOUN = /\b(he|she|him|her|his)\b/i;
/** One specific opponent ("his opponent"), not opponents in general ("keeps opponents guessing"). */
const ONE_OPPONENT = /\b(?:his|her|the)\s+(?:opponent|foe|rival|challenger)\b(?!s)/i;
/** Reacting to a technique = the OTHER person threw it: "Diaz was over-reacting to the low kick". */
const REACTING = /\b(?:over-?react(?:s|ed|ing)?|react(?:s|ed|ing)?|respect(?:s|ed|ing)?|wary of|afraid of|fear(?:s|ed|ing)?|check(?:s|ed|ing)?|read(?:s|ing)?|eat(?:s|ing)?|absorb(?:s|ed|ing)?)\s+(?:to\s+)?(?:the|a|an|his|that)?\s*(?:[a-z-]+\s+)?$/i;
const GENERIC_SUBJECT = /^\s*(?:the\s+)?(?:fighters?|boxers?|strikers?|wrestlers?|grapplers?|you|one|a fighter|a boxer|most fighters|many fighters|beginners?|practitioners?|athletes?)\b|^\s*(?:the|a|an)\s+[a-z-]+\s+(?:is|are|can be|will|works|means)\b/i;
const COMMENTATOR = /\b(commentator|analyst|coach|trainer|cornerman|corner|announcer|rogan|cormier|(?:he|she) said|says|said|according to)\b/i;
const RECEIVING = /\b(ate|eats|eating|absorb(?:s|ed|ing)?|took|takes|taking|was (?:hit|caught|dropped|rocked|stunned|floored|hurt|tagged|clipped)|got (?:hit|caught|dropped|rocked|tagged|clipped)|(?:hit|caught|dropped|rocked|tagged|stunned) (?:by|with)|on the receiving end|walked (?:into|onto)|ran into|defend(?:ed|s|ing)? (?:against|the)|blocked|slipped (?:past|under) (?:a|the|his))\b/i;
const MODAL = /\b(should|could|might|may|must|needs? to|has to|have to|ought to|if (?:he|she|they)|in case|try to|tries to|would be wise|would have)\b/i;
const ACTION_PAST = /\b(landed|lands|threw|throws|throwing|fired|fires|uncork(?:ed|s)|connected|connects|dropped|drops|knock(?:ed|s) (?:\w+ )?(?:out|down)|finish(?:ed|es)|sent|starched|floored|hurt|rocked|scored|scores|caught (?:\w+ )?with|tagged|cracked|beat|stopped)\b/i;
const HABITUAL = /\b(likes? to|loves? to|favou?rite|signature|go-to|bread and butter|weapon|staple|relies on|known for|tends? to|often|frequently|regularly|constantly|repeatedly|always|habit|specialt(?:y|ies)|best (?:weapon|punch|shot)|primary|main|uses? (?:a|the|his)|throws? (?:a|the|his)|employs?)\b/i;

/** People other than the fighter named in a stretch of text: the page's known opponents, else capitalised names not on the stoplist. */
function otherPersonNames(text: string, who: RegExp | null, opponents?: RegExp | null): string[] {
  const out: string[] = [];
  if (opponents) {
    const g = new RegExp(opponents.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) out.push(m[1]);
    return out;
  }
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (who?.test(name)) continue;
    if (NOT_PEOPLE.test(name.split(/\s+/)[0])) continue;
    out.push(name);
  }
  return out;
}

/** The clause around position `at`, and the text before the technique inside it. */
function clauseAround(sentence: string, at: number): { clause: string; before: string } {
  let start = 0;
  let end = sentence.length;
  CLAUSE_SPLIT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_SPLIT.exec(sentence))) {
    if (m.index < at) start = m.index + m[0].length;
    else {
      end = m.index;
      break;
    }
  }
  return { clause: sentence.slice(start, end), before: sentence.slice(start, at) };
}

export interface AttributionContext {
  /** The fighter's name as pages write it (full / surname / first name). */
  who: RegExp | null;
  /** The person the previous sentence was about (for "he" at the start of this one). */
  lastPerson: 'fighter' | 'opponent' | null;
  /** The page is a video (title / description only). */
  caption?: boolean;
  /** People the page names as the fighter's opponents ("against Aldo", "beat Diaz") — see opponentsIn. */
  opponents?: RegExp | null;
  /** The whole sentence (set by attribute). */
  sentence?: string;
}

const NOT_PEOPLE = /^(The|A|An|In|On|At|His|Her|He|She|They|This|That|These|Those|When|While|After|Before|But|And|Also|However|Particularly|Against|With|From|UFC|MMA|ONE|PFL|Bellator|Irish|Irishman|American|Brazilian|Russian|Mexican|Dagestani|Karate|Taekwondo|Boxing|Muay|Thai|Jiu|Jitsu|Olympic|Octagon|Left|Right|Southpaw|Orthodox|Jab|Cross|Hook|Uppercut|Round|First|Second|Third|Fourth|Fifth|Las|Vegas|Dublin|Ireland|Championship|Fight|Night|Featherweight|Lightweight|Welterweight|Middleweight|Heavyweight|Notorious|FRC|Abu|Dhabi|Signature|Strikes|Style|Training|Workout|Fighting|Breakdown|Analysis|Background|Career|Strengths|Weaknesses|Conclusion|Summary|Key|Celtic|January|February|March|April|May|June|July|August|September|October|November|December)$/;

/**
 * People a page names besides the fighter: in fight context ("against Aldo", "beat Diaz",
 * "met Poirier", "the Diaz bout"), full names ("Nate Diaz"), and a capitalised sentence subject
 * that fights ("Poirier landed …"). Not every capitalised word: "Celtic Cross", "Brazilian Jiu-Jitsu".
 */
export function opponentsIn(rawText: string, who: RegExp | null): RegExp | null {
  const text = rawText.replace(/[’‘]/g, "'");
  const names = new Set<string>();
  const add = (n: string) => {
    const parts = n.split(/\s+/);
    if (parts.some((p) => NOT_PEOPLE.test(p) || who?.test(p))) return;
    for (const part of parts) if (part.length >= 3) names.add(part);
  };
  const ctx = /\b(?:against|vs\.?|versus|beat|beats|beating|fought|faces?|facing|faced|met|meets|defeated|knocked out|stopped|rematch with|bout with|fight with|lost to|took on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)|\b([A-Z][a-z]+)\s+(?:bout|fight|rematch|trilogy)\b/g;
  let m: RegExpExecArray | null;
  while ((m = ctx.exec(text))) add(m[1] ?? m[2]);
  // a full name that recurs on the page (a heading "Signature Strikes:" is not a person)
  const full = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b(?!\s*:)/g;
  const seen = new Map<string, number>();
  while ((m = full.exec(text))) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  for (const [n, c] of seen) if (c >= 2) add(n);
  const subject = /(?:^|[.!?]\s+)([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s+(?:landed|lands|attacked|attacks|threw|throws|pressed|pressured|walked|caught|dropped|hurt|rocked|countered|counters|kicked|kicks|punched|took|takes|scored|secured|shot|slammed|answered|responded)\b/g;
  while ((m = subject.exec(text))) add(m[1]);
  return names.size ? new RegExp(`\\b(${[...names].join('|')})\\b`) : null;
}

/** Who performs the technique mentioned at `at` in `sentence`. */
export function attribute(rawSentence: string, at: number, ctx: AttributionContext): Attribution {
  // curly apostrophes (’) as plain ones — "McGregor’s", "opponent’s" (same length, positions unchanged)
  const sentence = rawSentence.replace(/[’‘]/g, "'");
  if (ctx.caption) return { actor: 'unknown', evidence: 'caption', reason: '영상 제목·설명 문장' };
  const { clause, before } = clauseAround(sentence, at);
  const near = before.slice(-60);
  // "Diaz was over-reacting to the low kick": the kick is the OTHER person's
  if (REACTING.test(near)) {
    const subj = subjectOf(before, sentence.slice(0, Math.max(0, at - before.length)), ctx);
    if (subj.actor === 'opponent') return mark('fighter', clause, sentence, `${subj.reason} — 상대가 반응한 기술(선수의 기술)`);
    if (subj.actor === 'fighter') return { actor: 'opponent', evidence: 'opponent', reason: `${subj.reason} — 선수가 반응한(받은) 기술` };
  }
  // possessive owner right before the name: "Aldo's jab", "his opponent's hook", "McGregor's left"
  const poss = /([A-Z][a-z]+|opponent|foe|rival|challenger)'s\s+(?:\w+\s+){0,2}$/i.exec(near);
  if (poss) {
    if (ctx.who?.test(poss[1])) return mark('fighter', clause, sentence, '선수 이름의 소유격');
    return { actor: 'opponent', evidence: 'opponent', reason: `${poss[1]}의 기술(소유격)` };
  }
  if (/\b(?:his|her|the) (?:opponent|foe|rival)'?s?\b[^.]*$/i.test(near) && !ctx.who?.test(near)) return { actor: 'opponent', evidence: 'opponent', reason: '상대를 가리키는 말 바로 뒤' };
  // "an advantage against orthodox fighters", "defends well against the jab": what the other side does
  if (/\bagainst\s+(?:an?\s+|the\s+|his\s+|their\s+)?(?:[a-z-]+\s+)?$/i.test(near)) return { actor: 'opponent', evidence: 'opponent', reason: '"against …" — 상대 쪽 기술·스탠스' };
  const sentenceStartGeneric = GENERIC_SUBJECT.test(clause) || (GENERIC_SUBJECT.test(sentence) && !ctx.who?.test(sentence) && !PRONOUN.test(sentence));
  if (sentenceStartGeneric && !ctx.who?.test(clause)) return { actor: 'general', evidence: 'general', reason: '특정 선수가 아닌 일반 설명' };

  // "forced Aldo to slip", "causing him to slip into …": the person made to do it is the one doing it
  const causative = /\b(?:forc\w*|caus\w*|mak\w*|made|bait\w*|draw\w*|drew|lur\w*|invit\w*|tempt\w*|get\w*|got|leav\w*|left)\s+([A-Za-z']+(?:\s+[A-Z][a-z]+)?)\s+(?:to|into)\s+(?:\w+\s+){0,2}$/i.exec(before.replace(/\b(?:his|her|the|their)\s+(opponent|foe|rival)'?s?\b/gi, '$1'));
  const subject = subjectOf(before, sentence.slice(0, Math.max(0, at - before.length)), { ...ctx, sentence });
  let actor: Actor;
  let reason: string;
  if (causative) {
    const p = causative[1];
    const isFighter = !!ctx.who?.test(p);
    const isPronoun = /^(him|her|them)$/i.test(p);
    // an object pronoun after a causative verb is the OTHER person than the clause's subject
    actor = isFighter ? 'fighter' : isPronoun ? (subject.actor === 'opponent' ? 'fighter' : 'opponent') : 'opponent';
    reason = `"${causative[0].trim().split(/\s+/).slice(0, 3).join(' ')}…" — ${actor === 'fighter' ? '선수' : '상대'}가 하게 된 동작`;
    return actor === 'opponent' ? { actor, evidence: 'opponent', reason } : mark(actor, clause, sentence, reason);
  }
  actor = subject.actor;
  reason = subject.reason;
  if (COMMENTATOR.test(before) && /\b(said|says|according to)\b/i.test(sentence) && actor === 'unknown') return { actor: 'commentator', evidence: 'unclear', reason: '해설·코치의 말' };
  // "McGregor ate a jab": the fighter received it → the opponent's technique
  if (RECEIVING.test(before)) {
    if (actor === 'fighter') return { actor: 'opponent', evidence: 'opponent', reason: `${reason} — 맞거나 막은 기술(받는 쪽 동사)` };
    // "Aldo was dropped by a left hand from McGregor": the fighter's, when the sentence names him as the one it came from
    if (actor === 'opponent') return ctx.who && /\b(?:from|by)\b/i.test(clause) && ctx.who.test(clause) ? { actor: 'fighter', evidence: 'direct', reason: `${reason} — 상대가 맞은 기술(선수에게서)` } : { actor: 'unknown', evidence: 'unclear', reason: `${reason} — 상대가 맞은 기술, 누가 썼는지 불명확` };
  }
  if (actor === 'opponent') return { actor, evidence: 'opponent', reason };
  if (actor === 'unknown') return { actor, evidence: 'unclear', reason };
  return mark(actor, clause, sentence, reason);
}

/** The clause's subject: the FIRST person it refers to (a name, an opponent word, or a pronoun resolved backwards). */
function subjectOf(before: string, earlier: string, ctx: AttributionContext): { actor: Actor; reason: string } {
  const refs: { i: number; kind: 'fighter' | 'opponent' | 'pronoun' }[] = [];
  const all = (re: RegExp, kind: 'fighter' | 'opponent' | 'pronoun') => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(before))) refs.push({ i: m.index, kind });
  };
  if (ctx.who) all(ctx.who, 'fighter');
  all(OPPONENT_WORD, 'opponent');
  for (const n of otherPersonNames(before, ctx.who, ctx.opponents)) refs.push({ i: before.indexOf(n), kind: 'opponent' });
  all(/\b(?:he|she|his|her)\b/i, 'pronoun');
  refs.sort((a, b) => a.i - b.i);
  const first = refs[0];
  if (!first) {
    // no subject of its own ("… and set up the cross"): the clause continues the previous clause's subject
    if (earlier.trim()) {
      const prev = subjectOf(earlier, '', ctx);
      if (prev.actor !== 'unknown') return { actor: prev.actor, reason: `앞 절과 같은 주어 → ${prev.actor === 'fighter' ? '선수' : '상대'}` };
    }
    if (ctx.lastPerson) return { actor: ctx.lastPerson, reason: `앞 문장의 사람 → ${ctx.lastPerson === 'fighter' ? '선수' : '상대'}` };
    return { actor: 'unknown', reason: '주어를 확인하지 못함' };
  }
  if (first.kind === 'fighter') return { actor: 'fighter', reason: '절의 주어가 선수 이름' };
  if (first.kind === 'opponent') return { actor: 'opponent', reason: '절의 주어가 상대(상대 지칭 또는 다른 선수 이름)' };
  // "…, he can avoid Topuria's power shots": the fighter named as someone's object / possessive → "he" is the other man
  if (ctx.who && ctx.sentence && new RegExp(`${ctx.who.source}'s`, 'i').test(ctx.sentence) && !ctx.who.test(ctx.sentence.replace(new RegExp(`${ctx.who.source}'s`, 'gi'), ''))) return { actor: 'opponent', reason: '대명사 — 같은 문장에서 선수는 소유격으로만 나옴(다른 사람이 주어)' };
  const resolved = lastPersonIn(earlier, ctx.who, ctx.opponents) ?? ctx.lastPerson;
  if (!resolved) return { actor: 'unknown', reason: '대명사가 가리키는 사람 불명확' };
  return { actor: resolved, reason: `대명사 → ${resolved === 'fighter' ? '선수' : '상대'}(앞에서 마지막으로 언급된 사람)` };
}

function mark(actor: Actor, clause: string, sentence: string, reason: string): Attribution {
  if (MODAL.test(clause)) return { actor, evidence: 'hypothetical', reason: `${reason} — 가정·조언 표현` };
  if (ACTION_PAST.test(clause) && !HABITUAL.test(clause)) return { actor, evidence: 'direct', reason: `${reason} — 실제 동작 서술` };
  if (HABITUAL.test(sentence) || ACTION_PAST.test(clause)) return { actor, evidence: 'analysis', reason: `${reason} — 습관·특징 서술` };
  return { actor, evidence: 'analysis', reason };
}

function lastIndex(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let i = -1;
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) i = m.index;
  return i;
}

/** The person a stretch of text names last: the fighter or someone else. */
export function lastPersonIn(text: string, who: RegExp | null, opponents?: RegExp | null): 'fighter' | 'opponent' | null {
  const f = who ? lastIndex(text, who) : -1;
  const others = otherPersonNames(text, who, opponents).map((n) => text.lastIndexOf(n));
  const o = Math.max(lastIndex(text, ONE_OPPONENT), ...others, -1);
  if (f < 0 && o < 0) return null;
  return f >= o ? 'fighter' : 'opponent';
}

/**
 * Who "he" in the NEXT sentence most likely means: the previous sentence's MAIN subject
 * (a leading "When …, " / "To the head, " is skipped). "McGregor does an excellent job forcing
 * his opponent to circle into the kick." → McGregor, though "his opponent" is named last;
 * "Nate Diaz walked him down." → Diaz. A sentence whose subject is itself a pronoun keeps the
 * previous person; pages are about the fighter, so that defaults to him.
 */
export function personAfter(rawSentence: string, ctx: AttributionContext): 'fighter' | 'opponent' | null {
  const sentence = rawSentence.replace(/[’‘]/g, "'");
  const main = sentence.replace(/^\s*(?:when|while|after|before|if|as|although|though|once|because|since|even with|despite|during|to the|in the|on the|at the|against|with)\b[^,]{0,120},\s*/i, '');
  const refs: { i: number; kind: 'fighter' | 'opponent' | 'pronoun' }[] = [];
  const f = ctx.who ? main.search(ctx.who) : -1;
  if (f >= 0) refs.push({ i: f, kind: 'fighter' });
  for (const n of otherPersonNames(main, ctx.who, ctx.opponents)) refs.push({ i: main.indexOf(n), kind: 'opponent' });
  const one = main.search(ONE_OPPONENT);
  if (one >= 0) refs.push({ i: one, kind: 'opponent' });
  const pr = main.search(/\b(?:he|she)\b/i);
  if (pr >= 0) refs.push({ i: pr, kind: 'pronoun' });
  refs.sort((a, b) => a.i - b.i);
  const first = refs[0];
  if (!first || first.kind === 'pronoun') return ctx.lastPerson ?? 'fighter';
  return first.kind;
}
