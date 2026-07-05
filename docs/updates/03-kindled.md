# Update #3: KINDLED — The Waking Hand

*Era II — The Waking Hand*

**Value verdict (ADDS):** Premise verified: src/core/Input.js:7-12 exposes exactly one verb (getMovement). Adding aim, dodge-blink, targeting, and manual ults is the single largest change to what the game IS on the whole roadmap — agency did not exist before this. The Rites/Attunement/Rite Trial wrapper leans on the proven dailyRoad pattern rather than reinventing it. Nothing here is re-skin; removal would be instantly felt by every player.

## What it adds

EMBERWAKE today is a pure auto-battler: the player only steers (Input.getMovement is the ONLY input verb — src/core/Input.js:7-12). KINDLED gives the game hands: a manual Kindle meter that releases one of six hero-specific Grand Signature ults you aim yourself in slowed Focus Time, a universal aimed blink with i-frames, tap/cycle Focus targeting that overrides the nearest-enemy autopilot, and an authored element combo table that makes fire/frost/shock cross-react. It is wrapped in per-hero Rites (mastery quests), a Hero Attunement coin sink, a daily hero-locked Rite Trial with an Emberglass share card, and a touch scheme that makes all of it thumb-native.

## Design spec

# KINDLED — The Waking Hand: Implementation Spec

## 0. Ground truth (verified in code)

- **The game has exactly one input verb.** `Input.getMovement()` (src/core/Input.js:7-12) merges keyboard WASD (src/core/KeyboardInput.js:30-43) and the left-half-only touch joystick (`pos.x <= INTERNAL_WIDTH / 2` — src/core/TouchJoystick.js:79). Everything else is automatic: weapons self-fire (src/systems/WeaponSystem.js:167-180), the held wand auto-aims at the nearest active enemy (src/core/Game.js:2790-2804), abilities like Shadow Dash trigger themselves on cooldown (src/content/weapons.js:1527-1544).
- **The blink render pipeline already exists and is dormant.** `Player.dashFx` afterimage smear + stretch (src/entities/Player.js:180, 495-513, 523-526) is fully implemented, but NOTHING sets `dashFx` anymore — Shadow Dash was reworked into a speed surge (src/content/weapons.js:781-796, 1523-1544). The aimed blink revives this exact renderer at zero art cost.
- **Elements are 3 real status channels, not 5.** Weapon `element` tags are fire ×16, frost ×6, shock ×11 (src/content/weapons.js). Statuses: burn DoT (Enemy.js:362-377, ticked by Game's status pass), chill stacks + hard freeze (Enemy.js:335-352, folded at 386-392), shock damage-amp (weapons.js:1136 `shockStrike`). One cross-element combo already exists: shock detonates burn at `SHOCK_CFG.detonateMul = 2.5` (src/config/GameConfig.js:889-891). The combo table formalizes this into data.
- **Keystone flag discipline** (the pattern this update must follow): recipe-gated grants mutate existing player fields or set ONE flag read at exactly ONE existing hook — `ks_conflagration`/`ks_overcharge` read only inside `shockStrike` (weapons.js:1140,1151), `ks_aegis` read only in `Player.takeDamage` (Player.js:224). No new per-frame scans (src/content/keystones.js:8-14). Verified: holds.
- **Save migration is implicit** — missing keys keep defaults (src/systems/SaveSystem.js:200-203); numeric `stats` auto-validate via the keys loop (209-214); per-id map validation pattern is `pactMastery` (333-340); daily best-of-day pattern is `dailyRoad` (298-304, 689-719); the coin-sink ladder pattern is `attuneRelic` (417-428).
- **Kill accounting single point:** `_resolveCombat` merges all `killed` arrays and bumps `this.kills` (src/core/Game.js:3001, 3018).
- **Daily determinism pattern:** `getDailySetup(day)` — local mulberry32, distinct salt, setup-only determinism, no seeded sim (src/content/dailyRoad.js:16-41). The daily Rite Trial copies this exactly.

## 1. The Kindle meter (the ult economy)

**New config block `KINDLE` in src/config/GameConfig.js** (all tunable):

```js
export const KINDLE = {
  max: 100,                 // meter units; ult costs the full bar
  perKill: 1.2,             // trash kill
  perEliteKill: 6,          // elite kill bonus (on top of perKill)
  perBossKill: 25,
  perBossHitPct: 0.02,      // meter per 1% boss HP dealt (bosses aren't kill-farms)
  startFill: 25,            // a run starts a quarter-lit so the first ult lands ~min 2
  ultCost: 100,
  focusTimeScale: 0.30,     // world dt multiplier while aiming
  playerAimSpeedMul: 0.60,  // player move speed while aiming
  focusTimeMax: 2.5,        // s of held aim before auto-fire (no infinite stall)
  fizzleRefund: 100,        // cancel (tap pause / release inside deadzone) refunds all
};
```

**New module `src/systems/KindleSystem.js`** owns: `fill` (0..max), `aiming` (null or `{ age, angle }`), `ultActive` (null or per-ult transient state), and returns `{ hits, killed }` from its update so Game merges it into `_resolveCombat` exactly like `weaponResult` (Game.js:2632, 3001). It is created in `_initRunState` (Game.js:596-734) so every run/restart resets it — same lifecycle as `weaponSystem` (Game.js:614).

**Charge hooks (2 total, no per-frame scan):**
1. In `_resolveCombat` where kills are already counted (Game.js:3018): `kindle.onKills(allKilled)` — reads `e.elite`/`e.boss` per corpse.
2. In the boss-damage application (same hits loop): `kindle.onBossDamage(fracDealt)`.

**Expected pacing** (tunable targets): mid-run kill rate ~45/min → ~54 meter/min from trash + elites ≈ **one ult every 80–110s**; a boss fight grants ~2 + kill 25 → roughly one ult per boss. `startFill: 25` puts the first ult around the 2-minute mark, inside the first-minute-redesign swarm (roadmap update 1) but after the tutorial beats.

**Activation & Focus Time:**
- Keyboard: **hold KeyQ** to aim (add `'KeyQ'`, `'Tab'`, `'ShiftLeft'` to `GAME_KEYS` — src/core/KeyboardInput.js:1-5 — so they preventDefault). While held and `fill >= ultCost`, Game sets `kindle.aiming`; the gameplay step multiplies world `dt` by `focusTimeScale` for enemies/projectiles/spawner/hazards but NOT for UI clocks (implemented at the single point in `Game.update` where the gameplay sub-steps receive dt, gated exactly like the existing overlay freezes at Game.js:2578-2602). Release fires along the aim angle; `focusTimeMax` auto-fires.
- **Aim source:** while aiming, if `input.getMovement()` is non-zero, `aimAngle = atan2(move.y, move.x)`; otherwise it holds the last auto-aim angle from Game.js:2798-2803. This deliberately reuses the movement vector as the aim stick — identical semantics on WASD, joystick, and (later) gamepad, and it needs no new mouse plumbing.
- Blocked exactly where pause is blocked: never while `upgradeChoices | chestReward | altar | paused | gameOver` (the gate pattern at Game.js:281-283).
- HUD: `buildUIState` (src/systems/UIStateBuilder.js:14) gains `base.kindle = { fill, max, ready, ultName, ultColor, aiming }`; UISystem draws a wand-shaped meter bar directly above the existing ability cooldown pips (the pips snapshot is UIStateBuilder.js:92-109), pulsing at full. While aiming: a world-space aim arrow + the ult's ground template (ring/lane/cone) drawn from `kindle.aiming.angle`, plus a subtle screen vignette so Focus Time reads.

## 2. The six Grand Signature ults

**New data file `src/content/signatures.js`**: one def per hero id (`CHARACTERS` — src/content/characters.js:25-99), shape `{ id, heroId, name, blurb, aimKind: 'ring'|'lane'|'self'|'line'|'cone', color, fire(game, angle) → { hits, killed } }`. Each `fire()` is a single O(enemies) pass writing into the same `hits`/`killed` arrays `_resolveCombat` consumes — damage, statuses, and rewards all ride the existing pipeline (burn via `Enemy.applyBurn` Enemy.js:362, chill via `applyChill` Enemy.js:335-346, amp via `shockStrike` weapons.js:1136). All damage scales with `player.damageMul` so meta upgrades/passives keep mattering. Every number below is (tunable).

| Hero (signature — characters.js line) | Ult | Aim | Mechanics |
|---|---|---|---|
| **Pyra** (Wellspring — :31) | **Emberwake Nova** | ring | THE hook. An aimed ignition point at up to 480px along the aim; a ring expands 0→900px over 0.9s. 260 dmg in the ring band (120px wide), stamps burn 40 dps × 3s, 140px knockback from the center. Heals Pyra 10 HP per 10 enemies hit, routed through `healSustained` (Player.js:333-341) so the cap holds. |
| **Sylphine** (Windfall — :42-43) | **Zephyr Windfall** | lane | A 340px-wide, 1100px-long gale along the aim: 190 dmg, shoves enemies 220px down-lane. For 4s after, kills anywhere pay 2× coin drops (a timer flag read at the existing coin-drop roll — one hook). |
| **Gruk** (Unbroken — :55-56) | **Unbroken Bulwark** | self | Ground slam: 420px radius, 240 dmg, 1.2s invincibility (`invincibleTimer` — the field takeDamage already gates on, Player.js:219,236), leaves a 6s thorn ring (radius 300) dealing 20 dps via the existing Game-owned hazards pool (the `delayedZone` pattern, Game.js:2832-2836, new kind `'thornRing'` that damages ENEMIES). |
| **Orin** (Embermind — :68-69) | **Twin Cataclysm** | line | 5 detonations spaced 180px along the aim, alternating fire (90 dmg + burn 35 dps × 3s) and frost (70 dmg + 3 chill stacks + 25% freeze 1.0s). Purpose-built to fire the element combo table (§3) on the overlaps — the ult that teaches combos. |
| **Kael** (Last Light — :80-81) | **Pyre of the Brink** | self | Sacrifices 15% of CURRENT HP (floored so it never drops below 10% of maxHp — never lethal). Nova radius 520 + 4px per 1% missing HP; dmg 200 × (1 + 1.5 × missingHpFrac). 5s afterglow: +0.25 `lowHpDamageBonus` (the field powerRoll already reads — Player.js:159-161). |
| **Vesper** (Executioner — :92-93) | **Deathmark** | cone | Marks up to 8 enemies in a 70° cone, 750px range (elites/bosses prioritized). After 0.6s, each mark detonates as a guaranteed crit: 150 × `critMul` (Player.js:161). Each marked KILL refunds 4 Kindle. |

**VFX discipline:** all six draw through the existing cached-glow effect vocabulary — `drawPulse`/`drawBlast` rings (WeaponSystem.js:346-400, 614-634) + `getGlowSprite` blits, NO per-frame `createRadialGradient` (the iOS rule stated at WeaponSystem.js:479-481). Particle burst per ult capped at 40. Ult sound: one new procedural AudioSystem cue per aimKind (5 cues), not per hero.

## 3. Element combo table (with the reserved umbral row)

**New data file `src/content/elements.js`** — the ONE authored cross-element source of truth:

```js
export const COMBO_TABLE = {
  //            status present on target →
  // incoming ↓   burn                    chill/freeze               shockStacks
  fire:  { chill: SHATTER, shock: null },
  frost: { burn: null,     shock: BRITTLE },
  shock: { burn: DETONATE /* migrated: 2.5×, GameConfig.js:891 */ },
  umbral: { reserved: true },   // update 8 (GLOAMCALL) fills this row — DO NOT implement
};
```

- **DETONATE (shock→burning)** — *migration, not a change*: the existing `SHOCK_CFG.detonateMul 2.5` burn-consume inside `shockStrike` (weapons.js:1136-1160) moves behind the table lookup; behavior byte-identical at ship.
- **SHATTER (fire→chilled)**: a fire hit on a target with `chillStacks ≥ 2` (Enemy.js:344) or `freezeTimer > 0` (Enemy.js:349-352) bursts for 1.8× the triggering hit (2.6× if frozen), then clears chill/freeze. Cooldown latch per enemy: 1.5s (`e._comboCd`) so pulse weapons can't machine-gun it.
- **BRITTLE (frost→shocked)**: a frost hit on a target with ≥2 shock stacks adds +1 chill stack beyond the normal stamp and +10% freeze proc (0.8s). Same 1.5s per-enemy latch.
- **umbral row**: present in the data with `reserved: true`; a unit-style assertion in the combo apply helper throws in DEV_MODE if anything tries to resolve it — the contract slot GLOAMCALL (ROADMAP.md:68-73) slots into with zero table surgery.
- **Hook discipline (keystone pattern):** one exported `applyCombo(target, incomingElement, hitDamage, ctx)` called from exactly the three existing stamp sites — the burn stamp site, the chill stamp site, and inside `shockStrike` — no new per-frame scans. Combo procs emit a small colored flash via the existing effects pool + a "SHATTER!"-style damage-number tint so the system is legible.
- **HUD:** the level-up overlay's element chips (weapons already expose `element` in `snapshotForUI` — WeaponSystem.js:271) get a one-line combo hint when the draft offers a weapon whose element completes a pair you own — computed like `keystoneBreadcrumbs` (keystones.js:144-156), only during a draft.

## 4. Aimed blink

- **New config `BLINK`**: `{ distance: 240, cooldown: 6.0, iframes: 0.25, minGap: 24 }` (all tunable). 240px < `AUTO_AIM_RANGE` 620 (WeaponSystem.js:29) so a blink never outruns your own targeting.
- **Universal, from run 1** — this is the agency update's dodge verb, not a draft pickup. Keyboard: **Space** (already in `GAME_KEYS` with preventDefault — KeyboardInput.js:4; unused during live gameplay — the keydown handler only consumes Space for overlays, Game.js:287-318). Direction = current movement vector, else facing.
- **Placement safety:** step the destination back in `minGap` increments while `obstacleSystem.segmentBlocked(from, to)` (the exact helper Shadow Dash used for its old blink — WeaponSystem.js:141-143), then `resolveCircle` (Game.js:2760-2761 pattern) and `_confineToArena` (Game.js:2764) so a blink can never leave a sealed boss ring.
- **Feel:** sets `player.invincibleTimer = 0.25` and **revives the orphaned `dashFx`** smear (`{ fromX, fromY, toX, toY, age: 0, dur: 0.28 }` — the renderer at Player.js:495-513 consumes it unmodified). Audio: existing `audio.dash()` cue (weapons.js:1535).
- **Shadow Dash the ability keeps its speed-surge identity** (weapons.js:781-796) — it stacks WITH blink as sustained mobility vs. the blink's instant dodge; its description is untouched.
- Blink lives on `KindleSystem` (cooldown state) so `_initRunState` resets it; cooldown pip joins the existing `abilityCooldowns` HUD row (UIStateBuilder.js:92-109) as a synthetic entry.

## 5. Focus targeting

- `game.focusTarget` (enemy ref or null), reset in `_initRunState`. While set, active, and within 1.3× `AUTO_AIM_RANGE`, the wand-aim loop (Game.js:2791-2804) skips the nearest-scan and aims at it; `WeaponSystem.update`'s ctx (WeaponSystem.js:154-166) gains `focus`, and the shared nearest-target helper in content/weapons.js prefers `ctx.focus` when it passes the weapon's own `inView` test — so single-target weapons concentrate fire but radius/orbit weapons are untouched.
- Acquire: **Tab** cycles nearest → nearest elite → boss → clear (keyboard); tap-an-enemy on touch (§7). Auto-clear when the target dies or stays out of range 2s.
- Tell: a thin ember reticle ring (cached glow, no gradient) over the focused enemy + a 1.5px accent on its HP bar. Zero damage changes in this update — Focus is pure targeting agency (the +8% focused-damage perk arrives only at Hero Attunement Lv4, §6).

## 6. Rites & Hero Attunement (the meta layer)

**Rites** — new data file `src/content/rites.js`: 3 mastery quests per hero (18 defs), each `{ id, heroId, name, desc, stat, goal }`, progress accumulated across runs. Examples (goals tunable): Pyra — *Rite of the Wellspring* (heal 2,000 HP lifetime via sustained heals), *Rite of the Nova* (hit 50+ enemies with one Emberwake Nova), *Rite of Vigil* (survive 18:00 in one run). Kael — *Rite of the Brink* (release Pyre of the Brink below 20% HP ×10). Vesper — *Rite of the Mark* (kill 6+ of 8 marks in one Deathmark ×5). Progress hooks ride existing single points: the ult `fire()` return, the sustained-heal return (Player.js:333-341), and run-end summary fields.

**Hero Attunement** — the per-hero coin sink, deliberately parallel to Relic Attunement (`attuneRelic` — SaveSystem.js:417-428; cost/max co-located with content, relics.js pattern cited at SaveSystem.js:122-126). Levels 0..5 per hero; cost `400 × 1.6^level` coins (400/640/1024/1638/2621 ≈ 6.3k total per hero, tunable). Rite-gated rungs: Lv3 needs Rite I done, Lv4 Rite II, Lv5 Rite III — coins alone can't buy mastery. Effects (all read at existing hooks): Lv1 +10% Kindle gain · Lv2 blink cooldown −0.5s · Lv3 ult damage +12% · Lv4 focused target takes +8% (read in the one hit-apply point) · Lv5 ult Kindle cost 100→85 + an ult VFX ember-crown flourish. Menu: a "RITES" panel inside the existing character tab (MenuRenderer hotspot registry) showing the 3 rites + the attunement ladder.

## 7. Touch control scheme (touch-first inputs)

**New module `src/core/TouchButtons.js`**, composed into `Input` beside keyboard/touch in src/main.js:90-92. The joystick claims only the left half (TouchJoystick.js:79) — the right half is free; verified no gameplay-touch conflict: gameplay `touchstart` today only checks the pause/DBG buttons (Game.js:498-500).

- **BLINK button**: 68px-radius circle at bottom-right, inset from `renderer.safeArea` exactly like `_safeOrigin` does (TouchJoystick.js:60-71). Tap = blink along the joystick vector (or facing). Shows the cooldown sweep.
- **KINDLE button**: 92px-radius above-left of blink; its rim IS the meter (fill arc). When full: hold-and-drag off it = Focus-Time aiming with a world-space arrow (drag direction = aim; identical semantics to the held-Q movement-vector aim); release fires; release inside a 30px deadzone or drag onto the button = cancel/refund. Quick tap (<150ms) fires along the current auto-aim.
- **Focus tap**: a tap on the right half not on a button ray-casts (clientToInternal + camera offset) to the nearest enemy within 90px of the tap point → toggles `focusTarget`.
- Buttons render only when `supported` (the TouchJoystick.js:16 probe) via UISystem's overlay pass; enable/disable rides the same gate as the joystick (`_updateJoystickEnabled`, Game.js:1637-1639). Multi-touch: joystick keeps its `touchId` (TouchJoystick.js:81), buttons track their own — move + aim + blink simultaneously works.
- Rationale: Focus-Time (0.30× world speed) is the touch-aim equalizer — the slow-mo window is what makes thumb-aiming an ult feel as precise as keyboard.

## 8. Daily Rite Trial + share card

- **New `src/content/riteTrial.js`**: `getRiteTrialSetup(day)` — local mulberry32 with a distinct salt (`0x4b494e44`), same shape discipline as `getDailySetup` (dailyRoad.js:29-41): picks **hero of the day** (from `CHARACTER_IDS`), map, ONE Trial modifier, and the day's scoring rule. Score = `kills + 60×ultsReleased + 12×comboProcs + 250×bossesDefeated` (tunable) — Kindle-centric by construction. Setup-deterministic only, NOT a seeded sim (that's update 17's job — same honesty note as dailyRoad.js:6-8).
- Launch: a "RITE TRIAL" button beside DAILY ROAD on the Play tab, dispatching through `_menuAction` (the `startDaily` pattern — Game.js:1483-1484); the hero override is session-local like `_dailyMapOverride` (Game.js:180-182) and never touches `selectedCharacter`.
- Persistence: `riteTrial: { day, best, prevBest }` in the save, mirroring `dailyRoad` validation + rollover exactly (SaveSystem.js:298-304, 689-704).
- **Share card**: on trial end, mint "RITE OF KAEL — score 4,812 — Day 213" through the **Emberglass compositor from update 2**. Verified: no compositor exists in src yet (see codeCorrections) — so the card path uses a guarded `import('
../systems/CardCompositor.js').catch(...)` dynamic import with a clipboard-text fallback (`navigator.clipboard.writeText` of the score line), so PR5 ships and works even if EMBERGLASS slips.

## 9. What is NEW vs REUSED

**NEW modules/files:** `src/systems/KindleSystem.js`, `src/core/TouchButtons.js`, `src/content/signatures.js`, `src/content/elements.js`, `src/content/rites.js`, `src/content/riteTrial.js`. **NEW config blocks:** `KINDLE`, `BLINK` in GameConfig.js. **NEW save keys (all additive):** `heroAttunement{}`, `rites{}`, `riteTrial{}`, stats `ultsReleased`/`comboProcs`/`riteTrialBest` (numeric — auto-validated by the stats loop, SaveSystem.js:209-214).

**REUSED/extended:** the `_resolveCombat` hit pipeline (Game.js:3001-3018), the hazards pool (Game.js:2832), `dashFx` renderer (Player.js:495-513), `invincibleTimer`/`healSustained`/`lowHpDamageBonus`/`critMul` player fields, `segmentBlocked`/`resolveCircle`/`_confineToArena`, the effects-pool drawers (WeaponSystem.js:346-634), `abilityCooldowns` HUD pips (UIStateBuilder.js:92-109), the daily-day plumbing (`currentDayNumber`, UIStateBuilder.js:51), the attunement cost pattern (SaveSystem.js:417-428), the mulberry32 daily pattern (dailyRoad.js:16-41), and the menu hotspot/action dispatch (Game.js:470-475).

## PR plan

### PR1 — PR1 — Kindle meter core + aimed blink (keyboard)

**Goal:** The resource economy and the dodge verb, shippable alone: meter fills from kills, HUD shows it, Space blinks with i-frames and the revived dashFx smear. Ult release lands in PR3 (meter caps and pulses 'READY' until then — harmless).

**Files:**
- `src/systems/KindleSystem.js (NEW)`
- `src/config/GameConfig.js (KINDLE + BLINK blocks)`
- `src/core/Game.js (_initRunState create/reset; _resolveCombat charge hook; keydown Space→blink; blink placement via obstacleSystem + _confineToArena)`
- `src/core/KeyboardInput.js (add KeyQ/Tab to GAME_KEYS)`
- `src/entities/Player.js (no logic change — dashFx consumed as-is; comment update at :180)`
- `src/systems/UIStateBuilder.js (base.kindle + blink cooldown pip)`
- `src/systems/UISystem.js (meter bar above ability pips)`

**Work:**
- KindleSystem: fill/charge/cooldown state, onKills/onBossDamage, blink(from, dirVector) with segmentBlocked step-back and arena confinement
- Wire charge at Game.js:3018 kill merge; wire blink key in the gameplay keydown branch behind the overlay gate (Game.js:281-283 pattern)
- Set player.invincibleTimer=0.25 and player.dashFx on blink; audio.dash() cue
- HUD meter + blink pip; DEV_MODE debug key to grant +50 Kindle for testing

**Verify:**
- node --check on all touched files
- node tools/validate-assets.js exit 0
- harness.html?badge=1&seconds=35 → EXC:0; screenshot shows the Kindle bar
- dev-run: blink into a wall face and into a boss arena edge — player never clips or escapes (segmentBlocked + _confineToArena paths)
- restart mid-run → meter and cooldowns reset (KindleSystem rebuilt in _initRunState)

### PR2 — PR2 — Element combo table with reserved umbral row

**Goal:** Cross-element reactions as authored data: shock-detonate migrated behind the table byte-identically, SHATTER and BRITTLE added, umbral row reserved and asserted inert.

**Files:**
- `src/content/elements.js (NEW)`
- `src/content/weapons.js (shockStrike reads DETONATE from the table; applyCombo calls at the burn/chill stamp sites)`
- `src/config/GameConfig.js (SHOCK_CFG.detonateMul moves to the table; re-export kept for compat)`
- `src/entities/Enemy.js (per-enemy _comboCd latch field)`
- `src/systems/UIStateBuilder.js + src/systems/UISystem.js (draft-time combo hint line)`

**Work:**
- Author COMBO_TABLE with DETONATE (2.5×, migrated), SHATTER (1.8×/2.6× frozen, consumes chill, 1.5s latch), BRITTLE (+1 chill stack, +10% freeze 0.8s, 1.5s latch), umbral { reserved: true } + DEV_MODE throw on resolve
- applyCombo() called from exactly the three existing stamp sites — no new scans
- Combo flash via effects pool + tinted damage number; draft hint computed only while upgradeChoices is up (keystoneBreadcrumbs pattern)

**Verify:**
- node --check; validate-assets exit 0; harness EXC:0
- regression: a shock hit on a burning enemy deals the identical detonate burst before/after the migration (log-compare in a dev run)
- dev-run with frost+fire loadout: SHATTER numbers appear, latch prevents >1 proc per 1.5s per enemy
- grep confirms zero resolution paths into the umbral row

### PR3 — PR3 — Six Grand Signature ults + Focus Time aiming + Focus targeting

**Goal:** The headline: hold-Q slow-mo aiming, six hero ults firing through the standard hit pipeline, Tab/target-lock Focus.

**Files:**
- `src/content/signatures.js (NEW)`
- `src/systems/KindleSystem.js (aiming state, focusTimeMax auto-fire, ult dispatch)`
- `src/core/Game.js (dt scaling while aiming; focusTarget field + aim-loop override at 2791-2804; hits/killed merge from kindle into _resolveCombat; hazards 'thornRing' kind)`
- `src/systems/WeaponSystem.js (ctx.focus)`
- `src/content/weapons.js (nearest-target helper prefers ctx.focus)`
- `src/systems/UIStateBuilder.js + UISystem.js (aim arrow/template, focus reticle, vignette)`
- `src/systems/AudioSystem.js (5 aimKind release cues)`

**Work:**
- Implement all six fire() functions per the spec table, each a single O(enemies) pass writing hits/killed
- Focus Time: world-dt ×0.30 while aiming, player ×0.60, 2.5s auto-fire, cancel refund
- Focus: Tab cycle + auto-clear rules; Vesper/elite prioritization uses it
- Kael HP-sacrifice floor; Pyra heal via healSustained; Sylphine 4s coin-flag read at the coin-drop roll; Gruk thornRing hazard

**Verify:**
- node --check; validate-assets; harness EXC:0 with ?seconds=35
- dev balance pass: grant Kindle, fire each of the 6 ults at a 150+ enemy field at minute 20 (debug jump keys, Game.js:274-277) — frame time stays <16ms (perf HUD)
- boss fight: ult damage lands, meter charges from boss damage, Focus locks the boss
- pause/level-up during aim: aim cancels cleanly, refund applied, no dt leak

### PR4 — PR4 — Touch control scheme (blink + Kindle buttons, drag-aim, Focus tap)

**Goal:** Thumb-native parity: every PR1-3 verb reachable on touch without occluding the play space.

**Files:**
- `src/core/TouchButtons.js (NEW)`
- `src/main.js (compose into Input)`
- `src/core/Input.js (expose button states)`
- `src/core/Game.js (touchstart dispatch: buttons before pause/DBG in the gameplay branch at 498-500; focus-tap raycast)`
- `src/systems/UISystem.js (button rendering, meter-rim arc, drag-aim arrow)`
- `src/core/TouchJoystick.js (no behavior change — verified left-half claim at :79)`

**Work:**
- Safe-area-inset button layout (TouchJoystick._safeOrigin pattern); multi-touch ids independent of the joystick's
- KINDLE button: tap-fire / hold-drag aim (drag vector = aim) / deadzone cancel; BLINK button tap with cooldown sweep
- Focus tap: right-half tap → nearest enemy within 90px of tap in world space; toggle/clear rules
- Buttons only when touch supported; disabled with the joystick gate (_updateJoystickEnabled)

**Verify:**
- node --check; validate-assets; harness EXC:0 (buttons hidden headless — no touch support)
- device/emulated-touch pass: move + drag-aim + release fires while joystick held (multi-touch); blink during movement; focus tap never steals joystick touches
- portrait/rotation mid-drag: TouchJoystick.reset() pattern honored — no stuck aim
- pause button and DBG hotspot still reachable (dispatch order)

### PR5 — PR5 — Rites, Hero Attunement, daily Rite Trial + share card

**Goal:** The meta wrapper: 18 Rites, the per-hero coin ladder, the hero-locked daily with best-of-day and an Emberglass card (graceful fallback if update 2 slipped).

**Files:**
- `src/content/rites.js (NEW)`
- `src/content/riteTrial.js (NEW)`
- `src/systems/SaveSystem.js (heroAttunement/rites/riteTrial validation + accessors; stats keys; version 7→8)`
- `src/core/Game.js (rite progress hooks; riteTrial launch/override/banking like dailyMode; card mint at trial end)`
- `src/systems/KindleSystem.js (attunement effects: gain/cooldown/cost/damage reads)`
- `src/systems/MenuRenderer.js (RITES panel on character tab; RITE TRIAL button on Play tab)`
- `src/systems/UIStateBuilder.js (menu snapshot fields)`

**Work:**
- 18 rite defs + progress accumulation at run end (single summary pass, no per-frame cost)
- attuneHero() mirroring attuneRelic (cost 400×1.6^lvl, rite-gated rungs 3/4/5); validation clamps like pactMastery + relicAttunement (unknown ids dropped, over-cap clamped)
- getRiteTrialSetup(day) with distinct salt; session-local hero override (_dailyMapOverride pattern); score formula; riteTrial{day,best,prevBest} rollover
- Share card via guarded dynamic import of the update-2 compositor; clipboard-text fallback

**Verify:**
- node --check; validate-assets; harness EXC:0; harness ?screen=menu&tab=character shows the RITES panel
- save round-trip: load a pre-update save string → defaults appear, nothing lost; tampered heroAttunement {bogus: 99} → dropped/clamped
- two consecutive UTC days (clock-mock day param): riteTrial best resets, prevBest carries
- trial run end mints card (or clipboard fallback when compositor absent) without throwing

## Data & save changes

**New content/data files:** `src/content/signatures.js` (6 Grand Signature ult defs keyed by hero id), `src/content/elements.js` (COMBO_TABLE: fire/frost/shock rows + `umbral: { reserved: true }` for update 8), `src/content/rites.js` (18 rite defs, 3/hero), `src/content/riteTrial.js` (deterministic daily setup, salt 0x4b494e44). **New system/core modules:** `src/systems/KindleSystem.js`, `src/core/TouchButtons.js`.

**New GameConfig.js blocks:** `KINDLE { max, perKill, perEliteKill, perBossKill, perBossHitPct, startFill, ultCost, focusTimeScale, playerAimSpeedMul, focusTimeMax, fizzleRefund }` and `BLINK { distance, cooldown, iframes, minGap }`. `SHOCK_CFG.detonateMul` migrates into COMBO_TABLE (compat re-export kept one release).

**Save schema (ALL additive, implicit-migration per SaveSystem.js:200-203):**
- `heroAttunement: { [charId]: level 0..5 }` — validated like `relicAttunement` (SaveSystem.js:350-359): known hero ids only, clamped to max.
- `rites: { [charId]: { [riteId]: progress int ≥ 0 } }` — validated like `pactMastery` (SaveSystem.js:333-340).
- `riteTrial: { day, best, prevBest }` — mirrors `dailyRoad` (SaveSystem.js:298-304) rollover semantics.
- `stats` additions (numeric → auto-validated by the existing keys loop, SaveSystem.js:209-214): `ultsReleased`, `comboProcs`, `riteTrialBest`, `blinks`.
- `version: 7 → 8` (bookkeeping only; the field is written-never-read per the roadmap punch list, ROADMAP.md:180 — migration stays implicit).

No changes to cosmetics/gear/battlePass shapes. No new asset-credit rows required at ship (all PR1–5 visuals are procedural); any later AI ult sigils add `ASSET_CREDITS.md` rows per CLAUDE.md.

## Balance numbers (all tunable)

| Knob | Start value | Rationale (all tunable) |
|---|---|---|
| Kindle max / ult cost | 100 / 100 | full-bar release keeps the meter legible; Attunement Lv5 cuts cost to 85 |
| Kindle per trash / elite / boss kill | 1.2 / +6 / +25 | ~45 kills/min mid-run → one ult per 80–110s; roughly one ult per boss fight |
| Kindle per boss damage | 0.02 per 1% boss HP | ~2 bar per full boss solo — bosses charge without being farms |
| Run start fill | 25 | first ult ~minute 2, after the tutorial beats |
| Focus Time | world ×0.30, player ×0.60, 2.5s max hold, full refund on cancel | the touch-aim equalizer; auto-fire kills the slow-mo stall exploit |
| Blink | 240px, 6.0s CD, 0.25s i-frames | < AUTO_AIM_RANGE 620 (WeaponSystem.js:29); CD ≈ boss telegraph cadence so blink dodges one tell, not all of them |
| Pyra Nova | ring 0→900px/0.9s, band 120px, 260 dmg, burn 40dps×3s, KB 140px | the roadmap hook; heal 10HP/10 hit via healSustained (cap 14/s holds, GameConfig.js:108) |
| Sylphine lane | 340×1100px, 190 dmg, shove 220px, 4s 2×-coin window | economy ult for the coin hero (coinMul 1.3, characters.js:42) |
| Gruk slam | r420, 240 dmg, 1.2s invuln, 6s/r300 thorn ring 20dps | tank fantasy; invuln rides invincibleTimer (Player.js:236) |
| Orin line | 5 blasts ×180px: fire 90+burn35×3s / frost 70+3 chill stacks | the combo-table tutor |
| Kael brink | −15% cur HP (floor 10% max); r 520+4/1%missing; 200×(1+1.5×missing) | risk-scaling; 5s +0.25 lowHpDamageBonus |
| Vesper marks | 8 marks, 70° cone, 750px, 150×critMul guaranteed crits, +4 Kindle/marked kill | refund loop rewards full-value casts |
| SHATTER | 1.8× hit (2.6× frozen), needs chillStacks≥2, consumes chill, 1.5s/enemy latch | mirrors DETONATE's 2.5× magnitude band |
| BRITTLE | +1 chill stack + 10% freeze 0.8s, needs 2 shock stacks, 1.5s latch | control payoff, no raw damage |
| DETONATE | 2.5× burnDps (unchanged migration of SHOCK_CFG, GameConfig.js:891) | regression anchor |
| Hero Attunement cost | 400×1.6^lvl (≈6.3k/hero to Lv5); rungs 3/4/5 rite-gated | between relic attunement and skill-tree pacing; 6 heroes ≈ 38k coins total sink |
| Attunement effects | L1 +10% gain · L2 −0.5s blink · L3 +12% ult dmg · L4 +8% vs focused · L5 −15 cost | one knob per level, each read at one existing hook |
| Rite Trial score | kills + 60×ult + 12×comboProc + 250×boss | Kindle-centric by construction |
| Touch buttons | blink r68, Kindle r92, safe-area inset 110px, tap<150ms=quick-fire, 30px cancel deadzone | thumb-reach on 16:9 phones without covering the swarm |

## Art needs (non-blocking)

- NONE BLOCKING — every PR1-5 visual is procedural: ult rings/lanes/cones reuse the cached-glow drawPulse/drawBlast vocabulary (WeaponSystem.js:346-634), the blink reuses the existing dashFx smear renderer (Player.js:495-513), touch buttons are flat strokes + glow arcs, the focus reticle is a cached glow ring.
- higgsfield (separate session, post-ship polish): six 96×96 hi-bit pixel 'signature sigil' icons (one per hero ult) for the HUD meter + Rites panel — Nano Banana 2, keyed via tools/artshot/key-sprite.mjs, credited in ASSET_CREDITS.md; procedural rune-circle placeholders ship first.
- Blender pipeline (optional, non-blocking): an 'ult cast' flourish pose per hero body could be added to the update-1 cast anims later; until then the existing cast pose + recoil (Player.js:539-542) sells the release.
- No enemy/creature art touched — canonical style sheets are irrelevant to this update (no new creatures).

## Risks

- PERF — a screen-wide nova at the 180-enemy cap: mitigated from PR1 by design — each ult is ONE O(enemies) pass through the existing hits pipeline (no per-enemy effects), all VFX are cached-glow blits with a 40-particle cap, and combo procs carry a 1.5s per-enemy latch. Verify gate: PR3's minute-20 ult-under-load frame-time check before merge.
- SAVES — three new persisted maps invite corruption/tampering: mitigated by copying the exact validated patterns (pactMastery per-id clamp SaveSystem.js:333-340, relicAttunement known-id+max clamp :350-359, dailyRoad rollover :689-704); all keys additive, implicit migration, round-trip test in PR5's verify recipe.
- BALANCE — a free universal blink + slow-mo could trivialize bosses: blink is 240px/6s (dodges one telegraph, not a kite loop), respects _confineToArena (Game.js:2764) so it can't leave sealed arenas, and Focus Time is capped at 2.5s with auto-fire so slow-mo can't be held through a boss combo. Kael's HP sacrifice floors at 10% maxHp so an ult is never a self-kill.
- MOBILE — thumb occlusion + accidental fires: buttons sit in safe-area corners (TouchJoystick._safeOrigin pattern), quick-tap vs drag-aim disambiguated at 150ms, 30px cancel deadzone with full refund, and Focus-tap ignores touches on button footprints; rotation mid-drag resets like the joystick's reset() (TouchJoystick.js:49-53).
- DEPENDENCY — update 2 (Emberglass compositor) may not have landed (verified absent from src today): PR5's share card uses a guarded dynamic import with a clipboard-text fallback, so KINDLED never blocks on EMBERGLASS.

## Uniqueness & boundaries

KINDLED is the ONLY update in the 20-update roadmap that adds player input verbs — before it the game's entire input surface is one movement vector (src/core/Input.js:7-12); after it the player aims, dodges, targets, and releases. Every other update adds content, modes, world, platform reach, or meta ON TOP of whatever verbs exist — none of them create agency. It also owns the game's cross-element reaction layer (the combo table) and the per-hero mastery meta (Rites/Attunement).

Sharpest neighbor boundaries: (a) **GLOAMCALL (#8)** owns everything umbral — KINDLED authors only the inert `reserved: true` table row and implements zero umbral weapons, statuses, or visuals; (b) **FORGEGRIP (#18)** owns platform input — KINDLED ships touch buttons only, deliberately NO gamepad polling, no menu focus-ring, no rumble, even though the Kindle/blink verbs are obvious gamepad candidates (the Input-composite seam is left clean for #18); (c) **THE SEALED STORM (#17)** owns determinism — the daily Rite Trial is setup-deterministic only (the dailyRoad.js:6-8 pattern), NOT a seeded sim, and its scoring makes no fairness claims a live-RNG run can't honor; (d) **EMBERGLASS (#2)** owns the card compositor — KINDLED is a consumer with a fallback, never a second implementation; (e) **THE KINDLED TROOP (#5)** consumes this update's combo table for familiar synergy — KINDLED ships no companions.

## Roadmap corrections found while grounding

- Roadmap dep 'deps: 2' (ROADMAP.md:35) implies the Emberglass compositor exists to reuse — verified it does NOT exist in src yet (no compositor/navigator.share/share-card code anywhere in src/). Correction: PR5 must consume it via a guarded dynamic import with a clipboard-text fallback, or land after EMBERGLASS ships.
- 'Aimed blink' reads like a new build — in fact the blink RENDER pipeline already exists but is orphaned dead code: Player.dashFx smear/stretch (src/entities/Player.js:180, 495-513, 523-526) is consumed nowhere since Shadow Dash was reworked into a speed surge (src/content/weapons.js:781-796, 1523-1544); nothing in the repo sets dashFx today. The update revives it rather than building it.
- The 'element combo table' must be authored over THREE real elements, not the five patron identities: weapon element tags are only fire/frost/shock (16/6/11 weapons in src/content/weapons.js); 'dawn/radiant' and 'iron/arcane' are patron flavor (src/content/patrons.js:14-53) with no status channel. The table is 3 live rows + the reserved umbral row — not a 5×5 grid.
- Verified-true claims worth recording: keystone flag-pattern discipline holds exactly as the task brief describes (single flags read at single hooks — keystones.js:8-14, ks_aegis read only at Player.js:224, ks_overcharge/ks_conflagration only inside shockStrike weapons.js:1140/1151); the touch joystick claims only the left half (TouchJoystick.js:79), leaving the right half free for the new buttons; Space is already a preventDefaulted GAME_KEY unused during live gameplay (KeyboardInput.js:4, Game.js:287-318), so the blink binding is conflict-free.
- Save 'version' is written-never-read (defaultData writes version:7, SaveSystem.js:126/360; nothing reads it — matching the roadmap punch-list item at ROADMAP.md:180). The spec bumps it to 8 for bookkeeping but relies on the implicit-default migration pattern, not the version number.

## Binding cross-spec rulings affecting this update

- **[#3 KINDLED vs #10 THE SEVENTH AND EIGHTH WICKS]** #3 ships per-hero tables sized to six heroes: signatures.js (6 Grand Signature ults), rites.js (18 rites, 3/hero), the hero-locked daily Rite Trial, and Hero Attunement. #10 grows the roster to 8 but its DATA list (chronicles.js, loreChronicles.js) claims NO appends to any of #3's tables — leaving Raiko and Nivara with no ult, no Rites, no Attunement, and breaking the Rite Trial's hero-lock pool. This content is claimed by neither spec.
  **RULING:** #3's tables are append-only registries keyed by hero id, and #3 must not hardcode the count six anywhere (Rite Trial pool, Attunement, ult wiring all derive from characters.js). #10 owns authoring the new heroes' rows: PR1/PR2 must each append one signatures.js entry and three rites.js entries (plus Attunement pricing) for Raiko and Nivara. #10's DATA section is amended to list these appends explicitly.

- **[#3 KINDLED vs #4 BOSSFORGE vs #15 ASHBOUND (calendar-PRNG builders)]** Three updates independently mint deterministic calendar derivation: #3's daily Rite Trial (salt 0x4b494e44), #4's week-keyed Weekly Ember (no salt declared), #15's Everburn seasons/edicts (salt 0xa5b0e77). The repo convention (dailyRoad.js:15-30) is deliberate local mulberry32 copies with DISTINCT salts (0x9e3779b9 and 0x5eed1234 already taken) — the hazard is salt collision and an undeclared derivation in #4.
  **RULING:** The local-copy-with-unique-salt convention stands (no shared helper mandated; it is the documented decoupling pattern). Salt registry, to be appended to each spec: 0x9e3779b9 dailyChallenges, 0x5eed1234 dailyRoad, 0x4b494e44 Rite Trial (#3), 0xa5b0e77 Everburn (#15). #4 must declare a distinct week-number salt for weeklyEmber.js in its spec before build. None of these may later be rethreaded through #17's RunRng — calendar setup determinism and run-sim determinism stay separate by design.
