"""kickboxing__body-kick — rear-leg round kick to the body (orthodox: right leg). Authored keyframes on the
Mesh2Motion human rig (Phase 7), no capture. One person, from the shared orthodox guard (solo_kit.guard).

Mechanics shown (public coaching basics): the weight moves onto the lead leg and the lead foot pivots on the ball (the
heel turns towards the target, the toes away) so the hips can turn over; the rear knee comes up and across, the hips
turn over and the leg swings through almost straight, hitting with the shin at body height; the kicking-side arm swings
down and back for balance, the other hand stays at the chin, the upper body leans back a little and the eyes stay on
the target; the leg comes back the way it went and the foot is put down where it started.
  keys  0-8   준비: guard
  keys  8-19  준비: weight onto the lead leg, lead-foot pivot starts
  keys 19-40  실행: rear knee up and across, hips turn over, shin through the target (contact 36), short hold
  keys 40-56  회수: the leg swings back, the foot comes down at its starting spot
  keys 56-72  가드 복귀
"""
from solo_kit import at, body_measure, deep, fist, free, guard, keyed, plant, solo_meta, with_leg

META = solo_meta(
    "kickboxing-body-kick-m2m-v1",
    "kickboxing__body-kick",
    "바디킥 (오소독스, 오른발 라운드킥)",
    72,
    [("prepare", "준비·앞발 피벗", 0, 19), ("execute", "실행: 골반 회전·정강이 타격", 19, 40), ("recover", "회수·발 내리기", 40, 56), ("guard_return", "가드 복귀", 56, 72)],
    contactKey=36,
    side="right (rear leg), orthodox stance",
)

G = guard()
LEAD = G["legs"]["l"]["plant"]
REAR = G["legs"]["r"]["plant"]

SHIFT = deep(G)  # weight over the lead foot, the lead heel starts to turn
SHIFT["pelvis"].update({"pos": (0.06, 0.08, -0.08), "yaw": -18.0, "pitch": 2.0, "roll": -3.0})
SHIFT["spine"].update({"yaw": -6.0, "pitch": 4.0, "roll": -3.0})
SHIFT["legs"] = {"l": plant(LEAD["ball"][0], LEAD["ball"][1], 15.0, 14.0, (0.3, 1.0, 0.0)), "r": plant(REAR["ball"][0], REAR["ball"][1], REAR["yaw"], 38.0, (-0.2, 1.0, 0.0))}

# rear foot just off the floor (rises almost straight up before it travels)
LIFT = with_leg(SHIFT, "r", free((-0.17, -0.27, 0.26), (0.0, 1.0, 0.2), (0.0, 0.8, -0.6)))

CHAMBER = deep(SHIFT)
CHAMBER["pelvis"].update({"pos": (0.08, 0.10, -0.07), "yaw": 20.0, "pitch": -2.0, "roll": -5.0})
CHAMBER["spine"].update({"yaw": -6.0, "pitch": 0.0, "roll": -5.0})
CHAMBER["legs"] = {"l": plant(LEAD["ball"][0], LEAD["ball"][1], 55.0, 18.0, (0.6, 1.0, 0.0)), "r": free((-0.36, 0.02, 0.84), (0.5, 1.0, 0.3), (-0.8, 0.0, -0.5))}  # knee up, shin folded behind it
CHAMBER["arms"]["r"] = fist((-0.24, 0.10, 0.02), (-0.6, -0.4, -0.6), (0.6, 0.0, 0.6))

HIT = deep(CHAMBER)
HIT["pelvis"].update({"pos": (0.09, 0.10, -0.07), "yaw": 72.0, "pitch": -6.0, "roll": -10.0})
HIT["spine"].update({"yaw": -16.0, "pitch": -4.0, "roll": -8.0})
# the support foot has turned on its ball: toes pointing away from the target, heel towards it
HIT["legs"] = {"l": plant(LEAD["ball"][0], LEAD["ball"][1], 100.0, 18.0, (0.9, 0.6, 0.0)), "r": free((0.34, 0.84, 1.02), (0.9, 0.0, 0.5), (0.6, 0.8, 0.0))}
# the kicking-side arm swings down and back, the other hand guards the chin
HIT["arms"]["r"] = at((-0.42, -0.26, 0.98), (-1.0, 0.3, -0.2), (0.0, 0.0, -1.0))
HIT["arms"]["l"] = fist((0.18, 0.24, 0.26), (0.35, 0.0, -1.0), (-0.75, 0.25, -0.2))
HIT["head"] = {"gaze": (0.4, 1.8, 1.25), "tuck": 8.0}

# half-way through the swing: hips half turned, knee pointing at the target (the shin comes round, not straight across)
MID = deep(HIT)
MID["pelvis"].update({"yaw": 46.0, "pitch": -4.0, "roll": -8.0})
MID["spine"].update({"yaw": -12.0, "pitch": -2.0, "roll": -7.0})
MID["legs"] = {"l": plant(LEAD["ball"][0], LEAD["ball"][1], 80.0, 18.0, (0.8, 0.8, 0.0)), "r": free((0.02, 0.62, 0.98), (0.7, 0.6, 0.5), (0.3, 0.8, -0.3))}
MID["arms"]["r"] = at((-0.36, -0.10, 1.05), (-0.8, 0.2, -0.4), (0.3, 0.0, -1.0))

BACK = deep(CHAMBER)  # the leg comes back the way it went
BACK["legs"]["r"] = free((-0.34, -0.04, 0.70), (0.4, 1.0, 0.3), (-0.7, 0.0, -0.7))
DOWN = with_leg(SHIFT, "r", free((-0.17, -0.27, 0.26), (0.0, 1.0, 0.2), (0.0, 0.8, -0.6)))  # just above its spot
LAND = deep(SHIFT)
LAND["legs"]["l"]["plant"].update({"yaw": 10.0, "lift": 10.0})

KEYS = [(0, G), (8, G), (16, SHIFT), (19, LIFT), (25, CHAMBER), (31, MID), (36, HIT), (40, HIT), (45, MID), (50, BACK), (54, DOWN), (57, LAND), (72, G)]
# the rear arm has its own key track (arm waypoints do not stop the body): the hand passes in front of the hip between
# the guard and the arm swung back, instead of cutting past the shoulder (which folded the elbow in one key)
LOW = at((-0.34, 0.14, 1.02), (-1.0, 0.3, -0.2), (0.3, 0.0, -1.0))
ARM_R = [(0, G["arms"]["r"]), (16, SHIFT["arms"]["r"]), (25, CHAMBER["arms"]["r"]), (28, LOW), (31, MID["arms"]["r"]), (36, HIT["arms"]["r"]), (40, HIT["arms"]["r"]), (45, MID["arms"]["r"]), (48, LOW), (51, BACK["arms"]["r"]), (72, G["arms"]["r"])]


def states(key):
    st = keyed(KEYS, key)
    st["arms"] = {**st["arms"], "r": keyed(ARM_R, key)}
    return {"A": st}


def measure(rigs):
    return body_measure(rigs)
