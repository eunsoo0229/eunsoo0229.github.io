"""Author a two-person MARTIALDEX demo on the Mesh2Motion human rig (Phase 5) — keyframes, no capture.

    blender -b --factory-startup -P scripts/motion3d/author_duo.py -- <technique module> <character.glb> <out_dir> [southpaw]

The technique module (scripts/motion3d/techniques/<name>.py) gives META (with "placement": {"A": (dx, dy, yaw),
"B": (...)}) and states(key) -> {"A": state, "B": state} (grapple_kit states). The character is imported twice;
each copy is posed in its own frame every key (B's body first, then A's, then A's arms, then B's arms, so hands
can reach the partner's bones), rotations + pelvis location + the root placement are recorded, the bones are
renamed with the actor prefixes ("A_", "B_") and both actions are exported in ONE glTF animation (one timeline).
Outputs:
  <id>.glb    animation only (two armatures, prefixed bones, one animation named <id>, no mesh)
  <id>.blend  Blender 3.4 source with both character meshes (white / red materials), for editing and review
  <id>.json   per-key log: phases and the contact clearances the module asks for
"""
import importlib
import json
import os
import struct
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "techniques"))
from grapple_kit import mirror, pose_arms, pose_body, pose_head, pose_legs  # noqa: E402
from rig_kit import Rig  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
TECH, CHAR, OUT = argv[0], argv[1], argv[2]
SOUTHPAW = len(argv) > 3 and argv[3] == "southpaw"
os.makedirs(OUT, exist_ok=True)
mod = importlib.import_module(TECH)
META = dict(mod.META)
states_of = mod.states
if SOUTHPAW:
    # both actors' states reflected in their own frames (grapple_kit.mirror), solved again on the real skeletons
    META.update({"id": META["id"] + "-southpaw", "stance": "southpaw", "title": META["title"].replace("(", "(사우스포 · ", 1)})
    states_of = lambda key: {w: mirror(s) for w, s in mod.states(key).items()}  # noqa: E731
else:
    META.setdefault("stance", "orthodox")
ACTORS = ("A", "B")
TINT = {"A": (0.86, 0.85, 0.82, 1.0), "B": (0.62, 0.13, 0.12, 1.0)}  # white-ish / red-ish (viewer tints match)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps, sc.render.fps_base = META["fps"], 1.0
arms = {}
meshes = {}
for who in ACTORS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(CHAR))
    new = [o for o in bpy.data.objects if o not in before]
    arms[who] = next(o for o in new if o.type == "ARMATURE")
    arms[who].animation_data_clear()
    arms[who].name = f"{who}_Armature"
    meshes[who] = [o for o in new if o.type == "MESH"]
    mat = bpy.data.materials.new(f"{who}_tint")
    mat.diffuse_color = TINT[who]
    for m in meshes[who]:
        m.data = m.data.copy()
        m.data.materials.clear()
        m.data.materials.append(mat)
rigs = {who: Rig(arms[who], META["placement"][who]) for who in ACTORS}

frames = list(range(0, META["lastKey"] + 1))
rec = {who: [] for who in ACTORS}
log = []
for key in frames:
    st = states_of(key)
    for who in ("B", "A"):
        pose_body(rigs[who], st[who])
        pose_legs(rigs[who], st[who], rigs, who)
        pose_head(rigs[who], st[who], rigs, who)
    for who in ("A", "B"):
        pose_arms(rigs[who], st[who], rigs, who)
    entry = {"key": key}
    if hasattr(mod, "measure"):
        entry.update(mod.measure(rigs))
    log.append(entry)
    for who in ACTORS:
        rec[who].append({b.name: (tuple(b.rotation_quaternion), tuple(b.location)) for b in arms[who].pose.bones})

# hemisphere continuity per bone
for who in ACTORS:
    prev = {}
    for r in rec[who]:
        for n, (q, loc) in list(r.items()):
            if n in prev and sum(a * b for a, b in zip(prev[n], q)) < 0:
                q = tuple(-x for x in q)
                r[n] = (q, loc)
            prev[n] = q

# prefix the bone names (the app loads the character twice and renames its copies the same way)
names = {}
for who in ACTORS:
    arm = arms[who]
    for b in arm.pose.bones:
        b.rotation_quaternion = (1, 0, 0, 0)
        b.location = (0, 0, 0)
    names[who] = {}
    for bone in list(arm.data.bones):
        old = bone.name
        bone.name = f"{who}_{old}"
        names[who][old] = bone.name
    for m in meshes[who]:
        for vg in m.vertex_groups:
            if vg.name in names[who]:
                vg.name = names[who][vg.name]


def put(act, path, idx, values, group):
    fc = act.fcurves.new(path, index=idx, action_group=group)
    fc.keyframe_points.add(len(values))
    co = []
    for f, v in zip(frames, values):
        co += [f, v]
    fc.keyframe_points.foreach_set("co", co)
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"
    fc.update()


for who in ACTORS:
    act = bpy.data.actions.new(f"{META['id']}__{who}")
    arms[who].animation_data_create()
    arms[who].animation_data.action = act
    for old, new in names[who].items():
        for i in range(4):
            put(act, f'pose.bones["{new}"].rotation_quaternion', i, [r[old][0][i] for r in rec[who]], new)
    for bone in ("pelvis", "root"):
        for i in range(3):
            put(act, f'pose.bones["{names[who][bone]}"].location', i, [r[bone][1][i] for r in rec[who]], names[who][bone])

sc.frame_start, sc.frame_end = frames[0], frames[-1]
base = os.path.join(OUT, META["id"])
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(base + ".blend"), copy=True)

for o in bpy.data.objects:
    o.select_set(o.type == "ARMATURE")
bpy.context.view_layer.objects.active = arms["A"]
bpy.ops.export_scene.gltf(filepath=os.path.abspath(base + ".glb"), export_format="GLB", use_selection=True, export_animations=True, export_frame_range=True, export_force_sampling=False, export_skins=True, export_yup=True)


# one timeline: merge every exported animation into a single one named META["id"]
def merge_animations(path, name):
    with open(path, "rb") as f:
        data = f.read()
    jl = struct.unpack_from("<I", data, 12)[0]
    j = json.loads(data[20:20 + jl])
    rest = data[20 + jl:]
    anims = j.get("animations", [])
    merged = {"name": name, "channels": [], "samplers": []}
    for a in anims:
        off = len(merged["samplers"])
        merged["samplers"] += a["samplers"]
        for c in a["channels"]:
            merged["channels"].append({**c, "sampler": c["sampler"] + off})
    j["animations"] = [merged]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I4s", len(js), b"JSON") + js + rest
    with open(path, "wb") as f:
        f.write(out)
    return len(anims), len(merged["channels"])


n_anims, n_channels = merge_animations(os.path.abspath(base + ".glb"), META["id"])
json.dump({"meta": META, "mergedAnimations": n_anims, "channels": n_channels, "keys": log}, open(base + ".json", "w"), indent=1)
print("AUTHORED", base + ".glb", "animations merged", n_anims, "channels", n_channels)
