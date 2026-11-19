// Phase 1.3 evidence: Mesh2Motion findings, character/rig comparison, and the per-key review of the authored
// cross and hook (mesh intersections over the rest seams, floor, foot plant, sudden turns), tied to file hashes.
//   node .devtools/report-motion3d-strikes.mjs <rigTestDir> <reviewDir>
// (rigTestDir: scripts/motion3d/rig_pose_test.py outputs <label>-report.json for m2m-base, makehuman, fighter;
//  reviewDir: scripts/motion3d/strike_review.py outputs <clip>-review.json.) Writes data/audit/motion3d-strikes-m2m.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [rigDir, reviewDir] = process.argv.slice(2);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, f))).digest('hex');
const SEAM = /upperarm_.~torso|forearm_(.)~upperarm_\1/;

const rigReport = (label) => {
  const r = JSON.parse(fs.readFileSync(path.join(rigDir, `${label}-report.json`), 'utf8'));
  const rest = r.poses.rest.pairs;
  const poses = Object.fromEntries(
    Object.entries(r.poses).map(([p, row]) => [p, {
      newIntersections: Object.fromEntries(Object.entries(row.pairs).map(([k, v]) => [k, v - (rest[k] ?? 0)]).filter(([, v]) => v > 0)),
      skinAreaRatio: row.distortion,
    }]),
  );
  const worst = (re) => Math.max(...Object.values(r.poses).flatMap((row) => Object.entries(row.distortion).filter(([k]) => re.test(k)).map(([, v]) => v[1])));
  return { model: r.model, bones: r.bones, meshes: r.meshes, restSeamPairs: Object.fromEntries(Object.entries(rest).filter(([, v]) => v > 0)), maxSkinStretch: { arms: worst(/arm/), torso: worst(/torso/), thighs: worst(/thigh/), legs: worst(/leg/) }, poses };
};

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
    automatic: {
      nonSeamIntersections: nonSeam,
      seamOverlapMaxOverRest: seamMax,
      lowestSkin: lowest,
      plantedBallDriftCm: { l: +(drift.l * 100).toFixed(2), r: +(drift.r * 100).toFixed(2) },
      worldTurnsOver25DegPerKey: turns,
    },
    perKey: r.keys,
  };
};

const doc = {
  generatedBy: '.devtools/report-motion3d-strikes.mjs (2026-11-01)',
  mesh2motion: {
    repository: 'https://github.com/Mesh2Motion/mesh2motion-app',
    commit: 'ec0669b9a2258605c8df267e225cbfa64489a628 (2026-10-31)',
    sourceArtRepository: 'https://github.com/Mesh2Motion/mesh2motion-assets (CC0-1.0 LICENSE; Blender 4.5/5.0 sources — not openable in this machine\'s Blender 3.4, GLBs used instead)',
    licenses: {
      code: 'MIT (LICENSE-MIT.MD, Copyright (c) 2025 Scott Petrovic)',
      art: 'CC0 1.0 (LICENSE-CC0.MD: "All 3d models, blend files, rigs, animations")',
      perVariation: 'src/lib/RigConfig.ts: base = Quaternius (no override = CC0); sintel/jay/bunny = Blender Studio CC-BY; sophia = Tysan Tan CC-SA 4.0; psx-* = elbolilloduro (no override). Only the base model is used.',
    },
    humanRig: '66 joints incl. leaf bones, UE-mannequin names, fingers 3 joints + leaf, no twist bones; animations: rotation keys + pelvis location, no root motion (ANIMATOR-README.md); app animation GLBs use EXT_meshopt_compression',
    usedAssets: [{ file: 'static/assets/human/model.glb', as: 'public/motion3d/characters/m2m-human-base-v1.glb', sha256: sha('public/motion3d/characters/m2m-human-base-v1.glb'), modified: false }],
    notUsed: 'Mesh2Motion animations (punch-jab, punch-cross, melee-hook, fighting-idle) were downloaded for inspection only; the MARTIALDEX cross/hook are authored from scratch.',
  },
  rigComparison: { note: 'Same test poses on each rig (scripts/motion3d/rig_pose_test.py). skinAreaRatio = triangle area vs rest per region [min, max]; newIntersections = triangle pairs over the rest pose.', models: { mesh2motionBase: rigReport('m2m-base'), makehumanCurrent: rigReport('makehuman'), fighterLegacy: rigReport('fighter') } },
  clips: { cross: clipReview('boxing-cross-m2m-v1'), hook: clipReview('boxing-hook-m2m-v1') },
  humanVisualReview: 'NOT DONE by a person. The author (Claude) inspected renders (front/side/back/3-4/close-ups) of keys 0,10,13,15,18,22,26,33,40 — data/audit/motion3d-{cross,hook}-m2m-views.png — that is not a substitute for a coach/user review.',
};
const out = path.join(APP, 'data/audit/motion3d-strikes-m2m.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
console.log('written', out, fs.statSync(out).size);
for (const [k, c] of Object.entries(doc.clips)) console.log(k, JSON.stringify(c.automatic).slice(0, 400));
for (const [k, m] of Object.entries(doc.rigComparison.models)) console.log(k, JSON.stringify(m.maxSkinStretch));
