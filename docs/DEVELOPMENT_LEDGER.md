# EMBERWAKE — Shared Development Ledger

**Canonical handoff:** read this file before planning or editing; update status,
evidence, and next action in the same PR as the work.

**Last grounded:** 2026-07-13
**Main baseline:** `9bb1ca2` — PR
[#184](https://github.com/QemmHD/2dgamerepo/pull/184)
**Active branch at grounding:** `agent/living-vigil-content-update`
**Product roadmap:** [Ten Fires Roadmap](VERSION_ROADMAP_1_TO_10.md)

This ledger answers four questions for the next Codex or Claude session: what is
actually shipped, what exists only on a working branch, what proof is missing, and
what exact action should happen next. The roadmap owns product intent and scope; this
file owns execution truth.

## Status and evidence contract

| Marker | Meaning | May be used when… |
| --- | --- | --- |
| `[x] SHIPPED` | On `main` and deployed | Commit/PR, required validators, real-game capture, and post-deploy smoke are recorded. |
| `[~] IN FLIGHT` | Code or asset exists off-main | Files are present, but one or more integration/validation/review/merge/deploy gates remain. |
| `[>] NEXT` | Approved immediate work | Dependencies are green and the next bounded implementation slice is named. |
| `[ ] PLANNED` | Roadmap commitment only | No implementation claim; discovery and dependencies may still change the approach. |
| `[?] VERIFY` | Existing behavior needs proof | Do not rewrite until runtime/source evidence decides whether it is broken. |
| `[!] BLOCKED` | Cannot progress safely | Blocker, owner/authority needed, and unblock condition are recorded. |
| `[-] CUT` | Deliberately removed from scope | Decision and replacement/fallback are recorded; never silently delete a row. |

Evidence is cumulative, not interchangeable:

1. **Source:** exact files/symbols and additive save/content ids.
2. **Logic:** targeted validator plus syntax and relevant repository suites.
3. **Runtime:** real game state, not a mock; screenshot/video and `EXC:0` where visual.
4. **Stress:** entity/audio/memory/input/network/device tier proportional to risk.
5. **Delivery:** commit, PR, squash merge, deployed-main smoke, branch reconciliation.
6. **Policy:** store/accessibility/privacy/economy claim reviewed against linked official
   source when the release crosses that boundary.

Do not mark `[x]` because a file exists or a validator was written. Do not use a roadmap
sentence as implementation evidence. Put links/paths in the Evidence slot; if proof is
pending, leave the row `[~]` and name the next command or test.

## Current delivery snapshot

**Pre-PR evidence boundary:** every LV result below was produced locally from the
working tree based on `9bb1ca2`; none is hosted-CI, merged-main, or deployed proof yet.
Selected current captures are promoted under `docs/evidence/v1.0.2`; remaining `__out`
artifacts are local/ignored and cannot support `[x] SHIPPED` by themselves.

| ID | Version | Category | Status | Grounded outcome and source anchors | Dependencies | Evidence / PR slot | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VH-01 | 1.0.1 | Health/UX/combat/save | `[x] SHIPPED` | Ten Vigil Health fixes: first-run menu, current tour, pause Restart/Leave confirm, modal safety, Weekly best, upgrade cap, slot safety, daily metric uniqueness, exact XP, wall-blocked hostile bolts. | None | PR [#184](https://github.com/QemmHD/2dgamerepo/pull/184); merge `9bb1ca2`; CI/Pages passed; [deployed main](https://qemmhd.github.io/2dgamerepo/) returned HTTP 200 with game canvas/title on 2026-07-13 | Keep historical fixtures green. |
| LV-01 | 1.0.2 | Houses/POIs | `[~] IN FLIGHT` | Four structure-anchored sites: Wayfarer Hearth, Ashen Archive, Keeper Cache, Gloam Beacon. `src/content/vigilSites.js`, `src/systems/VigilSiteSystem.js`, `src/core/GameUpdate.js`, `src/core/GameRender.js` | Hosted CI, durable review proof, and delivery | Sites **179 OK**, including standard-run rotation, account-independent Daily/Rite seeds, full-pack capacity gating, and retryable 0/1/2-slot rejection; integration **110 OK**; 20/90-second plus all-biome browser matrix is `EXC:0`; durable [archive reward](evidence/v1.0.2/living-vigil-reward.jpg) and [Beacon clear](evidence/v1.0.2/living-vigil-beacon-clear.jpg) receipts are `EXC:0`; PR pending | Publish, then add phone captures of Hearth/Cache and the boss-interruption state to the next accessibility evidence pass. |
| LV-02 | 1.0.2 | Encounters/enemies | `[~] IN FLIGHT` | Twelve named tactical formations, three per current biome; deterministic scheduling and bounded placement; roaming clears count separately from Beacon guardians. `src/content/encounters.js`, `src/systems/EncounterDirector.js`, `src/systems/VigilTracker.js`, `src/core/CombatResolver.js` | Hosted CI and delivery | Encounters **534 OK**; tracker **60 OK**; integration **110 OK**; navigation **55,090 OK** including 180-body/86,488-probe stress; same-frame boss/Lieutenant/Beacon arbitration, kill-on-boss-due reward ownership, sub-minimum placement aborts, and aborted-pack marker retirement covered; 90-second, boss, and boss-kill browser states are `EXC:0`; PR pending | Publish; retain a fixed-seed encounter/boss interruption capture as a post-merge regression fixture. |
| LV-03 | 1.0.2 | Progression/Battle Pass | `[~] IN FLIGHT` | Additive `vigilSitesActivated`, `vigilSiteKindsMastered` (clamped 0–4 on load and write), `encountersCleared`, and `guardianPacksDefeated`; direct run XP, transparent Battle Pass receipt, objectives/dailies, six achievements, and five-piece Waylight Regalia. `SaveSystem.js`, `BattlePassSystem.js`, `achievements.js`, `cosmetics.js`, `dailyChallenges.js`, `objectives.js` | Hosted CI and delivery | Progression **4,550 OK**; integration **110 OK**; legacy/tampered normalization and reward boundaries covered; durable [Battle Pass receipt](evidence/v1.0.2/battle-pass-waylight-included.jpg) shows `Waylight 84 included` within Deeds and reconciles to `+932 XP`; PR pending | Publish, then add historical-main save fixtures to the long-lived recovery corpus. |
| LV-04 | 1.0.2 | Mines/Cases/economy | `[~] IN FLIGHT` | Coin-only 5×5/6-mine risk with 100/250/500/2,000 stakes, exact next-tile odds/payout/net, disclosed about-7% edge (integer payouts vary slightly), five/hour cap; real case result centered with no manufactured near miss. `CaseSystem.js`, `MinigameOverlay.js`, `MenuRenderer.js` | Distribution review before any native release; hosted CI and delivery | Gambling **644 OK** across four fixed stakes, exact input/refund/return boundaries, and 93% target theoretical return; durable [Mines quote](evidence/v1.0.2/mines-transparent-quote.jpg) shows exact next-pick math and current `ABOUT 7%` copy with `EXC:0`; PR pending | Publish; add a durable real case-landing capture and native territory review before store submission. |
| LV-05 | 1.0.2 | HUD/feedback | `[~] IN FLIGHT` | Site/encounter state, exact reward receipts, guardian state, and progress use the existing HUD/state builder without a second permanent panel. `HUDLayout.js`, `UIStateBuilder.js`, `UISystem.js`, `VigilTracker.js` | Hosted CI, durable review proof, and delivery | HUD **1,069 OK across 36 scenarios**; tracker **60 OK**; tactical clear names `24 XP · 15 coins dropped`; browser touch/site/guardian/boss/swarm matrix is `EXC:0`; durable [site reward](evidence/v1.0.2/living-vigil-reward.jpg) and [Beacon clear](evidence/v1.0.2/living-vigil-beacon-clear.jpg) captures are `EXC:0`; PR pending | Publish, then retain phone/reduced-effects/high-density screenshots in the 1.1 accessibility evidence set. |
| LV-06 | 1.0.2 | CI/QA | `[~] IN FLIGHT` | All fourteen validators and an expanded real-game matrix are wired into `.github/workflows/ci.yml`; Pages now deploys from `main` only; deterministic Vigil/Mines/Pass states and the SFX reel probe cover the new paths. | Hosted CI and delivery | **14/14 validators OK** under Node 26 and CI-matching Node 22; syntax **144/144**; progression **4,550**, integration **110**; YAML and `git diff --check` pass; browser all-biome/house/Vigil/touch/menu/Mines/boss matrix is `EXC:0`; audio: 52/52 cues, peak 0.384, 0 clips, 180-second continuity and suspend/resume pass; Blender 5.1.2 regenerated **27/27**, all validations pass; PR pending | Open the PR, pass hosted CI, squash-merge, smoke Pages, and reconcile the branch. |
| LV-07 | 1.0.2 | Menu clarity/color | `[~] IN FLIGHT` | Home copy now says “Start your first run,” “Upgrades,” and “Survive about 15 minutes”; restrained blue/orange/neutral accents distinguish supporting actions while the run CTA stays dominant. `src/systems/MenuRenderer.js` | Hosted CI, durable exact-comparison review proof, and delivery | UX **74 OK**; durable [same-state menu comparison](evidence/v1.0.2/menu-clarity-comparison.jpg); every menu tab, touch HUD, Mines, and Pass receipt render `EXC:0`; PR pending | Publish; complete keyboard-focus/reduced-motion/grayscale evidence in the 1.1 accessibility tranche. |
| LV-08 | 1.0.2 | Delivery | `[>] NEXT` | Living Vigil, fair-risk, HUD, and menu-clarity tranche is not shipped until merged and deployed. | LV-01–LV-07 locally green; durable evidence indexed | Commit/PR/merge/deploy slots empty | Stage only intended files, commit/push, open draft PR, pass CI, squash merge, smoke Pages, then reconcile the branch. |

## Version implementation register

The scope counts below point to the roadmap’s counted inventories. Rows track
implementation epics; each epic contains multiple player-visible deliverables and must
link back to its acceptance metrics before shipping.

### 1.0 → 2.0 — The Living Vigil (46 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V1-UX | Menu/onboarding/accessibility | `[~] IN FLIGHT` | LV-07; shared hotspot/action semantics | Ship the current plain-language/accent slice, then complete 1.1 keyboard focus, phone layouts, attention/RGB budget, and reduced motion. | LV-07 |
| V1-INPUT | Input/platform | `[ ] PLANNED` | V1-UX | Unify modality, gamepad, remap, glyph, disconnect, safe area and haptics. | — |
| V1-ECO | Cases/Mines/upgrades | `[~] IN FLIGHT` | LV-04 | Finish quote/receipt/economy tests, then Forge Reserve and collection planner. | LV-04 |
| V1-PROG | Chapters/cosmetics/save | `[~] IN FLIGHT` | LV-03 | Ship Waylight set/stats, then permanent chapter shelf and export/recovery. | LV-03 |
| V1-TACTICS | Encounters/enemies/navigation | `[~] IN FLIGHT` | LV-02 | Ship formations, then role budgets, door tactics and bounded stuck recovery. | LV-02 |
| V1-BOSS | Boss choreography | `[ ] PLANNED` | V1-TACTICS collision truth | Rebuild one boss-family vertical slice: opener/phase/desperation/arena/scaling. | — |
| V1-WORLD | Houses/maps/POIs | `[~] IN FLIGHT` | LV-01 | Ship four sites, then one modular house + six-event POI vertical slice. | LV-01 |
| V1-HUD | Combat readability | `[~] IN FLIGHT` | LV-05 | Close dense HUD/site/pack feedback gates, then death-source/goal receipts. | LV-05 |
| V1-AUDIO | Adaptive score/mix | `[~] IN FLIGHT` | Stable event vocabulary | Preserve the shipped 3 tracker menus + recorded feature, 2 songs/biome and 4 boss suites; extend the green 180-second continuity/suspend proof to the planned 30-minute device soak. | PR #183; LV-06 |
| V1-ART | Heroes/bosses/houses | `[ ] PLANNED` | Gameplay silhouettes/collision measured | Produce one deterministic Blender batch and contact-sheet/runtime proof. | — |
| V1-OFFLINE | PWA/native candidate | `[ ] PLANNED` | V1-UX/V1-INPUT/V1-AUDIO/save portability | Service worker/update rollback, adapters, Capacitor candidate and store-policy matrix. | — |
| V1-SHIP | 2.0 convergence | `[ ] PLANNED` | All V1 epics | Run 20 external first sessions and 2.0 cross-pillar ship gate. | — |

### 2.0 → 3.0 — The Shared Flame (46 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V2-DET | Determinism/Crucible | `[ ] PLANNED` | 2.0 simulation/save seams | Named RNG proof for one Standard seed before code format. | — |
| V2-GHOST | Ember Race/records | `[ ] PLANNED` | V2-DET | Bounded local trace prototype with zero gameplay authority. | — |
| V2-FAMILIAR | Companions | `[ ] PLANNED` | Entity/input budgets | One commandable familiar graybox and 180-body stress. | — |
| V2-CAMP | Keeper’s Camp | `[ ] PLANNED` | Stable collection/pack ids | Data-only hearth vertical slice; Start always one action away. | — |
| V2-COUCH | Two-Keeper | `[ ] PLANNED` | Gamepad + V2-FAMILIAR budget | Two-body shared-camera graybox; decide full co-op vs commander fallback. | — |
| V2-CHAPTER | Archive Chapters | `[ ] PLANNED` | 1.2 permanent shelf | One chapter switch/catch-up/weather/boss/camp-set slice. | — |
| V2-PACK | Content packs/DLC | `[ ] PLANNED` | Stable ids/save export | Manifest install/remove/missing-pack fixture before content production. | — |
| V2-WORLD | Undertow/Waylight/Prelude | `[ ] PLANNED` | V2-PACK + content gates | Build UNDERTOW map/faction/boss/POI vertical slice. | — |
| V2-ROSTER | Heroes/mastery | `[ ] PLANNED` | Gap analysis + art contract | Prototype one hero only after measured playstyle gap. | — |
| V2-SOCIAL | Profiles/Hearth Bundles/share | `[ ] PLANNED` | Save portability + adapter layer | Four-profile isolation and bundle preview/rollback fixture. | — |
| V2-AUDIO | Shared-Flame score | `[ ] PLANNED` | New map/faction identities | One map/faction/boss/camp adaptive suite and rights ledger. | — |
| V2-SHIP | 3.0 convergence | `[ ] PLANNED` | All V2 epics | Determinism, couch, pack removal, chapter permanence and offline ship gate. | — |

### 3.0 → 4.0 — The Rekindling (46 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V3-EXP | Ember Pilgrimage | `[ ] PLANNED` | Determinism, packs, crash-safe save | Three-node expedition graybox with quiet checkpoint restore. | — |
| V3-OATH | Wounds/Oaths/reforge | `[ ] PLANNED` | V3-EXP state schema | One scar, one Oath and one previewed deterministic recipe. | — |
| V3-FORGE | Forgeheart world | `[ ] PLANNED` | Pack/world/art/audio gates | One slag/bellows/anvil map slice and multi-level house navigation proof. | — |
| V3-FACTION | Cooperative enemy factions | `[ ] PLANNED` | 1.3 roles + EncounterDirector | Shield/artillery/flusher formation with director rejection rules. | — |
| V3-BOSS | Memories/apex/finale | `[ ] PLANNED` | Boss identity gate + V3-FORGE | One boss Memory that changes signature/arena/phase, plus practice lab. | — |
| V3-CYCLE | Rekindled NG+ | `[ ] PLANNED` | Complete authored finale | Cycle-I remix simulator with bounded multipliers and cosmetic-only prestige. | — |
| V3-CHRON | Chronicle/story/localization | `[ ] PLANNED` | Stable ids and string schema | One sourceable enemy/boss/map/music entry and text-expansion fixture. | — |
| V3-ECO | Endgame economy/collection | `[ ] PLANNED` | Case/upgrade cohort data | Blueprint completion and fixed high-stakes-table simulation; no required wager. | — |
| V3-ENGINE | Fourth-Fire engine | `[ ] PLANNED` | Profiling evidence | Extract one seam only after replay/save/cap test proves current pain. | — |
| V3-SHIP | 4.0 convergence | `[ ] PLANNED` | All V3 epics | Fresh expedition, Cycle III, 200%-text, recovery and 60-minute soak. | — |

### 4.0 → 5.0 — The Wider Dark (48 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V4-ATLAS | Atlas/menu/route UX | `[ ] PLANNED` | 4.0 destination ids | Launch/compare/mastery prototype with 3-action and attention-budget test. | — |
| V4-MAPS | Four destinations | `[ ] PLANNED` | Atlas + pack gates | Cinder Coast map grammar before producing the other three. | — |
| V4-FACTIONS | Four factions/bosses | `[ ] PLANNED` | Encounter/faction/boss gates | Saltworn + Beacon Leviathan vertical slice. | — |
| V4-WORLD | Weather/interiors/outposts | `[ ] PLANNED` | Shared collision/nav/state schema | One forecast, one enterable house and one outpost save fixture. | — |
| V4-MODES | Apex Hunt/Nightfall Siege | `[ ] PLANNED` | V4-WORLD objectives | Graybox both modes on one existing and one new map. | — |
| V4-BUILD | Arsenal/Atlas progression | `[ ] PLANNED` | Build simulator and source UI | One weapon/evolution/weather interaction with cap text. | — |
| V4-ECO | Collection/store/Mines inflation | `[ ] PLANNED` | Long-cohort economy evidence | Decide high-stakes need from simulation; never wallet-auto-scale. | — |
| V4-AUDIO | Wider Score/presentation | `[ ] PLANNED` | New map identity | Cinder Coast exploration/faction/boss stem suite. | — |
| V4-DISPATCH | Offline signed challenges | `[ ] PLANNED` | Determinism/signing/cache | Signed/tampered/expired-static-manifest prototype. | — |
| V4-SHIP | 5.0 convergence | `[ ] PLANNED` | All V4 epics | 12-destination Hunt/Siege/outpost/interior ship gate. | — |

### 5.0 → 6.0 — The Maker’s Forge (54 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V5-SCHEMA | Forgebook/EmberPack core | `[ ] PLANNED` | Stable content schemas | Round-trip one handwritten pack before visual editor work. | — |
| V5-WORLD | Map/house/POI editors | `[ ] PLANNED` | V5-SCHEMA + validators | One teaching map created without source edits. | — |
| V5-COMBAT | Encounter/Boss editors | `[ ] PLANNED` | Public director/choreography seams | Formation + two-phase boss preview and stress. | — |
| V5-BUILD | Arsenal/Rule editors | `[ ] PLANNED` | Data-driven behaviors and sim | One bounded weapon and mode clause through public templates. | — |
| V5-STORY | Chronicle/score/look editors | `[ ] PLANNED` | String/audio/art provenance schema | One captioned story node and licensed stem graph with fallbacks. | — |
| V5-VALIDATE | Sandbox/perf/accessibility | `[ ] PLANNED` | All editor schemas | One-click gate report linked to exact invalid node. | — |
| V5-SHARE | Codes/files/curated shelf | `[ ] PLANNED` | Signing, import preview, rollback | Tamper/dependency/conflict/removal fixtures. | — |
| V5-MODE | Creator Trial/teaching | `[ ] PLANNED` | Editors stable | Six lesson prototype and unchanged-manifest scoring. | — |
| V5-SHOWCASE | Glasswright official pack | `[ ] PLANNED` | Public tools feature-complete | Regenerate shipped showcase without private escape hatch. | — |
| V5-SHIP | 6.0 convergence | `[ ] PLANNED` | All V5 epics | 25 outside creator journeys and complete offline/safety gate. | — |

### 6.0 → 7.0 — The Living Chronicle (46 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V6-STORY | Five-act campaign/choices | `[ ] PLANNED` | Expedition + Chronicle + Maker schemas | One act with three choices, recap, checkpoint and replay. | — |
| V6-MAPS | Four story destinations | `[ ] PLANNED` | Pack/world gates | Ashen Capital district vertical slice. | — |
| V6-FACTIONS | Four factions/bosses | `[ ] PLANNED` | Faction/boss gates | Cinder Court + Crownless Regent counterplay slice. | — |
| V6-HERO | Four Keepers/bonds | `[ ] PLANNED` | Roster gap + art/audio pipeline | One hero and one gameplay-neutral bond route. | — |
| V6-PEOPLE | Residents/houses/state | `[ ] PLANNED` | Story state schema | One resident rescue changes one interior/camp state safely. | — |
| V6-MODES | Story Patrol/Nemesis/Explorer | `[ ] PLANNED` | Campaign content | Graybox duration/reward/no-shame parity. | — |
| V6-PROG | Chronicle progression/sets | `[ ] PLANNED` | Deterministic source contract | One story set earned without case/story lock. | — |
| V6-AUDIO | Cinematic score/voice/access | `[ ] PLANNED` | Story/hero identity | One skippable/replayable/captioned scene with reading controls. | — |
| V6-SHIP | 7.0 convergence | `[ ] PLANNED` | All V6 epics | Five-act branch/save/accessibility/offline campaign gate. | — |

### 7.0 → 8.0 — The Distant Hearth (54 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V7-THREAT | Network decision/threat model | `[ ] PLANNED` | Product/legal/privacy authority | Document data flow, service minimum, abuse/recovery and kill criteria first. | — |
| V7-NET | WebRTC/host authority | `[ ] PLANNED` | V7-THREAT + deterministic state | Loopback then 100 ms/1% loss two-player combat prototype. | — |
| V7-SESSION | Invites/reconnect/migration | `[ ] PLANNED` | V7-NET | Code/cancel/version mismatch/reconnect fixtures. | — |
| V7-MODES | Online quick/expedition | `[ ] PLANNED` | Reward receipts + checkpoints | Standard then Hunt, then Expedition; do not parallelize before truth. | — |
| V7-RAID | Four-player Concord Raid | `[ ] PLANNED` | Two-player soak and entity budget | One wing graybox with solo practice before finale production. | — |
| V7-SOCIAL | Pings/camps/Dispatch/records | `[ ] PLANNED` | Privacy/mute/block/signing | Invite-only camp and context-ping prototype; no open chat. | — |
| V7-CONTENT | Concord Gate/faction/apexes | `[ ] PLANNED` | Solo/2/3/4 scaling grammar | Map + Beaconless formation + first apex slice. | — |
| V7-ECO | Reward/economy safety | `[ ] PLANNED` | Host receipt ids + offline parity | Duplicate receipt/reconnect/abort adversarial tests; no trade or Mines online. | — |
| V7-ACCESS | Network access/cross-platform | `[ ] PLANNED` | V7-NET stable | Latency/effects/identity controls across web/iOS/Android. | — |
| V7-SHIP | 8.0 convergence | `[ ] PLANNED` | All V7 epics + external review | 50 invited sessions, privacy/security and full offline regression gate. | — |

### 8.0 → 9.0 — The Worldweave (48 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V8-LOOM | Finite world/territory/climate | `[ ] PLANNED` | Determinism + pack graph | 10,000-world terminating simulator before UI/content. | — |
| V8-MAPS | Four destinations | `[ ] PLANNED` | World graph + content gate | Prism Canopy map grammar vertical slice. | — |
| V8-FACTIONS | Four factions/bosses | `[ ] PLANNED` | Encounter/boss gates | Spectrum Kin + Cathedral Mantis slice. | — |
| V8-SETTLE | Settlements/residents/apexes | `[ ] PLANNED` | Bounded state transitions | One settlement choice and one roaming threat save/replay fixture. | — |
| V8-MODES | Worldweave/Frontier contracts | `[ ] PLANNED` | V8-LOOM | Six-node world and three-node shareable contract grayboxes. | — |
| V8-TACTIC | War Table/worldcraft | `[ ] PLANNED` | Simulation balance | One scout/ally/resource opportunity-cost decision and field recipe. | — |
| V8-PROG | Finite mastery/economy | `[ ] PLANNED` | Cohort simulation | One complete world reward path with no idle/daily/random-paid requirement. | — |
| V8-UX | Forecast/audio/accessibility | `[ ] PLANNED` | Climate truth | Text/shape/audio forecast and territory map at 200% text. | — |
| V8-SHARE | Solo/couch/online/offline/creator | `[ ] PLANNED` | World save ownership | Host-transfer/missing-pack/network-blocked convergence fixture. | — |
| V8-SHIP | 9.0 convergence | `[ ] PLANNED` | All V8 epics | 16-destination finite-world and 90-minute soak gate. | — |

### 9.0 → 10.0 — The Last Light (60 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V9-HOME | Clear-Flame Home/Mode Library | `[ ] PLANNED` | Complete mode metadata | Five-second hierarchy prototype with grayscale/RGB/motion/perf proof. | — |
| V9-STORY | Eversun/Citadel/finale | `[ ] PLANNED` | Living Chronicle + Worldweave callbacks | One capstone act and prior-state fallback matrix. | — |
| V9-FACTION | Lightless Crown/formations | `[ ] PLANNED` | Faction counterplay gate | One seven-role formation family and practice scenario. | — |
| V9-HERO | Four Keepers/ensemble | `[ ] PLANNED` | Final roster gap review | Prototype one measured signature and duo synergy. | — |
| V9-BOSS | Finale/Pantheon | `[ ] PLANNED` | Full boss identity audit | Identity matrix, then one remastered apex and finale phase slice. | — |
| V9-MODES | Marathon/Last Stand | `[ ] PLANNED` | Checkpoint/director/record proofs | Graybox duration, abort/resume, caps and deterministic receipt. | — |
| V9-LAB | Build Laboratory | `[ ] PLANNED` | Discovered-content ids and sim | One read-only test arena with no progression mint. | — |
| V9-PROG | Finite mastery/collection | `[ ] PLANNED` | Complete source graph | Find every power/random-pool dead end; add deterministic route. | — |
| V9-ECO | Cases/Mines/known content | `[ ] PLANNED` | 1,000-run cohort + platform matrix | Blueprint completion, reserve/receipt and exact Complete Edition manifest. | — |
| V9-ART | Definitive visual pass | `[ ] PLANNED` | 16-map/full-roster capture wall | Audit silhouette, anchor, palette, RGB, motion and telegraph drift. | — |
| V9-AUDIO | Definitive score/sound | `[ ] PLANNED` | Rights/source and all game states | Full state/motif matrix before recording/mastering. | — |
| V9-ACCESS | Accessibility/localization | `[ ] PLANNED` | Complete UI/mode list | Audit every Nutrition Label/WCAG claim and input at 200% text. | — |
| V9-PRESERVE | Saves/packs/replays/offline | `[ ] PLANNED` | Historical corpus and installer ownership | Clean-install/history museum/recovery rehearsal. | — |
| V9-ANTHOLOGY | Creator/community archive | `[ ] PLANNED` | Signed packs/rights/privacy | Select and validate one representative project before twelve. | — |
| V9-SHIP | 10.0 convergence | `[ ] PLANNED` | Every prior epic | 100 diverse playtests, zero P0/P1/save loss, definitive ownership proof. | — |

## Cross-cutting compliance and product gates

| Gate | Applies before | Required evidence |
| --- | --- | --- |
| Random rewards | Any Cases/store/native release | Exact odds and cost adjacent to action; centered real outcome; no fake near miss; earned-coin source; pity/duplicate/source receipt; Apple/Google policy review. |
| Youth/territory | Store distribution | Audience/age/territory matrix; Brazil Digital ECA review; deterministic catalog replacement where a random case is unsuitable. |
| Mines | Every economy change | Coin-only/no cash-out; fixed stakes; exact next risk/payout/net; 0.93 expected return simulation; five/hour; no loss-triggered UI; upgrade relevance cohorts. |
| Accessibility | Every visual/input/content release | Keyboard/touch/gamepad; VoiceOver/Voice Control claim proof where declared; 200% text intent; contrast/non-color; reduced motion; captions; mono; five viewports. |
| Responsiveness | Menu/HUD/native release | Visible response <100 ms for discrete UI; continuous feedback within one display refresh on defined tiers. |
| Privacy/social | Any share/network feature | Local/private default, data map, explicit consent, cancel/delete/block, no hidden telemetry, offline path, security review proportional to service. |
| DLC/packs | Any known-content sale | Exact manifest, stable ids, restore, install/update/remove/missing-pack fixtures; no random result, paid power, expiry, or base-save loss. |
| Art/audio/AI | Any generated/licensed asset | Rights/provenance row, deterministic translation or reproducible source, canonical style, fallbacks, contact sheet/mix soak, real runtime capture. |

Official references:

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
- [Google Play country requirements](https://support.google.com/googleplay/android-developer/answer/6223646?hl=en-GB)
- [FTC HoYoverse settlement announcement](https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental)
- [Apple Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/)
- [Apple Game Controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)
- [Apple Designing for Games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/)
- [Apple responsiveness guidance](https://developer.apple.com/documentation/xcode/improving-app-responsiveness)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C WebRTC](https://www.w3.org/TR/webrtc/)

## PR handoff checklist

Update this block’s facts in the affected rows; do not merely append prose.

- [x] Active row ids and player-visible outcome named (LV-01–LV-08).
- [x] Status is honest (`[~]` until main deploy smoke).
- [x] Source files/systems and stable save/content ids listed in active rows.
- [x] Dependencies, proof gaps, and next bounded actions recorded.
- [x] Targeted validator command/result recorded from the local working tree.
- [x] Relevant full suites, syntax and `git diff --check` recorded.
- [x] Available real-game state and local screenshot paths recorded; `EXC:0` where visual.
- [x] Save migration/caps, audio lifecycle/mix, navigation stress, touch render,
      fair-economy policy, and deterministic Blender gates recorded for this slice.
- [x] Phone/focus/reduced-motion captures and native territory review are explicitly
      assigned to later release gates and are not represented as 1.0.2 web ship proof.
- [ ] Commit, PR, merge SHA, deployed URL/smoke and reconciled branch recorded.
- [x] Residual risk is explicit and one next bounded action remains in every active row.

## Immediate next-agent handoff

1. **Do not recreate the feature slice.** The four sites, twelve formations, distinct
   tactical/guardian counters, direct XP/reward receipts, Waylight progression, fair
   Mines quote, HUD feedback, and clearer Home copy are integrated and their targeted
   validators are green on the working tree.
2. **LV-06 is locally green.** Do not repeat its Node 22/26, 14-validator, browser,
   audio, navigation, YAML, diff, or 27-frame Blender gates unless the source changes.
3. **Keep residual proof scoped honestly.** Phone/focus/reduced-motion, case-landing,
   and native territory evidence remains scheduled after this web tranche; it does not
   erase the green deterministic logic and real-game states recorded above.
4. **Execute LV-08 now.** Adversarially review/stage only intended files; commit and
   push `agent/living-vigil-content-update`; open the PR; pass hosted CI; squash-merge;
   smoke the deployed Pages build; reconcile/force-with-lease the branch. Only then
   replace `[~]` with `[x]` and fill commit, PR, merge, deploy, and durable evidence.

## Handoff history

| Date | Session/branch | Rows changed | Evidence | Next owner action |
| --- | --- | --- | --- | --- |
| 2026-07-13 | Roadmap expansion / `agent/living-vigil-content-update` | Created ledger; grounded VH-01 and LV-01–LV-08; planned V1–V9 registers through 10.0 | Main `9bb1ca2`, PR #184, working-tree source/validator anchors | Finish LV proof; publish 1.0.2; replace pending slots with PR/merge/deploy evidence. |
| 2026-07-13 | Evidence/count audit / `agent/living-vigil-content-update` | Grounded LV-01–LV-08 evidence; added menu row; raised Shared Flame, Rekindling, and Living Chronicle to the 46-addition floor | Eight targeted validators exit 0: **7,220 total checks** (HUD includes 36 scenarios); durable evidence index at [v1.0.2](evidence/v1.0.2/README.md); full local gate green, hosted/delivery gates pending | Execute the four-step immediate handoff above; do not claim shipped before PR, merge, deploy, and smoke. |
