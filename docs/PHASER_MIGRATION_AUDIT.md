# EMBERWAKE: Phaser 4 migration audit

Research and architecture only. No engine installation, source refactor, gameplay change, asset replacement, or save migration is part of this document.

## Audit baseline and evidence contract

- Audit date: **2026-09-06**.
- Repository: [QemmHD/2dgamerepo](https://github.com/QemmHD/2dgamerepo).
- Examined main: **[`9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e`](https://github.com/QemmHD/2dgamerepo/commit/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e)**, Update #18 / PR #206. Source locations below refer to this revision, not an unmerged working branch.
- Phaser release verified against the live release API and tagged source: **4.2.1**, tag commit **`41be1e462bc600064e498cba370bfa8c5c055a22`**, published July 9, 2026. The unversioned API site still identifies itself as 4.1.0 in places; consequential recommendations below use the **4.2.1 source**, not search snippets or Phaser 3 examples. [Official release][p-release]
- Recommendation: **A. Proceed with Phaser 4 migration**, initially as a reversible, isolated presentation pilot. Confidence: **medium-high in the architecture; unproven performance benefit**. Section 13 is a binding continuation gate, not a promise that the entire rewrite should happen.

### What was actually inspected

The entire tracked checkout was inventoried: **489 files, 42,597,096 checkout bytes**. This includes 183 JS, 7 MJS, 173 images, 25 audio files, one font, 47 Markdown, 20 JSON, 20 HTML, six Python, two workflows, and five other platform/config files. These are checkout sizes, not compressed transfer or decoded-memory sizes.

| Coverage area | Evidence and depth |
| --- | --- |
| Boot/platform | Read `index.html`, `styles.css`, `site.webmanifest`, `src/main.js`, both workflows, platform/input/loop/renderer/camera implementations and capture utilities. |
| Core | Traced constructor, prototype mixins, run creation, input dispatch, update ordering, render ordering, combat/death settlement, photo capture, profiling and quality policy through the actual callers. |
| Gameplay/content/meta | Inspected the named entities/systems, weapon behavior definitions, enemy/boss configuration, every named registry and its consumers, mode setup/eligibility, and SaveSystem validation/mutation/transaction boundaries. |
| Art/presentation | Inspected loaders, sheet/pose/anchor contracts, procedural cache entry points, world/house renderer, UI state/layout/action boundaries, lighting/particles/audio and Blender export tooling. |
| Tests | Inspected all 37 top-level `validate-*.js` entry points, dependencies and principal contracts; executed all 37. Inspected the 2,134-line harness structure, CDP driver, image checks and CI scenario matrix. |
| Historical material | Inventoried all documentation/evidence and used current ledger, architecture guidance, update/evidence records and art credits as context. Source and Git history take precedence over stale status prose. |

This is a repository-wide architectural audit, **not a claim that every historical prose line, every procedural drawing command, all 19,422 validator lines, or every binary pixel/audio sample was individually reviewed**. Large menu/style/shape builders were sampled after tracing their interfaces. No Blender render, physical-device benchmark, assistive-technology session, licensed-asset legal review, or Phaser prototype was performed. These limits matter to the acceptance gates.

Important baseline corrections:

1. Main already contains the version-3 Last-Wick Cabin / House V2 / Ruin Bell implementation. The ledger still describes PR #205 as a candidate; that prose is not the current source truth.
2. Main has **no 120 FPS settings selector**. Its existing RAF can render at high refresh, but simulation is fixed at 60 Hz and render interpolation is unused. Comments mentioning 120 FPS are not a shipped mode.
3. `tools/artshot/README.md` says tooling is not deployed; `pages.yml` actually uploads the repository root. Treat harness URLs as public tooling, never as a security boundary.
4. The separately checkpointed First Light work is not this baseline and must not be mixed into a migration PR without an explicit rebase/re-audit.

### Current-main checks performed for this audit

| Check | Result / limitation |
| --- | --- |
| All top-level validators | **37/37 pass**, Node v26.3.0. CI uses Node 22; local success does not substitute for PR CI. |
| JS/MJS syntax in `src` and `tools` | **190/190 pass**. |
| Asset validation | Pass; existing nonfatal streamed menu MP3 size warning (3,810,344 bytes, approximately 3.81 MB). |
| Real-game desktop harness | 1280x720, 20 simulation seconds, `badge=1`: **`DONE EXC:0 enemies:11 map:emberwood`**. Screenshot inspected. Enemy count is this run's receipt, not a seeded golden count. |
| Menu harness | 1280x720, Play setup, `badge=1`: **`DONE EXC:0 enemies:0 map:emberwood`**. Screenshot inspected. |
| Portrait device-emulation harness | 390x844 CSS, DPR 3, touch/coarse Android profile, Ruin Bell crossfire, UI scale 130: **`DONE EXC:0 enemies:7 map:emberwood`**. Full 1170x2532 screenshot inspected, including actual stage rotation and upright rotate cue. |

Captures and DOM receipts are local ignored `__out/audit-main-{desktop,menu,phone}.{png,html}` files, not additional committed artifacts. They establish the unchanged Canvas baseline only. PR/main CI and Pages delivery are separate, live gates; their GitHub run receipts must be checked before calling this document shipped.

## 1. Current EMBERWAKE architecture map

### Boot and ownership

```text
index.html (#stage, #game, accessible instructions/status, relative module URL)
  -> src/main.js boot()
     -> Renderer: 2D context, logical/CSS/backing sizing, rotation, safe areas
     -> procedural loading splash (temporary RAF)
     -> KeyboardInput + TouchJoystick + TouchButtons -> Input action/modality facade
     -> GameLoop callbacks (constructed, not started yet)
     -> procedural prewarm + parallel asset loads + successful-load cache invalidation
     -> stop splash -> new Game({ renderer, input, loop })
        -> SaveSystem + camera + UI + world/obstacles + light/particle/audio services
        -> _initRunState() -> player/entities/pools/directors/run latches
        -> menu/accessibility/action bindings
     -> gesture audio-unlock + visibility/focus audio hooks
     -> loop.start()
        -> fixed updates -> one render -> next RAF
```

`Game.js` is the composition root and authoritative session coordinator, not an engine scene. `RunState.js`, `GameUpdate.js`, `GameRender.js`, `GameInputActions.js`, `CombatResolver.js` and `PhotoModeController.js` are **method mixins on the same Game prototype**, not isolated services. Their `this` references all address the same live object. The render wrapper at `Game.js:3558` additionally refreshes keyboard menu focus after drawing rebuilds hotspots. [Boot][ew-main] · [Game composition][ew-game]

| Responsibility | Current authority |
| --- | --- |
| Browser canvas, orientation, DPR, coordinate conversion | `src/systems/Renderer.js`; shell `index.html` / `styles.css` |
| Frame scheduling and fixed-step accumulation | `src/core/GameLoop.js`; constants in `src/config/GameConfig.js` |
| Session screens, modal priority, run transitions and settlement | `Game.js`, `GameInputActions.js`, `RunState.js` |
| Player/enemy/projectile rules | Entity `update` methods, `WeaponSystem`, `HazardSystem`, `KindleSystem`, `CombatResolver` |
| Contact, swept projectile hits, walls, navigation | `CollisionSystem`, `FrameSpatialIndex`, `ObstacleSystem`, `EnemyNavigation` |
| Wave/boss/encounter/site/Bell scheduling | Game integration plus their existing directors |
| Persistent state and transaction participation | `SaveSystem`, `EntitlementTransaction`, `ShopTransaction`, `CaseSystem`, `BattlePassSystem` |
| World composition, painter order and culling | `GameRender`, `MapRenderer`, `StructureRenderer`, entity draw routines |
| Menus/HUD and their clickable layout | `MenuRenderer`, `UISystem`, `HUDLayout`, `ResponsiveLayout`, `UIStateBuilder` |
| Accessibility and physical input effects | `AccessibilityBridge`, `AccessibilityPreferences`, `CaptionSystem`, `HapticsSystem` |
| Music/sound scheduling | `AudioSystem`, `MusicDirector`, `content/music.js` |
| Art readiness, fallback and generated caches | Modules under `src/assets`; Blender/artshot tools are offline production tooling |

### Clock contract

`GameLoop._tick` uses **1/60-second fixed updates**, accepts at most **0.1 second** of elapsed wall time per rendered frame, and executes at most **eight** catch-up steps. Remaining accumulator time is retained; time exceeding the initial wall-delta cap is discarded. Returning from a hidden tab resets clock and accumulator. It computes interpolation alpha, but `main.js:118` discards it and `GameRender.render()` accepts none. Do not replace this with variable-delta `Scene.update(delta / 1000)`. [Loop][ew-loop]

### Actual update pipeline

`GameUpdate.update:53` first handles feedback/captions, death and modal gates. Photo mode only advances its view camera; menus, pause, upgrade/chest/shrine/victory overlays and hit-stop have different early-return behavior. In active play:

1. Advance run time; process Kindle aiming and action latches; derive `worldDt` for Focus slow time.
2. Advance combo/objective state and wave/boss/Lieutenant directors.
3. Update player and automatic weapon cadence; resolve player against walls and arena; update Bell/sites; spawn ordinary enemies where arbitration permits.
4. Update enemies with `worldDt`, wall/navigation resolution and status logic; rebuild the enemy spatial index.
5. Update projectiles with `worldDt`; hostile bolts hit walls **before** player overlap is evaluated.
6. Update biome and authored hazards, then pickups/XP/level-up activation.
7. Resolve collision/status/weapon/Kindle outcomes through the deduplicated combat/death path.
8. Update world feedback; resolve reward overlays; scan living enemies once for boss/nearby pressure/music/regen; release inactive pooled bolts and compact arrays; update camera and death state.

The two clocks are intentional gameplay behavior: Focus slows enemies/projectiles/ordinary spawning, but not player movement or automatic weapon cadence in the same way. Boss/director clocks and pickups also retain their existing choices. A global Phaser scene time scale would change balance. [Update pipeline][ew-update] · [Combat resolver][ew-combat]

### Actual render pipeline

`GameRender.render:87` opens the 2D frame and renders menu screens separately. Gameplay follows this order:

```text
background/material + seeded dressing/fog + floor details + ground warnings/sites/Bell
  -> stable painter queue: house planes/walls/obstacles/pickups/chests/shrines/actors
  -> projectiles + bright hazards + weapon effects/rings + occludable particles
  -> screen-space darkness veil
  -> weather / bright sparks / damage numbers
  -> repeated high-contrast combat and status cues
  -> optional completed-world card capture (before HUD)
  -> site action copy + HUD / modal / victory / photo UI
  -> touch controls
```

The painter comparison is **baseline Y, actor rank, insertion serial**, not simply `sprite.depth = entity.y`. Houses contribute multiple planes, and version-3 blueprint walls use actual collision footprints. Lighting is collected during several draw passes; particle layers have different occlusion contracts. `GameRender._inView` also gates some audible/feedback events outside rendering. [Render pipeline][ew-render]

## 2. KEEP / ADAPT / REPLACE

These classifications describe final ownership, not permission to rewrite everything in one PR. **KEEP** means authoritative existing behavior; **ADAPT** means retain rules/data behind a view or platform interface; **REPLACE** means retire the legacy implementation only after its experimental counterpart passes parity.

| Subsystem | Decision | Boundary and rationale |
| --- | --- | --- |
| Game/session coordinator and RunState | ADAPT | Inject platform/view services while retaining run state, transitions and settlement. Do not instantiate it twice. |
| GameLoop | REPLACE scheduler; KEEP clock policy | Phaser eventually owns one RAF. A shared accumulator keeps fixed 60 Hz, 0.1-second cap, eight-step limit, visibility reset and action consumption. |
| Renderer | REPLACE pixel backend; ADAPT viewport policy | WebGL replaces Canvas world drawing. Preserve logical/CSS/DPR/rotation contract in a shared viewport service. |
| Camera | ADAPT | Keep authoritative aim/spawn/index center and current trauma/zoom policy initially; Phaser consumes the visual transform. Never feed visual shake back into combat. |
| FrameProfiler / graphics governor | ADAPT | Retain named CPU buckets; add real presentation/GPU/texture metrics and target-relative policy before high-refresh claims. |
| LightingSystem | REPLACE compositor; KEEP light semantics | Reproduce darkness holes, color blooms, priorities, reduced mode and warning readability before optional normal-map lighting. |
| ParticleSystem | ADAPT, then REPLACE visual backend | Preserve semantic requests, budgets and three layer roles. Engine emitters never deal damage. |
| MapRenderer | ADAPT | Keep seeded chunk dressing, exclusions, palette/weather definitions; replace patterns/draws with reusable textures and bounded visible views. |
| StructureRenderer / Obstacle drawing | ADAPT | Same blueprint, floor, wall, furnishing, breach state and foot anchors; replace rendering only. |
| Player rendering | ADAPT | One pose/attachment descriptor drives body, hat, cloak, hands and wand. Gameplay Player stays authoritative. |
| Enemy rendering | ADAPT | Same animation identity, direction, frame layout and fallback priority. Enemy AI remains untouched. |
| Projectile / EnemyProjectile rendering | ADAPT | Views follow simulation positions/trails/lifetime; engine bodies and collisions remain disabled. |
| Pickups/chests/shrines/damage numbers | ADAPT | Keep interaction/reward rules; move drawing/visual lifetime presentation behind views. |
| CollisionSystem | KEEP | Existing contact/swept-hit semantics and ordering are gameplay, not presentation debt to replace. |
| FrameSpatialIndex | KEEP | Existing broadphase remains; replace its implicit camera dependency with an explicit query origin without changing results. |
| ProjectilePool | KEEP | Retain simulation pooling, reset and once-only release. Add separate view pooling with generation-safe bindings. |
| WeaponSystem | ADAPT | Keep cadence, targeting, upgrades, evolutions, effects that deal damage and formulas; emit view/audio requests through a port. |
| HazardSystem | ADAPT | Keep terrain, damage, LOS, owner links and age/radius/angle; move ground/above drawing and light contribution to views. |
| KindleSystem / signatures | KEEP rules, ADAPT feedback | Preserve spend/refund, quick taps, hold timing, Blink collision, Focus and six hero signatures. |
| Spawner / WaveDirector | KEEP | Same RNG decisions, caps, wave pressure and authored scheduling. |
| BossDirector / BossChoreographer / BossRushController | KEEP | Boss cards, phases, warning windows, provenance and order never become scene-animation callbacks. |
| Lieutenant / Encounter / Vigil / Ruin Bell directors | KEEP | Preserve single-stage arbitration, deterministic placement, freeze/defer rules and linked reward identity. |
| UISystem | ADAPT | Retain layout/modal priorities and Canvas HUD initially; no wholesale DOM or Phaser UI rewrite bundled with world migration. |
| MenuRenderer | ADAPT | Keep current menus/collection/case layouts and action keys in a Canvas UI layer; isolate hotspots from draw side effects first. |
| UIStateBuilder | ADAPT | Keep computed presentation models; narrow live references and make sampled view records read-only by contract. |
| Input / Keyboard / TouchJoystick / TouchButtons | ADAPT | Existing normalized actions, modality, touch IDs and safe-area mapping remain initial authority. Phaser event ownership may replace plumbing later, not action semantics. |
| Accessibility/captions/haptics | KEEP | Same DOM instructions/live region, focus scopes, reduced effects, high contrast, UI scale and device preferences. |
| AudioSystem / MusicDirector | KEEP | One existing Web Audio graph and scheduler; do not duplicate with Phaser sound. |
| SaveSystem and entitlement transactions | KEEP | Same key/schema/validation/locks/receipts. No Phaser registry, scene object or texture key becomes save data. |
| CaseSystem / Mines / BattlePassSystem | KEEP rules, ADAPT view | Preserve random distributions, spending, accepted receipts, duplicate handling, pending entitlements and retry behavior. |
| Character/Loadout/Upgrade/Passive/WickRoads systems | KEEP rules, ADAPT view | Existing content selection and progression remain shared imports. |
| PhotoModeController / CardCompositor | ADAPT | Keep mode/action/share rules; provide completed-world GPU capture without HUD leakage or every-frame readback. |
| All content registries | KEEP IDs/rules; ADAPT presentation fields | See registry map below. Do not duplicate content into Phaser scene JSON. |

### Content and mode connection map

| Registry / source | Consumers and invariant |
| --- | --- |
| `content/characters.js` | Six heroes; CharacterSystem, Player, menu, save, rites and signatures use stable IDs. Display names are not save IDs. |
| `content/weapons.js` | **40 weapon definitions include behavior functions**, spawning, audio/effect creation and Canvas-aware visuals. WeaponSystem/UpgradeSystem/LoadoutSystem consume these; not a pure data-only catalog. |
| `content/passives.js`, `evolutions.js`, `fusions.js` | 20 passives, 11 evolution recipes, 15 fusion recipes; Passive/Upgrade/Weapon systems resolve levels and eligibility. Preserve ordering, IDs, formulas and choice exclusions. |
| `content/keystones.js`, `elements.js`, `patrons.js`, `pacts.js` | Run build alignment, element relationships and upgrade bias remain rule inputs. Presentation may read labels/colors, never reinterpret effects. |
| `content/relics.js` | Run collection, shrine choices, discoveries and purchased Relic Attunement. Preserve discovery gates; not interchangeable with Hero Attunement. |
| `content/roads.js` | WickRoadsSystem resolves run routes and mechanical modifiers; maintain links to build and reward choices. |
| `content/maps.js` | Four maps: Emberwood, Hollow Reach, The Crypts, The Dunes; order, tier, enemy mixes, hazards, dressing and three-boss roster each. World units and unlock policy unchanged. |
| `config/GameConfig.js` enemy/boss definitions | 32 enemy definitions including 12 map bosses; Enemy, Spawner, directors and BossChoreographer own decks, phase transitions and attack telegraphs. There is no separate `content/bosses.js` to migrate. |
| `content/signatures.js` | Six hero Kindle signatures consume existing run stats and targeting; warning geometry and activation times remain simulation-derived. |
| `content/gear.js`, `rarities.js`, `weaponSkins.js` | Gear loadout/power, rarity tables and visual weapon finish. Do not turn texture variants into distinct mechanical item IDs. |
| `content/cosmetics.js` | **103 cosmetics / 15 sets**, five collection categories, shared exclusion/acquisition rules, per-hero presets and visual-only behavior. Keep shop/case/blueprint collection truth consistent. |
| `content/achievements.js`, `permanentUpgrades.js`, `dailyChallenges.js` | Save-backed unlocks, caps, coin rewards and run-stat predicates; progress must not depend on a rendered frame. |
| `content/rites.js`, `heroAttunement.js` | Hero-specific run-stat accumulation, completion gates, paid levels and player bonuses; separate from discovered relics. |
| `content/battlePass.js` | Battle Pass schema 2 inside whole-save schema 10; XP calculations, thresholds, reward IDs and once-only claims stay unchanged. |
| `content/dailyRoad.js` | Deterministic daily setup feeds `_startRun` before run construction. Settlement currently re-reads the UTC day; a run crossing midnight is not necessarily credited to its launch day. |
| `content/riteTrial.js` | Deterministic trial setup and scoring share gameplay but use separate mode/eligibility/settlement. |
| `content/bossRush.js` | Boss Rush sequence/scaling/scoring **and Weekly Ember** seed/config; Weekly is not a separate engine scene's rule set. |
| `content/objectives.js` | 26 authored Run Path candidates, one active task through Orientation/Tactic/Climax; real counters, feasible mode metrics and held-reward settlement remain authoritative. |
| `content/encounters.js`, `vigilSites.js`, `mapObjects.js` | Encounter/Vigil systems and obstacle generation share placement/exclusion geometry and source-specific rewards. |
| `content/houseBlueprints.js`, `ruinBell.js` | Version-3 cabin geometry and Bell lifecycle; the final breach must update rendering, collision, LOS, grid and navigation together. |
| `content/music.js`, `photoFilters.js`, `cardTemplates.js`, `tutorialTour.js` | Retain authored score/visual templates/copy and behavior. Adapt only playback/drawing integration required by the new view. |

Campaign, Daily Road, Rite Trial, Boss Rush and Weekly Ember share a run core but **not campaign eligibility**. Campaign credit requires the expected map-director boss provenance and eligible run latch; noncampaign modes and testing bypasses cannot unlock the next map. Current policy uses the **three specific bosses of the previous map**, not lifetime boss totals. [Campaign policy][ew-campaign]

The broader catalog contains 10 keystones, 14 altar pacts, 26 relics (eight permanently attunable), 11 roads, 21 gear pieces, 22 achievements, 16 daily challenges, 18 hero rites, five Hero Attunement levels per hero, five patrons and nine permanent upgrades. Battle Pass has 50 levels plus repeatable Everflame ranks; CaseSystem has six case types plus Mines. The 40 weapons comprise 10 base weapons, 11 evolutions, 15 fusions and four abilities. Stable hero IDs are `monkey`, `elf`, `orc`, `wizard`, `berserker`, `assassin`; display names are Pyra, Sylphine, Gruk, Orin, Kael, Vesper.

Standard victory can continue into an endless gauntlet (`Game.victoryContinue:1598`). Three difficulties and nine run modifiers are separate from altar pacts. No story-mode launch route exists on this main. Daily/Rite/Weekly seeds choose **setup**, not a globally seeded combat simulation. Setup is selected at launch, but settlement re-reads current UTC day/week (`Game.js:1792/1807/1864/1889/1911`); midnight/week-boundary characterization is required. Launch-anchored settlement would be a separate deliberate rule/save change.

Save authority includes `_commitMutation:672` rollback, `_validate:728` migration/sanitization, ordinary `save:1054` stale-writer comparison, and `runExclusiveSaveTransaction:1850` plus participation/lock handling. Preserve guided-objective escrow, per-hero cosmetic presets, discoveries, claims and mode records. Case/Battle Pass/Blueprint paid or once-only flows use their atomic APIs and detached receipts; ordinary compare-before-save is **not a global atomic mutex**, and some older achievement/daily/run-bank paths remain multi-write. A view transition must never claim or retry rewards merely because it is redrawn. [Save implementation][ew-save]

## 3. Simulation versus presentation: coupling inventory

The table groups repeated drawing implementations by their actual seam. It includes both simulation/view coupling and render-dependent input/capture state; those latter dependencies can break a migration even without changing combat numbers. “Blocks” means blocks the relevant port, not blocks creating an isolated experimental entry.

| File / function at baseline | Coupling and why it matters | Blocks? | Smallest safe seam |
| --- | --- | --- | --- |
| `Game.js:111` constructor; `RunState.js:33` `_initRunState` | Hardwires renderer, camera, audio, particles, UI and saved settings into run/session setup. Constructing two Games duplicates listeners and save participants. | Boot | Optional injected platform/view services with legacy defaults; one Game per entry. |
| `Game.js:1016-1093` `_startRun` | Fresh player, character, upgrades, relic/hero attunement, gear, appearance, difficulty/modifiers/map and starting resources are applied in order through mutating/non-idempotent operations. | Scene attachment | Views attach to an existing run; never hydrate by rerunning initialization or multiplying bonuses twice. Test initial stats/loadout/coins on fresh run and restart. |
| `GameLoop.js:45` `_tick`; `main.js:118` | Fixed simulation and render scheduling share RAF; alpha unused. Engine default delta changes cadence; two loops double-step. | Scheduler | Extract the existing accumulator policy unchanged and give exactly one scheduler ownership. |
| `GameUpdate.js:53` `update` / `_updatePlayerAndWeapons:1099` | Modal/hit-stop branches and `dt` versus `worldDt` choose different clocks. | Gameplay parity | Simulation clock remains authoritative; pass separate presentation clocks, not a global Scene time scale. |
| `Player.js:363` `draw` | Draw writes `_pose` and `isLpcBody` around line 472; nested body/bob/stretch/recoil transforms feed hands/wand at 603/652 and cosmetic anchors. | Hero | A resolved pose + attachment/body-kind descriptor sampled once; all child views use the same parent transform and frame ID. |
| `Enemy.js:1028` `draw` | Drawing latches `_facing`; culling currently determines whether that latch changes. AI and animation otherwise update elsewhere. | Enemy parity | View synchronizer with explicit last-visible-facing policy; separate behavior change if moving it to every tick. |
| `Enemy.js:1275` `chaserBrain` / line 1292 | `animTimer` and random `animOffset` drive actual perpendicular movement weaving. This is not exclusively a visual animation clock. | AI/animation | Keep the existing phase in simulation; views sample it. Any rename/extraction must leave tick progression and movement identical. |
| `Projectile.js`, `EnemyProjectile.js` `update` / `draw` | Simulation positions, previous positions, trails, lifetime and shape/style are co-located. | Projectile | View records read the live simulation identity/generation; keep swept collision and history untouched. |
| `Projectile.reset:47`, `ProjectilePool.acquire:34`, `CollisionSystem.resolve:80`, weapon shared hit Sets | Enemy object identity keys piercing/volley hit history and deduplicated deaths; premature recycling or replacing references can double-hit/credit. | Entity view lifetime | Separate pooled view identity/generation from retained simulation object identity and hit lists. |
| `CollisionSystem.resolve` contact aggregation near 220 | One contact event combines strongest attacker plus 30% of the others, capped at 1.9x strongest, then applies i-frames/thorns. Per-enemy engine overlap callbacks are not equivalent. | Any physics replacement | Keep current aggregation/callback order and collision authority; test exact simultaneous-overlap cases. |
| Pickup / Chest / Shrine / Obstacle entity draw methods | Radius/age/active/interactable state used directly for visuals and hit areas. | Those views | Read-only view records; never engine input hit tests for pickup/collision authority. |
| `WeaponSystem.update` / `drawEffects`; `content/weapons.js` behavior functions | One call receives enemies/projectiles/obstacles/particles/audio; damaging trails/areas and purely visual FX share weapon state. | Weapons/FX | Effect sink for nondamaging requests; retain damage-capable arrays and callbacks in WeaponSystem. Audit each weapon family. |
| `content/weapons.js:1076/1159/1249/1289`; WeaponSystem `owned.state` | Some acquisition uses logical viewport/LOS/focus limits; projectile creation can receive Canvas sprites; orbit/disc/beam/mine/trail state is mechanically active. | Weapon views | Stable visual keys replace Canvas references, not attack state; preserve each family's targeting rules and existing viewport independently of GPU camera size. |
| `content/signatures.js:25-38`; `Game.js:2568-2569` `_releaseUlt` | Module-global `_focusTarget`/`_focusMul` depend on synchronous `setUltFocus(this)` immediately followed by `sig.fire(this, angle)`. | Signature/effect port | Preserve the uninterrupted call sequence; don't defer cast execution through a view event queue. Explicit cast context is a separate tested seam if later needed. |
| `GameUpdate.js:1207` `_updateEnemies` | Enemy AI creates hostile bolts/hazards; windup differences trigger camera-visible audio/particles. | Enemy FX | Event records emitted at existing transition points; visibility is an explicit presentation policy, not a reason to skip AI. |
| `GameUpdate.js:1364` `_updateProjectiles` | Collision and damage immediately trigger audiovisual feedback. | Effects | Preserve wall-before-player order; dispatch feedback only after accepted damage. |
| `GameUpdate.js:1396` `_updatePickups` | XP/coins/heal change stats and immediately mint particles/audio/rings/hit-stop/upgrade UI. | Pickups/UI | Preserve pickup transaction and pause point; return bounded feedback requests and overlay state. |
| `CombatResolver.js:184` `_resolveCombat` and death helpers | Deduplicated death identity drives kills/XP/loot/Kindle/combo/affix chains/progression plus FX. Moving death to animation completion duplicates/delays rewards. | Combat | Keep death queue entirely in simulation; emit copied death/hit events once after authoritative resolution. |
| `HazardSystem.js:55` `update`, `drawGround:286`, `drawAbove:480` | Damage/LOS/terrain, live `hz.owner` links, warning age/radius/angle and lighting are intertwined. | Hazard view | Immutable sampled hazard geometry; view never changes age, damage or owner identity. |
| `Camera.js:70/81/98`; `Game.js:2643` `_focusTapAt` | Visual shake uses ambient RNG; aim mapping omits shake. Focus directly uses screen center + camera center and assumes normal zoom 1. | Input/camera | Explicit unshaken aim transform and separate visual matrix; freeze existing targeting semantics before considering corrections. |
| `GameUpdate._updateEnemies`; `FrameSpatialIndex.rebuild` | Spatial index origin depends on camera center; free-camera/culling assumptions can leak into query results. | Camera replacement | Pass an explicit query origin with legacy values and test targets outside visual bounds. |
| `GameRender.js:1040` `_inView` and callers | Presentation visibility also gates sound/effect cues. A different engine culling rectangle can change audible feedback. | Feedback parity | Shared logical visibility contract distinct from engine culling; never cull collision simulation. |
| `GameRender.js:69/87` painter queue / render | Pooled records retain live objects; comparator interleaves house planes, actors and pickups. | World port | Sample presentation records after fixed updates; assign ordered layer/depth tuples without cloning whole entity graphs. |
| `ObstacleSystem` / `StructureRenderer` / `RuinBellDirector` | Breach/state changes share geometry with walls, floor art, LOS, nav and encounter placement. | Houses | Versioned blueprint/state adapter; invalidate view caches only on existing geometry revision events. |
| `MapRenderer.js:104/258/457` | Exclusions held by reference, seeded chunk caches, visible decor creates candle lights. | World/light | Stable exclusion revision plus retained chunk descriptors; light extraction from visible descriptors. |
| `LightingSystem.js:122/144`; entity/structure/hazard draw callers | Draw registers lights in priority-sensitive order. Priority 0 is exempt; priority 1 checks only pickupCap; only priority 2 checks maxLights. Missing a draw loses illumination. | Lighting | Explicit light collection with source ID/priority/radius/color/layer; preserve both admission rules and ordering before budget redesign. |
| `ParticleSystem._spawn/update/draw*` | One shared 220-slot pool drops by call/slot order; layers have different zoom/occlusion. Quality reduces allocation search limit, not all already-live particles immediately. | Particle backend | One shared admission authority with layer-specific views; no independent layer capacity that changes saturation/drop behavior. |
| `Camera.js`, `MathUtils.js`, procedural caches, `CombatResolver.js`, weapon/spawn/FX calls | Global `Math.random` is shared by gameplay and visuals; harness does not replace it globally. Rendering less can change later RNG consumption. | Replay claims | Inject test RNG/time sources; separate gameplay and cosmetic streams in a separately verified seam PR, recording the intentional sequence boundary. Do not claim existing screenshots are seed-replay goldens. |
| `UIStateBuilder.js:293` `buildUIState` | Fresh outer object still contains live save/stats/player/camera/try-on/case/receipt/canvas references. | UI sharing | Narrow scalar/copied projections by panel; explicit asset handles; no whole-Game JSON serialization or engine objects in save state. |
| `MenuRenderer.js:884/1254` `_hot` / `draw`; `_drawCaseOverlay` near 6855 | Draw rebuilds hotspots and writes `anim._againRect`; action availability depends on completed layout. | Menu port | One layout result owns visuals and hit regions; preserve stable action IDs and arguments. |
| `Game.js:3558`; `GameInputActions.js:473` `_refreshMenuFocusAfterRender` | Keyboard focus repair happens after drawing; stale menus can target removed controls. | Menu layering | Explicit layout-complete callback before focus refresh; one active Canvas focus owner. |
| `UISystem.draw`; HP/XP rendering near 2408/2511 | Display interpolation advances per draw, not simulation time. 120 Hz changes bar smoothing without changing stats. | Visual parity | A bounded presentation tick for interpolation; preserve legacy appearance first and measure any later retiming. |
| `TouchJoystick.draw`, `TouchButtons.draw` / consumable actions | Visible control geometry and normalized touch positions share Renderer; quick-release latches bridge ticks. | Touch | Shared viewport + action interface; Canvas controls stay on the authoritative UI overlay initially. |
| `GameRender` `_mintPendingCard`; `PhotoModeController`; `CardCompositor.captureFromCanvas:70` | Rendering performs a capture side effect after world cues and before HUD, using a 2D canvas source. | Photos/cards | Explicit completed-world capture request/receipt; on-demand GPU snapshot then existing compositor, with asynchronous failure/cancel handling. |
| `GameUpdate.js:1527` cleanup scan; `AudioSystem.setCombatState:712` / `musicEvent:763` | Simulation pressure feeds audio; boss/Bell transitions have musical/caption one-shots. | Audio integration | Keep one audio engine and event ordering; do not bind score transitions to Phaser animation events. |
| `GameRender.js:987/1016` governor / `_applyGfxLevel` | `loop.fps` changes light/particle/DPR/weather/UI settings; fixed thresholds assume 60 Hz. | Performance gate | Platform-neutral measured frame stats + explicit target; preserve user accessibility intent and do not let adaptive settings alter rules. |
| `Game.js:1479/1509/1704/3209` achievement/daily/bank/death paths | Presentation transitions neighbor persistence; some older rewards use multiple ordinary writes, unlike newer exclusive receipts. | Persistent engine rollout | Scene teardown must never settle/retry these implicitly. Preserve existing behavior; give any transactional repair its own tests/PR. |

Practical effect interface: requests carry stable IDs and primitive fields such as position, color, direction, intensity, start simulation tick and lifetime. Do **not** deep-clone arrays every frame, allocate one event for every idle particle, or put Phaser references on Enemy/Player/SaveSystem. Reuse bounded buffers and view registries; clear them on run-generation change. Existing live simulation references inside simulation (focus targets, hazard owners) can remain.

## 4. Phaser ownership plan and current API evidence

Phaser should own **GPU presentation and its lifecycle**, not game rules. Use a thin boot/loading scene and a world-presentation scene; additional UI/transition scenes are optional only after the Canvas UI bridge is stable. The existing Game still owns screen state. Scene start/shutdown must attach/detach views, not create a new run, award XP or commit a save.

| Concern | Verified Phaser 4.2.1 mechanism | EMBERWAKE decision |
| --- | --- | --- |
| Renderer | WebGL renderer, Render Nodes and `renderNodes` configuration; old pipelines removed. [Migration guide][p-migration] · [Renderer source][p-renderer] | Engine owns GPU resources/batching. No legacy `setPipeline('Light2D')`, Phaser 3 pipeline subclass or raw GL state mutation behind Phaser. |
| Scene lifecycle | `Scene` builds `sys`; Game step updates scenes then renders them. [Scene][p-scene] · [Game][p-game] | A scene is a view host. Never overwrite `scene.sys` with the EMBERWAKE Game. |
| Animation | Sprite `preUpdate(time, delta)` advances AnimationState; its accumulator uses millisecond delta and time scales. [Sprite][p-sprite] · [AnimationState][p-animation] | Initially set frames from the existing pose clock, avoiding a second clock. Later use Phaser playback only for cosmetic animation that cannot change attack/impact timing. |
| Camera | Public scroll/zoom/origin/viewport APIs; 4.x separates internal/external/combined matrices. [Camera][p-camera] | Adapter reproduces the current visual transform; targeting uses the explicit unshaken simulation mapping. No blind matrix copying from Phaser 3. |
| Particles | ParticleEmitter is a Game Object with `emitParticleAt`, bounded-count settings and a millisecond `preUpdate` clock. [Emitter][p-particles] | Reuse a small number of emitter pools by effect/layer. Not one emitter per projectile and never particle collision as damage. |
| Filters/masks | Unified internal/external Filter lists replace preFX/postFX and WebGL masks. DynamicTexture/RenderTexture drawing is buffered and needs `.render()`. [Migration guide][p-migration] | Prefer existing filters on bounded objects/layers; custom Render Node only for an unmet visual requirement. Do not use old `createBitmapMask`, `preFX.addBloom` or old texture-generation examples. |
| Custom shaders | Shader uses `ShaderQuadConfig` and `setUniform(name,value)`; old automatic Shadertoy-style time/resolution assumptions do not transfer. [Shader source][p-shader] · [Migration guide][p-migration] | Explicitly bind presentation clock, dimensions and sampler inputs; prototype only the missing veil/filter operation, never drive collision geometry from shader output. |
| Native lighting | `setLighting(true)`; LightsManager `addLight(x,y,radius,color,intensity,z)`; normal-map/self-shadow/ImageLight paths exist. [Lighting component][p-lighting] · [Lights][p-lights] · [ImageLight][p-imagelight] | Native lights are optional embellishment, **not an equivalent replacement for the darkness veil or house LOS**. Normal maps are not currently supplied for all art. |
| Input | Global InputManager transforms pointers via ScaleManager; Config allows keyboard/mouse/touch input to be disabled. [Input][p-input] · [Config][p-config] | Disable those Phaser input sources initially; keep one legacy action owner. Phaser's normal axis scaling does not implement the current CSS 90-degree inverse rotation. |
| Textures | `TextureManager.addCanvas`, `addImage`, `addSpriteSheet`; CanvasTexture `refresh()` uploads changes, while `update()` additionally reads pixels. [Textures][p-textures] · [CanvasTexture][p-canvastexture] | Register generated canvases once; refresh only when dirty. Do not call CPU pixel-readback `update()` each frame merely to upload an unchanged texture. |
| Audio | `audio.noAudio: true` creates a NoAudioSoundManager. [Sound factory][p-sound] | Disable Phaser sound; retain AudioSystem, gesture unlock, mono/caption/haptic preferences and music continuity. |
| Scaling | `Scale.NONE` / `ScaleManager.resize`; explicit CSS sizing and camera mapping remain available. [ScaleManager][p-scale] · [Config][p-config] | Shared custom viewport policy. Do not assume an undocumented `resolution` GameConfig field; it was not present in the inspected tagged Config/GameConfig sources. |
| Time and manual stepping | `TimeStep.stop/sleep`, `fps.smoothStep`, Game `step(time,delta)`; HEADLESS step does not render pixels. [TimeStep][p-timestep] · [Game][p-game] | Preserve the fixed accumulator; disable delta smoothing for that bridge or consume raw elapsed time. Manual WebGL test stepping only after boot and loop stop. HEADLESS is not the visual test renderer. |

Further version-specific cautions: native blend batching supports NORMAL/ADD/MULTIPLY/SCREEN; other Canvas modes need a filter/composition equivalent. `setTintFill` is gone; fill tint uses `setTintMode`. `TextureManager.generate` is removed. A 4.x TileSprite can reuse atlas/sheet frames, but does not make map collision a tilemap. Pixel rounding is not universally safe during zoom/rotation; mixed hi-bit art needs per-texture sampling decisions. These are reasons to pin the engine and test actual tagged APIs. [4.x migration notes][p-migration] · [Render configuration][p-renderconfig]

### Canvas/WebGL coexistence rule

An HTML canvas already acquired as 2D is not the new WebGL surface. The loading splash also acquires 2D. The experimental entry therefore creates **a separate WebGL world canvas and a transparent Canvas UI overlay** inside the same stage. It does not call the existing opaque `Renderer.beginFrame()` for that overlay; the overlay clears transparently and renders only retained UI. Preserve the accessible `#game` focus target on the UI surface and make the world surface noninteractive/hidden from accessibility. On a full-screen menu, the legacy menu layer can be opaque.

This bridge requires separating world and UI calls, not copying a whole legacy frame into a texture at 60/120 Hz. Use neither shared-context tricks nor an `Extern` object as a pretend 2D/WebGL interoperability solution. Screenshot capture must explicitly compose the intended layers on demand. Both canvases must receive the same sizing/rotation update, with a test for CSS backgrounds accidentally hiding the WebGL layer. [Boot 2D acquisition][ew-main] · [Phaser renderer lifecycle][p-renderer]

## 5. Concrete dual-runtime plan

**Choose separate application entries**. This minimizes accidental production boot changes and makes a missing/unsupported experimental feature fail visibly instead of silently affecting everyone.

```text
index.html                         existing production Canvas entry, unchanged by pilot
src/main.js                        existing legacy boot
phaser.html                        explicit experimental entry, no production default switch
src/phaser/main.js                 experimental boot and capability/error screen
src/phaser/WorldScene.js            thin presentation scene
src/phaser/PhaserPresentation.js    pooled view/layer/resource ownership
src/platform/ViewportContract.js   extracted legacy sizing/input contract (future)
src/platform/SimulationClock.js    extracted fixed accumulator policy (future)
src/presentation/...               narrow shared pose/effect/light/view descriptors (future)
src/vendor/phaser/4.2.1/...         pinned distribution and license (future)
```

Names marked future are proposed files, not files added by this audit. Native ESM imports remain relative; both entries use the same content, art and simulation modules. Do not duplicate the game under `src/phaser/gameplay`.

### Save safety and lifecycle

- Both URLs on Pages have the **same origin and localStorage**, regardless of filename. The real key is `monkey-survivor:save:v1`, not a Phaser-specific key; save schema is 10. Preserve exclusive lock names and participation behavior. [Save implementation][ew-save]
- The experimental pilot uses an injected **nonpersistent, in-memory copy** of a validated fixture/profile. It must not construct a normal SaveSystem that automatically participates in live locks, migrates or writes settings. Add a narrow storage/participation seam with legacy defaults and validate it first.
- Expose an obvious **experimental / progress not saved** indicator. No silent profile writes, coin awards or debug pollution. Copying a profile is not permission to edit its original.
- Once gameplay/menu parity and storage failure tests pass, a separate PR may enable **one selected live runtime per document**, using the unchanged SaveSystem transaction APIs. Cross-tab legacy/Phaser behavior must pass stale-authority, lock-denial and exactly-once tests before this option ships.
- Never save renderer selection, engine object references, texture IDs, scene data or transient effect state inside gameplay save data merely to enable the experiment. An experimental entry selection can remain URL/session state.
- Navigate/reload to switch runtime; do not hot-toggle two engines in one DOM. Supply `destroy()` for experimental subscriptions/views/assets and clear held input before leaving. Existing listeners lack a complete teardown path, so a same-document hot switch is deliberately out of scope.
- On WebGL boot failure, offer a clear **Open Canvas version** link. On context loss during a run, freeze input/simulation and attempt bounded view rebuild; if recovery fails, offer return/restart without faking terminal rewards. Current saves do not provide an in-progress-run resume system.

### Rollback and deploy

Until the final cutover PR, `index.html`, manifest start URL and production links continue to select legacy. Removing the experimental entry/vendor/view files returns the old delivery surface; any shared seam already merged still has legacy defaults and tests. This allows a stop after any PR.

GitHub Pages currently uploads `path: '.'` with no build. Relative `./src/...` imports work under `/2dgamerepo/`; leading `/src/...` would point at the wrong root. New engine files will be in the uploaded artifact automatically unless a later explicit allowlist changes that policy. Pages is triggered separately from CI, so **verify PR CI before merge**, then inspect main CI and Pages separately. Do not assume deploy success implies test success. [CI][ew-ci] · [Pages workflow][ew-pages]

## 6. Test harness migration

**Choose B: a sibling Phaser harness with shared scenarios and receipts.** Keep `tools/artshot/harness.html` executable as the legacy control. Add `tools/artshot/phaser-harness.html` and a runtime adapter, sharing extracted query parsing, fixture descriptions, expected assertions and result encoding. Do not immediately conditionalize all 2,134 lines of the current harness or maintain two copies of its whole scenario implementation.

The current harness directly constructs Game/Renderer, stages entity fields and menu panels, uses Canvas methods, neutralizes audio, applies godmode, bypasses onboarding by default, auto-resolves several overlays, steps synchronously at 1/60 and renders a final frame. It has controlled fixtures, **not universal seeded replay determinism**. Existing `EXC:0`, enemy counts, `window.__qaState` and `data-qa-*` fields are valuable reusable contracts. [Harness][ew-harness]

### Shared adapter contract

| Operation | Required behavior |
| --- | --- |
| `ready()` | All required assets, fallbacks and engine boot complete; surface boot rejection explicitly. |
| `stage(scenario)` | Use the same validated content IDs, save fixture, run/mode settings and authoritative simulation hooks. No alternate fake combat. |
| `stepTicks(n, actions)` | Exactly n simulation ticks at 1/60; normalized actions consumed at specified ticks. No background RAF also updating Game. |
| `renderFrame()` | Advance **zero simulation ticks**; sample current authoritative state, draw intended layers and wait for completed render/capture readiness. |
| `receipt()` | Same semantic fields plus runtime, engine version, tick count, seed/time fixture identity and GPU backend. Include boot/runtime exceptions and unhandled rejections. |
| `capture(kind)` | Full-viewport screenshot for mobile/shell; world-only capture for cards; no confusion between them. |
| `dispose()` | Stop callbacks, release listeners/texture views, clear held actions, dispose isolated storage participant if any. |

For Phaser manual visual tests: await boot/texture readiness, stop the engine TimeStep, then drive the tagged `Game.step(timeMs, deltaMs)` through the single shared clock/scene bridge. A stepped frame of 1000/60 ms should produce exactly one simulation tick. Freeze any visual-only wall time for comparison. Assert that visibility/focus events cannot wake an extra loop. `Game.headlessStep` is useful for no-pixel checks, not screenshots. Verify this thin adapter in its own PR because direct Game stepping is a tested integration surface, not a promise about all future releases. [Game step][p-game] · [TimeStep][p-timestep]

### Existing gates to retain

The CI render table contains **37 rows**: 30 desktop 1280x720, three synthetic-touch 667x375, two portrait 390x844 DPR 3 and two landscape 844x390 DPR 3. Device rows set an Android 14 / Pixel 8 / Chrome 126 profile, five touches and coarse pointer before navigation. They are emulation, not physical-device proof.

Additional CI invocations are one hero contract, one 20-second swarm smoke, one audio graph probe, five negative-query cases, two Collection I-A, five Collection I-B and ten Completion cases: **62 planned browser invocations before touch-window calibration retries**. Four Completion scenarios use exact 480x270 same-origin iframes. Twenty-eight PNGs are retained across four 30-day artifacts. Pixel receipt checks validate dimensions/content/diversity, not golden-image equality or visual quality. [CI scenarios][ew-ci] · [PNG validator][ew-png]

All 37 top-level validators remain required. Current CI explicitly calls only 36: **`validate-run-bonus.js` is omitted**, despite passing 40 checks / 1,536 combinations locally. Fix that in the first migration-preparation PR, not in this documentation-only PR. The existing Node 22 configuration and capture-driver “Node 24+” error text should also be reconciled against actual supported runtime behavior, not used to assert CI is broken without evidence.

### Additional lanes needed before judging Phaser

1. **Keep existing Canvas software/headless lane.** `capture-harness.mjs:145` hardcodes `--disable-gpu`; it must not be the sole Phaser or performance lane.
2. **Add an explicit WebGL lane** to the shared CDP driver: no unconditional GPU-disable flag, declared hardware/software backend, successful context creation, rendered-pixel checks, context-loss/rebuild exercise and shader/texture errors captured. A software WebGL runner can establish correctness, not phone speed.
3. **Pair legacy/Phaser semantic scenarios**: same fixed ticks/actions/content/seed fixture, exact HP/XP/kills/currency/weapon levels/wave/boss phase/collision contacts and reward outcomes. Use tolerance only for floating-point rendering coordinates, not integer economy values.
4. **Freeze or inject test RNG/time** before pixel-diff/replay claims. Separate gameplay and visual RNG carefully; changing RNG streams can itself change historical sequences, so establish a new documented shared baseline rather than pretending byte parity with uncontrolled old randomness.
5. **Retain all boss/map/menu/collection cases**, then add orientation mid-drag, simultaneous steer + Kindle + Blink, between-tick quick tap, blur/pause/unpause and removed-hotspot focus recovery.
6. **Add production-entry smoke** for both actual HTML/CSS shells. The current harness duplicates selected CSS instead of loading production `styles.css`, so harness-only rotation success is insufficient.
7. **Test actual workflows not only staged end states**: lethal hit, level-up choice, chest/shrine acceptance, Bell reward choice, restart/abandon, case/Blueprint/Battle Pass claim denial/retry and exactly-once settlement.
8. **Keep Web Audio tests separately**: the visual harness disables AudioContext. Listen/soak on real devices for music continuity, boss/Bell transitions, tab interruption, SFX masking and gesture recovery.
9. **Archive paired evidence** including failing receipts/logs; current artifact uploads can be skipped after an earlier failed step. Preserve legacy assertions when replacing Canvas recording/source-regex fixtures with renderer-neutral behavior checks.

## 7. Asset migration

Reuse working art first. `src/assets` contains 199 files, including 23 JS loaders/generators, 136 images, nine JSON and 25 audio files. There are no checked-in `.blend`, `.glb`, `.gltf`, `.fbx` or `.obj` model sources. Blender scripts generate baked game art; a Phaser migration is not a 3D model rewrite.

| Asset | Current contract | Phaser-facing mapping |
| --- | --- | --- |
| Hero sheets | Six heroes, three directional sheets each, nine poses per direction; 182px generated frames with matching attachment trees. | Initially register existing generated frames with stable keys; preserve paired pose data and side mirroring. Later atlas frames only with identical logical origins/anchors. |
| Hero cosmetics | Body/head/shoulder/hand transforms from `HeroPose`; finite appearance variants plus procedural trails/aura/sparkles. | One resolved body pose/parent transform drives every overlay. Child mirroring exactly once; no independent animation that detaches hats/wands/cloaks. |
| Enemy animation strips | Twelve four-frame strips, plus directional Warden and special Lieutenant assets; multiple fallback layouts. | Source-rectangle descriptors or reused sliced canvases, not one universal sheet grid. Preserve grounded versus flying baselines and per-source sampling. |
| LPC/imported fallbacks | Selected walk columns, tint variants and blank-cell detection. | Keep loaders/resolution order; map returned frames to textures after readiness. Missing bespoke sheets still resolve to working imported/procedural frames. |
| Rendered weapon props | Seven families, each base/accent mask/glow mask/anchors JSON; thresholded composition returns canvas/size/grip/tip. | Generate once per bounded variant, register texture, keep grip/tip metadata; flat sprite tint is not equivalent to the layered compositor. |
| Ground textures | AI ground, CC0 fallback, then procedural; CanvasPattern caches. | Repeating texture/TileSprite or bounded cached ground chunks using the same world origin and scale. No giant whole-world render target. |
| Decor | Nine loaded decor images resized using authored logical dimensions times `SPRITE_SS`. | Manifest retains both texture pixels and logical draw size; raw PNG width must not enlarge rocks/grass/hit spaces. |
| Houses/obstacles | Four wall materials, five floor variants, seven cabin furnishings and obstacle/border art; blueprint geometry separate from raster. | Separate floor/wall/furniture view parts derived from existing blueprint; `cabinClean` for the v3 cabin, not the legacy furnished floor image. |
| Procedural sprites/bosses/glows/icons | Prewarmed Canvas art and finite shipped style/palette vocabularies; several underlying glow/tint/weapon variant caches remain caller-bounded, without explicit eviction caps. | Generate once -> `textures.addCanvas` -> reuse. Give each cache an explicit lifetime policy; eviction removes GPU resources as well as JS entries when no views reference them. |
| UI images/font/emblems | Existing menu art, case art, gear/cosmetic emblems and Cinzel WOFF2 with fallback drawing. | Keep Canvas UI loader initially. Register in Phaser only when the owning UI view is deliberately ported; preserve font readiness and fallback text layout. |
| Photos/cards | Canvas compositor consumes captured world and template data. | On-demand GPU world snapshot -> reusable 2D compositor; preserve crop, orientation, capture-before-HUD and sharing fallback. |

References: [Hero frames][ew-heroframes] · [Pose/attachment math][ew-heropose] · [Enemy frames][ew-enemyframes] · [Weapon props][ew-weaponprops] · [Structure rendering][ew-structures] · [Phaser texture registration][p-textures]

Proposed manifest fields: `id`, relative URL/source canvas, source rectangle/layout, logical size, texture dimensions, sampler policy, origin, attachment-set ID, variant key, fallback ID, credit reference and lifetime owner. These are presentation metadata, not new save IDs.

Phaser CanvasTexture `refresh()` is appropriate after a real dirty bake; `update()` also calls pixel readback. Immutable hero/weapon/decor canvases need neither every frame. DynamicTexture is a different API: explicit buffered render completion is required. Avoid a full 1920x1080 Canvas-to-GPU upload on every frame. [CanvasTexture][p-canvastexture] · [4.x buffered textures][p-migration]

Decoded memory is a major risk: a single 27-frame 182x182 RGBA hero set is approximately **3.41 MiB**, before browser/GPU duplication. Six natural sets are about **20.5 MiB**; eight cached appearance sets add about **27.3 MiB** if all resident at that size. Existing JS LRU eviction does not automatically release Phaser textures. Inventory live texture bytes and references, bound appearance caches, and do not build all cosmetic combinations eagerly.

Keep `tools/blender/render_sheets.py`, `monkey_rig.py`, hero parameters/presets and `render_house_v2_props.py` as asset production sources. Retain installed-sheet hash/palette/alpha/pose validation. Neither Blender nor Higgsfield needs to run for this audit or first parity slice; introducing new art would obscure renderer comparisons.

Keep `ASSET_CREDITS.md`, `src/assets/credits/assets.json` and per-pack credits. The current asset validator checks 13 declared representative external files and six metadata entries; it does not discover every undeclared sibling or prove licensing sufficiency. Future engine/vendor and atlas inventories need explicit completeness checks without pretending the old validator already supplies them.

## 8. Coordinate / scale contract

There must be **one viewport authority**, not Phaser FIT plus the existing Renderer independently scaling the same surface.

| Space | Contract |
| --- | --- |
| Simulation/world | Existing world positions, radii, wall polygons, navigation grid and velocities remain unchanged. World origin and map bounds do not become texture pixels. |
| Logical display/UI | 1920x1080; menus, HUD, touch layout and safe-area values continue to use these units. |
| CSS display | Current cover/contain policy: prefer cover only if crop fraction <= 0.22; otherwise contain. |
| Backing pixels | Rounded CSS size times budgeted DPR, independently from simulation coordinates. |
| Physical pointer | Browser CSS client coordinates -> inverse stage rotation -> logical display -> existing unshaken aim mapping. DPR never multiplies pointer input. |

Boot attempts native landscape lock through `renderer.tryLockLandscape()` from the first touch/pointer gesture. `Renderer.resize` uses `visualViewport` if available, swaps fit dimensions for coarse-pointer portrait and applies a 90-degree CSS stage rotation while no native landscape lock is active. Physical safe-area insets and cover cropping are both folded into logical HUD insets. Rotated physical edges map top->logical left, bottom->right, right->top, left->bottom. Orientation changes reset active touch IDs/drags. [Renderer][ew-renderer]

Initial DPR cap is 2. The nominal backing budget is 3840x2160 pixels for coarse-pointer devices and twice that on desktop; the nearby comment saying four times is stale. The final floor `min(1, requestedDprCap)` means this is not an absolute cap for an oversized CSS surface. The governor may reduce DPR to 0.7. Port the actual policy first; a later stricter memory budget must be explicitly tested as a visual-quality change.

### Target transform, not guessed engine scaling

Let `C=(960,540)`, `c` be the existing camera center, `z` its zoom, `h` its shake translation, `R` its shake rotation and `s=(cssWidth/1920)*dpr`. The existing drawing target is:

```text
logicalScreen = C + R * (z * (world - c) + h)
backingScreen = s * logicalScreen
```

That matrix describes **`Camera.apply` world drawing**, not every legacy layer. `LightingSystem.addLight:154` and `ParticleSystem.drawScreenAdditive:391` currently use `C + z*(world-c) + h`, omitting shake rotation. `UISystem._worldToScreen:2200` uses `C + world-c`, omitting zoom and all shake. Keep layer-specific fixtures for these exceptions; aligning them to one common visual camera would be an intentional visual correction, not unchanged parity.

The unshaken aim inverse is `world = c + (logicalScreen-C)/z`; normal `_focusTapAt` currently uses the zoom-1 specialization. Preserve that convention initially even though the visible world shakes. Do not use Phaser pointer `worldX/worldY` as a drop-in substitute.

Recommended GPU sizing adapter: use `Scale.NONE`, resize the engine backing surface to the shared contract's rounded backing dimensions, explicitly apply the shared CSS dimensions, and configure the visual camera viewport/origin/zoom to produce the matrix above while keeping GameObject positions in world units. Sample the existing camera center rather than enabling a second smoothed follow. ScaleManager changes engine size/CSS state, so reapply/verify the contract after refresh and resize; test subpixel rounding at the bottom/right edges. There is no assumed `resolution: devicePixelRatio` shortcut in the inspected 4.2.1 config. [Scale source][p-scale] · [Camera source][p-camera]

Mandatory coordinate fixtures: world origin, four logical corners, player center, a door boundary, a projectile-wall crossing and touch button centers, at zoom 0.75/1/2, DPR 1/2/3, contain/cover, portrait/landscape and nonzero safe areas. Test with shake enabled visually but disabled in targeting. Require world/collision positions unchanged and screen projection within **0.5 CSS pixel** of each layer's agreed legacy target (excluding intended antialiasing differences). Any approved realignment gets a separately recorded target.

Retain the current portrait rotation and upright rotate hint for the pilot. A redesigned portrait-native HUD is a separate product change; do not silently switch to Phaser RESIZE/EXPAND and call changed hitboxes a responsive improvement. Real iOS safe areas, browser chrome, landscape orientation and multitouch require physical testing before promotion.

## 9. Performance risks

Phaser is not automatically faster. This game already caches procedural art, chunks, lighting buffers, pool entries and painter records. Renderer replacement can reduce some CPU work while increasing GPU memory, batching complexity and fill cost. Phaser's published renderer improvements are general engine claims, **not EMBERWAKE measurements**. [Official renderer discussion](https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games)

| Workload | Potential gain | Regression risk / measurement |
| --- | --- | --- |
| Repeated sprite draws | GPU batching and reusable display objects may lower Canvas dispatch cost. | Many distinct generated textures, blend changes and painter order can split batches. Measure actual draw calls, live texture count and CPU view-sync cost. |
| Lighting veil | GPU composition can replace repeated 2D mask/bloom work. | Fullscreen targets and many lights can become fill-rate limited; priority 0 is exempt and priority 1 has its separate pickup cap, while only priority 2 checks maxLights. Bound veil resolution and measure peak lights. |
| Particles | Reusable emitter/object pools can reduce custom draw work. | Emitters still have CPU update cost; excess objects/containers and transparent overdraw can be worse. Keep 220-particle baseline and reduced tiers before expanding. |
| House/map chunks | Cache uploads and cull display records instead of redrawing all shapes. | A whole-world texture wastes memory; thousands of tiny scene objects create update/sort overhead. Bound visible chunks and preserve shared geometry. |
| Hero cosmetics | Atlas/bake reuse can reduce repeated Canvas composition. | 27-frame appearance sets, normal maps and duplicate CPU/GPU caches can multiply memory. Explicit reference counting/eviction needed. |
| Filters/shaders | Selective bloom/grade can improve presentation. | Each filter/capture target adds passes/allocations; use small regions and few grouped layers, not per-enemy fullscreen bloom. |
| DPR | GPU handles some scaling efficiently. | Pixel cost grows quadratically; 1920x1080 RGBA is ~7.91 MiB, at 2x dimensions ~31.64 MiB **per color target**, before depth/MSAA/extra targets. |
| Simulation | None assumed. | Collision, navigation, AI, weapon math and death queues remain CPU costs. Phaser does not accelerate them merely by displaying their results. |
| UI bridge | Preserves proven menus/accessibility with low migration risk. | Two composited canvases and CPU UI drawing remain; measure overlay cost. Avoid uploading the UI texture each frame if it is already an overlay. |
| Audio | Retaining engine avoids music regressions. | A second audio context/scheduler would cost power and duplicate cues. Keep Phaser audio disabled. |
| Startup | Texture readiness can be made explicit. | Engine adds ~1.38 MB minified uncompressed JS, parse cost and GPU upload time on top of assets. Measure cold/warm start separately. |
| Context loss / mobile thermal | Engine resource lifecycle may help recovery. | Rebuilding generated textures can hitch or lose UI state; desktop headless cannot establish thermal stability. |

The current FrameProfiler gives CPU EMAs, not percentiles, GPU completion, thermal throttling, battery drain or displayed frames. Harness `1000 / CPU-EMA-ms` is throughput estimation; `loop.fps` uses clamped elapsed time and can flatter long stalls. Record real RAF gaps, input-to-next-render timing and phase CPU distributions separately. Never compare a software-rendered harness number with a physical WebGL FPS number.

For a later 120 Hz mode, keep simulation 60 Hz, interpolate **presentation only** from previous/current transforms, keep aim/collision authoritative and handle teleport/Blink as discontinuities. Retarget governor thresholds and the hardcoded 16.67 ms profiler budget. Passing a 60 Hz pilot neither implements nor validates that setting.

## 10. Dependency / distribution decision

**Recommend a locally vendored, pinned official Phaser 4.2.1 ESM distribution, retaining native ES modules and no bundler.** This audit installs or vendors nothing.

Verified release artifacts:

| Tagged artifact | Repository bytes | Use |
| --- | ---:| --- |
| `dist/phaser.esm.min.js` | 1,377,611 | Proposed production experimental import. |
| `dist/phaser.esm.js` | 8,544,850 | Optional local source-debug comparison, not necessary as a second public production payload. |
| `dist/phaser.min.js` | 1,375,976 | UMD/global build exists but is not the preferred native-module route. |

The official package declares version 4.2.1, MIT license, ESM `module`/import exports and a separate CommonJS entry. Its **built distribution** is the browser import; raw `src/phaser-esm.js` imports internal CommonJS modules and is not a self-contained browser entry. The package's eventemitter dependency is a distribution/build concern, not a reason to add a package manager just to serve the built ESM file. [Package metadata][p-package] · [ESM entry][p-esm] · [Distribution tree][p-dist]

Future vendor PR contents: exact ESM artifact, original MIT license, a small provenance/checksum manifest recording upstream tag/full commit/source URL/artifact SHA-256 and upgrade instructions. Retain copyright and permission notice. Do not generate or guess a checksum in this audit; compute it from the actual artifact when vendoring. [MIT license][p-license]

Comparison:

- **Pinned local ESM: chosen.** Same-origin relative URLs, reviewable bytes, no third-party runtime dependency, no change to Pages build cadence.
- CDN ESM: simple for a throwaway prototype, but weaker control over availability/cache/version/provenance. Do not use `latest` or unversioned URLs in the experiment.
- npm + bundler: useful only if later source-level engine builds/tree-shaking justify operational complexity. Neither `package.json` nor a bundler is required for this distribution path. Adding one now changes deployment and tests without first proving renderer value.
- UMD global: available, but unnecessary global state and less consistent with existing imports. The 4.2.1 release specifically fixes ESM-breaking global Phaser references, reinforcing the need to pin a verified patch release.

GitHub Pages already serves native modules as a static repository site. Keep all relative asset paths and MIME-correct local serving. No service worker is tracked; do not claim offline support, installable native packaging or App Store compliance as a side effect of adding Phaser. No distribution/bundler/deploy changes are authorized by this audit document alone.

## 11. Migration order: 13 focused PRs

Each PR leaves legacy playable and default, retains save compatibility and can be stopped/reverted without requiring its successor. Likely new filenames are proposals. No PR gets to remove a legacy test just because its adapter is inconvenient. Pure-policy gates and the baseline real-game `EXC:0` smoke run in every PR; focused tests below are additional.

### PR 1 — Lock the baseline and expose deterministic test inputs

- **Goal/subsystem:** migration acceptance fixtures, clock/RNG test injection and discovered gate gaps; no engine.
- **Likely files:** `tools/artshot/harness.html`, new shared scenario/receipt modules, `MathUtils.js`, narrow RNG call sites, `.github/workflows/ci.yml`, dedicated parity validator.
- **Identical behavior:** normal runtime RNG/time policy remains default; current source content, save fixture results, fixed clock and all 37 validators stay intact. A later split RNG stream must be explicitly recorded as a baseline change, not hidden in a refactor.
- **Tests:** add run-bonus to CI; controlled seed/time repeated receipts; negative fixtures; verify no seed/clock override on production URL; record baseline desktop/touch/boss/house/profile evidence.
- **Rollback:** inability to replay selected real scenarios without changing rules or weakening existing checks. Revert injection; legacy remains untouched operationally.

### PR 2 — Add narrow platform, save sandbox and lifetime seams

- **Goal/subsystem:** one Game with injectable storage/view/platform defaults and explicit cleanup; no renderer switch.
- **Likely files:** `Game.js`, `RunState.js`, `main.js`, `SaveSystem.js`, input/Renderer lifecycle methods; new `src/platform` helpers.
- **Identical behavior:** ordinary production construction, schema/key/locks, startup/settings, run latches and input routing.
- **Tests:** legacy constructor and complete initial-stat/loadout/starting-coin parity on fresh run/restart; in-memory experiment performs zero localStorage writes and no live lock participation; repeated boot/dispose produces one listener/action/audio owner; all transaction denial/stale-tab fixtures.
- **Rollback:** any persistent mutation from a sandbox or changed legacy save receipt. Do not proceed to Phaser until isolated.

### PR 3 — Vendor Phaser and create experimental boot/harness

- **Goal/subsystem:** pinned dependency and capability/boot path only.
- **Likely files:** `phaser.html`, `src/phaser/main.js`, `WorldScene.js`, vendor artifact/license/manifest; `tools/artshot/phaser-harness.html`, CDP driver GPU option.
- **Identical behavior:** `index.html`, manifest start URL and all legacy flows unchanged; experimental progress not saved.
- **Tests:** static relative ESM/asset loading under `/2dgamerepo/`, checksum/license validation, empty WebGL pixel/exception receipt, boot failure Canvas link, no Phaser audio/input/physics side effects.
- **Rollback:** context/distribution import failure on supported browsers or dependency leaking into legacy boot. Remove experimental entry/vendor files.

### PR 4 — Single clock, viewport, input and Canvas UI bridge

- **Goal/subsystem:** real Game updates behind Phaser's scheduler with correct coordinate/display ownership.
- **Likely files:** `GameLoop.js`, `Renderer.js`, `Input.js`, `TouchJoystick.js`, `TouchButtons.js`, `GameRender.js`, `styles.css`; shared SimulationClock/ViewportContract and Phaser bridge.
- **Identical behavior:** fixed 1/60 ticks, catch-up/pause/hit-stop/Focus clocks, between-tick actions, current logical/safe-area/rotation mapping, retained Canvas menu/HUD layout.
- **Tests:** 30/60/120 Hz synthetic render cadence gives identical simulation receipts; orientation mid-drag, multitouch, visibility reset, projection fixtures, no double RAF/resize/input handlers, UI overlay transparency/focus.
- **Rollback:** timing, hitbox, focus or touch discrepancy; leave only experimental boot disabled or remove this adapter.

### PR 5 — Reuse asset/pose textures with bounded lifetime

- **Goal/subsystem:** actual hero/enemy/weapon/decor textures and fallback chain, not new art.
- **Likely files:** `src/assets` loader interfaces, `HeroPose.js`, new Phaser texture registry/asset views, cosmetic/asset validators.
- **Identical behavior:** frame dimensions, origins, colors, pose pairing, mirroring, grip/tip anchors, credits and missing-file fallback.
- **Tests:** all six heroes x 27 poses, source hashes, fallback forced by asset failures, cosmetic fit while walking/casting, texture eviction/reload without leaks.
- **Rollback:** any missing fallback/attachment drift or unbounded variant residency. Keep legacy caches and remove adapter registrations.

### PR 6 — Port one real world's layers and houses

- **Goal/subsystem:** Emberwood ground, dressing, v3 cabin walls/floors/furniture and ordered entity slots.
- **Likely files:** `MapRenderer.js`, `StructureRenderer.js`, `Obstacle.js`, `GameRender.js`, new Phaser world/structure views.
- **Identical behavior:** geometry, navigation/LOS, exclusions, floor mapping and baseline/rank/serial order; no old facades inside v3 cabin.
- **Tests:** door/wall projection overlays, all house states/breach revisions, actors passing in front/behind walls, chunk cache boundaries, no whole-world texture.
- **Rollback:** visible/collision disagreement or unstable painter order. Experimental world stays unavailable; Canvas world remains source of truth.

### PR 7 — Real combat views and minimal effects: vertical-slice gate

- **Goal/subsystem:** Pyra, Cinderbolt, five classic enemy identities, pickups/XP/one level-up, Blink/Kindle, one real map boss, HP/XP HUD and baseline lighting.
- **Likely files:** `Player.js`, `Enemy.js`, projectile view seams, `WeaponSystem`, `HazardSystem`, `GameUpdate`, `GameRender`, new bounded effect/light adapters.
- **Identical behavior:** fixed-tick damage/targeting/collisions/XP/cooldowns/telegraphs/boss phase and accepted upgrade, no persistent rewards.
- **Tests:** section 12 gameplay sequence; semantic and screenshot pairs on desktop/touch; all section 13 pilot gates; force fallback art and reduced effects. Initial lighting may use a bounded Canvas-generated veil texture only if uploads are measured and clearly temporary, never full-world blits.
- **Rollback:** stop the migration here if benefit/automation/mobile gates fail. Reusable seams remain; production Canvas never switched.

### PR 8 — GPU effects, darkness and visual polish within budgets

- **Goal/subsystem:** replace temporary veil/particle adapters and improve selected lighting/cast/transition effects after a successful pilot.
- **Likely files:** `LightingSystem.js`, `ParticleSystem.js`, effect ports, Phaser filter/light/particle views, graphics metrics.
- **Identical behavior:** telegraph geometry/time, critical cues above veil, accessibility settings, no damage from visuals, same effect caps unless separately approved.
- **Tests:** darkest-map cues, reduced/normal comparison, projectile-light stress, shader failure, context restore, draw-call/target/texture budgets and real-device p95 frame time.
- **Rollback:** readability or thermal/frame regression. Keep simpler view path; no cosmetic effect is a reason to weaken performance gates.

### PR 9 — Remaining content, build families and world modes

- **Goal/subsystem:** all four maps, 40 weapons, full enemy/boss roster, signatures, relic/road/gear visuals, encounters/sites/Bell and mode presentation.
- **Likely files:** family-specific effect adapters and Phaser views; shared content stays authoritative; harness scenarios expanded.
- **Identical behavior:** every recipe/formula/cap, boss deck/phase, provenance, mode setup/seed/score, spawn arbitration and linked reward identity.
- **Tests:** one real scenario per weapon behavior family plus every content ID resolves; all bosses/maps/modes; Bell failure/retry/breach/reward branches and navigation stress.
- **Rollback:** unsupported content IDs or mode-specific rule forks. Do not label Phaser full-game until the complete catalog resolves.

### PR 10 — Menu/meta flow parity and production-shell accessibility

- **Goal/subsystem:** finish Canvas UI bridge, isolate layout hotspots, migrate only selected UI pieces with evidence; no economy redesign.
- **Likely files:** `UIStateBuilder.js`, `MenuRenderer.js`, `UISystem.js`, `GameInputActions.js`, AccessibilityBridge/HUDLayout/ResponsiveLayout, both HTML shells.
- **Identical behavior:** menu wording/action keys, case landing/retry, Mines keyboard actions, Collection pages/try-on, claimed/locked state, pause confirmations, tour focus and all five `?dev=1` controls.
- **Tests:** full existing phone/menu matrix, actual keyboard/touch routes and removed-control focus recovery, live-region semantics, text clipping/44 CSS-pixel fixtures, reduced effects.
- **Rollback:** inaccessible controls or divergent action ownership. Keep affected panel on Canvas; a DOM redesign is not required for this migration.

### PR 11 — Real saves and end-to-end reward parity opt-in

- **Goal/subsystem:** enable explicitly selected persistent experimental runs only after isolated parity.
- **Likely files:** experimental boot/save adapter, Game transition integration and durable transaction browser scenarios; no schema change unless independently required.
- **Identical behavior:** same save key/version, validated IDs, accepted balance deltas, campaign eligibility, once-only entitlements, refusal/retry and cross-tab participation semantics.
- **Tests:** historical saves, malformed/unknown fields, quota/blocked storage, lock absence/denial, legacy+Phaser tabs, case/Mines/Blueprint/BP/Daily rewards, actual death/victory/restart/abandon, UTC midnight/week rollover and accepted receipts. Characterize older non-atomic award paths honestly; any repair is separate.
- **Rollback:** any save/currency/progression discrepancy is an immediate blocker. Disable experimental persistence without rewriting the user's original profile.

### PR 12 — Capture, lifecycle and sustained-performance acceptance

- **Goal/subsystem:** photo/cards, audio/visibility/orientation, resource recovery, sustained mobile performance and optional separately gated high-refresh presentation.
- **Likely files:** `PhotoModeController.js`, `CardCompositor.js`, Phaser capture/lifecycle, FrameProfiler/governor, tests and optional settings adapter.
- **Identical behavior:** capture-before-HUD, crop/share fallbacks, music continuity, no run restart/reward on scene reset, preserved touch/aim and settings.
- **Tests:** world/card/full-viewport exports, context loss, 10 restart cycles, 20-minute device/audio soak, 60 Hz budgets; if adding 120 mode, 8.33 ms presentation/interpolation tests with unchanged 60 Hz simulation.
- **Rollback:** freeze, resource growth, audio dropout, double reward, capture taint or input regression. Do not enable 120 mode just because RAF runs fast on desktop.

### PR 13 — Default cutover, retained legacy escape hatch

- **Goal/subsystem:** select Phaser by default only after complete content, save, automation, accessibility and physical-device acceptance.
- **Likely files:** production boot/entry routing, manifest only if needed, legacy entry retained, CI/deployment documentation and ledger.
- **Identical behavior:** saves/content/economy/progression, normal and developer URLs, static Pages deployment and tested browser support.
- **Tests:** full paired suite, production entry and deployed asset hashes, real-device signoff, cold/warm load, recovery fallback, zero unresolved section 13 blockers.
- **Rollback:** any post-cutover crash/save/input/performance regression: revert default routing to legacy; never migrate saves backward or delete the fallback in this PR.

## 12. First meaningful vertical slice

Use **Pyra (`monkey`) on Emberwood with Cinderbolt**, real default build rules and sandboxed progression. Render the existing cabin and at least one doorway/obstacle, not an empty demo rectangle. Exercise the five classic creature identities with actual runtime types: `slime`, `bat`, `crawler` (snake art), `spitter` (eyeball art), `mite` (bee art). Record those existing type IDs rather than inventing new enemies.

Include:

- Movement and actual obstacle resolution; visible hero walk/cast/hurt poses with equipped hat/cloak/wand attached.
- Cinderbolt acquisition/cadence/targeting/projectile hits; hostile projectile wall blocking.
- Real XP pickup, level 2 reached, a real upgrade selected and its mechanical result asserted.
- HP/XP HUD, damage and one normal lethal-hit path (separate from the harness's godmode shot).
- Blink across open ground and denied/truncated through a wall; Kindle quick tap/hold/release and Focus aim/slow-time parity.
- One existing Emberwood boss: **Vesperwing (`stormwingAlpha`)**, entered through the real BossDirector warning/spawn path, its telegraphs and phase transition, defeat and sandboxed provenance receipt. Preserve the stable ID separately from the displayed name.
- Darkness/player/projectile lighting, cues above veil, modest particles, Reduced Effects and high contrast.
- Desktop keyboard/pointer, landscape multitouch and the actual portrait-rotation shell.
- Pause/visibility/orientation recovery, menu return, missing-art fallback and one WebGL context-loss recovery attempt.

Use two forms of the slice: a controlled fixture may advance director time to reach the boss quickly without duplicating boss logic; a real-time run validates cadence, input and audio. Harness auto-choice/godmode is appropriate for screenshots, not evidence that XP selection/death are playable. The first slice does not need all 40 weapon visuals or every menu port, but its engine entry must reject unsupported experimental routes clearly.

Boss checks include preserving an in-progress windup through phase transition, recovery windows, threshold support waves and exact defeat cleanup. The broader migration covers all 14 current attack kinds: shockwave, fan, charge, wall, seekers, zones, summon, aimed, cross, spiralArms, rain, mines, beam, lingering. Boss-owned projectiles/hazards/tagged summons retire without extra summon-kill rewards; scene shutdown must not substitute for that cleanup.

Judge it using shared semantic receipts, paired screenshots and physical-device performance, not an animated screenshot of Pyra. It is a success only if we can keep the existing game rules and reuse the actual art while materially improving presentation or the measured rendering bottleneck.

## 13. Success / abort gates

These are **proposed acceptance thresholds**, not measured Phaser results. Record hardware/browser/OS, viewport, DPR, quality, seed/fixture and backend for every comparison. Run warmed and cold-load cases separately, with repeated trials on the same device. Select at least one real iOS Safari device and one midrange Android Chrome device before the pilot review; emulation cannot close that gate.

| Gate | Continue criterion | Stop / reconsider criterion |
| --- | --- | --- |
| Simulation parity | At fixed input/tick checkpoints, exact discrete HP/XP/kills/levels/currency/phase/reward/campaign outputs; collision positions within 1e-6 world units on the same browser where floating-point order is preserved. | Any unaccounted-for rule difference or need to rewrite most combat/director logic. |
| Save integrity | Zero new writes from sandbox; all persistent transaction/migration/denial tests pass before live opt-in; no Phaser objects in saved JSON. | Lost currency, double reward, changed eligibility, stale-tab overwrite or schema incompatibility. Immediate block. |
| Automation | All 37 validators, full legacy CI and WebGL receipts pass; same-browser deterministic stepping and real-entry smoke work. | Dropping tests, relying only on HEADLESS/no-pixel mode, or using manual screenshots as replacement for receipts. |
| Input | Projection within 0.5 CSS px; no lost/coalesced actions beyond existing semantics; p95 input-to-next-presented-response no more than one 60 Hz frame worse than legacy. | Broken rotation/multitouch, duplicate handlers, hitbox drift or >16.67 ms unexplained p95 added latency. |
| 60 Hz rendering | On selected supported real devices, representative slice p95 total presented frame interval <=20 ms after warmup, with no >10% same-device regression versus legacy; investigate any repeated >50 ms active-play stalls. | Sustained slower play, recurrent allocation/upload stalls or unacceptable device heat compared with baseline. If legacy itself misses the absolute target, record it; do not silently lower the target. |
| Stress behavior | At existing caps, degrade visual quality predictably without dropping simulation work or critical warnings; no runaway texture/emitter/light allocation. | Faster empty demo but worse real swarm/boss/house scene, or culling affects damage. |
| Memory/lifetime | Texture count/estimated bytes stabilize; after 10 run/menu cycles, no monotonic owned-resource growth and final owned count within 5% of warmed baseline excluding documented caches. | Texture variants, filters, listeners or pooled views grow without a bound; context restore loses state. |
| Load budget | Measure cold first-actionable time on fixed device/network; proposed added median boot time <=1 s and <=20% versus legacy, or require an explicitly reviewed budget change. | Unbounded asset preload, long blank screen, missing fallback or large unexplained startup regression. |
| Visual quality | Paired review approves hero/cosmetic attachment, house layering, spell/boss readability and HUD clarity; at least two agreed improvements demonstrated without losing contrast/reduced-mode support. | “More glow” hides danger or copied flat demo art replaces working content. Do not use raw pixel inequality as quality proof. |
| Audio/lifecycle | One graph; 20-minute play/interrupt/return test retains music, acceptable SFX balance and intended event transitions. | Duplicate music, stuck pause attenuation, gesture failure or lost cues. |
| Architectural boundary | No Phaser imports in combat/collision/save/progression rule modules; view ports remain bounded and replaceable. | Scene registry/physics/tweens become authoritative for damage, deadlines or economy. |
| 120 Hz (later, optional) | Explicit setting, compatible hardware, 60 Hz simulation with view interpolation, p95 presentation work <=8.33 ms on target device and no balance/input regression. | Display refresh or comments are offered as proof; mobile performance fails at thermal steady state. Not a pilot completion requirement. |

If the pilot fails performance but retains clean seams, first profile the failing phase rather than immediately swapping engines. Reconsider PixiJS only if Phaser's ownership/batching/lifecycle costs are the demonstrated problem. Staying on Canvas is the rollback, not a failure to deliver this audit. Do not keep spending on a migration after its stop conditions are met merely because preparatory PRs have merged.

## 14. Migration-relevant technical debt

Only debt that obstructs safe migration is listed. New maps, story content, economy tuning and general visual redesign are outside this audit.

| Severity | Exact area | Why it matters | Timing |
| --- | --- | --- | --- |
| Critical | `Game.js` constructor; `SaveSystem.js` constructor/participation/dispose | Second runtime can create duplicate live save participants or write settings/migrations before gameplay. | Before engine boot: PR 2 sandbox/lifetime seam. |
| High | `GameLoop._tick`, `main.js:118`, GameUpdate mixed clocks | Default Phaser delta or duplicate RAF changes cadence/Focus. | Baseline PR 1; clock bridge PR 4. |
| High | `Renderer.resize/_computeSafeArea/clientToInternal`, both input touch classes | CSS rotation, cover crop and logical units are not stock ScaleManager pointer mapping. | Extract/test before gameplay port, PR 4. |
| High | `Player.draw` pose/body-kind writes; `HeroPose.resolveAttachmentTransform`; `Enemy.draw` facing latch; `Enemy.chaserBrain` animation phase | Render-skipping can detach cosmetics/change facing, and moving the animation clock can change AI weaving. | Pose views PR 5/7; keep AI phase in simulation, not a whole entity rewrite. |
| High | `WeaponSystem.update/drawEffects`, behavior functions in `content/weapons.js`, HazardSystem draw/update | Damage-capable state and visual state can be confused when porting emitters. | Effect port PR 7, then every family PR 9. |
| High | `GameRender` painter/light/capture ordering; `StructureRenderer` blueprint paths | A naive display list breaks walls, warnings, lighting and capture-before-HUD. | World/light/capture adapters PR 6–8/12. |
| High | Global RNG callers; `Camera.update`; harness fixture time | Existing screenshots are not full deterministic replay; moving random visual work alters later samples. | Test seam PR 1; any production stream split separately characterized before parity claims. |
| High | `UIStateBuilder.buildUIState`; `MenuRenderer.draw/_drawCaseOverlay`; Game render wrapper | Live references and draw-created hotspots undermine dual presentation. | Retain one UI owner from PR 4; isolate layouts in PR 10. |
| High | `capture-harness.mjs:145`, harness CSS duplication, CPU-FPS estimate | Current green lane cannot establish WebGL, production-shell or real-device performance. | GPU/sibling lane PR 3; production shell and device gates before PR 7 approval. |
| Medium | `FrameSpatialIndex.rebuild`, `_focusTapAt`, `_inView` | Camera has simulation-query/aim/audibility consumers beyond rendering. | Explicit camera contract PR 4/7. |
| Medium | `ProceduralSprites` appearance LRU, loader null/fallback caches | JS cache behavior does not manage engine texture lifetime; premature fallback may become permanent. | Asset registry PR 5; stress PR 12. |
| Medium | `GameRender._updateGfxGovernor`, `GameConfig` GFX thresholds, `FrameProfiler`, UISystem budget | 60 Hz thresholds/EMAs and clamped FPS are unsuitable proof for high-refresh/GPU performance. | Instrument PR 7/8; optional 120 mode only PR 12 or later. |
| Medium | `Game._checkAchievements`, `_checkDailyChallenges`, `_bankRunCoins` | Older multi-write/latch behavior is weaker than newer exclusive receipts; scene restart must not magnify it. | Characterize now; separate settlement fix only if needed before persistent PR 11. Do not bundle economy changes into rendering. |
| Medium | `ci.yml` explicit validator list / Node version text; `pages.yml` independent trigger | Omitted run-bonus gate and independent deploy can give false confidence. | Discoverable gates PR 1; merge only after verified PR CI throughout. |
| Medium | `validate-assets.js` declared representative coverage; no engine provenance inventory | Added dependency/atlases may be uncredited/unbounded despite a passing old validator. | Vendor PR 3 and texture manifest PR 5. |
| Low | Ledger/README stale main/deploy comments | A later agent can audit the wrong baseline or assume harness/private-save isolation. | This audit records truth; reconcile canonical ledger in the next authorized implementation PR. |

Do not require an ECS rewrite, TypeScript conversion, bundler, scene-per-game-mode design, rewritten collision engine or generalized event framework as “cleanup before Phaser.” The smallest tested seam at the actual call site is preferable.

## 15. Final recommendation and handoff

**A. Proceed with Phaser 4 migration.** Confidence: **medium-high (about 75%) that a bounded pilot is worthwhile; insufficient evidence to approve default cutover today.**

Why A: EMBERWAKE already has substantial custom gameplay/progression systems worth keeping, while its Canvas world composition, sprite/effect rendering and resource lifecycle are plausible places for GPU presentation value. The art is reusable through verified canvas/texture APIs, the static ESM distribution fits Pages without a build-system rewrite, and a sibling entry can keep the current game as a working control. The risks are identifiable seams, not a requirement to discard the game's concept or content.

Why not B now: PixiJS is a credible renderer-first alternative. Its official v8 architecture separates renderer/scene graph and an Application helper with ticker/resize plugins, so it could fit the same authoritative simulation. However, it does not remove this project's pose/house/input/save/harness seams, and choosing it now would trade Phaser's verified sprite/animation/particle/filter/camera facilities for another integration before obtaining evidence that Phaser is the bottleneck. No comparative EMBERWAKE benchmark was run. [Pixi architecture](https://pixijs.com/8.x/guides/concepts/architecture) · [Application](https://pixijs.com/8.x/guides/components/application)

Why not C as the planned destination: Canvas is a viable shipping fallback and may still win the pilot. But the user wants higher-quality presentation and sustained development; the isolated experiment can answer the rendering-value question without risking the production game. Why not D: there is no evidence that a 3D engine, native rewrite or another framework solves these particular migration constraints more safely.

**Next authorized implementation should be PR 1 only**, followed by review of its baseline evidence. Do not interpret approval of this audit as permission to collapse the 13 PRs into one engine rewrite. At PR 7, stop and review the real slice before widening content coverage. At PR 13, switch defaults only with all required parity/device/save gates closed.

### Handoff / status notes

- Completed by this change: architecture and current API research, source-grounded migration/seam map, asset and test plans, 13-PR sequence and measurable stop conditions.
- Not implemented: Phaser dependency, experimental entry, render adapters, new UI, save seams, gameplay changes, 120 FPS mode or new assets.
- Preserved: current Canvas game, native ESM workflow, authored content/art, saves/economy, all existing modes and `?dev=1` Settings.
- Known open evidence: engine pilot, real GPU/device comparisons, actual iOS/Android input/audio/AT acceptance, complete gameplay workflow parity and context-recovery proof.
- Documentation-only scope takes precedence over the usual ledger-update convention for this PR: **only this document is committed**. Its baseline and handoff are explicit so Codex/Claude can resume without guessing.

### Validator coverage index

All entries below are `tools/validate-<name>.js` and passed locally on the audited main. These groups account for all **37** top-level scripts; `tools/artshot/validate-receipt-png.mjs` is an additional image utility, not one of those 37.

| Group | Exact validator names |
| --- | --- |
| Assets, bodies, collection (6) | `assets`, `cosmetic-attachments`, `cosmetic-collection`, `collection-completion`, `collection-completion-flow`, `blueprint-purchase` |
| Combat, run, progression (6) | `bosses`, `combat-integrity`, `campaign-progression`, `progression`, `run-objectives`, `run-bonus` |
| World and guided encounters (8) | `world`, `navigation`, `house-v2`, `ruin-bell`, `encounters`, `vigil-sites`, `vigil-tracker`, `living-vigil-integration` |
| Economy / persistence (7) | `gambling-economy`, `save-transaction-durability`, `case-transaction-durability`, `case-exclusive-flow`, `case-entitlement-durability`, `shop-transaction-durability`, `mines-transaction-durability` |
| UX, accessibility, audio (10) | `ux-flows`, `accessibility`, `accessibility-save`, `phone-settings`, `minigame-accessibility`, `hud-layout`, `combat-cues`, `captions`, `haptics`, `audio` |

### Source links

Repository links are pinned to the audited main. Phaser implementation links are pinned to v4.2.1. All performance targets and proposed file structures above are this audit's recommendations, not claims made by upstream documentation.

[ew-main]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/main.js
[ew-game]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/core/Game.js
[ew-loop]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/core/GameLoop.js
[ew-update]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/core/GameUpdate.js
[ew-combat]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/core/CombatResolver.js
[ew-render]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/core/GameRender.js
[ew-renderer]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/systems/Renderer.js
[ew-save]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/systems/SaveSystem.js
[ew-campaign]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/systems/CampaignProgression.js
[ew-heroframes]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/assets/HeroAiSprites.js
[ew-heropose]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/assets/HeroPose.js
[ew-enemyframes]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/assets/EnemySprites.js
[ew-weaponprops]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/assets/WeaponProps.js
[ew-structures]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/src/render/StructureRenderer.js
[ew-ci]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/.github/workflows/ci.yml
[ew-pages]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/.github/workflows/pages.yml
[ew-harness]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/tools/artshot/harness.html
[ew-png]: https://github.com/QemmHD/2dgamerepo/blob/9ac5435a92e6e9fe153ee4bcd8d20ef95b505f4e/tools/artshot/validate-receipt-png.mjs
[p-release]: https://github.com/phaserjs/phaser/releases/tag/v4.2.1
[p-migration]: https://github.com/phaserjs/phaser/blob/v4.2.1/changelog/v4/4.0/MIGRATION-GUIDE.md
[p-renderer]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/renderer/webgl/WebGLRenderer.js
[p-renderconfig]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/core/typedefs/RenderConfig.js
[p-scene]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/scene/Scene.js
[p-game]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/core/Game.js
[p-timestep]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/core/TimeStep.js
[p-sprite]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/sprite/Sprite.js
[p-animation]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/animations/AnimationState.js
[p-shader]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/shader/Shader.js
[p-camera]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/cameras/2d/Camera.js
[p-particles]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/particles/ParticleEmitter.js
[p-lighting]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/components/Lighting.js
[p-lights]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/lights/LightsManager.js
[p-imagelight]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/filters/ImageLight.js
[p-input]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/input/InputManager.js
[p-config]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/core/Config.js
[p-scale]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/scale/ScaleManager.js
[p-textures]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/textures/TextureManager.js
[p-canvastexture]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/textures/CanvasTexture.js
[p-sound]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/SoundManagerCreator.js
[p-package]: https://github.com/phaserjs/phaser/blob/v4.2.1/package.json
[p-esm]: https://github.com/phaserjs/phaser/blob/v4.2.1/src/phaser-esm.js
[p-dist]: https://github.com/phaserjs/phaser/tree/v4.2.1/dist
[p-license]: https://github.com/phaserjs/phaser/blob/v4.2.1/LICENSE.md
