"""kickboxing__straight-knee — rear straight knee (orthodox: right knee). Authored keyframes on the Mesh2Motion human
rig (Phase 7), no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): the hands reach forward as if to take the opponent's head or shoulders and
pull DOWN as the knee comes up; the hips drive FORWARD (not just the leg lifting), the support foot rises onto its ball,
the upper body leans back a little; the knee points at the target with the toes pointed down; the leg comes back and the
foot is put down where it started, hands back to guard.
  keys  0-8   준비: guard
  keys  8-16  준비: hands reach forward
  keys 16-30  실행: hips forward, knee drives up, hands pull down (contact 26), short hold
  keys 30-44  회수: foot down at its starting spot
  keys 44-58  가드 복귀
"""
from solo_kit import body_measure, deep, free, guard, keyed, solo_meta, with_leg

META = solo_meta(
    "kickboxing-straight-knee-m2m-v1",
    "kickboxing__straight-knee",
    "스트레이트 니 (오소독스, 뒷무릎)",
    58,
    [("prepare", "준비·손 뻗기", 0, 16), ("execute", "실행: 골반 밀며 무릎 올리기", 16, 30), ("recover", "회수·발 내리기", 30, 44), ("guard_return", "가드 복귀", 44, 58)],
    contactKey=26,
    side="right (rear knee), orthodox stance",
)


def hand(target, pole, palm):
    # an open hand reaching / holding (fingers half closed)
    return {"target": target, "pole": pole, "palm": palm, "fist": False, "curl": (35.0, 45.0, 30.0), "space": "chest"}


G = guard()
REACH = deep(G)
REACH["pelvis"].update({"pos": (0.04, 0.06, -0.07), "yaw": -18.0, "pitch": 3.0})
REACH["spine"].update({"yaw": -6.0, "pitch": 8.0})
# both hands forward at the opponent's neck height, palms down
REACH["arms"] = {"l": hand((0.13, 0.62, 1.50), (0.6, 0.0, -1.0), (0.0, 0.0, -1.0)), "r": hand((-0.11, 0.60, 1.50), (-0.6, 0.0, -1.0), (0.0, 0.0, -1.0))}
REACH["legs"]["r"]["plant"].update({"lift": 30.0})
LIFT = with_leg(REACH, "r", free((-0.17, -0.27, 0.26), (0.0, 1.0, 0.2), (0.0, 0.8, -0.6)))

KNEE = deep(REACH)
KNEE["pelvis"].update({"pos": (0.05, 0.16, -0.04), "yaw": -6.0, "pitch": -14.0, "roll": -2.0})
KNEE["spine"].update({"yaw": -2.0, "pitch": -2.0})
# knee up and forward at the opponent's body, shin hanging back, toes pointed down
KNEE["legs"]["r"] = free((-0.06, 0.32, 0.80), (0.0, 1.0, 0.7), (0.0, -0.3, -1.0))
KNEE["legs"]["l"]["plant"].update({"lift": 26.0, "yaw": -6.0})
# hands pulled down towards the rising knee
KNEE["arms"] = {"l": hand((0.13, 0.46, 1.25), (0.7, 0.0, -0.8), (0.0, -0.2, -1.0)), "r": hand((-0.11, 0.46, 1.25), (-0.7, 0.0, -0.8), (0.0, -0.2, -1.0))}
KNEE["head"] = {"gaze": (0.0, 1.6, 1.0), "tuck": 8.0}

BACK = deep(REACH)
BACK["legs"]["r"] = free((-0.14, 0.02, 0.40), (0.0, 1.0, 0.3), (0.0, 0.4, -1.0))
DOWN = with_leg(REACH, "r", free((-0.17, -0.27, 0.26), (0.0, 1.0, 0.2), (0.0, 0.8, -0.6)))
LAND = deep(REACH)

KEYS = [(0, G), (8, G), (14, REACH), (17, LIFT), (26, KNEE), (30, KNEE), (36, BACK), (41, DOWN), (44, LAND), (58, G)]


def states(key):
    return {"A": keyed(KEYS, key)}


def measure(rigs):
    return body_measure(rigs)
