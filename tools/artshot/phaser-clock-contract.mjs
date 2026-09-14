// TEST ONLY. Differentially execute the immutable pre-PR4 production loop and
// the current loop. This is a helper for the single PR4 top-level validator.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GameLoop } from '../../src/core/GameLoop.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = '5e0881f47448bfa108021baad987c54f72ff8b98';

function realm() {
    const originals = new Map();
    const replace = (key, value) => {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    };
    const listeners = new Set();
    const pending = new Map();
    const errors = [];
    const state = { now: 0, requested: 0, cancelled: 0 };
    const document = {
        hidden: false,
        addEventListener(type, callback) {
            assert.equal(type, 'visibilitychange');
            listeners.add(callback);
        },
        removeEventListener(type, callback) {
            assert.equal(type, 'visibilitychange');
            listeners.delete(callback);
        },
        visibility(hidden, now) {
            this.hidden = hidden;
            state.now = now;
            for (const callback of [...listeners]) callback();
        },
    };
    replace('document', document);
    replace('performance', { now: () => state.now });
    replace('requestAnimationFrame', callback => {
        const id = ++state.requested;
        pending.set(id, callback);
        return id;
    });
    replace('cancelAnimationFrame', id => {
        state.cancelled++;
        pending.delete(id);
    });
    const error = console.error;
    console.error = (...args) => errors.push(args.map(value => value instanceof Error ? value.message : value));
    return { state, document, listeners, pending, errors,
        restore() {
            console.error = error;
            for (const [key, descriptor] of originals) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else delete globalThis[key];
            }
        } };
}

function exercise(Loop, scenario, external = false) {
    const env = realm();
    const updates = [], renders = [], profile = [], trace = [];
    let loop;
    let updateFault = false, renderFault = false;
    const profiler = id => ({
        begin: phase => profile.push([id, 'begin', phase]),
        end: phase => profile.push([id, 'end', phase]),
        frame: () => profile.push([id, 'frame']),
    });
    const take = () => ({
        accumulator: loop.accumulator, last: loop.last, running: loop.running,
        fps: loop.fps, fpsAccum: loop._fpsAccum, fpsFrames: loop._fpsFrames,
        updates: updates.length, renders: renders.length,
        update: updates.at(-1) ?? null, alpha: renders.at(-1) ?? null,
    });
    try {
        loop = new Loop({ ...scenario.options,
            update(dt) {
                updates.push(dt);
                if (scenario.update === 'throw' && !updateFault) {
                    updateFault = true;
                    throw new Error('injected update failure');
                }
                if (updates.length !== 2) return;
                if (scenario.update === 'stop') loop.stop();
                if (scenario.update === 'dispose') loop.dispose();
                if (scenario.update === 'replace-profiler') loop.profiler = profiler('next');
                if (scenario.update === 'restart') { loop.stop(); loop.start(); }
            },
            render(alpha) {
                renders.push(alpha);
                if (scenario.render === 'throw' && !renderFault) {
                    renderFault = true;
                    throw new Error('injected render failure');
                }
                if (renders.length !== 2) return;
                if (scenario.render === 'stop') loop.stop();
                if (scenario.render === 'dispose') loop.dispose();
            },
        });
        loop.profiler = profiler('initial');
        if (external) loop.startExternal(0);
        else loop.start();
        if (scenario.backlog !== undefined) loop.accumulator = scenario.backlog;
        const retainedCallback = loop._tick;
        for (const action of scenario.actions) {
            if (action.visibility !== undefined) {
                env.document.visibility(action.visibility, action.at);
            } else {
                env.state.now = action.at;
                if (external) loop.renderFrame(loop.processFrame(action.at));
                else {
                    const entry = env.pending.entries().next().value;
                    if (entry) {
                        env.pending.delete(entry[0]);
                        entry[1](action.at);
                    }
                }
            }
            trace.push(take());
        }
        const beforeDispose = take();
        loop.dispose(); loop.dispose();
        retainedCallback(1000000);
        env.document.visibility(false, 2000000);
        assert.equal(env.pending.size, 0, `${scenario.name}: no residual RAF`);
        assert.equal(env.listeners.size, 0, `${scenario.name}: no residual visibility listener`);
        return {
            semantic: { trace, updates, renders, profile, errors: env.errors, beforeDispose,
                disposed: loop._disposed, finalAccumulator: loop.accumulator, finalLast: loop.last },
            lifecycle: { requested: env.state.requested, cancelled: env.state.cancelled,
                pending: env.pending.size, listeners: env.listeners.size },
        };
    } finally { loop?.dispose(); env.restore(); }
}

function cadenceActions(hz, seconds = 3) {
    return Array.from({ length: hz * seconds }, (_, index) => ({ at: (index + 1) * 1000 / hz }));
}

const SCENARIOS = [
    ...[30, 60, 120].map(hz => ({ name: `${hz} Hz production`, actions: cadenceActions(hz) })),
    { name: 'irregular raw timestamps and retained remainder', actions: [1, 8, 13, 27, 35, 67, 82, 105, 499, 512, 701].map(at => ({ at })) },
    { name: 'one-second stalled frame clamps at 0.1', actions: [5, 1005, 1022, 1039].map(at => ({ at })) },
    { name: 'hard eight-step cap retains backlog', backlog: 0.3 + 1 / 600,
        actions: [0, 5, 20, 41].map(at => ({ at })) },
    { name: 'constructor timing overrides preserve hard cap', options: { fixedDt: 1 / 120, maxFrameDt: 0.1 },
        actions: [1000, 1001, 1002].map(at => ({ at })) },
    { name: 'visibility resets visible clock only', actions: [
        { at: 10 }, { visibility: true, at: 20 }, { visibility: false, at: 900000 },
        { at: 900005 }, { at: 900017 }, { at: 900034 },
    ] },
    { name: 'raw zero and negative intervals are not normalized', actions: [20, 20, 19, 33, 52].map(at => ({ at })) },
    ...['stop', 'dispose', 'replace-profiler', 'restart', 'throw'].map(update => ({
        name: `update ${update}`, update, actions: [50, 67, 84, 102].map(at => ({ at })),
    })),
    ...['stop', 'dispose', 'throw'].map(render => ({
        name: `render ${render}`, render, actions: [20, 40, 60, 80].map(at => ({ at })),
    })),
];

// A bounded deterministic simulation, not a claim of Phaser-hosted Game parity
// or trusted input coverage. Its tick-indexed action must be drained once while
// movement remains held across fixed updates, including stalled-frame catch-up.
function cadenceState(hz) {
    const env = realm();
    const state = { ticks: 0, distance: 0, actionCount: 0, heldTicks: 0 };
    let pendingAction = false;
    let maxSteps = 0;
    let frameCount = 0;
    let now = 0;
    let loop;
    try {
        loop = new GameLoop({ update(dt) {
            assert.equal(dt, 1 / 60);
            if (state.ticks === 20) pendingAction = true;
            if (pendingAction) { pendingAction = false; state.actionCount++; }
            if (state.ticks < 100) { state.distance += 200 * dt; state.heldTicks++; }
            state.ticks++;
            if (state.ticks === 180) loop.stop();
        }, render() {} });
        loop.startExternal(0);
        while (loop.running) {
            if (++frameCount > hz * 5) throw new Error('cadence failed to terminate');
            const before = state.ticks;
            now += frameCount === 9 ? 1000 : 1000 / hz;
            loop.renderFrame(loop.processFrame(now));
            maxSteps = Math.max(maxSteps, state.ticks - before);
        }
        assert.equal(env.state.requested, 0);
        assert.ok(maxSteps <= 8);
        assert.equal(state.actionCount, 1);
        assert.equal(state.heldTicks, 100);
        return { state, frameCount, maxSteps, rafRequests: env.state.requested };
    } finally { loop?.dispose(); env.restore(); }
}

export async function verifyPhaserClockContract() {
    let checks = 0;
    const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
    const ok = (value, message) => { assert.ok(value, message); checks++; };
    const original = execFileSync('git', ['show', `${BASE}:src/core/GameLoop.js`], { cwd: ROOT, encoding: 'utf8' });
    const specifier = pathToFileURL(resolve(ROOT, 'src/config/GameConfig.js')).href;
    const oldModule = original.replace("'../config/GameConfig.js'", JSON.stringify(specifier));
    const { GameLoop: BeforeLoop } = await import(`data:text/javascript;base64,${Buffer.from(oldModule).toString('base64')}`);
    const production = [];
    const external = [];
    for (const scenario of SCENARIOS) {
        const before = exercise(BeforeLoop, scenario);
        const after = exercise(GameLoop, scenario);
        same(after, before, `${scenario.name}: exact pre-PR4 production behavior`);
        production.push(scenario.name);
        if (scenario.update === 'restart' || scenario.update === 'throw' || scenario.render === 'throw') continue;
        const hosted = exercise(GameLoop, scenario, true);
        same(hosted.semantic, before.semantic, `${scenario.name}: external and production frame policies agree`);
        same(hosted.lifecycle.requested, 0, `${scenario.name}: external path requests zero RAFs`);
        external.push(scenario.name);
    }

    const backlog = exercise(GameLoop, SCENARIOS.find(scenario => scenario.backlog !== undefined), true);
    same(backlog.semantic.trace[0].updates, 8, 'retained backlog reaches, never exceeds, the hard eight-update cap');
    ok(backlog.semantic.trace[0].accumulator > 0.16, 'unprocessed backlog is retained, not discarded');
    const stalled = exercise(GameLoop, SCENARIOS.find(scenario => scenario.name.startsWith('one-second')), true);
    same(stalled.semantic.trace[1].updates, 6, 'five-ms remainder plus clamped one-second stall performs six updates');
    ok(stalled.semantic.trace[1].accumulator > 0.004 && stalled.semantic.trace[1].accumulator < 0.006,
        'clamped frame retains its five-ms remainder');
    const visible = exercise(GameLoop, SCENARIOS.find(scenario => scenario.name.startsWith('visibility')), true);
    same(visible.semantic.trace[1].accumulator, 0.01, 'hidden event does not invent a new clock policy');
    same(visible.semantic.trace[2].accumulator, 0, 'visible event discards old partial backlog');
    same(visible.semantic.trace[3].updates, 0, '900-second return gap does not trigger catch-up');

    const cadences = [30, 60, 120].map(hz => ({ hz, ...cadenceState(hz) }));
    for (const result of cadences) same(result.state, cadences[0].state, `${result.hz} Hz fixed-step action/cadence equivalence`);

    const env = realm();
    let loop;
    try {
        let updates = 0, renders = 0;
        loop = new GameLoop({ update() { updates++; }, render() { renders++; } });
        same(loop.processFrame(100), null, 'inactive external process is a no-op');
        loop.startExternal(100);
        loop.start(); loop.startExternal(200);
        same([loop.scheduler, loop.last, env.state.requested], ['external', 100, 0], 'an active external owner cannot acquire production RAF');
        loop._tick(200);
        same(updates, 0, 'a retained RAF callback cannot drive external mode');
        const token = loop.processFrame(120);
        same(updates, 1, 'processFrame updates fixed simulation');
        same(renders, 0, 'processFrame does not render before the host world surface');
        loop.renderFrame(token);
        same(renders, 1, 'renderFrame is an explicit after-world presentation boundary');
        loop.resetClock(5000);
        same([loop.last, loop.accumulator], [5000, 0], 'explicit host resume uses the shared reset');
        loop.stop();
        loop.renderFrame(token);
        same(renders, 1, 'stopped frame token cannot render');
        same(loop.processFrame(6000), null, 'stopped external process is a no-op');
        loop.start();
        loop.startExternal(7000);
        same([loop.scheduler, env.pending.size], ['raf', 1], 'an active production owner cannot acquire external scheduling');
        loop.dispose(); loop.start(); loop.startExternal(8000); loop.resetClock(9000);
        same([loop.running, loop.scheduler, env.pending.size, env.listeners.size], [false, null, 0, 0], 'disposed loop cannot resurrect either scheduler');
        same(loop.processFrame(10000), null, 'disposed process is a no-op');
    } finally { loop?.dispose(); env.restore(); }

    const faultEnv = realm();
    let faultLoop;
    try {
        faultLoop = new GameLoop({ update() { throw new Error('external update failure'); }, render() {} });
        faultLoop.startExternal(0);
        assert.throws(() => faultLoop.processFrame(20), /external update failure/); checks++;
        same(faultEnv.errors.length, 0, 'external failure propagates to its host instead of being swallowed');
        same(faultEnv.state.requested, 0, 'external failure cannot create a recovery RAF');
    } finally { faultLoop?.dispose(); faultEnv.restore(); }

    return { passed: true, checks, originalMain: BASE,
        productionDifferentialCases: production, externalDifferentialCases: external,
        cadences, maxCatchUpUpdates: 8, stalledFrameUpdates: 6,
        hostRafRequests: 0, visibilityReturnUpdates: 0 };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const result = await verifyPhaserClockContract();
    console.log(JSON.stringify(result, null, 2));
}
