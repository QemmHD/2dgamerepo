# Boss Sprite Attribution

Real creature sprites used as the **boss models** (one base creature per boss,
recolored to its theme). Not the game's own art.

## "[LPC] Monsters" — `src/assets/bosses/`

- **Source:** [\[LPC\] Monsters (OpenGameArt)](https://opengameart.org/content/lpc-monsters)
- **Authors:** Charles Sanchez (CharlesGabriel), bagzie, bluecarrot16
- **License:** **CC-BY-SA 3.0 / GPL 3.0** (attribution required — recorded here
  and in `ASSET_CREDITS.md`). Derived from the LPC base assets.
- **Attribution text:** "[LPC] Monsters" by Charles Sanchez (CharlesGabriel),
  bagzie, and bluecarrot16. License: CC-BY-SA 3.0+ or GPL 3.0+.
  https://opengameart.org/content/lpc-monsters
- **Modifications:** sliced an animation row from each sheet, upscaled to the
  sprite box, and recolored per boss theme.

| File | Bosses (recolor) |
|---|---|
| `man_eater_flower.png` | Vinebackgoliath |
| `ghost.png` | Mourndrift, Rimewarden (ice), Aurorath (gold) |
| `pumpking.png` | Gloommaw (violet), Cindermaw (ember) |
| `big_worm.png` | Hoarfang (frost), Dunescourge (sand) |
| `eyeball.png` | Nihagault (void) |
| `bat.png` | Stormwingalpha (storm) |

The bone bosses (**Ossuar**, **Solnakh** recolored fire) reuse the imported LPC
skeleton body (see `../lpc/CREDITS.md`).

Procedural fallback: if a sheet fails to load, `Enemy.js` falls back to the
original code-drawn boss sprite.
