# Update #13: THE LAST HEARTH

*Era IV — The Long Vigil*

**Value verdict (ADDS):** A true loop inversion: every existing and planned mode has enemies targeting only the player, so dual-target aggro, taunt, and a destructible objective are new engine capability, not a mode re-skin. Coupling the darkness veil to the hearth's HP is the standout design idea of the whole roadmap — it makes an existing renderer feature (light radius) into a losable resource. The mote/ward economy gives it its own build layer rather than borrowing the run draft. Clearly missed if removed.

## What it adds

EMBERWAKE's first stationary-defense mode: an endless siege game where you guard a dying forge-hearth whose flame HP literally IS the light on screen. It inverts the core loop — instead of kiting an infinite field, you hold ground, split enemy attention between yourself and a building, spend a new ember economy on defensive wards, and chase a "sieges withstood" record. It is the only update that makes the darkness veil a resource the enemies can take away from you, and the only one that teaches enemies to want something other than the player.

## Design spec

# THE LAST HEARTH — Implementation Spec (Update #13, Era IV)

Roadmap synopsis (docs/ROADMAP.md:104-108): *"Horde defense: guard a dying forge-hearth whose flame HP drives the light radius; siege/stoke phases pulse the WaveDirector; dual-target aggro; ember-ward placement; Troop familiars as hearth defenders; sieges-withstood records."* Deps: 5 (soft). All numbers below are starting values, marked (tunable).

---

## 0. Mode fiction & entry

The last forge-hearth of the Vigil is guttering. The player plants at it and holds through endless alternating **SIEGE** (horde assault) and **STOKE** (breather + economy) phases until the flame — or the monkey — dies. Score is sieges withstood.

**Entry**: a third CTA button, `THE LAST HEARTH`, on the PLAY tab's CTA row where START RUN + DAILY ROAD already share it (MenuRenderer.js:1139-1177; `_hot(...,'startDaily')` at 1177 is the exact template). New action `'startHearth'` lands in Game's action switch beside `case 'startDaily'` (Game.js:1483-1484): `this.hearthMode = true; this.dailyMode = false; this._startRun();`. Mode flag mirrors the proven `dailyMode` pattern (Game.js:743-750, `_effectiveMapId` Game.js:561-564 — hearth uses the normally selected map, so map tier scaling at Game.js:624 applies for free).

**Unlock gate**: `stats.bestBosses >= 3` (first map cleared) OR `stats.runs >= 5` (tunable) — button renders locked with a "Clear the first Vigil" hint otherwise. Records chip (best sieges) rides the existing PLAY-tab read-only chip row (MenuRenderer.js:1106-1108).

**Run wiring inside `_startRun`/`_initRunState`** (Game.js:566-751): when `hearthMode`, after `_initRunState()`:
- spawn `this.hearth = new Hearth(0, 0)` at world center (world coords are center-origin — Spawner clamps at ±WORLD_WIDTH/2, Spawner.js:60-61);
- teleport the player to (0, 180);
- create `this.hearthDirector = new HearthDirector(this.hearth, this.mapTier)`;
- **do not** schedule bosses/lieutenants/crossroads: gate `this.bossDirector` ticking and the lieutenant scheduler behind `!this.hearthMode` (HearthDirector calls lieutenants itself, §4). Victory overlay (Game.js:671-673) never triggers because `bossesDefeated` stays 0 — no code change needed there.
- Player confinement: a hearth ring `{x:0, y:0, r:1400}` (tunable) enforced each frame via the existing `_confineToArena` helper (Game.js:1866-1868, called for the player at Game.js:2763-2764). **It must NOT reuse `this.arena`** — the arena safety net auto-clears it when no boss is alive (Game.js:3268-3270). HearthDirector owns its own ring object and Game calls `_confineToArena(this.player, r)` against it when `hearthMode` (see codeCorrections #3).

**Harness/CI**: PR1 adds a `?hearth=1` URL param handled next to the existing `?skipOnboarding` boot logic (Game.js:543-555) that force-enters the mode on boot, so `tools/artshot/harness.html?seconds=35&badge=1&hearth=1` produces the standard EXC:0 verification shot.

---

## 1. Siege/stoke state machine — `HearthDirector` (NEW `src/systems/HearthDirector.js`)

A run-owned director (created in `_initRunState`, like `LieutenantDirector` at Game.js:597) with phases:

```
PREP(20s, first cycle only) → SIEGE 1 → STOKE 1 → SIEGE 2 → STOKE 2 → … until flame=0 or player dies
```

**Phase lengths** (tunable): PREP 20s. SIEGE n: `min(90, 45 + 5·(n−1))`s. STOKE: 25s flat.

**Wave pulsing**: the mode does NOT modify WaveDirector. `getState(gameTime)` stays the pure time-driven source (WaveDirector.js:94-238); the pulse is a mode scale layer folded exactly where the Trials/road scalars already compose — `_applyRunScale` (Game.js:1880-1920), which is called on the freshly-built state every frame (Game.js:1836, 2666). HearthDirector exposes `getScale()`:

| phase | spawnIntervalMul | cap mul | eliteChance mul | damage mul |
|---|---|---|---|---|
| PREP | ×3.0 | ×0.20 | ×0 | ×1 |
| SIEGE | ×0.55 | ×1.30 | ×(1.15 + 0.05·n) | ×1 |
| STOKE | ×2.40 | ×0.35 | ×0.5 | ×1 |

All (tunable). The hearth-mode alive cap is hard-clamped to **170** (< the 180 base cap, GameConfig.js:1136, and far under `_applyRunScale`'s 220 ceiling at Game.js:1894) to reserve frame budget for ward projectiles + the extra aggro pass. Elite chance still rides the global 0.85 clamp (Game.js:1891).

**Siege wave shape**: each SIEGE is three sub-surges — BUILD (first 30% of the phase, interval ×0.75 of the siege value), PEAK (middle 50%, ×0.55, `packSize +1`), TAIL (last 20%, ×1.1). Each surge rolls 1–2 **attack bearings** (multiples of 45°, ±30° jitter, never the same bearing twice in a row) so assaults have geography the player can defend against.

**Hearth-anchored spawning**: `Spawner.update(dt, anchor, …)` uses its first argument only as the placement anchor (`player.x/player.y` at Spawner.js:64-69); verified nothing else reads it. Game passes `this.hearth` as the anchor in hearth mode at the existing call site (Game.js:2771) — zero Spawner rewrite. PR1 adds one small opt: `waveState.spawnBearing = {angle, halfArc: 0.55rad}` consumed in `_spawnOne`'s angle roll (Spawner.js:65) when present (additive, normal runs unaffected). Spawn ring stays 1050–1350 (GameConfig.js:966-967) around the hearth — just outside the 1400 player ring, readable as an approaching column under the veil.

**Announcements**: phase transitions push through the existing shared banner channel `waveDirector.announce(text, lifetime, color)` (WaveDirector.js:90-92) — "SIEGE III — THEY COME FROM THE WEST" (4s, `#ff6a3c`), "THE FLAME HOLDS — STOKE THE HEARTH" (4s, `#ffd166`). No new UI render path (UIStateBuilder.js:119 already forwards it).

---

## 2. The Hearth entity (NEW `src/entities/Hearth.js`)

Template: `Shrine` (src/entities/Shrine.js:15-107 — constructor(x,y), `update(dt, …)`, procedural `draw(ctx)` in the ember language). The Hearth is bigger, permanent, and damageable:

- `flameMax = 1200 × (1 + 0.25·(mapTier−1))` (tunable); `flame` starts full. `radius = 90` (collision), drawn footprint ~200px: a dark forge-stone ring, anvil-altar center, layered procedural flame whose height/particle rate scale with `flame/flameMax` (ships PR1; Blender prop sheet upgrades later, §art).
- **Duck-typed enemy target**: exposes `x, y, radius` only. Enemy.update computes chase purely from the passed target's position (Enemy.js:370-375), and a velocity-less target is explicitly supported — the boss-lead helper "reduces to the current spot" for targets without velocity (Enemy.js:403, 1023). So the Hearth drops straight into `e.update(dt, target, …)` with no Enemy changes.
- **Light-radius curve** (the headline feature): every frame Game registers the hearth as a priority-0 light exactly like the player light at Game.js:3453-3456:
  `R(f) = R_max · (floor + (1−floor) · f^k)` with `R_max = 720`, `floor = 0.12`, `k = 1.4` (all tunable) where `f = flame/flameMax` — at 3% flame that's an ~92px candle-ring. Flicker: `±4% · sin(t·44)` noise. Color `LIGHT_COLORS.fire`.
  The player's own staff light is multiplied ×0.55 in hearth mode (×0.35 when `f < 0.10`) via the same `gloomK`-style scalar at Game.js:3455 so the hearth is unambiguously the light anchor.
- **Veil deepening**: below 40% flame the veil strength eases from the base 0.56 (GameConfig.js:1391) toward **0.80**. ⚠ Verified correction: `LightingSystem.setQuality` hard-clamps strength to `STRENGTH_CAP = 0.62` (LightingSystem.js:29, 64) — the roadmap's "darkness-veil lever" alone cannot go near-black. PR1 adds `setStrengthCap(cap)` (mode-scoped override, restored on run end; the cached gradient already rebuilds on strength change, LightingSystem.js:70-87, so cost is nil). The FPS governor keeps operating through the same `setQuality` untouched.
- **Flame damage intake** (all in HearthDirector, §3): no passive regen; healing only via stoking (§4).
- Flame=0 → `game._enterGameOver()` (Game.js:2474) with the death cause line "THE HEARTH GUTTERED".

---

## 3. Dual-target aggro — roles, taunt, and the weighting math

Implemented entirely in HearthDirector + a one-line target swap at the enemy update call (Game.js:2821: `e.update(dt, this.player, …)` becomes `e.update(dt, this.hearthDirector ? this.hearthDirector.targetFor(e, this.player) : this.player, …)`).

**Role stamp at spawn** (HearthDirector watches `game.enemies.length` growth each frame — the Spawner only pushes, never splices): each new siege enemy gets `e.siegeRole`:
- `'breaker'` (targets hearth) with probability by behavior: charger 0.80, bomber 0.85, chaser 0.65, spitter 0.40, support 0.50 (all tunable; ~65% blended);
- `'hunter'` (targets player) otherwise. STOKE/PREP spawns are all hunters.

**Taunt (the player's aggro tool)**: any single player hit dealing ≥ 12% (tunable) of a breaker's maxHp taunts it — `e._tauntT = 3.0s` (tunable), during which it targets the player. Hooked from the existing per-frame hit list `CollisionSystem.resolve` returns (`hits` with per-enemy damage, CollisionSystem.js:49-50 — HearthDirector reads `killed`/`hits` the same way Game already consumes them).

**Re-pick weighting** (on taunt expiry, and re-evaluated on a staggered 0.5s cadence — enemy i re-evaluates when `(frame + i) % 30 === 0`, so cost is ~6 dist-compares/frame at 170 alive):
```
target = argmin( dPlayer · wP , dHearth · wH )
breaker: wP = 1.0, wH = 0.75   // hearth "feels" 25% closer — sticky objective
hunter : wP = 1.0, wH = 1.60   // only swaps to hearth if the player flees far
```
(tunable). This gives real counterplay: stand between the column and the hearth and hit hard → you peel; hide → the hearth burns.

**Hearth damage intake** — three channels, all owned by HearthDirector.update (CollisionSystem stays player-only, see codeCorrections #4):
1. **Gnaw**: breakers within `gnawRadius = 110` of hearth center stop (their target IS the hearth so they naturally pile; HearthDirector zeroes residual overlap jitter) and deal `contactDamage × 0.6` per 0.8s tick (tunable) to flame. Concurrent gnawers capped at **14 perimeter slots**; excess breakers hold at r 150 (still killable). With ~10 flame dps per mid-run gnawer, a full unanswered ring kills a tier-1 hearth in ~9s — sieges are lost in lapses, not instantly.
2. **Bolts**: EnemyProjectile only collision-tests the passed player (EnemyProjectile.js:80-86), so HearthDirector runs a hearth-overlap sweep over `game.enemyProjectiles`: overlap → `flame -= damage × 0.5`, bolt consumed. Spitter breakers thus meaningfully shell the hearth.
3. **Siegemaster**: every 3rd siege's PEAK spawns a lieutenant via the existing open-field `_spawnLieutenant` path (Game.js:2063-2076 — no arena, no wipe) stamped as a breaker with gnaw ×3. Reuses the lieutenant HP-bar UI (UIStateBuilder.js:135).

Damage feedback: flame hits push a `DamageNumber` at the hearth (pool at Game.js:604) + a screen-edge amber pulse when `f` crosses 50/25/10% with a banner ("THE FLAME WANES — 25%").

---

## 4. Embermote economy + ember-wards

**Embermotes** (NEW `src/entities/Embermote.js`, cloned from the Coin magnet-pickup idiom — pickup loop template at Game.js:2971-2978): during SIEGE every **5th** kill (tunable) drops one; carried counter capped at **12**. HUD chip next to coins.

**Stoking**: during STOKE, standing inside the hearth's stoke ring (r 140) channels 1 mote / 0.5s → each restores **3% of flameMax** (tunable). Banking motes while flame is already full converts to `overstoke` score (+50 each). Motes carry across phases; death loses nothing (they're mode-internal, never persisted).

**Ward sockets**: 8 fixed sockets on a ring r 220 around the hearth at 45° spacing, drawn as ember-etched stone rings (HearthDirector ground pass, same layer as HazardSystem.drawGround decals, HazardSystem.js:237). During STOKE (only), walking onto an empty socket (Shrine walk-onto idiom, Shrine.js:29-33) opens a pick overlay reusing the altar overlay plumbing (`this.altar` pick-one at Game.js:640-642) listing affordable wards. Placing costs motes; wards persist across sieges; max 8.

**Ward types** (NEW `src/content/wards.js` data + NEW `src/entities/Ward.js`; 4 at ship, all tunable):

| ward | cost | HP | effect |
|---|---|---|---|
| **Cinder Brazier** | 4 | 120 | every 1.6s fires 3 ember bolts (dmg 14, range 420) at the nearest breaker — bolts are REAL `Projectile`s pushed into `game.projectiles`, so hits/kills/knockback/drops all ride `CollisionSystem.resolve`'s generic projectile↔enemy pass for free (CollisionSystem.js:39-101) |
| **Frost Totem** | 5 | 100 | aura r 260: stamps `applyChill(0.70, 1.0)` every 0.8s on enemies inside — the exact public status API (Enemy.js:337-347), bosses-floor logic irrelevant (no bosses here) |
| **Ashen Palisade** | 3 | 320 | sacrificial shield: any gnaw/bolt flame damage arriving through its 45° socket arc hits the palisade's HP first. Deliberately NOT a runtime obstacle — ObstacleSystem insertion belongs to update 7 (ROADMAP.md:63) |
| **Kindle Chime** | 6 | 80 | economy: +25% embermote drop rate within r 300 of the hearth and auto-vacuums dropped motes to the player's bank |

Wards take gnaw damage when a breaker's slot arc contains one; destroyed → socket empties (no refund), crack SFX + banner. Projectile budget: worst case 8 braziers ≈ 15 bolts/s at ~0.9s life ≈ 14 concurrent — comfortably inside the ~220 projectile cap. Ward glow lights register at priority 2 so they're the first dropped under the `maxLights = 96` cap (LightingSystem.js:113-116, GameConfig.js:1396).

**Troop defenders (soft dep on update 5)**: if `game.troop` exists (KINDLED TROOP, ROADMAP.md:47-51 — verified absent from src today, expected shipped by #13's slot), HearthDirector engages **Warden Stance**: familiars hold within r 320 of the hearth during SIEGE prioritizing gnawers, rejoin the player during STOKE. Pure behavior flag on their existing AI; feature dark-ships cleanly when Troop is absent (`game.troop?.familiars?.length` guard). No Troop internals are modified here.

---

## 5. Scoring, records, rewards

- Live score: `1000·siegesWithstood + 2·kills + 50·overstoke`, plus `floor(200·flameFrac)` banked at run end (tunable).
- **Save (additive, no version bump)** — the implicit-default clamp pattern proven by `dailyRoad` (SaveSystem.js:295-304, DEFAULT at 106): new sanitized block
  `hearth: { bestSieges: 0, bestScore: 0, runs: 0, totalSieges: 0 }` (non-negative ints, floor+clamp, missing → defaults) added to the validator return (SaveSystem.js:360). New `recordHearthRun(sieges, score)` mirrors `recordDailyRoadScore` (SaveSystem.js:690-706), returning `{bestSieges, bestScore}` beat flags.
- Banked at `_enterGameOver` next to the gauntlet banking (Game.js:2501-2502) AND on the leave-on-victory-style exit path parity is unnecessary (no victory exit exists in this mode). `_runRecorded`/`bankedThisRun` latches (Game.js:673, 699-701) already prevent double-banking.
- Coin payout: normal in-run coin drops bank via the untouched `_bankRunCoins`, plus a siege bonus `40·sieges` (tunable) — modest vs. Daily Road so it doesn't become the farm meta.
- Game-over overlay headline: **"SIEGE X WITHSTOOD"** (+ NEW BEST banner via the existing `newBest` field, Game.js:728). Share card: one extra Emberglass compositor variant (update 2's shared module, ROADMAP.md:27-29) — flame %, sieges, kills, wards standing (PR4, reuse only).

## 6. HUD & readability

- **Flame bar**: center-top, 320×12px, under the wave label band (UISystem.`_drawWaveLabel` draws at `sa.top+112` with the pressure bar at `+140`, UISystem.js:455-496); hearth mode replaces the pressure bar slot with the flame bar (amber→deep red ramp, % label under 30%). Data flows through UIStateBuilder like everything else (pattern at UIStateBuilder.js:113-119): `base.hearth = { frac, phase, phaseT, sieges, motes, wardCount }`.
- Phase ring: a thin arc around the flame bar showing time left in the current phase.
- Off-screen hearth arrow when the player wanders (same style as existing off-screen cues), and off-screen gnawer pips on the flame bar ends so damage is never invisible.
- Mobile/a11y: the veil deepening honors reduced-effects — when the settings' reduced mode is on, `setStrengthCap` stays at the stock 0.62 and the candle-ring moment is sold by light radius alone.

## 7. Environmental pressure (HazardSystem reuse)

During SIEGE PEAK, an **ash-squall** cadence spawns 1–2 player-facing ember patches (tick 4 dmg/0.4s, r 130, warn 1.2s, life 6s, tunable) via the exact biome-patch shape — the `hz.biome` branch already handles telegraph/tick/draw generically (HazardSystem.js:50-74, spawner idiom at 195-234). HearthDirector pushes them into `game.hazards` directly (the pool is Game-owned by design, HazardSystem.js:3-6). This keeps STOKE calm and makes standing still during peaks cost something. ⚠ Note: the hazard pool damages ONLY the player — wards never ride it (codeCorrections #2).

## 8. What is NEW vs REUSED

**NEW**: `src/systems/HearthDirector.js`, `src/entities/Hearth.js`, `src/entities/Ward.js`, `src/entities/Embermote.js`, `src/content/wards.js`, `HEARTH` config block in GameConfig.js, save block `hearth`, harness `?hearth=1` param.
**REUSED/EXTENDED**: WaveDirector untouched except its public `announce` (WaveDirector.js:90); `_applyRunScale` fold (Game.js:1880); Spawner as-is + one additive bearing opt (Spawner.js:64); Enemy target duck-typing (Enemy.js:370); CollisionSystem generic projectile pass for ward bolts (CollisionSystem.js:39); Shrine as the walk-onto/procedural-draw template; altar overlay for ward picks (Game.js:640); LightingSystem + one `setStrengthCap` method; lieutenant open-field spawn (Game.js:2063); DailyRoad save/record idiom (SaveSystem.js:295, 690); Coin pickup idiom (Game.js:2971); Emberglass compositor (update 2); Troop stance flag (update 5, conditional).

## 9. Failure/edge design (mitigations built into PR1)

1. **Perf** — 170 enemies + deep veil + ward bolts + aggro pass: alive cap set at 170 (10 under the global 180) from PR1; aggro re-pick staggered (≤6 checks/frame); ward lights priority-2 (first dropped); the veil buffer cost is resolution-fixed regardless of strength (LightingSystem.js:13-16), so `setStrengthCap` adds zero fill cost. Verify with the badge's EXC counter at siege peak.
2. **Save safety** — additive `hearth` block behind the clamp validator; a v7 save without it loads to defaults with no version bump (same as dailyRoad, SaveSystem.js:295-304). No hearth-mode state is ever persisted mid-run.
3. **Softlocks/exploits** — flame=0 and player-death both route through the single `_enterGameOver` latch (Game.js:2474-2476); AFK cheese is broken because 35% hunters always chase the player and stoking requires standing at the hearth; the arena-safety-net footgun (Game.js:3268) is avoided by never touching `this.arena`.
4. **Mobile readability at 3% flame** — light floor 0.12·720 ≈ 86px ring + player candle ×0.35 keeps the immediate threat readable; reduced-effects preset caps the veil at stock strength.

## PR plan

### PR1 — PR1 — Hearth mode skeleton: entity, siege/stoke director, light curve, records, menu entry

**Goal:** A fully playable (ward-less) Last Hearth mode: enter from the PLAY tab, defend the hearth through pulsed sieges, flame HP drives light radius and the deepened veil, game over on flame death, best-sieges record saved. Independently shippable — the mode is fun with just positioning + damage.

**Files:**
- `src/systems/HearthDirector.js (NEW)`
- `src/entities/Hearth.js (NEW)`
- `src/core/Game.js`
- `src/systems/LightingSystem.js`
- `src/systems/SaveSystem.js`
- `src/systems/MenuRenderer.js`
- `src/systems/UIStateBuilder.js`
- `src/systems/UISystem.js`
- `src/config/GameConfig.js`

**Work:**
- Hearth entity (flame HP 1200×tier, light curve R(f)=720·(0.12+0.88·f^1.4), procedural forge-hearth draw in the Shrine idiom)
- HearthDirector: PREP/SIEGE/STOKE machine, per-phase getScale() folded in _applyRunScale (Game.js:1880), 3-surge siege shape + attack bearings, hearth-anchored Spawner call (pass hearth as anchor at Game.js:2771) + additive spawnBearing opt in Spawner._spawnOne
- hearthMode flag + 'startHearth' action beside 'startDaily' (Game.js:1483), _startRun branch, boss/lieutenant/crossroads gating, mode-owned confinement ring via _confineToArena (never this.arena)
- LightingSystem.setStrengthCap(cap) mode override (restore on run end); hearth light registration beside the player light (Game.js:3456); player-light ×0.55/×0.35 scalar
- Save: additive hearth{bestSieges,bestScore,runs,totalSieges} clamp block + recordHearthRun (dailyRoad idiom); bank at _enterGameOver
- PLAY-tab CTA button + unlock gate + best-sieges chip; flame bar + phase arc in UISystem; phase banners via waveDirector.announce
- ?hearth=1 harness/boot param next to the skipOnboarding logic (Game.js:543-555)

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- headless: tools/artshot/harness.html?seconds=35&badge=1&hearth=1 → EXC:0, screenshot shows hearth, flame bar, siege banner
- manual/scripted: let flame reach 0 → 'SIEGE X WITHSTOOD' game over; reload with a pre-update save JSON → loads clean, hearth block defaulted
- badge enemy count never exceeds 170 during siege peak

### PR2 — PR2 — Dual-target aggro: breaker/hunter roles, taunt, gnaw slots, bolt intercept, Siegemaster

**Goal:** Enemies split attention between hearth and player with real counterplay: role stamps at spawn, big-hit taunts, weighted re-pick, 14-slot gnaw ring damaging flame, spitter bolts shelling the hearth, and a lieutenant Siegemaster every 3rd siege.

**Files:**
- `src/systems/HearthDirector.js`
- `src/core/Game.js`
- `src/config/GameConfig.js`

**Work:**
- Role stamping on newly-pushed enemies (watch enemies.length growth); per-behavior breaker probabilities (charger .80, bomber .85, chaser .65, spitter .40, support .50)
- targetFor(e, player): taunt on single hits ≥12% maxHp (read from CollisionSystem.resolve's hits list), 3.0s duration, staggered 0.5s re-pick argmin(dP·1.0, dH·wH) with wH=0.75 breaker / 1.60 hunter; one-line target swap at Game.js:2821
- Gnaw pass: 14 perimeter slots, contactDamage×0.6 per 0.8s tick to flame, hold ring for overflow; DamageNumbers + 50/25/10% banners
- EnemyProjectile hearth-overlap sweep (bolt dmg ×0.5 to flame, consume)
- Siegemaster: every 3rd siege PEAK via the open-field _spawnLieutenant path (Game.js:2063), breaker-stamped, gnaw ×3

**Verify:**
- node --check; validate-assets exit 0
- headless 60s ?hearth=1 run: EXC:0; dev overlay (?debug=1) shows breaker/hunter split ~65/35 and flame dropping only when gnawers reach the ring
- walk away from hearth: flame decays via gnaw; taunt a breaker with a heavy hit and confirm target flip + 3s revert

### PR3 — PR3 — Embermote economy + ember-ward placement (4 ward types)

**Goal:** The build-and-hold layer: kill-dropped embermotes, stoke-channel flame healing, 8 ward sockets with a walk-onto altar-style pick overlay, and four procedurally-drawn ward types with HP and destruction.

**Files:**
- `src/content/wards.js (NEW)`
- `src/entities/Ward.js (NEW)`
- `src/entities/Embermote.js (NEW)`
- `src/systems/HearthDirector.js`
- `src/core/Game.js`
- `src/systems/UISystem.js`
- `src/config/GameConfig.js`

**Work:**
- Embermote pickup (Coin idiom, Game.js:2971 loop pattern): 1 per 5 siege kills, carry cap 12, HUD chip
- Stoke channel: 1 mote/0.5s inside r 140 during STOKE → +3% flameMax each; overstoke → +50 score each
- 8 sockets at r 220 / 45°; STOKE walk-onto opens ward pick via the altar overlay plumbing (Game.js:640)
- Cinder Brazier (4 motes, real Projectiles into game.projectiles so CollisionSystem handles hits), Frost Totem (applyChill aura), Ashen Palisade (arc damage shield, NOT an obstacle), Kindle Chime (+25% mote rate + vacuum)
- Ward HP, gnaw-through-arc damage, destruction FX + banner; ward glow lights at priority 2

**Verify:**
- node --check; validate-assets exit 0
- headless ?hearth=1&seconds=45 EXC:0; badge projectile count stays under 220 with 8 braziers force-placed via a dev param
- place each ward type and confirm: brazier kills credit drops/kill pipeline; totem chills (slowed sprites); palisade absorbs before flame; chime raises mote rate
- wards persist across a siege→stoke→siege cycle; destroyed ward frees its socket

### PR4 — PR4 — Polish: ash-squall, candle-ring moment, Troop Warden Stance, share card, balance

**Goal:** Ship quality: siege-peak ash-squall hazards, the tuned 3%-flame near-black moment, conditional Troop hearth stationing, the Emberglass 'SIEGE X WITHSTOOD' card, audio cues, and a full balance pass over the tunables table.

**Files:**
- `src/systems/HearthDirector.js`
- `src/core/Game.js`
- `src/systems/UISystem.js`
- `src/systems/MenuRenderer.js`
- `src/systems/AudioSystem.js`
- `src/config/GameConfig.js`
- `src/systems/(Emberglass compositor module from update 2)`

**Work:**
- Ash-squall: 1-2 biome-shape patches (hz.biome branch, HazardSystem.js:50) pushed into game.hazards during SIEGE PEAK
- Candle-ring tuning: veil cap 0.80 ramp under 40% flame, player-light ×0.35 under 10%, flame-bar sub-30% pulse, heartbeat-style low-flame audio cue
- Warden Stance behind game.troop guard (dark-ships if update 5 absent)
- Share-card variant on the update-2 compositor: sieges, flame %, kills, wards standing
- Balance pass across the tunables table; record chips final placement on PLAY tab

**Verify:**
- node --check; validate-assets exit 0
- headless ?hearth=1&badge=1 with a dev low-flame param → screenshot of the candle-ring moment, EXC:0
- scripted 3-siege playthrough: phase lengths, banner cadence, mote economy closes (stoke can restore ~30% flame at cap)
- reduced-effects setting: veil stays ≤0.62, mode still readable; adversarial review + squash-merge per repo cadence

## Data & save changes

**New content/data files**: `src/content/wards.js` (4 ward defs: cost, hp, cadence, damage/aura numbers, draw palette). **New config**: one `HEARTH` block in `src/config/GameConfig.js` (all phase lengths, scale table, flame/light curve constants, gnaw/taunt/aggro weights, mote economy, socket layout, score weights) so every tunable lives in the established config home. **Save schema (additive only, no version bump — implicit-default clamp like dailyRoad at SaveSystem.js:295-304)**: `hearth: { bestSieges:int≥0, bestScore:int≥0, runs:int≥0, totalSieges:int≥0 }` + `recordHearthRun()` mirroring `recordDailyRoadScore` (SaveSystem.js:690). **New entities**: Hearth, Ward, Embermote (all procedural draw, no asset rows needed at ship). **ASSET_CREDITS.md rows** only if/when the optional AI/Blender hearth+ward sheets land (separate session, non-blocking). Nothing existing is renamed or removed; normal-run behavior is bit-identical when `hearthMode` is false.

## Balance numbers (all tunable)

| # | value | start | why |
|---|---|---|---|
| PREP length | 20s | read the field, first positioning (tunable) |
| SIEGE n length | min(90, 45+5·(n−1))s | sieges lengthen toward a 90s ceiling (tunable) |
| STOKE length | 25s | enough to bank ~10 motes + place 1 ward (tunable) |
| SIEGE scale | interval ×0.55, cap ×1.30, elite ×(1.15+0.05n) | pulse on top of the time-driven WAVES ramp (tunable) |
| STOKE scale | interval ×2.40, cap ×0.35 | trickle, never silent (tunable) |
| Hearth-mode alive cap | 170 hard | 10 under the 180 global cap → budget for wards/aggro (fixed) |
| flameMax | 1200 × (1+0.25·(tier−1)) | ~2 lost sieges of unanswered gnaw at tier 1 (tunable) |
| Light curve | R=720·(0.12+0.88·f^1.4), ±4% flicker | 92px candle-ring at 3% flame (tunable) |
| Veil deepening | 0.56→0.80 below 40% flame (mode cap raise) | the near-black hook; reduced-effects stays ≤0.62 (tunable) |
| Player light in mode | ×0.55 (×0.35 under 10% flame) | hearth is the light anchor (tunable) |
| Breaker odds | charger .80 / bomber .85 / chaser .65 / spitter .40 / support .50 | ~65/35 breaker/hunter blend (tunable) |
| Aggro weights | breaker wH 0.75, hunter wH 1.60, re-pick 0.5s staggered | sticky objectives, cheap math (tunable) |
| Taunt | single hit ≥12% maxHp → 3.0s player-lock | damage = peel tool (tunable) |
| Gnaw | contactDamage×0.6 / 0.8s, 14 slots, r 110 | full ring ≈ 9s to kill a fresh hearth (tunable) |
| Bolt vs hearth | damage ×0.5, bolt consumed | spitters matter without dominating (tunable) |
| Embermote | 1 per 5 siege kills, carry cap 12 | ~8-14 motes per siege (tunable) |
| Stoke heal | 3% flameMax per mote, 1/0.5s in r 140 | full carry ≈ 36% flame back (tunable) |
| Ward costs/HP | Brazier 4/120 · Totem 5/100 · Palisade 3/320 · Chime 6/80 | first ward by stoke 1, full ring ~siege 6 (tunable) |
| Brazier fire | 3 bolts /1.6s, dmg 14, range 420 | ≤14 concurrent bolts at 8 braziers — inside the 220 cap (tunable) |
| Siegemaster | every 3rd siege PEAK, gnaw ×3 | spike beat on the existing lieutenant kit (tunable) |
| Score | 1000/siege + 2/kill + 50/overstoke + 200·flameFrac at end | sieges dominate; overstoke rewards greed (tunable) |
| Coin bonus | +40/siege on top of normal drops | below Daily Road payout — not the farm meta (tunable) |
| Unlock | bestBosses ≥3 or runs ≥5 | keeps onboarding clean (tunable) |

## Art needs (non-blocking)

- Hearth prop: Blender pipeline (tools/blender/ parametric prop → pixelated sheet) — a forge-hearth brazier with a 4-frame flame idle at 3 flame states (full/waning/candle). NON-BLOCKING: PR1 ships a procedural canvas draw in the Shrine idiom (Shrine.js:36-94) that is fully shippable on its own.
- Ward props (brazier/totem/palisade/chime): small Blender or Nano Banana 2 prop sheets, keyed via tools/artshot/key-sprite.mjs. NON-BLOCKING: PR3 ships procedural draws in the ember palette first; sheets swap in behind the existing layered-fallback discipline.
- NO new creature art at all — the mode deliberately reuses the locked canonical enemy roster (src/assets/enemies/ five approved sheets + existing types), which keeps the style lock untouched and the update art-light.
- Optional (separate higgsfield session, never blocks): one Nano Banana 2 hearth key-art frame for the PLAY-tab CTA button + share-card background; add ASSET_CREDITS.md row when it lands.

## Risks

- Perf at siege peak: 170 enemies + deepened veil + ward bolts + aggro pass on mobile. Mitigated from PR1: hard 170 cap (10 under global), staggered 0.5s aggro re-pick (~6 checks/frame), ward lights at drop-first priority 2, veil cost is resolution-fixed regardless of strength (LightingSystem.js:13-16); verified per-PR with the badge EXC counter at peak.
- Save regression: mitigated by the additive clamp-validated `hearth` block (dailyRoad idiom, SaveSystem.js:295-304), no version bump, no mid-run persistence; PR1 verification includes loading a pre-update save JSON.
- Balance/exploit: AFK-at-hearth or full-kite cheese — broken by the 35% hunter split, stoke requiring hearth proximity, and ash-squall anti-camping; economy runaway bounded by the 12-mote carry cap and 8-socket ceiling.
- Mode-flag bleed into normal runs (the classic modal bug): every hearth branch is behind `this.hearthMode`, HearthDirector/Hearth are created only in the mode, `_initRunState` nulls them, and the arena field is never reused (the safety net at Game.js:3268 would silently clear it) — plus a PR1 regression check that a normal run's badge output is unchanged.
- Readability at 3% flame on small/bright-ambient screens: light floor (~86px ring) + player candle + reduced-effects escape hatch that pins the veil at stock 0.62.

## Uniqueness & boundaries

**What no other update provides**: THE LAST HEARTH is the roadmap's only stationary-objective mode — the only place enemies target something other than the player (the dual-target aggro/taunt tech is minted here), the only place the darkness veil is gameplay-coupled to a destructible entity's HP (light radius as a losable resource), the only build-and-hold economy (motes → wards on sockets), and the source of the "sieges withstood" record family. Every other mode in the plan (Daily Road, Gauntlet, Boss Rush #4, Undertow descent #6, Crucible #17, Ember Race #19) keeps the classic roaming-survivor loop.

**Sharpest neighbor boundaries**: vs **#6 UNDERTOW** — Undertow owns push-your-luck *descent* pacing and new enemy families; we add zero creatures and zero floor structure (our push-your-luck is only the overstoke/heal mote tradeoff). vs **#9 WAYLIGHT** — Waylight owns world POIs and permanent waystone lights *inside normal runs* via the `_placeStructures` pass; our hearth/sockets exist only inside the mode and place nothing in normal runs. vs **#7 THRESHOLDS** — Thresholds owns runtime ObstacleSystem insertion (arena-raise); our Palisade is deliberately an HP damage-shield, NOT an obstacle, so we never touch that seam. vs **#5 KINDLED TROOP** — Troop owns familiar AI/upgrades; we only add a conditional stationing stance behind a `game.troop` guard that dark-ships if #5 is absent. vs **#14 LEDGER OF ASHES** — 14 owns records *infrastructure* (archive, splits, export); we add exactly one dailyRoad-shaped record block and hand 14 nothing to migrate. vs **#15 ASHBOUND** — 15 owns the difficulty ladder; our siege ramp is a fixed internal curve with no Torment hooks.

## Roadmap corrections found while grounding

- Roadmap's 'darkness-veil lever' (LightingSystem) is real but HARD-CAPPED: `STRENGTH_CAP = 0.62` clamps both the constructor and `setQuality` (LightingSystem.js:29, 54, 64) — the 'screen black except a candle-ring' hook cannot be delivered by the existing lever alone. Spec adds a mode-scoped `setStrengthCap(0.80)` override (cheap: the cached veil gradient already rebuilds on strength change, LightingSystem.js:70-87).
- The 'HazardSystem spawn path' entry point damages ONLY the player — every takeDamage call in the hazard pool targets `game.player`/`pl` (HazardSystem.js:65, 94, 124, 146, 167). Ember-wards therefore CANNOT ride hz.tickDamage to hurt enemies; the spec routes ward damage as real Projectiles into game.projectiles (handled generically by CollisionSystem.resolve, CollisionSystem.js:39-101) and uses the hazard pool only for the player-facing ash-squall.
- The boss `arena` field cannot be reused for hearth confinement: a safety net clears `this.arena` whenever no boss is alive (Game.js:3268-3270, keyed on activeBossRef), which would instantly lift a hearth ring. Spec uses a mode-owned ring object fed to the existing `_confineToArena` helper (Game.js:1866-1868).
- CollisionSystem's contact pass is strictly player↔enemy (CollisionSystem.js:110-131) and EnemyProjectile collision-tests only the passed player (EnemyProjectile.js:80-86) — hearth contact (gnaw) and hearth bolt-intercept must be new mode-owned passes, not extensions of those systems. Conversely this VERIFIES the aggro claim: Enemy.update chases whatever target object is passed (Enemy.js:370-375) and explicitly tolerates velocity-less targets (Enemy.js:403, 1023), so dual-target aggro needs zero Enemy.js movement changes.
- Spawner placement anchors purely on its `player` argument (Spawner.js:64-69) — passing the Hearth as the anchor gives hearth-centric siege spawning with no Spawner rewrite; only the directional-bearing window is a (small, additive) extension.
- Minor: the synopsis's 'Troop familiars as hearth defenders' dependency is correctly soft — no troop/familiar code exists in src/ today (update 5 unshipped); the spec gates Warden Stance behind a `game.troop` existence check so the mode dark-ships either way.

## Binding cross-spec rulings affecting this update

- **[#2 EMBERGLASS vs #13 THE LAST HEARTH vs #17 THE SEALED STORM]** #2's docs/CARDS.md freezes the CardCompositor reuse contract as "updates 3/14/15/19/20" (matching ROADMAP.md:29), but #13 PR4 ships a siege share card and #17 PR4 auto-mints a shareable challenge-code card on every game-over screen — two card producers outside the frozen contract list, each at risk of building parallel share plumbing.
  **RULING:** #2 owns ALL card/share plumbing; the CardCompositor template registry is an OPEN, append-only contract, and docs/CARDS.md must be re-worded from a closed five-update list to "any update registers templates via registerTemplate(); known consumers: 3, 13, 14, 15, 17, 19, 20." #13 registers a 'siege' template and #17 registers its game-over challenge-code presentation through that contract; neither ships its own offscreen canvas, share ladder, or clipboard/navigator.share code.

- **[#9 WAYLIGHT vs #13 THE LAST HEARTH]** #13 claims to MINT non-player targeting ("the only place enemies target something other than the player"; dual-target aggro tech "minted here"), but #9 ships four updates earlier with the Hollow Bell that "wheels the entire horde into a killbox" — which requires enemies to pursue a non-player point.
  **RULING:** Split by mechanism, quoted in both specs: #9's bell is a STEERING LURE only — a temporary movement-destination override with no attack target, no aggro roles, no enemy-vs-object damage; it lives inside WaylightSystem. #13 owns dual-target ATTACK aggro — breaker/hunter roles, taunt, gnaw slots, bolt intercept, a destructible objective with HP. #13's uniqueness claim is amended to "the only place enemies ATTACK something other than the player." If #13 wants a lure primitive it may generalize #9's hook, but the aggro system lands in #13.

- **[#14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)]** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.
  **RULING:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.
