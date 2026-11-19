import type { Technique } from '../../types';
import { politeData } from '../aiCoachDay/politeSpeech';
import type { ChoiceQuestion, LessonConcept } from './types';
import { genericKey } from '../coachKnowledge/evidence';
import { addsNothing, isMeaningless } from './lessonQuality';
import { contentTokens, firstSentence, josa, nounPhrase, OPTION_LETTERS, overlap, seededOrder, sentence, stripStepPrefix } from './text';

// Splits a technique into a few teachable concepts, using ONLY the
// technique's own MARTIALDEX data (posture overview / steps / key points /
// common mistakes / positions / principles). Nothing is invented: a
// technique without posture data simply gets fewer concepts.

const BODY_LABEL: Record<string, string> = {
  head: '머리',
  upperBody: '상체',
  arms: '팔',
  hips: '골반',
  legs: '다리',
  feet: '발',
  weightDistribution: '체중',
  distance: '거리',
};

export function lessonName(t: Technique): string {
  return t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name;
}

function isDrill(t: Technique): boolean {
  return !!t.exerciseType || /^(home-training|gym)/.test(t.martialArt);
}

function bestMatch(target: string, pool: string[], minHits = 1): string | null {
  const tt = contentTokens(target);
  let best: string | null = null;
  let bestScore = 0;
  for (const p of pool) {
    const s = overlap(tt, contentTokens(p));
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return bestScore >= minHits ? best : null;
}

function short(label: string, max = 22): string {
  const t = label.replace(/[.。]$/, '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function choiceOf(question: string, correct: string, wrong: string[], seed: string): ChoiceQuestion | null {
  const distractors = [...new Set(wrong.map((w) => w.trim()).filter((w) => w && w !== correct))].slice(0, 2);
  if (distractors.length === 0) return null;
  const options = seededOrder([correct, ...distractors], seed);
  return { question, options, answerIndex: options.indexOf(correct) };
}

/** Choice question as one line of text (also what TTS reads). */
export function choiceText(c: ChoiceQuestion): string {
  return `${c.question} ${c.options.map((o, i) => `${OPTION_LETTERS[i]}. ${short(o, 60)}`).join(' / ')}`;
}

export function cleanPosition(p: string): string {
  return p.replace(/\s*-{2,}\s*/g, ' · ').trim();
}

function purposeConcept(t: Technique, distractors: string[], generic: Set<string>): LessonConcept {
  const name = lessonName(t);
  const drill = isDrill(t);
  // posture.overview is hand-curated per technique; `purpose` / `description` in the
  // parsed data are sometimes a category paragraph shared by many techniques (or a
  // bare alias like "양손 베기") — those say nothing about THIS technique and are skipped.
  const own = (s: string | null | undefined) => {
    const f = firstSentence(s);
    return f && !generic.has(genericKey(s ?? '')) && !isMeaningless(f) && contentTokens(f).length >= 3 ? f : '';
  };
  const ownPurpose = own(t.purpose);
  const what = firstSentence(t.posture?.overview) || ownPurpose || own(t.description) || `${josa(name, '은/는')} ${t.category} 분류의 ${drill ? '동작' : '기술'}입니다.`;
  // "쿠미테 --- 판정 규칙과 타이밍": the data's heading separator is not something to say aloud
  const where = t.positions.filter((p) => !/자주 등장|노기/.test(p)).map(cleanPosition).slice(0, 2);
  const variants: string[] = [];
  if (where.length) variants.push(`쉽게 말하면, 주로 ${where.join(', ')} 같은 상황에서 쓰는 ${drill ? '동작' : '기술'}입니다.`);
  if (t.posture?.startingPosition) variants.push(`시작하는 모습으로 생각해 보겠습니다. ${politeData(sentence(t.posture.startingPosition))}`);
  if (ownPurpose && ownPurpose !== what) variants.push(`목적으로 보면, ${politeData(sentence(ownPurpose))}`);
  if (variants.length === 0) variants.push(`한 문장으로 다시 말씀드리면, ${what}`);
  const reference = [what, where.length ? `사용 상황: ${where.join(', ')}` : ''].filter(Boolean).join(' / ');
  return {
    id: 'purpose',
    label: drill ? '목적과 하는 때' : '기술의 원리와 사용 상황',
    importance: 'core',
    explain: politeData(sentence(what)),
    variants,
    reference,
    keywords: contentTokens(reference).slice(0, 12),
    questions: {
      confirm: '여기까지 이해되셨습니까?',
      explain: `${josa(name, '이/가')} 어떤 ${drill ? '동작' : '기술'}인지 본인의 말로 짧게 설명해 주시겠습니까?`,
      ...(where.length && !drill ? { scenario: `지금 ${where[0]} 상황이라고 생각해 보겠습니다. 오늘 배우는 ${josa(name, '을/를')} 왜 이 상황에서 쓸 수 있을까요?` } : {}),
    },
    choice: choiceOf(`${name}에 대한 설명으로 맞는 것은 무엇일까요?`, short(what, 70), distractors.map((d) => short(d, 70)), `${t.id}:purpose`),
  };
}

function keyPointConcept(t: Technique, kp: string, index: number): LessonConcept {
  const name = lessonName(t);
  const p = t.posture!;
  const mistakes = p.commonMistakes ?? [];
  const mistake = bestMatch(kp, mistakes);
  const step = bestMatch(kp, p.steps ?? []);
  const bodyEntries = Object.entries(p.bodyPosition ?? {}).filter(([, v]) => !!v) as [string, string][];
  const body = bestMatch(kp, bodyEntries.map(([, v]) => v));
  const bodyKey = body ? bodyEntries.find(([, v]) => v === body)?.[0] : undefined;

  const variants: string[] = [];
  if (step) variants.push(`동작 순서로 보면, ${politeData(sentence(stripStepPrefix(step)))}`);
  if (mistake) variants.push(`반대로, 흔한 실수인 "${mistake.replace(/[.。]$/, '')}"을(를) 막아 주는 것이 바로 이 포인트입니다.`);
  if (body && bodyKey) variants.push(`${BODY_LABEL[bodyKey] ?? '몸'}의 위치로 말씀드리면, ${politeData(sentence(body))}`);
  variants.push(`한 문장으로 정리하면, 핵심은 ${nounPhrase(kp)}입니다.`);

  const reference = mistake ? `${kp} (놓치면: ${mistake})` : kp;
  const lead = index === 0 ? '가장 먼저 기억할 핵심은' : '다음 핵심은';
  return {
    id: `kp-${index}`,
    label: short(kp),
    importance: index < 2 ? 'core' : 'support',
    explain: `${lead} ${nounPhrase(kp)}입니다.`,
    variants,
    reference,
    keywords: contentTokens(kp).slice(0, 8),
    questions: {
      confirm: '여기까지 이해되셨습니까?',
      explain: '방금 말씀드린 핵심 포인트가 무엇이었는지 본인의 말로 말씀해 주시겠습니까?',
      ...(mistake ? { why: `왜 ${josa(nounPhrase(kp), '이/가')} 중요할까요? 이것을 놓치면 어떻게 될지 생각해 보세요.` } : {}),
      ...(mistake ? { scenario: `연습하다가 "${mistake.replace(/[.。]$/, '')}" 상황이 생겼다면, 무엇을 고쳐야 할까요?` } : {}),
    },
    // Distractors are the technique's own documented mistakes — real, and really wrong.
    choice: choiceOf(`${name}에서 지금 배운 핵심 포인트로 맞는 것은 무엇일까요?`, kp, mistakes, `${t.id}:kp-${index}`),
  };
}

export interface ConceptOptions {
  maxKeyPoints?: number;
  distractors?: string[];
  /** Category paragraphs repeated across many records (coachKnowledge/lookup genericTexts) — never taught as this technique's purpose. */
  genericTexts?: Set<string>;
}

/**
 * Concepts for one technique, most important first.
 *  - purpose: what it is / when it is used
 *  - up to `maxKeyPoints` key points (each with its matched step / common mistake)
 *  - a principle when there is no posture data at all
 * `distractors` are short descriptions of OTHER real techniques (for an easy 선택형 question).
 */
export function buildConcepts(t: Technique, opts: ConceptOptions = {}): LessonConcept[] {
  return withoutRepeats(rawConcepts(t, opts));
}

/**
 * A re-explanation must say something the learner has not heard yet: variants that
 * repeat (or nearly repeat) the concept's explanation, an earlier variant or an
 * earlier concept are dropped. Fewer variants is fine — the engine moves on.
 */
function withoutRepeats(concepts: LessonConcept[]): LessonConcept[] {
  const said: string[] = [];
  return concepts.map((c) => {
    const variants: string[] = [];
    for (const v of c.variants) if (!addsNothing(v, [...said, c.explain, ...variants])) variants.push(v);
    said.push(c.explain, ...variants);
    return { ...c, variants };
  });
}

function rawConcepts(t: Technique, opts: ConceptOptions): LessonConcept[] {
  const out: LessonConcept[] = [purposeConcept(t, opts.distractors ?? [], opts.genericTexts ?? new Set())];
  const kps = t.posture?.keyPoints ?? [];
  const max = opts.maxKeyPoints ?? (isDrill(t) ? 1 : 2);
  kps.slice(0, max).forEach((kp, i) => out.push(keyPointConcept(t, kp, i)));
  if (kps.length === 0 && t.principles.length) {
    const pr = t.principles[0];
    out.push({
      id: 'principle-0',
      label: short(pr),
      importance: 'core',
      explain: `이 ${isDrill(t) ? '동작' : '기술'}의 원리는 ${nounPhrase(pr)}입니다.`,
      variants: [`다시 말해, ${politeData(sentence(pr))}`],
      reference: pr,
      keywords: contentTokens(pr).slice(0, 8),
      questions: { confirm: '여기까지 이해되셨습니까?', explain: '방금 말씀드린 원리를 본인의 말로 설명해 주시겠습니까?' },
      choice: null,
    });
  }
  return out;
}

/** All key points as one reference line (practice review / recap grading). */
export function keyPointsReference(t: Technique): string {
  const kps = t.posture?.keyPoints ?? [];
  if (kps.length) return kps.join(' / ');
  return [firstSentence(t.posture?.overview) || firstSentence(t.purpose), ...t.principles.slice(0, 2)].filter(Boolean).join(' / ');
}

export const _internal = { bestMatch, choiceOf };
