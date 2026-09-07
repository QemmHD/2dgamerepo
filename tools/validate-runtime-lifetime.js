#!/usr/bin/env node
// One permanent platform/lifetime gate. Helpers own isolated test environments;
// no test clocks, RNG, storage or platform switches enter production boot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installNodeEnvironment } from './artshot/migration-node-environment.mjs';
import { createMemoryStorage } from './artshot/migration-storage.mjs';
import { validateSaveLifetime } from './runtime-lifetime-save.mjs';
import { validateInputLifetime } from './runtime-lifetime-input.mjs';
import { validateAudioLifetime } from './runtime-lifetime-audio.mjs';

let assertions = 0;
const check = (condition, label) => { assertions++; assert.ok(condition, label); };
const summaries = {};
const unhandled = [];
const rejection = (error) => unhandled.push(error);
process.on('unhandledRejection', rejection);

function instrumentTargets(targets) {
    const active = [];
    let additions = 0, removals = 0, failAt = Infinity;
    const restore = [];
    for (const target of targets) {
        const add = target.addEventListener, remove = target.removeEventListener;
        target.addEventListener = function(type, callback, options) {
            additions++;
            if (additions === failAt) throw new Error('Game listener installation probe');
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            add.call(this, type, callback, options);
            if (!active.some((entry) => entry.target === this && entry.type === type
                && entry.callback === callback && entry.capture === capture)) {
                active.push({ target: this, type, callback, capture });
            }
        };
        target.removeEventListener = function(type, callback, options) {
            removals++;
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            const index = active.findIndex((entry) => entry.target === this && entry.type === type
                && entry.callback === callback && entry.capture === capture);
            if (index >= 0) active.splice(index, 1);
            return remove.call(this, type, callback, options);
        };
        restore.push(() => { target.addEventListener = add; target.removeEventListener = remove; });
    }
    return {
        active,
        failAfter(count) { failAt = additions + count; },
        stopFailing() { failAt = Infinity; },
        stats: () => ({ additions, removals, activeListeners: active.length }),
        restore: () => restore.reverse().forEach((fn) => fn()),
    };
}

async function validatePendingCallbacks(check) {
    const env = installNodeEnvironment();
    const resources = [];
    const restorers = [];
    const pending = [];
    const own = (value) => { resources.push(value); return value; };
    const replace = (object, key, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        Object.defineProperty(object, key, { configurable: true, writable: true, value });
        restorers.push(() => descriptor ? Object.defineProperty(object, key, descriptor) : delete object[key]);
    };
    const defer = () => {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const result = { promise, resolve, reject };
        pending.push(result);
        return result;
    };
    try {
        const [{ Game }, { SaveSystem }, { AudioSystem }, { Input }, { KeyboardInput },
            { getCardCompositor }] = await Promise.all([
            import('../src/core/Game.js'), import('../src/systems/SaveSystem.js'),
            import('../src/systems/AudioSystem.js'), import('../src/core/Input.js'),
            import('../src/core/KeyboardInput.js'), import('../src/systems/CardCompositor.js'),
        ]);
        const createGame = () => {
            const storage = createMemoryStorage();
            const saveSystem = own(new SaveSystem({ storage, participation: 'isolated' }));
            const audio = own(new AudioSystem({ contextFactory: null }));
            const keyboard = own(new KeyboardInput());
            const input = own(new Input({ keyboard }));
            const game = own(new Game({ renderer: env.renderer, input, loop: { fps: 60 },
                services: { saveSystem, audio } }));
            return { game, saveSystem, storage, audio };
        };

        // Exercise the actual confirmation route, then reject its borrowed save
        // operation after disposal. A success-path guard alone misses catch().
        const blueprint = createGame();
        const purchase = defer();
        let purchaseCalls = 0, rewardAudio = 0;
        blueprint.saveSystem.purchaseCosmeticBlueprintAtomic = () => { purchaseCalls++; return purchase.promise; };
        blueprint.audio.deny = blueprint.audio.cosmeticReward = () => { rewardAudio++; };
        blueprint.game.menuTab = 'character';
        blueprint.game._blueprintClockNow = () => 1000;
        blueprint.game._menuAction('openCollectionBlueprint', 'aura_requiem');
        blueprint.game._menuAction('purchaseCollectionBlueprint', 'aura_requiem');
        blueprint.game._menuAction('purchaseCollectionBlueprint', 'aura_requiem');
        check(purchaseCalls === 1 && blueprint.game._blueprintPurchaseTask instanceof Promise,
            'pending Blueprint probe reaches one real confirmed purchase action');
        const task = blueprint.game._blueprintPurchaseTask;
        const pendingPurchase = blueprint.game.blueprintPurchasePending;
        await blueprint.game.dispose();
        blueprint.game.menuFocusNeedsRefresh = false;
        const blueprintSave = JSON.stringify(blueprint.saveSystem.data);
        const blueprintWrites = blueprint.storage.writes;
        purchase.reject(new Error('Delayed Blueprint rejection'));
        await task;
        check(blueprint.game.blueprintPurchasePending === pendingPurchase
            && blueprint.game.blueprintReceipt === null && !blueprint.game.menuFocusNeedsRefresh,
        'late Blueprint rejection cannot publish receipt, clear pending UI or refresh focus');
        check(rewardAudio === 0 && blueprint.storage.writes === blueprintWrites
            && JSON.stringify(blueprint.saveSystem.data) === blueprintSave,
        'late Blueprint rejection has no audio, reward or persistence effects');

        // Keep the real _snapPhoto method and its promise handlers. Only the
        // external share/compositor boundary is controlled; never send a file.
        const compositor = getCardCompositor();
        replace(compositor, 'captureFromCanvas', () => {});
        replace(compositor, 'compose', () => env.renderer.canvas);
        for (const outcome of ['resolve', 'reject']) {
            const photo = createGame();
            const share = defer();
            let shareCalls = 0;
            replace(compositor, 'share', () => { shareCalls++; return share.promise; });
            photo.game.photoMode = { filterIdx: 0, toolbarFade: 0 };
            photo.game.render = () => {};
            const toast = { text: 'existing share toast', timer: 1 };
            photo.game.shareToast = toast;
            photo.game._snapPhoto();
            check(shareCalls === 1 && photo.saveSystem.data.stats.photosTaken === 1,
                `pending photo ${outcome}: real snap starts one share and records the requested photo`);
            await photo.game.dispose();
            const before = JSON.stringify(photo.saveSystem.data);
            const writes = photo.storage.writes;
            if (outcome === 'resolve') share.resolve({ ok: true, method: 'clipboard' });
            else share.reject(new Error('Delayed photo share rejection'));
            await new Promise((resolve) => setImmediate(resolve));
            check(photo.game.shareToast === toast,
                `pending photo ${outcome}: disposed runtime receives no late presentation`);
            check(photo.storage.writes === writes && JSON.stringify(photo.saveSystem.data) === before,
                `pending photo ${outcome}: late settlement performs no further save or stat writes`);
        }
        return { blueprintRejections: 1, photoShareResolutions: 1, photoShareRejections: 1 };
    } finally {
        try {
            for (const operation of pending) operation.resolve({ ok: false, method: 'none' });
            await Promise.allSettled(resources.reverse().map(async (value) => value.dispose()));
        } finally {
            for (const restore of restorers.reverse()) restore();
            env.restore();
        }
    }
}

async function validateGameLifetime() {
    const env = installNodeEnvironment();
    const restorers = [];
    const replace = (object, key, descriptor) => {
        const before = Object.getOwnPropertyDescriptor(object, key);
        Object.defineProperty(object, key, { configurable: true, ...descriptor });
        restorers.push(() => before ? Object.defineProperty(object, key, before) : delete object[key]);
    };
    const tracker = instrumentTargets([window, document, env.renderer.canvas]);
    const raf = new Map();
    let nextRaf = 1, hostStorageReads = 0, hostLockReads = 0, hostAudioReads = 0;
    const resources = [];
    const own = (value) => { resources.push(value); return value; };
    const disposeAll = async () => {
        const results = await Promise.allSettled(resources.splice(0).reverse().map(async (value) => value.dispose()));
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    };
    try {
        const [{ Game }, { SaveSystem }, { AudioSystem }, { Input }, { KeyboardInput },
            { TouchJoystick }, { TouchButtons }, { GameLoop }, { installAudioLifecycle }] = await Promise.all([
            import('../src/core/Game.js'), import('../src/systems/SaveSystem.js'),
            import('../src/systems/AudioSystem.js'), import('../src/core/Input.js'),
            import('../src/core/KeyboardInput.js'), import('../src/core/TouchJoystick.js'),
            import('../src/core/TouchButtons.js'), import('../src/core/GameLoop.js'),
            import('../src/platform/AudioLifecycle.js'),
        ]);
        replace(globalThis, 'requestAnimationFrame', { value(callback) { const id = nextRaf++; raf.set(id, callback); return id; } });
        replace(globalThis, 'cancelAnimationFrame', { value(id) { raf.delete(id); } });
        const rejectStorage = () => { hostStorageReads++; throw new Error('Native profile getter accessed'); };
        const rejectLocks = () => { hostLockReads++; throw new Error('Native locks getter accessed'); };
        const rejectAudio = () => { hostAudioReads++; throw new Error('Native AudioContext getter accessed'); };
        replace(globalThis, 'localStorage', { get: rejectStorage });
        replace(window, 'localStorage', { get: rejectStorage });
        replace(navigator, 'locks', { get: rejectLocks });
        replace(window, 'AudioContext', { get: rejectAudio });
        replace(window, 'webkitAudioContext', { get: rejectAudio });

        for (let cycle = 0; cycle < 10; cycle++) {
            const storage = createMemoryStorage();
            const saveSystem = own(new SaveSystem({ storage, participation: 'isolated' }));
            const audio = own(new AudioSystem({ contextFactory: null }));
            const keyboard = own(new KeyboardInput());
            const touch = own(new TouchJoystick(env.renderer));
            const buttons = own(new TouchButtons(env.renderer));
            const input = own(new Input({ keyboard, touch, buttons }));
            let game;
            const loop = own(new GameLoop({ update: (dt) => game.update(dt), render: () => game.render() }));
            const beforeGame = new Set(tracker.active.map((entry) => entry.callback));
            game = own(new Game({ renderer: env.renderer, input, loop, services: { saveSystem, audio } }));
            const gameCallbacks = tracker.active.filter((entry) => !beforeGame.has(entry.callback));
            check(gameCallbacks.length === 10, `cycle ${cycle}: exactly ten Game listeners`);
            const removeAudio = installAudioLifecycle(game);
            check(tracker.active.length === 38, `cycle ${cycle}: bounded live shell/Game/audio registrations`);
            loop.start();
            check(raf.size === 1, `cycle ${cycle}: one frame chain`);
            game._startRun({ campaignEligible: true });
            window.dispatchEvent({ type: 'keydown', code: 'KeyD' });
            check(input.getMovement().x === 1, `cycle ${cycle}: real movement input`);
            game.update(1 / 60);
            // A dead-but-not-yet-updated player and unbanked run deliberately
            // tempt accidental terminal settlement during disposal.
            game.player.hp = 0;
            game.player.coins = 137;
            const before = JSON.stringify(saveSystem.data);
            const writes = storage.writes;
            const runRecorded = game._runRecorded;
            loop.stop();
            removeAudio(); removeAudio();
            const disposal = game.dispose();
            check(game.dispose() === disposal, `cycle ${cycle}: stable Game disposal promise`);
            await disposal;
            check(saveSystem._saveParticipationState === 'unsupported' && !audio._disposed,
                `cycle ${cycle}: injected save/audio remain caller-owned`);
            check(input._onModalityChange === null, `cycle ${cycle}: no retained Game modality callback`);
            check(!input._disposed && keyboard.keys.has('KeyD'), `cycle ${cycle}: Game did not destroy borrowed devices`);
            for (const { callback } of gameCallbacks) callback({ code: 'Enter', changedTouches: [], preventDefault() {} });
            game.update(1 / 60); game.render(); game._menuAction('startRun');
            game._afterShare({ ok: true, method: 'clipboard' });
            input.setModality('touch'); input.setModality('keyboard');
            check(JSON.stringify(saveSystem.data) === before && storage.writes === writes,
                `cycle ${cycle}: no save, settings, share stat or reward mutation on/after disposal`);
            check(game._runRecorded === runRecorded && !game.gameOver,
                `cycle ${cycle}: disposal did not record a death`);
            await disposeAll();
            check(keyboard.keys.size === 0 && input.getMovement().x === 0,
                `cycle ${cycle}: caller-owned input now clears`);
            check(tracker.active.length === 0 && raf.size === 0,
                `cycle ${cycle}: zero residual listeners or frame callbacks`);
        }
        check(hostStorageReads === 0 && hostLockReads === 0 && hostAudioReads === 0,
            'ten real Game lifetimes never touched guarded native storage/locks/audio getters');

        // The fixture must not report success when a caller-owned service
        // truthfully reports failed cleanup; all globals still restore.
        const { runFixture } = await import('./artshot/migration-fixture.mjs');
        const originalDispose = SaveSystem.prototype.dispose;
        const nativeRandom = Math.random, nativeDate = Date, nativeNow = performance.now;
        SaveSystem.prototype.dispose = async function failedCleanupProbe() {
            await originalDispose.call(this);
            return false;
        };
        try {
            await assert.rejects(runFixture({ id: 'normal-desktop', renderer: env.renderer, environment: {} }),
                /Fixture service cleanup failed/);
            check(Math.random === nativeRandom && Date === nativeDate && performance.now === nativeNow,
                'fixture failed cleanup restores deterministic globals');
            check(tracker.active.length === 0 && hostStorageReads === 0 && hostLockReads === 0 && hostAudioReads === 0,
                'fixture failed cleanup still removes all owners without native profile access');
        } finally { SaveSystem.prototype.dispose = originalDispose; }

        // Production-style no-argument construction still owns its real services.
        // The host below is a counted test double, never a browser/user profile.
        const storage = createMemoryStorage();
        let requests = 0, participants = 0;
        replace(globalThis, 'localStorage', { value: storage });
        replace(window, 'localStorage', { value: storage });
        replace(navigator, 'locks', { value: {
            request(name, options, callback) {
                requests++; participants++;
                return Promise.resolve(callback({ name, mode: options.mode })).finally(() => { participants--; });
            },
        } });
        replace(window, 'AudioContext', { value: undefined });
        replace(window, 'webkitAudioContext', { value: undefined });
        const keyboard = own(new KeyboardInput());
        const touch = own(new TouchJoystick(env.renderer));
        const buttons = own(new TouchButtons(env.renderer));
        const input = own(new Input({ keyboard, touch, buttons }));
        const shellCount = tracker.active.length;
        const priorProfiler = {};
        const loop = { fps: 60, profiler: priorProfiler };
        const game = own(new Game({ renderer: env.renderer, input, loop }));
        await game.saveSystem.whenSaveParticipationReady();
        check(participants === 1 && requests === 1, 'default Game owns exactly one production-style participant');
        const writes = storage.writes;
        await game.dispose();
        check(participants === 0 && game.audio._disposed && game.saveSystem._saveParticipationState === 'disposed',
            'default Game disposal closes owned save/audio');
        check(storage.writes === writes && loop.profiler === priorProfiler,
            'default disposal writes nothing and restores only its profiler slot');
        check(tracker.active.length === shellCount, 'default Game leaves the borrowed shell alive');

        // Fail at each of the ten Game listener registrations. Default save
        // participation already exists at every failure; cleanup must join it.
        for (let index = 1; index <= 10; index++) {
            tracker.failAfter(index);
            let failed;
            const beforeWrites = storage.writes;
            try { new Game({ renderer: env.renderer, input, loop }); }
            catch (error) { failed = error; }
            tracker.stopFailing();
            check(failed?.cause?.message === 'Game listener installation probe' && failed.cleanup instanceof Promise,
                `partial Game ${index}: original cause and cleanup join exposed`);
            await failed.cleanup;
            check(tracker.active.length === shellCount && participants === 0 && input._onModalityChange === null,
                `partial Game ${index}: no owned listeners, modality callback or participant survives`);
            check(storage.writes === beforeWrites + 2, `partial Game ${index}: only constructor probe, no cleanup writes`);
        }

        // A failed construction must never claim ownership of supplied services.
        const borrowedSave = own(new SaveSystem({ storage: createMemoryStorage(), participation: 'isolated' }));
        const borrowedAudio = own(new AudioSystem({ contextFactory: null }));
        const originalSetVolumes = borrowedAudio.setVolumes;
        borrowedAudio.setVolumes = () => { throw new Error('Borrowed audio configuration probe'); };
        let failed;
        try { new Game({ renderer: env.renderer, input, loop,
            services: { saveSystem: borrowedSave, audio: borrowedAudio } }); }
        catch (error) { failed = error; }
        await failed.cleanup;
        borrowedAudio.setVolumes = originalSetVolumes;
        check(!borrowedAudio._disposed && borrowedSave._saveParticipationState === 'unsupported'
            && input._onModalityChange === null && tracker.active.length === shellCount,
        'partial construction preserves borrowed save/audio and removes its own subscription');

        // One failing owned disposer cannot prevent the other owners closing.
        const cleanupFailure = own(new Game({ renderer: env.renderer, input, loop }));
        cleanupFailure.captionSystem.dispose = () => { throw new Error('Caption cleanup probe'); };
        await assert.rejects(cleanupFailure.dispose(), (error) => error instanceof AggregateError);
        check(participants === 0 && cleanupFailure.audio._disposed && tracker.active.length === shellCount,
            'owned disposer exception still closes save/audio and all listeners');
        resources.splice(resources.indexOf(cleanupFailure), 1); // already joined the expected rejection
        await disposeAll();
        check(tracker.active.length === 0 && participants === 0 && raf.size === 0,
            'all Game test owners return to zero');
        return { cycles: 10, listenersPerGameCycle: 38, partialGameFailures: 11,
            hostStorageReads, hostLockReads, hostAudioReads, productionStyleRequests: requests,
            remainingParticipants: participants, queuedRaf: raf.size, ...tracker.stats() };
    } finally {
        try { await disposeAll(); }
        finally {
            tracker.restore();
            for (const restore of restorers.reverse()) restore();
            env.restore();
        }
    }
}

try {
    summaries.save = await validateSaveLifetime(check);
    summaries.input = await validateInputLifetime(check);
    summaries.audio = await validateAudioLifetime(check);
    summaries.pendingCallbacks = await validatePendingCallbacks(check);
    summaries.game = await validateGameLifetime();
    // Complement behavioral guards: no URL path may select sandbox services,
    // and PR1 browser isolation must no longer replace any native globals.
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const browser = readFileSync(new URL('./artshot/migration-browser.mjs', import.meta.url), 'utf8');
    check(!/participation:\s*['"]isolated|contextFactory|services\s*:/.test(main), 'production boot exposes no sandbox service switch');
    check(!/Object\.defineProperty\((?:window|navigator)|AudioContext\s*=/.test(browser),
        'PR1 browser fixture does not shadow storage, locks or AudioContext');
    await new Promise((resolve) => setTimeout(resolve, 0));
    check(unhandled.length === 0, 'no unhandled asynchronous lifetime failures');
    console.log(`Runtime lifetime: PASS (${assertions} assertions)`);
    console.log(JSON.stringify(summaries, null, 2));
} finally {
    process.removeListener('unhandledRejection', rejection);
}
