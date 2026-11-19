import type { AskAiRequest, AskAiResult } from '../ai/types';
import { selfAiBackend } from '../selfAi/transport';
import type { SelfAiMessage } from '../selfAi/types';
import { engineNotReadyMessage, getEngineStatus, requestLocalAiSetup, startEngine } from './engineControl';

// LocalAIProvider — every generative feature's request (aiProvider.ask) answered by the
// local engine of this device, with the SAME prompt on every platform: the request's own
// system instruction + data context + history + question, unchanged. Only the transport
// differs (selfAi/transport: Electron IPC → Ollama, Android plugin → llama.cpp, or the
// self-AI server the user connected). Failures stay local failures — no Gemini fallback.

const LOCAL_SYSTEM_SUFFIX = '\n\n반드시 한국어로 답하세요. 제공된 자료에 없는 내용은 지어내지 말고 모른다고 말하세요.';

/** Inputs the text-only local model cannot handle — refused with a clear reason instead of answered blindly. */
export function unsupportedLocalInput(req: AskAiRequest): string | null {
  const media = [...(req.imageParts ?? []), ...(req.mediaParts ?? []).filter((p) => p.kind !== 'text')];
  if (media.some((p) => 'mimeType' in p && p.mimeType.startsWith('audio/'))) return '음성';
  if (media.some((p) => 'kind' in p && p.kind === 'youtube')) return '영상';
  if (media.length > 0) return '이미지';
  if (req.useSearchGrounding) return '실시간 웹 검색 근거';
  return null;
}

export function toLocalMessages(req: AskAiRequest): SelfAiMessage[] {
  const textParts = (req.mediaParts ?? []).flatMap((p) => (p.kind === 'text' ? [p.text] : []));
  const system = [req.systemInstruction, req.contextText ? `[MARTIALDEX 자료]\n${req.contextText}` : ''].filter(Boolean).join('\n\n') + LOCAL_SYSTEM_SUFFIX;
  const history: SelfAiMessage[] = req.history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }));
  const question = textParts.length ? `${req.question}\n\n${textParts.join('\n')}` : req.question;
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
}

let seq = 0;

export async function askLocal(req: AskAiRequest, onDelta?: (d: string) => void): Promise<AskAiResult> {
  const missing = unsupportedLocalInput(req);
  if (missing) {
    return {
      ok: false,
      code: 'LOCAL_UNSUPPORTED_INPUT',
      message: `이 기능에는 ${missing} 처리가 필요해 로컬 AI(텍스트 전용 Qwen 모델)로는 할 수 없습니다. 설정 > AI 엔진에서 Gemini를 직접 선택한 경우에만 사용할 수 있습니다.`,
    };
  }
  const backend = selfAiBackend();
  if (backend.kind === 'none') {
    const s = await getEngineStatus();
    return { ok: false, code: 'LOCAL_NOT_READY', message: engineNotReadyMessage(s) };
  }
  const json = req.responseFormat === 'json';
  const send = () =>
    backend.chat(
      {
        requestId: `ask-${Date.now().toString(36)}-${(seq++).toString(36)}`,
        messages: toLocalMessages(req),
        json,
        maxTokens: req.maxOutputTokens ?? (json ? 1200 : 700),
        temperature: req.temperature,
      },
      onDelta,
    );
  let r = await send();
  if (!r.ok && (r.code === 'NOT_RUNNING' || r.code === 'MODEL_MISSING') && backend.kind !== 'server') {
    // engine off but the model is installed → start it in the app and retry once (approval was given at download).
    // Model not installed → the first-use consent screen; nothing downloads without the user's button.
    const st = await getEngineStatus();
    if (st.modelInstalled || (st.platform === 'electron' && st.phase === 'off' && st.binary)) {
      const started = await startEngine();
      if (started.ok) r = await send();
      else if (started.code === 'MODEL_MISSING') requestLocalAiSetup('model_missing');
    } else if (!st.modelInstalled && st.phase !== 'unsupported') {
      requestLocalAiSetup('model_missing');
    }
  }
  if (r.ok) return { ok: true, text: r.text };
  switch (r.code) {
    case 'NOT_RUNNING':
    case 'MODEL_MISSING':
    case 'UNSUPPORTED': {
      if (backend.kind === 'server') return { ok: false, code: 'LOCAL_NOT_READY', message: r.message };
      return { ok: false, code: 'LOCAL_NOT_READY', message: engineNotReadyMessage(await getEngineStatus()) };
    }
    case 'TIMEOUT':
      return { ok: false, code: 'TIMEOUT', message: r.message };
    case 'CANCELLED':
      return { ok: false, code: 'CANCELLED', message: r.message };
    case 'UNAUTHORIZED':
      return { ok: false, code: 'UNAUTHORIZED', message: r.message };
    case 'EMPTY':
    case 'BAD_RESPONSE':
      return { ok: false, code: 'EMPTY_RESPONSE', message: r.message };
    default:
      return { ok: false, code: 'UNKNOWN', message: r.message };
  }
}
