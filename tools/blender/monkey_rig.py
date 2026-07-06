#!/usr/bin/env python3
"""EMBERWAKE hero pipeline PR1 — rigged, animated parametric monkey.

Graduates the round-2 "free hybrid" monkey (scratchpad/blender/r2_free/
monkey_r2_free.py) into a rigged asset:

  * build_monkey(params)      — same geometry/materials/defaults as the winner,
                                with the TAIL FIX: the curl now sweeps
                                diagonally back-right (+x,+y) so it reads from
                                front, side AND back views (it was authored in
                                the camera-facing x-z plane before, so it
                                collapsed edge-on in profile).
  * build_armature(...)       — root/spine/head/eyes/arms/hand.R/legs/tail
                                bones, RIGID per-part bone parenting (this is a
                                segmented plush model — no automatic weights,
                                so poses can never candy-wrap), plus a GRIP
                                empty bone-parented at the right paw.
  * author_poses(...)         — ONE armature action keyed at scene frames 1..7
                                in POSE_COLS order [idle0, idle1(blink), walk0,
                                walk1(+2px bob), walk2, cast, hurt].
  * set_pose(pose, i)         — jump the scene to that pose frame.
  * get_grip_world()          — depsgraph-evaluated GRIP world location.
  * grip_cell_offset()        — project GRIP through the active camera to
                                (x, y) px offsets from the 256-cell centre at
                                the 182px in-game sprite scale (y positive =
                                DOWN, screen coords) — feeds anchors.json.
  * setup_scene(P, view)      — solved ortho camera for 'down' (front), 'up'
                                (back) or 'side' (PROFILE FACING +screen-right,
                                per the sheet contract); the key/fill rig is
                                yawed with the camera so every sheet is lit
                                from screen-upper-left.
  * setup_render(P, path)     — Cycles CPU, 256x256 RGBA transparent.

Typical driver:

    import monkey_rig as MR
    rig = MR.build_rigged_monkey()            # fresh bpy session inside
    MR.setup_scene(rig['params'], 'down')
    MR.setup_render(rig['params'], '/tmp/out.png')
    MR.set_pose('cast', 0)
    bpy.ops.render.render(write_still=True)
    x, y = MR.grip_cell_offset()              # anchors.json value

Contract anchors (48-grid): head centre 16/48 down the cell, feet 45/48,
ortho pitch 12 deg. BAKED BOB: ONLY walk frame 1 is raised — exactly 2/48 of
the cell ON SCREEN (world dz = 2/cos(pitch)) via the root bone; every other
frame keeps feet on z=0. Hands EMPTY; the wand is a runtime layer.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# ── canonical anchors (PixelArt.js 48-grid) ─────────────────────────────
GRID = 48.0
HEAD_FRAC = 16.0 / 48.0     # head centre 33% down the cell
FEET_FRAC = 45.0 / 48.0     # feet ~94% down the cell
PITCH_DEG = 12.0            # ortho top-down pitch
SPRITE_SIZE = 182.0         # in-game sprite px (GameConfig SPRITE_SIZE)
CELL = 256.0                # sheet cell px

# HERO_BOB walk[1] = -2 grid px ON SCREEN; world z lift that projects to it.
BOB_DZ = 2.0 / math.cos(math.radians(PITCH_DEG))

# Sheet column order (HeroAiSprites.js POSE_COLS) -> scene frame numbers.
POSE_COLS = [('idle', 0), ('idle', 1), ('walk', 0), ('walk', 1), ('walk', 2),
             ('cast', 0), ('hurt', 0), ('death', 0), ('victory', 0)]
POSE_FRAMES = {pf: i + 1 for i, pf in enumerate(POSE_COLS)}
POSES = {'idle': 2, 'walk': 3, 'cast': 1, 'hurt': 1, 'death': 1, 'victory': 1}

DEFAULT_PARAMS = {
    # palette (characters.js monkey/Pyra — canonical, do not drift)
    'fur':       '#8b5a2b',
    'fur_dark':  '#5a3818',
    'fur_light': '#b07a44',
    'face':      '#f0d2a5',
    'face_dark': '#c9a97e',
    'eye':       '#0a0a0a',
    'accent':    '#ffb24a',
    'emit': 0.5, 'emit_face': 0.72,

    # HEAD — ~48% of character height ('head_z' filled by solver)
    'head_r': 10.8, 'head_squash': 0.93, 'head_wide': 1.05,
    'ear_r': 5.2, 'ear_x': 11.6, 'ear_dz': 1.6, 'ear_y': 1.2,
    'ear_flat': 0.60, 'ear_inner_r': 3.1,
    'mask_rx': 8.5, 'mask_ry': 5.4, 'mask_rz': 7.7,
    'mask_y': -5.6, 'mask_dz': -0.6,
    'eye_r': 3.35, 'eye_dx': 4.55, 'eye_dz': 1.4, 'eye_y': -10.3,
    'glint_r': 1.45, 'glint2_r': 0.66,
    'muzzle_rx': 4.6, 'muzzle_ry': 2.0, 'muzzle_rz': 3.2,
    'muzzle_y': -9.9, 'muzzle_dz': -4.4,
    'blush_x': 6.9, 'blush_y': -8.9, 'blush_dz': -2.5,
    'ember_r': 1.25, 'ember_y': -8.4, 'ember_dz': 6.6,

    # BODY
    'body_rx': 7.4, 'body_ry': 6.4, 'body_rz': 8.0, 'body_z': 11.5,
    'belly_rx': 4.6, 'belly_rz': 5.0,
    'arm_r': 2.1, 'arm_x': 7.6, 'arm_top_z': 14.5, 'arm_bot_z': 8.6,
    'leg_r': 2.2, 'leg_x': 4.6, 'leg_top_z': 6.0,
    'foot_r': 2.8, 'foot_y': -1.8,

    # TAIL — FIXED: diagonal back-right sweep (+x,+y) so the curl reads from
    # front AND side, and shows prominently in the back (up) view. Same z
    # profile as the winning curl; the xy path now runs ~40deg toward +y.
    'tail_r': 1.7, 'tail_tuft_r': 2.7,
    'tail_pts': [(1.2, 4.9, 6.6), (6.8, 8.2, 4.6), (11.6, 10.8, 8.0),
                 (13.2, 11.6, 12.8), (11.6, 10.6, 16.2), (10.2, 9.8, 16.6)],

    # render
    'samples': 32,
    'key_energy': 3.2, 'fill_energy': 0.9, 'world_amb': 0.4,
}

# Pose tuning knobs (degrees / scales) — iterate here, not in _apply_pose.
POSE_TUNE = {
    'blink_eye_scale': 0.12,     # eye bone local-Y squash (bone Y = world Z)
    'blink_tail1_deg': 8.0,      # tail-wag beat, about world Z
    'blink_tail2_deg': 14.0,
    'walk_arm_deg': 28.0,        # stride arm swing about world X
    'walk_leg_fwd_deg': 20.0,    # forward-leg swing (rises off the ground)
    'walk_leg_back_deg': 12.0,   # back-leg swing (kept small: <0.1 unit dip)
    'walk_pass_arm_deg': 8.0,    # walk1 passing pose
    'walk_pass_leg_deg': 5.0,
    'walk_rock_deg': 4.5,        # stride spine rock about world Y — makes the
                                 # cycle read from the FRONT (arm swings alone
                                 # are along the camera axis there)
    'cast_dir': (0.55, -0.52, 0.66),   # world dir of raised arm.R: up-right
                                       # with a FORWARD bias so the paw also
                                       # reads in the side (profile) view
    'cast_stretch': 1.5,         # plush arm stretch so the paw clears the head
    'cast_spine_deg': 4.0,       # lean into the cast, about world Y (+x tilt)
    'cast_head_deg': 5.0,
    'cast_pitch_deg': 7.0,       # FORWARD spine pitch (about world X) — the
                                 # cue that makes cast unmistakable in profile
    'cast_head_pitch_deg': 7.0,
    'cast_offarm_deg': 18.0,     # arm.L counterswing back
    'hurt_spine_deg': 13.0,      # recoil lean back, about world X
    'hurt_head_deg': 11.0,
    'hurt_arm_splay_deg': 32.0,  # arms flail outward, about world Y
    'hurt_arm_back_deg': 14.0,
    'hurt_eye_scale': 0.35,      # wince
    'hurt_tail1_deg': -10.0,     # tail flick, about world X
    # DEATH — a grounded forward COLLAPSE: torso + head slump, arms hang, eyes
    # shut. Legs are NOT rotated so the feet stay planted on the contract line.
    'death_spine_deg': 17.0,     # forward slump (bounded so the side view stays in-cell)
    'death_head_deg': 15.0,      # head lolls down
    'death_arm_deg': 22.0,       # arms hang forward/down
    'death_eye_scale': 0.10,     # eyes shut (KO)
    'death_tail_deg': -18.0,     # tail droops, about world X
    # VICTORY — both arms thrown UP in a cheer, chin up, proud back-lean, tail
    # wag. Feet planted (no root lift) so the flat-frame feet check still holds.
    'victory_head_deg': 10.0,    # chin up, about world X (negated in pose)
    'victory_spine_deg': 5.0,    # slight proud back-lean, about world X
    'victory_arm_dir': (0.3, -0.28, 0.92),  # right arm UP (less out — clears the cell edge; L mirrors x)
    'victory_arm_stretch': 1.28,
    'victory_tail_deg': 15.0,    # happy tail wag, about world Z
}


# ── colour / mesh helpers (ported verbatim from the winner) ──────────────
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
    """Rounded limb: cylinder between p0..p1 plus sphere caps.
    Returns [cylinder, cap0, cap1] so the rig can split shoulder/paw."""
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
    caps = [sphere(f'{name}_cap{i}', p, r, material) for i, p in enumerate((p0, p1))]
    return [ob] + caps


def tail_curve(name, pts, r, material):
    """Smooth NURBS tube segment of the tail curl."""
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


# ── camera solver (verified in the bake-off) ─────────────────────────────
def solve_camera():
    th = math.radians(PITCH_DEG)
    S = GRID
    dist = 80.0
    v_cam = S * (FEET_FRAC - 0.5)
    cam_y = -dist
    cam_z = (v_cam - cam_y * math.sin(th)) / math.cos(th)
    return cam_y, cam_z, S, th


def head_z_for_anchor():
    th = math.radians(PITCH_DEG)
    S = GRID
    v_cam = S * (FEET_FRAC - 0.5)
    v_head = v_cam + S * (0.5 - HEAD_FRAC)
    return v_head / math.cos(th)


# ── model build (same geometry as the winner; collects parts for the rig) ─
def build_monkey(params=None):
    """Build the monkey meshes. Returns {bone_name: [objects]} for rigging.
    `params` may omit 'head_z' — it is solved from the anchor contract."""
    P = dict(DEFAULT_PARAMS)
    if params:
        P.update(params)
    if 'head_z' not in P:
        P['head_z'] = head_z_for_anchor()

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
    parts = {k: [] for k in ('spine', 'head', 'eye.L', 'eye.R', 'arm.L',
                             'arm.R', 'hand.R', 'leg.L', 'leg.R',
                             'tail.1', 'tail.2')}

    # BODY
    parts['spine'].append(sphere('body', (0, 0, P['body_z']), 1.0, fur,
                                 scale=(P['body_rx'], P['body_ry'], P['body_rz'])))
    parts['spine'].append(sphere('belly', (0, -P['body_ry'] * 0.76,
                                           P['body_z'] - 0.4), 1.0, face,
                                 scale=(P['belly_rx'], 2.0, P['belly_rz'])))

    # HEAD
    parts['head'].append(sphere('head', (0, 0, hz), hr, fur,
                                scale=(P['head_wide'], 0.98, P['head_squash'])))

    # EARS
    for sx in (-1, 1):
        ex = sx * P['ear_x']
        ez = hz + P['ear_dz']
        parts['head'].append(sphere(f'ear{sx}', (ex, P['ear_y'], ez),
                                    P['ear_r'], fur,
                                    scale=(1.0, P['ear_flat'], 1.0)))
        parts['head'].append(sphere(
            f'earIn{sx}',
            (ex * 1.02, P['ear_y'] - P['ear_r'] * P['ear_flat'] * 0.75, ez),
            P['ear_inner_r'], face, scale=(0.9, 0.45, 0.9)))

    # FACE MASK
    parts['head'].append(sphere('mask', (0, P['mask_y'], hz + P['mask_dz']),
                                1.0, face,
                                scale=(P['mask_rx'], P['mask_ry'], P['mask_rz'])))

    # EYES + GLINTS — each eye rides its own bone so blink/wince can squash it
    eyz = hz + P['eye_dz']
    for sx, part in ((-1, 'eye.L'), (1, 'eye.R')):
        exx = sx * P['eye_dx']
        parts[part].append(sphere(f'eye{sx}', (exx, P['eye_y'], eyz),
                                  P['eye_r'], eyeM, scale=(1.0, 0.62, 1.18)))
        parts[part].append(sphere(
            f'glint{sx}',
            (exx - P['eye_r'] * 0.38, P['eye_y'] - 1.7,
             eyz + P['eye_r'] * 0.52), P['glint_r'], white))
        parts[part].append(sphere(
            f'glint2_{sx}',
            (exx + P['eye_r'] * 0.42, P['eye_y'] - 1.5,
             eyz - P['eye_r'] * 0.42), P['glint2_r'], white))

    # MUZZLE + nose + mouth
    mz = hz + P['muzzle_dz']
    parts['head'].append(sphere('muzzle', (0, P['muzzle_y'], mz), 1.0, face,
                                scale=(P['muzzle_rx'], P['muzzle_ry'],
                                       P['muzzle_rz'])))
    for sx in (-1, 1):
        parts['head'].append(sphere(
            f'nose{sx}', (sx * 1.0, P['muzzle_y'] - P['muzzle_ry'] * 0.95,
                          mz + 0.9), 0.5, faceD))
    parts['head'].append(sphere('mouth', (0, P['muzzle_y'] - P['muzzle_ry'] * 0.95,
                                          mz - 1.2), 1.0, faceD,
                                scale=(1.6, 0.38, 0.5)))

    # CHEEK BLUSH
    for sx in (-1, 1):
        parts['head'].append(sphere(f'blush{sx}',
                                    (sx * P['blush_x'], P['blush_y'],
                                     hz + P['blush_dz']),
                                    1.0, faceD, scale=(1.5, 0.6, 1.05)))

    # EMBER BROW SPARK
    parts['head'].append(sphere('ember', (0, P['ember_y'], hz + P['ember_dz']),
                                P['ember_r'], accent, scale=(1.0, 0.5, 1.35)))

    # ARMS — right paw cap goes to hand.R so the GRIP rides a real hand tip
    for sx, part in ((-1, 'arm.L'), (1, 'arm.R')):
        objs = capsule(f'arm{sx}',
                       (sx * P['arm_x'], -1.4, P['arm_top_z']),
                       (sx * (P['arm_x'] + 0.7), -2.4, P['arm_bot_z']),
                       P['arm_r'], fur)
        if sx == 1:
            parts['hand.R'].append(objs.pop())   # cap1 = paw
        parts[part].extend(objs)

    # LEGS + FEET
    for sx, part in ((-1, 'leg.L'), (1, 'leg.R')):
        parts[part].extend(capsule(f'leg{sx}',
                                   (sx * P['leg_x'], -0.8, P['leg_top_z']),
                                   (sx * P['leg_x'], -1.4, P['foot_r'] + 0.5),
                                   P['leg_r'], furD))
        parts[part].append(sphere(f'foot{sx}',
                                  (sx * P['leg_x'], P['foot_y'], P['foot_r']),
                                  P['foot_r'], furD, scale=(1.1, 1.25, 1.0)))

    # TAIL — two curve segments split at pts[2] so tail.2 can pose
    # independently; a joint ball at the split hides the seam.
    pts = [Vector(p) for p in P['tail_pts']]
    parts['tail.1'].append(tail_curve('tailA', pts[0:3], P['tail_r'], furD))
    parts['tail.1'].append(sphere('tailJoint', pts[2], P['tail_r'] * 1.06, furD))
    parts['tail.2'].append(tail_curve('tailB', pts[2:6], P['tail_r'], furD))
    parts['tail.2'].append(sphere('tuft', pts[5], P['tail_tuft_r'], furL))

    return parts, P


# ── armature ─────────────────────────────────────────────────────────────
def _bone_parent(ob, arm_ob, bone_name):
    """Rigid bone parenting that preserves the object's world transform."""
    mw = ob.matrix_world.copy()
    ob.parent = arm_ob
    ob.parent_type = 'BONE'
    ob.parent_bone = bone_name
    bpy.context.view_layer.update()
    ob.matrix_world = mw


def build_armature(P, parts):
    """Create the hero armature, bone-parent every mesh part, add the GRIP
    empty at the right paw. Returns (armature_object, grip_empty)."""
    hz, hr = P['head_z'], P['head_r']
    ax, atz, abz = P['arm_x'], P['arm_top_z'], P['arm_bot_z']
    lx, ltz = P['leg_x'], P['leg_top_z']
    eyz = hz + P['eye_dz']
    pts = [Vector(p) for p in P['tail_pts']]
    paw = Vector((ax + 0.7, -2.4, abz))

    arm_data = bpy.data.armatures.new('HeroRig')
    arm_ob = bpy.data.objects.new('HeroRig', arm_data)
    bpy.context.collection.objects.link(arm_ob)
    bpy.ops.object.select_all(action='DESELECT')
    arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.mode_set(mode='EDIT')

    def eb(name, head, tail, parent=None, connect=False):
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = connect
        return b

    eb('root', (0, 0, 0), (0, 0, 2.5))
    eb('spine', (0, 0, 5.0), (0, 0, P['body_z'] + P['body_rz'] * 0.8), 'root')
    eb('head', (0, 0, hz - hr * 0.8), (0, 0, hz + 4.0), 'spine')
    for sx, n in ((-1, 'eye.L'), (1, 'eye.R')):
        c = (sx * P['eye_dx'], P['eye_y'], eyz)
        eb(n, c, (c[0], c[1], c[2] + 1.5), 'head')
    eb('arm.L', (-ax, -1.4, atz), (-(ax + 0.7), -2.4, abz), 'spine')
    eb('arm.R', (ax, -1.4, atz), tuple(paw), 'spine')
    eb('hand.R', tuple(paw), (paw.x + 0.2, paw.y - 0.4, paw.z - 1.8),
       'arm.R', connect=True)
    for sx, n in ((-1, 'leg.L'), (1, 'leg.R')):
        eb(n, (sx * lx, -0.8, ltz), (sx * lx, -1.4, 1.0), 'root')
    eb('tail.1', tuple(pts[0]), tuple(pts[2]), 'spine')
    eb('tail.2', tuple(pts[2]), tuple(pts[5]), 'tail.1', connect=True)

    bpy.ops.object.mode_set(mode='OBJECT')

    for pb in arm_ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    for bone_name, objs in parts.items():
        for ob in objs:
            _bone_parent(ob, arm_ob, bone_name)

    grip = bpy.data.objects.new('GRIP', None)
    grip.empty_display_size = 1.5
    bpy.context.collection.objects.link(grip)
    grip.matrix_world = Matrix.Translation(paw)
    _bone_parent(grip, arm_ob, 'hand.R')

    return arm_ob, grip


# ── pose math helpers ────────────────────────────────────────────────────
def _upd():
    bpy.context.view_layer.update()


def _reset_pose(arm_ob):
    for pb in arm_ob.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    _upd()


def _rot_world(arm_ob, name, axis, deg):
    """Rotate a pose bone about its own HEAD around a WORLD axis."""
    pb = arm_ob.pose.bones[name]
    m = pb.matrix.copy()
    loc = m.to_translation()
    rot = (Matrix.Rotation(math.radians(deg), 3, Vector(axis)) @ m.to_3x3())
    pb.matrix = Matrix.Translation(loc) @ rot.to_4x4()
    _upd()


def _translate_world(arm_ob, name, vec):
    pb = arm_ob.pose.bones[name]
    pb.matrix = Matrix.Translation(Vector(vec)) @ pb.matrix
    _upd()


def _aim(arm_ob, name, world_dir, stretch=1.0):
    """Point a pose bone's Y axis along a world direction (about its head)."""
    pb = arm_ob.pose.bones[name]
    loc = pb.matrix.to_translation()
    q = Vector(world_dir).normalized().to_track_quat('Y', 'Z')
    pb.matrix = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
    _upd()
    if stretch != 1.0:
        pb.scale = (1.0, stretch, 1.0)
        _upd()


def _eye_scale(arm_ob, s):
    for n in ('eye.L', 'eye.R'):
        arm_ob.pose.bones[n].scale = (1.0, s, 1.0)   # bone Y = world Z
    _upd()


# ── pose definitions ─────────────────────────────────────────────────────
def _apply_pose(arm_ob, pose, idx, T):
    """Author one (pose, frameIndex) on a rest-reset armature. Returns True
    when the glint meshes must be hidden for this frame (closed eyes)."""
    hide_glints = False

    if pose == 'idle':
        if idx == 1:                      # blink + tail-wag beat
            _eye_scale(arm_ob, T['blink_eye_scale'])
            hide_glints = True
            _rot_world(arm_ob, 'tail.1', (0, 0, 1), T['blink_tail1_deg'])
            _rot_world(arm_ob, 'tail.2', (0, 0, 1), T['blink_tail2_deg'])

    elif pose == 'walk':
        if idx == 1:                      # passing pose + THE baked bob
            _translate_world(arm_ob, 'root', (0, 0, BOB_DZ))
            _rot_world(arm_ob, 'arm.L', (1, 0, 0), T['walk_pass_arm_deg'])
            _rot_world(arm_ob, 'arm.R', (1, 0, 0), -T['walk_pass_arm_deg'])
            _rot_world(arm_ob, 'leg.L', (1, 0, 0), -T['walk_pass_leg_deg'])
            _rot_world(arm_ob, 'leg.R', (1, 0, 0), T['walk_pass_leg_deg'])
        else:                             # stride poses, mirrored
            s = 1.0 if idx == 0 else -1.0
            # alternating rock so the stride reads in the down/up views
            _rot_world(arm_ob, 'spine', (0, 1, 0), s * T['walk_rock_deg'])
            # s=+1: arm.L forward (-x rot = toward -y = facing dir), leg.R fwd
            _rot_world(arm_ob, 'arm.L', (1, 0, 0), -s * T['walk_arm_deg'])
            _rot_world(arm_ob, 'arm.R', (1, 0, 0), s * T['walk_arm_deg'])
            fwd, back = T['walk_leg_fwd_deg'], T['walk_leg_back_deg']
            _rot_world(arm_ob, 'leg.R', (1, 0, 0), -fwd if s > 0 else back)
            _rot_world(arm_ob, 'leg.L', (1, 0, 0), back if s > 0 else -fwd)

    elif pose == 'cast':
        # forward pitch first (+X rotation tips the torso toward -y = the
        # character's FRONT): in the down view it foreshortens to a subtle
        # bow, in the side view it shifts the whole head/torso forward so
        # cast can never alias idle there (and cannot be confused with the
        # backward hurt recoil)
        _rot_world(arm_ob, 'spine', (1, 0, 0), T['cast_pitch_deg'])
        _rot_world(arm_ob, 'head', (1, 0, 0), T['cast_head_pitch_deg'])
        _rot_world(arm_ob, 'spine', (0, 1, 0), T['cast_spine_deg'])
        _rot_world(arm_ob, 'head', (0, 1, 0), T['cast_head_deg'])
        _aim(arm_ob, 'arm.R', T['cast_dir'], T['cast_stretch'])
        _rot_world(arm_ob, 'arm.L', (1, 0, 0), T['cast_offarm_deg'])
        _rot_world(arm_ob, 'tail.2', (1, 0, 0), 10.0)

    elif pose == 'hurt':
        _rot_world(arm_ob, 'spine', (1, 0, 0), T['hurt_spine_deg'])
        _rot_world(arm_ob, 'head', (1, 0, 0), T['hurt_head_deg'])
        for n, sy in (('arm.L', 1.0), ('arm.R', -1.0)):
            _rot_world(arm_ob, n, (0, 1, 0), sy * T['hurt_arm_splay_deg'])
            _rot_world(arm_ob, n, (1, 0, 0), T['hurt_arm_back_deg'])
        _eye_scale(arm_ob, T['hurt_eye_scale'])
        _rot_world(arm_ob, 'tail.1', (1, 0, 0), T['hurt_tail1_deg'])

    elif pose == 'death':
        # Grounded forward collapse — legs untouched so the feet stay planted on
        # the contract line; torso/head slump forward, arms hang, eyes shut.
        _rot_world(arm_ob, 'spine', (1, 0, 0), T['death_spine_deg'])
        _rot_world(arm_ob, 'head', (1, 0, 0), T['death_head_deg'])
        for n in ('arm.L', 'arm.R'):
            _rot_world(arm_ob, n, (1, 0, 0), T['death_arm_deg'])
        _eye_scale(arm_ob, T['death_eye_scale'])
        hide_glints = True
        _rot_world(arm_ob, 'tail.1', (1, 0, 0), T['death_tail_deg'])

    elif pose == 'victory':
        # Both arms up in a cheer, chin up, proud back-lean, tail wag; feet planted.
        _rot_world(arm_ob, 'head', (1, 0, 0), -T['victory_head_deg'])
        _rot_world(arm_ob, 'spine', (1, 0, 0), -T['victory_spine_deg'])
        dx, dy, dz = T['victory_arm_dir']
        _aim(arm_ob, 'arm.R', (dx, dy, dz), T['victory_arm_stretch'])
        _aim(arm_ob, 'arm.L', (-dx, dy, dz), T['victory_arm_stretch'])
        _rot_world(arm_ob, 'tail.1', (0, 0, 1), T['victory_tail_deg'])

    return hide_glints


def author_poses(arm_ob, glint_obs, tune=None):
    """Keyframe all 7 POSE_COLS frames into one action (frames 1..7)."""
    T = dict(POSE_TUNE)
    if tune:
        T.update(tune)
    # constant interpolation for every new key — pose frames never blend
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'CONSTANT'

    for (pose, idx) in POSE_COLS:
        frame = POSE_FRAMES[(pose, idx)]
        _reset_pose(arm_ob)
        hide_glints = _apply_pose(arm_ob, pose, idx, T)
        for pb in arm_ob.pose.bones:
            pb.keyframe_insert('location', frame=frame)
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('scale', frame=frame)
        for ob in glint_obs:
            ob.hide_render = hide_glints
            ob.keyframe_insert('hide_render', frame=frame)
    _reset_pose(arm_ob)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, len(POSE_COLS)


# ── top-level build + runtime API ────────────────────────────────────────
_RIG = {}


def build_rigged_monkey(params=None, tune=None, fresh_session=True):
    """Fresh bpy session -> meshes -> armature -> keyframed poses.
    Returns the rig handle dict {armature, grip, params, parts}."""
    if fresh_session:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    parts, P = build_monkey(params)
    arm_ob, grip = build_armature(P, parts)
    glints = [ob for objs in (parts['eye.L'], parts['eye.R'])
              for ob in objs if ob.name.startswith('glint')]
    author_poses(arm_ob, glints, tune)
    _RIG.clear()
    _RIG.update(armature=arm_ob, grip=grip, params=P, parts=parts)
    set_pose('idle', 0)
    return dict(_RIG)


def set_pose(pose, frame_index=0):
    """Jump the scene to the keyframed (pose, frameIndex) — e.g.
    set_pose('walk', 1). Valid poses/counts: POSES."""
    frame = POSE_FRAMES[(pose, frame_index)]
    bpy.context.scene.frame_set(frame)
    _upd()
    return frame


def get_grip_world():
    """Depsgraph-evaluated world location of the GRIP empty (right paw)."""
    dg = bpy.context.evaluated_depsgraph_get()
    return _RIG['grip'].evaluated_get(dg).matrix_world.translation.copy()


def grip_cell_offset(world_pt=None, sprite=SPRITE_SIZE):
    """Project a world point (default: GRIP) through the ACTIVE ortho camera
    into (x, y) px offsets from the sheet-cell centre AT THE IN-GAME SPRITE
    SCALE (182 px). y positive = DOWN (screen coords) — anchors.json
    convention. Projected manually (camera-space / ortho_scale) so the result
    is independent of the scene render resolution/aspect: the sheet cell is
    square by contract."""
    if world_pt is None:
        world_pt = get_grip_world()
    cam_ob = bpy.context.scene.camera
    p = cam_ob.matrix_world.inverted() @ Vector(world_pt)   # cam: x right, y up
    s = cam_ob.data.ortho_scale
    return (p.x / s * sprite, -p.y / s * sprite)


# ── camera / lights / render ─────────────────────────────────────────────
VIEW_YAW = {'down': 0.0, 'up': 180.0, 'side': -90.0}


def setup_scene(P, view='down'):
    """Solved ortho camera + light rig for one sheet direction.
    'down' = front (faces camera), 'up' = back, 'side' = profile FACING
    SCREEN-RIGHT (camera on -x), per the sheet contract. The sun rig is yawed
    with the camera so every sheet reads lit from screen-upper-left.
    Re-callable: replaces any camera/lights it made before."""
    for name in ('cam', 'key', 'fill'):
        ob = bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    cam_y, cam_z, S, th = solve_camera()
    yaw = math.radians(VIEW_YAW[view])
    pitch = math.radians(90.0 - PITCH_DEG)
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = S
    cam.clip_end = 500
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.collection.objects.link(ob)
    # camera orbits the origin at the solved height, opposite the yaw dir
    ob.location = (-cam_y * math.sin(yaw), cam_y * math.cos(yaw), cam_z)
    ob.rotation_euler = (pitch, 0, yaw)
    bpy.context.scene.camera = ob

    key = bpy.data.lights.new('key', 'SUN')
    key.energy = P['key_energy']
    key.color = (1.0, 0.91, 0.8)
    key.angle = 0.4
    ko = bpy.data.objects.new('key', key)
    bpy.context.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(55), math.radians(-18),
                         math.radians(-25) + yaw)

    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = P['fill_energy']
    fill.color = (0.72, 0.80, 1.0)
    fill.angle = 0.6
    fo = bpy.data.objects.new('fill', fill)
    bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(70), math.radians(20),
                         math.radians(150) + yaw)

    w = bpy.context.scene.world or bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.9, 0.78, 0.65, 1.0)
    bg.inputs['Strength'].default_value = P['world_amb']
    return ob


def setup_render(P, outpath, res=256):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = P['samples']
    sc.cycles.use_denoising = True
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'   # palette-true
    sc.render.filepath = outpath


# ── smoke test ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    rig = build_rigged_monkey()
    setup_scene(rig['params'], 'down')
    print('pose  frame  grip world            grip cell offset @182px')
    for (pose, idx) in POSE_COLS:
        set_pose(pose, idx)
        g = get_grip_world()
        x, y = grip_cell_offset(g)
        print(f'{pose}[{idx}]  f{POSE_FRAMES[(pose, idx)]}   '
          f'({g.x:6.2f},{g.y:6.2f},{g.z:6.2f})   ({x:7.2f},{y:7.2f})')
