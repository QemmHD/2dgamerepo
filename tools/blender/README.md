# tools/blender — parametric Blender hero pipeline

Source of truth for the hero (monkey) sprite sheets in `src/assets/hero/`.
The hero is a PARAMETRIC Blender model rendered to sheets — no AI generation,
fully deterministic and regenerable.

## Files

| file | role |
| --- | --- |
| `monkey_r2_free.py` | The winning "free hybrid" parametric monkey model (round-2 bake-off). Its settled parameters are its defaults. Kept as the design reference; `monkey_rig.py` carries the same geometry forward. |
| `monkey_rig.py` | The rigged asset: `build_monkey` (winner geometry + the tail fix — the curl sweeps diagonally back-right so it reads from front, side AND back), `build_armature` (rigid per-part bone parenting + a GRIP empty at the right paw), `author_poses` (one action, scene frames 1..7 in POSE_COLS order), camera/light solve, and `grip_cell_offset()` (GRIP → cell-px anchor projection). |
| `render_sheets.py` | One-command driver: renders all 21 frames, assembles the three sheets, validates the full contract numerically, and exports `anchors.json`. Exits non-zero if any check fails. |

## Environment

- Blender as a Python module: `import bpy` (bpy 5.0.x on python3). Each run
  starts a fresh session via `bpy.ops.wm.read_factory_settings(use_empty=True)`.
- Cycles CPU, low samples; PIL (Pillow) for sheet assembly/analysis.

## Regenerate everything (one command)

```sh
cd tools/blender
python3 render_sheets.py     # ~21 Cycles CPU renders; exits 0 only if ALL contract checks pass
```

Outputs (not committed — regenerate on demand):

- `raw/monkey_down.png`, `raw/monkey_up.png`, `raw/monkey_side.png` —
  3× raw 1792×256 RGBA sheets (7 equal 256px cells per row).
- `anchors.json` — the hand-bone anchor export (see below).

## The sheet contract (validated by render_sheets.py)

- 3 sheets: `monkey_down.png` (front), `monkey_up.png` (back),
  `monkey_side.png` (profile facing +x/RIGHT — the game mirrors for left).
- Each: 1 row × 7 equal 256×256 columns, RGBA transparent, POSE_COLS order
  `[idle0, idle1(blink), walk0, walk1, walk2, cast, hurt]`
  (`src/assets/HeroAiSprites.js`).
- Anchors (48-grid): centred x; head centre 16/48 (33%) down the cell; feet
  45/48 (94%). Framing is solved ONCE (12°-pitch ortho camera; directions by
  yawing the CHARACTER, camera+lights fixed) so frames never jitter, and every
  sheet is lit from screen-upper-left.
- BAKED BOB: `HERO_BOB` (`src/assets/PixelArt.js`) walk = `[0, -2, 0]` —
  ONLY walk frame 1 is raised, exactly 2/48 of the cell (~10.7px at 256); all
  other frames stay flat-footed on the same ground line. Cosmetic hats/cloaks
  compensate with this exact table, so bake it precisely and add NO other
  vertical translation.
- HANDS EMPTY — no wand, no cosmetics; the wand is a runtime layer.
- `cast` must never alias `idle` (the menu flashes cast periodically).

## Anchor export (anchors.json → Player.js HAND)

For every direction × pose × frame (21 total) the GRIP empty (right paw) is
projected through the render camera to pixel coords, converted to offsets from
the 256-cell centre, and scaled by 182/256 (in-game `SPRITE_SIZE` = 182,
spriteHalf = 91). y positive = DOWN (screen coords); each direction's constant
ground-alignment dy is already folded in.

```
{ down: { idle:[[x,y],[x,y]], walk:[[..]×3], cast:[[..]], hurt:[[..]] },
  up: {...}, side: {...},
  meta: { feetFrac, headFrac, bobPx, spriteSize, yDownPositive } }
```

These values are pasted verbatim into the `HAND` table in
`src/entities/Player.js` (and the down-facing rest/cast pair is mirrored in
`src/systems/MenuRenderer.js`'s loadout preview). Note the `up` direction has
negative x — the character faces away, so its right paw is on screen-LEFT.

## Pixelate + install

The raw Cycles renders are pixelated into the game's chunky hi-bit look with
the deterministic pass (settings chosen for this asset — 96px logical detail,
32-colour palette, canonical dark outline):

```sh
node tools/artshot/pixelate-sheet.mjs tools/blender/raw/monkey_down.png src/assets/hero/monkey_down.png --cell=256 --logical=96 --colors=32 --outline=1
node tools/artshot/pixelate-sheet.mjs tools/blender/raw/monkey_up.png   src/assets/hero/monkey_up.png   --cell=256 --logical=96 --colors=32 --outline=1
node tools/artshot/pixelate-sheet.mjs tools/blender/raw/monkey_side.png src/assets/hero/monkey_side.png --cell=256 --logical=96 --colors=32 --outline=1
```

Then verify: headless screenshot via `tools/artshot/harness.html` with
`badge=1` must show `EXC: 0`, and `node tools/validate-assets.js` must exit 0.
If the model or poses changed, re-paste the fresh `anchors.json` values into
`Player.js` `HAND` and the `MenuRenderer.js` copies.
