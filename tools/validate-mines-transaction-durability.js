#!/usr/bin/env node
// Focused transaction checks for Mines entry and settlement. BANKED may publish
// only after the wallet payload is durable; stale/unavailable/failed cashouts
// restore memory while keeping the exact board open for a once-only retry.
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

const {
    SAVE_PARTICIPATION_LOCK_NAME,
    SAVE_TRANSACTION_LOCK_NAME,
    SaveSystem,
} = await import('../src/systems/SaveSystem.js');
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

function createOverlay(save) {
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
    return { overlay, events };
}

function makeOverlay(save) {
    const { overlay, events } = createOverlay(save);
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

class LockManagerHarness {
    constructor() {
        this.calls = [];
        this.holders = new Map();
        this.queues = new Map();
        this.serial = 0;
    }

    request(name, options, callback) {
        const normalized = {
            mode: options?.mode === 'shared' ? 'shared' : 'exclusive',
            ifAvailable: options?.ifAvailable === true,
        };
        const request = {
            id: ++this.serial, name, options: normalized, callback,
        };
        this.calls.push({ id: request.id, name, options: { ...normalized } });
        return new Promise((resolve, reject) => {
            Object.assign(request, { resolve, reject });
            if (normalized.ifAvailable) {
                queueMicrotask(() => {
                    if (this._canGrant(name, normalized.mode)) this._grant(request);
                    else {
                        try {
                            Promise.resolve(callback(null)).then(resolve, reject);
                        } catch (error) {
                            reject(error);
                        }
                    }
                });
                return;
            }
            if (!this.queues.has(name)) this.queues.set(name, []);
            this.queues.get(name).push(request);
            queueMicrotask(() => this._drain(name));
        });
    }

    _canGrant(name, mode) {
        const holders = this.holders.get(name) || [];
        return mode === 'shared'
            ? holders.every((holder) => holder.mode === 'shared')
            : holders.length === 0;
    }

    _drain(name) {
        const queue = this.queues.get(name) || [];
        if (!queue.length || !this._canGrant(name, queue[0].options.mode)) return;
        if (queue[0].options.mode === 'exclusive') {
            this._grant(queue.shift());
            return;
        }
        while (queue.length && queue[0].options.mode === 'shared'
            && this._canGrant(name, 'shared')) {
            this._grant(queue.shift());
        }
    }

    _grant(request) {
        const holder = { id: request.id, mode: request.options.mode };
        if (!this.holders.has(request.name)) this.holders.set(request.name, []);
        this.holders.get(request.name).push(holder);
        let result;
        try {
            result = request.callback(Object.freeze({
                name: request.name,
                mode: holder.mode,
            }));
        } catch (error) {
            this._release(request.name, holder);
            request.reject(error);
            return;
        }
        Promise.resolve(result).then((value) => {
            this._release(request.name, holder);
            request.resolve(value);
        }, (error) => {
            this._release(request.name, holder);
            request.reject(error);
        });
    }

    _release(name, holder) {
        const holders = this.holders.get(name) || [];
        const index = holders.indexOf(holder);
        if (index >= 0) holders.splice(index, 1);
        queueMicrotask(() => this._drain(name));
    }

    held(name, mode = null) {
        return (this.holders.get(name) || []).filter((holder) =>
            mode == null || holder.mode === mode).length;
    }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setBrowserLocks(manager) {
    Object.defineProperty(globalThis, 'window', {
        configurable: true, writable: true, value: {},
    });
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true, writable: true, value: manager ? { locks: manager } : {},
    });
}

function restoreGlobal(key, descriptor) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
}

function setDeterministicMinesRandom() {
    const realRandom = Math.random;
    let calls = 0;
    Math.random = () => {
        const value = ((calls % MINES.tiles) + 0.5) / MINES.tiles;
        calls += 1;
        return value;
    };
    return {
        calls: () => calls,
        restore: () => { Math.random = realRandom; },
    };
}

async function browserSave(storageRaw, manager) {
    storage.clear();
    storage.set(SAVE_KEY, storageRaw);
    saveWrites = 0;
    writeAttempts = 0;
    rejectWrites = false;
    setBrowserLocks(manager);
    const save = new SaveSystem();
    check(await save.whenSaveParticipationReady(),
        'browser Mines save did not acquire its shared participant lock');
    return save;
}

async function additionalBrowserSave(manager) {
    setBrowserLocks(manager);
    const save = new SaveSystem();
    check(await save.whenSaveParticipationReady(),
        'additional browser Mines save did not acquire its participant lock');
    return save;
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

// Another tab changes the save after this board begins. Headless settlement
// must fail closed before overwriting that authority while leaving the live
// board open for a player-controlled retry/reload, never converting a won
// cashout into a terminal lost stake.
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
    check(!overlay.mines.stopped && !overlay.mines.cashed
        && !overlay.mines.settlementFailed,
    'stale cashout closed or terminalized the retryable board');
    check(overlay.mines.result === null,
        'stale cashout exposed a result object that callers could announce as paid');
    check(events.reveals.length === 0 && events.denies === 0,
        'stale cashout played success or terminal-loss audio');
    check(events.toasts.at(-1) === 'Cashout paused — save changed. Try again.'
        && events.announcements.at(-1) === events.toasts.at(-1),
    'stale cashout did not show and announce retryable recovery copy');

    overlay._mEmber = () => {};
    const ctx = makeContext();
    overlay.drawMines(ctx, { reducedEffects: true, inputModality: 'keyboard' });
    check(ctx.texts.some((text) => text.startsWith('CASH OUT ◎')),
        'stale cashout did not keep the active cashout control visible');
    check(!ctx.texts.some((text) => text === 'BANKED!'
        || text === 'SAVE RECOVERY NEEDED'
        || text.startsWith('Won ') || text.startsWith('FINAL CASHOUT')),
    'stale retryable board rendered terminal success/recovery copy');

    const walletAfter = saveA.data.totalCoins;
    check(overlay.minesCashOut() === false && saveA.data.totalCoins === walletAfter,
        'stale retry changed the wallet or falsely reported success');
    check(saveWrites === writesBefore && writeAttempts === attemptsBefore
        && !overlay.mines.stopped && overlay.mines.result === null,
    'stale retry reached persistence or terminalized the board');
}

// A synchronous localStorage write rejection is not success. Exact rollback
// keeps the board live; a clean retry pays once and publishes one BANKED state.
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
    check(!overlay.mines.stopped && !overlay.mines.cashed
        && !overlay.mines.settlementFailed,
    'failed cashout terminalized the retryable board');
    check(overlay.mines.result === null && events.reveals.length === 0
        && events.denies === 0,
    'failed cashout exposed/celebrated a payout or loss');
    check(events.toasts.at(-1) === 'Cashout not saved — board kept open. Try again.'
        && events.announcements.at(-1) === events.toasts.at(-1),
    'failed cashout omitted visible or accessibility retry feedback');

    const attemptsAfter = writeAttempts;
    const writesAfter = saveWrites;
    const quote = minesPayoutQuote(250, 1);
    check(overlay.minesCashOut() === true,
        'clean cashout retry after write failure did not succeed');
    check(writeAttempts === attemptsAfter + 1 && saveWrites === writesAfter + 1,
        'clean cashout retry did not make exactly one accepted write');
    check(save.data.totalCoins === walletBefore + quote.payout
        && overlay.mines.stopped && overlay.mines.cashed
        && overlay.mines.result?.payout === quote.payout,
    'clean cashout retry did not pay and publish exactly once');
    check(events.reveals.length === 1 && events.denies === 0,
        'clean cashout retry did not emit exactly one success reveal');
}

// Full-board auto-cash uses the same transaction. Unavailable persistence keeps
// the completed board open; restoring persistence lets the exact max quote bank.
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
    check(!overlay.mines.stopped && !overlay.mines.settlementFailed
        && !overlay.mines.cashed && overlay.mines.result === null,
    'unavailable auto-cashout terminalized or published the board');
    check(save.data.totalCoins === walletBefore && storage.get(SAVE_KEY) === durableBefore,
        'unavailable auto-cashout changed the in-memory or durable wallet');
    check(events.reveals.length === 0 && events.denies === 0
        && /Cashout not saved/.test(events.announcements.at(-1) || ''),
    'unavailable auto-cashout celebrated a result or omitted retry feedback');
    save.available = true;
    const maxQuote = minesPayoutQuote(250, 19);
    check(overlay.minesCashOut() === true,
        'restored full-board cashout did not retry successfully');
    check(overlay.mines.cashed && overlay.mines.result?.payout === maxQuote.payout
        && save.data.totalCoins === walletBefore + maxQuote.payout,
    'restored full-board retry did not bank the exact authored max quote');
}

// Browser start transaction: stake + rolling-hour receipt are one exclusive
// commit. No board, RNG, or forge cue may escape before that durable receipt.
try {
    const manager = new LockManagerHarness();
    const save = await browserSave(JSON.stringify({
        totalCoins: 5000,
        version: 10,
    }), manager);
    const { overlay, events } = createOverlay(save);
    const walletBefore = save.data.totalCoins;
    const quotaBefore = save.gamblePlaysInfo().remaining;
    const writesBefore = saveWrites;
    const attemptsBefore = writeAttempts;
    const random = setDeterministicMinesRandom();
    let task;
    let duplicate;
    let success;
    try {
        task = overlay.openMines(250);
        check(task === overlay._minesStartTask,
            'Mines overlay did not expose its exact pending start task');
        check(overlay.mines === null && events.forge === 0 && random.calls() === 0,
            'Mines exposed a board, RNG, or forge cue before durable settlement');
        duplicate = overlay.openMines(250);
        check(duplicate === task, 'duplicate Mines tap created a second start task');
        check(events.toasts.at(-1) === 'Mines entry in progress — please wait'
            && events.announcements.at(-1) === events.toasts.at(-1),
        'duplicate Mines tap omitted matching visible/accessibility busy copy');
        success = await task;
    } finally {
        random.restore();
    }
    check(success?.ok === true && success.bet === 250,
        'single-tab exclusive Mines start did not succeed');
    check(random.calls() === MINES.mines,
        'accepted Mines start changed the six-call mine-placement RNG order');
    check(JSON.stringify(success.mineSet) === JSON.stringify([0, 1, 2, 3, 4, 5]),
        'accepted Mines start changed deterministic mine placement');
    check(overlay.mines?.bet === 250
        && JSON.stringify(overlay.mines.mineSet) === JSON.stringify(success.mineSet),
    'durable Mines receipt did not create its exact board');
    check(events.forge === 1 && overlay._minesStartTask === null,
        'durable Mines start omitted its one success cue or retained pending state');
    check(save.data.totalCoins === walletBefore - 250
        && save.gamblePlaysInfo().remaining === quotaBefore - 1,
    'exclusive Mines start did not debit stake and quota exactly once');
    check(saveWrites === writesBefore + 1 && writeAttempts === attemptsBefore + 1,
        'exclusive Mines start did not collapse stake + quota into one final write');
    check(JSON.stringify(JSON.parse(storage.get(SAVE_KEY))) === JSON.stringify(save.data),
        'Mines success appeared before its exact wallet/quota payload was durable');
    check(manager.calls.some((call) => call.name === SAVE_TRANSACTION_LOCK_NAME
        && call.options.mode === 'exclusive' && call.options.ifAvailable),
    'Mines start did not enter the nested transaction mutex');
    check(manager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 1,
        'Mines start did not reacquire its shared participant lock');

    // Browser cashout owns one pending task. Duplicate cash taps, tile reveals,
    // dismiss, BANKED/result, wallet credit, and reveal audio all wait for the
    // exact durable payout receipt.
    overlay.minesReveal(6);
    const cashQuote = minesPayoutQuote(250, 1);
    const cashWallet = save.data.totalCoins;
    const cashWrites = saveWrites;
    const cashAttempts = writeAttempts;
    const cashBoard = overlay.mines;
    const cashTask = overlay.minesCashOut();
    check(cashTask === overlay._minesCashoutTask,
        'browser cashout did not expose its exact pending task');
    check(!cashBoard.stopped && !cashBoard.cashed && cashBoard.result === null
        && events.reveals.length === 0
        && save.data.totalCoins === cashWallet
        && saveWrites === cashWrites,
    'cashout published result/audio/credit before durable settlement');
    const duplicateCash = overlay.minesCashOut();
    check(duplicateCash === cashTask,
        'duplicate cashout tap created a second settlement task');
    check(events.toasts.at(-1) === 'Cashout in progress — please wait'
        && events.announcements.at(-1) === events.toasts.at(-1),
    'duplicate cashout omitted matching visible/accessibility pending copy');
    const revealedBeforeCash = cashBoard.revealed.length;
    overlay.minesReveal(7);
    check(cashBoard.revealed.length === revealedBeforeCash,
        'tile reveal advanced while cashout was pending');
    check(overlay.dismissMines() === false && overlay.mines === cashBoard,
        'dismiss removed the board while cashout was pending');
    const cashResult = await cashTask;
    check(cashResult?.ok === true
        && cashResult.payout === cashQuote.payout
        && cashResult.balanceBefore === cashWallet
        && cashResult.balanceAfter === cashWallet + cashQuote.payout,
    'browser cashout returned the wrong durable receipt');
    check(saveWrites === cashWrites + 1 && writeAttempts === cashAttempts + 1,
        'browser cashout did not perform exactly one final payout write');
    check(save.data.totalCoins === cashWallet + cashQuote.payout
        && JSON.parse(storage.get(SAVE_KEY)).totalCoins === save.data.totalCoins,
    'browser cashout receipt preceded its durable wallet credit');
    check(cashBoard.stopped && cashBoard.cashed
        && cashBoard.result?.payout === cashQuote.payout
        && cashBoard.result?.net === cashQuote.net
        && cashBoard.result?.mul === cashQuote.multiplier,
    'browser cashout changed the accepted authored result');
    check(events.reveals.length === 1 && overlay._minesCashoutTask === null,
        'browser cashout omitted its one reveal or retained pending state');
    const paidWallet = save.data.totalCoins;
    const paidWrites = saveWrites;
    check(overlay.minesCashOut() === false
        && save.data.totalCoins === paidWallet && saveWrites === paidWrites,
    'settled browser board accepted a replayed cashout');

    // Final-write rejection consumes placement RNG inside the protected draft,
    // but cannot publish a board, charge stake/quota, or play success audio.
    const failureFixture = createOverlay(save);
    const failureMemory = JSON.stringify(save.data);
    const failureRaw = storage.get(SAVE_KEY);
    const failureWrites = saveWrites;
    const failureAttempts = writeAttempts;
    const failureQuota = save.gamblePlaysInfo().remaining;
    rejectWrites = true;
    const failedRandom = setDeterministicMinesRandom();
    const originalWarn = console.warn;
    console.warn = () => {};
    let failed;
    try {
        failed = await failureFixture.overlay.openMines(250);
    } finally {
        console.warn = originalWarn;
        failedRandom.restore();
        rejectWrites = false;
    }
    check(failed?.ok === false && failed.reason === 'persistence-failed',
        'failed Mines final write did not return persistence-failed');
    check(failedRandom.calls() === MINES.mines,
        'failed final write changed protected mine-placement RNG order');
    check(failureFixture.overlay.mines === null
        && failureFixture.events.forge === 0
        && failureFixture.overlay._minesStartTask === null,
    'failed Mines write exposed a board/cue or retained pending state');
    check(JSON.stringify(save.data) === failureMemory
        && storage.get(SAVE_KEY) === failureRaw,
    'failed Mines write leaked wallet/quota state to memory or storage');
    check(save.gamblePlaysInfo().remaining === failureQuota,
        'failed Mines write consumed the rolling-hour receipt');
    check(writeAttempts === failureAttempts + 1 && saveWrites === failureWrites,
        'failed Mines start did not make exactly one rejected write attempt');
    check(failureFixture.events.toasts.at(-1) === 'Mines entry not saved — wager not charged'
        && failureFixture.events.announcements.at(-1)
            === failureFixture.events.toasts.at(-1),
    'failed Mines write omitted truthful visible/accessibility recovery copy');

    const retryWrites = saveWrites;
    const retryQuota = save.gamblePlaysInfo().remaining;
    const retryRandom = setDeterministicMinesRandom();
    let retry;
    try {
        retry = await failureFixture.overlay.openMines(250);
    } finally {
        retryRandom.restore();
    }
    check(retry?.ok === true && retryRandom.calls() === MINES.mines,
        'same-tab Mines retry after write failure did not succeed deterministically');
    check(saveWrites === retryWrites + 1
        && save.gamblePlaysInfo().remaining === retryQuota - 1,
    'same-tab Mines retry did not consume one write and one quota receipt');

    failureFixture.overlay.minesReveal(6);
    const failedCashBoard = failureFixture.overlay.mines;
    const failedCashQuote = minesPayoutQuote(250, 1);
    const failedCashWallet = save.data.totalCoins;
    const failedCashRaw = storage.get(SAVE_KEY);
    const failedCashWrites = saveWrites;
    const failedCashAttempts = writeAttempts;
    rejectWrites = true;
    console.warn = () => {};
    let failedCash;
    try {
        const failedCashTask = failureFixture.overlay.minesCashOut();
        check(!failedCashBoard.stopped && failedCashBoard.result === null
            && failureFixture.events.reveals.length === 0,
        'failed-write cashout published pending success state');
        failedCash = await failedCashTask;
    } finally {
        console.warn = originalWarn;
        rejectWrites = false;
    }
    check(failedCash?.ok === false && failedCash.reason === 'persistence-failed',
        'forced browser cashout write failure returned the wrong receipt');
    check(save.data.totalCoins === failedCashWallet
        && storage.get(SAVE_KEY) === failedCashRaw,
    'failed browser cashout leaked an in-memory or durable payout');
    check(writeAttempts === failedCashAttempts + 1 && saveWrites === failedCashWrites,
        'failed browser cashout did not make exactly one rejected final write');
    check(!failedCashBoard.stopped && !failedCashBoard.cashed
        && !failedCashBoard.settlementFailed && failedCashBoard.result === null
        && failureFixture.overlay._minesCashoutTask === null,
    'failed browser cashout terminalized or retained the retryable board');
    check(failureFixture.events.reveals.length === 0
        && failureFixture.events.denies === 0
        && failureFixture.events.toasts.at(-1)
            === 'Cashout not saved — board kept open. Try again.'
        && failureFixture.events.announcements.at(-1)
            === failureFixture.events.toasts.at(-1),
    'failed browser cashout exposed success/loss feedback or false recovery copy');

    const cashRetryWrites = saveWrites;
    const cashRetryAttempts = writeAttempts;
    const cashRetry = await failureFixture.overlay.minesCashOut();
    check(cashRetry?.ok === true
        && cashRetry.payout === failedCashQuote.payout,
    'browser cashout retry after final-write failure did not succeed');
    check(saveWrites === cashRetryWrites + 1
        && writeAttempts === cashRetryAttempts + 1
        && save.data.totalCoins === failedCashWallet + failedCashQuote.payout,
    'browser cashout retry did not credit exactly once in one write');
    check(failedCashBoard.stopped && failedCashBoard.cashed
        && failedCashBoard.result?.payout === failedCashQuote.payout
        && failureFixture.events.reveals.length === 1,
    'browser cashout retry did not publish exactly one accepted result/reveal');
    const afterCashRetry = save.data.totalCoins;
    const afterCashRetryWrites = saveWrites;
    check(failureFixture.overlay.minesCashOut() === false
        && save.data.totalCoins === afterCashRetry
        && saveWrites === afterCashRetryWrites,
    'browser cashout retry could be replayed for a second credit');
    await save.dispose();

    // Reproduce the prior TOCTOU: A passes preflight, B writes before A enters
    // the async callback. B's participant share must block A before RNG, stake,
    // quota, board, or success feedback.
    const crossManager = new LockManagerHarness();
    const first = await browserSave(JSON.stringify({
        totalCoins: 5000,
        version: 10,
    }), crossManager);
    const second = await additionalBrowserSave(crossManager);
    check(crossManager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 2,
        'cross-tab Mines fixture did not hold two participant shares');
    const cross = createOverlay(first);
    const crossWallet = first.data.totalCoins;
    const crossQuota = first.gamblePlaysInfo().remaining;
    const crossWrites = saveWrites;
    const crossRandom = setDeterministicMinesRandom();
    let blocked;
    try {
        const blockedTask = cross.overlay.openMines(250);
        check(second.setSetting('volMusic', 0.41) === 0.41,
            'second participant could not write in the reproduced Mines TOCTOU window');
        blocked = await blockedTask;
    } finally {
        crossRandom.restore();
    }
    check(blocked?.ok === false && blocked.reason === 'transaction-busy',
        'second live participant did not reject Mines as transaction-busy');
    check(crossRandom.calls() === 0,
        'contended Mines start consumed RNG before participant exclusion');
    check(cross.overlay.mines === null && cross.events.forge === 0,
        'contended Mines start exposed a board or success cue');
    check(first.data.totalCoins === crossWallet
        && first.gamblePlaysInfo().remaining === crossQuota,
    'contended Mines start charged stake or quota');
    check(saveWrites === crossWrites + 1
        && JSON.parse(storage.get(SAVE_KEY)).settings.volMusic === 0.41,
    'contended Mines start overwrote the second participant write');
    check(crossManager.calls.filter((call) =>
        call.name === SAVE_TRANSACTION_LOCK_NAME).length === 0,
    'contended Mines start entered the nested transaction mutex');
    check(cross.events.toasts.at(-1) === 'Another tab is saving — try Mines again'
        && cross.events.announcements.at(-1) === cross.events.toasts.at(-1),
    'contended Mines start omitted truthful visible/accessibility busy copy');
    await first.dispose();
    await second.dispose();

    const fresh = await additionalBrowserSave(crossManager);
    const freshFixture = createOverlay(fresh);
    const freshWrites = saveWrites;
    const freshRandom = setDeterministicMinesRandom();
    let freshRetry;
    try {
        freshRetry = await freshFixture.overlay.openMines(250);
    } finally {
        freshRandom.restore();
    }
    check(freshRetry?.ok === true && freshRandom.calls() === MINES.mines,
        'reload retry after cross-tab Mines contention did not succeed');
    check(saveWrites === freshWrites + 1
        && fresh.data.settings.volMusic === 0.41,
    'reload retry did not preserve the newer ordinary-tab setting');

    freshFixture.overlay.minesReveal(6);
    const busyCashBoard = freshFixture.overlay.mines;
    const busyCashQuote = minesPayoutQuote(250, 1);
    const busyCashWallet = fresh.data.totalCoins;
    const busyCashWrites = saveWrites;
    const cashPeer = await additionalBrowserSave(crossManager);
    const busyCashTask = freshFixture.overlay.minesCashOut();
    check(cashPeer.setSetting('volMusic', 0.52) === 0.52,
        'cashout peer could not write in the reproduced contention window');
    const busyCash = await busyCashTask;
    check(busyCash?.ok === false && busyCash.reason === 'transaction-busy',
        'second live participant did not block browser cashout');
    check(fresh.data.totalCoins === busyCashWallet
        && JSON.parse(storage.get(SAVE_KEY)).totalCoins === busyCashWallet
        && saveWrites === busyCashWrites + 1,
    'busy browser cashout credited or overwrote the ordinary peer write');
    check(!busyCashBoard.stopped && !busyCashBoard.cashed
        && busyCashBoard.result === null
        && freshFixture.events.reveals.length === 0
        && freshFixture.overlay._minesCashoutTask === null,
    'busy browser cashout published or terminalized the retryable board');
    check(freshFixture.events.toasts.at(-1)
        === 'Cashout paused — another tab is saving. Try again.'
        && freshFixture.events.announcements.at(-1)
            === freshFixture.events.toasts.at(-1),
    'busy browser cashout omitted truthful visible/accessibility retry copy');
    await cashPeer.dispose();

    const busyRetryWrites = saveWrites;
    const busyRetry = await freshFixture.overlay.minesCashOut();
    check(busyRetry?.ok === true && busyRetry.payout === busyCashQuote.payout,
        'browser cashout retry after peer contention did not succeed');
    check(saveWrites === busyRetryWrites + 1
        && fresh.data.totalCoins === busyCashWallet + busyCashQuote.payout
        && fresh.data.settings.volMusic === 0.52,
    'cashout contention retry did not preserve peer authority and credit once');
    check(busyCashBoard.stopped && busyCashBoard.cashed
        && busyCashBoard.result?.payout === busyCashQuote.payout
        && freshFixture.events.reveals.length === 1,
    'cashout contention retry did not publish the exact accepted result');
    await fresh.dispose();

    // A nonparticipating/legacy writer can still change localStorage after the
    // participant preflight. The final stale comparison must reject, refresh on
    // share reacquisition, and leave the board live for a clean retry.
    const staleManager = new LockManagerHarness();
    const staleSave = await browserSave(JSON.stringify({
        totalCoins: 5000,
        version: 10,
    }), staleManager);
    const staleFixture = createOverlay(staleSave);
    const staleStartRandom = setDeterministicMinesRandom();
    try {
        check((await staleFixture.overlay.openMines(250))?.ok === true,
            'stale-cashout fixture could not durably start Mines');
    } finally {
        staleStartRandom.restore();
    }
    staleFixture.overlay.minesReveal(6);
    const staleCashBoard = staleFixture.overlay.mines;
    const staleCashQuote = minesPayoutQuote(250, 1);
    const staleCashWallet = staleSave.data.totalCoins;
    const legacyAuthority = JSON.parse(storage.get(SAVE_KEY));
    legacyAuthority.settings.volMusic = 0.62;
    storage.set(SAVE_KEY, JSON.stringify(legacyAuthority));
    const staleCashWrites = saveWrites;
    const staleCashAttempts = writeAttempts;
    const staleCash = await staleFixture.overlay.minesCashOut();
    check(staleCash?.ok === false && staleCash.reason === 'external-save-changed',
        'legacy storage change did not reject browser cashout as stale');
    check(saveWrites === staleCashWrites && writeAttempts === staleCashAttempts,
        'stale browser cashout reached the durable write surface');
    check(staleSave.data.totalCoins === staleCashWallet
        && staleSave.data.settings.volMusic === 0.62
        && JSON.parse(storage.get(SAVE_KEY)).totalCoins === staleCashWallet,
    'stale cashout credited or failed to refresh newer authority');
    check(!staleCashBoard.stopped && !staleCashBoard.cashed
        && staleCashBoard.result === null
        && staleFixture.events.reveals.length === 0,
    'stale browser cashout terminalized or published the live board');
    check(staleFixture.events.toasts.at(-1)
        === 'Cashout paused — save changed. Try again.'
        && staleFixture.events.announcements.at(-1)
            === staleFixture.events.toasts.at(-1),
    'stale browser cashout omitted actionable retry copy');
    const staleRetryWrites = saveWrites;
    const staleRetry = await staleFixture.overlay.minesCashOut();
    check(staleRetry?.ok === true && staleRetry.payout === staleCashQuote.payout,
        'cashout retry after stale-authority refresh did not succeed');
    check(saveWrites === staleRetryWrites + 1
        && staleSave.data.totalCoins === staleCashWallet + staleCashQuote.payout
        && staleSave.data.settings.volMusic === 0.62,
    'stale cashout retry did not preserve newer authority and credit once');
    await staleSave.dispose();

    // A real window without Web Locks fails closed; the Node-only synchronous
    // seam must never make unsupported browsers silently accept a wager.
    storage.clear();
    storage.set(SAVE_KEY, JSON.stringify({ totalCoins: 5000, version: 10 }));
    saveWrites = 0;
    writeAttempts = 0;
    setBrowserLocks(null);
    const unsupported = new SaveSystem();
    const unsupportedFixture = createOverlay(unsupported);
    const unsupportedRandom = setDeterministicMinesRandom();
    let unsupportedResult;
    try {
        unsupportedResult = await unsupportedFixture.overlay.openMines(250);
    } finally {
        unsupportedRandom.restore();
    }
    check(unsupportedResult?.ok === false
        && unsupportedResult.reason === 'transaction-lock-unavailable',
    'Web-Locks-unavailable browser did not fail Mines closed');
    check(unsupportedRandom.calls() === 0
        && unsupportedFixture.overlay.mines === null
        && unsupportedFixture.events.forge === 0,
    'Web-Locks-unavailable Mines start consumed RNG or exposed success state');
    check(writeAttempts === 0,
        'Web-Locks-unavailable Mines start attempted a wallet/quota write');
    check(unsupportedFixture.events.toasts.at(-1)
        === 'Secure Mines entry unavailable — wager not charged'
        && unsupportedFixture.events.announcements.at(-1)
            === unsupportedFixture.events.toasts.at(-1),
    'Web-Locks-unavailable Mines start omitted clear failure copy');
    await unsupported.dispose();
} finally {
    restoreGlobal('window', originalWindow);
    restoreGlobal('navigator', originalNavigator);
}

console.log(`Mines transaction durability validation passed: ${checks} checks.`);
