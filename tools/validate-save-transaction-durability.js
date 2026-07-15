#!/usr/bin/env node
// Deterministic durability gate for SaveSystem mutators and the browser-wide
// exclusive economy transaction boundary.
// Run from the repository root:
//   node tools/validate-save-transaction-durability.js

import assert from 'node:assert/strict';
import {
    COSMETIC_BLUEPRINT_COST,
    cosmeticCoinCost,
    cosmeticById,
} from '../src/content/cosmetics.js';
import { GEAR_LIST } from '../src/content/gear.js';
import { CHARACTER_IDS } from '../src/content/characters.js';
import { ATTUNABLE, attuneCost } from '../src/content/relics.js';
import {
    SAVE_PARTICIPATION_LOCK_NAME,
    SAVE_TRANSACTION_LOCK_NAME,
    SaveSystem,
} from '../src/systems/SaveSystem.js';

const SAVE_KEY = 'monkey-survivor:save:v1';
const BLUEPRINT_ID = 'aura_gloam_moths';

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks += 1;
}
function same(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    checks += 1;
}
function graphIsFrozen(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return true;
    seen.add(value);
    return Object.isFrozen(value)
        && Object.values(value).every((entry) => graphIsFrozen(entry, seen));
}

class MemoryStorage {
    constructor(raw = undefined) {
        this.values = new Map();
        this.saveWrites = 0;
        this.saveWriteAttempts = 0;
        this.failSaveWrites = false;
        if (raw !== undefined) this.values.set(SAVE_KEY, String(raw));
    }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) {
        if (key === SAVE_KEY) {
            this.saveWriteAttempts += 1;
            if (this.failSaveWrites) throw new Error('simulated durable write failure');
            this.saveWrites += 1;
        }
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}

// Small origin-wide Web Locks model: shared holders coexist; exclusive holders
// conflict by exact lock name; ifAvailable requests never queue.
class LockManagerHarness {
    constructor() {
        this.calls = [];
        this.events = [];
        this.holders = new Map();
        this.queues = new Map();
        this.serial = 0;
    }

    request(name, options, callback) {
        const normalized = {
            mode: options?.mode === 'shared' ? 'shared' : 'exclusive',
            ifAvailable: options?.ifAvailable === true,
        };
        const id = ++this.serial;
        this.calls.push({ id, name, options: { ...normalized } });
        return new Promise((resolve, reject) => {
            const request = { id, name, options: normalized, callback, resolve, reject };
            if (normalized.ifAvailable) {
                queueMicrotask(() => {
                    if (this._canGrant(name, normalized.mode)) this._grant(request);
                    else {
                        this.events.push(`miss:${id}:${name}:${normalized.mode}`);
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
        if (!queue.length) return;
        const first = queue[0];
        if (!this._canGrant(name, first.options.mode)) return;
        if (first.options.mode === 'exclusive') {
            queue.shift();
            this._grant(first);
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
        this.events.push(`enter:${request.id}:${request.name}:${holder.mode}`);
        let output;
        try {
            output = request.callback(Object.freeze({
                name: request.name,
                mode: holder.mode,
            }));
        } catch (error) {
            this._release(request.name, holder);
            request.reject(error);
            return;
        }
        Promise.resolve(output).then((value) => {
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
        this.events.push(`exit:${holder.id}:${name}:${holder.mode}`);
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
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
function clearGlobal(key) { delete globalThis[key]; }
function restoreGlobal(key, descriptor) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
}

function newStorageSave(storage) {
    setGlobal('localStorage', storage);
    return new SaveSystem();
}

function expectRollback(save, storage, label, invoke, acceptsFailure) {
    const dataAlias = save.data;
    const settingsAlias = save.data.settings;
    const cosmeticsAlias = save.data.cosmetics;
    const unlockedAlias = save.data.cosmetics.unlocked;
    const statsAlias = save.data.stats;
    const before = structuredClone(save.data);
    const rawBefore = storage.getItem(SAVE_KEY);
    const writesBefore = storage.saveWrites;
    const attemptsBefore = storage.saveWriteAttempts;
    const result = invoke();
    check(acceptsFailure(result), `${label}: mutator reported success after save failure`);
    check(save.data === dataAlias, `${label}: failed mutator replaced the public data object`);
    check(save.data.settings === settingsAlias,
        `${label}: failed mutator replaced the settings alias`);
    check(save.data.cosmetics === cosmeticsAlias
        && save.data.cosmetics.unlocked === unlockedAlias,
    `${label}: failed mutator replaced cosmetic aliases`);
    check(save.data.stats === statsAlias,
        `${label}: failed mutator replaced the stats alias`);
    same(save.data, before, `${label}: failed mutator did not restore exact memory`);
    check(storage.getItem(SAVE_KEY) === rawBefore,
        `${label}: failed mutator changed durable authority`);
    check(storage.saveWrites === writesBefore && storage.saveWriteAttempts === attemptsBefore,
        `${label}: stale mutator attempted a durable overwrite`);
    check(save.getLastSaveFailureReason() === 'external-save-changed',
        `${label}: stale failure reason was not retained`);
}

try {
    console.warn = () => {};
    clearGlobal('window');
    clearGlobal('navigator');

    // Seed one complete, valid profile with enough owned content to exercise
    // equipment, Boutique, progression, and attunement call paths.
    const storage = new MemoryStorage();
    const seed = newStorageSave(storage);
    const trinket = GEAR_LIST.find((item) => item.category === 'trinket');
    const relic = ATTUNABLE[0];
    seed.data.totalCoins = 300000;
    seed.data.cosmetics.unlocked.push('hat_wool');
    seed.data.gear.unlocked.push(trinket.id);
    seed.data.discoveredRelics.push(relic.id);
    check(seed.save(), 'failed to seed durability profile');

    // One tab advances durable authority. Every mutator on the stale tab must
    // now return an explicit non-success and restore its exact pre-call state.
    const authority = newStorageSave(storage);
    const stale = newStorageSave(storage);
    check(authority.setSetting('screenShake', false) === false,
        'authority fixture did not commit its newer setting');
    const staleRaw = storage.getItem(SAVE_KEY);
    const selected = stale.getSelectedCharacter();
    const otherCharacter = CHARACTER_IDS.find((id) => id !== selected);
    const baseLook = stale.getCosmeticPreset(selected);
    const equippedLook = { ...baseLook, hat: 'hat_wool' };
    const boutiqueId = 'fur_kilncracked';
    const boutiqueLook = { ...baseLook, fur: boutiqueId };
    const boutiqueCost = cosmeticCoinCost(cosmeticById(boutiqueId));

    const rollbackCases = [
        ['addCoins', () => stale.addCoins(25), (value) => value === 0],
        ['spendCoins', () => stale.spendCoins(25), (value) => value === false],
        ['setting', () => stale.setSetting('volMusic', 0.2), (value) => value === undefined],
        ['single cosmetic equip', () => stale.equipCosmetic('hat', 'hat_wool'), (value) => value === false],
        ['full cosmetic equip', () => stale.equipCosmeticLook(equippedLook), (value) => value === false],
        ['Boutique look purchase', () => stale.purchaseCosmeticLook(
            [boutiqueId], boutiqueCost, boutiqueLook,
        ), (value) => value === false],
        ['cosmetic pursuit', () => stale.setCosmeticPursuit('stormglass'), (value) => value === false],
        ['cosmetic unlock', () => stale.unlockCosmetic('cloak_splitwatch'), (value) => value === false],
        ['gear unlock', () => stale.unlockGear(GEAR_LIST.find((item) =>
            !stale.isGearUnlocked(item.id)).id), (value) => value === false],
        ['gear equip', () => stale.equipGear('trinket', trinket.id), (value) => value === false],
        ['character selection', () => stale.setSelectedCharacter(otherCharacter), (value) => value === false],
        ['relic attunement', () => stale.attuneRelic(relic.id), (value) => value === false],
        ['hero attunement', () => stale.attuneHero(selected), (value) => value === false],
        ['rite progress', () => stale.setHeroRites(selected, {}), (value) => value === false],
        ['upgrade increment', () => stale.incrementUpgrade('maxHp'), (value) => value === false],
        ['battle-pass XP', () => stale.addBattlePassXp(100), (value) => value.added === 0],
        ['battle-pass claim', () => stale.claimLevel(1), (value) => value === false],
        ['stat increment', () => stale.incrementStat('runs', 1), (value) => value === false],
        ['difficulty', () => stale.setDifficulty('hard'), (value) => value === false],
        ['achievement claim', () => stale.claimAchievement('durability_probe'), (value) => value === false],
        ['daily claim', () => stale.markDailyComplete(777, 'daily_probe'), (value) => value === false],
        ['pact clear', () => stale.recordPactClear(selected, 1), (value) => value === 0],
        ['gauntlet score', () => stale.recordGauntletScore(123), (value) => value === false],
        ['daily-road score', () => stale.recordDailyRoadScore(777, 100),
            (value) => value.best === false && value.firstToday === false],
        ['daily-road case latch', () => stale.claimDailyRoadCase(777), (value) => value === false],
        ['day streak', () => stale.recordDayStreak(777), (value) => value === 0],
        ['onboarding tab', () => stale.markTabSeen('durability_probe'), (value) => value === false],
        ['tour latch', () => stale.setTourDone(true), (value) => value === false],
        ['gamble quota', () => stale.consumeGamblePlay(), (value) => value === false],
        ['dev unlock batch', () => stale.cheatUnlockAll(), (value) => value === 0],
    ];
    for (const [label, invoke, acceptsFailure] of rollbackCases) {
        expectRollback(stale, storage, label, invoke, acceptsFailure);
    }
    check(storage.getItem(SAVE_KEY) === staleRaw,
        'stale rollback matrix changed the newer durable payload');

    // Relic attunement is now one wallet+level transaction and performs one
    // final write rather than a durable debit followed by a second level write.
    const attuneStorage = new MemoryStorage();
    const attuneSave = newStorageSave(attuneStorage);
    attuneSave.data.discoveredRelics.push(relic.id);
    attuneSave.data.totalCoins = attuneCost(relic, 0) + 500;
    check(attuneSave.save(), 'failed to seed one-write attunement fixture');
    const attuneWrites = attuneStorage.saveWrites;
    const attuneBalance = attuneSave.data.totalCoins;
    check(attuneSave.attuneRelic(relic.id) === true,
        'valid relic attunement failed');
    check(attuneStorage.saveWrites === attuneWrites + 1,
        'relic attunement did not commit wallet+level in exactly one write');
    check(attuneSave.data.totalCoins === attuneBalance - attuneCost(relic, 0)
        && attuneSave.getRelicAttunement(relic.id) === 1,
    'one-write relic attunement committed the wrong state');

    // A genuine write exception also rolls a composite Boutique transaction
    // back and returns false, while preserving the previous durable bytes.
    const failureStorage = new MemoryStorage();
    const failureSave = newStorageSave(failureStorage);
    failureSave.data.totalCoins = 100000;
    check(failureSave.save(), 'failed to seed write-failure fixture');
    const failureLook = {
        ...failureSave.getCosmeticPreset(failureSave.getSelectedCharacter()),
        fur: boutiqueId,
    };
    const failureBefore = structuredClone(failureSave.data);
    const failureDataAlias = failureSave.data;
    const failureCosmeticsAlias = failureSave.data.cosmetics;
    const failureUnlocksAlias = failureSave.data.cosmetics.unlocked;
    const failurePresetsAlias = failureSave.data.cosmetics.presets;
    const failureRaw = failureStorage.getItem(SAVE_KEY);
    failureStorage.failSaveWrites = true;
    check(failureSave.purchaseCosmeticLook([boutiqueId], boutiqueCost, failureLook) === false,
        'Boutique write exception reported success');
    same(failureSave.data, failureBefore,
        'Boutique write exception did not restore wallet/unlock/look exactly');
    check(failureSave.data === failureDataAlias
        && failureSave.data.cosmetics === failureCosmeticsAlias
        && failureSave.data.cosmetics.unlocked === failureUnlocksAlias
        && failureSave.data.cosmetics.presets === failurePresetsAlias,
    'Boutique write exception replaced public or nested aliases');
    check(failureStorage.getItem(SAVE_KEY) === failureRaw
        && failureSave.getLastSaveFailureReason() === 'persistence-failed',
    'Boutique write exception changed durable bytes or lost its failure reason');

    // Browser startup: writes attempted before the shared callback are explicit
    // failures with exact rollback; retrying after readiness succeeds. The
    // interrupted-run repair is deferred until readiness instead of being lost.
    const startupManager = new LockManagerHarness();
    setGlobal('window', {});
    setGlobal('navigator', { locks: startupManager });
    const startupStorage = new MemoryStorage(JSON.stringify({
        totalCoins: 2000,
        guidedObjectives: {
            schema: 1, nextRunId: 2, activeRunSerial: 1, receipts: [],
        },
        version: 10,
    }));
    const startupSave = newStorageSave(startupStorage);
    const startupBefore = structuredClone(startupSave.data);
    const startupDataAlias = startupSave.data;
    // Deterministically land a newer authority after _loadOrDefault but before
    // the fake manager's first shared-lock microtask grants participation.
    startupStorage.setItem(SAVE_KEY, JSON.stringify({
        totalCoins: 87654,
        settings: { volMusic: 0.64 },
        guidedObjectives: {
            schema: 1, nextRunId: 7, activeRunSerial: 6, receipts: [],
        },
        version: 10,
    }));
    check(startupSave.setSetting('volMusic', 0.1) === undefined,
        'pending participant write falsely reported success');
    check(startupSave.data === startupDataAlias,
        'pending participant rollback replaced its original data object');
    same(startupSave.data, startupBefore,
        'pending participant write did not roll back exactly');
    check(await startupSave.whenSaveParticipationReady(),
        'participant share never became ready');
    await Promise.resolve();
    check(startupSave.data.totalCoins === 87654
        && startupSave.data.settings.volMusic === 0.64
        && startupSave.data.guidedObjectives.nextRunId === 7,
    'first shared-lock grant did not refresh the newer durable authority');
    check(startupSave.data.guidedObjectives.activeRunSerial === 0,
        'interrupted-run cleanup was not retried after participant readiness');
    check(JSON.parse(startupStorage.getItem(SAVE_KEY)).guidedObjectives.activeRunSerial === 0,
        'deferred interrupted-run cleanup was not durable');
    check(startupSave._lastPersistedRaw === startupStorage.getItem(SAVE_KEY),
        'first-grant refresh did not bless the exact final durable payload');
    check(startupSave.setSetting('volMusic', 0.1) === 0.1,
        'ready participant rejected a normal setting write');
    check(await startupSave.dispose(), 'participant disposal failed');
    check(startupManager.held(SAVE_PARTICIPATION_LOCK_NAME) === 0,
        'disposed bootstrap instance retained its participant share');
    check(startupSave.setSetting('volMusic', 0.2) === undefined,
        'disposed bootstrap instance remained writable');

    // Single-tab exclusive transaction: shared share is released, the exact
    // participant lock is acquired exclusively, the legacy transaction mutex is
    // nested, one final save commits, and the shared share is reacquired.
    const singleManager = new LockManagerHarness();
    setGlobal('navigator', { locks: singleManager });
    const singleStorage = new MemoryStorage(JSON.stringify({
        totalCoins: 100000, cosmetics: {}, version: 10,
    }));
    const single = newStorageSave(singleStorage);
    check(await single.whenSaveParticipationReady(),
        'single-tab participant share never became ready');
    const singleWrites = singleStorage.saveWrites;
    const atomic = await single.purchaseCosmeticBlueprintAtomic(
        BLUEPRINT_ID, COSMETIC_BLUEPRINT_COST,
    );
    check(atomic.ok === true && atomic.balanceAfter === 28000,
        'single-tab Blueprint transaction did not commit');
    check(singleStorage.saveWrites === singleWrites + 1,
        'exclusive Blueprint transaction did not perform exactly one final write');
    check(singleManager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 1,
        'Blueprint transaction did not reacquire its shared participant lock');
    const participantCalls = singleManager.calls.filter((call) =>
        call.name === SAVE_PARTICIPATION_LOCK_NAME);
    same(participantCalls.map((call) => call.options), [
        { mode: 'shared', ifAvailable: false },
        { mode: 'exclusive', ifAvailable: true },
        { mode: 'shared', ifAvailable: false },
    ], 'Blueprint did not release/exclude/reacquire on the exact participant lock');
    check(singleManager.calls.some((call) => call.name === SAVE_TRANSACTION_LOCK_NAME
        && call.options.mode === 'exclusive' && call.options.ifAvailable),
    'Blueprint did not retain the nested save transaction mutex');

    // Generic callbacks are draft-only and synchronous. Async callbacks and a
    // failed final save cannot leak draft mutations into the live instance.
    const asyncBefore = structuredClone(single.data);
    const asyncDataAlias = single.data;
    const asyncSessionAlias = single._session;
    const asyncSessionBefore = structuredClone(single._session);
    const asyncResult = await single.runExclusiveSaveTransaction(async (draft) => {
        draft.setSetting('unlockMaps', true);
        draft.addCoins(999);
        return { ok: true };
    });
    same(asyncResult, { ok: false, reason: 'transaction-callback-async' },
        'async exclusive callback did not fail closed');
    same(single.data, asyncBefore,
        'async exclusive callback leaked its detached draft');
    check(single.data === asyncDataAlias && single._session === asyncSessionAlias,
        'async exclusive callback replaced live data or session authority');
    same(single._session, asyncSessionBefore,
        'async exclusive callback leaked unlockMaps into the live session');

    const rejectionSessionAlias = single._session;
    const rejectionSessionBefore = structuredClone(single._session);
    const rejectionWrites = singleStorage.saveWrites;
    const rejectionRaw = singleStorage.getItem(SAVE_KEY);
    let retainedRejectedDraft = null;
    const rejectedDraft = await single.runExclusiveSaveTransaction((draft) => {
        retainedRejectedDraft = draft;
        draft.setSetting('unlockMaps', true);
        draft._lastSaveFailureReason = 'forged-draft-reason';
        return {
            ok: false,
            reason: 'caller-canceled',
            nested: { settings: draft.data.settings },
        };
    });
    check(rejectedDraft.ok === false && rejectedDraft.reason === 'caller-canceled',
        'explicit draft rejection changed its stable receipt');
    check(graphIsFrozen(rejectedDraft),
        'nested failure receipt was not recursively frozen');
    check(rejectedDraft.nested.settings !== retainedRejectedDraft.data.settings
        && rejectedDraft.nested.settings !== single.data.settings,
    'nested failure receipt retained a draft or live settings alias');
    check(single._session === rejectionSessionAlias,
        'rejected draft replaced the live session object');
    same(single._session, rejectionSessionBefore,
        'rejected draft leaked unlockMaps into the live session');
    check(single.getLastSaveFailureReason() !== 'forged-draft-reason'
        && singleStorage.saveWrites === rejectionWrites,
    'rejected draft leaked authority fields or performed a final save');
    const rejectedLiveBeforeMutation = structuredClone(single.data);
    retainedRejectedDraft.data.settings.volMusic = 0.01;
    let rejectedReceiptMutationBlocked = false;
    try {
        rejectedDraft.nested.settings.volMusic = 0.02;
    } catch (e) {
        rejectedReceiptMutationBlocked = true;
    }
    check(rejectedReceiptMutationBlocked,
        'nested failure receipt accepted post-settlement mutation');
    same(single.data, rejectedLiveBeforeMutation,
        'retained rejected draft or receipt mutated live state after settlement');
    check(singleStorage.getItem(SAVE_KEY) === rejectionRaw,
        'retained rejected draft or receipt mutated durable state after settlement');

    // Successful callbacks receive the same isolation: the published save and
    // returned nested receipt are separate deep clones, not draft references.
    let retainedSuccessfulDraft = null;
    const retainedSuccess = await single.runExclusiveSaveTransaction((draft) => {
        retainedSuccessfulDraft = draft;
        const credited = draft.addCoins(7);
        return {
            ok: true,
            credited,
            nested: {
                wallet: { balance: draft.data.totalCoins },
                cosmetics: draft.data.cosmetics,
            },
        };
    });
    check(retainedSuccess.ok === true && retainedSuccess.credited === 7,
        'retained-draft success transaction did not commit');
    check(graphIsFrozen(retainedSuccess),
        'nested success receipt was not recursively frozen');
    check(single.data !== retainedSuccessfulDraft.data
        && single.data.cosmetics !== retainedSuccessfulDraft.data.cosmetics
        && retainedSuccess.nested.cosmetics !== single.data.cosmetics
        && retainedSuccess.nested.cosmetics !== retainedSuccessfulDraft.data.cosmetics,
    'successful settlement retained a draft/live/receipt container alias');
    const retainedSuccessLive = structuredClone(single.data);
    const retainedSuccessRaw = singleStorage.getItem(SAVE_KEY);
    retainedSuccessfulDraft.data.totalCoins += 5000;
    retainedSuccessfulDraft.data.cosmetics.unlocked.push('retained_draft_probe');
    let successReceiptMutationBlocked = false;
    try {
        retainedSuccess.nested.wallet.balance += 5000;
    } catch (e) {
        successReceiptMutationBlocked = true;
    }
    check(successReceiptMutationBlocked,
        'nested success receipt accepted post-settlement mutation');
    same(single.data, retainedSuccessLive,
        'retained successful draft or receipt mutated live state after commit');
    check(singleStorage.getItem(SAVE_KEY) === retainedSuccessRaw,
        'retained successful draft or receipt mutated durable state after commit');

    const blockedCloseDataAlias = single.data;
    const blockedCloseSessionAlias = single._session;
    const blockedCloseRaw = singleStorage.getItem(SAVE_KEY);
    const blockedCloseWrites = singleStorage.saveWrites;
    const blockedClose = await single.runExclusiveSaveTransaction((draft) => {
        draft._guidedObjectiveSessionSerial = 1;
        draft.data.guidedObjectives = {
            schema: 1, nextRunId: 2, activeRunSerial: 1, receipts: [],
        };
        const closed = draft.closeGuidedObjectiveRun('go1');
        return { ok: true, closed };
    });
    same(blockedClose, { ok: false, reason: 'transaction-draft-operation-blocked' },
        'direct-storage close was not blocked inside the detached draft');
    check(single.data === blockedCloseDataAlias
        && single._session === blockedCloseSessionAlias,
    'blocked direct-storage close replaced live authority objects');
    check(singleStorage.getItem(SAVE_KEY) === blockedCloseRaw
        && singleStorage.saveWrites === blockedCloseWrites,
    'blocked direct-storage close touched durable storage');

    const exclusiveFailureBefore = structuredClone(single.data);
    const exclusiveFailureDataAlias = single.data;
    const exclusiveFailureSessionAlias = single._session;
    const exclusiveFailureSessionBefore = structuredClone(single._session);
    const exclusiveFailureRaw = singleStorage.getItem(SAVE_KEY);
    singleStorage.failSaveWrites = true;
    const finalWriteFailure = await single.runExclusiveSaveTransaction((draft) => {
        draft.setSetting('unlockMaps', true);
        return { ok: true, credited: draft.addCoins(50) };
    });
    same(finalWriteFailure, { ok: false, reason: 'persistence-failed' },
        'failed exclusive final save reported success');
    same(single.data, exclusiveFailureBefore,
        'failed exclusive final save leaked draft memory');
    check(single.data === exclusiveFailureDataAlias
        && single._session === exclusiveFailureSessionAlias,
    'failed exclusive final save replaced live data or session authority');
    same(single._session, exclusiveFailureSessionBefore,
        'failed exclusive final save leaked unlockMaps into the live session');
    check(singleStorage.getItem(SAVE_KEY) === exclusiveFailureRaw,
        'failed exclusive final save changed durable bytes');
    singleStorage.failSaveWrites = false;

    // A dispose request made from inside an active exclusive callback waits for
    // that transaction and prevents finalization from resurrecting a share.
    let disposeDuringTransaction = null;
    const disposeCallCount = singleManager.calls.length;
    const disposeTransaction = await single.runExclusiveSaveTransaction((draft) => {
        disposeDuringTransaction = single.dispose();
        return { ok: true, credited: draft.addCoins(1) };
    });
    check(disposeTransaction.ok === true && disposeTransaction.credited === 1,
        'dispose-during-transaction changed the in-flight commit receipt');
    check(await disposeDuringTransaction,
        'dispose requested during an exclusive transaction did not resolve');
    check(single._saveParticipationState === 'disposed'
        && singleManager.held(SAVE_PARTICIPATION_LOCK_NAME) === 0,
    'exclusive finalization resurrected a disposed participant share');
    check(singleManager.calls.slice(disposeCallCount).filter((call) =>
        call.name === SAVE_PARTICIPATION_LOCK_NAME
        && call.options.mode === 'shared').length === 0,
    'dispose-during-transaction queued a replacement shared lock');

    // A second participant conservatively blocks Blueprint before the nested
    // transaction callback. The ordinary writer can commit, and that payload is
    // never overwritten by the failed Blueprint attempt.
    const twoManager = new LockManagerHarness();
    setGlobal('navigator', { locks: twoManager });
    const twoStorage = new MemoryStorage(JSON.stringify({
        totalCoins: 200000, cosmetics: {}, version: 10,
    }));
    const first = newStorageSave(twoStorage);
    const second = newStorageSave(twoStorage);
    check(await first.whenSaveParticipationReady()
        && await second.whenSaveParticipationReady(),
    'two-tab participant shares did not become ready');
    check(twoManager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 2,
        'two live tabs did not hold two shared participant locks');
    const firstBefore = structuredClone(first.data);
    const blockedTask = first.purchaseCosmeticBlueprintAtomic(
        BLUEPRINT_ID, COSMETIC_BLUEPRINT_COST,
    );
    check(second.setSetting('volMusic', 0.33) === 0.33,
        'ordinary participating writer could not commit during Blueprint contention');
    const ordinaryRaw = twoStorage.getItem(SAVE_KEY);
    const blocked = await blockedTask;
    same(blocked, { ok: false, reason: 'transaction-busy' },
        'second participant did not conservatively block Blueprint');
    check(first.data.totalCoins === firstBefore.totalCoins
        && first.data.settings.volMusic === 0.33
        && first._lastPersistedRaw === ordinaryRaw,
    'blocked Blueprint did not refresh authority when reacquiring its share');
    check(twoStorage.getItem(SAVE_KEY) === ordinaryRaw
        && JSON.parse(ordinaryRaw).settings.volMusic === 0.33,
    'blocked Blueprint overwrote the ordinary participating writer');
    check(twoManager.calls.some((call) => call.name === SAVE_PARTICIPATION_LOCK_NAME
        && call.options.mode === 'exclusive' && call.options.ifAvailable),
    'contended Blueprint did not request the exact participant lock exclusively');
    const nestedAfterContention = twoManager.calls.filter((call) =>
        call.name === SAVE_TRANSACTION_LOCK_NAME).length;
    check(nestedAfterContention === 0,
        'contended participant lock still entered the nested save transaction');
    check(twoManager.held(SAVE_PARTICIPATION_LOCK_NAME, 'shared') === 2,
        'contended Blueprint did not restore both shared participants');
    await first.dispose();
    await second.dispose();

    console.log(`Save transaction durability validation passed: ${checks} checks.`);
} finally {
    console.warn = originalWarn;
    restoreGlobal('localStorage', originalStorage);
    restoreGlobal('navigator', originalNavigator);
    restoreGlobal('window', originalWindow);
}
