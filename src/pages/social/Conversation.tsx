import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import SharePicker from '../../components/social/SharePicker';
import AttachmentCard from '../../components/social/AttachmentCard';
import { useAuth } from '../../lib/auth/AuthProvider';
import {
  acceptRequest, leaveConversation, listConversations, listMessages, markRead,
  sendMessage, setMuted, subscribeToConversation,
} from '../../lib/social/dmService';
import type { Conversation as Conv, DirectMessage, MessageAttachment } from '../../lib/social/types';

/**
 * One 1:1 thread. History always comes from the database; the realtime
 * channel only appends. If the socket drops, reopening the screen still
 * shows every message (요구사항 2: 실시간 전달과 기록 저장을 분리).
 */
export default function Conversation() {
  const { conversationId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const myId = user?.id ?? null;

  const [meta, setMeta] = useState<Conv | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<MessageAttachment | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadMeta = useCallback(async () => {
    if (!myId) return;
    for (const state of ['accepted', 'request'] as const) {
      const res = await listConversations(myId, state);
      if (res.ok) {
        const found = res.data.find((c) => c.id === conversationId);
        if (found) { setMeta(found); return; }
      }
    }
  }, [myId, conversationId]);

  useEffect(() => {
    if (!myId) return;
    void loadMeta();
    void listMessages(conversationId).then((res) => {
      if (res.ok) setMessages(res.data); else setError(res.message);
    });
    void markRead(conversationId, myId);
  }, [conversationId, myId, loadMeta]);

  useEffect(() => {
    if (!myId) return;
    return subscribeToConversation(conversationId, (m) => {
      // the sender already appended its own message optimistically
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.senderId !== myId) void markRead(conversationId, myId);
    });
  }, [conversationId, myId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  async function onSend() {
    if (!myId || sending) return;
    if (!text.trim() && !pending) return;
    setSending(true);
    const res = await sendMessage(conversationId, myId, text, null, pending);
    setSending(false);
    if (!res.ok) { setError(res.message); return; }
    setText('');
    setPending(null);
    setMessages((prev) => (prev.some((x) => x.id === res.data.id) ? prev : [...prev, res.data]));
  }

  if (!myId) return <div className="page"><div className="container"><BackButton /><EmptyState icon="🔒" text="로그인이 필요합니다." /></div></div>;

  return (
    <div className="page">
      <div className="container dm">
        <BackButton />
        <div className="section-title">
          <h2>
            {meta ? <Link to={`/u/${meta.otherUserId}`}>{meta.otherNickname}</Link> : '대화'}
          </h2>
          {meta && (
            <div className="chip-row">
              <button type="button" className="chip" onClick={() => void setMuted(conversationId, myId, !meta.muted).then(loadMeta)}>
                {meta.muted ? '알림 켜기' : '알림 끄기'}
              </button>
              <button
                type="button"
                className="chip"
                onClick={async () => {
                  if (!window.confirm('이 대화방을 나갈까요? 내 목록에서만 사라집니다.')) return;
                  await leaveConversation(conversationId, myId);
                  navigate('/messages');
                }}
              >
                나가기
              </button>
            </div>
          )}
        </div>

        {meta?.state === 'request' && (
          <div className="card info-card">
            <p style={{ margin: 0 }}>모르는 사용자의 메시지 요청입니다. 수락하면 대화 목록으로 옮겨집니다.</p>
            <div className="modal-actions modal-actions--start">
              <button className="btn btn-primary btn-sm" onClick={() => void acceptRequest(conversationId, myId).then(loadMeta)}>수락</button>
              <button className="btn btn-ghost btn-sm" onClick={async () => { await leaveConversation(conversationId, myId); navigate('/messages'); }}>삭제</button>
            </div>
          </div>
        )}

        <div className="dm__thread" data-testid="dm-thread">
          {messages.length === 0 ? (
            <EmptyState icon="📭" art="no-messages" text="아직 메시지가 없습니다." />
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`dm__row${m.senderId === myId ? ' dm__row--mine' : ''}`}>
                <div className="dm__bubble">
                  {m.imageUrl && <img src={m.imageUrl} alt="" className="dm__image" loading="lazy" />}
                  {m.attachment && <AttachmentCard attachment={m.attachment} />}
                  {m.body && <p>{m.body}</p>}
                  <time>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        {error && <p className="video-status-message"><Icon name="warn" /> {error}</p>}

        {pending && (
          <div className="dm__pending">
            <AttachmentCard attachment={pending} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>첨부 취소</button>
          </div>
        )}

        <div className="dm__composer">
          <button type="button" className="icon-btn" title="공유할 항목 첨부" onClick={() => setPickerOpen(true)} data-testid="dm-share">
            <Icon name="plus" />
          </button>
          <input
            className="field-full"
            value={text}
            placeholder="메시지를 입력하세요"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSend(); } }}
            data-testid="dm-input"
          />
          <button className="btn btn-primary" onClick={() => void onSend()} disabled={sending || (!text.trim() && !pending)} data-testid="dm-send">보내기</button>
        </div>

        {pickerOpen && (
          <SharePicker viewerId={myId} onClose={() => setPickerOpen(false)} onPick={(a) => { setPending(a); setPickerOpen(false); }} />
        )}
      </div>
    </div>
  );
}
