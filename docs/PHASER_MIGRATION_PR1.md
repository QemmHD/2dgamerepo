# Phaser migration PR 1 — reproducible semantic baseline

## Scope and delivery state

This is testability and evidence work only. **No Phaser dependency, engine entry, scene, renderer, new art, gameplay change, or production RNG/time change is included.** PR 2 requires separate authorization and must not start as part of this delivery.

- Audited base: [`244fcd94d88f3ac1d25ae7e8a19acbab5c059cfc`](https://github.com/QemmHD/2dgamerepo/commit/244fcd94d88f3ac1d25ae7e8a19acbab5c059cfc), merged [PR #207](https://github.com/QemmHD/2dgamerepo/pull/207).
- Architecture context: [Phaser migration audit](PHASER_MIGRATION_AUDIT.md).
- Implementation branch: `codex/migration-pr1-baseline`.
- Implementation/delivery record: [PR #208](https://github.com/QemmHD/2dgamerepo/pull/208), initial implementation commit `5c64979`.
- Local implementation and verification are complete. PR checks, merge state and the post-merge delivery comment provide remote delivery receipts; they are separate from local verification and are linked from the [shared ledger](DEVELOPMENT_LEDGER.md).

`src/`, the existing production entry, `styles.css`, manifest, existing artshot harness/capture driver, and Pages workflow remain unchanged against the base. Weapon/enemy numbers, spawn rates, boss timing, XP, coin rewards, progression, difficulty/Trials, collision, saves, input, graphics, audio, and menu/HUD visuals are deliberately unchanged.

## Exact file inventory

The intended final diff contains **18 files**: ten tools, one CI workflow, this result document, the shared ledger, and five evidence files. The evidence files and ledger are assembled in the same delivery; they are not additional game features.

| File | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Add the two missing/new validator steps; preserve every prior gate. |
| `tools/artshot/migration-baseline.html` | Dedicated, landscape-only test page; not the production entry. |
| `tools/artshot/migration-browser.mjs` | Isolated memory storage, asset loading, real browser Renderer, JSON receipt publication. |
| `tools/artshot/migration-clock.mjs` | Test clock, scheduled actions, reversible test-only unified RNG/wall-clock override. |
| `tools/artshot/migration-fixture.mjs` | Real Game construction, authoritative updates, current Input handler adapter, final-only render. |
| `tools/artshot/migration-node-environment.mjs` | Explicit Node DOM/Canvas stubs, unavailable-image fallbacks, in-memory storage. |
| `tools/artshot/migration-node-runner.mjs` | One fixture in one disposable Node process. |
| `tools/artshot/migration-receipt.mjs` | Detached semantic projection, serialization guards, exact/tolerant field comparison. |
| `tools/artshot/scenarios.mjs` | Four immutable content/action fixture descriptions. |
| `tools/artshot/verify-migration-captures.mjs` | Check three browser receipts per scenario; no screenshot-golden comparison. |
| `tools/validate-migration-baseline.js` | Repeatability, changed-seed, clock, isolation, failure-path, receipt and source-boundary checks. |
| `docs/PHASER_MIGRATION_PR1.md` | This result, verification limits, and bounded handoff. |
| `docs/DEVELOPMENT_LEDGER.md` | Current status, evidence, delivery gates and next authorized action. |
| `docs/evidence/phaser-migration/README.md` | Receipt provenance, reproduction and interpretation notes. |
| `docs/evidence/phaser-migration/normal-desktop.json` | Normal baseline evidence. |
| `docs/evidence/phaser-migration/combat-pack.json` | Controlled combat and actual terminal-settlement evidence. |
| `docs/evidence/phaser-migration/boss-entry.json` | Authoritative first-boss warning/spawn evidence. |
| `docs/evidence/phaser-migration/touch-actions.json` | Scheduled movement/Blink/Kindle handler evidence. |

## Clock and action contract

### Current source trace

The audited base was refreshed before implementation; all 37 existing validator
entry points were read/run and none was replaced by a fixture-only substitute.

| Current modules | Reached path / boundary |
| --- | --- |
| `core/GameLoop.js`, `core/MathUtils.js` | Production RAF accumulator remains 1/60 with the same frame clamp/catch-up limit; `randomRange` and `pickWeighted` still use ambient `Math.random`. |
| `core/Game.js`, `core/RunState.js` | Real constructor, fresh default SaveSystem, `_startRun({campaignEligible:true})`, hero/meta/gear/difficulty application and current run systems. |
| `core/GameUpdate.js` | Preserve terminal/modal/hit-stop early returns; active time advances only beyond those guards, then Kindle/input, directors, player/weapons, enemies, projectiles, hazards, pickups, combat and compaction. |
| `systems/Spawner.js`, `systems/WaveDirector.js` | Real interval/type/elite/bearing/distance rolls and time/pressure wave state, not a replacement spawn model. |
| `systems/WeaponSystem.js`, `systems/CollisionSystem.js`, `core/CombatResolver.js` | Real content-weapon update, projectile pool, collision, deduplicated deaths, Kindle charge, XP/health/coin/drop pipeline. |
| `systems/BossDirector.js`, `systems/BossRushController.js` | Fixed campaign roster and warning-to-`_spawnBoss` pipeline are exercised. Boss Rush's separate controller is traced but **not executed** by these normal-mode fixtures. |
| `systems/SaveSystem.js` | Real mutation/validation/serialization in isolated memory, unsupported-lock branch; combat death reaches run recording, streak, rites, achievements/daily and BP settlement. No live lock/concurrency parity claim. |
| `tools/artshot/harness.html`, `capture-harness.mjs`, CI | Existing static imports/preload, optional fixture mutations, fixed-update loop and CDP readiness capture remain intact. A sibling tools page prevents contamination from that harness's default invulnerability/preference setup. |

Reached ambient randomness also includes enemy attack/animation offsets, AI
weaving, upgrade drafts, critical hits, camera shake, particles, hazards and boss
placement/support. Enemy animation offsets can affect movement, so they are not
silently split into a presentation stream. Existing separately seeded
obstacle/Vigil/Encounter/Bell algorithms are left untouched. `Date.now` reaches
day-based run seeds and terminal streak/daily settlement; `performance.now`
reaches TouchButtons' quick-tap timing. Gambling quota time, real RAF scheduling,
audio scheduling and asset/decode completion are not covered by these fixtures.

`TestClock.advance(n, update, apply)` dispatches scheduled input and invokes the real `Game.update(1 / 60)` exactly `n` times. Tick zero precedes the first update. Receipts report integer `simulationTicks` and `simulationSeconds = simulationTicks / 60`; they do not derive those values by summing floating deltas.

**Game time is a different field.** Menus, death, hit-stop and modal gates can prevent `game.time` from advancing while the harness still issues its scheduled updates. The receipt preserves both values rather than claiming a dead or paused game remained in active simulation.

Actions are plain data: `tick`, `action`, optional `offsetMs`, and movement `x/y`. Equal-tick actions retain their list order. Offsets are in `[0, 1000/60)` and represent input arriving between fixed updates. The Canvas adapter uses current KeyboardInput/TouchJoystick/TouchButtons semantics; shared scenarios do not construct KeyboardEvents or contain Canvas draw calls.

`renderFrame()` calls rendering without calling update and checks that both the test tick count and `game.time` remain unchanged. Its receipt states **zero simulation ticks**. This is not a claim that every presentation field or RNG state remains unchanged: existing drawing can update caches/facing/UI state and consume unified randomness. All four baselines use one final render after their scheduled ticks.

Clock tests cover 60 ticks = 1 second, 600 ticks = 10 seconds, repeated advance calls, between-tick press/release ordering, invalid timelines/counts, and render-time advancement detection. An action/update exception poisons the clock: a partially executed tick cannot be retried or rendered as successful evidence.

## Test-only RNG and wall time

The dedicated runner installs one uint32-seeded stream **before real Game construction and reached gameplay imports**. It replaces `Math.random`, default `Date` construction / `Date.now`, and `performance.now` only in the disposable test realm. Explicit Date arguments retain native interpretation. Visual/wall time can be frozen for the final capture.

Production still uses its existing unified randomness and clocks. There is no new production query switch, import, saved seed, or gameplay-versus-visual stream split. The separate tools page accepts an explicit scenario/seed; ordinary `index.html` never imports this code. Tools may be publicly served by the existing repository-root Pages deployment, so the safety boundary is isolated execution/storage, not a supposedly private URL.

Installation is single-owner and rollback-safe. Original property descriptors are restored on normal exit and failed setup; nested `finally` also restores them if SaveSystem disposal throws. Separate processes/pages are required for scenario repetitions: restoring globals cannot unload ESM dependencies or erase procedural/asset caches.

## Save isolation

Node installs an empty in-memory Storage implementation before importing/constructing Game. Its host-storage guard verifies that a throwing native getter is never accessed and that the original descriptor is restored. The browser test page shadows `localStorage` before gameplay imports, does not read the native getter, and disables Web Locks participation and AudioContext for this disposable page.

The **real SaveSystem still performs real mutations against the isolated memory profile**. A positive `environment.storageWrites` count therefore means memory writes, not writes to a player's browser profile. Terminal latches are recorded as observations, not treated as proof that every underlying write succeeded; accepted results and authority/failure fields are captured separately.

Neither a real profile nor its seed/schema is migrated. Lock-enabled persistent cross-tab behavior remains covered by the existing durability validators, not newly proved by the lock-disabled baseline environment.

## Scenario results

All four fixtures use **seed 207001**, Pyra (`monkey`), Emberwood, Normal difficulty and the current default loadout. Node repeats use the explicitly identified 1920x1080 procedural-stub environment. Browser receipts use 1280x720 except touch-actions at 844x390.

| Scenario | Issued ticks / seconds | Exercised result and limits |
| --- | --- | --- |
| `normal-desktop` | 600 / 10 | Real default run, movement, ordinary spawning and weapon pipeline. Base-seed Node result: 3 kills. |
| `combat-pack` | 360 / 6 | Real slime/bat/brute/crawler pack, automatic fire, collision, damage and kills. Base-seed Node result: 2 kills; player actually dies at approximately **3.433 seconds of game time**. Remaining issued ticks pass through the terminal gate. The receipt captures the real isolated terminal settlement, including zero Battle Pass XP and zero objective reward; this is not a survival or positive-reward fixture. |
| `boss-entry` | 10,320 / 172 | No assignment to game time and no fake boss construction. Real updates reach the first Emberwood BossDirector warning and map-director spawn: **Stormwing Alpha**. Base-seed Node warning tick **9,646**, spawn tick **9,826**; final boss remains alive. Test-only invulnerability and first legal upgrade/chest/altar choices keep the long fixture progressing. Base-seed Node result: 225 kills. |
| `touch-actions` | 360 / 6 | Movement, one actual Blink, and one Kindle quick release whose press/release arrive at offsets 2/8 ms within tick 60. Initial Kindle fill is set to the real ultimate cost. Later hold/release inputs are routed too, but the assertion is one release, not a second charged ultimate or comprehensive aim/refund coverage. Base-seed Node result: 0 kills. |

The permanent validator runs each fixture **three times in fresh Node processes**, then once with seed **207002**: **16 real-Game fixture runs**. Same-seed semantic results match within the declared equality policy; changed seeds alter sampled gameplay-dependent state, not merely the seed field or RNG-call metadata.

Chrome browser captures were separately repeated **three times for each of the four fixtures** and their semantic receipts matched. Combat captures were refreshed after adding terminal-settlement fields; the touch path was directed down into the map so its vertical-movement assertion does not merely push against the starting boundary. These are independent within-environment baselines; **Node and browser receipts are not asserted equal**. Different asset/fallback paths can consume the shared stream differently.

Each committed evidence JSON records the audited base, scenario, seed, tick count, semantic observations, environment/viewport, screenshot availability and limitations. Browser PNG/DOM capture files are local ignored evidence. Screenshots were produced, but are **not deterministic golden images**; the browser verifier compares JSON fields, not PNG hashes.

## Receipt schema and comparison

Version-1 receipts contain runtime/scenario/seed, test ticks/seconds, environment metadata, player position/HP/XP/level/coins/Kindle/Blink state, game time/map/difficulty/wave/kills, active entity counts, ordered owned build IDs/levels, current boss/warning/arena state, overlays, bounded insertion-order enemy samples, action/route observations, and exception/unhandled-rejection counts.

Progression is null when not exercised. When the real terminal path runs, the projection includes its run summary, Battle Pass result, objective settlement, final accepted in-memory save values, authority state and latches. A zero accepted reward is still an observed terminal result. For combat-pack, this avoids hiding actual death/settlement behind a null progression field.

- **Exact:** HP including fractional HP, XP, coins, levels, IDs, phases, counts, active states, meter fill, build slots, progression/rewards, test ticks/seconds and all other fields not explicitly allowlisted.
- **Absolute tolerance `1e-9`:** player/enemy-sample/arena/boss positions, accumulated run time, player Blink cooldown, boss recovery cooldown, and specifically named position/time/cooldown observation fields. No blanket numeric tolerance applies.
- Object-key order is irrelevant; array/weapon-slot order is significant. Differences identify the full field path and expected/actual values.
- Nonfinite numbers, undefined/functions/symbols, accessors, class instances, sparse/extended arrays and cycles are rejected. Nullable IDs are validated and the complete return value is detached. Later mutation of Game or observations cannot change the receipt.

## CI and verification

CI now invokes **38 top-level validators**: all 37 existing scripts plus `validate-migration-baseline.js`. The previous omission, `validate-run-bonus.js`, is added beside progression tests. The new baseline gate follows Run Path validation. No old validator, browser scenario, assertion or artifact step was deleted or weakened; the existing browser block is unchanged.

| Verification | Recorded local result |
| --- | --- |
| Source/tools JS and MJS syntax | **199/199 pass**. |
| Top-level validators | **38/38 pass**, including assets and bosses. |
| Migration final local run | **279 assertions passed**, including 16 fresh-process fixtures and all four committed Node baseline comparisons. |
| Node fixture repetition | Four scenarios x three matching runs; changed seed differs for each. |
| Browser semantic repetition | Four scenarios x three matching Chrome receipts, zero exceptions/rejections. |
| Existing 20-second gameplay harness | `EXC:0`, 9 live enemies in this run. |
| Existing menu harness | `EXC:0`. |
| Existing 844x390 phone, 20 seconds | `EXC:0`, 8 live enemies in this run. |
| Existing 390x844 portrait, 5 seconds | `EXC:0`, 5 live enemies in this run. |
| Existing developer Settings | `EXC:0`; all five `?dev=1` controls retained. |

Local Node is v26.3.0; CI declares Node 22. Enemy counts above are individual smoke receipts, not seeded golden expectations. Full PR CI and post-merge/main/Pages checks remain distinct from local results. Run `git diff --check` and verify the final file inventory before committing.

## Ten-risk adversarial review

| Requested risk | Finding, fix or evidence |
| --- | --- |
| 1. Production RNG changed | No production source/entry diff; a permanent source tripwire rejects imports/references to the deterministic test seam. Default stream/call sites are untouched. |
| 2. Test seed leaks into production | Seed exists only in tools runner/page and detached evidence. No ordinary-production URL switch or saved seed was added. |
| 3. Render-only advances simulation | Clock and game-time before/after checks enforce zero issued ticks. Existing presentation/RNG side effects are disclosed, not mislabeled as total render purity. |
| 4. Actions consumed twice | Ordered cursor tests cover split advances and between-tick quick tap. **Fixed:** failed action/update poisons the clock rather than allowing partial-tick retry. |
| 5. Player SaveSystem mutated | Host storage is never read; real writes target isolated memory. Terminal evidence records actual zero/accepted outcomes without claiming live persistence. |
| 6. State leaks between scenarios | Fresh process/page per repetition; storage starts empty. **Fixed:** rollback-safe deterministic setup, single owner and restoration even when disposal fails. Module-cache reset is not claimed. |
| 7. Receipt retains live objects | Serialization/type guards, nullable-ID validation and detached final return. **Fixed:** plain-object values could previously leak through road/other optional IDs; malformed-ID and post-build mutation tests now cover this. |
| 8. Existing CI weakened | Exactly two validator steps added; all old commands and the full existing browser/artifact block preserved. |
| 9. Wall clock breaks repeatability | Seeded unified stream, controlled Date/performance clock and final-only rendering match across repeats within each environment. No universal cross-backend/asset-timing replay claim. |
| 10. Evidence overstates determinism | Node stubs, asset-enabled browser, godmode boss, terminal combat and handler-based touch limits are explicit. **Fixed:** the new minimal browser page rejects portrait instead of reporting an inverse-rotated input mapping without a rotated shell. Existing production-shaped portrait smoke remains separate. |

All four confirmed review findings were fixed and re-reviewed. The landscape-only guard runs before test storage/runtime construction; this PR does not redesign portrait UI.

## Remaining limits and PR 2 handoff

This is a small semantic baseline, not complete deterministic replay, renderer parity, physical mobile acceptance, or an engine migration. Uncovered areas include continuous/interleaved rendering schedules, every weapon/boss/map/mode, arbitrary asset failure/timing combinations, all positive reward/entitlement workflows in the new fixtures, trusted OS multitouch and latency, audio listening/soaks, GPU performance, thermal/battery behavior and assistive-technology use. Existing specialized validators remain required.

The browser fixture disables audio and live locks; Node intentionally has no raster output. Real gameplay randomness and existing rendering side effects remain coupled. True gameplay/visual RNG separation, save injection/lifetime seams and an eventual Phaser entry belong to separately authorized work with their own parity baselines.

For a later authorized PR 2: read this document, its evidence README/JSON and the shared ledger; refresh main and rerun the 38 validators before changing interfaces. The audit names PR 2 **narrow platform, save sandbox and lifetime seams**. Preserve the four baseline scenarios, equality rules, zero-tick rendering and save isolation. Do not add Phaser or change production RNG merely because this test seam now exists. **Stop after delivery of PR 1 unless the user explicitly requests the next PR.**
