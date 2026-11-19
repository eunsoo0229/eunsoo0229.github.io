import type { Technique } from '../../types';
import { parseYoutubeVideoId } from '../techniqueVideo/urlVerification';
import { videoInfoProvider } from '../videoSearch/provider';
import { poseRecordsRepository } from '../poseAnalysis/recordsRepository';
import { classifyScore } from '../poseAnalysis/scoring';
import type { PoseAnalysisRecord } from '../poseAnalysis/types';
import { buildReferenceProfile, frameParts, judgeAttempt, referenceMediaParts } from './ai';
import { compositePair, cropToPerson, poseAt, sampleVideoBlob } from './clipCapture';
import { alignTimes, alignTimesFromUser, blockingIssues, extremeMs, linearTimes, pickFrames, poseDifferences, VIEW_LABEL } from './motion';
import { ANGLE_NAME, combineViewCheck, localViewRelation, referenceAngle } from './captureAngle';
import { motionClipsFor } from '../motion3d/catalog';
import type { ClipSignals } from './types';
import type { AiMediaPart } from '../ai/types';
import { getMedia, getReference, MAX_STORED_FILE_BYTES, newId, putMedia, saveCompareRecord, saveReference } from './referenceStore';
import { scoreComparison } from './scoring';
import { hasLocalMedia, type AlignmentInfo, type CameraView, type CaptureIssue, type ClipFrame, type ComparisonJudgement, type FormCompareRecord, type PreparedClip, type ReferenceProfile, type ReferenceVideo } from './types';
import { CAPTURE_ISSUE_LABEL } from './types';
import { MAX_SINGLE_TECHNIQUE_SEC } from '../timedCapture/reference';

// 기준 영상 비교 자세 평가 — orchestration.
//   register (YouTube URL → checked playable, or a video file) → profile
//   (auto criteria) → capture → align → AI judgement → score → records.

// one repetition of one technique: the camera capture records exactly this long (timedCapture/reference.ts), so a
// lecture or a combination segment cannot be a reference
export const MAX_REFERENCE_SECONDS = MAX_SINGLE_TECHNIQUE_SEC;

type Fail = { ok: false; message: string };

// ---------------------------------------------------------------- registering a reference

export async function checkYoutubeReference(url: string): Promise<{ ok: true; videoId: string; title: string; channel: string; lengthSeconds: number } | Fail> {
  const videoId = parseYoutubeVideoId(url);
  if (!videoId) return { ok: false, message: '올바른 YouTube 영상 주소가 아닙니다. (예: https://www.youtube.com/watch?v=...)' };
  const info = await videoInfoProvider.get(videoId);
  if (!info.ok) return { ok: false, message: `영상 정보를 확인하지 못했습니다: ${info.message}` };
  if (!info.info.playable) return { ok: false, message: '재생할 수 없는 영상입니다(비공개·삭제·연령 제한·지역 제한 등). 다른 영상을 선택해 주세요.' };
  return { ok: true, videoId, title: info.info.title, channel: info.info.channel, lengthSeconds: info.info.lengthSeconds };
}

function checkRange(start: number, end: number, length: number): string | null {
  if (!(start >= 0) || !(end > start)) return '기술이 나오는 구간의 시작·끝 시간을 확인해 주세요 (끝이 시작보다 뒤여야 합니다).';
  if (length > 0 && end > length + 0.5) return `영상 길이(${Math.round(length)}초)보다 긴 구간입니다.`;
  if (end - start < 1) return '구간이 너무 짧습니다 (1초 이상).';
  if (end - start > MAX_REFERENCE_SECONDS) return `구간은 ${MAX_REFERENCE_SECONDS}초 이하로 지정해 주세요 — 강의나 여러 기술이 이어지는 구간이 아니라 기술 한 번이 보이는 부분만 골라 주세요. 카메라 촬영은 이 구간과 같은 길이로 진행됩니다.`;
  return null;
}

export async function registerYoutubeReference(t: Technique, input: { url: string; startSeconds: number; endSeconds: number; cameraView: CameraView; replaceId?: string | null }): Promise<{ ok: true; reference: ReferenceVideo } | Fail> {
  const check = await checkYoutubeReference(input.url);
  if (!check.ok) return check;
  const bad = checkRange(input.startSeconds, input.endSeconds, check.lengthSeconds);
  if (bad) return { ok: false, message: bad };
  const now = new Date().toISOString();
  const prev = input.replaceId ? getReference(input.replaceId) : null;
  const ref: ReferenceVideo = {
    id: prev?.id ?? newId('ref'),
    techniqueId: t.id,
    martialArt: t.martialArt,
    source: { kind: 'youtube', videoId: check.videoId, url: `https://www.youtube.com/watch?v=${check.videoId}`, title: check.title, channel: check.channel, lengthSeconds: check.lengthSeconds },
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    cameraView: input.cameraView,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    profile: null,
    hasLocalMedia: false,
  };
  return { ok: true, reference: saveReference(ref) };
}

/** A video file the user may use. Poses/frames are extracted locally; the file itself is kept on this device only (≤ 40 MB). */
export async function registerFileReference(
  t: Technique,
  input: { file: File; startSeconds: number; endSeconds: number; cameraView: CameraView; replaceId?: string | null; onProgress?: (done: number, total: number) => void }
): Promise<{ ok: true; reference: ReferenceVideo } | Fail> {
  if (!/^video\//.test(input.file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(input.file.name)) return { ok: false, message: '영상 파일(MP4, WebM, MOV)을 선택해 주세요.' };
  let sampled: Awaited<ReturnType<typeof sampleVideoBlob>>;
  try {
    sampled = await sampleVideoBlob(input.file, { fps: 12, startSeconds: input.startSeconds, endSeconds: input.endSeconds, onProgress: input.onProgress });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '영상을 분석하지 못했습니다.' };
  }
  const bad = checkRange(input.startSeconds, Math.min(input.endSeconds, sampled.durationSeconds || input.endSeconds), sampled.durationSeconds);
  if (bad) return { ok: false, message: bad };
  const block = blockingIssues(sampled.signals);
  if (block.length) return { ok: false, message: `기준 영상으로 쓸 수 없습니다: ${block.map((i) => CAPTURE_ISSUE_LABEL[i]).join(' ')}` };
  const now = new Date().toISOString();
  const prev = input.replaceId ? getReference(input.replaceId) : null;
  const id = prev?.id ?? newId('ref');
  await putMedia({ id, frames: sampled.frames, poses: sampled.poses, signals: sampled.signals, file: input.file.size <= MAX_STORED_FILE_BYTES ? input.file : null });
  const ref: ReferenceVideo = {
    id,
    techniqueId: t.id,
    martialArt: t.martialArt,
    source: { kind: 'file', fileName: input.file.name, mimeType: input.file.type || 'video/mp4', sizeBytes: input.file.size, durationSeconds: sampled.durationSeconds },
    startSeconds: input.startSeconds,
    endSeconds: Math.min(input.endSeconds, sampled.durationSeconds || input.endSeconds),
    cameraView: input.cameraView === 'unknown' ? sampled.signals.cameraView : input.cameraView,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    profile: null,
    hasLocalMedia: true,
  };
  return { ok: true, reference: saveReference(ref) };
}

/**
 * Registers a recording of the app's own 3D preview as a reference video.
 *
 * It deliberately goes through the SAME body as registerFileReference() —
 * sampleVideoBlob → frames/poses/signals → putMedia → saveReference — so the
 * comparison afterwards is the ordinary video pipeline, not a second scoring
 * path. The only difference is the stored `source`, which keeps the clip id and
 * camera angle so the reference can be regenerated and told apart in the UI.
 */
/**
 * Where the motion sits inside a 3D-preview recording, when pose estimation could not find it.
 *
 * MediaPipe often finds no movement on the rendered mannequin (measured, Phase 6: 3 of 3
 * diagonal recordings → no segment). The keyframes for the criteria are then spread evenly
 * over the whole file, and the ~0.25s in which the arm is extended was sometimes not among
 * them at all — Gemini then saw only a guard stance ("not a jab"), depending on chance.
 *
 * For a 3D recording the position is known instead: the recorder holds the first frame until
 * the encoder runs and then plays the clip once in real time, so the file is the idle lead-in
 * followed by exactly the clip (measured: lead-in ≈ file length − clip length, e.g.
 * 1636 − 1200 = 436ms, matching where the extension appears). The peak is the end of the
 * clip's "execute" phase. Returns null when the file length is unknown.
 */
export function motion3dSegment(fileSeconds: number, clipSeconds: number, phases: { name: string; startSec: number; endSec: number }[] = []): { startMs: number; endMs: number; peakMs: number } | null {
  if (!(fileSeconds > 0) || !(clipSeconds > 0)) return null;
  const leadMs = Math.max(0, (fileSeconds - clipSeconds) * 1000);
  const clipMs = clipSeconds * 1000;
  const execute = phases.find((p) => p.name === 'execute');
  const peakInClip = execute ? execute.endSec * 1000 : clipMs / 2;
  return { startMs: Math.round(leadMs), endMs: Math.round(Math.min(fileSeconds * 1000, leadMs + clipMs)), peakMs: Math.round(leadMs + Math.min(peakInClip, clipMs)) };
}

export async function registerMotion3dReference(
  t: Technique,
  input: {
    file: File;
    clipId: string;
    angle: string;
    cameraView: CameraView;
    /** Length the engine played, for the record (the file's own length is measured here). */
    clipDurationSeconds: number;
    replaceId?: string | null;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<{ ok: true; reference: ReferenceVideo } | Fail> {
  let sampled: Awaited<ReturnType<typeof sampleVideoBlob>>;
  try {
    sampled = await sampleVideoBlob(input.file, { fps: 12, startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY, onProgress: input.onProgress });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '녹화한 3D 영상을 분석하지 못했습니다.' };
  }
  if (!sampled.frames.length) return { ok: false, message: '녹화한 3D 영상에서 프레임을 읽지 못했습니다. 다시 녹화해 주세요.' };
  // The 3D preview is a rendered character, so the capture checks that exist for
  // a filmed reference (lighting, framing) are not applied; a blocking issue here
  // would mean the render itself is unusable.
  const now = new Date().toISOString();
  const prev = input.replaceId ? getReference(input.replaceId) : null;
  const id = prev?.id ?? newId('ref');
  const durationSeconds = sampled.durationSeconds || input.clipDurationSeconds;
  // Pose estimation found no motion segment on the rendered character → use the known one.
  let signals: ClipSignals = sampled.signals;
  if (!signals.segment) {
    const clip = motionClipsFor(t.id).find((c) => c.clipId === input.clipId);
    const seg = motion3dSegment(sampled.durationSeconds, input.clipDurationSeconds, clip?.phases ?? []);
    if (seg) signals = { ...signals, segment: seg, issues: signals.issues.filter((i) => i !== 'no_movement') };
  }
  await putMedia({
    id,
    frames: sampled.frames,
    poses: sampled.poses,
    signals,
    // Always keep the recording itself: it is small, and without it the reference
    // cannot be replayed or re-profiled after a reload.
    file: input.file.size <= MAX_STORED_FILE_BYTES ? input.file : null,
  });
  const ref: ReferenceVideo = {
    id,
    techniqueId: t.id,
    martialArt: t.martialArt,
    source: {
      kind: 'motion3d',
      clipId: input.clipId,
      angle: input.angle,
      fileName: input.file.name,
      mimeType: input.file.type || 'video/webm',
      sizeBytes: input.file.size,
      durationSeconds,
      clipDurationSeconds: input.clipDurationSeconds,
      recordedAt: now,
    },
    startSeconds: 0,
    endSeconds: durationSeconds,
    cameraView: input.cameraView,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    profile: null,
    hasLocalMedia: true,
  };
  return { ok: true, reference: saveReference(ref) };
}

/** Keyframes of a file reference used to build its criteria: the start posture + evenly through the performed segment + the finish. */
function profileFrames(frames: ClipFrame[], seg: { startMs: number; endMs: number } | null): ClipFrame[] {
  if (!frames.length) return [];
  const s = seg ?? { startMs: frames[0].tMs, endMs: frames[frames.length - 1].tMs };
  const times = [Math.max(frames[0].tMs, s.startMs - 300), ...linearTimes(s, [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]), Math.min(frames[frames.length - 1].tMs, s.endMs + 300)];
  return pickFrames(frames, times);
}

/** Builds (or rebuilds) the evaluation criteria from the reference video itself. */
export async function ensureProfile(t: Technique, ref: ReferenceVideo, force = false): Promise<{ ok: true; reference: ReferenceVideo } | Fail> {
  if (ref.profile && !force) return { ok: true, reference: ref };
  let frames: ClipFrame[] | null = null;
  if (hasLocalMedia(ref.source)) {
    const media = await getMedia(ref.id);
    if (!media) return { ok: false, message: '이 기기에 기준 영상 데이터가 없습니다. 영상 파일을 다시 등록해 주세요.' };
    frames = await cropToPerson(profileFrames(media.frames, media.signals.segment), media.poses, media.signals.segment);
  }
  const built = await buildReferenceProfile(t, ref, frames);
  if (!built.ok) return built;
  if (!built.profile.techniqueVisible || built.profile.criteria.length < 2) return { ok: false, message: '기준 영상에서 이 기술의 동작을 충분히 확인하지 못해 평가 기준을 만들 수 없었습니다. 기술이 잘 보이는 구간이나 다른 영상을 선택해 주세요.' };
  return { ok: true, reference: saveReference({ ...ref, profile: built.profile, updatedAt: new Date().toISOString() }) };
}

// ---------------------------------------------------------------- comparing one attempt

export interface CompareOutcome {
  record: FormCompareRecord;
  userFrames: (ClipFrame & { note: string })[];
  refFrames: (ClipFrame & { note: string })[];
}

function phaseAt(profile: ReferenceProfile, times: { phaseId: string; userMs: number }[], tMs: number): string {
  let label = '준비';
  for (const p of times) if (tMs >= p.userMs - 1) label = profile.phases.find((x) => x.id === p.phaseId)?.name ?? label;
  return label;
}

export async function compareAttempt(t: Technique, ref: ReferenceVideo, clip: PreparedClip): Promise<{ ok: true; outcome: CompareOutcome } | (Fail & { retake?: CaptureIssue[] })> {
  const block = blockingIssues(clip.signals);
  if (block.length) return { ok: false, retake: block, message: block.map((i) => CAPTURE_ISSUE_LABEL[i]).join(' ') };
  const profile = ref.profile;
  if (!profile) return { ok: false, message: '기준 영상의 평가 기준이 아직 없습니다.' };
  if (!profile.matchesTechnique) return { ok: false, message: `기준 영상이 ${t.name}가 아닌 것으로 분석되었습니다(${profile.observedTechnique || '다른 동작'}). 기준 영상을 바꿔 주세요.` };
  const input = await prepareComparison(ref, profile, clip);
  const { mediaParts, poseHints, qualityNote } = input;
  const judged = await judgeAttempt({ technique: t, ref, profile, mediaParts, qualityNote, poseHints });
  if (!judged.ok) return judged;
  return finishComparison(t, ref, profile, clip, judged.judgement, input);
}

/**
 * Everything before the AI call — alignment, the frame pairs, the pose hints,
 * the capture note. Pure local work (no network); exported for testing.
 */
export async function prepareComparison(ref: ReferenceVideo, profile: ReferenceProfile, clip: PreparedClip) {
  const seg = clip.signals.segment!;
  const clipLenMs = (ref.endSeconds - ref.startSeconds) * 1000;

  // --- time alignment: reference phase starts → user times
  const media = hasLocalMedia(ref.source) ? await getMedia(ref.id) : null;
  const phases = profile.phases.map((p, i) => ({ id: p.id, f: p.startFraction ?? i / Math.max(1, profile.phases.length) }));
  let alignment: AlignmentInfo;
  const dtw = media?.signals.segment ? alignTimes(media.poses, media.signals.segment, clip.poses, seg, phases.map((p) => p.f * clipLenMs)) : null;
  if (dtw && media?.signals.segment) {
    const refLen = media.signals.segment.endMs - media.signals.segment.startMs;
    alignment = { method: 'dtw', speedRatio: Math.round(((seg.endMs - seg.startMs) / Math.max(1, refLen)) * 100) / 100, phaseTimes: phases.map((p, i) => ({ phaseId: p.id, refMs: Math.round(p.f * clipLenMs), userMs: Math.round(dtw.userTimesMs[i]) })) };
  } else {
    const { start: aS, end: aE } = profile.active;
    const rel = phases.map((p) => (p.f - aS) / Math.max(0.05, aE - aS));
    alignment = { method: 'segment', speedRatio: null, phaseTimes: phases.map((p, i) => ({ phaseId: p.id, refMs: Math.round(p.f * clipLenMs), userMs: Math.round(linearTimes(seg, [rel[i]])[0]) })) };
  }
  alignment.phaseTimes.sort((a, b) => a.userMs - b.userMs);

  // --- frames for the AI. File reference: aligned PAIRS (same moment in both clips —
  // start posture, each phase start/middle, the point of largest extension).
  // YouTube reference: the user's frames at the mapped moments (the model watches the clip itself).
  const userExtreme = extremeMs(clip.poses, seg);
  let userFrames: (ClipFrame & { note: string })[] = [];
  let refFrames: (ClipFrame & { note: string })[] = [];
  let mediaParts: AiMediaPart[];
  let poseHints: string[] = [];
  if (media?.signals.segment) {
    const refSeg = media.signals.segment;
    const refExtreme = extremeMs(media.poses, refSeg);
    const refTimeline = alignment.phaseTimes.map((p) => ({ phaseId: p.phaseId, userMs: p.refMs ?? 0 }));
    // Evenly through the user's WHOLE performed segment (that is what is judged — phase
    // boundaries alone, or reference times squeezed by the alignment, can skip the decisive
    // instant), + the start posture + both largest-extension moments; each mapped to the
    // matching reference instant by the same DTW path.
    const userTimes = [...new Set([...linearTimes(seg, Array.from({ length: 9 }, (_, i) => i / 8)), ...(userExtreme !== null ? [userExtreme] : [])].map((x) => Math.round(x)))].sort((x, y) => x - y);
    const toRef = alignTimesFromUser(media.poses, refSeg, clip.poses, seg, userTimes) ?? linearTimes(refSeg, userTimes.map((u) => (u - seg.startMs) / Math.max(1, seg.endMs - seg.startMs)));
    const refExtUser = refExtreme !== null ? alignTimes(media.poses, refSeg, clip.poses, seg, [refExtreme])?.userTimesMs[0] ?? null : null;
    const pairs = [
      { r: Math.max(0, refSeg.startMs - 250), u: Math.max(clip.frames[0]?.tMs ?? 0, seg.startMs - 250), extreme: false },
      ...userTimes.map((u, i) => ({ r: Math.round(toRef[i]), u, extreme: u === (userExtreme !== null ? Math.round(userExtreme) : -1) })),
      ...(refExtreme !== null && refExtUser !== null ? [{ r: Math.round(refExtreme), u: Math.round(refExtUser), extreme: true }] : []),
    ]
      .sort((x, y) => x.u - y.u)
      .filter((p, i, arr) => i === 0 || p.extreme || Math.abs(p.u - arr[i - 1].u) >= 100)
      .slice(0, 12);
    const near = <T extends { tMs: number }>(xs: T[], t: number) => xs.reduce((b, x) => (Math.abs(x.tMs - t) < Math.abs(b.tMs - t) ? x : b), xs[0]);
    for (const p of pairs) {
      const note = `${phaseAt(profile, refTimeline, p.r)}${p.extreme ? ' · 정점' : ''}`;
      refFrames.push({ ...near(media.frames, p.r), note });
      userFrames.push({ ...near(clip.frames, p.u), note });
    }
    const diffs = poseDifferences(media.poses, refSeg, clip.poses, seg);
    // each hint is attached to the pair nearest to where its difference is largest
    const pairHint = pairs.map(() => [] as string[]);
    for (const d of diffs) {
      let k = 0;
      for (let i = 1; i < pairs.length; i++) if (Math.abs(pairs[i].u - d.userMs) < Math.abs(pairs[k].u - d.userMs)) k = i;
      pairHint[k].push(`${d.part} ${d.direction} ${d.max}`);
    }
    refFrames = await cropToPerson(refFrames, media.poses, refSeg);
    userFrames = await cropToPerson(userFrames, clip.poses, seg);
    const composites = await Promise.all(pairs.map((p, i) => compositePair(refFrames[i].image, userFrames[i].image, poseAt(media.poses, p.r), poseAt(clip.poses, p.u))));
    mediaParts = [
      {
        kind: 'text',
        text: '[짝 이미지 — 시간 정렬(DTW)로 맞춘 같은 순간. 각 이미지: 왼쪽 = 기준 R 사진 | 가운데 = 사용자 U 사진 | 오른쪽 = 두 자세의 골격을 엉덩이 중심·몸통 길이로 맞춰 겹친 그림 (파랑 = 기준, 빨강 = 사용자; 큰 점 = 머리, 작은 점 = 손목). 골격 그림은 외모·배경·체격·거리 차이를 없앤 자세 비교용이며 MediaPipe 추정이라 손끝·깊이는 부정확할 수 있다.]',
      },
      ...pairs.flatMap((_, i) => [
        { kind: 'text' as const, text: `[짝 ${i + 1} · ${refFrames[i].note} · 기준 R${i + 1} ${(refFrames[i].tMs / 1000).toFixed(2)}초 ↔ 사용자 U${i + 1} ${(userFrames[i].tMs / 1000).toFixed(2)}초${pairHint[i].length ? ` · 보조 신호(확인 필요): 기준 대비 ${pairHint[i].join(', ')} 몸통 길이 차이` : ''}]` },
        { kind: 'image' as const, mimeType: 'image/jpeg', data: composites[i].replace(/^data:image\/\w+;base64,/, '') },
      ]),
    ];
    poseHints = diffs.map(
      (d) => `${d.part}(사람 기준 좌우): 같은 순간 기준보다 ${d.direction} 최대 ${d.max} 몸통 길이 (평균 ${d.mean}) — 기준 ${(d.refMs / 1000).toFixed(2)}초 ↔ 사용자 ${(d.userMs / 1000).toFixed(2)}초`
    );
  } else {
    const wanted = [Math.max(clip.frames[0]?.tMs ?? 0, seg.startMs - 250), ...linearTimes(seg, Array.from({ length: 9 }, (_, i) => i / 8)), ...(userExtreme !== null ? [userExtreme] : [seg.peakMs])];
    userFrames = pickFrames(clip.frames, wanted)
      .slice(0, 11)
      .map((f) => ({ ...f, note: `${phaseAt(profile, alignment.phaseTimes, f.tMs)}${userExtreme !== null && Math.abs(f.tMs - userExtreme) < 60 ? ' · 정점' : ''}` }));
    userFrames = await cropToPerson(userFrames, clip.poses, seg);
    mediaParts = [...referenceMediaParts(ref, null), { kind: 'text', text: '[사용자 프레임 U — 시간은 사용자 영상 시작부터, 괄호 안은 시간 정렬로 추정한 기준 단계]' }, ...frameParts('U', userFrames)];
  }

  // Phase 6: the reference angle (exact for a 3D recording) and the local direction check.
  // The local estimate is compared with the same estimator's reading of the reference when
  // the reference has local media (same bias on both sides), else with the reference angle.
  const refAngle = referenceAngle(ref);
  const refEstimate = media?.signals.cameraView && media.signals.cameraView !== 'unknown' ? media.signals.cameraView : refAngle.view;
  const localView = { referenceView: refAngle.view, referenceViewSource: refAngle.source, local: localViewRelation(refEstimate, clip.signals.cameraView), userViewLocal: clip.signals.cameraView };
  const qualityNote = [
    `사람 인식 프레임 ${Math.round(clip.signals.visibleRatio * 100)}%, 전신 인식 ${Math.round(clip.signals.fullBodyRatio * 100)}%`,
    refAngle.source === 'motion3d'
      ? `기준 영상 촬영 방향: ${ANGLE_NAME[refAngle.view]} (사용자가 3D 미리보기에서 직접 고른 각도 — 확정값). 사용자는 이 각도에 맞춰 촬영하도록 안내받았다.`
      : `기준 영상 촬영 방향: ${ANGLE_NAME[refAngle.view]}${refAngle.source === 'profile' ? ' (기준 영상 분석 결과)' : ' (사용자 입력)'}`,
    `사용자 촬영 방향(로컬 자세 추정, 몸을 비스듬히 세운 스탠스에서는 틀릴 수 있음): ${VIEW_LABEL[clip.signals.cameraView]} — 기준 영상 대비 ${{ consistent: '비슷함', unclear: '판단 어려움', mismatch: '다를 가능성', unknown: '확인 불가' }[localView.local]}`,
    alignment.speedRatio ? `수행 시간은 기준 영상의 ${alignment.speedRatio}배 (속도 차이는 감점 이유가 아님)` : '',
    clip.signals.issues.length ? `촬영 문제: ${clip.signals.issues.map((i) => CAPTURE_ISSUE_LABEL[i]).join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { alignment, userFrames, refFrames, mediaParts, poseHints, localView, qualityNote };
}

function finishComparison(t: Technique, ref: ReferenceVideo, profile: ReferenceProfile, clip: PreparedClip, judgement: ComparisonJudgement, input: Awaited<ReturnType<typeof prepareComparison>>): { ok: true; outcome: CompareOutcome } {
  const { alignment, userFrames, refFrames, poseHints, localView } = input;
  const judged = { judgement };
  const viewCheck = combineViewCheck({ ...localView, ai: judgement.viewCheck?.relation ?? null, userViewAi: judgement.viewCheck?.userView ?? null, aiNote: judgement.viewCheck?.note || null });
  // The score formula is unchanged. Only a CONFIRMED same direction counts as "view matches"
  // (its existing input); a suspected mismatch or an unconfirmable direction keeps the
  // reliability below "high", as the existing rule does for a different direction.
  const breakdown = scoreComparison({ criteria: profile.criteria, phases: profile.phases, judgement: judged.judgement, signals: clip.signals, viewMatches: viewCheck.status === 'match' });

  // --- records: the detailed comparison + (when scored) the existing pose-analysis history
  let poseRecordId: string | null = null;
  if (breakdown.status === 'scored' && breakdown.score !== null) {
    const values: Record<string, number> = { match: 100, partial: 50, mismatch: 0 };
    const pr: PoseAnalysisRecord = {
      recordId: newId('pose'),
      techniqueId: t.id,
      martialArtId: t.martialArt,
      score: breakdown.score,
      status: classifyScore(breakdown.score),
      metricScores: Object.fromEntries(judged.judgement.criteria.filter((c) => c.verdict !== 'not_observable').map((c) => [c.criterionId, values[c.verdict]])),
      analyzedAt: new Date().toISOString(),
      method: 'video_compare',
      referenceId: ref.id,
      reliability: breakdown.reliability,
    };
    poseRecordsRepository.add(pr);
    poseRecordId = pr.recordId;
  }
  const record: FormCompareRecord = {
    id: newId('cmp'),
    techniqueId: t.id,
    martialArt: t.martialArt,
    referenceId: ref.id,
    createdAt: new Date().toISOString(),
    breakdown,
    judgement: judged.judgement,
    criteria: profile.criteria,
    signals: clip.signals,
    alignment,
    viewWarning: viewCheck.status === 'mismatch' ? viewCheck.message : null,
    viewCheck,
    poseHints,
    poseRecordId,
  };
  saveCompareRecord(record);
  return { ok: true, outcome: { record, userFrames, refFrames } };
}

/** Frame parts helper re-exported for tests (labelled the same way the AI sees them). */
export { frameParts };
