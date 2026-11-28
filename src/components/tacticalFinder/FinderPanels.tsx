import type { LibraryHit, LibrarySearchResult } from '../../lib/tacticalFinder/libraryFinder';
import type { WebItem, WebSearchResult } from '../../lib/tacticalFinder/webSearch';
import { LibraryHitCard, WebItemCard } from './FinderResultCards';

export type SearchMode = 'app' | 'web';

/** "APP DATABASE / WEB SEARCH" — chosen before searching, shown again on every result. */
export function ModeSelector({ mode, onChange }: { mode: SearchMode; onChange: (m: SearchMode) => void }) {
  return (
    <div className="tf-mode" role="radiogroup" aria-label="검색 모드" data-testid="tf-mode">
      <button type="button" role="radio" aria-checked={mode === 'app'} className={mode === 'app' ? 'is-on' : ''} onClick={() => onChange('app')} data-testid="tf-mode-app">
        <strong>APP DATABASE</strong>
        <span>기술 DB·라이브러리·내 콤보 북·전술 셋업 · AI 호출 없음</span>
      </button>
      <button type="button" role="radio" aria-checked={mode === 'web'} className={mode === 'web' ? 'is-on' : ''} onClick={() => onChange('web')} data-testid="tf-mode-web">
        <strong>WEB SEARCH</strong>
        <span>Gemini + Google 검색 · 실제 출처 링크 · Gemini 사용량 1회</span>
      </button>
    </div>
  );
}

export function ModeBadge({ mode, detail }: { mode: SearchMode; detail?: string }) {
  return (
    <div className={`tf-modebadge tf-modebadge--${mode}`} data-testid="tf-result-mode" data-mode={mode}>
      {mode === 'app' ? 'APP DATABASE 결과' : 'WEB SEARCH 결과'}
      {detail && <span className="tf-muted"> · {detail}</span>}
    </div>
  );
}

function HitSection({ title, hint, list, testId }: { title: string; hint: string; list: LibraryHit[]; testId: string }) {
  if (!list.length) return null;
  return (
    <section className="tf-section" data-testid={testId} data-count={list.length}>
      <div className="tf-section__head">
        <h2>{title}</h2>
        <span className="tf-muted">
          {hint} · {list.length}개
        </span>
      </div>
      <div className="tf-grid">
        {list.map((h) => (
          <LibraryHitCard key={h.key} hit={h} />
        ))}
      </div>
    </section>
  );
}

export function LibraryResults({ result }: { result: LibrarySearchResult }) {
  const s = result.searched;
  return (
    <div className="tf-results" data-testid="tf-lib-results">
      <ModeBadge mode="app" detail={`내 콤보 ${s.combos}개 · 전술 셋업 ${s.tactics}개 · 라이브러리 ${s.library}개 전체 검색 · ${result.elapsedMs}ms`} />
      {result.notices.map((n, i) => (
        <div key={i} className={`tf-notice tf-notice--${n.tone}`} data-testid="tf-notice">
          {n.text}
        </div>
      ))}
      <HitSection title="MY SETUPS" hint="내 콤보 북·전술 셋업의 셋업" list={result.mySetups} testId="tf-sec-my-setups" />
      <HitSection title="MY COMBOS" hint="내 콤보 북의 콤보" list={result.myCombos} testId="tf-sec-my-combos" />
      <HitSection title="MARTIALDEX LIBRARY" hint="출처가 있는 라이브러리 셋업·콤보" list={result.library} testId="tf-sec-library" />
      <HitSection title="관련 항목" hint="목적과 간접적으로 이어지는 항목" list={result.related} testId="tf-sec-related" />
    </div>
  );
}

function WebSection({ title, hint, list, query, testId }: { title: string; hint: string; list: WebItem[]; query: string; testId: string }) {
  if (!list.length) return null;
  return (
    <section className="tf-section" data-testid={testId} data-count={list.length}>
      <div className="tf-section__head">
        <h2>{title}</h2>
        <span className="tf-muted">{hint}</span>
      </div>
      <div className="tf-grid">
        {list.map((it) => (
          <WebItemCard key={it.key} item={it} query={query} />
        ))}
      </div>
    </section>
  );
}

export function WebLoading() {
  return (
    <div className="tf-results">
      <ModeBadge mode="web" />
      <div className="tf-loading" role="status" data-testid="tf-web-loading">
        <span className="tf-spinner" aria-hidden="true" /> 웹에서 검색하는 중… (Gemini · Google 검색, 보통 10–30초)
      </div>
    </div>
  );
}

export function WebResults({ result }: { result: WebSearchResult }) {
  const confirmed = result.items.filter((i) => i.origin === 'web-confirmed');
  const composed = result.items.filter((i) => i.origin === 'ai-composed');
  const detail = result.cached ? '같은 검색 결과를 다시 사용 (Gemini 호출 없음)' : `${(result.elapsedMs / 1000).toFixed(1)}초`;
  return (
    <div className="tf-results" data-testid="tf-web-results" data-status={result.status}>
      <ModeBadge mode="web" detail={detail} />
      {result.status === 'error' && (
        <div className="tf-notice tf-notice--warn" role="alert" data-testid="tf-web-error" data-code={result.error?.code}>
          웹 검색 실패: {result.error?.message} 앱 데이터베이스 결과로 바꿔 보여 주지 않습니다 — 모드를 APP DATABASE로 바꿔 직접 검색할 수 있습니다.
        </div>
      )}
      {result.status === 'no-grounding' && (
        <div className="tf-notice tf-notice--warn" role="alert" data-testid="tf-web-error" data-code="NO_GROUNDING">
          {result.error?.message}
        </div>
      )}
      {result.status === 'empty' && (
        <div className="tf-notice tf-notice--info" data-testid="tf-web-empty">
          웹 검색은 실행됐지만 이 목적에 맞는 셋업·콤보를 찾지 못했습니다.
        </div>
      )}
      {(result.status === 'ok' || result.status === 'empty') && (
        <details className="tf-websearch" data-testid="tf-web-meta">
          <summary>
            검색 출처 {result.groundingSources.length}개{result.searchQueries.length ? ` · 실행된 검색어 ${result.searchQueries.length}개` : ''}
          </summary>
          {result.searchQueries.length > 0 && <p className="tf-small">검색어: {result.searchQueries.join(' · ')}</p>}
          <ul>
            {result.groundingSources.map((g, i) => (
              <li key={i}>
                <a href={g.uri} target="_blank" rel="noreferrer noopener">
                  {g.title || g.uri}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.tab === 'technique' && <WebSection title="WEB · TECHNIQUE" hint="검색 출처가 연결된 기술 · 내용은 링크에서 확인" list={confirmed.filter((i) => i.kind === 'technique')} query={result.query} testId="tf-web-sec-technique" />}
      <WebSection title="WEB · SETUP" hint="검색 출처가 연결된 셋업 · 내용은 링크에서 확인" list={confirmed.filter((i) => i.kind === 'setup')} query={result.query} testId="tf-web-sec-setup" />
      <WebSection title="WEB · COMBINATION" hint="검색 출처가 연결된 콤보 · 내용은 링크에서 확인" list={confirmed.filter((i) => i.kind === 'combo')} query={result.query} testId="tf-web-sec-combo" />
      <WebSection title="AI GENERATED" hint="AI가 검색 자료를 조합한 구성 · 출처가 확인되지 않은 항목 포함" list={composed} query={result.query} testId="tf-web-sec-ai" />
    </div>
  );
}
