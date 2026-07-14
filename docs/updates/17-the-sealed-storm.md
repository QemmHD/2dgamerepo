# Update #17: THE SEALED STORM — Forge Your Trial

*Era V — The Shared Flame*

**Value verdict (ADDS):** Determinism is a binary capability the codebase does not have and nothing else on the roadmap can substitute for — #19-era fair races and ghosts are impossible without it, and the CI assertion is what keeps the property from rotting. The retro-share auto-code on game-over is the clever value hook that makes the engineering visible to normal players, not just theorycrafters. Skeptic flags: the Game.js encounter split (PR2) is code-health payment riding along — legitimate here because determinism forces ordered updates anyway; and the Crucible composer's audience is niche, so PR4's copy-paste codes must work standalone before PR5's UI is judged.

## What it adds

Two runs launched from the same code become the SAME storm: one seeded run-RNG makes every spawn wake, elite roll, upgrade draft, chest pull, and crossroads fork identical for everyone holding the code, while VFX stays alive and random. On top of that determinism it ships the Crucible — a composer where players forge named, clamped, shareable trial rulesets ("THE BONE WALTZ — skeletons only, first boss at 90s") as short copy-paste codes, and every game-over screen auto-mints the code that reproduces the run you just died in. Under the hood it pays the repo's biggest code-health debt (the Game.js encounter-module split) and installs a CI determinism assertion so the property can never silently rot.

## Design spec

# THE SEALED STORM — Full Implementation Spec

*(L — deps: #4 BOSSFORGE perf gate, #15 ASHBOUND Torments. Planning grounded in the code as it exists today; interfaces expected from earlier roadmap updates are called out explicitly and never load-bearing.)*

## 0. Verified ground truth (the audit)

`grep -rc Math.random src/` sums to **exactly 158 sites** (roadmap's "~158" holds). Classification:

**SIM — must be seeded (60 sites):**
| File | Sites | What they decide |
|---|---|---|
| `src/core/Game.js` | 18 (1990, 2066, 2079, 2104, 2133, 2136–2137, 2304–2305, 2367, 2437, 2464, 3033, 3085, 3097, 3100, 3102, 3106) | boss placement angle, lieutenant type/placement/attack jitter, boss support picks/ring, coin-burst scatter, status spread, affix-death rings, health-orb drop, elite/lieutenant chest+coin drops |
| `src/entities/Enemy.js` | 10 of 11 (179, 208, 311, 501, 1325–1326, 1395–1396, 1444–1445) | attack-timer stagger, **elite affix pick**, attack patterns |
| `src/content/weapons.js` | 9 (47, 1009, 1111, 1404, 1422, 1497, 1601, 1610–1611) | crit, freeze, chain-chance, target pick, mote params |
| `src/systems/HazardSystem.js` | 6 (202, 207, 210, 216–217, 231) | biome-hazard cadence/placement |
| `src/systems/ChestRewards.js` | 4 (30, 88, 100, 124) | evolution/weapon/passive/coin-amount rolls |
| `src/systems/WickRoadsSystem.js` | 4 (125, 146, 149, 156) | crossroads forks, altar fusion/pact/relic draws |
| `src/systems/Spawner.js` | 2 (58, 65) + indirect via `randomRange`/`pickWeighted` (`MathUtils.js:44,55`) at Spawner.js:66, 85, 101 | elite roll, placement, cadence, **enemy type pick** |
| `src/systems/UpgradeSystem.js` | 1 (208) + indirect `pickWeighted` at 197 | level-up draft |
| pickups: `XPGem.js:20–21`, `Coin.js:24–25`, `HealthOrb.js:24–25` | 6 | launch scatter (affects pickup timing) |

**STAYS `Math.random` (98 sites):** `ParticleSystem` (62), `MenuRenderer` (10), `CaseSystem` (8 — menu meta-economy; seeding it would enable save-scum prediction of case pulls, deliberately live), `AudioSystem` (4), `Camera` shake (3), `UISystem` shake (2), `MathUtils` defaults (2), `MinigameOverlay` (1), `DamageNumber` (1), `Chest.js:16` + `Shrine.js:21` bob, `Enemy.js:234` animOffset, `Coin.js:21` spin, `HealthOrb.js:21` pulse (1 each).

**Determinism preconditions verified:** the run sim is pure-dt (no `Date.now`/`performance.now` inside gameplay update paths — the only hits are MenuRenderer.js:480, UISystem.js:2311, SaveSystem.js:769/780 gamble window, GameLoop.js:35, main.js, dailyChallenges.js:30 — all outside the stepped sim). Harness already steps synchronously with fixed `DT = 1/60` (harness.html:89, 145–156). `WaveDirector.getState()` is a pure function of `gameTime` (WaveDirector.js:94–238) — already deterministic.

**Seeding precedent verified:** four local `mulberry32` copies exist — `content/dailyRoad.js:16`, `content/dailyChallenges.js:34`, `systems/MapRenderer.js:32`, `systems/ObstacleSystem.js:33`. Obstacles are already seed-stable per biome (ObstacleSystem.js:110: `mulberry32(P.seed ^ strHash(biomeId) …)`), and `_placeStructures(rng,…)` (ObstacleSystem.js:166) consumes that stream — so the WORLD is already shared; only the ENCOUNTER stream is live today (dailyRoad.js:6–9 explicitly documents "This is NOT a seeded run").

---

## 1. The RunRng service (`src/core/RunRng.js` — NEW, ~110 lines)

```js
export function mulberry32(seed) { /* canonical copy of dailyRoad.js:16–24 */ }
export function fnv1a(str)       { /* 32-bit string hash — streams + code checksums */ }

export class RunRng {
    constructor(seed) { this.seed = seed >>> 0; this._streams = new Map(); }
    stream(name) {
        // lazy: mulberry32(this.seed ^ fnv1a(name)), wrapped with a draw counter
        // returns { next(), range(lo,hi), int(n), pick(arr), chance(p),
        //           pickWeighted(items, weightFn), draws }
    }
    snapshot() { /* { seed, draws: { streamName: count } } — determinism fingerprint */ }
}

// Module-level active-run handle for deep call sites (weapons.js damage helpers)
// where threading a param through 30+ function signatures is churn, not clarity.
// Falls back to Math.random when no run is active (menu, tests).
export function setActiveRunRng(rng | null) {}
export function runRand(streamName) {}       // -> number in [0,1)
export function runChance(streamName, p) {}  // -> boolean
```

**Eight named streams — the fairness architecture.** Stream separation is the load-bearing design decision: the number of `combat` draws depends on player behavior (shots fired), so if crits shared a stream with spawning, playing differently would reshuffle everyone's spawn schedule and the "same trial" promise would be a lie. With separated streams, the **spawn schedule, enemy types, elite rolls + affixes, upgrade drafts, chest pulls, and crossroads forks are byte-identical for every player on a code regardless of how they play**; behavior-coupled streams (`combat`, `ai`) remain seeded so identical inputs give identical runs (the CI property).

| Stream | Consumers |
|---|---|
| `spawn` | Spawner cadence/type/elite/placement (Spawner.js:58, 65–66, 85, 101) **plus pre-rolled enemy identity**: Spawner draws `affixIdx` and `timerJitter` from `spawn` and passes concrete values in the opts object it already builds (Spawner.js:72–77), because Enemy.js:208/179 draw at construction and a player-coupled stream there would desync elite identity across players |
| `director` | Game.js:1990, 2066, 2079, 2104, 2133, 2136–2137 (boss/lieutenant placement + support) |
| `loot` | Game.js:3033, 3085, 3097, 3100, 3102, 3106 + all 4 ChestRewards.js sites |
| `draft` | UpgradeSystem.js:197/208, WickRoadsSystem.js:125/146/149/156 |
| `combat` | weapons.js all 9 sites + Game.js:2367 status spread (via `runRand('combat')`) |
| `ai` | Enemy.js:311, 501, 1325–1326, 1395–1396, 1444–1445 + Game.js:2437/2464 affix-death patterns |
| `hazard` | HazardSystem.js all 6 sites (rng passed into `updateBiome`/update calls) |
| `scatter` | XPGem/Coin/HealthOrb launch velocities + Game.js:2304–2305 coin-burst scatter |

**Threading plan per consumer:**
- `MathUtils.js`: `randomRange(lo, hi, rng = Math.random)` and `pickWeighted(items, weightFn, rng = Math.random)` — additive trailing params (MathUtils.js:44, 50); all existing callers untouched.
- `Game._initRunState()` (Game.js:566): `this.runSeed = this._pendingSeed ?? ((Math.random() * 0x100000000) >>> 0)` (Math.random is fine as an entropy *source*); `this.rng = new RunRng(this.runSeed)`; `setActiveRunRng(this.rng)`; construct `new Spawner({ rng: this.rng.stream('spawn') })` at Game.js:611. `setActiveRunRng(null)` on `_enterGameOver`/menu return.
- `WaveDirector`: **zero changes** — 0 sites (verified; see codeCorrections).
- `ChestRewards.rollChestReward(game)` / `UpgradeSystem.rollChoices(game,…)` already receive `game` — read `game.rng.stream(...)` directly.
- `WickRoadsSystem.rollRoadChoices(count)` (WickRoadsSystem.js:119) gains a `game` first param; callers are `Game._presentCrossroads` (Game.js:1782) and `_presentAltar` (Game.js:1718).
- `Enemy`: constructor opts gain `{ affixIdx, timerJitter }` (pre-rolled by Spawner); update-time pattern rolls switch to `runRand('ai')`. `animOffset` (Enemy.js:234) stays `Math.random` — pure VFX.
- Seed surfaces: `runSummary.seed` + `runSummary.challengeCode` set in `_enterGameOver` (Game.js:2507–2522); game-over panel prints `SEED 3F92-A1C4` from PR1 so determinism is player-visible before the composer exists.

**Sequencing constraint (documented in-module):** the module-level `activeRunRng` means two Game instances must run *sequentially*, never interleaved — exactly how the CI det harness works (run A to completion, snapshot, then boot B).

---

## 2. Challenge-code format (`src/content/challengeCodes.js` — NEW, ~180 lines)

Human-shareable string: **`EW1-XXXXX-XXXXX-XXXXX-XXXXX-XXX`** — Crockford base32 (case-insensitive, no `I/L/O/U`, screenshot- and read-aloud-safe), 14-byte payload → 23 chars in dash groups.

**Binary layout v1 (14 bytes):**
| Bytes | Field |
|---|---|
| 0 | format version = 1 |
| 1–4 | seed (u32 LE) |
| 5 | map index into `MAP_ORDER` (u8) |
| 6 | difficulty (u8: 0 easy / 1 normal / 2 hard) |
| 7 | forced starting-road index+1 (u8, 0 = none) — same mechanism as Daily Road's forced road (Game.js:849–852) |
| 8–9 | Trial/Torment bitmask (u16 — 9 `RUN_MODIFIERS` today, GameConfig.js:1187–1197; bits 9–15 reserved for ASHBOUND Torments, which slot in as opaque ruleset bits when #15's data exists) |
| 10 | storm-clause id (u8, 0 = none) |
| 11 | clause parameter (u8 — e.g. monotype family index, boss-time slot) |
| 12–13 | CRC-16/CCITT over bytes 0–11 |

**Versioning:** decoder rejects unknown version bytes and any set bit/index beyond the known tables with a toast ("This trial was forged in a newer storm") — never silently runs a different trial. Additions bump the version byte; v1 decoders stay honest.

**Names are free:** the trial name is generated *deterministically from the code hash* — two seeded word lists (40 storm-adjectives × 40 forge-nouns = 1,600 names: "THE BONE WALTZ", "THE ASHEN GAVOTTE") — so the name costs zero payload bytes and every device derives the same name from the same code. Custom names are local-only labels in the save.

**Storm Clauses** (`src/content/stormClauses.js` — NEW, all-data, 10 at ship): `monotype` (curated 8-family whitelist replacing `typeWeights` across all `WAVES` entries, GameConfig.js:976–1058), `earlyBoss` (first boss at 90/120/150 s), `bossRushLite` (boss cadence ×0.6), `packedHouse` (cap ×1.25), `famine` (HEALTH_DROP.chance → 0, gate at Game.js:3033), `glassCannons` (hp ×0.6 / dmg ×1.6), `eliteParade` (elite floor 0.15), `darkVigil` (mapDarkness → 1.0, seam Game.js:864), `slowBurn` (wave-tier clock ×0.67 via a `waveTimeMul` applied where `_updateDirectors` computes wave time), `suddenDeath` (player maxHp ×0.5). Each clause folds into existing seams: `runScale` (Game.js:801, clamped by `_applyRunScale`, Game.js:1880), the `_mapMix` weight-override precedent (Game.js:873–874), and `WaveDirector.getState`'s existing `WAVE_LIMITS` clamps (WaveDirector.js:119–122, 177–180).

**`clampRuleset(rules)`** — ONE function used by both composer and decoder, so a hand-crafted hostile code can never exceed what the UI can compose. See balance table for the clamp values; the enemy cap holds **by construction** because every path re-clamps through `WAVE_LIMITS.maxEnemyCap = 180` (GameConfig.js:1136) exactly as Trials do today.

**Reward + records rule:** sealed runs pay coins/Pass-XP through the existing capped Trial formula (`RUN_MODIFIER_MAX_BONUS = 2.5`, GameConfig.js:1202) but **never write global bests** (`recordRun` is bypassed for `bestTime`-class records; a sealed run writes `crucible.bests[codeHash]` instead) — composing an easy code can't farm the ladder. Sealed mode is mutually exclusive with `dailyMode` and gauntlet scoring.

---

## 3. The Crucible composer UI

A "FORGE TRIAL" button on the PLAY tab (MenuRenderer `MENU_TABS`, MenuRenderer.js:56–66) opens a full-screen composer overlay drawn by MenuRenderer using the existing hotspot registry (`this.hotspots` / `_hot`, MenuRenderer.js:115–119 — the exact seam #18's focus-ring will later walk). Panels:
1. **Map** — use `SaveSystem.getAllMapUnlockStatuses()`; honestly unlocked maps are selectable, locked maps expose exact predecessor progress, and a session QA bypass clearly disables campaign credit.
2. **Difficulty + Trials** — reuses the `selectedModifiers` toggle pattern (Game.js:174); Torment rows appear here when #15's data ships.
3. **Storm Clause** — one clause + its parameter (single-clause v1 keeps the combinatorial balance surface sane).
4. **Seed** — dice-reroll button, and "SEAL LAST RUN" (copies `runSummary.seed`).
5. **Readout** — live deterministic name, the `EW1-…` code, COPY (`navigator.clipboard.writeText`, gesture-safe on iOS since it's a tap), and ENTER CODE (a temporarily-appended DOM `<input>` overlay — the canvas UI has no text entry; paste tries `navigator.clipboard.readText()` first, falls back to the input).
6. **BEGIN TRIAL** — `game._startRun({ sealed: clampedRuleset })`; the wave-1 announcement banner is replaced with the trial name via the existing `waveDirector.announce` channel (WaveDirector.js:90–92).

**Game-over integration:** every run (sealed or free) auto-mints its own code in `_enterGameOver` (`buildChallengeCode(this)` from the run's actual seed/map/difficulty/modifiers/clause) into `runSummary.challengeCode`; UISystem's game-over panel gets a "COPY TRIAL CODE" chip, and the Emberglass compositor (#2, which precedes this update) stamps `name + code` on the minted card — with a plain-text fallback that works even if the compositor is absent.

A "RECENT TRIALS" shelf (last 10 codes with clears/best time from `save.crucible`) renders under the composer for one-tap re-runs of a friend's dare.

---

## 4. The Game.js encounter-module split

Game.js is 3,887 lines. Extract three run-scoped modules (stateless functions taking `game` as first arg; Game keeps 1-line delegates so UISystem/harness call sites never change):

| New module | Methods moved (current lines) | ~LOC |
|---|---|---|
| `src/core/run/LootDrops.js` | `_dropChest` (2277), `_dropBossReward` (2285), `_dropCoin` (2297), `_dropCoinBurst` (2302), `_dropGem` (3347), `_applyAffixDeath` (2393), `_splitOnDeath` (2453) | ~200 |
| `src/core/run/StatusEffects.js` | `_tickStatuses` (2317–2392) | ~80 |
| `src/core/run/Encounters.js` | `_tickSupportEnemies` (1927), `_spawnBoss` (1971), `_startBossWarning` (2052), `_startLieutenantWarning` (2064), `_spawnLieutenant` (2073), `_spawnBossSupport` (2121), `_updateBossThresholds` (2151) | ~360 |

Extraction order: LootDrops (leafiest — pure entity-spawning helpers) → StatusEffects → Encounters (touches arena/warning/HUD state). This split lands **before** the Game-side RNG threading on purpose: 16 of Game.js's 18 sim `Math.random` sites live inside these methods, so the move-only PR keeps the subsequent threading diff small and reviewable. Target: Game.js ≤ ~3,250 lines after the split (the roadmap's assigned code-health item, sequencing note #4).

---

## 5. CI determinism assertion

`tools/artshot/harness.html` gains `seed=<u32>` and `det=1` params. Det mode (building on the existing synchronous stepper, harness.html:145–156, whose auto-dismiss `selectUpgrade(0)` / `selectAltar(0)` is itself deterministic):
1. Boot Game A with `_startRun({ seed })`, force `particlesEnabled = false`, `shakeEnabled = false` (VFX noise off), step `SECONDS × 60` frames.
2. Fingerprint: FNV-1a over `[time, kills, spawner.spawnsTotal, player.{x,y,hp,level} (positions ×100 |0), enemies.length, per-enemy (type, elite, affix, x,y ×100 |0), rng.snapshot() draw counts]`.
3. Construct a **fresh** `new Game({renderer,input,loop})` (harness already builds these, harness.html:94–109), repeat with the same seed, compare.
4. Title becomes `DONE EXC:0 enemies:N DET:<hash8>:OK|FAIL` (extends the existing contract at harness.html:187 that ci.yml already greps).

`.github/workflows/ci.yml` adds one step after the existing smoke: run `?seconds=45&badge=1&det=1&seed=1337` and again with `seed=7777` (45 s covers wave transitions + the lieutenant window; two seeds catch seed-shaped luck), grep `DET:[0-9a-f]*:OK`, and bump `--virtual-time-budget` to 30000 for the doubled sim. Float determinism note: IEEE-754 ops are bit-deterministic within the pinned CI Chromium; cross-browser drift can't corrupt *fairness* because the fair-shared artifacts (spawn schedule, types, elites, drafts, loot) are integer stream draws.

**Regression armor:** `tools/check-rng-allowlist.mjs` (NEW, ~60 lines) — counts `Math.random` occurrences per src file against a committed allowlist (the 98 VFX/menu sites); CI fails when anyone adds an unseeded roll to a sim file. This is what keeps determinism true in update #19's races a year later.

---

## 6. NEW vs REUSED

**NEW modules:** `src/core/RunRng.js`, `src/core/run/LootDrops.js`, `src/core/run/StatusEffects.js`, `src/core/run/Encounters.js`, `src/content/challengeCodes.js`, `src/content/stormClauses.js`, `tools/check-rng-allowlist.mjs`.
**NEW save keys (additive, no version bump — follows the "Vigil Endures" numeric-defaults precedent, SaveSystem.js:47–53):** `crucible: { recent: [], bests: {}, names: {} }` added to `defaultData()` (SaveSystem.js:16) and to `_validate`'s fixed-shape return (SaveSystem.js:360 — **required**, since `_validate` drops unknown keys), clamped with `validateIdList`-style guards (recent capped at 10, bests values numeric-clamped).
**EXTENDED:** `MathUtils.js` (optional rng params), `Spawner.js` (opts.rng + pre-rolled enemy identity), `Enemy.js` (identity via opts, behavior via `runRand`), `weapons.js` (`runRand('combat')`), `HazardSystem.js` (rng param), `ChestRewards.js` / `UpgradeSystem.js` / `WickRoadsSystem.js` (game.rng streams), `Game.js` (seed lifecycle, sealed ruleset, delegates), `MenuRenderer.js` (composer overlay), `UISystem.js` (seed/code on game-over), `harness.html` (det mode), `ci.yml` (det step). **REUSED as-is:** `WaveDirector` (already pure), `ObstacleSystem`'s seeded world, the `WAVE_LIMITS`/`_applyRunScale` clamp stack, the Trial-bonus reward formula, the hotspot registry, Daily Road's forced-road mechanism.

## PR plan

### PR1 — PR1 — RunRng core + shared-fate threading (spawner/drafts/loot) + visible seed

**Goal:** One mulberry32 run-RNG exists and everything that defines a run's shared fate (spawn schedule, enemy types, elites, upgrade drafts, chest pulls, crossroads) draws from named streams; the seed prints on the game-over summary.

**Files:**
- `src/core/RunRng.js (NEW)`
- `src/core/MathUtils.js`
- `src/systems/Spawner.js`
- `src/systems/ChestRewards.js`
- `src/systems/UpgradeSystem.js`
- `src/systems/WickRoadsSystem.js`
- `src/core/Game.js`
- `src/systems/UISystem.js`

**Work:**
- Create RunRng (mulberry32 + fnv1a + stream() + snapshot() + setActiveRunRng/runRand)
- Add optional rng params to randomRange/pickWeighted (MathUtils.js:44,50)
- Thread stream('spawn') through Spawner.js:58/65/66/85/101; pre-roll enemy affixIdx + timerJitter in Spawner opts
- Wire game.rng.stream('loot'|'draft') into ChestRewards (4 sites), UpgradeSystem.js:197/208, WickRoadsSystem (4 sites, rollRoadChoices gains game param; update callers Game.js:1718/1782)
- Seed lifecycle in _initRunState (Game.js:566) + _startRun opts.seed; runSummary.seed in _enterGameOver (Game.js:2507); SEED readout on game-over panel

**Verify:**
- node --check on all touched files
- node tools/validate-assets.js exit 0
- harness ?seconds=35&badge=1 shows EXC:0
- Manual double-run: two harness runs with the same forced seed print identical spawner.spawnsTotal + first-10-enemy type list (temporary console assert)

### PR2 — PR2 — Game.js encounter-module split (move-only)

**Goal:** LootDrops / StatusEffects / Encounters extracted from Game.js with 1-line delegates; zero behavior change; Game.js drops ~640 lines.

**Files:**
- `src/core/run/LootDrops.js (NEW)`
- `src/core/run/StatusEffects.js (NEW)`
- `src/core/run/Encounters.js (NEW)`
- `src/core/Game.js`

**Work:**
- Move _dropChest/_dropBossReward/_dropCoin/_dropCoinBurst/_dropGem/_applyAffixDeath/_splitOnDeath (Game.js:2277–2473, 3347) to LootDrops.js as functions taking game
- Move _tickStatuses (Game.js:2317) to StatusEffects.js
- Move the seven boss/lieutenant methods (Game.js:1927–2286) to Encounters.js
- Keep delegates on Game so UISystem/harness call sites are untouched; imports only, no logic edits

**Verify:**
- node --check
- harness ?seconds=35&badge=1 EXC:0 AND enemies>0 (boss-warning path exercised at 45s too)
- Diff review confirms move-only (adversarial review focus)
- Game.js line count ≤ ~3,250

### PR3 — PR3 — Full sim threading + det harness + CI determinism assertion

**Goal:** All 60 sim sites seeded (combat/ai/hazard/scatter/director), and CI proves same-seed same-run on every push forever.

**Files:**
- `src/core/run/LootDrops.js`
- `src/core/run/StatusEffects.js`
- `src/core/run/Encounters.js`
- `src/entities/Enemy.js`
- `src/content/weapons.js`
- `src/systems/HazardSystem.js`
- `src/entities/XPGem.js`
- `src/entities/Coin.js`
- `src/entities/HealthOrb.js`
- `src/core/Game.js`
- `tools/artshot/harness.html`
- `tools/check-rng-allowlist.mjs (NEW)`
- `.github/workflows/ci.yml`

**Work:**
- Thread director/loot/scatter streams through the extracted modules (16 Game-side sites) + Game.js:2367 status spread
- Enemy behavior rolls → runRand('ai') (Enemy.js:311,501,1325–1445); keep animOffset (234) live
- weapons.js 9 sites → runRand('combat'); HazardSystem 6 sites → rng param; pickup scatter → 'scatter' (keep pulse/spin/bob live)
- harness det=1 + seed= params: sequential double-run fingerprint (VFX flags off), DET:<hash>:OK|FAIL appended to title
- check-rng-allowlist.mjs with the 98-site VFX allowlist; ci.yml: allowlist step + two det runs (seeds 1337, 7777, 45s, budget 30000)

**Verify:**
- node --check + validate-assets
- harness ?seconds=45&det=1&seed=1337 title contains DET:…:OK (and with seed=7777)
- Flip one seeded site back to Math.random locally → DET:FAIL and allowlist step fails (negative test)
- Standard EXC:0 screenshot unchanged

### PR4 — PR4 — Challenge-code codec + Storm Clauses + retro-share on game-over

**Goal:** Every run mints a copyable EW1 code that reproduces it; decoded codes launch clamped sealed runs; sealed runs pay Trial rewards but never write global bests.

**Files:**
- `src/content/challengeCodes.js (NEW)`
- `src/content/stormClauses.js (NEW)`
- `src/core/Game.js`
- `src/systems/SaveSystem.js`
- `src/systems/UISystem.js`

**Work:**
- 14-byte v1 payload + CRC-16 + Crockford base32 codec + deterministic 40×40 name generator + clampRuleset (shared composer/decoder)
- 10 storm clauses folding into existing seams (runScale Game.js:801, _mapMix pattern Game.js:873, HEALTH_DROP gate Game.js:3033, mapDarkness Game.js:864, waveTimeMul in _updateDirectors)
- _startRun({sealed}) path: mutually exclusive with dailyMode/gauntlet; trial-name announcement via waveDirector.announce; records → crucible.bests[codeHash] only
- runSummary.challengeCode + COPY TRIAL CODE chip on game-over; Emberglass stamp hook (text fallback)
- save crucible key in defaultData (SaveSystem.js:16) AND _validate return (SaveSystem.js:360) with clamps

**Verify:**
- node --check + validate-assets
- Round-trip unit script: encode→decode 500 random rulesets byte-identical; corrupted CRC + future-version codes rejected
- harness EXC:0; det run under a sealed monotype clause also DET:OK
- Old save (pre-crucible key) loads clean; sealed easy run does not move bestTime

### PR5 — PR5 — Crucible composer UI + recent-trials shelf + docs

**Goal:** The player-facing forge: compose, name-preview, copy, paste, and launch trials from the menu; recent codes one-tap re-runnable.

**Files:**
- `src/systems/MenuRenderer.js`
- `src/core/Game.js`
- `src/systems/UISystem.js`
- `docs/ROADMAP.md`
- `CLAUDE.md (pipeline notes if any)`

**Work:**
- FORGE TRIAL button on PLAY tab + full composer overlay via the hotspot registry (MenuRenderer.js:115–119): map/difficulty/Trials/clause/seed panels, live name + code readout
- COPY via navigator.clipboard; ENTER CODE via temporary DOM input overlay (touch-safe paste fallback)
- RECENT TRIALS shelf (save.crucible.recent, cap 10) with clears/best; BEGIN TRIAL → _startRun({sealed})
- Menu-tour/hotspot regression pass; procedural wax-seal chip icon (canvas-drawn, non-blocking)

**Verify:**
- node --check + validate-assets
- harness ?screen=menu&tab=play&badge=1 EXC:0 screenshot shows composer button; composer-open screenshot reviewed
- Full manual loop on desktop + touch emulation: compose → copy → restart session → paste → identical run (compare seed + first-minute spawns)
- CI green including both det seeds

## Data & save changes

**New content/data files:** `src/content/challengeCodes.js` (codec + clampRuleset + name word-lists), `src/content/stormClauses.js` (10 all-data clause defs: { id, name, desc, param slots, fold hooks }). **New core modules:** `src/core/RunRng.js`, `src/core/run/{LootDrops,StatusEffects,Encounters}.js`. **New tool:** `tools/check-rng-allowlist.mjs` (+ its committed allowlist of the 98 live-VFX sites). **Save schema (additive only, no version bump — mirrors the numeric-defaults precedent at SaveSystem.js:47–53):** `crucible: { recent: [{code, name, clears, bestTime}] (cap 10), bests: { [codeHash8]: {time, kills, day} }, names: { [codeHash8]: customLabel } }` — added to BOTH `defaultData()` (SaveSystem.js:16) and `_validate`'s fixed-shape return (SaveSystem.js:360), since `_validate` drops unknown keys; validated with existing clamp helpers. **Config blocks:** none in GameConfig beyond reading existing `RUN_MODIFIERS` / `DIFFICULTY` / `WAVE_LIMITS`; clause tunables live in stormClauses.js. **CI:** ci.yml gains the allowlist step + two det-mode harness runs. Nothing is removed or renamed; every existing save loads unchanged.

## Balance numbers (all tunable)

| Number | Value | Rationale |
|---|---|---|
| Run seed width | 32-bit (u32) | matches mulberry32 domain + 4-byte payload slot (tunable: never) |
| RNG streams | 8 named | minimum set that isolates player-coupled draws (combat/ai) from fair-shared draws (spawn/loot/draft) (tunable) |
| Sim sites threaded | 60 of 158 | audit above; 98 VFX/menu sites stay live (tunable only upward) |
| Code payload | 14 bytes → 23 base32 chars, `EW1-` + 5 groups | fits a tweet/DM, read-aloud-safe (tunable) |
| Checksum | CRC-16/CCITT | catches transcription typos; 1-in-65k false accept (tunable) |
| Name generator | 40 adj × 40 nouns = 1,600 names | zero payload cost, collision-tolerant (labels, not keys) (tunable) |
| Storm clauses at ship | 10, exactly 1 per code | single-clause keeps the balance surface auditable in v1 (tunable) |
| Clamp: alive-cap mult | ≤ 1.35, final cap ≤ WAVE_LIMITS.maxEnemyCap 180 | matches today's `swarm` Trial; 180 enforced by construction (WaveDirector.js:119–122, 177–180) (cap NOT tunable) |
| Clamp: hp product (diff × mods × clause) | ≤ 8.0 | Nightmare 1.55 × Juggernauts 1.3 × glassCannons headroom, under maxHealthMultiplier 7 pre-hyper stack (tunable) |
| Clamp: damage product | ≤ 3.0 | keeps a frenzied-elite pile a two-shot, per the maxDamageMultiplier 2.5 design note (GameConfig.js:1080–1086) (tunable) |
| Clamp: spawn interval mult | ≥ 0.6 | vs Relentless 0.72 today; floor 0.1 still guards in getState (tunable) |
| Clamp: elite chance | ≤ 0.85 | existing run-scale clamp cited in WaveDirector.js:129–131 comment (not tunable) |
| Clamp: earliest first boss | 90 s (slots 90/120/150) | the roadmap hook's number; 60 s reserved as a v2 slot (tunable) |
| Monotype whitelist | 8 families | only types with full sprite fallback chains (tunable) |
| Sealed-run reward | standard Trial formula, bonus cap 2.5 | reuses RUN_MODIFIER_MAX_BONUS (GameConfig.js:1202); no new economy (tunable) |
| Sealed-run records | crucible.bests only, never global bests | anti-farm hard rule (not tunable) |
| Recent-trials shelf | 10 codes | save-size hygiene (tunable) |
| CI det runs | seeds 1337 & 7777, 45 s, 60 fps, exact fingerprint match | 45 s spans 4 wave tiers + lieutenant window; two seeds kill seed-luck (tunable) |
| CI virtual-time budget | 30000 ms (from 15000) | doubled sim per det run (tunable) |
| Game.js after split | ≤ ~3,250 lines (from 3,887) | ~640 lines across 3 modules (tunable) |

## Art needs (non-blocking)

- Procedural first (ships PR5, blocks nothing): canvas-drawn wax-seal 'storm sigil' chip for the code readout + game-over COPY chip, in the existing ember/forge palette via DrawUtils.
- higgsfield (separate session, non-blocking polish): one Nano Banana 2 emblem — a sealed storm-in-a-bottle wax stamp, dark-fantasy ember styling, keyed via tools/artshot/key-sprite.mjs — swapped in for the procedural sigil; credited in ASSET_CREDITS.md.
- Blender pipeline: NOT needed — no characters/creatures/props in this update; canonical enemy sheets untouched (monotype clauses only re-weight existing types).
- Optional menu flourish (non-blocking): animated lightning flicker on the composer header done procedurally with MenuRenderer's existing accent system — no new assets.

## Risks

- Silent determinism rot (highest): one future Math.random added to a sim path breaks 'same code, same storm' invisibly. Designed-in from the start: CI double-run fingerprint (PR3) on two seeds + tools/check-rng-allowlist.mjs failing CI on any new unseeded site + the stream architecture pre-rolling enemy identity in Spawner so player-coupled draws can never desync shared fate.
- Save-shape regression: _validate returns a FIXED object (SaveSystem.js:360) so forgetting to add `crucible` there silently wipes players' trial history every load. Mitigation: PR4 adds the key to defaultData AND _validate in the same commit, with an old-save load test in its verify recipe; arrays capped (10 recent) so the single localStorage key can't bloat.
- Hostile/degenerate codes: a hand-packed code could try cap 255 or hp ×40, or an easy code could farm records. Mitigation: decoder and composer share ONE clampRuleset; the final cap always re-clamps through WAVE_LIMITS.maxEnemyCap 180 by construction; sealed runs pay only the existing capped Trial bonus and write crucible.bests instead of global bests; unknown versions/bits are rejected, never guessed.
- Mobile/clipboard friction: iOS Safari clipboard needs a user gesture and canvas UI has no text input. Mitigation: COPY is a tap (gesture-safe); ENTER CODE uses a temporary DOM input overlay with readText() fast-path; base32 codes are case-insensitive and dash-grouped so manual typing is survivable.
- CI flakiness/cost: doubled 45 s sims could exceed the virtual-time budget and det-mode module-level activeRunRng assumes sequential instances. Mitigation: budget bumped to 30000, runs are strictly sequential (A completes before B boots), VFX flags forced off in det mode so the fingerprint never touches live-random systems.

## Uniqueness & boundaries

No other update in the roadmap makes the simulation itself reproducible — #17 is the only place the seeded run-RNG, the shareable ruleset codec, the Crucible authoring surface, the CI determinism gate, and the Game.js encounter split exist; everything Era V builds on top (fair races, ghosts on locked seeds) is impossible until this ships. Sharpest boundaries: **#19 EMBER RACE** (nearest neighbor) owns everything about *other players in your run* — telemetry ghost recording/encoding, race-result flow, pace markers, and any 'sealed Daily' — #17 deliberately ships zero ghost/race code and leaves dailyRoad setup-seeded-only (per dailyRoad.js:6–9), providing only the seed-lock + codec #19 consumes. **#15 ASHBOUND** owns Torment definitions and the ladder — #17's composer treats Torment ids as opaque reserved bits in the u16 mask and defines none. **#14 LEDGER** owns save hardening/export-import and career archives — #17 adds only the small clamped `crucible` keys and no export path. **#2 EMBERGLASS** owns the card compositor — #17 only stamps a code string into the existing game-over summary plus a compositor hook with a text fallback.

## Roadmap corrections found while grounding

- Roadmap says the RNG is 'threaded through Spawner/WaveDirector/elites/upgrades/chests' — WaveDirector.js contains ZERO Math.random sites (verified; grep count 0). It is already a pure function of gameTime (WaveDirector.js:94–238) and needs no threading; the elite roll it implies actually lives in Spawner.js:58, and lieutenant/boss-support randomness lives in Game.js:2066–2137. The spec threads those instead.
- Roadmap's '~158 audited Math.random sites' verified EXACT: the per-file grep sums to precisely 158 across src/ (largest: ParticleSystem 62, Game 18, Enemy 11, MenuRenderer 10).
- The dailyRoad seeding precedent holds but is narrower than a casual read suggests: dailyRoad.js:6–9 explicitly documents 'This is NOT a seeded run — only the SETUP is shared.' Also mulberry32 exists as FOUR separate local copies (dailyRoad.js:16, dailyChallenges.js:34, MapRenderer.js:32, ObstacleSystem.js:33); RunRng.js becomes the canonical export (existing copies left in place to keep PR1 move-free — consolidation is optional follow-up, not load-bearing).
- One favorable finding beyond the synopsis: the run sim is already wall-clock-free (no Date.now/performance.now inside gameplay update paths — only menu/UI/GameLoop/save-window uses) and the harness already steps synchronously at fixed 1/60 dt (harness.html:89,145–156), so Math.random threading is the ONLY blocker to full determinism — no timing refactor is needed.

## Binding cross-spec rulings affecting this update

- **[#2 EMBERGLASS vs #13 THE LAST HEARTH vs #17 THE SEALED STORM]** #2's docs/CARDS.md freezes the CardCompositor reuse contract as "updates 3/14/15/19/20" (matching ROADMAP.md:29), but #13 PR4 ships a siege share card and #17 PR4 auto-mints a shareable challenge-code card on every game-over screen — two card producers outside the frozen contract list, each at risk of building parallel share plumbing.
  **RULING:** #2 owns ALL card/share plumbing; the CardCompositor template registry is an OPEN, append-only contract, and docs/CARDS.md must be re-worded from a closed five-update list to "any update registers templates via registerTemplate(); known consumers: 3, 13, 14, 15, 17, 19, 20." #13 registers a 'siege' template and #17 registers its game-over challenge-code presentation through that contract; neither ships its own offscreen canvas, share ladder, or clipboard/navigator.share code.

- **[#2 EMBERGLASS vs #15 ASHBOUND vs #17 THE SEALED STORM]** Three updates claim the same game-over/death card surface: #2 authors the death-card template, #15 stamps an Ash Rank wax seal on it (blazing/cracked), and #17 retro-shares the reproduction challenge code on it. Authored independently, #15 and #17 each imply editing #2's death template.
  **RULING:** #2 owns the death/victory templates and must define named EXTENSION SLOTS in src/content/cardTemplates.js and docs/CARDS.md: a 'stamp' slot (badge region) and a 'footer' slot (code/text line). #15's wax seal registers into the stamp slot; #17's challenge code registers into the footer slot. Neither #15 nor #17 forks or redraws the death template; slot renderers are pure draw functions passed to the compositor.

- **[#4 BOSSFORGE vs #8 GLOAMCALL vs #17 THE SEALED STORM]** #8's 'swarm' kind (Duskmoths/Veilwisps gloam-motes) is specced to "live outside the projectile pool" — directly against #4's load-bearing substrate (pooling + the first ENFORCED projectile caps + shared spatial grid) and against #17's determinism requirement of pooled/ordered entity updates. An unpooled, uncapped, self-colliding mote class re-opens the O(P×E) hot loop and the per-shot allocations #4 exists to close.
  **RULING:** #4 owns the perf substrate. Swarm motes MAY be a distinct entity class from projectiles, but they MUST (a) be pooled with a hard cap declared in GameConfig (counted in a SWARM budget beside the ~220-projectile cap), (b) resolve collisions through #4's shared spatial grid — no parallel collision path, and (c) update in stable, pooled iteration order so #17's determinism assertion holds. #8's spec replaces "live outside the projectile pool" with "live in their own pooled, capped, grid-registered swarm pool."

- **[#14 THE LEDGER OF ASHES vs #17 THE SEALED STORM (re: #19)]** #14 claims it "mints the per-run telemetry traces that update 19's ghost races will consume" (monkey-survivor:traces:v1) — sanctioned by the spine (ROADMAP.md:168-169). #17's boundary text contradicts this by assigning "telemetry ghost recording/encoding" to #19.
  **RULING:** #14 owns trace RECORDING and local persistence (the traces:v1 ring buffer, sampling cadence, size caps). #19 owns ghost SHARE-ENCODING (delta-encoded base64 race strings), spectre rendering, and race semantics. #17 owns neither — only the seeded sim that makes races fair. #17's boundary sentence is corrected to: "#19 owns ghost share-encoding, rendering, and races; the raw traces are minted by #14."
