// Dedicated fresh-realm test. Uses the real runtime/Game/Phaser.Game.step bridge;
// PR1 clock, scenarios, receipt builder, comparator and goldens are untouched.
import { TestClock, installDeterministicGlobals } from './migration-clock.mjs';
import { getScenario } from './scenarios.mjs';
import { buildSemanticReceipt, compareReceipts } from './migration-receipt.mjs';
import { MemoryStorage } from '../../src/platform/MemoryStorage.js';

const errors = [];
addEventListener('error', e => errors.push(String(e.message)));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const require = (condition, message) => { if (!condition) throw new Error(message); };
const state = {
    expectedPinnedVersion: '4.2.1', renderer: {}, boot: {}, storage: {}, locks: {}, lifetime: {},
    simulation: { updateCalls: 0, renderCalls: 0 }, pixels: {},
    errors: { contextLossCount: 0, contextRestoreCount: 0, webglErrorCount: 0 }, measurements: {},
};
let runtime, rng, nativeReads = 0, nativeLocks = 0, engineImport = true;
const memory = new MemoryStorage();
const ownStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
const ownLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
Object.defineProperty(window, 'localStorage', { configurable: true, get() {
    if (engineImport) return memory;
    nativeReads++; throw new Error('host storage access');
} });
Object.defineProperty(navigator, 'locks', { configurable: true, get() { nativeLocks++; throw new Error('host locks access'); } });

async function boot() {
    const params = new URLSearchParams(location.search);
    params.set('skipOnboarding', '1'); params.delete('dev');
    history.replaceState(null, '', `${location.pathname}?${params}`);
    const scenario = getScenario(params.get('scenario') || 'normal-desktop');
    const cadence = Number(params.get('cadence') || 60);
    require([30, 60, 120].includes(cadence), 'Unsupported cadence');
    await import('../../src/vendor/phaser/4.2.1/phaser.esm.min.js');
    engineImport = false;
    const { PhaserRuntime } = await import('../../src/phaser/PhaserRuntime.js');
    const clock = new TestClock(scenario.actions);
    let receipt, frames = 0, maxSteps = 0, finalAccumulator = 0;
    runtime = new PhaserRuntime({ stage: document.getElementById('stage'), state, memory,
        publish: () => { runtime?.snapshot(); return JSON.parse(JSON.stringify(state)); },
        onFailure: reason => { throw new Error(reason); },
        beforeSimulation: host => {
            // Phaser finished booting first: its capability/random probes cannot
            // consume the deterministic stream used by the real Game fixture.
            host.phaser.loop.stop();
            host.presentationEnabled = false;
            rng = installDeterministicGlobals(scenario.seed, clock);
        },
        prepareInput: host => {
            host.touch.supported = host.buttons.supported = !!scenario.touch;
            host.input.setModality(scenario.touch ? 'touch' : 'keyboard');
        },
        onSimulation: async host => {
            const { game, input, touch, buttons, keyboard, renderer, loop } = host;
            const { Enemy } = await import('../../src/entities/Enemy.js');
            await game.saveSystem.whenSaveParticipationReady();
            game._startRun({ campaignEligible: true });
            require(game._heroId === scenario.hero && game._effectiveMapId() === scenario.map && game.difficulty === scenario.difficulty, 'Unexpected fresh profile');
            if (scenario.invulnerable) game.player.damageTakenMul = 0;
            if (scenario.kindleReady) game.kindleSystem.fill = game.kindleSystem.ultCost;
            const pack = (scenario.enemies || []).map(e => new Enemy(e.type, game.player.x + e.dx, game.player.y + e.dy));
            game.enemies.push(...pack);
            const initialHp = pack.map(e => e.hp);
            const observations = { startPosition: { x: game.player.x, y: game.player.y }, actions: [],
                maxPlayerProjectiles: 0, controlledPackDamaged: 0, bossWarningTick: null,
                firstBossWarningId: null, bossSpawnTick: null, firstBossId: null,
                firstBossProvenance: null, modalChoices: 0 };
            function eventAt(x, y, identifier) {
                const o = renderer.clientToInternal(0, 0), ex = renderer.clientToInternal(1, 0), ey = renderer.clientToInternal(0, 1);
                const a = ex.x - o.x, b = ey.x - o.x, c = ex.y - o.y, d = ey.y - o.y, det = a * d - b * c;
                require(Number.isFinite(det) && det !== 0, 'Invalid input mapping');
                return { preventDefault() {}, changedTouches: [{ identifier,
                    clientX: ((x - o.x) * d - b * (y - o.y)) / det,
                    clientY: (a * (y - o.y) - (x - o.x) * c) / det }] };
            }
            function apply(action) {
                const { action: name, x, y } = action;
                observations.actions.push({ ...action });
                if (name === 'move') {
                    if (scenario.touch) {
                        if (!x && !y) touch._handleEnd(eventAt(350, 750, 1));
                        else {
                            if (!touch.active) touch._handleStart(eventAt(350, 750, 1));
                            touch._handleMove(eventAt(touch.origin.x + x * touch.maxRadius, touch.origin.y + y * touch.maxRadius, 1));
                        }
                    } else {
                        keyboard.keys.clear();
                        if (x > 0) keyboard.keys.add('KeyD'); if (x < 0) keyboard.keys.add('KeyA');
                        if (y > 0) keyboard.keys.add('KeyS'); if (y < 0) keyboard.keys.add('KeyW');
                    }
                } else {
                    const layout = buttons.layout();
                    if (name === 'blink') {
                        buttons._handleStart(eventAt(layout.blink.x, layout.blink.y, 2));
                        buttons._handleEnd(eventAt(layout.blink.x, layout.blink.y, 2));
                    } else if (name === 'kindlePress') buttons._handleStart(eventAt(layout.kindle.x, layout.kindle.y, 3));
                    else if (name === 'kindleRelease') buttons._handleEnd(eventAt(layout.kindle.x, layout.kindle.y, 3));
                    else throw new Error(`Unknown action ${name}`);
                }
            }
            const update = loop.update;
            loop.update = dt => {
                require(dt === 1 / 60, 'Variable simulation dt');
                clock.timeline.dispatch(clock.ticks, clock, apply);
                clock.nowMs = (clock.ticks + 1) * 1000 / 60;
                update(dt);
                observations.maxPlayerProjectiles = Math.max(observations.maxPlayerProjectiles, game.projectiles.length);
                if (game.bossWarning && observations.bossWarningTick === null) {
                    observations.bossWarningTick = clock.ticks + 1; observations.firstBossWarningId = game.bossWarning.id;
                }
                const boss = game.enemies.find(e => e.boss && e.active === true);
                if (boss && observations.bossSpawnTick === null) {
                    observations.bossSpawnTick = clock.ticks + 1; observations.firstBossId = boss.type;
                    observations.firstBossProvenance = boss.bossSpawnProvenance ?? null;
                }
                if (scenario.resolveChoices === 'first') {
                    if (game.upgradeChoices) { game.selectUpgrade(0); observations.modalChoices++; }
                    if (game.chestReward) { game._dismissChestReward(); observations.modalChoices++; }
                    if (game.altar) { game.selectAltar(0); observations.modalChoices++; }
                }
                clock.ticks++;
                if (clock.ticks === scenario.ticks) loop.stop();
            };
            loop.resetClock(0);
            let timestamp = 0;
            while (clock.ticks < scenario.ticks) {
                timestamp += params.has('stall') && frames === 10 ? 1000 : 1000 / cadence;
                const before = clock.ticks;
                // Actual pinned Phaser lifecycle dispatches PRE_STEP -> shared
                // accumulator -> Scene render -> POST_RENDER. No direct Game tick.
                host.phaser.step(timestamp, 987654);
                maxSteps = Math.max(maxSteps, clock.ticks - before);
                frames++;
                require(frames < scenario.ticks * 3 + 20 && maxSteps <= 8, 'Scheduler failed');
            }
            finalAccumulator = loop.accumulator;
            observations.controlledPackDamaged = pack.filter((e, i) => e.hp < initialHp[i]).length;
            observations.rngCallsBeforeRender = rng.calls;
            observations.actionsConsumed = clock.timeline.cursor;
            observations.blinks = game.blinks; observations.ultsReleased = game.ultsReleased;
            clock.visualTimeMs = clock.nowMs;
            observations.renderOnly = clock.renderFrame(game, () => game.render());
            observations.rngCallsAfterRender = rng.calls;
            await new Promise(resolve => setTimeout(resolve, 0));
            receipt = buildSemanticReceipt({ game, scenario, seed: scenario.seed, clock, errors, observations,
                environment: { kind: 'browser-assets', storage: 'memory-only', audio: 'disabled', locks: 'disabled',
                    viewport: [innerWidth, innerHeight], renderSchedule: 'final-only', storageWrites: memory.writes } });
            require(input === game.input && state.lifetime.activeGameCount <= 1, 'One input/Game owner');
        },
    });
    await runtime.boot();
    const authority = await (await fetch(`../../docs/evidence/phaser-migration/${scenario.id}.json`)).json();
    const differences = compareReceipts(authority.browser.receipt, receipt);
    require(differences.length === 0, `PHASER SEMANTIC MISMATCH: ${JSON.stringify(differences)}`);
    runtime.snapshot();
    const live = JSON.parse(JSON.stringify(state));
    require(nativeReads === 0 && nativeLocks === 0, 'Persistence escaped memory');
    require(state.boot.simulationConnected && state.simulation.updateCalls === scenario.ticks, 'Not Phaser-hosted');
    await runtime.dispose();
    const result = { host: 'actual-phaser-4.2.1-shared-external-GameLoop', scenario: scenario.id, cadence,
        frames, maxSteps, finalAccumulator, parity: 'PASS', semantic: receipt, live,
        disposed: JSON.parse(JSON.stringify(state.lifetime)), hostStorageAccesses: nativeReads, hostLockAccesses: nativeLocks };
    require(result.disposed.activeGameCount === 0 && result.disposed.canvasCount === 0 && result.disposed.shellListeners === 0, 'Lifetime leak');
    const output = document.createElement('script'); output.id = 'phaser-simulation-receipt'; output.type = 'application/json';
    output.textContent = JSON.stringify(result); document.body.append(output);
    document.title = `PHASER PARITY ${scenario.id} ${cadence}Hz TICKS:${clock.ticks} EXC:${errors.length}`;
}
boot().catch(error => {
    document.title = `BOOTFAIL ${error.stack || error}`;
    document.body.dataset.error = String(error.stack || error);
}).finally(async () => {
    await runtime?.dispose(); rng?.restore();
    if (ownStorage) Object.defineProperty(window, 'localStorage', ownStorage); else delete window.localStorage;
    if (ownLocks) Object.defineProperty(navigator, 'locks', ownLocks); else delete navigator.locks;
    document.documentElement.dataset.qaReady = '1';
});
