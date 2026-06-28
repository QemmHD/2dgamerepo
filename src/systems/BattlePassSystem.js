// BattlePassSystem — turns runs into "vigil XP", tracks the 50-level track,
// and grants level rewards on claim. Offline only; no monetization.
//
// XP sources (all from the run summary): survival time, kills, bosses, coins
// earned, and chests opened. Tuned so a solid run advances a few levels early
// and the curve stretches toward 50.

import { BATTLE_PASS_LEVELS, BP_MAX_LEVEL, bpProgress } from '../content/battlePass.js';
import { GEAR } from '../content/gear.js';
import { COSMETICS } from '../content/cosmetics.js';
import { rarityName } from '../content/rarities.js';
import { openCase } from './CaseSystem.js';

// XP earned from one finished run.
export function runXp(summary) {
    if (!summary) return 0;
    const time = Math.max(0, summary.time ?? 0);
    const kills = Math.max(0, summary.kills ?? 0);
    const bosses = Math.max(0, summary.bossesDefeated ?? 0);
    const coins = Math.max(0, summary.coinsEarned ?? 0);
    const chests = Math.max(0, summary.chestsOpened ?? 0);
    return Math.floor(time * 0.6 + kills * 1.2 + bosses * 30 + coins * 0.5 + chests * 12);
}

// Fold a run into the battle-pass track. Returns a summary of the gain.
export function awardRun(save, summary) {
    const before = bpProgress(save.getBattlePassXp());
    const gained = runXp(summary);
    if (gained > 0) save.addBattlePassXp(gained);
    const after = bpProgress(save.getBattlePassXp());
    return {
        gained,
        levelBefore: before.level,
        levelAfter: after.level,
        leveledUp: after.level > before.level,
    };
}

// Levels the player has REACHED but not yet claimed.
export function claimableLevels(save) {
    const { level } = bpProgress(save.getBattlePassXp());
    const out = [];
    for (let lvl = 1; lvl <= level; lvl++) {
        if (!save.isLevelClaimed(lvl)) out.push(lvl);
    }
    return out;
}

// Resolve a reward's display name (item rewards reference cosmetics/gear).
export function rewardLabel(reward) {
    if (!reward) return '';
    if (reward.type === 'coins') return `${reward.amount} coins`;
    if (reward.type === 'case') return `${reward.caseType} case`;
    if (reward.type === 'cosmetic') {
        const c = COSMETICS[reward.itemId];
        return c ? `${rarityName(c.rarity)} ${c.name}` : 'Cosmetic';
    }
    if (reward.type === 'gear') {
        const g = GEAR[reward.itemId];
        return g ? `${rarityName(g.rarity)} ${g.name}` : 'Gear';
    }
    return '';
}

// Apply a reward's effects to the save. Duplicates (already-owned item) fall
// back to coins so a claim is never wasted. Returns a short result label.
function grantReward(save, reward) {
    if (!reward) return '';
    switch (reward.type) {
        case 'coins':
            save.addCoins(reward.amount);
            return `+${reward.amount} coins`;
        case 'case': {
            const r = openCase(save, reward.caseType, { free: true });
            return r.ok ? `Case: ${r.label}` : 'Case';
        }
        case 'cosmetic': {
            const c = COSMETICS[reward.itemId];
            if (!c) return '';
            if (save.unlockCosmetic(reward.itemId)) return `Unlocked ${c.name}`;
            save.addCoins(40);
            return `${c.name} owned → +40 coins`;
        }
        case 'gear': {
            const g = GEAR[reward.itemId];
            if (!g) return '';
            if (save.unlockGear(reward.itemId)) return `Unlocked ${g.name}`;
            save.addCoins(40);
            return `${g.name} owned → +40 coins`;
        }
        default:
            return '';
    }
}

// Claim a single reached level. Returns { ok, label } or { ok:false }.
export function claim(save, level) {
    if (level < 1 || level > BP_MAX_LEVEL) return { ok: false };
    const { level: reached } = bpProgress(save.getBattlePassXp());
    if (level > reached) return { ok: false, reason: 'locked' };
    if (save.isLevelClaimed(level)) return { ok: false, reason: 'claimed' };
    const entry = BATTLE_PASS_LEVELS[level - 1];
    const label = grantReward(save, entry.reward);
    save.claimLevel(level);
    return { ok: true, label };
}

// Claim every reached-but-unclaimed level. Returns the number claimed.
export function claimAll(save) {
    let n = 0;
    for (const lvl of claimableLevels(save)) {
        if (claim(save, lvl).ok) n++;
    }
    return n;
}
