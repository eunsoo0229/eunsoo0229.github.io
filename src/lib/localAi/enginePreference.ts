import type { AiEngineChoice } from './types';

// 생성형 AI 엔진 선택 (설정 > AI 엔진). The default is the local engine: Gemini (an
// external paid API) runs only after the user selects it here or explicitly picks it
// in a feature (AI에게 질문하기 engine radio, the lesson's coach picker). A local failure
// is reported as a local failure — it never switches to Gemini.

const KEY = 'martialdex:ai-engine';
export const AI_ENGINE_EVENT = 'martialdex:ai-engine-changed';

export function getAiEngine(): AiEngineChoice {
  try {
    return window.localStorage.getItem(KEY) === 'gemini' ? 'gemini' : 'local';
  } catch {
    return 'local';
  }
}

export function setAiEngine(choice: AiEngineChoice): void {
  try {
    window.localStorage.setItem(KEY, choice);
  } catch {
    // storage unavailable — stays 'local' (the safe default)
  }
  try {
    window.dispatchEvent(new CustomEvent(AI_ENGINE_EVENT, { detail: choice }));
  } catch {
    /* no window */
  }
}
