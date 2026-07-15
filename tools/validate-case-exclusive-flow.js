#!/usr/bin/env node
// Browser-shaped proof for paid case opens. The synchronous openCase resolver
// is a deterministic/internal seam; the player-facing path must enter
// SaveSystem's origin-wide exclusive boundary before RNG, mutate only a draft,
// commit exactly once, and reveal only after durable success.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    GameInputActionMethods,
    hasPendingSecureMenuSave,
} from '../src/core/GameInputActions.js';
import { CASES, openCaseAtomic } from '../src/systems/CaseSystem.js';
import { MinigameOverlay } from '../src/systems/MinigameOverlay.js';
import {
    SAVE_PARTICIPATION_LOCK_NAME,
    SAVE_TRANSACTION_LOCK_NAME,
    SaveSystem,
} from '../src/systems/SaveSystem.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
let checks = 0;
const check = (condition, message) => {
    assert.ok(condition, message);
    checks += 1;
};
const same = (actual, expected, message) => {
    assert.deepEqual(actual, expected, message);
    checks += 1;
};

class MemoryStorage {
    constructor(raw) {
        this.values = new Map([[SAVE_KEY, String(raw)]]);
        this.saveWrites = 0;
        this.saveWriteAttempts = 0;
        this.failNextSave = false;
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        if (key === SAVE_KEY) {
            this.saveWriteAttempts += 1;
            if (this.failNextSave) {
                this.failNextSave = false;
                throw new Error('injected paid-case write failure');
            }
            this.saveWrites += 1;
        }
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

// Minimal origin-wide Web Locks model. Shared participants coexist; exclusive
// ifAvailable requests never queue and therefore expose contention immediately.
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
            id: ++this.serial,
            name,
            options: normalized,
            callback,
        };
        this.calls.push({
            id: request.id,
            name,
            options: { ...normalized },
        });
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

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalWarn = console.warn;

function setGlobal(key, value) {
    Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
    });
}

function restoreGlobal(key, descriptor) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
}

function seededRaw(coins = 200_000) {
    return JSON.stringify({ totalCoins: coins, version: 10 });
}

async function withRandom(sequence, action) {
    const original = Math.random;
    let calls = 0;
    Math.random = () => {
        const value = sequence[calls] ?? 0;
        calls += 1;
        return value;
    };
    try {
        return { result: await action(), calls };
    } finally {
        Math.random = original;
    }
}

async function createParticipatingSave(storage, manager) {
    setGlobal('localStorage', storage);
    setGlobal('navigator', { locks: manager });
    setGlobal('window', {});
    const save = new SaveSystem();
    check(await save.whenSaveParticipationReady(),
        'paid-case SaveSystem did not acquire its shared participant lock');
    return save;
}

async function validateSingleTabCommitAndRollback() {
    const manager = new LockManagerHarness();
    const storage = new MemoryStorage(seededRaw());
    const save = await createParticipatingSave(storage, manager);
    const writesBefore = storage.saveWrites;
    const balanceBefore = save.data.totalCoins;
    const casesBefore = save.data.stats.casesOpened;
    const success = await withRandom([0, 0, 0], () =>
        openCaseAtomic(save, 'basic'));

    check(success.result.ok === true, 'single-tab paid case did not succeed');
    check(success.calls === 3, 'exclusive paid case changed successful RNG order');
    check(storage.saveWrites === writesBefore + 1,
        'single-tab paid case did not perform exactly one durable write');
    check(save.data.totalCoins === balanceBefore - CASES.basic.cost,
        'single-tab paid case charged the wrong amount');
    check(save.data.stats.casesOpened === casesBefore + 1,
        'single-tab paid case did not advance its stat exactly once');
    same(JSON.parse(storage.getItem(SAVE_KEY)), save.data,
        'single-tab success receipt preceded its exact durable payload');
    check(manager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 1,
        'single-tab paid case did not reacquire its participant share');
    check(manager.calls.some((call) => call.name === SAVE_TRANSACTION_LOCK_NAME
        && call.options.mode === 'exclusive' && call.options.ifAvailable),
    'paid case did not enter the nested transaction mutex');

    const liveData = save.data;
    const memoryBefore = structuredClone(save.data);
    const rawBefore = storage.getItem(SAVE_KEY);
    const attemptsBefore = storage.saveWriteAttempts;
    const durableWritesBefore = storage.saveWrites;
    storage.failNextSave = true;
    const originalWarnForFailure = console.warn;
    console.warn = () => {};
    let failed;
    try {
        failed = await withRandom([0, 0, 0], () => openCaseAtomic(save, 'basic'));
    } finally {
        console.warn = originalWarnForFailure;
    }
    same(failed.result, { ok: false, reason: 'persistence-failed' },
        'failed final paid-case write did not return persistence-failed');
    check(failed.calls === 3, 'failed final write changed case RNG order');
    check(save.data === liveData, 'failed final write did not restore the live data object');
    same(save.data, memoryBefore,
        'failed final write leaked wallet/stat/pity/reward draft state');
    check(storage.getItem(SAVE_KEY) === rawBefore,
        'failed final write changed durable case authority');
    check(storage.saveWriteAttempts === attemptsBefore + 1
        && storage.saveWrites === durableWritesBefore,
    'failed paid case did not collapse to one rejected write attempt');

    const retryWrites = storage.saveWrites;
    const retry = await withRandom([0, 0, 0], () => openCaseAtomic(save, 'basic'));
    check(retry.result.ok === true && retry.calls === 3,
        'same-tab retry after write failure did not succeed deterministically');
    check(storage.saveWrites === retryWrites + 1,
        'same-tab retry did not use exactly one durable write');
    await save.dispose();
}

async function validateCrossTabToctouAndRetry() {
    const manager = new LockManagerHarness();
    const storage = new MemoryStorage(seededRaw());
    const first = await createParticipatingSave(storage, manager);
    const second = await createParticipatingSave(storage, manager);
    check(manager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 2,
        'cross-tab fixture did not hold two shared participant locks');
    const firstBefore = structuredClone(first.data);
    const writesBefore = storage.saveWrites;

    // Reproduce the old TOCTOU: A passes its synchronous preflight, then B
    // writes before A can enter the asynchronous lock callback. The participant
    // barrier must reject A before a single reward RNG call.
    const blocked = await withRandom([], async () => {
        const task = openCaseAtomic(first, 'royal');
        check(second.setSetting('volMusic', 0.31) === 0.31,
            'second participant could not commit inside the reproduced TOCTOU window');
        return task;
    });
    same(blocked.result, { ok: false, reason: 'transaction-busy' },
        'second live participant did not make paid case fail busy');
    check(blocked.calls === 0,
        'contended paid case consumed reward RNG before participant exclusion');
    const newerAuthority = JSON.parse(storage.getItem(SAVE_KEY));
    check(first.data.totalCoins === firstBefore.totalCoins
        && first.data.stats.casesOpened === firstBefore.stats.casesOpened
        && JSON.stringify(first.data.casePity) === JSON.stringify(firstBefore.casePity),
    'contended paid case changed wallet/stat/pity state');
    same(first.data, newerAuthority,
        'reacquired participant share did not refresh to the newer authority');
    check(storage.saveWrites === writesBefore + 1
        && newerAuthority.settings.volMusic === 0.31,
    'contended paid case overwrote or obscured the second tab write');
    check(manager.calls.filter((call) => call.name === SAVE_TRANSACTION_LOCK_NAME).length === 0,
        'contended case entered the nested transaction mutex');
    check(manager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 2,
        'contended case did not restore both participant shares');

    // A clean reload is the player-facing retry. Once both old participants
    // are disposed, a fresh SaveSystem starts from B's exact durable authority.
    await first.dispose();
    await second.dispose();
    const retrySave = await createParticipatingSave(storage, manager);
    const retryWrites = storage.saveWrites;
    const retry = await withRandom([0, 0, 0], () =>
        openCaseAtomic(retrySave, 'royal'));
    check(retry.result.ok === true && retry.calls === 3,
        'fresh retry after cross-tab contention did not succeed');
    check(storage.saveWrites === retryWrites + 1,
        'cross-tab retry did not make exactly one durable case write');
    check(retrySave.data.settings.volMusic === 0.31,
        'cross-tab retry erased the newer ordinary setting write');
    await retrySave.dispose();
}

async function validateOverlayWaitsForDurableReceipt() {
    let settle;
    const transaction = new Promise((resolve) => { settle = resolve; });
    const fakeSave = {
        data: { totalCoins: 100_000 },
        save: () => true,
        _storageUnchangedSinceLastWrite: () => ({ ok: true }),
        runExclusiveSaveTransaction: () => transaction,
        getSetting: () => false,
    };
    const toasts = [];
    const announcements = [];
    let caseOpenAudio = 0;
    let revealAudio = 0;
    const game = {
        saveSystem: fakeSave,
        _setToast: (message) => toasts.push(message),
        accessibility: { announce: (message) => announcements.push(message) },
        audio: {
            caseOpen: () => { caseOpenAudio += 1; },
            reveal: () => { revealAudio += 1; },
            spinTick() {},
        },
    };
    const overlay = new MinigameOverlay(game);
    const first = overlay.openCaseFlow('basic');
    check(first === overlay._caseOpenTask,
        'overlay did not expose its exact pending paid-case task');
    check(overlay.caseAnim === null && caseOpenAudio === 0 && revealAudio === 0,
        'overlay exposed a reel or reward audio before durable success');
    const second = overlay.openCaseFlow('basic');
    check(second === first, 'double open created a second paid-case task');
    check(toasts.at(-1) === 'Case opening in progress — please wait'
        && announcements.at(-1) === toasts.at(-1),
    'double open did not provide matching visible and accessible busy copy');

    settle(Object.freeze({
        ok: true,
        kind: 'coins',
        rarity: 'common',
        amount: 25,
        label: '25 coins',
    }));
    const result = await first;
    check(result.ok === true && overlay.caseAnim?.result === result,
        'overlay did not present the durable case receipt');
    check(caseOpenAudio === 1 && revealAudio === 0,
        'overlay success cue timing changed or fired more than once');
    check(overlay._caseOpenTask === null,
        'overlay retained a settled paid-case task');

    const presentationToasts = [];
    const presentationAnnouncements = [];
    const presentationOverlay = new MinigameOverlay({
        ...game,
        saveSystem: {
            ...fakeSave,
            runExclusiveSaveTransaction: () => Promise.resolve(Object.freeze({
                ok: true,
                kind: 'coins',
                rarity: 'common',
                amount: 25,
                label: '25 coins',
            })),
        },
        _setToast: (message) => presentationToasts.push(message),
        accessibility: { announce: (message) => presentationAnnouncements.push(message) },
        audio: {
            ...game.audio,
            caseOpen: () => { throw new Error('injected presentation fault'); },
        },
    });
    const presentationResult = await presentationOverlay.openCaseFlow('basic');
    check(presentationResult.ok === true,
        'post-commit presentation fault relabeled durable success as failure');
    check(presentationOverlay._caseOpenTask === null,
        'post-commit presentation fault retained the pending task');
    check(presentationToasts.at(-1) === 'Case reward saved — presentation unavailable'
        && presentationAnnouncements.at(-1) === presentationToasts.at(-1),
    'post-commit presentation fault did not disclose truthful recovery copy');

    for (const [reason, expected] of [
        ['transaction-busy', 'Another tab is saving — try the case again'],
        ['transaction-lock-unavailable', 'Secure case opening unavailable — no coins charged'],
        ['transaction-lock-failed', 'Case save lock failed — no coins charged'],
    ]) {
        const failureToasts = [];
        const failureAnnouncements = [];
        let failureAudio = 0;
        const failureSave = {
            ...fakeSave,
            runExclusiveSaveTransaction: reason === 'transaction-lock-unavailable'
                ? undefined
                : () => Promise.resolve(Object.freeze({ ok: false, reason })),
        };
        const failureOverlay = new MinigameOverlay({
            ...game,
            saveSystem: failureSave,
            _setToast: (message) => failureToasts.push(message),
            accessibility: { announce: (message) => failureAnnouncements.push(message) },
            audio: {
                ...game.audio,
                caseOpen: () => { failureAudio += 1; },
                reveal: () => { failureAudio += 1; },
            },
        });
        const failure = await failureOverlay.openCaseFlow('basic');
        check(failure.ok === false && failure.reason === reason,
            `${reason}: overlay changed the exclusive failure receipt`);
        check(failureOverlay.caseAnim === null && failureAudio === 0,
            `${reason}: overlay exposed reward UI/audio after failure`);
        check(failureToasts.at(-1) === expected
            && failureAnnouncements.at(-1) === expected,
        `${reason}: overlay copy was not clear in both output channels`);
    }
}

function validatePendingReceiptOwnsMenuNavigation() {
    const toasts = [];
    let starts = 0;
    const pendingTask = Promise.resolve({ ok: true });
    const fixture = {
        audio: { resume() {}, click() {} },
        minigame: { _caseOpenTask: pendingTask },
        blueprintConfirm: { id: 'armed-before-pending-save' },
        menuTour: null,
        resetConfirming: false,
        _setToast: (message) => toasts.push(message),
        _startRun: () => { starts += 1; },
    };
    check(hasPendingSecureMenuSave(fixture) === true,
        'pending paid case is not recognized as a secure menu save');
    check(GameInputActionMethods._menuAction.call(fixture, 'startRun') === false
        && starts === 0 && fixture.blueprintConfirm?.id === 'armed-before-pending-save',
    'pending paid case allowed pointer navigation or mutated menu state');
    check(GameInputActionMethods._menuKeyboardActivate.call(fixture) === 'pending'
        && starts === 0,
    'pending paid case allowed the direct keyboard quick-start route');
    check(toasts.every((message) => message === 'Finishing secure save — please wait'),
        'pending transaction navigation did not disclose one stable wait message');

    for (const pending of [
        { blueprintPurchasePending: {} },
        { battlePassClaimPending: {} },
        { shopPurchasePending: {} },
        { minigame: { _minesStartTask: pendingTask } },
        { minigame: { _minesCashoutTask: pendingTask } },
    ]) {
        check(hasPendingSecureMenuSave(pending) === true,
            `secure pending owner escaped the central menu gate: ${JSON.stringify(Object.keys(pending))}`);
    }
    check(hasPendingSecureMenuSave({ minigame: {} }) === false,
        'idle menu was incorrectly trapped behind the secure-save gate');

    const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
    const startKeyBranch = gameSource.slice(
        gameSource.indexOf("            if (this.screen === 'start') {"),
        gameSource.indexOf('                if (this.minigame.mines) {'),
    );
    check(startKeyBranch.indexOf('if (hasPendingSecureMenuSave(this))') >= 0
        && startKeyBranch.indexOf('if (hasPendingSecureMenuSave(this))')
            < startKeyBranch.indexOf("DEV_MODE && e.code === 'KeyG'"),
    'start-screen key shortcuts can navigate before the pending secure-save gate');
}

try {
    console.warn = () => {};
    await validateSingleTabCommitAndRollback();
    await validateCrossTabToctouAndRetry();
    await validateOverlayWaitsForDurableReceipt();
    validatePendingReceiptOwnsMenuNavigation();
    console.log(`Case exclusive-flow validation passed: ${checks} checks.`);
} finally {
    console.warn = originalWarn;
    restoreGlobal('localStorage', originalStorage);
    restoreGlobal('navigator', originalNavigator);
    restoreGlobal('window', originalWindow);
}
