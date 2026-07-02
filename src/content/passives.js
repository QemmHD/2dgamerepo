// Passive item definitions.
//
// Each passive has:
//   id          stable string used by save/upgrade/UI lookups
//   name        shown on cards and HUD
//   description shown on cards
//   maxLevel    upper bound on levels (default 5)
//   apply(player)  called each time a passive is unlocked OR leveled. Each
//                  call applies one level worth of effect — calling it five
//                  times = level-5 effect. Effects compound naturally.
//
// Modifiers live on the Player instance:
//   damageMul    multiplied against every weapon's damage at hit time
//   cooldownMul  multiplied against every weapon's cooldown / hit-cooldown
//   speed        directly bumped (also touched by Quick Feet stat upgrade)
//   pickupRange  directly bumped (also touched by Banana Magnet)
//   maxHp        directly bumped (also touched by Hearty)
//   chestLuck    stored for the future chest-rewards stage
//
// To add a passive, append an entry below — the UpgradeSystem reads
// PASSIVES dynamically.
//
// CAP-AWARE availability (P0.3): a passive may declare available(game) —
// checked by UpgradeSystem for BOTH its "new" and "upgrade" cards. Stats that
// Game._applyPlayerCaps hard-clamps every frame (damageMul, cooldownMul,
// speed, pickupRange — see CAPS) make further picks silent no-ops once the
// clamp engages, so those cards must stop appearing. Multi-effect passives
// stay offered while ANY of their effects still has headroom. ONE exception,
// applied by UpgradeSystem: the "new" card of an evolution CATALYST for an
// owned base weapon ignores this gate — evolving needs the passive at any
// level, so a capped stat must never lock an evolution out of the run.

import { CAPS } from '../config/GameConfig.js';

// The clamps set the field EXACTLY to its ceiling, so strict compares read
// "still has headroom". Optional-chained: available() is only called with a
// live run, but stay safe on partial construction.
const speedRoom = (g) => (g.player?.speed ?? 0) < CAPS.moveSpeed;
const damageRoom = (g) => (g.player?.damageMul ?? 1) < CAPS.damageMul;
const cooldownRoom = (g) => (g.player?.cooldownMul ?? 1) > CAPS.cooldownMulFloor;
const pickupRoom = (g) => (g.player?.pickupRange ?? 0) < CAPS.pickupRange;
const regenRoom = (g) => (g.player?.regenPerSecond ?? 0) < CAPS.regenPerSecond;

export const PASSIVES = {
    spellbook: {
        id: 'spellbook',
        name: 'Quickwick',
        description: '-12% weapon cooldowns per level.',
        maxLevel: 5,
        available: cooldownRoom,
        apply(player) {
            player.cooldownMul *= 0.88;
        },
    },

    powerStone: {
        id: 'powerStone',
        name: 'Brightstone',
        description: '+14% weapon damage per level.',
        maxLevel: 5,
        available: damageRoom,
        apply(player) {
            player.damageMul *= 1.14;
        },
    },

    windBoots: {
        id: 'windBoots',
        name: 'Emberstride',
        description: '+10% movement speed per level.',
        maxLevel: 5,
        available: speedRoom,
        apply(player) {
            player.speed *= 1.10;
        },
    },

    magnetCharm: {
        id: 'magnetCharm',
        name: 'Gleamcharm',
        description: '+20% gem pickup range per level.',
        maxLevel: 5,
        available: pickupRoom,
        apply(player) {
            player.pickupRange *= 1.20;
        },
    },

    ironHeart: {
        id: 'ironHeart',
        name: 'Hearthcore',
        description: '+25 max HP per level (also heals).',
        maxLevel: 5,
        apply(player) {
            const bonus = 25;
            player.maxHp += bonus;
            player.hp = Math.min(player.hp + bonus, player.maxHp);
        },
    },

    cloverCoin: {
        id: 'cloverCoin',
        name: 'Wishing Cinder',
        description: '+15% chest reward luck per level.',
        maxLevel: 5,
        apply(player) {
            player.chestLuck += 0.15;
        },
    },

    // ── Defensive passives ──────────────────────────────────────────
    thickHide: {
        id: 'thickHide',
        name: 'Ashhide',
        description: '-8% damage taken per level.',
        maxLevel: 5,
        apply(player) {
            player.damageTakenMul *= 0.92;
        },
    },

    secondWind: {
        id: 'secondWind',
        name: 'Rekindle',
        description: 'Regenerate +1.2 HP/s when no enemy is near, per level.',
        maxLevel: 5,
        available: regenRoom,
        apply(player) {
            player.regenPerSecond += 1.2;
        },
    },

    thorns: {
        id: 'thorns',
        name: 'Backdraft',
        description: 'Reflect +25% of contact damage back per level.',
        maxLevel: 5,
        apply(player) {
            player.thornsReflect += 0.25;
        },
    },

    // ── Elemental passives ──────────────────────────────────────────
    pyromancersTinder: {
        id: 'pyromancersTinder',
        name: 'Tinderheart',
        description: '+18% burn damage per level.',
        maxLevel: 5,
        element: 'fire',
        apply(player) {
            player.burnDamageMul *= 1.18;
        },
    },

    frostbiteCore: {
        id: 'frostbiteCore',
        name: 'Rimecore',
        description: 'Deepen chill & +4% freeze chance per level.',
        maxLevel: 5,
        element: 'frost',
        apply(player) {
            player.chillStrength += 0.04;
            player.freezeChanceBonus += 0.04;
        },
    },

    // ── Offensive (crit) passives ───────────────────────────────────────
    emberzeal: {
        id: 'emberzeal',
        name: 'Emberzeal',
        description: '+6% critical strike chance per level.',
        maxLevel: 5,
        rarity: 'rare',
        apply(player) {
            player.critChance = Math.min(0.8, (player.critChance ?? 0) + 0.06);
        },
    },

    executioner: {
        id: 'executioner',
        name: 'Executioner',
        description: '+35% critical strike damage per level.',
        maxLevel: 4,
        rarity: 'epic',
        apply(player) {
            player.critMul = (player.critMul ?? 2) + 0.35;
        },
    },

    lastLight: {
        id: 'lastLight',
        name: 'Last Light',
        description: 'Below 35% HP, deal +14% damage per level — burn brightest.',
        maxLevel: 4,
        rarity: 'epic',
        apply(player) {
            player.lowHpDamageBonus = (player.lowHpDamageBonus ?? 0) + 0.14;
        },
    },

    // ── Risk / reward + mobility ────────────────────────────────────────
    glasswick: {
        id: 'glasswick',
        name: 'Glasswick',
        description: '+22% weapon damage per level, but +7% damage taken — burn hot.',
        maxLevel: 3,
        rarity: 'epic',
        // Once damage is capped, this is ONLY the downside — a trap pick.
        available: damageRoom,
        apply(player) {
            player.damageMul *= 1.22;
            player.damageTakenMul *= 1.07;
        },
    },

    featherstep: {
        id: 'featherstep',
        name: 'Featherstep',
        description: '+9% move speed and +8% pickup range per level.',
        maxLevel: 4,
        // Multi-effect: keep offering while EITHER stat has headroom.
        available: (g) => speedRoom(g) || pickupRoom(g),
        apply(player) {
            player.speed *= 1.09;
            player.pickupRange *= 1.08;
        },
    },

    // ── Hybrid bulwark ──────────────────────────────────────────────────
    stoneheart: {
        id: 'stoneheart',
        name: 'Stoneheart',
        description: '+16 max HP and −4% damage taken per level.',
        maxLevel: 5,
        rarity: 'rare',
        apply(player) {
            player.maxHp += 16;
            player.hp = Math.min(player.hp + 16, player.maxHp);
            player.damageTakenMul *= 0.96;
        },
    },

    // ── More perks (lifesteal / tempo / utility) ────────────────────────
    blooddrinker: {
        id: 'blooddrinker',
        name: 'Blooddrinker',
        description: 'Heal +0.6 HP per kill per level (capped per second).',
        maxLevel: 5,
        rarity: 'rare',
        apply(player) {
            player.killHeal = (player.killHeal ?? 0) + 0.6;
        },
    },
    tempo: {
        id: 'tempo',
        name: 'Tempo',
        description: '−7% cooldowns and +5% move speed per level.',
        maxLevel: 4,
        rarity: 'uncommon',
        // Multi-effect: keep offering while EITHER stat has headroom.
        available: (g) => cooldownRoom(g) || speedRoom(g),
        apply(player) {
            player.cooldownMul *= 0.93;
            player.speed *= 1.05;
        },
    },
    glimmer: {
        id: 'glimmer',
        name: 'Glimmer',
        description: '+10% XP gain and +10% pickup range per level.',
        maxLevel: 5,
        rarity: 'common',
        apply(player) {
            player.xpMultiplier *= 1.10;
            player.pickupRange *= 1.10;
        },
    },
};

export const PASSIVE_IDS = Object.keys(PASSIVES);
