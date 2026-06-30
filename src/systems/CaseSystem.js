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
    basic: {
        id: 'basic', name: 'Basic Case', cost: 60, poolKind: 'gear',
        odds: { common: 0.65, uncommon: 0.25, rare: 0.09, epic: 0.01 },
    },
    mystic: {
        id: 'mystic', name: 'Mystic Case', cost: 180, poolKind: 'gear',
        odds: { common: 0.35, uncommon: 0.35, rare: 0.20, epic: 0.08, legendary: 0.02 },
    },
    royal: {
        id: 'royal', name: 'Royal Case', cost: 450, poolKind: 'gear',
        odds: { uncommon: 0.30, rare: 0.35, epic: 0.23, legendary: 0.10, mythic: 0.02 },
    },
    basicCosmetic: {
        id: 'basicCosmetic', name: 'Basic Cosmetic Case', cost: 60, poolKind: 'cosmetic',
        odds: { common: 0.65, uncommon: 0.25, rare: 0.09, epic: 0.01 },
    },
    mysticCosmetic: {
        id: 'mysticCosmetic', name: 'Mystic Cosmetic Case', cost: 180, poolKind: 'cosmetic',
        odds: { common: 0.35, uncommon: 0.35, rare: 0.20, epic: 0.08, legendary: 0.02 },
    },
    royalCosmetic: {
        id: 'royalCosmetic', name: 'Royal Cosmetic Case', cost: 450, poolKind: 'cosmetic',
        odds: { uncommon: 0.30, rare: 0.35, epic: 0.23, legendary: 0.10, mythic: 0.02 },
    },
};

// Shop layout: gear tier then its cosmetic twin, per tier.
export const CASE_ORDER = ['basic', 'basicCosmetic', 'mystic', 'mysticCosmetic', 'royal', 'royalCosmetic'];

// ── Ember Forge ─────────────────────────────────────────────────────────
// A "doesn't feel like gambling" mode: spend grindable Cinders (coins) to
// REFINE a reward, with a transparent PITY meter — every forge nudges you
// toward a guaranteed Rare+, and the meter resets when you hit one. Framed as
// crafting + a visible safety net, so it reads as earned progress while still
// delivering the variable-reward dopamine. Not in CASE_ORDER (own panel).
export const FORGE = {
    id: 'forge', name: 'Ember Forge', cost: 120,
    odds: { common: 0.40, uncommon: 0.32, rare: 0.18, epic: 0.08, legendary: 0.02 },
};
CASES.forge = FORGE;       // so buildCaseReel/openCase resolve it by id
export const FORGE_PITY = 8; // forges since the last Rare+ that force one

// ── Mines (coin gambling mini-game) ─────────────────────────────────────
// A Stake-style MINES gamble: stake coins on a 5×5 grid hiding a few mines.
// Reveal safe tiles one at a time — each safe pick ratchets the multiplier up
// (and the next pick gets riskier). Cash out anytime to bank stake × the live
// multiplier; hit a mine and lose the stake. ~3% house edge.
export const WAGER_BETS = [100, 500, 2000];
export const MINES = { tiles: 25, cols: 5, mines: 6 };
export const MINES_HOUSE = 0.97;

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

// One flat index of everything a case can award, tagged by kind + rarity.
// Default-unlocked gear (e.g. the Cinderbolt) is EXCLUDED — you already own it,
// so it should never be a case pull.
const ITEM_POOL = [
    ...GEAR_LIST.filter((g) => !g.defaultUnlocked)
        .map((g) => ({ kind: 'gear', id: g.id, rarity: g.rarity, name: g.name, category: g.category })),
    ...COSMETIC_LIST.map((c) => ({ kind: 'cosmetic', id: c.id, rarity: c.rarity, name: c.name, category: c.category })),
];

// Pool filtered by rarity and (optionally) kind. A null kind means "any" —
// used by the Ember Forge, which can award either gear or cosmetics.
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
        // Cells carry their kind so the spin reel can draw a gear/cosmetic logo.
        reel.push({ rarity: rr, name: pick ? pick.name : rarityName(rr), kind: pick ? pick.kind : (kind || 'coins') });
    }
    // Place the real result on the landing cell.
    reel[landingIndex] = {
        rarity: result.rarity || 'common',
        name: result.name || result.label || rarityName(result.rarity || 'common'),
        kind: result.kind || kind || 'coins',
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

// Returns a reward descriptor (and applies its effects to the save):
//   { ok, kind: 'gear'|'cosmetic'|'coins'|'duplicate', rarity, id?, name?,
//     category?, amount?, label }
// or { ok: false, reason: 'cost'|'unknown' } when it can't be opened.
export function openCase(save, caseType, opts = {}) {
    const def = CASES[caseType];
    if (!def) return { ok: false, reason: 'unknown' };

    const free = !!opts.free;
    if (!free) {
        if (save.data.totalCoins < def.cost) return { ok: false, reason: 'cost' };
        save.spendCoins(def.cost);
    }
    save.incrementStat('casesOpened', 1);

    return grantRarityReward(save, rollRarity(def.odds), def.poolKind ?? null);
}

// Resolve + apply the reward for a rolled rarity (shared by cases + the forge).
// 82% an item of that rarity (duplicates convert to coin dust); otherwise a
// coin / battle-pass consolation so a pull always pays out something.
function grantRarityReward(save, rarity, kind = null) {
    const pool = poolByRarity(rarity, kind);
    if (pool.length && Math.random() < 0.82) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const owned = pick.kind === 'gear' ? save.isGearUnlocked(pick.id) : save.isCosmeticUnlocked(pick.id);
        if (owned) {
            const amount = rarityDust(rarity);
            save.addCoins(amount);
            return { ok: true, kind: 'duplicate', rarity, id: pick.id, name: pick.name,
                category: pick.category, amount, label: `Duplicate ${pick.name} → ${amount} coins` };
        }
        if (pick.kind === 'gear') save.unlockGear(pick.id);
        else save.unlockCosmetic(pick.id);
        return { ok: true, kind: pick.kind, rarity, id: pick.id, name: pick.name,
            category: pick.category, label: `${rarityName(rarity)} ${pick.name}` };
    }
    if (Math.random() < 0.6) {
        const amount = Math.round(rarityDust(rarity) * 1.5);
        save.addCoins(amount);
        return { ok: true, kind: 'coins', rarity, amount, label: `${amount} coins` };
    }
    const amount = 50 + RARITY_ORDER.indexOf(rarity) * 40;
    save.addBattlePassXp(amount);
    return { ok: true, kind: 'bpxp', rarity, amount, label: `${amount} vigil XP` };
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

// Forge pity progress for the UI: forges remaining until a guaranteed Rare+.
export function forgePityRemaining(save) {
    // Accepts either the SaveSystem instance (save.data) or a raw save-data
    // object (the menu passes state.saveData directly).
    const data = (save && save.data) || save || {};
    const pity = (data.forge && data.forge.pity) || 0;
    return Math.max(0, FORGE_PITY - pity);
}

// Ember Forge pull. Spends coins, advances the pity meter, and either rolls
// normally or — once the meter is full — guarantees a Rare+ (then resets it).
// A natural Rare+ also resets the meter, so it always reflects the real wait.
export function openForge(save) {
    if (save.data.totalCoins < FORGE.cost) return { ok: false, reason: 'cost' };
    save.spendCoins(FORGE.cost);
    save.incrementStat('casesOpened', 1);
    if (!save.data.forge) save.data.forge = { pity: 0 };
    const rareIdx = RARITY_ORDER.indexOf('rare');
    let rarity;
    if ((save.data.forge.pity || 0) + 1 >= FORGE_PITY) {
        rarity = rarityAtLeast('rare', FORGE.odds);
        save.data.forge.pity = 0;
    } else {
        rarity = rollRarity(FORGE.odds);
        save.data.forge.pity = RARITY_ORDER.indexOf(rarity) >= rareIdx ? 0 : (save.data.forge.pity || 0) + 1;
    }
    save.save();
    return grantRarityReward(save, rarity);
}

// Odds as display rows (high→low) for the shop UI.
export function caseOddsRows(caseType) {
    const def = CASES[caseType];
    if (!def) return [];
    return RARITY_ORDER.filter((r) => def.odds[r])
        .map((r) => ({ rarity: r, pct: Math.round(def.odds[r] * 100) }))
        .reverse();
}
