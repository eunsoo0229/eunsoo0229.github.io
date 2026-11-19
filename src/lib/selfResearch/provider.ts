import type { PersonName, ResearchOutcome, ResearchRequest } from './types';
import { selfAiBackend } from '../selfAi/transport';

// Self-hosted research: the Electron main process (electron/selfSearch) on desktop, the
// MARTIALDEX self-AI server (server/self-ai) when the user connected one (Android, web);
// otherwise an explicit UNSUPPORTED result (the coach then says it did not search).
// Same request / result format everywhere (selfAi/transport.ts).
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; outcome: ResearchOutcome }>();

export const selfResearchProvider = {
  available(): boolean {
    return typeof window !== 'undefined' && selfAiBackend().research.available;
  },
  async status(): Promise<{ ok: boolean; url: string | null; disabled?: boolean }> {
    try {
      return await selfAiBackend().research.status();
    } catch {
      return { ok: false, url: null };
    }
  },
  async entity(name: string): Promise<PersonName> {
    try {
      return await selfAiBackend().research.entity(name);
    } catch {
      return { ok: false, query: name, reason: '이름 확인 중 오류가 발생했습니다.' };
    }
  },
  async search(request: ResearchRequest): Promise<ResearchOutcome> {
    const backend = selfAiBackend();
    if (!backend.research.available) return backend.research.search(request);
    // The same search again within a few minutes (asking for the same videos twice, a lesson
    // re-asking) reuses the result instead of searching and checking every video again.
    const key = JSON.stringify(request);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS && hit.outcome.ok) {
      // reused, never presented as a new search: when it ran, until when it is kept, and the server's state now
      const up = await backend.research.status().then((s) => !!s.ok).catch(() => false);
      return { ...hit.outcome, cache: { searchedAt: new Date(hit.at).toISOString(), expiresAt: new Date(hit.at + CACHE_MS).toISOString(), serverUp: up } };
    }
    try {
      const outcome = await backend.research.search(request);
      if (outcome.ok && outcome.results.length) {
        cache.set(key, { at: Date.now(), outcome });
        if (cache.size > 30) cache.delete(cache.keys().next().value as string);
      }
      return outcome;
    } catch {
      return { ok: false, code: 'UNKNOWN', message: '자체 검색 요청 중 오류가 발생했습니다.' };
    }
  },
};
