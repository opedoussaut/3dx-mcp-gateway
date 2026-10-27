"""Import an OpenUSD file into Blender headless and render a preview image.

    blender -b --factory-startup --python scripts/twin/render_blender.py -- in.usda out.png

The import itself is the validity check: Blender's USD importer must read every prim. The script
prints how many objects were imported and fails if none were.
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=src)
objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print(f"imported {len(objects)} mesh objects from {src}")
if not objects:
    sys.exit(1)

# Frame the bounding box of everything except the floor.
points = [o.matrix_world @ Vector(c) for o in objects if "Floor" not in o.name for c in o.bound_box]
lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
centre = (lo + hi) / 2
size = (hi - lo).length

scene = bpy.context.scene
target = bpy.data.objects.new("Target", None)
target.location = centre
scene.collection.objects.link(target)

cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
cam.data.lens = 40
direction = Vector((1.0, -1.15, 0.85)).normalized()
cam.location = centre + direction * size * 1.4
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
scene.collection.objects.link(cam)
scene.camera = cam

sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 2.2
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
scene.collection.objects.link(sun)

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.94, 0.96, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
scene.world = world

engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE_NEXT"
scene.render.engine = engine
scene.render.resolution_x = 1800
scene.render.resolution_y = 1100
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.render.filepath = out
try:
    bpy.ops.render.render(write_still=True)
except RuntimeError as e:
    print(f"{engine} failed ({e}); falling back to Workbench")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "MATERIAL"
    bpy.ops.render.render(write_still=True)
print(f"rendered {out} with {scene.render.engine}")
