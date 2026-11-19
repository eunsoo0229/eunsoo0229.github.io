import { STORAGE_REPLACED_EVENT } from '../storageEvents';
import type { AddTeqRecord } from './types';

// Local, synchronous cache of the shared add_teq library — required
// because every existing resolver this needs to plug into
// (resolveTechnique/resolveTechniquesByIds/searchAllTechniques in
// userTechniques/service.ts) is called synchronously from render paths all
// over the app (technique detail, combo, free training, curriculum...).
// Supabase itself stays the source of truth (see service.ts's
// pullAddTeqFromCloud/insertAddTeqTechnique); this cache is only ever
// refreshed by pulling from there, never edited independently — same
// "local-first cache of shared data" role dataBackup.ts's cloud restore
// plays for user_backups, just automatic instead of user-triggered.
const KEY = 'martialdex:add-teq-cache';
const EVENT = 'martialdex:add-teq-cache-updated';

// Parsed once and kept in memory. Every technique lookup used to re-read (getItem copies the
// whole string — slow on Android WebView) and re-parse this list; with the shared library
// cached logged-in, that ran thousands of times per screen. Invalidated by our own writes,
// another tab ('storage'), or a bulk replacement (account switch / backup restore).
let memo: AddTeqRecord[] | null = null;
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

function readAll(): AddTeqRecord[] {
  if (memo) return memo;
  try {
    const raw = window.localStorage.getItem(KEY);
    memo = raw ? (JSON.parse(raw) as AddTeqRecord[]) : [];
  } catch {
    memo = [];
  }
  return memo;
}

function writeAll(records: AddTeqRecord[]) {
  window.localStorage.setItem(KEY, JSON.stringify(records));
  memo = records;
  version++;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Changes whenever the stored list may have changed — a cheap "did it change?" check for derived caches. */
export function storeVersion(): number {
  return version;
}

export const addTeqRepository = {
  list(): AddTeqRecord[] {
    return readAll();
  },
  get(id: string): AddTeqRecord | undefined {
    return readAll().find((r) => r.id === id);
  },
  /** Replaces-or-adds by id — used both for a fresh cloud pull and for a single just-registered record. */
  upsertMany(records: AddTeqRecord[]): void {
    if (records.length === 0) return;
    const current = readAll();
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const r of records) byId.set(r.id, r);
    writeAll([...byId.values()]);
  },
  upsertOne(record: AddTeqRecord): void {
    this.upsertMany([record]);
  },
};

export { KEY as ADD_TEQ_CACHE_KEY, EVENT as ADD_TEQ_CACHE_EVENT };
