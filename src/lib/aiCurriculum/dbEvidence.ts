import type { Technique } from '../../types';
import { allTechniques } from '../loadData';
import { MMA_MARTIAL_ART_ID, MMA_SOURCE_MARTIAL_ARTS } from '../mmaCurriculum/types';
import type { SubGoal } from './subGoals';
import { actionsOf, conceptsIn, focusIn, mostSpecificPosition, positionsOf, relatedPositions } from './subGoals';
import { classifyTechniqueStructure } from './structureClassifier';
import { classifyIntentsFromText, classifyTechniqueIntents, intentMultiplier } from './intentClassifier';
import type { GoalIntent } from './types';

// 근거 등급 B — MARTIALDEX 자체 기술 DB로 확인된 기술. Deterministic, no API call.
// Only the hand-authored posture data counts as evidence (starting position, overview, steps, key points):
// the static technique files' description/purpose fields are empty for almost every technique, and a
// technique NAME is never evidence on its own. A technique is accepted for a learning part only when that
// text itself shows the part's situation, technique family and purpose — and, for an escape/defense part,
// that it is written from the escaping side (much of the back-position data is the attacker's: 백 테이크,
// "상대가 벗어나려는 것을 막는" hand fighting). Anything unclear is not used.

export type DbCheck = 'pass' | 'fail' | 'unknown' | 'na';

export interface DbEvidenceTechnique {
  techniqueId: string;
  name: string;
  partId: string;
  /** The posture sentence that shows the situation (verbatim from the DB). */
  quote: string;
  checks: { family: DbCheck; focus: DbCheck; position: DbCheck; purpose: DbCheck; perspective: DbCheck; kind: DbCheck };
}

/** Static, curated techniques with real posture text — user-added / AI-researched entries are never DB evidence. */
export function hasTrustworthyDbData(t: Technique): boolean {
  return !t.source && !!t.posture?.overview?.trim() && (t.posture.steps?.length ?? 0) >= 2;
}

function postureSentences(t: Technique): string[] {
  const p = t.posture;
  if (!p) return [];
  return [p.startingPosition, p.overview, ...Object.values(p.bodyPosition ?? {}), ...(p.steps ?? []), ...(p.keyPoints ?? [])]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .flatMap((x) => x.split(/(?<=[.!?。다])\s+/));
}

// written from the controlling side: I am behind them / they try to get out
const CONTROLLER = /상대의 (등 뒤|백)|등 뒤로 (이동|돌|넘어)|상대가 [^.]{0,24}(벗어나|탈출|빠져나|풀거나|풀려|제거하려)|후크를 (걸|확보)|백을 (잡|완성|확보|유지)|시트벨트 그립을 (확보|잡)|하체 컨트롤을 강화/;
// written from the side that is caught and gets out
const ESCAPER = /잡혔|잡힌|당했|당한|깔린|깔렸|걸린|걸렸|에서 (탈출|빠져나)|벗어나는|벗어납|이스케이프|탈출합|빠져나옵|풀어냅/;
const DEFENSIVE: GoalIntent[] = ['escape', 'defense', 'counter'];
const NOT_A_TECHNIQUE = new Set(['movement', 'conditioning', 'general_fundamental', 'setup']);

/**
 * `evidence` (default): may this entry stand as grade-B evidence on its own data? — strict, every check must pass.
 * `contradiction`: a web-verified technique was name-matched to this entry; does the entry's own data CONTRADICT
 * the part? — only explicit conflicts count (opposite purpose, a defensive part answered by the controlling side,
 * a different named technique, or only unrelated positions); what the data merely doesn't mention is fine,
 * because the web evidence already covers the situation.
 */
export function checkDbTechniqueForPart(t: Technique, part: SubGoal, core: SubGoal | null, mode: 'evidence' | 'contradiction' = 'evidence'): { verdict: 'pass' | 'fail' | 'uncertain'; checks: DbEvidenceTechnique['checks']; quote: string; reasons: string[] } {
  const reasons: string[] = [];
  const sentences = postureSentences(t);
  // the situation comes from the posture text only — the positions/category metadata lists every position a
  // technique is filed under ("Backdoor Escape": 딥 하프 가드 / 마운트 / 터틀), which says nothing about this one
  const text = sentences.join(' ');
  const positions = positionsOf(conceptsIn(text));
  const actions = actionsOf(conceptsIn(`${text} ${t.category}`));

  // technique family — from the posture text / category, never from the name
  const wanted = part.actions.filter((a) => a !== 'defense' || part.actions.length === 1);
  let family: DbCheck = 'na';
  if (wanted.length > 0) family = actions.some((a) => wanted.includes(a)) ? 'pass' : 'unknown';
  if (family === 'unknown') reasons.push('자세 데이터에서 요청한 기술 종류가 확인되지 않음');

  // a part limited to one named technique ("싱글렉만") — the name may identify it, the other checks still need the text
  let focus: DbCheck = 'na';
  if (part.focus.length > 0) focus = focusIn(`${t.name} ${t.koreanName ?? ''} ${t.category} ${text}`).some((f) => part.focus.includes(f)) ? 'pass' : 'fail';
  if (focus === 'fail') reasons.push('요청한 기술이 아님');

  // situation / position (a follow-up also carries the core situation). Stricter than the web check: the DB is
  // only supporting evidence, so its text must name the part's MOST SPECIFIC situation itself — a related
  // position ("앉은 상태" ↔ guard, body triangle ↔ any back position) is not enough
  let position: DbCheck = 'na';
  if (part.positions.length > 0) {
    const needed = mostSpecificPosition(part.positions)!;
    const allowed = mode === 'contradiction' ? relatedPositions(part.positions) : new Set([needed]);
    if (positions.some((p) => allowed.has(p))) position = 'pass';
    else if (positions.length > 0) {
      position = 'fail';
      reasons.push(`다른 포지션(${positions.join(', ')})`);
    } else {
      position = 'unknown';
      reasons.push('자세 데이터에서 해당 상황이 확인되지 않음');
    }
  }

  // purpose — the technique's own intent (category/positions) plus what its posture text says
  const techIntents = [...new Set([...classifyTechniqueIntents(t), ...classifyIntentsFromText(`${t.posture?.startingPosition ?? ''} ${t.posture?.overview ?? ''}`)])];
  let purpose: DbCheck = 'na';
  if (part.intents.length > 0) {
    if (techIntents.length === 0) purpose = 'unknown';
    else if (intentMultiplier(part.intents, techIntents) === 0) {
      purpose = 'fail';
      reasons.push(`목적이 반대(${techIntents.join('/')})`);
    } else purpose = 'pass';
  }

  // perspective — an escape/defense part (or a follow-up of one) needs the escaping side's text, never the
  // controller's (much of the back-position data is written for the person holding the back)
  let perspective: DbCheck = 'na';
  const defensivePart = part.intents.some((i) => DEFENSIVE.includes(i)) && !part.intents.includes('attack');
  const afterDefensiveCore = part.role === 'follow_up' && !!core && core.intents.some((i) => DEFENSIVE.includes(i));
  if (defensivePart || (afterDefensiveCore && mode === 'evidence')) {
    const controller = CONTROLLER.test(text);
    const escaper = ESCAPER.test(text);
    perspective = controller && !escaper ? 'fail' : escaper ? 'pass' : 'unknown';
    if (perspective === 'fail') reasons.push('공격(통제)하는 쪽의 기술');
  }
  // a follow-up after a defensive core ("탈출한 뒤 테이크다운") must show the escape → follow-up transition itself
  if (mode === 'evidence' && afterDefensiveCore && !actions.includes('escape') && perspective !== 'fail') {
    perspective = 'unknown';
    reasons.push('앞 상황(탈출)에서 이어지는 기술인지 자세 데이터로 확인되지 않음');
  }

  // stances, footwork, grips and conditioning are prerequisites, not the technique a part asks for
  let kind: DbCheck = 'na';
  if (part.actions.length > 0 && !part.intents.includes('fundamentals')) {
    kind = NOT_A_TECHNIQUE.has(classifyTechniqueStructure(t)) ? 'fail' : 'pass';
    if (kind === 'fail') reasons.push('기본 자세·그립·움직임(요청한 기술 자체가 아님)');
  }

  const checks = { family, focus, position, purpose, perspective, kind };
  const all = Object.values(checks);
  const verdict = all.includes('fail') ? 'fail' : all.every((c) => c === 'pass' || c === 'na') && (family === 'pass' || position === 'pass') ? 'pass' : 'uncertain';
  const shown = sentences.find((x) => {
    const c = conceptsIn(x);
    return positionsOf(c).some((p) => part.positions.includes(p)) || actionsOf(c).some((a) => wanted.includes(a));
  });
  return { verdict, checks, quote: (shown ?? t.posture?.overview ?? '').trim().slice(0, 200), reasons };
}

function inArt(t: Technique, martialArt: string): boolean {
  if (martialArt === MMA_MARTIAL_ART_ID) return (MMA_SOURCE_MARTIAL_ARTS as readonly string[]).includes(t.martialArt);
  return t.martialArt === martialArt;
}

/** DB-confirmed techniques per learning part (grade B candidates). Parts naming no situation and no technique family get none. */
export function findDbEvidence(parts: SubGoal[], martialArt: string, pool: Technique[] = allTechniques): DbEvidenceTechnique[] {
  const core = parts.find((p) => p.role === 'core') ?? null;
  const out: DbEvidenceTechnique[] = [];
  const candidates = pool.filter((t) => inArt(t, martialArt) && hasTrustworthyDbData(t));
  for (const part of parts) {
    if (part.positions.length === 0 && part.actions.length === 0) continue;
    for (const t of candidates) {
      const r = checkDbTechniqueForPart(t, part, part === core ? null : core);
      if (r.verdict === 'pass') out.push({ techniqueId: t.id, name: t.name, partId: part.id, quote: r.quote, checks: r.checks });
    }
  }
  return out;
}
