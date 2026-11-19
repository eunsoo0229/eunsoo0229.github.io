"""Author a MARTIALDEX technique animation on the Mesh2Motion human rig (Phase 1.3) — keyframes, no capture.

    blender -b --factory-startup -P scripts/motion3d/author_strike.py -- <technique module> <character.glb> <out_dir> [southpaw]
    e.g. boxing_cross public/motion3d/characters/m2m-human-base-v1.glb build/

The technique module (scripts/motion3d/techniques/<name>.py) gives META and state_at(key) -> (body state, strike
progress). With `southpaw` every state (and STRIKE) is mirrored to the opposite stance first
(boxing_stance.mirror_state) and solved on the same skeleton — id gets "-southpaw". Every key is solved from rest with boxing_stance.solve (IK, planted feet, gaze), rotations are recorded,
then written as an action (rotation keys for every bone + pelvis location; key 0 at t = 0). Outputs:
  <id>.glb    animation only (armature + action, no mesh) — the app plays it on the shared character
  <id>.blend  Blender 3.4 source with the character mesh, for editing
  <id>.json   per-key log (phases, strike progress)
"""
import importlib
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "techniques"))
from boxing_stance import chest_frame, mirror_state, mirror_strike, solve  # noqa: E402
from rig_kit import Rig  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
TECH, CHAR, OUT = argv[0], argv[1], argv[2]
SOUTHPAW = len(argv) > 3 and argv[3] == "southpaw"
os.makedirs(OUT, exist_ok=True)
mod = importlib.import_module(TECH)
META = dict(mod.META)
STRIKE_DEF = getattr(mod, "STRIKE", None)
state_at = mod.state_at
if SOUTHPAW:
    swap_ko = {"오소독스": "사우스포", "왼손": "오른손", "오른손": "왼손"}
    META["title"] = "".join(swap_ko.get(w, w) for w in __import__("re").split("(오소독스|왼손|오른손)", META["title"]))
    META.update({"id": META["id"] + "-southpaw", "stance": "southpaw", "side": META["side"].replace("left", "LEFT_").replace("right", "left").replace("LEFT_", "right").replace("orthodox", "southpaw")})
    STRIKE_DEF = mirror_strike(STRIKE_DEF) if STRIKE_DEF else None
    state_at = lambda key: (lambda r: (mirror_state(r[0]), r[1]))(mod.state_at(key))  # noqa: E731
else:
    META.setdefault("stance", "orthodox")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(CHAR))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
arm.animation_data_clear()
rig = Rig(arm)

# GAZE_FOLLOWS (Phase 6, hook): the eyes go to the real target — the striking fist at the contact key, measured on
# this run's own solved pose (so orthodox and southpaw get the same rule) — and come back to the guard gaze after
follow = getattr(mod, "GAZE_FOLLOWS", None)
gaze_target = None
if follow:
    side_f = follow["hand"] if not SOUTHPAW else ("r" if follow["hand"] == "l" else "l")
    solve(rig, state_at(META["contactKey"])[0])
    head_c = rig.head("head")
    fist = rig.tail(f"hand_{side_f}")
    gaze_target = tuple(rig.to_char(head_c + (fist - head_c).normalized() * 2.0))  # same direction, ~2 m out
    gaze_origin = rig.to_char(head_c)
    META["gazeTarget"] = {"hand": side_f, "contactKey": META["contactKey"], "pointCharFrame": [round(v, 3) for v in gaze_target]}


def gaze_weight(key):
    pts = follow["ramp"]
    if key <= pts[0][0]:
        return pts[0][1]
    for (k0, w0), (k1, w1) in zip(pts, pts[1:]):
        if key <= k1:
            t = (key - k0) / (k1 - k0)
            return w0 + (w1 - w0) * t * t * (3 - 2 * t)
    return pts[-1][1]


frames = list(range(0, META["lastKey"] + 1))
rec = []
log = []
for key in frames:
    body, s = state_at(key)
    if gaze_target is not None:
        w = gaze_weight(key)
        if w > 0:
            # turn the DIRECTION at an even angular rate (slerp) — blending the two points would swing the head
            # unevenly when they are far apart (a 130 deg turn)
            from mathutils import Vector as _V

            d0 = (_V(body["head"]["gaze"]) - gaze_origin).normalized()
            d1 = (_V(gaze_target) - gaze_origin).normalized()
            # turn horizontally to the target and keep the guard's eye height: the head rotates about the
            # vertical (no tipping back / down, which would carry the head behind the hips)
            h1 = _V((d1.x, d1.y, 0.0)).normalized()
            el = d0.z / max(1e-6, _V((d0.x, d0.y, 0.0)).length)
            d1 = _V((h1.x, h1.y, el)).normalized()
            d = d0.slerp(d1, w) if d0.angle(d1) > 1e-4 else d1
            body = {**body, "head": {**body["head"], "gaze": tuple(gaze_origin + d * 2.0), "neckShare": 0.4 - 0.4 * w}}
    override = None
    strike = STRIKE_DEF
    if strike and s > 0:
        side = strike["side"]
        solve(rig, body)  # guard pose of this key -> where the striking hand would be
        Rc, _ = chest_frame(rig)
        a = body["arms"][side]
        g_target = rig.head(f"hand_{side}")
        g_pole = Rc @ rig.cv(*a["pole"])
        g_palm = (Rc @ rig.cv(*a["palm"])).normalized()
        aim = rig.cp(*strike["target"])
        if strike.get("reach"):
            # Phase 5: the strike is aimed FROM the shoulder of this key's pose (direction = the target, distance =
            # `reach` x arm length) — a fixed point in space left the arm bent once the body leaned into the punch
            sh = rig.head(f"upperarm_{side}")
            arm_len = (rig.head(f"lowerarm_{side}") - sh).length + (rig.head(f"hand_{side}") - rig.head(f"lowerarm_{side}")).length
            aim = sh + (aim - sh).normalized() * strike["reach"] * arm_len
        override = {side: {"target": g_target.lerp(aim, s), "pole": g_pole.lerp(rig.cv(*strike["pole"]), s), "palm": g_palm.lerp(rig.cv(*strike["palm"]).normalized(), s).normalized()}}
    solve(rig, body, override)
    rec.append({b.name: (tuple(b.rotation_quaternion), tuple(b.location)) for b in arm.pose.bones})
    log.append({"key": key, "strike": round(s, 4), **({"gazeWeight": round(gaze_weight(key), 3)} if gaze_target is not None else {})})

# quaternion hemisphere continuity, then write fcurves directly (no depsgraph re-evaluation while solving)
prev = {}
for r in rec:
    for n, (q, loc) in list(r.items()):
        if n in prev and sum(a * b for a, b in zip(prev[n], q)) < 0:
            q = tuple(-x for x in q)
            r[n] = (q, loc)
        prev[n] = q
act = bpy.data.actions.new(META["id"])
arm.animation_data_create()
arm.animation_data.action = act


def put(path, idx, values, group):
    fc = act.fcurves.new(path, index=idx, action_group=group)
    fc.keyframe_points.add(len(values))
    co = []
    for f, v in zip(frames, values):
        co += [f, v]
    fc.keyframe_points.foreach_set("co", co)
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"
    fc.update()


for b in arm.pose.bones:
    for i in range(4):
        put(f'pose.bones["{b.name}"].rotation_quaternion', i, [r[b.name][0][i] for r in rec], b.name)
for i in range(3):
    put('pose.bones["pelvis"].location', i, [r["pelvis"][1][i] for r in rec], "pelvis")

sc = bpy.context.scene
sc.render.fps = META["fps"]
sc.render.fps_base = 1.0
sc.frame_start, sc.frame_end = frames[0], frames[-1]
base = os.path.join(OUT, META["id"])
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(base + ".blend"), copy=True)

# animation-only GLB: the armature and its action, no mesh (the character is a separate file)
for o in bpy.data.objects:
    o.select_set(o.type == "ARMATURE")
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=os.path.abspath(base + ".glb"), export_format="GLB", use_selection=True, export_animations=True, export_frame_range=True, export_force_sampling=False, export_skins=True, export_yup=True)  # only the keyed channels (rotations + pelvis location)
json.dump({"meta": META, "keys": log}, open(base + ".json", "w"), indent=1)
print("AUTHORED", base + ".glb")
