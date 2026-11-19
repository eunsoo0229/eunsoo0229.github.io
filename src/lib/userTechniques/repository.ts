import { STORAGE_REPLACED_EVENT } from '../storageEvents';
import type { UserTechniqueRecord } from './types';

// Same martialdex:-prefixed localStorage + CustomEvent pattern as every
// other local-first module (curriculum/repository.ts, trainingHistory/
// repository.ts, etc.) — works offline/logged-out, and rides the existing
// generic backup blob (dataBackup.ts scans every martialdex:* key) even
// before the dedicated Supabase table sync (see cloudSync/userTechniqueSync.ts) runs.
const KEY = 'martialdex:user-techniques';
const EVENT = 'martialdex:user-techniques-updated';

// Parsed once and kept in memory. Every technique lookup used to re-read (getItem copies the
// whole string — slow on Android WebView) and re-parse this list; with the shared library
// cached logged-in, that ran thousands of times per screen. Invalidated by our own writes,
// another tab ('storage'), or a bulk replacement (account switch / backup restore).
let memo: UserTechniqueRecord[] | null = null;
let version = 0;
function invalidate() {
  memo = null;
  version++;
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === KEY) invalidate();
  });
  window.addEventListener(STORAGE_REPLACED_EVENT, invalidate);
}

function readAll(): UserTechniqueRecord[] {
  if (memo) return memo;
  try {
    const raw = window.localStorage.getItem(KEY);
    memo = raw ? (JSON.parse(raw) as UserTechniqueRecord[]) : [];
  } catch {
    memo = [];
  }
  return memo;
}

function writeAll(records: UserTechniqueRecord[]) {
  window.localStorage.setItem(KEY, JSON.stringify(records));
  memo = records;
  version++;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Changes whenever the stored list may have changed — a cheap "did it change?" check for derived caches. */
export function storeVersion(): number {
  return version;
}

export const userTechniqueRepository = {
  list(): UserTechniqueRecord[] {
    return readAll();
  },
  get(id: string): UserTechniqueRecord | undefined {
    return readAll().find((r) => r.id === id);
  },
  save(record: UserTechniqueRecord): void {
    const all = [...readAll()]; // copy — readAll() returns the in-memory list
    const idx = all.findIndex((r) => r.id === record.id);
    if (idx >= 0) all[idx] = record;
    else all.unshift(record);
    writeAll(all);
  },
  delete(id: string): void {
    writeAll(readAll().filter((r) => r.id !== id));
  },
};
