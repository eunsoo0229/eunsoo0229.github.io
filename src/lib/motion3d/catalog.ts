import { equivalentTechniqueIds } from '../techniqueCanonical';
import catalogData from '../../../data/curated/motion3d.json';
import type { Motion3dCatalog, MotionClip, MotionPhaseName } from './types';

// Same curated-merge pattern as poseAnalysis.json: a technique with no clip here simply has no 3D demo.
// Entries are validated once; a broken entry is dropped (and reported) instead of reaching the viewer.

const PHASES: MotionPhaseName[] = ['prepare', 'execute', 'finish', 'recover', 'guard_return', 'drive'];
const GLB_PATH = /^motion3d\/([\w.-]+\/)?[\w.-]+\.glb$/;

export function validateClip(raw: unknown, catalog: Pick<Motion3dCatalog, 'rigs'> & Partial<Pick<Motion3dCatalog, 'characters'>> = { rigs: {} }): { clip: MotionClip | null; problems: string[] } {
  const problems: string[] = [];
  const c = raw as Partial<MotionClip> | null;
  if (!c || typeof c !== 'object') return { clip: null, problems: ['not an object'] };
  if (typeof c.clipId !== 'string' || !c.clipId) problems.push('clipId missing');
  if (!Array.isArray(c.techniqueIds) || !c.techniqueIds.length || c.techniqueIds.some((id) => typeof id !== 'string' || !id)) problems.push('techniqueIds missing');
  if (typeof c.file !== 'string' || !GLB_PATH.test(c.file)) problems.push(`file must be motion3d/[dir/]<name>.glb: ${String(c.file)}`);
  if (!(typeof c.fps === 'number' && c.fps > 0 && c.fps <= 240)) problems.push('fps invalid');
  if (!(typeof c.durationSec === 'number' && c.durationSec > 0 && c.durationSec < 600)) problems.push('durationSec invalid');
  if (!(typeof c.frameCount === 'number' && c.frameCount >= 1)) problems.push('frameCount invalid');
  if (!Array.isArray(c.actors) || !c.actors.length) problems.push('actors missing');
  else
    for (const a of c.actors) {
      if (!a || typeof a.id !== 'string' || typeof a.rig !== 'string') problems.push('actor id/rig missing');
      else if (Object.keys(catalog.rigs).length && !catalog.rigs[a.rig]) problems.push(`unknown rig ${a.rig}`);
    }
  if (c.actors && c.actors.length > 1 && c.actors.some((a) => !a?.nodePrefix)) problems.push('multi-actor clips need a nodePrefix per actor');
  if (c.embedsCharacter === false && Array.isArray(c.actors)) {
    for (const a of c.actors) {
      const ch = a && catalog.characters?.[a.character];
      if (!ch || typeof ch.file !== 'string' || !GLB_PATH.test(ch.file)) problems.push(`animation-only clip needs a character with a motion3d/ file: ${String(a?.character)}`);
      else if (ch.rig !== a.rig) problems.push(`character ${a.character} is rig ${ch.rig}, the clip is ${a.rig}`);
    }
  }
  if (!Array.isArray(c.phases)) problems.push('phases missing');
  else {
    let prevEnd = 0;
    for (const p of c.phases) {
      if (!p || !PHASES.includes(p.name)) problems.push(`unknown phase ${String(p?.name)}`);
      else if (!(p.startSec >= 0 && p.endSec > p.startSec && p.endSec <= (c.durationSec ?? 0) + 1e-3)) problems.push(`phase ${p.name} out of range`);
      else if (p.startSec < prevEnd - 1e-3) problems.push(`phase ${p.name} overlaps the previous one`);
      else prevEnd = p.endSec;
    }
  }
  return { clip: problems.length ? null : (c as MotionClip), problems };
}

export function buildIndex(catalog: Motion3dCatalog): { clips: MotionClip[]; rejected: { clipId: string; problems: string[] }[] } {
  const clips: MotionClip[] = [];
  const rejected: { clipId: string; problems: string[] }[] = [];
  for (const raw of Array.isArray(catalog?.clips) ? catalog.clips : []) {
    const { clip, problems } = validateClip(raw, catalog);
    if (clip) clips.push(clip);
    else rejected.push({ clipId: String((raw as MotionClip)?.clipId ?? '?'), problems });
  }
  return { clips, rejected };
}

let index: ReturnType<typeof buildIndex> | null = null;
function getIndex() {
  if (!index) {
    index = buildIndex(catalogData as unknown as Motion3dCatalog);
    for (const r of index.rejected) console.warn('[motion3d] clip ignored', r.clipId, r.problems);
  }
  return index;
}

/** Demo clips for a technique: its own id first, then any id merged into the same canonical technique. */
export function motionClipsFor(techniqueId: string): MotionClip[] {
  const { clips } = getIndex();
  const direct = clips.filter((c) => c.techniqueIds.includes(techniqueId));
  if (direct.length) return direct;
  const ids = new Set(equivalentTechniqueIds(techniqueId));
  return clips.filter((c) => c.techniqueIds.some((id) => ids.has(id)));
}

/** The separate character GLB a clip plays on (null when the clip's GLB carries its own character). */
export function characterFileFor(clip: MotionClip): string | null {
  if (clip.embedsCharacter) return null;
  return (catalogData as unknown as Motion3dCatalog).characters[clip.actors[0].character]?.file ?? null;
}

export function hasMotion3d(techniqueId: string): boolean {
  return motionClipsFor(techniqueId).length > 0;
}
