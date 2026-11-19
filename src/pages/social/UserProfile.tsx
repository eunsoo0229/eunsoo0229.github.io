import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Avatar from '../../components/Avatar';
import Icon from '../../components/Icon';
import BottomSheet from '../../components/BottomSheet';
import { useAuth } from '../../lib/auth/AuthProvider';
import { listFeed } from '../../lib/communityPost/service';
import PostCard from '../../components/community/PostCard';
import EvaluationSummaryCard from '../../components/techniqueEvaluation/EvaluationSummaryCard';
import type { CommunityFeedItem } from '../../lib/communityPost/types';
import {
  blockUser, follow, getProfile, getRelation, reportTarget, unblockUser, unfollow,
} from '../../lib/social/profileService';
import { startConversation } from '../../lib/social/dmService';
import { REPORT_REASONS, type ProfileRelation, type PublicProfile } from '../../lib/social/types';

/**
 * Another user's public profile. Everything gated here is ALSO gated by RLS
 * (0045) — hiding a tab is a convenience, not the access control: a private
 * account's posts are unreadable at the database level for anyone who isn't
 * an approved follower.
 */
export default function UserProfile() {
  const { userId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const myId = user?.id ?? null;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [relation, setRelation] = useState<ProfileRelation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [posts, setPosts] = useState<CommunityFeedItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    const p = await getProfile(userId);
    if (!p.ok) { setError(p.message); return; }
    setProfile(p.data);
    const r = await getRelation(myId, userId);
    if (r.ok) setRelation(r.data);
  }, [userId, myId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!relation?.canSeeContent) { setPosts([]); return; }
    setLoadingPosts(true);
    void listFeed(myId, { authorId: userId, limit: 20 }).then((res) => {
      if (res.ok) setPosts(res.data.items);
      setLoadingPosts(false);
    });
  }, [relation?.canSeeContent, userId, myId]);

  async function onFollow() {
    if (!myId || !profile) { navigate('/login'); return; }
    setBusy(true);
    if (relation?.state === 'following' || relation?.state === 'requested') await unfollow(userId, myId);
    else await follow(userId, myId, profile.isPrivate);
    await load();
    setBusy(false);
  }

  async function onMessage() {
    if (!myId) { navigate('/login'); return; }
    setBusy(true);
    const res = await startConversation(userId);
    setBusy(false);
    if (!res.ok) { window.alert(res.message); return; }
    navigate(`/messages/${res.data}`);
  }

  async function onToggleBlock() {
    if (!myId) return;
    const blocking = relation?.state !== 'blocked';
    if (blocking && !window.confirm('이 사용자를 차단할까요? 서로의 팔로우가 해제되고 메시지를 주고받을 수 없습니다.')) return;
    setBusy(true);
    if (blocking) await blockUser(userId, myId); else await unblockUser(userId, myId);
    await load();
    setBusy(false);
  }

  async function onReport(reason: string) {
    if (!myId) return;
    setReportOpen(false);
    const res = await reportTarget(myId, 'user', userId, reason);
    window.alert(res.ok ? '신고가 접수되었습니다.' : res.message);
  }

  if (error) return <div className="page"><div className="container"><BackButton /><EmptyState icon="🔍" text={error} /></div></div>;
  if (!profile) return <div className="page"><div className="container"><BackButton /><EmptyState icon="⏳" text="프로필을 불러오는 중입니다." /></div></div>;

  const isSelf = relation?.state === 'self';
  const followLabel =
    relation?.state === 'following' ? '팔로잉' : relation?.state === 'requested' ? '요청됨' : '팔로우';

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="profile-banner" role="img" aria-label="" />

        <div className="user-profile__head">
          <Avatar className="user-profile__avatar" seed={profile.userId} nickname={profile.nickname} src={profile.avatarUrl} />
          <div className="user-profile__id">
            <h2>{profile.nickname}</h2>
            {profile.handle && <p className="technique-row__sub">@{profile.handle}</p>}
            {relation?.followsMe && !isSelf && <span className="chip">나를 팔로우함</span>}
            {profile.isPrivate && <span className="chip"><Icon name="lock" /> 비공개 계정</span>}
          </div>
        </div>

        <div className="user-profile__stats">
          <div><strong>{profile.postCount}</strong><span>게시물</span></div>
          <Link to={`/u/${userId}/followers`}><strong>{profile.followerCount}</strong><span>팔로워</span></Link>
          <Link to={`/u/${userId}/following`}><strong>{profile.followingCount}</strong><span>팔로잉</span></Link>
        </div>

        {profile.bio && <p className="user-profile__bio">{profile.bio}</p>}
        <div className="chip-row">
          {profile.primaryArt && <span className="chip"><Icon name="gi" /> {profile.primaryArt}</span>}
          {profile.yearsTraining != null && <span className="chip"><Icon name="timer" /> 수련 {profile.yearsTraining}년</span>}
          {profile.gymName && <span className="chip"><Icon name="building" /> {profile.gymName}</span>}
        </div>

        {isSelf ? (
          <div className="modal-actions modal-actions--start">
            <Link to="/profile" className="btn btn-secondary">프로필 편집</Link>
          </div>
        ) : (
          <div className="modal-actions modal-actions--start user-profile__actions">
            <button type="button" className={`btn ${relation?.state === 'following' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => void onFollow()} disabled={busy || relation?.state === 'blocked'}>
              {followLabel}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onMessage()} disabled={busy || relation?.state === 'blocked'}>
              메시지
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onToggleBlock()} disabled={busy}>
              {relation?.state === 'blocked' ? '차단 해제' : '차단'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportOpen(true)}>신고</button>
          </div>
        )}

        {relation?.canSeeContent && userId && <EvaluationSummaryCard userId={userId} isMe={isSelf} />}

        <div className="section-title"><h3><Icon name="list" /> 게시물</h3></div>
        {!relation?.canSeeContent ? (
          <EmptyState icon="🔒" text="비공개 계정입니다. 팔로우 요청이 승인되면 게시물을 볼 수 있습니다." />
        ) : loadingPosts ? (
          <EmptyState icon="⏳" text="불러오는 중입니다." />
        ) : posts.length === 0 ? (
          <EmptyState icon="📭" text="아직 게시물이 없습니다." />
        ) : (
          <div className="stack gap-2">
            {posts.map((item) => (
              <PostCard
                key={item.kind === 'post' ? item.post.id : item.repost.id}
                item={item}
                currentUserId={myId}
                currentUserNickname={null}
                onDeleted={() => void load()}
                onHashtagClick={(tag) => navigate(`/community?hashtag=${encodeURIComponent(tag)}`)}
              />
            ))}
          </div>
        )}

        {reportOpen && (
          <BottomSheet onClose={() => setReportOpen(false)}>
            <h3 style={{ marginTop: 0 }}>신고 사유</h3>
            <div className="stack gap-2">
              {REPORT_REASONS.map((r) => (
                <button key={r} type="button" className="btn btn-secondary" onClick={() => void onReport(r)}>{r}</button>
              ))}
            </div>
          </BottomSheet>
        )}
      </div>
    </div>
  );
}
