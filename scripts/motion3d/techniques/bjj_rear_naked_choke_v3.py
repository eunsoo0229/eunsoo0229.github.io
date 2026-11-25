"""bjj__rear-naked-choke v3 — rear naked choke, two-person SAFE teaching demonstration (A = performer, white;
B = partner, red). Authored keyframes on the Mesh2Motion human rig (Phase 7 rebuild of v2), no capture.

What is shown is the POSITION of the technique, as in a teaching demonstration, never a choke being applied:
  keys   0-24  준비: seated back control — A sits behind B with both hooks in (heels inside B's thighs), chest on
               B's back, seatbelt grip (A's right arm over B's right shoulder, left arm under B's left armpit)
  keys  24-48  전환: A's head comes beside B's right ear; the right (choking) forearm slides UP the front of B's chest to
               under the chin line, the left arm comes out from under B's armpit
  keys  48-72  형태: the classic figure-four shape — elbow of the choking arm in front of B's chin line, the right hand
               on A's own left biceps, the left hand BEHIND B's head (no contact with the head)
  keys  72-102 유지: the shape is held still for a second to look at — no squeeze, no pull, no movement of B's neck
  keys 102-132 복귀: the same path back to the starting seatbelt (key 132 = key 0, so the loop is seamless)
Safety rules (measured every key, see measure() and duo_review.py): the choking arm never touches B's neck or head
(bone-to-bone clearance >= CLEAR_MIN, and no mesh contact A.arm/hand ~ B.head), the back hand stays off the head, B's
head and neck keep their own neutral posture (gaze and tuck never change), B never resists or is moved.
B sits in front of A; both face the same way; each pose is written in its own actor's frame.
"""
from grapple_kit import Ref, deep, keyed

META = {
    "id": "bjj-rear-naked-choke-m2m-v3",
    "techniqueIds": ["bjj__rear-naked-choke"],
    "title": "리어 네이키드 초크 (2인 안전 시연)",
    "fps": 30,
    "lastKey": 132,
    "phases": [
        ("prepare", "1 시작 자세: 백 컨트롤·시트벨트", 0, 24),
        ("transition", "2 위치 관계: 머리 옆·팔 올리기", 24, 48),
        ("execute", "3 형태 만들기: 이두 잡기·뒤 손", 48, 72),
        ("hold", "4 유지 (압박 없음)", 72, 102),
        ("recover", "5 시작 자세로 복귀", 102, 132),
    ],
    "placement": {"A": (0.0, 0.0, 0.0), "B": (0.0, 0.28, 0.0)},
    "actors": {"A": "performer", "B": "partner"},
}
CLEAR_MIN = 0.11
GRIP = (40.0, 55.0, 35.0)  # fingers half closed round the biceps
B_GRIP = (35.0, 45.0, 30.0)  # hands resting on the forearm, fingers loosely curled


def arm(target, pole, palm=None, **kw):
    return {"target": target, "pole": pole, "palm": palm, "fist": False, **kw}


def plant(x, y, yaw=0.0, lift=0.0, pole=(0.0, 1.0, 0.0)):
    return {"plant": {"ball": (x, y), "yaw": yaw, "lift": lift, "pole": pole}}


# ---------------------------------------------------------------- B (partner): seated upright, knees up, neutral head
B_SIT = {
    # leaning back into A's chest (B's shoulders come down to A's chest height)
    "pelvis": {"pos": (0.0, 0.0, -0.81), "yaw": 0.0, "pitch": -16.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 4.0, "roll": 0.0},
    # neutral head: eyes level, a little chin-down — the SAME in every key (no forced movement of the neck)
    "head": {"gaze": (0.0, 2.0, 0.72), "tuck": 4.0},
    "arms": {
        # hands lightly on A's seatbelt forearm (B's left hand near A's wrist, right hand by A's elbow)
        "l": arm(Ref("A", "lowerarm_r", 0.70, (0.0, 0.03, -0.07), frame="B"), (0.9, -0.2, -0.9), (0.0, -0.2, -1.0), curl=B_GRIP),
        "r": arm(Ref("A", "lowerarm_r", 0.28, (0.0, 0.03, -0.07), frame="B"), (-0.9, -0.2, -0.9), (0.0, -0.2, -1.0), curl=B_GRIP),
    },
    "legs": {"l": plant(0.21, 0.70, 10.0, 0.0, (0.35, 0.4, 1.0)), "r": plant(-0.21, 0.70, -10.0, 0.0, (-0.35, 0.4, 1.0))},
}
# during the shape B's hands rest on the choking forearm (two-on-one hand fighting shape, no pulling)
B_HOLD = deep(B_SIT)  # the same two hand points on A's forearm (they ride the arm up; the arms never cross)
# while A's forearm stands up the front of B's chest (both hands would stack on it) B's right hand rests on its own
# right knee, and comes back onto A's arm once the shape is set
B_KNEE = deep(B_SIT)
B_KNEE["arms"]["r"] = arm(Ref("B", "calf_r", 0.0, (0.0, -0.02, 0.08)), (-0.9, -0.3, -0.6), (0.0, 0.0, -1.0), curl=B_GRIP)

# ---------------------------------------------------------------- A (performer): seated behind, hooks in
HOOKS = {
    # A's heels inside B's thighs, knees out and up — offsets in B's frame (inside = towards B's centre)
    # insteps on the inner thighs, toes turned out (a hook, not crossed feet); knees wide and low
    "l": {"ankle": Ref("B", "thigh_l", 0.55, (-0.06, 0.0, 0.03)), "pole": (1.0, 0.25, 0.25), "toes": (0.35, 1.0, 0.0)},
    "r": {"ankle": Ref("B", "thigh_r", 0.55, (0.06, 0.0, 0.03)), "pole": (-1.0, 0.25, 0.25), "toes": (-0.35, 1.0, 0.0)},
}
A_SEATBELT = {
    # upright behind B, head beside B's right shoulder (not behind B's head)
    "pelvis": {"pos": (-0.09, 0.0, -0.81), "yaw": 0.0, "pitch": 2.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 6.0, "roll": 8.0},
    "head": {"gaze": (-0.15, 2.0, 0.85), "tuck": 4.0},
    "arms": {
        # over B's right shoulder, across the chest / under B's left arm — hands meet on B's left chest
        # the over arm comes over B's right shoulder, the under arm comes under B's left armpit (elbow back and down);
        # the hands meet (one over the other) on B's left chest
        "r": arm(Ref("B", "spine_03", 0.0, (0.10, 0.16, 0.03)), (-0.6, 0.3, 0.8), (0.0, -1.0, 0.0), curl=GRIP),
        "l": arm(Ref("B", "spine_03", 0.0, (0.12, 0.17, -0.06)), (0.6, -0.6, -0.5), (0.0, -1.0, 0.35), curl=GRIP),
    },
    "legs": HOOKS,
}
# head beside B's right ear, chest a little higher — the start of the shape
A_TALL = deep(A_SEATBELT)
A_TALL["pelvis"].update({"pos": (-0.10, 0.02, -0.79)})
A_TALL["pelvis"].update({"pitch": 8.0})
A_TALL["spine"].update({"pitch": 14.0, "roll": 13.0, "yaw": 14.0})  # head out beside B's ear, choking-side shoulder forward
A_TALL["head"] = {"gaze": (-0.20, 2.0, 0.95), "tuck": 2.0}

# the figure-four, placed by the elbows (B frame, from the base of B's neck): the right elbow in front of B's chin line,
# the right forearm rising along B's left jaw to A's own left biceps; the left upper arm up beside B's left ear, the
# left forearm folded back so the hand is behind B's head. Every point keeps a gap from the neck (measure()).
R_ELBOW = (-0.10, 0.28, 0.06)
R_HAND = (0.175, 0.085, 0.10)
L_ELBOW = (0.27, 0.26, 0.10)
L_HAND = (0.06, -0.17, 0.03)  # from B's head bone: behind the head, a hand's width off it
A_SHAPE = deep(A_TALL)
A_SHAPE["arms"] = {
    "r": arm(Ref("B", "neck_01", 0.0, R_HAND), (0.0, 1.0, 0.15), (0.0, -0.3, 1.0), curl=GRIP, elbow=Ref("B", "neck_01", 0.0, R_ELBOW)),
    "l": arm(Ref("B", "head", 0.0, L_HAND), (0.9, 0.5, 0.4), (-0.2, 1.0, 0.0), curl=(20.0, 25.0, 15.0), elbow=Ref("B", "neck_01", 0.0, L_ELBOW)),
}
# entry / exit: the right forearm comes up the front of B's chest (never sweeping across the throat), the left arm
# leaves the armpit and goes up outside B's left shoulder
A_SLIDE = deep(A_TALL)
A_SLIDE["arms"] = {
    "r": arm(Ref("B", "spine_03", 0.0, (0.15, 0.24, 0.02)), (0.0, 1.0, -0.4), (0.0, -1.0, 0.0), curl=GRIP),
    "l": arm(Ref("B", "spine_03", 0.0, (0.30, 0.00, 0.06)), (0.9, -0.2, -0.4), (0.0, 0.0, -1.0), curl=GRIP),
}
# the left arm goes up first (outside B's left shoulder, beside the ear), then the right hand rises to the front-left of
# B's neck — the two forearms never pass through each other
A_LUP = deep(A_SLIDE)
# the left arm is placed by its elbow from here on (out beside B's left ear, then forward into the shape), so the hand
# travels round the outside of B's head instead of through it
A_LUP["arms"]["l"] = arm(Ref("B", "head", 0.0, (0.25, -0.07, 0.04)), (1.0, 0.0, 0.1), (-0.6, 0.4, 0.0), curl=(20.0, 25.0, 15.0), elbow=Ref("B", "neck_01", 0.0, (0.30, 0.06, 0.08)))
A_UP = deep(A_LUP)
A_UP["arms"]["r"] = arm(Ref("B", "neck_01", 0.0, (0.10, 0.15, -0.08)), (0.0, 1.0, 0.0), (0.0, -0.6, 0.6), curl=GRIP)
# the left arm settles into the figure-four first; the right hand arrives at the biceps last (and leaves first)
A_LSET = deep(A_UP)
A_LSET["arms"]["l"] = A_SHAPE["arms"]["l"]

A_KEYS = [(0, A_SEATBELT), (24, A_SEATBELT), (34, A_SLIDE), (42, A_LUP), (49, A_UP), (56, A_LSET), (64, A_SHAPE), (102, A_SHAPE), (108, A_LSET), (113, A_UP), (118, A_LUP), (125, A_SLIDE), (132, A_SEATBELT)]
B_KEYS = [(0, B_SIT), (24, B_SIT), (32, B_KNEE), (54, B_KNEE), (64, B_HOLD), (102, B_HOLD), (110, B_KNEE), (124, B_KNEE), (132, B_SIT)]


def states(key):
    return {"A": keyed(A_KEYS, key), "B": keyed(B_KEYS, key)}


def measure(rigs):
    from grapple_kit import clearance

    a, b = rigs["A"], rigs["B"]
    return {
        "chokeArmToNeckM": round(clearance(a, ["lowerarm_r", "upperarm_r"], b, ["neck_01", "head"]), 3),
        "backHandToHeadM": round(clearance(a, ["hand_l"], b, ["head"]), 3),
        "supportArmToNeckM": round(clearance(a, ["lowerarm_l"], b, ["neck_01", "head"]), 3),
        "armsApartM": round(clearance(a, ["upperarm_l", "lowerarm_l"], a, ["upperarm_r", "lowerarm_r"]), 3),
        "headToHeadM": round((a.head("head") - b.head("head")).length, 3),
        # how far the right hand is from A's own left biceps (the grip the shape shows)
        "gripGapM": round((a.head("hand_r") - a.head("upperarm_l").lerp(a.head("lowerarm_l"), 0.55)).length, 3),
        "joints": {n: [round(v, 3) for v in b.to_char(r.head(bone))] for n, r, bone in (("A.shoulder_r", a, "upperarm_r"), ("A.elbow_r", a, "lowerarm_r"), ("A.hand_r", a, "hand_r"), ("A.shoulder_l", a, "upperarm_l"), ("A.elbow_l", a, "lowerarm_l"), ("A.hand_l", a, "hand_l"), ("A.head", a, "head"), ("B.neck", b, "neck_01"), ("B.head", b, "head"))},
    }
