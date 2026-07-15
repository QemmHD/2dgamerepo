"""Render the original House V2 prop sprites used by EMBERWAKE.

Run with Blender 5.1 (or newer):
  blender --background --python tools/blender/render_house_v2_props.py

The scene is deterministic, uses no external meshes or textures, and writes
transparent PNGs directly into src/assets/obstacles.  Geometry stays chunky so
the final 256 px renders sit beside the game's existing hi-bit world sprites.
"""

from __future__ import annotations

import math
import random
import shutil
import subprocess
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "assets" / "obstacles"
RAW = ROOT / "tools" / "blender" / "raw" / "house_v2"
PIXELIZER = ROOT / "tools" / "artshot" / "pixelate-sheet.mjs"


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
        modifier.segments = 1
    obj.data.materials.append(mat)
    return obj


def cylinder(name: str, location, radius, depth, mat, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("soft_edges", "BEVEL")
    bevel.width = 0.035
    bevel.segments = 1
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

    # Exact plan camera: props share the same top-down projection as the cabin
    # floor and shell. No 3/4 face can masquerade as a tiny building indoors.
    bpy.ops.object.camera_add(location=(0, 0, 10))
    camera = bpy.context.object
    camera.name = "house_prop_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.8
    camera.rotation_euler = (0, 0, 0)
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
    bronze = material("old_bronze", (0.62, 0.28, 0.055, 1), metallic=0.58, roughness=0.46)
    ember = material("ember_rune", (0.88, 0.16, 0.025, 1), roughness=0.34, emission=(1.0, 0.055, 0.008, 1))

    cube("broken_plinth", (0, 0, 0.18), (1.18, 0.86, 0.18), stone, 0.08)
    cube("upper_plinth", (0, 0, 0.43), (0.92, 0.68, 0.10), stone_lit, 0.06)
    for x in (-0.74, 0.74):
        post = cube("charred_post", (x, -0.58, 0.78), (0.14, 0.17, 0.58), oak, 0.05)
        post.rotation_euler[1] = math.radians(-5 if x < 0 else 5)
    cube("crossbeam", (0, -0.58, 0.98), (1.04, 0.18, 0.16), oak, 0.05)
    cylinder("iron_axle", (0, -0.18, 1.10), 0.12, 1.15, iron,
             vertices=12, rotation=(0, math.pi / 2, 0))

    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.61, radius2=0.31,
                                   depth=0.72, location=(0, 0.16, 1.40))
    bell = bpy.context.object
    bell.name = "ruin_bell"
    bell.data.materials.append(bronze)
    bevel = bell.modifiers.new("bell_rim", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 3
    cylinder("bell_neck", (0, 0.16, 1.82), 0.18, 0.28, bronze, vertices=12)
    cylinder("clapper_stem", (0, 0.16, 0.98), 0.055, 0.42, iron, vertices=10)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.16, location=(0, 0.16, 0.76))
    bpy.context.object.name = "clapper"
    bpy.context.object.data.materials.append(iron)

    # A broken ember seal lies flat on the altar. In plan view it frames the
    # bronze bell without introducing a front-facing sign or facade.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.50, minor_radius=0.055,
                                     major_segments=16, minor_segments=6,
                                     location=(0, 0.48, 0.58))
    bpy.context.object.name = "ember_seal"
    bpy.context.object.data.materials.append(ember)
    for angle in (-0.75, 0.2, 1.15):
        ray = cube("seal_ray", (math.cos(angle) * 0.46,
                                 0.48 + math.sin(angle) * 0.46, 0.60),
                   (0.055, 0.22, 0.018), ember, 0.015)
        ray.rotation_euler[2] = -angle


def build_hearth() -> None:
    """Low plan-view stone hearth for the north wall of the great room."""
    stone = material("hearth_stone", (0.19, 0.17, 0.17, 1), roughness=0.95)
    stone_lit = material("hearth_edge", (0.34, 0.29, 0.25, 1), roughness=0.88)
    iron = material("hearth_iron", (0.035, 0.032, 0.038, 1), metallic=0.76, roughness=0.42)
    ember = material("hearth_ember", (0.92, 0.11, 0.018, 1), roughness=0.42,
                     emission=(1.0, 0.045, 0.005, 1))
    flame = material("hearth_flame", (1.0, 0.46, 0.025, 1), roughness=0.3,
                     emission=(1.0, 0.15, 0.01, 1))

    cube("hearth_base", (0, 0, 0.12), (1.16, 0.72, 0.12), stone, 0.05)
    # A U-shaped stone curb leaves the firebox open toward the room (south).
    cube("hearth_back", (0, -0.53, 0.31), (1.02, 0.17, 0.19), stone_lit, 0.04)
    for x in (-0.88, 0.88):
        cube("hearth_side", (x, 0.02, 0.31), (0.16, 0.50, 0.19), stone_lit, 0.04)
    cube("firebox", (0, 0.02, 0.27), (0.64, 0.38, 0.13), iron, 0.03)
    for y, angle in ((-0.08, -0.34), (0.16, 0.38)):
        log = cylinder("ember", (0, y, 0.46), 0.09, 1.00, ember, vertices=10,
                       rotation=(0, math.pi / 2, 0))
        log.rotation_euler[2] = angle
    for x, y, radius in ((-0.25, -0.05, 0.17), (0.06, 0.12, 0.21), (0.31, -0.12, 0.14)):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius,
                                             location=(x, y, 0.64))
        bpy.context.object.name = "hearth_flame"
        bpy.context.object.data.materials.append(flame)


def build_table() -> None:
    """One readable dining/work table; deliberately not a room-sized decal."""
    oak = material("table_oak", (0.26, 0.095, 0.035, 1), roughness=0.86)
    oak_lit = material("table_edge", (0.48, 0.22, 0.07, 1), roughness=0.74)
    iron = material("table_iron", (0.055, 0.045, 0.05, 1), metallic=0.64, roughness=0.48)
    wax = material("candle_wax", (0.74, 0.54, 0.24, 1), roughness=0.86)
    ceramic = material("table_ceramic", (0.62, 0.52, 0.38, 1), roughness=0.92)
    parchment = material("table_parchment", (0.56, 0.34, 0.15, 1), roughness=0.95)
    ember = material("candle_ember", (1.0, 0.26, 0.025, 1), roughness=0.34,
                     emission=(1.0, 0.08, 0.005, 1))

    cube("table_top", (0, 0, 1.12), (1.34, 0.76, 0.13), oak, 0.08)
    for y in (-0.47, 0, 0.47):
        cube("table_plank", (0, y, 1.27), (1.26, 0.025, 0.018), oak_lit, 0.008)
    for x in (-1.02, 1.02):
        for y in (-0.48, 0.48):
            cube("table_leg", (x, y, 0.56), (0.12, 0.12, 0.56), oak, 0.04)
            cube("iron_foot", (x, y, 0.10), (0.15, 0.15, 0.05), iron, 0.03)
    for x, y in ((-0.62, -0.22), (0.64, 0.25)):
        cylinder("table_plate", (x, y, 1.39), 0.19, 0.045, ceramic, vertices=12)
    note = cube("table_note", (-0.12, 0.22, 1.39), (0.25, 0.18, 0.025), parchment, 0.01)
    note.rotation_euler[2] = -0.18
    cylinder("candle", (0.38, -0.12, 1.54), 0.09, 0.42, wax, vertices=12)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.10,
                                         location=(0.38, -0.12, 1.80))
    bpy.context.object.name = "candle_flame"
    bpy.context.object.scale.z = 1.7
    bpy.context.object.data.materials.append(ember)


def build_shelf() -> None:
    """Low wall-side pantry counter, readable from the exact plan camera."""
    oak = material("shelf_oak", (0.20, 0.07, 0.025, 1), roughness=0.88)
    oak_lit = material("shelf_edge", (0.42, 0.18, 0.055, 1), roughness=0.76)
    iron = material("shelf_iron", (0.05, 0.045, 0.055, 1), metallic=0.7, roughness=0.44)
    glass_a = material("jar_amber", (0.58, 0.25, 0.045, 1), metallic=0.04, roughness=0.44)
    glass_b = material("jar_green", (0.10, 0.44, 0.23, 1), metallic=0.03, roughness=0.46)

    # Long axis follows world Y so this narrow counter hugs the east wall.
    cube("shelf_base", (0, 0, 0.16), (0.48, 1.18, 0.16), oak, 0.05)
    cube("shelf_top", (0, 0, 0.38), (0.55, 1.24, 0.08), oak_lit, 0.04)
    for y in (-1.02, 1.02):
        cube("shelf_end", (0, y, 0.52), (0.58, 0.10, 0.17), oak_lit, 0.03)
    for row, y in enumerate((-0.78, -0.26, 0.26, 0.78)):
        for col, x in enumerate((-0.25, 0.25)):
            jar_mat = glass_a if (row + col) % 2 else glass_b
            cylinder("pantry_jar", (x, y, 0.61), 0.15, 0.28, jar_mat, vertices=10)
            cylinder("jar_lid", (x, y, 0.78), 0.17, 0.055, iron, vertices=10)


def build_crate() -> None:
    """Compact supply crate with a readable plan-view cross brace."""
    oak = material("crate_oak", (0.25, 0.085, 0.027, 1), roughness=0.90)
    oak_lit = material("crate_edge", (0.48, 0.20, 0.055, 1), roughness=0.78)
    iron = material("crate_iron", (0.045, 0.040, 0.050, 1), metallic=0.65, roughness=0.48)
    cube("crate_body", (0, 0, 0.34), (0.80, 0.70, 0.34), oak, 0.05)
    cube("crate_lid", (0, 0, 0.73), (0.86, 0.76, 0.07), oak_lit, 0.03)
    for angle in (-0.72, 0.72):
        brace = cube("crate_brace", (0, 0, 0.83), (0.08, 0.86, 0.035), oak_lit, 0.01)
        brace.rotation_euler[2] = angle
    for x in (-0.70, 0.70):
        for y in (-0.60, 0.60):
            cylinder("crate_nail", (x, y, 0.87), 0.055, 0.035, iron, vertices=8)


def build_barrel() -> None:
    """Upright oil cask whose rings and ember cap read from plan view."""
    oak = material("barrel_oak", (0.22, 0.070, 0.025, 1), roughness=0.88)
    oak_lit = material("barrel_lid", (0.39, 0.15, 0.045, 1), roughness=0.78)
    iron = material("barrel_iron", (0.045, 0.040, 0.050, 1), metallic=0.72, roughness=0.40)
    ember = material("barrel_ember", (0.92, 0.18, 0.025, 1), roughness=0.36,
                     emission=(1.0, 0.05, 0.005, 1))
    cylinder("barrel_body", (0, 0, 0.52), 0.72, 1.04, oak, vertices=12)
    cylinder("barrel_lid", (0, 0, 1.08), 0.66, 0.10, oak_lit, vertices=12)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.62, minor_radius=0.055,
                                     major_segments=12, minor_segments=6,
                                     location=(0, 0, 1.16))
    bpy.context.object.data.materials.append(iron)
    # Small wick mark makes the supply identity legible without text.
    cube("wick_mark", (0, 0.06, 1.24), (0.08, 0.34, 0.025), ember, 0.01)
    wick_cross = cube("wick_cross", (0, 0.06, 1.25), (0.23, 0.07, 0.025), ember, 0.01)
    wick_cross.rotation_euler[2] = 0.62


def setup_floor_scene() -> None:
    """Top-down orthographic setup for a clean, contiguous cabin floor."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 410
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 85
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.025, 0.018, 0.021, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.28

    bpy.ops.object.light_add(type="AREA", location=(-3.8, -4.5, 8.0))
    key = bpy.context.object
    key.data.energy = 1050
    key.data.size = 7.0
    key.data.color = (1.0, 0.57, 0.30)
    aim_at(key, (0, 0, 0))
    bpy.ops.object.light_add(type="AREA", location=(4.4, 3.0, 6.0))
    fill = bpy.context.object
    fill.data.energy = 560
    fill.data.size = 5.0
    fill.data.color = (0.35, 0.48, 0.72)
    aim_at(fill, (0, 0, 0))

    bpy.ops.object.camera_add(location=(0, 0, 10))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.32
    aim_at(camera, (0, 0, 0))
    scene.camera = camera


def build_clean_floor() -> None:
    """Original oak board floor without baked rooms, furniture, or walls."""
    rng = random.Random(0x1A57C0DE)
    tones = [
        material("floor_oak_dark", (0.115, 0.043, 0.019, 1), roughness=0.94),
        material("floor_oak_mid", (0.17, 0.064, 0.025, 1), roughness=0.92),
        material("floor_oak_warm", (0.23, 0.086, 0.030, 1), roughness=0.90),
        material("floor_oak_lit", (0.29, 0.12, 0.043, 1), roughness=0.88),
    ]
    seam = material("floor_seam", (0.018, 0.012, 0.014, 1), roughness=1.0)
    nail = material("floor_nail", (0.035, 0.032, 0.040, 1), metallic=0.7, roughness=0.5)

    # Horizontal staggered boards echo the broad, readable floor courses used
    # by the rest of the top-down world rather than forming vertical prison bars.
    board_h = 0.36
    rows = 12
    for row in range(rows):
        y = (row - (rows - 1) / 2) * board_h
        split = -0.92 + (row % 4) * 0.58
        spans = [(-2.70, split - 0.025), (split + 0.025, 2.70)]
        for col, (x0, x1) in enumerate(spans):
            tone = tones[(row * 3 + col + int(rng.random() * 4)) % len(tones)]
            cube("floor_board", ((x0 + x1) / 2, y, 0),
                 ((x1 - x0) / 2 - 0.012, board_h / 2 - 0.014, 0.045), tone, 0.018)
            for x in (x0 + 0.16, x1 - 0.16):
                cylinder("floor_nail", (x, y - board_h * 0.30, 0.064), 0.018, 0.025,
                         nail, vertices=8)
                cylinder("floor_nail", (x, y + board_h * 0.30, 0.064), 0.018, 0.025,
                         nail, vertices=8)
        cube("floor_seam", (0, y + board_h / 2 - 0.006, 0.052),
             (2.70, 0.012, 0.012), seam, 0)


def pixelize(raw_path: Path, output_path: Path, logical: int, colors: int, outline: bool) -> None:
    """Apply the repository's deterministic high-bit pixel-art install pass."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is required for tools/artshot/pixelate-sheet.mjs")
    subprocess.run([
        node, str(PIXELIZER), str(raw_path), str(output_path),
        "--cell=256", f"--logical={logical}", f"--colors={colors}",
        "--alpha=72", f"--outline={1 if outline else 0}",
    ], check=True)


def render_floor() -> None:
    clear_scene()
    setup_floor_scene()
    build_clean_floor()
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    raw_path = RAW / "floor_cabin_clean.png"
    bpy.context.scene.render.filepath = str(raw_path)
    bpy.ops.render.render(write_still=True)
    pixelize(raw_path, OUT / "floor_cabin_clean.png", logical=128, colors=32, outline=False)
    print("Rendered floor_cabin_clean.png")


def render(name: str, builder, ortho_scale: float) -> None:
    clear_scene()
    setup_scene()
    bpy.context.scene.camera.data.ortho_scale = ortho_scale
    builder()
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    raw_path = RAW / f"{name}.png"
    bpy.context.scene.render.filepath = str(raw_path)
    bpy.ops.render.render(write_still=True)
    pixelize(raw_path, OUT / f"{name}.png", logical=64, colors=24, outline=True)
    print(f"Rendered {name}.png")


if __name__ == "__main__":
    render("cabin_bed", build_bed, 4.0)
    render("ruin_bell", build_ruin_bell, 3.7)
    render("cabin_hearth", build_hearth, 3.4)
    render("cabin_table", build_table, 3.7)
    render("cabin_shelf", build_shelf, 3.2)
    render("cabin_crate", build_crate, 2.6)
    render("cabin_barrel", build_barrel, 2.5)
    render_floor()
