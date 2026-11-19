import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Avatar from '../../components/Avatar';
import Icon from '../../components/Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { listConversations } from '../../lib/social/dmService';
import { timeAgo } from '../../components/community/CommentsSheet';
import type { Conversation } from '../../lib/social/types';

/** 대화 목록 + 메시지 요청함. 요청함은 내가 팔로우하지 않는 사람의 첫 대화다. */
export default function Messages() {
  const { user, isConfigured } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'accepted' | 'request'>('accepted');
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [requestCount, setRequestCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setRows(null);
    const [main, req] = await Promise.all([listConversations(user.id, tab), listConversations(user.id, 'request')]);
    setRows(main.ok ? main.data : []);
    setRequestCount(req.ok ? req.data.length : 0);
  }, [user, tab]);

  useEffect(() => { void load(); }, [load]);

  if (!isConfigured) return <div className="page"><div className="container"><BackButton /><EmptyState icon="🌐" text="메시지를 사용하려면 Supabase 설정이 필요합니다." /></div></div>;
  if (!user) {
    return (
      <div className="page"><div className="container"><BackButton />
        <EmptyState icon="🔒" text="메시지는 로그인 후 이용할 수 있습니다." />
        <div className="modal-actions modal-actions--start"><button className="btn btn-primary" onClick={() => navigate('/login')}>로그인</button></div>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="section-title"><h2><Icon name="bot" /> 메시지</h2></div>
        <div className="chip-row">
          <button type="button" className={`chip${tab === 'accepted' ? ' active' : ''}`} onClick={() => setTab('accepted')}>대화</button>
          <button type="button" className={`chip${tab === 'request' ? ' active' : ''}`} onClick={() => setTab('request')}>
            요청{requestCount > 0 ? ` ${requestCount}` : ''}
          </button>
        </div>

        {rows === null ? (
          <EmptyState icon="⏳" text="불러오는 중입니다." />
        ) : rows.length === 0 ? (
          <EmptyState icon="📭" art="no-messages" text={tab === 'accepted' ? '아직 주고받은 메시지가 없습니다. 프로필에서 "메시지"를 눌러 시작해보세요.' : '메시지 요청이 없습니다.'} />
        ) : (
          <div className="stack gap-2">
            {rows.map((c) => (
              <Link key={c.id} to={`/messages/${c.id}`} className="technique-row">
                <Avatar className="cmt__avatar" seed={c.otherUserId} nickname={c.otherNickname} src={c.otherAvatarUrl} />
                <div className="technique-row__main">
                  <div className="technique-row__name">
                    {c.otherNickname}
                    {c.unreadCount > 0 && <span className="chip active" style={{ marginLeft: 6 }}>{c.unreadCount}</span>}
                  </div>
                  <div className="technique-row__sub">{c.lastMessagePreview || '(사진)'}</div>
                </div>
                <div className="technique-row__right"><span className="technique-row__sub">{timeAgo(c.lastMessageAt)}</span></div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
