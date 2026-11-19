import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import BottomSheet from '../BottomSheet';
import Avatar from '../Avatar';
import Icon from '../Icon';
import PaperPlane from '../icons/PaperPlane';
import { useAuth } from '../../lib/auth/AuthProvider';
import { listConversations, sendMessage, startConversation } from '../../lib/social/dmService';
import { listMyClans, sendClanMessage } from '../../lib/social/clanService';
import { searchProfiles } from '../../lib/social/profileService';
import { ATTACHMENT_LABEL, type Clan, type Conversation, type MessageAttachment, type PublicProfile } from '../../lib/social/types';

type SendState = 'busy' | 'sent' | { error: string };

function shareError(raw: string): string {
  // 서버(0060 이전)가 아직 이 첨부 종류를 모를 때
  if (raw.includes('attachment_shape')) return '이 항목은 아직 채팅으로 공유할 수 없습니다. (서버 업데이트 필요)';
  return raw;
}

/**
 * 종이비행기 공유 시트 — 게시물·숏폼·콤보·체육관·커리큘럼·장비를 DM 또는 클랜 채팅으로 보낸다.
 * 보내는 것은 "참조 + 표시용 스냅샷"이다(0050): 받는 사람이 열면 원본을 다시 읽고, 볼 권한은 서버(RLS)가 다시 판단한다.
 */
export default function ShareSheet({ attachment, onClose }: { attachment: MessageAttachment; onClose: () => void }) {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const [note, setNote] = useState('');
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [clans, setClans] = useState<Clan[] | null>(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [state, setState] = useState<Record<string, SendState>>({});

  useEffect(() => {
    if (!myId) return;
    let alive = true;
    void listConversations(myId).then((r) => alive && setConvs(r.ok ? r.data.slice(0, 8) : []));
    void listMyClans(myId).then((r) => alive && setClans(r.ok ? r.data : []));
    return () => {
      alive = false;
    };
  }, [myId]);

  async function search(next: string) {
    setQ(next);
    if (!next.trim()) {
      setPeople(null);
      return;
    }
    const r = await searchProfiles(next, 12);
    setPeople(r.ok ? r.data.filter((p) => p.userId !== myId) : []);
  }

  async function send(key: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (state[key] === 'busy' || state[key] === 'sent') return;
    setState((s) => ({ ...s, [key]: 'busy' }));
    const r = await fn();
    setState((s) => ({ ...s, [key]: r.ok ? 'sent' : { error: shareError(r.message ?? '보내지 못했습니다.') } }));
  }

  const toConversation = (id: string) => send(`c:${id}`, async () => {
    const r = await sendMessage(id, myId!, note, null, attachment);
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  });
  const toClan = (id: string) => send(`k:${id}`, async () => {
    const r = await sendClanMessage(id, myId!, note, attachment);
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  });
  const toPerson = (p: PublicProfile) => send(`u:${p.userId}`, async () => {
    const c = await startConversation(p.userId);
    if (!c.ok) return { ok: false, message: c.message };
    const r = await sendMessage(c.data, myId!, note, null, attachment);
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  });

  const button = (key: string, onClick: () => void) => {
    const s = state[key];
    return (
      <span className="mx-share__send">
        <button
          type="button"
          className={`btn btn-sm ${s === 'sent' ? 'btn-ghost' : 'btn-primary'}`}
          disabled={s === 'busy' || s === 'sent'}
          onClick={onClick}
          data-testid="share-send"
        >
          {s === 'sent' ? <><Icon name="check" /> 보냄</> : s === 'busy' ? '보내는 중…' : '보내기'}
        </button>
        {s && typeof s === 'object' && <small className="mx-share__err" role="alert">{s.error}</small>}
      </span>
    );
  };

  const title = 'title' in attachment ? attachment.title : 'name' in attachment ? attachment.name : '';

  return createPortal(
    <BottomSheet onClose={onClose} className="mx-share">
      <h3 className="mx-share__head">
        <PaperPlane /> 공유하기
      </h3>
      <div className="mx-share__item" data-testid="share-item">
        <span className="mx-share__kind">{ATTACHMENT_LABEL[attachment.kind]}</span>
        <strong>{title}</strong>
      </div>

      {!myId ? (
        <div className="mx-share__login">
          <p className="technique-row__sub">로그인하면 친구·클랜 채팅으로 보낼 수 있습니다.</p>
          <Link to="/login" className="btn btn-primary btn-sm" onClick={onClose}>로그인</Link>
        </div>
      ) : (
        <>
          <input className="field-full" placeholder="함께 보낼 메시지 (선택)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="share-note" />
          <div className="mx-share__body">
            <input className="field-full" placeholder="사용자 검색 (닉네임 또는 @아이디)" value={q} onChange={(e) => void search(e.target.value)} data-testid="share-search" />
            {people !== null && (
              <section>
                <h4 className="mx-share__sec">검색 결과</h4>
                {people.length === 0 ? <p className="technique-row__sub">일치하는 사용자가 없습니다.</p> : people.map((p) => (
                  <div key={p.userId} className="technique-row mx-share__row">
                    <Avatar className="cmt__avatar" seed={p.userId} nickname={p.nickname} src={p.avatarUrl} />
                    <div className="technique-row__main">
                      <div className="technique-row__name">{p.nickname}</div>
                      <div className="technique-row__sub">{p.handle ? `@${p.handle}` : ''}</div>
                    </div>
                    {button(`u:${p.userId}`, () => void toPerson(p))}
                  </div>
                ))}
              </section>
            )}
            <section>
              <h4 className="mx-share__sec">최근 대화</h4>
              {convs === null ? <p className="technique-row__sub">불러오는 중…</p> : convs.length === 0 ? <p className="technique-row__sub">대화가 없습니다. 위에서 사용자를 검색하세요.</p> : convs.map((c) => (
                <div key={c.id} className="technique-row mx-share__row" data-testid="share-conv">
                  <Avatar className="cmt__avatar" seed={c.otherUserId} nickname={c.otherNickname} src={c.otherAvatarUrl} />
                  <div className="technique-row__main">
                    <div className="technique-row__name">{c.otherNickname}</div>
                  </div>
                  {button(`c:${c.id}`, () => void toConversation(c.id))}
                </div>
              ))}
            </section>
            {clans && clans.length > 0 && (
              <section>
                <h4 className="mx-share__sec">내 클랜 채팅</h4>
                {clans.map((k) => (
                  <div key={k.id} className="technique-row mx-share__row" data-testid="share-clan">
                    <span className="mx-share__clan"><Icon name="users" /></span>
                    <div className="technique-row__main">
                      <div className="technique-row__name">{k.name}</div>
                    </div>
                    {button(`k:${k.id}`, () => void toClan(k.id))}
                  </div>
                ))}
              </section>
            )}
          </div>
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>닫기</button>
      </div>
    </BottomSheet>,
    document.body,
  );
}
