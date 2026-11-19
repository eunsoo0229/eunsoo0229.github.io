"""Centre-of-mass audit of a technique animation (Phase 4). Read only.

    blender -b --factory-startup -P scripts/motion3d/com_audit.py -- <out.json> <character.glb> [<animation.glb>] [southpaw]

(one GLB = a clip that embeds its character, e.g. the mocap jab). Whole-body COM per key from a segment-mass
model (Winter, Biomechanics and Motor Control of Human Movement, 4th ed., table 4.1: mass fraction and COM
position along proximal->distal), on the evaluated skeleton. Reported in the floor plane against the feet:
  leadFraction  COM projected on the rear-foot-centre -> lead-foot-centre line: 0 = over the rear foot,
                1 = over the lead foot (orthodox: lead = left)
  lateralCm     signed distance from that line (+ = towards the character's left)
  inSupport     COM inside the support polygon (convex hull of both feet's heel / ball / toe points, a foot
                counts only while its ball is within 3 cm of the floor)
Works with UE-mannequin names (Mesh2Motion) and Mixamo names.
"""
import json
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, CHAR = argv[0], argv[1]
SOUTHPAW = "southpaw" in argv[2:]
rest_args = [a for a in argv[2:] if a != "southpaw"]
ANIM = rest_args[0] if rest_args else None
LEAD, REAR = ("r", "l") if SOUTHPAW else ("l", "r")

bpy.ops.wm.read_factory_settings(use_empty=True)
# the glTF importer turns seconds into frames at the scene rate (factory default 24): use the clips' 30 fps so
# frame numbers are the authored keys
bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = 30, 1.0
bpy.ops.import_scene.gltf(filepath=os.path.abspath(CHAR))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
if ANIM:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(ANIM))
    new = [o for o in bpy.data.objects if o not in before]
    action = next(o for o in new if o.type == "ARMATURE").animation_data.action
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    arm.animation_data_create()
    arm.animation_data.action = action
action = arm.animation_data.action
f0, f1 = int(action.frame_range[0]), int(action.frame_range[1])

UE = {"thigh": "thigh_{}", "calf": "calf_{}", "foot": "foot_{}", "ball": "ball_{}", "upper": "upperarm_{}", "lower": "lowerarm_{}", "hand": "hand_{}", "head": "head", "neck": "neck_01"}
MX = {"thigh": "mixamorig:{}UpLeg", "calf": "mixamorig:{}Leg", "foot": "mixamorig:{}Foot", "ball": "mixamorig:{}ToeBase", "upper": "mixamorig:{}Arm", "lower": "mixamorig:{}ForeArm", "hand": "mixamorig:{}Hand", "head": "mixamorig:Head", "neck": "mixamorig:Neck"}
names = {b.name for b in arm.pose.bones}
ue = "thigh_l" in names
N = UE if ue else MX
side = (lambda s: s) if ue else (lambda s: {"l": "Left", "r": "Right"}[s])
if not ue and "mixamorig:LeftUpLeg" not in names:  # Mixamo exports without the prefix
    N = {k: v.replace("mixamorig:", "") for k, v in MX.items()}


def bone(key, s=None):
    return arm.pose.bones[N[key].format(side(s)) if s else N[key]]


MW = arm.matrix_world


def head(pb):
    return MW @ pb.head


def tail(pb):
    return MW @ pb.tail


up = Vector((0, 0, 1))
# character frame from the rest skeleton: left = shoulder line, forward = left x up flipped to the toes' side
bpy.context.scene.frame_set(f0)
Lr = head(bone("upper", "l")) - head(bone("upper", "r"))
L = (Lr - up * Lr.dot(up)).normalized()
F = L.cross(up).normalized()
if F.dot(head(bone("ball", "l")) - head(bone("foot", "l"))) < 0:
    F = -F

# Winter: (mass fraction, COM fraction from proximal)
SEG = {"trunk": (0.497, 0.5), "headneck": (0.081, 0.5), "upper": (0.028, 0.436), "lower": (0.016, 0.430), "hand": (0.006, 0.506), "thigh": (0.100, 0.433), "calf": (0.0465, 0.433), "foot": (0.0145, 0.5)}


def com():
    parts = []
    hip = (head(bone("thigh", "l")) + head(bone("thigh", "r"))) / 2
    sho = (head(bone("upper", "l")) + head(bone("upper", "r"))) / 2
    parts.append((SEG["trunk"][0], hip.lerp(sho, SEG["trunk"][1])))
    hb = bone("head")
    parts.append((SEG["headneck"][0], head(hb).lerp(tail(hb), 0.5)))
    for s in ("l", "r"):
        for seg, a, b in (("upper", head(bone("upper", s)), head(bone("lower", s))), ("lower", head(bone("lower", s)), head(bone("hand", s))), ("hand", head(bone("hand", s)), tail(bone("hand", s))),
                          ("thigh", head(bone("thigh", s)), head(bone("calf", s))), ("calf", head(bone("calf", s)), head(bone("foot", s))), ("foot", head(bone("foot", s)), head(bone("ball", s)))):
            parts.append((SEG[seg][0], a.lerp(b, SEG[seg][1])))
    m = sum(w for w, _ in parts)
    return sum((p * w for w, p in parts), Vector()) / m


def foot_points(s):
    ankle, ball = head(bone("foot", s)), head(bone("ball", s))
    d = ball - ankle
    d.z = 0
    heel = ankle - d.normalized() * 0.06
    toe = tail(bone("ball", s))
    return [Vector((p.x, p.y, 0)) for p in (heel, ball, toe)], ball.z


def hull(pts):
    pts = sorted({(round(p.x, 5), round(p.y, 5)) for p in pts})
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def inside(poly, p):
    if len(poly) < 3:
        return False
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0:
            return False
    return True


floor = min(min(foot_points("l")[1], foot_points("r")[1]) for _ in [0])
keys = []
for f in range(f0, f1 + 1):
    bpy.context.scene.frame_set(f)
    c = com()
    pl, zl = foot_points(LEAD)
    pr, zr = foot_points(REAR)
    lead, rear = sum(pl, Vector()) / 3, sum(pr, Vector()) / 3
    axis = lead - rear
    c2 = Vector((c.x, c.y, 0))
    frac = (c2 - rear).dot(axis) / axis.length_squared
    perp = axis.normalized().cross(up)
    lat = (c2 - rear).dot(-perp)
    support = (pl if zl - floor < 0.03 else []) + (pr if zr - floor < 0.03 else [])
    hd = head(bone("head"))
    headFrac = (Vector((hd.x, hd.y, 0)) - rear).dot(axis) / axis.length_squared
    hip = (head(bone("thigh", "l")) + head(bone("thigh", "r"))) / 2
    sho = (head(bone("upper", "l")) + head(bone("upper", "r"))) / 2
    t = sho - hip
    import math as _m
    lean = _m.degrees(_m.atan2(t.dot(F), t.z))  # + = shoulders ahead of the hips (towards the opponent)
    hipFrac = (Vector((hip.x, hip.y, 0)) - rear).dot(axis) / axis.length_squared
    keys.append({"key": f, "leadFraction": round(frac, 3), "headFraction": round(headFrac, 3), "hipFraction": round(hipFrac, 3), "torsoLeanDeg": round(lean, 1), "lateralCm": round(lat * 100 * (1 if (-perp).dot(L) > 0 else -1), 1), "comHeight": round(c.z, 3), "comFwdCm": round((c2 - (lead + rear) / 2).dot(F) * 100, 1), "inSupport": inside(hull(support), (c.x, c.y)), "feetDown": [s for s, z in ((LEAD, zl), (REAR, zr)) if z - floor < 0.03]})
json.dump({"stance": "southpaw" if SOUTHPAW else "orthodox", "character": os.path.basename(CHAR), "animation": os.path.basename(ANIM or CHAR), "action": action.name, "rig": "ue" if ue else "mixamo", "keys": keys}, open(OUT, "w"), indent=1)
fr = [k["leadFraction"] for k in keys]
print("COM", os.path.basename(ANIM or CHAR), "leadFraction min/max", min(fr), max(fr), "outside support", sum(not k["inSupport"] for k in keys))
