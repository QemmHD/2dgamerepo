// Save-only coverage composed by validate-runtime-lifetime.js, not a separate CI
// gate. Every storage backend and lock manager here is owned by this test.
import { SaveSystem, SAVE_PARTICIPATION_LOCK_NAME, SAVE_TRANSACTION_LOCK_NAME } from '../src/systems/SaveSystem.js';
import { commitEntitlementTransaction } from '../src/systems/EntitlementTransaction.js';
import { openCase } from '../src/systems/CaseSystem.js';

const SAVE_KEY = 'monkey-survivor:save:v1';

class MemoryStorage {
    constructor(raw = null) {
        this.values = new Map(raw === null ? [] : [[SAVE_KEY, raw]]);
        this.reads = 0;
        this.writes = 0;
        this.failProbe = false;
        this.failRead = false;
        this.failWrite = false;
    }
    getItem(key) {
        this.reads += 1;
        if (this.failRead) throw new Error('test read blocked');
        return this.values.get(key) ?? null;
    }
    setItem(key, value) {
        if ((key !== SAVE_KEY && this.failProbe) || (key === SAVE_KEY && this.failWrite)) {
            throw new Error('test write blocked');
        }
        if (key === SAVE_KEY) this.writes += 1;
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
    raw() { return this.values.get(SAVE_KEY) ?? null; }
}

// Same-name shared/exclusive ownership, with a controllable shared-grant delay
// for startup and finally/reacquisition races. No real browser lock is touched.
class TestLocks {
    constructor() {
        this.calls = [];
        this.pending = [];
        this.holders = [];
        this.sharedRequests = 0;
        this.pauseSharedAfter = Infinity;
    }
    request(name, options, callback) {
        const call = { name, options: { ...options } };
        this.calls.push(call);
        const ordinal = options.mode === 'shared' ? ++this.sharedRequests : 0;
        return new Promise((resolve, reject) => {
            this.pending.push({ ...call, callback, resolve, reject, ordinal });
            queueMicrotask(() => this.drain());
        });
    }
    canGrant(request) {
        return this.holders.every((held) => held.name !== request.name
            || (held.options.mode === 'shared' && request.options.mode === 'shared'));
    }
    drain() {
        for (const request of [...this.pending]) {
            if (request.ordinal > this.pauseSharedAfter) continue;
            const grant = this.canGrant(request);
            if (!grant && !request.options.ifAvailable) continue;
            this.pending.splice(this.pending.indexOf(request), 1);
            if (grant) this.holders.push(request);
            let value;
            try {
                value = request.callback(grant
                    ? Object.freeze({ name: request.name, mode: request.options.mode }) : null);
            } catch (error) {
                this.finish(request, error);
                continue;
            }
            Promise.resolve(value).then(
                (result) => this.finish(request, null, result),
                (error) => this.finish(request, error),
            );
        }
    }
    finish(request, error, value) {
        const index = this.holders.indexOf(request);
        if (index !== -1) this.holders.splice(index, 1);
        if (error) request.reject(error);
        else request.resolve(value);
        queueMicrotask(() => this.drain());
    }
}

async function reach(predicate) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (predicate()) return true;
        await Promise.resolve();
    }
    return predicate();
}

export async function validateSaveLifetime(check) {
    const originals = new Map(['window', 'navigator', 'localStorage'].map((name) =>
        [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const originalWarn = console.warn;
    const ownedSaves = [];
    const ownedLocks = [];
    const stats = {
        assertions: 0,
        liveStorageGetterReads: 0,
        liveNavigatorGetterReads: 0,
        liveLockRequests: 0,
        isolatedStorageGetterReads: 0,
        isolatedNavigatorGetterReads: 0,
        isolatedLocksGetterReads: 0,
        isolatedLockRequests: 0,
        pendingCleanupWaitedForGrant: false,
    };
    const verify = (value, message) => {
        stats.assertions += 1;
        check(value, `SaveSystem lifetime: ${message}`);
    };
    const setGlobal = (name, value) => Object.defineProperty(globalThis, name,
        { configurable: true, writable: true, value });
    const setGetter = (name, get) => Object.defineProperty(globalThis, name,
        { configurable: true, get });
    const makeSave = (options) => {
        const save = options === undefined ? new SaveSystem() : new SaveSystem(options);
        ownedSaves.push(save);
        return save;
    };
    const makeLocks = () => {
        const locks = new TestLocks();
        ownedLocks.push(locks);
        return locks;
    };
    try {
        console.warn = () => {};
        setGlobal('window', {});

        // No-argument construction continues to use the legacy globals lazily,
        // including a fresh authority read at shared-grant time.
        let liveStorage = new MemoryStorage();
        const liveLocks = makeLocks();
        setGetter('localStorage', () => {
            stats.liveStorageGetterReads += 1;
            return liveStorage;
        });
        setGetter('navigator', () => {
            stats.liveNavigatorGetterReads += 1;
            return { locks: liveLocks };
        });
        const live = makeSave();
        verify(live._saveParticipationRequired && live._saveParticipationState === 'pending',
            'no-argument construction uses the supplied host shared lock');
        verify(JSON.stringify(liveLocks.calls[0]) === JSON.stringify({
            name: SAVE_PARTICIPATION_LOCK_NAME, options: { mode: 'shared' },
        }), 'shared request options and participant name remain exact');
        verify(await live.whenSaveParticipationReady(), 'default participant becomes ready');
        verify(live.setSetting('volMusic', 0.4) === 0.4,
            'default setting mutation reaches the host backend');
        const firstStorage = liveStorage;
        liveStorage = new MemoryStorage(firstStorage.raw());
        const firstWrites = firstStorage.writes;
        verify(live.addCoins(3) === 3 && liveStorage.writes === 1
            && firstStorage.writes === firstWrites,
        'omitted storage is resolved lazily rather than cached or replaced');
        const beforeExclusive = liveStorage.writes;
        const result = await live.runExclusiveSaveTransaction((draft) =>
            ({ ok: true, credited: draft.addCoins(5) }));
        verify(result.ok && result.credited === 5 && liveStorage.writes === beforeExclusive + 1,
            'default exclusive transaction makes exactly one final durable write');
        verify(JSON.stringify(liveLocks.calls.map((call) => call.name)) === JSON.stringify([
            SAVE_PARTICIPATION_LOCK_NAME, SAVE_PARTICIPATION_LOCK_NAME,
            SAVE_TRANSACTION_LOCK_NAME, SAVE_PARTICIPATION_LOCK_NAME,
        ]), 'exclusive transaction retains release, participant barrier, mutex, reacquisition');
        verify(liveLocks.calls.slice(1, 3).every((call) =>
            call.options.mode === 'exclusive' && call.options.ifAvailable === true),
        'both exclusive requests remain non-waiting');
        stats.liveLockRequests = liveLocks.calls.length;
        const liveDispose = live.dispose();
        verify(liveDispose === live.dispose() && await liveDispose,
            'concurrent disposal shares one successful completion');
        verify(liveLocks.holders.length === 0 && liveLocks.pending.length === 0,
            'default disposal releases its last shared participant');

        // Throwing host getters prove isolation does not merely avoid writes.
        setGetter('localStorage', () => {
            stats.isolatedStorageGetterReads += 1;
            throw new Error('isolated touched host storage getter');
        });
        setGetter('navigator', () => {
            stats.isolatedNavigatorGetterReads += 1;
            throw new Error('isolated touched host navigator getter');
        });
        const isolatedStorage = new MemoryStorage();
        const isolated = makeSave({
            storage: isolatedStorage,
            participation: 'isolated',
            get locks() {
                stats.isolatedLocksGetterReads += 1;
                throw new Error('isolated evaluated injected locks getter');
            },
        });
        verify(isolated.available && !isolated._saveParticipationRequired
            && isolated._saveParticipationState === 'unsupported',
        'isolated run keeps the immutable PR1 unsupported authority metadata');
        verify(await isolated.whenSaveParticipationReady(),
            'unsupported isolated local writes are immediately ready');
        verify(isolated.setSetting('volMusic', 0.3) === 0.3 && isolatedStorage.writes === 1,
            'isolated settings persist only in the explicitly owned backend');
        const nested = commitEntitlementTransaction(isolated, (draft) =>
            openCase(draft, 'basic', { free: true }));
        verify(nested.ok && isolatedStorage.writes === 2,
            'inherited entitlement/case drafts preserve injected CAS authority and one commit');
        const objectiveRun = isolated.beginGuidedObjectiveRun();
        verify(typeof objectiveRun === 'string' && isolated.closeGuidedObjectiveRun(objectiveRun),
            'guided run direct-merge storage path stays isolated');
        const isolatedRaw = isolatedStorage.raw();
        let atomicCalls = 0;
        const atomic = await isolated.runExclusiveSaveTransaction(() => {
            atomicCalls += 1;
            return { ok: true };
        });
        const blueprint = await isolated.purchaseCosmeticBlueprintAtomic('aura_gloam_moths', 72000);
        verify(atomic.reason === 'transaction-lock-unavailable'
            && blueprint.reason === 'transaction-lock-unavailable'
            && atomicCalls === 0 && isolatedStorage.raw() === isolatedRaw,
        'isolated cross-tab atomics fail closed without invoking reward callbacks');
        const forbiddenLocks = { request() {
            stats.isolatedLockRequests += 1;
            throw new Error('isolated requested a production lock');
        } };
        const ignoredLocks = makeSave({ storage: new MemoryStorage(),
            locks: forbiddenLocks, participation: 'isolated' });
        verify((await ignoredLocks.purchaseCosmeticBlueprintAtomic('unused', 0)).ok === false,
            'isolated mode ignores even an explicitly supplied lock manager');
        for (const options of [{ participation: 'isolated' },
            { participation: 'isolated', storage: undefined }]) {
            let threw = false;
            try { new SaveSystem(options); } catch (error) { threw = error instanceof TypeError; }
            verify(threw, 'missing or undefined isolated backend rejects before host resolution');
        }
        const disposeWrites = isolatedStorage.writes;
        const disposeRaw = isolatedStorage.raw();
        const isolateDispose = isolated.dispose();
        verify(isolateDispose === isolated.dispose() && await isolateDispose,
            'unsupported disposal is also idempotent');
        verify(isolated._saveParticipationState === 'disposed'
            && !(await isolated.whenSaveParticipationReady())
            && isolated.setSetting('volMusic', 0.9) === undefined && !isolated.save()
            && isolatedStorage.raw() === disposeRaw && isolatedStorage.writes === disposeWrites,
        'disposed unsupported save neither writes nor silently resumes');

        for (const malformed of ['{broken', 'null', '[]', '17']) {
            const backend = new MemoryStorage(malformed);
            const save = makeSave({ storage: backend, participation: 'isolated' });
            verify(save.available && save.data.totalCoins === 2000
                && save.data.version === 10 && backend.raw() === malformed,
            'malformed payload validates to defaults without a repair write');
        }
        for (const failure of ['failProbe', 'failRead', 'failWrite']) {
            const backend = new MemoryStorage();
            backend[failure] = true;
            const save = makeSave({ storage: backend, participation: 'isolated' });
            const alias = save.data;
            verify(save.setSetting('volMusic', 0.2) === undefined
                && save.data === alias && backend.raw() === null,
            `${failure} fails closed with exact live-object rollback`);
        }
        const nullBackend = makeSave({ storage: null, participation: 'isolated' });
        verify(!nullBackend.available && !nullBackend.save(),
            'explicit null is unavailable and never falls back to host storage');
        setGlobal('navigator', {
            get locks() {
                stats.isolatedLocksGetterReads += 1;
                throw new Error('isolated evaluated host navigator.locks getter');
            },
        });
        const hostLocksTrap = makeSave({ storage: new MemoryStorage(), participation: 'isolated' });
        verify((await hostLocksTrap.runExclusiveSaveTransaction(() => ({ ok: true }))).ok === false
            && stats.isolatedLocksGetterReads === 0,
        'isolated construction and atomics also avoid the nested host locks getter');

        // Explicit auto dependencies also follow exclusive drafts (which do not
        // inherit the live instance), including their nested case preflights.
        const draftStorage = new MemoryStorage();
        const draftLocks = makeLocks();
        const draftOwner = makeSave({ storage: draftStorage, locks: draftLocks });
        verify(await draftOwner.whenSaveParticipationReady(), 'explicit auto manager is ready');
        const draftResult = await draftOwner.runExclusiveSaveTransaction((draft) =>
            commitEntitlementTransaction(draft, (nestedDraft) =>
                openCase(nestedDraft, 'basic', { free: true })));
        verify(draftResult.ok && draftStorage.writes === 1,
            'exclusive and inherited nested drafts use private injected authority');
        await draftOwner.dispose();
        verify(stats.isolatedStorageGetterReads === 0 && stats.isolatedNavigatorGetterReads === 0
            && stats.isolatedLocksGetterReads === 0 && stats.isolatedLockRequests === 0,
        'all isolated and explicitly injected operations made zero forbidden host accesses');

        // Disposing a pending constructor settles readiness now, but honestly
        // joins the original host request. A late grant cannot retire the run.
        const startupStorage = new MemoryStorage(JSON.stringify({ version: 10,
            totalCoins: 2000, guidedObjectives: {
                schema: 1, nextRunId: 2, activeRunSerial: 1, receipts: [],
            } }));
        const startupLocks = makeLocks();
        startupLocks.pauseSharedAfter = 0;
        const startup = makeSave({ storage: startupStorage, locks: startupLocks });
        const startupRaw = startupStorage.raw();
        const startupReads = startupStorage.reads;
        const readyBeforeDispose = startup.whenSaveParticipationReady();
        let cleanupFinished = false;
        const startupDispose = startup.dispose();
        startupDispose.then(() => { cleanupFinished = true; });
        verify(startupDispose === startup.dispose() && !(await readyBeforeDispose),
            'pending construction disposal settles outstanding readiness false');
        verify(!cleanupFinished && startupStorage.raw() === startupRaw,
            'pending disposal does not claim host request cleanup or repair the profile');
        stats.pendingCleanupWaitedForGrant = !cleanupFinished;
        startupLocks.pauseSharedAfter = Infinity;
        startupLocks.drain();
        verify(await startupDispose, 'pending cleanup finishes after the host request settles');
        verify(startup._saveParticipationState === 'disposed'
            && startupLocks.holders.length === 0 && startupLocks.pending.length === 0
            && startupStorage.reads === startupReads && startupStorage.writes === 0
            && startupStorage.raw() === startupRaw,
        'late startup grant performs no authority refresh, deferred repair, or held share');

        const acceptedStorage = new MemoryStorage();
        const acceptedLocks = makeLocks();
        const accepted = makeSave({ storage: acceptedStorage, locks: acceptedLocks });
        await accepted.whenSaveParticipationReady();
        let acceptedDispose;
        const acceptedResult = await accepted.runExclusiveSaveTransaction((draft) => {
            acceptedDispose = accepted.dispose();
            return { ok: true, credited: draft.addCoins(7) };
        });
        verify(acceptedResult.ok && acceptedResult.credited === 7 && await acceptedDispose
            && acceptedStorage.writes === 1 && accepted.data.totalCoins === 2007,
        'disposal preserves one already accepted transaction commit');
        verify(accepted._saveParticipationState === 'disposed'
            && acceptedLocks.sharedRequests === 1 && acceptedLocks.holders.length === 0,
        'accepted transaction disposal never queues a replacement shared lock');

        const reacquireStorage = new MemoryStorage();
        const reacquireLocks = makeLocks();
        reacquireLocks.pauseSharedAfter = 1;
        const reacquire = makeSave({ storage: reacquireStorage, locks: reacquireLocks });
        await reacquire.whenSaveParticipationReady();
        const reacquiringTransaction = reacquire.runExclusiveSaveTransaction((draft) =>
            ({ ok: true, credited: draft.addCoins(11) }));
        verify(await reach(() => reacquireLocks.sharedRequests === 2
            && reacquire._saveParticipationState === 'pending'),
        'fixture reaches real transaction-finally shared reacquisition');
        const reacquireReads = reacquireStorage.reads;
        const reacquireRaw = reacquireStorage.raw();
        const reacquireDispose = reacquire.dispose();
        reacquireLocks.pauseSharedAfter = Infinity;
        reacquireLocks.drain();
        const reacquireResult = await reacquiringTransaction;
        verify(await reacquireDispose && reacquireResult.ok && reacquireResult.credited === 11,
            'reacquisition disposal joins the existing transaction and request');
        verify(reacquire._saveParticipationState === 'disposed'
            && reacquireLocks.holders.length === 0 && reacquireLocks.pending.length === 0
            && reacquireStorage.reads === reacquireReads
            && reacquireStorage.raw() === reacquireRaw && reacquireStorage.writes === 1,
        'finally-phase late grant cannot resurrect the share or refresh settled authority');
        return stats;
    } finally {
        // Drain only this test's fake managers before joining the owned saves.
        // The production browser manager is never enumerated or modified.
        for (const locks of ownedLocks) {
            locks.pauseSharedAfter = Infinity;
            locks.drain();
        }
        await Promise.allSettled(ownedSaves.map((save) => save.dispose()));
        console.warn = originalWarn;
        for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
}
