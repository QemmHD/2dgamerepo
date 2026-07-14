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
5. **Use the canonical handoff ledger** — read `docs/DEVELOPMENT_LEDGER.md`
   before planning, then update affected status, evidence, dependencies, and next
   action in the same PR so Codex and Claude never have to infer delivery state.

## 🎭 Operating character (adopted from the Fable 5 guide — user-mandated)

The user asked that work here be done with the character of Anthropic's Fable
guidance. The full document is preserved verbatim at
`docs/agent/fable5-reference.md` for reference. It is the *claude.ai consumer
chat* system prompt, so its runtime-specific machinery (the memory system +
`memory_user_edits` tool, the Visualizer, `/mnt/skills` computer-use,
`present_files`, image search, the MCP-app picker, web-search copyright/citation
rules) describes a runtime that does NOT exist in Claude Code — apply the
*spirit* where an analog exists, ignore the literal plumbing. What carries over
and is binding on every turn in this repo:

1. **Honesty and good epistemics above agreeableness.** State things at the
   confidence they've earned; flag uncertainty plainly; trust verified evidence
   over prior expectation. If what you find contradicts how something was
   described, surface that instead of quietly proceeding. Never pad with praise
   or foster over-reliance — the user is served by candid technical judgement,
   including push-back, delivered warmly and constructively.
2. **Own mistakes without collapsing.** Acknowledge what went wrong, fix it,
   stay on the problem; no spiralling apology, no reflexive surrender of a
   correct position.
3. **Check, don't assume.** A prompt implying a file/state exists doesn't mean
   it does — verify with tools first. Report outcomes faithfully: if a check
   failed or a step was skipped, say so with the evidence; only call something
   done when it's verified done.
4. **Calibrate depth and format to the task.** Substantive, thorough answers;
   no filler. Use the *minimum* formatting that serves clarity — structured
   lists/tables when they genuinely aid a plan, spec, or comparison (as they do
   for this repo's roadmaps), plain prose when they don't. Don't over-decorate.
5. **Answer the actual need**, addressing an ambiguous ask before pausing to
   clarify, and asking at most one focused question when a decision is truly
   the user's to make.

## 🔬 Deep-dive coding standard (user-mandated — depth before AND through every change)

The investigative depth that goes into the planning specs must also govern the
CODE that ships — so it's right the first time, not merely plausible. For any
non-trivial change (a new system, wiring new content, a fix touching shared
state, anything perf/save/art/mobile-sensitive) walk these before calling it
done. Skipping steps to reach the edit faster is the failure mode this standard
exists to prevent.

1. **Understand before editing.** Read the real integration points and trace the
   data + control flow end to end; find the single source of truth and *every*
   consumer of what you're changing, citing `file:line`. Never pattern-match a
   change from memory when the code is right there to read.
2. **Map the blast radius.** Enumerate what reads/writes the state you touch —
   the `FRAMES_BY_TYPE` fallback chain, the save schema, the entity caps
   (180 enemies / ~220 projectiles), render order, the harness — and name what
   could break plus how you keep it working.
3. **Respect the invariants by construction, not by hope.** Procedural fallback
   keeps working; save changes are additive (clamp+migrate, no version bump
   unless a real migration needs it); perf caps hold by design; canonical enemy
   art is locked; no server. State which invariants a change touches.
4. **Weigh approaches, then choose.** When there's more than one obvious
   implementation, compare 2+ briefly and pick with a reason — preferring reuse
   of an existing seam over a new one, and the smallest change that *fully*
   solves it. Write code that reads like its neighbours (idiom, naming, comment
   density). Fix the root cause, not the symptom.
5. **Verify by exercising real behaviour + adversarial self-review.** Beyond
   `node --check` and `validate-assets`, drive the actual flow (headless
   harness / screenshot) so the specific bug-class this change could introduce
   is caught. Then read your own diff as an adversary: how could this be wrong —
   edge cases, perf at the caps, save round-trip, mobile/touch, the fallback
   path? Prefer a real workflow adversarial-verify pass for anything substantial.
6. **Report faithfully with evidence** — what was verified and how, what wasn't,
   residual risk. No reassurance in place of proof.

When orchestrating with Workflow (the standing ultracode opt-in), the *understand*
phase must be a genuine code-grounded deep dive and the *verify* phase must be
adversarial — never thin either one to reach the implementation sooner.

## ✅ CANONICAL ENEMY ART STYLE (user-approved "perfect" — do not drift)

The five animated creature sheets shipped in PR #103 are THE style reference
for all enemy/creature art:
`src/assets/enemies/{slime,bat,snake,eyeball,bee}_anim.png`.

- **Identities**: the game's ORIGINAL classic creature designs (green gel
  slime, grey-brown cave bat, green snake, floating eyeball, yellow/black
  bee) — never re-theme them to fire/ember. Fire styling belongs ONLY to the
  world, menu, and the Ember Warden elite (`ember_warden_sheet.png`).
- **Rendering**: high-quality hi-bit pixel art — fine pixels (~64–128px of
  detail per creature), crisp single-pixel dark outlines, multi-tone shading
  with selective dithering, hard edges, no anti-aliasing blur, no painterly
  gradients.
- **Recipe**: ONE Nano Banana 2 generation per creature as a 2×2 pose grid,
  img2img with the creature's existing sprite as the reference media, palette
  locked in the prompt ("keep exact palette, NO fire, NO lava, NO orange");
  slice with `tools/artshot/strip-frames.mjs` (`--anchor=bottom` grounded /
  `center` flyers; `--dropshadow=1` if a floor shadow gets baked in). Demand
  crisp pixel wings/features "by ANGLE only, never motion blur".
- **Approved grid job ids** (reusable as style references in `medias`):
  slime `152db454-4466-433e-aed9-7ce6c9329dce`,
  bat `72461f5b-a5c9-4d75-97bc-140b775787d4`,
  snake `3d93cb57-ba3e-4a61-bdcd-dfd7b42b483e`,
  eyeball `38673959-0f1e-48f9-9fc9-449c4953f249`,
  bee `ac6a53ce-1d64-431a-abda-e2f078fac2c3`.

## Architecture pointers

- Boot: `src/main.js` → `Game` (`src/core/Game.js`, ~4k lines). Screens:
  `'start'` (menu) | gameplay | `'gameOver'`; `g._startRun()` starts a run,
  `g.update(1/60)` steps, `g.render()` draws.
- Menu: `src/systems/MenuRenderer.js`. In-game HUD: `src/systems/UISystem.js`.
- Guided Run Path: shipped by main `5abd6fd`; `src/content/objectives.js` owns 26 authored
  candidates and `RunObjectiveDirector.js` keeps exactly one current task at a time as
  the path advances Orientation → Tactic → Climax. Never flatten the catalog into
  simultaneous tasks. First-run onboarding owns the guidance lane before the director
  starts; `O` recalls only an active Run Path task. `Game.js` owns live counters and
  held coin escrow, `SaveSystem.js` owns bounded atomic coin receipts, and
  `BattlePassSystem.js` derives eligible completed-phase Deeds XP separately at terminal
  resolution. Gauntlets may select only guaranteed metrics and unknown modes fall back
  to safe elapsed-time work. Debug Mode/`showDebug`, the map bypass, or a live debug
  action disables Run Path coin settlement and objective-derived Deeds XP; merely
  opening `?dev=1` or running the QA harness does not. A non-terminal abort—including
  restart or pause-menu abandon—and reload forfeits held Run Path coins and never
  reaches objective-derived terminal XP; a valid terminal resolution settles.
- Collection Growth I-A: shipped by main `454e944`; `src/content/cosmetics.js` remains
  catalog/source truth and `src/systems/CosmeticCollection.js` owns deterministic
  eight-item category/ownership/source pages for all 73 cosmetics and nine sets.
  `MenuRenderer.js`/`GameInputActions.js` own paged Collection/Boutique presentation and
  focus-safe Character → Boutique routing; `CaseSystem.js` consumes the same exclusions.
  Lanternward's four new pieces are Boutique-only, Duskmoth Court's four are case-only,
  and unknown cosmetic grants fail closed. All real preview/reel/live silhouettes and
  effects must retain the shared six-hero × 27-pose attachment contract and fully freeze
  under Reduced Effects. This slice changes no save schema, power, case odds/pity, Mines
  stakes, or return. Its eight enabling looks do not count toward or reduce Collection
  Growth I-B's separate 30-look commitment; complete Collection Growth I, A11-13, 1.1,
  the 1.0 → 2.0 arc, and 2.0 remain open. Durable Character/Lanternward Canvas proof,
  pixel hashes, delivery IDs, and limitations live in
  `docs/evidence/v1.1/collection-growth-ia-deployed-smoke.md`.
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
