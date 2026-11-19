// Model runners for the MARTIALDEX self-AI server. The MODEL (qwen2.5:3b) and the
// RUNNER that executes it are separate: the server talks to a runner through one
// contract — status() / chat(request, onDelta) / cancel(requestId) — the same contract
// the Electron app uses (electron/selfAi.cjs), so the coach code does not change when
// the runner does.
//   ollama             — current runner (electron/selfAi.cjs; OLLAMA_HOST_URL, SELF_AI_MODEL)
//   openai-compatible  — any server with /v1/chat/completions streaming (llama.cpp's
//                        llama-server, vLLM …): SELF_AI_RUNNER_URL, SELF_AI_MODEL
// Results: { ok:true, text, model, evalCount, ms } | { ok:false, code, message, partial? }

const path = require('node:path');

function ollamaRunner() {
  const selfAi = require(path.join(__dirname, '../../electron/selfAi.cjs'));
  return { name: 'ollama', status: selfAi.status, chat: selfAi.chat, cancel: selfAi.cancel, model: selfAi.model };
}

const MAX_PREDICT = 900;
const FIRST_TOKEN_TIMEOUT_MS = 180000;
const IDLE_TIMEOUT_MS = 60000;

function openAiCompatibleRunner(baseUrl, modelName) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const inflight = new Map();
  const model = () => modelName || 'qwen2.5-3b-instruct';
  async function status() {
    try {
      const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(2500) });
      const j = await r.json();
      const models = (j.data || []).map((m) => m.id);
      // llama-server serves exactly one model, whatever its id; a multi-model server must have ours
      const ok = models.length === 1 || models.includes(model());
      return { ok, running: true, model: model(), models, reason: ok ? null : 'MODEL_MISSING' };
    } catch {
      return { ok: false, running: false, model: model(), models: [], reason: 'NOT_RUNNING' };
    }
  }
  async function chat(request, onDelta) {
    const messages = Array.isArray(request && request.messages) ? request.messages.filter((m) => m && typeof m.content === 'string') : [];
    if (!messages.length) return { ok: false, code: 'EMPTY', message: '대화 내용이 비어 있습니다.' };
    const st = await status();
    if (!st.ok) return { ok: false, code: st.reason === 'MODEL_MISSING' ? 'MODEL_MISSING' : 'NOT_RUNNING', message: st.reason === 'MODEL_MISSING' ? `모델 ${st.model}이(가) 모델 서버에 없습니다.` : '모델 서버가 실행 중이 아닙니다.' };
    const ctrl = new AbortController();
    const id = request.requestId ? String(request.requestId) : null;
    if (id) inflight.set(id, ctrl);
    const started = Date.now();
    let timer = setTimeout(() => ctrl.abort('timeout'), FIRST_TOKEN_TIMEOUT_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort('timeout'), IDLE_TIMEOUT_MS);
    };
    const body = {
      model: model(),
      messages,
      stream: true,
      temperature: typeof request.temperature === 'number' ? Math.min(Math.max(request.temperature, 0), 1) : 0.3,
      max_tokens: Math.min(Math.max(Number(request.maxTokens) || 600, 32), MAX_PREDICT),
      // same rule as the Ollama bridge: a repeat penalty for free text only
      ...(request.json ? { response_format: { type: 'json_object' } } : { frequency_penalty: 0.1 }),
    };
    let text = '';
    let evalCount = 0;
    try {
      const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!res.ok || !res.body) return { ok: false, code: 'BAD_RESPONSE', message: `모델 서버 응답 오류 (${res.status})` };
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        bump();
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let j;
          try {
            j = JSON.parse(data);
          } catch {
            continue;
          }
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) {
            text += d;
            evalCount++;
            if (onDelta) onDelta(d);
          }
          if (j.usage && j.usage.completion_tokens) evalCount = j.usage.completion_tokens;
        }
      }
    } catch {
      const reason = ctrl.signal.reason;
      if (reason === 'cancel') return { ok: false, code: 'CANCELLED', message: '요청을 취소했습니다.', partial: text };
      if (reason === 'timeout') return { ok: false, code: 'TIMEOUT', message: '모델 응답 시간이 너무 오래 걸립니다.', partial: text };
      return { ok: false, code: 'NOT_RUNNING', message: '모델 서버 연결이 끊어졌습니다.', partial: text };
    } finally {
      clearTimeout(timer);
      if (id) inflight.delete(id);
    }
    if (!text.trim()) return { ok: false, code: 'BAD_RESPONSE', message: '모델 서버가 빈 답변을 보냈습니다.' };
    return { ok: true, text, model: model(), evalCount, ms: Date.now() - started };
  }
  function cancel(requestId) {
    const c = inflight.get(requestId);
    if (!c) return false;
    c.abort('cancel');
    return true;
  }
  return { name: 'openai-compatible', status, chat, cancel, model };
}

function createRunner(env = process.env) {
  const kind = (env.SELF_AI_RUNNER || 'ollama').trim();
  if (kind === 'openai-compatible') {
    if (!env.SELF_AI_RUNNER_URL) throw new Error('SELF_AI_RUNNER_URL is required for SELF_AI_RUNNER=openai-compatible');
    return openAiCompatibleRunner(env.SELF_AI_RUNNER_URL, env.SELF_AI_MODEL);
  }
  return ollamaRunner();
}

module.exports = { createRunner, openAiCompatibleRunner, ollamaRunner };
