import Icon from '../Icon';
import { useState } from 'react';
import { analyzeFighterStyleWithEvidence, artFromSport, STYLE_KIND_LABEL, STYLE_SUPPORT_LABEL, type EvidenceStyleReport, type StyleSupport } from '../../lib/fighterStyle/evidenceStyle';
import { appCoachDeps } from '../../lib/selfAi/deps';
import { upsertCandidates } from '../../lib/martialdexKnowledge/candidateStore';
import { CANDIDATE_STATUS_LABEL } from '../../lib/martialdexKnowledge/types';

const ORDER: StyleSupport[] = ['multi_source', 'source_analysis', 'ai_inference', 'unconfirmed'];

// 근거 기반 선수 스타일 분석 (자체 AI) — every line shows how it is supported.
export default function EvidenceStylePanel({ fighterName, sport }: { fighterName: string; sport: string }) {
  const [report, setReport] = useState<EvidenceStyleReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setReport(null);
    try {
      const d = appCoachDeps();
      const r = await analyzeFighterStyleWithEvidence(fighterName, artFromSport(sport), { research: d.research, chat: (req) => d.chat(req), knowledgeIndex: d.knowledgeIndex }, setStatus);
      if (r.candidates.length) upsertCandidates(r.candidates);
      setReport(r);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="card info-card" data-testid="evidence-style">
      <h3><Icon name="search" /> 근거 기반 스타일 분석 (MARTIALDEX 자체 AI)</h3>
      <p className="video-status-message">경기 분석·인터뷰 등 실제로 가져온 자료에서 인용문이 확인된 내용만 보여 주고, 확인 정도를 함께 표시합니다.</p>
      {!report && (
        <button className="btn btn-secondary" onClick={() => void run()} disabled={busy} data-testid="evidence-style-run">
          {busy ? status ?? '분석 중…' : '근거 기반으로 분석하기'}
        </button>
      )}
      {report && (
        <>
          {!report.searched && <div className="modal-note">검색을 하지 못해 분석하지 않았습니다.</div>}
          {ORDER.map((sup) => {
            const items = report.items.filter((i) => i.support === sup);
            if (!items.length) return null;
            return (
              <div key={sup} style={{ marginTop: 8 }}>
                <div className="field-label">{STYLE_SUPPORT_LABEL[sup]}</div>
                <ul style={{ fontSize: 13.5 }}>
                  {items.map((i, n) => (
                    <li key={n}>
                      <span className="chip">{STYLE_KIND_LABEL[i.kind]}</span> {i.steps?.length ? <strong>{i.steps.join(' → ')}</strong> : null} {i.text}
                      {i.frequencyStated && <span className="chip">출처가 빈도를 언급</span>}
                      {i.quotes
                        .filter((q) => q.verified)
                        .slice(0, 2)
                        .map((q, k) => (
                          <div key={k} className="video-status-message" style={{ margin: '2px 0 0' }}>
                            “{q.quote}” —{' '}
                            <a href={q.url} target="_blank" rel="noreferrer">
                              {q.site}
                            </a>
                          </div>
                        ))}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {report.videos.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">관련 영상 (제목·설명만 확인 — 영상 내용은 확인하지 않음)</div>
              <ul style={{ fontSize: 13.5 }}>
                {report.videos.map((v) => (
                  <li key={v.url}>
                    <a href={v.url} target="_blank" rel="noreferrer">
                      {v.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.candidates.length > 0 && (
            <p className="video-status-message">
              MARTIALDEX DB와 비교: {Object.entries(report.candidates.reduce<Record<string, number>>((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {}))
                .map(([s, n]) => `${CANDIDATE_STATUS_LABEL[s as keyof typeof CANDIDATE_STATUS_LABEL]} ${n}`)
                .join(' · ')}
            </p>
          )}
          <div className="modal-note">
            {report.limits.map((l, i) => (
              <div key={i}>※ {l}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
