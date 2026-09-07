import { detachReceipt } from './Receipt.js';
import { MemoryStorage } from '../platform/MemoryStorage.js';

const state = {
    runtime: 'phaser-experimental', phaserVersion: null, expectedPinnedVersion: '4.2.1',
    renderer: { webgl: false, contextActive: false, contextType: null, identity: null,
        drawingBufferWidth: 0, drawingBufferHeight: 0, canvasWidth: 0, canvasHeight: 0,
        cssViewport: null, overlay: null },
    boot: { sceneReady: false, frameRendered: false, gameConstructed: false,
        simulationConnected: false, isolatedSave: false, audioMode: 'unverified',
        physicsEnabled: false, phaserInputDrivesSimulation: false },
    storage: { hostStorageAccesses: 0, memoryWrites: 0, engineMemoryFacadeAccesses: 0 }, locks: { hostLockAccesses: 0 },
    lifetime: { activeGameCount: 0, disposed: false, ownedSaveParticipants: 0,
        shellListeners: 0, phaserLoopRunning: false, phaserRAFRunning: false,
        canvasCount: 0, sceneCount: 0, textureCount: 0 },
    simulation: { time: 0, screen: null, loopRunning: false, updateCalls: 0, renderCalls: 0 },
    pixels: { passed: false },
    errors: { exceptionCount: 0, unhandledRejectionCount: 0, contextLossCount: 0,
        contextRestoreCount: 0, webglErrorCount: 0 },
    failure: null,
    measurements: { label: 'PR3 INFRASTRUCTURE MEASUREMENTS', artifactBytes: 1377611,
        importMs: null, bootMs: null, firstFrameMs: null, initialHeapBytes: null, textureCount: 0 },
};
const listeners = [], restorers = [];
let runtime = null, disposeTask = null, disposing = false, loadingTask = null;
let engineImportOnly = false;
let memory = null;
const status = document.getElementById('experiment-status');
const detail = document.getElementById('experiment-detail');

function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push({ target, type, callback, options });
}
function publish() {
    runtime?.snapshot();
    const result = detachReceipt(state);
    result.lifetime.shellListeners += listeners.length;
    window.__phaserMigrationReceipt = result;
    return detachReceipt(result);
}
function fail(classification, shouldDispose = true) {
    state.failure = classification;
    document.body.dataset.failed = 'true';
    document.body.dataset.qaReady = 'true';
    document.documentElement.dataset.qaReady = '1';
    document.title = `EMBERWAKE — BOOTFAIL: ${classification}`;
    status.textContent = 'PHASER EXPERIMENT FAILED';
    detail.textContent = `${classification} — this page has not switched to the Canvas game. Use OPEN CANVAS VERSION below.`;
    publish();
    if (shouldDispose) void dispose().catch(() => {});
}
function dispose() {
    if (disposeTask) return disposeTask;
    disposing = true;
    disposeTask = (async () => {
        let failure;
        // Dynamic imports cannot be cancelled. Keep host guards in place until
        // late engine evaluation finishes; a disposed boot must not expose the
        // original browser storage to its capability probe.
        try { await loadingTask; } catch { /* the boot path classifies import failure */ }
        try { await runtime?.dispose(); } catch (error) { failure = error; }
        for (const { target, type, callback, options } of listeners) target.removeEventListener(type, callback, options);
        listeners.length = 0;
        for (const restore of restorers.reverse()) restore();
        restorers.length = 0;
        state.lifetime.disposed = true;
        publish();
        if (failure) {
            state.failure = 'cleanup-failure';
            status.textContent = 'PHASER EXPERIMENT FAILED';
            detail.textContent = 'cleanup-failure — use OPEN CANVAS VERSION.';
            publish();
            throw failure;
        }
        if (!state.failure) {
            status.textContent = 'EXPERIMENT STOPPED';
            detail.textContent = 'The experimental runtime has been disposed. Reload to inspect it again, or open the Canvas version.';
        }
        return publish();
    })();
    return disposeTask;
}

// Defense in depth for this explicit public experiment, installed BEFORE engine
// and Game imports. Count every forbidden attempt without reading the native
// getters. Real SaveSystem isolation remains the primary persistence seam.
function denyHostAccess(target, key, counter, field) {
    const own = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, get() {
        // The exact unmodified vendor probes `!!localStorage.getItem` at import.
        // Give ONLY that import a memory facade, never the native getter. Game
        // modules are imported later, after this narrow compatibility window.
        if (key === 'localStorage' && engineImportOnly) {
            state.storage.engineMemoryFacadeAccesses++;
            return memory;
        }
        counter[field]++;
        throw new Error(`experimental-host-${key}-access-denied`);
    } });
    restorers.push(() => own ? Object.defineProperty(target, key, own) : delete target[key]);
}

async function boot() {
    try {
        try { memory = new MemoryStorage(); }
        catch (error) { error.experimentClassification = 'isolated-save'; throw error; }
        denyHostAccess(window, 'localStorage', state.storage, 'hostStorageAccesses');
        denyHostAccess(navigator, 'locks', state.locks, 'hostLockAccesses');
        // Stopped RAF alone does not disable Game's menu actions. Install ahead
        // of all legacy handlers. No preventDefault: native Tab, scrolling,
        // keyboard link activation and browser shortcuts keep working.
        const quarantine = event => event.stopImmediatePropagation();
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup',
            'mousemove', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel']) {
            listen(window, type, quarantine, { capture: true, passive: true });
        }
        listen(window, 'error', () => {
            state.errors.exceptionCount++;
            fail(state.boot.frameRendered ? 'runtime-exception' : 'scene-boot');
        });
        listen(window, 'unhandledrejection', () => { state.errors.unhandledRejectionCount++; fail('unhandled-rejection'); });
        listen(window, 'pagehide', () => { void dispose().catch(() => {}); });
        const start = performance.now();
        let module;
        try {
            loadingTask = (async () => {
                engineImportOnly = true;
                try { await import('../vendor/phaser/4.2.1/phaser.esm.min.js'); }
                finally { engineImportOnly = false; }
                if (disposing) return null;
                return import('./PhaserRuntime.js');
            })();
            module = await loadingTask;
        }
        catch (error) { error.experimentClassification = 'engine-import'; throw error; }
        state.measurements.importMs = performance.now() - start;
        if (disposing) return publish();
        runtime = new module.PhaserRuntime({ stage: document.getElementById('experiment-stage'),
            state, memory, publish, onFailure: fail });
        await runtime.boot();
        if (disposing) return publish();
        status.textContent = `PHASER ${state.phaserVersion} · WEBGL ACTIVE`;
        detail.textContent = `RENDERER: ${state.renderer.identity} · SAVE: ISOLATED · SIMULATION: NOT CONNECTED`;
        document.body.dataset.qaReady = 'true';
        document.documentElement.dataset.qaReady = '1';
        return publish();
    } catch (error) {
        fail(state.failure || error.experimentClassification || (disposing ? 'boot-cancelled' : 'scene-boot'), false);
        try { await dispose(); } catch { /* cleanup failure is already visible */ }
        return publish();
    }
}

// Only explicit operations and detached scalar receipts cross this boundary.
// No Game, Phaser, SaveSystem, canvas, context, texture, or Scene is exposed.
window.__phaserExperiment = {
    ready: null, receipt: publish, dispose,
    capture: () => runtime?.capture() ?? null,
    contextLossProbe: async () => {
        const result = await runtime.contextLossProbe();
        await dispose();
        return detachReceipt({ ...result, disposed: true });
    },
};
publish();
window.__phaserExperiment.ready = boot();
