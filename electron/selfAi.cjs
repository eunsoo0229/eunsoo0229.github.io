// MARTIALDEX 자체 AI — conversational chat with a local open-source model
// (Ollama on 127.0.0.1), streamed to the renderer. Main process only.
//
// Separate from ollama.cjs on purpose: that module rewords short data-grounded
// coach answers (non-streaming, ≤320 tokens) and its contract is covered by
// existing tests. This one serves the free conversation coach: longer context,
// streamed tokens, cancel, and model choice from SELF_AI_MODEL.
// Never falls back to Gemini — a local failure is returned as a failure.

const HOST = (process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const DEFAULT_MODEL = 'qwen2.5:3b';
const MODEL_NAME = /^[\w.\-:/]{1,80}$/;
const REQUEST_ID = /^[\w-]{1,64}$/;
const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 24000;
const MAX_PREDICT = 900;
/** One-shot structured (JSON) feature calls — curriculum / plans — need longer outputs than chat. */
const MAX_PREDICT_JSON = 1536;
const FIRST_TOKEN_TIMEOUT_MS = 180000; // model load on an 8GB Intel Mac can take ~30s+, prompt eval longer
const IDLE_TIMEOUT_MS = 60000;

const inflight = new Map(); // requestId -> AbortController

function model() {
  const m = (process.env.SELF_AI_MODEL || '').trim();
  if (MODEL_NAME.test(m)) return m;
  // the model chosen in 설정 > 로컬 AI 엔진 (qwen2.5:3b unless the user picked a smaller one)
  try {
    return require('./localEngine.cjs').selectedModel();
  } catch {
    return DEFAULT_MODEL;
  }
}

/** Context window sized to the request (Korean ≈ 1.5 chars/token) — 4096 for chat, up to 8192 for long one-shot feature prompts. */
function contextFor(messages, numPredict) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const need = Math.ceil(chars / 1.5) + numPredict + 256;
  return Math.min(8192, Math.max(4096, Math.ceil(need / 1024) * 1024));
}

async function status() {
  const want = model();
  try {
    const r = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    const models = (j.models || []).map((m) => m.name);
    return { ok: models.includes(want), running: true, model: want, models, reason: models.includes(want) ? null : 'MODEL_MISSING' };
  } catch {
    return { ok: false, running: false, model: want, models: [], reason: 'NOT_RUNNING' };
  }
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const out = messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-MAX_MESSAGES);
  // keep the system message, trim the oldest turns until under the char budget
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (total > MAX_TOTAL_CHARS && out.length > 2) {
    const idx = out[0].role === 'system' ? 1 : 0;
    total -= out[idx].content.length;
    out.splice(idx, 1);
  }
  return out.length ? out : null;
}

/**
 * chat({ requestId, messages, json?, maxTokens?, temperature? }, onDelta)
 * → { ok:true, text, model, evalCount, ms } | { ok:false, code, message }
 * codes: EMPTY · NOT_RUNNING · MODEL_MISSING · TIMEOUT · CANCELLED · BAD_RESPONSE
 */
async function chat(request, onDelta) {
  const messages = sanitizeMessages(request && request.messages);
  if (!messages) return { ok: false, code: 'EMPTY', message: '대화 내용이 비어 있습니다.' };
  const st = await status();
  if (!st.ok) {
    return st.reason === 'MODEL_MISSING'
      ? { ok: false, code: 'MODEL_MISSING', message: `로컬 모델 ${st.model}이(가) 설치되어 있지 않습니다 (ollama pull ${st.model}).` }
      : { ok: false, code: 'NOT_RUNNING', message: '로컬 AI(Ollama)가 실행 중이 아닙니다.' };
  }
  const id = request && REQUEST_ID.test(String(request.requestId || '')) ? request.requestId : null;
  const ctrl = new AbortController();
  if (id) inflight.set(id, ctrl);
  const started = Date.now();
  let timer = setTimeout(() => ctrl.abort('timeout'), FIRST_TOKEN_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort('timeout'), IDLE_TIMEOUT_MS);
  };
  const numPredict = Math.min(Math.max(Number(request.maxTokens) || 600, 32), request.json ? MAX_PREDICT_JSON : MAX_PREDICT);
  const body = {
    model: st.model,
    messages,
    stream: true,
    keep_alive: '30m',
    think: false,
    options: {
      temperature: typeof request.temperature === 'number' ? Math.min(Math.max(request.temperature, 0), 1) : 0.3,
      num_ctx: contextFor(messages, numPredict),
      // Free text: small models loop on a phrase ("이 콤비네이션은 … 사용됩니다" ×5) — a mild penalty
      // over the recent window. NOT for JSON extraction: copying a quote verbatim repeats the
      // source's tokens, and with the penalty qwen2.5:3b's grounded quotes fell from 4/4 to 0/3
      // (data/audit/self-ai/local-models-round3-*.json).
      ...(request.json ? {} : { repeat_penalty: 1.1, repeat_last_n: 256 }),
      num_predict: numPredict,
    },
  };
  if (request.json) body.format = 'json';
  let text = '';
  let evalCount = 0;
  try {
    let res = await fetch(`${HOST}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal });
    if (res.status === 400) {
      // models without a thinking switch reject `think`
      delete body.think;
      res = await fetch(`${HOST}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal });
    }
    if (!res.ok || !res.body) return { ok: false, code: 'BAD_RESPONSE', message: `로컬 AI 응답 오류 (${res.status})` };
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      bump();
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.error) return { ok: false, code: 'BAD_RESPONSE', message: String(j.error) };
        const d = j.message && typeof j.message.content === 'string' ? j.message.content : '';
        if (d) {
          text += d;
          if (onDelta) onDelta(d);
        }
        if (j.done) evalCount = Number(j.eval_count) || 0;
      }
    }
  } catch {
    const reason = ctrl.signal.reason;
    if (reason === 'cancel') return { ok: false, code: 'CANCELLED', message: '요청을 취소했습니다.', partial: text };
    if (reason === 'timeout') return { ok: false, code: 'TIMEOUT', message: '로컬 AI 응답 시간이 너무 오래 걸립니다.', partial: text };
    return { ok: false, code: 'NOT_RUNNING', message: '로컬 AI 연결이 끊어졌습니다.', partial: text };
  } finally {
    clearTimeout(timer);
    if (id) inflight.delete(id);
  }
  if (!text.trim()) return { ok: false, code: 'BAD_RESPONSE', message: '로컬 AI가 빈 답변을 보냈습니다.' };
  return { ok: true, text, model: st.model, evalCount, ms: Date.now() - started };
}

function cancel(requestId) {
  const c = inflight.get(requestId);
  if (!c) return false;
  c.abort('cancel');
  return true;
}

module.exports = { chat, cancel, status, model };
