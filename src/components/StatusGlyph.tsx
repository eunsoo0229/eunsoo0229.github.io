import { Glyph } from './Icon';
import type { SkillStatus } from '../lib/poseAnalysis/types';
import type { MasteryStatus } from '../lib/skillProgress/types';

// Render-time mapping from the stored status keys (poseAnalysis SkillStatus, skillProgress
// MasteryStatus, formCompare verdicts) to the Forge 'status' set. The lib emoji maps
// (STATUS_ICON, MASTERY_ICON …) stay as they are for text-only uses.
type StatusName = 'not-started' | 'learning' | 'partial' | 'proficient' | 'needs-work';

const FOR_SKILL: Record<SkillStatus, StatusName> = {
  good: 'proficient',
  average: 'partial',
  needs_improvement: 'needs-work',
  not_analyzed: 'not-started',
};

const FOR_MASTERY: Record<MasteryStatus, StatusName> = {
  not_started: 'not-started',
  learning: 'learning',
  average: 'partial',
  proficient: 'proficient',
  needs_improvement: 'needs-work',
};

const FOR_VERDICT: Record<'match' | 'partial' | 'mismatch' | 'not_observable', StatusName> = {
  match: 'proficient',
  partial: 'partial',
  mismatch: 'needs-work',
  not_observable: 'not-started',
};

/** Pose-analysis score band (good / average / needs_improvement / not_analyzed). */
export function SkillStatusGlyph({ status }: { status: SkillStatus }) {
  return <Glyph set="status" name={FOR_SKILL[status]} />;
}

/** 5-state mastery (skillProgress). */
export function MasteryGlyph({ status }: { status: MasteryStatus }) {
  return <Glyph set="status" name={FOR_MASTERY[status]} />;
}

/** Form-compare per-check verdict. */
export function VerdictGlyph({ verdict }: { verdict: keyof typeof FOR_VERDICT }) {
  return <Glyph set="status" name={FOR_VERDICT[verdict]} />;
}
