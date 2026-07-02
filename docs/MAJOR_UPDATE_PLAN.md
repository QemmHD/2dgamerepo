# EMBERWAKE — Major Update Plan: "THE LONG VIGIL"

*Synthesized from five specialist reviews (balance, content, code, ux, meta), 2026-07-02.
Every numeric claim below was re-verified against the code at the cited file/line before
inclusion.*

---

## 1. State of the game

The moment-to-moment spine is genuinely good: boss cadence and arenas (`BossDirector.js`,
12 bosses × 8–10 attacks over 14 attack kinds in `src/config/GameConfig.js` ENEMY),
composure-adaptive damage, lieutenants, pooled/budgeted FX, and a clean, honest meta
economy (single price source-of-truth, transparent pity, no dark patterns). The choice
architecture — patrons, keystones, relics, pacts, roads, fusions — is unusually rich for
a survivor game.

But four structural problems cap it:

1. **Runs end before they pay off.** Hypergrowth (`GameConfig.js:975-977`,
   `hyperStartMinutes: 13`, `hyperPerMinuteMul: 2.0`) is a deliberate soft time-limit,
   but it lands *before* the game's own payoff loop completes: L8 + evolution is
   realistically reachable min 9–12 through a ~30-card diluted draft
   (`UpgradeSystem.js:141-148`), while CAPS (`GameConfig.js:99`) and
   `BOSS.hpPerMinute` (`:620-625`, "30m→7.0×") are commented for 20–30-min builds.
   One evolution (`infernoStorm`, `weapons.js:267-286`: 22 dmg/0.44s twin ≈ 100 DPS)
   is a strict downgrade from its L8 base (`emberWisp` 56/0.28 ≈ 200 DPS + 28 burn);
   its comment cites stale stats ("14 dmg / 20 burnDps"). Fusions claim
   "net-neutral-or-better" (`fusions.js:5`) but produce an L1 result from L8 inputs.
2. **Content is thinner than the systems wrapped around it.** 6 base attack weapons
   collapsing into ~4 core behavior kinds (projectile/orbit/pulse/lightning); 4 biomes
   that are tints + flat multipliers with a **global** enemy mix; 16 trash types on 5
   behaviors; 3 roads. A player sees essentially everything in ~2 hours; hours 3–5 are
   coin grind (`COST_SCALE 2.2`, `COSMETIC_COST_MULT 2`, attunement 187k coins).
3. **Zero onboarding, buried daily loop, dead rewards.** No first-run path exists
   (no `runs === 0` gating anywhere in `src/`); 9 menu tabs (`MenuRenderer.js:56-66`)
   hit new players at once; Battle-Pass XP earned at death (`Game.js:2244` `bpResult`)
   is computed but **never rendered** on game-over; the purchased Heirloom Cinders
   upgrade is a literal no-op (`Game.js:668/771/1000` subtracts the granted seed before
   banking, and run coins have no mid-run spend).
4. **Engineering debt at the edges of a healthy core.** `Game.js` is 4,119 lines;
   `ObstacleSystem._nearby` (`:286-301`) allocates Set + array + string keys per query,
   hit multiple times per enemy per frame; boot awaits all ~8.9 MB of art before first
   paint (`src/main.js:70-77`); save `version: 7` is write-only (`SaveSystem.js:111,317`);
   the only CI is `pages.yml` (deploy).

**Verdict: a great 13-minute game that deserves to be a great 20-minute game people
return to daily for a month.**

---

## 2. Vision & pillars

> **THE LONG VIGIL** — every run reaches its payoff, every biome and weapon plays
> differently, and the first five minutes teach themselves. EMBERWAKE stays a cozy
> dark-fantasy ember/forge survivor with monkey heroes and wand combat — we deepen it,
> we don't re-theme it.

**Pillar 1 — Runs that pay off.** Fix the endgame math so evolutions, fusions, and
late drafts land *inside* the run window; make every purchasable and pickable thing
actually do something.

**Pillar 2 — A world with teeth.** New wand behaviors, biomes with their own enemy
mixes and hazards, trash and lieutenants that borrow from the excellent boss attack
vocabulary, and modes/mastery that give hours 3–10 real goals.

**Pillar 3 — A welcoming vigil.** First-run onboarding, a surfaced daily loop, visible
rewards at death, mobile-sized targets, and a faster first paint — on an engineering
foundation (CI, GC-clean hot paths, decomposed `Game.js`) that keeps 60 fps on iOS.

---

## 3. Workstreams

Effort: **S** ≤ half a day · **M** 1–3 days · **L** ≥ a week. Every item lists concrete
files. All balance changes are verified with the artshot harness
(`tools/artshot/harness.html?seconds=35&badge=1` → `EXC: 0`) before shipping.

### P0 — Fix what's broken (correctness, trust, foundation)

**P0.1 — Endgame math coherence** · **S** · *Pillar 1*
- **WHAT:** Keep hypergrowth as the deliberate wall, but move it past the payoff loop:
  `hyperStartMinutes` 13 → ~20, `hyperPerMinuteMul` 2.0 → ~1.4. Re-verify
  `BOSS.hpPerMinute`/`maxHpMul` (`GameConfig.js:620-625`) and `WAVE_LIMITS`
  (`:980-990`) against the new ceiling. Smooth the twilight elite cliff:
  `twilightEliteFloor` 0.55 → 0.25 with `twilightEliteRampPerMin` raised so it climbs
  to `twilightEliteCap` 0.9 (`GameConfig.js:960-963`) instead of step-jumping at 9:00
  into the tier-3 apex boss window.
- **WHY:** The 13-min wall invalidates the tuning the rest of the file is written for
  and makes evolutions (reachable min 9–12) a 2-minute reward.
- **Files:** `src/config/GameConfig.js` (ENDLESS_SCALING, BOSS, WAVE_LIMITS comments).
- **Risk:** Medium — lengthens Gauntlet runs; verify with two harness runs
  (`seconds=35` early feel + a long-run debug fast-forward) and re-check the
  `gauntlet_3k/8k` achievement thresholds still make sense.

**P0.2 — Evolution & fusion honesty pass** · **S** · *Pillar 1*
- **WHAT:** (a) Fix `infernoStorm` (`weapons.js:280`): raise damage to ~48–52 using the
  same parity method documented in `arcaneStorm`'s comment (`weapons.js:210-214`);
  refresh its stale comment. (b) Audit all 5 evolution comments against current L8
  tables. (c) Make fusions inherit ingredient levels — result level =
  `floor(avg(a.level, b.level))` — where the fusion is forged (Wick Shrine flow,
  `src/systems/WickRoadsSystem.js` + `fusions.js`), so `fusions.js:5`'s
  "net-neutral-or-better" claim becomes true at all levels.
- **WHY:** One evolution is a trap; fusing two L8 weapons (~430 combined DPS) into an
  L1 cinderlance (~129 DPS) punishes the player for engaging with the system.
- **Files:** `src/content/weapons.js`, `src/content/fusions.js`,
  `src/systems/WickRoadsSystem.js`.
- **Risk:** Low — data-table changes; verify one fused-weapon run in the harness.

**P0.3 — Draft economy: make level-ups decisions again** · **M** · *Pillar 1*
- **WHAT:** (a) Add a weapon/ability slot cap (~5) surfaced on the level-up card UI.
  (b) Pity-weight owned-weapon upgrades (raise `WEIGHT_WEAPON_UPGRADE`
  (`UpgradeSystem.js:143`) dynamically as a weapon nears L8, so base-at-L8 + evolution
  lands by ~min 8). (c) Gate capped stat cards via `available()` — Quick Feet ×5
  exceeds `CAPS.moveSpeed 760` (`GameConfig.js:105`), and powerStone × glasswick ×
  momentum (4.74×) exceeds `CAPS.damageMul 3.5` — capped picks must stop appearing.
- **WHY:** Draft dilution makes the core payoff (evolutions) rarely reachable, and
  cap-blind cards are silently dead picks that erode trust.
- **Files:** `src/systems/UpgradeSystem.js` (`_buildPool`, weights),
  `src/content/passives.js` (add `available()` guards keyed off CAPS),
  `src/systems/UISystem.js` (slot count on cards), `src/config/GameConfig.js`.
- **Risk:** Medium — reshapes every run's draft; playtest at all 3 difficulties.

**P0.4 — Dead-reward fixes (Heirloom Cinders + game-over BP XP)** · **S** · *Pillars 1+3*
- **WHAT:** (a) Bank the Heirloom Cinders seed: drop the `startingCoinsGranted`
  exclusion (`Game.js:668, 771, 1000`) or convert the upgrade into "+N% banked coins"
  in `permanentUpgrades.js:78` — today 3,245c of purchases have zero effect.
  (b) Pipe `bpResult` (`Game.js:2244`) into the game-over snapshot built in
  `_buildUIState` (~`Game.js:3751-3933`) and draw a "+N Vigil XP → Lv M" bar in
  `UISystem._drawGameOverOverlay` (~`:1707`). (c) Debounce game-over buttons: hit-test
  only after fade-in (`age > 0.7`) instead of age 0 (`Game.js:414-422`).
- **WHY:** A purchasable no-op and an invisible core meta reward are the two cheapest
  trust repairs in the whole plan.
- **Files:** `src/core/Game.js`, `src/content/permanentUpgrades.js`,
  `src/systems/UISystem.js`.
- **Risk:** Low.

**P0.5 — CI: automate the existing verification pattern** · **S** · *Foundation*
- **WHAT:** Add `.github/workflows/ci.yml`: `node --check` over all `src/**/*.js`,
  `node tools/validate-assets.js`, and a headless-Chromium harness smoke
  (`tools/artshot/serve.py` + `harness.html?seconds=20&badge=1`, assert badge shows
  `EXC: 0` and enemies > 0) using the pinned Chromium at `/opt/pw-browsers/`.
- **WHY:** The verify-before-ship directive already exists — it's just manual. This is
  the safety net under every other workstream in this plan.
- **Files:** new `.github/workflows/ci.yml`; no `src` changes.
- **Risk:** Low — mirrors the deploy workflow's environment.

**P0.6 — Kill the per-frame allocation churn** · **S** · *Pillar 3 (iOS perf)*
- **WHAT:** In `ObstacleSystem._nearby` (`ObstacleSystem.js:286-301`): numeric cell
  keys (`gx * K + gy`), a reusable scratch array, generation-stamp dedupe instead of a
  fresh `Set`. Same treatment for `_separateEnemies` bucket rebuild
  (`Game.js:1942-1952`). Consolidate the 5+ redundant full-enemy scans per frame
  (`Game.js:2388, 2405, 2452, 2475, 2958-2972`) into one pass.
- **WHY:** ~500–900 allocations/frame at the 180-enemy cap is the single biggest
  GC/frame-time hazard on iOS Safari.
- **Files:** `src/systems/ObstacleSystem.js`, `src/core/Game.js`.
- **Risk:** Low-medium — collision-adjacent; harness smoke + a 35s badge run gate it.

**P0.7 — Cinderbolt identity** · **S** · *Pillar 1*
- **WHAT:** Give the default starter (`arcaneBolt`) something its stat-identical
  siblings (`emberWisp`/`voltWand`, `weapons.js:148-197`) don't copy: ricochet from
  L1–2, or an innate element-neutral crit chance. Keep it element-less deliberately
  and say so in its description (keystone recipes, `keystones.js:34-38`, need an
  element — that's the trade).
- **WHY:** The starter being strictly outclassed teaches new players their default
  choice is wrong.
- **Files:** `src/content/weapons.js`.
- **Risk:** Low.

### P1 — The headline content & retention

**P1.1 — Wand Armory: weapon expansion** · **L** · *Pillar 2*
- **WHAT:** 6–8 new base weapons introducing NEW behavior kinds — boomerang wand-arc,
  channel beam, ember mine-layer, ground-fire trail, wisp drone/summon — each with an
  evolution; add the missing evolutions for `voltWand`/`frostmote`; fill the 7 missing
  fusion pairs in `fusions.js`. All wand/ember-flavored (never swords): e.g.
  "Ashfang Boomerang" is a returning wand-flung cinder, the beam is a channeled
  wand ray. New kinds need new update + draw functions; **pre-render any glow/beam
  gradients** (extend the `getGlowSprite` pattern) — no per-frame
  `createRadialGradient`.
- **WHY:** 23 defs currently collapse into ~6 distinct feels; this is the single
  biggest content multiplier because patrons (`patrons.js` — iron has 2 weapons,
  dawn 3), keystones, and fusions all deepen for free with every weapon added.
- **Files:** `src/content/weapons.js`, `src/content/evolutions.js`,
  `src/content/fusions.js`, `src/systems/WeaponSystem.js` (new kind handlers + draw),
  `src/content/patrons.js`, `src/content/keystones.js`, `src/content/weaponSkins.js`.
- **Risk:** Medium — biggest surface area; ship in two waves (3–4 weapons each) behind
  the P0.3 slot cap so drafts don't re-dilute. Requires P0.3 first.

**P1.2 — Biomes that play differently** · **M** · *Pillar 2*
- **WHAT:** (a) Per-map enemy weight tables via the existing `segmentWeights` merge
  hook (`Game.js:1682`, proven by `roads.js`) — crypts skews bats/eyeballs, dunes
  skews snakes/chargers, etc. (b) One signature hazard per biome (emberwood brambles,
  hollowreach ice slicks, crypts light-radius pressure, dunes quicksand) reusing the
  boss `zones`/`lingering` hazard pool — implemented inside the new HazardSystem
  (P1.5), not inline in `Game.update()`.
- **WHY:** 4 maps currently differ only by tint, props, boss trio, and flat
  multipliers (`Game.js:756, 1782`); the merge hook means (a) is nearly data-only.
- **Files:** `src/content/maps.js`, `src/config/GameConfig.js` (WAVES typeWeights),
  `src/core/Game.js:1682`, new `src/systems/HazardSystem.js`, `src/content/mapObjects.js`.
- **Risk:** Low for (a); medium for (b) — hazards must respect the procedural-fallback
  art discipline (procedural draw first, AI sheet optional later).

**P1.3 — Enemy & lieutenant behavior pass** · **M** · *Pillar 2*
- **WHAT:** 3–4 new trash behaviors (splitter, bomber, summoner, teleporter) added to
  the 5 existing ones; give the 3 LIEUTENANT types (`GameConfig.js:729`) 1–2 attacks
  each drawn from the existing 14-kind boss attack vocabulary (fan, zones, seekers…).
  Keep the canonical creature identities/style (PR #103 sheets) — new behaviors reuse
  existing bodies with procedural tells; any new creature art follows the approved
  Nano Banana 2 2×2-grid recipe with procedural fallback intact in `Enemy.js`
  `FRAMES_BY_TYPE`.
- **WHY:** 16 types on 5 behaviors means elites' affixes carry all the variety; the
  boss attack code already exists — lieutenants just need to borrow it.
- **Files:** `src/config/GameConfig.js` (ENEMY, LIEUTENANT), `src/entities/Enemy.js`,
  `src/systems/LieutenantDirector.js`, `src/systems/Spawner.js`.
- **Risk:** Medium — spawn-pressure interactions (summoner vs `maxEnemyCap 180`);
  cap summons under the existing alive-cap check in `Spawner.js`.

**P1.4 — First-run onboarding + staged menu** · **M** · *Pillar 3*
- **WHAT:** On `saveSystem` stats `runs === 0`, skip the menu into a guided first run
  with 3–4 contextual pop hints (move → auto-attack → XP gem → first level-up pick),
  replacing the permanent keyboard-first teach line (`UISystem.js:1343-1357`). Unlock
  non-PLAY tabs at natural moments (SKILLS after first coins banked, LOADOUT after
  first gear case, etc.) with a one-time "new" badge. Persist `onboarding` progress in
  the save (new key + version bump, gated on P2.4 migrations or an implicit-default
  field).
- **WHY:** Zero onboarding + a 9-tab dump (`MenuRenderer.js:56-66`) is the biggest
  retention lever in all five reports.
- **Files:** `src/core/Game.js` (boot path, `_startRun`), `src/systems/UISystem.js`,
  `src/systems/MenuRenderer.js`, `src/systems/SaveSystem.js`.
- **Risk:** Medium — touches boot flow; guard with a `?skipOnboarding=1` harness param
  so CI screenshots stay deterministic.

**P1.5 — Game.js decomposition (enables P1.2)** · **M** · *Foundation*
- **WHAT:** Carve out the ~900 lowest-coupling lines: `HazardSystem` (the 5 hazard
  kinds simmed inline in `update()` `Game.js:2254-3054` + 4 drawn inline in `render()`
  `:3062+`), a Mines/Case minigame overlay module (`:1108-1360, 3539-3700`), and a
  UIState builder (`:3751-3933`). Then split `update()` into named phase methods with
  the one consolidated enemy scan from P0.6. Defer input-router/boss extraction
  (higher coupling).
- **WHY:** Every P1 content item lands in `Game.js` otherwise; HazardSystem is a hard
  prerequisite for biome hazards.
- **Files:** `src/core/Game.js`, new `src/systems/HazardSystem.js`,
  new `src/systems/MinigameOverlay.js`, new `src/systems/UIStateBuilder.js`.
- **Risk:** Medium — pure-move refactor; ship with zero behavior change and gate on
  the CI harness smoke (P0.5) plus a before/after screenshot diff.

**P1.6 — Surface the daily loop + pay the Daily Road** · **S/M** · *Pillars 2+3*
- **WHAT:** (a) Move Today's Trials chips onto the PLAY tab beside the DAILY ROAD CTA
  (`MenuRenderer.js:911-932`; today they render only on STATS `:983-1013`).
  (b) Day-streak counter (`{day, count}` in save) shown on PLAY + game-over.
  (c) Daily Road payout: score-band coins + one first-clear-of-day case; show
  yesterday's best (`dailyRoad.js` already stores best-of-day). (d) Dot-badges on tabs
  with claimables (Battle Pass) or unfinished dailies.
- **WHY:** The hooks exist but are invisible; this is the cheapest daily-return win
  and stays dark-pattern-free (no expiry punishment, streak is celebratory only).
- **Files:** `src/systems/MenuRenderer.js`, `src/content/dailyRoad.js`,
  `src/systems/SaveSystem.js`, `src/core/Game.js` (banking), `src/systems/UISystem.js`.
- **Risk:** Low.

**P1.7 — Load-time diet** · **M** · *Pillar 3*
- **WHAT:** (a) Loading splash (procedural ember animation — no asset needed) drawn
  before the `await Promise.all` in `src/main.js:70-77`. (b) Split loading: menu needs
  only ~2.1 MB of `ui/*` — start the menu after those and stream gameplay sheets
  behind the start screen (all loaders already never-reject with procedural
  fallbacks, so partial loading is safe by design). (c) `pngquant`/`oxipng` pass over
  the 77 PNGs (~8.9 MB → ~3–4 MB; hero/UI PNGs are pixel art, PNG-8 quantize ≈ −60%).
- **WHY:** A blank canvas for the full 8.9 MB download is the first impression on
  GH Pages, especially mobile.
- **Files:** `src/main.js`, `src/assets/*.js` loaders, `src/assets/**/*.png`,
  `tools/` (add a `compress-assets.mjs` script + note in `ASSET_CREDITS.md` workflow).
- **Risk:** Medium — quantization must be visually diffed (artshot showcase mode) so
  the canonical enemy sheets don't drift; keep originals in git history.

### P2 — Deepen the tail

**P2.1 — Modes: Boss Rush + Weekly Ember** · **M** · *Pillar 2*
- **WHAT:** Boss Rush (12-boss gauntlet, reuses `BossDirector` with `spawnInterval`
  compressed and trash muted) and a Weekly Ember: 7-day seeded mutator run reusing the
  `dailyRoad.js` seeding plumbing, paying a Royal case. Add 4–6 constraint-style
  entries to the `dailyChallenges.js` pool ("win with orbit weapons only").
- **Files:** `src/content/dailyRoad.js` (generalize seed→week),
  new `src/content/weeklyEmber.js`, `src/systems/BossDirector.js`,
  `src/content/dailyChallenges.js`, `src/systems/MenuRenderer.js` (PLAY tab entry).
- **Risk:** Medium.

**P2.2 — Per-hero mastery + roster chase** · **M** · *Pillars 1+2*
- **WHAT:** Hero mastery levels (wins/damage per monkey) unlocking a signature perk
  tier per hero, built on the per-char pattern `pactMastery` already persists; add 1–2
  challenge-unlocked heroes with a unique starting wand each (all heroes remain
  MONKEYS; unlocks are skill-gated, never paid).
- **Files:** `src/content/characters.js`, `src/systems/CharacterSystem.js`,
  `src/systems/SaveSystem.js`, `src/systems/MenuRenderer.js` (CHARACTER tab).
- **Risk:** Medium.

**P2.3 — Meta tail: BP prestige, completion bounties, coinMul fix** · **S/M** · *Pillar 1*
- **WHAT:** (a) At BP 50 (`battlePass.js`), optional prestige to "Vigil II" with new
  milestone skins; meanwhile route overflow XP and the case `bpxp` consolation
  (`CaseSystem.js:219`) to coins. (b) Completion bounties: relic codex %, cosmetic-set
  completion, gear collection milestones — turn dead records into goals.
  (c) Apply `player.coinMul` to objective payouts (`Game.js:1414`) so coin builds
  match their advertised strength; rebalance objective amounts down ~10% to
  compensate. (d) Soften the attunement tail (`relics.js` ATTUNABLE, 187k coins) with
  visible per-notch increments.
- **Files:** `src/content/battlePass.js`, `src/systems/BattlePassSystem.js`,
  `src/systems/CaseSystem.js`, `src/content/achievements.js`, `src/core/Game.js`,
  `src/content/relics.js`.
- **Risk:** Low-medium (economy-wide; re-run the arc math from the meta report).

**P2.4 — SaveSystem hardening** · **M** · *Foundation*
- **WHAT:** Inject the storage backend, actually read `data.version` with a stepwise
  migration table, write a one-shot backup key before migrating, and add `node:test`
  coverage of `_validate` + migrations wired into CI (P0.5).
- **Files:** `src/systems/SaveSystem.js`, new `tests/save.test.mjs`,
  `.github/workflows/ci.yml`.
- **Risk:** Low — prerequisite for every P1/P2 item that adds save keys.

**P2.5 — Accessibility & mobile target pass** · **M** · *Pillar 3*
- **WHAT:** Colorblind-safe option (reuse `getRarityIcon` glyphs on card borders);
  UI/text scale setting; make case-reveal shake (`MenuRenderer.js:1926-1931`) and
  full-screen flashes respect `screenShake`/`reducedEffects`; grow menu tabs/toggles/
  steppers to ≥44 CSS px with hit-slop scaled by canvas scale (`Game.js:443-446`),
  collapsing 9 tabs to 5 + "More" on narrow screens; draggable volume sliders.
- **Files:** `src/systems/MenuRenderer.js`, `src/systems/UISystem.js`,
  `src/core/Game.js`, `src/systems/Renderer.js`.
- **Risk:** Medium (menu layout).

**P2.6 — Roads 3 → 9 + relic/pact spice** · **S** · *Pillar 2*
- **WHAT:** Add 6 segment archetypes to `roads.js` (the crossroads system is built —
  81 lines covers 3 roads today) and 3–4 build-warping relics/pacts (not single-stat
  nudges) to `relics.js`/`pacts.js`.
- **Files:** `src/content/roads.js`, `src/content/relics.js`, `src/content/pacts.js`.
- **Risk:** Low — data-only.

**P2.7 — Shared broad-phase grid (DEFERRED)** · **L** · *Foundation*
- **WHAT:** Unify `CollisionSystem.resolve`'s O(P×N) brute force
  (`CollisionSystem.js:39-47`) and enemy separation onto one grid. **Only if** P1.3
  summoners or future modes push caps above today's 180 enemies / 220 projectiles.
- **Files:** `src/systems/CollisionSystem.js`, `src/core/Game.js`.
- **Risk:** High for its payoff today — explicitly deferred.

---

## 4. Shipping sequence

Each patch is independently shippable to main (per repo directive: PR → squash-merge →
GH Pages deploy), verified by the P0.5 CI gate from v1.1 onward.

| Patch | Name | Contents | Theme |
|---|---|---|---|
| **v1.1** | **Keeper's Ledger** | P0.1, P0.2, P0.4, P0.5, P0.7 + quick wins | Trust repair: the math tells the truth, rewards are visible, CI guards the door. Pure config/data + 3 small code fixes — smallest, fastest win. |
| **v1.2** | **First Vigil** | P1.4, P1.6, P0.6, P1.7(a+c) | New-player fortnight: onboarding, surfaced dailies, splash + smaller PNGs, GC-clean hot path. Retention before content. |
| **v1.3** | **The Armory, pt. 1** | P0.3, P1.1 (first 3–4 weapons + 2 evolutions + fusion fills), P2.6 | Draft economy lands first, then the weapons that exploit it. Roads ride along (data-only). |
| **v1.4** | **Living Biomes** | P1.5 (refactor first, zero-behavior PR), then P1.2, P1.3 | HazardSystem extraction → biome mixes/hazards → new trash behaviors + lieutenant attacks. |
| **v1.5** | **The Armory, pt. 2 + The Long Watch** | P1.1 (remaining weapons), P2.1, P2.4, P1.7(b) | Second weapon wave, Boss Rush + Weekly Ember, save migrations, deferred loading. |
| **v1.6** | **Masters of the Ember** | P2.2, P2.3, P2.5 | Hero mastery + roster chase, BP prestige + bounties, accessibility/mobile pass. Closes the 10-hour arc. |

---

## 5. Quick wins (< 1 hour each — most can ride v1.1)

1. **infernoStorm damage 22 → ~50** + fix its stale comment (`weapons.js:277-283`).
2. **`hyperStartMinutes` 13 → 20, `hyperPerMinuteMul` 2.0 → 1.4** (`GameConfig.js:975-976`).
3. **Twilight floor 0.55 → 0.25** with a compensating ramp (`GameConfig.js:961-962`).
4. **Heirloom Cinders banking fix** — drop the `startingCoinsGranted` exclusion (`Game.js:1000`).
5. **Draw BP XP on game-over** — add `bpResult` to the snapshot (`Game.js:~3926`) + one bar in `UISystem._drawGameOverOverlay`.
6. **Game-over tap debounce** — hit-test only when `age > 0.7` (`Game.js:414-422`).
7. **Hide dev tools** — gate `debug`/`unlockMaps`/CHEATS (`MenuRenderer.js:68-75`) behind `?dev=1`; drop "Tap DBG" from the teach line (`UISystem.js:1343-1357`).
8. **Vigil 5 lull fix** — make wave 5 pressure monotonic vs wave 4 (WAVES table, `GameConfig.js:~901`).
9. **Objective coins respect `coinMul`** (`Game.js:1414`).
10. **Fusion comment or behavior** — if P0.2(c) slips, at minimum show the fusion's resulting L1 stats on the shrine card so the trade is informed (`WickRoadsSystem.js`).
11. **`node --check` + `validate-assets` CI** — the two-line version of P0.5 if the harness smoke needs more time.
12. **Add 2 road archetypes** to `roads.js` (data-only, follows existing shape).

---

## 6. NON-goals (explicitly out of scope for this update)

- **No engine/tooling migration.** No bundler, no TypeScript, no framework, no npm
  runtime deps — vanilla ES modules on GH Pages static deploy stays.
- **No re-theming.** Heroes stay monkeys; combat stays wand-based (no swords, ever —
  new "boomerang/beam" weapons are wand-flung cinders and wand rays); the five
  canonical creature identities keep their classic palettes (no fire/ember drift);
  fire styling remains world/menu/Ember-Warden only.
- **No art-pipeline shortcuts.** No AI asset ships without its procedural fallback
  intact (`Enemy.js` FRAMES_BY_TYPE chain), an `ASSET_CREDITS.md` row, and a passing
  `tools/validate-assets.js`.
- **No iOS-hostile rendering.** No `ctx.filter`, no per-frame gradient creation (new
  weapon FX must pre-render via the `getGlowSprite` pattern), no DOM UI overlays, no
  rAF-virtual-time tricks in the harness.
- **No cap raises without broad-phase.** `maxEnemyCap 180` / projectile 220 stand
  until P2.7 is actually justified.
- **No servers, no accounts, no online leaderboards.** Weekly/daily modes stay
  deterministic-seed, local-save only.
- **No monetization and no dark patterns.** No paid currency, no expiring rewards, no
  punitive streaks; the economy stays coin-only with transparent pity.
- **No hero replacement.** The player stays procedural + animated (4-dir ×
  idle/walk/cast/hurt); never a flat AI sprite.
- **No save wipes.** Every save-shape change ships through the P2.4 migration table
  with a pre-migration backup.
