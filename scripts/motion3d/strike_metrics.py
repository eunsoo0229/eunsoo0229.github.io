"""Striking-arm metrics of an authored clip on the character (Phase 5). Read only.

    blender -b --factory-startup -P scripts/motion3d/strike_metrics.py -- <out.json> <character.glb> <animation.glb> <side l|r>

Per key: elbow angle (upper arm vs forearm, 180 = straight), shoulder->wrist distance as a fraction of the arm's
full length (upper arm + forearm), fist position in the character frame, and the fist's path length so far.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, CHAR, ANIM, S = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
# the glTF importer turns seconds into frames at the scene rate (factory default 24): use the clips' 30 fps so
# frame numbers are the authored keys
bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = 30, 1.0
bpy.ops.import_scene.gltf(filepath=os.path.abspath(CHAR))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(ANIM))
new = [o for o in bpy.data.objects if o not in before]
action = next(o for o in new if o.type == "ARMATURE").animation_data.action
for o in new:
    bpy.data.objects.remove(o, do_unlink=True)
arm.animation_data_create()
arm.animation_data.action = action
f0, f1 = int(action.frame_range[0]), int(action.frame_range[1])
M = arm.matrix_world
P = arm.pose.bones
h = lambda n: M @ P[n].head
up = Vector((0, 0, 1))
# character frame from the REST skeleton (the guard pose at key 0 is already turned ~40 deg)
rest = lambda n: M @ arm.data.bones[n].head_local
L = rest("upperarm_l") - rest("upperarm_r")
L.z = 0
L.normalize()
F = L.cross(up).normalized()
if F.dot(rest("ball_l") - rest("foot_l")) < 0:
    F = -F
keys = []
prev = None
prevq = None
prevc = None
path = 0.0
for f in range(f0, f1 + 1):
    bpy.context.scene.frame_set(f)
    sh, el, wr = h(f"upperarm_{S}"), h(f"lowerarm_{S}"), h(f"hand_{S}")
    fist = M @ P[f"hand_{S}"].tail
    a, b = sh - el, wr - el
    ang = math.degrees(a.angle(b))
    full = (sh - el).length + (wr - el).length
    if prev is not None:
        path += (fist - prev).length
    prev = fist.copy()
    # where the face points vs where the striking fist is (Phase 6 gaze check)
    hb = P["head"]
    face = ((M @ hb.matrix).to_3x3() @ (hb.bone.matrix_local.to_3x3().inverted() @ (M.to_3x3().inverted() @ F))).normalized()
    to_fist = (fist - (M @ hb.head)).normalized()
    cq = (M @ P["spine_03"].matrix).to_quaternion()
    chest_step = 0.0 if prevc is None else math.degrees(prevc.rotation_difference(cq).angle)
    prevc = cq
    hq = (M @ hb.matrix).to_quaternion()
    head_step = 0.0 if prevq is None else math.degrees(prevq.rotation_difference(hq).angle)
    prevq = hq
    hz = lambda v: Vector((v.x, v.y, 0.0)).normalized()
    keys.append({"key": f, "faceToFistDeg": round(math.degrees(face.angle(to_fist)), 1), "faceToFistYawDeg": round(math.degrees(hz(face).angle(hz(to_fist))), 1), "headTurnPerKeyDeg": round(head_step, 2), "chestTurnPerKeyDeg": round(chest_step, 2), "elbowDeg": round(ang, 1), "reach": round((wr - sh).length / full, 3), "fist": [round((fist).dot(L), 3), round(fist.dot(F), 3), round(fist.z, 3)], "pathM": round(path, 3)})
json.dump({"animation": os.path.basename(ANIM), "side": S, "keys": keys}, open(OUT, "w"), indent=1)
best = max(keys, key=lambda k: k["elbowDeg"])
print("METRIC", os.path.basename(ANIM), S, "max elbow", best["elbowDeg"], "@", best["key"], "reach", best["reach"], "path", keys[-1]["pathM"])
