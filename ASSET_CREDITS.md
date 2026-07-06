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

- **PNG size diet** — `node tools/compress-assets.mjs` (pngquant PNG-8
  quantization with an 85 quality floor + lossless optipng, smaller-only)
  runs over `src/assets/**/*.png` before shipping new art (~7.8 MB → ~3.1 MB
  across the set). Quantization is lossy in principle, so any batch touching
  the canonical enemy sheets must be visually diffed with the artshot
  harness (`showcase=1`) before merge; pre-diet originals live in git history.

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

### Basic creatures — `src/assets/enemies/`

| File | Source | Tool / Model | Notes |
| --- | --- | --- | --- |
| `src/assets/enemies/ember_warden_sheet.png` | Generated | higgsfield (Nano Banana 2 + Meshy image_to_3d) | EMBER WARDEN — animated 4-direction sheet (updates the `emberskeleton` enemy). Pipeline: Nano Banana 2 character concept → Meshy image-to-3D (textured + auto-rigged + Meshy animation-library clip) → rendered to a 4-row × 8-frame grid by `tools/artshot/glbsheet.html` (three.js, headless Chromium, transparent alpha). Row order up/left/down/right matches the LPC convention. |
| `src/assets/enemies/slime_anim.png` | Generated | higgsfield (Nano Banana 2) | Classic green gel slime, HQ-pixel-art 4-frame squash-and-stretch bounce cycle — the ORIGINAL creature identity (matches the LPC slime it falls back to), upgraded in detail and animated. Generated as one 2×2 pose grid (img2img from the original sprite as reference), sliced + shared-scale aligned by `tools/artshot/strip-frames.mjs`, bottom-anchored. |
| `src/assets/enemies/bat_anim.png` | Generated | higgsfield (Nano Banana 2) | Classic grey-brown cave bat, HQ-pixel 4-frame wing-flap cycle (raised → level → swept down → rising). Original identity/palette; 2×2 grid → strip-frames.mjs, center-anchored. |
| `src/assets/enemies/snake_anim.png` | Generated | higgsfield (Nano Banana 2) | Classic green snake, HQ-pixel 4-frame slither/strike sway (coiled → rising → jaws open → settling). Original identity/palette; 2×2 grid → strip-frames.mjs, bottom-anchored. |
| `src/assets/enemies/eyeball_anim.png` | Generated | higgsfield (Nano Banana 2) | Classic floating eyeball, HQ-pixel 4-frame hover-and-glare cycle (pupil small → widening → widest glare → relaxing). Original identity/palette; 2×2 grid → strip-frames.mjs with `--dropshadow=1` (removes a baked-in floor shadow), center-anchored. |
| `src/assets/enemies/bee_anim.png` | Generated | higgsfield (Nano Banana 2) | Classic bee/wasp mite, HQ-pixel 4-frame wing-flap bob (crisp pixel wings at four angles — regenerated once to eliminate motion-blur smudge wings). Original identity/palette; 2×2 grid → strip-frames.mjs, center-anchored. |
| `src/assets/hero/monkey_{down,up,side}.png` | Generated | Blender 5.0 (bpy) parametric model + Cycles | THE HERO BODY — the parametric chibi wick-keeper monkey (rigged/posed/rendered by the deterministic `tools/blender` pipeline: `python3 render_sheets.py` → `tools/artshot/pixelate-sheet.mjs --cell=256 --logical=96 --colors=32 --outline=1`), 7 frames per direction (idle×2 incl. blink, walk×3, cast, hurt), hands empty (the wand is a runtime layer). The grip-bone export (`anchors.json`) regenerates the `Player.js` HAND wand anchors bone-exactly. ALL six heroes render from this base via palette tint + code-drawn feature overlays (`HeroAiSprites.js`), so cosmetics/weapon-arm keep fitting; the procedural body remains the fallback. |

These load via `src/assets/EnemySprites.js` (preloaded at boot alongside the LPC
monster sheets) and slot into `Enemy.js`'s `FRAMES_BY_TYPE` as the preferred layer
above the imported-LPC → procedural fallbacks. Each creature is a single keyed
frame that rides the engine's own motion (idle breath, spawn-pop, hit squash,
status flashes). If an image is missing or still loading, `getEnemyAiFrames()`
returns null and the creature falls back to its imported-LPC sprite, then its
procedural drawer — so the swarm always renders.

### Held-weapon prop layers — `src/assets/weapons/<family>/`

The in-hand signature wands. Each **family** ships a three-layer tintable set
(`base.png` neutral geometry + 1px `#14101c` contour, `accent_mask.png` and
`glow_mask.png` 8-bit level maps) plus `anchors.json` (grip/tip in composited-
canvas px). `WeaponProps.compositeRenderedProp` recolours the masks per weapon
(accent / accent-dark / glow / glow-light / white hot-core) so one set serves
every weapon in the family at its own colours, cached per `(prop,accent,glow)`.

| File | Source | Author/Tool | Notes |
|------|--------|-------------|-------|
| `src/assets/weapons/staff/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | STAFF family — long shaft + forked ferrule + glowing orb. Flat-emission ID render (Standard view transform, film-transparent), PIL majority-vote downsample to 48×28, hard 0/255 alpha. |
| `src/assets/weapons/wand/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | WAND family — short wood rod + brass rings, a curling ember flame licking up-and-forward (accent = flame body, glow = flame heart + white hot-core). |
| `src/assets/weapons/rod/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | ROD family — metal rod + tuning-fork prongs; glow = forked lightning arc (bolts reach past the muzzle so the arc points at the target). |
| `src/assets/weapons/glaive/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | GLAIVE family — polearm with a broad crescent blade (accent), glowing cutting edge (glow); tip anchor at the forward blade point. |
| `src/assets/weapons/sigil/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | SIGIL family — holy ring + inner cross; ring centre punched transparent, thin glow cross bars over a white hot-core. |
| `src/assets/weapons/shard/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | SHARD family — faceted ice-crystal diamond with lit/shadow facet planes, an ice sheen band, trapped-light core + tip glint. |
| `src/assets/weapons/totem/{base,accent_mask,glow_mask}.png` | Generated | Blender (bpy) + Cycles palette-lock | TOTEM family — carved idol head with a recessed glowing mouth ember (mouth sits below the haft axis for a slight forward nod). |

These load via `src/assets/RenderedWeaponProps.js` (preloaded at boot in the
`main.js` Promise.all) and slot into `WeaponProps.getWeaponProp` as the preferred
tier above the procedural `buildProp` fallback. A missing/failed family (or a
headless/no-DOM env) drops to `null` and the weapon falls back to `buildProp`, so
the hand prop always renders.

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

### Gear-category emblems (Loadout / gear grid)

| File | Source | Tool / Model | Notes |
| --- | --- | --- | --- |
| `src/assets/ui/gear/weapon.png` | Generated | higgsfield (Nano Banana 2) | Starting-weapon emblem — two crossed ember **wands**, matching the game's wand-based combat. Background keyed transparent + trimmed to 256px. |
| `src/assets/ui/gear/armor.png` | Generated | higgsfield (Nano Banana 2) | Armor emblem — a lion-crest ember pauldron. Keyed transparent + trimmed. |
| `src/assets/ui/gear/trinket.png` | Generated | higgsfield (Nano Banana 2) | Trinket emblem — an ember filigree medallion. Keyed transparent + trimmed. |
| `src/assets/ui/gear/charm.png` | Generated | higgsfield (Nano Banana 2) | Charm emblem — a runed ember talisman. Keyed transparent + trimmed. |

These load lazily via `src/assets/GearEmblems.js` and draw as the item icon per
gear category in `MenuRenderer._drawItemGrid`; each falls back to the
rarity-recolored `shield` glyph until its image loads (and in a non-DOM env), so
rarity still reads via the card border + status colour.

The main-menu **display font** (Cinzel, OFL 1.1) used for the wordmark / tab
labels / button labels is registered in `src/assets/credits/assets.json` and
loaded via `src/assets/MenuFont.js`; canvas headings fall back to the system sans
until it loads.

### World overhaul — ground tile, buildings, obstacles & decor props

| File | Source | Tool / Model | Notes |
| --- | --- | --- | --- |
| `src/assets/textures/ground_emberwood.png` | Generated | higgsfield (Nano Banana 2) | Seamless hi-bit pixel forest-floor tile (moss/earth/ember specks), seam-blended via `tools/artshot/seamfix.html`, 512px. Primary ground; falls back to the CC0 photo tile, then procedural. |
| `src/assets/obstacles/tree.png` | Generated | higgsfield (Nano Banana 2) | Gnarled ember-leaf tree, keyed + fitted to the archetype box (gridcut). Procedural fallback in `Obstacle.js`. |
| `src/assets/obstacles/broken_tower.png` | Generated | higgsfield (Nano Banana 2) | Crumbling watchtower with ember-lit window. |
| `src/assets/obstacles/statue.png` | Generated | higgsfield (Nano Banana 2) | Weathered monkey-sage statue holding a wand. |
| `src/assets/obstacles/pillar.png` | Generated | higgsfield (Nano Banana 2) | Broken fluted stone pillar. |
| `src/assets/obstacles/well.png` | Generated | higgsfield (Nano Banana 2) | Stone well with crossbeam, bucket + ember lantern. |
| `src/assets/obstacles/ruined_wall.png` | Generated | higgsfield (Nano Banana 2) | Ruined wall fragment with glowing rune. |
| `src/assets/obstacles/barricade.png` | Generated | higgsfield (Nano Banana 2) | Wooden spike barricade. |
| `src/assets/obstacles/fence.png` | Generated | higgsfield (Nano Banana 2) | Rustic wooden fence segment. |
| `src/assets/obstacles/crate.png` | Generated | higgsfield (Nano Banana 2) | Iron-braced supply crate with rope coil. |
| `src/assets/obstacles/barrel.png` | Generated | higgsfield (Nano Banana 2) | Iron-hooped barrel with ember rune brand. |
| `src/assets/obstacles/stone_block.png` | Generated | higgsfield (Nano Banana 2) | Mossy stone boulder block. |
| `src/assets/obstacles/grave_marker.png` | Generated | higgsfield (Nano Banana 2) | Weathered grave marker with mushrooms. |
| `src/assets/obstacles/cactus.png` | Generated | higgsfield (Nano Banana 2) | Two-armed desert cactus (dunes biome). |
| `src/assets/obstacles/wall_cabin.png` | Generated | higgsfield (Nano Banana 2) | Seamless timber-log wall texture (cabin), used as a repeating pattern on building wall segments. |
| `src/assets/obstacles/wall_ruin.png` | Generated | higgsfield (Nano Banana 2) | Seamless cracked-stone wall texture (ruin). |
| `src/assets/obstacles/wall_keep.png` | Generated | higgsfield (Nano Banana 2) | Seamless ashlar-brick wall texture (keep). |
| `src/assets/obstacles/wall_adobe.png` | Generated | higgsfield (Nano Banana 2) | Seamless adobe-clay wall texture. |
| `src/assets/obstacles/floor_cabin.png` | Generated | higgsfield (Nano Banana 2) | Cabin interior floor decal (planks, rug, hearth). |
| `src/assets/obstacles/floor_ruin.png` | Generated | higgsfield (Nano Banana 2) | Ruin interior floor decal (cracked tiles, moss). |
| `src/assets/obstacles/floor_keep.png` | Generated | higgsfield (Nano Banana 2) | Keep interior floor decal (flagstone, carpet, brazier). |
| `src/assets/obstacles/floor_adobe.png` | Generated | higgsfield (Nano Banana 2) | Adobe interior floor decal (terracotta, mat, pots). |
| `src/assets/decor/rock.png` | Generated | higgsfield (Nano Banana 2) | Tiny scatter prop, baked at the procedural authoring size ×2 (`DecorSprites.js`). Procedural fallback kept. |
| `src/assets/decor/mushroom.png` | Generated | higgsfield (Nano Banana 2) | Red-capped mushroom scatter prop. |
| `src/assets/decor/skull.png` | Generated | higgsfield (Nano Banana 2) | Horned skull scatter prop. |
| `src/assets/decor/grass.png` | Generated | higgsfield (Nano Banana 2) | Flat dry-grass tuft scatter prop. |
| `src/assets/decor/candle.png` | Generated | higgsfield (Nano Banana 2) | Lit candle scatter prop (flame in the top band for the light anchor). |
| `src/assets/decor/ruin.png` | Generated | higgsfield (Nano Banana 2) | Broken stone posts scatter prop. |
| `src/assets/decor/branch.png` | Generated | higgsfield (Nano Banana 2) | Fallen twig scatter prop (flat). |
| `src/assets/decor/cracked_stone.png` | Generated | higgsfield (Nano Banana 2) | Flat cracked slab scatter prop. |
| `src/assets/decor/bones.png` | Generated | higgsfield (Nano Banana 2) | Bone scatter prop (flat). |
| `src/assets/obstacles/border_palisade.png` | Generated | higgsfield (Nano Banana 2) | World-border stockade strip (horizontally seam-blended via `tools/artshot/borderprep.html`); drawn as a palisade ring just outside the playable rect by `Game._drawWorldBounds`, replacing the dashed boundary line. Dashed rect remains the fallback. |

All world sprites load via never-rejecting loaders (`ObstacleSprites.js`,
`DecorSprites.js`, `WorldTextures.js`); every consumer keeps its procedural
drawing as the fallback, so a missing file can never break the game.

### Special/support enemy roster — animated sheets

| File | Source | Tool / Model | Notes |
| --- | --- | --- | --- |
| `src/assets/enemies/charger_anim.png` | Generated | higgsfield (Nano Banana 2) | Charging boar, 4-pose cycle (2×2 grid img2img from the procedural sprite, identity + palette locked; sliced via `strip-frames.mjs --anchor=bottom`). Procedural fallback kept. |
| `src/assets/enemies/juggernaut_anim.png` | Generated | higgsfield (Nano Banana 2) | Armored slate behemoth, slow breath/step cycle. |
| `src/assets/enemies/healer_anim.png` | Generated | higgsfield (Nano Banana 2) | Green-robed healer monk, chant/pray cycle. |
| `src/assets/enemies/shielder_anim.png` | Generated | higgsfield (Nano Banana 2) | Hex-shield orb, brace/glint cycle. |
| `src/assets/enemies/speed_demon_anim.png` | Generated | higgsfield (Nano Banana 2) | Dart-imp speedster, quill-angle flutter (no motion blur). |
| `src/assets/enemies/dreadhulk_anim.png` | Generated | higgsfield (Nano Banana 2) | Dark slate hulk with ice-blue markings, ponderous cycle. |
| `src/assets/enemies/brawler_anim.png` | Generated | higgsfield (Nano Banana 2) | Ape bruiser, fists/punch/slam cycle. |
