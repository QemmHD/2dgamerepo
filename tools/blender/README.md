# tools/blender — parametric Blender hero pipeline

Source of truth for the six Blender hero bodies and their pose-local cosmetic
anchors. The bodies are PARAMETRIC Blender models rendered to sheets — no AI
generation, fully deterministic and regenerable.

## Files

| file | role |
| --- | --- |
| `monkey_r2_free.py` | The winning "free hybrid" parametric monkey model (round-2 bake-off). Its settled parameters are its defaults. Kept as the design reference; `monkey_rig.py` carries the same geometry forward. |
| `monkey_rig.py` | The rigged asset: `build_monkey` (winner geometry + the tail fix — the curl sweeps diagonally back-right so it reads from front, side AND back), `build_armature` (rigid per-part bone parenting + a GRIP empty at the right paw), `author_poses` (one action, scene frames 1..9 in POSE_COLS order), camera/light solve, and `grip_cell_offset()` (GRIP → cell-px anchor projection). |
| `hero_params/*.json` | Committed palette/proportion deltas for elf, orc, wizard, berserker, and assassin. |
| `hero_presets.py` | Pure-Python preset resolver and guard for palette, parameter-name, arm/ground, and framing invariants. |
| `render_sheets.py` | One-command driver: renders all 27 frames, assembles the three sheets, validates the full contract numerically, and exports the selected hero's anchors. Exits non-zero if any check fails. |

## Environment

- Blender 5.1.x (`import bpy`). Each run
  starts a fresh session via `bpy.ops.wm.read_factory_settings(use_empty=True)`.
- Cycles CPU, low samples; PIL (Pillow) for sheet assembly/analysis.

## Regenerate a hero

```powershell
$env:HERO_NAME = 'elf' # monkey, elf, orc, wizard, berserker, assassin
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup --python-use-system-env `
  --python tools/blender/render_sheets.py
```

The five non-monkey names automatically resolve their committed
`hero_params/<name>.json` preset. `HERO_PARAMS` can point to an explicit JSON
delta for a new experimental name; missing files, unsafe output names, unknown
parameters, and contract-locked geometry changes fail before rendering.

Outputs:

- `raw/<hero>_down.png`, `raw/<hero>_up.png`, `raw/<hero>_side.png` —
  3× raw 2304×256 RGBA sheets (9 equal 256px cells per row).
- `anchors.json` for monkey or `<hero>_anchors.json` for a bespoke hero — the
  committed hand/head/shoulder export (see below).

## The sheet contract (validated by render_sheets.py)

- 3 sheets: `<hero>_down.png` (front), `<hero>_up.png` (back), and
  `<hero>_side.png` (profile facing +x/RIGHT — the game mirrors for left).
- Each: 1 row × 9 equal 256×256 columns, RGBA transparent, POSE_COLS order
  `[idle0, idle1(blink), walk0, walk1, walk2, cast, hurt, death, victory]`
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

## Pose-local attachment export

The GRIP empty (right paw), head seat, and shoulder line are projected for all
27 rendered frames. The legacy top-level hand arrays remain for idle, walk,
cast, and hurt across three directions. The parallel `attachments` tree covers
idle, walk, cast, hurt, death, and victory so hats, cloaks, and held items can
follow the evaluated Blender pose.
Offsets are measured from the 256-cell centre and scaled by 182/256 (in-game
`SPRITE_SIZE` = 182, spriteHalf = 91). y positive = DOWN (screen coords); each
direction's constant ground-alignment dy is already folded in.

```
{ down: { idle:[[x,y],[x,y]], walk:[[..]×3], cast:[[..]], hurt:[[..]] },
  up: {...}, side: {...},
  attachments: {
    down: { idle:[{headSeat:{left:[x,y],right:[x,y]},
                   shoulders:{left:[x,y],right:[x,y]}, handR:[x,y]}], ... },
    up: {...}, side: {...}
  },
  meta: { feetFrac, headFrac, bobPx, spriteSize, yDownPositive } }
```

All five committed variants keep the canonical arm and lower-body geometry.
Their legacy hand arrays and per-direction ground `dy` are therefore exactly
equal to monkey, while their head-seat and profile shoulder coordinates are
hero-specific. Note the `up` hand has negative x — the character faces away,
so its right paw is on screen-LEFT.

## Pixelate + install

The raw Cycles renders are pixelated into the game's chunky hi-bit look with
the deterministic pass (settings chosen for this asset — 96px logical detail,
32-colour palette, canonical dark outline):

```sh
node tools/artshot/pixelate-sheet.mjs tools/blender/raw/elf_down.png src/assets/hero/elf_down.png --cell=256 --logical=96 --colors=32 --outline=1
node tools/artshot/pixelate-sheet.mjs tools/blender/raw/elf_up.png   src/assets/hero/elf_up.png   --cell=256 --logical=96 --colors=32 --outline=1
node tools/artshot/pixelate-sheet.mjs tools/blender/raw/elf_side.png src/assets/hero/elf_side.png --cell=256 --logical=96 --colors=32 --outline=1
```

Then verify: headless screenshot via `tools/artshot/harness.html` with
`badge=1` must show `EXC: 0`, and `node tools/validate-assets.js` must exit 0.
If a model or pose changes, commit its regenerated anchor JSON and regenerate
the runtime pose data before approving the sprite sheets.
