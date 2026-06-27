// Builds the 3-card level-up pool. Mixes stat upgrades (data list below)
// with dynamic per-weapon entries generated from game.weaponSystem.
//
// Cards are uniform shape: { id, name, description, cardLabel, rarity,
// weight, maxStacks?, available?, apply(game) }. The `cardLabel` is what
// UISystem prints in the rarity slot ("STAT" / "WEAPON UPGRADE" / "NEW
// WEAPON"). Adding a new card = push a new STAT_UPGRADES entry or define
// a new weapon in src/content/weapons.js; no system code change.

import { pickWeighted } from '../core/MathUtils.js';
import { WEAPONS, WEAPON_IDS } from '../content/weapons.js';
import { MAX_WEAPON_LEVEL } from '../config/GameConfig.js';

const STAT_UPGRADES = [
    {
        id: 'stat:move-speed',
        kind: 'stat',
        cardLabel: 'STAT',
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
        id: 'stat:pickup-range',
        kind: 'stat',
        cardLabel: 'STAT',
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
        id: 'stat:max-hp',
        kind: 'stat',
        cardLabel: 'STAT',
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
        id: 'stat:xp-gain',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Wise Monkey',
        description: '+10% XP from gems',
        rarity: 'uncommon',
        weight: 0.7,
        maxStacks: 6,
        apply(game) {
            game.player.xpMultiplier *= 1.1;
        },
    },
    {
        id: 'stat:heal',
        kind: 'stat',
        cardLabel: 'STAT',
        name: 'Banana Patch',
        description: 'Restore 30 HP',
        rarity: 'common',
        weight: 0.8,
        available(game) {
            return game.player.hp < game.player.maxHp;
        },
        apply(game) {
            game.player.hp = Math.min(game.player.hp + 30, game.player.maxHp);
        },
    },
];

const WEIGHT_NEW_WEAPON = 0.9;
const WEIGHT_WEAPON_UPGRADE = 1.1;

export class UpgradeSystem {
    constructor() {
        this.appliedCounts = Object.create(null);
    }

    rollChoices(game, count = 3) {
        const pool = this._buildPool(game);

        const choices = [];
        const remaining = pool.slice();
        while (choices.length < count && remaining.length > 0) {
            const picked = pickWeighted(remaining);
            if (!picked) break;
            choices.push(picked);
            remaining.splice(remaining.indexOf(picked), 1);
        }
        return choices;
    }

    _buildPool(game) {
        const pool = [];

        // Stat upgrades — gated by maxStacks and an optional context check.
        for (const u of STAT_UPGRADES) {
            const cur = this.appliedCounts[u.id] ?? 0;
            if (cur >= (u.maxStacks ?? Infinity)) continue;
            if (u.available && !u.available(game)) continue;
            pool.push(u);
        }

        // Per-owned-weapon upgrade entries (skip maxed weapons).
        const ownedIds = new Set();
        for (const w of game.weaponSystem.owned) {
            ownedIds.add(w.id);
            if (w.level < MAX_WEAPON_LEVEL) {
                pool.push(weaponUpgradeChoice(w));
            }
        }

        // Per-unowned-weapon unlock entries.
        for (const id of WEAPON_IDS) {
            if (ownedIds.has(id)) continue;
            pool.push(newWeaponChoice(id));
        }

        return pool;
    }

    apply(upgrade, game) {
        if (!upgrade) return;
        this.appliedCounts[upgrade.id] = (this.appliedCounts[upgrade.id] ?? 0) + 1;
        upgrade.apply(game);
    }
}

function weaponUpgradeChoice(owned) {
    const def = WEAPONS[owned.id];
    const next = owned.level + 1;
    return {
        id: `weapon:${owned.id}:upgrade`,
        kind: 'weapon-upgrade',
        cardLabel: 'WEAPON UPGRADE',
        name: def?.name ?? owned.id,
        description: `Lv ${owned.level} → Lv ${next}`,
        cardLevelText: `Lv ${next}`,
        rarity: 'rare',
        weight: WEIGHT_WEAPON_UPGRADE,
        apply(game) {
            game.weaponSystem.levelUpWeapon(owned.id);
        },
    };
}

function newWeaponChoice(id) {
    const def = WEAPONS[id];
    return {
        id: `weapon:${id}:new`,
        kind: 'weapon-new',
        cardLabel: 'NEW WEAPON',
        name: def?.name ?? id,
        description: def?.description ?? '',
        cardLevelText: 'Lv 1',
        rarity: 'epic',
        weight: WEIGHT_NEW_WEAPON,
        apply(game) {
            game.weaponSystem.addWeapon(id);
        },
    };
}
