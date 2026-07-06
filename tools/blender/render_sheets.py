#!/usr/bin/env python3
"""EMBERWAKE hero pipeline PR1 — batch sheet renderer on top of monkey_rig.

Renders the rigged parametric monkey (monkey_rig.build_rigged_monkey) into
the three hero sheets of THE SHEET CONTRACT:

    raw/monkey_down.png   front  (faces camera)
    raw/monkey_up.png     back
    raw/monkey_side.png   profile FACING +screen-right (game mirrors for left)

Each sheet: 1 row x 7 equal 256x256 columns = 1792x256 RGBA, transparent
background, POSE_COLS order [idle0, idle1(blink), walk0, walk1, walk2, cast,
hurt] (src/assets/HeroAiSprites.js).

FRAMING — solved ONCE, never per-frame:
  The parametric ortho camera (monkey_rig.solve_camera, 12 deg pitch) maps
  the 48-grid directly onto the square cell: feet z=0 -> 45/48 down the cell,
  head centre -> 16/48. setup_scene(P, 'down') is called EXACTLY ONCE; the
  three directions are produced by yawing the CHARACTER (the HeroRig armature
  object) about world Z — the camera and the sun rig never move, so every
  sheet is lit from screen-upper-left and no frame can ever reframe/jitter.
  The union of alpha bounds across all 21 renders is then measured and must
  fit the cell with margin (validated below) — the solved framing is only
  accepted if that union check passes.

CHARACTER YAW (character rotates, camera fixed at -y):
    down  =   0 deg  (front faces the camera)
    up    = 180 deg  (back to camera)
    side  = +90 deg  (profile faces +x = SCREEN-RIGHT, per contract)
  This is optically identical to monkey_rig.setup_scene's per-view camera
  (which yaws camera+lights together): the relative camera/light/character
  geometry is the same; e.g. side here == setup_scene('side') there.

ANCHORS — anchors.json per the HAND-BONE ANCHOR EXPORT spec:
  For every direction x pose x frame (21), the GRIP empty (right paw) is
  projected through the render camera (monkey_rig.grip_cell_offset) into px
  offsets from the 256-cell centre at the in-game 182px sprite scale,
  y positive = DOWN.  { down/up/side: { idle:[2], walk:[3], cast:[1],
  hurt:[1] }, meta: { feetFrac, headFrac, bobPx } }.

BAKED BOB: HERO_BOB walk[1] = -2 (48-grid px). Only walk frame index 1 is
raised, by exactly 2/48 of the cell = 10.67 px at 256. Validated numerically.

Run:  python3 render_sheets.py            (~21 Cycles CPU renders)
Exit non-zero if any validation fails.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image  # noqa: E402

import monkey_rig as MR  # noqa: E402

RAW_DIR = os.path.join(HERE, 'raw')
FRAME_DIR = os.path.join(RAW_DIR, 'frames')
ANCHORS_PATH = os.path.join(HERE, 'anchors.json')

CELL = int(MR.CELL)                      # 256
SHEET_W = CELL * len(MR.POSE_COLS)       # 1792
ALPHA_THRESH = 8                         # ignore faint AA fringe

# character yaw per sheet direction (camera stays at -y, solved once)
CHAR_YAW = {'down': 0.0, 'up': 180.0, 'side': 90.0}
DIRS = ['down', 'up', 'side']

# expected contract numbers at 256px
FEET_PX = MR.FEET_FRAC * CELL            # 240.0
BOB_PX = 2.0 / MR.GRID * CELL            # 10.667
FEET_TOL_PX = 0.015 * CELL               # +-1.5% of the cell (contract)
HALF_GRID_PX = CELL / MR.GRID / 2.0      # 2.67px: half a 48-grid pixel —
#   flat-frame ground rows must agree within this so they quantize to the
#   SAME grid row after PR2 pixelation (literal row identity is impossible
#   under a 12deg-pitched ortho camera: the silhouette bottom is set by
#   whichever ground geometry is nearest the camera — toe overhang from the
#   front, stance width from the side, heels from the back)
BOB_TOL_PX = 1.5
HEAD_TOL = 0.02                          # per-direction head-frac tolerance


# ── helpers ──────────────────────────────────────────────────────────────
def set_char_yaw(arm_ob, deg):
    """Rotate the CHARACTER (armature object; all meshes + GRIP are its
    bone-children) about world Z. The camera never moves."""
    arm_ob.rotation_mode = 'XYZ'
    arm_ob.rotation_euler = (0.0, 0.0, math.radians(deg))
    bpy.context.view_layer.update()


def alpha_stats(path):
    """(bbox l,t,r,b inclusive, bottom_row, top_row, cx) of alpha > thresh."""
    im = Image.open(path)
    a = im.getchannel('A')
    w, h = a.size
    px = a.load()
    l, t, r, b = w, h, -1, -1
    xsum = n = 0
    for y in range(h):
        for x in range(w):
            if px[x, y] > ALPHA_THRESH:
                if x < l:
                    l = x
                if x > r:
                    r = x
                if y < t:
                    t = y
                if y > b:
                    b = y
                xsum += x
                n += 1
    return {'l': l, 't': t, 'r': r, 'b': b,
            'cx': xsum / n if n else float('nan'), 'n': n}


def project_frac(world_pt):
    """Vertical cell fraction (0 top .. 1 bottom) of a world point through
    the active camera."""
    _, y = MR.grip_cell_offset(Vector(world_pt), sprite=CELL)
    return 0.5 + y / CELL


# ── main ─────────────────────────────────────────────────────────────────
def main():
    os.makedirs(FRAME_DIR, exist_ok=True)

    # Hero variant: HERO_NAME picks the output sheet/anchor prefix, HERO_PARAMS
    # (optional JSON path) supplies a proportion/palette delta merged over
    # DEFAULT_PARAMS. Unset => the canonical monkey (identical to before).
    hero = os.environ.get('HERO_NAME', 'monkey')
    delta = None
    pj = os.environ.get('HERO_PARAMS')
    if pj and os.path.exists(pj):
        with open(pj) as f:
            delta = json.load(f)
        print(f'HERO {hero}: applying {len(delta)} param override(s) from {pj}',
              flush=True)

    rig = MR.build_rigged_monkey(params=delta)
    P = rig['params']
    arm_ob = rig['armature']

    # camera + lights: solved ONCE (front view); directions rotate the model
    MR.setup_scene(P, 'down')
    bpy.context.view_layer.update()   # settle the fresh camera matrix_world

    # contract projections (exact, camera-space — direction independent)
    feet_frac_proj = project_frac((0, 0, 0))
    head_frac_proj = project_frac((0, 0, P['head_z']))
    origin_x_px = MR.grip_cell_offset(Vector((0, 0, 0)), sprite=CELL)[0]

    # ── render all 21 frames, collect raw grip offsets + alpha stats ─────
    raw_grip = {}
    raw_stats = {}
    for d in DIRS:
        set_char_yaw(arm_ob, CHAR_YAW[d])
        for (pose, idx) in MR.POSE_COLS:
            MR.set_pose(pose, idx)
            path = os.path.join(FRAME_DIR, f'{d}_{pose}{idx}.png')
            MR.setup_render(P, path, res=CELL)
            bpy.ops.render.render(write_still=True)
            raw_grip[(d, pose, idx)] = MR.grip_cell_offset()   # @182, y-down
            raw_stats[(d, pose, idx)] = alpha_stats(path)
            gx, gy = raw_grip[(d, pose, idx)]
            print(f'rendered {d}/{pose}{idx}  grip=({gx:6.1f},{gy:6.1f})  '
                  f"bbox={raw_stats[(d, pose, idx)]}", flush=True)

    # ── per-DIRECTION ground alignment (computed ONCE from the stats) ─────
    # Under the pitched ortho camera the silhouette bottom row is set by the
    # ground geometry nearest the camera, which differs per facing (toes /
    # stance width / heels), so each direction's whole 7-frame set gets ONE
    # constant integer dy putting its median flat-frame bottom on the
    # contract feet line. Never per-frame — cells within a direction and the
    # walk1 bob relationship are untouched.
    dy = {}
    for d in DIRS:
        flats = sorted(raw_stats[(d, p, i)]['b'] for (p, i) in MR.POSE_COLS
                       if (p, i) != ('walk', 1))
        med = flats[len(flats) // 2]
        # round half UP (toward the smaller |shift|/higher content) so a
        # x.5 tie doesn't over-shift and drag the head anchor with it
        dy[d] = int(math.floor((FEET_PX - 0.5) - med + 0.5))
        print(f'direction {d}: median flat bottom {med} -> dy {dy[d]:+d}px')

    # post-shift stats (what actually lands on the sheets)
    stats = {k: {**s, 't': s['t'] + dy[k[0]], 'b': s['b'] + dy[k[0]],
                 'l': s['l'], 'r': s['r'], 'cx': s['cx']}
             for k, s in raw_stats.items()}

    # ── assemble sheets (frames pasted with the direction's dy) ──────────
    sheet_paths = {}
    for d in DIRS:
        sheet = Image.new('RGBA', (SHEET_W, CELL), (0, 0, 0, 0))
        for i, (pose, idx) in enumerate(MR.POSE_COLS):
            fr = Image.open(os.path.join(FRAME_DIR,
                                         f'{d}_{pose}{idx}.png')).convert('RGBA')
            cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
            cell.paste(fr, (0, dy[d]))    # paste clips; shifted rows are empty
            sheet.paste(cell, (i * CELL, 0))
        sheet_paths[d] = os.path.join(RAW_DIR, f'{hero}_{d}.png')
        sheet.save(sheet_paths[d])
        print(f'wrote {sheet_paths[d]}', flush=True)

    # ── anchors.json (grip offsets carry the same per-direction dy) ──────
    anchors = {}
    for d in DIRS:
        anchors[d] = {}
        for p in ('idle', 'walk', 'cast', 'hurt'):
            anchors[d][p] = [
                [round(raw_grip[(d, p, i)][0], 1),
                 round(raw_grip[(d, p, i)][1] + dy[d] * MR.SPRITE_SIZE / CELL,
                       1)]
                for i in range(MR.POSES[p])]
    anchors['meta'] = {
        'feetFrac': round(MR.FEET_FRAC, 6),
        'headFrac': round(MR.HEAD_FRAC, 6),
        # HERO_BOB (PixelArt.js): 48-grid px baked per walk frame, y-down
        'bobPx': [0, -2, 0],
        'spriteSize': int(MR.SPRITE_SIZE),
        'yDownPositive': True,
    }
    anchors_path = ANCHORS_PATH if hero == 'monkey' \
        else os.path.join(HERE, f'{hero}_anchors.json')
    with open(anchors_path, 'w') as f:
        json.dump(anchors, f, indent=1)
    print(f'wrote {anchors_path}', flush=True)

    # ── numeric validation (on the post-shift sheet cells) ───────────────
    print('\n===== VALIDATION =====')
    failures = []

    def check(ok, msg):
        print(('PASS  ' if ok else 'FAIL  ') + msg)
        if not ok:
            failures.append(msg)

    # 0) union of alpha bounds across ALL 21 cells fits with margin
    ul = min(s['l'] for s in stats.values())
    ut = min(s['t'] for s in stats.values())
    ur = max(s['r'] for s in stats.values())
    ub = max(s['b'] for s in stats.values())
    print(f'union alpha bounds (all 21 cells): l={ul} t={ut} r={ur} b={ub}')
    check(ul >= 1 and ut >= 1 and ur <= CELL - 2 and ub <= CELL - 2,
          f'union fits cell with margin (l={ul},t={ut},r={ur},b={ub})')

    # 1) camera-solve contract (exact projections through the one camera)
    check(abs(feet_frac_proj - MR.FEET_FRAC) < 1e-6,
          f'projected feet frac {feet_frac_proj:.6f} == {MR.FEET_FRAC:.6f}')
    check(abs(head_frac_proj - MR.HEAD_FRAC) < 1e-6,
          f'projected head-centre frac {head_frac_proj:.6f} == '
          f'{MR.HEAD_FRAC:.6f} (33%)')
    check(abs(origin_x_px) < 1e-6,
          f'character axis projects to cell centre x (off by '
          f'{origin_x_px:.6f}px)')

    # per-direction head-centre fraction as it lands on the sheet
    for d in DIRS:
        hf = head_frac_proj + dy[d] / CELL
        check(abs(hf - MR.HEAD_FRAC) <= HEAD_TOL,
              f'{d} head-centre lands at {hf * 100:.1f}% '
              f'(contract ~33.3%, +-{HEAD_TOL * 100:.0f}%)')

    # 2) feet line: all FLAT frames (everything but walk1)
    flat = {k: s for k, s in stats.items() if k[1:] != ('walk', 1)}
    bobk = {k: s for k, s in stats.items() if k[1:] == ('walk', 1)}
    flat_bottoms = {k: s['b'] for k, s in flat.items()}
    fb_min, fb_max = min(flat_bottoms.values()), max(flat_bottoms.values())
    print(f'flat-frame alpha bottom rows: min={fb_min} max={fb_max} '
          f'(feet line {FEET_PX:.0f})')
    check(all(abs((b + 0.5) - FEET_PX) <= FEET_TOL_PX
              for b in flat_bottoms.values()),
          f'feet at {MR.FEET_FRAC * 100:.1f}% +-1.5% on all 18 flat frames '
          f'(frac {(fb_min + .5) / CELL:.4f}..{(fb_max + .5) / CELL:.4f})')
    check(all(abs((b + 0.5) - FEET_PX) <= HALF_GRID_PX
              for b in flat_bottoms.values()),
          f'flat ground rows within half a 48-grid px of the feet line '
          f'(max dev {max(abs((b + .5) - FEET_PX) for b in flat_bottoms.values()):.1f}px '
          f'<= {HALF_GRID_PX:.2f}px -> one grid row after pixelation)')

    # 3) baked bob: ONLY walk1 raised, by 2/48 of the cell, per direction
    for d in DIRS:
        med = sorted(v for k, v in flat_bottoms.items()
                     if k[0] == d)[len([k for k in flat_bottoms
                                        if k[0] == d]) // 2]
        lift = med - bobk[(d, 'walk', 1)]['b']
        check(abs(lift - BOB_PX) <= BOB_TOL_PX,
              f'{d} walk1 bob lift {lift:.1f}px == {BOB_PX:.2f}px '
              f'+-{BOB_TOL_PX} (nothing else moved: flat check above)')

    # 4) cell centring stability
    print('per-frame bbox centre-x drift from cell centre:')
    max_drift = 0.0
    for d in DIRS:
        cxs = {k[1:]: (s['l'] + s['r']) / 2.0 - (CELL - 1) / 2.0
               for k, s in stats.items() if k[0] == d}
        max_drift = max(max_drift, max(abs(v) for v in cxs.values()))
        print(f"  {d}: " + '  '.join(f'{p}{i}={v:+.1f}'
              for (p, i), v in sorted(cxs.items())))
    print(f'max bbox-centre drift: {max_drift:.1f}px — silhouette asymmetry '
          f'(tail / swung limbs); the body AXIS is pinned to cell centre x '
          f'exactly (check 1) and per-frame x is never re-centred')
    same = [abs(stats[(d, 'idle', 0)]['cx'] - stats[(d, 'idle', 1)]['cx'])
            for d in DIRS]
    check(max(same) <= 6.5,
          f'idle0 vs idle1 centroid stable per direction '
          f'(max {max(same):.1f}px, blink/tail-wag only)')

    # 5) cast must not alias idle (menu flashes cast over down.idle)
    for d in DIRS:
        ci, ii = stats[(d, 'cast', 0)], stats[(d, 'idle', 0)]
        dx = abs(ci['l'] - ii['l']) + abs(ci['r'] - ii['r']) + \
            abs(ci['t'] - ii['t'])
        check(dx >= 10, f'{d} cast silhouette distinct from idle '
              f'(bbox delta {dx}px)')

    print('\nanchors.json grip offsets (@182px, y-down, incl. direction dy):')
    for d in DIRS:
        print(f'  {d}: ' + json.dumps(
            {p: anchors[d][p] for p in ('idle', 'walk', 'cast', 'hurt')}))

    if failures:
        print(f'\n{len(failures)} VALIDATION FAILURE(S)')
        return 1
    print('\nALL VALIDATIONS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
