import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { parseAttachment, type Conversation, type DirectMessage, type MessageAttachment } from './types';

const NOT_CONFIGURED = 'Supabase 설정이 필요합니다.';

function mapMessage(row: Record<string, unknown>): DirectMessage {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    senderId: row.sender_id as string,
    body: (row.body as string) ?? '',
    imageUrl: (row.image_url as string | null) ?? null,
    attachment: parseAttachment(row.attachment),
    createdAt: row.created_at as string,
  };
}

/**
 * Conversation list. `state` splits the inbox: 'accepted' is the normal
 * list, 'request' is the 메시지 요청함 for people the user doesn't follow
 * (the split is decided server-side in start_conversation()).
 */
export async function listConversations(myId: string, state: 'accepted' | 'request' = 'accepted'): Promise<AuthResult<Conversation[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data: mine, error } = await supabase
    .from('conversation_members')
    .select('conversation_id, state, muted, last_read_at')
    .eq('user_id', myId)
    .eq('state', state);
  if (error) return { ok: false, message: error.message };
  const ids = (mine ?? []).map((m) => m.conversation_id as string);
  if (ids.length === 0) return { ok: true, data: [] };

  const [{ data: convs }, { data: others }] = await Promise.all([
    supabase.from('conversations').select('id, last_message_at, last_message_preview').in('id', ids),
    supabase.from('conversation_members').select('conversation_id, user_id').in('conversation_id', ids).neq('user_id', myId),
  ]);

  const otherIds = [...new Set((others ?? []).map((o) => o.user_id as string))];
  const { data: profiles } = otherIds.length
    ? await supabase.from('profiles').select('user_id, nickname, avatar_url').in('user_id', otherIds)
    : { data: [] as Record<string, unknown>[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const otherByConv = new Map((others ?? []).map((o) => [o.conversation_id as string, o.user_id as string]));
  const memberByConv = new Map((mine ?? []).map((m) => [m.conversation_id as string, m]));

  // Unread = messages newer than my last_read_at, sent by the other person.
  const unread = await Promise.all(
    ids.map(async (id) => {
      const since = (memberByConv.get(id)?.last_read_at as string) ?? '1970-01-01';
      const { count } = await supabase!
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', id)
        .neq('sender_id', myId)
        .gt('created_at', since);
      return [id, count ?? 0] as const;
    }),
  );
  const unreadByConv = new Map(unread);

  const rows: Conversation[] = (convs ?? []).map((c) => {
    const otherId = otherByConv.get(c.id as string) ?? '';
    const p = profileById.get(otherId);
    const m = memberByConv.get(c.id as string);
    return {
      id: c.id as string,
      otherUserId: otherId,
      otherNickname: (p?.nickname as string) ?? '알 수 없는 사용자',
      otherAvatarUrl: (p?.avatar_url as string | null) ?? null,
      lastMessageAt: c.last_message_at as string,
      lastMessagePreview: (c.last_message_preview as string) ?? '',
      unreadCount: unreadByConv.get(c.id as string) ?? 0,
      state: (m?.state as 'accepted' | 'request') ?? 'accepted',
      muted: !!m?.muted,
    };
  });
  rows.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return { ok: true, data: rows };
}

/** Opens (or reuses) the 1:1 conversation. The recipient's dm_policy and any
 *  block are enforced inside the RPC, not here. */
export async function startConversation(otherUserId: string): Promise<AuthResult<string>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc('start_conversation', { p_other: otherUserId });
  if (error) return { ok: false, message: toKoreanDmError(error.message) };
  return { ok: true, data: data as string };
}

function toKoreanDmError(raw: string): string {
  if (raw.includes('blocked')) return '차단된 상대에게는 메시지를 보낼 수 없습니다.';
  if (raw.includes('does not accept messages')) return '이 사용자는 메시지를 받지 않습니다.';
  if (raw.includes('only accepts messages')) return '이 사용자는 팔로우한 사람에게만 메시지를 받습니다.';
  if (raw.includes('cannot message yourself')) return '자기 자신에게는 보낼 수 없습니다.';
  return raw;
}

export async function listMessages(conversationId: string, limit = 60): Promise<AuthResult<DirectMessage[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, image_url, attachment, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: (data ?? []).map(mapMessage).reverse() };
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
  imageUrl?: string | null,
  attachment?: MessageAttachment | null,
): Promise<AuthResult<DirectMessage>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const text = body.trim();
  // 첨부만 보내는 것도 허용한다 (본문 없이 기술/콤보 공유)
  if (!text && !imageUrl && !attachment) return { ok: false, message: '내용을 입력해주세요.' };
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body: text, image_url: imageUrl ?? null, attachment: attachment ?? null })
    .select('id, conversation_id, sender_id, body, image_url, attachment, created_at')
    .single();
  if (error) {
    // RLS rejects non-members and blocked pairs — the row never lands.
    if (error.code === '42501') return { ok: false, message: '이 대화에 메시지를 보낼 수 없습니다.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, data: mapMessage(data) };
}

export async function markRead(conversationId: string, myId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', myId);
}

export async function acceptRequest(conversationId: string, myId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase
    .from('conversation_members')
    .update({ state: 'accepted' })
    .eq('conversation_id', conversationId)
    .eq('user_id', myId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function setMuted(conversationId: string, myId: string, muted: boolean): Promise<void> {
  if (!supabase) return;
  await supabase.from('conversation_members').update({ muted }).eq('conversation_id', conversationId).eq('user_id', myId);
}

/** 대화방 나가기 — 내 멤버 행만 지운다. 기록은 상대방 쪽에 남는다. */
export async function leaveConversation(conversationId: string, myId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('conversation_members').delete().eq('conversation_id', conversationId).eq('user_id', myId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

/**
 * Realtime delivery. Messages are persisted first and read back through
 * listMessages(), so a dropped socket only costs live delivery — the
 * history is always in the database (요구사항 2: 실시간 전달과 기록 저장 분리).
 */
export function subscribeToConversation(conversationId: string, onInsert: (m: DirectMessage) => void): () => void {
  const client = supabase;
  if (!client) return () => {};
  const channel = client
    .channel(`dm:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(mapMessage(payload.new as Record<string, unknown>)),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
