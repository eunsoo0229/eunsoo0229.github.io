import type { MotionPhase } from './types';

// Clip-time math for the viewer. Everything is in CLIP seconds: playback speed only changes how fast clip time
// advances (real seconds = clip seconds / speed), never the clip's length, frame count or phase boundaries.

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function clampTime(t: number, durationSec: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(Math.max(t, 0), durationSec);
}

/** Advance clip time by `realDeltaSec` at `speed`, looping back to 0 after the end. */
export function advance(t: number, realDeltaSec: number, speed: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  const next = t + Math.max(0, realDeltaSec) * speed;
  return next >= durationSec ? next % durationSec : next;
}

export function frameAt(t: number, fps: number, frameCount: number): number {
  return Math.min(Math.max(Math.round(t * fps), 0), frameCount);
}

export function timeOfFrame(frame: number, fps: number, durationSec: number): number {
  return clampTime(frame / fps, durationSec);
}

/** One frame forward/back from the frame nearest `t` (clamped to the clip). */
export function stepFrame(t: number, delta: number, fps: number, frameCount: number, durationSec: number): number {
  return timeOfFrame(frameAt(t, fps, frameCount) + delta, fps, durationSec);
}

export function phaseAt(t: number, phases: MotionPhase[]): MotionPhase | null {
  return phases.find((p, i) => t >= p.startSec && (t < p.endSec || (i === phases.length - 1 && t <= p.endSec))) ?? null;
}

/** Real playback seconds for the whole clip at `speed`. */
export function realDuration(durationSec: number, speed: number): number {
  return speed > 0 ? durationSec / speed : Infinity;
}
