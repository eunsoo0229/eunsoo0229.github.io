import Icon from '../components/Icon';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import InterviewChat from '../components/fighterProfile/InterviewChat';
import ProfileDetail, { ItemMeta } from '../components/fighterProfile/ProfileDetail';
import { useFighterProfile } from '../components/fighterProfile/useFighterProfile';
import { ART_OPTIONS, fieldOf, formatValue } from '../lib/fighterProfile/catalog';
import { progress } from '../lib/fighterProfile/interview';
import { liveItem } from '../lib/fighterProfile/store';
import { analyzeStyle } from '../lib/fighterProfile/style';
import type { FighterProfile as Profile, SectionId, StyleAnalysis } from '../lib/fighterProfile/types';

type Tab = 'home' | 'interview' | 'detail';

const BASIC = ['body.stance', 'body.stanceSwitch', 'body.dominantHand', 'body.dominantFoot', 'body.height', 'body.weight', 'train.years', 'train.frequency'];
const SUMMARY_BY_AREA: { label: string; keys: string[] }[] = [
  { label: '타격', keys: ['box.favoritePunches', 'box.preferredRange', 'box.powerHand', 'kick.favorite', 'kick.preferredRange', 'mma.strikeStyle'] },
  { label: '방어·이동', keys: ['def.main', 'move.forward', 'move.lateral', 'move.counterAfterDefense'] },
  { label: '그래플링', keys: ['wr.single', 'wr.double', 'wr.direction', 'bjj.topBottom', 'bjj.guards', 'bjj.subs', 'pos.comfortable', 'pos.uncomfortable'] },
  { label: '목표', keys: ['train.improve', 'train.wantToLearn', 'train.goalShort', 'train.goalLong'] },
];

function Row({ p, k }: { p: Profile; k: string }) {
  const it = liveItem(p, k);
  const f = fieldOf(k);
  if (!it || it.state !== 'answered' || !f) return null;
  return (
    <li className="fp-sum-row">
      <span className="fp-item__label">{f.label}</span> <strong>{formatValue(f, it.value)}</strong> <ItemMeta item={it} />
    </li>
  );
}

function StyleCard({ p, save }: { p: Profile; save: (x: Profile) => void }) {
  const fresh = useMemo(() => analyzeStyle(p), [p]);
  const style: StyleAnalysis | null = p.style ?? (fresh.tags.length ? fresh : null);
  const [removed, setRemoved] = useState<string[]>([]);
  if (!style) return <p className="fp-meta">답변이 더 쌓이면 스타일을 분석해 보여 드릴게요. 하나의 유형으로 고정하지 않고 여러 성향을 함께 기록합니다.</p>;
  const tags = style.tags.filter((t) => !removed.includes(t.id));
  const roleLabel = { primary: '기본 스타일', secondary: '보조 스타일', tendency: '' } as const;
  const confirm = () => {
    const at = new Date().toISOString();
    save({ ...p, style: { ...style, tags, status: 'confirmed', confirmedAt: at, updatedAt: at } });
    setRemoved([]);
  };
  return (
    <div data-testid="fp-style">
      <ul className="fp-style-tags">
        {tags.map((t) => (
          <li key={t.id}>
            {roleLabel[t.role] && <span className="fp-meta">{roleLabel[t.role]}: </span>}
            <strong>{t.label}</strong>
            <span className="fp-meta"> — 근거: {t.basis.map((b) => fieldOf(b)?.label ?? b).join(', ')}</span>
            {style.status !== 'confirmed' && (
              <button type="button" className="fp-edit-link" onClick={() => setRemoved((x) => [...x, t.id])} title="이 분석은 맞지 않아요">
                빼기
              </button>
            )}
          </li>
        ))}
      </ul>
      {style.status === 'confirmed' ? (
        <p className="fp-meta">
          <Icon name="check" /> 확인한 분석입니다 (AI 분석 · {style.confirmedAt?.slice(0, 10)}).{' '}
          <button type="button" className="fp-edit-link" onClick={() => save({ ...p, style: { ...fresh, status: 'unconfirmed' } })} data-testid="fp-style-reanalyze">
            다시 분석
          </button>
        </p>
      ) : (
        <div className="chip-row">
          <span className="fp-meta">답변을 바탕으로 한 AI 분석이에요. 맞나요?</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={!tags.length} data-testid="fp-style-confirm">
            맞아요, 저장
          </button>
          {removed.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoved([])}>
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 개인 파이터 프로필 · Personal Fighter Profile */
export default function FighterProfile() {
  const [params, setParams] = useSearchParams();
  const tab = (['home', 'interview', 'detail'].includes(params.get('tab') ?? '') ? params.get('tab') : 'home') as Tab;
  const setTab = (t: Tab) => setParams(t === 'home' ? {} : { tab: t }, { replace: true });
  const [profile, save] = useFighterProfile();
  const [detailSection, setDetailSection] = useState<SectionId | null>(null);
  const prog = progress(profile);
  const arts = (liveItem(profile, 'train.arts')?.value as string[] | undefined) ?? [];
  const measurements = Object.values(profile.items).filter((it) => !it.deletedAt && it.state === 'answered' && (it.measurement || it.key === 'body.apeIndex'));
  const recent = [...profile.history].reverse().slice(0, 6);
  const started = Object.keys(profile.items).length > 0 || profile.interview.status !== 'idle';

  return (
    <div className="page" data-testid="fighter-profile">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h2><Icon name="gi" /> 개인 파이터 프로필</h2>
          <span className="fp-meta">Personal Fighter Profile</span>
        </div>
        <p className="video-status-message" style={{ marginTop: -8 }}>
          AI 코치와 대화하며 내 스탠스·타격·그래플링 성향과 습관을 기록해요. AI 코치 수업이 이 프로필을 참고해 나에게 맞게 달라집니다. 입력하지 않아도 모든 기능을 그대로 쓸 수 있어요.
        </p>

        <div className="chip-row fp-tabs" role="tablist">
          {(
            [
              ['home', '프로필 홈'],
              ['interview', 'AI와 프로필 만들기'],
              ['detail', '상세 · 수정'],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chip${tab === t ? ' chip--active' : ''}`} onClick={() => setTab(t)} data-testid={`fp-tab-${t}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'interview' && <InterviewChat profile={profile} save={save} />}
        {tab === 'detail' && <ProfileDetail profile={profile} save={save} initialSection={detailSection} />}

        {tab === 'home' && (
          <>
            {!started ? (
              <div className="card info-card" data-testid="fp-empty">
                <h3>아직 프로필이 없어요</h3>
                <p className="video-status-message">코치가 상담하듯 질문을 하나씩 드릴게요. 모르는 건 넘어가도 되고, 언제든 멈추면 그때까지 저장돼요.</p>
                <div className="chip-row">
                  <button type="button" className="btn btn-primary" onClick={() => setTab('interview')} data-testid="fp-home-start">
                    AI와 프로필 만들기
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setTab('detail')}>
                    직접 입력하기
                  </button>
                </div>
              </div>
            ) : (
              <div className="chip-row" style={{ marginBottom: 10 }}>
                <button type="button" className="btn btn-primary" onClick={() => setTab('interview')} data-testid="fp-home-interview">
                  {profile.interview.status === 'active' || profile.interview.status === 'paused' ? 'AI 인터뷰 이어서 하기' : 'AI 인터뷰로 더 채우기'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setTab('detail')}>
                  프로필 수정하기
                </button>
              </div>
            )}

            <div className="card info-card" data-testid="fp-completeness">
              <h3>프로필 완성도 (기록 범위)</h3>
              <p className="fp-meta">실력이나 등급이 아니라, 코치가 참고할 수 있는 정보가 어디까지 있는지를 보여 줘요. 건너뛴 항목은 비워 둬도 괜찮아요.</p>
              <ul className="fp-progress">
                {prog.sections.map((s) => {
                  const done = s.answered + s.unknown + s.skipped;
                  const pct = s.total ? Math.round((s.answered / s.total) * 100) : 0;
                  return (
                    <li key={s.section}>
                      <button type="button" className="fp-progress__row" onClick={() => { setDetailSection(s.section as SectionId); setTab('detail'); }}>
                        <span>{s.label}</span>
                        <span className="fp-bar">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="fp-meta">
                          {s.total ? `${s.answered}/${s.total}` : '해당 없음'}
                          {s.skipped ? ` · 건너뜀 ${s.skipped}` : ''}
                          {s.unknown ? ` · 미확인 ${s.unknown}` : ''}
                          {s.total && done >= s.total ? ' · 범위 완료' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="card info-card">
              <h3>기본 파이터 정보</h3>
              {arts.length > 0 && <p>수련 종목: {arts.map((a) => ART_OPTIONS.find((o) => o.value === a)?.label ?? a).join(', ')}</p>}
              <ul className="fp-sum">
                {BASIC.map((k) => (
                  <Row key={k} p={profile} k={k} />
                ))}
              </ul>
              {!BASIC.some((k) => liveItem(profile, k)?.state === 'answered') && <p className="fp-meta">아직 기록이 없어요.</p>}
            </div>

            <div className="card info-card">
              <h3>종목별 프로필 요약</h3>
              {SUMMARY_BY_AREA.map((a) => {
                const any = a.keys.some((k) => liveItem(profile, k)?.state === 'answered');
                return any ? (
                  <div key={a.label} className="fp-area">
                    <strong>{a.label}</strong>
                    <ul className="fp-sum">
                      {a.keys.map((k) => (
                        <Row key={k} p={profile} k={k} />
                      ))}
                    </ul>
                  </div>
                ) : null;
              })}
              {!SUMMARY_BY_AREA.some((a) => a.keys.some((k) => liveItem(profile, k)?.state === 'answered')) && <p className="fp-meta">인터뷰가 진행되면 타격·방어·그래플링·목표별로 정리돼요.</p>}
            </div>

            <div className="card info-card">
              <h3>개인 스타일 분석</h3>
              <StyleCard p={profile} save={save} />
            </div>

            <div className="card info-card" data-testid="fp-measurements">
              <h3>신체 측정값</h3>
              <p className="fp-meta">신체 치수 · 정지 상태 도달 거리 · 실제 동작 중 도달 거리는 측정 방법이 달라 서로 비교하지 않아요.</p>
              {measurements.length ? (
                <ul className="fp-sum">
                  {measurements.map((it) => (
                    <Row key={it.key} p={profile} k={it.key} />
                  ))}
                </ul>
              ) : (
                <p className="fp-meta">아직 측정값이 없어요. 상세 화면의 “기본 신체 정보”에서 측정 방법 안내와 함께 입력할 수 있어요.</p>
              )}
            </div>

            <div className="card info-card">
              <h3>최근 업데이트</h3>
              {recent.length ? (
                <ul className="fp-sum">
                  {recent.map((h) => {
                    const f = fieldOf(h.key);
                    const what = h.action === 'delete' ? '삭제' : h.action === 'confirm' ? '확인' : h.action === 'review' ? '확인 필요로 표시' : h.action === 'style' ? '스타일 분석 저장' : f && h.to !== null && h.to !== undefined ? `→ ${formatValue(f, h.to)}` : '기록';
                    return (
                      <li key={h.id} className="fp-sum-row">
                        <span className="fp-meta">{h.at.slice(0, 10)}</span> {f?.label ?? (h.key === 'style' ? '개인 스타일' : h.key)} {what}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="fp-meta">아직 변경 기록이 없어요.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
