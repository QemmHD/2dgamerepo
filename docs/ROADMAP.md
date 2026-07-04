# EMBERWAKE — Master Roadmap (v2, 2026-07-04)

*Supersedes the update-ordering in `MAJOR_UPDATE_PLAN.md` ("The Long Vigil", 2026-07-02)
and revises the Kindled-first roadmap (2026-07-03). Re-planned because a material
capability changed: the in-repo Blender pipeline (`tools/blender/`, PRs #123–#125) makes
rigged, animated, pixel-styled character/creature/prop art cheap and repeatable — art
cost was the deciding factor in the previous ranking. Grounded in a 3-lane audit
(engineering backlog / strategic re-rank / fresh-eyes player critique) run 2026-07-04.*

---

## 0. Where the game stands

Systems are deep and healthy (weapons/evolutions/fusions, relics + Wick Roads + pacts +
patrons, cases with honest pity, battle pass, achievements, dailies, gauntlet/nightmare,
guided tutorial). The hero is now a rigged Blender model with bone-exact wand anchors.
The weakest surfaces, verified by screenshots and code:

- **Boss fights are illegible at the climax** — boss title renders behind the timer
  plate, HP numbers wash into the wave label, and the hero's aura bloom can white-out
  the face mid-fight.
- **All 12 bosses are single-pattern for their whole HP bar** — the authored
  `phase2Attacks` kits in `GameConfig.js` are dead data (never read).
- **The first 60 seconds undersell the game** — slime-trickle from off-screen; the
  opening screen is an empty field.
- **The 6-hero roster is one body with tint washes** — a headline feature that reads
  as palette swaps.
- **Art reads as three generations** — fine-pixel Blender hero, coarser canonical
  enemies, chunkier code-drawn bosses.

Corrections vs. old assumptions: enemy-separation O(n²) is **already fixed** (spatial
hash, `Game.js:~2180`); the remaining perf hotspot is `CollisionSystem.resolve`
(O(projectiles × enemies)) plus projectile allocation churn.

---

## 1. NOW — finish the Blender arc ("Reforged", in flight)

The current milestone. Each PR ships independently (verify → PR → squash-merge).

| PR | Scope | Notes |
|----|-------|-------|
| ~~PR1~~ | ~~Rigged monkey + core-four sheets + bone-exact HAND~~ | ✅ shipped #124/#125 |
| PR2 | **Wand armory** — ~25 individual wand models, grip/tip anchors, prop cast strips | Structurally fixes the flamewand-behind, banana-hat, halo anchor nits; feeds Everforge mythics later |
| PR3 | **8 per-family body cast animations** — manifest-driven sheets, per-family HAND arrays | The ult wind-up substrate for Kindled |
| PR4 | **Animation suite** — death/ember-out, victory, dash, personality idles | Dash = Kindled's blink anim; death/victory = the run's two emotional peaks (currently reuse hurt/idle) |
| PR5 | **Five distinct hero bodies** — parametric variants, per-hero sheets + readiness | Kills the palette-swap roster problem |
| PR6 | **Polish + CI** — remaining nits (aura face-washout cap, fur-tint preview gap), headless Blender smoke render in CI | Protects the asset supply chain |

## 2. QUICK WINS — ship alongside/between Blender PRs (small, huge felt value)

1. **Boss phase-2 activation (~30 lines)** — read `phase2Attacks` at the existing 50%
   latch with a phase-shift telegraph + music bump. Upgrades all 12 fights. (Bossforge
   later adds the art; the behavior needn't wait.)
2. **Climax readability pass** — fix the boss-HUD triple collision (title/HP/wave
   label), cap aura/hit-flash bloom so the hero never whites out.
3. **First-minute redesign** — visible on-screen mini-swarm in the first 5–10s;
   tighten wave-1 cadence to deliver the swarm fantasy immediately.
4. **Banner discipline** — kill-streak/vigil announcements out of screen center;
   de-duplicate the double streak report.
5. **Read-hierarchy pass** — threats vs pickups vs decor salience (decor blobs
   currently read as enemies; gems outglow threats).
6. **Damage-number spawn cap/merge** — AoE wipes can burst hundreds of fillText draws.

## 3. THE MAJORS — revised order

### Update 1: KINDLED — The Waking Hand *(unchanged winner, now de-risked: ~22/30)*
Active agency: Kindle-metered per-hero manual ults (Space), aimed blink (i-frames),
Focus targeting, element combo table (Shatter/Thermal Shock/Detonate), Rites, Hero
Attunement, daily Rite Trial + share card. Six PRs as specced (2026-07-03 plan) with
revisions:
- **Sequence after Blender PR2–PR4** — ults consume the per-family cast anims, blink
  consumes the dash anim, ult VFX emit from wand tip anchors.
- **Touch-first inputs are PR1 scope, not a follow-up** — right-side ult button +
  aim gesture + tap-to-Focus, or the flagship ships desktop-only.
- **Game.js extractions ride along** (BossDirector, RunResults, Onboarding seams) —
  ults touch the update loop anyway.
- **Weapon-icon HUD grid** (replaces left-edge text pills) rides with Kindled's HUD work.

### Update 2: BOSSFORGE — The Twelve Reforged *(new entrant, ~21/30)*
The purest payoff of the pipeline: all 12 bosses re-modeled through Blender
(multi-frame idle/attack/hurt/death + telegraph poses — they are currently code-drawn
2-frame sprites, now the weakest art in the game), full phase-2 kits with arena
flourish, **Boss Rush + Weekly Ember modes** (Long Vigil P2.1), and the perf gate:
shared broad-phase collision grid + projectile pooling (P2.7). Bosses are exempt from
the canonical-enemy style lock, and `FRAMES_BY_TYPE` fallbacks make rollout zero-risk.

### Update 3: THE KINDLED TROOP — companions *(biggest riser: 17 → ~20/30)*
Summonable monkey familiars with upgrade paths and build synergy. Was the most
art-expensive concept; now the cheapest — a size+palette parameter sweep of
`monkey_rig.py`, with PR4's personality idles giving companions charm for free.
Gated behind Bossforge's perf work (raises entity counts).

### Update 4: UNDERTOW — The Quenched Forge *(reframed, ~20/30)*
Descent push-your-luck floor mode + a drowned enemy family + Tidewarden boss.
Theme reframed from "water vs ember" to **quenching** — steam, black water, drowned
wick-bearers — to defuse the element clash. Creature batch is routine once Bossforge
proves the Blender creature workflow.

### Absorbed into layers (no longer standalone majors)
- **Everburn (Living Seasons, 18/30)** → the live-ops wrapper shipped around any major:
  server-free seasons, weekly edicts, share cards; seasonal cosmetics become palette
  sweeps of the PR5 hero bodies.
- **Everforge (Ascension, 18.5/30)** → follows Kindled naturally: prestige climb +
  mythic wand tier as material/emissive variant renders of the PR2 wand models.
- **The Warrens (new enemy families, 16/30)** → merged: drowned family → Undertow;
  phase-2 adds → Bossforge.

## 4. CONTINUOUS LANES (amortized, never a "major")

- **Platform**: PWA manifest + cache-first service worker (installable, offline,
  orientation lock); mobile/accessibility pass (P2.5 — ≥44px touch targets, 5+More
  tabs, real volume sliders, case-flash behind reducedEffects, colorblind-safe rarity
  cues, UI scale).
- **Save integrity** (P2.4): read the version field (it's written, never read),
  backup key on parse failure, export/import codes. Every update adds keys; risk
  compounds.
- **Perf budget**: collision grid + projectile pool (Bossforge), damage-number cap
  (quick win), menu gradient caching. Protect the pooled/budgeted baseline.
- **Art coherence**: normalize hero/bosses/props toward the canonical enemy pixel
  grid + outline treatment (the 5 approved enemy sheets are the fixed reference —
  everything else moves toward them, never the reverse).
- **Tech health**: split MenuRenderer/UISystem per-tab; shared menu-action constants
  (currently stringly-typed across two files); SaveSystem tests in CI; Blender smoke
  render in CI.
- **Art-chat queue** (higgsfield, separate session): Grand Signature VFX motifs,
  combo burst decals, biome props — all non-blocking (procedural fallbacks ship first).

## 5. PUNCH LIST (known small items)

banana hat 2px float · halo rests on crown · crown band 1px from eye whites ·
aura pulse whites out face (cap intensity) · flamewand invisible from behind ·
menu customizer fur-tint preview gap · `ASPECT_RATIO` dead export ·
save `version` written-never-read · kill-streak double-report ·
boss HUD layering collision · wave-1 off-screen spawn ring · endgame walls
(twilight/hypergrowth) invisible to the player — surface in HUD/fiction.

---

*Cadence for every item above: verify (headless EXC:0 + targeted checks) → branch
commit + push → PR → squash-merge to main → reconcile branch. Deploys run from main.*
