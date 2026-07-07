// Weapon definitions + behavior functions.
//
// Each weapon has:
//   id            stable string used by save/upgrade/UI lookups
//   name          shown on cards and HUD
//   description   one-liner shown on cards
//   kind          'projectile' | 'orbit' | 'pulse' | 'lightning' — picks behavior
//   evolved       true on evolved variants; UpgradeSystem hides them from
//                 the "new weapon" pool and the UI renders an EVOLVED label
//   maxLevel      optional per-weapon cap; defaults to MAX_WEAPON_LEVEL
//   perLevel      array indexed 1..maxLevel of stat objects
//   initialState  optional () => state object stored on each owned entry
//   update        (dt, owned, ctx) — runs every frame for each owned weapon
//
// `owned` is { id, level, timer, state } — owned by WeaponSystem.
// `ctx`   is { player, enemies, projectiles, effects, hits, killed } —
// behavior functions push damage hits / killed enemies / visual effects
// into the arrays so Game can fan them out (gem drops, damage numbers,
// screen shake, etc.) just like the existing CollisionSystem pipeline.
//
// Behaviors read their config via `WEAPONS[owned.id].perLevel[owned.level]`
// so the same behavior function can power both a base weapon and an
// evolved variant (e.g. orbitingBladeUpdate runs Celestial Blades too).

import { TWO_PI, circleOverlap, distanceSq } from '../core/MathUtils.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, KNOCKBACK, SHOCK_CFG, AURA } from '../config/GameConfig.js';
import { applyCombo } from './elements.js';
import { Projectile } from '../entities/Projectile.js';
import { getEmberWispSprite } from '../assets/ProceduralSprites.js';

// HP fraction at/under which Last Light's rage bonus engages.
const LOW_HP_RAGE_THRESHOLD = 0.35;

// Per-hit damage multiplier from the offensive perks (crit + low-HP rage).
// Folded into the `dmgMul` every weapon already multiplies its base damage by,
// so a single roll covers projectile spawns and instant hits alike. Crit is a
// chance roll, so it's evaluated once per shot / per weapon tick (gated by the
// weapon's own cooldown) — exactly where damage is decided. Returns 1 when the
// player has no offensive perks, so default behavior is unchanged.
export function powerRoll(player) {
    if (!player) return 1;
    let m = 1;
    const rage = player.lowHpDamageBonus ?? 0;
    if (rage > 0 && player.maxHp > 0 && player.hp / player.maxHp <= LOW_HP_RAGE_THRESHOLD) {
        m *= 1 + rage;
    }
    const cc = player.critChance ?? 0;
    if (cc > 0 && Math.random() < cc) m *= (player.critMul ?? 2);
    return m;
}

export const WEAPONS = {
    arcaneBolt: {
        id: 'arcaneBolt',
        name: 'Cinderbolt',
        description: 'Kill-shots LEAP to another husk. Element-less by design.',
        kind: 'projectile',
        evolvesTo: null,
        // Signature: ricochet-on-kill — a lethal bolt leaps to the next
        // nearest unhit foe (independent of pierce). Now active from L1 so the
        // DEFAULT starter has an identity its stat-twin siblings (Pyre Wisp /
        // Stormwand) don't copy, instead of being strictly outclassed by them.
        // The element-less-ness is the deliberate trade (keystone recipes need
        // an element) — the description says so. L8 ricochet stays at 3 so the
        // Cinderstorm evolution (ricochet 4, twin bolts) still clearly wins.
        perLevel: [
            null,
            { damage: 17, cooldown: 0.52, projectileSpeed: 935,  pierce: 0, projectileRadius: 15, ricochet: 1, ricochetRange: 360 },
            { damage: 20, cooldown: 0.50, projectileSpeed: 940,  pierce: 0, projectileRadius: 15, ricochet: 1, ricochetRange: 360 },
            { damage: 24, cooldown: 0.48, projectileSpeed: 980,  pierce: 1, projectileRadius: 15, ricochet: 1, ricochetRange: 360 },
            { damage: 29, cooldown: 0.44, projectileSpeed: 1020, pierce: 1, projectileRadius: 15, ricochet: 2, ricochetRange: 360 },
            { damage: 34, cooldown: 0.40, projectileSpeed: 1060, pierce: 1, projectileRadius: 16, ricochet: 2, ricochetRange: 360 },
            { damage: 40, cooldown: 0.36, projectileSpeed: 1120, pierce: 1, projectileRadius: 16, ricochet: 2, ricochetRange: 360 },
            { damage: 47, cooldown: 0.32, projectileSpeed: 1180, pierce: 2, projectileRadius: 17, ricochet: 3, ricochetRange: 360 },
            { damage: 56, cooldown: 0.28, projectileSpeed: 1260, pierce: 2, projectileRadius: 18, ricochet: 3, ricochetRange: 360 },
        ],
        update: arcaneBoltUpdate,
    },

    orbitingBlade: {
        id: 'orbitingBlade',
        name: 'Frost Glaives',
        description: 'Frozen glaives orbit you, chilling what they touch.',
        kind: 'orbit',
        evolvesTo: null,
        element: 'frost',
        // Signature: every blade strike stamps BOTH a slow and a FROST chill
        // (separate channels) — the orbit ring becomes a moving zone of
        // chilled foes. Deeper chill at higher levels; refresh-based so
        // duration stays flat. (Freeze procs only on the evolved blades.)
        perLevel: [
            null,
            { bladeCount: 1, damage: 12, orbitSpeed: 3.2, orbitRadius: 110, bladeRadius: 24, hitCooldown: 0.35, slowMul: 0.78, slowDuration: 1.0, chillMul: 0.78, chillDuration: 1.0 },
            { bladeCount: 2, damage: 12, orbitSpeed: 3.2, orbitRadius: 110, bladeRadius: 24, hitCooldown: 0.35, slowMul: 0.78, slowDuration: 1.0, chillMul: 0.78, chillDuration: 1.0 },
            { bladeCount: 2, damage: 15, orbitSpeed: 3.4, orbitRadius: 120, bladeRadius: 26, hitCooldown: 0.32, slowMul: 0.74, slowDuration: 1.0, chillMul: 0.74, chillDuration: 1.0 },
            { bladeCount: 3, damage: 15, orbitSpeed: 3.4, orbitRadius: 120, bladeRadius: 26, hitCooldown: 0.32, slowMul: 0.74, slowDuration: 1.0, chillMul: 0.74, chillDuration: 1.0 },
            { bladeCount: 3, damage: 17, orbitSpeed: 3.6, orbitRadius: 130, bladeRadius: 28, hitCooldown: 0.30, slowMul: 0.70, slowDuration: 1.0, chillMul: 0.70, chillDuration: 1.0 },
            { bladeCount: 4, damage: 17, orbitSpeed: 3.6, orbitRadius: 130, bladeRadius: 28, hitCooldown: 0.30, slowMul: 0.70, slowDuration: 1.0, chillMul: 0.70, chillDuration: 1.0 },
            { bladeCount: 4, damage: 20, orbitSpeed: 3.8, orbitRadius: 140, bladeRadius: 30, hitCooldown: 0.28, slowMul: 0.66, slowDuration: 1.0, chillMul: 0.66, chillDuration: 1.0 },
            { bladeCount: 5, damage: 22, orbitSpeed: 4.0, orbitRadius: 145, bladeRadius: 32, hitCooldown: 0.26, slowMul: 0.62, slowDuration: 1.0, chillMul: 0.62, chillDuration: 1.0 },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },

    holyPulse: {
        id: 'holyPulse',
        name: 'Beacon Pulse',
        description: 'A pulse of beacon-light scours everything near.',
        kind: 'pulse',
        evolvesTo: null,
        // Signature: stacking armor-shred LOCAL to Holy Pulse — each pulse
        // makes a lingering enemy take +shredPerStack more from the NEXT
        // pulse, up to maxShredStacks. Rewards holding a crowd in the aura.
        perLevel: [
            null,
            { radius: 280, damage: 12, cooldown: 3.0, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 2 },
            { radius: 300, damage: 14, cooldown: 2.8, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 2 },
            { radius: 320, damage: 17, cooldown: 2.6, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 3 },
            { radius: 345, damage: 19, cooldown: 2.4, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 3 },
            { radius: 375, damage: 22, cooldown: 2.2, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 3 },
            { radius: 410, damage: 26, cooldown: 2.0, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
            { radius: 450, damage: 31, cooldown: 1.8, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
            { radius: 490, damage: 38, cooldown: 1.6, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
        ],
        update: holyPulseUpdate,
    },

    lightningMark: {
        id: 'lightningMark',
        name: 'Stormbrand',
        description: 'Storm-light brands nearby husks at random.',
        kind: 'lightning',
        evolvesTo: 'thunderCrown',
        element: 'shock',
        // Signature: SHOCK — each strike stacks a damage-amp debuff (read at
        // hit time) and DETONATES any burn already on the target. Pairs with
        // the anti-boss priority targeting below for a boss-melt identity.
        perLevel: [
            null,
            { strikes: 1, damage: 21, cooldown: 2.4, range: 1100, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 2, damage: 21, cooldown: 2.4, range: 1100, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 2, damage: 26, cooldown: 2.2, range: 1150, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 3, damage: 26, cooldown: 2.0, range: 1150, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 3, damage: 31, cooldown: 1.8, range: 1200, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 4, damage: 33, cooldown: 1.6, range: 1200, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 5, damage: 38, cooldown: 1.5, range: 1250, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { strikes: 6, damage: 45, cooldown: 1.4, range: 1300, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
        ],
        update: lightningMarkUpdate,
    },

    emberWisp: {
        id: 'emberWisp',
        name: 'Pyre Wisp',
        description: 'Cinderbolt damage, but its flames SPREAD between nearby husks.',
        kind: 'projectile',
        evolvesTo: 'infernoStorm',
        element: 'fire',
        // A "wand" sibling of the Cinderbolt: identical base damage/cadence, but
        // every bolt sets a burn DoT — and burning husks ignite their neighbours
        // (contagion handled in Game._tickStatuses), so it shreds packed crowds.
        // The base-damage parity is intentional (Cinderbolt is the damage
        // baseline); the burn + spread is what makes it worth picking.
        perLevel: [
            null,
            { damage: 17, cooldown: 0.52, projectileSpeed: 820, projectileRadius: 16, pierce: 0, burnDps: 9,  burnDuration: 3.0 },
            { damage: 20, cooldown: 0.50, projectileSpeed: 820, projectileRadius: 16, pierce: 0, burnDps: 11, burnDuration: 3.0 },
            { damage: 24, cooldown: 0.48, projectileSpeed: 840, projectileRadius: 16, pierce: 1, burnDps: 13, burnDuration: 3.0 },
            { damage: 29, cooldown: 0.44, projectileSpeed: 860, projectileRadius: 16, pierce: 1, burnDps: 15, burnDuration: 3.0 },
            { damage: 34, cooldown: 0.40, projectileSpeed: 880, projectileRadius: 16, pierce: 1, burnDps: 18, burnDuration: 3.0 },
            { damage: 40, cooldown: 0.36, projectileSpeed: 900, projectileRadius: 16, pierce: 2, burnDps: 21, burnDuration: 3.0 },
            { damage: 47, cooldown: 0.32, projectileSpeed: 940, projectileRadius: 17, pierce: 2, burnDps: 24, burnDuration: 3.0 },
            { damage: 56, cooldown: 0.28, projectileSpeed: 980, projectileRadius: 18, pierce: 2, burnDps: 28, burnDuration: 3.0 },
        ],
        update: emberWispUpdate,
    },

    voltWand: {
        id: 'voltWand',
        name: 'Stormwand',
        description: 'Cinderbolt damage, but each zap CHAINS shock to nearby husks.',
        kind: 'lightning',
        evolvesTo: null,
        element: 'shock',
        // The third "wand": Cinderbolt base damage, but instead of a single bolt
        // it zaps the nearest husk and the lightning arcs to nearby foes (with a
        // SHOCK damage-amp stack on each), so it clears clustered packs. Lightning
        // FX + a zap SFX sell it.
        perLevel: [
            null,
            { damage: 17, cooldown: 0.52, range: 340, chainCount: 1, chainChance: 0.85, chainRange: 200, chainDamage: 11, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { damage: 20, cooldown: 0.50, range: 360, chainCount: 1, chainChance: 0.88, chainRange: 210, chainDamage: 13, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { damage: 24, cooldown: 0.48, range: 380, chainCount: 2, chainChance: 0.90, chainRange: 220, chainDamage: 15, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { damage: 29, cooldown: 0.44, range: 400, chainCount: 2, chainChance: 0.90, chainRange: 230, chainDamage: 18, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { damage: 34, cooldown: 0.40, range: 420, chainCount: 2, chainChance: 0.92, chainRange: 240, chainDamage: 21, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { damage: 40, cooldown: 0.36, range: 440, chainCount: 3, chainChance: 0.92, chainRange: 250, chainDamage: 25, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { damage: 47, cooldown: 0.32, range: 470, chainCount: 3, chainChance: 0.95, chainRange: 260, chainDamage: 29, shockPerStack: 0.08, maxShockStacks: 5, shockDuration: 4.0 },
            { damage: 56, cooldown: 0.28, range: 500, chainCount: 3, chainChance: 1.0, chainRange: 280, chainDamage: 34, shockPerStack: 0.08, maxShockStacks: 5, shockDuration: 4.0 },
        ],
        update: voltWandUpdate,
    },

    // ── The Armory pt. 1 (v1.3): four NEW behavior kinds ──────────────────
    // Each introduces a genuinely new feel (return-arc, channel, zone-trap,
    // movement-trail) rather than another projectile variant. All are wands /
    // wand-flung cinders — never blades. DPS parity notes per weapon follow
    // the family math ("Cinderbolt is the damage baseline": L1 ≈33 → L8 ≈200
    // single-target DPS); kinds that cover area trade single-target for reach.

    ashfang: {
        id: 'ashfang',
        name: 'Ashfang',
        description: 'A wand-flung cinder fang that arcs through the horde and RETURNS.',
        kind: 'boomerang',
        evolvesTo: 'twinfangCyclone',
        element: 'fire',
        // Parity: each husk is hit once per pass per CAST (fangs from one
        // cast share hit sets — see ashfangUpdate), so vs a single target
        // every cast is exactly 2×damage per cooldown no matter how the
        // fangs overlap (bosses span both arcs) — L1 2×19/1.15 ≈ 33 DPS,
        // L8 2×52/0.72 ≈ 144 focused — under the Cinderbolt's 200, paid
        // back by carving the whole out-and-back corridor.
        perLevel: [
            null,
            { damage: 19, cooldown: 1.15, range: 380, discSpeed: 780, discRadius: 26, count: 1 },
            { damage: 22, cooldown: 1.10, range: 395, discSpeed: 800, discRadius: 26, count: 1 },
            { damage: 26, cooldown: 1.05, range: 410, discSpeed: 820, discRadius: 27, count: 1 },
            { damage: 30, cooldown: 1.00, range: 425, discSpeed: 840, discRadius: 27, count: 1 },
            { damage: 35, cooldown: 0.92, range: 440, discSpeed: 870, discRadius: 28, count: 2 },
            { damage: 40, cooldown: 0.86, range: 455, discSpeed: 900, discRadius: 28, count: 2 },
            { damage: 46, cooldown: 0.79, range: 470, discSpeed: 940, discRadius: 29, count: 2 },
            { damage: 52, cooldown: 0.72, range: 490, discSpeed: 980, discRadius: 30, count: 2 },
        ],
        initialState() { return { discs: [] }; },
        update: ashfangUpdate,
    },

    kindleRay: {
        id: 'kindleRay',
        name: 'Kindle Ray',
        description: 'CHANNEL an unbroken wand ray that sears everything along its line.',
        kind: 'beam',
        evolvesTo: 'dawnfireRay',
        // Parity: 100% uptime and line coverage, so the tick DPS sits UNDER
        // the Cinderbolt curve — L1 5/0.15 ≈ 33, L8 14/0.075 ≈ 187 — with the
        // trade that the ray only reaches `range` and needs line of sight.
        // `damage` here is PER TICK (tickInterval), not per shot.
        perLevel: [
            null,
            { damage: 5,  tickInterval: 0.150, range: 460, width: 26 },
            { damage: 6,  tickInterval: 0.145, range: 470, width: 26 },
            { damage: 7,  tickInterval: 0.140, range: 480, width: 27 },
            { damage: 8,  tickInterval: 0.130, range: 495, width: 27 },
            { damage: 9,  tickInterval: 0.120, range: 510, width: 28 },
            { damage: 11, tickInterval: 0.105, range: 525, width: 29 },
            { damage: 12, tickInterval: 0.090, range: 540, width: 30 },
            { damage: 14, tickInterval: 0.075, range: 560, width: 32 },
        ],
        initialState() { return { on: false, tx: 0, ty: 0, phase: 0 }; },
        update: kindleRayUpdate,
    },

    emberMine: {
        id: 'emberMine',
        name: 'Cindermine',
        description: 'Lay smouldering ember mines that ERUPT when husks tread close.',
        kind: 'mine',
        evolvesTo: 'ashquake',
        element: 'fire',
        // Parity: burst AoE paid for by the trigger wait — L1 42/1.7 ≈ 25 DPS
        // focused, L8 126/0.95 ≈ 133 + blast coverage + burn, under the
        // Cinderbolt 200 because every blast hits the whole pack that tripped
        // it. Mines persist until tripped (maxMines caps the field); a mine
        // stranded off-screen is reclaimed (see MINE_RECLAIM_DIST_SQ).
        perLevel: [
            null,
            { damage: 42,  cooldown: 1.70, maxMines: 3, triggerRadius: 90,  blastRadius: 150, armTime: 0.5, burnDps: 8,  burnDuration: 2.5 },
            { damage: 50,  cooldown: 1.60, maxMines: 3, triggerRadius: 95,  blastRadius: 158, armTime: 0.5, burnDps: 10, burnDuration: 2.5 },
            { damage: 58,  cooldown: 1.50, maxMines: 4, triggerRadius: 95,  blastRadius: 165, armTime: 0.5, burnDps: 12, burnDuration: 2.5 },
            { damage: 68,  cooldown: 1.35, maxMines: 4, triggerRadius: 100, blastRadius: 175, armTime: 0.5, burnDps: 13, burnDuration: 2.8 },
            { damage: 79,  cooldown: 1.25, maxMines: 5, triggerRadius: 100, blastRadius: 185, armTime: 0.45, burnDps: 15, burnDuration: 2.8 },
            { damage: 92,  cooldown: 1.15, maxMines: 5, triggerRadius: 105, blastRadius: 192, armTime: 0.45, burnDps: 17, burnDuration: 3.0 },
            { damage: 108, cooldown: 1.05, maxMines: 6, triggerRadius: 108, blastRadius: 200, armTime: 0.4, burnDps: 18, burnDuration: 3.0 },
            { damage: 126, cooldown: 0.95, maxMines: 6, triggerRadius: 110, blastRadius: 210, armTime: 0.4, burnDps: 20, burnDuration: 3.0 },
        ],
        initialState() { return { mines: [] }; },
        update: emberMineUpdate,
    },

    wakefire: {
        id: 'wakefire',
        name: 'Wakefire',
        description: 'Your steps leave a WAKE of clinging ground-fire behind you.',
        kind: 'trail',
        evolvesTo: 'wildfireWake',
        element: 'fire',
        // Parity: zero-aim area denial — a husk chasing through the wake eats
        // damage/tickInterval (L1 6/0.40 = 15, L8 20/0.22 ≈ 90 DPS), well
        // under the Cinderbolt because the ENTIRE chase pack walks the same
        // line. Only movement feeds it: standing still stops the wake.
        // `damage` is PER TICK to each husk standing in any patch.
        perLevel: [
            null,
            { damage: 6,  tickInterval: 0.40, patchRadius: 64, patchLife: 2.2, spacing: 95, maxPatches: 14 },
            { damage: 7,  tickInterval: 0.38, patchRadius: 68, patchLife: 2.4, spacing: 95, maxPatches: 16 },
            { damage: 8,  tickInterval: 0.36, patchRadius: 72, patchLife: 2.6, spacing: 90, maxPatches: 18 },
            { damage: 10, tickInterval: 0.33, patchRadius: 76, patchLife: 2.8, spacing: 90, maxPatches: 20 },
            { damage: 12, tickInterval: 0.30, patchRadius: 80, patchLife: 3.0, spacing: 85, maxPatches: 22 },
            { damage: 14, tickInterval: 0.28, patchRadius: 85, patchLife: 3.2, spacing: 85, maxPatches: 24 },
            { damage: 17, tickInterval: 0.25, patchRadius: 90, patchLife: 3.4, spacing: 80, maxPatches: 26 },
            { damage: 20, tickInterval: 0.22, patchRadius: 95, patchLife: 3.6, spacing: 80, maxPatches: 28 },
        ],
        initialState() { return { patches: [], lastX: 0, lastY: 0 }; },
        update: wakefireUpdate,
    },

    // ─── Evolved weapons (only reachable via treasure chest) ─────────
    arcaneStorm: {
        id: 'arcaneStorm',
        name: 'Cinderstorm',
        description: 'Twin cinders in a relentless barrage.',
        kind: 'projectile',
        evolved: true,
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff pass: a maxed Cinderbolt (L8: 56 dmg @0.28s,
                // ~200 DPS) should feel clearly weaker than its evolution. Bumped
                // back up (dmg 42→52, cd 0.28→0.24, ricochet 3→4) now that bosses
                // are much tankier (2000/1350 HP + per-encounter tiers + resist),
                // so this reads as a real upgrade without instantly deleting them.
                damage: 52, cooldown: 0.24, projectileSpeed: 1450,
                pierce: 4, projectileRadius: 20, projectiles: 2, spread: 0.18,
                ricochet: 4, ricochetRange: 440,
            },
        ],
        update: arcaneStormUpdate,
    },
    celestialBlades: {
        id: 'celestialBlades',
        name: 'Glacial Halo',
        description: 'A ring of glacial motes that freeze and shatter.',
        kind: 'orbit',
        evolved: true,
        element: 'frost',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff: clearly beats maxed Frost Glaives (5 blades,
                // 22 dmg) — more blades + harder hits + a better freeze proc —
                // while still leaving gaps so it's not an impenetrable wall.
                bladeCount: 7, damage: 32, orbitSpeed: 4.6,
                orbitRadius: 152, bladeRadius: 37, hitCooldown: 0.28,
                slowMul: 0.50, slowDuration: 1.5,
                chillMul: 0.50, chillDuration: 1.5,
                freezeChance: 0.14, freezeDuration: 0.55,
            },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },
    divineNova: {
        id: 'divineNova',
        name: 'Dawnbreaker',
        description: 'A burst of dawn that heals with every strike.',
        kind: 'pulse',
        evolved: true,
        maxLevel: 1,
        perLevel: [
            null,
            {
                radius: 500, damage: 46, cooldown: 1.35,
                // Evolution payoff: hits clearly harder than maxed Beacon Pulse
                // (38 dmg) over a wider radius. maxHealPerPulse stays modest (12)
                // so the global heal/s cap still keeps it from making the player
                // unkillable while standing in a crowd.
                healPerHit: 0.6, maxHealPerPulse: 12, visualLifetime: 0.7,
                shredPerStack: 0.12, shredDuration: 4.0, maxShredStacks: 6,
            },
        ],
        update: divineNovaUpdate,
    },
    infernoStorm: {
        id: 'infernoStorm',
        name: 'Wildpyre',
        description: 'Twin pyre-bolts that leave a raging blaze.',
        kind: 'projectile',
        evolved: true,
        element: 'fire',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff pass (same parity method as Cinderstorm): a
                // maxed Pyre Wisp is 56 dmg @0.28s (~200 DPS) + 28 burnDps. The
                // old 22 dmg twin (~100 DPS) was a strict DOWNGRADE — a trap
                // evolution citing stale stats ("14 dmg / 20 burnDps"). 50 dmg
                // ×2 @0.44s (~227 DPS) + a burn nearly twice as hot + deep
                // pierce now reads as a real upgrade without deleting bosses.
                damage: 50, cooldown: 0.44, projectileSpeed: 940,
                projectileRadius: 20, projectiles: 2, spread: 0.18, pierce: 4,
                burnDps: 46, burnDuration: 5.0,
            },
        ],
        update: infernoStormUpdate,
    },
    thunderCrown: {
        id: 'thunderCrown',
        name: 'Stormcrown',
        description: 'Chained storm-light rains across the vigil.',
        kind: 'lightning',
        evolved: true,
        element: 'shock',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff: more strikes + an extra chain hop than maxed
                // Stormbrand (6 strikes, 45 dmg), so it clearly outclasses the
                // base — without going back to the old screen-deleting 8 strikes.
                strikes: 7, damage: 50, cooldown: 0.9, range: 1400,
                chainCount: 3, chainChance: 0.85, chainRange: 300, chainDamage: 32,
                shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0,
            },
        ],
        update: thunderCrownUpdate,
    },

    // ── Armory pt. 1 evolutions ───────────────────────────────────────────
    // Evolutions for the four new kinds, plus the two the roster was MISSING
    // (Stormwand and Frostmote finally evolve). Same payoff discipline as the
    // originals: each clearly beats its maxed base without deleting bosses.
    twinfangCyclone: {
        id: 'twinfangCyclone',
        name: 'Twinfang Cyclone',
        description: 'Three returning cinder fangs carve the horde without pause.',
        kind: 'boomerang',
        evolved: true,
        element: 'fire',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff: maxed Ashfang is ≈144 focused (2×52
                // @0.72s, shared cast hit sets). 2×62/0.55 ≈ 225 focused plus
                // a third fang's corridor coverage clearly wins while the
                // return-arc identity stays intact.
                damage: 62, cooldown: 0.55, range: 540, discSpeed: 1050,
                discRadius: 34, count: 3,
            },
        ],
        initialState() { return { discs: [] }; },
        update: ashfangUpdate,
    },
    dawnfireRay: {
        id: 'dawnfireRay',
        name: 'Dawnfire Ray',
        description: 'The channeled ray widens into dawnfire that sets its line ablaze.',
        kind: 'beam',
        evolved: true,
        element: 'fire',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff: maxed Kindle Ray ticks 14 @0.075 (~187/s).
                // 20 @0.07 (~285/s) + a burn stamp per tick + a wider, longer
                // ray is a real upgrade for a weapon whose whole job is uptime.
                damage: 20, tickInterval: 0.07, range: 640, width: 44,
                burnDps: 16, burnDuration: 2.0,
            },
        ],
        initialState() { return { on: false, tx: 0, ty: 0, phase: 0 }; },
        update: kindleRayUpdate,
    },
    ashquake: {
        id: 'ashquake',
        name: 'Ashquake',
        description: 'A field of buried cinders that erupts in vast, searing blasts.',
        kind: 'mine',
        evolved: true,
        element: 'fire',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff: maxed Cindermine is 126 dmg / 210 blast /
                // 6 mines. Bigger field, near-double blasts, a far hotter burn
                // — the minefield becomes the arena's floor plan.
                damage: 170, cooldown: 0.80, maxMines: 8, triggerRadius: 130,
                blastRadius: 260, armTime: 0.35, burnDps: 34, burnDuration: 3.5,
            },
        ],
        initialState() { return { mines: [] }; },
        update: emberMineUpdate,
    },
    wildfireWake: {
        id: 'wildfireWake',
        name: 'Wildfire Wake',
        description: 'The wake becomes wildfire — broad, long-burning, and contagious.',
        kind: 'trail',
        evolved: true,
        element: 'fire',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff: maxed Wakefire ticks 20 @0.22 in 95px
                // patches. Hotter/faster ticks in far bigger, longer-lived
                // patches PLUS a burn stamp (feeding the burn-spread engine).
                damage: 30, tickInterval: 0.18, patchRadius: 125, patchLife: 4.2,
                spacing: 70, maxPatches: 34, burnDps: 18, burnDuration: 2.5,
            },
        ],
        initialState() { return { patches: [], lastX: 0, lastY: 0 }; },
        update: wakefireUpdate,
    },
    stormsurge: {
        id: 'stormsurge',
        name: 'Stormsurge',
        description: 'Twin surge-zaps with chains that never miss their arc.',
        kind: 'lightning',
        evolved: true,
        element: 'shock',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff (the Stormwand FINALLY evolves): maxed
                // Stormwand zaps 56 @0.28 + 3 guaranteed 34-dmg hops. TWO
                // primary zaps per cast (zaps: 2), deeper guaranteed chains and
                // heavier hops clearly beat it without Thunder Crown's reach.
                damage: 60, cooldown: 0.24, range: 560, zaps: 2,
                chainCount: 4, chainChance: 1.0, chainRange: 300, chainDamage: 40,
                shockPerStack: 0.10, maxShockStacks: 6, shockDuration: 4.0,
            },
        ],
        update: voltWandUpdate,
    },
    winterveil: {
        id: 'winterveil',
        name: 'Winterveil',
        description: 'A veil of deep frost that chills, wounds — and freezes solid.',
        kind: 'special',
        ability: true,
        evolved: true,
        element: 'frost',
        maxLevel: 1,
        perLevel: [
            null,
            {
                // Evolution payoff (Frostmote FINALLY evolves): maxed Frostmote
                // is 16 dmg / 310 radius / 0.60 chill. A wider, harder veil with
                // a hard-freeze proc (bosses stay freeze-exempt via applyFreeze)
                // turns the utility ability into real crowd control.
                cooldown: 1.1, radius: 380, damage: 26, slowMul: 0.50,
                slowDuration: 2.8, motes: 14, freezeChance: 0.12, freezeDuration: 0.5,
            },
        ],
        update: frostmoteUpdate,
    },

    // ── Fusion weapons (only reachable via a Wick Shrine "fuse") ──────────
    // A fusion welds two OWNED base weapons into one new weapon that — unlike an
    // evolution (maxLevel 1) — SCALES its own perLevel (maxLevel 5), so it keeps
    // pace late. `fusion: true` keeps it out of the level-up new-weapon pool
    // (WickRoadsSystem offers the fuse instead); it reuses an existing behavior
    // so no new engine code is needed. Recipes live in content/fusions.js.
    cinderlance: {
        id: 'cinderlance', name: 'Cinderlance', description: 'Piercing bolts that leave a spreading blaze.',
        kind: 'projectile', fusion: true, element: 'fire', maxLevel: 5,
        perLevel: [
            null,
            { damage: 44, cooldown: 0.34, projectileSpeed: 1060, projectileRadius: 18, pierce: 2, burnDps: 24, burnDuration: 3.0 },
            { damage: 52, cooldown: 0.31, projectileSpeed: 1100, projectileRadius: 18, pierce: 2, burnDps: 30, burnDuration: 3.0 },
            { damage: 61, cooldown: 0.28, projectileSpeed: 1140, projectileRadius: 19, pierce: 3, burnDps: 36, burnDuration: 3.2 },
            { damage: 72, cooldown: 0.26, projectileSpeed: 1180, projectileRadius: 19, pierce: 3, burnDps: 43, burnDuration: 3.2 },
            { damage: 86, cooldown: 0.24, projectileSpeed: 1240, projectileRadius: 20, pierce: 4, burnDps: 52, burnDuration: 3.4 },
        ],
        update: emberWispUpdate,
    },
    stormlance: {
        id: 'stormlance', name: 'Stormlance', description: 'Arcane bolts that arc shock through the crowd.',
        kind: 'lightning', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { damage: 40, cooldown: 0.34, range: 460, chainCount: 3, chainChance: 0.95, chainRange: 260, chainDamage: 28, shockPerStack: 0.08, maxShockStacks: 5, shockDuration: 4.0 },
            { damage: 47, cooldown: 0.31, range: 480, chainCount: 3, chainChance: 0.97, chainRange: 270, chainDamage: 33, shockPerStack: 0.09, maxShockStacks: 5, shockDuration: 4.0 },
            { damage: 55, cooldown: 0.28, range: 500, chainCount: 4, chainChance: 1.0, chainRange: 280, chainDamage: 39, shockPerStack: 0.09, maxShockStacks: 6, shockDuration: 4.0 },
            { damage: 65, cooldown: 0.26, range: 520, chainCount: 4, chainChance: 1.0, chainRange: 290, chainDamage: 46, shockPerStack: 0.10, maxShockStacks: 6, shockDuration: 4.0 },
            { damage: 78, cooldown: 0.24, range: 540, chainCount: 5, chainChance: 1.0, chainRange: 300, chainDamage: 55, shockPerStack: 0.10, maxShockStacks: 6, shockDuration: 4.0 },
        ],
        update: voltWandUpdate,
    },
    emberstorm: {
        id: 'emberstorm', name: 'Emberstorm', description: 'Storm-strikes that detonate the fires they find.',
        kind: 'lightning', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { strikes: 4, damage: 40, cooldown: 1.5, range: 1250, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0 },
            { strikes: 4, damage: 48, cooldown: 1.4, range: 1280, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0 },
            { strikes: 5, damage: 56, cooldown: 1.3, range: 1300, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0 },
            { strikes: 6, damage: 66, cooldown: 1.2, range: 1320, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0 },
            { strikes: 7, damage: 78, cooldown: 1.1, range: 1360, shockPerStack: 0.11, maxShockStacks: 6, shockDuration: 4.0 },
        ],
        update: lightningMarkUpdate,
    },
    glacialbeacon: {
        id: 'glacialbeacon', name: 'Glacial Beacon', description: 'A wide ring of glaives that deep-freeze all it sweeps.',
        kind: 'orbit', fusion: true, element: 'frost', maxLevel: 5,
        perLevel: [
            null,
            { bladeCount: 4, damage: 26, orbitSpeed: 4.0, orbitRadius: 150, bladeRadius: 34, hitCooldown: 0.30, slowMul: 0.58, slowDuration: 1.4, chillMul: 0.58, chillDuration: 1.4 },
            { bladeCount: 5, damage: 30, orbitSpeed: 4.2, orbitRadius: 156, bladeRadius: 35, hitCooldown: 0.28, slowMul: 0.55, slowDuration: 1.4, chillMul: 0.55, chillDuration: 1.4 },
            { bladeCount: 5, damage: 35, orbitSpeed: 4.4, orbitRadius: 162, bladeRadius: 36, hitCooldown: 0.27, slowMul: 0.52, slowDuration: 1.5, chillMul: 0.52, chillDuration: 1.5 },
            { bladeCount: 6, damage: 41, orbitSpeed: 4.6, orbitRadius: 168, bladeRadius: 38, hitCooldown: 0.26, slowMul: 0.48, slowDuration: 1.5, chillMul: 0.48, chillDuration: 1.5 },
            { bladeCount: 7, damage: 49, orbitSpeed: 4.8, orbitRadius: 176, bladeRadius: 40, hitCooldown: 0.24, slowMul: 0.44, slowDuration: 1.6, chillMul: 0.44, chillDuration: 1.6 },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },
    judgmentpulse: {
        id: 'judgmentpulse', name: 'Judgment Pulse', description: 'A vast pulse that flays armor from a held crowd.',
        kind: 'pulse', fusion: true, maxLevel: 5,
        perLevel: [
            null,
            { radius: 470, damage: 34, cooldown: 1.7, shredPerStack: 0.11, shredDuration: 4.0, maxShredStacks: 5 },
            { radius: 500, damage: 40, cooldown: 1.6, shredPerStack: 0.11, shredDuration: 4.0, maxShredStacks: 5 },
            { radius: 530, damage: 47, cooldown: 1.5, shredPerStack: 0.12, shredDuration: 4.0, maxShredStacks: 6 },
            { radius: 560, damage: 55, cooldown: 1.4, shredPerStack: 0.12, shredDuration: 4.0, maxShredStacks: 6 },
            { radius: 600, damage: 65, cooldown: 1.3, shredPerStack: 0.13, shredDuration: 4.0, maxShredStacks: 7 },
        ],
        update: holyPulseUpdate,
    },
    cinderhalo: {
        id: 'cinderhalo', name: 'Cinderhalo', description: 'Bolt-forged glaives that carve a chilling orbit.',
        kind: 'orbit', fusion: true, element: 'frost', maxLevel: 5,
        perLevel: [
            null,
            { bladeCount: 3, damage: 30, orbitSpeed: 4.2, orbitRadius: 140, bladeRadius: 32, hitCooldown: 0.28, slowMul: 0.60, slowDuration: 1.3, chillMul: 0.60, chillDuration: 1.3 },
            { bladeCount: 3, damage: 36, orbitSpeed: 4.4, orbitRadius: 146, bladeRadius: 34, hitCooldown: 0.27, slowMul: 0.57, slowDuration: 1.3, chillMul: 0.57, chillDuration: 1.3 },
            { bladeCount: 4, damage: 42, orbitSpeed: 4.6, orbitRadius: 152, bladeRadius: 35, hitCooldown: 0.26, slowMul: 0.54, slowDuration: 1.4, chillMul: 0.54, chillDuration: 1.4 },
            { bladeCount: 4, damage: 50, orbitSpeed: 4.8, orbitRadius: 158, bladeRadius: 37, hitCooldown: 0.25, slowMul: 0.50, slowDuration: 1.4, chillMul: 0.50, chillDuration: 1.4 },
            { bladeCount: 5, damage: 60, orbitSpeed: 5.0, orbitRadius: 166, bladeRadius: 39, hitCooldown: 0.24, slowMul: 0.46, slowDuration: 1.5, chillMul: 0.46, chillDuration: 1.5 },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },
    voltpyre: {
        id: 'voltpyre', name: 'Voltpyre', description: 'Scorching bolts that sear a long, hot burn.',
        kind: 'projectile', fusion: true, element: 'fire', maxLevel: 5,
        perLevel: [
            null,
            { damage: 40, cooldown: 0.32, projectileSpeed: 980, projectileRadius: 17, pierce: 2, burnDps: 30, burnDuration: 3.4 },
            { damage: 47, cooldown: 0.30, projectileSpeed: 1000, projectileRadius: 17, pierce: 2, burnDps: 37, burnDuration: 3.4 },
            { damage: 55, cooldown: 0.28, projectileSpeed: 1030, projectileRadius: 18, pierce: 3, burnDps: 45, burnDuration: 3.6 },
            { damage: 65, cooldown: 0.26, projectileSpeed: 1060, projectileRadius: 18, pierce: 3, burnDps: 54, burnDuration: 3.6 },
            { damage: 78, cooldown: 0.24, projectileSpeed: 1100, projectileRadius: 19, pierce: 4, burnDps: 65, burnDuration: 3.8 },
        ],
        update: emberWispUpdate,
    },
    stormglaive: {
        id: 'stormglaive', name: 'Stormglaive', description: 'Storm-branded strikes rain where the glaives sweep.',
        kind: 'lightning', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { strikes: 3, damage: 44, cooldown: 1.4, range: 1200, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0 },
            { strikes: 4, damage: 50, cooldown: 1.3, range: 1220, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0 },
            { strikes: 4, damage: 58, cooldown: 1.2, range: 1250, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0 },
            { strikes: 5, damage: 68, cooldown: 1.1, range: 1280, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0 },
            { strikes: 6, damage: 80, cooldown: 1.0, range: 1320, shockPerStack: 0.11, maxShockStacks: 6, shockDuration: 4.0 },
        ],
        update: lightningMarkUpdate,
    },

    // ── Fusion fills (v1.3): the 7 pairs the table was missing ────────────
    // With these, ALL 15 pairs of the six original base weapons have a
    // recipe (see fusions.js). Same discipline as the first eight: reuse an
    // existing behavior (two get the new optional burn/shock stamps in
    // orbitingBladeUpdate / holyPulseUpdate), L1 ≈ mid-base power, maxLevel 5.
    dawnlance: {
        id: 'dawnlance', name: 'Dawnlance', description: 'Radiant bolts that leap from kill to kill.',
        kind: 'projectile', fusion: true, maxLevel: 5,
        perLevel: [
            null,
            { damage: 42, cooldown: 0.33, projectileSpeed: 1120, projectileRadius: 18, pierce: 2, ricochet: 2, ricochetRange: 400 },
            { damage: 49, cooldown: 0.31, projectileSpeed: 1160, projectileRadius: 18, pierce: 2, ricochet: 2, ricochetRange: 410 },
            { damage: 58, cooldown: 0.29, projectileSpeed: 1200, projectileRadius: 19, pierce: 3, ricochet: 3, ricochetRange: 420 },
            { damage: 68, cooldown: 0.27, projectileSpeed: 1240, projectileRadius: 19, pierce: 3, ricochet: 3, ricochetRange: 430 },
            { damage: 81, cooldown: 0.25, projectileSpeed: 1300, projectileRadius: 20, pierce: 4, ricochet: 4, ricochetRange: 440 },
        ],
        update: arcaneBoltUpdate,
    },
    boltbrand: {
        id: 'boltbrand', name: 'Boltbrand', description: 'Arcane storm-brands that hunt the toughest husks.',
        kind: 'lightning', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { strikes: 3, damage: 44, cooldown: 1.45, range: 1250, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0 },
            { strikes: 4, damage: 51, cooldown: 1.35, range: 1270, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0 },
            { strikes: 4, damage: 60, cooldown: 1.25, range: 1290, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0 },
            { strikes: 5, damage: 70, cooldown: 1.15, range: 1310, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0 },
            { strikes: 6, damage: 82, cooldown: 1.05, range: 1340, shockPerStack: 0.11, maxShockStacks: 6, shockDuration: 4.0 },
        ],
        update: lightningMarkUpdate,
    },
    pyrewheel: {
        id: 'pyrewheel', name: 'Pyrewheel', description: 'A blazing orbit that sets every husk it grazes alight.',
        kind: 'orbit', fusion: true, element: 'fire', maxLevel: 5,
        perLevel: [
            null,
            { bladeCount: 3, damage: 28, orbitSpeed: 4.2, orbitRadius: 142, bladeRadius: 32, hitCooldown: 0.30, burnDps: 18, burnDuration: 2.5 },
            { bladeCount: 4, damage: 33, orbitSpeed: 4.4, orbitRadius: 148, bladeRadius: 33, hitCooldown: 0.29, burnDps: 22, burnDuration: 2.5 },
            { bladeCount: 4, damage: 39, orbitSpeed: 4.6, orbitRadius: 154, bladeRadius: 35, hitCooldown: 0.28, burnDps: 27, burnDuration: 2.8 },
            { bladeCount: 5, damage: 46, orbitSpeed: 4.8, orbitRadius: 160, bladeRadius: 36, hitCooldown: 0.26, burnDps: 33, burnDuration: 2.8 },
            { bladeCount: 6, damage: 55, orbitSpeed: 5.0, orbitRadius: 168, bladeRadius: 38, hitCooldown: 0.25, burnDps: 40, burnDuration: 3.0 },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },
    coilhalo: {
        id: 'coilhalo', name: 'Coil Halo', description: 'A charged orbit that stamps SHOCK on all it sweeps.',
        kind: 'orbit', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { bladeCount: 3, damage: 30, orbitSpeed: 4.4, orbitRadius: 138, bladeRadius: 31, hitCooldown: 0.28, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { bladeCount: 4, damage: 35, orbitSpeed: 4.6, orbitRadius: 144, bladeRadius: 32, hitCooldown: 0.27, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { bladeCount: 4, damage: 41, orbitSpeed: 4.8, orbitRadius: 150, bladeRadius: 34, hitCooldown: 0.26, shockPerStack: 0.09, maxShockStacks: 5, shockDuration: 4.0 },
            { bladeCount: 5, damage: 48, orbitSpeed: 5.0, orbitRadius: 156, bladeRadius: 35, hitCooldown: 0.25, shockPerStack: 0.09, maxShockStacks: 5, shockDuration: 4.0 },
            { bladeCount: 6, damage: 58, orbitSpeed: 5.2, orbitRadius: 164, bladeRadius: 37, hitCooldown: 0.24, shockPerStack: 0.10, maxShockStacks: 6, shockDuration: 4.0 },
        ],
        initialState() { return { baseAngle: 0, bladePositions: [] }; },
        update: orbitingBladeUpdate,
    },
    pyrebeacon: {
        id: 'pyrebeacon', name: 'Pyre Beacon', description: 'A scouring pulse that leaves the whole crowd burning.',
        kind: 'pulse', fusion: true, element: 'fire', maxLevel: 5,
        perLevel: [
            null,
            { radius: 440, damage: 30, cooldown: 1.8, burnDps: 20, burnDuration: 2.5, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
            { radius: 470, damage: 35, cooldown: 1.7, burnDps: 25, burnDuration: 2.5, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
            { radius: 500, damage: 41, cooldown: 1.6, burnDps: 30, burnDuration: 2.8, shredPerStack: 0.11, shredDuration: 4.0, maxShredStacks: 5 },
            { radius: 530, damage: 49, cooldown: 1.5, burnDps: 36, burnDuration: 2.8, shredPerStack: 0.11, shredDuration: 4.0, maxShredStacks: 5 },
            { radius: 560, damage: 58, cooldown: 1.4, burnDps: 44, burnDuration: 3.0, shredPerStack: 0.12, shredDuration: 4.0, maxShredStacks: 6 },
        ],
        update: holyPulseUpdate,
    },
    stormbeacon: {
        id: 'stormbeacon', name: 'Storm Beacon', description: 'A crackling pulse that primes the crowd with SHOCK.',
        kind: 'pulse', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { radius: 450, damage: 32, cooldown: 1.7, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
            { radius: 480, damage: 37, cooldown: 1.6, shockPerStack: 0.09, maxShockStacks: 4, shockDuration: 4.0, shredPerStack: 0.10, shredDuration: 4.0, maxShredStacks: 4 },
            { radius: 510, damage: 44, cooldown: 1.5, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0, shredPerStack: 0.11, shredDuration: 4.0, maxShredStacks: 5 },
            { radius: 540, damage: 52, cooldown: 1.4, shockPerStack: 0.10, maxShockStacks: 5, shockDuration: 4.0, shredPerStack: 0.11, shredDuration: 4.0, maxShredStacks: 5 },
            { radius: 575, damage: 62, cooldown: 1.3, shockPerStack: 0.11, maxShockStacks: 6, shockDuration: 4.0, shredPerStack: 0.12, shredDuration: 4.0, maxShredStacks: 6 },
        ],
        update: holyPulseUpdate,
    },
    tempestcoil: {
        id: 'tempestcoil', name: 'Tempest Coil', description: 'One zap, endless arcs — the whole pack shares the coil.',
        kind: 'lightning', fusion: true, element: 'shock', maxLevel: 5,
        perLevel: [
            null,
            { damage: 42, cooldown: 0.32, range: 480, chainCount: 4, chainChance: 1.0, chainRange: 280, chainDamage: 30, shockPerStack: 0.09, maxShockStacks: 5, shockDuration: 4.0 },
            { damage: 49, cooldown: 0.30, range: 500, chainCount: 4, chainChance: 1.0, chainRange: 290, chainDamage: 35, shockPerStack: 0.09, maxShockStacks: 5, shockDuration: 4.0 },
            { damage: 58, cooldown: 0.28, range: 520, chainCount: 5, chainChance: 1.0, chainRange: 300, chainDamage: 41, shockPerStack: 0.10, maxShockStacks: 6, shockDuration: 4.0 },
            { damage: 68, cooldown: 0.26, range: 540, chainCount: 5, chainChance: 1.0, chainRange: 310, chainDamage: 48, shockPerStack: 0.10, maxShockStacks: 6, shockDuration: 4.0 },
            { damage: 80, cooldown: 0.24, range: 560, chainCount: 6, chainChance: 1.0, chainRange: 320, chainDamage: 58, shockPerStack: 0.11, maxShockStacks: 7, shockDuration: 4.0 },
        ],
        update: voltWandUpdate,
    },

    // ── Abilities ───────────────────────────────────────────────────────
    // Data-driven, movement-only. They appear in the level-up pool like any
    // other weapon. None require manual aiming.

    // Shadow Dash: periodically surge with a burst of movement speed for a few
    // seconds — a kiting/repositioning tool rather than an instant blink.
    shadowDash: {
        id: 'shadowDash', name: 'Shadow Dash', kind: 'special', ability: true,
        description: 'Surge with a burst of speed for a few seconds.',
        maxLevel: 5,
        perLevel: [
            null,
            { cooldown: 8.0, duration: 2.5, speedMul: 1.6 },
            { cooldown: 7.5, duration: 2.8, speedMul: 1.7 },
            { cooldown: 7.0, duration: 3.1, speedMul: 1.8 },
            { cooldown: 6.5, duration: 3.4, speedMul: 1.9 },
            { cooldown: 6.0, duration: 3.8, speedMul: 2.0 },
        ],
        update: shadowDashUpdate,
    },

    // Cinder Aura (the "Thorn Aura" ability): a small, constant ring of heat
    // around you. Weaker than Beacon Pulse but always on.
    cinderAura: {
        id: 'cinderAura', name: 'Cinder Aura', kind: 'pulse', element: 'fire', ability: true,
        description: 'A constant ring of cinders burns nearby foes.',
        maxLevel: 5,
        perLevel: [
            null,
            { cooldown: 0.7, radius: 210, damage: 7 },
            { cooldown: 0.66, radius: 230, damage: 9 },
            { cooldown: 0.62, radius: 250, damage: 12 },
            { cooldown: 0.58, radius: 270, damage: 15 },
            { cooldown: 0.5, radius: 290, damage: 19 },
        ],
        update: cinderAuraUpdate,
    },

    // Hearth Totem (the "Banana Totem" ability): periodically emits a
    // restorative pulse that heals you a little. Kept modest for balance.
    hearthTotem: {
        id: 'hearthTotem', name: 'Hearth Totem', kind: 'special', ability: true,
        description: 'Periodically drops a warm ember that mends you.',
        maxLevel: 5,
        perLevel: [
            null,
            { cooldown: 6.0, heal: 6 },
            { cooldown: 5.5, heal: 8 },
            { cooldown: 5.0, heal: 10 },
            { cooldown: 4.5, heal: 12 },
            { cooldown: 4.0, heal: 15 },
        ],
        update: hearthTotemUpdate,
    },

    // Frostmote: an ice ability. On a short cadence it releases drifting frost
    // motes around you that chill (slow) and lightly wound nearby foes. Bosses
    // resist the chill. A pure-utility ability — strong crowd control, weak raw
    // damage — that appears in the level-up pool like any other ability.
    frostmote: {
        id: 'frostmote', name: 'Frostmote', kind: 'special', element: 'frost', ability: true,
        description: 'Release drifting frost motes that chill and wear down nearby foes.',
        maxLevel: 5,
        perLevel: [
            null,
            { cooldown: 2.2, radius: 230, damage: 6,  slowMul: 0.78, slowDuration: 1.6, motes: 5 },
            { cooldown: 2.0, radius: 250, damage: 8,  slowMul: 0.74, slowDuration: 1.8, motes: 6 },
            { cooldown: 1.8, radius: 270, damage: 10, slowMul: 0.70, slowDuration: 2.0, motes: 7 },
            { cooldown: 1.6, radius: 290, damage: 13, slowMul: 0.66, slowDuration: 2.2, motes: 8 },
            { cooldown: 1.4, radius: 310, damage: 16, slowMul: 0.60, slowDuration: 2.5, motes: 10 },
        ],
        update: frostmoteUpdate,
    },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

// ── Player aura metadata (visual only) ─────────────────────────────────
// One entry per weapon id: the glow color radiating from the player and
// whether it pulses. The aura is computed from the OWNED weapons (see
// computePlayerAura) and rendered behind the player; it never affects damage,
// pickup, or enemy behavior. Tuning constants live in GameConfig AURA.
export const WEAPON_AURA = {
    arcaneBolt:      { color: '#8a7bff', pulse: false }, // small blue/purple
    arcaneStorm:     { color: '#b15cff', pulse: true  }, // strong purple electric
    orbitingBlade:   { color: '#cdd8e6', pulse: false }, // silver/white shimmer
    celestialBlades: { color: '#fff0b4', pulse: false }, // gold/white blades
    holyPulse:       { color: '#ffd98a', pulse: false }, // soft warm holy
    divineNova:      { color: '#ffe9b0', pulse: false }, // large golden radiant
    lightningMark:   { color: '#6cc6ff', pulse: false }, // faint blue sparks
    thunderCrown:    { color: '#7fd0ff', pulse: true  }, // electric crown
    emberWisp:       { color: '#ff8a3c', pulse: false }, // fire
    voltWand:        { color: '#7fd0ff', pulse: true  }, // shock wand
    infernoStorm:    { color: '#ff6a2a', pulse: true  }, // raging fire
    shadowDash:      { color: '#9a6cff', pulse: false },
    cinderAura:      { color: '#ff7a33', pulse: false },
    hearthTotem:     { color: '#ffce6a', pulse: false },
    frostmote:       { color: '#8fd6ff', pulse: true  }, // pale blue frost
    // Armory pt. 1 — new kinds + their evolutions.
    ashfang:         { color: '#ff9a4a', pulse: false }, // returning cinder fang
    twinfangCyclone: { color: '#ff7a2a', pulse: true  },
    kindleRay:       { color: '#ffd98a', pulse: false }, // channeled wand ray
    dawnfireRay:     { color: '#ffe9b0', pulse: true  },
    emberMine:       { color: '#ff6a3c', pulse: false }, // buried embers
    ashquake:        { color: '#ff5a2a', pulse: true  },
    wakefire:        { color: '#ff8a3c', pulse: false }, // ground-fire wake
    wildfireWake:    { color: '#ff6a2a', pulse: true  },
    stormsurge:      { color: '#8fd8ff', pulse: true  }, // evolved Stormwand
    winterveil:      { color: '#bfeaff', pulse: true  }, // evolved Frostmote
    // Fusion fills.
    dawnlance:       { color: '#ffe9a8', pulse: false },
    boltbrand:       { color: '#9a8cff', pulse: true  },
    pyrewheel:       { color: '#ff9a5c', pulse: false },
    coilhalo:        { color: '#9fd8ff', pulse: true  },
    pyrebeacon:      { color: '#ffb060', pulse: false },
    stormbeacon:     { color: '#aee2ff', pulse: true  },
    tempestcoil:     { color: '#7fd0ff', pulse: true  },
};

// Compute the player's current aura from their owned weapons. The dominant
// (evolved > highest-level) weapon drives the COLOR; intensity + radius grow
// with weapon count / total levels / evolutions, both hard-capped by AURA.
// Returns { color, intensity, radius, pulse, label } or null if no weapons.
export function computePlayerAura(owned) {
    if (!owned || owned.length === 0) return null;
    let domWeight = -1, color = '#8a7bff', label = '';
    let totalLevels = 0, evolvedCount = 0, pulse = false;
    for (const w of owned) {
        const def = WEAPONS[w.id];
        const meta = WEAPON_AURA[w.id];
        if (!def || !meta) continue;
        const isEvolved = !!def.evolved;
        const lvl = w.level ?? 1;
        const weight = (isEvolved ? 100 : 0) + lvl;
        if (weight > domWeight) { domWeight = weight; color = meta.color; label = def.name; }
        totalLevels += lvl;
        if (isEvolved) evolvedCount += 1;
        if (meta.pulse) pulse = true;
    }
    const extraWeapons = Math.max(0, owned.length - 1);
    const intensity = Math.min(AURA.maxIntensity,
        AURA.baseIntensity + AURA.perWeapon * extraWeapons
            + AURA.perLevel * totalLevels + AURA.perEvolved * evolvedCount);
    const radius = Math.min(AURA.maxRadius,
        AURA.baseRadius + AURA.radiusPerWeapon * extraWeapons + AURA.radiusPerEvolved * evolvedCount);
    return { color, intensity, radius, pulse, label };
}

// ─── Behavior functions ────────────────────────────────────────────────

// Arcane Bolt: cooldown timer; on tick fire one Projectile at the nearest
// active enemy. Holds the timer at 0 when there are no targets so the next
// enemy to appear gets shot immediately instead of waiting a full cycle.
function arcaneBoltUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const target = nearestEnemy(ctx.player, ctx.enemies, ctx.inView);
    if (!target) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const dx = target.x - ctx.player.x;
    const dy = target.y - ctx.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * cfg.projectileSpeed;
    const vy = (dy / len) * cfg.projectileSpeed;
    ctx.projectiles.push(new Projectile(ctx.player.x, ctx.player.y, vx, vy, {
        damage: cfg.damage * dmgMul,
        radius: cfg.projectileRadius,
        pierce: cfg.pierce,
        ricochet: cfg.ricochet ?? 0,
        ricochetRange: cfg.ricochetRange ?? 0,
    }));
    if (ctx.audio) ctx.audio.shootBolt();
    owned.timer = cfg.cooldown * cdMul;
}

// Orbiting Blade: advance shared base angle; recompute blade positions; for
// each blade, damage any overlapping enemy whose weaponHitCooldown is 0.
// Hit cooldown is stored on the enemy itself so multiple weapons share
// fairness against the same target.
function orbitingBladeUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.state.baseAngle += cfg.orbitSpeed * dt;
    if (owned.state.baseAngle > TWO_PI) owned.state.baseAngle -= TWO_PI;

    const positions = owned.state.bladePositions;
    positions.length = 0;
    for (let i = 0; i < cfg.bladeCount; i++) {
        const angle = owned.state.baseAngle + (i * TWO_PI / cfg.bladeCount);
        positions.push({
            x: ctx.player.x + Math.cos(angle) * cfg.orbitRadius,
            y: ctx.player.y + Math.sin(angle) * cfg.orbitRadius,
            angle,
        });
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const damage = cfg.damage * dmgMul;
    const hitCooldown = cfg.hitCooldown * cdMul;

    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (e.weaponHitCooldown > 0) continue;
        // Walls block the blades: skip enemies the player can't see.
        if (ctx.los && !ctx.los(e.x, e.y)) continue;
        for (const pos of positions) {
            if (!circleOverlap(pos.x, pos.y, cfg.bladeRadius, e.x, e.y, e.radius)) continue;
            const dx = e.x - ctx.player.x;
            const dy = e.y - ctx.player.y;
            const len = Math.hypot(dx, dy) || 1;
            const kx = (dx / len) * KNOCKBACK.strength * 0.45;
            const ky = (dy / len) * KNOCKBACK.strength * 0.45;
            e.takeDamage(damage, kx, ky);
            ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: damage });
            if (!e.active) ctx.killed.push(e);
            e.weaponHitCooldown = hitCooldown;
            // Signature slow stamp (rate-limited by the hit cooldown above).
            if (cfg.slowMul) e.applySlow(cfg.slowMul, cfg.slowDuration);
            // FROST chill (own channel) — Frostbite Core deepens it (clamped)
            // and adds freeze-proc chance to the evolved blades.
            if (cfg.chillMul) {
                const chill = Math.max(0.30, cfg.chillMul - (ctx.player.chillStrength || 0));
                e.applyChill(chill, cfg.chillDuration);
                applyCombo(e, 'frost', damage, ctx);   // BRITTLE if already shocked
            }
            const freezeChance = (cfg.freezeChance || 0) + (ctx.player.freezeChanceBonus || 0);
            if (freezeChance > 0 && Math.random() < freezeChance) {
                e.applyFreeze(cfg.freezeDuration ?? 0.5);
            }
            // Optional elemental stamps for the FUSION variants (fields absent
            // on the base/evolved defs, so their behavior is untouched):
            // Pyrewheel sets the standard burn, Coil Halo builds SHOCK stacks
            // (read at hit time by shock weapons — same channel as Stormbrand).
            if (cfg.burnDps) e.applyBurn(cfg.burnDps * (ctx.player.fireRoundScale ?? 1), cfg.burnDuration ?? 2.0);
            if (cfg.shockPerStack && cfg.maxShockStacks) e.applyShock(cfg.maxShockStacks, cfg.shockDuration ?? 4.0);
            break;
        }
    }
}

// Holy Pulse: on cooldown, damage every enemy within `radius` once, then
// spawn a fading ring effect for visual feedback. Light radial knockback so
// crowds get nudged outward.
function holyPulseUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;
    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    owned.timer = cfg.cooldown * cdMul;
    const damage = cfg.damage * dmgMul;

    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (!circleOverlap(ctx.player.x, ctx.player.y, cfg.radius, e.x, e.y, e.radius)) continue;
        // Don't pulse through walls.
        if (ctx.los && !ctx.los(e.x, e.y)) continue;
        const dx = e.x - ctx.player.x;
        const dy = e.y - ctx.player.y;
        const len = Math.hypot(dx, dy) || 1;
        const kx = (dx / len) * KNOCKBACK.strength * 0.35;
        const ky = (dy / len) * KNOCKBACK.strength * 0.35;
        // Armor-shred ramp: amplify by the stacks ALREADY on the enemy,
        // deal + report that truthful amount, THEN add a stack (so the ramp
        // is across pulses, never a same-frame self-spike). Shred is local —
        // it amplifies only Holy Pulse, never other weapons' damage.
        const amp = 1 + (e.shredStacks || 0) * (cfg.shredPerStack ?? 0);
        const dmg = damage * amp;
        e.takeDamage(dmg, kx, ky);
        ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: dmg });
        if (!e.active) ctx.killed.push(e);
        if (cfg.maxShredStacks) e.applyShred(cfg.maxShredStacks, cfg.shredDuration);
        // Optional elemental stamps for the FUSION variants (fields absent on
        // the base def, so Beacon Pulse itself is untouched): Pyre Beacon sets
        // the standard burn, Storm Beacon builds SHOCK stacks for shock hits.
        if (cfg.burnDps) e.applyBurn(cfg.burnDps * (ctx.player.fireRoundScale ?? 1), cfg.burnDuration ?? 2.0);
        if (cfg.shockPerStack && cfg.maxShockStacks) e.applyShock(cfg.maxShockStacks, cfg.shockDuration ?? 4.0);
    }

    ctx.effects.push({
        kind: 'pulse',
        x: ctx.player.x,
        y: ctx.player.y,
        radius: cfg.radius,
        age: 0,
        lifetime: 0.45,
        active: true,
    });
}

// Lightning Mark: on cooldown, pick up to N random enemies within `range`
// of the player and zap them. Waits if no valid targets are on screen.
function lightningMarkUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const candidates = [];
    const rsq = cfg.range * cfg.range;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        const dx = e.x - ctx.player.x;
        const dy = e.y - ctx.player.y;
        // Only mark enemies on-screen AND in clear line of sight (walls block).
        if (dx * dx + dy * dy <= rsq && (!ctx.inView || ctx.inView(e.x, e.y))
            && (!ctx.los || ctx.los(e.x, e.y))) candidates.push(e);
    }
    if (candidates.length === 0) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const damage = cfg.damage * dmgMul;
    // Signature: anti-boss targeting. Reserve half the strikes (min 1) for
    // the highest-current-HP foes via an in-place linear max-scan; the rest
    // stay random so swarms are never starved when no tough target exists.
    const n = Math.min(cfg.strikes, candidates.length);
    const priorityStrikes = Math.max(1, Math.floor(n * 0.5));
    for (let i = 0; i < n; i++) {
        let idx;
        if (i < priorityStrikes) {
            idx = 0;
            for (let j = 1; j < candidates.length; j++) {
                if (candidates[j].hp > candidates[idx].hp) idx = j;
            }
        } else {
            idx = Math.floor(Math.random() * candidates.length);
        }
        const target = candidates.splice(idx, 1)[0];
        shockStrike(target, damage, cfg, ctx);
        ctx.effects.push({
            kind: 'lightning',
            x: target.x,
            y: target.y,
            age: 0,
            lifetime: 0.22,
            active: true,
        });
    }
    owned.timer = cfg.cooldown * cdMul;
}

// ─── Helpers ──────────────────────────────────────────────────────────

// SHOCK on-hit, shared by Lightning Mark + Thunder Crown (primary + chain).
// Reads the stacks ALREADY on the target to amplify, deals + reports that
// truthful amount, THEN adds a stack (ramp is across hits, never a same-frame
// spike — same discipline as Holy Pulse shred). Finally DETONATES any burn:
// a shock hit on a burning enemy consumes the remaining burn for an instant
// detonateMul × burnDps burst, then clears it. All kills route through
// ctx.killed so gems/coins/kill-count fire normally.
export function shockStrike(target, baseDamage, cfg, ctx) {
    const player = ctx.player;
    // Overcharge keystone: shock builds 2 charges higher and each charge amps
    // harder (read here, the single shock hook — no extra scan).
    const overcharge = player?.ks_overcharge;
    const perStack = (cfg.shockPerStack ?? 0) + (overcharge ? 0.5 : 0);
    const amp = 1 + (target.shockStacks || 0) * perStack;
    const dmg = baseDamage * amp;
    target.takeDamage(dmg);
    ctx.hits.push({ x: target.x, y: target.y - target.radius, amount: dmg });
    if (!target.active) { ctx.killed.push(target); }
    if (cfg.maxShockStacks) target.applyShock(cfg.maxShockStacks + (overcharge ? 2 : 0), cfg.shockDuration);
    // DETONATE — shock on a burning target consumes the remaining burn for a
    // burst. Migrated behind the combo table (content/elements.js); behavior is
    // byte-identical, INCLUDING the Conflagration keystone (2.2× + relight),
    // which the DETONATE resolver reads off ctx.player.
    applyCombo(target, 'shock', dmg, ctx);
}

// Nearest active enemy to the player. When an `inView` predicate is supplied,
// only on-screen enemies are considered — auto-aim weapons should never fire
// at a foe the player can't see off the edge of the screen.
function nearestEnemy(player, enemies, inView = null) {
    let best = null;
    let bestSq = Infinity;
    for (const e of enemies) {
        if (!e.active) continue;
        if (inView && !inView(e.x, e.y)) continue;
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const dsq = dx * dx + dy * dy;
        if (dsq < bestSq) {
            bestSq = dsq;
            best = e;
        }
    }
    return best;
}

// ─── Evolved behavior functions ──────────────────────────────────────

// Arcane Storm: fires `projectiles` bolts in a small spread per cooldown.
// Same nearest-target steering as Arcane Bolt, just multi-shot + faster.
function arcaneStormUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const target = nearestEnemy(ctx.player, ctx.enemies, ctx.inView);
    if (!target) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const dx = target.x - ctx.player.x;
    const dy = target.y - ctx.player.y;
    const baseAngle = Math.atan2(dy, dx);
    const count = cfg.projectiles ?? 1;
    const spread = cfg.spread ?? 0;

    for (let i = 0; i < count; i++) {
        const offset = count > 1 ? (i - (count - 1) / 2) * spread : 0;
        const a = baseAngle + offset;
        const vx = Math.cos(a) * cfg.projectileSpeed;
        const vy = Math.sin(a) * cfg.projectileSpeed;
        ctx.projectiles.push(new Projectile(ctx.player.x, ctx.player.y, vx, vy, {
            damage: cfg.damage * dmgMul,
            radius: cfg.projectileRadius,
            pierce: cfg.pierce,
            ricochet: cfg.ricochet ?? 0,
            ricochetRange: cfg.ricochetRange ?? 0,
        }));
    }
    if (ctx.audio) ctx.audio.shootBolt();
    owned.timer = cfg.cooldown * cdMul;
}

// Ember Wisp: like Arcane Bolt but the bolt carries a burn DoT (stamped by
// CollisionSystem on every enemy it touches) and uses a warm ember sprite.
function emberWispUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const target = nearestEnemy(ctx.player, ctx.enemies, ctx.inView);
    if (!target) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const dx = target.x - ctx.player.x;
    const dy = target.y - ctx.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * cfg.projectileSpeed;
    const vy = (dy / len) * cfg.projectileSpeed;
    const burnScale = ctx.player.fireRoundScale ?? 1;
    ctx.projectiles.push(new Projectile(ctx.player.x, ctx.player.y, vx, vy, {
        damage: cfg.damage * dmgMul,
        radius: cfg.projectileRadius,
        pierce: cfg.pierce,
        element: 'fire',
        burnDps: cfg.burnDps * burnScale,
        burnDuration: cfg.burnDuration,
        sprite: getEmberWispSprite(),
    }));
    if (ctx.audio) ctx.audio.shootFire();
    owned.timer = cfg.cooldown * cdMul;
}

// Inferno Storm: evolved Ember Wisp — twin ember bolts in a small spread,
// heavier burn, deep pierce. Same multi-shot steering as Arcane Storm.
function infernoStormUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const target = nearestEnemy(ctx.player, ctx.enemies, ctx.inView);
    if (!target) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const dx = target.x - ctx.player.x;
    const dy = target.y - ctx.player.y;
    const baseAngle = Math.atan2(dy, dx);
    const count = cfg.projectiles ?? 1;
    const spread = cfg.spread ?? 0;
    const burnScale = ctx.player.fireRoundScale ?? 1;

    for (let i = 0; i < count; i++) {
        const offset = count > 1 ? (i - (count - 1) / 2) * spread : 0;
        const a = baseAngle + offset;
        const vx = Math.cos(a) * cfg.projectileSpeed;
        const vy = Math.sin(a) * cfg.projectileSpeed;
        ctx.projectiles.push(new Projectile(ctx.player.x, ctx.player.y, vx, vy, {
            damage: cfg.damage * dmgMul,
            radius: cfg.projectileRadius,
            pierce: cfg.pierce,
            element: 'fire',
            burnDps: cfg.burnDps * burnScale,
            burnDuration: cfg.burnDuration,
            sprite: getEmberWispSprite(),
        }));
    }
    if (ctx.audio) ctx.audio.shootFire();
    owned.timer = cfg.cooldown * cdMul;
}

// Divine Nova: bigger Holy Pulse with heal-on-hit. Heal per hit + total
// heal per pulse are both capped so a packed room doesn't full-heal you.
function divineNovaUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    owned.timer = cfg.cooldown * cdMul;
    const damage = cfg.damage * dmgMul;

    let hitCount = 0;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (!circleOverlap(ctx.player.x, ctx.player.y, cfg.radius, e.x, e.y, e.radius)) continue;
        const dx = e.x - ctx.player.x;
        const dy = e.y - ctx.player.y;
        const len = Math.hypot(dx, dy) || 1;
        const kx = (dx / len) * KNOCKBACK.strength * 0.4;
        const ky = (dy / len) * KNOCKBACK.strength * 0.4;
        // Don't nova through walls.
        if (ctx.los && !ctx.los(e.x, e.y)) continue;
        const amp = 1 + (e.shredStacks || 0) * (cfg.shredPerStack ?? 0);
        const dmg = damage * amp;
        e.takeDamage(dmg, kx, ky);
        ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: dmg });
        if (!e.active) ctx.killed.push(e);
        if (cfg.maxShredStacks) e.applyShred(cfg.maxShredStacks, cfg.shredDuration);
        hitCount += 1;
    }

    if (hitCount > 0 && ctx.player.hp < ctx.player.maxHp) {
        const wantedHeal = (cfg.healPerHit ?? 0) * hitCount;
        const capped = Math.min(wantedHeal, cfg.maxHealPerPulse ?? wantedHeal);
        // Route through the global sustained-heal cap (CAPS.healPerSecond) so
        // rapid pulses can't out-heal a crowd.
        if (ctx.player.healSustained) ctx.player.healSustained(capped);
        else ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + capped);
    }

    ctx.effects.push({
        kind: 'pulse',
        x: ctx.player.x,
        y: ctx.player.y,
        radius: cfg.radius,
        age: 0,
        lifetime: cfg.visualLifetime ?? 0.6,
        active: true,
        evolved: true,
    });
}

// Thunder Crown: more strikes than Lightning Mark, and each primary hit
// can chain to nearby enemies inside chainRange (no double-hits within a
// single pulse — `struck` tracks the set).
function thunderCrownUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const candidates = [];
    const rsq = cfg.range * cfg.range;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        const dx = e.x - ctx.player.x;
        const dy = e.y - ctx.player.y;
        // Primary strikes need clear line of sight; chains below may arc on.
        if (dx * dx + dy * dy <= rsq && (!ctx.los || ctx.los(e.x, e.y))) candidates.push(e);
    }
    if (candidates.length === 0) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const damage = cfg.damage * dmgMul;
    const chainDamage = (cfg.chainDamage ?? cfg.damage) * dmgMul;
    const struck = new Set();

    // Same anti-boss priority split as Lightning Mark for the PRIMARY
    // strikes; chains below stay nearest-based to spread into the crowd.
    const n = Math.min(cfg.strikes, candidates.length);
    const priorityStrikes = Math.max(1, Math.floor(n * 0.5));
    for (let i = 0; i < n; i++) {
        // Chains kill/strike enemies that still sit in `candidates`; compact
        // those corpses + already-struck entries out in place so a primary
        // strike never lands on a dead target and gets wasted.
        let w = 0;
        for (let r = 0; r < candidates.length; r++) {
            const c = candidates[r];
            if (c.active && !struck.has(c)) candidates[w++] = c;
        }
        candidates.length = w;
        if (candidates.length === 0) break;

        let idx;
        if (i < priorityStrikes) {
            idx = 0;
            for (let j = 1; j < candidates.length; j++) {
                if (candidates[j].hp > candidates[idx].hp) idx = j;
            }
        } else {
            idx = Math.floor(Math.random() * candidates.length);
        }
        const target = candidates.splice(idx, 1)[0];
        shockStrike(target, damage, cfg, ctx);
        struck.add(target);
        ctx.effects.push({
            kind: 'lightning',
            x: target.x,
            y: target.y,
            age: 0,
            lifetime: 0.25,
            active: true,
            evolved: true,
        });

        // Chain to nearby unstruck enemies.
        let chainSource = target;
        for (let j = 0; j < (cfg.chainCount ?? 0); j++) {
            if (Math.random() >= (cfg.chainChance ?? 1)) break;
            const chainRangeSq = (cfg.chainRange ?? 0) * (cfg.chainRange ?? 0);
            let nearest = null;
            let nearestDsq = chainRangeSq;
            for (const e of ctx.enemies) {
                if (!e.active || struck.has(e)) continue;
                const dsq = distanceSq(chainSource.x, chainSource.y, e.x, e.y);
                if (dsq < nearestDsq) {
                    nearest = e;
                    nearestDsq = dsq;
                }
            }
            if (!nearest) break;
            shockStrike(nearest, chainDamage, cfg, ctx);
            struck.add(nearest);
            ctx.effects.push({
                kind: 'lightning',
                x: nearest.x,
                y: nearest.y,
                age: 0,
                lifetime: 0.22,
                active: true,
                evolved: true,
                chain: true,
            });
            chainSource = nearest;
        }
    }
    owned.timer = cfg.cooldown * cdMul;
}

// Stormwand: the lightning "wand". Zaps the nearest on-screen husk for the
// Cinderbolt base damage, then the bolt arcs to nearby foes (each chain hop
// deals chainDamage + a SHOCK stack). Reuses shockStrike (so burn-detonate +
// shock-amp synergies work) and the lightning visual. A zap SFX per cast.
// `cfg.zaps` (default 1 — the base wand is unchanged) fires that many PRIMARY
// zaps per cast at distinct nearest targets: the Stormsurge evolution's hook.
function voltWandUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;

    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    const damage = cfg.damage * dmgMul;
    const chainDamage = (cfg.chainDamage ?? cfg.damage) * dmgMul;
    const struck = new Set();
    // Tighter targeting than the other wands: only zap a husk within the
    // wand's own (short) range AND on-screen, so it doesn't reach across the
    // arena.
    const rSq = (cfg.range ?? 420) * (cfg.range ?? 420);

    let fired = false;
    const zaps = cfg.zaps ?? 1;
    for (let z = 0; z < zaps; z++) {
        // Nearest in-range, on-screen husk not already struck this cast.
        let target = null, bestSq = Infinity;
        for (const e of ctx.enemies) {
            if (!e.active || struck.has(e)) continue;
            const dx = e.x - ctx.player.x, dy = e.y - ctx.player.y;
            const dsq = dx * dx + dy * dy;
            if (dsq > rSq || dsq >= bestSq) continue;
            if (ctx.inView && !ctx.inView(e.x, e.y)) continue;
            target = e; bestSq = dsq;
        }
        if (!target) break;
        fired = true;

        shockStrike(target, damage, cfg, ctx);
        struck.add(target);
        ctx.effects.push({ kind: 'lightning', x: target.x, y: target.y, age: 0, lifetime: 0.22, active: true });

        // Arc to nearby unstruck foes.
        let src = target;
        for (let j = 0; j < (cfg.chainCount ?? 0); j++) {
            if (Math.random() >= (cfg.chainChance ?? 1)) break;
            const crSq = (cfg.chainRange ?? 0) * (cfg.chainRange ?? 0);
            let nearest = null, nd = crSq;
            for (const e of ctx.enemies) {
                if (!e.active || struck.has(e)) continue;
                const dsq = distanceSq(src.x, src.y, e.x, e.y);
                if (dsq < nd) { nearest = e; nd = dsq; }
            }
            if (!nearest) break;
            shockStrike(nearest, chainDamage, cfg, ctx);
            struck.add(nearest);
            ctx.effects.push({ kind: 'lightning', x: nearest.x, y: nearest.y, age: 0, lifetime: 0.2, active: true, chain: true });
            src = nearest;
        }
    }
    if (!fired) {
        // No valid target: stay primed so the next arrival is zapped at once.
        if (owned.timer < 0) owned.timer = 0;
        return;
    }
    if (ctx.audio) ctx.audio.shootShock();
    owned.timer = cfg.cooldown * cdMul;
}

// ─── Ability behaviors ─────────────────────────────────────────────────

// Shadow Dash (reworked): on cooldown, grant a timed movement-speed surge so
// the player can reposition / kite. No teleport, no path damage — a pure
// mobility burst. The boost is applied as a transient multiplier on the Player
// (folded into movement in Player.update) so it never mutates base speed.
function shadowDashUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;
    const p = ctx.player;

    p.speedBoostTimer = cfg.duration;
    p.speedBoostMul = cfg.speedMul;
    if (ctx.audio) ctx.audio.dash();

    // A burst at the player's feet + dust kick to sell the surge taking off.
    ctx.effects.push({ kind: 'pulse', x: p.x, y: p.y, radius: 64, age: 0, lifetime: 0.3, active: true });
    if (ctx.particles && ctx.particles.dashDust) {
        const fx = (p.facingX ?? 1) >= 0 ? 1 : -1;
        ctx.particles.dashDust(p.x, p.y, -fx, 0);
    }
    owned.timer = cfg.cooldown * (p.cooldownMul ?? 1);
}

// Cinder Aura: small constant burn ring around the player (LOS-gated, no
// shred). Reuses the pulse visual but with a tighter, faster cadence.
function cinderAuraUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;
    const dmgMul = (ctx.player.damageMul ?? 1) * powerRoll(ctx.player);
    const cdMul = ctx.player.cooldownMul ?? 1;
    owned.timer = cfg.cooldown * cdMul;
    const damage = cfg.damage * dmgMul;

    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (!circleOverlap(ctx.player.x, ctx.player.y, cfg.radius, e.x, e.y, e.radius)) continue;
        if (ctx.los && !ctx.los(e.x, e.y)) continue;
        e.takeDamage(damage);
        ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: damage });
        if (!e.active) ctx.killed.push(e);
    }

    ctx.effects.push({
        kind: 'pulse', x: ctx.player.x, y: ctx.player.y, radius: cfg.radius,
        age: 0, lifetime: 0.3, active: true,
    });
}

// Frostmote: periodic frost burst around the player. Chills (slows) and lightly
// damages foes in radius; bosses take a much weaker, shorter chill so they
// can't be permanently kited. Emits drifting pale-blue shard visuals.
function frostmoteUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;
    const p = ctx.player;
    owned.timer = cfg.cooldown * (p.cooldownMul ?? 1);
    const damage = cfg.damage * (p.damageMul ?? 1);
    // A player frost-passive (chillStrength) deepens the chill slightly.
    const chillBonus = p.chillStrength ?? 0;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        if (!circleOverlap(p.x, p.y, cfg.radius, e.x, e.y, e.radius)) continue;
        if (ctx.los && !ctx.los(e.x, e.y)) continue;
        e.takeDamage(damage);
        if (e.boss) {
            // Reduced effectiveness on bosses: chill ~halfway back to normal
            // speed and lasts half as long.
            e.applyChill(Math.min(0.92, cfg.slowMul + (1 - cfg.slowMul) * 0.6), cfg.slowDuration * 0.5);
        } else {
            e.applyChill(Math.max(0.3, cfg.slowMul - chillBonus), cfg.slowDuration);
        }
        // Winterveil (the evolved motes): a hard-freeze proc (Rimecore's
        // freezeChanceBonus deepens it). Field absent on base Frostmote;
        // applyFreeze is boss-exempt so no permafreeze.
        if (cfg.freezeChance) {
            const fc = cfg.freezeChance + (p.freezeChanceBonus ?? 0);
            if (Math.random() < fc) e.applyFreeze(cfg.freezeDuration ?? 0.5);
        }
        applyCombo(e, 'frost', damage, ctx);   // BRITTLE if already shocked
        ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: damage });
        if (!e.active) ctx.killed.push(e);
    }
    // Drifting shard visual (cosmetic only). Motes spread outward to `radius`.
    const motes = [];
    const n = cfg.motes;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI + Math.random() * 0.5;
        motes.push({ a, r0: 18 + Math.random() * 22, spd: (cfg.radius / 0.7) * (0.7 + Math.random() * 0.4) });
    }
    ctx.effects.push({ kind: 'frostmote', x: p.x, y: p.y, radius: cfg.radius, motes, age: 0, lifetime: 0.7, active: true });
}

// ─── Armory pt. 1 behaviors (the four NEW kinds) ───────────────────────
// Gameplay state for these lives on owned.state (like the orbit blades'
// bladePositions) and is DRAWN by WeaponSystem.drawWeaponVisuals — no
// cosmetic-effect round-trips for things that carry damage.

// Ashfang: throw a spinning cinder fang at the nearest husk; it flies out
// `range`, then homes back to the player. Each husk is hit once per PASS
// per CAST (fangs from one cast share per-pass hit sets, so a big target
// spanning both arcs — a boss — never gets double-dipped by one throw; the
// turn switches to the fresh return-pass set). Fangs keep flying while the
// cooldown rests, so multiple casts can be airborne.
function ashfangUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    const p = ctx.player;
    const discs = owned.state.discs;

    // Advance live fangs (backwards so a caught fang can splice out).
    for (let i = discs.length - 1; i >= 0; i--) {
        const d = discs[i];
        d.spin += 9 * dt;
        if (d.phase === 0) {
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.dist += cfg.discSpeed * dt;
            if (d.dist >= cfg.range) d.phase = 1;                    // turn = fresh pass set
        } else {
            // Return pass homes on the PLAYER (who may have moved).
            const dx = p.x - d.x, dy = p.y - d.y;
            const len = Math.hypot(dx, dy) || 1;
            if (len < 46) { discs.splice(i, 1); continue; }          // caught
            d.x += (dx / len) * cfg.discSpeed * dt;
            d.y += (dy / len) * cfg.discSpeed * dt;
        }
        const passHit = d.hit[d.phase];
        for (const e of ctx.enemies) {
            if (!e.active || passHit.has(e)) continue;
            if (!circleOverlap(d.x, d.y, cfg.discRadius, e.x, e.y, e.radius)) continue;
            // Same wall discipline as the orbit blades: no unseen hits.
            if (ctx.los && !ctx.los(e.x, e.y)) continue;
            e.takeDamage(d.damage);
            ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: d.damage });
            if (!e.active) ctx.killed.push(e);
            passHit.add(e);
        }
    }

    owned.timer -= dt;
    if (owned.timer > 0) return;
    const target = nearestEnemy(p, ctx.enemies, ctx.inView);
    if (!target) {
        if (owned.timer < 0) owned.timer = 0;
        return;
    }

    // Damage locks in at throw time (one powerRoll per cast, like a shot).
    const dmg = cfg.damage * (p.damageMul ?? 1) * powerRoll(p);
    const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
    const count = cfg.count ?? 1;
    // One out-pass + one return-pass hit set SHARED by the whole cast
    // (indexed by d.phase): overlapping fangs can't stack on one husk, so
    // single-target DPS is exactly 2×damage/cooldown at every fang count.
    const hit = [new Set(), new Set()];
    for (let i = 0; i < count; i++) {
        // Extra fangs fan out so a pack is carved, not one husk double-tapped.
        const a = baseAngle + (count > 1 ? (i - (count - 1) / 2) * 0.5 : 0);
        discs.push({
            x: p.x, y: p.y,
            vx: Math.cos(a) * cfg.discSpeed, vy: Math.sin(a) * cfg.discSpeed,
            dist: 0, phase: 0, spin: a, damage: dmg, hit,
        });
    }
    if (ctx.audio) ctx.audio.shootFire();
    owned.timer = cfg.cooldown * (p.cooldownMul ?? 1);
}

// Kindle Ray: a channeled wand ray. While a visible husk is in range the ray
// stays ON (state.on drives the draw) and TICKS every tickInterval, searing
// every husk within `width` of the player→target segment. No projectiles, no
// travel time — pure uptime, throttled by the tick cadence.
function kindleRayUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    const st = owned.state;
    const p = ctx.player;

    // Acquire: nearest husk in reach, on-screen, and in line of sight.
    const rSq = cfg.range * cfg.range;
    const canHit = (x, y) => {
        const dx = x - p.x, dy = y - p.y;
        return dx * dx + dy * dy <= rSq
            && (!ctx.inView || ctx.inView(x, y))
            && (!ctx.los || ctx.los(x, y));
    };
    const target = nearestEnemy(p, ctx.enemies, canHit);
    if (!target) {
        st.on = false;
        // Stay primed: the first tick lands the instant a target appears.
        if (owned.timer > 0) owned.timer = Math.max(0, owned.timer - dt);
        return;
    }
    st.on = true;
    st.phase += dt * 10;                       // draw-flicker driver
    if (st.phase > TWO_PI) st.phase -= TWO_PI;
    st.tx = target.x;
    st.ty = target.y;

    owned.timer -= dt;
    if (owned.timer > 0) return;
    owned.timer = cfg.tickInterval * (p.cooldownMul ?? 1);

    // One tick: closest-point-on-segment test against every husk.
    const dmg = cfg.damage * (p.damageMul ?? 1) * powerRoll(p);
    const bx = target.x - p.x, by = target.y - p.y;
    const lenSq = bx * bx + by * by || 1;
    const burnScale = p.fireRoundScale ?? 1;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        let t = ((e.x - p.x) * bx + (e.y - p.y) * by) / lenSq;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const cx = p.x + bx * t, cy = p.y + by * t;
        const w = cfg.width + e.radius;
        if ((e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy) > w * w) continue;
        if (ctx.los && !ctx.los(e.x, e.y)) continue;
        e.takeDamage(dmg);
        ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: dmg });
        if (!e.active) ctx.killed.push(e);
        // Dawnfire Ray: each tick also stamps a burn (absent on the base ray).
        if (cfg.burnDps) e.applyBurn(cfg.burnDps * burnScale, cfg.burnDuration ?? 2.0);
        applyCombo(e, 'fire', dmg, ctx);   // SHATTER if already chilled/frozen
    }
}

// Cindermine: lay an ember mine at the player's feet on a cadence (movement
// makes it a breadcrumb trap-line). A mine arms after armTime, then ERUPTS
// when any husk enters triggerRadius — damaging + burning everything within
// blastRadius. Mines persist until tripped; maxMines caps the live field
// (the timer holds primed at a full field, so a blast re-lays immediately).
// A mine stranded past MINE_RECLAIM_DIST is silently reclaimed: without it,
// kiting away from a full untripped field (enemies chase the PLAYER, not the
// mines) would hold the cadence primed forever and leave the slot dead.
const MINE_RECLAIM_DIST_SQ = 1200 * 1200; // comfortably off-screen (half-diag ≈ 1101)
function emberMineUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    const p = ctx.player;
    const mines = owned.state.mines;

    for (let i = mines.length - 1; i >= 0; i--) {
        const m = mines[i];
        m.age += dt;
        const sx = m.x - p.x, sy = m.y - p.y;
        if (sx * sx + sy * sy > MINE_RECLAIM_DIST_SQ) { mines.splice(i, 1); continue; }
        if (m.age < cfg.armTime) continue;
        let tripped = false;
        for (const e of ctx.enemies) {
            if (!e.active) continue;
            if (circleOverlap(m.x, m.y, cfg.triggerRadius, e.x, e.y, e.radius)) { tripped = true; break; }
        }
        if (!tripped) continue;
        // Erupt: one powerRoll per blast; knockback radiates from the mine.
        const dmg = cfg.damage * (p.damageMul ?? 1) * powerRoll(p);
        const burnScale = p.fireRoundScale ?? 1;
        for (const e of ctx.enemies) {
            if (!e.active) continue;
            if (!circleOverlap(m.x, m.y, cfg.blastRadius, e.x, e.y, e.radius)) continue;
            const dx = e.x - m.x, dy = e.y - m.y;
            const len = Math.hypot(dx, dy) || 1;
            e.takeDamage(dmg, (dx / len) * KNOCKBACK.strength * 0.6, (dy / len) * KNOCKBACK.strength * 0.6);
            ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: dmg });
            if (!e.active) ctx.killed.push(e);
            if (cfg.burnDps) e.applyBurn(cfg.burnDps * burnScale, cfg.burnDuration ?? 2.5);
            applyCombo(e, 'fire', dmg, ctx);   // SHATTER if already chilled/frozen
        }
        ctx.effects.push({
            kind: 'blast', x: m.x, y: m.y, radius: cfg.blastRadius,
            age: 0, lifetime: 0.4, active: true,
        });
        if (ctx.audio) ctx.audio.shootFire();
        mines.splice(i, 1);
    }

    owned.timer -= dt;
    if (owned.timer > 0) return;
    if (mines.length >= cfg.maxMines) {
        owned.timer = 0;                        // field full — hold primed
        return;
    }
    mines.push({ x: p.x, y: p.y, age: 0 });
    owned.timer = cfg.cooldown * (p.cooldownMul ?? 1);
}

// Wakefire: drop a ground-fire patch every `spacing` px of MOVEMENT (standing
// still stops the wake — movement is the weapon). Patches live patchLife
// seconds; every tickInterval, each husk standing in any patch takes one
// tick (one tick per husk per interval, however many patches it straddles).
function wakefireUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    const st = owned.state;
    const p = ctx.player;
    const patches = st.patches;

    const mdx = p.x - st.lastX, mdy = p.y - st.lastY;
    if (mdx * mdx + mdy * mdy >= cfg.spacing * cfg.spacing) {
        st.lastX = p.x;
        st.lastY = p.y;
        patches.push({ x: p.x, y: p.y, age: 0 });
        if (patches.length > cfg.maxPatches) patches.shift(); // oldest dies first
    }

    // Age + expire (pushed in order, uniform life → oldest is always first).
    for (const pa of patches) pa.age += dt;
    while (patches.length && patches[0].age >= cfg.patchLife) patches.shift();

    owned.timer -= dt;
    if (owned.timer > 0) return;
    owned.timer = cfg.tickInterval * (p.cooldownMul ?? 1);
    if (patches.length === 0) return;

    const dmg = cfg.damage * (p.damageMul ?? 1) * powerRoll(p);
    const burnScale = p.fireRoundScale ?? 1;
    for (const e of ctx.enemies) {
        if (!e.active) continue;
        for (const pa of patches) {
            if (!circleOverlap(pa.x, pa.y, cfg.patchRadius, e.x, e.y, e.radius)) continue;
            e.takeDamage(dmg);
            ctx.hits.push({ x: e.x, y: e.y - e.radius, amount: dmg });
            if (!e.active) ctx.killed.push(e);
            // Wildfire Wake: the patches also stamp a burn (absent on base).
            if (cfg.burnDps) e.applyBurn(cfg.burnDps * burnScale, cfg.burnDuration ?? 2.0);
            applyCombo(e, 'fire', dmg, ctx);   // SHATTER if already chilled/frozen
            break;
        }
    }
}

// Hearth Totem: periodic restorative pulse that mends the player a little.
// No targeting/aiming; balanced via a long cooldown + small heal.
function hearthTotemUpdate(dt, owned, ctx) {
    const cfg = WEAPONS[owned.id].perLevel[owned.level];
    owned.timer -= dt;
    if (owned.timer > 0) return;
    owned.timer = cfg.cooldown * (ctx.player.cooldownMul ?? 1);

    const p = ctx.player;
    // Route through the global sustained-heal budget (CAPS.healPerSecond) so a
    // Totem + regen + Divine Nova stack can't out-heal late-game contact damage.
    if (p.healSustained) p.healSustained(cfg.heal);
    else if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + cfg.heal);
    ctx.effects.push({
        kind: 'pulse', x: p.x, y: p.y, radius: 120, age: 0, lifetime: 0.5, active: true, evolved: true,
    });
}
