#!/usr/bin/env node
// Focused transaction checks for Mines settlement. The payout may only become
// BANKED after the wallet payload is durably accepted; stale/unavailable/failed
// persistence must restore memory and end on a visible, once-only recovery state.
// Run from the repository root:
//   node tools/validate-mines-transaction-durability.js

import assert from 'node:assert/strict';
import { MINES, MINES_HOUSE, minesPayoutQuote } from '../src/systems/CaseSystem.js';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

const SAVE_KEY = 'monkey-survivor:save:v1';
const storage = new Map();
let saveWrites = 0;
let writeAttempts = 0;
let rejectWrites = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => {
        if (key === SAVE_KEY) {
            writeAttempts++;
            if (rejectWrites) throw new Error('simulated durable write rejection');
            saveWrites++;
        }
        storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key),
} });

const { SaveSystem } = await import('../src/systems/SaveSystem.js');
const { MinigameOverlay } = await import('../src/systems/MinigameOverlay.js');

function seedWallet(balance = 5000) {
    storage.clear();
    saveWrites = 0;
    writeAttempts = 0;
    rejectWrites = false;
    const save = new SaveSystem();
    save.data.totalCoins = balance;
    check(save.save(), 'failed to seed a durable Mines wallet');
    return save;
}

function makeOverlay(save) {
    const events = {
        toasts: [], announcements: [], reveals: [], denies: 0, forge: 0, ticks: 0,
    };
    const game = {
        reducedEffects: true,
        saveSystem: save,
        _setToast: (message) => events.toasts.push(message),
        accessibility: { announce: (message) => events.announcements.push(message) },
        audio: {
            forge: () => { events.forge++; },
            spinTick: () => { events.ticks++; },
            hurt() {}, caseOpen() {},
            reveal: (rarity) => events.reveals.push(rarity),
            deny: () => { events.denies++; },
        },
    };
    const overlay = new MinigameOverlay(game);
    overlay.openMines(250);
    check(overlay.mines?.bet === 250, 'durability fixture did not enter a 250-coin Mines board');
    overlay.mines.mineSet = [19, 20, 21, 22, 23, 24];
    overlay.minesReveal(0);
    check(overlay.mines.safeRevealed === 1, 'durability fixture did not reveal one safe tile');
    return { overlay, events };
}

function makeContext() {
    const texts = [];
    const gradient = { addColorStop() {} };
    return {
        texts,
        globalAlpha: 1,
        save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
        roundRect() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
        fill() {}, stroke() {}, fillRect() {}, drawImage() {}, translate() {}, scale() {}, arc() {},
        fillText(text) { texts.push(String(text)); },
        createLinearGradient() { return gradient; },
        createRadialGradient() { return gradient; },
    };
}

// Guard the authored economy while exercising settlement: this validator is
// only allowed to change durability, never board shape or payout mathematics.
check(MINES.tiles === 25 && MINES.mines === 6,
    'Mines durability patch changed the authored 25-tile / 6-mine board');
check(MINES_HOUSE === 0.93, 'Mines durability patch changed the 93% theoretical return');

// A normal cashout makes exactly one durable wallet write, then publishes the
// success state and reveal. Replaying the same action is inert.
{
    const save = seedWallet();
    const { overlay, events } = makeOverlay(save);
    const walletBefore = save.data.totalCoins;
    const quote = minesPayoutQuote(250, 1);
    const writesBefore = saveWrites;
    const attemptsBefore = writeAttempts;
    check(overlay.minesCashOut() === true, 'durable cashout did not report success');
    check(saveWrites === writesBefore + 1 && writeAttempts === attemptsBefore + 1,
        'durable cashout did not make exactly one accepted wallet write');
    check(save.data.totalCoins === walletBefore + quote.payout,
        'durable cashout credited the in-memory wallet incorrectly');
    check(JSON.parse(storage.get(SAVE_KEY)).totalCoins === walletBefore + quote.payout,
        'durable cashout success was not present in the saved payload');
    check(overlay.mines.stopped && overlay.mines.cashed && !overlay.mines.settlementFailed,
        'accepted wallet write did not publish the terminal BANKED state');
    check(overlay.mines.result?.payout === quote.payout
        && overlay.mines.result?.net === quote.net,
    'accepted wallet write published a result that diverges from the authored quote');
    check(events.reveals.length === 1 && events.denies === 0,
        'accepted wallet write did not emit exactly one success reveal');
    check(events.toasts.length === 0 && events.announcements.length === 0,
        'accepted wallet write emitted a recovery failure message');

    const durableRaw = storage.get(SAVE_KEY);
    const walletAfter = save.data.totalCoins;
    const writesAfter = saveWrites;
    const attemptsAfter = writeAttempts;
    check(overlay.minesCashOut() === false, 'settled board accepted a second cashout');
    check(save.data.totalCoins === walletAfter && storage.get(SAVE_KEY) === durableRaw,
        'second cashout replay changed the in-memory or durable wallet');
    check(saveWrites === writesAfter && writeAttempts === attemptsAfter
        && events.reveals.length === 1,
    'second cashout replay performed another write or success reveal');
}

// Another tab changes the save after this board begins. Cashout must fail
// closed before overwriting that authority, restore the exact local wallet,
// and expose recovery UI without a result object that keyboard code could
// announce as a payout.
{
    const saveA = seedWallet();
    const { overlay, events } = makeOverlay(saveA);
    const walletBefore = saveA.data.totalCoins;
    const saveB = new SaveSystem();
    check(saveB.spendCoins(1), 'tab B could not create the external save change');
    const authoritativeRaw = storage.get(SAVE_KEY);
    const writesBefore = saveWrites;
    const attemptsBefore = writeAttempts;

    check(overlay.minesCashOut() === false, 'stale cashout reported success');
    check(saveA.data.totalCoins === walletBefore,
        'stale cashout did not restore the exact pre-settlement in-memory wallet');
    check(storage.get(SAVE_KEY) === authoritativeRaw,
        'stale cashout overwrote the newer external save');
    check(saveWrites === writesBefore && writeAttempts === attemptsBefore,
        'stale cashout reached the durable write surface');
    check(overlay.mines.stopped && !overlay.mines.cashed
        && overlay.mines.settlementFailed
        && overlay.mines.settlementFailureReason === 'external-save-changed',
    'stale cashout did not enter the terminal external-save recovery state');
    check(overlay.mines.result === null,
        'stale cashout exposed a result object that callers could announce as paid');
    check(events.reveals.length === 0 && events.denies === 1,
        'stale cashout played success audio or omitted denial feedback');
    check(events.toasts.at(-1) === 'Cashout not saved — save changed. Reload to recover.'
        && events.announcements.at(-1) === events.toasts.at(-1),
    'stale cashout did not show and announce the actionable recovery message');

    overlay._mEmber = () => {};
    const ctx = makeContext();
    overlay.drawMines(ctx, { reducedEffects: true, inputModality: 'keyboard' });
    check(ctx.texts.includes('SAVE RECOVERY NEEDED')
        && ctx.texts.includes('Cashout not saved · wallet unchanged'),
    'stale cashout recovery state is not visibly rendered');
    check(!ctx.texts.some((text) => text === 'BANKED!'
        || text.startsWith('Won ') || text.startsWith('FINAL CASHOUT')),
    'stale cashout recovery state still renders success/payout copy');

    const walletAfter = saveA.data.totalCoins;
    check(overlay.minesCashOut() === false && saveA.data.totalCoins === walletAfter,
        'stale recovery state accepted a repeated settlement');
    check(saveWrites === writesBefore && writeAttempts === attemptsBefore
        && events.denies === 1,
    'stale recovery replay retried persistence or repeated denial feedback');
}

// A synchronous localStorage write rejection is not success. SaveSystem leaves
// the optimistic wallet mutation in memory, so MinigameOverlay must own the
// exact rollback and prevent a second attempt from compounding it.
{
    const save = seedWallet();
    const { overlay, events } = makeOverlay(save);
    const walletBefore = save.data.totalCoins;
    const durableBefore = storage.get(SAVE_KEY);
    const attemptsBefore = writeAttempts;
    rejectWrites = true;
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        check(overlay.minesCashOut() === false, 'rejected write reported a successful cashout');
    } finally {
        console.warn = originalWarn;
        rejectWrites = false;
    }
    check(writeAttempts === attemptsBefore + 1,
        'failed cashout did not make exactly one persistence attempt');
    check(save.data.totalCoins === walletBefore,
        'failed cashout did not roll back the optimistic in-memory payout');
    check(storage.get(SAVE_KEY) === durableBefore,
        'failed cashout changed the durable wallet payload');
    check(overlay.mines.stopped && !overlay.mines.cashed
        && overlay.mines.settlementFailed
        && overlay.mines.settlementFailureReason === 'persistence-failed',
    'failed cashout did not enter the terminal persistence recovery state');
    check(overlay.mines.result === null && events.reveals.length === 0
        && events.denies === 1,
    'failed cashout exposed/celebrated a payout');
    check(events.toasts.at(-1) === 'Cashout not saved — wallet unchanged. Reload to recover.'
        && events.announcements.at(-1) === events.toasts.at(-1),
    'failed cashout omitted visible or accessibility recovery feedback');

    const attemptsAfter = writeAttempts;
    check(overlay.minesCashOut() === false && writeAttempts === attemptsAfter,
        'failed cashout recovery state retried a second wallet write');
}

// Full-board auto-cash uses the same transaction. Unavailable persistence must
// stop on recovery (not BANKED), with no in-memory payout and no success chime.
{
    const save = seedWallet();
    const { overlay, events } = makeOverlay(save);
    overlay.mines.revealed = Array.from({ length: 18 }, (_, index) => index);
    overlay.mines.safeRevealed = 18;
    overlay.mines.mul = minesPayoutQuote(250, 18).multiplier;
    const walletBefore = save.data.totalCoins;
    const durableBefore = storage.get(SAVE_KEY);
    save.available = false;
    overlay.minesReveal(18);
    check(overlay.mines.safeRevealed === 19,
        'full-board fixture did not reach the authored automatic cashout threshold');
    check(overlay.mines.stopped && overlay.mines.settlementFailed
        && !overlay.mines.cashed && overlay.mines.result === null,
    'unavailable auto-cashout published a success state');
    check(overlay.mines.settlementFailureReason === 'persistence-unavailable',
        'unavailable auto-cashout did not retain its persistence failure reason');
    check(save.data.totalCoins === walletBefore && storage.get(SAVE_KEY) === durableBefore,
        'unavailable auto-cashout changed the in-memory or durable wallet');
    check(events.reveals.length === 0 && events.denies === 1
        && /Cashout not saved/.test(events.announcements.at(-1) || ''),
    'unavailable auto-cashout celebrated a payout or omitted recovery feedback');
}

console.log(`Mines transaction durability validation passed: ${checks} checks.`);
