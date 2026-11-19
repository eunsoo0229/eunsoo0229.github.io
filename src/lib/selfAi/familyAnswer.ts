// "레슬링 싱글렉이 뭐야?" — a question about a technique FAMILY (an official category),
// answered by code from MARTIALDEX data: the encyclopedia's own paragraph about the
// family, its records (grouped by the encyclopedia's sub-headings when it has them)
// and the records filed elsewhere in the art under the family's name (position,
// defence). Nothing is generated.

import type { Technique } from '../../types';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { josa } from '../coachLesson/text';
import { familyWord, type CategoryTopic } from '../knowledgeBase/topics';
import { getUnifiedAllTechniques } from '../userTechniques/service';

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

export function familyAnswerText(topic: CategoryTopic, artName: string): string {
  const lines: string[] = [];
  const subj = josa(topic.category, '은/는');
  lines.push(topic.paragraph ? `${subj} MARTIALDEX ${artName} 백과사전에서 이렇게 설명합니다: "${topic.paragraph}"` : `${subj} MARTIALDEX ${artName}의 기술 분류입니다. 이 분류에 대한 설명 문단은 기록에 없습니다.`);
  const grouped = new Set(topic.subcategories.flatMap((s) => s.techniques.map((t) => t.id)));
  lines.push(`■ ${topic.category} 기록 ${topic.members.length}개`);
  for (const s of topic.subcategories) lines.push(`- ${s.title}: ${s.techniques.map(label).join(', ')}`);
  const rest = topic.members.filter((t) => !grouped.has(t.id));
  if (rest.length) lines.push(`- ${topic.subcategories.length ? '그 밖의 기록' : '기록'}: ${rest.map(label).join(', ')}`);
  // the family's word in other categories of the art ("Single-Leg Position", "Single-Leg Down Defense")
  const word = familyWord(topic.members);
  if (word) {
    const outside = getUnifiedAllTechniques().filter((t) => (t.martialArts ?? [t.martialArt]).includes(topic.art) && !topic.members.some((m) => m.id === t.id) && new RegExp(`^${word}\\b`, 'i').test(t.name) && lessonReadiness(t).level !== 'insufficient');
    if (outside.length) lines.push(`■ 다른 분류에 있는 관련 기록: ${outside.map((t) => `${label(t)} (${t.categoryByArt?.[topic.art] ?? t.category})`).join(', ')}`);
  }
  lines.push(`각 기술의 자세·핵심 포인트는 기술 이름으로 다시 물어보시거나("하이 싱글 자세 알려 줘"), "${artName} ${topic.category} 배우고 싶어"라고 하시면 이 기록들로 수업 계획을 만듭니다.`);
  return lines.join('\n');
}
