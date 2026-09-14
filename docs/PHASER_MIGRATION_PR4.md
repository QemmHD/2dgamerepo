# Phaser migration PR4 — shared clock, retained overlay and viewport

Status: locally validated candidate; hosted delivery still pending. PR5 is out of scope.

## Pre-edit implementation map (2026-09-14)

Starting main: `5e0881f47448bfa108021baad987c54f72ff8b98`.
PR #210 is merged. Audit, PR1–PR3 reports, evidence README, all four immutable
JSON authorities and the development ledger were read before implementation.
Clean baseline: 40 validators, 214 syntax files and the PR3 real-browser
coexistence/lifetime/failure/context suite pass. All four PR1 browser scenarios
matched their immutable authorities across three fresh-realm repeats before edits.

| Authority | Current implementation and intended seam |
| --- | --- |
| Clock | `GameLoop.start/_tick/_resetClock` owns 1/60 fixed dt, .1 wall clamp, max 8 steps and retained remainder. Extract its same policy into `processFrame`, retain production error/finally behavior; add external activation without RAF and separate render accounting. |
| Phaser host | Pinned 4.2.1 `TimeStep.step` supplies raw timestamp unchanged to `Game.step` PRE_STEP; delta may be smoothed. PRE_STEP drives shared clock; POST_RENDER paints overlay. Scene update never updates Game. |
| Simulation | `GameUpdateMethods.update` keeps feedback/death/photo/menu/modal/pause/hit-stop precedence; real dt drives time/player/directors/cooldowns while Focus worldDt drives enemies/projectiles/hazards. No gameplay-policy edits. |
| Existing Game | `Game` owns input/action routing, auto-pause, camera, menus and settlement. Replace PR3's dormant tripwires with exactly one active Game, borrowed memory SaveSystem and silent AudioSystem. |
| Canvas presentation | Keep `GameRenderMethods.render` full world pipeline intact. Share its menu and HUD/modal/touch tail with additive `renderOverlay`; preserve post-draw `_refreshMenuFocusAfterRender`. No duplicated UISystem/MenuRenderer. |
| UI | `UIStateBuilder` supplies snapshots; `UISystem.draw` retains game-over/chest/altar/upgrade/pause priority. `MenuRenderer.draw` rebuilds hotspots before focus reconciliation. |
| Photo/card paths | `_snapPhoto` directly calls render and exports one Canvas. Experimental render must route to overlay; diagnostic capture limitation must be explicit, never silently export a false finished world. Production capture stays unchanged. |
| Viewport | `Renderer.resize/_computeSafeArea/clientToInternal` remains the sole 1920x1080, contain/cover, DPR-budget, rotation and safe-area authority. Add detached snapshot/subscription; Phaser Scale.NONE mirrors it. |
| Extra RAF owners | Renderer coalesced resize and 2.5-second rotation hint currently schedule RAF. Add opt-in external presentation processing for experiment only; production defaults stay intact. |
| Camera | `Camera.apply` is authoritative visual transform (rotation around center, shake translation, zoom, camera translation). Derive matrix by recording that method, not copying formulas. Targeting never consumes Phaser transforms. |
| Historical exceptions | Focus/Kindle/player locator, boss arrow and tutorial HUD omit zoom/shake; ParticleSystem omits angle. Preserve these, do not misreport them as projection bugs. |
| Input | Existing Input/KeyboardInput/TouchJoystick/TouchButtons remain owners; their consumable taps must drain once per fixed update. Remove blanket quarantine, scope native shell focus separately, keep Phaser input disabled. |
| Fixtures | PR1 TestClock/action timeline/semantic receipt/comparator and all JSONs are immutable. Fresh realms load assets in original order, deterministic globals precede Game construction, final-only render avoids RNG contamination. Host metadata is separate from unchanged semantic schema. |
| CI | Preserve 40 validators and complete Canvas matrix. Add one top-level PR4 validator and focused real-Phaser browser gate; retain PR3 isolation/failure/context gates with explicit connected-runtime assertions. |

## Acceptance plan

Use actual pinned WebGL with one live Game. Prove all four PR1 semantic authorities
through Phaser-owned frames; compare 30/60/120 cadence and stalls without epsilon
changes. Test modal/Focus/visibility/action ownership and disposal in interrupted
states. Project landmarks through real Canvas and Phaser transforms across zoom,
DPR, contain/cover, desktop and both phone orientations, including synthetic
insets. Capture HOME/PLAY/gameplay/phone/pause/boss overlays and inspect originals.
Record actual backend; software WebGL is correctness, not hardware performance.

## Implemented design

Changed files (all paths repository-relative):

| Group | Files |
| --- | --- |
| Four reviewed shared seams | `src/core/GameLoop.js`, `src/core/Game.js`, `src/core/GameRender.js`, `src/systems/Renderer.js` |
| Presentation contract | `src/systems/ViewportContract.js` |
| Experimental runtime | `phaser.html`, `src/phaser/main.js`, `src/phaser/PhaserRuntime.js`, `src/phaser/WorldScene.js`, `src/phaser/experiment.css` |
| Permanent validators | `tools/validate-phaser-runtime.js`, `tools/validate-phaser-clock-viewport.js` |
| Behavioral helpers | `tools/artshot/phaser-clock-contract.mjs`, `phaser-overlay-contract.mjs`, `phaser-projection-contract.mjs` in the same directory |
| Browser fixtures | `tools/artshot/phaser-simulation.html/.mjs`, `phaser-behavior.html/.mjs`, `phaser-projection-browser.html/.mjs`, `phaser-visual.html/.mjs` |
| Independent browser runners | `tools/artshot/verify-phaser-runtime.mjs`, `tools/artshot/verify-phaser-clock-viewport.mjs` |
| CI and handoff | `.github/workflows/ci.yml`, `docs/DEVELOPMENT_LEDGER.md`, this report |

`GameLoop.processFrame(timestamp)` contains the one original accumulator, FPS
accounting and update-profiler loop. `renderFrame(frame)` preserves the original
captured profiler across phases. Production `_tick` still catches/reports errors
and schedules its next RAF in `finally`. `startExternal` activates the same
policy with `scheduler: external`, without ever allocating a legacy RAF.
No epsilon, lower-delta clamp, remainder discard or timing-rule change was added.

Phaser boots before simulation construction, then one Game borrows one memory
SaveSystem and one AudioSystem with null context factory. Pinned PRE_STEP's raw
timestamp drives fixed updates; POST_RENDER calls the retained overlay. The
Scene only draws detached grid/origin/camera/player/enemy/projectile observations.
It cannot update Game, spawn entities, change targeting or settle rewards.

The verified pinned sources are [TimeStep](https://raw.githubusercontent.com/phaserjs/phaser/41be1e462bc600064e498cba370bfa8c5c055a22/src/core/TimeStep.js),
[Game lifecycle](https://raw.githubusercontent.com/phaserjs/phaser/41be1e462bc600064e498cba370bfa8c5c055a22/src/core/Game.js),
and [Camera](https://raw.githubusercontent.com/phaserjs/phaser/41be1e462bc600064e498cba370bfa8c5c055a22/src/cameras/2d/Camera.js).
No Phaser 3 camera convention was assumed: 4.2.1 includes scroll in the camera
view matrix. The adapter executes real `Camera.apply` against a matrix recorder,
then solves the resulting affine into Phaser camera zoom/angle/scroll, including
the backing-store rounding offset. Simulation input still uses Renderer mapping
and the original unshaken targeting code, not this presentation transform.

Renderer keeps every layout calculation. Its detached snapshot includes logical,
CSS and backing sizes, requested/effective DPR, safe insets, fit/crop, actual
bounds and stage rotation. Subscribers receive independent JSON copies. Scale.NONE
mirrors its size. External presentation processing consumes resize events and the
rotate-hint deadline without Renderer starting another RAF; production defaults
retain their old scheduling behavior.

GameRender's original world body stays intact. Both complete Canvas rendering and
the new overlay entry call the same menu and HUD/modal/touch helpers. Gameplay
overlay uses `clearRect` on alpha-enabled Canvas; menu draws its original opaque
background. Direct experimental `game.render` callers route to overlay too.
Photo freeze/pan/zoom/grid/toolbar survive, but single-surface photo export gives
an explicit unavailable diagnostic notice. World grading, site world-copy and
death/victory world-card minting await a real world presenter/compositor.

Existing input remains the only gameplay owner. Native experiment controls have
a separate focus scope; their browser defaults are not prevented. Leaving Canvas
ownership clears held keyboard/touch actions and photo drag and uses existing
pause behavior, preventing a dropped keyup or native mouseup from leaving movement
or panning stuck. Hover alone does not pause. All Phaser input devices stay off.

## Immutable semantic parity

The dedicated tools realm installs PR1's deterministic globals before Game
imports/construction, after Phaser capability initialization, loads assets in the
original order and dispatches the same actions inside actual shared-loop updates.
It steps the real pinned `Phaser.Game.step` lifecycle with a deliberately wrong
event delta to prove that only the timestamp is authoritative. No direct Game
advance loop, second Game, altered golden, tolerant-path expansion or field ignore
is used. Both browser and independent Node verifier compare the complete receipt.

| PR1 authority | Fixed ticks | Presented frames at 60 Hz | Result |
| --- | ---: | ---: | --- |
| normal-desktop | 600 | 601 | PASS |
| combat-pack | 360 | 360 | PASS, including real death settlement |
| boss-entry | 10,320 | 10,321 | PASS, authoritative warning/spawn route |
| touch-actions | 360 | 360 | PASS, all eight timeline actions |

The immutable builder's legacy `runtime: canvas` field remains unchanged within
the compatibility receipt; the enclosing receipt explicitly identifies the
actual Phaser host, active-Game count and actual update-call count. This is a
schema-compatibility label, not a claim that Canvas scheduled the experiment.

| Touch-actions presentation cadence | Frames to exactly 360 fixed ticks | Most updates/frame | Result |
| --- | ---: | ---: | --- |
| 30 Hz | 181 | 3 | PASS |
| 60 Hz | 360 | 2 | PASS |
| 120 Hz | 721 | 1 | PASS |
| 30 Hz plus 1-second stall | 179 | 6 | PASS |

Binary timestamp accumulation can need an additional presentation at the end;
the test stops at the specified update count rather than changing arithmetic.
Retained backlog remains present when stopped mid-frame. The differential clock
test independently exercises **8** updates with explicit retained backlog; the
natural 1-second stall is clamped to .1 seconds and produces **6**, not falsely
reported as eight. It also preserves a 5-ms remainder and returns from synthetic
900-second hidden time with **zero** catch-up updates on the reset frame.

Scope: these cadence comparisons preserve PR1's final-only Canvas UI rendering
policy. They are not fully deterministic public replay claims. Existing live menu
and chest presentation can consume the shared ambient RNG; separating those
streams requires its own approved compatibility work, not rewritten PR1 goldens.
This is not a 120-FPS product setting or hardware-performance promise.

## Focus, freeze, settlement and lifetime

Five fresh Phaser-hosted behavior realms cover 17 cases each:
paused **292**, hidden **292**, during catch-up **296**, held touch **295**,
modal **292** assertions. They delegate instrumented real phase methods to their
original implementations while recording real dt versus Focus worldDt.
Movement, quick Blink, quick Kindle, hold/release, Focus tap and pause repeat
are checked through actual fixed updates, including multi-update frames.

Menu, pause, blur, hit-stop, level-up, chest, altar, victory, photo and game-over
retain their original freeze/feedback precedence. Death remains authoritative
before overlay freeze. A real test death banks 137 earned fixture coins, records
one run and settles only in memory; the combat PR1 authority separately proves
the original terminal receipt exactly. Host localStorage and production lock
access counters are **0** throughout; reload uses a new memory profile.

The public-entry verifier executes **10** trusted HOME → PLAY → start → movement
→ dispose cycles. Independent native browser probes require one live RAF and,
after disposal, **0** Games/save participants/scenes/textures/listeners/canvases
and **0** Phaser or legacy scheduler chains. Repeated dispose joins the same
promise. The five interrupted-state fixtures also dispatch late inputs/visibility
and frames after teardown and verify no resurrection or additional writes.
The public suite also samples **120** presented transitions: menu samples are
opaque, while gameplay interior samples are transparent on both sampled points
on every frame. Trusted focus/key-release and Photo mouse-release regressions
verify cleanup remains effective after resuming, not merely hidden behind pause.

Import cancellation, early engine boot cancellation, save/scene/WebGL failures,
native context loss/restore and disposal while context-lost remain covered.
Destruction joins engine readiness and in-flight simulation preparation before
restoring native storage guards; deferred Phaser destruction uses its public step.
The coexisting production `index.html` keeps its real AudioContext, native save
bytes and sole origin participation lock; the experiment changes none of them.

## Viewport and visual evidence

Node projection contract: **3,294 checks**, 36 viewport/DPR/safe-area combinations,
2,340 point checks. Actual browser: **12/12** captures and **936** native Canvas
`getTransform` versus actual Phaser camera comparisons. Tested origin, player,
four corners, wall/door boundary, enemy, projectile and touch centers at zoom
.75/1/2, with and without visual shake. Zero and synthetic insets are included.

| Browser shell | Cover/contain sizes | Largest projection error (CSS px) | Layer-bounds mismatch |
| --- | --- | ---: | ---: |
| Desktop | 1280×720 / 2560×720 | 0.000071844 | 0 |
| Phone landscape | 844×390 / 1080×390 | 0.000030466 | 0 |
| Phone portrait | 390×844 / 390×1080 | 0.000030466 | 0 |

Requested DPR 1/2/3 follows the unchanged production budget; requested 3 is
effectively 2 here. Portrait rotates both canvases together with matrix
`(0,1,-1,0,0,0)`; the sibling rotate cue has transform `none`. Input round-trips
through the old mapping. UI's historical unzoomed/unshaken exceptions remain
explicit, not silently forced to the new world-camera convention.

Actual backend: **ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
(0x0000C0DE)), SwiftShader driver)**, WebGL1. This is software correctness evidence,
not physical-phone, GPU throughput, thermal, battery or 120-Hz display acceptance.

Local artifact directories (ignored, reproducible; CI uploads permanent run artifacts):

- `__out/pr4-before-baselines`: 12 pre-edit PR1 browser receipts.
- `__out/pr4-before-phaser`: unchanged PR3 baseline suite.
- `__out/pr4-integrated`: seven semantic/cadence captures, 12 projection captures,
  five behavior captures and their independent aggregate receipt.
- `__out/phaser-pr4-connected-lifetime-final`: public HOME/PLAY/gameplay/pause and
  production screenshots plus native lifecycle/failure/coexistence receipts.
- `__out/pr4-projection`: original-resolution projection review wall.
- `__out/pr4-visual`: desktop/landscape/portrait gameplay, two direct-spawn boss
  HUDs, real warning and phone pause; these are explicitly staged visual fixtures,
  not semantic authority. All seven were reviewed at original resolution. The
  existing boss/wave announcement proximity is retained, not redesigned in PR4.

## Adversarial review

| Requested risk | Evidence / disposition |
| --- | --- |
| 1 Two active frame schedulers | Native pending RAF = 1; Renderer external mode and legacy RAF = 0. |
| 2 Game driven by Scene delta | PRE_STEP timestamp only; tests pass incorrect delta 987654. |
| 3 Variable simulation dt | Every behavior/semantic update asserts exactly 1/60. |
| 4 Smoothed elapsed time | Tagged TimeStep source verified; event delta ignored. |
| 5 More than eight updates | Shared original loop cap; explicit backlog test = 8. |
| 6 Visibility catch-up | 900-second synthetic return reset = 0 updates. |
| 7 Repeated catch-up actions | One Blink/Kindle/Focus consumption under stalled frames. |
| 8 Focus worldDt changed | Delegating real-method probes confirm both clock domains. |
| 9 Canvas regression | Original differential scheduler, unchanged authorities, full Canvas CI matrix retained. |
| 10 Old world covers WebGL | Overlay helper excludes all world calls; direct render binding; native images reviewed. |
| 11 Opaque overlay | Alpha:true + transparent clear + native stacking/projection proof. |
| 12 Missing menu hotspots | Real HOME/PLAY layouts and trusted two-step start; post-draw focus shared. |
| 13 CSS bounds mismatch | 12 actual shells: exact zero difference. |
| 14 Double DPR | Renderer alone computes size; actual camera/native backing comparisons. |
| 15 Single-canvas rotation | Both share stage; native portrait bounds and matrices match. |
| 16 Input mapping changed | clientToInternal authority retained and round-tripped. |
| 17 Shifted Focus targeting | Untouched Game target method; explicit historical exception. |
| 18 Phaser gameplay input | All five device/window input flags false; native legacy input owner. |
| 19 Active-save isolation | Independent native getters/read/write/lock counters all zero. |
| 20 Terminal host writes | Real death settlement only memory; production bytes unchanged. |
| 21 Duplicate restart RAF | Ten fresh active cycles + differential restart ownership. |
| 22 Hidden disposal leak | Dedicated hidden/interrupted teardown and late-event checks. |
| 23 Golden regeneration | Exact Git-hash protection and full unchanged comparator. |
| 24 Diagnostic mistaken for port | Persistent diagnostic/unsaved label and explicit unavailable photo export. |

Additional confirmed finding fixed: native focus could drop a held key's release,
and native mouseup could strand Photo drag. Ownership transfer now clears these
states and uses the existing pause action; a permanent trusted regression covers
the handoff. The experiment label was moved away from health/XP; opening its
details intentionally pauses the run and may overlay the diagnostic world.

## Validation and delivery

Current local boundary: **41/41 validators**, PR3 guard **716** checks, PR4 guard
**3,460** assertions. Syntax **224/224**, including the staged visual helper.
All old 40 validators and the entire Canvas CI browser script remain present;
the 41st validator and focused Phaser CI lane are additive.

Reproduce focused browser acceptance:

```sh
python tools/artshot/serve.py 8140 .
node tools/artshot/verify-phaser-runtime.mjs --chrome=/path/to/chrome --base-url=http://127.0.0.1:8140/ --output=__out/phaser-runtime
node tools/artshot/verify-phaser-clock-viewport.mjs --chrome=/path/to/chrome --base-url=http://127.0.0.1:8140/ --output=__out/phaser-clock-viewport
```

PR, feature/final head, hosted CI, squash SHA, main CI, Pages and deployed smoke
identities are pending and must be reconciled before this candidate is called
shipped. No product-roadmap version milestone is promoted.

## Exact PR5 handoff / stop boundary

Stop after PR4 delivery. Do not replace the production entry or begin content
porting without the next explicit request. PR5 should start from merged PR4,
read this report and preserve all semantic/isolation/lifetime/projection gates.
Its separately approved presentation scope may replace diagnostic primitives;
player/enemy/world art, weapons, particles, lighting, weather, maps, pickups,
hazards and world-card/photo compositing are deliberately not migrated here.
Physical-device input/performance, audible experiment audio and full public
replay/RNG isolation remain separate acceptance work, not implied by these tests.
