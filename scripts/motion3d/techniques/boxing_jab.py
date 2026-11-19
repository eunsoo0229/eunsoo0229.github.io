"""boxing__jab — lead-hand straight (orthodox: left hand). Authored keyframes on the Mesh2Motion human rig (Phase 4);
replaces the mocap jab (boxing-jab-nw-v2*, mixamo rig — kept) once reviewed.

Mechanics shown (public coaching basics): the lead hand travels straight from the guard along the line to the
target and turns palm-down at the end; the lead shoulder comes forward and up to cover the chin, the hips turn in
a little and the weight moves slightly onto the lead leg (no step — a jab from the stance); the rear hand stays at
the chin; the fist returns along the same line, faster than it went out, and the guard resets.
  keys 0-8   Preparation: guard, small settle (a slight bend, no wind-up — the jab gives nothing away)
  keys 8-16  Execution:   straight extension, full extension at 14, short hold
  keys 16-24 Recovery:    hand returns along the punching line
  keys 24-36 Guard return: settle into the starting guard
"""
from boxing_stance import blend_states, deep, guard_state
from rig_kit import ease_in_out, smoothstep

META = {
    "id": "boxing-jab-m2m-v2",
    "techniqueIds": ["boxing__jab"],
    "title": "잽 (오소독스, 왼손 스트레이트)",
    "side": "left (lead hand), orthodox stance",
    "fps": 30,
    "lastKey": 36,
    "phases": [("prepare", "준비", 0, 8), ("execute", "실행", 8, 16), ("recover", "회수", 16, 24), ("guard_return", "가드 복귀", 24, 36)],
    "contactKey": 14,
}

# the lead arm at full extension (character frame, world space): wrist on the line to the opponent's chin
# Phase 5: aim point; the wrist goes `reach` x arm length from the shoulder along that line
STRIKE = {"side": "l", "target": (0.07, 0.64, 1.47), "pole": (0.55, 0.0, -1.0), "palm": (0.0, 0.0, -1.0), "reach": 0.995}


def _poses():
    g = guard_state()
    load = deep(g)
    load["pelvis"].update({"pos": (-0.01, -0.04, -0.07)})
    hit = deep(g)
    hit["pelvis"].update({"pos": (0.0, 0.0, -0.07), "yaw": -24.0, "pitch": 5.0})
    hit["spine"].update({"yaw": -2.0, "pitch": 10.0})  # lead shoulder forward, a little lean into it
    hit["clavicle"]["l"] = (14.0, 9.0)  # lead shoulder forward and up (chin cover)
    hit["arms"]["r"]["target"] = (-0.12, 0.19, 0.20)  # rear hand stays at the chin
    hit["head"]["tuck"] = 9.0
    hit["feet"]["r"].update({"lift": 18.0})
    back = deep(g)
    back["pelvis"]["yaw"] = -28.0
    back["feet"]["r"].update({"lift": 14.0})
    return g, load, hit, back


def state_at(key):
    """(body state, strike progress 0..1 or 0) at an integer key."""
    g, load, hit, back = _poses()
    if key <= 4:
        return g, 0.0
    if key <= 8:
        return blend_states(g, load, smoothstep((key - 4) / 4)), 0.0
    if key <= 14:
        t = (key - 8) / 6
        return blend_states(load, hit, ease_in_out(t)), ease_in_out(min(1.0, (key - 8) / 5.5))
    if key <= 16:
        return hit, 1.0
    if key <= 24:
        t = ease_in_out((key - 16) / 6)  # the hand comes back faster than it went out
        return blend_states(hit, back, min(1.0, t)), max(0.0, 1.0 - t)
    return blend_states(back, g, smoothstep((key - 24) / 12)), 0.0
