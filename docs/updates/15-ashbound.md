# Update #15: ASHBOUND — The Ash Ranks

*Era IV — The Long Vigil*

**Value verdict (IMPROVES):** Closest call of the sixteen: the game ALREADY has arm-difficulty-toggles-and-clear-3-bosses with a per-character mastery record (Pacts/Trials, SaveSystem.js:116/654), so the core activity is an upgrade of an existing surface, not new capability. What saves it from WEAK: per-map Cinder ranks with once-ever payouts change the incentive structure, the four rank-exclusive heavy Torments are genuinely new mechanics (Torments must NOT be mere sliders on existing scalars or this collapses into a Trials re-skin), and Everburn seasons add a serverless metagame nothing else provides. Required fix regardless of verdict: explicitly reconcile or absorb Pact Mastery so the game doesn't ship two parallel difficulty ladders.

## What it adds

A per-map, Hades-Heat-style prescriptive difficulty ladder: the player arms named "Torments" (each with levels costing Cinders), the Cinder total IS the Ash Rank, and clearing a map's three bosses at a new rank pays a one-time bounty plus scaling coin/Pass-XP bonuses — turning the post-campaign game into an endlessly climbable, per-map mastery ladder. Everburn seasons wrap it with 42-day seasonal ladder resets, deterministic weekly edicts that reshape the ladder's economy, and seasonal seal rewards — all serverless via the proven day-number PRNG pattern. The game-over card gets stamped with your Ash Rank wax seal: blazing on a clear, cracked on a death.

## Design spec

# ASHBOUND — The Ash Ranks: Implementation Spec

## 0. Verified code foundation (every claim checked 2026-07-05)

- **`_applyRunScale` clamps hold by construction** — `src/core/Game.js:1880-1920`: the per-frame fold multiplies `runScale` (hp/speed/damage/elite/cap/interval) into a fresh `waveState` literal, with `eliteChance = Math.min(0.85, …)` at `Game.js:1891` and `maxAlive = Math.min(220, …)` at `Game.js:1894`. Torments ride this layer, so no Torment stack can ever exceed the 220 alive / 0.85 elite ceilings. The roadmap synopsis claim is TRUE.
- **The Trials fold loop** — `Game.js:784-801`: `RUN_MODIFIERS` scalars (`hp/speed/damage/elite/cap/interval` wave-side; `playerDamage/playerPickup/playerIncoming` player-side; `xpBonus/coinBonus` reward-side) are summed into `this.runScale` + `this.runBonus`, then player-side mods apply at `Game.js:816-818`. Torments reuse this exact loop with the same keys.
- **Boss HP fold** — `Game.js:2022`: `bossHpMul = BOSS.baseHpMul * min(1+minutes*hpPerMinute, maxHpMul) * tierMul * (runScale?.hp ?? 1) * mapHpMul`. One new factor (`runScale.bossHp ?? 1`) slots here for the boss-only Torment.
- **Difficulty tiers** — `src/config/GameConfig.js:1174-1179` (`easy/normal/hard`, Nightmare = hp 1.55 / dmg 1.40 / elite 1.6 / +50% Pass XP); Trials pool at `GameConfig.js:1187-1197`; bonus cap `RUN_MODIFIER_MAX_BONUS = 2.5` at `:1202`; `pactTier()` labels at `:1206-1209`.
- **Clear/victory seam** — `Game.js:1150-1160` (`_showVictory`, fires on 3rd-boss kill) already calls `_checkPactMastery()` (`Game.js:1166-1177`), which is the exact "record ladder clear + pay per-notch bounty" shape we clone (`SaveSystem.recordPactClear`, `SaveSystem.js:657-666`, returns NEW steps gained so bounties can't be farmed).
- **Game-over payout hooks** — `Game.js:2474-2550`: `_bankRunCoins()` at `:2491`, `runBonus.coin` top-up at `:2493-2495`, `runSummary` build at `:2507-2522`, `awardBattlePassRun` at `:2542` with the `runBonus.xp` bonus at `:2544-2547` (cap = `RUN_MODIFIER_MAX_BONUS + diff.xpBonus`, set at `Game.js:811-814`). Victory-leave mirrors it at `Game.js:1192-1237` with the `_runRecorded` latch.
- **Day-number PRNG pattern** — `src/content/dailyChallenges.js:29-32` (`currentDayNumber` = UTC day index) and `dailyChallenges.js:34-42` / `dailyRoad.js:16-24` (local `mulberry32`), with **distinct salts per system** (`0x9e3779b9` vs `0x5eed1234`, see `dailyRoad.js:28-30`). Everburn copies this with its own salts.
- **Save clamp+validate pattern** — `SaveSystem.js:192-361`: implicit migration (missing keys → defaults), per-field clamping. The closest ladder precedent is `pactMastery` (`SaveSystem.js:118`, validated at `:331-340`, accessors `:648-666`) — per-CHARACTER, not per-map (see codeCorrections). Day-keyed reset precedent: `dailyRoad` (`SaveSystem.js:106`, `:689-719`).
- **Menu seam** — `src/systems/MenuRenderer.js:1053-1103`: PLAY tab right column draws difficulty chips (`:1053-1065`) then the Trials 3-column chip grid with the `PACT` tier label (`:1067-1103`). The Ashbound entry chip goes directly below this block.
- **Game-over overlay seam** — `src/systems/UISystem.js:1843-1940`: reads `state.runSummary`, draws the NEW BEST ribbon (`:1865-1878`) and `state.bpResult` (`:1937-1939`). The Ash seal stamp renders in this block.
- **Daily Road exclusivity** — `Game.js:743-750` + `:782`: `dailyMode` overrides map/Trials and forces `normal`. Ashbound is disabled in `dailyMode` by the same guard.
- **Emberglass compositor (dep #2)**: `grep compositor|Emberglass|shareCard` finds NOTHING in `src/` today — update 2 has not shipped. All card work in this spec is written against a guarded `game.cardCompositor?` call with a text-banner fallback, so ASHBOUND never hard-depends on the compositor's final API.

## 1. The Ash Rank ladder

**Concept.** Each map has its own Ash Rank ladder. In the new ASHBOUND panel the player arms **Torments**; each Torment has 1-3 levels, each level costs **Cinders**; the armed Cinder total IS the run's **Ash Rank** (displayed as Roman numerals, I-XXXVI theoretical max). Beating the map's 3rd boss (`_showVictory`, `Game.js:1150`) with Torments armed records the clear.

**Rules (all tunable):**
- **Unlock**: the ASHBOUND chip appears for map M once M has been cleared at least once (new per-map clears tally, recorded in the `_showVictory`/`victoryToMenu` path — no per-map clear record exists today, so ASHBOUND adds one: `ashbound.clears[mapId]`).
- **Nightmare-only**: arming any Torment forces `difficulty='hard'` for that run (LOCAL, like Daily Road's forced-normal at `Game.js:782` — never persisted via `setDifficulty`). The seal only burns in Nightmare; this keeps rank IX meaning the same thing on every save.
- **Mutually exclusive with Trials and Daily Road**: arming Ashbound clears `selectedModifiers` for the run (so Torments can't double-stack with free Trials past the design envelope), and `dailyMode` disarms Ashbound. `_checkPactMastery` (`Game.js:1166`) naturally no-ops (empty `activeModifiers` → tier 0), so the two ladders never cross-pay.
- **Arm cap (anti-blind-jump, anti-overreach)**: max armable Cinders = `bestCleared[mapId] + 4` (tunable). You climb in steps of at most +4 above your proven best; fresh ladders start with a cap of 4.
- **Rank-exclusive Torments**: 4 of the 16 Torments only become armable once `bestCleared[mapId]` reaches III / V / VIII / XII — the ladder reveals its nastiest tools as you earn them (discovery pacing, and it keeps the scary hooks out of new players' hands).
- **Clear recording**: `SaveSystem.recordAshClear(mapId, rank)` — an exact clone of `recordPactClear` (`SaveSystem.js:657-666`) keyed per map, returning the number of NEW rank steps. Per-season best recorded in parallel (section 3).
- **Death**: records nothing on the ladder; the game-over card still stamps a **cracked** grey seal with the armed rank (the hook's card moment works for losses too).

**Run-state plumbing (all in `_startRun`, `Game.js:739-899`):**
1. Menu writes `game.pendingAshbound = { mapId, levels: {tormentId: lvl} }` (null when off).
2. In the difficulty block (`Game.js:775-814`): if armed and not `dailyMode`, force `this.difficulty='hard'`, set `mods=[]`, then run the SAME scalar summation loop over the armed Torment levels' effect objects (they use the identical keys: `hp/speed/damage/elite/cap/interval/playerDamage/playerIncoming/playerPickup/xpBonus/coinBonus`), producing `this.runScale` exactly as Trials do. New keys `bossHp`, `healMul`, `chestMul`, `noRerolls`, `eliteDetonate`, `bossEcho`, `dark` are stashed on a new `this.ashEffects` object read by their specific hooks (section 2).
3. `this.ashRank = totalCinders; this.ashMapId = effectiveMapId` — surfaced through `UIStateBuilder` for HUD/game-over.
4. `runSummary.ashRank / ashMap / ashCleared` set in `_enterGameOver` (`Game.js:2507-2522`) and the victory-leave mirror (`Game.js:1206-1213`).

**Payouts (the curve):**
- **First-clear bounty**, paid in `_showVictory` alongside `_checkPactMastery`: for each new step `s` from `prevBest+1` to `rank`: `80 + 45×s` coins (tunable). Climbing one map I→XII over many runs pays `Σ(80+45s) = 960 + 45×78 = 4,470` coins total — a meaningful cosmetics/shop fund without inflating the economy, because it is once-ever per (map, step). Announced via `waveDirector.announce` like the Pact bounty (`Game.js:1175`).
- **Recurring per-run bonus** (pays every Ashbound run, win or lose): each armed Cinder adds **+5% coins, +6% Pass XP** into the existing `coinBonus/xpBonus` sums (`Game.js:787-799`), flowing through the verified payout hooks at `Game.js:2493-2495` and `:2544-2547`. Ashbound uses its own cap `ASH_MAX_BONUS = 3.0` (new const beside `RUN_MODIFIER_MAX_BONUS`, `GameConfig.js:1202`) so a rank-XX run tops out at +100% coins / +120% Pass XP + Nightmare's +50%.
- **Pass-XP synergy is free**: `awardBattlePassRun` (`src/systems/BattlePassSystem.js:26-37`) needs zero changes — the bonus rides `runBonus.xp`.

## 2. The Torment pool (16 Torments, 36 Cinders max)

Format: **Name — levels × cinders/level — effect (mechanism)**. Wave-side scalars ride the verified `Game.js:786-801` loop; the four "new-hook" Torments each get one small cited hook. All values tunable.

**Wave-side (existing keys, zero new mechanics):**
1. **Searing Vigor** — 3×1c — enemy HP ×1.20/×1.40/×1.65 (`hp` key).
2. **Hastened Ash** — 2×1c — enemy speed ×1.08/×1.16 (`speed`; on top of Nightmare's 1.12 → 1.30 max, still readable).
3. **Cruel Embers** — 3×1c — enemy damage ×1.15/×1.32/×1.55 (`damage`).
4. **Elite Torrent** — 2×1c — elite chance ×1.6/×2.4 (`elite`; hard-clamped 0.85 at `Game.js:1891`).
5. **The Press** — 2×2c — enemy cap ×1.15 + spawn interval ×0.88 / cap ×1.30 + interval ×0.76 (`cap`+`interval`; hard-clamped 220 at `Game.js:1894` — perf-safe by construction).

**Player-side (existing keys):**
6. **Dimmed Wand** — 2×1c — your damage ×0.90/×0.80 (`playerDamage`, applied `Game.js:816`).
7. **Thin Hide** — 2×1c — damage taken ×1.20/×1.40 (`playerIncoming`, `Game.js:818`).
8. **Short Reach** — 1×1c — pickup range ×0.70 (`playerPickup`, `Game.js:817`).

**Small-hook Torments (one-line hooks each):**
9. **Hungry Dark** — 2×1c — XP gems worth ×0.85/×0.70: multiply `player.xpMultiplier` (`src/entities/Player.js:121`, consumed at `:208`) at run start.
10. **Cinder Tax** — 2×1c — healing received ×0.70/×0.40: new `player.healMul` (default 1) folded inside `Player.heal()` (`Player.js:331`); regen and Divine Nova already route through it.
11. **Emberdrought** — 1×1c — no free reroll/alter and shop-granted rerolls/banishes/alters are voided: zero the grants at `Game.js:822-827`.
12. **Sealed Chests** *(rank-exclusive ≥ III)* — 1×1c — chest spawn chance ×0.60 (`chestMul` read where chest drops roll; one multiplier at the drop site).

**Heavy mechanical Torments (PR3; rank-exclusive):**
13. **Ashen Wardens** *(≥ V)* — 2×2c — bosses +25%/+50% HP and phase-2 triggers at 60% HP instead of 50%: new `runScale.bossHp` factor into `Game.js:2022`, threshold shift where the phase-2 kit (from BOSSFORGE, dep #4) reads its trigger fraction.
14. **The Unquiet Ash** *(≥ VIII)* — 1×2c — slain elites detonate after a 0.8s telegraphed ring (140px radius, 22 contact damage, fully dodgeable): hook in the elite-death path, telegraph via ParticleSystem ring + one radial distance check on expiry. Budget: elites are rare (≤0.85 chance clamp) and the check is one O(1) player-distance test per detonation.
15. **The Second Coil** *(≥ VIII)* — 1×3c — 20s after a boss dies, its **Echo** returns at 50% HP (ashen-grey tint, no arena re-seal, no banner, no support ring; max 1 Echo alive ever). Implemented as a delayed re-call of `_spawnBoss` (`Game.js:1971`) with an `echo` flag that skips the arena/banner/support blocks (`:1989`, `:2047`, `:2055-2056`) and multiplies `bossHpMul` ×0.5. Echo kills pay half XP/coins and do NOT increment `bossesDefeated` (so wave pacing, victory logic at the 3rd boss, and map-unlock counts are untouched).
16. **Wick's Bargain** *(≥ XII, capstone)* — 1×2c — the Emberlight veil closes fully and your light shrinks: force `mapDarkness = 1.0` (overriding the biome value read at `Game.js:864-867`) and floor the gloom squeeze `gloomT ≥ 0.25` (`Game.js:878`). Brutal on bright maps like Emberwood (0.52) and Dunes (0.46); its cost is why it's the XII-gate capstone.

Pool total = 36 Cinders. Practical design target: rank XX is a "season-defining" clear; ranks above ~XXIV are aspirational.

## 3. Everburn seasons

**Season math** (NEW `src/content/everburn.js`, cloning the `dailyRoad.js` pattern with distinct salts):
- `SEASON_EPOCH_DAY = 20670` (a fixed constant ≈ 2026-08-05, season 1 launch; before it, `seasonNumber=0` = "preseason", ladder works, no seasonal layer).
- `seasonNumber(day) = max(0, floor((day - EPOCH)/42) + 1)` — **42-day (6-week) seasons**.
- `seasonWeek(day) = floor(((day - EPOCH) % 42) / 7)` → 0..5.
- `seasonDaysLeft(day)` for the menu countdown.

**Weekly edicts** — one active per week, same for every device (serverless): a seeded Fisher-Yates shuffle of the 12-edict pool with `mulberry32((seasonNumber ^ 0xa5b0e77) >>> 0)` (distinct salt from `0x9e3779b9` and `0x5eed1234`), take index `seasonWeek` — guarantees no repeat within a season. Edicts modify Ashbound runs only; each is a data object `{id, name, desc, effects}` interpreted in one switch. Launch pool (12, all tunable):
1. **Edict of Kindling** — Ashbound clears pay +30% first-clear coins.
2. **Edict of the Swarm** — The Press costs 1 Cinder/level less (min 1).
3. **Edict of Iron** — Thin Hide is auto-armed at L1 (counts toward rank, costs no cap room).
4. **Edict of the Echo** — The Second Coil armable regardless of rank gate.
5. **Edict of the Bare Wand** — Dimmed Wand Cinders count double toward rank.
6. **Edict of the Lantern** — Wick's Bargain disabled; Hungry Dark pays double bonus.
7. **Edict of Haste** — all enemies +5% speed; every clear counts +1 rank step for payout (not for `bestCleared`).
8. **Edict of the Long Watch** — clears with `time ≥ 1200s` pay +25% coins.
9. **Edict of Warden's Due** — Ashen Wardens armed → +40% Pass XP.
10. **Edict of Thrift** — Emberdrought + Sealed Chests together refund 1 Cinder of cap room.
11. **Edict of the Open Gate** — arm cap becomes `bestCleared + 6` this week.
12. **Edict of Embers Eternal** — recurring per-Cinder coin bonus +2% (7%/Cinder).

**Seasonal ladder & reset rules:**
- Two best tables per map: `ashbound.best` (lifetime, never resets — seals are permanent) and `ashbound.seasonBest` (keyed to `ashbound.seasonNum`, auto-reset on season roll exactly like `dailyRoad`'s day-roll at `SaveSystem.js:689-704`).
- The **arm cap uses lifetime best** — a new season never re-gates content, it only resets the scoreboard (mirrors the "never punishes" streak philosophy, `SaveSystem.js:721-733`).
- Season is **latched at run start** so a rollover mid-run banks to the season the run began in.
- **Season-end conversion** (checked once on menu load when `seasonNum` advances, latched by `ashbound.lastRewardSeason`): coins = `60 × Σ(seasonBest across maps)` (e.g. IX+VI+IV+III = 22 → 1,320 coins) + one of three permanent seal cosmetics by rank-sum threshold: **Bronzed Everburn Seal ≥10 / Silvered ≥25 / Gilded ≥45** (3 NEW static cosmetic entries, re-awardable each season, duplicates auto-convert to coins via the existing dup path, `BattlePassSystem.js:80-82` pattern).
- **Seasonal share card**: if the Emberglass compositor exists (`game.cardCompositor` — verified absent today, dep #2), mint "EVERBURN SEASON III — ASH RANK IX — EMBERWOOD" cards on new seasonal bests and at season-end; otherwise a `waveDirector.announce` banner + the game-over seal stamp carry the moment. Never blocks.

## 4. UI

- **PLAY tab entry**: an "ASHBOUND" chip row under the Trials grid (`MenuRenderer.js:1067-1103` block), showing `ASHBOUND — RANK IX ARMED · EDICT: KINDLING` when armed, `ASHBOUND — best VI · 23d left` otherwise; hidden until the selected map has 1 clear. Tapping opens the panel.
- **Ashbound panel** (new overlay in MenuRenderer, following the existing chip/hotspot pattern): header (map name, lifetime best seal, seasonal best, arm cap, season countdown, this week's edict banner); 16 Torment rows in 2 columns with −/+ level steppers (≥64px touch targets), Cinder cost pips, locked rows greyed with their rank gate; footer: big Roman-numeral rank preview, payout preview (`first-clear +X coins · +Y% coins · +Z% Pass XP`), ARM/DISARM button. Rank-exclusive rows locked shut with a chain glyph until gated rank is proven.
- **In-run HUD**: a small ember-seal pip with the Roman numeral beside the wave label (UISystem HUD block) — constant, quiet pressure signal.
- **Game-over seal**: in `UISystem.js:1843-1940`, when `summary.ashRank > 0`, stamp a 150px procedural wax seal (offscreen-cached canvas: layered radial gradients, embossed Roman numeral, drip lobes) rotated ~-12°, **blazing ember-orange** on a clear / **cracked ash-grey** on a death, beneath the NEW BEST ribbon (`:1865-1878`). This is the roadmap's hook image and it ships in PR2 with zero AI-art dependency.

## 5. NEW vs REUSED

**NEW modules/files**: `src/content/torments.js` (pool + cinder math + validation), `src/content/everburn.js` (season math + edicts + seeded picks), `src/systems/AshboundSystem.js` (pure helpers: arm-cap calc, payout calc, edict application, seal-draw helper — kept out of the 3.9k-line Game.js).
**REUSED/extended**: the `_startRun` Trials fold (`Game.js:786-818`), `_applyRunScale` clamps (`Game.js:1880-1920`), boss HP fold (`Game.js:2022`), `_showVictory`/`_checkPactMastery` clear seam (`Game.js:1150-1177`), `_enterGameOver` payout hooks (`Game.js:2491-2547`), `recordPactClear` save pattern (`SaveSystem.js:657-666`), `dailyRoad` day-roll reset pattern (`SaveSystem.js:689-719`), `mulberry32` day PRNG (`dailyChallenges.js:34-42`), PLAY-tab chip UI (`MenuRenderer.js:1053-1103`), game-over overlay (`UISystem.js:1843-1940`), `BattlePassSystem.awardRun` unchanged.

## 6. Failure modes designed against from PR1

1. **Perf (mobile)**: The Press + Elite Torrent + Second Coil could stack pressure — but `maxAlive ≤ 220` and `eliteChance ≤ 0.85` are enforced INSIDE `_applyRunScale` (`Game.js:1891,1894`), Echo bosses are capped at 1 alive with no support ring, and Unquiet Ash detonations are O(1) per elite death. PR1 ships a harness run at forced rank XII with the badge asserting `EXC: 0`.
2. **Save corruption/tampering**: the whole `ashbound` block is validated with the pactMastery clamp loop (unknown maps dropped, ranks clamped 0..40, season ints ≥0); old saves lack the key entirely → defaults (implicit migration, `SaveSystem.js:199-201`). A tampered `best` can inflate the arm cap but can never re-pay first-clear bounties (steps-gained pattern) or exceed entity clamps.
3. **Economy farming**: first-clear bounties are once per (map, step); recurring bonuses capped at `ASH_MAX_BONUS=3.0`; Ashbound runs still count for dailies/achievements but those are already once-per-day/once-ever latched (`Game.js:1105-1148`). The instant-abandon coin guard (`_bankRunCoins`, `Game.js:1246-1257`) already covers the seed-mint exploit.
4. **Balance cliff**: Nightmare×rank-IV Torments could brick mid-skill players' fun — the +4 arm cap forces incremental exposure, and PR1's debug `_debugJumpToMinute` (`Game.js:1843`) recipe checks the 5/10/20-min checkpoints at ranks IV/VIII/XII before ship.

## PR plan

### PR1 — PR1 — Ash Ranks core: Torment pool, ladder save schema, runScale fold, payouts

**Goal:** The whole ladder works end-to-end (arm via a temporary debug/settings path, scaled run, clear recording, bounties) with zero new UI risk; every clamp verified.

**Files:**
- `src/content/torments.js (NEW)`
- `src/systems/AshboundSystem.js (NEW)`
- `src/config/GameConfig.js`
- `src/core/Game.js`
- `src/systems/SaveSystem.js`
- `src/systems/UIStateBuilder.js`

**Work:**
- Author TORMENTS pool (the 12 non-heavy Torments; the 4 rank-exclusive heavies land as data stubs marked disabled) with cinder costs, levels, effect objects using the exact RUN_MODIFIERS keys
- ASHBOUND config block in GameConfig.js (ASH_MAX_BONUS=3.0, bounty curve constants, arm-cap +4)
- Game.js _startRun: pendingAshbound → force hard difficulty, clear Trials, fold Torment scalars through the existing Game.js:786-818 loop; stash ashEffects; set ashRank/ashMapId; dailyMode guard
- New runScale.bossHp factor into the bossHpMul product at Game.js:2022; player.healMul consumed in Player.heal (Player.js:331); xpMultiplier and reroll/alter zeroing hooks
- SaveSystem: ashbound { clears:{}, best:{}, seasonNum:0, seasonBest:{}, lastRewardSeason:0 } in defaultData + clamp-validated in _validate (pactMastery pattern); recordAshClear(mapId, rank) + recordMapClear(mapId) accessors
- Wire clear recording + first-clear bounty into _showVictory beside _checkPactMastery (Game.js:1158); runSummary.ashRank/ashMap/ashCleared in both _enterGameOver and victoryToMenu paths

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- node scratch test: cinder totals, payout curve Σ(80+45s), arm-cap math, _validate round-trip of a v7 save WITHOUT the ashbound key and of a tampered one (rank 999 → clamped)
- headless harness ?seconds=35&badge=1 → EXC: 0 (Ashbound off, regression)
- harness run with debug-forced rank XII pact (Press+Torrent armed) → EXC: 0 and on-screen enemy count never exceeds 220 (badge)

### PR2 — PR2 — Ashbound menu panel + game-over wax seal

**Goal:** The player-facing surface: arm Torments from the PLAY tab, see rank/payout previews, and get the Ash Rank seal stamped on the game-over screen (blazing/cracked).

**Files:**
- `src/systems/MenuRenderer.js`
- `src/systems/UISystem.js`
- `src/systems/UIStateBuilder.js`
- `src/core/Game.js`
- `src/systems/AshboundSystem.js`

**Work:**
- ASHBOUND chip under the Trials grid (MenuRenderer.js:1067-1103), gated on ashbound.clears[selectedMap] ≥ 1
- Ashbound overlay panel: 16 Torment stepper rows (≥64px targets), cinder pips, rank-gate locks, arm cap display, rank + payout preview footer, ARM/DISARM; hotspot wiring via the existing chip/press-feedback pattern
- Procedural wax-seal renderer in AshboundSystem (offscreen canvas, cached per rank+state) — no AI art needed
- Game-over stamp in UISystem.js:1843-1940: blazing seal on ashCleared, cracked grey on death; in-run HUD rank pip
- Remove the PR1 debug arming path

**Verify:**
- node --check; validate-assets exit 0
- harness ?screen=menu&tab=play&badge=1 screenshot: chip visible on a cleared-map save, panel opens, steppers respond (scripted taps)
- game-over screenshot with ashRank=9 forced: seal legible at 1920×1080 and at DPR-scaled mobile logical size
- full ?seconds=35&badge=1 → EXC: 0

### PR3 — PR3 — The rank-exclusive heavy Torments (Ashen Wardens, Unquiet Ash, Second Coil, Wick's Bargain, Sealed Chests)

**Goal:** The four mechanical showpieces that make high ranks FEEL different, each behind its rank gate, each perf-audited.

**Files:**
- `src/core/Game.js`
- `src/content/torments.js`
- `src/config/GameConfig.js`
- `src/entities/Enemy.js`
- `src/systems/ParticleSystem.js`

**Work:**
- Ashen Wardens: bossHp fold (already plumbed in PR1) + phase-2 threshold shift where the BOSSFORGE phase-2 trigger fraction is read
- Unquiet Ash: elite-death telegraph ring (0.8s, 140px) + one radial player check + 22 contact damage; reducedEffects-safe visuals
- Second Coil: 20s delayed _spawnBoss echo call with flag skipping arena/banner/support (Game.js:1989/2047/2055), 50% HP, grey tint, max 1 alive, half rewards, does NOT increment bossesDefeated
- Wick's Bargain: mapDarkness override at the Game.js:864-867 read + gloomT floor 0.25
- Sealed Chests: chestMul 0.6 at the chest drop roll; enable the 4 stubs in torments.js with gates III/V/VIII/XII

**Verify:**
- node --check; validate-assets exit 0
- per-Torment harness runs (debug-armed singly): echo spawns once and only once; detonation ring visible then damage applies; darkness clamps verified via screenshot histogram
- victory path with Second Coil active: 3rd-boss victory still triggers at the real 3rd boss (echo excluded)
- ?seconds=35&badge=1 at rank XX (all heavies) → EXC: 0, enemy badge ≤ 220

### PR4 — PR4 — Everburn seasons: edicts, seasonal ladder, season-end rewards, share-card hook

**Goal:** The serverless seasonal wrapper: same edict for everyone each week, seasonal bests that reset without punishing, season-end coin + seal conversion.

**Files:**
- `src/content/everburn.js (NEW)`
- `src/systems/SaveSystem.js`
- `src/core/Game.js`
- `src/systems/MenuRenderer.js`
- `src/systems/AshboundSystem.js`
- `src/content/cosmetics.js`

**Work:**
- everburn.js: SEASON_EPOCH_DAY, seasonNumber/seasonWeek/seasonDaysLeft, 12-edict pool, per-season seeded shuffle (mulberry32, salt 0xa5b0e77) → week's edict
- Edict application switch in AshboundSystem (cost discounts, cap changes, payout multipliers), applied at arm time + run start; season latched at run start
- SaveSystem: seasonBest day-roll reset (dailyRoad pattern) + lastRewardSeason latch; season-end conversion on menu load (60×Σ seasonal bests + threshold seal cosmetic 10/25/45)
- 3 seal cosmetics (procedural badge art) appended to cosmetics.js; dup → coins via existing path
- Menu: edict banner + season countdown + seasonal-best line in the Ashbound panel; guarded game.cardCompositor?.mint(...) hook with announce-banner fallback (compositor verified absent today)

**Verify:**
- node --check; validate-assets exit 0
- node determinism test: seasonNumber/week/edict identical across 5,000 sampled timestamps per day boundary; no edict repeats within any season
- node rollover simulation: mock day numbers across a season boundary → seasonBest resets, lifetime best survives, reward pays exactly once
- harness menu screenshot: edict banner + countdown render; full ?seconds=35&badge=1 → EXC: 0

## Data & save changes

**New content files**: `src/content/torments.js` (16 Torments: id, name, desc, levels[] each {cinders, effects}, rankGate for the 4 exclusives; helpers cinderTotal(levels), armCap(best), payoutForSteps(prev, rank)); `src/content/everburn.js` (SEASON_EPOCH_DAY=20670, seasonNumber/seasonWeek/seasonDaysLeft, EDICTS pool of 12, edictForWeek(season, week) via seeded shuffle salt 0xa5b0e77). **New system module**: `src/systems/AshboundSystem.js` (pure helpers + seal renderer). **Save schema (ADDITIVE only, validated with the SaveSystem.js:331-340 pactMastery clamp pattern; missing key → defaults, no version bump needed per the implicit-migration convention at SaveSystem.js:199-201)**: `ashbound: { clears: {mapId:int≥0}, best: {mapId:int 0..40}, seasonNum: int≥0, seasonBest: {mapId:int 0..40}, lastRewardSeason: int≥0 }`. **Config block** in GameConfig.js: `ASHBOUND = { maxBonus: 3.0, bountyBase: 80, bountyPerStep: 45, armCapSlack: 4, coinPerCinder: 0.05, xpPerCinder: 0.06, seasonCoinPerRank: 60, sealThresholds: [10,25,45] }`. **Cosmetics**: 3 appended seal badge entries in `src/content/cosmetics.js` (Bronzed/Silvered/Gilded Everburn Seal). No changes to WAVES/ENEMY/boss data; no asset-credit rows needed (all art procedural).

## Balance numbers (all tunable)

| Number | Start value | Rationale |
|---|---|---|
| Cinder pool max | 36 (16 Torments) | Roman-numeral ladder with headroom; rank XX = season-defining (tunable) |
| Arm cap | bestCleared + 4 | Incremental climb, no blind rank-XX bricking (tunable) |
| Rank-exclusive gates | III / V / VIII / XII | Discovery pacing across ~8-15 clears (tunable) |
| First-clear bounty | 80 + 45×step coins, once per (map,step) | Full I→XII climb = 4,470 coins/map; can't farm (tunable) |
| Recurring bonus | +5% coins, +6% Pass XP per Cinder, cap 3.0 | Rides Game.js:2493/2546 hooks; rank XX ≈ +100%/+120% (tunable) |
| Ashbound difficulty | forced Nightmare (hp1.55/dmg1.40, GameConfig.js:1177) | Rank IX means the same thing on every save (tunable) |
| Searing Vigor / Cruel Embers top | HP ×1.65 / dmg ×1.55 | With Nightmare: ×2.56 HP, ×2.17 dmg — hard but wand-scaling survivable (tunable) |
| The Press top | cap ×1.30, interval ×0.76 | Clamped 220 alive at Game.js:1894 — perf-safe by construction |
| Second Coil echo | 20s delay, 50% HP, max 1 alive, half rewards | One extra single entity; excluded from bossesDefeated (tunable) |
| Unquiet Ash | 0.8s telegraph, 140px, 22 dmg | Dodgeable at base move speed; ~0.5s reaction margin (tunable) |
| Season length | 42 days (6 weeks), epoch day 20670 | 6 distinct weekly edicts, no repeats (seeded shuffle) (tunable) |
| Season-end payout | 60 × Σ seasonal best ranks; seals at 10/25/45 | ~1,300 coins for a solid season — a case-opening spree, not inflation (tunable) |

## Art needs (non-blocking)

- Ash Rank wax seal (game-over stamp + HUD pip): ships PROCEDURAL in PR2 (cached offscreen canvas — radial-gradient wax, embossed Roman numeral, blazing vs cracked states). Optional later polish: one higgsfield nano_banana_pro seal-texture sheet in a separate session; non-blocking, procedural stays the fallback.
- 3 Everburn seal cosmetics (Bronzed/Silvered/Gilded badge): procedural canvas badges via the existing cosmetics pipeline; optional higgsfield polish later, non-blocking.
- Second Coil boss Echo: pure runtime grey/ash tint of the existing BOSSFORGE boss sheets (canvas filter/composite) — NO new creature art, canonical enemy style untouched; no Blender pipeline work needed for this update.

## Risks

- Perf collapse at high ranks on mobile: Press+Torrent+Echo stack — mitigated by construction (maxAlive≤220 at Game.js:1894, eliteChance≤0.85 at :1891, 1-Echo cap, O(1) detonations) and a mandatory rank-XX badge run in PR3's verify.
- Save-schema regression: a malformed ashbound block bricking old saves — mitigated by the clamp-validate loop (pactMastery pattern) landing in PR1 WITH a node round-trip test of v7 saves missing the key and tampered saves.
- Economy inflation / farming: repeat low-rank clears — first-clear bounties are once per (map,step) via the steps-gained pattern (recordPactClear clone); recurring bonus capped at 3.0; abandon-exploit already guarded by _bankRunCoins (Game.js:1246-1257).
- Balance cliff: Nightmare-forced + Torments may wall mid-skill players — arm cap +4 forces gradual exposure; _debugJumpToMinute checkpoint runs at ranks IV/VIII/XII in every PR's verify.
- Emberglass compositor (dep #2) API drift or slip: all card mints are guarded optional calls with announce-banner + seal-stamp fallback, so ASHBOUND ships whole without it.

## Uniqueness & boundaries

ASHBOUND is the only update that gives the game a PRESCRIPTIVE, repeatable difficulty ladder — a player-authored contract ("these named Torments, this rank, this map") with once-ever per-step payouts and a serverless seasonal metagame. Nothing else on the roadmap provides tunable-challenge-as-progression: Trials (shipped) are free-form casual toggles with flat bonuses; ASHBOUND is the ranked, gated, per-map ladder above them. Sharpest boundaries: **#16 NIGHTFALL CYCLES** owns everything that changes WHAT the game contains at higher difficulty (NG+ cycles, compounding multipliers, boss-roster remixes, cycle-exclusive elites, prestige currency/mythics) — ASHBOUND only ever scales and constrains the EXISTING game via runScale, and deliberately ships no new enemies, no roster changes, no prestige economy. **#17 SEALED STORM** owns determinism and shareable challenge CODES — an Ash Rank is a local ladder state, not a seeded run, and ASHBOUND deliberately adds zero seeded-RNG plumbing (17 will later compose Torments into Crucible codes). **#14 LEDGER OF ASHES** owns records/graphs/splits/save-export — ASHBOUND stores only best-rank integers, no run archives. **#20 HEARTHHOLD** owns displaying the earned seals in the camp; ASHBOUND just mints them.

## Roadmap corrections found while grounding

- **Superseded 2026-07-14:** Save v10 now has an exact per-map campaign boss ledger in `CampaignProgression`, exposed through `SaveSystem` status/record APIs. ASHBOUND's clears/best block is still a separate performance record (not campaign access), but it should copy the ledger's fixed-shape sanitize/receipt/persistence discipline rather than lifetime totals.
- The Emberglass card compositor (roadmap dep #2, 'reused by update 15') does not exist in the codebase yet — grep for compositor/Emberglass/shareCard finds nothing under src/. Expected (update 2 unstarted), but the spec therefore treats all card minting as a guarded optional hook with a banner/seal fallback rather than a hard integration point.
- All other synopsis claims VERIFIED: _applyRunScale clamped scalars (eliteChance ≤0.85 Game.js:1891, maxAlive ≤220 Game.js:1894); Trials fold loop Game.js:786-818; BattlePass payout hooks Game.js:2542-2547 + runBonus cap :811-814; dailyRoad mulberry32 day-PRNG with distinct salts dailyRoad.js:28-30.

## Binding cross-spec rulings affecting this update

- **[#2 EMBERGLASS vs #15 ASHBOUND vs #17 THE SEALED STORM]** Three updates claim the same game-over/death card surface: #2 authors the death-card template, #15 stamps an Ash Rank wax seal on it (blazing/cracked), and #17 retro-shares the reproduction challenge code on it. Authored independently, #15 and #17 each imply editing #2's death template.
  **RULING:** #2 owns the death/victory templates and must define named EXTENSION SLOTS in src/content/cardTemplates.js and docs/CARDS.md: a 'stamp' slot (badge region) and a 'footer' slot (code/text line). #15's wax seal registers into the stamp slot; #17's challenge code registers into the footer slot. Neither #15 nor #17 forks or redraws the death template; slot renderers are pure draw functions passed to the compositor.

- **[#14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)]** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.
  **RULING:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.

- **[#3 KINDLED vs #4 BOSSFORGE vs #15 ASHBOUND (calendar-PRNG builders)]** Three updates independently mint deterministic calendar derivation: #3's daily Rite Trial (salt 0x4b494e44), #4's week-keyed Weekly Ember (no salt declared), #15's Everburn seasons/edicts (salt 0xa5b0e77). The repo convention (dailyRoad.js:15-30) is deliberate local mulberry32 copies with DISTINCT salts (0x9e3779b9 and 0x5eed1234 already taken) — the hazard is salt collision and an undeclared derivation in #4.
  **RULING:** The local-copy-with-unique-salt convention stands (no shared helper mandated; it is the documented decoupling pattern). Salt registry, to be appended to each spec: 0x9e3779b9 dailyChallenges, 0x5eed1234 dailyRoad, 0x4b494e44 Rite Trial (#3), 0xa5b0e77 Everburn (#15). #4 must declare a distinct week-number salt for weeklyEmber.js in its spec before build. None of these may later be rethreaded through #17's RunRng — calendar setup determinism and run-sim determinism stay separate by design.
