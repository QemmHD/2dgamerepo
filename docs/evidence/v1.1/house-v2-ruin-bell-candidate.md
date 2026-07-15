# House V2 and Ruin Bell local candidate

Status: **corrected and committed as `662cdc9`, attached to draft PR #205, and locally
validated at 36/36 validators plus syntax/YAML/Bash/diff and independent visual gates,
but not yet accepted by post-correction hosted CI/browser review, merged, deployed, or
shipped**.

This record describes the bounded candidate on
`feature/house-v2-ruin-bell`, based on `origin/main` at
`3449a18cf4ada4eac0926f0259275fae558f622d`. The exact corrected code candidate is
[`662cdc93ec273be7fcae063fc93dc8b63347eb1a`](https://github.com/QemmHD/2dgamerepo/commit/662cdc93ec273be7fcae063fc93dc8b63347eb1a)
in draft [PR #205](https://github.com/QemmHD/2dgamerepo/pull/205). No accepted hosted CI
run, immutable visual artifact, Pages deployment, or public smoke is recorded yet.
Nothing in this file is delivery evidence.

## Reference-image provenance boundary

The user supplied `C:\Downloads\IsZbjO.png` as a spatial reference for a house.
The repository has no verified author, source URL, or reuse license for that local
file. It is therefore **reference-only** and is not a shippable source asset.

Allowed influence is limited to general dwelling principles: recognizable
kitchen/hearth/dining/sleep/storage zones, thick walls, legible circulation, and a
focal domestic prop. The candidate's geometry, footprint, palette, furniture
coordinates, Blender scene, and output pixels must remain original. The supplied
file must not be copied into the repository, traced, cropped, sampled, redistributed,
or named as owned/licensed art. A future source or license discovery cannot silently
change that rule; direct reuse would require a separate credits and rights review.

## Implemented local behavior

The candidate currently contains one mandatory `emberwood-ruin-bell-cabin` among the
eleven Emberwood structures. Its versioned blueprint is shared by structure rendering,
wall/furniture collision, line of sight, spawn exclusion, room lookup, roof cutaway,
door navigation, and the `intact`, `lit`, `damaged`, and `ruined` states. The ruined
east breach disables the same authored wall used by render, collision, LOS, grid, and
navigation queries.

The encounter contract currently reads as follows:

| Contract fact | Candidate value |
| --- | --- |
| Unlock and activation | Unlock at wave index 3; remain inside the 104 px bell focus ring for 1.25 seconds |
| Defendable space | 460 px radius around the cabin, covering the four physical rooms and both exterior approaches |
| Leaving the defense | One warning, a visible `RETURN` countdown, and six seconds to re-enter; expiry fails the current attempt with no reward |
| Wave 1 | 3.5 seconds: two crawler door-runners and one brawler threshold holder |
| Wave 2 | 17 seconds: one spitter marksman, one healer support, and two crawler door-runners |
| Wave 3 | 33 seconds: one charger on an authored south lane, one bomber, and two brawler threshold holders |
| Population | Eleven stable member IDs across six non-colour roles: `DOOR`, `HOLD`, `SHOT`, `AID`, `CHARGE`, and `BLAST` |
| Completion window | All eleven stable IDs defeated; earliest clear at 45 seconds; hard timeout at 60 seconds |
| Retry | One retry after the blueprint's eight-second cooldown; defeated IDs stay defeated and cannot pay twice |
| Placement failure | Exact all-or-none acknowledgement; partial/failed placement enters a technical defer, cleans only accepted bodies, pauses the encounter clock, and consumes no attempt |
| Success | Exactly +32 run XP and one linked choice between a Chest and Wick Shrine; zero direct coins |
| Reward safety | Authored dining-room sockets, 0.9-second pickup delay, exit-before-pickup requirement, sibling despawn after either choice, and one-shot reward receipt keyed by Bell instance, stable reward id, and authored `chest`/`shrine` choice |
| Failure | No XP completion award, Chest, Shrine, or coins; first failure damages the house and preserves one retry, second failure spends the bell and opens the truthful ruined breach |
| Set-piece ownership | Normal swarm creation, new biome hazards, bosses, lieutenants, tactical encounters, and Vigil challenges are gated while the bell owns the stage |

The player-facing objective surface remains a single guidance owner. Desktop uses the
existing right rail. Real COVER-fit phones integrate Ruin Bell status, action, count,
and progress into the existing 72 CSS px top command rail instead of placing another
card over play. Portrait keeps the landscape game stage and presents a persistent,
upright `Rotate to landscape for the full HUD` status outside that rotated stage.
High Contrast and Reduced Effects retain static doorway, role, timer, and objective
truth. The five `?dev=1` Settings controls remain unchanged.

Reward claim truth is separate from merely spawning the pair. Generic boss loot has no
Bell provenance and cannot consume the Bell reward. A claim is accepted only when the
walked-on Chest or Shrine carries the current Bell instance id, current stable reward
id, and one of the two authored choices. The Director records exactly one claim and the
runtime receipt records the chosen branch; foreign ids, invalid choices, generic loot,
and duplicate claims fail closed. After a valid claim, the cabin remains visibly
`cleared`/lit, `rewardReady` becomes false, and the Ruin Bell releases the sole guidance
card so returning to the bell cannot leave or reacquire stale reward instructions.

## Navigation and combat contract

Bellbound enemies carry stable encounter, stage, role, door, room-route, combat-socket,
and charge-lane provenance. The runtime preflights the complete wave before creating
any body. Existing local obstacle steering remains the movement authority, while
House V2 adds room/door targets: bodies that fit use active door or ruined-breach
routes; marksman/support roles use authored positions; the charger uses a clear south
lane; oversized bodies remain exterior hold/siege roles rather than grinding through
an undersized portal. Bellbound projectiles and hazards inherit their member provenance
so defer/failure/clear can retire them with their owner.

Current local navigation proof is bounded but does not close the roadmap's broader
House V2 multiplication gate. `tools/validate-navigation.js` currently passes **73,444
checks**, covering **176** legacy approaches plus **62** House V2 exit/formation routes
and an 180-body stress fixture. `tools/validate-house-v2.js` currently passes **1,049
checks**, including one featured cabin in eleven structures, four states, five zones,
door/body clearance, collision/LOS/grid agreement, spawn/furniture authority, role
routes, and a separate 180-body stress fixture. The full 100-seed, every supported
body/projectile size, measured frame-percentile, and additional-house-kit gates remain
open.

## Adaptive-audio contract

The candidate adds four deterministic semantic events: `warning`, `escalation`,
`clear`, and `failure`. Each selects an authored grave-bell/ember-bell/anvil phrase
from the run seed and event ordinal, queues at the next tracker-bar boundary with a
maximum one-bar wait, plays for one bar, retains a caption/announcement and immediate
fallback SFX, and temporarily steers the existing Hunt/Onslaught/Calm intensity rather
than replacing Emberwood with a permanent generic combat track. The bounded queue is
capped at four cues and is cleared by normal music stop/reset paths.

`node tools/validate-audio.js` currently exits 0 and includes the Ruin Bell registry,
deterministic selection, next-bar promotion, one-bar retirement, combat-target, bounded
queue, and silent-context fallback assertions. This is code/logic proof only; it is
not a long-session listening test, physical-device mix test, background/restore soak,
or proof that SFX never masks the score on every device.

## Authored CI and visual receipt gate

The local workflow changes define eight production-harness states across eleven visual
receipts, but no newly accepted post-correction artifact exists yet:

| Required receipt | Viewport/canvas and required accessibility state |
| --- | --- |
| `ruin-bell-arming-1280x720.png` | 1280x720 arming/intact contract |
| `ruin-bell-warning-1280x720.png` | 1280x720 warning/lit with Full captions |
| `ruin-bell-crossfire-mobile-portrait-390x844.png` | Real 390x844 mobile portrait viewport, DPR 3, touch, 130% HUD, normal effects, upright rotate cue outside the rotated stage |
| `ruin-bell-crossfire-mobile-portrait-reduced-390x844.png` | Same portrait device/state with Reduced Effects |
| `ruin-bell-crossfire-mobile-landscape-844x390.png` | Real 844x390 mobile landscape viewport, DPR 3, touch, 130% HUD, normal effects, objective integrated into the command rail |
| `ruin-bell-crossfire-mobile-landscape-reduced-844x390.png` | Same landscape device/state with Reduced Effects |
| `ruin-bell-breach-high-contrast-1280x720.png` | 1280x720, 130% HUD, High Contrast |
| `ruin-bell-technical-1280x720.png` | Technical defer with attempt preserved |
| `ruin-bell-cleared-1280x720.png` | Cleared/lit, eleven defeated, exact one-shot reward |
| `ruin-bell-failed-1280x720.png` | First failure/damaged, attempt 1, retry true, no reward |
| `ruin-bell-ruined-1280x720.png` | Second failure/ruined, attempt 2, retry false, no reward |

For every state, hosted CI must prove the requested phase and house/structure state,
attempt and failure counters, eleven-member total, exact active/defeated/tagged role
counts, zero blocked active bodies, no pending request, Ruin Bell as the rendered and
accessible objective owner, zero direct coins, non-empty PNG, exact desktop canvas or
mobile viewport dimensions, and `data-qa-ready`/zero-exception completion. Mobile rows
also prove their mobile UA, touch points, coarse pointer, DPR, screen orientation and
portrait rotation. Success additionally requires exactly
one Chest, one Shrine, +32 XP, choice id `chest-or-wick-shrine`, and a valid receipt;
failure/ruined require zero Chest/Shrine and a false reward receipt. CI must collect
eleven non-empty PNGs with eleven unique SHA-256 hashes; each normal/Reduced Effects
mobile pair must also be pixel-distinct. A human must then open every
full-resolution receipt and record readability/cropping/telegraph/reward review before
acceptance; screenshot generation by itself is not visual approval.

The cleared PNG is intentionally a pre-claim choice receipt showing both linked
rewards. Claim provenance, mutually exclusive Chest/Shrine selection, duplicate
rejection, and post-claim stale-card removal are currently logic/runtime assertions in
`tools/validate-ruin-bell.js`; they are not misrepresented here as a ninth accepted
visual artifact.

## Local validation snapshot - 2026-07-14

These commands were run locally against the code now identified by candidate commit
`662cdc9`; they are immutable code identity but not hosted or release evidence:

| Command | Observed result |
| --- | --- |
| `node tools/validate-house-v2.js` | PASS - 1,049 checks; 180-body stress 101,937 probes |
| `node tools/validate-navigation.js` | PASS - 73,444 checks; 176 legacy + 62 House V2 routes; 180-body stress 86,488 probes |
| `node tools/validate-world.js` | PASS - 7,867 checks across 308 biome chunks |
| `node tools/validate-living-vigil-integration.js` | PASS - 161 integration checks |
| `node tools/validate-audio.js` | PASS - existing score inventory plus the Ruin Bell assertions described above |
| `node tools/validate-ruin-bell.js` | PASS - 782 checks; exact encounter, defense, retry, placement, reward claim provenance, no-stale-card, dormant-frame allocation guard, malformed-role-mark fail-closed behavior, runtime/UI/render/audio/dev seams |
| `node tools/validate-hud-layout.js` | PASS - 14,180 assertions across 180 desktop/mobile/orientation scenarios |
| Full local repository gate | PASS - 36/36 validators, 189/189 Node syntax, Blender Python AST, CI YAML parse, Bash syntax across 38 workflow run blocks, and diff check; zero reported failures |

The complete local repository gate passes against the exact code commit. Independent
original-resolution review also accepted the corrected top-down house, unobstructed
mobile command rail, honest portrait orientation cue, and visibly quieter Reduced
Effects pair. Mutable local receipts live under `artifacts/mobile-hud-rail/`; they are
development aids, not release evidence. The hosted Chromium/Web Audio matrix,
immutable eleven-PNG artifact, hosted original-resolution review, long-run
performance/audio soak, and physical-device/assistive-technology checks have not yet
been reconciled for this corrected commit.

## Delivery and roadmap nonclaims

Before anyone says this bounded slice shipped, it still needs accepted hosted gates,
immutable artifact identity/hashes, manual visual review, merge SHA, post-merge `main`
CI, Pages deploy, cache-busted player and `?dev=1` smoke, and a delivery reconciliation
update to this record.

Even after that bounded delivery, it would not complete House V2 as a multi-kit system,
the six-event Waylight promise, all enemy-role work, physical-device/AT acceptance,
First Light, Fair Forge, High Refresh, boss identity rebuilds, new maps/classes/story,
the 1.0->2.0 arc, any later major arc, or the overall 1.0->10.0 roadmap.
