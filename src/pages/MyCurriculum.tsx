import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import SafetyChecklistCard from '../components/safety/SafetyChecklistCard';
import type { Technique } from '../types';
import { getUnifiedAllTechniques } from '../lib/userTechniques/service';
import { getMartialArt } from '../lib/loadData';
import { hasMotion3d } from '../lib/motion3d/catalog';
import { loadKnowledgeIndex } from '../lib/martialdexKnowledge/loadIndex';
import { startLessonFromProposal } from '../lib/selfAi/chatLesson';
import { ECO_STATE_LABEL, EVIDENCE_LABEL } from '../lib/trainingEcosystem/learningState';
import {
  addItem,
  advanceRuleText,
  applySuggestion,
  buildPersonalCurriculum,
  currentStage,
  dismissSuggestion,
  EVALUATION_LABEL,
  GOAL_PRESETS,
  moveItem,
  refreshPlan,
  removeItem,
  ROLE_LABEL,
  setWeeklyTarget,
  stageProgress,
  todayTasks,
  weeklyProgress,
  type GoalPresetId,
  type PersonalCurriculum,
  type TodayTask,
} from '../lib/trainingEcosystem/personalCurriculum';
import { listArchivedCurricula, replaceActiveCurriculum, saveActiveCurriculum, useActiveCurriculum } from '../lib/trainingEcosystem/curriculumStore';
import { appRefreshDeps, poseSupported, resolve, techniqueRoute, useEcoStates } from '../lib/trainingEcosystem/useEco';

// 나의 학습 커리큘럼 (사양 §2-5): 목표 → 단계별 로드맵, 오늘·주간 목표, 기술별 진행, 다음 추천, 수정·목표 변경, 완료 기록.
// The learner's level on every item is read live from the records; the plan only holds the structure.

const KIND_LABEL: Record<TodayTask['kind'], string> = { review: '복습', learn: '학습', evaluate: '평가' };
const name = (t: Technique | undefined, id: string) => (t ? t.koreanName ?? t.name : id);

function GoalPicker({ onCreate, current }: { onCreate: (preset: GoalPresetId, focus: string[]) => void; current: PersonalCurriculum | null }) {
  const [focus, setFocus] = useState<Technique[]>([]);
  const [q, setQ] = useState('');
  const all = useMemo(() => getUnifiedAllTechniques(), []);
  const hits = q.trim().length >= 1 ? all.filter((t) => `${t.name} ${t.koreanName ?? ''} ${t.aliases.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <section className="card eco-goal-picker" data-testid="curriculum-goal-picker">
      <h3>{current ? '목표 변경' : '학습 목표 선택'}</h3>
      {current && <p className="muted">목표를 바꾸면 지금 커리큘럼 "{current.goal.label}"은 완료 기록과 함께 보관되고, 학습 기록은 그대로 남습니다.</p>}
      <div className="eco-goal-grid">
        {GOAL_PRESETS.filter((p) => p.id !== 'technique_focus').map((p) => (
          <button key={p.id} type="button" className="eco-goal" onClick={() => onCreate(p.id, [])} data-testid={`goal-${p.id}`}>
            <strong>{p.label}</strong>
            <span className="muted">{p.description}</span>
          </button>
        ))}
      </div>
      <div className="eco-goal-focus">
        <strong>특정 기술 숙련도 향상</strong>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="기술 이름 검색 (예: 더블렉, 암바)" />
        {hits.map((t) => (
          <button key={t.id} type="button" className="chip" onClick={() => setFocus((f) => (f.some((x) => x.id === t.id) ? f : [...f, t]))}>
            + {t.koreanName ?? t.name} <span className="muted">{getMartialArt(t.martialArt)?.nameKo ?? t.martialArt}</span>
          </button>
        ))}
        {focus.length > 0 && (
          <p>
            선택: {focus.map((t) => t.koreanName ?? t.name).join(', ')}{' '}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onCreate('technique_focus', focus.map((t) => t.id))}>
              이 기술로 커리큘럼 만들기
            </button>
          </p>
        )}
      </div>
    </section>
  );
}

export default function MyCurriculum() {
  const navigate = useNavigate();
  const plan = useActiveCurriculum();
  const states = useEcoStates();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [addQ, setAddQ] = useState<{ stage: number; q: string } | null>(null);
  const deps = useMemo(() => appRefreshDeps(), []);

  // observe progress the records show (logged once) and work out suggestions
  const refreshed = useMemo(() => (plan ? refreshPlan(plan, states, deps) : null), [plan, states, deps]);
  useEffect(() => {
    if (refreshed?.changed) saveActiveCurriculum(refreshed.plan);
  }, [refreshed]);

  function create(preset: GoalPresetId, focus: string[]) {
    const p = buildPersonalCurriculum({ presetId: preset, focusTechniqueIds: focus, techniques: getUnifiedAllTechniques(), states, resolve, poseSupported });
    if (!p) {
      setMsg('이 목표에 맞는, 수업할 수 있을 만큼 자료가 있는 MARTIALDEX 기술을 찾지 못했습니다.');
      return;
    }
    if (plan) replaceActiveCurriculum(p, `목표 변경 → ${p.goal.label}`);
    else saveActiveCurriculum(p);
    setPicking(false);
    setMsg(p.log[0].summary);
  }

  async function startLesson(ids: string[], topic: string) {
    const index = await loadKnowledgeIndex();
    const r = startLessonFromProposal({ topic, martialArt: resolve(ids[0])?.martialArt ?? null, techniqueIds: ids, sequenceIds: [], sourceUrls: [], candidateIds: [], summary: [`나의 학습 커리큘럼 "${plan?.goal.label ?? ''}"의 오늘 학습`] }, index, [], 'personal-curriculum');
    if (!r.ok) {
      setMsg(r.message);
      return;
    }
    navigate(r.route);
  }

  if (!plan || picking) {
    return (
      <div className="page eco-page">
        <div className="container">
          <BackButton />
          <div className="section-title">
            <h1>나의 학습 커리큘럼</h1>
          </div>
          <p className="muted">현재 학습 기록·숙련도를 바탕으로 목표까지의 학습 경로를 만들고, 평가 결과에 따라 계속 조정합니다. 숙련도는 실제 평가(자세 측정·AI 코치 수업 평가)가 있을 때만 "확인 완료"로 표시합니다.</p>
          {msg && <p className="video-status-message">{msg}</p>}
          <GoalPicker onCreate={create} current={plan} />
          {plan && (
            <button type="button" className="btn btn-secondary" onClick={() => setPicking(false)}>
              취소
            </button>
          )}
        </div>
      </div>
    );
  }

  const p = refreshed?.plan ?? plan;
  const suggestions = refreshed?.suggestions ?? [];
  const cur = currentStage(p, states);
  const tasks = todayTasks(p, states);
  const week = weeklyProgress(p);
  const total = p.items.length;
  const done = p.items.filter((i) => ['completed', 'verified'].includes(states.get(i.techniqueId)?.state ?? '')).length;
  const learnIds = tasks.filter((t) => t.kind !== 'evaluate').map((t) => t.techniqueId);
  const archived = listArchivedCurricula();
  const addHits = addQ && addQ.q.trim() ? getUnifiedAllTechniques().filter((t) => `${t.name} ${t.koreanName ?? ''}`.toLowerCase().includes(addQ.q.trim().toLowerCase())).slice(0, 6) : [];

  return (
    <div className="page eco-page">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h1>나의 학습 커리큘럼</h1>
          <Link to="/performance">성과 대시보드 →</Link>
        </div>
        {msg && <p className="video-status-message">{msg}</p>}

        <section className="card eco-hero" data-testid="curriculum-overview">
          <div className="eco-hero__goal">
            <span className="eco-kicker">목표</span>
            <h2>{p.goal.label}</h2>
            <p className="muted">
              {new Date(p.createdAt).toLocaleDateString('ko-KR')} 시작 · {p.goal.arts.map((a) => getMartialArt(a)?.nameKo ?? a).join(' · ')}
              {p.skippedMastered.length ? ` · 이미 숙련 확인된 ${p.skippedMastered.length}개 기술은 제외` : ''}
            </p>
          </div>
          <div className="eco-kpis">
            <div>
              <span className="eco-kpi__n">{done}/{total}</span>
              <span className="eco-kpi__l">학습 완료 이상</span>
            </div>
            <div>
              <span className="eco-kpi__n">{cur === null ? '완료' : `${cur + 1}단계`}</span>
              <span className="eco-kpi__l">현재 단계</span>
            </div>
            <div>
              <span className="eco-kpi__n">{week.done}/{week.target}</span>
              <span className="eco-kpi__l">이번 주 목표 (학습 완료 기술 수)</span>
            </div>
          </div>
          <div className="eco-bar" aria-label={`전체 진행률 ${Math.round((done / Math.max(1, total)) * 100)}%`}>
            <span style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
          </div>
          <div className="eco-actions">
            <label>
              주간 목표{' '}
              <input className="input eco-num" type="number" min={1} max={14} value={p.weeklyTarget} onChange={(e) => saveActiveCurriculum(setWeeklyTarget(p, Number(e.target.value)))} /> 개
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPicking(true)} data-testid="curriculum-change-goal">
              목표 변경
            </button>
          </div>
        </section>

        <section className="card" data-testid="curriculum-today">
          <h3>
            <Icon name="calendar" /> 오늘의 학습 목표
          </h3>
          {!tasks.length && <p className="muted">오늘 할 항목이 없습니다 — {cur === null ? '모든 단계를 통과했습니다. 아래 제안이나 목표 변경으로 다음 학습을 정하세요.' : '현재 단계의 기술을 모두 학습했습니다. 평가로 숙련도를 확인해 보세요.'}</p>}
          <ul className="eco-tasks">
            {tasks.map((t) => {
              const tech = resolve(t.techniqueId);
              return (
                <li key={t.techniqueId} className="eco-task">
                  <span className={`chip eco-task__kind eco-task__kind--${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                  <strong>{name(tech, t.techniqueId)}</strong> <span className="muted">— {t.reason}</span>
                  <div className="eco-task__links">
                    {tech && <Link to={techniqueRoute(tech)}>기술 상세{hasMotion3d(tech.id) ? ' · 3D 프리뷰' : ''} · 영상</Link>}
                    {tech && t.evaluation === 'pose' && <Link to={`/pose-check/${encodeURIComponent(tech.id)}`}>자세 측정으로 평가</Link>}
                    {tech && t.evaluation === 'lesson' && (
                      <button type="button" className="linklike" onClick={() => void startLesson([tech.id], `${name(tech, tech.id)} 수업`)}>
                        AI 코치 수업으로 평가
                      </button>
                    )}
                    <span className="muted">평가 방법: {EVALUATION_LABEL[t.evaluation]}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {learnIds.length > 0 && (
            <>
              <SafetyChecklistCard techniqueIds={learnIds} compact />
              <button type="button" className="btn btn-primary" onClick={() => void startLesson(learnIds, `오늘의 학습 — ${p.goal.label}`)} data-testid="curriculum-start-today">
                오늘 학습 시작 (AI 코치 수업)
              </button>
            </>
          )}
        </section>

        {suggestions.length > 0 && (
          <section className="card" data-testid="curriculum-suggestions">
            <h3>
              <Icon name="spark" /> 학습 결과에 따른 조정 제안
            </h3>
            <ul className="eco-suggestions">
              {suggestions.map((s) => (
                <li key={s.id}>
                  {s.text}
                  {s.structural ? (
                    <span className="eco-suggestion__actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => saveActiveCurriculum(applySuggestion(p, s, deps))}>
                        적용
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveActiveCurriculum(dismissSuggestion(p, s.id))}>
                        무시
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveActiveCurriculum(dismissSuggestion(p, s.id))}>
                      닫기
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted">조정은 "적용"을 눌렀을 때만 커리큘럼에 반영되며, 학습 기록은 바뀌지 않습니다.</p>
          </section>
        )}

        <section className="card" data-testid="curriculum-roadmap">
          <h3>
            <Icon name="list" /> 전체 학습 로드맵
          </h3>
          <p className="muted">{advanceRuleText}</p>
          {p.stages.map((s) => {
            const sp = stageProgress(p, s.index, states);
            const items = p.items.filter((i) => i.stage === s.index);
            return (
              <div key={s.index} className={`eco-stage${cur === s.index ? ' eco-stage--current' : ''}${sp.passed ? ' eco-stage--passed' : ''}`}>
                <div className="eco-stage__head">
                  <strong>{s.title}</strong> <span className="chip">{sp.passed ? '통과' : cur === s.index ? '진행 중' : '대기'}</span> <span className="muted">{sp.done}/{sp.total} 학습 완료 이상{sp.repeat ? ` · 반복 필요 ${sp.repeat}` : ''}</span>
                </div>
                <p className="muted">단계 목표: {s.goal}</p>
                <ol className="eco-items">
                  {items.map((i) => {
                    const t = resolve(i.techniqueId);
                    const st = states.get(i.techniqueId);
                    return (
                      <li key={i.techniqueId} className="eco-item" data-state={st?.state ?? 'not_started'}>
                        <div>
                          {t ? <Link to={techniqueRoute(t)}>{name(t, i.techniqueId)}</Link> : i.techniqueId} <span className="chip">{ROLE_LABEL[i.role]}</span>{' '}
                          <span className={`chip eco-state eco-state--${st?.state ?? 'not_started'}`}>{ECO_STATE_LABEL[st?.state ?? 'not_started']}</span>
                          {st?.evaluationMissing && st.state !== 'not_started' && <span className="chip">평가 데이터 부족</span>}
                        </div>
                        <div className="muted">
                          {i.reason} · 평가: {EVALUATION_LABEL[i.evaluation]}
                          {st && st.state !== 'not_started' ? ` · 근거: ${EVIDENCE_LABEL[st.evidence]}${st.latestScore !== null ? ` (최근 점수 ${Math.round(st.latestScore)})` : ''}` : ''}
                          {i.doneAt ? ` · ${i.doneAt.slice(0, 10)} 학습 완료` : ''}
                        </div>
                        <div className="eco-item__edit">
                          <button type="button" className="btn btn-ghost btn-sm" aria-label="위로" onClick={() => saveActiveCurriculum(moveItem(p, i.techniqueId, -1))}>
                            <Icon name="chevron-up" />
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" aria-label="아래로" onClick={() => saveActiveCurriculum(moveItem(p, i.techniqueId, 1))}>
                            <Icon name="chevron-down" />
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" aria-label="커리큘럼에서 빼기" onClick={() => saveActiveCurriculum(removeItem(p, i.techniqueId, name(t, i.techniqueId)))}>
                            <Icon name="close" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {addQ?.stage === s.index ? (
                  <div className="eco-add">
                    <input className="input" autoFocus value={addQ.q} onChange={(e) => setAddQ({ stage: s.index, q: e.target.value })} placeholder="추가할 기술 검색" />
                    {addHits.map((t) => (
                      <button key={t.id} type="button" className="chip" onClick={() => { saveActiveCurriculum(addItem(p, t, s.index, poseSupported)); setAddQ(null); }}>
                        + {t.koreanName ?? t.name}
                      </button>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddQ(null)}>
                      닫기
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddQ({ stage: s.index, q: '' })}>
                    + 이 단계에 기술 추가
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <section className="card" data-testid="curriculum-log">
          <details>
            <summary>
              <strong>완료·변경 기록</strong> <span className="muted">({p.log.length}건{archived.length ? ` · 이전 커리큘럼 ${archived.length}개 보관` : ''})</span>
            </summary>
            <ul>
              {[...p.log].reverse().map((l, k) => (
                <li key={k}>
                  <span className="muted">{l.at.slice(0, 10)}</span> {l.summary}
                </li>
              ))}
            </ul>
            {archived.map((a) => (
              <p key={a.id} className="muted">
                보관: "{a.goal.label}" ({a.createdAt.slice(0, 10)} ~ {a.updatedAt.slice(0, 10)}) — 기술 {a.items.length}개 중 {a.items.filter((i) => i.doneAt).length}개 완료 기록
              </p>
            ))}
          </details>
        </section>
        {!total && <EmptyState text="커리큘럼에 기술이 없습니다. 단계에 기술을 추가하거나 목표를 바꿔 주세요." />}
      </div>
    </div>
  );
}
