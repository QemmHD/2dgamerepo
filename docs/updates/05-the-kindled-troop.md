# Update #5: THE KINDLED TROOP

*Era II — The Waking Hand*

**Value verdict (ADDS):** First allied entity in a game that currently has zero friendly units — a wholly new entity class (ally combat, knockout/revive, cross-run Bond) with no incumbent to re-skin. Firing through the real combat pipeline rather than a fake DPS aura is what makes it substance instead of a cosmetic pet. Watch item: 5 archetypes on 3 elements risks striker variants feeling like palette swaps — courier/guardian roles carry the roster's claim to variety.

## What it adds

The game's first allied entity: a little wand-bearing monkey familiar that follows the hero, picks its own targets, fires real elemental wand bolts through the exact same combat pipeline as the player, gets knocked out and rekindled beside you, and levels a persistent Bond across runs. It adds a 5-archetype collectible roster (fire/frost/shock striker + courier + guardian), a coin-sink acquisition economy, and the perch/roster menu surface that update 20's camp will inherit — a companionship fantasy no other update on the roadmap touches.

## Design spec

# THE KINDLED TROOP — implementation spec

## 0. Design pillars

1. **A familiar is a tiny second wick-keeper, not a turret.** It is a cub-proportioned monkey (Blender rig parameter sweep of the hero rig) that holds a mini-wand, walks/casts/hurts with the same 7-pose sheet contract as the hero, and fires ordinary `Projectile` instances into the shared pipeline — so kills, gems, combo, burn, chill, shock-detonation, and (once update 3 ships) the element combo table all work on day one with zero combat-code forks.
2. **Budgeted inside the caps by construction.** Familiars never enter `this.enemies` (the 180 `maxEnemyCap`, GameConfig.js:1136, is untouched); their shots ride `this.projectiles` under an explicit new familiar-shot budget (20 live, see §5) because — verified — no enforced projectile cap exists today (see codeCorrections).
3. **Autonomous = touch-first.** Zero new inputs. Follow, engage, and the revive channel are all proximity-driven, so mobile (update 3's touch inputs) gets the feature for free.
4. **Append-only roster + reusable perch.** `FAMILIARS` in a new content file is append-only (update 8 may add an umbral cub; update 9 injects *temporary* rescued familiars through the same `TroopSystem` API), and the perch scene ships as its own render module for update 20.

---

## 1. Roster — 5 archetypes (append-only data, `src/content/familiars.js` NEW)

All numbers (tunable). `element` values match the existing weapon element vocabulary (`WEAPONS[*].element` — fire/frost/shock, src/content/weapons.js:85,134,158…).

| id | name | role | element | attack | base numbers |
|---|---|---|---|---|---|
| `cinder` | Cinder | striker | fire | single ember bolt at current target | dmg 7, cooldown 1.1s, bolt speed 620, radius 6, burnDps 3, burnDuration 2.5s |
| `sleet` | Sleet | striker | frost | frost bolt, applies chill stack | dmg 6, cd 1.3s, speed 580, chill = 1 stack via the existing stacking chill (GameConfig.js:880–884) |
| `spark` | Spark | striker | shock | shock bolt; detonates burning targets via existing `SHOCK_CFG.detonateMul = 2.5` (GameConfig.js:889–891) | dmg 7, cd 1.6s, speed 700 |
| `ash` | Ash | courier | — | no attack; flies to nearest gem/coin cluster ≤700px, magnetizes pickups in a 140px ring toward the player; +0.5 HP/s aura routed through `player.healSustained()` (Player.js:333–341, so it can never break the `CAPS.healPerSecond = 14` budget, GameConfig.js:108) | ring 140px, retarget 0.6s |
| `bramble` | Bramble | guardian | — | "thump" pulse when ≥2 enemies within 120px: 12 dmg, radius 120, knockback 90px, every 3.5s | pulse reuses the WeaponSystem `effects` pulse visual (WeaponSystem.js:220–224) |

Acquisition (§7): Cinder is **granted free to every save** (old and new — the update's hook lands instantly); the other four are coin purchases.

**Reserved row discipline:** the file ends with a documented reserved slot comment for an umbral familiar (mirrors update 3's reserved umbral combo row) — update 8 appends, we never pre-implement.

## 2. New system: `src/systems/TroopSystem.js` (NEW) + `src/entities/Familiar.js` (NEW)

### Game integration points (all verified)
- **Construction:** in `Game._initRunState()` (Game.js:566) next to `this.weaponSystem = new WeaponSystem(...)` (Game.js:614): `this.troop = new TroopSystem(this.saveSystem.getTroop())`. Reset per run like every other run system.
- **Update order:** `Game.update()`'s phase list (Game.js:2617–2635) gains one call between `_updatePlayerAndWeapons` (2621) and `_updateEnemies` (2622): `this.troop.update(dt, this)` — familiars follow this frame's player position and their shots enter `this.projectiles` before `_updateProjectiles` (2623) moves them, exactly like weapon-fired bolts.
- **Combat resolution: ZERO changes.** Familiar bolts are `new Projectile(x, y, vx, vy, { damage, element, burnDps, burnDuration, familiar: true })` — the `Projectile` constructor already carries element payloads (Projectile.js:35–38) and CollisionSystem already stamps burn from projectile payloads onto enemies; kills surface in `collisionResult.killed` and merge into `allKilled` (Game.js:3012–3015), so gems (`_dropGem`, Game.js:3031), combo (`_addCombo`, Game.js:3019), kill-heal (Game.js:3022), affix deaths, and boss credit all flow untouched. Burn kills tick through `_tickStatuses` (Game.js:2317) and burn contagion (Game.js:2356+) exactly as if the player lit the fire. **This reuse is the core engineering decision of the update.**
- **Obstacles/arena:** each familiar runs `obstacleSystem.resolveCircle` per frame (same call the player uses, Game.js:2760) and is confined by `_confineToArena` during boss fights (player: Game.js:2764; boss: Game.js:2884) so it's never sealed outside the ring.
- **Render:** familiars draw immediately before `this.player.draw(ctx)` (Game.js:3497) — behind the hero, above enemies' corpses layer; their KO wisp draws in the same slot. All glow via cached `getGlowSprite` blits (the iOS discipline documented at WeaponSystem.js:479–481), no per-frame gradients.
- **HUD snapshot:** `buildUIState` (UIStateBuilder.js:14) gains `base.troop = game.troop.snapshotForUI()` next to `base.abilityCooldowns` (UIStateBuilder.js:109).

### Follow + engage AI (budgeted)
- Spring-follow to an offset slot beside the player: target point = player ± 120px (slot 0 left, slot 1 right when Second Perch is owned). Speed 430 base, ×1.6 catch-up beyond 200px. If distance > 320px (leash) **or** path-blocked > 2.0s, blink to the player's side with `particles.pickupSparkle` at both ends (the exact teleporter-commit visual, Game.js:2865–2866).
- Targeting: retarget every **0.4s (tunable), staggered per familiar** (familiar i offsets its scan clock by 0.2·i) — one O(E) pass over `this.enemies` picking nearest active enemy within engage range 460px of the *familiar*. At the 180-enemy cap with 2 familiars that is ≤ 2.5 scans/s × 2 × 180 = 900 distance checks per second — noise next to the per-frame all-enemy scans Game already runs (aim scan Game.js:2792, consolidated scan Game.js:3228).
- Fire: when target locked and cooldown elapsed, spawn one bolt **only if** live familiar-tagged projectiles < `FAMILIAR.shotBudget` (20). Count maintained incrementally (decrement when a tagged projectile deactivates during `_updateEnemyScanAndCleanup`'s compact pass, Game.js:3283–3284 — TroopSystem recounts tagged actives once per retarget tick instead of per frame).
- Familiars do **not** collide with enemies (no body-block, no separation cost in `_separateEnemies`, Game.js:2889) — they take damage from overlap but never impede pathing.

### Scaling (deliberately outside the player's multiplier stack)
`familiarDamage = base × (1 + 0.06 × (playerLevel − 1))`, capped at ×3.0 (tunable). Familiars read **only** `player.level` — never `player.damageMul` (capped at 3.5, GameConfig.js:103), passives, or gear — so the troop cannot compound with the capped player stack. Target contribution: ≤25% of player DPS at minute 1, decaying to ~10–12% by minute 10 as the player's build comes online.

## 3. Death / revive rules

- Familiar HP: `60 + 6 × playerLevel` (tunable). Damage sources: enemy **contact** overlap (0.8s i-frames, mirroring `PLAYER.invincibilityDuration`, GameConfig.js:93) and Game-pool hazards (`this.hazards` zones, Game.js:575) at 0.7× — enemy projectiles keep aiming at the player only (EnemyProjectile.update takes `player`, Game.js:2920) and are NOT retargeted; the troop never increases enemy AI cost.
- At 0 HP → **guttered**: body collapses into an ember wisp (cached glow pulse + 3 drifting sparks) planted at the KO spot; a one-time contextual line "Stand close to rekindle Cinder" rides the existing onboarding-pill pattern.
- Revive: player within 110px for a continuous **2.5s** channel → up at 70% HP; otherwise auto-rekindle after **20s** at 50% HP. No run penalty beyond downtime; no permanent death. (tunable: channel 2.5s, auto 20s.)
- HUD chip (§6) dims and shows the countdown ring during KO.

## 4. Element / build synergy

- **Payload parity (works today):** because familiar shots are ordinary Projectiles, Cinder's burns already feed shock-detonation (`SHOCK_CFG.detonateMul`, GameConfig.js:891) from the *player's* shock weapons, burn contagion (Game.js:2356), and Orin's `burnDamageMul` 1.35 (characters.js:68 → read at Game.js:2321) — cross-source combos exist at PR1 with no new rules.
- **Combo table (update 3 dependency):** when KINDLED's authored table lands, familiar-originated procs ride it automatically via the shared payload path; the only Troop-side rule is a source scalar — familiar-triggered combo procs resolve at **0.6× magnitude** (tunable) via the `familiar: true` projectile tag, so a free autonomous ally can't out-proc the player's own build. (Table interface note: as of today no combo-table module exists in src/content/ — see codeCorrections — so this scalar is specified as a parameter the table's proc entry point accepts, to be wired the PR after update 3 merges.)
- **Kindled Bond (new, PR3):** if any owned player weapon shares the active familiar's element (`WEAPONS[w.id].element` over `weaponSystem.owned`, recomputed only on `weaponSystem.version` change — the same cheap invalidation the aura uses, WeaponSystem.js:50–51), the familiar gains cooldown ×0.85 and +25% status strength, and its HUD chip lights an ember ring. Rewards drafting toward your companion's element without forcing it.

## 5. Perf budget (designed in from PR1)

| budget | value | enforcement |
|---|---|---|
| active familiars | 1 (2 with Second Perch) | hard `FAMILIAR.maxActive` clamp in TroopSystem + save validation |
| familiar live shots | 20 (tunable) | hold-fire gate at spawn |
| retarget scans | 2.5/s per familiar, staggered | timer, never per-frame |
| per-frame draw | 1 sprite blit + 1 cached glow + HP ring | no gradients; `reducedEffects` (Game.js:833) drops the wisp/trail glow |
| two-active damage | each familiar ×0.85 dmg | stacking guard (tunable) |
| enemy cap impact | zero | never pushed to `this.enemies` |

## 6. HUD (`UISystem.js` + `UIStateBuilder.js`)

- One **56×56 chip per active familiar**, stacked above the ability-cooldown pips (the `abilityCooldowns` HUD block, UIStateBuilder.js:88–109 feeds it): cropped idle-down face frame, 270° HP arc (reuse `healthColor`, imported at Player.js:55), bond-level dots (1–5), Kindled Bond ember ring when lit.
- KO state: chip grays, countdown ring drains over the 20s auto timer, pulses green while the player stands in channel range.
- Game-over summary gains one line: "CINDER — Bond +N embers" (rendered where `runSummary` fields already draw).

## 7. Acquisition + persistence + perch (menu)

- **New `TROOP` menu tab** appended to `MENU_TABS` (MenuRenderer.js:56–66), staged via `tabUnlocked` (MenuRenderer.js:73) to appear at `stats.runs >= 2` (tunable) with the standard one-time NEW badge.
- Tab layout: a **perch scene** (procedurally drawn branch + the owned familiars idling with blink/tail-wag using their idle frames) rendered by NEW `src/render/PerchScene.js` — deliberately a standalone module taking `(ctx, x, y, w, ownedFamiliars, t)` so update 20's camp composes it unchanged. Below: roster cards (name, element, role, bond level + ember progress bar, cost or ACTIVE toggle).
- **Prices (tunable, `saveSystem.spendCoins`, SaveSystem.js:378):** sleet 2,000 · ash 3,000 · spark 4,500 · bramble 6,000 · Second Perch (maxActive 2) 12,000. Cinder free/granted.
- **Save schema (additive only, `_validate` clamp pattern per SaveSystem.js:192–361; implicit migration per the comment at SaveSystem.js:198–200):**
```js
troop: {
  unlocked: ['cinder'],            // validateIdList seeded with ['cinder'] — every old save gains Cinder
  active:   ['cinder'],            // known ids only, length clamped to 1 (2 iff secondPerch)
  secondPerch: false,              // boolean
  bonds: { cinder: { level: 1, embers: 0 } },  // known ids; level int clamp 1..5; embers int clamp 0..9999
}
```
Version stays 7 (matches how `discoveredRelics` was added fieldwise without a bump, SaveSystem.js:342–344).

## 8. Upgrade paths — Bonds (persistent, per familiar)

Embers banked at run end in `_enterGameOver` (alongside `_bankRunCoins`): **1 ember per 2 minutes the familiar was active (max 15) + 3 per boss defeated while it was up + 2 if it was never knocked out** (all tunable; deliberately time/boss-based so no kill-attribution surgery in the reward pipeline is needed).

| Bond | embers | reward (striker / ash / bramble) |
|---|---|---|
| L2 | 20 | +25% damage / magnet ring +25% / pulse dmg +25% |
| L3 | 60 | element trait: cinder burnDps 3→5 · sleet +1 chill-stack strength · spark chains to 1 extra target at 60% · ash ring 140→200 · bramble radius +30% |
| L4 | 140 | cooldown ×0.8 |
| L5 | 300 | signature: cinder bolt pierce 1 · sleet 10% freeze-proc 0.8s · spark detonateMul +0.5 · ash +5% run `coinMul` · bramble pulse reflects 20% contact damage |

## 9. Art — rig parameter sweep for small bodies (Blender pipeline)

The hero rig's full parameter surface is data (`DEFAULT_PARAMS`, monkey_rig.py:73–114) and `build_rigged_monkey(params, tune)` accepts overrides (monkey_rig.py:576), so the cub is a **parameter sweep, not new geometry**:

```python
CUB_SWEEP = {  # (all tunable)
  'head_r': 10.0, 'head_squash': 0.95, 'ear_r': 6.0, 'eye_r': 3.9, 'glint_r': 1.7,   # bigger ears/eyes = baby read
  'body_rx': 5.3, 'body_ry': 4.7, 'body_rz': 5.6, 'body_z': 8.2,
  'arm_r': 1.8, 'arm_x': 5.6, 'arm_top_z': 10.6, 'arm_bot_z': 6.2,
  'leg_r': 1.9, 'leg_x': 3.4, 'leg_top_z': 4.4, 'foot_r': 2.4,
  'tail_r': 1.5, 'tail_tuft_r': 2.5, 'tail_pts': <hero pts × 0.8 xy, ×1.15 z curl>,
  # + per-familiar palette (fur/fur_dark/fur_light/face/accent) from familiars.js
}
CUB_TUNE = { 'walk_arm_deg': 36.0, 'cast_stretch': 1.7 }   # scamperier stride, bigger cast reach
```
Key free win: `head_z` is solved from the camera anchor contract, not from the body (monkey_rig.py:243–248, applied at 254–259) — shrinking the body while the head stays on the 16/48 contract line **automatically yields chibi proportions** with feet still on 45/48. The GRIP empty (monkey_rig.py:435–439) exports per-familiar `anchors.json` via `grip_cell_offset` (monkey_rig.py:608–620) so each cub's mini-wand rides its real paw exactly like the hero's HAND table (Player.js:30–49).

Output per familiar: 3 sheets (down/up/side) × 7 columns in `POSE_COLS` order (monkey_rig.py:68–69 == HeroAiSprites.js:23) via a `render_sheets.py` generalization (params/tune/outdir arguments; today it hardcodes the hero — render_sheets.py:129+). In-game draw size `FAMILIAR.spriteSize = 108`px (0.59× the hero's `SPRITE_SIZE = 182`, GameConfig.js:24).

**Fallback ships first (PR1):** NEW `src/assets/FamiliarSprites.js` mirrors the HeroAiSprites layering (HeroAiSprites.js:13–15 "the game always renders"): Blender familiar sheets → **fallback: the existing hero frames palette-tinted (source-atop, the HeroAiSprites.js:66–75 mechanism) and drawn at 108px** — an instantly-shippable "little monkey" with zero new art. Mini-wand prop: reuse `getWeaponProp` (Player.js:18) at scale 0.55 on the carry anchor.

## 10. Onboarding/flavor
First run with Cinder active: one hint pill ("Your troopmate fights beside you — keep each other lit"), riding the existing non-blocking pill system (Game.js:885–888). Familiar plays the blink/tail-wag idle beat on the perch and in-game (idle col 1, the rig's authored blink frame, monkey_rig.py:497–502).

## PR plan

### PR1 — PR1 — Troop core: Cinder joins the wick-keeper

**Goal:** A working, budgeted, procedurally-drawn fire familiar granted to every save: follows, targets, fires real Projectiles through the untouched combat pipeline. Invulnerable placeholder (no KO yet) so the PR is small and independently shippable.

**Files:**
- `src/systems/TroopSystem.js (NEW)`
- `src/entities/Familiar.js (NEW)`
- `src/content/familiars.js (NEW)`
- `src/assets/FamiliarSprites.js (NEW)`
- `src/config/GameConfig.js (FAMILIAR block)`
- `src/core/Game.js (init Game.js:566 area, update phase after Game.js:2621, render before Game.js:3497, arena confine)`
- `src/systems/SaveSystem.js (troop key in defaultData + _validate)`
- `src/systems/UIStateBuilder.js (minimal base.troop)`

**Work:**
- FAMILIARS data (all 5 archetypes' rows; only cinder purchasable-state 'granted')
- spring-follow + leash blink + obstacleSystem.resolveCircle + _confineToArena
- staggered 0.4s retarget scan; fire gate on the 20-shot familiar budget; bolts as new Projectile({element:'fire', burnDps, familiar:true})
- procedural fallback sprite: tinted hero frames at 108px + mini-wand via getWeaponProp scale 0.55
- additive save schema with clamped validation; Cinder seeded into every save's troop.unlocked

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- harness.html?seconds=35&badge=1 → EXC:0 and familiar visible fighting beside the hero in the screenshot
- debug HUD: projectile count stays within budget at a late-run crowd; enemy count unaffected
- adversarial review; squash-merge to main

### PR2 — PR2 — Ember and ash: knockout, revive, HUD chip

**Goal:** The familiar can fall and be rekindled; the HUD tells its story at a glance.

**Files:**
- `src/entities/Familiar.js`
- `src/systems/TroopSystem.js`
- `src/core/Game.js (contact/hazard damage to familiars)`
- `src/systems/UISystem.js (chip)`
- `src/systems/UIStateBuilder.js`
- `src/config/GameConfig.js (HP/revive numbers)`

**Work:**
- HP 60+6/level, contact overlap damage with 0.8s i-frames, hazard-zone damage ×0.7
- guttered state: ember-wisp visual (cached glow, reducedEffects-gated), 2.5s proximity channel → 70% HP, 20s auto → 50%
- 56×56 HUD chip: face frame, HP arc, KO countdown ring, channel pulse
- one-time 'stand close to rekindle' hint pill

**Verify:**
- harness long-run screenshot showing the chip; a debug query (?troopko=1) forces a KO for the KO/revive screenshot states
- EXC:0 with badge=1; node --check; validate-assets exit 0
- adversarial review; squash-merge

### PR3 — PR3 — Bonds: embers, levels, upgrade paths, Kindled Bond

**Goal:** Persistent progression: familiars level across runs and synergize with the player's element draft.

**Files:**
- `src/content/familiars.js (bond tables L2–L5)`
- `src/systems/TroopSystem.js`
- `src/systems/SaveSystem.js (bond accessors + banking clamps)`
- `src/core/Game.js (_enterGameOver ember banking + runSummary line)`
- `src/systems/UISystem.js (game-over Bond line, chip bond dots)`

**Work:**
- ember formula (1 per 2 min active max 15, +3/boss, +2 no-KO) banked at game over
- bond levels applied at TroopSystem construction from save
- Kindled Bond: element match over weaponSystem.owned, recomputed on weaponSystem.version change; cd ×0.85, status +25%
- familiar-source combo scalar parameter (0.6×) reserved for the update-3 table wiring

**Verify:**
- scripted save round-trip: write bonds, reload, assert clamped values; tampered save (level 99, embers -5) loads clean at clamps
- harness EXC:0; game-over screenshot shows the Bond line
- node --check; validate-assets; adversarial review; squash-merge

### PR4 — PR4 — The Perch: roster tab + acquisition

**Goal:** The collection surface: buy, choose, and admire the troop; PerchScene ships as the reusable module update 20 inherits.

**Files:**
- `src/systems/MenuRenderer.js (MENU_TABS + TROOP panel + hotspots)`
- `src/render/PerchScene.js (NEW)`
- `src/core/Game.js (menu actions: buy/select/secondPerch)`
- `src/systems/SaveSystem.js (spend + unlock paths)`
- `src/systems/UIStateBuilder.js (menu troop snapshot)`

**Work:**
- TROOP tab staged at stats.runs>=2 with NEW badge (tabUnlocked pattern)
- PerchScene: procedural branch + idling owned familiars (blink/tail-wag idle frames)
- roster cards: cost/ACTIVE toggle, bond progress, element badge; purchases via spendCoins (2000/3000/4500/6000)
- Second Perch unlock (12000) → maxActive 2 with the ×0.85 two-active damage scalar

**Verify:**
- harness.html?screen=menu&tab=troop screenshot: perch + cards render; EXC:0
- purchase + activate flow exercised via harness pointer script; save reflects it after reload
- node --check; validate-assets; adversarial review; squash-merge

### PR5 — PR5 — Cub rig: Blender familiar sheets + anchors

**Goal:** Bespoke cub-proportioned animated bodies for all five familiars over the intact procedural fallback.

**Files:**
- `tools/blender/familiar_sweep.py (NEW)`
- `tools/blender/render_sheets.py (params/tune/outdir CLI)`
- `src/assets/familiars/*.png + anchors.json (NEW)`
- `src/assets/FamiliarSprites.js (sheet loader over fallback)`
- `ASSET_CREDITS.md / src/assets/credits registry rows`

**Work:**
- CUB_SWEEP params + CUB_TUNE per §9; per-familiar palettes from familiars.js
- render 5 × 3 sheets (7 POSE_COLS columns, 256 cells) + per-familiar GRIP anchors.json
- loader mirrors HeroAiSprites never-reject contract; mini-wand rides real paw anchors
- credit rows so validate-assets stays green

**Verify:**
- render_sheets validation suite exits 0 (feet/bob/head-frac contract checks)
- node tools/validate-assets.js exit 0
- harness screenshot shows sheet-based cubs; temporarily renaming the sheets still renders via fallback (EXC:0 both ways)
- adversarial review; squash-merge

## Data & save changes

**New content/data files:** `src/content/familiars.js` (FAMILIARS roster: 5 archetypes, bond tables L2–L5, prices, palettes; append-only with a documented reserved umbral slot), `src/assets/familiars/{cinder,sleet,spark,ash,bramble}_{down,up,side}.png` + `src/assets/familiars/anchors.json` (PR5, fallback-shielded), credit rows in ASSET_CREDITS.md / credits registry.

**New modules:** `src/systems/TroopSystem.js`, `src/entities/Familiar.js`, `src/assets/FamiliarSprites.js`, `src/render/PerchScene.js`, `tools/blender/familiar_sweep.py`.

**Save schema (additive only, version stays 7, clamp+implicit-migrate per SaveSystem.js:192–361):** one new top-level key `troop: { unlocked: ['cinder'] (validateIdList seeded so every legacy save gains Cinder), active: [ids clamped to known ids, length ≤ 1|2], secondPerch: bool, bonds: { [id]: { level int 1..5, embers int 0..9999 } } }`. No existing key changes; a v7 save with no `troop` loads to defaults.

**Config block (GameConfig.js, NEW `FAMILIAR`):** maxActive 1(+1), spriteSize 108, radius 26, followDist 120, leashDist 320, baseSpeed 430, catchupMul 1.6, engageRange 460, retargetInterval 0.4, shotBudget 20, maxHpBase 60, maxHpPerLevel 6, contactIFrames 0.8, reviveChannel 2.5s @70%, reviveAuto 20s @50%, dmgLevelScale 0.06 cap ×3.0, twoActiveDmgMul 0.85, comboSourceMul 0.6.

**Extended (not forked) existing systems:** Game.js (4 hook sites: init, update phase, render slot, game-over banking), SaveSystem `_validate`, UIStateBuilder/UISystem (chip + menu snapshot), MenuRenderer (MENU_TABS + tab), render_sheets.py (parameterization). WeaponSystem, CollisionSystem, Enemy, Spawner, Projectile: **zero changes** — familiar shots reuse Projectile's existing element-payload fields (Projectile.js:35–38).

## Balance numbers (all tunable)

| knob | start value | rationale |
|---|---|---|
| max active familiars | 1 (2 w/ Second Perch) (tunable) | perf + screen-read; two is the hard ceiling forever |
| familiar shot budget | 20 live tagged projectiles (tunable) | keeps total projectile pressure near today's practical load (no code cap exists — see corrections) |
| retarget cadence | 0.4s, staggered (tunable) | ≤900 dist checks/s at worst case vs per-frame scans Game already runs |
| Cinder dmg / cd / burn | 7 / 1.1s / 3 dps × 2.5s (tunable) | ~25% of minute-1 player DPS; familiar never reads damageMul so decays to ~10–12% by min 10 |
| Sleet dmg / cd | 6 / 1.3s (tunable) | chill utility > raw dmg |
| Spark dmg / cd | 7 / 1.6s (tunable) | detonation (×2.5 burn burst, existing SHOCK_CFG) is the payoff |
| Bramble pulse | 12 dmg / r120 / kb90 / 3.5s (tunable) | breathing room, not a clear button |
| Ash | magnet ring 140px, +0.5 HP/s via healSustained (tunable) | regen rides the CAPS.healPerSecond 14 budget by construction |
| familiar HP | 60 + 6×playerLevel (tunable) | dies to sustained crowd contact, survives grazes |
| revive | channel 2.5s @70% / auto 20s @50% (tunable) | risk-reward dive vs waiting |
| in-run dmg scale | ×(1+0.06/level), cap ×3.0 (tunable) | tracks enemy HP ramp w/o touching player caps |
| two-active scalar | ×0.85 each (tunable) | Second Perch = coverage, not double DPS |
| Kindled Bond | cd ×0.85, status +25% (tunable) | draft nudge, not a lock-in |
| combo source scalar | 0.6× familiar-origin procs (tunable) | free ally can't out-proc the build (wired post-update-3) |
| prices | sleet 2000 · ash 3000 · spark 4500 · bramble 6000 · Second Perch 12000 coins (tunable) | mid-game coin sink between permanent-upgrade tiers |
| embers | 1/2min active (max 15) + 3/boss + 2 no-KO (tunable) | ~8–20 per good run |
| bond thresholds | L2 20 · L3 60 · L4 140 · L5 300 (tunable) | L5 ≈ 20–30 invested runs per familiar |
| sprite size | 108px (vs hero 182, GameConfig.js:24) (tunable) | reads as cub at gameplay zoom |

## Art needs (non-blocking)

- Blender pipeline (non-blocking, PR5): 5 cub familiar bodies via CUB_SWEEP parameter overrides on tools/blender/monkey_rig.py DEFAULT_PARAMS (lines 73–114) + per-familiar palettes; render 3 sheets × 7 POSE_COLS each through a parameterized render_sheets.py; export per-familiar GRIP anchors.json. Ships last; game is fully playable without it.
- Procedural (ships PR1, the permanent fallback): hero frames palette-tinted via the HeroAiSprites source-atop mechanism, drawn at 108px; mini-wand = existing getWeaponProp prop at scale 0.55; KO ember wisp + perch branch drawn with cached glows/flat strokes (no gradients).
- higgsfield (separate session, never blocks): OPTIONAL 5 roster-card portrait busts, nano_banana_pro 2×2 grid recipe in the canonical hi-bit pixel style with palette lock ('NO fire, NO lava' except Cinder accents), credited in ASSET_CREDITS.md; fallback = cropped idle sheet frames. Enemy-style sheets are NOT touched — familiars are hero-side art, so the locked canonical enemy style is unaffected.

## Risks

- PERF: extra entity scans + shots at the 180-enemy cap on mobile. Mitigated from PR1: familiars never join this.enemies, staggered 0.4s retargeting, hard 20-shot budget, ≤2 active, cached-glow-only rendering, reducedEffects strips the wisp/trail glow, and the fire gate holds shots rather than dropping frames.
- SAVES: a malformed/tampered troop key could grant out-of-bounds bonds or 3+ active familiars. Mitigated from PR1: full clamp validation in SaveSystem._validate (known ids only, level 1..5, embers 0..9999, active length ≤ maxActive), additive-only schema, legacy saves default cleanly with Cinder granted — mirrors the relicAttunement hardening precedent (SaveSystem.js:346–358).
- BALANCE: free autonomous DPS stacking on an already-capped player, and familiar kills feeding combo/killHeal. Mitigated: familiar damage reads only player.level (cap ×3.0), never damageMul/passives; two-active ×0.85; combo-source 0.6× scalar; killHeal on familiar kills stays inside the sustained-heal cap (CAPS.healPerSecond, Player.js:333–341) so it cannot become a sustain engine.
- READABILITY/MOBILE: another moving body + bolts near the hero could muddy the swarm read on small screens. Mitigated: 108px cub silhouette distinct from both hero (182) and enemies, familiar bolts at smaller radius/short trail, chip communicates state so the eye needn't track the body, and zero new inputs.

## Uniqueness & boundaries

THE KINDLED TROOP is the only update in the 20 that adds a persistent ALLIED combat entity and the companionship meta around it: a collectible, bond-leveling, revivable little monkey that fights beside you every run. Nothing else on the roadmap gives the player a creature of their own. Sharpest neighbor boundaries: #3 KINDLED owns everything player-CONTROLLED (ults, aimed blink, Focus, the combo table itself — we only consume the table and add a source scalar, never author rows); #9 WAYLIGHT owns caged-monkey rescues — we ship the TroopSystem and its slot model, Waylight implements the temporary-join event and its POI placement (we add no world events, no _placeStructures work); #13 LAST HEARTH owns familiars-as-hearth-defenders — we deliberately add no mode logic, defense stances, or station-keeping AI; #20 HEARTHHOLD owns the camp — we ship PerchScene as a composable module and stop there (no trophies, no decor shop, no menu-backdrop takeover); #10 owns new playable HEROES (full 182px hero bodies, signatures, quest chains) — familiars are non-playable cubs with no character-select presence; #8 GLOAMCALL may append an umbral familiar into our append-only roster — we reserve the slot and pre-implement nothing umbral.

## Roadmap corrections found while grounding

- The roadmap's standing '~220 projectiles' perf cap is NOT an enforced code cap: the 220 in GameConfig.js:1415 is GFX.particles.max (the preallocated particle pool), and this.projectiles (Game.js:571) is bounded only by weapon design. Consequence folded into the spec: the Troop ships its own explicit familiar-shot budget (20) instead of riding a nonexistent gate. The 180-enemy half of the constraint IS real: maxEnemyCap: 180 at GameConfig.js:1136, with per-wave maxAlive topping at ~145 (GameConfig.js:1048).
- The 'element combo table' this update synergizes with (dep #3 KINDLED) does not exist in code yet — verified by grep: today's only cross-element interactions are SHOCK_CFG.detonateMul 2.5 (GameConfig.js:889–891), burn contagion (Game.js:2356+), and stacking frost chill (GameConfig.js:880–884). The spec therefore integrates by payload parity (familiar shots are ordinary Projectiles, Projectile.js:35–38) so it inherits whatever update 3 authors, and defers the 0.6× familiar-source scalar wiring to after update 3 merges. Not a roadmap contradiction — the dependency just hasn't shipped — but the spec cannot cite a table module today.
- Verified claims that held: the rig parameter sweep surface exists exactly as implied (DEFAULT_PARAMS monkey_rig.py:73–114, build_rigged_monkey(params, tune) monkey_rig.py:576, and head_z solved from the camera contract at monkey_rig.py:254–259 — which is what makes chibi proportions a pure sweep); the perch/roster UI groundwork claim is feasible via the MENU_TABS registry + tabUnlocked staging (MenuRenderer.js:56–66, 73+); the owned-weapons model and its version-invalidation cache exist as described (WeaponSystem.js:46–59).

## Binding cross-spec rulings affecting this update

- **[#5 THE KINDLED TROOP vs #8 GLOAMCALL]** #5's familiars.js documents "a reserved umbral slot" (mirroring #3's reserved combo row), but #8 — the sole owner of all umbral content — never claims an umbral familiar; the reservation is dangling with no assigned builder anywhere in #2–#17.
  **RULING:** #8 owns all umbral content. Either #8 PR3 (Gloam Patron content) fills the sixth familiar slot as an append-only familiars.js row consuming #5's archetype contract, or the reservation is explicitly marked "deferred past update 17" in #5's spec. #5 must not ship a sixth familiar itself, and the slot must not block #5's roster UI (render 5 + one locked silhouette at most).
