import { AnimationMixer, Vector3, type AnimationClip, type Bone, type Object3D } from 'three';
import type { PoseLandmarkName } from '../poseAnalysis/types';
import type { CaptureAngle } from '../timedCapture/reference';

// Reference joints for the 3D-based pose measurement, taken from the clip's own GLB: the animation is sampled on
// the capture's timeline (0 → one playback at 1.0x) and each MediaPipe landmark's matching bone is projected to
// the camera angle the learner films from — the same angles as the viewer's camera presets (front = the rig's
// facing, side = the character's left, back = 180°, diagonal = 45° towards the left).
// Projection is orthographic (x = screen right, y = screen down, metres); the comparison normalises scale.

export const ANGLE_OFFSET_DEG: Record<CaptureAngle, number> = { front: 0, diagonal: 45, side: 90, back: 180 };

export type RefLandmark = Exclude<PoseLandmarkName, 'nose'>;
/** Bone whose head sits where MediaPipe puts the landmark — UE-mannequin names (Mesh2Motion) or Mixamo names. */
export const LANDMARK_BONES: Record<RefLandmark, string[]> = {
  leftShoulder: ['upperarm_l', 'LeftArm'],
  rightShoulder: ['upperarm_r', 'RightArm'],
  leftElbow: ['lowerarm_l', 'LeftForeArm'],
  rightElbow: ['lowerarm_r', 'RightForeArm'],
  leftWrist: ['hand_l', 'LeftHand'],
  rightWrist: ['hand_r', 'RightHand'],
  leftHip: ['thigh_l', 'LeftUpLeg'],
  rightHip: ['thigh_r', 'RightUpLeg'],
  leftKnee: ['calf_l', 'LeftLeg'],
  rightKnee: ['calf_r', 'RightLeg'],
  leftAnkle: ['foot_l', 'LeftFoot'],
  rightAnkle: ['foot_r', 'RightFoot'],
};

export interface RefPoint {
  x: number;
  y: number;
}
export interface ReferencePoseFrame {
  /** Seconds from the start of the clip. */
  t: number;
  points: Partial<Record<RefLandmark, RefPoint>>;
}
export interface ReferencePoseTrack {
  angle: CaptureAngle;
  frontAzimuthDeg: number;
  sampleFps: number;
  durationSec: number;
  frames: ReferencePoseFrame[];
  /** Landmarks with no matching bone in this rig (never compared). */
  missing: RefLandmark[];
}

const bare = (name: string) => name.replace(/^mixamorig:?/, '');

export function collectBones(root: Object3D): Bone[] {
  const bones: Bone[] = [];
  root.traverse((o) => (o as Bone).isBone && bones.push(o as Bone));
  return bones;
}

/** Horizontal direction the chest faces: (left − right) × up over the hip and shoulder lines. */
export function facingAzimuth(bones: Bone[], prefix = ''): number {
  // prefix: two-person clips rename each actor's bones ("A_pelvis") — the performer's facing is the front
  const find = (suffix: string) => bones.find((b) => bare(b.name) === prefix + suffix);
  const lr = new Vector3();
  // Mixamo names (mma-mocap characters) or UE-mannequin names (Mesh2Motion human rig)
  for (const [l, r] of [['LeftUpLeg', 'RightUpLeg'], ['LeftArm', 'RightArm'], ['thigh_l', 'thigh_r'], ['upperarm_l', 'upperarm_r']]) {
    const lb = find(l);
    const rb = find(r);
    if (lb && rb) lr.add(lb.getWorldPosition(new Vector3()).sub(rb.getWorldPosition(new Vector3())));
  }
  const f = new Vector3().crossVectors(lr, new Vector3(0, 1, 0));
  if (f.lengthSq() < 1e-8) return 0;
  return (Math.atan2(f.x, f.z) * 180) / Math.PI;
}

/** World point → the 2D view of a camera at azimuth `azDeg` (the viewer's Spherical theta) looking at the character. */
export function projectToView(p: Vector3, azDeg: number): RefPoint {
  const a = (azDeg * Math.PI) / 180;
  // camera direction from the subject c = (sin a, 0, cos a); screen right = (−c) × up = (cos a, 0, −sin a)
  return { x: p.x * Math.cos(a) - p.z * Math.sin(a), y: -p.y };
}

/**
 * Samples `anim` on `root` (which must already carry the character's bones) at `sampleFps` from 0 to durationSec
 * inclusive, projecting every landmark bone to `angle`. Uses its own mixer and leaves the pose at t = 0; a viewer
 * sharing the model re-applies its own time afterwards.
 */
export function samplePoseTrack(root: Object3D, anim: AnimationClip, o: { durationSec: number; sampleFps: number; angle: CaptureAngle; frontAzimuthDeg: number }): ReferencePoseTrack {
  const bones = collectBones(root);
  const byName = new Map(bones.map((b) => [bare(b.name), b]));
  const pick = Object.fromEntries(Object.entries(LANDMARK_BONES).map(([lm, names]) => [lm, names.map((n) => byName.get(n)).find(Boolean) ?? null])) as Record<RefLandmark, Bone | null>;
  const missing = (Object.keys(pick) as RefLandmark[]).filter((k) => !pick[k]);
  const az = o.frontAzimuthDeg + ANGLE_OFFSET_DEG[o.angle];
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(anim);
  action.play();
  const n = Math.max(1, Math.round(o.durationSec * o.sampleFps));
  const frames: ReferencePoseFrame[] = [];
  const v = new Vector3();
  for (let i = 0; i <= n; i++) {
    const t = Math.min(o.durationSec, i / o.sampleFps);
    // setTime(duration) would wrap a looping action back to frame 0
    mixer.setTime(Math.min(t, anim.duration - 1e-4));
    root.updateMatrixWorld(true);
    const points: ReferencePoseFrame['points'] = {};
    for (const k of Object.keys(pick) as RefLandmark[]) {
      const b = pick[k];
      if (b) points[k] = projectToView(b.getWorldPosition(v), az);
    }
    frames.push({ t, points });
  }
  mixer.setTime(0);
  action.stop();
  mixer.uncacheAction(anim, root);
  mixer.uncacheRoot(root);
  return { angle: o.angle, frontAzimuthDeg: o.frontAzimuthDeg, sampleFps: o.sampleFps, durationSec: o.durationSec, frames, missing };
}
