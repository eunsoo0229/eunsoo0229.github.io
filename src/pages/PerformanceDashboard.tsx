import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import TrendChart from '../components/TrendChart';
import DonutChart from '../components/DonutChart';
import { listTrainingHistory } from '../lib/trainingHistory/service';
import { getAllRecords } from '../lib/poseAnalysis/recordsService';
import { listLessonLog } from '../lib/coachLesson/lessonLog';
import { listGoals } from '../lib/goals/store';
import { deriveEntryMartialArt } from '../lib/trainingAnalytics/historyView';
import { getMartialArt } from '../lib/loadData';
import { PERIOD_LABEL, type PeriodKey } from '../lib/statsHub/types';
import { METHOD_LABEL } from '../lib/progressReport/analysis';
import { ECO_STATE_LABEL, type EcoState } from '../lib/trainingEcosystem/learningState';
import { computePerformance } from '../lib/trainingEcosystem/performance';
import { generateGrowthReport, reportText, type GrowthReport } from '../lib/trainingEcosystem/growthReport';
import { printReport, saveReportImage, saveReportText } from '../lib/trainingEcosystem/reportExport';
import { useActiveCurriculum } from '../lib/trainingEcosystem/curriculumStore';
import { resolve, techniqueRoute, useEcoStates } from '../lib/trainingEcosystem/useEco';

// 훈련 성과 분석 대시보드 (사양 §3): 숫자는 기록에서 코드가 계산하고(performance.ts), AI는 그 숫자를 근거 번호와 함께
// 해석만 한다(growthReport.ts). 데이터가 없는 지표는 0이 아니라 "기록 없음"과 기록하는 방법을 보여 준다.

const PERIODS: PeriodKey[] = ['7d', '30d', '90d', 'all'];
const STATE_ORDER: EcoState[] = ['verified', 'completed', 'needs_evaluation', 'learning', 'needs_repeat'];
const STATE_COLOR: Record<EcoState, string> = { verified: '#c4ad7c', completed: '#9c8659', needs_evaluation: '#8c8f96', learning: '#5a5d64', needs_repeat: '#b5473c', not_started: '#242529' };
const ART_COLORS = ['#c4ad7c', '#8c8f96', '#7f9a7a', '#b5473c', '#d9c399', '#5a5d64', '#9c8659', '#e8e3d8'];
const nm = (id: string) => resolve(id)?.koreanName ?? resolve(id)?.name ?? id;

function Empty({ text, how }: { text: string; how: string }) {
  return (
    <p className="muted eco-empty">
      {text} <span>— {how}</span>
    </p>
  );
}

export default function PerformanceDashboard() {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const states = useEcoStates();
  const plan = useActiveCurriculum();
  const [report, setReport] = useState<GrowthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const perf = useMemo(
    () =>
      computePerformance({
        period,
        entries: listTrainingHistory(),
        poseRecords: getAllRecords(),
        lessonLogs: listLessonLog(),
        states,
        plan,
        goals: listGoals().map((g) => ({ scope: g.scope, text: g.text, updatedAt: g.updatedAt ?? g.createdAt })),
        artOfEntry: deriveEntryMartialArt,
        artName: (a) => getMartialArt(a)?.nameKo ?? a,
      }),
    [period, states, plan]
  );

  async function makeReport(useAi: boolean) {
    setBusy(true);
    setMsg(null);
    const r = await generateGrowthReport(perf, nm, { useAi });
    setReport(r);
    setBusy(false);
  }

  const weekly = perf.weekly.map((w) => ({ date: w.weekStart, value: w.minutes }));
  const artSlices = perf.perArt.filter((a) => a.minutes > 0).map((a, i) => ({ key: a.art, label: a.name, value: a.minutes, color: ART_COLORS[i % ART_COLORS.length] }));
  const stateSlices = STATE_ORDER.map((s) => ({ key: s, label: ECO_STATE_LABEL[s], value: perf.techniques.counts[s], color: STATE_COLOR[s] })).filter((x) => x.value > 0);
  const title = `MARTIALDEX 성장 리포트 (${PERIOD_LABEL[period]})`;

  return (
    <div className="page eco-page">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h1>훈련 성과 분석</h1>
          <Link to="/my-curriculum">나의 학습 커리큘럼 →</Link>
        </div>
        <div className="chips" role="tablist" aria-label="분석 기간" data-testid="performance-period">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={`chip${p === period ? ' active' : ''}`} onClick={() => setPeriod(p)}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="muted">
          {perf.range.label} · 숫자는 앱에 저장된 기록에서 계산합니다. 서로 다른 평가 방식(자세 측정 · 기준 영상 비교 · 3D 기준 · 수업 평가)의 점수는 합치지 않습니다. 속도·파워·반응시간은 측정하지 않습니다.
        </p>

        {!perf.hasAnyData && <EmptyState art="no-stats" text="아직 분석할 기록이 없습니다. 훈련을 기록하거나 자세 측정·AI 코치 수업을 하면 여기에 성과가 쌓입니다." />}

        {perf.hasAnyData && (
          <>
            <section className="eco-kpis eco-kpis--grid" data-testid="performance-kpis">
              <div className="card">
                <span className="eco-kpi__n">{perf.activity.sessions}</span>
                <span className="eco-kpi__l">훈련 횟수{perf.activity.previous ? ` (직전 ${perf.activity.previous.sessions})` : ''}</span>
              </div>
              <div className="card">
                <span className="eco-kpi__n">{perf.activity.minutes}</span>
                <span className="eco-kpi__l">훈련 시간(분){perf.activity.previous ? ` (직전 ${perf.activity.previous.minutes})` : ''}</span>
              </div>
              <div className="card">
                <span className="eco-kpi__n">{perf.techniques.done}</span>
                <span className="eco-kpi__l">학습 완료 이상 기술 / 기록 있는 {perf.techniques.touched}개</span>
              </div>
              <div className="card">
                <span className="eco-kpi__n">{perf.techniques.verified}</span>
                <span className="eco-kpi__l">숙련도 확인 완료 (실제 평가 근거)</span>
              </div>
            </section>

            <section className="card" data-testid="performance-goals">
              <h3>
                <Icon name="target" /> 목표 달성 현황
              </h3>
              {perf.curriculum ? (
                <>
                  <p>
                    커리큘럼 "{perf.curriculum.goal}" — {perf.curriculum.done}/{perf.curriculum.total} 기술 학습 완료 ({Math.round(perf.curriculum.ratio * 100)}%) · 현재 {perf.curriculum.currentStage === null ? '모든 단계 통과' : `${perf.curriculum.currentStage + 1}단계`} · 주간 목표 달성 {perf.curriculum.weeksMet}/{perf.curriculum.weeksTracked}주
                  </p>
                  <div className="eco-stagebars">
                    {perf.curriculum.stages.map((s) => (
                      <div key={s.title}>
                        <span className="muted">{s.title} {s.done}/{s.total}{s.passed ? ' · 통과' : ''}</span>
                        <div className="eco-bar">
                          <span style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Empty text="진행 중인 커리큘럼이 없어 달성률을 계산하지 않았습니다." how="나의 학습 커리큘럼에서 목표를 정하면 단계·주간 목표 달성률이 표시됩니다" />
              )}
              <p className="muted">{perf.freeGoals.note} (이 기간에 적은 개인 목표 {perf.freeGoals.count}개)</p>
            </section>

            <div className="eco-grid2">
              <section className="card" data-testid="performance-weekly">
                <h3>주간 학습량 (분)</h3>
                {weekly.length >= 2 ? <TrendChart points={weekly} variant="bar" unit="분" /> : <Empty text="주간 그래프를 그릴 만큼 훈련 기록이 없습니다." how="2주 이상 훈련을 기록하면 표시됩니다" />}
                <p className="muted">
                  주 평균 훈련일 {perf.habits.daysPerWeek ?? '—'}일 · 가장 긴 공백 {perf.habits.longestGapDays ?? '—'}일 · 마지막 훈련 {perf.habits.lastTrained ?? '기록 없음'}
                </p>
              </section>
              <section className="card" data-testid="performance-arts">
                <h3>무술 종목별 학습 분포 (훈련 시간)</h3>
                {artSlices.length ? <DonutChart slices={artSlices} /> : <Empty text="종목별로 나눌 훈련 기록이 없습니다." how="커리큘럼·수업·훈련 기록에 무술이 함께 저장됩니다" />}
                <ul className="eco-list">
                  {perf.perArt.slice(0, 6).map((a) => (
                    <li key={a.art}>
                      {a.name}: {a.minutes}분 · {a.sessions}회 · 학습 완료 {a.counts.completed + a.counts.verified} · 반복 필요 {a.counts.needs_repeat}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="eco-grid2">
              <section className="card" data-testid="performance-states">
                <h3>기술별 숙련도 분포 (현재)</h3>
                {stateSlices.length ? (
                  <div className="eco-hbars">
                    {stateSlices.map((x) => (
                      <div key={x.key} className="eco-hbar">
                        <span className="eco-hbar__l">{x.label}</span>
                        <span className="eco-hbar__track">
                          <span style={{ width: `${(x.value / Math.max(1, perf.techniques.touched)) * 100}%`, background: x.color }} />
                        </span>
                        <span className="eco-hbar__n">{x.value}개</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty text="기록이 있는 기술이 없습니다." how="기술을 연습하거나 평가하면 표시됩니다" />
                )}
                <p className="muted">"숙련도 확인 완료"는 자세 측정·수업 평가가 있는 기술만입니다. 평가 없이 연습만 한 기술 {perf.notEvaluated.length}개는 "평가 필요"입니다.</p>
              </section>
              <section className="card" data-testid="performance-trends">
                <h3>기술별 발전 추이 (평가 방식별)</h3>
                {perf.series.length ? (
                  <ul className="eco-list">
                    {perf.series.slice(0, 8).map((s) => (
                      <li key={`${s.techniqueId}-${s.method}`}>
                        <Link to={techniqueRoute(resolve(s.techniqueId)!)}>{nm(s.techniqueId)}</Link> <span className="chip">{METHOD_LABEL[s.method]}</span> {Math.round(s.first.score)} → {Math.round(s.latest.score)} ({s.records.length}회 · {s.first.analyzedAt.slice(0, 10)} ~ {s.latest.analyzedAt.slice(0, 10)})
                        {s.confidence.level !== 'moderate' && <span className="muted"> · 신뢰도 낮음: {s.confidence.reasons[0]}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty text="이 기간에 자세 평가 기록이 없습니다." how="기술 상세의 자세 측정으로 평가하면 이전 평가와 비교됩니다" />
                )}
                {perf.lessonAssessments.length > 0 && (
                  <p className="muted">
                    AI 코치 수업 평가(별도 척도): {perf.lessonAssessments.slice(0, 5).map((a) => `${nm(a.techniqueId)} ${a.understanding ?? '—'}`).join(' · ')}
                  </p>
                )}
              </section>
            </div>

            <section className="card" data-testid="performance-habits">
              <h3>학습 습관 · 복습</h3>
              <p>
                개선된 항목: {perf.improved.length ? perf.improved.map((x) => `${nm(x.techniqueId)} +${x.delta}`).join(', ') : '이 기간 비교 가능한 평가 없음'}
              </p>
              <p>
                반복적으로 낮은 항목: {perf.repeatedlyLow.length ? perf.repeatedlyLow.map((x) => `${nm(x.techniqueId)} (60점 미만 ${x.count}회)`).join(', ') : '없음'}
              </p>
              <p>
                장기간 학습하지 않은 기술: {perf.habits.stale.length ? perf.habits.stale.slice(0, 8).map(nm).join(', ') : '없음'} · 복습 주기 지남: {perf.habits.reviewDue.length}개
              </p>
            </section>

            <section className="card eco-print-area" data-testid="growth-report">
              <h3>
                <Icon name="spark" /> 성장 리포트
              </h3>
              <div className="eco-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void makeReport(true)} data-testid="growth-report-ai">
                  {busy ? '분석 중…' : 'AI 분석 리포트 만들기'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void makeReport(false)}>
                  규칙 기반 리포트
                </button>
              </div>
              <p className="muted">AI는 설정 &gt; AI 엔진(기본: 이 기기의 로컬 AI)으로 실행되며, 아래 기록 사실(F번호)만 근거로 쓰고 근거 번호가 없는 문장은 앱이 지웁니다.</p>
              {report && (
                <div className="eco-report">
                  <p className="muted">
                    분석 기간 {report.period} · {report.source === 'ai' ? 'AI 해석 (근거 인용 확인됨)' : '규칙 기반 해석'}
                  </p>
                  <p>{report.activitySummary}</p>
                  {(
                    [
                      ['주요 개선 사항', report.improvements],
                      ['개선이 필요한 영역', report.needsWork],
                      ['정체 · 확인 필요', report.plateaus],
                      ['앞으로 집중할 영역', report.focus],
                      ['다음 주 추천 학습 목표', report.nextWeek],
                    ] as const
                  ).map(([h, xs]) =>
                    xs.length ? (
                      <div key={h}>
                        <h4>{h}</h4>
                        <ul>
                          {xs.map((x) => (
                            <li key={x.text}>
                              {x.text} <span className="muted">[{x.facts.join(', ')}]</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null
                  )}
                  <details open>
                    <summary>근거 기록 ({report.facts.length})</summary>
                    <ol className="eco-facts">
                      {report.facts.map((f) => (
                        <li key={f.id}>
                          <strong>{f.id}</strong> {f.text.replace(/\b([a-z-]+__[\w-]+)\b/g, (m) => nm(m))} <span className="muted">— {f.basis}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                  {report.notes.map((n) => (
                    <p key={n} className="muted">
                      ※ {n}
                    </p>
                  ))}
                  <div className="eco-actions eco-noprint">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveReportImage(report, title).then((r) => setMsg(r.message))}>
                      이미지로 저장
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={printReport}>
                      PDF로 저장 (인쇄)
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveReportText(reportText(report, title), report.generatedAt.slice(0, 10))}>
                      텍스트로 저장
                    </button>
                  </div>
                  {msg && <p className="muted">{msg}</p>}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
