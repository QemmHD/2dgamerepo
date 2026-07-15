// Pure Collection Completion authority.
//
// This module derives renderer-ready completion, route, set, and Blueprint
// truth without reading or mutating SaveSystem. Every public snapshot is deeply
// frozen, and malformed structural input fails closed to an unavailable model.

import {
    COSMETIC_ACQUISITION_ROUTES,
    COSMETIC_BLUEPRINT_COST,
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_CATEGORIES,
    COSMETIC_CATEGORY_LABELS,
    COSMETIC_LIST,
    COSMETIC_SETS,
    cosmeticBlueprintCost,
    getCosmeticAcquisitionRoutes,
} from '../content/cosmetics.js';
import { CASES, caseTargetSnapshot } from './CaseSystem.js';

const RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
const CATEGORY_SET = new Set(COSMETIC_CATEGORIES);
const BLUEPRINT_ID_SET = new Set(COSMETIC_BLUEPRINT_IDS);
const DETERMINISTIC_ROUTES = Object.freeze(
    COSMETIC_ACQUISITION_ROUTES.filter((route) => route !== 'case'),
);
const DETERMINISTIC_ROUTE_SET = new Set(DETERMINISTIC_ROUTES);
const SOURCE_LABELS = Object.freeze({
    starter: 'Starter',
    boutique: 'Boutique',
    blueprint: 'Blueprint',
    case: 'Case',
    achievement: 'Achievement',
    vigil: 'Vigil Path',
});
const ROYAL_COSMETIC_CASE_ID = 'royalCosmetic';

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function basisPoints(owned, total) {
    if (!Number.isFinite(owned) || !Number.isFinite(total) || total <= 0) return 0;
    return Math.floor(Math.max(0, Math.min(total, owned)) / total * 10000);
}

function validStableId(value) {
    return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function normalizeCatalog(value, supplied) {
    if (supplied && !Array.isArray(value)) {
        return { valid: false, items: [], invalidItems: 0, duplicateIds: 0 };
    }
    const input = supplied ? value : COSMETIC_LIST;
    const seen = new Set();
    const items = [];
    let invalidItems = 0;
    let duplicateIds = 0;
    for (const item of input) {
        const hasBlueprint = hasOwn(item ?? {}, 'blueprintCost');
        const blueprintValid = hasBlueprint
            ? BLUEPRINT_ID_SET.has(item?.id) && item.blueprintCost === COSMETIC_BLUEPRINT_COST
            : !BLUEPRINT_ID_SET.has(item?.id);
        const passValid = !hasOwn(item ?? {}, 'passLevel')
            || (Number.isSafeInteger(item.passLevel) && item.passLevel > 0);
        const coinValid = !hasOwn(item ?? {}, 'coinCost')
            || (Number.isFinite(item.coinCost) && item.coinCost > 0);
        if (!isRecord(item)
            || !validStableId(item.id)
            || !validStableId(item.name)
            || !CATEGORY_SET.has(item.category)
            || !RARITIES.has(item.rarity)
            || !blueprintValid || !passValid || !coinValid) {
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
        valid: invalidItems === 0 && duplicateIds === 0,
        items,
        invalidItems,
        duplicateIds,
    };
}

function normalizeSets(value, supplied, catalogById) {
    if (supplied && !Array.isArray(value)) {
        return { valid: false, items: [], invalidItems: 0, duplicateIds: 0 };
    }
    const input = supplied ? value : COSMETIC_SETS;
    const seen = new Set();
    const items = [];
    let invalidItems = 0;
    let duplicateIds = 0;
    for (const set of input) {
        let valid = isRecord(set) && validStableId(set.id) && validStableId(set.name)
            && isRecord(set.pieces)
            && Object.keys(set.pieces).length === COSMETIC_CATEGORIES.length;
        if (valid) {
            for (const category of COSMETIC_CATEGORIES) {
                const pieceId = set.pieces[category];
                const item = catalogById.get(pieceId);
                if (!validStableId(pieceId) || !item || item.category !== category) {
                    valid = false;
                    break;
                }
            }
        }
        if (!valid) {
            invalidItems += 1;
            continue;
        }
        if (seen.has(set.id)) {
            duplicateIds += 1;
            continue;
        }
        seen.add(set.id);
        items.push(set);
    }
    return {
        valid: invalidItems === 0 && duplicateIds === 0,
        items,
        invalidItems,
        duplicateIds,
    };
}

function normalizeIdInput(value, supplied) {
    if (!supplied) return { valid: true, ids: [], duplicateIds: 0 };
    if (!Array.isArray(value) && !(value instanceof Set)) {
        return { valid: false, ids: [], duplicateIds: 0 };
    }
    const ids = [];
    const seen = new Set();
    let duplicateIds = 0;
    for (const id of value) {
        if (!validStableId(id)) return { valid: false, ids: [], duplicateIds: 0 };
        if (seen.has(id)) {
            duplicateIds += 1;
            continue;
        }
        seen.add(id);
        ids.push(id);
    }
    return { valid: true, ids, duplicateIds };
}

function itemRoutes(item) {
    const routes = getCosmeticAcquisitionRoutes(item);
    if (!Array.isArray(routes)) return [];
    return COSMETIC_ACQUISITION_ROUTES.filter((route) => routes.includes(route));
}

function itemRow(item, ownedIds) {
    return {
        id: item.id,
        name: item.name,
        category: item.category,
        rarity: item.rarity,
        owned: ownedIds.has(item.id),
        routes: itemRoutes(item),
    };
}

function zeroProgress(total = 0) {
    return { owned: 0, total, missing: total, basisPoints: 0 };
}

function unavailableSnapshot(diagnostics) {
    const categories = COSMETIC_CATEGORIES.map((id) => ({
        id,
        label: COSMETIC_CATEGORY_LABELS[id] ?? id,
        ...zeroProgress(0),
    }));
    const sources = COSMETIC_ACQUISITION_ROUTES.map((id) => ({
        id,
        label: SOURCE_LABELS[id] ?? id,
        deterministic: DETERMINISTIC_ROUTE_SET.has(id),
        ...zeroProgress(0),
    }));
    const totals = zeroProgress(0);
    const deterministic = { ...zeroProgress(0), ids: [], missingIds: [], routes: [...DETERMINISTIC_ROUTES] };
    const caseOnly = {
        ...zeroProgress(0),
        ids: [],
        missingIds: [],
        mythicOwned: 0,
        mythicTotal: 0,
        mythicMissing: 0,
        mythicBasisPoints: 0,
        mythicIds: [],
        missingMythicIds: [],
    };
    return deepFreeze({
        valid: false,
        unavailable: true,
        overlapping: true,
        owned: 0,
        total: 0,
        missing: 0,
        basisPoints: 0,
        totals,
        categories,
        sources,
        routes: sources,
        sourceCoverage: { overlapping: true, rows: sources },
        deterministic,
        caseOnly,
        sets: [],
        pursuitSetId: null,
        trackedSet: null,
        closestSet: null,
        blueprints: [],
        selectedBlueprintId: null,
        selectedBlueprint: null,
        diagnostics,
    });
}

// Renderer-ready collection completion truth. Route rows intentionally overlap:
// an item can count toward Boutique and Case, or Blueprint and Case, because
// both are real acquisition paths. `deterministic` is a de-duplicated union.
export function buildCosmeticCompletionSnapshot(options = {}) {
    const source = isRecord(options) ? options : null;
    const catalog = normalizeCatalog(source?.catalog,
        !!source && hasOwn(source, 'catalog') && source.catalog !== undefined);
    const catalogById = new Map(catalog.items.map((item) => [item.id, item]));
    const sets = normalizeSets(source?.sets,
        !!source && hasOwn(source, 'sets') && source.sets !== undefined, catalogById);
    const ownership = normalizeIdInput(source?.ownedIds,
        !!source && hasOwn(source, 'ownedIds') && source.ownedIds !== undefined);
    const claims = normalizeIdInput(source?.blueprintClaims,
        !!source && hasOwn(source, 'blueprintClaims') && source.blueprintClaims !== undefined);
    const coinBalanceValue = source?.coinBalance ?? 0;
    const pityValue = source?.royalCosmeticPityCount ?? 0;
    const coinBalanceValid = Number.isFinite(coinBalanceValue) && coinBalanceValue >= 0;
    const pityValid = Number.isSafeInteger(pityValue) && pityValue >= 0;
    const pursuitTypeValid = source?.pursuitSetId == null || validStableId(source.pursuitSetId);
    const selectedTypeValid = source?.selectedBlueprintId == null || validStableId(source.selectedBlueprintId);
    const structurallyValid = !!source && catalog.valid && sets.valid && ownership.valid && claims.valid
        && coinBalanceValid && pityValid && pursuitTypeValid && selectedTypeValid;

    const baseDiagnostics = {
        invalidOptions: !source,
        invalidCatalog: !catalog.valid,
        invalidCatalogItems: catalog.invalidItems,
        duplicateCatalogIds: catalog.duplicateIds,
        invalidSets: !sets.valid,
        invalidSetItems: sets.invalidItems,
        duplicateSetIds: sets.duplicateIds,
        invalidOwnedIds: !ownership.valid,
        duplicateOwnedIds: ownership.duplicateIds,
        invalidBlueprintClaims: !claims.valid,
        duplicateBlueprintClaims: claims.duplicateIds,
        invalidCoinBalance: !coinBalanceValid,
        invalidPityCount: !pityValid,
        invalidPursuitSetId: !pursuitTypeValid,
        invalidSelectedBlueprintId: !selectedTypeValid,
        unknownOwnedIds: 0,
        unknownBlueprintClaims: 0,
        orphanedBlueprintClaims: 0,
        unknownPursuitSet: false,
        unknownSelectedBlueprint: false,
    };
    if (!structurallyValid) return unavailableSnapshot(baseDiagnostics);

    const knownOwnedIds = ownership.ids.filter((id) => catalogById.has(id));
    const ownedIds = new Set(knownOwnedIds);
    const unknownOwnedIds = ownership.ids.length - knownOwnedIds.length;
    const validClaimIds = claims.ids.filter((id) => BLUEPRINT_ID_SET.has(id) && catalogById.has(id));
    const unknownBlueprintClaims = claims.ids.length - validClaimIds.length;
    const orphanedBlueprintClaims = validClaimIds.filter((id) => !ownedIds.has(id)).length;
    const claimedIds = new Set(validClaimIds.filter((id) => ownedIds.has(id)));
    const coinBalance = Math.floor(coinBalanceValue);

    const total = catalog.items.length;
    const owned = catalog.items.filter((item) => ownedIds.has(item.id)).length;
    const totals = { owned, total, missing: total - owned, basisPoints: basisPoints(owned, total) };

    const categories = COSMETIC_CATEGORIES.map((id) => {
        const matching = catalog.items.filter((item) => item.category === id);
        const categoryOwned = matching.filter((item) => ownedIds.has(item.id)).length;
        return {
            id,
            label: COSMETIC_CATEGORY_LABELS[id] ?? id,
            owned: categoryOwned,
            total: matching.length,
            missing: matching.length - categoryOwned,
            basisPoints: basisPoints(categoryOwned, matching.length),
        };
    });

    const routesById = new Map(catalog.items.map((item) => [item.id, itemRoutes(item)]));
    const sources = COSMETIC_ACQUISITION_ROUTES.map((id) => {
        const matching = catalog.items.filter((item) => routesById.get(item.id).includes(id));
        const routeOwned = matching.filter((item) => ownedIds.has(item.id)).length;
        return {
            id,
            label: SOURCE_LABELS[id] ?? id,
            deterministic: DETERMINISTIC_ROUTE_SET.has(id),
            owned: routeOwned,
            total: matching.length,
            missing: matching.length - routeOwned,
            basisPoints: basisPoints(routeOwned, matching.length),
        };
    });

    const deterministicItems = catalog.items.filter((item) =>
        routesById.get(item.id).some((route) => DETERMINISTIC_ROUTE_SET.has(route)));
    const deterministicOwned = deterministicItems.filter((item) => ownedIds.has(item.id));
    const deterministic = {
        owned: deterministicOwned.length,
        total: deterministicItems.length,
        missing: deterministicItems.length - deterministicOwned.length,
        basisPoints: basisPoints(deterministicOwned.length, deterministicItems.length),
        ids: deterministicItems.map((item) => item.id),
        missingIds: deterministicItems.filter((item) => !ownedIds.has(item.id)).map((item) => item.id),
        routes: [...DETERMINISTIC_ROUTES],
    };

    const caseOnlyItems = catalog.items.filter((item) => {
        const routes = routesById.get(item.id);
        return routes.length === 1 && routes[0] === 'case';
    });
    const caseOnlyOwned = caseOnlyItems.filter((item) => ownedIds.has(item.id));
    const caseOnlyMythics = caseOnlyItems.filter((item) => item.rarity === 'mythic');
    const caseOnlyOwnedMythics = caseOnlyMythics.filter((item) => ownedIds.has(item.id));
    const caseOnly = {
        owned: caseOnlyOwned.length,
        total: caseOnlyItems.length,
        missing: caseOnlyItems.length - caseOnlyOwned.length,
        basisPoints: basisPoints(caseOnlyOwned.length, caseOnlyItems.length),
        ids: caseOnlyItems.map((item) => item.id),
        missingIds: caseOnlyItems.filter((item) => !ownedIds.has(item.id)).map((item) => item.id),
        mythicOwned: caseOnlyOwnedMythics.length,
        mythicTotal: caseOnlyMythics.length,
        mythicMissing: caseOnlyMythics.length - caseOnlyOwnedMythics.length,
        mythicBasisPoints: basisPoints(caseOnlyOwnedMythics.length, caseOnlyMythics.length),
        mythicIds: caseOnlyMythics.map((item) => item.id),
        missingMythicIds: caseOnlyMythics.filter((item) => !ownedIds.has(item.id)).map((item) => item.id),
    };

    const setRows = sets.items.map((set) => {
        const pieces = COSMETIC_CATEGORIES.map((category) =>
            itemRow(catalogById.get(set.pieces[category]), ownedIds));
        const missingItems = pieces.filter((piece) => !piece.owned);
        const setOwned = pieces.length - missingItems.length;
        return {
            id: set.id,
            name: set.name,
            color: set.color ?? '#ffd35a',
            owned: setOwned,
            total: pieces.length,
            missing: missingItems.length,
            basisPoints: basisPoints(setOwned, pieces.length),
            complete: missingItems.length === 0,
            tracked: false,
            pieces,
            missingIds: missingItems.map((item) => item.id),
            missingItems,
        };
    });
    const pursuitSetId = source.pursuitSetId != null && setRows.some((set) => set.id === source.pursuitSetId)
        ? source.pursuitSetId
        : null;
    const finalizedSetRows = setRows.map((set) => ({ ...set, tracked: set.id === pursuitSetId }));
    const trackedSet = pursuitSetId
        ? finalizedSetRows.find((set) => set.id === pursuitSetId) ?? null
        : null;
    const closestSet = finalizedSetRows.reduce((closest, set) => {
        if (set.complete) return closest;
        if (!closest || set.owned > closest.owned) return set;
        return closest;
    }, null);

    const royalCase = CASES[ROYAL_COSMETIC_CASE_ID];
    const blueprintRows = COSMETIC_BLUEPRINT_IDS.map((id) => catalogById.get(id))
        .filter(Boolean)
        .map((item) => {
            const cost = cosmeticBlueprintCost(item);
            const entryFeeCount = royalCase?.cost > 0 ? cost / royalCase.cost : 0;
            return {
                id: item.id,
                name: item.name,
                category: item.category,
                rarity: item.rarity,
                color: item.color ?? '#ffffff',
                cost,
                owned: ownedIds.has(item.id),
                claimed: claimedIds.has(item.id),
                affordable: !ownedIds.has(item.id) && coinBalance >= cost,
                routes: routesById.get(item.id) ?? itemRoutes(item),
                knownPrice: true,
                guaranteed: true,
                royalCaseEntryFees: entryFeeCount,
                caseEntryFeeAnchor: {
                    caseType: ROYAL_COSMETIC_CASE_ID,
                    caseName: royalCase?.name ?? 'Royal Cosmetic Case',
                    caseCost: royalCase?.cost ?? 0,
                    count: entryFeeCount,
                    grossCoins: cost,
                },
                copy: {
                    eyebrow: 'GUARANTEED / KNOWN PRICE',
                    unlock: 'Spend earned coins for this guaranteed cosmetic unlock.',
                    anchor: `${cost.toLocaleString('en-US')} earned coins equals ${entryFeeCount} Royal Cosmetic Case entry fees.`,
                    caveat: 'Cases stay random. This gross entry-fee anchor is not an equivalent price or a guaranteed case result.',
                },
                royalCase: caseTargetSnapshot({
                    caseType: ROYAL_COSMETIC_CASE_ID,
                    targetId: item.id,
                    ownedIds,
                    pityCount: pityValue,
                }),
            };
        });
    const selectedBlueprintId = source.selectedBlueprintId != null
        && blueprintRows.some((item) => item.id === source.selectedBlueprintId)
        ? source.selectedBlueprintId
        : null;
    const selectedBlueprint = selectedBlueprintId
        ? blueprintRows.find((item) => item.id === selectedBlueprintId) ?? null
        : null;

    const diagnostics = {
        ...baseDiagnostics,
        unknownOwnedIds,
        unknownBlueprintClaims,
        orphanedBlueprintClaims,
        unknownPursuitSet: source.pursuitSetId != null && pursuitSetId === null,
        unknownSelectedBlueprint: source.selectedBlueprintId != null && selectedBlueprintId === null,
    };

    return deepFreeze({
        valid: true,
        unavailable: false,
        overlapping: true,
        ...totals,
        totals,
        categories,
        sources,
        routes: sources,
        sourceCoverage: { overlapping: true, rows: sources },
        deterministic,
        caseOnly,
        sets: finalizedSetRows,
        pursuitSetId,
        trackedSet,
        closestSet,
        blueprints: blueprintRows,
        selectedBlueprintId,
        selectedBlueprint,
        diagnostics,
    });
}

// Initial planning used the shorter name; retain it as a strict alias so no
// renderer or validator can fork completion math during the integration pass.
export const buildCollectionCompletionSnapshot = buildCosmeticCompletionSnapshot;
