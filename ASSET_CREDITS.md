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
Used for the **skeleton**, **zombie**, and **ember-skeleton** (runtime recolor)
enemy models. From the Universal LPC Spritesheet Generator.

| File | Authors | License |
|---|---|---|
| `skeleton_walk.png` | bluecarrot16; Johannes Sjölund (wulax); Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| `zombie_walk.png` | Redshrike; wulax; castelonia; Benjamin K. Smith (BenCreating); bluecarrot16 | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |

Per-asset source URLs + notes: [`src/assets/lpc/CREDITS.md`](src/assets/lpc/CREDITS.md)
and [`src/assets/credits/assets.json`](src/assets/credits/assets.json).

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
