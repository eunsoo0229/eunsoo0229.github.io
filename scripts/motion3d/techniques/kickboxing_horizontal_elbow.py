"""kickboxing__horizontal-elbow — rear horizontal elbow (orthodox: right elbow). Authored keyframes on the Mesh2Motion
human rig (Phase 7), no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): a close-range strike — the rear foot pivots and the hips and shoulders turn
left; the right elbow rises to shoulder height with the forearm level and the hand close to the head (palm down), and
the point of the elbow travels horizontally across at the opponent's jaw height; the lead hand stays high at the left
temple; the eyes stay on the target; then the elbow comes back down to guard.
  keys  0-8   준비: guard
  keys  8-16  준비: small turn right, the elbow starts to rise
  keys 16-28  실행: hips and shoulders turn, elbow slices across (contact 25), short hold
  keys 28-40  회수: elbow back down, hips turn back
  keys 40-54  가드 복귀
"""
from solo_kit import body_measure, deep, fist, guard, keyed, solo_meta

META = solo_meta(
    "kickboxing-horizontal-elbow-m2m-v1",
    "kickboxing__horizontal-elbow",
    "호리즌털 엘보 (오소독스, 오른팔꿈치)",
    54,
    [("prepare", "준비·팔꿈치 들기", 0, 16), ("execute", "실행: 골반·어깨 회전, 수평으로 베기", 16, 28), ("recover", "회수", 28, 40), ("guard_return", "가드 복귀", 40, 54)],
    contactKey=25,
    side="right (rear elbow), orthodox stance",
)

G = guard()
LOAD = deep(G)
LOAD["pelvis"].update({"pos": (0.0, -0.04, -0.09), "yaw": -38.0, "pitch": 4.0})
LOAD["spine"].update({"yaw": -16.0, "pitch": 9.0})
LOAD["clavicle"] = {"l": (0.0, 0.0), "r": (0.0, 8.0)}
# the elbow up and out to the right, hand by the right ear, palm down
LOAD["arms"]["r"] = fist((-0.18, 0.13, 0.27), (-1.0, 0.1, 0.1), (0.2, 0.0, -1.0))

HIT = deep(G)
HIT["pelvis"].update({"pos": (0.03, 0.02, -0.08), "yaw": 4.0, "pitch": 5.0, "roll": 1.0})
HIT["spine"].update({"yaw": 24.0, "pitch": 9.0, "roll": 2.0})
HIT["clavicle"] = {"l": (0.0, 0.0), "r": (12.0, 10.0)}
# elbow point in front of the chest centre at jaw height, forearm level across the face line, hand near the left ear
HIT["arms"]["r"] = {"target": (0.10, 0.36, 1.49), "elbow": (-0.04, 0.53, 1.46), "pole": (0.0, 1.0, 0.0), "palm": (0.0, 0.0, -1.0), "fist": True, "space": "chest"}
HIT["arms"]["l"] = fist((0.27, 0.10, 0.36), (0.7, -0.2, -0.6), (-0.8, 0.2, 0.0))  # lead hand high at the left temple
HIT["head"] = {"gaze": (0.0, 2.2, 1.5), "tuck": 10.0}
HIT["legs"]["r"]["plant"].update({"yaw": -12.0, "lift": 36.0, "pole": (0.25, 1.0, 0.0)})

LOAD["arms"]["l"] = HIT["arms"]["l"]  # the lead hand goes to the temple first, out of the elbow's path

BACK = deep(G)
BACK["pelvis"].update({"yaw": -24.0})
BACK["spine"].update({"yaw": -6.0})
BACK["arms"]["l"] = HIT["arms"]["l"]
BACK["arms"]["r"] = fist((-0.10, 0.22, 0.24), (-0.6, 0.0, -0.8), (0.4, 0.2, -0.8))
BACK["legs"]["r"]["plant"].update({"yaw": -36.0, "lift": 18.0})

KEYS = [(0, G), (8, G), (16, LOAD), (25, HIT), (28, HIT), (40, BACK), (54, G)]


def states(key):
    return {"A": keyed(KEYS, key)}


def measure(rigs):
    return body_measure(rigs)
