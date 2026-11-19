import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Avatar from '../../components/Avatar';
import { listFollowers, listFollowing } from '../../lib/social/profileService';
import type { PublicProfile } from '../../lib/social/types';

/** /u/:userId/followers and /u/:userId/following — same list, two sources. */
export default function FollowList() {
  const { userId = '' } = useParams();
  const { pathname } = useLocation();
  const mode: 'followers' | 'following' = pathname.endsWith('/following') ? 'following' : 'followers';
  const [rows, setRows] = useState<PublicProfile[] | null>(null);

  useEffect(() => {
    setRows(null);
    const run = mode === 'followers' ? listFollowers : listFollowing;
    void run(userId).then((res) => setRows(res.ok ? res.data : []));
  }, [userId, mode]);

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="section-title"><h2>{mode === 'followers' ? '팔로워' : '팔로잉'}</h2></div>
        {rows === null ? (
          <EmptyState icon="⏳" text="불러오는 중입니다." />
        ) : rows.length === 0 ? (
          <EmptyState icon="👥" text={mode === 'followers' ? '아직 팔로워가 없습니다.' : '아직 팔로우한 사람이 없습니다.'} />
        ) : (
          <div className="stack gap-2">
            {rows.map((p) => (
              <Link key={p.userId} to={`/u/${p.userId}`} className="technique-row">
                <Avatar className="cmt__avatar" seed={p.userId} nickname={p.nickname} src={p.avatarUrl} />
                <div className="technique-row__main">
                  <div className="technique-row__name">{p.nickname}</div>
                  <div className="technique-row__sub">
                    {p.handle ? `@${p.handle} · ` : ''}팔로워 {p.followerCount}
                    {p.primaryArt ? ` · ${p.primaryArt}` : ''}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
