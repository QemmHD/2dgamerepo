# Update #11: FORGEHEART — The Living Anvil

*Era III — The World Alight*

**Value verdict (ADDS):** The only new biome/tier rung, and the first extension of the exact predecessor-boss campaign chain — shipping it converts an open promise into content. Slag searing enemies is verifiably the first enemy-affecting terrain (HazardSystem's four kinds all target the player), and the Anvil's burst-window state machine is a new boss grammar. Also the sanctioned home for environmental fire styling per the canon rules. No weak slice; PR5 balance pass is earned, not padding.

## What it adds

Biome 5 / tier 5: the world-forge itself — the endgame destination opened by recording all three unique Dunes bosses in eligible standard campaign runs. It is the ONE place environmental fire styling is canon: slag rivers that crust and re-melt on a telegraphed cycle (and sear enemies — the game's first enemy-affecting terrain), ashfall weather, and three new bosses (the Bellows, the Smith, the Anvil) completing the roster to 15, capped by the Anvil's heat-cycle burst-window mechanic that no other boss has.

> **Superseding progression ruling (2026-07-14):** Save v10 removed lifetime-count map gates. Forgeheart must extend `CampaignProgression` with an authored boss trio and migration; it unlocks only after `cindermaw`, `dunescourge`, and `solnakh` are recorded for the Dunes in eligible normal campaign runs. Repeats, Daily, Rite Trial, Boss Rush, Weekly Ember, direct/debug spawns, and the session-only `?dev=1` map bypass do not grant credit.

## Design spec

# FORGEHEART — The Living Anvil (Update #11, L, deps: 4 BOSSFORGE, 6 UNDERTOW, 7 THRESHOLDS)

Expands the roadmap synopsis (docs/ROADMAP.md:88-92): biome 5 / tier 5, slag rivers, ashfall weather, environmental fire as canon (per CLAUDE.md the world may burn — only the five classic creature identities may not), three new bosses on the apex-boss pipeline with Thresholds arena/weather/theme declarations.

---

## 1. The biome — `forgeheart` map definition

**Integration point (verified):** the MAPS data contract supplies presentation/gameplay levers (`groundFill`, `grade`, `darkness`, `weather`, `accent`, `tier`, `bosses`, `enemyMix`, `hazard`). Exact access lives separately in `src/systems/CampaignProgression.js`, while `SaveSystem.getMapUnlockStatus()` supplies one status to Home, Play, launch validation, accessibility labels, and victory routing. A fifth destination must extend both authored orders and the responsive card fixture; it is not a data-only `MAP_ORDER` append.

New entry (all values tunable):

```js
forgeheart: {
    id: 'forgeheart', name: 'Forgeheart', subtitle: 'The Living Anvil',
    bg: '#120805',
    groundFill: '#33201a',  // scorched basalt — darkens like crypts, warm not violet
    groundFillAlpha: 0.55,
    grade: '#ff7a2e',       // molten under-glow wash — THE canon fire grade
    gradeAlpha: 0.14,
    darkness: 0.85,         // forge-dark: between hollowreach 0.72 and crypts 1.0 —
                            // dark enough that slag rivers become the light source
    // Campaign gate lives in CampaignProgression: exact Dunes trio, no count.
    accent: '#ff9a3c',
    weather: 'ashfall',     // NEW weather kind (see §3)
    tier: 5,
    bosses: ['forgeBellows', 'forgeSmith', 'forgeAnvil'],
    // "Husk" lean — the risen dead + slag-hardened heavies. NO new trash types,
    // NO fire re-theming of classic creatures: multipliers only skew what the
    // wave already offers (Game.js:1896-1913), preserving Vigil-1 purity.
    enemyMix: { emberskeleton: 1.8, skeleton: 1.5, zombie: 1.5, brute: 1.4,
                juggernaut: 1.35, bomber: 1.4, charger: 1.25, slime: 0.5, bat: 0.8 },
    hazard: 'slagflow',     // NEW hazard kind (see §2)
},
```

`MAP_ORDER` becomes `['emberwood','hollowreach','crypts','dunes','forgeheart']`. The roadmap hook's "180 husks" is delivered by the enemyMix (emberskeleton — a pre-existing type at GameConfig.js:265 — plus skeleton/zombie: the Hollow's husks) — deliberately NOT a new creature family (update #6 owns the drowned family; #12 owns new sheets).

**Save compatibility requires an explicit ledger migration:** extend the fixed campaign map order, add Forgeheart's exact trio, and migrate older v10 profiles without fabricating identities. `selectedMap` still repairs to an honestly available destination, but lifetime `stats.totalBosses` is statistics only and must never grant access. The `unlockMaps` dev escape hatch is session-only QA state; it performs zero storage writes and disables campaign credit for that run.

**World theming:** new `BIOME_THEME.forgeheart` row (`src/content/mapObjects.js:117-138` pattern): `tint: { color: '#ff8a4a', amt: 0.28 }`, `structures: ['foundry', 'ruin']`, `props: { anvilBlock: 12, slagCauldron: 8, chimneyStack: 7, pillar: 10, stoneBlock: 8, crate: 6, ruinedWall: 7 }`. NEW `MAP_STRUCTURES.foundry` blueprint (mapObjects.js:90-107 pattern): `interiorW 280, interiorH 210, wall 32, wallH 170, door 148, palette { base:'#4a3128', top:'#6b4534', edge:'#241410' }`. Three NEW procedural prop archetypes in `MAP_OBJECTS` (anvilBlock, slagCauldron, chimneyStack — flat-palette painted like every existing prop; no AI art). `slagCauldron` hooks the existing candle light idiom (`src/systems/MapRenderer.js:210-212`) to cast a warm `LIGHT_COLORS.fire` glow (radius 180, alpha 0.8, priority 0 — cauldrons are sparse). `ObstacleSystem.generate(w,h,biomeId)` (`src/systems/ObstacleSystem.js:89-110`, called from `src/core/Game.js:857-860`) picks all of this up with zero engine change — the seed is already perturbed per biome id (ObstacleSystem.js:110).

**Music:** new `BIOME_TUNE.forgeheart` row (`src/systems/AudioSystem.js:87-92` pattern): `{ root: 43, scale: PHRYG, cutoff: 2400, energy: 1.06, wave: 'sawtooth', swing: 0.05, reverb: 0.20 }` — low, hammering, industrial. `audio.setBiome('forgeheart')` (Game.js:894) works the moment the row exists; unknown ids already fall back to emberwood (AudioSystem.js:298). Optional polish: a procedural anvil-clank accent voice on kick steps, routed through the verified `musicDuck` sidechain bus (AudioSystem.js:124, built at :191-193) so boss stingers pump it like the rest of the bed.

## 2. Slagflow — the signature hazard (slag rivers)

**Integration point (verified):** the biome-hazard machinery — `BIOME_HAZARD` config (`src/config/GameConfig.js:915-926`), the cadence spawner `HazardSystem.updateBiome` (`src/systems/HazardSystem.js:195-234`, armed per-map by Game.js:875), the shared patch sim (HazardSystem.js:43-74) and ground-decal draw (HazardSystem.js:338-406). Slagflow rides the same `game.hazards` pool and tick idiom but is a new *shape* and a new *lifecycle*:

**Ribbons, not patches.** One spawn wake lays a RIVER: a chain of 4-6 overlapping circles walked along a meandering line (`step` 150px apart, heading jitter ±0.55 rad per link), forming a ~600-950px glowing flow. Each link is one pooled hazard object `{ kind:'slagflow', biome:true, ribbonId, linkIndex, ... }`; the ribbon's state is computed from `age` + a shared phase offset, so the sim stays stateless per the HazardSystem contract (HazardSystem.js:3-6).

**The crust/melt heat cycle** (the kiting mechanic from the roadmap hook): after the standard bloom-in telegraph (`warn` 1.2s — reusing the "every patch telegraphs" language, GameConfig.js:912-914), a ribbon cycles:
- **MOLTEN (5.5s):** bright `#ff6a22` flow, rim `#ff8a3c`, `L.addLight` per visible link (priority 2, the existing biome-patch pattern at HazardSystem.js:405). Player center inside → tick damage 9 per 0.4s (the exact tick idiom at HazardSystem.js:58-72, i-frame gated). **NEW — enemies sear:** on a 0.5s tick per link, every active non-boss, non-elite-affix-immune enemy whose center is inside takes 8 flat damage. This is deliberately new code, not an existing seam — today hazards only touch `game.player` (HazardSystem.js:39-74). Bosses and lieutenants are immune (kits can't be cheesed). Cost: ≤14 links × 180 enemies × 2 ticks/s ≈ 5k squared-distance checks/s — negligible.
- **RE-MELT TELEGRAPH (0.8s):** the crust's rim flashes `BOSS_ATTACK.telegraphColor` (GameConfig.js:899) — the shared "danger incoming" language.
- **CRUSTED (3.5s):** dark basalt plates (`#3a1710`), SAFE to cross, mild 0.9 wade-slow (`terrainSlowMul`, the re-stamped-per-frame channel at HazardSystem.js:40-55). This is the crossing window: kite the horde onto the river, cross on crust, let the re-melt sear the husks chasing you.

**Config block** (`BIOME_HAZARD.slagflow`, all tunable): `{ r: 110, linksMin: 4, linksMax: 6, step: 150, meander: 0.55, warn: 1.2, duration: 18, cycleMolten: 5.5, cycleCrusted: 3.5, remeltWarn: 0.8, tickDamage: 9, enemyTick: 8, enemyTickInterval: 0.5, crustSlow: 0.9, color: '#3a1710', rim: '#ff8a3c', molten: '#ff6a22' }` plus `slagMaxLinks: 14` replacing the generic `maxActive: 5` for this kind (≈2-3 ribbons live). Spawner reuses the heading-bias ring, `spawnMin` 340 no-underfoot promise, obstacle rejection, and the boss-setpiece hold (HazardSystem.js:198-232) — the ribbon anchors on the ring, links walk outward.

**Draw:** a new `drawGround` branch: crusted = flat dark fill + plate-crack strokes off `hz.seed`; molten = fill + bright rim + 3 seeded glow-blob dots drifting along the ribbon direction (flat fills/strokes only, no gradients — the P1.2 rule at HazardSystem.js:16-18).

## 3. Ashfall — the weather

**Integration point (verified):** `MapRenderer.drawWeather` currently hard-gates `kind !== 'embers' && kind !== 'snow' → return` (`src/systems/MapRenderer.js:254-255`), with a shared N=56 mote budget (:256) and a lowQuality/reducedEffects skip (:253, set from Game.js:834). Add an `'ashfall'` branch inside the same budget: **44 grey ash flakes** falling slowly (speed 14-30 px/s — slower than snow's 34-106) with wide sinusoidal drift (±44px sway), color `rgba(205,195,185,0.5)`, source-over; **plus 12 rising ember sparks** reusing the embers math (additive `#ff9a48`, flicker alpha) — the forge breathes both directions. No god-ray overlay (that stays embers-only, MapRenderer.js:229-250). Deterministic time-derived positions, zero per-frame state — the existing contract (:220-224).

## 4. The three bosses

**Integration points (verified):** the apex-boss framework — `behavior:'apexBoss'` branch (`src/entities/Enemy.js:525`), `runBossAI` (Enemy.js:1137-1222: cooldown scheduler, windup telegraphs, phase-2 latch at :1150-1153, continuous enrage :1140-1146), `commitBossAttack` (Enemy.js:1227-1456) with **14 verified attack kinds**: shockwave, fan(+spiral), charge, wall, seekers, zones, summon, aimed, cross, spiralArms, rain, mines, beam, lingering. Shared tuning `BOSS_ATTACK` (GameConfig.js:898-902), `BOSS` scheduling/enrage/arena (GameConfig.js:678-756), `BOSS_TIERS` skirmisher/warlord/apex ladder (GameConfig.js:671-675). Spawning/scaling: `Game._spawnBoss` (Game.js:1971-2048) — encounter tierMul `1 + encounter*0.8` (:2009), map extras (:2017-2019), `_bossOut` channel stash (:2034-2039), summon queue drain (:2038). Boss defs are pure data in `ENEMY` (GameConfig.js:133-664) — three new defs are append-only. Numbers anchor ~10-16% above the dunes trio (cindermaw 2450 / dunescourge 3000 / solnakh 3100) since tier-5 multipliers stack on top (§5). All numbers tunable.

### 4a. THE BELLOWS — "Vantus, Breath of the Forge" (encounter 1, tier 1 SKIRMISHER)
A billowing living bellows-spirit; the fast aerial pressure fight, and the boss that **weaponizes the biome**.
`hp 2750, speed 350, radius 86, contactDamage 36, xpValue 58, visualScale 1.55, phase2HpFraction 0.5, supportTypes { bat: 2, bomber: 1, mite: 2 }`.

Kit (kind → existing commit branch):
| id | kind | cd | windup | numbers |
|---|---|---|---|---|
| sparkGale | fan | 2.6 | 0.40 | count 20, spread 2π, spd 480, dmg 17 |
| exhale | fan (cone) | 4.8 | 0.35 | count 9, spread 0.8, spd 590, dmg 17 |
| backdraft | shockwave | 4.2 | 0.45 | dmg 30, growth 900, rMax 600, band 105 |
| emberDrift | seekers | 7.6 | 0.45 | count 6, spd 450, dmg 30, turn 3.7, max 630, color #ffb24a |
| cinderWall | wall | 7.6 | 0.50 | count 16, spacing 66, spd 440, dmg 19, gap 2 |
| windLunge | charge | 4.6 | 0.38 | dash 950, dur 0.55 |
| ashChoir | summon | 11.0 | 0.55 | count 3, { bat: 2, bomber: 1 } |
| **stokeTheSlag** | **NEW kind `stoke`** | 12.0 | 0.90 | see below |

**SIGNATURE — Stoke the Slag:** instantly re-melts every crusted slagflow link in the arena AND lays one fresh 4-link ribbon aimed across the player's lead point (oldest ribbon expires if over `slagMaxLinks`). Implemented as an `out.slagStoke` queue drained by Game exactly like the summon queue (Game.js:2038, Enemy.js:1335-1342 idiom) — Game owns the hazard pool and the ribbon-laying helper from §2, so the boss AI stays pool-agnostic. Telegraph: the generic windup ring (Enemy.js:1211-1217) + every crusted link flashes telegraphColor during the windup. `phase2Attacks: ['sparkGale', 'windLunge', 'stokeTheSlag']`.

### 4b. THE SMITH — "Maulkarn, Hammer of the First Fire" (encounter 2, tier 2 WARLORD)
A hulking forge-husk dragging a star-metal maul; pure ground control in hammer rhythm.
`hp 3300, speed 300, radius 108, contactDamage 38, xpValue 70, visualScale 1.98, phase2HpFraction 0.5, supportTypes { brute: 1, juggernaut: 1, emberskeleton: 2 }`.

| id | kind | cd | windup | numbers |
|---|---|---|---|---|
| hammerfall | shockwave | 3.4 | 0.60 | dmg 34, growth 880, rMax 680, band 115 |
| sparkShower | zones | 7.2 | 0.80 | count 8, r 150, spread 420, dmg 34, warn 0.85 |
| quenchWall | wall | 7.8 | 0.55 | count 17, spacing 70, spd 410, dmg 23, gap 2 |
| brandRing | mines | 9.0 | 0.90 | count 10, ring 240, r 120, dmg 30, warn 0.95 |
| moltenGrasp | seekers | 8.4 | 0.50 | count 6, spd 430, dmg 30, turn 3.5, max 600, color #ff8a3c |
| overheadCharge | charge | 5.2 | 0.45 | dash 840, dur 0.65 |
| callTheForge | summon | 11.0 | 0.60 | count 4, { emberskeleton: 2, brute: 1 } |
| **anvilProcession** | **NEW kind `chainZones`** | 8.5 | 0.70 | count 6, r 150, step 190, dmg 30, warn 0.8, stagger 0.14 |

**SIGNATURE — Anvil Procession:** six delayed zones laid in a STRAIGHT LINE from the Smith through the player's lead point, detonating in marching sequence — you must step OUT of the lane, not micro-dodge. Implementation: ~15 lines in `commitBossAttack` pushing `delayedZone` hazards along a line with per-index `lifetime = warn + i*stagger` — a hybrid of the verified `rain` (Enemy.js:1386-1403) and `mines` (:1404-1418) idioms; zero new sim/draw code (the delayedZone branch at HazardSystem.js:89-108/283-303 handles everything). `phase2Attacks: ['hammerfall', 'overheadCharge', 'anvilProcession']`.

### 4c. THE ANVIL — "Aedrun-Vhal, The Living Anvil" (encounter 3, tier 3 APEX — the update's namesake, the game's new hardest fight)
A colossal walking anvil-idol split by a molten seam. Slow, arena-warping, and carrying the roster's only **burst-window mechanic**.
`hp 3600, speed 272, radius 126, contactDamage 42, xpValue 96, visualScale 2.3, phase2HpFraction 0.5, supportTypes { emberskeleton: 2, juggernaut: 1, bomber: 1, mite: 2 }`.

**NEW mechanic — `heatCycle`** (per-def, opt-in; other 14 bosses pay nothing): `{ molten: 7.0, quenched: 5.0, moltenDamageTakenMul: 1.2, quenchedResist: 0.25, moltenSpeedMul: 1.15, p2QuenchedMul: 0.6 }`. Polled in `runBossAI` (~25 lines gated on `def.heatCycle`, alongside the phase-2 latch at Enemy.js:1148-1153): while MOLTEN the seam glows white-hot — the boss takes +20% damage, moves 15% faster, and its `moltenOnly` attacks unlock; while QUENCHED it soaks 25% (composing with the existing `boss.resist` channel, Game.js:2029) and turtles. Phase 2 shortens quenched to 3.0s. The state drives a boss-bar tint + a seam retint (the enrage-retint channel pattern, Enemy.js:677) so it reads at a glance. This teaches save-your-Kindle burst play — unique across all 15 bosses.

| id | kind | cd | windup | numbers |
|---|---|---|---|---|
| coreVolley | fan | 2.6 | 0.45 | count 26, spread 2π, spd 470, dmg 18 |
| slagBurst | lingering | 9.0 | 0.65 | count 5, r 145, spread 400, tick 12, dur 4.5, color #ff6a22 |
| ingotWall | wall | 7.0 | 0.50 | count 18, spacing 66, spd 430, dmg 24, gap 2 |
| forgeQuake | zones | 6.6 | 0.70 | count 9, r 155, spread 450, dmg 36, warn 0.75 |
| strikeSparks | cross | 6.4 | 0.50 | arms 4, perArm 3, spd 380, dmg 16, spin 0.45, color #ffcf6a |
| moltenRain | rain | 8.0 | 0.75 | count 8, r 125, jitter 150, dmg 28, warn 0.7, stagger 0.11 |
| hammerToll | shockwave | 4.0 | 0.55 | dmg 36, growth 1020, rMax 680, band 125 |
| wightCall | summon | 12.0 | 0.60 | count 5, { emberskeleton: 3, mite: 2 } |
| **seamLance** | beam, `moltenOnly` | 8.0 | 0.70 | sweep 2.6, len 1100, band 36, dmg 36, warn 0.8, dur 1.7, color #ffb24a |

**SIGNATURE — Seam Lance** (beam kind, verified at Enemy.js:1419-1435 / HazardSystem.js:113-135): fires only while MOLTEN (`moltenOnly` flag skipped by the scheduler while quenched — the seam is sealed shut). `phase2Attacks: ['coreVolley', 'hammerToll', 'seamLance']`.

### Thresholds (#7) declarations
Each def carries data-only fields in #7's contract: `arena` (Bellows: `bellowsRing` — 8 basalt tuyère stones; Smith: `smithsCourt` — anvil monoliths; Anvil: `theFirstForge` — a ring of cold braziers that ignite at phase 2), `weatherSurge: { kind: 'ashfall', intensity: 1.8 }` (Anvil: 2.2 + spark tint), and a per-boss `theme` row in the BIOME_TUNE pattern (AudioSystem.js:87-92) with phase-2 stingers over the verified `musicDuck` sidechain (AudioSystem.js:124/191-193). **These live in their own PR (PR4)** so if #7's final field names differ, only one PR adapts — and if #7 slips, the fields are inert extra data (nothing reads them), so bosses still ship complete on the standard `BOSS.arenaRadius` circle arena (GameConfig.js:741, Game.js:1989).

## 5. Tier-5 scaling & the unlock gate

Both tier folds are open-form and extend to tier 5 with **zero code change** (verified):
- **Trash** (Game.js:805-810): `hp ×(1+(t-1)·0.12)`, `dmg ×(1+(t-1)·0.08)`, `speed ×(1+(t-1)·0.03)` → tier 5 = **×1.48 hp / ×1.32 dmg / ×1.12 speed**.
- **Boss extras** (Game.js:2017-2019): `mapHpMul ×(1+(t-1)·0.07)`, `mapDmgMul ×(1+(t-1)·0.04)` → tier 5 = **×1.28 hp / ×1.16 dmg** on top of the trash fold, encounter tierMul (:2009), time curve + `baseHpMul` 1.5 (GameConfig.js:700-706).
- Net Anvil check: 3600 base × 1.5 × time-cap-min × 2.6 encounter × 1.28 map ≈ the intended "hardest fight in the game" without touching any curve.
- **Unlock:** record the exact Dunes trio — `cindermaw`, `dunescourge`, and `solnakh` — in eligible campaign runs. The locked card reads `LOCKED · The Dunes N/3`; repeats and other-map/mode bosses do not count.
- **XP:** boss xpValue 58/70/96 (vs solnakh 90); trash XP untouched — tier 5 pays through boss kills and pace, not inflation.

## 6. UX, achievements, save keys (all additive)

- One-time "THE FORGE OPENS" beat comes directly from the third unique-Dunes-boss unlock receipt; no parallel threshold or `seen` predicate may decide access.
- Additive stat `stats.forgeheartBosses: 0` (incremented alongside totalBosses, SaveSystem.js:466 path, when the run map is forgeheart).
- Two append-only achievements (`src/content/achievements.js:8-12` pattern): `forge_unlocked` ("The Forge Opens", Forgeheart honestly unlocked, 300 coins) and `forge_tempered` ("Tempered", forgeheartBosses ≥ 3, 400 coins).

## 7. Art plan (procedural ships first — nothing blocks)

- **PR-blocking path is 100% procedural:** three new `PixelBosses.js` functions (`src/assets/PixelBosses.js:1-13` contract — 64px grid, 2-frame idle, own silhouette + palette, `outline()` pass, lazy-cached; unknown type → Enemy.js procedural fallback stays intact). Bellows: billowing twin-sack body + tuyère snout + spark throat; Smith: hunched husk + maul + apron of riveted plates; Anvil: walking anvil-idol, molten seam pixels alternating per frame. Fire styling here is legitimate: the CLAUDE.md prohibition protects the five classic creature identities — bosses are exempt (Cindermaw "The Emberjaw" already is fire, GameConfig.js:627-644).
- **Blender upgrade path (non-blocking, separate session):** once #4 BOSSFORGE extends `tools/blender/` beyond the hero (today it is hero-only: `monkey_rig.py` parametric rig → `render_sheets.py` → `pixelate-sheet.mjs`, per tools/blender/README.md), the three bosses get multi-frame sheets on that pipeline. Until then the PixelBosses look ships.
- Props (anvilBlock, slagCauldron, chimneyStack) are procedural palette-painted MAP_OBJECTS — no external assets, so `tools/validate-assets.js` needs no new credit rows unless AI art actually lands later.

## 8. What is NEW vs REUSED

**NEW files:** none required (all content is data appended to existing modules) — optionally `docs/updates/11-forgeheart.md`.
**NEW code surfaces:** `BIOME_HAZARD.slagflow` config + slagMaxLinks; HazardSystem ribbon spawner branch, slagflow sim branch (heat cycle + enemy searing — the first enemy-affecting terrain), slagflow drawGround branch; MapRenderer `ashfall` branch; Enemy.js `chainZones` commit branch (~15 lines), `stoke` queue push, `heatCycle` poll (~25 lines), `moltenOnly` scheduler skip (~3 lines); Game.js slagStoke queue drain + ribbon helper; 3 PixelBosses functions; 3 MAP_OBJECTS props + 1 MAP_STRUCTURES blueprint; boss-bar heat tint (UISystem, ~10 lines).
**REUSED (verified):** the entire MAPS contract, hazard pool + tick idiom + telegraph language, 14 boss attack kinds, apexBoss scheduler/enrage/phase-2, BOSS arena + support waves, tier scaling formulas, BIOME_THEME/ObstacleSystem seeding, BIOME_TUNE/setBiome, weather budget, save clamp+migrate pattern, menu biome selector, achievements engine.
**Save keys (additive only):** `seenForgeheartUnlock` (bool), `stats.forgeheartBosses` (int).

## PR plan

### PR1 — PR1 — Forgeheart biome: map def, tier 5, ashfall weather, world theming, music

**Goal:** The fifth biome exists end-to-end (selectable, themed, scored, tier-5 scaled) with placeholder-free procedural world art; bosses temporarily alias the dunes trio so the map is playable.

**Files:**
- `src/content/maps.js`
- `src/systems/CampaignProgression.js`
- `src/systems/SaveSystem.js`
- `src/content/mapObjects.js (BIOME_THEME row, foundry blueprint, 3 new prop archetypes)`
- `src/systems/MapRenderer.js (ashfall branch)`
- `src/systems/AudioSystem.js (BIOME_TUNE.forgeheart row)`
- `src/content/achievements.js (forge_unlocked)`

**Work:**
- Add MAPS.forgeheart (tier 5, weather 'ashfall', hazard 'slagflow' — inert until PR2 since BIOME_HAZARD has no slagflow entry yet), append both authored map orders, and extend the versioned exact-boss ledger/migration.
- Temporarily set bosses: ['cindermaw','dunescourge','solnakh'] with a TODO(PR3)
- BIOME_THEME.forgeheart + MAP_STRUCTURES.foundry + procedural anvilBlock/slagCauldron/chimneyStack props; slagCauldron light via the candle idiom (MapRenderer.js:210-212)
- drawWeather 'ashfall' branch inside the N=56 budget; verify reducedEffects skip
- BIOME_TUNE.forgeheart row; verify setBiome fallback still healthy
- Menu check: 5 biome cards fit at N=5 (MenuRenderer.js:1001-1022); shrink fs if names clip

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- local harness menu matrix — Forgeheart shows exact Dunes 0/3, 2/3, third-boss unlock, and session-only QA credit-off states at `EXC:0`.
- local harness with the session-only map bypass booting a Forgeheart run for 35s — ashfall visible, foundry/props themed, campaign receipt rejected, `EXC:0`, FPS badge healthy.

### PR2 — PR2 — Slagflow rivers: ribbon hazard, crust/melt cycle, enemy searing

**Goal:** The biome's signature mechanic: telegraphed slag ribbons that cycle molten/crusted, damage the player while molten, and sear non-boss enemies — the game's first enemy-affecting terrain.

**Files:**
- `src/config/GameConfig.js (BIOME_HAZARD.slagflow + slagMaxLinks)`
- `src/systems/HazardSystem.js (ribbon spawner, slagflow sim + searing, drawGround branch)`
- `src/core/Game.js (ribbon-laying helper _laySlagRibbon, used by updateBiome and later by PR3's stoke)`

**Work:**
- Config: r 110, links 4-6, step 150, warn 1.2, duration 18, cycle 5.5 molten / 3.5 crusted / 0.8 remelt telegraph, tickDamage 9, enemyTick 8 @0.5s, crustSlow 0.9, slagMaxLinks 14
- updateBiome: slagflow wake lays a ribbon via _laySlagRibbon (ring spawn + heading bias + spawnMin + obstacle rejection reused from HazardSystem.js:198-232)
- Sim: phase from age (stateless), player tick idiom (HazardSystem.js:58-72), terrainSlowMul on crust, tick-gated enemy searing loop (non-boss only)
- Draw: crusted plates + cracks / molten fill + bright rim + remelt telegraph flash; addLight priority 2 for molten links only

**Verify:**
- node --check; validate-assets exit 0
- harness forgeheart run 35s with badge=1: ribbons spawn, cycle, EXC:0
- Harness console probe: assert live slag links never exceed slagMaxLinks and no link center within 340px of spawn-time player pos
- FPS badge at late-wave density (drive ?seconds=35 into wave 3+) — no regression vs PR1 baseline

### PR3 — PR3 — The three bosses: Bellows / Smith / Anvil (procedural art)

**Goal:** The forgeheart trio is live on the apex-boss pipeline with two new attack kinds (chainZones, stoke), the heatCycle mechanic, and PixelBosses sprites; the map's boss ladder switches over from the dunes alias.

**Files:**
- `src/config/GameConfig.js (3 ENEMY boss defs; maps.js bosses[] switch)`
- `src/content/maps.js`
- `src/entities/Enemy.js (chainZones commit, stoke queue push, heatCycle poll, moltenOnly skip)`
- `src/core/Game.js (slagStoke queue drain via _bossOut, boss-bar heat state plumb)`
- `src/assets/PixelBosses.js (3 new boss functions)`
- `src/systems/UISystem.js (boss bar heat tint)`
- `src/content/achievements.js (forge_tempered)`
- `src/systems/SaveSystem.js (additive stats.forgeheartBosses + seenForgeheartUnlock clamp)`
- `src/systems/MenuRenderer.js (one-time unlock toast)`

**Work:**
- Append forgeBellows/forgeSmith/forgeAnvil defs with the full kits and numbers from the spec
- commitBossAttack: 'chainZones' (staggered delayedZones along a line — rain/mines hybrid)
- 'stoke': push onto out.slagStoke; Game drains it like bossSummons (Game.js:2038): re-melt crusted links + _laySlagRibbon across the player
- runBossAI: heatCycle poll gated on def.heatCycle; scheduler skips moltenOnly attacks while quenched; damage-taken/resist/speed muls applied through existing channels
- PixelBosses: 3 hand-drawn 64px 2-frame functions per the file's contract; procedural fallback intact for unknown types
- Additive save keys + unlock toast + achievement

**Verify:**
- node --check; validate-assets exit 0
- harness forced-boss runs (existing boss-forcing harness param or timed 35s windows) for each of the three: telegraphs paint, signatures fire, phase-2 latches, EXC:0
- Anvil heatCycle probe: boss bar tint flips on schedule; seamLance never fires while quenched
- Save round-trip: old save loads clean (defaults), new save with forgeheart keys loads on a simulated pre-PR build path (clamp drops unknowns)

### PR4 — PR4 — Thresholds declarations, boss themes, audio accents

**Goal:** The trio plugs into update #7's arena/weather/theme machinery (data-only declarations) and the biome gets its anvil-clank musical identity; degrades to inert data if #7's consumer is absent.

**Files:**
- `src/config/GameConfig.js (per-boss arena/weatherSurge/theme fields in the #7 contract)`
- `src/systems/AudioSystem.js (3 boss theme rows + anvil-clank accent voice through musicDuck)`

**Work:**
- Declare bellowsRing / smithsCourt / theFirstForge arena data in whatever schema #7 shipped (adapt names here only)
- weatherSurge ashfall intensity 1.8 / 1.8 / 2.2
- Three BIOME_TUNE-pattern boss theme rows with phase-2 stingers on the musicDuck sidechain (AudioSystem.js:124/191-193)
- Forge-only kick-step clank accent, gated behind the music volume + reducedEffects

**Verify:**
- node --check; validate-assets exit 0
- harness boss encounters: arena props raise (if #7 live), weather surges, theme swaps and ducks on stinger, EXC:0
- With #7 consumer stubbed off: fields verifiably inert (no reads), game identical to PR3

### PR5 — PR5 — Balance + polish pass and showcase

**Goal:** Tier-5 numbers tuned against real runs, edge cases closed, and the update's shareable face captured.

**Files:**
- `src/config/GameConfig.js (number tuning only)`
- `src/content/maps.js (enemyMix/darkness tuning only)`
- `docs/ROADMAP.md (mark #11 shipped)`

**Work:**
- Timed-run matrix via harness (normal/nightmare × 2 heroes): validate trash TTK +15-20% vs dunes, Bellows ≤ solnakh difficulty, Anvil hardest-in-game; adjust hp/dmg/cd within ±20%
- Slag-searing exploit check: camp-a-river farming yields no XP advantage (searing kills grant normal XP but spawn pacing unchanged); tune enemyTick down if farm-positive
- Mobile/readability pass: darkness 0.85 vs slag rim contrast at reducedEffects
- Showcase screenshots (harness showcase param) for the release note

**Verify:**
- node --check; validate-assets exit 0
- harness badge=1 full 35s runs on all 5 biomes — EXC:0 everywhere (regression sweep)
- FPS badge at 180 enemies + 2 ribbons + boss beam on the forgeheart map — within budget
- Adversarial review + squash-merge to main per the standing cadence

## Data & save changes

**Content files:** `src/content/maps.js` — MAPS.forgeheart + MAP_ORDER fifth entry; `src/systems/CampaignProgression.js` — fifth authored id, exact Forgeheart trio, and conservative migration; `src/content/mapObjects.js` — BIOME_THEME.forgeheart, MAP_STRUCTURES.foundry, MAP_OBJECTS anvilBlock/slagCauldron/chimneyStack; `src/config/GameConfig.js` — BIOME_HAZARD.slagflow, three ENEMY boss defs, and Thresholds declarations; `src/content/achievements.js`; `src/systems/AudioSystem.js`. **Save schema:** bump the campaign schema deliberately; retain only proven prefix/trio evidence, never lifetime-total inference. `stats.forgeheartBosses` remains an additive statistic. **Config blocks:** slagflow `{ r:110, linksMin:4, linksMax:6, step:150, meander:0.55, warn:1.2, duration:18, cycleMolten:5.5, cycleCrusted:3.5, remeltWarn:0.8, tickDamage:9, enemyTick:8, enemyTickInterval:0.5, crustSlow:0.9, color:'#3a1710', rim:'#ff8a3c', molten:'#ff6a22' }`, `slagMaxLinks:14`.

## Balance numbers (all tunable)

| Number | Start value | Rationale (all tunable) |
|---|---|---|
| campaign gate | Exact Dunes trio | Three unique authored Dunes bosses in eligible standard runs; no repeats, mode credit, threshold, or retroactive lifetime inference |
| tier | 5 | Trash ×1.48 hp / ×1.32 dmg / ×1.12 speed (Game.js:806-809 open-form); boss extras ×1.28 hp / ×1.16 dmg (Game.js:2018-2019) — zero code change |
| darkness | 0.85 | Between hollowreach 0.72 and crypts 1.0 — dark enough that molten slag is the light source, readable on mobile |
| slag link r / links / step | 110 / 4-6 / 150 | ~600-950px ribbons: crossable in ~0.7s of sprint, real routing obstacle at 180 enemies |
| slag cycle | 5.5s molten / 3.5s crusted / 0.8s remelt warn | Crust window fits one deliberate crossing; remelt telegraph matches the ~0.8s boss-warn vocabulary |
| slag player tick | 9 per 0.4s (~22 dps) | Between brambles 6 and boss lingering 10-12 (GameConfig.js:922, 602) — punishing, not lethal |
| slag enemy sear | 8 per 0.5s (~16 dps), non-boss only | Kiting payoff worth ~1 trash kill/sec across a ribbon; too slow to out-farm weapons; bosses immune (no cheese) |
| slagMaxLinks | 14 (~2-3 ribbons) | Perf + fairness cap replacing maxActive 5 for this kind; searing cost ≤5k dist-checks/s |
| Bellows hp/spd/dmg/xp | 2750 / 350 / 36 / 58 | ~+12% over cindermaw (2450, GameConfig.js:627), fastest of trio per SKIRMISHER ladder |
| Smith hp/spd/dmg/xp | 3300 / 300 / 38 / 70 | ~+10% over dunescourge (3000); WARLORD ground-control profile |
| Anvil hp/spd/dmg/xp | 3600 / 272 / 42 / 96 | ~+16% over solnakh (3100) → new hardest fight after tier-5 + encounter ×2.6 stack |
| heatCycle | 7s molten (+20% dmg taken, +15% spd) / 5s quenched (25% resist), p2 quenched ×0.6 | ~58% uptime burst window; net EHP ≈ neutral vs no-cycle, but rewards timing |
| anvilProcession | 6 zones, r 150, step 190, stagger 0.14s, dmg 30 | 1140px lane at ~1350px/s march — outrunnable only sideways |
| stokeTheSlag cd | 12s, windup 0.9s | Once per ~2 kit rotations; longest windup in the trio (biome-warping deserves the biggest read) |
| Ashfall motes | 44 ash falling (spd 14-30) + 12 embers rising, N=56 total | Exactly the existing weather budget (MapRenderer.js:256) |
| enemyMix lean | emberskeleton 1.8, skeleton 1.5, zombie 1.5, brute 1.4, juggernaut 1.35, bomber 1.4 / slime 0.5, bat 0.8 | The "husk" identity from existing types only; multiplier-only skew preserves Vigil-1 purity (Game.js:1896-1913) |
| Achievements | forge_unlocked 300c, forge_tempered 400c | Sized vs bosses_25 = 200c (achievements.js:12) |

## Art needs (non-blocking)

- Procedural (ships first, in-PR, blocking-path): 3 hand-drawn PixelBosses.js functions (64px, 2-frame idle, own silhouette/palette per the file contract at src/assets/PixelBosses.js:1-13) + 3 procedural MAP_OBJECTS props (anvilBlock, slagCauldron, chimneyStack) + fully procedural slagflow/ashfall rendering — zero external assets, validate-assets untouched.
- Blender pipeline (non-blocking, later session): multi-frame sheets for the three bosses once update #4 BOSSFORGE extends tools/blender/ beyond the hero rig (verified: today monkey_rig.py/render_sheets.py are hero-only; the pixelate-sheet.mjs install path and anchor contract in tools/blender/README.md are the template). Fire styling is legitimate here — the CLAUDE.md fire prohibition protects the five classic creature identities, and bosses (cf. Cindermaw) are exempt.
- higgsfield (non-blocking alternative): Nano Banana 2 2x2 pose grids for boss idle/attack frames using the approved-grid img2img recipe, sliced with tools/artshot/strip-frames.mjs --anchor=bottom; each landing asset gets an ASSET_CREDITS.md row. Never gates any PR — PixelBosses look is the shipping fallback.

## Risks

- PERF — 14 slag links + enemy searing + ashfall + boss beam at the 180-enemy cap (heavy juggernaut/brute mix raises per-enemy cost). Designed-in from PR1/PR2: slagMaxLinks hard cap, searing tick-gated at 0.5s with squared distances and zero allocation, molten lights at priority 2 (existing biome-patch pattern, HazardSystem.js:405), ashfall inside the fixed N=56 mote budget with the reducedEffects skip (MapRenderer.js:253), and an FPS-badge regression gate in every PR's harness verify.
- BALANCE — slag searing becomes a free farm (camp a river, let it clear waves) or, inversely, tier-5 + heatCycle makes the Anvil a wall. Mitigations: enemyTick starts low (16 dps), bosses/lieutenants immune, spawn pacing unaffected by sear kills (no farm acceleration), heatCycle is net-EHP-neutral by construction, and PR5 is a dedicated tuning pass with a defined TTK target (+15-20% vs dunes) before the update is called done.
- SAVES/COMPAT — a 5th map id and new save keys meeting old builds or hand-edited saves. Mitigated by construction: selectedMap clamp already drops unknown ids (SaveSystem.js:270), getSelectedMap re-validates unlock (:552-556), both new keys are additive with load-time clamps and no version bump, and PR3's verify includes an explicit old-save round-trip.
- DEPENDENCY DRIFT — updates #4/#6/#7 ship before #11 but their final interfaces (perf grid, Thresholds arena/weather/theme schema, Blender boss pipeline) may differ from today's assumptions. Mitigated structurally: everything #7-shaped is isolated in PR4 as inert data-only declarations, boss art has a procedural shipping path independent of #4's Blender work, and PRs 1-3 depend only on seams verified in current main.

## Uniqueness & boundaries

FORGEHEART is the only update in the 20 that grows the WORLD itself: the only new biome/tier rung (5th map, tier 5, exact Dunes-trio gate), the only place environmental fire styling becomes canon, the only enemy-affecting terrain in the game (slag sears the horde — every other hazard, biome or boss, touches only the player), the only boss with a burst-window state machine (the Anvil's heatCycle), the only boss that weaponizes its biome's hazard (the Bellows' Stoke), and the completion of the boss roster from 12 to 15. Sharpest neighbor boundaries: #4 BOSSFORGE owns the projectile-collision grid + pooling perf refactor and the Blender boss re-modeling pipeline — Forgeheart consumes both, builds neither, and ships procedural boss art first; #6 UNDERTOW owns 'new enemy family + new run mode' — Forgeheart adds ZERO new trash creatures (its 'husks' are an enemyMix lean on existing emberskeleton/skeleton/zombie) and no mode; #7 THRESHOLDS owns the arena-raise/boss-weather/boss-theme MACHINERY — Forgeheart only declares per-boss data in #7's contract (isolated in PR4, inert if absent); #12 owns creature sheet coherence; #15/#16 own difficulty ladders and NG+ remixes — Forgeheart's tier-5 numbers ride the existing open-form tier folds untouched.

## Roadmap corrections found while grounding

- Roadmap constraint text calls tools/blender/ a pipeline for 'character/creature/prop art' — verified it is currently HERO-ONLY (monkey_rig.py parametric monkey + render_sheets.py + the pixelate install path, per tools/blender/README.md). Boss/creature generality is #4 BOSSFORGE's deliverable; this spec therefore ships procedural PixelBosses art first and treats Blender boss sheets as a non-blocking follow-up.
- The hook 'kiting 180 husks across a glowing slag river' implies the river threatens the horde — but today's hazard pool is strictly player-only (HazardSystem.update reads only game.player, src/systems/HazardSystem.js:39-74; enemies never intersect hazards anywhere). Enemy searing is specced explicitly as NEW mechanic code, not an existing seam.
- 'Thresholds arenas' (deps line) — no arena-raise / runtime-ObstacleSystem-insertion or per-boss weather/theme code exists in main today (only the standard circular BOSS.arenaRadius confinement, Game.js:1989 / GameConfig.js:741); #7 ships it first. The spec isolates all #7-contract declarations in PR4 and keeps them inert-if-absent. Other verified seams are BIOME_HAZARD, the MAPS presentation contract plus versioned CampaignProgression gate, getMapTier, the apexBoss framework, BIOME_TUNE, and the musicDuck sidechain.

## Binding cross-spec rulings affecting this update

- **[#4 BOSSFORGE vs #6 UNDERTOW vs #11 FORGEHEART vs #12 CINDERS & SCRIPTURE]** Boss arithmetic disagrees across four specs: #4 remodels "the 12 bosses" and Boss Rush runs "all twelve"; #6 adds the Tidewarden apex (update 6); #11 claims its three bosses "complete the roster to 15" (12+3, silently excluding Tidewarden); #12's codex ships "THE_TWELVE (12 boss ids)" at update 12 when 16 boss-class enemies exist.
  **RULING:** Canonical taxonomy, to be quoted verbatim in all four specs: "The Twelve" is the fixed set of legendary campaign duels in GameConfig.js:379-663 and is what #4 remodels, #7 ritualizes, and #12's Twelve page commemorates. Forgeheart's Bellows/Smith/Anvil (#11) are campaign roster additions 13–15: #11 must append them to the data-driven Boss Rush pool and declare their bossRites rows (already in its PR4). The Tidewarden (#6) is Descent-mode-exclusive: excluded from roster counts, Boss Rush, The Twelve, and Thresholds; it appears in the codex per the next ruling. Boss Rush's roster is registry-driven, not a hardcoded twelve.

- **[#12 CINDERS & SCRIPTURE vs #6 UNDERTOW, #8 GLOAMCALL, #11 FORGEHEART, #16 NIGHTFALL CYCLES]** #12's fixed counts are stale against its ship position: BESTIARY_ROSTER has 21 entries but #6 ships 4 drowned creatures six updates earlier (roster should be 24+); "26 relics" equals TODAY'S relics.js count, ignoring #8's umbral relics that ship before it; the boss pages ignore #11's three bosses and #6's Tidewarden; and #16 later adds 6 reliquary relics and 5 twilight elites that would strand the Archive's 100% Curator's Lantern.
  **RULING:** #12 owns the codex but must author it against the post-#11 world AND make it append-safe: BESTIARY_ROSTER includes the drowned family and twilight-elite slots come free via registry-driven pages; the Relics page and shelfProgress() compute denominators from the live relics.js roster, never a literal; boss coverage = The Twelve page (fixed) + roster-driven entries for Forgeheart bosses and the Tidewarden. Archive completion rewards CHECKPOINT at claim time — once claimed they are never revoked or re-locked when #16 (or any later update) grows a roster. #16's spec adds one line: its reliquary relics and twilight elites surface in the codex as data appends only, no codex UI changes.

- **[#16 NIGHTFALL CYCLES vs #11 FORGEHEART]** #16 says the cycle remix spans "all four biomes," but #11 ships biome 5 (Forgeheart, MAP_ORDER 5th entry) five updates earlier — #16's remix roster, twilight-elite placement, and multiplier tuning are authored against a stale world.
  **RULING:** #16 is authored against the post-#11 world: remixRoster and cycle content derive from MAP_ORDER (five biomes) and the live 15-boss campaign registry (Tidewarden excluded as mode-only, per the boss-taxonomy ruling). Every "four biomes" reference in #16's spec is corrected to "all campaign biomes (MAP_ORDER-driven)."

- **[#9 WAYLIGHT vs #11 FORGEHEART (and #6 UNDERTOW)]** #9 ships per-biome POI budgets for the four biomes existing at its ship date; #11 adds the forgeheart biome later but its append-only data list never touches waylight.js — Forgeheart would ship with undefined POI budgets. Separately, #6's mode-only Descent floors are not a biome and must not accidentally receive POIs.
  **RULING:** #9 owns WaylightSystem and must make it default-safe: an unknown biome id yields a zero budget (no POIs) rather than a crash. #11 owns Forgeheart's content and must append a forgeheart budget row to waylight.js in its PR1. #6 adds one line to its spec: WaylightSystem is inert in Descent (mode floors are not MAP_ORDER biomes, so the zero-budget default applies).

- **[#6 UNDERTOW vs #11 FORGEHEART (hazard semantics)]** #11's headline claim — slagflow is "the game's first enemy-affecting terrain... every other hazard touches only the player" — silently constrains #6's earlier tidepool hazard, which #6's spec never commits to.
  **RULING:** Locked in both specs: #6's BIOME_HAZARD.tidepool affects the player (and player-side allies) ONLY — it never damages or slows enemies. Enemy-affecting terrain is minted in #11's slagflow and remains #11's exclusive claim. Both extend the same BIOME_HAZARD config block append-only.
