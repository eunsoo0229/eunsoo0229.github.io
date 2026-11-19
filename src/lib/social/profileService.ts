import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import type { DmPolicy, FollowRequestRow, ProfileRelation, PublicProfile } from './types';

// Same conventions as communityPost/service.ts — live reads (this is other
// people's data, a local cache would only go stale), never throws, every
// function returns AuthResult.
const NOT_CONFIGURED = 'Supabase 설정이 필요합니다.';

const PROFILE_COLUMNS =
  'user_id, nickname, handle, bio, avatar_url, primary_art, years_training, gym_name, is_private, show_likes, show_reposts, dm_policy, follower_count, following_count, post_count';

export function mapProfile(row: Record<string, unknown>): PublicProfile {
  return {
    userId: row.user_id as string,
    nickname: (row.nickname as string) ?? '',
    handle: (row.handle as string | null) ?? null,
    bio: (row.bio as string) ?? '',
    avatarUrl: (row.avatar_url as string | null) ?? null,
    primaryArt: (row.primary_art as string | null) ?? null,
    yearsTraining: (row.years_training as number | null) ?? null,
    gymName: (row.gym_name as string | null) ?? null,
    isPrivate: !!row.is_private,
    showLikes: !!row.show_likes,
    showReposts: row.show_reposts === undefined ? true : !!row.show_reposts,
    dmPolicy: ((row.dm_policy as string) ?? 'everyone') as DmPolicy,
    followerCount: (row.follower_count as number) ?? 0,
    followingCount: (row.following_count as number) ?? 0,
    postCount: (row.post_count as number) ?? 0,
  };
}

export async function getProfile(userId: string): Promise<AuthResult<PublicProfile>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: '프로필을 찾을 수 없습니다.' };
  return { ok: true, data: mapProfile(data) };
}

export async function searchProfiles(query: string, limit = 20): Promise<AuthResult<PublicProfile[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const q = query.trim();
  if (!q) return { ok: true, data: [] };
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .or(`nickname.ilike.%${q}%,handle.ilike.%${q}%`)
    .limit(limit);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: (data ?? []).map(mapProfile) };
}

export async function updateMyProfile(
  userId: string,
  patch: Partial<Pick<PublicProfile, 'nickname' | 'handle' | 'bio' | 'primaryArt' | 'yearsTraining' | 'gymName' | 'isPrivate' | 'showLikes' | 'showReposts' | 'dmPolicy' | 'avatarUrl'>>,
): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const row: Record<string, unknown> = {};
  if (patch.nickname !== undefined) row.nickname = patch.nickname;
  if (patch.handle !== undefined) row.handle = patch.handle ? patch.handle.toLowerCase().replace(/[^a-z0-9_.]/g, '') : null;
  if (patch.bio !== undefined) row.bio = patch.bio;
  if (patch.primaryArt !== undefined) row.primary_art = patch.primaryArt;
  if (patch.yearsTraining !== undefined) row.years_training = patch.yearsTraining;
  if (patch.gymName !== undefined) row.gym_name = patch.gymName;
  if (patch.isPrivate !== undefined) row.is_private = patch.isPrivate;
  if (patch.showLikes !== undefined) row.show_likes = patch.showLikes;
  if (patch.showReposts !== undefined) row.show_reposts = patch.showReposts;
  if (patch.dmPolicy !== undefined) row.dm_policy = patch.dmPolicy;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (Object.keys(row).length === 0) return { ok: true, data: undefined };
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('profiles').update(row).eq('user_id', userId);
  if (error) {
    // 23505 = the unique index on lower(handle)
    if ((error as { code?: string }).code === '23505') return { ok: false, message: '이미 사용 중인 아이디입니다.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, data: undefined };
}

/**
 * Everything the profile header needs to decide what to render: the follow
 * button's state, whether to show a "맞팔로우" chip, and — for a private
 * account — whether this viewer is allowed past the header at all.
 */
export async function getRelation(viewerId: string | null, targetId: string): Promise<AuthResult<ProfileRelation>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  if (viewerId === targetId) return { ok: true, data: { state: 'self', followsMe: false, canSeeContent: true } };

  const target = await getProfile(targetId);
  if (!target.ok) return { ok: false, message: target.message };

  if (!viewerId) {
    return { ok: true, data: { state: 'none', followsMe: false, canSeeContent: !target.data.isPrivate } };
  }

  const [outgoing, incoming, requested, blocked] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('follower_id', viewerId).eq('following_id', targetId).maybeSingle(),
    supabase.from('follows').select('follower_id').eq('follower_id', targetId).eq('following_id', viewerId).maybeSingle(),
    supabase.from('follow_requests').select('requester_id').eq('requester_id', viewerId).eq('target_id', targetId).maybeSingle(),
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', viewerId).eq('blocked_id', targetId).maybeSingle(),
  ]);

  const isFollowing = !!outgoing.data;
  const state = blocked.data ? 'blocked' : isFollowing ? 'following' : requested.data ? 'requested' : 'none';
  return {
    ok: true,
    data: {
      state,
      followsMe: !!incoming.data,
      canSeeContent: !target.data.isPrivate || isFollowing,
    },
  };
}

export async function follow(targetId: string, viewerId: string, targetIsPrivate: boolean): Promise<AuthResult<'following' | 'requested'>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  if (targetIsPrivate) {
    const { error } = await supabase.from('follow_requests').insert({ requester_id: viewerId, target_id: targetId });
    if (error && (error as { code?: string }).code !== '23505') return { ok: false, message: error.message };
    return { ok: true, data: 'requested' };
  }
  const { error } = await supabase.from('follows').insert({ follower_id: viewerId, following_id: targetId });
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, message: error.message };
  return { ok: true, data: 'following' };
}

export async function unfollow(targetId: string, viewerId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  await supabase.from('follow_requests').delete().eq('requester_id', viewerId).eq('target_id', targetId);
  const { error } = await supabase.from('follows').delete().eq('follower_id', viewerId).eq('following_id', targetId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function listFollowers(userId: string, limit = 50): Promise<AuthResult<PublicProfile[]>> {
  return listEdge('following_id', 'follower_id', userId, limit);
}

export async function listFollowing(userId: string, limit = 50): Promise<AuthResult<PublicProfile[]>> {
  return listEdge('follower_id', 'following_id', userId, limit);
}

async function listEdge(matchCol: string, pickCol: string, userId: string, limit: number): Promise<AuthResult<PublicProfile[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('follows').select(pickCol).eq(matchCol, userId).order('created_at', { ascending: false }).limit(limit);
  if (error) return { ok: false, message: error.message };
  const ids = (data ?? []).map((r) => (r as unknown as Record<string, string>)[pickCol]).filter(Boolean);
  if (ids.length === 0) return { ok: true, data: [] };
  const { data: profiles, error: pErr } = await supabase.from('profiles').select(PROFILE_COLUMNS).in('user_id', ids);
  if (pErr) return { ok: false, message: pErr.message };
  // keep the follow order, not the arbitrary order the IN query returns
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, mapProfile(p)]));
  return { ok: true, data: ids.map((id) => byId.get(id)).filter((p): p is PublicProfile => !!p) };
}

export async function listIncomingFollowRequests(userId: string): Promise<AuthResult<FollowRequestRow[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.from('follow_requests').select('requester_id, created_at').eq('target_id', userId).order('created_at', { ascending: false }).limit(50);
  if (error) return { ok: false, message: error.message };
  const ids = (data ?? []).map((r) => r.requester_id as string);
  if (ids.length === 0) return { ok: true, data: [] };
  const { data: profiles } = await supabase.from('profiles').select('user_id, nickname, avatar_url').in('user_id', ids);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return {
    ok: true,
    data: (data ?? []).map((r) => {
      const p = byId.get(r.requester_id as string);
      return {
        userId: r.requester_id as string,
        nickname: (p?.nickname as string) ?? '알 수 없음',
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        createdAt: r.created_at as string,
      };
    }),
  };
}

export async function approveFollowRequest(requesterId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.rpc('approve_follow_request', { p_requester: requesterId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function rejectFollowRequest(requesterId: string, myId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('follow_requests').delete().eq('requester_id', requesterId).eq('target_id', myId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function blockUser(targetId: string, viewerId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  // 차단하면 양쪽 팔로우 관계를 끊는다 — 차단 상태로 팔로워가 남아 있으면
  // 비공개 게시물이 계속 보인다.
  await supabase.from('follows').delete().eq('follower_id', viewerId).eq('following_id', targetId);
  await supabase.from('follows').delete().eq('follower_id', targetId).eq('following_id', viewerId);
  const { error } = await supabase.from('user_blocks').insert({ blocker_id: viewerId, blocked_id: targetId });
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function unblockUser(targetId: string, viewerId: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('user_blocks').delete().eq('blocker_id', viewerId).eq('blocked_id', targetId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

export async function reportTarget(
  reporterId: string,
  targetType: 'user' | 'post' | 'comment' | 'message' | 'clan',
  targetId: string,
  reason: string,
  detail = '',
): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.from('user_reports').insert({
    reporter_id: reporterId, target_type: targetType, target_id: targetId, reason, detail,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}
