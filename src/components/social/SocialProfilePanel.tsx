import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { getProfile, updateMyProfile } from '../../lib/social/profileService';
import type { DmPolicy, PublicProfile } from '../../lib/social/types';

const DM_LABEL: Record<DmPolicy, string> = {
  everyone: '모두에게',
  followers: '내가 팔로우한 사람만',
  nobody: '받지 않음',
};

/**
 * The social half of the user's own profile: the fields other people see,
 * plus the per-section visibility switches. Nothing here is the access
 * control — these values drive the RLS policies in migration 0045, which is
 * what actually stops another account reading a private profile's posts.
 */
export default function SocialProfilePanel({ userId }: { userId: string }) {
  const [p, setP] = useState<PublicProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void getProfile(userId).then((res) => { if (res.ok) setP(res.data); });
  }, [userId]);

  async function save(patch: Partial<PublicProfile>) {
    setSaving(true);
    setMsg('');
    const res = await updateMyProfile(userId, patch);
    setSaving(false);
    if (!res.ok) { setMsg(res.message); return; }
    setP((prev) => (prev ? { ...prev, ...patch } : prev));
    setMsg('저장했습니다.');
  }

  if (!p) return null;

  return (
    <div className="card info-card" data-testid="social-profile-panel">
      <div className="section-title">
        <h3><Icon name="users" /> 공개 프로필</h3>
        <Link to={`/u/${userId}`} className="see-all">내 프로필 보기 →</Link>
      </div>
      <p className="technique-row__sub">다른 사용자에게 보이는 정보입니다. 학습 기록·신체 측정·AI 코치 기록은 여기에 포함되지 않습니다.</p>

      <div className="stack gap-2" style={{ marginTop: 10 }}>
        <label className="field-label">닉네임</label>
        <input className="field-full" defaultValue={p.nickname} onBlur={(e) => { if (e.target.value !== p.nickname) void save({ nickname: e.target.value }); }} />

        <label className="field-label">아이디 (@handle)</label>
        <input className="field-full" placeholder="예: eunsu_bjj" defaultValue={p.handle ?? ''} onBlur={(e) => { if (e.target.value !== (p.handle ?? '')) void save({ handle: e.target.value }); }} />

        <label className="field-label">자기소개</label>
        <textarea className="field-full" defaultValue={p.bio} onBlur={(e) => { if (e.target.value !== p.bio) void save({ bio: e.target.value }); }} />

        <label className="field-label">주력 무술</label>
        <input className="field-full" defaultValue={p.primaryArt ?? ''} onBlur={(e) => void save({ primaryArt: e.target.value || null })} />

        <label className="field-label">수련 경력 (년)</label>
        <input className="field-full" type="number" min={0} defaultValue={p.yearsTraining ?? ''} onBlur={(e) => void save({ yearsTraining: e.target.value ? Number(e.target.value) : null })} />

        <label className="field-label">소속 체육관 (선택)</label>
        <input className="field-full" defaultValue={p.gymName ?? ''} onBlur={(e) => void save({ gymName: e.target.value || null })} />
      </div>

      <div className="section-title" style={{ marginTop: 18 }}><h3><Icon name="lock" /> 공개 범위</h3></div>
      <div className="stack gap-2">
        <label className="tutor-voice__check">
          <input type="checkbox" checked={p.isPrivate} onChange={(e) => void save({ isPrivate: e.target.checked })} />
          비공개 계정 — 승인한 팔로워만 게시물을 볼 수 있습니다
        </label>
        <label className="tutor-voice__check">
          <input type="checkbox" checked={p.showLikes} onChange={(e) => void save({ showLikes: e.target.checked })} />
          좋아요한 게시물 목록 공개
        </label>
        <label className="tutor-voice__check">
          <input type="checkbox" checked={p.showReposts} onChange={(e) => void save({ showReposts: e.target.checked })} />
          리포스트한 게시물 목록 공개
        </label>

        <label className="field-label">메시지 받기</label>
        <div className="chip-row">
          {(Object.keys(DM_LABEL) as DmPolicy[]).map((v) => (
            <button key={v} type="button" className={`chip${p.dmPolicy === v ? ' active' : ''}`} onClick={() => void save({ dmPolicy: v })}>
              {DM_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="video-status-message">{saving ? '저장 중…' : msg}</p>}
    </div>
  );
}
