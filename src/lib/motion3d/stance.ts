import { getProfile } from '../fighterProfile/store';
import { valueOf } from '../fighterProfile/catalog';
import type { MotionClip } from './types';

// The learner's stance from the fighter profile (기본 스탠스, body.stance) decides which version of a technique the
// 3D demo and the pose measurement use: a southpaw sees and is measured against the southpaw clip (lead hand =
// right) — a separately authored animation, not a mirrored screen. "switch" / unanswered → orthodox.

export type Stance = 'orthodox' | 'southpaw';

export function learnerStance(): Stance | null {
  try {
    const v = valueOf(getProfile(), 'body.stance');
    return v === 'southpaw' ? 'southpaw' : v === 'orthodox' ? 'orthodox' : null;
  } catch {
    return null;
  }
}

/** The clip in the learner's stance (orthodox when unknown), else the first clip. */
export function clipForStance<T extends Pick<MotionClip, 'stance'>>(clips: T[], stance: Stance | null): T | undefined {
  const want = stance ?? 'orthodox';
  return clips.find((c) => (c.stance ?? 'orthodox') === want) ?? clips[0];
}
