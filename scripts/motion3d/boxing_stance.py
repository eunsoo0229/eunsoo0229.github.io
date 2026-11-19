"""Shared base pose for MARTIALDEX boxing animations: orthodox guard (left foot forward), Mesh2Motion human rig.

A pose STATE is a plain dict in the character frame (see rig_kit.Rig): techniques start from guard_state(), change
values over time, and call solve(). Arm targets are WRIST positions; `space: "chest"` means relative to the chest
(spine_03 head, character axes turned with the chest), `space: "world"` means the fixed character frame.
Angles in degrees; yaw > 0 turns towards the character's left (orthodox guard is turned right, so yaw < 0).
"""
import copy

from rig_kit import Rig  # noqa: F401  (type reference)

GAZE = (0.0, 2.2, 1.6)  # opponent's head, ~2 m in front


def guard_state():
    return {
        "pelvis": {"pos": (-0.01, -0.04, -0.06), "yaw": -30.0, "pitch": 3.0, "roll": 0.0},  # weight ~50/50 (Phase 4 COM audit)
        "spine": {"yaw": -10.0, "pitch": 8.0, "roll": 0.0},
        "clavicle": {"l": (0.0, 0.0), "r": (0.0, 0.0)},  # (protraction, elevation) degrees
        "arms": {
            # lead fist in front of the face at eye level, slightly outside; rear fist at the right cheek / chin
            "l": {"space": "chest", "target": (0.16, 0.34, 0.21), "pole": (0.35, 0.0, -1.0), "palm": (-0.75, 0.15, -0.35), "flex": 0.0},
            "r": {"space": "chest", "target": (-0.14, 0.19, 0.19), "pole": (-0.35, 0.0, -1.0), "palm": (0.7, 0.25, -0.25), "flex": 0.0},
        },
        "head": {"gaze": GAZE, "tuck": 6.0},  # chin down a little, eyes on the opponent
        "feet": {
            "l": {"ball": (0.14, 0.24), "yaw": -15.0, "lift": 0.0, "pole": (0.15, 1.0, 0.0)},
            "r": {"ball": (-0.17, -0.20), "yaw": -45.0, "lift": 12.0, "pole": (-0.25, 1.0, 0.0)},
        },
    }


def blend_states(a, b, t):
    """Element-wise interpolation of two states (numbers and tuples); `space` comes from b when t >= 0.5."""
    if isinstance(a, dict):
        return {k: blend_states(a[k], b[k], t) for k in a}
    if isinstance(a, (int, float)):
        return a + (b - a) * t
    if isinstance(a, tuple):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return b if t >= 0.5 else a


def deep(s):
    return copy.deepcopy(s)


def chest_frame(rig):
    """World rotation of the chest relative to rest, and the chest origin (spine_03 head)."""
    R = rig.world_rot("spine_03") @ rig.rest["spine_03"][2].transposed()
    return R, rig.head("spine_03")


def solve(rig, st, arm_override=None):
    """Pose the rig from a state. arm_override: optional {side: {"target", "pole", "palm"}} in WORLD vectors
    (the striking arm, interpolated by the author script between its guard and its strike)."""
    rig.reset()
    p = st["pelvis"]
    rig.move("pelvis", rig.rest["pelvis"][0] + rig.cv(*p["pos"]))
    rig.rotate("pelvis", rig.yaw(p["yaw"]))
    side = rig.yaw(p["yaw"]) @ rig.L
    fwd = rig.yaw(p["yaw"]) @ rig.F
    # pitch > 0 leans forward. Phase 1.3 used -pitch here, which leaned the body BACK (measured, Phase 4:
    # scripts/motion3d/com_audit.py — the v1 cross/hook held the shoulders ~15 deg behind the hips)
    rig.rotate("pelvis", rig.about(side, p["pitch"]))
    rig.rotate("pelvis", rig.about(fwd, p["roll"]))
    sp = st["spine"]
    for n, w in (("spine_01", 0.25), ("spine_02", 0.35), ("spine_03", 0.40)):
        rig.rotate(n, rig.yaw(sp["yaw"] * w))
        turned = rig.world_rot(n) @ rig.rest[n][2].transposed()  # this bone's turn from rest
        rig.rotate(n, rig.about(turned @ rig.L, sp["pitch"] * w))  # pitch > 0 leans forward
        rig.rotate(n, rig.about(turned @ rig.F, sp["roll"] * w))
    # clavicles: protraction (towards forward) / elevation (up)
    Rc, _ = chest_frame(rig)
    for s in ("l", "r"):
        pro, ele = st["clavicle"][s]
        if pro or ele:
            d = rig.axis(f"clavicle_{s}")
            f = Rc @ rig.F
            u = Rc @ rig.U
            rig.aim(f"clavicle_{s}", (d + f * _tan(pro) + u * _tan(ele)).normalized())
    # arms
    Rc, c0 = chest_frame(rig)
    for s in ("l", "r"):
        a = st["arms"][s]
        frame = Rc if a["space"] == "chest" else rig.yaw(0)
        target = c0 + Rc @ rig.cv(*a["target"]) if a["space"] == "chest" else rig.cp(*a["target"])
        pole = frame @ rig.cv(*a["pole"])
        palm = (frame @ rig.cv(*a["palm"])).normalized()
        if arm_override and s in arm_override:
            o = arm_override[s]
            target, pole, palm = o["target"], o["pole"], o["palm"]
        rig.ik2(f"upperarm_{s}", f"lowerarm_{s}", target, pole)
        rig.hand_follow(s)
        rig.palm(s, palm)
        if a.get("flex"):
            rig.hand_follow(s, a["flex"])
        rig.fist(s)
    # head: neck 40 % / head 60 % towards the gaze, then chin tuck
    h = st["head"]
    gaze = rig.cp(*h["gaze"])
    face_local = rig.rest["head"][2].transposed() @ rig.F
    # neck share of the head turn (default 40 %); a large look-around (Phase 6 hook gaze) turns mostly the head bone,
    # which keeps the head joint where the body put it instead of swinging the neck back
    for n, w in (("neck_01", h.get("neckShare", 0.4)), ("head", 1.0)):
        cur = rig.world_rot("head") @ face_local
        want = (gaze - rig.head("head")).normalized()
        q = cur.rotation_difference(want)
        rig.rotate(n, q.to_matrix() if w == 1.0 else _scale_rot(q, w))
    side_h = (rig.world_rot("head") @ (rig.rest["head"][2].transposed() @ rig.L))
    rig.rotate("head", rig.about(side_h, -h["tuck"]))
    # legs
    for s in ("l", "r"):
        f = st["feet"][s]
        rig.plant_foot(s, f["ball"], f["yaw"], f["lift"], rig.cv(*f["pole"]))


def _tan(deg):
    import math

    return math.tan(math.radians(deg))


def _scale_rot(q, w):
    from mathutils import Quaternion

    return Quaternion().slerp(q, w).to_matrix()


# ---- southpaw (Phase 4): the same technique in the opposite stance, re-solved — not a mirrored picture.
# The character frame is mirrored across its own sagittal plane (x -> -x): left/right entries swap, lateral
# coordinates and yaw / roll change sign; pitch, heights and forward distances are unchanged. solve() then runs
# the IK, planted feet and gaze on the real (unmirrored) skeleton, so a southpaw jab is a right-hand jab from a
# right-foot-forward stance.
def _mx(v):
    return (-v[0],) + tuple(v[1:])


def _swap(d):
    return {"l": d["r"], "r": d["l"]}


def mirror_state(st):
    m = deep(st)
    p = m["pelvis"]
    p["pos"], p["yaw"], p["roll"] = _mx(p["pos"]), -p["yaw"], -p["roll"]
    sp = m["spine"]
    sp["yaw"], sp["roll"] = -sp["yaw"], -sp["roll"]
    m["clavicle"] = _swap(m["clavicle"])
    arms = _swap(m["arms"])
    for a in arms.values():
        a["target"], a["pole"], a["palm"] = _mx(a["target"]), _mx(a["pole"]), _mx(a["palm"])
    m["arms"] = arms
    m["head"]["gaze"] = _mx(m["head"]["gaze"])
    feet = _swap(m["feet"])
    for f in feet.values():
        f["ball"], f["yaw"], f["pole"] = _mx(f["ball"]), -f["yaw"], _mx(f["pole"])
    m["feet"] = feet
    return m


def mirror_strike(strike):
    return {**strike, "side": "r" if strike["side"] == "l" else "l", "target": _mx(strike["target"]), "pole": _mx(strike["pole"]), "palm": _mx(strike["palm"])}
