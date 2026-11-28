import { useEffect, useState } from 'react';
import type { Filters, Recommendation } from './types';

// Search history, saved recommendations and usefulness ratings. Same local-first pattern as combo/repository.ts:
// `martialdex:`-prefixed localStorage — works signed out, rides the account backup (cloudSync/dataBackup.ts) and the
// per-account stash on account switch (auth/deviceAccountGuard.ts) like every other personal list. No new table.
// Saving a combo into 콤보 북 / a setup into 전술 셋업 / a technique into 즐겨찾기 uses those existing stores.

const HISTORY_KEY = 'martialdex:tactical-history';
const SAVED_KEY = 'martialdex:tactical-saved';
const FEEDBACK_KEY = 'martialdex:tactical-feedback';
const PREFS_KEY = 'martialdex:tactical-prefs';
const EVENT = 'martialdex:tactical-updated';
const MAX_HISTORY = 50;

export interface HistoryItem {
  id: string;
  query: string;
  filters: Filters;
  at: string;
  resultCount: number;
}
export interface SavedItem {
  key: string;
  savedAt: string;
  query: string;
  rec: Recommendation;
}
export interface FeedbackItem {
  key: string;
  query: string;
  useful: boolean;
  at: string;
}
export interface FinderPrefs {
  personal: boolean;
  ai: boolean;
  /** 검색 모드 — 'app' = 앱 데이터베이스(기본, AI 호출 없음), 'web' = Gemini 웹 검색(사용자가 고를 때만) */
  mode?: 'app' | 'web';
  tab?: 'technique' | 'combo';
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / blocked: the search still works, only the list is not kept
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const tacticalStore = {
  history: (): HistoryItem[] => read<HistoryItem[]>(HISTORY_KEY, []),
  addHistory(query: string, filters: Filters, resultCount: number) {
    const q = query.trim();
    if (!q) return;
    const list = this.history().filter((h) => !(h.query === q && JSON.stringify(h.filters) === JSON.stringify(filters)));
    write(HISTORY_KEY, [{ id: `h${Date.now().toString(36)}`, query: q, filters, at: new Date().toISOString(), resultCount }, ...list].slice(0, MAX_HISTORY));
  },
  removeHistory(id: string) {
    write(HISTORY_KEY, this.history().filter((h) => h.id !== id));
  },
  clearHistory() {
    write(HISTORY_KEY, []);
  },
  saved: (): SavedItem[] => read<SavedItem[]>(SAVED_KEY, []),
  isSaved(key: string) {
    return this.saved().some((s) => s.key === key);
  },
  toggleSaved(query: string, rec: Recommendation): boolean {
    const list = this.saved();
    if (list.some((s) => s.key === rec.key)) {
      write(SAVED_KEY, list.filter((s) => s.key !== rec.key));
      return false;
    }
    write(SAVED_KEY, [{ key: rec.key, savedAt: new Date().toISOString(), query, rec }, ...list].slice(0, 200));
    return true;
  },
  feedback: (): FeedbackItem[] => read<FeedbackItem[]>(FEEDBACK_KEY, []),
  feedbackFor(key: string, query: string): boolean | null {
    return this.feedback().find((f) => f.key === key && f.query === query)?.useful ?? null;
  },
  rate(key: string, query: string, useful: boolean) {
    const list = this.feedback().filter((f) => !(f.key === key && f.query === query));
    write(FEEDBACK_KEY, [{ key, query, useful, at: new Date().toISOString() }, ...list].slice(0, 500));
  },
  prefs: (): FinderPrefs => ({ personal: true, ai: false, ...read<Partial<FinderPrefs>>(PREFS_KEY, {}) }),
  setPrefs(p: Partial<FinderPrefs>) {
    write(PREFS_KEY, { ...this.prefs(), ...p });
  },
};

/** Re-renders when any TACTICAL FINDER list changes (this tab or a restore). */
export function useTacticalStore<T>(select: () => T): T {
  const [v, setV] = useState(select);
  useEffect(() => {
    const on = () => setV(select());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
