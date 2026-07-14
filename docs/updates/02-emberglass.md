# Update #2: EMBERGLASS — The Keeper's Lens

*Era I — The Reforging (update 2 of 20, size S, deps: 1 soft)*

**Value verdict (ADDS):** Verified: zero share/clipboard/export code exists in src/systems today, so the auto-minted death/victory recap card is a genuinely new capability, and the once-built CardCompositor contract is reused by five later updates (3/14/15/19/20), which is real infrastructure value. Skeptic flag: PR2/PR3 (photo mode + 8 filters) is the softest content in the entire sixteen — a single-player web game's photo mode will see thin use; if scope pressure hits, cut filters, never the compositor or the death card.

## What it adds

The game's shareable face: every run now ends with an auto-minted 1200×630 recap card — "PYRA fell at 14:32 to Gravemaw, The Rootbound Tyrant" over a screenshot of the actual death frame — one tap to copy/share/save. Plus the Keeper's Lens photo mode: freeze the fight, detach the camera, hide the HUD, zoom 0.75–2×, cycle eight ember-graded filters, and snap framed shots. Under both sits THE single CardCompositor module with a registered-template contract that updates 3, 14, 15, 19 and 20 will reuse without ever rebuilding share plumbing.

## Design spec

# EMBERGLASS — The Keeper's Lens: implementation spec

Expands roadmap synopsis at `docs/ROADMAP.md:26-30` (photo mode + THE one shared card-compositor, auto-minting a death/victory recap card, reused by 3/15/14/19/20) and the sequencing-spine decision at `docs/ROADMAP.md:165-166`.

All numbers below are **(tunable)** starting values unless stated otherwise.

---

## Part A — CardCompositor: the one shared card module

### A1. Module + API contract (NEW `src/systems/CardCompositor.js`)

A singleton over a lazily-created offscreen canvas, **1200×630** (the OG-image aspect; ~3 MB backing store, created once, never per-frame):

```js
export const CARD_W = 1200, CARD_H = 630;
export function getCardCompositor() { /* lazy singleton */ }

class CardCompositor {
  registerTemplate(id, drawFn)          // drawFn(ctx, data, helpers) — sync, draws the full card
  compose(templateId, data)             // -> the offscreen canvas (sync, ≤3ms budget)
  captureFromCanvas(srcCanvas, cropRect)// stash a cover-cropped screenshot for templates to use as bg
  async toBlob(type = 'image/png')      // canvas.toBlob wrapped in a Promise
  async share({ title, text, filename })// the share ladder below; returns { ok, method }
  download(filename)                    // <a download> + object URL — the always-works floor
}
```

**Share ladder** (every rung returns `method` so the UI can toast what happened):
1. `navigator.canShare({ files })` → `navigator.share` with a `File` from the blob (mobile).
2. `ClipboardItem` — constructed **synchronously inside the tap handler** with a `Promise<Blob>` value (`new ClipboardItem({'image/png': this.toBlob()})`), the only form Safari accepts under its user-gesture rule (desktop; GitHub Pages is HTTPS so the secure-context requirement holds).
3. `download('emberwake-card.png')` fallback.

Canvas is never tainted: the game is fully static/same-origin (no external images — `index.html` loads only `./src/main.js` + local assets), so `toBlob` cannot throw a security error.

**Template helpers** passed to every `drawFn` (this is what makes future cards cheap): `{ drawFrame(ctx, accentColor), drawWordmark(ctx, x, y, size), drawStatChips(ctx, y, chips[]), drawPortrait(ctx, x, y, size, characterId), fmtTime }`. Fonts reuse the menu's forged display face: `DISPLAY_FONT` / `ensureMenuFont()` from `src/assets/MenuFont.js` (already imported the same way by `MenuRenderer.js:32`); `ensureMenuFont` is already no-DOM-safe, which keeps the harness green. Portraits reuse `getHeroFrames` from `src/assets/ProceduralSprites.js` (as `MenuRenderer.js:29` does) drawn with `imageSmoothingEnabled = false` at ~5× for crisp pixels — the hero stays the procedural monkey, never a flat AI sprite.

**Templates registered by THIS update:** `'death'`, `'victory'`, `'photo'`. **Reserved for neighbors** (they call `registerTemplate` themselves, zero compositor changes): `'rite'` (update 3), `'splits'` (14), `'ashrank'`/`'season'` (15), `'race'` (19), `'camp'` (20). The contract is frozen in NEW `docs/CARDS.md` in PR3.

### A2. Card layouts (NEW `src/content/cardTemplates.js`)

Shared chrome: 8px ember frame (2px `#ff9a4a` outer, 6px `#5a2a12` inner) with notched corners (tunable); EMBERWAKE wordmark top-left, `DISPLAY_FONT` 44px `#ffd166` + "HOLD THE LAST LIGHT" 16px letter-spaced sub-line; footer strip 40px tall with map name, difficulty chip, UTC date.

**Death card** (`'death'`):
- Background: the captured death frame (see A4) cover-cropped to 1200×630, darkened with `rgba(10,6,8,0.55)` (tunable) + a bottom-up gradient so text zones read. Fallback (no capture, e.g. headless): flat `#14090b → #2a0f08` vertical gradient.
- Left: 170×170 portrait panel of the run's hero.
- Headline 54px: `PYRA FELL AT 14:32` (character name from `src/content/characters.js:28` etc.; time from `runSummary.time`).
- Killer line 30px: `to Gravemaw, The Rootbound Tyrant` — see A3.
- Stat chips row: `WAVE 14 · LV 23 · 1,204 KILLS · 2 BOSSES · 348 COINS` from `runSummary` fields minted at `src/core/Game.js:2507-2522` (time/level/kills/bossesDefeated/coinsEarned/finalWave/finalWaveName verified present).
- `★ NEW BEST` gold ribbon when `game.newBest` (set at `Game.js:2531`) flags any of time/wave/level/kills — same fields the overlay ribbon reads at `src/systems/UISystem.js:1866-1880`.

**Victory card** (`'victory'`): gold accent frame; headline `PYRA HELD THE LIGHT — 16:40`; receipt-driven sub such as `Emberwood cleared · Hollow Reach unlocked`, or `Emberwood vigil cleared` on a repeat/ineligible clear; same chip row. **Important seam:** `runSummary` does NOT exist when the victory overlay shows, so the mint builds its snapshot from live fields plus the latched run map and accepted campaign unlock receipt. It must never hardcode a destination or infer one from lifetime boss totals.

**Photo card** (`'photo'`): the snap full-bleed, thin 6px frame, wordmark bottom-right at 0.85 alpha (28px), active filter name in small caps bottom-left.

### A3. Killer attribution (NEW plumbing — does not exist today)

`Player.takeDamage(amount)` (`src/entities/Player.js:219`) carries **no source**, so "fell to X" needs a lightweight `game.lastHitBy = { label, epithet, boss }` written at the three damage sinks whenever `dealt > 0`:

1. **Contact:** `CollisionSystem.checkPlayerContact` already tracks `strongestEnemy` (`src/systems/CollisionSystem.js:112-121`) but its return `{killed, hits, playerHit, playerDamageTaken}` (`CollisionSystem.js:162`) drops it — add `strongestType`/`strongestBossName` to the result; Game consumes `playerHit` at `Game.js:3136-3145` and stamps `lastHitBy` there.
2. **Enemy bolts:** `EnemyProjectile` (`src/entities/EnemyProjectile.js:17-38`) gains `opts.sourceLabel` (set by spitter/boss spawn sites from the firer's def); the update loop at `Game.js:2917` sees `dealt > 0` and stamps it.
3. **Hazards:** the five `player.takeDamage` sites in `src/systems/HazardSystem.js:60-167` stamp `game.lastHitBy` with a per-kind label map (`burnGround → 'the burning ground'`, etc. — hazards already receive `game`).

Display names: bosses already have `bossName` + `epithet` (`src/config/GameConfig.js:386-387` — Gravemaw, etc.); trash types have **no display name**, so each `ENEMY` def gains an additive `label` field (`slime → 'Gel Slime'`, `bat → 'Cave Bat'`, `bomber → 'Cinder Bomber'`, …, ~20 entries), fallback = capitalized type id. On death, `_enterGameOver` copies `lastHitBy` into `runSummary.killedBy`. (Attribution is cards-only this update; update 12's Bestiary will reuse the same `label` field — deliberate seam.)

### A4. Auto-mint + death-frame capture

- **Death:** `_enterGameOver` (`Game.js:2474-2550`) sets `this._deathSnapPending = true` after assembling `runSummary`. In `render()`, on the first game-over frame the world still draws fully behind the overlay (the render path falls through to `this.ui.draw(ctx, buildUIState(this))` at `Game.js:3603`); the pending flag captures `renderer.canvas` **before** `ui.draw` runs (world only, no HUD, no overlay), calls `compositor.captureFromCanvas`, composes the `'death'` card, stores `this.mintedCard = { canvas, template: 'death' }`, clears the flag. Cost: one `drawImage` + one compose, once per run.
- **Victory:** minted directly in `_showVictory` (`Game.js:1150`) from the live snapshot (A2); capture happens the same first-frame way before `_drawVictory` (`Game.js:3664`) dims the world at `Game.js:3669-3670`.
- Crop math: main canvas is DPR-scaled 16:9 (`Renderer.js:124-127`); cover-crop to 1.905:1 ≈ take full width, crop `canvas.height − canvas.width·(630/1200)` split evenly top/bottom.

### A5. Share UI

- **Game-over overlay** (`UISystem.js:1842` `_drawGameOverOverlay`): draw the minted card as a live thumbnail **360×189** (tunable) bottom-right above the buttons (it's a canvas — one `drawImage`), plus a `SHARE CARD` button (300×84) added to the existing button row. Hit-testing joins `tryRestartAt` (`Game.js:437-450`) behind the same **0.7s** `gameOverAge` debounce (`Game.js:443`); a new `getShareCardButtonRect()` sits beside `getRestartButtonRect`/`getReturnToShopButtonRect` (used at `Game.js:445-448`). Keyboard: `KeyS` in the gameOver keydown branch (`Game.js:248-257`) — safe there, WASD movement is irrelevant on that screen.
- **Victory overlay:** a fourth 560×96 button appended to `_victoryRects()` (`Game.js:3653-3661`, buttons stack at `top + (h+gap)·n`) and hit-tested in `tryVictoryAt` (`Game.js:405-413`).
- **Toast:** `game.shareToast = { text: 'COPIED TO CLIPBOARD' | 'SHARED' | 'SAVED AS PNG' | 'SHARE FAILED — SAVED INSTEAD', timer: 1.6 }` (tunable), drawn by UISystem, snapshot via `UIStateBuilder` (new fields beside `bpResult` at `src/systems/UIStateBuilder.js:218`).
- Each successful share increments `stats.cardsShared` via the existing `incrementStat` (as used at `Game.js:2497`).

---

## Part B — The Keeper's Lens (photo mode)

### B1. State machine integration

New `game.photoMode = { camX, camY, zoom, filterIdx, hudHidden: true, gridOn: false, toolbarFade: 2.5, returnTo: 'paused' | 'gameOver' }` (null when off).

- **Entry:** (a) new `LENS` button on the pause overlay — a fifth stacked rect `getPauseLensRect() = { x: W/2−240, y: H/2+242, w: 480, h: 64 }` below `getShakeToggleRect()` (`UISystem.js:242-253`; drawn in `_drawPauseOverlay` `UISystem.js:1297+`), hit-tested in `tryPauseOverlayAt` (`Game.js:416-427`); (b) `KeyC` during live gameplay or pause (unclaimed — audit of the keydown handler `Game.js:220-319` shows P/Esc/R/A/B/M/Space/1-3 + dev keys taken); (c) from the **game-over** screen via `KeyC` (inspect your death — the world stays rendered behind the overlay).
- **Freeze:** insert `if (this.photoMode) { this._updatePhotoMode(dt); return; }` into the update early-return chain at `src/core/Game.js:2552-2615`, between the `victory` block (2596) and `paused` (2602). Identical freeze semantics to pause — strictly cheaper than gameplay, so photo mode can never be a perf regression.
- **Exit:** `Escape`/`KeyC`/`EXIT` button → restore `returnTo` state; `camera.follow(this.player)` re-attaches and snaps position + zeroes trauma/offsets (`src/core/Camera.js:29-39` already does all of that); `camera.zoom = 1`.
- Entering detaches the camera (`camera.target = null` — `Camera.update` only tracks when `target` is set, `Camera.js:54-63`) and zeroes `trauma` so no residual shake (`Camera.js:65-77`).

### B2. Free-cam + zoom

- **Pan:** `_updatePhotoMode` reads `this.input.getMovement()` (`src/core/Input.js:7`) — WASD/arrows and the touch joystick both already normalize through it — at **900 px/s ÷ zoom** (tunable). One-finger drag also pans 1:1 (deltas via the `clientToInternal` chokepoint `Renderer.js:210-230`, divided by zoom), so it works through the mobile CSS rotation for free. Clamp to world bounds `±WORLD_WIDTH/2 = ±3600, ±WORLD_HEIGHT/2 = ±2025` (`GameConfig.js:64-65`) minus a 200px margin (tunable).
- **Zoom:** `camera.zoom` (default 1) is NEW — `Camera.apply` (`Camera.js:80-93`) gains a `scale(zoom)` around screen center (same center-translate pattern its shake rotation already uses), and `screenToWorld` (`Camera.js:95-100`) divides by zoom. Range **0.75–2.0**, step ×1.12 per notch (`Q`/`E`, mouse wheel, two-finger pinch by touch-distance ratio) (all tunable).
- **Zoom must thread through every world→screen mapper**, verified: (1) `LightingSystem.addLight`'s screen mapping — the veil buffer is a fixed 1920×1080 screen-space canvas and `composite()` is a plain `drawImage` under the current transform with **no setTransform** (`src/systems/LightingSystem.js:138-144`), so holes must be carved at zoomed positions: `sx = (x − cam.x)·zoom + W/2`, radius ×zoom; (2) `ParticleSystem.drawScreenAdditive` (called at `Game.js:3592`) gets the same mapping; (3) view-extent callers widen by 1/zoom: `mapRenderer.drawBackground/drawDecorations` and `obstacleSystem.forVisible` already take `viewW, viewH` args (`Game.js:3385-3407`) — pass `INTERNAL_WIDTH/zoom`; the `cull` margin at `Game.js:3414` (`CULL_MARGIN = 160`, `Game.js:89`) widens by `(1/zoom − 1)·W/2` when zoomed out. Damage numbers re-apply the camera (`Game.js:3597-3600`) so they inherit zoom automatically. Zoom-out floor 0.75 keeps all margins bounded.

### B3. HUD-off + toolbar

When `photoMode` is active, `render()` skips `this.ui.draw` and the touch-joystick draw (`Game.js:3603, 3607`) and instead draws a minimal toolbar via new `UISystem._drawPhotoToolbar`: bottom-center pill row of five buttons, each **140×72** internal px (tunable): `SNAP · FILTER: <name> · GRID · HUD · EXIT`, plus a top-right `0.75×…2.0×` zoom readout. Toolbar auto-fades after **2.5 s** idle (tunable), reappears on any input, and is **excluded from snaps** (capture happens before it draws, same pending-flag trick as A4). `GRID` overlays rule-of-thirds lines at 0.25 alpha; `HUD` (`KeyH`) re-shows the gameplay HUD for annotated shots. Keys: `Space` = snap, `F` = filter, `G` = grid.

### B4. Filters (NEW `src/content/photoFilters.js`) — from the verified biome grade levers

The biome grade system this reuses, verified: theme object `{ bg, grade, gradeAlpha, groundFill, groundFillAlpha, weather }` (`src/systems/MapRenderer.js:62-64`), ground grade applied at `MapRenderer.js:105-119`, set per-run at `Game.js:838-840`, per-map darkness routed via `lighting.setQuality({strength})` at `Game.js:861-867`.

Filters are **screen-space passes drawn after the veil composite** (`Game.js:3577`) — full-frame fills + composite ops only, zero `getImageData`, so cost is 1-3 fillRects:

| # | id | name | pass | starting values (all tunable) |
|---|----|------|------|------|
| 0 | none | KEEPER'S EYE | — | — |
| 1 | emberheat | EMBERHEAT | `#ff6a2a` source-over | alpha 0.14 |
| 2 | quenched | QUENCHED | `#2a9db0` source-over | alpha 0.12 |
| 3 | gloam | GLOAM | `#6a3bd0` source-over + darkness | alpha 0.16, veil strength ×1.25 |
| 4 | sepia | KEEPER'S SEPIA | gray `'saturation'` fill then `#c8964b` overlay | desat 0.85, tint 0.18 |
| 5 | noir | NOIR | gray `'color'` fill + vignette boost | desat 1.0, vignette +0.2 |
| 6 | parchment | PARCHMENT | `#e8d9b0` `'soft-light'` | alpha 0.22 |
| 7 | forgelight | FORGELIGHT | `#000` `'overlay'` + `#ff9a4a` lighter edges | contrast 0.15, glow 0.08 |

Darkness-touching filters lever `lighting.setQuality` exactly like `Game.js:866` and restore the biome value on exit/cycle. Filter state is run-scoped (never saved). The active filter bakes into photo snaps and stamps its name on the `'photo'` card.

---

## Integration-point summary (all verified this session)

| Seam | Location |
|---|---|
| Pause/overlay early-return chain (photo slot) | `src/core/Game.js:2552-2615` |
| Pause overlay buttons + hit tests | `src/systems/UISystem.js:242-253, 1297+`; `src/core/Game.js:416-427` |
| Game-over overlay + buttons + 0.7s debounce | `src/systems/UISystem.js:1842-2001`; `src/core/Game.js:437-450` |
| runSummary mint (death / victory-leave) | `src/core/Game.js:2507-2522` / `1206-1213` |
| Victory overlay show/draw/rects | `src/core/Game.js:1150-1160, 3653-3701, 405-413` |
| Camera follow/shake/apply/screenToWorld | `src/core/Camera.js:29-39, 42-51, 80-100` |
| HUD draw + touch draw skip point | `src/core/Game.js:3603, 3607` |
| Veil composite (screen-space, no setTransform) | `src/systems/LightingSystem.js:138-144`; called `Game.js:3577` |
| Biome grade levers | `src/systems/MapRenderer.js:62-64, 105-119`; `src/core/Game.js:838-867` |
| Damage sinks for killer attribution | `src/systems/CollisionSystem.js:110-163`; `src/core/Game.js:2917, 3136-3145`; `src/systems/HazardSystem.js:60-167` |
| Save clamp+migrate (additive stats auto-validate) | `src/systems/SaveSystem.js:192-225` (stats loop 208-214) |
| Input chokepoints | `src/core/Input.js:7`; `src/systems/Renderer.js:210-230` |
| UI snapshot | `src/systems/UIStateBuilder.js:14-225` |

## NEW vs REUSED

**NEW modules:** `src/systems/CardCompositor.js` (the one shared compositor). **NEW content/data:** `src/content/cardTemplates.js`, `src/content/photoFilters.js`, `docs/CARDS.md`. **NEW state:** `game.photoMode`, `game.lastHitBy`, `game.mintedCard`, `game.shareToast`, `camera.zoom`. **NEW save keys (additive only, auto-validated numerics):** `stats.cardsShared`, `stats.photosTaken`. **NEW config:** `EMBERGLASS` block in GameConfig + `label` per ENEMY def.

**REUSED/extended:** Game overlay state machine, Camera, UISystem overlays, UIStateBuilder, CollisionSystem/EnemyProjectile/HazardSystem (attribution), MapRenderer grade levers, LightingSystem quality lever, MenuFont display face, ProceduralSprites hero frames, Input/Renderer input chokepoints, artshot harness (verification params). MenuRenderer is untouched except no-op (menu gains nothing this update — camp/gallery surfaces belong to 20/12).

## Edge/failure design (from PR1)

1. **Share API matrix** (iOS ClipboardItem gesture rule, WebViews without `navigator.share` files, Firefox quirks): the ladder always terminates in `download()`; ClipboardItem is built synchronously with a Promise<Blob> in the tap handler; every rung toasts its method so a failure is never silent.
2. **Zoom desyncing the veil/screen mappers:** zoom lives on Camera and is threaded through the exactly-three world→screen mappers enumerated in B2; zoom clamped 0.75–2.0; PR2's gate is harness screenshots at 0.75/1.0/2.0 showing the veil aligned.
3. **Headless/harness safety:** the death-card auto-mint runs on every harness death — all browser APIs are optional-chained, fonts go through the already-guarded `ensureMenuFont`, compose is pure canvas; `EXC: 0` badge is the acceptance gate every PR.
4. **Mobile:** photo mode's sim freeze makes it cheaper than gameplay; toolbar buttons ≥140×72 internal px through the rotated-touch chokepoint; pinch zoom uses two-finger distance ratio, joystick pan reuses `Input.getMovement`.

## PR plan

### PR1 — PR1 — Emberglass I: CardCompositor + auto death/victory cards + share UI

**Goal:** Ship the one shared compositor with its template contract, killer attribution, death-frame capture, auto-minted death/victory cards, and the SHARE button + toast on both end-of-run overlays.

**Files:**
- `src/systems/CardCompositor.js (NEW)`
- `src/content/cardTemplates.js (NEW)`
- `src/core/Game.js`
- `src/systems/UISystem.js`
- `src/systems/UIStateBuilder.js`
- `src/systems/CollisionSystem.js`
- `src/entities/EnemyProjectile.js`
- `src/systems/HazardSystem.js`
- `src/config/GameConfig.js`
- `src/systems/SaveSystem.js`

**Work:**
- CardCompositor singleton: 1200×630 offscreen canvas, registerTemplate/compose/captureFromCanvas/toBlob, share ladder (navigator.share files → sync-gesture ClipboardItem → <a download>), method-typed results
- cardTemplates.js: shared chrome helpers (frame/wordmark/chips/portrait via MenuFont + ProceduralSprites getHeroFrames, smoothing off) + 'death'/'victory'/'photo' templates
- Killer attribution: CollisionSystem returns strongest-enemy info (CollisionSystem.js:110-163), EnemyProjectile opts.sourceLabel (EnemyProjectile.js:17), HazardSystem kind labels (HazardSystem.js:60-167), game.lastHitBy stamped at Game.js:3136/2917, runSummary.killedBy in _enterGameOver; additive `label` per ENEMY def in GameConfig
- Death-frame capture: _deathSnapPending flag captured in render() before ui.draw (Game.js:3603); victory snapshot + mint in _showVictory (Game.js:1150) since runSummary doesn't exist there
- SHARE CARD button + 360×189 card thumbnail on the game-over overlay (UISystem.js:1842+, hit-test in Game.js:437-450 behind the 0.7s debounce, KeyS in Game.js:248-257) and a 4th victory button (Game.js:3653/405); shareToast via UIStateBuilder
- SaveSystem defaultData: stats.cardsShared (numeric — auto-validated by the stats loop, no version bump)

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exit 0
- headless harness ?seconds=35&badge=1 → EXC: 0 (auto-mint runs on the harness death path — proves headless safety)
- Manual: die in a run → thumbnail shows the death frame + correct killer name for contact/bolt/hazard deaths; SHARE copies on desktop Chromium; stub navigator.clipboard away → download fallback fires + toast says SAVED
- Victory path: 3rd-boss clear mints the victory card with correct time/kills before returnToShop

### PR2 — PR2 — Emberglass II: the Keeper's Lens photo mode

**Goal:** Detached free-cam photo mode with world freeze, HUD-off toolbar, zoom threaded through all world→screen mappers, grid, and SNAP minting through the 'photo' template.

**Files:**
- `src/core/Game.js`
- `src/core/Camera.js`
- `src/systems/LightingSystem.js`
- `src/systems/ParticleSystem.js`
- `src/systems/UISystem.js`
- `src/systems/UIStateBuilder.js`
- `src/systems/SaveSystem.js`
- `tools/artshot/harness.html`

**Work:**
- photoMode state + _updatePhotoMode inserted in the update early-return chain between victory and paused (Game.js:2552-2615); entry from pause LENS button / KeyC / game-over; exit restores returnTo + camera.follow(player) (Camera.js:29-39)
- Camera.zoom: scale-around-center in apply() (Camera.js:80-93), divide in screenToWorld (Camera.js:95-100); pan 900px/s ÷ zoom via Input.getMovement + one-finger drag through clientToInternal (Renderer.js:210-230); pinch + Q/E/wheel zoom 0.75–2.0; clamp to world bounds ±3600/±2025 − 200px
- Thread zoom through LightingSystem.addLight screen mapping (composite at LightingSystem.js:138-144 verified transform-inheriting) and ParticleSystem.drawScreenAdditive; widen drawBackground/forVisible view args + cull margin by 1/zoom (Game.js:3385-3414)
- HUD-off: skip ui.draw + touch draw (Game.js:3603/3607) in photo mode; UISystem._drawPhotoToolbar (SNAP/FILTER/GRID/HUD/EXIT, 140×72 buttons, 2.5s fade) + rect getters + Game hit-tests; rule-of-thirds grid; SNAP captures pre-toolbar frame → compositor 'photo' card → share ladder
- getPauseLensRect fifth pause button (below UISystem.js:251-253 shake toggle, wired in Game.js:416-427)
- stats.photosTaken; harness.html gains ?photo=1&photozoom=<z> that enters photo mode after boot for screenshot verification

**Verify:**
- node --check; node tools/validate-assets.js exit 0
- harness ?seconds=20&badge=1 → EXC: 0 (photo mode off — zero regression)
- harness ?photo=1&photozoom=0.75 / 1 / 2 screenshots: veil aligned with world at all three zooms, no unlit border at 0.75, toolbar visible then faded
- Manual mobile-rotated check: drag pan + pinch + toolbar taps through the rotation chokepoint
- Enter/exit loop ×10: camera re-attaches, trauma zero, pause overlay restored, no residual zoom

### PR3 — PR3 — Emberglass III: lens filters + the reuse contract doc

**Goal:** Eight biome-grade-lever filters as cheap screen-space passes, filter-stamped photo cards, and the frozen CARDS.md template contract for updates 3/14/15/19/20.

**Files:**
- `src/content/photoFilters.js (NEW)`
- `src/core/Game.js`
- `src/systems/UISystem.js`
- `src/content/cardTemplates.js`
- `docs/CARDS.md (NEW)`
- `tools/artshot/harness.html`

**Work:**
- photoFilters.js: 8-entry table (none/emberheat/quenched/gloam/sepia/noir/parchment/forgelight) — fills + saturation/color/soft-light/overlay composite ops, alphas 0.10-0.22, optional darkness ×1.25 via lighting.setQuality (the Game.js:866 lever), restored on exit
- Filter pass drawn after the veil composite (Game.js:3577) only while photoMode active; F key + FILTER toolbar button cycle; filter name in toolbar + stamped on the 'photo' card
- docs/CARDS.md: registerTemplate contract, helper signatures, data-shape JSDoc typedefs, and the reserved template ids for updates 3/14/15/19/20
- harness ?photo=1&filter=<id> param for the screenshot loop

**Verify:**
- node --check; node tools/validate-assets.js exit 0
- harness EXC: 0 with and without photo mode
- Screenshot loop: all 8 filters captured via harness, each visually distinct, veil intact under gloam's darkness lever and restored after cycling back to none
- Snap under each filter → card carries the grade + filter name stamp

## Data & save changes

**New content/data files:** `src/content/cardTemplates.js` (death/victory/photo template draw functions + card palette + chrome helpers), `src/content/photoFilters.js` (8-entry filter table), `docs/CARDS.md` (the frozen compositor template contract for updates 3/14/15/19/20). **New system module:** `src/systems/CardCompositor.js` (the roadmap's "built once here" module). **Config blocks (additive):** `EMBERGLASS = { card: {w:1200,h:630,frame:8,thumbW:360}, photo: {panSpeed:900, zoomMin:0.75, zoomMax:2.0, zoomStep:1.12, toolbarFade:2.5, worldMargin:200}, toast: {duration:1.6} }` in `src/config/GameConfig.js`; additive `label` display-name field on every ENEMY def (bosses keep bossName/epithet); per-kind hazard labels in HazardSystem. **Save schema (additive only, no version bump — implicit clamp+migrate per SaveSystem.js:198-225):** `stats.cardsShared` and `stats.photosTaken`, both numeric so the existing stats validation loop (SaveSystem.js:208-214) migrates old saves to 0 automatically. Filter/photo state is run-scoped and never persisted. No new entities, no new asset files required at ship (all card chrome + portraits procedural).

## Balance numbers (all tunable)

| Number | Start value | Rationale | 
|---|---|---|
| Card canvas | 1200×630 px (fixed contract) | OG-image aspect — pastes clean into Discord/Twitter embeds; frozen so 5 future updates can rely on it |
| Card compose budget | ≤3 ms, once per run (tunable) | one-shot at death/victory, invisible next to the 0.3s overlay fade |
| Card thumbnail on game-over | 360×189 (tunable) | 30% scale — legible but doesn't fight the stats column at UISystem.js:1887-1916 |
| Share debounce | gameOverAge ≥ 0.7 s (existing, reused) | same guard as RESTART (Game.js:443) — a death-moment tap can't fire share |
| Share toast | 1.6 s (tunable) | long enough to read "COPIED", short enough to not block re-runs |
| Photo pan speed | 900 px/s ÷ zoom (tunable) | crosses the 1920px view in ~2s; ÷zoom keeps apparent speed constant |
| Zoom range / step | 0.75–2.0, ×1.12 per notch (tunable) | 2.0 fills the frame with one monkey; 0.75 floor bounds veil/cull margin cost |
| Pan clamp | world ±3600/±2025 minus 200 px (tunable) | GameConfig WORLD_WIDTH/HEIGHT — camera never shows the void past the bounds wall |
| Toolbar buttons / fade | 140×72 px, fade after 2.5 s idle (tunable) | ≥ the 44px-slop touch floor used elsewhere; fade gets UI out of the shot |
| Pause LENS button | 480×64 at y = H/2+242 (tunable) | continues the existing stacked-rect rhythm (UISystem.js:242-253) |
| Filter grade alphas | 0.10–0.22 per filter (each tunable) | matches shipped biome gradeAlpha scale so filters read as world moods, not stickers |
| Gloam darkness lever | veil strength ×1.25, capped by STRENGTH_CAP (tunable) | reuses the exact Game.js:866 setQuality lever; restored on exit |
| Death-frame darken | rgba(10,6,8,0.55) + bottom gradient (tunable) | screenshot stays visible while 54px headline passes contrast |
| Card frame / fonts | 8px frame; wordmark 44px, headline 54px, killer 30px, chips 26px (tunable) | legible at 50% social-feed scale of a 1200px card |

## Art needs (non-blocking)

- NONE BLOCKING — PR1 ships fully procedural: card frame/wordmark/chips are canvas-drawn with the self-hosted Cinzel DISPLAY_FONT (src/assets/MenuFont.js), hero portraits come from the procedural monkey frames (getHeroFrames, smoothing off) so the hero is never a flat AI sprite
- Optional higgsfield (separate session, drop-in): one 1200×630 ember-parchment card background texture + one ~128px wax 'Keeper's seal' emblem for the card footer — replaces the procedural gradient behind a feature-detect Image load with the gradient as permanent fallback; needs an ASSET_CREDITS.md row and validate-assets pass
- Optional higgsfield: a 24px lens/aperture glyph for the pause LENS button (procedural circle+iris fallback ships first)
- Blender pipeline: not needed — no characters, creatures, or props in this update

## Risks

- Share API matrix (highest likelihood): iOS Safari's ClipboardItem user-gesture rule, WebViews lacking navigator.share-with-files, permission denials. Mitigated from PR1: the ladder always terminates in an <a download> object-URL save that cannot fail, ClipboardItem is constructed synchronously with a Promise<Blob> inside the tap handler, and every rung returns a typed method that drives an explicit toast — no silent failure state exists.
- Photo zoom desyncing the lighting veil or screen-space particle mapping (correctness risk): the veil buffer is screen-1:1 and its composite inherits the ctx transform (LightingSystem.js:138-144, verified no setTransform), so zoom MUST be threaded through exactly three mappers (Camera.apply, LightingSystem.addLight, ParticleSystem.drawScreenAdditive) plus the view-extent/cull callers. Mitigated: zoom clamped 0.75–2.0, the mapper list is enumerated in the spec, and PR2's merge gate is harness screenshots at 0.75/1.0/2.0 showing veil-world alignment.
- Headless/CI breakage from auto-minting on every death (harness runs the real death path): mitigated by guarding all browser APIs behind optional chaining, composing with pure canvas + the already-no-DOM-safe ensureMenuFont, deferring toBlob/clipboard strictly to user taps, and keeping EXC:0 badge verification in every PR's recipe.
- Save/perf: near-zero by construction — save additions are two numeric stats auto-migrated by the existing validation loop (SaveSystem.js:208-214, no version bump), photo mode is a frozen-world early-return strictly cheaper than gameplay, and the compositor is a lazy ~3MB singleton with no per-frame cost when idle.

## Uniqueness & boundaries

EMBERGLASS is the only update in the 20-update roadmap that ships share/export infrastructure: the single CardCompositor (1200×630 offscreen canvas, template registry, share ladder) and the game's only camera-detached, HUD-off photo mode with filters. Per the sequencing spine (ROADMAP.md:165-166) it exists precisely so the compositor is built exactly once before anyone needs it. Sharpest neighbor boundaries: **#3 KINDLED** owns the Rite Trial and its daily-card DATA — Emberglass only reserves the 'rite' template id and ships no daily/challenge content; **#14 LEDGER OF ASHES** owns run HISTORY — Emberglass stores no archive, no career records, no streamer-clean capture toggles, and cards are minted only from the live runSummary/lastHitBy of the current run (the `label` field it adds is also deliberately reusable by #12's Bestiary); **#15/#19/#20** own Ash-Rank seals, race-result data, and the camp visit card respectively — they call registerTemplate, Emberglass never anticipates their layouts; **#17 SEALED STORM** owns shareable STRINGS (challenge codes/determinism) — Emberglass shares only pixels, never codes. Deliberately NOT done here: no menu gallery tab (start-screen surfaces belong to #20 HEARTHHOLD), no save export/import (#14 owns save hardening), no time-scrub or replay in photo mode (#19 owns ghosts/telemetry).

## Roadmap corrections found while grounding

- Roadmap hook names the killer as 'Vinebacked Goliath' — that is the internal config id (vinebackGoliath); the shipped display name is bossName 'Gravemaw' with epithet 'The Rootbound Tyrant' (src/config/GameConfig.js:379-388). The card will read 'fell to Gravemaw, The Rootbound Tyrant'. Moreover, killer attribution does not exist anywhere yet — Player.takeDamage(amount) carries no source (src/entities/Player.js:219) and CollisionSystem tracks strongestEnemy internally but drops it from its return (src/systems/CollisionSystem.js:112-121,162) — so the attribution plumbing is new work in PR1, not a reuse of an existing seam.
- 'Auto-minting a death/victory recap card every run' has a victory-side catch: runSummary is NOT assembled when the victory overlay appears — _showVictory sets only {age:0} (src/core/Game.js:1150-1160) and the summary is built later in victoryToMenu (Game.js:1206-1213), and only if the player leaves. The victory card must therefore mint from its own live-field snapshot inside _showVictory.
- Claims that VERIFIED clean: the biome grade levers exist exactly as implied (theme {bg, grade, gradeAlpha} at src/systems/MapRenderer.js:62-64 applied at 105-119; darkness lever via lighting.setQuality at src/core/Game.js:861-867); the pause/overlay early-return state machine (Game.js:2552-2615); camera follow/shake (src/core/Camera.js:29-51). One addition the synopsis doesn't mention: the camera has NO zoom today, and photo-mode zoom must be threaded through LightingSystem.addLight's screen mapping because the veil composite inherits the ctx transform without setTransform (src/systems/LightingSystem.js:138-144) — handled in PR2.

## Binding cross-spec rulings affecting this update

- **[#2 EMBERGLASS vs #13 THE LAST HEARTH vs #17 THE SEALED STORM]** #2's docs/CARDS.md freezes the CardCompositor reuse contract as "updates 3/14/15/19/20" (matching ROADMAP.md:29), but #13 PR4 ships a siege share card and #17 PR4 auto-mints a shareable challenge-code card on every game-over screen — two card producers outside the frozen contract list, each at risk of building parallel share plumbing.
  **RULING:** #2 owns ALL card/share plumbing; the CardCompositor template registry is an OPEN, append-only contract, and docs/CARDS.md must be re-worded from a closed five-update list to "any update registers templates via registerTemplate(); known consumers: 3, 13, 14, 15, 17, 19, 20." #13 registers a 'siege' template and #17 registers its game-over challenge-code presentation through that contract; neither ships its own offscreen canvas, share ladder, or clipboard/navigator.share code.

- **[#2 EMBERGLASS vs #15 ASHBOUND vs #17 THE SEALED STORM]** Three updates claim the same game-over/death card surface: #2 authors the death-card template, #15 stamps an Ash Rank wax seal on it (blazing/cracked), and #17 retro-shares the reproduction challenge code on it. Authored independently, #15 and #17 each imply editing #2's death template.
  **RULING:** #2 owns the death/victory templates and must define named EXTENSION SLOTS in src/content/cardTemplates.js and docs/CARDS.md: a 'stamp' slot (badge region) and a 'footer' slot (code/text line). #15's wax seal registers into the stamp slot; #17's challenge code registers into the footer slot. Neither #15 nor #17 forks or redraws the death template; slot renderers are pure draw functions passed to the compositor.
