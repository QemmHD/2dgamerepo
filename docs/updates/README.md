# EMBERWAKE — Detailed Update Specs (#2–#17)

*Generated 2026-07-04 from a 16-author + 2-judge planning workflow. Each spec is code-grounded (file:line citations), PR-by-PR, with tunable starting numbers. The cross-spec rulings below are BINDING — they resolve every overlap found between independently-authored specs. See `docs/ROADMAP.md` for the 20-update overview.*

| # | Update | Verdict | Spec |
|---|--------|---------|------|
| 2 | EMBERGLASS — The Keeper's Lens | ADDS | [02-emberglass.md](02-emberglass.md) |
| 3 | KINDLED — The Waking Hand | ADDS | [03-kindled.md](03-kindled.md) |
| 4 | BOSSFORGE — The Twelve Reforged | ADDS | [04-bossforge.md](04-bossforge.md) |
| 5 | THE KINDLED TROOP | ADDS | [05-the-kindled-troop.md](05-the-kindled-troop.md) |
| 6 | UNDERTOW — The Quenched Forge | ADDS | [06-undertow.md](06-undertow.md) |
| 7 | THRESHOLDS — Rites of the Twelve | IMPROVES | [07-thresholds.md](07-thresholds.md) |
| 8 | GLOAMCALL — The Sixth Patron | ADDS | [08-gloamcall.md](08-gloamcall.md) |
| 9 | WAYLIGHT — The Living Road | ADDS | [09-waylight.md](09-waylight.md) |
| 10 | THE SEVENTH AND EIGHTH WICKS | ADDS | [10-the-seventh-and-eighth-wicks.md](10-the-seventh-and-eighth-wicks.md) |
| 11 | FORGEHEART — The Living Anvil | ADDS | [11-forgeheart.md](11-forgeheart.md) |
| 12 | CINDERS & SCRIPTURE — The Keeper's Codex | ADDS | [12-cinders-scripture.md](12-cinders-scripture.md) |
| 13 | THE LAST HEARTH | ADDS | [13-the-last-hearth.md](13-the-last-hearth.md) |
| 14 | THE LEDGER OF ASHES | ADDS | [14-the-ledger-of-ashes.md](14-the-ledger-of-ashes.md) |
| 15 | ASHBOUND — The Ash Ranks | IMPROVES | [15-ashbound.md](15-ashbound.md) |
| 16 | NIGHTFALL CYCLES — The Rekindling | IMPROVES | [16-nightfall-cycles.md](16-nightfall-cycles.md) |
| 17 | THE SEALED STORM — Forge Your Trial | ADDS | [17-the-sealed-storm.md](17-the-sealed-storm.md) |

## Binding cross-spec rulings (all 15)

### 1. #2 EMBERGLASS vs #13 THE LAST HEARTH vs #17 THE SEALED STORM

**Conflict:** #2's docs/CARDS.md freezes the CardCompositor reuse contract as "updates 3/14/15/19/20" (matching ROADMAP.md:29), but #13 PR4 ships a siege share card and #17 PR4 auto-mints a shareable challenge-code card on every game-over screen — two card producers outside the frozen contract list, each at risk of building parallel share plumbing.

**Ruling:** #2 owns ALL card/share plumbing; the CardCompositor template registry is an OPEN, append-only contract, and docs/CARDS.md must be re-worded from a closed five-update list to "any update registers templates via registerTemplate(); known consumers: 3, 13, 14, 15, 17, 19, 20." #13 registers a 'siege' template and #17 registers its game-over challenge-code presentation through that contract; neither ships its own offscreen canvas, share ladder, or clipboard/navigator.share code.

### 2. #2 EMBERGLASS vs #15 ASHBOUND vs #17 THE SEALED STORM

**Conflict:** Three updates claim the same game-over/death card surface: #2 authors the death-card template, #15 stamps an Ash Rank wax seal on it (blazing/cracked), and #17 retro-shares the reproduction challenge code on it. Authored independently, #15 and #17 each imply editing #2's death template.

**Ruling:** #2 owns the death/victory templates and must define named EXTENSION SLOTS in src/content/cardTemplates.js and docs/CARDS.md: a 'stamp' slot (badge region) and a 'footer' slot (code/text line). #15's wax seal registers into the stamp slot; #17's challenge code registers into the footer slot. Neither #15 nor #17 forks or redraws the death template; slot renderers are pure draw functions passed to the compositor.

### 3. #4 BOSSFORGE vs #8 GLOAMCALL vs #17 THE SEALED STORM

**Conflict:** #8's 'swarm' kind (Duskmoths/Veilwisps gloam-motes) is specced to "live outside the projectile pool" — directly against #4's load-bearing substrate (pooling + the first ENFORCED projectile caps + shared spatial grid) and against #17's determinism requirement of pooled/ordered entity updates. An unpooled, uncapped, self-colliding mote class re-opens the O(P×E) hot loop and the per-shot allocations #4 exists to close.

**Ruling:** #4 owns the perf substrate. Swarm motes MAY be a distinct entity class from projectiles, but they MUST (a) be pooled with a hard cap declared in GameConfig (counted in a SWARM budget beside the ~220-projectile cap), (b) resolve collisions through #4's shared spatial grid — no parallel collision path, and (c) update in stable, pooled iteration order so #17's determinism assertion holds. #8's spec replaces "live outside the projectile pool" with "live in their own pooled, capped, grid-registered swarm pool."

### 4. #14 THE LEDGER OF ASHES vs #17 THE SEALED STORM (re: #19)

**Conflict:** #14 claims it "mints the per-run telemetry traces that update 19's ghost races will consume" (monkey-survivor:traces:v1) — sanctioned by the spine (ROADMAP.md:168-169). #17's boundary text contradicts this by assigning "telemetry ghost recording/encoding" to #19.

**Ruling:** #14 owns trace RECORDING and local persistence (the traces:v1 ring buffer, sampling cadence, size caps). #19 owns ghost SHARE-ENCODING (delta-encoded base64 race strings), spectre rendering, and race semantics. #17 owns neither — only the seeded sim that makes races fair. #17's boundary sentence is corrected to: "#19 owns ghost share-encoding, rendering, and races; the raw traces are minted by #14."

### 5. #3 KINDLED vs #10 THE SEVENTH AND EIGHTH WICKS

**Conflict:** #3 ships per-hero tables sized to six heroes: signatures.js (6 Grand Signature ults), rites.js (18 rites, 3/hero), the hero-locked daily Rite Trial, and Hero Attunement. #10 grows the roster to 8 but its DATA list (chronicles.js, loreChronicles.js) claims NO appends to any of #3's tables — leaving Raiko and Nivara with no ult, no Rites, no Attunement, and breaking the Rite Trial's hero-lock pool. This content is claimed by neither spec.

**Ruling:** #3's tables are append-only registries keyed by hero id, and #3 must not hardcode the count six anywhere (Rite Trial pool, Attunement, ult wiring all derive from characters.js). #10 owns authoring the new heroes' rows: PR1/PR2 must each append one signatures.js entry and three rites.js entries (plus Attunement pricing) for Raiko and Nivara. #10's DATA section is amended to list these appends explicitly.

### 6. #4 BOSSFORGE vs #6 UNDERTOW vs #11 FORGEHEART vs #12 CINDERS & SCRIPTURE

**Conflict:** Boss arithmetic disagrees across four specs: #4 remodels "the 12 bosses" and Boss Rush runs "all twelve"; #6 adds the Tidewarden apex (update 6); #11 claims its three bosses "complete the roster to 15" (12+3, silently excluding Tidewarden); #12's codex ships "THE_TWELVE (12 boss ids)" at update 12 when 16 boss-class enemies exist.

**Ruling:** Canonical taxonomy, to be quoted verbatim in all four specs: "The Twelve" is the fixed set of legendary campaign duels in GameConfig.js:379-663 and is what #4 remodels, #7 ritualizes, and #12's Twelve page commemorates. Forgeheart's Bellows/Smith/Anvil (#11) are campaign roster additions 13–15: #11 must append them to the data-driven Boss Rush pool and declare their bossRites rows (already in its PR4). The Tidewarden (#6) is Descent-mode-exclusive: excluded from roster counts, Boss Rush, The Twelve, and Thresholds; it appears in the codex per the next ruling. Boss Rush's roster is registry-driven, not a hardcoded twelve.

### 7. #12 CINDERS & SCRIPTURE vs #6 UNDERTOW, #8 GLOAMCALL, #11 FORGEHEART, #16 NIGHTFALL CYCLES

**Conflict:** #12's fixed counts are stale against its ship position: BESTIARY_ROSTER has 21 entries but #6 ships 4 drowned creatures six updates earlier (roster should be 24+); "26 relics" equals TODAY'S relics.js count, ignoring #8's umbral relics that ship before it; the boss pages ignore #11's three bosses and #6's Tidewarden; and #16 later adds 6 reliquary relics and 5 twilight elites that would strand the Archive's 100% Curator's Lantern.

**Ruling:** #12 owns the codex but must author it against the post-#11 world AND make it append-safe: BESTIARY_ROSTER includes the drowned family and twilight-elite slots come free via registry-driven pages; the Relics page and shelfProgress() compute denominators from the live relics.js roster, never a literal; boss coverage = The Twelve page (fixed) + roster-driven entries for Forgeheart bosses and the Tidewarden. Archive completion rewards CHECKPOINT at claim time — once claimed they are never revoked or re-locked when #16 (or any later update) grows a roster. #16's spec adds one line: its reliquary relics and twilight elites surface in the codex as data appends only, no codex UI changes.

### 8. #10 THE SEVENTH AND EIGHTH WICKS vs #12 CINDERS & SCRIPTURE

**Conflict:** Two hero-lore surfaces: #10 mints hero-personal lore pages (loreChronicles.js, unlocked via Chronicles quests) at update 10; #12 ships a Codex "The Keepers" page at update 12 — in a game where the hero is "the wick-keeper," both specs plausibly author hero lore, risking a duplicated data set and two competing readers.

**Ruling:** #10 owns hero-personal lore DATA and its unlock gating (loreChronicles.js is the single source). #12's Keepers page is a DISPLAY shelf: it renders the Chronicles pages the player has unlocked (reading #10's data and save state) plus any non-hero keeper-world lore #12 authors; it must not define a second hero-lore table. If #12 ships before deciding layout, the Keepers page reads loreChronicles.js by contract and degrades gracefully for locked pages.

### 9. #9 WAYLIGHT vs #13 THE LAST HEARTH

**Conflict:** #13 claims to MINT non-player targeting ("the only place enemies target something other than the player"; dual-target aggro tech "minted here"), but #9 ships four updates earlier with the Hollow Bell that "wheels the entire horde into a killbox" — which requires enemies to pursue a non-player point.

**Ruling:** Split by mechanism, quoted in both specs: #9's bell is a STEERING LURE only — a temporary movement-destination override with no attack target, no aggro roles, no enemy-vs-object damage; it lives inside WaylightSystem. #13 owns dual-target ATTACK aggro — breaker/hunter roles, taunt, gnaw slots, bolt intercept, a destructible objective with HP. #13's uniqueness claim is amended to "the only place enemies ATTACK something other than the player." If #13 wants a lure primitive it may generalize #9's hook, but the aggro system lands in #13.

### 10. #16 NIGHTFALL CYCLES vs #11 FORGEHEART

**Conflict:** #16 says the cycle remix spans "all four biomes," but #11 ships biome 5 (Forgeheart, MAP_ORDER 5th entry) five updates earlier — #16's remix roster, twilight-elite placement, and multiplier tuning are authored against a stale world.

**Ruling:** #16 is authored against the post-#11 world: remixRoster and cycle content derive from MAP_ORDER (five biomes) and the live 15-boss campaign registry (Tidewarden excluded as mode-only, per the boss-taxonomy ruling). Every "four biomes" reference in #16's spec is corrected to "all campaign biomes (MAP_ORDER-driven)."

### 11. #14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)

**Conflict:** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.

**Ruling:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.

### 12. #5 THE KINDLED TROOP vs #8 GLOAMCALL

**Conflict:** #5's familiars.js documents "a reserved umbral slot" (mirroring #3's reserved combo row), but #8 — the sole owner of all umbral content — never claims an umbral familiar; the reservation is dangling with no assigned builder anywhere in #2–#17.

**Ruling:** #8 owns all umbral content. Either #8 PR3 (Gloam Patron content) fills the sixth familiar slot as an append-only familiars.js row consuming #5's archetype contract, or the reservation is explicitly marked "deferred past update 17" in #5's spec. #5 must not ship a sixth familiar itself, and the slot must not block #5's roster UI (render 5 + one locked silhouette at most).

### 13. #3 KINDLED vs #4 BOSSFORGE vs #15 ASHBOUND (calendar-PRNG builders)

**Conflict:** Three updates independently mint deterministic calendar derivation: #3's daily Rite Trial (salt 0x4b494e44), #4's week-keyed Weekly Ember (no salt declared), #15's Everburn seasons/edicts (salt 0xa5b0e77). The repo convention (dailyRoad.js:15-30) is deliberate local mulberry32 copies with DISTINCT salts (0x9e3779b9 and 0x5eed1234 already taken) — the hazard is salt collision and an undeclared derivation in #4.

**Ruling:** The local-copy-with-unique-salt convention stands (no shared helper mandated; it is the documented decoupling pattern). Salt registry, to be appended to each spec: 0x9e3779b9 dailyChallenges, 0x5eed1234 dailyRoad, 0x4b494e44 Rite Trial (#3), 0xa5b0e77 Everburn (#15). #4 must declare a distinct week-number salt for weeklyEmber.js in its spec before build. None of these may later be rethreaded through #17's RunRng — calendar setup determinism and run-sim determinism stay separate by design.

### 14. #9 WAYLIGHT vs #11 FORGEHEART (and #6 UNDERTOW)

**Conflict:** #9 ships per-biome POI budgets for the four biomes existing at its ship date; #11 adds the forgeheart biome later but its append-only data list never touches waylight.js — Forgeheart would ship with undefined POI budgets. Separately, #6's mode-only Descent floors are not a biome and must not accidentally receive POIs.

**Ruling:** #9 owns WaylightSystem and must make it default-safe: an unknown biome id yields a zero budget (no POIs) rather than a crash. #11 owns Forgeheart's content and must append a forgeheart budget row to waylight.js in its PR1. #6 adds one line to its spec: WaylightSystem is inert in Descent (mode floors are not MAP_ORDER biomes, so the zero-budget default applies).

### 15. #6 UNDERTOW vs #11 FORGEHEART (hazard semantics)

**Conflict:** #11's headline claim — slagflow is "the game's first enemy-affecting terrain... every other hazard touches only the player" — silently constrains #6's earlier tidepool hazard, which #6's spec never commits to.

**Ruling:** Locked in both specs: #6's BIOME_HAZARD.tidepool affects the player (and player-side allies) ONLY — it never damages or slows enemies. Enemy-affecting terrain is minted in #11's slagflow and remains #11's exclusive claim. Both extend the same BIOME_HAZARD config block append-only.

### Verified-clean boundaries

Verified clean: #3↔#8 umbral handoff (elements.js reserves the row with `umbral:{reserved:true}`, #8 fills it in PR5 and builds no combo machinery); #3↔#5 (player-controlled verbs vs allied entity; #5 only consumes the combo table with a source scalar, never authors rows); #4↔#7 (mechanical kits vs presentation staging; bossRites is append-only with unknown-ids-ignored, which #11's PR4 declarations correctly exploit); #6↔#11 biome boundary (UNDERTOW_THEME is mode-only and never in MAP_ORDER, so Forgeheart's only-biome-5 claim holds); #15↔#16 (pre-run Torments vs post-victory cycles; cycleScale composes beside _applyRunScale); #8↔#16 (mythic wands land in weaponSkins.js as material variants, preserving #8's every-base-has-a-fusion invariant); #14↔#17 (records/archive vs determinism — no overlap once the ghost-trace attribution fix lands); #2↔#3 (Rite Trial daily-card DATA owned by #3, template by #2); #2↔#14 (frozen photo mode vs live clean-capture toggles are distinct surfaces); #5↔#9↔#13 FamiliarSystem consumers ship in correct order (5→9 temporary rescues, 5→13 Warden Stance); #14's three localStorage namespaces (runs:v1, traces:v1, save:v1:bak) collide with nothing; #3's touch controls vs #18's gamepad/PWA split matches the spine; declared PRNG salts are all distinct; #17's encounter-module split ships last among Game.js writers so no move-conflicts.
