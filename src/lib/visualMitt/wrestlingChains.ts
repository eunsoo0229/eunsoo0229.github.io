import { attackSingles, defenseSingles, type DrillOptions, type DrillProfile } from './artDrills';
import { stepsForIds, type MittCombo } from './combos';

// 레슬링 연속 드릴 — long chains of real wrestling moves the holder calls in
// one go, the way a wrestling coach drills: "태클 → 스프롤 → 다운블락 → 태클".
// Your own shots (태클·싱글·하이 크로치·스냅 다운·레벨 체인지) are mixed with
// answers to the holder's shot (스프롤·다운블락·점프 스프롤·위저). Rules:
//   - never the same move twice in a row
//   - at most two defenses in a row, and a defense is followed by a re-attack
//     (스프롤 → 다운블락 → 태클), so the chain always ends on offense
//   - a level change / fake shot is followed by a real shot
// Every step is a REAL technique of the drill profile (artDrills.ts).

/** Small deterministic PRNG — the pool is the same every time it is built (and in tests). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ChainOptions {
  count?: number;
  minSteps?: number;
  maxSteps?: number;
  seed?: number;
}

/** Long call-and-move chains for the wrestling profile ([] for other profiles or when defenses are off and shots alone are too few). */
export function wrestlingChains(profile: DrillProfile, o: DrillOptions, c: ChainOptions = {}): MittCombo[] {
  if (profile.id !== 'wrestling') return [];
  const count = c.count ?? 30;
  const minSteps = c.minSteps ?? 3;
  const maxSteps = c.maxSteps ?? 6;
  const attacks = attackSingles(profile, o).map((x) => x.steps[0]);
  const defenses = o.withDefense ? defenseSingles(profile, o).map((x) => x.steps[0]) : [];
  const shots = attacks.filter((s) => s.motion.archetype.kind === 'entry');
  const setups = attacks.filter((s) => s.motion.archetype.kind !== 'entry');
  if (shots.length < 2) return [];
  const rand = mulberry32(c.seed ?? 20261025);
  const pick = <T,>(xs: T[], not?: string) => {
    const options = xs.filter((x) => (x as { techniqueId: string }).techniqueId !== not);
    return options.length ? options[Math.floor(rand() * options.length)] : null;
  };
  const out: MittCombo[] = [];
  const seen = new Set<string>();
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const len = minSteps + Math.floor(rand() * (maxSteps - minSteps + 1));
    const ids: string[] = [];
    let defRun = 0;
    while (ids.length < len) {
      const last = ids.at(-1);
      const lastStep = last ? [...attacks, ...defenses].find((s) => s.techniqueId === last) : undefined;
      const remaining = len - ids.length;
      let next: { techniqueId: string } | null;
      if (lastStep && lastStep.motion.archetype.kind !== 'entry' && lastStep.motion.archetype.kind !== 'defense') next = pick(shots, last); // feint / level change → a real shot
      else if (remaining === 1 || defRun >= 2) next = pick(shots, last); // end on offense; at most 2 defenses in a row
      else {
        const r = rand();
        next = defenses.length && r < 0.42 ? pick(defenses, last) : setups.length && r < 0.6 && remaining > 1 ? pick(setups, last) : pick(shots, last);
      }
      if (!next) break;
      const isDef = defenses.some((d) => d.techniqueId === next!.techniqueId);
      defRun = isDef ? defRun + 1 : 0;
      ids.push(next.techniqueId);
    }
    // a chain worth drilling mixes offense with at least one answer to the holder's shot (when defenses are on)
    if (ids.length < minSteps || (defenses.length && !ids.some((id) => defenses.some((d) => d.techniqueId === id)))) continue;
    const key = ids.join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    const steps = stepsForIds(ids);
    if (steps.length !== ids.length) continue;
    out.push({ id: `wchain:${key}`, name: steps.map((s) => s.technique.koreanName || s.technique.name).join(' → '), source: 'single', sourceLabel: `레슬링 연속 드릴 · ${steps.length}동작`, steps, skipped: [], warnings: [] });
  }
  return out;
}
