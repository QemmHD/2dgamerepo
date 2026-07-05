# Update #10: THE SEVENTH AND EIGHTH WICKS

*Era III — The World Alight*

**Value verdict (ADDS):** Roster growth 6→8 with mechanically distinct kits (charge-banking splash, wound-triggered novas) fills verified gaps rather than re-skinning; the danger of 'two more stat lines' is answered by the kit designs, and PR5 wisely makes bespoke art non-blocking. Chronicles is the more skeptic-tested half: 40 authored quest steps reusing the dailyChallenges metric pattern is honest reuse, but the steps must be play-shaping tasks, not 'kill 500 with X' checkbox grind — that determines whether Chronicles is progression identity or filler.

## What it adds

Two genuinely new ways to play — Raiko the Stormcaller, whose kills splash stored shock onto neighbors and bank Static Charge into periodic chain-lightning bursts, and Nivara the Frostwarden, a tanky controller whose wounds vent chilling novas — filling the two verified empty niches (shock, frost-control) in a six-hero roster. Wrapped around the whole roster, Emberkin Chronicles gives all eight monkeys a 5-step signature quest chain (40 authored steps) that pays out lore pages, palette variants, and earned titles, turning hero selection from a stat choice into a progression identity.

## Design spec

# Update #10 — THE SEVENTH AND EIGHTH WICKS (Era III, deps: 1, 3)

Roadmap synopsis (ROADMAP.md:82-86): two new monkeys filling verified empty niches — a shock stormcaller and a frost warden — via the hero-body pipeline, plus Emberkin Chronicles: a 5-step signature quest chain per hero (all eight) unlocking lore pages, palette variants, titles. Hook: "kills leave neighbors crackling with stored storm-charge."

Niche verification: the six current heroes (characters.js:25-98) cover sustain (Pyra, regenBonus 1.0), fortune (Sylphine, coinMul 1.3), tank/thorns (Gruk, thornsBonus 0.3), fire+soft-frost caster (Orin, burnDamageMul 1.35 / chillBonus 0.15), low-HP berserker (Kael, lowHpRageBonus 0.3), crit (Vesper, critChanceBonus 0.15). NOBODY owns shock — the element with the deepest existing plumbing (stacking amp read at hit, weapons.js:1136-1163; burn detonation, SHOCK_CFG GameConfig.js:891) — and nobody owns frost CONTROL as a primary identity (Orin's 0.15 chillBonus is a rider). Both niches confirmed empty.

## 1. HERO 7 — Raiko, The Stormcaller (id: `stormcaller`)

**Fantasy**: a wiry storm-touched monkey whose fur crackles; every kill banks charge that the sky repays.

**characters.js entry** (follows the full contract at characters.js:14-23):
```js
stormcaller: {
  id: 'stormcaller', name: 'Raiko', title: 'The Stormcaller',
  description: 'Storm-touched skirmisher. Kills splash shock to neighbors and bank Static Charge; −12% HP.',
  stats: { hpMul: 0.88, speedMul: 1.05, damageMul: 1, cooldownMul: 0.94,
           critChanceBonus: 0.05, shockAmpBonus: 0.02,
           stormSplash: { stacks:1, radius:160, maxTargets:4, maxStacks:3, duration:4.0 },
           stormBurst:  { killsPer:25, radius:300, base:14, perLevel:1.2, guard:1.5 } },
  signature: { name: 'Stormbank', blurb: 'Every kill crackles outward — and the sky keeps a tally.' },
  palette: { fur:'#5c5470', furDark:'#39344a', furLight:'#8a80a8', face:'#efe6d8' },
  accent: '#ffe14a',           // matches the shock projectile trail (Projectile.js:12)
  feature: 'crest', tintAlpha: 0.56,
  unlock: { stat:'shockDetonations', target:150, desc:'Detonate 150 burns with shock', coins:6000 },
}
```
All numbers tunable. Palette deliberately clear of Vesper's slate `#3a4a66` (characters.js:94); accent = ELEMENT.shock family (GameConfig.js:886 `#ffe066`, trail `#ffe14a`).

**Mechanic A — Storm-Splash (the roadmap hook)**: in Game's kill pass (the block that already reads the dead enemy's element for particles, Game.js:3126-3131), if `player.stormSplash` is set, each kill applies `applyShock(3, 4.0)` (Enemy.js:357-360) to up to 4 active enemies within 160px of the corpse. STATUS ONLY — no damage — so a splash can never kill, therefore never re-trigger, therefore never chain (feedback-loop-proof by construction). A per-frame queue cap of 12 splashes (tunable) bounds the worst case (mass kills): ≤ 12 × 180 distance checks/frame. Shock is a damage-amp read at hit time (weapons.js:1142) that auto-floors on bosses — bounded by the existing discipline.

**Mechanic B — Static Burst (the stored-charge meter)**: `player.stormCharge` (run-scoped, Player.js field next to freezeChanceBonus at Player.js:151-152) increments +1 per kill. At 25 (tunable) it resets and releases a burst: all active enemies within 300px take `14 + 1.2 × player.level` damage (through the normal takeDamage → ctx.hits/killed路 so gems/coins/kill credit fire — same rule shockStrike follows at weapons.js:1144-1146) and gain +1 shock stack. Re-trigger guard 1.5s (bank continues, release waits). VFX: the pooled shockwave ring (Game.js:1342, drawn 3532-3610) tinted `#ffe14a` + the existing shockSparks emitter (Game.js:3131). HUD: 4 tiny charge pips arcing above the player HP bar (drawWorldHealthBar region, Player.js:801-810), lit in quarters — procedural, no art.

**Mechanic C — passive amp**: `player.shockAmpBonus` (+0.02/stack) added into `perStack` at the single shock hook, exactly where ks_overcharge already reads (weapons.js:1140-1141): `const perStack = (cfg.shockPerStack ?? 0) + (overcharge ? 0.5 : 0) + (player?.shockAmpBonus ?? 0)`.

**CharacterSystem.applyCharacter** (CharacterSystem.js:11-44) gains three lines in the signature block (after line 39): copy stormSplash/stormBurst objects onto the player, add shockAmpBonus — same bounded += / object-stamp pattern as every other source.

## 2. HERO 8 — Nivara, The Frostwarden (id: `frostwarden`)

**Fantasy**: a heavy-pelted warden of the cold hours; winter answers when she is struck.

```js
frostwarden: {
  id: 'frostwarden', name: 'Nivara', title: 'The Frostwarden',
  description: 'Patient warden. Tough and slow; blows against her vent a chilling nova. +15% HP, −8% damage taken.',
  stats: { hpMul: 1.15, speedMul: 0.96, damageMul: 1, cooldownMul: 1,
           damageTakenMul: 0.92, chillBonus: 0.20, freezeChanceBonus: 0.05,
           rimeNova: { chillMul: 0.60, radius: 240, duration: 2.5 } },
  signature: { name: 'Rimeward', blurb: 'Strike the warden and winter strikes back.' },
  palette: { fur:'#7fa3b8', furDark:'#4e6b7e', furLight:'#a9cdda', face:'#f2f7fa' },
  accent: '#7fe0ff',           // = ELEMENT.frost tint (GameConfig.js:884)
  feature: 'ruff', tintAlpha: 0.54,
  unlock: { stat:'frostKills', target:400, desc:'Fell 400 chilled or frozen Hollow', coins:6000 },
}
```

**Identity via EXISTING bounded fields**: chillBonus feeds `player.chillStrength` (CharacterSystem.js:38 → consumed weapons.js:1005 and :1583) deepening every frost weapon's slow; freezeChanceBonus feeds the hard-freeze proc (Player.js:152 → weapons.js:1008-1010, 1599-1601). Boss safety is inherited: applyFreeze is boss-exempt (Enemy.js:350-353), applyChill boss-floored at 0.80 (Enemy.js:338).

**Mechanic — Rime Nova (the one new hook)**: when the player actually takes damage (Player.takeDamage, Player.js:219, sets a `_rimeNovaPending` flag consumed once by Game's update — i-frames already gate hit cadence, so nova cadence is capped for free), all enemies within 240px get `applyChill(0.60, 2.5)`. Pure CC, zero damage; VFX = frostShards emitter (Game.js:3130) + a `#bfe8ff` ring. This converts tankiness into crowd control — a defensive identity no other hero has.

**Kindle/ult note (dep 3)**: both heroes use the standard KINDLED ult mapping — no new ult archetypes here (KINDLED owns that system); their signatures interact with it naturally (a Kindle nova as Raiko banks a full Static meter instantly).

## 3. Unlock system (NEW plumbing)

Today there is NO hero gating: `CHARACTERS[*].unlocked` is dead data (never read), and setSelectedCharacter validates id membership only (SaveSystem.js:538-541). This update adds:
- `save.heroes.unlocked: []` (additive). The 6 starters bypass the check entirely (no `unlock` block on their defs) — old saves keep everything.
- SaveSystem: `isHeroUnlocked(id)` (no unlock block → true), `unlockHero(id)` (returns newly-unlocked bool, same shape as unlockCosmetic SaveSystem.js:490-494), and a guard in setSelectedCharacter; _validate falls back selectedCharacter to DEFAULT_CHARACTER if a save selects a still-locked hero.
- Lifetime tracking: `stats.shockDetonations` increments in the shockStrike detonate branch (weapons.js:1148-1162) via a run counter folded at recordRun (SaveSystem.js:444-471, incrementStat pattern like Game.js:1202); `stats.frostKills` = kills with chillTimer>0 or freezeTimer>0, counted in the kill pass. Both numeric → auto-validated (SaveSystem.js:46-47 pattern).
- Unlock check runs at game-over next to _checkAchievements (Game.js:1105-1129): threshold met → unlockHero + banner "★ THE SEVENTH WICK IGNITES — RAIKO UNLOCKED ★" (waveDirector.announce pattern, Game.js:1175) + runSummary flag for the game-over screen.
- Coin fallback: the character detail panel offers UNLOCK — 6,000 coins (never hard-walled; mirrors the shop buy affordance MenuRenderer.js:1992).
- Menu: the chip grid (MenuRenderer.js:881-907, cols=3 — 8 chips = 3 rows, the chipH clamp at :886 already absorbs it) renders locked chips at 0.5 alpha with a padlock + short requirement, the exact treatment locked maps get (MenuRenderer.js:1012-1019); tapping a locked chip selects it in PREVIEW (shows unlock panel) but cannot START with it.

## 4. Emberkin Chronicles — 5 steps × 8 heroes

**Engine**: NEW `src/content/chronicles.js`, cloning the dailyChallenges metric-vs-run-summary shape (dailyChallenges.js:10-24, metricValue :56+). Steps are SEQUENTIAL; only the selected hero's chain advances (`summary.characterId === heroId` — characterId added to both runSummary builders, Game.js:1206-1213 and ~:2531); max ONE step per run (≥5 runs per hero by design). Progress: `save.chronicles[heroId].step` (0..5, clamped). Evaluated at game-over in a `_checkChronicles()` sibling of _checkDailyChallenges (Game.js:1135-1148): pays coins, pushes a "CHRONICLE — 'Overcast' complete +90" name onto the summary, increments stats.chronicleSteps (+chroniclesCompleted at step 5).

**Run counters** (`this.chron` on Game, reset in _startRun, folded into `runSummary.chron`): heal (accumulate healSustained returns, Player.js:333-340), pickups, chests, thornsDmg, dmgTaken (Player.js:219), killsLow (kill while hp<50%), lowTime (dt while hp<40%), burnKills / chillKills / frozenKills / eliteKillsShocked (kill pass reads the corpse's burnTimer/chillTimer/freezeTimer/shockStacks — all already flat scalars, Enemy.js:260-268), critHits / critKills / bigHit (at the crit roll site), shockApplied (weapons.js:1147), shockDet (weapons.js:1148 branch), staticBursts, chillApplied (weapons.js:1006/:1592-1594), freezes (weapons.js:1010/:1601, non-boss only), comboBest already exists (Game.js:686). ~16 integer increments at existing single hooks — no new scans.

**The 40 steps** (all targets tunable; coins 60/90/120/160/250; step 3 → palette variant, step 5 → title, every step → lore page):

- **PYRA — "The First Wick"**: 1 Kindling — survive 8:00 · 2 Wellspring Overflowing — heal 400 HP in one run · 3 The Gatherer — collect 500 pickups → *Ashenpelt* variant · 4 Twin Pyres — defeat 2 bosses in one run · 5 The First Flame Rekindled — win a 3-boss run → title **Keeper of the First Flame**
- **SYLPHINE — "The Gilded Road"**: 1 Pocketful of Cinders — earn 700 coins in a run · 2 Chestcracker — open 4 chests in a run · 3 Fleetfoot — reach wave 5 → *Moongrove* · 4 Windfall Proper — earn 2,000 coins in a run · 5 The Gilded Gale — win with 2,500+ coins earned → title **The Gilded Gale**
- **GRUK — "The Unbroken Line"**: 1 Take the Hit — take 600 damage and still reach 6:00 · 2 Spite Made Flesh — reflect 400 thorns damage · 3 Still Standing — survive 12:00 → *Ironhide* · 4 The Wall Answers — reflect 1,200 thorns damage · 5 The Mountain That Walks — win having taken 1,500+ damage → title **The Mountain That Walks**
- **ORIN — "The Cinder Codex"**: 1 First Spark — fell 100 burning Hollow in a run · 2 Scholar of Ash — reach level 22 · 3 Combustion Theory — trigger 30 shock detonations → *Duskrobe* · 4 The Long Burn — fell 350 burning Hollow · 5 The Cinder Sage — win with 400+ burn kills → title **The Cinder Sage**
- **KAEL — "The Brink"**: 1 Flirting with Dark — 100 kills below half HP · 2 Chainfire — reach a 25 kill-streak (comboBest) · 3 No Fear — fell a boss while below 30% HP → *Bloodember* · 4 Dancing on the Wick — 3 cumulative minutes below 40% HP · 5 The Deathless Brink — win with 300+ kills below half HP → title **The Deathless Brink**
- **VESPER — "The Quiet Ledger"**: 1 First Blood — 120 critical hits in a run · 2 Clean Work — 60 crit kills · 3 One Perfect Cut — land a single 250+ damage hit → *Palefang* · 4 The Ledger Fills — 400 critical hits · 5 The Quiet Knife — win with 150+ crit kills → title **The Quiet Knife**
- **RAIKO — "The Gathering Storm"**: 1 Static in the Fur — apply shock 150 times · 2 Overcast — release 8 Static Bursts · 3 Lightning Rod — 40 shock detonations → *Thunderhide* · 4 Conductor — fell 3 elites while shocked · 5 The Sky's Wrath — win with 20+ Static Bursts → title **The Sky's Wrath**
- **NIVARA — "The Long Winter"**: 1 First Frost — chill 200 Hollow · 2 Deep Freeze — hard-freeze 30 Hollow · 3 Harvest of Rime — fell 150 chilled Hollow → *Glacialpelt* · 4 The Stillness — fell 60 frozen Hollow · 5 The Long Winter — win with 400+ chilled kills → title **The Long Winter**

Element-hero chains double as build tutors (Orin/Raiko teach the burn-detonate combo; Nivara teaches chill-stacking, GameConfig.js:880-884).

## 5. Lore pages, palette variants, titles

- **Lore**: NEW `src/content/loreChronicles.js` — 8×5 pages (60-90 words, ember-script dark-fantasy voice). Read via a CHRONICLE panel inside the existing character customizer (MenuRenderer._drawCharacter, :1780 region): a 5-pip progress strip under the hero blurb (`●●●○○ — Step 4/5: 'Conductor' — fell 3 elites while shocked`) + tap → a parchment lore overlay (procedural framing; the shop-detail overlay pattern). Deliberately NOT in update 12's Codex — Chronicles lore is hero-personal, lives with the hero.
- **Palette variants**: step ≥ 3 unlocks the hero's `variants.chronicle` palette. ZERO new art: HeroAiSprites tints the shared sheet from the palette object (HeroAiSprites.js:69-71) and features re-read palette/accent (:78-82). Equipped via `save.heroVariants[heroId]` toggle chip in the customizer; run + menu preview both resolve through one `resolveHeroPalette(save, id)` helper. Example: Raiko *Thunderhide* { fur:'#3a4458', accent:'#9fd8ff' }, Nivara *Glacialpelt* { fur:'#9fb8c8', accent:'#e6f6ff' }.
- **Titles**: step 5 sets the hero's earned title, rendered under the name in the customizer, on the game-over summary, and (REUSE, guarded `if (compositor)`) on the Emberglass death/recap card from update 2 — "PYRA, Keeper of the First Flame, fell at 14:32". Derived from step==5; no extra save key.
- **Achievements** (append-only rows in achievements.js, checked against stats per the :33-41 contract): `wick_chronicler` — complete one full Chronicle, 250c (stats.chroniclesCompleted ≥ 1); `the_eight_wicks` — complete all eight, 1,000c (≥ 8).

## 6. What is NEW vs REUSED

NEW: chronicles.js, loreChronicles.js, STORMBANK/RIMEWARD config blocks, save keys (heroes/chronicles/heroVariants/4 numeric stats), hero-unlock API + locked-chip UI, storm-splash/static-burst/rime-nova hooks, Chronicle panel + lore overlay, 2 hero defs + 8 variant palettes + 2 features.
REUSED (extended, never forked): the signature bounded-field contract (characters.js:6-23, CharacterSystem.js:27-42), applyShock/applyChill/applyFreeze status stamps (Enemy.js:337-360), the single shockStrike hook (weapons.js:1136-1163), the daily-challenge quest-check pattern (dailyChallenges.js), achievements pipeline (Game.js:1105-1129), recordRun/incrementStat (SaveSystem.js:444-471), pooled shockwave rings + element particle emitters (Game.js:1342, 3126-3131), palette-tint hero rendering (HeroAiSprites.js:69-82), map-lock chip UI pattern (MenuRenderer.js:1006-1019), Blender hero pipeline (tools/blender/monkey_rig.py + render_sheets.py) and pixelate-sheet.mjs.

## PR plan

### PR1 — PR1 — The Seventh Wick: Raiko the Stormcaller + hero-unlock plumbing

**Goal:** Ship the shock hero end-to-end (splash, Static Burst, amp bonus) and build the reusable hero-gating layer (save key, locked chips, unlock banner, coin fallback) that PR2 rides for free.

**Files:**
- `src/content/characters.js`
- `src/systems/CharacterSystem.js`
- `src/entities/Player.js`
- `src/core/Game.js`
- `src/content/weapons.js`
- `src/config/GameConfig.js`
- `src/systems/SaveSystem.js`
- `src/systems/MenuRenderer.js`
- `src/assets/HeroAiSprites.js`

**Work:**
- Add stormcaller def (palette/signature/holds/unlock block) to characters.js + CHARACTER_HOLDS row
- STORMBANK config block in GameConfig.js next to SHOCK_CFG (line ~891)
- CharacterSystem.applyCharacter: stamp stormSplash/stormBurst/shockAmpBonus (after line 39)
- Player.js: stormCharge field (near line 151) + charge-pip drawing above the HP bar (~line 801)
- Game.js kill pass (~3065-3131): storm-splash queue (cap 12/frame) + Static Burst trigger with 1.5s guard, ring + shockSparks VFX; count staticBursts/shockDet run counters
- weapons.js shockStrike: + player.shockAmpBonus at line 1141; increment detonation counter in the 1148 branch
- SaveSystem: heroes.unlocked key, isHeroUnlocked/unlockHero, setSelectedCharacter guard, selectedCharacter fallback for locked ids, stats.shockDetonations, version 7→8 (lines 126/360)
- MenuRenderer chip grid (881-907): locked rendering (padlock + requirement, map-chip pattern 1012-1019), preview-select, detail-panel coin unlock (6,000c)
- HeroAiSprites: 'crest' procedural feature overlay
- Game-over unlock check + announce banner beside _checkAchievements (1105-1129)

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- harness.html?badge=1&seconds=35 → EXC: 0
- harness screen=menu&tab=character screenshot: 7 chips, Raiko locked w/ padlock
- Seeded-save harness run as Raiko (35s): splash halos on neighbor kills, one Static Burst ring visible, charge pips render
- v7 save fixture loads clean: starters selectable, no data loss, version reads 8 after save

### PR2 — PR2 — The Eighth Wick: Nivara the Frostwarden

**Goal:** Ship the frost-control hero on the PR1 gating layer: Rime Nova on-hurt CC, deepened chill/freeze identity, frostKills lifetime unlock stat.

**Files:**
- `src/content/characters.js`
- `src/systems/CharacterSystem.js`
- `src/entities/Player.js`
- `src/core/Game.js`
- `src/config/GameConfig.js`
- `src/systems/SaveSystem.js`
- `src/assets/HeroAiSprites.js`

**Work:**
- frostwarden def + holds row in characters.js (unlock: frostKills ≥ 400 / 6,000c)
- RIMEWARD config block in GameConfig.js
- CharacterSystem: stamp rimeNova (chillBonus/freezeChanceBonus already wired at lines 38 + Player.js:152)
- Player.takeDamage (219): set _rimeNovaPending behind i-frames; Game consumes it → applyChill(0.60, 2.5) within 240px + frostShards VFX
- Kill pass: chillKills/frozenKills counters; recordRun folds stats.frostKills
- HeroAiSprites: 'ruff' feature overlay

**Verify:**
- node --check, validate-assets exit 0, harness badge EXC: 0
- Menu screenshot: 8 chips in 3 rows, both new heroes locked states correct, chipH clamp (MenuRenderer.js:886) holds on short-card viewport
- Seeded run as Nivara: nova chill tint on attackers after a hit; boss visually unaffected below the 0.80 floor (no permafreeze)
- Counters sanity: console dump of runSummary.chron shows chillKills/frozenKills incrementing

### PR3 — PR3 — Emberkin Chronicles: the quest engine + all 8 chains

**Goal:** The 40-step sequential quest system: run counters, game-over evaluation + payouts, per-hero progress strip in the customizer, chronicle achievements.

**Files:**
- `src/content/chronicles.js (NEW)`
- `src/core/Game.js`
- `src/entities/Player.js`
- `src/content/weapons.js`
- `src/systems/SaveSystem.js`
- `src/systems/MenuRenderer.js`
- `src/content/achievements.js`

**Work:**
- chronicles.js: CHRONICLES (8×5 steps w/ metric/target/coins/reward), currentStep, evaluateChronicle (dailyChallenges.js pattern)
- Game.this.chron counter object (~16 ints) reset in _startRun; increments at the cited hooks (kill pass, healSustained, takeDamage, shockStrike, chill/freeze call sites, chest/pickup sites); comboBest reused (Game.js:686)
- characterId + chron folded into BOTH runSummary builders (1206-1213 and ~2531)
- _checkChronicles() beside _checkDailyChallenges (1135-1148): one step max, coins, banner, stats.chronicleSteps/chroniclesCompleted
- SaveSystem: chronicles key (step 0..5 clamp) + the two numeric stats
- MenuRenderer character tab (~1780): 5-pip Chronicle strip + current-step text
- achievements.js: wick_chronicler 250c, the_eight_wicks 1,000c (append-only)

**Verify:**
- node --check, validate-assets, harness badge EXC: 0
- Scripted harness run meeting Pyra step 1 (survive 8:00 via seconds=490 easy) → game-over shows CHRONICLE banner, save.chronicles.monkey.step === 1, coins paid once
- Replay same condition → step does NOT re-complete (sequential + idempotent)
- Run with a different hero selected → Pyra chain untouched
- v7→v8 fixture: chronicles defaults to {} without error

### PR4 — PR4 — Chronicles rewards: lore pages, palette variants, earned titles

**Goal:** Make the chains pay identity: 40 lore pages behind a parchment overlay, 8 step-3 palette variants (pure data recolors), 8 step-5 titles on menu/game-over/Emberglass card.

**Files:**
- `src/content/loreChronicles.js (NEW)`
- `src/content/characters.js`
- `src/systems/MenuRenderer.js`
- `src/systems/SaveSystem.js`
- `src/core/Game.js`
- `src/assets/HeroAiSprites.js`

**Work:**
- loreChronicles.js: 8×5 authored pages (60-90 words, ember-script voice)
- characters.js: variants.chronicle palette + earnedTitle for all 8 heroes
- SaveSystem: heroVariants key ('base'|'chronicle', honored only at step ≥ 3)
- resolveHeroPalette helper used by run init + menu preview + HeroAiSprites tint (69-71)
- Customizer: variant toggle chip + lore overlay (tap the Chronicle strip)
- Titles: name line in customizer, game-over summary, guarded Emberglass compositor field (update 2 reuse)

**Verify:**
- node --check, validate-assets, harness badge EXC: 0
- Fixture save at step 3 → variant chip appears, menu preview AND in-run sprite recolor (two screenshots)
- Fixture at step 5 → title renders on customizer + game-over; death card shows titled name when compositor present
- Fixture at step 0 → heroVariants forced 'base'; no locked content leaks

### PR5 — PR5 — Bespoke Blender bodies for Raiko and Nivara (non-blocking art)

**Goal:** Trailing art polish: two parametric body presets on the update-1 hero-body pipeline; game is fully shipped without it.

**Files:**
- `tools/blender/monkey_rig.py`
- `tools/blender/render_sheets.py`
- `src/assets/hero/ (generated sheets)`
- `src/entities/Player.js (HAND anchors)`
- `src/systems/MenuRenderer.js (anchor mirror)`
- `ASSET_CREDITS.md`

**Work:**
- Raiko preset: lean torso, crest tuft geometry, forked tail tip; Nivara preset: +10% girth, ruff mass, short tail
- render_sheets.py per-hero output dirs; full 21-frame contract + anchors.json per body
- pixelate-sheet.mjs install (--cell=256 --logical=96 --colors=32 --outline=1); paste fresh HAND anchors
- HeroAiSprites: per-hero sheet resolve with shared-sheet fallback kept working

**Verify:**
- python3 render_sheets.py exits 0 (contract checks) per preset
- node tools/validate-assets.js exit 0
- harness badge EXC: 0 + side-by-side menu screenshots of both bodies in all 4 directions
- Fallback test: delete generated sheets → game still renders both heroes via shared sheet + tint

## Data & save changes

NEW content files:
- src/content/chronicles.js — CHRONICLES map (8 hero ids → 5 sequential steps: {id, name, desc, metric, target, coins, reward:'lore'|'variant'|'title'}), currentStep(save, heroId), evaluateChronicle(save, heroId, summary) mirroring the dailyChallenges metric-vs-summary pattern (dailyChallenges.js:10-24, 56+); metricValue reads summary.chron.* counters.
- src/content/loreChronicles.js — LORE map (8 heroes × 5 pages, 60-90 words each, ember/forge dark-fantasy voice; monkeys + wands canon).

Extended content files (append-only):
- src/content/characters.js — two new CHARACTERS entries (stormcaller, frostwarden) with unlock:{stat, target, coins} block; `variants:{chronicle:{palette,accent}}` block added to all 8 heroes; `earnedTitle` string per hero; two CHARACTER_HOLDS rows.
- src/content/achievements.js — 2 appended rows (wick_chronicler, the_eight_wicks) reading new numeric stats.

Save schema (ALL additive; version 7 → 8 at SaveSystem.js:126/:360; clamp+migrate in _validate):
- heroes: { unlocked: [] } — validateIdList against known GATED ids only; the 6 starters remain unconditionally unlocked so v7 saves lose nothing.
- chronicles: { [heroId]: { step: int } } — clamped 0..5 integer per known hero id.
- heroVariants: { [heroId]: 'base'|'chronicle' } — invalid values → 'base'; 'chronicle' only honored when step ≥ 3.
- stats additions (numeric → auto-validated by the existing stats loop per SaveSystem.js:46-47): shockDetonations, frostKills, chronicleSteps, chroniclesCompleted.

Config blocks:
- GameConfig.js: STORMBANK = { splash:{stacks:1,radius:160,maxTargets:4,maxStacks:3,duration:4.0,perFrameCap:12}, burst:{killsPer:25,radius:300,base:14,perLevel:1.2,guard:1.5} } and RIMEWARD = { chillMul:0.60, radius:240, duration:2.5 } next to ELEMENT/SHOCK_CFG (GameConfig.js:875-891).

Run-scoped (never saved): Game.this.chron counter object (~16 integer fields), folded into runSummary.chron at both summary builders.

## Balance numbers (all tunable)

| Number | Start value | Rationale (all tunable) |
|---|---|---|
| Raiko hpMul / speedMul / cooldownMul / critChanceBonus | 0.88 / 1.05 / 0.94 / +0.05 | Glass-caster band between Orin (0.8 hp) and Vesper (0.9 hp); cooldownMul milder than Orin's 0.88 because the signature adds free damage |
| Raiko shockAmpBonus | +0.02/stack | Weapon baseline is 0.08/stack (weapons.js:140); +25% relative amp, dwarfed by Overcharge's +0.5 so the keystone stays the spike |
| Storm-Splash (on-kill) | 1 stack, r=160, maxTargets=4, maxStacks=3, dur=4.0s | Matches weapon shockDuration 4.0; status-only (no damage) so it can never chain-kill; ≤12 splashes processed/frame |
| Static Burst | 25 banked kills → burst; dmg 14+1.2×level; r=300; +1 shock stack to all hit; 1.5s re-trigger guard | ~min 10 (lv~20) burst ≈ 38 dmg — a screen-clear assist, not a nuke; guard caps DPS contribution during kill storms |
| Nivara hpMul / speedMul / damageTakenMul | 1.15 / 0.96 / 0.92 | Second-tankiest after Gruk (1.35/0.87) — a warden, not a wall |
| Nivara chillBonus / freezeChanceBonus | +0.20 / +0.05 | chillBonus deepens weapon chill (weapons.js:1005); freeze bonus mirrors the Winterbite relic's +0.06 (relics.js:107) |
| Rime Nova (on-hurt) | chillMul 0.60, r=240, dur 2.5s, gated by player i-frames | applyChill boss-floor 0.80 (Enemy.js:338) prevents boss cheese; i-frames cap cadence |
| Raiko unlock | lifetime stats.shockDetonations ≥ 150, OR 6,000 coins | ~3-5 runs with any shock+fire pairing; teaches the detonate combo |
| Nivara unlock | lifetime stats.frostKills ≥ 400, OR 6,000 coins | chilled+frozen kills; ~3-4 frost-weapon runs |
| Chronicle step payouts | 60/90/120/160/250 coins (680/hero, 5,440 all 8) | Roughly doubles the existing 2,890-coin achievement economy over the long tail — intended late-game sink feed |
| Chronicle pacing | 1 step per run max, selected hero only | Guarantees ≥5 runs/hero, ≥40 runs total engagement floor |
| New achievements | wick_chronicler 250c (1 full chain), the_eight_wicks 1,000c (all 8) | Sits between hard_win 400c and a capstone above gauntlet_8k 500c |
| Perf caps | splash queue ≤12/frame; burst O(≤180) scan behind 1.5s guard; nova behind i-frames | Keeps the 180-enemy frame budget intact by construction |

## Art needs (non-blocking)

- Blender parametric hero bodies for Raiko and Nivara (NON-BLOCKING, PR5): extend tools/blender/monkey_rig.py build_monkey with two parameter presets — Raiko: lean torso (-8% girth), swept-back crest tuft, longer tail with forked tip; Nivara: stocky torso (+10% girth), thick neck ruff mass, shorter tail. Render via render_sheets.py (21 frames, 7-col contract, GRIP anchors) then pixelate-sheet.mjs --cell=256 --logical=96 --colors=32 --outline=1. Until then both heroes ship on the shared hero sheets + palette tint (HeroAiSprites.js:69-71) — fully playable from PR1.
- Procedural feature overlays (SHIP IN PR1/PR2, code-drawn like ears/tusks/horns/hood/hat per HeroAiSprites.js:9, 78-82): 'crest' — storm-swept mane with 2-3 one-pixel spark tips in accent #ffe14a; 'ruff' — frost mantle collar + icicle brow pixels in accent #7fe0ff. No AI art needed.
- higgsfield concept sheet (OPTIONAL, separate session, never blocks): one Nano Banana 2 concept per hero for the Chronicle palette-variant key art shown on the lore overlay header. Pure decoration; the overlay ships with procedural ember-script framing first. NO enemy art in this update — the canonical 5-sheet style is untouched.
- Palette variants are ZERO-art by design: HeroAiSprites.js:69-71 recolors the shared sheet from the palette object, so all 8 Chronicle variants are pure data (hex values in characters.js variants block).

## Risks

- Perf: kill-storm feedback (Raiko) — a Static Burst killing 30 enemies could cascade splashes. Designed out from PR1: splashes are status-only (cannot kill → cannot chain), capped at 12 processed/frame, and the burst itself sits behind a 1.5s guard; worst frame is ~12×180 distance checks, far under budget at the 180-enemy cap.
- Saves: version 7→8 with four new keys — a malformed or ancient save must never lose the six starters or brick selection. Mitigation from PR1: all keys additive with clamp+default in _validate (SaveSystem.js pattern at 228-252), starters carry no unlock block so they bypass gating entirely, selectedCharacter falls back to DEFAULT_CHARACTER if it points at a locked/unknown id, and each PR verifies against a committed v7 fixture.
- Balance: stacking amps/CC with existing sources — Raiko's +0.02/stack alongside Overcharge (+0.5, weapons.js:1140) is bounded by hard stack caps (3-5, +2 with the keystone); Nivara + Winterbite + Orin-style chill sources bottom out at chillFloor 0.24 (GameConfig.js:884) and the boss floors (chill 0.80, freeze-exempt — Enemy.js:338, 350-353), so no permafreeze/boss-cheese path exists by construction. Starting stats sit inside the proven hero envelope (hpMul 0.78-1.35).
- Mobile/layout: 8 chips (3 rows) + the Chronicle strip on short landscape cards — the chip-height clamp (MenuRenderer.js:886) already compresses rows; the Chronicle strip collapses to a single pip line on short cards and the lore overlay is a full-screen modal, so nothing overruns the START button.
- Engagement cliff: element-gated unlocks (shock detonations / frost kills) could stall a player who never picks element weapons — mitigated by the 6,000-coin fallback and by quest text that names the exact combo to run.

## Uniqueness & boundaries

This is the ONLY roadmap update that grows the playable roster (6 → 8 heroes) and the only one that gives every hero a personal, authored narrative meta-arc — 40 hand-written quest steps with lore, recolors, and earned titles attached to the heroes themselves. No other update touches the hero contract (characters.js signature fields), hero gating, or per-hero identity content. Sharpest boundaries: #12 CINDERS & SCRIPTURE owns world/creature lore and the Codex tab — Chronicles lore is hero-personal and lives in the CHARACTER tab, and we build no Codex UI; #3 KINDLED owns ults/attunement/combos — both new heroes map onto its existing systems and we add zero new ult archetypes and touch only KINDLED's already-reserved rows; #8 GLOAMCALL owns new weapons and the sixth element — we add NO weapons and NO element, Raiko and Nivara amplify the existing shock/frost arsenal; #5 THE KINDLED TROOP owns companions; #15 ASHBOUND owns difficulty ladders — Chronicles is narrative progression, never a difficulty prescriptor; #2 EMBERGLASS owns the card compositor — we only pass it a title string.

## Roadmap corrections found while grounding

- 'SaveSystem.js hero unlock state' does not exist yet: SaveSystem stores only selectedCharacter (SaveSystem.js:83, validated 248-252, setter 538-541). The `unlocked: true` field on every CHARACTERS entry (characters.js:35 etc.) is written but never read anywhere in src/. Hero unlock plumbing (save.heroes.unlocked + gate in setSelectedCharacter + locked chips) is NEW work in this update, built on the map-unlock UI pattern (MenuRenderer.js:1006-1019).
- The hero contract field is `title` (characters.js:29 — 'The Emberkin'), not 'epithet'; there is no epithet field. Chronicle titles are added as a NEW `earnedTitle` per-hero string, displayed alongside/in place of `title` once step 5 completes.
- SHOCK_CFG contains ONLY detonateMul: 2.5 (GameConfig.js:891). The per-stack amp, stack caps and durations are per-weapon config (weapons.js:140 shockPerStack 0.08 / maxShockStacks 3 / shockDuration 4.0), read at the single shockStrike hook (weapons.js:1136-1163). Raiko's amp bonus therefore lands in shockStrike next to the ks_overcharge read (weapons.js:1140-1141), not in SHOCK_CFG.
- Chill/freeze numbers: ELEMENT.frost = chillMaxStacks 5 / chillPerStack 0.07 / chillFloor 0.24 (GameConfig.js:884); freeze proc chance is per-weapon (e.g. weapons.js:358 freezeChance 0.14, dur 0.55) plus player.freezeChanceBonus (Player.js:152, consumed weapons.js:1008-1010, 1599-1601). Bosses are freeze-EXEMPT (Enemy.js:350-353) and chill-floored at 0.80 (Enemy.js:338) — Nivara cannot permafreeze bosses by construction.
- The Blender pipeline today renders ONE shared monkey sheet trio (tools/blender/README.md — monkey_rig.py/render_sheets.py); 'five distinct hero bodies' is update 1's still-in-flight deliverable. Heroes 7-8 must therefore ship on the palette-tint + code-drawn-feature path (HeroAiSprites.js:69-82) first, with bespoke bodies as a trailing non-blocking PR.
- runSummary carries no characterId today (built at Game.js:1206-1213 and the game-over twin near Game.js:2531) — Chronicles needs it added (additive) in PR3.
- Save schema is at version 7 (SaveSystem.js:126 and the _validate return at :360), not v5 as the achievements.js:4 comment implies (that comment is historical); the stats loop auto-validates any numeric additions (SaveSystem.js:46-47 pattern).

## Binding cross-spec rulings affecting this update

- **[#3 KINDLED vs #10 THE SEVENTH AND EIGHTH WICKS]** #3 ships per-hero tables sized to six heroes: signatures.js (6 Grand Signature ults), rites.js (18 rites, 3/hero), the hero-locked daily Rite Trial, and Hero Attunement. #10 grows the roster to 8 but its DATA list (chronicles.js, loreChronicles.js) claims NO appends to any of #3's tables — leaving Raiko and Nivara with no ult, no Rites, no Attunement, and breaking the Rite Trial's hero-lock pool. This content is claimed by neither spec.
  **RULING:** #3's tables are append-only registries keyed by hero id, and #3 must not hardcode the count six anywhere (Rite Trial pool, Attunement, ult wiring all derive from characters.js). #10 owns authoring the new heroes' rows: PR1/PR2 must each append one signatures.js entry and three rites.js entries (plus Attunement pricing) for Raiko and Nivara. #10's DATA section is amended to list these appends explicitly.

- **[#10 THE SEVENTH AND EIGHTH WICKS vs #12 CINDERS & SCRIPTURE]** Two hero-lore surfaces: #10 mints hero-personal lore pages (loreChronicles.js, unlocked via Chronicles quests) at update 10; #12 ships a Codex "The Keepers" page at update 12 — in a game where the hero is "the wick-keeper," both specs plausibly author hero lore, risking a duplicated data set and two competing readers.
  **RULING:** #10 owns hero-personal lore DATA and its unlock gating (loreChronicles.js is the single source). #12's Keepers page is a DISPLAY shelf: it renders the Chronicles pages the player has unlocked (reading #10's data and save state) plus any non-hero keeper-world lore #12 authors; it must not define a second hero-lore table. If #12 ships before deciding layout, the Keepers page reads loreChronicles.js by contract and degrades gracefully for locked pages.

- **[#14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)]** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.
  **RULING:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.
