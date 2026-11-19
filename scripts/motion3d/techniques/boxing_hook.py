"""boxing__hook — lead hook to the head (orthodox: left hand). Authored keyframes, no capture; an independent
animation (not derived from the cross).

Mechanics shown (public coaching basics): the arm is set at about 90 degrees with the elbow raised to shoulder
height and the forearm level; the punch is delivered by the body — the lead foot pivots on the ball (heel turns
out), the hips and shoulders turn towards the rear side while the arm stays locked in shape, so the fist travels a
short horizontal arc; weight moves from the lead to the rear leg; the rear hand stays at the chin; the fist is
vertical (thumb up, palm towards the boxer) at contact. Recovery reverses the turn and the arm drops back to guard.
  keys 0-10  Preparation: guard, small load (dip onto the lead leg, slight opening turn), elbow starts to rise
  keys 10-20 Execution:   lead-foot pivot + hip/shoulder turn with the arm set, contact at 18, short hold
  keys 20-28 Recovery:    turn back, arm returns to guard
  keys 28-40 Guard return: settle into the starting guard
"""
from boxing_stance import blend_states, deep, guard_state
from rig_kit import ease_in_out, smoothstep

META = {
    "id": "boxing-hook-m2m-v4",
    "techniqueIds": ["boxing__hook"],
    "title": "훅 (오소독스, 왼손 리드 훅)",
    "side": "left (lead hand), orthodox stance",
    "fps": 30,
    "lastKey": 40,
    "phases": [("prepare", "준비", 0, 10), ("execute", "실행", 10, 20), ("recover", "회수", 20, 28), ("guard_return", "가드 복귀", 28, 40)],
    "contactKey": 18,
}

# the hooking arm, chest-relative (it rides the torso turn): wrist in front of the chest centre at shoulder height,
# elbow out to the side and up, palm towards the boxer
# Phase 6: the eyes follow the attack — guard gaze until the load (key 8), turning to the real target (the
# fist at contact, computed by author_strike.py from this run's own pose) by contact (18), held through the short
# hold (20), back to the guard gaze by key 30. Arm, body, feet and timing are unchanged from v3.
GAZE_FOLLOWS = {"hand": "l", "ramp": [(8, 0.0), (17, 1.0), (21, 1.0), (30, 0.0)]}

# Phase 5: the set arm sits further out in front of the chest (elbow ~110-125 deg, still a hook, not a swing) and the
# body turns further, so the fist travels a wider arc — the arm is not stretched
HOOK_ARM = {"space": "chest", "target": (-0.10, 0.415, 0.17), "pole": (1.0, -0.15, 0.35), "palm": (0.0, -1.0, 0.0), "flex": 0.0}


def _poses():
    g = guard_state()
    load = deep(g)
    load["pelvis"].update({"pos": (0.01, -0.02, -0.08), "yaw": -24.0, "roll": -1.0})
    load["spine"].update({"yaw": -6.0, "pitch": 9.0, "roll": -3.0})
    load["arms"]["l"] = blend_states(g["arms"]["l"], HOOK_ARM, 0.15)
    hit = deep(g)
    hit["pelvis"].update({"pos": (0.02, 0.01, -0.07), "yaw": -76.0, "pitch": 4.0, "roll": 0.0})  # weight centred, not sitting back (Phase 4)
    hit["spine"].update({"yaw": -27.0, "pitch": 10.0, "roll": -9.0})  # shoulders ~90 deg turned at contact; head over the hips, not behind them (Phase 4)
    hit["clavicle"]["l"] = (8.0, 6.0)
    hit["arms"]["l"] = dict(HOOK_ARM)
    hit["arms"]["r"]["target"] = (-0.14, 0.20, 0.21)  # rear hand by the chin — Phase 6: 4 cm out so the turning face (eyes on the target) does not run into it
    hit["head"]["tuck"] = 10.0
    hit["feet"]["l"].update({"yaw": -82.0, "lift": 24.0, "pole": (-0.2, 1.0, 0.0)})  # lead-foot pivot
    hit["feet"]["r"].update({"lift": 8.0})
    back = deep(g)
    back["pelvis"]["yaw"] = -36.0
    back["spine"]["yaw"] = -12.0
    back["pelvis"]["pos"] = (-0.01, -0.03, -0.065)
    back["feet"]["l"].update({"yaw": -22.0, "lift": 4.0})
    return g, load, hit, back


def state_at(key):
    g, load, hit, back = _poses()
    if key <= 6:
        return g, 0.0
    if key <= 10:
        return blend_states(g, load, smoothstep((key - 6) / 4)), 0.0
    if key <= 18:
        return blend_states(load, hit, ease_in_out((key - 10) / 8)), 0.0
    if key <= 20:
        return hit, 0.0
    if key <= 28:
        return blend_states(hit, back, ease_in_out((key - 20) / 8)), 0.0
    return blend_states(back, g, smoothstep((key - 28) / 12)), 0.0
