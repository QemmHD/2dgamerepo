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
        name: 'Spellbook',
        description: '-8% weapon cooldowns per level.',
        maxLevel: 5,
        apply(player) {
            player.cooldownMul *= 0.92;
        },
    },

    powerStone: {
        id: 'powerStone',
        name: 'Power Stone',
        description: '+10% weapon damage per level.',
        maxLevel: 5,
        apply(player) {
            player.damageMul *= 1.10;
        },
    },

    windBoots: {
        id: 'windBoots',
        name: 'Wind Boots',
        description: '+10% movement speed per level.',
        maxLevel: 5,
        apply(player) {
            player.speed *= 1.10;
        },
    },

    magnetCharm: {
        id: 'magnetCharm',
        name: 'Magnet Charm',
        description: '+20% gem pickup range per level.',
        maxLevel: 5,
        apply(player) {
            player.pickupRange *= 1.20;
        },
    },

    ironHeart: {
        id: 'ironHeart',
        name: 'Iron Heart',
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
        name: 'Clover Coin',
        description: '+15% chest reward luck per level.',
        maxLevel: 5,
        apply(player) {
            player.chestLuck += 0.15;
        },
    },

    // ── Defensive passives ──────────────────────────────────────────
    thickHide: {
        id: 'thickHide',
        name: 'Thick Hide',
        description: '-8% damage taken per level.',
        maxLevel: 5,
        apply(player) {
            player.damageTakenMul *= 0.92;
        },
    },

    secondWind: {
        id: 'secondWind',
        name: 'Second Wind',
        description: 'Regenerate +1.2 HP/s when no enemy is near, per level.',
        maxLevel: 5,
        apply(player) {
            player.regenPerSecond += 1.2;
        },
    },

    thorns: {
        id: 'thorns',
        name: 'Thorns',
        description: 'Reflect +25% of contact damage back per level.',
        maxLevel: 5,
        apply(player) {
            player.thornsReflect += 0.25;
        },
    },
};

export const PASSIVE_IDS = Object.keys(PASSIVES);
