# Update #8: GLOAMCALL — The Sixth Patron

*Era III — The World Alight*

**Value verdict (ADDS):** New element with a genuinely new damage grammar (missing-HP scaling, the game's only defensive status), two new weapon-behavior kinds, a sixth Patron, and fusion-table closure — this is the only update extending the draft/evolution/patron content layer at all, verified by the fact that every content class lands append-only in existing home files. Wickweld closing every recipe-less base is a real completeness fix, not filler. Risk is balance, not value.

## What it adds

UMBRAL completes the element wheel with a genuinely new damage grammar: WITHER (bonus damage scaling with the target's missing HP — the "finisher" element) and GLOOM (a stacking sap that weakens enemy contact damage — the only status that protects rather than amplifies). It ships two brand-new weapon kinds — 'well' (the Gloamwell drags the horde into a crushing vortex) and 'swarm' (autonomous seeking gloam-motes that live outside the projectile pool) — three base weapons, three evolutions, the sixth Patron (Gloam, the Hush) with its own passives/keystones/relics/pacts, and Wickweld: 10 fusion recipes that close every recipe-less base weapon in the game.

## Design spec

# GLOAMCALL — Full Implementation Spec

## 0. Verified foundations (all integration points read in code)

- Weapon defs are pure data + a behavior function; `kind` is a free string, and each owned weapon is `{id, level, timer, state}` driven by `WEAPONS[id].update(dt, owned, ctx)` with `ctx = {player, enemies, projectiles, effects, hits, killed, los, solidBlocked, particles, inView, audio}` (src/content/weapons.js:1-24, src/systems/WeaponSystem.js:154-183).
- New kinds keep gameplay state on `owned.state` and are drawn by `WeaponSystem.drawWeaponVisuals` per-kind branches (WeaponSystem.js:194-215) — the Armory pt. 1 precedent (`boomerang`/`beam`/`mine`/`trail`) is exactly the pattern the two new kinds follow. iOS discipline: cached `getGlowSprite` blits only, no per-frame gradients (WeaponSystem.js:479-488).
- Status stamps live on Enemy as flat monomorphic scalars with `apply*` methods: `applyShock` (stacking amp, Enemy.js:357-360) is the template for the new `applyGloom`; boss-flooring discipline per `applySlow`/`applyChill` (Enemy.js:320-347); burn tick + contagion owned solely by `Game._tickStatuses` (Game.js:2317-2389).
- The single contact-damage read site is the crowd-scaled loop in CollisionSystem.js:114-131 (`e.contactDamage` read at :118-123) — GLOOM's sap plugs in exactly there and nowhere else (same "one existing read point" discipline keystones document at keystones.js:7-14).
- Patrons are pure data + `cardPatronMul` (patrons.js:1-12, 92-101); `PATRON_IDS` drives both the entity→patron map (patrons.js:57-64) and the menu chip row, whose width math auto-divides by `PATRON_IDS.length` (MenuRenderer.js:1032-1043) — a sixth chip needs zero layout code.
- Evolutions/fusions/keystones/relics/pacts are all append-only data with explicit "append an entry, no system code change" contracts (evolutions.js:8, fusions.js:14-15, keystones.js REQ builder :33-59, relics.js:15, pacts.js:20).
- Element ownership for keystone recipes is already generic: `ownsElement(g,'umbral')` works the moment a def carries `element:'umbral'` (keystones.js:26).
- Perf caps: `maxEnemyCap: 180` (GameConfig.js:1136), projectile pool `max: 220` (GameConfig.js:1415). Swarm motes and wells deliberately live on `owned.state` (like ashfang discs, weapons.js:1627-1689) so they consume ZERO projectile-pool slots.
- Save: v7 sanitize-with-defaults (SaveSystem.js:126, 192-199+); `stats.totalBosses` exists (SaveSystem.js:43) and gates the Gloam unlock with no schema change. `discoveredRelics` (validateIdList) tolerates new relic ids.

## 1. The UMBRAL element identity

Two halves, one offensive, one defensive — no other element has either:

**WITHER (offense — "the element of endings")**: every umbral weapon hit deals bonus damage `witherPct × (target.maxHp − target.hp) × (player.witherMul ?? 1)`, capped at `ELEMENT.umbral.witherBossCap = 12` (tunable) per hit vs bosses (boss `resist` at Enemy.js:645 applies on top). Anti-tank scaling that complements shock's flat amp without copying it; worthless vs full-HP fodder, monstrous vs wounded elites — the finisher element.

**GLOOM (defense — "the sap")**: `applyGloom(maxStacks, dur)` — a verbatim structural clone of `applyShock` (Enemy.js:357-360): `gloomStacks` (cap 4 base, tunable), `gloomTimer` (4.0s, refresh). Effect: each stack saps that enemy's contact-damage contribution by `sapPerStack = 0.07` (tunable, max −28%), applied as a per-enemy multiplier at the ONE read site: `e.contactDamage * (e.gloomTimer > 0 ? 1 - e.gloomStacks * (ELEMENT.umbral.sapPerStack + (player.gloomSapBonus ?? 0)) : 1)` inside CollisionSystem.js:118-123. Floor the product at 0.4 so gloom never zeroes damage. Bosses: sap halved (floor 0.7) — nudged, never trivialized (mirrors Enemy.js:321/338).

New config block (GameConfig.js, appended to `ELEMENT` at :875-887):
```js
umbral: { tint: '#9a6cff', sapPerStack: 0.07, sapMax: 4, gloomDuration: 4.0,
          witherBossCap: 12, sapFloor: 0.4, bossSapFloor: 0.7 },
```

New shared helper `witherHit(target, baseDamage, cfg, ctx)` exported from weapons.js — the umbral twin of `shockStrike` (weapons.js:1136-1163): deals base + wither rider, pushes hits/killed, stamps gloom, and hosts the two keystone flags (`ks_lastbreath` cull, `ks_eventide` burn-detonate) so umbral has exactly one damage hook, like shock does.

## 2. Kind #1 — 'well' (Gloamwell): vortex drag-and-crush

**Weapon: `gloamwell` — "Gloamwell"** (`kind:'well'`, `element:'umbral'`, `evolvesTo:'gloammaw'`). The roadmap hook weapon.

`initialState() { return { wells: [] }; }` — pattern of emberMine (weapons.js:287).

**Cast (on cooldown):** find the densest cluster: collect up to 48 candidates in `castRange` passing `ctx.inView`; score each by neighbors within 150px among candidates (≤48×48 = 2,304 distSq checks, once per ~3s cast — negligible); drop a well at the best scorer's position (fallback: nearest enemy). Hold timer at 0 when no targets (arcaneBoltUpdate pattern, weapons.js:936-939).

**Per-frame well update (the vortex math):** for each live well (≤`maxWells`), for each active enemy within `pullRadius` of the center:
- Pull: direct position nudge `e.x += nx * pullSpeed * taper * dt` toward center — the same "position integration without obstacle raycast" contract knockback already uses (Enemy.js:589-596). `taper = smoothstep(dist / pullRadius)` rising from 0 at the rim... inverted: full `pullSpeed` at mid-range, tapering to 0 inside `0.6 × crushRadius` so the horde forms a crushed RING, never an infinite-density point (perf + readability mitigation, designed in from PR1).
- Bosses: `pullSpeed × 0.15`, and skipped entirely while `bossWindupTimer > 0 || activeAttack || bossDashTimer > 0` — mirroring the "planted boss ignores knockback" rule (Enemy.js:584-588).
- Cost: ≤2 wells × 180 enemies = 360 distSq/frame. Trivial.

**Crush tick (every `tickInterval = 0.5s` per well):** enemies within `crushRadius` passing `ctx.los` take `witherHit(e, damage × dmgMul, cfg, ctx)`; one `powerRoll` per tick (weapons.js:39-49). Stamps 1 gloom stack. Optional `cfg.burnDps` stamp supported from day one (fusion hook — same optional-field pattern as weapons.js:1012-1017).

**Collapse:** at end of `duration`, one final burst `damage × collapseMul (2.2)` to everything within `pullRadius` (LOS-gated), then a `'wellCollapse'` effect. `player.wellDurationMul` / `player.wellDamageMul` (relic/pact hooks) read here.

**perLevel (8 levels, tunable — parity notes):** crush hits the WHOLE core, so focused DPS sits far under the Cinderbolt curve (L1 ≈33 → L8 ≈200, weapons.js:206-208), paid back by total horde control:
```
L1: damage 14, cooldown 3.6, castRange 520, pullRadius 240, crushRadius 110,
    pullSpeed 150, duration 2.4, tickInterval 0.5, maxWells 1, witherPct 0.04, collapseMul 2.2
L4: damage 22, cooldown 3.2, pullRadius 280, crushRadius 125, pullSpeed 200, duration 2.8, witherPct 0.05
L8: damage 40, cooldown 2.4, castRange 560, pullRadius 340, crushRadius 150,
    pullSpeed 260, duration 3.2, maxWells 2, witherPct 0.07
```
Focused: L1 ≈ 14×4.8 ticks/3.6s ≈ 19 DPS; L8 ≈ 40×6.4/2.4 ≈ 107 + wither + collapse — under 200, correct for a whole-screen CC weapon (compare Cindermine ≈25→133, weapons.js:270-274).

**Draw (`kind === 'well'` branch in drawWeaponVisuals):** flat dark disc (`#141020` at 0.55 alpha), violet rim ring (`#9a6cff`, lineWidth 6, alpha pulsing on well age), 3 spiral arm strokes rotating at 2.4 rad/s, one cached `getGlowSprite('#9a6cff')` blit at 0.35 alpha for the halo, bright core dot. Collapse reuses the drawBlast layering (WeaponSystem.js:614-634) with violet colors via a new `'wellCollapse'` effect kind. Dark-on-dark readability is solved by the RIM, not the body — verified against dark biomes in the PR1 screenshot.

## 3. Kind #2 — 'swarm' (seeking gloam-motes)

Motes are plain objects in `owned.state.motes` — never `Projectile` entities, so the 220-cap (GameConfig.js:1415) is untouched. Movement: seek steering with capped turn — `vx += clamp(...)`, `|v| = moteSpeed`; when idle, loose orbit around the player (spring toward an orbit slot). Target acquisition reuses the enemy's shared `weaponHitCooldown` throttle — the documented cross-weapon fairness channel (weapons.js:960-962, Enemy.js:245) — so a single target can't be shredded by 8 motes in one frame; per-target bite floor = 0.35s.

**Weapon A: `duskmoths` — "Duskmoths"** (`kind:'swarm'`, `element:'umbral'`, `evolvesTo:'nightchorus'`) — the hunter swarm. Each mote: fly to its target (nearest active enemy within `seekRange` of the PLAYER passing `ctx.inView`, cached until dead/out-of-range — no per-frame rescans), on contact `witherHit` (bite damage + 1 gloom + wither 3% missing HP), then `biteCooldown` before re-targeting.
```
L1: motes 3, biteDamage 10, biteCooldown 0.9, seekRange 420, moteSpeed 520, witherPct 0.03
L4: motes 5, biteDamage 16, biteCooldown 0.75, seekRange 480, moteSpeed 600
L8: motes 8, biteDamage 30, biteCooldown 0.55, seekRange 560, moteSpeed 700, witherPct 0.05
```
Parity: single-target ceiling is throttled by the 0.35s shared hit-cooldown → L8 ≈ 30/0.35 ≈ 86 focused (realistically ~60 with travel), well under Cinderbolt 200; the swarm's value is 8 simultaneous chip-streams + gloom coverage.

**Weapon B: `veilwisps` — "Veilwisps"** (`kind:'swarm'`, `element:'umbral'`, `evolvesTo:'winnowveil'`) — the guardian swarm / control moat. Wisps hold a ring at `veilRadius` around the player; an enemy crossing the veil gets LATCHED by a free wisp: `applySlow(slowMul, 0.4)` refreshed each frame while latched (existing channel, Enemy.js:320-324), drain `latchDps` via witherHit ticks every 0.4s, for `latchDuration`, then the wisp returns (`returnCooldown 1.2s`). Max simultaneous latches = wisp count.
```
L1: wisps 2, latchDps 8,  latchDuration 1.6, veilRadius 200, slowMul 0.75
L4: wisps 4, latchDps 14, latchDuration 2.0, veilRadius 240, slowMul 0.68
L8: wisps 6, latchDps 22, latchDuration 2.4, veilRadius 280, slowMul 0.60
```
Deliberately weak DPS (L8 ≈ 6×22 = 132 only if all 6 latched; single-target ≈22) — it's Frostmote's spiritual sibling on the umbral wheel: control first.

Per-frame cost: ≤ 8+6 motes × (integration + one distSq to cached target) + veil-crossing scan (enemies within veilRadius: radius-gated, ≤ ~30 checks) — far cheaper than orbitingBladeUpdate's full-enemy loop.

**Draw (`kind === 'swarm'`):** each mote = one small violet diamond shard (the drawFrostmote shard shape, WeaponSystem.js:416-428, in `#b48cff`) + one cached glow blit at 0.3 alpha; latched wisps draw a 2px tether line to their victim. ≤14 blits + 14 flat paths.

## 4. Evolutions (append to EVOLUTIONS, evolutions.js:10 pattern)

Catalyst discipline per evolutions.js:59-62: each catalyst sits in the Gloam patron pool so a committed Gloam run favors it at ×2.6. Precedent for one passive serving two recipes: `powerStone` (evolutions.js:24, 51).

1. `gloammaw`: `gloamwell` L8 + `witherwick` → **"Maw of Ending"** (maxLevel 1): damage 60/tick, cooldown 2.0, pullRadius 400, crushRadius 190, pullSpeed 320, duration 3.6, maxWells 2, witherPct 0.10, **cull 0.15** — non-boss enemies inside the crush core below 15% max HP are unraveled instantly (killed via ctx.killed, so gems/coins fire normally). Chest text: "The Maw of Ending yawns."
2. `nightchorus`: `duskmoths` L8 + `veilward` → **"Nightchorus"**: motes 12, biteDamage 40, biteCooldown 0.45, seekRange 640, moteSpeed 780, gloom max 6 on its bites, witherPct 0.06. Clearly beats maxed base (8×30) without deleting bosses (boss cap + 0.35s throttle hold).
3. `winnowveil`: `veilwisps` L8 + `witherwick` → **"Winnowing Veil"**: wisps 8, latchDps 30, veilRadius 340, slowMul 0.50, latchDuration 3.0, +1 gloom stamp per latch tick.

## 5. The Gloam Patron (sixth)

Append to PATRONS + PATRON_IDS (patrons.js:14-53):
```js
gloam: { id:'gloam', name:'Gloam', title:'the Hush', color:'#9a6cff',
  blurb:'Drag the horde into the dark — favors umbral weapons and wither perks.',
  weapons:['gloamwell','gloammaw','duskmoths','nightchorus','veilwisps','winnowveil'],
  passives:['witherwick','veilward'] }
```
The ENTITY_PATRON map (patrons.js:57-64) and `cardPatronMul` need zero changes; the menu chip row auto-fits 6 (MenuRenderer.js:1032). Existing 5 pools untouched → no regression to committed-patron draft odds for old builds.

**Unlock gate ("The Sixth Patron" moment):** the Gloam chip is locked until `save.data.stats.totalBosses >= 3` (field verified, SaveSystem.js:43) — "the Gloam answers only those who have felled three of the Twelve." Locked chip renders dimmed with a lock glyph + breadcrumb tooltip line; first frame after unlock plays the selGlow pulse (MenuRenderer.js:1039) and a one-time "GLOAMCALL — a sixth voice answers" banner. Derived from an existing stat → zero save-schema change, old saves that already have 3+ boss kills unlock instantly.

**New passives (append to PASSIVES, cap-aware pattern passives.js:44+):**
- `witherwick` "Witherwick" (maxLevel 5): `p.witherMul = (p.witherMul ?? 1) * 1.15` per level — read only inside witherHit; no engine change, no cap interaction (wither is self-capped vs bosses).
- `veilward` "Veilward" (maxLevel 5): `p.gloomSapBonus = (p.gloomSapBonus ?? 0) + 0.015` per level — read at the single CollisionSystem sap site; total sap hard-floored at `sapFloor`.

**Keystones (append, mk()/REQ pattern keystones.js:52-59; new REQ `umbral: { ok:(g)=>ownsElement(g,'umbral'), label:'an Umbral weapon' }`):**
1. `hush` "Hush" (gloam) — reqs [umbral]: gloom builds 2 stacks higher and saps harder (`g.player.ks_hush = true`, read at witherHit's applyGloom call exactly like Overcharge at weapons.js:1140-1147, +`gloomSapBonus += 0.03`).
2. `last-breath` "Last Breath" (gloam) — reqs [umbral]: your umbral hits unravel non-boss foes below 8% HP (`g.player.ks_lastbreath = true`, read only in witherHit — the single umbral hook).
3. `eventide` "Eventide" (gloam, cross-element) — reqs [umbral, REQ.fire]: well crush ticks detonate burns on crushed foes at 1.5× (`g.player.ks_eventide = true`, read in the well tick; reuses the burnTimer/burnDps consume-and-burst math from shockStrike weapons.js:1148-1162).

**Relics (append to RELICS, relics.js:15 pattern; combat relics — deliberately NOT added to ATTUNABLE per relics.js:176-178 no-damage-attunement rule):**
- `gloamdrop` "Gloamdrop" (uncommon): `p.witherMul = (p.witherMul ?? 1) * 1.15`.
- `hush-candle` "Hush Candle" (rare): `p.gloomSapBonus = (p.gloomSapBonus ?? 0) + 0.06`.
- `void-locket` "Void Locket" (epic): `p.wellDamageMul = (p.wellDamageMul ?? 1) * 1.2` — +20% well crush/collapse damage.

**Pacts (append to PACTS, pacts.js:20 pattern):**
- `pact-gloam` "Pact of the Gloam" (rare): curse −20% pickup range (`p.pickupRange *= 0.8`); boon `p.witherMul ×1.25` + `p.wellDurationMul = (p.wellDurationMul ?? 1) * 1.3`.
- `pact-hungry-dark` "Pact of the Hungry Dark" (epic): curse enemies +20% HP (`g.runScale.hp *= 1.2`); boon `p.witherMul ×1.3` + `p.killHeal += 2` (rides the sustained-heal cap, relics.js:110-113 precedent).

## 6. Combo-table row (the update-3 seam — SEE CORRECTION)

The element combo table does NOT exist yet: `COMBO` (GameConfig.js:1322) is the kill-streak feedback config (Game.js:1582-1584, UISystem.js:422-430). The "reserved umbral row" is update 3's forward promise. This spec therefore (a) isolates the row in PR5, (b) authors it as pure data against the contract #3 is committed to ship (an `ELEMENT_COMBOS` pair-table consumed at the status-stamp/hit sites), and (c) pre-lands the PAYOFF hooks in PR1-2 so the row is one data file when #3's table exists:
- umbral+fire "Ashghast": burns on gloomed targets tick ×1.25 (one multiplier at the burn-tick site, Game.js:2331).
- umbral+frost "Gravecold": chill applied to gloomed targets lands +1 stack (applyChill call-site check, Enemy.js:337-347).
- umbral+shock "Voidsurge": shock amp counts each gloom stack as +0.04 (read in shockStrike's amp line, weapons.js:1142).
- umbral+radiant "Duskdawn": shred cap +1 on gloomed targets (holyPulseUpdate stamp, weapons.js:1054).
- Remaining wheel lanes are authored when #3 names them. If #8 is somehow built before #3 (contradicting the roadmap order), PR5 simply doesn't merge until the table lands — PRs 1-4 are independent.

## 7. Wickweld — the 10 fusion recipes (exact base pairs)

Verified state: FUSIONS covers all 15 pairs of the six ORIGINAL bases only (fusions.js:26-28); the four Armory bases (`ashfang`, `kindleRay`, `emberMine`, `wakefire`) have ZERO recipes, and the three new umbral bases arrive recipe-less. Wickweld closes every one. Discipline per fusions.js:1-15: `fusion:true`, maxLevel 5, L1 ≈ mid-base power, reuse an existing behavior; the four optional-stamp additions below follow the exact documented precedent (weapons.js:1012-1017, 1741-1742, 1839-1840 — "fields absent on the base defs, so their behavior is untouched"):

| # | id | Name | a + b | kind/behavior | new optional stamp needed |
|---|----|------|-------|---------------|---------------------------|
| 1 | `fangwake` | Fangwake | ashfang + wakefire | trail (wakefireUpdate) | none (trail has burnDps) |
| 2 | `kilnray` | Kilnray | kindleRay + emberMine | beam (kindleRayUpdate) | none (beam has burnDps) |
| 3 | `cinderfang` | Cinderfang | ashfang + emberWisp | boomerang (ashfangUpdate) | `burnDps` in ashfangUpdate |
| 4 | `stormfang` | Stormfang | ashfang + voltWand | boomerang (ashfangUpdate) | `shockPerStack` in ashfangUpdate |
| 5 | `beaconray` | Beaconray | kindleRay + holyPulse | beam (kindleRayUpdate) | `applyShred` in kindleRayUpdate |
| 6 | `minecoil` | Mine Coil | emberMine + lightningMark | mine (emberMineUpdate) | `shockPerStack` in blast loop |
| 7 | `frostwake` | Frostwake | wakefire + orbitingBlade | trail (wakefireUpdate) | `chillMul` in wakefireUpdate |
| 8 | `ashwell` | Well of Ash | gloamwell + emberWisp | well (gloamwellUpdate) | none (well ships with burnDps) |
| 9 | `stormswarm` | Stormswarm | duskmoths + voltWand | swarm (duskmoth behavior) | none (bites route via witherHit; add shock fields) |
| 10 | `vigilveil` | Vigilveil | veilwisps + holyPulse | swarm (veil behavior) | shred on latch tick |

Each gets a 5-level perLevel at the established fusion power curve (L1 ≈ mid-base, L5 ≈ 1.2× maxed base focused-DPS-equivalent) — full tables authored in PR4 using the same parity comments the existing 15 carry. `findEligibleFusions` (fusions.js:40-49) needs zero changes.

## 8. Cross-cutting data hookups (every new id, no exceptions)

- `WEAPON_AURA` entries (weapons.js:859-894): gloamwell `{color:'#9a6cff',pulse:true}`, gloammaw `#6a4fb0` pulse, duskmoths `#b48cff`, nightchorus `#b48cff` pulse, veilwisps `#8a7bd8`, winnowveil pulse, + the 10 fusions.
- `weaponSkins.js` prop entries — mandatory or the hero goes empty-handed mid-run (weaponSkins.js:76): gloamwell `{prop:'staff', accent:'#9a6cff', glow:'#b48cff'}`, duskmoths `{prop:'wand'...}`, veilwisps `{prop:'shard'...}`, + evolutions/fusions. Wands/staves only — never blades (CLAUDE.md).
- `WEAPON_FX_GLOWS` prewarm (WeaponSystem.js:488): add `'#9a6cff','#b48cff','#6a4fb0'`.
- `STAT_FIELDS` card labels (UpgradeSystem.js:312-338): `pullRadius`→"Pull", `crushRadius`→"Crush", `wisps`→"Wisps", `biteCooldown`→"Bite", `latchDps`→"Drain/s", `witherPct`→"Wither" (`${Math.round(v*100)}% missing HP`). (`motes`, `duration`, `range` already exist.)
- UpgradeSystem needs NO pool changes: new bases enter via `WEAPON_IDS` automatically (UpgradeSystem.js:246-252); evolved/fusion flags already exclude the rest (:249).
- Patron draft favor ×2.6 / off-pool ×0.35 (patrons.js:72-73) applies to the new ids automatically once the pool entry exists.

## 9. Failure modes designed against from PR1

1. **Perf: the mega-clump.** Pulling 100+ enemies to a point risks O(n²) separation hotspots + 60-sprite overdraw + a one-frame contact spike. Mitigations: pull tapers to 0 inside 0.6×crushRadius (ring formation, never a singularity); ≤2 wells; pull is radius-gated (≤360 distSq/frame); the player-side crowd-damage cap already clamps pile damage at 2.5× strongest (CollisionSystem.js:127-131). PR1 verification includes a 35s harness soak at max wave pressure with `badge=1` EXC:0.
2. **Balance: wither+gloom trivializing bosses or hordes.** Wither is flat-capped vs bosses (12/hit before resist), cull is non-boss + umbral-hit-gated + ≤15% threshold, sap is floored (0.4 normal / 0.7 boss) and caps at 4 stacks; the well can't CC bosses (0.15 pull, zero while planted). Every number is data-tunable without engine edits.
3. **Saves/compat: sixth patron on old saves.** Unlock derives from the existing `stats.totalBosses` — no new key, no version bump; `discoveredRelics`/`relicAttunement` validators already drop/ignore unknown ids (SaveSystem.js:347); a save holding `selectedPatron` semantics is unaffected (selection is per-session on Game, Game.js:186). A pre-GLOAMCALL save loaded post-update sees one new locked chip and nothing else changed.
4. **Readability/mobile: dark weapon on dark world.** All umbral visuals lead with bright violet RIMS and cores on flat dark bodies; motes are ≤14 cheap shard paths; verified in both harness screenshots (menu + gameplay) on the dark biomes.

## PR plan

### PR1 — GLOAMCALL 1/5 — Umbral element core + the Gloamwell ('well' kind)

**Goal:** Ship the UMBRAL identity (WITHER + GLOOM) end-to-end with its first weapon: the Gloamwell vortex, fully playable with procedural visuals.

**Files:**
- `src/config/GameConfig.js`
- `src/entities/Enemy.js`
- `src/systems/CollisionSystem.js`
- `src/content/weapons.js`
- `src/systems/WeaponSystem.js`
- `src/content/weaponSkins.js`
- `src/systems/UpgradeSystem.js`

**Work:**
- Append ELEMENT.umbral config block (tint/sapPerStack/sapMax/gloomDuration/witherBossCap/floors)
- Enemy: add gloomStacks/gloomTimer fields (constructor, near shock fields Enemy.js:267-268), applyGloom() as applyShock clone (Enemy.js:357), decay in the status timer block
- CollisionSystem.js:118-123: fold the gloom sap multiplier into the contact-damage read (floored, boss-floored)
- weapons.js: export witherHit() helper (shockStrike twin, hosts ks_lastbreath/ks_eventide flags); add gloamwell def (8-level perLevel per spec), gloamwellUpdate (density-cast, tapered pull, crush ticks, collapse; boss pull rules), WEAPON_AURA entry
- WeaponSystem.drawWeaponVisuals: kind==='well' branch (dark disc + violet rim + spiral arms + cached glow); 'wellCollapse' effect kind in drawEffects; extend WEAPON_FX_GLOWS with umbral colors
- weaponSkins.js: gloamwell prop entry (staff, violet accents); UpgradeSystem STAT_FIELDS: pullRadius/crushRadius/witherPct labels

**Verify:**
- node --check on every touched file
- node tools/validate-assets.js exits 0
- headless harness ?seconds=35&badge=1 → EXC: 0 screenshot
- harness console: g.weaponSystem.addWeapon('gloamwell') then 30s soak at late-wave pressure — confirm pull ring forms, no frame-time spikes, crush numbers appear, gloomed enemies hit softer
- adversarial review, squash-merge to main

### PR2 — GLOAMCALL 2/5 — the 'swarm' kind: Duskmoths + Veilwisps

**Goal:** Ship the second new kind: autonomous seeking gloam-motes (hunter swarm) and the guardian latch-veil, both outside the projectile pool.

**Files:**
- `src/content/weapons.js`
- `src/systems/WeaponSystem.js`
- `src/content/weaponSkins.js`
- `src/systems/UpgradeSystem.js`

**Work:**
- duskmoths + veilwisps defs (perLevel tables per spec) + shared swarm steering behavior on owned.state.motes (cached targets, weaponHitCooldown throttle 0.35s, orbit-when-idle)
- Veil latch logic: slow-refresh channel + latchDps witherHit ticks + tether state
- drawWeaponVisuals kind==='swarm' branch: violet shard motes + latch tethers (frostmote shard pattern)
- WEAPON_AURA + weaponSkins props for both; STAT_FIELDS: wisps/biteCooldown/latchDps

**Verify:**
- node --check; node tools/validate-assets.js exit 0
- harness badge=1 EXC:0 with both weapons force-granted; confirm projectile-pool count untouched (badge projectile readout) while 14 motes live
- single-target throttle check: one boss, verify bite cadence respects the 0.35s shared cooldown
- adversarial review, squash-merge

### PR3 — GLOAMCALL 3/5 — the Gloam Patron: unlock, passives, evolutions, keystones, relics, pacts

**Goal:** Complete the sixth allegiance: menu-locked patron chip, its two passives, three evolutions, three keystones, three relics, two pacts — all append-only data.

**Files:**
- `src/content/patrons.js`
- `src/content/passives.js`
- `src/content/evolutions.js`
- `src/content/keystones.js`
- `src/content/relics.js`
- `src/content/pacts.js`
- `src/content/weapons.js`
- `src/systems/MenuRenderer.js`
- `src/systems/UIStateBuilder.js`

**Work:**
- patrons.js: gloam entry + PATRON_IDS append
- passives.js: witherwick + veilward (cap-aware pattern)
- weapons.js: gloammaw / nightchorus / winnowveil evolved defs (+ cull logic in well tick, gated non-boss); evolutions.js: three recipes with Gloam-pool catalysts
- keystones.js: REQ.umbral + hush / last-breath / eventide (flags read only in witherHit / well tick)
- relics.js: gloamdrop, hush-candle, void-locket; pacts.js: pact-gloam, pact-hungry-dark
- MenuRenderer patron row: locked-chip render (dim + lock glyph + 'Fell three of the Twelve' hint) gated on save stats.totalBosses >= 3, unlock pulse + one-time banner; UIStateBuilder passes the unlock flag

**Verify:**
- node --check; validate-assets exit 0; harness menu screenshot (screen=menu&tab=play) shows 6 chips, locked state on a fresh save, unlocked on a stats-seeded save
- full-run smoke: commit Gloam, verify ×2.6 draft favor surfaces umbral cards; evolve gloamwell via forced chest to confirm the recipe path
- keystone breadcrumb check: one-piece-short hint renders (keystoneBreadcrumbs)
- adversarial review, squash-merge

### PR4 — GLOAMCALL 4/5 — Wickweld: 10 fusion recipes closing every recipe-less base

**Goal:** Every base weapon in the game now has at least one fusion recipe; four existing behaviors gain their documented optional elemental stamps.

**Files:**
- `src/content/fusions.js`
- `src/content/weapons.js`
- `src/content/weaponSkins.js`

**Work:**
- fusions.js: append the 10 recipes (fangwake, kilnray, cinderfang, stormfang, beaconray, minecoil, frostwake, ashwell, stormswarm, vigilveil) with exact a/b pairs per spec
- weapons.js: 10 fusion defs (fusion:true, maxLevel 5, parity-commented perLevel); optional stamps: burnDps+shockPerStack in ashfangUpdate, applyShred in kindleRayUpdate, shockPerStack in emberMineUpdate blast, chillMul in wakefireUpdate — all absent-field-safe
- WEAPON_AURA + weaponSkins fusion prop entries for all 10

**Verify:**
- node --check; validate-assets exit 0; harness badge EXC:0
- regression: force-grant each of the 4 modified BASE weapons and confirm behavior byte-identical (no stamp fields on base defs)
- shrine path: force both ingredients for 3 sample recipes, confirm findEligibleFusions offers them and fusedLevel math shows on the card
- adversarial review, squash-merge

### PR5 — GLOAMCALL 5/5 — umbral combo row + balance/polish pass

**Goal:** Slot the umbral row into KINDLED's element combo table (dep: update 3 shipped) and land the tuning pass from real-run data.

**Files:**
- `src/config/GameConfig.js`
- `src/core/Game.js`
- `src/content/weapons.js`
- `src/entities/Enemy.js`
- `ASSET_CREDITS.md`

**Work:**
- Author the umbral row payoffs against #3's shipped ELEMENT_COMBOS shape: Ashghast (burn ×1.25 on gloomed, Game.js:2331 site), Gravecold (+1 chill stack), Voidsurge (gloom counts +0.04 in shockStrike amp), Duskdawn (+1 shred cap)
- Balance pass on all PR1-4 numbers from playtest notes; hook up any higgsfield umbral FX sprites that landed out-of-band (credits row per asset) — procedural visuals remain the shipped fallback
- If #3's table is not yet on main, this PR waits — PRs 1-4 are complete and shippable without it

**Verify:**
- node --check; validate-assets exit 0 (including any new credited assets)
- harness badge EXC:0 + a combo-payoff screenshot (gloam+fire run showing hotter burn ticks)
- adversarial review, squash-merge

## Data & save changes

**New content (all append-only, no new files — every content class already has its home file):**
- weapons.js: 3 base defs (gloamwell, duskmoths, veilwisps), 3 evolved defs (gloammaw, nightchorus, winnowveil), 10 fusion defs, 2 new behavior functions (well, swarm) + exported `witherHit` helper, ~19 WEAPON_AURA entries.
- patrons.js: `gloam` entry + `PATRON_IDS` append. passives.js: `witherwick`, `veilward`. evolutions.js: 3 recipes. fusions.js: 10 recipes. keystones.js: `REQ.umbral` + 3 keystones. relics.js: 3 relics (NOT attunable). pacts.js: 2 pacts. weaponSkins.js: ~16 prop entries.

**Config blocks (GameConfig.js):** `ELEMENT.umbral = { tint:'#9a6cff', sapPerStack:0.07, sapMax:4, gloomDuration:4.0, witherBossCap:12, sapFloor:0.4, bossSapFloor:0.7 }`; PR5 adds the umbral rows to update-3's ELEMENT_COMBOS table.

**Engine touches (small, precedented):** Enemy gloom fields + `applyGloom` (applyShock clone, Enemy.js:357); one sap multiplier at the single contact-damage read (CollisionSystem.js:118-123); two drawWeaponVisuals branches + 1 effect kind (WeaponSystem.js:199-225); STAT_FIELDS labels (UpgradeSystem.js:312-338); MenuRenderer locked-chip state.

**Save schema: ZERO new keys, no version bump.** The Gloam unlock derives from the existing `stats.totalBosses` (SaveSystem.js:43); new relic ids flow through the tolerant `discoveredRelics` validateIdList; nothing umbral is attunable so `relicAttunement` is untouched. Fully backward- and forward-compatible (an old client ignoring unknown weapon ids in nothing — weapons are never persisted mid-run).

## Balance numbers (all tunable)

| Number | Start value | Rationale | 
|---|---|---|
| GLOOM sapPerStack / max stacks | 7% / 4 (−28% cap) (tunable) | Meaningful survivability vs committed umbral play; below thickHide's 5-level −34% so a status never beats a passive line |
| GLOOM duration / boss floor | 4.0s refresh / sap halved, floor 0.7 (tunable) | Matches shock/shred 4.0s convention (weapons.js:140); boss "nudged never trivialized" (Enemy.js:321) |
| WITHER rider | 3-7% of missing HP by level; boss cap 12/hit (tunable) | Finisher scaling; at 50%-wounded 2000HP boss = 12 (capped) vs ~40-70 on wounded elites — anti-tank without boss-melt |
| Gloamwell L1→L8 crush | 14→40 dmg / 0.5s tick, cd 3.6→2.4, pull 240→340px @150→260px/s, crush 110→150, duration 2.4→3.2, wells 1→2 | Focused ≈19→107 DPS, far under Cinderbolt 33→200 (weapons.js:206-208) — paid in whole-horde CC, the kind's identity |
| Collapse burst | 2.2× tick damage (tunable) | A visible exclamation, ~equal to one Cindermine blast at level parity |
| Boss pull | ×0.15, zero while planted (tunable) | Mirrors knockback-planted rule Enemy.js:584-588 |
| Duskmoths L1→L8 | 3→8 motes, bite 10→30, per-mote cd 0.9→0.55, shared per-target throttle 0.35s | L1 ≈33 DPS (parity with Cinderbolt L1); L8 single-target ceiling ≈86 — swarm pays in 8-way spread + gloom coverage |
| Veilwisps L1→L8 | 2→6 wisps, drain 8→22/s, veil 200→280px, slow 0.75→0.60 | Control-first: L8 ≈132 only if fully latched; the moat is the product |
| Gloammaw cull | non-boss < 15% HP inside crush (tunable) | Execute reads as spectacle, saves ~10% of TTK vs crowds, never touches bosses |
| Evolutions | Maw 60/tick @2.0 · Nightchorus 12×40 @0.45 · Winnowveil 8×30/s | Each clearly beats its maxed base (evolution payoff discipline, weapons.js:328-333) |
| Keystone Hush | +2 gloom cap, +3% sap/stack | Overcharge template (weapons.js:1140-1147) |
| Keystone Last Breath cull | 8% HP, non-boss, umbral hits only | Half of Gloammaw's cull — keystone < evolution |
| Fusion curve | L1 ≈ mid-base power, maxLevel 5 | Existing fusion discipline (fusions.js:5-12) |
| Patron unlock | stats.totalBosses ≥ 3 | ~1-3 runs for an active player; existing stat, zero save change |
| Wither passives/relics | witherwick +15%/lvl ×5; gloamdrop ×1.15; void-locket wells ×1.2 | Multiplicative stack ceiling ≈ ×2.8 wither — big but only vs missing HP, self-limiting |

## Art needs (non-blocking)

- NON-BLOCKING (procedural ships first, PR1-2): all umbral weapon visuals are procedural canvas draws (dark disc + violet rim well; shard motes) following the Armory pt. 1 pattern — the update is 100% shippable with zero external art.
- higgsfield (separate session, PR5 hookup at most): optional polish sprites — a gloam-moth glow sprite sheet and a well-vortex swirl texture, background-keyed via tools/artshot/key-sprite.mjs; each gets an ASSET_CREDITS.md row and validate-assets must stay green. No enemy/creature art is touched, so the locked canonical style (the 5 approved sheets) is not in play.
- Blender pipeline (tools/blender/): optional umbral wand/staff material variant for the held prop, riding update 1's wand-armory models when convenient — until then the existing 'staff'/'wand'/'shard' procedural props in weaponSkins.js cover every new id.
- Menu: the Gloam patron chip is text+color like the other five (MenuRenderer.js:1033-1043) — no art asset required for the sixth-patron moment; the unlock banner reuses the existing banner system.

## Risks

- Perf mega-clump: the well's whole fantasy is stacking the horde — enemy separation and overdraw could spike at 180 enemies pulled into one core. Mitigated by design (pull tapers to a ring, ≤2 wells, radius-gated scans) and PR1's late-wave soak test; if frame time still spikes, the pullRadius/pullSpeed knobs degrade gracefully without code change.
- Update-3 coupling: the combo row (PR5) depends on KINDLED's not-yet-existing ELEMENT_COMBOS table; if #3 slips or ships a different shape, PR5 re-shapes to it — PRs 1-4 are deliberately independent and complete without it, so GLOAMCALL cannot be blocked, only its last PR delayed.
- Balance: two new damage grammars (missing-HP wither + contact-damage sap) interact with pacts/relics multiplicatively; a stacked witherMul ≈×2.8 build could shred wounded bosses. Caps are all data (witherBossCap, sap floors, cull thresholds) and PR5 reserves an explicit tuning pass from real runs.
- Draft dilution: +3 base weapons and +2 passives grow the level-up pool, slightly lowering every card's odds for non-Gloam runs; acceptable (Armory pt. 1 set the precedent) and self-correcting via patron favor ×2.6 + pity — verified against the L8-in-window math documented at UpgradeSystem.js:157-165.

## Uniqueness & boundaries

GLOAMCALL is the ONLY update in the 20 that adds a new element, new weapon-behavior kinds, or a new Patron — it completes the run-build combinatorial space (element wheel, fusion table, patron roster) that every later update consumes but none extend. No other update touches the draft/evolution/fusion/keystone content layer at all. Sharpest boundaries: #3 KINDLED (nearest neighbor) owns the combo-table ENGINE, manual ults, and targeting — GLOAMCALL deliberately builds no combo machinery, only the umbral data row for #3's table, and adds no active/aimed abilities (all three umbral weapons are auto-cast like every other weapon). #5 THE KINDLED TROOP owns friendly autonomous entities — the swarm motes are deliberately stateless weapon FX on owned.state, not companions: no HP, no leveling, no roster/perch UI. #10 THE SEVENTH AND EIGHTH WICKS owns hero-side identity growth (new monkeys, quest chains) — GLOAMCALL adds zero heroes and zero meta-progression beyond the derived patron unlock. #16's Everforge owns weapon-TIER prestige (mythic material variants) — GLOAMCALL adds breadth, never a power tier above L8/evolution. Correction to the synopsis: the 'reserved umbral row' seam does not exist in code yet (verified — GameConfig.js:1322's COMBO is kill-streak feedback), so this spec supplies the contract and quarantines the row in its final PR.

## Roadmap corrections found while grounding

- ROADMAP.md:71 'slotting into KINDLED's reserved combo row' implies an existing reserved seam — VERIFIED FALSE today: no element combo table exists anywhere in src/. The only 'COMBO' export (GameConfig.js:1322) is the kill-streak feedback config consumed by Game.js:1582-1584 and UISystem.js:422-430. The reservation is a forward promise of update #3 (which is also unbuilt). Spec response: umbral combo-row payoff HOOKS are pre-landed inside umbral-owned code paths in PR1-2, and the row itself is isolated in PR5, gated on #3's shipped ELEMENT_COMBOS interface — PRs 1-4 ship regardless.
- All other synopsis claims verified true in code: patrons are pure data + weight helper (patrons.js:1-12); evolutions/fusions/keystones/relics/pacts are append-only with explicit no-system-change contracts (evolutions.js:8, fusions.js:14-15, keystones.js:33-59, relics.js:15, pacts.js:20); 'closing every recipe-less base' is real — fusions.js:26-28 confirms only the six ORIGINAL bases have recipes, leaving ashfang/kindleRay/emberMine/wakefire recipe-less exactly as the Wickweld half assumes. One nuance the synopsis omits: PATRON unlock/commit is per-session state on Game (Game.js:186, :774), not persisted save data — so 'the Sixth Patron' needs an unlock GATE (derived from the existing stats.totalBosses, SaveSystem.js:43) but no save-schema change, and the menu chip row self-scales to 6 (MenuRenderer.js:1032).

## Binding cross-spec rulings affecting this update

- **[#4 BOSSFORGE vs #8 GLOAMCALL vs #17 THE SEALED STORM]** #8's 'swarm' kind (Duskmoths/Veilwisps gloam-motes) is specced to "live outside the projectile pool" — directly against #4's load-bearing substrate (pooling + the first ENFORCED projectile caps + shared spatial grid) and against #17's determinism requirement of pooled/ordered entity updates. An unpooled, uncapped, self-colliding mote class re-opens the O(P×E) hot loop and the per-shot allocations #4 exists to close.
  **RULING:** #4 owns the perf substrate. Swarm motes MAY be a distinct entity class from projectiles, but they MUST (a) be pooled with a hard cap declared in GameConfig (counted in a SWARM budget beside the ~220-projectile cap), (b) resolve collisions through #4's shared spatial grid — no parallel collision path, and (c) update in stable, pooled iteration order so #17's determinism assertion holds. #8's spec replaces "live outside the projectile pool" with "live in their own pooled, capped, grid-registered swarm pool."

- **[#12 CINDERS & SCRIPTURE vs #6 UNDERTOW, #8 GLOAMCALL, #11 FORGEHEART, #16 NIGHTFALL CYCLES]** #12's fixed counts are stale against its ship position: BESTIARY_ROSTER has 21 entries but #6 ships 4 drowned creatures six updates earlier (roster should be 24+); "26 relics" equals TODAY'S relics.js count, ignoring #8's umbral relics that ship before it; the boss pages ignore #11's three bosses and #6's Tidewarden; and #16 later adds 6 reliquary relics and 5 twilight elites that would strand the Archive's 100% Curator's Lantern.
  **RULING:** #12 owns the codex but must author it against the post-#11 world AND make it append-safe: BESTIARY_ROSTER includes the drowned family and twilight-elite slots come free via registry-driven pages; the Relics page and shelfProgress() compute denominators from the live relics.js roster, never a literal; boss coverage = The Twelve page (fixed) + roster-driven entries for Forgeheart bosses and the Tidewarden. Archive completion rewards CHECKPOINT at claim time — once claimed they are never revoked or re-locked when #16 (or any later update) grows a roster. #16's spec adds one line: its reliquary relics and twilight elites surface in the codex as data appends only, no codex UI changes.

- **[#5 THE KINDLED TROOP vs #8 GLOAMCALL]** #5's familiars.js documents "a reserved umbral slot" (mirroring #3's reserved combo row), but #8 — the sole owner of all umbral content — never claims an umbral familiar; the reservation is dangling with no assigned builder anywhere in #2–#17.
  **RULING:** #8 owns all umbral content. Either #8 PR3 (Gloam Patron content) fills the sixth familiar slot as an append-only familiars.js row consuming #5's archetype contract, or the reservation is explicitly marked "deferred past update 17" in #5's spec. #5 must not ship a sixth familiar itself, and the slot must not block #5's roster UI (render 5 + one locked silhouette at most).
