import type { MotionClip } from '../motion3d/types';
import type { CameraView, ReferenceVideo } from '../formCompare/types';

// What a pose capture is measured against, and therefore how long it records. Every camera measurement
// (technique tab, AI lesson, 자세 확인, 기준 영상 비교) records for exactly the length of ONE reference:
//   3D clip        → one playback at 1.0x (frameCount / fps, checked against durationSec)
//   reference video → the registered single-technique segment (endSeconds − startSeconds)
// There is no fixed fallback length: a reference whose length is unknown is an error, and a segment too long
// to be one repetition of one technique (a lecture, a combination) is rejected.

export type CaptureAngle = Exclude<CameraView, 'unknown'>;
export const CAPTURE_ANGLES: CaptureAngle[] = ['front', 'diagonal', 'side', 'back'];
export const ANGLE_LABEL: Record<CaptureAngle, string> = { front: '정면', diagonal: '45° 대각선', side: '측면', back: '후면' };

/** Longest segment accepted as "one repetition of one technique" (a jab is ~1–2 s, a spinning kick ~3 s). */
export const MAX_SINGLE_TECHNIQUE_SEC = 8;
export const MIN_SINGLE_TECHNIQUE_SEC = 0.3;

export interface CaptureReference {
  kind: 'motion3d' | 'video';
  /** clipId (motion3d) or the registered reference video's id. */
  id: string;
  techniqueId: string;
  label: string;
  /** Segment inside the reference (seconds). 3D: the whole clip, 0 → duration. */
  segmentStartSec: number;
  segmentEndSec: number;
  /** = the capture length. */
  durationMs: number;
  /** Reference frame rate when known (3D clips; video files are not decoded for it). */
  fps: number | null;
  frameCount: number | null;
  /** Angles the reference can be compared from (3D: any; a video: only the one it was filmed from). */
  angles: CaptureAngle[];
}

export type ReferenceProblem = 'no_reference' | 'unknown_duration' | 'segment_too_long' | 'segment_too_short' | 'not_this_technique';

export type ReferenceOutcome = { ok: true; reference: CaptureReference } | { ok: false; problem: ReferenceProblem; message: string };

const fail = (problem: ReferenceProblem, message: string): ReferenceOutcome => ({ ok: false, problem, message });

function lengthProblem(sec: number, what: string): ReferenceOutcome | null {
  if (!Number.isFinite(sec) || sec <= 0) return fail('unknown_duration', `${what}의 길이를 알 수 없어 촬영 시간을 정할 수 없습니다.`);
  if (sec > MAX_SINGLE_TECHNIQUE_SEC)
    return fail('segment_too_long', `${what}이(가) ${sec.toFixed(1)}초로 기술 한 번의 길이(최대 ${MAX_SINGLE_TECHNIQUE_SEC}초)보다 깁니다. 강의 영상이나 여러 기술이 이어지는 구간은 기준으로 쓸 수 없습니다 — 기술 한 번만 나오는 구간을 지정해 주세요.`);
  if (sec < MIN_SINGLE_TECHNIQUE_SEC) return fail('segment_too_short', `${what}이(가) ${sec.toFixed(2)}초로 너무 짧습니다.`);
  return null;
}

/** 3D clip → one playback at 1.0x. frameCount/fps and durationSec must agree (within one frame). */
export function referenceFromClip(clip: MotionClip, techniqueId: string): ReferenceOutcome {
  const { fps, frameCount, durationSec } = clip;
  if (!(fps > 0) || !(frameCount > 0) || !(durationSec > 0)) return fail('unknown_duration', `3D 시연(${clip.title})의 fps·프레임 수가 없어 촬영 시간을 정할 수 없습니다.`);
  const fromFrames = frameCount / fps;
  if (Math.abs(fromFrames - durationSec) > 1 / fps) return fail('unknown_duration', `3D 시연(${clip.title})의 길이 정보가 서로 맞지 않습니다(${fromFrames.toFixed(3)}초 ≠ ${durationSec}초).`);
  const bad = lengthProblem(durationSec, '3D 시연');
  if (bad) return bad;
  return {
    ok: true,
    reference: { kind: 'motion3d', id: clip.clipId, techniqueId, label: clip.title, segmentStartSec: 0, segmentEndSec: durationSec, durationMs: Math.round(durationSec * 1000), fps, frameCount, angles: clip.captureAngles?.length ? clip.captureAngles : ['front', 'diagonal', 'side', 'back'] },
  };
}

/** A registered reference video (formCompare) → its designated single-technique segment. */
export function referenceFromVideo(ref: ReferenceVideo): ReferenceOutcome {
  if (ref.profile && (!ref.profile.matchesTechnique || !ref.profile.techniqueVisible))
    return fail('not_this_technique', `기준 영상 분석 결과 이 구간은 이 기술이 아닌 것으로 보입니다(${ref.profile.observedTechnique || '판별 불가'}). 다른 구간을 지정해 주세요.`);
  const sec = ref.endSeconds - ref.startSeconds;
  const bad = lengthProblem(sec, '지정한 기준 영상 구간');
  if (bad) return bad;
  const title = ref.source.kind === 'youtube' ? ref.source.title : ref.source.fileName;
  const view = (ref.profile?.cameraView ?? ref.cameraView) as CameraView;
  return {
    ok: true,
    reference: { kind: 'video', id: ref.id, techniqueId: ref.techniqueId, label: title, segmentStartSec: ref.startSeconds, segmentEndSec: ref.endSeconds, durationMs: Math.round(sec * 1000), fps: null, frameCount: null, angles: view === 'unknown' ? [] : [view] },
  };
}

/**
 * The technique tab / lesson measurement: a designated video segment when there is a usable one, otherwise the 3D
 * clip. A video is never required — an unusable or missing video falls back to 3D; with neither, it is an error
 * (with every reason, so the screen can say what to do).
 */
export function chooseCaptureReference(techniqueId: string, opts: { clips: MotionClip[]; videos: ReferenceVideo[]; preferVideoId?: string | null }): { outcome: ReferenceOutcome; rejected: { id: string; problem: ReferenceProblem; message: string }[] } {
  const rejected: { id: string; problem: ReferenceProblem; message: string }[] = [];
  const videos = opts.preferVideoId ? [...opts.videos].sort((a, b) => (a.id === opts.preferVideoId ? -1 : b.id === opts.preferVideoId ? 1 : 0)) : opts.videos;
  for (const v of videos) {
    const r = referenceFromVideo(v);
    if (r.ok) return { outcome: r, rejected };
    rejected.push({ id: v.id, problem: r.problem, message: r.message });
  }
  for (const c of opts.clips) {
    const r = referenceFromClip(c, techniqueId);
    if (r.ok) return { outcome: r, rejected };
    rejected.push({ id: c.clipId, problem: r.problem, message: r.message });
  }
  if (rejected.length) return { outcome: fail(rejected[rejected.length - 1].problem, `사용할 수 있는 기준이 없습니다: ${rejected.map((r) => r.message).join(' / ')}`), rejected };
  return { outcome: fail('no_reference', '이 기술에는 3D 시연도, 기술 한 번 구간이 지정된 기준 영상도 없어 촬영 길이를 정할 수 없습니다. 기준 영상 비교에서 기준 영상의 기술 구간을 지정하면 측정할 수 있습니다.'), rejected };
}

/** What is stored with a measurement about its reference and the actual capture window. */
export interface CaptureRecord {
  referenceKind: CaptureReference['kind'];
  referenceId: string;
  segmentStartSec: number;
  segmentEndSec: number;
  plannedMs: number;
  fps: number | null;
  angle: CaptureAngle | null;
  /** performance.now() (monotonic) at the start and the end of the recording window. */
  startedAtMs: number;
  endedAtMs: number;
  /** How late the stop ran after endAt (a busy main thread delays timers; frames after endAt are excluded anyway). */
  stopLatencyMs: number;
  /** Wall-clock start, for the record only (never used for timing). */
  startedAtIso: string;
}
