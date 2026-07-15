# EMBERWAKE — Shared Development Ledger

**Canonical handoff:** read this file before planning or editing; update status,
evidence, and next action in the same PR as the work.

**Last grounded:** 2026-07-14
**Main baseline:** [`45f6216`](https://github.com/QemmHD/2dgamerepo/commit/45f62160cc2446d92e8c8bde220c491d5074fb77) — merged [PR #201](https://github.com/QemmHD/2dgamerepo/pull/201), the delivered phone Character truth correction
**Active branch at grounding:** `docs/collection-growth-ib-pr201-deploy` from `origin/main` at `45f6216`; this branch records the shipped PR #201 correction without promoting complete Collection Growth I, A11-13, full 1.1/1.6, the 1.0 → 2.0 arc, 2.0, or 2.8
**Latest shipped feature commit:** [`45f6216`](https://github.com/QemmHD/2dgamerepo/commit/45f62160cc2446d92e8c8bde220c491d5074fb77)
**Shipped ledger baseline before this tranche:** [`a34baca`](https://github.com/QemmHD/2dgamerepo/commit/a34bacafac2cd222e0a55c3e94545f6535a3acf2), the [PR #200](https://github.com/QemmHD/2dgamerepo/pull/200) Collection Growth I-B delivery; when this file is on `main`, its containing commit is the newer ledger truth
**1.1 foundation feature commit / PR:** [`b06915e`](https://github.com/QemmHD/2dgamerepo/commit/b06915e) / merged [#186](https://github.com/QemmHD/2dgamerepo/pull/186)
**Product roadmap:** [Ten Fires Roadmap](VERSION_ROADMAP_1_TO_10.md)

This ledger answers four questions for the next Codex or Claude session: what is
actually shipped, what exists only on a working branch, what proof is missing, and
what exact action should happen next. The roadmap owns product intent and scope; this
file owns execution truth.

## Status and evidence contract

| Marker | Meaning | May be used when… |
| --- | --- | --- |
| `[x] SHIPPED` | On `main` and deployed | Commit/PR, required validators, real-game capture, and post-deploy smoke are recorded. |
| `[~] IN FLIGHT` | Implementation exists but the full row is incomplete | One or more acceptance, integration, validation, device, policy, or delivery gates remain; partial foundations may already be on `main`. |
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

**1.1 foundation shipped boundary:** feature `b06915e` and its ledger commits were
delivered by [PR #186](https://github.com/QemmHD/2dgamerepo/pull/186), squash-merged
to `main` as `3ed29e072b6a5b8d5bd277eb8a3e30de6f6e60f3`. Both PR CI runs passed;
post-merge `main` CI [29299938429](https://github.com/QemmHD/2dgamerepo/actions/runs/29299938429)
and Pages [29299938437](https://github.com/QemmHD/2dgamerepo/actions/runs/29299938437)
passed. Live 667×375 and 1280×720 smoke verified the semantic Canvas, polite status,
keyboard focus/Run setup/back path, and zero browser logs.

**Full 1.1 remains in flight:** A11-08 and A11-09 are shipped. PR #188 shipped
A11-10's save-safe Combat HUD size presets, high-contrast combat tells, and seven
source-backed non-color status glyphs. PR #190 shipped mono audio, Essential/Full
gameplay captions, independent Voice volume, and capability-safe touch vibration.
A11-10 still remains in flight for physical-device/AT/zoom proof and A11-14 convergence.
A11-11 and A11-12 remain in flight; A11-13 and A11-14 remain planned. A11-05 is
a pulled-forward 1.2 Mines foundation whose remaining full-board proof belongs to the
Fair Forge gate. Durable same-state Settings and gameplay-caption evidence lives under
[`docs/evidence/v1.1`](evidence/v1.1/README.md); it proves the captured web states, not
the remaining physical-device or assistive-technology gates.

**Exact campaign-map gate shipped boundary:** [PR #194](https://github.com/QemmHD/2dgamerepo/pull/194)
shipped save v10 at main [`b1113cf`](https://github.com/QemmHD/2dgamerepo/commit/b1113cf5b354d189d328dc310520efd455b88f5b).
Each next map now requires all three unique authored bosses from its immediate predecessor
in an eligible standard campaign run. Repeats, wrong-map bosses, Daily, Rite Trial,
Boss Rush, Weekly Ember, debug/direct spawns, and QA-bypass runs do not count. Legacy
v0–v9 access migrates conservatively; malformed current ledgers fail closed without
consulting lifetime totals. PR CI
[`29342507445`](https://github.com/QemmHD/2dgamerepo/actions/runs/29342507445), main CI
[`29342595438`](https://github.com/QemmHD/2dgamerepo/actions/runs/29342595438), and Pages
[`29342595535`](https://github.com/QemmHD/2dgamerepo/actions/runs/29342595535) passed.
Deployed Play and `?dev=1` Settings receipts were `EXC:0` with zero browser errors.
That release closed only the exact unlock foundation. Guided objectives shipped later
through PR #196; further progression, new destinations, and full 2.0 convergence remain open.

**Guided Run Path shipped boundary:** [PR #196](https://github.com/QemmHD/2dgamerepo/pull/196)
shipped at main [`5abd6fd`](https://github.com/QemmHD/2dgamerepo/commit/5abd6fd1e0c5e06652a244951cb282d973a23f3c).
After first-run onboarding retires, each eligible run presents exactly one current task
at a time through Orientation, Tactic, and Climax, selected deterministically from 26
authored candidates. Standard,
Daily, Rite Trial, Boss Rush, and Weekly Ember filter against their real capabilities;
unsupported/unknown modes fall back to bounded no-system elapsed-time work without
assuming unavailable metrics. The active Run Path/Living Vigil lane shows exact progress, next
action, and the current potential `+N COINS`; each completion announcement identifies
the newly held amount, the pause overlay shows the aggregate held total, and the
terminal receipt shows what actually banked. At a valid terminal resolution that also
passes Battle Pass eligibility, each
eligible completed phase contributes 35 raw Deeds/Vigil XP (maximum 105 before the
shared 520 Deeds cap, so the actual gain may be lower at cap). That XP is derived from
the completion count and is never held or receipted. Save-v10 coin authority uses a
bounded 96-receipt ledger, slot dedupe, and stale-instance checks. Debug Mode/
`showDebug`, map bypass, or a live debug action disables Run Path coin settlement and
objective-derived Deeds XP; simply opening `?dev=1` or running the QA harness does not.
A non-terminal abort—including restart or pause-menu abandon—and reload forfeits held
Run Path coins and never reaches objective-derived terminal XP; a valid terminal
resolution settles. First-run
onboarding owns the guidance lane before the director starts; `O` recalls only an
active task. The `#game-objective` described-by text and polite live region use the same
bounded objective description while the HUD renders its exact fields. Exact 667×375 field/live-boss
phone rails, 1280×581/720 desktop, 1024×768 tablet, Reduced Effects, and High Contrast
passed. The committed wide-font validator fits all 26 next-action strings at conservative
1280 geometry; real Chromium covered seven representative standard, Boss Rush, and
Weekly states. Local regression was **184,139 assertions** with Run Path
**93,139**, HUD **14,001/180**, validators **24/24**, and syntax **166/166**. PR CI
[`29363043049`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363043049), main CI
[`29363172352`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363172352), and Pages
[`29363172362`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363172362) passed.
Deployed desktop, Stormwing phone, and five-control `?dev=1` receipts were `EXC:0`
with zero browser logs; the exact post-deploy receipt is recorded in
[`evidence/v1.1/guided-run-path-deployed-smoke.md`](evidence/v1.1/guided-run-path-deployed-smoke.md).
This closes only the bounded run-guidance foundation: the remaining tutorial success
beats/first-death debrief, Daily overhaul, later collection-completion depth, House V2,
new maps, and full version milestones remain open.

**Collection Growth I-A shipped boundary:** [PR #198](https://github.com/QemmHD/2dgamerepo/pull/198)
shipped at main [`454e944`](https://github.com/QemmHD/2dgamerepo/commit/454e9442ed93dba47a84f469c8e7ed87d3b80f64).
The catalog grows from 65 to **73 cosmetics**—12 fur, 14 cloaks, 16
hats/accessories, 15 auras, and 16 trails—and from seven to **nine complete sets**.
Deterministic eight-item pages plus category, ownership, and stable source filters make
all 73 items reachable, including the 33 entries formerly clipped after slot eight.
The Boutique independently pages category stock and three sets per page. Lanternward
adds four Boutique-only pieces with an exact **12,400-coin effective set add-on cost**
and reuses achievement-gated `fur_waylight`; Duskmoth Court adds four case-only pieces
and reuses `fur_shadow` through its existing Case route. Collection,
Boutique, and case reels render the real silhouettes/effects through the shared
six-hero × 27-pose attachment rig. Reduced Effects freezes every cosmetic motion,
including the completed-set flourish; unknown cosmetic grants fail closed; and the
Character → Boutique shortcut resets keyboard focus and accessibility screen state.
This is cosmetic-only: save schema, player power, case cost/odds/pity, Mines stakes,
and the verified **93%** theoretical Mines return are unchanged. PR #198 local
regression was
**193,879 assertions**: Collection **8,080**; attachment **5,268** across 162 frames
and 810 points; progression **5,313**; Run Path **93,139**; HUD **14,001/180**;
gambling **644**; UX **97**; accessibility **299**; validators **25/25**; and syntax
**168/168**. PR CI
[`29367945521`](https://github.com/QemmHD/2dgamerepo/actions/runs/29367945521), main CI
[`29368052366`](https://github.com/QemmHD/2dgamerepo/actions/runs/29368052366), and Pages
[`29368052435`](https://github.com/QemmHD/2dgamerepo/actions/runs/29368052435) passed;
cache-busted deployed HTTP checks returned 200 for the game, collection model, and
cosmetic catalog. The exact Character Collection and Lanternward Boutique production-
harness captures, pixel gates, hashes, and bounded limitations are indexed in
[`evidence/v1.1/collection-growth-ia-deployed-smoke.md`](evidence/v1.1/collection-growth-ia-deployed-smoke.md).
This closes only I-A. Its eight enabling looks do **not** count toward
or reduce Collection Growth I-B's separate 30-look commitment, and it does not close
complete Collection Growth I, A11-13, 1.1, the 1.0 → 2.0 arc, or 2.0.

**Collection Growth I-B shipped boundary:** [PR #200](https://github.com/QemmHD/2dgamerepo/pull/200)
shipped at main [`a34baca`](https://github.com/QemmHD/2dgamerepo/commit/a34bacafac2cd222e0a55c3e94545f6535a3acf2).
Thirty genuine pieces across Kilnheart Panoply, Rimeglass Court, Thorncrown Covenant,
Stormglass Covenant, Sunscar Caravan, and Gravebell Reliquary raise the catalog from
73 to **103 cosmetics** and from nine to **15 complete sets**. The category totals are
18 fur, 20 cloaks, 22 hats/accessories, 21 auras, and 22 trails. Six distinct fur
materials are baked into all hero poses with a bounded eight-entry appearance cache;
six cloak, headwear, aura, and trail families retain the shared attachment/effect
contract. Source truth is explicit: Kilnheart/Thorncrown/Sunscar are Boutique-only,
Rimeglass/Gravebell are case-only, and Stormglass has both case routes and a 26,000-
coin deterministic ceiling. Save-v10 migration seeds six per-hero presets from the
validated legacy look; exact atomic full-look purchase/equip, selected-hero mirror,
Rite Trial run-hero rendering, persistent pursuit, owned/set/match totals, and honest
next-source guidance pass fail-closed fixtures. Cosmetics remain visual-only. Battle
Pass/achievement rewards, case costs/odds/pity/unowned weighting, duplicate refunds,
Mines stakes, and the verified **93%** theoretical return are unchanged.

The PR #200 feature boundary is **198,394 assertions**: Collection **9,981**;
attachment **7,332** across 162 frames/810 points; progression **5,860**; Run Path
**93,139**; HUD **14,001/180**; gambling **644**; UX **100**; accessibility **299**;
validators **25/25**; and syntax **169/169**. PR CI
[`29373728825`](https://github.com/QemmHD/2dgamerepo/actions/runs/29373728825), main CI
[`29373896220`](https://github.com/QemmHD/2dgamerepo/actions/runs/29373896220), and Pages
[`29373896279`](https://github.com/QemmHD/2dgamerepo/actions/runs/29373896279) passed.
Cache-busted deployed source markers returned 200, and main CI artifact `8327157493`
contains four exact Collection/Boutique production-harness receipts, including the
historical **439×247** resolved phone Collection receipt. The detailed
hashes, source smoke, visual limits, and random-only Mythic watchpoint are indexed in
[`evidence/v1.1/collection-growth-ib-deployed-smoke.md`](evidence/v1.1/collection-growth-ib-deployed-smoke.md).
This fulfills I-B only. It does not close complete Collection Growth I, A11-13, 1.1,
1.6, the 1.0 → 2.0 arc, 2.0, or 2.8.

**Phone Character truth correction shipped boundary:** [PR #201](https://github.com/QemmHD/2dgamerepo/pull/201)
shipped at main [`45f6216`](https://github.com/QemmHD/2dgamerepo/commit/45f62160cc2446d92e8c8bde220c491d5074fb77).
A shared resolved phone-landscape classifier now keeps the canonical **667×375** Character
layout rich while routing **568×320** and **480×270** through the compact safe fallback;
the deterministic COVER fixture also resolves raw **932×430** to **932×524.25** before
classification. The Character session pane now exposes Hero Rites with all three rites,
attunement state, and CSS-scale-aware **44 px** Back and purchase targets. It never
hardcodes or exposes a locked relic ATTUNE route: the separate relic action remains
discovery-locked, and a direct SaveSystem attempt to attune an undiscovered relic is
rejected with zero state mutation and zero save writes. UI state, semantic actions,
accessibility labels, Escape/back behavior, and the guided-tour route use the same
authority; unsafe layouts fail closed.

The current integrated boundary is **198,687 assertions**: Collection **10,249**;
attachment **7,332** across 162 frames/810 points; progression **5,865**; Run Path
**93,139**; HUD **14,001/180**; gambling **644**; UX **109**; accessibility **310**;
validators **25/25**; and syntax **170/170**. Accepted PR CI
[`29377897747`](https://github.com/QemmHD/2dgamerepo/actions/runs/29377897747) produced
artifact `8328580576`; final docs-head PR CI
[`29378248121`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378248121), main CI
[`29378392323`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392323), and Pages
[`29378392313`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392313) passed.
Main artifact `8328741615` includes the exact **667×375 Collection** and
**667×375 Rites** production-harness receipts alongside the preserved desktop,
Stormglass, and Gravebell receipts. No economy, save-schema, or developer-control
contract changed; `?dev=1` remains intact. These deterministic production-harness
fixtures are not physical-device, assistive-technology, portrait, or tablet acceptance.

**Developer Settings preservation:** `?dev=1` intentionally retains **Debug Mode**,
**Unlock All Maps (testing)**, and the coin/item **CHEATS (TESTING)** controls inside
Settings on desktop and phone while normal player URLs keep them gated. Unlock All Maps
is now session-only, performs zero save writes, and disables campaign credit for the run.
The query parameter alone does not disable Run Path coin settlement or
objective-derived Deeds XP; activating Debug Mode, the map bypass, or a live debug
action does.
The phone Settings validator exercises player/developer General layouts and Accessibility
layouts at three fixtures, plus real desktop/phone developer actions; future Settings
work must preserve this testing surface.

| ID | Version | Category | Status | Grounded outcome and source anchors | Dependencies | Evidence / PR slot | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VH-01 | 1.0.1 | Health/UX/combat/save | `[x] SHIPPED` | Ten Vigil Health fixes: first-run menu, current tour, pause Restart/Leave confirm, modal safety, Weekly best, upgrade cap, slot safety, daily metric uniqueness, exact XP, wall-blocked hostile bolts. | None | PR [#184](https://github.com/QemmHD/2dgamerepo/pull/184); merge `9bb1ca2`; CI/Pages passed; [deployed main](https://qemmhd.github.io/2dgamerepo/) returned HTTP 200 with game canvas/title on 2026-07-13 | Keep historical fixtures green. |
| LV-01 | 1.0.2 | Houses/POIs | `[x] SHIPPED` | Four structure-anchored sites: Wayfarer Hearth, Ashen Archive, Keeper Cache, Gloam Beacon. `src/content/vigilSites.js`, `src/systems/VigilSiteSystem.js`, `src/core/GameUpdate.js`, `src/core/GameRender.js` | None for the shipped web tranche | Sites **179 OK**; integration **110 OK**; all-biome browser matrix `EXC:0`; durable [archive reward](evidence/v1.0.2/living-vigil-reward.jpg) and [Beacon clear](evidence/v1.0.2/living-vigil-beacon-clear.jpg); feature `53db829`, ledger `377ad9b`, PR [#185](https://github.com/QemmHD/2dgamerepo/pull/185), main `da88450`; PR/main CI, Pages, and live smoke passed | Preserve the site/integration fixtures; add phone Hearth/Cache and boss-interruption captures during the later world/accessibility pass. |
| LV-02 | 1.0.2 | Encounters/enemies | `[x] SHIPPED` | Twelve named tactical formations, three per current biome; deterministic scheduling and bounded placement; roaming clears count separately from Beacon guardians. `src/content/encounters.js`, `src/systems/EncounterDirector.js`, `src/systems/VigilTracker.js`, `src/core/CombatResolver.js` | None for the shipped web tranche | Encounters **534 OK**; tracker **60 OK**; integration **110 OK**; navigation **55,090 OK** including stress; boss/Lieutenant/Beacon arbitration covered; browser boss states `EXC:0`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Retain a fixed-seed encounter/boss interruption capture as a regression fixture; do not reopen the shipped scheduling rules without failing evidence. |
| LV-03 | 1.0.2 | Progression/Battle Pass | `[x] SHIPPED` | Additive `vigilSitesActivated`, `vigilSiteKindsMastered` (clamped 0–4), `encountersCleared`, and `guardianPacksDefeated`; direct run XP, transparent receipt, objectives/dailies, six achievements, and Waylight Regalia. `SaveSystem.js`, `BattlePassSystem.js`, `achievements.js`, `cosmetics.js`, `dailyChallenges.js`, `objectives.js` | None for the shipped web tranche | Progression **4,550 OK**; integration **110 OK**; [Battle Pass receipt](evidence/v1.0.2/battle-pass-waylight-included.jpg) reconciles `Waylight 84 included` to `+932 XP`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Add historical-main save fixtures to the long-lived recovery corpus while preserving the shipped additive ids. |
| LV-04 | 1.0.2 | Mines/Cases/economy | `[x] SHIPPED` | Coin-only 5×5/6-mine risk with 100/250/500/2,000 stakes, exact risk/payout/net, about-7% edge, five/hour cap; real case result centered with no manufactured near miss. `CaseSystem.js`, `MinigameOverlay.js`, `MenuRenderer.js` | Native distribution remains separately policy-gated | Gambling **644 OK** across four stakes and 93% target return; [Mines quote](evidence/v1.0.2/mines-transparent-quote.jpg) is `EXC:0`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Preserve the 644-check economy contract; add a durable case-landing capture and territory review before any native-store submission. |
| LV-05 | 1.0.2 | HUD/feedback | `[x] SHIPPED` | Site/encounter state, exact reward receipts, guardian state, and progress use the existing HUD/state builder without a second permanent panel. `HUDLayout.js`, `UIStateBuilder.js`, `UISystem.js`, `VigilTracker.js` | None for the shipped web tranche | HUD **1,069 OK across 36 scenarios**; tracker **60 OK**; browser touch/site/guardian/boss/swarm matrix `EXC:0`; durable [site reward](evidence/v1.0.2/living-vigil-reward.jpg) and [Beacon clear](evidence/v1.0.2/living-vigil-beacon-clear.jpg); feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Keep dense HUD fixtures green and add phone/reduced/high-density evidence through A11 rather than reopening 1.0.2. |
| LV-06 | 1.0.2 | CI/QA | `[x] SHIPPED` | Fourteen validators, expanded real-game matrix, main-only Pages deploy, deterministic Vigil/Mines/Pass states, and SFX reel probe are integrated in CI. | None | **14/14 validators**, syntax **144/144**, YAML/diff, browser matrix, audio continuity, navigation stress, and Blender **27/27** were green; PR and `main` CI passed; Pages deploy and live smoke passed; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450` | Preserve the shipped 1.0.2 gates plus the four A11 gates and expanded receipt-bearing harness across every remaining First Light row. |
| LV-07 | 1.0.2 | Menu clarity/color | `[x] SHIPPED` | Home says “Start your first run,” “Upgrades,” and “Survive about 15 minutes”; restrained accents distinguish support actions while the run CTA stays dominant. `src/systems/MenuRenderer.js` | None for the shipped web tranche | UX **74 OK**; durable [same-state menu comparison](evidence/v1.0.2/menu-clarity-comparison.jpg); menu/touch/Mines/Pass renders `EXC:0`; feature `53db829`, ledger `377ad9b`, PR #185, main `da88450`; delivery gates passed | Treat this copy/accent baseline as shipped; finish focus, reduced-motion, phone, and zoom proof in A11. |
| LV-08 | 1.0.2 | Delivery | `[x] SHIPPED` | Living Vigil, fair-risk, HUD, and menu-clarity tranche is on `main` and deployed. | LV-01–LV-07 shipped | Feature `53db829`; ledger `377ad9b`; PR [#185](https://github.com/QemmHD/2dgamerepo/pull/185); squash merge `da88450ce4b223c7866ab0498d9d88a635865da3`; PR/main CI and Pages passed; [live smoke](https://qemmhd.github.io/2dgamerepo/) showed 1280×720 canvas/title/Home | 1.0.2 is closed; preserve its fixtures and execute the named proof and feature rows without republishing it. |
| A11-01 | 1.1 | Semantic canvas/live status | `[~] IN FLIGHT` | Focusable Canvas application semantics, screen-aware labels/instructions, polite live region, and announcements for focus, actions, toasts, wave events, boss arrivals, and the current Guided Run Path. `O` recalls an active objective; first-run onboarding owns the lane before the director starts. `#game-objective` described-by text and live-region output share one bounded objective description while the HUD renders the same progress/action/reward fields. `index.html`, `styles.css`, `src/systems/AccessibilityBridge.js`, `src/core/Game.js`, `src/core/RunState.js`, `src/systems/WaveDirector.js`, `src/systems/RunObjectiveDirector.js` | Assistive-technology review and richer modal coverage | PR #186/main `3ed29e0` delivered the semantic foundation. PR #196/main `5abd6fd` added active-objective recall/announcements and raised accessibility coverage to **290**; deployed keyboard HUD and `?dev=1` receipts were `EXC:0`. This is browser semantic proof, not a manual AT pass. | Run manual screen-reader/Voice Control spot checks and add explicit upgrade-choice, reward, victory, and death announcements before promoting the full semantic row. |
| A11-02 | 1.1 | Menu/tour keyboard focus | `[~] IN FLIGHT` | Stable labeled hotspot keys, roving Tab/arrow focus, Enter/Space activation, Escape/back behavior, visible non-color focus, and a tour-only SKIP/NEXT focus scope. `AccessibilityBridge.js`, `GameInputActions.js`, `MenuRenderer.js`, `UIStateBuilder.js` | Complete cross-tab/tour browser sweep | PR #186/main `3ed29e0` delivered repeat suppression, modal Tab containment, orphan recovery, and the two-Enter first-run path; accessibility **193**, live Home/Run setup/back, and receipt-bearing harness are green | Exercise every tab, destructive confirmation, claim/equip removal, and the full guided tour in the deployed browser before closing the row. |
| A11-03 | 1.1 | Active modality/touch HUD | `[~] IN FLIGHT` | Keyboard, pointer, and touch modality reflect the latest real input; hybrid devices show touch controls only in touch mode and clear held touch state when switching away. `src/core/Input.js`, `src/core/GameRender.js`, `src/core/TouchButtons.js`, `src/systems/UIStateBuilder.js` | Hybrid-device runtime proof | PR #186/main `3ed29e0` delivered active-modality HUD gating, touch reset, and held-key repeat isolation; accessibility **193**, UX **74**, and harness modality states are green | Capture keyboard↔touch switching on a hybrid/phone path and verify no stuck joystick/button state in a live run. |
| A11-04 | 1.1 | Reduced-motion inheritance | `[~] IN FLIGHT` | Fresh/reset/corrupt profiles inherit `prefers-reduced-motion`; an explicit existing save stays authoritative. Menu decoration/transitions, case reveal, Mines shake/pop/pulse, and touch-button ready pulse become static while state remains readable. `SaveSystem.js`, `MenuRenderer.js`, `MinigameOverlay.js`, `TouchButtons.js` | Motion-completeness pass | PR #186/main `3ed29e0` delivered the scoped behavior; save **20**, minigame **14**, byte-identical Settings/case frames, and reduced Mines `EXC:0` are green. The pre-Game loading splash is not included | Gate the loading splash/rotate presentation and audit camera/global effects before claiming all app motion is covered. |
| A11-05 | 1.2 pulled forward | Keyboard Mines | `[~] IN FLIGHT` | Pulled-forward Fair Forge input-accessibility foundation: arrow-key 5×5 focus, Enter reveal, Space cash-out/continue, Escape close, spoken outcomes, keyboard help copy, and a high-contrast shape/outline focus indicator preserve the pointer/touch board. The retained A11 id reflects its delivery tranche; its completion gate belongs to 1.2. `Game.js`, `GameInputActions.js`, `MinigameOverlay.js`, `UIStateBuilder.js` | Full deployed board flow and remaining 1.2 input parity | PR #186/main `3ed29e0` delivered the keyboard board and Tab focus scope; minigame **14**, gambling **644**, exact receipt harness, and live Canvas focus are green | Complete deployed safe-pick, cash-out, bust, result-dismiss, and close flows with keyboard and pointer; finish gamepad/muted/high-contrast/2,000-coin confirmation coverage under 1.2. |
| A11-06 | 1.1 | Phone Settings | `[~] IN FLIGHT` | Dedicated landscape-phone General and Accessibility geometry uses readable grouped columns, CSS-scale-aware 44 px minimum targets, concise labels, complete gameplay/audio/help/save actions, and a separate Combat HUD preference pane while desktop retains the same routes. `MenuRenderer.js`, `tools/validate-phone-settings.js` | Device/zoom review | PR #186/main `3ed29e0` delivered the General baseline; PR #190/main `bed6ac5` adds the independent Voice row and captions/mono/vibration Accessibility controls. The shipped gate is **2,430 OK across 9 layout fixtures plus real phone/desktop render passes**. All five `?dev=1` controls remain gated from normal URLs and passed deployed receipt proof. Device/200% proof remains open. | Complete the 200%/physical-device sweep before closing the full phone row; preserve the durable same-state Settings evidence. |
| A11-07 | 1.1 | Zoom resilience | `[~] IN FLIGHT` | Viewport metadata no longer disables browser zoom; Canvas focus remains visible and scale-aware layout paths retain their existing cover-fit behavior. `index.html`, `styles.css`, `MenuRenderer.js` | Effective pinch/200% proof | PR #186/main `3ed29e0` delivered the metadata/focus foundation; accessibility **193** proves only that contract. Mobile pinch remains constrained by full-surface touch handling | Resolve touch-action/gesture ownership, then run 100%/200% keyboard, Settings, and phone sweeps at five viewports; do not claim effective mobile pinch before proof. |
| A11-08 | 1.1 | Validators/CI/harness | `[x] SHIPPED` | Seven A11-focused deterministic gates cover semantic/modality/focus, preference/save inheritance, minigame access, phone Settings, combat cues, gameplay captions, and touch-vibration fallback. The real-game harness asserts cold-boot saved/runtime values, exact transcripts, production boss-warning caption/haptic paths, `?dev=1`, and strict invalid controls; a zero-duration real-Chromium probe checks the production Web Audio graph. PR #196 adds the bounded Run Path validator plus objective draw/text, live-boss retention, and exact 667×375 calibration receipts. PR #198 adds deterministic eight-slot collection reachability/filter/source truth and animated attachment coverage; PR #200 extends those gates through all 103 cosmetics, six hero presets, atomic look transactions, pursuit/source states, procedural fur, and four strict visual receipts. PR #201 adds resolved **932×524.25**, rich **667×375**, and compact **568×320**/**480×270** Character fixtures, exact **667×375 Collection/Rites** receipts, and zero-write undiscovered-relic authority. `.github/workflows/ci.yml`, `tools/validate-accessibility*.js`, `tools/validate-minigame-accessibility.js`, `tools/validate-phone-settings.js`, `tools/validate-combat-cues.js`, `tools/validate-captions.js`, `tools/validate-haptics.js`, `tools/validate-run-objectives.js`, `tools/validate-cosmetic-collection.js`, `tools/validate-cosmetic-attachments.js`, `tools/artshot/harness.html`, `tools/artshot/audiographprobe.*` | None | PR #190 delivered **21/21 validators** and syntax **157/157**; PR #196 delivered **24/24**, Run Path **93,139**, HUD **14,001/180**, and accessibility **290**. PR #198/main `454e944` raised the then-current boundary to **193,879 assertions**. PR #200/main `a34baca` delivered its historical **198,394-assertion** boundary, Collection **9,981**, attachment **7,332** across 162 frames/810 points, progression **5,860**, accessibility **299**, UX **100**, gambling **644**, validators **25/25**, and syntax **169/169**, while preserving Run Path **93,139** and HUD **14,001/180**. PR #201/main `45f6216` raises the current boundary to **198,687 assertions**, Collection **10,249**, progression **5,865**, accessibility **310**, UX **109**, and syntax **170/170**; attachment, Run Path, HUD, gambling, and validators remain unchanged. Accepted PR CI `29377897747`/artifact `8328580576`, final docs-head PR CI `29378248121`, main CI `29378392323`/artifact `8328741615`, and Pages `29378392313` passed. | Preserve every shipped gate, especially routed audio, exact transcripts, hidden-surface lifecycle, `?dev=1`, lexical-invalid inputs, 667 px captions/objective rails, active-boss retention, dense swarms, all-103 collection reachability/source truth, case/Boutique exclusions, preset migration, atomicity, attachment-safe motion, the shared phone classifier, Hero Rites session route, and zero-write undiscovered-relic rejection. |
| A11-09 | 1.1 | Foundation delivery | `[x] SHIPPED` | The First Light accessibility/input/phone foundation is on `main` and deployed without claiming the complete 1.1 milestone. It also ships the one-transient-badge attention budget with typed `NEW`, `CLAIM`, and `GOAL` states. | A11-08 shipped | Feature `b06915e`; PR [#186](https://github.com/QemmHD/2dgamerepo/pull/186); squash merge `3ed29e072b6a5b8d5bd277eb8a3e30de6f6e60f3`; main CI `29299938429`; Pages `29299938437`; live 667×375 and 1280×720 semantic/focus/Run setup/back smoke with zero logs | Preserve this foundation; complete the proof rows and incomplete A11-10–A11-14 scope without recreating it. |
| A11-10 | 1.1 | Preference/accessibility suite | `[~] IN FLIGHT` | **Three shipped bounded slices:** PR #188 delivers save-safe **Combat HUD size** 100/115/130, strict high contrast, measured HUD lanes, readable hazards/telegraphs, and seven source-backed non-color status badges. PR #190 delivers captions on by default with Essential/Full detail, a dedicated priority/dedupe gameplay-caption lane, exact monophonic boss transcripts, independent Voice volume, standards-defined mono output, and capability-safe touch vibration Off/Low/Full. PR #196 adds bounded High Contrast/Reduced Effects and responsive objective-card proof. Hidden pause/photo/reward/terminal states suppress captions and spoken audio together; 16 CSS px caption body/label and two-line containment are validated down to 667 px landscape. Combat HUD size is not global app/menu text scaling. All five `?dev=1` controls remain intact. The row stays in flight for device/AT/zoom proof and First Light convergence. | A11-01 semantics; physical-device/AT and A11-14 convergence | PR #188/main [`089d646`](https://github.com/QemmHD/2dgamerepo/commit/089d646d5b6ba37a1a10c41de9c86a79d1ed0371) delivered the visual-combat slice. Feature [`8fef031`](https://github.com/QemmHD/2dgamerepo/commit/8fef031d2e078a716c19f21f4f1cb2cffc95ec76) plus evidence [`5328770`](https://github.com/QemmHD/2dgamerepo/commit/5328770a75cfcfef2120b23734542cae3be1be9f) merged through [PR #190](https://github.com/QemmHD/2dgamerepo/pull/190) as main [`bed6ac5`](https://github.com/QemmHD/2dgamerepo/commit/bed6ac5443e651a61ec90449673db4a967e9abef). PR #196/main `5abd6fd` adds exact 667×375, 1024×768, and 1280×581/720 objective geometry under High Contrast and Reduced Effects. These bounded browser receipts do not replace physical-device, AT, zoom, or full convergence proof. Durable evidence: [`evidence/v1.1`](evidence/v1.1/README.md). | Run physical phone/tablet vibration/mono/voice/backgrounding and screen-reader/Voice Control checks at the named viewports/zoom levels; complete A11-14 before promoting A11-10 or 1.1. |
| A11-11 | 1.1 | Playable tutorial/debrief | `[~] IN FLIGHT` | Preserve and finish the existing nine-step first-run gameplay chain: movement, auto-fire, shards, first upgrade, coins, combo, shrine, boss, and controls send-off. Add direct successful-use lessons for blink, Focus, and Kindle plus a first-death debrief with cause, learning, coins, Pass progress, and one next action. | A11-01 announcements; A11-02 focus; tutorial state/save audit | `Game.js` and `UISystem.js` already ship nine sequential non-modal lessons with pointers, completion flashes, and timeout fallback. PR #196 correctly gives onboarding precedence over Run Path, but it does not prove direct blink/Focus/Kindle use or provide a first-death debrief. | Add explicit blink→Focus→Kindle success triggers, run the complete first-save/replay/timeout/input matrix, and ship the first-death debrief. |
| A11-12 | 1.1 | Play/Now/Explore hierarchy | `[~] IN FLIGHT` | Complete the three-level Home reading order, one dominant run CTA, concise mode length/difficulty/seed/reward explanations, stable wallet/pinned goal, restrained RGB use, and typed attention clearing rules. | LV-07 clarity; A11-02 focus; A11-09 badge foundation | PR #186 ships one typed transient badge and the existing central menu route; the full hierarchy/comprehension contract is unproven | Ground the current Home/mode surfaces, then implement the Play/Now/Explore information hierarchy without adding a second menu system. |
| A11-13 | 1.1 | Lock/source/context routing | `[ ] PLANNED` | Every locked hero, map, cosmetic, chapter, case, and mode explains why, source, and deterministic next route; Back/Escape restores tab, scroll, selection, filters, try-on, and mode setup without replaying entrances. | A11-02 stable focus keys; destination inventory | PR #198/main `454e944` ships the Collection source/filter subset and a Character → Boutique focus-safe shortcut; PR #200/main `a34baca` adds source-honest set pursuit and deterministic-vs-random next routes. Neither proves the complete lock matrix or Back/Escape restoration contract, so this row remains planned. | Preserve the shipped Collection/pursuit source truth; build the remaining hero/map/chapter/case/mode lock-source-destination matrix and exact tab/scroll/selection/filter/try-on/setup restoration tests before promoting A11-13. |
| A11-14 | 1.1 | First Light convergence | `[ ] PLANNED` | Close the exact release gate: five-second comprehension, grayscale/RGB-disabled hierarchy, one-animation attention ceiling, ≤100 ms discrete feedback, pointerless primary loop, five target viewports, text-scale/menu performance fixtures, and paired reduced-motion captures. | A11-01–A11-04 and A11-06–A11-13 complete | PR #186 proves the semantic/input foundation; PR #188 adds scale/contrast/non-color evidence; PR #190 adds durable Settings/caption comparison, 667 px caption geometry, strict lifecycle/audio receipts, and live deployed caption/dev states. PR #196 adds a bounded responsive objective-card viewport/High Contrast/Reduced Effects slice. None of those foundations proves full convergence. | After the feature rows land, run the named comprehension, timing, viewport, pointerless, grayscale, RGB-disabled, text-scale, reduced-motion, AT, and physical-device matrix before calling 1.1 complete. |

## Version implementation register

The scope counts below point to the roadmap’s counted inventories. Rows track
implementation epics; each epic contains multiple player-visible deliverables and must
link back to its acceptance metrics before shipping.

### 1.0 → 2.0 — The Living Vigil (46 additions)

| ID | Category | Status | Dependency | Next bounded action | Evidence / PR |
| --- | --- | --- | --- | --- | --- |
| V1-UX | Menu/onboarding/accessibility | `[~] IN FLIGHT` | LV-07 and A11-08/A11-09 foundation shipped; PR #188 shipped scale/contrast/status and PR #190 shipped captions/mono/Voice/touch vibration | Complete A11-01–A11-04 and A11-06–A11-07 proof plus A11-10 device/AT evidence and the A11-11–A11-14 onboarding, hierarchy, routing, and convergence work. | LV-07; A11-01–A11-14; PR #186; PR #188; PR #190 |
| V1-INPUT | Input/platform | `[~] IN FLIGHT` | V1-UX focus semantics; A11 keyboard/modality foundation and capability-safe touch vibration shipped | Complete deployed hybrid-device, guided-tour, Mines-flow, and physical vibration proof. Full gamepad support, remapping, glyph switching, disconnect recovery, safe-area tuning, and controller haptics remain separate planned work. | A11-02; A11-03; A11-05; A11-09; PR #186; PR #190 |
| V1-ECO | Cases/Mines/upgrades | `[~] IN FLIGHT` | LV-04 fair-risk foundation plus PR #198/#200 source-honest Boutique/case partitions and atomic look checkout shipped | Preserve the **644**-check quote/receipt contract, **93%** theoretical Mines return, exact case odds/pity/unowned weighting/refunds, and all source exclusions. Record Gravebell's random-only Mythic tail honestly; make an explicit Blueprint/direct-price ceiling decision in the next Collection Completion Truth slice before claiming random-only balance complete. Forge Reserve remains a separate economy slice. | LV-04; PR #198; PR #200; main `a34baca` |
| V1-PROG | Chapters/cosmetics/save | `[~] IN FLIGHT` | LV-03 Waylight/progression, PR #196 atomic Run Path settlement, and PR #198/#200 Collection Growth I-A/I-B shipped: 103 items, 15 sets, six per-hero presets, persistent pursuit, and atomic look transactions | Preserve Waylight, Run Path settlement, all-103 source truth, additive save-v10 preset migration, and the selected-hero compatibility mirror. Next add broader collection/category/set completion analytics and receipts, the permanent chapter shelf, and export/recovery; do not recreate the completed I-B pack. | LV-03; PR #196; PR #198; PR #200; main `a34baca` |
| V1-GUIDANCE | Guided Run Path | `[x] SHIPPED` | Exactly one deterministic current task is active at a time as the path advances Orientation → Tactic → Climax from the 26 candidates shipped at main `5abd6fd`; first-run onboarding owns the lane before the director starts. The active card shows exact progress/action/current potential coin reward; completed Run Path coins are held for terminal settlement, and eligible completed-phase Deeds XP is derived separately at terminal. Safe elapsed-time fallback, active-task `O` recall, announcements, one guidance owner, and bounded save-v10 coin receipts are integrated. | Preserve **93,139** objective checks, **14,001/180** HUD checks, the all-26 static wide-font next-action gate, seven representative Chromium scenarios, held Run Path coin authority, and terminal objective-count XP derivation. `?dev=1`/QA alone does not disable Run Path coin settlement or objective-derived XP; Debug Mode/`showDebug`, map bypass, and live debug actions do. A non-terminal abort—including restart or pause-menu abandon—and reload forfeits held Run Path coins and never reaches objective XP; a valid terminal resolution settles. Add candidates only with reachable metric/capability and settlement fixtures; do not flatten the catalog into simultaneous chores. | PR [#196](https://github.com/QemmHD/2dgamerepo/pull/196); main [`5abd6fd`](https://github.com/QemmHD/2dgamerepo/commit/5abd6fd1e0c5e06652a244951cb282d973a23f3c); PR CI `29363043049`; main CI `29363172352`; Pages `29363172362` |
| V1-CAMPAIGN | Exact map unlocks | `[x] SHIPPED` | Save-v10 ledger records the three unique authored bosses per map; only eligible map-director deaths count; every menu, launch, victory, share-card, accessibility, migration, and QA path consumes the same receipt/predicate. | Preserve the **319** exact-gate checks, **40,960** corruption/idempotence probe, provenance/canonical-death fixtures, all-six-permutation coverage, and session-only `?dev=1` bypass; keep its authority independent from the separately shipped V1-GUIDANCE receipts. | PR #194; main `b1113cf`; PR CI `29342507445`; main CI `29342595438`; Pages `29342595535` |
| V1-TACTICS | Encounters/enemies/navigation | `[~] IN FLIGHT` | LV-02 formations shipped | Preserve the twelve formation and navigation fixtures; implement role budgets, door tactics, and bounded stuck recovery next. | LV-02 |
| V1-BOSS | Boss choreography | `[ ] PLANNED` | V1-TACTICS collision truth | Rebuild one boss-family vertical slice: opener/phase/desperation/arena/scaling. | — |
| V1-WORLD | Houses/maps/POIs | `[~] IN FLIGHT` | LV-01 four-site foundation shipped | Preserve the four Vigil-site fixtures; implement one modular house plus a six-event POI vertical slice next. | LV-01 |
| V1-HUD | Combat readability | `[~] IN FLIGHT` | LV-05 HUD/site/pack foundation plus PR #196's sole guidance-owner card, exact body/bar/footer lanes, 667×375 field/boss rails, 1280×581/720 wide-font proof, High Contrast, and Reduced Effects integration shipped | Preserve the Run Path/Living Vigil ownership and responsive action/reward completion receipts; the constrained boss edge rail intentionally omits secondary title/context. Add death-source/debrief receipts and complete physical-device/AT/zoom proof. | LV-05; PR #196; HUD **14,001/180** |
| V1-AUDIO | Adaptive score/mix | `[~] IN FLIGHT` | Stable event vocabulary | Preserve the shipped 3 tracker menus + recorded feature, 2 songs/biome, 4 boss suites, independent Music/SFX/Voice buses, live mono switching, and mute-safe voice ducking; extend the graph/180-second continuity proof to the planned 30-minute physical-device background/restore soak. | PR #183; PR #190; LV-06 |
| V1-ART | Heroes/bosses/houses | `[~] IN FLIGHT` | PR #192 shipped the six-hero deterministic Blender/animated-attachment foundation; PR #198 added eight I-A looks/two sets; PR #200 added I-B's 30 pieces/six sets, procedural fur materials, and full preview/live parity | Preserve the 18-sheet install manifest, exact head/shoulder/hand pose contract, protected face/accent classifier, bounded appearance cache, genuine silhouette/effect parity, Reduced Effects freeze, and six-hero browser matrix. Do not recreate I-B; produce the 12 boss identity sets and first modular House V2 kit next. | PR #192/main `e8ec79f`, historical **4,387** gate; PR #198/main `454e944`, **5,268**; PR #200/main `a34baca`, current **7,332** across 162 frames/810 points |
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
- [x] Active First Light row ids and player-visible outcomes are named (A11-01–A11-14),
      with A11-05 explicitly identified as a pulled-forward 1.2 foundation.
- [x] Status is honest: LV-01–LV-08 and A11-08/A11-09 are shipped; A11-01–A11-07 and
      A11-10–A11-12 remain `[~]`; A11-13/A11-14 remain planned and prevent a false 1.1 close.
- [x] A11 source systems, dependencies, proof gaps, and bounded next actions are listed.
- [x] Current integrated evidence is recorded: **198,687 assertions**; Run Path
      **93,139**; HUD **14,001/180**; Collection **10,249**; attachment **7,332**
      across 162 frames/810 points; progression **5,865**; accessibility **310**;
      UX **109**; gambling **644**; validators **25/25**; and syntax **170/170**.
      Historical PR #190/#198 subsystem boundaries remain in their owning rows.
- [x] Real-browser Home focus/activation/back, byte-identical reduced Settings frames,
      and harness modality/Mines `EXC:0` are recorded without AT or phone overclaim.
- [x] The integrated Node 22 suite, syntax, YAML, diff, and receipt-bearing Home/Mines
      harness gates were re-run after concurrent edits settled.
- [ ] Record the five-viewport/200% zoom pass and manual AT spot check; keep effective
      mobile pinch zoom and pre-Game loading motion explicitly outside this slice.
- [x] Assign the 1.1 feature commit (`b06915e`) and merged PR (#186) slots.
- [x] Hosted PR CI runs `29299835745` and `29299893474` passed.
- [x] Audio-accessibility squash merge `bed6ac5`, PR CI `29330155481`, main CI
      `29330244561`, Pages `29330244572`, and deployed Accessibility/caption/`?dev=1`
      smoke remain recorded in A11-10.
- [x] Guided Run Path PR #196/main `5abd6fd`, PR CI `29363043049`, main CI
      `29363172352`, Pages `29363172362`, deployed desktop/phone/`?dev=1` receipts,
      and the **184,139**-assertion release boundary are recorded without promoting 1.1.
- [x] Collection Growth I-A PR #198/main `454e944`, PR CI `29367945521`, main CI
      `29368052366`, Pages `29368052435`, cache-busted deployed HTTP checks, and the
      **193,879**-assertion integrated boundary are recorded without promoting complete
      Collection Growth I, A11-13, 1.1, the 1.0 → 2.0 arc, or 2.0.
- [x] The 73-item/nine-set inventory, eight-item paging, all-73 reachability, exact
      Boutique/case exclusions, Lanternward **12,400** effective add-on price,
      attachment-safe motion, fail-closed grants, unchanged save/power/economy rules,
      and the then-unreduced 30-look I-B commitment are preserved as historical truth.
- [x] Durable Character Collection and Lanternward Boutique production-harness
      visual/focus receipts are indexed with `DONE EXC:0`, pixel gates, hashes, manual
      inspection, PR #199 CI `29369402619`, and deployed HTTP/Pages evidence. They are
      explicitly not mislabeled as deployed-browser, physical-device, or manual-AT proof.
- [x] Collection Growth I-B PR #200/main `a34baca`, PR CI `29373728825`, main CI
      `29373896220`, Pages `29373896279`, cache-busted deployed HTTP checks, and the
      **198,394**-assertion integrated boundary are recorded without promoting complete
      Collection Growth I, A11-13, 1.1/1.6, the 1.0 → 2.0 arc, 2.0, or 2.8.
- [x] The 103-item/15-set inventory, six genuine five-piece sets, per-hero preset
      migration, atomic buy/equip, persistent pursuit, exact source partitions,
      protected fur rendering, unchanged power/Battle Pass/case/Mines rules, and
      Gravebell random-only Mythic watchpoint are explicit.
- [x] Durable desktop/production-mobile Collection, Stormglass, and Gravebell
      production-harness receipts are indexed with `DONE EXC:0`, exact stage checks,
      pixel gates, hashes, main artifact `8327157493`, and manual inspection. They are
      explicitly not mislabeled as deployed-browser, physical-device, or manual-AT proof.
- [x] Phone Character truth correction PR #201/main `45f6216`, accepted PR CI
      `29377897747`/artifact `8328580576`, final docs-head PR CI `29378248121`, main CI
      `29378392323`/artifact `8328741615`, and Pages `29378392313` are recorded at the
      current **198,687**-assertion, **25/25**-validator, syntax **170/170** boundary.
- [x] Exact **667×375 Collection** and **667×375 Rites** receipts plus deterministic
      resolved **932×524.25**, rich **667×375**, and compact **568×320**/**480×270**
      fixtures prove only the production harness. Undiscovered-relic attunement rejects
      with zero writes; economy, schema, and `?dev=1` are unchanged. Physical-device,
      assistive-technology, portrait, and tablet acceptance remain explicitly unclaimed.
- [x] The 26-candidate catalog shipped at main `5abd6fd` is recorded as three sequential
      phases with one current task—not 26 simultaneous objectives. Run Path coin/XP
      disable conditions, `?dev=1`/QA non-disablement, and abort/reload forfeiture remain
      explicit.
- [x] Capability-safe browser touch vibration is shipped; full gamepad/remapping/glyph/
      disconnect/controller-haptics support remains explicitly planned, not inferred.
- [x] Residual risk and one next bounded action remain explicit in every A11 row;
      A11-14 owns the full comprehension/timing/viewport/pointerless convergence gate.

## Immediate next-agent handoff

1. **Do not recreate or republish shipped foundations.** LV-01–LV-08 shipped through
   PR #185/main `da88450`; A11-08/A11-09 shipped through PR #186/main `3ed29e0`.
   A11-10's bounded scale/contrast/status and audio-accessibility slices shipped through
   PR #188/main `089d646` and PR #190/main `bed6ac5`. Preserve their validators and
   fixtures as regression coverage. The six-hero cosmetic pose contract shipped through
   PR #192/main `e8ec79f`; the exact campaign gate shipped through PR #194/main `b1113cf`;
   the Guided Run Path shipped through PR #196/main `5abd6fd`; Collection Growth I-A
   shipped through PR #198/main `454e944`; Collection Growth I-B shipped through
   PR #200/main `a34baca`.
2. **Continue the complete named First Light scope.** A11-01–A11-04, A11-06, and
   A11-07 own AT/modal, cross-tab/tour, hybrid, loading/global-motion, phone/device,
   and effective pinch/200% proof. Preserve all shipped A11-10 preferences and finish
   their physical-device/AT evidence; A11-11's existing nine-step chain remains in
   flight with direct blink/Focus/Kindle proof and first-death debrief still open;
   A11-12–A11-13 own Play/Now/Explore hierarchy and lock/source/context work. A11-14
   prevents 1.1 from closing until its exact convergence matrix passes.
3. **Use the grounded delivery evidence.** PR #196/main `5abd6fd` owns the Run Path
   selection/settlement/HUD receipts. PR #198/main `454e944` owns the original all-73
   reachability/source/paging contract. PR #200/main `a34baca` owns the shipped all-103
   source truth, 15 sets, per-hero presets, atomic look transactions, pursuit receipts,
   genuine fur/material/silhouette expansion, six-hero × 27-pose parity, Reduced Effects
   freeze, and fail-closed source/grant/migration behavior. PR #201/main `45f6216` owns
   the shared phone classifier, Character Hero Rites route, and zero-write authority for
   undiscovered relic attunement. The current integrated boundary is **198,687
   assertions**, Collection **10,249**, attachment **7,332**, progression **5,865**,
   Run Path **93,139**, HUD **14,001/180**, gambling **644**, accessibility **310**,
   UX **109**, **25/25** validators, and syntax **170/170**.
4. **Build Collection Completion Truth next; do not recreate I-B.** Preserve PR #192's
   pose/install/browser contract and PR #198/#200 paging, reachability, source,
   attachment, preset, atomicity, Reduced Effects, and no-power contracts. Add broader
   category/set completion analytics and receipts, make the pursuit state easier to act
   on, and decide an explicit Blueprint/direct-price ceiling for random-only Mythics.
   Add no cosmetics, currency, power, odds/pity, Mines, or Battle Pass changes in that
   bounded slice, and do not promote the still-incomplete A11-13 row or broader 2.8.
   Keep A11-11's playable tutorial/first-death debrief moving as release-critical parallel
   work; the permanent chapter shelf, export/recovery, device/AT proof, House V2, High
   Refresh, new maps/classes, and full Fair Forge acceptance remain separate rows.

## Handoff history

| Date | Session/branch | Rows changed | Evidence | Next owner action |
| --- | --- | --- | --- | --- |
| 2026-07-13 | Roadmap expansion / `agent/living-vigil-content-update` | Created ledger; grounded VH-01 and LV-01–LV-08; planned V1–V9 registers through 10.0 | Main `9bb1ca2`, PR #184, working-tree source/validator anchors | Completed by the 1.0.2 delivery reconciliation below. |
| 2026-07-13 | Evidence/count audit / `agent/living-vigil-content-update` | Grounded LV-01–LV-08 evidence; added menu row; raised Shared Flame, Rekindling, and Living Chronicle to the 46-addition floor | Eight targeted validators exit 0: **7,220 total checks** (HUD includes 36 scenarios); durable evidence index at [v1.0.2](evidence/v1.0.2/README.md); full local gate green at that boundary | Completed by the 1.0.2 delivery reconciliation below. |
| 2026-07-13 | Draft publication / `agent/living-vigil-content-update` | Committed and pushed the verified 1.0.2 tranche; opened draft PR #185 | Feature `53db829`; ledger `377ad9b`; draft PR [#185](https://github.com/QemmHD/2dgamerepo/pull/185) | Completed by the 1.0.2 delivery reconciliation below. |
| 2026-07-13 | 1.0.2 delivery reconciliation / `agent/living-vigil-content-update` | Marked LV-01–LV-08 shipped and replaced draft delivery actions | PR #185; feature `53db829`; ledger `377ad9b`; squash main `da88450ce4b223c7866ab0498d9d88a635865da3`; PR/main CI and Pages passed; live 1280×720 canvas/title/Home smoke passed | Preserve shipped fixtures; execute A11 as a separate release tranche. |
| 2026-07-13 | 1.1 accessibility/input grounding / `agent/first-light-accessibility` feature branch | Added A11-01–A11-08; hardened repeat/modal/orphan focus behavior and CI receipts; updated V1-UX and V1-INPUT without claiming gamepad/remapping | Final Node 22 validators **18/18 OK**, syntax **149/149**; accessibility **193**, phone Settings **855**, UX **74**, minigame **14**; real-browser Home focus/activation/back; 844×390/667×375 phone Settings; byte-identical reduced Settings/case; exact harness keyboard/reduced/focus/Mines receipts at `EXC:0` | Pass hosted PR CI, merge, deploy, and smoke this foundation; keep zoom/AT/loading-motion completeness in flight. |
| 2026-07-13 | 1.1 draft publication / `agent/first-light-accessibility` | Committed and pushed the First Light foundation; opened draft PR #186 without promoting incomplete A11 rows | Feature `b06915e`; draft PR [#186](https://github.com/QemmHD/2dgamerepo/pull/186); local Node 22 gates and hosted PR CI run `29299835745` passed | Mark ready, merge, deploy Pages, live-smoke, then reconcile delivery truth. |
| 2026-07-14 | 1.1 foundation delivery reconciliation / `agent/first-light-delivery-ledger` | Marked A11-08 and A11-09 shipped; preserved A11-01–A11-07 proof gaps; added A11-10–A11-14 so the remaining canonical 1.1 contract cannot disappear; identified A11-05 as pulled-forward 1.2 work; added desktop/phone `?dev=1` Settings retention proof | PR #186; feature `b06915e`; squash main `3ed29e0`; PR CI `29299835745`/`29299893474`; main CI `29299938429`; Pages `29299938437`; live 667×375/1280×720 semantic/focus/Run setup/back smoke; zero logs; current phone Settings **860** | Preserve the shipped foundation and dev tools; execute the named proof and feature rows; close 1.1 only through A11-14. |
| 2026-07-14 | A11-10 preference/accessibility delivery / `agent/first-light-preferences` | Kept A11-10 `[~] IN FLIGHT` while shipping its save-safe Combat HUD size 100/115/130, high-contrast post-veil tells, seven source-backed non-color status badges, scaled Living Vigil/HUD lanes, desktop/phone Accessibility settings, semantic actions, guided-tour pane routing, deterministic gates, and truthful `?dev=1` profiler diagnostics. Mono audio, caption detail, independent voice volume, vibration, device/AT, and convergence remain open. | Feature `1cddd9b`; merged PR [#188](https://github.com/QemmHD/2dgamerepo/pull/188); squash main `089d646`; final PR CI `29324773427`; main CI `29324842151`; Pages `29324842057`. Local **19/19** validators and syntax **152/152** passed. Live 1280×720 Accessibility/130%/contrast/keyboard, gameplay all-status, and `?dev=1` General/115%/contrast-off receipts are `EXC:0` with zero logs; all five dev controls remain visible. | Preserve the delivered slice; implement remaining A11-10 controls and device/AT proof separately; keep A11-14/1.1 open. |
| 2026-07-14 | A11-10 audio-accessibility delivery / `agent/first-light-audio-accessibility` | Kept A11-10 `[~] IN FLIGHT` while shipping captions with Essential/Full detail, independent Voice volume, standards-defined mono output, capability-safe touch vibration, hidden-surface voice/caption lifecycle, 667 px caption containment, strict cold-boot receipts, and a real routed Web Audio graph gate. Preserved all five `?dev=1` controls and kept physical-device/AT/A11-14 proof open. | Feature `8fef031`; evidence `5328770`; merged PR [#190](https://github.com/QemmHD/2dgamerepo/pull/190); squash main [`bed6ac5`](https://github.com/QemmHD/2dgamerepo/commit/bed6ac5443e651a61ec90449673db4a967e9abef); PR CI `29330155481`; main CI `29330244561`; Pages `29330244572`. Local **21/21** validators and syntax **157/157** passed. Deployed Accessibility, exact caption, and `?dev=1` receipts are `EXC:0`; durable evidence is indexed at [`evidence/v1.1`](evidence/v1.1/README.md). | Superseded for gameplay sequencing by the completed PR #192 rig and PR #194 exact gate; preserve this audio slice and finish physical-device/AT/zoom plus A11-14 separately. |
| 2026-07-14 | Six-hero cosmetic pose rig delivery / `agent/cosmetic-pose-rig-delivery` | Kept V1-ART `[~] IN FLIGHT` while shipping exact per-hero head/shoulder/hand transforms across gameplay and four menu surfaces; unified all 18 body sheets; made native features, replaceable headwear, and held props pose-safe; added deterministic Blender, install-manifest, PNG-style, contact-sheet, and browser contracts. More cosmetics, boss identities, houses, and device acceptance remain open. | Feature head `20961e8`; merged PR [#192](https://github.com/QemmHD/2dgamerepo/pull/192); squash main [`e8ec79f`](https://github.com/QemmHD/2dgamerepo/commit/e8ec79fe983f108ee5e13963e3565390183c5a82); PR CI `29338059974`; main CI `29338179983`; Pages `29338179872`. Local syntax **162/162**, validators **22/22**, cosmetic contract **4,387**; deployed hero matrix `DONE EXC:0 heroes:6 variants:12 frames:324 replaceable:3` and deployed `?dev=1` Settings `DONE EXC:0` have zero error logs. | Its exact-ledger next action was completed by PR #194/main `b1113cf`, and its guidance alternative by PR #196/main `5abd6fd`; preserve all three contracts and begin genuine collection growth. |
| 2026-07-14 | Exact campaign-map gate delivery / `agent/unique-boss-ledger` | Added V1-CAMPAIGN `[x] SHIPPED` without promoting V1-PROG or the 2.0 arc. Shipped save-v10 per-map unique-boss evidence, conservative legacy migration, fail-closed corruption repair, closed boss provenance, canonical once-only collateral deaths, receipt-driven Play/victory/accessibility/share truth, and a session-only credit-off `?dev=1` map bypass. Guided objectives and new maps remain open. | Feature head `4bff911`; merged PR [#194](https://github.com/QemmHD/2dgamerepo/pull/194); squash main [`b1113cf`](https://github.com/QemmHD/2dgamerepo/commit/b1113cf5b354d189d328dc310520efd455b88f5b); PR CI [`29342507445`](https://github.com/QemmHD/2dgamerepo/actions/runs/29342507445); main CI [`29342595438`](https://github.com/QemmHD/2dgamerepo/actions/runs/29342595438); Pages [`29342595535`](https://github.com/QemmHD/2dgamerepo/actions/runs/29342595535). Local syntax **159/159**, validators **23/23**, campaign **319**, integration **161**, combat **65**, sanitizer adversarial **40,960**; partial/third-unlock/QA/reload/direct-boss/gameplay browser receipts and deployed Play/`?dev=1` receipts were `DONE EXC:0` with zero error logs. | Its guided-objective next action was completed by PR #196/main `5abd6fd`; preserve both independent receipt authorities and keep V1/2.0 open. |
| 2026-07-14 | Guided Run Path delivery / `agent/guided-run-path` | Added V1-GUIDANCE `[x] SHIPPED` without closing A11-11, full 1.1/1.3, V1-PROG/HUD, the 1.0 → 2.0 arc, or 2.0. Shipped one current task at a time as the path advances Orientation/Tactic/Climax from 26 deterministic mode/capability-aware candidates, safe fallbacks, exact progress/action/current potential coin reward, held Run Path coin settlement, 35 terminal-derived Deeds XP per eligible completed phase (maximum 105 before the shared Deeds cap), atomic bounded save-v10 coin receipts, active-task `O` recall, onboarding precedence, announcements, and responsive sole-owner HUD. Debug Mode/`showDebug`, map bypass, and live debug actions disable Run Path coin settlement and objective-derived Deeds XP; `?dev=1`/QA alone does not. A non-terminal abort—including restart or pause-menu abandon—and reload forfeits held Run Path coins without objective XP; a valid terminal resolution settles. | Merged PR [#196](https://github.com/QemmHD/2dgamerepo/pull/196); squash main [`5abd6fd`](https://github.com/QemmHD/2dgamerepo/commit/5abd6fd1e0c5e06652a244951cb282d973a23f3c); PR CI [`29363043049`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363043049); main CI [`29363172352`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363172352); Pages [`29363172362`](https://github.com/QemmHD/2dgamerepo/actions/runs/29363172362). Local **184,139** assertions, Run Path **93,139**, HUD **14,001/180**, validators **24/24**, syntax **166/166**; exact target viewports, the all-26 static wide-font next-action gate, and seven representative real-Chromium states passed. Deployed desktop, Stormwing phone, and five-control `?dev=1` receipts were `DONE EXC:0` with zero logs and are recorded in [`evidence/v1.1/guided-run-path-deployed-smoke.md`](evidence/v1.1/guided-run-path-deployed-smoke.md). | Preserve the shipped objective/coin-settlement/HUD contracts; begin Collection Growth I while A11-11 tutorial/debrief and remaining First Light proof stay explicitly open. |
| 2026-07-14 | Collection Growth I-A delivery / `feature/collection-growth-ia` | Kept V1-ECO/V1-PROG/V1-ART `[~] IN FLIGHT` and A11-13 planned while shipping 73-item/nine-set all-reachable Collection pages, category/ownership/source filters, paged Boutique stock/sets, eight distinct Lanternward/Duskmoth looks, real silhouettes/effects across Collection/Boutique/case reels, six-hero × 27-pose attachment parity, Reduced Effects freeze, fail-closed grants, and focus-safe Character → Boutique routing. No schema, power, case odds/pity, Mines stakes, or return changed. | Feature `4047f55`; merged PR [#198](https://github.com/QemmHD/2dgamerepo/pull/198); squash main [`454e944`](https://github.com/QemmHD/2dgamerepo/commit/454e9442ed93dba47a84f469c8e7ed87d3b80f64); PR CI [`29367945521`](https://github.com/QemmHD/2dgamerepo/actions/runs/29367945521); main CI [`29368052366`](https://github.com/QemmHD/2dgamerepo/actions/runs/29368052366); Pages [`29368052435`](https://github.com/QemmHD/2dgamerepo/actions/runs/29368052435). Local **193,879 assertions**, Collection **8,080**, attachment **5,268**/162 frames/810 points, progression **5,313**, Run Path **93,139**, HUD **14,001/180**, gambling **644**/**93%**, UX **97**, accessibility **299**, validators **25/25**, syntax **168/168**; cache-busted game/model/catalog HTTP checks returned 200. PR #199 CI [`29369402619`](https://github.com/QemmHD/2dgamerepo/actions/runs/29369402619) added exact Canvas Character/Lanternward captures, fail-closed pixel gates, hashes, and manual review. | Preserve all I-A reachability/source/attachment/economy boundaries and indexed visual receipts; deliver I-B's separate unreduced 30-look pack and collection stats without claiming full Collection Growth I, A11-13, 1.1, or 2.0. |
| 2026-07-14 | Collection Growth I-B delivery / `feature/collection-growth-ib` | Kept V1-ECO/V1-PROG/V1-ART `[~] IN FLIGHT` and A11-13 planned while fulfilling the unreduced 30-piece commitment as six five-piece sets, 103-item/15-set browsing, six per-hero presets, additive save-v10 migration, atomic look buy/equip, persistent pursuit, exact deterministic/random source guidance, protected procedural fur, and distinct cloak/hat/aura/trail treatments. No power, Battle Pass/achievement reward, case odds/cost/pity/unowned weighting, Mines stake, or return changed. | Feature `418ab77`; merged PR [#200](https://github.com/QemmHD/2dgamerepo/pull/200); squash main [`a34baca`](https://github.com/QemmHD/2dgamerepo/commit/a34bacafac2cd222e0a55c3e94545f6535a3acf2); PR CI [`29373728825`](https://github.com/QemmHD/2dgamerepo/actions/runs/29373728825); main CI [`29373896220`](https://github.com/QemmHD/2dgamerepo/actions/runs/29373896220); Pages [`29373896279`](https://github.com/QemmHD/2dgamerepo/actions/runs/29373896279). Local/hosted **198,394 assertions**, Collection **9,981**, attachment **7,332**/162 frames/810 points, progression **5,860**, Run Path **93,139**, HUD **14,001/180**, gambling **644**/**93%**, UX **100**, accessibility **299**, validators **25/25**, syntax **169/169**. Main artifact `8327157493` and cache-busted deployed source smoke are indexed in [`evidence/v1.1`](evidence/v1.1/README.md). | Preserve I-A/I-B reachability/source/attachment/preset/economy boundaries; build Collection Completion Truth and decide a deterministic ceiling for random-only Mythics without claiming full Collection Growth I, A11-13, 1.1/1.6, 2.0, or 2.8. |
| 2026-07-14 | Phone Character truth correction / `docs/collection-growth-ib-evidence` | Kept V1-ECO/V1-PROG/V1-ART `[~] IN FLIGHT` and A11-13 planned while shipping one resolved phone-landscape classifier, a rich 667×375 Character layout, compact 568×320/480×270 fallbacks, the resolved 932×524.25 COVER fixture, and an accessible Character Hero Rites session pane. Three rites, attunement state, 44 CSS-px Back/purchase targets, semantic actions, Escape/tour routing, discovery-locked relic ATTUNE, and direct zero-mutation/zero-write SaveSystem rejection share one authority. No economy, save schema, developer controls, or `?dev=1` behavior changed. | Merged PR [#201](https://github.com/QemmHD/2dgamerepo/pull/201); squash main [`45f6216`](https://github.com/QemmHD/2dgamerepo/commit/45f62160cc2446d92e8c8bde220c491d5074fb77); accepted PR CI [`29377897747`](https://github.com/QemmHD/2dgamerepo/actions/runs/29377897747)/artifact `8328580576`; final docs-head PR CI [`29378248121`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378248121); main CI [`29378392323`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392323)/artifact `8328741615`; Pages [`29378392313`](https://github.com/QemmHD/2dgamerepo/actions/runs/29378392313). Current **198,687 assertions**, Collection **10,249**, attachment **7,332**/162 frames/810 points, progression **5,865**, Run Path **93,139**, HUD **14,001/180**, gambling **644**, UX **109**, accessibility **310**, validators **25/25**, syntax **170/170**. The main artifact contains exact 667×375 Collection/Rites receipts; this is deterministic production-harness proof, not physical-device, assistive-technology, portrait, or tablet acceptance. | Preserve the shared classifier, safe fallback, Hero Rites/session authority, discovery lock, zero-write rejection, PR #200 economy/source contracts, and `?dev=1`; complete physical-device/AT/portrait/tablet review separately without promoting full Collection Growth I, A11-13, 1.1/1.6, 2.0, or 2.8. |
