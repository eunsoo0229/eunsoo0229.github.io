import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import RecommendationCard from '../components/tacticalFinder/RecommendationCard';
import { LibraryResults, ModeBadge, ModeSelector, WebLoading, WebResults, type SearchMode } from '../components/tacticalFinder/FinderPanels';
import { martialArtSummaries } from '../lib/loadData';
import { CATEGORY_WANTS, DIFFICULTY_LABEL } from '../lib/tacticalFinder/lexicon';
import { searchLibrary, type LibrarySearchResult } from '../lib/tacticalFinder/libraryFinder';
import { DEFAULT_FILTERS, findTactics, findTacticsWithAi } from '../lib/tacticalFinder/recommend';
import { webSearch, type WebSearchResult, type WebTab } from '../lib/tacticalFinder/webSearch';
import { tacticalStore, useTacticalStore } from '../lib/tacticalFinder/store';
import { techniqueIndex } from '../lib/tacticalFinder/techniqueIndex';
import type { DifficultyPref, Filters, FinderResult, QuickCategory, Recommendation, RecKind } from '../lib/tacticalFinder/types';
import '../styles/tactical-finder.css';

const EXAMPLES = [
  '상대가 계속 뒤로 빠질 때 공격을 연결하고 싶어.',
  '상대가 내 잽에 반응해서 가드를 올리면 다음 공격을 어떻게 연결할까?',
  '상대의 테이크다운 시도를 방어한 뒤 유리한 포지션을 만들고 싶어.',
  '상대가 압박할 때 거리를 유지하면서 카운터하고 싶어.',
  '클린치 상황에서 유리한 공격 기회를 만들고 싶어.',
  '상대의 공격을 회피한 뒤 반격하는 조합을 찾고 싶어.',
];
const COMBO_EXAMPLES = [
  '더블렉을 위한 셋업',
  '잽 이후 연결할 수 있는 콤보',
  '상대 가드를 여는 셋업',
  '바디 공격 이후 헤드 공격으로 이어지는 콤보',
  '클린치 진입을 위한 셋업',
  '상대의 후퇴를 유도하는 셋업',
];
const CATEGORIES = Object.keys(CATEGORY_WANTS) as QuickCategory[];
const KINDS: { id: RecKind | null; label: string }[] = [
  { id: null, label: '전체' },
  { id: 'technique', label: '기술' },
  { id: 'setup', label: '셋업' },
  { id: 'combo', label: '콤보' },
];
const ART_OPTIONS = martialArtSummaries.filter((a) => !['home-training', 'gym-training'].includes(a.id));

function Section({ title, hint, list, query, testId }: { title: string; hint: string; list: Recommendation[]; query: string; testId: string }) {
  if (!list.length) return null;
  return (
    <section className="tf-section" data-testid={testId} data-count={list.length}>
      <div className="tf-section__head">
        <h2>{title}</h2>
        <span className="tf-muted">{hint}</span>
      </div>
      <div className="tf-grid">
        {list.map((r) => (
          <RecommendationCard key={r.key} rec={r} query={query} />
        ))}
      </div>
    </section>
  );
}

export default function TacticalFinder() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'saved' ? 'saved' : params.get('view') === 'history' ? 'history' : 'search';
  const prefs = useMemo(() => tacticalStore.prefs(), []);
  const [text, setText] = useState(params.get('q') ?? '');
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, personal: prefs.personal });
  const [ai, setAi] = useState(prefs.ai);
  const [result, setResult] = useState<FinderResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);
  const [mode, setModeState] = useState<SearchMode>(params.get('mode') === 'web' ? 'web' : prefs.mode ?? 'app');
  const [tab, setTabState] = useState<WebTab>(params.get('tab') === 'combo' ? 'combo' : prefs.tab ?? 'technique');
  const [comboText, setComboText] = useState('');
  const [comboResult, setComboResult] = useState<LibrarySearchResult | null>(null);
  const [web, setWeb] = useState<Record<WebTab, WebSearchResult | null>>({ technique: null, combo: null });
  const [webBusy, setWebBusy] = useState<Record<WebTab, boolean>>({ technique: false, combo: false });
  const webRun = useRef<Record<WebTab, number>>({ technique: 0, combo: 0 });

  function setMode(m: SearchMode) {
    setModeState(m);
    tacticalStore.setPrefs({ mode: m });
    setError(null);
  }
  function setTab(t: WebTab) {
    setTabState(t);
    tacticalStore.setPrefs({ tab: t });
    setError(null);
  }

  /** WEB SEARCH — only on an explicit search with the web mode chosen; its own cache; never mixed with app results. */
  function runWeb(t: WebTab, query: string) {
    const q = query.trim();
    if (!q) {
      setError(t === 'combo' ? '찾고 싶은 셋업·콤보의 목적을 입력해 주세요.' : '상황이나 목적을 입력해 주세요.');
      return;
    }
    setError(null);
    const id = ++webRun.current[t];
    setWebBusy((b) => ({ ...b, [t]: true }));
    webSearch(q, t)
      .then((r) => id === webRun.current[t] && setWeb((w) => ({ ...w, [t]: r })))
      .finally(() => id === webRun.current[t] && setWebBusy((b) => ({ ...b, [t]: false })));
  }

  function runCombo(query: string) {
    const q = query.trim();
    if (!q) {
      setError('찾고 싶은 셋업·콤보의 목적을 입력해 주세요. 예) 더블렉을 위한 셋업');
      return;
    }
    setError(null);
    if (mode === 'web') return runWeb('combo', q);
    try {
      setComboResult(searchLibrary(q));
    } catch (e) {
      setError(`검색 중 오류가 났습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const history = useTacticalStore(() => tacticalStore.history());
  const saved = useTacticalStore(() => tacticalStore.saved());

  function run(query: string, f: Filters, page = 0) {
    const q = query.trim();
    if (!q && !f.category) {
      setError('상황이나 목적을 입력하거나 카테고리를 골라 주세요.');
      return;
    }
    setError(null);
    const id = ++runId.current;
    try {
      // the DB search answers at once; the AI refinement (if on) replaces it when it arrives
      const r = findTactics(q, f, page);
      setResult(r);
      if (page === 0) tacticalStore.addHistory(q || CATEGORY_WANTS[f.category!].label, f, r.techniques.length + r.setups.length + r.combos.length);
      if (ai && !r.analysis.safety.blocked && (q || f.category)) {
        setAiBusy(true);
        findTacticsWithAi(q, f, page)
          .then((x) => id === runId.current && setResult(x))
          .catch((e) => id === runId.current && setResult({ ...r, notices: [...r.notices, { tone: 'warn', text: `AI 분석 오류: ${e instanceof Error ? e.message : String(e)} — 기술 DB 검색 결과만 표시합니다.` }] }))
          .finally(() => id === runId.current && setAiBusy(false));
      }
    } catch (e) {
      setError(`검색 중 오류가 났습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // a ?q= link (history / shared) searches on open
  useEffect(() => {
    const q = params.get('q');
    if (q && view === 'search' && tab === 'technique' && mode === 'app') run(q, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setFilter<K extends keyof Filters>(k: K, v: Filters[K]) {
    const next = { ...filters, [k]: v };
    setFilters(next);
    if (k === 'personal') tacticalStore.setPrefs({ personal: v as boolean });
    if (result || k === 'category') run(text, next);
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (mode === 'web') runWeb('technique', text);
    else run(text, filters);
  }

  const a = result?.analysis;
  return (
    <div className="page tf-page" data-testid="tactical-finder">
      <div className="container">
        <header className="tf-hero">
          <div className="tf-hero__eyebrow">MARTIALDEX · TACTICAL FINDER</div>
          <h1 className="tf-hero__title">TACTICAL FINDER</h1>
          <p className="tf-hero__lead">Find the right technique for your goal.</p>
          <p className="tf-hero__desc">원하는 경기 상황이나 해결하고 싶은 문제를 문장으로 적으면, MARTIALDEX 기술 DB에 실제로 있는 기술·셋업·콤보 중에서 목적에 맞는 것을 근거와 함께 찾아 드립니다. 훈련·경기 규칙 안에서 쓰는 스포츠 기술만 추천합니다.</p>
        </header>

        <nav className="tf-views" aria-label="보기">
          <button type="button" className={view === 'search' ? 'is-on' : ''} onClick={() => setParams({})} data-testid="tf-view-search">
            <Icon name="search" /> 찾기
          </button>
          <button type="button" className={view === 'saved' ? 'is-on' : ''} onClick={() => setParams({ view: 'saved' })} data-testid="tf-view-saved">
            <Icon name="bookmark" /> 저장한 추천 <span className="tf-count">{saved.length}</span>
          </button>
          <button type="button" className={view === 'history' ? 'is-on' : ''} onClick={() => setParams({ view: 'history' })} data-testid="tf-view-history">
            <Icon name="list" /> 검색 기록 <span className="tf-count">{history.length}</span>
          </button>
        </nav>

        {view === 'search' && (
          <nav className="tf-tabs" role="tablist" aria-label="찾기 종류">
            <button type="button" role="tab" aria-selected={tab === 'technique'} className={tab === 'technique' ? 'is-on' : ''} onClick={() => setTab('technique')} data-testid="tf-tab-technique">
              TECHNIQUE FINDER
              <span>상황·목적에 맞는 기술</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'combo'} className={tab === 'combo' ? 'is-on' : ''} onClick={() => setTab('combo')} data-testid="tf-tab-combo">
              SETUP &amp; COMBO FINDER
              <span>목적에 맞는 셋업·콤보</span>
            </button>
          </nav>
        )}
        {view === 'search' && <ModeSelector mode={mode} onChange={setMode} />}

        {view === 'search' && tab === 'combo' && (
          <div data-testid="tf-combo-panel">
            <form
              className="tf-search"
              onSubmit={(e) => {
                e.preventDefault();
                runCombo(comboText);
              }}
            >
              <label className="tf-sr" htmlFor="tf-combo-input">
                셋업·콤보의 목적
              </label>
              <textarea
                id="tf-combo-input"
                className="tf-input"
                rows={2}
                maxLength={200}
                placeholder="예) 더블렉을 위한 셋업 · 잽 이후 연결할 수 있는 콤보"
                value={comboText}
                onChange={(e) => setComboText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    runCombo(comboText);
                  }
                }}
                data-testid="tf-combo-input"
              />
              <button type="submit" className="tf-go" data-testid="tf-combo-submit" disabled={mode === 'web' && webBusy.combo}>
                <Icon name="search" /> {mode === 'web' ? '웹 검색' : '찾기'}
              </button>
            </form>
            <div className="tf-examples" aria-label="예시 목적">
              {COMBO_EXAMPLES.map((x) => (
                <button
                  type="button"
                  key={x}
                  className="tf-example"
                  onClick={() => {
                    setComboText(x);
                    runCombo(x);
                  }}
                  data-testid="tf-combo-example"
                >
                  {x}
                </button>
              ))}
            </div>
            {error && (
              <div className="tf-notice tf-notice--warn" role="alert" data-testid="tf-error">
                {error}
              </div>
            )}
            {mode === 'app' && comboResult && <LibraryResults result={comboResult} />}
            {mode === 'web' && webBusy.combo && <WebLoading />}
            {mode === 'web' && !webBusy.combo && web.combo && <WebResults result={web.combo} />}
            {mode === 'web' && !webBusy.combo && !web.combo && <p className="tf-muted tf-small">웹 검색은 “웹 검색”을 누를 때만 실행됩니다 (Gemini 사용량 1회).</p>}
          </div>
        )}

        {view === 'search' && tab === 'technique' && (
          <>
            <form className="tf-search" onSubmit={submit}>
              <label className="tf-sr" htmlFor="tf-input">
                목적이나 상황
              </label>
              <textarea
                id="tf-input"
                className="tf-input"
                rows={3}
                maxLength={300}
                placeholder="예) 상대가 압박할 때 거리를 유지하면서 카운터하고 싶어."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                data-testid="tf-input"
              />
              <button type="submit" className="tf-go" data-testid="tf-submit" disabled={mode === 'web' && webBusy.technique}>
                <Icon name="search" /> {mode === 'web' ? '웹 검색' : '찾기'}
              </button>
            </form>
            <div className="tf-examples" aria-label="예시 문장">
              {EXAMPLES.map((x) => (
                <button
                  type="button"
                  key={x}
                  className="tf-example"
                  onClick={() => {
                    setText(x);
                    if (mode === 'web') runWeb('technique', x);
                    else run(x, filters);
                  }}
                  data-testid="tf-example"
                >
                  {x}
                </button>
              ))}
            </div>
            {mode === 'app' && (
            <>
            <div className="tf-cats" role="group" aria-label="목적별 빠른 선택">
              {CATEGORIES.map((c) => (
                <button type="button" key={c} className={`tf-cat${filters.category === c ? ' is-on' : ''}`} aria-pressed={filters.category === c} onClick={() => setFilter('category', filters.category === c ? null : c)} data-testid={`tf-cat-${c}`}>
                  {CATEGORY_WANTS[c].label}
                </button>
              ))}
            </div>

            <div className="tf-filters" data-testid="tf-filters">
              <label>
                종목
                <select value={filters.art ?? ''} onChange={(e) => setFilter('art', e.target.value || null)} data-testid="tf-filter-art">
                  <option value="">전체</option>
                  {ART_OPTIONS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nameKo}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                난이도
                <select value={filters.difficulty ?? ''} onChange={(e) => setFilter('difficulty', (e.target.value || null) as DifficultyPref | null)} data-testid="tf-filter-difficulty">
                  <option value="">전체</option>
                  {(Object.keys(DIFFICULTY_LABEL) as DifficultyPref[]).map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_LABEL[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                기술 유형
                <select value={filters.kind ?? ''} onChange={(e) => setFilter('kind', (e.target.value || null) as RecKind | null)} data-testid="tf-filter-kind">
                  {KINDS.map((k) => (
                    <option key={k.label} value={k.id ?? ''}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="tf-seg" role="group" aria-label="추천 개수">
                {([3, 5, 10] as const).map((n) => (
                  <button type="button" key={n} className={filters.count === n ? 'is-on' : ''} onClick={() => setFilter('count', n)} data-testid={`tf-count-${n}`}>
                    {n}개
                  </button>
                ))}
              </div>
              <label className="tf-toggle">
                <input type="checkbox" checked={filters.personal} onChange={(e) => setFilter('personal', e.target.checked)} data-testid="tf-personal" /> 개인화 추천
              </label>
              <label className="tf-toggle" title="설정한 AI 엔진(기본: 로컬 엔진)으로 입력을 한 번 더 분석하고 AI 조합 1개를 추가합니다. 꺼져 있으면 AI를 호출하지 않습니다.">
                <input
                  type="checkbox"
                  checked={ai}
                  onChange={(e) => {
                    setAi(e.target.checked);
                    tacticalStore.setPrefs({ ai: e.target.checked });
                  }}
                  data-testid="tf-ai"
                />{' '}
                AI 정밀 분석
              </label>
            </div>
            </>
            )}

            {error && (
              <div className="tf-notice tf-notice--warn" role="alert" data-testid="tf-error">
                {error}
              </div>
            )}

            {mode === 'web' && webBusy.technique && <WebLoading />}
            {mode === 'web' && !webBusy.technique && web.technique && <WebResults result={web.technique} />}
            {mode === 'web' && !webBusy.technique && !web.technique && <p className="tf-muted tf-small">웹 검색은 “웹 검색”을 누를 때만 실행됩니다 (Gemini 사용량 1회). 종목·난이도 필터는 APP DATABASE 모드에서 씁니다.</p>}

            {mode === 'app' && result && a && (
              <div className="tf-results" data-testid="tf-results">
                <ModeBadge mode="app" detail={`기술 DB ${techniqueIndex().length.toLocaleString()}개·라이브러리·내 기록 · ${result.cached ? '캐시' : `${result.elapsedMs}ms`}`} />
                <section className="tf-analysis" data-testid="tf-analysis">
                  <div className="tf-analysis__head">
                    <h2>입력 분석</h2>
                    <span className="tf-muted" data-testid="tf-analysis-source">
                      {a.ai.used ? (a.ai.ok ? '규칙 분석 + AI 분석' : '규칙 분석 (AI 분석 실패)') : '규칙 분석 (AI 미사용)'}
                      {aiBusy && ' · AI 분석 중…'}
                    </span>
                  </div>
                  {a.summary.length ? (
                    <dl className="tf-analysis__list">
                      {a.summary.map((s) => (
                        <div key={s.label}>
                          <dt>{s.label}</dt>
                          <dd>{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="tf-muted">찾은 조건이 없습니다.</p>
                  )}
                  <p className="tf-muted tf-small">입력에 없는 조건(거리, 종목 등)은 정하지 않고 선택 조건으로 둡니다.</p>
                </section>

                {result.notices.map((n, i) => (
                  <div key={i} className={`tf-notice tf-notice--${n.tone}`} data-testid="tf-notice">
                    {n.text}
                  </div>
                ))}

                <Section title="TECHNIQUE" hint="단일 기술" list={result.techniques} query={result.query} testId="tf-sec-technique" />
                <Section title="SETUP" hint="상대 반응을 이끄는 준비 구성" list={result.setups} query={result.query} testId="tf-sec-setup" />
                <Section title="COMBINATION" hint="여러 기술의 연결" list={result.combos} query={result.query} testId="tf-sec-combo" />
                <Section title="ALTERNATIVE" hint="다른 접근의 대체 선택지" list={result.alternatives} query={result.query} testId="tf-sec-alternative" />

                <div className="tf-foot">
                  <span className="tf-muted" data-testid="tf-timing">
                    {result.cached ? '같은 검색 결과를 다시 사용' : `기술 DB 검색 ${result.elapsedMs}ms`}
                    {result.personalApplied.length > 0 && filters.personal ? ` · 개인화: ${result.personalApplied.join(', ')}` : filters.personal ? ' · 개인화 데이터 없음' : ' · 개인화 꺼짐'}
                  </span>
                  <div className="tf-foot__actions">
                    {result.page > 0 && (
                      <button type="button" className="tf-btn" onClick={() => run(text, filters, result.page - 1)} data-testid="tf-prev">
                        이전 추천
                      </button>
                    )}
                    {result.hasMore && (
                      <button type="button" className="tf-btn tf-btn--primary" onClick={() => run(text, filters, result.page + 1)} data-testid="tf-more">
                        다른 추천 보기
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {view === 'saved' && (
          <section className="tf-results" data-testid="tf-saved">
            {saved.length === 0 ? (
              <p className="tf-muted">저장한 추천이 없습니다. 추천 카드의 “저장”을 누르면 여기에 모입니다.</p>
            ) : (
              <div className="tf-grid">
                {saved.map((s) => (
                  <div key={s.key}>
                    <div className="tf-muted tf-small">“{s.query}” · {new Date(s.savedAt).toLocaleDateString()}</div>
                    <RecommendationCard rec={s.rec} query={s.query} />
                  </div>
                ))}
              </div>
            )}
            <p className="tf-muted tf-small">
              콤보·셋업은 카드의 “내 콤보 북에 저장 / 내 전술 셋업에 저장”으로 <Link to="/combos">콤보 북</Link>·<Link to="/tactics">전술 셋업</Link>에도 넣을 수 있습니다.
            </p>
          </section>
        )}

        {view === 'history' && (
          <section className="tf-results" data-testid="tf-history">
            {history.length === 0 ? (
              <p className="tf-muted">검색 기록이 없습니다.</p>
            ) : (
              <>
                <ul className="tf-history">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="tf-history__q"
                        onClick={() => {
                          setText(h.query);
                          setFilters(h.filters);
                          setParams({});
                          setTab('technique');
                          setMode('app');
                          run(h.query, h.filters);
                        }}
                        data-testid="tf-history-item"
                      >
                        {h.query}
                      </button>
                      <span className="tf-muted tf-small">
                        {new Date(h.at).toLocaleString()} · 결과 {h.resultCount}개
                      </span>
                      <button type="button" className="tf-btn tf-btn--icon" onClick={() => tacticalStore.removeHistory(h.id)} aria-label="기록 삭제">
                        <Icon name="close" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="tf-btn" onClick={() => tacticalStore.clearHistory()} data-testid="tf-history-clear">
                  기록 모두 지우기
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
