import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams, Navigate } from 'react-router-dom';
import Icon from '../components/Icon';
import TechniqueRow from '../components/TechniqueRow';
import EmptyState from '../components/EmptyState';
import { techniqueTypeTags, uniqueSorted } from '../lib/search';
import { isTechniqueInArt, techniqueCategoryInArt } from '../lib/techniqueCanonical';
import { getUnifiedAllTechniques, getUnifiedMartialArt, getUnifiedMartialArtSummaries, searchAllTechniques } from '../lib/userTechniques/service';
import { ADD_TEQ_CACHE_EVENT } from '../lib/addTeq/repository';
import BackButton from '../components/BackButton';
import RequestMissingTechnique from '../components/RequestMissingTechnique';
import { findTaxonomyNodesInText, getArtTaxonomy, purposeTagsOf, tagOptions, taxonomyBreadcrumb, techniqueIdsForNode } from '../lib/techniqueTaxonomy';
import { getPositionTree, hasPositionTaxonomy, positionLabel, reviewIds, techniqueIdsInPosition } from '../lib/positionTaxonomy';

const RESULT_LIMIT = 2000; // effectively "no limit" for a corpus of ~1,100 techniques
// Confirmed real mobile-performance issue (perf audit): landing on this page
// with no filters (e.g. via Header's mobile search icon) hit searchTechniques's
// `!q` branch and rendered the ENTIRE technique corpus (~1,283+ rows) as DOM
// nodes at once, each TechniqueRow independently doing a synchronous
// localStorage read via useFavorites() on mount. PAGE_SIZE caps how many
// rows are ever rendered at once — filtering/search/counts are unaffected
// (`filtered` still holds the full matching set for the "N개 기술" count),
// only the DOM slice rendered is capped, with a "더 보기" button to reveal more.
const PAGE_SIZE = 60;

export default function TechniqueList() {
  const { martialArtId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  // Managed martial-art list with unified (shared-library) technique counts.
  const availableMartialArts = getUnifiedMartialArtSummaries();

  // getUnifiedMartialArt (not the official-only getMartialArt) so the
  // unified technique counts are used; an unknown or retired art id
  // (우슈·택견 — the 무술 추가 feature was removed) redirects to the list.
  const art = martialArtId ? getUnifiedMartialArt(martialArtId) : undefined;
  if (martialArtId && !art) return <Navigate to="/arts" replace />;

  const q = searchParams.get('q') ?? '';

  // The search input used to be bound directly to the URL param — every
  // keystroke called setSearchParams synchronously, which changed `q` and
  // re-ran the `filtered` useMemo below (searchAllTechniques over ~1,310
  // techniques with RESULT_LIMIT=2000, so the Fuse-skip optimization in
  // search.ts can never kick in here — the corpus itself is smaller than
  // the limit). Same measured cost as SearchBar.tsx (40-220ms per call),
  // so typing here blocked the very render that shows the typed character.
  // `qInput` is what the text field actually displays (instant); the URL
  // param (and therefore `filtered`) only updates ~150ms after typing
  // settles. Re-synced from `q` so external navigation (e.g. Header's
  // "전체 검색 결과 보기" link) still shows up immediately.
  const [qInput, setQInput] = useState(q);
  useEffect(() => {
    setQInput(q);
  }, [q]);
  const [missingTechniqueOpen, setMissingTechniqueOpen] = useState(false);
  const martialArtParam = martialArtId || (searchParams.get('martialArt') ?? '');
  const category = searchParams.get('category') ?? '';
  const position = searchParams.get('position') ?? '';
  const difficulty = searchParams.get('difficulty') ?? '';
  const type = searchParams.get('type') ?? '';
  // 계층형 분류 (techniqueTaxonomy): a node id ("bjj/half-guard/sweep") and a purpose / type tag ("sweep")
  const nodeParam = searchParams.get('node') ?? '';
  // 포지션 중심 분류 (positionTaxonomy, BJJ · MMA): ?pos=<position>[&purpose=<purpose>]; pos=_review = 미분류 검토
  const posParam = searchParams.get('pos') ?? '';
  const purposeParam = searchParams.get('purpose') ?? '';
  const tag = searchParams.get('tag') ?? '';

  // Re-renders when the user adds/removes a "기술 추가 요청" technique, or
  // when the shared add_teq library changes (a fresh login-time pull, or a
  // technique just discovered by an AI feature elsewhere) — so search
  // results/option lists reflect it immediately (spec [문제 3]) without
  // rebuilding the official search index at all.
  const [userTechniquesTick, setUserTechniquesTick] = useState(0);
  useEffect(() => {
    const onUpdate = () => setUserTechniquesTick((n) => n + 1);
    window.addEventListener('martialdex:user-techniques-updated', onUpdate);
    window.addEventListener(ADD_TEQ_CACHE_EVENT, onUpdate);
    return () => {
      window.removeEventListener('martialdex:user-techniques-updated', onUpdate);
      window.removeEventListener(ADD_TEQ_CACHE_EVENT, onUpdate);
    };
  }, []);

  // Options for every dropdown are derived from the real dataset, scoped to
  // whichever martial art is currently selected — so e.g. picking "유도"
  // narrows the category/position/type lists down to categories that
  // actually exist in judo, instead of showing all ~140 across every art.
  const scopedForOptions = useMemo(
    () => {
      const all = getUnifiedAllTechniques();
      return martialArtParam ? all.filter((t) => isTechniqueInArt(t, martialArtParam)) : all;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [martialArtParam, userTechniquesTick]
  );

  const categoryOptions = useMemo(
    () => uniqueSorted(scopedForOptions.map((t) => (martialArtParam ? techniqueCategoryInArt(t, martialArtParam) : t.category))),
    [scopedForOptions]
  );
  const positionOptions = useMemo(
    () => uniqueSorted(scopedForOptions.flatMap((t) => t.positions)),
    [scopedForOptions]
  );
  const typeOptions = useMemo(
    () => uniqueSorted(scopedForOptions.flatMap((t) => techniqueTypeTags(t))),
    [scopedForOptions]
  );

  const filtered = useMemo(
    () =>
      searchAllTechniques(q, RESULT_LIMIT, {
        martialArt: martialArtParam || undefined,
        category: category || undefined,
        position: position || undefined,
        difficulty: difficulty || undefined,
        type: type || undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, martialArtParam, category, position, difficulty, type, userTechniquesTick]
  );

  // the taxonomy of the art in scope (memoized in the module); a node from another art is ignored
  const taxonomy = useMemo(
    () => (martialArtParam ? getArtTaxonomy(martialArtParam) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [martialArtParam, userTechniquesTick]
  );
  const node = taxonomy && nodeParam ? taxonomy.nodes.get(nodeParam) ?? null : null;
  const tagChoices = useMemo(() => (martialArtParam ? tagOptions(martialArtParam) : []), [martialArtParam, taxonomy]);
  const filteredByTaxonomy = useMemo(() => {
    let out = filtered;
    if (node) {
      const ids = techniqueIdsForNode(node.id);
      out = out.filter((t) => ids.has(t.id));
    }
    if (tag && martialArtParam) out = out.filter((t) => purposeTagsOf(t.id, martialArtParam).some((e) => e.dim === tag));
    if (posParam && martialArtParam && hasPositionTaxonomy(martialArtParam)) {
      const ids = posParam === '_review' ? reviewIds(martialArtParam) : techniqueIdsInPosition(martialArtParam, posParam, purposeParam || null);
      out = out.filter((t) => ids.has(t.id));
    }
    return out;
  }, [filtered, node, tag, martialArtParam, posParam, purposeParam]);
  const posLabel = posParam && martialArtParam ? (posParam === '_review' ? '미분류 검토' : positionLabel(martialArtParam, posParam, purposeParam || null)) : null;
  // "하프 가드 스윕" typed into the search box → offer the matching categories themselves
  const matchingNodes = useMemo(() => (q.trim().length >= 2 ? findTaxonomyNodesInText(q, martialArtParam ? [martialArtParam] : undefined).slice(0, 6) : []), [q, martialArtParam]);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [q, martialArtParam, category, position, difficulty, type, nodeParam, tag, posParam, purposeParam]);
  const visibleResults = useMemo(() => filteredByTaxonomy.slice(0, visibleCount), [filteredByTaxonomy, visibleCount]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (qInput === q) return; // already in sync (initial mount, or an external nav just updated qInput above) — no-op
    const timer = window.setTimeout(() => updateParam('q', qInput), 150);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams);
    for (const key of ['q', 'category', 'position', 'difficulty', 'type', 'martialArt', 'node', 'tag', 'pos', 'purpose']) next.delete(key);
    setSearchParams(next);
  }

  const hasActiveFilters = Boolean(q || category || position || difficulty || type || nodeParam || tag || posParam || (!martialArtId && martialArtParam));
  const trail = node ? taxonomyBreadcrumb(node.id) : [];
  const nodeLink = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('node', id);
    next.delete('category');
    return `?${next.toString()}`;
  };

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="breadcrumb">
          <Link to="/">홈</Link>
          <span>/</span>
          {art ? (
            <>
              <Link to="/arts">무술 목록</Link>
              <span>/</span>
              <Link to={`/arts/${art.id}`}>{art.nameKo}</Link>
              <span>/</span>
              {trail.length === 0 ? (
                <span>전체 기술</span>
              ) : (
                <>
                  <Link to={`/arts/${art.id}/techniques`}>전체 기술</Link>
                  {trail.map((n, i) => (
                    <span key={n.id} style={{ display: 'contents' }}>
                      <span>/</span>
                      {i === trail.length - 1 ? <span data-testid="taxonomy-crumb-current">{n.ko}</span> : <Link to={nodeLink(n.id)}>{n.ko}</Link>}
                    </span>
                  ))}
                </>
              )}
            </>
          ) : (
            <span>전체 기술 검색</span>
          )}
        </div>

        <div className="section-title">
          <h2>{node ? `${art?.nameKo ?? ''} · ${node.fullKo}` : posLabel ? `${art?.nameKo ?? ''} · ${posLabel}` : art ? `${art.nameKo} 기술 목록` : '전체 기술 검색'}</h2>
          <div className="chip-row" style={{ gap: 12 }}>
            {martialArtId && art && (
              <button type="button" className="see-all" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setMissingTechniqueOpen((v) => !v)}>
                + 없는 기술 요청
              </button>
            )}
            <Link to="/techniques/request" className="see-all">
              + 기술 추가 요청
            </Link>
          </div>
        </div>

        {missingTechniqueOpen && martialArtId && art && (
          <RequestMissingTechnique
            martialArtId={martialArtId}
            martialArtNameKo={art.nameKo}
            martialArtNameEn={art.nameEn}
            onClose={() => setMissingTechniqueOpen(false)}
            onRegistered={() => {}}
          />
        )}

        {posLabel && martialArtParam && (
          <div className="taxonomy-node-bar" data-testid="position-filter-bar" data-pos={posParam} data-purpose={purposeParam}>
            {purposeParam && (
              <Link className="chip" to={`/arts/${martialArtParam}/techniques?pos=${encodeURIComponent(posParam)}`}>
                ↑ {positionLabel(martialArtParam, posParam)} 전체
              </Link>
            )}
            {getPositionTree(martialArtParam)
              ?.positions.find((x) => x.id === posParam)
              ?.purposes.filter((u) => u.id !== purposeParam)
              .map((u) => (
                <Link key={u.id} className="chip" to={`/arts/${martialArtParam}/techniques?pos=${encodeURIComponent(posParam)}&purpose=${encodeURIComponent(u.id)}`} data-testid="position-sibling">
                  {u.ko} ({u.techniqueIds.length})
                </Link>
              ))}
            <button
              type="button"
              className="chip"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('pos');
                next.delete('purpose');
                setSearchParams(next);
              }}
            >
              분류 해제 <Icon name="close" />
            </button>
          </div>
        )}

        {node && (
          <div className="taxonomy-node-bar" data-testid="taxonomy-node-bar">
            {node.parentId && (
              <Link className="chip" to={nodeLink(node.parentId)}>
                ↑ {taxonomyBreadcrumb(node.parentId).slice(-1)[0]?.ko}
              </Link>
            )}
            {node.children.map((cid) => {
              const c = taxonomy!.nodes.get(cid)!;
              return (
                <Link key={cid} className="chip" to={nodeLink(cid)} data-testid="taxonomy-child">
                  {c.ko} ({c.count})
                </Link>
              );
            })}
            <button type="button" className="chip" onClick={() => updateParam('node', '')}>
              분류 해제 <Icon name="close" />
            </button>
          </div>
        )}
        {matchingNodes.length > 0 && !node && (
          <div className="taxonomy-node-bar" data-testid="taxonomy-suggestions">
            <span className="technique-row__sub">카테고리로 보기:</span>
            {matchingNodes.map((n) => (
              <Link key={n.id} className="chip" to={`/arts/${n.art}/techniques?node=${encodeURIComponent(n.id)}`}>
                {!martialArtParam ? `${getUnifiedMartialArt(n.art)?.nameKo ?? n.art} · ` : ''}
                {n.fullKo} ({n.count})
              </Link>
            ))}
          </div>
        )}

        <div className="filter-bar">
          <div className="filter-bar__left">
            <input
              type="text"
              className="select filter-text-input"
              placeholder="기술 이름, 한글명, 태그로 검색..."
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            {!martialArtId && (
              <select
                className="select"
                value={martialArtParam}
                onChange={(e) => {
                  // Build the whole next param set in one go — calling
                  // updateParam() multiple times here would have each call
                  // read the same stale searchParams snapshot and clobber
                  // the previous one instead of combining.
                  const next = new URLSearchParams(searchParams);
                  if (e.target.value) next.set('martialArt', e.target.value);
                  else next.delete('martialArt');
                  // reset filters that may no longer be valid for the new scope
                  next.delete('category');
                  next.delete('position');
                  next.delete('type');
                  next.delete('node');
                  next.delete('tag');
                  setSearchParams(next);
                }}
              >
                <option value="">전체 무술</option>
                {availableMartialArts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nameKo}
                  </option>
                ))}
              </select>
            )}
            <select
              className="select"
              value={category}
              onChange={(e) => updateParam('category', e.target.value)}
            >
              <option value="">전체 카테고리</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={position}
              onChange={(e) => updateParam('position', e.target.value)}
            >
              <option value="">전체 포지션</option>
              {positionOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={difficulty}
              onChange={(e) => updateParam('difficulty', e.target.value)}
            >
              <option value="">전체 난이도</option>
              <option value="beginner">초급</option>
              <option value="intermediate">중급</option>
              <option value="advanced">고급</option>
            </select>
            {tagChoices.length > 0 && (
              <select className="select" value={tag} onChange={(e) => updateParam('tag', e.target.value)} data-testid="taxonomy-tag-filter">
                <option value="">전체 목적·유형</option>
                {tagChoices.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ko} ({t.count})
                  </option>
                ))}
              </select>
            )}
            <select className="select" value={type} onChange={(e) => updateParam('type', e.target.value)}>
              <option value="">전체 기술 유형</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/^#/, '')}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                필터 초기화
              </button>
            )}
          </div>
          <span className="result-count">{filteredByTaxonomy.length}개 기술</span>
        </div>

        {filteredByTaxonomy.length === 0 ? (
          <EmptyState
            icon="🔍"
            text={
              q
                ? `"${q}"에 대한 검색 결과가 없습니다. 검색어나 필터를 조정해보세요.`
                : '조건에 맞는 기술이 없습니다. 필터를 조정해보세요.'
            }
          />
        ) : (
          <>
            <div className="stack gap-2">
              {visibleResults.map((t) => (
                <TechniqueRow key={t.id} technique={t} contextArt={martialArtParam || undefined} />
              ))}
            </div>
            {visibleCount < filteredByTaxonomy.length && (
              <div className="modal-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                  더 보기 ({visibleResults.length}/{filteredByTaxonomy.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
