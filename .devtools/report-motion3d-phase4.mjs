// Phase 4 evidence: the per-key mesh review (scripts/motion3d/strike_review.py) of the re-authored jab / cross /
// hook in both stances, tied to file hashes — same rules as report-motion3d-strikes.mjs (Phase 1.3, whose audit of
// the v1 clips is kept unchanged). Centre of mass: data/audit/motion3d-phase4-com.json (scripts/motion3d/com_audit.py).
//   node .devtools/report-motion3d-phase4.mjs <reviewDir>      → data/audit/motion3d-strikes-m2m-v2.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [reviewDir] = process.argv.slice(2);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, f))).digest('hex');
const SEAM = /upperarm_.~torso|forearm_(.)~upperarm_\1/;
const IDS = ['boxing-jab-m2m-v1', 'boxing-cross-m2m-v2', 'boxing-hook-m2m-v2'].flatMap((id) => [id, `${id}-southpaw`]);

const clipReview = (id) => {
  const r = JSON.parse(fs.readFileSync(path.join(reviewDir, `${id}-review.json`), 'utf8'));
  const b0 = r.keys[0].ball;
  const nonSeam = [];
  const seamMax = {};
  let lowest = { z: 1 };
  const drift = { l: 0, r: 0 };
  for (const k of r.keys) {
    if (k.lowestSkinZ < lowest.z) lowest = { z: k.lowestSkinZ, key: k.key, bone: k.lowestSkinBone };
    for (const [pair, n] of Object.entries(k.newIntersections)) {
      if (SEAM.test(pair)) seamMax[pair] = Math.max(seamMax[pair] ?? 0, n);
      else nonSeam.push({ key: k.key, pair, triPairs: n });
    }
    for (const s of ['l', 'r']) drift[s] = Math.max(drift[s], Math.hypot(...k.ball[s].map((x, i) => x - b0[s][i])));
  }
  const turns = r.keys.flatMap((k) => Object.entries(k.boneWorldDeltaDeg).filter(([n, d]) => d > 25 && !/_0[234]|leaf/.test(n)).map(([n, d]) => ({ key: k.key, bone: n, deg: d })));
  return {
    animation: `public/motion3d/anims/${id}.glb`,
    sha256: sha(`public/motion3d/anims/${id}.glb`),
    bonesMissingOnCharacter: r.bonesMissingOnCharacter,
    automatic: { nonSeamIntersections: nonSeam, seamOverlapMaxOverRest: seamMax, lowestSkin: lowest, plantedBallDriftCm: { l: +(drift.l * 100).toFixed(2), r: +(drift.r * 100).toFixed(2) }, worldTurnsOver25DegPerKey: turns },
    perKey: r.keys,
  };
};

const doc = {
  generatedBy: '.devtools/report-motion3d-phase4.mjs (2026-11-02)',
  changes: [
    'boxing_stance.solve: pitch sign fixed (Phase 1.3 leaned the body back for a forward pitch)',
    'guard weight ~50/50 (pelvis −3 cm); cross contact COM ~0.7 towards the lead foot, head over the lead leg; hook contact centred, head over the hips',
    'new: boxing-jab-m2m-v1 on the Mesh2Motion rig (replaces the mocap jab as default; the mocap clip stays as a variant, files unchanged)',
    'southpaw: every clip re-solved from the mirrored state (boxing_stance.mirror_state) — separate GLBs',
  ],
  clips: Object.fromEntries(IDS.map((id) => [id, clipReview(id)])),
  humanVisualReview: 'NOT DONE by a person. The author (Claude) inspected renders of the guard and contact keys (front / 3-4 / side) — data/audit/motion3d-phase4-*.png — not a substitute for a coach/user review.',
};
const out = path.join(APP, 'data/audit/motion3d-strikes-m2m-v2.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
for (const [id, c] of Object.entries(doc.clips)) console.log(id.padEnd(30), 'nonSeam', c.automatic.nonSeamIntersections.length, 'lowest', c.automatic.lowestSkin.z, 'drift', JSON.stringify(c.automatic.plantedBallDriftCm), 'turns>25', c.automatic.worldTurnsOver25DegPerKey.length);
