#!/usr/bin/env node
// Adversarial checks for the case transaction boundary. A case result may be
// shown only after debit + stat + pity + reward have landed in one durable save.

import assert from 'node:assert/strict';
import {
    CASES,
    CASE_PITY,
    casePoolSnapshot,
    openCase,
    openCaseAtomic,
} from '../src/systems/CaseSystem.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
const storage = new Map();
let saveAttempts = 0;
let saveWrites = 0;
let failNextSave = false;
let failNextRead = false;

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) {
        if (key === SAVE_KEY && failNextRead) {
            failNextRead = false;
            throw new Error('injected transaction read failure');
        }
        return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
        if (key === SAVE_KEY) {
            saveAttempts++;
            if (failNextSave) {
                failNextSave = false;
                throw new Error('injected atomic write failure');
            }
            saveWrites++;
        }
        storage.set(key, String(value));
    },
    removeItem(key) {
        storage.delete(key);
    },
} });

const { SaveSystem } = await import('../src/systems/SaveSystem.js');

let checks = 0;
const check = (condition, message) => {
    assert.ok(condition, message);
    checks++;
};

function memorySnapshot(save) {
    return JSON.stringify(save.data);
}

function seedSave(mutator = () => {}) {
    storage.clear();
    saveAttempts = 0;
    saveWrites = 0;
    failNextSave = false;
    failNextRead = false;
    const save = new SaveSystem();
    save.data.totalCoins = 200_000;
    mutator(save.data);
    check(save.save(), 'fixture save did not persist');
    return save;
}

function withRandom(sequence, action) {
    const originalRandom = Math.random;
    let calls = 0;
    Math.random = () => {
        const value = sequence[calls];
        calls++;
        if (value === undefined) throw new Error(`unexpected RNG call ${calls}`);
        return value;
    };
    try {
        const result = action();
        return { result, calls };
    } finally {
        Math.random = originalRandom;
    }
}

function validateSuccessfulAtomicCommit() {
    const save = seedSave();
    const attemptsBefore = saveAttempts;
    const writesBefore = saveWrites;
    const casesBefore = save.data.stats.casesOpened;
    const balanceBefore = save.data.totalCoins;
    const { result, calls } = withRandom([0, 0, 0], () => openCase(save, 'basic'));

    check(result.ok === true && result.kind === 'gear', 'deterministic paid item case failed');
    check(calls === 3, 'ordinary item case changed its RNG call order');
    check(saveAttempts === attemptsBefore + 1, 'successful case did not attempt exactly one save');
    check(saveWrites === writesBefore + 1, 'successful case did not perform exactly one durable write');
    check(save.data.totalCoins === balanceBefore - CASES.basic.cost,
        'successful item case did not debit its exact entry cost');
    check(save.data.stats.casesOpened === casesBefore + 1,
        'successful case did not advance casesOpened exactly once');
    check(save.data.casePity.basic === 1, 'successful common case did not persist pity progress');
    check(save.data.gear.unlocked.includes(result.id), 'successful item reward is not owned in memory');

    const durable = JSON.parse(storage.get(SAVE_KEY));
    check(JSON.stringify(durable) === JSON.stringify(save.data),
        'returned case success did not match the exact durable payload');
    const reloaded = new SaveSystem();
    check(reloaded.data.totalCoins === save.data.totalCoins, 'case debit reversed after reload');
    check(reloaded.data.stats.casesOpened === save.data.stats.casesOpened, 'case stat reversed after reload');
    check(reloaded.data.casePity.basic === save.data.casePity.basic, 'case pity reversed after reload');
    check(reloaded.data.gear.unlocked.includes(result.id), 'case reward reversed after reload');
}

const failureScenarios = [
    {
        name: 'new item', sequence: [0, 0, 0], expectedCalls: 3, expectedKind: 'gear', mutate() {},
    },
    {
        name: 'duplicate dust', sequence: [0, 0, 0], expectedCalls: 3, expectedKind: 'duplicate',
        mutate(data) {
            const commonIds = casePoolSnapshot('gear').entries
                .filter((entry) => entry.rarity === 'common')
                .map((entry) => entry.id);
            data.gear.unlocked = [...new Set([...data.gear.unlocked, ...commonIds])];
        },
    },
    {
        name: 'coin consolation', sequence: [0, 0.99, 0], expectedCalls: 3, expectedKind: 'coins', mutate() {},
    },
    {
        name: 'vigil XP consolation', sequence: [0, 0.99, 0.99], expectedCalls: 3, expectedKind: 'bpxp', mutate() {},
    },
    {
        name: 'forced pity item', sequence: [0, 0, 0], expectedCalls: 3, expectedKind: 'gear',
        mutate(data) {
            data.casePity.basic = CASE_PITY.basic - 1;
        },
    },
];

function validateFailureRollback(scenario) {
    const save = seedSave(scenario.mutate);
    const liveData = save.data;
    const memoryBefore = memorySnapshot(save);
    const durableBefore = storage.get(SAVE_KEY);
    const attemptsBefore = saveAttempts;
    const writesBefore = saveWrites;
    failNextSave = true;

    const originalWarn = console.warn;
    console.warn = () => {};
    let result;
    let calls;
    try {
        ({ result, calls } = withRandom(scenario.sequence, () => openCase(save, 'basic')));
    } finally {
        console.warn = originalWarn;
    }

    check(result.ok === false && result.reason === 'save-unavailable',
        `${scenario.name}: injected write failure did not return a clear failure`);
    check(calls === scenario.expectedCalls, `${scenario.name}: RNG call order changed`);
    check(save.data === liveData, `${scenario.name}: failed transaction did not restore the live data object`);
    check(memorySnapshot(save) === memoryBefore,
        `${scenario.name}: wallet/stat/pity/reward memory changed after failed write`);
    check(storage.get(SAVE_KEY) === durableBefore,
        `${scenario.name}: durable payload changed after failed write`);
    check(saveAttempts === attemptsBefore + 1,
        `${scenario.name}: transaction did not collapse all phases into one save attempt`);
    check(saveWrites === writesBefore,
        `${scenario.name}: failed atomic save was counted as a durable write`);

    const retryAttempts = saveAttempts;
    const retry = withRandom(scenario.sequence, () => openCase(save, 'basic'));
    check(retry.result.ok === true && retry.result.kind === scenario.expectedKind,
        `${scenario.name}: clean retry did not produce its deterministic outcome`);
    check(saveAttempts === retryAttempts + 1,
        `${scenario.name}: clean retry did not use one atomic save`);
    check(JSON.stringify(JSON.parse(storage.get(SAVE_KEY))) === memorySnapshot(save),
        `${scenario.name}: clean retry returned before its full state was durable`);
}

function validateReadAndStaleRejections() {
    const save = seedSave();
    const memoryBefore = memorySnapshot(save);
    const durableBefore = storage.get(SAVE_KEY);
    const attemptsBefore = saveAttempts;
    failNextRead = true;
    const originalWarn = console.warn;
    console.warn = () => {};
    let readFailure;
    try {
        readFailure = withRandom([0], () => openCase(save, 'royal'));
    } finally {
        console.warn = originalWarn;
    }
    check(readFailure.result.ok === false && readFailure.result.reason === 'save-unavailable',
        'transaction read failure did not fail closed');
    check(readFailure.calls === 0, 'transaction read failure consumed RNG');
    check(memorySnapshot(save) === memoryBefore, 'transaction read failure changed memory');
    check(storage.get(SAVE_KEY) === durableBefore, 'transaction read failure changed durable state');
    check(saveAttempts === attemptsBefore, 'transaction read failure attempted a write');

    const saveA = new SaveSystem();
    const saveB = new SaveSystem();
    saveA.data.totalCoins -= 1;
    check(saveA.save(), 'authoritative tab could not advance shared save');
    const authoritativeRaw = storage.get(SAVE_KEY);
    const staleMemory = memorySnapshot(saveB);
    const staleAttempts = saveAttempts;
    const stale = withRandom([0], () => openCase(saveB, 'royal'));
    check(stale.result.ok === false && stale.result.reason === 'save-changed',
        'stale paid case did not return save-changed');
    check(stale.calls === 0, 'stale paid case consumed RNG before rejection');
    check(memorySnapshot(saveB) === staleMemory, 'stale paid case changed memory');
    check(storage.get(SAVE_KEY) === authoritativeRaw, 'stale paid case overwrote newer authority');
    check(saveAttempts === staleAttempts, 'stale paid case attempted a write');
}

function validateFreeCaseStillRequiresDurability() {
    const save = seedSave();
    const liveData = save.data;
    const memoryBefore = memorySnapshot(save);
    const durableBefore = storage.get(SAVE_KEY);
    const attemptsBefore = saveAttempts;
    failNextSave = true;
    const originalWarn = console.warn;
    console.warn = () => {};
    let outcome;
    try {
        outcome = withRandom([0, 0, 0], () => openCase(save, 'basic', { free: true }));
    } finally {
        console.warn = originalWarn;
    }
    check(outcome.result.ok === false && outcome.result.reason === 'save-unavailable',
        'free case exposed a reward after its save failed');
    check(outcome.calls === 3, 'free case changed the case RNG order');
    check(save.data === liveData && memorySnapshot(save) === memoryBefore,
        'failed free case changed wallet/stat/pity/reward memory');
    check(storage.get(SAVE_KEY) === durableBefore, 'failed free case changed durable state');
    check(saveAttempts === attemptsBefore + 1, 'free case did not use one atomic save attempt');
}

async function validateAtomicPathFailsClosedWithoutBrowserLocks() {
    const save = seedSave();
    const memoryBefore = memorySnapshot(save);
    const durableBefore = storage.get(SAVE_KEY);
    const attemptsBefore = saveAttempts;
    const realRandom = Math.random;
    let calls = 0;
    Math.random = () => { calls++; return 0; };
    let result;
    try {
        result = await openCaseAtomic(save, 'royal');
    } finally {
        Math.random = realRandom;
    }
    check(result.ok === false && result.reason === 'transaction-lock-unavailable',
        'browser paid-case path did not fail closed without Web Locks participation');
    check(calls === 0, 'unavailable exclusive boundary consumed case RNG');
    check(memorySnapshot(save) === memoryBefore,
        'unavailable exclusive boundary changed in-memory case state');
    check(storage.get(SAVE_KEY) === durableBefore,
        'unavailable exclusive boundary changed durable case state');
    check(saveAttempts === attemptsBefore,
        'unavailable exclusive boundary attempted a case write');
}

validateSuccessfulAtomicCommit();
for (const scenario of failureScenarios) validateFailureRollback(scenario);
validateReadAndStaleRejections();
validateFreeCaseStillRequiresDurability();
await validateAtomicPathFailsClosedWithoutBrowserLocks();

console.log(`Case transaction durability validation passed: ${checks} checks across ${failureScenarios.length} rollback branches.`);
