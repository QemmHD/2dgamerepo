// Battle Pass — a 50-level offline progression track.
//
// NOT monetized: battle-pass XP ("vigil XP") is earned only by playing runs.
// Each level has one data-driven reward. Levels and the XP curve are computed
// here so the system/UI stay dumb: ask bpProgress(totalXp) for the current
// level + bar fill, and read BATTLE_PASS_LEVELS[i].reward to grant a level.
//
// Reward shapes:
//   { type: 'coins',    amount }
//   { type: 'cosmetic', itemId }   // id into COSMETICS
//   { type: 'gear',     itemId }   // id into GEAR
//   { type: 'case',     caseType } // 'basic' | 'mystic' | 'royal'

export const BP_MAX_LEVEL = 50;

// XP to advance FROM `level` to `level+1`. Gentle ramp so 50 is a long haul
// but every run moves the bar. Level 1 is reached at 0 XP.
export function bpXpForLevel(level) {
    if (level >= BP_MAX_LEVEL) return Infinity;
    return 120 + (level - 1) * 15;
}

// Cumulative XP required to REACH a given level (threshold(1) === 0).
const THRESHOLDS = (() => {
    const t = [0, 0]; // index by level; level 1 → 0
    for (let lvl = 2; lvl <= BP_MAX_LEVEL; lvl++) {
        t[lvl] = t[lvl - 1] + bpXpForLevel(lvl - 1);
    }
    return t;
})();

export function bpThreshold(level) {
    return THRESHOLDS[Math.max(1, Math.min(BP_MAX_LEVEL, level))] ?? 0;
}

// Given total accumulated XP, return current level + progress within it.
export function bpProgress(totalXp) {
    const xp = Math.max(0, totalXp | 0);
    let level = 1;
    for (let lvl = 1; lvl <= BP_MAX_LEVEL; lvl++) {
        if (xp >= THRESHOLDS[lvl]) level = lvl; else break;
    }
    const atMax = level >= BP_MAX_LEVEL;
    const base = THRESHOLDS[level];
    const need = atMax ? 0 : bpXpForLevel(level);
    const into = atMax ? 0 : xp - base;
    return { level, atMax, levelXp: into, levelNeed: need, fraction: atMax ? 1 : (need > 0 ? into / need : 0) };
}

// Milestone unlocks (valid ids in cosmetics.js / gear.js). The remaining
// locked items are obtainable from cases, so the pass need not grant them all.
const COSMETIC_MILESTONES = { 5: 'trail_sparks', 15: 'fur_ember', 25: 'aura_frost', 35: 'cloak_crimson', 45: 'fur_frost' };
const GEAR_MILESTONES = { 10: 'a_cinderplate', 20: 't_gleamloop', 30: 'w_beacon', 40: 'a_pyreguard' };

function rewardForLevel(level) {
    if (level === BP_MAX_LEVEL) return { type: 'cosmetic', itemId: 'aura_mythic', special: true };
    if (GEAR_MILESTONES[level]) return { type: 'gear', itemId: GEAR_MILESTONES[level] };
    if (COSMETIC_MILESTONES[level]) return { type: 'cosmetic', itemId: COSMETIC_MILESTONES[level] };
    if (level % 12 === 0) return { type: 'case', caseType: level >= 36 ? 'royal' : level >= 18 ? 'mystic' : 'basic' };
    return { type: 'coins', amount: 30 + level * 5 };
}

export const BATTLE_PASS_LEVELS = Array.from({ length: BP_MAX_LEVEL }, (_, i) => {
    const level = i + 1;
    return { level, reward: rewardForLevel(level) };
});

// Short label for a reward (UI helper). Item names are resolved by the caller
// (which imports the cosmetics/gear tables) to avoid a circular dependency.
export function rewardShortType(reward) {
    if (!reward) return '';
    if (reward.type === 'coins') return `${reward.amount} coins`;
    if (reward.type === 'case') return `${reward.caseType} case`;
    if (reward.type === 'cosmetic') return 'cosmetic';
    if (reward.type === 'gear') return 'gear';
    return '';
}
