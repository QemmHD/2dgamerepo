// Tools-only staged screenshots. This does not supply gameplay to the public
// entry, replace the PR1 fixtures, or claim deterministic semantic equivalence.
import { MemoryStorage } from '../../src/platform/MemoryStorage.js';

const errors = [];
const recordError = event => errors.push(String(event.message || event.reason));
addEventListener('error', recordError);
addEventListener('unhandledrejection', recordError);
const require = (condition, message) => { if (!condition) throw new Error(message); };
const state = {
    expectedPinnedVersion: '4.2.1', renderer: {}, boot: {}, storage: {}, locks: {}, lifetime: {},
    simulation: { updateCalls: 0, renderCalls: 0 }, pixels: {},
    errors: { contextLossCount: 0, contextRestoreCount: 0, webglErrorCount: 0 }, measurements: {},
};
const memory = new MemoryStorage();
const ownStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
const ownLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
let runtime, disposal, nativeReads = 0, nativeLocks = 0, engineImport = true;
let phase = 'vendor import', finished = false;
Object.defineProperty(window, 'localStorage', { configurable: true, get() {
    // The official vendor capability probe receives the same disposable memory
    // facade. After import, any host-storage access is an immediate fixture error.
    if (engineImport) return memory;
    nativeReads++;
    throw new Error('host storage access');
} });
Object.defineProperty(navigator, 'locks', { configurable: true, get() {
    nativeLocks++;
    throw new Error('host locks access');
} });

async function dispose() {
    if (disposal) return disposal;
    disposal = (async () => {
        try { await runtime?.dispose(); }
        finally {
            if (ownStorage) Object.defineProperty(window, 'localStorage', ownStorage); else delete window.localStorage;
            if (ownLocks) Object.defineProperty(navigator, 'locks', ownLocks); else delete navigator.locks;
            removeEventListener('error', recordError);
            removeEventListener('unhandledrejection', recordError);
            removeEventListener('pagehide', onPageHide);
        }
    })();
    return disposal;
}
const onPageHide = () => { void dispose().catch(error => errors.push(String(error))); };
addEventListener('pagehide', onPageHide, { once: true });

function publishReceipt(receipt) {
    window.__phaserVisualReceipt = receipt;
    let output = document.getElementById('phaser-visual-receipt');
    if (!output) {
        output = document.createElement('script');
        output.id = 'phaser-visual-receipt';
        output.type = 'application/json';
        document.body.append(output);
    }
    output.textContent = JSON.stringify(receipt);
}

function fail(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    errors.push(String(error.stack || error));
    publishReceipt({ passed: false, kind: 'visual-staged-not-semantic-parity', phase, errors,
        hostStorageAccesses: nativeReads, hostLockAccesses: nativeLocks });
    document.title = `BOOTFAIL phaser-visual ${phase}: ${error.message || error}`;
    document.documentElement.dataset.qaReady = '1';
    void dispose().catch(cleanupError => errors.push(String(cleanupError)));
}
const watchdog = setTimeout(() => fail(new Error('visual fixture phase timeout')), 45000);

async function boot() {
    const params = new URLSearchParams(location.search);
    const visual = params.get('state') || 'gameplay';
    require(['gameplay', 'boss', 'warning', 'pause'].includes(visual), 'Unsupported visual state');
    params.set('skipOnboarding', '1');
    params.delete('dev');
    history.replaceState(null, '', `${location.pathname}?${params}`);
    await import('../../src/vendor/phaser/4.2.1/phaser.esm.min.js');
    engineImport = false;
    phase = 'runtime boot and assets';
    const { PhaserRuntime } = await import('../../src/phaser/PhaserRuntime.js');
    let frames = 0, modalChoices = 0;
    runtime = new PhaserRuntime({
        stage: document.getElementById('stage'), state, memory,
        publish: () => { runtime?.snapshot(); return JSON.parse(JSON.stringify(state)); },
        onFailure: reason => { throw new Error(reason); },
        beforeSimulation: host => {
            host.phaser.loop.stop();
            host.presentationEnabled = false;
        },
        prepareInput: host => {
            // CDP captures use real mobile/touch device metrics. Select the
            // corresponding existing input modality, without a fake viewport.
            host.input.setModality(navigator.maxTouchPoints > 0 ? 'touch' : 'keyboard');
        },
        onSimulation: async host => {
            phase = 'controlled real Game simulation';
            const { game, loop } = host;
            await game.saveSystem.whenSaveParticipationReady();
            // Deliberately leave campaign eligibility false. Direct test boss
            // spawns cannot claim previous-map progression or real rewards.
            game._startRun();
            game.player.damageTakenMul = 0;
            const update = loop.update;
            loop.update = dt => {
                require(dt === 1 / 60, 'Variable simulation timestep');
                update(dt);
                if (game.upgradeChoices) { game.selectUpgrade(0); modalChoices++; }
                if (game.chestReward) { game._dismissChestReward(); modalChoices++; }
                if (game.altar) { game.selectAltar(0); modalChoices++; }
            };
            let timestamp = performance.now();
            loop.resetClock(timestamp);
            function step(count) {
                for (let i = 0; i < count; i++) {
                    timestamp += 1000 / 60;
                    host.phaser.step(timestamp, 987654);
                    frames++;
                }
            }
            // No seeded randomness and no direct Game.update: every fixed tick
            // is owned by the actual pinned Phaser PRE_STEP/POST_RENDER bridge.
            step(720);
            if (visual === 'boss') {
                game._spawnBoss('stormwingAlpha');
                step(120);
                require(game.enemies.some(enemy => enemy.active && enemy.boss), 'Boss state missing');
            } else if (visual === 'warning') {
                game._startBossWarning('stormwingAlpha');
                step(30);
                require(game.bossWarning?.id === 'stormwingAlpha', 'Warning state missing');
            } else if (visual === 'pause') game.togglePause();
            host.presentationEnabled = true;
            host.captureNext = true;
            step(1);
            loop.stop();
            require(game.screen === 'gameplay', 'Run did not remain in gameplay');
        },
    });
    await runtime.boot();
    if (finished) return;
    phase = 'capture assertions';
    await document.fonts.ready;
    // The clock is stopped. Repaint the same real UI after fonts become ready;
    // no update or legacy world renderer is invoked here.
    runtime.game.renderOverlay();
    runtime.snapshot();
    const { game, renderer } = runtime;
    const pixels = renderer.ctx.getImageData(0, 0, runtime.overlay.width, runtime.overlay.height).data;
    let transparent = 0, translucent = 0, visible = 0;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) transparent++;
        else visible++;
        if (pixels[i] > 0 && pixels[i] < 255) translucent++;
    }
    const worldBounds = state.renderer.cssViewport, overlayBounds = state.renderer.overlay.cssViewport;
    const boundsError = Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(worldBounds[key] - overlayBounds[key])));
    const rotateHint = document.getElementById('rotate-hint');
    const cueStyle = getComputedStyle(rotateHint);
    const cue = { visible: cueStyle.display !== 'none' && cueStyle.visibility !== 'hidden' && Number(cueStyle.opacity) > 0,
        // Production CSS intentionally calls the collapsed persistent pill
        // `.show.hidden`; `hidden` alone does not mean invisible in portrait.
        compact: rotateHint.classList.contains('show') && rotateHint.classList.contains('hidden'),
        transform: cueStyle.transform,
        stageTransform: getComputedStyle(document.getElementById('stage')).transform };
    require(nativeReads === 0 && nativeLocks === 0, 'Persistence escaped memory');
    require(state.lifetime.activeGameCount === 1 && state.lifetime.canvasCount === 2, 'Unexpected resource count');
    require(state.boot.simulationConnected && state.simulation.updateCalls >= 700, 'Not actual hosted simulation');
    require(!state.simulation.legacyRAFActive && !state.simulation.loopRunning
        && !state.lifetime.phaserRAFRunning && !state.lifetime.phaserLoopRunning, 'Capture not frozen');
    require(state.renderer.webgl && state.renderer.contextActive && state.renderer.overlay.alpha, 'Wrong rendering contexts');
    // Warning/pause intentionally tint the full screen in the retained UI.
    // Those pixels may be translucent rather than fully clear; neither state
    // may turn the complete underlying diagnostic world opaque.
    require(boundsError <= .001 && transparent + translucent > pixels.length / 4 * .25
        && visible > 0, 'Overlay obscures diagnostic world');
    require(state.boot.audioMode === 'silent-no-context' && state.lifetime.ownedSaveParticipants === 0, 'Unexpected external service participation');
    require(game.campaignRun?.eligible === false && game.campaignRun?.taintReason === 'direct-start', 'Staged run became campaign eligible');
    if (visual === 'boss') require(game.enemies.filter(enemy => enemy.active && enemy.boss)
        .every(enemy => enemy.bossSpawnProvenance === 'direct'), 'Staged boss has non-direct provenance');
    if (visual === 'warning') require(game.bossWarning?.provenance === 'direct', 'Staged warning has non-direct provenance');
    if (state.viewport.rotated) require(cue.visible && cue.compact && cue.transform === 'none', 'Portrait cue is not compact/upright');
    require(errors.length === 0 && state.errors.webglErrorCount === 0, 'Browser errors');
    const receipt = {
        passed: true, kind: 'visual-staged-not-semantic-parity', visual,
        scope: 'Unseeded tools-only staging; real Game state, diagnostic Phaser primitives, retained Canvas HUD. Not final world art or hardware performance evidence.',
        frames, modalChoices, hostStorageAccesses: nativeReads, hostLockAccesses: nativeLocks,
        fixtureInvulnerability: game.player.damageTakenMul === 0,
        campaignRun: { ...game.campaignRun },
        boss: game.enemies.filter(enemy => enemy.active && enemy.boss).map(enemy => ({
            type: enemy.type, hp: enemy.hp, provenance: enemy.bossSpawnProvenance })),
        warning: game.bossWarning ? { id: game.bossWarning.id, timer: game.bossWarning.timer,
            provenance: game.bossWarning.provenance } : null,
        overlayPixels: { transparent, translucent, visible }, boundsError, rotateCue: cue, errors,
        live: JSON.parse(JSON.stringify(state)), cleanup: 'Runtime disposal and guard restoration are registered on pagehide.',
    };
    finished = true;
    clearTimeout(watchdog);
    publishReceipt(receipt);
    document.title = `PHASER VISUAL ${visual} STAGED TICKS:${state.simulation.updateCalls} EXC:0`;
    document.documentElement.dataset.qaReady = '1';
}

boot().catch(fail);
