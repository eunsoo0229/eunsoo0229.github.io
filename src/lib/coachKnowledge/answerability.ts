import { josa, sentence } from '../coachLesson/text';
import { isMeaningless } from '../coachLesson/lessonQuality';
import { answerTokens } from '../coachLesson/answerMatch';
import { BODY_LABEL, FIELD_LABEL, type BodyPart, type EvidenceField, type EvidenceItem, type TechniqueEvidence } from './evidence';

// 답변 가능 여부 판정 — which pieces of information a question ASKS for, and
// whether the technique's data really holds each of them. A keyword hit is
// not enough: "발은 어떻게 해요?" needs evidence about the feet, so a
// technique with only an overview is NOT answerable for it. When a body part
// has no dedicated field, a data sentence (step / key point / starting
// position) that explicitly names that body part is accepted as a quote —
// still the technique's own text, never another technique's.

export interface InfoNeed {
  id: string;
  /** What the student asked about, in words ("발 위치"). */
  label: string;
  /** Any of these fields answers it. */
  fields: EvidenceField[];
  /** For body-part needs: words that let a step/key-point sentence count as a quote. */
  mention?: RegExp;
  /** "어떻게 해?": the answer also composes these fields when the data has them (overview, key points, mistakes). */
  compose?: EvidenceField[];
}

export interface CoveredNeed {
  need: InfoNeed;
  /** Evidence actually found (empty = missing). */
  evidence: EvidenceItem[];
  /** True when the evidence is a quoted sentence that mentions the body part, not a dedicated field. */
  viaMention: boolean;
}

export type AnswerStatus = 'answerable' | 'partial' | 'unanswerable';

export interface Answerability {
  status: AnswerStatus;
  needs: CoveredNeed[];
  /** Labels of what the data does not hold. */
  missing: string[];
  /** Labels of what it does hold for this question. */
  confirmed: string[];
}

const BODY_NEEDS: { part: BodyPart; ask: RegExp; mention: RegExp }[] = [
  { part: 'feet', ask: /발(?!차|사|전|표|음|견|생|휘)|발끝|발뒤꿈치|스탠스|feet|foot|stance/i, mention: /발(?!차|사|전|표|음|견|생|휘)|발끝|뒤꿈치|스탠스/ },
  { part: 'arms', ask: /팔(?!굽)|손(?!목\s*잡)|주먹|팔꿈치|가드|arm|hand|elbow/i, mention: /팔|손|주먹|팔꿈치|가드/ },
  { part: 'head', ask: /머리|턱|시선|눈|head|chin/i, mention: /머리|턱|시선/ },
  { part: 'upperBody', ask: /상체|어깨|몸통|등|가슴|shoulder|torso/i, mention: /상체|어깨|몸통|가슴/ },
  { part: 'hips', ask: /고관절|골반|엉덩이|허리|힙|hip/i, mention: /고관절|골반|엉덩이|허리|힙/ },
  { part: 'legs', ask: /다리|무릎|leg|knee/i, mention: /다리|무릎/ },
  { part: 'weightDistribution', ask: /체중|무게|중심|균형|밸런스|balance|weight/i, mention: /체중|무게|중심|균형/ },
  { part: 'distance', ask: /거리|간격|사거리|range|distance/i, mention: /거리|간격/ },
];

const TOPIC_NEEDS: { id: string; ask: RegExp; label: string; fields: EvidenceField[] }[] = [
  { id: 'start', ask: /시작\s*자세|준비\s*자세|처음\s*자세|어디서\s*시작/, label: FIELD_LABEL.startingPosition, fields: ['startingPosition'] },
  { id: 'steps', ask: /순서|단계|과정|how\s*to/i, label: FIELD_LABEL.steps, fields: ['steps'] },
  { id: 'keypoints', ask: /핵심|포인트|중요|요령|팁|비결|key\s*point|tip/i, label: FIELD_LABEL.keyPoints, fields: ['keyPoints'] },
  { id: 'mistakes', ask: /실수|주의|잘못|조심|흔한|흔히|틀리|틀려|틀린|많이\s*(하는|틀)|mistake|error/i, label: FIELD_LABEL.commonMistakes, fields: ['commonMistakes'] },
  { id: 'principle', ask: /원리|원칙|메커니즘|principle/i, label: FIELD_LABEL.principles, fields: ['principles'] },
  // "흔한 실수와 대응 방법": how to fix the recorded mistakes (paired with the key point that fixes each)
  { id: 'fix', ask: /(실수|잘못|틀).{0,15}(대응|고치|고쳐|교정|바로잡|해결)/, label: '실수 대응 방법', fields: ['commonMistakes'] },
  // purpose ≠ situation: "왜 써?" asks what it is FOR; "언제 써?" asks the situations the data lists.
  { id: 'purpose', ask: /목적|용도|왜\s*(써|쓰|사용|배워|하는\s*거)|쓰는\s*이유|효과|why/i, label: FIELD_LABEL.purpose, fields: ['purpose', 'principles'] },
  { id: 'situation', ask: /언제|상황|어떤\s*때|어디서\s*(써|쓰|사용)|when/i, label: FIELD_LABEL.positions, fields: ['positions'] },
  { id: 'difficulty', ask: /난이도|어려워|어렵|쉬워|쉬운|초보|수준|레벨|difficult|level/i, label: FIELD_LABEL.difficulty, fields: ['difficulty'] },
  { id: 'related', ask: /관련|연결|이어서|콤보|비슷한|related|combo/i, label: FIELD_LABEL.related, fields: ['related'] },
  { id: 'what', ask: /뭐야|뭔가요|무엇|어떤\s*기술|특징|설명해|설명\s*좀|개요|정의|알려\s*줘|알려줘|what\s*is/i, label: '기술 설명', fields: ['overview', 'description', 'purpose'] },
];

/** Usage questions that stay usage questions even when a body part is named ("언제 써요", "어떤 상황"). */
const PURPOSE_STRICT = /언제|상황|목적|용도|when/i;
// how to do it: "어떻게" + any verb ("쳐", "차", "걸어", "들어가"), "<verb>는 법·방법" ("치는 법", "차는 법", "거는 법") —
// not "어떻게 돼/생각해/불러" (those ask something else)
const HOW = /(어떻게|어케|어캐|어떡|어떻케)(?!\s*(돼|되|생각|불러|부르|생겼|달라|다르))|[가-힣]는\s*(법|방법)|방법|how\s*to|how\b/i;
/** Words of a how-to question itself, and the first syllables of technique ACTION verbs (치다·차다·걸다·잡다 …). */
const HOW_WORDS = new Set(['어떻게', '어떻', '어케', '어캐', '어떡', '방법', '하는', '요령', '알려', '알려줘', '좀', '설명', '해줘', '해요', '해야', '돼요']);
const ACTION_HEAD = /^(치|쳐|칠|차|찰|걸|거|해|하|넘|들|잡|쓰|써|빠|넣|던|감|밀|당|피|막|돌|꺾|조|졸|누|눌|찍|올|뻗|내|들어|붙|빼|딛|디|서|앉|구르|굴)/;

/** Words a question may contain without asking for anything specific. */
const FILLER = new Set(['이거', '이건', '이게', '그거', '그건', '저거', '기술', '이기술', '뭐야', '뭔가', '뭐지', '좀', '알려', '알려줘', '설명', '설명해', '해줘', '주세요', '어떻게', '정말', '그냥', '오늘', '지금', '배운', '방금', '말해', '말해줘', '궁금', '궁금해']);

/**
 * The information a question asks for. A question that names nothing specific asks "what is it" —
 * unless it says something we could not map (`ignore` = the technique names in it): then the need is
 * "unclear" and the answer says the data has nothing on it instead of answering another field.
 */
export function needsOf(question: string, opts: { ignore?: string[] } = {}): InfoNeed[] {
  const q = question.normalize('NFKC');
  const out: InfoNeed[] = [];
  for (const b of BODY_NEEDS) if (b.ask.test(q)) out.push({ id: `body.${b.part}`, label: BODY_LABEL[b.part], fields: [`body.${b.part}`], mention: b.mention });
  const bodyAsked = out.length > 0;
  for (const t of TOPIC_NEEDS) {
    if (!t.ask.test(q)) continue;
    // "고관절은 왜 들어요?" asks why THAT body part does it — the body-part evidence answers it, not the technique's usage.
    if ((t.id === 'purpose' || t.id === 'situation') && bodyAsked && !PURPOSE_STRICT.test(q)) continue;
    out.push({ id: t.id, label: t.label, fields: t.fields });
  }
  // "어떻게 해?" asks how to do it: the steps, framed by the overview, key points and mistakes the data has —
  // unless a body part was named ("발은 어떻게 해요?" asks about the feet only).
  // ("대응 방법" in "실수와 대응 방법" is the fix, not how to do the technique)
  if (!out.some((n) => n.id === 'steps' || n.id === 'fix' || n.id.startsWith('body.')) && HOW.test(q)) {
    // "어떻게 쳐/차/걸어" asks how to DO the technique; "숨은 어떻게 쉬어" asks about something else the data
    // may not have — then it is "unclear", not the how-to
    const ignore = (opts.ignore ?? []).flatMap((n) => answerTokens(n));
    const other = answerTokens(q).filter((w) => !FILLER.has(w) && !HOW_WORDS.has(w) && !ACTION_HEAD.test(w) && !ignore.some((i) => w.startsWith(i) || i.startsWith(w)));
    if (other.length && out.length === 0) {
      const words = q.split(/\s+/).filter((w) => other.some((r) => w.includes(r)));
      return [{ id: 'unclear', label: `"${(words.length ? words : other).slice(0, 4).join(' ')}"`, fields: [] }];
    }
    out.push({ id: 'howto', label: '수행 방법', fields: ['steps'], compose: ['overview', 'keyPoints', 'commonMistakes'] });
  }
  if (out.length === 0) {
    const ignore = (opts.ignore ?? []).flatMap((n) => answerTokens(n));
    const rest = answerTokens(q).filter((w) => !FILLER.has(w) && !ignore.some((i) => w.startsWith(i) || i.startsWith(w)));
    if (rest.length) {
      // shown as the student's own words ("숨은 어떻게 쉬어"), not the matcher's stems
      const words = q.split(/\s+/).filter((w) => rest.some((r) => w.includes(r)));
      return [{ id: 'unclear', label: `"${(words.length ? words : rest).slice(0, 4).join(' ')}"`, fields: [] }];
    }
    const what = TOPIC_NEEDS.find((t) => t.id === 'what')!;
    out.push({ id: what.id, label: what.label, fields: what.fields });
  }
  return out;
}

/** Sentences of the technique's own steps / key points / starting position that explicitly mention `re`. */
function mentionQuotes(ev: TechniqueEvidence, re: RegExp): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const f of ['startingPosition', 'steps', 'keyPoints'] as EvidenceField[]) {
    const item = ev.fields[f];
    if (!item) continue;
    const hits = item.values.filter((v) => re.test(v));
    if (hits.length) out.push({ ...item, values: hits });
  }
  return out;
}

export function judgeAnswerability(ev: TechniqueEvidence, needs: InfoNeed[]): Answerability {
  const covered: CoveredNeed[] = needs.map((need) => {
    const direct = need.fields.map((f) => ev.fields[f]).filter((x): x is EvidenceItem => !!x);
    if (direct.length) return { need, evidence: direct, viaMention: false };
    if (need.mention) {
      const quotes = mentionQuotes(ev, need.mention);
      if (quotes.length) return { need, evidence: quotes, viaMention: true };
    }
    return { need, evidence: [], viaMention: false };
  });
  const missing = covered.filter((c) => c.evidence.length === 0).map((c) => c.need.label);
  const confirmed = covered.filter((c) => c.evidence.length > 0).map((c) => c.need.label);
  const status: AnswerStatus = missing.length === 0 ? 'answerable' : confirmed.length ? 'partial' : 'unanswerable';
  return { status, needs: covered, missing, confirmed };
}

const ORDINAL = ['첫째', '둘째', '셋째'];
const COUNT: Record<number, string> = { 2: '두', 3: '세' };

/** Content words two sentences share (a key point and the mistake it prevents talk about the same thing). */
function shares(a: string, b: string): boolean {
  const ta = answerTokens(a);
  const tb = answerTokens(b);
  return ta.some((x) => tb.some((y) => x === y || (x.length >= 2 && y.length >= 2 && (x.startsWith(y) || y.startsWith(x)))));
}

/**
 * Thin data (one key point / one mistake): the same technique's matching sentences, word for word —
 * the mistake a key point prevents, the key point that fixes a mistake, the step where it happens.
 */
function pairedNotes(ev: TechniqueEvidence, a: Answerability): string {
  const asked = new Set(a.needs.filter((c) => c.evidence.length).map((c) => c.need.id));
  const kps = ev.fields.keyPoints?.values ?? [];
  const mistakes = ev.fields.commonMistakes?.values ?? [];
  const steps = ev.fields.steps?.values ?? [];
  const notes: string[] = [];
  if (asked.has('keypoints') && !asked.has('mistakes') && kps.length <= 2) {
    const m = mistakes.find((x) => kps.some((k) => shares(k, x)));
    if (m) notes.push(`이 포인트를 놓쳤을 때의 흔한 실수(자료): ${sentence(m)}`);
    const st = steps.find((x) => kps.some((k) => shares(k, x)));
    if (st) notes.push(`동작 단계에서는: ${sentence(st)}`);
  }
  if (asked.has('mistakes') && !asked.has('keypoints') && mistakes.length <= 2) {
    const k = kps.find((x) => mistakes.some((m) => shares(m, x)));
    if (k) notes.push(`바로잡는 핵심 포인트(자료): ${sentence(k)}`);
  }
  return notes.join(' ');
}

/**
 * "어떻게 해?" — the steps, framed by what else the data has (each part the data's own text, in order:
 * overview → steps → key points → common mistakes). Parts the data lacks are simply not there.
 */
function howToText(ev: TechniqueEvidence, c: CoveredNeed): string {
  const out: string[] = [];
  const overview = ev.fields.overview?.values[0] ?? null;
  out.push(overview ? `MARTIALDEX 자료에 따르면 ${sentence(overview)} ${ev.displayName}의 수행 방법을 자료 순서대로 보겠습니다.` : `MARTIALDEX 자료에 따르면 ${ev.displayName}의 수행 방법은 다음과 같습니다.`);
  const steps = c.evidence.flatMap((e) => e.values).slice(0, 6);
  out.push(steps.length > 1 ? `동작 단계는 ${steps.length}단계입니다. ${steps.map(sentence).join(' ')}` : `동작 단계는 이렇습니다. ${sentence(steps[0])}`);
  const kp = ev.fields.keyPoints?.values.slice(0, 3) ?? [];
  if (kp.length === 1) out.push(`하면서 챙길 핵심 포인트는 "${kp[0].replace(/[.。]$/, '')}"입니다.`);
  else if (kp.length) out.push(`하면서 챙길 핵심 포인트는 ${COUNT[kp.length]} 가지입니다. ${kp.map((k, i) => `${ORDINAL[i]}, ${sentence(k)}`).join(' ')}`);
  const mistakes = ev.fields.commonMistakes?.values.slice(0, 2) ?? [];
  if (mistakes.length) out.push(`자료에 기록된 흔한 실수도 함께 점검해 보세요. ${mistakes.map(sentence).join(' ')}`);
  return out.join(' ');
}

/** Polite list: "A, B와 C" style without guessing particles — uses " · ". */
const list = (xs: string[]) => xs.join(' · ');

/**
 * The deterministic answer: the data's own text for what is confirmed, and a
 * plain statement of what MARTIALDEX does not have. Never adds anything else.
 */
export function evidenceAnswerText(ev: TechniqueEvidence, a: Answerability): string {
  if (a.status === 'unanswerable') {
    const have = ev.present.filter((f) => f !== 'related').slice(0, 4).map((f) => FIELD_LABEL[f]);
    return [
      a.needs.some((n) => n.need.id === 'unclear')
        ? `질문의 ${list(a.missing)}에 해당하는 내용을 MARTIALDEX의 ${ev.displayName} 자료에서 찾지 못했습니다. 확인되지 않은 내용을 추측해서 말씀드리지 않겠습니다.`
        : `MARTIALDEX 기술 자료에는 ${ev.displayName}의 ${list(a.missing)}에 대한 내용이 없습니다. 확인되지 않은 내용을 추측해서 말씀드리지 않겠습니다.`,
      have.length ? `자료에 있는 것은 ${list(have)}입니다. 그중에서 궁금한 것을 물어봐 주세요.` : '이 기술은 아직 자료가 거의 없습니다. 영상이나 직접 지도해 주는 코치에게 확인해 주세요.',
    ].join(' ');
  }
  // Several things asked at once ("원리, 주요 포인트, 흔한 실수와 대응 방법"): one section per
  // thing, each data sentence used once (the how-to used to repeat the overview, key points
  // and mistakes that had just been listed).
  if (a.needs.filter((c) => c.evidence.length).length >= 2) return sectionedAnswer(ev, a);
  // Spoken-style framing around the data's OWN sentences (each kept word for word):
  // "MARTIALDEX 자료에 따르면 잽(Jab)의 핵심 포인트는 세 가지입니다. 첫째, …. 둘째, …."
  const parts: string[] = [];
  for (const c of a.needs) {
    if (!c.evidence.length) continue;
    if (c.need.id === 'howto') {
      parts.push(howToText(ev, c));
      continue;
    }
    const texts = c.evidence.flatMap((e) => e.values).slice(0, 3);
    const topic = `${ev.displayName}의 ${c.need.label}${c.viaMention ? '(동작 설명 중 언급된 부분)' : ''}`;
    // Steps already carry their order ("1단계 — …"); other lists are numbered in words.
    const numbered = texts.length > 1 && !texts.every((t) => /^\s*\d+\s*단계/.test(t));
    const items = numbered ? texts.map((t, i) => `${ORDINAL[i]}, ${sentence(t)}`) : texts.map(sentence);
    const lead = texts.length > 1 ? `${josa(topic, '은/는')} ${COUNT[texts.length]} 가지입니다.` : `${josa(topic, '은/는')} 이렇습니다.`;
    parts.push(`${lead} ${items.join(' ')}`);
  }
  const extra = pairedNotes(ev, a);
  // a how-to answer introduces itself; other answers start from "according to the data"
  const onlyHowTo = a.needs.filter((c) => c.evidence.length).every((c) => c.need.id === 'howto');
  const body = `${onlyHowTo ? '' : 'MARTIALDEX 자료에 따르면 '}${parts.join(' 그리고 ')}${extra ? ` ${extra}` : ''}`;
  if (a.status === 'partial') return `${body} 다만 ${list(a.missing)}은(는) 자료에 없어 확인되지 않았습니다. 추측하지 않겠습니다.`;
  return body;
}

const SECTION_ORDER = ['what', 'principle', 'purpose', 'start', 'howto', 'steps', 'keypoints', 'mistakes', 'fix', 'situation', 'related', 'difficulty'];

/** The best single "what is it" sentence: the curated overview, else a description that says something. */
function bestWhat(ev: TechniqueEvidence): string | null {
  const pool = [...(ev.fields.overview?.values ?? []), ...(ev.fields.description?.values ?? []), ...(ev.fields.purpose?.values ?? [])];
  return pool.find((v) => answerTokens(v).length >= 4 && !isMeaningless(v)) ?? null;
}

function sectionedAnswer(ev: TechniqueEvidence, a: Answerability): string {
  const used = new Set<string>();
  const key = (v: string) => v.replace(/\s+/g, ' ').replace(/[.。]$/, '').trim();
  const fresh = (vals: string[]) => vals.filter((v) => !used.has(key(v)) && !!used.add(key(v)));
  const asked = new Set(a.needs.filter((c) => c.evidence.length).map((c) => c.need.id));
  const ordered = [...a.needs].filter((c) => c.evidence.length).sort((x, y) => (SECTION_ORDER.indexOf(x.need.id) + 1 || 99) - (SECTION_ORDER.indexOf(y.need.id) + 1 || 99));
  const out = [`MARTIALDEX 기술 자료로 정리한 ${ev.displayName}입니다.`];
  let shownKeyPoints: string[] = [];
  for (const c of ordered) {
    const id = c.need.id;
    if (id === 'mistakes' && asked.has('fix')) continue; // shown with their fixes below
    if (id === 'what') {
      const w = bestWhat(ev);
      if (w && fresh([w]).length) out.push(`■ 기술 설명\n${sentence(w)}`);
      continue;
    }
    if (id === 'principle') {
      const p = fresh(c.evidence.flatMap((e) => e.values)).slice(0, 1).map((v) => v.split(/(?<=[.。])\s+/).slice(0, 2).join(' '));
      if (p.length) out.push(`■ 원리\n${sentence(p[0])}`);
      continue;
    }
    if (id === 'howto' || id === 'steps') {
      const steps = fresh(ev.fields.steps?.values ?? []).slice(0, 6);
      if (steps.length) out.push(`■ 수행 방법 (동작 단계)\n${steps.map((x) => `- ${sentence(x)}`).join('\n')}`);
      continue;
    }
    if (id === 'fix') {
      const kps = ev.fields.keyPoints?.values ?? [];
      // the key points were just listed (numbered) — point at them instead of repeating the sentence
      const listed = shownKeyPoints;
      const lines = fresh(ev.fields.commonMistakes?.values ?? []).slice(0, 3).map((m) => {
        const k = kps.find((x) => shares(m, x));
        if (!k) return `- 실수: ${sentence(m)}\n  → 바로잡는 방법은 자료에 없습니다.`;
        const at = listed.indexOf(k);
        return at >= 0 ? `- 실수: ${sentence(m)}\n  → 바로잡기: 위 핵심 포인트 ${at + 1}번` : `- 실수: ${sentence(m)}\n  → 바로잡기: ${sentence(k)}`;
      });
      if (lines.length) out.push(`■ 흔한 실수와 대응\n${lines.join('\n')}\n(대응은 자료에 따로 있는 항목이 아니라, 같은 기술의 핵심 포인트 중 그 실수와 같은 동작을 다루는 문장을 짝지은 것입니다.)`);
      continue;
    }
    const vals = fresh(c.evidence.flatMap((e) => e.values)).slice(0, 3);
    if (id === 'keypoints' && !c.viaMention) {
      shownKeyPoints = vals;
      if (vals.length) out.push(`■ ${c.need.label}\n${vals.map((x, n) => `${n + 1}. ${sentence(x)}`).join('\n')}`);
      continue;
    }
    if (vals.length) out.push(`■ ${c.need.label}${c.viaMention ? '(동작 설명 중 언급된 부분)' : ''}\n${vals.map((x) => `- ${sentence(x)}`).join('\n')}`);
  }
  if (a.missing.length) out.push(`자료에 없는 항목: ${list(a.missing)} — 확인되지 않은 내용이라 추측해서 말씀드리지 않습니다.`);
  return out.join('\n\n');
}
