import { STORAGE_REPLACED_EVENT } from '../storageEvents';
import { fieldOf, type FieldSpec } from './catalog';
import type { FighterProfile, HistoryEntry, InterviewState, Measurement, ProfileItem, ProfileValue, Source, Status, StyleAnalysis } from './types';

// Local-first like every other MARTIALDEX store (`martialdex:` key → backed up
// with the rest of the device data, cleared on an account switch by
// deviceAccountGuard). Logged in, cloudSync/fighterProfileSync.ts merges it
// item by item with the user's own fighter_profiles row (0041).
//
// Nothing here trusts its input: every write is validated against the field
// catalog, and an invalid value is rejected — the stored profile is never
// replaced by something half-parsed.

const KEY = 'martialdex:fighter-profile';
export const FIGHTER_PROFILE_EVENT = 'martialdex:fighter-profile-updated';
const HISTORY_CAP = 400;
const MESSAGE_CAP = 200;
/** A measurement this old is shown as outdated (bodies and reach change). */
const MEASUREMENT_TTL_DAYS = 365;

const now = () => new Date().toISOString();

export function emptyInterview(at = now()): InterviewState {
  return { status: 'idle', currentKey: null, clarifying: false, messages: [], pending: [], startedAt: null, updatedAt: at };
}
export function emptyProfile(): FighterProfile {
  const at = '1970-01-01T00:00:00.000Z';
  return { version: 1, items: {}, style: null, history: [], interview: emptyInterview(at), updatedAt: at };
}

// In-memory copy (one localStorage read per change, not per call — see the
// Android getItem storm fixed in addTeq/repository.ts). Dropped when another
// tab writes the key or many keys are replaced at once (restore / account switch).
let memo: FighterProfile | null = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) memo = null;
  });
  window.addEventListener(STORAGE_REPLACED_EVENT, () => (memo = null));
}

function normalize(x: unknown): FighterProfile {
  const base = emptyProfile();
  if (!x || typeof x !== 'object') return base;
  const o = x as Partial<FighterProfile>;
  return {
    version: 1,
    items: o.items && typeof o.items === 'object' ? (o.items as Record<string, ProfileItem>) : {},
    style: o.style ?? null,
    history: Array.isArray(o.history) ? o.history : [],
    interview: o.interview && typeof o.interview === 'object' ? { ...base.interview, ...o.interview } : base.interview,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : base.updatedAt,
  };
}

export function getProfile(): FighterProfile {
  if (memo) return memo;
  let profile = emptyProfile();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) profile = normalize(JSON.parse(raw));
  } catch {
    // corrupted local copy — start empty rather than crash; the cloud copy (if any) is pulled on login
  }
  memo = profile;
  return profile;
}

export function saveProfile(p: FighterProfile): FighterProfile {
  const out: FighterProfile = {
    ...p,
    history: p.history.slice(-HISTORY_CAP),
    interview: { ...p.interview, messages: p.interview.messages.slice(-MESSAGE_CAP) },
    updatedAt: now(),
  };
  const raw = JSON.stringify(out);
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // storage full — keep it for this session
  }
  memo = out;
  window.dispatchEvent(new CustomEvent(FIGHTER_PROFILE_EVENT));
  return out;
}

/** Replace the whole stored profile (cloud pull / backup restore only). */
export function replaceProfile(p: FighterProfile): void {
  const raw = JSON.stringify(p);
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // storage full
  }
  memo = p;
  window.dispatchEvent(new CustomEvent(FIGHTER_PROFILE_EVENT));
}

// ---------------- validation

/** The value in its stored shape, or null when it isn't valid for the field. */
export function validateValue(f: FieldSpec, v: unknown): ProfileValue | null {
  switch (f.kind) {
    case 'choice':
      return typeof v === 'string' && !!f.options?.some((o) => o.value === v) ? v : null;
    case 'multi': {
      const list = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x): x is string => typeof x === 'string');
      const ok = [...new Set(f.options ? list.filter((x) => f.options!.some((o) => o.value === x)) : list.map((x) => x.trim()).filter(Boolean))];
      return ok.length ? ok : null;
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
    case 'number':
    case 'measurement': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN;
      if (!Number.isFinite(n)) return null;
      if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return null;
      return Math.round(n * 10) / 10;
    }
    case 'text': {
      const t = typeof v === 'string' ? v.trim().slice(0, 500) : '';
      return t || null;
    }
  }
  return null;
}

function validMeasurement(f: FieldSpec, m: Partial<Measurement> | undefined): Measurement | undefined {
  if (f.kind !== 'measurement') return undefined;
  const date = typeof m?.measuredAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.measuredAt) ? m.measuredAt : null;
  return {
    kind: f.measureKind ?? 'body',
    unit: 'cm',
    method: m?.method ?? null,
    measuredAt: date,
    side: m?.side === 'left' || m?.side === 'right' ? m.side : null,
    limb: f.limb ?? (m?.limb === 'lead' || m?.limb === 'rear' ? m.limb : null),
    // An unstated method can't be trusted as precise.
    confidence: m?.confidence && ['high', 'medium', 'low'].includes(m.confidence) ? (m.method ? m.confidence : 'low') : m?.method && m.method !== 'estimate' ? 'medium' : 'low',
    conditions: typeof m?.conditions === 'string' && m.conditions.trim() ? m.conditions.trim().slice(0, 200) : null,
  };
}

// ---------------- reads

export function liveItem(p: FighterProfile, key: string): ProfileItem | null {
  const it = p.items[key];
  return it && !it.deletedAt ? it : null;
}

/** confirmed / unconfirmed / needs_review as stored, or outdated for an old measurement. */
export function effectiveStatus(it: ProfileItem, at = Date.now()): Status {
  if (it.status === 'needs_review') return 'needs_review';
  const d = it.measurement?.measuredAt ?? (it.measurement ? it.updatedAt.slice(0, 10) : null);
  if (d && at - new Date(d).getTime() > MEASUREMENT_TTL_DAYS * 86400000) return 'outdated';
  return it.status;
}

// ---------------- writes

export interface ItemInput {
  value?: unknown;
  state?: ProfileItem['state'];
  source?: Source;
  status?: Status;
  note?: string | null;
  measurement?: Partial<Measurement>;
  observation?: { observed: string; interpretation?: string | null };
}

export type WriteResult = { ok: true; profile: FighterProfile } | { ok: false; message: string };

function historyEntry(key: string, action: HistoryEntry['action'], by: HistoryEntry['by'], from?: ProfileValue | null, to?: ProfileValue | null): HistoryEntry {
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: now(), key, action, by, from: from ?? null, to: to ?? null };
}

/** Pure: the profile with one item set (validated), related items flagged for review, derived values recomputed. */
export function withItem(p: FighterProfile, key: string, input: ItemInput, by: HistoryEntry['by']): WriteResult {
  const f = fieldOf(key);
  if (!f) return { ok: false, message: `알 수 없는 항목: ${key}` };
  const state = input.state ?? 'answered';
  let value: ProfileValue | null = null;
  if (state === 'answered') {
    value = validateValue(f, input.value);
    if (value === null) return { ok: false, message: `${f.label}: 올바른 값이 아닙니다.` };
  }
  const prev = liveItem(p, key);
  const at = now();
  const source: Source = input.source ?? (f.kind === 'measurement' && state === 'answered' ? 'measured' : 'self_report');
  const item: ProfileItem = {
    key,
    state,
    value,
    note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
    source,
    // What the user said or measured is theirs = confirmed; anything inferred waits for them.
    status: input.status ?? (source === 'coach_inferred' || source === 'video_observed' ? 'unconfirmed' : 'confirmed'),
    ...(state === 'answered' && f.kind === 'measurement' ? { measurement: validMeasurement(f, input.measurement) } : {}),
    ...(input.observation?.observed ? { observation: { observed: input.observation.observed.slice(0, 300), interpretation: input.observation.interpretation?.slice(0, 300) ?? null } } : {}),
    createdAt: prev?.createdAt ?? at,
    updatedAt: at,
    deletedAt: null,
  };
  const items = { ...p.items, [key]: item };
  const history = [...p.history, historyEntry(key, 'set', by, prev?.value ?? null, value)];
  // A changed answer puts the answers that depended on it up for review.
  const changed = prev && prev.state === 'answered' && JSON.stringify(prev.value) !== JSON.stringify(value);
  if (changed) {
    for (const r of f.related ?? []) {
      const ri = items[r];
      if (ri && !ri.deletedAt && ri.state === 'answered' && ri.status !== 'needs_review') {
        items[r] = { ...ri, status: 'needs_review', updatedAt: at };
        history.push(historyEntry(r, 'review', 'system'));
      }
    }
  }
  return { ok: true, profile: derive({ ...p, items, history }) };
}

/** Pure: the profile with one item deleted (tombstone, so the deletion syncs). */
export function withoutItem(p: FighterProfile, key: string, by: HistoryEntry['by']): FighterProfile {
  const prev = liveItem(p, key);
  if (!prev) return p;
  const at = now();
  return derive({ ...p, items: { ...p.items, [key]: { ...prev, value: null, deletedAt: at, updatedAt: at } }, history: [...p.history, historyEntry(key, 'delete', by, prev.value, null)] });
}

export function withConfirmed(p: FighterProfile, key: string): FighterProfile {
  const it = liveItem(p, key);
  if (!it) return p;
  return { ...p, items: { ...p.items, [key]: { ...it, status: 'confirmed', updatedAt: now() } }, history: [...p.history, historyEntry(key, 'confirm', 'user')] };
}

/** 키 대비 리치 비율 — calculated, never asked; follows its inputs' status. */
function derive(p: FighterProfile): FighterProfile {
  const h = liveItem(p, 'body.height');
  const w = liveItem(p, 'body.wingspan');
  const cur = liveItem(p, 'body.apeIndex');
  if (h?.state === 'answered' && w?.state === 'answered' && typeof h.value === 'number' && typeof w.value === 'number') {
    const ratio = Math.round((w.value / h.value) * 1000) / 1000;
    const status: Status = h.status === 'confirmed' && w.status === 'confirmed' ? 'confirmed' : 'needs_review';
    if (cur?.value === ratio && cur.status === status) return p;
    const at = now();
    return { ...p, items: { ...p.items, 'body.apeIndex': { key: 'body.apeIndex', state: 'answered', value: ratio, note: `리치 ${w.value}cm ÷ 키 ${h.value}cm`, source: 'system_calculated', status, createdAt: cur?.createdAt ?? at, updatedAt: at, deletedAt: null } } };
  }
  if (!cur) return p;
  const at = now();
  return { ...p, items: { ...p.items, 'body.apeIndex': { ...cur, value: null, deletedAt: at, updatedAt: at } } };
}

export function setItem(key: string, input: ItemInput, by: HistoryEntry['by'] = 'user'): WriteResult {
  const r = withItem(getProfile(), key, input, by);
  return r.ok ? { ok: true, profile: saveProfile(r.profile) } : r;
}
export function deleteItem(key: string): FighterProfile {
  return saveProfile(withoutItem(getProfile(), key, 'user'));
}
export function confirmItem(key: string): FighterProfile {
  return saveProfile(withConfirmed(getProfile(), key));
}
export function saveStyle(style: StyleAnalysis | null): FighterProfile {
  const p = getProfile();
  return saveProfile({ ...p, style, history: [...p.history, historyEntry('style', 'style', 'user', null, style ? style.tags.map((t) => t.label) : null)] });
}

// ---------------- merge (cloud sync)

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() || 0 : 0);

/** Item-level "newer side wins" — editing different items on two devices keeps both. */
export function mergeProfiles(local: FighterProfile, cloud: FighterProfile): FighterProfile {
  const items: Record<string, ProfileItem> = { ...cloud.items };
  for (const [k, it] of Object.entries(local.items)) if (!items[k] || t(it.updatedAt) >= t(items[k].updatedAt)) items[k] = it;
  const hist = new Map([...cloud.history, ...local.history].map((h) => [h.id, h]));
  return {
    version: 1,
    items,
    style: t(local.style?.updatedAt) >= t(cloud.style?.updatedAt) ? local.style : cloud.style,
    history: [...hist.values()].sort((a, b) => t(a.at) - t(b.at)).slice(-HISTORY_CAP),
    interview: t(local.interview.updatedAt) >= t(cloud.interview.updatedAt) ? local.interview : cloud.interview,
    updatedAt: t(local.updatedAt) >= t(cloud.updatedAt) ? local.updatedAt : cloud.updatedAt,
  };
}
export { normalize as normalizeProfile };
