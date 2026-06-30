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
import { findEligibleEvolutions } from '../content/evolutions.js';
import {
    MAX_PASSIVE_LEVEL,
    CHEST,
} from '../config/GameConfig.js';

export function rollChestReward(game) {
    // Evolutions take priority over normal chest rewards. If any base
    // weapon is at max level AND the matching catalyst passive is owned,
    // pick one at random and return an evolution reward.
    const eligibleEvolutions = findEligibleEvolutions(game);
    if (eligibleEvolutions.length > 0) {
        const evo = eligibleEvolutions[
            Math.floor(Math.random() * eligibleEvolutions.length)
        ];
        const baseDef = WEAPONS[evo.baseWeaponId];
        return {
            kind: 'evolution',
            evolutionId: evo.id,
            baseWeaponId: evo.baseWeaponId,
            evolvedWeaponId: evo.evolvedWeaponId,
            baseName: baseDef?.name ?? evo.baseWeaponId,
            evolvedName: evo.evolvedName,
            catalystName: evo.catalystName,
            chestRewardText: evo.chestRewardText,
            text: evo.chestRewardText,
            apply(g) {
                g.weaponSystem.evolveWeapon(evo.baseWeaponId, evo.evolvedWeaponId);
            },
        };
    }

    const luck = game.player.chestLuck ?? 0;

    // Use the PER-WEAPON cap (isMaxLevel), not the global MAX_WEAPON_LEVEL:
    // evolved weapons cap at level 1 and abilities at 5, so filtering on the
    // global 8 would offer "upgrades" to already-maxed weapons that levelUp
    // then silently no-ops — the chest-spams-a-full-upgrade bug.
    const upgradeableWeapons = game.weaponSystem.owned.filter(
        (w) => !game.weaponSystem.isMaxLevel(w.id)
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
