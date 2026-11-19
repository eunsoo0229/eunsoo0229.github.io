"""Independent review of an authored animation GLB on the character (Phase 1.3). Read only.

    blender -b --factory-startup -P scripts/motion3d/strike_review.py -- <character.glb> <animation.glb> <out_dir> [keys,..]

Imports the character and the animation-only GLB separately (as the app does), plays the action on the character
armature, and for EVERY key measures on the skinned mesh:
  - triangle intersections between body regions (hands / forearms / upper arms vs torso and head, arm vs own arm,
    hands vs each other, thighs, legs) — reported per key and region pair
  - lowest skin point (floor penetration), drift of each foot's ball while it is meant to be planted
  - per-bone rotation change between keys (sudden flips)
and renders front / side / back / 3-4 views (mesh, and skeleton overlay) for the listed keys.
Writes <out_dir>/<animation>-review.json and PNGs. Mannequin note: this character is built from separate shells
(limb segments, joint rings), so seams overlap even at rest — counts are reported as the increase over rest.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
CHAR, ANIM, OUT = argv[0], argv[1], argv[2]
RENDER_KEYS = [int(x) for x in argv[3].split(",")] if len(argv) > 3 else []
os.makedirs(OUT, exist_ok=True)
name = os.path.splitext(os.path.basename(ANIM))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps, sc.render.fps_base = 30, 1.0
bpy.ops.import_scene.gltf(filepath=os.path.abspath(CHAR))
char_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(ANIM))
anim_objs = [o for o in bpy.data.objects if o not in before]
anim_arm = next(o for o in anim_objs if o.type == "ARMATURE")
action = anim_arm.animation_data.action
missing = sorted({fc.data_path.split('"')[1] for fc in action.fcurves if fc.data_path.startswith("pose.bones")} - {b.name for b in char_arm.pose.bones})
for o in anim_objs:
    bpy.data.objects.remove(o, do_unlink=True)
char_arm.animation_data_create()
char_arm.animation_data.action = action
f0, f1 = int(action.frame_range[0]), int(action.frame_range[1])

TORSO = {"pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "clavicle_l", "clavicle_r"}


def region(bone):
    if bone in TORSO:
        return "torso"
    if bone in ("head", "head_leaf"):
        return "head"
    for s in ("l", "r"):
        if bone == f"upperarm_{s}":
            return f"upperarm_{s}"
        if bone == f"lowerarm_{s}":
            return f"forearm_{s}"
        if bone == f"hand_{s}" or (bone.endswith(f"_{s}") and bone.split("_")[0] in ("index", "middle", "ring", "pinky", "thumb")):
            return f"hand_{s}"
        if bone == f"thigh_{s}":
            return f"thigh_{s}"
        if bone in (f"calf_{s}", f"foot_{s}", f"ball_{s}", f"ball_leaf_{s}"):
            return f"leg_{s}"
    return "other"


groups = {g.index: g.name for g in mesh.vertex_groups}
vreg = [region(groups[max(v.groups, key=lambda g: g.weight).group]) if v.groups else "other" for v in mesh.data.vertices]
faces = {}
for p in mesh.data.polygons:
    rs = {vreg[i] for i in p.vertices}
    if len(rs) == 1:
        faces.setdefault(rs.pop(), []).append(list(p.vertices))
PAIRS = [("hand_l", "torso"), ("hand_r", "torso"), ("forearm_l", "torso"), ("forearm_r", "torso"), ("upperarm_l", "torso"), ("upperarm_r", "torso"),
         ("hand_l", "head"), ("hand_r", "head"), ("forearm_l", "head"), ("forearm_r", "head"),
         ("forearm_l", "upperarm_l"), ("forearm_r", "upperarm_r"), ("hand_l", "hand_r"), ("forearm_l", "forearm_r"), ("hand_l", "forearm_r"), ("hand_r", "forearm_l"),
         ("thigh_l", "thigh_r"), ("leg_l", "leg_r"), ("leg_l", "thigh_l"), ("leg_r", "thigh_r")]


def state():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    co = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return co


def counts(co):
    trees = {r: BVHTree.FromPolygons(co, fs) for r, fs in faces.items()}
    return {f"{a}~{b}": len(trees[a].overlap(trees[b])) for a, b in PAIRS if a in trees and b in trees}


# rest baseline (seams of the shell mannequin)
char_arm.animation_data.action = None
for b in char_arm.pose.bones:
    b.matrix_basis.identity()
bpy.context.view_layer.update()
rest = counts(state())
char_arm.animation_data.action = action

keys = []
prev_q = {}
for f in range(f0, f1 + 1):
    sc.frame_set(f)
    co = state()
    c = counts(co)
    over = {k: v - rest.get(k, 0) for k, v in c.items() if v - rest.get(k, 0) > 0}
    li = min(range(len(co)), key=lambda i: co[i].z)
    lowest = co[li].z
    lowest_bone = groups[max(mesh.data.vertices[li].groups, key=lambda g: g.weight).group]
    balls = {s: (char_arm.matrix_world @ char_arm.pose.bones[f"ball_{s}"].head).copy() for s in ("l", "r")}
    jumps = {}
    for b in char_arm.pose.bones:
        q = (char_arm.matrix_world.to_quaternion() @ b.matrix.to_quaternion())
        if b.name in prev_q:
            d = math.degrees(prev_q[b.name].rotation_difference(q).angle)
            d = min(d, 360.0 - d)  # angle() wraps: 350 deg is a 10 deg turn
            if d > 0.05:
                jumps[b.name] = round(d, 2)
        prev_q[b.name] = q
    keys.append({"key": f, "newIntersections": over, "lowestSkinZ": round(lowest, 4), "lowestSkinBone": lowest_bone, "ball": {s: [round(x, 4) for x in v] for s, v in balls.items()}, "boneWorldDeltaDeg": jumps})

# ---- renders
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x, sc.render.resolution_y = 380, 460
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0.93, 0.92, 0.9)
camd = bpy.data.cameras.new("cam")
camd.type = "ORTHO"
camd.ortho_scale = 2.3
cam = bpy.data.objects.new("cam", camd)
sc.collection.objects.link(cam)
sc.camera = cam
FWD, LEFT = Vector((0, -1, 0)), Vector((1, 0, 0))
VIEWS = {"front": FWD, "side": LEFT, "back": -FWD, "q34": (FWD + LEFT).normalized(), "q34r": (FWD - LEFT).normalized(), "upper": (FWD + LEFT * 0.8).normalized(), "upper_r": (FWD - LEFT * 0.9).normalized()}
centre = Vector((0, 0, 0.9))
CLOSE = {"upper": (1.32, 1.0), "upper_r": (1.32, 1.0)}  # view -> (centre height, ortho scale)
for f in RENDER_KEYS:
    sc.frame_set(f)
    for vn, d in VIEWS.items():
        cz, sc_o = CLOSE.get(vn, (0.9, 2.3))
        camd.ortho_scale = sc_o
        cam.location = Vector((centre.x, centre.y, cz)) + d * 6
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        for mode in ("mesh", "skel"):
            mesh.hide_render = mode == "skel"
            char_arm.show_in_front = True
            if mode == "skel":
                continue  # workbench does not render armatures; skeleton views are taken in the app (SkeletonHelper)
            sc.render.filepath = os.path.join(OUT, f"{name}-k{f:02d}-{vn}.png")
            bpy.ops.render.render(write_still=True)
    mesh.hide_render = False

json.dump({"character": os.path.basename(CHAR), "animation": os.path.basename(ANIM), "action": action.name, "frameRange": [f0, f1], "bonesMissingOnCharacter": missing, "restSeamPairs": rest, "keys": keys}, open(os.path.join(OUT, f"{name}-review.json"), "w"), indent=1)
print("REVIEWED", name, "keys", len(keys), "missing", missing)
