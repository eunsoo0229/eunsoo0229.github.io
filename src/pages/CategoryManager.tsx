import Icon from '../components/Icon';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import CategoryCreateForm from '../components/categoryRegistry/CategoryCreateForm';
import { useAuth } from '../lib/auth/AuthProvider';
import { CUSTOM_CATEGORIES_EVENT, customCategoriesOf } from '../lib/categoryRegistry/store';
import {
  categoryPickerTree,
  categoryTechniques,
  createCategory,
  deleteCategory,
  flattenPicker,
  isCategoryAdmin,
  mergeCategory,
  moveCategory,
  setCategoryActive,
  updateCategory,
  type PickerNode,
} from '../lib/categoryRegistry/service';
import '../lib/categoryRegistry/taxonomy';
import { techniquesForNode } from '../lib/techniqueTaxonomy';
import { getUnifiedMartialArtSummaries } from '../lib/userTechniques/service';

const KIND_LABEL: Record<string, string> = { group: '대분류', member: '기존 카테고리', split: '자동 세부 분류', potential: '자동 세부 분류 (아직 기술 없음)', custom: '사용자 카테고리' };

function TreeRow({ n, selected, onSelect }: { n: PickerNode; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" className={`cat-tree__node${selected === n.id ? ' is-selected' : ''}`} onClick={() => onSelect(n.id)} data-testid="cat-tree-node" data-id={n.id}>
        {n.ko}
        {n.en && n.en !== n.ko ? <span className="cat-meta"> {n.en}</span> : null} <span className="cat-count">{n.count}</span>
        {n.custom ? <span className="cat-badge">사용자</span> : null}
      </button>
      {n.children.length > 0 && (
        <ul>
          {n.children.map((c) => (
            <TreeRow key={c.id} n={c} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 기술 카테고리 관리 — every art's category tree with technique counts; registry categories can be edited by administrators. */
export default function CategoryManager() {
  const { user } = useAuth();
  const arts = useMemo(() => getUnifiedMartialArtSummaries().filter((a) => !['home-training', 'gym-training'].includes(a.id)), []);
  const [art, setArt] = useState(arts.find((a) => a.id === 'bjj')?.id ?? arts[0]?.id ?? 'bjj');
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState<'child' | 'top' | null>(null);
  const [edit, setEdit] = useState<{ ko: string; en: string; description: string } | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [mergeTo, setMergeTo] = useState('');

  useEffect(() => {
    void isCategoryAdmin(user?.id ?? null).then(setAdmin);
  }, [user?.id]);
  useEffect(() => {
    const on = () => setVersion((v) => v + 1);
    window.addEventListener(CUSTOM_CATEGORIES_EVENT, on);
    return () => window.removeEventListener(CUSTOM_CATEGORIES_EVENT, on);
  }, []);

  const roots = useMemo(() => categoryPickerTree(art), [art, version]);
  const all = useMemo(() => flattenPicker(roots), [roots]);
  const inactive = useMemo(() => customCategoriesOf(art).filter((c) => c.status === 'inactive'), [art, version]);
  const selected = selectedId ? all.find((n) => n.id === selectedId) ?? null : null;
  const selectedCustom = selected?.custom ?? (selectedId ? customCategoriesOf(art).find((c) => c.id === selectedId) ?? null : null);
  const techniques = useMemo(() => {
    if (!selectedId) return [];
    const fromTree = techniquesForNode(selectedId);
    return fromTree.length ? fromTree : categoryTechniques(selectedId);
  }, [selectedId, version]);
  const canEdit = !!selectedCustom && (selectedCustom.local || admin);

  /** Runs a management action; true when it succeeded (only then does the screen move on). */
  const run = async (p: Promise<{ ok: boolean; message?: string }>, done: string): Promise<boolean> => {
    const r = await p;
    setMessage(r.ok ? done : (r as { message: string }).message);
    if (r.ok) setVersion((v) => v + 1);
    return r.ok;
  };

  return (
    <div className="page" data-testid="category-manager">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h2><Icon name="folder" /> 기술 카테고리 관리</h2>
        </div>
        <p className="video-status-message" style={{ marginTop: -8 }}>
          무술별 카테고리 구조와 기술 수를 확인하고, 새 카테고리를 만들 수 있어요. 공식 카테고리와 자동 세부 분류는 기술 데이터에서 계산되어 바꿀 수 없고, 사용자 카테고리는 관리자가 이름·위치·통합·비활성화를 관리합니다.
          {admin ? ' (관리자 권한)' : ''}
        </p>
        <div className="chip-row" style={{ marginBottom: 10 }}>
          <select className="select" value={art} onChange={(e) => { setArt(e.target.value); setSelectedId(null); setCreating(null); }} data-testid="cat-art">
            {arts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nameKo}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating('top')} data-testid="cat-new-top">
            ＋ 새 대분류
          </button>
          <Link className="btn btn-ghost btn-sm" to={`/techniques/request?art=${encodeURIComponent(art)}${selectedId ? `&node=${encodeURIComponent(selectedId)}` : ''}`}>
            이 분류로 기술 추가
          </Link>
        </div>
        {message && <p className="video-status-message" role="status" data-testid="cat-message">{message}</p>}
        {creating === 'top' && (
          <div className="card info-card">
            <CategoryCreateForm
              art={art}
              parent={null}
              onSubmit={async (input) => {
                const r = await createCategory({ ...input, origin: admin ? 'admin' : 'user' }, user?.id ?? null);
                setMessage(r.ok ? `“${r.value.ko}” 대분류를 만들었습니다.${r.warning ? ` ${r.warning}` : ''} 기술을 등록하면 목록에 나타납니다.` : r.message);
                if (r.ok) { setCreating(null); setSelectedId(r.value.id); setVersion((v) => v + 1); }
              }}
              onUseExisting={(id) => { setSelectedId(id); setCreating(null); }}
              onCancel={() => setCreating(null)}
            />
          </div>
        )}
        <div className="cat-manager">
          <div className="card info-card cat-tree" data-testid="cat-tree">
            <ul>
              {roots.map((r) => (
                <TreeRow key={r.id} n={r} selected={selectedId} onSelect={(id) => { setSelectedId(id); setEdit(null); setCreating(null); setMessage(null); }} />
              ))}
            </ul>
            {inactive.length > 0 && (
              <>
                <p className="cat-meta" style={{ marginTop: 10 }}>비활성 카테고리</p>
                <ul>
                  {inactive.map((c) => (
                    <li key={c.id}>
                      <button type="button" className={`cat-tree__node${selectedId === c.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(c.id)}>
                        {c.ko} <span className="cat-badge">비활성</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="card info-card cat-detail" data-testid="cat-detail">
            {!selectedId ? (
              <p className="cat-meta">왼쪽에서 카테고리를 고르세요.</p>
            ) : (
              <>
                <h3>{selected?.path ?? selectedCustom?.ko}</h3>
                <p className="cat-meta">
                  {selectedCustom ? `사용자 카테고리${selectedCustom.local ? ' · 이 기기에만 저장' : ''}${selectedCustom.status === 'inactive' ? ' · 비활성' : ''}` : KIND_LABEL[selected?.kind ?? ''] ?? ''} · 기술 {techniques.length}개
                  {selected?.categoryString ? ` · 카테고리 이름 “${selected.categoryString}”` : ''}
                </p>
                {selectedCustom?.description && <p>{selectedCustom.description}</p>}
                {selected && selected.level < 4 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating('child')} data-testid="cat-new-child">
                    ＋ 하위 카테고리 만들기
                  </button>
                )}
                {creating === 'child' && selected && (
                  <CategoryCreateForm
                    art={art}
                    parent={selected}
                    onSubmit={async (input) => {
                      const r = await createCategory({ ...input, origin: admin ? 'admin' : 'user' }, user?.id ?? null);
                      setMessage(r.ok ? `“${r.value.ko}” 카테고리를 만들었습니다.${r.warning ? ` ${r.warning}` : ''}` : r.message);
                      if (r.ok) { setCreating(null); setVersion((v) => v + 1); }
                    }}
                    onUseExisting={(id) => { setSelectedId(id); setCreating(null); }}
                    onCancel={() => setCreating(null)}
                  />
                )}
                {selectedCustom && !canEdit && <p className="cat-meta">공용 카테고리의 수정·이동·통합·비활성화·삭제는 관리자만 할 수 있습니다.</p>}
                {selectedCustom && canEdit && (
                  <div className="cat-admin" data-testid="cat-admin">
                    {edit ? (
                      <div className="cat-form-grid">
                        <input className="select" value={edit.ko} onChange={(e) => setEdit({ ...edit, ko: e.target.value })} aria-label="한국어 이름" data-testid="cat-edit-ko" />
                        <input className="select" value={edit.en} onChange={(e) => setEdit({ ...edit, en: e.target.value })} aria-label="영어 이름" />
                        <textarea className="select" rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="설명" />
                        <div className="chip-row">
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => void run(updateCategory(selectedCustom.id, edit, user?.id ?? null), '이름·설명을 바꿨습니다.').then((ok) => ok && setEdit(null))} data-testid="cat-edit-save">저장</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ ko: selectedCustom.ko, en: selectedCustom.en, description: selectedCustom.description })} data-testid="cat-edit">이름·설명 수정</button>
                    )}
                    {selectedCustom.parentId && (
                      <div className="chip-row">
                        <select className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="옮길 위치">
                          <option value="">옮길 상위 카테고리…</option>
                          {all.filter((n) => n.level < 4 && n.id !== selectedCustom.id && n.kind !== 'potential').map((n) => (
                            <option key={n.id} value={n.id}>{n.path}</option>
                          ))}
                        </select>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={!moveTo} onClick={() => void run(moveCategory(selectedCustom.id, moveTo, user?.id ?? null), '옮겼습니다. 소속 기술 ID는 그대로입니다.')}>이동</button>
                      </div>
                    )}
                    {selectedCustom.parentId && (
                      <div className="chip-row">
                        <select className="select" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} aria-label="통합할 카테고리">
                          <option value="">통합할 사용자 카테고리…</option>
                          {customCategoriesOf(art).filter((c) => c.id !== selectedCustom.id && c.status === 'active').map((c) => (
                            <option key={c.id} value={c.id}>{all.find((n) => n.id === c.id)?.path ?? c.ko}</option>
                          ))}
                        </select>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={!mergeTo} onClick={() => window.confirm('통합하면 이 카테고리의 기술이 대상 카테고리로 옮겨집니다 (기술 ID는 그대로). 진행할까요?') && void run(mergeCategory(selectedCustom.id, mergeTo, user?.id ?? null), '통합했습니다.').then((ok) => ok && setSelectedId(mergeTo))}>통합</button>
                      </div>
                    )}
                    <div className="chip-row">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(setCategoryActive(selectedCustom.id, selectedCustom.status !== 'active', user?.id ?? null), selectedCustom.status === 'active' ? '비활성화했습니다 (기존 기술은 그대로 보입니다).' : '다시 활성화했습니다.')} data-testid="cat-toggle-active">
                        {selectedCustom.status === 'active' ? '비활성화' : '다시 활성화'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm('이 카테고리를 삭제할까요? (기술이 없을 때만 삭제됩니다)') && void run(deleteCategory(selectedCustom.id, user?.id ?? null), '삭제했습니다.').then((ok) => ok && setSelectedId(null))} data-testid="cat-delete">
                        삭제
                      </button>
                    </div>
                  </div>
                )}
                <h4 style={{ marginTop: 12 }}>소속 기술</h4>
                {techniques.length ? (
                  <ul className="cat-techniques" data-testid="cat-techniques">
                    {techniques.slice(0, 80).map((t) => (
                      <li key={t.id}>
                        <Link to={`/arts/${art}/techniques/${t.id}`}>{t.koreanName || t.name}</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="cat-meta">아직 이 카테고리에 등록된 기술이 없어요.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
