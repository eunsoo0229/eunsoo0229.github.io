/** 공개 프로필 — profiles 테이블의 공개 가능한 컬럼만. */
export interface PublicProfile {
  userId: string;
  nickname: string;
  handle: string | null;
  bio: string;
  avatarUrl: string | null;
  primaryArt: string | null;
  yearsTraining: number | null;
  gymName: string | null;
  isPrivate: boolean;
  showLikes: boolean;
  showReposts: boolean;
  dmPolicy: DmPolicy;
  followerCount: number;
  followingCount: number;
  postCount: number;
}

export type DmPolicy = 'everyone' | 'followers' | 'nobody';

/** 내가 이 사람과 어떤 관계인가 — 버튼 상태를 결정한다. */
export type FollowState = 'none' | 'following' | 'requested' | 'self' | 'blocked';

export interface ProfileRelation {
  state: FollowState;
  /** 상대가 나를 팔로우하는가 (맞팔 표시용) */
  followsMe: boolean;
  /** 비공개 계정이고 내가 승인된 팔로워가 아니면 콘텐츠를 숨긴다 */
  canSeeContent: boolean;
}

export interface FollowRequestRow {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  otherUserId: string;
  otherNickname: string;
  otherAvatarUrl: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  state: 'accepted' | 'request';
  muted: boolean;
}

/**
 * Something shared into a DM or clan chat. This is a REFERENCE plus a
 * display snapshot, never a copy of the content: tapping it re-reads the
 * original, so the recipient still only sees what RLS lets them see. The
 * snapshot fields are sender-authored text and must be rendered as text.
 */
export type MessageAttachment =
  /** community_posts.id — visibility is decided by the 0045 policy on open. */
  | { kind: 'post'; id: string; title: string }
  /** shared_combos.id — publicly readable. */
  | { kind: 'combo'; id: string; name: string; comboKind: 'combo' | 'setup'; martialArt: string | null }
  /** A technique from data/processed/*.json — static, always readable. */
  | { kind: 'technique'; id: string; name: string; martialArt: string }
  /**
   * `curricula` is own-row-only (0002), so an id would be useless to the
   * recipient. The app's existing share code travels instead and the
   * recipient imports a copy.
   */
  | { kind: 'curriculum'; title: string; martialArt: string; totalDays: number; techniqueCount: number; shareCode: string }
  /** gear_listings.id (0057) — the recipient opens the live listing, which RLS still gates. */
  | { kind: 'gear'; id: string; title: string; price: number }
  /** gym_listings.id (0058) — only approved listings open for other users. */
  | { kind: 'gym'; id: string; name: string; region: string }
  /** A marketplace curriculum listing id — the detail screen re-reads it. */
  | { kind: 'market'; id: string; title: string; martialArt: string; price: number };

export const ATTACHMENT_LABEL: Record<MessageAttachment['kind'], string> = {
  post: '게시물',
  combo: '콤보·셋업',
  technique: '기술',
  curriculum: '커리큘럼',
  gear: '장비 상품',
  gym: '체육관',
  market: '마켓 커리큘럼',
};

/** Narrow an untrusted jsonb value from the database into an attachment. */
export function parseAttachment(v: unknown): MessageAttachment | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : null);
  switch (a.kind) {
    case 'post':
      return str('id') && str('title') ? { kind: 'post', id: a.id as string, title: a.title as string } : null;
    case 'combo':
      return str('id') && str('name')
        ? { kind: 'combo', id: a.id as string, name: a.name as string,
            comboKind: a.comboKind === 'setup' ? 'setup' : 'combo',
            martialArt: str('martialArt') }
        : null;
    case 'technique':
      return str('id') && str('name')
        ? { kind: 'technique', id: a.id as string, name: a.name as string, martialArt: str('martialArt') ?? '' }
        : null;
    case 'curriculum':
      return str('title') && str('shareCode')
        ? { kind: 'curriculum', title: a.title as string, martialArt: str('martialArt') ?? '',
            totalDays: typeof a.totalDays === 'number' ? a.totalDays : 0,
            techniqueCount: typeof a.techniqueCount === 'number' ? a.techniqueCount : 0,
            shareCode: a.shareCode as string }
        : null;
    case 'gear':
      return str('id') && str('title')
        ? { kind: 'gear', id: a.id as string, title: a.title as string, price: typeof a.price === 'number' ? a.price : 0 }
        : null;
    case 'gym':
      return str('id') && str('name')
        ? { kind: 'gym', id: a.id as string, name: a.name as string, region: str('region') ?? '' }
        : null;
    case 'market':
      return str('id') && str('title')
        ? { kind: 'market', id: a.id as string, title: a.title as string, martialArt: str('martialArt') ?? '',
            price: typeof a.price === 'number' ? a.price : 0 }
        : null;
    default:
      return null;
  }
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  imageUrl: string | null;
  attachment: MessageAttachment | null;
  createdAt: string;
}

export type ClanJoinPolicy = 'open' | 'request' | 'invite';
export type ClanRole = 'owner' | 'officer' | 'member';

export interface Clan {
  id: string;
  name: string;
  slug: string;
  description: string;
  primaryArt: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  rules: string;
  joinPolicy: ClanJoinPolicy;
  isPublic: boolean;
  ownerId: string;
  memberCount: number;
  createdAt: string;
  /** 내 직책 — 비회원이면 null */
  myRole: ClanRole | null;
}

export interface ClanMember {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: ClanRole;
  joinedAt: string;
}

export interface ClanInvitation {
  clanId: string;
  clanName: string;
  inviterId: string;
  inviterNickname: string;
  createdAt: string;
}

export interface ClanMessage {
  id: string;
  clanId: string;
  senderId: string;
  senderNickname: string;
  body: string;
  imageUrl: string | null;
  attachment: MessageAttachment | null;
  createdAt: string;
}

export interface ClanAnnouncement {
  id: string;
  clanId: string;
  authorId: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

export type NotificationType =
  | 'follow' | 'follow_request' | 'like' | 'comment'
  | 'repost' | 'message' | 'clan_invite' | 'clan_join'
  /** 내 콤보·셋업을 다른 사람이 자기 흐름에 연결 */
  | 'link'
  /** 마켓에서 내 커리큘럼이 팔림 / 리뷰가 달림 */
  | 'purchase' | 'review';

export interface AppNotification {
  id: string;
  type: NotificationType;
  actorId: string | null;
  actorNickname: string | null;
  entityType: string | null;
  entityId: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export const REPORT_REASONS = [
  '스팸 또는 광고',
  '괴롭힘 또는 혐오',
  '부적절한 콘텐츠',
  '위험한 기술 정보',
  '사칭',
  '기타',
] as const;
