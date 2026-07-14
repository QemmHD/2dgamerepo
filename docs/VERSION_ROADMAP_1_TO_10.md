# EMBERWAKE — The Ten Fires Roadmap (1.0 → 10.0)

**Status:** code-grounded product plan, 2026-07-13
**Current product:** browser-first, offline-capable, single-player survivor roguelite
**North star:** a dark-fantasy monkey-and-wand game that feels authored, readable,
responsive, generous, and worth mastering for hundreds of runs.

This is the release roadmap. `ROADMAP.md` remains the long-range idea bank and
`EXPERIENCE_ROADMAP_2026-07.md` remains the detailed current-state audit. This
document turns those materials into nine major-version arcs with clear player
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
8. Mines keeps its high-risk identity: the current 5×5 board, 6 hidden mines,
   100/250/500/2,000-coin stakes, 0.93 payout factor, and five-play rolling-hour limit
   are a deliberate entertainment sink, not a promised income source.
9. Mines shows the exact next-tile bust chance, current cash-out, net win/loss, and
   session result before every irreversible choice. Its board is the real board;
   animation never fabricates a safe-looking near miss after the result.
10. No real-money wagering, cash redemption, player-to-player transfer, purchasable
    betting currency, loss-chasing offer, or paid randomized case is allowed. If a
    native edition ever has paid supporter currency, it is technically separate and
    cannot enter Cases, Mines, upgrades, or any power-bearing system.
11. Deterministic permanent upgrades remain the dependable progression spine.
    Random gear is bounded, source-visible, and never tuned so a lucky case makes the
    upgrade tree irrelevant. An optional Forge Reserve can protect the price of a
    pinned next upgrade from Cases and Mines without blocking a player who deliberately
    removes that reserve.
12. Economy changes ship only after strategy-aware simulations for upgrades, Cases,
    Mines, duplicate conversion, Battle Pass, and DLC cohorts. A loss never changes
    the shop order, creates a countdown, or makes the next wager glow more brightly.

These rules are stricter than merely displaying a percentage. The
[FTC dark-pattern report](https://www.ftc.gov/reports/bringing-dark-patterns-light)
describes designs that obscure or impair choice; EMBERWAKE's risk surfaces must instead
make the cost, probability, consequence, exit, and non-gambling alternative equally
easy to understand.

**Distribution compliance gate:** Apple requires odds before a purchased randomized
virtual item, while Google Play requires odds in advance and close/timely proximity to
the purchase. The FTC's 2025 HoYoverse settlement specifically describes alleged
deceptive odds/true-cost presentation and child-directed loot-box practices. See the
[Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en),
[FTC settlement announcement](https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental),
and Apple's guidelines above. Google also reports that Brazil's Digital ECA, effective
March 17, 2026, prohibits loot boxes in games aimed at or likely accessed by children
or adolescents; see
[Google Play country requirements](https://support.google.com/googleplay/android-developer/answer/6223646?hl=en-GB).
Before any native/store release, counsel/owner review must record audience, territory,
age-rating, currency source, and random-reward treatment. Where policy or audience
makes a random case unsuitable, the build replaces it with the deterministic blueprint
catalog; it never hides odds, relabels a loot box, or blocks core progression. The
browser build remains coin-only with no purchase or cash-out path.

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

### Repository anchors and status truth

This plan is tied to the code that exists, not to an imagined rewrite:

- `src/core/Game.js`, `GameUpdate.js`, `GameRender.js`, and `RunState.js` own the
  menu-to-run lifecycle, simulation order, render order, and per-run state.
- `MenuRenderer.js`, `UISystem.js`, `HUDLayout.js`, and `GameInputActions.js` are the
  seams for the menu, HUD, overlays, and shared pointer/touch/keyboard actions.
- `maps.js`, `MapRenderer.js`, `ObstacleSystem.js`, `StructureRenderer.js`, and
  `EnemyNavigation.js` already provide four biome definitions, dressing, house
  collision, and obstacle-aware movement; future maps extend those contracts.
- `Spawner.js`, `WaveDirector.js`, `BossDirector.js`, `BossChoreographer.js`, and the
  enemy definitions in `GameConfig.js` already enforce the combat population model.
- `CaseSystem.js` and `MinigameOverlay.js` own six coin-only case pools and Mines;
  `SaveSystem.js` owns the wallet, pity, wager quota, upgrades, stats, and migrations.
- `battlePass.js`, `BattlePassSystem.js`, `dailyChallenges.js`, `dailyRoad.js`,
  `riteTrial.js`, and `bossRush.js` already support a 50-level track and the existing
  Daily Road, Rite Trial, Boss Rush, and Weekly Ember return loops.
- `AudioSystem.js`, `MusicDirector.js`, and `music.js` are the only acceptable music
  lifecycle/mix integration seams; new songs do not bypass them.
- `tools/blender/`, `tools/artshot/`, `validate-assets.js`, and the canonical enemy
  sheets remain the source, capture, provenance, and visual-regression contracts.

**Shipped baseline:** the ten 1.0.1 Vigil Health fixes are on `main`. **In-flight
post-1.0.1 foundation:** the current content branch adds four interactive Vigil Site
archetypes (`Wayfarer Hearth`, `Ashen Archive`, `Keeper Cache`, `Gloam Beacon`) and
twelve named formation encounters—three for each existing biome—through
`VigilSiteSystem` and `EncounterDirector`. The same branch exposes Mines' exact
probability/payout quote, four fixed stakes and an about-7% target edge, preserves the five/hour cap,
and centers the real case result without a manufactured near miss. These count as
shipped only after determinism, save, performance, screenshot, PR, and deployed-main
gates pass.

## 3. How versions earn their number

- A **patch** fixes correctness, clarity, safety, or balance without changing the
  player contract.
- A **minor release** delivers one complete, testable experience pillar. It is not
  a bag of unrelated items.
- A **major release** changes why people return and how they describe the game.
  It needs a playable vertical slice, migration tests, performance proof, visual QA,
  accessibility QA, and a complete release narrative.

Every full major arc carries **46–60 substantive, player-visible additions**. An
addition must create a new decision, place, opponent, mode, expression tool, or
meaningful quality-of-life capability; validators, migrations, refactors, copy
variants, and cosmetic recolor quantity are evidence or production work, not count
padding.

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

Platform-readiness releases additionally test Apple’s responsiveness targets: discrete
UI work begins visible feedback within 100 ms and continuous interaction updates within
one display refresh. See
[Improving app responsiveness](https://developer.apple.com/documentation/xcode/improving-app-responsiveness).
Touch targets, contrast, non-color differentiation, focus, text resizing, and motion
are reviewed against [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and the declared Apple
Accessibility Nutrition Label features; a marketing claim never ships ahead of proof.

### Release train at a glance

Dates follow evidence, not the other way around. A version advances only when its
acceptance metric is met; an incomplete row ships under its current version number.

| Version | Release pillar | Minimum acceptance evidence |
| --- | --- | --- |
| 1.0.1 | Vigil Health | Ten named fixes; combat/progression/UX validators; fresh-save, pause, level-up, save-reload, 180-body, and `EXC:0` proof. |
| 1.0.2 | Waylight Calls | 4 site archetypes and 12 biome-authored formations; deterministic replays; additive stats/save round-trip; no pack exceeds live caps. |
| 1.1 | First Light | Primary loop completable by keyboard, touch, and pointer; five target viewports clip-free; reduced-motion and readable-focus captures. |
| 1.2 | Fair Forge | Every reward has source/odds/pity; Mines expected return validates at 0.93 for every cash-out depth; 10/50/200-run economy cohorts keep deterministic upgrades relevant. |
| 1.3 | Hunters at the Door | All 20 regular enemies have a tested role; all 12 bosses have distinct phase proof; 100 seeded structure routes produce no invalid spawn or unrecovered stuck body. |
| 1.4 | House of Wicks | 4 biome house kits, 6 complete POI events, and 3 landmark screenshots per biome; 180-body navigation stays within the existing budget. |
| 1.5 | Living Score | 3 menu tracks, 2 pieces per biome, boss-family suites, critical-cue voice limits, and a 30-minute pause/focus/audio soak with no silence or node growth. |
| 1.6 | Reforged Bodies | 6 heroes × the 27-render contract, 12 boss identity sets, modular houses/POIs, deterministic regeneration, provenance, anchor, alpha, and fallback validation. |
| 1.7 | ForgeGrip | Controller-only primary loop, offline cold boot/update rollback, lifecycle/audio restore, safe-area proof, and one native candidate from the shared web source. |
| 2.0 | The Living Vigil | 20 external first sessions; ≥80% start unaided, ≥70% identify death cause, ≥90% find the next goal; zero save-loss or P0 accessibility defects. |
| 2.1 | Sealed Storm | Two fixed-input simulations of every supported mode produce identical gameplay hashes; unknown/tampered challenge codes fail safely. |
| 2.2 | Ember Race | Bounded ghost codes reproduce route and split timing within tolerance; spectres never affect simulation; every comparison can remain private/local. |
| 2.3 | Kindled Troop | 6 distinct familiars; command/accessibility proof; entity and projectile caps hold during a 30-minute companion soak. |
| 2.4 | Keeper’s Camp | All trophies/decor are data-driven and fallback-safe; Start remains one action away; Practice grants no rewards; Dioramas round-trip with named missing-asset fallbacks. |
| 2.5 | Two-Keeper | Two-player primary loop and 30-minute swarm/boss soak; independent remaps, drop-in/out, revive, and non-color identity cues pass. |
| 2.6 | Archive Seasons | A chapter can be started, switched, completed, left for 90 simulated days, and resumed with no expired reward or punitive catch-up curve. |
| 2.7 | Known-Content Packs | Install/remove/upgrade fixtures for every pack; exact product manifest; base save survives missing or downgraded optional content. |
| 2.8 | Roster and Mastery | 2 gap-filling heroes, authored Chronicle paths, sidegrade-only mastery, and Blueprint import/export that reports missing content without unlocking it; each hero passes Recruit/Vigil/Nightmare runs. |
| 2.9 | Common Hearth | Four local profiles, portable Hearth Bundles, private share surfaces, and a no-reward Memory Theatre with caption/audio/motion controls all pass network-blocked completion. |
| 3.0 | The Shared Flame | 46 additions; determinism, ghost, couch, chapter, camp, and removable-pack gates pass together; at least 8 heroes and 6 mechanically distinct maps. |
| 3.1 | Ember Pilgrimage | Complete 3-act expedition with suspend/resume at every interlude; Waystation service/state survives route replay; Standard Run remains one-action instant play. |
| 3.2 | Wounds and Oaths | Every scar has counterplay/removal, every Oath previews risk/reward, every reforge is deterministic, and Journey Inscriptions archive/restore without exceeding caps. |
| 3.3 | Forgeheart | 1 new biome, 1 formation faction, 3 apex bosses, 1 finale, full music/art suite, and stable map navigation at cap. |
| 3.4 | Enemy Factions | Each faction demonstrates at least 3 cooperative tactics and explicit counterplay; director rejects repeated control chains and impossible compositions. |
| 3.5 | The Twelve Remember | 12 memory variants with changed signatures/arenas/phases; practice lab reproduces tells without progression farming. |
| 3.6 | Rekindled Cycles | Cycle III reachable without mandatory chores; multipliers remain bounded; Everforge rewards are expressive, not required combat power. |
| 3.7 | Keeper’s Chronicle | Every core enemy, boss, map, relic, character, event, and track has a sourceable entry; localization expansion and subtitle timing pass. |
| 3.8 | Fourth-Fire Engine | Historical-save/property/replay suite, quiet-checkpoint recovery, entity caps, and 60-minute memory/audio/device-tier soaks all pass. |
| 4.0 | The Rekindling | 46 additions; a fresh player finishes the expedition unaided; a veteran reaches Cycle III without grind debt; all major story, save, 200%-text, and offline gates pass. |
| 5.0 | The Wider Dark | 48 additions; 12 distinct destinations, Hunt/Siege, interiors, outposts, Atlas, weather, score, economy, accessibility, and offline Dispatch gates. |
| 6.0 | The Maker’s Forge | 54 additions; outside testers create, validate, replay, export, import, and remix safe offline maps/encounters/bosses/campaigns without code. |
| 7.0 | The Living Chronicle | 46 additions; complete five-act campaign, 12 useful heroes, four destinations, branch replay, community projects, story houses, score, access, and offline transfer. |
| 8.0 | The Distant Hearth | 54 additions; 50 invited cross-device sessions, reconnect/reward/privacy proof, solo earning parity, and a fully green offline regression suite. |
| 9.0 | The Worldweave | 48 additions; 16 destinations, finite seeded worlds, settlement/apex/climate systems, 90-minute soak, and forecast comprehension tests. |
| 10.0 | The Last Light | 60 additions; definitive campaign/modes/roster/economy/art/audio/accessibility/preservation release with zero known P0/P1 or save-loss path. |

---

# ARC I — 1.0 → 2.0: THE LIVING VIGIL

## Major promise

Turn a feature-rich browser game into a polished product. By 2.0, a new player
understands the fantasy in seconds, completes a first run without UI friction,
always understands what hurt them and what they earned, and can play comfortably
with touch, keyboard, or controller. Houses, enemies, bosses, progression, audio,
and menus must feel like parts of one authored game.

### 1.0 → 2.0 major scope contract — 46 additions across 18 epics

This is the counted feature contract for the major band, not a second wishlist.
The numbered commitments consolidate the detailed release work below; 2.0 does not
ship by completing a few favorite bullets and leaving the rest as “later.”

1. **Guided first-session journey:** authored playable lessons, first-death teaching,
   clear next action, and no competing tutorial/modal layers.
2. **Responsive, accessible UX:** phone-aware menu/HUD, UI scale, reduced motion,
   high contrast, non-color cues, captions, mono/night mix, and semantic status.
3. **Input parity:** shared pointer, touch, keyboard-focus, gamepad, remapping, glyph,
   disconnect, safe-area, and optional haptic behavior through one action router.
4. **Fair Forge economy:** source-visible collection planner, exact receipts, bounded
   duplicate conversion, economy simulation, and deterministic upgrade relevance.
5. **Honest Cases and high-risk Mines:** earned coins only, disclosed odds/pity and
   tile risk, authentic outcomes, optional Forge Reserve, and no loss-chasing UI.
6. **Permanent Vigil Chapters:** the 50-level Battle Pass becomes an archive shelf
   with selectable, non-expiring chapters, catch-up progress, and five-piece sets.
7. **Portable, recoverable progression:** export/import, backup recovery, corrupt and
   historical fixtures, stable ids, and clear local-save ownership.
8. **Authored tactical encounters:** deterministic biome formations with warnings,
   spawn budgets, clear states, objectives, achievements, and mastery records.
9. **Enemy role and navigation overhaul:** all 20 regular enemies gain jobs,
   structure-aware tactics, bounded stuck recovery, and shared collision truth.
10. **Twelve rebuilt boss experiences:** unique openers, transformations, desperation
    moves, valid arenas, wall-aware attacks, readable phase scoring, and exact rewards.
11. **Living houses and Vigil Sites:** four modular biome kits, interactive interiors,
    four repeatable site archetypes, six story POIs, and readable compass routing.
12. **Map-density and obstacle pass:** biome-specific landmarks, tactical object lanes,
    quiet space, destructible minor cover, reward pockets, and deterministic seeds.
13. **Combat HUD and feedback pass:** damage-source clarity, boss/POI/encounter state,
    prioritized alerts, build summary, objective progress, and readable dense swarms.
14. **Adaptive authored score:** multiple menu/biome/boss pieces, phrase-safe state
    changes, quiet returns, captions, voice limits, mix probes, and lifecycle recovery.
15. **Reforged visual identity:** six animated monkey heroes, twelve bosses, wands,
    houses, POIs, portraits, effects, and deterministic Blender sprite production.
16. **Collection expression:** per-hero outfits, five-piece sets, quick equip, source
    filters, cosmetic previews, achievement looks, titles, and photo/recap framing.
17. **Offline/PWA and native candidate:** service worker, update rollback, native
    adapters, Capacitor shell, lifecycle restore, and honest store media.
18. **Fair return loops:** varied run objectives, Daily Road, Rite Trial, Boss Rush,
    Weekly Ember, mastery goals, and post-run recommendations with no streak loss.

**Count ledger (46):** onboarding/menu/input/accessibility 8; economy/progression/
collection 8; encounters/enemies/bosses 10; maps/houses/POIs 7; HUD/audio/art 7;
offline/platform/return loops 6. The implementation bullets below define those
deliverables; validators, migrations, and refactors are required evidence, not extra
features counted to inflate the release.

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

Art-pipeline maintenance also updates the Blender contract to its real 27 renders:
three direction sheets with 9 poses each, validated on Blender 5.1.

**Exit gate:** targeted combat and progression validators, all repository validators,
first-run browser proof, pause proof, level-up proof, save reload proof, 180-body nav,
and an `EXC:0` harness frame.

## 1.0.2 — Waylight Calls (in-flight content foundation)

**Player promise:** “The world notices where I move and gives me a reason to change
my route.”

This release is the first playable slice of commitments 8, 11, 16, and 18. Its
content count is concrete rather than a generic “more variety” claim:

1. Add four interactive, structure-anchored Vigil Sites: Wayfarer Hearth healing,
   Ashen Archive XP, Keeper Cache coins, and Gloam Beacon guardian challenge.
2. Add twelve named tactical packs—three each for Emberwood, Hollowreach, Crypts,
   and Dunes—using wedge, ring, diamond, flock, line, escort, column, choir, and
   pincer formation grammars.
3. Schedule formations deterministically from run seed/biome/wave and keep cosmetic
   scatter outside gameplay authority.
4. Give every site and pack a readable warning, active state, success/failure state,
   reward beat, and bounded lifetime.
5. Reject unsafe spawn positions, arena/boss collisions, and requests over the live
   enemy budget; interrupted packs resolve without orphaning rewards or objectives.
6. Add additive run/lifetime tracking for sites activated, site kinds mastered,
   encounters cleared, and guardian packs defeated, with old-save defaults.
7. Add authored achievements that reward exploration and tactical clears instead of
   raw damage farming.
8. Add the five-piece **Waylight Regalia** cosmetic set with source labels and safe
   category equip validation.
9. Feed site/encounter metrics into varied run objectives and Daily challenges so the
   existing Battle Pass rewards route choice as well as kills and survival time.
10. Surface site/pack progress in HUD alerts, end-of-run receipts, lifetime stats, and
    achievement unlocks without adding another always-open panel.
11. Reuse prioritized objective, shrine, chest, lieutenant, and reward audio vocabulary
    so every event is heard without bypassing `AudioSystem` or masking combat tells.
12. Ship dedicated data/runtime validators, syntax and save checks, cap stress,
    desktop/mobile screenshots, and a real-game `EXC:0` capture.
13. Show Mines' exact next-tile safe/mine probability, live cash-out, next payout,
    net result, about-7% target edge with integer-rounding disclosure, and all four authored stakes before risk is taken.
14. Land the real case result beneath the marker and remove manufactured near-miss
    positioning while preserving anticipation through honest timing, light, and sound.
15. Add a strategy-aware gambling/economy validator for payout math, stake validation,
    wallet mutation, five/hour quota, edge disclosure, and reel landing truth.

**Current status:** content and isolated systems exist on the working branch; central
run/update/render/audio/save integration, adversarial validation, PR, deployed-main
proof, and post-deploy smoke are the remaining truth gates.

**Exit gate:** four site kinds and all twelve formations appear in deterministic test
runs; repeat activation cannot duplicate payout; boss transitions cannot strand an
encounter; old saves round-trip; Mines and case truth gates pass; 180-body stress, HUD,
audio, and screenshot gates pass.

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

### Main-menu clarity and restrained attention system

The menu overhaul extends `MenuRenderer` and the existing hotspot/action router; it
does not create a second DOM menu or bury Start behind a cinematic landing page.

- Give Home three stable reading levels: **Play** (Continue/Start + selected setup),
  **Now** (one pinned goal, one claim, one current challenge), and **Explore** (Modes,
  Forge, Collection, Pass, Boutique, Chronicle, Settings).
- Keep one dominant call to action. Alternate modes show their run length, difficulty,
  seed/lock rules, and reward difference before launch, never as equal glowing buttons.
- Use luminance, spacing, scale, and position as the primary hierarchy. Ember-gold marks
  the next action; cyan marks selection/information; red marks danger/irreversible
  actions; rarity colors stay inside reward contexts.
- Restrict full RGB split/chromatic effects to sub-second mythic reveals, boss/finale
  transitions, and optional photo filters. No idle tab, body copy, selected button, or
  continuous background uses rainbow cycling or color separation.
- Give every surface an **attention budget**: one pulsing object, one animated ambient
  region, and one transient badge maximum. Reduce Motion replaces all three with a
  static edge/shape treatment.
- Replace repeated red dots with typed badges—`NEW`, `CLAIM`, `GOAL`, or a number—and
  clear them when the relevant content is actually viewed or claimed.
- Keep currencies and pinned progress in a stable header; never move the wallet between
  tabs or hide the price/reserve state behind hover.
- Add inline “why locked,” source, and next-step copy. A locked hero, map, cosmetic,
  chapter, case, or mode always links to a deterministic route when one exists.
- Preserve player context across Back/Esc: tab, list scroll, selected item, filters,
  try-on state, and mode setup restore without replaying entrance animation.
- Budget menu rendering and asset decode separately from combat; cold/warm load, tab
  switch, controller focus, text-scale, and phone layout get screenshot/perf fixtures.

**Menu acceptance:** in five-second unmoderated tests, ≥90% identify Play, current
coins, and the next pinned goal; ≥80% explain the selected mode’s key difference; no
screen has more than one continuous attention animation; grayscale captures preserve
the action hierarchy; RGB-disable and Reduce Motion lose no information; a discrete
selection produces visible feedback within 100 ms and focus/scroll/drag responds within
one display refresh on the defined device tiers.

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

### Mines, Cases, and upgrade-economy lane

Mines is allowed to feel dangerous. At baseline it is a 25-tile board with 6 mines,
four fixed coin stakes, a 0.93 payout factor, cash-out at any safe reveal, and five
plays per rolling hour. The overhaul keeps that risk/reward shape while making its
math and its relationship to progression explicit:

- Show **next pick: safe X% / mine Y%** from the real unrevealed board state, current
  cash-out, maximum possible payout, stake, gross payout, and net result.
- Keep the 93% target RTP at every chosen cash-out depth and disclose small integer-payout edge variation;
  reject any multiplier table whose simulation drifts outside rounding tolerance.
- Add a local hand receipt: stake, revealed order, mine layout disclosed after stop,
  multiplier steps, payout, and wallet delta. Do not claim server-verifiable fairness
  in an offline game.
- Add an optional **Forge Reserve** equal to a pinned upgrade or player-entered amount.
  Cases and Mines can spend only the unreserved wallet until the player deliberately
  edits or disables the reserve.
- Preserve the existing 100/250/500/2,000 stakes so a player can choose a bankroll-breaking
  risk; never auto-select a higher stake after a win or refill the stake after a loss.
- Keep the five-play rolling-hour cap visible before play. A limit is never framed as
  a countdown that pressures the player to “use” remaining wagers.
- Add a session ledger for wagered, returned, net, biggest cash-out, and hands. It has
  a neutral Stop action and never celebrates recovered losses as profit.
- Show all case rarity odds, item-vs-consolation probability, current pool completion,
  duplicate value, unowned protection, exact pity trigger, and receipt before “open
  another.” Multi-open has identical economics and a complete outcome table.
- Measure **upgrade relevance** in every economy simulation: time to each permanent
  upgrade, share of combat power from deterministic progression, bankruptcy recovery
  runs, case collection time, and 10th/50th/90th-percentile bankroll.
- Bound gear and case rewards as sidegrades/collection accelerators. If an item makes
  the permanent upgrade of the same function mathematically pointless, change the
  item—not the upgrade price or the odds disclosure.
- Separate known-content purchases from random systems. DLC and supporter cosmetics
  display exact contents and cannot be wagered, converted into stake coins, or used to
  skip Battle Pass, Chronicle, hero mastery, or upgrade progression.
- Make Mines and Cases fully usable with keyboard/gamepad, reduced motion, muted audio,
  high contrast, and a confirmation preference for the 2,000-coin stake.

No screen uses a fake near miss, loss-triggered discount, “hot” tile, urgency timer,
social comparison, or notification to pull a player back into gambling. Excitement
comes from the actual board probability, chosen stopping point, audiovisual craft,
and the fact that a voluntary high stake can genuinely win or break the unreserved
bankroll.

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

### 2.0 → 3.0 major scope contract — 46 additions across 18 epics

The Shared Flame contains 18 major commitments. Each must create a new decision,
play pattern, place, or form of expression; cosmetic quantity alone cannot satisfy a
commitment.

1. **Sealed deterministic simulation:** named RNG streams cover gameplay while VFX
   remains free, enabling repeatable tests, challenge codes, ghosts, and fair dailies.
2. **Crucible mode composer:** players combine seed, map, road, Oath-like clauses,
   enemy rules, boss route, and difficulty into versioned local challenges.
3. **Ember Race ghost mode:** bounded, non-authoritative spectres, personal splits,
   seeded races, PB deltas, and opt-in share codes without a public-rank treadmill.
4. **Commandable familiars:** six monkey companions with distinct support roles,
   rescue quests, in-run growth, accessibility presets, and strict entity budgets.
5. **Keeper’s Camp hub:** a fast playable Home with trophies, decor, hero/familiar,
   recent run, collection goals, chapter objects, and safe fallbacks, plus two separately
   counted spaces: a reward-free Practice Lantern and a Hearth Diorama Studio.
6. **Two-Keeper couch mode:** local co-op, shared camera/XP, individual signatures,
   synergies, revives, drop-in/out, independent remaps, and combined recap cards.
7. **Permanent Archive Chapters:** selectable non-expiring Battle Pass stories with
   weather, clauses, bosses, camp sets, cosmetics, lore, and rested progress.
8. **Collection and store 2.0:** separate Known/Random/Earned shelves, collection
   planner fulfillment, exact case pool completion, deterministic duplicate redemption,
   wishlist receipts, a shareable Blueprint Desk for saved builds, and no random paid
   content.
9. **Static content-pack/DLC platform:** versioned manifests, stable ids, checksums,
   migrations, graceful removal, exact storefront contents, and base-game fallbacks.
10. **UNDERTOW destination:** flooded-descent map grammar, water-level routes,
    quenched faction, Tidewarden boss trio, flooded houses, and steam/frost builds.
11. **WAYLIGHT destination:** living roads, moving caravan map, rescue-chain POIs,
    ambush formations, lantern bosses, camp travelers, and the Waylight collection.
12. **FORGEHEART PRELUDE destination:** slag-work map, anvil trials, siege enemies,
    prototype apex, material crafting, and narrative bridge to the 4.0 finale.
13. **Expanded hero roster and mastery:** two gap-filling monkey heroes, Chronicle
    quests, mastery constellations, sidegrades, poses, palettes, titles, and memories.
14. **Formation factions and boss remixes:** new enemies cooperate in authored packs;
    chapter bosses change rules/tells rather than merely gaining health.
15. **Houses and POI chains:** multi-stage structures remember local choices across a
    run, support companion rescues/camp visitors, and remain navigation-safe at cap.
16. **Shared-Flame audio library:** map/faction/boss suites, companion voice grammar,
    camp day/night arrangements, unlockable jukebox, remix credits, and stable mixes.
17. **Accessible social/offline layer:** local profiles, export bundles, challenge and
    camp cards, controller co-op semantics, ghost visibility controls, a local Memory
    Theatre for replaying unlocked scenes and learned boss tells, and no account.
18. **Fair horizontal retention:** personal records, discovery routes, permanent
    chapters, rested progress, build history, and goals generated from missing content
    rather than hidden behavior scoring or expiring obligation.

**Count ledger (46):** deterministic/new/social modes 10; companions/camp/local social
8; maps/packs/houses/POIs 10; enemies/bosses/audio 7; heroes/progression/store/
cosmetics 7; accessibility/offline/portability 4. The four additions above the prior
scope are the Practice Lantern, Hearth Diorama Studio, Blueprint Desk, and Memory
Theatre. Pack migrations, net-free simulation, and validation work are acceptance
evidence rather than counted player features.

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
- Add a **Practice Lantern**: a configurable, reward-free arena for trying owned hero,
  wand, familiar, enemy-role, and learned boss-tell combinations without minting XP,
  records, currency, or challenge completion.
- Add a **Hearth Diorama Studio** with earned sets, heroes, familiars, trophies, poses,
  lighting presets, safe captions, and exportable still cards; missing assets fall back
  to named silhouettes instead of breaking a saved scene.
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

Every destination pack must contain a full playable reason to exist:

| Pack | Map and houses | Enemies and bosses | Modes, progression, art, and audio |
| --- | --- | --- | --- |
| UNDERTOW | Branching flooded descent, tide-height routes, pump-house interiors, drowned archive, ferry refuge, breakwater defense | 6-role Quenched faction; undertow puller, barnacle shield, mist artillery, lamprey flock, tide caller, hull breaker; Tidewarden Smith/Mother/Leviathan trio | Standard/Daily/Crucible routes; steam/frost reaction journal; 5-piece Drowned Keeper set; camp aquarium relics; 2 map tracks + layered trio suite |
| WAYLIGHT | Moving caravan route, crossroads that rejoin, wagon houses, roadside inns, lantern towers, rescue-chain state | 6-role Gloamroad faction; outrider, snuffer, hook ambusher, lantern mimic, toll shield, bell summoner; Wicker Stag and Lantern-Eater bosses | Escort and rescue clauses; familiar origins; 5-piece Waylight Regalia continuation; caravan camp visitors; travel variations + two boss suites |
| FORGEHEART PRELUDE | Slagworks perimeter, anvil courtyards, bellows tunnels, cooling houses, moving cover trial | 6-role Foundry vanguard; slag skater, crucible carrier, rivet artillery, bellows pusher, quencher support, anvil ram; First Hammer prototype | Anvil Trial mode; deterministic material recipes; 5-piece First Forge set; finale foreshadowing; percussion/stem prototype for Forgeheart |

**Pack content gate:** at least one map grammar that changes routing, five complete
POI/event chains, six readable enemy roles, two named formation packs, two boss-scale
encounters (three for a headline destination), one build interaction, five cohesive
cosmetics, a camp set, two exploration tracks, boss music, Chronicle pages, captions,
credits, localization ids, performance proof, and install/remove/migrate fixtures.

The web edition may bundle free packs directly. A native known-content purchase can
unlock a pack manifest but never a case roll, Mines stake, temporary access window,
power multiplier, or exclusive currency. Purchased pack data remains restorable and
its save records degrade to named placeholders rather than deleting unrelated progress.

## 2.8 — Roster and Mastery

- Add two monkey heroes only after their signatures fill real playstyle gaps.
- Add per-hero Chronicle quests with authored challenges, not damage chores.
- Add mastery constellations that unlock expressive sidegrades, titles, palettes,
  victory poses, and camp memories.
- Add build history, favorite loadouts, and “try this next” suggestions based on
  incomplete discoveries, not hidden behavioral profiling.
- Add a **Blueprint Desk** for naming, annotating, comparing, importing, and sharing
  owned-item builds; missing content is explained and previewed, never silently granted.

## 2.9 — The Common Hearth

- Add up to four entirely local Keeper profiles for households, each with its own save,
  accessibility/input preset, collection, camp, and protected delete flow.
- Add a portable **Hearth Bundle** containing save, challenge codes, ghost traces,
  photo cards, camp layout, settings, manifest versions, and a human-readable summary;
  import previews changes before applying them and keeps the previous generation.
- Add share actions for challenge code, ghost, camp portrait, build card, and expedition
  seed through clipboard/file/native share adapters; all work without an account.
- Add a local Recent Fires wall for personal bests, couch results, discovered bosses,
  completed chapters, and pinned rematches. It never pretends another human is online.
- Add ghost opacity/trail density, hide-name, motion reduction, co-op marker shape,
  familiar cue, caption speaker, and controller ownership controls.
- Add a Camp Jukebox earned by discovering tracks in play, with composer/source credit,
  calm/full arrangement preview, favorites, and “use default adaptive score” reset.
- Add a local **Memory Theatre** that replays unlocked chapter scenes, boss introductions,
  learned attack tells, and earned finale reactions with caption, pause, speed, audio,
  and reduced-motion controls; it cannot award progression on replay.
- Keep all 3.0 gameplay, chapters, packs, co-op, camp, ghosts, and profiles offline after
  installation; a missing network may remove share convenience, never owned play.

**Exit gate:** four profiles cannot cross-write; Hearth Bundle round-trips on current and
previous manifest versions; every share surface has a cancel path and private default;
all 3.0 modes complete in a network-blocked browser/native test.

## 3.0 — THE SHARED FLAME

3.0 changes the reason to return:

- deterministic challenge creation and fair ghost racing;
- camp identity and persistent trophies;
- companions and local couch play;
- reward-free practice, saved Build Blueprints, a Memory Theatre, and a Hearth Diorama;
- permanent archive chapters instead of FOMO;
- a safe content-pack/DLC architecture;
- local profiles, Hearth Bundles, and shareable creations that still work offline;
- 8 heroes, at least 6 fully distinct maps, and bosses/events added only when they
  meet the authored-identity gate.

**3.0 ship gate:** same-seed determinism proof; ghost codes remain bounded and
versioned; two-player 30-minute soak at device-tier budgets; no chapter expiry;
Practice/Blueprint/Theatre/Diorama imports are bounded and never mint power; content
packs remove cleanly without corrupting base saves.

---

# ARC III — 3.0 → 4.0: THE REKINDLING

## Major promise

Turn EMBERWAKE from a collection of excellent runs into a complete long-form
adventure. By 4.0, players undertake multi-biome expeditions, make persistent route
decisions, carry scars and trophies home, enter Rekindled cycles, and face an authored
finale — while every existing quick mode remains available.

### 3.0 → 4.0 major scope contract — 46 additions across 18 epics

1. **Three-act Ember Pilgrimage mode:** resumable 10–20 minute chapters connected by
   meaningful biome, risk, road, boss, and destination choices.
2. **Persistent expedition state:** versioned route graph, discoveries, resources,
   injuries, party, pack manifests, and quiet-checkpoint crash recovery.
3. **Playable camp interludes and Waystations:** healing, reforge, familiar recovery,
   Chronicle scenes, trophy changes, route scouting, and a clear “continue expedition”
   action, plus one restorable service outpost per established biome.
4. **Wounds, Oaths, deterministic reforging, and Journey Inscriptions:** temporary
   scars with counterplay, voluntary rule/reward contracts, previewed recipes and caps,
   plus reversible milestone-earned sidegrade inscriptions for a favorite wand or relic.
5. **Forgeheart biome:** slag rivers, bellows wind, moving anvil cover, ember weather,
   multi-level foundry houses, traversal layers, and a full visual/audio identity.
6. **Foundry formation faction:** siege, molten armor, cooling, pushing, repair, shield,
   artillery, and formation behaviors with explicit counter-builds.
7. **Apex trio and authored finale:** Smith, Bellows, Anvil, and final Keeper each gain
   bespoke arenas, cinematics, transformations, desperation moves, and resolution.
8. **Cross-biome faction cooperation:** every established enemy family uses cover,
   houses, support relationships, retreats, flanks, and director composition limits.
9. **Twelve boss Memory variants:** signature/arena/phase swaps, rematch contracts,
   monuments, relationships, no-hit themes, and a non-farming practice laboratory.
10. **Rekindled NG+ cycles:** bounded faction/map/weather/boss remixes, twilight elites,
    alternate routes, build tests, and expressive prestige without endless stat debt.
11. **Keeper’s Chronicle:** enemy, boss, map, relic, event, character, music, and lore
    entries unlocked by observation/mastery with localization-ready presentation.
12. **Expedition houses and POI state:** foundries, refuges, siege sites, monuments,
    caravans, and event chains change across acts without invalidating navigation.
13. **Hero and companion culmination:** every hero/familiar receives expedition banter,
    a mastery memory, finale reaction, team synergy, and accessible cue set.
14. **Endgame collection/economy closure:** deterministic blueprint redemption makes
    every legacy case pool completable; upgrades keep a finite useful endpoint; Mines
    remains an optional sink and never a required Everforge source.
15. **Fourth-Fire score and presentation:** expedition motifs recur across biomes,
    bosses transform stems, finales resolve musically, and all critical cues caption.
16. **Long-form UX and accessibility:** route previews, expedition recap, return-state
    clarity, 200% text intent, cognitive-load presets, and full input parity.
17. **Local-first expedition sharing:** route/seed/ghost/Hearth Bundles, couch continuity,
    photo cards, and offline completion without account, server, or live schedule.
18. **Fourth-Fire engine hardening:** modular content seams, value-conserving caps,
    replay fixtures, historical saves, tier profiles, memory probes, and safe fallbacks.

**Count ledger (46):** expedition/modes 8; maps/houses/POI state 7; enemies/bosses/
factions 9; progression/economy/collection 8; heroes/story/audio 6; UX/social/offline/
preservation 8. The two additions above the prior scope are Keeper Waystations and
Journey Inscriptions. Engine seams and test fixtures prove the additions; they do not
count as player-visible content by themselves.

## 3.1 — The Ember Pilgrimage

- Add a three-act expedition graph: choose a biome, road oath, risk, and destination.
- Runs remain 10–20 minute chapters; an expedition is resumed between chapters.
- Add camp interludes for healing, reforging, companion recovery, and route choice.
- Restore one **Keeper Waystation** per established biome, then choose its visible
  infirmary, scout, or workshop service. The preview states what later routes change;
  no construction timer or paid acceleration exists.
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
- Add reversible **Journey Inscriptions** earned from named expedition milestones: one
  bounded sidegrade and visual provenance mark can be placed on a favorite wand or
  relic, archived, and restored without exceeding the existing power ceiling.

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
- Complete collected case rarities through a visible blueprint exchange fed by
  duplicate dust and mastery—not another hidden roll—so no collection depends on an
  infinite dry streak after pity.
- If 2,000 coins becomes trivial in mature wallets, add an explicitly unlocked
  high-stakes Mines table with fixed authored stakes and the same disclosed 0.93
  expected return. Never scale a wager silently from the player’s current wallet.

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
- restorable Keeper Waystations and milestone-authored Journey Inscriptions;
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

# ARC IV — 4.0 → 5.0: THE WIDER DARK

## Major promise

Turn the completed pilgrimage into a world worth learning. By 5.0, the Atlas contains
twelve mechanically distinct destinations, persistent outposts, huntable apex threats,
enterable structures, and short or long routes. The player returns because places have
different rules and stories—not because numbers rose again.

### 4.0 → 5.0 release inventory — 48 additions across 16 epics

Each row contains three counted, player-visible deliverables. Internal refactors and
raw cosmetic recolors do not count toward 48.

| # | Epic | Three counted deliverables |
| --- | --- | --- |
| 1 | World Atlas | Zoomable destination map; side-by-side route/risk preview; mastery/source overlay for every place. |
| 2 | Cinder Coast | Tide-timed shoreline map; six-role Saltworn faction; Beacon Leviathan hunt boss. |
| 3 | Moonfen | Waterlogged boardwalk map; six-role Mire Court faction; Croaking King arena boss. |
| 4 | Skyroot | Multi-lane canopy map; six-role Gale Nest faction; Root-Crowned Roc aerial boss. |
| 5 | Glass Wastes | Reflection-and-cover desert map; six-role Shardkin faction; Prism Matriarch refraction boss. |
| 6 | Living weather | Six forecastable weather fronts; biome-specific hazard transformations; weather-reactive builds and POIs. |
| 7 | Enterable houses | Twelve authored one-room layouts; doorway/roof readability transition; shared player/enemy/projectile interior collision rules. |
| 8 | Keeper outposts | Claim one refuge per destination; choose functional sidegrade facilities; see rescued NPCs/trophies inhabit it. |
| 9 | Apex Hunt mode | Track tells across a map; choose one target mutation; extract a deterministic trophy/material reward. |
| 10 | Nightfall Siege mode | Defend three readable objectives; repair/re-route defenses between waves; choose holdout or early extraction. |
| 11 | Arsenal II | Twelve gap-filling weapons; six authored evolutions/fusions; a readable interaction board for weather/elements/status. |
| 12 | Atlas progression | Destination mastery seals; permanent Frontier Vigil Chapter; map-specific five-piece cosmetic families. |
| 13 | Economy and collection | Blueprint wishlist redemption; exact known-expansion shelf; high-stakes Mines table only if inflation simulation proves need. |
| 14 | World presentation | Atlas-first Home “Now” card; restrained biome color/attention tokens; destination flyover and recap framing. |
| 15 | Wider score | Exploration arrangements for four maps; faction pressure stems; four boss suites plus jukebox credits. |
| 16 | Accessible offline dispatch | Forecast and route cues in shape/text/audio; signed static Dispatch challenges; cached play/share bundles with no account. |

### 4.x release train and acceptance metrics

| Version | Complete slice | Acceptance metric |
| --- | --- | --- |
| 4.1 — Atlas | Atlas navigation, comparison, mastery sources | Every existing mode/map launches in ≤3 actions; controller/touch/200%-text routes have no focus trap or clipping. |
| 4.2 — Salt and Mire | Cinder Coast + Moonfen vertical slices | Each map has 3 screenshot identities, 5 POI chains, 6 enemy roles, 2 formations, and a boss that cannot be mistaken for an existing fight. |
| 4.3 — Root and Glass | Skyroot + Glass Wastes vertical slices | Same content gate as 4.2; multi-lane/reflective mechanics pass collision, muted-audio, and reduced-effects tests. |
| 4.4 — Habitable Wilds | Interiors, weather, outposts | 12 layouts stay deterministic; 180 bodies recover around doors; every weather mechanic has forecast and non-color counterplay. |
| 4.5 — Hunters’ Night | Apex Hunt + Nightfall Siege | Both modes support all maps/difficulties/input types; objectives never become unreachable; rewards cannot be farmed by abort/reload. |
| 4.6 — Frontier Forge | Arsenal II, Atlas progression, economy | 100 seeded build simulations retain starter viability and permanent-upgrade relevance; every item has source and cap text. |
| 4.7 — The Wider Score | Map/faction/boss music and presentation | 45-minute cross-map soak; no dead music, masked tell, over-budget RGB/motion, or uncited asset. |
| 4.8 — Dispatch | Static challenge feed and offline bundles | Signed/tampered/old dispatch fixtures; all cached content plays network-blocked; sharing remains opt-in and local by default. |
| 5.0 — The Wider Dark | Cohesive 48-addition release | 12 distinct destinations, Hunt/Siege/Expedition/quick modes, outposts and interiors pass save/perf/accessibility gates together. |

**5.0 ship gate:** twelve destinations have unique routing mechanics and screenshots;
all four new factions and bosses meet counterplay gates; Hunt and Siege remain fun on
Recruit and Nightmare; outposts/interiors survive pack removal and old saves; Atlas,
music, accessibility, offline cache, economy, and 60-minute stress gates pass.

---

# ARC V — 5.0 → 6.0: THE MAKER’S FORGE

## Major promise

Turn mastery into authorship. By 6.0, players can create, validate, play, and share
maps, encounters, bosses, challenge rules, and short campaigns without coding or an
account. Official content proves the tools, while strict schemas, caps, provenance,
and sandbox rules keep a static offline game safe and maintainable.

### 5.0 → 6.0 release inventory — 54 additions across 18 epics

| # | Epic | Three counted, player-visible deliverables |
| --- | --- | --- |
| 1 | Forgebook shell | Visual project browser; undo/redo/version history; playable preview from any selected node. |
| 2 | Map Forge | Tile/biome palette editor; route/landmark/quiet-lane tools; deterministic seed preview at phone and desktop scale. |
| 3 | House Forge | Modular exterior/interior assembler; door/collision/nav validation; stateful intact/damaged/lit/ruined variants. |
| 4 | POI Story Forge | Trigger/choice/reward graph; fail/timeout/revisit branches; localization/caption preview. |
| 5 | Encounter Forge | Formation composer; role/cap timeline; warning, clear, interruption, and boss-conflict simulation. |
| 6 | Boss Forge | Phase timeline; telegraph/arena/attack choreography; practice-room and difficulty preview. |
| 7 | Arsenal Forge | Weapon behavior templates; evolution/fusion recipe graph; damage/cap/visual-noise comparison. |
| 8 | Rule Forge | Mode objective composer; Oath/clause stack; deterministic reward-budget calculator. |
| 9 | Chronicle Forge | Dialogue/lore card editor; expedition node/choice graph; credits and content-warning metadata. |
| 10 | Score and look Forge | Licensed/local stem state graph; palette/lighting profile; photo/key-art layout with provenance fields. |
| 11 | EmberPack format | Human-readable versioned manifest; stable-id dependency graph; install/update/remove preview with rollback. |
| 12 | Creator validation | One-click gameplay determinism suite; performance/entity-budget stress; accessibility/source/localization checklist. |
| 13 | Safe sharing | Compact code for small trials; file bundle for full packs; signed official/curated shelf distinct from unverified local files. |
| 14 | Creator Trial mode | Browse installed scenarios; score only on unchanged manifests; remix a completed trial into a new local copy. |
| 15 | Teaching campaign | Six interactive editor lessons; three remixable starter projects; failure messages that link to the exact invalid node. |
| 16 | Official showcase pack | Glasswright map; Clockwork Menagerie faction; Curator of Hours three-phase boss built entirely in public tools. |
| 17 | Creator rewards | Non-random maker mastery track; tool-themed five-piece set; camp gallery for completed/created projects. |
| 18 | Accessible offline workshop | Full keyboard/controller editor path; high-contrast/reduced-motion/audio-caption previews; all creation and local sharing network-free. |

### 5.x release train and acceptance metrics

| Version | Complete slice | Acceptance metric |
| --- | --- | --- |
| 5.1 — Forgebook | Project shell, history, preview, schema | Create/save/reopen/undo/migrate fixtures; a bad node cannot corrupt another project or base save. |
| 5.2 — Worldsmith | Map, house, POI editors | A new player completes the teaching map in ≤20 minutes; generated worlds pass route/nav/collision/screenshot validators. |
| 5.3 — Warwright | Encounter and Boss Forge | Creator can author one bounded formation and two-phase boss; all warnings, caps, rewards, and interrupts simulate truthfully. |
| 5.4 — Spellwright | Arsenal and Rule Forge | 100 seeded simulations expose DPS/cap outliers; invalid recursion/overflow fails before play; base content remains immutable. |
| 5.5 — Story and Score | Chronicle, music, palette, provenance | Missing audio/art/text falls back safely; every exported external asset has credit/rights fields and preview captions. |
| 5.6 — EmberPacks | Packaging, validation, install/remove | Pack v1/v2 migration, dependency cycle, missing id, tamper, downgrade, conflict, and removal fixtures all preserve base saves. |
| 5.7 — Creator Trials | Browser, scoring, remix, teaching | Changed manifests are labeled unranked; codes stay bounded; six lessons pass keyboard, touch, controller, and 200%-text QA. |
| 5.8 — Glasswrights | Official tool-built showcase | Public project regenerates shipped map/faction/boss; no private-only escape hatch; performance equals authored base content. |
| 6.0 — The Maker’s Forge | Cohesive 54-addition release | 25 outside testers each create, validate, replay, export, import, and remix a scenario without code or unrecoverable error. |

The workshop is not an unmoderated cloud platform. The game imports local files only
after preview/validation; an optional curated static shelf contains reviewed, signed,
version-pinned packs. There is no public comment feed, engagement ranking, creator pay
scheme, or randomized “promotion.” Known supporter/expansion packs list exact content;
creator tools and the full base schema remain usable offline.

**6.0 ship gate:** three complete official projects are authored through the same
public tools; current and historical packs migrate/remove safely; creator content
cannot escape entity/save/audio/render budgets; all editors work by keyboard and at
200% text intent; base game, workshop, and imported projects remain playable offline.

---

# ARC VI — 6.0 → 7.0: THE LIVING CHRONICLE

## Major promise

Turn lore fragments into a character-led campaign without replacing the run-based
heart. By 7.0, twelve monkey Keepers cross four new destinations, form bonds, change
communities, and confront a five-act story whose choices affect routes, houses, allies,
and bosses—not permanent stat superiority or missable endings.

### 6.0 → 7.0 release inventory — 46 additions across 15 epics

| # | Epic | Counted, player-visible deliverables |
| --- | --- | --- |
| 1 | Five-act Chronicle Campaign | Resumable act map; three meaningful route/ally decisions per act; replayable chapter select after completion. |
| 2 | Ashen Capital | Dense district map; six-role Cinder Court faction; Crownless Regent political arena boss. |
| 3 | Verdant Crown | Vertical overgrown palace map; six-role Bloomguard faction; Rootmother and grafted arena boss. |
| 4 | Starless Sea | Island-and-vessel route map; six-role Deep Choir faction; Moon-Under-Water multi-stage boss. |
| 5 | Clockwork Monastery | Rotating cloister map; six-role Hourbound faction; Abbot of the Last Bell time-pattern boss. |
| 6 | Four new Keepers | Four genuinely new signatures; four personal Chronicle routes; four complete 27-render/voice/cosmetic identity sets. |
| 7 | Keeper bonds | Paired field banter; gameplay-neutral bond choices; earned duo poses/camp memories. |
| 8 | Inhabited communities | Twelve named resident arcs; rescued residents change camp/outposts; local schedule shows presence without real-time waiting; one deterministic restoration project per destination visibly changes its public space and service. |
| 9 | Consequence without lockout | Choice preview; act-state changes to routes/POIs/allies; post-finale Memory replay of alternate branches. |
| 10 | Chronicle play modes | 20-minute Story Patrol; authored Nemesis duel chain; no-pressure Explorer route with normal discoveries. |
| 11 | Stateful houses and POIs | Thirty story interiors; resident/occupation/damage states; return visits with changed dialogue and tactical layout. |
| 12 | Narrative progression | Permanent Chronicle Chapter; twelve hero bond/mastery pages; deterministic story sets and blueprint routes with no case gate. |
| 13 | Cinematic score | Four destination suites; hero/bond motifs that recombine; captioned in-engine scene score with skippable/replayable transitions. |
| 14 | Story UX and accessibility | Quest/choice recap in plain language; speaker/relationship/non-color cues; reading speed, auto-advance-off, dyslexia-friendly and 200%-text layouts. |
| 15 | Offline story preservation | Act checkpoint recovery; Hearth Bundle campaign transfer; Maker’s Forge templates for completed locations/encounters after spoiler unlock. |

### 6.x release train and acceptance metrics

| Version | Complete slice | Acceptance metric |
| --- | --- | --- |
| 6.1 — Chronicle Spine | Act graph, consequence schema, recap, chapter replay | Every branch checkpoint resumes identically; missing pack/state produces a specific recovery path, never silent branch substitution. |
| 6.2 — Crownlands | Ashen Capital + Verdant Crown | Each destination passes the 5.0 map/faction/boss gate; story state changes at least three tactical scenes without blocking completion. |
| 6.3 — Sea and Bell | Starless Sea + Clockwork Monastery | Moving/rotating layouts remain deterministic and readable; bosses pass muted, reduced-motion, Recruit, and Nightmare QA. |
| 6.4 — Twelve Keepers | Four heroes, personal routes, bonds | Every hero fills a measured build gap and finishes Standard/Expedition/Campaign; no bond choice grants permanent power. |
| 6.5 — People of the Vigil | Residents, houses, return states, four community projects | 30 interiors, 12 resident arcs, and four restoration projects survive out-of-order visits, failed rescues, chapter replay, and pack removal without a real-time wait. |
| 6.6 — Chronicle Modes | Story Patrol, Nemesis, Explorer | All modes preserve discoveries and fair rewards; Explorer has no shame copy or hidden reward penalty. |
| 6.7 — Voices in the Dark | Score, scenes, progression, accessibility | Every story beat is skippable/replayable/captioned; text expansion and reading controls pass across five viewports. |
| 7.0 — The Living Chronicle | Cohesive 46-addition release | 30 external players finish Act I unaided; ≥80% can explain their last choice; full campaign/checkpoint/audio/save soaks pass. |

Cases may contain general collection cosmetics but never a character ending, ally,
scene, story route, hero signature, or required Chronicle clue. The campaign can
recommend a deterministic next source; it cannot sell a solution to a difficult fight.

**7.0 ship gate:** all five acts, four new destinations, and four community restoration
projects are complete; twelve heroes have useful identities; every branch can be
replayed without save destruction; story houses, bosses, score, captions, reading
controls, offline transfer, and historical-save fixtures pass as one product.

---

# ARC VII — 7.0 → 8.0: THE DISTANT HEARTH

## Major promise

Add optional online togetherness without making connectivity, accounts, public status,
or strangers part of the core contract. By 8.0, invited Keepers can play quick modes,
expeditions, and one four-player raid across web/native platforms, while the complete
game—including progression and creation—still works offline.

This is the first band that may justify a small external service. Gameplay remains
host-authoritative over WebRTC data channels; a minimal rendezvous service exchanges
ephemeral connection offers and stores no save, chat history, wallet, or progression.
Manual/LAN invitation and offline modes remain. Implementation must follow the
[W3C WebRTC specification](https://www.w3.org/TR/webrtc/) and a published threat model.

### 7.0 → 8.0 release inventory — 54 additions across 18 epics

| # | Epic | Three counted, player-visible deliverables |
| --- | --- | --- |
| 1 | Network adapter | WebRTC host/client transport; local loopback transport for tests; manual/LAN offer path without an account. |
| 2 | Host-authoritative simulation | Input prediction; bounded state snapshots; correction visuals that never fabricate hits or rewards. |
| 3 | Invite lobbies | Short-lived room code; explicit mode/mod/pack/settings preview; Ready ownership and cancel/kick controls. |
| 4 | Cross-platform play | Web/iOS/Android compatibility matrix; input-glyph ownership per player; build/version/pack mismatch repair flow. |
| 5 | Resilient sessions | Reconnect window; quiet-point host migration; duplicate-reward and stale-input protection. |
| 6 | Online quick modes | Two-Keeper Standard; Daily/Crucible co-op variants; Hunt and Siege matchmaking by invitation only. |
| 7 | Shared Pilgrimage | Two-player expedition checkpoints; joint route votes with host tie-break disclosed; individual accessibility/loadout state. |
| 8 | Concord Raid | Four-player role-readable arena; three linked encounter wings; 25-minute checkpointed apex finale. |
| 9 | Communication without open chat | Context ping wheel; build/route vote cards; captioned emotes with spam limits and mute. |
| 10 | Network accessibility | Latency/prediction strength preset; remote-player opacity/effects control; color+shape+number identity and mono cue placement. |
| 11 | Camp visits | Invite-only camp walkabout; inspect-with-source collection displays; co-op photo staging without item transfer. |
| 12 | Community Dispatch | Curated signed challenge shelf; friend-code ghost/challenge inbox; permanent archive after a featured rotation. |
| 13 | Fair records | Opt-in verified challenge board; private/friends/local filters; replay hash and clear invalidation reason with no engagement feed. |
| 14 | Concord Gate | Network-themed fortress map that also plays solo; six-role Beaconless faction; synchronized lever/solo-familiar route alternatives. |
| 15 | Raid apexes | The Gate That Walks; Twin Extinguishers; Many-Handed Night—each with solo practice and 2/3/4-player scaling. |
| 16 | Shared-Flame progression | Cooperative mastery seals; deterministic raid set; permanent Concord Chapter with solo-equivalent earning routes. |
| 17 | Online economy safety | No trading or paid power; Mines remains local and unavailable during a shared session; case/quest rewards commit once through host receipt ids. |
| 18 | Privacy and offline fallback | Plain-language network disclosure; block/delete local friend code and wipe rendezvous data; every online reward/content has an offline path. |

### 7.x release train and acceptance metrics

| Version | Complete slice | Acceptance metric |
| --- | --- | --- |
| 7.1 — Near Hearth | Adapter, loopback, invites, threat model | 10,000 scripted connect/cancel/reconnect/version-mismatch cases; no save/wallet data reaches rendezvous logs. |
| 7.2 — Two Afar | Host authority and online Standard/Hunt | 30-minute sessions at 50/100/150 ms and 0/1/3% loss; no duplicated kill, pickup, reward, or irreversible correction death. |
| 7.3 — Shared Roads | Online Expedition/Siege/Daily/Crucible | Checkpoint/reconnect/host-loss fixtures at every phase; route voting and reward ownership remain explicit. |
| 7.4 — Concord Raid | Four-player wings and finale | 25-minute four-device soak at tier caps; solo practice teaches every mechanic; no role is required by paid/unowned content. |
| 7.5 — Distant Camps | Visits, pings, photos, friend inbox | Invite/mute/block/delete/privacy flows pass keyboard/controller/touch; no open text/voice or unsolicited discovery. |
| 7.6 — Dispatch Board | Curated challenges, records, replays | Tampered runs fail with a reason; unverified/local play remains available; archived challenges never expire. |
| 7.7 — Concord Gate | Map, faction, apex trio, progression | All content has solo and offline earning paths; 2/3/4-player scaling changes mechanics/readability, not only HP. |
| 8.0 — The Distant Hearth | Cohesive 54-addition release | 50 invited cross-device sessions complete; ≥95% reconnect success inside window; offline regression suite remains fully green. |

**8.0 ship gate:** independent security/privacy review; published service data map and
deletion behavior; deterministic reward receipts; cross-version/pack/reconnect/host-loss
fixtures; 50 real cross-device sessions; full offline edition unchanged; no public chat,
random matchmaking pressure, trade economy, paid advantage, or online-only power.

---

# ARC VIII — 8.0 → 9.0: THE WORLDWEAVE

## Major promise

Turn destinations into a systemic frontier. By 9.0, a seeded Worldweave changes
faction territory, routes, weather, settlements, roaming apexes, and resources across
a finite campaign. It produces surprising stories while remaining forecastable,
replayable, bounded, and completable offline—never a real-time chore map.

### 8.0 → 9.0 release inventory — 48 additions across 16 epics

| # | Epic | Three counted, player-visible deliverables |
| --- | --- | --- |
| 1 | Worldweave mode | Finite 6–10 chapter world campaign; versioned world seed/share code; clear win/final-battle state instead of endless upkeep. |
| 2 | Territory director | Faction-controlled routes; forecasted conflict nodes; player choices shift access/support without real-time waiting. |
| 3 | Climate director | Moving weather fronts; cross-biome hazard combinations; three-step forecast with build and route counterplay. |
| 4 | Prism Canopy | Light-routing rainforest map; six-role Spectrum Kin faction; Cathedral Mantis beam-and-cover boss. |
| 5 | Irondeep | Minecart-and-chasm undercity map; six-role Delver Union faction; Engine Below pursuit boss. |
| 6 | Pale Orchard | Harvest-cycle haunted orchard map; six-role Waxen Host faction; Harvest Saint transformation boss. |
| 7 | Thunder Mesa | Elevation-and-lightning plateau map; six-role Storm Herd faction; Skybreaker colossus boss. |
| 8 | Growing settlements | Choose one of three town functions; watch rescued residents/buildings change; defend or evacuate through authored events. |
| 9 | Roaming apexes | Track three visible world threats; redirect one through territory choices; fight evolving but bounded memory variants. |
| 10 | Frontier Contract mode | Select a three-node mini-Worldweave; preview faction/weather/reward contract; export a compact competitive seed. |
| 11 | War Table tactics | Spend earned influence on route/support choices; scout one hidden node; call one faction ally with explicit opportunity cost. |
| 12 | Systemic houses and POIs | Occupation/abandonment/recovery states; faction-specific interior use; multi-node rescue/siege/rebuild chains. |
| 13 | Worldcraft builds | Twelve terrain/weather tools; six faction-counter sidegrades; deterministic field crafting with before/after preview. |
| 14 | Finite world progression | Worldweave mastery constellations; settlement/campaign cosmetic families; exact blueprint routes and no idle-resource collection. |
| 15 | Worldweave presentation | Layered territory/weather map; 16-destination motif system; cognitive-load, forecast, color-blind, text-scale, and motion presets. |
| 16 | Shared/offline worlds | Solo/couch/invite co-op campaigns; save-safe world host transfer; Maker’s Forge world templates and fully cached official worlds. |

### 8.x release train and acceptance metrics

| Version | Complete slice | Acceptance metric |
| --- | --- | --- |
| 8.1 — Loom | World seed, finite graph, territory/climate simulation | Same seed/input yields same chapter graph and result; 10,000 simulated worlds terminate with no inaccessible objective or runaway state. |
| 8.2 — Prism and Iron | Prism Canopy + Irondeep | Both pass map/faction/boss gates; light/elevation/minecart mechanics remain legible on minimum viewport/tier. |
| 8.3 — Orchard and Mesa | Pale Orchard + Thunder Mesa | Both pass content gates; harvest/lightning forecasts never rely on color or audio alone. |
| 8.4 — Settlers and Apexes | Settlements, residents, roaming threats | Every state transition has save/replay fixture; ignored settlements cannot create punitive real-time decay or permanent account loss. |
| 8.5 — Frontier Table | Mini-campaign contracts, influence, scouting/allies | All costs/results preview; no dominant always-correct action across 100,000 director simulations and human strategy review. |
| 8.6 — Worldcraft | Tools, sidegrades, field recipes, progression | Crafting is deterministic and capped; base/evolution builds remain viable; no Worldweave power requires Mines, Cases, DLC, or online. |
| 8.7 — Woven Worlds | Presentation, co-op, sharing, creator templates | Solo/couch/online/offline world saves converge; host transfer and missing-pack recovery retain unrelated state. |
| 9.0 — The Worldweave | Cohesive 48-addition release | 16 destinations and finite worlds pass 90-minute memory/audio/network-blocked soaks; 40 testers complete different seeds and can explain forecasts. |

**9.0 ship gate:** every Worldweave has a finite goal and pause-anytime save; territory,
climate, settlement, apex, crafting, and reward systems are deterministic and bounded;
four new destinations meet identity gates; solo/offline remains complete; no real-time
decay, idle currency, mandatory daily claim, random paid resource, or power sale exists.

---

# ARC IX — 9.0 → 10.0: THE LAST LIGHT

## Major promise

Deliver a definitive edition, not an infinite-content promise. By 10.0, every major
system converges in an authored final campaign and a clear, preserved mode library.
The whole game—from first click to final boss, creation, couch/online play, economy,
accessibility, art, audio, and offline ownership—meets one quality bar.

### 9.0 → 10.0 release inventory — 60 additions across 20 epics

| # | Epic | Three counted, player-visible deliverables |
| --- | --- | --- |
| 1 | Clear-Flame Home | One Play/Now/Explore hierarchy; personal mode resume shelf; zero-information-loss low-color/reduced-motion presentation. |
| 2 | Mode Library | Searchable purpose/length/player-count filters; favorite/recent presets; practice/reward/source disclosure before launch. |
| 3 | Eversun campaign | Three authored capstone acts; choices that call back to prior allies/places; replayable epilogues with no one-save lockout. |
| 4 | Last Light Citadel | Final multi-route destination; allied outpost/house states from campaign choices; escalating day-to-eclipse world transition. |
| 5 | Final enemy faction | Seven-role Lightless Crown; three authored formation families; Codex counter-build and practice scenarios. |
| 6 | The Last Light finale | Multi-arena final Keeper; build/ally-sensitive but deterministic phase branches; complete victory, defeat, and return-to-world resolutions. |
| 7 | Four final Keepers | Four measured signature gaps; four Chronicle/relationship conclusions; complete animation, voice, set, and camp identities. |
| 8 | Hero ensemble | Twelve duo synergies; four-player readable team roles; a finale scene/pose for every Keeper without required bond grinding. |
| 9 | Boss Pantheon | Identity/rematch audit of every shipped apex; curated 12-fight Pantheon mode; adaptive practice recommendations from explicit failures. |
| 10 | World Marathon | One 60–90 minute checkpointed Atlas route; player-authored destination order constraints; bounded escalating remix director. |
| 11 | Last Stand mode | Ten-minute score survival; authored mutator draft every two minutes; local/friends/verified records with full replay receipt. |
| 12 | Build Laboratory | Spawn/test any discovered item; DPS/status/cap timeline; save/share named build recipes without progression rewards. |
| 13 | Progression completion | Finite account mastery map; deterministic source for every power-bearing item; post-completion expression goals with no stat treadmill. |
| 14 | Collection completion | Blueprint exchange for every legacy case pool; duplicate-dust target planner; complete-set scenes and camp museum displays. |
| 15 | Honest economy finale | Upgrade/economy rebalance across 1,000-run cohorts; fixed visible high-risk Mines tables with reserve/receipts; no paid or required randomized path. |
| 16 | Complete known-content shelf | Exact base/free/DLC/supporter manifests; one Complete Edition bundle with no mystery; install/remove/restore ownership and save fallback. |
| 17 | Definitive visual pass | 16-map landmark/remaster audit; all-hero/boss animation consistency; restrained palette/RGB/motion/telegraph tokens enforced by captures. |
| 18 | Definitive score and sound | Re-recorded/mastered thematic album; seamless motifs across menu/run/campaign/raid; museum jukebox, credits, captions, mono/night mix. |
| 19 | Access and preservation | Full 200%-text and input audit; historical-save/pack/replay museum; offline installer/exportable ownership bundle and documented recovery. |
| 20 | Keeper Anthology | Twelve signed creator showcases bundled offline; curated community raid/challenge archive; final photo/ghost/camp/credits gallery with privacy controls. |

### 9.x release train and acceptance metrics

| Version | Complete slice | Acceptance metric |
| --- | --- | --- |
| 9.1 — Clear Flame | Home, Mode Library, attention/color system | Five-second tests: ≥95% find Play/resume, ≥90% identify mode purpose/length, grayscale hierarchy holds, no screen exceeds motion/RGB budget. |
| 9.2 — Eversun | Capstone acts and choice callbacks | Every valid prior-state combination has authored fallback; checkpoint, skip, replay, caption, and no-lockout tests pass. |
| 9.3 — Citadel | Final map, faction, formations, finale | Solo/couch/online and all difficulty/input/effects profiles complete; no ally/build branch makes the finale impossible or trivial by bug. |
| 9.4 — Final Keepers | Four heroes, ensemble synergies, endings | 16-hero roster passes role/build-gap review; every hero has full art/audio/story/source coverage and no paid power path. |
| 9.5 — Crown Modes | Pantheon, Marathon, Last Stand | Mode duration/reward/abort/resume/cap gates; practice/lab cannot mint progression; records carry deterministic replay receipts. |
| 9.6 — Everforge Complete | Build lab, mastery, collection, economy | Every power item has deterministic route; every random pool has finite blueprint completion; 1,000-run cohorts avoid bankruptcy traps and dead upgrades. |
| 9.7 — Definitive Edition | Known-content shelf, visual and score passes | Complete manifest install/remove/restore; 16-map and full-roster capture wall; album lifecycle/mix/provenance soaks pass. |
| 9.8 — Open to Every Keeper | Accessibility, localization, preservation | Primary loop/modes/editors work across input, 200%-text, reduced-motion/effects, high-contrast, mono/captions, network-blocked, and recovery fixtures. |
| 9.9 — Anthology RC | Creator archive, community archive, galleries | All bundled projects are signed/versioned/licensed/validated; clean-install-to-finale and 120-minute soak produce zero P0/P1 defect. |
| 10.0 — The Last Light | Cohesive 60-addition definitive release | 100 fresh/veteran accessibility-diverse playtests meet comprehension/completion goals; every declared ownership, fairness, offline, and preservation claim is verified. |

10.0 does not introduce a prestige level with no endpoint, replace earned mastery with
rarity inflation, or promise perpetual live operations. Future content can use the
stable pack/creator architecture, but the shipped game has a complete ending, finite
power progression, permanent archives, exportable ownership, and a credited playable
history.

**10.0 ship gate:** no open P0/P1 issue; zero known save-loss path; all declared modes,
maps, heroes, bosses, packs, accessibility features, inputs, online/offline states,
creation tools, economies, art, and audio pass their historical fixtures and real-play
evidence; a clean install can reach the first input in target time and the finale
without an account, payment, wiki, or network.

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
- **Every few runs:** pinned set progress, hero mastery beat, boss monument, and optional
  case pity only inside the player-opened collection/economy surface.
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
- discrete menu response < 100 ms and continuous input feedback within one display
  refresh on target tiers;
- grayscale and RGB-disabled captures retain the same action hierarchy, with no more
  than one continuous attention animation per screen;
- boss tells recognized by sight with audio muted;
- 95th-percentile frame time < 16.7 ms on high tier, < 33.3 ms on minimum tier;
- zero uncapped persistent entity arrays;
- zero save regressions across committed historical fixtures;
- all random reward sources expose odds/pity/source before spend;
- every power-bearing reward has a deterministic non-gambling route and random systems
  are absent/replaced where audience, territory, or store policy requires it;
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
| Roadmap quantity becomes padding | counted inventory + vertical-slice review | an “addition” has no new decision, place, play pattern, expression, or accessibility outcome |
| Creator tools become unsafe/fragile | one public-tool official pack | shipped content needs private escape hatches or imported data can exceed caps/corrupt saves |
| Online erodes offline ownership/privacy | loopback + threat model | rewards require service, rendezvous retains save/wallet data, or abuse controls need an engagement platform |
| World simulation becomes chores | 10,000 terminating worlds | real-time decay, dominant action, inaccessible objective, or unbounded state remains |
| Definitive edition never converges | clean-install-to-finale rehearsal | new pillars keep entering 10.0 after release-candidate scope lock |

## 8. Immediate execution order

1. Finish and ship 1.0.2 Waylight Calls: four sites, twelve formations, progression,
   honest Mines/case presentation, validators, screenshots, PR, deploy, and ledger proof.
2. Land 1.1 keyboard focus, Clear-Flame hierarchy, attention/RGB budget, reduced motion,
   phone layouts, responsiveness, and accessibility state.
3. Build 1.2 Fair Forge save/economy/territory-policy fixtures before adding pools,
   rewards, chapter currencies, high-stakes tables, or native storefront surfaces.
4. Produce one modular house/POI vertical slice while 1.3 enemy roles navigate and fight
   through it; do not mass-produce art before shared collision truth passes.
5. Complete audio lifecycle/mix gates and one Blender boss-family production batch.
6. Add Gamepad/PWA; spike native adapters only after the web primary loop is solid.
7. Do not begin deterministic ghosts, couch play, or expeditions until their simulation,
   input, save, and performance prerequisites are green.
8. Do not build Creator UI before one hand-authored EmberPack round-trips, validates,
   migrates, removes, and falls back through public runtime seams.
9. Do not build the five-act Chronicle before expedition checkpoints, string ids, pack
   state, and replayable branch fixtures survive one complete act graybox.
10. Do not build online production content before a loopback/latency prototype, threat
    model, deterministic reward receipt, privacy budget, and complete offline regression.
11. Do not build Worldweave content before 10,000 simulated finite worlds terminate with
    reachable objectives and bounded territory/climate/settlement state.
12. Scope-lock 10.0 before its release candidate; new ideas move to stable packs unless
    they close a declared ending, ownership, access, preservation, or quality gap.

The roadmap is intentionally ambitious, but each minor release is independently
valuable and shippable. A major version is declared only when its player promise is
visible in the first five minutes and still meaningful after the hundredth run.
