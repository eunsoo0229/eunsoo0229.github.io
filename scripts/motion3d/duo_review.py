"""Review of a two-person demo (Phase 5), from the authored .blend (both characters, tinted). Read only.

    blender -b --factory-startup -P scripts/motion3d/duo_review.py -- <id>.blend <out_dir> [render keys k,k,..] [ortho scale] [cx,cy,cz]

Per key, on the evaluated (skinned) meshes:
  interBodyPairs   triangle pairs where the two characters intersect, per body-part pair (A part ~ B part)
  lowestSkin       lowest skin point of each character (floor penetration < 0)
  pelvisStepM      how far each pelvis moved since the previous key (a jump = teleport)
Renders front / 45 / side / back / top-45 views of the listed keys (Workbench, the tints of the app).
"""
import json
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
BLEND, OUT = argv[0], argv[1]
RENDER = [int(x) for x in argv[2].split(",")] if len(argv) > 2 and argv[2] else []
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(BLEND))
sc = bpy.context.scene
name = os.path.splitext(os.path.basename(BLEND))[0]
arms = {o.name[0]: o for o in bpy.data.objects if o.type == "ARMATURE"}
meshes = {w: [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == a] for w, a in arms.items()}
f0, f1 = int(sc.frame_start), int(sc.frame_end)


def region(bone):
    b = bone.split("_", 1)[1] if "_" in bone else bone
    for key, names in (("head", ("head", "neck")), ("torso", ("pelvis", "spine", "clavicle")), ("arm", ("upperarm", "lowerarm")), ("hand", ("hand", "thumb", "index", "middle", "ring", "pinky")), ("thigh", ("thigh",)), ("leg", ("calf", "foot", "ball"))):
        if b.startswith(names):
            return key
    return "other"


sides_of = {}


def tris(who):
    out = []
    side_list = []
    dg = bpy.context.evaluated_depsgraph_get()
    for m in meshes[who]:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        vg_names = [g.name for g in m.vertex_groups]
        reg = []
        for v in me.vertices:
            best = max(v.groups, key=lambda g: g.weight, default=None)
            reg.append(region(vg_names[best.group]) if best else "other")
            nm = vg_names[best.group] if best else ""
            side_list.append("l" if nm.endswith("_l") else "r" if nm.endswith("_r") else "")
        mw = m.matrix_world
        verts = [mw @ v.co for v in me.vertices]
        me.calc_loop_triangles()
        polys = [tuple(t.vertices) for t in me.loop_triangles]
        out.append((verts, polys, reg))
        ev.to_mesh_clear()
    sides_of[who] = side_list
    return out


keys = []
prev = {}
for f in range(f0, f1 + 1):
    sc.frame_set(f)
    data = {w: tris(w) for w in arms}
    trees = {}
    for w, parts in data.items():
        verts, polys, regs = [], [], []
        for vs, ps, rg in parts:
            off = len(verts)
            verts += vs
            polys += [tuple(i + off for i in p) for p in ps]
            regs += rg
        trees[w] = (BVHTree.FromPolygons(verts, polys), polys, regs, verts)
    ta, pa, ra, va = trees["A"]
    tb, pb, rb, vb = trees["B"]
    pairs = {}
    for i, j in ta.overlap(tb):
        k = f"A.{ra[pa[i][0]]}~B.{rb[pb[j][0]]}"
        pairs[k] = pairs.get(k, 0) + 1
    # one person's two arms against each other (left arm+hand vs right arm+hand, the clasped hands reported apart)
    selfArms = {}
    for w, (tree_w, polys_w, regs_w, verts_w) in trees.items():
        sides = sides_of[w]
        L = [i for i, p in enumerate(polys_w) if regs_w[p[0]] in ("arm", "hand") and sides[p[0]] == "l"]
        R = [i for i, p in enumerate(polys_w) if regs_w[p[0]] in ("arm", "hand") and sides[p[0]] == "r"]
        if L and R:
            tl = BVHTree.FromPolygons(verts_w, [polys_w[i] for i in L])
            tr = BVHTree.FromPolygons(verts_w, [polys_w[i] for i in R])
            hits = tl.overlap(tr)
            selfArms[w] = {"armToArm": sum(1 for a, b in hits if regs_w[polys_w[L[a]][0]] == "arm" or regs_w[polys_w[R[b]][0]] == "arm"), "handToHand": sum(1 for a, b in hits if regs_w[polys_w[L[a]][0]] == "hand" and regs_w[polys_w[R[b]][0]] == "hand")}
    entry = {"key": f, "interBodyPairs": pairs, "selfArms": selfArms, "lowestSkin": {w: round(min(v.z for v in trees[w][3]), 4) for w in trees}, "pelvisStepM": {}}
    entry["balls"] = {}
    for w, a in arms.items():
        entry["balls"][w] = {s: [round(v, 4) for v in (a.matrix_world @ a.pose.bones[f"{w}_ball_{s}"].head)] for s in ("l", "r")}
        p = a.matrix_world @ a.pose.bones[f"{w}_pelvis"].head
        entry["pelvisStepM"][w] = round((p - prev[w]).length, 4) if w in prev else 0.0
        prev[w] = p.copy()
    keys.append(entry)

if RENDER:
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.render.resolution_x, sc.render.resolution_y = 520, 420
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.18, 0.19, 0.21)  # the app's dark viewer background
    camd = bpy.data.cameras.new("cam")
    camd.type = "ORTHO"
    camd.ortho_scale = float(argv[3]) if len(argv) > 3 else 3.4
    cam = bpy.data.objects.new("cam", camd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    centre = Vector(tuple(float(x) for x in argv[4].split(","))) if len(argv) > 4 else Vector((0, -1.0, 0.7))
    FWD, LEFT = Vector((0, -1, 0)), Vector((1, 0, 0))
    VIEWS = {"front": FWD, "q45": (FWD + LEFT).normalized(), "side": LEFT, "back": -FWD, "top45": (LEFT + Vector((0, 0, 1.2))).normalized()}
    for f in RENDER:
        sc.frame_set(f)
        for vn, d in VIEWS.items():
            # side views look across both actors (they stand along the forward axis)
            cam.location = centre + d * 8
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(OUT, f"{name}-k{f:02d}-{vn}.png")
            bpy.ops.render.render(write_still=True)

# a hand on the partner is an intended grip / post (rigid mannequin: some overlap is unavoidable) — reported apart
# from body-to-body penetration (torso, head, limbs), which is what must stay low
for k in keys:
    k["gripContact"] = sum(v for p, v in k["interBodyPairs"].items() if ".hand" in p)
    k["bodyPenetration"] = sum(v for p, v in k["interBodyPairs"].items() if ".hand" not in p)
# planted feet must not slide: ball of the foot on the floor (< 3.5 cm) at two keys in a row -> its horizontal travel
for prev_k, k in zip(keys, keys[1:]):
    k["plantedSlideM"] = {}
    for w in arms:
        for s in ("l", "r"):
            a, b = prev_k["balls"][w][s], k["balls"][w][s]
            if a[2] < 0.035 and b[2] < 0.035:
                k["plantedSlideM"][f"{w}.{s}"] = round(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5, 4)
slides = [v for k in keys[1:] for v in k["plantedSlideM"].values()]
print("DUO", name, "max planted-foot slide per key (m)", max(slides) if slides else 0, "total", round(sum(slides), 3))
print("DUO", name, "max body-to-body tri pairs", max(k["bodyPenetration"] for k in keys), "max grip contact", max(k["gripContact"] for k in keys))
worst = max(keys, key=lambda k: sum(k["interBodyPairs"].values()))
print("DUO", name, "max inter-body tri pairs", sum(worst["interBodyPairs"].values()), "@", worst["key"], worst["interBodyPairs"], "lowest", min(min(k["lowestSkin"].values()) for k in keys), "max pelvis step", max(max(k["pelvisStepM"].values()) for k in keys))
json.dump({"blend": os.path.basename(BLEND), "keys": keys}, open(os.path.join(OUT, f"{name}-duo-review.json"), "w"), indent=1)
