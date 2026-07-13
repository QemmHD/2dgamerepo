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

// ── Mines (coin gambling mini-game) ─────────────────────────────────────
// A Stake-style MINES gamble: stake coins on a 5×5 grid hiding a few mines.
// Reveal safe tiles one at a time — each safe pick ratchets the multiplier up
// (and the next pick gets riskier). Cash out anytime to bank stake × the live
// multiplier; hit a mine and lose the stake. ~7% house edge — gambling is a
// risky flex, not a steady coin faucet (average play loses coins over time).
export const WAGER_BETS = [100, 500, 2000];
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

// One flat index of everything a case can award, tagged by kind + rarity.
// Default-unlocked items (e.g. the Cinderbolt/starter looks) are EXCLUDED, as
// are authored progression rewards such as the Last Light Vigil set.
const ITEM_POOL = [
    ...GEAR_LIST.filter((g) => !g.defaultUnlocked)
        .map((g) => ({ kind: 'gear', id: g.id, rarity: g.rarity, name: g.name, category: g.category, description: g.description ?? '', color: null })),
    ...COSMETIC_LIST.filter((c) => !c.defaultUnlocked && !c.caseExcluded)
        .map((c) => ({ kind: 'cosmetic', id: c.id, rarity: c.rarity, name: c.name, category: c.category, description: c.description ?? '', color: c.color ?? null })),
];

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
        // Cells carry kind + category + swatch colour so the spin reel can draw
        // each item's real face (gear emblem / cosmetic swatch), not a generic dot.
        reel.push({
            rarity: rr, name: pick ? pick.name : rarityName(rr),
            kind: pick ? pick.kind : (kind || 'coins'),
            category: pick ? pick.category : null,
            color: pick ? pick.color : null,
        });
    }
    // Place the real result on the landing cell.
    reel[landingIndex] = {
        rarity: result.rarity || 'common',
        name: result.name || result.label || rarityName(result.rarity || 'common'),
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

    // Per-case pity: track opens since this case last paid Rare+; once the cap
    // is reached, FORCE a Rare+ (then reset). A natural Rare+ also resets it.
    if (!save.data.casePity) save.data.casePity = {};
    const cap = CASE_PITY[def.id] || 12;
    const count = save.data.casePity[def.id] || 0;
    const rareIdx = RARITY_ORDER.indexOf('rare');
    let rarity, pity = false;
    if (count + 1 >= cap) {
        rarity = rarityAtLeast('rare', def.odds);
        pity = true;
        save.data.casePity[def.id] = 0;
    } else {
        rarity = rollRarity(def.odds);
        save.data.casePity[def.id] = RARITY_ORDER.indexOf(rarity) >= rareIdx ? 0 : count + 1;
    }
    const res = grantRarityReward(save, rarity, def.poolKind ?? null);
    if (res.ok) res.pity = pity;
    save.save();     // persist the pity counter
    return res;
}

// Resolve + apply the reward for a rolled rarity.
// 82% an item of that rarity (duplicates convert to coin dust); otherwise a
// coin / battle-pass consolation so a pull always pays out something.
function grantRarityReward(save, rarity, kind = null) {
    const pool = poolByRarity(rarity, kind);
    if (pool.length && Math.random() < 0.82) {
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
    if (Math.random() < 0.6) {
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
        .map((r) => ({ rarity: r, pct: Math.round(def.odds[r] * 100) }))
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
