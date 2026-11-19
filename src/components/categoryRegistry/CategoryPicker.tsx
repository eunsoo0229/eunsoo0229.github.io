import { useMemo, useState } from 'react';
import { categoryPickerTree, flattenPicker, type PickerNode } from '../../lib/categoryRegistry/service';
import type { NewCategoryInput } from '../../lib/categoryRegistry/types';
import CategoryCreateForm from './CategoryCreateForm';

export interface PickerValue {
  /** Deepest chosen existing node. */
  nodeId: string | null;
  /** A new category to create under `nodeId` (or as a new top level when nodeId is null) — created on save. */
  draft: NewCategoryInput | null;
}

const label = (n: PickerNode) => `${n.ko}${n.en && n.en !== n.ko ? ` (${n.en})` : ''}${n.count ? ` · ${n.count}` : ''}${n.custom ? ' · 사용자' : ''}`;

/**
 * 계층형 카테고리 선택 — 대분류 → 상위 → 하위 (→ 세부). Only this art's categories; changing a level clears the levels
 * below it. "＋ 새 카테고리" at any level opens the create form (duplicate-checked); the new category is a draft until
 * the technique is saved.
 */
export default function CategoryPicker({ art, value, onChange, version = 0 }: { art: string; value: PickerValue; onChange: (v: PickerValue) => void; version?: number }) {
  const roots = useMemo(() => categoryPickerTree(art), [art, version]);
  const all = useMemo(() => flattenPicker(roots), [roots]);
  const [creatingUnder, setCreatingUnder] = useState<PickerNode | null | undefined>(undefined);

  // the chain of selected nodes, from the top
  const chain: PickerNode[] = [];
  for (let n = value.nodeId ? all.find((x) => x.id === value.nodeId) : undefined; n; n = all.find((x) => x.children.some((c) => c.id === n!.id))) chain.unshift(n);
  const levels: { options: PickerNode[]; selected: PickerNode | null; parent: PickerNode | null }[] = [{ options: roots, selected: chain[0] ?? null, parent: null }];
  for (let i = 0; i < chain.length; i++) if (chain[i].children.length || chain[i].level < 4) levels.push({ options: chain[i].children, selected: chain[i + 1] ?? null, parent: chain[i] });

  const NEW = '__new__';
  const DRAFT = '__draft__';
  return (
    <div className="cat-picker" data-testid="cat-picker">
      {levels.map((lv, i) => (
        <div key={i} className="cat-picker__level">
          <label className="field-label" htmlFor={`cat-level-${i}`}>
            {['대분류', '상위 카테고리', '하위 카테고리', '세부 카테고리'][i] ?? '세부'}
            {i > 0 && <span className="cat-meta"> (선택)</span>}
          </label>
          <select
            id={`cat-level-${i}`}
            className="select field-full"
            data-testid={`cat-level-${i}`}
            value={value.draft && (value.draft.parentId ?? null) === (lv.parent?.id ?? null) && !lv.selected ? DRAFT : lv.selected?.id ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === DRAFT) return;
              if (v === NEW) {
                setCreatingUnder(lv.parent);
                return;
              }
              setCreatingUnder(undefined);
              // a change here clears every level below (and any draft)
              onChange({ nodeId: v || lv.parent?.id || null, draft: null });
            }}
          >
            <option value="">{i === 0 ? '선택하세요' : `${lv.parent?.ko ?? ''} 전체 (더 세분하지 않음)`}</option>
            {lv.options.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
                {o.kind === 'potential' ? ' · 자동 분류 항목' : ''}
              </option>
            ))}
            {(!lv.parent || lv.parent.level < 4) && <option value={NEW}>＋ 새 카테고리 만들기…</option>}
            {value.draft && (value.draft.parentId ?? null) === (lv.parent?.id ?? null) && <option value={DRAFT}>새 카테고리(저장할 때 생성): {value.draft.ko}</option>}
          </select>
        </div>
      ))}
      {creatingUnder !== undefined && (
        <CategoryCreateForm
          art={art}
          parent={creatingUnder}
          submitLabel="이 카테고리로 선택 (기술 저장 때 생성)"
          onSubmit={(input) => {
            onChange({ nodeId: input.parentId, draft: input });
            setCreatingUnder(undefined);
          }}
          onUseExisting={(id) => {
            onChange({ nodeId: id, draft: null });
            setCreatingUnder(undefined);
          }}
          onCancel={() => setCreatingUnder(undefined)}
        />
      )}
      {(value.nodeId || value.draft) && (
        <p className="cat-meta" data-testid="cat-selected">
          선택: <strong>{[chain.map((c) => c.ko).join(' › '), value.draft ? `${value.draft.ko} (새 카테고리)` : ''].filter(Boolean).join(' › ')}</strong>
        </p>
      )}
    </div>
  );
}
