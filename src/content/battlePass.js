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
//   { type: 'bundle',   rewards }  // two or more of the shapes above

export const BP_MAX_LEVEL = 50;
export const BP_SCHEMA = 2;
export const BP_EVERFLAME_XP = 1000;
export const BP_EVERFLAME_COINS = 250;

// XP to advance FROM `level` to `level+1`. Schema 2 smooths the old curve:
// early levels are real milestones instead of arriving in a first-run flood,
// while late levels flatten enough that the final stretch does not become a
// grind wall. Total to level 50 is 24,108 (old schema: 23,520).
export function bpXpForLevel(level) {
    if (level >= BP_MAX_LEVEL) return Infinity;
    return 300 + (level - 1) * 8;
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

function safeXp(totalXp) {
    if (!Number.isFinite(totalXp) || totalXp <= 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(totalXp));
}

// Schema-1 progress is retained solely for the one-time save migration. It is
// deliberately local to the pass module so SaveSystem never duplicates curve
// math and veteran saves preserve both their level and within-level fraction.
function legacyProgress(totalXp) {
    const xp = safeXp(totalXp);
    let level = 1;
    let base = 0;
    for (let lvl = 1; lvl < BP_MAX_LEVEL; lvl++) {
        const need = 120 + (lvl - 1) * 15;
        if (xp < base + need) {
            return { level: lvl, atMax: false, fraction: need > 0 ? (xp - base) / need : 0, maxThreshold: null };
        }
        base += need;
        level = lvl + 1;
    }
    return { level, atMax: true, fraction: 1, maxThreshold: base, overflow: Math.max(0, xp - base) };
}

export function migrateBattlePassXpV1(totalXp) {
    const old = legacyProgress(totalXp);
    if (old.atMax) return bpThreshold(BP_MAX_LEVEL) + (old.overflow || 0);
    return bpThreshold(old.level) + Math.floor(bpXpForLevel(old.level) * old.fraction);
}

// Given total accumulated XP, return current level + progress within it.
export function bpProgress(totalXp) {
    const xp = safeXp(totalXp);
    let level = 1;
    for (let lvl = 1; lvl <= BP_MAX_LEVEL; lvl++) {
        if (xp >= THRESHOLDS[lvl]) level = lvl; else break;
    }
    const atMax = level >= BP_MAX_LEVEL;
    const base = THRESHOLDS[level];
    const need = atMax ? 0 : bpXpForLevel(level);
    const into = atMax ? 0 : xp - base;
    const overflowXp = atMax ? Math.max(0, xp - base) : 0;
    return {
        level,
        atMax,
        levelXp: into,
        levelNeed: need,
        fraction: atMax ? 1 : (need > 0 ? into / need : 0),
        overflowXp,
        everflameRank: Math.floor(overflowXp / BP_EVERFLAME_XP),
        everflameXp: overflowXp % BP_EVERFLAME_XP,
        everflameNeed: BP_EVERFLAME_XP,
        everflameFraction: (overflowXp % BP_EVERFLAME_XP) / BP_EVERFLAME_XP,
    };
}

// Milestone unlocks (valid ids in cosmetics.js / gear.js). The existing gear
// and cosmetic rewards stay in place for save continuity. Four gear milestones
// now bundle a deterministic Last Light set piece; level 50 completes the set.
const COSMETIC_MILESTONES = Object.freeze({
    5: 'trail_sparks',
    15: 'fur_ember',
    25: 'aura_frost',
    35: 'cloak_crimson',
    45: 'fur_frost',
});
const GEAR_MILESTONES = { 10: 'a_cinderplate', 20: 't_gleamloop', 30: 'w_lightningwand', 40: 'a_pyreguard' };
export const PASS_COSMETIC_MILESTONES = Object.freeze({
    10: 'fur_vigil',
    20: 'cloak_vigil',
    30: 'hat_vigil',
    40: 'trail_vigil',
    50: 'aura_mythic',
});

// Complete deterministic cosmetic route for migration/completion truth. Keep
// PASS_COSMETIC_MILESTONES above as the stable Last Light set API; this map
// adds the five legacy odd-level rewards without changing reward tables.
export const ALL_PASS_COSMETIC_MILESTONES = Object.freeze({
    5: COSMETIC_MILESTONES[5],
    10: PASS_COSMETIC_MILESTONES[10],
    15: COSMETIC_MILESTONES[15],
    20: PASS_COSMETIC_MILESTONES[20],
    25: COSMETIC_MILESTONES[25],
    30: PASS_COSMETIC_MILESTONES[30],
    35: COSMETIC_MILESTONES[35],
    40: PASS_COSMETIC_MILESTONES[40],
    45: COSMETIC_MILESTONES[45],
    50: PASS_COSMETIC_MILESTONES[50],
});

function rewardForLevel(level) {
    if (level === BP_MAX_LEVEL) return { type: 'cosmetic', itemId: PASS_COSMETIC_MILESTONES[level], special: true };
    const milestone = [];
    if (GEAR_MILESTONES[level]) milestone.push({ type: 'gear', itemId: GEAR_MILESTONES[level] });
    if (PASS_COSMETIC_MILESTONES[level]) milestone.push({ type: 'cosmetic', itemId: PASS_COSMETIC_MILESTONES[level], special: true });
    if (milestone.length > 1) return { type: 'bundle', rewards: milestone, special: true };
    if (milestone.length === 1) return milestone[0];
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
    if (reward.type === 'bundle') return `${reward.rewards?.length ?? 0} rewards`;
    return '';
}
