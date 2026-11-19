import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import Icon from '../components/Icon';
import { useAuth } from '../lib/auth/AuthProvider';
import { searchAllTechniques } from '../lib/userTechniques/service';
import { getTechnique } from '../lib/loadData';
import { listMyAssignments } from '../lib/gymClass/adminService';
import { findGoal, isoWeekKey, saveGoal } from '../lib/goals/store';
import { addDays, completionOf, mondayOf, type ProgramItem, type ProgramSettings, type WeeklyProgram } from '../lib/trainingProgram/engine';
import {
  PROGRAM_EVENT,
  addTechniqueItem,
  buildWeek,
  getProgramSettings,
  getWeek,
  logDay,
  moveItem,
  removeItem,
  saveSettings,
  setRestDay,
  toggleItemDone,
} from '../lib/trainingProgram/store';

const WD = ['월', '화', '수', '목', '금', '토', '일'];
const KIND_LABEL: Record<ProgramItem['kind'], string> = { assignment: '체육관 과제', weak: '약점 보강', review: '복습', new: '새 기술', combo: '콤보·셋업', custom: '직접 추가' };
const ARTS = [
  ['', '전체 종목'], ['boxing', '복싱'], ['kickboxing', '킥복싱'], ['muay-thai', '무에타이'], ['bjj', '주짓수'], ['wrestling', '레슬링'],
  ['mixed-martial-arts', 'MMA'], ['judo', '유도'], ['taekwondo', '태권도'], ['karate', '가라테'], ['sambo', '삼보'],
];

/** 개인 훈련 프로그램 — 규칙 기반(결정론적) 주간 계획. AI 모델 없이 생성·조정되고, 완료는 훈련 기록에 남는다. */
export default function TrainingProgram() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [week, setWeek] = useState<WeeklyProgram | null>(() => getWeek(mondayOf(new Date())));
  const [settings, setSettings] = useState<ProgramSettings>(() => getProgramSettings());
  const [assignments, setAssignments] = useState<{ id: string; techniqueId: string | null; title: string }[]>([]);
  const [goal, setGoal] = useState(() => findGoal('week', isoWeekKey(new Date()))?.text ?? '');
  const [goalSaved, setGoalSaved] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!user) return;
    void listMyAssignments(user.id).then((r) => {
      if (r.ok) setAssignments(r.data.filter((a) => a.status === 'open' && (a.kind === 'task' || a.kind === 'technique')).map((a) => ({ id: a.id, techniqueId: a.techniqueId, title: a.techniqueId ? getTechnique(a.techniqueId)?.name ?? a.title : a.title })));
    });
  }, [user?.id]);

  useEffect(() => {
    const on = () => setWeek(getWeek(weekStart));
    on();
    window.addEventListener(PROGRAM_EVENT, on);
    return () => window.removeEventListener(PROGRAM_EVENT, on);
  }, [weekStart]);

  const results = useMemo(() => (q.trim() ? searchAllTechniques(q, 6) : []), [q]);
  const c = week ? completionOf(week) : null;

  function generate() {
    setWeek(buildWeek(weekStart, assignments));
    setMsg('계획을 다시 만들었습니다. 이미 완료했거나 직접 옮긴 항목은 그대로 둡니다.');
  }
  function updateSettings(patch: Partial<ProgramSettings>) {
    setSettings(saveSettings(patch));
  }

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/training" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">개인 훈련 프로그램</div>
            <h2>이번 주 훈련 계획</h2>
            <p>숙련도·복습 주기·약점·즐겨찾기·콤보·최근 훈련량·체육관 과제로 규칙에 따라 만듭니다. 같은 기록이면 항상 같은 계획이 나옵니다.</p>
          </div>
          <div className="eco-row">
            <Link to="/progress" className="btn btn-secondary btn-sm"><Icon name="trend" /> 훈련 성과</Link>
            <Link to="/coach/chat" className="btn btn-ghost btn-sm"><Icon name="coach" /> AI 코치에게 묻기</Link>
          </div>
        </div>

        <details className="eco-card" open={!week}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}><Icon name="sliders" /> 목표와 설정</summary>
          <div className="eco-form" style={{ marginTop: 10 }}>
            <label>
              이번 주 목표 (훈련 목표 화면과 같은 기록)
              <textarea value={goal} onChange={(e) => { setGoal(e.target.value); setGoalSaved(false); }} maxLength={4000} placeholder="예: 잽-크로스 거리 유지, 주 3회 훈련" data-testid="program-goal" />
            </label>
            <div className="eco-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { saveGoal('week', isoWeekKey(new Date()), goal); setGoalSaved(true); }}>목표 저장</button>
              {goalSaved && <span className="eco-meta">저장했습니다.</span>}
              <Link to="/goals" className="eco-meta">목표 전체 보기</Link>
            </div>
            <div className="eco-form-grid">
              <label>주당 훈련일
                <select value={settings.daysPerWeek} onChange={(e) => updateSettings({ daysPerWeek: Number(e.target.value) })} data-testid="program-days">
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}일</option>)}
                </select>
              </label>
              <label>1회 훈련 시간
                <select value={settings.sessionMinutes} onChange={(e) => updateSettings({ sessionMinutes: Number(e.target.value) })}>
                  {[20, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n}분</option>)}
                </select>
              </label>
              <label>집중 종목
                <select value={settings.focusArt ?? ''} onChange={(e) => updateSettings({ focusArt: e.target.value || null })}>
                  {ARTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                </select>
              </label>
              <label>주당 새 기술
                <select value={settings.newPerWeek} onChange={(e) => updateSettings({ newPerWeek: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}개</option>)}
                </select>
              </label>
            </div>
            <div>
              <div className="eco-meta" style={{ fontWeight: 600, marginBottom: 4 }}>항상 쉬는 요일</div>
              <div className="eco-row">
                {WD.map((l, i) => (
                  <button key={l} type="button" className={`chip${settings.fixedRestWeekdays.includes(i) ? ' active' : ''}`} aria-pressed={settings.fixedRestWeekdays.includes(i)}
                    onClick={() => updateSettings({ fixedRestWeekdays: settings.fixedRestWeekdays.includes(i) ? settings.fixedRestWeekdays.filter((x) => x !== i) : [...settings.fixedRestWeekdays, i] })}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        </details>

        <div className="eco-row eco-row--between" style={{ margin: '14px 0 8px' }}>
          <div className="eco-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="이전 주"><Icon name="chevron-left" /></button>
            <strong>{weekStart} 주</strong>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="다음 주"><Icon name="chevron-right" /></button>
            {weekStart !== mondayOf(new Date()) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeekStart(mondayOf(new Date()))}>이번 주</button>}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={generate} data-testid="program-generate"><Icon name="refresh" /> {week ? '계획 다시 만들기' : '계획 만들기'}</button>
        </div>
        {msg && <div className="eco-notice eco-notice--accent" role="status">{msg}</div>}

        {!week ? (
          <div className="eco-card"><p className="eco-meta" style={{ margin: 0 }}>이 주의 계획이 아직 없습니다. "계획 만들기"를 누르세요.</p></div>
        ) : (
          <>
            <div className="eco-metrics" data-testid="program-completion">
              <div className="eco-metric"><div className="eco-metric__label">완료</div><div className="eco-metric__value">{c!.done}/{c!.total}</div><div className="eco-metric__sub">{c!.rate !== null ? `${c!.rate}%` : '항목 없음'}</div></div>
              <div className="eco-metric"><div className="eco-metric__label">훈련일</div><div className="eco-metric__value">{week.days.filter((d) => !d.rest).length}일</div></div>
              <div className="eco-metric"><div className="eco-metric__label">체육관 과제</div><div className="eco-metric__value">{assignments.length}</div><div className="eco-metric__sub">{user ? '열린 과제' : '로그인 시 반영'}</div></div>
            </div>
            {week.notes.length > 0 && <div className="eco-notice"><strong>이번 주 조정</strong><ul>{week.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>}

            <div className="eco-week" data-testid="program-week">
              {week.days.map((d, i) => (
                <div key={d.date} className={`eco-day${d.rest ? ' eco-day--rest' : ''}${d.date === today ? ' eco-day--today' : ''}`} data-testid="program-day">
                  <div className="eco-row eco-row--between">
                    <strong>{WD[i]} <span className="eco-meta">{d.date.slice(5)}</span></strong>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeek(setRestDay(weekStart, d.date, !d.rest))}>{d.rest ? '훈련일로' : '휴식일로'}</button>
                  </div>
                  {d.rest ? (
                    <p className="eco-meta">휴식·회복</p>
                  ) : (
                    <>
                      {d.items.length === 0 && <p className="eco-meta">항목 없음</p>}
                      {d.items.map((it) => (
                        <div key={it.id} className={`eco-item${it.done ? ' eco-item--done' : ''}`} data-testid="program-item">
                          <input type="checkbox" checked={it.done} onChange={() => setWeek(toggleItemDone(weekStart, it.id))} aria-label={`${it.title} 완료`} data-testid="program-item-done" />
                          <div style={{ minWidth: 0 }}>
                            <div className="eco-item__title">
                              {it.techniqueId && getTechnique(it.techniqueId) ? <Link to={`/arts/${getTechnique(it.techniqueId)!.martialArt}/techniques/${it.techniqueId}`}>{it.title}</Link> : it.comboId ? <Link to={`/combos/${it.comboId}/train`}>{it.title}</Link> : it.title}
                            </div>
                            <div className="eco-meta-faint eco-meta" style={{ fontSize: 12 }}><span className="eco-pill">{KIND_LABEL[it.kind]}</span> {it.minutes}분 · {it.reason}</div>
                          </div>
                          <div className="eco-stack" style={{ gap: 2 }}>
                            <select className="select" value="" onChange={(e) => e.target.value && setWeek(moveItem(weekStart, it.id, e.target.value))} aria-label="다른 날로 옮기기" style={{ fontSize: 12, padding: '2px 4px' }}>
                              <option value="">옮기기</option>
                              {week.days.filter((x) => x.date !== d.date).map((x) => <option key={x.date} value={x.date}>{WD[week.days.indexOf(x)]}</option>)}
                            </select>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeek(removeItem(weekStart, it.id))} aria-label="빼기"><Icon name="close" /></button>
                          </div>
                        </div>
                      ))}
                      {adding === d.date ? (
                        <div className="eco-stack" style={{ gap: 4, marginTop: 6 }}>
                          <input className="select" value={q} onChange={(e) => setQ(e.target.value)} placeholder="기술 검색" autoFocus />
                          {results.map((t) => (
                            <button key={t.id} type="button" className="chip" onClick={() => { setWeek(addTechniqueItem(weekStart, d.date, t.id, t.name)); setAdding(null); setQ(''); }}>+ {t.name}</button>
                          ))}
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>닫기</button>
                        </div>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(d.date)}><Icon name="plus" /> 기술 추가</button>
                      )}
                      {d.items.some((x) => x.done) && (
                        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%' }} data-testid="program-log-day"
                          onClick={() => { const id = logDay(weekStart, d.date); setMsg(id ? `${d.date} 훈련을 훈련 기록에 남겼습니다. 숙련도·복습 주기에 반영됩니다.` : '완료한 항목이 없습니다.'); setWeek(getWeek(weekStart)); }}>
                          {d.loggedEntryId ? '훈련 기록 다시 저장' : '훈련 기록에 남기기'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="eco-meta" style={{ marginTop: 10 }}>
              체크만으로는 숙련도가 바뀌지 않습니다. "훈련 기록에 남기기"를 누르면 기존 훈련 기록에 저장되어 연습 횟수·복습 주기에 반영되고, 다음 주 계획은 이번 주 완료율과 최근 훈련량을 보고 자동으로 조정됩니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
