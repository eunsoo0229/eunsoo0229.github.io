// 지도자 → 회원 과제·기술 권장·피드백·AI 분석 검토 의견 작성 폼.
// 기술 선택은 기존 클래스 만들기 폼과 같은 searchTechniques() 인덱스를 쓴다.
import { useMemo, useState } from 'react';
import { ASSIGNMENT_KIND_LABEL, createAssignment, type Assignment, type GymMemberRow, type ProgressSummary } from '../../lib/gymClass/adminService';
import { searchTechniques } from '../../lib/search';
import { getTechnique } from '../../lib/loadData';
import Icon from '../Icon';
import { POSE_METHOD_LABEL } from './shared';

const KINDS = Object.keys(ASSIGNMENT_KIND_LABEL) as Assignment['kind'][];

export default function AssignmentForm({
  gymId,
  authorId,
  members,
  fixedMemberId,
  poseItems,
  onCreated,
}: {
  gymId: string;
  authorId: string;
  members: GymMemberRow[];
  fixedMemberId?: string;
  /** shared pose summary items of the selected member (for 'ai_review') */
  poseItems?: ProgressSummary['pose'];
  onCreated: () => void;
}) {
  const [memberId, setMemberId] = useState(fixedMemberId ?? '');
  const [kind, setKind] = useState<Assignment['kind']>('task');
  const [techniqueId, setTechniqueId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const results = useMemo(() => (query.trim() ? searchTechniques(query, 10) : []), [query]);
  const pickedName = techniqueId ? getTechnique(techniqueId)?.name ?? poseItems?.find((p) => p.techniqueId === techniqueId)?.name ?? techniqueId : null;
  const targetMembers = members.filter((m) => m.userId !== authorId);

  function pickPose(key: string) {
    const p = poseItems?.find((x) => `${x.techniqueId}::${x.method}` === key);
    if (!p) return;
    setTechniqueId(p.techniqueId);
    if (!title.trim()) setTitle(`AI 분석 검토: ${p.name}`);
    if (!body.trim()) {
      setBody(
        `[참고한 공유 분석] ${p.name} · ${POSE_METHOD_LABEL[p.method] ?? p.method} · ${p.count}회 측정, 처음 ${p.first}점 → 최근 ${p.latest}점` +
          (p.lowReliability > 0 ? ` (측정 신뢰도 낮음 ${p.lowReliability}회)` : '') +
          '\n\n검토 의견:\n',
      );
    }
  }

  async function submit() {
    const target = fixedMemberId ?? memberId;
    if (!target) {
      setError('대상 회원을 선택해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    const r = await createAssignment({ gymId, memberId: target, authorId, kind, techniqueId, title, body, dueDate: dueDate || null });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setTitle('');
    setBody('');
    setDueDate('');
    setTechniqueId(null);
    setQuery('');
    setDone(true);
    onCreated();
  }

  return (
    <div className="eco-card">
      <h3>
        <Icon name="plus" /> 과제·피드백 보내기
      </h3>
      <div className="eco-form">
        <div className="eco-form-grid">
          {!fixedMemberId && (
            <label>
              대상 회원
              <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">회원 선택</option>
                {targetMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.nickname} ({m.role === 'instructor' ? '지도자' : '학생'})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            종류
            <select value={kind} onChange={(e) => setKind(e.target.value as Assignment['kind'])}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {ASSIGNMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            마감일 (선택)
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>

        {kind === 'ai_review' && <p className="eco-meta">AI 분석 결과 검토·수정 의견 — 앱의 자동 분석 점수에 대해 지도자가 직접 확인한 내용과 고칠 점을 남깁니다.</p>}
        {kind === 'ai_review' && (
          poseItems && poseItems.length > 0 ? (
            <label>
              검토할 AI 분석 결과 (회원이 공유한 요약)
              <select defaultValue="" onChange={(e) => pickPose(e.target.value)}>
                <option value="">분석 항목 선택</option>
                {poseItems.map((p) => (
                  <option key={`${p.techniqueId}::${p.method}`} value={`${p.techniqueId}::${p.method}`}>
                    {p.name} · {POSE_METHOD_LABEL[p.method] ?? p.method} · {p.first}점 → {p.latest}점
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="eco-meta">
              {fixedMemberId ? '이 회원이 공유한 AI 자세 분석 결과가 없습니다. 기술을 직접 선택해 의견을 남길 수 있습니다.' : '특정 분석 결과를 참고하려면 회원 상세 화면에서 작성하세요. 회원이 진도를 공유한 경우에만 분석 요약을 볼 수 있습니다.'}
            </p>
          )
        )}

        <label>
          관련 기술 (선택)
          {pickedName ? (
            <span className="eco-row">
              <span className="eco-pill eco-pill--accent">{pickedName}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTechniqueId(null)}>
                <Icon name="close" /> 선택 해제
              </button>
            </span>
          ) : (
            <>
              <input placeholder="기술 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
              {results.length > 0 && (
                <span className="gadm-picker">
                  {results.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="chip"
                      onClick={() => {
                        setTechniqueId(t.id);
                        setQuery('');
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </span>
              )}
            </>
          )}
        </label>

        <label>
          제목
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="예: 잽-크로스 100회 섀도" />
        </label>
        <label>
          내용
          <textarea value={body} maxLength={3000} onChange={(e) => setBody(e.target.value)} placeholder="구체적인 방법, 주의할 점, 피드백 내용" />
        </label>
        <div className="eco-row">
          <button type="button" className="btn btn-primary" data-testid="gym-assign-create" disabled={busy || !title.trim() || !(fixedMemberId || memberId)} onClick={submit}>
            {busy ? '보내는 중...' : '보내기'}
          </button>
        </div>
        {error && <p className="gadm-error">{error}</p>}
        {done && <p className="gadm-ok">회원에게 전달했습니다.</p>}
      </div>
    </div>
  );
}
