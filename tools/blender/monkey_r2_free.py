#!/usr/bin/env python3
"""EMBERWAKE hero bake-off ROUND 2 — seat "free" (CUTE HYBRID, wildcard).

Merges round-1 variant B (rounded)'s plush smooth-sphere volumes + solved
parametric ortho camera with variant A (chunky)'s crisp big glinting eyes and
palette discipline, pushing cuteness hard:
  * head ~48%% of character height, tiny pear body
  * cream FACE MASK around the eyes (matches the 2D sprite) so the big dark
    eyes + large white glints stay readable after pixelation at 182px
  * NO furDark brow strip and no bevel plateau — kills the "helmet band"
  * smooth NURBS tail CURL beside the body (+x) with a furLight tuft —
    the 2D identity mark
  * faceDark cheek-blush warmth; ember brow spark kept (Pyra identity)

Contract: 256x256 RGBA transparent, ortho ~12deg pitch, body centred x=24/48,
head centre 16/48 (33%% down), feet 45/48 (~94%%), hands EMPTY, no cosmetics.
Palette locked to src/content/characters.js: fur #8b5a2b furDark #5a3818
furLight #b07a44 face #f0d2a5.

World space is authored ON the 48 grid: 1 unit = 1 grid px, x centred on 0,
z up with FEET AT z=0. The camera solver (from variant B, verified) places
z=0 at FEET_FRAC and returns the head-centre z for HEAD_FRAC.

Run:  python3 monkey_r2_free.py [outdir]
Writes render_raw.png (front) and render_side_raw.png (yaw 90deg from +x).
"""
import math
import os
import sys

import bpy

# ── canonical anchors (PixelArt.js 48-grid) ─────────────────────────────
GRID = 48.0
HEAD_FRAC = 16.0 / 48.0     # head centre 33% down the cell
FEET_FRAC = 45.0 / 48.0     # feet ~94% down the cell
PITCH_DEG = 12.0            # ortho top-down pitch

DEFAULT_PARAMS = {
    # palette (characters.js monkey/Pyra — canonical, do not drift)
    'fur':       '#8b5a2b',
    'fur_dark':  '#5a3818',
    'fur_light': '#b07a44',
    'face':      '#f0d2a5',
    'face_dark': '#c9a97e',
    'eye':       '#0a0a0a',
    'accent':    '#ffb24a',
    # shading: fraction of base colour emitted flat (anchors palette tones);
    # face/cream gets a higher anchor so it quantizes to #f0d2a5, not yellow
    'emit': 0.5, 'emit_face': 0.72,

    # HEAD — pushed to ~48% of character height ('head_z' filled by solver)
    'head_r': 10.8, 'head_squash': 0.93, 'head_wide': 1.05,
    # ears — sideways, kept BELOW the crown so nothing reads as headgear
    'ear_r': 5.2, 'ear_x': 11.6, 'ear_dz': 1.6, 'ear_y': 1.2,
    'ear_flat': 0.60, 'ear_inner_r': 3.1,
    # cream face mask (2D identity: eyes live on cream, not on fur)
    'mask_rx': 8.5, 'mask_ry': 5.4, 'mask_rz': 7.7,
    'mask_y': -5.6, 'mask_dz': -0.6,
    # eyes — BIG, chunky-style large glints that survive 96px + 182px
    'eye_r': 3.35, 'eye_dx': 4.55, 'eye_dz': 1.4, 'eye_y': -10.3,
    'glint_r': 1.45, 'glint2_r': 0.66,
    # muzzle — small low bump on the mask (kept HIGH so mouth doesn't sag)
    'muzzle_rx': 4.6, 'muzzle_ry': 2.0, 'muzzle_rz': 3.2,
    'muzzle_y': -9.9, 'muzzle_dz': -4.4,
    # cheek blush (faceDark warmth)
    'blush_x': 6.9, 'blush_y': -8.9, 'blush_dz': -2.5,
    # ember brow spark (Pyra identity, small — NOT a band)
    'ember_r': 1.25, 'ember_y': -8.4, 'ember_dz': 6.6,

    # BODY — tiny plush pear tucked under the giant head
    'body_rx': 7.4, 'body_ry': 6.4, 'body_rz': 8.0, 'body_z': 11.5,
    'belly_rx': 4.6, 'belly_rz': 5.0,
    # limbs — stubby; feet UNDER the body (no forward push -> no lean)
    'arm_r': 2.1, 'arm_x': 7.6, 'arm_top_z': 14.5, 'arm_bot_z': 8.6,
    'leg_r': 2.2, 'leg_x': 4.6, 'leg_top_z': 6.0,
    'foot_r': 2.8, 'foot_y': -1.8,
    # TAIL — smooth curl beside the body (+x), furLight tuft at the tip
    'tail_r': 1.7, 'tail_tuft_r': 2.7,
    'tail_pts': [(1.5, 4.8, 6.6), (8.5, 7.5, 4.6), (13.8, 8.5, 8.0),
                 (15.0, 7.5, 12.8), (12.8, 6.4, 16.2), (11.0, 6.0, 16.6)],

    # render
    'samples': 32,
    'key_energy': 3.2, 'fill_energy': 0.9, 'world_amb': 0.4,
}


# ── helpers ──────────────────────────────────────────────────────────────
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


_mats = {}


def mat(name, hex_col, emit=0.5, rough=0.95):
    """Diffuse + partial flat emission: keeps shape shading but anchors the
    average tone near the palette value so quantization lands on-model."""
    key = (name, hex_col, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    col = hex_rgba(hex_col)
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Specular IOR Level'].default_value = 0.05
    bsdf.inputs['Emission Color'].default_value = col
    bsdf.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


def sphere(name, loc, r, material, scale=(1, 1, 1), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2,
                                         radius=r, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    return ob


def capsule(name, p0, p1, r, material):
    """Rounded limb: cylinder between p0..p1 plus sphere caps."""
    from mathutils import Vector
    mx = tuple((a + b) / 2 for a, b in zip(p0, p1))
    d = tuple(b - a for a, b in zip(p0, p1))
    length = math.sqrt(sum(c * c for c in d))
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=r, depth=length,
                                        location=mx)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector(d).to_track_quat('Z', 'Y')
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    for i, p in enumerate((p0, p1)):
        sphere(f'{name}_cap{i}', p, r, material)
    return ob


def tail_curve(name, pts, r, material):
    """Smooth NURBS tube — the proper tail CURL the 2D sprite demands."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 8
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1.0)
    sp.use_endpoint_u = True
    sp.order_u = 3
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()
    return ob


# ── build ────────────────────────────────────────────────────────────────
def build_monkey(P):
    e = P['emit']
    fur = mat('fur', P['fur'], e)
    furD = mat('furD', P['fur_dark'], e)
    furL = mat('furL', P['fur_light'], e)
    face = mat('face', P['face'], P['emit_face'])
    faceD = mat('faceD', P['face_dark'], P['emit_face'] * 0.8)
    eyeM = mat('eye', P['eye'], 0.15, rough=0.5)
    white = mat('white', '#ffffff', 2.6, rough=0.4)
    accent = mat('accent', P['accent'], 1.0)

    hz, hr = P['head_z'], P['head_r']

    # BODY — tiny plush pear (top tucks under the head, no neck gap)
    sphere('body', (0, 0, P['body_z']), 1.0, fur,
           scale=(P['body_rx'], P['body_ry'], P['body_rz']))
    sphere('belly', (0, -P['body_ry'] * 0.76, P['body_z'] - 0.4), 1.0, face,
           scale=(P['belly_rx'], 2.0, P['belly_rz']))

    # HEAD — giant soft sphere (~48% of height). No brow band, no crown
    # plateau: the fur dome stays clean so nothing reads as a helmet/cap.
    sphere('head', (0, 0, hz), hr, fur,
           scale=(P['head_wide'], 0.98, P['head_squash']))

    # EARS — round, sideways, below the crown; cream inner disc
    for sx in (-1, 1):
        ex = sx * P['ear_x']
        ez = hz + P['ear_dz']
        sphere(f'ear{sx}', (ex, P['ear_y'], ez), P['ear_r'], fur,
               scale=(1.0, P['ear_flat'], 1.0))
        sphere(f'earIn{sx}',
               (ex * 1.02, P['ear_y'] - P['ear_r'] * P['ear_flat'] * 0.75, ez),
               P['ear_inner_r'], face, scale=(0.9, 0.45, 0.9))

    # FACE MASK — cream panel around the eye region (the 2D sprite's cream
    # face). Dark eyes + white glints on cream stay readable at 182px.
    sphere('mask', (0, P['mask_y'], hz + P['mask_dz']), 1.0, face,
           scale=(P['mask_rx'], P['mask_ry'], P['mask_rz']))

    # EYES — BIG dark ovals with LARGE upper-left glints (chunky's treatment,
    # sized so the glint survives 96px quantize AND the 182px in-game scale)
    eyz = hz + P['eye_dz']
    for sx in (-1, 1):
        exx = sx * P['eye_dx']
        sphere(f'eye{sx}', (exx, P['eye_y'], eyz), P['eye_r'], eyeM,
               scale=(1.0, 0.62, 1.18))
        sphere(f'glint{sx}',
               (exx - P['eye_r'] * 0.38, P['eye_y'] - 1.7,
                eyz + P['eye_r'] * 0.52),
               P['glint_r'], white)
        sphere(f'glint2_{sx}',
               (exx + P['eye_r'] * 0.42, P['eye_y'] - 1.5,
                eyz - P['eye_r'] * 0.42),
               P['glint2_r'], white)

    # MUZZLE — small cream bump kept HIGH on the mask; tiny nose + mouth
    mz = hz + P['muzzle_dz']
    sphere('muzzle', (0, P['muzzle_y'], mz), 1.0, face,
           scale=(P['muzzle_rx'], P['muzzle_ry'], P['muzzle_rz']))
    for sx in (-1, 1):
        sphere(f'nose{sx}', (sx * 1.0, P['muzzle_y'] - P['muzzle_ry'] * 0.95,
                             mz + 0.9), 0.5, faceD)
    sphere('mouth', (0, P['muzzle_y'] - P['muzzle_ry'] * 0.95, mz - 1.2),
           1.0, faceD, scale=(1.6, 0.38, 0.5))

    # CHEEK BLUSH — faceDark warmth just outside/below the eyes
    for sx in (-1, 1):
        sphere(f'blush{sx}', (sx * P['blush_x'], P['blush_y'],
                              hz + P['blush_dz']),
               1.0, faceD, scale=(1.5, 0.6, 1.05))

    # EMBER BROW SPARK — Pyra identity; a small lozenge, NOT a band
    sphere('ember', (0, P['ember_y'], hz + P['ember_dz']), P['ember_r'],
           accent, scale=(1.0, 0.5, 1.35))

    # ARMS — stubby capsules hugging the body (hands EMPTY)
    for sx in (-1, 1):
        capsule(f'arm{sx}',
                (sx * P['arm_x'], -1.4, P['arm_top_z']),
                (sx * (P['arm_x'] + 0.7), -2.4, P['arm_bot_z']),
                P['arm_r'], fur)

    # LEGS + FEET — short stubs directly UNDER the body; soles at z=0
    for sx in (-1, 1):
        capsule(f'leg{sx}',
                (sx * P['leg_x'], -0.8, P['leg_top_z']),
                (sx * P['leg_x'], -1.4, P['foot_r'] + 0.5),
                P['leg_r'], furD)
        sphere(f'foot{sx}', (sx * P['leg_x'], P['foot_y'], P['foot_r']),
               P['foot_r'], furD, scale=(1.1, 1.25, 1.0))

    # TAIL — one smooth curl beside the body (+x) ending in a furLight tuft
    pts = P['tail_pts']
    tail_curve('tail', pts, P['tail_r'], furD)
    sphere('tuft', pts[-1], P['tail_tuft_r'], furL)


# ── camera / lights / render (solver verified in round 1) ────────────────
def solve_camera():
    """Ortho cam pitched PITCH_DEG top-down; solved so z=0 (feet) projects to
    FEET_FRAC down the square cell."""
    th = math.radians(PITCH_DEG)
    S = GRID
    dist = 80.0
    v_cam = S * (FEET_FRAC - 0.5)
    cam_y = -dist
    cam_z = (v_cam - cam_y * math.sin(th)) / math.cos(th)
    return cam_y, cam_z, S, th


def head_z_for_anchor():
    """Head-centre z (at y=0) that projects to HEAD_FRAC down the cell."""
    th = math.radians(PITCH_DEG)
    S = GRID
    v_cam = S * (FEET_FRAC - 0.5)
    v_head = v_cam + S * (0.5 - HEAD_FRAC)
    return v_head / math.cos(th)


def setup_scene(P, view='front'):
    cam_y, cam_z, S, th = solve_camera()
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = S
    cam.clip_end = 500
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.collection.objects.link(ob)
    pitch = math.radians(90.0 - PITCH_DEG)
    if view == 'front':
        ob.location = (0, cam_y, cam_z)
        ob.rotation_euler = (pitch, 0, 0)
    else:  # side: camera on +x looking -x (yaw 90 toward +x)
        ob.location = (-cam_y, 0, cam_z)
        ob.rotation_euler = (pitch, 0, math.radians(90))
    bpy.context.scene.camera = ob

    key = bpy.data.lights.new('key', 'SUN')
    key.energy = P['key_energy']
    key.color = (1.0, 0.91, 0.8)
    key.angle = 0.4
    ko = bpy.data.objects.new('key', key)
    bpy.context.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(55), math.radians(-18), math.radians(-25))

    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = P['fill_energy']
    fill.color = (0.72, 0.80, 1.0)
    fill.angle = 0.6
    fo = bpy.data.objects.new('fill', fill)
    bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(70), math.radians(20), math.radians(150))

    w = bpy.context.scene.world or bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.9, 0.78, 0.65, 1.0)
    bg.inputs['Strength'].default_value = P['world_amb']


def setup_render(P, outpath):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = P['samples']
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 256
    sc.render.resolution_y = 256
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'   # palette-true
    sc.render.filepath = outpath


def render_view(view, outpath, params):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    build_monkey(params)
    setup_scene(params, view)
    setup_render(params, outpath)
    bpy.ops.render.render(write_still=True)
    print(f'wrote {outpath}')


if __name__ == '__main__':
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    params = dict(DEFAULT_PARAMS)
    params['head_z'] = head_z_for_anchor()
    render_view('front', os.path.join(outdir, 'render_raw.png'), params)
    render_view('side', os.path.join(outdir, 'render_side_raw.png'), params)
