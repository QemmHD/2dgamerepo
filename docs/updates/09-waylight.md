# Update #9: WAYLIGHT — The Living Road

*Era III — The World Alight (deps: 1 REFORGED, 5 THE KINDLED TROOP)*

**Value verdict (ADDS):** The claim holds: nothing in the current systems list gives the player a reason to leave spawn orbit — all pressure comes TO the player. Player-initiated, place-anchored set-pieces (bell killbox, rescues, waystones) are a new interaction category, and the brazier/steam-vent props make terrain a weapon for the first time. Skeptic flag: cairns (lore lines) are the thinnest POI — acceptable as budget filler among 8-9 seeded reasons, but the bell and rescues carry the update.

## What it adds

The world stops being a static obstacle field and becomes a road with authored, interactive set-pieces: caged-monkey rescues that hand you a temporary Troop familiar, waystones that permanently punch holes in the Emberlight veil, a timed caravan strongbox, a ruin bell that wheels the entire horde into a killbox you prepared, and lore cairns — plus two new interactive prop archetypes (brazier, steam vent) that make terrain itself a weapon. Every run now has 8–9 seeded reasons to traverse the map instead of orbiting spawn.

## Design spec

# WAYLIGHT — The Living Road: Implementation Spec

## 0. Verified integration seams (all claims checked against code)

| Roadmap claim | Verdict | Citation |
|---|---|---|
| "seeded `_placeStructures` pass" exists | **VERIFIED, with nuance** (see codeCorrections) | `src/systems/ObstacleSystem.js:110` (mulberry32 rng seeded by `P.seed ^ strHash(biomeId) ^ worldW/H`), `:116` (`this._placeStructures(rng, theme, tint)` runs before props), `:166-190` (the pass itself) |
| Shrine is the walk-onto template | VERIFIED | `src/entities/Shrine.js:27-34` (`update` returns true on `circleOverlap`), consumed at `src/core/Game.js:3187-3197`; trigger radius from `WICK_ROADS.shrinePickupRadius` (`src/config/GameConfig.js:1440`, = 46) |
| Spawner "bias hooks" | **CORRECTED** — no positional bias hook exists (see codeCorrections) | `src/systems/Spawner.js:34-53` reads only `waveState`; capped burst spawns instead ride `Game._spawnBossSupport` (`src/core/Game.js:2858`, ring placement at `:2138`) |
| LightingSystem priority lights | VERIFIED | `src/systems/LightingSystem.js:113-134` — `addLight(wx, wy, radius, color, intensity, priority)`; priority 0 = always, 1 = pickup-capped (`GFX.lighting.pickupLightCap` = 40, `GameConfig.js:1397`), 2 = budgeted under `maxLights` = 96 (`GameConfig.js:1396`); off-buffer lights auto-culled at `:121-123` |
| Troop handoff target (update 5) | Not yet in code (grep for troop/familiar: 0 hits) — dep 5 ships first; spec'd as an interface contract with a graceful fallback | — |

Other load-bearing seams verified for this spec: `Game._clearSpot` (`Game.js:1849`) for safe placement; `Game._dropChest` (`Game.js:2277-2280`) for the caravan reward; `Enemy.update(dt, player, …)` uses its `player` arg **only for steering/aiming** (`src/entities/Enemy.js:370-408`) — contact damage lives in CollisionSystem via `_resolveCombat` (`Game.js:2632`) — which is what makes the bell-lure proxy safe; `Enemy.applyBurn` (`Enemy.js:365-368`) and the slow channel (`Enemy.js:381-382`) power the brazier/vent behaviors with zero new status machinery; `WaveDirector.announce(text, lifetime, color)` (`src/systems/WaveDirector.js:90-92`) is the banner channel; the boss off-screen arrow (`src/systems/UISystem.js:851-881`) is the template for the caravan chevron; the harness `tp=` teleport (`tools/artshot/harness.html:159-171`) is the screenshot-verification hook.

## 1. Architecture: what is NEW vs REUSED

**NEW modules**
- `src/systems/WaylightSystem.js` — owns POI seeded placement, per-frame state machines (proximity channels, timers, lure window), light registration, and reward resolution callbacks into Game. Shaped like LieutenantDirector + HazardSystem: constructed once, `generate(worldW, worldH, biomeId, obstacleSystem)` on biome change, `update(dt, game)`, `draw(ctx, game, L)`.
- `src/entities/Poi.js` — one class, five kinds (`rescue | waystone | caravan | bell | cairn`), Shrine-pattern (`Shrine.js:15-34`): position, state, bobTimer, `update(dt, player)` proximity test, procedural `draw(ctx)` per kind. POIs are entities (drawn/culled in the entity layer like shrines, `Game.js:3479-3483`), NOT obstacles — none of the five block movement, so no collision registration needed.
- `src/content/waylight.js` — POI defs, per-biome budgets, cairn flavor-line pool (12 lines), first-encounter hint strings, cairn boon table.

**REUSED / extended**
- `ObstacleSystem` — extended with (a) a `this.structures = []` registry recorded in `_placeStructures` (center, style, outer half-extents — currently discarded at `ObstacleSystem.js:173-189`), consumed by bell placement; (b) `mulberry32`/`strHash` (`ObstacleSystem.js:33-49`, currently module-private) exported so WaylightSystem shares the exact seeding discipline; (c) two new prop archetypes flow through the normal weighted-prop pipeline untouched.
- `mapObjects.js` — `brazier` + `steamVent` added to `MAP_OBJECTS` and appended to `BIOME_THEME` prop weights (append-only).
- `LightingSystem.addLight` — waystones (priority 0), everything else waylight (priority 2).
- `Game._spawnBossSupport` (`Game.js:2858`, the alive-cap-gated summon path) — rescue ambush + caravan guards, so waylight spawn pressure can never breach `maxEnemyCap`.
- `Game._dropChest` + chest overlay pipeline — the caravan reward.
- `WaveDirector.announce` — all waylight banners.
- `AudioSystem._bell`/`_metal` (`AudioSystem.js:479, 550-551`) — three new thin cue methods composed from existing synth primitives.
- `SaveSystem` numeric-stats auto-validation (`SaveSystem.js:46-48` documents the pattern: "all numeric → auto-validated by the stats loop in _validate").

**Game.js wiring (4 hooks, mirroring shrines)**
1. Construct in `_initRunState` near `this.shrines = []` (`Game.js:639`); call `waylight.generate(...)` in `_startRun` right after `obstacleSystem.generate` (`Game.js:857-860`), keyed on the same `_obstacleBiome` latch.
2. `waylight.update(dt, this)` inserted in the update spine after `_updateRewardOverlays` (`Game.js:2634`) — POIs never open freeze-overlays themselves (the caravan chest does, via the existing chest path).
3. `waylight.draw(ctx, this, L)` in the entity render pass beside the shrine loop (`Game.js:3479-3483`), using the same `cull()`.
4. Bell lure: in `_updateEnemies` (`Game.js:2813-2821`), swap the steering target for lured enemies (§4.4).

## 2. Seeded placement (the "living road" layout)

`WaylightSystem.generate` builds its own deterministic stream: `mulberry32(WAYLIGHT.seed ^ strHash(biomeId + ':waylight') ^ (worldW*73856093) ^ (worldH*19349663))` — same recipe as `ObstacleSystem.generate` (`ObstacleSystem.js:110`) but a **separate stream**, so it consumes zero draws from the obstacle rng and existing world layouts are bit-identical after this update (zero regression risk, trivially screenshot-diffable).

Placement rules per POI (rejection-sampled, 60 attempts each):
- ≥ 1100px from world origin (outside `clearRadius` 520 / structure clear 820, `mapObjects.js:149,159`) — POIs are things you travel TO (tunable).
- ≥ 700px from every other POI (tunable).
- ≥ 400px `edgeMargin` (tunable).
- `!obstacleSystem.isBlocked(x, y, 90)` (`ObstacleSystem.js:379-385`).
- **Bell only**: anchored 220px outside the doorway axis of a randomly chosen entry from the new `obstacleSystem.structures` registry — the building's solid side walls + narrow doors (`ObstacleSystem.js:226-233`, walk-through refuge geometry) ARE the killbox funnel. Falls back to open-field placement if no structure fits.

**Budget per run (per biome map, tunable):** 2 rescues, 3 waystones, 1 caravan, 1 bell, 2 cairns = **9 static entities** (~0 perf weight; cf. 240 obstacle cap). Fixed at generate; no mid-run re-seeding in v1 (endless runs keep whatever remains).

## 3. Shared interaction UX

Two interaction grammars, both touch-native (position-based, no new buttons — critical for update 3's touch inputs and update 18's gamepad, which get them for free):
- **Walk-onto (instant)** — waystone, cairn, bell. Shrine pattern exactly: `circleOverlap` at radius 56 (tunable; shrine uses 46).
- **Proximity channel** — rescue (1.8s), caravan strongbox (3.0s). While the player stands within 110px, a progress arc (12px stroke, ember-gold, 64px radius) fills over the POI; leaving the radius resets it to 0; taking damage does NOT interrupt (anti-frustration). The world does NOT freeze — channels are live-combat tension, the anti-overlay.
- Every POI idles with a small priority-2 light (radius 110, intensity 0.6) + a 2px bob like Shrine (`Shrine.js:37`) so it reads through the veil.
- First encounter of each kind fires a one-line hint via `waveDirector.announce` (e.g. "A CAGED WICK — STAND CLOSE TO BREAK THE LOCK", 3.0s, `#ffce7a`), latched per-run in WaylightSystem.
- **Boss gate**: channels cannot START and the bell cannot ring while a boss is warned/alive (`bossOnField` check mirrors the spawner gate, `Game.js:2769-2772`) — waylight never intrudes on the boss setpiece (that beat belongs to update 7).

## 4. The five POI events — full rules

### 4.1 RESCUE — "The Caged Wick"
- **Prop**: iron-banded wooden cage, 96×110px visual, a small monkey silhouette inside (procedural: dark bars over an animated 2-frame huddle; eyes catch the light). Non-colliding.
- **Trigger**: 1.8s channel (tunable) within 110px.
- **On release**: cage door swings (0.4s anim) → **ambush**: 10 enemies (tunable; 8 on easy, 12 on hard) of the current wave's `typeWeights` spawn on a 550–750px ring via the `_spawnBossSupport` path (`Game.js:2858`) — alive-cap-gated by construction. Banner: "THE CAPTORS RETURN" (`#ff6a5a`).
- **Troop handoff (the headline)**: the freed monkey sprints to the player (2-frame run, 420px/s) and on contact calls the update-5 interface: `game.troop.addTemporary({ source: 'waylight', element: <random element the player currently owns, else 'ember'>, duration: 90, statScale: 0.75 })` — a wand-bearing familiar at 75% of a rostered familiar's stats for 90s (both tunable). **Contract with update 5**: TroopSystem must expose `addTemporary(spec) → bool` honoring its own entity/AI budget and rendering temporaries with a fading ember-outline in their last 10s. **Cap: 1 temporary rescue familiar** — a second rescue while one lives refreshes the timer and pays 25 coins instead. **Fallback** (defensive, ships in PR2): if `game.troop?.addTemporary` is absent, the rescue pays 40 XP + a 6-coin burst (`_dropCoinBurst`, `Game.js:2302`) — the update never hard-depends on 5's internals.
- **Counters**: `stats.rescuesTotal++`.

### 4.2 WAYSTONE — "Veilstone"
- **Prop**: 150px standing stone, carved wick sigil (echoes Shrine's rune, `Shrine.js:66-71`), dark until lit; lit = sigil glows + a crown flame.
- **Trigger**: walk-onto, instant, one-shot; 0.6s flare (expanding ring via `_spawnRing`, `Game.js:1344`).
- **Effect (the fantasy: you permanently push back the dark)**:
  - Permanent-for-the-run **priority-0 light**: radius 520 (tunable; player light is 360, `GameConfig.js:1400`), color NEW `LIGHT_COLORS.waystone = '#ffce7a'`, intensity 0.9. Registered every frame it's on-screen from `waylight.draw`; max 3 per map keeps the priority-0 addition bounded (§8 perf). Note the player-light "never reveals more of the map" rule (`Game.js:3444-3447`) is deliberately inverted here — punching the veil at a FIXED landmark is the reward, and it cannot creep because waystones don't move.
  - **Hearth ring**: within 260px of a lit waystone the player regens +1.5 hp/s (tunable) — a breather beacon that turns lit stones into route waypoints.
  - One-time 15 coins + 20 XP.
- **Counters**: `stats.waystonesLit++`.

### 4.3 CARAVAN — "The Ashbound Caravan"
- **Prop**: wrecked wagon (200×140px, tilted, one wheel off) + strongbox at its foot. Non-colliding (sits visually against terrain).
- **Arm**: dormant until the player first comes within 600px → banner "AN ABANDONED CARAVAN — THE ASH TAKES IT IN 45s" (`#ffd166`) + **45s countdown** (tunable) + an off-screen **edge chevron** cloned from the boss arrow (`UISystem.js:851-881`; gold, shows distance + mm:ss, drawn only while armed).
- **Claim**: 3.0s channel at the strongbox. Starting the channel spawns **2 elite-tagged guards** ("scavengers", elite roll forced true through the `_spawnBossSupport` spec) at 500px — contesting the claim.
- **Success**: strongbox pops a Chest via `_dropChest` (`Game.js:2277`) at the wagon — the full existing chest walk-on + freeze-overlay reward pipeline (`Game.js:3172-3183`) unchanged. `stats.caravansClaimed++`.
- **Timeout**: the box crumbles (ash particle burst), drops 5 consolation coins, POI becomes inert scenery. No punishment beyond the loss.
- 1 per run — scarcity is the tension.

### 4.4 BELL — "The Hollow Bell" (the killbox)
- **Prop**: 190px ruined bell-frame (two posts + crossbeam + verdigris bell), placed at a structure doorway (§2). 2-frame swing when rung.
- **Trigger**: walk-onto (radius 56). **One ring per bell per run** (tunable; latched).
- **On ring**: screen shake (`_shake`, pattern at `Game.js:3243`), a 900px shock ring, deep toll (§6), banner "THE HOLLOW BELL TOLLS" (`#c9b8ff`). Then the wheel: one O(n) pass over `this.enemies` — every active **non-boss, non-lieutenant** enemy within 2400px (tunable) gets `e._lureTimer = 8.0` (tunable) and the bell's coords.
- **Lure mechanics**: in `_updateEnemies` (`Game.js:2813-2821`), a lured enemy is stepped with a shared **lure proxy** `{x: bell.x, y: bell.y, vx: 0, vy: 0}` passed as the `player` arg of `e.update(...)`. Safe because Enemy.update reads that arg only for steering/aim (`Enemy.js:370-408`); real contact damage vs the actual player still resolves in CollisionSystem (`Game.js:2632`); spitters firing their volleys at the bell reads as "maddened by the toll". Bosses/lieutenants excluded (bossLead reads target velocity, `Enemy.js:405-408`, and the boss beat is sacrosanct). Two added Enemy fields (`_lureTimer`, decremented in Enemy.update; falls back to normal chase at 0) — no allocations, no new update pass.
- **Payoff window**: for the 8s lure + 6s afterglow, any non-boss enemy dying within 420px of the bell drops **+50% coins (ceil)** and counts **double toward combo**. The killbox is player-authored: the funnel is the building geometry, the pre-seeded damage is the player's AoE/hazards, and the two guaranteed braziers (§5) near each bell are the ignitable trap.
- **Suppression**: cannot ring while `bossOnField` or while `this.arena` is up (enemies are confined, `Game.js:2764`) — the walk-on simply doesn't fire, with a dim "the bell is silent" 1.5s hint.
- **Counters**: `stats.bellsRung++`.

### 4.5 CAIRN — "Keeper's Cairn"
- **Prop**: knee-high stone pile + ember-script tablet (72×80px).
- **Trigger**: walk-onto, instant, one-shot.
- **Effect**: one flavor line from a 12-line pool in `waylight.js` shown via the announce channel (4s, `#ffd3ec`) + one deterministic-per-cairn minor boon (seeded at generate, so the same cairn gives the same boon every run — learnable routes): heal 15% max HP **or** +10% move speed for 30s (rides the existing transient-buff style, capped by `_applyPlayerCaps`, `Game.js:2753`) **or** 10 coins. `stats.cairnsRead++`.
- **Deliberate boundary**: NO codex, NO persistent lore pages, NO grave-marker vignettes — update 12 (CINDERS & SCRIPTURE) owns those; its Codex can later index these same 12 lines.

## 5. Interactive prop archetypes (brazier, steam vent)

Placed as ordinary `MAP_OBJECTS` through the untouched weighted-prop pipeline (`ObstacleSystem.js:151-160`) so collision/draw/painter-sort are free; WaylightSystem scans `obstacleSystem.obstacles` once at generate to build its interactive registry (obstacles own the body, waylight owns the behavior):
- **`brazier`** — circle r=24, size 64×96, `blocksLOS: false`, weight 6 in emberwood/hollowreach/crypts, 8 in dunes (append-only `BIOME_THEME` edits, `mapObjects.js:117-138`). Walk-onto ignites (one-shot): candle-style light (`LIGHT_COLORS.candle`, radius 120 = `candleRadius`, `GameConfig.js:1406`, priority 2, matching the decoration-candle pattern at `MapRenderer.js:210-211`) + an **enemy fire aura**: every 0.5s, enemies within 90px get `applyBurn(8 dps × player.fireRoundScale, 2.0s)` (`Enemy.js:365-368`) — damage then rides Game's existing `_tickStatuses` burn owner (`Game.js:2317`), so no new damage path exists. Two braziers guaranteed within 400px of each bell (killbox synergy), the rest scattered.
- **`steamVent`** — circle r=20, size 52×40, `blocksLOS: false`, weight 5 (crypts/hollowreach only). Not ignitable: it erupts every 6s for 1.5s (tunable); enemies crossing during an eruption get the existing slow channel (`e.slowTimer = 1.2, e.slowMul = 0.55` — `Enemy.js:381-382`; deepest-wins semantics already handle stacking). Player unaffected. A white particle plume via ParticleSystem on eruption, only when on-screen.

Both stay fully procedural in `Obstacle.js`'s draw language (every consumer must keep the procedural fallback working, per CLAUDE.md).

## 6. Audio (3 new thin methods on AudioSystem, composed from existing primitives)
- `bellToll()` — `_metal` at bell ratios (the inharmonic hit at `AudioSystem.js:479` already documents "bell/anvil ratios") at 98Hz + `_bell(t+0.1, 196, 0.12)` + `_bell(t+0.5, 147, 0.08)`, ~2.5s decay. The biggest single cue in the game short of boss death.
- `waystoneLight()` — rising `_bell` pair (523→784) + airy noise shimmer; cousin of `shrineChime` (`AudioSystem.js:798-801`) but warm-gold, not relic-pink.
- `cageOpen()` — short filtered noise snap (wood) + one `_bell(1046, 0.06)`.
Caravan/cairn reuse `chest()` and `shrineChime()` respectively.

## 7. Save schema (additive only) + config
- `stats.rescuesTotal`, `stats.waystonesLit`, `stats.bellsRung`, `stats.caravansClaimed`, `stats.cairnsRead` — all numeric, added to `defaultData().stats` (`SaveSystem.js:35-54`); the existing numeric-stats validation loop auto-migrates old saves to 0 (`SaveSystem.js:46-48`). **No other keys. No run-state persistence** — POI state is run-scoped exactly like chests/shrines (a mid-run refresh loses it; identical to today's behavior).
- NEW `WAYLIGHT` config block in `GameConfig.js` (beside `WICK_ROADS`, `GameConfig.js:1439-1443`) holding every number in §9; NEW `LIGHT_COLORS.waystone`.

## 8. Failure/edge thinking (designed in from PR1)
1. **Perf — lights**: worst case adds 3 priority-0 waystone lights + a handful of priority-2 POI/brazier lights. Priority-2 lights are hard-capped by `maxLights` = 96 (`LightingSystem.js:117`) and off-screen lights are culled before blitting (`:121-123`); waystones are capped at 3 by budget. PR1 verification includes a `?seconds=35` harness run at the enemy cap with all 3 waystones lit via `tp`.
2. **Perf — bell**: the wheel is one O(180) tag pass at ring time + one branch per enemy per frame while lured; zero allocations (the proxy is a single reused object on WaylightSystem). Ambush/guard spawns go exclusively through the alive-cap-gated `_spawnBossSupport` path, so 180/220 caps hold by construction.
3. **Saves**: additive numeric stats only, auto-validated — an old save and a new save round-trip identically (PR1 verify includes a localStorage round-trip snippet in the harness console).
4. **Balance runaway**: rescue familiar capped at 1 temporary + 75% stats + 90s; bell coin bonus confined to a 14s window and +50%; caravan is one standard chest (existing reward tables); cairn boons are one-shot and cap-clamped. Nothing multiplies with itself.
5. **Mobile/touch**: every interaction is positional (walk/stand); channel arcs are 64px-radius and read at phone scale; the chevron reuses the proven boss-arrow geometry.
6. **Determinism debt (update 17)**: placement is already seeded; the live `Math.random` sites this update adds (ambush type picks via the support-spawn path, cairn boon is seeded NOT random) are listed in a `// DETERMINISM:` comment block in WaylightSystem for 17's audit — deliberately few.

## 9. What ships procedural vs art-pipeline
Everything renders procedurally on day one (Shrine-grade canvas drawing). Blender/higgsfield passes are separate-session, non-blocking upgrades (see artNeeds).

## PR plan

### PR1 — PR1 — Waylight foundation: system, POI entity, waystones + cairns

**Goal:** Ship the WaylightSystem skeleton with seeded placement, the two simplest walk-onto POIs (waystone, cairn), lighting, save counters, config, and harness hooks — independently playable and verifiable.

**Files:**
- `src/systems/WaylightSystem.js (NEW)`
- `src/entities/Poi.js (NEW)`
- `src/content/waylight.js (NEW)`
- `src/config/GameConfig.js (WAYLIGHT block + LIGHT_COLORS.waystone)`
- `src/systems/ObstacleSystem.js (export mulberry32/strHash; record this.structures in _placeStructures)`
- `src/core/Game.js (init/generate/update/draw hooks at :639, :857, :2634, :3479)`
- `src/systems/SaveSystem.js (5 numeric stats keys)`
- `src/systems/AudioSystem.js (waystoneLight)`
- `tools/artshot/harness.html (tp=poi:<kind> teleport, following the tp=building pattern at :162-164)`

**Work:**
- Seeded placement pass with rejection rules (§2) on a separate mulberry32 stream
- Poi entity with walk-onto grammar, bob, idle priority-2 light
- Waystone: relight flare, permanent priority-0 light, hearth-ring regen, one-time reward
- Cairn: seeded boon table + flavor-line pool + announce integration
- First-encounter hints; boss-gate suppression; stats increments
- Assert obstacle layout unchanged (separate rng stream) via before/after screenshot diff

**Verify:**
- node --check on all touched files
- node tools/validate-assets.js exit 0
- harness ?seconds=35&badge=1 → EXC: 0
- harness ?badge=1&tp=poi:waystone → screenshot shows lit waystone punching the veil
- console round-trip: old save (no waylight stats) loads with zeros
- adversarial review; squash-merge to main

### PR2 — PR2 — The Caged Wick: rescue channel, ambush, Troop handoff

**Goal:** Ship the rescue POI end-to-end: channel UX, cap-gated ambush, temporary-familiar handoff to the update-5 TroopSystem with a hard fallback so the PR is shippable even against Troop API drift.

**Files:**
- `src/systems/WaylightSystem.js`
- `src/entities/Poi.js`
- `src/content/waylight.js`
- `src/core/Game.js (channel progress arc draw; ambush via _spawnBossSupport)`
- `src/systems/AudioSystem.js (cageOpen)`
- `src/systems/TroopSystem.js (addTemporary entry point — exact filename per update 5's shipped module)`

**Work:**
- Channel state machine (1.8s, radius-reset, damage-proof)
- Cage prop draw (2-frame huddle, door-swing on open)
- Ambush: 10 wave-weighted enemies on a 550-750px ring through the alive-cap-gated support-spawn path (Game.js:2858)
- troop.addTemporary contract (element inherit, 0.75 statScale, 90s TTL, cap 1, refresh-on-second) + XP/coin fallback when absent
- Freed-monkey sprint-to-player handoff animation

**Verify:**
- node --check; validate-assets exit 0
- harness ?badge=1&tp=poi:rescue&seconds=45 → EXC: 0, screenshot shows cage + channel arc; second shot post-rescue shows familiar + ambush ring
- assert enemies.length never exceeds waveState.maxAlive during ambush (harness console assert)
- adversarial review; squash-merge

### PR3 — PR3 — The Hollow Bell + brazier/steam-vent props (the killbox)

**Goal:** Ship the horde-bait set-piece: bell lure via steering proxy, payoff window, structure-anchored placement, and the two interactive prop archetypes that arm the killbox.

**Files:**
- `src/entities/Enemy.js (_lureTimer fields + decay in update)`
- `src/core/Game.js (_updateEnemies lure-proxy swap at :2813-2821; payoff-window coin/combo hooks in the kill path)`
- `src/systems/WaylightSystem.js (ring pass, afterglow, brazier/vent behavior registry)`
- `src/content/mapObjects.js (brazier + steamVent archetypes; BIOME_THEME weight appends)`
- `src/entities/Obstacle.js (procedural draws for the two props)`
- `src/content/waylight.js`
- `src/systems/AudioSystem.js (bellToll)`

**Work:**
- Bell placement against obstacleSystem.structures doorways (PR1 registry) with open-field fallback
- One-shot ring: shake, ring FX, toll, O(n) lure tag pass (non-boss/non-lieutenant, 2400px)
- Shared zero-alloc lure proxy; 8s lure + 6s afterglow; +50% coins / double combo within 420px
- Brazier ignite → light + 0.5s-tick applyBurn aura riding _tickStatuses; steamVent 6s eruption → existing slow channel
- 2 guaranteed braziers within 400px of each bell
- Suppression while bossOnField/arena

**Verify:**
- node --check; validate-assets exit 0
- harness ?badge=1&tp=poi:bell&seconds=60 → EXC: 0; screenshot mid-lure shows the horde wheeling to the bell
- frame-time probe at 180 enemies with lure active (harness console perf.now deltas) — no regression >1ms
- adversarial review; squash-merge

### PR4 — PR4 — The Ashbound Caravan + chevron, polish, balance

**Goal:** Ship the timed caravan with guards and the edge chevron; final teaching, stats surfacing, and a numbers pass across all five POIs.

**Files:**
- `src/systems/WaylightSystem.js`
- `src/entities/Poi.js`
- `src/content/waylight.js`
- `src/systems/UISystem.js (caravan chevron cloned from _drawBossArrow :851-881; countdown readout)`
- `src/systems/UIStateBuilder.js (expose caravan timer to the UI state)`
- `src/core/Game.js (chest drop via _dropChest :2277)`
- `src/config/GameConfig.js (final tuning)`

**Work:**
- Arm-on-proximity (600px), 45s countdown, gold chevron with distance + mm:ss
- 3.0s strongbox channel; 2 forced-elite guards through the capped spawn path
- Success → _dropChest (full existing overlay pipeline); timeout → ash crumble + 5 coins
- Balance pass on all §9 numbers from playtest harness runs; hint-text final copy
- Game-over summary line: waylight events completed this run (reuses the run-objectives summary surface)

**Verify:**
- node --check; validate-assets exit 0
- harness ?badge=1&tp=poi:caravan&seconds=50 → EXC: 0; screenshots: armed chevron on-screen edge, then chest overlay after claim
- full-run harness ?seconds=120&badge=1 → EXC: 0 with all POI kinds placed
- adversarial review; squash-merge

## Data & save changes

**NEW content files**: `src/content/waylight.js` (POI defs, per-biome budgets {rescue:2, waystone:3, caravan:1, bell:1, cairn:2}, 12 cairn flavor lines, 5 first-encounter hint strings, cairn boon table). **NEW modules**: `src/systems/WaylightSystem.js`, `src/entities/Poi.js`. **Config (append-only)**: `WAYLIGHT` block in `src/config/GameConfig.js` beside WICK_ROADS (:1439) holding every tunable in the balance table; `LIGHT_COLORS.waystone = '#ffce7a'` (:1445). **mapObjects.js (append-only)**: `brazier` + `steamVent` archetypes in MAP_OBJECTS; weight entries appended to all four BIOME_THEME prop maps (:117-138). **ObstacleSystem**: new `structures` registry array (recorded in _placeStructures :173-189, previously discarded) + export of module-private `mulberry32`/`strHash` (:33-49). **Save schema (additive numeric only, auto-migrated by the stats validation loop per SaveSystem.js:46-48)**: `stats.rescuesTotal`, `stats.waystonesLit`, `stats.bellsRung`, `stats.caravansClaimed`, `stats.cairnsRead`. No settings keys, no persisted run state, no version bump needed (implicit migration).

## Balance numbers (all tunable)

| Number | Start value | Rationale (all tunable) |
|---|---|---|
| POI budget / map | 2 rescue, 3 waystone, 1 caravan, 1 bell, 2 cairn (9 total) | ~1 event per 90s of a 15-min run without crowding the 240-obstacle world |
| POI min distance from origin / each other / edge | 1100 / 700 / 400 px | outside both clear radii (520/820, mapObjects.js:149,159); forces traversal |
| Walk-onto radius | 56 px | slightly forgiving vs shrine's 46 (GameConfig.js:1440) — POIs are destinations, not rewards underfoot |
| Channel: rescue / caravan | 1.8s / 3.0s @ 110px | rescue is mid-combat (short); caravan is the deliberate gamble |
| Rescue ambush | 10 enemies (8 easy / 12 hard), 550–750px ring | one pack-sized spike, cap-gated by _spawnBossSupport |
| Rescue familiar | 75% stats, 90s TTL, cap 1, refresh pays 25 coins | meaningful but strictly below a rostered update-5 familiar |
| Waystone light | radius 520, intensity 0.9, priority 0, max 3/map | > player's 360 (GameConfig.js:1400) so relighting visibly matters; 3 bounds the priority-0 budget |
| Waystone hearth ring | +1.5 hp/s within 260px; +15 coins/+20 XP once | a breather, not a healbot (typical maxHp ≈ 100+) |
| Caravan | arm 600px, 45s timer, 2 forced-elite guards, timeout = 5 coins | 45s crosses ~half the map under pressure; reward = 1 standard chest |
| Bell lure | 2400px tag radius, 8s lure + 6s afterglow, 1 ring/bell/run | 2400px ≈ 1.2 viewports — catches the whole live field (spawn ring is 1050–1350, GameConfig.js:966-967) |
| Bell payoff | +50% coins (ceil) + double combo, deaths within 420px | juicy but window-bound; no XP multiplier (XP curve untouched) |
| Cairn boons | 15% maxHp heal OR +10% ms/30s OR 10 coins; seeded per cairn | learnable routes; move speed rides _applyPlayerCaps clamps (Game.js:2753) |
| Brazier | r=24 prop; ignite once; burn aura 90px, applyBurn(8 dps × fireRoundScale, 2.0s) every 0.5s | rides refresh-not-stack burn semantics (Enemy.js:365-368) — can't runaway |
| Steam vent | erupts 6s cadence, 1.5s; slow 0.55× for 1.2s, enemies only | uses existing deepest-wins slow channel (Enemy.js:381) |
| Idle POI light | radius 110, intensity 0.6, priority 2 | shares the 96-light budget (GameConfig.js:1396); never competes with gameplay lights |

## Art needs (non-blocking)

- Procedural-first (ships in PR1-4, blocking nothing): all five POIs + both props drawn in the Shrine-grade canvas language (Shrine.js:36-94 is the quality bar) — dark stone, ember accents, single glow core.
- Blender pipeline (tools/blender/, non-blocking upgrade pass): static/2-frame prop renders for cage (closed/open), bell-frame (rest/swing), waystone (dark/lit), caravan wreck, brazier (cold/lit) — parametric prop rig → pixelated sheets; slot in as sprite overrides with the procedural draw kept as fallback per CLAUDE.md.
- higgsfield Nano Banana 2 (separate session, non-blocking): one 2×2 grid per prop as img2img over harness screenshots of the procedural versions, palette-locked ('keep exact palette, NO fire except brazier flame, hi-bit pixel art, crisp single-pixel outlines'); sliced via tools/artshot/strip-frames.mjs --anchor=bottom; each gets an ASSET_CREDITS.md row and must pass node tools/validate-assets.js.
- NO enemy art: the ambush/guards reuse the five canonical creature sheets untouched (style is LOCKED).
- Rescued-monkey familiar art is owned by update 5's rig parameter sweep — WAYLIGHT only requests a palette variant flag through troop.addTemporary.

## Risks

- Perf: bell lure at the 180-enemy cap — mitigated by design (one O(n) tag pass at ring time, per-enemy timer branch, zero allocations, shared proxy object) and a PR3 frame-time probe gate; ambush/guard spawns can never breach caps because they exclusively ride the alive-cap-gated _spawnBossSupport path (Game.js:2858).
- Lighting budget: waystones add up to 3 permanent priority-0 lights — bounded by budget (3/map), auto-culled off-screen (LightingSystem.js:121-123), and all other waylight lights demoted to the capped priority-2 tier from PR1; verified by a lit-waystone harness screenshot at the enemy cap.
- Troop API drift: update 5 ships between now and PR2 — the handoff is specified as a narrow contract (addTemporary spec) with a hard XP/coin fallback wired in PR2, so WAYLIGHT never hard-depends on Troop internals and stays shippable even if 5's API changes shape.
- Balance: extra chest (caravan) + coin windows (bell) inflate the economy — capped by one-caravan scarcity, the 14s bell window, and no XP multipliers anywhere; numbers isolated in the WAYLIGHT config block for a single-file PR4 tuning pass.
- Save safety: only additive numeric stats keys, auto-migrated by the existing stats validation loop (SaveSystem.js:46-48); no persisted run state means no corruption surface — verified by an old-save round-trip check in PR1.

## Uniqueness & boundaries

WAYLIGHT is the only update in the 20 that makes the WORLD ITSELF interactive: every other content update adds things that come TO the player (enemies, bosses, weapons, familiars, difficulty) — this is the sole source of player-initiated, place-anchored set-pieces and the sole reason to traverse the map rather than orbit spawn. No other update provides: temporary battlefield allies from the world (rescues), player-authored horde repositioning (the bell lure), permanent-for-the-run veil landmarks (waystones), or terrain-as-weapon props (brazier/vent). Sharpest neighbor boundaries: **update 7 (THRESHOLDS)** owns everything event-like about BOSSES — arena-raising via runtime ObstacleSystem insertion, weather, music stingers — so WAYLIGHT does zero runtime obstacle insertion and suppresses all POI activity while a boss is on the field; **update 5 (KINDLED TROOP)** owns familiars — WAYLIGHT only calls its addTemporary API and ships no familiar AI, stats, or art; **update 12 (CINDERS & SCRIPTURE)** owns lore persistence — cairns show one-shot flavor lines and boons, deliberately shipping no codex pages or grave-marker vignettes; **update 13 (THE LAST HEARTH)** owns defend-a-point gameplay — the bell is a one-shot offensive lure, never a defense objective with HP.

## Roadmap corrections found while grounding

- Roadmap claim 'placed by the existing seeded _placeStructures pass' is directionally right but imprecise: the pass IS seeded (ObstacleSystem.js:110 mulberry32; :116 call site; :166-190 body) but it (a) places only building wall-rings, (b) records nothing — building centers/door sides are computed and discarded (:184-188), so bell-near-building placement requires a new this.structures registry, and (c) its rng stream must NOT be extended with POI draws or every existing world layout would silently reshuffle — WAYLIGHT therefore uses a SIBLING seeded pass on its own mulberry32 stream with the same seed recipe. Also mulberry32/strHash are module-private in ObstacleSystem.js (:33-49) and need exporting (or a MathUtils home).
- Roadmap entry-point 'src/systems/Spawner.js (bias hooks)' overstates the seam: Spawner has NO positional or event bias hook — it reads only waveState fields (Spawner.js:34-53) and places on a viewport ring around the player (:64-68); the only mix bias is waveState.typeWeights composed by Game._applyRunScale. WAYLIGHT does not modify Spawner at all: the bell repositions EXISTING enemies via a steering proxy (safe because Enemy.update uses its player arg only for steering/aim, Enemy.js:370-408), and burst spawns (rescue ambush, caravan guards) reuse Game's alive-cap-gated _spawnBossSupport path (Game.js:2858, ring placement :2138).
- All other synopsis claims verified: Shrine walk-onto template (Shrine.js:27-34, consumed Game.js:3187-3197), LightingSystem priority lights (LightingSystem.js:113-134 with the 0/1/2 tiers and caps at GameConfig.js:1396-1397), and the seeded-deterministic world regeneration on biome change (Game.js:857-860).

## Binding cross-spec rulings affecting this update

- **[#9 WAYLIGHT vs #13 THE LAST HEARTH]** #13 claims to MINT non-player targeting ("the only place enemies target something other than the player"; dual-target aggro tech "minted here"), but #9 ships four updates earlier with the Hollow Bell that "wheels the entire horde into a killbox" — which requires enemies to pursue a non-player point.
  **RULING:** Split by mechanism, quoted in both specs: #9's bell is a STEERING LURE only — a temporary movement-destination override with no attack target, no aggro roles, no enemy-vs-object damage; it lives inside WaylightSystem. #13 owns dual-target ATTACK aggro — breaker/hunter roles, taunt, gnaw slots, bolt intercept, a destructible objective with HP. #13's uniqueness claim is amended to "the only place enemies ATTACK something other than the player." If #13 wants a lure primitive it may generalize #9's hook, but the aggro system lands in #13.

- **[#9 WAYLIGHT vs #11 FORGEHEART (and #6 UNDERTOW)]** #9 ships per-biome POI budgets for the four biomes existing at its ship date; #11 adds the forgeheart biome later but its append-only data list never touches waylight.js — Forgeheart would ship with undefined POI budgets. Separately, #6's mode-only Descent floors are not a biome and must not accidentally receive POIs.
  **RULING:** #9 owns WaylightSystem and must make it default-safe: an unknown biome id yields a zero budget (no POIs) rather than a crash. #11 owns Forgeheart's content and must append a forgeheart budget row to waylight.js in its PR1. #6 adds one line to its spec: WaylightSystem is inert in Descent (mode floors are not MAP_ORDER biomes, so the zero-budget default applies).
