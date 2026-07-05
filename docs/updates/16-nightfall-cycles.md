# Update #16: NIGHTFALL CYCLES — The Rekindling

*Era IV — The Long Vigil (deps: 4 BOSSFORGE, 15 ASHBOUND)*

**Value verdict (IMPROVES):** The pitch overstates: 'the endgame loop the game currently lacks' — Game.js:1179-1183 shows a post-victory continuation (endless Gauntlet with bestGauntletScore) already ships. What actually exists is weak (a score counter until the hypergrowth wall kills you), and structured cycles, the boss remix, twilight elites, and the deferred wall upgrade it into a real endgame, with the Ingot/mythic/Reliquary prestige economy as the genuinely additive half. Meaningful and removal-noticed, but the spec must state what happens to the existing Gauntlet mode and its score records — replacing it silently orphans a shipped leaderboard stat.

## What it adds

The endgame loop the game currently lacks: after the 3rd-boss victory, a REKINDLE choice rolls the same run into Cycle II/III/IV... — the world re-ignites, enemies compound, the boss roster remixes across all four biomes, and a cycle-exclusive twilight elite stalks each cycle. It converts the hypergrowth wall from an arbitrary 20-minute death sentence into a pacer you push back by clearing cycles, and it mints the game's prestige economy: Everforge Ingots buying six mythic material-variant wands and six Reliquary legendary relics that feed back into shrine drafts.

## Design spec

# NIGHTFALL CYCLES — full mechanics spec

## 0. The problem this solves (verified in code)

Today a run has exactly two post-victory fates. `victoryContinue()` (src/core/Game.js:1181) arms `_gauntletActive` and the same 3-boss roster cycles forever (`BossDirector.update`, src/systems/BossDirector.js:42: `this.bossTypes[this.spawnsTotal % this.bossTypes.length]`). Meanwhile the hypergrowth wall — `ENDLESS_SCALING.hyperStartMinutes: 20`, `hyperPerMinuteMul: 1.4` (src/config/GameConfig.js:1130-1131), consumed on ABSOLUTE run time in WaveDirector.getState (src/systems/WaveDirector.js:196-205, folded into healthMul/damageMul at :229-231, deliberately bypassing WAVE_LIMITS) — kills every endless run around minute 25-28 regardless of skill. Endless is therefore repetitive AND time-boxed. Cycles replace both: same-roster monotony (remix) and the arbitrary wall (deferral-by-achievement).

## 1. The Rekindle choice (UX)

The 3rd-boss victory overlay (`_showVictory` Game.js:1150, opened by the `isFinalBoss` latch at Game.js:3054-3078) grows a FOURTH, hero-position button:

- Layout: `_victoryRects()` (Game.js:3653-3662) returns 4 rects; to keep touch targets ≥96px on a 1080 canvas, `top` moves from `H/2 - 40` to `H/2 - 96`, gap 26→20, and `rekindle` sits first: REKINDLE / CONTINUE / PLAY NEW BIOME / MAIN MENU.
- Draw: `_drawVictory` (Game.js:3664-3701) renders the new button in ember-gold (`#5a2a10` fill / `#ff9a3c` border): label `REKINDLE — CYCLE II`, sub `carry your build • the Hollow return stronger • earn Ingots`. Subtitle line (Game.js:3679) becomes cycle-aware: on cycle ≥ 2 victories it reads `Cycle II survived. The wick asks for more.`
- Input: keyboard `KeyR` added beside the existing bindings (Game.js:258-261); pointer + touch already route through `tryVictoryAt` (Game.js:404-411, 490-491, 514-515) — the new rect joins the same hit test. Gamepad comes free later via #18's hotspot walking.
- First-time discovery: the button is ALWAYS present (no unlock) — the endgame advertises itself at the moment of triumph, per the punch-list note "endgame walls surfaced in HUD/fiction".

### What `_rekindle()` does (new method, ~60 lines, called like victoryContinue)
1. `this.victory = null; this.cycle += 1;` (`this.cycle` initialized to 1 in `_initRunState` near Game.js:666).
2. **Clean the board**: flush pickups to the player (XP gems grant their XP, coins/orbs collect instantly — reuse the pickup-grant paths), then clear `enemies`, `enemyProjectiles`, `hazards`, `bossSummons`. Nothing leaks; the arena is already null (Game.js:3072).
3. **Mercy heal**: `p.hp = min(p.maxHp, p.hp + 0.5 * (p.maxHp - p.hp))` — half the missing HP (tunable).
4. **Remix the roster**: `this.bossDirector = new BossDirector(remixRoster(this.cycle, ctx))` (constructor already accepts an ordered types array, BossDirector.js:19-27 — zero changes needed there); then `this.bossDirector.nextSpawnTime = this.time + CYCLES.firstBossGrace` (90s, tunable — shorter than the 160s `BOSS.spawnInterval` at GameConfig.js:681 because the build is already online).
5. **Apply the cycle layer**: set `this.cycleScale` from the table in §2; `_applyRunScale` (Game.js:1880-1919) gains a third factor `c` beside run `r` and segment `s` at lines 1888-1895. The existing clamps hold by construction: eliteChance `min(0.85, …)` (:1891), maxAlive `min(220, …)` (:1894).
6. **Defer the wall**: `this.waveDirector.hyperDeferMinutes = min(CYCLES.hyperDeferMax, (cycle-1) * CYCLES.hyperDeferPerCycle)` — a new public field on WaveDirector, read at WaveDirector.js:202 as `gameMinutes - (ENDLESS_SCALING.hyperStartMinutes + this.hyperDeferMinutes)`. Reset `this._hyperAnnounced = false` (Game.js:691) so the wall warning re-fires each cycle.
7. **Setpiece**: `waveDirector.announce('CYCLE ' + roman(cycle) + ' — THE WICK REKINDLES', 4.0, '#ffb24a')`, a full-screen warm flash via `this.feedback` (Game.js:709), the triple `_spawnRing` used for boss kills (Game.js:3067-3069) centered on the player, `audio.victoryFanfare()` reprise, then `audio.playMusic('gameplay')` (biome latched, same as victoryContinue Game.js:1185). MapRenderer paints a per-cycle dusk grade (§5).
8. **Bookkeeping**: `_gauntletActive = true` (the gauntlet score formula at Game.js:2503 keeps counting — bossesDefeated×500 naturally rewards cycles; add `+ 1500 * (cycle-1)` cycle bonus, tunable); bank the completed cycle's Ingots (§4, latched); `saveSystem.recordCycle(mapId, cycle)` updates `cycles.best` / `bestPerMap` immediately (crash-safe — reaching the cycle is the achievement, not surviving it).

The finality check at Game.js:3054 changes from `bossesDefeated >= 3 && !_victoryShown` to `bossesDefeated >= 3 * this.cycle && !_victoryShown`, and `_victoryShown` un-latches inside `_rekindle()` so the overlay re-opens at each cycle's 3rd boss. CONTINUE keeps its exact current semantics (old-style gauntlet, wall un-deferred beyond already-earned deferral) — nothing existing breaks.

## 2. Cycle multiplier table I–V+ (all tunable)

Folded as `cycleScale` in `_applyRunScale`; boss HP inherits it automatically because `bossHpMul` multiplies `runScale.hp`-composed waveState at Game.js:2022.

| Cycle | enemy HP | contact dmg | speed | elite mul | pack +| XP value | coin mul | wall deferral |
|---|---|---|---|---|---|---|---|---|
| I | 1.00 | 1.00 | 1.00 | 1.00 | +0 | 1.00 | 1.00 | +0 min (wall @20) |
| II | 1.35 | 1.20 | 1.05 | 1.25 | +1 | 1.15 | 1.25 | +12 (wall @32) |
| III | 1.80 | 1.45 | 1.08 | 1.55 | +1 | 1.30 | 1.50 | +24 (wall @44) |
| IV | 2.40 | 1.75 | 1.10 | 1.90 | +2 | 1.45 | 1.80 | +36 (wall @56) |
| V | 3.10 | 2.10 | 1.10 | 2.30 | +2 | 1.60 | 2.15 | +48 (wall @68, MAX) |
| V+ each | ×1.30 | ×1.20 | 1.10 cap | ×1.15 | +2 cap | +0.10 (≤2.0) | +0.35 | none — the wall wins |

**Speed is deliberately capped at ×1.10**: `_applyRunScale` does NOT re-clamp speedMul (Game.js:1889 — the WAVE_LIMITS.maxSpeedMultiplier 2.3 clamp happens upstream in WaveDirector.js:110-113), and 2.3 was tuned so speedDemon 330×2.3=759 stays under CAPS.moveSpeed 760 (GameConfig.js:1135-1142). A compounding cycle speed factor would break outrunnability with no counterplay; HP/damage carry the escalation instead. This is a load-bearing constraint, not a tuning choice.

**Why the run still ends**: player power plateaus at CAPS (damageMul 3.5, cooldown floor 0.40 — GameConfig.js:102-109) around cycle II-III, while cycle HP compounds ×1.30 past V and the deferral stops. Median deep runs die cycle IV-VI; `stats.bestCycle` is the new ladder stat. Each cycle takes ~10-12 min (grace 90s + 2×160s spawnInterval + fights), which is exactly what one +12-min deferral buys — clear on pace or the wall catches you. The wall is now a PACER, not a timer.

## 3. Boss-roster remix rules

New pure function in NEW `src/content/cycles.js`: `remixRoster(cycle, { mapId, unlockedMapIds, foughtThisRun, prevRoster }, rng = Math.random)` → `[tier1Id, tier2Id, tier3Id]`.

- **Pools by tier**: all 12 bosses exist today in GameConfig ENEMY (:379-663) each with a `tier` 1/2/3 field (e.g. :388, :430, :475) matching BOSS_TIERS (:671-675); per-map trios live in maps.js (:39/:59/:79/:99). Pool k = every unlocked map's tier-k boss. Lock-respect: only maps passing `isMapUnlocked` contribute (no spoiler-spawning Solnakh at a player who never opened the Dunes); if only one map is unlocked, remix degenerates to the home trio (correct behavior for a brand-new save that somehow rekindles).
- **Slot pattern is sacred**: every cycle runs SKIRMISHER → WARLORD → APEX, preserving the tier-ladder escalation and the banner/pip reads.
- **No immediate repeats**: exclude `prevRoster` ids; prefer least-recently-fought this run (sort by last-fought cycle, rng tiebreak). With 4 maps unlocked each pool has 4 candidates, so cycles II-V never repeat a slot boss back-to-back and a 5-cycle run sees ~10 distinct bosses.
- **rng is injectable** but defaults to Math.random — #17 (Sealed Storm) later threads its mulberry32 through this parameter; the signature is designed for it now so #17 touches one call site.
- **Encounter-tier correction (required)**: `_spawnBoss` sets `tierMul = 1 + encounter*0.8` with `encounter = this.bossesDefeated` (Game.js:2005-2009). Left alone, cycle III's first boss would carry ×5.8 encounter HP ON TOP of cycleScale — double-dipping into unkillable. Change to `encounter = this.bossesDefeated % 3`: the 1×/1.8×/2.6× per-cycle ladder restarts each cycle, and inter-cycle growth is carried solely by cycleScale.hp (single, tunable source of truth). Same treatment for the dmg/speed encounter riders at Game.js:2023/2026.

## 4. Twilight elites — one per cycle

Five authored cycle-exclusive minibosses named for the existing TWILIGHT endgame phase (ENDLESS_SCALING.twilight*, GameConfig.js:1095-1112) — the fiction: past the first Rekindle, the twilight horde sends its captains.

| Cycle | Name | Canonical body | Borrowed move (lieutenant vocabulary) |
|---|---|---|---|
| II | **Duskgel** | slime | `lingering` umbral pools ×3 (r 110, tick 8/s, 3.0s) |
| III | **Vespershade** | bat | `aimed` 3-bolt gloam volley (speed 520, dmg 18) |
| IV | **Nightcoil** | snake | `wall` 10 bolts, gap 2, speed 380, dmg 18 |
| V | **The Unblinking** | eyeball | `seekers` ×3 (speed 380, dmg 22, turn 3.2) |
| VI+ | **Hollowhive** | bee | `zones` ×4 dusk zones (r 130, dmg 22, warn 0.85) |

- **Stats** (tunable): hp 8× base type (between elite 4× GameConfig.js:790 and lieutenant 10× :806), dmgMul 1.5, speedMul 1.05, radiusMul 1.35, xp 8×, guaranteed drop 2 Ingots + 20% chest.
- **Behavior reuse**: they ride `runLieutenantAI` (Enemy.js) exactly like LIEUTENANT.attacks (GameConfig.js:816-838) — timer → gold/violet windup arc → commit through the boss vocabulary pipeline. Zero new AI code; one attacks-table entry each.
- **Spawn rule**: while `cycle ≥ 2`, each elite promotion roll (Spawner.js:58 `Math.random() < waveState.eliteChance`) has a 12% sub-chance (tunable) to upgrade into the CURRENT cycle's twilight elite; hard limits: max 2 alive, ≥45s spacing (Game-side gate). They count inside maxAlive — no cap impact. Cycles VII+ draw from the whole pool.
- **Art**: procedural first — the 5 canonical PR #103 sheets recolored umbral (violet/indigo, src/render/recolor.js) + the elite affix glow, shipping in PR2. Optional later: Nano Banana 2×2 img2img per creature using the approved grid job ids as style refs, palette-locked to dusk tones (NO fire/orange — canonical identity rules hold). Never blocking.

## 5. Everforge — prestige currency: EVERFORGE INGOTS

Second currency, fully separate from coins (COIN economy untouched, GameConfig.js:762-769). Earned ONLY in cycles ≥ II:

- Boss kill in cycle N: `tier × (N−1)` Ingots (cycle II: 1/2/3; cycle III: 2/4/6; …).
- Twilight elite kill: 2 (+1 with Mantle of Nightfall).
- Cycle completion (its 3rd boss): `5 × (N−1)` bonus.
- First time EVER reaching cycle N on a map: +10 pioneer bonus (per map+cycle, latched in save).

Expected income (tunable targets): finishing cycle II ≈ 25 Ingots; through cycle III ≈ 60; a strong cycle-IV run ≈ 100. Banking mirrors `_bankRunCoins`'s latch discipline (Game.js:1246-1254): Ingots bank at each cycle completion AND once at death for the partial cycle — a refresh mid-cycle loses only the unbanked partial, never dupes. HUD: a small `◆ n` Ingot chip appears beside coins only when cycle ≥ 2 (UISystem).

Pressure valve so Ingots never dead-end: **Smelt** — repeatable 15 Ingots → 400 coins.

### The Mythic Armory — 6 mythic wands
Material variants of the Blender PR2 wand-armory models — NOT new weapons: each is a forgeable STARTING-WEAPON variant of one base wand (base ids at src/content/weapons.js:53-291), applied as (a) a weaponSkins override (WEAPON_SKINS keyed by base id, weaponSkins.js:22, fallback :100) and (b) one ks_-style player rider flag set in `_startRun` beside `resolveWeaponSkin` (Game.js:768-770). All riders ride frame-clamped fields (CAPS damage/cooldown via `_applyPlayerCaps`) or +1 bounded counts — trivially inside the ~220 projectile budget.

| # | Mythic (material) | Base wand | Rider | Cost | Gate |
|---|---|---|---|---|---|
| 1 | Arcanebrand, the First Wick (emberglass) | arcaneBolt | bolts pierce +1, +5% dmg | 60 | reach Cycle II |
| 2 | Orbital of the Anvil (starmetal) | orbitingBlade | +1 blade, +8% orbit radius | 70 | Cycle II |
| 3 | Dawnforged Pulse (sunbleached gold) | holyPulse | heal 1 HP per 8 struck (rides CAPS.healPerSecond 14, GameConfig.js:108) | 80 | Cycle III |
| 4 | Stormbrand Sigil (fulgurite) | lightningMark | +1 chain, 10% double-strike | 90 | Cycle III |
| 5 | Kindleray Prime (obsidian core) | kindleRay | +15% beam width, boss hits refund 6% cooldown | 110 | Cycle IV |
| 6 | Wakefire Eternal (slagsteel) | wakefire | trail +30% duration, +10% dmg | 140 | Cycle V |

Costs deliberately FLAT (not the 1.55^level attune curve, relics.js:199-203, nor the ×2.2 skill scale, permanentUpgrades.js:126-141) — mythics are trophies with a cycle-gate, not an infinite sink; Smelt + the Reliquary are the sinks.

### The Reliquary — 6 legendary relics
Unlocked with Ingots on the Everforge shelf; once unlocked they JOIN THE RUN'S SHRINE DRAFTS as legendary-rarity relics — one filter line in the roller (`RELICS.filter` at src/systems/WickRoadsSystem.js:139: additionally drop reliquary-flagged relics absent from `save.everforge.reliquary`). They append to RELICS (relics.js:15-164, append-only) as declarative `apply(p)` hooks; the behavior-bearing ones use the ks_ flag pattern from keystones.js (:66/:93/:117 — flags consumed in Player.js:224 / weapons.js:1140-1151). Exact effects:

1. **Crown of the Rekindled** (40◆, gate C-II): each Rekindle this run grants +12% damage, +40 max HP (healed), −8% cooldowns. `p.rl_crown = true`; `_rekindle()` applies the stack — damage/cooldown are frame-clamped by CAPS so it can never break the ceiling, only reach it sooner.
2. **Phylactery of Emberglass** (60◆, C-II): once per cycle, fatal damage leaves you at 1 HP + 2.5s invulnerability ("the wick refuses"). `p.rl_phylactery` consumed in `Player.takeDamage` beside the ks_aegis read (Player.js:224); re-armed by `_rekindle()`.
3. **Mantle of Nightfall** (50◆, C-II): elites + twilight elites deal 25% less damage to you; twilight elites drop +1 Ingot. Flag read in the CollisionSystem contact path on `e.elite`/`e.twilight`.
4. **The Anvil's Memory** (70◆, C-III): +25% damage to bosses (`p.bossDamageMul`, one multiply where damage lands on `e.boss`); boss chests always contain a weapon upgrade (ChestRewards weight override).
5. **Hourglass of the Long Vigil** (80◆, C-III): Composure recovers 60% faster, hits drain 25% less (`p.composureRecoverMul/HitMul` read where COMPOSURE ticks — GameConfig.js:1161-1168 fields). Skill-scaling relief exactly where cycles hurt most.
6. **Sigil of the Sixth Cycle** (90◆, C-IV): XP gems +30% value and +50% pull range (pickupRange stays CAPS-clamped at 900); in cycles II+ each level-up grants +2 max HP.

### Menu surface
New `{ id: 'everforge', label: 'EVERFORGE', accent: '#ff7a3c' }` in MENU_TABS (MenuRenderer.js:56-66); `tabUnlocked` case (:73-97): `(save?.cycles?.totalRekindles ?? 0) > 0 || (save?.everforge?.ingotsEarned ?? 0) > 0` — invisible until the endgame is touched, wearing the standard one-time NEW badge. Two shelves: MYTHIC ARMORY (6 cards: forge / equip-as-starting-wand, wired to the Loadout starting-weapon path) and RELIQUARY (6 plinths: unlock → "joins your shrine drafts"). Game-over + victory cards get a `CYCLE N` stamp (runSummary.cycle) — the #2 compositor picks it up for free when it renders summaries.

## 6. The re-ignited world (cheap, mobile-safe)

Per-cycle visual read without new art: MapRenderer layers ONE extra translucent grade rect (the maps.js `grade` pattern, maps.js:32-33) — cycle II `#3a2444` @ 0.08 alpha, +0.03/cycle, capped 0.20 — the world visibly dusks as cycles deepen. Plus the Rekindle flash/banner/rings from §1.7. Total per-frame cost: one fillRect.

## 7. Failure modes designed against from PR1

- **Balance runaway (player side)**: cycle XP bonus capped ≤2.0 and CAPS already plateau the player; conservative table ships first, tunables in one config block.
- **Perf at cycle V** (0.85 elite ceiling + twilight attacks + remixed apexes): every spawn path already routes through the maxAlive 220 hard clamp (Game.js:1894) and the boss-summon cap gate; twilight elites max 2 alive; #4's projectile pooling is the prerequisite. PR2 carries a headless cap-probe.
- **Save dupe/corruption**: additive keys only, validated with the existing default+clamp pattern (SaveSystem.js:135-153, implicit migration per :198-200); Ingot banking is latched per cycle segment like `bankedThisRun`.
- **Mobile UX**: 4-button overlay keeps ≥96px targets; all hit-testing rides the existing tryVictoryAt touch path (Game.js:490).

## PR plan

### PR1 — PR1 — Rekindle core: cycles, multipliers, the deferred wall

**Goal:** A playable Cycle loop: REKINDLE button at 3rd-boss victory, cycleScale layer, remixed-roster stub (home trio reshuffle), hypergrowth deferral, cycle save stats, HUD chip and CYCLE banner.

**Files:**
- `src/config/GameConfig.js (CYCLES block)`
- `src/content/cycles.js (NEW — multiplier table, roman(), remixRoster v1)`
- `src/core/Game.js (cycle state, _rekindle(), 4-button victory overlay, _applyRunScale cycle factor, _spawnBoss encounter%3 fix, finality check 3*cycle)`
- `src/systems/WaveDirector.js (hyperDeferMinutes field read at getState)`
- `src/systems/SaveSystem.js (cycles{} key, bestCycle stat, recordCycle)`
- `src/systems/UISystem.js (cycle chip)`
- `tools/artshot/harness.html (dev-only ?cycle=N fast-path)`

**Work:**
- Add CYCLES config (table §2, firstBossGrace 90, hyperDeferPerCycle 12, hyperDeferMax 48)
- Implement _rekindle(): board flush, half-missing-HP heal, BossDirector rebuild + grace, cycleScale set, wall deferral, _hyperAnnounced/_victoryShown reset, banner+flash+rings setpiece, recordCycle
- 4th victory button + KeyR + rects re-layout (top H/2-96, gap 20)
- Fold cycleScale into _applyRunScale beside runScale/segmentScale (existing 0.85 elite / 220 cap clamps hold)
- Change _spawnBoss encounter to bossesDefeated % 3
- Gauntlet score +1500*(cycle-1); runSummary.cycle + game-over CYCLE stamp

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- harness.html?badge=1 shows EXC:0
- harness dev cycle fast-path: screenshot shows CYCLE II banner + 4-button overlay, EXC:0
- console save round-trip: pre-update save JSON loads, cycles{} defaults injected, no key lost

### PR2 — PR2 — The remix and the twilight elites

**Goal:** Full cross-map roster remix (tier pools, no-repeat, unlock-respect, injectable rng) plus the five cycle-exclusive twilight elites with borrowed boss-vocabulary attacks and procedural umbral art.

**Files:**
- `src/content/cycles.js (remixRoster v2 + TWILIGHT_ELITES defs)`
- `src/config/GameConfig.js (5 twilight ENEMY entries + TWILIGHT_ELITE tuning block)`
- `src/systems/Spawner.js (12% promotion sub-roll at the elite roll, Spawner.js:58)`
- `src/entities/Enemy.js (twilight flag, lieutenant-AI reuse for their attack tables)`
- `src/core/Game.js (max-2-alive + 45s spacing gate, 2-Ingot/chest drops, kill callout)`
- `src/assets/EnemySprites.js + src/render/recolor.js use (umbral recolor of the 5 canonical sheets)`

**Work:**
- remixRoster: per-tier pools from unlocked maps, exclude prevRoster, least-recently-fought preference, rng param defaulting Math.random
- Author Duskgel/Vespershade/Nightcoil/The Unblinking/Hollowhive (stats §4, one borrowed move each via the LIEUTENANT.attacks pattern)
- Promotion roll gated on cycle>=2 and current-cycle id; counts inside maxAlive
- Procedural umbral tint fallback ships here; canonical identities preserved

**Verify:**
- node --check + validate-assets exit 0
- harness badge EXC:0
- dev showcase screenshot of all 5 twilight elites (harness showcase param)
- cap probe: dev-spawn 180 enemies + 2 twilight elites attacking, frame time recorded, no cap breach
- remix unit sanity: node script asserts 200 remixes never repeat a slot id back-to-back and never emit a locked map's boss

### PR3 — PR3 — Everforge: Ingots + the Mythic Armory

**Goal:** The prestige economy end-to-end: Ingot earn/bank/spend, the EVERFORGE menu tab, six forgeable mythic wands as loadout starting-weapon variants with skin overrides and ks_-style riders.

**Files:**
- `src/content/everforge.js (NEW — mythic defs, costs, cycle gates, Smelt)`
- `src/systems/SaveSystem.js (everforge{} key + addIngots/spendIngots/unlockMythic/selectMythic accessors)`
- `src/core/Game.js (earn hooks at boss/twilight kill + cycle completion, latched death bank, runSummary.ingots, rider application in _startRun)`
- `src/systems/MenuRenderer.js (EVERFORGE tab + Mythic Armory shelf + tabUnlocked case)`
- `src/content/weaponSkins.js (6 mythic material skin variants)`
- `src/content/weapons.js + src/entities/Player.js (rider reads: pierce+1, +1 blade, heal-per-struck, +1 chain, beam width/refund, trail duration)`
- `src/systems/UISystem.js (Ingot chip finalized)`

**Work:**
- Earn table §5 incl. pioneer bonus; banking latch mirrors _bankRunCoins
- Forge flow: cost check, cycle-gate check, persist, equip toggle wired into resolveStartingWeapon path
- All riders ride CAPS-clamped or +1-bounded fields; Dawnforged healing counts against CAPS.healPerSecond
- Smelt repeatable sink (15 Ingots -> 400 coins)

**Verify:**
- node --check + validate-assets exit 0
- harness badge EXC:0
- menu screenshot: harness screen=menu&tab=everforge shows Armory with gates/costs
- run screenshot with Arcanebrand equipped: pierce visibly +1, mythic skin renders
- economy dry-run script: simulated cycle II-IV run lands 25/60/100 Ingot targets +-20%

### PR4 — PR4 — The Reliquary

**Goal:** Six legendary relics purchasable with Ingots that then enter live shrine drafts, including the two flag-pattern behaviors (Phylactery cheat-death, Crown per-Rekindle stack).

**Files:**
- `src/content/relics.js (6 legendary entries appended, reliquary:true flag)`
- `src/systems/WickRoadsSystem.js (roller filter: reliquary relics require save unlock, at the RELICS.filter line)`
- `src/systems/SaveSystem.js (everforge.reliquary list + unlock accessor)`
- `src/systems/MenuRenderer.js (Reliquary shelf on the Everforge tab)`
- `src/entities/Player.js (rl_phylactery consume in takeDamage beside ks_aegis)`
- `src/core/Game.js (Crown stack in _rekindle, phylactery re-arm, bossDamageMul apply, composure muls, Sigil level-up hook)`
- `src/systems/CollisionSystem.js (Mantle elite-damage cut)`
- `src/systems/ChestRewards.js (Anvil's Memory boss-chest bias)`

**Work:**
- Exact effects per §5 Reliquary table; every touched field frame-clamped or bounded
- Locked reliquary relics never appear in drafts; unlocked ones draft at existing legendary weight
- Discovery feeds discoveredRelics so the ATTUNE tab/codex stays coherent

**Verify:**
- node --check + validate-assets exit 0
- harness badge EXC:0
- dev-forced altar screenshot showing a Reliquary legendary card
- phylactery test: dev-set hp=1, take fatal hit, survive at 1 HP with invuln ring, second fatal hit same cycle kills
- draft-pool assertion script: locked reliquary ids absent from 500 rolled drafts

### PR5 — PR5 — The re-ignited world: setpiece polish, art hookup, balance pass

**Goal:** Ship the per-cycle dusk grade, rekindle audio, any landed Blender/AI art (mythic wand sheets, twilight 2x2 grids), and a balance retune from real deep-run data.

**Files:**
- `src/systems/MapRenderer.js (per-cycle grade overlay, one fillRect)`
- `src/systems/AudioSystem.js (rekindle fanfare variant + cycle sting)`
- `src/assets/* (mythic wand material sheets via tools/blender re-render; twilight AI sheets IF generated — procedural stands otherwise)`
- `src/content/cycles.js + src/config/GameConfig.js (table retune)`
- `ASSET_CREDITS.md (any AI art rows)`

**Work:**
- Cycle grade #3a2444 @0.08 +0.03/cycle cap 0.20
- Blender pipeline material presets (emberglass/starmetal/sungold/fulgurite/obsidian/slagsteel) re-render of the PR2 wand models
- Deep-run balance: 3 scripted dev runs to cycle IV, adjust HP/dmg columns +-15% as needed

**Verify:**
- node --check + validate-assets exit 0 (new art credited)
- harness badge EXC:0 at cycle III via dev fast-path (grade visible, perf clean)
- before/after screenshots cycle I vs III
- full manual loop: victory -> rekindle -> cycle II boss -> Ingots banked -> menu Everforge shows balance

## Data & save changes

NEW content/data files: src/content/cycles.js (cycle multiplier table, remixRoster, TWILIGHT_ELITES, roman numerals) and src/content/everforge.js (mythic wand defs + costs + gates, Reliquary price list, Smelt). Extended data files (append-only): GameConfig.js gains a CYCLES block + 5 twilight ENEMY entries; relics.js gains 6 legendary entries flagged reliquary:true; weaponSkins.js gains 6 mythic material variants keyed off base wand ids (arcaneBolt/orbitingBlade/holyPulse/lightningMark/kindleRay/wakefire, weapons.js:53-291).

Save schema (ADDITIVE only, validated via the existing defaultData+_validate clamp pattern SaveSystem.js:16-153; implicit migration per :198-200 — old saves load with defaults, no version bump required beyond the existing written-never-read version:7):
- `cycles: { best: 0, bestPerMap: {}, totalRekindles: 0, pioneer: {} }` (numbers floored >=0; bestPerMap/pioneer validated as mapId->int maps)
- `everforge: { ingots: 0, ingotsEarned: 0, mythics: [], selectedMythic: null, reliquary: [] }` (id lists via validateIdList SaveSystem.js:135-141)
- `stats.bestCycle: 0` (auto-validated by the numeric stats loop, per the SaveSystem.js:47 precedent)
- runSummary additions (transient, not persisted schema): cycle, ingotsEarned.

Config blocks: `CYCLES = { table (5 rows + V+ growth), firstBossGrace: 90, healMissingFrac: 0.5, twilightPromoteChance: 0.12, twilightMaxAlive: 2, twilightSpacingSec: 45, hyperDeferPerCycle: 12, hyperDeferMax: 48, gauntletCycleBonus: 1500 }` — all tunable in one place, honoring the GameConfig.js:1-4 charter. Extended systems (no new modules beyond the two content files): Game.js, WaveDirector.js (+1 public field), Spawner.js (+1 roll), SaveSystem.js, MenuRenderer.js (+1 tab), UISystem.js (+1 chip), WickRoadsSystem.js (+1 filter), MapRenderer.js (+1 grade), Player.js/CollisionSystem.js/ChestRewards.js (relic flag reads). BossDirector.js needs ZERO changes — its constructor already accepts an arbitrary ordered roster (BossDirector.js:19-27).

## Balance numbers (all tunable)

All values are STARTING points (tunable), one CYCLES config block:

| Number | Value | Rationale |
|---|---|---|
| Cycle II hp/dmg/speed/elite | 1.35 / 1.20 / 1.05 / 1.25 | Noticeable step over a fresh Vigil run but below Nightmare's 1.55/1.40 (GameConfig.js:1177) — the build carried over more than compensates |
| Cycle V hp/dmg | 3.10 / 2.10 | Player damage plateaus at CAPS.damageMul 3.5 (GameConfig.js:103); cycle V trash HP ~3.1x on top of endless 7.0x health cap makes V the skill wall |
| V+ compounding | HP x1.30, dmg x1.20 /cycle | Guarantees the run ends; mirrors hypergrowth's spirit at cycle granularity |
| Cycle speed cap | 1.10 absolute, never compounds | WAVE_LIMITS.maxSpeedMultiplier 2.3 was tuned so the fastest trash (759) stays under CAPS.moveSpeed 760 (GameConfig.js:1135-1142); _applyRunScale does NOT re-clamp speed (Game.js:1889) so the cycle layer must self-cap |
| hyperDeferPerCycle / max | 12 min / 48 min | A cycle takes ~10-12 min (90s grace + 2x160s interval + fights) — clear on pace and the wall stays ~one cycle behind; cycle VI+ gets no more room |
| firstBossGrace | 90 s | Build is online post-victory; 160s (BOSS.spawnInterval) would be dead air |
| Rekindle heal | 50% of missing HP | Mercy without a full reset; Phylactery/Crown are the real sustain answers |
| Encounter tierMul | bossesDefeated % 3 | Prevents the existing 1+0.8xN cumulative ladder (Game.js:2009) from double-dipping with cycleScale |
| Twilight elite | 8x HP, 1.5x dmg, 1.05x speed, 8x XP; 12% of elite rolls; max 2 alive; 45s spacing | Sits between elite 4x (:790) and lieutenant 10x (:806); rare enough to be an event |
| Ingots: boss / twilight / cycle-complete / pioneer | tier x (N-1) / 2 / 5 x (N-1) / +10 | Cycle II ~25, through III ~60, strong IV ~100 — cheapest mythic (60) = one strong run or 2-3 casual ones |
| Mythic costs | 60/70/80/90/110/140, gates C-II..C-V | Flat trophy pricing, deliberately NOT the 1.55^L attune curve (relics.js:199-203) |
| Reliquary costs | 40/50/60/70/80/90, gates C-II..C-IV | First legendary within one good cycle-II session — early taste of the loop |
| Smelt | 15 Ingots -> 400 coins | Floor value so Ingots never dead-end post-completion |
| Cycle XP / coin muls | 1.15->1.60 (XP cap 2.0) / 1.25->2.15 | Keeps level-ups flowing without overlay spam; coin scaling respects the deliberately grindy coin economy (GameConfig.js:760-762) |
| Gauntlet cycle bonus | +1500 x (cycle-1) | Keeps bestGauntletScore ladder meaningful vs the existing time+2.5k+500b formula (Game.js:2503) |
| Cycle dusk grade | +0.03 alpha/cycle, cap 0.20 | Readability floor — the veil already darkens maps up to 1.0 (maps.js:74) |

## Art needs (non-blocking)

- Blender pipeline (tools/blender/): re-render the PR2 wand-armory models with 6 material presets (emberglass, starmetal, sun-gold, fulgurite, obsidian-core, slagsteel) into pixelated sheets for the Mythic Armory cards + in-run weapon props. NON-BLOCKING: PR3 ships procedural fallback via weaponSkins recolor variants.
- Twilight elites: procedural umbral recolor of the 5 canonical creature sheets (src/render/recolor.js + elite glow) ships in PR2. Optional higgsfield/Nano-Banana upgrade in a separate session: one 2x2 pose grid per creature, img2img with the canonical sheet as reference media and the approved grid job ids as style refs, palette-locked to violet/indigo dusk tones ('keep exact silhouette, NO fire, NO orange') — identities stay the classic creatures per CLAUDE.md.
- Everforge tab dressing (anvil shelf, ingot icon, relic plinths): procedural CustomIcons.js first; optional AI prop art later, credited in ASSET_CREDITS.md.
- Cycle re-ignition setpiece: pure canvas (banner, flash, rings, grade) — zero art dependency.

## Risks

- Balance double-dip making cycles unwinnable: the existing per-encounter boss ladder (tierMul = 1 + bossesDefeated*0.8, Game.js:2009) compounding WITH cycleScale would put cycle-III bosses at ~5.8x encounter x 1.8x cycle x 7x time HP. Mitigated in PR1 by design: encounter becomes bossesDefeated % 3 so inter-cycle growth has exactly one source (the tunable table).
- Perf collapse at deep cycles (0.85 elite ceiling + twilight elite attack patterns + remixed apex kits on mobile): every spawn path stays behind the maxAlive min(220,...) hard clamp (Game.js:1894), twilight elites capped at 2 alive/45s spacing and reuse the pooled lieutenant/boss projectile pipeline from dep #4; PR2 carries an explicit 180-enemy+twilight headless cap probe. Cycle visuals add one fillRect.
- Save-economy exploits/corruption: Ingot banking latched per cycle segment (mirroring bankedThisRun, Game.js:1246-1254) so refresh-mid-cycle can't dupe; recordCycle fires on REACHING a cycle (crash-safe ladder); all new keys additive with clamp validation so a pre-16 save or a tampered everforge{} loads to sane defaults.
- Mobile/touch UX regression on the victory overlay: 4 buttons re-laid to keep >=96px targets and routed through the existing tryVictoryAt touch path (Game.js:404-411, 490); verified via harness touch-rect screenshot in PR1.

## Uniqueness & boundaries

NIGHTFALL CYCLES is the only roadmap update that answers "what happens AFTER you win" — run-continuation progression (NG+ cycles, the remix, the deferred wall) and the prestige layer (Ingots, mythic wands, Reliquary) exist nowhere else in the 20. Sharpest boundaries: #15 ASHBOUND (nearest neighbor) owns PRE-run difficulty — Torments, Ash Ranks, seasons; #16 adds zero pre-run knobs and its cycleScale composes beside (never replaces) Ashbound's _applyRunScale scalars. #4 BOSSFORGE owns boss kits, telegraphs and the perf substrate — #16 only re-ORDERS rosters via the existing BossDirector types array and never edits an attack table. #17 SEALED STORM owns determinism — remixRoster ships on Math.random with an injectable rng param so #17's seeded RNG threads through one call site; #16 makes no shareable-code or fairness claims. #14 owns records/export — #16 adds only bestCycle + summary stamps that #14's archive and #2's compositor consume for free. #20 HEARTHHOLD consumes (never defines) the Cycle banners as camp decor. Deliberately NOT done here: no new boss fights, no seeded runs, no seasonal resets, no pre-run modifiers — the neighbors own those.

## Roadmap corrections found while grounding

- Roadmap entry-point list says 'src/content/relics.js flag-pattern (ks_-style)' — the ks_ flag pattern does NOT live in relics.js. It lives in src/content/keystones.js (lines 66, 93, 117 set g.player.ks_conflagration/ks_overcharge/ks_aegis), consumed at src/entities/Player.js:224 and src/content/weapons.js:1140-1151. relics.js uses a different (flagless) declarative apply(p) stat-nudge pattern (relics.js:1-13). The spec uses both correctly: Reliquary stat relics follow the relics.js apply pattern; behavior relics (Phylactery, Crown, Mantle) set ks_-style rl_* player flags.
- All other claimed seams verified as stated: _showVictory + 3rd-boss latch (Game.js:1150, 3054-3078), BossDirector roster construction from an ordered types array (BossDirector.js:19-27, built at Game.js:621 from getMapBosses), CAPS (GameConfig.js:102-109), hyperStartMinutes: 20 (GameConfig.js:1130, consumed WaveDirector.js:196-233 on absolute run time), permanentUpgrades cost curve (nextCost with COST_DEPTH_STEEPEN 0.22 x COST_SCALE 2.2, permanentUpgrades.js:126-141).
- Integration hazard not stated in the roadmap but load-bearing for this update: _spawnBoss's cumulative encounter multiplier (encounter = this.bossesDefeated, tierMul = 1 + encounter*0.8, Game.js:2005-2009) currently makes gauntlet bosses scale forever; cycles must switch it to bossesDefeated % 3 or cycle bosses double-dip with cycleScale. Likewise _applyRunScale does not re-clamp speedMul (Game.js:1889 — WAVE_LIMITS clamps happen upstream in WaveDirector), so the cycle speed factor must self-cap at 1.10 to preserve the outrunnability invariant (speedDemon 330 x 2.3 = 759 < CAPS.moveSpeed 760).

## Binding cross-spec rulings affecting this update

- **[#12 CINDERS & SCRIPTURE vs #6 UNDERTOW, #8 GLOAMCALL, #11 FORGEHEART, #16 NIGHTFALL CYCLES]** #12's fixed counts are stale against its ship position: BESTIARY_ROSTER has 21 entries but #6 ships 4 drowned creatures six updates earlier (roster should be 24+); "26 relics" equals TODAY'S relics.js count, ignoring #8's umbral relics that ship before it; the boss pages ignore #11's three bosses and #6's Tidewarden; and #16 later adds 6 reliquary relics and 5 twilight elites that would strand the Archive's 100% Curator's Lantern.
  **RULING:** #12 owns the codex but must author it against the post-#11 world AND make it append-safe: BESTIARY_ROSTER includes the drowned family and twilight-elite slots come free via registry-driven pages; the Relics page and shelfProgress() compute denominators from the live relics.js roster, never a literal; boss coverage = The Twelve page (fixed) + roster-driven entries for Forgeheart bosses and the Tidewarden. Archive completion rewards CHECKPOINT at claim time — once claimed they are never revoked or re-locked when #16 (or any later update) grows a roster. #16's spec adds one line: its reliquary relics and twilight elites surface in the codex as data appends only, no codex UI changes.

- **[#16 NIGHTFALL CYCLES vs #11 FORGEHEART]** #16 says the cycle remix spans "all four biomes," but #11 ships biome 5 (Forgeheart, MAP_ORDER 5th entry) five updates earlier — #16's remix roster, twilight-elite placement, and multiplier tuning are authored against a stale world.
  **RULING:** #16 is authored against the post-#11 world: remixRoster and cycle content derive from MAP_ORDER (five biomes) and the live 15-boss campaign registry (Tidewarden excluded as mode-only, per the boss-taxonomy ruling). Every "four biomes" reference in #16's spec is corrected to "all campaign biomes (MAP_ORDER-driven)."
