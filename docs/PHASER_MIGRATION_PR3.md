# Migration PR3 — isolated WebGL bootstrap

## Pre-edit implementation map

Starting main: `33d45b9d4e7aad34e56df701a28ee2a2e3e4d8e9`, verified squash
merge of PR #209. The audit, PR1, PR2, evidence README, all four JSON authorities
and canonical ledger were read before implementation. This is PR3 only.

Official release gate on 2026-09-07: Phaser stable/latest and package metadata
still select **4.2.1**, released 2026-07-09. Tag `v4.2.1` resolves to
`41be1e462bc600064e498cba370bfa8c5c055a22`. The official tagged built artifact is
`dist/phaser.esm.min.js`, not the raw source entry. License: `LICENSE.md`, MIT.

Planned ownership: experimental entry owns one memory backend, real isolated
SaveSystem, silent real AudioSystem, one legacy Renderer/Input/GameLoop shell,
one real EMBERWAKE Game, and one Phaser presentation runtime. Phaser never calls
Game.update or Game.render; the legacy loop never starts. Scene contains only
verification primitives. No gameplay, clock bridge, viewport contract extraction,
asset port, economy, profile, default entry, or PR4 work is authorized here.

The experimental overlay pre-acquires an alpha-enabled 2D context before the real
Renderer requests its context. A small experiment-only Renderer subclass sizes
both surfaces to the bounded stage; it does not implement the future mobile
rotation/cover/safe-area bridge. An early input quarantine stops the existing
window Game/input handlers while preserving native link/Tab defaults. A stopped
loop alone is insufficient: two Enter presses can otherwise launch a real run.

Tests will independently count native save/lock access, browser listener/RAF
lifetime, actual WebGL backend and broad-region pixels, ten boot/render/dispose
cycles, and production plus experiment in separate tabs. The four PR1 authorities
remain immutable. Exactly one new top-level validator raises the total to 40.
Correctness on software WebGL is not hardware/mobile performance evidence.

## Verified engine provenance

Sources checked live before downloading: [official stable release](https://phaser.io/download/stable),
[official GitHub latest release](https://github.com/phaserjs/phaser/releases/latest),
[tagged package](https://github.com/phaserjs/phaser/blob/v4.2.1/package.json),
[tagged dist](https://github.com/phaserjs/phaser/tree/v4.2.1/dist),
[tagged license](https://github.com/phaserjs/phaser/blob/v4.2.1/LICENSE.md), and
[package registry metadata](https://registry.npmjs.org/phaser/latest).
All selected stable **4.2.1**; no newer stable 4.x was found. Release is not a
draft/prerelease. The exact tag commit was independently checked through GitHub.

| File under `src/vendor/phaser/4.2.1/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `phaser.esm.min.js` | 1,377,611 | `f4c5fd140d118c10fa9090641a03c17303bab9bfdc28e0626296777db1bb1bde` |
| `LICENSE.md` | 1,100 | `c3a9ba7e38d4ef33dccf5fdd1046655c63df06714f84776118fe406f43db5cf2` |

These digests were computed from the downloaded exact-commit files, not copied
from the audit or confused with Git blob hashes. Original MIT copyright,
permission notice and disclaimer are intact. `.gitattributes` disables text
conversion for this immutable directory. The validator independently pins both
hashes and checks the provenance's repository/tag/commit/path/date/upgrade gate.
No package manager, package manifest, lockfile, bundler, CDN or raw source build
was introduced. All browser imports remain same-origin relative ESM.

## Exact changed-file inventory

This tranche changes exactly these 19 files; no preexisting `src/` file changes:

- `.gitattributes`
- `.github/workflows/ci.yml`
- `docs/DEVELOPMENT_LEDGER.md`
- `docs/PHASER_MIGRATION_PR3.md`
- `phaser.html`
- `src/phaser/main.js`
- `src/phaser/PhaserRuntime.js`
- `src/phaser/WorldScene.js`
- `src/phaser/Receipt.js`
- `src/phaser/experiment.css`
- `src/platform/MemoryStorage.js`
- `src/vendor/phaser/4.2.1/phaser.esm.min.js`
- `src/vendor/phaser/4.2.1/LICENSE.md`
- `src/vendor/phaser/4.2.1/provenance.json`
- `tools/artshot/phaser-harness.html`
- `tools/artshot/phaser-browser.mjs`
- `tools/artshot/verify-phaser-runtime.mjs`
- `tools/artshot/capture-harness.mjs`
- `tools/validate-phaser-runtime.js`

## Implemented ownership and boundary

`phaser.html` -> `src/phaser/main.js` -> exact local vendor import ->
`PhaserRuntime` -> one real dormant Game plus one presentation Scene.
The public entry, not duplicated harness markup, owns the visible experiment.
The sibling harness embeds that exact page and can inspect teardown before
discarding its iframe. Production never imports this tree.

- Main owns reversible host guards, the early input quarantine, error/pagehide
  listeners, one MemoryStorage, the runtime lifetime and detached publication.
- Runtime owns real isolated SaveSystem, real silent AudioSystem, real legacy
  Renderer/Input/three input devices/GameLoop, one Game and one Phaser.Game.
  Injected save/audio remain borrowed by Game and are disposed once by runtime.
- Phaser owns presentation RAF/scene/camera/graphics/textures. It has NoAudio,
  no default physics, no keyboard/mouse/touch/gamepad input, and no simulation
  reference in WorldScene. The only Scene.update work animates the test spark.
- The legacy loop never starts. Real Game update/render are counted fail-fast
  tripwires, not a second stepping path; both counters remain zero. Two trusted
  Enter presses cannot launch a run. Time stays zero and screen stays `start`.
- World is the distinct lower WebGL canvas; overlay is an alpha-enabled actual
  2D canvas above it with transparent CSS. Both use exactly the same stage bounds.
  The empty surfaces are noninteractive/hidden from accessibility; the native
  shell link owns keyboard focus. The experiment does not claim a playable HUD.
- The basic stage uses DPR 1 and a bounded viewport-relative height. Resize
  updates the backing buffers together. This does not extract or reproduce
  production portrait rotation, cover cropping, safe areas or touch projection.
- Experimental haptics have no native navigator and are Off. This prevents an
  otherwise real `vibrate(0)` cleanup request in an untouched iframe; production
  haptics and saved settings are unchanged.

The initial built-in textures, verification graphics and circulating spark are
not new game assets. No Pyra, map, house, enemy, weapon, lighting or UI port exists.

### Storage and uncancellable work

The exact unmodified engine evaluates `!!localStorage.getItem` once as a feature
probe during import. For **only that vendor import**, main exposes its empty
MemoryStorage through a counted facade. `engineMemoryFacadeAccesses` is **1**;
the native storage getter is never evaluated. The compatibility window closes
in `finally` before any Game module import. Thereafter any global storage attempt
is counted and denied. Host locks are denied throughout. SaveSystem still receives
explicit memory and `participation: 'isolated'`; the facade does not replace its
real validation, mutation or lifetime boundary.

Real SaveSystem's initial probe invokes memory set/remove: `memoryWrites=2`.
Those are mutation API calls in the sandbox, not player-profile writes or a
persisted experimental run. Runtime host accesses and independently instrumented
native getter/read/write/request counts are all **zero**. No production lock
participant is created; unsupported isolated lock authority is not faked.

Dynamic module imports cannot be cancelled. Disposal keeps the isolation guards
installed until the pending import settles and skips Game imports/construction
after cancellation. Likewise it joins Phaser's asynchronous default-texture
`SYSTEM_READY` boundary before destroying initialized managers. This event occurs
after the system scene exists but before user `Scene.create`: a throwing create
handler can abort later `READY` listeners and would otherwise deadlock cleanup.
The promise continuation runs after that synchronous boot stack completes.
A browser/network operation that
never settles may delay that join; the runtime does not restore live storage early
or call incomplete cleanup successful. Paused actual import and pre-first-frame
disposal cases are explicitly exercised.

### Pinned engine teardown adaptation

Tagged `VisibilityHandler` installs an anonymous `visibilitychange` handler and
assigns `window.onblur/onfocus`, without undoing them in normal destroy. The runtime
captures those exact registrations only during synchronous `engine.start`, restores
the temporary registration method immediately, and removes/restores only its own
identities at disposal. The vendor bytes remain unchanged.

Phaser `destroy(true, false)` is deferred. After joining SYSTEM_READY and stopping its
TimeStep, a zero-delta public `step()` consumes **pendingDestroy before Scene.update**
in the pinned implementation. This works while hidden or context-lost and is not
a simulation bridge. Game and remaining borrowed shell/services are then disposed,
listeners detached and both DOM canvases removed. Failure joins propagate; no
death, victory, banking, reward, setting write or fallback runtime is invoked.

## Receipts and real browser evidence

`window.__phaserMigrationReceipt` and the explicit API's `receipt()` return strict
detached JSON. The helper rejects nonfinite numbers, accessors, custom prototypes,
cycles, sparse/extended arrays, functions and hidden/symbol fields. Publication
contains scalar snapshots, never live Game/Scene/save/canvas/context references.
`renderer.contextActive` distinguishes an active context from retained historical
renderer identity after disposal. Boot, dimensions, backend, isolation, input/audio,
simulation call counts, pixels, errors and current owned lifetimes are recorded.

Local Chrome on Windows uses **WebGL 1, ANGLE / SwiftShader Device (Subzero)**.
This proves actual browser software-WebGL correctness, not hardware GPU speed.
The separate capture driver's omitted/`canvas` mode retains its exact legacy
`--disable-gpu` arguments. Explicit `webgl` omits that flag; `webgl-software`
uses ANGLE/SwiftShader explicitly. The new verifier records its actual flags and
renderer identity, rather than inferring the backend from launch arguments.

Final local evidence is under ignored `__out/phaser-runtime-independent-final/`
(JSON, live, failure, framebuffer and production PNGs), with earlier samples in
`__out/phaser-runtime-root/`, and
`__out/pr3-capture-cli/`. The existing capture CLI also successfully completed
the real sibling harness in explicit software-WebGL mode. Screenshot content
was visually inspected; these are not pixel-perfect golden images.

| Gate | Local result |
| --- | --- |
| Ten boot/render/dispose cycles | Every cycle: one Game while alive; zero Game/participants/listeners/RAF/canvases/scenes/textures after awaited disposal. Native probe checks before iframe removal; property handlers restored. |
| Independent PNG proof | 960x346 actual WebGL framebuffer: 332,160 nonblack/opaque pixels; >1,900 center ember pixels and >200,000 dark border/background pixels. Broad regions and variance, not exact antialiasing equality. |
| Stacking/resize | Alpha=true, transparent CSS, identical lower/upper CSS bounds; independent resize observes 897x307 then 960x346 buffers without canvas accumulation. |
| Keyboard | Trusted Enter twice leaves dormant Game unchanged; native Tab reaches OPEN CANVAS VERSION. No simulation call or duplicate gameplay input. |
| Separate production tab | One actual 2D Canvas; real native save writes/sole native lock holder; working trusted input; exactly one actual AudioContext; no Phaser imports/downloads/WebGL. |
| Coexistence | Production profile bytes and sole lock client unchanged before/during/after experimental lifetimes and failure/cancellation probes. Not full cross-tab transaction parity. |
| Four PR1 baselines | 16 fresh-process Node fixtures and 12 browser captures match the immutable Node/browser authorities; no Phaser simulation comparison is claimed. |
| Full regression | All 40 top-level validators pass sequentially after the final runtime fixes (39 retained plus one new); complete logs in __out/pr3-final-validator-pass/. Before implementation, all 39 established validators and 205 preexisting syntax modules passed. |
| New permanent validator | 703 checks at this candidate boundary; 40 total top-level validators. No old validator or PR1 source/evidence is replaced. |
| Final syntax gate | 214/214 current source/tool JavaScript modules pass, including the exact vendored ESM. |
| Classified failures | Blocked vendor import, unavailable WebGL, injected real SaveSystem constructor failure and injected Scene.create failure settle as engine-import, webgl-unavailable, isolated-save and scene-boot; visible failure/link and zero resources/native access. |
| Interrupted lifetimes | Paused real vendor import keeps host guards until settled and constructs no Game after cancellation. Disposal in the first world-context microtask joins engine readiness; both promises settle with no late RAF/listener resurrection. |

The scene-failure case intentionally produces one matching injected exception;
the verifier rejects any unrelated exception. All normal lifetimes, other failure
paths and production have zero exceptions/rejections. The final suite reran after
the SYSTEM_READY fix; earlier receipts alone were not accepted as final evidence.

### Native context lifecycle

`WEBGL_lose_context` was supported. Actual loss was observed, the page displayed
PHASER EXPERIMENT FAILED, the dormant simulation remained disconnected, native
restore fired, and the verification primitive rendered again. A second native
loss was followed by disposal **while lost**; a late native restoration on the
retained detached canvas did not resurrect Game, Scene, listeners or RAF. These
receipt fields are all true: `lostObserved`, `restoreObserved`,
`renderedAfterRestore`, `safeFailure`, `disposedWhileLost`, `lateRestoreObserved`,
`lateRestoreNoResurrection`. This is a tiny verification scene, not mid-run save,
texture-cache or full-world recovery acceptance.

### PR3 INFRASTRUCTURE MEASUREMENTS

One final local first-cycle sample: artifact **1,377,611 bytes**, graph import/load/
parse/evaluation **340.5 ms**, runtime boot **212.0 ms**, first completed verification
frame **209.3 ms after runtime boot began**, exposed JS heap **20,625,408 bytes**,
and **4** engine textures. Canvas/backing **960x346**; CSS stage **960x345.59375**.
These are sampled elapsed times, not isolated parser CPU timings or a load budget
approval. Module import includes the real Game dependency graph; browser heap is
coarse and includes the document/instrumentation. `preserveDrawingBuffer` is
deliberate for this small infrastructure capture, not a future gameplay default.
Do not compare these numbers or empty-scene FPS with full Canvas gameplay.

## Dedicated 22-risk review

| Risk | Resolution / evidence |
| --- | --- |
| 1. Production import leak | Immutable old-source check, recursive main dependency trace and real index network/context probe. |
| 2. CDN dependency | Local pinned relative imports only; no runtime remote engine URL. |
| 3. Wrong build | Exact official built ESM, tag/commit and independent digest/size pins. |
| 4. Missing license | Full original MIT notice, separate digest and required provenance. |
| 5. Different committed bytes | Scoped -text attributes and staged/committed-byte hash check required at delivery. |
| 6. Live profile access | Explicit real SaveSystem injection; counted vendor-only memory facade; native probes zero. Fixed late-import restoration race. |
| 7. Production lock participation | Isolated mode plus deny guard; same sole production lock client throughout. |
| 8. Two Games | Exactly one real construction; counted active1/retired0 across ten cycles. |
| 9. Early simulation | Scene has no Game reference; stopped legacy loop; update/render tripwires and trusted input checks zero. |
| 10. Audio context | Phaser NoAudio + real AudioSystem contextFactory:null; independent native constructor count0. |
| 11. Physics default | Explicit default:false, actual configuration receipt false; no scene physics/collision usage. |
| 12. Duplicate input | Early experimental quarantine, all Phaser input sources disabled; native link defaults retained. |
| 13. Opaque overlay | Alpha pre-acquisition and transparent CSS verified with real pixels and overlay attributes. |
| 14. Wrong focus owner | Both empty canvases noninteractive; native Tab focuses the normal-game link. |
| 15. Resize canvases | Same two surfaces resize together; independent CSS/backing checks and zero after disposal. |
| 16. Retained RAF | Await SYSTEM_READY, stop TimeStep, consume deferred destroy; actual browser RAF instrumentation zero. |
| 17. Resource/listener growth | Ten before-document-removal lifetimes, texture/scene0 and property restoration. Fixed engine visibility, early-dispose and throwing-Scene.create teardown leaks; all reproduced faults now pass. |
| 18. Software called hardware | Explicit backend/flags; all numbers labeled infrastructure/software correctness. |
| 19. Blank false success | Actual framebuffer readback plus independent PNG decoding and broad region tests. |
| 20. Regenerated goldens | Four JSONs, scenarios, clock, comparator and all PR1 authorities have no diff. |
| 21. Schema change | All preexisting src unchanged, real SaveSystem compatibility/durability and baseline gates retained. |
| 22. Silent fallback | Visible classified FAILED with explicit link; no same-document production boot on failures. |

Review-driven changes also removed experiment-only unactivated vibration cancellation,
aligned harness readiness with the existing CDP driver, and kept pending-import
guards and pre-texture-ready cleanup testable. Failure injections occur only in
the verifier's disposable browser response, never in committed engine/game code.

## Reproduce and deliver

```sh
node tools/validate-phaser-runtime.js
python tools/artshot/serve.py 8130 .
node tools/artshot/verify-phaser-runtime.mjs --chrome="PATH_TO_CHROME" --base-url=http://127.0.0.1:8130 --output=__out/phaser-runtime
```

The complete existing Canvas CI matrix and its four artifact steps remain intact.
A separate focused WebGL step serves root on port 8910 and runs the verifier,
retaining JSON/PNG receipts even on failure. Node stays 22; no frontend build step.

Delivery status: local candidate, not yet shipped. Exact PR/check/merge/main/Pages
identities and hosted verification must be recorded before final completion.

## Exact PR4 handoff and limitations

After PR3's normal delivery, **stop**. PR4 requires a separate explicit request.
Refresh main, recheck this version's provenance and all prior migration evidence,
then implement only the separately scoped single fixed-clock/viewport/input/
retained Canvas UI bridge. Preserve 1/60 simulation, mixed Focus clocks, pause/
hit-stop/visibility, between-tick actions, rotation/safe-area/projection policy
and all five developer Settings controls. Do not use Scene.update(delta) as an
unreviewed replacement accumulator, start two loops, or promote live persistence.

No technical blocker is inferred for planning that separately authorized bridge,
but PR3 does not prove gameplay/render parity, mobile rotation/touch/AT, real-device
performance/thermal behavior, audio listening, complete shader/asset failure,
full run recovery, cross-tab transaction parity or production cutover readiness.
No new art/content, 120 FPS option, roadmap arc or player-facing feature is claimed.
