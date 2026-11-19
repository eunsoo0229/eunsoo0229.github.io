import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import type { AppNotification, NotificationType } from './types';

const NOT_CONFIGURED = 'Supabase 설정이 필요합니다.';

export async function listNotifications(userId: string, limit = 50): Promise<AuthResult<AppNotification[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, actor_id, entity_type, entity_id, body, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, message: error.message };
  const actorIds = [...new Set((data ?? []).map((n) => n.actor_id as string).filter(Boolean))];
  const { data: profiles } = actorIds.length
    ? await supabase.from('profiles').select('user_id, nickname').in('user_id', actorIds)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p.nickname as string]));
  return {
    ok: true,
    data: (data ?? []).map((n) => ({
      id: n.id as string,
      type: n.type as NotificationType,
      actorId: (n.actor_id as string | null) ?? null,
      actorNickname: n.actor_id ? byId.get(n.actor_id as string) ?? null : null,
      entityType: (n.entity_type as string | null) ?? null,
      entityId: (n.entity_id as string | null) ?? null,
      body: (n.body as string) ?? '',
      readAt: (n.read_at as string | null) ?? null,
      createdAt: n.created_at as string,
    })),
  };
}

export async function unreadCount(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  return count ?? 0;
}

/** The newest unread clan invitation notification — what the header announces. */
export async function latestUnreadClanInvite(userId: string): Promise<{ id: string; clanId: string | null; clanName: string; createdAt: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('notifications')
    .select('id, entity_id, body, created_at')
    .eq('user_id', userId)
    .eq('type', 'clan_invite')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const n = data?.[0];
  if (!n) return null;
  return { id: n.id as string, clanId: (n.entity_id as string | null) ?? null, clanName: (n.body as string) ?? '', createdAt: n.created_at as string };
}

/** Fired after notifications are marked read, so the header badge refreshes at once. */
export const NOTIFICATIONS_READ_EVENT = 'martialdex:notifications-read';

export async function markAllRead(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
}
