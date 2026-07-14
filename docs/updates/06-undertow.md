# Update #6: UNDERTOW — The Quenched Forge

*Era II — The Waking Hand (closes the era; deps: 4 BOSSFORGE)*

**Value verdict (ADDS):** The bank-or-push Tide Gate is verifiably the only decision structure of its kind on the roadmap (existing modes are open-ended time, fixed dailies, or boss-only), and the four drowned creatures are the first new enemy family since launch. The quench/steam counterweight also solves a real art-direction problem (everything else is ember-toned). This is the strongest pure-content update of the sixteen; no filler identified.

## What it adds

The Descent: EMBERWAKE's first bounded-session, push-your-luck run structure — flooded floors below the forge that you clear one at a time, then choose at the Tide Gate to SURFACE (bank an escrowed coin haul at a depth multiplier) or DESCEND (harder floor, bigger multiplier, no full heal). It ships the game's first new enemy FAMILY since launch (four drowned creatures in the canonical style with procedural-first art), the Tidewarden apex boss on the Bossforge pipeline as a recurring depth-gate fight, and a complete quench/steam presentation layer (steam weather, rising floodline, tidepool hazards, quench VFX) that gives the ember/forge world its elemental opposite.

## Design spec

# UNDERTOW — The Quenched Forge: Implementation Spec

## 0. Fiction & framing
The forge's runoff channels flood the caverns beneath the world. Descending "quenches" the ever-burning — each floor is colder, darker, wetter; steam erupts where ember meets brine. This is deliberately the tonal INVERSE of the ember/forge overworld (and of update #11's FORGEHEART, where fire styling is canon) — Undertow's palette is cold teal/brine/bone-white steam, and per CLAUDE.md the drowned creatures are NEVER fire-themed.

## 1. THE DESCENT — mode structure

### 1.1 Entry point
- New PLAY-tab CTA "THE DESCENT" beside START RUN / DAILY ROAD, following the exact DAILY ROAD CTA pattern (`src/systems/MenuRenderer.js:1139-1177` — the CTA row + `this._hot(..., 'startDescent', null)` hotspot).
- Action dispatch mirrors `startDaily`: `src/core/Game.js:1483-1484` gains `case 'startDescent': this._pressFeedback('start'); this.descentMode = true; this._startRun(); break;`. `restart()` (Game.js:902-909) and `returnToShop()` (Game.js:911-928) clear `descentMode` exactly as they clear `dailyMode` (Game.js:907, 920).
- **Unlock gate**: honest Crypts access (`campaignMapUnlocked('crypts')`) — equivalent to recording the exact Emberwood and Hollow Reach trios through eligible campaign runs, never six arbitrary lifetime kills. Locked state renders the CTA dimmed with `COMPLETE HOLLOW REACH · N/3` using the canonical campaign status.

### 1.2 Floor loop (the core state machine)
Run state object created in `_initRunState` (`src/core/Game.js:566`), null outside the mode:
```
this.descent = descentMode ? {
  depth: 1, floorTimer: DESCENT.floorLength, phase: 'floor',  // 'floor' | 'flood' | 'gate'
  haul: 0, currents: [], seed: (Date.now() ^ 0x5eed) >>> 0,
} : null;
```
Phases per floor:
1. **FLOOR (150 s, tunable)** — normal survivor combat under the descent scaling (§1.3). `floorTimer` shown as a HUD bar. Wick Roads shrines/crossroads are DISABLED in this mode (the Tide Gate is the mode's decision point; `pendingCrossroads` at Game.js:656 is never set when `descent` is non-null).
2. **FLOOD (last 20 s of the timer, tunable)** — the "flood warning": the screen-space waterline rises (§4.2), spawner keeps running until T-0. At T-0 the Spawner is gated off (a `if (this.descent?.phase !== 'floor') return;` guard where `spawner.update` is called) and a flood sweep kills all remaining non-boss enemies over ~1.5 s in an expanding wave from the screen bottom. Flood kills grant kill credit + combo (they route through the normal kill pipeline so `waveDirector.notifyKill` — `src/systems/WaveDirector.js:73-79` — stays balanced) but drop **no gems/coins** (anti-farm: you can't idle a floor for drops; XP/coins must be earned before the flood).
3. **GATE** — the Tide Gate overlay opens. It's a world-pausing overlay slotted into the existing overlay composition at `src/core/Game.js:1638` (`!!this.upgradeChoices || !!this.chestReward || !!this.altar || !!this.victory` → append `|| !!this.tideGate`), with input handled like the victory overlay (pointer rects at Game.js:404-411, keyboard at Game.js:258-261: **Space/Enter = DESCEND, B = SURFACE**).

**Tide Gate overlay contents** (drawn by UISystem alongside the victory overlay renderer):
- The Haul: escrowed coins × current depth multiplier, big and gold.
- Depth reached, next floor's drawn Current(s) (§1.4) previewed by name + one-line effect.
- Player HP bar — the whole hook is reading "10% HP" against "×2.0 haul".
- Two buttons ≥ 140×90 px logical (touch-safe on the 1920×1080 canvas): **SURFACE** (bank & end run as a victory-class exit) and **DESCEND**.

**On DESCEND**: `depth += 1`, floorTimer resets, phase → 'floor'; player heals **25% maxHp** (tunable) and gains **+1 reroll** (rides the existing `this.rerolls` resource, Game.js:824) — enough to make pushing survivable, not enough to erase the gamble. Enemies/hazards/gems are already swept by the flood; the world is NOT regenerated (same obstacle layout — cheap, and the flood fiction covers it).
**On SURFACE**: run ends through the existing victory-leave path (`victoryToMenu` semantics, Game.js:1192) — run recorded once (`_runRecorded` guard, Game.js:673), haul banked (§1.5), `recordDescentResult` called (§5).
**On death mid-floor**: normal game-over; haul is salvaged at **35%** (tunable), depth recorded.

### 1.3 Depth scaling — two composed layers, both riding verified seams
1. **Virtual wave clock.** `WaveDirector.getState(gameTime)` is a function of the time you pass it (`src/systems/WaveDirector.js:94`), and Game already recomputes `waveState` per frame via `this._applyRunScale(this.waveDirector.getState(this.time))` (`src/core/Game.js:2666`, also 1836). In Descent, Game passes `this.time + DESCENT.depthTimeSkip * (depth - 1)` (depthTimeSkip = **120 s**, contribution capped at **900 s** so the hypergrowth wall at `ENDLESS_SCALING.hyperStartMinutes` (WaveDirector.js:201-205) engages around depth 8-9 as the designed soft ceiling, not an overflow). This reuses the entire authored WAVES ladder, endless scaling, twilight, pressure, and pack-size systems with ZERO changes to WaveDirector.
2. **descentScale multipliers**, folded into `_applyRunScale` exactly like `segmentScale` (`src/core/Game.js:1887-1895`): per depth d, hp ×(1+0.08(d−1)), damage ×(1+0.06(d−1)), speed ×(1+0.02(d−1)), elite ×(1+0.10(d−1)), cap ×(1+0.03(d−1)), interval ×1/(1+0.04(d−1)) (all tunable). Every clamp holds **by construction**: eliteChance min-capped 0.85 (Game.js:1891), maxAlive hard-capped 220 (Game.js:1893-1894) — the same guarantee ASHBOUND (#15) will later ride.
3. **Drowned mix by depth**: merged through the `segmentWeights` seam (`src/core/Game.js:1918` — a spread merge, so it can ADD types the wave's native table lacks; verified `Spawner._spawnOne` just calls `pickWeightedType(waveState.typeWeights)`, `src/systems/Spawner.js:56`). Depth 1: `{ brinemite: 2.5, drowned: 2 }`; depth 3+: add `{ tidecaller: 1.5 }`; depth 5+: `{ depthmaw: 1.2 }`; weights scale +15%/depth so the family gradually dominates the classic creatures (tunable, authored in `src/content/descent.js`).

### 1.4 Undertow Currents (per-floor modifiers)
From depth 2, each floor draws 1 Current (2 from depth 6) from a seeded table in NEW `src/content/descent.js`, using the MapRenderer mulberry32 idiom (`src/systems/MapRenderer.js:32-41`) seeded by `descent.seed + depth` so a floor's Current is fixed the moment you commit at the gate (previewed there):
- **Riptide** — tidepool hazard cadence ×1.6 (writes `biomeHazard.timer` scaling; seam: `HazardSystem.updateBiome` cadence at `src/systems/HazardSystem.js:199-203`).
- **Black Water** — `mapDarkness` +0.08 this floor (seam: the lighting governor, Game.js:864-867) and gloom-style light squeeze pools replace 30% of tidepools.
- **Cold Quench** — tidepools become steam-slicks: `iceSlipT`-style skid (seam: HazardSystem.js:56) instead of slow.
- **Drowned Legion** — drowned weights ×2, descentScale.cap ×1.1 (still under the 220 clamp).
- **Scalding Vents** — 3 extra `delayedZone` geysers per hazard wake (reuses the existing kind, HazardSystem.js:89-109).
All Currents are data + existing hazard kinds; none adds a sim system.

### 1.5 Bank-or-push economy (coins only — no new currency)
- Coins picked up in Descent accrue to `descent.haul` (HUD-visible) instead of `player.coins`.
- SURFACE banks `floor(haul × min(1 + 0.25·(depth−1), 3.0))` through `_bankRunCoins` (guard + played-run seed logic at `src/core/Game.js:1243-1248` is preserved; the multiplier is applied before the add).
- Death banks `floor(haul × 0.35)` (no depth multiplier — you drowned with it).
- Depth **milestone rewards** (first-time, persisted): depth 3 → 400 coins + achievement; depth 5 → the "Quenched" wand skin recolor (existing cosmetics unlock via `saveSystem`, `src/content/cosmetics.js`); depth 7 → a free case; depth 10 → "Tidewalker" title cosmetic + achievement. (All tunable; rewards reuse existing unlock plumbing — no new reward systems.)
- Game-over/surface summary shows `DEPTH n — HAUL m` via the `runSummary` extension idiom (`src/core/Game.js:1288-1290`).

## 2. THE DROWNED — enemy family (4 types)
All slot into the `ENEMY` table (`src/config/GameConfig.js:133`) using EXISTING behavior ids only, and into the `FRAMES_BY_TYPE` fallback chain (`src/entities/Enemy.js:67-114`) as `getEnemyAiFrames(t) || getDrownedFrames(t)` where `getDrownedFrames` are NEW procedural drawers in `src/assets/ProceduralSprites.js` — **procedural ships first; AI sheets never block** (roadmap standing rule). Elite affixes (`GameConfig.js:843-844`) apply automatically since they're type-generic.

| type | role | hp | speed | radius | contact | xp | behavior / kit (all tunable) |
|---|---|---|---|---|---|---|---|
| `drowned` (Drowned Husk) | mid shambler wall | 110 | 100 | 50 | 15 | 3 | plain chaser; waterlogged: takes 0.5× knockback (`knockbackMul: 0.5`, a def field the knockback resolve multiplies); steam puff on death |
| `brinemite` | swarm darter | 12 | 320 | 28 | 7 | 1 | plain chaser, `visualScale 0.6`, mite-class pack fodder |
| `tidecaller` | ranged + zoner | 40 | 90 | 46 | 6 | 2 | `behavior: 'spitter'` (GameConfig.js:165-178 shape): keepDistance 460, fireInterval 2.8, windup 0.55, fireRange 800, projectileSpeed 420, projectileDamage 14; its bolt stamps a mini **tidepool** (r 70, slowMul 0.8, 2.5 s, no tick) on impact — a small hook where enemy projectiles resolve, pushing into the shared `game.hazards` pool (same object shape HazardSystem already sims, HazardSystem.js:50-73), capped at 8 live mini-pools |
| `depthmaw` | burst anchor | 190 | 80 | 78 | 20 | 5 | `behavior: 'charger'` (GameConfig.js:181-193 shape): chargeInterval 3.6, windup 0.7, triggerRange 640, dashSpeed 700, dashDuration 0.45; `visualScale 1.3` |

**Identities (canonical style, locked)**: Drowned Husk = a waterlogged, moss-green shambler (zombie-family silhouette, bloated); Brinemite = a pale bone-white darting larva-fish; Tidecaller = a floating brine-orb with a single lure-light (eyeball-family silhouette); Depthmaw = a broad anglerfish-jawed bruiser. Cold teal/brine/bone palette — the art prompts carry the exact CLAUDE.md palette lock inverted: "keep exact palette, NO fire, NO lava, NO orange." Sheets follow the approved 2×2 grid recipe and land as `drowned_anim.png`, `brinemite_anim.png`, `tidecaller_anim.png`, `depthmaw_anim.png` in `ANIM_SHEETS` (`src/assets/EnemySprites.js:33-38`) in the art PR only when the PNGs exist (a listed-but-missing file would trip `tools/validate-assets.js`), with `ASSET_CREDITS.md` rows.

Drowned types are **Descent-exclusive at ship** (injected only via the descent weights merge, never added to `WAVES.typeWeights` or `maps.js enemyMix`) — this keeps every overworld biome's tuned identity intact and gives the mode a monopoly on its family. (#12 CINDERS & SCRIPTURE will still catalogue them in the Bestiary.)

## 3. TIDEWARDEN — the depth-gate boss
A full `behavior: 'apexBoss'` def mirroring the vinebackGoliath shape (`src/config/GameConfig.js:396-418`), using ONLY shipped attack kinds (shockwave / fan / charge / summon / zones / wall / seekers / mines / cross / beam — all verified in the goliath/stormwing kits at GameConfig.js:401-458 and simmed in `src/systems/HazardSystem.js`). It consumes BOSSFORGE's (#4) projectile grid + pooling and its Blender boss-art pipeline; procedural fallback frames ship first via the boss chain idiom (`getPixelBossFrames('tidewarden') || getTidewardenFrames()`, mirroring `src/entities/Enemy.js:111-113`).

```
tidewarden: {
  hp: 1500, speed: 130, radius: 95, contactDamage: 26, xpValue: 40, boss: true,
  bossName: 'Tidewarden', epithet: 'Keeper of the Quenched Forge',
  tier: 2, visualScale: 2.0, behavior: 'apexBoss', phase2HpFraction: 0.5,
  supportTypes: { drowned: 2, brinemite: 2, tidecaller: 1 },
  attacks: [
    { id: 'crestWave',   kind: 'shockwave', cooldown: 4.5, windup: 0.6,  damage: 28, growth: 700, rMax: 620, band: 110 },
    { id: 'brineVolley', kind: 'fan',       cooldown: 3.6, windup: 0.45, count: 14, spread: 6.2832, projectileSpeed: 430, projectileDamage: 15, color: '#7fd8d0' },
    { id: 'riptide',     kind: 'charge',    cooldown: 5.4, windup: 0.5,  dashSpeed: 820, dashDuration: 0.6 },
    { id: 'geysers',     kind: 'zones',     cooldown: 8.0, windup: 0.8,  count: 6, zoneRadius: 140, spreadRadius: 420, damage: 26, warn: 0.9 },
    { id: 'drownedTide', kind: 'summon',    cooldown: 11.0, windup: 0.6, summonCount: 4, summonTypes: { drowned: 2, brinemite: 2 } },
    { id: 'tideWall',    kind: 'wall',      cooldown: 8.5, windup: 0.55, count: 14, spacing: 74, projectileSpeed: 380, projectileDamage: 18, gap: 2 },
    { id: 'steamJet',    kind: 'beam',      cooldown: 9.0, windup: 0.8,  length: 900, band: 34, damage: 24, sweep: 1.6, lifetime: 3.2, color: '#cfeef2' },
    { id: 'luremotes',   kind: 'seekers',   cooldown: 9.5, windup: 0.5,  count: 4, projectileSpeed: 380, projectileDamage: 24, turnRate: 3.2, maxSpeed: 540, color: '#9fe8ff' },
    // SIGNATURE — Quenching Ring: a ring of scalding quench-pools seals melee space.
    { id: 'quenchRing',  kind: 'mines',     cooldown: 9.0, windup: 0.9,  count: 10, ringRadius: 260, zoneRadius: 110, damage: 24, warn: 0.95 },
  ],
  phase2Attacks: ['crestWave', 'riptide', 'steamJet'],
}
```
(All numbers tunable.) **Scheduling in Descent**: the normal `BossDirector` clock is parked (`nextSpawnTime = Infinity` after construction — `src/systems/BossDirector.js:24` — so `update()` at Game.js:2707 never fires); instead the descent tick calls `this._spawnBoss('tidewarden')` (`src/core/Game.js:1971`) at the **midpoint of every 3rd floor** (depths 3, 6, 9, …). The floor timer PAUSES while the boss lives (the arena seal, Game.js:665, already suspends biome hazards via the `game.arena` gate at HazardSystem.js:198). Depth HP curve rides the existing minutes-based `bossHpMul` (Game.js:2018-2022) fed the same capped virtual clock as the waves, so encounter 1/2/3 land near 2.5×/4.4×/6.3× base HP under the `BOSS.maxHpMul` 7.0 ceiling (GameConfig.js:700-706). Tidewarden kills count toward `stats.totalBosses` and drop the standard boss chest — no special-case loot path.

**Boss floors are the gamble's teeth**: the gate AFTER a Tidewarden floor offers a bonus **+0.5 haul multiplier** (inside the 3.0 cap) — surfacing right after a boss kill is the "smart" exit; descending past it is the flex.

## 4. Quench / steam presentation

### 4.1 Undertow theme (mode-only — NOT in MAP_ORDER)
A maps.js-shaped theme object in `src/content/descent.js`, consumed unchanged by every existing theme reader — `MapRenderer.theme` (bg/groundFill/grade at `src/systems/MapRenderer.js:87-121`, weather at :254), the darkness governor (Game.js:861-867), obstacle regeneration (`obstacleSystem.generate(..., 'undertow')`, Game.js:857-860):
`{ id: 'undertow', name: 'The Undertow', subtitle: 'The Quenched Forge', bg: '#071016', groundFill: '#1c3a44', groundFillAlpha: 0.50, grade: '#3a7a8a', gradeAlpha: 0.20, darkness: 0.88, accent: '#8fe0e8', weather: 'steam', hazard: 'tidepool' }`.
In `_startRun`, `descentMode` overrides the theme resolution the same way the daily map override does (`_effectiveMapId`, `src/core/Game.js:561-564`) — the persisted `selectedMap` is never touched. Darkness deepens −0.03/depth to a 1.0 floor (tunable): descending literally darkens.

### 4.2 New visuals (all procedural, reduced-effects aware)
- **'steam' weather**: third branch in `MapRenderer.drawWeather` (`src/systems/MapRenderer.js:252-255` currently accepts only 'embers'|'snow'): ~56 pale `#cfeef2` motes that RISE (embers' upward math at :273-284) but draw source-over with slow horizontal drift — condensation, not fire. Skipped under `lowQuality` like the others (:253).
- **`tidepool` hazard kind**: new `BIOME_HAZARD` entry (`src/config/GameConfig.js:915-926`): `tidepool: { r: 120, warn: 0.9, duration: 7.0, tickDamage: 4, slowMul: 0.72, color: '#123a42', rim: '#6fd8d8' }` — spawned by the untouched `HazardSystem.updateBiome` cadence (`src/systems/HazardSystem.js:195-234`), armed via `biomeHazard = { kind: 'tidepool', ... }` (Game.js:875). Sim needs ZERO new update code (slow + tick are the shared biome branch, HazardSystem.js:50-73); only a draw-identity block joins the per-kind chain at HazardSystem.js:359-401: concentric ripple arcs + 2 seeded bubble dots, rim-lit like the others (:405).
- **Floodline**: screen-space overlay during the FLOOD phase — a translucent `#1c4a56` band rising from the bottom edge (0 → 22% of screen height over the 20 s warning, tunable) with a 2 px `#8fe0e8` crest line and a slow sine shimmer; drawn beside the vignette pass (screen-space, outside the camera transform — the MapRenderer vignette precedent, `src/systems/MapRenderer.js:15-16`). One fillRect + one stroke per frame; no gradient allocation.
- **Quench steam bursts**: enemies dying inside any tidepool emit a white steam `deathBurst` recolor (`#e8f6f6`) via the existing particle burst API (as used at HazardSystem.js:102); the flood sweep itself is a wall of the same bursts along the advancing edge, budgeted ≤ 40 particles/frame.
- **Audio**: `AudioSystem.setBiome` maps unknown ids to 'emberwood' (`src/systems/AudioSystem.js:297-300`), so PR1 is safe by default; PR4 adds an `undertow` entry to `BIOME_TUNE` (colder mode, +reverb — the per-biome recolor pattern at :301-305) plus a low "gate groan" stinger on the Tide Gate open, reusing the announcement-stinger idiom.

## 5. Save schema (additive only — the SaveSystem clamp+migrate pattern)
New top-level key in `defaultData()` (validated in `_validate`, `src/systems/SaveSystem.js:192-361`, following the `dailyRoad` idiom at :298-304; version stays 7 — migration is implicit-by-default per :198-200):
```
descent: { bestDepth: 0, runs: 0, totalBanked: 0, bossKills: 0, milestones: [] }
```
`milestones` validated as a deduped string-id list (`validateIdList`, SaveSystem.js:135-141). New accessor `recordDescentResult({ depth, banked, surfaced, bossKills })` mirrors `recordGauntletScore` (:671-677), returning `{ bestDepth }` for the NEW BEST banner. `descentMode` itself is never persisted. STATS tab gains two read-only rows (Best Depth / Coins Hauled) beside the gauntlet rows (`src/systems/MenuRenderer.js:1272`).

## 6. Verification hooks (designed in, not bolted on)
- Harness: `tools/artshot/harness.html` gains `?mode=descent` (sets `descentMode` before `_startRun`, exactly how the harness already boots real runs) and `&depth=N` (debug-jumps the descent state) so every PR's EXC:0 screenshot exercises the mode; `showcase=drowned,tidecaller,brinemite,depthmaw,tidewarden` verifies the sprite chain end-to-end on procedural fallbacks.
- Balance checks ride the existing debug clock (`_debugJumpToMinute`, `src/core/Game.js:1843-1847`) plus the new depth jump.

## PR plan

### PR1 — PR1 — Descent core: mode, floors, Tide Gate, haul, save keys

**Goal:** A fully playable bank-or-push Descent using ONLY existing enemies/hazards: PLAY-tab CTA, floor timer, flood sweep, Tide Gate overlay (SURFACE/DESCEND), depth scaling via virtual wave clock + descentScale, coin escrow + salvage, additive save block, harness ?mode=descent.

**Files:**
- `src/content/descent.js (NEW — theme, DESCENT tunables, weights-by-depth, currents table stub, milestones)`
- `src/core/Game.js`
- `src/systems/MenuRenderer.js`
- `src/systems/UISystem.js`
- `src/systems/SaveSystem.js`
- `src/config/GameConfig.js`
- `tools/artshot/harness.html`

**Work:**
- Add `startDescent` action + CTA using the canonical Crypts campaign-access gate and predecessor progress copy.
- descent state object + phase machine in _initRunState/_startRun; theme override via the _effectiveMapId idiom (Game.js:561-564); park BossDirector (nextSpawnTime=Infinity)
- Fold descentScale + descent typeWeights merge into _applyRunScale (Game.js:1887-1918); feed the capped virtual clock into waveDirector.getState calls (Game.js:1836, 2666)
- Tide Gate overlay: add to the overlay composition (Game.js:1638), victory-style input (Game.js:258-261, 404-411), UISystem draw; DESCEND heal 25% + reroll; SURFACE routes victory-leave
- Flood phase: spawner gate, no-drop sweep kill through the normal kill pipeline, minimal flood band placeholder
- Coin escrow (haul) + multiplier/salvage through _bankRunCoins (Game.js:1243); runSummary depth/haul fields (Game.js:1288-1290 idiom)
- SaveSystem: descent{} default + _validate block (dailyRoad idiom, SaveSystem.js:298-304) + recordDescentResult (mirrors :671-677); STATS rows
- harness ?mode=descent&depth=N params

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- harness.html?badge=1&seconds=35&mode=descent → EXC:0 screenshot showing floor timer + haul HUD
- harness screen=menu&tab=play screenshot shows the CTA (locked + unlocked states)
- Manual: descend twice, surface, confirm banked = haul×mult and bestDepth persisted across reload; die at depth 2, confirm 35% salvage; confirm an old save (no descent key) loads clean
- Adversarial review + squash-merge to main

### PR2 — PR2 — The Drowned family (4 types, procedural-first)

**Goal:** drowned / brinemite / tidecaller / depthmaw shipped with procedural art, wired into the Descent depth weights; tidecaller's tidepool-on-impact hook.

**Files:**
- `src/config/GameConfig.js`
- `src/entities/Enemy.js`
- `src/assets/ProceduralSprites.js`
- `src/entities/EnemyProjectile.js`
- `src/core/Game.js`
- `src/content/descent.js`

**Work:**
- Four ENEMY defs (stats table in spec) reusing behaviors 'spitter'/'charger'/plain + a knockbackMul def field for the Husk
- FRAMES_BY_TYPE entries (Enemy.js:67) → getEnemyAiFrames(t) || new procedural drawers (getDrownedFrames etc.)
- Tidecaller bolt impact stamps a mini tidepool into game.hazards (shared biome-branch shape, HazardSystem.js:50-73), live cap 8
- Depth-weight tables live in descent.js; merged via the segmentWeights spread seam (Game.js:1918)

**Verify:**
- node --check; validate-assets exit 0
- harness ?showcase=drowned,brinemite,tidecaller,depthmaw → EXC:0, all four render procedurally
- harness ?mode=descent&depth=5&seconds=35&badge=1 → EXC:0 with the family spawning; enemy count never exceeds 220 (badge)
- Adversarial review + squash-merge

### PR3 — PR3 — Tidewarden (apexBoss on the Bossforge pipeline)

**Goal:** The full 9-attack Tidewarden kit, boss-floor scheduling every 3rd depth with paused floor timer, depth HP curve, post-boss +0.5 haul bonus, procedural boss frames.

**Files:**
- `src/config/GameConfig.js`
- `src/core/Game.js`
- `src/assets/PixelBosses.js`
- `src/assets/ProceduralSprites.js`
- `src/content/descent.js`

**Work:**
- tidewarden ENEMY def (kit in spec — existing kinds only, verified vs GameConfig.js:401-458 + HazardSystem beam/zones/mines sims)
- Descent tick calls _spawnBoss('tidewarden') (Game.js:1971) mid-floor on depths 3/6/9…; floor timer pauses while boss lives (arena gate already suspends biome hazards, HazardSystem.js:198)
- Boss HP rides the capped virtual clock through bossHpMul (Game.js:2018-2022)
- FRAMES_BY_TYPE boss entry mirroring cindermaw (Enemy.js:112) with a new procedural drawer; post-boss gate haul bonus

**Verify:**
- node --check; validate-assets exit 0
- harness ?mode=descent&depth=3&seconds=45&badge=1 → EXC:0 with Tidewarden mid-fight (telegraphs visible)
- Manual: kill it → chest drops, totalBosses increments, gate shows +0.5 bonus; verify one-boss-at-a-time invariant holds
- Adversarial review + squash-merge

### PR4 — PR4 — Quench & steam presentation + tidepool hazard + audio

**Goal:** The mode looks and sounds like the Quenched Forge: 'steam' weather, tidepool biome hazard kind, rising floodline + flood sweep VFX, steam death bursts, undertow BIOME_TUNE.

**Files:**
- `src/systems/MapRenderer.js`
- `src/systems/HazardSystem.js`
- `src/config/GameConfig.js`
- `src/systems/AudioSystem.js`
- `src/systems/ParticleSystem.js`
- `src/core/Game.js`

**Work:**
- 'steam' branch in drawWeather (MapRenderer.js:252-255), lowQuality-gated
- BIOME_HAZARD.tidepool entry (GameConfig.js:915-926) + ripple/bubble draw identity in the biome-patch chain (HazardSystem.js:359-401) — zero new sim code
- Floodline screen-space overlay (one rect + crest stroke) + budgeted steam-burst wall on the sweep; steam puffs for in-pool deaths
- BIOME_TUNE.undertow (AudioSystem.js:301-305 pattern) + Tide Gate stinger

**Verify:**
- node --check; validate-assets exit 0
- harness ?mode=descent&seconds=35&badge=1 → EXC:0; second shot timed into the FLOOD phase shows the floodline
- reducedEffects on: weather + floodline shimmer skipped, badge still EXC:0, no FPS-governor regression on the frame-time badge
- Adversarial review + squash-merge

### PR5 — PR5 — Currents, milestones, balance pass + art-slot wiring

**Goal:** Undertow Currents live from depth 2, milestone rewards (coins/skin/case/title + achievements), best-depth menu chip, full-curve balance pass; ANIM_SHEETS/credits wiring for whichever drowned sheets the separate art session has produced (game ships either way).

**Files:**
- `src/content/descent.js`
- `src/core/Game.js`
- `src/content/achievements.js`
- `src/content/cosmetics.js`
- `src/systems/MenuRenderer.js`
- `src/assets/EnemySprites.js`
- `src/assets/enemies/*.png (NEW, only if produced)`
- `ASSET_CREDITS.md`

**Work:**
- Seeded Current draw (mulberry32 idiom, MapRenderer.js:32-41) + the 5 Current effects through existing seams; gate preview text
- Milestones at depths 3/5/7/10 via existing cosmetics/case/achievement unlock plumbing; NEW BEST banner off recordDescentResult
- Balance: tune floorLength/depthTimeSkip/descentScale against the 220-cap badge and boss TTK at depths 3/6/9 using harness depth jumps
- Add ANIM_SHEETS entries + credits rows ONLY for sheets that exist (validate-assets enforces)

**Verify:**
- node --check; validate-assets exit 0 (with and without new PNGs staged)
- harness ?mode=descent&depth=6&badge=1 → EXC:0 with a Current banner visible
- Manual: milestone unlock fires once, persists, re-run doesn't re-grant; menu chip shows best depth
- Adversarial review + squash-merge

## Data & save changes

NEW content file: `src/content/descent.js` — UNDERTOW_THEME (maps.js-shaped, mode-only, never in MAP_ORDER), DESCENT tunables block, drowned weights-by-depth tables, CURRENTS table (5 entries), MILESTONES table. NEW GameConfig blocks: `ENEMY.drowned/brinemite/tidecaller/depthmaw/tidewarden`, `DESCENT` (or re-exported from descent.js), `BIOME_HAZARD.tidepool`, `BIOME_TUNE.undertow` (AudioSystem). NEW save keys (additive only, version stays 7 via the implicit-default migration at SaveSystem.js:198-200): `descent: { bestDepth: 0, runs: 0, totalBanked: 0, bossKills: 0, milestones: [] }` validated with the dailyRoad idiom (SaveSystem.js:298-304) + `recordDescentResult` accessor. NEW asset slots (art PR only, non-blocking): `src/assets/enemies/{drowned,brinemite,tidecaller,depthmaw}_anim.png` in ANIM_SHEETS (EnemySprites.js:33) + Tidewarden sheet on the boss chain, each with an ASSET_CREDITS.md row. Extended (not new): FRAMES_BY_TYPE (Enemy.js:67), _applyRunScale layers (Game.js:1880), overlay composition (Game.js:1638), runSummary fields (Game.js:1288), MenuRenderer PLAY CTA + STATS rows, MapRenderer drawWeather third branch, HazardSystem biome-draw identity block.

## Balance numbers (all tunable)

All values are tunable starting points. | Number | Value | Rationale | — Descent unlock: honest Crypts access after the exact Emberwood and Hollow Reach trios · Floor length: 150 s (just under one BOSS.spawnInterval, keeps floors brisk) · Flood warning: 20 s · depthTimeSkip: 120 s/depth, capped at 900 s total (hypergrowth wall lands ~depth 8-9 as the designed ceiling) · descentScale per depth d: hp ×(1+0.08(d−1)), dmg ×(1+0.06(d−1)), speed ×(1+0.02(d−1)), elite ×(1+0.10(d−1)), cap ×(1+0.03(d−1)), interval ÷(1+0.04(d−1)) — all inside the 220/0.85 clamps at Game.js:1891-1894 · Haul multiplier: 1 + 0.25(depth−1), cap 3.0; +0.5 bonus offered at post-Tidewarden gates (inside cap) · Death salvage: 35% of haul, no multiplier · Descend bonus: 25% maxHp heal + 1 reroll · Boss floors: every 3rd depth (3/6/9…), floor timer paused during fight · Drowned Husk 110 hp/100 spd/15 contact/0.5× knockback · Brinemite 12 hp/320 spd/7 contact · Tidecaller 40 hp, fireInterval 2.8 s, bolt 14 dmg, mini-tidepool r70/slow 0.8/2.5 s, live cap 8 · Depthmaw 190 hp, dash 700 @ 0.7 s windup · Tidewarden 1500 base hp (rides baseHpMul 1.5 + minutes curve, Game.js:2022), 9 attacks (cooldowns 3.6–11 s, windups 0.45–0.95 s, damages 15–28 — full kit in spec) · tidepool patch r120/warn 0.9/dur 7/tick 4/slow 0.72 under maxActive 5 (GameConfig.js:919) · Currents: 1 from depth 2, 2 from depth 6 · Milestones: depth 3 = 400 coins, 5 = wand skin, 7 = free case, 10 = title · Flood-sweep particle budget ≤ 40/frame; flood kills give credit but zero drops (anti-farm).

## Art needs (non-blocking)

- Blender pipeline (tools/blender/) OR higgsfield concept→2×2 pose grid for the TIDEWARDEN (non-humanoid → 2D grid route per CLAUDE.md; Meshy clips are biped-only) — procedural PixelBosses-chain fallback ships in PR3, sheet swaps in later, non-blocking
- higgsfield Nano Banana 2, one 2×2 grid per drowned creature (drowned husk, brinemite, tidecaller, depthmaw), img2img with each type's procedural sprite as reference media, approved grid job ids as style references, palette locked 'cold teal/brine/bone, NO fire, NO lava, NO orange', sliced with tools/artshot/strip-frames.mjs (--anchor=bottom for husk/depthmaw, center for brinemite/tidecaller) — separate session, never blocks (PR2 ships procedural)
- Procedural-only (no AI art ever needed): tidepool hazard decals, 'steam' weather motes, floodline overlay, quench steam bursts — all flat fills/strokes per the HazardSystem biome-patch convention (HazardSystem.js:332-406)

## Risks

- PERF — deep floors stack drowned weights, Currents, tidepools and a boss: mitigated from PR1 by construction — descentScale composes through _applyRunScale's hard clamps (maxAlive ≤ 220 at Game.js:1894, eliteChance ≤ 0.85 at :1891), tidepools ride BIOME_HAZARD.maxActive 5 + the arena gate (HazardSystem.js:198), tidecaller mini-pools hard-capped at 8, flood-sweep particles budgeted ≤ 40/frame, and every PR's harness badge must show EXC:0 at depth ≥ 5.
- SAVES/ECONOMY — a coin-escrow bug or haul-multiplier exploit could mint coins or corrupt saves: mitigated by additive-only schema validated with the proven dailyRoad idiom (SaveSystem.js:298-304), haul multiplier capped 3.0, flood kills dropping nothing (no idle farming), banking routed through the existing _bankRunCoins guard (Game.js:1243 — bankedThisRun latch prevents double-bank), and descentMode never persisted so a crashed run can't wedge the menu.
- BALANCE/MOBILE — the virtual wave clock double-dips with descentScale making depth 4+ a wall (or trivial), and the Tide Gate must be thumb-usable: mitigated by keeping descentScale mild (the virtual clock is the primary ramp), capping the clock skip at 900 s so hypergrowth is the deliberate ceiling, the 25% heal + reroll on every descend, PR5's dedicated balance pass using harness depth jumps, and gate buttons ≥ 140×90 logical px reusing the already-touch-proven victory-overlay input path (Game.js:404-411).

## Uniqueness & boundaries

UNDERTOW is the only update in the 20 that changes the SHAPE of a run: every other mode is open-ended time (base runs, gauntlet), a fixed daily (Daily Road, Rite Trial), boss-only (Boss Rush), or defense (Last Hearth) — only the Descent has discrete floors with an explicit mid-run bank-or-push decision, an escrowed reward at stake, and a depth record. It is also the only update before #8 that adds an entire new enemy FAMILY, and the only one that gives the ember world its elemental counterweight (water/steam). Sharpest boundaries: #11 FORGEHEART owns biome 5 and the overworld map roster — the Undertow theme deliberately never enters MAP_ORDER/map select and adds no overworld biome (it's a mode-scoped theme object; #11 depends on 6 precisely because it inherits the mode-theme + steam-VFX plumbing for its slag/ashfall). #15 ASHBOUND owns PERSISTENT difficulty (its Torment ladder is a pre-run, save-backed prescription; Descent's depth scaling is per-run, resets at the gate, persists nothing but records — I ship no ladder UI, no stacking modifiers between runs). #16 owns prestige currency — the haul is plain coins, deliberately no new currency. #13 LAST HEARTH owns stand-and-defend — the Descent never asks you to hold a point. #4 BOSSFORGE owns the boss pipeline/perf refactor — Tidewarden is a pure consumer, adding no new attack kinds. #2 EMBERGLASS owns the card compositor — the depth record line lands in runSummary now; its share card comes free when #14/#15 reuse the compositor.

## Roadmap corrections found while grounding

- Task prompt calls WaveDirector.getState a 'pure function' — near-true but not strictly: it reads instance state (this.pressure, WaveDirector.js:175) alongside gameTime. It IS side-effect-free and returns a fresh object literal per call (relied on by _applyRunScale's mutate-safely contract, Game.js:1876-1878), so the Descent virtual-clock reuse is sound — but the spec feeds the virtual clock at the two existing call sites (Game.js:1836, 2666) rather than treating getState as context-free.
- All roadmap-synopsis seams verified as claimed: maps.js biome/theme contract (maps.js:24-108, consumed at MapRenderer.js:87-121 and Game.js:839-875), HazardSystem.updateBiome cadence spawner (HazardSystem.js:195-234), GameConfig BIOME_HAZARD (GameConfig.js:915-926), Enemy FRAMES_BY_TYPE layered fallback (Enemy.js:67-114), the 2×2-grid ANIM_SHEETS recipe slot (EnemySprites.js:33-38). One load-bearing detail worth stating: the segmentWeights merge is a spread ({...ws.typeWeights, ...this.segmentWeights}, Game.js:1918), so it can ADD enemy types absent from the wave's native table — this is what lets Descent inject the drowned family without touching WAVES, and the spec depends on it.
- Note for PR2: adding ANIM_SHEETS entries before the PNGs exist would fail loads harmlessly at runtime (loadAnimOne resolves false → fallback) but tools/validate-assets.js gates on declared assets — so sheet entries + credits rows land only in the art-wiring step (PR5), procedural drawers carry PR2.

## Binding cross-spec rulings affecting this update

- **[#4 BOSSFORGE vs #6 UNDERTOW vs #11 FORGEHEART vs #12 CINDERS & SCRIPTURE]** Boss arithmetic disagrees across four specs: #4 remodels "the 12 bosses" and Boss Rush runs "all twelve"; #6 adds the Tidewarden apex (update 6); #11 claims its three bosses "complete the roster to 15" (12+3, silently excluding Tidewarden); #12's codex ships "THE_TWELVE (12 boss ids)" at update 12 when 16 boss-class enemies exist.
  **RULING:** Canonical taxonomy, to be quoted verbatim in all four specs: "The Twelve" is the fixed set of legendary campaign duels in GameConfig.js:379-663 and is what #4 remodels, #7 ritualizes, and #12's Twelve page commemorates. Forgeheart's Bellows/Smith/Anvil (#11) are campaign roster additions 13–15: #11 must append them to the data-driven Boss Rush pool and declare their bossRites rows (already in its PR4). The Tidewarden (#6) is Descent-mode-exclusive: excluded from roster counts, Boss Rush, The Twelve, and Thresholds; it appears in the codex per the next ruling. Boss Rush's roster is registry-driven, not a hardcoded twelve.

- **[#12 CINDERS & SCRIPTURE vs #6 UNDERTOW, #8 GLOAMCALL, #11 FORGEHEART, #16 NIGHTFALL CYCLES]** #12's fixed counts are stale against its ship position: BESTIARY_ROSTER has 21 entries but #6 ships 4 drowned creatures six updates earlier (roster should be 24+); "26 relics" equals TODAY'S relics.js count, ignoring #8's umbral relics that ship before it; the boss pages ignore #11's three bosses and #6's Tidewarden; and #16 later adds 6 reliquary relics and 5 twilight elites that would strand the Archive's 100% Curator's Lantern.
  **RULING:** #12 owns the codex but must author it against the post-#11 world AND make it append-safe: BESTIARY_ROSTER includes the drowned family and twilight-elite slots come free via registry-driven pages; the Relics page and shelfProgress() compute denominators from the live relics.js roster, never a literal; boss coverage = The Twelve page (fixed) + roster-driven entries for Forgeheart bosses and the Tidewarden. Archive completion rewards CHECKPOINT at claim time — once claimed they are never revoked or re-locked when #16 (or any later update) grows a roster. #16's spec adds one line: its reliquary relics and twilight elites surface in the codex as data appends only, no codex UI changes.

- **[#14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)]** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.
  **RULING:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.

- **[#9 WAYLIGHT vs #11 FORGEHEART (and #6 UNDERTOW)]** #9 ships per-biome POI budgets for the four biomes existing at its ship date; #11 adds the forgeheart biome later but its append-only data list never touches waylight.js — Forgeheart would ship with undefined POI budgets. Separately, #6's mode-only Descent floors are not a biome and must not accidentally receive POIs.
  **RULING:** #9 owns WaylightSystem and must make it default-safe: an unknown biome id yields a zero budget (no POIs) rather than a crash. #11 owns Forgeheart's content and must append a forgeheart budget row to waylight.js in its PR1. #6 adds one line to its spec: WaylightSystem is inert in Descent (mode floors are not MAP_ORDER biomes, so the zero-budget default applies).

- **[#6 UNDERTOW vs #11 FORGEHEART (hazard semantics)]** #11's headline claim — slagflow is "the game's first enemy-affecting terrain... every other hazard touches only the player" — silently constrains #6's earlier tidepool hazard, which #6's spec never commits to.
  **RULING:** Locked in both specs: #6's BIOME_HAZARD.tidepool affects the player (and player-side allies) ONLY — it never damages or slows enemies. Enemy-affecting terrain is minted in #11's slagflow and remains #11's exclusive claim. Both extend the same BIOME_HAZARD config block append-only.
