"""Shared base poses for MARTIALDEX one-person demos (Phase 7), in grapple_kit state form so author_duo.py can solve them
with the same solver as the two-person clips: free legs (kicks, knees), Chest points (guard hands that turn with the
body), plain points (a fist on the target), floor poses (sprawl, hip escape, technical stand-up).

guard() is the orthodox fighting guard of boxing_stance.guard_state (Phase 4 weight / lean values) written as a
grapple_kit state: same pelvis, spine, chest-relative fists, gaze and planted feet — so a kick or an uppercut starts
from the stance the existing jab / cross / hook clips use.
Character frame: x = the performer's left, y = forward (towards the opponent), z = up, metres; yaw > 0 turns left.
"""
from grapple_kit import Chest, blend, deep, keyed  # noqa: F401  (re-exported for technique modules)
from rig_kit import ease_in_out, smoothstep  # noqa: F401

GAZE = (0.0, 2.2, 1.6)  # opponent's head, ~2 m in front
CHIN = (0.02, 0.62, 1.47)  # opponent's chin at punching range (boxing_cross STRIKE target)


def fist(target, pole, palm, **kw):
    """A fist. `target` is a chest-relative wrist offset (tuple -> Chest) or a ready point (Ref / Chest / _Lerp)."""
    t = Chest("A", target) if isinstance(target, tuple) else target
    return {"target": t, "pole": pole, "palm": palm, "fist": True, "space": "chest", **kw}


def at(point, pole, palm, **kw):
    """A fist on a fixed point of the character frame (a strike landing on the target)."""
    return {"target": point, "pole": pole, "palm": palm, "fist": True, "space": "chest", **kw}


def plant(x, y, yaw=0.0, lift=0.0, pole=(0.0, 1.0, 0.0)):
    return {"plant": {"ball": (x, y), "yaw": yaw, "lift": lift, "pole": pole}}


def free(ankle, pole, toes):
    return {"ankle": ankle, "pole": pole, "toes": toes}


def guard():
    return {
        "pelvis": {"pos": (-0.01, -0.04, -0.06), "yaw": -30.0, "pitch": 3.0, "roll": 0.0},
        "spine": {"yaw": -10.0, "pitch": 8.0, "roll": 0.0},
        "clavicle": {"l": (0.0, 0.0), "r": (0.0, 0.0)},
        "head": {"gaze": GAZE, "tuck": 6.0},
        "arms": {
            # lead fist in front of the face at eye level, slightly outside; rear fist at the right cheek / chin
            "l": fist((0.16, 0.34, 0.21), (0.35, 0.0, -1.0), (-0.75, 0.15, -0.35)),
            "r": fist((-0.14, 0.19, 0.19), (-0.35, 0.0, -1.0), (0.7, 0.25, -0.25)),
        },
        "legs": {
            "l": plant(0.14, 0.24, -15.0, 0.0, (0.15, 1.0, 0.0)),
            "r": plant(-0.17, -0.20, -45.0, 12.0, (-0.25, 1.0, 0.0)),
        },
    }


def with_leg(state, side, leg):
    out = deep(state)
    out["legs"] = {**out["legs"], side: leg}
    return out


def with_arm(state, side, a):
    out = deep(state)
    out["arms"] = {**out["arms"], side: a}
    return out


def solo_meta(id_, technique_id, title, last_key, phases, **extra):
    return {"id": id_, "techniqueIds": [technique_id], "title": title, "fps": 30, "lastKey": last_key, "phases": phases, "placement": {"A": (0.0, 0.0, 0.0)}, "actors": {"A": "performer"}, **extra}


def body_measure(rigs):
    """Per-key log for one-person clips: pelvis, both balls of the feet and both wrists (character frame) — the
    review reads balance (pelvis over the feet) and the strike path from it."""
    a = rigs["A"]
    pts = {"pelvis": a.head("pelvis"), "head": a.head("head"), "ball_l": a.head("ball_l"), "ball_r": a.head("ball_r"), "hand_l": a.head("hand_l"), "hand_r": a.head("hand_r"), "foot_l": a.head("foot_l"), "foot_r": a.head("foot_r")}
    return {"joints": {k: [round(v, 3) for v in a.to_char(p)] for k, p in pts.items()}}
