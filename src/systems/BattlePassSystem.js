// BattlePassSystem — turns runs into "vigil XP", tracks the 50-level track,
// and grants level rewards on claim. Offline only; no monetization.
//
// XP sources are shown as four stable buckets: Kindling (finish), Endurance,
// Hunt and Deeds. Daily Trials and selected Threat modifiers are explicit
// bonuses; coins never distort progression.

import { BATTLE_PASS_LEVELS, BP_MAX_LEVEL, bpProgress } from '../content/battlePass.js';
import { GEAR } from '../content/gear.js';
import { COSMETICS } from '../content/cosmetics.js';
import { rarityDust, rarityName } from '../content/rarities.js';
import { openCase } from './CaseSystem.js';

// The four readable Vigil-XP buckets. Kills/time are capped so an endless or
// spawn-heavy Trial cannot run away with the pass; bosses, chests, objectives,
// and a clear move the player forward without making any single mode mandatory.
export const RUN_XP_RULES = Object.freeze({
    kindling: 60,
    endurancePerSecond: 0.35,
    enduranceCap: 240,
    huntSqrt: 8,
    huntCap: 260,
    boss: 70,
    chest: 18,
    wave: 16,
    objective: 25,
    vigilSite: 12,
    tacticalEncounter: 24,
    guardianPack: 24,
    fourfoldMastery: 36,
    clear: 140,
    bossRushClear: 160,
    deedsCap: 520,
    bonusCap: 2.5,
});

function whole(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function runXpBreakdown(summary, options = {}) {
    if (!summary) return { eligible: false, kindling: 0, endurance: 0, hunt: 0, deeds: 0, livingVigil: 0, trials: 0, core: 0, bonusRate: 0, threat: 0, total: 0 };
    const time = Math.max(0, Number(summary.time) || 0);
    const kills = whole(summary.kills);
    const bosses = whole(summary.bossesDefeated);
    const chests = whole(summary.chestsOpened);
    const wave = Math.max(1, whole(summary.finalWave) || 1);
    const objectives = whole(summary.objectivesCompleted ?? summary.objectivesDone);
    const vigilSites = whole(summary.vigilSitesActivated);
    const siteKinds = whole(summary.vigilSiteKindsMastered);
    const encounters = whole(summary.encountersCleared);
    const guardianPacks = whole(summary.guardianPacksDefeated);
    const cleared = summary.cleared === true || summary.victory === true || bosses >= 3;
    const bossRushClear = summary.bossRushCleared === true;
    const eligible = time >= 30 || kills >= 25 || bosses > 0 || chests > 0 || wave > 1;
    if (!eligible) return { eligible, kindling: 0, endurance: 0, hunt: 0, deeds: 0, livingVigil: 0, trials: 0, core: 0, bonusRate: 0, threat: 0, total: 0 };

    const kindling = RUN_XP_RULES.kindling;
    const endurance = Math.min(RUN_XP_RULES.enduranceCap, Math.floor(time * RUN_XP_RULES.endurancePerSecond));
    const hunt = Math.min(RUN_XP_RULES.huntCap, Math.floor(Math.sqrt(kills) * RUN_XP_RULES.huntSqrt));
    const standardDeeds =
        bosses * RUN_XP_RULES.boss
        + chests * RUN_XP_RULES.chest
        + Math.max(0, wave - 1) * RUN_XP_RULES.wave
        + objectives * RUN_XP_RULES.objective
        + (cleared ? RUN_XP_RULES.clear : 0)
        + (bossRushClear ? RUN_XP_RULES.bossRushClear : 0);
    const livingVigilRaw = vigilSites * RUN_XP_RULES.vigilSite
        + encounters * RUN_XP_RULES.tacticalEncounter
        + guardianPacks * RUN_XP_RULES.guardianPack
        + (siteKinds >= 4 ? RUN_XP_RULES.fourfoldMastery : 0);
    const deedsWithoutVigil = Math.min(RUN_XP_RULES.deedsCap, standardDeeds);
    const deeds = Math.min(RUN_XP_RULES.deedsCap, standardDeeds + livingVigilRaw);
    const livingVigil = deeds - deedsWithoutVigil;
    const trials = whole(summary.dailyVigilXp);
    const core = kindling + endurance + hunt + deeds;
    const bonusRate = Math.min(RUN_XP_RULES.bonusCap, Math.max(0, Number(options.bonus) || 0));
    const threat = Math.round(core * bonusRate);
    return { eligible, kindling, endurance, hunt, deeds, livingVigil, trials, core, bonusRate, threat, total: core + trials + threat };
}

// XP earned from one finished run (compatibility helper used by tests/tools).
export function runXp(summary, options = {}) {
    return runXpBreakdown(summary, options).total;
}

// Normalize the player-facing receipt into additive XP buckets. Waylight is a
// disclosed slice of Deeds, never a fifth plus-sign bucket; this structure lets
// every renderer show that relationship without visually double-counting it.
export function battlePassRunReceipt(result) {
    const breakdown = result?.breakdown;
    if (!breakdown) return null;
    const kindling = whole(breakdown.kindling);
    const endurance = whole(breakdown.endurance);
    const hunt = whole(breakdown.hunt);
    const deeds = whole(breakdown.deeds);
    const trials = whole(breakdown.trials);
    const threat = whole(breakdown.threat);
    const gained = whole(result.gained ?? breakdown.total);
    const additiveTotal = kindling + endurance + hunt + deeds + trials + threat;
    return {
        gained,
        additiveTotal,
        reconciles: gained === additiveTotal,
        kindling,
        endurance,
        hunt,
        deeds,
        trials,
        threat,
        waylightWithinDeeds: Math.min(deeds, whole(breakdown.livingVigil)),
    };
}

// Fold a run into the battle-pass track. Returns a summary of the gain.
export function awardRun(save, summary, options = {}) {
    const before = bpProgress(save.getBattlePassXp());
    const breakdown = runXpBreakdown(summary, options);
    const gained = breakdown.total;
    const saveResult = gained > 0 ? (save.addBattlePassXp(gained) || {}) : {};
    const after = bpProgress(save.getBattlePassXp());
    const crossedLevels = [];
    for (let level = before.level + 1; level <= after.level; level++) crossedLevels.push(level);
    return {
        gained,
        levelBefore: before.level,
        levelAfter: after.level,
        leveledUp: after.level > before.level,
        crossedLevels,
        breakdown,
        everflameCaches: saveResult.everflameCaches || 0,
        everflameCoins: saveResult.everflameCoins || 0,
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
    if (reward.type === 'bundle') {
        return (reward.rewards || []).map(rewardLabel).filter(Boolean).join(' + ');
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
            const amount = rarityDust(c.rarity);
            save.addCoins(amount);
            return `${c.name} owned → +${amount} coins`;
        }
        case 'gear': {
            const g = GEAR[reward.itemId];
            if (!g) return '';
            if (save.unlockGear(reward.itemId)) return `Unlocked ${g.name}`;
            const amount = rarityDust(g.rarity);
            save.addCoins(amount);
            return `${g.name} owned → +${amount} coins`;
        }
        case 'bundle':
            return (reward.rewards || []).map((part) => grantReward(save, part)).filter(Boolean).join(' · ');
        default:
            return '';
    }
}

// Claim a single reached level. Returns { ok, label } or { ok:false }.
export function claim(save, level) {
    if (!Number.isInteger(level) || level < 1 || level > BP_MAX_LEVEL) return { ok: false, reason: 'invalid' };
    const { level: reached } = bpProgress(save.getBattlePassXp());
    if (level > reached) return { ok: false, reason: 'locked' };
    if (save.isLevelClaimed(level)) return { ok: false, reason: 'claimed' };
    const entry = BATTLE_PASS_LEVELS[level - 1];
    const label = grantReward(save, entry.reward);
    save.claimLevel(level);
    return { ok: true, label };
}

// Claim every reached-but-unclaimed level. Preserve the individual labels so
// the caller can tell the player what cases/items/duplicates were actually won.
export function claimAll(save) {
    const labels = [];
    for (const lvl of claimableLevels(save)) {
        const result = claim(save, lvl);
        if (result.ok) labels.push(result.label);
    }
    return { count: labels.length, labels };
}
