"""Per-frame mesh contact audit of a motion GLB (read only): does an arm/hand really pass INTO the torso mesh?

Vertices are assigned to a body region by their largest skin weight. Each frame the skinned mesh is evaluated
and, per region pair, the triangle-triangle intersections between the two regions' faces are counted
(BVHTree.overlap). (A vertex-inside-surface depth is not reported: a body region is an open surface, so a
nearest-normal test gives false positives.) "Hidden by the torso from one camera" is NOT counted — only real 3D interpenetration.

    blender -b --factory-startup -P scripts/motion3d/mesh_contact_audit.py -- <file.glb> <out.json>
"""
import json
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30  # sample the 30 fps keys exactly (the importer converts seconds with the scene fps)
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=glb)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
scene = bpy.context.scene
act = arm.animation_data.action if arm.animation_data else None
f0, f1 = (int(act.frame_range[0]), int(act.frame_range[1])) if act else (scene.frame_start, scene.frame_end)

TORSO = {"Hips", "Spine", "Spine1", "Spine2", "Neck", "LeftShoulder", "RightShoulder", "DEF_LeftShoulder", "DEF_RightShoulder"}
HEAD = {"Head"}


def region_of(bone):
    b = bone.replace("mixamorig:", "")
    if b in TORSO:
        return "torso"
    if b in HEAD:
        return "head"
    for side in ("Left", "Right"):
        if b.startswith(side + "Hand"):
            return side.lower() + "Hand"
        if b == side + "ForeArm":
            return side.lower() + "Forearm"
        if b == side + "Arm":
            return side.lower() + "UpperArm"
    return "legs"


groups = {g.index: g.name for g in mesh.vertex_groups}
vregion = []
for v in mesh.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    vregion.append(region_of(groups[best.group]) if best else "none")
faces_by = {}
for p in mesh.data.polygons:
    rs = {vregion[i] for i in p.vertices}
    if len(rs) == 1:
        faces_by.setdefault(rs.pop(), []).append(list(p.vertices))

PAIRS = [("rightHand", "torso"), ("rightForearm", "torso"), ("rightHand", "head"), ("leftHand", "torso"), ("leftForearm", "torso"), ("leftHand", "head"), ("rightForearm", "rightUpperArm"), ("leftForearm", "leftUpperArm")]
frames = []
for f in range(f0, f1 + 1):
    scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    co = [mw @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    trees = {r: BVHTree.FromPolygons([co[i] for i in range(len(co))], fs, all_triangles=False) for r, fs in faces_by.items()}
    row = {"frame": f, "time": round(f / scene.render.fps * scene.render.fps_base, 4)}
    for a, b in PAIRS:
        if a not in trees or b not in trees:
            continue
        pairs = trees[a].overlap(trees[b])
        row[f"{a}~{b}"] = len(pairs)
    frames.append(row)
json.dump({"file": glb, "frameRange": [f0, f1], "regionsVertexCount": {r: vregion.count(r) for r in set(vregion)}, "frames": frames}, open(out, "w"), indent=1)
print("AUDIT_WROTE", out, len(frames))
