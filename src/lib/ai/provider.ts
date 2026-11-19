import { supabase } from '../supabase/client';
import type { AskAiRequest, AskAiResult } from './types';
import { getAiEngine } from '../localAi/enginePreference';
import { askLocal } from '../localAi/localProvider';

// Two transports, chosen automatically per platform — neither ever puts the
// Gemini API key in this bundle:
//
// 1. Electron (window.martialdex.askAi present): unchanged IPC path to
//    electron/main.cjs -> electron/gemini.cjs, which reads GEMINI_API_KEY
//    from the main process's own environment. Not touched by this file.
// 2. Everywhere else (Android/Capacitor, plain web): calls the
//    `gemini-ask` Supabase Edge Function over HTTPS. The key lives only in
//    that function's server-side environment (`supabase secrets set
//    GEMINI_API_KEY=...`) — see supabase/functions/gemini-ask/index.ts.
//    Requires the user to be logged in (reuses Supabase Auth) so the
//    endpoint can't be called anonymously once its URL is known from the
//    APK.
//
// To switch providers later, only this file (and the Electron/Edge Function
// implementations it calls) change — every UI component that imports
// `aiProvider` stays the same.
export interface AiProvider {
  ask(request: AskAiRequest): Promise<AskAiResult>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

async function askViaElectron(request: AskAiRequest): Promise<AskAiResult> {
  try {
    return await window.martialdex!.askAi(request);
  } catch {
    return {
      ok: false,
      code: 'NETWORK',
      message: '요청을 보내는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    };
  }
}

/**
 * Edge Function versions deployed before `mediaParts` existed ignore it. So
 * the ordered images are ALSO sent as `imageParts` (supported by every
 * version) with their labels listed in the question text ("→ [이미지 3]");
 * a function that understands `mediaParts` uses those and skips this copy
 * (`mediaParts` present → it does not read `imageParts` twice — see
 * supabase/functions/gemini-ask). YouTube parts need the updated function.
 */
function withLegacyMediaFallback(request: AskAiRequest): AskAiRequest {
  if (!request.mediaParts?.length) return request;
  const lines: string[] = [];
  const images: { mimeType: string; data: string }[] = [...(request.imageParts ?? [])];
  for (const part of request.mediaParts) {
    if (part.kind === 'text') lines.push(part.text);
    else if (part.kind === 'image') {
      images.push({ mimeType: part.mimeType, data: part.data });
      lines.push(`→ [이미지 ${images.length}]`);
    } else lines.push(`[YouTube 영상: ${part.url}]`);
  }
  return { ...request, imageParts: images, question: `${request.question}\n\n[첨부 이미지 순서와 설명]\n${lines.join('\n')}` };
}

async function askViaSupabaseEdgeFunction(request: AskAiRequest): Promise<AskAiResult> {
  if (!supabase || !SUPABASE_URL) {
    return {
      ok: false,
      code: 'UNKNOWN',
      message: 'AI 기능이 아직 설정되지 않았습니다. 관리자에게 문의해주세요.',
    };
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'AI 기능을 사용하려면 먼저 로그인해주세요.',
    };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gemini-ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Supabase's gateway (Kong) requires `apikey` on every request to
        // identify the project/key tier — separate from `Authorization`,
        // which carries the logged-in user's own session token that
        // gemini-ask/index.ts verifies. Omitting apikey gets rejected by
        // the gateway before the request ever reaches the function.
        apikey: SUPABASE_ANON_KEY ?? '',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(withLegacyMediaFallback(request)),
    });
    const json = (await res.json()) as AskAiResult;
    return json;
  } catch {
    return {
      ok: false,
      code: 'NETWORK',
      message: '네트워크 오류로 AI 서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.',
    };
  }
}

// ---------------- Gemini 사용 한도 (0066) ----------------
// "1회" = 사용자가 시킨 작업 1건. 한 작업이 Gemini 를 여러 번 부르면(수업 생성, 검증 재시도 …) 같은 useId 로
// 묶는다: 직전 호출에서 90초 안에 이어지는 호출은 같은 묶음. 묶음의 상한(시간·호출 수)은 서버가 강제한다.
export const GEMINI_QUOTA_EVENT = 'martialdex:gemini-quota-changed';
const BURST_GAP_MS = 90_000;
const BURST_MAX_MS = 9 * 60_000;
const BURST_MAX_CALLS = 14;
let burst: { id: string; startedAt: number; lastAt: number; calls: number } | null = null;
function currentUseId(): string {
  const now = Date.now();
  if (!burst || now - burst.lastAt > BURST_GAP_MS || now - burst.startedAt > BURST_MAX_MS || burst.calls >= BURST_MAX_CALLS) {
    burst = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 32), startedAt: now, lastAt: now, calls: 0 };
  }
  burst.lastAt = now;
  burst.calls++;
  return burst.id;
}
function quotaExceeded(limit: number): AskAiResult {
  return { ok: false, code: 'QUOTA_EXCEEDED', message: `오늘 Gemini 코치 무료 사용 ${limit}회를 모두 썼습니다. 내일 다시 쓸 수 있고, PRO 멤버십은 한도 없이 사용할 수 있습니다.` };
}

// Mac 앱(Electron)은 기기의 키로 Gemini 를 직접 부른다 → 로그인했으면 같은 서버 카운터로 판정,
// 로그인 전이면 서버에 물을 수 없으므로 이 기기에서 하루 5회를 센다(서울 날짜).
const LOCAL_FREE_USES = 5;
function localGuestCheck(useId: string): boolean {
  try {
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const key = `martialdex:gemini-guest-uses:${day}`;
    const ids: string[] = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    if (ids.includes(useId)) return true;
    if (ids.length >= LOCAL_FREE_USES) return false;
    window.localStorage.setItem(key, JSON.stringify([...ids, useId]));
    return true;
  } catch {
    return true;
  }
}
async function electronQuotaGate(useId: string): Promise<AskAiResult | null> {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  if (!supabase || !data.session) return localGuestCheck(useId) ? null : quotaExceeded(LOCAL_FREE_USES);
  let r = await supabase.rpc('consume_gemini_use', { p_use_id: useId });
  if (!r.error && r.data?.allowed === false && r.data?.reason === 'USE_EXPIRED') r = await supabase.rpc('consume_gemini_use', { p_use_id: `${useId}-${Date.now().toString(36)}` });
  if (r.error) return { ok: false, code: 'UNKNOWN', message: 'AI 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  return r.data?.allowed === true ? null : quotaExceeded(r.data?.limit ?? LOCAL_FREE_USES);
}

/** Gemini (external, paid) — only reached when the user chose it. Every call passes the daily-use gate first. */
async function askGemini(request: AskAiRequest): Promise<AskAiResult> {
  const { engine: _engine, responseFormat: _format, ...geminiRequest } = request;
  const useId = currentUseId();
  try {
    if (window.martialdex?.askAi) {
      const blocked = await electronQuotaGate(useId);
      if (blocked) return blocked;
      return await askViaElectron(geminiRequest);
    }
    return await askViaSupabaseEdgeFunction({ ...geminiRequest, useId });
  } finally {
    window.dispatchEvent(new CustomEvent(GEMINI_QUOTA_EVENT));
  }
}

/**
 * The common provider every generative feature calls. Engine = the request's explicit
 * per-feature choice, else 설정 > AI 엔진 (local by default). A local failure is returned
 * as-is: there is no automatic Gemini fallback.
 */
export const aiProvider: AiProvider = {
  async ask(request) {
    const engine = request.engine ?? getAiEngine();
    return engine === 'gemini' ? askGemini(request) : askLocal(request);
  },
};
