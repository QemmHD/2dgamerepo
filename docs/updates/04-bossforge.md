# Update #4: BOSSFORGE — The Twelve Reforged

*Era II — The Waking Hand*

**Value verdict (ADDS):** Two-act kits give the 12 verified single-phase stat-block bosses (GameConfig.js:376-646) actual mechanical depth, and Boss Rush + Weekly Ember are new modes, not rearrangement. The spatial-grid/pooling substrate is load-bearing for #11/#16/#17, so PR1 alone justifies the update. Skeptic flag: PR3/PR4 (twelve Blender remodels) is the most art-hour-heavy, lowest-mechanical-yield slice — the phase-2 kits must not be gated on the remodels landing.

## What it adds

Every one of the game's 12 bosses becomes a two-act fight: a Blender-remodeled, multi-pose animated body that visibly winds up, turns, staggers, and transforms at 50% HP into a focused, upgraded phase-2 kit with per-kind telegraphs. Two new ways to play those fights land with it — Boss Rush (all twelve back-to-back against the clock) and Weekly Ember (a week-keyed curated gauntlet with a persistent weekly best). Underneath, the projectile-collision spatial grid and projectile/bolt pooling replace the O(P×E) hot loop and per-shot allocations — the load-bearing perf substrate updates 11, 16, and 17 build on.

## Design spec

# BOSSFORGE — The Twelve Reforged — Implementation Spec

## 0. Current state (verified in code)

- **12 apex bosses** are defined in `src/config/GameConfig.js:380–664` (Gravemaw, Vesperwing, Cacklemaw / Rimewarden, Hoarfang, Aurorath / Ossuar, Mourndrift, Nihagault / Dunescourge, Cindermaw, Solnakh), each with an 8–11-move kit over 11 shared attack `kind`s (`shockwave`, `fan`, `charge`, `summon`, `zones`, `wall`, `seekers`, `aimed`, `cross`, `spiralArms`, `rain`, `mines`, `beam`, `lingering`) all committed through `commitBossAttack` (`src/entities/Enemy.js:1227–1456`).
- **`phase2Attacks` is dead data** — defined at `GameConfig.js:418, 458, 493, 513, 529, 547, 567, 585, 604, 625, 643, 662` and read by nothing (grep over `src/` finds only the 12 definitions). The phase-2 latch itself is live: `runBossAI` sets `phase2Entered`/`phase = 2` at `Enemy.js:1150–1153`, `BOSS_ATTACK.phase2CadenceMul` is consumed at `Enemy.js:1180–1181`, and Game does a one-shot enrage announce off the latch at `src/core/Game.js:3237–3241`. Phase 2 today = same kit, faster + additive-brighter sprite (`Enemy.js:954–958`) + hotter aura (`Enemy.js:677`). No kit change, no transition moment.
- **Boss art** is hand-drawn 64px-logical 2-frame idle loops in `src/assets/PixelBosses.js` (header lines 1–8), resolved via `FRAMES_BY_TYPE` at `Enemy.js:102–113` with a procedural drawer fallback each. Frame selection is a blind auto-advance: `Math.floor(this.animTimer * this.frameHz) % frames.length` (`Enemy.js:922–925`). The lieutenant's state→pose pattern at `Enemy.js:913–921` (hurt on hit-flash, attack on windup, idle otherwise, with fallback) is the exact template to generalize for bosses.
- **Collision hot loop**: `CollisionSystem.resolve` (`src/systems/CollisionSystem.js:35–163`) is a full nested scan — every active projectile × every enemy (`:39–47`), plus a second full-enemy scan per ricochet kill (`:70–76`), plus a third full scan for player contact (`:114–125`). Worst case at caps: ~180 enemies × ~200 bolts ≈ 36,000 `circleOverlap` calls + 36,000 `Set.has` lookups per frame.
- **Per-shot allocations**: every `new Projectile` (`src/entities/Projectile.js:17–53`, constructed at `src/content/weapons.js:948, 1213, 1246, 1286`) allocates a `Set` (`:40`) + two trail arrays (`:49–50`); every boss volley allocates `EnemyProjectile`s with two trail arrays (`src/entities/EnemyProjectile.js:35–36`) — a 26-bolt Solnakh `solarVolley` (`GameConfig.js:650`) is 26 objects + 52 arrays per cast every 2.6s. Dead ones are dropped by `compactInPlace` (`Game.js:3284–3292`) and GC'd.
- **The grid pattern to reuse**: `Game._separateEnemies` builds a GC-clean numeric-key spatial hash `_sepGrid` with persistent buckets + a `_sepUsed` reset list (`Game.js:2202–2215`, comment block from `:2180`), 3×3 neighborhood queries (`:2218–2251`). It is per-frame, allocation-free at steady state, and currently private to separation.
- **Mode plumbing to mirror**: Daily Road shows the exact "alternate run mode" recipe — a `dailyMode` flag (`Game.js:180`), a menu action pair `startRun`/`startDaily` (`Game.js:1483–1484`), a pre-`_initRunState` setup override (`Game.js:743–750`), local (never persisted) difficulty forcing (`Game.js:782`), day-keyed records with clamp+migrate in `SaveSystem` (`src/systems/SaveSystem.js:100–110, 287–309, 683–718`, schema `version: 7` at `:126/:360`). `BossDirector` (`src/systems/BossDirector.js:16–73`) is a clean 70-line scheduler taking a roster array — trivially parameterizable for Rush.
- **Blender pipeline contract**: `tools/blender/README.md` — parametric model + armature + `author_poses` one-action frame columns, `render_sheets.py` renders cells, validates numerically, exits non-zero on failure; pixelate install via `tools/artshot/pixelate-sheet.mjs --cell=256 --logical=96 --colors=32 --outline=1` (README lines 74–82). Bosses will follow this contract with bigger cells and their own archetype rigs.

---

## 1. Phase-2 kits — making `phase2Attacks` load-bearing (PR2)

### 1.1 The transition moment
When the latch fires (`Enemy.js:1150–1153`), instead of only flipping flags:

1. **Clearing burst**: push one `shockwave` hazard (damage **0**, knockback-only — new `push: 420` (tunable) field handled in HazardSystem's shockwave branch) centered on the boss, `rMax 480, growth 1400` (tunable) — it shoves the player and any player-adjacent trash out, selling "act two begins" without a cheap hit.
2. **Stagger window**: boss enters `phaseStagger = 1.2s` (tunable, new `BOSS_ATTACK.phase2StaggerDur`) — no attacks, no movement, plays its new **windup/roar pose** (see §3). For `phaseVulnDur = 3.0s` (tunable) after the latch the boss takes **+20% damage** (tunable, `BOSS_ATTACK.phase2VulnBonus = 0.20`, applied where `resist` is applied in `takeDamage`) — a skill-reward window for players who kept pressure up.
3. **Announce** stays where it is (`Game.js:3237–3241`) but gains the boss bar phase pip (§1.4).

### 1.2 Kit focus — the wiring
In `runBossAI`'s cooldown loop (`Enemy.js:1171–1221`), after `e.phase === 2`:

- Attacks **listed** in `def.phase2Attacks`: cooldown × `BOSS_ATTACK.phase2ListedCdMul = 0.65` (tunable) — this stacks with the existing `phase2CadenceMul`/enrage composition at `Enemy.js:1180–1185`.
- Attacks **not listed**: cooldown × `phase2UnlistedCdMul = 1.7` (tunable). Not removed — the kit narrows to its signature rotation (readable, intense) without going stale.
- Listed attacks also read an optional per-attack `p2` override block (data-only, e.g. `{ id: 'slam', ..., p2: { count: +25%, rMax: 720, projectileSpeed: 520 } }`): at commit, `commitBossAttack` reads `atk.p2 ? { ...atk, ...atk.p2 } : atk` when `e.phase === 2`. One merged-object allocation per commit (≤ 1 every ~2s) — negligible.

### 1.3 One phase-2-exclusive move per boss: the `combo` kind
New attack kind `combo` in `commitBossAttack`: `{ kind: 'combo', steps: [atkSpecA, atkSpecB], gap: 0.35 }` — commits step A immediately, queues step B on a `e._comboQueue` timer ticked at the top of `runBossAI` (before the windup branch at `Enemy.js:1156`). Steps reuse EXISTING kinds only — no new damage path. Each boss gets exactly one, gated `p2Only: true` (skipped in the phase-1 cooldown loop). Examples (all tunable):

- Gravemaw **Rootquake**: `stomp` shockwave → `quake` zones 0.4s later.
- Vesperwing **Stormfront**: `gale` cone → `dive` charge chasing it.
- Cacklemaw **Grinning Waltz**: `gazeBeam` → `drool` zones under the sweep.
- Hoarfang **Serpent's Coil**: `lunge` → `blizzardPinwheel` from the landing spot.
- Solnakh **Crownfall**: `supernova` shockwave → `solarLance` beam — the final boss's second act showpiece.
- (…one authored per remaining boss; pure data in each def's `attacks` list.)

### 1.4 Telegraph + HUD readability
- Windup telegraphs already exist per kind (`Enemy.js:1188–1218`). Add: telegraph hazards carry `color: atk.color` so frost/void/solar bosses paint element-tinted warnings (HazardSystem already receives `color` on beams, `Enemy.js:1434`); phase-2 telegraphs pulse 15% larger.
- Boss HP bar (UISystem): a **phase notch** at the 50% mark and a `PHASE II` flare when crossed; the ENRAGED tint already exists — extend, don't replace.
- The boss sprite itself becomes the primary tell via windup poses (§3) — replacing the "generic ring for everything else" catch-all at `Enemy.js:1216`.

---

## 2. Collision grid + projectile pooling — the perf gate (PR1)

### 2.1 Shared spatial grid
NEW `src/core/SpatialGrid.js` — extract the exact `_sepGrid` mechanics (`Game.js:2202–2215`): numeric key `gx * 65536 + gy`, persistent buckets, used-list reset, `insert(e)`, `queryCircle(x, y, r, fn)` walking `ceil(r/cell)`-span neighborhoods. Cell size **192px** (tunable — must be ≥ largest boss radius 124 (`GameConfig.js:646`) + largest projectile radius so a 3×3 query is sufficient for typical hits; `queryCircle` spans extra cells automatically when `r > cell`).

Game builds ONE grid per frame from active enemies (in `update`, before `_updateProjectiles`/collision), then:
- `_separateEnemies` consumes it (delete its private build — pure win, one build instead of one).
- `CollisionSystem.resolve(dt, player, enemies, projectiles, grid)` — new optional param; projectile loop becomes `grid.queryCircle(p.x, p.y, p.radius + maxEnemyRadius, hitTest)` where `maxEnemyRadius` is tracked during grid build. Ricochet retarget scan (`CollisionSystem.js:70–76`) becomes `grid.queryCircle(e.x, e.y, ricochetRange, …)`. Player-contact scan (`:114–125`) becomes one `queryCircle(player.x, player.y, player.radius + maxEnemyRadius, …)`. **Fallback**: if `grid` is null (tests, harness edge), keep the old full-scan path — one `if`, zero risk.

**Complexity before/after**: before O(P×E + K×E + E) ≈ 200×180 + ricochets ≈ **36,000–40,000** overlap tests/frame at caps; after O(P×k + K×k + k), k = avg occupancy of queried cells ≈ 4–9 at the 180 cap on a 192px grid → **~1,200–2,000** tests/frame (**~20–30×** fewer). Grid build is O(E) and replaces an identical existing build.

### 2.2 Projectile + enemy-bolt pools
NEW free-list pools (in `SpatialGrid.js`'s sibling NEW `src/core/Pool.js`, ~40 lines): `acquire()` pops or constructs, `release(o)` pushes. `Projectile` and `EnemyProjectile` gain `init(x, y, vx, vy, opts)` that assigns **every** constructor field (the constructor becomes `constructor(...) { this.init(...) }` so `new` still works everywhere) — `hitEnemies.clear()` instead of `new Set()` (`Projectile.js:40`), `trailX.length = 0` instead of fresh arrays (`Projectile.js:49–50`, `EnemyProjectile.js:35–36`). Spawn sites migrate to pool helpers: `weapons.js:948, 1213, 1246, 1286` → `ctx.spawnProjectile(...)`; the seven `new EnemyProjectile` sites (`Enemy.js:425, 1253, 1294, 1305, 1354, 1369, 1382`) → `out.spawnBolt(...)` added to the `_bossOut` channel object (`Game.js:2034–2039`). The compaction pass (`Game.js:3284–3292`) releases inactive objects to the pool instead of dropping them to GC.

**Real caps, finally** (see codeCorrections — no projectile cap exists today): player-projectile soft cap **224** (tunable) — on exhaustion, recycle the OLDEST active bolt (player never loses fire responsiveness); enemy-bolt hard cap **320** (tunable) — on exhaustion, skip the spawn (bosses fire so many that dropping bolt #321 is invisible, and it bounds worst-case Boss Rush density by construction). Caps exported from `GameConfig.js` as `PROJECTILE_POOL = { playerMax: 224, enemyMax: 320 }`.

**Parity guard designed in from PR1**: a `DEV_MODE`-gated assert mode runs old full-scan and new grid path side-by-side for the first 300 frames and throws on any hit-set divergence — this is how we catch the "fast fat projectile skipped a cell" class of bug before it ships.

---

## 3. The 12-boss Blender remodel (PR3 + PR4)

### 3.1 Rig archetypes (NEW `tools/blender/boss_rigs.py`)
Four parametric body archetypes, mirroring `monkey_rig.py`'s build/armature/pose structure (README lines 11–12); each boss is a **parameter dict** (proportions, palette, horn/wing/fin toggles) on one archetype:

| Archetype | Bosses | Rig notes |
|---|---|---|
| **BULK** (grounded heavy, root/limb bones) | Gravemaw, Rimewarden, Ossuar, Dunescourge | spine + 2–4 limb chains + jaw bone; slam pose = raised limbs |
| **SERPENT** (spine chain) | Hoarfang, Cindermaw | 8-bone spine curl; windup = coiled S, commit = extended strike |
| **WING** (flyer) | Vesperwing | body + 2 wing chains; windup = wings back, commit = stoop |
| **ORB** (floating maw/celestial) | Cacklemaw, Nihagault, Solnakh, Aurorath, Mourndrift | core + orbiting satellite empties + maw/iris bone; windup = contraction, phase-2 = satellites ignite |

### 3.2 Sheet contract (validated by NEW `tools/blender/render_boss_sheets.py`, exits non-zero on failure, like `render_sheets.py`)
- **One sheet per boss**: 1 row × **8** equal 256px cells: `[idle0, idle1, windup0, windup1, commit, hurt, p2idle0, p2idle1]`. Non-directional (bosses today are non-directional, `Enemy.js:102–113`; the breath/squash deforms at `Enemy.js:874–894` keep them alive between poses). 12 sheets × 2048×256 raw.
- Camera/light solved once per archetype (fixed 12°-pitch ortho like the hero, README line 42); grounded archetypes anchored to the same ground line; ORB archetypes centered.
- Pixelate install: `node tools/artshot/pixelate-sheet.mjs raw/<id>.png src/assets/bosses/<id>_sheet.png --cell=256 --logical=128 --colors=32 --outline=1` — **128px logical** (bosses render at `spriteHalf × visualScale` up to ×2.28, `GameConfig.js:647`, so they need double the hero's 96px detail), 32 colors + canonical outline = the locked hi-bit look. NOT fire-themed except Cindermaw/Solnakh whose palettes are already canonically ember (`GameConfig.js:627–663`).

### 3.3 Runtime wiring (additive, fallback-preserving)
NEW `src/assets/BossSheets.js`: async-loads `src/assets/bosses/<id>_sheet.png`, slices 8 frames, exposes `getBossSheetPoses(type)` → `{ idle: [f0,f1], windup: [f2,f3], commit: [f4], hurt: [f5], p2idle: [f6,f7] }` or `null` until loaded/if missing. `FRAMES_BY_TYPE` boss rows (`Enemy.js:102–113`) get the sheet prepended: `getBossSheetFrames(type) || getPixelBossFrames(type) || procedural` — **PixelBosses.js and the procedural drawers are never deleted** (per the fallback mandate in CLAUDE.md).

Frame selection: generalize the lieutenant pattern (`Enemy.js:913–921`) into a boss branch just above the auto-advance at `Enemy.js:922–925`: `hurt` on hit-flash → `windup0/1` alternating while `bossWindupTimer > 0` → `commit` for 0.25s after commit (new `_commitFlash` timer set in `commitBossAttack`) → `p2idle` pair when `phase2Entered` → `idle` pair. Sheets that haven't loaded fall through to the existing wrap-safe auto-advance untouched.

---

## 4. Boss Rush + Weekly Ember (PR5)

### 4.1 Mode plumbing
Replace the boolean pattern with `this.runMode: 'normal' | 'daily' | 'rush' | 'weekly'` (keep `dailyMode` as a derived getter for the 12 existing read sites, e.g. `Game.js:562, 743, 782, 849`). New menu actions `startRush` / `startWeekly` beside `startDaily` (`Game.js:1483–1484`); Play-tab cards beside the Daily card (`MenuRenderer.js:1152–1177` hotspot pattern). **Unlock**: Boss Rush appears after the player has ever defeated a 3rd boss (existing lifetime stats; shown locked with "Defeat a map's third boss" otherwise).

### 4.2 Boss Rush rules (all tunable)
- **Roster**: all 12 in tier ladder order — the four tier-1 skirmishers, then four tier-2 warlords, then four tier-3 apexes (`BOSS_TIERS`, `GameConfig.js:671–675`), map-order within tier. Fed to `BossDirector` as the roster array it already accepts (`BossDirector.js:19–20`) with `spawnInterval = 0`-style immediate scheduling: NEW thin `RushDirector` (~50 lines) or a `{ rush: true }` option — boss N+1's warning starts `intermission = 18s` after boss N dies.
- **No trash waves**: Spawner gated off in rush (`runMode` check where the trash-spawner gate runs in `_updateGameplay`, `Game.js:2742` comment); boss support/summon spawns still work (they're `_spawnBossSupport`, `Game.js:2121–2131`, boss-owned).
- **Level script**: start at level 12 with 11 instant upgrade picks queued (the existing level-up flow, one at a time during the pre-fight warning); +2 levels' worth of XP granted at each intermission. No gems from bosses in rush (XP is scripted so the mode measures piloting, not farming).
- **Boss scaling**: `_spawnBoss`'s time/encounter scaling (`Game.js:1999–2028`) is replaced in rush by index scaling: `hpMul = 2.2 × (1 + 0.30 × index)`, `dmgMul = 1 + 0.06 × index` (tunable) — flat, legible, fair.
- **Scoring/records**: clear time (all 12) or bosses-downed on death; coins banked = `35 × Σ(tier)` capped at **900**/run (tunable) so rush can't out-farm real runs. Results screen reuses the game-over layout + records `bossRush: { bestBosses, bestTimeMs, clears }`.

### 4.3 Weekly Ember (no server, week-keyed content rotation)
`weekNumber = floor(currentDayNumber() / 7)` (reusing the day function from `Game.js:744`). The week's gauntlet is a **deterministic table lookup** — `content/weeklyEmber.js` authors 8 rotations, indexed `weekNumber % 8`: 6 bosses (mixed maps), 2 forced Trials modifiers from `RUN_MODIFIERS` (`Game.js:784`), a fixed hero-agnostic difficulty (`normal`, forced locally like Daily at `Game.js:782`), one "ember twist" per rotation (e.g. "all bosses start at phase 2", "intermission 10s", "bolts 15% faster") implemented as existing scalar overrides only. Save: `weeklyEmber: { week, best, prevBest, claimedWeek }` — the exact `dailyRoad` shape + reset-on-new-week logic (`SaveSystem.js:683–718`). First clear of the week banks a case (mirrors `dailyRoad.caseDay`, `SaveSystem.js:708–718`). **Deliberately NOT seeded-RNG simulation** — that's update 17's foundation; a content-rotation gauntlet is fully fair without it because bosses are the deterministic part of a run.

### 4.4 Verification hooks
`tools/artshot/harness.html` gains `mode=rush|weekly` and `boss=<id>&phase=2` params (harness already boots the real game with synchronous stepping) so every PR's screenshot recipe can drive a specific boss to phase 2 headlessly and prove `EXC: 0`.

---

## 5. What is NEW vs REUSED

**NEW modules**: `src/core/SpatialGrid.js`, `src/core/Pool.js`, `src/assets/BossSheets.js`, `src/systems/RushDirector.js` (or BossDirector option), `src/content/weeklyEmber.js`, `tools/blender/boss_rigs.py`, `tools/blender/render_boss_sheets.py`. **NEW assets**: `src/assets/bosses/<12 ids>_sheet.png`. **NEW save keys (additive)**: `bossRush`, `weeklyEmber` (+ `stats.bossRushClears`). **EXTENDED**: `CollisionSystem.resolve` (grid param), `Projectile`/`EnemyProjectile` (`init()` reset), `Enemy.js` `runBossAI`/`commitBossAttack` (phase-2 wiring, `combo` kind, `_bossOut.spawnBolt`), `FRAMES_BY_TYPE` + boss pose selection, `Game.js` (`runMode`, grid build, pool release in compaction), `GameConfig.js` (`BOSS_ATTACK` phase-2 constants, `PROJECTILE_POOL`, per-boss `p2` blocks + combo attacks), `SaveSystem.js` (two clamped keys), `MenuRenderer.js` (two Play-tab cards), UISystem (phase notch), harness (mode/boss params). **REUSED unchanged**: HazardSystem damage paths, EnemyProjectile player-hit path, `_spawnBossSupport` cap gating, Daily Road mode recipe, `BOSS_TIERS`, the pixelate/validate/credit toolchain.

## PR plan

### PR1 — PR1 — Perf gate: shared spatial grid + projectile/bolt pooling

**Goal:** Replace CollisionSystem's O(P×E) scans with grid queries and per-shot allocations with pooled objects, introducing the game's first real projectile caps. Independently shippable: zero gameplay-visible change, measurable frame-time win.

**Files:**
- `src/core/SpatialGrid.js (NEW)`
- `src/core/Pool.js (NEW)`
- `src/systems/CollisionSystem.js`
- `src/entities/Projectile.js`
- `src/entities/EnemyProjectile.js`
- `src/core/Game.js`
- `src/config/GameConfig.js`
- `src/content/weapons.js`
- `src/entities/Enemy.js`

**Work:**
- Extract the _sepGrid mechanics (Game.js:2202–2215) into SpatialGrid with insert/queryCircle; build once per frame in Game.update; _separateEnemies consumes the shared grid
- CollisionSystem.resolve takes the grid: projectile-hit, ricochet-retarget (CollisionSystem.js:70–76), and player-contact (:114–125) scans become queryCircle calls with a null-grid full-scan fallback
- Add init() reset methods to Projectile/EnemyProjectile (hitEnemies.clear(), trail arrays length=0); Pool free-lists with playerMax 224 (recycle-oldest) / enemyMax 320 (skip-spawn); migrate spawn sites weapons.js:948/1213/1246/1286 and the seven new EnemyProjectile sites in Enemy.js; compaction (Game.js:3284–3292) releases to pool
- DEV_MODE parity assert: run old + new collision paths side-by-side for 300 frames, throw on divergence

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- harness.html?seconds=35&badge=1 shows EXC:0
- harness late-run swarm scene: log avg frame ms + collision-test count before/after (expect ~20–30× fewer overlap tests)
- targeted harness run with pierce+ricochet weapon confirms identical kill counts vs main (parity assert silent)
- adversarial review; squash-merge to main

### PR2 — PR2 — Phase-2 kits: wire phase2Attacks, transition moment, combo signatures

**Goal:** The dead phase2Attacks data (GameConfig.js:418–662) becomes a real second act: transition burst + stagger + vulnerability window, kit focus via cooldown reshaping, one phase-2-exclusive combo move per boss, telegraph/HUD readability.

**Files:**
- `src/entities/Enemy.js`
- `src/config/GameConfig.js`
- `src/core/Game.js`
- `src/systems/HazardSystem.js`
- `src/systems/UISystem.js`
- `src/systems/AudioSystem.js`
- `tools/artshot/harness.html`

**Work:**
- Transition at the latch (Enemy.js:1150–1153): damage-0 push shockwave (push:420 handled in HazardSystem), 1.2s stagger, 3.0s +20% vulnerability window
- Cooldown reshaping in runBossAI loop (Enemy.js:1171–1221): listed ×0.65, unlisted ×1.7; per-attack p2 override merge at commit; NEW combo kind chaining two existing kinds via e._comboQueue; author one p2Only combo per boss in GameConfig
- Telegraph color from atk.color on all telegraph hazards; phase-2 telegraphs +15% radius; boss bar 50% phase notch + PHASE II flare in UISystem; short phase stinger in AudioSystem (full boss music belongs to update 7)
- harness boss=<id>&phase=2 param to force a specific boss to 49% HP headlessly

**Verify:**
- node --check; validate-assets exit 0
- harness?boss=solnakh&phase=2&badge=1 screenshot: EXC:0, phase notch visible, combo fires (two hazard/bolt groups in sequence)
- assert in harness log: unlisted attack cooldowns lengthen after latch; listed shorten
- manual balance pass on 3 bosses (Gravemaw/Hoarfang/Solnakh) at 10/20/30-min HP scaling
- adversarial review; squash-merge

### PR3 — PR3 — Blender boss remodel wave 1 (archetype rigs + maps 1–2, six bosses)

**Goal:** Ship boss_rigs.py (BULK/SERPENT/WING/ORB archetypes) + the validated 8-pose sheet pipeline + runtime pose selection, with the first six bosses (vinebackGoliath, stormwingAlpha, gloomMaw, rimewarden, hoarfang, aurorath) installed behind fallback-preserving loaders.

**Files:**
- `tools/blender/boss_rigs.py (NEW)`
- `tools/blender/render_boss_sheets.py (NEW)`
- `tools/blender/README.md`
- `src/assets/BossSheets.js (NEW)`
- `src/assets/bosses/vinebackGoliath_sheet.png (NEW, +5 more)`
- `src/entities/Enemy.js`
- `src/assets/credits/assets.json`

**Work:**
- Four parametric archetype builders + per-boss parameter dicts; one action with 8 pose columns [idle0,idle1,windup0,windup1,commit,hurt,p2idle0,p2idle1]; render driver validates cell count/alpha/ground-line numerically and exits non-zero on failure
- Pixelate install at --cell=256 --logical=128 --colors=32 --outline=1 into src/assets/bosses/
- BossSheets.js async loader → pose map or null; prepend to FRAMES_BY_TYPE boss rows (Enemy.js:102–113); state→pose branch above the auto-advance (Enemy.js:922–925) modeled on the lieutenant pattern (:913–921); _commitFlash timer set in commitBossAttack
- Credit rows + README section for the boss pipeline

**Verify:**
- python3 render_boss_sheets.py exits 0 (contract checks)
- node tools/validate-assets.js exit 0
- harness?boss=<each of 6>&badge=1: EXC:0 and windup pose visibly differs from idle in the screenshot
- temporarily blank one sheet path → procedural fallback renders (fallback contract proven)
- adversarial review; squash-merge

### PR4 — PR4 — Blender boss remodel wave 2 (maps 3–4, six bosses) + polish

**Goal:** Complete the twelve: ossuar, mourndrift, nihagault, dunescourge, cindermaw, solnakh on the wave-1 pipeline, plus hurt/commit pose timing polish and p2idle retint verification across all 12.

**Files:**
- `tools/blender/boss_rigs.py`
- `src/assets/bosses/ossuar_sheet.png (NEW, +5 more)`
- `src/assets/BossSheets.js`
- `src/entities/Enemy.js`
- `src/assets/credits/assets.json`

**Work:**
- Six parameter dicts on existing archetypes (ORB×3, BULK×2, SERPENT×1); Cindermaw/Solnakh palettes stay canonically ember per their defs — no fire styling leaks to the frost/void bosses
- Tune _commitFlash duration and windup alternation Hz against real kit windups (0.35–0.9s range in defs)
- Full 12-boss showcase screenshot grid for the PR description

**Verify:**
- render_boss_sheets.py exit 0 for all 12
- validate-assets exit 0
- harness screenshots of all 12 with badge=1, EXC:0 each
- adversarial review; squash-merge

### PR5 — PR5 — Boss Rush + Weekly Ember modes

**Goal:** Two new ways to play the reforged fights: the 12-boss tier-ladder Rush against the clock, and the week-keyed curated Weekly Ember gauntlet with persistent weekly bests — both on the Daily Road mode recipe, both additive to saves.

**Files:**
- `src/core/Game.js`
- `src/systems/RushDirector.js (NEW)`
- `src/content/weeklyEmber.js (NEW)`
- `src/systems/SaveSystem.js`
- `src/systems/MenuRenderer.js`
- `src/systems/Spawner.js`
- `src/systems/UISystem.js`
- `tools/artshot/harness.html`

**Work:**
- runMode field replacing the dailyMode boolean pattern (derived getter keeps the 12 existing read sites working); startRush/startWeekly actions beside Game.js:1483–1484; Play-tab cards on the MenuRenderer.js:1152–1177 hotspot pattern with the 3rd-boss unlock gate
- RushDirector: tier-ladder roster, 18s intermissions, no trash (Spawner gated by runMode), scripted levels (start 12, +2/intermission), index-based boss scaling replacing time scaling in _spawnBoss (Game.js:1999–2028), coin bank cap 900
- weeklyEmber.js: 8 authored rotations keyed floor(dayNumber/7)%8 (6 bosses, 2 modifiers, 1 scalar twist); local difficulty forcing exactly like Game.js:782
- SaveSystem: bossRush + weeklyEmber keys with the dailyRoad clamp+reset pattern (SaveSystem.js:298–305, 683–718); results screens reuse game-over layout; harness mode=rush|weekly params

**Verify:**
- node --check; validate-assets exit 0
- harness?mode=rush&seconds=35&badge=1: EXC:0, first boss warning fires immediately, no trash spawns
- save round-trip test: v7 save without new keys loads clean (clamp defaults), new keys persist, corrupt values dropped
- weekly rotation determinism: same week number → identical gauntlet across two boots
- adversarial review; squash-merge

## Data & save changes

**New content files**: `src/content/weeklyEmber.js` (8 authored weekly rotations: bossIds[6], modifierIds[2], twist scalar block, name/flavor). **New asset files**: `src/assets/bosses/<12 boss ids>_sheet.png` (2048×256 8-pose sheets, pixelated hi-bit, credited in `src/assets/credits/assets.json` as first-party Blender renders following the hero-sheet precedent). **New config blocks in GameConfig.js**: `BOSS_ATTACK.phase2StaggerDur/phase2VulnBonus/phase2VulnDur/phase2ListedCdMul/phase2UnlistedCdMul`, `PROJECTILE_POOL { playerMax, enemyMax }`, `RUSH { intermission, startLevel, levelsPerBoss, hpBase, hpPerIndex, dmgPerIndex, coinPerTier, coinCap }`, per-boss `p2:{}` override blocks and one `p2Only` combo attack per boss def (append-only inside existing `attacks` arrays). **Save schema (additive only, clamp+migrate per the SaveSystem.js:287–360 pattern, no version bump needed — fields are implicit-default like `streak`)**: `bossRush: { bestBosses:0, bestTimeMs:0, clears:0 }`, `weeklyEmber: { week:0, best:0, prevBest:0, claimedWeek:0 }`, `stats.bossRushClears` (int ≥ 0). Old saves load unchanged; unknown/corrupt values dropped/clamped exactly like `dailyRoad`.

## Balance numbers (all tunable)

| Number | Start value | Rationale | 
|---|---|---|
| Grid cell size | 192px (tunable) | ≥ max boss radius 124 (GameConfig.js:646) + bolt radius, so 3×3 covers typical hits; ~4–9 enemies/queried-neighborhood at the 180 cap |
| Player projectile pool cap | 224, recycle-oldest (tunable) | just above the roadmap's assumed ~220 budget; recycling keeps fire feel |
| Enemy bolt pool cap | 320, skip-spawn (tunable) | Solnakh volley 26 × ~5s lifetime + walls/seekers stacks ≈ 250 worst case; 320 gives Rush headroom while bounding mobile GC/draw |
| Phase-2 stagger | 1.2s (tunable) | long enough to read the roar pose, short enough to keep pressure |
| Phase-2 vulnerability | +20% dmg taken for 3.0s (tunable) | rewards sustained pressure without trivializing act two |
| Transition push shockwave | damage 0, push 420, rMax 480, growth 1400 (tunable) | clears melee without a cheap hit |
| Listed / unlisted cooldown mul in phase 2 | ×0.65 / ×1.7 (tunable) | composes with existing phase2CadenceMul + enrage (Enemy.js:1180–1185); kit visibly narrows and accelerates |
| Combo step gap | 0.35s (tunable) | readable one-two, not a double-hit |
| Rush intermission | 18s (tunable) | pick upgrades + breathe; total clear target ~14–18 min |
| Rush level script | start 12 (+11 queued picks), +2 levels per intermission (tunable) | build agency without gem farming |
| Rush boss scaling | hp 2.2×(1+0.30·index), dmg ×(1+0.06·index) (tunable) | replaces time scaling (Game.js:1999–2028); boss 12 ≈ 3.3× boss 1 HP |
| Rush coin bank | 35×tier per kill, run cap 900 (tunable) | can't out-farm a normal run's banking |
| Weekly gauntlet | 6 bosses, 2 modifiers, 1 twist, normal difficulty forced locally (tunable) | fair shared target, ~10-min sessions |
| Boss sheet | 8 poses × 256px cells, 128px logical, 32 colors (fixed contract) | 2× hero detail for 1.5–2.28× visualScale bodies |
| Perf target | ≥20× fewer collision tests (36–40k → 1.2–2k/frame); 0 steady-state projectile allocations | measured via PR1 harness probe |

## Art needs (non-blocking)

- Blender pipeline (primary, non-blocking): NEW tools/blender/boss_rigs.py with 4 parametric archetypes (BULK/SERPENT/WING/ORB) + render_boss_sheets.py contract validator — deterministic, regenerable, no AI generation needed; every boss keeps its PixelBosses.js hand-drawn fallback AND procedural fallback forever, so PRs 1/2/5 ship with zero art dependency
- Higgsfield/Nano Banana (optional, separate session, never blocks): concept passes for the 4 archetype silhouettes as visual reference before modeling; if used, credit rows in ASSET_CREDITS.md — but the pipeline is designed to not require it
- Procedural: telegraph tint/pulse upgrades, boss-bar phase notch, transition shockwave ring, Rush/Weekly menu cards — all canvas-drawn in-code, ship in their own PRs with no asset step

## Risks

- Pooling aliasing bugs (highest risk): a reused Projectile keeping stale burnDps/ricochetRange/hitEnemies silently corrupts combat. Mitigated from PR1: init() assigns EVERY field (constructor delegates to it, so fresh-vs-pooled can be diff-tested), hitEnemies.clear() on release, and a DEV_MODE parity assert running old and new collision paths side-by-side for 300 frames that throws on divergence.
- Grid collision misses for large/fast bodies: a boss radius 124 or a fast bolt can span cells and a naive 3×3 lookup drops hits. Mitigated by query radius = p.radius + tracked maxEnemyRadius with cell-span expansion in queryCircle, 192px cells sized to the max boss radius, and the same parity assert as the proof.
- Boss Rush perf/mobile: 12 consecutive bullet-hell fights is the new worst case. Mitigated by construction: the enemy-bolt hard cap (320) lands in PR1 BEFORE the mode exists in PR5, no trash waves in rush (fewer entities than a normal boss fight), and reducedEffects already silences trails/glows (Game.js:833–837).
- Save/meta economy: rush farming or corrupt new keys breaking v7 saves. Mitigated by the rush coin cap (900), scripted XP (no gem drops), and additive implicit-default keys through the existing clamp pattern (SaveSystem.js:287–360) — a v7 save with no new keys loads byte-identical behavior.
- Balance regression on live bosses: phase-2 cooldown reshaping changes all 12 existing fights. Mitigated by keeping every phase-1 number untouched, gating all new behavior behind the phase2Entered latch that already exists, and the PR2 manual pass on the three scaling brackets.

## Uniqueness & boundaries

BOSSFORGE is the only update in the 20 that improves the FIGHTS THEMSELVES — the second-act kit depth, the pose-animated boss bodies, and the boss-centric modes — and the only one that delivers the engine substrate (spatial-grid collision + projectile pooling + the first enforced projectile caps) that updates 11 (Forgeheart's 180-husk slag-river swarms), 16 (Nightfall's compounding multipliers), and 17 (Sealed Storm's deterministic sim, which needs pooled/ordered entity updates) are explicitly scheduled behind. Sharpest neighbor boundaries: **#7 THRESHOLDS** owns everything AROUND the fight — arena-raise set pieces, per-boss weather, kill monuments, the 12 boss themes and phase-2 music stingers via the musicDuck sidechain — so PR2 ships only a minimal audio blip and deliberately does not touch ObstacleSystem arenas or music layers. **#6 UNDERTOW / #11 FORGEHEART** own NEW bosses (Tidewarden; Smith/Bellows/Anvil) — BOSSFORGE remodels only the existing twelve but ships the exact archetype-rig + 8-pose-sheet pipeline those updates consume. **#17 SEALED STORM** owns seeded determinism — Weekly Ember is deliberately a week-keyed CONTENT rotation (authored table lookup), not a seeded simulation, so nothing here pre-empts the one-run-RNG work. **#14 LEDGER OF ASHES** owns per-boss speedrun splits and gold/green/red deltas — Boss Rush records only total time and bosses-downed, leaving split timing to the records update. **#2 EMBERGLASS** owns the share-card compositor — Rush/Weekly results reuse the game-over layout and simply become mintable for free once the compositor exists.

## Roadmap corrections found while grounding

- Roadmap claim '~220 projectiles' perf cap: NO projectile cap exists anywhere in code. The only 220 is Game.js:1894's Math.min(220, …) which caps ENEMY maxAlive (the 180 base cap's modifier ceiling). Projectiles and enemy bolts are currently unbounded (Solnakh + walls + seekers can stack ~250 live bolts). PR1's pool caps (224 player / 320 enemy) introduce the first enforced projectile budget — the spec treats the roadmap's ~220 as the budget to implement, not a fact to rely on.
- Roadmap update-1 overlap: ROADMAP.md line 22 lists 'Boss phase2Attacks wiring' inside REFORGED (#1, in flight), while #4's synopsis says 'full phase-2 kits'. As of today the wiring has NOT landed (grep: phase2Attacks has zero readers in src/). This spec's PR2 assumes ownership of the full wiring; if REFORGED lands a minimal cadence-only version first, PR2 upgrades it in place rather than duplicating — the boundary is: #1 may make the data merely non-dead, #4 makes it a designed second act (transition moment, kit focus, combo signatures, poses).
- All other synopsis claims verified as stated: phase2Attacks dead data confirmed (12 definition sites GameConfig.js:418–662, zero readers); runBossAI/commitBossAttack/phase2Entered latch confirmed (Enemy.js:1137–1456, latch :1150–1153); CollisionSystem.resolve O(P×E) confirmed (CollisionSystem.js:39–47 plus two more full-enemy scans at :70–76 and :114–125); Projectile per-shot Set confirmed (Projectile.js:40, plus two trail arrays :49–50); Game.js _sepGrid confirmed at Game.js:2202 (comment block from :2180, spec claim of ~2180 accurate).

## Binding cross-spec rulings affecting this update

- **[#4 BOSSFORGE vs #8 GLOAMCALL vs #17 THE SEALED STORM]** #8's 'swarm' kind (Duskmoths/Veilwisps gloam-motes) is specced to "live outside the projectile pool" — directly against #4's load-bearing substrate (pooling + the first ENFORCED projectile caps + shared spatial grid) and against #17's determinism requirement of pooled/ordered entity updates. An unpooled, uncapped, self-colliding mote class re-opens the O(P×E) hot loop and the per-shot allocations #4 exists to close.
  **RULING:** #4 owns the perf substrate. Swarm motes MAY be a distinct entity class from projectiles, but they MUST (a) be pooled with a hard cap declared in GameConfig (counted in a SWARM budget beside the ~220-projectile cap), (b) resolve collisions through #4's shared spatial grid — no parallel collision path, and (c) update in stable, pooled iteration order so #17's determinism assertion holds. #8's spec replaces "live outside the projectile pool" with "live in their own pooled, capped, grid-registered swarm pool."

- **[#4 BOSSFORGE vs #6 UNDERTOW vs #11 FORGEHEART vs #12 CINDERS & SCRIPTURE]** Boss arithmetic disagrees across four specs: #4 remodels "the 12 bosses" and Boss Rush runs "all twelve"; #6 adds the Tidewarden apex (update 6); #11 claims its three bosses "complete the roster to 15" (12+3, silently excluding Tidewarden); #12's codex ships "THE_TWELVE (12 boss ids)" at update 12 when 16 boss-class enemies exist.
  **RULING:** Canonical taxonomy, to be quoted verbatim in all four specs: "The Twelve" is the fixed set of legendary campaign duels in GameConfig.js:379-663 and is what #4 remodels, #7 ritualizes, and #12's Twelve page commemorates. Forgeheart's Bellows/Smith/Anvil (#11) are campaign roster additions 13–15: #11 must append them to the data-driven Boss Rush pool and declare their bossRites rows (already in its PR4). The Tidewarden (#6) is Descent-mode-exclusive: excluded from roster counts, Boss Rush, The Twelve, and Thresholds; it appears in the codex per the next ruling. Boss Rush's roster is registry-driven, not a hardcoded twelve.

- **[#3 KINDLED vs #4 BOSSFORGE vs #15 ASHBOUND (calendar-PRNG builders)]** Three updates independently mint deterministic calendar derivation: #3's daily Rite Trial (salt 0x4b494e44), #4's week-keyed Weekly Ember (no salt declared), #15's Everburn seasons/edicts (salt 0xa5b0e77). The repo convention (dailyRoad.js:15-30) is deliberate local mulberry32 copies with DISTINCT salts (0x9e3779b9 and 0x5eed1234 already taken) — the hazard is salt collision and an undeclared derivation in #4.
  **RULING:** The local-copy-with-unique-salt convention stands (no shared helper mandated; it is the documented decoupling pattern). Salt registry, to be appended to each spec: 0x9e3779b9 dailyChallenges, 0x5eed1234 dailyRoad, 0x4b494e44 Rite Trial (#3), 0xa5b0e77 Everburn (#15). #4 must declare a distinct week-number salt for weeklyEmber.js in its spec before build. None of these may later be rethreaded through #17's RunRng — calendar setup determinism and run-sim determinism stay separate by design.
