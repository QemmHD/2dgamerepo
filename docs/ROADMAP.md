# EMBERWAKE — Master Roadmap v3 (2026-07-04)

*The 20-update horizon. Supersedes v2 (same date) by expanding the four-major plan
into five named eras / twenty updates. Grounded in a 5-lane code review (content,
modes, world, platform, meta — 35 candidates) synthesized under dependency, perf,
and identity constraints. Planning only — no update below is started until picked.*

**Standing constraints for every update:** vanilla-JS canvas, no bundler, GitHub
Pages static, no server (async/local/shareable-string only), backward-compatible
saves, perf caps (180 enemies / ~220 projectiles), monkeys + wands + ember/forge,
canonical enemy art style locked (the 5 approved sheets are the reference),
Blender pipeline (`tools/blender/`) for character/creature/prop art.

---

**Detailed implementation specs for updates #2–#17 live in [`docs/updates/`](updates/README.md)** — PR-by-PR plans, tunable numbers, and the binding cross-spec rulings.

---

## Era I — The Reforging
*Finish the visual/feel overhaul and mint the game's shareable face.*

### 1. REFORGED *(L — in flight)*
Complete the Blender arc + the quick-win feel fixes.
- Blender PR2–6: wand armory models, 8 family cast anims, death/victory/dash/personality idles, five distinct hero bodies, polish + CI smoke render
- Boss `phase2Attacks` wiring + boss-HUD readability pass
- First-minute swarm redesign, banner discipline, salience pass, damage-number cap
- **Hook:** five visibly distinct monkeys drawing bespoke forged wands.

### 2. EMBERGLASS — The Keeper's Lens *(S)* — deps: 1 (soft)
Photo mode + THE one shared card-compositor module (offscreen 1200×630 canvas →
clipboard/`navigator.share`), auto-minting a death/victory recap card every run.
Built once here; reused by updates 3, 15, 14, 19, 20.
- **Hook:** the auto-minted death card — "PYRA fell at 14:32 to Vinebacked Goliath."

## Era II — The Waking Hand
*The agency arc: the game learns to answer the player's intent.*

### 3. KINDLED — The Waking Hand *(L)* — deps: 2
Manual Kindle ults, aimed blink, Focus targeting, element combo table (authored
with a reserved umbral row for update 8), Rites, Hero Attunement, daily Rite
Trial + share card (via the Emberglass compositor), touch-first inputs.
- **Hook:** releasing a screen-wide ember nova you aimed yourself.

### 4. BOSSFORGE — The Twelve Reforged *(L)* — deps: 1
All 12 bosses re-modeled via Blender (multi-frame anims + telegraphs), full
phase-2 kits, Boss Rush + Weekly Ember modes, projectile-collision grid +
pooling — **the load-bearing perf gate for updates 11, 16, 17**.
- **Hook:** every fight now telegraphs, turns, and hits back with a second act.

### 5. THE KINDLED TROOP *(M)* — deps: 1, 3
Monkey companion familiars (rig parameter sweep), upgrade paths, element/build
synergy with the combo table, AI budgeted inside the entity caps; perch/roster
UI groundwork reused by update 20.
- **Hook:** a little wand-bearing troopmate that fights, levels, and falls beside you.

### 6. UNDERTOW — The Quenched Forge *(L)* — deps: 4
Descent push-your-luck floor mode, drowned enemy family (canonical style, 2×2
grid recipe), Tidewarden boss on the Bossforge pipeline, quenching/steam theme.
- **Hook:** choosing to descend one more flooded floor at 10% HP.

## Era III — The World Alight
*Content depth: events, the sixth element, a living world, roster growth, biome 5.*

### 7. THRESHOLDS — Rites of the Twelve *(M)* — deps: 4
Boss arrivals become events: arena-raise (standing-stone ring via runtime
ObstacleSystem insertion), per-boss signature weather, permanent kill monuments,
12 procedural boss themes (BIOME_TUNE pattern) with phase-2 stingers synced via
the musicDuck sidechain, pressure-reactive music layers.
- **Hook:** banners ignite in a circle, sleet whites the horizon, Hoarfang's theme slams in.

### 8. GLOAMCALL — The Sixth Patron *(L)* — deps: 3
UMBRAL completes the element wheel: three base weapons on two new kinds ('well'
vortex drag-and-crush, 'swarm' seeking gloam-motes), evolutions, umbral
keystones/relics/pacts, slotting into KINDLED's reserved combo row. Plus
Wickweld: ~10 fusion recipes closing every recipe-less base. All append-only data.
- **Hook:** the Gloamwell — a wand that drags the entire horde into one point.

### 9. WAYLIGHT — The Living Road *(M)* — deps: 1, 5
Seeded POI events + interactive set-pieces: caged-monkey rescues (join as
temporary Troop familiars), waystone relights (permanent veil-punching lights),
timed caravan loot, ruin bell horde-bait killboxes, brazier/steam-vent props —
placed by the existing seeded `_placeStructures` pass.
- **Hook:** ringing the chapel bell and watching 150 enemies wheel toward the killbox.

### 10. THE SEVENTH AND EIGHTH WICKS *(M)* — deps: 1, 3
Two new monkeys filling verified empty niches — a shock stormcaller and a frost
warden — via the hero-body pipeline, plus Emberkin Chronicles: a 5-step signature
quest chain per hero (all eight) unlocking lore pages, palette variants, titles.
- **Hook:** kills leave neighbors crackling with stored storm-charge.

### 11. FORGEHEART — The Living Anvil *(L)* — deps: 4, 6, 7
Biome 5, tier 5: the world-forge itself — slag rivers, ashfall weather, the one
place environmental fire styling is canon (per CLAUDE.md). Three new bosses (the
Smith, the Bellows, the Anvil) on the Bossforge pipeline with Thresholds arenas.
- **Hook:** kiting 180 husks across a glowing slag river inside the forge's heart.

## Era IV — The Long Vigil
*Veteran longevity: collection, defense, records, the ladder, the endgame loop.*

### 12. CINDERS & SCRIPTURE — The Keeper's Codex *(M)* — deps: none hard
Canonical sheets for the last 7 procedural creatures (approved 2×2 recipe),
Codex tab (Bestiary / The Twelve / Relics / The Keepers) with kill-gated pages,
ember-script lore vignettes at grave markers, Archive shelves with 25/50/75/100%
rewards + the Curator's Lantern mythic aura.
- **Hook:** the completed Bestiary — 20+ creature cards on parchment with kill tallies.

### 13. THE LAST HEARTH *(M)* — deps: 5 (soft)
Horde defense: guard a dying forge-hearth whose flame HP drives the light radius;
siege/stoke phases pulse the WaveDirector; dual-target aggro; ember-ward
placement; Troop familiars as hearth defenders; sieges-withstood records.
- **Hook:** hearth at 3% flame, screen black except a candle-ring, "SIEGE X WITHSTOOD."

### 14. THE LEDGER OF ASHES *(M)* — deps: 1
The records update: 100-run career archive + graphs, live boss-split speedrun
timing (gold/green/red deltas), streamer-clean capture toggles, **save hardening +
export/import ships here**. The archive is the trace mint for update 19's ghosts.
- **Hook:** a sub-18-minute Nightmare clear card with three green splits and one gold.

### 15. ASHBOUND — The Ash Ranks *(M)* — deps: 4, 2
The difficulty backbone: per-map Hades-Heat-style ladder prescribing stacking
Torments for scaling payouts (riding `_applyRunScale`'s clamped scalars so the
entity caps hold by construction). **Everburn seasons ship here**: seasonal
ladder resets, weekly edicts, seasonal share cards.
- **Hook:** the game-over card stamped with an Ash Rank IX seal.

### 16. NIGHTFALL CYCLES — The Rekindling *(L)* — deps: 4, 15
The endgame: NG+ Rekindled cycles (choice at 3rd-boss victory), compounding
multipliers, cross-map boss-roster remix, one cycle-exclusive twilight elite per
cycle. **Everforge ships here**: prestige currency + the mythic wand tier
(material variants of the PR2 models) + a legendary Reliquary shelf.
- **Hook:** "CYCLE III — THE WICK REKINDLES" over a re-ignited map.

## Era V — The Shared Flame
*Community and reach: determinism, authored challenges, ghosts, couch play, the capstone.*

### 17. THE SEALED STORM — Forge Your Trial *(L)* — deps: 4, 15
The determinism foundation: one seeded run-RNG (mulberry32) threaded through
Spawner/WaveDirector/elites/upgrades/chests (~158 audited `Math.random` sites;
VFX stays live), challenge codes on the game-over card, the Crucible ruleset
composer (map + road + Torments + wave tweaks as named shareable codes).
**The Game.js encounter-module split ships here** + a CI determinism assertion.
- **Hook:** "THE BONE WALTZ — skeletons only, first boss at 90s" with a code daring your feed.

### 18. FORGEGRIP — The Iron Hand *(M)* — deps: none
Platform reach: gamepad support (poll-based, slotting into the Input composite),
menu focus-ring walking the existing hotspot registry, rumble on telegraphs and
NEW BEST. **PWA ships here** (manifest, offline shell, install prompt) + the
accessibility preset bundle (big-text HUD, reduced effects, remaps).
- **Hook:** EMBERWAKE on a TV with a controller — "browser game" stops being an excuse.

### 19. EMBER RACE — Rival Wicks *(L)* — deps: 17, 14, 2
Async racing: race codes lock map/road/seed through the Sealed Storm RNG;
telemetry ghosts (position/level/kills sampled ~0.5s, delta-encoded base64,
~2–6 KB, clipboard/URL share) render as translucent ember-spectres; pace-markers
on Daily Road; race-result cards via the compositor.
- **Hook:** crossing the third-boss kill 4 seconds ahead of your friend's glowing ghost.

### 20. HEARTHHOLD — The Keeper's Camp *(L)* — deps: 4, 5, 2 (+enriched by 12/15/16)
The capstone: the menu backdrop becomes YOUR camp — 15 earned boss trophies,
Ash Rank seals, Cycle banners, patron banners, relic plinths, the Troop perch,
a luxury coin-sink decor shop (pure vanity) — exportable as a visit card.
- **Hook:** your start screen, nobody else's: trophies over the hearth, your familiar asleep on its perch.

---

## Sequencing spine (the four decisions that shape the order)

1. **EMBERGLASS interleaves at #2** so the card compositor exists exactly once,
   *before* KINDLED's Rite card — then updates 14/15/19/20 all reuse it.
2. **The determinism chain is staged honestly**: ghosts don't need a seeded sim
   but fair *races* do — so 17 ships the seeded RNG + string codec + the Game.js
   split, 14 ships the archive traces earlier, and 19 consumes all three.
3. **BOSSFORGE (4) is load-bearing**: its perf refactor gates 11/16/17; its
   phase-2 kits are why 7/15/16 schedule after it.
4. **Every absorbed lane ships inside a named update** — seasons→15,
   prestige/mythics→16, PWA/mobile/a11y→18 (+touch in 3), save hardening→14,
   code-health split→17, creature-sheet coherence→12 — nothing lives in a side-lane.

## Punch list (unchanged from v2 — rides inside update 1)

banana hat 2px float · halo rests on crown · crown band 1px from eyes · aura
face-washout cap · flamewand invisible from behind · fur-tint preview gap ·
`ASPECT_RATIO` dead export · save `version` written-never-read · kill-streak
double-report · boss HUD layering · wave-1 off-screen ring · endgame walls
surfaced in HUD/fiction.

---

*Cadence for every item: verify (headless EXC:0 + targeted checks) → branch
commit + push → PR → squash-merge to main → reconcile. Deploys run from main.*
