import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import { useAuth } from '../../lib/auth/AuthProvider';
import { createClan, listClans, listMyClans } from '../../lib/social/clanService';
import type { Clan, ClanJoinPolicy } from '../../lib/social/types';

const JOIN_LABEL: Record<ClanJoinPolicy, string> = { open: '자유 가입', request: '승인 후 가입', invite: '초대 전용' };

/** 클랜 탐색 + 내 클랜 + 생성. 비공개 클랜은 RLS가 목록에서 제외한다. */
export default function Clans() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Clan[] | null>(null);
  const [mine, setMine] = useState<Clan[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', description: '', primaryArt: '', joinPolicy: 'open' as ClanJoinPolicy, isPublic: true, rules: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await listClans(user?.id ?? null, query);
    setAll(res.ok ? res.data : []);
    if (user) {
      const m = await listMyClans(user.id);
      if (m.ok) setMine(m.data);
    }
  }, [user, query]);

  useEffect(() => { void load(); }, [load]);

  async function onCreate() {
    if (!user) { navigate('/login'); return; }
    setError('');
    if (!form.name.trim() || !form.slug.trim()) { setError('클랜 이름과 주소를 입력해주세요.'); return; }
    const res = await createClan({ ...form, primaryArt: form.primaryArt || null });
    if (!res.ok) { setError(res.message); return; }
    setCreating(false);
    navigate(`/clans/${res.data}`);
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h2><Icon name="users" /> 클랜</h2>
          {user && <button className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>{creating ? '취소' : '클랜 만들기'}</button>}
        </div>
        <p className="technique-row__sub">체육관과 별개로, 사용자가 자유롭게 만들고 가입하는 온라인 모임입니다.</p>

        {creating && (
          <div className="card info-card">
            <h3 style={{ marginTop: 0 }}>새 클랜</h3>
            <div className="stack gap-2">
              <input className="field-full" placeholder="클랜 이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="field-full" placeholder="클랜 주소 (영문/숫자, 예: seoul-bjj)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
              <input className="field-full" placeholder="주력 무술 (선택)" value={form.primaryArt} onChange={(e) => setForm({ ...form, primaryArt: e.target.value })} />
              <textarea className="field-full" placeholder="클랜 소개" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <textarea className="field-full" placeholder="클랜 규칙 (선택)" value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} />
              <label className="field-label">가입 방식</label>
              <div className="chip-row">
                {(['open', 'request', 'invite'] as ClanJoinPolicy[]).map((p) => (
                  <button key={p} type="button" className={`chip${form.joinPolicy === p ? ' active' : ''}`} onClick={() => setForm({ ...form, joinPolicy: p })}>{JOIN_LABEL[p]}</button>
                ))}
              </div>
              <label className="tutor-voice__check">
                <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
                공개 클랜 (탐색 목록에 노출)
              </label>
              {error && <p className="video-status-message"><Icon name="warn" /> {error}</p>}
              <div className="modal-actions modal-actions--start">
                <button className="btn btn-primary" onClick={() => void onCreate()}>만들기</button>
              </div>
            </div>
          </div>
        )}

        {mine.length > 0 && (
          <>
            <div className="section-title"><h3><Icon name="check" /> 내 클랜</h3></div>
            <div className="stack gap-2">{mine.map((c) => <ClanRow key={c.id} clan={c} />)}</div>
          </>
        )}

        <div className="section-title"><h3><Icon name="search" /> 클랜 탐색</h3></div>
        <input className="field-full" placeholder="클랜 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 10 }} />
        {all === null ? (
          <EmptyState icon="⏳" text="불러오는 중입니다." />
        ) : all.length === 0 ? (
          <EmptyState icon="👥" art="no-clan" text="조건에 맞는 클랜이 없습니다. 직접 만들어보세요." />
        ) : (
          <div className="stack gap-2">{all.map((c) => <ClanRow key={c.id} clan={c} />)}</div>
        )}
      </div>
    </div>
  );
}

function ClanRow({ clan }: { clan: Clan }) {
  return (
    <Link to={`/clans/${clan.id}`} className="technique-row">
      <div className="technique-row__main">
        <div className="technique-row__name">
          {clan.name}
          {clan.myRole && <span className="chip active" style={{ marginLeft: 6 }}>{clan.myRole === 'owner' ? '방장' : clan.myRole === 'officer' ? '부방장' : '회원'}</span>}
        </div>
        <div className="technique-row__sub">
          회원 {clan.memberCount} · {JOIN_LABEL[clan.joinPolicy]}
          {clan.primaryArt ? ` · ${clan.primaryArt}` : ''}
          {!clan.isPublic ? ' · 비공개' : ''}
        </div>
      </div>
    </Link>
  );
}
