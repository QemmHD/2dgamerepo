# EMBERWAKE — Claude session guide

Vanilla-JS ES-module HTML5 Canvas 2D survivor game. NO bundler; deploys to
GitHub Pages as static files. Logical canvas 1920×1080 (DPR-scaled by
`src/systems/Renderer.js`). Theme: dark-fantasy ember/forge. All 6 playable
heroes are MONKEYS (default "Pyra"); combat is WAND-based — weapon/gear art
must reflect wands, never swords.

## ⚠ TOP-PRIORITY standing directives (user-mandated — survive context compaction)

1. **ALWAYS use Ultracode** — the user has a standing opt-in to multi-agent
   Workflow orchestration for every substantive task. Do not wait for the
   keyword; treat it as permanently on in this repo.
2. **ALWAYS ship to main** — after each verified change-set: commit + push the
   working branch, open a PR, **squash-merge to main** (user pre-authorized;
   don't ask), then reconcile the branch:
   `git fetch origin main && git checkout -B <branch> origin/main` +
   `git push --force-with-lease`. Deploys run from main.
3. **ALWAYS auto-commit + push after every change** — the container is
   ephemeral; nothing may exist only in the working tree.
4. **Verify before shipping** — headless screenshot via
   `tools/artshot/harness.html` with `badge=1` must show `EXC: 0`, and
   `node tools/validate-assets.js` must exit 0.

## Architecture pointers

- Boot: `src/main.js` → `Game` (`src/core/Game.js`, ~4k lines). Screens:
  `'start'` (menu) | gameplay | `'gameOver'`; `g._startRun()` starts a run,
  `g.update(1/60)` steps, `g.render()` draws.
- Menu: `src/systems/MenuRenderer.js`. In-game HUD: `src/systems/UISystem.js`.
- Player is PROCEDURAL & animated (4-dir × idle/walk/cast/hurt) — never
  replace the hero with a flat AI sprite.
- Enemy sprites resolve through layered fallbacks in `Enemy.js`
  `FRAMES_BY_TYPE`: bespoke AI art (`src/assets/EnemySprites.js`: animated
  sheets → single keyed frames) → imported LPC (`MonsterSprites.js` /
  `LpcSprites.js`) → procedural (`ProceduralSprites.js`). Every consumer must
  keep the procedural fallback working.
- Every external/AI asset gets a row in `ASSET_CREDITS.md` (AI art) or
  `src/assets/credits/assets.json` (licensed assets); validated by
  `tools/validate-assets.js`.

## AI-art pipeline (tools/artshot/)

- `harness.html` — boots the real game headless for screenshots
  (`?seconds=35`, `badge=1`, `showcase=<types|1>`, `screen=menu&tab=<t>`).
  Chromium at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`; audio is
  neutralized in-harness; use synchronous stepping (never rAF + virtual-time).
- `serve.py <port> <root>` — MIME-correct static server; `PUT /__save/<name>`
  writes harness output under `<root>/__out/`.
- `key-sprite.mjs` — background-key an AI PNG (flood-fill + desmoke +
  despeck), trim, square, downscale.
- `strip-frames.mjs` — slice a 2×2 animation grid into a shared-scale-aligned
  horizontal 4-frame sheet (`--anchor=bottom|center`).
- `glbsheet.html` — render an (animated) GLB to sprite sheets via three.js
  (run `fetch-three.sh` in the served root first). 3D pipeline: Nano Banana 2
  concept → higgsfield `image_to_3d` (texture+rig+animate in ONE job — a
  separate `3d_rigging` pass drops the texture) → glbsheet 4-direction rows.
- higgsfield MCP: `generate_image` model `nano_banana_pro` is async — poll
  `job_display` until `results.rawUrl`. Meshy animation clips are biped-only;
  non-humanoid creatures animate via 2D 2×2 pose grids instead.
