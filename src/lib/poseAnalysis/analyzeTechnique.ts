import type { PoseFrame, PoseAnalysisResult } from './types';
import { getPoseAnalysisConfig } from './poseAnalysisConfig';
import { METRIC_CALCULATORS } from './metrics';
import { classifyScore, isImprovementArea, isStrength } from './scoring';
import { point } from './geometry';

const MIN_USABLE_FRAME_RATIO = 0.5;
const MIN_FRAMES = 8;

export type AnalyzeOutcome =
  | { ok: true; result: PoseAnalysisResult }
  | { ok: false; reason: 'unsupported' }
  | { ok: false; reason: 'no_pose_detected' }
  /** Fewer than 2 metrics could be measured (joints not seen) — no score rather than a made-up one. */
  | { ok: false; reason: 'insufficient_metrics'; unmeasured: string[] };

// A frame only counts as "usable" if the core torso landmarks were
// confidently detected — a frame where the person stepped out of view
// shouldn't silently drag metrics toward a meaningless average.
function isFrameUsable(frame: PoseFrame): boolean {
  return !!(point(frame, 'leftShoulder') && point(frame, 'rightShoulder') && point(frame, 'leftHip') && point(frame, 'rightHip'));
}

export function analyzeTechnique(techniqueId: string, frames: PoseFrame[]): AnalyzeOutcome {
  const config = getPoseAnalysisConfig(techniqueId);
  if (!config?.supported) return { ok: false, reason: 'unsupported' };

  const usable = frames.filter(isFrameUsable);
  if (frames.length < MIN_FRAMES || usable.length / Math.max(1, frames.length) < MIN_USABLE_FRAME_RATIO) {
    return { ok: false, reason: 'no_pose_detected' };
  }

  const metricScores = config.metrics.map((m) => {
    const calculator = METRIC_CALCULATORS[m.id];
    const outcome = calculator ? calculator(usable, m.params ?? {}) : { score: 50, measured: false, detail: '이 지표는 아직 계산 로직이 없습니다.' };
    return { id: m.id, name: m.name, score: outcome.score, detail: outcome.detail, ...(outcome.measured === false ? { measured: false } : {}) };
  });

  // 4차: a metric whose landmarks were not seen returns a placeholder 50 — it used to be averaged
  // into the score (evaluating what was not measured). Only measured metrics count now.
  const measured = metricScores.filter((m) => m.measured !== false);
  if (measured.length < Math.min(2, metricScores.length)) return { ok: false, reason: 'insufficient_metrics', unmeasured: metricScores.filter((m) => m.measured === false).map((m) => m.name) };
  const overallScore = Math.round(measured.reduce((sum, m) => sum + m.score, 0) / measured.length);
  const status = classifyScore(overallScore);

  return {
    ok: true,
    result: {
      techniqueId,
      overallScore,
      status,
      metricScores,
      strengths: measured.filter((m) => isStrength(m.score)).map((m) => m.name),
      improvements: measured.filter((m) => isImprovementArea(m.score)).map((m) => m.name),
      frameCount: usable.length,
    },
  };
}
