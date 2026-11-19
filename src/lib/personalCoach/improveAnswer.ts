// "이 기술을 더 잘하려면 내가 뭘 연습해야 해?" — from the learner's own records of THIS technique
// (learning state, learning proficiency, pose score, the lesson concepts not yet understood) and the
// MARTIALDEX links around it (prerequisites not learned yet, the solo drill, the learner's combos
// with it). Code only; answers inside a lesson leave the lesson unchanged.

import type { Technique } from '../../types';
import type { LessonLogEntry } from '../coachLesson/lessonLog';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { drillPlanFor } from '../soloDrill/moves';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { getPoseAnalysisConfig } from '../poseAnalysis/poseAnalysisConfig';
import { LEARNING_STATE_LABEL, type TechniqueLearning } from './learnerModel';

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

export function improveAnswer(t: Technique, learner: TechniqueLearning[], logs: LessonLogEntry[], index: KnowledgeIndex | null): string {
  const id = canonicalTechniqueId(t.id);
  const me = learner.find((l) => canonicalTechniqueId(l.technique.id) === id);
  const lines = [`■ ${label(t)} — 내 기록`];
  if (!me || me.state === 'not_started' || me.state === 'planned') lines.push('- 이 기술의 학습 기록이 아직 없습니다(지금 수업이 첫 기록이 됩니다).');
  else {
    lines.push(`- 학습 상태: ${me.states.map((s) => LEARNING_STATE_LABEL[s]).join(', ')} · 학습 숙련도 ${me.proficiency ?? '-'}${me.evidence.length ? ` (${me.evidence.join(', ')})` : ''}`);
    lines.push(me.pose ? `- 자세 점수(카메라 측정): 최근 ${me.pose.latest}점 · 최고 ${me.pose.best ?? '-'}점 · ${me.pose.count}회` : '- 자세 점수: 측정 기록 없음');
  }
  // concepts the lesson grader marked not understood, latest lesson first
  const weakConcepts = [...logs]
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
    .flatMap((l) => l.techniques.filter((x) => x.techniqueId && canonicalTechniqueId(x.techniqueId) === id).flatMap((x) => x.concepts.filter((c) => c.status === 'weak' || c.status === 'partial').map((c) => c.label)));
  const practice: string[] = [];
  if (weakConcepts.length) practice.push(`지난 수업에서 아직 확인되지 않은 포인트: ${[...new Set(weakConcepts)].slice(0, 3).join(', ')} — 이 포인트를 천천히 반복`);
  let conn: ReturnType<typeof getTechniqueConnections> | null = null;
  try {
    conn = getTechniqueConnections(t);
  } catch {
    conn = null;
  }
  const notLearnedPre = (conn?.prerequisite ?? []).filter((p) => {
    const l = learner.find((x) => canonicalTechniqueId(x.technique.id) === canonicalTechniqueId(p.techniqueId));
    return !l || l.state === 'not_started' || l.state === 'planned';
  });
  if (notLearnedPre.length) practice.push(`아직 배우지 않은 선행 기술: ${notLearnedPre.slice(0, 3).map((p) => p.techniqueName).join(', ')}`);
  const drill = drillPlanFor(t);
  if (drill) practice.push(`솔로 드릴(구령): 이 기술이 포함된 ${drill.group === 'ground' ? '그라운드' : '스탠딩'} 드릴로 반응 속도 연습`);
  const mine = index?.sequences.filter((s) => s.origin === 'my_combo' && s.steps.some((x) => canonicalTechniqueId(x.techniqueId) === id)) ?? [];
  if (mine.length) practice.push(`내 콤보에서 연결 연습: ${mine.slice(0, 2).map((s) => `${s.name}(${s.steps.map((x) => x.name).join(' → ')})`).join(' / ')}`);
  if ((t.posture?.keyPoints ?? []).length) practice.push(`핵심 포인트: ${t.posture!.keyPoints!.slice(0, 2).join(' / ')}`);
  if (getPoseAnalysisConfig(t.id)?.supported) practice.push(`자세 확인: 카메라 자세 측정이 가능한 기술입니다("${t.koreanName ?? t.name} 자세 확인해 줘")`);
  lines.push('■ 연습 추천 (내 기록과 MARTIALDEX 기록 기준)', ...(practice.length ? practice.map((p) => `- ${p}`) : ['- 기록에서 근거 있는 추천을 찾지 못했습니다.']));
  return lines.join('\n');
}
