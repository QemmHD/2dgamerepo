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
        description: 'Flings a living cinder at the nearest husk.',
        kind: 'projectile',
        evolvesTo: null,
        // Signature: ricochet-on-kill — a lethal bolt leaps to the next
        // nearest unhit foe (independent of pierce). ricochet count grows
        // with level so it reads as an escalating chain-reaction sniper.
        perLevel: [
            null,
            { damage: 17, cooldown: 0.52, projectileSpeed: 935,  pierce: 0, projectileRadius: 15, ricochet: 0, ricochetRange: 360 },
            { damage: 20, cooldown: 0.50, projectileSpeed: 940,  pierce: 0, projectileRadius: 15, ricochet: 0, ricochetRange: 360 },
            { damage: 24, cooldown: 0.48, projectileSpeed: 980,  pierce: 1, projectileRadius: 15, ricochet: 0, ricochetRange: 360 },
            { damage: 29, cooldown: 0.44, projectileSpeed: 1020, pierce: 1, projectileRadius: 15, ricochet: 1, ricochetRange: 360 },
            { damage: 34, cooldown: 0.40, projectileSpeed: 1060, pierce: 1, projectileRadius: 16, ricochet: 1, ricochetRange: 360 },
            { damage: 40, cooldown: 0.36, projectileSpeed: 1120, pierce: 1, projectileRadius: 16, ricochet: 2, ricochetRange: 360 },
            { damage: 47, cooldown: 0.32, projectileSpeed: 1180, pierce: 2, projectileRadius: 17, ricochet: 2, ricochetRange: 360 },
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
            { damage: 17, cooldown: 0.52, range: 700, chainCount: 1, chainChance: 0.85, chainRange: 240, chainDamage: 11, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { damage: 20, cooldown: 0.50, range: 720, chainCount: 1, chainChance: 0.88, chainRange: 250, chainDamage: 13, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { damage: 24, cooldown: 0.48, range: 740, chainCount: 2, chainChance: 0.90, chainRange: 260, chainDamage: 15, shockPerStack: 0.08, maxShockStacks: 3, shockDuration: 4.0 },
            { damage: 29, cooldown: 0.44, range: 760, chainCount: 2, chainChance: 0.90, chainRange: 270, chainDamage: 18, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { damage: 34, cooldown: 0.40, range: 800, chainCount: 2, chainChance: 0.92, chainRange: 280, chainDamage: 21, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { damage: 40, cooldown: 0.36, range: 840, chainCount: 3, chainChance: 0.92, chainRange: 290, chainDamage: 25, shockPerStack: 0.08, maxShockStacks: 4, shockDuration: 4.0 },
            { damage: 47, cooldown: 0.32, range: 880, chainCount: 3, chainChance: 0.95, chainRange: 300, chainDamage: 29, shockPerStack: 0.08, maxShockStacks: 5, shockDuration: 4.0 },
            { damage: 56, cooldown: 0.28, range: 920, chainCount: 3, chainChance: 1.0, chainRange: 320, chainDamage: 34, shockPerStack: 0.08, maxShockStacks: 5, shockDuration: 4.0 },
        ],
        update: voltWandUpdate,
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
                // Evolution payoff: twin bolts that clearly out-damage + out-burn
                // a maxed Pyre Wisp (14 dmg / 20 burnDps).
                damage: 22, cooldown: 0.44, projectileSpeed: 940,
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
            }
            const freezeChance = (cfg.freezeChance || 0) + (ctx.player.freezeChanceBonus || 0);
            if (freezeChance > 0 && Math.random() < freezeChance) {
                e.applyFreeze(cfg.freezeDuration ?? 0.5);
            }
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
function shockStrike(target, baseDamage, cfg, ctx) {
    const amp = 1 + (target.shockStacks || 0) * (cfg.shockPerStack ?? 0);
    const dmg = baseDamage * amp;
    target.takeDamage(dmg);
    ctx.hits.push({ x: target.x, y: target.y - target.radius, amount: dmg });
    if (!target.active) { ctx.killed.push(target); }
    if (cfg.maxShockStacks) target.applyShock(cfg.maxShockStacks, cfg.shockDuration);
    if (target.active && target.burnTimer > 0) {
        const burst = target.burnDps * SHOCK_CFG.detonateMul;
        target.takeDamage(burst);
        ctx.hits.push({ x: target.x, y: target.y - target.radius, amount: burst });
        target.burnTimer = 0;
        target.burnDps = 0;
        target.burnTickAccum = 0;
        if (!target.active) ctx.killed.push(target);
    }
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
    ctx.projectiles.push(new Projectile(ctx.player.x, ctx.player.y, vx, vy, {
        damage: cfg.damage * dmgMul,
        radius: cfg.projectileRadius,
        pierce: cfg.pierce,
        element: 'fire',
        burnDps: cfg.burnDps,
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
            burnDps: cfg.burnDps,
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
function voltWandUpdate(dt, owned, ctx) {
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
    const damage = cfg.damage * dmgMul;
    const chainDamage = (cfg.chainDamage ?? cfg.damage) * dmgMul;
    const struck = new Set();

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
