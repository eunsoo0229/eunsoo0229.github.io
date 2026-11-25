// 계정 데이터 자동 동기화 — 프로필에서 "백업"·"복원"을 직접 누르지 않아도 되게 한다.
//
// 지금까지의 문제: `dataBackup.ts` 는 사용자가 누를 때만 동작했다. 누르는 걸 잊으면 기기를 바꿨을 때
// 기록이 없었다. 이 모듈은 수시로 올리고(push), 앱을 열 때 내려받는다(pull).
//
// user_backups(백업본)와 user_state(현재 상태)를 나눈 이유는 0067_user_state.sql 에 적었다 —
// 자동 동기화가 백업본까지 덮어쓰면 되돌릴 곳이 사라진다.
//
// ── 덮어쓰기 규칙 (가장 중요한 부분) ────────────────────────────────────────────────
// 자동 복원은 기록을 지울 수 있는 동작이다. 그래서 **조건을 만족할 때만** 자동으로 적용한다:
//   · 클라우드가 이 기기가 마지막으로 올린 것보다 새롭고,
//   · 그 뒤로 이 기기에서 바뀐 것이 없을 때
// 양쪽 다 바뀌었으면(= 충돌) 아무것도 덮어쓰지 않고 `conflict` 로 돌려준다 — 어느 쪽을 쓸지는
// 사용자가 고른다. "최신 것이 이긴다"로 조용히 처리하면 다른 기기에서 한 훈련 기록이 사라진다.

import { announceStorageReplaced } from '../storageEvents';
import { supabase } from '../supabase/client';
import { isStillCurrentUser } from './syncGuard';
import { getDeviceInfo } from '../device/deviceInfo';

const PREFIX = 'martialdex:';
/** 이 기기의 동기화 상태 — 그 자체는 동기화하지 않는다(기기마다 다르다). */
const SYNC_META_KEY = 'mdx:state-sync';
/** 기기 식별자 — "어느 기기에서 올렸는지" 표시에만 쓴다. */
const DEVICE_ID_KEY = 'mdx:device-id';

/**
 * 올리지 않는 키.
 * `martialdex:self-ai-server` 는 사용자가 연결한 자체 AI 서버의 **토큰**을 담는다. 기기에 매인 값이고,
 * 자동으로 서버에 올릴 이유가 없다. (기존 수동 백업은 이것까지 올린다 — 별도 과제로 남긴다.)
 */
const NEVER_SYNC = new Set([`${PREFIX}self-ai-server`]);
/** 기기에 매인 값이라 다른 기기로 옮기면 오히려 틀린다. */
const DEVICE_LOCAL_PREFIXES = [`${PREFIX}local-model`, `${PREFIX}engine-`];

/** 스냅샷이 바뀌었는지 보는 값싼 지문 — 모든 저장 지점을 고치지 않고 변경을 알아내기 위한 것. */
function fingerprint(snap: Record<string, string>): string {
  let h = 5381;
  let size = 0;
  for (const key of Object.keys(snap).sort()) {
    const v = snap[key];
    size += v.length;
    for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
    // 값 전체를 도는 것은 비싸다 — 길이와 앞뒤 일부만 본다(내용이 바뀌면 거의 항상 달라진다)
    for (let i = 0; i < Math.min(v.length, 64); i++) h = ((h * 33) ^ v.charCodeAt(i)) >>> 0;
    for (let i = Math.max(0, v.length - 64); i < v.length; i++) h = ((h * 33) ^ v.charCodeAt(i)) >>> 0;
    h = ((h * 33) ^ v.length) >>> 0;
  }
  return `${h.toString(36)}-${Object.keys(snap).length}-${size}`;
}

export interface StateSyncMeta {
  /** 이 기기가 마지막으로 올린 시각 (서버 updated_at) */
  lastPushedAt: string | null;
  /** 이 기기가 마지막으로 내려받은 시각 (서버 updated_at) */
  lastPulledAt: string | null;
  /** 이 기기에서 데이터가 마지막으로 바뀐 시각 (로컬 시계) */
  lastLocalChangeAt: string | null;
  /** 마지막으로 올린 스냅샷의 지문 — 이것과 다르면 바뀐 것이다. */
  lastPushedPrint?: string | null;
}

export type PullResult =
  | { kind: 'applied'; keyCount: number; from: { deviceName: string | null; at: string } }
  | { kind: 'up_to_date' }
  | { kind: 'none' } // 클라우드에 아직 아무것도 없음
  | { kind: 'conflict'; cloud: { deviceName: string | null; at: string; keyCount: number }; localChangedAt: string }
  | { kind: 'skipped'; reason: string };

function readMeta(): StateSyncMeta {
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY);
    const m = raw ? (JSON.parse(raw) as Partial<StateSyncMeta>) : {};
    return { lastPushedAt: m.lastPushedAt ?? null, lastPulledAt: m.lastPulledAt ?? null, lastLocalChangeAt: m.lastLocalChangeAt ?? null, lastPushedPrint: m.lastPushedPrint ?? null };
  } catch {
    return { lastPushedAt: null, lastPulledAt: null, lastLocalChangeAt: null, lastPushedPrint: null };
  }
}

function writeMeta(patch: Partial<StateSyncMeta>): void {
  try {
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
  } catch {
    // 저장 실패는 동기화를 막지 않는다 — 다음에 다시 올릴 뿐이다
  }
}

export function getStateSyncMeta(): StateSyncMeta {
  return readMeta();
}

/** 이 기기에서 데이터가 바뀌었다고 표시 — 다음 push 대상이 된다. */
export function markLocalChange(): void {
  writeMeta({ lastLocalChangeAt: new Date().toISOString() });
}

function deviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'unknown';
  }
}

function syncable(key: string): boolean {
  if (!key.startsWith(PREFIX)) return false;
  if (NEVER_SYNC.has(key)) return false;
  return !DEVICE_LOCAL_PREFIXES.some((p) => key.startsWith(p));
}

/** 올릴 스냅샷 — 비밀값과 기기 전용 값은 빼고 모은다. */
export function snapshotForSync(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !syncable(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * 로컬에 바뀐 것이 있어 올릴 필요가 있는가 — 스냅샷 지문으로 판정한다.
 * 저장 지점마다 markLocalChange() 를 심지 않아도 되고, 심은 곳이 있으면 그것도 함께 본다.
 */
export function needsPush(): boolean {
  const meta = readMeta();
  if (!meta.lastPushedAt) return Object.keys(snapshotForSync()).length > 0;
  if (fingerprint(snapshotForSync()) !== meta.lastPushedPrint) return true;
  if (!meta.lastLocalChangeAt) return false;
  return new Date(meta.lastLocalChangeAt).getTime() > new Date(meta.lastPushedAt).getTime();
}

export async function pushState(userId: string, opts: { force?: boolean } = {}): Promise<{ ok: true; keyCount: number; at: string } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
  if (!opts.force && !needsPush()) return { ok: false, message: '올릴 변경이 없습니다.' };
  const data = snapshotForSync();
  if (!Object.keys(data).length) return { ok: false, message: '올릴 데이터가 없습니다.' };
  const info = await getDeviceInfo().catch(() => null);
  const capturedAt = new Date().toISOString();
  const { data: row, error } = await supabase
    .from('user_state')
    .upsert({ user_id: userId, data, device_id: deviceId(), device_name: info?.deviceName ?? null, captured_at: capturedAt })
    .select('updated_at')
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!isStillCurrentUser(userId)) return { ok: false, message: '계정이 바뀌어 중단했습니다.' };
  const at = (row?.updated_at as string | undefined) ?? capturedAt;
  writeMeta({ lastPushedAt: at, lastPulledAt: at, lastPushedPrint: fingerprint(data), lastLocalChangeAt: null });
  return { ok: true, keyCount: Object.keys(data).length, at };
}

/**
 * 앱을 열 때 호출한다. 조건을 만족하면 바로 적용하고, 양쪽이 모두 바뀌었으면 `conflict` 로 돌려준다.
 * `force: true` 는 사용자가 "클라우드 것으로 덮어쓰기"를 직접 고른 경우에만 쓴다.
 */
export async function pullState(userId: string, opts: { force?: boolean } = {}): Promise<PullResult> {
  if (!supabase) return { kind: 'skipped', reason: 'Supabase 설정이 필요합니다.' };
  const { data: row, error } = await supabase.from('user_state').select('data, device_name, updated_at').eq('user_id', userId).maybeSingle();
  if (error) return { kind: 'skipped', reason: error.message };
  if (!row?.data) return { kind: 'none' };
  if (!isStillCurrentUser(userId)) return { kind: 'skipped', reason: '계정이 바뀌어 중단했습니다.' };

  const meta = readMeta();
  const cloudAt = row.updated_at as string;
  const cloudTime = new Date(cloudAt).getTime();
  const pulled = meta.lastPulledAt ? new Date(meta.lastPulledAt).getTime() : 0;
  const entries = Object.entries(row.data as Record<string, unknown>).filter(([k, v]) => syncable(k) && typeof v === 'string') as [string, string][];

  if (!opts.force) {
    if (cloudTime <= pulled) return { kind: 'up_to_date' };
    // 이 기기에서도 그 뒤에 바뀌었다면 둘 다 살아 있는 변경이다 — 조용히 덮어쓰지 않는다
    // 이 기기에서도 올린 뒤에 바뀌었는가 (지문이 다르면 바뀐 것이다)
    const changedHere = meta.lastPushedPrint ? fingerprint(snapshotForSync()) !== meta.lastPushedPrint : Object.keys(snapshotForSync()).length > 0;
    if (changedHere) {
      return { kind: 'conflict', cloud: { deviceName: (row.device_name as string | null) ?? null, at: cloudAt, keyCount: entries.length }, localChangedAt: meta.lastLocalChangeAt ?? '알 수 없음' };
    }
  }

  // 적용: 동기화 대상 키만 지우고 클라우드 값으로 바꾼다. 기기 전용 값·토큰은 그대로 둔다.
  const remove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && syncable(key)) remove.push(key);
  }
  for (const key of remove) window.localStorage.removeItem(key);
  for (const [key, value] of entries) window.localStorage.setItem(key, value);
  writeMeta({ lastPulledAt: cloudAt, lastPushedAt: cloudAt, lastLocalChangeAt: null, lastPushedPrint: fingerprint(Object.fromEntries(entries)) });
  announceStorageReplaced();
  return { kind: 'applied', keyCount: entries.length, from: { deviceName: (row.device_name as string | null) ?? null, at: cloudAt } };
}

export interface AutoSyncOptions {
  /** 주기적으로 올리는 간격 (기본 2분). 변경이 없으면 네트워크를 쓰지 않는다. */
  intervalMs?: number;
  onPush?: (r: { keyCount: number; at: string }) => void;
  onError?: (message: string) => void;
}

/**
 * 자동 올리기를 시작한다. 반환값을 호출하면 멈춘다.
 * 변경이 있을 때만 올리고, 탭을 숨기거나 앱을 닫기 직전에도 한 번 올린다 — 마지막 몇 분이 날아가지 않도록.
 */
export function startAutoStateSync(userId: string, opts: AutoSyncOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 2 * 60 * 1000;
  let stopped = false;
  let running = false;

  const push = async (force = false) => {
    if (stopped || running) return;
    if (!force && !needsPush()) return;
    running = true;
    try {
      const r = await pushState(userId, { force });
      if (r.ok) opts.onPush?.({ keyCount: r.keyCount, at: r.at });
      else if (r.message !== '올릴 변경이 없습니다.' && r.message !== '올릴 데이터가 없습니다.') opts.onError?.(r.message);
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(() => void push(), intervalMs);
  const onHide = () => {
    if (document.visibilityState === 'hidden') void push();
  };
  const onBeforeUnload = () => void push();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
