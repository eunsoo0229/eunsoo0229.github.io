import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import Motion3dDemo from '../motion3d/Motion3dDemo';
import { createCombo } from '../../lib/combo/service';
import { createTactic } from '../../lib/tactic/service';
import { tacticalStore, useTacticalStore } from '../../lib/tacticalFinder/store';
import type { Recommendation, StepRef } from '../../lib/tacticalFinder/types';
import { useFavorites } from '../../lib/userData';

const KIND_LABEL: Record<Recommendation['kind'], string> = { technique: 'TECHNIQUE', setup: 'SETUP', combo: 'COMBINATION', alternative: 'ALTERNATIVE' };

export function detailHref(s: { techniqueId: string | null; martialArt: string | null }): string | null {
  return s.techniqueId && s.martialArt ? `/arts/${s.martialArt}/techniques/${encodeURIComponent(s.techniqueId)}` : null;
}

export function StepChip({ s, index }: { s: StepRef; index?: number }) {
  const href = detailHref(s);
  const inner = (
    <>
      {index !== undefined && <span className="tf-step__no">{index + 1}</span>}
      <span className="tf-step__name">{s.name}</span>
      {!s.inDb && <span className="tf-badge tf-badge--warn" title="기술 DB에서 이 이름의 기록을 찾지 못했습니다">DB 미확인</span>}
    </>
  );
  return href ? (
    <Link to={href} className="tf-step" data-testid="tf-step" data-in-db="true">
      {inner}
    </Link>
  ) : (
    <span className="tf-step" data-testid="tf-step" data-in-db="false">
      {inner}
    </span>
  );
}

export default function RecommendationCard({ rec, query }: { rec: Recommendation; query: string }) {
  const [show3d, setShow3d] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const saved = useTacticalStore(() => tacticalStore.isSaved(rec.key));
  const rating = useTacticalStore(() => tacticalStore.feedbackFor(rec.key, query));
  const { isFavorite, toggleFavorite } = useFavorites();
  const multi = rec.steps.length > 1;
  const motionId = rec.techniqueId && rec.hasMotion3d ? rec.techniqueId : rec.steps.find((s) => s.techniqueId && rec.hasMotion3d)?.techniqueId ?? null;
  const allInDb = rec.steps.every((s) => s.inDb && s.techniqueId);
  const ids = rec.steps.map((s) => s.techniqueId).filter((x): x is string => !!x);

  function saveToLibrary() {
    if (!allInDb) return;
    const origin = `TACTICAL FINDER에서 저장 — 목적: "${query}" · 출처: ${rec.originLabel}`;
    if (rec.kind === 'setup') {
      createTactic({ name: rec.title.slice(0, 60), situation: rec.purpose ? `${rec.purpose} (${query})` : query, techniqueIds: ids });
      setMsg('내 전술 셋업에 저장했습니다.');
    } else {
      createCombo({ name: rec.title.slice(0, 60), description: [rec.purpose, origin].filter(Boolean).join('\n'), techniqueIds: ids });
      setMsg('내 콤보 북에 저장했습니다.');
    }
  }

  return (
    <article className={`tf-card tf-card--${rec.kind}`} data-testid="tf-card" data-kind={rec.kind} data-origin={rec.origin} data-key={rec.key}>
      <header className="tf-card__head">
        <div>
          <div className="tf-card__eyebrow">
            <span className="tf-kind">{KIND_LABEL[rec.kind]}</span>
            {rec.artLabel && <span className="tf-art">{rec.artLabel}</span>}
            {rec.origin === 'ai-generated' && <span className="tf-badge tf-badge--ai" data-testid="tf-ai-badge">AI GENERATED COMBINATION</span>}
          </div>
          <h3 className="tf-card__title">
            {rec.techniqueId && detailHref({ techniqueId: rec.techniqueId, martialArt: rec.martialArt }) ? (
              <Link to={detailHref({ techniqueId: rec.techniqueId, martialArt: rec.martialArt })!} data-testid="tf-detail-link">
                {rec.title}
              </Link>
            ) : (
              rec.title
            )}
          </h3>
          <div className="tf-card__origin">{rec.originLabel}</div>
        </div>
        {rec.scoreParts.length > 0 && (
          <details className="tf-score" data-testid="tf-score">
            <summary title="근거 점수 — 성공 확률이 아닙니다">
              <span className="tf-score__num">{rec.score}</span>
              <span className="tf-score__label">적합도</span>
            </summary>
            <ul>
              {rec.scoreParts.map((p) => (
                <li key={p.key}>
                  <span>{p.label}</span>
                  <span>
                    {p.points}/{p.max}
                  </span>
                </li>
              ))}
            </ul>
            <p className="tf-muted">입력에 근거가 없는 항목은 계산에서 뺍니다. 성공률·확률이 아닙니다.</p>
          </details>
        )}
      </header>

      {multi ? (
        <ol className="tf-steps" aria-label="구성 기술 순서">
          {rec.steps.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <StepChip s={s} index={i} />
              {(s.role || s.react || s.note) && (
                <div className="tf-step__meta">
                  {s.role && <span>역할: {s.role}</span>}
                  {s.react && <span>예상 반응: {s.react}</span>}
                  {s.note && <span>{s.note}</span>}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {multi && rec.steps.some((s) => s.role) && rec.origin !== 'ai-generated' && <p className="tf-muted tf-small">역할은 각 기술의 DB 특성과 순서로 정리한 것입니다.</p>}

      {rec.purpose && (
        <p className="tf-purpose">
          <strong>{rec.kind === 'technique' || rec.kind === 'alternative' ? 'DB 설명' : '목적'}</strong> {rec.purpose}
        </p>
      )}
      <div className="tf-block">
        <div className="tf-block__head">추천 이유</div>
        <ul className="tf-reasons" data-testid="tf-reasons">
          {rec.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {rec.situations.length > 0 && (
        <div className="tf-meta-row">
          <span className="tf-meta-label">적용 상황</span>
          {rec.situations.map((x) => (
            <span key={x} className="tf-tag">
              {x}
            </span>
          ))}
          <span className="tf-meta-label">난이도</span>
          <span className="tf-tag">{rec.difficulty ?? '정보 없음'}</span>
          {rec.mastery && (
            <>
              <span className="tf-meta-label">내 숙련도</span>
              <span className="tf-tag">{rec.mastery}</span>
            </>
          )}
        </div>
      )}

      {rec.expectedReaction && (
        <div className="tf-block">
          <div className="tf-block__head">상대의 예상 반응</div>
          <p>{rec.expectedReaction}</p>
        </div>
      )}
      {(rec.kind === 'combo' || rec.kind === 'setup') && (
        <div className="tf-block">
          <div className="tf-block__head">성공 가능성을 높이는 조건</div>
          {rec.successConditions.length ? (
            <ul className="tf-reasons">
              {rec.successConditions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="tf-muted">DB·라이브러리에 근거 정보가 없습니다 (정보 부족).</p>
          )}
        </div>
      )}
      {rec.followUps.length > 0 && (
        <div className="tf-block">
          <div className="tf-block__head">이어지는 후속 기술 (DB 연결 기록)</div>
          <div className="tf-chips">
            {rec.followUps.map((s) => (
              <StepChip key={s.techniqueId ?? s.name} s={s} />
            ))}
          </div>
        </div>
      )}
      {rec.ifDifferent.length > 0 && (
        <div className="tf-block">
          <div className="tf-block__head">상대가 다르게 반응하면</div>
          {rec.ifDifferent.map((d, i) => (
            <div key={i} className="tf-alt">
              <div className="tf-muted tf-small">{d.label}</div>
              <div className="tf-chips">
                {d.steps.map((s, j) => (
                  <StepChip key={`${s.name}-${j}`} s={s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {rec.sourceLinks.length > 0 && (
        <div className="tf-sources">
          출처:{' '}
          {rec.sourceLinks.map((s, i) =>
            s.url ? (
              <a key={i} href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            ) : (
              <span key={i}>{s.label}</span>
            ),
          )}
        </div>
      )}

      {show3d && motionId && (
        <div className="tf-3d" data-testid="tf-3d">
          <Motion3dDemo techniqueId={motionId} defaultOpen testId="tf-motion3d-card" heading="3D 시연" />
        </div>
      )}

      <footer className="tf-actions">
        {motionId && (
          <button type="button" className="tf-btn" onClick={() => setShow3d((v) => !v)} data-testid="tf-3d-toggle">
            <Icon name="play" /> {show3d ? '3D 닫기' : '3D 애니메이션'}
          </button>
        )}
        <button type="button" className={`tf-btn${saved ? ' is-on' : ''}`} onClick={() => tacticalStore.toggleSaved(query, rec)} data-testid="tf-save" aria-pressed={saved}>
          <Icon name={saved ? 'bookmark-filled' : 'bookmark'} /> {saved ? '저장됨' : '저장'}
        </button>
        {rec.techniqueId && (
          <button type="button" className={`tf-btn${isFavorite(rec.techniqueId) ? ' is-on' : ''}`} onClick={() => toggleFavorite(rec.techniqueId!)} data-testid="tf-favorite">
            <Icon name={isFavorite(rec.techniqueId) ? 'star-filled' : 'star'} /> 즐겨찾기
          </button>
        )}
        {multi && (
          <button type="button" className="tf-btn" onClick={saveToLibrary} disabled={!allInDb} title={allInDb ? '' : 'DB에서 확인되지 않은 기술이 있어 저장할 수 없습니다'} data-testid="tf-save-library">
            <Icon name="plus" /> {rec.kind === 'setup' ? '내 전술 셋업에 저장' : '내 콤보 북에 저장'}
          </button>
        )}
        <span className="tf-rate" role="group" aria-label="이 추천이 유용했나요?">
          <button type="button" className={`tf-btn tf-btn--icon${rating === true ? ' is-on' : ''}`} onClick={() => tacticalStore.rate(rec.key, query, true)} data-testid="tf-useful" aria-pressed={rating === true} title="유용해요">
            👍
          </button>
          <button type="button" className={`tf-btn tf-btn--icon${rating === false ? ' is-on' : ''}`} onClick={() => tacticalStore.rate(rec.key, query, false)} data-testid="tf-not-useful" aria-pressed={rating === false} title="별로예요">
            👎
          </button>
        </span>
      </footer>
      {msg && (
        <p className="tf-flash" role="status" data-testid="tf-flash">
          {msg}
        </p>
      )}
    </article>
  );
}
