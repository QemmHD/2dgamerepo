// ShopTransaction — one durable wallet + entitlement boundary for permanent
// upgrades and coin-priced cosmetics.
//
// Browser entrypoints use SaveSystem's participant-exclusive transaction so a
// second live tab is rejected before any debit. Synchronous exports retain a
// deterministic seam for validators and internal tooling.

import { COSMETICS, cosmeticCoinCost } from '../content/cosmetics.js';
import { PERMANENT_UPGRADES, nextCost } from '../content/permanentUpgrades.js';
import {
    commitEntitlementTransaction,
    commitEntitlementTransactionAtomic,
} from './EntitlementTransaction.js';

function wallet(save) {
    const value = save?.data?.totalCoins;
    if (value === Infinity) return Infinity;
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function resolveUpgradePurchase(save, id) {
    const upgrade = PERMANENT_UPGRADES.find((entry) => entry.id === id);
    if (!upgrade) return { ok: false, reason: 'invalid' };
    const levelBefore = save.getUpgradeLevel(id);
    if (!Number.isInteger(levelBefore) || levelBefore < 0) {
        return { ok: false, reason: 'invalid' };
    }
    if (levelBefore >= upgrade.maxLevel) return { ok: false, reason: 'maxed' };
    const cost = nextCost(upgrade, levelBefore);
    const balanceBefore = wallet(save);
    if (balanceBefore < cost) {
        return { ok: false, reason: 'insufficient-coins', cost, balance: balanceBefore };
    }
    if (!save.spendCoins(cost)) {
        return { ok: false, reason: save.getLastSaveFailureReason?.() || 'save-unavailable' };
    }
    if (!save.incrementUpgrade(id)) {
        return { ok: false, reason: 'entitlement-failed' };
    }
    return {
        ok: true,
        kind: 'upgrade',
        id,
        name: upgrade.name,
        cost,
        balanceBefore,
        balanceAfter: wallet(save),
        levelBefore,
        levelAfter: levelBefore + 1,
    };
}

function resolveCosmeticPurchase(save, id) {
    const item = COSMETICS[id];
    if (!item) return { ok: false, reason: 'invalid' };
    if (save.isCosmeticUnlocked(id)) return { ok: false, reason: 'already-owned' };
    const cost = cosmeticCoinCost(item);
    if (!Number.isSafeInteger(cost) || cost <= 0) {
        return { ok: false, reason: 'not-coin-item' };
    }
    const balanceBefore = wallet(save);
    if (balanceBefore < cost) {
        return { ok: false, reason: 'insufficient-coins', cost, balance: balanceBefore };
    }
    if (!save.spendCoins(cost)) {
        return { ok: false, reason: save.getLastSaveFailureReason?.() || 'save-unavailable' };
    }
    if (!save.unlockCosmetic(id)) {
        return { ok: false, reason: 'entitlement-failed' };
    }
    if (!save.equipCosmetic(item.category, id)) {
        return { ok: false, reason: 'equip-failed' };
    }
    return {
        ok: true,
        kind: 'cosmetic',
        id,
        name: item.name,
        category: item.category,
        cost,
        balanceBefore,
        balanceAfter: wallet(save),
    };
}

export function purchasePermanentUpgrade(save, id) {
    return commitEntitlementTransaction(save, (draft) => resolveUpgradePurchase(draft, id));
}

export function purchasePermanentUpgradeAtomic(save, id) {
    return commitEntitlementTransactionAtomic(save, (draft) => resolveUpgradePurchase(draft, id));
}

export function purchaseCoinCosmetic(save, id) {
    return commitEntitlementTransaction(save, (draft) => resolveCosmeticPurchase(draft, id));
}

export function purchaseCoinCosmeticAtomic(save, id) {
    return commitEntitlementTransactionAtomic(save, (draft) => resolveCosmeticPurchase(draft, id));
}
