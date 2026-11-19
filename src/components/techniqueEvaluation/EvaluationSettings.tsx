import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { searchAllTechniques } from '../../lib/userTechniques/service';
import { CRITERIA, CRITERION_KEYS, EVAL_ARTS, MAX_CRITERIA, templateFor, type CriterionKey } from '../../lib/techniqueEvaluation/criteria';
import type { EvaluationSettingsInput } from '../../lib/techniqueEvaluation/service';

export interface EvaluationDraft extends EvaluationSettingsInput {
  enabled: boolean;
}

export function emptyEvaluationDraft(): EvaluationDraft {
  return { enabled: false, martialArt: 'boxing', techniqueId: null, techniqueName: '', criteria: templateFor('boxing'), resultsVisibility: 'public', durationDays: 7 };
}

const DURATIONS: { days: number | null; label: string }[] = [
  { days: 3, label: '3일' },
  { days: 7, label: '7일' },
  { days: 14, label: '14일' },
  { days: 30, label: '30일' },
  { days: null, label: '기한 없음' },
];

/** 게시물·숏폼 작성 화면의 "기술 평가 받기" 설정. 종목에 맞는 기본 항목을 채우고 작성자가 고칠 수 있다. */
export default function EvaluationSettings({ value, onChange }: { value: EvaluationDraft; onChange: (v: EvaluationDraft) => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim() ? searchAllTechniques(q, 6) : []), [q]);
  const set = (patch: Partial<EvaluationDraft>) => onChange({ ...value, ...patch });

  function pickArt(art: string) {
    set({ martialArt: art, criteria: templateFor(art) });
  }
  function toggleCriterion(k: CriterionKey) {
    const has = value.criteria.includes(k);
    if (!has && value.criteria.length >= MAX_CRITERIA) return;
    set({ criteria: has ? value.criteria.filter((x) => x !== k) : [...value.criteria, k] });
  }

  return (
    <div className="eco-card" style={{ marginTop: 12, padding: 12 }} data-testid="eval-settings">
      <label className="eco-check" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="eval-enable" />
        <Icon name="chart" /> 기술 평가 받기 (퍼센트 투표)
      </label>
      {value.enabled && (
        <div className="eco-form" style={{ marginTop: 10 }}>
          <p className="eco-meta" style={{ margin: 0 }}>
            다른 사용자가 항목별로 0~100% 점수를 줍니다. 커뮤니티 의견이며 공식 인증이 아닙니다. 좋아요와는 별개로 집계됩니다.
          </p>
          <div className="eco-form-grid">
            <label>
              종목
              <select value={value.martialArt} onChange={(e) => pickArt(e.target.value)} data-testid="eval-art">
                {EVAL_ARTS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </label>
            <label>
              기술 이름
              <input value={value.techniqueName} onChange={(e) => set({ techniqueName: e.target.value, techniqueId: null })} placeholder="예: 잽, 암바" maxLength={120} data-testid="eval-technique-name" />
            </label>
          </div>
          <label>
            기술 DB 에서 찾아 연결 (선택)
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="기술 검색" data-testid="eval-technique-search" />
          </label>
          {results.length > 0 && (
            <div className="eco-row">
              {results.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    const art = EVAL_ARTS.some((a) => a.id === t.martialArt) ? t.martialArt : value.martialArt;
                    onChange({ ...value, techniqueId: t.id, techniqueName: t.koreanName && t.koreanName !== t.name ? `${t.name} (${t.koreanName})` : t.name, martialArt: art, criteria: art !== value.martialArt ? templateFor(art) : value.criteria });
                    setQ('');
                  }}
                  data-testid="eval-technique-result"
                >
                  {t.name}{t.koreanName && t.koreanName !== t.name ? ` (${t.koreanName})` : ''} · {t.martialArt}
                </button>
              ))}
            </div>
          )}
          {value.techniqueId && <span className="eco-pill eco-pill--good"><Icon name="link" /> 기술 DB 연결됨</span>}
          <div>
            <div className="eco-meta" style={{ marginBottom: 6, fontWeight: 600 }}>평가 항목 ({value.criteria.length}/{MAX_CRITERIA}) — 기술에 맞는 항목만 고르세요</div>
            <div className="eco-row">
              {CRITERION_KEYS.map((k) => (
                <button key={k} type="button" className={`chip${value.criteria.includes(k) ? ' active' : ''}`} onClick={() => toggleCriterion(k)} title={CRITERIA[k].hint} aria-pressed={value.criteria.includes(k)} data-testid={`eval-criterion-${k}`}>
                  {CRITERIA[k].label}
                </button>
              ))}
            </div>
          </div>
          <div className="eco-form-grid">
            <label>
              투표 기간
              <select value={value.durationDays ?? ''} onChange={(e) => set({ durationDays: e.target.value ? Number(e.target.value) : null })}>
                {DURATIONS.map((d) => (
                  <option key={d.label} value={d.days ?? ''}>{d.label}</option>
                ))}
              </select>
            </label>
            <label>
              결과 공개
              <select value={value.resultsVisibility} onChange={(e) => set({ resultsVisibility: e.target.value as EvaluationDraft['resultsVisibility'] })} data-testid="eval-visibility">
                <option value="public">모두에게 공개</option>
                <option value="author_only">나만 보기 (투표는 받되 결과 비공개)</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
