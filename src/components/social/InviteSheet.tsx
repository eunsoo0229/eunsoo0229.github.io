import { useState } from 'react';
import BottomSheet from '../BottomSheet';
import Avatar from '../Avatar';
import Icon from '../Icon';
import { searchProfiles } from '../../lib/social/profileService';
import { inviteToClan } from '../../lib/social/clanService';
import type { PublicProfile } from '../../lib/social/types';

/**
 * Invite someone to a clan. Only 방장/부방장 can actually create the row —
 * the RLS policy on clan_invitations decides, so a non-manager who reaches
 * this sheet still gets a refusal from the database rather than a silent
 * success.
 */
export default function InviteSheet({
  clanId,
  inviterId,
  onClose,
  onInvited,
}: {
  clanId: string;
  inviterId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PublicProfile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function run(next: string) {
    setQ(next);
    if (!next.trim()) { setRows(null); return; }
    const res = await searchProfiles(next, 15);
    setRows(res.ok ? res.data.filter((p) => p.userId !== inviterId) : []);
  }

  async function invite(p: PublicProfile) {
    setBusy(true);
    const res = await inviteToClan(clanId, p.userId, inviterId);
    setBusy(false);
    setMsg(res.ok ? `${p.nickname}님을 초대했습니다.` : res.message);
    if (res.ok) onInvited();
  }

  return (
    <BottomSheet onClose={onClose}>
      <h3 style={{ marginTop: 0 }}><Icon name="users" /> 클랜 초대</h3>
      <input
        className="field-full"
        placeholder="닉네임 또는 @아이디로 검색"
        value={q}
        onChange={(e) => void run(e.target.value)}
        data-testid="invite-search"
      />
      {msg && <p className="video-status-message" style={{ marginTop: 8 }}>{msg}</p>}
      <div className="share-picker__list" style={{ marginTop: 10 }}>
        {rows === null ? (
          <p className="technique-row__sub">초대할 사용자를 검색하세요.</p>
        ) : rows.length === 0 ? (
          <p className="technique-row__sub">일치하는 사용자가 없습니다.</p>
        ) : (
          rows.map((p) => (
            <div key={p.userId} className="technique-row">
              <Avatar className="cmt__avatar" seed={p.userId} nickname={p.nickname} src={p.avatarUrl} />
              <div className="technique-row__main">
                <div className="technique-row__name">{p.nickname}</div>
                <div className="technique-row__sub">{p.handle ? `@${p.handle}` : ''}</div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void invite(p)}>초대</button>
            </div>
          ))
        )}
      </div>
    </BottomSheet>
  );
}
