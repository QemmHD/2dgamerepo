// Permanent upgrades purchased between runs and applied at run start.
//
// Each upgrade:
//   id              save key
//   name/description shown on shop cards
//   maxLevel        cap on stacks
//   costAt(level)   coin cost to buy the (level+1)-th stack
//   apply(player, level)
//                   called once at run start with the saved level
//                   (no-op when level is 0)
//
// Add a new entry to expand the shop — no system changes required.

export const PERMANENT_UPGRADES = [
    {
        id: 'maxHp',
        name: 'Greater Ember',
        description: '+5 max HP per level',
        maxLevel: 20,
        costAt(level) { return 8 + level * 4; },
        apply(player, level) {
            const bonus = 5 * level;
            player.maxHp += bonus;
            player.hp = player.maxHp;
        },
    },
    {
        id: 'damage',
        name: 'Brighter Burn',
        description: '+5% weapon damage per level',
        maxLevel: 20,
        costAt(level) { return 10 + level * 5; },
        apply(player, level) {
            player.damageMul *= 1 + 0.05 * level;
        },
    },
    {
        id: 'moveSpeed',
        name: 'Quickstep',
        description: '+3% movement speed per level',
        maxLevel: 15,
        costAt(level) { return 10 + level * 5; },
        apply(player, level) {
            player.speed *= 1 + 0.03 * level;
        },
    },
    {
        id: 'critChance',
        name: 'Keen Ember',
        description: '+1.5% critical strike chance per level',
        maxLevel: 12,
        costAt(level) { return 14 + level * 7; },
        apply(player, level) {
            player.critChance = Math.min(0.8, (player.critChance ?? 0) + 0.015 * level);
        },
    },
    {
        id: 'xpGain',
        name: 'Soulgleam',
        description: '+5% XP from gems per level',
        maxLevel: 20,
        costAt(level) { return 12 + level * 6; },
        apply(player, level) {
            player.xpMultiplier *= 1 + 0.05 * level;
        },
    },
    {
        id: 'pickupRange',
        name: 'Wider Glow',
        description: '+5% gem pickup range per level',
        maxLevel: 15,
        costAt(level) { return 10 + level * 5; },
        apply(player, level) {
            player.pickupRange *= 1 + 0.05 * level;
        },
    },
    {
        id: 'startingCoins',
        name: 'Heirloom Cinders',
        description: '+5 starting run coins per level',
        maxLevel: 10,
        costAt(level) { return 20 + level * 10; },
        apply(player, level) {
            player.coins = (player.coins ?? 0) + 5 * level;
        },
    },
    {
        id: 'rerolls',
        name: 'Second Sight',
        description: '+1 level-up reroll per run, per level',
        maxLevel: 5,
        costAt(level) { return 25 + level * 15; },
        apply(player, level) {
            player.rerolls = (player.rerolls ?? 0) + level;
        },
    },
    {
        id: 'banish',
        name: 'Forsake',
        description: '+1 banish (remove an offered card) per run, per level',
        maxLevel: 3,
        costAt(level) { return 40 + level * 25; },
        apply(player, level) {
            player.banishes = (player.banishes ?? 0) + level;
        },
    },
];

// Apply every owned permanent upgrade exactly once to a freshly-built
// Player. Called from Game._startRun after _initRunState.
export function applyPermanentUpgrades(player, saveData) {
    if (!saveData || !saveData.upgrades) return;
    for (const u of PERMANENT_UPGRADES) {
        const level = saveData.upgrades[u.id] ?? 0;
        if (level > 0) u.apply(player, level);
    }
}

// Cost for the NEXT purchase given the player's current level. Returns
// Infinity once the upgrade is at max level (so the shop UI can render
// "MAX" and refuse purchases).
export function nextCost(upgrade, currentLevel) {
    if (currentLevel >= upgrade.maxLevel) return Infinity;
    return upgrade.costAt(currentLevel);
}
