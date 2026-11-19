"""Derived motion for a 3D demo clip: fixes measured landmark errors BEFORE retargeting. Reads an mma-mocap
multi-view canonical motion (+ the per-camera raw 2D detections), writes a NEW motion file in the same format.
Nothing in mma-mocap is changed. Run with mma-mocap's venv:

    mma-mocap/.venv/bin/python -I scripts/motion3d/refine_motion.py \
        mma-mocap/motion_data/adaptive/NW_JAB_canonical_motion.json <out_motion.json> [--report out.json]

Two corrections (Phase 1.2, boxing__jab). Each is driven by a reliability measured from the data itself;
fully reliable frames are returned unchanged.

1. Head (ears). The head frame is ear_mid->nose / right_ear->left_ear. When one ear is hidden in BOTH views
   (chin behind the lead shoulder at full extension), MediaPipe places it next to the visible ear in both images,
   so the point still triangulates (status 3) but the ears collapse: 9-10 cm apart -> 1.1 cm. A head's ear
   distance cannot change, so r(t) = ramp(ear_dist / median, 0.6 .. 0.9). Where r < 1 the ear offsets from the
   nose (measured, reliable), expressed in the chest frame, are interpolated between the surrounding reliable
   frames and blended with the measured offsets by r. Head position (nose) and torso motion are untouched.

2. Arms (elbow, wrist; index/pinky move with their wrist). During the jab the lead elbow/wrist are mostly NOT
   triangulated (single-camera ray / interpolated) and even triangulated frames reproject 15-25 px off one
   camera (the fist passes the partner's gloves). Per joint and axis a weighted Whittaker smoother
   (second-difference penalty, lam) is fitted to the components ACROSS the joint's principal path axis: weight =
   1/(1+(residual/12 px)^2) for triangulated points, 0.05 for ray+prior, 0 for interpolated. The component along
   the axis (the punch's progress and timing) is kept as measured. Well-observed frames stay where they are;
   unobserved depth no longer flips side from frame to frame. No target line or straight path is imposed.
"""
import argparse
import json
import os
import sys

import numpy as np

TRI, RAY, INTERP = 3, 2, 1


def chest_frame(X, names):
    ls, rs = X[names.index("left_shoulder")], X[names.index("right_shoulder")]
    lh, rh = X[names.index("left_hip")], X[names.index("right_hip")]
    side = ls - rs
    side /= np.linalg.norm(side)
    up = (ls + rs) / 2 - (lh + rh) / 2
    up -= side * np.dot(up, side)
    up /= np.linalg.norm(up)
    fwd = np.cross(side, up)
    return np.stack([side, up, fwd], axis=1)  # columns = chest axes in motion space


def ramp(x, lo, hi):
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0)


def whittaker(y, w, lam):
    n = len(y)
    D = np.diff(np.eye(n), 2, axis=0)
    A = np.diag(w) + lam * D.T @ D
    return np.linalg.solve(A, w * y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("motion")
    ap.add_argument("out")
    ap.add_argument("--report")
    ap.add_argument("--raw-dir", help="dir with <name>_<cam>_raw.json (default: next to the motion)")
    ap.add_argument("--lam", type=float, default=1.0, help="smoothness of the arm fit (1.0 = 5 Hz cut-off for fully weighted frames at 30 fps)")
    ap.add_argument("--px-scale", type=float, default=12.0)
    a = ap.parse_args()

    m = json.load(open(a.motion))
    names = m["joint_names"]
    frames = m["frames"]
    T = len(frames)
    ix = names.index
    X = np.array([np.asarray(f["persons"][0]["joints"], float)[:, 2:5] for f in frames])  # (T,33,3) motion space
    st = np.array([f["persons"][0]["status"] for f in frames])
    X_in = X.copy()
    report = {"source": a.motion, "frames": T}

    # ---- 1. head: ear collapse
    le, re, no = ix("left_ear"), ix("right_ear"), ix("nose")
    ear = np.linalg.norm(X[:, le] - X[:, re], axis=1)
    med = float(np.median(ear))
    r = ramp(ear / med, 0.6, 0.9)
    good = r >= 1.0
    offs = {}
    for j in (le, re):
        local = np.array([chest_frame(X[t], names).T @ (X[t, j] - X[t, no]) for t in range(T)])
        fixed = local.copy()
        gi = np.flatnonzero(good)
        for c in range(3):
            fixed[:, c] = np.interp(np.arange(T), gi, local[gi, c])
        blend = r[:, None] * local + (1 - r[:, None]) * fixed
        for t in range(T):
            X[t, j] = X[t, no] + chest_frame(X[t], names) @ blend[t]
        offs[names[j]] = float(np.max(np.linalg.norm(X[:, j] - X_in[:, j], axis=1)))
    report["head"] = {
        "earDistanceMedianCm": round(med * 100, 2),
        "earDistanceCm": [round(x * 100, 2) for x in ear],
        "reliability": [round(float(x), 3) for x in r],
        "unreliableFrames": [int(t) for t in np.flatnonzero(r < 1)],
        "maxEarMoveCm": {k: round(v * 100, 2) for k, v in offs.items()},
        "earDistanceAfterCm": [round(float(np.linalg.norm(X[t, le] - X[t, re])) * 100, 2) for t in range(T)],
    }

    # ---- 2. arms: reliability-weighted smoothing of elbow/wrist
    stem = os.path.basename(a.motion).replace("_canonical_motion.json", "")
    raw_dir = a.raw_dir or os.path.dirname(a.motion)
    cams = m["meta"]["adaptive"]["cameras"]  # {"a": "NW_JAB", "b": "NW_JAB2"}
    raw = {k: json.load(open(os.path.join(raw_dir, f"{stem}_{v}_raw.json"))) for k, v in cams.items()}

    def residual(t, j):
        p = frames[t]["persons"][0]
        worst = 0.0
        for k in cams:
            rp = np.asarray(p["reproj"][k][j], float)
            d = min(np.linalg.norm(np.asarray(q["joints"], float)[j, :2] - rp) for q in raw[k]["frames"][t]["persons"])
            worst = max(worst, d)
        return worst

    report["arms"] = {}
    for side in ("left", "right"):
        moved = {}
        for jn in (f"{side}_elbow", f"{side}_wrist"):
            j = ix(jn)
            w = np.zeros(T)
            res = np.zeros(T)
            for t in range(T):
                res[t] = residual(t, j)
                if st[t, j] == TRI:
                    w[t] = 1.0 / (1.0 + (res[t] / a.px_scale) ** 2)
                elif st[t, j] == RAY:
                    w[t] = 0.05
            if w.sum() < 1e-6:
                w[:] = 0.05
            w = np.maximum(w, 1e-4)
            # Smooth only ACROSS the joint's main path (principal axis of its trajectory = where the fist actually
            # travels). Along that axis the measured values are kept: they carry the punch timing (guard until the
            # snap), and the one-camera (ray) points observe it; the side-to-side flips are what is unobserved.
            Y = X_in[:, j]
            c0 = Y.mean(axis=0)
            axis = np.linalg.svd(Y - c0, full_matrices=False)[2][0]
            along = (Y - c0) @ axis
            perp = (Y - c0) - np.outer(along, axis)
            for c in range(3):
                perp[:, c] = whittaker(perp[:, c], w, a.lam)
            perp -= np.outer(perp @ axis, axis)
            X[:, j] = c0 + np.outer(along, axis) + perp
            moved[jn] = {"maxMoveCm": round(float(np.max(np.linalg.norm(X[:, j] - X_in[:, j], axis=1))) * 100, 2), "weights": [round(float(x), 3) for x in w], "residualPx": [round(float(x), 1) for x in res]}
        # hand landmarks keep their shape relative to the wrist
        d = X[:, ix(f"{side}_wrist")] - X_in[:, ix(f"{side}_wrist")]
        for jn in (f"{side}_index", f"{side}_pinky", f"{side}_thumb"):
            X[:, ix(jn)] = X_in[:, ix(jn)] + d
        report["arms"][side] = moved

    out = json.loads(json.dumps(m))
    for t, f in enumerate(out["frames"]):
        J = f["persons"][0]["joints"]
        for j in range(len(names)):
            J[j][2:5] = [round(float(v), 6) for v in X[t, j]]
    out["meta"]["refinement"] = {"by": "scripts/motion3d/refine_motion.py", "head": "ear-collapse interpolation", "arms": f"weighted Whittaker lam={a.lam}, px_scale={a.px_scale}", "status": "unchanged (reconstruction status of the original points)"}
    json.dump(out, open(a.out, "w"))
    if a.report:
        json.dump(report, open(a.report, "w"), indent=1)
    print("REFINED", a.out, "unreliable head frames", report["head"]["unreliableFrames"])


if __name__ == "__main__":
    sys.exit(main())
