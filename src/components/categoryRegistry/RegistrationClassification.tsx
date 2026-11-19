import { useEffect, useMemo, useState } from 'react';
import type { Technique } from '../../types';
import { recommendCategory, recommendCategoryWithAi, type AskJson, type CategoryRecommendation } from '../../lib/categoryRegistry/recommend';
import { flattenPicker, categoryPickerTree } from '../../lib/categoryRegistry/service';
import { tagOptions } from '../../lib/techniqueTaxonomy';
import CategoryPicker, { type PickerValue } from './CategoryPicker';
import CategoryCreateForm from './CategoryCreateForm';

export interface ClassificationState {
  picker: PickerValue;
  tags: string[];
  edits: { name: string; koreanName: string; description: string; difficulty: Technique['difficulty'] };
  /** The user picked / confirmed a category (needed when the recommendation is not confident). */
  confirmed: boolean;
}

const GRAPPLING = ['bjj', 'judo', 'wrestling', 'sambo', 'mixed-martial-arts'];
const CONF_LABEL = { high: '높음', medium: '보통', low: '낮음 — 직접 확인 필요' } as const;

export function initialClassification(t: Technique, presetNodeId: string | null): ClassificationState {
  return {
    picker: { nodeId: presetNodeId, draft: null },
    tags: [],
    edits: { name: t.name, koreanName: t.koreanName ?? '', description: t.description ?? '', difficulty: t.difficulty ?? null },
    confirmed: !!presetNodeId,
  };
}

async function geminiAskJson(): Promise<AskJson> {
  const { askGeminiForJson } = await import('../../lib/fighterStyle/geminiJson');
  return (p) => askGeminiForJson(p);
}

/** 기본 정보 + 분류 (추천 · 계층형 선택 · 새 카테고리 · 세부 태그 · 무술별 조건) for a technique being registered. */
export default function RegistrationClassification({ art, technique, value, onChange }: { art: string; technique: Technique; value: ClassificationState; onChange: (v: ClassificationState) => void }) {
  const [rec, setRec] = useState<CategoryRecommendation>(() => recommendCategory(art, technique));
  const [aiBusy, setAiBusy] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const tags = useMemo(() => tagOptions(art), [art]);
  const all = useMemo(() => flattenPicker(categoryPickerTree(art)), [art]);

  // a confident recommendation pre-selects (still shown, still changeable); a weak one waits for the user
  useEffect(() => {
    if (!value.picker.nodeId && !value.picker.draft && rec.nodeId && rec.confidence !== 'low') onChange({ ...value, picker: { nodeId: rec.nodeId, draft: null }, tags: value.tags.length ? value.tags : rec.tags });
    else if (!value.tags.length && rec.tags.length) onChange({ ...value, tags: rec.tags });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec]);

  const set = (patch: Partial<ClassificationState>) => onChange({ ...value, ...patch });
  const edit = (patch: Partial<ClassificationState['edits']>) => set({ edits: { ...value.edits, ...patch } });
  const proposalParent = rec.proposal?.parentId ? all.find((n) => n.id === rec.proposal!.parentId) ?? null : null;

  return (
    <div className="card info-card" data-testid="registration-classification">
      <h3>기본 정보</h3>
      <div className="cat-form-grid">
        <label className="field-label" htmlFor="rt-ko">
          한국어 기술명
        </label>
        <input id="rt-ko" className="select field-full" value={value.edits.koreanName} onChange={(e) => edit({ koreanName: e.target.value })} data-testid="rt-ko" />
        <label className="field-label" htmlFor="rt-en">
          영어 기술명
        </label>
        <input id="rt-en" className="select field-full" value={value.edits.name} onChange={(e) => edit({ name: e.target.value })} data-testid="rt-en" />
        <label className="field-label" htmlFor="rt-desc">
          기술 설명
        </label>
        <textarea id="rt-desc" className="select field-full" rows={3} value={value.edits.description} onChange={(e) => edit({ description: e.target.value })} />
        <label className="field-label" htmlFor="rt-diff">
          난이도
        </label>
        <select id="rt-diff" className="select" value={value.edits.difficulty ?? ''} onChange={(e) => edit({ difficulty: (e.target.value || null) as Technique['difficulty'] })}>
          <option value="">미정</option>
          <option value="beginner">초급</option>
          <option value="intermediate">중급</option>
          <option value="advanced">고급</option>
        </select>
      </div>

      <h3 style={{ marginTop: 16 }}>분류</h3>
      <div className={`cat-rec cat-rec--${rec.confidence}`} data-testid="cat-recommendation" data-confidence={rec.confidence}>
        <div>
          <strong>추천 카테고리:</strong> {rec.path ?? '없음 — 직접 선택해 주세요'}{' '}
          <span className="cat-meta">
            · 확신도 {CONF_LABEL[rec.confidence]} · {rec.useExisting ? '기존 카테고리' : '맞는 기존 카테고리 없음'}
            {rec.source === 'rules+ai' ? ' · AI 검토 포함' : ''}
          </span>
        </div>
        <ul>
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {rec.similar.length > 0 && (
          <p className="cat-meta">
            비슷한 기존 기술: {rec.similar.map((s) => `${s.name} (${s.path})`).join(', ')}
          </p>
        )}
        <div className="chip-row">
          {rec.nodeId && value.picker.nodeId !== rec.nodeId && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ picker: { nodeId: rec.nodeId, draft: null }, confirmed: true })} data-testid="cat-apply-rec">
              추천 적용
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={aiBusy}
            onClick={async () => {
              setAiBusy(true);
              try {
                setRec(await recommendCategoryWithAi(art, { ...technique, name: value.edits.name, koreanName: value.edits.koreanName || null, description: value.edits.description }, await geminiAskJson()));
              } finally {
                setAiBusy(false);
              }
            }}
            data-testid="cat-ai-rec"
          >
            {aiBusy ? 'AI가 분류를 검토하는 중…' : 'AI에게 분류 검토 받기'}
          </button>
        </div>
        {rec.proposal && (
          <div className="cat-proposal" data-testid="cat-proposal">
            AI 제안 — 새 카테고리 “{rec.proposal.ko}{rec.proposal.en ? ` (${rec.proposal.en})` : ''}”{proposalParent ? ` (위치: ${proposalParent.path})` : ' (새 대분류)'}: {rec.proposal.reason}
            {rec.proposal.duplicateOf ? (
              <div className="cat-meta">이미 같은 카테고리가 있어 만들 수 없습니다 — 기존 카테고리를 사용하세요.</div>
            ) : (
              <div className="cat-meta">AI가 직접 만들지는 않습니다. 검토 후 승인하면 기술을 저장할 때 만들어집니다.</div>
            )}
            {!rec.proposal.duplicateOf && !proposalOpen && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProposalOpen(true)} data-testid="cat-proposal-review">
                제안 검토하기
              </button>
            )}
            {proposalOpen && (
              <CategoryCreateForm
                art={art}
                parent={proposalParent}
                initial={{ ko: rec.proposal.ko, en: rec.proposal.en, description: rec.proposal.reason, origin: 'ai_approved' }}
                submitLabel="승인 — 이 카테고리로 선택 (저장 때 생성)"
                onSubmit={(input) => {
                  set({ picker: { nodeId: input.parentId, draft: input }, confirmed: true });
                  setProposalOpen(false);
                }}
                onUseExisting={(id) => {
                  set({ picker: { nodeId: id, draft: null }, confirmed: true });
                  setProposalOpen(false);
                }}
                onCancel={() => setProposalOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      <CategoryPicker art={art} value={value.picker} onChange={(picker) => set({ picker, confirmed: true })} />
      {rec.confidence === 'low' && !value.confirmed && <p className="ai-error">추천 확신도가 낮아 자동으로 정하지 않았어요. 카테고리를 직접 선택해 주세요.</p>}

      {tags.length > 0 && (
        <>
          <p className="field-label" style={{ marginTop: 12 }}>
            기술 목적·유형 태그 <span className="cat-meta">(선택 · 여러 개)</span>
          </p>
          <div className="chip-row" data-testid="cat-tags">
            {tags.map((t) => (
              <button key={t.id} type="button" className={`chip${value.tags.includes(t.id) ? ' chip--active' : ''}`} aria-pressed={value.tags.includes(t.id)} onClick={() => set({ tags: value.tags.includes(t.id) ? value.tags.filter((x) => x !== t.id) : [...value.tags, t.id] })}>
                {t.ko}
              </button>
            ))}
          </div>
        </>
      )}
      {GRAPPLING.includes(art) && <p className="cat-meta" style={{ marginTop: 10 }}>그래플링 기술은 저장할 때 Gi / No-Gi 수행 방식을 근거 자료로 조사해 함께 기록합니다.</p>}
    </div>
  );
}
