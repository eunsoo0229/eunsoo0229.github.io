"""Renders an authored clip on the character as a webcam would film it (Phase 3 QA). Read only.

    blender -b --factory-startup -P scripts/motion3d/render_capture_frames.py -- <character.glb> <animation.glb> <out_dir> <view> [frames]

view: front | diagonal | side | back — the same angles as the measurement (front = the rig's forward, side = the
character's left, diagonal = 45° towards it). Perspective camera at chest height ~3.4 m away, 640x480, every key
from the action's range (or the given count). Writes <out_dir>/<view>-NNN.png. The QA feeds these frames to the
pose measurement as the camera (.devtools/qa-pose-capture-render.mjs).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
CHAR, ANIM, OUT, VIEW = argv[0], argv[1], argv[2], argv[3]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps, sc.render.fps_base = 30, 1.0
bpy.ops.import_scene.gltf(filepath=os.path.abspath(CHAR))
char_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(ANIM))
anim_objs = [o for o in bpy.data.objects if o not in before]
anim_arm = next(o for o in anim_objs if o.type == "ARMATURE")
action = anim_arm.animation_data.action
for o in anim_objs:
    bpy.data.objects.remove(o, do_unlink=True)
char_arm.animation_data_create()
char_arm.animation_data.action = action
f0, f1 = int(action.frame_range[0]), int(action.frame_range[1])

sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x, sc.render.resolution_y = 640, 480
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0.80, 0.80, 0.82)
camd = bpy.data.cameras.new("cam")
camd.lens = 28  # a typical webcam field of view (~65° horizontal)
cam = bpy.data.objects.new("cam", camd)
sc.collection.objects.link(cam)
sc.camera = cam
# glTF +Z (the rig's forward) is Blender -Y; the character's left is Blender +X
FWD, LEFT = Vector((0, -1, 0)), Vector((1, 0, 0))
ANGLE = {"front": 0, "diagonal": 45, "side": 90, "back": 180}[VIEW]
a = math.radians(ANGLE)
d = (FWD * math.cos(a) + LEFT * math.sin(a)).normalized()
cam.location = Vector((0, 0, 1.0)) + d * 3.4
cam.rotation_euler = (Vector((0, 0, 0.9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
for i, f in enumerate(range(f0, f1 + 1)):
    sc.frame_set(f)
    sc.render.filepath = os.path.join(OUT, f"{VIEW}-{i:03d}.png")
    bpy.ops.render.render(write_still=True)
print("rendered", VIEW, f1 - f0 + 1, "frames")
