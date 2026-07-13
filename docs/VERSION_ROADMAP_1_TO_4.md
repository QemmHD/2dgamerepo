# EMBERWAKE — The Four Fires Roadmap (1.0 → 4.0)

**Status:** code-grounded product plan, 2026-07-13
**Current product:** browser-first, offline-capable, single-player survivor roguelite
**North star:** a dark-fantasy monkey-and-wand game that feels authored, readable,
responsive, generous, and worth mastering for hundreds of runs.

This is the release roadmap. `ROADMAP.md` remains the long-range idea bank and
`EXPERIENCE_ROADMAP_2026-07.md` remains the detailed current-state audit. This
document turns those materials into three major-version arcs with clear player
promises, dependencies, exit gates, and content budgets.

## 1. Product contract that survives every version

EMBERWAKE is not becoming a generic live-service game. Its identity remains:

- cute but determined **monkey wick-keepers** in a hostile, beautiful darkness;
- **wands, forged magic, embers, roads, and the Last Light** — never a sword game;
- short-to-medium runs with automatic attacks plus deliberate dodge, Focus, and
  Kindle decisions;
- a complete free web edition that works without an account or server;
- local saves, shareable codes, deterministic challenges, and optional social
  features that do not require tracking;
- permanent rewards, honest odds, visible pity, and no paid power;
- canonical enemy palettes and a deterministic Blender-to-sprite pipeline.

The engagement model is **mastery, autonomy, collection, expression, and shared
stories**. Research on game engagement links sustained enjoyment to competence,
autonomy, and relatedness; the roadmap uses those needs instead of punitive
streak loss, fake scarcity, or deceptive near-misses. See
[A Motivational Model of Video Game Engagement](https://journals.sagepub.com/doi/pdf/10.1037/a0019440?download=true).

### Economy and store rules

1. The browser game remains complete and free.
2. Cases use earned coins only. Their odds and pity are visible before opening.
3. A case animation may create anticipation, but it must not imply that the
   player almost won an item that was never available at that reel position.
4. Battle-pass chapters never expire. Old chapters remain selectable archives.
5. No paid XP, paid stat gear, energy timers, punitive streak resets, or forced ads.
6. If a native edition later sells content, it sells **known, deterministic
   expansions or supporter cosmetics**, never paid randomized cases. Apple requires
   odds disclosure for randomized virtual items sold to players; this plan stays
   on the clearer side of that rule. See the
   [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
7. Duplicate protection, source labels, price, pity state, and exact contents are
   visible before a player spends currency.

## 2. Audited baseline at 1.0

The shipped foundation is already broad: 6 heroes, 4 biomes, 20 non-boss enemy
definitions, 12 bosses, 40 weapons, 11 evolutions, 15 fusions, 20 passives, 11
roads, 26 relics, 14 pacts, 10 keystones, 18 rites, 21 gear pieces, 60 cosmetics,
50 battle-pass levels, Daily Road, Rite Trial, Boss Rush, Weekly Ember, photo mode,
recap cards, adaptive music, touch controls, and four generated structure styles.

The baseline is deep enough. Its weaknesses are cohesion and product finish:

- a fresh save has historically entered combat before the menu can explain itself;
- canvas controls are strong for pointer/touch but incomplete for keyboard focus,
  gamepad, screen readers, text scaling, and reduced motion;
- some progression/save invariants were not enforced until the 1.0.1 health pass;
- combat had authored XP and collision rules that did not consistently reach the
  runtime outcome;
- 13 of 20 regular enemies still lean on the same chase grammar;
- houses are attractive set dressing but need more tactical and event meaning;
- the large content count needs clearer sources, goals, and collection routing;
- the current menu is capable but dense, especially on a phone-sized viewport;
- the native App Store shell, full offline service worker, remapping, and TestFlight
  QA pipeline do not exist yet.

## 3. How versions earn their number

- A **patch** fixes correctness, clarity, safety, or balance without changing the
  player contract.
- A **minor release** delivers one complete, testable experience pillar. It is not
  a bag of unrelated items.
- A **major release** changes why people return and how they describe the game.
  It needs a playable vertical slice, migration tests, performance proof, visual QA,
  accessibility QA, and a complete release narrative.

Every release exits through the same gate:

1. old-save and corrupt-save fixtures;
2. deterministic logic validators and `node --check` on every module;
3. `validate-assets`, progression, navigation, HUD, bosses, audio, and world gates;
4. real-game screenshots with `EXC:0` at desktop, phone, touch, boss, dense swarm,
   overlay, game-over, and menu states;
5. 180-enemy stress frame and bounded pickup/projectile/effect counts;
6. keyboard-only, touch-only, and gamepad-only completion of the primary loop;
7. captions, non-color cues, reduced motion, text scale, and sound-balance review;
8. changelog, credits/provenance, rollback notes, PR, main deploy, and post-deploy
   smoke.

---

# ARC I — 1.0 → 2.0: THE LIVING VIGIL

## Major promise

Turn a feature-rich browser game into a polished product. By 2.0, a new player
understands the fantasy in seconds, completes a first run without UI friction,
always understands what hurt them and what they earned, and can play comfortably
with touch, keyboard, or controller. Houses, enemies, bosses, progression, audio,
and menus must feel like parts of one authored game.

## 1.0.1 — Vigil Health (implementation in this release)

Ten evidence-backed fixes from a live menu-to-run audit and three code audits:

1. Fresh saves land on the menu and explicitly launch a **FIRST VIGIL · GUIDED**.
2. The guided tour covers current Modes and Boutique surfaces and teaches the
   important active controls instead of preserving stale copy.
3. Pause gains safe two-step Restart and Leave-to-Menu actions.
4. Tutorial copy no longer competes visually with level-up and modal choices.
5. Weekly Ember lifetime best survives save normalization and reload.
6. Permanent upgrades clamp to authored maximums and cannot increment past cap.
7. Gear and cosmetics cannot be equipped into the wrong category, with a second
   defense when applying the loadout.
8. Daily challenges select distinct metric families deterministically.
9. Every enemy, elite, and boss now pays its authored XP through one exact-value gem.
10. Hostile projectiles collide with house walls before they can hurt the player.

Art-pipeline maintenance also updates the Blender contract to its real 27-frame,
9-pose sheet and validates all three directions on Blender 5.1.

**Exit gate:** targeted combat and progression validators, all repository validators,
first-run browser proof, pause proof, level-up proof, save reload proof, 180-body nav,
and an `EXC:0` harness frame.

## 1.1 — First Light

**Player promise:** “I know what to do, and the game gets out of my way.”

- Add roving keyboard focus over the existing hotspot registry: Tab/arrows move,
  Enter/Space activates, Esc backs out, and the same router handles pointer/touch.
- Add canvas semantics: focusable named application, live status for menu changes,
  upgrade choices, boss arrivals, rewards, victory, and death.
- Replace hardware-only touch detection with active input modality. A hybrid laptop
  keeps the desktop HUD until a real touch is used.
- Make the menu phone-aware: stacked Settings, minimum readable helper text, safe
  44-point primary targets, and no fixed two-column layout at narrow physical scale.
- Add UI scale (100/115/130%), high-contrast telegraphs, non-color status glyphs,
  mono audio, caption detail, voice volume, and vibration controls.
- “Reduce Motion & Effects” inherits the OS preference for new saves and freezes
  decorative pulse/overshoot while preserving static combat warnings.
- Stage the tutorial as short playable beats: move, auto-fire, gem, level-up, blink,
  Focus, Kindle, coin, boss. One lesson at a time; no instruction behind a modal.
- Add a concise first-death debrief: cause, one thing learned, coins earned, Battle
  Pass progress, and one recommended next action.

Apple recommends teaching through play, supporting each platform’s normal input,
legible text, adaptive layouts, and 44×44-point touch targets. See
[Designing for games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/)
and [Game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls).

**Exit gate:** primary loop is completable without a pointer; 844×390, 667×375,
1280×720, 1920×1080, and 4:3 screenshots show no clipping; two reduced-motion
captures one second apart keep decorative UI stable.

## 1.2 — The Fair Forge

**Player promise:** “Every reward is understandable, useful, and honest.”

- Add a Collection Planner: pin up to three cosmetics, gear pieces, relics, or
  battle-pass rewards and show their exact source on Home and post-run.
- Add source filters: Pass, Cases, Boutique, Achievement, Boss, Rite, Map, and Set.
- Make case odds, pity progress, duplicate conversion, and unowned weighting readable
  on one screen before opening.
- Replace misleading reel near-miss offsets with a reel that represents its real
  result neighborhood; keep anticipation through timing, lighting, audio, and a
  skippable reveal.
- Add “Open 5” only when five outcomes and duplicate conversions can be presented
  clearly, with a summary receipt and no faster economic rate.
- Add per-hero outfit slots and full-set quick equip.
- Turn Battle Pass into permanent selectable **Vigil Chapters**. New chapters add
  five signature cosmetics, coins, titles, and camp objects; old chapters never lock.
- Add an exact “next reward” widget and post-run progress receipt; no mystery XP.
- Add save export/import, one-generation backup recovery, migration fixtures, and a
  visible local-save warning before clearing browser data.
- Rebalance sinks using simulated earn/spend tables: beginner, collector, optimizer,
  10-run, 50-run, and 200-run cohorts.

**Exit gate:** all rewards have source text; every random spend shows odds and pity;
malformed/current/v7/v8/v9 saves migrate without loss; collection completion is
possible without an expiring schedule.

## 1.3 — Hunters at the Door

**Player promise:** “Enemies hunt differently, and buildings create decisions.”

- Give every enemy family a readable job: pursuer, flanker, artillery, shield,
  disruptor, summoner, bomber, ambusher, support, or siege.
- Build role budgets into the spawner so a wave composes threats instead of drawing
  an arbitrary pile. Limit simultaneous hard-disruptors and summoners.
- Add door-aware tactics: small enemies enter, large enemies circle or break line of
  sight, ranged enemies seek firing lanes, bombers threaten exits, and teleporters
  never materialize inside collision.
- Add stuck recovery with a visible debug reason, bounded re-path cadence, and an
  open-cell fallback that never teleports an enemy into the player.
- Make hostile bolts, beams, shockwaves, and hazards consistently respect their
  authored wall rules.
- Route all collateral kills through one canonical death/reward pipeline.
- Apply difficulty and Boss Rush scaling to boss special attacks, not contact only.
- Delay a scheduled boss while a Lieutenant is alive instead of deleting the
  Lieutenant and its payout.
- Choose a valid open boss arena center; no house-centred sealed fights.
- Give each boss a three-part identity: signature opener, phase-two transformation,
  and desperation move. Shared attack kinds remain implementation vocabulary, not
  personality.

**Exit gate:** scripted route tests for every structure and body size; every boss
attack family checked at each difficulty; volatile→splitter/boss rewards exactly once;
no spawn, arena, or projectile damage occurs through blocked geometry.

## 1.4 — The House of Wicks

**Player promise:** “The map tells small stories instead of being empty floor.”

- Rebuild the four house silhouettes in Blender as modular roof/wall/door kits with
  intact, damaged, lit, and ruined states.
- Add readable interiors with one focal prop, not random clutter carpets.
- Add six POI events: trapped Keeper, waystone relight, bell killbox, caravan defense,
  abandoned forge choice, and candle vigil.
- Add map-object lanes: cover, choke, risk circle, reward pocket, traversal landmark.
- Add biome obstacle variants with identical collision truth but distinct shape and
  material language.
- Add map readability passes: landmark silhouette every 1.5 screens, quiet lanes
  between dense scenes, edge contrast, and pickup-safe negative space.
- Add destructible minor cover only where all enemy/projectile rules can share one
  collision source; major houses remain stable navigation anchors.
- Add a minimal compass ping for off-screen POIs and bosses, with distance and type.

**Exit gate:** each biome has three recognizable screenshots without UI; seeded maps
remain deterministic; POIs never block required paths; 180-body navigation stays
inside the established frame budget.

## 1.5 — The Living Score

**Player promise:** “The game sounds composed and stays audible from minute 1 to 30.”

- Preserve the current Calm/Hunt/Swarm/Onslaught/Boss/Boss Final music-state model,
  then author transitions as musical phrases instead of volume jumps.
- Target at least three menu pieces, two authored pieces per biome, one suite per
  boss family, phase-two stingers, victory/death resolves, and short quiet returns.
- Add SFX priority groups and voice limits; player hit, boss tell, pickup milestone,
  and menu confirmation always survive a dense swarm.
- Add an automatic mix probe that measures integrated music/SFX balance across calm,
  swarm, boss, and final-boss scenes for ten simulated minutes.
- Stream long tracks, buffer short one-shots, recover after suspended audio contexts,
  and expose Music/SFX/Voice/Master sliders plus a Night Mix.
- Caption boss lines and meaningful non-dialogue cues; no mechanic depends on hearing.
- Add pause/resume/focus-loss tests so music never silently disappears after a long run.

MDN recommends streaming long tracks, buffering short samples, handling browser
autoplay through a user gesture, and giving players explicit volume control. See
[Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

**Exit gate:** 30-minute soak on Safari/Chrome/Firefox profiles; no dead music,
unbounded nodes, scheduler runaway, clipped master, or scene-transition spam.

## 1.6 — Reforged Bodies

**Player promise:** “Every hero and boss is recognizable in motion.”

- Finish six distinct Blender hero bodies on the shared 27-frame contract: idle,
  blink, three-step walk, cast, hurt, death, and victory in down/up/side.
- Add dash/Focus/Kindle overlays without multiplying sheet memory where a runtime
  layer is clearer.
- Build a parametric wand armory with exact grip anchors and silhouette checks.
- Rebuild the twelve bosses in four shared material families but unique silhouettes,
  telegraph poses, phase shifts, hurt, defeat, and portrait crops.
- Build modular house/POI kits from 1.4 and render deterministic sprite sheets.
- Pixelate with fixed logical resolution, palette, outline, and alpha rules; never
  hand-crop generated sheets.
- Add contact sheets and automated bounds, footline, anchor, frame-count, alpha,
  duplicate-frame, and asset-credit checks.

Higgsfield is used for **mood boards, lighting explorations, trailer storyboards, and
key-art shot ideation**. Blender remains the source of truth for playable models and
sprite sheets. Higgsfield’s Canvas supports chained reference/image/video workflows;
that makes it useful for controlled exploration, not a replacement for deterministic
game assets. See [Higgsfield Canvas](https://higgsfield.ai/canvas-intro).

**Exit gate:** all shipped sprites regenerate from committed parameters; runtime
fallbacks remain; source/rights are recorded; no new art breaks canonical palettes.

## 1.7 — ForgeGrip and Native Candidate

**Player promise:** “It feels at home on phone, tablet, desktop, and controller.”

- Add poll-based Gamepad API input, dead zones, edge-triggered buttons, focus ring,
  remapping, glyph switching, disconnect recovery, and optional haptics.
- Add PWA service worker, offline shell, update prompt, install education, and cache
  version rollback.
- Add native adapter boundaries for storage, haptics, safe areas, share sheet,
  clipboard, lifecycle, audio session, and restore.
- Package the web-first code in a **Capacitor 8** shell for iOS/Android without
  forking gameplay logic. Capacitor is explicitly designed to place web apps in a
  native runtime while exposing native APIs; see the
  [Capacitor documentation](https://capacitorjs.com/docs).
- Match launch screen to the first rendered game screen and restore the previous
  menu/run-safe state where possible. Apple’s launch guidance prioritizes immediate
  interaction and visual continuity; see
  [Launching](https://developer.apple.com/design/human-interface-guidelines/launching).
- Produce App Store screenshots from real builds, one honest 20–30 second preview,
  accessibility support page, privacy disclosure, age rating, and review notes.
- Keep the web build first-class and deployable from the same content manifests.

**Platform dependency:** Windows can build/test the web and Android shells, but the
final iOS archive, signing, TestFlight upload, and App Store submission require a Mac,
Xcode, an Apple Developer account, certificates, and App Store Connect access. Apple
currently documents Xcode/Transporter upload paths in
[Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).

## 2.0 — THE LIVING VIGIL

2.0 is not “more stuff.” It is the first cohesive product release:

- explicit, measured first session;
- touch, keyboard, and controller parity;
- four living biomes with meaningful houses and POIs;
- enemy roles and twelve boss fights that respect world geometry;
- fair, legible progression and permanent battle-pass chapters;
- complete audio mix, accessibility suite, save portability, and offline shell;
- deterministic Blender art pipeline and a native release candidate.

**2.0 ship gate:** 20 external first-session tests; 80% start a guided run without
help, 70% identify the death cause, 90% find the next goal, zero save-loss defects,
zero P0 accessibility blockers, and stable 30/60 FPS tiers on the defined device lab.

---

# ARC II — 2.0 → 3.0: THE SHARED FLAME

## Major promise

Turn isolated runs into a world players can share, inhabit, and revisit without
requiring a server. By 3.0, runs produce stories, challenges, ghosts, camp trophies,
companions, permanent chapters, and couch play. The game grows horizontally through
meaningful modes and identity, not only larger stat numbers.

## 2.1 — The Sealed Storm

- Thread a named-stream seeded RNG through spawn, elite identity, drafts, loot,
  roads, hazards, combat, AI, and scatter while leaving cosmetic VFX alive.
- Encode map, difficulty, Trials, road, clause, and seed into versioned, checksummed,
  human-safe challenge codes.
- Add the Crucible composer and a recent-trials shelf.
- Add determinism CI: two full fixed-input simulations of the same seed must match.
- Add an RNG allowlist so future gameplay randomness cannot silently bypass the seed.

## 2.2 — Ember Race

- Record bounded local telemetry traces at a low cadence.
- Share compact ghost codes and render an ember spectre with no collision or gameplay
  authority.
- Add pace markers, split comparisons, personal best deltas, and seeded daily races.
- Keep all comparisons opt-in and local; no public rank, account, or tracking required.
- Add invalid-code limits and version honesty: unknown codes fail, never approximate.

## 2.3 — The Kindled Troop

- Add one companion familiar slot with six monkey familiar archetypes.
- Companions level inside the run, take readable commands, and consume strict entity
  and projectile budgets.
- Add rescue POIs and a camp perch; familiars are earned through play.
- Let relaxed players choose support behaviors while optimizers tune focused builds.

## 2.4 — Keeper’s Camp

- Transform Home into the player’s camp: hero by the hearth, selected familiar,
  boss trophies, map banners, relic plinths, battle-pass objects, and recent run card.
- Keep navigation immediate: Continue/Start is always the primary action and every
  decorative object is optional.
- Add layout presets, earned decor, screenshot framing, and visit/share cards.
- Camp state is data-only and clamped; missing assets fall back safely.

## 2.5 — Two-Keeper Couch Play

- Add local two-player support with two controllers or controller + keyboard.
- Use one shared camera and shared XP with individual Kindle/signatures.
- Add revive windows and role synergies without doubling enemy/projectile caps.
- Add drop-in/out at safe moments, independent remaps, color+shape player markers,
  and combined end cards.
- If full two-body co-op fails readability/performance gates, ship an asymmetric
  “Keeper + Familiar commander” mode rather than a compromised twin-stick pileup.

## 2.6 — The Archive Seasons

- Replace expiring seasons with permanent named chapters.
- Each chapter adds a biome weather variant, a challenge clause, five cosmetics,
  one camp set, three lore pages, and a curated boss remix.
- Active chapter provides discovery focus, not exclusive access; players can switch
  chapters from the Pass screen.
- Weekly edicts rotate within owned/free chapter content and award universal currency.
- Add rested chapter progress so returning players catch up without a grind tax.

## 2.7 — Known-Content Expansions

Build a static content-pack manifest for future DLC and free expansions:

- pack id/version/min-game-version;
- maps, encounters, bosses, weapons, cosmetics, music, localization, credits;
- deterministic checksums and graceful missing-pack behavior;
- save records stable ids, never array positions;
- web build can include all free packs; native storefront can unlock known packs.

First candidate packs:

1. **UNDERTOW** — flooded descent map, quenched enemy family, Tidewarden trio,
   steam/frost interactions, drowned camp set.
2. **WAYLIGHT** — living-road events, caravan stories, rescue chains, lantern set.
3. **FORGEHEART PRELUDE** — slag hazards, anvil trials, mythic wand material set.

No pack sells a random outcome. The product page lists exact heroes/maps/bosses/items.

## 2.8 — Roster and Mastery

- Add two monkey heroes only after their signatures fill real playstyle gaps.
- Add per-hero Chronicle quests with authored challenges, not damage chores.
- Add mastery constellations that unlock expressive sidegrades, titles, palettes,
  victory poses, and camp memories.
- Add build history, favorite loadouts, and “try this next” suggestions based on
  incomplete discoveries, not hidden behavioral profiling.

## 3.0 — THE SHARED FLAME

3.0 changes the reason to return:

- deterministic challenge creation and fair ghost racing;
- camp identity and persistent trophies;
- companions and local couch play;
- permanent archive chapters instead of FOMO;
- a safe content-pack/DLC architecture;
- 8 heroes, at least 6 fully distinct maps, and bosses/events added only when they
  meet the authored-identity gate.

**3.0 ship gate:** same-seed determinism proof; ghost codes remain bounded and
versioned; two-player 30-minute soak at device-tier budgets; no chapter expiry;
content packs remove cleanly without corrupting base saves.

---

# ARC III — 3.0 → 4.0: THE REKINDLING

## Major promise

Turn EMBERWAKE from a collection of excellent runs into a complete long-form
adventure. By 4.0, players undertake multi-biome expeditions, make persistent route
decisions, carry scars and trophies home, enter Rekindled cycles, and face an authored
finale — while every existing quick mode remains available.

## 3.1 — The Ember Pilgrimage

- Add a three-act expedition graph: choose a biome, road oath, risk, and destination.
- Runs remain 10–20 minute chapters; an expedition is resumed between chapters.
- Add camp interludes for healing, reforging, companion recovery, and route choice.
- Defeat ends the expedition but converts discoveries, lore, and a bounded portion of
  resources; no paid continue.
- Standard Run remains the instant-play mode.

## 3.2 — Wounds, Oaths, and Reforging

- Add temporary expedition scars that change decisions without permanently weakening
  the account.
- Add Oaths: voluntary rules that increase risk and unlock alternate routes.
- Add the reforge table: transform one item while sacrificing another, with previewed
  results and deterministic recipes.
- Add build archetype summaries and explicit cap warnings so advanced systems remain
  legible.

## 3.3 — Forgeheart

- Ship the world-forge as the campaign’s final biome: slag rivers, bellows winds,
  moving anvil cover, ember rain, and multi-level foundry houses.
- Add a new enemy faction with siege, molten armor, cooling, and formation behaviors.
- Add the Smith, Bellows, and Anvil apex trio plus one expedition-only final Keeper.
- Add a full original music suite and Blender model family.
- Keep world fire styling concentrated here so the biome earns visual escalation.

## 3.4 — Enemy Factions

- Move from isolated behaviors to faction cooperation: shields protect artillery,
  hunters flush the player from cover, summoners feed bombers, and supports retreat.
- Author counterplay tags and surface them in the Codex.
- Add director composition rules that prevent impossible combinations and repeated
  control chains.
- Add faction-specific house use and siege behavior.

## 3.5 — The Twelve Remember

- Add boss memory variants unlocked in expeditions: not larger health bars, but one
  swapped signature, arena rule, and phase transition.
- Add boss relationships, monuments, camp dialogue cards, and rematch contracts.
- Add no-hit, speed, low-Threat, and themed-build mastery goals with cosmetic rewards.
- Add a boss laboratory for learned attacks after the first encounter.

## 3.6 — Rekindled Cycles

- After the authored expedition finale, offer NG+ Rekindled cycles.
- Cycles remix factions, maps, weather, and boss memories with bounded multipliers.
- Add Everforge currency for mythic-looking wand materials and camp monuments only;
  base combat power remains achievable without an endless prestige treadmill.
- Add cycle-specific twilight elites and final-card treatments.

## 3.7 — The Keeper’s Chronicle

- Add a Codex for enemies, bosses, relics, maps, characters, events, and music.
- Unlock pages through observation and mastery, not blind grinding.
- Add short, illustrated lore scenes at monuments and expedition transitions.
- Add localization-ready string ids, layout expansion tests, subtitle timing, and
  font fallback before translating.

## 3.8 — Engine of the Fourth Fire

- Finish module seams around encounters, loot, status, boss choreography, menus,
  save migrations, and content packs.
- Enforce caps for pickups, hostile/player projectiles, hazards, companions, ghosts,
  damage numbers, and particles with value-conserving overflow.
- Add optional worker/offscreen preparation only after profiling proves a benefit;
  keep a main-thread Canvas fallback.
- Add replayable simulation fixtures, property tests, historical saves, device-tier
  quality profiles, load budgets, and long-run memory probes.
- Add crash-safe run snapshots at quiet checkpoints, never every frame.
- Keep vanilla ES modules and static hosting unless a measured feature requires a
  different architecture and a migration plan proves its value.

## 4.0 — THE REKINDLING

4.0 is a different-sized game while preserving the original loop:

- a complete multi-act expedition with an authored finale;
- fast Standard, Daily, Trial, Boss Rush, Crucible, Ghost Race, and Couch modes;
- eight or more heroes with mastery stories and companions;
- eight biome-scale destinations including Forgeheart, each mechanically distinct;
- faction tactics, boss memories, Rekindled cycles, and the full Chronicle;
- modular free/known-content expansions;
- mature performance, accessibility, save, replay, and art pipelines.

**4.0 ship gate:** a fresh player can finish an expedition without external help; a
veteran can enter Cycle III without mandatory repetitive chores; every major story
beat is captioned; all core menus work at 200% text intent; full expedition saves
recover after interruption; 60-minute memory and audio soaks remain bounded.

---

## 4. Retention architecture by player motivation

| Player motivation | Repeatable reason to return | Protection against grind |
| --- | --- | --- |
| Mastery | bosses, Oaths, heat, no-hit lab, personal splits | practice mode, clear tells, no paid advantage |
| Discovery | POIs, roads, factions, Chronicle, expeditions | seeded variety, source hints, no random lockout |
| Collection | sets, chapters, trophies, wand materials | visible sources, pity, duplicate protection, archives |
| Expression | heroes, outfits, camp, share cards, titles | cosmetics only; full preview and quick equip |
| Optimization | builds, pinned goals, challenge codes, history | explicit caps, deterministic recipes, comparison UI |
| Social | ghosts, codes, couch play, visit cards | opt-in, local-first, no public-rank pressure |
| Relaxed play | Recruit, quick vigil, companions, pause/resume | no streak loss, rested progress, reduced effects |
| Narrative | Chronicle, monuments, expedition acts | short scenes, replayable archive, captions |

### Return cadence without FOMO

- **Every run:** build decisions, one objective, exact reward receipt, next-goal pin.
- **Every few runs:** case pity, set progress, hero mastery beat, boss monument.
- **Daily:** one shared seed and three diverse goals; missed days cost nothing.
- **Weekly:** one authored edict or gauntlet; remains replayable after rotation for
  standard rewards.
- **Chapter:** permanent battle-pass story shelf; active focus can be changed freely.
- **Long tail:** camp completion, Crucible records, Chronicles, Rekindled cycles.

## 5. Art, model, and media production plan

### Blender — authoritative game assets

1. Parametric source and pose parameters are committed.
2. Fixed camera, lighting, cell, palette, outline, and anchor contracts.
3. Automated batch render to transparent sheets.
4. Deterministic pixelation and installation.
5. Contact-sheet review in all directions and motion states.
6. Runtime screenshot beside reference sheet at the same scale.
7. Bounds/alpha/anchor/duplicate-frame tests and provenance validation.

Asset batches follow gameplay needs: hero readability → boss choreography → house/POI
kits → new factions → Forgeheart. No large art batch begins before its collision,
animation, memory, and screen-size slots are measured.

### Higgsfield — exploration and marketing media

Use a shared Canvas graph with locked references for:

- three lighting/mood territories per major version;
- key-art and App Store screenshot composition studies;
- trailer shot lists, camera motion, and 6–12 second transition prototypes;
- boss-arrival storyboards and environment atmosphere;
- social announcement loops and update teasers.

Do not import a generated image directly as a final sprite. Translate selected ideas
into Blender geometry/material/lighting or into existing runtime effects, then run the
normal asset contract. Record model, prompt, date, source references, edits, and usage
rights in the asset ledger.

### Audio

- A musical brief precedes generation or composition: key, BPM, meter, motif,
  instruments, loop point, pressure layers, boss transformation, and mix target.
- Generated sketches can guide direction, but shipped music needs clear rights,
  reproducible stems/source, loop-safe masters, and loudness/mix QA.
- Every long track has a streaming path; every critical cue has a caption/visual pair.

## 6. Measurement without surveillance

The game currently promises no tracking. Preserve that promise.

- Add a local playtest dashboard that summarizes first-run steps, deaths, build picks,
  frame tiers, audio scene time, and economy only on the player’s device.
- Export an anonymized JSON report only when a tester explicitly chooses Share.
- Never silently transmit behavior, identifiers, or saves.
- Balance decisions require a minimum sample and qualitative notes; one streamer clip
  is evidence of a problem, not automatic proof of a global tuning answer.

Release scorecard:

- first meaningful input < 2 seconds on warm load and < 5 seconds on target cold load;
- menu/start choice understood without assistance;
- boss tells recognized by sight with audio muted;
- 95th-percentile frame time < 16.7 ms on high tier, < 33.3 ms on minimum tier;
- zero uncapped persistent entity arrays;
- zero save regressions across committed historical fixtures;
- all random reward sources expose odds/pity/source before spend;
- accessibility claims match Apple’s published evaluation criteria. See
  [Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/).

## 7. Major risks and kill criteria

| Risk | Early proof | Kill or reduce scope when… |
| --- | --- | --- |
| Content quantity lowers quality | one complete vertical slice | new enemy/map lacks unique counterplay or screenshot identity |
| Co-op destroys readability/perf | two-player graybox at cap | shared camera or effects cannot pass phone/30 FPS gate |
| Native shell forks the game | storage/audio/lifecycle adapter spike | fixes stop flowing cleanly between web and native |
| Expansions corrupt saves | removable-pack fixture | removing a pack loses unrelated base data |
| AI art drifts the identity | reference → Blender translation test | canonical palette/silhouette cannot be reproduced deterministically |
| Seasons become obligation | chapter-switch prototype | a missed week permanently removes earnable content |
| Economy becomes coercive | 10/50/200-run simulation | optimal progress requires repetitive low-fun farming |
| Major architecture rewrite stalls play | profile + seam prototype | measured frame/load/save gain does not justify migration cost |

## 8. Immediate execution order

1. Finish and ship 1.0.1 Vigil Health.
2. Land 1.1 keyboard focus, reduced motion, mobile menu, and accessibility state.
3. Build the 1.2 Fair Forge save/economy fixtures before adding new rewards.
4. Produce one 1.4 house/POI vertical slice while 1.3 enemy roles consume it.
5. Complete audio soak/mix gates and one Blender boss-family production batch.
6. Add Gamepad/PWA; spike native adapters only after the web primary loop is solid.
7. Do not begin deterministic ghosts, co-op, or expeditions until their preceding
   simulation, input, save, and performance gates are green.

The roadmap is intentionally ambitious, but each minor release is independently
valuable and shippable. A major version is declared only when its player promise is
visible in the first five minutes and still meaningful after the hundredth run.
