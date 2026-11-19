import Icon from './Icon';
import type { ResearchDiagnostics } from '../lib/aiCurriculum/evidenceLedger';
import { STOP_REASON_TEXT } from '../lib/aiCurriculum/evidenceLedger';
import type { ReviewItem } from '../lib/aiCurriculum/webEvidenceResearch';

// 커리큘럼 웹 근거 진단 — the numbers of every stage (검색 → 중복 제거 → 분석 → 관련성) and each learning
// part's coverage, so "근거 부족" is never shown without saying which stage and which part fell short.

const KIND_LABEL = { video: '영상', social: 'SNS', forum: '포럼', article: '글' } as const;

export default function ResearchDiagnosticsView({ diagnostics: d, review, showStopReason = true }: { diagnostics: ResearchDiagnostics; review?: ReviewItem[]; showStopReason?: boolean }) {
  const kinds = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).filter((k) => d.sourceKinds[k] > 0).map((k) => `${KIND_LABEL[k]} ${d.sourceKinds[k]}`);
  return (
    <div className="research-diagnostics" data-testid="research-diagnostics">
      {showStopReason && d.stopReason && (
        <p className="video-status-message" data-testid="research-stop-reason">
          <strong>중단 이유:</strong> {STOP_REASON_TEXT[d.stopReason]}
        </p>
      )}
      <strong>검색 진단</strong>
      <ul className="research-diagnostics__stages">
        <li>웹 검색: {d.searchSucceeded ? `성공 (${d.tavilyCalls}회 요청)` : d.searchAttempted ? '실패' : '실행 안 함'}</li>
        <li>
          검색된 자료 {d.rawResultCount}건 → 중복 제거 후 {d.uniqueSourceCount}건{kinds.length > 0 ? ` (${kinds.join(' · ')})` : ''} · 본문 있는 자료 {d.sourcesWithContent}건
        </li>
        <li>
          분석한 자료 {d.analyzedSourceCount}건
          {d.extraction.failedSourceCount > 0 && <span className="research-diagnostics__bad"> · 분석 실패 {d.extraction.failedSourceCount}건 ({d.extraction.lastErrorCode})</span>}
        </li>
        <li>
          기술 후보 {d.candidateRecords}건 → 관련성 확인 {d.relevantRecords}건 · 검토 필요 {d.reviewRecords}건 · 관련 없음 {d.irrelevantRecords}건
          {d.lowConfidenceRecords > 0 ? ` · 확신 낮음 ${d.lowConfidenceRecords}건` : ''}
        </li>
      </ul>
      {d.parts.length > 0 && (
        <div className="research-diagnostics__parts">
          <strong>목표별 근거</strong>
          <ul>
            {d.parts.map((p) => (
              <li key={p.id} data-testid="research-part" data-covered={p.covered}>
                {p.covered ? <Icon name="check" label="충족" /> : <Icon name="close" label="부족" />} {p.label} <span className="technique-row__sub">({p.role === 'core' ? '핵심' : '이어지는 단계'})</span> — 검증된 기술 {p.techniques.length}개 (기준 {p.required.techniques}개) · 서로 다른 출처 {p.independentSourceCount}개 (기준{' '}
                {p.required.sources}개)
                {p.techniques.length > 0 && <span className="technique-row__sub"> · {p.techniques.map((t) => t.name).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review && review.length > 0 && (
        <details className="research-diagnostics__review">
          <summary>검토 대상 {review.length}건 (관련성을 확인하지 못해 커리큘럼에 넣지 않음)</summary>
          <ul>
            {review.map((r, i) => (
              <li key={`${r.name}-${r.partId}-${i}`}>
                {r.name} <span className="technique-row__sub">[{r.partLabel}] {r.reasons.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
