# Migration PR 2: platform and runtime lifetime

## Verified starting point and pre-edit implementation map

Base: `3efcbcff85f4654236ca16375fd1d8075f6d770b`, the verified latest main
and squash merge of PR #208. This delivery is PR 2 only. No Phaser, alternate
entry, second canvas, gameplay changes, art, or presentation changes belong here.
Before implementation, the unchanged 38 validators and 199 syntax checks passed.

### Normal boot subscriptions

| Owner | Installed listeners / callbacks | Existing removal; planned lifetime |
| --- | --- | --- |
| main boot | document `contextmenu`, `dblclick`, startup `DOMContentLoaded` | Anonymous suppression and retained startup function, no boot teardown; retain exact removers and make startup once-only. |
| main orientation | window `touchstart`, `pointerdown`; renderer `onOrientationChange` | Gesture listeners remove themselves on first use; boot cleanup removes any remaining pair and clears only its own orientation callback. |
| main audio hooks | window `pointerdown`, `touchstart`, `keydown` (capture); window `blur`, `focus`; document `visibilitychange` | No cleanup; extract a six-listener install function returning one idempotent disposer. It does not own audio. |
| Renderer | window `resize`, `orientationchange`; optional visualViewport `resize` | Retained callback but no public teardown; boot-owned dispose removes listeners and cancels queued resize/hint RAFs. Gate late orientation-lock resolution. Never remove/hide canvas or alter drawing. |
| GameLoop | document `visibilitychange`; frame RAF | Anonymous listener/untracked frame; boot-owned dispose cancels RAF and removes listener. Stop/start must never leave two frame chains. |
| KeyboardInput | window `keydown`, `keyup`, `blur` | Retained callbacks; add dispose and clear held keys. |
| TouchJoystick | canvas touch start/move/end/cancel; window blur; document visibility and gesture start/change/end | Touch/blur/visibility callbacks retained, gesture callback local; retain all nine and remove exactly those, clear active touch. |
| TouchButtons | canvas touch start/move/end/cancel; window blur; document visibility | Last two anonymous; retain all six, clear IDs and every consumable action (including reset's Kindle-cancel latch). |
| Input | window keydown/pointerdown/touchstart (capture); one modality callback slot | Retained handlers but no teardown; dispose removes three listeners. Token-protected unsubscribe preserves the single-slot API and old callers. Input borrows its three devices. |
| Game | window keydown/mouseup/blur; canvas touchstart/mousedown/mousemove/touchmove/touchend/wheel; document visibility | Ten listeners, anonymous except local autoPause. Record exact registration and remove at disposal; unsubscribe its modality callback. |
| AccessibilityBridge / CaptionSystem / HapticsSystem | No listeners, timers, or RAFs | Bridge owns references and live-region writes, Caption owns queue/onPresent callback, Haptics owns pulse/cooldowns. Cleanup only at actual Game disposal; preserve live Canvas/ARIA behavior. |

There are 45 registrations (46 with visualViewport), including startup and
first-gesture hooks; the latter are transient. AudioSystem also owns its lazy
context, streamed-media callbacks, scheduler, graph and async
loads; these are not extra boot DOM listeners and need separate cancellation.

### Persistence and asynchronous authority

Only SaveSystem directly accesses persistence globals. It uses
`monkey-survivor:save:v1`, participant lock `emberwake:save:v1:participants`,
and transaction mutex `emberwake:save:v1:exclusive`. Its direct storage paths
are probe, load, participation refresh, normal save, stale-writer comparison,
guided-run retirement's latest-payload merge, and guided reward claims.

Asynchronous participants: constructor shared-lock request/readiness and deferred
interrupted-run repair; Blueprint's legacy headless mutex path; browser exclusive
transactions (release own share, non-waiting participant-exclusive lock, nested
transaction mutex, one commit, reacquire share); disposal awaiting readiness or
an already accepted transaction. There is no participation heartbeat timer.
EntitlementTransaction, ShopTransaction, CaseSystem and BattlePassSystem delegate
to these boundaries and need no duplicate storage implementation. Game and
MinigameOverlay retain pending purchase/claim result callbacks, which must not
perform presentation or launch follow-up actions after their runtime is disposed.

The seam will be `new SaveSystem({ storage, locks, participation } = {})`.
Production `auto` keeps lazy browser-global resolution, existing catches, schema,
validation, CAS and lock choreography. Explicit `isolated` requires an injected
backend and never resolves host storage or host locks; cross-tab atomic operations
without real authority fail closed, not with fabricated successful locks.
Private backend metadata must follow transaction drafts so their valid CAS reads
cannot fall back to host storage. Existing durability gates remain unchanged.

### Construction and ownership

Game constructs AccessibilityBridge, Camera, UISystem (and MenuRenderer),
SaveSystem, CaptionSystem, HapticsSystem, MapRenderer, ObstacleSystem,
LightingSystem, ParticleSystem, HazardSystem, AudioSystem, MinigameOverlay and
FrameProfiler. RunState constructs Player, ProjectilePool, FrameSpatialIndex,
LieutenantDirector, Spawner, WeaponSystem, KindleSystem, CollisionSystem,
UpgradeSystem, PassiveSystem, WaveDirector and BossDirector; run routes also
construct their mode controllers. These gameplay/render objects stay internal.

Only optional `services.saveSystem` and `services.audio` will be injected.
Game owns default-created services; injected instances are always borrowed and
must be disposed by the caller. Renderer, Input/devices and GameLoop are also
boot-owned, never destroyed by Game. Accessibility/caption/haptics need cleanup,
not injection. Keep the real AudioSystem with a narrow explicit silent-context
option; preserve Game's menu playlist initialization and its three RNG draws.

`Game.dispose()` will immediately detach owned listeners/subscriptions, disable
future update/render callbacks, detach caption/accessibility state and cancel
owned haptics/audio; its returned promise joins owned asynchronous save/audio
cleanup. It does not invoke death, victory, abandon, settlement, reset, settings,
or reward code. Accepted transactions remain SaveSystem-owned and are allowed to
finish under the existing protocol. Constructor failure must unwind everything
created so far and expose asynchronous cleanup completion without masking the
original error. Borrowed services survive both normal and failed construction.

A careless second boot would duplicate ten Game handlers, 21 input handlers,
loop/resize handlers, focus/audio unlock hooks, Canvas/live-region writers,
music state and save participants. The future experimental page must instead own
one shell and one Game, explicitly provide isolated save/audio, and dispose that
ownership tree before reconstructing. No new production URL switch is planned.

## Implemented contract

```js
// Unchanged production defaults. Browser boot still passes no services.
const game = new Game({ renderer, input, loop });
await game.dispose(); // Game's default save/audio are closed; shell is borrowed.

// A future sandbox owner supplies these explicitly, not via a production URL.
const saveSystem = new SaveSystem({ storage: memory, participation: 'isolated' });
const audio = new AudioSystem({ contextFactory: null });
const sandbox = new Game({ renderer, input, loop, services: { saveSystem, audio } });
await sandbox.dispose();
await Promise.all([saveSystem.dispose(), audio.dispose()]); // caller's services
// Caller separately disposes its input/devices, renderer, loop and audio hooks.
```

SaveSystem accepts `{ storage, locks, participation = 'auto' }`. `auto` preserves
lazy native getters at the original I/O sites; explicit dependencies do not fall
back to globals, even when null/unavailable. `isolated` requires its own non-undefined
storage property and ignores locks entirely, including an options.locks getter.
The helper remains **tools-only** (`migration-storage.mjs`); no shipped memory
backend is needed yet. It implements string Storage semantics with write counting.
No test RNG/time enters `src/`.

Isolated saves use real migration, validation, rollback and synchronous mutations.
Their existing no-lock authority receipt remains `unsupported` while alive.
Cross-tab atomic transactions fail `transaction-lock-unavailable`; this is not
cross-tab concurrency proof. Production durability validators still prove exact
participant/exclusive/mutex behavior, stale authority and once-only commits.

Game injection is limited to **two borrowed services**, save and audio. They are
configured by Game for its current session, so borrowing does not mean two active
Games may safely share one audio/save instance. No ownership-transfer option or
gameplay DI framework was introduced. Internal accessibility, captions and haptics
remain Game-owned. Input borrows its three devices. Browser boot owns the shell,
its orientation callback, splash, suppression listeners and six audio hooks.

Game disposal is synchronous for listener removal and lifetime invalidation,
asynchronous for joining owned cleanup, and returns the same promise repeatedly.
Cleanup errors do not prevent remaining owners from closing; rejected or explicit
false owned-service outcomes reject the join. Failed construction throws an Error
with the original `cause` and an awaitable `cleanup` promise. Main joins it before
rethrowing. Disposed update/render/menu/share callbacks are inert; late purchase,
claim, case, Mines and photo callbacks cannot publish retired-session UI.

Disposal is **not** a run exit: no banking, guided-run retirement, death, victory,
settings write or reward is initiated. An already accepted exclusive transaction
can still finish its single authorized commit; teardown waits for it and prevents
share reacquisition. This is intentionally distinct from cancelling a purchase.

Audio keeps its actual playlist, scheduler, mix and graph. A null context factory
is silent without reading AudioContext globals; an optional factory is lazy.
Disposal is permanent, closes the owned context, cancels scheduler/fades/streams,
detaches callbacks and prevents late resume/decode/fetch completion from reviving
resources. The shell's audio-hook disposer never owns or disposes audio itself.
Accessibility cleanup only detaches owned references/queues/pulses; it does not
remove/hide Canvas, clear shared live regions or change active ARIA/focus behavior.

### Honest cleanup limit

A previously queued production shared-lock request is invalidated immediately,
but `dispose()` joins the host request until it settles/grants. A late grant cannot
read authority, repair the save or retain a participant. A broken/custom manager
that never settles can therefore delay cleanup. We deliberately retained the
original `{ mode: 'shared' }` options: an attempted AbortSignal changed Node's
grant timing and broke an unchanged accessibility-save test. That regression was
reproduced against the base and removed, not hidden by modifying the validator.
Isolated mode has no such request and no such wait. Network audio loads are
aborted/gated, not awaited indefinitely.

## Verification

- Unchanged base: **38/38 validators**, **199/199 syntax**; all four fresh browser
  receipts matched before implementation.
- Implementation: **39/39 validators**, **205/205 syntax**. All 38 old validator
  files are unchanged; CI adds exactly one lifetime step and preserves the full
  previous browser matrix and migration capture gate.
- PR1: **16 fresh-process Node fixtures**, three equal repeats and a changed seed
  for each scenario. **12 fresh Chrome captures**, three per scenario, all match
  both committed browser receipts and their pre-edit captures. Comparison policy,
  actions, seed 207001, tick counts, and all four evidence JSON files are unchanged.
- New lifetime gate passes **601 assertions** across real Game/input,
  save and audio behavioral probes. Ten real Game cycles install/remove 38 listeners
  per cycle including their input/loop/audio shell; cumulative Game tests have
  **507 adds / 507 removes / zero active** (including failure cases). Ten separate
  real shell cycles have **316 adds / 316 removes / zero active**, plus 25 partial
  shell registration failures. Ten six-hook audio cycles have no residual hooks.
- Eleven partial Game failures cover all ten listener positions and borrowed-audio
  configuration failure. Default-owned save participants and audio close; borrowed
  services survive. Queued RAFs and remaining participants both return to **zero**.
- All ten isolated Game cycles record **zero host storage, lock and AudioContext
  getter reads**. Save-specific isolated probes also record zero host navigator,
  nested locks or supplied locks-getter access and zero live lock requests.
  Production-style tests intentionally exercise counted mock host backends; these
  are not player profile accesses or actual browser-origin lock contention.
- Real Chromium Web Audio graph gate: `DONE EXC:0 buses:3 mono:stable voice:mute-safe`.
  Legacy 20-second smoke: `DONE EXC:0 enemies:9`; desktop and emulated-phone
  developer Settings each retain all five controls with `EXC:0`.
  Actual `index.html`/`main.js` boot in a fresh Chrome profile has exactly one
  1280x720 Canvas, 106 PNG/WebP asset resources, working trusted keyboard focus
  (`Focused: Open Run setup`), zero runtime/console/log errors and no HTTP errors.
  No claim of physical-phone/assistive-technology, audible listening, GPU performance,
  arbitrary render-cadence determinism or full migrated renderer acceptance.

Local untracked captures: `__out/pr2-before/`, `__out/pr2-after/`,
`__out/pr2-audio-graph/`, `__out/pr2-final-smoke/`. These are reviewed evidence,
not regenerated golden images.
Player-facing gameplay/render behavior is unchanged in the exercised authorities;
lifetime behavior after explicit disposal is intentionally newly defined.

## Sixteen-risk adversarial review

| Risk | Evidence / resolution |
| --- | --- |
| Default Save accidentally becomes memory | No-argument counted-host backend/key/schema and lock choreography tests pass. |
| Sandbox reads/writes live profile | Throwing host getters remain untouched through ten actual Games and malformed/blocked save probes. |
| Sandbox joins production locks | Isolation returns before either native or supplied lock getter; atomic flow truthfully fails closed. |
| Dispose banks/settles a run | Dead, unprocessed player with unbanked coins: exact save data/write count unchanged; no recorded death. |
| Dispose writes preferences/progression | Both borrowed and default-owned save disposal write-count checks pass. |
| Injected service disposed twice | Cached Game/Save/Audio joins and repeated cleanup are exercised. |
| Borrowed service incorrectly destroyed | Save/audio/Input/devices/renderer/loop ownership checked, including failed construction. |
| Keyboard/touch multiply | Ten cycles plus partial registration tests return to zero; held keys/IDs/action latches clear. |
| Accessibility removed while active | Existing 310-check accessibility gate unchanged; active focus/live regions remain authoritative and disposal preserves DOM attributes/text. |
| Audio hooks duplicate | Ten six-hook cycles fire gestures exactly once and return to zero; stale callbacks are inert. |
| Partial Game leaks | All ten listener failure positions expose/join cleanup; modality and owned participants return to zero. |
| Save participant survives | Held, pending, accepted transaction and finally-reacquiring cases join safely; queued-host wait limitation disclosed above. |
| Global removal shifts PR1 init | All Node and browser receipts match; menu's three RNG draws retained. |
| Golden silently regenerated | Four JSONs, scenarios, clock, receipt comparator and original validator have no diff. |
| Test platform reachable from production URL | Main still constructs default Game; no sandbox query selector, experimental entry or test import. |
| Constructor becomes general DI | Only optional save/audio; pure systems/content/formulas/directors remain internal. |

Review also found late photo-share and Blueprint rejection presentation callbacks;
both now gate disposal. Owned service cleanup failure is propagated instead of
being mistaken for successful cleanup. Targeted delayed-result probes accompany
these guards; none changes an alive purchase or reward decision.
The fixture also propagates false cleanup outcomes, retains original failure
causes and proves deterministic globals restore even when cleanup fails.

## Changed files

- Runtime: `src/core/{Game,GameInputActions,GameLoop,GameUpdate,Input,KeyboardInput,PhotoModeController,TouchButtons,TouchJoystick}.js`;
  `src/main.js`; `src/platform/AudioLifecycle.js`;
  `src/systems/{AccessibilityBridge,AudioSystem,CaptionSystem,HapticsSystem,MinigameOverlay,Renderer,SaveSystem}.js`.
- Tests: `tools/artshot/{migration-browser,migration-fixture,migration-storage}.mjs`;
  `tools/runtime-lifetime-{save,input,audio}.mjs`; `tools/validate-runtime-lifetime.js`;
  `.github/workflows/ci.yml`.
- Handoff: this document and `docs/DEVELOPMENT_LEDGER.md`.

## Delivery and exact PR3 handoff

Delivery: [PR #209](https://github.com/QemmHD/2dgamerepo/pull/209), feature commit
`e0d257d`. Its final checks, merge state and post-merge delivery comment own the
exact CI, squash, main CI, Pages and hosted-smoke identities; this feature-branch
document alone is not proof of deployment. No Phaser dependency, vendor bytes or experimental entry exists
in this change. No product-roadmap row or 1.0–10.0 arc is being marked complete.

After this bounded delivery, **stop**. PR3 needs a separate explicit request.
Then re-read latest main, the audit, both migration results and all four baselines.
Reverify the official pinned built ESM artifact/license/provenance/checksum before
vendoring; the audit's recommendation is a research snapshot, not permission to
silently substitute a new version. PR3 owns only its audited vendor/empty
experimental boot and comparison harness, not a player-facing renderer cutover.
It must construct exactly one Game with explicit isolated storage and controlled
audio, own/dispose its shell, retain legacy entry/defaults and match the existing
semantic authorities. No technical blocker remains for that isolated lifetime;
production cross-tab concurrency, physical-device and renderer parity proof cannot
be inferred from memory-mode fixtures and remain their separate gates.
