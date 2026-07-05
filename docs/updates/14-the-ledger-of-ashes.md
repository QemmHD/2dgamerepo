# Update #14: THE LEDGER OF ASHES

*Era IV — The Long Vigil*

**Value verdict (ADDS):** Premise verified in SaveSystem.js:35-50 — the game remembers only a handful of best-number stats, and there is no backup key, no export, no write-verify; one corrupted localStorage write currently ends a veteran's account. Save hardening + export/import alone passes the removal test for the game's most invested players, and boss splits plus the ghost-trace mint are the substrate #19 explicitly needs. Softest slice: streamer clean-capture toggles — tiny audience, but tiny cost. Not filler.

## What it adds

Turns EMBERWAKE from a game that remembers four "best" numbers into a game with a career: a 100-run archive with trend graphs and a run log, live speedrun boss-splits with gold/green/red deltas and a shareable splits string, streamer-clean capture toggles, and — the platform payoff — hardened saves with a daily backup slot plus full export/import, so a veteran's hundreds of hours can never be lost to one corrupted localStorage write. It also quietly mints the per-run telemetry traces that update 19's ghost races will consume.

## Design spec

# THE LEDGER OF ASHES — implementation spec

## 0. Verified ground truth (integration seams, cited)

- **Fixed timestep exists** and makes split timing honest: `GameLoop._tick` accumulates and steps `update(FIXED_DT)` in a `while` loop (src/core/GameLoop.js:54-60), `FIXED_DT = 1/60` (src/config/GameConfig.js:15), and run time accumulates only in sim steps at `this.time += dt` (src/core/Game.js:2617). So `this.time` is a deterministic count of 1/60s steps — a split stored as `Math.round(this.time * 10)` deciseconds is exact and replay-comparable.
- **runSummary bank sites** (the two places a run is folded into the save, both latched by `_runRecorded`): death path `_enterGameOver` builds `runSummary` (Game.js:2507-2522) and calls `recordRun` (Game.js:2531); victory-leave path `victoryToMenu` builds its own summary (Game.js:1206-1213) and calls `recordRun` (Game.js:1214). Coin banking is separately latched in `_bankRunCoins` (Game.js:1246-1257). Abandon-via-pause banks coins (Game.js:903-905) but never calls `recordRun` — we deliberately mirror that: **abandons are not archived**.
- **Boss-kill site** for split capture: `this.bossesDefeated += 1` inside the kill-resolution loop (Game.js:3040), final-boss victory latch at Game.js:3054-3055/3075-3078. Boss roster order per map is fixed: `new BossDirector(getMapBosses(this._effectiveMapId()))` (Game.js:621), rosters in src/content/maps.js:39,59,79,99 — so "segment 2 of emberwood" is always the same boss, which makes per-map splits meaningful.
- **Run identity fields**: map `_effectiveMapId()` (Game.js:561-564), difficulty `this.difficulty` set at run start (Game.js:782), character `saveSystem.getSelectedCharacter()` (Game.js:567), daily flag `this.dailyMode` (Game.js:180), Trials `this.selectedModifiers` (Game.js:174), gauntlet latch `_gauntletActive` (Game.js:1183).
- **SaveSystem**: single key `monkey-survivor:save:v1` (SaveSystem.js:14), `version: 7` written but **never read** (SaveSystem.js:126, 360 — confirms the roadmap punch-list item), **no size limits anywhere** — `save()` just warns on quota failure (SaveSystem.js:363-370), corrupted JSON hard-resets to defaults (SaveSystem.js:186-189: `'corrupted save, resetting'`). The settings validation loop auto-validates any new **boolean** default (SaveSystem.js:217-224) and clamps numerics to 0..1 — our new toggles ride it for free.
- **Menu Stats tab** is `MenuRenderer._drawStats` (MenuRenderer.js:1222-1341): Today's Trials strip, a 16-row "Lifetime Vigil" grid, achievements grid. Tab id `'stats'` unlocks after 1 run (MenuRenderer.js:64, 94). Panel content rect via `_contentRect()`, hotspots via `_hot` (MenuRenderer.js:119).
- **SETTING_TOGGLES loop**: declared MenuRenderer.js:103-110, rendered generically with a `toggleSetting` hotspot per row (MenuRenderer.js:2107-2126) — a new toggle is one array entry.
- **Game-over screen** is drawn by UISystem (title UISystem.js:1860-1863, NEW BEST ribbon 1866-1880, stats block 1887-1916, `Total Coins` line 1925-1929, reward lines 1935-1994); game-over buttons are built in Game.js (~Game.js:3699). HUD timer cluster: UISystem.js:352-399 (tabular `formatTime` timer at top-center).
- **UIStateBuilder** start-screen branch (UIStateBuilder.js:27-63) and gameplay branch (66-224) define exactly what the renderers can see; `state.saveData` is always present (UIStateBuilder.js:20).
- **Dev time-jump exists** (`this.time += seconds`, Game.js:1835) — it would forge splits; PR2 designs the dirty-flag against it from day one.
- The **Emberglass compositor (update 2) does not exist in the repo yet** (no compositor/share module found under src/). Per the roadmap it ships before us; we call it if present and always keep a plain-text clipboard fallback so nothing here blocks on it.

---

## 1. The Run Archive (new module: `src/systems/RunArchive.js`)

**Storage**: its OWN localStorage key `monkey-survivor:runs:v1` — never inside the main save. Rationale: the main save stays small and a corrupted archive can never nuke progression (and vice versa). Same `_probe`/memory-only-fallback pattern as SaveSystem.js:161-171.

**Schema** (short keys; every field validated on load exactly like `_validate` does — unknown/invalid records are dropped, never crash):

```js
{ v: 1, runs: [ /* newest first */
  {
    t:  1751712000,        // ended-at epoch SECONDS (int) — display only
    d:  10843,             // run duration in DECISECONDS (int, from this.time)
    m:  'emberwood',       // map id (validated against MAPS)
    df: 'hard',            // 'easy'|'normal'|'hard'
    ch: 'pyra',            // character id
    o:  1,                 // outcome: 0 death, 1 victory(3rd boss), 2 gauntlet death
    k:  1204, lv: 28, w: 14, b: 3, c: 812,   // kills/level/finalWave/bosses/coinsEarned
    dm: 1,                 // OMITTED unless dailyMode
    md: ['glass','famine'],// OMITTED unless Trials active
    sp: [2712, 5581, 9843],// boss splits, deciseconds, ≤3 entries (may be shorter on death)
    g:  14250,             // OMITTED unless gauntlet score exists
    dbg: 1                 // OMITTED unless run was dirtied (dev time-jump Game.js:1835)
  }
]}
```

**Size budget**: ~140–200 bytes/record → 100 runs ≈ 14–20 KB.
- Cap 1: `RUN_ARCHIVE.maxRuns = 100` (tunable) — push-front, `runs.length = 100` truncate (oldest evicted).
- Cap 2: byte guard `RUN_ARCHIVE.maxBytes = 65536` (tunable): if `JSON.stringify(payload).length > maxBytes`, evict from the tail until under. Belt-and-braces against future field growth.
- Quota hardening: `try { setItem } catch (QuotaExceededError) → halve runs.length, retry once, else warn + memory-only`.

**Mint sites** (both already latched by `_runRecorded`, so exactly one record per run):
1. `_enterGameOver`, immediately after `recordRun` (Game.js:2531) — outcome 0, or 2 if `_gauntletActive` (Game.js:2502).
2. `victoryToMenu`, inside the `!this._runRecorded` block next to Game.js:1214 — outcome 1.

`Game` constructs `this.runArchive = new RunArchive()` beside `this.saveSystem` and passes a small plain object (never live refs).

**API**: `record(rec)`, `getRuns()` (validated array, cached), `stamp()` (monotonic change counter — the chart cache key), `clear()` (wired to the existing save-reset confirm flow), `exportPayload()` / `importPayload(obj)` for PR4.

## 2. Boss splits — live timing, PB/gold storage, deltas

**Capture**: `_initRunState` adds `this.bossSplits = []`; at the kill site, right after `this.bossesDefeated += 1` (Game.js:3040): `if (this.bossSplits.length < 3) this.bossSplits.push(Math.round(this.time * 10))`. Gauntlet bosses 4+ are ignored for splits (the "clear" is 3 bosses; gauntlet is #owned by the existing score at Game.js:2503).

**Integrity rules** (decided in PR2, enforced forever):
- `this._splitsDirty = true` when the dev time-jump fires (Game.js:1835) → record gets `dbg:1`, and PB/gold writes are skipped.
- `dailyMode` runs (map override, forced modifiers — Game.js:743-746, 782) never write PB/gold (recorded in archive with `dm:1` for the graphs). Trials (`selectedModifiers`) DO count — they only make runs harder (tunable decision).

**Persistent bests** — new **main-save** key (additive, validated):
```js
splits: {
  'emberwood|hard': {           // key = mapId|difficulty  (max 4 maps × 3 diffs = 12 entries)
    pb:   [2712, 5581, 9843],   // splits of the best CLEAR (lowest sp[2]); deciseconds
    gold: [2712, 2779, 3854],   // best individual SEGMENT ever (seg_i = sp[i] - sp[i-1])
    pbAt: 1751712000
  }
}
```
Validator mirrors the `relicAttunement` pattern (SaveSystem.js:350-358): key must match `^[a-z]+\|(easy|normal|hard)$` with a known map id; `pb`/`gold` arrays of ≤3 finite ints ≥0, strictly increasing for `pb`. New SaveSystem methods: `getSplits(key)`, `recordSplits(key, sp, victory)` → returns `{ pbRun: bool, golds: [bool×3] }` for the NEW BEST ribbon. `version` bumps 7→8 (SaveSystem.js:126, 360).

**Live HUD split popup** (UISystem, new `_drawSplitPopup` under the timer cluster UISystem.js:352-399): on each boss kill Game pushes `this.splitPopup = { idx, timeDs, deltaDs, kind, ttl: 4.0 }` (tunable ttl; 0.4s fade). Delta vs `pb` segment for that idx. `kind` picks color: **gold** `#ffd166` (beat your best-ever segment), **green** `#5fd36a` (ahead of PB pace), **red** `#ff6a4a` (behind). Rendered as one line, e.g. `BOSS II — 9:18.1  (−0:12.4)` in the MONO font already used by the timer (UISystem.js:35). Passed through UIStateBuilder gameplay branch (one new field beside `base.time`, UIStateBuilder.js:66).

**Game-over splits panel** (UISystem `_drawGameOver`, inserted as a third column beside the stats block at UISystem.js:1887-1916): up to three rows `I. Stormwing Alpha  4:31.2  (−0:08.1)` (boss display names resolved from `getMapBosses(map)` order, maps.js:114-118), each colored by kind; a `PB CLEAR!` / `GOLD ×n` chip feeds the existing NEW BEST ribbon (UISystem.js:1866-1880) with a new `nb.splits` reason. A **COPY SPLITS** button joins the game-over button row built in Game.js (~Game.js:3699).

**Timer upgrade**: with `bigTimer` toggle on, the HUD timer renders deciseconds (`14:32.6`) and +20% font (tunable) — UISystem.js:360-399 already measures/scales, so this is a formatting branch.

## 3. Splits string (shareable, serverless)

Format (one line, clipboard-friendly, ~70 chars):
```
EWSPL1|emberwood|hard|pyra|2712,5581,9843|V|20260705|k7x2q
```
Fields: magic+version, map, difficulty, character, deciseconds splits, outcome letter (V/D/G), UTC date, then FNV-1a 32-bit checksum of the preceding payload rendered base36 (tamper-*discouraging*; there is no server so nothing can be tamper-*proof* — same trust model the roadmap accepts for update 17's challenge codes). Encoder/decoder live in `RunArchive.js` (decoder ships now so update 19 inherits a tested codec). This update only ENCODES + copies (`navigator.clipboard.writeText` with a `document.execCommand('copy')` textarea fallback); no paste/import UI — comparing strings is update 19's job.

## 4. The Ledger — Stats-tab sub-views + charts

The stats panel (MenuRenderer.js:1222-1341) is already full, so `_drawStats` gains a 3-chip segmented control at the top: **VIGIL** (today's content, unchanged) / **LEDGER** / **SPLITS**. View state lives on Game (`this.ledgerView = 'vigil'`), set by a new `ledgerView` case in the menu-action switch (pattern at Game.js:1483-1488), passed via the UIStateBuilder start branch (UIStateBuilder.js:27-63) together with a **snapshot** of the archive: `base.ledger = { runs: runArchive.getRuns(), stamp: runArchive.stamp() }`.

**LEDGER view** (data from last `LEDGER.chartWindow = 50` runs, tunable; all pure-canvas, no libs):
1. **Survival trend** — area+line chart of run duration (minutes) in chronological order, 1180×220 px (tunable) region; victory runs get a 5px gold dot, gauntlet deaths an outlined dot; y-axis = 0..max with two gridlines; ember-orange line `#ff8a3a` on `rgba(255,138,58,0.12)` fill.
2. **Kills per run** — bar sparkline, same width, 120px tall, bars colored by difficulty (easy `#7fb0d0` / normal `#ffce54` / hard `#ff6a4a`).
3. **Career counters strip** — win rate %, median clear time, runs this week, archive fill `n/100` (derived, no new save fields).
4. **Run log** — last 8 runs as table rows: relative date, map, difficulty letter, character, time (m:ss.d), outcome glyph (☠/★/∞), kills. Each row shows `dm`/`dbg` chips when flagged.

**Perf**: the menu redraws every frame, so both charts render into ONE cached offscreen canvas keyed on `ledger.stamp` (archive only changes between runs) — steady-state cost is a single `drawImage`, matching the `_ensureBackdropCaches` philosophy (MenuRenderer.js:138-144).

**SPLITS view**: 4 map chips × 3 difficulty chips (reusing `_button`/`_hot`); a table of segments I/II/III with columns SEGMENT · PB SPLIT · GOLD SEG · LAST RUN (delta-colored); empty state "No clears recorded — fell the third boss of <map> to open this page." Buttons: **COPY SPLITS** (section 3 string for the selected key's PB) and **SHARE CARD** — calls the Emberglass compositor if its module exists (dynamic `import()` guarded in try/catch), else copies the text string; never blocks.

## 5. Clean-capture toggles (streamer mode)

Three new boolean settings (defaults in `defaultData().settings`, SaveSystem.js:55-65 — auto-validated by the loop at SaveSystem.js:217-224) + three `SETTING_TOGGLES` entries (MenuRenderer.js:103-110), rendered for free by the loop at MenuRenderer.js:2107-2126:
- `streamerClean` (default **false**) — "Streamer Clean HUD": hides the total-coin balance line on game-over (UISystem.js:1925-1929), the streak reward line (UISystem.js:1958-1959), menu toasts and the coin balance in menu headers, and dims reward-line pulsing to a single pass — a capture shows the RUN, not the wallet.
- `showSplits` (default **true**) — master switch for live split popups + game-over splits panel (some players don't want a timer judging them).
- `bigTimer` (default **false**) — deciseconds + enlarged top-center timer for VOD legibility.

## 6. Save hardening + export/import

**Hardening (PR1)**, all inside SaveSystem:
- **Daily backup slot**: on boot after a successful `_validate`, if `data._bakDay !== currentDayNumber()` write the validated JSON to `monkey-survivor:save:v1:bak` (once per UTC day — near-zero write amplification). `_loadOrDefault`'s corrupted-JSON branch (SaveSystem.js:186-189) now tries the backup before defaulting: the catastrophic "corrupted save, resetting" becomes "restored yesterday's forge".
- **Write-verify**: `save()` (SaveSystem.js:363-370) reads back `getItem(SAVE_KEY)` and compares lengths; mismatch → one retry, then a persistent (non-blocking) menu warning banner.
- **`version` becomes read**: load path logs + tolerates `data.version > 8` (fields still pass through `_validate`; unknown future keys are dropped — documented limitation), and export embeds it.

**Export (PR4)** — Settings tab buttons under REPLAY TUTORIAL (MenuRenderer.js:2151-2156 pattern):
```
EWSAVE2
<base64url( JSON: { magic:'emberwake', v:8, at:<epoch>, save:{...}, runs:{...}, traces:{...} } )>
<fnv1a-base36 checksum of line 2>
```
Delivered two ways at once: `navigator.clipboard.writeText` AND a downloaded file `emberwake-save-YYYYMMDD.ews` via a transient `<a download>` blob link (works on GH Pages, no server). Base64url of URI-encoded JSON so unicode names survive `btoa`.

**Import**: IMPORT SAVE button opens a transient `<input type=file accept=".ews,.txt">`; fallback IMPORT FROM CLIPBOARD via `navigator.clipboard.readText()`. Pipeline: checksum verify → parse → `this.data = this._validate(payload.save)` (the EXISTING validator is the security boundary — SaveSystem.js:192-361 already clamps every field, so a hostile file can't grant out-of-bounds anything) → archive via `RunArchive.importPayload` (same validation) → save + reload menu. Overwrite is guarded by the existing two-tap confirm pattern (`resetConfirming`, UIStateBuilder.js:28-29). Corrupt file → toast "That ledger is illegible", nothing touched.

## 7. Ghost-trace mint (the update-19 handshake)

Per the roadmap spine ("14 ships the archive traces earlier", ROADMAP.md:168-169), we record but do not consume:
- Sampler in the gameplay update: every 30 fixed steps (0.5s sim, tunable) push `{x, y, lv, k}` quantized to Int16 world units into a preallocated array. Cost: one push per 30 frames — negligible; hard cap `TRACE.maxSamples = 2400` (20 min; tunable) then sampling stops.
- At run end, pack to base64 (Uint16 deltas) — ~4 bytes/sample → ≤ 9.6 KB raw, ~2–6 KB packed for typical runs (matches ROADMAP.md:150-151's budget).
- Storage key `monkey-survivor:traces:v1`, keeping ONLY: the PB-clear trace per `mapId|difficulty` (≤12) + the last run's trace, total byte cap `TRACE.maxBytes = 131072` (tunable; evict non-PB first). Update 19 reads these to render your own ghost and to build race codes; nothing in update 14 draws a ghost.

## 8. Failure & edge design (built in from PR1)

1. **Storage loss/quota (the existential one)**: three isolated keys so failures can't cascade; byte caps + halve-on-quota eviction; memory-only fallback mirrors SaveSystem.js:161-171; daily `:bak` slot turns the current reset-on-corruption (SaveSystem.js:186-189) into a restore. Total worst-case footprint: save ~4 KB + archive 64 KB + traces 128 KB ≈ 196 KB — <4% of the ~5 MB origin budget.
2. **Menu perf on mobile**: charts drawn per-frame would cost more than gameplay — the offscreen-cache-keyed-on-stamp rule makes steady state one blit; the archive snapshot is built once per menu entry, not per frame.
3. **Split-integrity confusion**: dev time-jump (Game.js:1835) dirty-flags the run; dailies excluded from PB/gold; gauntlet extra bosses ignored; deciseconds derive from fixed-step sim time (never wall clock), so pause/hit-stop/tab-away can't skew a split.
4. **Save-schema safety**: every new key is additive with a defaulting validator (the established implicit-migration pattern, SaveSystem.js:198-200); a v7 save loads unchanged; a v8 save read by an old build simply drops `splits` (old `_validate` ignores unknown keys) — acceptable one-way loss, documented.

## PR plan

### PR1 — PR1 — Ledger foundation: RunArchive + save hardening (backup slot, write-verify)

**Goal:** Every finished run is durably archived to its own localStorage key with caps/eviction, and the main save gains a daily backup + write verification — zero UI change beyond a debug counter.

**Files:**
- `src/systems/RunArchive.js (NEW)`
- `src/core/Game.js`
- `src/systems/SaveSystem.js`

**Work:**
- Create RunArchive (key monkey-survivor:runs:v1): probe/memory-fallback, validated load, record() with maxRuns=100 + maxBytes=65536 eviction, quota halve-and-retry, stamp() change counter, clear()
- Construct this.runArchive in Game constructor beside saveSystem; mint records at the two _runRecorded-latched sites (victoryToMenu next to Game.js:1214, _enterGameOver next to Game.js:2531) with map/difficulty/character/outcome/kills/level/wave/bosses/coins/daily/modifier fields
- SaveSystem: daily backup write to monkey-survivor:save:v1:bak gated on currentDayNumber; corrupted-load branch (SaveSystem.js:186-189) tries backup before defaulting; save() read-back length verify with one retry
- Wire runArchive.clear() into the existing save-reset confirm flow

**Verify:**
- node --check on all touched files; node tools/validate-assets.js exit 0
- Headless harness ?seconds=35&badge=1 shows EXC:0
- Harness console script: force a death, assert localStorage['monkey-survivor:runs:v1'] parses with 1 run carrying correct map/difficulty/outcome; corrupt the main save JSON, reload, assert backup restore instead of reset
- Loop 120 synthetic record() calls, assert runs.length===100 and stringify length < 65536

### PR2 — PR2 — Boss splits: live capture, PB/gold persistence (save v8), HUD deltas, clean-capture toggles

**Goal:** Boss kills produce live gold/green/red split popups, PB+gold segments persist per map|difficulty, the game-over screen grows a splits panel + COPY SPLITS string, and the three streamer toggles ship.

**Files:**
- `src/core/Game.js`
- `src/systems/SaveSystem.js`
- `src/systems/UISystem.js`
- `src/systems/UIStateBuilder.js`
- `src/systems/MenuRenderer.js`

**Work:**
- Game: this.bossSplits capture (deciseconds) at the kill site after Game.js:3040; _splitsDirty flag on dev time-jump (Game.js:1835); splitPopup state + runSummary.splits; call saveSystem.recordSplits on clear (skip daily/dirty runs); COPY SPLITS button in the game-over button row (~Game.js:3699)
- SaveSystem: additive splits{} key with regex-validated map|difficulty entries (pb/gold int arrays ≤3), getSplits/recordSplits returning {pbRun, golds}; settings defaults streamerClean:false, showSplits:true, bigTimer:false; version 7→8
- UISystem: _drawSplitPopup under the timer cluster (UISystem.js:352-399) with 4.0s ttl and gold #ffd166 / green #5fd36a / red #ff6a4a; game-over splits column beside UISystem.js:1887-1916; nb.splits feeds the NEW BEST ribbon (1866-1880); streamerClean hides Total Coins (1925-1929) + streak line (1958-1959); bigTimer deciseconds branch
- UIStateBuilder: pass splitPopup + splits snapshot in the gameplay branch
- MenuRenderer: three SETTING_TOGGLES entries (line 103) — rendered free by the loop at 2107
- RunArchive: sp[] field lands on the record; splits-string encoder+decoder (EWSPL1|...|fnv1a) with clipboard copy + execCommand fallback

**Verify:**
- node --check; validate-assets exit 0; harness badge=1 EXC:0
- Harness scripted run killing ≥1 boss (long ?seconds or scripted damage): screenshot shows the split popup; second run screenshot shows a colored delta
- Assert save JSON contains splits{'emberwood|normal'} with strictly increasing pb after a scripted clear; assert daily-mode and time-jumped runs write no PB
- Decode the copied splits string round-trip in a console test; toggle screenshots: streamerClean hides Total Coins line, showSplits=false hides the panel

### PR3 — PR3 — The Ledger UI: Stats-tab sub-views, career charts, run log, splits table

**Goal:** The Stats tab becomes VIGIL / LEDGER / SPLITS: cached-canvas survival + kills charts over the last 50 runs, a career counters strip, an 8-row run log, and the per-map splits table with PB/gold/last-run deltas.

**Files:**
- `src/systems/MenuRenderer.js`
- `src/systems/LedgerCharts.js (NEW)`
- `src/core/Game.js`
- `src/systems/UIStateBuilder.js`

**Work:**
- Game: ledgerView state + menu-action case (pattern at Game.js:1483-1488)
- UIStateBuilder start branch: base.ledger = { runs, stamp } snapshot + base.ledgerView + base.splitsData
- MenuRenderer._drawStats: 3-chip segmented control; VIGIL view unchanged (MenuRenderer.js:1229-1341)
- LedgerCharts (NEW): pure-canvas area/line survival trend (1180×220, victory dots), kills bar sparkline (120px, difficulty-colored), rendered to ONE offscreen cache keyed on ledger.stamp
- LEDGER view: charts blit + career strip (win rate, median clear, runs this week, archive n/100) + 8-row run log with dm/dbg chips
- SPLITS view: 4 map × 3 difficulty chips, segment table (PB/gold/last deltas), empty state, COPY SPLITS + SHARE CARD (guarded dynamic import of the Emberglass compositor, text fallback)

**Verify:**
- node --check; validate-assets exit 0; harness badge=1 EXC:0
- Harness ?screen=menu&tab=stats screenshots of all three sub-views (inject a synthetic 60-run archive via console for a populated screenshot)
- Perf: assert steady-state menu frame draws the chart cache via a single drawImage (instrument draw count in dev mode); chart cache invalidates only when stamp changes
- Empty-archive and 1-run-archive renders show empty states, no NaN axes

### PR4 — PR4 — Export/import, ghost-trace mint, splits share card, polish

**Goal:** Full save+archive+trace export/import (file + clipboard, checksummed, validator-gated) ships in Settings; runs mint the quantized position traces update 19 will consume; the SPLITS share card goes out through the compositor when present.

**Files:**
- `src/systems/SaveExport.js (NEW)`
- `src/systems/RunTrace.js (NEW)`
- `src/core/Game.js`
- `src/systems/SaveSystem.js`
- `src/systems/MenuRenderer.js`
- `src/systems/UISystem.js`

**Work:**
- RunTrace (NEW): 0.5s-sim sampler (every 30 fixed steps; cap 2400 samples) of quantized x/y/level/kills; Uint16-delta base64 packer; store key monkey-survivor:traces:v1 keeping PB-clear trace per map|difficulty + last run, 131072-byte cap with non-PB-first eviction
- Game: start/stop sampler in _initRunState / run-end sites; hand packed trace to RunTrace store with the archive record id
- SaveExport (NEW): EWSAVE2 file format (base64url JSON {magic, v:8, at, save, runs, traces} + fnv1a line), export via clipboard AND <a download> blob; import via transient <input type=file> + clipboard fallback, checksum → parse → SaveSystem._validate + RunArchive.importPayload, two-tap overwrite confirm (resetConfirming pattern)
- SaveSystem: version read-and-log on load for v>8 payloads
- MenuRenderer Settings: EXPORT SAVE / IMPORT SAVE buttons + helper copy under the REPLAY TUTORIAL block (MenuRenderer.js:2151-2156)
- Game-over + SPLITS view SHARE CARD: compositor call if module present, else splits-string clipboard; success/failure toasts

**Verify:**
- node --check; validate-assets exit 0; harness badge=1 EXC:0
- Round-trip test in harness console: play run → export → reset() → import → assert coins/stats/splits/archive/traces byte-identical (modulo at timestamp)
- Tampered-checksum and truncated-file imports rejected with toast, save untouched; import of a hostile payload (999999 coins under a bad structure) comes out clamped by _validate
- Trace store: after 3 clears on one map assert exactly 1 PB trace + last-run trace and total bytes < 131072; 25-minute run stops sampling at cap with no frame-time regression (badge FPS unchanged)

## Data & save changes

**New localStorage keys (NOT in the main save):** `monkey-survivor:runs:v1` (RunArchive: `{v:1, runs:[...]}` ring buffer, 100 runs / 64 KB caps), `monkey-survivor:traces:v1` (RunTrace: PB-clear trace per map|difficulty + last run, 128 KB cap), `monkey-survivor:save:v1:bak` (daily rolling backup of the validated main save).

**Main-save additive keys (v7 → v8, all defaulted by `_validate` so old saves load unchanged):** `splits: { 'mapId|difficulty': { pb:[ds,ds,ds], gold:[ds,ds,ds], pbAt } }` (regex-validated keys, clamped int arrays, mirrors the relicAttunement validator pattern at SaveSystem.js:350-358); `settings.streamerClean:false`, `settings.showSplits:true`, `settings.bigTimer:false` (booleans — auto-validated by the existing settings loop, SaveSystem.js:217-224); internal `_bakDay` day-number latch for the backup cadence.

**New modules (NEW files):** `src/systems/RunArchive.js`, `src/systems/LedgerCharts.js`, `src/systems/SaveExport.js`, `src/systems/RunTrace.js`. No new content-data files under src/content; no new art assets required, so ASSET_CREDITS.md / credits/assets.json are untouched (validate-assets stays green by construction).

**Extended (REUSED) systems:** Game.js (mint sites 1214/2531, kill site 3040, menu-action switch 1483+, game-over buttons ~3699), SaveSystem.js (validator, version, backup, splits accessors), UISystem.js (timer cluster 352-399, game-over block 1860-2019), MenuRenderer.js (SETTING_TOGGLES 103/2107, _drawStats 1222), UIStateBuilder.js (both branches). **String formats:** splits string `EWSPL1|map|diff|char|ds,ds,ds|V|date|crc`; export file `EWSAVE2` + base64url JSON + fnv1a line.

## Balance numbers (all tunable)

| Number | Start value | Rationale (all tunable) |
|---|---|---|
| Archive run cap | 100 runs | Roadmap-committed "100-run career archive"; ~20 KB worst case |
| Archive byte cap | 65,536 B | Hard guard under localStorage ~5 MB origin budget; evict-oldest |
| Run record size | ~140–200 B | Short keys + omitted-when-default fields |
| Split resolution | 0.1 s (deciseconds int) | Honest at FIXED_DT=1/60 (GameConfig.js:15); ints compress well |
| Split popup TTL / fade | 4.0 s / 0.4 s | Long enough to read mid-fight, gone before the next beat |
| Split colors | gold #ffd166 / green #5fd36a / red #ff6a4a | Existing palette (NEW BEST gold UISystem.js:1876; toggle green; boss red) |
| Segments per run | 3 (bosses I–III) | Map clear = 3 bosses (Game.js:3054); gauntlet 4+ ignored |
| Splits-key space | ≤12 entries (4 maps × 3 difficulties) | Bounded save growth ~1.2 KB max |
| Chart window | last 50 runs | Readable at 1180 px wide; full 100 in run log paging later |
| Run-log rows | 8 | Fits the stats panel below the sub-tab chips |
| Chart cache | 1 offscreen canvas, keyed on archive stamp | Steady-state menu cost = 1 drawImage |
| Trace sample period | 0.5 s sim (30 fixed steps) | Matches update 19's stated ~0.5 s sampling (ROADMAP.md:150) |
| Trace sample cap | 2,400 (20 min) | Bounds memory + pack time |
| Trace store cap | 131,072 B; keep PB per map|diff + last run | ≤13 traces × ~2–6 KB packed |
| Backup cadence | 1×/UTC day | Restore-yesterday guarantee at negligible write amplification |
| PB/gold exclusions | daily runs; dev time-jumped (dirty) runs | Forced maps/mods + forged time can't pollute records |
| bigTimer scale | +20% font, deciseconds shown | VOD legibility without HUD crowding |
| Checksum | FNV-1a 32-bit, base36 | Cheap, dependency-free tamper discouragement (no server) |

## Art needs (non-blocking)

- None blocking — every deliverable (charts, split popups, tables, toggles, export UI) is procedural canvas in the established menu style, shipping complete in PR1-PR4.
- Optional higgsfield (separate session, non-blocking): a parchment/ash-ledger backdrop texture for the SPLITS share card and Ledger panel header — procedural dark-panel fallback ships first; if adopted it gets an ASSET_CREDITS.md row.
- Optional CustomIcons glyph: a small quill-and-ledger icon for the sub-tab chips — text-label chips ship first.
- No Blender pipeline work: this update adds zero creatures/characters/props, and the canonical enemy sheets are untouched.

## Risks

- localStorage quota/corruption cascading into progression loss — mitigated from PR1: three isolated keys (save/runs/traces), byte caps with evict-oldest and halve-on-quota retry, write-verify with retry, daily :bak slot that converts today's reset-on-corruption (SaveSystem.js:186-189) into a restore, and memory-only fallback mirroring SaveSystem.js:161-171. Worst-case total footprint ~196 KB.
- Menu perf regression on mobile from per-frame chart drawing — mitigated by rendering both charts to one offscreen cache keyed on the archive stamp (archive only mutates between runs), following the _ensureBackdropCaches precedent (MenuRenderer.js:138); steady state is a single drawImage.
- Record integrity / player trust: dev time-jump (Game.js:1835), daily-mode forced maps, and gauntlet continuations could forge or confuse PBs — mitigated by the dirty-flag + dm exclusion rules and the 3-segment cutoff designed into PR2, plus fixed-step sim-time (never wall-clock) as the only time source.
- Import as an attack/foot-gun surface: a crafted .ews could try to grant out-of-bounds progression or corrupt state — mitigated by routing every imported field through the existing _validate clamp pipeline (SaveSystem.js:192-361) plus checksum + magic checks and a two-tap overwrite confirm; a failed import provably touches nothing.
- Scope adjacency creep toward update 19 (racing) or 15 (ladders) — mitigated by hard boundaries: we mint traces and encode strings but ship no decoder UI, no ghost rendering, no seeded RNG, and splits key only off the existing easy/normal/hard difficulties.

## Uniqueness & boundaries

THE LEDGER OF ASHES is the only update in the 20-update roadmap that delivers persistence infrastructure and self-referential records: nothing else gives the player their own history (career archive + graphs), their own pace (per-map boss splits with gold/green/red deltas), or their own data sovereignty (hardened saves + export/import) — and it is the sole mint of the telemetry traces the spine assigns to it (ROADMAP.md:168-169). Sharpest neighbor boundaries: **#19 EMBER RACE** owns everything competitive-between-players — we record and encode YOUR traces and splits strings but ship no decoder UI, no ghost rendering, no pace-markers, no race codes; **#17 SEALED STORM** owns determinism — our splits are honest fixed-timestep measurements of live-RNG runs, and we thread no seeded RNG anywhere; **#2 EMBERGLASS** owns the card compositor — we only call it behind a guarded dynamic import with a text fallback; **#15 ASHBOUND** owns difficulty ladders and seasonal resets — our splits keys deliberately stay on the existing easy/normal/hard tiers so Ash Ranks can extend the key format later; **#12 CINDERS & SCRIPTURE** owns collection/lore UI — the Ledger shows numbers and time, never bestiary or codex content.

## Roadmap corrections found while grounding

- The task brief's entry-point list says 'src/systems/UISystem.js Stats tab' — the menu Stats tab actually lives in MenuRenderer._drawStats (src/systems/MenuRenderer.js:1222-1341); UISystem owns the game-over stats block instead (src/systems/UISystem.js:1887-1916). The spec integrates with both at their real locations.
- The brief implies SaveSystem has 'size limits' to detail — verified it has NONE today: save() only warns on quota failure (SaveSystem.js:363-370) and there is no byte accounting anywhere. All size budgeting/eviction in this spec is NEW, which is why the archive gets its own key with explicit caps.
- Confirmed (not corrected): the roadmap punch-list claim that save `version` is written-never-read holds — version:7 is set at SaveSystem.js:126 and 360 and never compared on load; this update makes it load-bearing for export/import.
- Confirmed: fixed-timestep segments are real — GameLoop steps update(FIXED_DT=1/60) in an accumulator loop (GameLoop.js:54-60, GameConfig.js:15) and run time accrues only in sim steps (Game.js:2617), so deciseconds splits are exact.
- One landmine documented rather than corrected: the dev time-jump mutates this.time directly (Game.js:1835), which would forge splits — the spec adds a dirty-flag from PR2 so such runs can never write PB/gold.
- The Emberglass compositor (update 2, which the roadmap says update 14 reuses) does not exist in the repo yet — no compositor/share module under src/. The spec guards every card call behind a dynamic import with a plain-text clipboard fallback so this update cannot block on it.

## Binding cross-spec rulings affecting this update

- **[#14 THE LEDGER OF ASHES vs #17 THE SEALED STORM (re: #19)]** #14 claims it "mints the per-run telemetry traces that update 19's ghost races will consume" (monkey-survivor:traces:v1) — sanctioned by the spine (ROADMAP.md:168-169). #17's boundary text contradicts this by assigning "telemetry ghost recording/encoding" to #19.
  **RULING:** #14 owns trace RECORDING and local persistence (the traces:v1 ring buffer, sampling cadence, size caps). #19 owns ghost SHARE-ENCODING (delta-encoded base64 race strings), spectre rendering, and race semantics. #17 owns neither — only the seeded sim that makes races fair. #17's boundary sentence is corrected to: "#19 owns ghost share-encoding, rendering, and races; the raw traces are minted by #14."

- **[#14 THE LEDGER OF ASHES vs #6, #10, #12, #13, #15 (save-schema writers)]** #14 pins "save v7 → v8" (current version is 7 — src/systems/SaveSystem.js:126), but five earlier-shipping updates (#6 Descent keys, #10 chronicles, #12 codex state, #13 hearth records, #15 ladder schema) each add main-save keys authored independently; if any of them bumps the version first, #14's pinned v8 collides.
  **RULING:** No spec pins a save-version integer. Standing rule folded into all six specs: main-save additions are additive keys defaulted by _validate (backward-compatible per the repo constraint), and a version bump is assigned AT SHIP TIME only when a migration actually requires it. #14's spec text changes "save v8" to "save version current+1 at ship time." #14 retains sole ownership of save hardening, the :bak slot, and export/import.
