// Frame-by-frame joint analysis of a motion GLB (no three.js — an independent check of what the viewer plays).
// For the arm chain it reports local rotations, frame-to-frame rotation change, quaternion sign flips, and
// forward-kinematics directions: forearm (elbow→wrist), hand (wrist→middle knuckle), wrist bend/twist.
//   node .devtools/analyze-motion3d-glb.mjs <file.glb> [--side Left|Right] [--json out.json] [--quiet]
import fs from 'node:fs';

// ---------- quaternion / matrix helpers (glTF: [x,y,z,w]) ----------
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qnorm = (q) => Math.hypot(...q);
export const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
/** Rotation angle (deg) between two orientations, sign-independent. */
export const qangle = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(qdot(a, b)) / (qnorm(a) * qnorm(b)))) * 180) / Math.PI;
export const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
  return [p[0], p[1], p[2]];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulv = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const len = (v) => Math.hypot(...v);
const unit = (v) => {
  const l = len(v);
  return l ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angv = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dotv(unit(a), unit(b))))) * 180) / Math.PI;
/** Twist (deg, signed) of q around unit axis `axis` (swing-twist decomposition). */
export function twistDeg(q, axis) {
  const proj = dotv([q[0], q[1], q[2]], axis);
  let t = [axis[0] * proj, axis[1] * proj, axis[2] * proj, q[3]];
  const n = qnorm(t);
  if (n < 1e-9) return 180;
  t = t.map((x) => x / n);
  if (t[3] < 0) t = t.map((x) => -x);
  return ((2 * Math.atan2(dotv([t[0], t[1], t[2]], axis), t[3])) * 180) / Math.PI;
}

// ---------- GLB reading ----------
export function readGlb(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    if (a.componentType !== 5126) throw new Error('only float accessors supported');
    const stride = bv.byteStride ?? comps * 4;
    const out = [];
    for (let k = 0; k < a.count; k++) {
      const off = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + k * stride;
      const v = [];
      for (let c = 0; c < comps; c++) v.push(buf.readFloatLE(off + c * 4));
      out.push(comps === 1 ? v[0] : v);
    }
    return out;
  };
  return { json, accessor };
}

export function analyze(path, { side = 'Left', animation = null } = {}) {
  const { json, accessor } = readGlb(path);
  const nodes = json.nodes.map((n, i) => ({ i, name: n.name, children: n.children ?? [], t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
  const parent = new Map();
  for (const n of nodes) for (const c of n.children) parent.set(c, n.i);
  const byName = (suffix) => nodes.find((n) => n.name === `mixamorig:${suffix}` || n.name === suffix);
  const anim = (animation ? json.animations.find((a) => a.name === animation) : null) ?? json.animations[0];
  const tracks = new Map(); // node index -> {translation, rotation, scale}
  let times = null;
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const tt = accessor(s.input);
    times ??= tt;
    const e = tracks.get(ch.target.node) ?? {};
    e[ch.target.path] = { values: accessor(s.output), interpolation: s.interpolation, times: tt };
    tracks.set(ch.target.node, e);
  }
  const F = times.length;
  const local = (ni, f) => {
    const n = nodes[ni];
    const tr = tracks.get(ni);
    return { t: tr?.translation?.values[f] ?? n.t, r: tr?.rotation?.values[f] ?? n.r, s: tr?.scale?.values[f] ?? n.s };
  };
  // world transform (rotation + position, uniform-ish scale folded in) by forward kinematics
  const world = (ni, f, memo) => {
    if (memo.has(ni)) return memo.get(ni);
    const L = local(ni, f);
    const p = parent.get(ni);
    let w;
    if (p === undefined) w = { r: L.r, p: L.t, s: L.s };
    else {
      const P = world(p, f, memo);
      w = { r: qmul(P.r, L.r), p: add(P.p, qrot(P.r, mulv(P.s, L.t))), s: mulv(P.s, L.s) };
    }
    memo.set(ni, w);
    return w;
  };
  const chain = ['Arm', 'ForeArm', 'Hand'].map((b) => byName(`${side}${b}`));
  const knuckle = byName(`${side}HandMiddle1`);
  const other = side === 'Left' ? 'Right' : 'Left';
  const watch = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', `${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`, `${other}Arm`, `${other}ForeArm`, `${other}Hand`, 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
  const animated = new Set([...tracks.keys()].map((i) => nodes[i].name));
  const problems = [];
  const frames = [];
  for (let f = 0; f < F; f++) {
    const memo = new Map();
    const [arm, fore, hand] = chain.map((n) => world(n.i, f, memo));
    const kn = world(knuckle.i, f, memo);
    const forearmDir = unit(sub(hand.p, fore.p));
    const handDir = unit(sub(kn.p, hand.p));
    // hand rotation relative to forearm, twist measured about the hand bone's own axis (its child direction)
    const rel = local(chain[2].i, f).r;
    const handAxisLocal = unit(knuckle.t); // middle1 offset in hand space ≈ bone axis
    const row = {
      frame: f,
      time: +times[f].toFixed(4),
      wristBendDeg: +angv(forearmDir, handDir).toFixed(2),
      handTwistDeg: +twistDeg(rel, handAxisLocal).toFixed(2),
      elbowDeg: +angv(sub(fore.p, arm.p), sub(hand.p, fore.p)).toFixed(2),
      forearmDir: forearmDir.map((x) => +x.toFixed(4)),
      handDir: handDir.map((x) => +x.toFixed(4)),
      wristPos: hand.p.map((x) => +x.toFixed(4)),
      local: {},
      delta: {},
    };
    for (const name of watch) {
      const n = byName(name);
      if (!n) continue;
      const q = local(n.i, f).r;
      row.local[name] = q.map((x) => +x.toFixed(5));
      if (q.some((x) => !Number.isFinite(x))) problems.push({ frame: f, joint: name, issue: 'non-finite quaternion' });
      else if (Math.abs(qnorm(q) - 1) > 1e-3) problems.push({ frame: f, joint: name, issue: `quaternion norm ${qnorm(q).toFixed(5)}` });
      if (f > 0) {
        const prev = local(n.i, f - 1).r;
        row.delta[name] = +qangle(prev, q).toFixed(3);
        if (tracks.get(n.i)?.rotation && qdot(prev, q) < 0) problems.push({ frame: f, joint: name, issue: 'quaternion sign flip vs previous key (LINEAR interpolation would take the long way)' });
      }
    }
    if (f > 0) {
      const p = frames[f - 1];
      row.handDirChangeDeg = +angv(p.handDir, handDir).toFixed(3);
      row.forearmDirChangeDeg = +angv(p.forearmDir, forearmDir).toFixed(3);
      row.wristBendChangeDeg = +Math.abs(row.wristBendDeg - p.wristBendDeg).toFixed(3);
      row.handTwistChangeDeg = +Math.abs(row.handTwistDeg - p.handTwistDeg).toFixed(3);
    }
    frames.push(row);
  }
  return {
    file: path,
    animation: anim.name,
    frameCount: F,
    fps: +((F - 1) / (times[F - 1] - times[0])).toFixed(3),
    interpolation: [...new Set(anim.samplers.map((s) => s.interpolation))],
    animatedJoints: [...animated].sort(),
    hierarchy: chain.map((n) => `${n.name} ← ${nodes[parent.get(n.i)]?.name}`),
    restLocal: Object.fromEntries(['ForeArm', 'Hand', 'HandMiddle1'].map((b) => [b, { t: byName(`${side}${b}`).t, r: byName(`${side}${b}`).r }])),
    problems,
    frames,
  };
}

// ---------- CLI ----------
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  const file = args[0];
  const side = args.includes('--side') ? args[args.indexOf('--side') + 1] : 'Left';
  const r = analyze(file, { side });
  if (args.includes('--json')) fs.writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify(r, null, 1));
  console.log(`${r.file}\n animation ${r.animation}, ${r.frameCount} keys, ${r.fps} fps, ${r.interpolation}`);
  console.log(` hierarchy: ${r.hierarchy.join(' | ')}`);
  console.log(` animated joints (${r.animatedJoints.length}): ${r.animatedJoints.join(', ')}`);
  console.log(` problems: ${r.problems.length ? JSON.stringify(r.problems.slice(0, 10)) : 'none'}`);
  if (!args.includes('--quiet')) {
    console.log(' frame  time   wristBend  Δhand  Δfore  handTwist Δtwist  elbow  Δ(Hand local) Δ(ForeArm local)');
    for (const f of r.frames)
      console.log(
        ` ${String(f.frame).padStart(3)}  ${f.time.toFixed(3)}  ${f.wristBendDeg.toFixed(1).padStart(7)}  ${String(f.handDirChangeDeg ?? '').padStart(6)} ${String(f.forearmDirChangeDeg ?? '').padStart(6)}  ${f.handTwistDeg.toFixed(1).padStart(7)} ${String(f.handTwistChangeDeg ?? '').padStart(6)}  ${f.elbowDeg.toFixed(1).padStart(5)}  ${String(f.delta[`${side}Hand`] ?? '').padStart(7)} ${String(f.delta[`${side}ForeArm`] ?? '').padStart(7)}`,
      );
  }
}

/** Whole-body checks for a jab-like clip (world space, glTF Y-up, metres). */
export function bodyQuality(path, { side = 'Left' } = {}) {
  const { json, accessor } = readGlb(path);
  const r = analyze(path, { side });
  const nodes = json.nodes;
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const idx = (s) => nodes.findIndex((n) => n.name === `mixamorig:${s}`);
  const anim = json.animations[0];
  const tr = new Map();
  for (const ch of anim.channels) {
    const e = tr.get(ch.target.node) ?? {};
    e[ch.target.path] = accessor(anim.samplers[ch.sampler].output);
    tr.set(ch.target.node, e);
  }
  const W = (f) => {
    const memo = new Map();
    const w = (i) => {
      if (memo.has(i)) return memo.get(i);
      const n = nodes[i];
      const L = { t: tr.get(i)?.translation?.[f] ?? n.translation ?? [0, 0, 0], r: tr.get(i)?.rotation?.[f] ?? n.rotation ?? [0, 0, 0, 1], s: tr.get(i)?.scale?.[f] ?? n.scale ?? [1, 1, 1] };
      const p = parent.get(i);
      const out = p === undefined ? { r: L.r, p: L.t, s: L.s } : (() => { const P = w(p); return { r: qmul(P.r, L.r), p: add(P.p, qrot(P.r, mulv(P.s, L.t))), s: mulv(P.s, L.s) }; })();
      memo.set(i, out);
      return out;
    };
    return (name) => w(idx(name));
  };
  const yaw = (v) => (Math.atan2(v[0], v[2]) * 180) / Math.PI;
  const horiz = (v) => [v[0], 0, v[2]];
  const F = r.frameCount;
  const rows = [];
  for (let f = 0; f < F; f++) {
    const at = W(f);
    const P = (n) => at(n).p;
    const lr = add(sub(P('LeftArm'), P('RightArm')), sub(P('LeftUpLeg'), P('RightUpLeg')));
    const facing = unit([-lr[2], 0, lr[0]]); // (left−right) × up
    const neckHead = unit(sub(P('Head'), P('Neck')));
    const right = unit([lr[0], 0, lr[2]]).map((x) => -x); // character's right
    const chin = P('Head');
    rows.push({
      frame: f,
      facingYaw: yaw(facing),
      shoulderYaw: yaw(unit([-(P('LeftArm')[2] - P('RightArm')[2]), 0, P('LeftArm')[0] - P('RightArm')[0]])),
      hipYaw: yaw(unit([-(P('LeftUpLeg')[2] - P('RightUpLeg')[2]), 0, P('LeftUpLeg')[0] - P('RightUpLeg')[0]])),
      headTiltDeg: angv(neckHead, [0, 1, 0]),
      // sideways lean of neck→head (+ = toward the character's right), forward lean (+ = toward facing)
      headSideDeg: (Math.asin(Math.max(-1, Math.min(1, dotv(neckHead, right)))) * 180) / Math.PI,
      headForwardDeg: (Math.asin(Math.max(-1, Math.min(1, dotv(neckHead, facing)))) * 180) / Math.PI,
      leadWrist: P(`${side}Hand`),
      leftKnee: angv(sub(P('LeftUpLeg'), P('LeftLeg')), sub(P('LeftFoot'), P('LeftLeg'))),
      rightKnee: angv(sub(P('RightUpLeg'), P('RightLeg')), sub(P('RightFoot'), P('RightLeg'))),
      leftFoot: P('LeftFoot'),
      rightFoot: P('RightFoot'),
      rearHandToChin: len(sub(P(`${side === 'Left' ? 'Right' : 'Left'}Hand`), chin)),
      // rear hand in front of the chest (+) or behind it (−), along the facing direction
      rearHandFront: dotv(sub(P(`${side === 'Left' ? 'Right' : 'Left'}Hand`), P('Spine2')), facing),
      hipsY: P('Hips')[1],
    });
  }
  const ext = r.frames.reduce((b, f) => (f.elbowDeg < b.elbowDeg ? f : b));
  const guard = r.frames[0];
  const punch = sub(r.frames[ext.frame].wristPos, guard.wristPos);
  const range = (k) => [Math.min(...rows.map((x) => x[k])), Math.max(...rows.map((x) => x[k]))].map((x) => +x.toFixed(2));
  const drift = (k) => +(Math.max(...rows.map((x) => len(sub(x[k], rows[0][k])))) * 100).toFixed(1);
  return {
    extensionFrame: ext.frame,
    punchYawVsFacingDeg: +(((yaw(horiz(punch)) - rows[0].facingYaw + 540) % 360) - 180).toFixed(1),
    punchVsForearmAtExtensionDeg: +angv(punch, r.frames[ext.frame].forearmDir).toFixed(1),
    facingYawRange: range('facingYaw'),
    shoulderYawRange: range('shoulderYaw'),
    hipYawRange: range('hipYaw'),
    headTiltDegRange: range('headTiltDeg'),
    headSideDegRange: range('headSideDeg'),
    headForwardDegRange: range('headForwardDeg'),
    leftKneeRange: range('leftKnee'),
    rightKneeRange: range('rightKnee'),
    footDriftCm: { left: drift('leftFoot'), right: drift('rightFoot') },
    rearHandToChinM: range('rearHandToChin'),
    rearHandFrontOfChestM: range('rearHandFront'),
    hipsHeightRangeM: range('hipsY'),
    wristBend: { max: Math.max(...r.frames.map((f) => f.wristBendDeg)), maxFrame: r.frames.reduce((b, f) => (f.wristBendDeg > b.wristBendDeg ? f : b)).frame },
    maxHandLocalDeltaDeg: Math.max(...r.frames.slice(1).map((f) => f.delta[`${side}Hand`])),
  };
}

/** World transform of every joint per key ({r, p}) — forward kinematics over the whole hierarchy. */
export function worldPose(path) {
  const { json, accessor } = readGlb(path);
  const nodes = json.nodes;
  const par = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => par.set(c, i)));
  const an = json.animations[0];
  const tr = new Map();
  for (const ch of an.channels) {
    const e = tr.get(ch.target.node) ?? {};
    e[ch.target.path] = accessor(an.samplers[ch.sampler].output);
    tr.set(ch.target.node, e);
  }
  const times = accessor(an.samplers[0].input);
  const idx = new Map(nodes.map((n, i) => [n.name.replace(/^mixamorig:/, ''), i]));
  return times.map((time, k) => {
    const m = new Map();
    const w = (i) => {
      if (m.has(i)) return m.get(i);
      const n = nodes[i];
      const L = { t: tr.get(i)?.translation?.[k] ?? n.translation ?? [0, 0, 0], r: tr.get(i)?.rotation?.[k] ?? n.rotation ?? [0, 0, 0, 1], s: tr.get(i)?.scale?.[k] ?? n.scale ?? [1, 1, 1] };
      const p = par.get(i);
      const o = p === undefined ? { r: L.r, p: L.t, s: L.s } : (() => { const P = w(p); return { r: qmul(P.r, L.r), p: add(P.p, qrot(P.r, mulv(P.s, L.t))), s: mulv(P.s, L.s) }; })();
      m.set(i, o);
      return o;
    };
    return { time, joint: (name) => w(idx.get(name)) };
  });
}

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Whole-body jab report (Phase 1.2): head/neck continuity, fist path in 3D and projected, guard hand vs chest.
 * Frames: guard = key `guardKey`, extension = max elbow extension of the lead arm. All world space (Y up, m).
 */
export function fullBodyReport(path, { lead = 'Left', guardKey = 10 } = {}) {
  const rear = lead === 'Left' ? 'Right' : 'Left';
  const W = worldPose(path);
  const L = analyze(path, { side: lead });
  const P = (k, n) => W[k].joint(n).p;
  const R = (k, n) => W[k].joint(n).r;
  const K = W.length;
  const ext = L.frames.reduce((b, f) => (f.elbowDeg < b.elbowDeg ? f : b)).frame;
  // character axes at the guard key (chest): side = left-right shoulders, up = world Y, facing = side x up
  const side0 = unit([P(guardKey, 'LeftArm')[0] - P(guardKey, 'RightArm')[0], 0, P(guardKey, 'LeftArm')[2] - P(guardKey, 'RightArm')[2]]);
  const facing0 = unit(cross3(side0, [0, 1, 0]));
  const fist = (k) => P(k, `${lead}HandMiddle1`);
  const g = fist(guardKey);
  const e = fist(ext);
  const dir = unit([e[0] - g[0], 0, e[2] - g[2]]); // horizontal punch direction (guard -> extension)
  const lat = unit(cross3([0, 1, 0], dir));
  const frames = [];
  for (let k = 0; k < K; k++) {
    const f = fist(k);
    const v = sub(f, g);
    const sp2 = P(k, 'Spine2');
    const sideK = unit(sub(P(k, 'LeftArm'), P(k, 'RightArm')));
    const facingK = unit(cross3(sideK, [0, 1, 0]));
    const rearHand = P(k, `${rear}HandMiddle1`);
    const rel = qmul(qconj(R(k, 'Spine2')), R(k, 'Head'));
    const rel0 = qmul(qconj(R(0, 'Spine2')), R(0, 'Head'));
    frames.push({
      key: k,
      time: +W[k].time.toFixed(4),
      head: P(k, 'Head').map((x) => +x.toFixed(4)),
      neck: P(k, 'Neck').map((x) => +x.toFixed(4)),
      headVsChestDeg: +qangle(rel, rel0).toFixed(2), // head orientation relative to the chest, vs key 0
      headDeltaDeg: L.frames[k].delta.Head ?? 0,
      neckDeltaDeg: L.frames[k].delta.Neck ?? 0,
      fist: f.map((x) => +x.toFixed(4)),
      fistAlongCm: +(dotv(v, dir) * 100).toFixed(2),
      fistLateralCm: +(dotv(v, lat) * 100).toFixed(2),
      fistVerticalCm: +(v[1] * 100).toFixed(2),
      // projections in the character's guard-time frame: front view (x = side, y = up), side view (x = facing, y = up)
      fistFront: [+(dotv(v, side0) * 100).toFixed(2), +(v[1] * 100).toFixed(2)],
      fistSide: [+(dotv(v, facing0) * 100).toFixed(2), +(v[1] * 100).toFixed(2)],
      leadElbow: P(k, `${lead}ForeArm`).map((x) => +x.toFixed(4)),
      leadShoulder: P(k, `${lead}Arm`).map((x) => +x.toFixed(4)),
      leadWrist: P(k, `${lead}Hand`).map((x) => +x.toFixed(4)),
      chest: sp2.map((x) => +x.toFixed(4)),
      pelvis: P(k, 'Hips').map((x) => +x.toFixed(4)),
      rearFist: rearHand.map((x) => +x.toFixed(4)),
      rearElbow: P(k, `${rear}ForeArm`).map((x) => +x.toFixed(4)),
      rearFistFrontOfChestCm: +(dotv(sub(rearHand, sp2), facingK) * 100).toFixed(2),
    });
  }
  for (let k = 1; k < K; k++) {
    const a = sub(frames[k].fist, frames[k - 1].fist);
    frames[k].fistSpeed = +(len(a) / (frames[k].time - frames[k - 1].time)).toFixed(3);
    if (k > 1) {
      const b = sub(frames[k - 1].fist, frames[k - 2].fist);
      frames[k].fistTurnDeg = len(a) > 0.005 && len(b) > 0.005 ? +angv(a, b).toFixed(2) : null; // direction change (moving keys only)
    }
  }
  const seg = frames.slice(guardKey, ext + 1);
  let pathLen = 0;
  for (let i = 1; i < seg.length; i++) pathLen += len(sub(seg[i].fist, seg[i - 1].fist));
  const straight = len(sub(e, g));
  const moving = seg.slice(2).filter((f) => f.fistTurnDeg !== null);
  return {
    file: path,
    keys: K,
    extensionKey: ext,
    guardKey,
    punch: {
      straightCm: +(straight * 100).toFixed(1),
      pathCm: +(pathLen * 100).toFixed(1),
      pathOverStraight: +(pathLen / straight).toFixed(3),
      maxLateralCm: +Math.max(...seg.map((f) => Math.abs(f.fistLateralCm))).toFixed(1),
      maxVerticalCm: +Math.max(...seg.map((f) => Math.abs(f.fistVerticalCm))).toFixed(1),
      lateralSignChanges: seg.slice(1).filter((f, i) => Math.abs(f.fistLateralCm) > 1 && Math.abs(seg[i].fistLateralCm) > 1 && Math.sign(f.fistLateralCm) !== Math.sign(seg[i].fistLateralCm)).length,
      maxTurnDegWhileMoving: moving.length ? Math.max(...moving.map((f) => f.fistTurnDeg)) : 0,
      punchYawVsFacingDeg: +((((Math.atan2(dir[0], dir[2]) - Math.atan2(facing0[0], facing0[2])) * 180) / Math.PI + 540) % 360 - 180).toFixed(1),
    },
    head: {
      maxHeadDeltaDeg: Math.max(...frames.slice(1).map((f) => f.headDeltaDeg)),
      maxNeckDeltaDeg: Math.max(...frames.slice(1).map((f) => f.neckDeltaDeg)),
      headVsChestRangeDeg: [Math.min(...frames.map((f) => f.headVsChestDeg)), Math.max(...frames.map((f) => f.headVsChestDeg))],
    },
    guard: { rearFistFrontOfChestCm: [Math.min(...frames.map((f) => f.rearFistFrontOfChestCm)), Math.max(...frames.map((f) => f.rearFistFrontOfChestCm))] },
    frames,
  };
}
