"""Render the original House V2 prop sprites used by EMBERWAKE.

Run with Blender 5.1 (or newer):
  blender --background --python tools/blender/render_house_v2_props.py

The scene is deterministic, uses no external meshes or textures, and writes
transparent PNGs directly into src/assets/obstacles.  Geometry stays chunky so
the final 256 px renders sit beside the game's existing hi-bit world sprites.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "assets" / "obstacles"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def material(name: str, color: tuple[float, float, float, float], metallic=0.0, roughness=0.72, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 2.4
    return mat


def cube(name: str, location, scale, mat, bevel=0.06):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("soft_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    obj.data.materials.append(mat)
    return obj


def cylinder(name: str, location, radius, depth, mat, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("soft_edges", "BEVEL")
    bevel.width = 0.035
    bevel.segments = 2
    return obj


def aim_at(obj, target=(0.0, 0.0, 0.65)) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 85
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.028, 0.045, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.42

    bpy.ops.object.light_add(type="AREA", location=(-4.2, -4.8, 8.2))
    key = bpy.context.object
    key.name = "warm_key"
    key.data.energy = 720
    key.data.shape = "DISK"
    key.data.size = 5.0
    key.data.color = (1.0, 0.63, 0.34)
    aim_at(key)

    bpy.ops.object.light_add(type="AREA", location=(4.2, 1.5, 6.0))
    fill = bpy.context.object
    fill.name = "cool_fill"
    fill.data.energy = 430
    fill.data.size = 4.0
    fill.data.color = (0.38, 0.58, 0.84)
    aim_at(fill)

    bpy.ops.object.camera_add(location=(5.6, -7.4, 8.4))
    camera = bpy.context.object
    camera.name = "house_prop_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.8
    aim_at(camera, (0, 0, 0.55))
    scene.camera = camera


def build_bed() -> None:
    wood = material("ember_oak", (0.20, 0.075, 0.028, 1), roughness=0.84)
    edge = material("iron_edge", (0.055, 0.048, 0.06, 1), metallic=0.72, roughness=0.42)
    linen = material("warm_linen", (0.63, 0.49, 0.31, 1), roughness=0.94)
    blanket = material("ember_blanket", (0.38, 0.045, 0.055, 1), roughness=0.9)
    stitch = material("gold_stitch", (0.76, 0.39, 0.09, 1), metallic=0.15, roughness=0.58)

    cube("bed_frame", (0, 0, 0.26), (0.94, 1.45, 0.15), wood, 0.08)
    cube("mattress", (0, 0.06, 0.52), (0.82, 1.31, 0.18), linen, 0.11)
    cube("blanket", (0, 0.42, 0.73), (0.84, 0.72, 0.055), blanket, 0.07)
    cube("pillow", (0, -1.00, 0.75), (0.58, 0.28, 0.10), linen, 0.14)
    cube("headboard", (0, -1.41, 0.93), (1.02, 0.10, 0.78), wood, 0.06)
    for x in (-0.91, 0.91):
        cube("post", (x, -1.43, 1.02), (0.11, 0.11, 0.92), edge, 0.04)
        cylinder("post_cap", (x, -1.43, 1.98), 0.16, 0.18, stitch, vertices=10)
    for x in (-0.58, 0, 0.58):
        cube("blanket_band", (x, 0.43, 0.80), (0.035, 0.69, 0.016), stitch, 0.01)


def build_ruin_bell() -> None:
    stone = material("charred_stone", (0.10, 0.095, 0.12, 1), roughness=0.9)
    stone_lit = material("rune_stone", (0.20, 0.16, 0.16, 1), roughness=0.76)
    oak = material("bell_oak", (0.19, 0.065, 0.025, 1), roughness=0.87)
    iron = material("bell_iron", (0.045, 0.04, 0.05, 1), metallic=0.78, roughness=0.36)
    bronze = material("old_bronze", (0.39, 0.17, 0.045, 1), metallic=0.72, roughness=0.38)
    ember = material("ember_rune", (0.88, 0.16, 0.025, 1), roughness=0.34, emission=(1.0, 0.055, 0.008, 1))

    cube("broken_plinth", (0, 0, 0.18), (1.18, 0.86, 0.18), stone, 0.08)
    cube("upper_plinth", (0, 0, 0.43), (0.92, 0.68, 0.10), stone_lit, 0.06)
    for x in (-0.74, 0.74):
        post = cube("charred_post", (x, 0, 1.48), (0.14, 0.17, 1.05), oak, 0.05)
        post.rotation_euler[1] = math.radians(-5 if x < 0 else 5)
    cube("crossbeam", (0, 0, 2.37), (1.04, 0.18, 0.16), oak, 0.05)
    cylinder("iron_axle", (0, 0, 2.12), 0.12, 1.15, iron, vertices=12, rotation=(0, math.pi / 2, 0))

    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.61, radius2=0.31, depth=0.72, location=(0, 0, 1.67))
    bell = bpy.context.object
    bell.name = "ruin_bell"
    bell.data.materials.append(bronze)
    bevel = bell.modifiers.new("bell_rim", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 3
    cylinder("bell_neck", (0, 0, 2.05), 0.18, 0.28, bronze, vertices=12)
    cylinder("clapper_stem", (0, 0, 1.25), 0.055, 0.42, iron, vertices=10)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.16, location=(0, 0, 1.01))
    bpy.context.object.name = "clapper"
    bpy.context.object.data.materials.append(iron)

    # A broken ember seal in front of the plinth supplies the encounter's
    # readable focal color without baking a floor shadow into the sprite.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.50, minor_radius=0.055, major_segments=16, minor_segments=6, location=(0, -0.72, 0.55), rotation=(math.pi / 2, 0, 0))
    bpy.context.object.name = "ember_seal"
    bpy.context.object.data.materials.append(ember)
    for angle in (-0.75, 0.2, 1.15):
        cube("seal_ray", (math.cos(angle) * 0.46, -0.79, 0.55 + math.sin(angle) * 0.46), (0.055, 0.035, 0.22), ember, 0.015).rotation_euler[1] = -angle


def render(name: str, builder, ortho_scale: float) -> None:
    clear_scene()
    setup_scene()
    bpy.context.scene.camera.data.ortho_scale = ortho_scale
    builder()
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {name}.png")


if __name__ == "__main__":
    render("cabin_bed", build_bed, 4.7)
    render("ruin_bell", build_ruin_bell, 4.4)
