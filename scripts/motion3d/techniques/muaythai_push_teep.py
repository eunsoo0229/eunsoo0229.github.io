"""muay-thai__push-teep — rear-leg push teep (orthodox: right leg). Authored keyframes on the Mesh2Motion human rig
(Phase 7), no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): the rear knee comes straight up in front of the body (thigh about level, foot
under the knee, toes pulled back), then the hips push FORWARD and the leg extends straight out at belly height — a push
with the ball of the foot, not a snap; the upper body leans back a little over the support leg, the lead hand stays up,
the rear arm drops back for balance; the foot comes back to the chamber and is put down where it started.
  keys  0-8   준비: guard
  keys  8-24  준비: knee up (chamber)
  keys 24-36  실행: hips forward, leg extends, push (contact 32), short hold
  keys 36-52  회수: back to the chamber, foot down at its starting spot
  keys 52-66  가드 복귀
"""
from solo_kit import at, body_measure, deep, fist, free, guard, keyed, solo_meta, with_leg

META = solo_meta(
    "muaythai-push-teep-m2m-v1",
    "muay-thai__push-teep",
    "푸시 티프 (오소독스, 뒷발)",
    66,
    [("prepare", "준비·무릎 들기", 0, 24), ("execute", "실행: 골반 밀며 뻗기", 24, 36), ("recover", "회수·발 내리기", 36, 52), ("guard_return", "가드 복귀", 52, 66)],
    contactKey=32,
    side="right (rear leg), orthodox stance",
)

G = guard()
LEAD = G["legs"]["l"]["plant"]

SQUARE = deep(G)  # weight onto the lead leg, hips a little squarer
SQUARE["pelvis"].update({"pos": (0.05, 0.06, -0.07), "yaw": -16.0, "pitch": 1.0, "roll": -2.0})
SQUARE["spine"].update({"yaw": -6.0, "pitch": 4.0})
SQUARE["legs"]["r"]["plant"].update({"lift": 34.0})
SQUARE["legs"]["l"]["plant"].update({"lift": 4.0, "yaw": -8.0})
LIFT = with_leg(SQUARE, "r", free((-0.17, -0.27, 0.26), (0.0, 1.0, 0.2), (0.0, 0.8, -0.6)))

CHAMBER = deep(SQUARE)
CHAMBER["pelvis"].update({"pos": (0.06, 0.04, -0.06), "yaw": -10.0, "pitch": -4.0, "roll": -3.0})
CHAMBER["spine"].update({"yaw": -4.0, "pitch": -2.0, "roll": -2.0})
# knee up in front, thigh about level, foot under the knee with the toes pulled back
CHAMBER["legs"]["r"] = free((-0.07, 0.36, 0.56), (0.0, 1.0, 0.4), (0.0, 0.7, 0.7))

PUSH = deep(CHAMBER)
PUSH["pelvis"].update({"pos": (0.07, 0.10, -0.06), "yaw": -8.0, "pitch": -16.0, "roll": -3.0})
PUSH["spine"].update({"yaw": -2.0, "pitch": -4.0, "roll": -2.0})
PUSH["legs"]["r"] = free((-0.04, 0.86, 0.94), (0.0, 0.3, 1.0), (0.0, 0.25, 1.0))  # sole on the opponent's belly
PUSH["legs"]["l"]["plant"].update({"lift": 8.0})
PUSH["arms"]["r"] = at((-0.36, -0.10, 1.02), (-1.0, 0.3, -0.2), (0.3, 0.0, -1.0))  # rear arm drops back
PUSH["arms"]["l"] = fist((0.18, 0.26, 0.24), (0.35, 0.0, -1.0), (-0.75, 0.25, -0.2))
PUSH["head"] = {"gaze": (0.0, 2.2, 1.35), "tuck": 8.0}

BACK = deep(CHAMBER)
DOWN = with_leg(SQUARE, "r", free((-0.17, -0.27, 0.26), (0.0, 1.0, 0.2), (0.0, 0.8, -0.6)))
LAND = deep(SQUARE)

KEYS = [(0, G), (8, G), (14, SQUARE), (17, LIFT), (24, CHAMBER), (32, PUSH), (36, PUSH), (43, BACK), (49, DOWN), (52, LAND), (66, G)]
# the rear arm has its own key track (arm waypoints do not stop the body): the hand passes in front of the hip between
# the guard and the arm swung back, instead of cutting past the shoulder (which folded the elbow in one key)
LOW = at((-0.30, 0.16, 1.04), (-1.0, 0.3, -0.2), (0.3, 0.0, -1.0))
ARM_R = [(0, G["arms"]["r"]), (24, CHAMBER["arms"]["r"]), (28, LOW), (32, PUSH["arms"]["r"]), (36, PUSH["arms"]["r"]), (40, LOW), (44, BACK["arms"]["r"]), (66, G["arms"]["r"])]


def states(key):
    st = keyed(KEYS, key)
    st["arms"] = {**st["arms"], "r": keyed(ARM_R, key)}
    return {"A": st}


def measure(rigs):
    return body_measure(rigs)
