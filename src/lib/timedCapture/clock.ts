// The recording window on the monotonic clock (performance.now(): never jumps with the wall clock, never
// goes back). The end time is fixed once, when recording starts — UI ticks, slow frames or a late timer
// cannot stretch the window: frames stamped after `endAt` are not part of the capture.

export interface CaptureClock {
  startAt: number;
  endAt: number;
  durationMs: number;
}

export const now = (): number => performance.now();

export function startClock(durationMs: number, at: number = now()): CaptureClock {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new Error('capture duration unknown');
  return { startAt: at, endAt: at + durationMs, durationMs };
}

export function remainingMs(c: CaptureClock, at: number = now()): number {
  return Math.min(c.durationMs, Math.max(0, c.endAt - at));
}

/** 1 at the start → 0 at the end (the gauge drains). */
export function drainFraction(c: CaptureClock, at: number = now()): number {
  return remainingMs(c, at) / c.durationMs;
}

export function inWindow(c: CaptureClock, t: number): boolean {
  return t >= c.startAt && t <= c.endAt;
}

/** Keeps only the samples recorded inside the window (a late stop never adds frames past endAt). */
export function clipToWindow<T extends { timestampMs: number }>(c: CaptureClock, frames: T[]): T[] {
  return frames.filter((f) => inWindow(c, f.timestampMs));
}
