"""Rig / skin deformation test for a candidate character (Phase 1.3): the SAME test poses on any Mixamo-named or
UE-mannequin-named (Mesh2Motion human) rig, rendered and measured, so characters can be compared fairly.

Poses are defined in the character's own frame (left / up / forward measured from the rest skeleton), as
segment directions ("aim") plus rotations about character or bone axes ("rot") — so an A-pose rig and a T-pose rig
reach the same body pose. Per pose: Workbench renders (front, side, 3/4) and, on the evaluated skinned mesh,
(1) triangle intersections between body regions and (2) skin distortion at joints (triangle area ratio vs rest).

    blender -b --factory-startup -P scripts/motion3d/rig_pose_test.py -- <model.glb> <label> <out_dir>
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, LABEL, OUT = argv[0], argv[1], argv[2]
os.makedirs(OUT, exist_ok=True)

# canonical -> (mixamo suffix, UE / Mesh2Motion name)
CANON = {
    "pelvis": ("Hips", "pelvis"), "spine1": ("Spine", "spine_01"), "spine2": ("Spine1", "spine_02"), "chest": ("Spine2", "spine_03"),
    "neck": ("Neck", "neck_01"), "head": ("Head", "head"),
}
for s, m, u in (("l", "Left", "l"), ("r", "Right", "r")):
    CANON.update({
        f"clavicle_{s}": (f"{m}Shoulder", f"clavicle_{u}"), f"upperarm_{s}": (f"{m}Arm", f"upperarm_{u}"), f"forearm_{s}": (f"{m}ForeArm", f"lowerarm_{u}"),
        f"hand_{s}": (f"{m}Hand", f"hand_{u}"), f"thigh_{s}": (f"{m}UpLeg", f"thigh_{u}"), f"calf_{s}": (f"{m}Leg", f"calf_{u}"), f"foot_{s}": (f"{m}Foot", f"foot_{u}"),
        f"toe_{s}": (f"{m}ToeBase", f"ball_{u}"),
    })
    for fi, (mf, uf) in enumerate((("Index", "index"), ("Middle", "middle"), ("Ring", "ring"), ("Pinky", "pinky"))):
        for j in (1, 2, 3):
            CANON[f"{uf}{j}_{s}"] = (f"{m}Hand{mf}{j}", f"{uf}_0{j}_{u}")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == arm]
arm.animation_data_clear()
for o in meshes:
    o.animation_data_clear()
names = {b.name for b in arm.pose.bones}


def bone_name(c):
    m, u = CANON[c]
    for n in (f"mixamorig:{m}", f"mixamorig{m}", m, u):
        if n in names:
            return n
    return None


B = {c: bone_name(c) for c in CANON}
missing = [c for c, n in B.items() if n is None and not c[:-2].rstrip("123").endswith(("index", "middle", "ring", "pinky"))]
MW = arm.matrix_world
to_arm = MW.to_3x3().inverted()


def head_w(c):
    return MW @ arm.pose.bones[B[c]].head


def reset():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


reset()
LEFT = (head_w("upperarm_l") - head_w("upperarm_r")).normalized()
UP = Vector((0, 0, 1))
LEFT = (LEFT - UP * LEFT.dot(UP)).normalized()
FWD = LEFT.cross(UP).normalized()  # character forward
toe = head_w("toe_l") - head_w("foot_l")
if FWD.dot(toe) < 0:  # the toes say otherwise: this rig's "left" bones sit on the other side for our frame
    LEFT, FWD = -LEFT, -FWD
print("FRAME", LABEL, "left", tuple(round(x, 3) for x in LEFT), "fwd", tuple(round(x, 3) for x in FWD))


def cv(x, y, z):  # character-frame vector (x = left, y = forward, z = up) -> world
    return (LEFT * x + FWD * y + UP * z).normalized()


def set_rot(c, R_world):
    """Rotate bone c about its head by world rotation R (3x3), children follow."""
    if not B.get(c):
        return
    pb = arm.pose.bones[B[c]]
    Ra = to_arm @ R_world @ to_arm.inverted()
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Ra.to_4x4() @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()


def aim(c, d):
    pb = arm.pose.bones[B[c]]
    cur = (MW.to_3x3() @ (pb.tail - pb.head)).normalized()
    set_rot(c, cur.rotation_difference(d).to_matrix())


def rot(c, axis_world, deg):
    set_rot(c, Matrix.Rotation(math.radians(deg), 3, axis_world))


def bone_axis(c):
    pb = arm.pose.bones[B[c]]
    return (MW.to_3x3() @ (pb.tail - pb.head)).normalized()


def neutral():
    reset()
    for s, sx in (("l", 1), ("r", -1)):
        aim(f"upperarm_{s}", cv(0.28 * sx, 0, -1))
        aim(f"forearm_{s}", cv(0.2 * sx, 0.05, -1))
        aim(f"hand_{s}", cv(0.15 * sx, 0.05, -1))


def fists(s, deg=80):
    for f in ("index", "middle", "ring", "pinky"):
        for j in (1, 2, 3):
            c = f"{f}{j}_{s}"
            if B.get(c):
                rot(c, LEFT, -deg if s == "l" else -deg)  # curl toward the palm (palms face the body in these poses)


def p_arms_up():
    neutral()
    for s, sx in (("l", 1), ("r", -1)):
        aim(f"upperarm_{s}", cv(0.25 * sx, 0.05, 1))
        aim(f"forearm_{s}", cv(0.2 * sx, 0.05, 1))
        aim(f"hand_{s}", cv(0.2 * sx, 0.05, 1))


def p_elbow_90():
    neutral()
    for s, sx in (("l", 1), ("r", -1)):
        aim(f"upperarm_{s}", cv(0.12 * sx, 0.15, -1))
        aim(f"forearm_{s}", cv(0.05 * sx, 1, 0))
        aim(f"hand_{s}", cv(0.05 * sx, 1, 0))


def p_elbow_deep():
    neutral()
    for s, sx in (("l", 1), ("r", -1)):
        aim(f"upperarm_{s}", cv(0.15 * sx, 0.25, -1))
        aim(f"forearm_{s}", cv(0.1 * sx, 0.45, 1))
        aim(f"hand_{s}", cv(0.1 * sx, 0.45, 1))


def p_wrist():
    p_elbow_90()
    for s in ("l", "r"):
        rot(f"hand_{s}", bone_axis(f"forearm_{s}"), 80)  # twist (pronation)
        rot(f"hand_{s}", UP, 0)
    rot("hand_l", LEFT, 55)  # flex / extend
    rot("hand_r", LEFT, -55)


def p_torso_twist():
    neutral()
    for c in ("spine1", "spine2", "chest"):
        rot(c, UP, 15)


def p_torso_bend():
    neutral()
    for c in ("spine1", "spine2", "chest"):
        rot(c, LEFT, 13)  # forward ~40 deg total


def p_torso_back():
    neutral()
    for c in ("spine1", "spine2", "chest"):
        rot(c, LEFT, -7)


def p_pelvis():
    neutral()
    rot("pelvis", UP, 30)
    rot("spine1", UP, -30)  # hips turn under a still chest
    for s in ("l", "r"):
        rot(f"thigh_{s}", UP, -30)  # feet stay


def p_knee():
    neutral()
    aim("thigh_l", cv(0.08, 1, -0.15))
    aim("calf_l", cv(0.05, 0.05, -1))
    aim("thigh_r", cv(-0.1, 0.5, -1))
    aim("calf_r", cv(-0.05, -0.6, -1))


def p_ankle():
    neutral()
    rot("foot_l", LEFT, 30)
    rot("foot_r", LEFT, -25)


def p_guard():
    neutral()
    rot("pelvis", UP, -25)
    rot("chest", UP, 10)
    for s, sx in (("l", 1), ("r", -1)):
        aim(f"upperarm_{s}", cv(0.35 * sx, 0.45, -0.85))
        aim(f"forearm_{s}", cv(-0.35 * sx, 0.45, 0.85))
        aim(f"hand_{s}", cv(-0.2 * sx, 0.35, 0.9))
        fists(s)
    aim("thigh_l", cv(0.2, 0.35, -1))
    aim("calf_l", cv(0.15, 0.1, -1))
    aim("thigh_r", cv(-0.2, -0.3, -1))
    aim("calf_r", cv(-0.15, -0.45, -1))


POSES = [("rest", reset), ("neutral", neutral), ("arms_up", p_arms_up), ("elbow_90", p_elbow_90), ("elbow_deep", p_elbow_deep), ("wrist", p_wrist), ("torso_twist", p_torso_twist), ("torso_bend", p_torso_bend), ("torso_back", p_torso_back), ("pelvis_turn", p_pelvis), ("knee", p_knee), ("ankle", p_ankle), ("guard", p_guard)]

# ---- regions by dominant weight
TORSO = {"pelvis", "spine1", "spine2", "chest", "neck", "clavicle_l", "clavicle_r"}
inv = {n: c for c, n in B.items() if n}


def region(group):
    c = inv.get(group)
    if c is None:
        return "other"
    if c in TORSO:
        return "torso"
    if c == "head":
        return "head"
    for s in ("l", "r"):
        if c == f"upperarm_{s}":
            return f"upperarm_{s}"
        if c == f"forearm_{s}":
            return f"forearm_{s}"
        if c == f"hand_{s}" or c.endswith(f"_{s}") and c[:-2].rstrip("123") in ("index", "middle", "ring", "pinky"):
            return f"hand_{s}"
        if c in (f"thigh_{s}",):
            return f"thigh_{s}"
        if c in (f"calf_{s}", f"foot_{s}"):
            return f"leg_{s}"
    return "other"


PAIRS = [("hand_l", "torso"), ("hand_r", "torso"), ("forearm_l", "torso"), ("forearm_r", "torso"), ("upperarm_l", "torso"), ("upperarm_r", "torso"), ("forearm_l", "upperarm_l"), ("forearm_r", "upperarm_r"), ("thigh_l", "thigh_r"), ("leg_l", "thigh_l"), ("leg_r", "thigh_r"), ("hand_l", "hand_r")]


def mesh_state(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    co = [ev.matrix_world @ v.co for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return co, polys


def tri_area(a, b, c):
    return ((b - a).cross(c - a)).length / 2


reset()
base = {}
vreg = {}
for o in meshes:
    groups = {g.index: g.name for g in o.vertex_groups}
    vreg[o.name] = [region(groups[max(v.groups, key=lambda g: g.weight).group]) if v.groups else "other" for v in o.data.vertices]
    co, polys = mesh_state(o)
    base[o.name] = (co, polys, [tri_area(co[p[0]], co[p[1]], co[p[2]]) for p in polys])

# ---- render setup
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "MATERIAL"
sc.render.resolution_x, sc.render.resolution_y = 360, 460
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0.93, 0.92, 0.9)
camd = bpy.data.cameras.new("cam")
camd.type = "ORTHO"
camd.ortho_scale = 2.25
cam = bpy.data.objects.new("cam", camd)
sc.collection.objects.link(cam)
sc.camera = cam
centre = (head_w("pelvis") * 0 + Vector((0, 0, 0.93))) + LEFT * LEFT.dot(head_w("pelvis")) + FWD * FWD.dot(head_w("pelvis"))
# name: (direction to camera, centre height, ortho scale) — full body plus joint close-ups (shoulders/elbows, hips)
VIEWS = {"front": (FWD, 0.93, 2.25), "side": (LEFT, 0.93, 2.25), "q34": ((FWD + LEFT).normalized(), 0.93, 2.25), "upper_q34": ((FWD - LEFT * 0.6).normalized(), 1.3, 0.95), "hips_q34": ((FWD + LEFT).normalized(), 0.9, 0.85)}

report = {"model": os.path.basename(GLB), "label": LABEL, "bones": len(arm.pose.bones), "skinJoints": len(arm.data.bones), "mapped": {c: n for c, n in B.items() if n}, "missing": missing,
          "meshes": [{"name": o.name, "verts": len(o.data.vertices), "polys": len(o.data.polygons)} for o in meshes], "poses": {}}
for name, fn in POSES:
    fn()
    row = {"pairs": {}, "distortion": {}}
    for o in meshes:
        co, polys = mesh_state(o)
        _, _, a0 = base[o.name]
        vr = vreg[o.name]
        by = {}
        for i, p in enumerate(polys):
            rs = {vr[k] for k in p}
            if len(rs) == 1:
                by.setdefault(rs.pop(), []).append(p)
        trees = {r: BVHTree.FromPolygons(co, ps) for r, ps in by.items()}
        for a, b in PAIRS:
            if a in trees and b in trees:
                row["pairs"][f"{a}~{b}"] = row["pairs"].get(f"{a}~{b}", 0) + len(trees[a].overlap(trees[b]))
        # skin distortion: triangle area ratio range per region (rest = 1); joints squash (<) or stretch (>)
        for i, p in enumerate(polys):
            r = vr[p[0]]
            if a0[i] < 1e-10:
                continue
            q = tri_area(co[p[0]], co[p[1]], co[p[2]]) / a0[i]
            lo, hi = row["distortion"].get(r, (9.0, 0.0))
            row["distortion"][r] = (min(lo, q), max(hi, q))
    row["distortion"] = {r: [round(v[0], 3), round(v[1], 3)] for r, v in row["distortion"].items()}
    for vname, (vdir, cz, scale) in VIEWS.items():
        c = Vector((centre.x, centre.y, cz))
        camd.ortho_scale = scale
        cam.location = c + vdir * 6
        cam.rotation_euler = (-vdir).to_track_quat("-Z", "Y").to_euler()  # camera up = world up
        sc.render.filepath = os.path.join(OUT, f"{LABEL}-{name}-{vname}.png")
        bpy.ops.render.render(write_still=True)
    report["poses"][name] = row
    print("POSE", name, json.dumps(row["pairs"]))
json.dump(report, open(os.path.join(OUT, f"{LABEL}-report.json"), "w"), indent=1)
print("RIGTEST_DONE", LABEL, "missing", missing)
