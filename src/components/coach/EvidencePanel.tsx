import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { categoryOf, evidenceSummary, SOURCE_CATEGORY_LABEL, type EvidenceStatus } from '../../lib/selfAi/evidenceSummary';
import type { CoachChatMessage } from '../../lib/selfAi/types';
import { resolveTechnique } from '../../lib/userTechniques/service';

// 근거·출처 보기 (사양 §4-6): one status line that is always visible, and the sources folded underneath — grouped by
// the spec's six categories, each with reliability, date, whether its text was read, whether the answer used it, and why.

const STATUS_ICON: Record<EvidenceStatus, 'check' | 'info' | 'warn' | 'close' | 'search'> = { sufficient: 'check', partial: 'info', conflict: 'warn', none: 'close', undecidable: 'warn', internal: 'search', not_needed: 'info' };

function openExternal(url: string) {
  return (e: React.MouseEvent) => {
    if (window.martialdex?.openExternal) {
      e.preventDefault();
      window.martialdex.openExternal(url);
    }
  };
}

export default function EvidencePanel({ m, freshness }: { m: CoachChatMessage; freshness?: string }) {
  const sum = evidenceSummary(m);
  const sources = (m.sources ?? []).filter((s) => s.sourceType !== 'video');
  const related = [...new Set(m.techniqueIds ?? [])].map((id) => resolveTechnique(id)).filter((t): t is NonNullable<typeof t> => !!t).slice(0, 6);
  if (sum.status === 'not_needed' && !related.length) return null;
  return (
    <div className="ai-msg__sources eco-evidence" data-testid="self-ai-evidence" data-status={sum.status}>
      <div className={`eco-evidence__status eco-evidence__status--${sum.status}`}>
        <Icon name={STATUS_ICON[sum.status]} /> <strong>{sum.label}</strong> — {sum.text}
      </div>
      {m.sourceConflicts?.length ? (
        <div className="eco-evidence__conflicts" data-testid="self-ai-source-conflicts">
          {m.sourceConflicts.map((c, i) => (
            <div key={i} className="eco-evidence__conflict">
              <div>
                <span className="chip">[{c.a}]</span> "{c.aQuote}"
              </div>
              <div>
                <span className="chip">[{c.b}]</span> "{c.bQuote}"
              </div>
              <div className="muted">차이: {c.why}</div>
            </div>
          ))}
        </div>
      ) : null}
      {sources.length > 0 && (
        <details data-testid="self-ai-sources">
          <summary className="ai-msg__sources-label">
            출처 보기 ({sources.length}건 · {sum.categories.map((c) => `${c.label} ${c.count}`).join(' · ')})
          </summary>
          <div className="ai-msg__sources-label">자료 유형과 신뢰도는 출처의 종류·본문 확인 여부로 붙인 표시이며, 내용이 사실인지를 보증하지 않습니다.{freshness ? ` ${freshness}` : ''}</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {sources.map((s) => (
              <li key={s.n} className="eco-evidence__source">
                <a href={s.url} target="_blank" rel="noreferrer" onClick={openExternal(s.url)}>
                  {s.title}
                </a>{' '}
                <span className="chip">{SOURCE_CATEGORY_LABEL[categoryOf(s)]}</span> <span className="chip">{s.sourceTypeLabel}</span> 신뢰도 {s.reliability.label}
                {s.source ? ` · ${s.source}` : ''}
                {s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ' · 게시일 미확인'}
                {s.paper ? (s.paper.abstract ? ' · 색인 초록 있음' : ' · 초록 없음') : s.contentRead ? ' · 본문 확인' : ' · 검색 요약만'}
                {s.used !== undefined && <span className="chip">{s.used ? '답변에 사용' : '참고만'}</span>}
                {s.paper?.doiUrl && (
                  <>
                    {' · '}
                    <a href={s.paper.doiUrl} target="_blank" rel="noreferrer" onClick={openExternal(s.paper.doiUrl)}>
                      DOI{s.paper.doiStatus === 'registered' && <> <Icon name="check" /></>}
                    </a>
                  </>
                )}
                <details className="eco-evidence__why">
                  <summary>근거 상세</summary>
                  <div className="muted">
                    {[...(s.relevanceWhy ?? []), ...s.reliability.reasons].join(' · ') || '추가 정보 없음'}
                    {(m.claims ?? []).filter((c) => c.source === s.n && c.status === 'supported').length
                      ? ` · 이 자료가 뒷받침하는 답변 문장: ${(m.claims ?? []).filter((c) => c.source === s.n && c.status === 'supported').map((c) => `"${c.sentence.slice(0, 60)}"`).join(', ')}`
                      : ''}
                  </div>
                  <a href={s.url} target="_blank" rel="noreferrer" onClick={openExternal(s.url)}>
                    원문 열기
                  </a>
                </details>
              </li>
            ))}
          </ol>
        </details>
      )}
      {related.length > 0 && (
        <div className="eco-evidence__related" data-testid="self-ai-related-techniques">
          <span className="ai-msg__sources-label">관련 기술 보기:</span>{' '}
          {related.map((t) => (
            <Link key={t.id} className="chip" to={`/arts/${t.martialArt}/techniques/${encodeURIComponent(t.id)}`}>
              {t.koreanName ?? t.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
