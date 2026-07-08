# ENGINE_PROFILER_REPORT

**EMBERWAKE engine bottleneck study — measured, not guessed.**
Branch base: `main` @ `ffb222a` (#158, BOSSFORGE engine foundation #145–#158 shipped).
Data collected with the real `GameLoop` + `FrameProfiler`, headless Chromium, on
`2026-07-08`. All raw data: `docs/perf/profiler-data.json` (+ per-scenario JSON) and
`docs/perf/screens/*.png`. Reproduce with `tools/artshot/measure.sh`.

---

## 0. TL;DR

- **The bottleneck is render-side, and inside render it is the lighting/darkness-veil
  composite — by 30×–50× over every other bucket.** Update-side (weapons, collision,
  targeting, spawner, entities-update) is *negligible* — **≤0.8 ms total even at 113
  enemies**. There is no algorithmic hotspot on the simulation side.
- The lighting cost decomposes cleanly (software raster) into
  **~14.5 ms fixed per-frame floor + ~0.18 ms per visible light**. The **floor is the
  full-screen 1920×1080 veil fill + composite, and it is tier-INDEPENDENT** — no
  current graphics-governor lever reduces it, so the typical frame plateaus at
  ~38 fps median across Tier 0→3 under software raster.
- **Recommended next PR: Option C — render/lighting tuning, scoped narrowly to a
  half-resolution darkness-veil buffer behind the existing quality system.** It is the
  only change the data supports, it attacks the proven tier-independent floor, it
  changes **zero** gameplay/balance/enemy/spawn/weapon/boss/save state, and it is
  visually near-lossless (the veil is a soft low-frequency gradient).
- **Loud caveat:** these absolute FPS numbers are **software-raster worst-case**
  (headless `--disable-gpu`). Canvas `fillRect`/`drawImage` compositing is
  GPU-accelerated on real devices, where the veil floor is ~1–3 ms, not ~14.5 ms. The
  honest, hardware-independent signals are the **relative bucket breakdown**, the
  **update-vs-render split**, and **how cost scales with lights and with the tier
  levers** — all of which point to C. See §7 for the explicit condition under which
  **G (no engine work — pivot to gameplay/content)** is the correct call instead.

---

## 1. Method — and why a new measurement path was needed

**The blocker.** `FrameProfiler` (`src/core/FrameProfiler.js`) times the two top-level
phases inside `GameLoop._tick` (`src/core/GameLoop.js:60–75`) — `begin('update')` /
`end('update')` around the fixed-step update, `begin('render')`/`end('render')` +
`frame()` around the render. The existing art harness steps `game.update()` /
`game.render()` **directly**, bypassing `GameLoop`, so the profiler's `update`/`render`
buckets were never opened and the on-screen HUD read `0.00`. (You can see this in
`docs/perf/screens/s3_dense90.png`: the bottom-left `PROFILE ms` panel reads `0.00`
across the board — that frame came from the old bypass path.)

**The fix (tooling only — not shipped to the game).** A new `?measure=<sec>` mode in
`tools/artshot/harness.html` mirrors `_tick`'s exact bracketing around **real**
`performance.now()` timing:

1. Boot the real `Game`, `_startRun()`, godmode the player (`damageTakenMul = 0`) so it
   survives — the player still *deals* damage, so combat FX/damage-numbers/particles are
   naturally driven.
2. **Ramp** the sim to a target game-time with `update()` only (render isn't needed to
   build sim state — makes a 90 s ramp cheap), applying the same stress knobs as the QA
   path (`dense`/`pickups`/`dmgnum`/`boss`/`gfxtier`/`map`).
3. **Warm up** 120 frames with `profiler.enabled` (EMA converge + JIT).
4. **Measure** a 240-frame window: `begin/end('update')`, `begin/end('render')`,
   `frame()` — identical to `_tick` — timing each with `performance.now()`, and reading
   `profiler._acc[bucket]` **before** `frame()` zeroes it to keep per-frame per-bucket
   samples.
5. PUT a JSON summary to `serve.py`'s `/__save/<out>.json`.

Chrome is launched **without** `--virtual-time-budget` (virtual time would zero the
wall-clock), `--headless=new`, `--disable-gpu`.

**Statistics — median, not mean.** Under software raster, periodic GC pauses land inside
whichever bucket's `begin/end` straddles them (usually `lighting`, the widest window;
sometimes `entities`). This inflates the **mean/p95/EMA** wildly (e.g. dense-90 `render`
avg 230 ms / p95 641 ms but **p50 35.5 ms**). Every conclusion below uses the **per-frame
median (p50)** as the honest typical-frame signal; means are shown only to expose the GC
tail. This is why the report reports `fpsMedian` as the headline FPS.

**Caveat, restated.** `--disable-gpu` = software rasteriser. Full-screen `fillRect` +
`drawImage` compositing (exactly what the veil does) is the single worst case for
software raster and is ~50–100× slower than a GPU-composited 2D canvas. Treat absolute
FPS as a **floor** (worst plausible device), and trust the **shape** of the data.

---

## 2. Per-scenario results

Median = typical frame. `side` = whether update or render dominates. Full 13-bucket
breakdown in §3; lighting detail in §4.

### Table A — headline

| Scenario | fps med | fps avg | fps min | frame p50 (ms) | frame p95 (ms) | update avg (ms) | render p50 (ms) | dominant | enemies | lights | particles |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|--:|--:|--:|
| 1. Menu idle | 1429 | 13.5 | 0.3 | 0.7 | 1 | 0.00 | 0.7 | render | 0 | 0 | 0 |
| 2. Normal 60 s | 58 | 8.2 | 2.8 | 17.3 | 345 | 0.18 | 17.2 | render | 6 | 7 | 31 |
| 3. Dense 90 s | 27 | 4.3 | 1.5 | 36.5 | 642 | 0.79 | 35.5 | render | 113 | 101 | 34 |
| 4. Pickup-heavy | 36 | 6.5 | 2.2 | 28.0 | 423 | 0.21 | 27.8 | render | 6 | 44 | 38 |
| 5. Damage-num-heavy | 56 | 7.3 | 2.1 | 17.8 | 397 | 0.17 | 17.6 | render | 6 | 5 | 43 |
| 6. Boss warning + fight | 58 | 7.6 | 2.6 | 17.2 | 376 | 0.17 | 17.1 | render | 7 | 7 | 35 |
| 7a. Tier 0 (dense 80) | 33 | 4.8 | 1.4 | 30.5 | 582 | 0.57 | 29.9 | render | 27 | 46 | 217 |
| 7b. Tier 1 (dense 80) | 34 | 5.1 | 1.7 | 29.5 | 550 | 0.53 | 28.9 | render | 76 | 82 | 70 |
| 7c. Tier 2 (dense 80) | 38 | 5.9 | 2.1 | 26.4 | 469 | 0.54 | 25.9 | render | 73 | 59 | 36 |
| 7d. Tier 3 (dense 80) | 38 | 9.3 | 3.3 | 26.3 | 279 | 0.58 | 25.9 | render | 74 | 62 | 53 |
| 8. Mobile (430×932, DPR 3) | 58 | 12.3 | 4.3 | 17.4 | 222 | 0.19 | 17.3 | render | 7 | 8 | 42 |

**Per-scenario notes**

1. **Menu idle.** No world, no veil → 0.7 ms/frame (1429 fps median). Menu render is
   effectively free; the avg (13.5 fps) is one first-frame backdrop-composite outlier.
   Confirms all in-run cost is world rendering, and the veil specifically.
2. **Normal 60 s.** 17.3 ms median (58 fps), 100% render, of which lighting 15.8 ms.
   Update 0.18 ms. This is the baseline in-run frame: **~16 ms is the veil floor.**
3. **Dense 90 s (113 enemies, 101 lights).** Heaviest realistic scene: 36.5 ms median
   (27 fps). Still 100% render; lighting 32.7 ms. Update rises to only **0.79 ms** even
   at 113 enemies + 101 emitters — the simulation does not break a sweat.
4. **Pickup-heavy (44 lights held).** 28 ms median. Each gem/coin is a *light emitter*,
   so lighting climbs to 26 ms — pickups stress lighting, not pickup logic.
5. **Damage-number-heavy (120 numbers held).** 17.8 ms median — barely above baseline.
   Damage numbers are text (no lights); `ui`+`entities` stay sub-ms. Clean contrast with
   #4: **it's the lights that scale render, not entity/text count.**
6. **Boss.** 17.2 ms median — boss warning/telegraph/HUD layers add no measurable render
   cost at spawn. (Harness limitation: the boss spawns ~1000 px off-camera, so this
   measures the boss-fight *systems* being live, not a full on-screen boss melee.)
7. **Tier 0→3 (identical dense-80 load).** The governor comparison — see §5. Median
   improves only 32.8→38.0 fps across all four tiers; the floor resists every lever.
8. **Mobile (DPR 3 portrait).** 17.4 ms median (58 fps) — *better* than desktop dense
   because the veil buffer is device-independent (fixed 1920×1080) and this is a light
   normal run on a small viewport. Confirms the veil floor does **not** scale with DPR.

**Governor behaviour:** in these measurements the tier was *forced* (`gfxtier=N`) for a
clean comparison, so the live hysteresis governor did not auto-switch. Its stability and
readability were validated separately in the earlier visual-QA pass (no flicker; darkness
/biome/photo not reset on tier change; GFXTIER shown in the debug HUD).

---

## 3. All 13 profiler buckets — per-frame MEDIAN ms (p50)

| bucket | Menu | Normal | Dense90 | Pickups | Dmg-num | Boss | Tier0 | Tier1 | Tier2 | Tier3 | Mobile |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| **update** | 0.00 | 0.20 | 0.70 | 0.20 | 0.10 | 0.20 | 0.50 | 0.50 | 0.50 | 0.40 | 0.20 |
| **render** | 0.70 | 17.20 | 35.50 | 27.80 | 17.60 | 17.10 | 29.90 | 28.90 | 25.90 | 25.90 | 17.30 |
| map | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| decor | 0.00 | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 | 0.10 | 0.10 | 0.10 | 0.20 |
| obstacles | 0.00 | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 | 0.10 | 0.20 | 0.20 | 0.20 |
| entities | 0.00 | 0.10 | 0.70 | 0.60 | 0.10 | 0.10 | 0.60 | 0.60 | 0.50 | 0.60 | 0.10 |
| projectiles | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| particles | 0.00 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 |
| **lighting** | 0.00 | **15.80** | **32.70** | **26.00** | **15.80** | **15.80** | **28.00** | **27.10** | **24.30** | **24.10** | **15.90** |
| ui | 0.00 | 0.60 | 0.50 | 0.50 | 0.50 | 0.50 | 0.60 | 0.50 | 0.50 | 0.60 | 0.60 |
| collision | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| weapons | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| spawner | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

**Reading of the table**

- **`lighting` is 89–96 % of `render`** in every in-run scenario, and `render` is
  ~99 % of the frame. Everything else — map, decor, obstacles, entities-draw,
  projectiles-draw, particles, ui — is **≤0.7 ms at the median, most sub-0.1 ms.**
- **Update side is dead flat and tiny.** `weapons`, `collision`, `spawner` are `0.00`
  at the median in *every* scenario, including dense-90 with 113 enemies. The
  `FrameSpatialIndex` (shared per-frame enemy index, #149) and pooled projectiles (#148)
  already did their job — there is nothing left to win there.

---

## 4. The lighting cost model

`src/systems/LightingSystem.js` lays "the Emberlight darkness veil": one offscreen buffer
at a **fixed internal 1920×1080 (~2.07 M px, never ×DPR)**; every frame it
`clearRect` + `fillRect`s a dark radial-gradient veil over the whole buffer, then for
each visible emitter `drawImage`s a cached white mask with `destination-out` to carve a
hole, then `composite()`s the buffer to the screen with one `source-over drawImage` and
(if `colorTint` on) a second `lighter`-blit per light for the warm bloom.

### Table C — lighting bucket detail (ms)

| Scenario | lights | p50 | avg (GC-tail) | p95 | max |
|---|--:|--:|--:|--:|--:|
| Menu idle | 0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Boss | 7 | 15.8 | 130.7 | 374.1 | 390.5 |
| Normal 60 s | 7 | 15.8 | 119.9 | 343.7 | 352.8 |
| Dmg-num | 5 | 15.8 | 135.2 | 394.8 | 469.4 |
| Mobile (DPR 3) | 8 | 15.9 | 79.5 | 220.0 | 231.0 |
| Pickups | 44 | 26.0 | 151.0 | 421.0 | 459.2 |
| Tier 2 (d80) | 59 | 24.3 | 167.1 | 466.9 | 481.3 |
| Tier 3 (d80) | 62 | 24.1 | 105.6 | 276.4 | 301.3 |
| Dense 90 s | 101 | 32.7 | 200.7 | 639.2 | 669.2 |

**Linear fit of the median (software raster):** across 5→101 visible lights the median
lighting cost is **≈ 14.5 ms fixed + 0.18 ms × (visible lights)**:
- 7 lights → 15.8 ms  (14.5 + 7·0.18 = 15.8 ✓)
- 44 lights → 26.0 ms  (14.5 + 44·0.18 = 22.4; +tint/pickup overhead)
- 101 lights → 32.7 ms  (14.5 + 101·0.18 = 32.7 ✓)

Two components, two very different characters:

1. **The fixed ~14.5 ms floor** = the full-screen veil `fillRect` (2.07 M px) + the
   `composite()` `drawImage` (2.07 M px). **Paid every frame regardless of anything.**
   Device-independent (DPR 3 mobile pays the same 15.9 ms as DPR 1 desktop). **No
   graphics-tier lever touches it** (§5).
2. **The ~0.18 ms/light slope** = each emitter's `destination-out` mask blit, plus (when
   `colorTint` on) a second `lighter` bloom blit. Tier 2 disabling `colorTint` roughly
   halves the per-light slope (Tier 2 has *more* lights than Tier 0 yet lower p50).

---

## 5. Does the adaptive graphics governor help? (Tier 0→3, identical load)

| Tier | levers vs full | fps med | render p50 | lighting p50 | lights |
|--:|---|--:|--:|--:|--:|
| 0 | full | 32.8 | 29.9 | 28.0 | 46 |
| 1 | −deco shadows, −particle cap, −pickup lights | 33.9 | 28.9 | 27.1 | 82 |
| 2 | +−colorTint, −maxLights, −weather | 37.9 | 25.9 | 24.3 | 59 |
| 3 | +−DPR (0.7), −damage numbers, −fog, particles min | 38.0 | 25.9 | 24.1 | 62 |

- **T0→T1: essentially no median change** (32.8→33.9 fps). T1's levers (deco shadows,
  particle cap, pickup-light cap) touch buckets that are already sub-ms.
- **T1→T2: the only real median gain** (33.9→37.9 fps) — disabling `colorTint` removes
  the per-light bloom blit (halves the slope).
- **T2→T3: median flat** (37.9→38.0). T3's DPR-0.7 and fog-off cut the **worst frames**
  (T3 avg render 168→107 ms; p95 469→279 ms) but **not the typical frame** — because the
  median is dominated by the fixed 1920×1080 veil fill that DPR does not shrink.
- **Conclusion:** the governor is doing sensible work on the GC tail and the per-light
  slope, but the **typical-frame floor is invisible to it**. Under a genuinely
  software-composited device the game is pinned at ~38 fps median even at maximum
  degradation. **This is the specific gap the recommended PR closes.**

Readability across tiers (screenshots `docs/perf/screens/s7_tier0.png`,
`s7_tier3.png`): EXC 0 both; enemies, telegraph rings, HP/XP, streak banner, GFXTIER
readout all legible at Tier 3. Emergency-but-playable holds.

---

## 6. Bottleneck determination (against options A–G)

| Option | Target | Measured median cost | Verdict |
|---|---|---|---|
| **A** | weapon targeting → FrameSpatialIndex | `weapons` **0.00 ms** (all scenarios) | ❌ Not a bottleneck. Already indexed (#149). |
| **B** | entity/projectile draw path | `entities` ≤0.7 ms, `projectiles` **0.00 ms** | ❌ Negligible. |
| **C** | lighting / render tuning | `lighting` **15.8–32.7 ms** = ~92 % of render | ✅ **The bottleneck, by 30×–50×.** |
| **D** | particle / update cleanup | `particles` 0.1 ms, update total ≤0.8 ms | ❌ Negligible. |
| **E** | UI / debug HUD cost | `ui` ≤0.6 ms | ❌ Negligible. |
| **F** | map / decor / weather render | `map` 0.0, `decor`/`obstacles` ≤0.2 ms | ❌ Negligible. |
| **G** | no engine work — pivot to gameplay | render is fill-rate bound; GPU-cheap | ⚠️ Correct *iff* target devices GPU-composite — see §7. |

The data is unambiguous about *where* the cost is: **render, specifically the lighting
veil.** The only real question is whether that cost *matters on the devices EMBERWAKE
ships to* — addressed next.

---

## 7. Recommended next PR — **Option C, scoped to a half-resolution darkness veil**

> One PR. Narrow. Behavior-preserving for gameplay. Visually near-lossless. Attacks the
> proven tier-independent floor and finally gives the governor a lever on it.

### What & why it's next
The single dominant, tier-independent cost is the **full-screen 1920×1080 veil fill +
composite (~14.5 ms software-raster floor)**. Render the veil buffer at **half internal
resolution (960×540)** and bilinear-upscale it on `composite()`. The veil is a **soft,
low-frequency radial gradient with soft-edged light holes** — halving its raster
resolution is visually near-imperceptible (it effectively adds a sub-pixel blur to
something already blurry), while cutting the fill **and** every per-light mask blit's
fill-rate by **4×**. Expected: floor ~14.5→~4 ms and slope ~0.18→~0.05 ms/light
(software raster); on GPU it simply lowers VRAM/fill pressure. Crucially it is gated by
the existing quality system, so it can be a **new Tier-2/3 lever** (or always-on if
visual review passes at full quality), directly fixing the §5 "floor resists every
lever" gap.

This is authorized under the stated constraint — *"do not tune graphics unless
render/lighting/particles are PROVEN the top bottleneck"* — because §3–§6 prove exactly
that.

### Files to touch (small, contained)
- **`src/systems/LightingSystem.js`** — the only core change. Add a `veilScale`
  (default 1; 0.5 = half-res) to `quality`; size `this.canvas` to
  `INTERNAL_WIDTH*veilScale × INTERNAL_HEIGHT*veilScale`; scale the veil-space
  coordinate math in `addLight()` (the `sx/sy/r` computed against `INTERNAL_WIDTH/HEIGHT`
  must be multiplied by `veilScale`); keep `composite()`'s
  `drawImage(this.canvas, 0,0, INTERNAL_WIDTH, INTERNAL_HEIGHT)` (it already upscales the
  buffer to internal size — verify `imageSmoothingEnabled = true` on that context for a
  clean bilinear stretch). The **tint pass in `composite()` stays in screen space** and
  is unaffected.
- **`src/config/GameConfig.js`** — add `GFX.lighting.veilScale` and wire a per-tier
  `veilScale` into the relevant `GFX.tierDefs` entries (e.g. 1.0 at T0/T1, 0.5 at T2/T3).
  Additive config only.
- **`src/core/GameRender.js`** — `_applyGfxLevel()` already calls
  `lighting.setQuality({...})`; add `veilScale` to that existing call. One-line wiring.
- **`tools/artshot/measure.sh`** (optional) — add a `veilScale` A/B row to quantify the
  win. Tooling only.

### Files NOT to touch (hard boundary)
- Any gameplay/balance/content: `src/content/**` (weapons, enemies, bosses, relics,
  cosmetics, evolutions), `src/systems/WeaponSystem.js`, `CollisionSystem.js`,
  `WaveDirector.js`/`Spawner.js`, `BossDirector.js`, `src/entities/Enemy.js`,
  `Projectile.js`, `Player.js` combat fields.
- `src/systems/SaveSystem.js` and the save schema — **no migration, no version bump.**
- `src/core/GameUpdate.js`, `CombatResolver.js`, `GameInputActions.js`,
  `FrameSpatialIndex.js` — update side is not the problem; leave it.
- The **darkness strength / vignette / color palette** — appearance must not shift; this
  PR changes only the buffer's *resolution*, never its look, strength, or tint.
- The `FrameProfiler` / `GameLoop` timing contract.

### Risk: **LOW–MEDIUM**
Low blast radius (one system + additive config), fully reversible, no state/save/gameplay
touch. The MEDIUM component is purely *visual*: (a) the light holes must land in exactly
the same screen positions after the coordinate rescale — an off-by-`veilScale` bug would
drift every light; (b) the upscaled veil must not introduce visible blockiness or a
seam. Both are caught by the visual tests below. There is also a **photo-mode zoom**
interaction (`addLight` already handles `cam.zoom`) — must re-verify holes track at
zoom ≠ 1.

### Correctness tests required
- `node --check` on the three touched JS files; `node tools/validate-assets.js` and
  `node tools/validate-bosses.js` exit 0 (no content touched, must stay green).
- Harness smoke (`?seconds=20&badge=1`): **EXC 0, enemies > 0** (CI `harness-smoke`).
- **Profiler A/B via `measure.sh`:** re-run scenarios 2/3/4/7 with `veilScale` 1.0 vs
  0.5; assert `lighting` p50 drops materially at 0.5 with **no change to update-side or
  other render buckets**, and that light *count* (`counts.lights`) is unchanged (proves
  we only changed resolution, not what's lit).
- Save round-trip unaffected (no schema field added) — spot-check load of an existing
  save.

### Visual tests required (before merge)
- Debug-HUD screenshots at `veilScale` 1.0 vs 0.5 for: normal run, dense scene, boss,
  pickup-heavy, **photo mode at zoom 0.75 / 1.5**, mobile DPR 3. Eyeball for: (i) every
  light hole in the identical screen position; (ii) no veil blockiness/seam; (iii)
  darkness strength and warm tint visually unchanged; (iv) EXC 0.
- Side-by-side montage saved to `docs/perf/screens/veilscale-ab/` and reviewed
  (adversarial workflow) — reject if the half-res veil is distinguishable at full
  quality; if so, ship it as a Tier-2/3-only lever instead of always-on.

### Rollback plan
Single revert of the LightingSystem + config diff. Or, without reverting: set
`GFX.lighting.veilScale = 1` (and the per-tier entries to 1) — the code path collapses to
today's behaviour exactly (buffer = internal size, no upscale). The lever is
fail-safe-to-1.

### When to choose **G instead** (explicit)
If the team's real-device telemetry shows target devices run a **GPU-composited** 2D
canvas (modern iOS Safari, Chrome/Android with GPU raster — the common case), then the
veil floor is ~1–3 ms there, the game already holds 60 fps, and the adaptive governor
(#157) is sufficient insurance for the rare software-composited outlier. In that world
there is **no engine bottleneck worth a PR** and the correct move is **G** — pivot to
gameplay/content (e.g. the standing #280 held-wand-props task). C remains cheap insurance
and a clean win for low-end/software-composited devices, but is not urgent. **This report
cannot measure real-GPU timing in-container (`--disable-gpu` is forced), so this call
needs one real-device profile before committing engineering time to C.** Recommendation
stands as **C**, contingent on that device check; **G** if the check says GPU-composited.

---

## 8. Verification performed for THIS report

- `node --check` across **all** `src/**` + `tools/**` JS → **0 failures.**
- `node tools/validate-assets.js` → **OK** (11 external assets + 6 registry entries).
- `node tools/validate-bosses.js` → **OK** (12 apex kits telegraph; enraged pools
  resolve).
- Harness measurement mode: **EXC 0** in all 11 measurement runs and all 6 screenshot
  runs; enemies alive in every run (Table A `enemies` column; dense-90 = 113).
- Extracted-module `node --check` of the harness script → OK.
- Evidence committed under `docs/perf/` (per-scenario JSON, combined
  `profiler-data.json`, six debug-HUD PNGs). Raw harness output is git-ignored
  (`__out/`); regenerate with `tools/artshot/measure.sh`.

## 9. Reproduce

```bash
tools/artshot/measure.sh 8140      # ~10 min headless; writes __out/*.json + *.png
# single scenario, e.g. dense stress:
python3 tools/artshot/serve.py 8140 . &
CHROME=/opt/pw-browsers/chromium-*/chrome-linux/chrome
"$CHROME" --headless=new --no-sandbox --disable-gpu --mute-audio \
  --window-size=1600,900 --user-data-dir=$(mktemp -d) \
  "http://127.0.0.1:8140/tools/artshot/harness.html?measure=90&dense=120&warmup=120&window=240&out=dense"
# result: __out/dense.json
```

## 10. Residual risk / honesty notes

- **Absolute FPS is software-raster worst-case** and must not be quoted as the shipped
  experience. The relative breakdown is the durable finding.
- **GC tail is real** and shows up as the p95/avg blow-ups; it is a software-raster +
  per-frame-allocation artifact. The LightingSystem is already allocation-light in
  steady state (cached gradient/masks), so most of the tail is Chromium canvas
  bookkeeping, not game code. Not separately actionable here.
- **Boss scenario undersells a full on-screen boss melee** (boss spawns off-camera in the
  harness). Boss HUD/telegraph layers are tier-independent by construction, so this does
  not change the ranking, but a future harness improvement should camera-frame the boss.
- The `veilScale` idea is **projected** (4× fill-rate math), not yet measured; the C PR's
  first task is the A/B in §7 to confirm the win before broad rollout.
