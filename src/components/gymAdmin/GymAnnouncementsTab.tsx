// 체육관 공지 — 작성(제목·내용·상단 고정) · 목록 · 삭제. 회원은 GymMemberPanel 에서 본다.
import { useEffect, useState } from 'react';
import { createAnnouncement, deleteAnnouncement, listAnnouncements, type Announcement } from '../../lib/gymClass/adminService';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import LoadingState from '../LoadingState';
import Icon from '../Icon';
import { fmtDateTime } from './shared';

export default function GymAnnouncementsTab({ gymId, authorId }: { gymId: string; authorId: string }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const r = await listAnnouncements(gymId);
    if (r.ok) setItems(r.data);
    else setLoadError(r.message);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createAnnouncement(gymId, authorId, title, body, pinned);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setTitle('');
    setBody('');
    setPinned(false);
    void load();
  }

  async function remove(a: Announcement) {
    if (!window.confirm(`"${a.title}" 공지를 삭제할까요?`)) return;
    setError(null);
    const r = await deleteAnnouncement(a.id);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== a.id));
  }

  return (
    <div>
      <div className="eco-card">
        <h3>
          <Icon name="bell" /> 새 공지
        </h3>
        <div className="eco-form">
          <label>
            제목
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="예: 다음 주 토요일 휴관 안내" />
          </label>
          <label>
            내용
            <textarea value={body} maxLength={3000} onChange={(e) => setBody(e.target.value)} />
          </label>
          <label className="eco-check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> 상단에 고정
          </label>
          <div className="eco-row">
            <button type="button" className="btn btn-primary" data-testid="gym-announce-create" disabled={busy || !title.trim()} onClick={create}>
              {busy ? '게시 중...' : '공지 게시'}
            </button>
          </div>
          {error && <p className="gadm-error">{error}</p>}
        </div>
      </div>

      <div className="eco-section">
        <h3>공지 목록</h3>
        <span className="eco-meta--faint">체육관 회원 모두에게 보입니다</span>
      </div>
      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState text={loadError} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState icon="📭" text="아직 공지가 없습니다." />
      ) : (
        <div className="eco-stack">
          {items.map((a) => (
            <div key={a.id} className="eco-card">
              <div className="eco-row eco-row--between">
                <div className="eco-row">
                  {a.pinned && (
                    <span className="eco-pill eco-pill--accent">
                      <Icon name="pin" /> 고정
                    </span>
                  )}
                  <strong>{a.title}</strong>
                </div>
                <span className="eco-meta--faint">{fmtDateTime(a.createdAt)}</span>
              </div>
              {a.body && <p className="gadm-body">{a.body}</p>}
              <div className="gadm-actions">
                <button type="button" className="btn btn-ghost btn-sm gadm-btn-danger" onClick={() => remove(a)}>
                  <Icon name="trash" /> 삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
