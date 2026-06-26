// Pool of available upgrades. Each entry is pure data + an `apply(game)`
// that mutates the world (weapons[], player stats, etc.). Adding a new
// upgrade is a single push to this array; no system code changes.

import { pickWeighted } from '../core/MathUtils.js';

const UPGRADES = [
    {
        id: 'bolt-damage',
        name: 'Sharper Bolts',
        description: '+25% Bolt damage',
        rarity: 'common',
        weight: 1.2,
        maxStacks: 8,
        apply(game) {
            const bolt = findWeapon(game, 'Bolt');
            if (bolt) bolt.damage *= 1.25;
        },
    },
    {
        id: 'bolt-cooldown',
        name: 'Quick Hands',
        description: '-15% Bolt cooldown',
        rarity: 'common',
        weight: 1.1,
        maxStacks: 6,
        apply(game) {
            const bolt = findWeapon(game, 'Bolt');
            if (bolt) bolt.cooldown *= 0.85;
        },
    },
    {
        id: 'move-speed',
        name: 'Quick Feet',
        description: '+15% movement speed',
        rarity: 'common',
        weight: 1.0,
        maxStacks: 5,
        apply(game) {
            game.player.speed *= 1.15;
        },
    },
    {
        id: 'pickup-range',
        name: 'Banana Magnet',
        description: '+30% gem pickup range',
        rarity: 'common',
        weight: 1.0,
        maxStacks: 5,
        apply(game) {
            game.player.pickupRange *= 1.3;
        },
    },
    {
        id: 'max-hp',
        name: 'Hearty',
        description: '+20 max HP',
        rarity: 'common',
        weight: 0.9,
        maxStacks: 6,
        apply(game) {
            game.player.maxHp += 20;
            game.player.hp = Math.min(game.player.hp + 20, game.player.maxHp);
        },
    },
    {
        id: 'projectile-speed',
        name: 'Faster Bolts',
        description: '+25% projectile speed',
        rarity: 'common',
        weight: 0.9,
        maxStacks: 4,
        apply(game) {
            const bolt = findWeapon(game, 'Bolt');
            if (bolt) bolt.projectileSpeed *= 1.25;
        },
    },
    {
        id: 'xp-gain',
        name: 'Wise Monkey',
        description: '+10% XP from gems',
        rarity: 'uncommon',
        weight: 0.7,
        maxStacks: 6,
        apply(game) {
            game.player.xpMultiplier *= 1.1;
        },
    },
];

function findWeapon(game, name) {
    return game.weaponSystem?.weapons?.find((w) => w.name === name) ?? null;
}

export class UpgradeSystem {
    constructor() {
        this.appliedCounts = Object.create(null);
    }

    getAll() {
        return UPGRADES;
    }

    rollChoices(count = 3) {
        // Pull from upgrades that still have stacks remaining; weighted-pick
        // a card, remove it from the pool, repeat — guarantees no duplicates
        // within a single level-up.
        const remaining = UPGRADES.filter((u) => {
            const cur = this.appliedCounts[u.id] ?? 0;
            return cur < (u.maxStacks ?? Infinity);
        });

        const choices = [];
        while (choices.length < count && remaining.length > 0) {
            const picked = pickWeighted(remaining);
            if (!picked) break;
            choices.push(picked);
            remaining.splice(remaining.indexOf(picked), 1);
        }
        return choices;
    }

    apply(upgrade, game) {
        if (!upgrade) return;
        this.appliedCounts[upgrade.id] = (this.appliedCounts[upgrade.id] ?? 0) + 1;
        upgrade.apply(game);
    }
}
