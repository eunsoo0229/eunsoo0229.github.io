import { announceStorageReplaced } from '../storageEvents';
// Every local-first repository (trainingHistory, curriculum, gymRoutine,
// nutrition, combo, tactic, ...) stores its data in flat `martialdex:`-
// prefixed localStorage keys with NO per-account namespacing — by design,
// since the app is built around one person using their own device. The gap:
// LocalDataMigrationPrompt.tsx's "always-safe" bidirectional syncs run
// unconditionally on every login, so if a SECOND, DIFFERENT real account
// logs in on the same device (without either an explicit "저장하기" or
// "클라우드 데이터 불러오기" choice being what runs first), whatever is
// still sitting in local storage from the FIRST account gets silently
// pushed up to the second account's cloud data the moment it authenticates.
// Confirmed live during gym-class multi-account E2E testing (an
// instructor's freshly-created account ended up with a student's
// just-recorded workout in its own training_history rows).
//
// This detects that exact transition — a real account replacing a
// DIFFERENT previously-remembered one — and wipes local app data first, so
// the new account always starts clean and only ever pulls its OWN cloud
// data. A first-ever login (no previously-remembered account) is left
// alone, preserving the legitimate "이 기기의 기존 데이터를 계정에
// 저장할까요?" push-offer flow for someone using the app locally before
// ever signing up.
// Deliberately NOT `martialdex:`-prefixed — dataBackup.ts's
// hasLocalDataToBackup() treats ANY `martialdex:`-prefixed key as "real
// user data to offer backing up," so a tracking key under that prefix would
// make every single login look like it has local data to back up, showing
// the "기존 데이터를 계정에 저장할까요?" prompt even on a genuinely fresh
// signup with nothing else in local storage (confirmed live — this is
// exactly what happened before this key was moved off the `martialdex:`
// prefix). `mdx:` matches the same convention LocalDataMigrationPrompt
// itself already uses for its own non-backupable tracking key
// (promptSeenKey, `mdx:backup-prompt-seen:<userId>`).
const LAST_USER_KEY = 'mdx:last-auth-user-id';
/** Per-account stash of local data left behind by an account switch (`mdx:` — not backed up, not wiped). */
export const ACCOUNT_STASH_PREFIX = 'mdx:account-stash:';
const STASH_FAILED_PREFIX = 'mdx:account-stash-failed:';

interface AccountStash {
  owner: string;
  savedAt: string;
  entries: [string, string][];
}

function stashAccountData(owner: string, entries: readonly (readonly [string, string])[]): boolean {
  if (!entries.length) return true;
  // a stash already waiting for this account (it switched away before, never came back) is merged, newer values win
  let prev: AccountStash | null = null;
  try {
    prev = JSON.parse(window.localStorage.getItem(ACCOUNT_STASH_PREFIX + owner) ?? 'null');
  } catch {
    prev = null;
  }
  const merged = new Map<string, string>(prev?.entries ?? []);
  for (const [k, v] of entries) merged.set(k, v);
  const stash: AccountStash = { owner, savedAt: new Date().toISOString(), entries: [...merged.entries()] };
  try {
    window.localStorage.setItem(ACCOUNT_STASH_PREFIX + owner, JSON.stringify(stash));
    window.localStorage.removeItem(STASH_FAILED_PREFIX + owner);
    return true;
  } catch {
    // storage full even after the removal: recorded so the app can tell the user (the data is NOT silently claimed safe)
    try {
      window.localStorage.setItem(STASH_FAILED_PREFIX + owner, JSON.stringify({ at: new Date().toISOString(), keys: entries.length }));
    } catch {
      /* nothing more can be written */
    }
    return false;
  }
}

/** Puts back the local data an account left behind when another account signed in on this device. */
function restoreAccountData(owner: string): number {
  let stash: AccountStash | null = null;
  try {
    stash = JSON.parse(window.localStorage.getItem(ACCOUNT_STASH_PREFIX + owner) ?? 'null');
  } catch {
    stash = null;
  }
  if (!stash || stash.owner !== owner || !Array.isArray(stash.entries)) return 0;
  let restored = 0;
  for (const [k, v] of stash.entries) {
    if (typeof k !== 'string' || !k.startsWith('martialdex:') || typeof v !== 'string') continue;
    try {
      window.localStorage.setItem(k, v);
      restored++;
    } catch {
      return restored; // keep the stash: nothing is dropped
    }
  }
  window.localStorage.removeItem(ACCOUNT_STASH_PREFIX + owner);
  return restored;
}

/** Accounts whose left-behind data could not be stashed (storage full) — for a warning in settings. */
export function accountStashFailures(): { userId: string; at: string; keys: number }[] {
  const out: { userId: string; at: string; keys: number }[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k?.startsWith(STASH_FAILED_PREFIX)) continue;
    try {
      const v = JSON.parse(window.localStorage.getItem(k) ?? '{}');
      out.push({ userId: k.slice(STASH_FAILED_PREFIX.length), at: v.at, keys: v.keys });
    } catch {
      /* unreadable marker */
    }
  }
  return out;
}

// Device/UI preferences, not user data — kept across an account switch.
const PRESERVE_KEYS = new Set(['martialdex:theme']);

/**
 * Call with the newly-authenticated user's id (or null when signed out)
 * BEFORE any other code reacts to the new session. Returns true if a
 * different account's local data was just moved to its stash (and this
 * account's own stash, if any, put back) — the caller should
 * reload the page in that case so every already-mounted component re-reads
 * its state from the now-empty (soon to be freshly synced) local storage,
 * matching the same reload-after-bulk-change convention
 * LocalDataMigrationPrompt already uses for its own restore flow.
 */
export function guardAccountSwitch(newUserId: string | null): boolean {
  if (!newUserId) return false;

  const lastUserId = window.localStorage.getItem(LAST_USER_KEY);
  const switched = !!lastUserId && lastUserId !== newUserId;

  if (switched) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('martialdex:') && key !== LAST_USER_KEY && !PRESERVE_KEYS.has(key)) {
        keysToRemove.push(key);
      }
    }
    // 10차: the previous account's local data may hold records not synced yet (written offline, sync failed …).
    // Switching accounts must not delete them: they are kept under that account's own stash (outside the
    // `martialdex:` prefix — never backed up to, synced to or shown to the new account) and put back when the
    // previous account signs in again, before its syncs run, so they are uploaded instead of lost.
    const entries = keysToRemove.map((k) => [k, window.localStorage.getItem(k)] as const).filter((e): e is readonly [string, string] => e[1] !== null);
    for (const key of keysToRemove) window.localStorage.removeItem(key);
    // removed first, then stashed: the freed space is what the stash needs
    stashAccountData(lastUserId!, entries);
    restoreAccountData(newUserId);
    announceStorageReplaced();
  }

  window.localStorage.setItem(LAST_USER_KEY, newUserId);
  return switched;
}
