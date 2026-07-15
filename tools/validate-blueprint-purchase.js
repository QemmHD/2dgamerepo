#!/usr/bin/env node
// Deterministic, browser-free gate for Mythic Blueprint save atomicity.
// Run from the repository root:
//   node tools/validate-blueprint-purchase.js

import assert from 'node:assert/strict';
import {
    COSMETIC_BLUEPRINT_COST,
    COSMETIC_BLUEPRINT_IDS,
    COSMETIC_LIST,
    COSMETIC_SETS,
    cosmeticBlueprintCost,
    cosmeticById,
} from '../src/content/cosmetics.js';
import {
    ALL_PASS_COSMETIC_MILESTONES,
    BP_SCHEMA,
} from '../src/content/battlePass.js';
import {
    MAX_COIN_BALANCE,
    SAVE_TRANSACTION_LOCK_NAME,
    SaveSystem,
} from '../src/systems/SaveSystem.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
const FIRST_BLUEPRINT = 'aura_gloam_moths';
const SECOND_BLUEPRINT = 'aura_requiem';

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks += 1;
}
function same(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    checks += 1;
}

class MemoryStorage {
    constructor(raw, options = {}) {
        this.values = new Map();
        this.saveWrites = 0;
        this.saveWriteAttempts = 0;
        this.failSaveWrites = options.failSaveWrites === true;
        this.failProbeWrites = options.failProbeWrites === true;
        if (raw !== undefined) this.values.set(SAVE_KEY, String(raw));
    }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) {
        if (key === SAVE_KEY) {
            this.saveWriteAttempts += 1;
            if (this.failSaveWrites) throw new Error('simulated SAVE_KEY write failure');
        } else if (this.failProbeWrites) {
            throw new Error('simulated storage probe failure');
        }
        this.values.set(key, String(value));
        if (key === SAVE_KEY) this.saveWrites += 1;
    }
    removeItem(key) { this.values.delete(key); }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWarn = console.warn;

function setStorage(storage) {
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: storage,
    });
}

function restoreStorage() {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
}

function setNavigator(value) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value,
    });
}

function restoreNavigator() {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
}

function createSave(rawObject = undefined, options = {}) {
    const storage = options.storage || new MemoryStorage(rawObject === undefined
        ? undefined
        : JSON.stringify(rawObject), options);
    setStorage(storage);
    return { save: new SaveSystem(), storage };
}

function expectFailure(save, storage, id, quote, reason, label) {
    const before = structuredClone(save.data);
    const writesBefore = storage.saveWrites;
    const receipt = save.purchaseCosmeticBlueprint(id, quote);
    same(receipt, { ok: false, reason }, `${label}: failure receipt drifted`);
    check(Object.isFrozen(receipt), `${label}: failure receipt is mutable`);
    same(save.data, before, `${label}: rejection mutated the save`);
    check(storage.saveWrites === writesBefore, `${label}: rejection wrote the save`);
}

async function expectAtomicFailure(save, storage, id, quote, reason, label) {
    const before = structuredClone(save.data);
    const rawBefore = storage.getItem(SAVE_KEY);
    const writesBefore = storage.saveWrites;
    const attemptsBefore = storage.saveWriteAttempts;
    const receipt = await save.purchaseCosmeticBlueprintAtomic(id, quote);
    same(receipt, { ok: false, reason }, `${label}: failure receipt drifted`);
    check(Object.isFrozen(receipt), `${label}: failure receipt is mutable`);
    same(save.data, before, `${label}: rejection mutated the save`);
    check(storage.getItem(SAVE_KEY) === rawBefore,
        `${label}: rejection changed durable save data`);
    check(storage.saveWrites === writesBefore,
        `${label}: rejection completed a save write`);
    check(storage.saveWriteAttempts === attemptsBefore,
        `${label}: rejection attempted a save write`);
}

class SerializedLockManager {
    constructor() {
        this.calls = [];
        this.events = [];
        this.active = 0;
        this.maxActive = 0;
        this.tail = Promise.resolve();
    }

    request(name, options, callback) {
        const call = this.calls.length + 1;
        this.calls.push({ name, options: { ...options } });
        const run = this.tail.then(async () => {
            this.active += 1;
            this.maxActive = Math.max(this.maxActive, this.active);
            this.events.push(`enter:${call}`);
            try {
                // A microtask boundary makes both requests pending together while
                // keeping their critical sections strictly one-at-a-time.
                await Promise.resolve();
                return callback(Object.freeze({ name, mode: options.mode }));
            } finally {
                this.events.push(`exit:${call}`);
                this.active -= 1;
            }
        });
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}

try {
    console.warn = () => {};

    // The save gate consumes one exact content contract: two catalog-authored
    // earned-coin Blueprints, each fixed at 72,000 coins.
    check(COSMETIC_BLUEPRINT_COST === 72000,
        'Blueprint price is not the exact 72,000 earned-coin contract');
    same(COSMETIC_BLUEPRINT_IDS, [FIRST_BLUEPRINT, SECOND_BLUEPRINT],
        'Blueprint allowlist/order drifted');
    check(Object.isFrozen(COSMETIC_BLUEPRINT_IDS), 'Blueprint allowlist is mutable');
    for (const id of COSMETIC_BLUEPRINT_IDS) {
        const item = cosmeticById(id);
        check(item?.rarity === 'mythic', `${id} is not a Mythic cosmetic`);
        check(cosmeticBlueprintCost(id) === COSMETIC_BLUEPRINT_COST,
            `${id} does not resolve the exact Blueprint quote`);
        check(item.caseExcluded !== true,
            `${id} was removed from its alternate random-case route`);
    }
    check(cosmeticBlueprintCost('fur_natural') === 0
        && cosmeticBlueprintCost('__unknown__') === 0
        && cosmeticBlueprintCost(null) === 0,
    'non-Blueprint catalog lookup did not fail closed');

    // Additive persistence: fresh and old saves receive an empty receipt list;
    // the campaign schema remains version 10.
    let pair = createSave();
    check(pair.save.data.version === 10, 'fresh save schema changed from version 10');
    same(pair.save.data.cosmetics.blueprintClaims, [],
        'fresh save did not start with an empty Blueprint receipt list');
    check(pair.storage.saveWrites === 0,
        'fresh Blueprint default caused an unsolicited storage write');

    pair = createSave({ totalCoins: 9876, version: 10, cosmetics: {} });
    check(pair.save.data.totalCoins === 9876 && pair.save.data.version === 10,
        'old-save migration lost progression or changed schema');
    same(pair.save.data.cosmetics.blueprintClaims, [],
        'old save fabricated a Blueprint receipt');
    check(pair.storage.saveWrites === 0,
        'old-save Blueprint normalization caused an unsolicited write');

    // Claims are allowlisted, deduplicated in first-seen order, and retained
    // only when matching ownership is real. Case ownership never backfills one.
    pair = createSave({
        totalCoins: 500000,
        version: 10,
        cosmetics: {
            unlocked: [SECOND_BLUEPRINT, FIRST_BLUEPRINT, '__legacy_unknown__'],
            blueprintClaims: [
                SECOND_BLUEPRINT,
                SECOND_BLUEPRINT,
                'fur_natural',
                '__unknown__',
                FIRST_BLUEPRINT,
                null,
            ],
        },
    });
    same(pair.save.data.cosmetics.blueprintClaims, [SECOND_BLUEPRINT, FIRST_BLUEPRINT],
        'owned Blueprint receipts were not allowlisted/deduplicated stably');
    check(pair.save.data.cosmetics.unlocked.includes('__legacy_unknown__'),
        'receipt repair unexpectedly erased unrelated legacy ownership data');

    pair = createSave({
        version: 10,
        cosmetics: {
            unlocked: [FIRST_BLUEPRINT],
            blueprintClaims: [SECOND_BLUEPRINT, SECOND_BLUEPRINT],
        },
    });
    check(pair.save.data.cosmetics.unlocked.includes(FIRST_BLUEPRINT),
        'case-owned Blueprint was lost during normalization');
    same(pair.save.data.cosmetics.blueprintClaims, [],
        'case ownership or unowned tampering fabricated a purchase receipt');

    // Claimed Battle Pass levels are the durable authority for all ten authored
    // cosmetic milestones, including the legacy 5/15/.../45 rewards.
    const passLevels = Object.keys(ALL_PASS_COSMETIC_MILESTONES).map(Number);
    same(passLevels, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
        'all-ten Battle Pass cosmetic milestone map drifted');
    pair = createSave({
        version: 10,
        battlePass: { schema: BP_SCHEMA, xp: 0, claimed: passLevels },
        cosmetics: { unlocked: [] },
    });
    for (const [levelText, id] of Object.entries(ALL_PASS_COSMETIC_MILESTONES)) {
        check(pair.save.data.cosmetics.unlocked.includes(id),
            `claimed Battle Pass level ${levelText} did not restore ${id}`);
    }
    same(pair.save.data.cosmetics.blueprintClaims, [],
        'Battle Pass restoration fabricated Blueprint receipts');
    check(pair.save.data.version === 10,
        'all-ten Battle Pass restoration changed the campaign schema');

    // Every malformed or unauthorized request fails before touching state.
    pair = createSave();
    pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST * 2;
    for (const [value, label] of [
        [null, 'null id'],
        [undefined, 'undefined id'],
        ['', 'empty id'],
        [123, 'numeric id'],
        [{}, 'object id'],
    ]) {
        expectFailure(pair.save, pair.storage, value, COSMETIC_BLUEPRINT_COST,
            'invalid-id', label);
    }
    expectFailure(pair.save, pair.storage, '__missing_cosmetic__', COSMETIC_BLUEPRINT_COST,
        'unknown-cosmetic', 'unknown cosmetic');
    expectFailure(pair.save, pair.storage, 'aura_inferno', COSMETIC_BLUEPRINT_COST,
        'not-blueprint', 'non-Blueprint Mythic');
    expectFailure(pair.save, pair.storage, 'fur_natural', COSMETIC_BLUEPRINT_COST,
        'not-blueprint', 'starter cosmetic');

    for (const [value, label] of [
        [undefined, 'undefined quote'],
        [null, 'null quote'],
        [NaN, 'NaN quote'],
        [Infinity, 'Infinity quote'],
        [-Infinity, 'negative Infinity quote'],
        [-1, 'negative quote'],
        [0, 'zero quote'],
        [COSMETIC_BLUEPRINT_COST + 0.5, 'fractional quote'],
        [MAX_COIN_BALANCE + 1, 'unsafe integer quote'],
        [String(COSMETIC_BLUEPRINT_COST), 'string quote'],
    ]) {
        expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, value,
            'invalid-quote', label);
    }
    for (const value of [COSMETIC_BLUEPRINT_COST - 1, COSMETIC_BLUEPRINT_COST + 1, MAX_COIN_BALANCE]) {
        expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, value,
            'quote-mismatch', `mismatched quote ${value}`);
    }

    pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST - 1;
    expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST,
        'insufficient-coins', 'insufficient balance');
    for (const [value, label] of [
        [NaN, 'NaN balance'],
        [-1, 'negative balance'],
        [1.5, 'fractional balance'],
        [MAX_COIN_BALANCE + 1, 'unsafe balance'],
        ['72000', 'string balance'],
    ]) {
        pair.save.data.totalCoins = value;
        expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST,
            'invalid-balance', label);
    }

    pair = createSave();
    pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST;
    pair.save.data.cosmetics.unlocked.push(FIRST_BLUEPRINT);
    pair.save.data.cosmetics.blueprintClaims.push(FIRST_BLUEPRINT);
    expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST,
        'already-owned', 'owned purchase replay');

    pair = createSave();
    pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST;
    pair.save.data.cosmetics.blueprintClaims.push(FIRST_BLUEPRINT);
    expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST,
        'replay', 'claim-only impossible replay');

    for (const [field, value, label] of [
        ['unlocked', null, 'missing unlock ledger'],
        ['blueprintClaims', 'forged', 'malformed claim ledger'],
    ]) {
        pair = createSave();
        pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST;
        pair.save.data.cosmetics[field] = value;
        expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST,
            'invalid-state', label);
    }

    // Successful commit: exactly one debit, unlock, claim, and storage write.
    // Unknown legacy IDs do not inflate the authored collection receipt count.
    pair = createSave();
    pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST + 123;
    pair.save.data.cosmetics.unlocked.push(
        'fur_shadow',
        'cloak_mothwing',
        '__legacy_unknown__',
    );
    const beforeSuccess = structuredClone(pair.save.data);
    const authoredBefore = new Set(beforeSuccess.cosmetics.unlocked
        .filter((id) => cosmeticById(id))).size;
    const writesBeforeSuccess = pair.storage.saveWrites;
    const success = pair.save.purchaseCosmeticBlueprint(
        FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    same(success, {
        ok: true,
        id: FIRST_BLUEPRINT,
        name: cosmeticById(FIRST_BLUEPRINT).name,
        cost: COSMETIC_BLUEPRINT_COST,
        balanceBefore: COSMETIC_BLUEPRINT_COST + 123,
        balanceAfter: 123,
        collectionBefore: authoredBefore,
        collectionAfter: authoredBefore + 1,
        setId: 'duskmoth',
        setBefore: 2,
        setAfter: 3,
    }, 'successful Blueprint receipt drifted');
    check(Object.isFrozen(success), 'successful Blueprint receipt is mutable');
    check(pair.storage.saveWrites === writesBeforeSuccess + 1,
        'successful Blueprint purchase did not write exactly once');

    const expectedSuccess = structuredClone(beforeSuccess);
    expectedSuccess.totalCoins = 123;
    expectedSuccess.cosmetics.unlocked.push(FIRST_BLUEPRINT);
    expectedSuccess.cosmetics.blueprintClaims.push(FIRST_BLUEPRINT);
    same(pair.save.data, expectedSuccess,
        'successful Blueprint purchase mutated fields outside debit/unlock/claim');
    check(pair.save.data.cosmetics.unlocked.filter((id) => id === FIRST_BLUEPRINT).length === 1,
        'successful Blueprint purchase unlocked more than one copy');
    check(pair.save.data.cosmetics.blueprintClaims.filter((id) => id === FIRST_BLUEPRINT).length === 1,
        'successful Blueprint purchase appended more than one receipt');

    const persisted = new SaveSystem();
    same(persisted.data.cosmetics.blueprintClaims, [FIRST_BLUEPRINT],
        'Blueprint receipt did not survive reload');
    const persistedBeforeReplay = structuredClone(persisted.data);
    const persistedWrites = pair.storage.saveWrites;
    const replay = persisted.purchaseCosmeticBlueprint(FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST);
    same(replay, { ok: false, reason: 'already-owned' },
        'persisted purchase replay did not fail as already owned');
    same(persisted.data, persistedBeforeReplay,
        'persisted purchase replay mutated the save');
    check(pair.storage.saveWrites === persistedWrites,
        'persisted purchase replay wrote the save');

    // A usable localStorage probe is not proof that the durable transaction
    // write will succeed. A failed SAVE_KEY write must report failure, restore
    // the exact in-memory snapshot, and leave durable state untouched.
    pair = createSave({
        totalCoins: 100000,
        version: 10,
        cosmetics: {},
    }, { failSaveWrites: true });
    check(pair.save.available === true,
        'SAVE_KEY failure fixture incorrectly failed the availability probe');
    const failedWriteDataBefore = structuredClone(pair.save.data);
    const failedWriteRawBefore = pair.storage.getItem(SAVE_KEY);
    const failedWriteCountBefore = pair.storage.saveWrites;
    const failedWriteAttemptsBefore = pair.storage.saveWriteAttempts;
    const failedWrite = pair.save.purchaseCosmeticBlueprint(
        FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    same(failedWrite, { ok: false, reason: 'persistence-failed' },
        'failed durable Blueprint write reported the wrong receipt');
    check(Object.isFrozen(failedWrite),
        'failed durable Blueprint write returned a mutable receipt');
    same(pair.save.data, failedWriteDataBefore,
        'failed durable Blueprint write did not exactly roll back memory');
    check(pair.storage.getItem(SAVE_KEY) === failedWriteRawBefore,
        'failed durable Blueprint write changed persisted raw data');
    check(pair.storage.saveWrites === failedWriteCountBefore,
        'failed durable Blueprint write incremented the successful-write count');
    check(pair.storage.saveWriteAttempts === failedWriteAttemptsBefore + 1,
        'failed durable Blueprint transaction did not attempt exactly one write');

    // Two tabs may start from the same durable payload. Once the first commits,
    // neither an ordinary stale save path nor a Blueprint transaction from the
    // second instance may overwrite that newer durable authority.
    pair = createSave({
        totalCoins: 200000,
        version: 10,
        cosmetics: {},
    });
    const firstInstance = pair.save;
    const secondInstance = createSave(undefined, { storage: pair.storage }).save;
    const firstCommit = firstInstance.purchaseCosmeticBlueprint(
        FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    check(firstCommit.ok === true && firstCommit.balanceAfter === 128000,
        'first shared-storage Blueprint transaction did not commit 200000 to 128000');
    const firstDurableRaw = pair.storage.getItem(SAVE_KEY);
    const beforeStaleAddWrites = pair.storage.saveWrites;
    const beforeStaleAddAttempts = pair.storage.saveWriteAttempts;
    const staleCredit = secondInstance.addCoins(1);
    check(staleCredit === 0 && secondInstance.data.totalCoins === 200000,
        'stale addCoins did not report zero credit and exactly roll back memory');
    check(pair.storage.getItem(SAVE_KEY) === firstDurableRaw,
        'stale addCoins overwrote the first Blueprint transaction payload');
    check(pair.storage.saveWrites === beforeStaleAddWrites
        && pair.storage.saveWriteAttempts === beforeStaleAddAttempts,
    'stale addCoins attempted or completed a SAVE_KEY overwrite');
    check(secondInstance._lastSaveFailureReason === 'external-save-changed',
        'stale addCoins did not retain the external-save-changed failure reason');
    const staleDataBefore = structuredClone(secondInstance.data);
    const staleRawBefore = pair.storage.getItem(SAVE_KEY);
    const staleWritesBefore = pair.storage.saveWrites;
    const staleAttemptBefore = pair.storage.saveWriteAttempts;
    const staleCommit = secondInstance.purchaseCosmeticBlueprint(
        SECOND_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    same(staleCommit, { ok: false, reason: 'external-save-changed' },
        'stale second SaveSystem did not reject the changed durable authority');
    check(Object.isFrozen(staleCommit),
        'stale-instance rejection returned a mutable receipt');
    same(secondInstance.data, staleDataBefore,
        'stale second SaveSystem mutated memory during rejection');
    check(pair.storage.getItem(SAVE_KEY) === staleRawBefore,
        'stale second SaveSystem changed the first transaction payload');
    check(pair.storage.saveWrites === staleWritesBefore
        && pair.storage.saveWriteAttempts === staleAttemptBefore,
    'stale second SaveSystem attempted or completed a write');
    const sharedReload = new SaveSystem();
    check(sharedReload.data.totalCoins === 128000,
        'shared-storage reload lost the first transaction balance');
    same(sharedReload.data.cosmetics.blueprintClaims, [FIRST_BLUEPRINT],
        'shared-storage reload lost or fabricated Blueprint claims');
    check(sharedReload.data.cosmetics.unlocked.includes(FIRST_BLUEPRINT)
        && !sharedReload.data.cosmetics.unlocked.includes(SECOND_BLUEPRINT),
    'shared-storage reload did not preserve first-only ownership');

    // closeGuidedObjectiveRun writes a merge directly to localStorage. That
    // instance-owned write must refresh the transaction tracker so it is not
    // mistaken for an external tab change on the next Blueprint purchase.
    pair = createSave({
        totalCoins: 100000,
        version: 10,
        cosmetics: {},
    });
    const runId = pair.save.beginGuidedObjectiveRun();
    check(typeof runId === 'string' && runId.startsWith('go'),
        'guided-objective tracker fixture did not reserve a run');
    check(pair.save.closeGuidedObjectiveRun(runId) === true,
        'guided-objective tracker fixture did not close its own run');
    const afterGuidedCloseWrites = pair.storage.saveWrites;
    const afterGuidedClose = pair.save.purchaseCosmeticBlueprint(
        SECOND_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    check(afterGuidedClose.ok === true && afterGuidedClose.balanceAfter === 28000,
        'own guided-objective close was misclassified as an external save change');
    check(pair.storage.saveWrites === afterGuidedCloseWrites + 1,
        'post-guided-close Blueprint did not persist exactly once');
    const afterGuidedReload = new SaveSystem();
    check(afterGuidedReload.data.totalCoins === 28000
        && afterGuidedReload.data.cosmetics.blueprintClaims.includes(SECOND_BLUEPRINT),
    'post-guided-close Blueprint did not survive reload');

    // Fully unavailable persistence rejects before any debit or ownership
    // mutation, even when the in-memory balance could otherwise afford it.
    pair = createSave(undefined, { failProbeWrites: true });
    check(pair.save.available === false,
        'unavailable-persistence fixture unexpectedly passed the probe');
    pair.save.data.totalCoins = 100000;
    expectFailure(pair.save, pair.storage, FIRST_BLUEPRINT, COSMETIC_BLUEPRINT_COST,
        'persistence-unavailable', 'unavailable persistence');

    // The browser-facing entrypoint must take the one exact same-origin save
    // lock before it delegates to the synchronous durable transaction.
    check(SAVE_TRANSACTION_LOCK_NAME === 'emberwake:save:v1:exclusive',
        'Blueprint transaction lock name drifted');
    const successfulLockManager = {
        calls: [],
        request(name, options, callback) {
            this.calls.push({ name, options: { ...options } });
            return Promise.resolve(callback(Object.freeze({ name, mode: options.mode })));
        },
    };
    setNavigator({ locks: successfulLockManager });
    pair = createSave({
        totalCoins: 100000,
        version: 10,
        cosmetics: {},
    });
    const atomicWritesBefore = pair.storage.saveWrites;
    const atomicSuccess = await pair.save.purchaseCosmeticBlueprintAtomic(
        FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    check(atomicSuccess.ok === true
        && atomicSuccess.id === FIRST_BLUEPRINT
        && atomicSuccess.cost === COSMETIC_BLUEPRINT_COST
        && atomicSuccess.balanceBefore === 100000
        && atomicSuccess.balanceAfter === 28000,
    'locked Blueprint transaction did not return the successful purchase receipt');
    check(Object.isFrozen(atomicSuccess),
        'locked Blueprint transaction returned a mutable success receipt');
    same(successfulLockManager.calls, [{
        name: 'emberwake:save:v1:exclusive',
        options: { mode: 'exclusive', ifAvailable: true },
    }], 'atomic Blueprint purchase did not request the exact exclusive non-waiting lock');
    check(pair.storage.saveWrites === atomicWritesBefore + 1,
        'successful locked Blueprint transaction did not write exactly once');
    check(pair.save.data.totalCoins === 28000
        && pair.save.data.cosmetics.unlocked.includes(FIRST_BLUEPRINT)
        && pair.save.data.cosmetics.blueprintClaims.includes(FIRST_BLUEPRINT),
    'successful locked Blueprint transaction did not commit debit/unlock/claim');

    // A valid manager that reports contention must fail closed without ever
    // entering the save transaction callback.
    let contendedCallbackCalls = 0;
    const contendedLockManager = {
        calls: [],
        request(name, options, callback) {
            this.calls.push({ name, options: { ...options } });
            contendedCallbackCalls += 1;
            return Promise.resolve(callback(null));
        },
    };
    setNavigator({ locks: contendedLockManager });
    pair = createSave({
        totalCoins: 100000,
        version: 10,
        cosmetics: {},
    });
    await expectAtomicFailure(pair.save, pair.storage, SECOND_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST, 'transaction-busy', 'contended transaction lock');
    check(contendedCallbackCalls === 1,
        'contended transaction lock did not resolve through one null-lock callback');
    same(contendedLockManager.calls, [{
        name: 'emberwake:save:v1:exclusive',
        options: { mode: 'exclusive', ifAvailable: true },
    }], 'contended Blueprint request changed the lock contract');

    // Browsers without a usable LockManager do not fall back to an unsafe
    // check-then-write transaction.
    setNavigator({});
    pair = createSave({
        totalCoins: 100000,
        version: 10,
        cosmetics: {},
    });
    await expectAtomicFailure(pair.save, pair.storage, FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST, 'transaction-lock-unavailable',
        'missing transaction lock manager');

    setNavigator({ locks: { request: null } });
    pair = createSave({
        totalCoins: 100000,
        version: 10,
        cosmetics: {},
    });
    await expectAtomicFailure(pair.save, pair.storage, FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST, 'transaction-lock-unavailable',
        'non-callable transaction lock manager');

    // Synchronous throws, rejected requests, and malformed manager results all
    // normalize to one immutable failure and remain write/mutation free.
    const brokenManagers = [
        [{ request() { throw new Error('simulated synchronous lock failure'); } },
            'throwing transaction lock manager'],
        [{ request() { return Promise.reject(new Error('simulated rejected lock')); } },
            'rejected transaction lock request'],
        [{ request() { return undefined; } }, 'undefined transaction lock result'],
        [{ request() { return Promise.resolve(null); } }, 'null transaction lock result'],
        [{ request() { return Promise.resolve('not-a-receipt'); } },
            'primitive transaction lock result'],
        [{ request() { return Promise.resolve(Object.freeze({})); } },
            'empty-object transaction lock result'],
        [{ request() { return Promise.resolve(Object.freeze([])); } },
            'array transaction lock result'],
    ];
    for (const [manager, label] of brokenManagers) {
        setNavigator({ locks: manager });
        pair = createSave({
            totalCoins: 100000,
            version: 10,
            cosmetics: {},
        });
        await expectAtomicFailure(pair.save, pair.storage, SECOND_BLUEPRINT,
            COSMETIC_BLUEPRINT_COST, 'transaction-lock-failed', label);
    }

    // Two callers start from the same durable payload before either callback
    // executes. The fake manager serializes both critical sections; the first
    // commits and the second observes the changed durable authority.
    pair = createSave({
        totalCoins: 200000,
        version: 10,
        cosmetics: {},
    });
    const firstAtomicInstance = pair.save;
    const secondAtomicInstance = createSave(undefined, { storage: pair.storage }).save;
    const secondAtomicBefore = structuredClone(secondAtomicInstance.data);
    const serializedManager = new SerializedLockManager();
    setNavigator({ locks: serializedManager });
    const serializedWritesBefore = pair.storage.saveWrites;
    const serializedAttemptsBefore = pair.storage.saveWriteAttempts;
    const firstAtomicPromise = firstAtomicInstance.purchaseCosmeticBlueprintAtomic(
        FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    const secondAtomicPromise = secondAtomicInstance.purchaseCosmeticBlueprintAtomic(
        SECOND_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    const [firstAtomicResult, secondAtomicResult] = await Promise.all([
        firstAtomicPromise,
        secondAtomicPromise,
    ]);
    check(firstAtomicResult.ok === true
        && firstAtomicResult.id === FIRST_BLUEPRINT
        && firstAtomicResult.balanceBefore === 200000
        && firstAtomicResult.balanceAfter === 128000,
    'first serialized atomic Blueprint transaction did not commit exactly once');
    same(secondAtomicResult, { ok: false, reason: 'external-save-changed' },
        'second serialized atomic Blueprint transaction did not reject stale authority');
    check(Object.isFrozen(firstAtomicResult) && Object.isFrozen(secondAtomicResult),
        'serialized atomic transaction returned a mutable receipt');
    same(secondAtomicInstance.data, secondAtomicBefore,
        'losing serialized atomic transaction mutated its in-memory save');
    check(pair.storage.saveWrites === serializedWritesBefore + 1
        && pair.storage.saveWriteAttempts === serializedAttemptsBefore + 1,
    'serialized atomic calls attempted or completed more than one save write');
    check(serializedManager.maxActive === 1,
        'fake lock manager allowed overlapping Blueprint critical sections');
    same(serializedManager.events, ['enter:1', 'exit:1', 'enter:2', 'exit:2'],
        'fake lock manager did not serialize both Blueprint callbacks deterministically');
    same(serializedManager.calls, [
        {
            name: 'emberwake:save:v1:exclusive',
            options: { mode: 'exclusive', ifAvailable: true },
        },
        {
            name: 'emberwake:save:v1:exclusive',
            options: { mode: 'exclusive', ifAvailable: true },
        },
    ], 'simultaneous Blueprint calls changed the exact lock request contract');
    const serializedReload = new SaveSystem();
    check(serializedReload.data.totalCoins === 128000,
        'serialized atomic reload did not preserve one exact 72,000-coin debit');
    same(serializedReload.data.cosmetics.blueprintClaims, [FIRST_BLUEPRINT],
        'serialized atomic reload did not preserve exactly one Blueprint claim');
    check(serializedReload.data.cosmetics.unlocked.includes(FIRST_BLUEPRINT)
        && !serializedReload.data.cosmetics.unlocked.includes(SECOND_BLUEPRINT),
    'serialized atomic reload did not preserve exactly one Blueprint unlock');

    // Exact-cost purchase may land on zero. An in-memory Infinity dev balance
    // is bounded to MAX_SAFE_INTEGER before committing, never serialized as null.
    pair = createSave();
    pair.save.data.totalCoins = COSMETIC_BLUEPRINT_COST;
    const exact = pair.save.purchaseCosmeticBlueprint(SECOND_BLUEPRINT, COSMETIC_BLUEPRINT_COST);
    check(exact.ok === true && exact.balanceBefore === COSMETIC_BLUEPRINT_COST
        && exact.balanceAfter === 0 && pair.save.data.totalCoins === 0,
    'exact-cost Blueprint purchase did not land safely on zero');
    check(exact.setId === 'gravebell' && exact.setAfter === exact.setBefore + 1,
        'second Blueprint receipt lost its authored set progress');

    pair = createSave();
    pair.save.data.totalCoins = MAX_COIN_BALANCE;
    const maxSafe = pair.save.purchaseCosmeticBlueprint(
        FIRST_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    check(maxSafe.ok === true
        && maxSafe.balanceBefore === MAX_COIN_BALANCE
        && maxSafe.balanceAfter === MAX_COIN_BALANCE - COSMETIC_BLUEPRINT_COST
        && pair.save.data.totalCoins === MAX_COIN_BALANCE - COSMETIC_BLUEPRINT_COST,
    'MAX_SAFE_INTEGER balance did not debit exactly without overflow');

    pair = createSave();
    pair.save.data.totalCoins = Infinity;
    const infiniteDev = pair.save.purchaseCosmeticBlueprint(
        SECOND_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    check(infiniteDev.ok === true
        && infiniteDev.balanceBefore === MAX_COIN_BALANCE
        && infiniteDev.balanceAfter === MAX_COIN_BALANCE - COSMETIC_BLUEPRINT_COST
        && pair.save.data.totalCoins === MAX_COIN_BALANCE - COSMETIC_BLUEPRINT_COST,
    'Infinity dev balance was not bounded safely before Blueprint debit');
    check(JSON.parse(pair.storage.getItem(SAVE_KEY)).totalCoins
        === MAX_COIN_BALANCE - COSMETIC_BLUEPRINT_COST,
    'bounded Infinity purchase did not persist a finite safe balance');

    // Other unlock paths may grant ownership, but only the purchase method can
    // mint Blueprint receipts.
    pair = createSave();
    check(pair.save.unlockCosmetic(FIRST_BLUEPRINT) === true,
        'ordinary cosmetic unlock could not grant case-style ownership');
    same(pair.save.data.cosmetics.blueprintClaims, [],
        'ordinary cosmetic unlock fabricated a Blueprint receipt');
    check(pair.save.unlockCosmeticSilent(SECOND_BLUEPRINT) === true,
        'silent/cheat cosmetic unlock could not grant ownership');
    same(pair.save.data.cosmetics.blueprintClaims, [],
        'silent/cheat cosmetic unlock fabricated a Blueprint receipt');
    const afterOtherUnlocks = structuredClone(pair.save.data);
    const otherWrites = pair.storage.saveWrites;
    const alreadyOwned = pair.save.purchaseCosmeticBlueprint(
        SECOND_BLUEPRINT,
        COSMETIC_BLUEPRINT_COST,
    );
    same(alreadyOwned, { ok: false, reason: 'already-owned' },
        'non-purchase Blueprint ownership was not authoritative');
    same(pair.save.data, afterOtherUnlocks,
        'already-owned case/cheat Blueprint mutated during purchase rejection');
    check(pair.storage.saveWrites === otherWrites,
        'already-owned case/cheat Blueprint rejection wrote the save');

    // Every Blueprint belongs to exactly one authored set, keeping receipt
    // set-progress semantics deterministic.
    for (const id of COSMETIC_BLUEPRINT_IDS) {
        const containingSets = COSMETIC_SETS.filter((set) =>
            Object.values(set.pieces).includes(id));
        check(containingSets.length === 1,
            `${id} does not belong to exactly one authored cosmetic set`);
    }
    check(COSMETIC_LIST.length === 103,
        'Blueprint persistence unexpectedly changed catalog cardinality');

    console.log(`Blueprint purchase validation passed (${checks} assertions).`);
} finally {
    console.warn = originalWarn;
    restoreNavigator();
    restoreStorage();
}
