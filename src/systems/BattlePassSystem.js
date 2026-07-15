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
import {
    commitEntitlementTransaction,
    commitEntitlementTransactionAtomic,
} from './EntitlementTransaction.js';

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
    // The old hidden system could tick up to 16 parallel thresholds. The Run
    // Path now has exactly three more meaningful phases, so each carries a
    // slightly stronger disclosed deed (3/3 = 105 XP before the deeds cap).
    objective: 35,
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
    const xpBefore = save.getBattlePassXp();
    const before = bpProgress(xpBefore);
    const breakdown = runXpBreakdown(summary, options);
    const attempted = breakdown.total;
    const saveResult = attempted > 0 ? (save.addBattlePassXp(attempted) || {}) : {};
    const xpAfter = save.getBattlePassXp();
    // The receipt is about durable progress, not the authored award. Whole-save
    // persistence can fail or reject a stale tab; in that case XP is unchanged
    // and every results surface must say +0 rather than celebrating an award
    // that vanished. Deriving the value from the accepted before/after state
    // also preserves the lightweight dependency-injected validator seam.
    const gained = Math.max(0, Math.floor(xpAfter) - Math.floor(xpBefore));
    const after = bpProgress(xpAfter);
    const crossedLevels = [];
    for (let level = before.level + 1; level <= after.level; level++) crossedLevels.push(level);
    return {
        gained,
        levelBefore: before.level,
        levelAfter: after.level,
        leveledUp: after.level > before.level,
        crossedLevels,
        breakdown,
        attempted,
        persisted: gained === attempted,
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

// Structured reward resolver. A failed free case remains a failure so its
// level marker cannot be committed without the randomized reward.
function grantRewardToDraft(save, reward) {
    if (!reward) return { ok: false, reason: 'invalid' };
    switch (reward.type) {
        case 'coins':
            save.addCoins(reward.amount);
            return { ok: true, label: `+${reward.amount} coins` };
        case 'case': {
            const result = openCase(save, reward.caseType, { free: true });
            return result.ok
                ? { ok: true, label: `Case: ${result.label}` }
                : { ok: false, reason: result.reason || 'save-unavailable' };
        }
        case 'cosmetic': {
            const item = COSMETICS[reward.itemId];
            if (!item) return { ok: false, reason: 'invalid' };
            if (save.unlockCosmetic(reward.itemId)) {
                return { ok: true, label: `Unlocked ${item.name}` };
            }
            const amount = rarityDust(item.rarity);
            save.addCoins(amount);
            return { ok: true, label: `${item.name} owned → +${amount} coins` };
        }
        case 'gear': {
            const item = GEAR[reward.itemId];
            if (!item) return { ok: false, reason: 'invalid' };
            if (save.unlockGear(reward.itemId)) {
                return { ok: true, label: `Unlocked ${item.name}` };
            }
            const amount = rarityDust(item.rarity);
            save.addCoins(amount);
            return { ok: true, label: `${item.name} owned → +${amount} coins` };
        }
        case 'bundle': {
            const labels = [];
            for (const part of reward.rewards || []) {
                const granted = grantRewardToDraft(save, part);
                if (!granted.ok) return granted;
                if (granted.label) labels.push(granted.label);
            }
            return { ok: true, label: labels.join(' · ') };
        }
        default:
            return { ok: false, reason: 'invalid' };
    }
}

function resolveClaimOnDraft(save, level) {
    if (!Number.isInteger(level) || level < 1 || level > BP_MAX_LEVEL) {
        return { ok: false, reason: 'invalid' };
    }
    const { level: reached } = bpProgress(save.getBattlePassXp());
    if (level > reached) return { ok: false, reason: 'locked' };
    if (save.isLevelClaimed(level)) return { ok: false, reason: 'claimed' };
    if (!save.claimLevel(level)) return { ok: false, reason: 'claimed' };
    const granted = grantRewardToDraft(save, BATTLE_PASS_LEVELS[level - 1].reward);
    return granted.ok ? { ok: true, label: granted.label, level } : granted;
}

// Deterministic/internal synchronous seam. Browser UI must use claimAtomic so
// another live participant cannot enter the read-to-write interval.
export function claim(save, level) {
    if (!Number.isInteger(level) || level < 1 || level > BP_MAX_LEVEL) return { ok: false, reason: 'invalid' };
    const { level: reached } = bpProgress(save.getBattlePassXp());
    if (level > reached) return { ok: false, reason: 'locked' };
    if (save.isLevelClaimed(level)) return { ok: false, reason: 'claimed' };
    const entry = BATTLE_PASS_LEVELS[level - 1];

    // Claim marker and all reward effects share one final write. Free-case RNG
    // happens only on the detached draft; failed/stale commits restore the live
    // object so retrying cannot duplicate a previously granted case.
    if (save?.data && typeof save.save === 'function') {
        return commitEntitlementTransaction(save, (draft) => (
            resolveClaimOnDraft(draft, level)
        ));
    }

    // Preserve the lightweight dependency-injected validator seam.
    const granted = grantRewardToDraft(save, entry.reward);
    if (!granted.ok) return granted;
    if (!save.claimLevel(level)) return { ok: false, reason: 'claimed' };
    return { ok: true, label: granted.label };
}

// Production browser entrypoint. Eligibility is re-checked only after this tab
// owns the exclusive save boundary, so a contending participant cannot race a
// claim marker, reward roll, or final write.
export function claimAtomic(save, level) {
    return commitEntitlementTransactionAtomic(save, (draft) => (
        resolveClaimOnDraft(draft, level)
    ));
}

// Deterministic/internal Claim All seam. Preserve individual labels for tests
// and non-browser tools; production menu actions use claimAllAtomic below.
export function claimAll(save) {
    const labels = [];
    for (const lvl of claimableLevels(save)) {
        const result = claim(save, lvl);
        if (result.ok) labels.push(result.label);
    }
    return { count: labels.length, labels };
}

export function claimAllAtomic(save) {
    return commitEntitlementTransactionAtomic(save, (draft) => {
        const levels = claimableLevels(draft);
        if (!levels.length) {
            return { ok: false, reason: 'nothing-to-claim', count: 0, labels: [] };
        }
        const labels = [];
        for (const level of levels) {
            const result = resolveClaimOnDraft(draft, level);
            if (!result.ok) return result;
            labels.push(result.label);
        }
        return {
            ok: true,
            count: labels.length,
            labels: Object.freeze(labels),
        };
    });
}
