#!/usr/bin/env node
// Deterministic progression/cosmetic integrity checks. Run from the repo root:
//   node tools/validate-progression.js

// This stays intentionally dependency-free so the static game has no build or
// package-manager requirement.

import assert from 'node:assert/strict';
import {
    BATTLE_PASS_LEVELS, BP_EVERFLAME_COINS, BP_EVERFLAME_XP, BP_MAX_LEVEL,
    PASS_COSMETIC_MILESTONES, bpProgress, bpThreshold, bpXpForLevel,
    migrateBattlePassXpV1,
} from '../src/content/battlePass.js';
import { COSMETICS, COSMETIC_SETS } from '../src/content/cosmetics.js';
import { GEAR } from '../src/content/gear.js';
import {
    awardRun, claim, claimAll, runXp, runXpBreakdown,
} from '../src/systems/BattlePassSystem.js';
import { openCase } from '../src/systems/CaseSystem.js';

// Node 26 exposes an experimental localStorage getter that warns unless a file
// is configured. A tiny in-memory implementation keeps this validator quiet
// while exercising SaveSystem's real persistence calls.
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
} });
const { SaveSystem } = await import('../src/systems/SaveSystem.js');

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

// Curve shape + large-number safety.
check(bpThreshold(1) === 0, 'level 1 threshold must be zero');
check(bpThreshold(BP_MAX_LEVEL) === 24108, 'schema-2 level-50 threshold changed unexpectedly');
for (let level = 1; level < BP_MAX_LEVEL; level++) {
    check(bpXpForLevel(level + 1) >= bpXpForLevel(level), `curve regressed at level ${level}`);
    check(bpThreshold(level + 1) > bpThreshold(level), `threshold is not increasing at level ${level}`);
}
const huge = bpProgress(2 ** 32 + 123);
check(huge.level === BP_MAX_LEVEL && huge.overflowXp > 4_000_000_000, 'large XP wrapped or reset');

// Legacy migration preserves old level and within-level progress (within one
// new-schema XP point of rounding). The test owns the old math so production
// cannot accidentally make its migration self-fulfilling.
function oldProgress(xp) {
    let level = 1, base = 0;
    for (let current = 1; current < BP_MAX_LEVEL; current++) {
        const need = 120 + (current - 1) * 15;
        if (xp < base + need) return { level: current, fraction: (xp - base) / need, overflow: 0 };
        base += need; level = current + 1;
    }
    return { level, fraction: 1, overflow: Math.max(0, xp - base) };
}
for (const xp of [0, 60, 119, 120, 987, 8000, 23519, 23520, 26020]) {
    const before = oldProgress(xp);
    const after = bpProgress(migrateBattlePassXpV1(xp));
    check(after.level === before.level, `legacy migration changed level for ${xp} XP`);
    if (before.level < BP_MAX_LEVEL) {
        check(Math.abs(after.fraction - before.fraction) <= 1 / bpXpForLevel(before.level), `legacy migration lost progress for ${xp} XP`);
    } else {
        check(after.overflowXp === before.overflow, `legacy overflow changed for ${xp} XP`);
    }
}

// Every authored reward resolves, including nested milestone bundles.
function validateReward(reward, level) {
    check(!!reward && typeof reward.type === 'string', `level ${level} has no reward`);
    if (reward.type === 'bundle') {
        check(Array.isArray(reward.rewards) && reward.rewards.length > 1, `level ${level} bundle is empty`);
        for (const part of reward.rewards) validateReward(part, level);
    } else if (reward.type === 'cosmetic') check(!!COSMETICS[reward.itemId], `level ${level} cosmetic is missing`);
    else if (reward.type === 'gear') check(!!GEAR[reward.itemId], `level ${level} gear is missing`);
    else if (reward.type === 'case') check(['basic', 'mystic', 'royal'].includes(reward.caseType), `level ${level} case is invalid`);
    else check(reward.type === 'coins' && reward.amount > 0, `level ${level} reward shape is invalid`);
}
check(BATTLE_PASS_LEVELS.length === BP_MAX_LEVEL, 'pass does not contain 50 levels');
for (const entry of BATTLE_PASS_LEVELS) validateReward(entry.reward, entry.level);

const lastLight = COSMETIC_SETS.find((set) => set.id === 'lastlight');
check(!!lastLight, 'Last Light Regalia set is missing');
for (const [levelText, id] of Object.entries(PASS_COSMETIC_MILESTONES)) {
    const item = COSMETICS[id];
    check(!!item, `pass cosmetic ${id} is missing`);
    check(item.passLevel === Number(levelText), `${id} has the wrong pass level`);
    check(item.caseExcluded === true, `${id} can leak into cases`);
    check(Object.values(lastLight.pieces).includes(id), `${id} is absent from Last Light Regalia`);
}

// XP is transparent, mode-safe and independent of run coins.
const normalRun = { time: 600, kills: 900, bossesDefeated: 2, chestsOpened: 3, finalWave: 6, objectivesCompleted: 2 };
const normal = runXpBreakdown(normalRun);
check(normal.eligible && normal.total > 0, 'a valid run earned no XP');
check(runXp({ time: 10, kills: 2, finalWave: 1 }) === 0, 'an abandoned run earned XP');
check(runXp({ ...normalRun, coinsEarned: 0 }) === runXp({ ...normalRun, coinsEarned: 999999 }), 'coins still distort Vigil XP');
const extreme = runXpBreakdown({ time: 999999, kills: 99999999, bossesDefeated: 999, chestsOpened: 999, finalWave: 999, objectivesCompleted: 999, cleared: true });
check(extreme.endurance <= 240 && extreme.hunt <= 260 && extreme.deeds <= 520, 'run XP caps failed');
const withThreat = runXpBreakdown(normalRun, { bonus: 0.5 });
check(withThreat.threat === Math.round(normal.core * 0.5), 'Threat bonus is not applied to core XP exactly once');
const withDaily = runXpBreakdown({ ...normalRun, dailyVigilXp: 120 }, { bonus: 0.5 });
check(withDaily.total - withThreat.total === 120, 'daily XP was multiplied or dropped');

// Award receipts must describe the state that was actually saved.
const awardSave = {
    xp: 250,
    getBattlePassXp() { return this.xp; },
    addBattlePassXp(amount) { this.xp += amount; return { everflameCaches: 0, everflameCoins: 0 }; },
};
const award = awardRun(awardSave, normalRun, { bonus: 0.5 });
check(award.levelAfter === bpProgress(awardSave.xp).level, 'award receipt level is stale');
check(award.gained === award.breakdown.total, 'award receipt total does not match its buckets');

// Claims reject malformed levels and Claim All preserves player-facing labels.
function claimSave(xp) {
    return {
        xp, coins: 0, claimed: [], cosmetics: new Set(), gear: new Set(),
        getBattlePassXp() { return this.xp; },
        isLevelClaimed(level) { return this.claimed.includes(level); },
        claimLevel(level) { this.claimed.push(level); return true; },
        addCoins(amount) { this.coins += amount; },
        unlockCosmetic(id) { if (this.cosmetics.has(id)) return false; this.cosmetics.add(id); return true; },
        unlockGear(id) { if (this.gear.has(id)) return false; this.gear.add(id); return true; },
    };
}
check(claim(claimSave(999999), 1.5).ok === false, 'fractional claim level was accepted');
const claimResult = claimAll(claimSave(bpThreshold(3)));
check(claimResult.count === 3 && claimResult.labels.length === 3, 'Claim All hid or skipped rewards');

// Save integration: overflow caches pay once, and veteran claimed milestones
// receive the new set without losing old progress.
const save = new SaveSystem();
save.data.totalCoins = 0;
save.data.battlePass.xp = bpThreshold(BP_MAX_LEVEL) + BP_EVERFLAME_XP - 50;
const cacheResult = save.addBattlePassXp(100);
check(cacheResult.everflameCaches === 1, 'Everflame cache did not cross once');
check(cacheResult.everflameCoins === BP_EVERFLAME_COINS && save.data.totalCoins === BP_EVERFLAME_COINS, 'Everflame cache payout is wrong');
const veteran = save._validate({ battlePass: { xp: 2000, claimed: [10, 20, 30, 40, 50] } });
for (const id of Object.values(PASS_COSMETIC_MILESTONES)) check(veteran.cosmetics.unlocked.includes(id), `veteran did not receive ${id}`);

// A fresh free cosmetic case can no longer land on a starter duplicate.
storage.clear();
const fresh = new SaveSystem();
const realRandom = Math.random;
Math.random = () => 0;
const firstCase = openCase(fresh, 'basicCosmetic', { free: true });
Math.random = realRandom;
check(firstCase.ok && firstCase.kind === 'cosmetic', 'deterministic starter cosmetic case did not award an item');
check(!firstCase.name?.toLowerCase().includes('duplicate') && firstCase.kind !== 'duplicate', 'fresh cosmetic case produced a starter duplicate');

console.log(`progression validation: OK — ${checks} deterministic checks passed.`);
