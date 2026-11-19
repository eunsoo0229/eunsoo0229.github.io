import type { Technique } from '../../types';
import { getUnifiedAllTechniques } from '../userTechniques/service';
import { josa, sentence } from '../coachLesson/text';
import { answerFromEvidence, type GroundedAnswer } from './answer';
import { FIELD_LABEL, type EvidenceField, type TechniqueEvidence } from './evidence';
import { evidenceFor, exactTechniquesInText, namesOf, similarlySpelled } from './lookup';
import { counteredBy, derivedRelations, ledFrom } from './relations';
import { artIn, practiceAnswer } from './featureCatalog';
import { canonicalTechniqueId, isTechniqueInArt } from '../techniqueCanonical';
import { getMartialArt } from '../loadData';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { answerTokens } from '../coachLesson/answerMatch';
import { learnedInfo, readLearnerState, type LearnerState } from './learnerState';
import { listTrainingHistory } from '../trainingHistory/service';
import type { TrainingHistoryEntry } from '../trainingHistory/types';
import { domainOf, mittKind, pickNext } from './coachPlan';
import { taxonomyListAnswer } from './taxonomyAnswer';
import { techniqueAddAnswer } from '../categoryRegistry/coach';

// 자체 AI 코치의 기술 질문 라우터 — which technique(s) a question is about and
// what KIND of question it is, then a deterministic answer from each
// technique's own data (answerability.ts for single-technique questions):
//   - names several techniques ambiguously → the student picks (no guess)
//   - "A와 B는 어떻게 달라?"            → each technique's own fields, side by side
//   - "클로즈드 가드에서 쓸 수 있는 기술?" → techniques whose data lists that position
//   - "이거 연습할 때 어떤 기능 써?"     → MARTIALDEX features that can practise it (featureCatalog.ts)
//   - otherwise                         → the single technique's evidence answer
// Nothing here calls a language model; facts are only the data's own text.

/**
 * What the conversation is about so far — used ONLY to decide which technique a short follow-up
 * ("발은?", "흔한 실수는?", "그거 연습하고 싶어") refers to, never as a source of facts.
 */
export interface CoachDialogContext {
  /** The technique the last answer was about. */
  focusId: string | null;
  /** Techniques the coach just listed / recommended (a "그거" may mean one of them). */
  listedIds: string[];
  /** The training the coach last opened in this session (mitt mode, timer …). */
  lastAction?: { featureId: string; title: string; route: string; techniqueId: string | null; at: string } | null;
  /** What "왜?" refers to: the reason of the last answer / recommendation, from the data or records. */
  lastWhy?: string | null;
}
export const EMPTY_DIALOG: CoachDialogContext = { focusId: null, listedIds: [], lastAction: null, lastWhy: null };

/** The dialog after the coach opened a training (remembered for "왜?" / "끝났어" / "다음 뭐 하지?"). */
export function dialogAfterAction(ctx: CoachDialogContext, action: { ok: true; featureId: string; title: string; route: string; techniqueId?: string | null; why?: string }): CoachDialogContext {
  return { ...ctx, focusId: action.techniqueId ?? ctx.focusId, listedIds: [], lastAction: { featureId: action.featureId, title: action.title, route: action.route, techniqueId: action.techniqueId ?? ctx.focusId ?? null, at: new Date().toISOString() }, lastWhy: action.why ?? null };
}

const DIALOG_KEY = 'martialdex:coach-dialog';
/** The entry box's dialog for this app session (survives opening the mitt and coming back; gone when the app closes). */
export function loadDialog(): CoachDialogContext {
  try {
    const raw = window.sessionStorage?.getItem(DIALOG_KEY);
    const d = raw ? (JSON.parse(raw) as CoachDialogContext) : null;
    return d && Array.isArray(d.listedIds) ? { ...EMPTY_DIALOG, ...d } : EMPTY_DIALOG;
  } catch {
    return EMPTY_DIALOG;
  }
}
export function saveDialog(d: CoachDialogContext): void {
  try {
    window.sessionStorage?.setItem(DIALOG_KEY, JSON.stringify(d));
  } catch {
    // private mode — the dialog just isn't kept
  }
}

const WHY_Q = /^(왜|왜요|왜\?|그건\s*왜|이유는|이유가\s*뭐|왜\s*그거|왜\s*그래)\s*[?？]?\s*$/;
const DONE_Q = /^(다\s*)?(끝났|끝냈|했어|했어요|다\s*했|마쳤|끝)/;

/** "끝났어" — what the app actually saved since the coach opened the training (never assumed). */
export function doneAnswer(ctx: CoachDialogContext): CoachQuestionAnswer {
  const a = ctx.lastAction;
  if (!a) return { kind: 'records', techniqueIds: [], text: '수고하셨습니다. 이번 대화에서 제가 연 훈련이 없어 어떤 훈련을 하셨는지는 확인하지 않았습니다.' };
  let entries: TrainingHistoryEntry[] = [];
  try {
    entries = listTrainingHistory().filter((e) => (e.completedAt ?? '') >= a.at && (!a.techniqueId || e.techniqueIds.map(canonicalTechniqueId).includes(canonicalTechniqueId(a.techniqueId)) || !!e.visualMitt));
  } catch {
    entries = [];
  }
  if (!entries.length) {
    return { kind: 'records', techniqueIds: a.techniqueId ? [a.techniqueId] : [], text: `수고하셨습니다. 다만 ${a.title} 이후 저장된 훈련 기록은 아직 확인되지 않습니다(화면에서 끝까지 하거나 종료를 누르면 기록됩니다). 그래서 완료 여부를 기록으로 말씀드리지는 않겠습니다. "다음 뭐 하지?"라고 하시면 다음 연습을 골라 드리겠습니다.` };
  }
  const e = entries[0];
  const m = e.visualMitt ? ` · Visualizing Mitt ${e.visualMitt.comboName} ${e.visualMitt.repetitions}회` : '';
  return { kind: 'records', techniqueIds: a.techniqueId ? [a.techniqueId] : [], text: `기록 확인: ${e.date} ${e.completed ? '완료' : '중간 종료'}${m}${e.actualMinutes ? ` · ${e.actualMinutes}분` : ''}. 수고하셨습니다. "다음 뭐 하지?"라고 하시면 다음 연습을 골라 드리겠습니다.` };
}

/** "왜?" — the reason behind the last thing the coach said or opened (data / records only). */
export function whyAnswer(ctx: CoachDialogContext, focus: Technique | null): CoachQuestionAnswer {
  if (ctx.lastWhy) return { kind: 'single', techniqueIds: focus ? [focus.id] : [], text: ctx.lastWhy };
  if (focus) {
    const ev = evidenceFor(focus);
    const why = ev.fields.purpose?.values[0] ?? ev.fields.overview?.values[0] ?? ev.fields.description?.values[0] ?? null;
    const kp = ev.fields.keyPoints?.values[0] ?? null;
    if (why || kp) return { kind: 'single', techniqueIds: [focus.id], text: `MARTIALDEX 자료에서 ${ev.displayName}에 대해: ${[why, kp ? `핵심 포인트는 "${kp}"` : null].filter(Boolean).map((x) => sentence(x!)).join(' ')}` };
  }
  return { kind: 'no_technique', techniqueIds: [], text: '무엇에 대한 이유인지 다시 말씀해 주세요. (예: "잽은 왜 연습해?")' };
}

export interface CoachQuestionAnswer {
  kind: 'single' | 'compare' | 'situation' | 'practice' | 'ambiguous' | 'no_technique' | 'counter' | 'trouble' | 'next' | 'review' | 'records';
  /** The conversation context after this answer. */
  context?: CoachDialogContext;
  text: string;
  /** Techniques the answer is about (ids). */
  techniqueIds: string[];
  /** Candidate techniques the student should pick from (ambiguous names). */
  candidates?: { techniqueId: string; name: string; martialArt: string }[];
  /** The single-technique evidence answer when kind === 'single'. */
  grounded?: GroundedAnswer;
  /** Internal: what a following "왜?" should answer. */
  whyNext?: string;
}

const COMPARE = /(차이|다른\s*점|다른점|달라|다르|비교|\bvs\b|뭐가\s*더)/i;
const SITUATION = /(상황|포지션|자세)에서.*(쓸|사용|할\s*수|하는|기술)|(에서|일\s*때)\s*(쓸|사용할|할)\s*수\s*있는\s*기술|어떤\s*기술.*(쓸|써|사용)/;
const PRACTICE = /(연습|훈련|드릴)(하|할|을|에|에는|은)?.*(기능|어떻게|뭘|무엇|어디서|방법|도구)|(어떤|무슨)\s*기능|(미트|패드)(로|에서|로도)?\s*.{0,8}(할\s*수|돼|되나|되냐|가능|있어|있나)/;

const nameOf = (ev: TechniqueEvidence) => ev.displayName;

const ASKS = /[?？]\s*$|[가-힣]는\s*(법|방법)|(어떻게|어케|뭐야|뭔가요|무엇|왜|언제|어디|차이|달라|다르|다른\s*점|있어|있나|돼|되나|나요|까요|알려\s*줘|알려줘|설명해)/;
const LESSON_REQUEST = /(배우고\s*싶|배울래|가르쳐\s*줘|수업|레슨)/;
/** A technique QUESTION (answered in place), not a lesson request ("잽 배우고 싶어") — 자체 코치 entry box. */
export function isTechniqueQuestion(text: string): boolean {
  const t = text.trim();
  return !!t && (ASKS.test(t) || /^(다\s*)?(끝났|끝냈|했어|다\s*했|마쳤)/.test(t)) && !LESSON_REQUEST.test(t);
}

function firstValues(ev: TechniqueEvidence, field: EvidenceField, n: number): string[] {
  return (ev.fields[field]?.values ?? []).slice(0, n);
}

/** Two techniques side by side — each fact is that technique's own data; what one lacks is said. */
export function compareTechniques(a: Technique, b: Technique): string {
  const ea = evidenceFor(a);
  const eb = evidenceFor(b);
  const na = nameOf(ea);
  const nb = nameOf(eb);
  const lines: string[] = [`MARTIALDEX 자료로 ${josa(na, '와/과')} ${josa(nb, '을/를')} 나란히 비교하겠습니다.`];
  // 공통점 — only what both records state
  const common: string[] = [];
  if (a.category === b.category) common.push(`같은 분류(${a.category})`);
  if (a.martialArt === b.martialArt) common.push(`같은 종목(${getMartialArt(a.martialArt)?.nameKo ?? a.martialArt})`);
  const pa = new Set(firstValues(ea, 'positions', 20));
  const shared = firstValues(eb, 'positions', 20).filter((p) => pa.has(p));
  if (shared.length) common.push(`둘 다 ${shared.slice(0, 2).join(', ')} 상황으로 표시됨`);
  lines.push(common.length ? `공통점: ${common.join(', ')}.` : '자료에서 확인되는 공통점은 없습니다.');
  if (a.category !== b.category) lines.push(`분류: ${josa(na, '은/는')} ${a.category}, ${josa(nb, '은/는')} ${b.category}입니다.`);
  // 차이 — the same fields, side by side
  const what = (ev: TechniqueEvidence) => firstValues(ev, 'overview', 1)[0] ?? firstValues(ev, 'description', 1)[0] ?? null;
  const wa = what(ea);
  const wb = what(eb);
  lines.push(`설명 — ${na}: ${wa ? sentence(wa) : '자료에 설명이 없습니다.'} ${nb}: ${wb ? sentence(wb) : '자료에 설명이 없습니다.'}`);
  const ka = firstValues(ea, 'keyPoints', 1)[0];
  const kb = firstValues(eb, 'keyPoints', 1)[0];
  if (ka || kb) lines.push(`핵심 포인트 — ${na}: ${ka ? sentence(ka) : '자료에 없음.'} ${nb}: ${kb ? sentence(kb) : '자료에 없음.'}`);
  const ua = firstValues(ea, 'positions', 2).filter((p) => !shared.includes(p));
  const ub = firstValues(eb, 'positions', 2).filter((p) => !shared.includes(p));
  if (ua.length || ub.length) lines.push(`사용 상황 — ${na}: ${ua.join(', ') || '공통 상황 외 없음'} / ${nb}: ${ub.join(', ') || '공통 상황 외 없음'}.`);
  lines.push('자료에 없는 차이(효과나 어느 쪽이 나은지)는 추측하지 않습니다.');
  return lines.join(' ');
}

let positionsCache: { count: number; byPosition: Map<string, Technique[]> } | null = null;
function positionIndex(): Map<string, Technique[]> {
  const all = getUnifiedAllTechniques();
  if (positionsCache && positionsCache.count === all.length) return positionsCache.byPosition;
  const byPosition = new Map<string, Technique[]>();
  for (const t of all) for (const p of t.positions ?? []) {
    const key = p.trim();
    if (!key) continue;
    byPosition.set(key, [...(byPosition.get(key) ?? []), t]);
  }
  positionsCache = { count: all.length, byPosition };
  return byPosition;
}

/** The data's position labels named in the question ("클로즈드 가드 (Closed Guard)" ← "클로즈드 가드"). */
function positionsIn(question: string): string[] {
  const q = question.toLowerCase().replace(/\s+/g, '');
  const hits: string[] = [];
  for (const label of positionIndex().keys()) {
    const forms = [label, ...(label.match(/\(([^)]+)\)/)?.[1] ? [label.match(/\(([^)]+)\)/)![1]] : []), label.replace(/\s*\([^)]*\)\s*/g, '')];
    if (forms.some((f) => f.replace(/\s+/g, '').length >= 3 && q.includes(f.toLowerCase().replace(/\s+/g, '')))) hits.push(label);
  }
  // the longest label wins when one contains another ("하프 가드" vs "가드")
  return hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));
}

export function situationAnswer(question: string, martialArt: string | null): CoachQuestionAnswer | null {
  const labels = positionsIn(question);
  if (!labels.length) return null;
  const label = labels[0];
  const inArt = (t: Technique) => !martialArt || t.martialArt === martialArt || (t.martialArts ?? []).includes(martialArt);
  const list = (positionIndex().get(label) ?? []).filter(inArt);
  if (!list.length) return { kind: 'situation', techniqueIds: [], text: `MARTIALDEX 자료에는 ${label} 상황으로 표시된 기술이 없습니다.` };
  const names = list.slice(0, 8).map((t) => evidenceFor(t).displayName); // Korean name from the record or its own data
  return {
    kind: 'situation',
    techniqueIds: list.slice(0, 8).map((t) => t.id),
    text: `MARTIALDEX 자료에서 ${label} 상황으로 표시된 기술은 ${list.length}개입니다${list.length > 8 ? ' (앞의 8개)' : ''}: ${names.join(', ')}. 궁금한 기술 이름을 말씀해 주시면 그 기술의 자료로 설명하겠습니다.`,
  };
}

// ---------------------------------------------------------------- opponent's attack ("상대가 계속 태클 걸면?")

const COUNTER_Q = /상대(가|방이|방)?\s*.{0,14}(하면|걸면|치면|차면|들어오면|오면|쓰면|시도하면|잡으면)|막(으려면|는\s*(법|방법))|방어(하려면|법|하는\s*법)|대처|대응|(들어와|들어오|맞아|맞는|맞으면|당하면|당해|걸렸|잡혔|깔렸)|카운터|탈출|빠져\s*나|벗어나|이스케이프|escape|counter/i;
/** Generic attack words → the words a technique's own text uses for it (text search terms, not facts). */
const ATTACK_TERMS: [RegExp, string[]][] = [
  // common strike / takedown names as students say them → the words technique texts use (search terms only, specific first)
  [/태클|테이크다운|takedown/i, ['태클', '테이크다운', 'takedown']],
  [/싱글\s*(렉|레그)?|single/i, ['싱글 레그', '싱글렉', '싱글', 'single leg', '테이크다운']],
  [/더블\s*(렉|레그)|double\s*leg/i, ['더블 레그', '더블렉', 'double leg', '테이크다운']],
  [/니\s*킥|무릎\s*차기|knee/i, ['니킥', '니 킥', '무릎 공격', 'knee']],
  [/하이\s*킥|high\s*kick/i, ['하이킥', '하이 킥', 'high kick']],
  [/미들\s*킥|바디\s*킥|body\s*kick/i, ['미들킥', '바디킥', '바디 킥', 'body kick']],
  [/로우\s*킥|카프\s*킥|low\s*kick|calf/i, ['로우킥', '로우 킥', '카프킥', 'low kick', 'calf kick']],
  [/프론트\s*킥|앞차기|티프|teep|front\s*kick/i, ['프론트킥', '프론트 킥', '앞차기', '티프', 'teep', 'front kick']],
  [/잽|jab/i, ['잽', 'jab']],
  [/크로스|스트레이트|cross/i, ['크로스', '스트레이트', 'cross']],
  [/오버\s*핸드|overhand/i, ['오버핸드', 'overhand']],
  [/어퍼|uppercut/i, ['어퍼컷', '어퍼', 'uppercut']],
  [/훅|hook/i, ['훅', 'hook']],
  [/엘보|팔꿈치\s*공격|elbow/i, ['엘보', '팔꿈치', 'elbow']],
  [/펀치|punch/i, ['펀치', 'punch']],
  [/클린치|clinch/i, ['클린치', 'clinch']],
  [/킥|kick/i, ['킥', 'kick']],
];
const namesOfTechnique = (t: Technique) => namesOf(t);
const ESCAPE_WORD = /탈출|이스케이프|escape|방어|디펜스|defen|리커버리|recovery|회복/i;
const DEFENSE_MARK = /막|방어|디펜스|카운터|피하|피해|대응|되받|흘려|탈출|빠져|벗어|이스케이프|block|defen|counter|evade|escape|sprawl|스프롤/i;

function sentencesOf(t: Technique): string[] {
  const p = t.posture;
  return [p?.overview, ...(p?.keyPoints ?? []), ...(p?.steps ?? []), t.description, t.purpose].filter((x): x is string => !!x && x.trim().length > 0).flatMap((x) => x.split(/(?<=[.!?。])\s+/));
}

/**
 * Does this sentence say the attack `term` gets stopped? The term must be the OBJECT of a stopping verb right
 * after it ("상대의 로우킥을 막는", "테이크다운 시도에 … 막는"); a feint "로우킥을 암시해 … 방어를 유도" and the
 * opponent defending ("상대가 하이킥 방어를 준비") are not.
 */
function stopsTerm(sentence: string, term: string): boolean {
  const lx = sentence.toLowerCase();
  const w = term.toLowerCase();
  let at = lx.indexOf(w);
  while (at >= 0) {
    const before = lx.slice(Math.max(0, at - 8), at);
    const after = lx.slice(at + w.length, at + w.length + 40);
    const opponents = /상대(의|가|방의|방이)?\s*$/.test(before) || /상대(의|가)\s*\S*\s*$/.test(before);
    const stopped = /^\s*(을|를|이나|나|에|에는|시도에|시도를|공격을|공격에)\s*[^.]{0,32}?(막(아|는|기|을|은|고|으)|방어(하|를\s*하|하는)|피(하|해|한|할|함)|벗어나|탈출|되받|흘려|흘리|쳐내|쳐냅|걷어|빗겨|비켜|패리|슬립|무력화|체크|블록|캐치)/.test(after);
    const feint = /암시|유도|보이게|처럼/.test(after);
    const opponentDefends = /^\s*(방어|디펜스)/.test(after) && /상대(가|방이)\s*$/.test(before.trim() + ' ');
    if (stopped && !feint && !opponentDefends && (opponents || /방어|디펜스|defen/i.test(after))) return true;
    at = lx.indexOf(w, at + w.length);
  }
  return false;
}

/** A technique's own statements first (its posture text), then its description — markdown stripped, category paragraphs (on 3+ techniques) skipped. */
let sharedSentences: Map<string, number> | null = null;
function ownSentences(t: Technique): string[] {
  if (!sharedSentences) {
    sharedSentences = new Map();
    for (const x of getUnifiedAllTechniques()) for (const y of new Set(sentencesOf(x).map((z) => z.trim()))) sharedSentences.set(y, (sharedSentences.get(y) ?? 0) + 1);
  }
  const p = t.posture;
  const own = [p?.overview, ...(p?.keyPoints ?? []), ...(p?.steps ?? []), ...(p?.commonMistakes ?? [])].filter((x): x is string => !!x).flatMap((x) => x.split(/(?<=[.!?。])\s+/));
  const rest = sentencesOf(t).filter((x) => !own.includes(x));
  return [...own, ...rest].filter((x) => (sharedSentences!.get(x.trim()) ?? 0) < 3).map((x) => x.replace(/\*\*[^*]*\*\*\s*/g, '').trim()).filter((x) => x.length > 4);
}

/** Four kinds of answer, never mixed: what the data states, what it links, what is merely related, what it can't tell. */
export function tieredText(what: string, direct: { t: Technique; quote: string }[], linked: { t: Technique; note: string }[], related: { t: Technique; why: string }[], unknown: string): string {
  const parts: string[] = [`MARTIALDEX 자료 기준으로 ${what} 대응을 정리하겠습니다.`];
  if (direct.length) parts.push(`① 자료에 직접 적힌 대응: ${direct.map((d) => `${nameOf(evidenceFor(d.t))} — "${d.quote.trim()}"`).join(' / ')}.`);
  if (linked.length) parts.push(`② 기술 관계로 연결된 기술: ${linked.map((l) => `${nameOf(evidenceFor(l.t))}(${l.note})`).join(', ')}.`);
  if (related.length) parts.push(`③ 같은 포지션·분류의 관련 기술 — 직접 막는 방법이라는 뜻은 아닙니다: ${related.map((r) => `${nameOf(evidenceFor(r.t))}(${r.why})`).join(', ')}.`);
  if (!direct.length && !linked.length) parts.push(`${josa(what, '을/를')} 직접 막거나 받아치는 기술은 자료에 기록되어 있지 않습니다.`);
  parts.push(`④ 자료로 확인되지 않는 것: ${unknown}`);
  return parts.join(' ');
}

export function counterAnswer(question: string, current: Technique | null, named: Technique[]): CoachQuestionAnswer | null {
  if (!COUNTER_Q.test(question)) return null;
  const attack = named.find((t) => t.id !== current?.id) ?? null;
  const terms = attack ? namesOfTechnique(attack).filter((n) => n.length >= 2) : ATTACK_TERMS.find(([re]) => re.test(question))?.[1] ?? null;
  if (!terms) return null;
  const art = artIn(question) ?? current?.martialArt ?? attack?.martialArt ?? null;
  const all = getUnifiedAllTechniques();
  const byId = (id: string) => all.find((y) => y.id === id || canonicalTechniqueId(y.id) === id);
  const isAttack = (t: Technique) => !!attack && canonicalTechniqueId(t.id) === canonicalTechniqueId(attack.id);
  // ① techniques whose OWN text states they stop that attack ("상대의 테이크다운 시도에 … 막는")
  const lowerTerms = terms.map((x) => x.toLowerCase());
  const direct: { t: Technique; quote: string }[] = [];
  for (const t of all) {
    if (isAttack(t)) continue;
    const quote = ownSentences(t).find((x) => lowerTerms.some((w) => stopsTerm(x, w)));
    if (quote) direct.push({ t, quote });
  }
  // ② relations: the technique graph's counters / escapes, and sentences of other techniques that name it as stopped
  const linked: { t: Technique; note: string }[] = [];
  if (attack) {
    try {
      const c = getTechniqueConnections(attack);
      for (const x of [...c.counter, ...c.escape]) {
        const t = byId(x.techniqueId);
        if (t && !direct.some((d) => d.t.id === t.id)) linked.push({ t, note: '기술 관계 자료' });
      }
    } catch {
      // no graph entry
    }
    for (const r of counteredBy(attack)) {
      const t = byId(r.sourceId);
      if (t && !direct.some((d) => d.t.id === t.id) && !linked.some((l) => l.t.id === t.id)) linked.push({ t, note: `근거: "${r.sentence.slice(0, 60)}"` });
    }
  }
  const rank = (t: Technique) => (art && isTechniqueInArt(t, art) ? 0 : 1);
  direct.sort((a, b) => rank(a.t) - rank(b.t));
  const what = attack ? nameOf(evidenceFor(attack)) : terms[0];
  // ③ only when ① and ② are thin: escapes / defenses of the positions the attack is used in
  let related: { t: Technique; why: string }[] = [];
  if (direct.length + linked.length < 2 && attack) {
    const positions = attack.positions.filter((p) => /\(/.test(p) && !/자주 등장|노기/.test(p));
    const words = positions.flatMap((p) => [p.replace(/\s*\([^)]*\)\s*/g, '').trim(), p.match(/\(([^)]+)\)/)?.[1] ?? '']).filter((w) => w.length >= 2).map((w) => w.toLowerCase());
    related = all
      .filter((t) => !isAttack(t) && isTechniqueInArt(t, attack.martialArt) && ESCAPE_WORD.test(`${t.name} ${t.koreanName ?? ''} ${t.category} ${t.positions.join(' ')}`))
      .filter((t) => t.positions.some((p) => positions.includes(p)) || words.some((w) => textOf(t).includes(w)))
      .filter((t) => !direct.some((d) => d.t.id === t.id) && !linked.some((l) => l.t.id === t.id))
      .slice(0, 4)
      .map((t) => ({ t, why: `${attack.positions.find((p) => t.positions.includes(p))?.replace(/\s*\([^)]*\)/, '') ?? '같은 포지션'}의 탈출·방어 기술` }));
  }
  const d = direct.slice(0, 3);
  const l = linked.slice(0, 3);
  if (!d.length && !l.length && !related.length) {
    return { kind: 'counter', techniqueIds: [], text: `MARTIALDEX 자료에서 ${josa(what, '을/를')} 막거나 받아치는 기술로 확인되는 것을 찾지 못했습니다. 확인되지 않은 대처법은 추측하지 않겠습니다.` };
  }
  return {
    kind: 'counter',
    techniqueIds: [...new Set([...d.map((x) => x.t.id), ...l.map((x) => x.t.id), ...related.map((x) => x.t.id)])],
    text: tieredText(what, d, l, related, '어떤 대응이 가장 효과적인지, 그리고 위에 없는 대처법. 각 기술의 자세한 방법은 기술 이름으로 물어봐 주세요.'),
  };
}

// ---------------------------------------------------------------- "왜 자꾸 균형이 무너지지?"

const TROUBLE_Q = /자꾸|계속\s*.{0,8}(안|무너|흔들|넘어|빠져|막혀|느려)|잘\s*안\s*(돼|되)|안\s*(돼|되)는데|무너져|흔들려|넘어져|힘이\s*안/;
const SYMPTOM_TERMS: [RegExp, string[]][] = [
  [/균형|중심|넘어|흔들|무너/, ['균형', '중심', '체중', '무게', '무너', '넘어']],
  [/힘|파워|약해/, ['힘', '파워', '압박', '약해', '체중']],
  [/빠져|탈출|도망/, ['빠져', '탈출', '공간']],
  [/느려|늦/, ['늦', '즉시', '빠르게', '회수']],
  [/맞|막혀|반격/, ['노출', '반격', '가드', '막']],
];
const TROUBLE_FILLER = new Set(['자꾸', '계속', '무너', '무너지', '무너져', '무너지지', '흔들', '흔들려', '넘어져', '안돼', '안되', '되는데', '돼요', '이거', '기술']);

export function troubleAnswer(question: string, t: Technique): CoachQuestionAnswer | null {
  if (!TROUBLE_Q.test(question)) return null;
  const terms = new Set<string>(SYMPTOM_TERMS.filter(([re]) => re.test(question)).flatMap(([, w]) => w));
  for (const w of answerTokens(question)) if (!TROUBLE_FILLER.has(w) && w.length >= 2) terms.add(w);
  const has = (x: string) => [...terms].some((w) => x.includes(w));
  const ev = evidenceFor(t);
  const groups: [string, string[]][] = [
    [FIELD_LABEL.commonMistakes, ev.fields.commonMistakes?.values ?? []],
    [FIELD_LABEL.keyPoints, ev.fields.keyPoints?.values ?? []],
    ...(['weightDistribution', 'feet', 'legs', 'hips', 'upperBody'] as const).map((b) => [FIELD_LABEL[`body.${b}`], ev.fields[`body.${b}`]?.values ?? []] as [string, string[]]),
  ];
  const hits = groups.map(([label, vals]) => [label, vals.filter(has)] as [string, string[]]).filter(([, v]) => v.length);
  if (!hits.length) {
    return { kind: 'trouble', techniqueIds: [t.id], text: `MARTIALDEX의 ${ev.displayName} 자료에는 말씀하신 문제와 직접 관련된 실수나 자세 설명이 없습니다. 원인을 추측하지 않겠습니다. 흔한 실수 전체나 핵심 포인트를 보시려면 물어봐 주세요.` };
  }
  return {
    kind: 'trouble',
    techniqueIds: [t.id],
    text: `${ev.displayName} 자료에서 말씀하신 문제와 관련해 확인되는 내용은 이렇습니다. ${hits.map(([label, v]) => `${label}: ${v.slice(0, 2).map(sentence).join(' ')}`).join(' ')} 자료로 확인되지 않는 것은 실제 원인이 이 중 무엇인지입니다 — MARTIALDEX 자료는 원인을 진단하지 않으니, 영상이나 자세 분석으로 직접 확인해 보세요.`,
  };
}

// ---------------------------------------------------------------- next / prerequisite, with the user's records

const NEXT_Q = /다음(엔|에는|에|으로)?\s*(뭘|무엇|어떤|뭐)|다음\s*(기술|단계)|뭘\s*배우|뭐\s*배우|후속|이어서\s*배울/;
const PREREQ_Q = /선행|먼저\s*(배워|배울|익혀|알아)|전에\s*(배워|알아|익혀|배울)/;

function statusNote(state: LearnerState, t: Technique): string {
  const k = learnedInfo(state, t.id);
  return k ? `기록: ${k.statusLabel}` : '배운 기록 없음';
}

export function nextAnswer(question: string, t: Technique | null, state: LearnerState, art: string | null): CoachQuestionAnswer | null {
  const prereq = PREREQ_Q.test(question);
  if (!prereq && !NEXT_Q.test(question)) return null;
  const all = getUnifiedAllTechniques();
  const byId = (id: string) => all.find((y) => y.id === id || canonicalTechniqueId(y.id) === id);
  if (t) {
    const name = nameOf(evidenceFor(t));
    // ② what the data links: the technique graph, and sentences that connect them (with the sentence)
    let c;
    try {
      c = getTechniqueConnections(t);
    } catch {
      c = null;
    }
    const linked: { t: Technique; note: string }[] = [];
    const push = (x: Technique | undefined, note: string) => {
      if (x && canonicalTechniqueId(x.id) !== canonicalTechniqueId(t.id) && !linked.some((l) => canonicalTechniqueId(l.t.id) === canonicalTechniqueId(x.id))) linked.push({ t: x, note });
    };
    if (prereq) {
      for (const x of c?.prerequisite ?? []) push(byId(x.techniqueId), '기술 관계 자료의 선행 기술');
      for (const r of ledFrom(t)) push(byId(r.sourceId), `자료: "${r.sentence.slice(0, 60)}"`);
    } else {
      for (const x of c?.next ?? []) push(byId(x.techniqueId), '기술 관계 자료의 다음 기술(전환)');
      for (const r of derivedRelations(t).filter((r) => r.kind === 'next')) push(byId(r.techniqueId), `자료: "${r.sentence.slice(0, 60)}"`);
      for (const x of c?.chain ?? []) push(byId(x.techniqueId), '기술 관계 자료의 연결 기술');
    }
    const shown = linked.slice(0, 5);
    if (shown.length) {
      const fresh = shown.filter((r) => !learnedInfo(state, r.t.id));
      return {
        kind: 'next',
        techniqueIds: shown.map((r) => r.t.id),
        text: `MARTIALDEX 자료에서 ${name}의 ${prereq ? '앞 단계로 연결된 기술' : '다음·연결 기술'}입니다: ${shown.map((r) => `${nameOf(evidenceFor(r.t))} — ${r.note}, ${statusNote(state, r.t)}`).join(' / ')}.${!prereq && fresh.length ? ` 이 중 아직 배운 기록이 없는 ${josa(nameOf(evidenceFor(fresh[0].t)), '을/를')} 먼저 권합니다.` : ''}${prereq ? ' 자료에 "반드시 먼저 배워야 한다"고 적힌 것은 아닙니다.' : ''}`,
      };
    }
    if (prereq) {
      // ③ no relation: techniques of the same category the data rates easier (said as such, not as a prerequisite)
      const rank: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
      const mine = rank[t.difficulty ?? ''] ?? 3;
      const easier = familyOf(t).filter((x) => (rank[x.difficulty ?? ''] ?? 3) < mine).slice(0, 4);
      if (!easier.length) return { kind: 'next', techniqueIds: [], text: `MARTIALDEX 자료에 ${name}의 선행 기술은 표시되어 있지 않고, 같은 분류에서 자료상 난이도가 더 낮은 기술도 없습니다. 추측해서 정하지 않겠습니다.` };
      return {
        kind: 'next',
        techniqueIds: easier.map((x) => x.id),
        text: `MARTIALDEX 자료에 ${name}의 선행 기술은 표시되어 있지 않습니다. 관련 기술로, 같은 분류(${t.category})에서 자료상 난이도가 더 낮은 기술: ${easier.map((x) => `${nameOf(evidenceFor(x))}(${statusNote(state, x)})`).join(', ')}. 이것이 반드시 먼저 배워야 하는 기술이라는 뜻은 아닙니다.`,
      };
    }
  }
  // no relation in the data (or no technique): the next unlearned technique of the art, by the records + difficulty
  const a = art ?? t?.martialArt ?? null;
  if (!a) return { kind: 'next', techniqueIds: [], text: '어느 무술의 다음 기술을 찾을까요? 무술 이름이나 기술 이름을 말씀해 주세요.' };
  const pick = pickNext(state, [a], domainOf(question), t ? [canonicalTechniqueId(t.id)] : []);
  if (!pick) return { kind: 'next', techniqueIds: [], text: `${getMartialArt(a)?.nameKo ?? a}에서 아직 배운 기록이 없는 기술 자료를 찾지 못했습니다.` };
  const lead = t ? `MARTIALDEX 자료에 ${nameOf(evidenceFor(t))}의 다음 기술은 표시되어 있지 않습니다. 대신 ` : '';
  return {
    kind: 'next',
    techniqueIds: [pick.technique.id],
    text: `${lead}${getMartialArt(a)?.nameKo ?? a}에서 다음으로 배울 기술로 ${josa(nameOf(evidenceFor(pick.technique)), '을/를')} 권합니다 — ${pick.reasons.join(', ')}.${state.hasRecords ? '' : ' (이 기기에 학습 기록이 없어 수준은 판단하지 않았습니다.)'}`,
  };
}

// ---------------------------------------------------------------- 이름 유래·정의 ("왜 이름이 기무라야?", "이름 뜻이 뭐야?")

const ORIGIN_Q = /(이름|명칭|용어)\s*(이|은|의)?\s*(왜|유래|뜻|어원|의미|어디서)|왜\s*(이름|명칭)|왜\s*.{0,12}(라고|이라고)\s*(불러|부르|해)|유래|어원|누가\s*(만들|이름\s*붙)|(이름|그\s*말)은?\s*어디서\s*(왔|나왔)/;

/** Unknown words of the question that sound like a technique name in another spelling → "혹시 …?" (never chosen). */
function spellingHints(question: string): { techniqueId: string; name: string; martialArt: string }[] {
  const PARTICLES = ['으로', '에서', '이라고', '라고', '이라는', '라는', '은', '는', '이', '가', '을', '를', '의', '도', '랑', '이랑', '하고', '야', '이야'];
  const words = question.replace(/[?？!.~,]/g, ' ').split(/\s+/).filter((w) => /^[가-힣]{2,}$/.test(w));
  const seen = new Map<string, { techniqueId: string; name: string; martialArt: string }>();
  // every way of taking a particle off ("기무라는" → 기무라는 / 기무라 / 기무) is tried; none is assumed
  for (const w of words) {
    const forms = new Set([w, ...PARTICLES.filter((p) => w.endsWith(p) && w.length - p.length >= 2).map((p) => w.slice(0, -p.length))]);
    for (const f of forms) for (const c of similarlySpelled(f)) seen.set(c.techniqueId, c);
  }
  return [...seen.values()].slice(0, 3).map((c) => {
    const t = getUnifiedAllTechniques().find((x) => x.id === c.techniqueId);
    return t ? { ...c, name: nameOf(evidenceFor(t)) } : c;
  });
}

export function originAnswer(t: Technique | null, question: string): CoachQuestionAnswer {
  const hints = t ? [] : spellingHints(question);
  const who = t ? `${nameOf(evidenceFor(t))}의 ` : '';
  const hint = hints.length ? ` 혹시 ${josa(hints.map((h) => h.name).join(', '), '을/를')} 말씀하시는 건가요? 그래도 이름의 유래는 자료에 없습니다.` : '';
  return {
    kind: 'no_technique',
    techniqueIds: t ? [t.id] : [],
    candidates: hints.length ? hints : undefined,
    text: `MARTIALDEX 자료에는 ${who}기술 이름의 유래나 어원에 대한 내용이 없습니다. 확인되지 않은 유래를 추측해서 말씀드리지 않겠습니다.${hint}`,
  };
}

// ---------------------------------------------------------------- 같은 계열 (same category in the same art)

const FAMILY_Q = /비슷한|같은\s*(계열|종류|분류)|계열|유사한/;

/** Techniques the data files under the same category in the same art (not a relation claim). */
export function familyOf(t: Technique): Technique[] {
  return getUnifiedAllTechniques().filter((x) => x.id !== t.id && x.category === t.category && isTechniqueInArt(x, t.martialArt) && canonicalTechniqueId(x.id) !== canonicalTechniqueId(t.id));
}

export function familyAnswer(t: Technique, state: LearnerState): CoachQuestionAnswer {
  const list = familyOf(t).slice(0, 6);
  const name = nameOf(evidenceFor(t));
  if (!list.length) return { kind: 'next', techniqueIds: [], text: `MARTIALDEX 자료에서 ${name}과(와) 같은 분류(${t.category})로 묶인 다른 기술은 없습니다.` };
  return {
    kind: 'next',
    techniqueIds: list.map((x) => x.id),
    text: `MARTIALDEX 자료에서 ${name}과(와) 같은 분류(${t.category})로 묶인 기술: ${list.map((x) => `${nameOf(evidenceFor(x))}(${statusNote(state, x)})`).join(', ')}. 같은 분류일 뿐, 자료가 둘 사이의 순서나 연결을 말하지는 않습니다.`,
  };
}

// ---------------------------------------------------------------- safety ("허리 안 다쳐?", "다리 부러져?")

// body safety: an injury / pain word, or a BODY PART + a negative ("무릎에 안 좋아?", "허리에 무리 가?") —
// an everyday negative alone ("컨디션이 안 좋아") is not a safety question
const INJURY = /다쳐|다치|부상|위험해|위험한|부러|통증|기절|의식을\s*잃|실신|뇌진탕|골절|인대|탈구/;
const BODY_PART = /(무릎|허리|목|어깨|관절|발목|손목|팔꿈치|척추|정강이|갈비|머리|다리|팔|손|발|몸|등|고관절|턱)(에|이|가|은|는|을|를)?/;
const BODY_NEGATIVE = /(안\s*좋|나빠|나쁘|무리|해로|부담|상하|아파|아프|괜찮|위험|시큰|저려)/;
function isSafetyQ(text: string): boolean {
  if (INJURY.test(text)) return true;
  const m = BODY_PART.exec(text);
  return !!m && BODY_NEGATIVE.test(text.slice(m.index, m.index + m[0].length + 12));
}
const SAFETY_Q = { test: isSafetyQ };

export function safetyAnswer(t: Technique | null): CoachQuestionAnswer {
  const tail = '안전 여부는 MARTIALDEX 자료로 확인되지 않습니다. 통증이나 부상이 걱정되면 직접 지도하는 코치나 의료 전문가에게 확인해 주세요.';
  if (!t) return { kind: 'trouble', techniqueIds: [], text: tail };
  const ev = evidenceFor(t);
  const quotes = [...(ev.fields.commonMistakes?.values ?? []), ...(ev.fields.keyPoints?.values ?? [])].filter((x) => /부상|위험|다치|통증|무리|허리|무릎/.test(x)).slice(0, 2);
  return {
    kind: 'trouble',
    techniqueIds: [t.id],
    text: quotes.length ? `MARTIALDEX의 ${ev.displayName} 자료에 기록된 관련 내용: ${quotes.map(sentence).join(' ')} 그 밖의 ${tail}` : `MARTIALDEX의 ${ev.displayName} 자료에는 부상이나 안전에 관한 내용이 없습니다. ${tail}`,
  };
}

// ---------------------------------------------------------------- 상황 코칭 ("거리 못 잡겠어", "가드 자꾸 열려", "마운트 깔렸을 때")

const PROBLEM = /모르겠|못\s*(잡|치|차|쓰|하|넣|던지)|붙어서|안\s*(돼|되|잡)|심해|열려|열리|맞아|맞으면|당하|깔렸|깔리|잡혔|들어와|들어오|어떡|어떻게\s*(해|빠져|대처|해야)|탈출|빠져\s*나|힘들|막막|자꾸|계속|싸움이\s*안/;
/** Words a student uses for a situation → the words the data uses for it (text search terms only). */
const TOPICS: { re: RegExp; label: string; terms: string[]; escape?: boolean }[] = [
  { re: /붙(어|으면|는|었|어서)|달라붙|가까이\s*(붙|와|들어)|근접|인파이트|안쪽으로\s*(들어|파고)/, label: '근거리(붙는 상대)', terms: ['클린치', '근거리', '인사이드', 'clinch', 'inside'] },
  { re: /거리|간격|레인지/, label: '거리', terms: ['거리', '간격', '레인지', 'range', 'distance'] },
  { re: /압박|프레셔/, label: '압박', terms: ['압박', '프레셔', 'pressure'] },
  { re: /가드/, label: '가드', terms: ['가드', 'guard'] },
  { re: /마운트/, label: '마운트', terms: ['마운트', 'mount'], escape: true },
  { re: /백\s*(잡|컨트롤|마운트|테이크)|백을|등\s*뒤/, label: '백 컨트롤', terms: ['백 컨트롤', '백 마운트', '백 테이크', 'back control', 'back mount'], escape: true },
  { re: /사이드/, label: '사이드 컨트롤', terms: ['사이드 컨트롤', '사이드', 'side control'], escape: true },
  { re: /클린치/, label: '클린치', terms: ['클린치', 'clinch'] },
  { re: /케이지|펜스|벽/, label: '케이지', terms: ['케이지', '펜스', 'cage'] },
];
const ESCAPE_MARK = /탈출|빠져|벗어|복귀|회복|리커버리|이스케이프|escape|recovery/i;

function textOf(t: Technique): string {
  return [t.name, t.koreanName ?? '', t.category, ...t.positions, t.description, t.purpose ?? '', t.posture?.overview ?? ''].join(' ').toLowerCase();
}

export function situationCoach(question: string, art: string | null, learner: () => LearnerState): CoachQuestionAnswer | null {
  if (!PROBLEM.test(question)) return null;
  // the most specific situation the student named ("백 마운트" is the back, not just "마운트")
  const topic = TOPICS.map((x) => ({ x, m: x.re.exec(question) })).filter((y) => y.m).sort((a, b) => b.m![0].length - a.m![0].length)[0]?.x;
  if (!topic) return null;
  const terms = topic.terms.map((x) => x.toLowerCase());
  const primary = terms[0];
  const inScope = (t: Technique) => !art || t.martialArt === art || (t.martialArts ?? []).includes(art);
  const pool = getUnifiedAllTechniques().filter((t) => inScope(t) && !/home-training|gym/.test(t.martialArt));
  // 1) techniques ABOUT it: the term in the name / category / positions (escapes: plus an escape word)
  const about = (t: Technique) => {
    const head = [t.name, t.koreanName ?? '', t.category, ...t.positions].join(' ').toLowerCase();
    const hit = terms.some((w) => head.includes(w)) || (topic.escape ? false : (t.posture?.overview ?? '').toLowerCase().includes(primary));
    return hit && (!topic.escape || ESCAPE_MARK.test(textOf(t)));
  };
  const scored = pool.filter(about).map((t) => ({ t, s: (textOf(t).includes(primary) ? 2 : 0) + ((t.posture?.keyPoints?.length ?? 0) > 0 ? 1 : 0) }));
  scored.sort((a, b) => b.s - a.s);
  // several arts and none named → a few per art, so the student can say which one they meant
  const picked: Technique[] = [];
  const perArt = new Map<string, number>();
  for (const { t } of scored) {
    const n = perArt.get(t.martialArt) ?? 0;
    if (!art && n >= 2) continue;
    perArt.set(t.martialArt, n + 1);
    picked.push(t);
    if (picked.length >= 5) break;
  }
  // 2) what the data records as mistakes about it (the techniques in scope)
  // escapes: only the picked techniques' own mistakes (a mistake made WHILE mounting is not about escaping it)
  const mistakes = (topic.escape ? picked : pool)
    .flatMap((t) => (t.posture?.commonMistakes ?? []).filter((m) => terms.some((w) => m.toLowerCase().includes(w))).map((m) => ({ t, m })))
    .slice(0, 2);
  if (!picked.length && !mistakes.length) return null;
  // the technique's own statements (its posture text first; category paragraphs and markdown left out)
  const quoteOf = (t: Technique) => ownSentences(t).find((x) => terms.some((w) => x.toLowerCase().includes(w))) ?? null;
  const lines: string[] = [];
  // ① the technique's own sentence says it deals with this (escape / defense words) · ③ otherwise only related by name / category / position
  const tag = (t: Technique) => `${nameOf(evidenceFor(t))}${art ? '' : ` · ${getMartialArt(t.martialArt)?.nameKo ?? t.martialArt}`}`;
  const direct = picked.map((t) => ({ t, q: quoteOf(t) })).filter((x) => x.q && (DEFENSE_MARK.test(x.q) || ESCAPE_MARK.test(x.q)));
  const related = picked.filter((t) => !direct.some((d) => d.t.id === t.id));
  if (direct.length) lines.push(`① 자료에 직접 적힌 내용: ${direct.map((d) => `${tag(d.t)} — "${d.q!.trim()}"`).join(' / ')}.`);
  if (related.length) lines.push(`③ 이름·분류·포지션이 관련된 기술(직접 대응이라는 근거는 없음): ${related.map((t) => { const q = quoteOf(t); return `${tag(t)}${q ? ` — 자료: "${q.trim()}"` : ''}`; }).join(' / ')}.`);
  if (mistakes.length) lines.push(`자료에 기록된 관련 실수: ${mistakes.map(({ t, m }) => `"${m}"(${nameOf(evidenceFor(t))})`).join(', ')}.`);
  const drawable = picked.find((t) => mittKind(t));
  if (drawable) lines.push(`연습: "${drawable.koreanName ?? drawable.name} 연습하고 싶어"라고 하시면 Visualizing Mitt로 엽니다.`);
  const weak = picked.length ? picked.find((t) => learner().weak.some((w) => w.techniqueId === canonicalTechniqueId(t.id))) : undefined;
  if (weak) lines.push(`기록상 ${nameOf(evidenceFor(weak))}은(는) 복습이 필요하다고 표시되어 있습니다.`);
  const arts = new Set(picked.map((t) => t.martialArt));
  const which = !art && arts.size > 1 ? ` 종목마다 뜻이 다를 수 있어 여러 종목의 기술을 보여 드렸습니다. 어느 종목인지 말씀해 주시면 그 종목으로 좁히겠습니다.` : '';
  return {
    kind: 'situation',
    // every technique the answer quotes (the mistakes' techniques too)
    techniqueIds: [...new Set([...picked.map((t) => t.id), ...mistakes.map(({ t }) => t.id)])],
    text: `MARTIALDEX 자료에서 "${topic.label}"와(과) 관련된 내용을 정리했습니다. ${lines.join(' ')}${which} ④ 자료로 확인되지 않는 것: 어떤 방법이 가장 효과적인지, 자료에 없는 조언은 추측하지 않습니다.`,
  };
}

// ---------------------------------------------------------------- the user's own records

// "what am I weak at" in any wording: 부족·약·약점·모자라·보완·개선 about the student → the recorded weak techniques
const REVIEW_Q = /(뭘|무엇|뭐|어떤\s*(기술|걸|것))\s*.{0,4}복습|복습\s*(할|해야|하면)|복습할\s*(기술|거|것)|(내가|나|제가)\s*.{0,10}(약하게|약한|부족한|못하는)\s*(배웠|거|기술)?|(뭐가|무엇이|어떤\s*(게|걸|것|부분)|어디가|어느\s*부분)\s*.{0,4}(부족|약|모자라|보완|개선)|(내|나의|제)\s*약점|약점이\s*뭐|부족한\s*(점|부분|거|기술)|보완(해야|할|하면)|(뭐가|나)\s*.{0,4}모자라/;
const RECORDS_Q = /(내|나의|제)\s*(학습|기록|진도|숙련도|실력|수준|상태)|얼마나\s*배웠|(뭘|뭐|무엇)\s*배웠|배운\s*기술|(나|내가|제가)\s*(지금까지|여태|요즘)/;

export function reviewAnswer(state: LearnerState): CoachQuestionAnswer {
  const all = getUnifiedAllTechniques();
  const rows = state.weak
    .map((w) => ({ w, t: all.find((x) => canonicalTechniqueId(x.id) === w.techniqueId) }))
    .filter((r): r is typeof r & { t: Technique } => !!r.t)
    .slice(0, 3);
  if (!rows.length) return { kind: 'review', techniqueIds: [], text: '이 기기의 기록에는 복습이 필요하다고 표시된 기술이 없습니다. 기록이 없는 것을 "잘하고 있다"는 뜻으로 보지는 않습니다 — 배운 기술을 말씀해 주시면 그 기술로 복습을 열 수 있습니다.' };
  return {
    kind: 'review',
    techniqueIds: rows.map((r) => r.t.id),
    text: `기록을 보면 복습이 필요한 기술은 다음과 같습니다. ${rows.map((r, i) => `${i + 1}) ${nameOf(evidenceFor(r.t))} — ${r.w.reasons.slice(0, 2).join(' / ')}`).join(' ')} "${rows[0].t.koreanName ?? rows[0].t.name} 복습하고 싶어"라고 하시면 복습을 엽니다.`,
  };
}

export function recordsAnswer(state: LearnerState): CoachQuestionAnswer {
  if (!state.hasRecords) return { kind: 'records', techniqueIds: [], text: '이 기기에는 아직 학습 기록이 없습니다. 기록이 없어서 수준이나 숙련도를 판단하지 않겠습니다.' };
  const counts = new Map<string, number>();
  for (const k of state.learned.values()) counts.set(k.statusLabel, (counts.get(k.statusLabel) ?? 0) + 1);
  const parts = [`기록이 있는 기술 ${state.learned.size}개 (${[...counts].map(([l, n]) => `${l} ${n}`).join(', ')})`];
  if (state.weak.length) parts.push(`복습이 필요하다고 표시된 기술 ${state.weak.length}개`);
  const active = state.activeCurricula.filter((c) => !c.completed);
  if (active.length) parts.push(`진행 중인 커리큘럼: ${active.slice(0, 2).map((c) => `${c.title} ${c.currentDay}일차`).join(', ')}`);
  if (state.goal) parts.push(`저장된 목표: "${state.goal}"`);
  return { kind: 'records', techniqueIds: [], text: `이 기기의 학습 기록: ${parts.join(' · ')}. 숙련도는 자세 분석·수업 평가·연습 기록에서 계산된 값이며, 한 번 완료한 기록만으로 숙달로 보지 않습니다.` };
}

// ---------------------------------------------------------------- router

const REFERS_BACK = /그거|그\s*기술|그것|저거|이거|이\s*기술|방금|아까|추천한/;

/**
 * Answers a technique question for the 자체 AI 코치.
 * `current` = the technique being taught (null outside a lesson); `context` = the conversation so far.
 */
export async function answerCoachQuestion(
  current: Technique | null,
  question: string,
  opts: { useModel: boolean; martialArt?: string | null; context?: CoachDialogContext; learner?: LearnerState }
): Promise<CoachQuestionAnswer> {
  const ctx = opts.context ?? EMPTY_DIALOG;
  const withCtx = (a: CoachQuestionAnswer, focus: string | null = a.techniqueIds.length === 1 ? a.techniqueIds[0] : ctx.focusId): CoachQuestionAnswer => ({
    ...a,
    whyNext: undefined,
    // a list answer replaces the list; any other answer clears it ("그거" then means the focus)
    context: {
      focusId: focus,
      listedIds: ['next', 'review', 'situation', 'counter'].includes(a.kind) && a.techniqueIds.length > 1 ? a.techniqueIds : a.kind === 'ambiguous' ? ctx.listedIds : [],
      lastAction: ctx.lastAction ?? null,
      // a recommendation's own reasons answer the next "왜?"
      lastWhy: a.whyNext ?? (['next', 'review', 'situation', 'counter'].includes(a.kind) ? a.text : null),
    },
  });
  const all = getUnifiedAllTechniques();
  const byId = (id: string | null | undefined) => (id ? all.find((t) => t.id === id) ?? null : null);
  const focus = current ?? byId(ctx.focusId);
  const art = opts.martialArt ?? artIn(question) ?? focus?.martialArt ?? null;
  // a position named in the question is looked up across arts unless an art is named
  const situationArt = opts.martialArt ?? artIn(question) ?? null;
  // read the student's records at most once per question, and only when the answer needs them
  let learnerCache: LearnerState | null = opts.learner ?? null;
  const learner = () => (learnerCache ??= readLearnerState());

  // session follow-ups: "왜?" about what was just said / opened, "끝났어" after a training
  if (WHY_Q.test(question.trim())) return withCtx(whyAnswer(ctx, focus), ctx.focusId);
  if (DONE_Q.test(question.trim())) {
    const d = doneAnswer(ctx);
    return { ...d, context: { ...ctx, lastWhy: null } };
  }
  // questions about the student's own records (no technique needed)
  if (REVIEW_Q.test(question)) return withCtx(reviewAnswer(learner()));
  if (RECORDS_Q.test(question)) return withCtx(recordsAnswer(learner()));

  const named = exactTechniquesInText(question, null);
  if (named.ambiguous.length && !named.matches.length) {
    const a = named.ambiguous[0];
    return withCtx({
      kind: 'ambiguous',
      techniqueIds: [],
      candidates: a.candidates,
      text: `"${a.phrase}"라는 이름의 기술이 MARTIALDEX에 ${a.candidates.length}개 있습니다: ${a.candidates.map((c) => c.name).join(', ')}. 어느 무술의 기술인지 말씀해 주세요. (자동으로 고르지 않습니다)`,
    });
  }
  // "그거 …" after a list of several techniques → which one? (asked, not guessed)
  if (!named.matches.length && REFERS_BACK.test(question) && !current && ctx.listedIds.length > 1 && /그거|그\s*기술|그것|추천한/.test(question)) {
    const listed = ctx.listedIds.map(byId).filter((t): t is Technique => !!t);
    return withCtx({ kind: 'ambiguous', techniqueIds: [], candidates: listed.map((t) => ({ techniqueId: t.id, name: nameOf(evidenceFor(t)), martialArt: t.martialArt })), text: `방금 말씀드린 기술이 여러 개입니다: ${listed.map((t) => nameOf(evidenceFor(t))).join(', ')}. 어느 기술인지 이름으로 말씀해 주세요.` });
  }
  // "하프 가드에서 쓸 수 있는 새 스윕 기술을 추가하고 싶어" — where it would go and how to add it (categoryRegistry;
  // never creates anything)
  const addGuide = techniqueAddAnswer(question, opts.martialArt ?? artIn(question) ?? null);
  if (addGuide) return withCtx({ kind: 'situation', techniqueIds: addGuide.techniqueIds, text: addGuide.text });
  // "하프 가드 스윕 뭐 있어?" — a named category of the technique taxonomy, asked as a list
  const taxList = taxonomyListAnswer(question, opts.martialArt ?? artIn(question) ?? null);
  if (taxList) return withCtx({ kind: 'situation', techniqueIds: taxList.techniqueIds, text: taxList.text });
  const others = named.matches.filter((t) => t.id !== focus?.id);
  // what is ASKED, without the technique names in it ("앵글 카운터 어케 함" is not a counter question)
  const bare = named.matches.flatMap((t) => namesOf(t)).filter((n) => n.trim().length >= 2).sort((a, b) => b.length - a.length).reduce((q, n) => q.split(n).join(' '), question);
  if (COMPARE.test(bare)) {
    const pair = named.matches.length >= 2 ? [named.matches[0], named.matches[1]] : focus && others.length === 1 ? [focus, others[0]] : null;
    if (pair) return withCtx({ kind: 'compare', techniqueIds: pair.map((t) => t.id), text: compareTechniques(pair[0], pair[1]) }, ctx.focusId);
  }
  // name origin ("왜 이름이 기무라야?") is not how to do it
  if (ORIGIN_Q.test(bare)) return withCtx(originAnswer(named.matches.length === 1 ? named.matches[0] : named.matches.length === 0 && !/[가-힣]{2,}/.test(bare.replace(ORIGIN_Q, '')) ? focus : null, question), ctx.focusId);
  // safety ("허리 안 다쳐?", "다리 부러져?") comes first: the data never guarantees safety
  if (SAFETY_Q.test(bare)) return withCtx(safetyAnswer(named.matches.length === 1 ? named.matches[0] : named.matches.length === 0 ? focus : null));
  // a situation ("거리 못 잡겠어", "마운트 깔렸을 때") — unless the student named a technique to ask about
  // a named record that IS the situation ("마운트", "Back Control") still makes it a situation question
  const flat = (x: string) => x.toLowerCase().replace(/[\s\-_.]/g, '');
  const topicOnly = named.matches.every((t) => TOPICS.some((x) => namesOf(t).some((n) => x.terms.some((w) => flat(n) === flat(w)))));
  // (in a lesson too, when the question names the situation itself: "마운트 깔렸을 때 …")
  // "펀치를 못 치겠어" / "잽을 못 쓰겠어" is the student's OWN strike, not the opponent's attack
  const ownStrike = /(을|를)?\s*(못|안)\s*(치|차|쓰|하|넣|던지|들어가)/.test(bare);
  const opponentAttack = ATTACK_TERMS.some(([re]) => re.test(bare)) && !ownStrike;
  if ((!current || named.matches.length > 0) && topicOnly && !opponentAttack) {
    const sit = situationCoach(question, opts.martialArt ?? artIn(question), learner);
    if (sit) return withCtx(sit);
  }
  const counter = COUNTER_Q.test(bare) ? counterAnswer(question, focus, named.matches) : null;
  if (counter) return withCtx(counter);
  // "클로즈드 가드에서 쓸 수 있는 기술은?" asks for techniques used IN that position (the position may itself be a record).
  if (SITUATION.test(question)) {
    const sit = situationAnswer(question, situationArt);
    if (sit) return withCtx(sit);
  }
  const target = named.matches.length === 1 ? named.matches[0] : named.matches.length === 0 ? focus : null;
  const next = NEXT_Q.test(bare) || PREREQ_Q.test(bare) ? nextAnswer(bare, target, learner(), art) : null;
  if (next) return withCtx(next, target?.id ?? ctx.focusId);
  if (PRACTICE.test(bare) && target) return withCtx({ kind: 'practice', techniqueIds: [target.id], text: practiceAnswer(target) });
  if (!target && SAFETY_Q.test(question)) return withCtx(safetyAnswer(null));
  if (!target) {
    return withCtx({
      kind: 'no_technique',
      techniqueIds: [],
      text:
        named.matches.length > 1
          ? `질문에 기술이 여러 개 있습니다: ${named.matches.map((t) => t.name).join(', ')}. 하나씩 물어보시거나 "A와 B의 차이"처럼 물어봐 주세요.`
          : spellingHints(question).length
            ? `MARTIALDEX에서 그 이름의 기술을 찾지 못했습니다. 혹시 ${josa(spellingHints(question).map((h) => h.name).join(', '), '을/를')} 말씀하시는 건가요? 맞으면 그 이름으로 다시 물어봐 주세요.`
            : '어떤 기술에 대한 질문인지 MARTIALDEX 기술 이름으로 말씀해 주세요. (예: "잽은 어떻게 해?")',
    });
  }
  if (SAFETY_Q.test(question)) return withCtx(safetyAnswer(target));
  if (FAMILY_Q.test(bare)) return withCtx(familyAnswer(target, learner()));
  const trouble = TROUBLE_Q.test(bare) ? troubleAnswer(question, target) : null;
  if (trouble) return withCtx(trouble);
  // in a lesson, a situation the lesson's technique has nothing on → the situation across the data
  if (current) {
    const sit = situationCoach(question, opts.martialArt ?? artIn(question) ?? current.martialArt, learner);
    if (sit && !named.matches.length) return withCtx(sit);
  }
  const grounded = await answerFromEvidence(target, question, { useModel: opts.useModel, ignore: named.words.filter((w) => named.matches.some((t) => [t.name, t.koreanName ?? '', ...t.aliases].some((n) => n && (n.includes(w) || w.includes(n))))) });
  return withCtx({ kind: 'single', techniqueIds: [target.id], text: grounded.text, grounded });
}
