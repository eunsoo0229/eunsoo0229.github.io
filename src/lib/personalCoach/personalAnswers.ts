// Personal questions to the 자체 AI 코치 — answered by code from the learner model
// (learnerModel.ts) and the MARTIALDEX DB. No model call: these are lookups.
//   "내가 지금까지 배운 레슬링 기술은?" / "아직 배우지 않은 …" / "내가 가장 부족한 기술은?" /
//   "최근 숙련도가 향상된 기술은?" / "복습이 필요한 기술은?" / "내가 배운 기술로 만들 수 있는 콤보는?" /
//   "다음으로 무엇을 배우면 좋아?" / "내 레슬링 실력에서 부족한 부분을 분석해 줘"
// A learner with no records gets "기록이 없습니다", never an invented history.

import type { Technique } from '../../types';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import type { KnowledgeIndex, KnowledgeSequence } from '../martialdexKnowledge/types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { inArt, LEARNING_STATE_LABEL, type TechniqueLearning } from './learnerModel';

export type PersonalQuery = 'learned' | 'unlearned' | 'weakest' | 'improved' | 'review' | 'combos' | 'next' | 'analysis';

const MINE = /(내가|나의|내\s|제가|저의|나는|난\s|우리)/;

/** Which personal question this is (null = not a question about the learner's own records). */
export function personalQueryOf(text: string): PersonalQuery | null {
  const t = text.trim();
  const mine = MINE.test(t) || /^(배운|안 배운|아직 배우지)/.test(t);
  if (!mine) return null;
  if (/(부족한 부분|실력.{0,6}(분석|진단|평가)|약점.{0,6}(분석|진단))/.test(t)) return 'analysis';
  if (/(배운 기술로|배운 걸로|배운 것으로).{0,12}(콤보|콤비네이션|셋업)|(만들 수 있는|할 수 있는).{0,8}(콤보|콤비네이션)/.test(t)) return 'combos';
  if (/(다음으로|다음에|이제).{0,10}(배우|배울|공부)|(뭘|무엇을|뭐를)\s*배우(면|는 게)/.test(t)) return 'next';
  if (/(아직 (안 )?배우지|안 배운|배우지 않은|미학습)/.test(t)) return 'unlearned';
  if (/(복습이 필요|복습할|복습해야)/.test(t)) return 'review';
  if (/(향상|늘었|좋아진|올라간)/.test(t)) return 'improved';
  if (/(가장 부족|부족한 기술|약한 기술|못하는 기술|숙련도가 낮)/.test(t)) return 'weakest';
  if (/(배운|학습한|익힌)\s*(\S+\s+)?기술/.test(t)) return 'learned';
  return null;
}

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);
const prof = (l: TechniqueLearning) => (l.proficiency === null ? '학습 숙련도 기록 없음' : `학습 숙련도 ${l.proficiency}`);
const DIFF: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

function connections(t: Technique) {
  try {
    return getTechniqueConnections(t);
  } catch {
    return null;
  }
}

/** Next techniques to learn: unlearned, teachable, in the art — prerequisites learned / connected from what is learned first. */
export function nextToLearn(art: string, learner: TechniqueLearning[], limit = 3): { technique: Technique; why: string }[] {
  const learnedIds = new Set(learner.filter((l) => l.states.includes('learned') || l.state === 'learning').map((l) => canonicalTechniqueId(l.technique.id)));
  const fromLearned = new Map<string, string>();
  for (const l of learner) {
    if (!learnedIds.has(canonicalTechniqueId(l.technique.id)) || !inArt(l.technique, art)) continue;
    const c = connections(l.technique);
    for (const x of [...(c?.next ?? []), ...(c?.chain ?? [])]) if (!fromLearned.has(x.techniqueId)) fromLearned.set(x.techniqueId, l.technique.name);
  }
  const scored: { technique: Technique; score: number; why: string }[] = [];
  for (const l of learner) {
    const t = l.technique;
    if (!inArt(t, art) || (l.state !== 'not_started' && l.state !== 'planned') || t.notTechnique || lessonReadiness(t).level === 'insufficient') continue;
    const pre = connections(t)?.prerequisite ?? [];
    const preOk = pre.length > 0 && pre.every((p) => learnedIds.has(canonicalTechniqueId(p.techniqueId)));
    const from = fromLearned.get(t.id);
    const whys: string[] = [];
    let score = 2 - (DIFF[t.difficulty ?? 'intermediate'] ?? 1);
    if (preOk) (score += 3), whys.push(`선행 기술(${pre.map((p) => p.techniqueName).slice(0, 2).join(', ')})을 배움`);
    if (from) (score += 2), whys.push(`배운 ${from}에서 이어지는 기술`);
    if (l.state === 'planned') (score += 2), whys.push('내 커리큘럼에 예정');
    if (t.difficulty === 'beginner') whys.push('초급');
    scored.push({ technique: t, score, why: whys.join(' · ') || (t.difficulty ? `${{ beginner: '초급', intermediate: '중급', advanced: '고급' }[t.difficulty]} 기술` : '난이도 기록 없음') });
  }
  return scored.sort((a, b) => b.score - a.score || a.technique.name.localeCompare(b.technique.name)).slice(0, limit).map(({ technique, why }) => ({ technique, why }));
}

/** Recorded combos / setups of the art, with which steps the learner has not learned. */
export function combosFromLearned(art: string, learner: TechniqueLearning[], index: KnowledgeIndex | null): { sequence: KnowledgeSequence; missing: string[] }[] {
  if (!index) return [];
  const learned = new Set(learner.filter((l) => l.states.includes('learned') || l.state === 'learning' || l.state === 'weak').map((l) => canonicalTechniqueId(l.technique.id)));
  const out: { sequence: KnowledgeSequence; missing: string[] }[] = [];
  for (const s of index.sequences) {
    if (s.martialArt && s.martialArt !== art) continue;
    if (s.steps.length < 2) continue;
    const ids = s.steps.map((x) => canonicalTechniqueId(x.techniqueId));
    const known = ids.filter((id) => learned.has(id)).length;
    if (known === 0) continue;
    const missing = s.steps.filter((x) => !learned.has(canonicalTechniqueId(x.techniqueId))).map((x) => x.name);
    if (missing.length > 1) continue;
    out.push({ sequence: s, missing });
  }
  // the learner's own combos first, then complete ones
  return out.sort((a, b) => Number(b.sequence.origin === 'my_combo') - Number(a.sequence.origin === 'my_combo') || a.missing.length - b.missing.length).slice(0, 6);
}

export interface PersonalAnswer {
  text: string;
  /** Techniques a lesson could be made of (the "수업 시작" proposal), when the answer recommends one. */
  lessonTechniqueIds: string[];
}

/** The art the learner studied most recently (for a personal question that names no art). */
export function recentArt(learner: TechniqueLearning[]): string | null {
  const last = learner.filter((l) => l.lastStudiedAt).sort((a, b) => (b.lastStudiedAt ?? '').localeCompare(a.lastStudiedAt ?? ''))[0];
  return last?.technique.martialArt ?? null;
}

export function personalAnswer(q: PersonalQuery, art: string | null, artName: string, learner: TechniqueLearning[], index: KnowledgeIndex | null): PersonalAnswer {
  const scope = art ? learner.filter((l) => inArt(l.technique, art)) : learner;
  const where = art ? `${artName} ` : '';
  const studied = scope.filter((l) => l.state !== 'not_started' && l.state !== 'planned');
  const none = (what: string): PersonalAnswer => ({ text: `이 기기에 저장된 ${where}학습 기록이 없어 ${what}을(를) 알 수 없습니다. AI 코치 수업·오늘의 훈련·자세 측정을 하면 그 기록으로 답합니다. (기록을 지어내지 않습니다)`, lessonTechniqueIds: [] });
  const head = `${where}학습 기록 기준(수업 ${scope.reduce((n, l) => n + l.lessonDays, 0)}일·연습 ${scope.reduce((n, l) => n + l.practiceDays, 0)}일, 이 기기의 내 기록만):`;
  const line = (l: TechniqueLearning) => `- ${label(l.technique)} · ${LEARNING_STATE_LABEL[l.state]} · ${prof(l)}${l.pose ? ` · 자세 점수 ${l.pose.latest}점(측정 ${l.pose.count}회)` : ''}${l.evidence.length ? ` — ${l.evidence.slice(0, 2).join(', ')}` : ''}`;
  if (!art && q !== 'weakest' && q !== 'review' && q !== 'improved' && q !== 'learned') return { text: '어느 무술을 기준으로 볼까요? 예: "내가 아직 배우지 않은 레슬링 기술은?"', lessonTechniqueIds: [] };

  if (q === 'learned') {
    const done = scope.filter((l) => l.states.includes('learned')).sort((a, b) => (b.proficiency ?? 0) - (a.proficiency ?? 0));
    const ing = scope.filter((l) => l.state === 'learning');
    if (!done.length && !ing.length) return none('배운 기술');
    return { text: [head, `■ 학습 완료 ${done.length}개`, ...done.slice(0, 12).map(line), ...(ing.length ? [`■ 학습 중 ${ing.length}개`, ...ing.slice(0, 8).map(line)] : [])].join('\n'), lessonTechniqueIds: [] };
  }
  if (q === 'unlearned') {
    const un = scope.filter((l) => (l.state === 'not_started' || l.state === 'planned') && !l.technique.notTechnique);
    const planned = un.filter((l) => l.state === 'planned');
    const nexts = nextToLearn(art!, learner, 5);
    return { text: [`${artName} 기술 ${scope.length}개 중 아직 배우지 않은 기술 ${un.length}개(학습 예정 ${planned.length}개 포함).`, ...(planned.length ? [`■ 내 커리큘럼에 예정: ${planned.slice(0, 8).map((l) => label(l.technique)).join(', ')}`] : []), `■ 먼저 배우기 좋은 기술: ${nexts.map((n) => `${label(n.technique)}(${n.why})`).join(' / ') || '수업 가능한 기록이 없습니다'}`, studied.length ? '' : '※ 학습 기록이 없어 전부 미학습으로 봅니다.'].filter(Boolean).join('\n'), lessonTechniqueIds: nexts.map((n) => n.technique.id) };
  }
  if (q === 'weakest') {
    const weak = scope.filter((l) => l.states.includes('weak')).sort((a, b) => (a.proficiency ?? 0) - (b.proficiency ?? 0));
    const lowPose = scope.filter((l) => l.pose && l.pose.latest < 60).sort((a, b) => a.pose!.latest - b.pose!.latest);
    if (!studied.length) return none('부족한 기술');
    const lines = [head];
    lines.push(weak.length ? `■ 학습 숙련도가 부족한 기술 ${weak.length}개 (수업·복습 기록 기준)` : '■ 학습 기록상 숙련도 부족으로 판단된 기술은 없습니다.');
    lines.push(...weak.slice(0, 6).map(line));
    lines.push(lowPose.length ? `■ 자세 점수가 낮은 기술 (카메라 측정 기준, 학습 숙련도와 별개)` : '■ 자세 점수가 낮은 기술: 측정 기록 없음 또는 60점 미만 없음');
    lines.push(...lowPose.slice(0, 4).map((l) => `- ${label(l.technique)} · 자세 점수 ${l.pose!.latest}점(최고 ${l.pose!.best ?? '-'}점, ${l.pose!.count}회)`));
    return { text: lines.join('\n'), lessonTechniqueIds: weak.slice(0, 3).map((l) => l.technique.id) };
  }
  if (q === 'improved') {
    const up = scope.filter((l) => l.states.includes('improving')).sort((a, b) => (b.proficiencyChange14d ?? 0) - (a.proficiencyChange14d ?? 0));
    if (!studied.length) return none('향상된 기술');
    return { text: up.length ? [`최근 14일 동안 학습 숙련도가 오른 ${where}기술:`, ...up.slice(0, 8).map((l) => `- ${label(l.technique)} · ${l.proficiencyChange14d! > 0 ? '+' : ''}${l.proficiencyChange14d} → ${l.proficiency}`)].join('\n') : `최근 14일 동안 학습 숙련도가 10 이상 오른 ${where}기술은 없습니다.`, lessonTechniqueIds: [] };
  }
  if (q === 'review') {
    const due = scope.filter((l) => l.states.includes('review_due')).sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''));
    if (!studied.length) return none('복습할 기술');
    return { text: due.length ? [`복습할 때가 된 ${where}기술 ${due.length}개 (마지막 학습 후 복습 간격이 지남):`, ...due.slice(0, 10).map((l) => `${line(l)} · 복습 예정일 ${l.nextReviewAt!.slice(0, 10)}`)].join('\n') : `지금 복습 예정일이 지난 ${where}기술은 없습니다.`, lessonTechniqueIds: due.slice(0, 4).map((l) => l.technique.id) };
  }
  if (q === 'combos') {
    if (!studied.length) return none('배운 기술로 만들 수 있는 콤보');
    const combos = combosFromLearned(art!, learner, index);
    if (!combos.length) return { text: `${head}\n배운 기술로 이어지는 콤보·셋업 기록(MARTIALDEX DB·내 콤보·공유 콤보)이 없습니다. 콤보를 새로 만들어 내지 않았습니다.`, lessonTechniqueIds: [] };
    return {
      text: [head, '■ 배운 기술로 연습할 수 있는 콤보·셋업 (기록된 것만)', ...combos.map((c) => `- ${c.sequence.name}: ${c.sequence.steps.map((s) => s.name).join(' → ')} · ${c.sequence.origin === 'my_combo' ? '내 콤보' : c.sequence.origin === 'shared_combo' ? '사용자 공유' : 'MARTIALDEX DB'}${c.missing.length ? ` · 미학습 기술 포함: ${c.missing.join(', ')}` : ' · 모두 배운 기술'}`)].join('\n'),
      lessonTechniqueIds: [],
    };
  }
  if (q === 'next') {
    const n = nextToLearn(art!, learner, 3);
    if (!n.length) return { text: `${artName}에서 다음에 배울 수업 가능한 기록을 찾지 못했습니다.`, lessonTechniqueIds: [] };
    return { text: [`다음으로 배우기 좋은 ${artName} 기술 (내 학습 기록·기술 연결·난이도 기준):`, ...n.map((x) => `- ${label(x.technique)} — ${x.why}`), studied.length ? '' : '※ 학습 기록이 없어 초급 기술부터 골랐습니다.'].filter(Boolean).join('\n'), lessonTechniqueIds: n.map((x) => x.technique.id) };
  }
  // analysis — 시나리오 A
  if (!studied.length) return none('실력');
  const count = (s: string) => scope.filter((l) => l.states.includes(s as never)).length;
  const weak = scope.filter((l) => l.states.includes('weak')).sort((a, b) => (a.proficiency ?? 0) - (b.proficiency ?? 0));
  const due = scope.filter((l) => l.states.includes('review_due'));
  const lowPose = scope.filter((l) => l.pose && l.pose.latest < 60);
  const next = nextToLearn(art!, learner, 2);
  const recommend = [...weak.slice(0, 2).map((l) => l.technique), ...due.filter((l) => !weak.includes(l)).slice(0, 1).map((l) => l.technique), ...next.slice(0, 1).map((n) => n.technique)];
  return {
    text: [
      head,
      `■ 현황: 학습 완료 ${count('learned')} · 학습 중 ${scope.filter((l) => l.state === 'learning').length} · 숙련도 부족 ${weak.length} · 복습 필요 ${due.length} · 향상 중 ${count('improving')} · 미학습 ${scope.filter((l) => l.state === 'not_started').length}`,
      weak.length ? `■ 부족한 부분 (근거)\n${weak.slice(0, 5).map(line).join('\n')}` : '■ 수업·복습 기록상 숙련도 부족으로 판단된 기술은 없습니다.',
      lowPose.length ? `■ 자세 측정에서 낮은 점수: ${lowPose.map((l) => `${label(l.technique)} ${l.pose!.latest}점`).join(', ')} (카메라 측정, 학습 숙련도와 별개)` : '■ 자세 측정: 기록 없음 또는 낮은 점수 없음',
      due.length ? `■ 복습 필요: ${due.slice(0, 6).map((l) => label(l.technique)).join(', ')}` : '',
      recommend.length ? `■ 다음 수업 추천: ${recommend.map(label).join(' → ')} (부족한 기술 → 복습 → 새 기술 순)` : '',
      '판단은 이 기기에 저장된 내 수업·연습·복습·자세 측정 기록만으로 했습니다. 기록이 적으면 정확하지 않을 수 있습니다.',
    ].filter(Boolean).join('\n'),
    lessonTechniqueIds: recommend.map((t) => t.id),
  };
}
