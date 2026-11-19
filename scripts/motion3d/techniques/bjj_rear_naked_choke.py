"""bjj__rear-naked-choke — rear naked choke, two-person SAFE demonstration (A = performer, white; B = partner, red).
Authored keyframes on the Mesh2Motion human rig (Phase 5), no capture.

What is shown is the POSITION, as in a teaching demonstration, never a choke being applied:
  keys 0-20   준비: seated back control — A sits behind B, hooks in (A's heels inside B's thighs), seatbelt grip
              (A's right arm over B's right shoulder, left arm under B's left arm, hands together on B's chest)
  keys 20-44  자세 만들기: A's right arm slides round the FRONT of B's neck with a clear gap (no contact with the
              throat), the right hand comes to A's own left biceps, A's left hand rises BEHIND B's head without
              touching it
  keys 44-70  유지: the shape is held still — no squeezing motion, no pull, no pressure; B's hands rest on A's forearm
  keys 70-90  풀기: A opens the arm and returns to the seatbelt grip
Safety rules (checked every key, see measure()): A's choking arm never comes closer than CLEAR_MIN to B's neck /
head bones, the back hand never touches the head, B's head and neck keep their own posture (no forced movement).
B sits 0.24 m in front of A, A leaning in (chest against B's back, head beside B's right ear), both facing the same way; each pose is in its own actor's frame.
"""
from grapple_kit import Ref, deep, keyed

META = {
    "id": "bjj-rear-naked-choke-m2m-v2",
    "techniqueIds": ["bjj__rear-naked-choke"],
    "title": "리어 네이키드 초크 (2인 안전 시연)",
    "fps": 30,
    "lastKey": 90,
    "phases": [("prepare", "준비·시트벨트", 0, 20), ("execute", "자세 만들기·유지 (압박 없음)", 20, 70), ("finish", "풀기", 70, 90)],
    "placement": {"A": (0.0, 0.0, 0.0), "B": (0.0, 0.24, 0.0)},
    "actors": {"A": "performer", "B": "partner"},
}
CLEAR_MIN = 0.11
GRIP_R = (0.15, 0.07, 0.03)
GRIP_L = (0.24, 0.05, 0.04)  # left hand ON TOP of the right (stacked, palms facing)
B_LEFT_AT = 0.9  # B's left hand near A's wrists (B's left side), right hand by A's elbow (B's right) — B's arms do not cross
B_GRIP = (55.0, 70.0, 45.0)
CLASP = (35.0, 45.0, 30.0)  # hands meeting palm to palm, fingers half closed
POLE_L = (0.9, -0.3, -0.5)
SHAPE_YAW = 6.0  # Phase 6: chest turned a little towards B's left shoulder so the left arm reaches over it
ROLL = 6.0  # A's head beside B's right ear, not behind B's head  # bone-to-bone (m): neck/forearm radii ~0.05 each -> about a 1 cm gap or more between the skins


def arm(target, pole, palm=None, **kw):
    return {"target": target, "pole": pole, "palm": palm, "fist": False, **kw}


def plant(x, y, yaw=0.0, lift=0.0, pole=(0.0, 1.0, 0.0)):
    return {"plant": {"ball": (x, y), "yaw": yaw, "lift": lift, "pole": pole}}


# ---------------------------------------------------------------- B (partner): seated, leaning back a little
B_SIT = {
    "pelvis": {"pos": (0.0, 0.0, -0.80), "yaw": 0.0, "pitch": -8.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 4.0, "roll": 0.0},
    "head": {"gaze": (0.0, 2.0, 0.75), "tuck": 6.0},
    "arms": {
        # hands resting on its own knees
        "l": arm(Ref("B", "calf_l", 0.0, (0.0, 0.0, 0.07)), (0.6, 0.0, -1.0), (0.0, 0.0, -1.0)),
        "r": arm(Ref("B", "calf_r", 0.0, (0.0, 0.0, 0.07)), (-0.6, 0.0, -1.0), (0.0, 0.0, -1.0)),
    },
    "legs": {"l": plant(0.20, 0.72, 8.0, 0.0, (0.3, 0.4, 1.0)), "r": plant(-0.20, 0.72, -8.0, 0.0, (-0.3, 0.4, 1.0))},
}
B_DEFEND = deep(B_SIT)
# hands resting on A's right forearm (no pulling, no struggle)
B_DEFEND["arms"] = {
    # side by side on A's forearm: B's left hand near A's wrist (B's left), right hand near A's elbow (B's right)
    # Phase 6: B's hands spread along A's choking arm (B's left hand mid-forearm, right hand by A's elbow), low
    # enough not to cluster at B's own chin
    "l": arm(Ref("A", "lowerarm_r", B_LEFT_AT, (0.02, 0.05, -0.04), frame="B"), (0.8, 0.0, -0.8), (0.0, -0.4, -1.0), curl=B_GRIP),
    "r": arm(Ref("A", "upperarm_r", 0.9, (-0.02, 0.05, -0.04), frame="B"), (-0.8, 0.0, -0.8), (0.0, -0.4, -1.0), curl=B_GRIP),
}

# ---------------------------------------------------------------- A (performer): seated behind, hooks in
HOOKS = {
    # A's heels inside B's thighs, knees out and up — offsets in B's frame (inside = towards B's centre)
    "l": {"ankle": Ref("B", "thigh_l", 0.55, (-0.10, 0.0, 0.02)), "pole": (0.9, 0.4, 0.6), "toes": (-0.3, 1.0, 0.1)},
    "r": {"ankle": Ref("B", "thigh_r", 0.55, (0.10, 0.0, 0.02)), "pole": (-0.9, 0.4, 0.6), "toes": (0.3, 1.0, 0.1)},
}
A_SEATBELT = {
    "pelvis": {"pos": (-0.10, 0.0, -0.82), "yaw": 0.0, "pitch": 8.0, "roll": 0.0},
    "spine": {"yaw": 0.0, "pitch": 18.0, "roll": ROLL},
    "head": {"gaze": (-0.25, 2.0, 0.9), "tuck": 4.0},
    "arms": {
        # over B's right shoulder, across the chest / under B's left arm — hands meet on B's left chest
        "r": arm(Ref("B", "spine_03", 0.0, (0.10, 0.17, -0.02)), (-0.6, 0.3, 0.8), (0.0, -1.0, 0.0)),
        "l": arm(Ref("B", "spine_03", 0.0, (0.13, 0.16, -0.10)), (0.8, 0.0, -0.6), (0.0, -1.0, 0.0)),
    },
    "legs": HOOKS,
}
A_SHAPE = deep(A_SEATBELT)
A_SHAPE["spine"].update({"pitch": 18.0, "roll": ROLL, "yaw": SHAPE_YAW})
A_SHAPE["head"] = {"gaze": (-0.25, 2.0, 1.0), "tuck": 4.0}
A_SHAPE["arms"] = {
    # the right forearm passes in FRONT of B's neck (elbow forward of the neck, under the chin line) and the hand
    # reaches A's own left biceps; the left hand stays a hand's width behind B's head
    # grip point a little forward of the neck on B's left (B's frame): with the elbow forward under the chin the
    # forearm then passes >= CLEAR_MIN in front of the throat; A's left biceps is placed there by its forward elbow
    "r": arm(Ref("B", "neck_01", 0.0, GRIP_R), (0.0, 1.0, -0.1), (0.0, 0.0, 1.0), curl=CLASP),
    # Phase 6 (v2, 팔 맞잡기 / palm-to-palm): the left arm comes OVER B's left shoulder and the two hands meet beside
    # the neck — each arm has its own path (no arm across the other, no hand at the head), reachable with this
    # character's arm length (the "hand on the opposite biceps" grip of v1 was 11 cm out of reach)
    "l": arm(Ref("B", "neck_01", 0.0, GRIP_L), POLE_L, (0.0, 0.0, -1.0), curl=CLASP),
}

# entry / exit: from the seatbelt (arm already across B's chest) the forearm slides UP the front of the chest to
# B's left collarbone, then into the shape — it stays in front of the body and never sweeps across the throat
A_SLIDE = deep(A_SHAPE)
A_SLIDE["arms"] = {
    "r": arm(Ref("B", "spine_03", 0.0, (0.14, 0.28, 0.06)), (0.0, 1.0, -0.4), (0.0, -1.0, 0.0)),
    "l": arm(Ref("B", "spine_03", 0.0, (0.13, 0.12, -0.08)), (0.8, 0.2, -0.6), (0.0, -1.0, 0.0)),
}

# the support arm is set FIRST (its biceps — where the right hand ends — then stays still), the right hand comes last
A_SLIDE["arms"]["l"] = A_SHAPE["arms"]["l"]

# the right hand reaches the grip from BELOW (forearm in front of the upper chest, elbow already forward) and rises
# the last few centimetres into place — moving sideways at neck height would bring the forearm closer to the throat
A_BELOW = deep(A_SHAPE)
# Phase 6: while the right hand comes up from below, the left hand waits a little higher and wider, so the hands
# meet only at the end (the rising hand never passes through the waiting wrist); the same on the way out
A_BELOW["arms"]["l"] = arm(Ref("B", "neck_01", 0.0, (GRIP_L[0] + 0.04, GRIP_L[1], GRIP_L[2] + 0.10)), POLE_L, (0.0, 0.0, -1.0), curl=CLASP)
A_BELOW["arms"]["r"] = arm(Ref("B", "neck_01", 0.0, (GRIP_R[0], GRIP_R[1] + 0.04, GRIP_R[2] - 0.16)), (0.0, 1.0, -0.1), (0.0, -1.0, 0.0))

# Phase 6: leaving / re-taking the seatbelt, the left hand goes OUT to B's left side first, so it never passes through
# the right forearm lying across B's chest
A_LEFT_OUT = deep(A_SEATBELT)
A_LEFT_OUT["arms"] = {"r": A_SEATBELT["arms"]["r"], "l": arm(Ref("B", "spine_03", 0.0, (0.34, 0.02, 0.0)), (0.9, -0.4, -0.3), (0.0, 0.0, -1.0), curl=CLASP)}

A_KEYS = [(0, A_SEATBELT), (20, A_SEATBELT), (26, A_LEFT_OUT), (32, A_SLIDE), (40, A_BELOW), (48, A_SHAPE), (66, A_SHAPE), (74, A_BELOW), (82, A_SLIDE), (86, A_LEFT_OUT), (90, A_SEATBELT)]
# Phase 6: in the seatbelt B's hands hold A's diagonal forearm; they move with A's arm to the hold grip and back
B_SEAT = deep(B_DEFEND)
B_SEAT["arms"] = {
    "l": arm(Ref("A", "lowerarm_r", 0.85, (0.0, 0.05, 0.0), frame="B"), (0.8, 0.0, -0.8), (0.0, -0.4, -1.0), curl=B_GRIP),
    "r": arm(Ref("A", "lowerarm_r", 0.35, (0.0, 0.05, 0.0), frame="B"), (-0.8, 0.0, -0.8), (0.0, -0.4, -1.0), curl=B_GRIP),
}
B_KEYS = [(0, B_SEAT), (24, B_SEAT), (44, B_DEFEND), (70, B_DEFEND), (88, B_SEAT), (90, B_SEAT)]  # B's hands stay lightly on A's forearm throughout (no struggle)


def states(key):
    return {"A": keyed(A_KEYS, key), "B": keyed(B_KEYS, key)}


def measure(rigs):
    from grapple_kit import clearance

    a, b = rigs["A"], rigs["B"]
    return {
        "chokeArmToNeckM": round(clearance(a, ["lowerarm_r", "upperarm_r"], b, ["neck_01", "head"]), 3),
        "backHandToHeadM": round(clearance(a, ["hand_l"], b, ["head"]), 3),
        # Phase 6 checks: the two arms apart (hands excluded — they meet), the support arm off the neck too, every
        # hand away from both heads, the clasp closed
        "armsApartM": round(clearance(a, ["upperarm_l", "lowerarm_l"], a, ["upperarm_r", "lowerarm_r"]), 3),
        "supportArmToNeckM": round(clearance(a, ["lowerarm_l"], b, ["neck_01", "head"]), 3),
        "handsToHeadsM": round(min(clearance(a, ["hand_l", "hand_r"], b, ["head"]), clearance(b, ["hand_l", "hand_r"], b, ["head"]), clearance(b, ["hand_l", "hand_r"], a, ["head"])), 3),
        "claspGapM": round((a.head("hand_r") - a.head("hand_l")).length, 3),
        "headToHeadM": round((a.head("head") - b.head("head")).length, 3),
        # how far the right hand is from A's own left biceps (the grip the shape shows)
        "gripGapM": round((a.head("hand_r") - a.head("upperarm_l").lerp(a.head("lowerarm_l"), 0.6)).length, 3),
        # key joints in B's frame (x = B's left, y = B's forward, z = up) — for checking the shape
        "joints": {n: [round(v, 3) for v in b.to_char(r.head(bone))] for n, r, bone in (("A.shoulder_r", a, "upperarm_r"), ("A.elbow_r", a, "lowerarm_r"), ("A.hand_r", a, "hand_r"), ("A.elbow_l", a, "lowerarm_l"), ("A.hand_l", a, "hand_l"), ("A.head", a, "head"), ("B.neck", b, "neck_01"), ("B.head", b, "head"), ("B.spine_03", b, "spine_03"))},
    }
