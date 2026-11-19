import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { parseAttachment, type Clan, type ClanAnnouncement, type ClanJoinPolicy, type ClanMember, type ClanMessage, type ClanRole, type ClanInvitation, type MessageAttachment } from './types';

const NOT_CONFIGURED = 'Supabase 설정이 필요합니다.';
const CLAN_COLUMNS =
  'id, name, slug, description, primary_art, avatar_url, banner_url, rules, join_policy, is_public, owner_id, member_count, created_at';

function mapClan(row: Record<string, unknown>, myRole: ClanRole | null): Clan {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string) ?? '',
    primaryArt: (row.primary_art as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    bannerUrl: (row.banner_url as string | null) ?? null,
    rules: (row.rules as string) ?? '',
    joinPolicy: (row.join_policy as ClanJoinPolicy) ?? 'open',
    isPublic: row.is_public !== false,
    ownerId: row.owner_id as string,
    memberCount: (row.member_count as number) ?? 0,
    createdAt: row.created_at as string,
    myRole,
  };
}

/** Roles for the clans this user belongs to — one query, used to annotate lists. */
async function myRoles(userId: string | null, clanIds: string[]): Promise<Map<string, ClanRole>> {
  if (!supabase || !userId || clanIds.length === 0) return new Map();
  const { data } = await supabase.from('clan_members').select('clan_id, role').eq('user_id', userId).in('clan_id', clanIds);
  return new Map((data ?? []).map((r) => [r.clan_id as string, r.role as ClanRole]));
}

export async function listClans(userId: string | null, query = ''): Promise<AuthResult<Clan[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  // RLS already hides non-public clans the viewer isn't in, so no filter here.
  let q = supabase.from('clans').select(CLAN_COLUMNS).order('member_count', { ascending: false }).limit(50);
  if (query.trim()) q = q.ilike('name', `%${query.trim()}%`);
  const { data, error } = await q;
  if (error) return { ok: false, message: error.message };
  const roles = await myRoles(userId, (data ?? []).map((c) => c.id as string));
  return { ok: true, data: (data ?? []).map((c) => mapClan(c, roles.get(c.id as string) ?? null)) };
}

export async function listMyClans(userId: string): Promise<AuthResult<Clan[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data: memberships, error } = await supabase.from('clan_members').select('clan_id, role').eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  const ids = (memberships ?? []).map((m) => m.clan_id as string);
  if (ids.length === 0) return { ok: true, data: [] };
  const { data, error: cErr } = await supabase.from('clans').select(CLAN_COLUMNS).in('id', ids);
  if (cErr) return { ok: false, message: cErr.message };
  const roleById = new Map((memberships ?? []).map((m) => [m.clan_id as string, m.role as ClanRole]));
  return { ok: true, data: (data ?? []).map((c) => mapClan(c, roleById.get(c.id as string) ?? null)) };
}

export async function getClan(clanId: string, userId: string | null): Promise<AuthResult<Clan>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('clans').select(CLAN_COLUMNS).eq('id', clanId).maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: '클랜을 찾을 수 없거나 접근 권한이 없습니다.' };
  const roles = await myRoles(userId, [clanId]);
  return { ok: true, data: mapClan(data, roles.get(clanId) ?? null) };
}

export async function createClan(input: {
  name: string; slug: string; description: string; primaryArt: string | null;
  joinPolicy: ClanJoinPolicy; isPublic: boolean; rules: string;
}): Promise<AuthResult<string>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc('create_clan', {
    p_name: input.name,
    p_slug: input.slug,
    p_description: input.description,
    p_primary_art: input.primaryArt,
    p_join_policy: input.joinPolicy,
    p_is_public: input.isPublic,
    p_rules: input.rules,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, message: '이미 사용 중인 클랜 주소(slug)입니다.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, data: data as string };
}

/** 자유 가입이면 바로 가입, 신청형이면 요청을 남긴다. 초대 전용은 거절된다. */
export async function joinClan(clan: Clan, userId: string): Promise<AuthResult<'joined' | 'requested'>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  if (clan.joinPolicy === 'invite') return { ok: false, message: '초대 전용 클랜입니다.' };
  if (clan.joinPolicy === 'request') {
    const { error } = await supabase.from('clan_join_requests').insert({ clan_id: clan.id, user_id: userId });
    if (error && (error as { code?: string }).code !== '23505') return { ok: false, message: error.message };
    return { ok: true, data: 'requested' };
  }
  const { error } = await supabase.from('clan_members').insert({ clan_id: clan.id, user_id: userId, role: 'member' });
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, message: error.message };
  return { ok: true, data: 'joined' };
}

export async function leaveClan(clanId: string, userId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_members').delete().eq('clan_id', clanId).eq('user_id', userId);
  if (error) return { ok: false, message: '방장은 먼저 방장 권한을 넘겨야 탈퇴할 수 있습니다.' };
  return { ok: true, data: undefined };
}

export async function listMembers(clanId: string): Promise<AuthResult<ClanMember[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('clan_members').select('user_id, role, joined_at').eq('clan_id', clanId).limit(200);
  if (error) return { ok: false, message: error.message };
  const ids = (data ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('user_id, nickname, avatar_url').in('user_id', ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const ORDER: Record<ClanRole, number> = { owner: 0, officer: 1, member: 2 };
  const rows = (data ?? []).map((m) => ({
    userId: m.user_id as string,
    nickname: (byId.get(m.user_id as string)?.nickname as string) ?? '알 수 없음',
    avatarUrl: (byId.get(m.user_id as string)?.avatar_url as string | null) ?? null,
    role: m.role as ClanRole,
    joinedAt: m.joined_at as string,
  }));
  rows.sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.nickname.localeCompare(b.nickname));
  return { ok: true, data: rows };
}

export async function listJoinRequests(clanId: string): Promise<AuthResult<ClanMember[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('clan_join_requests').select('user_id, created_at').eq('clan_id', clanId);
  if (error) return { ok: false, message: error.message };
  const ids = (data ?? []).map((r) => r.user_id as string);
  if (ids.length === 0) return { ok: true, data: [] };
  const { data: profiles } = await supabase.from('profiles').select('user_id, nickname, avatar_url').in('user_id', ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      userId: r.user_id as string,
      nickname: (byId.get(r.user_id as string)?.nickname as string) ?? '알 수 없음',
      avatarUrl: (byId.get(r.user_id as string)?.avatar_url as string | null) ?? null,
      role: 'member' as ClanRole,
      joinedAt: r.created_at as string,
    })),
  };
}

export async function approveJoin(clanId: string, userId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.rpc('approve_clan_join', { p_clan: clanId, p_user: userId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function rejectJoin(clanId: string, userId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_join_requests').delete().eq('clan_id', clanId).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function kickMember(clanId: string, userId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_members').delete().eq('clan_id', clanId).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

/** 부방장 임명/해임 — RPC가 방장 여부를 서버에서 확인한다. */
export async function setRole(clanId: string, userId: string, role: 'officer' | 'member'): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.rpc('set_clan_role', { p_clan: clanId, p_user: userId, p_role: role });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function transferOwnership(clanId: string, toUserId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.rpc('transfer_clan_ownership', { p_clan: clanId, p_to: toUserId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

// ---------- chat ----------
function mapClanMessage(row: Record<string, unknown>, nickname: string): ClanMessage {
  return {
    id: row.id as string,
    clanId: row.clan_id as string,
    senderId: row.sender_id as string,
    senderNickname: nickname,
    body: (row.body as string) ?? '',
    imageUrl: (row.image_url as string | null) ?? null,
    attachment: parseAttachment(row.attachment),
    createdAt: row.created_at as string,
  };
}

export async function listClanMessages(clanId: string, limit = 80): Promise<AuthResult<ClanMessage[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('clan_messages')
    .select('id, clan_id, sender_id, body, image_url, attachment, created_at')
    .eq('clan_id', clanId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, message: error.message };
  const ids = [...new Set((data ?? []).map((m) => m.sender_id as string))];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('user_id, nickname').in('user_id', ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p.nickname as string]));
  return { ok: true, data: (data ?? []).map((m) => mapClanMessage(m, byId.get(m.sender_id as string) ?? '알 수 없음')).reverse() };
}

export async function sendClanMessage(
  clanId: string,
  senderId: string,
  body: string,
  attachment?: MessageAttachment | null,
): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const text = body.trim();
  if (!text && !attachment) return { ok: false, message: '내용을 입력해주세요.' };
  const { error } = await supabase.from('clan_messages').insert({ clan_id: clanId, sender_id: senderId, body: text, attachment: attachment ?? null });
  if (error) {
    if (error.code === '42501') return { ok: false, message: '클랜 회원만 채팅할 수 있습니다.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, data: undefined };
}

export async function deleteClanMessage(messageId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_messages').delete().eq('id', messageId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export function subscribeToClanChat(clanId: string, onInsert: (senderId: string, row: Record<string, unknown>) => void): () => void {
  const client = supabase;
  if (!client) return () => {};
  const channel = client
    .channel(`clan:${clanId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clan_messages', filter: `clan_id=eq.${clanId}` },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        onInsert(row.sender_id as string, row);
      })
    .subscribe();
  return () => { void client.removeChannel(channel); };
}

// ---------- announcements ----------
export async function listAnnouncements(clanId: string): Promise<AuthResult<ClanAnnouncement[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('clan_announcements')
    .select('id, clan_id, author_id, title, body, pinned, created_at')
    .eq('clan_id', clanId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    data: (data ?? []).map((a) => ({
      id: a.id as string, clanId: a.clan_id as string, authorId: a.author_id as string,
      title: a.title as string, body: (a.body as string) ?? '', pinned: !!a.pinned, createdAt: a.created_at as string,
    })),
  };
}

export async function createAnnouncement(clanId: string, authorId: string, title: string, body: string, pinned: boolean): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  if (!title.trim()) return { ok: false, message: '제목을 입력해주세요.' };
  const { error } = await supabase.from('clan_announcements').insert({ clan_id: clanId, author_id: authorId, title: title.trim(), body, pinned });
  if (error) {
    if (error.code === '42501') return { ok: false, message: '방장·부방장만 공지를 작성할 수 있습니다.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, data: undefined };
}

export async function deleteAnnouncement(id: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_announcements').delete().eq('id', id);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

// ---------- 초대 ----------
/** 방장·부방장만 보낼 수 있다 — 권한은 RLS가 확인하므로 여기서는 결과만 번역한다. */
export async function inviteToClan(clanId: string, inviteeId: string, inviterId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_invitations').insert({ clan_id: clanId, invitee_id: inviteeId, inviter_id: inviterId });
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, message: '이미 초대한 사용자입니다.' };
    if (error.code === '42501') return { ok: false, message: '초대 권한이 없거나, 이미 클랜원이거나, 차단된 상대입니다.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, data: undefined };
}

/** 내가 받은 초대 (알림 화면용). */
export async function listMyInvitations(userId: string): Promise<AuthResult<ClanInvitation[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('clan_invitations')
    .select('clan_id, inviter_id, created_at')
    .eq('invitee_id', userId)
    .order('created_at', { ascending: false });
  if (error) return { ok: false, message: error.message };
  const rows = data ?? [];
  if (rows.length === 0) return { ok: true, data: [] };
  const [{ data: clans }, { data: profiles }] = await Promise.all([
    supabase.from('clans').select('id, name').in('id', rows.map((r) => r.clan_id as string)),
    supabase.from('profiles').select('user_id, nickname').in('user_id', rows.map((r) => r.inviter_id as string)),
  ]);
  const clanById = new Map((clans ?? []).map((c) => [c.id as string, c.name as string]));
  const nickById = new Map((profiles ?? []).map((p) => [p.user_id as string, p.nickname as string]));
  return {
    ok: true,
    data: rows.map((r) => ({
      clanId: r.clan_id as string,
      clanName: clanById.get(r.clan_id as string) ?? '(알 수 없는 클랜)',
      inviterId: r.inviter_id as string,
      inviterNickname: nickById.get(r.inviter_id as string) ?? '알 수 없음',
      createdAt: r.created_at as string,
    })),
  };
}

/** 해당 클랜의 보낸 초대 목록 (관리자 화면용). */
export async function listClanInvitations(clanId: string): Promise<AuthResult<ClanMember[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('clan_invitations').select('invitee_id, created_at').eq('clan_id', clanId);
  if (error) return { ok: false, message: error.message };
  const ids = (data ?? []).map((r) => r.invitee_id as string);
  if (ids.length === 0) return { ok: true, data: [] };
  const { data: profiles } = await supabase.from('profiles').select('user_id, nickname, avatar_url').in('user_id', ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      userId: r.invitee_id as string,
      nickname: (byId.get(r.invitee_id as string)?.nickname as string) ?? '알 수 없음',
      avatarUrl: (byId.get(r.invitee_id as string)?.avatar_url as string | null) ?? null,
      role: 'member' as ClanRole,
      joinedAt: r.created_at as string,
    })),
  };
}

export async function acceptInvitation(clanId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.rpc('accept_clan_invitation', { p_clan: clanId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

/** 받은 사람의 거절, 또는 관리자의 취소 — 같은 DELETE 정책을 쓴다. */
export async function cancelInvitation(clanId: string, inviteeId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('clan_invitations').delete().eq('clan_id', clanId).eq('invitee_id', inviteeId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}
