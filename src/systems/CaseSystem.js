// CaseSystem — coin-only loot cases. No real money, ever.
//
// Opening a case: validate coins → spend → roll a rarity from the case's odds
// → roll a reward of that rarity (a gear/cosmetic item, or a coin/battle-pass
// fallback). A rolled item the player already owns is a DUPLICATE and converts
// to coins (rarityDust) instead. Everything persists through SaveSystem.
//
// Cases are pure data (CASES) so the shop UI can render costs + odds directly.

import { GEAR_LIST } from '../content/gear.js';
import { COSMETIC_LIST } from '../content/cosmetics.js';
import { RARITY_ORDER, rarityDust, rarityName } from '../content/rarities.js';

// Each case now draws from a SINGLE pool kind ('gear' or 'cosmetic'), so the
// loot you get is always the type the case is named for. Three tiers each.
export const CASES = {
    // Costs raised + odds pulled toward the low end so kitting out is a real
    // grind, not a couple of runs. Rare+ is scarcer at every tier; the pity net
    // (below) is lengthened to match so a dry streak still resolves fairly.
    basic: {
        id: 'basic', name: 'Basic Case', cost: 120, poolKind: 'gear',
        odds: { common: 0.75, uncommon: 0.20, rare: 0.04, epic: 0.01 },
    },
    mystic: {
        id: 'mystic', name: 'Mystic Case', cost: 360, poolKind: 'gear',
        odds: { common: 0.45, uncommon: 0.33, rare: 0.15, epic: 0.06, legendary: 0.01 },
    },
    royal: {
        id: 'royal', name: 'Royal Case', cost: 900, poolKind: 'gear',
        odds: { uncommon: 0.40, rare: 0.33, epic: 0.185, legendary: 0.07, mythic: 0.015 },
    },
    basicCosmetic: {
        id: 'basicCosmetic', name: 'Basic Cosmetic Case', cost: 120, poolKind: 'cosmetic',
        odds: { common: 0.75, uncommon: 0.20, rare: 0.04, epic: 0.01 },
    },
    mysticCosmetic: {
        id: 'mysticCosmetic', name: 'Mystic Cosmetic Case', cost: 360, poolKind: 'cosmetic',
        odds: { common: 0.45, uncommon: 0.33, rare: 0.15, epic: 0.06, legendary: 0.01 },
    },
    royalCosmetic: {
        id: 'royalCosmetic', name: 'Royal Cosmetic Case', cost: 900, poolKind: 'cosmetic',
        odds: { uncommon: 0.40, rare: 0.33, epic: 0.185, legendary: 0.07, mythic: 0.015 },
    },
};

// Shop layout: gear tier then its cosmetic twin, per tier.
export const CASE_ORDER = ['basic', 'basicCosmetic', 'mystic', 'mysticCosmetic', 'royal', 'royalCosmetic'];

// Bad-luck protection: opens of a case since its last Rare-or-better before one
// is GUARANTEED. Lower-tier cases (which rarely roll Rare+) get a longer rope;
// royal cases hit Rare+ constantly so their cap almost never triggers. This is
// transparent (shown on the shop card) so it reads as a fair safety net.
export const CASE_PITY = { basic: 16, basicCosmetic: 16, mystic: 12, mysticCosmetic: 12, royal: 10, royalCosmetic: 10 };

// Public probability constants keep Collection Completion disclosures tied to
// the exact branches used by openCase. The legacy branch name remains as an
// alias for integrations that adopted the audit terminology first.
export const CASE_ITEM_REWARD_CHANCE = 0.82;
export const CASE_ITEM_BRANCH_CHANCE = CASE_ITEM_REWARD_CHANCE;
export const CASE_COIN_CONSOLATION_CHANCE = 0.60;

// ── Mines (coin gambling mini-game) ─────────────────────────────────────
// A Stake-style MINES gamble: stake coins on a 5×5 grid hiding a few mines.
// Reveal safe tiles one at a time — each safe pick ratchets the multiplier up
// (and the next pick gets riskier). Cash out anytime to bank stake × the live
// multiplier; hit a mine and lose the stake. ~7% house edge — gambling is a
// risky flex, not a steady coin faucet (average play loses coins over time).
// Fixed coin-only presets keep the wager flow fast while putting a hard ceiling
// on a single play. 250 fills the old gap between the entry and committed
// stakes; there is deliberately no custom/all-in wager or real-money path.
export const WAGER_BETS = Object.freeze([100, 250, 500, 2000]);
export const MINES = { tiles: 25, cols: 5, mines: 6 };
export const MINES_HOUSE = 0.93;

// Pre-roll the hidden mine positions (array of distinct tile indices).
export function rollMines(count = MINES.mines, tiles = MINES.tiles) {
    const set = new Set();
    while (set.size < count) set.add(Math.floor(Math.random() * tiles));
    return [...set];
}

// Fair (pre-house-edge) multiplier after revealing `safe` safe tiles: the
// product of unrevealed/(safe-unrevealed) at each step. Apply MINES_HOUSE for
// the paid value.
export function minesRawMultiplier(safe, mines = MINES.mines, tiles = MINES.tiles) {
    let mul = 1;
    for (let i = 0; i < safe; i++) {
        const unrevealed = tiles - i;
        const safeUnrevealed = (tiles - mines) - i;
        if (safeUnrevealed <= 0) break;
        mul *= unrevealed / safeUnrevealed;
    }
    return mul;
}

function normalizedMinesConfig(mines, tiles) {
    const tileCount = Number.isInteger(tiles) && tiles > 1 ? tiles : MINES.tiles;
    const fallbackMines = Math.min(MINES.mines, tileCount - 1);
    const mineCount = Number.isInteger(mines) && mines > 0 && mines < tileCount ? mines : fallbackMines;
    return { tileCount, mineCount, safeTotal: tileCount - mineCount };
}

// Exact conditional odds for the NEXT pick after `safe` safe tiles have been
// revealed. Reaching this state proves every revealed tile was safe, so all
// mines remain hidden. The game auto-cashes at the terminal state instead of
// offering a guaranteed mine pick.
export function minesNextPickOdds(safe, mines = MINES.mines, tiles = MINES.tiles) {
    const { tileCount, mineCount, safeTotal } = normalizedMinesConfig(mines, tiles);
    const safeRevealed = Math.max(0, Math.min(safeTotal, Number.isFinite(safe) ? Math.floor(safe) : 0));
    const remaining = tileCount - safeRevealed;
    const safeRemaining = safeTotal - safeRevealed;
    const available = safeRemaining > 0;
    return {
        available,
        remaining,
        safeRemaining,
        mineRemaining: mineCount,
        safeChance: available ? safeRemaining / remaining : 0,
        mineChance: available ? mineCount / remaining : 1,
    };
}

// One source of truth for every number shown in the Mines overlay. Payouts use
// the exact same floor rule as the bank transaction, and are clamped to a safe
// integer defensively even though selectable wagers are capped at 2,000.
export function minesPayoutQuote(bet, safe, mines = MINES.mines, tiles = MINES.tiles) {
    const stake = Number.isFinite(bet) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(bet))) : 0;
    const { tileCount, mineCount, safeTotal } = normalizedMinesConfig(mines, tiles);
    const safeRevealed = Math.max(0, Math.min(safeTotal, Number.isFinite(safe) ? Math.floor(safe) : 0));
    const multiplier = safeRevealed > 0 ? minesRawMultiplier(safeRevealed, mineCount, tileCount) * MINES_HOUSE : 1;
    const boundedPayout = (value) => Number.isFinite(value)
        ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)))
        : Number.MAX_SAFE_INTEGER;
    const payout = safeRevealed > 0 ? boundedPayout(stake * multiplier) : 0;
    const odds = minesNextPickOdds(safeRevealed, mineCount, tileCount);
    const nextMultiplier = odds.available ? minesRawMultiplier(safeRevealed + 1, mineCount, tileCount) * MINES_HOUSE : multiplier;
    const nextPayout = odds.available ? boundedPayout(stake * nextMultiplier) : payout;
    return {
        bet: stake,
        safeRevealed,
        multiplier,
        payout,
        net: payout - stake,
        odds,
        nextMultiplier,
        nextPayout,
        nextNet: nextPayout - stake,
    };
}

// One flat index of everything a case can award, tagged by kind + rarity.
// Default-unlocked items (e.g. the Cinderbolt/starter looks) are EXCLUDED, as
// are authored progression rewards such as the Last Light Vigil set.
const ITEM_POOL = [
    ...GEAR_LIST.filter((g) => !g.defaultUnlocked)
        .map((g) => ({ kind: 'gear', id: g.id, rarity: g.rarity, name: g.name, category: g.category, description: g.description ?? '', color: null })),
    ...COSMETIC_LIST.filter((c) => !c.defaultUnlocked && !c.caseExcluded)
        .map((c) => ({ kind: 'cosmetic', id: c.id, rarity: c.rarity, name: c.name, category: c.category, description: c.description ?? '', color: c.color ?? null })),
];

function deepFreezeSnapshot(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreezeSnapshot(child);
    return Object.freeze(value);
}

function poolEntrySnapshot(item) {
    return {
        kind: item.kind,
        id: item.id,
        rarity: item.rarity,
        name: item.name,
        category: item.category,
        description: item.description,
        color: item.color,
    };
}

// Immutable, ordered pool truth for Collection Completion and validators.
// This is deliberately read-only: openCase continues to consume ITEM_POOL
// directly, so observing the pool cannot reorder or mutate live case RNG.
export function casePoolSnapshot(kind = 'cosmetic') {
    const normalizedKind = kind === null || kind === 'all' ? null : kind;
    const valid = normalizedKind === null || normalizedKind === 'gear' || normalizedKind === 'cosmetic';
    const entries = valid
        ? ITEM_POOL.filter((item) => normalizedKind === null || item.kind === normalizedKind)
            .map(poolEntrySnapshot)
        : [];
    const rarities = RARITY_ORDER.map((rarity) => {
        const matching = entries.filter((item) => item.rarity === rarity);
        return {
            id: rarity,
            label: rarityName(rarity),
            total: matching.length,
            ids: matching.map((item) => item.id),
        };
    });
    return deepFreezeSnapshot({
        valid,
        kind: valid ? (normalizedKind ?? 'all') : null,
        total: entries.length,
        ids: entries.map((item) => item.id),
        entries,
        rarities,
    });
}

function forcedRarityOdds(definition) {
    const rareIndex = RARITY_ORDER.indexOf('rare');
    const weights = new Map();
    let total = 0;
    for (let index = rareIndex; index < RARITY_ORDER.length; index += 1) {
        const rarity = RARITY_ORDER[index];
        if (!definition?.odds?.[rarity]) continue;
        const weight = Math.max(1, Math.round(definition.odds[rarity] * 100));
        weights.set(rarity, weight);
        total += weight;
    }
    return Object.fromEntries(RARITY_ORDER.map((rarity) => [
        rarity,
        total > 0 ? (weights.get(rarity) ?? 0) / total : 0,
    ]));
}

function probabilityBasisPoints(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value * 10000) : 0;
}

function finiteProbabilityReciprocal(value) {
    return Number.isFinite(value) && value > 0 ? 1 / value : null;
}

// Exact named-target disclosure for one case state. It mirrors the authored
// rarity odds, forced Rare+ weighting, 82% item branch, and unowned-first
// selection policy without consuming random numbers or changing save state.
export function caseTargetSnapshot(options = {}) {
    const source = options && typeof options === 'object' && !Array.isArray(options)
        ? options
        : null;
    const caseType = source?.caseType ?? 'royalCosmetic';
    const definition = CASES[caseType] ?? null;
    const rawOwned = source?.ownedIds ?? [];
    const ownershipValid = Array.isArray(rawOwned) || rawOwned instanceof Set;
    const ownedValues = ownershipValid ? [...rawOwned] : [];
    const malformedOwnedIds = ownedValues.filter((id) => typeof id !== 'string' || !id).length;
    const rawPity = source?.pityCount ?? 0;
    const pityValid = Number.isSafeInteger(rawPity) && rawPity >= 0;
    const valid = !!source && !!definition && ownershipValid && malformedOwnedIds === 0 && pityValid;

    if (!valid) {
        return deepFreezeSnapshot({
            valid: false,
            caseType: definition ? caseType : null,
            name: definition?.name ?? '',
            cost: definition?.cost ?? 0,
            kind: definition?.poolKind ?? null,
            poolTotal: 0,
            ids: [],
            rarities: [],
            pity: { cap: definition ? (CASE_PITY[caseType] ?? 12) : 0, count: 0, remaining: 0, forcedNext: false },
            target: { valid: false, id: null, inPool: false },
            branches: {
                item: CASE_ITEM_REWARD_CHANCE,
                itemBasisPoints: probabilityBasisPoints(CASE_ITEM_REWARD_CHANCE),
                coin: (1 - CASE_ITEM_REWARD_CHANCE) * CASE_COIN_CONSOLATION_CHANCE,
                coinBasisPoints: probabilityBasisPoints((1 - CASE_ITEM_REWARD_CHANCE) * CASE_COIN_CONSOLATION_CHANCE),
                battlePassXp: (1 - CASE_ITEM_REWARD_CHANCE) * (1 - CASE_COIN_CONSOLATION_CHANCE),
                battlePassXpBasisPoints: probabilityBasisPoints((1 - CASE_ITEM_REWARD_CHANCE) * (1 - CASE_COIN_CONSOLATION_CHANCE)),
                coinConditionalOnConsolation: CASE_COIN_CONSOLATION_CHANCE,
            },
            duplicatePolicy: {
                preferUnownedWithinRarity: true,
                duplicatesOnlyAfterRarityCollected: true,
                reward: 'coin-dust',
            },
            diagnostics: {
                invalidOptions: !source,
                unknownCase: !definition,
                invalidOwnedIds: !ownershipValid || malformedOwnedIds > 0,
                invalidPityCount: !pityValid,
                unknownOwnedIds: 0,
                ignoredOwnedIds: 0,
            },
        });
    }

    const allKindItems = definition.poolKind === 'gear' ? GEAR_LIST : COSMETIC_LIST;
    const knownKindIds = new Set(allKindItems.map((item) => item.id));
    const ownedIds = new Set(ownedValues.filter((id) => knownKindIds.has(id)));
    const unknownOwnedIds = ownedValues.filter((id) => !knownKindIds.has(id)).length;
    const eligible = ITEM_POOL.filter((item) => item.kind === definition.poolKind && definition.odds[item.rarity]);
    const eligibleIds = new Set(eligible.map((item) => item.id));
    const ignoredOwnedIds = [...ownedIds].filter((id) => !eligibleIds.has(id)).length;
    const forcedOdds = forcedRarityOdds(definition);
    const rarities = RARITY_ORDER.filter((rarity) => definition.odds[rarity]).map((rarity) => {
        const entries = eligible.filter((item) => item.rarity === rarity);
        const ownedEntries = entries.filter((item) => ownedIds.has(item.id));
        const unownedEntries = entries.filter((item) => !ownedIds.has(item.id));
        return {
            id: rarity,
            label: rarityName(rarity),
            odds: definition.odds[rarity],
            basisPoints: probabilityBasisPoints(definition.odds[rarity]),
            forcedOdds: forcedOdds[rarity] ?? 0,
            forcedBasisPoints: probabilityBasisPoints(forcedOdds[rarity] ?? 0),
            total: entries.length,
            owned: ownedEntries.length,
            unowned: unownedEntries.length,
            ids: entries.map((item) => item.id),
            ownedIds: ownedEntries.map((item) => item.id),
            unownedIds: unownedEntries.map((item) => item.id),
        };
    });

    const cap = CASE_PITY[caseType] ?? 12;
    const count = Math.min(cap - 1, rawPity);
    const remaining = Math.max(1, cap - count);
    const forcedNext = count + 1 >= cap;
    const requestedTargetId = typeof source.targetId === 'string' && source.targetId
        ? source.targetId
        : null;
    const targetItem = requestedTargetId
        ? eligible.find((item) => item.id === requestedTargetId) ?? null
        : null;
    const targetRarity = targetItem?.rarity ?? null;
    const targetRarityEntries = targetRarity
        ? eligible.filter((item) => item.rarity === targetRarity)
        : [];
    const targetUnownedEntries = targetRarityEntries.filter((item) => !ownedIds.has(item.id));
    const targetOwned = !!targetItem && ownedIds.has(targetItem.id);
    const blockedByUnownedPreference = targetOwned && targetUnownedEntries.length > 0;
    const selectionPoolSize = targetUnownedEntries.length || targetRarityEntries.length;
    const targetSelectable = !!targetItem && !blockedByUnownedPreference;
    const selectionProbability = targetSelectable && selectionPoolSize > 0 ? 1 / selectionPoolSize : 0;
    const ordinaryRarityProbability = targetRarity ? (definition.odds[targetRarity] ?? 0) : 0;
    const forcedRarityProbability = targetRarity ? (forcedOdds[targetRarity] ?? 0) : 0;
    const ordinaryNamedProbability = ordinaryRarityProbability * CASE_ITEM_REWARD_CHANCE * selectionProbability;
    const forcedNextNamedProbability = forcedRarityProbability * CASE_ITEM_REWARD_CHANCE * selectionProbability;
    const nextNamedProbability = forcedNext ? forcedNextNamedProbability : ordinaryNamedProbability;

    return deepFreezeSnapshot({
        valid: true,
        caseType,
        name: definition.name,
        cost: definition.cost,
        kind: definition.poolKind,
        poolTotal: eligible.length,
        ids: eligible.map((item) => item.id),
        rarities,
        pity: { cap, count, remaining, forcedNext },
        target: {
            valid: !!targetItem,
            id: targetItem?.id ?? requestedTargetId,
            name: targetItem?.name ?? '',
            rarity: targetRarity,
            inPool: !!targetItem,
            owned: targetOwned,
            selectionPool: blockedByUnownedPreference
                ? 'blocked-by-unowned'
                : targetUnownedEntries.length > 0 ? 'unowned' : 'full',
            selectionPoolSize,
            blockedByUnownedPreference,
            duplicateIfAwarded: targetOwned && targetSelectable,
            ordinaryRarityProbability,
            forcedRarityProbability,
            selectionProbability,
            ordinaryNamedProbability,
            forcedNextNamedProbability,
            nextNamedProbability,
            ordinaryBasisPoints: probabilityBasisPoints(ordinaryNamedProbability),
            forcedNextBasisPoints: probabilityBasisPoints(forcedNextNamedProbability),
            nextBasisPoints: probabilityBasisPoints(nextNamedProbability),
            ordinaryOneIn: finiteProbabilityReciprocal(ordinaryNamedProbability),
            forcedNextOneIn: finiteProbabilityReciprocal(forcedNextNamedProbability),
            nextOneIn: finiteProbabilityReciprocal(nextNamedProbability),
        },
        branches: {
            item: CASE_ITEM_REWARD_CHANCE,
            itemBasisPoints: probabilityBasisPoints(CASE_ITEM_REWARD_CHANCE),
            coin: (1 - CASE_ITEM_REWARD_CHANCE) * CASE_COIN_CONSOLATION_CHANCE,
            coinBasisPoints: probabilityBasisPoints((1 - CASE_ITEM_REWARD_CHANCE) * CASE_COIN_CONSOLATION_CHANCE),
            battlePassXp: (1 - CASE_ITEM_REWARD_CHANCE) * (1 - CASE_COIN_CONSOLATION_CHANCE),
            battlePassXpBasisPoints: probabilityBasisPoints((1 - CASE_ITEM_REWARD_CHANCE) * (1 - CASE_COIN_CONSOLATION_CHANCE)),
            coinConditionalOnConsolation: CASE_COIN_CONSOLATION_CHANCE,
        },
        duplicatePolicy: {
            preferUnownedWithinRarity: true,
            duplicatesOnlyAfterRarityCollected: true,
            reward: 'coin-dust',
        },
        diagnostics: {
            invalidOptions: false,
            unknownCase: false,
            invalidOwnedIds: false,
            invalidPityCount: false,
            unknownOwnedIds,
            ignoredOwnedIds,
        },
    });
}

// Pool filtered by rarity and (optionally) kind (null = any kind).
function poolByRarity(rarity, kind = null) {
    return ITEM_POOL.filter((i) => i.rarity === rarity && (!kind || i.kind === kind));
}

// Build a "spin reel": a strip of item cells the overlay scrolls past before
// landing on the won item. Cells are drawn from the rarities this case can
// roll (weighted by its odds) for flavor; the WON item is placed at
// `landingIndex` so the deceleration settles exactly on it. A coins/bpxp
// result has no item, so its landing cell shows the result label + rarity.
export function buildCaseReel(caseType, result, length = 48, landingIndex = 42) {
    const def = CASES[caseType];
    const kind = def ? (def.poolKind ?? null) : null; // gear/cosmetic-only reels
    const rarities = def ? RARITY_ORDER.filter((r) => def.odds[r]) : ['common'];
    const weighted = [];
    if (def) for (const r of rarities) for (let i = 0; i < Math.max(1, Math.round(def.odds[r] * 100)); i++) weighted.push(r);
    const reel = [];
    for (let i = 0; i < length; i++) {
        const rr = weighted.length ? weighted[Math.floor(Math.random() * weighted.length)] : 'common';
        const pool = poolByRarity(rr, kind);
        const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        // Cells carry the catalog id plus kind/category/colour so the spin reel
        // can draw each item's real face (gear emblem / cosmetic silhouette),
        // not a generic category medallion.
        reel.push({
            rarity: rr, name: pick ? pick.name : rarityName(rr),
            id: pick ? pick.id : null,
            kind: pick ? pick.kind : (kind || 'coins'),
            category: pick ? pick.category : null,
            color: pick ? pick.color : null,
        });
    }
    // Place the real result on the landing cell.
    reel[landingIndex] = {
        rarity: result.rarity || 'common',
        name: result.name || result.label || rarityName(result.rarity || 'common'),
        id: result.id ?? null,
        kind: result.kind || kind || 'coins',
        category: result.category ?? null,
        color: result.color ?? null,
    };
    return { reel, landingIndex };
}

// Pick a rarity from a case's odds. Falls back to the lowest listed rarity if
// the odds don't sum to 1 (defensive — they do).
function rollRarity(odds) {
    let r = Math.random();
    for (const rarity of RARITY_ORDER) {
        const p = odds[rarity];
        if (!p) continue;
        if (r < p) return rarity;
        r -= p;
    }
    // Remainder → highest listed rarity.
    const listed = RARITY_ORDER.filter((x) => odds[x]);
    return listed[listed.length - 1] ?? 'common';
}

function cloneCaseTransactionData(value, seen = new Map()) {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    if (Array.isArray(value)) {
        for (const entry of value) copy.push(cloneCaseTransactionData(entry, seen));
    } else {
        for (const [key, entry] of Object.entries(value)) {
            copy[key] = cloneCaseTransactionData(entry, seen);
        }
    }
    return copy;
}

function caseSaveFailure(save, fallback = 'save-unavailable') {
    const failure = save?.getLastSaveFailureReason?.();
    return {
        ok: false,
        reason: failure === 'external-save-changed' ? 'save-changed' : fallback,
    };
}

// Cheap, RNG-free guard shared by the deterministic resolver and the browser
// exclusive entrypoint. This is only an early UX rejection: openCase repeats
// every check inside SaveSystem's origin-wide exclusive transaction so a tab
// cannot pass here, go stale, and then overwrite newer durable authority.
export function caseOpenPreflight(save, caseType, opts = {}) {
    const def = CASES[caseType];
    if (!def) return { ok: false, reason: 'unknown' };
    if (!save?.data || typeof save.save !== 'function') {
        return { ok: false, reason: 'save-unavailable' };
    }
    if (!opts.free && save.data.totalCoins < def.cost) {
        return { ok: false, reason: 'cost' };
    }
    if (typeof save._storageUnchangedSinceLastWrite === 'function') {
        const storageState = save._storageUnchangedSinceLastWrite();
        if (!storageState?.ok) {
            return {
                ok: false,
                reason: storageState?.reason === 'external-save-changed'
                    ? 'save-changed' : 'save-unavailable',
            };
        }
    } else if (save.available === false) {
        return { ok: false, reason: 'save-unavailable' };
    }
    return { ok: true };
}

// Build the complete case result against a detached save draft. SaveSystem's
// existing mutation helpers remain the authority for coin caps, unlock rules,
// duplicate stats, and battle-pass caches, while their eager save() calls are
// deliberately absorbed by this draft. The live SaveSystem receives exactly
// one whole-save commit after the reward is fully resolved.
function caseTransactionDraft(save, data) {
    const draft = Object.create(save);
    Object.defineProperties(draft, {
        data: { configurable: true, enumerable: true, writable: true, value: data },
        save: { configurable: true, writable: false, value: () => true },
    });
    return draft;
}

// Returns a reward descriptor (and applies its effects to the save):
//   { ok, kind: 'gear'|'cosmetic'|'coins'|'duplicate', rarity, id?, name?,
//     category?, amount?, label }
// or { ok: false, reason: 'cost'|'unknown'|'save-changed'|'save-unavailable' }
// when it can't be opened. Failed paid entry is always mutation-free.
export function openCase(save, caseType, opts = {}) {
    const def = CASES[caseType];
    const preflight = caseOpenPreflight(save, caseType, opts);
    if (!preflight.ok) return preflight;

    const free = !!opts.free;

    const liveData = save.data;
    let transaction;
    try {
        transaction = caseTransactionDraft(save, cloneCaseTransactionData(liveData));
        if (!free && !transaction.spendCoins(def.cost)) {
            return { ok: false, reason: 'cost' };
        }
        transaction.incrementStat('casesOpened', 1);

        // Per-case pity: track opens since this case last paid Rare+; once the
        // cap is reached, FORCE a Rare+ (then reset). A natural Rare+ resets it.
        if (!transaction.data.casePity) transaction.data.casePity = {};
        const cap = CASE_PITY[def.id] || 12;
        const count = transaction.data.casePity[def.id] || 0;
        const rareIdx = RARITY_ORDER.indexOf('rare');
        let rarity;
        let pity = false;
        if (count + 1 >= cap) {
            rarity = rarityAtLeast('rare', def.odds);
            pity = true;
            transaction.data.casePity[def.id] = 0;
        } else {
            rarity = rollRarity(def.odds);
            transaction.data.casePity[def.id] = RARITY_ORDER.indexOf(rarity) >= rareIdx ? 0 : count + 1;
        }
        const result = grantRarityReward(transaction, rarity, def.poolKind ?? null);
        if (!result?.ok) return result ?? { ok: false, reason: 'save-unavailable' };
        result.pity = pity;

        // Swap in the fully resolved draft only for the single durable commit.
        // A failed/throwing write restores the exact live object, so the wallet,
        // stat, pity, unlock, duplicate, XP, and cache fields cannot diverge.
        save.data = transaction.data;
        let committed = false;
        try {
            committed = save.save() === true;
        } catch (error) {
            console.warn('[CaseSystem] transaction commit failed', error);
        }
        if (!committed) {
            save.data = liveData;
            return caseSaveFailure(save);
        }
        return result;
    } catch (error) {
        save.data = liveData;
        console.warn('[CaseSystem] transaction failed', error);
        return caseSaveFailure(save);
    }
}

// Production browser entrypoint. Reward RNG and every wallet/stat/pity/unlock
// mutation run only after SaveSystem has excluded all other live save
// participants. The detached openCase seam absorbs its eager save calls; the
// exclusive boundary performs the sole real write before this Promise can
// expose a successful reward to the menu.
export function openCaseAtomic(save, caseType, opts = {}) {
    // Snapshot the only supported option before crossing an async boundary;
    // callers cannot turn a paid request into a free one after preflight.
    const atomicOpts = Object.freeze({ free: opts?.free === true });
    const preflight = caseOpenPreflight(save, caseType, atomicOpts);
    if (!preflight.ok) return Promise.resolve(Object.freeze(preflight));
    if (typeof save?.runExclusiveSaveTransaction !== 'function') {
        return Promise.resolve(Object.freeze({
            ok: false,
            reason: 'transaction-lock-unavailable',
        }));
    }
    try {
        return Promise.resolve(save.runExclusiveSaveTransaction((draft) =>
            openCase(draft, caseType, atomicOpts))).then((result) => {
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
                return Object.freeze({ ok: false, reason: 'transaction-lock-failed' });
            }
            return Object.isFrozen(result) ? result : Object.freeze({ ...result });
        }).catch(() => Object.freeze({
            ok: false,
            reason: 'transaction-lock-failed',
        }));
    } catch (error) {
        return Promise.resolve(Object.freeze({
            ok: false,
            reason: 'transaction-lock-failed',
        }));
    }
}

// Resolve + apply the reward for a rolled rarity.
// 82% an item of that rarity (duplicates convert to coin dust); otherwise a
// coin / battle-pass consolation so a pull always pays out something.
function grantRarityReward(save, rarity, kind = null) {
    const pool = poolByRarity(rarity, kind);
    if (pool.length && Math.random() < CASE_ITEM_REWARD_CHANCE) {
        // Prefer something new within the rolled rarity. Duplicate dust only
        // enters the reel once that rarity's case pool has been collected.
        const unowned = pool.filter((item) => item.kind === 'gear'
            ? !save.isGearUnlocked(item.id)
            : !save.isCosmeticUnlocked(item.id));
        const choices = unowned.length ? unowned : pool;
        const pick = choices[Math.floor(Math.random() * choices.length)];
        const owned = pick.kind === 'gear' ? save.isGearUnlocked(pick.id) : save.isCosmeticUnlocked(pick.id);
        if (owned) {
            const amount = rarityDust(rarity);
            save.addCoins(amount);
            save.incrementStat('dupeCoins', amount);   // lifetime dupe-refund tally
            return { ok: true, kind: 'duplicate', rarity, id: pick.id, name: pick.name,
                category: pick.category, description: pick.description, color: pick.color,
                amount, dupeTotal: save.data.stats.dupeCoins,
                label: `Duplicate ${pick.name} → ${amount} coins` };
        }
        if (pick.kind === 'gear') save.unlockGear(pick.id);
        else save.unlockCosmetic(pick.id);
        return { ok: true, kind: pick.kind, rarity, id: pick.id, name: pick.name,
            category: pick.category, description: pick.description, color: pick.color,
            label: `${rarityName(rarity)} ${pick.name}` };
    }
    if (Math.random() < CASE_COIN_CONSOLATION_CHANCE) {
        const amount = Math.round(rarityDust(rarity) * 1.5);
        save.addCoins(amount);
        return { ok: true, kind: 'coins', rarity, amount, label: `${amount} coins` };
    }
    const amount = 50 + RARITY_ORDER.indexOf(rarity) * 40;
    const bp = save.addBattlePassXp(amount) || {};
    const cache = bp.everflameCaches > 0 ? ` · Everflame Cache +${bp.everflameCoins} coins` : '';
    return { ok: true, kind: 'bpxp', rarity, amount, label: `${amount} vigil XP${cache}` };
}

// Lowest rarity in `odds` that is at least `floor` (for the pity guarantee).
function rarityAtLeast(floor, odds) {
    const fi = RARITY_ORDER.indexOf(floor);
    const eligible = RARITY_ORDER.filter((r, i) => odds[r] && i >= fi);
    if (!eligible.length) return floor;
    // Weight by odds among the eligible tiers so a forced pull still varies.
    const weighted = [];
    for (const r of eligible) for (let i = 0; i < Math.max(1, Math.round(odds[r] * 100)); i++) weighted.push(r);
    return weighted[Math.floor(Math.random() * weighted.length)];
}

// Odds as display rows (high→low) for the shop UI.
export function caseOddsRows(caseType) {
    const def = CASES[caseType];
    if (!def) return [];
    return RARITY_ORDER.filter((r) => def.odds[r])
        // Keep authored half-percent tiers exact (royal Epic 18.5%, Mythic
        // 1.5%). Rounding each row independently used to display a false 101%.
        .map((r) => ({ rarity: r, pct: def.odds[r] * 100 }))
        .reverse();
}

// The best rarity a case can drop (for the "up to <rarity>" showcase).
export function caseTopRarity(caseType) {
    const def = CASES[caseType];
    if (!def) return 'common';
    const listed = RARITY_ORDER.filter((r) => def.odds[r]);
    return listed[listed.length - 1] || 'common';
}

// Opens remaining until this case GUARANTEES a Rare+ (shop pity readout).
// Accepts a SaveSystem instance or a raw save-data object (menu passes data).
export function casePityRemaining(save, caseType) {
    const data = (save && save.data) || save || {};
    const cap = CASE_PITY[caseType] || 12;
    const count = (data.casePity && data.casePity[caseType]) || 0;
    return Math.max(1, cap - count);
}
