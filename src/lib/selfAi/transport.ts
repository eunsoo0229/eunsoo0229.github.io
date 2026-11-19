// Where the 자체 AI runs for this client — one contract for every platform:
//   electron : the desktop app's own main process (IPC: selfai:* / research:*)
//   server   : a MARTIALDEX self-AI server (server/self-ai/server.cjs) the user connected
//              in settings — Android, web, or a desktop without a local model
//   none     : neither — every call returns UNSUPPORTED (the coach then says it could
//              not search / could not use the model; never a different model)
// The coach, lesson and research code above this file do not know which one it is.

import type { PersonName, ResearchOutcome, ResearchRequest } from '../selfResearch/types';
import type { SelfAiChatRequest, SelfAiChatResult, SelfAiErrorCode } from './types';
import { androidEngineAvailable, LocalLlm } from '../localAi/engineControl';
import { deviceResearchBackend, deviceResearchSupported } from '../selfResearch/deviceBackend';

export interface SelfAiServerConfig {
  url: string;
  token: string;
}

const KEY = 'martialdex:self-ai-server';

export function getServerConfig(): SelfAiServerConfig | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const c = JSON.parse(raw) as SelfAiServerConfig;
      if (c && /^https?:\/\//.test(c.url) && c.token) return { url: c.url.replace(/\/+$/, ''), token: c.token };
    }
  } catch {
    /* unreadable */
  }
  return null;
}

export function setServerConfig(c: SelfAiServerConfig | null): void {
  if (c) localStorage.setItem(KEY, JSON.stringify({ url: c.url.trim().replace(/\/+$/, ''), token: c.token.trim() }));
  else localStorage.removeItem(KEY);
}

export type BackendKind = 'electron' | 'android' | 'server' | 'none';

export interface ModelStatus {
  ok: boolean;
  running: boolean;
  model: string | null;
  reason?: string | null;
}

export interface SelfAiBackend {
  kind: BackendKind;
  chat: (req: SelfAiChatRequest, onDelta?: (d: string) => void) => Promise<SelfAiChatResult>;
  cancel: (requestId: string) => Promise<boolean>;
  modelStatus: () => Promise<ModelStatus | null>;
  research: {
    available: boolean;
    status: () => Promise<{ ok: boolean; url: string | null; disabled?: boolean }>;
    search: (req: ResearchRequest) => Promise<ResearchOutcome>;
    entity: (name: string) => Promise<PersonName>;
  };
}

const UNSUPPORTED_MODEL = '이 기기에서는 로컬 AI 모델을 실행할 수 없습니다. 자체 AI 서버를 연결하거나 데스크톱 앱에서 사용해 주세요.';
const UNSUPPORTED_SEARCH = '이 기기에서는 자체 검색 서버를 사용할 수 없습니다. 자체 AI 서버를 연결하거나 데스크톱 앱에서 사용해 주세요.';

/** Server waits (queue position, model loading) are announced as a window event for status lines. */
export const WAIT_EVENT = 'martialdex:self-ai-wait';
const announce = (detail: { requestId: string; kind: 'queued' | 'waiting' | 'started'; position?: number; seconds?: number }) => {
  try {
    window.dispatchEvent(new CustomEvent(WAIT_EVENT, { detail }));
  } catch {
    /* no window */
  }
};

function serverBackend(c: SelfAiServerConfig): SelfAiBackend {
  const headers = { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' };
  const unreachable = '자체 AI 서버에 연결할 수 없습니다 (서버가 꺼져 있거나 주소가 다릅니다).';
  async function post<T>(path: string, body: unknown, fallback: (status: number, j: { message?: string; code?: string } | null) => T): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${c.url}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    } catch {
      return fallback(0, null);
    }
    const j = await res.json().catch(() => null);
    return res.ok ? (j as T) : fallback(res.status, j);
  }
  const authMessage = (status: number) => (status === 401 ? '자체 AI 서버 접근 토큰이 올바르지 않습니다. 설정에서 토큰을 확인해 주세요.' : null);
  return {
    kind: 'server',
    async chat(req, onDelta) {
      let res: Response;
      try {
        res = await fetch(`${c.url}/v1/chat`, { method: 'POST', headers, body: JSON.stringify(req) });
      } catch {
        return { ok: false, code: 'NOT_RUNNING', message: unreachable };
      }
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        return { ok: false, code: res.status === 401 ? 'UNAUTHORIZED' : 'BAD_RESPONSE', message: authMessage(res.status) ?? j?.message ?? `자체 AI 서버 오류 (${res.status})` };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let partial = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as { type: string; delta?: string; result?: SelfAiChatResult; position?: number; seconds?: number };
            if (ev.type === 'delta' && ev.delta) {
              partial += ev.delta;
              onDelta?.(ev.delta);
            } else if (ev.type === 'queued' || ev.type === 'waiting' || ev.type === 'started') announce({ requestId: req.requestId, kind: ev.type, position: ev.position, seconds: ev.seconds });
            else if (ev.type === 'result' && ev.result) return ev.result;
          }
        }
      } catch {
        return { ok: false, code: 'NOT_RUNNING', message: '자체 AI 서버 연결이 끊어졌습니다.', partial };
      }
      return { ok: false, code: 'NOT_RUNNING', message: '자체 AI 서버 연결이 끊어졌습니다.', partial };
    },
    async cancel(requestId) {
      const r = await post<{ ok: boolean }>('/v1/chat/cancel', { requestId }, () => ({ ok: false }));
      return !!r.ok;
    },
    async modelStatus() {
      try {
        const res = await fetch(`${c.url}/v1/status`, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { ok: false, running: false, model: null, reason: res.status === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR' };
        const j = (await res.json()) as { model: ModelStatus };
        return j.model;
      } catch {
        return { ok: false, running: false, model: null, reason: 'SERVER_UNREACHABLE' };
      }
    },
    research: {
      available: true,
      async status() {
        try {
          const res = await fetch(`${c.url}/v1/status`, { headers, signal: AbortSignal.timeout(5000) });
          const j = res.ok ? ((await res.json()) as { search: { ok: boolean } }) : null;
          return { ok: !!j?.search.ok, url: c.url };
        } catch {
          return { ok: false, url: c.url };
        }
      },
      search: (req) => post<ResearchOutcome>('/v1/research/search', req, (status, j) => ({ ok: false, code: status === 0 ? 'NOT_RUNNING' : status === 429 ? 'SEARCH_FAILED' : 'UNKNOWN', message: authMessage(status) ?? j?.message ?? (status === 0 ? unreachable : `자체 AI 서버 오류 (${status})`) })),
      entity: (name) => post<PersonName>('/v1/research/entity', { name }, (status) => ({ ok: false, query: name, reason: status === 0 ? unreachable : `자체 AI 서버 오류 (${status})` })),
    },
  };
}

function electronBackend(): SelfAiBackend {
  const m = window.martialdex!;
  return {
    kind: 'electron',
    chat: (req, onDelta) => (m.selfAi ? m.selfAi.chat(req, onDelta) : Promise.resolve({ ok: false, code: 'UNSUPPORTED', message: UNSUPPORTED_MODEL })),
    cancel: async (id) => !!(await m.selfAi?.cancel(id)),
    modelStatus: async () => (m.selfAi ? ((await m.selfAi.status().catch(() => null)) as ModelStatus | null) : null),
    research: {
      available: !!m.research,
      status: () => (m.research ? m.research.status() : Promise.resolve({ ok: false, url: null })),
      search: (req) => (m.research ? m.research.search(req) : Promise.resolve({ ok: false, code: 'UNSUPPORTED', message: UNSUPPORTED_SEARCH })),
      entity: (name) => (m.research?.entity ? m.research.entity(name) : Promise.resolve({ ok: false, query: name, reason: '이 기기에서는 이름 확인을 할 수 없습니다.' })),
    },
  };
}

const NONE: SelfAiBackend = {
  kind: 'none',
  chat: async () => ({ ok: false, code: 'UNSUPPORTED', message: UNSUPPORTED_MODEL }),
  cancel: async () => false,
  modelStatus: async () => null,
  research: {
    available: false,
    status: async () => ({ ok: false, url: null }),
    search: async () => ({ ok: false, code: 'UNSUPPORTED', message: UNSUPPORTED_SEARCH }),
    entity: async (name) => ({ ok: false, query: name, reason: '이 기기에서는 이름 확인을 할 수 없습니다.' }),
  },
};

/** Android: the on-device engine (LocalLlm plugin, llama.cpp) — no separate app or server. Research runs on the device too (selfResearch/deviceResearch.ts). */
function androidBackend(): SelfAiBackend {
  return {
    kind: 'android',
    async chat(req, onDelta) {
      const sub = onDelta ? await LocalLlm.addListener('delta', (e) => e.requestId === req.requestId && onDelta(e.delta)) : null;
      try {
        const r = await LocalLlm.chat({ requestId: req.requestId, messages: req.messages, json: req.json, maxTokens: req.maxTokens, temperature: req.temperature });
        if (r.ok && typeof r.text === 'string') return { ok: true, text: r.text, model: r.model ?? '', evalCount: r.evalCount ?? 0, ms: r.ms ?? 0 };
        return { ok: false, code: (r.code as SelfAiErrorCode | undefined) ?? 'UNKNOWN', message: r.message ?? '로컬 AI 요청에 실패했습니다.', partial: r.partial };
      } catch {
        return { ok: false, code: 'UNKNOWN', message: '로컬 AI 엔진 요청 중 오류가 발생했습니다.' };
      } finally {
        await sub?.remove();
      }
    },
    cancel: async (id) => !!(await LocalLlm.cancel({ requestId: id }).catch(() => ({ ok: false }))).ok,
    async modelStatus() {
      const s = await LocalLlm.status().catch(() => null);
      return s ? { ok: s.phase === 'running' || s.phase === 'idle', running: s.phase === 'running', model: s.model, reason: s.error?.code ?? null } : null;
    },
    research: deviceResearchBackend,
  };
}

/** Electron's own main process first; then the on-device Android engine; otherwise the server the user connected; otherwise none.
 *  Research: a self-AI server the user connected serves it; otherwise the Android app searches on the device. */
export function selfAiBackend(): SelfAiBackend {
  if (typeof window !== 'undefined' && window.martialdex?.selfAi && window.martialdex.research) return electronBackend();
  const c = getServerConfig();
  if (androidEngineAvailable()) {
    // a self-AI server the user connected keeps serving research; the model runs on the device
    return c ? { ...androidBackend(), research: serverBackend(c).research } : androidBackend();
  }
  if (c) return serverBackend(c);
  return deviceResearchSupported() ? { ...NONE, research: deviceResearchBackend } : NONE;
}
