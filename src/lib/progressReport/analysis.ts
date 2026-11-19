// 훈련 성과 검증 — 기존 자세 측정 기록(poseAnalysis/recordsService: local-first)만 읽어 기술별 변화를 계산한다.
// 새 측정값을 만들지 않는다. 측정 방식(관절 지표 / 기준 영상 비교 / 3D 기준)이 다르면 점수 척도가 달라
// 서로 비교하지 않고, 방식별로 따로 묶는다. 점수는 "분석 점수의 변화"이며 실제 실력 인증이 아니다.
import type { PoseAnalysisRecord } from '../poseAnalysis/types';
import { getPoseAnalysisConfig } from '../poseAnalysis/poseAnalysisConfig';

export type MeasureMethod = 'landmark' | 'video_compare' | 'reference_3d';
export const METHOD_LABEL: Record<MeasureMethod, string> = {
  landmark: '관절 지표 분석',
  video_compare: '기준 영상 비교',
  reference_3d: '3D 기준 비교',
};

export interface MetricChange {
  metricId: string;
  name: string;
  first: number;
  latest: number;
  delta: number;
  /** times this metric scored below WEAK in this series */
  weakCount: number;
  samples: number;
}

export interface SeriesReport {
  techniqueId: string;
  method: MeasureMethod;
  records: PoseAnalysisRecord[];
  first: PoseAnalysisRecord;
  latest: PoseAnalysisRecord;
  scoreDelta: number;
  /** last ≤5 scores: population standard deviation */
  spread: number | null;
  consistency: 'single' | 'stable' | 'variable' | 'unstable';
  metrics: MetricChange[];
  improved: MetricChange[];
  notImproved: MetricChange[];
  recurringWeak: MetricChange[];
  lowReliabilityShare: number;
  confidence: { level: 'insufficient' | 'low' | 'moderate'; reasons: string[] };
}

export const WEAK = 60;
const MIN_IMPROVE = 5;

export function methodOf(r: PoseAnalysisRecord): MeasureMethod {
  return r.method ?? 'landmark';
}

export function metricName(techniqueId: string, metricId: string): string {
  const cfg = getPoseAnalysisConfig(techniqueId);
  return cfg?.metrics.find((m) => m.id === metricId)?.name ?? metricId;
}

function stddev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export function analyzeSeries(records: PoseAnalysisRecord[], nameOf: (techniqueId: string, metricId: string) => string = metricName): SeriesReport {
  const sorted = [...records].sort((a, b) => a.analyzedAt.localeCompare(b.analyzedAt));
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const recent = sorted.slice(-5).map((r) => r.score);
  const spread = recent.length >= 2 ? Math.round(stddev(recent) * 10) / 10 : null;
  const consistency: SeriesReport['consistency'] = spread === null ? 'single' : spread <= 5 ? 'stable' : spread <= 12 ? 'variable' : 'unstable';

  const ids = new Set<string>();
  for (const r of sorted) for (const k of Object.keys(r.metricScores ?? {})) ids.add(k);
  const metrics: MetricChange[] = [];
  for (const id of ids) {
    const withMetric = sorted.filter((r) => typeof r.metricScores?.[id] === 'number');
    if (!withMetric.length) continue;
    const f = withMetric[0].metricScores[id];
    const l = withMetric[withMetric.length - 1].metricScores[id];
    metrics.push({
      metricId: id,
      name: nameOf(first.techniqueId, id),
      first: f,
      latest: l,
      delta: Math.round((l - f) * 10) / 10,
      weakCount: withMetric.filter((r) => r.metricScores[id] < WEAK).length,
      samples: withMetric.length,
    });
  }
  const multi = metrics.filter((m) => m.samples >= 2);
  const improved = multi.filter((m) => m.delta >= MIN_IMPROVE).sort((a, b) => b.delta - a.delta);
  const notImproved = multi.filter((m) => m.delta < MIN_IMPROVE).sort((a, b) => a.delta - b.delta);
  const recurringWeak = metrics.filter((m) => m.samples >= 2 && m.weakCount >= 2 && m.weakCount / m.samples >= 0.5).sort((a, b) => b.weakCount - a.weakCount);

  const low = sorted.filter((r) => r.reliability === 'low').length;
  const reasons: string[] = [];
  if (sorted.length < 2) reasons.push('측정이 1회뿐이라 변화를 판단할 수 없습니다.');
  else if (sorted.length < 4) reasons.push(`측정 ${sorted.length}회 — 변화는 참고용입니다.`);
  if (low) reasons.push(`${low}회는 측정 신뢰도가 낮았습니다 (자세가 잘 보이지 않았거나 촬영 조건 차이).`);
  if (consistency === 'unstable') reasons.push('최근 점수 편차가 커서 촬영 조건(각도·거리·조명)의 영향일 수 있습니다.');
  const level: SeriesReport['confidence']['level'] = sorted.length < 2 ? 'insufficient' : sorted.length < 4 || low / sorted.length > 0.3 || consistency === 'unstable' ? 'low' : 'moderate';

  return {
    techniqueId: first.techniqueId,
    method: methodOf(first),
    records: sorted,
    first,
    latest,
    scoreDelta: Math.round((latest.score - first.score) * 10) / 10,
    spread,
    consistency,
    metrics,
    improved,
    notImproved,
    recurringWeak,
    lowReliabilityShare: sorted.length ? low / sorted.length : 0,
    confidence: { level, reasons },
  };
}

/** technique × method 별 시리즈. 서로 다른 측정 방식은 섞지 않는다. */
export function buildSeries(records: PoseAnalysisRecord[], nameOf?: (techniqueId: string, metricId: string) => string): SeriesReport[] {
  const groups = new Map<string, PoseAnalysisRecord[]>();
  for (const r of records) {
    const key = `${r.techniqueId}::${methodOf(r)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((g) => analyzeSeries(g, nameOf)).sort((a, b) => b.latest.analyzedAt.localeCompare(a.latest.analyzedAt));
}

export interface PeriodSummary {
  days: number;
  measurements: number;
  techniques: number;
  /** series that have ≥2 measurements inside the window: their first→last delta */
  changes: { techniqueId: string; method: MeasureMethod; delta: number; samples: number }[];
  improvedCount: number;
  declinedCount: number;
}

export function periodSummary(records: PoseAnalysisRecord[], days: number, now = Date.now()): PeriodSummary {
  const since = now - days * 86400000;
  const inWindow = records.filter((r) => new Date(r.analyzedAt).getTime() >= since);
  const series = buildSeries(inWindow, (_t, m) => m).filter((s) => s.records.length >= 2);
  const changes = series.map((s) => ({ techniqueId: s.techniqueId, method: s.method, delta: s.scoreDelta, samples: s.records.length }));
  return {
    days,
    measurements: inWindow.length,
    techniques: new Set(inWindow.map((r) => r.techniqueId)).size,
    changes,
    improvedCount: changes.filter((c) => c.delta >= MIN_IMPROVE).length,
    declinedCount: changes.filter((c) => c.delta <= -MIN_IMPROVE).length,
  };
}

export const CONSISTENCY_LABEL: Record<SeriesReport['consistency'], string> = {
  single: '측정 1회',
  stable: '일관됨 (편차 ±5 이내)',
  variable: '다소 들쭉날쭉 (편차 ±12 이내)',
  unstable: '불안정 (편차 큼)',
};
export const CONFIDENCE_LABEL: Record<SeriesReport['confidence']['level'], string> = {
  insufficient: '판단 불가',
  low: '신뢰도 낮음',
  moderate: '참고 가능',
};
