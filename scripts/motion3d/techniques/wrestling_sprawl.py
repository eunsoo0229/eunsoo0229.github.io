"""wrestling__sprawl — sprawl (takedown defence), one person. Authored keyframes on the Mesh2Motion human rig (Phase 7),
no capture.

Mechanics shown (public coaching basics): from a wrestling stance the hips drop to the mat as both legs shoot BACK and
wide (on the toes, legs long), the hands come down in front to the mat, the chest is heavy and the head stays UP with
the eyes forward — the hips, not the knees, go to the floor; then the feet hop back under the hips and the wrestler
comes back up into stance.
  keys  0-10  준비: wrestling stance
  keys 10-26  실행: hips drop, legs shoot back and wide (feet leave and land), hands to the mat
  keys 26-44  유지: hips heavy on the mat, head up
  keys 44-62  회수: feet hop back under the hips, up into stance
  keys 62-74  자세 복귀
"""
from solo_kit import Chest, body_measure, deep, free, keyed, plant, solo_meta

META = solo_meta(
    "wrestling-sprawl-m2m-v1",
    "wrestling__sprawl",
    "스프롤 (태클 방어)",
    74,
    [("prepare", "준비: 레슬링 자세", 0, 10), ("execute", "실행: 다리를 뒤로 뻗으며 골반 내리기", 10, 26), ("hold", "유지: 골반 무겁게·머리 들기", 26, 44), ("recover", "회수: 발 당겨 일어나기", 44, 62), ("guard_return", "자세 복귀", 62, 74)],
    side="square wrestling stance (left foot slightly forward)",
)


def hand(target, pole, palm, **kw):
    return {"target": target, "pole": pole, "palm": palm, "fist": False, "curl": (12.0, 16.0, 10.0), "space": "chest", **kw}


STANCE = {
    "pelvis": {"pos": (0.0, -0.02, -0.20), "yaw": -10.0, "pitch": 22.0, "roll": 0.0},
    "spine": {"yaw": -4.0, "pitch": 16.0, "roll": 0.0},
    "clavicle": {"l": (0.0, 0.0), "r": (0.0, 0.0)},
    "head": {"gaze": (0.0, 2.0, 1.2), "tuck": -4.0},
    "arms": {
        # hands in front at belt / chest height, elbows in
        "l": hand(Chest("A", (0.17, 0.34, -0.12)), (0.7, -0.2, -0.7), (-0.2, 0.3, -1.0)),
        "r": hand(Chest("A", (-0.17, 0.34, -0.12)), (-0.7, -0.2, -0.7), (0.2, 0.3, -1.0)),
    },
    "legs": {"l": plant(0.20, 0.16, -8.0, 6.0, (0.2, 1.0, 0.0)), "r": plant(-0.20, -0.18, -18.0, 16.0, (-0.2, 1.0, 0.0))},
}

# the feet leave the floor (just above their spots), fly back, and land far back and wide on the toes
UP = deep(STANCE)
UP["pelvis"].update({"pos": (0.0, -0.16, -0.36), "pitch": 40.0})
UP["spine"].update({"pitch": 18.0})
UP["legs"] = {"l": free((0.21, 0.04, 0.24), (0.2, 1.0, -0.3), (0.0, 0.7, -0.7)), "r": free((-0.21, -0.30, 0.24), (-0.2, 1.0, -0.3), (0.0, 0.7, -0.7))}
UP["arms"] = {
    "l": hand(Chest("A", (0.22, 0.46, -0.10)), (0.8, -0.3, -0.4), (0.0, 0.2, -1.0)),
    "r": hand(Chest("A", (-0.22, 0.46, -0.10)), (-0.8, -0.3, -0.4), (0.0, 0.2, -1.0)),
}
AIR = deep(UP)
AIR["pelvis"].update({"pos": (0.0, -0.34, -0.50), "pitch": 62.0})
AIR["spine"].update({"pitch": 4.0})
AIR["head"] = {"gaze": (0.0, 2.0, 0.8), "tuck": -14.0}
AIR["legs"] = {"l": free((0.30, -0.86, 0.30), (0.0, 0.0, -1.0), (0.0, 0.5, -0.9)), "r": free((-0.30, -0.88, 0.30), (0.0, 0.0, -1.0), (0.0, 0.5, -0.9))}
# the hands reach the mat first, fingers forward
AIR["arms"] = {
    "l": {"target": (0.26, 0.32, 0.20), "pole": (0.9, -0.5, 0.3), "palm": (0.0, 0.0, -1.0), "handAim": (0.15, 1.0, -0.3), "fist": False, "curl": (8.0, 10.0, 6.0)},
    "r": {"target": (-0.26, 0.32, 0.20), "pole": (-0.9, -0.5, 0.3), "palm": (0.0, 0.0, -1.0), "handAim": (-0.15, 1.0, -0.3), "fist": False, "curl": (8.0, 10.0, 6.0)},
}

SPRAWL = deep(AIR)
SPRAWL["pelvis"].update({"pos": (0.0, -0.40, -0.60), "pitch": 76.0})  # hip skin on the mat (pelvis bone ~0.3 m up)
SPRAWL["spine"].update({"pitch": -14.0})  # chest up off the hips, back arched
SPRAWL["head"] = {"gaze": (0.0, 2.0, 0.7), "tuck": -22.0}  # head up, eyes forward
# legs long and wide behind, on the toes (knees just off the mat)
SPRAWL["legs"] = {"l": plant(0.34, -1.12, 15.0, 70.0, (0.0, 0.0, -1.0)), "r": plant(-0.34, -1.12, -15.0, 70.0, (0.0, 0.0, -1.0))}
# hands on the mat in front of the shoulders, elbows bent a little
SPRAWL["arms"] = {
    "l": {"target": (0.26, 0.30, 0.05), "pole": (0.9, -0.5, 0.3), "palm": (0.0, 0.0, -1.0), "handAim": (0.15, 1.0, -0.05), "fist": False, "curl": (6.0, 8.0, 4.0)},
    "r": {"target": (-0.26, 0.30, 0.05), "pole": (-0.9, -0.5, 0.3), "palm": (0.0, 0.0, -1.0), "handAim": (-0.15, 1.0, -0.05), "fist": False, "curl": (6.0, 8.0, 4.0)},
}
HEAVY = deep(SPRAWL)
HEAVY["pelvis"].update({"pos": (0.0, -0.39, -0.61)})

# coming back: the feet first rise straight off their spots (no dragging), hop in under the hips, land in stance
LIFTOFF = deep(HEAVY)
LIFTOFF["pelvis"].update({"pos": (0.0, -0.37, -0.56)})
LIFTOFF["legs"] = {"l": free((0.34, -1.16, 0.25), (0.0, 0.0, -1.0), (0.0, 0.5, -0.9)), "r": free((-0.34, -1.16, 0.25), (0.0, 0.0, -1.0), (0.0, 0.5, -0.9))}
IN_AIR = deep(AIR)
IN_AIR["arms"] = deep(SPRAWL["arms"])
IN_AIR["pelvis"].update({"pos": (0.0, -0.26, -0.42), "pitch": 56.0})
IN_AIR["legs"] = {"l": free((0.24, -0.34, 0.34), (0.2, 1.0, -0.5), (0.0, 0.7, -0.7)), "r": free((-0.24, -0.50, 0.34), (-0.2, 1.0, -0.5), (0.0, 0.7, -0.7))}
LANDED = deep(UP)
LANDED["legs"] = deep(STANCE["legs"])
LANDED["pelvis"].update({"pos": (0.0, -0.10, -0.34), "pitch": 38.0})

KEYS = [(0, STANCE), (10, STANCE), (14, UP), (19, AIR), (24, SPRAWL), (27, HEAVY), (44, HEAVY), (46, LIFTOFF), (50, IN_AIR), (55, LANDED), (62, STANCE), (74, STANCE)]


def states(key):
    return {"A": keyed(KEYS, key)}


def measure(rigs):
    return body_measure(rigs)
