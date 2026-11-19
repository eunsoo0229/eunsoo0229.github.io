// 자세 확인 — the AI coach connects the learner to the app's EXISTING pose measurement
// (poseAnalysis: MediaPipe on this device + per-technique rule metrics, data/curated/poseAnalysis.json).
// No new scoring engine and no external AI: the camera path is the existing PoseAnalysisModal; a
// submitted video file goes through formCompare's local frame sampler (clipCapture.sampleVideoBlob)
// and then the same analyzeTechnique.
//   - only techniques with a config can be measured (18) — others are told so, never "measured"
//   - the capture guide states only what the engine actually checks (the joints it needs, one
//     repetition, the person visible); camera direction is not compared by the engine → advice only
//   - a reference (demonstration) video is searched for viewing; its suitability is judged from its
//     title / description only, and the score does NOT compare against it (a YouTube video's frames
//     cannot be read in the app)
//   - unmeasurable metrics are excluded; blocked captures (no person / no movement / too short)
//     get a retake request, not a score; a result is saved only when it was produced

import type { Technique } from '../../types';
import { analyzeTechnique } from '../poseAnalysis/analyzeTechnique';
import { getPoseAnalysisConfig, listSupportedTechniqueIds } from '../poseAnalysis/poseAnalysisConfig';
import type { PoseAnalysisResult, PoseFrame, PoseLandmarkName } from '../poseAnalysis/types';
import { resolveTechnique } from '../userTechniques/service';
import { dataKoreanNames } from '../coachKnowledge/koreanNames';
import type { ChatSource } from '../selfAi/types';

export interface PoseSupport {
  supported: boolean;
  /** Why not (shown to the learner). */
  reason: string | null;
  /** Techniques of the same art that CAN be measured (for "대신 측정할 수 있는 기술"). */
  alternatives: Technique[];
}

export function poseSupport(t: Technique): PoseSupport {
  if (getPoseAnalysisConfig(t.id)?.supported) return { supported: true, reason: null, alternatives: [] };
  const alternatives = listSupportedTechniqueIds()
    .map((id) => resolveTechnique(id))
    .filter((x): x is Technique => !!x && (x.martialArts ?? [x.martialArt]).some((a) => (t.martialArts ?? [t.martialArt]).includes(a)));
  return { supported: false, reason: `${t.name}은(는) MARTIALDEX 자세 측정(카메라 관절 분석) 기준이 없는 기술입니다. 측정하지 않았고 점수도 만들지 않습니다.`, alternatives: [...new Map(alternatives.map((x) => [x.id, x])).values()] };
}

const LOWER = new Set<PoseLandmarkName>(['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle']);

export interface CaptureGuide {
  bodyRange: string;
  cameraHeight: string;
  distance: string;
  placement: string;
  motion: string;
  direction: string;
  /** What the engine measures (the config's metric names). */
  measures: string[];
}

/** Capture instructions derived from the technique's measurement config — only conditions the engine checks. */
export function captureGuide(t: Technique): CaptureGuide | null {
  const c = getPoseAnalysisConfig(t.id);
  if (!c?.supported) return null;
  const fullBody = c.requiredLandmarks.some((l) => LOWER.has(l)) || c.metrics.some((m) => /leg|knee|support|level|stance|balance/i.test(m.id));
  return {
    bodyRange: fullBody ? '머리부터 발끝까지 몸 전체 (측정에 무릎·발목 관절이 필요)' : '머리부터 골반까지 상체 전체 (어깨·팔꿈치·손목·골반 관절이 필요)',
    cameraHeight: fullBody ? '허리 높이' : '가슴 높이',
    distance: fullBody ? '약 2.5–3m (몸 전체가 화면 높이의 70–90%)' : '약 1.5–2m (상체가 화면에 여유 있게)',
    placement: '화면 가운데, 동작하는 팔·다리가 화면 밖으로 나가지 않게',
    motion: '기본 자세에서 시작 → 기술 1회 → 기본 자세로 복귀 (카메라 측정은 기준 동작 1회 길이만큼 자동 촬영 — 3D 시연 또는 지정한 기준 영상 구간, 영상 파일은 15초 이내)',
    direction: '측정은 촬영 방향을 비교하지 않습니다. 기준 영상과 같은 방향(대개 정면이나 약간 비스듬히)을 권장합니다.',
    measures: c.metrics.map((m) => m.name),
  };
}

const NOT_SINGLE = /(combo|combination|콤보|콤비네이션|top\s*\d+|best of|compilation|highlights?|하이라이트|\bvs\.?\b|knock ?outs?|\bko\b|ufc \d+|every|all\s+\w+\s+(kicks|punches)|drills? for|mistakes|reaction|sparring|스파링|모음)/i;
const TUTORIAL = /(how to|tutorial|technique|basics?|beginner|강좌|기본|배우기|하는 법|방법)/i;

/** A single-technique demonstration: names the technique, not a combo / compilation, playable in the app, ≤ 10 min when the length is known. Judged from title / description only. */
export function pickReferenceVideos(results: ChatSource[], t: Technique): { picked: ChatSource[]; rejected: { title: string; why: string }[] } {
  const names = [t.name, t.koreanName ?? '', ...(t.aliases ?? []), ...dataKoreanNames(t)].filter((n) => n.length >= 2 || /^[가-힣]+$/.test(n)).map((n) => n.toLowerCase());
  const picked: ChatSource[] = [];
  const rejected: { title: string; why: string }[] = [];
  for (const v of results) {
    const title = v.title.toLowerCase();
    const why = !names.some((n) => title.includes(n))
      ? '제목에 기술 이름 없음'
      : NOT_SINGLE.test(v.title)
        ? '여러 기술·하이라이트 영상'
        : v.video?.embed !== 'embeddable'
          ? '앱에서 재생 불가'
          : v.video?.duration && /^(\d+):(\d+):\d+$|^(1\d|[2-9]\d):\d+$/.test(v.video.duration)
            ? '10분 이상'
            : null;
    if (why) rejected.push({ title: v.title, why });
    else picked.push(v);
  }
  picked.sort((a, b) => Number(TUTORIAL.test(b.title)) - Number(TUTORIAL.test(a.title)));
  return { picked: picked.slice(0, 3), rejected };
}

export type CaptureProblem = 'no_person' | 'no_movement' | 'too_short' | 'few_frames' | 'body_cut_off' | 'too_dark';

export const CAPTURE_PROBLEM_LABEL: Record<CaptureProblem, string> = {
  no_person: '사람이 거의 보이지 않음',
  no_movement: '기술 동작이 감지되지 않음',
  too_short: '영상이 너무 짧음',
  few_frames: '분석할 장면이 너무 적음',
  body_cut_off: '몸 일부가 화면 밖으로 나감',
  too_dark: '화면이 너무 어두움',
};

export interface CaptureSignals {
  visibleRatio: number;
  fullBodyRatio: number;
  issues: CaptureProblem[];
  cameraView?: string;
  segment: { startMs: number; endMs: number } | null;
}

export interface PoseCheckResult {
  technique: Technique;
  ok: boolean;
  /** Retake request / unsupported / joints not seen — why there is no score. */
  failure: string | null;
  result: PoseAnalysisResult | null;
  measured: { name: string; score: number; detail: string }[];
  unmeasured: { name: string; detail: string }[];
  /** 0–1 from how much of the body was seen; 'low' never gets a "proficient" reading. */
  reliability: { label: '높음' | '보통' | '낮음'; reasons: string[] };
  nextTraining: string[];
}

/** Score sampled frames with the existing engine; no score when the capture cannot support one. */
export function evaluatePoseFrames(t: Technique, frames: PoseFrame[], signals: CaptureSignals): PoseCheckResult {
  const base = { technique: t, result: null, measured: [], unmeasured: [], nextTraining: [] as string[] };
  const guide = captureGuide(t);
  if (!guide) return { ...base, ok: false, failure: poseSupport(t).reason, reliability: { label: '낮음', reasons: [] } };
  const blocking: CaptureProblem[] = signals.issues.filter((i) => i === 'no_person' || i === 'no_movement' || i === 'too_short' || i === 'few_frames');
  const needsFull = /몸 전체/.test(guide.bodyRange);
  if (needsFull && signals.issues.includes('body_cut_off')) blocking.push('body_cut_off');
  if (blocking.length) return { ...base, ok: false, failure: `다시 촬영해 주세요: ${blocking.map((i) => CAPTURE_PROBLEM_LABEL[i]).join(', ')}. (${guide.bodyRange}이 보이게, ${guide.distance})`, reliability: { label: '낮음', reasons: blocking.map((i) => CAPTURE_PROBLEM_LABEL[i]) } };
  // the performed part (± 0.5 s), when movement was found
  const seg = signals.segment;
  const used = seg ? frames.filter((f) => f.timestampMs >= seg.startMs - 500 && f.timestampMs <= seg.endMs + 500) : frames;
  const out = analyzeTechnique(t.id, used.length >= 8 ? used : frames);
  if (!out.ok) {
    const failure = out.reason === 'insufficient_metrics' ? `평가에 필요한 관절을 충분히 인식하지 못해 점수를 내지 않았습니다(측정 불가: ${out.unmeasured.join(', ')}). ${guide.bodyRange}이 보이게 다시 촬영해 주세요.` : out.reason === 'no_pose_detected' ? `자세를 충분히 인식하지 못했습니다. ${guide.bodyRange}이 보이게, 밝은 곳에서 다시 촬영해 주세요.` : poseSupport(t).reason;
    return { ...base, ok: false, failure, reliability: { label: '낮음', reasons: [] } };
  }
  const measured = out.result.metricScores.filter((m) => m.measured !== false).map(({ name, score, detail }) => ({ name, score, detail }));
  const unmeasured = out.result.metricScores.filter((m) => m.measured === false).map(({ name, detail }) => ({ name, detail }));
  const reasons: string[] = [`사람이 보인 장면 ${Math.round(signals.visibleRatio * 100)}%`];
  if (needsFull) reasons.push(`몸 전체가 보인 장면 ${Math.round(signals.fullBodyRatio * 100)}%`);
  if (unmeasured.length) reasons.push(`측정 불가 항목 ${unmeasured.length}개`);
  if (signals.issues.includes('too_dark')) reasons.push('어두움');
  const coverage = measured.length / Math.max(1, measured.length + unmeasured.length);
  const v = Math.min(signals.visibleRatio, needsFull ? signals.fullBodyRatio : 1) * coverage * (signals.issues.includes('too_dark') ? 0.8 : 1);
  const label = v >= 0.75 ? '높음' : v >= 0.5 ? '보통' : '낮음';
  const weakest = [...measured].sort((a, b) => a.score - b.score)[0];
  const nextTraining = weakest && weakest.score < 70 ? [`"${weakest.name}" 보완: ${t.koreanName ?? t.name} 수업의 핵심 포인트를 다시 보고 천천히 10회 반복한 뒤 다시 측정해 보세요.`] : ['지금 자세를 유지하며 속도를 조금씩 올려 반복해 보세요.'];
  return { technique: t, ok: true, failure: null, result: out.result, measured, unmeasured, reliability: { label, reasons }, nextTraining };
}

/** In a lesson: suggest measuring only for a measurable technique the learner just practised, once, and never after "나중에". */
export function shouldSuggestPose(t: Technique, opts: { practiced: boolean; declined: boolean; alreadySuggested: boolean }): boolean {
  return opts.practiced && !opts.declined && !opts.alreadySuggested && !!getPoseAnalysisConfig(t.id)?.supported;
}

// ---- the suggestion's memory, per lesson session (shared by every lesson screen) ----
// sessionStorage `martialdex:pose-suggest:<sessionKey>` → { [techniqueId]: 'shown' | 'declined' }.
// sessionKey = the regular lesson's run.id, or `oneoff-<lesson.id>` on the free lesson screen, so a
// new lesson never inherits an earlier lesson's "나중에 하기". Nothing here touches the lesson state.
export type PoseSuggestMark = 'shown' | 'declined';

export function poseSuggestMarks(sessionKey: string): Record<string, PoseSuggestMark> {
  try {
    return JSON.parse(sessionStorage.getItem(`martialdex:pose-suggest:${sessionKey}`) ?? '{}');
  } catch {
    return {};
  }
}

export function markPoseSuggest(sessionKey: string, techniqueId: string, mark: PoseSuggestMark): void {
  try {
    sessionStorage.setItem(`martialdex:pose-suggest:${sessionKey}`, JSON.stringify({ ...poseSuggestMarks(sessionKey), [techniqueId]: mark }));
  } catch {
    /* private mode: the card may be offered again, nothing else is affected */
  }
}
