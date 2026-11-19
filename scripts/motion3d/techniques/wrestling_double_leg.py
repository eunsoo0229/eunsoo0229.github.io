"""wrestling__basic-double-leg — double leg takedown, two-person demonstration (A = performer, white; B = partner, red).
Authored keyframes on the Mesh2Motion human rig (Phase 5), no capture. A sports demonstration of the basic shape:

  keys 0-26   준비·레벨 체인지: both in stance; A lowers the hips (level change), hands low in front
  keys 26-40  진입: penetration step — A's lead foot steps deep between B's feet, head beside B's hip (outside,
              never into the body), both hands behind B's knees; B's hands come onto A's shoulders
  keys 40-62  드라이브: A drives forward off the rear foot and pulls the knees in; B's hips go back, B tips over
  keys 62-96  넘기기·상위 포지션: B lands on the back (controlled fall, chin tucked), A follows to the knees in top
              position, hands on B's hips
A safe demonstration: no slam, B is lowered (the fall takes ~0.6 s), contacts are hands on legs / shoulders.
Each actor's pose is written in its own frame (x = its left, y = its forward, z = up); B stands 1.30 m in front of A
facing A.
"""
from grapple_kit import Ref, blend, deep, keyed

META = {
    "id": "wrestling-double-leg-m2m-v2",
    "techniqueIds": ["wrestling__basic-double-leg"],
    "title": "더블렉 테이크다운 (2인 시연)",
    "fps": 30,
    "lastKey": 96,
    "phases": [("prepare", "준비·레벨 체인지", 0, 24), ("execute", "진입: 페네트레이션 스텝", 24, 38), ("drive", "드라이브: 뒷발 끌어오며 전진", 38, 62), ("finish", "넘기기·상위 포지션", 62, 96)],
    "placement": {"A": (0.0, 0.0, 0.0), "B": (0.0, 1.30, 180.0)},
    "actors": {"A": "performer", "B": "partner"},
}

OPEN = {"fist": False}
GRIP = (50.0, 65.0, 45.0)  # fingers curled round a leg / a shoulder
FLEX = 60.0  # posted palm: wrist bent back so the palm lies on B's chest


def arm(target, pole, palm=None, **kw):
    return {"target": target, "pole": pole, "palm": palm, **OPEN, **kw}


def plant(x, y, yaw=0.0, lift=0.0, pole=(0.0, 1.0, 0.0)):
    return {"plant": {"ball": (x, y), "yaw": yaw, "lift": lift, "pole": pole}}


# ---------------------------------------------------------------- A (performer)
A_STANCE = {
    "pelvis": {"pos": (0.0, 0.0, -0.12), "yaw": 0.0, "pitch": 18.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 14.0, "roll": 0.0},
    "head": {"gaze": (0.0, 1.30, 1.25), "tuck": 4.0},
    "arms": {"l": arm((0.20, 0.36, 1.18), (0.7, 0.0, -1.0), (0.0, 0.3, -1.0)), "r": arm((-0.20, 0.32, 1.14), (-0.7, 0.0, -1.0), (0.0, 0.3, -1.0))},
    "legs": {"l": plant(0.17, 0.20, -8.0, 4.0, (0.2, 1.0, 0.0)), "r": plant(-0.18, -0.22, -18.0, 18.0, (-0.2, 1.0, 0.0))},
}
A_LEVEL = deep(A_STANCE)
A_LEVEL["pelvis"].update({"pos": (0.0, 0.10, -0.36), "pitch": 28.0})
A_LEVEL["spine"].update({"pitch": 22.0})
A_LEVEL["head"].update({"gaze": (0.0, 1.30, 1.00)})
A_LEVEL["arms"] = {"l": arm((0.20, 0.55, 0.78), (0.8, 0.0, -0.6), (0.0, 0.5, -1.0)), "r": arm((-0.20, 0.55, 0.78), (-0.8, 0.0, -0.6), (0.0, 0.5, -1.0))}
# Phase 6 (v2): the feet do not slide — the level change happens over planted feet, then each foot STEPS (lifts,
# travels, plants): lead foot deep (penetration step, rear knee dropping low), rear foot up during the drive
A_LEVEL["legs"] = {"l": plant(0.17, 0.20, -8.0, 8.0, (0.2, 1.0, 0.0)), "r": plant(-0.18, -0.22, -18.0, 35.0, (-0.2, 1.0, 0.0))}

# penetration step: lead foot deep between B's feet, hips low, head to the left of B's right hip (A's +x side)
A_SHOT = deep(A_LEVEL)
A_SHOT["pelvis"].update({"pos": (0.10, 0.60, -0.40), "yaw": 6.0, "pitch": 34.0, "roll": 0.0})
A_SHOT["spine"].update({"yaw": 4.0, "pitch": 30.0, "roll": -6.0})
A_SHOT["head"] = {"gaze": (0.6, 2.4, 1.3), "tuck": -10.0}  # head up, eyes forward (posture), beside the hip
# hands behind B's knees: A's left hand on B's right leg (B faces A), offsets in B's frame (back = -y)
A_SHOT["arms"] = {
    # wrists on the OUTSIDE of B's knees, palms towards A, fingers wrapping the back of the knee
    "l": arm(Ref("B", "calf_r", 0.0, (-0.15, -0.06, -0.02)), (0.9, 0.0, -0.3), (0.0, -1.0, 0.0), curl=GRIP),
    "r": arm(Ref("B", "calf_l", 0.0, (0.15, -0.06, -0.02)), (-0.9, 0.0, -0.3), (0.0, -1.0, 0.0), curl=GRIP),
}
A_SHOT["legs"] = {"l": plant(0.10, 0.98, 0.0, 12.0, (0.2, 1.0, -0.2)), "r": plant(-0.18, 0.02, -10.0, 55.0, (-0.2, 1.0, -0.3))}

A_DRIVE = deep(A_SHOT)
A_DRIVE["pelvis"].update({"pos": (0.10, 0.92, -0.36), "pitch": 32.0})
A_DRIVE["spine"].update({"pitch": 26.0})
A_DRIVE["legs"] = {"l": plant(0.10, 1.10, 0.0, 20.0, (0.2, 1.0, -0.2)), "r": plant(-0.16, 0.42, -8.0, 60.0, (-0.2, 1.0, -0.4))}
A_DRIVE["arms"] = {
    "l": arm(Ref("B", "thigh_r", 0.85, (-0.15, -0.06, 0.0)), (0.9, 0.0, -0.2), (0.0, -1.0, 0.0), curl=GRIP),
    "r": arm(Ref("B", "thigh_l", 0.85, (0.15, -0.06, 0.0)), (-0.9, 0.0, -0.2), (0.0, -1.0, 0.0), curl=GRIP),
}

# top position: kneeling over B's hips, hands posted on B's chest (B's knees are up beside A's hips)
A_TOP = deep(A_DRIVE)
A_TOP["pelvis"].update({"pos": (0.0, 1.28, -0.40), "yaw": 0.0, "pitch": 36.0, "roll": 0.0})
A_TOP["spine"].update({"yaw": 0.0, "pitch": 26.0, "roll": 0.0})
A_TOP["head"] = {"gaze": (0.0, 2.6, 0.9), "tuck": 0.0}
A_TOP["legs"] = {"l": plant(0.20, 0.88, 0.0, 75.0, (0.1, 1.0, -0.6)), "r": plant(-0.20, 0.88, 0.0, 75.0, (-0.1, 1.0, -0.6))}
A_TOP["arms"] = {
    "l": arm(Ref("B", "spine_02", 0.0, (-0.13, 0.0, 0.22)), (0.8, 0.0, -0.4), (0.0, 0.0, -1.0), flex=FLEX),
    "r": arm(Ref("B", "spine_02", 0.0, (0.13, 0.0, 0.22)), (-0.8, 0.0, -0.4), (0.0, 0.0, -1.0), flex=FLEX),
}
A_HOLD = deep(A_TOP)
A_HOLD["spine"].update({"pitch": 18.0})
A_HOLD["pelvis"].update({"pitch": 30.0})

# ---------------------------------------------------------------- B (partner)
B_STANCE = {
    "pelvis": {"pos": (0.0, 0.0, -0.06), "yaw": 0.0, "pitch": 8.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 8.0, "roll": 0.0},
    "head": {"gaze": (0.0, 1.30, 1.40), "tuck": 4.0},
    "arms": {"l": arm((0.18, 0.34, 1.22), (0.7, 0.0, -1.0), (0.0, 0.3, -1.0)), "r": arm((-0.18, 0.34, 1.22), (-0.7, 0.0, -1.0), (0.0, 0.3, -1.0))},
    "legs": {"l": plant(0.15, 0.04, 0.0, 4.0), "r": plant(-0.15, -0.10, 0.0, 6.0)},
}
B_REACT = deep(B_STANCE)
B_REACT["pelvis"].update({"pos": (0.0, -0.04, -0.10), "pitch": 20.0})
B_REACT["spine"].update({"pitch": 16.0})
B_REACT["head"].update({"gaze": (0.0, 0.8, 0.7)})
# B's left hand on A's right shoulder (B faces A), a little above the shoulder joint
B_REACT["arms"] = {
    "l": arm(Ref("A", "upperarm_r", 0.15, (0.0, -0.04, 0.19)), (0.8, 0.0, -0.6), (0.0, 0.0, -1.0), curl=GRIP),
    "r": arm(Ref("A", "upperarm_l", 0.15, (0.0, -0.04, 0.19)), (-0.8, 0.0, -0.6), (0.0, 0.0, -1.0), curl=GRIP),
}
B_TIP = deep(B_REACT)
B_TIP["pelvis"].update({"pos": (0.0, -0.28, -0.16), "pitch": -18.0})
B_TIP["spine"].update({"pitch": -6.0})
B_TIP["head"] = {"gaze": (0.0, 1.0, 1.6), "tuck": 18.0}
B_TIP["legs"] = {"l": plant(0.12, 0.12, 0.0, 30.0), "r": plant(-0.12, 0.06, 0.0, 30.0)}
# airborne for a moment: knees pulled in by A, feet off the floor
B_FALL = deep(B_TIP)
B_FALL["pelvis"].update({"pos": (0.0, -0.30, -0.47), "pitch": -55.0})
B_FALL["spine"].update({"pitch": -4.0})
B_FALL["legs"] = {
    # knees held at A's arms, lower legs over them — bent, not stretched
    "l": {"ankle": (0.33, 0.45, 0.56), "pole": (0.5, 0.3, 1.0), "toes": (0.2, 0.6, 0.6)},
    "r": {"ankle": (-0.33, 0.43, 0.54), "pole": (-0.5, 0.3, 1.0), "toes": (-0.2, 0.6, 0.6)},
}
B_FALL["head"] = {"gaze": (0.0, 1.5, 2.2), "tuck": 25.0}
# landed on the back, knees up around A's hips, hands on A's arms (framing)
B_DOWN = deep(B_FALL)
B_DOWN["pelvis"].update({"pos": (0.0, -0.42, -0.76), "pitch": -86.0})
B_DOWN["spine"].update({"pitch": 0.0})
B_DOWN["legs"] = {
    # knees up, feet on the floor outside A's knees
    "l": {"ankle": (0.34, 0.02, 0.11), "pole": (0.5, 0.2, 1.0), "toes": (0.3, 1.0, -0.12)},
    "r": {"ankle": (-0.34, 0.02, 0.11), "pole": (-0.5, 0.2, 1.0), "toes": (-0.3, 1.0, -0.12)},
}
B_DOWN["head"] = {"gaze": (0.0, -0.2, 2.5), "tuck": 20.0}
B_DOWN["arms"] = {
    "l": arm(Ref("A", "lowerarm_r", 0.5, (0.0, 0.0, 0.16)), (0.9, 0.0, 0.2), (0.0, 0.0, -1.0)),
    "r": arm(Ref("A", "lowerarm_l", 0.5, (0.0, 0.0, 0.16)), (-0.9, 0.0, 0.2), (0.0, 0.0, -1.0)),
}

# ---- the steps (Phase 6)
A_STEP_LEAD = deep(A_LEVEL)  # lead foot in the air, hips already travelling forward
A_STEP_LEAD["pelvis"].update({"pos": (0.04, 0.32, -0.42), "pitch": 30.0})
A_STEP_LEAD["spine"].update({"pitch": 26.0})
A_STEP_LEAD["legs"] = {"l": {"ankle": (0.12, 0.62, 0.18), "pole": (0.2, 1.0, -0.1), "toes": (0.0, 1.0, -0.2)}, "r": plant(-0.18, -0.22, -18.0, 45.0, (-0.2, 1.0, -0.1))}
A_PEN = deep(A_SHOT)  # lead foot planted deep, hips low, the rear knee drops towards the mat (on the toes)
A_PEN["pelvis"].update({"pos": (0.08, 0.56, -0.46)})
A_PEN["legs"] = {"l": plant(0.10, 0.98, 0.0, 12.0, (0.2, 1.0, -0.2)), "r": plant(-0.18, -0.22, -12.0, 75.0, (-0.2, 1.0, -0.6))}
A_SHOT["legs"] = A_PEN["legs"]
A_STEP_REAR = deep(A_SHOT)  # drive: the rear foot comes up under the hips
A_STEP_REAR["pelvis"].update({"pos": (0.10, 0.78, -0.38)})
A_STEP_REAR["legs"] = {"l": plant(0.10, 0.98, 0.0, 16.0, (0.2, 1.0, -0.2)), "r": {"ankle": (-0.17, 0.30, 0.17), "pole": (-0.2, 1.0, -0.2), "toes": (0.0, 1.0, -0.2)}}
A_DRIVE["legs"] = {"l": plant(0.10, 0.98, 0.0, 20.0, (0.2, 1.0, -0.2)), "r": plant(-0.16, 0.62, -8.0, 55.0, (-0.2, 1.0, -0.4))}
A_STEP_TOP = deep(A_DRIVE)  # following B down: the rear foot steps up once more
A_STEP_TOP["legs"] = {"l": plant(0.10, 0.98, 0.0, 50.0, (0.1, 1.0, -0.5)), "r": {"ankle": (-0.19, 0.78, 0.15), "pole": (-0.1, 1.0, -0.4), "toes": (0.0, 1.0, -0.3)}}
A_TOP["legs"] = {"l": plant(0.12, 0.96, 0.0, 75.0, (0.1, 1.0, -0.6)), "r": plant(-0.20, 0.86, 0.0, 75.0, (-0.1, 1.0, -0.6))}
A_HOLD["legs"] = A_TOP["legs"]
# B's feet stay where they stand until they are lifted (no dragging)
B_TIP["legs"] = {"l": plant(0.15, 0.04, 0.0, 30.0), "r": plant(-0.15, -0.10, 0.0, 30.0)}

# lift-off / touch-down keys: a foot rises (almost) straight up before it travels and comes (almost) straight down
# before it plants — interpolating straight from planted to airborne would drag it along the floor
def _leg(state, side, leg):
    out = deep(state)
    out["legs"] = {**out["legs"], side: leg}
    return out


# the body at these keys is the blend of its neighbours (the hips keep travelling evenly); only the stepping leg is set
A_LEAD_UP = _leg(blend(A_LEVEL, A_STEP_LEAD, 0.3), "l", {"ankle": (0.17, 0.10, 0.17), "pole": (0.2, 1.0, 0.0), "toes": (0.0, 1.0, -0.3)})
A_LEAD_DOWN = _leg(blend(A_STEP_LEAD, A_PEN, 0.6), "l", {"ankle": (0.10, 0.88, 0.16), "pole": (0.2, 1.0, -0.2), "toes": (0.0, 1.0, -0.4)})
A_REAR_UP = _leg(blend(A_SHOT, A_STEP_REAR, 0.4), "r", {"ankle": (-0.18, -0.24, 0.19), "pole": (-0.2, 1.0, -0.4), "toes": (0.0, 1.0, -0.3)})
A_REAR_DOWN = _leg(blend(A_STEP_REAR, A_DRIVE, 0.6), "r", {"ankle": (-0.16, 0.55, 0.19), "pole": (-0.2, 1.0, -0.3), "toes": (0.0, 1.0, -0.4)})
A_TOP_UP = _leg(blend(A_DRIVE, A_STEP_TOP, 0.4), "r", {"ankle": (-0.16, 0.51, 0.22), "pole": (-0.2, 1.0, -0.4), "toes": (0.0, 1.0, -0.3)})
A_TOP_DOWN = _leg(blend(A_STEP_TOP, A_TOP, 0.55), "r", {"ankle": (-0.20, 0.83, 0.19), "pole": (-0.1, 1.0, -0.5), "toes": (0.0, 1.0, -0.6)})

A_KEYS = [(0, A_STANCE), (12, A_STANCE), (24, A_LEVEL), (26, A_LEAD_UP), (30, A_STEP_LEAD), (33, A_LEAD_DOWN), (35, A_PEN), (38, A_SHOT), (41, A_REAR_UP), (45, A_STEP_REAR), (48, A_REAR_DOWN), (50, A_DRIVE), (62, A_DRIVE), (65, A_TOP_UP), (69, A_STEP_TOP), (73, A_TOP_DOWN), (76, A_TOP), (96, A_HOLD)]
B_KEYS = [(0, B_STANCE), (26, B_STANCE), (36, B_REACT), (50, B_TIP), (62, B_FALL), (76, B_DOWN), (96, B_DOWN)]


def states(key):
    return {"A": keyed(A_KEYS, key), "B": keyed(B_KEYS, key)}


def measure(rigs):
    from grapple_kit import clearance

    a, b = rigs["A"], rigs["B"]
    return {
        "headToPartnerTorsoM": round(clearance(a, ["head"], b, ["pelvis", "spine_01", "spine_02", "spine_03"]), 3),
        "pelvisA": [round(v, 3) for v in a.head("pelvis")],
        "pelvisB": [round(v, 3) for v in b.head("pelvis")],
    }
