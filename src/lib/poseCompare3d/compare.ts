import type { PoseAnalysisResult, PoseFrame, PoseLandmarkName } from '../poseAnalysis/types';
import { classifyScore, isImprovementArea, isStrength } from '../poseAnalysis/scoring';
import type { ClipMeasure, MeasureGroup, MotionPhase } from '../motion3d/types';
import type { RefLandmark, RefPoint, ReferencePoseTrack } from '../motion3d/referencePose';

// 3D-reference pose measurement: the learner's MediaPipe joints (one capture window) against the clip's own
// joints (referencePose.ts, same camera angle, same length). Both sides are normalised the same way —
// origin at the hip centre, scale = the sequence's median torso length — resampled onto one 0–1 timeline and
// aligned with banded DTW (a learner who starts a little late is not punished for the whole window).
// Only landmarks MediaPipe saw with confidence are compared; a group seen too rarely is "not measured", never
// guessed. The score is a reference-similarity score — not a judgement of the learner's whole skill.

export type Side = 'left' | 'right';
export const MIN_VISIBILITY = 0.5;
const BINS = 40;
const BAND = 0.25;
/** Torso-length units, on the worst third of the aligned frames: at or below FULL → 100, at or above ZERO → 0. */
const ERR_FULL = 0.08;
const ERR_ZERO = 0.4;
/** The hand / foot ends carry the technique — they count double in a group's error. */
const LANDMARK_WEIGHT = (k: RefLandmark) => (/Wrist|Ankle/.test(k) ? 2 : 1);
/** The other stance fits this much better (DTW cost ratio) → the learner's stance probably differs from the profile. */
const STANCE_RATIO = 0.6;
const MIN_GROUP_COVERAGE = 0.6;

export type RetakeIssue = 'few_frames' | 'no_person' | 'body_cut_off' | 'angle_mismatch' | 'facing_reversed' | 'stance_mismatch' | 'no_movement' | 'insufficient';
export const RETAKE_TEXT: Record<RetakeIssue, string> = {
  few_frames: '촬영된 프레임이 너무 적습니다. 조명이 밝은 곳에서 다시 촬영해 주세요.',
  no_person: '몸(어깨·골반)을 거의 인식하지 못했습니다. 카메라 앞, 화면 가운데에 서 주세요.',
  body_cut_off: '다리(무릎·발목)가 화면에 잘 보이지 않았습니다. 머리부터 발끝까지 화면에 들어오게 조금 뒤로 물러나 주세요.',
  angle_mismatch: '선택한 촬영 각도와 몸의 방향이 다릅니다. 3D 미리보기와 같은 방향으로 서서 다시 촬영해 주세요.',
  facing_reversed: '몸의 좌우 방향이 기준과 반대입니다. 카메라를 등지고 서지 않았는지, 선택한 각도(정면/후면)가 맞는지 확인해 주세요.',
  stance_mismatch: '반대 스탠스의 동작에 더 가깝습니다. 프로필의 기본 스탠스(오소독스/사우스포)와 실제로 선 스탠스가 같은지 확인해 주세요.',
  no_movement: '기술 동작이 거의 보이지 않았습니다. 카운트다운이 끝나면 바로 기술을 한 번 수행해 주세요.',
  insufficient: '점수를 낼 만큼 관절을 인식하지 못했습니다. 몸 전체가 보이게 다시 촬영해 주세요.',
};

const GROUP_LANDMARKS = (lead: Side): Record<MeasureGroup, RefLandmark[]> => {
  const rear: Side = lead === 'left' ? 'right' : 'left';
  const arm = (s: Side) => [`${s}Shoulder`, `${s}Elbow`, `${s}Wrist`] as RefLandmark[];
  return { leadArm: arm(lead), rearArm: arm(rear), torso: ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'], legs: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] };
};
export const GROUP_LABEL = (g: MeasureGroup, lead: Side): string => {
  const side = (s: Side) => (s === 'left' ? '왼' : '오른');
  const rear: Side = lead === 'left' ? 'right' : 'left';
  return { leadArm: `앞손(${side(lead)}팔)`, rearArm: `뒷손(${side(rear)}팔)`, torso: '몸통·골반', legs: '다리·발' }[g];
};

type Pts = Partial<Record<RefLandmark, RefPoint>>;
interface Seq {
  /** 0–1 position on the capture timeline. */
  t: number[];
  pts: Pts[];
}

const LMS: RefLandmark[] = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];
const mid = (a: RefPoint, b: RefPoint): RefPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: RefPoint, b: RefPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Swap left/right and flip x: the orthodox reference as a southpaw would perform it, seen from the same camera. */
export function mirrorPoints(p: Pts): Pts {
  const out: Pts = {};
  for (const [k, v] of Object.entries(p) as [RefLandmark, RefPoint][]) {
    const other = (k.startsWith('left') ? k.replace('left', 'right') : k.replace('right', 'left')) as RefLandmark;
    out[other] = { x: -v.x, y: v.y };
  }
  return out;
}

/** Hip-centred, torso-scaled; frames without both hips and shoulders are dropped. */
function normalise(seq: Seq): { seq: Seq; torso: number } {
  const torsos: number[] = [];
  for (const p of seq.pts) if (p.leftHip && p.rightHip && p.leftShoulder && p.rightShoulder) torsos.push(dist(mid(p.leftShoulder, p.rightShoulder), mid(p.leftHip, p.rightHip)));
  const torso = median(torsos);
  const out: Seq = { t: [], pts: [] };
  if (!(torso > 0)) return { seq: out, torso: NaN };
  seq.pts.forEach((p, i) => {
    if (!(p.leftHip && p.rightHip && p.leftShoulder && p.rightShoulder)) return;
    const c = mid(p.leftHip, p.rightHip);
    const q: Pts = {};
    for (const [k, v] of Object.entries(p) as [RefLandmark, RefPoint][]) q[k] = { x: (v.x - c.x) / torso, y: (v.y - c.y) / torso };
    out.t.push(seq.t[i]);
    out.pts.push(q);
  });
  return { seq: out, torso };
}

/** Onto BINS points of the 0–1 timeline: per landmark, the mean of the samples within ±1.5 bins (missing if none). */
function resample(seq: Seq): Pts[] {
  const w = 1.5 / BINS;
  return Array.from({ length: BINS }, (_, b) => {
    const tc = (b + 0.5) / BINS;
    const acc: Partial<Record<RefLandmark, { x: number; y: number; n: number }>> = {};
    seq.t.forEach((t, i) => {
      if (Math.abs(t - tc) > w) return;
      for (const [k, v] of Object.entries(seq.pts[i]) as [RefLandmark, RefPoint][]) {
        const a = (acc[k] ??= { x: 0, y: 0, n: 0 });
        a.x += v.x;
        a.y += v.y;
        a.n++;
      }
    });
    const out: Pts = {};
    for (const [k, a] of Object.entries(acc) as [RefLandmark, { x: number; y: number; n: number }][]) out[k] = { x: a.x / a.n, y: a.y / a.n };
    return out;
  });
}

function frameCost(a: Pts, b: Pts, lms: RefLandmark[]): number {
  let s = 0;
  let n = 0;
  for (const k of lms) {
    const p = a[k];
    const q = b[k];
    if (p && q) {
      s += dist(p, q);
      n++;
    }
  }
  return n ? s / n : 1;
}

/** Banded DTW; returns the alignment path as (user bin, reference bin) pairs. */
function dtw(u: Pts[], r: Pts[], lms: RefLandmark[]): { path: [number, number][]; cost: number } {
  const n = u.length;
  const m = r.length;
  const band = Math.max(2, Math.round(BAND * Math.max(n, m)));
  const D = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) D[i][j] = frameCost(u[i - 1], r[j - 1], lms) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = D[i - 1][j - 1];
    const up = D[i - 1][j];
    const left = D[i][j - 1];
    if (diag <= up && diag <= left) (i--, j--);
    else if (up <= left) i--;
    else j--;
  }
  return { path: path.reverse(), cost: D[n][m] / (n + m) };
}

export interface GroupScore {
  id: MeasureGroup;
  label: string;
  weight: number;
  measured: boolean;
  /** Fraction of the timeline where every landmark of the group was seen. */
  coverage: number;
  /** Mean distance to the reference, torso units (null = not measured). */
  error: number | null;
  score: number | null;
}

export interface Compare3dResult {
  ok: boolean;
  score: number | null;
  groups: GroupScore[];
  reliability: 'high' | 'medium' | 'low';
  reliabilityReasons: string[];
  retake: RetakeIssue[];
  feedback: string[];
  /** + = the learner was behind the reference (fraction of the window). */
  timingOffset: number | null;
  frames: { total: number; usable: number };
  lead: Side;
  mirrored: boolean;
}

/** Mean distance of one aligned pair over the landmarks both sides saw (null = none in common). */
function pairError(a: Pts, b: Pts, ls: RefLandmark[]): number | null {
  let s = 0;
  let n = 0;
  for (const k of ls) if (a[k] && b[k]) (s += LANDMARK_WEIGHT(k) * dist(a[k]!, b[k]!), n += LANDMARK_WEIGHT(k));
  return n ? s / n : null;
}
/** The guard frames match almost always — the error that matters is where the technique differs. */
function worstThird(ds: number[]): number {
  const s = [...ds].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(ds.length / 3)));
  return s.reduce((a, b) => a + b, 0) / s.length;
}

const toScore = (e: number) => Math.round(100 * Math.min(1, Math.max(0, (ERR_ZERO - e) / (ERR_ZERO - ERR_FULL))));

export interface CompareInput {
  frames: PoseFrame[];
  /** Video width / height — MediaPipe x and y are normalised separately. */
  aspect: number;
  windowStartMs: number;
  durationMs: number;
  reference: ReferencePoseTrack;
  phases: MotionPhase[];
  measure: ClipMeasure;
  /** The clip's lead hand. */
  clipLead: Side;
  /** Learner is southpaw and the clip is orthodox (or the reverse): compare with the mirrored reference. */
  mirror: boolean;
}

export function compareToReference(input: CompareInput): Compare3dResult {
  const lead: Side = input.mirror ? (input.clipLead === 'left' ? 'right' : 'left') : input.clipLead;
  const groupsOf = GROUP_LANDMARKS(lead);
  const retake: RetakeIssue[] = [];
  const reliabilityReasons: string[] = [];
  // ---- learner sequence (seen landmarks only, aspect-corrected)
  const user: Seq = { t: [], pts: [] };
  for (const f of input.frames) {
    const p: Pts = {};
    for (const k of LMS) {
      const v = f[k as PoseLandmarkName];
      if (v && v.visibility >= MIN_VISIBILITY) p[k] = { x: v.x * input.aspect, y: v.y };
    }
    user.t.push((f.timestampMs - input.windowStartMs) / input.durationMs);
    user.pts.push(p);
  }
  const ref: Seq = { t: input.reference.frames.map((f) => f.t / input.reference.durationSec), pts: input.reference.frames.map((f) => (input.mirror ? mirrorPoints(f.points) : f.points)) };
  const nu = normalise(user);
  const nr = normalise(ref);
  const base = { score: null, groups: [], reliability: 'low' as const, reliabilityReasons, feedback: [], timingOffset: null, frames: { total: input.frames.length, usable: nu.seq.pts.length }, lead, mirrored: input.mirror };
  if (input.frames.length < 8) return { ...base, ok: false, retake: ['few_frames'] };
  if (nu.seq.pts.length / input.frames.length < 0.5 || !(nr.torso > 0)) return { ...base, ok: false, retake: ['no_person'] };

  // ---- direction checks (shoulder line seen from the chosen angle)
  const shoulderStats = (s: Seq) => {
    const w: number[] = [];
    const sign: number[] = [];
    for (const p of s.pts) if (p.leftShoulder && p.rightShoulder) (w.push(Math.abs(p.leftShoulder.x - p.rightShoulder.x)), sign.push(Math.sign(p.leftShoulder.x - p.rightShoulder.x)));
    return { width: median(w), sign: Math.sign(sign.reduce((a, b) => a + b, 0)) };
  };
  const su = shoulderStats(nu.seq);
  const sr = shoulderStats(nr.seq);
  // shoulder line: same order + similar width = same view; same width but mirrored order = turned around
  const widthOff = sr.width > 0 && su.width > 0 ? Math.abs(Math.log(su.width / sr.width)) : 0;
  if (sr.width > 0.25 && su.width > 0.25 && su.sign !== sr.sign) retake.push(widthOff < Math.log(1.4) ? 'facing_reversed' : 'angle_mismatch');
  else if (widthOff > Math.log(2.2)) retake.push('angle_mismatch');

  const ub = resample(nu.seq);
  const rb = resample(nr.seq);
  const scored = (Object.keys(groupsOf) as MeasureGroup[]).filter((g) => (input.measure.weights[g] ?? 0) > 0);
  const lms = [...new Set(scored.flatMap((g) => groupsOf[g]))];
  const { path, cost } = dtw(ub, rb, lms);
  // the same reference in the other stance: a much better fit means the stance differs from the profile
  const other = normalise({ t: ref.t, pts: ref.pts.map(mirrorPoints) });
  if (!retake.length && other.torso > 0 && dtw(ub, resample(other.seq), lms).cost < STANCE_RATIO * cost) retake.push('stance_mismatch');

  // ---- per group
  const groups: GroupScore[] = (Object.keys(groupsOf) as MeasureGroup[]).map((g) => {
    const ls = groupsOf[g];
    const weight = input.measure.weights[g] ?? 0;
    const coverage = ub.filter((p) => ls.every((k) => p[k])).length / BINS;
    const ds = path.map(([i, j]) => pairError(ub[i], rb[j], ls)).filter((x): x is number => x !== null);
    const measured = coverage >= MIN_GROUP_COVERAGE && ds.length > 0;
    const error = measured ? worstThird(ds) : null;
    return { id: g, label: GROUP_LABEL(g, lead), weight, measured, coverage, error, score: error === null ? null : toScore(error) };
  });
  const weighted = groups.filter((g) => g.weight > 0);
  const totalW = weighted.reduce((a, g) => a + g.weight, 0);
  const seenW = weighted.filter((g) => g.measured).reduce((a, g) => a + g.weight, 0);
  const legs = groups.find((g) => g.id === 'legs')!;
  if (legs.weight > 0 && !legs.measured) retake.push('body_cut_off');
  if (!totalW || seenW / totalW < 0.5) retake.push('insufficient');

  // ---- movement: the arms must actually move (any view: a straight punch towards the camera still moves the elbow)
  const strikeSide: Side = input.measure.strikeHand === 'rear' ? (lead === 'left' ? 'right' : 'left') : lead;
  const wrist = `${strikeSide}Wrist` as RefLandmark;
  const shoulder = `${strikeSide}Shoulder` as RefLandmark;
  const travel = (s: Pts[]) =>
    Math.max(0, ...(['leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'] as RefLandmark[]).map((k) => {
      const ps = s.map((p) => p[k]).filter((x): x is RefPoint => !!x);
      return ps.length < 2 ? 0 : Math.max(...ps.map((p) => dist(p, ps[0])));
    }));
  const tu = travel(ub);
  const tr = travel(rb);
  if (tr > 0.15 && tu < 0.25 * tr) retake.push('no_movement');

  // ---- timing: + = learner behind
  const timingOffset = path.length ? path.reduce((a, [i, j]) => a + (i - j), 0) / path.length / BINS : null;

  const blocking = retake.filter((r) => r !== 'body_cut_off' || legs.weight >= 0.3);
  const ok = !blocking.length;
  const score = ok ? Math.round(weighted.filter((g) => g.measured).reduce((a, g) => a + g.weight * (g.score ?? 0), 0) / seenW) : null;

  // ---- reliability
  const minCov = Math.min(...weighted.filter((g) => g.measured).map((g) => g.coverage), 1);
  const expected = (input.durationMs / 1000) * 15;
  if (input.frames.length < expected * 0.6) reliabilityReasons.push(`프레임 ${input.frames.length}개(기대 ${Math.round(expected)}개 이상)`);
  if (minCov < 0.85) reliabilityReasons.push(`관절 인식률 ${Math.round(minCov * 100)}%`);
  if (seenW < totalW) reliabilityReasons.push(`측정 못 한 부위: ${weighted.filter((g) => !g.measured).map((g) => g.label).join(', ')}`);
  if (retake.includes('body_cut_off') && ok) reliabilityReasons.push('다리 일부 미인식');
  const reliability: Compare3dResult['reliability'] = reliabilityReasons.length === 0 ? 'high' : reliabilityReasons.length === 1 && minCov >= 0.7 ? 'medium' : 'low';

  // ---- feedback (only from what was measured)
  const feedback: string[] = [];
  if (ok) {
    const phaseOf = (j: number) => {
      const t = ((j + 0.5) / BINS) * input.reference.durationSec;
      return input.phases.find((p) => t >= p.startSec && t <= p.endSec) ?? null;
    };
    let worst: { g: GroupScore; phase: MotionPhase; e: number } | null = null;
    for (const g of weighted.filter((x) => x.measured)) {
      const byPhase = new Map<MotionPhase, number[]>();
      for (const [i, j] of path) {
        const ph = phaseOf(j);
        const e = ph ? pairError(ub[i], rb[j], groupsOf[g.id]) : null;
        if (ph && e !== null) (byPhase.get(ph) ?? byPhase.set(ph, []).get(ph)!).push(e);
      }
      for (const [ph, ds] of byPhase) {
        const e = worstThird(ds);
        if (!worst || e * g.weight > worst.e * worst.g.weight) worst = { g, phase: ph, e };
      }
    }
    if (worst && toScore(worst.e) < 80) feedback.push(`${worst.phase.label} 구간에서 ${worst.g.label}의 위치가 기준과 가장 많이 다릅니다. 3D 시연의 ${worst.phase.label} 구간을 느리게 재생해 비교해 보세요.`);
    // reach is only visible across the camera (side / 45°); from the front or back the arm extends towards the lens
    if (input.measure.strike === 'straight' && (input.reference.angle === 'side' || input.reference.angle === 'diagonal')) {
      const reach = (s: Pts[]) => Math.max(0, ...s.map((p) => (p[wrist] && p[shoulder] ? dist(p[wrist]!, p[shoulder]!) : 0)));
      const ru = reach(ub);
      const rr = reach(rb);
      if (rr > 0 && ru > 0 && ru / rr < 0.8) feedback.push(`${strikeSide === 'left' ? '왼' : '오른'}손을 기준보다 덜 뻗었습니다(기준의 약 ${Math.round((ru / rr) * 100)}%). 어깨까지 따라 나가며 끝까지 뻗어 주세요.`);
    }
    if (timingOffset !== null && Math.abs(timingOffset) > 0.15) feedback.push(timingOffset > 0 ? '기준보다 늦게 시작했습니다. 카운트다운이 끝나는 순간 바로 시작해 보세요.' : '기준보다 일찍 동작이 끝났습니다. 가드로 돌아오는 동작까지 기준과 같은 속도로 해 보세요.');
    const best = weighted.filter((g) => g.measured && (g.score ?? 0) >= 80);
    if (best.length) feedback.push(`기준과 잘 맞은 부위: ${best.map((g) => g.label).join(', ')}.`);
  }
  return { ok, score, groups, reliability, reliabilityReasons, retake, feedback, timingOffset, frames: { total: input.frames.length, usable: nu.seq.pts.length }, lead, mirrored: input.mirror };
}

/** The shape the pose records, history chart and "AI에게 질문하기" already use (one metric per measured group). */
export function toAnalysisResult(techniqueId: string, r: Compare3dResult): PoseAnalysisResult | null {
  if (!r.ok || r.score === null) return null;
  const measured = r.groups.filter((g) => g.weight > 0);
  return {
    techniqueId,
    overallScore: r.score,
    status: classifyScore(r.score),
    metricScores: measured.map((g) => ({ id: `ref3d_${g.id}`, name: `${g.label} (3D 기준 일치도)`, score: g.score ?? 0, detail: g.measured ? `기준과의 차이 ${g.error!.toFixed(2)} (몸통 길이 단위), 인식률 ${Math.round(g.coverage * 100)}%` : '관절을 충분히 인식하지 못해 점수에 넣지 않았습니다.', ...(g.measured ? {} : { measured: false }) })),
    strengths: measured.filter((g) => g.measured && isStrength(g.score ?? 0)).map((g) => g.label),
    improvements: measured.filter((g) => g.measured && isImprovementArea(g.score ?? 0)).map((g) => g.label),
    frameCount: r.frames.usable,
  };
}
