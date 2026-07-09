# EMBERWAKE — Engine profiler deep-dive (roadmap #6)

Where the frame budget actually goes, measured with the render-phase timing
profiler shipped in PR #156 and cross-checked against the code. This report
answers the roadmap's standing directive — *diagnose an FPS drop, do not guess*
— and grounds the adaptive-quality governor (PR #157) in the real cost
structure rather than intuition.

**One-line finding:** in a *fill-bound* regime the darkness/lighting composite
is **98–99 % of the render frame**; every other bucket (entities, particles,
obstacles, map, HUD) is sub-millisecond. The governor's biggest lever is
therefore **DPR** (it shrinks the composite target), with the colour-tint pass
a smaller secondary lever — which is exactly the order the T0→T3 tiers shed
them.

---

## 1. Method — how these numbers were produced

- **Instrument:** `src/core/FrameProfiler.js` (PR #156). `begin(name)`/`end(name)`
  bracket a section; `end` *adds* elapsed ms to this frame's accumulator, so a
  bucket entered several times per frame (obstacles ×3, particles ×3, lighting
  ×2, update up to 8 fixed steps) sums correctly. `frame()` folds each
  accumulator into an EMA (`k = 0.12`). Zero-cost when disabled.
- **Driver:** the art harness (`tools/artshot/harness.html`) booted headless
  via Playwright over `file://` (see §9 on why `file://`, not a local server).
  A new `profile=<N>` param (tooling only, off by default) enables the profiler,
  runs `N` measured frames under the injected load, and records
  `game.profiler.ema` plus live entity counts.
- **Two methodology facts that shape every number below:**
  1. The **top-level `update`/`render` buckets are timed only in
     `GameLoop._tick`** (`GameLoop.js:64-75`), never inside `Game.update()/
     render()`. The harness steps the sim *synchronously*, bypassing
     `GameLoop`, so the `profile=` hook **wraps `update()`/`render()` by hand
     and calls `profiler.frame()` itself** — otherwise those totals read zero.
  2. **Sub-buckets are not a partition of `render`.** A large amount of render
     work sits *between* brackets (world bounds, arena ring, hazards, weapon
     visuals/effects, rings, contact flash, weather, hit vignette, damage
     numbers, victory, touch UI, and the player + weapon-FX lights). So
     `map+decor+obstacles+entities+projectiles+particles+lighting+ui` **under-
     counts** `render`; the gap is real cost, not measurement error. `render`
     and `update` are the ground truth; sub-buckets show where the bulk goes.
- **Environment / caveat (read before quoting an absolute ms):** headless
  Chromium with `--disable-gpu` → **Skia CPU software raster**, `DPR = 1`,
  viewport 1600×900. Absolute ms here are a **fill-bound upper bound**, *not* a
  desktop-GPU frame time. On a GPU the full-screen composite is nearly free and
  lighting would *not* dominate. The **relative bucket breakdown is the
  driver-independent signal** — and it is precisely the low-end-mobile /
  high-DPR / integrated-GPU regime the governor exists to protect. Treat "fps"
  columns as `1000 / (update+render)` in software raster, i.e. a stress proxy,
  never a shipping frame rate.

---

## 2. Measured breakdown (software raster, DPR 1)

EMA after 30–60 measured frames under each load. All values in **milliseconds
per frame**; `exc = 0` on every run.

| Scenario | enemies | particles | lights | tint blits | `update` | `render` | `lighting` | `entities` | `ui` | **total** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| baseline (light) | 3 | 30 | 2 | 2 | 0.16 | 139.5 | 138.1 | 0.13 | 0.64 | **139.7** |
| baseline (settled) | 6 | 45 | 6 | 6 | 0.39 | 143.2 | 141.5 | 0.13 | 0.75 | **143.6** |
| heavy (60 inj.) | 65 | 194 | 74 | 74 | 0.73 | 236.2 | 233.2 | 0.84 | 0.71 | **236.9** |
| worst (120 inj.) | 126 | 214 | 98 | 98 | 0.86 | 286.2 | 283.2 | 0.97 | 0.76 | **287.0** |

(`tint blits` = additive colour-tint `drawImage` calls in `composite()`, one per
coloured light — nearly every light here carries a colour, so it tracks
`lights`.)

Bucket columns omitted from the table (`map`, `decor`, `obstacles`,
`projectiles`, `particles`, `collision`, `weapons`, `spawner`) are **all
< 1 ms** in every scenario, including the 126-enemy worst case.

**What this says:**

- **`lighting` is 98.9 %, 98.6 %, 98.5 %, 99.0 %** of `render` across the four
  loads. Nothing else is close.
- **`update` is negligible** (≤ 0.86 ms at 126 enemies): the sim is not the
  bottleneck in any regime — the game is **entirely fill/render-bound** here.
  Enemy AI, collision (broadphase grid, PR #145), and the projectile pool
  (PR #148) keep sim cost flat.
- `entities` grows with enemy count (0.13 → 0.97 ms) but stays trivial — the
  per-enemy sprite blit + HP bar + eye light is cheap.
- **`projectiles` reads ~0** in all scenarios. Not because projectile draw is
  free (it is the most fill-heavy per-entity path — §5), but because in a dense
  swarm bolts **despawn on contact** almost immediately, so few are ever alive
  and on-screen at once. Projectile draw cost is therefore characterised
  **analytically** (§5), not by brute-forcing a live count — see the note in §9.

---

## 3. Why lighting dominates — the composite cost model

The `lighting` bucket brackets exactly two calls (`GameRender.js:72-74` and
`299-302`): `L.beginFrame(camera)` and `L.composite(ctx)`. It does **not**
include the per-emitter `addLight` calls (those fall inside `entities`/
`projectiles`, or — for the player and weapon-FX lights — in no bucket at all).
Its cost splits along a resolution axis (`src/systems/LightingSystem.js`):

- **DPR-independent part — the veil buffer.** `beginFrame` clears and fills a
  dark radial gradient into **one offscreen buffer fixed at `INTERNAL_WIDTH ×
  INTERNAL_HEIGHT` = 1920×1080, never ×DPR** (`LightingSystem.js:36-37`), and
  each `addLight` punches a `destination-out` mask blit of size `(2·r)²`,
  `r = radius·zoom`, into that same fixed buffer. This ~2.07 M-px fill is a
  constant regardless of device — a deliberate choice for mobile-Safari fill
  stability.
- **DPR-*dependent* part — composite + tint.** `composite()` then (a) `drawImage`s
  the 1920×1080 buffer onto the **main canvas** and (b) runs the additive
  colour-**tint** pass (one `lighter` glow blit per coloured light). Both draw
  onto the main ctx **while it still carries the Renderer's `scale =
  (cssW/1920)·dpr` transform** (`LightingSystem.js:145-168`, after
  `GameRender.js:294` restores to that transform). So the composite and tint
  **rasterise into the full backbuffer and scale ~DPR²**.

> **Correction to an earlier draft.** A previous version claimed "the tint pass
> is unaffected by DPR." That is **false**. The tint pass and the veil composite
> both draw onto the DPR-scaled main canvas; only the veil *buffer accumulation*
> (`beginFrame` + `addLight` cutouts) is DPR-independent. §4 confirms this
> empirically.

Per-emitter light caps (`LightingSystem.js:115-118`) — relevant because they
bound the buffer-cutout and tint-blit counts:

- `pickupCap` (default 40) gates **priority-1 only** (gems/coins/heals/chests).
- `maxLights` (default 96) gates **priority-2 only** (enemy eyes, burn glows).
- **priority-0 (player, projectiles, boss, effects) is never capped.**

---

## 4. The governor, decomposed (validates PR #157's tier order)

Same 120-enemy worst-case load, forced to governor tiers T0/T2/T3 via the
harness `gfxtier=` hook. T2 disables `colorTint` and drops `maxLights` to 56 at
**full DPR**; T3 adds the **DPR 1.0 → 0.7** cap on top.

| Tier | what it sheds | DPR | lights | tint blits | `lighting` ms | **total** ms | Δ vs T0 |
|---|---|--:|--:|--:|--:|--:|--:|
| **T0** full | — | 1.0 | 97 | 97 | 293.0 | **297.4** | — |
| **T2** | colour tint off, maxLights 56 | 1.0 | 58 | 0 | 268.9 | **273.2** | −8 % |
| **T3** | + DPR 0.7 | 0.7 | 56 | 0 | 157.0 | **160.5** | **−46 %** |

- **Tint pass + fewer light cutouts (T0→T2, same DPR):** dropping all 97 tint
  blits + 39 fewer light masks cost ~24 ms — a **real but modest ~8 %** lever at
  DPR 1.
- **DPR 1.0→0.7 (T2→T3):** ~112 ms, a **~42 %** cut. `0.7² = 0.49`, and the
  composite/tint (the DPR-scaled part) roughly halves; the residual is the
  DPR-independent 1920×1080 veil-buffer fill, which is why it drops to ~0.58×
  rather than 0.49×. **This is the single biggest fill lever, and directly
  confirms §3's DPR² claim.**

The governor sheds these in the right order: the *cheap-visual-loss* tint first
(T2), the *more-visible* resolution cut last (T3). The cost structure matches
the escalation — with the honest nuance that **on a fill-bound device the DPR
lever (T3) does far more work than the tint lever (T2)**.

---

## 5. Projectile & particle draw — analytic cost (no brute force)

Projectiles never showed up in the measured buckets (§2), but they are the
most fill-heavy *per-entity* draw, so the cost is modelled structurally from
the code rather than by spawning 200 bolts (which is unnecessary — the cost is
provably linear — and was the path the previous session mis-blamed for its
crashes; see §9).

**Per projectile, per frame** (`src/entities/Projectile.js:124-162`), once the
trail saturates (~6 frames of life):

- **6 additive filled circles** (the trail ring buffer, `TRAIL_LEN = 6`):
  `beginPath + arc + fill` under `globalCompositeOperation = 'lighter'`.
- **1 additive `drawImage`** of a cached 128 px radial-glow sprite, scaled to
  ~45 px (the gradient is baked once per colour and cached — **not** a per-frame
  gradient allocation).
- **1 rotated `drawImage`** of the cached head sprite.

= **8 pixel-touching ops, of which 6 (75 %) are additive path fills.** Cost is
**linear O(N)** in *visible* projectiles (`cull()` gate, `GameRender.js:226`)
with a fixed 8-op constant, so worst case follows from weapon cadence × 1.5 s
lifetime — no two-point extrapolation needed or wanted. Note the "6-blit trail"
shorthand is imprecise: the 6 trail elements are `arc+fill` scan-conversions,
which on CPU raster cost **more** per pixel than a bitmap blit (edge coverage +
read-modify-write additive blend). Freshly-fired bolts (`trailLen < 2`) skip
the trail block, so a fresh volley momentarily costs only 2 ops each — 8N is the
steady-state ceiling.

**There is no hard cap on live player projectiles** — the pool preallocates 384
and grows by one on demand (`ProjectilePool.js:16-42`). The "~220 projectiles"
figure in `CLAUDE.md` is not enforced anywhere; the literal `220` constants are
`GFX.particles.max` and the *enemy* `maxAlive` clamp.

**Particles** are hard-capped at `GFX.particles.max = 220` preallocated slots
(`_spawn` drops when full). Each drawn particle is exactly **one `drawImage`** of
a cached glow sprite, batched per compositing layer — which is why 214 live
particles cost ≤ 0.46 ms even in software raster (§2). Weather motes draw
outside the `particles` bucket (`mapRenderer.drawWeather`, unbracketed).

---

## 6. `render` work that no sub-bucket sees

Because sub-buckets aren't a partition (§1), a chunk of `render` is invisible to
them. In profiled runs it stays small (the `render`−Σsub-buckets gap is a few ms
at most here, dwarfed by `lighting`), but it matters when reading the HUD:

- **Unbracketed always:** `beginFrame`/camera transform; `_drawWorldBounds`;
  boss arena ring; `hazardSystem.drawGround`/`drawAbove`; the **player light**
  and **weapon-FX light** `addLight` calls; `weaponSystem.drawWeaponVisuals`/
  `drawEffects`; `_drawRings`; `_drawContactFlash`; `mapRenderer.drawWeather`;
  `_drawHitVignette`; the damage-numbers draw loop; `_drawVictory`; touch
  joystick + Kindle buttons.
- **Unbracketed and debug-only** (so present *only* when the profiler is on,
  since both gate on `showDebug`): `_drawGrid`, `mapRenderer.drawDebug`,
  per-obstacle/entity debug, LOS rays. These inflate the unbracketed remainder
  in profiled runs specifically — worth remembering when reading the live HUD.

Likewise in `update`, only `spawner` (`_updateDirectors`), `weapons`
(`_updatePlayerAndWeapons`) and `collision` (`_resolveCombat`) are bracketed;
`_updateEnemies`, `_updateProjectiles`, hazard sim, pickups, world FX and
cleanup are outside them — so the update sub-buckets also under-sum `update`.

---

## 7. `INTERNAL_WIDTH` / `INTERNAL_HEIGHT` — complete site audit

`INTERNAL_WIDTH = 1920`, `INTERNAL_HEIGHT = 1080` (`GameConfig.js:10-12`) define
the **logical** coordinate space the whole game draws in. There are ~230
references across `src/`. **Exactly one allocates a real pixel buffer**; the rest
are resolution-independent logic/layout that the Renderer's single scale
transform rasterises to the DPR backbuffer. Enumerated so the cost of each class
is unambiguous:

**A. Allocates a pixel buffer (the only fill-cost site):**
- `LightingSystem.js:36-37` — the offscreen veil canvas, fixed at 1920×1080,
  **never ×DPR** (§3). ~2.07 M px, device-independent.

**B. Renderer scale math (does *not* size the backbuffer):**
- `Renderer.js:7-8` store the internal dims; `:79` aspect target; `:127` `scale
  = (cssW/internalWidth)·dpr`. The backbuffer is `round(cssW·dpr) ×
  round(cssH·dpr)` — **window-driven, not `INTERNAL`-driven** (`:124-125`). The
  DPR budget denominator is `cssW·cssH` (`:112`), not `INTERNAL`.

**C. Gameplay-logic / layout in logical space (resolution-independent; DPR
affects them only via the shared transform, never as a buffer size):**
- World↔screen conversion: `Camera.js:82-83,101-102`; `Game.js:1819-1820`.
- Culling half-extents: `FrameSpatialIndex.js:58-59`; `GameRender.js:83-85,657`;
  `WeaponSystem.js:146-147` (auto-target on-screen test);
  `ParticleSystem.js:392-394,424-425` (particle screen-map + cull).
- Full-screen overlays / centering: `GameRender.js:301` (vignette), `:307`
  (weather), `:400-412` (game-over gradient/fill), `:431,:479,:501-502`;
  dozens in `UISystem.js` (e.g. `:793,:1018,:1284,:1614,:1853,:2199` —
  `fillRect(0,0,INTERNAL_WIDTH,INTERNAL_HEIGHT)` + `/2` centering);
  `MenuRenderer.js:143,250,468-470,599,2298`; `MinigameOverlay.js:154,165,209`;
  `PhotoModeController.js:94,157`.
- Touch-control placement: `TouchButtons.js:111-112,137`;
  `TouchJoystick.js:64,66,79`.
- The veil gradient centre: `LightingSystem.js:78-79`.

**D. Dead import:**
- `weapons.js:26` imports both constants and **never uses them** — safe to drop.

**Takeaway:** attributing backbuffer fill cost to `INTERNAL_WIDTH/HEIGHT` is a
category error. The fill levers are **DPR** and the CSS-fit size; `INTERNAL` is
the logical denominator and aspect target, plus the *one* fixed veil buffer.

---

## 8. Hotspots & recommendations

Ranked by measured impact in the fill-bound regime:

1. **The lighting composite/tint is the whole ballgame.** Any further
   fill-bound win comes from this path. The governor already owns the two big
   levers (DPR via T3, tint via T2). A code-level option not yet taken:
   composite the veil at the **fixed 1920×1080 buffer resolution and blit once**
   rather than re-rasterising tint blits at backbuffer DPR — i.e. move the tint
   pass onto `lctx` (DPR-independent) before the single composite. That would
   make the tint lever DPR-independent and cheaper at high DPR. *(Design note,
   not done here — it changes blend ordering and needs its own visual QA.)*
2. **Sim headroom is ample.** `update ≤ 0.9 ms` at 126 enemies means there is
   budget to trade sim for fewer/cheaper lights if ever needed (e.g. merge
   nearby pickup lights) — the inverse of the usual survivor-game worry.
3. **Projectiles are cheap in practice** (despawn on contact) but are the
   highest per-entity fill risk. If a future weapon keeps many long-lived bolts
   on screen, the 6 additive trail fills (§5) become the thing to watch — a
   `lowQuality`/tier lever could drop `TRAIL_LEN` from 6 to 2–3.
4. **Keep the profiler honest.** The debug-only draws in §6 inflate the
   unbracketed render remainder *only while profiling*. When comparing HUD
   numbers, compare like-for-like (both with debug on).

---

## 9. Reproducing this / notes for the next session

- **Run it:**
  ```
  node <driver>.mjs   # in-process nothing; Playwright over file://
  # navigate: file://<repo>/tools/artshot/harness.html?seconds=6&dense=120&pickups=60&dmgnum=40&profile=60&proftag=x
  # then read window.__profile  (ema + counts)
  ```
  The `profile=<N>` harness param is **tooling only, default off** — the CI
  harness-smoke path (`?seconds=20&badge=1`) is byte-for-byte unchanged.
- **Use `file://`, not a local HTTP server.** This environment **kills any
  process that binds a listening socket** (`serve.py`, an in-process
  `http.createServer`, etc. are SIGKILLed → exit 144). Load the harness over
  `file://` with Chromium `--allow-file-access-from-files`; relative ES-module
  imports resolve fine and `window.__profile` is read directly via
  `page.evaluate` (no `fetch`/save round-trip needed). This — **not** projectile
  count — was the true cause of the previous session's repeated exit-144
  crashes; its "150 projectiles OOM the container" diagnosis was wrong (memory
  sat at ~15 GB free throughout).
- **Don't brute-force entity counts to measure fill cost.** Projectile/particle
  costs are linear with fixed per-entity op counts (§5); extrapolate
  structurally, never with a two-point linear fit.
- **Absolute ms are software-raster** (`--disable-gpu`). Report *ratios* and
  *bucket dominance*; only quote absolute frame times as a fill-bound stress
  ceiling, never as shipping fps.
