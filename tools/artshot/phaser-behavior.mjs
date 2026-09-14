// TEST ONLY. One real Game, the real existing Input shell, and actual pinned
// Phaser.Game.step -> PRE_STEP -> shared GameLoop. No production query seam.
// Synthetic DOM/handler inputs characterize semantics, not trusted device input.
import { TestClock, installDeterministicGlobals } from './migration-clock.mjs';
import { MemoryStorage } from '../../src/platform/MemoryStorage.js';

const errors = [], cases = [];
addEventListener('error', event => errors.push(String(event.message)));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
let checks = 0;
function check(value, message) { checks++; if (!value) throw new Error(message); }
function near(actual, expected, message) { check(Math.abs(actual - expected) <= 1e-9, `${message}: ${actual} != ${expected}`); }
const state = { expectedPinnedVersion: '4.2.1', renderer: {}, boot: {}, storage: {}, locks: {}, lifetime: {},
    simulation: { updateCalls: 0, renderCalls: 0 }, pixels: {},
    errors: { contextLossCount: 0, contextRestoreCount: 0, webglErrorCount: 0 }, measurements: {} };
const memory = new MemoryStorage(), clock = new TestClock();
let runtime, rng, nativeStorage = 0, nativeLocks = 0, engineImport = true, now = 0;
const originals = [];
function replace(target, key, descriptor) {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    originals.push(() => original ? Object.defineProperty(target, key, original) : delete target[key]);
}
replace(window, 'localStorage', { get() {
    if (engineImport) return memory;
    nativeStorage++; throw new Error('host storage access');
} });
replace(navigator, 'locks', { get() { nativeLocks++; throw new Error('host locks access'); } });

async function boot() {
    const params = new URLSearchParams(location.search);
    const disposalMode = params.get('dispose') || 'paused';
    check(['paused', 'hidden', 'catchup', 'touch', 'modal'].includes(disposalMode), 'Unknown disposal fixture');
    params.set('skipOnboarding', '1'); params.delete('dev');
    history.replaceState(null, '', `${location.pathname}?${params}`);
    await import('../../src/vendor/phaser/4.2.1/phaser.esm.min.js');
    engineImport = false;
    const { PhaserRuntime } = await import('../../src/phaser/PhaserRuntime.js');
    runtime = new PhaserRuntime({ stage: document.getElementById('stage'), state, memory,
        publish: () => { runtime?.snapshot(); return JSON.parse(JSON.stringify(state)); },
        onFailure: reason => { throw new Error(reason); },
        beforeSimulation: host => {
            host.phaser.loop.stop();
            host.presentationEnabled = false;
            rng = installDeterministicGlobals(207004, clock);
        },
        prepareInput: host => {
            host.touch.supported = host.buttons.supported = true;
            host.input.setModality('touch');
        },
    });
    // Run assertions after boot/connection settles, so disposing from a tested
    // fixed update never awaits the callback which is currently doing that test.
    await runtime.boot();
    const { game, loop, keyboard, buttons, touch, input, renderer } = runtime;
    const { Enemy } = await import('../../src/entities/Enemy.js');
    const { KINDLE } = await import('../../src/config/GameConfig.js');
    await game.saveSystem.whenSaveParticipationReady();
    let maxSteps = 0;
    const originalUpdate = loop.update;
    loop.update = dt => {
        check(dt === 1 / 60, 'Every actual Game update uses exact fixed dt');
        clock.ticks++;
        originalUpdate(dt);
    };
    function frame(milliseconds = 100) {
        now += milliseconds; clock.nowMs = now;
        const before = state.simulation.updateCalls;
        runtime.phaser.step(now, 987654); // Deliberately absurd Phaser delta is not authority.
        const ticks = state.simulation.updateCalls - before;
        maxSteps = Math.max(maxSteps, ticks);
        check(ticks <= 8, 'No presented frame exceeds eight fixed updates');
        return ticks;
    }
    function fresh() {
        if (game.photoMode) game._exitPhotoMode();
        keyboard.keys.clear(); touch.reset(); buttons.reset();
        input.setModality('touch');
        game._startRun({ campaignEligible: true });
        game.player.damageTakenMul = 0;
        loop.resetClock(now);
        check(game.screen === 'gameplay' && !game.paused && !game.gameOver, 'Real isolated run starts');
    }
    function key(code, down = true, repeat = false) {
        window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, repeat, cancelable: true }));
    }
    function eventAt(x, y, identifier) {
        const o = renderer.clientToInternal(0, 0), ex = renderer.clientToInternal(1, 0), ey = renderer.clientToInternal(0, 1);
        const a = ex.x - o.x, b = ey.x - o.x, c = ex.y - o.y, d = ey.y - o.y, det = a * d - b * c;
        check(Number.isFinite(det) && det !== 0, 'Actual Renderer mapping is invertible');
        return { preventDefault() {}, changedTouches: [{ identifier,
            clientX: ((x - o.x) * d - b * (y - o.y)) / det,
            clientY: (a * (y - o.y) - (x - o.x) * c) / det }] };
    }
    function press(name, identifier = 2) {
        const point = buttons.layout()[name];
        buttons._handleStart(eventAt(point.x, point.y, identifier));
    }
    function release(name, identifier = 2, elapsed = 6) {
        clock.nowMs = now + elapsed;
        const point = buttons.layout()[name];
        buttons._handleEnd(eventAt(point.x, point.y, identifier));
        clock.nowMs = now;
    }
    function steer() {
        touch._handleStart(eventAt(350, 750, 1));
        touch._handleMove(eventAt(touch.origin.x + touch.maxRadius, touch.origin.y, 1));
    }
    const phaseCalls = {};
    for (const name of ['_updateDirectors', '_updatePlayerAndWeapons', '_updateEnemies', '_updateProjectiles', '_updatePickups']) {
        const original = game[name];
        game[name] = function (...args) {
            (phaseCalls[name] ||= []).push(args.slice(0, name === '_updatePlayerAndWeapons' ? 3 : 1));
            return original.apply(this, args);
        };
    }
    function clearPhases() { for (const name of Object.keys(phaseCalls)) phaseCalls[name] = []; }
    function gamePosition() { return JSON.stringify([game.time, game.player.x, game.player.y, game.player.hp,
        game.enemies.map(e => [e.x, e.y, e.hp]), game.projectiles.map(p => [p.x, p.y])]); }

    // Menu advances its real UI timeout but no world clock.
    game.resetConfirming = true; game.resetConfirmTimer = 1;
    loop.resetClock(now);
    const menuTicks = frame();
    near(game.time, 0, 'HOME freezes game time');
    near(game.resetConfirmTimer, 1 - menuTicks / 60, 'HOME confirmation timeout still ticks');
    cases.push({ name: 'menu', ticks: menuTicks, gameTime: game.time });

    // Focus uses unchanged mixed-clock paths. Instrumentation delegates to each
    // real method, not a mock GameUpdate or a reimplemented timing calculation.
    fresh(); clearPhases(); steer();
    game.kindleSystem.fill = game.kindleSystem.ultCost;
    game.kindleSystem.blinkCooldown = 2;
    press('kindle', 3);
    const focusTicks = frame();
    check(!!game.kindleSystem.aiming, 'Held Kindle enters real Focus aim');
    near(game.time, focusTicks / 60, 'Focus keeps real run time');
    near(game.kindleSystem.blinkCooldown, 2 - focusTicks / 60, 'Focus keeps real cooldown time');
    for (const name of ['_updateDirectors', '_updatePickups']) {
        check(phaseCalls[name].length === focusTicks, `${name} ran on every Focus fixed tick`);
        for (const [dt] of phaseCalls[name]) near(dt, 1 / 60, `${name} receives real dt`);
    }
    for (const name of ['_updateEnemies', '_updateProjectiles']) {
        check(phaseCalls[name].length === focusTicks, `${name} ran on every Focus fixed tick`);
        for (const [dt] of phaseCalls[name]) near(dt, KINDLE.focusTimeScale / 60, `${name} receives slowed world dt`);
    }
    for (const [dt, worldDt, aiming] of phaseCalls._updatePlayerAndWeapons) {
        near(dt, 1 / 60, 'Player and weapon phase receives real dt');
        near(worldDt, KINDLE.focusTimeScale / 60, 'Spawner within player/weapon phase receives world dt');
        check(aiming, 'Focus movement modifier remains active');
    }
    cases.push({ name: 'focus-two-clocks', ticks: focusTicks, realDt: 1 / 60, worldDt: KINDLE.focusTimeScale / 60 });

    // Release a held/dragged Kindle across catch-up: exactly one real ultimate.
    const point = buttons.layout().kindle;
    buttons._handleMove(eventAt(point.x + 100, point.y, 3));
    release('kindle', 3, 200);
    frame(1000);
    check(game.ultsReleased === 1 && !game.kindleSystem.aiming, 'Held Kindle releases once during catch-up');
    frame(1000); check(game.ultsReleased === 1, 'Held-release action does not repeat');
    cases.push({ name: 'kindle-hold-release', releases: game.ultsReleased });

    fresh(); game.kindleSystem.fill = game.kindleSystem.ultCost;
    press('kindle', 3); release('kindle', 3);
    frame(1000); frame(1000);
    check(game.ultsReleased === 1, 'Between-tick Kindle quick tap releases exactly once');
    cases.push({ name: 'kindle-quick-tap', releases: game.ultsReleased });

    fresh(); steer(); press('blink'); release('blink');
    const startX = game.player.x;
    frame(1000); frame(1000);
    check(game.blinks === 1 && game.player.x > startX && touch.active, 'Movement held plus Blink tap survives catch-up exactly once');
    cases.push({ name: 'simultaneous-move-blink', blinks: game.blinks, movementX: game.player.x - startX });

    fresh();
    const target = new Enemy('brute', game.camera.x + 240, game.camera.y + 50);
    game.enemies.push(target);
    let focusActions = 0;
    const focusTap = game._focusTapAt;
    game._focusTapAt = function (...args) { focusActions++; return focusTap.apply(this, args); };
    buttons._handleStart(eventAt(1200, 590, 4));
    clock.nowMs = now + 6; buttons._handleEnd(eventAt(1200, 590, 4)); clock.nowMs = now;
    frame(1000); frame(1000);
    check(focusActions === 1 && game.focusTarget === target, 'Between-tick Focus tap selects actual target once');
    cases.push({ name: 'focus-tap', actions: focusActions, target: target.type });

    function frozen(name, setup, age) {
        fresh(); setup(); clearPhases();
        const before = gamePosition(), initialAge = age?.();
        const ticks = frame();
        check(ticks > 0 && gamePosition() === before, `${name} freezes authoritative world state`);
        check(Object.values(phaseCalls).every(calls => calls.length === 0), `${name} does not run gameplay phases`);
        if (age) near(age(), initialAge + ticks / 60, `${name} overlay age uses real fixed dt`);
        cases.push({ name, ticks, gameTime: game.time });
    }
    frozen('manual-pause', () => { key('KeyP'); key('KeyP', true, true); key('KeyP', false); check(game.paused, 'Pause and key repeat do not double-toggle'); });
    key('KeyP'); key('KeyP', false); check(!game.paused, 'Distinct pause key resumes');
    const resumeTime = game.time; frame(); check(game.time > resumeTime, 'Resumed simulation advances');
    frozen('blur-auto-pause', () => { window.dispatchEvent(new Event('blur')); check(game.paused, 'Real blur handler auto-pauses'); });
    frozen('level-up', () => { game.upgradeChoices = [{ id: 'fixture-choice' }]; game.levelUpAge = 0; }, () => game.levelUpAge);
    frozen('chest', () => { game.chestReward = { age: 0 }; }, () => game.chestReward.age);
    frozen('altar', () => { game.altar = { age: 0, choices: [] }; }, () => game.altar.age);
    frozen('victory', () => { game.victory = { age: 0 }; }, () => game.victory.age);
    frozen('photo', () => { game._enterPhotoMode('gameplay'); });
    fresh(); game.hitStop = 0.5;
    const stoppedTime = game.time, hitTicks = frame();
    near(game.hitStop, 0.5 - hitTicks / 60, 'Hit-stop drains with real fixed dt');
    near(game.time, stoppedTime, 'Hit-stop freezes run time');
    cases.push({ name: 'hit-stop', ticks: hitTicks, remaining: game.hitStop });

    fresh(); game.kindleSystem.fill = game.kindleSystem.ultCost;
    press('kindle', 3); frame(20);
    check(game.kindleSystem.aiming, 'Refund fixture begins real Focus');
    game.togglePause(); frame();
    check(!game.kindleSystem.aiming && game.ultsReleased === 0, 'Pause interrupts Focus without releasing');
    near(game.kindleSystem.fill, game.kindleSystem.ultCost, 'Pause refunds committed Kindle');
    cases.push({ name: 'focus-pause-refund', releases: game.ultsReleased, refunded: true });

    let hidden = false;
    replace(document, 'hidden', { get: () => hidden });
    replace(document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
    function visibility(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); }
    fresh(); steer(); press('kindle', 3);
    visibility(true);
    check(game.paused && !touch.active && !buttons.kindleHeld, 'Hidden event pauses Game and clears held touch');
    const hiddenTime = game.time;
    frame(1000); near(game.time, hiddenTime, 'Hidden Game cannot advance world');
    now += 900000; clock.nowMs = now; visibility(false);
    check(loop.accumulator === 0 && loop.last === now, 'Visible event uses shared zero-backlog reset');
    const returnedTicks = frame(5);
    check(returnedTicks === 0 && game.paused, 'Visible return has no giant catch-up or implicit resume');
    cases.push({ name: 'visibility-return', hiddenGameTime: hiddenTime, firstReturnTicks: returnedTicks });

    // A real terminal path must settle exclusively in injected memory.
    fresh();
    const writesBeforeDeath = memory.writes, runsBeforeDeath = game.saveSystem.data.stats.runs;
    game.player.coins = 137; game.player.hp = 0;
    frame(20);
    await new Promise(resolve => setTimeout(resolve, 0));
    check(game.gameOver && game.screen === 'gameOver' && game._runRecorded, 'Actual death reaches terminal settlement');
    check(memory.writes > writesBeforeDeath && game.saveSystem.data.stats.runs === runsBeforeDeath + 1, 'Death records only in memory');
    const deathTime = game.time, deathAge = game.gameOverAge, deathTicks = frame();
    near(game.time, deathTime, 'Game-over freezes world time');
    near(game.gameOverAge, deathAge + deathTicks / 60, 'Game-over UI age still advances');
    cases.push({ name: 'death-memory-settlement', writes: memory.writes - writesBeforeDeath, runsAdded: 1 });

    fresh();
    if (disposalMode === 'paused') game.togglePause();
    if (disposalMode === 'hidden') visibility(true);
    if (disposalMode === 'touch') { steer(); press('kindle', 3); }
    if (disposalMode === 'modal') game.chestReward = { age: 0 };
    const profileBeforeDispose = JSON.stringify(game.saveSystem.data), writesBeforeDispose = memory.writes;
    const liveBefore = state.simulation.updateCalls;
    let disposal;
    if (disposalMode === 'catchup') {
        let caught = 0;
        const update = loop.update;
        loop.update = dt => { update(dt); if (++caught === 2) disposal = runtime.dispose(); };
        frame(1000);
        check(caught === 2 && state.simulation.updateCalls - liveBefore === 2, 'Dispose inside catch-up stops remaining fixed updates');
    } else disposal = runtime.dispose();
    check(runtime.dispose() === disposal, 'Repeated disposal joins the exact owned cleanup task');
    await disposal;
    const disposedUpdates = state.simulation.updateCalls;
    const retainedCanvas = renderer.canvas;
    key('Enter'); key('KeyD'); key('Space'); key('KeyP'); key('KeyQ');
    const event = new Event('touchstart');
    Object.defineProperty(event, 'changedTouches', { value: eventAt(350, 750, 9).changedTouches });
    retainedCanvas.dispatchEvent(event);
    loop.processFrame(now + 900000); loop._tick(now + 900000);
    runtime.beforeFrame(now + 900000); visibility(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    runtime.snapshot();
    check(state.simulation.updateCalls === disposedUpdates, 'Disposed callbacks cannot advance the simulation');
    check(JSON.stringify(game.saveSystem.data) === profileBeforeDispose && memory.writes === writesBeforeDispose, 'Disposal or stale input cannot settle/reward/write');
    check(keyboard.keys.size === 0 && !touch.active && !buttons.kindleHeld && !buttons.blinkTap, 'All held input is cleared after disposal');
    check(state.lifetime.activeGameCount === 0 && state.lifetime.canvasCount === 0 && state.lifetime.sceneCount === 0
        && state.lifetime.textureCount === 0 && state.lifetime.shellListeners === 0 && state.lifetime.ownedSaveParticipants === 0,
        'Disposed runtime has no retained Game, canvas, scene, texture, listener or participant');
    check(!loop.running && loop._frameId === null && !runtime.phaser.loop.running && !runtime.phaser.loop.raf,
        'Neither scheduler resurrects after disposal');
    check(nativeStorage === 0 && nativeLocks === 0 && errors.length === 0, 'Behavior fixtures have no host access or exceptions');
    const result = { passed: true, host: 'actual-phaser-4.2.1-shared-external-GameLoop', checks, cases,
        disposalMode, maxSteps, backend: state.renderer.identity, simulationConnected: state.boot.simulationConnected,
        hostStorageAccesses: nativeStorage, hostLockAccesses: nativeLocks,
        disposed: JSON.parse(JSON.stringify(state.lifetime)), errors,
        limitations: ['DOM visibility is a synthetic Page Visibility event characterization.',
            'Action handlers and synthetic keyboard events are not trusted OS/mobile dispatch.',
            'Overlay freeze fixtures set existing modal state; visual/menu acceptance is a separate gate.'] };
    const output = document.createElement('script'); output.id = 'phaser-behavior-receipt'; output.type = 'application/json';
    output.textContent = JSON.stringify(result); document.body.append(output);
    document.title = `PHASER BEHAVIOR PASS ${disposalMode} CHECKS:${checks} EXC:${errors.length}`;
}

boot().catch(error => {
    document.title = `BOOTFAIL ${error.stack || error}`;
    document.body.dataset.error = String(error.stack || error);
}).finally(async () => {
    await runtime?.dispose(); rng?.restore();
    for (const restore of originals.reverse()) restore();
    document.documentElement.dataset.qaReady = '1';
});
