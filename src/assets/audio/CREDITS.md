# SFX Sample Attribution

Real **CC0** one-shot samples used by the hybrid audio engine
(`src/systems/AudioSystem.js`). They are layered over the procedural synthesis
for the most tactile cues; **music and all fanfares are 100% procedural**, and
every sampled cue falls back to its synthesized voice if the sample isn't
loaded — so audio never goes silent (headless render, fetch failure, or a cue we
deliberately keep procedural).

All samples are by **Kenney (kenney.nl)** under **CC0 1.0** (public domain — no
attribution required; credited here anyway). Files were copied **unchanged**; the
engine picks a random variant per hit and applies a small pitch-jitter + gain
trim at runtime so rapid repeats don't sound machine-gunned.

## `sfx/` — files in the build

| Cue | Files | Kenney pack |
|---|---|---|
| enemy kill | `impactPunch_medium_000.ogg`, `impactPunch_medium_001.ogg`, `impactPunch_medium_003.ogg` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) |
| player hurt | `impactPunch_heavy_000.ogg`, `impactPunch_heavy_002.ogg` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) |
| coin pickup | `handleCoins.ogg`, `handleCoins2.ogg` | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| shop purchase | `handleSmallLeather.ogg`, `handleSmallLeather2.ogg` | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| weapon equip | `metalClick.ogg` | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| chest open | `metalLatch.ogg` | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| UI click | `click_001.ogg`, `click_002.ogg` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) |
| UI hover | `tick_001.ogg`, `tick_002.ogg` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) |
| XP gem | `glass_001.ogg`, `glass_003.ogg`, `glass_005.ogg` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) |
| level-up reroll | `scratch_001.ogg`, `scratch_003.ogg` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) |

License text ships with each Kenney pack; machine-readable registry:
[`src/assets/credits/assets.json`](../credits/assets.json)
(validated by `node tools/validate-assets.js`).
