import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Avatar from '../../components/Avatar';
import Icon, { Glyph } from '../../components/Icon';
import ArtIcon from '../../components/ArtIcon';
import SharePicker from '../../components/social/SharePicker';
import InviteSheet from '../../components/social/InviteSheet';
import AttachmentCard from '../../components/social/AttachmentCard';
import { getMartialArt } from '../../lib/loadData';
import { useAuth } from '../../lib/auth/AuthProvider';
import {
  approveJoin, cancelInvitation, createAnnouncement, deleteAnnouncement, deleteClanMessage, getClan,
  joinClan, kickMember, leaveClan, listAnnouncements, listClanInvitations, listClanMessages,
  listJoinRequests, listMembers, rejectJoin, sendClanMessage, setRole, subscribeToClanChat,
  transferOwnership,
} from '../../lib/social/clanService';
import type { Clan, ClanAnnouncement, ClanMember, ClanMessage, MessageAttachment } from '../../lib/social/types';

type Tab = 'chat' | 'notice' | 'members';

/**
 * Clan home. Chat and the member roster are members-only — enforced by RLS
 * (0047), not by this component: a non-member's query simply returns nothing,
 * so hiding the tab is only to avoid showing an empty screen.
 */
export default function ClanDetail() {
  const { clanId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const myId = user?.id ?? null;

  const [clan, setClan] = useState<Clan | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('chat');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getClan(clanId, myId);
    if (!res.ok) { setError(res.message); return; }
    setClan(res.data);
  }, [clanId, myId]);

  useEffect(() => { void load(); }, [load]);

  const isMember = !!clan?.myRole;
  const canManage = clan?.myRole === 'owner' || clan?.myRole === 'officer';

  async function onJoin() {
    if (!myId || !clan) { navigate('/login'); return; }
    setBusy(true);
    const res = await joinClan(clan, myId);
    setBusy(false);
    if (!res.ok) { window.alert(res.message); return; }
    window.alert(res.data === 'joined' ? '클랜에 가입했습니다.' : '가입 신청을 보냈습니다.');
    void load();
  }

  async function onLeave() {
    if (!myId || !window.confirm('클랜에서 나갈까요?')) return;
    const res = await leaveClan(clanId, myId);
    if (!res.ok) { window.alert(res.message); return; }
    void load();
  }

  if (error) return <div className="page"><div className="container"><BackButton /><EmptyState icon="🔒" text={error} /></div></div>;
  if (!clan) return <div className="page"><div className="container"><BackButton /><EmptyState icon="⏳" text="클랜을 불러오는 중입니다." /></div></div>;

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="profile-banner profile-banner--clan" role="img" aria-label="">
          <span className="clan-crest" aria-hidden="true" />
        </div>

        <div className="section-title">
          <h2>{clan.name}</h2>
          {isMember
            ? <button className="btn btn-ghost btn-sm" onClick={() => void onLeave()}>나가기</button>
            : <button className="btn btn-primary btn-sm" onClick={() => void onJoin()} disabled={busy}>
                {clan.joinPolicy === 'invite' ? '초대 전용' : clan.joinPolicy === 'request' ? '가입 신청' : '가입하기'}
              </button>}
        </div>

        <div className="chip-row">
          <span className="chip">회원 {clan.memberCount}</span>
          {clan.primaryArt && <span className="chip"><ArtIcon art={clan.primaryArt} size={16} fallback="🥋" /> {getMartialArt(clan.primaryArt)?.nameKo ?? clan.primaryArt}</span>}
          {clan.myRole && (
            <span className="chip active">
              {clan.myRole !== 'member' && <Glyph set="roles" name={clan.myRole === 'owner' ? 'clan-leader' : 'clan-officer'} />}
              {clan.myRole === 'owner' ? '방장' : clan.myRole === 'officer' ? '부방장' : '회원'}
            </span>
          )}
          {!clan.isPublic && <span className="chip"><Icon name="lock" /> 비공개</span>}
        </div>
        {clan.description && <p className="user-profile__bio">{clan.description}</p>}
        {clan.rules && <details className="card info-card"><summary>클랜 규칙</summary><p style={{ whiteSpace: 'pre-wrap' }}>{clan.rules}</p></details>}

        {!isMember ? (
          <EmptyState icon="🔒" text="클랜 채팅과 회원 목록은 가입 후 이용할 수 있습니다." />
        ) : (
          <>
            <div className="chip-row" style={{ marginTop: 12 }}>
              <button type="button" className={`chip${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>채팅</button>
              <button type="button" className={`chip${tab === 'notice' ? ' active' : ''}`} onClick={() => setTab('notice')}>공지</button>
              <button type="button" className={`chip${tab === 'members' ? ' active' : ''}`} onClick={() => setTab('members')}>회원</button>
            </div>
            {tab === 'chat' && <ClanChat clanId={clanId} myId={myId!} canManage={canManage} />}
            {tab === 'notice' && <ClanNotices clanId={clanId} myId={myId!} canManage={canManage} />}
            {tab === 'members' && <ClanMembers clan={clan} myId={myId!} onChanged={load} />}
          </>
        )}
      </div>
    </div>
  );
}

function ClanChat({ clanId, myId, canManage }: { clanId: string; myId: string; canManage: boolean }) {
  const [messages, setMessages] = useState<ClanMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<MessageAttachment | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const res = await listClanMessages(clanId);
    if (res.ok) setMessages(res.data);
  }, [clanId]);

  useEffect(() => { void reload(); }, [reload]);
  // The realtime payload carries no nickname, so a new row triggers a reload
  // rather than being appended blind — the history in the DB stays the source
  // of truth and a dropped socket costs nothing but live delivery.
  useEffect(() => subscribeToClanChat(clanId, () => void reload()), [clanId, reload]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  async function onSend() {
    if (!text.trim() && !pending) return;
    const res = await sendClanMessage(clanId, myId, text, pending);
    if (!res.ok) { setError(res.message); return; }
    setText(''); setPending(null); setError('');
    void reload();
  }

  return (
    <>
      <div className="dm__thread" data-testid="clan-chat">
        {messages.length === 0 ? (
          <EmptyState icon="📭" art="no-messages" text="아직 대화가 없습니다." />
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`dm__row${m.senderId === myId ? ' dm__row--mine' : ''}`}>
              <div className="dm__bubble">
                {m.senderId !== myId && <Link to={`/u/${m.senderId}`} className="dm__sender">{m.senderNickname}</Link>}
                {m.attachment && <AttachmentCard attachment={m.attachment} />}
                {m.body && <p>{m.body}</p>}
                <time>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
                {(m.senderId === myId || canManage) && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await deleteClanMessage(m.id); void reload(); }}>삭제</button>
                )}
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
        <button type="button" className="icon-btn" title="공유할 항목 첨부" onClick={() => setPickerOpen(true)} data-testid="clan-share">
          <Icon name="plus" />
        </button>
        <input className="field-full" value={text} placeholder="클랜 채팅" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSend(); } }} data-testid="clan-input" />
        <button className="btn btn-primary" onClick={() => void onSend()} disabled={!text.trim() && !pending}>보내기</button>
      </div>
      {pickerOpen && (
        <SharePicker viewerId={myId} onClose={() => setPickerOpen(false)} onPick={(a) => { setPending(a); setPickerOpen(false); }} />
      )}
    </>
  );
}

function ClanNotices({ clanId, myId, canManage }: { clanId: string; myId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ClanAnnouncement[]>([]);
  const [form, setForm] = useState({ title: '', body: '', pinned: false });
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    const res = await listAnnouncements(clanId);
    if (res.ok) setRows(res.data);
  }, [clanId]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      {canManage && (
        <div className="card info-card">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((v) => !v)}>{open ? '취소' : '공지 작성'}</button>
          {open && (
            <div className="stack gap-2" style={{ marginTop: 10 }}>
              <input className="field-full" placeholder="공지 제목" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <textarea className="field-full" placeholder="공지 내용" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <label className="tutor-voice__check">
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> 상단 고정
              </label>
              <button className="btn btn-primary btn-sm" onClick={async () => {
                const res = await createAnnouncement(clanId, myId, form.title, form.body, form.pinned);
                if (!res.ok) { window.alert(res.message); return; }
                setForm({ title: '', body: '', pinned: false }); setOpen(false); void reload();
              }}>등록</button>
            </div>
          )}
        </div>
      )}
      {rows.length === 0 ? <EmptyState icon="📭" art="no-notifications" text="아직 공지가 없습니다." /> : (
        <div className="stack gap-2">
          {rows.map((a) => (
            <div key={a.id} className="card info-card">
              <strong>{a.pinned && <><Icon name="pin" label="고정됨" />{' '}</>}{a.title}</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
              <div className="technique-row__sub">{new Date(a.createdAt).toLocaleDateString('ko-KR')}</div>
              {canManage && <button className="btn btn-ghost btn-sm" onClick={async () => { await deleteAnnouncement(a.id); void reload(); }}>삭제</button>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ClanMembers({ clan, myId, onChanged }: { clan: Clan; myId: string; onChanged: () => void }) {
  const [members, setMembers] = useState<ClanMember[]>([]);
  const [requests, setRequests] = useState<ClanMember[]>([]);
  const [invited, setInvited] = useState<ClanMember[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const isOwner = clan.myRole === 'owner';
  const canManage = isOwner || clan.myRole === 'officer';

  const reload = useCallback(async () => {
    const none = Promise.resolve({ ok: true as const, data: [] as ClanMember[] });
    const [m, r, i] = await Promise.all([
      listMembers(clan.id),
      canManage ? listJoinRequests(clan.id) : none,
      canManage ? listClanInvitations(clan.id) : none,
    ]);
    if (m.ok) setMembers(m.data);
    if (r.ok) setRequests(r.data);
    if (i.ok) setInvited(i.data);
  }, [clan.id, canManage]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      {canManage && (
        <div className="modal-actions modal-actions--start" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)} data-testid="clan-invite">
            <Icon name="plus" /> 클랜원 초대
          </button>
        </div>
      )}
      {inviteOpen && (
        <InviteSheet clanId={clan.id} inviterId={myId} onClose={() => setInviteOpen(false)} onInvited={() => void reload()} />
      )}

      {canManage && invited.length > 0 && (
        <>
          <div className="section-title"><h3><Icon name="users" /> 보낸 초대 {invited.length}</h3></div>
          <div className="stack gap-2">
            {invited.map((v) => (
              <div key={v.userId} className="technique-row">
                <Avatar className="cmt__avatar" seed={v.userId} nickname={v.nickname} src={v.avatarUrl} />
                <div className="technique-row__main">
                  <div className="technique-row__name">{v.nickname}</div>
                  <div className="technique-row__sub">수락 대기 중</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={async () => { await cancelInvitation(clan.id, v.userId); void reload(); }}>취소</button>
              </div>
            ))}
          </div>
        </>
      )}

      {canManage && requests.length > 0 && (
        <>
          <div className="section-title"><h3><Icon name="users" /> 가입 신청 {requests.length}</h3></div>
          <div className="stack gap-2">
            {requests.map((r) => (
              <div key={r.userId} className="technique-row">
                <Avatar className="cmt__avatar" seed={r.userId} nickname={r.nickname} src={r.avatarUrl} />
                <div className="technique-row__main"><div className="technique-row__name">{r.nickname}</div></div>
                <div className="technique-row__right">
                  <button className="btn btn-primary btn-sm" onClick={async () => { await approveJoin(clan.id, r.userId); void reload(); onChanged(); }}>승인</button>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await rejectJoin(clan.id, r.userId); void reload(); }}>거절</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><h3><Icon name="users" /> 회원 {members.length}</h3></div>
      <div className="stack gap-2">
        {members.map((m) => (
          <div key={m.userId} className="technique-row">
            <Avatar className="cmt__avatar" seed={m.userId} nickname={m.nickname} src={m.avatarUrl} />
            <div className="technique-row__main">
              <Link to={`/u/${m.userId}`} className="technique-row__name">{m.nickname}</Link>
              <div className="technique-row__sub">{m.role === 'owner' ? '방장' : m.role === 'officer' ? '부방장' : '회원'}</div>
            </div>
            {isOwner && m.userId !== myId && (
              <div className="technique-row__right">
                <button className="btn btn-ghost btn-sm" onClick={async () => { await setRole(clan.id, m.userId, m.role === 'officer' ? 'member' : 'officer'); void reload(); }}>
                  {m.role === 'officer' ? '부방장 해임' : '부방장 임명'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={async () => {
                  if (!window.confirm(`${m.nickname}님에게 방장을 넘길까요? 되돌릴 수 없습니다.`)) return;
                  await transferOwnership(clan.id, m.userId); void reload(); onChanged();
                }}>방장 이전</button>
              </div>
            )}
            {canManage && !isOwner && m.role === 'member' && m.userId !== myId && (
              <button className="btn btn-ghost btn-sm" onClick={async () => { await kickMember(clan.id, m.userId); void reload(); onChanged(); }}>강퇴</button>
            )}
            {isOwner && m.role === 'member' && (
              <button className="btn btn-ghost btn-sm" onClick={async () => { await kickMember(clan.id, m.userId); void reload(); onChanged(); }}>강퇴</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
