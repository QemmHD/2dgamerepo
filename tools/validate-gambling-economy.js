#!/usr/bin/env node
// Deterministic, dependency-free checks for the coin-only case/Mines economy.
// Run from the repository root:
//   node tools/validate-gambling-economy.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CASES, CASE_PITY, MINES, MINES_HOUSE, WAGER_BETS, caseOddsRows,
    minesNextPickOdds, minesPayoutQuote, minesRawMultiplier, openCase,
} from '../src/systems/CaseSystem.js';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const close = (actual, expected, tolerance, message) => {
    check(Math.abs(actual - expected) <= tolerance,
        `${message}: got ${actual}, expected ${expected} ± ${tolerance}`);
};

// SaveSystem is exercised against a real persistence surface without depending
// on a browser. This also suppresses Node's experimental localStorage warning.
const SAVE_KEY = 'monkey-survivor:save:v1';
const storage = new Map();
let saveWrites = 0;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => {
        if (key === SAVE_KEY) saveWrites++;
        storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key),
} });
const { MAX_COIN_BALANCE, SaveSystem } = await import('../src/systems/SaveSystem.js');
const { MinigameOverlay } = await import('../src/systems/MinigameOverlay.js');

function validateCaseDisclosureData() {
    for (const [id, def] of Object.entries(CASES)) {
        check(def.id === id, `${id}: case id mismatch`);
        check(Number.isSafeInteger(def.cost) && def.cost > 0, `${id}: invalid coin cost`);
        const sum = Object.values(def.odds).reduce((total, chance) => total + chance, 0);
        close(sum, 1, 1e-12, `${id}: rarity odds must sum to 100%`);
        for (const [rarity, chance] of Object.entries(def.odds)) {
            check(Number.isFinite(chance) && chance > 0 && chance < 1,
                `${id}/${rarity}: invalid probability`);
        }
        const rows = caseOddsRows(id);
        check(rows.length === Object.keys(def.odds).length, `${id}: odds disclosure omitted a tier`);
        close(rows.reduce((total, row) => total + row.pct, 0), 100, 1e-9,
            `${id}: displayed odds do not total 100%`);
        check(Number.isSafeInteger(CASE_PITY[id]) && CASE_PITY[id] >= 2 && CASE_PITY[id] <= 25,
            `${id}: pity bound is missing or excessive`);
    }
}

function validateMinesMath() {
    check(Object.isFrozen(WAGER_BETS), 'wager presets must be immutable');
    check(WAGER_BETS.length >= 4, 'Mines needs at least four low-friction presets');
    check(new Set(WAGER_BETS).size === WAGER_BETS.length, 'wager presets must be unique');
    check(WAGER_BETS.every((bet) => Number.isSafeInteger(bet) && bet > 0), 'wager presets must be positive coin integers');
    check(WAGER_BETS.every((bet, i) => i === 0 || bet > WAGER_BETS[i - 1]), 'wager presets must be ascending');
    check(WAGER_BETS.at(-1) <= 2000, 'single-play stake ceiling exceeded 2,000 coins');
    close(MINES_HOUSE, 0.93, 1e-12, 'Mines theoretical return changed');

    const safeTotal = MINES.tiles - MINES.mines;
    let survival = 1;
    let previousMineChance = -1;
    for (let safe = 0; safe < safeTotal; safe++) {
        const odds = minesNextPickOdds(safe);
        check(odds.available, `stage ${safe}: next pick should be available`);
        close(odds.safeChance + odds.mineChance, 1, 1e-12, `stage ${safe}: next-pick odds`);
        check(odds.mineChance > previousMineChance, `stage ${safe}: mine risk must rise after each safe pick`);
        check(odds.safeRemaining === safeTotal - safe, `stage ${safe}: safe-tile count mismatch`);
        check(odds.mineRemaining === MINES.mines, `stage ${safe}: hidden mine count changed`);
        previousMineChance = odds.mineChance;

        survival *= odds.safeChance;
        const raw = minesRawMultiplier(safe + 1);
        close(survival * raw, 1, 2e-12, `stage ${safe + 1}: fair multiplier/probability identity`);

        for (const bet of WAGER_BETS) {
            const quote = minesPayoutQuote(bet, safe + 1);
            check(Number.isSafeInteger(quote.payout) && quote.payout >= 0,
                `${bet}/${safe + 1}: payout is not a non-negative safe integer`);
            check(Number.isSafeInteger(quote.net), `${bet}/${safe + 1}: net is not a safe integer`);
            close(quote.multiplier, raw * MINES_HOUSE, 1e-10,
                `${bet}/${safe + 1}: paid multiplier`);
            const expectedReturn = survival * quote.payout / bet;
            check(expectedReturn <= MINES_HOUSE + 1e-12,
                `${bet}/${safe + 1}: flooring created a positive-EV coin faucet (${expectedReturn})`);
            check(expectedReturn >= MINES_HOUSE - 1 / bet - 1e-12,
                `${bet}/${safe + 1}: payout flooring exceeds its one-coin bound (${expectedReturn})`);
        }
    }
    const terminal = minesNextPickOdds(safeTotal);
    check(!terminal.available && terminal.safeChance === 0 && terminal.mineChance === 1,
        'terminal board must auto-cash instead of offering a guaranteed mine');

    const maxQuote = minesPayoutQuote(WAGER_BETS.at(-1), safeTotal);
    check(maxQuote.payout > WAGER_BETS.at(-1) * 1000, 'max clear no longer carries meaningful jackpot upside');
    check(maxQuote.payout < 500_000_000, 'bounded wager produced an economy-breaking jackpot ceiling');

    // Malformed external inputs must still resolve to finite, non-negative
    // display values rather than NaN/Infinity leaking into canvas or save data.
    for (const [bet, safe, mines, tiles] of [
        [NaN, NaN, undefined, undefined],
        [-100, -4, 6, 25],
        [Infinity, Infinity, 6, 25],
        [MAX_COIN_BALANCE, 99, 99, 3],
        [MAX_COIN_BALANCE, 19, 6, 25],
    ]) {
        const quote = minesPayoutQuote(bet, safe, mines, tiles);
        check(Number.isSafeInteger(quote.bet) && quote.bet >= 0, 'extreme quote produced an invalid stake');
        check(Number.isFinite(quote.multiplier) && quote.multiplier >= 1, 'extreme quote produced an invalid multiplier');
        check(Number.isSafeInteger(quote.payout) && quote.payout >= 0, 'extreme quote produced an invalid payout');
        check(Number.isSafeInteger(quote.net), 'extreme quote produced an invalid net result');
        check(Number.isFinite(quote.odds.safeChance) && Number.isFinite(quote.odds.mineChance),
            'extreme quote produced invalid odds');
    }
}

// Seeded simulation supplements the exact combinatorial proof with the real
// choose-to-cash loop. Shallow/medium targets converge quickly without relying
// on vanishingly rare full-board jackpots.
function validateSimulation() {
    let seed = 0x5eedc0de;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    const trials = 120_000;
    for (const target of [1, 3, 5]) {
        const bet = 500;
        const quote = minesPayoutQuote(bet, target);
        let returned = 0, wins = 0;
        for (let trial = 0; trial < trials; trial++) {
            let survived = true;
            for (let safe = 0; safe < target; safe++) {
                if (random() >= minesNextPickOdds(safe).safeChance) { survived = false; break; }
            }
            if (survived) { returned += quote.payout; wins++; }
        }
        const empiricalReturn = returned / (trials * bet);
        let survival = 1;
        for (let safe = 0; safe < target; safe++) survival *= minesNextPickOdds(safe).safeChance;
        const exactReturn = survival * quote.payout / bet;
        close(empiricalReturn, exactReturn, 0.015, `simulation at ${target} safe picks`);
        check(wins > 0 && wins < trials, `simulation at ${target} picks lacks both wins and losses`);
    }
}

function validateCoinLedgerAndQuota() {
    storage.clear();
    const save = new SaveSystem();
    save.data.totalCoins = MAX_COIN_BALANCE - 5;
    save.addCoins(10);
    check(save.data.totalCoins === MAX_COIN_BALANCE, 'coin addition did not saturate at MAX_SAFE_INTEGER');
    save.addCoins(Infinity);
    check(save.data.totalCoins === MAX_COIN_BALANCE, 'Infinity credit changed the balance');
    for (const invalid of [NaN, Infinity, -1, 0, 0.5, MAX_COIN_BALANCE + 1]) {
        const before = save.data.totalCoins;
        check(save.spendCoins(invalid) === false, `invalid debit ${invalid} was accepted`);
        check(save.data.totalCoins === before, `invalid debit ${invalid} changed the balance`);
    }
    check(save.spendCoins(MAX_COIN_BALANCE), 'maximum safe debit was rejected');
    check(save.data.totalCoins === 0, 'maximum safe debit did not land on zero');
    check(!save.spendCoins(1) && save.data.totalCoins === 0, 'insufficient spend made coins negative');

    // Real five-play rolling-hour semantics, including exact reset behavior.
    const realNow = Date.now;
    let now = 2_000_000_000_000;
    Date.now = () => now;
    try {
        storage.clear();
        const quota = new SaveSystem();
        for (let i = 0; i < 5; i++) check(quota.consumeGamblePlay(), `quota rejected play ${i + 1}`);
        check(!quota.consumeGamblePlay(), 'quota allowed a sixth play in one hour');
        const locked = quota.gamblePlaysInfo();
        check(locked.remaining === 0 && locked.resetInMs === 3_600_000,
            'quota lockout/reset clock mismatch');
        now += 3_600_000;
        const reset = quota.gamblePlaysInfo();
        check(reset.remaining === 5 && reset.resetInMs === 0, 'rolling-hour quota did not reset');
        check(quota.consumeGamblePlay() && quota.gamblePlaysInfo().remaining === 4,
            'first play after reset was not consumed');
    } finally {
        Date.now = realNow;
    }
}

function validateProductionFlow() {
    storage.clear();
    const save = new SaveSystem();
    save.data.totalCoins = 5000;
    const toasts = [];
    const game = {
        saveSystem: save,
        _setToast: (message) => toasts.push(message),
        audio: { forge() {}, spinTick() {}, hurt() {}, reveal() {}, caseOpen() {} },
    };
    const overlay = new MinigameOverlay(game);
    const starting = save.data.totalCoins;
    overlay.openMines(-100);
    check(!overlay.mines && save.data.totalCoins === starting, 'negative wager entered a board or changed coins');
    check(save.gamblePlaysInfo().remaining === 5, 'invalid wager consumed the hourly quota');
    overlay.openMines(251);
    check(!overlay.mines && save.data.totalCoins === starting, 'non-preset wager entered a board or changed coins');
    overlay.openMines(250.75);
    check(!overlay.mines && save.data.totalCoins === starting, 'fractional input was coerced into a preset wager');

    overlay.openMines(250);
    check(overlay.mines?.bet === 250, 'valid preset did not open Mines');
    check(save.data.totalCoins === starting - 250, 'valid wager was not debited exactly once');
    check(save.gamblePlaysInfo().remaining === 4, 'valid wager did not consume exactly one play');
    overlay.minesReveal(0.5);
    check(overlay.mines.safeRevealed === 0 && overlay.mines.revealed.length === 0,
        'fractional tile input advanced the board');
    overlay.mines.mineSet = [19, 20, 21, 22, 23, 24];
    overlay.minesReveal(0);
    const quote = minesPayoutQuote(250, 1);
    check(overlay.mines.mul === quote.multiplier, 'production reveal diverged from disclosed multiplier');
    overlay.minesCashOut();
    check(overlay.mines.result.payout === quote.payout, 'production cashout diverged from disclosed payout');
    check(save.data.totalCoins === starting - 250 + quote.payout, 'cashout ledger total is wrong');
    check(Number.isSafeInteger(save.data.totalCoins) && save.data.totalCoins >= 0,
        'production flow produced invalid money');
    check(toasts.includes('Unavailable wager'), 'invalid-wager disclosure is missing');
}

function validateDurablePaidEntryGuards() {
    storage.clear();
    saveWrites = 0;

    // Seed one durable 200k wallet, then load two independent tab-like
    // SaveSystems from the exact same payload. A commits first; B must fail
    // closed instead of overwriting A's newer whole-save authority.
    const seed = new SaveSystem();
    seed.data.totalCoins = 200_000;
    check(seed.save(), 'failed to seed the shared durable wallet');
    const seededRaw = storage.get(SAVE_KEY);
    const saveA = new SaveSystem();
    const saveB = new SaveSystem();
    check(saveA.data.totalCoins === 200_000 && saveB.data.totalCoins === 200_000,
        'shared SaveSystems did not load the same 200k wallet');

    const writesBeforeA = saveWrites;
    check(saveA.spendCoins(1), 'authoritative SaveSystem A could not commit an ordinary durable spend');
    check(saveA.data.totalCoins === 199_999, 'authoritative spend did not debit A exactly once');
    const durableARaw = storage.get(SAVE_KEY);
    check(durableARaw !== seededRaw, 'authoritative spend did not change the durable payload');
    check(saveWrites === writesBeforeA + 1, 'authoritative spend did not make exactly one save write');

    // Direct spendCoins is itself transactional: stale detection must restore
    // the *raw* pre-call balance and expose an actionable failure reason.
    const staleSnapshot = JSON.stringify(saveB.data);
    const staleBalance = saveB.data.totalCoins;
    const writesBeforeDirectSpend = saveWrites;
    check(saveB.spendCoins(CASES.royal.cost) === false,
        'stale spendCoins accepted a debit after external save change');
    check(saveB.getLastSaveFailureReason() === 'external-save-changed',
        'stale spendCoins did not expose external-save-changed');
    check(saveB.data.totalCoins === staleBalance,
        'stale spendCoins did not restore the exact in-memory balance');
    check(JSON.stringify(saveB.data) === staleSnapshot,
        'stale spendCoins mutated non-wallet in-memory state');
    check(saveWrites === writesBeforeDirectSpend,
        'stale spendCoins attempted a durable write');
    check(storage.get(SAVE_KEY) === durableARaw,
        'stale spendCoins changed A\'s durable payload');

    // A paid case must reject before any reward/pity/stat/unlock path or RNG.
    // The complete B snapshot is stronger than individual field assertions and
    // catches a future reward kind adding state outside today's known fields.
    const realRandom = Math.random;
    let rngCalls = 0;
    let staleCase;
    Math.random = () => { rngCalls++; return 0; };
    try {
        staleCase = openCase(saveB, 'royal');
    } finally {
        Math.random = realRandom;
    }
    check(staleCase?.ok === false && staleCase.reason === 'save-changed',
        'stale paid case did not return the save-changed receipt');
    check(rngCalls === 0, 'stale paid case reached an RNG reward path');
    check(JSON.stringify(saveB.data) === staleSnapshot,
        'stale paid case changed wallet/stat/pity/unlock/reward memory');
    check(saveWrites === writesBeforeDirectSpend,
        'stale paid case attempted a durable write');
    check(storage.get(SAVE_KEY) === durableARaw,
        'stale paid case changed A\'s durable payload');

    // Player-facing integrations must surface the same stale-save rejection in
    // both the visible toast channel and the accessibility live announcement.
    const toasts = [];
    const announcements = [];
    const audioCalls = { caseOpen: 0, forge: 0 };
    const game = {
        saveSystem: saveB,
        _setToast: (message) => toasts.push(message),
        accessibility: { announce: (message) => announcements.push(message) },
        audio: {
            caseOpen: () => { audioCalls.caseOpen++; },
            forge: () => { audioCalls.forge++; },
            spinTick() {}, hurt() {}, reveal() {},
        },
    };
    const overlay = new MinigameOverlay(game);
    const staleMessage = 'Save changed — reload to continue';
    const writesBeforeOverlay = saveWrites;
    rngCalls = 0;
    Math.random = () => { rngCalls++; return 0; };
    try {
        overlay.openCaseFlow('royal');
        check(overlay.caseAnim === null, 'stale overlay case created a reel');
        check(toasts.at(-1) === staleMessage,
            'stale overlay case omitted the visible reload message');
        check(announcements.at(-1) === staleMessage,
            'stale overlay case omitted the accessibility reload message');
        check(audioCalls.caseOpen === 0, 'stale overlay case played a successful-open cue');

        const quotaBefore = saveB.gamblePlaysInfo();
        overlay.openMines(WAGER_BETS[0]);
        const quotaAfter = saveB.gamblePlaysInfo();
        check(overlay.mines === null, 'stale Mines wager opened a board');
        check(toasts.at(-1) === staleMessage,
            'stale Mines wager omitted the visible reload message');
        check(announcements.at(-1) === staleMessage,
            'stale Mines wager omitted the accessibility reload message');
        check(quotaAfter.remaining === quotaBefore.remaining
            && quotaAfter.resetInMs === quotaBefore.resetInMs,
            'stale Mines wager consumed or reset the hourly play quota');
        check(audioCalls.forge === 0, 'stale Mines wager played the successful-board cue');
    } finally {
        Math.random = realRandom;
    }
    check(rngCalls === 0, 'stale overlay case/Mines rejection reached RNG');
    check(JSON.stringify(saveB.data) === staleSnapshot,
        'stale overlay case/Mines rejection mutated in-memory state');
    check(saveWrites === writesBeforeOverlay,
        'stale overlay case/Mines rejection attempted a durable write');
    check(storage.get(SAVE_KEY) === durableARaw,
        'stale overlay case/Mines rejection changed A\'s durable payload');
}

function validateHonestPresentationGuards() {
    const overlaySource = readFileSync(new URL('../src/systems/MinigameOverlay.js', import.meta.url), 'utf8');
    const menuSource = readFileSync(new URL('../src/systems/MenuRenderer.js', import.meta.url), 'utf8');
    check(overlaySource.includes('WAGER_BETS.includes(stake)'), 'production overlay does not enforce fixed wager presets');
    check(overlaySource.includes('ABOUT 7% HOUSE EDGE'), 'in-board approximate house-edge disclosure is missing');
    check(overlaySource.includes('quote.odds.safeChance') && overlaySource.includes('quote.odds.mineChance'),
        'in-board next-pick odds are not rendered from the shared quote');
    check(menuSource.includes('exact next-pick odds · about 7% house edge'), 'shop risk disclosure is missing');
    check(!overlaySource.includes('Math.random() * 0.7 - 0.35'), 'random case landing offset returned');
    check(!menuSource.includes('(anim.landOff || 0)'), 'case renderer can still manufacture a near-miss offset');
}

validateCaseDisclosureData();
validateMinesMath();
validateSimulation();
validateCoinLedgerAndQuota();
validateProductionFlow();
validateDurablePaidEntryGuards();
validateHonestPresentationGuards();

console.log(`Gambling economy validation passed: ${checks} checks, ${WAGER_BETS.length} fixed stakes, ${(MINES_HOUSE * 100).toFixed(0)}% theoretical return.`);
