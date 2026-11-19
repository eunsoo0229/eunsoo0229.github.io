import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Icon, { type IconName } from '../../components/Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { listNotifications, markAllRead } from '../../lib/social/notificationService';
import { approveFollowRequest, listIncomingFollowRequests, rejectFollowRequest } from '../../lib/social/profileService';
import { acceptInvitation, cancelInvitation, listMyInvitations } from '../../lib/social/clanService';
import { timeAgo } from '../../components/community/CommentsSheet';
import type { AppNotification, ClanInvitation, FollowRequestRow, NotificationType } from '../../lib/social/types';

const ICON: Record<NotificationType, IconName> = {
  follow: 'users', follow_request: 'users', like: 'check', comment: 'bot',
  repost: 'repeat', message: 'bot', clan_invite: 'users', clan_join: 'users',
  link: 'link', purchase: 'cart', review: 'check',
};

/** 'like'는 게시물과 콤보 양쪽에 쓰이므로 entityType으로 문구를 가른다. */
function labelFor(n: AppNotification): string {
  switch (n.type) {
    case 'follow': return '님이 회원님을 팔로우하기 시작했습니다.';
    case 'follow_request': return '님이 팔로우를 요청했습니다.';
    case 'like': return n.entityType === 'combo'
      ? '님이 회원님의 콤보·셋업을 좋아합니다.'
      : '님이 회원님의 게시물을 좋아합니다.';
    case 'comment': return '님이 회원님의 게시물에 댓글을 남겼습니다.';
    case 'repost': return '님이 회원님의 게시물을 리포스트했습니다.';
    case 'message': return '님이 메시지를 보냈습니다.';
    case 'clan_invite': return '님이 클랜에 초대했습니다.';
    case 'clan_join': return '클랜 가입이 승인되었습니다.';
    case 'link': return '님이 회원님의 콤보·셋업을 자신의 흐름에 연결했습니다.';
    case 'purchase': return '님이 회원님의 커리큘럼을 구매했습니다.';
    case 'review': return '님이 회원님의 커리큘럼에 리뷰를 남겼습니다.';
  }
}

function linkFor(n: AppNotification): string {
  if (n.entityType === 'conversation') return `/messages/${n.entityId}`;
  if (n.entityType === 'clan') return `/clans/${n.entityId}`;
  if (n.entityType === 'post') return `/community/post/${n.entityId}`;
  if (n.entityType === 'combo') return `/user-combos/${n.entityId}`;
  if (n.entityType === 'curriculum') return `/marketplace/${n.entityId}`;
  if (n.actorId) return `/u/${n.actorId}`;
  return '/notifications';
}

export default function Notifications() {
  const { user, isConfigured } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AppNotification[] | null>(null);
  const [requests, setRequests] = useState<FollowRequestRow[]>([]);
  const [invites, setInvites] = useState<ClanInvitation[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const [n, r, i] = await Promise.all([
      listNotifications(user.id),
      listIncomingFollowRequests(user.id),
      listMyInvitations(user.id),
    ]);
    setRows(n.ok ? n.data : []);
    setRequests(r.ok ? r.data : []);
    setInvites(i.ok ? i.data : []);
    await markAllRead(user.id);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  if (!isConfigured) return <div className="page"><div className="container"><BackButton /><EmptyState icon="🌐" text="알림을 사용하려면 Supabase 설정이 필요합니다." /></div></div>;
  if (!user) {
    return (
      <div className="page"><div className="container"><BackButton />
        <EmptyState icon="🔒" text="알림은 로그인 후 이용할 수 있습니다." />
        <div className="modal-actions modal-actions--start"><button className="btn btn-primary" onClick={() => navigate('/login')}>로그인</button></div>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="section-title"><h2><Icon name="spark" /> 알림</h2></div>

        {invites.length > 0 && (
          <>
            <div className="section-title"><h3><Icon name="users" /> 클랜 초대 {invites.length}</h3></div>
            <div className="stack gap-2">
              {invites.map((v) => (
                <div key={v.clanId} className="technique-row">
                  <div className="technique-row__main">
                    <Link to={`/clans/${v.clanId}`} className="technique-row__name">{v.clanName}</Link>
                    <div className="technique-row__sub">{v.inviterNickname}님의 초대 · {timeAgo(v.createdAt)}</div>
                  </div>
                  <div className="technique-row__right">
                    <button className="btn btn-primary btn-sm" data-testid="invite-accept" onClick={async () => {
                      const res = await acceptInvitation(v.clanId);
                      if (!res.ok) { window.alert(res.message); return; }
                      navigate(`/clans/${v.clanId}`);
                    }}>수락</button>
                    <button className="btn btn-ghost btn-sm" onClick={async () => { await cancelInvitation(v.clanId, user.id); void load(); }}>거절</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {requests.length > 0 && (
          <>
            <div className="section-title"><h3><Icon name="users" /> 팔로우 요청 {requests.length}</h3></div>
            <div className="stack gap-2">
              {requests.map((r) => (
                <div key={r.userId} className="technique-row">
                  <div className="technique-row__main">
                    <Link to={`/u/${r.userId}`} className="technique-row__name">{r.nickname}</Link>
                    <div className="technique-row__sub">{timeAgo(r.createdAt)}</div>
                  </div>
                  <div className="technique-row__right">
                    <button className="btn btn-primary btn-sm" onClick={async () => { await approveFollowRequest(r.userId); void load(); }}>승인</button>
                    <button className="btn btn-ghost btn-sm" onClick={async () => { await rejectFollowRequest(r.userId, user.id); void load(); }}>거절</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {rows === null ? (
          <EmptyState icon="⏳" text="불러오는 중입니다." />
        ) : rows.length === 0 ? (
          <EmptyState icon="📭" art="no-notifications" text="아직 알림이 없습니다." />
        ) : (
          <div className="stack gap-2">
            {rows.map((n) => (
              <Link key={n.id} to={linkFor(n)} className="technique-row">
                <span className="notif__icon"><Icon name={ICON[n.type]} /></span>
                <div className="technique-row__main">
                  <div className="technique-row__name">
                    {n.actorNickname ?? '알 수 없음'}{labelFor(n)}
                  </div>
                  <div className="technique-row__sub">{n.body ? `${n.body} · ` : ''}{timeAgo(n.createdAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
