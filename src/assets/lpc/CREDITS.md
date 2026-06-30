# LPC Art Attribution

The enemy spritesheets in this folder are **Liberated Pixel Cup (LPC)** base
character bodies, taken from the **Universal LPC Spritesheet** collection. They
are **not** the game's own procedural art and carry their own licenses. They are
redistributed here under those licenses, with attribution as required.

Each asset below is multi-licensed; you may use it under **either** listed
license:

- **CC-BY-SA 3.0** — https://creativecommons.org/licenses/by-sa/3.0/
- **GPL 3.0** — https://www.gnu.org/licenses/gpl-3.0.html

Direct source (the repository these were downloaded from):
https://github.com/makrohn/Universal-LPC-spritesheet — an aggregation of the
LPC humanoid entries from lpc.opengameart.org, dual-licensed CC-BY-SA 3.0 / GPL
3.0 per the LPC rules.

All three files were produced the same way: the full 832×1344 LPC "universal"
body sheet was downloaded, and the four **walk-cycle rows** (up / left / down /
right) were cropped out into a compact 576×256 (9×4 cells of 64px) sheet. No
pixel art was hand-redrawn — only cropped, and (where noted) recolored at load.

---

## skeleton_walk.png  (models: `skeleton`, `emberskeleton`)

LPC **skeleton** body — walk cycle.

- **Authors:** Stephen Challener (Redshrike); Johannes Sjölund (wulax); Liberated Pixel Cup contributors
- **Licenses:** CC-BY-SA 3.0 / GPL 3.0
- **Source file:** `body/male/skeleton.png` from the repo above
- **Origin:** https://lpc.opengameart.org / https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles

The `emberskeleton` model is this same sheet recolored (orange multiply tint)
at runtime; the underlying art and attribution are identical.

## zombie_walk.png  (model: `zombie`)

LPC **human** body — walk cycle, recolored sickly green at load so it reads as a
rotting zombie.

- **Authors:** Stephen Challener (Redshrike); Liberated Pixel Cup contributors
- **Licenses:** CC-BY-SA 3.0 / GPL 3.0
- **Source file:** `body/male/light.png` from the repo above
- **Origin:** https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles

## orc_walk.png  (model: `orc`, used by the `brute` enemy)

LPC **orc** body — walk cycle.

- **Authors:** Stephen Challener (Redshrike); Liberated Pixel Cup contributors
- **Licenses:** CC-BY-SA 3.0 / GPL 3.0
- **Source file:** `body/male/orc.png` from the repo above
- **Origin:** https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles
