// 지도자용 과제·피드백 목록 — 상태 표시, 제목/내용 수정, 종료, 삭제.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ASSIGNMENT_KIND_LABEL, deleteAssignment, updateAssignment, type Assignment } from '../../lib/gymClass/adminService';
import { getTechnique } from '../../lib/loadData';
import Icon from '../Icon';
import EmptyState from '../EmptyState';
import { STATUS_LABEL, fmtDate, statusPillClass } from './shared';

function AssignmentItem({ a, memberName, gymId, onChanged }: { a: Assignment; memberName?: string; gymId: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tech = a.techniqueId ? getTechnique(a.techniqueId)?.name ?? a.techniqueId : null;

  async function act(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError((r as { message?: string }).message ?? '처리하지 못했습니다.');
      return false;
    }
    onChanged();
    return true;
  }

  async function save() {
    if (!title.trim()) {
      setError('제목을 입력해 주세요.');
      return;
    }
    if (await act(() => updateAssignment(a.id, { title: title.trim().slice(0, 120), body: body.trim().slice(0, 3000) }))) setEditing(false);
  }

  return (
    <div className="eco-card">
      <div className="eco-row eco-row--between">
        <div className="eco-row">
          <span className="eco-pill">{ASSIGNMENT_KIND_LABEL[a.kind]}</span>
          <span className={statusPillClass(a.status)}>{STATUS_LABEL[a.status]}</span>
          {tech && <span className="eco-pill eco-pill--muted">{tech}</span>}
        </div>
        <span className="eco-meta--faint">{fmtDate(a.createdAt)}</span>
      </div>
      {editing ? (
        <div className="eco-form" style={{ marginTop: 8 }}>
          <label>
            제목
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            내용
            <textarea value={body} maxLength={3000} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="eco-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
              저장
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditing(false);
                setTitle(a.title);
                setBody(a.body);
              }}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <h3 style={{ marginTop: 8 }}>{a.title}</h3>
          {a.body && <p className="gadm-body">{a.body}</p>}
        </>
      )}
      <p className="eco-meta" style={{ marginTop: 6 }}>
        {memberName !== undefined && (
          <>
            대상:{' '}
            <Link to={`/gym/admin/${gymId}/member/${a.memberId}`} className="gadm-cell-strong">
              {memberName || '(탈퇴한 회원)'}
            </Link>
            {' · '}
          </>
        )}
        마감 {a.dueDate ? fmtDate(a.dueDate) : '없음'}
        {a.updatedAt !== a.createdAt && ` · 수정 ${fmtDate(a.updatedAt)}`}
      </p>
      {a.memberNote && (
        <div className="eco-notice eco-notice--accent">
          <strong>회원 메모</strong>
          <p className="gadm-body">{a.memberNote}</p>
        </div>
      )}
      {!editing && (
        <div className="gadm-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(true)}>
            <Icon name="edit" /> 수정
          </button>
          {a.status === 'open' ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => updateAssignment(a.id, { status: 'dismissed' }))}>
              종료 처리
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => updateAssignment(a.id, { status: 'open' }))}>
              다시 진행
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm gadm-btn-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('이 과제를 삭제할까요? 회원 화면에서도 사라집니다.')) void act(() => deleteAssignment(a.id));
            }}
          >
            <Icon name="trash" /> 삭제
          </button>
        </div>
      )}
      {error && <p className="gadm-error">{error}</p>}
    </div>
  );
}

export default function AssignmentList({
  items,
  gymId,
  memberNames,
  onChanged,
  emptyText = '아직 보낸 과제·피드백이 없습니다.',
}: {
  items: Assignment[];
  gymId: string;
  /** when given, each item shows its target member */
  memberNames?: Map<string, string>;
  onChanged: () => void;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyState icon="📋" text={emptyText} />;
  return (
    <div className="eco-stack">
      {items.map((a) => (
        <AssignmentItem key={`${a.id}:${a.updatedAt}`} a={a} gymId={gymId} memberName={memberNames ? memberNames.get(a.memberId) ?? '' : undefined} onChanged={onChanged} />
      ))}
    </div>
  );
}
