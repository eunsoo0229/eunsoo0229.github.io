import { useCallback, useEffect, useRef, useState } from 'react';
import { now, remainingMs, startClock, type CaptureClock } from './clock';

// Countdown 3-2-1 → a recording window exactly `durationMs` long → automatic stop. Shared by every camera
// measurement. Deadlines are absolute monotonic times; one timer per deadline does the transition, and a
// short UI tick only redraws the numbers / gauge — it never decides when recording ends.

export type TimedPhase = 'idle' | 'countdown' | 'recording' | 'done';
export const COUNTDOWN_SEC = 3;
const UI_TICK_MS = 50;

export interface TimedCapture {
  phase: TimedPhase;
  /** 3, 2, 1 during the countdown. */
  countdownLeft: number;
  /** Remaining ms of the recording window (the gauge). */
  remainingMs: number;
  durationMs: number;
  /** Live while recording, kept after the stop (the window that was recorded). */
  clockRef: React.MutableRefObject<CaptureClock | null>;
  /** true only inside the recording window — the frame loop checks it per frame. */
  recordingRef: React.MutableRefObject<boolean>;
  start: () => void;
  /** Stops the countdown or the recording without a result. */
  cancel: () => void;
  reset: () => void;
}

export function useTimedCapture(opts: { durationMs: number; countdownSec?: number; onRecordStart?: (c: CaptureClock) => void; onRecordEnd: (c: CaptureClock, stoppedAt: number) => void; onCancel?: () => void }): TimedCapture {
  const countdownSec = opts.countdownSec ?? COUNTDOWN_SEC;
  const [phase, setPhase] = useState<TimedPhase>('idle');
  const [countdownLeft, setCountdownLeft] = useState(countdownSec);
  const [left, setLeft] = useState(opts.durationMs);
  const clockRef = useRef<CaptureClock | null>(null);
  const recordingRef = useRef(false);
  const timers = useRef<{ deadline: number | null; tick: number | null }>({ deadline: null, tick: null });
  const cbs = useRef(opts);
  cbs.current = opts;

  const clearTimers = useCallback(() => {
    if (timers.current.deadline !== null) window.clearTimeout(timers.current.deadline);
    if (timers.current.tick !== null) window.clearInterval(timers.current.tick);
    timers.current = { deadline: null, tick: null };
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const finish = useCallback(() => {
    if (!recordingRef.current || !clockRef.current) return;
    recordingRef.current = false;
    const stoppedAt = now();
    clearTimers();
    setLeft(0);
    setPhase('done');
    cbs.current.onRecordEnd(clockRef.current, stoppedAt);
  }, [clearTimers]);

  const beginRecording = useCallback(() => {
    clearTimers();
    const clock = startClock(cbs.current.durationMs);
    clockRef.current = clock;
    recordingRef.current = true;
    setLeft(clock.durationMs);
    setPhase('recording');
    cbs.current.onRecordStart?.(clock);
    timers.current.deadline = window.setTimeout(finish, clock.durationMs);
    timers.current.tick = window.setInterval(() => {
      const c = clockRef.current;
      if (!c) return;
      const r = remainingMs(c);
      setLeft(r);
      if (r <= 0) finish(); // the deadline timer was late (throttled tab): stop on the first tick past endAt
    }, UI_TICK_MS);
  }, [clearTimers, finish]);

  const start = useCallback(() => {
    if (!(cbs.current.durationMs > 0)) throw new Error('capture duration unknown');
    clearTimers();
    clockRef.current = null;
    const endAt = now() + countdownSec * 1000;
    setCountdownLeft(countdownSec);
    setLeft(cbs.current.durationMs);
    setPhase('countdown');
    timers.current.deadline = window.setTimeout(beginRecording, countdownSec * 1000);
    timers.current.tick = window.setInterval(() => setCountdownLeft(Math.max(1, Math.ceil((endAt - now()) / 1000))), UI_TICK_MS);
  }, [beginRecording, clearTimers, countdownSec]);

  const cancel = useCallback(() => {
    clearTimers();
    recordingRef.current = false;
    clockRef.current = null;
    setPhase('idle');
    setLeft(cbs.current.durationMs);
    cbs.current.onCancel?.();
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    recordingRef.current = false;
    setPhase('idle');
    setLeft(cbs.current.durationMs);
  }, [clearTimers]);

  return { phase, countdownLeft, remainingMs: left, durationMs: opts.durationMs, clockRef, recordingRef, start, cancel, reset };
}
