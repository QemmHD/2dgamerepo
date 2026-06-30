# Monster Sprite Attribution

Real animated creature sprites used to **update the game's original procedural
creature enemies** (slime, bat, crawler, spitter, mite). Not the game's own art.

## "[LPC] Monsters" — `src/assets/monsters/`

- **Source:** [\[LPC\] Monsters (OpenGameArt)](https://opengameart.org/content/lpc-monsters)
- **Authors:** Charles Sanchez (CharlesGabriel), bagzie, bluecarrot16
- **License:** **CC-BY-SA 3.0 / GPL 3.0** (attribution required — recorded here
  and in `ASSET_CREDITS.md`). Derived from the LPC base assets; the bat sprite
  is additionally OGA-BY 3.0.
- **Attribution text:** "[LPC] Monsters" by Charles Sanchez (CharlesGabriel),
  bagzie, and bluecarrot16. License: CC-BY-SA 3.0+ or GPL 3.0+.
  https://opengameart.org/content/lpc-monsters
- **Modifications:** sliced the front-facing (down) animation row from each
  64px sheet and upscaled it crisp to the sprite box.

| File | Enemy it updates |
|---|---|
| `slime.png` | slime |
| `bat.png` | bat |
| `snake.png` | crawler |
| `eyeball.png` | spitter |
| `bee.png` | mite |

Procedural fallback: if a sheet fails to load, `Enemy.js` falls back to the
original code-drawn sprite for that enemy.
