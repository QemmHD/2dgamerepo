# Update #12: CINDERS & SCRIPTURE — The Keeper's Codex

*Era IV — The Long Vigil*

**Value verdict (ADDS):** Verified: no per-type kill tallies, bestiary, or lore surface exists anywhere in the save schema or menu tabs — collection memory is a genuinely absent capability, and it is retention machinery survivor players demonstrably chase. Bundling the last 7 canonical creature sheets means the Bestiary completes exactly as the art roster does, which closes the ROADMAP's absorbed art lane instead of adding a filler PR. Softest slice: the 24 grave vignettes — fine as flavor, but tallies + tiers + Archive rewards are the load-bearing value.

## What it adds

A reason to look back: the game finally remembers what you've fought, found, and read. A kill-gated four-page Codex (Bestiary, The Twelve, Relics, The Keepers) turns 20+ creatures, 12 bosses, 26 relics, and 24 ember-script grave vignettes into a parchment collection with tallies, tiers, and lore — capped by an Archive completion track paying coins, a Censer hat, and the Curator's Lantern mythic aura at 100%. It simultaneously finishes the canonical creature-art pass (the last 7 sheets), so the Bestiary the player completes is also the moment the whole roster reaches the locked PR #103 style.

## Design spec

# CINDERS & SCRIPTURE — The Keeper's Codex (Update #12, Era IV, size M, deps: none hard)

The collection meta-layer: a CODEX menu tab whose four pages (Bestiary / The Twelve / Relics / The Keepers) fill in as you play, fed by new per-type kill tallies, boss encounters, the existing relic-discovery record, and in-run ember-script lore vignettes collected at grave markers — plus the 7 remaining creature sheets that complete the canonical art pass, and an Archive completion track paying coins and the Curator's Lantern mythic aura at 100%.

## 1. Data spine — per-type kill tallies and codex save state

**What exists.** `save.stats` holds only aggregates (`totalKills`, `totalBosses` — SaveSystem.js:35-54). The one discovery record in the game is `discoveredRelics` + `discoverRelic(id)` returning true on first-ever sight (SaveSystem.js:119-121, 388-395), consumed by Game for a discovery beat at Game.js:1760. Nothing tracks kills per enemy type (verified by grep — see corrections).

**New in-run accumulator.** `Game._startRun` zeroes `this.runKillsByType = Object.create(null)` and `this.runBossSeen = []`. Increment sites — every place `this.kills` is incremented:
- the merged kill pipeline: `allKilled` loop at Game.js:3012-3018 (`this.kills += allKilled.length`) — iterate `allKilled` and bump `runKillsByType[e.type]`;
- the burn-DoT/self-detonation side path at Game.js:2414 (`this.kills += 1`) — bump there too.
Both are O(1) map bumps on already-hot code; **zero saves mid-run**.

**Boss encounters.** `Game._spawnBoss(id)` (Game.js:1971) pushes `id` into `this.runBossSeen` — a boss counts as *Sighted* the moment its HP bar rises, even if the run ends in death (that's the hook that makes a losing run still feed the codex).

**Fold at run end.** New `SaveSystem.recordCodex({ kills, bossSeen })` called immediately next to the existing `recordRun(this.runSummary)` call (Game.js:1214) and the death-path record site (the "Bank + RECORD the run once" latch at Game.js:1189 makes this idempotent per run). It merges tallies into `save.data.codex.kills` (bosses' kill counts also live here, keyed by boss type), unions `bossSeen` into `codex.bossSeen`, then one `save()`. Validation in `_validate` mirrors the `casePity` int-map pattern (SaveSystem.js:258-262): only keys present in `ENEMY` (GameConfig.js:133) or the lieutenant are kept, values `Math.floor`-ed and clamped ≥0 — tampered saves cannot inject unbounded keys. Version literal at SaveSystem.js:360 goes 7 → 8.

**Tier model** (thresholds in `src/content/codex.js`, all tunable — see numbers table):
- Creatures: **Unseen** (0 kills — silhouette card) → **Sighted** (1+ — art + name + habit line) → **Studied** (band threshold — combat stats revealed from the live `ENEMY` config: HP/speed/contact/XP, plus behavior note) → **Mastered** (band threshold — lore line + gold tally seal + flame-tipped kill counter).
- Bosses: **Unseen** → **Sighted** (in `codex.bossSeen`) → **Slain** (kills ≥1) → **Studied** (kills ≥5 — phase-2 notes + epitaph).

**First-sight beat.** When a creature's tally crosses 0→1 *in-run*, queue a one-line "NEW ENTRY — <name> added to the Bestiary" note through the same transient feedback channel the setpiece banner uses (Game.js:3058 area), throttled to max 2 per run (banner discipline per roadmap update 1) and suppressed entirely once the Bestiary shelf passes 75%.

## 2. Codex tab — menu IA and page layouts

**Tab plumbing.** Append `{ id: 'codex', label: 'CODEX', accent: '#d9b36c' }` (parchment gold) to `MENU_TABS` (MenuRenderer.js:56-66; the shared row geometry at 557-566 auto-fits 10 tabs, `_fitFont` at 190-198 shrinks the label). `tabUnlocked` gains `case 'codex': return (s.runs ?? 0) >= 1;` (same gate as stats, MenuRenderer.js:94). Dispatch: `else if (tab === 'codex') this._drawCodex(ctx, state);` in the draw switch (MenuRenderer.js:522-531). Game's hotspot dispatcher already handles `case 'tab'` + `markTabSeen` (Game.js:1482); new actions `codexPage`, `codexCard`, `claimShelf` join that switch. `game.codexPage` ('bestiary'|'twelve'|'relics'|'keepers') and `game.codexCard` (selected entry id or null) ride into the snapshot via UIStateBuilder's start-screen branch (UIStateBuilder.js:27-62; `saveData` already carries the whole save at line 20, so codex state flows for free).

**Shared chrome.** `_drawCodex` renders a parchment book panel inside `_contentRect()`: a 4-item sub-nav row of tab chips (reusing the `_button` helper pattern seen throughout, e.g. MenuRenderer.js:1495) with per-page completion fractions ("BESTIARY 14/21"), and an ARCHIVE header strip: four shelf bars + the overall Archive % + claimable reward chips (section 4).

**Page 1 — BESTIARY.** 7×3 grid of ~236×272 px cards, one per roster entry (21). Card: portrait from NEW `src/assets/CodexPortraits.js#getCreaturePortrait(type)` — a module that mirrors the exact Enemy.js:67-114 fallback chains (`getEnemyAiFrames(type) || getMonsterFrames(host) || get<Type>Frames()`) and caches the first frame onto a 128×128 canvas once, so the page is 21 cached blits/frame and always renders even with zero AI art (procedural fallback is load-bearing, per CLAUDE.md). Unseen cards draw the portrait as a black silhouette (composite `source-in` fill) with "???". Sighted+ shows name + kill tally; Studied+ adds the stat row (read live from `ENEMY[type]` — no duplicated data) and behavior note; Mastered adds the lore line from `src/content/lore.js` and a gold seal. Clicking a Sighted+ card (`codexCard` action) opens a right-side detail panel — same split-layout trick as the CHARACTER customizer (`_drawItemGrid` rect param, MenuRenderer.js:1581).

**Page 2 — THE TWELVE.** 4×3 grid of larger cards (~420×300) for the 12 bosses (Enemy.js:102-113), portraits via `getPixelBossFrames(id) || get<Boss>Frames()`. Unseen = silhouette + biome hint ("A shape in the Verdant Hollow…"); Sighted = art + name + "encountered"; Slain = kill tally + epithet; Studied (5 kills) = phase-2 notes + full epitaph. This page reads whatever boss art exists — when update 4 (Bossforge) re-models the Twelve, the codex upgrades automatically through the same getters; we ship **no** boss art.

**Page 3 — RELICS.** 26 relic cards (relics.js:15-165) in a 7-col compact grid, gated by the *existing* `discoveredRelics` record (SaveSystem.js:397-399) — the codex is the payoff the Wick Roads comment ("lifetime codex", SaveSystem.js:119-120) always promised. Undiscovered: "???" card silhouette tinted by rarity hue (rarityColor, as used at MenuRenderer.js:1538). Discovered: name, rarity, effect blurb, a NEW one-line `lore` string (additive field appended to each relic def in relics.js), and — for the 8 ATTUNABLE ids (relics.js:180-187) — the current attunement Lv from `save.relicAttunement` (read-only mirror; buying stays in the ATTUNE tab, MenuRenderer.js:1509-1576, which keeps its "✦ found" tie-in at 1555-1558).

**Page 4 — THE KEEPERS.** 8 lore pages (the order of monkey Keepers who tend the Emberwake; the Hollow; the Gloam; the Twelve; the Forge; the Wick Roads; the Quenching; the Long Vigil) each unlocked progressively by its 3 collected vignettes (`codex.lore`). A page shows: ember-script header (procedural rune glyphs), the collected vignette lines with translations, and locked lines as rubbed-out ember-script. Sample vignettes: page "The Hollow", v1: *"We buried the first watchers where the ash was softest. The ash remembered them better than we did."* — v2: *"A Hollow is not empty. It is full of the one thing it kept."* — v3: *"Do not pity the slime. It was never anything else. Pity the bat — it remembers the sun."* Page "The Twelve", v1: *"Twelve knots in the world-wick. Cut one and the flame draws breath."*

## 3. Whispering graves — in-run lore vignettes

**Placement.** Grave markers already exist as weighted biome props (`graveMarker`, mapObjects.js:37-38, e.g. weight 16 in the theme at mapObjects.js:131) placed by ObstacleSystem's seeded pass (`this.obstacles`, ObstacleSystem.js:76/141; `_placeStructures` at 166 runs first). New read-only helper `ObstacleSystem.findWhisperSites(limit=8)` returns positions of obstacles whose type is in a whitelist `['graveMarker','statue','ruinedWall','pillar']` — the fallback types guarantee every biome theme yields sites even where graves are absent (edge case designed in, no world-gen change).

**Activation cadence.** At run start Game picks the site list; the first whisper ignites at t=90s, another every 240s, cap 3/run (tunable). An ignited site renders one small breathing wisp: a single cached-glow blit via `getGlowSprite` (the same primitive MenuRenderer uses at 173-176) + 2-3 rising ember motes (skipped when `settings.reducedEffects` is on) — O(1) per frame, only when on-screen.

**Collection.** Walking within 130 px auto-collects (distance check against the ≤3 active sites — no interaction system, no button; that boundary belongs to update 9). Picks the lowest-index *uncollected* vignette from `src/content/lore.js` (seeded per run so restarts don't reroll); if all 24 are collected the wisp pays 15 coins instead. Collecting shows a 4.5 s ember-script vignette banner through the HUD's framed-banner styling (the tutorial banner pattern, UISystem.js:1397): rune line on top, translation beneath, "KEEPERS PAGE n/8" progress. The id lands in `this.runLore` and folds into `codex.lore` inside the same `recordCodex` run-end fold — a vignette read mid-run is kept even on death (you *read* it; the Keepers keep it).

## 4. Archive shelves — completion math, rewards, Curator's Lantern

**Shelf math** (pure functions in content/codex.js so menu + claim logic agree, the relics.js `attuneCost` precedent):
- Bestiary shelf = sighted/21 · Twelve shelf = slain/12 · Relics shelf = discovered/26 · Keepers shelf = collected/24.
- Archive % = round(mean of the four) — every shelf pulls equal weight, so no single grind dominates.

**Rewards** at 25/50/75/100% Archive (claim chips on the Codex header; claimed ids latch in `codex.shelfClaimed`, mirroring `battlePass.claimed` / `achievements.claimed` validation, SaveSystem.js:278-283): 25% → 600 coins; 50% → 1,500 coins; 75% → 3,000 coins + **Curator's Censer** (epic hat cosmetic); 100% → **Curator's Lantern** — a mythic aura cosmetic (`aura_lantern`, color `#ffc86b`) with a NEW `'lantern'` fx in CosmeticFx `drawAuraFx` (imported at MenuRenderer.js:35): a low-slung warm halo with a 1.6 Hz candle-flicker amplitude wobble and a slow orbiting mote — visually distinct from `pulse|spin|flame|rainbow|starfield` (cosmetics.js:19). Claims grant via existing `addCoins` / `unlockCosmetic` (SaveSystem.js:372-376, 490-495) and fire `_setToast` (Game.js:1554). Rewards are deliberately coins + visual-only cosmetics (cosmetics.js:3) — the Codex can never shift combat balance.

**Claim flow.** `evaluateArchiveClaims(save)` returns passed-but-unclaimed milestones; Game's `claimShelf` action claims one, pays out, toasts. Evaluated on Codex-tab open and at run end (no timers, no server — fully local per the static-hosting constraint).

## 5. The canonical seven — completing the creature-art pass

Registration is additive and fallback-safe (see corrections for why the seven split 4+3):
- **4 behavior types** get `ANIM_SHEETS` rows (EnemySprites.js:33-48): `splitter/bomber/summoner/teleporter_anim.png`, and their `FRAMES_BY_TYPE` getters (Enemy.js:85-88) gain a self-first preference, e.g. `splitter: getEnemyAiFrames('splitter') || getEnemyAiFrames('slime') || getMonsterFrames('slime') || getSlimeFrames()` — the host-body chain remains the shipped fallback, so the code PR is safe with zero PNGs on disk (`loadAnimOne` resolves null on error, EnemySprites.js:101-119).
- **3 humanoids** get `DIR_SHEETS` rows (EnemySprites.js:57-59) and getters mirroring emberskeleton (Enemy.js:96): `brute: getEnemyAiDirFrames('brute') || getLpcFrames('orc')`, likewise skeleton/zombie — LPC stays as fallback (ASSET_CREDITS.md LPC table rows persist).
Each landed PNG adds an ASSET_CREDITS.md row in the Generated section (format of rows 129-133) + assets.json entry; `node tools/validate-assets.js` must exit 0. Visual verification via the harness showcase ring (`?showcase=splitter,bomber,summoner,teleporter&badge=1`, harness.html:85-88).

## 6. Failure modes designed out from PR1
1. **localStorage churn / save bloat** — tallies accumulate in memory, one fold per run; the codex map is whitelist-validated so it can never exceed ~35 keys (<1.5 KB).
2. **Menu perf on mobile** — CodexPortraits caches all portraits once (≤33 × 128² canvases ≈ 2 MB, built lazily per page visit); the grid is pure cached blits; no per-frame slicing, no shadowBlur (matching the menu's cached-glow discipline, MenuRenderer.js:133-137).
3. **Old/corrupt saves** — every new key follows the clamp+migrate `_validate` pattern; a v7 save gets defaults; unknown enemy keys are dropped; a tampered `shelfClaimed` can't double-pay (claims are latched set-membership like achievements).

## PR plan

### PR1 — PR1 — codex-spine: per-type kill tallies + codex save state

**Goal:** Every kill, boss encounter, and (future) lore pickup persists into a validated save.codex block with zero mid-run writes; no visible UI yet.

**Files:**
- `src/content/codex.js (NEW)`
- `src/systems/SaveSystem.js`
- `src/core/Game.js`

**Work:**
- Create content/codex.js: BESTIARY_ROSTER (21), THE_TWELVE (12), tier-threshold bands, shelfProgress()/archivePercent()/evaluateArchiveClaims() pure functions, ARCHIVE_REWARDS + CODEX_WHISPERS tunables
- SaveSystem: default codex {kills:{},bossSeen:[],lore:[],shelfClaimed:[]}; _validate whitelist/clamp block (casePity pattern, SaveSystem.js:258-262); recordCodex({kills,bossSeen,lore}) single-save fold; getCodex() accessor; version literal 7->8 (SaveSystem.js:360)
- Game: runKillsByType/runBossSeen/runLore reset in _startRun; bumps in the allKilled loop (Game.js:3012-3018) and the burn/self-detonation path (Game.js:2414); _spawnBoss (Game.js:1971) records bossSeen; recordCodex called beside recordRun (Game.js:1214) under the existing record-once latch (Game.js:1189)
- Throttled 'NEW ENTRY' first-sight beat (max 2/run) via the existing transient feedback channel

**Verify:**
- node --check on all touched files
- node tools/validate-assets.js exit 0
- headless harness ?seconds=35&badge=1 shows EXC:0
- harness console: JSON.parse(localStorage['monkey-survivor:save:v1']).codex.kills has per-type ints after the timed run; re-load a pre-update save string and confirm defaults appear without data loss
- adversarial review; squash-merge to main

### PR2 — PR2 — codex-tab: the four-page CODEX menu tab

**Goal:** A player with 1+ runs sees a CODEX tab (with NEW badge) whose Bestiary/Twelve/Relics/Keepers pages render correct gated states from live save data.

**Files:**
- `src/systems/MenuRenderer.js`
- `src/core/Game.js`
- `src/systems/UIStateBuilder.js`
- `src/assets/CodexPortraits.js (NEW)`
- `src/content/lore.js (NEW)`
- `src/content/relics.js`

**Work:**
- MENU_TABS 'codex' entry + tabUnlocked case (runs>=1) — MenuRenderer.js:56-66, 73-97; deliberately NOT added to SaveSystem ALL_TABS (SaveSystem.js:316) so veterans get the NEW badge
- _drawCodex: sub-nav (4 pages + completion fractions), Archive header strip with 4 shelf bars, page renderers per the IA spec; hotspots for codexPage/codexCard
- CodexPortraits.js: cached 128px portraits mirroring Enemy.js:67-114 fallback chains (procedural always works); silhouette mode via source-in composite
- lore.js: 21 creature + 12 boss lore lines, 8 KEEPER_PAGES, 24 VIGNETTES; append one-line lore field to each relic in relics.js (append-only)
- Game: codexPage/codexCard state + action dispatch (beside Game.js:1482); UIStateBuilder start-branch passthrough (UIStateBuilder.js:27-62)

**Verify:**
- node --check; validate-assets exit 0
- harness ?screen=menu&tab=codex&badge=1 screenshot: EXC:0, Bestiary grid renders with silhouettes on a fresh save and Sighted cards on a played save
- manual click-through of all four sub-pages + a card detail panel; confirm ATTUNE tab unchanged
- adversarial review; squash-merge to main

### PR3 — PR3 — whispering-graves: in-run ember-script vignettes

**Goal:** Every run surfaces 1-3 walk-over whisper sites at grave/ruin props; collecting shows the vignette banner and permanently fills Keepers pages.

**Files:**
- `src/core/Game.js`
- `src/systems/ObstacleSystem.js`
- `src/systems/UISystem.js`
- `src/content/lore.js`

**Work:**
- ObstacleSystem.findWhisperSites(limit): read-only scan of this.obstacles (ObstacleSystem.js:76/141) for the graveMarker/statue/ruinedWall/pillar whitelist
- Game: site selection at run start, ignition schedule (90s, +240s, cap 3), 130px walk-over collect, uncollected-first vignette pick, duplicate->15 coins, runLore fold through PR1's recordCodex
- Wisp render: one cached getGlowSprite blit + <=3 motes, on-screen only, reducedEffects-aware
- UISystem: 4.5s framed vignette banner (tutorial-banner styling, UISystem.js:1397) with rune line, translation, page progress

**Verify:**
- node --check; harness ?seconds=120&badge=1 EXC:0 with a wisp visible in the shot
- drive the player over a site (harness synchronous stepping) and confirm codex.lore grows in localStorage and the banner renders
- biome sweep: force each map theme and confirm findWhisperSites returns >0 sites on all of them
- adversarial review; squash-merge to main

### PR4 — PR4 — archive-shelves: completion rewards + Curator's Lantern

**Goal:** Archive 25/50/75/100% milestones become claimable, paying coins and unlocking the Censer hat and the Curator's Lantern mythic aura with its new fx.

**Files:**
- `src/content/cosmetics.js`
- `src/assets/CosmeticFx.js`
- `src/systems/MenuRenderer.js`
- `src/core/Game.js`
- `src/content/codex.js`

**Work:**
- cosmetics.js: append aura_lantern (mythic, fx 'lantern', '#ffc86b') + hat_censer (epic) — no coinCost, unlocked only by claims
- CosmeticFx drawAuraFx: 'lantern' branch (candle-flicker halo + orbiting mote), safe in reducedEffects
- MenuRenderer: claim chips on the Codex Archive header (claimShelf hotspots), claimed/claimable/locked states
- Game claimShelf action: evaluateArchiveClaims -> claimShelf latch in codex.shelfClaimed -> addCoins/unlockCosmetic (SaveSystem.js:372-376, 490-495) -> _setToast (Game.js:1554); evaluate on tab open + run end

**Verify:**
- node --check; harness menu screenshot EXC:0 with a claimable chip (seeded test save)
- claim each milestone once on a crafted save; confirm coins, cosmetics unlocked in CHARACTER tab, aura renders on the avatar, and re-claim is refused
- load pre-update save: no phantom claims, no crashes
- adversarial review; squash-merge to main

### PR5 — PR5 — canonical-seven: art landing (repeatable per batch, never blocks)

**Goal:** Register and land the 7 remaining bespoke creature sheets (4 via the approved 2x2 NB2 recipe, 3 humanoids via the DIR_SHEETS 3D path) with full credits; game is already correct without them.

**Files:**
- `src/assets/EnemySprites.js`
- `src/entities/Enemy.js`
- `src/assets/enemies/*.png (NEW, per batch)`
- `ASSET_CREDITS.md`
- `src/assets/credits/assets.json`

**Work:**
- EnemySprites.js: add splitter/bomber/summoner/teleporter to ANIM_SHEETS (EnemySprites.js:33-48) and brute/skeleton/zombie to DIR_SHEETS (EnemySprites.js:57-59) — only alongside their landed PNGs
- Enemy.js FRAMES_BY_TYPE: self-first fallback chains for the 4 behavior types (Enemy.js:85-88) and getEnemyAiDirFrames-first for the 3 humanoids (mirror emberskeleton, Enemy.js:96); LPC/procedural fallbacks untouched
- Art (separate higgsfield session, per CLAUDE.md recipe + approved grid job ids): 2x2 img2img grids -> strip-frames.mjs (bottom/center anchors, dropshadow where baked); humanoids: NB2 concept -> image_to_3d ONE job -> glbsheet.html 4-row grids
- ASSET_CREDITS.md Generated rows (format of lines 128-133) + assets.json entries per PNG

**Verify:**
- node tools/validate-assets.js exit 0 (fails the PR if any PNG lacks credits)
- harness ?showcase=splitter,bomber,summoner,teleporter&badge=1 and ?showcase=brute,skeleton,zombie&badge=1 screenshots: EXC:0, sheets render at correct anchor/scale, no motion-blur wings
- delete-one-PNG smoke: fallback chain still renders (procedural safety net proven)
- adversarial review; squash-merge to main

## Data & save changes

NEW content files (all append-only data):
- src/content/codex.js — BESTIARY_ROSTER (21 entries: type id, display name, band 'common'|'uncommon'|'rare'|'lieutenant', habitLine), THE_TWELVE (12 boss ids + epithets), tier threshold table, shelfProgress(save) pure math, ARCHIVE_REWARDS table (25/50/75/100), evaluateArchiveClaims(save).
- src/content/lore.js — CREATURE_LORE (21 one-line entries + 12 boss entries), KEEPER_PAGES (8 pages: id, title, 3 vignette ids each), VIGNETTES (24: id, emberScript display line, translation, pageId).
- src/assets/CodexPortraits.js — getCreaturePortrait(type)/getBossPortrait(id) 128px cached canvases mirroring the Enemy.js:67-114 fallback chains (always renders via procedural fallback).

NEW save-schema keys (ADDITIVE, validated in SaveSystem._validate like casePity at SaveSystem.js:258-262; version literal 7 -> 8):
- codex.kills: { [knownEnemyOrBossType]: int>=0 } — unknown keys dropped, values floored/clamped.
- codex.bossSeen: string[] (validateIdList pattern, SaveSystem.js:135-141).
- codex.lore: string[] — collected vignette ids.
- codex.shelfClaimed: string[] — 'archive25'|'archive50'|'archive75'|'archive100'.
Old saves lack `codex` entirely -> defaults (implicit clamp+migrate, same as dailyRoad at SaveSystem.js:295-304). 'codex' deliberately NOT added to ALL_TABS (SaveSystem.js:316) so every existing save gets the one-time NEW badge.

NEW cosmetics (append to COSMETICS in src/content/cosmetics.js): aura_lantern (Curator's Lantern, mythic, fx:'lantern', color '#ffc86b', unlock via archive100 claim), hat_censer (Curator's Censer, epic, archive75 claim). New 'lantern' fx branch in CosmeticFx drawAuraFx.

NEW asset registrations when art lands (PR5): 4 ANIM_SHEETS entries + 3 DIR_SHEETS entries in EnemySprites.js; 7 rows in ASSET_CREDITS.md 'Generated' section (format per existing rows at ASSET_CREDITS.md:128-133) + src/assets/credits/assets.json entries (validated by node tools/validate-assets.js).

Config: no GameConfig ENEMY changes; whisper-site tunables live in a small CODEX_WHISPERS const inside content/codex.js.

## Balance numbers (all tunable)

| Number | Start value | Rationale (all tunable) |
|---|---|---|
| Bestiary roster size | 21 creatures | 20 ENEMY trash/support/behavior types + Lieutenant (Enemy.js FRAMES_BY_TYPE:67-96 + LIEUTENANT) |
| The Twelve roster | 12 bosses | Enemy.js:102-113 |
| Relics shelf denominator | 26 | count of RELICS ids in src/content/relics.js:15-165 |
| Keepers vignettes | 24 (8 pages x 3) | ~2-4 weeks of casual runs to complete at 1-3/run |
| Sighted tier (all creatures) | 1 kill | reveals art + name; drives the 'NEW ENTRY' beat |
| Studied / Mastered — common band (slime, bat, crawler, mite, speedDemon) | 250 / 1000 kills | commons die ~100-300/run; ~2-6 runs to Studied |
| Studied / Mastered — uncommon band (spitter, charger, brawler, skeleton, zombie, emberskeleton, splitter, bomber, teleporter) | 100 / 400 | |
| Studied / Mastered — rare band (juggernaut, healer, shielder, summoner, dreadhulk) | 40 / 150 | |
| Studied / Mastered — lieutenant | 5 / 20 | rare mini-boss spawn |
| Boss tiers | Sighted = encountered (spawn), Slain = 1 kill, Studied = 5 kills | Studied reveals phase-2 notes |
| Whisper sites per run | 1 guaranteed at 90s, +1 every 240s, cap 3 | lore trickle, never a farm |
| Whisper collect radius | 130 px (world units) | walk-over, generous on touch |
| Duplicate vignette payout | 15 coins | trivial; codex is the reward |
| Vignette banner duration | 4.5 s | readable mid-run without blocking |
| Archive % | round(mean of 4 shelf %) | each shelf = fraction complete of its page |
| Archive rewards | 25% = 600 coins; 50% = 1,500 coins; 75% = 3,000 coins + Curator's Censer (epic hat); 100% = Curator's Lantern (mythic aura, fx 'lantern') | coins + cosmetics only — cosmetics are visual-only (cosmetics.js:3), so zero power creep |
| Portrait cache | 128x128 px canvas, first frame, built once per type | 21 cards/frame must be plain drawImage blits |
| Card grid | 7 cols x 3 rows, ~236x272 px cards | fits 1920x1080 content rect |
| Save-write cadence | 0 writes mid-run; 1 fold at run end | localStorage churn guard |
| New save keys size | codex ≈ 21+12 int entries + ≤24 ids + ≤4 ids | < 1.5 KB JSON |

## Art needs (non-blocking)

- NON-BLOCKING (2x2 NB2 recipe, separate higgsfield session) — 4 non-directional creature sheets at ~64-128px detail, one 2x2 pose-grid generation each, img2img with the approved host grid job as reference media, palette locked ('keep exact palette, NO fire, NO lava, NO orange'), sliced by tools/artshot/strip-frames.mjs: splitter_anim.png (swollen violet gel slime, ref job 152db454-4466-433e-aed9-7ce6c9329dce, --anchor=bottom), bomber_anim.png (bee with glowing amber abdomen, crisp pixel wings by ANGLE only, ref ac6a53ce-1d64-431a-abda-e2f078fac2c3, --anchor=center), summoner_anim.png (hollow violet eyeball with rune-ring channel poses, ref 38673959-0f1e-48f9-9fc9-449c4953f249, --anchor=center --dropshadow=1), teleporter_anim.png (spectral cyan blink-bat, ref 72461f5b-a5c9-4d75-97bc-140b775787d4, --anchor=center). Game ships and renders correctly before any of these exist — Enemy.js host-body fallback chains stay intact.
- NON-BLOCKING (image_to_3d one-job pipeline OR tools/blender parametric rig) — 3 directional humanoid sheets replacing/updating the CC-BY-SA LPC bodies: brute_sheet.png, skeleton_sheet.png, zombie_sheet.png as 4-row (up/left/down/right) x 8-frame grids via NB2 concept -> higgsfield image_to_3d (texture+rig+animate in ONE job — never a separate 3d_rigging pass) -> tools/artshot/glbsheet.html, exactly the ember_warden_sheet.png path (EnemySprites.js:57-59). Humanoids are biped so Meshy animation clips apply (CLAUDE.md). LPC art remains the shipped fallback forever.
- PROCEDURAL (ships in PR2/PR3, no AI art) — Codex parchment card frames, tier seals, ember-script glyphs (seeded rune-stroke drawer), the whisper-wisp (reuses getGlowSprite cached blits), and the Curator's Lantern aura fx (new 'lantern' branch in CosmeticFx drawAuraFx). Zero new binary assets required for the update's core loop.

## Risks

- Perf/memory on the Codex tab (mobile): 21-33 portraits could tempt per-frame sheet slicing or shadowBlur text — mitigated from PR2 by CodexPortraits' one-time 128px canvas cache and the menu's existing cached-glow discipline; the tab must stay a pure-blit page.
- Save regressions: a malformed codex block or the version 7->8 bump could nuke veteran saves — mitigated by strictly following the _validate clamp+migrate pattern (whitelisted keys, floored ints, validateIdList), a PR1 verification step that loads a captured pre-update save string, and the never-reject rule (missing codex == defaults).
- Art-pipeline drift: the 4 behavior-type sheets could accidentally re-theme canonical identities (violet splitter must still read as the gel slime family; NO fire/orange per the locked style) or the humanoid DIR sheets could land mis-anchored — mitigated by img2img from the approved grid job ids, palette-locked prompts, the showcase-ring screenshot gate in PR5, and keeping LPC/procedural fallbacks live so a bad sheet can be reverted by deleting one PNG.
- Reward-economy inflation: 5,100 total milestone coins is a one-time drip smaller than a single legendary case habit and buys zero power (cosmetics are visual-only) — but if Archive % proves too fast, only the four denominators/thresholds in content/codex.js move (single tuning surface).

## Uniqueness & boundaries

CINDERS & SCRIPTURE is the ONLY update in the 20-update roadmap that gives EMBERWAKE a collection-and-lore memory: per-enemy-type kill tallies, kill-gated encyclopedia pages, world lore text, and a completion meta-track exist nowhere else in the plan — every other update makes the player stronger, the world livelier, or a run shareable; this one makes what the player has already done legible and collectible. It also closes the roadmap's absorbed 'creature-sheet coherence' lane (ROADMAP.md:174) by finishing the canonical art pass for all non-boss creatures. Sharpest neighbor boundaries: #14 LEDGER OF ASHES owns records/history (run archive, graphs, splits, save export) — the Codex stores no per-run history, only lifetime collection state; #9 WAYLIGHT owns interactive world set-pieces — whispering graves are deliberately passive walk-over pickups with no interact button, no spawned entities, and no gameplay effect; #4 BOSSFORGE owns boss art — The Twelve page consumes whatever art the existing getPixelBossFrames chain returns and ships zero boss sheets; #10's Emberkin Chronicles owns hero-signature lore quests — the Keepers pages are world lore, never per-hero; #20 HEARTHHOLD owns displaying earned things in the camp backdrop — the Codex mints the collection data Hearthhold will later decorate with, but touches no menu backdrop.

## Roadmap corrections found while grounding

- Roadmap synopsis says 'canonical sheets for the last 7 procedural creatures (approved 2x2 grid recipe)'. Verified: 12 of the 16 non-directional trash types ALREADY have approved-style sheets on disk (src/assets/enemies/: slime, bat, snake, eyeball, bee, charger, juggernaut, healer, shielder, speed_demon, dreadhulk, brawler — registered in EnemySprites.js ANIM_SHEETS:33-48). The actual last 7 without bespoke identity art are: splitter, bomber, summoner, teleporter (which borrow their host creatures' bodies — Enemy.js:85-88, identity from behavior tells only) and brute, skeleton, zombie (which are NOT procedural but imported CC-BY-SA LPC directional sheets — Enemy.js:72,92-93). Correction to the recipe claim: the 2x2 NB2 recipe produces a single non-directional 4-frame row and therefore fits only the 4 behavior types; the 3 humanoids are directional (`directional: true`) and must go through the 4-row DIR_SHEETS path that ember_warden already uses (EnemySprites.js:57-59, image_to_3d -> glbsheet.html), with LPC kept as fallback.
- Verified there is NO existing per-enemy-type kill tracking anywhere (grep killsByType/byType/killCounts across src/ returns nothing; SaveSystem stats only hold aggregate totalKills, SaveSystem.js:35-54). The synopsis's 'kill-gated pages' therefore require new save plumbing, not an existing seam — designed in PR1.
- Verified the achievements `check` callback receives ONLY the stats object (achievements.js:33-41, `check(stats)`), so Archive-shelf rewards cannot ride the achievements system without changing its signature; the spec gives shelves their own claim path (codex.shelfClaimed) instead, mirroring the battle-pass claimed[] pattern.
- All other synopsis claims held: discoverRelic first-seen pattern exists exactly as described (SaveSystem.js:388-395, consumed at Game.js:1760); graveMarker is a real placed prop (mapObjects.js:37-38, weighted in theme props at mapObjects.js:131); the MenuRenderer tab framework is cleanly extensible (MENU_TABS MenuRenderer.js:56-66, dispatch at 522-531, staged unlock at 73-97).

## Binding cross-spec rulings affecting this update

- **[#4 BOSSFORGE vs #6 UNDERTOW vs #11 FORGEHEART vs #12 CINDERS & SCRIPTURE]** Boss arithmetic disagrees across four specs: #4 remodels "the 12 bosses" and Boss Rush runs "all twelve"; #6 adds the Tidewarden apex (update 6); #11 claims its three bosses "complete the roster to 15" (12+3, silently excluding Tidewarden); #12's codex ships "THE_TWELVE (12 boss ids)" at update 12 when 16 boss-class enemies exist.
  **RULING:** Canonical taxonomy, to be quoted verbatim in all four specs: "The Twelve" is the fixed set of legendary campaign duels in GameConfig.js:379-663 and is what #4 remodels, #7 ritualizes, and #12's Twelve page commemorates. Forgeheart's Bellows/Smith/Anvil (#11) are campaign roster additions 13–15: #11 must append them to the data-driven Boss Rush pool and declare their bossRites rows (already in its PR4). The Tidewarden (#6) is Descent-mode-exclusive: excluded from roster counts, Boss Rush, The Twelve, and Thresholds; it appears in the codex per the next ruling. Boss Rush's roster is registry-driven, not a hardcoded twelve.

- **[#12 CINDERS & SCRIPTURE vs #6 UNDERTOW, #8 GLOAMCALL, #11 FORGEHEART, #16 NIGHTFALL CYCLES]** #12's fixed counts are stale against its ship position: BESTIARY_ROSTER has 21 entries but #6 ships 4 drowned creatures six updates earlier (roster should be 24+); "26 relics" equals TODAY'S relics.js count, ignoring #8's umbral relics that ship before it; the boss pages ignore #11's three bosses and #6's Tidewarden; and #16 later adds 6 reliquary relics and 5 twilight elites that would strand the Archive's 100% Curator's Lantern.
  **RULING:** #12 owns the codex but must author it against the post-#11 world AND make it append-safe: BESTIARY_ROSTER includes the drowned family and twilight-elite slots come free via registry-driven pages; the Relics page and shelfProgress() compute denominators from the live relics.js roster, never a literal; boss coverage = The Twelve page (fixed) + roster-driven entries for Forgeheart bosses and the Tidewarden. Archive completion rewards CHECKPOINT at claim time — once claimed they are never revoked or re-locked when #16 (or any later update) grows a roster. #16's spec adds one line: its reliquary relics and twilight elites surface in the codex as data appends only, no codex UI changes.

- **[#10 THE SEVENTH AND EIGHTH WICKS vs #12 CINDERS & SCRIPTURE]** Two hero-lore surfaces: #10 mints hero-personal lore pages (loreChronicles.js, unlocked via Chronicles quests) at update 10; #12 ships a Codex "The Keepers" page at update 12 — in a game where the hero is "the wick-keeper," both specs plausibly author hero lore, risking a duplicated data set and two competing readers.
  **RULING:** #10 owns hero-personal lore DATA and its unlock gating (loreChronicles.js is the single source). #12's Keepers page is a DISPLAY shelf: it renders the Chronicles pages the player has unlocked (reading #10's data and save state) plus any non-hero keeper-world lore #12 authors; it must not define a second hero-lore table. If #12 ships before deciding layout, the Keepers page reads loreChronicles.js by contract and degrades gracefully for locked pages.

- **[#14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)]** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.
  **RULING:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.
