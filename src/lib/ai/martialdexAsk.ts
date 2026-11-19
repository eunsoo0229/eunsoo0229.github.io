import type { Technique } from '../../types';
import type { CoachDialogContext } from '../coachKnowledge/questions';
import { runCoachTurn } from '../selfAi/coachAgent';
import { appCoachDeps } from '../selfAi/deps';
import type { CoachChatMessage } from '../selfAi/types';
import type { GroundingSource } from './types';

// "MARTIALDEX 자체 AI" in AiAskModal (헤더 "AI에게 묻기", 기술 그래프) — the SAME 자체 AI 코치 as
// /coach/chat and the lesson screen (selfAi/coachAgent.ts): code routing, MARTIALDEX DB, the
// learner's own records, self-hosted search (SearXNG — no Tavily), the local model only as the
// writer. 4차: this path used to be a separate, older one (coachKnowledge answer + Tavily), which
// is where "레슬링 솔로 드릴 훈련을 하고 싶어" got a list of other arts' techniques.
// Starting a lesson / opening a screen happens in /coach/chat (this modal has no such buttons):
// the answer says so.

const MAX_SOURCES = 5;

export interface MartialdexAskResult {
  text: string;
  sources: GroundingSource[];
  /** What the sources are / why there are none, shown under the answer. */
  webNote: string | null;
  context: CoachDialogContext | undefined;
  /** Kept on the chat message so later turns remember the topic. */
  coach: { techniqueIds?: string[]; turn?: import('../selfAi/types').TurnMeta; lessonProposal?: import('../selfAi/types').LessonProposal; research?: import('../selfAi/types').TurnResearchInfo; evidence?: Pick<import('../selfAi/types').CoachChatMessage, 'sources' | 'claims' | 'sourceConflicts' | 'model' | 'personalData' | 'guardNotes'> };
}

export async function askMartialdexWithWeb(input: { technique: Technique | null; question: string; context?: CoachDialogContext; history?: CoachChatMessage[] }): Promise<MartialdexAskResult> {
  // asked from a technique's page: the question is about that technique unless it names another
  const t = input.technique;
  const text = t && !input.question.includes(t.name) && !(t.koreanName && input.question.includes(t.koreanName)) ? `${t.koreanName ?? t.name} ${input.question}` : input.question;
  const out = await runCoachTurn({ text, history: input.history ?? [], martialArt: t?.martialArt ?? null, requestId: `ask-${Date.now()}` }, appCoachDeps());
  const m = out.message;
  const sources = [...(m.sources ?? []), ...(m.videos ?? [])].slice(0, MAX_SOURCES).map((s) => ({ title: s.title || s.source || s.url, uri: s.url }));
  const goChat = m.lessonProposal || m.action ? '\n\n수업 시작·화면 열기는 "AI 코치와 대화하기"(/coach/chat)에서 같은 질문으로 할 수 있습니다.' : '';
  const notes = m.guardNotes?.length ? `\n\n※ ${m.guardNotes.join(' ')}` : '';
  return {
    text: `${m.text}${notes}${goChat}`,
    sources,
    webNote: m.research?.searched ? (sources.length ? null : '검색했지만 결과가 없습니다.') : null,
    context: input.context,
    coach: { techniqueIds: m.techniqueIds, turn: m.turn, lessonProposal: m.lessonProposal, research: m.research, evidence: { sources: m.sources, claims: m.claims, sourceConflicts: m.sourceConflicts, model: m.model, personalData: m.personalData, guardNotes: m.guardNotes } },
  };
}
