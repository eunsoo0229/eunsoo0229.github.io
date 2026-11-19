// The Android app's research backend: deviceResearch.ts with Capacitor's native HTTP (no CORS,
// the phone's own network), the WebView's DOMParser and Mozilla Readability (loaded on first use).
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { PersonName, ResearchOutcome, ResearchRequest } from './types';
import { deviceEntity, deviceResearch, deviceSearchEnabled, DEVICE_SEARCH_DISABLED, type DeviceResearchDeps } from './deviceResearch';

export function deviceResearchSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
}

const deps: DeviceResearchDeps = {
  http: {
    async request(url, { headers, timeoutMs, method = 'GET', noRedirect }) {
      // percent-encode a result URL's raw characters (Korean wiki paths …) before Java's URL sees it
      const href = new URL(url).href;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs + 2000);
      });
      try {
        const r = await Promise.race([CapacitorHttp.request({ url: href, method, headers, responseType: 'text', connectTimeout: timeoutMs, readTimeout: timeoutMs, disableRedirects: noRedirect }), timeout]);
        // a JSON response arrives already parsed (Capacitor's HttpRequestHandler.readData)
        const text = typeof r.data === 'string' ? r.data : r.data == null ? '' : JSON.stringify(r.data);
        return { status: r.status, headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])), text };
      } finally {
        clearTimeout(timer);
      }
    },
  },
  parse: (text, type) => new DOMParser().parseFromString(text, type),
  readability: async () => (await import('@mozilla/readability')).Readability,
};

export const deviceResearchBackend = {
  available: true,
  async status(): Promise<{ ok: boolean; url: string | null; disabled?: boolean }> {
    const on = deviceSearchEnabled();
    return { ok: on, url: null, disabled: !on };
  },
  async search(req: ResearchRequest): Promise<ResearchOutcome> {
    if (!deviceSearchEnabled()) return { ok: false, code: 'DISABLED', message: DEVICE_SEARCH_DISABLED };
    try {
      return await deviceResearch(deps, req);
    } catch {
      return { ok: false, code: 'UNKNOWN', message: '기기 검색 중 오류가 발생했습니다.' };
    }
  },
  entity: (name: string): Promise<PersonName> => deviceEntity(deps, name),
};
