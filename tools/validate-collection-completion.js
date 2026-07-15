#!/usr/bin/env node
// Browser-free authority checks for Collection Completion, deterministic
// Blueprint unlock truth, and read-only case target disclosures.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH, RENDER } from '../src/config/GameConfig.js';
import { ALL_PASS_COSMETIC_MILESTONES, PASS_COSMETIC_MILESTONES } from '../src/content/battlePass.js';
import {
    COSMETICS,
    COSMETIC_ACQUISITION_ROUTES,
    COSMETIC_BLUEPRINT_COST,
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_CATEGORIES,
    COSMETIC_LIST,
    COSMETIC_SETS,
    cosmeticBlueprintCost,
    getCosmeticAcquisitionRoutes,
    getCosmeticSourceLabel,
} from '../src/content/cosmetics.js';
import {
    CASES,
    CASE_COIN_CONSOLATION_CHANCE,
    CASE_ITEM_BRANCH_CHANCE,
    CASE_ITEM_REWARD_CHANCE,
    casePoolSnapshot,
    caseTargetSnapshot,
} from '../src/systems/CaseSystem.js';
import {
    buildCollectionCompletionSnapshot,
    buildCosmeticCompletionSnapshot,
} from '../src/systems/CollectionCompletion.js';
import {
    MenuRenderer,
    computePhoneCollectionCompletionLayout,
    computePhoneSectionBarLayout,
} from '../src/systems/MenuRenderer.js';

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks += 1;
}
function same(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    checks += 1;
}
function close(actual, expected, message, epsilon = 1e-12) {
    check(Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
        `${message}: expected ${expected}, received ${actual}`);
}
function recursivelyFrozen(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return true;
    seen.add(value);
    if (!Object.isFrozen(value)) return false;
    return Object.values(value).every((child) => recursivelyFrozen(child, seen));
}
function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

// Blueprint identity and pass metadata are additive acquisition truth. They do
// not remove either Blueprint item from the pre-existing cosmetic case pool.
check(COSMETIC_BLUEPRINT_COST === 72000, 'Blueprint price is not exactly 72,000 earned coins');
same(COSMETIC_BLUEPRINT_IDS, ['aura_gloam_moths', 'aura_requiem'],
    'Blueprint allowlist is not the exact two authored Mythics');
check(Object.isFrozen(COSMETIC_BLUEPRINT_IDS), 'Blueprint allowlist is mutable');
const blueprintFieldIds = COSMETIC_LIST.filter((item) => item.blueprintCost != null).map((item) => item.id);
same(blueprintFieldIds, COSMETIC_BLUEPRINT_IDS, 'unexpected cosmetic exposes Blueprint metadata');
for (const id of COSMETIC_BLUEPRINT_IDS) {
    const item = COSMETICS[id];
    check(item.rarity === 'mythic', `${id} is not Mythic`);
    check(cosmeticBlueprintCost(item) === 72000 && cosmeticBlueprintCost(id) === 72000,
        `${id} Blueprint cost is not stable by item/id lookup`);
    same(getCosmeticAcquisitionRoutes(item), ['blueprint', 'case'],
        `${id} is not honestly Blueprint + Case eligible`);
    check(getCosmeticSourceLabel(item) === 'Blueprint · Case', `${id} has misleading source copy`);
}
for (const invalid of [null, {}, '__missing__', COSMETICS.fur_galaxy, { blueprintCost: 1.5 }]) {
    check(cosmeticBlueprintCost(invalid) === 0, 'non-Blueprint input exposed an authored Blueprint price');
}

const exactPassMetadata = {
    trail_sparks: 5,
    fur_vigil: 10,
    fur_ember: 15,
    cloak_vigil: 20,
    aura_frost: 25,
    hat_vigil: 30,
    cloak_crimson: 35,
    trail_vigil: 40,
    fur_frost: 45,
    aura_mythic: 50,
};
same(ALL_PASS_COSMETIC_MILESTONES, Object.fromEntries(
    Object.entries(exactPassMetadata).map(([id, level]) => [level, id])),
'all ten Vigil cosmetic milestones drifted');
check(Object.isFrozen(ALL_PASS_COSMETIC_MILESTONES), 'all-ten Vigil milestone map is mutable');
same(PASS_COSMETIC_MILESTONES, {
    10: 'fur_vigil', 20: 'cloak_vigil', 30: 'hat_vigil', 40: 'trail_vigil', 50: 'aura_mythic',
}, 'legacy Last Light milestone API changed');
for (const [id, level] of Object.entries(exactPassMetadata)) {
    check(COSMETICS[id].passLevel === level, `${id} does not disclose Vigil level ${level}`);
    check(getCosmeticAcquisitionRoutes(id).includes('vigil'), `${id} is absent from the Vigil route`);
}
for (const id of ['trail_sparks', 'fur_ember', 'aura_frost', 'cloak_crimson', 'fur_frost']) {
    check(COSMETICS[id].caseExcluded !== true && getCosmeticAcquisitionRoutes(id).includes('case'),
        `${id} lost its pre-existing case eligibility`);
}

same(COSMETIC_ACQUISITION_ROUTES,
    ['starter', 'boutique', 'blueprint', 'case', 'achievement', 'vigil'],
    'acquisition route ids/order changed');
const sourceCounts = Object.fromEntries(COSMETIC_ACQUISITION_ROUTES.map((route) => [
    route,
    COSMETIC_LIST.filter((item) => getCosmeticAcquisitionRoutes(item).includes(route)).length,
]));
same(sourceCounts, { starter: 13, boutique: 44, blueprint: 2, case: 61, achievement: 19, vigil: 10 },
    'overlapping acquisition coverage changed');
const routeSignatures = {};
for (const item of COSMETIC_LIST) {
    const signature = getCosmeticAcquisitionRoutes(item).join('+');
    routeSignatures[signature] = (routeSignatures[signature] ?? 0) + 1;
}
same(routeSignatures, {
    starter: 13,
    'boutique+case': 22,
    'boutique+case+vigil': 3,
    'case+vigil': 2,
    'case+achievement': 14,
    case: 18,
    vigil: 5,
    achievement: 5,
    boutique: 19,
    'blueprint+case': 2,
}, 'exact acquisition-route signatures changed');

// Ordered case truth remains byte-stable despite the added deterministic path.
check(CASE_ITEM_REWARD_CHANCE === 0.82 && CASE_ITEM_BRANCH_CHANCE === CASE_ITEM_REWARD_CHANCE,
    'item reward branch is not exactly 82%');
check(CASE_COIN_CONSOLATION_CHANCE === 0.60, 'conditional coin consolation is not exactly 60%');
const cosmeticPool = casePoolSnapshot('cosmetic');
check(cosmeticPool.valid && cosmeticPool.kind === 'cosmetic', 'cosmetic case pool snapshot is unavailable');
check(recursivelyFrozen(cosmeticPool), 'cosmetic case pool snapshot is not deeply frozen');
check(cosmeticPool.total === 61 && new Set(cosmeticPool.ids).size === 61,
    'cosmetic case pool is not exactly 61 unique items');
same(Object.fromEntries(cosmeticPool.rarities.map((row) => [row.id, row.total])),
    { common: 2, uncommon: 7, rare: 15, epic: 16, legendary: 13, mythic: 8 },
    'cosmetic case rarity counts changed');
check(hash(cosmeticPool.ids.join('|')) === '59d6a7ef547d90a4883cbe055696b7e04a784e6ce999311169050f85779e7268',
    'ordered cosmetic pool fingerprint changed');
const poolIdRarityContract = JSON.stringify(cosmeticPool.entries.map(({ id, rarity }) => ({ id, rarity })));
check(Buffer.byteLength(poolIdRarityContract, 'utf8') === 2406,
    'ordered cosmetic id/rarity contract byte length changed');
check(hash(poolIdRarityContract) === '9ff013bd1960d1038677adc190241a224b75c7a884bcbeb9292cb1edef487b2e',
    'ordered cosmetic id/rarity fingerprint changed');
same(cosmeticPool.rarities.find((row) => row.id === 'mythic').ids, [
    'fur_galaxy', 'cloak_prism', 'aura_inferno', 'aura_prism',
    'aura_gloam_moths', 'aura_tempestcage', 'aura_requiem', 'trail_rainbow',
], 'Mythic case pool ids/order changed');
check(casePoolSnapshot('__unknown__').valid === false && casePoolSnapshot('__unknown__').total === 0,
    'invalid case pool kind did not fail closed');

for (const [caseType, total] of Object.entries({
    basicCosmetic: 40,
    mysticCosmetic: 53,
    royalCosmetic: 59,
})) {
    const snapshot = caseTargetSnapshot({ caseType });
    check(snapshot.valid && snapshot.poolTotal === total, `${caseType} reach is not exactly ${total}`);
    check(recursivelyFrozen(snapshot), `${caseType} target snapshot is not deeply frozen`);
}
const freshTarget = caseTargetSnapshot({
    caseType: 'royalCosmetic', targetId: 'aura_gloam_moths', ownedIds: [], pityCount: 0,
});
check(freshTarget.valid && freshTarget.poolTotal === 59 && freshTarget.target.valid,
    'fresh Royal Blueprint target snapshot is unavailable');
const freshMythic = freshTarget.rarities.find((row) => row.id === 'mythic');
check(freshMythic.total === 8 && freshMythic.owned === 0 && freshMythic.unowned === 8,
    'fresh Royal Mythic owned/unowned partition changed');
close(freshMythic.odds, 0.015, 'Royal Mythic ordinary odds changed');
close(freshMythic.forcedOdds, 2 / 61, 'Royal forced Mythic weighting changed');
close(freshTarget.target.ordinaryNamedProbability, 0.015 * 0.82 / 8,
    'fresh ordinary named-Blueprint probability changed');
close(freshTarget.target.forcedNextNamedProbability, (2 / 61) * 0.82 / 8,
    'fresh forced-next named-Blueprint probability changed');
check(freshTarget.target.ordinaryBasisPoints === 15 && freshTarget.target.forcedNextBasisPoints === 33,
    'named target probabilities are not floored to basis points');
check(freshTarget.pity.cap === 10 && freshTarget.pity.count === 0
    && freshTarget.pity.remaining === 10 && !freshTarget.pity.forcedNext,
'fresh Royal pity disclosure changed');
same(freshTarget.branches, {
    item: 0.82,
    itemBasisPoints: 8200,
    coin: 0.10800000000000003,
    coinBasisPoints: 1080,
    battlePassXp: 0.07200000000000002,
    battlePassXpBasisPoints: 720,
    coinConditionalOnConsolation: 0.6,
}, 'case branch disclosure no longer mirrors runtime');
check(freshTarget.duplicatePolicy.preferUnownedWithinRarity
    && freshTarget.duplicatePolicy.duplicatesOnlyAfterRarityCollected
    && freshTarget.duplicatePolicy.reward === 'coin-dust',
'duplicate semantics are not explicit');

const otherMythics = cosmeticPool.rarities.find((row) => row.id === 'mythic').ids
    .filter((id) => id !== 'aura_gloam_moths');
const lastUnowned = caseTargetSnapshot({
    caseType: 'royalCosmetic', targetId: 'aura_gloam_moths', ownedIds: otherMythics, pityCount: 9,
});
check(lastUnowned.pity.forcedNext && lastUnowned.pity.remaining === 1,
    'Royal pity boundary does not mark the forced next pull');
check(lastUnowned.target.selectionPool === 'unowned' && lastUnowned.target.selectionPoolSize === 1,
    'last-unowned target is not selected from the one-item unowned pool');
close(lastUnowned.target.ordinaryNamedProbability, 0.015 * 0.82,
    'last-unowned ordinary target probability changed');
close(lastUnowned.target.forcedNextNamedProbability, (2 / 61) * 0.82,
    'last-unowned forced target probability changed');
check(lastUnowned.target.nextNamedProbability === lastUnowned.target.forcedNextNamedProbability,
    'forced-next state displays the ordinary target probability');

const blockedOwned = caseTargetSnapshot({
    caseType: 'royalCosmetic', targetId: 'aura_gloam_moths', ownedIds: ['aura_gloam_moths'], pityCount: 0,
});
check(blockedOwned.target.blockedByUnownedPreference
    && blockedOwned.target.selectionPool === 'blocked-by-unowned'
    && blockedOwned.target.ordinaryNamedProbability === 0,
'owned target can bypass the unowned-first rule');
const duplicateTarget = caseTargetSnapshot({
    caseType: 'royalCosmetic', targetId: 'aura_gloam_moths',
    ownedIds: cosmeticPool.rarities.find((row) => row.id === 'mythic').ids,
    pityCount: 0,
});
check(duplicateTarget.target.duplicateIfAwarded
    && duplicateTarget.target.selectionPool === 'full'
    && duplicateTarget.target.selectionPoolSize === 8,
'fully collected rarity does not expose duplicate selection semantics');
for (const invalid of [null, [], { caseType: '__unknown__' }, { ownedIds: {} }, { pityCount: -1 }]) {
    const result = caseTargetSnapshot(invalid);
    check(result.valid === false && result.poolTotal === 0, 'malformed target request did not fail closed');
    check(recursivelyFrozen(result), 'failed target request is mutable');
}

// Completion snapshot: overlapping source counts, de-duplicated deterministic
// coverage, exact case-only partition, all category/set rows, and honest copy.
check(buildCollectionCompletionSnapshot === buildCosmeticCompletionSnapshot,
    'completion builder aliases forked into separate implementations');
const ownedFixture = [
    'fur_jade', 'cloak_verdant', 'hat_flower', 'trail_leaf',
    'fur_stormglass', 'cloak_stormkite', 'aura_gloam_moths',
];
const completion = buildCosmeticCompletionSnapshot({
    ownedIds: ownedFixture,
    blueprintClaims: ['aura_gloam_moths', 'aura_requiem', '__unknown__'],
    pursuitSetId: 'stormglass',
    selectedBlueprintId: 'aura_requiem',
    coinBalance: 72000,
    royalCosmeticPityCount: 9,
});
check(completion.valid && !completion.unavailable && completion.overlapping,
    'valid completion input is unavailable or hides overlapping routes');
check(recursivelyFrozen(completion), 'completion snapshot is not deeply frozen');
check(completion.total === 103 && completion.owned === ownedFixture.length
    && completion.missing === 103 - ownedFixture.length
    && completion.basisPoints === Math.floor(ownedFixture.length / 103 * 10000),
'overall completion arithmetic changed');
same(Object.fromEntries(completion.categories.map((row) => [row.id, row.total])),
    { fur: 18, cloak: 20, hat: 22, aura: 21, trail: 22 },
    'all five category totals are not present');
for (const row of completion.categories) {
    check(row.missing === row.total - row.owned, `${row.id} category does not reconcile`);
    check(row.basisPoints === Math.floor(row.owned / row.total * 10000),
        `${row.id} category basis points are not floored`);
}
same(Object.fromEntries(completion.sources.map((row) => [row.id, row.total])), sourceCounts,
    'completion source rows drifted from content truth');
check(completion.sourceCoverage.overlapping && completion.sourceCoverage.rows === completion.sources,
    'source coverage does not explicitly disclose overlap');
check(completion.routes === completion.sources, 'route/source aliases do not share one authority');
check(completion.sources.reduce((sum, row) => sum + row.total, 0) > completion.total,
    'overlapping route rows were incorrectly forced into a partition');
check(completion.deterministic.total === 85 && completion.deterministic.ids.length === 85
    && completion.deterministic.missing === 85 - completion.deterministic.owned,
'deterministic route union changed');
const exactCaseOnlyIds = [
    'fur_shadow', 'fur_rimeglass', 'fur_ossuary', 'cloak_mothwing', 'cloak_icefall',
    'cloak_pallbearer', 'hat_candle', 'hat_horns', 'hat_mothmask', 'hat_glaciercrest',
    'hat_gravebell', 'aura_verdant', 'aura_shadow', 'aura_snowprism', 'trail_petals',
    'trail_gloam_wisps', 'trail_hoarfrost', 'trail_epitaph',
];
same(completion.caseOnly.ids, exactCaseOnlyIds, 'case-only partition changed');
check(completion.caseOnly.total === 18 && completion.caseOnly.mythicTotal === 0
    && completion.caseOnly.mythicIds.length === 0,
'case-only totals or Mythic truth changed');
same(Object.fromEntries(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].map((rarity) => [
    rarity,
    completion.caseOnly.ids.filter((id) => COSMETICS[id].rarity === rarity).length,
])), { common: 0, uncommon: 2, rare: 8, epic: 6, legendary: 2, mythic: 0 },
'case-only rarity partition changed');

check(completion.sets.length === COSMETIC_SETS.length && completion.sets.length === 15,
    'completion does not expose all fifteen sets');
for (const set of completion.sets) {
    check(set.total === COSMETIC_CATEGORIES.length && set.pieces.length === COSMETIC_CATEGORIES.length,
        `${set.id} does not expose all five pieces`);
    check(set.missing === set.missingItems.length && set.missing === set.missingIds.length,
        `${set.id} missing item rows do not reconcile`);
    check(set.owned + set.missing === set.total, `${set.id} progress does not reconcile`);
    for (const item of set.missingItems) {
        check(Array.isArray(item.routes) && item.routes.length > 0,
            `${set.id} missing ${item.id} has no acquisition routes`);
    }
}
check(completion.pursuitSetId === 'stormglass' && completion.trackedSet?.id === 'stormglass'
    && completion.trackedSet.tracked,
'tracked set was not resolved');
check(completion.closestSet?.id === 'wildheart' && completion.closestSet.owned === 4
    && completion.closestSet.missingIds[0] === 'aura_verdant',
'closest incomplete set changed or lost its missing item');

check(completion.blueprints.length === 2 && completion.selectedBlueprint?.id === 'aura_requiem',
    'Blueprint rows/selection changed');
for (const blueprint of completion.blueprints) {
    check(blueprint.cost === 72000 && blueprint.knownPrice && blueprint.guaranteed,
        `${blueprint.id} lacks fixed-price guarantee truth`);
    check(blueprint.royalCaseEntryFees === 80
        && blueprint.caseEntryFeeAnchor.caseCost === CASES.royalCosmetic.cost
        && blueprint.caseEntryFeeAnchor.grossCoins === 72000,
    `${blueprint.id} 80-entry-fee anchor changed`);
    check(blueprint.copy.eyebrow === 'GUARANTEED / KNOWN PRICE',
        `${blueprint.id} required guarantee heading changed`);
    check(blueprint.copy.anchor.includes('equals 80 Royal Cosmetic Case entry fees'),
        `${blueprint.id} entry-fee anchor is unclear`);
    check(blueprint.copy.caveat.includes('not an equivalent price')
        && blueprint.copy.caveat.includes('not')
        && blueprint.copy.caveat.includes('guaranteed case result')
        && !Object.values(blueprint.copy).join(' ').toLowerCase().includes('cheaper'),
    `${blueprint.id} copy misrepresents random cases`);
    check(blueprint.royalCase.poolTotal === 59 && blueprint.royalCase.pity.forcedNext,
        `${blueprint.id} Royal target/pity authority is missing`);
}
const ownedBlueprint = completion.blueprints.find((item) => item.id === 'aura_gloam_moths');
const lockedBlueprint = completion.blueprints.find((item) => item.id === 'aura_requiem');
check(ownedBlueprint.owned && ownedBlueprint.claimed && !ownedBlueprint.affordable,
    'owned/claimed Blueprint state is wrong');
check(!lockedBlueprint.owned && !lockedBlueprint.claimed && lockedBlueprint.affordable,
    'locked affordable Blueprint state is wrong');
check(completion.diagnostics.unknownBlueprintClaims === 1
    && completion.diagnostics.orphanedBlueprintClaims === 1,
'unknown/orphaned Blueprint claim diagnostics changed');

const allOwned = buildCosmeticCompletionSnapshot({
    ownedIds: COSMETIC_LIST.map((item) => item.id),
    blueprintClaims: COSMETIC_BLUEPRINT_IDS,
});
check(allOwned.owned === 103 && allOwned.missing === 0 && allOwned.basisPoints === 10000,
    'fully owned catalog does not report 100%');
check(allOwned.categories.every((row) => row.basisPoints === 10000)
    && allOwned.sources.every((row) => row.basisPoints === 10000)
    && allOwned.sets.every((set) => set.complete && set.basisPoints === 10000),
'fully owned category/source/set rows do not report 100%');
check(allOwned.closestSet === null, 'fully completed catalog still reports an incomplete closest set');

const unknownOwned = buildCosmeticCompletionSnapshot({ ownedIds: ['fur_natural', '__unknown__'] });
check(unknownOwned.valid && unknownOwned.owned === 1 && unknownOwned.diagnostics.unknownOwnedIds === 1,
    'unknown owned id polluted totals or invalidated safe catalog truth');
const unknownSelection = buildCosmeticCompletionSnapshot({
    pursuitSetId: '__unknown__', selectedBlueprintId: '__unknown__',
});
check(unknownSelection.valid && unknownSelection.pursuitSetId === null
    && unknownSelection.selectedBlueprintId === null
    && unknownSelection.diagnostics.unknownPursuitSet
    && unknownSelection.diagnostics.unknownSelectedBlueprint,
'unknown tracked/selected ids did not fail closed locally');

const invalidCatalogDuplicate = [COSMETIC_LIST[0], { ...COSMETIC_LIST[0] }];
const invalidSet = [{ id: 'bad_set', name: 'Bad Set', pieces: {
    fur: 'fur_natural', cloak: 'cloak_none', hat: 'hat_none', aura: 'aura_ember', trail: '__missing__',
} }];
for (const options of [
    null,
    { catalog: {} },
    { catalog: invalidCatalogDuplicate },
    { catalog: [{ id: 'fake_blueprint', name: 'Fake', category: 'aura', rarity: 'mythic', blueprintCost: 72000 }], sets: [] },
    { catalog: [{ ...COSMETICS.aura_gloam_moths, blueprintCost: undefined }], sets: [] },
    { ownedIds: {} },
    { ownedIds: ['fur_natural', null] },
    { blueprintClaims: {} },
    { sets: invalidSet },
    { coinBalance: -1 },
    { royalCosmeticPityCount: 1.5 },
    { pursuitSetId: {} },
    { selectedBlueprintId: [] },
]) {
    const result = buildCosmeticCompletionSnapshot(options);
    check(!result.valid && result.unavailable && result.total === 0
        && result.blueprints.length === 0 && result.sets.length === 0,
    'malformed completion input did not fail closed');
    check(recursivelyFrozen(result), 'failed completion snapshot is mutable');
}

const frozenOwnedInput = Object.freeze(['fur_natural', 'cloak_none']);
const frozenOptions = Object.freeze({ ownedIds: frozenOwnedInput, coinBalance: 10 });
const beforeInput = JSON.stringify(frozenOptions);
buildCosmeticCompletionSnapshot(frozenOptions);
check(JSON.stringify(frozenOptions) === beforeInput, 'completion builder mutated caller input');

// Mirror Renderer COVER/CONTAIN and the phone Character content rect so the
// new nested surface is proven against the same resolved viewports as runtime.
function rendererPhoneFixture(winW, winH) {
    const targetRatio = INTERNAL_WIDTH / INTERNAL_HEIGHT;
    const wide = winW / winH > targetRatio;
    const containW = wide ? winH * targetRatio : winW;
    const containH = wide ? winH : winW / targetRatio;
    const coverW = wide ? winW : winH * targetRatio;
    const coverH = wide ? winW / targetRatio : winH;
    const cropFrac = wide
        ? (coverH - winH) / coverH : (coverW - winW) / coverW;
    const cover = cropFrac <= RENDER.maxCoverCrop;
    const cssW = cover ? coverW : containW;
    const cssH = cover ? coverH : containH;
    const internalPerCss = INTERNAL_WIDTH / cssW;
    const safe = {
        left: Math.max(0, (cssW - winW) / 2) * internalPerCss,
        right: Math.max(0, (cssW - winW) / 2) * internalPerCss,
        top: Math.max(0, (cssH - winH) / 2) * internalPerCss,
        bottom: Math.max(0, (cssH - winH) / 2) * internalPerCss,
    };
    const cssScale = cssW / INTERNAL_WIDTH;
    const sectionBar = computePhoneSectionBarLayout(safe, cssScale);
    return {
        cssW, cssH, cssScale, safe,
        content: {
            x: safe.left + 56,
            y: safe.top + 184 + sectionBar.subRowH,
            w: INTERNAL_WIDTH - safe.left - safe.right - 112,
            h: INTERNAL_HEIGHT - safe.bottom - 40
                - (safe.top + 184 + sectionBar.subRowH),
        },
    };
}

const completionViewports = [
    ['932x430', rendererPhoneFixture(932, 430), [932, 524.25]],
    ['667x375', rendererPhoneFixture(667, 375), [667, 375.1875]],
    ['568x320', rendererPhoneFixture(568, 320), [568.8888888889, 320]],
    ['480x270', rendererPhoneFixture(480, 270), [480, 270]],
];
for (const [viewport, fixture, resolved] of completionViewports) {
    close(fixture.cssW, resolved[0], `${viewport} resolved width drifted`, 0.001);
    close(fixture.cssH, resolved[1], `${viewport} resolved height drifted`, 0.001);
    for (const section of ['overview', 'sets', 'sources', 'blueprint', 'case']) {
        const layout = computePhoneCollectionCompletionLayout(fixture.content, {
            cssScale: fixture.cssScale,
            section,
        });
        check(layout.phone && layout.section === section,
            `${viewport}/${section}: layout receipt drifted`);
        check(layout.touchSafe && layout.geometrySafe && layout.contained
            && layout.nonOverlapping && layout.minTouchCss >= 44,
        `${viewport}/${section}: helper geometry fell below the 44 CSS-px contract`);
        const rects = [layout.backButton, ...layout.tabRects];
        if (section === 'sets') rects.push(layout.previousButton, layout.nextButton);
        if (section === 'blueprint') {
            rects.push(...layout.blueprintSelectors,
                layout.caseTruthButton, layout.purchaseButton);
            check(layout.blueprintCopy.y + layout.blueprintCopy.h
                <= layout.caseTruthButton.y - layout.gap + 0.001,
            `${viewport}/${section}: disclosure copy was not reserved above actions`);
            check(layout.compactBlueprint === (viewport === '480x270'),
                `${viewport}/${section}: compact disclosure breakpoint drifted`);
        }
        for (const rect of rects) {
            check(Math.min(rect.w, rect.h) * fixture.cssScale >= 44,
                `${viewport}/${section}: target below 44 CSS px`);
            check(rect.x >= fixture.content.x && rect.y >= fixture.content.y
                && rect.x + rect.w <= fixture.content.x + fixture.content.w + 0.001
                && rect.y + rect.h <= fixture.content.y + fixture.content.h + 0.001,
            `${viewport}/${section}: target escaped content bounds`);
        }
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i], b = rects[j];
                check(a.x + a.w <= b.x + 0.001 || b.x + b.w <= a.x + 0.001
                    || a.y + a.h <= b.y + 0.001 || b.y + b.h <= a.y + 0.001,
                `${viewport}/${section}: targets ${i}/${j} overlap`);
            }
        }
    }
}

// Route the same resolved canvases through the production Character entrypoint.
// This catches ordering regressions where the open Completion check can bypass
// the phone classifier and accidentally paint the desktop surface on a phone.
for (const [viewport, fixture] of completionViewports) {
    const routed = new MenuRenderer({
        cssWidth: fixture.cssW,
        cssHeight: fixture.cssH,
        dpr: 1,
        safeArea: fixture.safe,
    });
    let branch = '';
    routed._drawPhoneCharacter = () => { branch = 'phone'; };
    routed._drawCollectionCompletion = () => { branch = 'desktop-completion'; };
    routed._drawCharacter({}, { collectionCompletion: { open: true } });
    check(branch === 'phone',
        `${viewport}: production Character entrypoint bypassed phone Completion`);
}
{
    const routed = new MenuRenderer({
        cssWidth: 1600,
        cssHeight: 900,
        dpr: 1,
        safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
    });
    let branch = '';
    routed._drawPhoneCharacter = () => { branch = 'phone'; };
    routed._drawCollectionCompletion = (ctx, state, content, options) => {
        branch = options?.phone === false ? 'desktop-completion' : 'wrong-options';
    };
    routed._drawCharacter({}, { collectionCompletion: { open: true } });
    check(branch === 'desktop-completion',
        'desktop Character entrypoint did not retain the desktop Completion branch');
}

// Exercise every Completion section through the production renderer and assert
// the actual registered hotspots, authority copy, and phone receipt—not only
// the helper rectangles above.
const phone480 = completionViewports.at(-1)[1];
const renderer = new MenuRenderer({
    cssWidth: phone480.cssW,
    cssHeight: phone480.cssH,
    dpr: 1,
    safeArea: phone480.safe,
});
renderer._panel = () => {};
renderer._cosmeticSwatch = () => {};
renderer._reducedMotion = true;
const texts = [];
const recordCtx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
    beginPath() {}, roundRect() {}, fill() {}, stroke() {}, save() {}, restore() {},
    clip() {}, fillRect() {}, fillText(value) { texts.push(String(value)); }, drawImage() {},
    measureText(value) {
        const fontPx = Number(/([0-9.]+)px/.exec(this.font)?.[1]) || 12;
        return { width: String(value ?? '').length * fontPx * 0.58 };
    },
};
const completionState = {
    saveData: {
        totalCoins: 80000,
        cosmetics: {
            unlocked: COSMETIC_LIST.filter((item) => item.defaultUnlocked).map((item) => item.id),
            blueprintClaims: [],
            pursuitSetId: null,
        },
        casePity: { royalCosmetic: 0 },
    },
    collectionCompletion: {
        open: true, section: 'overview', page: 1, blueprintId: 'aura_requiem',
    },
    blueprintConfirm: null,
    blueprintPurchasePending: null,
    blueprintReceipt: null,
};
const expectedActions = {
    overview: ['collectionCompletionBack', 'collectionCompletionSection'],
    sets: ['collectionCompletionBack', 'collectionCompletionSection', 'collectionCompletionPage'],
    sources: ['collectionCompletionBack', 'collectionCompletionSection'],
    blueprint: [
        'collectionCompletionBack', 'collectionCompletionSection',
        'collectionCompletionBlueprint', 'purchaseCollectionBlueprint',
    ],
    case: ['collectionCompletionBack', 'collectionCompletionSection'],
};
for (const section of Object.keys(expectedActions)) {
    renderer.hotspots = [];
    texts.length = 0;
    completionState.collectionCompletion = {
        ...completionState.collectionCompletion,
        section,
    };
    renderer._drawCollectionCompletion(recordCtx, completionState,
        phone480.content, { phone: true, cssScale: phone480.cssScale });
    check(renderer._lastCollectionCompletionRendered
        && renderer._lastCollectionCompletionSection === section
        && renderer._lastCollectionCompletionTouchSafe
        && renderer._lastCollectionCompletionMinTouchCss >= 44
        && renderer._lastCollectionCompletionTextSafe,
    `${section}: production renderer omitted its touch/text-safe receipt`);
    for (const action of expectedActions[section]) {
        check(renderer.hotspots.some((hotspot) => hotspot.action === action),
            `${section}: production renderer omitted ${action}`);
    }
    check(renderer.hotspots.every((hotspot) =>
        Math.min(hotspot.w, hotspot.h) * phone480.cssScale >= 44),
    `${section}: production renderer registered a sub-44 CSS-px hotspot`);
    for (let i = 0; i < renderer.hotspots.length; i += 1) {
        const a = renderer.hotspots[i];
        for (let j = i + 1; j < renderer.hotspots.length; j += 1) {
            const b = renderer.hotspots[j];
            check(a.x + a.w <= b.x + 0.001 || b.x + b.w <= a.x + 0.001
                || a.y + a.h <= b.y + 0.001 || b.y + b.h <= a.y + 0.001,
            `${section}: production hotspots ${i}/${j} overlap`);
        }
    }
    if (section === 'overview') {
        check(texts.some((text) => text.includes('85'))
            && texts.some((text) => text.includes('18'))
            && texts.some((text) => text.includes('DO NOT ADD TO 103')),
        'Overview omitted model-driven known/random/overlap truth');
    }
    if (section === 'blueprint') {
        check(texts.some((text) => text.includes('GUARANTEED · KNOWN PRICE'))
            && texts.some((text) => text.includes('80 ROYAL COSMETIC CASE ENTRY FEES'))
            && texts.some((text) => text.includes('NOT A MYTHIC GUARANTEE'))
            && !texts.some((text) => /cheaper|better value|guaranteed case/i.test(text)),
        'Blueprint detail contains misleading or incomplete certainty copy');
    }
    if (section === 'case') {
        check(texts.some((text) => text.includes('ITEM 82%'))
            && texts.some((text) => text.includes('COINS 10.8%'))
            && texts.some((text) => text.includes('VIGIL XP 7.2%'))
            && texts.some((text) => text.includes('NOT A MYTHIC GUARANTEE')),
        'Royal Case Truth omitted branch/pity disclosure');
        const truth = renderer._lastCollectionCompletionCaseTruth;
        const mythic = truth?.rarities?.find((row) => row.id === 'mythic');
        check(truth?.valid && truth.poolTotal === 59
            && truth.branches.itemBasisPoints === 8200
            && truth.branches.coinBasisPoints === 1080
            && truth.branches.battlePassXpBasisPoints === 720
            && mythic?.basisPoints === 150
            && truth.pity.cap === 10 && truth.pity.count === 0
            && truth.pity.forcedNext === false,
        'production Case Truth receipt drifted from exact Royal authority');
    }
}

// Every required phone canvas must traverse each production painter with a
// truthful fitted-font lane receipt. This is the regression gate for the dense
// 480 Overview/Sources/Case compositions and their larger siblings.
for (const [viewport, fixture] of completionViewports) {
    const candidate = new MenuRenderer({
        cssWidth: fixture.cssW,
        cssHeight: fixture.cssH,
        dpr: 1,
        safeArea: fixture.safe,
    });
    candidate._panel = () => {};
    candidate._cosmeticSwatch = () => {};
    candidate._reducedMotion = true;
    for (const section of Object.keys(expectedActions)) {
        candidate.hotspots = [];
        texts.length = 0;
        completionState.collectionCompletion = {
            ...completionState.collectionCompletion,
            section,
        };
        completionState.blueprintReceipt = null;
        candidate._drawCollectionCompletion(recordCtx, completionState,
            fixture.content, { phone: true, cssScale: fixture.cssScale });
        check(candidate._lastCollectionCompletionTextSafe === true,
            `${viewport}/${section}: fitted production text lanes are unsafe`);
        check(candidate._lastCollectionCompletionTouchSafe === true,
            `${viewport}/${section}: production touch receipt regressed`);
    }
}

// Compact Blueprint failures must replace the normal wallet pitch with the
// exact no-charge recovery instruction on the 480 floor.
for (const [reason, fragments] of [
    ['external-save-changed', ['SAVE CHANGED ELSEWHERE', 'NOT CHARGED', 'RELOAD']],
    ['persistence-unavailable', ['SAVE STORAGE UNAVAILABLE', 'NOT CHARGED', 'RETRY']],
    ['persistence-failed', ['SAVE FAILED', 'NOT CHARGED', 'RETRY']],
    ['transaction-busy', ['ANOTHER TAB IS SAVING', 'NOT CHARGED', 'TRY AGAIN']],
    ['transaction-lock-unavailable', ['SAFE SAVE LOCK UNAVAILABLE', 'NOT CHARGED', 'UPDATE BROWSER']],
    ['transaction-lock-failed', ['SAFE SAVE LOCK FAILED', 'NOT CHARGED', 'TRY AGAIN']],
]) {
    renderer.hotspots = [];
    texts.length = 0;
    completionState.collectionCompletion = {
        ...completionState.collectionCompletion,
        section: 'blueprint',
        blueprintId: 'aura_requiem',
    };
    completionState.blueprintReceipt = {
        ok: false, kind: 'error', reason,
        id: 'aura_requiem', name: 'Requiem Orbit', cost: 72000,
        balance: 80000, shortfall: 0,
    };
    renderer._drawCollectionCompletion(recordCtx, completionState,
        phone480.content, { phone: true, cssScale: phone480.cssScale });
    const painted = texts.join(' | ');
    check(fragments.every((fragment) => painted.includes(fragment))
        && renderer._lastCollectionCompletionTextSafe,
    `480 Blueprint ${reason}: compact recovery copy is hidden or unsafe`);
}
completionState.blueprintReceipt = null;
renderer.hotspots = [];
texts.length = 0;
completionState.blueprintPurchasePending = { id: 'aura_requiem' };
renderer._drawCollectionCompletion(recordCtx, completionState,
    phone480.content, { phone: true, cssScale: phone480.cssScale });
check(texts.some((text) => text.includes('SECURING SAVE ACROSS TABS'))
    && !renderer.hotspots.some((hotspot) =>
        hotspot.action === 'purchaseCollectionBlueprint')
    && renderer._lastCollectionCompletionTextSafe,
'480 Blueprint atomic pending state is visible, disabled, and text-safe');
completionState.blueprintPurchasePending = null;
check(MenuRenderer.prototype._drawCompletionSets.toString().includes('model.sets.length')
    && !MenuRenderer.prototype._drawCompletionSets.toString().includes('ALL 15 SETS'),
'Sets pager derives its total from the completion model');

// A live pity counter must cross the completion model and the painted Case
// surface through one authority; the renderer cannot silently fall back to 0/10.
renderer.hotspots = [];
texts.length = 0;
completionState.saveData.casePity.royalCosmetic = 9;
completionState.collectionCompletion = {
    ...completionState.collectionCompletion,
    section: 'case',
};
renderer._drawCollectionCompletion(recordCtx, completionState,
    phone480.content, { phone: true, cssScale: phone480.cssScale });
check(renderer._lastCollectionCompletionModel.selectedBlueprint.royalCase.pity.forcedNext
    && renderer._lastCollectionCompletionModel.selectedBlueprint.royalCase.pity.count === 9
    && renderer._lastCollectionCompletionCaseTruth.pity.forcedNext
    && renderer._lastCollectionCompletionCaseTruth.pity.count === 9,
'production completion model and Case Truth lost live 9/10 pity state');

console.log(`collection completion validation: OK — ${checks} deterministic checks passed.`);
