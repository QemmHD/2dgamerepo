# Update #18: THE CLEAR VIGIL — Say What It Does

*Era VI — The Legible Forge*

**Value verdict (IMPROVES):** Every confusing control on the PLAY screen already carries an
authored, plain-English explanation in its config — and the menu draws **none of them**. This
update is therefore not a copywriting job; it is a wiring job against strings that already
shipped and are already good. The one genuine defect underneath (the menu's XP readout and the
engine's applied XP bonus are computed by two different expressions, and they disagree by
+50% on Nightmare) is fixed by construction, with a single shared pure function, so the two
can never drift again. The HOME restage spends no new art: the logo and wordmark are already
committed and already wired — the emblem is simply rendered at 15% of its native resolution
next to a 424px hole.

---

## 0. Verified ground truth (the audit)

Every claim below was read in the working tree at `70b25e1` and is cited `file:line`.

### 0.1 The explanations exist and are never drawn

| Control | Authored explanation | Where it lives | Drawn anywhere? |
|---|---|---|---|
| Patron ×5 | `blurb` — *"Freeze the field in place — favors frost weapons and control perks."* | `src/content/patrons.js:24` (and 17, 31, 39, 46) | **No.** `PATRONS` is referenced only at `MenuRenderer.js:2435-2442`, which reads `.name`/`.title` and never `.blurb`. |
| Difficulty ×3 | `desc` — *"Tougher, faster, more elites. +50% Pass XP."* | `src/config/GameConfig.js:1230-1233` | **No.** The difficulty loop at `MenuRenderer.js:2461-2472` draws only `d.label`. |
| Trials ×9 | `desc` — *"You take 30% more damage."* | `src/config/GameConfig.js:1243-1252` | **No.** The chip loop at `MenuRenderer.js:2497-2509` draws only `m.name`. |

The relic screen proves the pattern is wanted: `_drawAttune` *does* draw a `blurb` under each
row (`MenuRenderer.js:3188`). PLAY simply never got the same treatment.

### 0.2 The multiplier defect (real, reproducible)

Two expressions compute the same quantity and disagree.

```
MenuRenderer.js:2481   xpPct = round(min( sum(trial.xpBonus),          2.5              ) * 100)
Game.js:1060           let xpBonus = diff.xpBonus || 0            // ← starts at the difficulty bonus
Game.js:1071               xpBonus += m.xpBonus || 0
Game.js:1085           xp: min( xpBonus, RUN_MODIFIER_MAX_BONUS + (diff.xpBonus || 0) )
```

`DIFFICULTY.hard.xpBonus = 0.5` (`GameConfig.js:1232`). Consequences:

- **Nightmare + no Trials:** the engine grants **+50% XP**; the menu shows *no readout at all*
  (the `activeMods.length > 0` branch at `MenuRenderer.js:2484` is false, so the else-branch at
  2490 prints only the static string `'Trials — stack curses to forge a Pact'`).
- **Nightmare + any Trials:** the menu understates the real XP bonus by a flat 50 percentage
  points.
- The displayed cap (`2.5`) and the applied cap (`2.5 + diff.xpBonus` = `3.0` on Nightmare)
  are different numbers.

**The cap is dead code in both places.** Summing `GameConfig.js:1243-1252`:

- `xpBonus` total across all 9 Trials = `0.20+0.25+0.20+0.20+0.25+0.15+0.20+0.22+0.18` = **1.85**
- `coinBonus` total = `0.15+0.15+0.10+0.15+0.15+0.10+0.15+0.15+0.12` = **1.22**

Maximum reachable XP bonus is `0.5 + 1.85 = 2.35`, below even the un-augmented `2.5` cap. The
`Math.min` at `MenuRenderer.js:2481-2482` and `Game.js:1085-1086` can never bind.

### 0.3 "Equipped Loadout" is dead space, and worse for a new player

The four gear rows at `MenuRenderer.js:2367-2379` register **no `_hot` region** — they are not
clickable. They consume `4×52 + 3×9 + 18 = 235px`, **32% of the right column's entire budget**.

For a brand-new save this is actively hostile: the LOADOUT tab is gated behind
`casesOpened > 0` (`MenuRenderer.js:190`), so the screen displays three `— empty —` slots that
the player can neither click here nor fill anywhere.

### 0.4 The right column is already over budget

`_contentRect()` (`MenuRenderer.js:1243-1252`) on the 1920×1080 logical canvas with no safe-area:
`top = 184`, `bottom = 1040`, so **`c.h = 856`**. In `_drawPlay`:
`startH = clamp(856×0.12, 56, 84) = 84`, `avail = 856 − 84 − 52 − 12` = **708px**.

The `N` table at `MenuRenderer.js:2332` sums to:

| Block | Height at `s=1` |
|---|---|
| Loadout (4 rows) | 253 |
| Biome | 108 |
| Patron | 94 |
| Difficulty | 94 |
| Trials (3×3 grid) | 178 |
| **`fitH(1)`** | **727** |

`727 > 708`, so the binary search at `MenuRenderer.js:2353-2357` already shrinks the screen to
`s ≈ 0.974` before this update adds a single pixel. Any design that ignores this budget will
silently shrink the very text it set out to make readable.

### 0.5 Confirmed NOT bugs (checked, do not "fix")

- **The wordmark is not clipped.** It looked cut in the first capture because `?badge=1` stamps
  the harness's green `EXC` counter over the top-left corner. Re-shot without the badge: clean.
- **MODES missing from the tab bar** on a fresh save is correct gating, not a bug —
  `tabUnlocked('modes')` requires `runs >= 1` (`MenuRenderer.js:189`).
- **The HOME START button's third label does not overflow.** Labels sit at `y+45 / y+78 / y+99`
  in a 116px button (`MenuRenderer.js:1650-1655`). It is crowded and the third line is redundant
  with the second — a copy problem, not a clipping bug.

### 0.6 Brand assets — already committed, already wired

`src/assets/MenuImages.js` lazily loads seven images and every consumer has a procedural
fallback, so nothing hard-fails if art is missing.

| Asset | Native | Rendered at | Scale |
|---|---|---|---|
| `logo.png` | 512×512 | 78px on HOME (`MenuRenderer.js:1550,1559`) | **15%** |
| `title_emberwake.png` | 900×273 | `titleH=96` → 316px wide on HOME (`:1548-1562`) | 35% |
| `title_emberwake.png` | 900×273 | `logoH=62` → 204px wide in section headers (`:1960-1967`) | 23% |
| `menu_bg.jpg` | 2048×1152 | full-bleed backdrop | — |
| `bp_crest.png` | 820×341 | Battle Pass header | — |
| `corner_bracket.png` | 440×440 | `_panel` corners | — |
| `btn_plate.png` | 1000×231 | `_button` / CTA overlay | — |

**HOME dead space:** with `left=56`, `right=1864`, `navW=570`, `heroW=650`, `navX=126`,
`heroX=1144` (`MenuRenderer.js:1600-1603`), the nav panel ends at `x=720` and the hero panel
starts at `x=1144` — a **424px empty centre gutter**, 22% of the canvas width.

**Three stacked brand lines** compete at the top of HOME: `'HOLD THE LAST LIGHT'` (`:1579`), the
wordmark itself (`:1562`), and `'Survive the night. Keep the last light burning.'` (`:1581`).

---

## 1. Scope (owner-approved)

Decisions taken by the project owner before this spec was written:

1. **Explain in place.** Keep all seven PLAY control groups. Draw the descriptions that already
   exist. Nothing removed, nothing hidden behind an expander.
2. **Difficulty reads plain + flavour:** `EASY · Recruit`, `NORMAL · Vigil`, `HARD · Nightmare`.
3. **Restage HOME with the existing art.** No new logo generation.
4. **Ship per `CLAUDE.md`:** branch → PR → squash-merge to main.
5. **Trials go 2-wide** so each chip can state its effect and its reward.

### 1.1 One deviation from the approved sketch, and why

The owner's chosen Trials mock put the reward on a **third line** per chip. Measured against
§0.4's 708px budget that costs `5 rows × ~62px = 342px` against the 178px the 3-wide grid uses
today — `+164px` on a column that is already 19px over. It would force `s ≈ 0.85` and shrink
every label on the screen by ~13%, defeating the purpose.

**Resolution:** keep all three pieces of information, on **one line** per chip. At `cardW = 0.42`
the right column's `innerW` is 957px, so a 2-wide chip is **474px** — ample:

```
[ Endless Swarm — +35% enemy cap, faster spawns.   +25% XP · +15% coins ]
  ~46 chars @13px ≈ 300px                          ~20 chars @11px ≈ 120px
  300 + 120 + 32px padding = 452px  <  474px  ✓
```

Longest real string is `Enfeebled — Your weapons deal 15% less damage.` (46 chars) — it fits.
Chips ellipsize via the existing `_ellip` helper if content ever grows.

---

## 2. The layout budget (designed to fit at `s = 1`)

The binding constraint is `total ≤ 708`. Target:

| Block | Today | New | Δ | Note |
|---|---|---|---|---|
| Loadout | 253 | **70** | −183 | 4 dead rows → 1 summary row (52) + `sec` (18) |
| Biome | 108 | **104** | −4 | tile 60→56 |
| Patron | 94 | **94** | 0 | blurb goes on the *existing* header line — free |
| Difficulty | 94 | **114** | +20 | row 46 + new desc line 20 + label 30 + `sec` 18 |
| Trials | 178 | **280** | +102 | 2-wide, 5 rows × 40px, `4×8` gaps, label 30, `sec` 18 |
| Run Rewards bar | — | **36** | +36 | new, sits directly above START |
| **Total** | **727** | **698** | **−29** | **fits in 708 with 10px slack** |

The screen therefore renders at `s = 1` on desktop — *larger* text than today, not smaller,
despite adding three new information layers. The fit solver stays as the phone safety net.

**Acceptance gate:** if a future content change pushes `fitH(1)` past `avail`, chip body text
must not drop below 13px logical. Raise `chipScale`'s floor (`MenuRenderer.js:2340`) from `0.8`
to `0.86` and let the Trials block scroll rather than shrink further.

---

## 3. PR breakdown

### PR1 — One source of truth for the run bonus *(fixes §0.2)*

The defect exists because two expressions compute one quantity. Delete one of them.

**`src/config/GameConfig.js`** — add a pure exported helper beside `RUN_MODIFIER_MAX_BONUS`
(`:1257`):

```js
// Single source of truth for the pre-run XP/coin bonus. The menu readout and
// the engine's applied bonus MUST come from here — they were two separate
// expressions that disagreed by the difficulty xpBonus (+50% on Nightmare).
export function computeRunBonus(difficultyId, modifierIds = []) {
    const diff = DIFFICULTY[difficultyId] || DIFFICULTY.normal;
    const ids = modifierIds instanceof Set ? modifierIds : new Set(modifierIds);
    let xp = diff.xpBonus || 0, coin = 0;
    for (const m of RUN_MODIFIERS) {
        if (!ids.has(m.id)) continue;
        xp += m.xpBonus || 0;
        coin += m.coinBonus || 0;
    }
    return {
        xp: Math.min(xp, RUN_MODIFIER_MAX_BONUS + (diff.xpBonus || 0)),
        coin: Math.min(coin, RUN_MODIFIER_MAX_BONUS),
        difficultyXp: diff.xpBonus || 0,   // so the UI can attribute the split
    };
}
```

**`src/core/Game.js:1084-1087`** — replace the inline object with the helper. The loop at
`:1061-1073` keeps accumulating the *wave/player* scalars (`hp`/`speed`/`damage`/`elite`/`cap`/
`interval`/`pDamage`/`pPickup`/`pIncoming`); only the `xpBonus`/`coinBonus` accumulation at
`:1071-1072` and the `runBonus` construction move out. Behaviour is byte-identical — this is a
pure refactor on the engine side; the *menu* is what changes.

> **Invariant preserved:** `Game.js:1055` forces `'normal'` in `dailyMode`. `computeRunBonus`
> receives `this.difficulty` (already resolved), so the Daily Road's forced-normal rule is
> untouched.

**Also in PR1:** delete the now-provably-dead display cap. Leave `RUN_MODIFIER_MAX_BONUS`
exported and applied in the helper (cheap insurance if Trials are ever retuned past 2.5), but
document at `:1254-1257` that it is currently unreachable, with the 1.85 / 1.22 sums from §0.2
so the next reader does not re-derive them.

**Test:** `tools/validate-run-objectives.js` sits next to this area; add a focused assertion
that for every `(difficulty × modifier-subset)` sample, the menu's displayed pair equals
`Game.runBonus`. Because both now call one function this is a regression tripwire, not a
duplicate implementation.

---

### PR2 — PLAY: draw the explanations that already exist *(fixes §0.1, §0.3)*

All edits in `_drawPlay` (`MenuRenderer.js:2194-2518`).

**2a. Loadout → one summary row.** Replace the `GEAR_CATEGORIES` loop (`:2367-2379`) with a
single 52px row reading `Cinderbolt · no trinket · no armor · no charm`. Register a `_hot`
region that routes to the LOADOUT tab **only when `tabUnlocked('loadout', save)`**; when locked,
draw the row dimmed with the trailing hint `unlocks with your first gear case` and register no
hotspot. Update `N.gearRow`/`nGear` in the `N` table (`:2330-2332`) so `fitH` stays truthful.

**2b. Difficulty.** Row height 46→46 (unchanged), but each tile now stacks a plain tier over the
flavour name, and a shared description line sits under the row:

```
Difficulty
[  EASY  ] [ NORMAL ] [  HARD  ]      ← 700 13px, letter-spaced, 0.62 alpha
[ Recruit] [ Vigil  ] [Nightmare]     ← 700 fs(17), d.color when selected
Tougher, faster, more elites. +50% Pass XP.   ← DIFFICULTY[sel].desc, fs(14), 20px line
```

The description line shows the **selected** tier's `desc`, so it costs one line, not three.
This also settles the HOME/PLAY disagreement noted in §0.6 — HOME already prints
`Normal · Vigil` (`_drawHome`), PLAY did not.

**2c. Patron.** The header line at `:2438` already renders
`Patron — ${pdef.name}, ${pdef.title}` — extend it to append the blurb, and reword the empty
state off the word "draft":

- selected → `Patron — Rime, the Stillness · Freeze the field in place — favors frost weapons and control perks.`
- none → `Patron — none · pick one to steer your level-up choices toward its element (optional)`

Ellipsize with `_ellip` against `innerW`. **Zero added height.**

**2d. Trials → 2-wide, self-describing.** Replace the 3-column loop (`:2495-2509`) with
`tcols = 2`, `chipRow = 40`, `tRows = ceil(9/2) = 5`. Per chip:

- left, `700 fs(13)`: `${m.name} — ${m.desc}` (ellipsized to `tW − rewardW − 32`)
- right, `600 fs(11)`, `#5fd36a`: `+${m.xpBonus*100}% XP · +${m.coinBonus*100}% coins`

Header reworded off undefined jargon — `Trials — each curse makes the run harder and pays more`,
with the Pact tier appended once one is active: `Trials — PACT II · 3 curses`.

**2e. Run Rewards bar.** A 36px bar directly above START, **always visible**, fed by
`computeRunBonus` from PR1:

```
RUN REWARDS   +50% XP   +0% coins        (Nightmare +50%; no Trials active)
```

When `xp === 0 && coin === 0`, render the neutral prompt
`RUN REWARDS   —   stack Trials or raise Difficulty to earn more` rather than a bare `+0%`.
The attribution parenthetical uses `difficultyXp` from the helper so the player can see *why*
the number is what it is — which is precisely the information the old readout destroyed.

**2f. Header/CTA copy agreement.** The section header says
`Pick your hero, biome and difficulty — then START RUN.` (`TAB_DESCRIPTIONS`,
`MenuRenderer.js:150`) while the button renders `FIRST VIGIL · GUIDED` on a fresh save
(`_drawStartButton`, `:2659`). Align the header to the button's real first-run wording.

---

### PR3 — HOME restage *(fixes §0.6)*

All edits in `_drawHome` (`MenuRenderer.js:1527-1913`).

**3a. Hero-size the lockup.** `crestS` 78 → **168** and `titleH` 96 → **120** (wordmark 316 →
395px wide). The emblem goes from 15% to 33% of its native 512px — the forged ring's rune band
resolves instead of aliasing into noise. Recentre: `lockW = 168 + 24 + 395 = 587`, so
`lockX = 960 − 293 = 667`.

**3b. Kill one of the three brand lines.** Drop the `'HOLD THE LAST LIGHT'` kicker at `:1579`
— it duplicates the `<title>`/manifest string and competes with the wordmark directly beneath
it. Keep the single subtitle at `:1581`. Net: emblem + wordmark + one line.

**3c. Close the 424px gutter.** With the lockup taller, `mainTop` =
`max(sa.top+230, titleY+titleH+64)` = `max(230, 54+120+64)` rises from 230 to **238**. Widen the
two panels toward the middle —
`navW` 570 → **660** and `heroW` 650 → **720**, holding `navX = left+70 = 126` and recomputing
`heroX = right − heroW − 70 = 1074`. Nav panel then spans 102→810 and hero 1074→1794, cutting
the gutter from 424px to 264px, which reads as deliberate breathing room instead of a hole.

**3d. Fill the empty "HOW A RUN WORKS" panel.** The panel currently holds a headline, one line
of copy, and a 3-dot timeline pinned to its bottom with ~150px of nothing between. Distribute
the three beats (`MOVE` / `LEVEL UP` / `SURVIVE`) evenly down the reclaimed height and give each
one the single-line gloss it lacks. This is the one place on HOME where new copy is written
rather than surfaced; keep each beat under 40 characters.

**3e. START button: three labels → two.** At `:1648-1655` drop the redundant third line
(`'OPEN RUN SETUP'`, which restates `'Guided setup · tips appear during play'` directly above
it) and keep the returning-player variant `'SPACE / ENTER • QUICK START'`, which carries real
information. Re-centre the surviving two lines in the 116px button.

---

## 4. Blast radius

| Touched | Who else reads it | Kept working by |
|---|---|---|
| `Game.js:1084-1087` `runBonus` | XP/coin award paths at run end | PR1 is a pure refactor; `computeRunBonus` reproduces the existing expression exactly, difficulty term included |
| `GameConfig.js` `RUN_MODIFIERS` / `DIFFICULTY` | `Game.js:1057-1073`, `MenuRenderer`, validators | Data untouched; only *readers* added |
| `MenuRenderer._drawPlay` `N` table | `fitH`, the binary-search fit solver, phone layouts | `N` updated in the same edit as the rows it measures — §2's budget proves `fitH(1) ≤ avail` |
| Loadout row hotspot | `GameInputActions` menu dispatch | New `_hot` uses the existing `'tab'` action already used at `:1662` |
| `_drawHome` geometry | `_tabRectFor` tour spotlight, `_drawKeyboardFocus` | Hotspots are re-registered from the same rects that draw; the tour targets tabs, not HOME panels |
| Menu images | every `_panel`/`_button` | Untouched — PR3 changes only draw sizes, not the loader |

**Invariants that must hold (from `CLAUDE.md`):** procedural fallback keeps working (all
`MenuImages` consumers already branch on null); save changes are additive — **this update writes
no new save fields at all**; heroes stay monkeys and weapons stay wands (no art changes);
no server.

---

## 5. Verification

Per `CLAUDE.md` §4, both gates must pass before shipping:

```sh
python tools/artshot/serve.py 8099 .

node tools/artshot/capture-harness.mjs \
  --chrome="C:/Program Files/Google/Chrome/Application/chrome.exe" \
  --profile=<tmp> --dom=__shots/play.html --screenshot=__shots/play.png --viewport=1600,900 \
  --url="http://127.0.0.1:8099/tools/artshot/harness.html?screen=menu&tab=play&badge=1"
# must report: DONE EXC:0

node tools/validate-assets.js    # must exit 0
```

Capture `tab=home` and `tab=play` before and after. Note that `badge=1` overprints the top-left
corner (§0.5) — shoot brand/layout evidence **without** the badge and correctness evidence
**with** it.

**Screen-specific assertions:**

1. `fitH(1) ≤ avail` on the 1920×1080 logical canvas — i.e. `s === 1`, no shrink. Assert by
   logging `s` from `_drawPlay` in the harness.
2. Nightmare + zero Trials shows `+50% XP` in the Run Rewards bar (the exact case the old code
   showed nothing for).
3. For a sampled set of `(difficulty, trial-subset)` pairs, the bar's numbers equal
   `game.runBonus` after `_startRun()`.
4. Every Trial chip renders its `desc` un-truncated at 1920 logical width.
5. A fresh save (`runs === 0`, `casesOpened === 0`) shows the loadout summary row **dimmed with
   no hotspot**, and the phone-landscape profile
   (`--device=mobile-landscape`) still fits.

---

## 6. Out of scope

- No new logo/wordmark art (owner chose to restage the existing assets).
- No changes to what any Trial, Patron, or Difficulty tier actually *does* — this update changes
  only what the player is told. Retuning is a separate decision.
- No re-gating of tabs; `tabUnlocked` is correct as written (§0.5).
- The 6,700-line `MenuRenderer.js` is not split here. It is a real code-health problem, but
  splitting it under a UX change would make the diff unreviewable. Worth its own update.
