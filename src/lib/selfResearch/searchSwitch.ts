// 자체 검색 ON/OFF — renderer side of electron/selfSearch/service.cjs. Desktop app only: on
// Android and the web there is no local SearXNG, so the switch is shown disabled with the reason.
// OFF never means "use something else": the coach answers from the MARTIALDEX data and says so.
// Android / web WITH a connected 자체 AI 서버: searches really run there (selfAi/transport.ts), so the status says so —
// this device's switch stays unavailable (the server manages its own search), but the answer is not "no search".
// Android WITHOUT a server: the app searches public sources itself (deviceResearch.ts) — the switch works,
// kept on this device, ON by default (nothing runs in the background; a search happens only when the coach asks).
import { getServerConfig, selfAiBackend } from '../selfAi/transport';
import { deviceResearchSupported } from './deviceBackend';
import { deviceSearchEnabled, setDeviceSearchEnabled } from './deviceResearch';

export interface SelfSearchStatus {
  supported: boolean;
  /** Why the switch is unavailable (unsupported platform). */
  reason?: string;
  enabled: boolean;
  /** off · starting · running · stopped (ON but not answering) · error */
  phase: 'off' | 'starting' | 'running' | 'stopped' | 'error';
  running: boolean;
  /** MARTIALDEX started this SearXNG (OFF / quit stops it). */
  owned: boolean;
  /** A SearXNG the user runs themselves — never stopped by MARTIALDEX. */
  external: boolean;
  installed: boolean;
  missing: string[];
  error: { code: string; message: string } | null;
  /** Unsupported here, but searches go to the 자체 AI 서버 the user connected (host only — never the token);
   *  or 'device': this phone queries the public sources itself. */
  via?: { kind: 'server'; host: string; searchUp: boolean | null } | { kind: 'device' };
}

const UNSUPPORTED: SelfSearchStatus = {
  supported: false,
  reason: '자체 검색 서버(SearXNG)는 MARTIALDEX 데스크톱 앱(Mac · Windows)에서만 실행할 수 있습니다. 이 기기에서는 MARTIALDEX 기술 자료로만 답합니다.',
  enabled: false,
  phase: 'off',
  running: false,
  owned: false,
  external: false,
  installed: false,
  missing: [],
  error: null,
};

function api() {
  return typeof window !== 'undefined' ? window.martialdex?.selfSearch : undefined;
}

export async function getSelfSearchStatus(): Promise<SelfSearchStatus> {
  const a = api();
  if (!a) {
    const c = getServerConfig();
    if (!c && deviceResearchSupported()) {
      const on = deviceSearchEnabled();
      return { ...UNSUPPORTED, supported: true, reason: undefined, enabled: on, phase: on ? 'running' : 'off', running: on, installed: true, via: { kind: 'device' } };
    }
    if (!c) return UNSUPPORTED;
    let host = c.url;
    try {
      host = new URL(c.url).host;
    } catch {
      /* keep as typed */
    }
    const r = selfAiBackend().research;
    const searchUp = r.available ? await r.status().then((s) => !!s.ok).catch(() => false) : null;
    return {
      ...UNSUPPORTED,
      reason: `이 기기에서는 자체 검색 서버를 실행하지 않습니다. 연결한 자체 AI 서버(${host})의 검색을 사용합니다 — 서버 검색 상태: ${searchUp === null ? '확인 불가' : searchUp ? '응답함' : '응답 없음 (이때는 검색하지 않고 MARTIALDEX 기술 자료로만 답합니다)'}. 검색 켜기/끄기는 그 서버에서 관리합니다.`,
      via: { kind: 'server', host, searchUp },
    };
  }
  try {
    return await a.status();
  } catch {
    return { ...UNSUPPORTED, supported: true, reason: undefined, phase: 'error', error: { code: 'UNKNOWN', message: '자체 검색 상태를 확인하지 못했습니다.' } };
  }
}

export async function setSelfSearchEnabled(on: boolean): Promise<{ ok: boolean; message?: string }> {
  const a = api();
  if (!a && !getServerConfig() && deviceResearchSupported()) {
    setDeviceSearchEnabled(on);
    return { ok: true };
  }
  if (!a) return { ok: false, message: UNSUPPORTED.reason };
  try {
    return await a.setEnabled(on);
  } catch {
    return { ok: false, message: '자체 검색 설정을 바꾸지 못했습니다.' };
  }
}

export function subscribeSelfSearch(cb: () => void): () => void {
  const a = api();
  return a ? a.onChange(cb) : () => {};
}
