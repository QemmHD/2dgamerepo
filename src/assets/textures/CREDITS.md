# World Texture Attribution

Real photographic ground textures, downsized to small seamless tiles for the
world floor. These are **not** the game's own procedural art.

## ground_forest.png — world ground floor

- **Source:** Poly Haven — "Forest Ground 04"
- **URL:** https://polyhaven.com/a/forest_ground_04
- **Author:** Rob Tuytel (Poly Haven)
- **License:** **CC0 1.0** (public domain — no attribution required; credited here anyway)
- **Modifications:** downscaled the 1K seamless diffuse map to a 256×256 tile.
  Recolored per biome at runtime by the map's ground-fill / colour-grade
  overlay (so the one texture reads as forest dirt, frost, ash, or sand).

Procedural fallback: if this PNG fails to load, `MapRenderer` falls back to the
code-drawn ground tile, so the world always has a floor.
