import { STORAGE_REPLACED_EVENT } from '../storageEvents';

// 개인 목표 (이번 주 / 이번 달 / 올해 / 내년 / 앞으로) — free text the user writes about where they want their
// training to go. Local-first like every other MARTIALDEX store (`martialdex:` key → rides the account backup,
// cleared on an account switch by deviceAccountGuard); logged in, cloudSync/goalsSync.ts merges it entry by entry
// with the user's own training_goals row (0044, not applied automatically).
//
// A goal is stored against the PERIOD it was written for, never against a label:
//   week  "2026-W45"   month "2026-11"   year "2026"   long_term ""
// so the year is always computed from today, "내년 목표" written in 2026 simply becomes the 2026+1 year entry (and
// is read as 올해 목표 once 2027 starts), and a week/month that has passed becomes a past goal on its own — nothing
// is rewritten and nothing is ever auto-deleted. Deleted entries stay as tombstones so a deletion syncs.

export type GoalScope = 'week' | 'month' | 'year' | 'long_term';

export interface GoalEntry {
  id: string;
  scope: GoalScope;
  /** ISO week / month / year the text was written for; '' for long_term. */
  periodKey: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  /** Tombstone — kept so the deletion reaches other devices. */
  deletedAt?: string;
}

export interface GoalsData {
  version: 1;
  entries: GoalEntry[];
  updatedAt: string;
}

const KEY = 'martialdex:training-goals';
export const GOALS_EVENT = 'martialdex:training-goals-updated';
/** One goal is a note, not a document: enough for a long paragraph list, small enough for a prompt and a row. */
export const GOAL_TEXT_MAX = 4000;
const ENTRY_CAP = 400;

const nowIso = () => new Date().toISOString();

export const SCOPE_LABEL: Record<GoalScope, string> = { week: '이번 주 목표', month: '이번 달 목표', year: '올해 목표', long_term: '앞으로의 목표' };

export function emptyGoals(): GoalsData {
  return { version: 1, entries: [], updatedAt: '1970-01-01T00:00:00.000Z' };
}

// ---------------------------------------------------------------- periods

/** ISO-8601 week of the local date, e.g. "2026-W45" (Monday first, Thursday decides the year). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const yearKey = (d: Date): string => String(d.getFullYear());

export interface GoalSlot {
  /** Stable id for the editor: scope + period. */
  slot: 'week' | 'month' | 'year' | 'next_year' | 'long_term';
  scope: GoalScope;
  periodKey: string;
  label: string;
  entry: GoalEntry | null;
}

/** The five slots the user edits today, with the period each one belongs to. */
export function currentSlots(now: Date = new Date()): Omit<GoalSlot, 'entry'>[] {
  const y = now.getFullYear();
  return [
    { slot: 'week', scope: 'week', periodKey: isoWeekKey(now), label: '이번 주 목표' },
    { slot: 'month', scope: 'month', periodKey: monthKey(now), label: `이번 달 목표 (${now.getMonth() + 1}월)` },
    { slot: 'year', scope: 'year', periodKey: String(y), label: `올해 목표 (${y}년)` },
    { slot: 'next_year', scope: 'year', periodKey: String(y + 1), label: `내년 목표 (${y + 1}년)` },
    { slot: 'long_term', scope: 'long_term', periodKey: '', label: '앞으로의 목표' },
  ];
}

/** A period that has already ended (week/month/year only — long_term never passes). */
export function isPast(e: GoalEntry, now: Date = new Date()): boolean {
  if (e.scope === 'long_term') return false;
  const current = e.scope === 'week' ? isoWeekKey(now) : e.scope === 'month' ? monthKey(now) : yearKey(now);
  return e.periodKey < current; // keys sort chronologically (year first, zero-padded)
}

/** Human label for a stored period ("2026-W45" → "2026년 45주차"). */
export function periodLabel(e: Pick<GoalEntry, 'scope' | 'periodKey'>): string {
  if (e.scope === 'long_term') return '앞으로의 목표';
  const w = /^(\d{4})-W(\d{2})$/.exec(e.periodKey);
  if (w) return `${w[1]}년 ${Number(w[2])}주차`;
  const m = /^(\d{4})-(\d{2})$/.exec(e.periodKey);
  if (m) return `${m[1]}년 ${Number(m[2])}월`;
  return `${e.periodKey}년`;
}

// ---------------------------------------------------------------- storage

let memo: GoalsData | null = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) memo = null;
  });
  window.addEventListener(STORAGE_REPLACED_EVENT, () => (memo = null));
}

const isScope = (x: unknown): x is GoalScope => x === 'week' || x === 'month' || x === 'year' || x === 'long_term';

export function normalizeGoals(x: unknown): GoalsData {
  const base = emptyGoals();
  if (!x || typeof x !== 'object') return base;
  const o = x as Partial<GoalsData>;
  const entries: GoalEntry[] = [];
  for (const raw of Array.isArray(o.entries) ? o.entries : []) {
    const e = raw as Partial<GoalEntry>;
    if (!e || typeof e.id !== 'string' || !isScope(e.scope) || typeof e.periodKey !== 'string' || typeof e.text !== 'string') continue;
    if (e.scope === 'long_term' ? e.periodKey !== '' : !e.periodKey) continue;
    entries.push({
      id: e.id,
      scope: e.scope,
      periodKey: e.periodKey,
      text: e.text.slice(0, GOAL_TEXT_MAX),
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : base.updatedAt,
      updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : base.updatedAt,
      ...(typeof e.deletedAt === 'string' ? { deletedAt: e.deletedAt } : {}),
    });
  }
  return { version: 1, entries: entries.slice(-ENTRY_CAP), updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : base.updatedAt };
}

export function getGoalsData(): GoalsData {
  if (memo) return memo;
  let data = emptyGoals();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) data = normalizeGoals(JSON.parse(raw));
  } catch {
    // a corrupted copy must never break the app — start from empty, the cloud copy (if any) is pulled on login
  }
  memo = data;
  return data;
}

function write(data: GoalsData): GoalsData {
  const out: GoalsData = { ...data, entries: data.entries.slice(-ENTRY_CAP), updatedAt: nowIso() };
  memo = out;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // out of quota: the in-memory copy still serves this session
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GOALS_EVENT));
  return out;
}

/** Replaces everything (sync pull / backup restore). */
export function replaceGoals(data: GoalsData): void {
  write(normalizeGoals(data));
}

const newId = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Live (not deleted) entries, newest period first within a scope. */
export function listGoals(): GoalEntry[] {
  return getGoalsData()
    .entries.filter((e) => !e.deletedAt)
    .sort((a, b) => (a.scope === b.scope ? b.periodKey.localeCompare(a.periodKey) : 0));
}

export function findGoal(scope: GoalScope, periodKey: string): GoalEntry | null {
  return listGoals().find((e) => e.scope === scope && e.periodKey === periodKey) ?? null;
}

/**
 * Writes one period's goal. Empty text deletes it (tombstone) — the user clearing a box is a deletion, never a
 * stored empty goal. Returns the entry, or null when it was deleted / nothing changed.
 */
export function saveGoal(scope: GoalScope, periodKey: string, text: string): GoalEntry | null {
  const key = scope === 'long_term' ? '' : periodKey.trim();
  if (scope !== 'long_term' && !key) return null;
  const data = getGoalsData();
  const trimmed = text.trim().slice(0, GOAL_TEXT_MAX);
  const i = data.entries.findIndex((e) => e.scope === scope && e.periodKey === key);
  const at = nowIso();
  if (!trimmed) {
    if (i < 0 || data.entries[i].deletedAt) return null;
    const entries = [...data.entries];
    entries[i] = { ...entries[i], text: '', deletedAt: at, updatedAt: at };
    write({ ...data, entries });
    return null;
  }
  if (i >= 0 && data.entries[i].text === trimmed && !data.entries[i].deletedAt) return data.entries[i];
  const entries = [...data.entries];
  const entry: GoalEntry =
    i >= 0
      ? { ...entries[i], text: trimmed, updatedAt: at, deletedAt: undefined }
      : { id: newId(), scope, periodKey: key, text: trimmed, createdAt: at, updatedAt: at };
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  write({ ...data, entries });
  return entry;
}

export function deleteGoal(scope: GoalScope, periodKey: string): void {
  saveGoal(scope, periodKey, '');
}

/** The five editable slots with whatever is stored for today's periods. */
export function goalSlots(now: Date = new Date()): GoalSlot[] {
  return currentSlots(now).map((s) => ({ ...s, entry: findGoal(s.scope, s.periodKey) }));
}

/** Goals whose period has ended — kept, never deleted, shown separately. */
export function pastGoals(now: Date = new Date()): GoalEntry[] {
  return listGoals()
    .filter((e) => isPast(e, now))
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}

export function hasAnyGoal(): boolean {
  return listGoals().length > 0;
}
