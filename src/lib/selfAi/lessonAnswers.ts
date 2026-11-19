// Code-written answers to lesson questions that the records answer directly —
// "배우기 전에 알아야 할 게 있어?", "연결되는 다른 기술 알려 줘", "지금까지 배운 내용 복습",
// "다른 기술과 비교해 줘" (with no second technique named). MARTIALDEX data only; what
// the records do not have is said plainly.

import type { Technique } from '../../types';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { getUnifiedAllTechniques, resolveTechnique } from '../userTechniques/service';
import { categoryTopic, familyWord } from '../knowledgeBase/topics';
import type { LessonSnapshot } from './lessonSession';

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);
const categoryIn = (t: Technique, art: string) => t.categoryByArt?.[art] ?? t.category;

function connections(t: Technique) {
  try {
    return getTechniqueConnections(t);
  } catch {
    return null;
  }
}

/** The family's position record ("Single-Leg Position" for High Single), when the family has one. */
function familyPosition(t: Technique, art: string): Technique | null {
  const topic = categoryTopic(art, categoryIn(t, art));
  const word = topic ? familyWord(topic.members) : null;
  if (!word) return null;
  return getUnifiedAllTechniques().find((x) => x.id !== t.id && (x.martialArts ?? [x.martialArt]).includes(art) && /position/i.test(x.name) && new RegExp(`^${word}\\b`, 'i').test(x.name)) ?? null;
}

export function prerequisiteAnswer(t: Technique, art: string): string {
  const lines = [`■ ${label(t)}을(를) 배우기 전에`];
  const pre = (connections(t)?.prerequisite ?? []).map((x) => resolveTechnique(x.techniqueId)).filter((x): x is Technique => !!x);
  if (pre.length) lines.push(`- 기술 연결 기록의 선행 기술: ${pre.slice(0, 4).map(label).join(', ')}`);
  const pos = familyPosition(t, art);
  if (pos) lines.push(`- 같은 계열의 시작 자세: ${label(pos)} — ${pos.posture?.overview ?? '자세 기록 참고'}`);
  const start = t.posture?.startingPosition;
  if (start) lines.push(`- 이 기술 기록의 시작 자세: ${start}`);
  const steps = t.posture?.steps?.[0];
  if (!pre.length && !pos && !start && steps) lines.push(`- 기록의 첫 단계: ${steps}`);
  if (lines.length === 1) lines.push('- MARTIALDEX 기록에 이 기술의 선행 기술·시작 자세가 없습니다.');
  return lines.join('\n');
}

export function relatedAnswer(t: Technique, art: string, index: KnowledgeIndex | null): string {
  const lines = [`■ ${label(t)}과(와) 연결되는 기술 (MARTIALDEX 기록)`];
  const c = connections(t);
  const name = (id: string) => resolveTechnique(id);
  const list = (xs: { techniqueId: string }[]) => [...new Set(xs.map((x) => name(x.techniqueId)).filter((x): x is Technique => !!x).map(label))];
  if (c?.next.length || c?.chain.length) lines.push(`- 이어지는 기술: ${list([...(c?.next ?? []), ...(c?.chain ?? [])]).slice(0, 6).join(', ')}`);
  if (c?.counter.length) lines.push(`- 상대의 카운터로 기록된 기술: ${list(c.counter).slice(0, 4).join(', ')}`);
  if (c?.escape.length) lines.push(`- 상대의 탈출로 기록된 기술: ${list(c.escape).slice(0, 4).join(', ')}`);
  const k = index ? gatherTechniqueKnowledge(t.id, index, { art }) : null;
  const seqs = [...(k?.setupsInto ?? []), ...(k?.combos.map((x) => x.sequence) ?? [])].slice(0, 3);
  if (seqs.length) lines.push(`- 기록된 셋업·콤보: ${seqs.map((s) => `${s.name} (${s.steps.map((x) => x.name).join(' → ')})`).join(' / ')}`);
  const transitions = t.transitions.filter((x) => x.includes('→')).slice(0, 3);
  if (transitions.length) lines.push(`- 기록의 전환 흐름: ${transitions.join(' / ')}`);
  const topic = categoryTopic(art, categoryIn(t, art));
  if (topic && topic.members.length > 1) lines.push(`- 같은 분류(${topic.category})의 다른 기록: ${topic.members.filter((x) => x.id !== t.id).slice(0, 6).map(label).join(', ')}${topic.members.length > 7 ? ' …' : ''}`);
  if (lines.length === 1) lines.push('- MARTIALDEX 기록에 이 기술과 연결된 기술이 없습니다.');
  lines.push('이 중에서 수업에 더 넣고 싶은 기술이 있으면 "연결되는 기술도 배우고 싶어"라고 말씀해 주세요. 추가 전에 먼저 확인을 받습니다.');
  return lines.join('\n');
}

export function reviewAnswer(s: LessonSnapshot, understanding: Record<string, string>): string {
  const taught = [...s.learned, s.current];
  const STATUS: Record<string, string> = { understood: '이해함', partial: '일부 이해', misunderstood: '다시 볼 부분 있음', unknown: '아직 확인 전' };
  const lines = ['■ 지금까지 배운 내용 (MARTIALDEX 기록의 핵심 포인트)'];
  for (const t of taught) {
    const pts = (t.posture?.keyPoints ?? []).slice(0, 2);
    const u = understanding[t.id];
    lines.push(`- ${label(t)}${u ? ` · 수업 판정: ${STATUS[u] ?? u}` : ''}${pts.length ? `\n  핵심: ${pts.join(' / ')}` : '\n  핵심 포인트 기록 없음'}`);
  }
  lines.push(`스스로 확인해 보세요: ${label(s.current)}의 핵심 포인트 한 가지를 말로 설명할 수 있나요? (이 복습은 수업 진도에 영향을 주지 않습니다. 수업 끝의 복습은 그대로 진행됩니다.)`);
  return lines.join('\n');
}

/** "다른 기술과 비교해 줘" with no second technique: offer the closest records to compare with. */
export function compareTargetAnswer(t: Technique, art: string): string {
  const topic = categoryTopic(art, categoryIn(t, art));
  const same = (connections(t)?.samePosition ?? []).map((x) => resolveTechnique(x.techniqueId)).filter((x): x is Technique => !!x);
  const pool = [...new Map([...(topic?.members ?? []), ...same].filter((x) => x.id !== t.id && lessonReadiness(x).level !== 'insufficient').map((x) => [x.id, x])).values()].slice(0, 5);
  if (!pool.length) return `${label(t)}과(와) 비교할 같은 분류의 기록이 없습니다. 비교할 기술 이름을 함께 말씀해 주세요.`;
  return `어떤 기술과 비교할까요? 같은 분류·같은 상황의 기록: ${pool.map(label).join(', ')}.\n예: "${label(t)}과(와) ${pool[0].name} 비교해 줘"`;
}
