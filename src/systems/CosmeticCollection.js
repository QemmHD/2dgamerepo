// Deterministic collection filtering + pagination for the Character menu.
//
// This module owns reachability only: it never mutates the catalog, save, or
// renderer state. MenuRenderer can ask for one bounded page and render the
// returned entries; content/source truth remains in cosmetics.js.

import * as CosmeticContent from '../content/cosmetics.js';

export const COSMETIC_COLLECTION_PAGE_SIZE = 8;

const CATALOG = Array.isArray(CosmeticContent.COSMETIC_LIST)
    ? CosmeticContent.COSMETIC_LIST : [];
const CATEGORIES = Array.isArray(CosmeticContent.COSMETIC_CATEGORIES)
    ? CosmeticContent.COSMETIC_CATEGORIES : [];
const ROUTE_HELPER = typeof CosmeticContent.getCosmeticAcquisitionRoutes === 'function'
    ? CosmeticContent.getCosmeticAcquisitionRoutes : null;

function stableIds(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (typeof value !== 'string' || !value || value !== value.trim() || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return Object.freeze(result);
}

export const COSMETIC_COLLECTION_CATEGORY_FILTERS = stableIds(['all', ...CATEGORIES]);
export const COSMETIC_COLLECTION_OWNERSHIP_FILTERS = Object.freeze(['all', 'owned', 'locked']);
export const COSMETIC_COLLECTION_SOURCE_FILTERS = Object.freeze([
    'all',
    'starter',
    'boutique',
    'blueprint',
    'case',
    'achievement',
    'vigil',
]);

const CATEGORY_SET = new Set(COSMETIC_COLLECTION_CATEGORY_FILTERS);
const OWNERSHIP_SET = new Set(COSMETIC_COLLECTION_OWNERSHIP_FILTERS);
const SOURCE_SET = new Set(COSMETIC_COLLECTION_SOURCE_FILTERS);
const SOURCE_ORDER = COSMETIC_COLLECTION_SOURCE_FILTERS.slice(1);

const SOURCE_ALIASES = Object.freeze({
    starter: 'starter',
    default: 'starter',
    'default-unlocked': 'starter',
    free: 'starter',
    boutique: 'boutique',
    shop: 'boutique',
    coin: 'boutique',
    coins: 'boutique',
    purchase: 'boutique',
    'direct-purchase': 'boutique',
    blueprint: 'blueprint',
    blueprints: 'blueprint',
    craft: 'blueprint',
    crafting: 'blueprint',
    forge: 'blueprint',
    'known-price': 'blueprint',
    case: 'case',
    cases: 'case',
    drop: 'case',
    loot: 'case',
    'case-drop': 'case',
    achievement: 'achievement',
    achievements: 'achievement',
    trophy: 'achievement',
    vigil: 'vigil',
    'vigil-path': 'vigil',
    pass: 'vigil',
    battlepass: 'vigil',
    'battle-pass': 'vigil',
    waylight: 'vigil',
});

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isCosmeticCollectionCategoryFilter(value) {
    return typeof value === 'string' && CATEGORY_SET.has(value);
}

export function isCosmeticCollectionOwnershipFilter(value) {
    return typeof value === 'string' && OWNERSHIP_SET.has(value);
}

export function isCosmeticCollectionSourceFilter(value) {
    return typeof value === 'string' && SOURCE_SET.has(value);
}

export function normalizeCosmeticCollectionCategory(value = 'all') {
    return isCosmeticCollectionCategoryFilter(value) ? value : null;
}

export function normalizeCosmeticCollectionOwnership(value = 'all') {
    return isCosmeticCollectionOwnershipFilter(value) ? value : null;
}

export function normalizeCosmeticCollectionSource(value = 'all') {
    return isCosmeticCollectionSourceFilter(value) ? value : null;
}

function finitePage(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

// Pages are public/UI-facing and therefore 1-based. An empty result has page 0;
// otherwise malformed/negative pages normalize to 1 and large pages clamp to
// the final reachable page.
export function normalizeCosmeticCollectionPage(value, pageCount) {
    const count = Number.isFinite(pageCount)
        ? Math.max(0, Math.floor(pageCount)) : 0;
    if (count === 0) return 0;
    const supplied = finitePage(value);
    const page = supplied === null ? 1 : Math.floor(supplied);
    return Math.max(1, Math.min(count, page));
}

function normalizeSourceId(value) {
    if (typeof value !== 'string') return null;
    const token = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
    const source = SOURCE_ALIASES[token] ?? null;
    return source && source !== 'all' ? source : null;
}

function collectRouteSources(value, output, seen, depth = 0) {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') {
        const source = normalizeSourceId(value);
        if (source) output.add(source);
        return;
    }
    if (Array.isArray(value) || value instanceof Set) {
        for (const entry of value) collectRouteSources(entry, output, seen, depth + 1);
        return;
    }
    if (!isRecord(value) || seen.has(value)) return;
    seen.add(value);

    for (const key of [
        'source', 'sourceId', 'kind', 'type', 'id', 'route', 'primary', 'primarySource',
    ]) {
        if (hasOwn(value, key)) collectRouteSources(value[key], output, seen, depth + 1);
    }
    for (const key of [
        'routes', 'sources', 'alternates', 'alternateRoutes', 'alternateSources',
    ]) {
        if (hasOwn(value, key)) collectRouteSources(value[key], output, seen, depth + 1);
    }
}

function importedRouteSources(item, output) {
    if (!ROUTE_HELPER || !item) return;
    // Accept either an item- or id-based content helper. Both calls are
    // intentionally guarded so a future malformed content route fails closed
    // to the field-derived policy below instead of breaking the Collection.
    for (const input of [item, item.id]) {
        try {
            collectRouteSources(ROUTE_HELPER(input), output, new Set());
        } catch (_) { /* optional content helper; field policy remains authoritative */ }
    }
}

// Stable source ids for filter chips and card routing. A look may have more
// than one route: boutique/achievement looks remain case-eligible unless the
// catalog explicitly excludes them, matching CaseSystem's pool policy.
export function cosmeticCollectionSources(item) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) return Object.freeze([]);
    const sources = new Set();
    importedRouteSources(item, sources);
    if (item.defaultUnlocked === true) sources.add('starter');
    if (Number.isFinite(item.coinCost) && item.coinCost > 0) sources.add('boutique');
    if (Number.isSafeInteger(item.blueprintCost) && item.blueprintCost > 0) sources.add('blueprint');
    if (typeof item.achievement === 'string' && item.achievement) sources.add('achievement');
    if (Number.isFinite(item.passLevel) && item.passLevel > 0) sources.add('vigil');
    if (item.defaultUnlocked !== true && item.caseExcluded !== true) sources.add('case');
    return Object.freeze(SOURCE_ORDER.filter((source) => sources.has(source)));
}

function ownedIdSet(value, supplied) {
    if (!supplied) return { ids: new Set(), invalid: false };
    if (!Array.isArray(value) && !(value instanceof Set)) {
        return { ids: new Set(), invalid: true };
    }
    return {
        ids: new Set([...value].filter((id) => typeof id === 'string' && id)),
        invalid: false,
    };
}

function normalizedCatalog(value, supplied) {
    if (supplied && !Array.isArray(value)) {
        return { items: Object.freeze([]), invalidItems: 0, duplicateIds: 0, invalidCatalog: true };
    }
    const input = supplied ? value : CATALOG;
    const seen = new Set();
    const items = [];
    let invalidItems = 0;
    let duplicateIds = 0;
    for (const item of input) {
        if (!isRecord(item)
            || typeof item.id !== 'string' || !item.id || item.id !== item.id.trim()
            || typeof item.category !== 'string' || !CATEGORY_SET.has(item.category)
            || item.category === 'all') {
            invalidItems += 1;
            continue;
        }
        if (seen.has(item.id)) {
            duplicateIds += 1;
            continue;
        }
        seen.add(item.id);
        items.push(item);
    }
    return {
        items: Object.freeze(items),
        invalidItems,
        duplicateIds,
        invalidCatalog: false,
    };
}

function optionValue(options, key, alias, fallback) {
    if (hasOwn(options, key)) return options[key];
    if (alias && hasOwn(options, alias)) return options[alias];
    return fallback;
}

function filteredCollection(options) {
    const invalidOptions = !isRecord(options);
    const source = invalidOptions ? {} : options;
    const category = normalizeCosmeticCollectionCategory(
        optionValue(source, 'category', 'categoryFilter', 'all'),
    );
    const ownership = normalizeCosmeticCollectionOwnership(
        optionValue(source, 'ownership', 'ownershipFilter', 'all'),
    );
    const route = normalizeCosmeticCollectionSource(
        optionValue(source, 'source', 'sourceFilter', 'all'),
    );
    const invalidFilters = Object.freeze([
        category === null ? 'category' : null,
        ownership === null ? 'ownership' : null,
        route === null ? 'source' : null,
    ].filter(Boolean));
    const catalog = normalizedCatalog(source.catalog, hasOwn(source, 'catalog'));
    const ownershipData = ownedIdSet(source.ownedIds, hasOwn(source, 'ownedIds'));

    if (invalidOptions || invalidFilters.length || catalog.invalidCatalog || ownershipData.invalid) {
        return {
            category, ownership, source: route, invalidFilters, catalog,
            invalidOptions, invalidOwnershipData: ownershipData.invalid,
            items: Object.freeze([]), entries: Object.freeze([]),
        };
    }

    const entries = [];
    for (const item of catalog.items) {
        if (category !== 'all' && item.category !== category) continue;
        const isOwned = ownershipData.ids.has(item.id);
        if (ownership === 'owned' && !isOwned) continue;
        if (ownership === 'locked' && isOwned) continue;
        const sources = cosmeticCollectionSources(item);
        if (route !== 'all' && !sources.includes(route)) continue;
        entries.push(Object.freeze({ id: item.id, item, owned: isOwned, sources }));
    }
    return {
        category, ownership, source: route, invalidFilters, catalog,
        invalidOptions, invalidOwnershipData: false,
        items: Object.freeze(entries.map((entry) => entry.item)),
        entries: Object.freeze(entries),
    };
}

export function filterCosmeticCollection(options = {}) {
    return filteredCollection(options).items;
}

function emptyStateFor(result) {
    if (result.invalidOptions) {
        return Object.freeze({
            code: 'invalid-options',
            title: 'Collection unavailable',
            body: 'The collection request could not be read safely.',
            label: 'Collection unavailable.',
        });
    }
    if (result.invalidFilters.length) {
        return Object.freeze({
            code: 'invalid-filter',
            title: 'Collection filter unavailable',
            body: 'Reset the category, ownership, and source filters to continue.',
            label: 'Reset the collection filters to continue.',
        });
    }
    if (result.catalog.invalidCatalog) {
        return Object.freeze({
            code: 'invalid-catalog',
            title: 'Collection unavailable',
            body: 'The cosmetic catalog could not be read safely.',
            label: 'Collection unavailable.',
        });
    }
    if (result.invalidOwnershipData) {
        return Object.freeze({
            code: 'invalid-ownership-data',
            title: 'Collection unavailable',
            body: 'Owned cosmetics could not be read safely.',
            label: 'Owned cosmetics are unavailable.',
        });
    }
    return Object.freeze({
        code: 'no-matches',
        title: 'No looks match',
        body: 'Try another category, ownership, or source filter.',
        label: 'No cosmetics match these filters.',
    });
}

// Build one immutable, renderer-ready page. `page` is 1-based; `pageIndex` is
// the corresponding 0-based layout index. Empty results deliberately expose
// page 0 plus a readable empty state instead of an empty, unexplained grid.
export function buildCosmeticCollectionPage(options = {}) {
    const source = isRecord(options) ? options : {};
    const result = filteredCollection(options);
    const totalItems = result.entries.length;
    const pageCount = Math.ceil(totalItems / COSMETIC_COLLECTION_PAGE_SIZE);
    const page = normalizeCosmeticCollectionPage(source.page, pageCount);
    const pageIndex = page > 0 ? page - 1 : 0;
    const startIndex = page > 0 ? pageIndex * COSMETIC_COLLECTION_PAGE_SIZE : 0;
    const entries = Object.freeze(result.entries.slice(
        startIndex,
        startIndex + COSMETIC_COLLECTION_PAGE_SIZE,
    ));
    const items = Object.freeze(entries.map((entry) => entry.item));
    const empty = totalItems === 0;
    const hasPreviousPage = page > 1;
    const hasNextPage = page > 0 && page < pageCount;
    const filters = Object.freeze({
        category: result.category,
        ownership: result.ownership,
        source: result.source,
    });
    const nav = Object.freeze({
        hasPreviousPage,
        hasNextPage,
        previousPage: hasPreviousPage ? page - 1 : null,
        nextPage: hasNextPage ? page + 1 : null,
    });

    return Object.freeze({
        filters,
        category: result.category,
        ownership: result.ownership,
        source: result.source,
        invalidFilters: result.invalidFilters,
        invalidOptions: result.invalidOptions,
        invalidOwnershipData: result.invalidOwnershipData,
        page,
        pageIndex,
        pageCount,
        pageSize: COSMETIC_COLLECTION_PAGE_SIZE,
        totalItems,
        totalCount: totalItems,
        startIndex,
        endIndex: startIndex + entries.length,
        firstItemNumber: entries.length ? startIndex + 1 : 0,
        lastItemNumber: entries.length ? startIndex + entries.length : 0,
        hasPreviousPage,
        hasNextPage,
        // Short aliases keep Canvas renderers concise; `nav` is the complete
        // transport-safe shape for callers that should not derive bounds.
        hasPrev: hasPreviousPage,
        hasNext: hasNextPage,
        nav,
        entries,
        items,
        itemIds: Object.freeze(entries.map((entry) => entry.id)),
        empty,
        emptyState: empty ? emptyStateFor(result) : null,
        diagnostics: Object.freeze({
            catalogItems: result.catalog.items.length,
            invalidItems: result.catalog.invalidItems,
            duplicateIds: result.catalog.duplicateIds,
            invalidCatalog: result.catalog.invalidCatalog,
            invalidOptions: result.invalidOptions,
            invalidOwnershipData: result.invalidOwnershipData,
        }),
    });
}
