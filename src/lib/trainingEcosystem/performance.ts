// 훈련 성과 분석 (사양 §3) — deterministic numbers from the records the app actually keeps. The AI never computes these;
// it only interprets them (growthReport.ts), and every number here can be traced back to records with dates.
//
// Rules carried from the spec:
// - scores of different evaluation methods are never averaged together (pose landmark / reference video / 3D reference
//   are separate series — progressReport.buildSeries; AI-coach lesson assessments are a separate kind again);
// - a metric with no data says so (null / empty list) instead of showing 0;
// - nothing here claims speed, power or reaction time — the app does not measure them.

import type { TrainingHistoryEntry } from '../trainingHistory/types';
import type { PoseAnalysisRecord } from '../poseAnalysis/types';
import type { LessonLogEntry } from '../coachLesson/lessonLog';
import type { PeriodKey } from '../statsHub/types';
import { buildSeries, METHOD_LABEL, type SeriesReport } from '../progressReport/analysis';
import { ECO_STATE_LABEL, stateCounts, type EcoState, type TechniqueState } from './learningState';
import { currentStage, stageProgress, type PersonalCurriculum } from './personalCurriculum';

export const PERIOD_DAYS_ALL: Record<PeriodKey, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

export interface PerformanceInputs {
  period: PeriodKey;
  now?: Date;
  entries: TrainingHistoryEntry[];
  poseRecords: PoseAnalysisRecord[];
  lessonLogs: LessonLogEntry[];
  states: Map<string, TechniqueState>;
  plan: PersonalCurriculum | null;
  /** Free-text goals set (scope + text) — achievement is not recorded for them. */
  goals: { scope: string; text: string; updatedAt: string }[];
  artOfEntry: (e: TrainingHistoryEntry) => string | null;
  artName: (art: string) => string;
}

export interface Fact {
  id: string;
  text: string;
  /** What the fact rests on: store + record ids / dates, shown with the report. */
  basis: string;
}

export interface WeekBucket {
  weekStart: string;
  minutes: number;
  sessions: number;
}

export interface Performance {
  range: { start: string | null; end: string; label: string };
  hasAnyData: boolean;
  activity: { sessions: number; minutes: number; trainingDays: number; previous: { sessions: number; minutes: number } | null };
  techniques: { counts: Record<EcoState, number>; touched: number; done: number; verified: number; evaluationMissing: number };
  curriculum: null | { goal: string; total: number; done: number; ratio: number; currentStage: number | null; stages: { title: string; done: number; total: number; passed: boolean }[]; weeksMet: number; weeksTracked: number };
  freeGoals: { count: number; note: string };
  weekly: WeekBucket[];
  perArt: { art: string; name: string; minutes: number; sessions: number; counts: Record<EcoState, number> }[];
  series: SeriesReport[];
  improved: { techniqueId: string; method: string; delta: number; from: number; to: number; dates: [string, string] }[];
  repeatedlyLow: { techniqueId: string; method: string; latest: number; count: number }[];
  lessonAssessments: { techniqueId: string; understanding: number | null; date: string; method: string }[];
  notEvaluated: string[];
  habits: { daysPerWeek: number | null; longestGapDays: number | null; lastTrained: string | null; stale: string[]; reviewDue: string[] };
  facts: Fact[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const weekStartOf = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = (d.getDay() + 6) % 7;
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - day));
};
const minutesOf = (e: TrainingHistoryEntry) => e.actualMinutes ?? e.estimatedMinutes ?? 0;

export function computePerformance(inp: PerformanceInputs): Performance {
  const now = inp.now ?? new Date();
  const days = PERIOD_DAYS_ALL[inp.period];
  const start = days ? new Date(now.getTime() - days * 86400000) : null;
  const inRange = (dateStr: string) => !start || new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr).getTime() >= start.getTime();
  const entries = inp.entries.filter((e) => e.completed !== false && inRange(e.date));
  const prevStart = days ? new Date(now.getTime() - 2 * days * 86400000) : null;
  const prev = days ? inp.entries.filter((e) => e.completed !== false && new Date(`${e.date}T00:00:00`).getTime() >= prevStart!.getTime() && new Date(`${e.date}T00:00:00`).getTime() < start!.getTime()) : null;
  const poses = inp.poseRecords.filter((r) => inRange(r.analyzedAt));
  const lessons = inp.lessonLogs.filter((l) => inRange(l.date));

  const sessions = entries.length;
  const minutes = entries.reduce((n, e) => n + minutesOf(e), 0);
  const dayset = [...new Set(entries.map((e) => e.date))].sort();

  // techniques the learner has any record on (states are current — a snapshot, not period-filtered)
  const touchedStates = [...inp.states.values()].filter((s) => s.state !== 'not_started');
  const counts = stateCounts(touchedStates);
  const done = counts.completed + counts.verified;

  // weekly buckets (last 13 weeks at most, within the period)
  const wk = new Map<string, WeekBucket>();
  for (const e of entries) {
    const k = weekStartOf(e.date);
    const b = wk.get(k) ?? { weekStart: k, minutes: 0, sessions: 0 };
    b.minutes += minutesOf(e);
    b.sessions++;
    wk.set(k, b);
  }
  const weekly = [...wk.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-13);

  // per art
  const artMap = new Map<string, { minutes: number; sessions: number; counts: Record<EcoState, number> }>();
  const blank = (): Record<EcoState, number> => ({ not_started: 0, learning: 0, completed: 0, needs_repeat: 0, needs_evaluation: 0, verified: 0 });
  for (const e of entries) {
    const a = inp.artOfEntry(e);
    if (!a) continue;
    const x = artMap.get(a) ?? { minutes: 0, sessions: 0, counts: blank() };
    x.minutes += minutesOf(e);
    x.sessions++;
    artMap.set(a, x);
  }
  for (const s of touchedStates) {
    const a = s.technique.martialArt;
    const x = artMap.get(a) ?? { minutes: 0, sessions: 0, counts: blank() };
    x.counts[s.state]++;
    artMap.set(a, x);
  }
  const perArt = [...artMap.entries()].map(([art, v]) => ({ art, name: inp.artName(art), ...v })).sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions);

  // evaluation series — one per technique × method, never mixed
  const series = buildSeries(poses);
  const improved = series
    .filter((s) => s.records.length >= 2 && s.scoreDelta >= 5)
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, 5)
    .map((s) => ({ techniqueId: s.techniqueId, method: METHOD_LABEL[s.method], delta: Math.round(s.scoreDelta), from: Math.round(s.first.score), to: Math.round(s.latest.score), dates: [s.first.analyzedAt.slice(0, 10), s.latest.analyzedAt.slice(0, 10)] as [string, string] }));
  const repeatedlyLow = series
    .filter((s) => s.records.filter((r) => r.score < 60).length >= 2)
    .map((s) => ({ techniqueId: s.techniqueId, method: METHOD_LABEL[s.method], latest: Math.round(s.latest.score), count: s.records.filter((r) => r.score < 60).length }))
    .slice(0, 5);
  const lessonAssessments = lessons
    .flatMap((l) => (l.assessment?.items ?? []).map((it) => ({ techniqueId: it.techniqueId, understanding: it.understandingScore ?? null, date: l.date, method: l.assessment?.method === 'ai' ? 'AI 수업 평가' : '규칙 기반 수업 평가' })))
    .slice(0, 20);
  const notEvaluated = touchedStates.filter((s) => s.evaluationMissing && s.practiceCount > 0).map((s) => s.techniqueId);

  // habits
  let longestGap: number | null = null;
  for (let i = 1; i < dayset.length; i++) {
    const g = Math.round((new Date(`${dayset[i]}T00:00:00`).getTime() - new Date(`${dayset[i - 1]}T00:00:00`).getTime()) / 86400000) - 1;
    longestGap = Math.max(longestGap ?? 0, g);
  }
  const spanDays = days ?? (dayset.length ? Math.max(1, Math.round((now.getTime() - new Date(`${dayset[0]}T00:00:00`).getTime()) / 86400000)) : null);
  const daysPerWeek = spanDays && dayset.length ? Math.round((dayset.length / (spanDays / 7)) * 10) / 10 : null;
  const stale = touchedStates.filter((s) => (s.state === 'needs_repeat' || s.state === 'completed' || s.state === 'verified') && s.idleDays !== null && s.idleDays >= 21).map((s) => s.techniqueId);
  const reviewDue = touchedStates.filter((s) => s.reviewDue).map((s) => s.techniqueId);

  // curriculum progress
  let curriculum: Performance['curriculum'] = null;
  if (inp.plan) {
    const p = inp.plan;
    const total = p.items.length;
    const doneItems = p.items.filter((i) => {
      const s = inp.states.get(i.techniqueId);
      return s && (s.state === 'completed' || s.state === 'verified');
    }).length;
    const weeks = new Map<string, number>();
    for (const i of p.items) if (i.doneAt) weeks.set(weekStartOf(i.doneAt.slice(0, 10)), (weeks.get(weekStartOf(i.doneAt.slice(0, 10))) ?? 0) + 1);
    const created = weekStartOf(p.createdAt.slice(0, 10));
    const weeksTracked = Math.max(1, Math.floor((now.getTime() - new Date(`${created}T00:00:00`).getTime()) / (7 * 86400000)) + 1);
    curriculum = {
      goal: p.goal.label,
      total,
      done: doneItems,
      ratio: total ? doneItems / total : 0,
      currentStage: currentStage(p, inp.states),
      stages: p.stages.map((s) => ({ title: s.title, ...stageProgress(p, s.index, inp.states) })),
      weeksMet: [...weeks.values()].filter((n) => n >= p.weeklyTarget).length,
      weeksTracked,
    };
  }
  const freeGoals = { count: inp.goals.filter((g) => g.text.trim() && inRange(g.updatedAt)).length, note: '개인 목표(주·월·연)는 글로만 저장되어 달성 여부 기록이 없습니다 — 달성률은 커리큘럼 단계·주간 목표로만 계산합니다.' };

  const hasAnyData = sessions > 0 || poses.length > 0 || lessons.length > 0 || touchedStates.length > 0;

  // facts — numbered, each with its basis, for the AI report to cite
  const facts: Fact[] = [];
  const f = (text: string, basis: string) => facts.push({ id: `F${facts.length + 1}`, text, basis });
  const label = start ? `${iso(start)} ~ ${iso(now)}` : `전체 기간 ~ ${iso(now)}`;
  f(`기간 내 훈련 ${sessions}회, ${minutes}분, 훈련한 날 ${dayset.length}일`, `훈련 기록 ${sessions}건 (${dayset[0] ?? '-'} ~ ${dayset[dayset.length - 1] ?? '-'})`);
  if (prev) f(`직전 같은 기간 대비 훈련 ${prev.length}회 → ${sessions}회, ${prev.reduce((n, e) => n + minutesOf(e), 0)}분 → ${minutes}분`, '훈련 기록 (직전 기간 비교)');
  f(`기록이 있는 기술 ${touchedStates.length}개 중 학습 완료 ${counts.completed}개, 숙련도 확인 완료 ${counts.verified}개, 반복 학습 필요 ${counts.needs_repeat}개, 평가 필요 ${counts.needs_evaluation}개`, '기술별 학습 상태 (자세 측정·수업 평가·훈련 기록에서 계산, 현재 시점)');
  for (const x of improved) f(`${x.techniqueId}: ${x.method} 점수 ${x.from} → ${x.to} (${x.delta >= 0 ? '+' : ''}${x.delta})`, `자세 측정 기록 ${x.dates[0]} · ${x.dates[1]}`);
  for (const x of repeatedlyLow) f(`${x.techniqueId}: ${x.method}에서 60점 미만 ${x.count}회 (최근 ${x.latest}점)`, '자세 측정 기록');
  if (notEvaluated.length) f(`연습했지만 평가 기록이 없는 기술 ${notEvaluated.length}개 (${notEvaluated.slice(0, 5).join(', ')})`, '훈련 기록 + 평가 기록 없음');
  if (stale.length) f(`21일 이상 연습 기록이 없는 학습 기술 ${stale.length}개 (${stale.slice(0, 5).join(', ')})`, '마지막 연습·측정 날짜');
  if (longestGap !== null) f(`가장 긴 훈련 공백 ${longestGap}일`, '훈련한 날짜 사이 간격');
  if (curriculum) f(`커리큘럼 "${curriculum.goal}" ${curriculum.done}/${curriculum.total} 기술 학습 완료, 주간 목표 달성 ${curriculum.weeksMet}/${curriculum.weeksTracked}주`, '나의 학습 커리큘럼 (항목별 처음 완료가 관찰된 날짜)');
  for (const a of lessonAssessments.slice(0, 5)) if (a.understanding !== null) f(`${a.techniqueId}: ${a.method} 이해도 ${a.understanding}`, `AI 코치 수업 기록 ${a.date}`);
  return {
    range: { start: start ? iso(start) : null, end: iso(now), label },
    hasAnyData,
    activity: { sessions, minutes, trainingDays: dayset.length, previous: prev ? { sessions: prev.length, minutes: prev.reduce((n, e) => n + minutesOf(e), 0) } : null },
    techniques: { counts, touched: touchedStates.length, done, verified: counts.verified, evaluationMissing: touchedStates.filter((s) => s.evaluationMissing).length },
    curriculum,
    freeGoals,
    weekly,
    perArt,
    series,
    improved,
    repeatedlyLow,
    lessonAssessments,
    notEvaluated,
    habits: { daysPerWeek, longestGapDays: longestGap, lastTrained: dayset[dayset.length - 1] ?? null, stale, reviewDue },
    facts,
  };
}

export { ECO_STATE_LABEL };
