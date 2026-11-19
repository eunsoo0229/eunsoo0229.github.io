import { Link } from 'react-router-dom';
import type { Technique } from '../../types';
import Icon from '../Icon';
import { learnerLevel, LEVEL_LABEL, levelAdvice, RULE_SOURCE_LABEL, safetyGuide, SAFETY_KIND_LABEL } from '../../lib/safety/techniqueSafety';
import { resolve, useEcoStates } from '../../lib/trainingEcosystem/useEco';

// 기술 상세의 안전 섹션 (사양 §5-4): 학습 전 확인 · 수행 시 주의사항 · 보호 장비 · 지도자 감독 권고 · 관련 기초 기술,
// each part labelled with where it came from; unknown → "정보 확인 필요".

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="eco-safety__part">
      <h4>{title}</h4>
      <ul>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SafetySection({ technique }: { technique: Technique }) {
  const states = useEcoStates();
  const g = safetyGuide(technique, { states, resolveName: (id) => resolve(id)?.koreanName ?? resolve(id)?.name ?? id });
  const lv = learnerLevel(technique.martialArt, states);
  const advice = levelAdvice(g, lv);
  return (
    <section className="card info-card eco-safety" data-testid="technique-safety">
      <h3>
        <Icon name="warn" /> 안전 가이드
      </h3>
      <p className="muted eco-safety__source">
        {g.unverified ? '정보 확인 필요 — 이 기술의 분류를 기록에서 알 수 없어 일반 안전 수칙을 붙이지 않았습니다.' : `${g.kinds.map((k) => SAFETY_KIND_LABEL[k]).join(' · ')} · ${RULE_SOURCE_LABEL}`}
        {g.level ? ` · 적합한 학습 수준: ${LEVEL_LABEL[g.level]}${g.levelSource === 'kind' ? ' (기술 분류 기준 — 기록에 난이도 없음)' : ' (기술 기록의 난이도)'}` : ' · 적합한 학습 수준: 정보 확인 필요'}
      </p>
      {advice.length > 0 && (
        <div className="eco-safety__advice">
          {advice.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      )}
      {!g.unverified && (
        <>
          <List title="학습 전 확인" items={g.before} />
          <List title="수행 시 주의사항" items={[...g.partner, ...g.overuse]} />
          <List title="보호 장비" items={g.equipment} />
          <List title="지도자 감독 권고" items={g.supervision} />
        </>
      )}
      {(g.prerequisites.length > 0 || g.missingBasics.length > 0) && (
        <div className="eco-safety__part">
          <h4>관련 기초 기술</h4>
          <ul>
            {g.prerequisites.map((p) => {
              const t = resolve(p.techniqueId);
              return (
                <li key={p.techniqueId}>
                  {t ? <Link to={`/arts/${t.martialArt}/techniques/${encodeURIComponent(t.id)}`}>{p.name}</Link> : p.name}
                  <span className="chip">{p.done === null ? '기록 없음' : p.done ? '학습 완료' : '아직 학습 완료 아님'}</span>
                </li>
              );
            })}
            {g.missingBasics.map((m) => (
              <li key={m} className="muted">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      {g.recordNotes.length > 0 && <List title="기술 기록에 적힌 안전 관련 내용 (원문)" items={g.recordNotes} />}
      {g.researched.map((r) => (
        <div key={r.style} className="eco-safety__part">
          <h4>{r.style} 연구 자료의 안전 메모 (AI가 웹 자료로 정리 · 사람 검토 전)</h4>
          <p>{r.text}</p>
          {r.sources.length > 0 && (
            <p className="muted">
              출처:{' '}
              {r.sources.slice(0, 3).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {s.title}{' '}
                </a>
              ))}
            </p>
          )}
        </div>
      ))}
      <p className="eco-safety__stop">
        <Icon name="warn" /> {g.stopRule}
      </p>
    </section>
  );
}
