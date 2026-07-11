# Boss Rush — implementation notes (BOSSFORGE)

Boss Rush is EMBERWAKE's second real gameplay mode: a sequence of apex bosses
fought back-to-back with a short prep phase between each, ending in a Boss-Rush
result screen + shareable recap card. It is built to be **reused** by Weekly
Ember later without touching the controller.

## How Boss Rush starts

1. **Menu** — the PLAY screen's CTA row now has a fourth button, **BOSS RUSH**
   (`MenuRenderer._drawBossRushButton`), beside START RUN / DAILY ROAD / RITE
   TRIAL. It dispatches the `'startBossRush'` action.
2. **Action** — `GameInputActions._menuAction` case `'startBossRush'` sets
   `game.bossRushMode = true` (clearing `dailyMode`/`riteTrialMode`) and calls
   `_startRun()`. It uses the player's **own** hero + map pick — no override
   (unlike the daily modes), so `_effective{Character,Map}Id` are untouched.
3. **`_startRun`** — after `_initRunState()` (which resets `this.bossRush = null`),
   when `bossRushMode` is on it builds the live controller:
   `this.bossRush = new BossRushController(getBossRushSequence(BOSS_RUSH_CONFIG), BOSS_RUSH_CONFIG)`.
4. **Dev shortcut** — with `?dev=1`, pressing **G** on the menu launches Boss
   Rush directly (gated by `DEV_MODE`).

## How the boss sequence works

- **`src/content/bossRush.js`** is pure data + pure functions: the fixed apex
  order (`BOSS_RUSH_APEX_ORDER`, the 12 apex bosses in map-tier order 1→4), the
  mode config (`BOSS_RUSH_CONFIG`), `getBossRushSequence(config)` (fixed order,
  or a deterministic Fisher–Yates shuffle when `config.seed != null`),
  `bossRushScaleFor(index, config)` (the gentle mode-specific boss HP/damage
  curve), and `bossRushScore(...)`.
- **`src/systems/BossRushController.js`** is the run-time state machine:
  phases `'prep' → 'fight' → 'done'`. `update(dt)` counts the prep timer down and,
  when it elapses, returns `{ spawn: bossId }`. `notifyBossDefeated()` advances
  the index (or marks the gauntlet cleared). `getStatus()` feeds the HUD. It
  **spawns nothing itself** — it just decides *when*.
- **`GameUpdate._updateDirectors`** — when `this.bossRush` is set, the prep→spawn
  decision comes from the controller and is fed into the **existing**
  `_startBossWarning → _spawnBoss` pipeline, so telegraphs, the arena, enraged
  phases, boss music, and threshold adds all work exactly as in a normal run.
  The normal `BossDirector`, the `LieutenantDirector`, and the trash `Spawner`
  are all **bypassed** for the mode (one-line `!this.bossRush` gates).
- **`CombatResolver`** boss-death hook — on a boss kill, if `this.bossRush` is
  set it advances the controller (no CROSSROADS fork, no 3-boss victory rule);
  the shared reward/coin/FX payoff is unchanged. Clearing the whole sequence
  opens the victory overlay via the existing `_showVictory()`.
- **Scaling** — `_spawnBoss` reads `this.bossRush.currentScale()` in the mode
  (base 1.2× HP, +0.12×/boss; +0.04× damage/boss) instead of normal mode's
  run-minute HP ramp + steep per-encounter tier, which would compound into an
  unwinnable wall across twelve bosses with no trash XP.

## Head-start build (start armed, not at level 1)

Boss Rush drops the player straight into an apex fight with no trash to level on,
so it grants a **head-start build**: `BOSS_RUSH_CONFIG.startingLevelUps` (default
**5**) level-ups at run start. The player becomes **level 6** and drafts **5
upgrades** from the normal level-up pool during the opening prep — the level-up
overlay freezes the world (and the controller's prep timer with it), so the
first boss can't land until the picks are made.

- `Player.grantLevels(n)` bumps the level counter + keeps the XP curve consistent
  (level is a counter; power comes from the drafted upgrades).
- `Game._startRun` (end) grants the levels + opens the first draft;
  `selectUpgrade` already chains the rest.
- First-run onboarding is suppressed in Boss Rush (it teaches the first level-up
  pick, which the head-start drafts already cover). Tunable via the config.

## UI, persistence, recap

- **HUD** (`UISystem._drawBossRushHud`, fed by `UIStateBuilder.base.bossRush`) —
  a crimson pill: `BOSS RUSH · X/N` plus an `INCOMING: <boss> · Ns` line during
  prep or a `Next: <boss>` preview during a fight. It drops below the boss HP
  bar when a boss is on the field so they never overlap.
- **End screen** (`UISystem._drawGameOverOverlay`) — Boss Rush swaps the
  wave/objective readout for: cleared status, bosses felled (X/N), apex reached,
  time, level, score. Hero + build/weapons ride on the recap card.
- **Recap / share card** — `cardTemplates.drawBossRushCard` (registered as the
  `'bossrush'` template); `Game._queueBossRushCard` builds its data (hero,
  bosses felled/total, cleared, apex reached, time, up to three weapons as
  build chips, ★ NEW BEST ribbon). Both `_queueDeathCard` and `_queueVictoryCard`
  branch to it in Boss Rush.
- **Save** — `SaveSystem` gains an **additive** `bossRush: { bestBosses,
  bestTime, bestScore }` all-time record (normalized like `riteTrial`; **no save
  version bump** — the field defaults to zeros on old saves, so no wipe).
  `recordBossRush(result)` folds a run in; `Game._bankBossRush` calls it once per
  run (latched by `_bossRushRecorded`) from both the death and victory-leave paths.

## Debug shortcuts (DEV_MODE, in a Boss Rush run)

- **G** (menu) — start Boss Rush.
- **N** — skip to the next boss (drops the active boss to 1 HP so the next
  auto-shot kills it through the real pipeline; in prep, shortens the countdown).
- **H** — force the active boss to ~3% HP.
- **J** — finish the whole gauntlet (clear → victory).

## Weekly Ember (now shipped on these hooks)

Weekly Ember is live, built exactly on the reuse path this design left:

- `getWeeklyEmberConfig(day)` → `{ ...BOSS_RUSH_CONFIG, id: 'weeklyEmber',
  seed: weeklyEmberSeed(day), deterministic: true }` — the same
  `getBossRushSequence` turns the per-UTC-week seed into a deterministic
  shuffle of the same 12-apex roster.
- Same `BossRushController`, same gauntlet gates (they key off the
  controller/config), same `'bossrush'` recap card (mode label parameterised).
- `startWeeklyEmber` action + `weeklyEmberMode` flag; launched from the
  **MODES screen** (the menu's mode gallery, alongside Daily Road / Rite
  Trial / Boss Rush).
- Week-scoped save record `weeklyEmber { week, best, prevBest }` mirroring
  `riteTrial`'s day-gated shape — the freeplay Boss Rush record stays all-time
  and is never inflated by a weekly run.

## What was intentionally NOT changed

- No engine rewrite, no balance rewrite of normal mode: the only balance touch
  is the Boss-Rush-**only** scaling curve (rules allow a mode-specific modifier).
  Normal `_spawnBoss` scaling is byte-identical (guarded by `if (this.bossRush)`).
- No save wipe (additive field, version stays 8), no backend/server, no accounts.
- Normal run mode, boss spawning, debug tools/cheats, and mobile/touch controls
  are all untouched (verified — see below).
- Boss kits, telegraphs, and enraged phases are reused as-is (no per-boss edits).

## Verification

- `node --check` on all changed JS — clean. `validate-assets` + `validate-bosses`
  → OK.
- Headless harness smoke, CI path (`?seconds=20&badge=1`): `DONE EXC:0`, enemies
  alive.
- **14/14 functional tests** (Playwright driving the exposed `window.__game`):
  normal run intact (EXC 0, enemies alive); Boss Rush starts, spawns the first
  boss after prep, advances on each boss death, spawns the next, clears →
  victory; recap `runSummary` correct (12/12, cleared, hero, final boss); save
  banked (`bestBosses` set, version still 8); death-path recap carries Boss Rush
  fields; and normal boss spawning still works.
- Visual: menu BOSS RUSH CTA, prep HUD (incoming boss + countdown), and fight
  HUD (progress + next preview, clear of the boss bar) all render correctly.

## Files changed

New:
- `src/content/bossRush.js` — config, sequence builder, scaling, score, Weekly Ember seed hook.
- `src/systems/BossRushController.js` — the mode state machine.

Modified:
- `src/core/Game.js` — `bossRushMode` flag; `_startRun` branch + controller build;
  `_spawnBoss` mode scaling; card-queue branches + `_queueBossRushCard`;
  `_bankBossRush` + call sites; menu/gameplay debug shortcuts + helpers.
- `src/core/RunState.js` — reset `bossRush` + `_bossRushRecorded` + `bossRushBestNew`.
- `src/core/GameUpdate.js` — controller-driven boss cadence; suppress normal
  director / Lieutenant / trash spawner in the mode.
- `src/core/CombatResolver.js` — boss-death progression branch.
- `src/core/GameInputActions.js` — `'startBossRush'` action + clear flag in the other starts.
- `src/systems/MenuRenderer.js` — `_drawBossRushButton` + CTA-row rebalance.
- `src/systems/SaveSystem.js` — additive `bossRush` record + `recordBossRush`.
- `src/systems/UISystem.js` — `_drawBossRushHud` + Boss-Rush game-over stats.
- `src/systems/UIStateBuilder.js` — `base.bossRush` (run HUD) + `base.bossRushBest` (menu).
- `src/content/cardTemplates.js` — `drawBossRushCard` + registration.
- `tools/artshot/harness.html` — expose `window.__game` for headless tests (dev tooling only).
