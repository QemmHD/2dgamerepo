#!/usr/bin/env node
// Proves that Battle Pass and Daily Road free-case entitlements couple their
// one-time marker and complete randomized reward in one retry-safe save.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const SAVE_KEY = 'monkey-survivor:save:v1';
const storage = new Map();
let durableWrites = 0;

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => {
        if (key === SAVE_KEY) durableWrites++;
        storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key),
} });

const { bpThreshold } = await import('../src/content/battlePass.js');
const {
    claim,
    claimAtomic,
    claimAllAtomic,
} = await import('../src/systems/BattlePassSystem.js');
const {
    claimFreeCaseEntitlement,
    claimFreeCaseEntitlementAtomic,
} = await import('../src/systems/EntitlementTransaction.js');
const { SaveSystem } = await import('../src/systems/SaveSystem.js');
const { GameInputActionMethods } = await import('../src/core/GameInputActions.js');

// Minimal origin-wide Web Locks model: shared participants coexist and exact
// non-waiting exclusive requests fail while any participant remains.
class LockManagerHarness {
    constructor() {
        this.holders = new Map();
        this.queues = new Map();
        this.calls = [];
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
        this.calls.push({ name, options: { ...normalized } });
        return new Promise((resolve, reject) => {
            Object.assign(request, { resolve, reject });
            if (normalized.ifAvailable) {
                queueMicrotask(() => {
                    if (this._canGrant(name, normalized.mode)) this._grant(request);
                    else Promise.resolve(callback(null)).then(resolve, reject);
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
            && this._canGrant(name, 'shared')) this._grant(queue.shift());
    }
    _grant(request) {
        const holder = { id: request.id, mode: request.options.mode };
        if (!this.holders.has(request.name)) this.holders.set(request.name, []);
        this.holders.get(request.name).push(holder);
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
        queueMicrotask(() => this._drain(name));
    }
}

function setGlobal(key, value) {
    Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
    });
}

function withRandom(sequence, callback) {
    const realRandom = Math.random;
    let calls = 0;
    Math.random = () => {
        const value = sequence[Math.min(calls, sequence.length - 1)] ?? 0;
        calls++;
        return value;
    };
    try {
        return { result: callback(), calls };
    } finally {
        Math.random = realRandom;
    }
}

async function withRandomAsync(sequence, callback) {
    const realRandom = Math.random;
    let calls = 0;
    Math.random = () => {
        const value = sequence[Math.min(calls, sequence.length - 1)] ?? 0;
        calls++;
        return value;
    };
    try {
        return { result: await callback(), calls };
    } finally {
        Math.random = realRandom;
    }
}

function freshSave(setup) {
    storage.clear();
    durableWrites = 0;
    const save = new SaveSystem();
    setup(save.data);
    check(save.save() === true, 'test fixture could not persist its baseline');
    const durable = storage.get(SAVE_KEY);
    return { save, durable };
}

function failNextSave(save) {
    const durableSave = save.save.bind(save);
    let fail = true;
    let attempts = 0;
    save.save = () => {
        attempts++;
        if (fail) {
            fail = false;
            save._lastSaveFailureReason = 'persistence-failed';
            return false;
        }
        return durableSave();
    };
    return { attempts: () => attempts };
}

// Battle Pass level 12 is the first free randomized case. Its old two-write
// flow could durably grant the case, fail claimLevel, then grant another case
// on retry. The failed whole-save commit now exposes neither half.
{
    const { save, durable } = freshSave((data) => {
        data.battlePass.xp = bpThreshold(12);
    });
    const before = JSON.stringify(save.data);
    const writesBefore = durableWrites;
    const probe = failNextSave(save);
    const failed = withRandom([0, 0, 0], () => claim(save, 12));

    check(failed.result.ok === false && failed.result.reason === 'save-unavailable',
        'failed Battle Pass commit exposed a successful claim');
    check(failed.calls === 3, 'failed Battle Pass case changed runtime RNG order');
    check(probe.attempts() === 1, 'Battle Pass claim attempted more than one live save');
    check(JSON.stringify(save.data) === before,
        'failed Battle Pass claim leaked marker/reward into live memory');
    check(storage.get(SAVE_KEY) === durable && durableWrites === writesBefore,
        'failed Battle Pass claim changed durable state');

    const retry = withRandom([0, 0, 0], () => claim(save, 12));
    check(retry.result.ok === true && retry.result.label.startsWith('Case:'),
        'retry did not grant the level-12 case');
    check(retry.calls === 3 && probe.attempts() === 2,
        'successful Battle Pass retry did not use one case roll and one live save');
    check(save.data.battlePass.claimed.includes(12),
        'successful Battle Pass retry did not persist its claim marker');
    check(save.data.stats.casesOpened === 1,
        'successful Battle Pass retry granted more or fewer than one case');
    check(storage.get(SAVE_KEY) === JSON.stringify(save.data),
        'Battle Pass marker and reward do not share the durable payload');

    const afterRetry = JSON.stringify(save.data);
    const duplicate = withRandom([0, 0, 0], () => claim(save, 12));
    check(duplicate.result.ok === false && duplicate.result.reason === 'claimed',
        'already-claimed Battle Pass case was accepted');
    check(duplicate.calls === 0 && probe.attempts() === 2,
        'already-claimed Battle Pass case consumed RNG or wrote again');
    check(JSON.stringify(save.data) === afterRetry,
        'already-claimed Battle Pass retry changed save memory');
}

// Daily Road uses the same boundary: caseDay cannot survive without the case,
// and the case cannot survive without caseDay.
{
    const day = 24680;
    const { save, durable } = freshSave(() => {});
    const before = JSON.stringify(save.data);
    const writesBefore = durableWrites;
    const probe = failNextSave(save);
    const reserve = (draft) => draft.claimDailyRoadCase(day);
    const failed = withRandom([0, 0, 0], () => (
        claimFreeCaseEntitlement(save, 'basic', reserve)
    ));

    check(failed.result.ok === false, 'failed Daily Road commit exposed a case');
    check(failed.calls === 3 && probe.attempts() === 1,
        'failed Daily Road case changed RNG/live-save cardinality');
    check(JSON.stringify(save.data) === before && save.data.dailyRoad.caseDay === 0,
        'failed Daily Road case burned its once-a-day entitlement');
    check(storage.get(SAVE_KEY) === durable && durableWrites === writesBefore,
        'failed Daily Road case changed durable state');

    const retry = withRandom([0, 0, 0], () => (
        claimFreeCaseEntitlement(save, 'basic', reserve)
    ));
    check(retry.result.ok === true && retry.result.label.length > 0,
        'Daily Road entitlement did not succeed on retry');
    check(retry.calls === 3 && probe.attempts() === 2,
        'successful Daily Road retry did not use one case roll and one live save');
    check(save.data.dailyRoad.caseDay === day && save.data.stats.casesOpened === 1,
        'Daily Road marker and reward did not commit together');
    check(storage.get(SAVE_KEY) === JSON.stringify(save.data),
        'Daily Road marker and reward do not share the durable payload');

    const afterRetry = JSON.stringify(save.data);
    const duplicate = withRandom([0, 0, 0], () => (
        claimFreeCaseEntitlement(save, 'basic', reserve)
    ));
    check(duplicate.result.ok === false && duplicate.result.reason === 'claimed',
        'same-day Daily Road case was granted twice');
    check(duplicate.calls === 0 && probe.attempts() === 2,
        'same-day Daily Road rejection consumed RNG or wrote again');
    check(JSON.stringify(save.data) === afterRetry,
        'same-day Daily Road rejection changed save memory');
}

// A newer tab's payload must win before either entitlement reserves or rolls.
{
    const day = 24681;
    const { save } = freshSave(() => {});
    const before = JSON.stringify(save.data);
    const newer = JSON.parse(storage.get(SAVE_KEY));
    newer.totalCoins = 777;
    storage.set(SAVE_KEY, JSON.stringify(newer));
    let saveAttempts = 0;
    const realSave = save.save.bind(save);
    save.save = () => { saveAttempts++; return realSave(); };
    const stale = withRandom([0, 0, 0], () => claimFreeCaseEntitlement(
        save,
        'basic',
        (draft) => draft.claimDailyRoadCase(day),
    ));
    check(stale.result.ok === false && stale.result.reason === 'save-changed',
        'stale Daily Road entitlement did not fail closed');
    check(stale.calls === 0 && saveAttempts === 0,
        'stale Daily Road entitlement consumed RNG or attempted a write');
    check(JSON.stringify(save.data) === before,
        'stale Daily Road entitlement changed live memory');
    check(storage.get(SAVE_KEY) === JSON.stringify(newer),
        'stale Daily Road entitlement overwrote newer authority');
}

// Menu actions expose and own the exact Promise, suppress rapid duplicates, and
// publish feedback only after the exclusive result settles.
{
    let resolveClaim;
    let exclusiveCalls = 0;
    const operation = new Promise((resolve) => { resolveClaim = resolve; });
    const toasts = [];
    const announcements = [];
    const game = {
        audio: { resume() {}, click() {} },
        saveSystem: {
            runExclusiveSaveTransaction() {
                exclusiveCalls++;
                return operation;
            },
        },
        menuTour: null,
        blueprintConfirm: null,
        resetConfirming: false,
        battlePassClaimPending: null,
        _battlePassClaimSerial: 0,
        _battlePassClaimTask: null,
        _setToast: (message) => toasts.push(message),
        accessibility: { announce: (message) => announcements.push(message) },
    };
    GameInputActionMethods._menuAction.call(game, 'claimBP', 12);
    const task = game._battlePassClaimTask;
    check(game.battlePassClaimPending?.level === 12
        && task && typeof task.then === 'function' && exclusiveCalls === 1,
    'Battle Pass menu did not expose its pending exclusive task');
    GameInputActionMethods._menuAction.call(game, 'claimBP', 12);
    check(exclusiveCalls === 1 && toasts.at(-1) === 'Finishing secure save — please wait',
        'rapid Battle Pass press launched a duplicate transaction');
    resolveClaim({ ok: true, level: 12, label: 'Case: Test Ember' });
    const result = await task;
    check(result.ok === true && game.battlePassClaimPending === null,
        'settled Battle Pass task retained its pending owner');
    check(toasts.at(-1) === 'Claimed: Case: Test Ember'
        && announcements.at(-1) === 'Claimed: Case: Test Ember',
    'Battle Pass success feedback appeared before/without the durable result');

    game.saveSystem.runExclusiveSaveTransaction = () => Promise.resolve({
        ok: false, reason: 'transaction-busy',
    });
    GameInputActionMethods._menuAction.call(game, 'claimAllBP');
    const allTask = game._battlePassClaimTask;
    const blocked = await allTask;
    check(blocked.ok === false && blocked.reason === 'transaction-busy'
        && game.battlePassClaimPending === null,
    'blocked Claim All did not settle fail-closed');
    check(toasts.at(-1).includes('reward remains unclaimed'),
        'blocked Claim All did not provide retry-safe feedback');
}

// Production browser APIs consume SaveSystem's origin-wide exclusive boundary.
// A single participant can claim each composite entitlement in one final write.
{
    delete globalThis.window;
    setGlobal('navigator', {});
    const { durable } = freshSave((data) => {
        data.battlePass.xp = bpThreshold(12);
        data.battlePass.claimed = [];
        data.dailyRoad.caseDay = 0;
    });
    const manager = new LockManagerHarness();
    setGlobal('window', {});
    setGlobal('navigator', { locks: manager });
    const single = new SaveSystem();
    check(await single.whenSaveParticipationReady(),
        'single entitlement participant never became ready');
    check(storage.get(SAVE_KEY) === durable,
        'participant startup changed the entitlement baseline');

    const bpWrites = durableWrites;
    const bp = await withRandomAsync([0, 0, 0], () => claimAtomic(single, 12));
    check(bp.result.ok === true && bp.result.level === 12 && bp.calls === 3,
        'exclusive Battle Pass case claim failed or changed RNG order');
    check(durableWrites === bpWrites + 1
        && single.data.battlePass.claimed.includes(12)
        && single.data.stats.casesOpened === 1,
    'exclusive Battle Pass case did not use one marker+reward write');

    const duplicateWrites = durableWrites;
    const duplicate = await withRandomAsync([0, 0, 0], () => claimAtomic(single, 12));
    check(duplicate.result.ok === false && duplicate.result.reason === 'claimed'
        && duplicate.calls === 0 && durableWrites === duplicateWrites,
    'exclusive Battle Pass replay consumed RNG or wrote');

    const day = 24682;
    const dailyWrites = durableWrites;
    const daily = await withRandomAsync([0, 0, 0], () => (
        claimFreeCaseEntitlementAtomic(
            single,
            'basic',
            (draft) => draft.claimDailyRoadCase(day),
        )
    ));
    check(daily.result.ok === true && daily.calls === 3,
        'exclusive Daily Road case claim failed or changed RNG order');
    check(durableWrites === dailyWrites + 1
        && single.data.dailyRoad.caseDay === day
        && single.data.stats.casesOpened === 2,
    'exclusive Daily Road case did not use one marker+reward write');

    const allWrites = durableWrites;
    const all = await claimAllAtomic(single);
    check(all.ok === true && all.count === 11 && all.labels.length === 11,
        'exclusive Claim All omitted reached unclaimed levels');
    check(durableWrites === allWrites + 1
        && Array.from({ length: 12 }, (_, index) => index + 1)
            .every((level) => single.data.battlePass.claimed.includes(level)),
    'exclusive Claim All did not publish all markers/rewards in one write');
    await single.dispose();
}

// A second live participant blocks both entitlement families before the draft
// callback and RNG. Its ordinary write remains authoritative.
{
    const payload = JSON.parse(storage.get(SAVE_KEY));
    payload.battlePass.xp = bpThreshold(12);
    payload.battlePass.claimed = [];
    payload.dailyRoad.caseDay = 0;
    payload.stats.casesOpened = 0;
    storage.clear();
    storage.set(SAVE_KEY, JSON.stringify(payload));
    durableWrites = 0;

    const manager = new LockManagerHarness();
    setGlobal('window', {});
    setGlobal('navigator', { locks: manager });
    const first = new SaveSystem();
    const second = new SaveSystem();
    check(await first.whenSaveParticipationReady()
        && await second.whenSaveParticipationReady(),
    'two entitlement participants never became ready');
    const firstBefore = JSON.stringify(first.data);
    const writesBefore = durableWrites;
    const realRandom = Math.random;
    let randomCalls = 0;
    Math.random = () => { randomCalls++; return 0; };
    let blocked;
    try {
        const blockedTask = claimAtomic(first, 12);
        check(second.setSetting('volMusic', 0.33) === 0.33,
            'ordinary participant could not write during entitlement contention');
        blocked = await blockedTask;
    } finally {
        Math.random = realRandom;
    }
    check(blocked.ok === false && blocked.reason === 'transaction-busy',
        'second participant did not block Battle Pass entitlement');
    const expectedAuthority = JSON.parse(firstBefore);
    expectedAuthority.settings.volMusic = 0.33;
    const durableAuthority = JSON.parse(storage.get(SAVE_KEY));
    check(randomCalls === 0,
        'blocked Battle Pass entitlement consumed reward RNG');
    check(JSON.stringify(first.data) === JSON.stringify(expectedAuthority)
        && JSON.stringify(durableAuthority) === JSON.stringify(expectedAuthority),
    'reacquired entitlement participant did not refresh to B\'s exact authority');
    check(first.data.battlePass.claimed.length === 0
        && first.data.stats.casesOpened === 0
        && first.data.dailyRoad.caseDay === 0,
    'blocked Battle Pass entitlement changed a marker or randomized reward field');
    check(durableWrites === writesBefore + 1
        && durableAuthority.settings.volMusic === 0.33,
    'blocked Battle Pass entitlement overwrote the ordinary writer');

    const blockedDaily = await withRandomAsync([0, 0, 0], () => (
        claimFreeCaseEntitlementAtomic(
            first,
            'basic',
            (draft) => draft.claimDailyRoadCase(24683),
        )
    ));
    check(blockedDaily.result.ok === false
        && blockedDaily.result.reason === 'transaction-busy'
        && blockedDaily.calls === 0,
    'second participant did not block Daily Road before RNG');
    check(JSON.stringify(first.data) === JSON.stringify(expectedAuthority)
        && JSON.stringify(JSON.parse(storage.get(SAVE_KEY)))
            === JSON.stringify(expectedAuthority)
        && first.data.battlePass.claimed.length === 0
        && first.data.stats.casesOpened === 0
        && first.data.dailyRoad.caseDay === 0,
    'blocked Daily Road entitlement changed refreshed authority, marker, or reward');
    await first.dispose();
    await second.dispose();
}

// Integration seams: production callsites must use the whole-save helper.
const battlePassSource = readFileSync(new URL('../src/systems/BattlePassSystem.js', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('../src/core/GameInputActions.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
check(battlePassSource.includes('export function claimAtomic(save, level)')
    && battlePassSource.includes('export function claimAllAtomic(save)')
    && battlePassSource.includes('commitEntitlementTransactionAtomic(save, (draft) =>'),
'Battle Pass production claims are not wired through the exclusive boundary');
check(inputSource.includes('claimAtomic as claimBattlePassAtomic')
    && inputSource.includes("case 'claimBP': startBattlePassClaim(this, 'single', arg)")
    && inputSource.includes("case 'claimAllBP': startBattlePassClaim(this, 'all')")
    && inputSource.includes('game._battlePassClaimTask = task'),
'Battle Pass menu actions do not own/track the async exclusive tasks');
check(gameSource.includes("import { claimFreeCaseEntitlementAtomic } from '../systems/EntitlementTransaction.js';")
    && gameSource.includes('this._queueDailyRoadCaseEntitlement(day, this.runSummary)')
    && gameSource.includes('this._dailyRoadCaseTask = task'),
'Daily Road is not wired through a tracked exclusive free-case task');

console.log(`case entitlement durability validator passed (${checks} checks)`);
