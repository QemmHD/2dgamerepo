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

### Monster sprites — `src/assets/monsters/`
Real animated creature sprites that **update the original procedural creatures**
(slime, bat, crawler→snake, spitter→eyeball, mite→bee). Procedural art is the
fallback.

| Files | Source | Authors | License |
|---|---|---|---|
| `slime/bat/snake/eyeball/bee.png` | [\[LPC\] Monsters](https://opengameart.org/content/lpc-monsters) | Charles Sanchez (CharlesGabriel), bagzie, bluecarrot16 | CC-BY-SA 3.0 / GPL 3.0 |

Per-asset notes: [`src/assets/monsters/CREDITS.md`](src/assets/monsters/CREDITS.md).

### World ground texture — `src/assets/textures/`
Real CC0 photographic ground texture, downsized to a seamless 256×256 tile and
recolored per biome by the map theme. Procedural ground tile is the fallback.

| File | Source | Author | License |
|---|---|---|---|
| `ground_forest.png` | [Poly Haven — Forest Ground 04](https://polyhaven.com/a/forest_ground_04) | Rob Tuytel (Poly Haven) | CC0 1.0 |

Per-asset notes: [`src/assets/textures/CREDITS.md`](src/assets/textures/CREDITS.md).

### UI icon glyphs — `src/assets/icons/`
Real game-icons.net glyphs, rasterized to white-on-transparent PNGs and
recolored by rarity/element on menu cards. Procedural glyph is the fallback.

| Files | Source | Author | License |
|---|---|---|---|
| `shield/spark/fire/lightning/frost/skull/swords/staff.png` | [game-icons.net](https://game-icons.net/) | Lorc | CC-BY 3.0 |

Per-asset notes: [`src/assets/icons/CREDITS.md`](src/assets/icons/CREDITS.md).

### SFX one-shots — `src/assets/audio/sfx/`
Real **CC0** one-shot samples layered over the procedural audio engine for the
most tactile cues (a punch on kill/hurt, coin/purchase handling, a metal
equip/latch, UI click/hover, gem ping, reroll scratch). Music and all fanfares
stay **fully procedural**; if a sample isn't loaded the cue falls back to its
synthesized voice, so audio never goes silent. All from **Kenney.nl** (CC0 1.0,
attribution appreciated but not required), copied unchanged and pitch-jittered /
gain-trimmed at runtime.

| Files | Source | Author | License |
|---|---|---|---|
| `impactPunch_{medium,heavy}_*.ogg` | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney (Kenney.nl) | CC0 1.0 |
| `handleCoins*.ogg`, `handleSmallLeather*.ogg`, `metalClick.ogg`, `metalLatch.ogg` | [Kenney — RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney (Kenney.nl) | CC0 1.0 |
| `click_*.ogg`, `tick_*.ogg`, `glass_*.ogg`, `scratch_*.ogg` | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (Kenney.nl) | CC0 1.0 |

Per-asset notes: [`src/assets/audio/CREDITS.md`](src/assets/audio/CREDITS.md).

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

## AI-generated sprites

| File | Source | Tool / Model | Notes |
| --- | --- | --- | --- |
| `src/assets/enemies/lieutenant.png` | Generated | higgsfield (Nano Banana) | LIEUTENANT mini-boss — idle pose. Background keyed to transparent; downscaled to a game sprite. |
| `src/assets/enemies/lieutenant_attack.png` | Generated | higgsfield (Nano Banana) | LIEUTENANT — attack pose (axe raised), generated on-model from the idle reference. |
| `src/assets/enemies/lieutenant_hurt.png` | Generated | higgsfield (Nano Banana) | LIEUTENANT — hurt/recoil pose, generated on-model from the idle reference. |

The Lieutenant renders through the engine's normal enemy path (`Enemy.draw` picks
the pose by live state, riding the procedural squash/breath/flash), and falls back
to a procedural heavy-hitter sprite if the images fail to load (see
`src/assets/LieutenantSprite.js`).

## AI-generated UI art (main menu)

| File | Source | Tool / Model | Notes |
| --- | --- | --- | --- |
| `src/assets/ui/menu_bg.jpg` | Generated | higgsfield (Nano Banana 2) | Main-menu ember-forge backdrop — a ruined ashen citadel over molten lava with god-rays and drifting sparks. Cover-fit behind the whole menu; downscaled + JPEG-compressed. |
| `src/assets/ui/title_emberwake.png` | Generated | higgsfield (Nano Banana 2) | EMBERWAKE title wordmark, molten ember lettering. Background keyed to transparent (edge flood-fill) + trimmed. |
| `src/assets/ui/bp_crest.png` | Generated | higgsfield (Nano Banana 2) | Ornate ember-forged crest crowning the Battle Pass track. Background keyed to transparent + trimmed. |
| `src/assets/ui/corner_bracket.png` | Generated | higgsfield (Nano Banana 2) | Ornate wrought-iron corner bracket with a glowing molten seam. Keyed transparent; drawn (mirrored) at the four corners of large panels via `_panel`/`_forgeCorners`. |
| `src/assets/ui/btn_plate.png` | Generated | higgsfield (Nano Banana 2) | Neutral forged-metal button plate (bevel + rivets + copper rim). Keyed transparent; overlaid additively on button fills and the active tab so each element's accent colour still reads. |

These load lazily via `src/assets/MenuImages.js`; every consumer in
`MenuRenderer.js` falls back to the existing procedural drawing (cached
ember-forge gradient backdrop, gradient-text title, plain Battle Pass header,
procedural corner ticks + flat button/tab fills) if an image is missing or still
loading, so the menu renders correctly without them.
