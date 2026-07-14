# EMBERWAKE — Shared Development Ledger

**Canonical handoff:** read this file before planning or editing; update status,
evidence, and next action in the same PR as the work.

**Last grounded:** 2026-07-13
**Main baseline:** [`da88450ce4b223c7866ab0498d9d88a635865da3`](https://github.com/QemmHD/2dgamerepo/commit/da88450ce4b223c7866ab0498d9d88a635865da3) — PR
[#185](https://github.com/QemmHD/2dgamerepo/pull/185)
**Active branch at grounding:** `agent/first-light-accessibility` at shipped `main`,
with an uncommitted 1.1 accessibility/input working tree
**Latest shipped feature commit:** [`53db829`](https://github.com/QemmHD/2dgamerepo/commit/53db829)
**Latest shipped ledger commit:** [`377ad9b`](https://github.com/QemmHD/2dgamerepo/commit/377ad9b)
**Current 1.1 feature commit / PR:** [`b06915e`](https://github.com/QemmHD/2dgamerepo/commit/b06915e) / draft [#186](https://github.com/QemmHD/2dgamerepo/pull/186)
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

**1.0.2 shipped boundary:** feature commit `53db829` and ledger commit `377ad9b`
were delivered by [PR #185](https://github.com/QemmHD/2dgamerepo/pull/185),
squash-merged to `main` as
`da88450ce4b223c7866ab0498d9d88a635865da3`. PR CI and post-merge `main` CI
passed, the Pages deploy passed, and a live smoke at
[qemmhd.github.io/2dgamerepo](https://qemmhd.github.io/2dgamerepo/) showed the
1280×720 game canvas, title, and Home screen.

**1.1 in-flight boundary:** A11 source and validators are committed and pushed on the
current feature branch in draft PR #186. Local and hosted evidence is recorded below,
but merge, Pages deploy, and deployed smoke slots are pending. Selected 1.0.2
captures remain under `docs/evidence/v1.0.2`; local/ignored artifacts alone do not
promote any A11 row to `[x] SHIPPED`.

| ID | Version | Category | Status | Grounded outcome and source anchors | Dependencies | Evidence / PR slot | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VH-01 | 1.0.1 | Health/UX/combat/save | `[x] SHIPPED` | Ten Vigil Health fixes: first-run menu, current tour, pause Restart/Leave confirm, modal safety, Weekly best, upgrade cap, slot safety, daily metric uniqueness, exact XP, wall-blocked hostile bolts. | None | PR [#184](https://github.com/QemmHD/2dgamerepo/pull/184); merge `9bb1ca2`; CI/Pages passed; [deployed main](https://qemmhd.github.io/2dgamerepo/) returned HTTP 200 with game canvas/title on 2026-07-13 | Keep historical fixtures green. |
| LV-01 | 1.0.2 | Houses/POIs | `[x] SHIPPED` | Four structure-anchored sites: Wayfarer Hearth, Ashen Archive, Keeper Cache, Gloam Beacon. `src/content/vigilSites.js`, `src/systems/VigilSiteSystem.js`, `src/core/GameUpdate.js`, `src/core/GameRender.js` | None for the shipped web tranche | Sites **179 OK**; integration **110 OK**; all-biome browser matrix `EXC:0`; durable [archive reward](evidence/v1.0.2/living-vigil-reward.jpg) and [Beacon clear](evidence/v1.0.2/living-vigil-beacon-clear.jpg); feature `53db829`, ledger `377ad9b`, PR [#185](https://github.com/QemmHD/2dgamerepo/pull/185), main `da88450`; PR/main CI, Pages, and live smoke passed | Preserve the site/integration fixtures; add phone Hearth/Cache and boss-interruption captures during the later world/accessibility pass. |
| LV-02 | 1.0.2 | Encounters/enemies | `[x] SHIPPED` | Twelve named tactical formations, three per current biome; deterministic scheduling and bounded placement; roaming clears count separately from Beacon guardians. `src/content/encounters.js`, `src/systems/EncounterDirector.js`, `src/systems/VigilTracker.js`, `src/core/CombatResolver.js` | None for the shipped web tranche | Encounters **534 OK**; tracker **60 OK**; integration **110 OK**; navigation **55,090 OK** including stress; boss/Lieutenant/Beacon arbitration covered; browser boss states `EXC:0`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Retain a fixed-seed encounter/boss interruption capture as a regression fixture; do not reopen the shipped scheduling rules without failing evidence. |
| LV-03 | 1.0.2 | Progression/Battle Pass | `[x] SHIPPED` | Additive `vigilSitesActivated`, `vigilSiteKindsMastered` (clamped 0–4), `encountersCleared`, and `guardianPacksDefeated`; direct run XP, transparent receipt, objectives/dailies, six achievements, and Waylight Regalia. `SaveSystem.js`, `BattlePassSystem.js`, `achievements.js`, `cosmetics.js`, `dailyChallenges.js`, `objectives.js` | None for the shipped web tranche | Progression **4,550 OK**; integration **110 OK**; [Battle Pass receipt](evidence/v1.0.2/battle-pass-waylight-included.jpg) reconciles `Waylight 84 included` to `+932 XP`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Add historical-main save fixtures to the long-lived recovery corpus while preserving the shipped additive ids. |
| LV-04 | 1.0.2 | Mines/Cases/economy | `[x] SHIPPED` | Coin-only 5×5/6-mine risk with 100/250/500/2,000 stakes, exact risk/payout/net, about-7% edge, five/hour cap; real case result centered with no manufactured near miss. `CaseSystem.js`, `MinigameOverlay.js`, `MenuRenderer.js` | Native distribution remains separately policy-gated | Gambling **644 OK** across four stakes and 93% target return; [Mines quote](evidence/v1.0.2/mines-transparent-quote.jpg) is `EXC:0`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Preserve the 644-check economy contract; add a durable case-landing capture and territory review before any native-store submission. |
| LV-05 | 1.0.2 | HUD/feedback | `[x] SHIPPED` | Site/encounter state, exact reward receipts, guardian state, and progress use the existing HUD/state builder without a second permanent panel. `HUDLayout.js`, `UIStateBuilder.js`, `UISystem.js`, `VigilTracker.js` | None for the shipped web tranche | HUD **1,069 OK across 36 scenarios**; tracker **60 OK**; browser touch/site/guardian/boss/swarm matrix `EXC:0`; durable [site reward](evidence/v1.0.2/living-vigil-reward.jpg) and [Beacon clear](evidence/v1.0.2/living-vigil-beacon-clear.jpg); feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Keep dense HUD fixtures green and add phone/reduced/high-density evidence through A11 rather than reopening 1.0.2. |
| LV-06 | 1.0.2 | CI/QA | `[x] SHIPPED` | Fourteen validators, expanded real-game matrix, main-only Pages deploy, deterministic Vigil/Mines/Pass states, and SFX reel probe are integrated in CI. | None | **14/14 validators**, syntax **144/144**, YAML/diff, browser matrix, audio continuity, navigation stress, and Blender **27/27** were green; PR and `main` CI passed; Pages deploy and live smoke passed; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450` | Keep the shipped gates green; review the four A11 validators and expanded harness as a separate 1.1 delta. |
| LV-07 | 1.0.2 | Menu clarity/color | `[x] SHIPPED` | Home says “Start your first run,” “Upgrades,” and “Survive about 15 minutes”; restrained accents distinguish support actions while the run CTA stays dominant. `src/systems/MenuRenderer.js` | None for the shipped web tranche | UX **74 OK**; durable [same-state menu comparison](evidence/v1.0.2/menu-clarity-comparison.jpg); menu/touch/Mines/Pass renders `EXC:0`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Treat this copy/accent baseline as shipped; finish focus, reduced-motion, phone, and zoom proof in A11. |
| LV-08 | 1.0.2 | Delivery | `[x] SHIPPED` | Living Vigil, fair-risk, HUD, and menu-clarity tranche is on `main` and deployed. | LV-01–LV-07 shipped | Feature `53db829`; ledger `377ad9b`; PR [#185](https://github.com/QemmHD/2dgamerepo/pull/185); squash merge `da88450ce4b223c7866ab0498d9d88a635865da3`; PR/main CI and Pages passed; [live smoke](https://qemmhd.github.io/2dgamerepo/) showed 1280×720 canvas/title/Home | 1.0.2 is closed; deliver the A11 tranche under its own reviewed commit, PR, hosted CI, deploy, and smoke evidence. |
| A11-01 | 1.1 | Semantic canvas/live status | `[~] IN FLIGHT` | Focusable Canvas application semantics, screen-aware labels/instructions, polite live region, and announcements for focus, actions, toasts, and wave events. `index.html`, `styles.css`, `src/systems/AccessibilityBridge.js`, `src/core/Game.js`, `src/core/RunState.js`, `src/systems/WaveDirector.js` | Assistive-technology review, integration, and delivery | Accessibility/input **193 OK**; real-browser Home Canvas focus, activation, and back path passed; feature `b06915e`, draft PR #186. Hosted CI/merge/deploy pending | Run a manual screen-reader/Voice Control spot check without declaring unsupported platform claims, then integrate and review the complete slice. |
| A11-02 | 1.1 | Menu/tour keyboard focus | `[~] IN FLIGHT` | Stable labeled hotspot keys, roving Tab/arrow focus, Enter/Space activation, Escape/back behavior, visible non-color focus, and a tour-only SKIP/NEXT focus scope. `AccessibilityBridge.js`, `GameInputActions.js`, `MenuRenderer.js`, `UIStateBuilder.js` | Cross-tab/tour browser sweep and delivery | Accessibility/input **193 OK**, including repeat suppression, modal Tab containment, orphan recovery, and the two-Enter first-run path; real-browser Home focus, activation, and back passed; harness modes are `EXC:0`; feature `b06915e`, draft PR #186 | Exercise every tab plus the guided tour in a real browser, preserve pointer activation, then submit for review. |
| A11-03 | 1.1 | Active modality/touch HUD | `[~] IN FLIGHT` | Keyboard, pointer, and touch modality reflect the latest real input; hybrid devices show touch controls only in touch mode and clear held touch state when switching away. `src/core/Input.js`, `src/core/GameRender.js`, `src/core/TouchButtons.js`, `src/systems/UIStateBuilder.js` | Hybrid-device runtime proof and delivery | Accessibility/input **193 OK**, including touch-to-keyboard switching and held-key repeat isolation; UX **74 OK**; harness modality modes are `EXC:0`; feature `b06915e`, draft PR #186 | Capture keyboard↔touch switching on a hybrid/phone path and verify no stuck joystick/button state before review. |
| A11-04 | 1.1 | Reduced-motion inheritance | `[~] IN FLIGHT` | Fresh/reset/corrupt profiles inherit `prefers-reduced-motion`; an explicit existing save stays authoritative. Menu decoration/transitions, case reveal, Mines shake/pop/pulse, and touch-button ready pulse become static while state remains readable. `SaveSystem.js`, `MenuRenderer.js`, `MinigameOverlay.js`, `TouchButtons.js` | Broader runtime state sweep and delivery | Save inheritance **20 OK**; Minigame accessibility **14 OK**; real-browser reduced Settings and case frames were byte-identical; reduced harness Mines is `EXC:0`. The pre-Game loading splash is not included in this claim; feature `b06915e`, draft PR #186 | Gate the loading splash/rotate presentation in a later motion-completeness pass; retain the reviewed menu/case/Mines/touch-button scope for this slice. |
| A11-05 | 1.1 | Keyboard Mines | `[~] IN FLIGHT` | Arrow-key 5×5 focus, Enter reveal, Space cash-out/continue, Escape close, spoken outcomes, keyboard help copy, and a high-contrast shape/outline focus indicator preserve the pointer/touch board. `Game.js`, `GameInputActions.js`, `MinigameOverlay.js`, `UIStateBuilder.js` | Full browser board flow and delivery | Minigame accessibility **14 OK**; Gambling **644 OK**; keyboard/reduced Mines harness is `EXC:0`; feature `b06915e`, draft PR #186 | Complete a real-browser safe-pick, cash-out, bust, and close flow with both keyboard and pointer before review. |
| A11-06 | 1.1 | Phone Settings | `[~] IN FLIGHT` | Dedicated landscape-phone Settings geometry uses readable three-column grouping, CSS-scale-aware 44 px minimum targets, concise labels, and complete gameplay/audio/help/save actions while desktop remains unchanged. `MenuRenderer.js`, `tools/validate-phone-settings.js` | Device/zoom review, hosted CI, and delivery | Phone Settings **855 OK across 6 layouts**, including emitted phone-only actions/labels; real-browser 844×390 and matched-state 667×375 captures are locally reviewed; the deterministic gate is wired into CI; feature `b06915e`, draft PR #186 | Complete the 200%/device sweep, retain the two phone captures as review evidence, then deliver through the A11 PR and deployed smoke gates. |
| A11-07 | 1.1 | Zoom resilience | `[~] IN FLIGHT` | Viewport metadata no longer disables browser zoom; Canvas focus remains visible and scale-aware layout paths retain their existing cover-fit behavior. `index.html`, `styles.css`, `MenuRenderer.js` | 200% zoom/five-viewport runtime proof and delivery | Accessibility/input **193 OK** proves only the viewport-metadata contract. Effective mobile pinch zoom remains unproven and is currently constrained by full-surface touch handling; feature `b06915e`, draft PR #186 | Resolve the touch-action/gesture ownership tradeoff, then run 100%/200% keyboard, Settings, and phone sweeps at five viewports; do not promote a mobile pinch-zoom claim before that proof. |
| A11-08 | 1.1 | Validators/CI/harness | `[~] IN FLIGHT` | Four new deterministic gates cover semantic/modality/focus, reduced-motion save inheritance, accessible minigame motion/focus, and phone Settings geometry/action coverage; CI and the real-game harness add receipt-asserted keyboard/reduced Home and Mines states. `.github/workflows/ci.yml`, `tools/validate-accessibility.js`, `tools/validate-accessibility-save.js`, `tools/validate-minigame-accessibility.js`, `tools/validate-phone-settings.js`, `tools/artshot/harness.html` | Review and delivery | Final local integration gate: **18/18 validators OK** on Node 22.23.1, syntax **149/149**, accessibility **193**, save **20**, minigame **14**, phone Settings **855**, UX **74**, and exact keyboard/reduced/focus/Mines harness receipts at `EXC:0`; hosted PR CI [run 29299835745](https://github.com/QemmHD/2dgamerepo/actions/runs/29299835745) passed including the receipt-bearing harness; feature `b06915e`, draft PR #186 | Mark the PR ready, merge, deploy, and smoke before marking any A11 row shipped. |

## Version implementation register

The scope counts below point to the roadmap’s counted inventories. Rows track
implementation epics; each epic contains multiple player-visible deliverables and must
link back to its acceptance metrics before shipping.

### 1.0 → 2.0 — The Living Vigil (46 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V1-UX | Menu/onboarding/accessibility | `[~] IN FLIGHT` | LV-07 shipped; A11 semantic/focus/motion/phone/zoom slice | Finish A11 browser/phone/zoom/AT proof, review, commit, PR, hosted CI and deploy; treat later attention/RGB work as a separate measured slice. | LV-07; A11-01–A11-08 |
| V1-INPUT | Input/platform | `[~] IN FLIGHT` | V1-UX focus semantics | Land and ship the active-modality, menu/tour keyboard, and keyboard Mines slice. Full gamepad support, remapping, glyph switching, disconnect recovery, safe-area tuning, and haptics remain planned and unclaimed. | A11-02; A11-03; A11-05 |
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

- [x] 1.0.2 feature/ledger commits, PR #185, full squash merge SHA, PR/`main`
      CI, Pages deploy, live URL/smoke, and reconciled baseline are recorded.
- [x] Active 1.1 row ids and player-visible outcomes are named (A11-01–A11-08).
- [x] Status is honest: LV-01–LV-08 are shipped; every A11 row remains `[~]`.
- [x] A11 source systems, dependencies, proof gaps, and bounded next actions are listed.
- [x] Current targeted evidence is recorded: accessibility **193**, save **20**,
      minigame **14**, phone Settings **855**, UX **74**, gambling **644**;
      the final local Node 22 validator boundary is **18/18 OK** with syntax **149/149**.
- [x] Real-browser Home focus/activation/back, byte-identical reduced Settings frames,
      and harness modality/Mines `EXC:0` are recorded without AT or phone overclaim.
- [x] The integrated Node 22 suite, syntax, YAML, diff, and receipt-bearing Home/Mines
      harness gates were re-run after concurrent edits settled.
- [ ] Record the five-viewport/200% zoom pass and manual AT spot check; keep effective
      mobile pinch zoom and pre-Game loading motion explicitly outside this slice.
- [x] Assign the 1.1 feature commit (`b06915e`) and draft PR (#186) slots.
- [x] Hosted PR CI run `29299835745` passed at the feature/ledger head.
- [ ] Assign merge, Pages deploy, and deployed smoke slots.
- [x] Full gamepad/remapping/glyph/disconnect/haptics support remains explicitly planned,
      not inferred from the keyboard/modality slice.
- [x] Residual risk and one next bounded action remain explicit in every A11 row.

## Immediate next-agent handoff

1. **Do not recreate or republish 1.0.2.** LV-01–LV-08 shipped through PR #185 at
   `da88450ce4b223c7866ab0498d9d88a635865da3`; preserve those fixtures as regression
   coverage and keep native territory/case evidence in its later policy gate.
2. **Preserve the current 1.1 feature branch.** A11 semantic Canvas, live announcements,
   menu/tour focus, active modality, reduced motion, keyboard Mines, phone Settings,
   and zoom changes must be reviewed as one integration surface until publication.
3. **Use the grounded local evidence.** Accessibility **193**, save **20**, minigame
   **14**, phone Settings **855**, UX **74**, gambling **644**, the final Node 22
   **18/18** boundary plus syntax **149/149**, real-browser Home focus/activation/back, byte-identical reduced
   Settings frames, and receipt-asserted harness keyboard/reduced/focus/Mines `EXC:0`.
   Re-run a gate when overlapping source changes; do not convert it into hosted proof.
4. **Close the remaining A11 gates.** Retain the reviewed 844×390 and 667×375 phone
   captures, record five viewports at 100%/200%, manual AT spot checks, syntax and diff;
   then review, commit, open a PR, pass hosted CI, merge, deploy Pages, and smoke the
   deployed build. Gamepad/remapping work remains a separate planned slice.

## Handoff history

| Date | Session/branch | Rows changed | Evidence | Next owner action |
| --- | --- | --- | --- | --- |
| 2026-07-13 | Roadmap expansion / `agent/living-vigil-content-update` | Created ledger; grounded VH-01 and LV-01–LV-08; planned V1–V9 registers through 10.0 | Main `9bb1ca2`, PR #184, working-tree source/validator anchors | Completed by the 1.0.2 delivery reconciliation below. |
| 2026-07-13 | Evidence/count audit / `agent/living-vigil-content-update` | Grounded LV-01–LV-08 evidence; added menu row; raised Shared Flame, Rekindling, and Living Chronicle to the 46-addition floor | Eight targeted validators exit 0: **7,220 total checks** (HUD includes 36 scenarios); durable evidence index at [v1.0.2](evidence/v1.0.2/README.md); full local gate green at that boundary | Completed by the 1.0.2 delivery reconciliation below. |
| 2026-07-13 | Draft publication / `agent/living-vigil-content-update` | Committed and pushed the verified 1.0.2 tranche; opened draft PR #185 | Feature `53db829`; ledger `377ad9b`; draft PR [#185](https://github.com/QemmHD/2dgamerepo/pull/185) | Completed by the 1.0.2 delivery reconciliation below. |
| 2026-07-13 | 1.0.2 delivery reconciliation / `agent/living-vigil-content-update` | Marked LV-01–LV-08 shipped and replaced draft delivery actions | PR #185; feature `53db829`; ledger `377ad9b`; squash main `da88450ce4b223c7866ab0498d9d88a635865da3`; PR/main CI and Pages passed; live 1280×720 canvas/title/Home smoke passed | Preserve shipped fixtures; execute A11 as a separate release tranche. |
| 2026-07-13 | 1.1 accessibility/input grounding / `agent/first-light-accessibility` feature branch | Added A11-01–A11-08; hardened repeat/modal/orphan focus behavior and CI receipts; updated V1-UX and V1-INPUT without claiming gamepad/remapping | Final Node 22 validators **18/18 OK**, syntax **149/149**; accessibility **193**, phone Settings **855**, UX **74**, minigame **14**; real-browser Home focus/activation/back; 844×390/667×375 phone Settings; byte-identical reduced Settings/case; exact harness keyboard/reduced/focus/Mines receipts at `EXC:0` | Pass hosted PR CI, merge, deploy, and smoke this foundation; keep zoom/AT/loading-motion completeness in flight. |
| 2026-07-13 | 1.1 draft publication / `agent/first-light-accessibility` | Committed and pushed the First Light foundation; opened draft PR #186 without promoting incomplete A11 rows | Feature `b06915e`; draft PR [#186](https://github.com/QemmHD/2dgamerepo/pull/186); local Node 22 gates and hosted PR CI run `29299835745` passed | Mark ready, merge, deploy Pages, live-smoke, then reconcile delivery truth. |
