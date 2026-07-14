#!/usr/bin/env node
// Browser-free reachability checks for the paged Character collection and its
// real MenuRenderer/case-reel integration seams.
// Run from the repository root:
//   node tools/validate-cosmetic-collection.js

import assert from 'node:assert/strict';
import * as CosmeticContent from '../src/content/cosmetics.js';
import { MenuRenderer } from '../src/systems/MenuRenderer.js';
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

// Collection Growth I-A adds eight pieces to the prior 65-item catalog. When
// any growth marker is present, require the complete 73-item authored set;
// otherwise synthesize the projection so pagination stays covered in isolation.
const growthMarkerIds = [
    'cloak_splitwatch', 'cloak_mothwing', 'hat_waylantern', 'hat_mothmask',
    'aura_oathwheel', 'aura_gloam_moths', 'trail_waymarks', 'trail_gloam_wisps',
];
const growthContentLanded = growthMarkerIds.some((id) => authoredIds.includes(id));
if (growthContentLanded) {
    check(COSMETIC_LIST.length === 73, 'partial Collection Growth catalog landed; expected 73 items');
    for (const id of growthMarkerIds) check(authoredIds.includes(id), `growth cosmetic ${id} is missing`);
}

function projectedCatalog73() {
    if (COSMETIC_LIST.length === 73) return COSMETIC_LIST;
    const catalog = COSMETIC_LIST.slice(0, 73);
    for (let index = catalog.length; index < 73; index++) {
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

const projected = projectedCatalog73();
check(projected.length === 73, 'projected catalog is not exactly 73 items');
const projectedOwned = new Set(projected.filter((_, index) => index % 2 === 0).map((item) => item.id));
const projectedAll = buildCosmeticCollectionPage({ catalog: projected, ownedIds: projectedOwned, page: 1 });
check(projectedAll.pageCount === 10, '73-item collection must span ten pages');
validateTraversal('projected-73/all/all/all',
    { catalog: projected, category: 'all', ownership: 'all', source: 'all', ownedIds: projectedOwned },
    projected);
if (projected !== COSMETIC_LIST) validateFilterMatrix('projected-73', projected);

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
const segmentedActions = [];
const pageButtons = [];
renderer._panel = () => {};
renderer._segmentedRow = (_ctx, options, selected, x, y, w, h, action) => {
    check(Array.isArray(options) && options.length >= 3, `${action}: missing segmented choices`);
    check(options.some((option) => option.id === selected), `${action}: selected choice is absent`);
    check(w > 0 && h > 0 && Number.isFinite(x + y), `${action}: invalid segmented geometry`);
    segmentedActions.push(action);
};
renderer._drawCollectionCard = (_ctx, _state, entry, rect) => {
    check(rect.w > 0 && rect.h > 0, `${entry.id}: non-positive card geometry`);
    rendered.push({ id: entry.id, rect });
};
renderer._button = (_ctx, rect, label, options = {}) => {
    check(rect.w > 0 && rect.h > 0, `${label}: non-positive pager geometry`);
    pageButtons.push({ label, options });
};
const recordCtx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillText() {},
};
const renderState = {
    saveData: {
        cosmetics: {
            unlocked: COSMETIC_LIST.filter((_, index) => index % 3 === 0).map((item) => item.id),
            equipped: { fur: 'fur_natural', cloak: 'cloak_none', hat: 'hat_none', aura: 'aura_ember', trail: 'trail_none' },
        },
    },
    collectionView: { category: 'hat', ownership: 'all', source: 'all', page: 1 },
    tryOn: {},
};
const collectionRect = { x: 540, y: 250, w: 980, h: 390 };
for (const page of [1, 2]) {
    rendered.length = 0;
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
    + `(${COSMETIC_LIST.length} authored, 73 projected, ${derivedClippedIds.length} clipped-tail ids reachable).`);
