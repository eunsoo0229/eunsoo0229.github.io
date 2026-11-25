"""bjj__hip-escape — hip escape ("shrimp"), one person on the mat. Authored keyframes on the Mesh2Motion human rig
(Phase 7), no capture.

Mechanics shown (public coaching basics): from the back with the knees up and the forearms framing in front of the
chest, turn onto the side (here the left side), push off the planted right foot and drive the HIPS back (away from the
frames) — the body makes a C shape: shoulders stay, hips go back, knees and hands stay in front — then the knee comes
back in front (guard recovered) and the body turns flat again, ready to repeat.
  keys  0-10  준비: on the back, knees up, frames
  keys 10-22  전환: turn onto the left side, right foot planted, frames out
  keys 22-36  실행: push off the foot, hips back (C shape)
  keys 36-48  유지: knee in front (guard recovered)
  keys 48-66  복귀: turn flat on the back again
"""
from solo_kit import Chest, body_measure, deep, free, keyed, plant, solo_meta

META = solo_meta(
    "bjj-hip-escape-m2m-v1",
    "bjj__hip-escape",
    "힙 이스케이프 (새우빼기, 왼쪽으로 눕기)",
    66,
    [("prepare", "준비: 등 대고 누워 프레임", 0, 10), ("transition", "옆으로 돌기·발 딛기", 10, 22), ("execute", "실행: 발로 밀어 골반 빼기", 22, 36), ("hold", "무릎 넣기 (가드 회복)", 36, 48), ("recover", "다시 등 대고 눕기", 48, 66)],
    side="turning to the left side",
)


def hand(off, pole, **kw):
    # frames: forearms up in front of the chest, hands open (chest frame: y = out of the chest, z = towards the head)
    return {"target": Chest("A", off), "pole": pole, "palm": (0.0, 0.3, 1.0), "fist": False, "curl": (20.0, 25.0, 15.0), "space": "chest", **kw}


BACK = {
    "pelvis": {"pos": (0.0, 0.0, -0.80), "yaw": 0.0, "pitch": -88.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 8.0, "roll": 0.0},  # shoulders a little off the mat (chin tucked)
    "clavicle": {"l": (0.0, 0.0), "r": (0.0, 0.0)},
    "head": {"gaze": (0.0, 0.9, 0.9), "tuck": 18.0},
    "arms": {"l": hand((0.11, 0.26, 0.04), (0.6, 0.0, -1.0)), "r": hand((-0.11, 0.26, 0.04), (-0.6, 0.0, -1.0))},
    "legs": {"l": plant(0.16, 0.42, 6.0, 0.0, (0.3, 0.2, 1.0)), "r": plant(-0.16, 0.42, -6.0, 0.0, (-0.3, 0.2, 1.0))},
}

# on the left side: the body turns about its long axis (roll < 0 turns the belly to the left), the right foot stays
# planted, the left (bottom) leg lies bent on the mat
SIDE = deep(BACK)
SIDE["pelvis"].update({"pos": (0.0, 0.0, -0.72), "roll": -58.0})
SIDE["spine"].update({"pitch": 10.0})
SIDE["head"] = {"gaze": (0.9, 0.6, 0.3), "tuck": 16.0}
# frames apart: the bottom (left) forearm low towards the hips, the top (right) forearm higher towards the head
BOTTOM = {"target": (0.30, -0.30, 0.13), "pole": (1.0, 0.3, 0.4), "palm": (0.0, 0.0, -1.0), "fist": False, "curl": (20.0, 25.0, 15.0)}  # bottom forearm on the mat in front of the chest
SIDE["arms"] = {"l": BOTTOM, "r": hand((-0.10, 0.30, 0.14), (-0.5, 0.0, -1.0))}
SIDE["legs"] = {
    "l": free((0.30, 0.36, 0.10), (0.9, 0.3, 0.2), (0.4, 1.0, 0.0)),
    "r": plant(-0.16, 0.42, -6.0, 6.0, (0.6, 0.3, 1.0)),  # the right foot stays on its spot
}

# hips driven back (to the right, away from the frames); shoulders stay, the body bends into a C about the vertical
ESCAPE = deep(SIDE)
ESCAPE["pelvis"].update({"pos": (-0.30, -0.04, -0.72), "yaw": 34.0, "roll": -60.0})
ESCAPE["spine"].update({"yaw": -44.0, "pitch": 10.0})
ESCAPE["legs"] = {
    "l": free((0.10, 0.52, 0.10), (0.9, 0.4, 0.2), (0.5, 1.0, 0.0)),
    "r": plant(-0.16, 0.42, -6.0, 30.0, (0.6, 0.3, 1.0)),  # the pushing foot stays where it was, on its ball
}
ESCAPE["arms"] = {"l": {**BOTTOM, "target": (0.30, -0.30, 0.11)}, "r": hand((-0.08, 0.36, 0.14), (-0.5, 0.0, -1.0))}

# the top knee comes through in front (guard recovered)
KNEE_IN = deep(ESCAPE)
KNEE_IN["legs"] = {
    "l": free((0.12, 0.40, 0.10), (0.9, 0.5, 0.2), (0.5, 1.0, 0.0)),
    "r": free((0.02, 0.30, 0.30), (0.8, 0.6, 0.6), (0.5, 1.0, 0.2)),
}

KEYS = [(0, BACK), (10, BACK), (22, SIDE), (34, ESCAPE), (36, ESCAPE), (46, KNEE_IN), (48, KNEE_IN), (58, SIDE), (66, BACK)]
# the bottom (left) arm has its own key track: from the frame it lowers in front of the chest before it lies on the mat
LOWER = {**BOTTOM, "target": (0.36, -0.32, 0.30), "pole": (1.0, 0.2, 0.2), "palm": (0.0, -0.7, -0.7)}
ARM_L = [(0, BACK["arms"]["l"]), (10, BACK["arms"]["l"]), (16, LOWER), (22, SIDE["arms"]["l"]), (34, ESCAPE["arms"]["l"]), (58, SIDE["arms"]["l"]), (62, LOWER), (66, BACK["arms"]["l"])]


def states(key):
    st = keyed(KEYS, key)
    st["arms"] = {**st["arms"], "l": keyed(ARM_L, key)}
    return {"A": st}


def measure(rigs):
    return body_measure(rigs)
