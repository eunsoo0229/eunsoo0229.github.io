"""mixed-martial-arts__overhand — overhand right (orthodox: right hand). Authored keyframes on the Mesh2Motion human
rig (Phase 7), no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): the head moves OFF the centre line to the left as the body dips (the same
motion that slips a jab), the rear foot pivots and the hips turn; the rear fist travels in a looping arc — up past the
shoulder and over the top, elbow high, then DOWN onto the opponent's head at an angle, palm turning outward/down; the
body bends forward and left over the lead leg (weight forward), the lead hand stays up at the face; then the hand comes
back to the chin and the body rises into guard.
  keys  0-8   준비: guard
  keys  8-18  준비: dip with the head off the centre line (left), weight onto the lead leg
  keys 18-30  실행: the fist loops up and over, lands on the target (contact 29) with the body bending into it
  keys 30-44  회수: fist back to the chin, body rises
  keys 44-60  가드 복귀
"""
from solo_kit import CHIN, at, body_measure, deep, fist, guard, keyed, solo_meta

META = solo_meta(
    "mma-overhand-m2m-v1",
    "mixed-martial-arts__overhand",
    "오버핸드 (오소독스, 오른손)",
    60,
    [("prepare", "준비·머리를 중심선 밖으로", 0, 18), ("execute", "실행: 위로 돌려 내려치기", 18, 32), ("recover", "회수", 32, 44), ("guard_return", "가드 복귀", 44, 60)],
    contactKey=29,
    side="right (rear hand), orthodox stance",
)

G = guard()
DIP = deep(G)
# roll < 0 leans to the performer's left: the head leaves the centre line to the left
DIP["pelvis"].update({"pos": (0.05, 0.0, -0.13), "yaw": -26.0, "pitch": 6.0, "roll": -4.0})
DIP["spine"].update({"yaw": -8.0, "pitch": 12.0, "roll": -10.0})
DIP["head"] = {"gaze": (0.0, 2.2, 1.45), "tuck": 10.0}
DIP["arms"]["r"] = fist((-0.15, 0.18, 0.21), (-0.6, -0.2, -0.7), (0.7, 0.25, -0.25))  # still at the chin, elbow starts to lift

# top of the loop: fist above and outside the right shoulder, elbow high and out to the side
TOP = deep(DIP)
TOP["pelvis"].update({"pos": (0.06, 0.02, -0.14), "yaw": -10.0, "pitch": 7.0, "roll": -5.0})
TOP["spine"].update({"yaw": 2.0, "pitch": 14.0, "roll": -12.0})
TOP["arms"]["r"] = fist((-0.22, 0.24, 0.52), (-1.0, -0.3, 0.5), (0.6, 0.0, -0.8))
TOP["legs"]["r"]["plant"].update({"yaw": -25.0, "lift": 26.0})

HIT = deep(G)
HIT["pelvis"].update({"pos": (0.07, 0.05, -0.15), "yaw": 6.0, "pitch": 8.0, "roll": -5.0})
HIT["spine"].update({"yaw": 14.0, "pitch": 18.0, "roll": -9.0})
HIT["clavicle"] = {"l": (0.0, 0.0), "r": (16.0, 10.0)}
# the fist comes DOWN onto the opponent's temple: elbow high and bent, palm out / down
HIT["arms"]["r"] = at((CHIN[0] + 0.06, CHIN[1] - 0.02, CHIN[2] + 0.03), (-0.8, 0.0, 0.6), (0.4, 0.0, -1.0))
HIT["arms"]["l"] = fist((0.24, 0.22, 0.24), (0.35, 0.0, -1.0), (-0.75, 0.25, -0.2))  # lead fist at the left cheek
HIT["head"] = {"gaze": (0.05, 2.2, 1.35), "tuck": 12.0}
HIT["legs"]["r"]["plant"].update({"yaw": -8.0, "lift": 42.0, "pole": (0.25, 1.0, 0.0)})  # rear heel out
HIT["legs"]["l"]["plant"].update({"lift": 2.0, "pole": (0.25, 1.0, 0.0)})

BACK = deep(DIP)
BACK["arms"]["r"] = fist((-0.13, 0.22, 0.20), (-0.4, 0.0, -1.0), (0.7, 0.25, -0.25))
BACK["arms"]["l"] = HIT["arms"]["l"]
BACK["legs"]["r"]["plant"].update({"yaw": -34.0, "lift": 18.0})

KEYS = [(0, G), (8, G), (18, DIP), (24, TOP), (29, HIT), (32, HIT), (44, BACK), (60, G)]


def states(key):
    return {"A": keyed(KEYS, key)}


def measure(rigs):
    return body_measure(rigs)
