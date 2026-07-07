# EMBERWAKE — The CardCompositor contract

*Shipped by update #2 (EMBERGLASS — The Keeper's Lens). This is the single
share-card + export module for the whole game. Any update that wants a shareable
card registers a template here — it never rebuilds the offscreen canvas, the
share ladder, or the clipboard/download plumbing.*

Source: `src/systems/CardCompositor.js` (the module) + `src/content/cardTemplates.js`
(the templates this update ships).

---

## The one module

`getCardCompositor()` returns the lazy singleton over a **1200×630** offscreen
canvas (the OG-image aspect — pastes clean into Discord/Twitter/Slack embeds).
`1200×630` is a **fixed contract**: templates may assume exactly that size.

```js
const compositor = getCardCompositor();
compositor.registerTemplate(id, drawFn);      // drawFn(ctx, data, helpers) — sync
compositor.captureFromCanvas(srcCanvas);      // stash a cover-cropped world screenshot → helpers.bg
const canvas = compositor.compose(id, data);  // draw a template → the card canvas (or null)
await compositor.toBlob('image/png');         // Promise<Blob>
await compositor.share({ title, text, filename }); // clipboard → native share → download; { ok, method }
compositor.download(filename);                // <a download> — the always-works floor
```

- Everything is guarded/optional-chained so the auto-mint on the headless art
  harness (and any death) can never throw — `toBlob`/`share`/`download` are
  deferred strictly to user taps. `compose`/`captureFromCanvas` are pure canvas.
- `share()` MUST be called synchronously inside a user-gesture handler; it builds
  the `ClipboardItem` with a `Promise<Blob>` value before any await so Safari's
  gesture rule holds.

## Template contract — OPEN & append-only

`registerTemplate(id, drawFn)` — any update registers its own template(s). The
registry is **open and append-only**; a template is never edited by a foreign
update. `drawFn(ctx, data, helpers)` is a **synchronous** function that draws the
full card into `ctx` (a 2D context over the 1200×630 canvas).

- `data` — a plain object the caller passes to `compose(id, data)`. Shape is
  per-template (documented by the owning update). Templates must read defensively
  (missing field → sensible default), never throw.
- `helpers.bg` — the cover-cropped world-frame capture (an `HTMLCanvasElement`)
  or `null`. A template uses it as the background and falls back to a themed
  gradient when null (headless / no-capture).

**Known consumers** (this is a directory, not a whitelist — new updates just
register): `'death'`, `'victory'`, `'photo'` (update #2, this update);
`'rite'` (#3), `'siege'` (#13), `'splits'` (#14), `'ashrank'` / `'season'` (#15),
`'challenge'` game-over footer (#17), `'race'` (#19), `'camp'` (#20). None of
those ship their own offscreen canvas, share ladder, or clipboard/download code —
they call `registerTemplate` and reuse this module.

## Extension slots on the death / victory templates

Per the binding cross-spec rulings, the `'death'` and `'victory'` templates are
owned by update #2 and are **never forked**. Later updates decorate them through
two named slots — pure draw functions the compositor invokes, never a redraw of
the base card:

- **`stamp`** — a badge region (top-right). #15 registers its Ash Rank wax seal
  here (blazing / cracked).
- **`footer`** — a text/code line in the footer strip. #17 registers its
  reproduction challenge code here.

A slot renderer is `slotFn(ctx, data, rect)` and is registered via the same
append-only pattern; a template with no slot filled simply skips it. (The slot
plumbing itself is added by the update that first needs it — #15/#17 — as an
append to `cardTemplates.js`, not a change to this contract.)

## Card chrome helpers (shared look)

`cardTemplates.js` provides the forged-ember chrome so every card matches without
copy-paste: the 8px notched ember frame, the EMBERWAKE wordmark + "HOLD THE LAST
LIGHT" sub-line, the procedural-monkey portrait panel (`getHeroFrames`, smoothing
off — the hero is always the procedural monkey, never a flat AI sprite), the
pill stat-chip row, the NEW BEST ribbon, and the footer strip (map · difficulty ·
UTC date). All text uses the menu's Cinzel display face
(`DISPLAY_FONT` / `ensureMenuFont` from `src/assets/MenuFont.js`, headless-safe).

## Data-shape typedefs (informative)

```
// 'death'   — { name, characterId, time, killer:{label,epithet,boss,hazard}, chips:string[], newBest:bool, mapName, difficulty }
// 'victory' — { name, characterId, time, sub, chips:string[], mapName, difficulty }
// 'photo'   — { filterName }
// killer/lastHitBy — { label, epithet:string|null, boss:bool, hazard?:bool }
```

## Invariants

- Fixed **1200×630** canvas; created lazily, once; no per-frame cost when idle.
- No external network / images — the card is fully same-origin, so `toBlob` never
  taints. All chrome + portraits are procedural.
- Registry is append-only; templates are pure sync draws that never throw and
  never mutate the shared hero-frame canvases (read-only `drawImage`).
