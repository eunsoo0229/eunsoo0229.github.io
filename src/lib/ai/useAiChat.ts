import { useCallback, useRef, useState } from 'react';
import { aiProvider } from './provider';
import { askMartialdexWithWeb } from './martialdexAsk';
import type { CoachDialogContext } from '../coachKnowledge/questions';
import type { Technique } from '../../types';
import { trimHistoryForRequest, useChatSession } from './chatStore';
import type { AiErrorCode, ChatMessage } from './types';
import type { CoachChatMessage } from '../selfAi/types';
import { recordAiQuestion } from '../aiHistory/service';
import type { AiHistoryFeature } from '../aiHistory/types';

export interface UseAiChatOptions {
  sessionKey: string;
  systemInstruction: string;
  contextText: string;
  /** AI 질문 기록에 남길 메타데이터 — 없으면(예: 향후 다른 AI 채팅 화면) 그냥 기록하지 않는다. */
  historyMeta?: {
    feature: AiHistoryFeature;
    relatedTechniqueId?: string | null;
    relatedCurriculumId?: string | null;
  };
  /** 'gemini' (default) or 'martialdex' — MARTIALDEX 자체 AI 코치 (selfAi/coachAgent via martialdexAsk.ts; self-hosted search, no Tavily). */
  engine?: AiEngine;
  /** The technique the question is about — the own AI's focus ('martialdex' engine only). */
  technique?: Technique | null;
}

export type AiEngine = 'gemini' | 'martialdex';

export interface AiChatError {
  code: AiErrorCode;
  message: string;
}

// If this exact question was already asked earlier in the same session,
// return the answer that followed it instead of making a fresh request —
// covers both "sent the same thing twice by accident" and "scrolled up and
// asked it again", without spending another free-tier call either way.
function findCachedAnswer(messages: ChatMessage[], question: string): string | null {
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === 'user' && messages[i].text.trim() === question) {
      const next = messages[i + 1];
      if (next?.role === 'model') return next.text;
    }
  }
  return null;
}

export function useAiChat({ sessionKey, systemInstruction, contextText, historyMeta, engine, technique = null }: UseAiChatOptions) {
  const { messages, mutate, clear } = useChatSession(sessionKey);
  // the own AI's dialog context ("그거" → the last named technique), per chat session
  const dialogRef = useRef<{ key: string; context: CoachDialogContext | undefined }>({ key: sessionKey, context: undefined });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AiChatError | null>(null);
  const inFlightRef = useRef(false);

  const ask = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || inFlightRef.current) return;

      const cached = findCachedAnswer(messages, question);
      if (cached) {
        setError(null);
        mutate((prev) => [...prev, { role: 'user', text: question }, { role: 'model', text: cached }]);
        return;
      }

      inFlightRef.current = true;
      setLoading(true);
      setError(null);
      const history = trimHistoryForRequest(messages);
      mutate((prev) => [...prev, { role: 'user', text: question }]);

      if (engine === 'martialdex') {
        if (dialogRef.current.key !== sessionKey) dialogRef.current = { key: sessionKey, context: undefined };
        try {
          // the conversation so far, as the coach's memory sees it (topics, offers) — this modal used to send none
          const past: CoachChatMessage[] = messages.map((m, i) => ({ id: `m${i}`, createdAt: '', role: m.role === 'model' ? 'assistant' : 'user', text: m.text, ...(m.coach?.techniqueIds ? { techniqueIds: m.coach.techniqueIds } : {}), ...(m.coach?.turn ? { turn: m.coach.turn } : {}), ...(m.coach?.lessonProposal ? { lessonProposal: m.coach.lessonProposal } : {}), ...(m.coach?.research ? { research: m.coach.research } : {}) }));
          const r = await askMartialdexWithWeb({ technique, question, context: dialogRef.current.context, history: past });
          dialogRef.current.context = r.context;
          mutate((prev) => [...prev, { role: 'model', text: r.text, sources: r.sources, webNote: r.webNote, coach: r.coach }]);
          if (historyMeta) {
            void recordAiQuestion({ feature: historyMeta.feature, question, answer: r.text, relatedTechniqueId: historyMeta.relatedTechniqueId, relatedCurriculumId: historyMeta.relatedCurriculumId });
          }
        } catch {
          setError({ code: 'UNKNOWN', message: 'MARTIALDEX AI 답변을 만들지 못했습니다.' });
        }
        setLoading(false);
        inFlightRef.current = false;
        return;
      }

      // 'gemini' here is the user's explicit pick in the modal; no engine → 설정 > AI 엔진 (local by default)
      const result = await aiProvider.ask({ systemInstruction, contextText, history, question, engine: engine === 'gemini' ? 'gemini' : undefined });

      if (result.ok) {
        mutate((prev) => [...prev, { role: 'model', text: result.text }]);
        if (historyMeta) {
          void recordAiQuestion({
            feature: historyMeta.feature,
            question,
            answer: result.text,
            relatedTechniqueId: historyMeta.relatedTechniqueId,
            relatedCurriculumId: historyMeta.relatedCurriculumId,
          });
        }
      } else {
        setError({ code: result.code, message: result.message });
      }
      setLoading(false);
      inFlightRef.current = false;
    },
    [messages, mutate, systemInstruction, contextText, historyMeta, engine, technique, sessionKey]
  );

  const clearAll = useCallback(() => {
    setError(null);
    dialogRef.current = { key: sessionKey, context: undefined };
    clear();
  }, [clear, sessionKey]);

  return { messages, loading, error, ask, clear: clearAll };
}
