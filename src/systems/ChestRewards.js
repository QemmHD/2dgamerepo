// Rolls a chest reward for the current game state.
//
// Reward kinds:
//   - weapon: upgrade a random non-maxed owned weapon by 1 level
//   - passive: upgrade a random non-maxed owned passive by 1 level
//   - coins:   add coins (luck-boosted amount)
//   - heal:    restore HP (luck-boosted, only if not at full)
//
// Each upgrade is weighted; player.chestLuck (from Clover Coin passive)
// shifts the roll toward weapon/passive upgrades over coins/heal. If no
// weapons or passives are upgradeable, those kinds are dropped from the
// pool. Coins is the always-available fallback.

import { pickWeighted } from '../core/MathUtils.js';
import { WEAPONS } from '../content/weapons.js';
import { PASSIVES } from '../content/passives.js';
import {
    MAX_WEAPON_LEVEL,
    MAX_PASSIVE_LEVEL,
    CHEST,
} from '../config/GameConfig.js';

export function rollChestReward(game) {
    const luck = game.player.chestLuck ?? 0;

    const upgradeableWeapons = game.weaponSystem.owned.filter(
        (w) => w.level < MAX_WEAPON_LEVEL
    );
    const upgradeablePassives = game.passiveSystem.owned.filter((p) => {
        const def = PASSIVES[p.id];
        const max = def?.maxLevel ?? MAX_PASSIVE_LEVEL;
        return p.level < max;
    });
    const canHeal = game.player.hp < game.player.maxHp;

    const pool = [];
    if (upgradeableWeapons.length > 0) {
        pool.push({
            kind: 'weapon',
            weight: CHEST.weights.weapon + luck * CHEST.luckUpgradeWeight,
        });
    }
    if (upgradeablePassives.length > 0) {
        pool.push({
            kind: 'passive',
            weight: CHEST.weights.passive + luck * CHEST.luckUpgradeWeight,
        });
    }
    pool.push({ kind: 'coins', weight: CHEST.weights.coins });
    if (canHeal) {
        pool.push({ kind: 'heal', weight: CHEST.weights.heal });
    }

    const picked = pickWeighted(pool) ?? { kind: 'coins' };

    switch (picked.kind) {
        case 'weapon': {
            const w = upgradeableWeapons[
                Math.floor(Math.random() * upgradeableWeapons.length)
            ];
            const def = WEAPONS[w.id];
            const toLevel = w.level + 1;
            return {
                kind: 'weapon',
                text: `${def.name} upgraded to Lv ${toLevel}`,
                apply(g) { g.weaponSystem.levelUpWeapon(w.id); },
            };
        }
        case 'passive': {
            const p = upgradeablePassives[
                Math.floor(Math.random() * upgradeablePassives.length)
            ];
            const def = PASSIVES[p.id];
            const toLevel = p.level + 1;
            return {
                kind: 'passive',
                text: `${def.name} upgraded to Lv ${toLevel}`,
                apply(g) { g.passiveSystem.levelUpPassive(p.id, g.player); },
            };
        }
        case 'heal': {
            const amount = CHEST.healReward.base + Math.floor(luck * CHEST.healReward.luckBonus);
            return {
                kind: 'heal',
                text: `Healed ${amount} HP`,
                apply(g) {
                    g.player.hp = Math.min(g.player.hp + amount, g.player.maxHp);
                },
            };
        }
        case 'coins':
        default: {
            const { min, max, luckBonus } = CHEST.coinReward;
            const amount = min +
                Math.floor(Math.random() * (max - min + 1)) +
                Math.floor(luck * luckBonus);
            return {
                kind: 'coins',
                text: `+${amount} Coins`,
                apply(g) { g.player.coins = (g.player.coins ?? 0) + amount; },
            };
        }
    }
}
