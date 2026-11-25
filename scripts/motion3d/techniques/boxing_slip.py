"""boxing__slip — slipping a punch, both sides (orthodox). Authored keyframes on the Mesh2Motion human rig (Phase 7),
no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): the head moves just off the centre line (about a head's width) by turning
the shoulders and bending the knees — not by bending at the waist sideways; the hands stay in guard, the eyes stay on
the opponent, the feet stay planted.
  outside slip (to the right, outside a jab): shoulders turn right, weight onto the rear leg, right shoulder dips
  inside slip (to the left, inside a cross): shoulders turn left, weight onto the lead leg, left shoulder dips
  keys  0-8   준비: guard
  keys  8-24  바깥쪽 슬립 (오른쪽) — held 16-24
  keys 24-34  중앙으로
  keys 34-50  안쪽 슬립 (왼쪽) — held 42-50
  keys 50-64  가드 복귀
"""
from solo_kit import body_measure, deep, guard, keyed, solo_meta

META = solo_meta(
    "boxing-slip-m2m-v1",
    "boxing__slip",
    "슬립 (오소독스, 바깥쪽·안쪽)",
    64,
    [("prepare", "준비: 가드", 0, 8), ("execute", "바깥쪽 슬립 (오른쪽)", 8, 24), ("transition", "중앙으로", 24, 34), ("finish", "안쪽 슬립 (왼쪽)", 34, 50), ("guard_return", "가드 복귀", 50, 64)],
    side="both sides, orthodox stance",
)

G = guard()
OUT = deep(G)  # head to the right of the centre line
# roll > 0 leans to the performer's right (measured: grapple_kit pose_body)
OUT["pelvis"].update({"pos": (-0.06, -0.06, -0.12), "yaw": -38.0, "pitch": 5.0, "roll": 4.0})
OUT["spine"].update({"yaw": -16.0, "pitch": 14.0, "roll": 12.0})
OUT["head"] = {"gaze": (0.0, 2.2, 1.45), "tuck": 8.0}
OUT["legs"]["r"]["plant"].update({"lift": 6.0})

IN = deep(G)  # head to the left of the centre line
IN["pelvis"].update({"pos": (0.06, 0.0, -0.12), "yaw": -18.0, "pitch": 6.0, "roll": -4.0})
IN["spine"].update({"yaw": 4.0, "pitch": 15.0, "roll": -12.0})
IN["head"] = {"gaze": (0.0, 2.2, 1.45), "tuck": 8.0}
IN["legs"]["r"]["plant"].update({"lift": 22.0, "yaw": -30.0})  # weight forward: rear heel up, knee turns in

KEYS = [(0, G), (8, G), (16, OUT), (24, OUT), (34, G), (42, IN), (50, IN), (64, G)]


def states(key):
    return {"A": keyed(KEYS, key)}


def measure(rigs):
    return body_measure(rigs)
