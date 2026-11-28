import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createCombo } from '../../lib/combo/service';
import { createTactic } from '../../lib/tactic/service';
import { TIER_LABEL, type LibraryHit } from '../../lib/tacticalFinder/libraryFinder';
import { indexedById } from '../../lib/tacticalFinder/techniqueIndex';
import type { WebItem } from '../../lib/tacticalFinder/webSearch';
import { StepChip, detailHref } from './RecommendationCard';

const SOURCE_LABEL: Record<LibraryHit['source'], string> = { 'my-combo': '내 콤보 북', 'my-tactic': '내 전술 셋업', 'curated-library': 'MARTIALDEX 라이브러리' };

/** A saved combo / tactic (or a sourced library entry) found by the SETUP & COMBO FINDER — read only. */
export function LibraryHitCard({ hit }: { hit: LibraryHit }) {
  const links =
    hit.source === 'my-combo' && hit.id
      ? [
          { to: `/combos/${hit.id}/edit`, label: '콤보 보기·편집' },
          { to: `/combos/${hit.id}/train`, label: '콤보 훈련' },
        ]
      : hit.source === 'my-tactic' && hit.id
        ? [{ to: `/tactics/${hit.id}/edit`, label: '셋업 보기·편집' }]
        : [];
  return (
    <article className={`tf-card tf-card--${hit.kind}`} data-testid="tf-hit" data-source={hit.source} data-tier={hit.tier} data-key={hit.key}>
      <header className="tf-card__head">
        <div>
          <div className="tf-card__eyebrow">
            <span className="tf-kind">{hit.kind === 'setup' ? 'SETUP' : 'COMBINATION'}</span>
            {hit.artLabel && <span className="tf-art">{hit.artLabel}</span>}
            {hit.difficulty && <span className="tf-tag">난이도 {hit.difficulty === 'basic' ? '초급' : hit.difficulty === 'intermediate' ? '중급' : hit.difficulty === 'advanced' ? '고급' : hit.difficulty}</span>}
          </div>
          <h3 className="tf-card__title">{hit.title}</h3>
          <div className="tf-card__origin">{SOURCE_LABEL[hit.source]}</div>
        </div>
        <div className="tf-tier" data-testid="tf-tier" title="입력한 목적과의 관련도 — 저장된 내용에서 찾은 근거로 계산합니다. 성공률이 아닙니다.">
          <span className="tf-score__num">{hit.relevance}</span>
          <span className="tf-score__label">{TIER_LABEL[hit.tier]}</span>
        </div>
      </header>
      {hit.purpose && (
        <p className="tf-purpose">
          <strong>저장된 목적</strong> {hit.purpose}
        </p>
      )}
      {hit.description && hit.description !== hit.purpose && <p className="tf-muted tf-small">{hit.description.slice(0, 220)}</p>}
      <ol className="tf-steps" aria-label="구성 기술 순서">
        {hit.steps.map((s, i) => (
          <li key={`${s.name}-${i}`}>
            <StepChip s={s} index={i} />
            {(s.react || s.note) && (
              <div className="tf-step__meta">
                {s.note && <span>{s.note}</span>}
                {s.react && <span>예상 반응: {s.react}</span>}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="tf-block">
        <div className="tf-block__head">일치 이유</div>
        <ul className="tf-reasons" data-testid="tf-reasons">
          {hit.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      {hit.source === 'curated-library' && hit.sources.some((s) => s.url) && (
        <div className="tf-sources">
          출처:{' '}
          {hit.sources
            .filter((s) => s.url)
            .map((s, i) => (
              <a key={i} href={s.url!} target="_blank" rel="noreferrer noopener">
                {s.label}
              </a>
            ))}
        </div>
      )}
      {links.length > 0 && (
        <div className="tf-actions">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="tf-btn" data-testid="tf-hit-link">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

// 'verified' = linked to a page Gemini's search really retrieved — NOT that the page states this purpose
const VERIFY_LABEL: Record<WebItem['verification'], string> = { verified: '검색 출처 연결됨', partial: '일부 출처만 연결됨', unverified: '출처 미확인' };
const WEB_KIND: Record<WebItem['kind'], string> = { technique: 'TECHNIQUE', setup: 'SETUP', combo: 'COMBINATION' };

/** One web result. Saved to the combo book / tactics only when the user presses the button — never automatically. */
export function WebItemCard({ item, query }: { item: WebItem; query: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const ids = item.steps.map((s) => s.techniqueId);
  const savable = item.kind !== 'technique' && ids.length >= 2 && ids.every(Boolean);
  const single = item.kind === 'technique' ? item.steps[0]?.techniqueId ?? null : null;
  function save(target: 'combo' | 'tactic') {
    const techniqueIds = ids as string[];
    const src = item.sources.filter((s) => s.grounded).map((s) => s.url);
    const note = [item.purpose, `웹 검색 결과 (${item.origin === 'web-confirmed' ? '출처 확인' : 'AI 조합'})`, ...src].filter(Boolean).join('\n');
    if (target === 'tactic') createTactic({ name: item.name.slice(0, 60), situation: item.purpose ? `${item.purpose} (${query})` : query, techniqueIds });
    else createCombo({ name: item.name.slice(0, 60), description: note, techniqueIds });
    setMsg(target === 'tactic' ? '내 전술 셋업에 저장했습니다.' : '내 콤보 북에 저장했습니다.');
  }
  const art = single ? indexedById(single)?.t.martialArt ?? null : null;
  return (
    <article className={`tf-card tf-card--${item.kind}`} data-testid="tf-web-item" data-origin={item.origin} data-verification={item.verification} data-kind={item.kind}>
      <header className="tf-card__head">
        <div>
          <div className="tf-card__eyebrow">
            <span className="tf-kind">{WEB_KIND[item.kind]}</span>
            <span className={`tf-badge ${item.origin === 'web-confirmed' ? 'tf-badge--web' : 'tf-badge--ai'}`}>{item.origin === 'web-confirmed' ? 'WEB SOURCE' : 'AI GENERATED'}</span>
            <span className={`tf-badge tf-badge--${item.verification === 'unverified' ? 'warn' : 'web'}`} data-testid="tf-verify">
              {VERIFY_LABEL[item.verification]}
            </span>
          </div>
          <h3 className="tf-card__title">{single && art ? <Link to={detailHref({ techniqueId: single, martialArt: art })!}>{item.name}</Link> : item.name}</h3>
          <div className="tf-card__origin">웹 검색 (Gemini · Google 검색)</div>
        </div>
      </header>
      {item.purpose && (
        <p className="tf-purpose">
          <strong>목적</strong> {item.purpose}
        </p>
      )}
      {item.steps.length > 1 && (
        <ol className="tf-steps" aria-label="구성 기술 순서">
          {item.steps.map((s, i) => {
            const t = s.techniqueId ? indexedById(s.techniqueId)?.t : undefined;
            return (
              <li key={`${s.name}-${i}`}>
                <StepChip s={{ name: s.name, techniqueId: s.techniqueId, martialArt: t?.martialArt ?? null, inDb: !!t, role: null, note: null, react: null }} index={i} />
                {s.role && (
                  <div className="tf-step__meta">
                    <span>역할: {s.role}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {item.reason && (
        <div className="tf-block">
          <div className="tf-block__head">이유</div>
          <p className="tf-small">{item.reason}</p>
        </div>
      )}
      <div className="tf-sources" data-testid="tf-web-sources">
        {item.sources.length ? (
          <>
            출처:{' '}
            {item.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer noopener" className={s.grounded ? '' : 'tf-muted'}>
                {s.title}
              </a>
            ))}
          </>
        ) : (
          <span className="tf-muted">확인된 출처 없음</span>
        )}
      </div>
      <p className="tf-muted tf-small" data-testid="tf-verify-note">
        {item.verificationNote}
      </p>
      {item.kind !== 'technique' && (
        <div className="tf-actions">
          {savable ? (
            <>
              <button type="button" className="tf-btn" onClick={() => save('combo')} data-testid="tf-web-save-combo">
                내 콤보 북에 저장
              </button>
              <button type="button" className="tf-btn" onClick={() => save('tactic')} data-testid="tf-web-save-tactic">
                내 전술 셋업에 저장
              </button>
            </>
          ) : (
            <span className="tf-muted tf-small">기술 DB에 없는 단계가 있어 콤보 북에 저장할 수 없습니다.</span>
          )}
          {msg && (
            <span className="tf-flash" role="status">
              {msg}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
