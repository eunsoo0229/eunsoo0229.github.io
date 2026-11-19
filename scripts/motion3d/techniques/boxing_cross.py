"""boxing__cross — rear-hand straight (orthodox: right hand). Authored keyframes, no capture.

Mechanics shown (public coaching basics): the rear foot pivots on the ball with the heel turning out, the hips and
then the shoulders rotate square-and-past, weight moves onto the lead leg, the arm extends straight along the line
to the target and turns palm-down at the end, the lead hand stays at the chin, the punching shoulder rises to cover
the chin; the hand returns along the same line to guard.
  keys 0-10  Preparation: guard, small load (dip, slight extra turn away, weight onto the rear foot)
  keys 10-20 Execution:   pivot + hip/shoulder rotation + straight extension, full extension at 18, short hold
  keys 20-28 Recovery:    hand returns along the punching line, hips turn back
  keys 28-40 Guard return: settle into the starting guard
"""
from boxing_stance import blend_states, deep, guard_state
from rig_kit import ease_in_out, smoothstep

META = {
    "id": "boxing-cross-m2m-v3",
    "techniqueIds": ["boxing__cross"],
    "title": "크로스 (오소독스, 오른손 스트레이트)",
    "side": "right (rear hand), orthodox stance",
    "fps": 30,
    "lastKey": 40,
    "phases": [("prepare", "준비", 0, 10), ("execute", "실행", 10, 20), ("recover", "회수", 20, 28), ("guard_return", "가드 복귀", 28, 40)],
    "contactKey": 18,
}

# the punching arm at full extension (character frame, world space): wrist on the line to the opponent's chin
# Phase 5: "target" is the aim point (the opponent's chin); the wrist goes `reach` x arm length from the shoulder along that line
STRIKE = {"side": "r", "target": (0.02, 0.62, 1.47), "pole": (-0.55, 0.0, -1.0), "palm": (0.0, 0.0, -1.0), "reach": 0.995}


def _poses():
    g = guard_state()
    load = deep(g)
    load["pelvis"].update({"pos": (-0.015, -0.055, -0.075), "yaw": -34.0})
    load["spine"].update({"yaw": -12.0, "pitch": 9.0})
    load["feet"]["r"].update({"lift": 15.0})
    hit = deep(g)
    hit["pelvis"].update({"pos": (0.02, 0.02, -0.065), "yaw": 6.0, "pitch": 4.0, "roll": 2.0})  # COM ~0.7 towards the lead foot (Phase 4)
    hit["spine"].update({"yaw": 18.0, "pitch": 9.0, "roll": 4.0})  # shoulders past the hips, lean into it
    hit["clavicle"]["r"] = (18.0, 10.0)  # punching shoulder forward and up (chin cover)
    hit["arms"]["l"]["target"] = (0.29, 0.20, 0.25)  # lead hand back beside the left cheek, off the punching line
    hit["head"]["tuck"] = 11.0
    hit["feet"]["r"].update({"yaw": -8.0, "lift": 42.0, "pole": (0.25, 1.0, 0.0)})  # heel out, knee turns in
    back = deep(g)
    back["pelvis"]["yaw"] = -24.0
    back["spine"]["yaw"] = -6.0
    back["feet"]["r"].update({"lift": 18.0, "yaw": -38.0})
    back["arms"]["l"]["target"] = hit["arms"]["l"]["target"]  # lead hand stays at the cheek until the rear hand is home
    load["arms"]["l"]["target"] = blend_states(g["arms"]["l"], hit["arms"]["l"], 0.6)["target"]  # and gets there early
    return g, load, hit, back


def state_at(key):
    """(body state, strike progress 0..1 or 0) at an integer key."""
    g, load, hit, back = _poses()
    if key <= 6:
        return g, 0.0
    if key <= 10:
        return blend_states(g, load, smoothstep((key - 6) / 4)), 0.0
    if key <= 18:
        t = (key - 10) / 8
        # the fist accelerates from the guard and decelerates into full extension slightly ahead of the body
        return blend_states(load, hit, ease_in_out(t)), ease_in_out(min(1.0, (key - 10) / 7))
    if key <= 20:
        return hit, 1.0
    if key <= 28:
        t = ease_in_out((key - 20) / 8)
        return blend_states(hit, back, t), 1.0 - t
    return blend_states(back, g, smoothstep((key - 28) / 12)), 0.0
