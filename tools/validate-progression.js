#!/usr/bin/env node
// Deterministic progression/cosmetic integrity checks. Run from the repo root:
//   node tools/validate-progression.js

// This stays intentionally dependency-free so the static game has no build or
// package-manager requirement.

import assert from 'node:assert/strict';
import {
    ALL_PASS_COSMETIC_MILESTONES, BATTLE_PASS_LEVELS, BP_EVERFLAME_COINS, BP_EVERFLAME_XP, BP_MAX_LEVEL,
    PASS_COSMETIC_MILESTONES, bpProgress, bpThreshold, bpXpForLevel,
    migrateBattlePassXpV1,
} from '../src/content/battlePass.js';
import { ACHIEVEMENTS } from '../src/content/achievements.js';
import {
    COSMETICS,
    COSMETIC_ACQUISITION_ROUTES,
    COSMETIC_BLUEPRINT_COST,
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_CATEGORIES,
    COSMETIC_LIST,
    COSMETIC_SETS,
    cosmeticById,
    cosmeticBlueprintCost,
    cosmeticCoinCost,
    cosmeticsForAchievement,
    getCosmeticAcquisitionRoutes,
    getCosmeticSourceLabel,
    resolveAppearance,
} from '../src/content/cosmetics.js';
import { GEAR } from '../src/content/gear.js';
import { CHARACTER_IDS } from '../src/content/characters.js';
import { PERMANENT_UPGRADES } from '../src/content/permanentUpgrades.js';
import { ATTUNABLE, attuneCost } from '../src/content/relics.js';
import { DAILY_POOL, challengeProgress, pickDailyChallenges } from '../src/content/dailyChallenges.js';
import { OBJECTIVES } from '../src/content/objectives.js';
import {
    awardRun, battlePassRunReceipt, claim, claimAll, runXp, runXpBreakdown,
} from '../src/systems/BattlePassSystem.js';
import { openCase } from '../src/systems/CaseSystem.js';
import { applyLoadout, resolveStartingWeapon } from '../src/systems/LoadoutSystem.js';

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
const expectedAllPassCosmetics = {
    5: 'trail_sparks', 10: 'fur_vigil', 15: 'fur_ember', 20: 'cloak_vigil',
    25: 'aura_frost', 30: 'hat_vigil', 35: 'cloak_crimson', 40: 'trail_vigil',
    45: 'fur_frost', 50: 'aura_mythic',
};
check(Object.isFrozen(ALL_PASS_COSMETIC_MILESTONES), 'all-pass cosmetic milestone map is mutable');
check(JSON.stringify(ALL_PASS_COSMETIC_MILESTONES) === JSON.stringify(expectedAllPassCosmetics),
    'all-pass cosmetic milestone map no longer covers the exact ten authored rewards');
for (const [levelText, id] of Object.entries(ALL_PASS_COSMETIC_MILESTONES)) {
    const level = Number(levelText);
    const item = COSMETICS[id];
    check(item?.passLevel === level, `${id} does not disclose its real Vigil level ${level}`);
    const reward = BATTLE_PASS_LEVELS[level - 1]?.reward;
    const rewardIds = reward?.type === 'bundle'
        ? reward.rewards.filter((part) => part.type === 'cosmetic').map((part) => part.itemId)
        : reward?.type === 'cosmetic' ? [reward.itemId] : [];
    check(rewardIds.includes(id), `Vigil level ${level} does not actually award ${id}`);
}

// Content ids and dictionary keys are persistence contracts. Duplicate or
// mismatched ids make old saves ambiguous, so validate them before route-level
// progression checks.
const cosmeticIds = [];
for (const [key, item] of Object.entries(COSMETICS)) {
    check(item.id === key, `cosmetic key ${key} does not match id ${item.id}`);
    check(COSMETIC_CATEGORIES.includes(item.category), `${item.id} has unsupported category ${item.category}`);
    cosmeticIds.push(item.id);
}
check(new Set(cosmeticIds).size === cosmeticIds.length, 'cosmetic ids are not unique');
const achievementIds = ACHIEVEMENTS.map((achievement) => achievement.id);
check(new Set(achievementIds).size === achievementIds.length, 'achievement ids are not unique');
const cosmeticSetIds = COSMETIC_SETS.map((set) => set.id);
check(new Set(cosmeticSetIds).size === cosmeticSetIds.length, 'cosmetic set ids are not unique');
for (const set of COSMETIC_SETS) {
    check(typeof set.id === 'string' && !!set.id && typeof set.name === 'string' && !!set.name,
        'cosmetic set is missing a stable id/name');
    const categories = Object.keys(set.pieces || {});
    check(categories.length === COSMETIC_CATEGORIES.length
        && COSMETIC_CATEGORIES.every((category) => categories.includes(category)),
    `${set.id} does not contain exactly one piece per cosmetic category`);
    for (const category of COSMETIC_CATEGORIES) {
        const item = cosmeticById(set.pieces?.[category]);
        check(!!item && item.category === category,
            `${set.id}.${category} does not resolve to a matching catalog item`);
    }
}

// I-A established rig-safe reachability; I-B adds a separate 30-piece,
// six-set material/silhouette pack. Counts, routes and complete-set identities
// are persistence/UI contracts rather than incidental menu presentation.
check(COSMETIC_LIST.length === 103, 'Collection Growth I-B must contain exactly 103 cosmetics');
const expectedCategoryCounts = { fur: 18, cloak: 20, hat: 22, aura: 21, trail: 22 };
for (const category of COSMETIC_CATEGORIES) {
    const actual = COSMETIC_LIST.filter((item) => item.category === category).length;
    check(actual === expectedCategoryCounts[category],
        `${category} catalog count ${actual} does not match ${expectedCategoryCounts[category]}`);
}
check(COSMETIC_SETS.length === 15, 'Collection Growth I-B must contain exactly fifteen complete sets');
check(JSON.stringify(COSMETIC_ACQUISITION_ROUTES)
    === JSON.stringify(['starter', 'boutique', 'blueprint', 'case', 'achievement', 'vigil']),
'cosmetic acquisition-route ids/order changed');
check(Object.isFrozen(COSMETIC_ACQUISITION_ROUTES), 'cosmetic acquisition routes are mutable');
for (const item of COSMETIC_LIST) {
    const routes = getCosmeticAcquisitionRoutes(item);
    const again = getCosmeticAcquisitionRoutes(item.id);
    check(Object.isFrozen(routes), `${item.id} acquisition routes are mutable`);
    check(routes.length > 0, `${item.id} has no valid acquisition route`);
    check(JSON.stringify(routes) === JSON.stringify(again), `${item.id} routes differ by item/id lookup`);
    check(routes.every((route) => COSMETIC_ACQUISITION_ROUTES.includes(route)),
        `${item.id} exposes an unknown acquisition route`);
    check(new Set(routes).size === routes.length, `${item.id} repeats an acquisition route`);
    check(!item.caseExcluded || !routes.includes('case'), `${item.id} ignores caseExcluded`);
    check(!item.defaultUnlocked || (routes.length === 1 && routes[0] === 'starter'),
        `${item.id} starter route leaks into another acquisition path`);
    check(getCosmeticSourceLabel(item).length > 0, `${item.id} has no source label`);
}
check(cosmeticById('__proto__') === null && cosmeticById('constructor') === null
    && cosmeticById(null) === null, 'prototype/non-string cosmetic ids resolve as catalog items');
check(getCosmeticAcquisitionRoutes('__proto__').length === 0
    && getCosmeticSourceLabel('__proto__') === '', 'unknown cosmetics expose acquisition copy');
check(JSON.stringify(getCosmeticAcquisitionRoutes('fur_natural')) === JSON.stringify(['starter'])
    && getCosmeticSourceLabel('fur_natural') === 'Starter',
'starter cosmetic acquisition copy changed');
check(JSON.stringify(getCosmeticAcquisitionRoutes('fur_ashen'))
    === JSON.stringify(['boutique', 'case'])
    && getCosmeticSourceLabel('fur_ashen') === 'Boutique · Case',
'boutique/case alternate acquisition copy changed');
check(JSON.stringify(getCosmeticAcquisitionRoutes('fur_void'))
    === JSON.stringify(['case', 'achievement']), 'mixed achievement/case route order changed');
check(getCosmeticSourceLabel('fur_void') === 'Achievement · Case',
    'mixed source label does not prioritize the authored route');
check(JSON.stringify(getCosmeticAcquisitionRoutes('fur_vigil')) === JSON.stringify(['vigil'])
    && getCosmeticSourceLabel('fur_vigil') === 'Vigil Path',
'Vigil Path cosmetic acquisition copy changed');
check(COSMETIC_BLUEPRINT_COST === 72000, 'fixed Blueprint price changed');
check(Object.isFrozen(COSMETIC_BLUEPRINT_IDS)
    && JSON.stringify(COSMETIC_BLUEPRINT_IDS) === JSON.stringify(['aura_gloam_moths', 'aura_requiem']),
'Blueprint allowlist is mutable or no longer the exact two authored Mythics');
for (const id of COSMETIC_BLUEPRINT_IDS) {
    check(cosmeticBlueprintCost(id) === COSMETIC_BLUEPRINT_COST, `${id} has the wrong Blueprint price`);
    check(JSON.stringify(getCosmeticAcquisitionRoutes(id)) === JSON.stringify(['blueprint', 'case']),
        `${id} lost its fixed Blueprint plus random Case routes`);
    check(getCosmeticSourceLabel(id) === 'Blueprint · Case', `${id} has misleading acquisition copy`);
}
check(cosmeticBlueprintCost('fur_galaxy') === 0 && cosmeticBlueprintCost('__unknown__') === 0,
    'non-Blueprint cosmetics expose a Blueprint price');

const collectionGrowthCoinPieces = {
    cloak_splitwatch: { category: 'cloak', rarity: 'rare', rawCoinCost: 900, displayCost: 1800, key: 'cloakStyle', value: 'splitwatch' },
    hat_waylantern: { category: 'hat', rarity: 'epic', rawCoinCost: 1400, displayCost: 2800, key: 'shape', value: 'waylantern' },
    aura_oathwheel: { category: 'aura', rarity: 'legendary', rawCoinCost: 2400, displayCost: 4800, key: 'fx', value: 'oathwheel' },
    trail_waymarks: { category: 'trail', rarity: 'epic', rawCoinCost: 1500, displayCost: 3000, key: 'fx', value: 'waymarks' },
};
const collectionGrowthCasePieces = {
    cloak_mothwing: { category: 'cloak', rarity: 'legendary', key: 'cloakStyle', value: 'mothwing' },
    hat_mothmask: { category: 'hat', rarity: 'epic', key: 'shape', value: 'mothmask' },
    trail_gloam_wisps: { category: 'trail', rarity: 'rare', key: 'fx', value: 'gloam_wisps' },
};
for (const [id, contract] of Object.entries(collectionGrowthCoinPieces)) {
    const item = COSMETICS[id];
    check(!!item, `${id} is missing`);
    check(item.category === contract.category && item.rarity === contract.rarity,
        `${id} category/rarity contract changed`);
    check(item.coinCost === contract.rawCoinCost && cosmeticCoinCost(item) === contract.displayCost
        && item.caseExcluded === true,
        `${id} is not Boutique-only at its authored price`);
    check(item[contract.key] === contract.value, `${id} lost its distinct visual vocabulary`);
    check(JSON.stringify(getCosmeticAcquisitionRoutes(item)) === JSON.stringify(['boutique']),
        `${id} has a competing acquisition route`);
    check(getCosmeticSourceLabel(item) === 'Boutique', `${id} has the wrong source label`);
}
check(Object.values(collectionGrowthCoinPieces)
    .reduce((sum, contract) => sum + contract.rawCoinCost, 0) === 6200,
'Collection Growth raw Boutique prices no longer total 6,200');
check(Object.keys(collectionGrowthCoinPieces)
    .reduce((sum, id) => sum + cosmeticCoinCost(COSMETICS[id]), 0) === 12400,
'Collection Growth displayed/spent Boutique prices no longer total 12,400');
for (const [id, contract] of Object.entries(collectionGrowthCasePieces)) {
    const item = COSMETICS[id];
    check(!!item, `${id} is missing`);
    check(item.category === contract.category && item.rarity === contract.rarity,
        `${id} category/rarity contract changed`);
    check(item.coinCost == null && item.achievement == null && item.passLevel == null
        && item.defaultUnlocked !== true && item.caseExcluded !== true,
    `${id} is not case-only`);
    check(item[contract.key] === contract.value, `${id} lost its distinct visual vocabulary`);
    check(JSON.stringify(getCosmeticAcquisitionRoutes(item)) === JSON.stringify(['case']),
        `${id} has a competing acquisition route`);
    check(getCosmeticSourceLabel(item) === 'Case', `${id} has the wrong source label`);
}

const collectionGrowthSets = {
    lanternward: {
        name: 'Lanternward', fur: 'fur_waylight', cloak: 'cloak_splitwatch',
        hat: 'hat_waylantern', aura: 'aura_oathwheel', trail: 'trail_waymarks',
    },
    duskmoth: {
        name: 'Duskmoth Court', fur: 'fur_shadow', cloak: 'cloak_mothwing',
        hat: 'hat_mothmask', aura: 'aura_gloam_moths', trail: 'trail_gloam_wisps',
    },
};
for (const [setId, contract] of Object.entries(collectionGrowthSets)) {
    const set = COSMETIC_SETS.find((entry) => entry.id === setId);
    check(!!set && set.name === contract.name, `${setId} set identity is missing`);
    check(Object.keys(set.pieces).length === COSMETIC_CATEGORIES.length,
        `${setId} does not map all five categories exactly once`);
    for (const category of COSMETIC_CATEGORIES) {
        const id = contract[category];
        check(set.pieces[category] === id, `${setId} maps the wrong ${category} piece`);
        check(COSMETICS[id]?.category === category, `${setId}.${category} points outside its slot`);
    }
}
const lanternwardAppearance = resolveAppearance(COSMETIC_SETS.find((set) => set.id === 'lanternward').pieces);
check(lanternwardAppearance.cloakStyle === 'splitwatch'
    && lanternwardAppearance.hatShape === 'waylantern'
    && lanternwardAppearance.auraFx === 'oathwheel'
    && lanternwardAppearance.trailFx === 'waymarks',
'Lanternward appearance metadata did not reach the shared resolver');
const duskmothAppearance = resolveAppearance(COSMETIC_SETS.find((set) => set.id === 'duskmoth').pieces);
check(duskmothAppearance.cloakStyle === 'mothwing'
    && duskmothAppearance.hatShape === 'mothmask'
    && duskmothAppearance.auraFx === 'gloam_moths'
    && duskmothAppearance.trailFx === 'gloam_wisps',
'Duskmoth appearance metadata did not reach the shared resolver');

const collectionGrowthIbSets = {
    kilnheart: {
        route: 'boutique', rawTotal: 12900,
        pieces: {
            fur: ['fur_kilncracked', 'furStyle', 'embervein'],
            cloak: ['cloak_coalwing', 'cloakStyle', 'embertail'],
            hat: ['hat_crucible', 'shape', 'embercrest'],
            aura: ['aura_forgehalo', 'fx', 'cinder_run'],
            trail: ['trail_slagprints', 'fx', 'ember_paws'],
        },
    },
    rimeglass: {
        route: 'case', rawTotal: 0,
        pieces: {
            fur: ['fur_rimeglass', 'furStyle', 'frosttip'],
            cloak: ['cloak_icefall', 'cloakStyle', 'rimecoat'],
            hat: ['hat_glaciercrest', 'shape', 'rimeantlers'],
            aura: ['aura_snowprism', 'fx', 'snow_orbit'],
            trail: ['trail_hoarfrost', 'fx', 'ice_runes'],
        },
    },
    thorncrown: {
        route: 'boutique', rawTotal: 7100,
        pieces: {
            fur: ['fur_briarhide', 'furStyle', 'mossmottle'],
            cloak: ['cloak_thornbough', 'cloakStyle', 'briarwing'],
            hat: ['hat_briarhelm', 'shape', 'briarcrown'],
            aura: ['aura_brambleward', 'fx', 'thorn_bloom'],
            trail: ['trail_rootstitch', 'fx', 'briar_leaves'],
        },
    },
    stormglass: {
        route: 'mixed', rawTotal: 13000,
        pieces: {
            fur: ['fur_stormglass', 'furStyle', 'starspeck'],
            cloak: ['cloak_stormkite', 'cloakStyle', 'stormsplit'],
            hat: ['hat_thundercrest', 'shape', 'stormcoil'],
            aura: ['aura_tempestcage', 'fx', 'storm_arc'],
            trail: ['trail_fulgurite', 'fx', 'storm_sparks'],
        },
    },
    sunscar: {
        route: 'boutique', rawTotal: 9000,
        pieces: {
            fur: ['fur_dunebanded', 'furStyle', 'sunstripe'],
            cloak: ['cloak_sunsail', 'cloakStyle', 'sunscarf'],
            hat: ['hat_sunorrery', 'shape', 'sunvisor'],
            aura: ['aura_miragecrown', 'fx', 'sun_mirage'],
            trail: ['trail_sandglass', 'fx', 'sand_steps'],
        },
    },
    gravebell: {
        route: 'case', rawTotal: 0,
        pieces: {
            fur: ['fur_ossuary', 'furStyle', 'gloammask'],
            cloak: ['cloak_pallbearer', 'cloakStyle', 'graveveil'],
            hat: ['hat_gravebell', 'shape', 'gravecowl'],
            aura: ['aura_requiem', 'fx', 'grave_bells'],
            trail: ['trail_epitaph', 'fx', 'grave_candles'],
        },
    },
};
const ibPieceIds = [];
for (const [setId, contract] of Object.entries(collectionGrowthIbSets)) {
    const set = COSMETIC_SETS.find((entry) => entry.id === setId);
    check(!!set, `${setId} I-B set is missing`);
    let rawTotal = 0;
    for (const category of COSMETIC_CATEGORIES) {
        const [id, visualKey, visualValue] = contract.pieces[category];
        const item = COSMETICS[id];
        ibPieceIds.push(id);
        check(set?.pieces?.[category] === id, `${setId} maps the wrong ${category} piece`);
        check(item?.category === category, `${id} is not a ${category} cosmetic`);
        check(item?.[visualKey] === visualValue, `${id} lost authored ${visualKey} ${visualValue}`);
        check(typeof item?.description === 'string' && item.description.length >= 24,
            `${id} lacks reviewed material/silhouette art direction`);
        const routes = getCosmeticAcquisitionRoutes(item);
        if (contract.route === 'boutique') {
            check(JSON.stringify(routes) === JSON.stringify(['boutique']) && item.caseExcluded === true,
                `${id} is not honestly Boutique-only`);
        } else if (contract.route === 'case') {
            const expectedRoutes = item.blueprintCost > 0 ? ['blueprint', 'case'] : ['case'];
            check(JSON.stringify(routes) === JSON.stringify(expectedRoutes) && item.coinCost == null,
                `${id} does not disclose its exact Case${item.blueprintCost > 0 ? ' + Blueprint' : '-only'} routes`);
        } else {
            check(JSON.stringify(routes) === JSON.stringify(['boutique', 'case'])
                && item.coinCost > 0 && item.caseExcluded !== true,
            `${id} lost its Boutique + Case alternate routes`);
        }
        rawTotal += item?.coinCost || 0;
    }
    check(rawTotal === contract.rawTotal, `${setId} raw Boutique total changed`);
    check(rawTotal === 0 || Object.values(set.pieces)
        .reduce((sum, id) => sum + cosmeticCoinCost(COSMETICS[id]), 0) === rawTotal * 2,
    `${setId} effective Boutique total diverges from the shared multiplier`);

    const appearance = resolveAppearance(set.pieces);
    check(appearance.furStyle === contract.pieces.fur[2]
        && appearance.cloakStyle === contract.pieces.cloak[2]
        && appearance.hatShape === contract.pieces.hat[2]
        && appearance.auraFx === contract.pieces.aura[2]
        && appearance.trailFx === contract.pieces.trail[2],
    `${setId} visual metadata did not reach the shared appearance resolver`);
    check(typeof appearance.furAccent === 'string' && typeof appearance.furAccent2 === 'string',
        `${setId} patterned fur lacks its two authored material accents`);
}
check(ibPieceIds.length === 30 && new Set(ibPieceIds).size === 30,
    'Collection Growth I-B is not thirty unique individual pieces');
for (const category of COSMETIC_CATEGORIES) {
    const vocab = Object.values(collectionGrowthIbSets)
        .map((contract) => contract.pieces[category][2]);
    check(new Set(vocab).size === 6, `I-B ${category} vocabulary contains recolor padding`);
}

const hostileAppearance = resolveAppearance({
    fur: '__proto__', cloak: 'constructor', hat: '__proto__',
    aura: 'not_a_cosmetic', trail: null,
});
check(hostileAppearance.furColor === COSMETICS.fur_natural.color
    && hostileAppearance.cloakColor === COSMETICS.cloak_none.color
    && hostileAppearance.cloakStyle === 'classic'
    && hostileAppearance.hatShape === 'none'
    && hostileAppearance.auraColor === COSMETICS.aura_ember.color
    && hostileAppearance.trailColor === COSMETICS.trail_none.color,
'appearance resolver does not fail closed for unknown/prototype ids');

// Waylight Regalia is a permanent mastery collection. Every piece has one
// named achievement source, never enters cases, and only uses effects already
// implemented by the player cosmetic renderers.
const waylight = COSMETIC_SETS.find((set) => set.id === 'waylight');
check(!!waylight, 'Waylight Regalia set is missing');
check(waylight.name === 'Waylight Regalia', 'Waylight Regalia has the wrong display name');
const waylightRoutes = {
    fur:   { id: 'fur_waylight',   achievement: 'waylight_pathfinder' },
    cloak: { id: 'cloak_waylight', achievement: 'waylight_encounters' },
    hat:   { id: 'hat_waylight',   achievement: 'waylight_cartographer' },
    aura:  { id: 'aura_waylight',  achievement: 'waylight_warden' },
    trail: { id: 'trail_waylight', achievement: 'waylight_guardian' },
};
check(Object.keys(waylight.pieces).length === COSMETIC_CATEGORIES.length, 'Waylight Regalia does not map exactly five categories');
for (const category of COSMETIC_CATEGORIES) {
    const route = waylightRoutes[category];
    const item = COSMETICS[route.id];
    check(!!item, `Waylight ${category} piece ${route.id} is missing`);
    check(item.category === category, `${route.id} is assigned to ${item.category}, not ${category}`);
    check(waylight.pieces[category] === route.id, `Waylight set maps the wrong ${category} piece`);
    check(item.achievement === route.achievement, `${route.id} has the wrong achievement route`);
    check(item.caseExcluded === true, `${route.id} can bypass mastery through cases`);
    check(item.defaultUnlocked !== true && item.coinCost == null && item.passLevel == null, `${route.id} has a competing unlock route`);
    check(achievementIds.includes(route.achievement), `${route.id} references missing achievement ${route.achievement}`);
    const routedItems = cosmeticsForAchievement(route.achievement);
    check(routedItems.length === 1 && routedItems[0] === route.id, `${route.achievement} does not unlock exactly ${route.id}`);
}
check(COSMETICS.hat_waylight.shape === 'halo', 'Wayfinder Halo uses an unsupported accessory shape');
check(COSMETICS.aura_waylight.fx === 'spin', 'Beacon Orbit uses an unsupported aura effect');
check(COSMETICS.trail_waylight.fx === 'stars', 'Starpath Trail uses an unsupported trail effect');

const waylightAchievements = ACHIEVEMENTS.filter((achievement) => achievement.id.startsWith('waylight_'));
check(waylightAchievements.length === 6, 'Waylight mastery must contain exactly six permanent achievements');
for (const achievement of waylightAchievements) {
    check(Number.isInteger(achievement.coins) && achievement.coins > 0, `${achievement.id} has an invalid coin reward`);
    check(typeof achievement.check === 'function', `${achievement.id} has no progression check`);
    check(!('expiresAt' in achievement) && !('season' in achievement), `${achievement.id} is not permanent`);
}
const waylightAchievement = (id) => {
    const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
    check(!!achievement, `Waylight achievement ${id} is missing`);
    return achievement;
};
check(!waylightAchievement('waylight_first_site').check({}), 'First Spark unlocks without a site');
check(waylightAchievement('waylight_first_site').check({ vigilSitesActivated: 1 }), 'First Spark misses its 1-site boundary');
check(!waylightAchievement('waylight_pathfinder').check({ vigilSitesActivated: 9 }), 'Roadkindled unlocks before 10 sites');
check(waylightAchievement('waylight_pathfinder').check({ vigilSitesActivated: 10 }), 'Roadkindled misses its 10-site boundary');
check(!waylightAchievement('waylight_cartographer').check({ vigilSiteKindsMastered: 3 }), 'The Fourfold Way unlocks before all 4 kinds');
check(waylightAchievement('waylight_cartographer').check({ vigilSiteKindsMastered: 4 }), 'The Fourfold Way misses its 4-kind boundary');
check(!waylightAchievement('waylight_encounters').check({ encountersCleared: 7 }), 'Hold the Crossing unlocks before 8 encounters');
check(waylightAchievement('waylight_encounters').check({ encountersCleared: 8 }), 'Hold the Crossing misses its 8-encounter boundary');
check(!waylightAchievement('waylight_guardian').check({ guardianPacksDefeated: 5 }), 'Guardianbreaker unlocks before 6 packs');
check(waylightAchievement('waylight_guardian').check({ guardianPacksDefeated: 6 }), 'Guardianbreaker misses its 6-pack boundary');
const almostWarden = { vigilSitesActivated: 30, vigilSiteKindsMastered: 4, encountersCleared: 16, guardianPacksDefeated: 9 };
check(!waylightAchievement('waylight_warden').check(almostWarden), 'Waylight Warden unlocks before every mastery goal');
const wardenStats = { ...almostWarden, guardianPacksDefeated: 10 };
check(waylightAchievement('waylight_warden').check(wardenStats), 'Waylight Warden misses its exact mastery boundary');
check(waylightAchievements.every((achievement) => achievement.check(wardenStats)), 'full mastery does not imply every Waylight achievement');

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
const livingVigilRun = runXpBreakdown({
    ...normalRun,
    vigilSitesActivated: 4,
    vigilSiteKindsMastered: 4,
    encountersCleared: 3,
});
check(livingVigilRun.deeds > normal.deeds, 'Living Vigil activity contributes no battle-pass XP');
check(livingVigilRun.deeds - normal.deeds === 156,
    'Living Vigil site/encounter XP does not match its disclosed rules');
check(livingVigilRun.livingVigil === 156, 'Living Vigil XP receipt does not disclose the awarded amount');
const guardianVigilRun = runXpBreakdown({
    ...normalRun,
    vigilSitesActivated: 1,
    guardianPacksDefeated: 1,
});
check(guardianVigilRun.livingVigil === 36,
    'a beacon activation plus its guardian clear does not award the disclosed 12 + 24 XP');

// Award receipts must describe the state that was actually saved.
const awardSave = {
    xp: 250,
    getBattlePassXp() { return this.xp; },
    addBattlePassXp(amount) { this.xp += amount; return { everflameCaches: 0, everflameCoins: 0 }; },
};
const award = awardRun(awardSave, normalRun, { bonus: 0.5 });
check(award.levelAfter === bpProgress(awardSave.xp).level, 'award receipt level is stale');
check(award.gained === award.breakdown.total, 'award receipt total does not match its buckets');
const visibleAward = battlePassRunReceipt(award);
check(visibleAward.reconciles && visibleAward.additiveTotal === visibleAward.gained,
    'visible battle-pass additive buckets do not reconcile to the displayed total');
const visibleWaylight = battlePassRunReceipt({ gained: livingVigilRun.total, breakdown: livingVigilRun });
check(visibleWaylight.waylightWithinDeeds === livingVigilRun.livingVigil
    && visibleWaylight.additiveTotal === visibleWaylight.gained,
    'Waylight receipt is not represented as a disclosed slice within Deeds');

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

// Relic discovery is an authority boundary, not merely a tab-visibility hint.
// A direct locked-id call must leave coins, attunement state, the whole in-memory
// save, and persisted storage byte-for-byte untouched.
const lockedAttune = new SaveSystem();
const lockedRelic = ATTUNABLE[0];
lockedAttune.data.totalCoins = attuneCost(lockedRelic, 0) + 5000;
lockedAttune.data.discoveredRelics = [];
lockedAttune.data.relicAttunement = {};
lockedAttune.save();
const lockedBeforeData = JSON.stringify(lockedAttune.data);
const lockedBeforePersisted = localStorage.getItem('monkey-survivor:save:v1');
const originalSetItem = localStorage.setItem;
let lockedPersistWrites = 0;
localStorage.setItem = (key, value) => {
    lockedPersistWrites += 1;
    originalSetItem(key, value);
};
const lockedResult = lockedAttune.attuneRelic(lockedRelic.id);
localStorage.setItem = originalSetItem;
check(lockedResult === false, 'undiscovered relic attunement succeeded through the direct SaveSystem API');
check(JSON.stringify(lockedAttune.data) === lockedBeforeData,
    'undiscovered relic attunement mutated in-memory save data');
check(lockedAttune.data.totalCoins === attuneCost(lockedRelic, 0) + 5000
    && Object.keys(lockedAttune.data.relicAttunement).length === 0,
'undiscovered relic attunement changed coins or the attunement map');
check(lockedPersistWrites === 0
    && localStorage.getItem('monkey-survivor:save:v1') === lockedBeforePersisted,
'undiscovered relic attunement wrote persistence');
check(lockedAttune.discoverRelic(lockedRelic.id) === true
    && lockedAttune.attuneRelic(lockedRelic.id) === true
    && lockedAttune.getRelicAttunement(lockedRelic.id) === 1,
'a discovered relic could not pass the authoritative attunement gate');

// Living Vigil save fields are additive, old-save safe, and banked exactly
// once through the same run-summary seam as the other lifetime records.
const legacyVigil = save._validate({ stats: { runs: 12, totalKills: 345 } });
for (const key of ['vigilSitesActivated', 'vigilSiteKindsMastered', 'encountersCleared', 'guardianPacksDefeated']) {
    check(legacyVigil.stats[key] === 0, `legacy save did not default ${key}`);
}
check(save._validate({ stats: { vigilSiteKindsMastered: 999 } }).stats.vigilSiteKindsMastered === 4,
    'tampered site-kind mastery was not clamped during load');
save.data = save._validate({ stats: {} });
save.recordRun({ time: 80, vigilSitesActivated: 3, vigilSiteKindsMastered: 3, encountersCleared: 2, guardianPacksDefeated: 1 });
save.recordRun({ time: 90, vigilSitesActivated: 2, vigilSiteKindsMastered: 99, encountersCleared: 4, guardianPacksDefeated: 2 });
check(save.data.stats.vigilSitesActivated === 5, 'site activations did not accumulate exactly');
check(save.data.stats.vigilSiteKindsMastered === 4, 'site-kind mastery did not clamp to four');
check(save.data.stats.encountersCleared === 6, 'encounter clears did not accumulate exactly');
check(save.data.stats.guardianPacksDefeated === 3, 'guardian packs did not accumulate exactly');
save.recordRun({ vigilSitesActivated: -5, encountersCleared: -5, guardianPacksDefeated: -5 });
check(save.data.stats.vigilSitesActivated === 5 && save.data.stats.encountersCleared === 6
    && save.data.stats.guardianPacksDefeated === 3, 'negative Living Vigil summary values reduced lifetime totals');

// Save normalization enforces authored upgrade caps, and live increments cannot
// step past them even if a caller bypasses the shop UI.
const overcapped = save._validate({ upgrades: Object.fromEntries(PERMANENT_UPGRADES.map((u) => [u.id, 999999])) });
for (const u of PERMANENT_UPGRADES) {
    check(overcapped.upgrades[u.id] === u.maxLevel, `${u.id} was not clamped to its authored max`);
}
const maxHpUpgrade = PERMANENT_UPGRADES.find((u) => u.id === 'maxHp');
save.data.upgrades.maxHp = maxHpUpgrade.maxLevel;
check(save.incrementUpgrade('maxHp') === false && save.data.upgrades.maxHp === maxHpUpgrade.maxLevel,
    'a permanent upgrade incremented past its cap');
save.data.upgrades.maxHp = maxHpUpgrade.maxLevel - 1;
check(save.incrementUpgrade('maxHp') === true && save.data.upgrades.maxHp === maxHpUpgrade.maxLevel,
    'a valid final permanent-upgrade increment was rejected');

// Equipment APIs reject cross-slot ids immediately, and the run-start bridge
// independently ignores a malformed raw loadout instead of applying its buffs.
const validLegacyCosmetics = save._validate({ cosmetics: {
    unlocked: ['hat_wool', 'cloak_crimson'],
    equipped: { hat: 'hat_wool', cloak: 'cloak_crimson' },
} });
check(validLegacyCosmetics.cosmetics.unlocked.includes('hat_wool')
    && validLegacyCosmetics.cosmetics.unlocked.includes('cloak_crimson')
    && validLegacyCosmetics.cosmetics.equipped.hat === 'hat_wool'
    && validLegacyCosmetics.cosmetics.equipped.cloak === 'cloak_crimson',
'valid pre-growth cosmetic saves no longer round-trip');
const invalidEquippedCosmetic = save._validate({ cosmetics: {
    unlocked: ['hat_wool', 'not_a_cosmetic'],
    equipped: { hat: 'not_a_cosmetic' },
} });
check(invalidEquippedCosmetic.cosmetics.equipped.hat === 'hat_none',
    'unknown equipped cosmetic escaped the existing slot fallback');
const unlockedBeforeUnknownGrant = [...save.data.cosmetics.unlocked];
check(save.unlockCosmetic('not_a_cosmetic') === false
    && save.unlockCosmetic('__proto__') === false
    && save.unlockCosmetic(null) === false,
'public cosmetic grant accepted an unknown/prototype/non-string id');
check(save.unlockCosmeticSilent('not_a_cosmetic') === false
    && save.unlockCosmeticSilent('constructor') === false,
'silent cosmetic grant accepted an unknown/prototype id');
check(JSON.stringify(save.data.cosmetics.unlocked) === JSON.stringify(unlockedBeforeUnknownGrant),
    'rejected cosmetic grant mutated the owned catalog');
check(save.unlockCosmetic('cloak_splitwatch') === true
    && save.unlockCosmetic('cloak_splitwatch') === false,
'valid Collection Growth cosmetic grant is not new-once idempotent');
check(save.unlockCosmeticSilent('hat_waylantern') === true
    && save.unlockCosmeticSilent('hat_waylantern') === false,
'valid silent Collection Growth grant is not new-once idempotent');
save.unlockGear('t_emberband');
const armorBefore = save.data.gear.equipped.armor;
check(save.equipGear('armor', 't_emberband') === false && save.data.gear.equipped.armor === armorBefore,
    'wrong-slot gear was equipped');
check(save.equipGear('trinket', 't_emberband') === true, 'valid trinket equip was rejected');
save.unlockCosmetic('hat_wool');
const cloakBefore = save.data.cosmetics.equipped.cloak;
check(save.equipCosmetic('cloak', 'hat_wool') === false && save.data.cosmetics.equipped.cloak === cloakBefore,
    'wrong-slot cosmetic was equipped');
check(save.equipCosmetic('hat', 'hat_wool') === true, 'valid hat equip was rejected');

// I-B per-hero looks are additive and preserve the old global equipped map as
// the selected hero's compatibility mirror. Legacy looks seed every hero;
// malformed presets/pursuits fail closed without deleting valid ownership.
const migratedPresetSave = save._validate({
    selectedCharacter: 'elf',
    cosmetics: {
        unlocked: ['hat_wool', 'cloak_crimson'],
        equipped: { hat: 'hat_wool', cloak: 'cloak_crimson' },
    },
});
check(Object.keys(migratedPresetSave.cosmetics.presets).length === CHARACTER_IDS.length,
    'legacy look did not seed every hero preset');
for (const heroId of CHARACTER_IDS) {
    check(migratedPresetSave.cosmetics.presets[heroId].hat === 'hat_wool'
        && migratedPresetSave.cosmetics.presets[heroId].cloak === 'cloak_crimson',
    `legacy look did not seed ${heroId}`);
}
check(migratedPresetSave.cosmetics.equipped.hat === 'hat_wool',
    'selected-hero compatibility mirror changed during preset migration');
check(save._validate({ cosmetics: { pursuitSetId: '__unknown__' } }).cosmetics.pursuitSetId === null,
    'unknown cosmetic pursuit escaped save validation');
check(save._validate({ cosmetics: { pursuitSetId: 'stormglass' } }).cosmetics.pursuitSetId === 'stormglass',
    'valid cosmetic pursuit did not survive save validation');

storage.clear();
const presetSave = new SaveSystem();
presetSave.data.totalCoins = 50000;
presetSave.unlockCosmetic('hat_wool');
check(presetSave.equipCosmetic('hat', 'hat_wool', 'elf') === true,
    'nonselected hero preset rejected a valid owned cosmetic');
check(presetSave.getCosmeticPreset('elf').hat === 'hat_wool'
    && presetSave.getCosmeticPreset('monkey').hat === 'hat_none'
    && presetSave.data.cosmetics.equipped.hat === 'hat_none',
'nonselected hero equip leaked into another preset or compatibility mirror');
check(presetSave.setSelectedCharacter('elf') === true
    && presetSave.data.cosmetics.equipped.hat === 'hat_wool',
'hero selection did not restore that hero preset');
check(presetSave.getEquippedCosmetics('monkey').hat === 'hat_none'
    && presetSave.getEquippedCosmetics('elf').hat === 'hat_wool',
'effective-hero cosmetic lookup does not isolate Rite Trial-style overrides');

const purchaseLook = {
    ...presetSave.getCosmeticPreset('elf'),
    fur: 'fur_kilncracked',
};
const kilnCost = cosmeticCoinCost(COSMETICS.fur_kilncracked);
const balanceBeforePurchase = presetSave.data.totalCoins;
check(presetSave.purchaseCosmeticLook(['fur_kilncracked'], kilnCost, purchaseLook, 'elf') === true,
    'valid atomic Boutique look purchase was rejected');
check(presetSave.data.totalCoins === balanceBeforePurchase - kilnCost
    && presetSave.isCosmeticUnlocked('fur_kilncracked')
    && presetSave.getCosmeticPreset('elf').fur === 'fur_kilncracked'
    && presetSave.data.cosmetics.equipped.fur === 'fur_kilncracked',
'atomic Boutique purchase did not commit coin, ownership, preset, and mirror together');
const beforeRejectedPurchase = JSON.stringify(presetSave.data);
check(presetSave.purchaseCosmeticLook(['fur_briarhide'], 1, {
    ...purchaseLook, fur: 'fur_briarhide',
}, 'elf') === false && JSON.stringify(presetSave.data) === beforeRejectedPurchase,
'wrong-price Boutique transaction mutated save data');
check(presetSave.setCosmeticPursuit('stormglass') === true
    && presetSave.data.cosmetics.pursuitSetId === 'stormglass'
    && presetSave.setCosmeticPursuit('__unknown__') === false
    && presetSave.data.cosmetics.pursuitSetId === 'stormglass',
'cosmetic pursuit setter accepts unknown sets or loses a valid pursuit');
const presetReload = new SaveSystem();
check(presetReload.getCosmeticPreset('elf').fur === 'fur_kilncracked'
    && presetReload.data.cosmetics.pursuitSetId === 'stormglass',
'per-hero cosmetic preset or pursuit did not survive JSON round-trip');

const malformedPlayer = { coinMul: 1 };
applyLoadout(malformedPlayer, { gear: { equipped: { armor: 't_emberband' } } });
check(malformedPlayer.coinMul === 1, 'applyLoadout applied a wrong-slot item');
applyLoadout(malformedPlayer, { gear: { equipped: { trinket: 't_emberband' } } });
check(Math.abs(malformedPlayer.coinMul - 1.1) < 1e-9, 'applyLoadout skipped valid matching-slot gear');
check(resolveStartingWeapon({ gear: { equipped: { weapon: 't_emberband' } } }) === 'arcaneBolt',
    'wrong-slot starting gear escaped the weapon fallback');

// Weekly Ember's lifetime best must survive the same save/reload normalization
// every other lifetime stat uses.
storage.clear();
const weeklySave = new SaveSystem();
weeklySave.recordWeeklyEmber(123, 4567);
const weeklyReload = new SaveSystem();
check(weeklyReload.data.weeklyEmber.best === 4567, 'Weekly Ember record did not survive reload');
check(weeklyReload.data.stats.weeklyEmberBest === 4567, 'Weekly Ember lifetime best did not survive reload');

// Daily rotations remain deterministic while avoiding duplicate metric families
// in the normal three-goal offering.
const dailySignatures = new Set();
for (let day = 1; day <= 1000; day++) {
    const first = pickDailyChallenges(day);
    const again = pickDailyChallenges(day);
    check(first.length === 3, `day ${day} did not produce three challenges`);
    check(new Set(first.map((c) => c.id)).size === 3, `day ${day} repeated a challenge id`);
    check(new Set(first.map((c) => c.metric)).size === 3, `day ${day} repeated a challenge metric`);
    check(first.map((c) => c.id).join('|') === again.map((c) => c.id).join('|'), `day ${day} was not deterministic`);
    dailySignatures.add(first.map((c) => c.id).join('|'));
}
check(dailySignatures.size > 100, 'daily challenge rotation has too little variety');
check(pickDailyChallenges(42, 0).length === 0, 'zero-count daily request returned challenges');
check(pickDailyChallenges(42, DAILY_POOL.length).length === DAILY_POOL.length, 'full daily request lost overflow challenges');

const livingDailyMetrics = {
    sites: { vigilSitesActivated: 2 },
    siteKinds: { vigilSiteKindsMastered: 4 },
    encounters: { encountersCleared: 2 },
    guardians: { guardianPacksDefeated: 1 },
};
for (const [metric, summary] of Object.entries(livingDailyMetrics)) {
    const challenge = DAILY_POOL.find((entry) => entry.metric === metric);
    check(!!challenge, `daily pool is missing the ${metric} family`);
    check(challengeProgress(challenge, summary) > 0, `${metric} daily ignores its Living Vigil summary field`);
}
const objectiveIds = new Set(OBJECTIVES.map((objective) => objective.id));
check(objectiveIds.size === OBJECTIVES.length, 'run objective ids are not unique');
for (const metric of ['sites', 'siteKinds', 'encounters']) {
    check(OBJECTIVES.some((objective) => objective.metric === metric), `run objectives are missing ${metric}`);
}

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
