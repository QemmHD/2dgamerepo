# Asset Credits

EMBERWAKE's art is **mostly procedural** (drawn in code at runtime — no license,
no files). The few **external assets** used directly are listed here with full
attribution, and machine-readably in [`src/assets/credits/assets.json`](src/assets/credits/assets.json)
(validated by `node tools/validate-assets.js`).

## Asset-source policy

- Use an asset **directly** only when its license clearly allows it.
- Prefer **CC0 / public domain**. **CC-BY / CC-BY-SA / OGA-BY / GPL** are okay
  **only with attribution recorded here**.
- If a license is unclear → **reference only**, never shipped.
- No ripped, copyrighted-game, fan-rip, or unclear-license assets.

Approved sources to draw from (license-check each asset): Universal LPC Sprite
Generator, OpenGameArt, Kenney, itch.io (CC0/CC-BY packs), Game-icons.net,
Piskel/Pixelorama-authored sprites, Lospec palettes, Tiled tilesets, Poly Haven
(CC0) textures (downsized to 2D).

## External assets in the build

### LPC enemy spritesheets — `src/assets/lpc/`
Real **Liberated Pixel Cup** base character bodies, used for the **skeleton**,
**ember-skeleton** (runtime orange recolor), **zombie** (LPC human body recolored
green), and **brute** (LPC orc) enemy models. Downloaded from the Universal LPC
Spritesheet collection ([makrohn/Universal-LPC-spritesheet](https://github.com/makrohn/Universal-LPC-spritesheet)),
then cropped to their walk-cycle rows.

| File | Source body | Authors | License |
|---|---|---|---|
| `skeleton_walk.png` | LPC skeleton | Stephen Challener (Redshrike); Johannes Sjölund (wulax); LPC contributors | CC-BY-SA 3.0 / GPL 3.0 |
| `zombie_walk.png` | LPC human (recolored) | Stephen Challener (Redshrike); LPC contributors | CC-BY-SA 3.0 / GPL 3.0 |
| `orc_walk.png` | LPC orc | Stephen Challener (Redshrike); LPC contributors | CC-BY-SA 3.0 / GPL 3.0 |

Per-asset source URLs + notes: [`src/assets/lpc/CREDITS.md`](src/assets/lpc/CREDITS.md)
and [`src/assets/credits/assets.json`](src/assets/credits/assets.json).

### World ground texture — `src/assets/textures/`
Real CC0 photographic ground texture, downsized to a seamless 256×256 tile and
recolored per biome by the map theme. Procedural ground tile is the fallback.

| File | Source | Author | License |
|---|---|---|---|
| `ground_forest.png` | [Poly Haven — Forest Ground 04](https://polyhaven.com/a/forest_ground_04) | Rob Tuytel (Poly Haven) | CC0 1.0 |

Per-asset notes: [`src/assets/textures/CREDITS.md`](src/assets/textures/CREDITS.md).

## Customization pipeline

External and procedural assets flow through a shared customization system:

- **Metadata registry** — `src/assets/assetRegistry.js` (source, license,
  attribution, frame layout, palette slots, compatibility, tags).
- **Recolor / tint** — `src/render/recolor.js` (cached palette/tint variants;
  never recolored per frame).
- **Working examples** — imported LPC enemy models (`src/assets/LpcSprites.js`,
  directional walk + recolor variant) and customizable rarity-recolored icons
  (`src/assets/CustomIcons.js`).
- **Validator** — `tools/validate-assets.js` fails if any external asset lacks
  license / attribution / source, or references a missing/oversized file.

Procedural fallback is always kept: if an imported asset fails to load, the
game falls back to its code-drawn sprite.
