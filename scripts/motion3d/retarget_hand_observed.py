"""Re-run mma-mocap's retarget (blender/scripts/apply_motion.py, UNCHANGED) with one change: the Hand-bone
reliability weight. Nothing in mma-mocap is edited; outputs go to --out-dir (outside mma-mocap).

Why (Phase 1.1, boxing__jab): mma-mocap V2 `hand_reliability.hand_weights` sets w=0 (hand follows the forearm)
only when the index/pinky landmarks are not triangulated AND the source wrist angle is > 90 deg. During the
jab the hand landmarks are mostly NOT triangulated (single-camera ray / interpolated depth), so 25-89 deg
"wrist bends" that come from unobserved depth pass through, and the w=0/1 border inside the punch makes the
hand jump (see .devtools/analyze-motion3d-glb.mjs and data/audit/motion3d-jab-wrist.json).

--hand-mode observed: w(t)=1 only when the wrist, index and pinky landmarks are all TRIANGULATED (depth seen
by both cameras); otherwise the hand follows the forearm. The angle exception is dropped: an unobserved depth
is never used, whatever angle it produces. Observed frames are weighted by V2's centred 5-frame average of
`seen`, so the source hand ramps in/out instead of popping, and an unobserved frame always stays at w=0.
Triangulated frames keep the source hand direction at any angle (measured data is not overridden).
--hand-mode v2: the original mma-mocap function (used to prove this wrapper reproduces the V2 GLB exactly).
--guard-clearance <report.json>: Phase 1.2 — keep the hands out of the character's own torso (guard_clearance.py).
Phase 1.2 also feeds a refined motion file (refine_motion.py) as --motion; the hand rule above is unchanged.

    MMA_MOCAP=/path/to/mma-mocap blender -b --factory-startup -P scripts/motion3d/retarget_hand_observed.py -- \
        --hand-mode observed --motion <abs motion.json> --name X --rig <abs COPY of rig.blend> \
        --out-prefix MMA-Fighter_human --out-dir <abs dir> --hand-reliability --bake-helpers
"""
import os
import runpy
import sys

import numpy as np

MOCAP = os.environ.get("MMA_MOCAP") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "mma-mocap")
MOCAP = os.path.abspath(MOCAP)
sys.path.insert(0, MOCAP)
import src.mocap.hand_reliability as hr  # noqa: E402

argv = sys.argv
mode = "v2"
if "--hand-mode" in argv:
    i = argv.index("--hand-mode")
    mode = argv[i + 1]
    del argv[i : i + 2]
if mode not in ("v2", "observed"):
    raise SystemExit(f"unknown --hand-mode {mode}")

TRIANGULATED = hr.TRIANGULATED


def observed_hand_weights(motion, window=5, sides=("left", "right"), max_wrist_deg=None):
    names = motion["joint_names"]
    frames = motion["frames"]
    out = {}
    for side in sides:
        if not all("status" in fr["persons"][0] for fr in frames):
            out[side] = np.ones(len(frames))  # single-view motion: unchanged, like V2
            continue
        st = np.array([fr["persons"][0]["status"] for fr in frames])
        seen = np.ones(len(frames), bool)
        for j in (f"{side}_wrist", f"{side}_index", f"{side}_pinky"):
            seen &= st[:, names.index(j)] == TRIANGULATED
        w = seen.astype(float)
        if window > 1:
            # Ramp in/out like V2's centred average, but only ON observed frames: smoothing the weight alone
            # would hand an unobserved neighbour 20-60 % of its (wrong-depth) hand direction.
            k = np.ones(window) / window
            w = seen * np.convolve(np.pad(w, window // 2, mode="edge"), k, mode="valid")
        out[side] = w
    return out


guard = None
if "--guard-clearance" in argv:
    i = argv.index("--guard-clearance")
    guard = argv[i + 1]  # report path (json) for the per-frame push
    del argv[i : i + 2]

if mode == "observed":
    hr.hand_weights = observed_hand_weights
if guard:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import guard_clearance  # noqa: E402
    from src.mocap.retarget_math import Retargeter  # noqa: E402

    guard_clearance.install(Retargeter, report_path=guard, swivel_max_deg=int(os.environ.get("GUARD_SWIVEL_MAX_DEG", "45")))
print(f"HAND_MODE {mode} GUARD_CLEARANCE {'on' if guard else 'off'}")
runpy.run_path(os.path.join(MOCAP, "blender", "scripts", "apply_motion.py"), run_name="__main__")
