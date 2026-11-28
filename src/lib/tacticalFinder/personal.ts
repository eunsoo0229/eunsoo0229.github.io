import { arts as profileArts, valueOf } from '../fighterProfile/catalog';
import { getProfile } from '../fighterProfile/store';
import { computeAllSkillProgress } from '../skillProgress/weaknessEngine';
import { MASTERY_LABEL, type MasteryStatus } from '../skillProgress/types';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { listFavorites } from '../userData';

// What the AI coach already knows about the user, read (never written) for ranking. Every source is optional: with no
// profile the finder works exactly the same, just without the personal points.

export interface PersonalContext {
  arts: string[];
  stance: 'orthodox' | 'southpaw' | null;
  mastery: Map<string, MasteryStatus>;
  favorites: Set<string>;
  /** Short labels of what was applied (shown under the results). */
  applied: string[];
}

export function readPersonal(): PersonalContext {
  const applied: string[] = [];
  let arts: string[] = [];
  let stance: PersonalContext['stance'] = null;
  try {
    const p = getProfile();
    arts = profileArts(p);
    const s = valueOf(p, 'body.stance');
    stance = s === 'southpaw' ? 'southpaw' : s === 'orthodox' ? 'orthodox' : null;
  } catch {
    // no profile
  }
  const mastery = new Map<string, MasteryStatus>();
  try {
    for (const e of computeAllSkillProgress()) if (e.progress.status !== 'not_started') mastery.set(canonicalTechniqueId(e.technique.id), e.progress.status);
  } catch {
    // no progress data
  }
  const favorites = new Set(listFavorites().map(canonicalTechniqueId));
  if (arts.length) applied.push(`수련 종목 (${arts.length}개)`);
  if (stance) applied.push(stance === 'southpaw' ? '사우스포 스탠스' : '오소독스 스탠스');
  if (mastery.size) applied.push(`기술 숙련도 기록 ${mastery.size}개`);
  if (favorites.size) applied.push(`즐겨찾기 ${favorites.size}개`);
  return { arts, stance, mastery, favorites, applied };
}

export function masteryLabel(ctx: PersonalContext | null, id: string): string | null {
  const s = ctx?.mastery.get(canonicalTechniqueId(id));
  return s ? MASTERY_LABEL[s] : null;
}
