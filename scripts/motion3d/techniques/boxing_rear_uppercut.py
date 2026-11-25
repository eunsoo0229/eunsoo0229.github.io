"""boxing__rear-uppercut — rear uppercut (orthodox: right hand). Authored keyframes on the Mesh2Motion human rig
(Phase 7), no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): a short dip onto the rear leg with the hips loaded to the right, the rear
hand drops only a little (no wind-up); the legs drive up, the rear foot pivots on the ball (heel out) and the hips turn
left, so the fist travels UP the centre line with the elbow bent about 90 degrees and the palm facing the boxer; the
lead hand stays at the cheek, the chin stays down, the eyes stay on the opponent; the hand comes back down the same
line to the chin.
  keys  0-8   준비: guard
  keys  8-18  준비: dip and load (knees bend, weight onto the rear leg, hips turned right)
  keys 18-28  실행: legs drive up + hip turn, the fist rises to the opponent's chin (contact 27), short hold
  keys 28-40  회수: the fist comes back down the same line, hips turn back
  keys 40-56  가드 복귀: settle into the starting guard (key 56 = key 0)
"""
from solo_kit import CHIN, at, blend, body_measure, deep, fist, guard, keyed, solo_meta

META = solo_meta(
    "boxing-rear-uppercut-m2m-v1",
    "boxing__rear-uppercut",
    "리어 어퍼컷 (오소독스, 오른손)",
    56,
    [("prepare", "준비·하중 싣기", 0, 18), ("execute", "실행: 다리·골반으로 올려치기", 18, 30), ("recover", "회수", 30, 40), ("guard_return", "가드 복귀", 40, 56)],
    contactKey=27,
    side="right (rear hand), orthodox stance",
)

G = guard()
LOAD = deep(G)
LOAD["pelvis"].update({"pos": (-0.02, -0.06, -0.13), "yaw": -38.0, "pitch": 6.0, "roll": -2.0})
LOAD["spine"].update({"yaw": -14.0, "pitch": 12.0, "roll": -4.0})
# the rear fist sinks a little in front of the chest (no wind-up behind the body)
LOAD["arms"]["r"] = fist((-0.13, 0.22, 0.05), (-0.3, -0.2, -1.0), (0.5, 0.0, 0.8))
LOAD["legs"]["r"]["plant"].update({"lift": 6.0})

HIT = deep(G)
HIT["pelvis"].update({"pos": (0.0, -0.01, -0.05), "yaw": 2.0, "pitch": 4.0, "roll": 2.0})
HIT["spine"].update({"yaw": 10.0, "pitch": 9.0, "roll": 3.0})
HIT["clavicle"] = {"l": (0.0, 0.0), "r": (10.0, 4.0)}
# fist under the opponent's chin, forearm near vertical, elbow below and in front of the ribs, palm towards the boxer
HIT["arms"]["r"] = at((CHIN[0] - 0.02, CHIN[1] - 0.12, CHIN[2] - 0.08), (-0.15, 0.1, -1.0), (0.0, -1.0, 0.0))
HIT["arms"]["l"] = fist((0.22, 0.22, 0.24), (0.35, 0.0, -1.0), (-0.75, 0.25, -0.2))  # lead fist back at the left cheek
HIT["head"] = {"gaze": (0.0, 2.2, 1.55), "tuck": 10.0}
HIT["legs"]["r"]["plant"].update({"yaw": -12.0, "lift": 34.0, "pole": (0.25, 1.0, 0.0)})  # rear heel turns out
HIT["legs"]["l"]["plant"].update({"lift": 4.0})

BACK = deep(G)
BACK["pelvis"].update({"yaw": -24.0})
BACK["spine"].update({"yaw": -6.0})
BACK["legs"]["r"]["plant"].update({"yaw": -36.0, "lift": 18.0})
BACK["arms"]["l"] = HIT["arms"]["l"]
BACK["arms"]["r"] = fist((-0.12, 0.24, 0.16), (-0.35, 0.0, -1.0), (0.6, 0.2, 0.3))

KEYS = [(0, G), (8, G), (18, LOAD), (27, HIT), (30, HIT), (40, BACK), (56, G)]


def states(key):
    return {"A": keyed(KEYS, key)}


def measure(rigs):
    return body_measure(rigs)
