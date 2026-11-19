import type { Technique } from '../../types';
import { getUnifiedAllTechniques } from '../userTechniques/service';
import { canonicalTechniqueId, isTechniqueInArt } from '../techniqueCanonical';
import { getMartialArt } from '../loadData';
import { motionForTechnique } from '../visualMitt/archetypes';
import { drillPlanFor } from '../soloDrill/moves';
import { MMA_SOURCE_MARTIAL_ARTS } from '../mmaCurriculum/types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { evidenceFor } from './lookup';
import { artIn } from './featureCatalog';
import { learnedInfo, type LearnerState } from './learnerState';

// 자체 AI 코치의 개인 맞춤 수업 계획 — deterministic, from the technique data
// and THIS user's records (learnerState.ts). It decides:
//   - which recorded weak technique to review (records' own reasons),
//   - which not-yet-learned technique to teach next (the technique graph's
//     "다음/연결" edges from what was learned first, then the easiest level),
//   - how it can be practised: standing strikes / takedown entries have a
//     Visualizing Mitt motion (the same archetypes the Gemini coach's practice
//     plan uses — visualMitt/archetypes.ts); ground grappling never goes to the
//     mitt (solo drill / timer, as aiCoachDay/practicePlan.ts does).
// No level is assumed without records; every reason quotes a real record or data field.

export type TrainingDomain = 'striking' | 'takedown' | 'ground' | 'any';

export function domainOf(text: string): TrainingDomain {
  if (/그라운드|그래플링|서브미션|관절기|조르기|초크|가드\s*(패스|플레이)|주짓수|bjj/i.test(text)) return 'ground';
  if (/테이크다운|태클|레슬링\s*스탠딩|클린치/.test(text)) return 'takedown';
  if (/타격|스탠딩|펀치|킥|복싱|킥복싱|무에타이|입식|미트|콤보|패드|striking/i.test(text)) return 'striking';
  return 'any';
}

/** How a technique can be practised in MARTIALDEX's mitt: by its real mitt motion (none = not a mitt technique). */
export function mittKind(t: Technique): 'strike' | 'entry' | null {
  const m = motionForTechnique(t);
  if (!m) return null;
  return m.archetype.kind === 'entry' ? 'entry' : 'strike';
}

function inDomain(t: Technique, d: TrainingDomain): boolean {
  if (d === 'any') return true;
  const k = mittKind(t);
  if (d === 'striking') return k === 'strike';
  if (d === 'takedown') return k === 'entry' || (isDefense(t) && /테이크다운|태클|스프롤|sprawl|takedown|다운\s*블록|down block/i.test(`${t.name} ${t.koreanName ?? ''} ${t.category} ${t.posture?.overview ?? ''}`));
  return !k && (drillPlanFor(t)?.group === 'ground' || /가드|마운트|백|사이드|서브미션|조르|관절|스윕|패스|escape|guard|mount|submission/i.test(`${t.category} ${t.positions.join(' ')}`));
}

const DIFFICULTY_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const teachable = (t: Technique) => (t.posture?.keyPoints?.length ?? 0) > 0;

function artsFor(art: string, d: TrainingDomain): string[] {
  // MMA standing work also draws on its source striking arts (as the MMA curriculum does).
  if (art !== 'mixed-martial-arts') return [art];
  if (d === 'striking') return ['mixed-martial-arts', ...MMA_SOURCE_MARTIAL_ARTS.filter((a) => a !== 'mixed-martial-arts')];
  if (d === 'takedown') return ['mixed-martial-arts', 'wrestling'];
  return [art];
}

export interface PlanPick {
  technique: Technique;
  /** Why — each reason is a real record or data field. */
  reasons: string[];
}

export interface OwnLessonPlan {
  ok: true;
  martialArt: string;
  domain: TrainingDomain;
  review: PlanPick | null;
  next: PlanPick | null;
  /** The lesson's main technique (new one, else the review one). */
  main: Technique;
  /** "Visualizing Mitt (타격)" / "솔로 드릴·타이머 (그라운드)" … — what the existing practice step will run. */
  practice: string;
  usedRecords: boolean;
  /** The saved goal decided what the request left open. */
  goalUsed: boolean;
  summary: string;
}

const nameOf = (t: Technique) => evidenceFor(t).displayName;

/** The recorded weak technique to review in this art/domain (records' own reasons), or null. */
export function pickReview(state: LearnerState, arts: string[], d: TrainingDomain): PlanPick | null {
  for (const w of state.weak) {
    const t = getUnifiedAllTechniques().find((x) => canonicalTechniqueId(x.id) === w.techniqueId);
    if (!t || !arts.some((a) => isTechniqueInArt(t, a)) || !inDomain(t, d)) continue;
    return { technique: t, reasons: w.reasons.slice(0, 2) };
  }
  return null;
}

/** The next technique to learn: unlearned, teachable, in the art/domain; graph successors of learned ones first. */
/** A defense / escape technique by its own record (name, category) or its mitt motion. */
export function isDefense(t: Technique): boolean {
  return /방어|디펜스|defen|스프롤|sprawl|블록|block|탈출|escape|다운\s*블록/i.test(`${t.name} ${t.koreanName ?? ''} ${t.category}`) || motionForTechnique(t)?.archetype.kind === 'defense';
}

export function pickNext(state: LearnerState, arts: string[], d: TrainingDomain, exclude: string[] = [], preferDefense = false): PlanPick | null {
  const pool = getUnifiedAllTechniques().filter((t) => arts.some((a) => isTechniqueInArt(t, a)) && teachable(t) && inDomain(t, d) && !learnedInfo(state, t.id) && !exclude.includes(canonicalTechniqueId(t.id)));
  if (!pool.length) return null;
  const byId = new Map(pool.map((t) => [canonicalTechniqueId(t.id), t]));
  // 1) the technique graph's next / connected techniques of what the records say was learned
  for (const info of state.learned.values()) {
    const from = getUnifiedAllTechniques().find((x) => canonicalTechniqueId(x.id) === info.techniqueId);
    if (!from) continue;
    let c;
    try {
      c = getTechniqueConnections(from);
    } catch {
      continue;
    }
    for (const [kind, label] of [['next', '다음 기술(전환)'], ['chain', '연결 기술']] as const) {
      for (const x of c[kind]) {
        const t = byId.get(canonicalTechniqueId(x.techniqueId));
        if (t && (!preferDefense || isDefense(t))) return { technique: t, reasons: [`배운 기록이 있는 ${nameOf(from)}의 ${label}로 자료에 연결되어 있음`, '아직 배운 기록이 없음'] };
      }
    }
  }
  // 2) the easiest level first (the data's difficulty), then the one with the most key points
  const def = (t: Technique) => (preferDefense && isDefense(t) ? 0 : 1);
  const sorted = [...pool].sort((a, b) => def(a) - def(b) || (DIFFICULTY_RANK[a.difficulty ?? ''] ?? 3) - (DIFFICULTY_RANK[b.difficulty ?? ''] ?? 3) || (b.posture?.keyPoints?.length ?? 0) - (a.posture?.keyPoints?.length ?? 0) || a.name.length - b.name.length);
  const t = sorted[0];
  const level = t.difficulty ? `자료상 난이도 ${t.difficulty === 'beginner' ? '초급' : t.difficulty === 'intermediate' ? '중급' : '상급'}` : '난이도 정보 없음';
  return { technique: t, reasons: ['아직 배운 기록이 없음', ...(preferDefense && isDefense(t) ? ['자료상 방어 기술'] : []), level] };
}

function practiceLine(ts: Technique[], d: TrainingDomain): string {
  const kinds = ts.map(mittKind);
  if (kinds.length && kinds.every((k) => k)) return `실습은 기존 Visualizing Mitt로 ${ts.map(nameOf).join(' → ')}${kinds.includes('entry') ? '(테이크다운 진입 포함)' : ''}을 칩니다.`;
  if (d === 'ground' || kinds.every((k) => !k)) return '그라운드·그래플링 동작은 미트로 연습하지 않습니다. 실습은 기존 솔로 드릴 또는 세트·휴식 타이머로 진행합니다.';
  return `미트로 그릴 수 있는 ${ts.filter((t) => mittKind(t)).map(nameOf).join(', ')}은(는) Visualizing Mitt로, 나머지는 타이머 반복으로 연습합니다.`;
}

/**
 * A lesson plan for a topic request ("MMA 타격 수업 하고 싶어", "내 기록으로 복싱 수업").
 * `needs` = what the coach must ask first (no art known) — never guessed.
 */
export function planOwnLesson(request: string, state: LearnerState, fallbackArt: string | null = null): OwnLessonPlan | { ok: false; needs: 'art'; message: string } {
  // the request decides; what it leaves open comes from the saved goal ("타격 위주", "레슬링 대비", "BJJ 위주")
  const goal = state.goal;
  const reqDomain = domainOf(request);
  // "레슬링 대비" / "태클 방어" = defending takedowns, whatever art the student trains
  const goalDomain: TrainingDomain = goal ? (/대비|방어|디펜스|막/.test(goal) && /레슬링|태클|테이크다운|그래플러/.test(goal) ? 'takedown' : domainOf(goal)) : 'any';
  const d = reqDomain !== 'any' ? reqDomain : goalDomain;
  const goalArt = goal ? (/mma|종합격투기/i.test(goal) ? 'mixed-martial-arts' : artIn(goal)) : null;
  const art = artIn(request) ?? goalArt ?? fallbackArt ?? (d === 'striking' && goal ? 'mixed-martial-arts' : null);
  const preferDefense = !!goal && /대비|방어|디펜스|막/.test(goal) && reqDomain === 'any';
  const goalUsed = !!goal && (goalDomain !== 'any' || !!artIn(goal)) && (reqDomain === 'any' || !artIn(request));
  if (!art) {
    return { ok: false, needs: 'art', message: '어느 무술로 수업할까요? 무술 이름을 함께 말씀해 주세요. (예: "복싱 타격 수업", "MMA 타격 수업", "레슬링 테이크다운 수업")' };
  }
  const arts = artsFor(art, d);
  const review = pickReview(state, arts, d);
  const next = pickNext(state, arts, d, review ? [canonicalTechniqueId(review.technique.id)] : [], preferDefense);
  const main = next?.technique ?? review?.technique;
  if (!main) {
    return { ok: false, needs: 'art', message: `${getMartialArt(art)?.nameKo ?? art}에서 이 조건에 맞는 MARTIALDEX 기술 자료를 찾지 못했습니다. 기술 이름이나 다른 무술로 말씀해 주세요.` };
  }
  const ts = [...(review ? [review.technique] : []), ...(next ? [next.technique] : [])];
  const lines: string[] = [];
  if (review) lines.push(`복습: ${nameOf(review.technique)} — 기록: ${review.reasons.join(' / ')}.`);
  if (next) lines.push(`새 기술: ${nameOf(next.technique)} — ${next.reasons.join(', ')}.`);
  if (goalUsed) lines.push(`저장된 목표 "${goal}"에 맞춰 ${d === 'striking' ? '스탠딩 타격' : d === 'takedown' ? (preferDefense ? '테이크다운 방어' : '테이크다운') : d === 'ground' ? '그라운드·그래플링' : getMartialArt(art)?.nameKo ?? art} 기술을 우선했습니다.`);
  if (!state.hasRecords) lines.push('이 기기에 학습 기록이 없어 수준을 판단하지 않고, 자료상 가장 쉬운 기술부터 골랐습니다.');
  const practice = practiceLine(ts, d);
  return {
    ok: true,
    martialArt: art,
    domain: d,
    review,
    next,
    main,
    practice,
    usedRecords: state.hasRecords,
    goalUsed,
    summary: `${lines.join(' ')} ${practice}`,
  };
}
