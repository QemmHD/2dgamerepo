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

export const PASSIVES = {
    spellbook: {
        id: 'spellbook',
        name: 'Quickwick',
        description: '-9% weapon cooldowns per level.',
        maxLevel: 5,
        apply(player) {
            player.cooldownMul *= 0.91;
        },
    },

    powerStone: {
        id: 'powerStone',
        name: 'Brightstone',
        description: '+12% weapon damage per level.',
        maxLevel: 5,
        apply(player) {
            player.damageMul *= 1.12;
        },
    },

    windBoots: {
        id: 'windBoots',
        name: 'Emberstride',
        description: '+10% movement speed per level.',
        maxLevel: 5,
        apply(player) {
            player.speed *= 1.10;
        },
    },

    magnetCharm: {
        id: 'magnetCharm',
        name: 'Gleamcharm',
        description: '+20% gem pickup range per level.',
        maxLevel: 5,
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
};

export const PASSIVE_IDS = Object.keys(PASSIVES);
