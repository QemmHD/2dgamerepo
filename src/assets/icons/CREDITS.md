# Icon Attribution

UI glyphs used on menu cards (recolored by rarity / element through the same
recolor pipeline as everything else). These are **not** the game's own
procedural art.

## game-icons.net glyphs — `src/assets/icons/`

- **Source:** [game-icons.net](https://game-icons.net/)
- **Author:** **Lorc**
- **License:** **CC-BY 3.0** — https://creativecommons.org/licenses/by/3.0/
  (attribution required — recorded here and in `ASSET_CREDITS.md`)
- **Modifications:** rasterized the original SVGs to 128px white-on-transparent
  PNGs (the opaque background rect was stripped), then recolored by rarity at
  load and cached.

| File | baseId | Original icon |
|---|---|---|
| `shield.png` | shield | "Edged Shield" |
| `spark.png` | spark | "Star Swirl" |
| `fire.png` | fire | "Fireball" |
| `lightning.png` | lightning | "Lightning Trio" |
| `frost.png` | frost | "Snowflake 2" |
| `skull.png` | skull | "Skull Crack" |
| `swords.png` | swords | "Crossed Swords" |
| `staff.png` | staff | "Wizard Staff" |

Procedural fallback: if a PNG fails to load, `CustomIcons` falls back to its
code-drawn glyph for that baseId, so cards always show an icon.
