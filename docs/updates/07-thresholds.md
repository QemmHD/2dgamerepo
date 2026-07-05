# Update #7: THRESHOLDS — Rites of the Twelve

*Era III — The World Alight*

**Value verdict (IMPROVES):** By its own admission zero new combat mechanics — this is presentation and persistence for fights #4 already reforged, so it cannot be ADDS. But it targets a genuinely weak surface (boss arrival today is an HP bar plus banner), and 12 boss themes, staged arrivals, and permanent kill monuments pass the removal test decisively — players would absolutely notice. Its value is hostage to #4 shipping well; sequenced after BOSSFORGE it earns its slot. Kill monuments are the one novel-persistence bit that keeps it from being pure polish.

## What it adds

Boss arrivals stop being an HP bar with a banner and become staged world events: twelve standing stones physically erupt from the ground around the fight, the sky and darkness veil shift to that boss's signature weather, its own musical theme slams in (one of 12 retunes) and stings on the phase-2 flip, and every apex you fell leaves a permanent, growing monument in the world. It is the presentation/ritual layer that makes BOSSFORGE's mechanical kits FEEL like the twelve legendary duels the fiction claims they are — pure spectacle and persistence, zero new combat mechanics.

## Design spec

# THRESHOLDS — Rites of the Twelve: Implementation Spec

## 0. Verified foundation (what exists today)

- **The soft arena already exists.** `Game._spawnBoss` seals a circular arena `{x, y, r: BOSS.arenaRadius}` centered on the player (Game.js:1989, `BOSS.arenaRadius: 1120` GameConfig.js:741), confines player (Game.js:2764) and boss (Game.js:2883-2884) via `_confineToArena` (Game.js:1866), draws it as a pulsing dashed energy ring (Game.js:3417-3439), lifts it on boss death (Game.js:3072) with a safety net if the boss dies by other means (Game.js:3270). THRESHOLDS keeps this soft wall as the real confinement and raises **physical theater** on it.
- **The boss warning window** is `_startBossWarning(id)` (Game.js:2052-2059): sets `this.bossWarning = { id, name, epithet, tier, timer, total }` with `BOSS.warningDuration: 3.0` (GameConfig.js:720); ticked at Game.js:2702-2709, spawning via `_spawnBoss(id)` on expiry. This 3.0s window is exactly our raise ceremony.
- **musicDuck sidechain: VERIFIED.** `this.musicDuck` gain node (AudioSystem.js:124, wired 191-193); every music voice routes through it; `_duck(amount, hold, recover)` (AudioSystem.js:529-539) dips the whole bed. Big cues (`reveal`, `bossSpawn`, `enrage`, `levelUp`) already sidechain through it.
- **BIOME_TUNE shallow-merge: VERIFIED but relocated.** It lives in **AudioSystem.js:87-92**, not GameConfig (correction noted). `setBiome(id)` latches, `_applyBiome()` does `THEMES.gameplay = { ...GAMEPLAY_BASE, ...tune }` (AudioSystem.js:301-305). All 12 boss retunes copy this exact pattern onto the single shared `THEMES.boss` (AudioSystem.js:65-73).
- **The phase-2 flip is currently SILENT.** `phase2Entered` latches in the boss AI (Enemy.js:1150-1151); Game fires announce + shake + ring once (Game.js:3240-3245) — but **no audio cue plays there**. `audio.enrage()` only fires at the separate 25%-HP threshold (Game.js:2174). The phase-2 stinger fills a real, verified hole.
- **Weather** is a stateless screen-space mote layer, `MapRenderer.drawWeather` (MapRenderer.js:252-299), keyed off `this.theme.weather` (`'embers'|'snow'`, maps.js:11), called from Game.render (Game.js:3580-3584), skipped under `lowQuality`.
- **The veil** is LightingSystem: strength = `GFX.darkness.strength (0.56) × biome.darkness` (set at Game.js:864-866 and by the FPS governor at Game.js:3835-3838), hard-capped at `STRENGTH_CAP 0.62` (LightingSystem.js:29). The gradient is cached keyed **only on strength** (LightingSystem.js:70-87) with a fixed color `GFX.darkness.color '#05070c'` (GameConfig.js:1389-1394) — per-boss veil tinting requires extending that cache key.
- **ObstacleSystem runtime insertion: viable, but the API does not exist yet.** `generate()` is the only builder (ObstacleSystem.js:89-149); the spatial grid is fully rebuilt by `_buildGrid()` (ObstacleSystem.js:275-294) over ≤ `MAX_OBSTACLES 240` (ObstacleSystem.js:24) entries — a full rebuild costs microseconds, so insert/remove at boss cadence (~every 160s, `BOSS.spawnInterval` GameConfig.js:681) is trivially cheap. Note `segmentBlocked` ignores `blocksLOS` (ObstacleSystem.js:436-443): any solid runtime stone eats projectiles — we exploit this deliberately (stones = cover).
- **The Twelve:** exactly 12 apex bosses exist, 3 per map (GameConfig.js:379-663; rosters maps.js:39/59/79/99): Vesperwing, Gravemaw, Cacklemaw (emberwood); Hoarfang, Rimewarden, Aurorath (hollowreach); Mourndrift, Ossuar, Nihagault (crypts); Cindermaw, Dunescourge, Solnakh (dunes).
- **Save pattern:** SaveSystem `_validate` uses implicit defaults + clamping per key (e.g. dailyRoad block, SaveSystem.js:296-305), version 7 — additive keys need no version bump.

## 1. Feature A — The Ring of the Rite (arena-raise)

### Geometry
On `_startBossWarning`, compute 12 stone sites on the existing arena circle: center = player position at warning start (matching what `_spawnBoss` will use — we now compute the arena center once at warning start, stash it in `this.bossWarning.arenaX/Y`, and have `_spawnBoss` reuse it so stones and arena agree even if the player runs during the warning; the player is then pulled to the sealed circle exactly as today). Radius `RITE.ringRadius = BOSS.arenaRadius (1120)` (tunable). 12 stones at `angle0 + k·(2π/12)`, `angle0` random per fight. Circumference 2π·1120 ≈ 7037px → ~586px spacing between stone centers vs stone collision diameter 68px — the ring stays highly permeable; the SOFT arena remains the actual wall, stones are theater + cover.

New archetype in `src/content/mapObjects.js` `MAP_OBJECTS` (pattern: mapObjects.js:20-60):
```js
riteStone: {
  type: 'riteStone', shape: 'circle', col: { r: 34 }, size: { w: 96, h: 210 },
  blocksLOS: false,   // enemies still see/aim; movement + projectiles DO collide
  weight: 0,          // never in the random prop pool
  palette: { base: '#3c3744', top: '#544e5e', edge: '#242028' },
}
```
Each placed stone gets `ob.emberColor` from the boss's rite (per-boss accent, e.g. `#aef0ff` for Hoarfang) driving the rune glow + flame light.

### Runtime insertion API (NEW, ObstacleSystem.js)
```js
insertRuntime(defs /* [{def, x, y, props}] */, tag)  // push tagged Obstacles, re-sort baseY, _buildGrid()
removeRuntimeByTag(tag)                              // filter obstacles, _buildGrid()
```
- Tagged obstacles (`ob.runtimeTag = 'rite'`) are **exempt from MAX_OBSTACLES** (that cap only bounds `generate()`'s placement loop, ObstacleSystem.js:120); the runtime set is bounded by design (12 stones + ≤3 monuments ≤ 15 → worst case 255 total, grid rebuild still trivial).
- Placement validation per stone: skip a site if `isBlocked(x, y, 40)` (ObstacleSystem.js:379) — a stone colliding with a building wall simply doesn't rise (11-stone rings are fine; fiction: "one seat stands empty").
- Player/enemy overlap self-heals: the per-frame `resolveCircle` passes (player Game.js:2760, enemies Game.js:2810+/2883) push anyone out within 1-2 frames, and `_spawnBoss` already banishes all trash at fight start (Game.js:1980-1985). The player can never be inside a stone: they stand at ring center, 1120px away.

### Raise sequence (during the 3.0s warning)
Game keeps `this.riteRaise = { sites:[…12], nextIdx: 0, timer: 0, tag: 'rite' }`:
- One stone rises every `RITE.riseInterval = 0.22s` (tunable) walking clockwise → 12 × 0.22 = 2.64s, finishing 0.36s before the boss lands.
- Per stone: `insertRuntime` one obstacle with `ob.riseT = 0`; Obstacle.draw (Obstacle.js:36+) renders it clipped/offset by `riseT` (rises over `RITE.riseDur = 0.45s`, Game ticks `riseT` for tagged stones); a dust burst (`particles.deathBurst(x, y, '#8a8496')` reused), a micro-shake `this._shake(SCREEN_SHAKE.intensity * 0.12, 0.1)`, and a new `audio.stoneRise(k)` cue — `_metal(90 + k*6, …)` + `_sub(50, …)` so the 12 ticks climb in pitch around the circle (a rising ritual scale).
- When `riseT ≥ 1`, the stone's **crown flame ignites**: Game.render registers, for each visible stone (reuse `_inView`, Game.js pattern at 3413), `lighting.addLight(ob.x, ob.y - 180, RITE.flameRadius = 140, rite.color, 0.85, 0)` + 1-2 ember particles/s. 12 lights max, few visible at once after culling — comfortably inside `maxLights: 96` (GameConfig.js:1396).
- Banner moment (the roadmap hook): when the 12th stone ignites, one full-ring flash — `_spawnRing(cx, cy, { maxR: ringRadius, width: 18, life: 0.8, color: rite.color })` (reuses Game.js:3067 helper) + `audio._duck(0.5, 0.1, 0.4)` breath before `bossSpawn()` hits.

### Collision & despawn
- Stones are solid circles (movement slide via `resolveCircle`, projectile blocking via `segmentBlocked` — both free, ObstacleSystem.js:362-443). This creates a real new tactical texture: **cover exists inside boss fights** — boss `fan`/`wall`/`aimed` projectiles (GameConfig.js:404+) shatter on stones; beams (`kind:'beam'`) are hazard-decal sweeps and deliberately ignore stones (they rake over everything — spec'd, not a bug).
- On boss death (the arena-lift block Game.js:3070-3072) AND the safety net (Game.js:3270) AND run teardown (`_startRun`/game over): call `_lowerRite()` → each stone plays a 0.6s sink (riseT reverses), then `removeRuntimeByTag('rite')`. Because `_obstacleBiome` skips `generate()` on same-biome restarts (Game.js:857-859), `_startRun` MUST explicitly `removeRuntimeByTag('rite')` — designed in from PR1.
- Replace the current dashed arena circle (Game.js:3420-3438) with a subtler ground glow arc connecting stones (same one-pass radial band, recolored to `rite.color`), so the wall reads as "the stones' ward", not a game-y dashed line.

## 2. Feature B — Per-boss signature weather + veil signatures

New data file **`src/content/bossRites.js` (NEW)** — the single source of per-boss identity, one entry per 12 boss ids:
```js
export const BOSS_RITES = {
  hoarfang: {
    color: '#aef0ff',                       // stones' flame + ring + stinger tint
    weather: { kind: 'streaks', angle: 2.6, speed: 900, len: 26, n: 72, color: '#dceffa', alpha: 0.5 },
    veil: { tint: '#a8bece', boost: -0.10 },  // sleet WHITES the horizon: lighter veil color, slightly lower strength = fog
  }, …
}
```
**Three parametric renderers cover all twelve** (added to `MapRenderer.drawWeather` as an override path — Game passes `this.bossRite` when set; existing biome weather resumes when null; all stateless time-derived like MapRenderer.js:256-296, all skipped under `lowQuality` exactly as today at MapRenderer.js:253):
1. `streaks` — line segments at a fixed angle (sleet, gale, sandwall): params angle/speed/len/color.
2. `motes` — the existing dot renderer generalized: params rise/fall speed, wobble amp, `spiralIn` (drift toward screen center for void bosses), color, radius.
3. `bands` — the cached `_buildRays` canvas (MapRenderer.js:229-250) rebuilt once per rite color for aurora/solar bosses (cache keyed by color; ≤2 rebuilds per fight).

**Assignments (all tunable):** Vesperwing streaks#7fd0ff (gale) · Gravemaw motes-rise#9ae66e (spores) · Cacklemaw motes-spiralIn#cdb3ff · Hoarfang streaks#dceffa (sleet, the roadmap hook) · Rimewarden motes-fall#cfe4f2 (heavy squall, n=88) · Aurorath bands#a0ffe0 · Mourndrift motes-spiralIn#9af0ff · Ossuar motes-fall#e8f0d8 (bone-ash) · Nihagault motes-spiralIn#d06bff (n=88, strongest pull) · Cindermaw motes-fall#ffae5a (ashfall w/ ember tips) · Dunescourge streaks#ffe09a (horizontal grit, angle≈0.1) · Solnakh bands#ff7a2a + motes-fall.
Particle count `n = 72` during a rite (biome layer's 56 is suspended, not stacked) — same trivial fill cost class.

**Veil signature:** extend LightingSystem with a `veilColor` quality knob: `setQuality({ veilColor })` and `_veilGradient` cache key `(strength, veilColor)` (currently strength-only, LightingSystem.js:73). Game drives a lerp `this._riteVeilT` (0→1 over 1.5s from warning start; 1→0 over 2.5s from boss death), interpolating color `GFX.darkness.color → rite.veil.tint` (hexLerp exists in ObstacleSystem.js:62-65 — lift to MathUtils or duplicate 8 lines) and strength `base·mapDarkness → clamp(base·mapDarkness + rite.veil.boost, 0.2, 0.62)`. STRENGTH_CAP 0.62 (LightingSystem.js:29) is respected by construction; boosts range −0.10 (Hoarfang white-out fog) to +0.08 (Nihagault's hungering dark). Restore path also runs on game over / victory / `_startRun`.

## 3. Feature C — 12 boss theme retunes, phase-2 stingers, pressure layers

### BOSS_TUNE (AudioSystem.js — deliberately co-located with BIOME_TUNE at AudioSystem.js:87)
Extract `const BOSS_BASE = { …current THEMES.boss… }` (AudioSystem.js:65-73); add `BOSS_TUNE` keyed by boss id, shallow-merged: `THEMES.boss = { ...BOSS_BASE, ...BOSS_TUNE[id] }` in new `setBossTheme(id)` / `_applyBossTune()` — the literal `_applyBiome` pattern (AudioSystem.js:301-305). New levers allowed per tune: `bpm`, `prog`, plus the existing root/scale/cutoff/energy/wave/swing/reverb. Patterns (lead/bass/kick) stay shared — 12 recolors of one groove, honest about scope, exactly like the biome retunes.

**The table (all tunable):**
| boss | bpm | root | scale | wave | cutoff | energy | swing | prog | reverb |
|---|---|---|---|---|---|---|---|---|---|
| stormwingAlpha | 158 | 43 | DORIAN | sawtooth | 2000 | 1.08 | 0.02 | [0,7,5,7] | 0.14 |
| vinebackGoliath | 140 | 36 | MINOR | sawtooth | 1300 | 1.16 | 0.0 | [0,0,5,3] | 0.20 |
| gloomMaw | 148 | 38 | PHRYG | sawtooth | 1500 | 1.14 | 0.08 | [0,1,0,3] | 0.26 |
| hoarfang | 160 | 41 | MINOR | triangle | 2400 | 1.06 | 0.0 | [0,10,7,10] | 0.30 |
| rimewarden | 144 | 39 | DORIAN | sawtooth | 1500 | 1.12 | 0.0 | [0,0,3,5] | 0.30 |
| aurorath | 150 | 45 | DORIAN | triangle | 2700 | 1.10 | 0.06 | [0,7,9,7] | 0.34 |
| mourndrift | 158 | 40 | PHRYG | triangle | 2100 | 1.08 | 0.10 | [0,1,3,1] | 0.34 |
| ossuar | 142 | 36 | MINOR | sawtooth | 1350 | 1.14 | 0.0 | [0,3,0,10] | 0.24 |
| nihagault | 146 | 34 | PHRYG | sawtooth | 1200 | 1.18 | 0.0 | [0,1,0,1] | 0.28 |
| cindermaw | 162 | 43 | MINOR | sawtooth | 1700 | 1.12 | 0.04 | [0,5,3,5] | 0.16 |
| dunescourge | 146 | 38 | PHRYG | sawtooth | 1550 | 1.14 | 0.06 | [0,1,5,1] | 0.14 |
| solnakh | 152 | 36 | PHRYG | sawtooth | 1450 | 1.20 | 0.0 | [0,1,0,10] | 0.18 |
Tier identity: tier-1 skirmishers fast (158-162 bpm), tier-2 warlords heavy-slow (140-146), tier-3 apexes mid-tempo with the most dissonant progs.

Integration: `audio.setBossTheme(id)` called in `_spawnBoss` right before `playMusic('boss')` (Game.js:2043); cleared (`setBossTheme(null)` → BOSS_BASE) where the duel ends at `playMusic('gameplay')` (Game.js:3071) and on game over/menu. Callable pre-ctx exactly like `setBiome` (AudioSystem.js:297-300).

### Phase-2 stinger (new cue, fills the verified silent flip)
`audio.phase2Stinger()` hooked into the one-shot latch at Game.js:3240-3245 (alongside the existing announce/shake/ring). Composition, keyed to the ACTIVE tune's root/scale so it's in-key for all 12:
- `_duck(0.8, 0.25, 1.0)` — the hardest sidechain slam in the game; the bed drops to floor 0.2 for a quarter second, so the stinger owns the mix (this is the "synced via the musicDuck sidechain" mechanism).
- **Bar-sync:** schedule the stinger's downbeat at the scheduler's next even 8th (`t = this._nextTime + ((2 - this._step % 2) % 2) · sixteenth`, fields at AudioSystem.js:130-133) — max latency at 152bpm ≈ 0.2s, imperceptible against the 0.45s ring FX, but the hit lands ON the grid.
- Voices: sub drop 84→36Hz (0.6s, gain 0.2), `_metal` snarl at `hz(root)` ratios [1,1.4,2.1], then a rising 3-note figure `deg 0→2→4` of the boss's scale an octave up (0.11s apart, gain 0.1) + noise sweep. Registered in `PRIORITY_CUES` (AudioSystem.js:840-844).
- Also latch `this._phase2 = true` in AudioSystem (cleared by `setBossTheme`/`playMusic('gameplay')`).

### Pressure-reactive layers (extends the existing intensity plumbing)
`setIntensity` already opens the master filter and drives extra hats/kicks/arps (AudioSystem.js:308-312, 355-357, 376), fed by enemy density + boss HP (Game.js:3272-3277). Add two boss-theme-only layers in `_scheduleStep`:
1. **Ritual tom** — when `theme === 'boss'` and `_intensity > 0.6`: low `_mVoice(hz(root−24), …)` at steps 3, 11, gain `0.055·ix`, cutoff 500 — a war-drum that literally only exists when the fight is going badly/late.
2. **Phase-2 lift** — while `_phase2`: `energy ×1.12` and bass double-time (bassSteps ∪ {1, 9}); scheduled last so the `_voiceCap` (6 mobile / 10 desktop, AudioSystem.js:149) drops these first — pressure layers can never starve the lead. That cap is the mobile guarantee.

## 4. Feature D — Kill monuments (permanence)

- **Save (additive, no version bump):** `monuments: { [bossId]: { kills:int≥0, firstDay:int } }`, validated in `_validate` by whitelisting keys against boss ids and clamping ints (the dailyRoad pattern, SaveSystem.js:298-305). Written via new `saveSystem.recordBossKill(bossId)` called in the boss-death block (Game.js:3040-3043 vicinity, beside `notifyBossDefeated`). ≤ 12 entries + future-proof whitelist injection from `ENEMY` boss flags.
- **Placement:** after `obstacleSystem.generate(…)` in `_startRun` (Game.js:857-859), insert one `killMonument` per current-map boss with kills > 0 (≤3 per map) via `insertRuntime(…, 'monuments')` at a deterministic site: `mulberry32(strHash(bossId) ^ strHash(biomeId))` → polar (r: 1400-2600 from origin, angle full circle), retry ≤8 with `isBlocked(x,y,120)` + spawn-clear check; give up silently if crowded. Removed+reinserted whenever the biome regenerates or a run starts (kills may have grown). Same-biome restarts: `removeRuntimeByTag('monuments')` then reinsert — covers the `_obstacleBiome` skip.
- **Archetype** (mapObjects.js): `killMonument: { shape:'circle', col:{r:26}, size:{w:110,h:150..250}, blocksLOS:false, weight:0 }`. **Tiers by kills** (tunable): 1+ = cairn (h150), 10+ = rune stela (h200), 50+ = crowned effigy (h250, gets a permanent flame light — a candle-class emitter registered like MapRenderer.js:210-212). Procedural draw in ObstacleSprites.js: biome-tinted stone + the boss's `rite.color` accent + kill-tally ember-script notches (1 notch per kill up to 20, then bars of 10).
- **Whisper:** once per run, when the player first comes within 220px of a monument, `waveDirector.announce('GRAVEMAW — FELLED 14 TIMES', 2.5, rite.color)` — reuses the banner channel, zero new UI.
- **Ceremony hook:** when a boss dies, a ghost-monument flash at the death spot (a 1.2s translucent cairn sprite + `_spawnRing`) with the line "A THRESHOLD IS RAISED" — the player learns monuments exist the moment they earn one.

## 5. Update lifecycle summary (per fight)
warning t=0: arena center latched, veil lerp starts, rite weather fades in (1.5s), stones rise 1/0.22s with pitch-climbing ticks → t≈2.64 12th flame + full-ring flash → t=3.0 boss spawns, `setBossTheme(id)` + `playMusic('boss')` (Game.js:2043) → fight: stones = cover, pressure layers ride intensity → phase-2 flip (Enemy.js:1150): stinger slams via musicDuck, weather density ×1.3, veil boost +0.02 → death (Game.js:3040-3078): `recordBossKill`, stones sink + despawn, veil/weather restore over 2.5s, `setBossTheme(null)` + gameplay theme, ghost-monument flash. Endless/gauntlet: the cycle repeats per encounter (BossDirector cycles the roster, BossDirector.js:42-46); monuments accumulate kills.

## 6. NEW vs REUSED
**NEW:** `src/content/bossRites.js` (data); ObstacleSystem `insertRuntime`/`removeRuntimeByTag`; `riteStone` + `killMonument` archetypes + their procedural draws; LightingSystem `veilColor` knob; MapRenderer parametric weather override (3 renderers); AudioSystem `BOSS_TUNE`+`setBossTheme`+`phase2Stinger`+`stoneRise`+2 pressure layers; SaveSystem `monuments` key + `recordBossKill`; `GameConfig.RITE` block. **REUSED:** the whole arena system (spawn/confine/lift/safety-net), bossWarning window, `_spawnRing`/`_shake`/`_hitStop`/particles, `_duck` sidechain, the BIOME_TUNE merge pattern, `mulberry32`/`strHash`, `_inView` culling, candle-light registration pattern, announce channel, implicit-default save validation. **NOT touched:** boss kits/attacks/AI, enemy caps, Spawner, WeaponSystem, canonical enemy art.

## PR plan

### PR1 — PR1 — Ring of the Rite: runtime obstacle insertion + arena-raise ceremony

**Goal:** Boss arrivals physically raise 12 standing stones on the existing arena circle during the 3s warning; stones are solid cover, ignite crown flames, and sink away on boss death. Fully playable with procedural stone art.

**Files:**
- `src/systems/ObstacleSystem.js`
- `src/entities/Obstacle.js`
- `src/content/mapObjects.js`
- `src/assets/ObstacleSprites.js`
- `src/core/Game.js`
- `src/config/GameConfig.js`
- `src/systems/AudioSystem.js`

**Work:**
- ObstacleSystem: add insertRuntime(entries, tag) / removeRuntimeByTag(tag) — push tagged Obstacles, re-sort baseY, full _buildGrid() rebuild (O(≤255), verified trivial); runtime set exempt from MAX_OBSTACLES
- mapObjects.js: riteStone archetype (circle col r34, size 96×210, blocksLOS:false, weight:0); GameConfig: RITE block { ringRadius, stoneCount:12, riseInterval:0.22, riseDur:0.45, flameRadius:140, sinkDur:0.6 }
- Game: latch arena center in _startBossWarning (Game.js:2052) and reuse it in _spawnBoss (Game.js:1989); riteRaise sequencer in _updateDirectors ticking one stone per riseInterval with isBlocked site validation, dust burst, micro-shake, stoneRise audio tick; full-ring flash on 12th ignition
- Obstacle.draw: riseT vertical clip for rise/sink animation; Game.render: per-visible-stone flame light (addLight priority 0) + ember particles; replace dashed arena circle (Game.js:3420-3438) with stone-ward ground glow
- Teardown everywhere the arena lifts: boss death (Game.js:3072), safety net (Game.js:3270), _startRun/game-over — explicit removeRuntimeByTag('rite') to survive the _obstacleBiome regenerate-skip (Game.js:857)
- AudioSystem: stoneRise(k) cue (_metal + _sub, pitch climbing with k)

**Verify:**
- node --check on all touched files
- node tools/validate-assets.js exit 0
- Headless harness (serve.py + chromium): harness.html?seconds=175&badge=1 → EXC:0 and screenshot shows the raised stone ring around the first boss (spawnInterval 160 + 3s warning)
- harness.html?seconds=215&badge=1 → boss dead or fight ongoing, no orphaned stones after arena lift; second run in same biome shows no stale stones
- Adversarial review, squash-merge to main

### PR2 — PR2 — Signature weather + veil rites for the Twelve

**Goal:** Every boss brings its own sky: 12 weather signatures via 3 parametric screen-space renderers, plus a per-boss darkness-veil tint/strength lerp (Hoarfang's sleet white-out is the showcase).

**Files:**
- `src/content/bossRites.js (NEW)`
- `src/systems/MapRenderer.js`
- `src/systems/LightingSystem.js`
- `src/core/Game.js`

**Work:**
- Create bossRites.js: BOSS_RITES for all 12 ids — color, weather {kind: streaks|motes|bands + params}, veil {tint, boost} per the spec table
- MapRenderer.drawWeather: accept a rite override; implement the 3 parametric renderers (streaks with angle/speed/len; motes with rise/fall/wobble/spiralIn; bands = _buildRays re-tinted, cached per color); n=72 during rites, biome layer suspended not stacked; lowQuality skip preserved
- LightingSystem: veilColor quality knob; _veilGradient cache key extended to (strength, veilColor)
- Game: this.bossRite latched at _startBossWarning, cleared at boss death/game-over/_startRun; _riteVeilT lerp driver (in 1.5s / out 2.5s) interpolating color + strength (clamped 0.2..0.62), composed with mapDarkness and the FPS governor path (Game.js:3835-3838); phase-2 weather density ×1.3

**Verify:**
- node --check; node tools/validate-assets.js exit 0
- harness.html?seconds=175&badge=1 → EXC:0; screenshot on hollowreach map shows sleet streaks + whitened veil during the Hoarfang fight (map param via existing save PUT/localStorage seed in harness)
- harness.html?seconds=140&badge=1 (pre-boss) → biome weather unchanged; confirm veil restored in a post-boss-death screenshot (seconds=215)
- Governor check: force lowQuality via the harness quality path → weather skipped, no EXC
- Adversarial review, squash-merge

### PR3 — PR3 — Twelve boss retunes, phase-2 stinger, pressure layers

**Goal:** Each of the 12 bosses gets its own procedural theme (BOSS_TUNE shallow-merge, mirroring BIOME_TUNE in AudioSystem), the currently-silent phase-2 flip gets a bar-synced musicDuck stinger, and two pressure-reactive layers ride the existing intensity feed.

**Files:**
- `src/systems/AudioSystem.js`
- `src/core/Game.js`

**Work:**
- Extract BOSS_BASE from THEMES.boss (AudioSystem.js:65-73); add BOSS_TUNE table (12 rows per spec: bpm/root/scale/wave/cutoff/energy/swing/prog/reverb); setBossTheme(id) + _applyBossTune() cloning the setBiome/_applyBiome pattern (AudioSystem.js:297-305), callable pre-ctx
- Game: setBossTheme(id) in _spawnBoss before playMusic('boss') (Game.js:2043); setBossTheme(null) at duel end (Game.js:3071), game over, and menu return
- phase2Stinger(): _duck(0.8, 0.25, 1.0) + bar-synced (next even 8th off _nextTime/_step) sub-drop + in-key metal snarl + rising 3-note figure from the active tune's root/scale; latch _phase2 for the lift layer; add to PRIORITY_CUES; hook into the phase2Entered one-shot at Game.js:3240-3245
- Pressure layers in _scheduleStep (boss theme only): ritual tom at steps 3/11 when _intensity>0.6; _phase2 energy ×1.12 + bass double-time — both scheduled after lead/bass so the per-step voice cap (6/10) drops them first on mobile

**Verify:**
- node --check src/systems/AudioSystem.js src/core/Game.js
- node tools/validate-assets.js exit 0; harness.html?seconds=175&badge=1 → EXC:0 (AudioSystem is a feature-detected no-op headless — proves no throw on the silent path)
- Manual listen via tools/artshot/audioprobe.html: A/B two boss ids' tunes + trigger phase2Stinger; confirm gameplay theme restores after boss death
- Grep-assert: exactly 12 BOSS_TUNE keys matching the 12 boss ids in GameConfig ENEMY
- Adversarial review, squash-merge

### PR4 — PR4 — Kill monuments: permanent thresholds in the world

**Goal:** Every apex you have ever felled stands in its map as a growing monument (cairn → stela → crowned effigy by lifetime kills), persisted additively in the save, with a once-per-run whisper and a death-spot ceremony flash.

**Files:**
- `src/systems/SaveSystem.js`
- `src/content/mapObjects.js`
- `src/assets/ObstacleSprites.js`
- `src/entities/Obstacle.js`
- `src/core/Game.js`

**Work:**
- SaveSystem: additive monuments key { [bossId]: { kills, firstDay } } with whitelist+clamp validation in _validate (dailyRoad pattern, no version bump); recordBossKill(bossId) API
- Game boss-death block (Game.js:3040-3043): recordBossKill + ghost-monument flash ('A THRESHOLD IS RAISED') at the death spot
- killMonument archetype + 3-tier procedural draw (kill-notch ember-script, rite-color accent, tier-3 flame light via the candle pattern)
- Game._startRun: after obstacle generate/skip, removeRuntimeByTag('monuments') + insertRuntime of ≤3 monuments at deterministic seeded sites (mulberry32(strHash(bossId)^strHash(biomeId)), r 1400-2600, ≤8 isBlocked retries)
- Proximity whisper: once per run per monument within 220px via waveDirector.announce in the existing enemy-scan/cleanup pass

**Verify:**
- node --check; node tools/validate-assets.js exit 0
- Harness with a seeded save (page.evaluate localStorage inject of monuments {gloomMaw:{kills:14}} before boot): screen=menu boots clean, then gameplay screenshot shows the monument in-world, badge EXC:0
- Save round-trip: corrupt/hostile monuments values (strings, negatives, unknown ids) → validated to defaults, no throw (node-side unit of the _validate function if runnable, else harness console assert)
- Old-save load (no monuments key) → defaults, zero migration errors
- Adversarial review, squash-merge

## Data & save changes

**New content file:** `src/content/bossRites.js` — BOSS_RITES map keyed by the 12 boss ids (GameConfig.js:379-663): per-boss `color` (accent for stones/rings/stinger tint), `weather` (renderer kind + params), `veil` ({tint, boost}). Pure data, append-only; unknown ids ignored.

**New config blocks:** `GameConfig.RITE` { ringRadius: 1120 (=BOSS.arenaRadius), stoneCount: 12, riseInterval: 0.22, riseDur: 0.45, sinkDur: 0.6, flameRadius: 140, flameIntensity: 0.85, weatherN: 72, veilLerpIn: 1.5, veilLerpOut: 2.5, whisperRadius: 220, monument: { tiers: [1, 10, 50], siteRMin: 1400, siteRMax: 2600, placeRetries: 8 } }. Two new `MAP_OBJECTS` archetypes in `src/content/mapObjects.js`: `riteStone`, `killMonument` (both weight: 0 — never in the random prop pool). `BOSS_TUNE` (12 rows) added beside BIOME_TUNE in `src/systems/AudioSystem.js`.

**Save schema (additive only, stays version 7):** `monuments: { [bossId]: { kills: int≥0, firstDay: int≥0 } }` — validated by whitelisting keys against boss-flagged ENEMY ids and integer-clamping values, following the implicit-defaults pattern (SaveSystem.js:296-305). Old saves lacking the key get `{}`; hostile values are dropped/clamped; exporting to older builds is safe (unknown key ignored by the existing validator).

## Balance numbers (all tunable)

| Number | Start value | Rationale | |
|---|---|---|---|
| Stone count | 12 | one per "the Twelve"; ring stays permeable (≈586px spacing on r=1120) | (tunable) |
| Stone collision r / size | 34 / 96×210px | pillar-class (mapObjects pillar r30); real cover vs boss fans without maze-ing the arena | (tunable) |
| Rise cadence / rise dur | 0.22s / 0.45s | 12×0.22=2.64s fits inside the 3.0s BOSS.warningDuration with 0.36s for the ring flash | (tunable) |
| Sink dur on death | 0.6s | reads as release, doesn't delay the loot beat | (tunable) |
| Stone flame light | radius 140, intensity 0.85, priority 0 | candle-class (GFX.lighting.candleRadius pattern); ≤12 total, few visible post-cull, inside maxLights 96 | (tunable) |
| Rite weather density | n=72 (Rimewarden/Nihagault 88) | +29% over biome's 56; same trivial fill class; phase-2 ×1.3 → ≤114 | (tunable) |
| Veil boost range | −0.10 … +0.08 | clamped 0.2..0.62 (STRENGTH_CAP); −0.10 + tint #a8bece = Hoarfang white-out fog | (tunable) |
| Veil lerp in/out | 1.5s / 2.5s | in matches the raise ceremony; out lingers past the kill beat | (tunable) |
| Phase-2 stinger duck | amount 0.8, hold 0.25, recover 1.0 | hardest duck in the game (reveal mythic is 0.5/0.10/0.5) — the fight's midpoint must own the mix | (tunable) |
| Stinger bar-sync | next even 8th | max latency ≈0.2s @152bpm, lands on-grid | (fixed) |
| BOSS_TUNE bpm band | 140–162 | tier1 fast 158-162, tier2 heavy 140-146, tier3 mid 146-152; base boss theme was 152 | (tunable) |
| Ritual tom gate | _intensity > 0.6, steps 3 & 11, gain 0.055·ix | above the arp gate (0.35) so it's a late-fight layer; dropped first by the voice cap | (tunable) |
| Monument tiers | 1 / 10 / 50 kills → h150/200/250 | first kill = instant landmark; 50 ≈ a veteran's trophy | (tunable) |
| Monument placement | r 1400–2600 from origin, ≤8 retries, ≤3/map | outside spawn clear, inside edge margin; silent give-up keeps generate() sacred | (tunable) |
| Whisper radius | 220px, once per run per monument | discovery, not spam; reuses announce channel | (tunable) |
| Runtime obstacle budget | 12 stones + 3 monuments = 15 max, worst-case 255 total | _buildGrid rebuild stays O(µs); MAX_OBSTACLES 240 untouched for generate() | (fixed) |

## Art needs (non-blocking)

- Blender prop pipeline (tools/blender/): a parametric standing-stone model (height/crack/rune-glow params) → pixelated sheet for riteStone, and 3 monument tiers (cairn/stela/effigy) — NON-BLOCKING: PR1/PR4 ship with procedural Canvas2D draws in ObstacleSprites.js following the existing pillar/graveMarker style (Obstacle.draw already prefers per-instance art with procedural fallback)
- Optional Nano Banana 2 (separate higgsfield session): one 2×2 grid of weathered rune-stone variants as an img2img texture reference for the Blender pass — world-prop art only, the canonical enemy style lock is untouched (no creature art in this update)
- No new audio assets: all 12 retunes, the stinger, stoneRise ticks, and pressure layers are 100% procedural per the AudioSystem contract (AudioSystem.js:1-19 — music never uses samples)
- Procedural-first guarantee: every visual in this update (stones, monuments, weather, veil tint, ring glow) is code-drawn; AI/Blender art only ever upgrades riteStone/killMonument sprites later and each gets an ASSET_CREDITS.md row when it lands

## Risks

- PERF (mobile fill + lights): 12 flame lights + denser weather + veil-gradient rebuilds during lerps could spike low-end frames. Designed in from PR1: stone lights registered only for on-screen stones via the existing cull, weather stays a single stateless pass skipped under lowQuality (MapRenderer.js:253), the veil gradient rebuild is throttled to lerp frames only (cache key change, still zero-alloc steady-state), and the FPS governor path (Game.js:3835-3847) already lowers maxLights/strength — rite visuals ride those same knobs. Audio pressure layers sit under the per-step voice cap (6 mobile) and are scheduled last, so they shed first.
- SOFT-LOCK / trapping (runtime collision): inserting solid stones mid-play risks pinning entities or orphaning stones if teardown is missed. Mitigations from PR1: player is provably 1120px from every stone at raise; per-frame resolveCircle passes (Game.js:2760, 2883) self-heal overlaps in 1-2 frames; isBlocked site validation skips crowded sites; teardown is wired to ALL arena-lift paths including the existing no-boss safety net (Game.js:3270) plus an explicit removeRuntimeByTag in _startRun to survive the same-biome generate() skip (Game.js:857).
- SAVE (schema abuse / stale exemplars): the additive monuments key is validated with a boss-id whitelist + integer clamps so hostile/corrupt saves degrade to {} (never throw), and old saves get implicit defaults with no version bump — round-trip tested in PR4 against missing-key, wrong-type, and unknown-id payloads.
- BALANCE (cover trivializes bosses): stones eating projectiles could let players turret behind cover. Contained by geometry (12 thin stones on a 1120px ring — the boss walks around them, beams sweep over them, shockwaves/zones/charges ignore them entirely since they're hazard-based) and by the boss chase AI already closing contact distance; if playtests show camping, first knobs are stone col r 34→28 or stoneCount 12→8 without touching any boss kit.

## Uniqueness & boundaries

THRESHOLDS is the only update in the 20 that ships EVENT STAGING and WORLD PERSISTENCE for fights that already exist: nothing else gives bosses arrival ceremonies, per-boss weather/veil signatures, per-boss music identity, or permanent player-earned world marks — every other update adds mechanics, content, or meta systems around fights, none makes the existing twelve FEEL legendary. Sharpest boundaries: #4 BOSSFORGE (nearest neighbor, hard dep) owns everything mechanical about bosses — kits, phase-2 ATTACKS, telegraphs, models, projectile perf — so THRESHOLDS deliberately changes zero boss stats, zero attacks, zero AI; it only decorates the phase2Entered flag BOSSFORGE wired. #11 FORGEHEART owns new bosses and biome 5 — THRESHOLDS builds the reusable rite machinery (BOSS_RITES rows + BOSS_TUNE rows are append-only) that FORGEHEART's three new bosses simply add rows to. #9 WAYLIGHT owns seeded interactive POIs (rescues, waystones, bell killboxes) — monuments are deliberately NOT interactive loot events, they are earned permanent memorials with a whisper, nothing to click. #12 CINDERS & SCRIPTURE owns the menu-side Codex/'The Twelve' lore pages — THRESHOLDS keeps all its permanence IN-WORLD and leaves kill-gated lore UI untouched (the monuments' kills data becomes a free input for #12's pages later). #13/#16 own records/prestige framing of victories — THRESHOLDS records only the raw per-boss kill count and claims no ranking, seals, or currency.

## Roadmap corrections found while grounding

- Entry-point brief claimed 'GameConfig BIOME_TUNE shallow-merge' — BIOME_TUNE actually lives in src/systems/AudioSystem.js:87-92 and is shallow-merged in AudioSystem._applyBiome (AudioSystem.js:301-305: THEMES.gameplay = { ...GAMEPLAY_BASE, ...tune }). GameConfig.js contains no BIOME_TUNE. The new BOSS_TUNE therefore also goes in AudioSystem.js for pattern symmetry.
- musicDuck sidechain claim HOLDS: node at AudioSystem.js:124/191-193, _duck() at AudioSystem.js:529-539, all music voices route through it — verified, no correction.
- ObstacleSystem has NO runtime insertion API today: generate() (ObstacleSystem.js:89-149) is the sole builder and _buildGrid() (ObstacleSystem.js:275-294) fully rebuilds the spatial grid. Insertion is VIABLE (full rebuild over ≤~255 obstacles is microseconds at boss cadence) but insertRuntime/removeRuntimeByTag must be built in PR1 — the roadmap's 'runtime ObstacleSystem insertion' is a to-build mechanism, not an existing seam.
- Bonus verified gap the synopsis didn't know: the phase-2 flip is currently SILENT — Game.js:3240-3245 fires announce/shake/ring once off phase2Entered (set in Enemy.js:1150-1151) with no audio call; audio.enrage() only plays at the separate 25%-HP threshold (Game.js:2174). The phase-2 stinger fixes a real hole rather than replacing an existing cue.
- Bonus verified: a boss arena already exists as a SOFT confinement ring (Game.js:1989 creation, 1866 _confineToArena, 3417-3439 dashed-ring render, BOSS.arenaRadius 1120 at GameConfig.js:741) — 'arena-raise' correctly builds physical stones ON this circle; the soft wall remains the actual confinement and the spec keeps it.
- Bonus verified: segmentBlocked (ObstacleSystem.js:436-443) ignores blocksLOS — any solid runtime stone stops projectiles regardless of the LOS flag, which the spec adopts deliberately as the cover mechanic (blocksLOS:false keeps enemy AIM unaffected while bodies and bolts collide).
