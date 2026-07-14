#!/usr/bin/env node
// Browser-free reachability checks for the paged Character collection and its
// real MenuRenderer/case-reel integration seams.
// Run from the repository root:
//   node tools/validate-cosmetic-collection.js

import assert from 'node:assert/strict';
import * as CosmeticContent from '../src/content/cosmetics.js';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH, RENDER } from '../src/config/GameConfig.js';
import {
    MenuRenderer,
    boutiquePreviewGuidance,
    boutiqueTrailPreviewPoints,
    computePhoneCharacterCollectionLayout,
    computePhoneHeroRitesLayout,
    computePhoneSectionBarLayout,
    isPhoneLandscapeViewport,
    tabUnlocked,
} from '../src/systems/MenuRenderer.js';
import { buildCaseReel } from '../src/systems/CaseSystem.js';
import {
    COSMETIC_COLLECTION_CATEGORY_FILTERS,
    COSMETIC_COLLECTION_OWNERSHIP_FILTERS,
    COSMETIC_COLLECTION_PAGE_SIZE,
    COSMETIC_COLLECTION_SOURCE_FILTERS,
    buildCosmeticCollectionPage,
    cosmeticCollectionSources,
    filterCosmeticCollection,
    isCosmeticCollectionCategoryFilter,
    isCosmeticCollectionOwnershipFilter,
    isCosmeticCollectionSourceFilter,
    normalizeCosmeticCollectionCategory,
    normalizeCosmeticCollectionOwnership,
    normalizeCosmeticCollectionPage,
    normalizeCosmeticCollectionSource,
} from '../src/systems/CosmeticCollection.js';

const { COSMETIC_CATEGORIES, COSMETIC_LIST } = CosmeticContent;
const CONTENT_ROUTE_ORDER = ['starter', 'boutique', 'case', 'achievement', 'vigil'];

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks += 1;
}
function same(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    checks += 1;
}

function fieldRoutes(item) {
    if (!item || typeof item !== 'object') return [];
    const routes = [];
    if (item.defaultUnlocked === true) routes.push('starter');
    if (Number.isFinite(item.coinCost) && item.coinCost > 0) routes.push('boutique');
    if (item.defaultUnlocked !== true && item.caseExcluded !== true) routes.push('case');
    if (typeof item.achievement === 'string' && item.achievement) routes.push('achievement');
    if (Number.isInteger(item.passLevel) && item.passLevel > 0) routes.push('vigil');
    return routes;
}

const contentRoutes = typeof CosmeticContent.getCosmeticAcquisitionRoutes === 'function'
    ? CosmeticContent.getCosmeticAcquisitionRoutes
    : fieldRoutes;

function expectedItems(catalog, { category, ownership, source, ownedIds }) {
    const owned = new Set(ownedIds);
    return catalog.filter((item) => {
        if (category !== 'all' && item.category !== category) return false;
        if (ownership === 'owned' && !owned.has(item.id)) return false;
        if (ownership === 'locked' && owned.has(item.id)) return false;
        return source === 'all' || contentRoutes(item).includes(source);
    });
}

function validateTraversal(label, options, expected) {
    const pageCount = Math.ceil(expected.length / COSMETIC_COLLECTION_PAGE_SIZE);
    const first = buildCosmeticCollectionPage({ ...options, page: 1 });
    check(first.totalItems === expected.length, `${label}: total item count drifted`);
    check(first.totalCount === first.totalItems, `${label}: renderer total-count alias drifted`);
    check(first.pageCount === pageCount, `${label}: page count drifted`);
    check(first.pageSize === 8, `${label}: page size is not exactly eight`);
    check(Object.isFrozen(first), `${label}: page model is mutable`);
    check(Object.isFrozen(first.entries), `${label}: page entries array is mutable`);
    check(Object.isFrozen(first.items), `${label}: page items array is mutable`);
    check(Object.isFrozen(first.itemIds), `${label}: page id array is mutable`);
    check(Object.isFrozen(first.filters), `${label}: normalized filters are mutable`);
    check(Object.isFrozen(first.nav), `${label}: navigation model is mutable`);
    check(Object.isFrozen(first.diagnostics), `${label}: diagnostics are mutable`);

    if (expected.length === 0) {
        check(first.empty === true, `${label}: empty result is not explicit`);
        check(first.page === 0 && first.pageIndex === 0, `${label}: empty page is not normalized to zero`);
        check(first.emptyState?.code === 'no-matches', `${label}: empty state is missing`);
        check(typeof first.emptyState?.label === 'string' && first.emptyState.label.length > 0,
            `${label}: renderer empty-state label is missing`);
        check(Object.isFrozen(first.emptyState), `${label}: empty state is mutable`);
        check(first.hasPreviousPage === false && first.hasNextPage === false, `${label}: empty nav is active`);
        same(first.itemIds, [], `${label}: empty page exposed ids`);
        return;
    }

    check(first.empty === false && first.emptyState === null, `${label}: populated page reports empty`);
    const visited = [];
    for (let page = 1; page <= pageCount; page++) {
        const view = buildCosmeticCollectionPage({ ...options, page });
        const start = (page - 1) * COSMETIC_COLLECTION_PAGE_SIZE;
        const slice = expected.slice(start, start + COSMETIC_COLLECTION_PAGE_SIZE);
        const ids = slice.map((item) => item.id);

        check(view.page === page, `${label}: page ${page} normalized incorrectly`);
        check(view.pageIndex === page - 1, `${label}: page ${page} has the wrong layout index`);
        check(view.startIndex === start, `${label}: page ${page} has the wrong start index`);
        check(view.endIndex === start + slice.length, `${label}: page ${page} has the wrong end index`);
        check(view.firstItemNumber === start + 1, `${label}: page ${page} has the wrong first item number`);
        check(view.lastItemNumber === start + slice.length, `${label}: page ${page} has the wrong last item number`);
        check(view.hasPreviousPage === (page > 1), `${label}: page ${page} previous nav drifted`);
        check(view.hasNextPage === (page < pageCount), `${label}: page ${page} next nav drifted`);
        check(view.hasPrev === view.hasPreviousPage, `${label}: page ${page} previous alias drifted`);
        check(view.hasNext === view.hasNextPage, `${label}: page ${page} next alias drifted`);
        check(view.nav.previousPage === (page > 1 ? page - 1 : null),
            `${label}: page ${page} previous target drifted`);
        check(view.nav.nextPage === (page < pageCount ? page + 1 : null),
            `${label}: page ${page} next target drifted`);
        check(view.entries.length === slice.length, `${label}: page ${page} entry count drifted`);
        check(view.entries.length <= 8, `${label}: page ${page} exceeds eight items`);
        if (page < pageCount) {
            check(view.entries.length === 8, `${label}: non-final page ${page} is not full`);
        }
        same(view.itemIds, ids, `${label}: page ${page} order drifted`);
        same(view.items, slice, `${label}: page ${page} item references drifted`);

        for (let index = 0; index < view.entries.length; index++) {
            const entry = view.entries[index];
            const item = slice[index];
            check(Object.isFrozen(entry), `${label}: page ${page} entry ${item.id} is mutable`);
            check(entry.id === item.id && entry.item === item, `${label}: entry ${item.id} lost identity`);
            check(entry.owned === new Set(options.ownedIds).has(item.id), `${label}: ${item.id} ownership drifted`);
            same(entry.sources, contentRoutes(item), `${label}: ${item.id} route metadata drifted`);
        }
        visited.push(...view.itemIds);
    }

    same(visited, expected.map((item) => item.id), `${label}: traversal skipped or reordered items`);
    check(new Set(visited).size === visited.length, `${label}: traversal duplicated an item`);

    const low = buildCosmeticCollectionPage({ ...options, page: -999 });
    const high = buildCosmeticCollectionPage({ ...options, page: 999999 });
    check(low.page === 1, `${label}: negative page did not clamp to one`);
    check(high.page === pageCount, `${label}: oversized page did not clamp to the final page`);
}

function validateFilterMatrix(label, catalog) {
    const ownedIds = new Set(catalog
        .filter((item, index) => item.defaultUnlocked === true || index % 3 === 0)
        .map((item) => item.id));

    for (const category of COSMETIC_COLLECTION_CATEGORY_FILTERS) {
        for (const ownership of COSMETIC_COLLECTION_OWNERSHIP_FILTERS) {
            for (const source of COSMETIC_COLLECTION_SOURCE_FILTERS) {
                const options = { catalog, category, ownership, source, ownedIds };
                const expected = expectedItems(catalog, options);
                const filtered = filterCosmeticCollection(options);
                const caseLabel = `${label}/${category}/${ownership}/${source}`;
                same(filtered, expected, `${caseLabel}: stable filtering drifted`);
                validateTraversal(caseLabel, options, expected);
            }
        }
    }
}

// Public filter ids are persistence/action contracts. They stay exact,
// lowercase, ordered, and frozen so the renderer can fail closed.
check(COSMETIC_COLLECTION_PAGE_SIZE === 8, 'collection page size must remain eight');
same(COSMETIC_COLLECTION_CATEGORY_FILTERS, ['all', ...COSMETIC_CATEGORIES], 'category filters drifted');
same(COSMETIC_COLLECTION_OWNERSHIP_FILTERS, ['all', 'owned', 'locked'], 'ownership filters drifted');
same(COSMETIC_COLLECTION_SOURCE_FILTERS,
    ['all', 'starter', 'boutique', 'case', 'achievement', 'vigil'],
    'source filters drifted');
for (const filters of [
    COSMETIC_COLLECTION_CATEGORY_FILTERS,
    COSMETIC_COLLECTION_OWNERSHIP_FILTERS,
    COSMETIC_COLLECTION_SOURCE_FILTERS,
]) check(Object.isFrozen(filters), 'exported filter ids must be frozen');

for (const id of COSMETIC_COLLECTION_CATEGORY_FILTERS) {
    check(isCosmeticCollectionCategoryFilter(id), `valid category filter ${id} was rejected`);
    check(normalizeCosmeticCollectionCategory(id) === id, `category filter ${id} did not normalize`);
}
for (const id of COSMETIC_COLLECTION_OWNERSHIP_FILTERS) {
    check(isCosmeticCollectionOwnershipFilter(id), `valid ownership filter ${id} was rejected`);
    check(normalizeCosmeticCollectionOwnership(id) === id, `ownership filter ${id} did not normalize`);
}
for (const id of COSMETIC_COLLECTION_SOURCE_FILTERS) {
    check(isCosmeticCollectionSourceFilter(id), `valid source filter ${id} was rejected`);
    check(normalizeCosmeticCollectionSource(id) === id, `source filter ${id} did not normalize`);
}
for (const invalid of [null, '', ' fur', 'FUR', 'weapon', 1, {}, []]) {
    check(!isCosmeticCollectionCategoryFilter(invalid), `invalid category ${String(invalid)} was accepted`);
    check(normalizeCosmeticCollectionCategory(invalid) === null, `invalid category ${String(invalid)} did not fail closed`);
}
for (const invalid of [null, '', ' Owned', 'OWNED', 'unknown', 1, {}, []]) {
    check(!isCosmeticCollectionOwnershipFilter(invalid), `invalid ownership ${String(invalid)} was accepted`);
    check(normalizeCosmeticCollectionOwnership(invalid) === null, `invalid ownership ${String(invalid)} did not fail closed`);
}
for (const invalid of [null, '', ' shop', 'shop', 'CASE', 'unknown', 1, {}, []]) {
    check(!isCosmeticCollectionSourceFilter(invalid), `invalid source ${String(invalid)} was accepted`);
    check(normalizeCosmeticCollectionSource(invalid) === null, `invalid source ${String(invalid)} did not fail closed`);
}

same([
    normalizeCosmeticCollectionPage(undefined, 5),
    normalizeCosmeticCollectionPage(null, 5),
    normalizeCosmeticCollectionPage(-4, 5),
    normalizeCosmeticCollectionPage(0, 5),
    normalizeCosmeticCollectionPage(2.9, 5),
    normalizeCosmeticCollectionPage(' 3.8 ', 5),
    normalizeCosmeticCollectionPage(99, 5),
    normalizeCosmeticCollectionPage(Number.NaN, 5),
    normalizeCosmeticCollectionPage(Number.POSITIVE_INFINITY, 5),
    normalizeCosmeticCollectionPage('not-a-page', 5),
    normalizeCosmeticCollectionPage(2, 0),
    normalizeCosmeticCollectionPage(2, -4),
    normalizeCosmeticCollectionPage(2, '5'),
], [1, 1, 1, 1, 2, 3, 5, 1, 1, 1, 0, 0, 0], 'page normalization/clamping drifted');

// The collection route view must match the content source of truth exactly.
for (const item of COSMETIC_LIST) {
    const expected = contentRoutes(item);
    check(expected.every((route) => CONTENT_ROUTE_ORDER.includes(route)), `${item.id} has an unknown content route`);
    same(cosmeticCollectionSources(item), expected, `${item.id} collection routes drifted from content`);
}
same(cosmeticCollectionSources(null), [], 'null item exposed a route');
same(cosmeticCollectionSources({}), [], 'malformed item exposed a route');
const routeCases = {
    fur_natural: ['starter'],
    fur_ashen: ['boutique', 'case'],
    fur_frost: ['case'],
    fur_void: ['case', 'achievement'],
    fur_vigil: ['vigil'],
    fur_waylight: ['achievement'],
};
for (const [id, routes] of Object.entries(routeCases)) {
    const item = COSMETIC_LIST.find((candidate) => candidate.id === id);
    check(!!item, `route fixture ${id} is missing`);
    same(cosmeticCollectionSources(item), routes, `${id} route policy drifted`);
}

// Default catalog use preserves authored order and does not require callers to
// inject content. The full matrix below separately exercises injected catalogs.
const authoredIds = COSMETIC_LIST.map((item) => item.id);
same(filterCosmeticCollection(), COSMETIC_LIST, 'default collection order drifted');
same(buildCosmeticCollectionPage({ page: 1 }).itemIds, authoredIds.slice(0, 8),
    'default collection first page drifted');

validateFilterMatrix('authored', COSMETIC_LIST);

// Every item that the old one-screen category grid clipped after slot eight is
// now reachable on a deterministic category page. Keep the named legacy edge
// ids visible in failures and derive the newly-added tail automatically.
const legacyClippedIds = [
    'fur_gold', 'fur_galaxy', 'fur_vigil', 'fur_waylight',
    'cloak_gold', 'cloak_prism', 'cloak_vigil', 'cloak_waylight',
    'hat_crown', 'hat_halo', 'hat_party', 'hat_banana', 'hat_vigil', 'hat_waylight',
    'aura_astral', 'aura_inferno', 'aura_mythic', 'aura_waylight', 'aura_prism',
    'trail_hearts', 'trail_stars', 'trail_flame', 'trail_rainbow', 'trail_vigil', 'trail_waylight',
];
const derivedClippedIds = [];
for (const category of COSMETIC_CATEGORIES) {
    const categoryItems = COSMETIC_LIST.filter((item) => item.category === category);
    derivedClippedIds.push(...categoryItems.slice(8).map((item) => item.id));
    for (let index = 8; index < categoryItems.length; index++) {
        const item = categoryItems[index];
        const page = Math.floor(index / 8) + 1;
        const view = buildCosmeticCollectionPage({ category, page });
        check(view.itemIds.includes(item.id), `${item.id} is still clipped from ${category} page ${page}`);
    }
}
check(derivedClippedIds.length > 0, 'clipped-tail reachability fixture is empty');
for (const id of legacyClippedIds) {
    check(authoredIds.includes(id), `legacy clipped cosmetic ${id} is missing`);
    check(derivedClippedIds.includes(id), `legacy clipped cosmetic ${id} moved outside the paged tail`);
}

// I-A added eight reachability/rig styles; I-B adds a separate 30-look pack.
// Any marker requires its complete slice so a partial content merge cannot
// silently ship. The final authored/projection contract is 103 reachable looks.
const growthIaMarkerIds = [
    'cloak_splitwatch', 'cloak_mothwing', 'hat_waylantern', 'hat_mothmask',
    'aura_oathwheel', 'aura_gloam_moths', 'trail_waymarks', 'trail_gloam_wisps',
];
const growthIbMarkerIds = [
    'fur_kilncracked', 'cloak_coalwing', 'hat_crucible', 'aura_forgehalo', 'trail_slagprints',
    'fur_rimeglass', 'cloak_icefall', 'hat_glaciercrest', 'aura_snowprism', 'trail_hoarfrost',
    'fur_briarhide', 'cloak_thornbough', 'hat_briarhelm', 'aura_brambleward', 'trail_rootstitch',
    'fur_stormglass', 'cloak_stormkite', 'hat_thundercrest', 'aura_tempestcage', 'trail_fulgurite',
    'fur_dunebanded', 'cloak_sunsail', 'hat_sunorrery', 'aura_miragecrown', 'trail_sandglass',
    'fur_ossuary', 'cloak_pallbearer', 'hat_gravebell', 'aura_requiem', 'trail_epitaph',
];
if (growthIaMarkerIds.some((id) => authoredIds.includes(id))) {
    for (const id of growthIaMarkerIds) check(authoredIds.includes(id), `I-A cosmetic ${id} is missing`);
}
if (growthIbMarkerIds.some((id) => authoredIds.includes(id))) {
    check(COSMETIC_LIST.length === 103, 'partial Collection Growth I-B catalog landed; expected 103 items');
    for (const id of growthIbMarkerIds) check(authoredIds.includes(id), `I-B cosmetic ${id} is missing`);
}

function projectedCatalog103() {
    if (COSMETIC_LIST.length === 103) return COSMETIC_LIST;
    const catalog = COSMETIC_LIST.slice(0, 103);
    for (let index = catalog.length; index < 103; index++) {
        const item = {
            id: `collection_projection_${index + 1}`,
            category: COSMETIC_CATEGORIES[index % COSMETIC_CATEGORIES.length],
            name: `Projection ${index + 1}`,
            rarity: 'common',
        };
        if (index % 5 === 0) item.defaultUnlocked = true;
        else if (index % 5 === 1) item.coinCost = 100 + index;
        else if (index % 5 === 2) item.achievement = `projection_${index}`;
        else if (index % 5 === 3) {
            item.passLevel = index + 1;
            item.caseExcluded = true;
        }
        catalog.push(Object.freeze(item));
    }
    return Object.freeze(catalog);
}

const projected = projectedCatalog103();
check(projected.length === 103, 'projected catalog is not exactly 103 items');
const projectedOwned = new Set(projected.filter((_, index) => index % 2 === 0).map((item) => item.id));
const projectedAll = buildCosmeticCollectionPage({ catalog: projected, ownedIds: projectedOwned, page: 1 });
check(projectedAll.pageCount === 13, '103-item collection must span thirteen pages');
validateTraversal('projected-103/all/all/all',
    { catalog: projected, category: 'all', ownership: 'all', source: 'all', ownedIds: projectedOwned },
    projected);
if (projected !== COSMETIC_LIST) validateFilterMatrix('projected-103', projected);

// Malformed requests and catalogs expose no cosmetics. Valid records preserve
// first occurrence/order while malformed and duplicate records are discarded.
for (const [options, code, key] of [
    [{ category: 'weapon' }, 'invalid-filter', 'category'],
    [{ ownership: 'OWNED' }, 'invalid-filter', 'ownership'],
    [{ source: 'shop' }, 'invalid-filter', 'source'],
]) {
    const view = buildCosmeticCollectionPage(options);
    check(view.empty && view.totalItems === 0, `${key} filter did not fail closed`);
    check(view.emptyState?.code === code, `${key} filter has the wrong empty state`);
    check(view.invalidFilters.includes(key), `${key} invalid-filter diagnostic is missing`);
}

const invalidOptions = buildCosmeticCollectionPage(null);
check(invalidOptions.emptyState?.code === 'invalid-options', 'invalid options did not fail closed');
same(filterCosmeticCollection(null), [], 'invalid filter options exposed cosmetics');
const invalidCatalog = buildCosmeticCollectionPage({ catalog: {} });
check(invalidCatalog.emptyState?.code === 'invalid-catalog', 'invalid catalog did not fail closed');
check(invalidCatalog.diagnostics.invalidCatalog === true, 'invalid catalog diagnostic is missing');
const invalidOwnership = buildCosmeticCollectionPage({ ownedIds: {}, ownership: 'locked' });
check(invalidOwnership.emptyState?.code === 'invalid-ownership-data', 'invalid owned ids did not fail closed');
check(invalidOwnership.diagnostics.invalidOwnershipData === true, 'invalid owned-id diagnostic is missing');

const firstValid = Object.freeze({
    id: 'validator_first', category: 'fur', name: 'First', rarity: 'common', defaultUnlocked: true,
});
const secondValid = Object.freeze({
    id: 'validator_second', category: 'trail', name: 'Second', rarity: 'rare', caseExcluded: true,
});
const malformedCatalog = Object.freeze([
    firstValid,
    null,
    { id: 'missing_category' },
    { id: 'bad_category', category: 'weapon' },
    { ...firstValid, name: 'Duplicate must not win' },
    secondValid,
]);
const frozenOptions = Object.freeze({ catalog: malformedCatalog, ownedIds: Object.freeze([]), page: 1 });
const sanitized = buildCosmeticCollectionPage(frozenOptions);
same(sanitized.itemIds, ['validator_first', 'validator_second'], 'catalog sanitization changed stable order');
check(sanitized.items[0] === firstValid, 'later duplicate replaced the stable first item');
check(sanitized.diagnostics.invalidItems === 3, 'malformed item count drifted');
check(sanitized.diagnostics.duplicateIds === 1, 'duplicate item count drifted');
check(malformedCatalog.length === 6, 'collection mutated the input catalog');

const noMatches = buildCosmeticCollectionPage({
    catalog: [firstValid], ownership: 'owned', ownedIds: [], page: 99,
});
check(noMatches.emptyState?.code === 'no-matches', 'valid empty result lacks the no-matches state');
check(noMatches.page === 0 && noMatches.pageCount === 0, 'valid empty result exposes an unreachable page');

// Exercise the production Character page method without a browser Canvas. The
// visual primitives are replaced by recorders, but the real page model,
// geometry, filters, page controls, and item dispatch loop all execute.
const renderer = new MenuRenderer({ safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
const rendered = [];
const renderedText = [];
const segmentedActions = [];
const pageButtons = [];
renderer._panel = () => {};
renderer._segmentedRow = (_ctx, options, selected, x, y, w, h, action) => {
    check(Array.isArray(options) && options.length >= 3, `${action}: missing segmented choices`);
    check(options.some((option) => option.id === selected), `${action}: selected choice is absent`);
    check(w > 0 && h > 0 && Number.isFinite(x + y), `${action}: invalid segmented geometry`);
    segmentedActions.push(action);
};
renderer._drawCollectionCard = (_ctx, _state, entry, rect, _mode, presentation) => {
    check(rect.w > 0 && rect.h > 0, `${entry.id}: non-positive card geometry`);
    rendered.push({ id: entry.id, rect, phone: presentation?.phone === true });
};
renderer._button = (_ctx, rect, label, options = {}) => {
    check(rect.w > 0 && rect.h > 0, `${label}: non-positive pager geometry`);
    pageButtons.push({ rect, label, options });
};
const recordCtx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillText(value) { renderedText.push(String(value)); },
    measureText(value) { return { width: String(value ?? '').length * 7 }; },
};
const renderState = {
    saveData: {
        cosmetics: {
            unlocked: COSMETIC_LIST.filter((_, index) => index % 3 === 0).map((item) => item.id),
            equipped: { fur: 'fur_natural', cloak: 'cloak_none', hat: 'hat_none', aura: 'aura_ember', trail: 'trail_none' },
            pursuitSetId: 'stormglass',
        },
    },
    collectionView: { category: 'hat', ownership: 'all', source: 'all', page: 1 },
    tryOn: {},
};
const collectionRect = { x: 540, y: 250, w: 980, h: 390 };
for (const page of [1, 2]) {
    rendered.length = 0;
    renderedText.length = 0;
    segmentedActions.length = 0;
    pageButtons.length = 0;
    renderState.collectionView.page = page;
    renderer._drawCosmeticCollection(recordCtx, renderState, collectionRect);
    const expected = buildCosmeticCollectionPage({
        category: 'hat', ownership: 'all', source: 'all', page,
        ownedIds: renderState.saveData.cosmetics.unlocked,
    });
    same(rendered.map((entry) => entry.id), expected.itemIds,
        `renderer hat page ${page} diverged from collection authority`);
    check(renderedText.some((text) => text.includes(`${expected.totalItems} MATCHES`)
        && text.includes('OWNED') && text.includes('SETS')),
    `renderer hat page ${page} lacks clear matches/owned/set summary copy`);
    check(renderedText.every((text) => !text.includes(' SHOWN')),
        `renderer hat page ${page} retained ambiguous SHOWN copy`);
    same(segmentedActions, ['collectionCategory', 'collectionOwnership', 'collectionSource'],
        `renderer hat page ${page} omitted a filter lane`);
    check(pageButtons.length === 2, `renderer hat page ${page} omitted pager controls`);
    for (let i = 0; i < rendered.length; i++) {
        const a = rendered[i].rect;
        check(a.x >= collectionRect.x && a.y >= collectionRect.y
            && a.x + a.w <= collectionRect.x + collectionRect.w
            && a.y + a.h <= collectionRect.y + collectionRect.h,
        `${rendered[i].id}: renderer card escapes the collection panel`);
        for (let j = i + 1; j < rendered.length; j++) {
            const b = rendered[j].rect;
            check(!(a.x < b.x + b.w && a.x + a.w > b.x
                && a.y < b.y + b.h && a.y + a.h > b.y),
            `${rendered[i].id}/${rendered[j].id}: renderer cards overlap`);
        }
    }
}

// Mirror Renderer.resize/_computeSafeArea for a zero-notch viewport, then feed
// its exact content rect to the responsive layout. This intentionally derives
// COVER vs CONTAIN from RENDER.maxCoverCrop instead of baking in a screenshot
// assumption that can drift away from production.
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
    const sectionBar = computePhoneSectionBarLayout(safe, cssW / INTERNAL_WIDTH);
    return {
        cover, cropFrac, cssW, cssH, cssScale: cssW / INTERNAL_WIDTH, safe, sectionBar,
        content: {
            x: safe.left + 56,
            y: safe.top + 184 + sectionBar.subRowH,
            w: INTERNAL_WIDTH - safe.left - safe.right - 112,
            h: INTERNAL_HEIGHT - safe.bottom - 40
                - (safe.top + 184 + sectionBar.subRowH),
        },
    };
}
const exactPhone = rendererPhoneFixture(844, 390);
check(exactPhone.cover === true && exactPhone.cropFrac <= RENDER.maxCoverCrop,
    '844x390 no longer selects Renderer COVER mode');
check(Math.abs(exactPhone.cssScale - (844 / 1920)) < 0.000001
    && Math.abs(exactPhone.safe.top - 96.3981042654) < 0.001,
'844x390 Renderer scale/safe crop drifted');
check(exactPhone.sectionBar.touchSafe === true
    && exactPhone.sectionBar.minTouchCss >= 44,
'844x390 Character section bar fell below the touch floor');
check(Math.abs(exactPhone.content.y - 319.3981042654) < 0.001
    && Math.abs(exactPhone.content.h - 624.2037914692) < 0.001,
'844x390 exact Character content geometry drifted');
const phoneCssScale = exactPhone.cssScale;
const phoneContent = exactPhone.content;
const phoneLayout = computePhoneCharacterCollectionLayout(phoneContent, {
    cssScale: phoneCssScale,
});
const canonicalPhone = rendererPhoneFixture(667, 375);
const canonicalLayout = computePhoneCharacterCollectionLayout(canonicalPhone.content, {
    cssScale: canonicalPhone.cssScale,
});
check(canonicalPhone.sectionBar.touchSafe === true && canonicalLayout.touchSafe === true,
    'canonical 667x375 phone layout fell below the 44 CSS-px target floor');
check(canonicalLayout.variant === 'rich' && canonicalLayout.compact === false,
    'canonical 667x375 phone lost the rich live-look rail');
check(Math.round(canonicalPhone.cssW) === 667 && Math.round(canonicalPhone.cssH) === 375,
    'canonical 667x375 phone no longer yields an honest 667x375 canvas receipt');

const resolvedPhoneFixtures = [
    ['932x430', rendererPhoneFixture(932, 430)],
    ['667x375', canonicalPhone],
    ['568x320', rendererPhoneFixture(568, 320)],
    ['480x270', rendererPhoneFixture(480, 270)],
];
for (const [label, fixture] of resolvedPhoneFixtures) {
    const [rawW, rawH] = label.split('x').map(Number);
    check(isPhoneLandscapeViewport(rawW, rawH), `${label} raw viewport is not classified as phone landscape`);
    check(isPhoneLandscapeViewport(fixture.cssW, fixture.cssH),
        `${label} resolved Renderer canvas is not classified as phone landscape`);
}
check(Math.abs(resolvedPhoneFixtures[0][1].cssW - 932) < 0.001
    && Math.abs(resolvedPhoneFixtures[0][1].cssH - 524.25) < 0.001,
'932x430 COVER fixture no longer resolves to the production 932x524.25 canvas');
for (const [w, h, label] of [
    [1024, 576, 'landscape tablet'], [768, 1024, 'portrait tablet'], [1600, 900, 'desktop'],
]) check(!isPhoneLandscapeViewport(w, h), `${label} was misclassified as a phone`);

check(tabUnlocked('attune', { onboarding: { tabsSeen: [] }, discoveredRelics: [] }) === false,
    'fresh-save relic ATTUNE route is not locked');
check(tabUnlocked('attune', { onboarding: { tabsSeen: [] }, discoveredRelics: ['emberheart'] }) === true,
    'discovered relic does not unlock the separate ATTUNE route');

for (const [label, fixture] of resolvedPhoneFixtures) {
    const ritesLayout = computePhoneHeroRitesLayout(fixture.content, { cssScale: fixture.cssScale });
    check(ritesLayout.touchSafe && ritesLayout.minTouchCss >= 44,
        `${label} Hero Rites layout fell below the 44 CSS-px floor`);
    same(ritesLayout.riteCards.length, 3, `${label} Hero Rites layout lost a Rite card`);
    for (const [targetLabel, rect] of [
        ['back', ritesLayout.backButton], ['purchase', ritesLayout.purchaseButton],
    ]) check(Math.min(rect.w, rect.h) * fixture.cssScale >= 44,
        `${label} Hero Rites ${targetLabel} target fell below 44 CSS px`);
}

for (const [label, fixture] of resolvedPhoneFixtures.slice(2)) {
    const unsafeRich = computePhoneCharacterCollectionLayout(fixture.content, {
        cssScale: fixture.cssScale,
    });
    const compactLayout = computePhoneCharacterCollectionLayout(fixture.content, {
        cssScale: fixture.cssScale, compact: true,
    });
    check(unsafeRich.touchSafe === false,
        `${label} rich layout unexpectedly claims it is safe enough to render`);
    check(compactLayout.compact === true && compactLayout.touchSafe === true
        && compactLayout.minTouchCss >= 44,
    `${label} compact fallback is not touch-safe`);
    same(compactLayout.compactControls.length, 4,
        `${label} compact fallback lost a filter or Hero Rites control`);
    same(compactLayout.cards.length, 8,
        `${label} compact fallback lost an eight-card page slot`);
    const compactTargets = [
        ...compactLayout.compactControls, ...compactLayout.cards,
        compactLayout.previousButton, compactLayout.nextButton,
    ];
    for (const rect of compactTargets) {
        check(Math.min(rect.w, rect.h) * fixture.cssScale >= 44,
            `${label} compact target fell below 44 CSS px`);
        check(rect.x >= fixture.content.x && rect.y >= fixture.content.y
            && rect.x + rect.w <= fixture.content.x + fixture.content.w + 0.001
            && rect.y + rect.h <= fixture.content.y + fixture.content.h + 0.001,
        `${label} compact target escaped Character content`);
    }
}
const conservativeLayout = computePhoneCharacterCollectionLayout(
    { x: 56, y: 340, w: 1808, h: 557 }, { cssScale: phoneCssScale });
check(conservativeLayout.touchSafe === true,
    'conservative short-phone fixture fell below the 44 CSS-px target floor');
for (const [label, layout] of [
    ['exact', phoneLayout], ['canonical', canonicalLayout], ['conservative', conservativeLayout],
]) {
    const slotBaselineGapCss = (layout.previewSlots[0].h + 6) * layout.cssScale;
    const slotLineBoxCss = layout.previewSlotFontPx * layout.cssScale;
    check(slotBaselineGapCss >= slotLineBoxCss + 2,
        `${label} phone equipped-slot line boxes overlap`);
    check(layout.footerLineClearanceCss >= 4,
        `${label} phone footer summary/tracking line boxes overlap`);
    check(layout.footerSummaryY - layout.footer.y >= layout.footerFontPx * 0.5
        && layout.footer.y + layout.footer.h - layout.footerTrackingY
            >= layout.trackingFontPx * 0.5,
    `${label} phone footer text escapes its pager band`);
    for (let i = 0; i < layout.previewSlots.length; i++) {
        const slot = layout.previewSlots[i];
        const swatch = layout.previewSwatches[i];
        check(swatch.x >= slot.x && swatch.y >= slot.y
            && swatch.x + swatch.w <= slot.x + slot.w
            && swatch.y + swatch.h <= slot.y + slot.h,
        `${label} phone equipped swatch escapes its row`);
    }
}
check(phoneLayout.phone === true, 'phone Character layout lacks its responsive receipt flag');
check(phoneLayout.touchSafe === true && phoneLayout.minTouchCss >= 44,
    `phone Character touch floor fell below 44 CSS px (${phoneLayout.minTouchCss})`);
check(phoneLayout.preview.x === phoneContent.x
    && phoneLayout.preview.x + phoneLayout.preview.w < phoneLayout.collection.x,
'phone Character live-look rail overlaps Collection');
check(phoneLayout.collection.x + phoneLayout.collection.w
    <= phoneContent.x + phoneContent.w
    && phoneLayout.collection.y + phoneLayout.collection.h
    <= phoneContent.y + phoneContent.h,
'phone Collection escapes the content bounds');
same(phoneLayout.cards.length, 8, 'phone Collection does not expose exactly eight card slots');
for (const [label, rects] of [
    ['category', phoneLayout.categorySegments],
    ['ownership', phoneLayout.ownershipSegments],
    ['source', phoneLayout.sourceSegments],
    ['card', phoneLayout.cards],
]) {
    for (const rect of rects) {
        check(Math.min(rect.w, rect.h) * phoneCssScale >= 44,
            `phone ${label} target fell below 44 CSS px`);
        check(rect.x >= phoneLayout.collection.x && rect.y >= phoneLayout.collection.y
            && rect.x + rect.w <= phoneLayout.collection.x + phoneLayout.collection.w
            && rect.y + rect.h <= phoneLayout.collection.y + phoneLayout.collection.h,
        `phone ${label} target escapes Collection`);
    }
}
for (const [label, rect] of [
    ['previous page', phoneLayout.previousButton],
    ['next page', phoneLayout.nextButton],
    ['Rites route', phoneLayout.attuneButton],
]) {
    check(Math.min(rect.w, rect.h) * phoneCssScale >= 44,
        `phone ${label} target fell below 44 CSS px`);
}
for (let i = 0; i < phoneLayout.cards.length; i++) {
    const a = phoneLayout.cards[i];
    for (let j = i + 1; j < phoneLayout.cards.length; j++) {
        const b = phoneLayout.cards[j];
        check(!(a.x < b.x + b.w && a.x + a.w > b.x
            && a.y < b.y + b.h && a.y + a.h > b.y),
        `phone cards ${i}/${j} overlap`);
    }
}

rendered.length = 0;
renderedText.length = 0;
segmentedActions.length = 0;
pageButtons.length = 0;
renderState.collectionView.page = 1;
renderer._lastCollectionNavTouchSafe = exactPhone.sectionBar.touchSafe;
renderer._lastCollectionNavMinTouchCss = exactPhone.sectionBar.minTouchCss;
renderer._drawCosmeticCollection(recordCtx, renderState, phoneLayout.collection, phoneLayout);
const expectedPhone = buildCosmeticCollectionPage({
    category: 'hat', ownership: 'all', source: 'all', page: 1,
    ownedIds: renderState.saveData.cosmetics.unlocked,
});
same(rendered.map((entry) => entry.id), expectedPhone.itemIds,
    'phone renderer diverged from collection authority');
check(rendered.every((entry) => entry.phone), 'phone renderer dropped compact card presentation');
check(renderer._lastCollectionTouchSafe === true
    && renderer._lastCollectionMinTouchCss >= 44,
'phone renderer touch receipt omitted its responsive section bar');
same(segmentedActions, ['collectionCategory', 'collectionOwnership', 'collectionSource'],
    'phone renderer omitted a direct filter lane');
check(pageButtons.length === 2, 'phone renderer omitted pager controls');
check(renderedText.some((text) => text.includes('MATCHES')
    && text.includes('OWNED') && text.includes('SETS')),
'phone renderer lacks its readable completion summary');
check(renderer._lastCollectionPursuitGuidance === true
    && renderedText.some((text) => text.includes('TRACKING Stormglass') && text.includes('NEXT')),
'phone renderer did not draw tracked-set next-source guidance');

// Compact fallback executes the real collection handler paths: three cycle
// actions, the in-Character Hero Rites route, two pagers, and all eight entries.
const compact480Fixture = rendererPhoneFixture(480, 270);
const compact480Layout = computePhoneCharacterCollectionLayout(compact480Fixture.content, {
    cssScale: compact480Fixture.cssScale, compact: true,
});
rendered.length = 0;
segmentedActions.length = 0;
pageButtons.length = 0;
renderer._lastCollectionNavTouchSafe = compact480Fixture.sectionBar.touchSafe;
renderer._lastCollectionNavMinTouchCss = compact480Fixture.sectionBar.minTouchCss;
renderer._drawCosmeticCollection(recordCtx, renderState,
    compact480Layout.collection, compact480Layout);
same(rendered.length, 8, '480x270 compact renderer did not keep eight reachable entries');
for (const [action, arg] of [
    ['collectionCategory', 'aura'],
    ['collectionOwnership', 'owned'],
    ['collectionSource', 'starter'],
    ['characterPhonePane', 'rites'],
]) check(pageButtons.some((button) => button.options.action === action
    && button.options.arg === arg),
`480x270 compact renderer omitted ${action}/${arg}`);
check(pageButtons.every((button) =>
    Math.min(button.rect.w, button.rect.h) * compact480Fixture.cssScale >= 44),
'480x270 compact renderer emitted a sub-44 CSS-px button');

// Confirm actual MenuRenderer hotspot registration, not only helper geometry.
const hotspotRenderer = new MenuRenderer({
    cssWidth: compact480Fixture.cssW,
    cssHeight: compact480Fixture.cssH,
    dpr: 1,
    safeArea: compact480Fixture.safe,
});
hotspotRenderer._panel = () => {};
hotspotRenderer._cosmeticSwatch = () => {};
hotspotRenderer._emberRim = () => {};
hotspotRenderer._lastCollectionNavTouchSafe = true;
hotspotRenderer._lastCollectionNavMinTouchCss = compact480Fixture.sectionBar.minTouchCss;
const hotspotCtx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
    beginPath() {}, roundRect() {}, fill() {}, stroke() {}, save() {}, restore() {},
    clip() {}, fillRect() {}, fillText() {}, drawImage() {},
    measureText(value) { return { width: String(value ?? '').length * 7 }; },
};
hotspotRenderer._drawCosmeticCollection(hotspotCtx, renderState,
    compact480Layout.collection, compact480Layout);
for (const action of [
    'collectionCategory', 'collectionOwnership', 'collectionSource', 'characterPhonePane',
]) check(hotspotRenderer.hotspots.some((hotspot) => hotspot.action === action),
    `production compact hotspots omitted ${action}`);
check(hotspotRenderer.hotspots.every((hotspot) =>
    Math.min(hotspot.w, hotspot.h) * compact480Fixture.cssScale >= 44),
'production compact renderer registered a sub-44 CSS-px hotspot');

// The top-level Character branch must select compact before drawing at 480,
// even though the rich helper reports unsafe.
let selectedPhonePresentation = null;
hotspotRenderer._drawCosmeticCollection = (_ctx, _state, _rect, presentation) => {
    selectedPhonePresentation = presentation;
};
hotspotRenderer._drawPhoneCharacter(hotspotCtx, {
    saveData: renderState.saveData,
    collectionView: renderState.collectionView,
    characterPhonePane: 'collection',
}, compact480Fixture.content);
check(selectedPhonePresentation?.compact === true
    && selectedPhonePresentation?.touchSafe === true,
'480x270 Character rendered the unsafe rich layout instead of compact fallback');

// Phone Hero Rites uses the production back/purchase button code and existing
// buyHeroAttune handler; gated levels suppress only the purchase hotspot.
const ritesRenderer = new MenuRenderer({
    cssWidth: compact480Fixture.cssW,
    cssHeight: compact480Fixture.cssH,
    dpr: 1,
    safeArea: compact480Fixture.safe,
});
ritesRenderer._panel = () => {};
ritesRenderer._emberRim = () => {};
ritesRenderer._lastCollectionNavTouchSafe = true;
ritesRenderer._lastCollectionNavMinTouchCss = compact480Fixture.sectionBar.minTouchCss;
const ritesState = {
    saveData: {
        selectedCharacter: 'monkey', totalCoins: 99999,
        rites: {}, heroAttunement: {},
    },
};
ritesRenderer._drawPhoneHeroRites(hotspotCtx, ritesState,
    compact480Fixture.content, compact480Fixture.cssScale);
check(ritesRenderer.hotspots.some((hotspot) => hotspot.action === 'characterPhonePane'
    && hotspot.arg === 'collection'),
'phone Hero Rites omitted its back-to-Collection hotspot');
check(ritesRenderer.hotspots.some((hotspot) => hotspot.action === 'buyHeroAttune'
    && hotspot.arg === 'monkey'),
'affordable level-one Hero Attunement omitted its purchase hotspot');
check(ritesRenderer.hotspots.every((hotspot) =>
    Math.min(hotspot.w, hotspot.h) * compact480Fixture.cssScale >= 44),
'phone Hero Rites registered a sub-44 CSS-px hotspot');
ritesRenderer.hotspots = [];
ritesState.saveData.heroAttunement.monkey = 2;
ritesRenderer._drawPhoneHeroRites(hotspotCtx, ritesState,
    compact480Fixture.content, compact480Fixture.cssScale);
check(!ritesRenderer.hotspots.some((hotspot) => hotspot.action === 'buyHeroAttune'),
    'rite-gated Hero Attunement exposed a purchase hotspot');

const previewPoints = boutiqueTrailPreviewPoints(400, 300, 100);
same(previewPoints.length, 4, 'Boutique trail sample changed its bounded point count');
check(previewPoints.every((point) => Number.isFinite(point.x + point.y + point.b + point.k + point.alpha)
    && point.b > 0 && point.k > 0 && point.alpha > 0),
'Boutique trail sample contains invalid geometry');
check(previewPoints[0].k < previewPoints.at(-1).k
    && previewPoints[0].x < 400 && previewPoints.at(-1).x > 400,
'Boutique trail sample no longer reads as a planted movement wake');
let trailFillRects = 0;
const trailCtx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect() { trailFillRects += 1; },
};
renderer._lastBoutiqueTrailPreview = false;
renderer._reducedMotion = true;
check(renderer._drawBoutiqueTrailPreview(trailCtx, {
    trailColor: '#abcdef', trailFx: 'puffs',
}, 400, 300, 100, 9, { x: 260, y: 180, w: 280, h: 240 }) === true,
'Boutique fitting room rejected a real trail appearance');
check(trailFillRects === 16 && renderer._lastBoutiqueTrailPreview === true,
    'Boutique fitting room did not feed all four samples through the production trail renderer');
renderer._lastBoutiqueTrailPreview = false;
check(renderer._drawBoutiqueTrailPreview(trailCtx, {}, 400, 300, 100, 9) === false
    && renderer._lastBoutiqueTrailPreview === false,
'Boutique fitting room fabricated a trail for a trail-less look');

same(boutiquePreviewGuidance(['case']),
    'RANDOM DROP · every piece comes from cosmetic cases',
    'case-only Boutique preview does not disclose its random-only path');
same(boutiquePreviewGuidance(['achievement']),
    'Every piece unlocks through achievements',
    'achievement-only Boutique preview has vague acquisition copy');
same(boutiquePreviewGuidance(['vigil']),
    'Every piece unlocks on the Vigil Path',
    'Vigil-only Boutique preview has vague acquisition copy');
same(boutiquePreviewGuidance(['case', 'achievement']),
    'Earn locked pieces through random cases or achievements',
    'mixed-source Boutique preview lost its exact acquisition paths');
same(boutiquePreviewGuidance(['__unknown__']),
    'Earn this look outside the Boutique',
    'unknown Boutique preview route did not fail closed');

// Case reels carry stable ids, and the production item-face path resolves the
// actual cosmetic catalog entry rather than falling back to category art.
const caseResult = {
    kind: 'cosmetic', id: 'hat_mothmask', category: 'hat',
    rarity: 'epic', name: 'Duskmoth Mask', color: '#b896cb',
};
const caseReel = buildCaseReel('mysticCosmetic', caseResult, 12, 9);
check(caseReel.reel[9].id === caseResult.id, 'case landing cell dropped its cosmetic id');
for (const cell of caseReel.reel) {
    if (cell.kind === 'cosmetic') check(!!CosmeticContent.COSMETICS[cell.id],
        `case reel cosmetic lacks a resolvable id: ${cell.name}`);
}
let actualFace = null;
renderer._cosmeticSwatch = (_ctx, category, item) => { actualFace = { category, id: item.id }; };
renderer._itemFace({ save() {}, restore() {} }, 50, 50, 20, caseReel.reel[9]);
same(actualFace, { category: 'hat', id: 'hat_mothmask' },
    'case face did not render the actual cosmetic silhouette');

console.log(`cosmetic collection: ${checks} checks passed `
    + `(${COSMETIC_LIST.length} authored, 103 projected, ${derivedClippedIds.length} clipped-tail ids reachable).`);
