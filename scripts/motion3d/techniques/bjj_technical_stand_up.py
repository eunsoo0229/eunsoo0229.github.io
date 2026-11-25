"""bjj__technical-stand-up — technical stand-up, one person. Authored keyframes on the Mesh2Motion human rig (Phase 7),
no capture.

Mechanics shown (public coaching basics): sitting on the mat, the RIGHT hand posts on the mat behind the right hip, the
LEFT foot is planted, the left forearm stays up in front as a frame; the hips lift off the mat on the posted hand and the
planted foot (a tripod), the right leg swings back UNDER the body, between the hand and the foot, and plants far behind;
from that low lunge the hand leaves the mat and the body rises into a stance with the hands up, the head never coming
forward over the front knee. Then the same path back down to the seated start (so the loop is seamless).
  keys  0-12  준비: seated base (hand posted, foot planted, frame up)
  keys 12-24  전환: hips up on the hand and foot
  keys 24-36  실행: the right leg swings back under the body and plants behind
  keys 36-54  일어서기: hand off the mat, up into a stance, hands up
  keys 54-84  복귀: back down the same path to the seated start
"""
from solo_kit import Chest, body_measure, deep, fist, free, keyed, plant, solo_meta

META = solo_meta(
    "bjj-technical-stand-up-m2m-v1",
    "bjj__technical-stand-up",
    "테크니컬 스탠드업 (오른손 짚고 왼발 딛기)",
    84,
    [("prepare", "준비: 앉은 자세·손 짚기", 0, 12), ("transition", "엉덩이 들기 (손·발 지지)", 12, 24), ("execute", "실행: 다리를 몸 아래로 빼서 뒤에 딛기", 24, 36), ("finish", "일어서기: 손 들고 자세", 36, 54), ("recover", "같은 길로 앉은 자세 복귀", 54, 84)],
    side="right hand posted, left foot planted",
)

POSTED = {"target": (-0.36, -0.60, 0.06), "pole": (-0.6, 0.5, 0.0), "palm": (0.0, 0.0, -1.0), "handAim": (-0.25, -1.0, -0.05), "fist": False, "curl": (6.0, 8.0, 4.0)}
FRAME = {"target": Chest("A", (0.14, 0.30, 0.16)), "pole": (0.6, -0.2, -1.0), "palm": (-0.6, 0.2, -0.3), "fist": False, "curl": (30.0, 40.0, 25.0), "space": "chest"}

SEAT = {
    "pelvis": {"pos": (0.0, -0.30, -0.79), "yaw": 0.0, "pitch": -18.0, "roll": 0.0},
    "spine": {"yaw": -6.0, "pitch": 8.0, "roll": 0.0},
    "clavicle": {"l": (0.0, 0.0), "r": (0.0, 0.0)},
    "head": {"gaze": (0.0, 2.0, 1.0), "tuck": 6.0},
    "arms": {"l": FRAME, "r": POSTED},
    "legs": {
        "l": plant(0.13, 0.20, -6.0, 0.0, (0.4, 0.6, 1.0)),
        # right leg bent and lying on its outside on the mat, knee out
        "r": free((-0.02, 0.02, 0.09), (-1.0, 0.4, 0.4), (0.3, 1.0, 0.0)),
    },
}

TRIPOD = deep(SEAT)  # hips up on the posted hand and the planted foot, right leg still in front
TRIPOD["pelvis"].update({"pos": (-0.04, -0.36, -0.56), "pitch": 4.0, "roll": 6.0})
TRIPOD["spine"].update({"yaw": -12.0, "pitch": 16.0, "roll": 4.0})
TRIPOD["head"] = {"gaze": (0.0, 2.0, 0.9), "tuck": 4.0}
TRIPOD["legs"]["l"]["plant"].update({"lift": 6.0})
TRIPOD["legs"]["r"] = free((-0.08, -0.08, 0.16), (-0.6, 0.6, 0.5), (0.0, 1.0, -0.2))

UNDER = deep(TRIPOD)  # the right leg passes back under the hips, between the hand and the foot
UNDER["pelvis"].update({"pos": (-0.04, -0.38, -0.48), "pitch": 14.0})
UNDER["legs"]["r"] = free((-0.12, -0.52, 0.27), (-0.3, 1.0, -0.1), (0.0, 0.6, -0.8))

LUNGE = deep(UNDER)  # right foot planted far behind (on the ball), low lunge, hand still posted
LUNGE["pelvis"].update({"pos": (-0.04, -0.34, -0.46), "yaw": -6.0, "pitch": 14.0, "roll": 2.0})
LUNGE["spine"].update({"yaw": -8.0, "pitch": 12.0, "roll": 0.0})
LUNGE["legs"]["r"] = plant(-0.14, -0.90, -20.0, 50.0, (-0.2, 1.0, -0.6))

# touch-down: the right foot comes down onto its spot from just above it (no sliding into place)
TOUCH = deep(UNDER)
TOUCH["pelvis"].update({"pos": (-0.04, -0.35, -0.45), "pitch": 14.0})
TOUCH["legs"]["r"] = free((-0.14, -0.99, 0.21), (-0.3, 1.0, -0.3), (-0.1, 0.75, -0.6))  # foot already pitched as it will land (on the ball)
# the hand leaves the mat out to the side first (it does not pass through the right thigh)
HAND_OUT = deep(LUNGE)
HAND_OUT["pelvis"].update({"pos": (-0.04, -0.33, -0.38)})
HAND_OUT["arms"]["r"] = {"target": (-0.46, -0.42, 0.42), "pole": (-0.6, -0.4, -0.6), "palm": (0.4, 0.0, -1.0), "fist": False, "curl": (30.0, 40.0, 25.0)}

RISE = deep(LUNGE)  # the hand leaves the mat, the body rises
RISE["pelvis"].update({"pos": (-0.03, -0.30, -0.22), "yaw": -20.0, "pitch": 8.0, "roll": 0.0})
RISE["spine"].update({"yaw": -8.0, "pitch": 10.0})
RISE["arms"]["r"] = fist((-0.14, 0.24, 0.10), (-0.5, -0.2, -1.0), (0.7, 0.25, -0.25))
RISE["legs"]["r"]["plant"].update({"lift": 30.0})

STAND = deep(RISE)  # in a stance, hands up, eyes forward
STAND["pelvis"].update({"pos": (-0.02, -0.30, -0.08), "yaw": -28.0, "pitch": 3.0})
STAND["spine"].update({"yaw": -10.0, "pitch": 8.0})
STAND["head"] = {"gaze": (0.0, 2.2, 1.6), "tuck": 6.0}
STAND["arms"] = {"l": fist((0.16, 0.34, 0.21), (0.35, 0.0, -1.0), (-0.75, 0.15, -0.35)), "r": fist((-0.14, 0.19, 0.19), (-0.35, 0.0, -1.0), (0.7, 0.25, -0.25))}
STAND["legs"] = {"l": plant(0.13, 0.20, -15.0, 0.0, (0.15, 1.0, 0.0)), "r": plant(-0.14, -0.90, -45.0, 14.0, (-0.25, 1.0, 0.0))}

KEYS = [(0, SEAT), (12, SEAT), (22, TRIPOD), (27, UNDER), (31, TOUCH), (35, LUNGE), (38, LUNGE), (42, HAND_OUT), (47, RISE), (54, STAND), (58, STAND), (63, RISE), (66, HAND_OUT), (69, LUNGE), (73, TOUCH), (77, UNDER), (80, TRIPOD), (84, SEAT)]


# the right arm has its own key track: off the mat out to the side, then down past the hip and up to the chin
LOW = {"target": (-0.36, -0.12, 0.80), "pole": (-0.6, -0.3, -0.8), "palm": (0.5, 0.1, -0.8), "fist": False, "curl": (40.0, 50.0, 35.0)}
ARM_R = [(0, SEAT["arms"]["r"]), (38, LUNGE["arms"]["r"]), (42, HAND_OUT["arms"]["r"]), (47, LOW), (52, RISE["arms"]["r"]), (56, STAND["arms"]["r"]), (58, STAND["arms"]["r"]), (61, RISE["arms"]["r"]), (65, LOW), (69, HAND_OUT["arms"]["r"]), (72, LUNGE["arms"]["r"]), (84, SEAT["arms"]["r"])]


def states(key):
    st = keyed(KEYS, key)
    st["arms"] = {**st["arms"], "r": keyed(ARM_R, key)}
    return {"A": st}


def measure(rigs):
    return body_measure(rigs)
