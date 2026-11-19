// A learner's question in the middle of a lesson ("지금 배우는 기술에서 상대가 방어하면
//어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘.") — answered about THE TECHNIQUE BEING
// TAUGHT, not about whatever the sentence happens to name:
//   1. MARTIALDEX records of that technique (code-written, word for word): recorded
//      transitions / follow-ups, counter & escape links, and the record's own sentences
//      that describe the opponent's reaction (a mistake like "상대가 다리를 회수함").
//   2. a web search aimed at that technique (its English name + art), when asked.
//   3. the local model only summarises those pages, with [n] citations.
// Lesson state (step, pending question, progress, records) is not touched here.
//
// Measured before (사용자 테스트 E): the question went to the lesson's data engine and the
// reply was the record's related-technique list ("관련 기술은 세 가지입니다 …").

import type { Technique } from '../../types';
import { relatedOf } from '../coachKnowledge/lookup';
import { cleanPosition } from '../coachLesson/concepts';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { resolveTechnique } from '../userTechniques/service';

const ART_EN: Record<string, string> = { boxing: 'boxing', kickboxing: 'kickboxing', 'muay-thai': 'muay thai', bjj: 'bjj', wrestling: 'wrestling', judo: 'judo', sambo: 'sambo', karate: 'karate', taekwondo: 'taekwondo', 'mixed-martial-arts': 'mma' };
// a sentence of the record that is about what the opponent does
const OPPONENT_ACTS = /상대(가|의|는)?[^.]{0,30}(빼|회수|방어|막|스프롤|밀어|돌|버티|반격|피하|빠져|잡|당기|누르|체중)/;
const DEFENSE_ASKED = /(방어|막으면|막히면|피하면|대응|카운터|역공|반격|빠져나가면|버티면)/;

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

export interface LessonTechniqueFacts {
  technique: Technique;
  /** Code-written lines, each MARTIALDEX data. */
  lines: string[];
  /** True when the records hold anything about the opponent's reaction / what comes next. */
  hasData: boolean;
}

export function lessonTechniqueFacts(t: Technique, index: KnowledgeIndex | null, question: string): LessonTechniqueFacts {
  const lines: string[] = [];
  const own = [t.name, t.koreanName ?? '', ...t.aliases].filter(Boolean);
  // "Armbar → Triangle": recorded transitions FROM this technique
  const transitions = t.transitions.filter((x) => x.includes('→') && own.some((n) => x.split('→')[0].trim().toLowerCase() === n.toLowerCase())).map((x) => x.split('→')[1].trim());
  let next: string[] = [];
  let reactions: string[] = [];
  try {
    const c = getTechniqueConnections(t);
    next = [...c.next, ...c.chain].map((x) => x.techniqueName);
    reactions = [...c.counter.map((x) => `${x.techniqueName}(카운터)`), ...c.escape.map((x) => `${x.techniqueName}(탈출)`)];
  } catch {
    /* no graph for this record */
  }
  const k = index ? gatherTechniqueKnowledge(t.id, index, { art: t.martialArt }) : null;
  const followUps = (k?.followUps ?? []).slice(0, 3).map((f) => resolveTechnique(f.techniqueId)?.name).filter((x): x is string => !!x);
  const p = t.posture;
  const opponent = [...(p?.steps ?? []), ...(p?.keyPoints ?? []), ...(p?.commonMistakes ?? [])].filter((x) => OPPONENT_ACTS.test(x)).slice(0, 4);
  const thenWhat = [...new Set([...transitions, ...next, ...followUps])].slice(0, 5);

  if (DEFENSE_ASKED.test(question) || opponent.length) {
    if (opponent.length) lines.push(`- 수업 기술 자료 중 상대의 반응을 다룬 문장: ${opponent.map((x) => `"${x.replace(/[.。]$/, '')}"`).join(' / ')}`);
  }
  if (thenWhat.length) lines.push(`- 이 기술에서 이어지는 기술(기록된 연결): ${thenWhat.join(', ')}`);
  if (reactions.length) lines.push(`- 상대의 대응으로 기록된 기술: ${reactions.slice(0, 4).join(', ')}`);
  if (t.defenses.length) lines.push(`- 기록된 방어: ${t.defenses.slice(0, 4).join(', ')}`);
  if (t.counters.length) lines.push(`- 기록된 카운터: ${t.counters.slice(0, 4).join(', ')}`);
  const hasData = lines.length > 0;
  if (!hasData) {
    const rel = relatedOf(t).slice(0, 3).map((r) => r.name);
    lines.push(`- MARTIALDEX 기록에는 ${label(t)}에 대해 상대가 방어할 때의 대응·연결 기술이 없습니다.${rel.length ? ` (관련 기술로만 묶인 기록: ${rel.join(', ')} — 대응 방법으로 기록된 것은 아님)` : ''}`);
  }
  const where = t.positions.filter((x) => !/자주 등장|노기/.test(x)).map(cleanPosition).slice(0, 2);
  if (where.length) lines.unshift(`- 수업 기술: ${label(t)} · 사용 상황: ${where.join(', ')}`);
  else lines.unshift(`- 수업 기술: ${label(t)}`);
  return { technique: t, lines, hasData };
}

/** Search aimed at the technique being taught (the question's words alone found nothing useful). */
export function lessonQuestionQueries(t: Technique, question: string): string[] {
  const art = ART_EN[t.martialArt] ?? t.martialArt.replace(/-/g, ' ');
  const asksDefense = DEFENSE_ASKED.test(question);
  // the attacker's side: what to do when the opponent defends (a "counter to X" page answers the defender instead)
  const name = t.name.toLowerCase();
  // "실제 선수들은 어떻게 활용해?": how it is used in fights, not a how-to
  if (!asksDefense && /(실제|실전|선수|경기|사례|활용)/.test(question)) return [`${name} ${art} used in fights`, `${name} ${art} fight breakdown`, `${t.koreanName ?? t.name} 실전 활용`];
  if (!asksDefense) return [`${name} ${art} technique details`, `${t.koreanName ?? t.name} 설명`];
  return [`${name} ${art} finishes when opponent sprawls or defends`, `${name} ${art} re-attack after defense`, `${t.koreanName ?? t.name} 방어 대응`];
}

/** Model prompt: summarise ONLY what the fetched pages say about the question, with [n]. */
export function lessonQuestionPrompt(facts: LessonTechniqueFacts, question: string, sourcesBlock: string): string {
  return [
    '너는 MARTIALDEX 수업 코치다. 학생이 수업 중에 질문했다. 한국어 존댓말로 답한다.',
    `지금 수업에서 배우는 기술: ${label(facts.technique)}`,
    `학생 질문: ${question}`,
    '아래 [검색 자료]에서 이 질문에 답하는 내용만 골라 3~4문장으로 요약한다.',
    '규칙: 각 문장 끝에 근거 자료 번호 [1]처럼 붙인다. 자료에 없는 내용, 선수 이름, 경기 사례를 만들지 않는다. 자료에 답이 없으면 "검색 자료에서 이 질문에 대한 답을 찾지 못했습니다."라고만 쓴다. 같은 내용을 반복하지 않는다. 링크를 쓰지 않는다.',
    `\n[검색 자료]\n${sourcesBlock}`,
  ].join('\n');
}
