// 3D technique demo clips (data/curated/motion3d.json). A clip is linked to techniques by id only — the
// technique schema is untouched. One clip = one GLB + one animation, played by 1..n actors (2 for grappling).

// prepare / execute / finish (mocap jab); authored clips split the end into recover + guard_return
export type MotionPhaseName = 'prepare' | 'execute' | 'finish' | 'recover' | 'guard_return' | 'drive';

export interface MotionPhase {
  name: MotionPhaseName;
  label: string;
  startSec: number;
  endSec: number;
}

export interface MotionActor {
  id: string;
  role: string;
  label: string;
  rig: string;
  character: string;
  /** Node-name prefix that separates this actor's bones inside a multi-actor GLB (null = the only actor). */
  nodePrefix: string | null;
  /** Two-person demos: the colour of this actor's material (#rrggbb) — performer white, partner red. */
  color?: string;
}

/** Body groups the 3D-based pose measurement scores separately (lead/rear follow the clip's stance). */
export type MeasureGroup = 'leadArm' | 'rearArm' | 'torso' | 'legs';

export interface ClipMeasure {
  /** Relative weight of each group in the score (0 / absent = not scored). */
  weights: Partial<Record<MeasureGroup, number>>;
  /** The striking hand, for the reach feedback. */
  strikeHand?: 'lead' | 'rear';
  /** 'straight' strikes get a reach (extension) check; hooks do not. */
  strike?: 'straight' | 'hook';
}

export interface MotionClip {
  clipId: string;
  /** Shown when one technique has several demo versions. */
  variant: string;
  techniqueIds: string[];
  title: string;
  actors: MotionActor[];
  /** Relative to the app root (public/), e.g. "motion3d/boxing-jab-nw-v2.glb". */
  file: string;
  /** true: the GLB carries the character mesh too. false (later): animation-only GLB played on `actors[].character`. */
  embedsCharacter: boolean;
  /** Animation name inside the GLB (null = its first animation). */
  animation: string | null;
  fps: number;
  durationSec: number;
  frameCount: number;
  phases: MotionPhase[];
  /** 정면 camera preset: 'rest' = the rig's forward (authored clips: towards the opponent); default = chest at frame 0. */
  cameraFront?: 'rest' | 'pose';
  phaseMethod?: string;
  /** The stance the clip is performed in; a southpaw learner gets the mirrored version (lead hand = right). */
  stance?: 'orthodox' | 'southpaw';
  leadHand?: 'left' | 'right';
  rearHand?: 'left' | 'right';
  /** Angles the measurement may film from (default: all four). */
  captureAngles?: ('front' | 'diagonal' | 'side' | 'back')[];
  /** 3D-based pose measurement settings; a clip without it is shown but not used as a measurement reference. */
  measure?: ClipMeasure;
  /** Data version of this clip entry (bumped when the GLB or its metadata changes). */
  version?: string;
  source: Record<string, string>;
  license: Record<string, string>;
  pipeline: { name: string; version: string; steps?: string[]; report?: string };
  quality: { status: 'draft' | 'review' | 'approved'; verified: boolean; knownIssues: string[] };
}

export interface Motion3dCatalog {
  version: number;
  rigs: Record<string, { description: string; jointCount: number; up: string; units: string; forward: string }>;
  /** `file` (public/-relative GLB) is required for characters used by clips with embedsCharacter === false. */
  characters: Record<string, { description: string; rig: string; file?: string; license: { id: string; note?: string } }>;
  clips: MotionClip[];
}
