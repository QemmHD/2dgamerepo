# Audio Attribution and Provenance

Real **CC0** one-shot samples used by the hybrid audio engine
(`src/systems/AudioSystem.js`). They are layered over the procedural synthesis
for the most tactile cues. The adaptive combat score and fanfares are original,
code-authored procedural compositions. One credited CC0 full-length menu track
is streamed as a one-shot feature; it has a procedural fallback.

## `music/menu/` — streamed feature

| File | Work / source | Author | License | Runtime treatment |
|---|---|---|---|---|
| `the_bards_tale.mp3` | [Medieval: The Bard's Tale](https://opengameart.org/content/medieval-the-bards-tale) ([direct MP3](https://opengameart.org/sites/default/files/The_Bards_Tale.mp3)) | RandomMind | CC0 1.0 | Original MP3 unchanged. The 2:38 full track is streamed lazily, played once, then the no-repeat tracker playlist resumes. It is not claimed to be the separate loop-version WAV and is never decoded to an AudioBuffer. |

## Original adaptive score

All tracker compositions in `src/content/music.js` — three menu works, two
works for each of four biomes, four boss suites, and the victory form — were
written for EMBERWAKE as original melody, harmony, rhythm, form, and orchestration
data. They render with the Web Audio synthesis toolkit in `AudioSystem.js` and
contain no external samples or imitated artist style.

## `voice/` — boss narration

These four short lines were generated specifically for EMBERWAKE with
**Higgsfield Audio** from original project-written text. They are used as lazy,
optional boss stingers with visible in-game boss/phase context; failed fetch or
decode never delays a fight. No real person or copyrighted character voice was
requested. Provenance is recorded here because Higgsfield's terms permit
commercial use but do not warrant output originality or non-infringement.

| File | Original line | Semantically allowed use |
|---|---|---|
| `dark_found_you.mp3` | “The dark found you.” | General boss-arrival fallback |
| `hollow_answers.mp3` | “The hollow answers.” | GloomMaw and Crypt/void bosses only |
| `warden_wakes.mp3` | “The warden wakes.” | Rimewarden only |
| `only_embers_remain.mp3` | “Only embers remain.” | Solnakh phase two only |

Tool: [Higgsfield Audio](https://higgsfield.ai/audio). Terms reviewed:
[Higgsfield Terms of Use](https://higgsfield.ai/terms-of-use-agreement), last
updated 2025-08-30 and reviewed 2026-07-13. Section 4.4 says Higgsfield does not
claim ownership of Inputs/Outputs or restrict commercial use of Outputs;
Section 12 disclaims originality, legality, fitness, and non-infringement
warranties. The project therefore records the original text, tool, constrained
semantic use, and fallback for every generated line instead of treating AI
provenance as a rights guarantee.

## `sfx/` — Kenney one-shots

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
