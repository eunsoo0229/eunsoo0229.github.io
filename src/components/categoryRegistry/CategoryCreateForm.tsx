import { useMemo, useState } from 'react';
import { findCategoryMatches, validateNewCategory, type PickerNode } from '../../lib/categoryRegistry/service';
import type { CategoryMatch, NewCategoryInput } from '../../lib/categoryRegistry/types';

/**
 * 새 카테고리 — names + description under a fixed parent (or as a new top level), with a live duplicate check against
 * the art's existing categories. A "same" match blocks creation and offers the existing one instead; a "similar" match
 * needs an explicit "different concept" confirmation.
 */
export default function CategoryCreateForm({
  art,
  parent,
  initial,
  submitLabel = '카테고리 만들기',
  onSubmit,
  onUseExisting,
  onCancel,
}: {
  art: string;
  parent: PickerNode | null;
  initial?: Partial<NewCategoryInput>;
  submitLabel?: string;
  onSubmit: (input: NewCategoryInput) => void | Promise<void>;
  onUseExisting: (nodeId: string) => void;
  onCancel: () => void;
}) {
  const [ko, setKo] = useState(initial?.ko ?? '');
  const [en, setEn] = useState(initial?.en ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [distinct, setDistinct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches: CategoryMatch[] = useMemo(() => (ko.trim() || en.trim() ? findCategoryMatches({ art, parentId: parent?.id ?? null, ko, en }) : []), [art, parent?.id, ko, en]);
  const same = matches.filter((m) => m.kind === 'same');
  const similar = matches.filter((m) => m.kind === 'similar');

  async function submit() {
    const input: NewCategoryInput = { art, parentId: parent?.id ?? null, ko, en, description, origin: initial?.origin };
    const v = validateNewCategory(input);
    if (!v.ok) {
      setError(v.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cat-create" data-testid="cat-create">
      <p className="cat-meta">
        위치: <strong>{parent ? `${parent.path} › (새 카테고리)` : '새 대분류'}</strong>
      </p>
      <label className="field-label" htmlFor="cat-ko">
        한국어 이름
      </label>
      <input id="cat-ko" className="select field-full" value={ko} onChange={(e) => setKo(e.target.value)} placeholder="예: 언더훅 스윕" data-testid="cat-ko" />
      <label className="field-label" htmlFor="cat-en">
        영어 이름{parent ? ' (선택)' : ' (대분류는 필수)'}
      </label>
      <input id="cat-en" className="select field-full" value={en} onChange={(e) => setEn(e.target.value)} placeholder="예: Underhook Sweeps" data-testid="cat-en" />
      <label className="field-label" htmlFor="cat-desc">
        설명 (선택)
      </label>
      <textarea id="cat-desc" className="select field-full" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="어떤 기술을 모으는 카테고리인지" />
      {same.length > 0 && (
        <div className="cat-dup cat-dup--same" role="alert" data-testid="cat-dup-same">
          <strong>이미 있는 카테고리예요 — 새로 만들 수 없습니다.</strong>
          {same.map((m) => (
            <div key={m.nodeId} className="cat-dup__row">
              <span>
                {m.path} <span className="cat-meta">({m.reason})</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUseExisting(m.nodeId)} data-testid="cat-use-existing">
                이 카테고리 사용
              </button>
            </div>
          ))}
        </div>
      )}
      {same.length === 0 && similar.length > 0 && (
        <div className="cat-dup" data-testid="cat-dup-similar">
          <strong>비슷한 카테고리가 있어요. 같은 개념이면 기존 것을 써 주세요.</strong>
          {similar.map((m) => (
            <div key={m.nodeId} className="cat-dup__row">
              <span>
                {m.path} <span className="cat-meta">({m.reason})</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUseExisting(m.nodeId)}>
                이걸 사용
              </button>
            </div>
          ))}
          <label className="cat-meta">
            <input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} data-testid="cat-distinct" /> 위 카테고리와 다른 개념입니다
          </label>
        </div>
      )}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="chip-row" style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !ko.trim() || same.length > 0 || (similar.length > 0 && !distinct)} data-testid="cat-create-submit">
          {submitLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
