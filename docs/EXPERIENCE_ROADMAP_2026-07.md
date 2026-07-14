# EMBERWAKE Experience Roadmap - July 2026

The versioned release sequence that grows this audit through the 2.0–10.0
milestones lives in [`VERSION_ROADMAP_1_TO_10.md`](VERSION_ROADMAP_1_TO_10.md).

Status: code-grounded implementation baseline and update plan, 2026-07-14. It
reconciles the current game with
[the 2026-07-04 master roadmap](ROADMAP.md) and
[The Long Vigil plan](MAJOR_UPDATE_PLAN.md), then sets a practical 30/60/90-day
sequence.

## Executive decision

EMBERWAKE does not need another indiscriminate content dump. It already has a
large arsenal, a deep build system, four maps, twelve bosses, and several
retention loops. Its biggest opportunity is to make those systems feel like one
authored experience:

1. A run should breathe: quiet hunt, rising swarm, crisis, boss, and release.
2. Enemies should behave intentionally around houses and each other.
3. Bosses should be learnable personalities, not interchangeable projectile
   emitters.
4. Music should sound composed and respond musically, not merely get louder or
   busier.
5. Progression should explain itself, respect the player's time, and make the
   collection desirable without expiry pressure or hidden odds.

The recommended next releases are therefore:

- **0-30 days - The Living Score hardening:** measure the delivered adaptive
  audio, navigation, and boss choreography in full runs; close the remaining
  accessibility gaps and tune from playtest evidence rather than intuition.
- **31-60 days - Hunters at the Door:** give the 20 existing enemies authored
  roles and house-aware tactics, deepen boss identity, modernize existing
  upgrades/cosmetic collection UX, and ship full controller accessibility.
- **61-90 days - The Living Road Slice:** extend the shipped Vigil Site/formation
  framework with one deeper replayable Ruin Bell event, add deterministic run
  seeds/challenge codes, and expand only what measured playtests prove is weak.

### Status language

| Label | Meaning |
| --- | --- |
| **Shipped** | Present in the tracked game and exercised by the current runtime. |
| **Partial** | Useful code exists, but the promised player experience or a required gate is incomplete. |
| **Delivered this release** | Integrated in the tracked runtime and covered by purpose-built validation plus browser scenarios. |
| **Planned** | No complete player-facing implementation exists yet. |

## 1. Audited current state

The audit covered the runtime, content registries, assets, tools, CI, and all
planning documents. At this snapshot, `src/` contains 293 files, including 126
JavaScript modules and about 44,449 nonblank lines of JavaScript. Raw file counts are
inventory context, not a quality claim.

### Exact playable/content inventory

| Area | Current inventory |
| --- | --- |
| Heroes and worlds | 6 heroes; 4 maps/biomes; 12 campaign bosses (3 per map) |
| Enemies | 32 definitions: 20 non-boss enemies and 12 bosses |
| Non-boss behaviors | 13 default chasers; 1 spitter; 1 charger; 2 supports; 1 bomber; 1 summoner; 1 teleporter. Splitter adds a death behavior outside that tag count. |
| Boss vocabulary | 14 attack kinds: aimed, beam, charge, cross, fan, lingering, mines, rain, seekers, shockwave, spiral arms, summon, wall, and zones |
| Arsenal | 40 weapons across 9 runtime kinds; 11 evolutions; 15 fusions; 20 passives |
| Build/meta systems | 11 roads; 26 relics (8 attunable); 14 pacts; 10 keystones; 5 patrons; 18 rites (3 per hero) |
| Equipment and looks | 21 gear pieces in 4 categories; 65 cosmetics in 5 categories; 7 complete cosmetic sets; 6 rarity tiers |
| Long-term goals | 50 battle-pass levels; 22 achievements; 16 daily challenge templates; 16 run objectives; 9 permanent upgrades |
| Modes | Standard run, Daily Road, Rite Trial, Boss Rush (12 apex fights), and Weekly Ember |
| World encounters/dressing | 4 interactive Vigil Sites; 12 named formation encounters; 13 prop types; 4 structure styles; 4 biome themes; 11 generated structures per world by default |
| Presentation | 8 photo filters; photo mode; recap/share cards; 12 menu-tour steps; 11 screens grouped into 6 navigation sections |
| Difficulty | 3 difficulty tiers; 9 run modifiers/trials; 6 wave bands; 6 elite affixes |
| Cases | 6 coin-only cases: gear/cosmetic variants of Basic, Mystic, and Royal |

The numbers above are registry counts, not a claim that every item has equal
quality or player-facing clarity. In particular, 13 of 20 non-boss enemies still
share the default chase grammar, and the twelve bosses share a broad attack
toolbox even when their names and parameters differ.

### Current run and engine shape

- The logical canvas is 1920x1080 in a 7200x4050 world. Dynamic pixel ratio can
  step from 2.0 down to 0.7.
- Normal wave bands begin at 0, 60, 120, 180, 240, and 300 seconds. Twilight is
  around nine minutes; hypergrowth now starts at twenty minutes and rises by
  1.4x per minute.
- The enemy cap is 180. Particles have a hard 220-slot budget. Player
  projectiles use a pool that starts at 384 but can grow without a hard live
  cap; the old planning shorthand of "about 220 projectiles" is not an enforced
  limit.
- `src/systems/FrameSpatialIndex.js` supports projectile collision and enemy
  separation. `src/systems/ObstacleSystem.js` owns generated structures and
  spatial obstacle queries.
- `src/core/GameUpdate.js` has a consolidated enemy scan, while combat, render, input,
  photo mode, and run state have been split out of the formerly monolithic
  `src/core/Game.js`. The split is real but incomplete: `src/core/Game.js` is
  still about 2,874 nonblank lines, `src/systems/MenuRenderer.js` about 4,138, and
  `src/systems/UISystem.js` about 3,098.
- Save data is validated into schema/version 9 and stored locally. There is no
  export/import UI, cloud sync, or server dependency.
- CI now syntax-checks modules, validates credited assets and boss kits, and
  runs a real-game headless smoke. GitHub Pages remains the deployment path.

### Progression, XP, cosmetics, and cases now

The current progression foundation is substantially stronger than the old
plans describe:

- The battle pass is permanent, offline, free, and non-monetized. Level 50
  requires 24,108 cumulative Vigil XP.
- A valid finished run reports four stable XP buckets: 60 Kindling; Endurance
  at 0.35 XP/second capped at 240; Hunt at `floor(8 * sqrt(kills))` capped at
  260; and Deeds capped at 520. Bosses, chests, waves, objectives, a campaign
  clear, Boss Rush, Daily Trial XP, and explicit Threat bonuses contribute
  transparently. Very short/empty runs are ineligible.
- Levels 10/20/30/40/50 deliver the five-piece Last Light cosmetic set.
  Post-level-50 Everflame progress converts each 1,000 overflow XP into 250
  coins rather than deleting progress.
- Cases show odds and per-case Rare+ pity. Pity caps are 16 opens for Basic, 12
  for Mystic, and 10 for Royal. A rarity roll prefers an unowned item of that
  rarity until its relevant pool is complete; later duplicates become coins.
  Defaults and pass-exclusive cosmetics are excluded from case pools.
- Cases and the optional Mines minigame use only earned virtual coins. There is
  no real-money purchase path. Mines nevertheless uses gambling presentation
  and a 0.93 payout factor; that is an all-ages/trust decision, not merely a
  balance detail.

What is still missing is not another currency. It is clearer collection routing,
per-hero outfit convenience, accessible case presentation, and evidence that the
current time-to-level-50 and coin economy feel rewarding across real playtests.

### Audio now

The delivered audio engine is a mobile-aware hybrid Web Audio system:

- tactile UI/combat one-shots use curated CC0 Kenney samples with synthesized
  fallbacks;
- the menu rotates three original tracker compositions and one optional
  streamed CC0 feature without decoding the 3.7 MB master into memory;
- each of the four biomes has two distinct compositions, while four boss suites
  are mapped semantically across all twelve bosses;
- `MusicDirector` turns the consolidated combat snapshot into Calm, Hunt,
  Swarm, Onslaught, Boss, and Boss Final scenes with fast attack, slow release,
  and hysteresis;
- bar-quantized transitions and independent bed, motion, swarm, and apex layers
  make pressure changes musical instead of simply louder;
- four short Higgsfield-generated boss lines are lazy-loaded, duck the score,
  and return their exact transcript for captions;
- a limiter, music-only filter, pause gate, transient-graph cleanup, scheduler
  catch-up ceiling, voice cap, and recoverable async audio unlock protect long
  playback across browsers and mobile devices.

Combat remains original code-authored tracker music by design. The recorded
menu feature and voice assets have explicit provenance and safe procedural or
silent fallback paths; no synchronized recorded combat stems are claimed.

### Enemy and boss behavior now

- Biomes already bias different enemy mixes. Special enemies include ranged,
  charge, support, bomb, summon, teleport, and split-on-death behavior.
- `WaveDirector` already models crowd pressure and kill relief. Regular trash
  flow changes during bosses, while boss support adds are separately budgeted.
- Houses are real collision structures, but the previous general enemy steering
  gate accidentally depended on boss-only timers. Non-bosses could therefore
  fail to steer, ranged enemies could stop behind line-of-sight cover, endpoint
  probes could miss thin walls, and a fixed spawn clearance could be smaller
  than the actual body.
- The twelve bosses have large authored kits and readable telegraphs, but attack
  selection historically allowed the shared toolbox to dominate their identity.
  Phase transitions, signature cadence, fair recovery windows, and owned-hazard
  cleanup are the right current focus.

### Accessibility/platform now

Shipped: touch joystick/buttons, safe-area layout, staged onboarding, volume
sliders, screen-shake toggle, damage-number toggle, particle toggle, and a
reduced-effects option. PR #186 additionally shipped a semantic/focusable Canvas,
keyboard menu focus and back paths, active keyboard/pointer/touch modality, OS-derived
reduced-motion defaults, keyboard Mines foundation, phone Settings, typed attention
badges, and deterministic input/accessibility receipts. A web-app manifest and icons
exist.

The four generated boss lines have exact captions, but this is not a general subtitle
system. Current branch-only A11-10 work adds save-safe 100/115/130 Combat HUD size,
high-contrast combat tells, and seven source-backed non-color status badges. It does
not provide global app/menu text scaling. Still missing: gamepad/remapping, general
subtitles and caption detail, independent voice volume, mono/low-hearing support,
vibration, complete device/AT/zoom proof, and the offline shell. No essential mechanic
depends on hearing a cue.

**2026-07-13 First Light foundation delta:**
[PR #186](https://github.com/QemmHD/2dgamerepo/pull/186) is merged and deployed at
`3ed29e0`; it closes the old “menu focus navigation and input gates do not exist” gap,
but it does not close full 1.1. A11-01–A11-14 in the
[development ledger](DEVELOPMENT_LEDGER.md) separate shipped foundations from the
remaining preference, tutorial/debrief, hierarchy, routing, device/AT, and convergence
work.

**2026-07-14 A11-10 branch delta:** the first preference slice is locally integrated
and validated, but not yet committed, merged, or deployed. Combat HUD scaling,
post-veil high-contrast warnings, source-backed non-color status badges, and dedicated
Accessibility Settings are in flight; mono/captions/voice/vibration and full First
Light convergence remain open. The development ledger owns exact counts and delivery
truth.

## 2. What changed since the older plans

### The Long Vigil delta

The state-of-game section in `MAJOR_UPDATE_PLAN.md` was accurate on 2026-07-02
but is stale as a current backlog. Its major claims now resolve as follows:

| 2026-07-02 concern | 2026-07-13 reality | Remaining work |
| --- | --- | --- |
| Runs collapse around 13 minutes | Hypergrowth moved to 20 minutes at a gentler 1.4x/min; evolution/fusion and draft work landed | Measure actual build completion and late-run readability; tune from cohorts, not comments |
| 6 weapons, about 4 behavior kinds | 40 weapons across 9 kinds, 11 evolutions, 15 fusions | Identity/balance pass; reduce visually redundant choices rather than add quantity |
| 16 trash enemies on 5 behaviors; global mix | 20 trash enemies, 7 tagged behavior groups, biome enemy mixes, hazards, lieutenants | Role composition, house tactics, and clearer counters |
| 3 roads | 11 roads | Improve discovery/route clarity before adding more |
| No onboarding and 9-tab dump | 12-step tour; staged unlocks; 11 screens grouped into 6 sections; PR #186 keyboard focus foundation | Controller focus, playable tutorial/debrief, text scaling, complete hierarchy/routing, short first-run comprehension tests |
| Battle-pass run receipt is dead | Post-run XP buckets, claims, milestones, migration, and Everflame are live | Pacing measurement, collection/source filters, reward-preview polish |
| Heirloom Cinders is a no-op | Starting-economy flow was repaired and all 9 permanent upgrades are surfaced | Make old upgrades more interesting at cap without breaking save IDs |
| `Game.js` is 4,119 lines | About 2,874 nonblank lines after update/render/input/combat/photo/run-state splits | Continue seam extraction only when a feature needs it |
| Obstacle queries allocate per enemy | Spatial obstacle/index work is GC-conscious and shared broadphase exists | Prove nav/collision at 180 bodies and cap unbounded projectile growth |
| Save version 7 is write-only | Validated version 9 with battle-pass migration | Fixture-tested historical migrations plus export/import and recovery |
| Deploy-only CI | Syntax, asset, progression, boss, navigation, deterministic-audio, headless game smoke, and PR #186 keyboard/reduced/phone receipt gates exist | Add historical save fixtures plus gamepad/remap/caption/device/AT convergence gates |

Most P0/P1 work from that plan is therefore shipped or evolved. The remaining
high-value pieces are save portability, full accessibility, measured load-time
work, smaller module seams, and experience quality over raw count.

### Twenty-update roadmap delta

`ROADMAP.md` explicitly called itself planning-only. It should remain an idea
bank, not be interpreted as a release log.

| Update | Status in current game |
| --- | --- |
| 1 REFORGED | **Partial:** major menu/art/feel, hero, wand, and boss-HUD work exists; the entire promised Blender animation arc is not proven complete. |
| 2 EMBERGLASS | **Shipped:** photo mode, filters, card compositor, recap/share paths. |
| 3 KINDLED | **Shipped in functional form:** Kindle ult, aimed blink/Focus, element combos, rites, attunement, Rite Trial, and touch controls exist. |
| 4 BOSSFORGE | **Mostly shipped:** 12 bosses, Boss Rush, Weekly Ember, projectile pool/grid, deterministic phase choreography, signatures, recovery openings, owned-entity cleanup, and telegraphs exist. Unique art and long-form balance still need acceptance. |
| 5 THE KINDLED TROOP | **Planned:** no FamiliarSystem or companion progression. |
| 6 UNDERTOW | **Planned:** no Descent mode, drowned family, or Tidewarden. |
| 7 THRESHOLDS | **Partial:** adaptive scene music and four boss-family suites now ship; 12 signature weather/monument/theme packages do not. |
| 8 GLOAMCALL | **Planned:** no playable Umbral element, Gloamwell, or sixth patron. |
| 9 WAYLIGHT | **Partial shipped foundation:** PR #185 delivered `VigilSiteSystem`, four interactive sites, a Gloam Beacon guardian event, and twelve formations; rescue, waystone, caravan, and a deeper Ruin Bell event remain. |
| 10 SEVENTH/EIGHTH WICKS | **Planned:** roster remains 6; no hero Chronicle chains. |
| 11 FORGEHEART | **Planned:** no fifth biome or three-boss forge family. |
| 12 CINDERS & SCRIPTURE | **Planned/partial art foundation:** no full Codex/Bestiary/archive progression. |
| 13 THE LAST HEARTH | **Planned:** no dual-target hearth-defense mode. |
| 14 LEDGER OF ASHES | **Partial:** records/share stats and save validation exist; graphs, splits, save export/import, and recovery UI do not. |
| 15 ASHBOUND | **Partial foundation:** difficulty and modifiers exist; no per-map Ash Rank ladder or Everburn seasons. |
| 16 NIGHTFALL CYCLES | **Planned:** no Rekindled NG+, cross-map remix cycle, or prestige shelf. |
| 17 SEALED STORM | **Partial foundation:** daily/weekly generators use local seeded logic and `Game.js` has begun splitting; no single simulation RNG, challenge codes, or Crucible composer. |
| 18 FORGEGRIP | **Partial shipped foundation:** touch, manifest, icons, reduced effects, active modality, semantic Canvas, and keyboard menu focus exist; gamepad, remaps, complete cross-screen/device proof, big text, vibration settings, and offline shell remain. |
| 19 EMBER RACE | **Planned:** no deterministic ghost/race trace pipeline. |
| 20 HEARTHHOLD | **Planned:** no personalized trophy camp. |

Decision: do not begin Updates 5, 6, 8, 10, 11, 13, 16, 19, or 20 during this
90-day roadmap. First prove that the current combat, presentation, and retention
loops deserve more content. Update 9 receives one deeper Ruin Bell expansion atop the
shipped Vigil Site/formation foundation only;
Update 17 receives only the deterministic foundation that improves testing and
shareability.

## 3. Delivered July experience overhaul

These systems establish the new baseline. The next roadmap phases should tune,
measure, and extend them instead of building a parallel replacement.

### Adaptive score and authored audio

`src/systems/MusicDirector.js` introduces a pure, testable pressure state with six scenes:
Calm, Hunt, Swarm, Onslaught, Boss, and Boss Final. Pressure weights active and
nearby enemies, elites, hostile projectiles, hazards, wave pressure, boss
health/phase, and low player health. It rises quickly, releases slowly, and uses
separate enter/exit thresholds to prevent musical flicker.

`src/core/GameUpdate.js` builds that state from the already-consolidated enemy
scan, so it does not add an O(N) pass at the 180-enemy cap. `AudioSystem`
consumes all six scenes through four independent musical layers, a music-only
filter, last-stand color, and bar-quantized score changes.

The catalog contains an original 16-bar A/B/C/D tracker with three menu
compositions, two compositions per biome, four boss suites mapped across the
twelve bosses, and a victory composition. One CC0 streamed menu feature and
four Higgsfield boss lines are consumed by the runtime, registered in both
human- and machine-readable credits, captioned where spoken, and protected by
procedural or silent fallback. Combat remains original procedural music by
design; no synchronized recorded combat stems are claimed.

### House-safe enemy navigation

`src/systems/EnemyNavigation.js` adds stateful swept-circle wall following without
global A* or per-frame route allocations. Changes in `src/entities/Enemy.js`,
`src/systems/ObstacleSystem.js`, and `src/systems/Spawner.js` apply it to all
moving enemies, make ranged units reposition for line of
sight, keep charger/bomber commits out of blocked lanes, improve thin-wall and
penetration correction, and use actual spawn body radius.

Current deterministic result:

- 55,090 checks;
- 176 generated house routes;
- a 180-body/600-frame stress scenario with 86,488 obstacle probes;
- less than 50 ms spent in probes in the latest local Node validation run.

The fresh browser gate also stages 185 live enemies at a generated house with
`DONE EXC:0`. Longer playtest coverage across all structure styles, low frame
rates, and mobile DPR tiers remains a tuning/soak task rather than a known
navigation defect.

### Boss choreography and payoff

`src/systems/BossChoreographer.js` adds deterministic phase-two four-move patterns for all
twelve bosses, round-robin selection among ready attacks, no consecutive repeat
of an attack or attack kind, a 0.9-second phase break, a forced signature
opener, move-specific planted recovery, and an exposed damage window. The UI
work surfaces phase break, casting move/progress, and opening state;
combat cleanup clears boss-owned bolts, hazards, and summons on death. Boss
support spawn clearance now uses the support type's actual radius.

Current validator result: all 12 apex kits telegraph; each pattern preserves
contrast, order, and signature; cooldown waiting and honest phase-transition
gates pass; and exposed recovery stays within bounds. Default, cast, phase, and
opening browser harness scenarios all report `DONE EXC:0`. Release still needs
human balance/playfeel sessions across all twelve fights and proof that boss
identity is perceptible without reading the move name; bespoke per-boss phase
cinematics are not part of this release.

### Validation delivered with the overhaul

1. `node --check` on every source/tool module.
2. Asset, progression, navigation, and boss validators all green.
3. Real-game headless smoke with `EXC:0` and a live swarm.
4. Fresh real-browser menu, 185-enemy house swarm, boss cast, and boss second-act
   scenarios with `DONE EXC:0`.
5. A rendered 52-cue offline reel with no silent cues or clipping, plus a live
   browser score probe that exercises Calm through Boss Final, quantized return
   to menu, exact voice captions, and graph disposal.
6. Every new external/AI asset has source, tool/model, license/rights note,
   modification note, and a procedural/silent fallback where appropriate.
7. Every spoken line has a caption. Independent voice volume becomes mandatory
   if voices expand beyond occasional nonessential flavor.

Still required as release-followup evidence: a 20-minute normal-run soak, one
complete Boss Rush, mobile-device listening, and human balance/playfeel sessions
across all twelve fights.

## 4. Product pillars and proposed decisions

### 4.1 Authored intensity, not permanent overload

The encounter and music curves should share one read-only pressure snapshot,
but pressure should not become a universal scalar that blindly accelerates
everything. The encounter director authors peaks and rests; the music reports
and reinforces them. A successful run contains anticipation and relief as well
as swarms.

Proposed pacing grammar for normal play:

`arrival -> hunt -> first surround -> recovery -> role-combo wave -> lieutenant -> recovery -> boss omen -> boss -> reward breath`

No scene should jump directly from Calm to Onslaught because a large off-screen
array exists. Nearby threats, hostile geometry, and the player's current room
matter more than total population.

### 4.2 Houses are tactical spaces

Houses should be readable temporary cover, not permanent immunity and not
collision traps. Small/mobile enemies may route through openings; ranged units
seek sight lines; chargers require a clear lane; large enemies pressure exits
or use clearly telegraphed siege behavior. Enemies must never silently clip
through intact walls to solve navigation.

### 4.3 Bosses teach, test, and yield

Every dangerous boss move needs a visible telegraph, a consistent counter, a
named/sonic identity, and a recovery answer. Difficulty should shorten safe
windows or combine already-learned shapes, not erase warning time. Phase two
should change the fight's grammar, not only its projectile count.

### 4.4 Progress without FOMO

Keep the battle pass permanent and free. Do not add another currency in this
window. New pass chapters, if built later, should be selectable/archiveable;
players should be able to finish an old track rather than lose paid or earned
progress to a calendar. Cosmetics remain visual; power stays in gear/upgrades
with clear sources.

### 4.5 Exciting cases without coercion

Case presentation can be dramatic while staying trustworthy: odds and pity
remain visible before opening, results are predetermined once purchased, a
Skip/Reveal action is always available, reduced-motion removes the reel, and
duplicate conversion is shown in the result receipt. No real money, no
near-miss manipulation, no fake countdown, and no exclusive gameplay power.

Contentious product decision: for an all-ages audience, replace the current
house-edge Mines presentation with a skill-based Forge Trial, or keep it clearly
optional and disconnected from achievements, the pass, and exclusive
cosmetics. The preferred option is replacement while preserving veteran coin
balances and statistics.

## 5. 0-30 days - The Living Score

### P0.1 Integrate and release the current pass

Owner seams: `MusicDirector -> AudioSystem`; `EnemyNavigation -> Enemy +
ObstacleSystem`; `BossChoreographer -> Enemy + UIStateBuilder + CombatResolver`.

Deliverables:

- finish all scene-to-mix behavior and quantized transitions;
- make boss phase/signature/recovery UI readable at normal and reduced effects;
- validate every structure style and enemy radius;
- clean boss-owned projectiles/hazards/summons on defeat and mode transitions;
- add the three new validators to CI, not just local scripts;
- reconcile audio/voice files with the asset registry and credits before merge.

Release gate:

- zero syntax/validator/headless-smoke failures;
- no navigation soft-lock in 100 deterministic structure seeds;
- no consecutive same boss attack ID or kind in a 100-commit simulation per
  boss;
- no more than two non-boss scene changes within any 10-second window;
- pause/resume, tab backgrounding, and browser audio unlock do not create a
  duplicate scheduler or audible click.

### P0.2 Create one EncounterSnapshot

Replace loosely duplicated pressure inputs with a small immutable snapshot
created after the consolidated enemy scan:

```text
active / nearby / contact-ring enemies
elite and role counts
hostile projectile and active hazard counts
wave pressure and authored beat
boss phase, health, cast, recovery
player health and recent damage
structure/indoors context
```

Consumers may read it; none may mutate it. `MusicDirector` translates it into
musical state. `WaveDirector` uses authored beat targets and role budgets.
HUD/debug displays it. This keeps audio reactive without letting music dictate
spawn counts and avoids another full enemy scan.

### P0.3 Audio acceptance and production pipeline

The in-engine tracker is the immediate solution; the content pipeline must make
it sustainable.

- Menu: three genuinely different pieces with distinct tempo, motif, and
  emotional purpose (hearth/rest, preparation, return/triumph).
- In game: two compositions per biome. Each has compatible Calm/Hunt/Swarm/
  Onslaught layers so transitions can occur on bar boundaries.
- Bosses: four map-family suites with twelve short boss identity motifs and a
  phase-two variation, rather than twelve unrelated full soundtracks.
- Last Stand: orchestration change only; never obscure low-health warnings.
- SFX: reserve spectral space for telegraphs; sidechain music under boss and
  player-critical cues.
- Voice: flavor only, short, captioned, cached lazily, and never required to
  identify an attack.

For every cue, record composer/tool, source project, generation prompt/model if
applicable, edit history, license/usage rights, loop points, target loudness,
and fallback. Higgsfield is appropriate for already-established visual/voice
production where rights are recorded; do not call a music asset "original" or
"licensed" merely because an AI service produced a file.

Suggested mix acceptance: approximately -16 LUFS integrated for long music
renders, true peak at or below -1 dBFS, no clipped sum at maximum SFX density,
and intelligible telegraphs at the default 70/80 music/SFX settings. These are
targets to measure on offline captures, not runtime magic numbers.

### P0.4 Instrument experience quality locally

Because this is a static, serverless game, add a private local QA trace and an
explicit Export QA JSON button in dev mode. Do not silently transmit player
data. Capture:

- frame-time percentiles and dynamic-DPR changes;
- encounter scene/pressure changes;
- enemy progress stalls and wall corrections;
- damage source, boss move, telegraph lead, and dodge outcome;
- run XP bucket/level changes and case outcome/pity/duplicate receipt;
- input method, focus loss, audio suspend/resume, and exceptions.

This trace is the evidence for 60-day balance work and later deterministic
challenge playback.

## 6. 31-60 days - Hunters at the Door

### P1.1 Enemy Ecology 2.0

Give each existing enemy a battlefield job and spawn compositions, not just an
individual update loop.

| Role | Existing candidates | Behavior target |
| --- | --- | --- |
| Frontline | slime, brute, zombie, skeleton, brawler, dreadhulk, juggernaut | Occupy approach lanes; heavy bodies pressure exits without stacking in one doorway |
| Flanker | bat, crawler, mite, speed demon, teleporter | Prefer open side arcs; periodically break a conga line; validate free landing space |
| Artillery | spitter | Maintain a useful range, relocate until line of sight is real, telegraph firing lane |
| Support | healer, shielder | Anchor a bounded squad, retreat from direct contact, never create indefinite invulnerability |
| Disruptor | charger, bomber, splitter | Charge only through a clear corridor; bombers predict but expose a safe escape; split children spawn in valid free space |
| Reinforcement | summoner | Visible cast, strict owned-add budget, tether/leash, and cleanup when owner/fight ends |

Composition rules:

- every wave beat has a frontline budget plus at most two high-salience roles;
- cap simultaneous healers/shielders/summoners/bombers independently of the
  global 180 cap;
- biome `enemyMix` remains the flavor prior, while the encounter composer
  chooses legal role packages;
- elites add one readable affix interaction, not arbitrary stacked affixes;
- kill relief creates a real 3-8 second breath when the pressure floor clears.

House rules:

- small bodies may use authored openings;
- ranged/support units prefer exterior firing/support positions unless a door
  route is valid;
- large bodies use perimeter pressure first;
- any siege/breach move must have a unique windup, damage only its owned target,
  and preserve at least one escape route;
- no teleport, split, summon, or boss support spawn may resolve inside a wall.

### P1.2 Boss identity pass

The delivered choreographer provides fair grammar. This phase gives each fight
a memorable rule:

- Vesperwing: gale lanes and dive repositioning;
- Gravemaw: quake timing and bramble-ring space control;
- Cacklemaw: gaze sweep versus drool-safe ground;
- Hoarfang: breath lanes and a readable pinwheel climax;
- Rimewarden: ice-lance lines and temporary wall geometry;
- Aurorath: comet rhythm into a phase-two beam;
- Mourndrift: blink misdirection followed by soul-rain cadence;
- Ossuar: bone lattice and grave-quake alternation;
- Nihagault: shrinking safe space through a bounded void mire;
- Cindermaw: moving lava-field choices, not permanent floor denial;
- Dunescourge: clear charge lanes through quicksand pressure;
- Solnakh: solar-lance finale with a generous learned counter.

Add one map-family arena treatment and one short musical motif per boss. Do not
add more boss HP to compensate for clearer openings. Track damage taken by move,
failed-dodge timing, phase duration, and off-screen hits in QA traces.

### P1.3 Existing upgrade modernization

Preserve the nine save keys and all veteran levels. Add a final-rank capstone
choice or milestone behavior to make old upgrades visible in play, without
creating a new currency or invalidating builds. Candidate directions:

- Greater Ember: one clearly cooldown-limited last-coal survival shield;
- Brighter Burn/Keen Ember: a visible, bounded payoff for sustained precision
  rather than another hidden multiplier;
- Quickstep: movement milestone that improves dash recovery, not top speed
  beyond the existing cap;
- Soulgleam/Wider Glow: periodic pickup/magnet quality-of-life, not exponential
  XP gain;
- Heirloom Cinders: an opening choice cache or shop interaction, not coins that
  disappear into bookkeeping;
- Second Sight/Forsake: better draft control with an explicit receipt.

Prototype these as mutually exclusive capstone choices first. Gate them on
clear tooltips, save migration fixtures, and a no-choice-dominates simulation.

### P1.4 Collection and battle-pass follow-through

- Add per-hero cosmetic presets while retaining the current global equipped
  values as migration defaults.
- Add Owned/Missing/Source/Set filters and a "how to obtain" route for every
  gear/cosmetic item.
- Show pass reward preview, claim state, next milestone, and the exact post-run
  XP receipt in one consistent component.
- Keep levels permanent. If a second chapter is authored, let the player select
  which chapter receives XP; never delete unfinished progress.
- Keep the current four XP buckets. Tune only after measuring valid runs; target
  roughly 35-55 ordinary successful runs to level 50, with level 2 arriving in
  the first meaningful run and no single mode required.
- Add Skip/Reveal and reduced-motion case modes. Keep odds, pity, item source,
  and duplicate conversion visible before/after every opening.
- Do not add a token, shard, dust, seasonal XP, or premium currency in this
  period.

### P1.5 Gamepad, mobile, and accessibility completion

- Poll the standard Gamepad API through the existing input composite; do not
  fork movement/combat logic.
- Extend the shipped keyboard hotspot navigation and persistent focus ring to
  gamepad/controller input without regressing keyboard, pointer, or touch.
- Support remapping, dead-zone calibration, aim sensitivity, aim-assist amount,
  and vibration off/low/full.
- Guarantee at least 44x44 CSS-pixel touch targets after safe-area scaling.
- Preserve the in-flight 100/115/130 Combat HUD size, post-veil high-contrast
  telegraphs, and source-backed color-plus-shape status cues. Finish general captions,
  independent voice volume, and a mono-audio-safe mix as separate verified slices;
  Combat HUD size does not claim global app/menu text scaling.
- Reduced effects disables nonessential flashes, camera impulse, case reel
  motion, and dense weather while retaining attack warnings.
- Test keyboard-only, gamepad-only, touch-only, and mixed-input handoff.

## 7. 61-90 days - The Living Road Slice

### P2.1 One deeper Waylight POI vertical slice

Extend the shipped `VigilSiteSystem`/formation seams and ship only one deeper polished
Emberwood event: the **Ruin Bell**. Do not recreate the four existing sites, Gloam
Beacon guardian flow, or twelve formation packs.

1. A generated structure exposes a valid interaction point and safe approach.
2. Ringing the bell shows a clear risk/reward contract and starts a 45-60 second
   authored encounter beat.
3. Enemy roles converge through valid routes; house walls remain authoritative.
4. The music enters a quantized event variation, not generic permanent
   Onslaught.
5. Completion grants a choice from existing rewards; failure ends cleanly and
   never traps the run.
6. The QA trace stores seed, structure style, role package, completion time,
   stalls, and frame-time percentiles.

Only after the Ruin Bell passes its gates should the same seam host waystones,
rescues, or caravans. This is the safest way to make houses feel alive without
starting the full Troop, Last Hearth, or Waylight epics simultaneously.

### P2.2 Deterministic simulation foundation

Add an injected `RunRng` for gameplay decisions while leaving purely visual
sparkle/noise nondeterministic. Audit spawn selection, elite/affix rolls,
upgrade drafts, chests, cases used inside a run, objectives, and POI setup.

- A seed plus content version must reproduce gameplay decisions.
- Daily Road/Rite Trial/Weekly Ember adapt to the shared API without changing
  existing records.
- Save no live PRNG object; save seed/version/cursor only where a resume feature
  actually needs it.
- Add a deterministic assertion comparing two headless runs' event logs.
- Generate a short challenge code containing seed, map, road, difficulty, and
  modifiers with checksum/version.

This foundation improves regression testing immediately. Ghost racing and the
full Crucible remain out of scope for the 90-day window.

### P2.3 Save portability and Codex minimum

- Export/import a checksummed JSON save with preview, explicit overwrite
  confirmation, and automatic pre-import backup.
- Maintain fixture migrations from representative historical versions through
  version 9 and the new schema.
- Add a small Codex shell that records encountered enemies/bosses, kills,
  counter hints, and cosmetic sources. Do not begin the full lore/archive reward
  tree until the data and layout prove useful.

### P2.4 Content decision gate

At day 90, pick exactly one next content lane from evidence:

- expand Waylight if the Ruin Bell materially improves replay/playtest demand;
- expand boss arenas if boss-specific comprehension and replay are the strongest
  response;
- build a fifth biome only if four-biome completion is healthy and current
  biomes are mechanically distinct;
- build Familiars/Descent only if retention data shows a new mode/companion is
  more valuable than polishing existing collection and difficulty tails.

Do not greenlight several large epics just because their old specs exist.

## 8. Module seams and dependencies

| Seam | Producer/owner | Consumers | Dependency rule |
| --- | --- | --- | --- |
| EncounterSnapshot | `GameUpdate` consolidated scan | Music, waves, debug HUD, QA trace | One immutable object/frame; no consumer rescans enemies |
| Musical policy | pure `MusicDirector` | `AudioSystem` scheduler/mixer | No DOM/Web Audio imports in policy; transitions quantized in audio layer |
| Enemy navigation | `EnemyNavigation` + `ObstacleSystem` probes | `Enemy`, `Spawner` | No global pathfinding allocation; physical collision remains authoritative |
| Enemy composition | data in `GameConfig`/maps, policy in `WaveDirector` | `Spawner` | Role quotas respect global cap and biome weights |
| Boss choreography | pure `BossChoreographer` | `Enemy`, boss UI, combat cleanup | Move choice is deterministic/testable; hazards/summons carry duel-owner tags |
| Progression math | `BattlePassSystem`, content registries | save and menu receipts | UI never duplicates reward/XP math; append-only IDs |
| Cosmetics/cases | cosmetic/gear registries + `CaseSystem` | boutique/shop/pass | Every item has source metadata; odds/pity use one source of truth |
| Input | existing composite + hotspot registry | game/menu | Gamepad/touch/keyboard normalize into the same actions |
| Simulation RNG | future `RunRng` | directors, drafts, rewards | Gameplay RNG injected; visual RNG separate |
| Save schema | `SaveSystem` | all persistent systems | Defaults + explicit migrations + fixture round trips; no save wipe |
| Performance | profiler + spatial indexes + caps | every high-count system | Feature cannot add an unbounded per-entity/per-projectile loop |

Critical dependency order:

```text
navigation + boss/audio release baseline
    -> EncounterSnapshot and QA trace
        -> enemy role composition and boss identity
            -> Ruin Bell POI
                -> deterministic challenge code

save fixtures
    -> per-hero cosmetic presets
    -> save export/import

input action normalization
    -> gamepad focus/remapping
    -> controller QA for every new screen/event
```

## 9. Metrics and release gates

These are local/QA metrics unless the player explicitly exports a trace.

| Area | Gate |
| --- | --- |
| Correctness | `node --check`; asset/progression/navigation/boss/audio validators; headless `EXC:0`; no missing referenced asset |
| Frame time | 60-fps target on desktop and representative mid-range mobile; p95 update+render <= 18 ms during a 180-enemy stress; no repeated >33 ms spikes caused by the new feature |
| Population | Keep the 180-enemy cap. Add a measured live player-projectile budget/adaptive fallback before intentionally increasing projectile density |
| Navigation | 100 seeded worlds x all 4 structure styles; 99.5% of motile enemies make goal progress within a rolling 3-second window when a route exists; zero wall-contained spawns after correction |
| Encounters | No unsupported role exceeds its sub-cap; a cleared peak produces a measurable 3-8 second relief beat; off-screen count alone cannot trigger Onslaught |
| Music | Quantized transitions with controlled tails; <=2 non-boss scene switches/10 s; no scheduler duplication after pause/tab/audio unlock; no clipped offline stress capture |
| Bosses | 100 commits/boss with no consecutive same ID/kind; every damaging move telegraphs; every signature has a recovery; owned entities clear on defeat |
| Progression | 276+ deterministic checks remain green; level-50 pacing target 35-55 ordinary successful runs; every reward resolves and every duplicate has a receipt |
| Cases | Odds/pity visible; skip available immediately; reduced-motion reveal under 0.5 s; no pass/achievement requires Mines or a case purchase |
| Save | Fixture migration and export/import round trip preserve currencies, unlocks, presets, BP fraction/overflow, pity, rites, records, and settings |
| Accessibility | Every menu/game action reachable keyboard-only and gamepad-only; 44x44 CSS-pixel touch targets; critical cues retain non-audio and non-color-only tells |
| Assets | Source/license/tool/model/modifications recorded; AI voice captioned; missing assets fall back; no uncredited file ships |

## 10. Deterministic coverage and next tests

Preserve the delivered gates, then add the remaining coverage in this order:

1. **Music policy (delivered baseline):** table tests cover empty/extreme floors,
   boss phase override, low health, hysteresis, attack/release smoothing, menu
   reset, suspended-context recovery, bounded scheduler catch-up, and graph
   cleanup. Next add a timestamped 10-minute scene-switch trace.
2. **Navigation properties (delivered baseline):** circle/rect/thin-wall probes,
   actual-radius spawn clearance, ranged LOS recovery, charger/bomber lane
   rejection, 176 generated house routes, and a 180-body stress run are covered.
   Next expand to a stable 100-seed fixture across every structure style.
3. **Boss simulation (delivered baseline):** every pattern ID resolves;
   telegraph/recovery, same-ID/kind rejection, phase-break/signature order, and
   owned-entity cleanup are checked. Next add full-fight damage/time traces.
4. **Encounter composition:** seeded role quotas, biome priors, support/add caps,
   kill relief, boss suppression, and invariant global cap.
5. **Progression/save:** preserve the existing 276 checks; add historical save
   fixtures, capstone migrations, per-hero cosmetic presets, case pity, and
   import corruption tests.
6. **Input/accessibility:** keyboard focus order, active modality, reduced-effects save
   inheritance, phone Settings, and receipt-bearing Home/Mines gates are delivered by
   PR #186. Scale/contrast/status coverage is in flight locally under A11-10. Next add
   gamepad/touch hybrid-device proof, dead-zone/remap persistence, captions/mono/voice/
   vibration, and manual device/assistive-tech review.
7. **Visual/browser matrix:** desktop menu, 185-enemy house swarm, boss cast,
   second act, full SFX reel, and live score lifecycle are covered. Add narrow
   mobile, notched safe area, 115/130% Combat HUD size, reduced effects, high contrast, and
   20-minute/Boss Rush/case/BP/Ruin Bell scenarios.
8. **Determinism:** same seed/content version produces the same gameplay event
   log; different visual randomness does not alter that log.

## 11. Risk register

| Risk | Why it matters | Control |
| --- | --- | --- |
| Procedural music still sounds synthetic | More arrangements can preserve the same timbre fatigue | Strong motifs/forms, better envelopes/samples where licensed, offline listening panels, optional authored stems later |
| Browser audio lifecycle | Autoplay, suspend/resume, tab throttling, and decode failure can duplicate or mute schedulers | One global unlock, idempotent scheduler, lazy decode, silence/synth fallback, lifecycle tests |
| Uncredited generated/streamed audio | Rights/provenance failure blocks release | Asset registry and credits are a hard gate; do not ship unused mystery files |
| Voice harms accessibility or repetition | Flavor can mask warnings and become tiring | Short rare lines, captions, independent voice control if expanded, no mechanical dependency |
| Navigation cost at 180 bodies | "Smart" AI can turn into O(N x obstacles) frame loss | Local swept probes, spatial index, stateful hysteresis, sub-cap expensive roles, profiler gate |
| House fix destroys cover fantasy | Perfect pursuit can make structures meaningless | Preserve openings/walls, role-specific tactics, telegraphed siege, at least one escape route |
| Boss clarity becomes easier but longer | HP inflation would punish learning | Keep/reduce HP where recovery adds uptime; tune via phase time and damage-source trace |
| Unbounded player projectiles | Large builds can outgrow pool and collision assumptions | Introduce live budget/merge/degrade policy before denser weapons/events |
| Save expansion breaks veterans | Cosmetics, capstones, RNG, and Codex all add state | Append-only IDs, defaults, explicit migrations, backup/export, fixture round trips |
| Too many currencies/chores | Retention systems can become work | No new currency; permanent/selectable pass; objectives reward normal play |
| Gambling presentation narrows audience | Coin-only Mines still models house-edge betting | Prefer skill-based replacement; never gate power/pass/cosmetics behind it |
| Accessibility arrives after layouts | Retrofitting focus/text scale is expensive | Gamepad/focus/text presets land before Ruin Bell/Codex screens |
| Roadmap scope expands again | Twenty old epics can consume polish capacity | One 30-day release at a time; next phase starts only after gates and playtest review |

## 12. Research basis

The implementation and roadmap use these references as design constraints, not
as substitutes for EMBERWAKE playtesting:

- [Audiokinetic: Creating interactive music](https://www.audiokinetic.com/en/public-library/2025.1.4_9062/?id=creating_interactive_music&source=Help)
  distinguishes vertical layers from horizontal playlist/segment structure and
  documents state-driven, cue-aligned music transitions.
- The [W3C Web Audio Recommendation](https://www.w3.org/TR/webaudio/) defines
  the browser audio graph, scheduling, streaming/media, and offline-rendering
  primitives used by the score and its tests.
- [Chrome's Web Audio autoplay guidance](https://developer.chrome.com/blog/web-audio-autoplay)
  explains why game audio must resume from user interaction; the persistent
  gesture recovery hook also covers later browser interruptions.
- Itay Keren's GDC talk,
  [Boss Up: Boss Battle Design Fundamentals and Retro](https://media.gdcvault.com/gdc2018/presentations/Keren_Itay_BossUp.pdf),
  treats telegraphing and player control over attacks as boss-fight fundamentals.
- [Designing for Difficulty: Readability in ARPGs](https://www.gamedeveloper.com/game-platforms/designing-for-difficulty-readability-in-arpgs)
  frames readable patterns and counterattack windows as the basis of fair
  difficulty; that directly informed named casts and exposed recovery.
- [Red Blob Games' A* introduction](https://www.redblobgames.com/pathfinding/a-star/introduction.html)
  notes that graph search alone does not solve object size, moving crowds,
  smoothing, or formations. At this game's sparse-obstacle 180-body scale, that
  supported measured local swept steering instead of per-enemy global A*.

## 13. Definition of a better experience at day 90

By day 90, a new player should hear multiple real compositions, understand why
the score changed, use any supported input to navigate the game, survive a house
because they read enemy roles rather than an AI failure, recognize each boss's
signature and opening, understand every point of post-run XP, dress each hero
without re-equipping a set, and share/replay a deterministic challenge.

A veteran should feel that the existing 40 weapons, 20 enemies, 12 bosses, 11
roads, 50 pass levels, and 65 cosmetics became more coherent and valuable. If
that is not true, adding a fifth biome or another hundred rewards would only
make the same problems larger.
