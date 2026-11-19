// Fired after many martialdex:* keys are replaced at once outside the normal repositories
// (account switch clearing local data, backup restore) — in-memory caches drop their copy.
export const STORAGE_REPLACED_EVENT = 'martialdex:storage-replaced';

export function announceStorageReplaced(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORAGE_REPLACED_EVENT));
}
