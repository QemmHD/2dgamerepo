#!/usr/bin/env node
// Ruin Bell / House V2 vertical-slice gate.
//
// The lifecycle tests consume the real deterministic director and authored
// contract. The integration tests invoke the exported Game update/render
// methods against small headless fixtures, so this gate catches broken seams
// without needing a DOM, a browser, or a second copy of encounter logic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { EMBERWOOD_RUIN_BELL_CABIN } from '../src/content/houseBlueprints.js';
import {
    RUIN_BELL_CONTRACT,
    RUIN_BELL_STAGES,
    ruinBellMemberCount,
} from '../src/content/ruinBell.js';
import { RuinBellDirector } from '../src/systems/RuinBellDirector.js';
import {
    RUIN_BELL_EVENT,
    RUIN_BELL_MUSIC_EVENTS,
    BIOME_COMPOSITIONS,
    resolveRuinBellMusicCue,
} from '../src/content/music.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import {
    buildUIState,
    ruinBellObjectiveSnapshot,
} from '../src/systems/UIStateBuilder.js';
import { GameUpdateMethods } from '../src/core/GameUpdate.js';
import { GameRenderMethods } from '../src/core/GameRender.js';
import { CombatResolverMethods } from '../src/core/CombatResolver.js';
import { ruinBellRenderer } from '../src/render/RuinBellRenderer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRUCTURE = Object.freeze({
    id: 'qa-last-wick-cabin',
    x: 2000,
    y: 1000,
    state: 'intact',
    blueprintId: EMBERWOOD_RUIN_BELL_CABIN.id,
    blueprint: EMBERWOOD_RUIN_BELL_CABIN,
});
const BASE_CONTEXT = Object.freeze({
    screen: 'gameplay',
    waveIndex: RUIN_BELL_CONTRACT.limits.unlockWaveIndex,
    playerInRange: false,
    playerInDefenseRange: true,
    includeDiagnostics: true,
});

let checks = 0;
const failures = [];
const sections = [];

function check(condition, message) {
    checks++;
    if (!condition) failures.push(message);
    return !!condition;
}

function equal(actual, expected, message) {
    return check(Object.is(actual, expected), `${message}: expected ${expected}, got ${actual}`);
}

function deepEqual(actual, expected, message) {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    return check(left === right, `${message}: expected ${right}, got ${left}`);
}

function close(actual, expected, epsilon, message) {
    return check(Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
        `${message}: expected ${expected} (+/-${epsilon}), got ${actual}`);
}

async function section(name, fn) {
    const beforeChecks = checks;
    const beforeFailures = failures.length;
    const started = performance.now();
    try {
        await fn();
    } catch (error) {
        failures.push(`${name}: unexpected exception: ${error?.stack || error}`);
    }
    sections.push({
        name,
        checks: checks - beforeChecks,
        failures: failures.length - beforeFailures,
        ms: performance.now() - started,
    });
}

function context(extra = null) {
    return { ...BASE_CONTEXT, ...(extra || {}) };
}

function makeDirector(waveIndex = RUIN_BELL_CONTRACT.limits.unlockWaveIndex, seed = 424242) {
    return new RuinBellDirector({
        runSeed: seed,
        waveIndex,
        structure: STRUCTURE,
        blueprint: EMBERWOOD_RUIN_BELL_CABIN,
    });
}

function eventOf(output, type) {
    return output?.events?.find((event) => event.type === type) || null;
}

function beginAttempt(director, verifyDwell = false) {
    const dwell = RUIN_BELL_CONTRACT.limits.dwellSeconds;
    const first = Math.max(0, dwell - 0.001);
    const before = director.update(first, context({ playerInRange: true }));
    if (verifyDwell) {
        check(!eventOf(before, 'ruin-bell-started'), 'encounter started before the complete dwell');
        equal(before.snapshot.phase, 'arming', 'partial dwell must remain arming');
        close(before.snapshot.activation.seconds, first, 0.0001, 'partial dwell clock');
    }
    const started = director.update(dwell - first, context({ playerInRange: true }));
    check(!!eventOf(started, 'ruin-bell-started'), 'complete dwell did not start encounter');
    equal(started.snapshot.phase, 'warning', 'complete dwell must enter warning');
    return started;
}

function advanceToRequest(director, scheduledAt) {
    const current = director.getSnapshot().eventElapsed;
    check(scheduledAt >= current, `cannot advance backwards from ${current} to ${scheduledAt}`);
    const output = director.update(scheduledAt - current, context());
    const request = output.spawnRequests?.[0] || null;
    check(!!request, `missing spawn request at ${scheduledAt}s`);
    if (request) {
        close(request.issuedAt, scheduledAt, 0.0001, `request ${request.stageId} issued time`);
        close(request.scheduledAt, scheduledAt, 0.0001, `request ${request.stageId} authored time`);
        check(request.allOrNone === true, `${request.stageId} must be all-or-none`);
        equal(request.requiredCount, request.units.length, `${request.stageId} required count`);
        deepEqual(request.requiredMemberIds, request.units.map((unit) => unit.memberId),
            `${request.stageId} request manifest order`);
    }
    return { output, request };
}

function acknowledgeExact(director, request) {
    check(director.acknowledgeWave(
        request.requestId,
        [...request.requiredMemberIds].reverse(),
    ), `${request.stageId} exact acknowledgement was rejected`);
    const output = director.update(0, context());
    const event = eventOf(output, 'ruin-bell-wave-spawned');
    check(!!event, `${request.stageId} exact acknowledgement did not emit wave-spawned`);
    equal(event?.count, request.requiredCount, `${request.stageId} acknowledged count`);
    return output;
}

function acknowledgeAllStages(director) {
    const requests = [];
    for (const stage of RUIN_BELL_STAGES) {
        const { request } = advanceToRequest(director, stage.atSeconds);
        if (!request) break;
        requests.push(request);
        acknowledgeExact(director, request);
    }
    return requests;
}

function requestFixture(seed = 30303) {
    const director = makeDirector(RUIN_BELL_CONTRACT.limits.unlockWaveIndex, seed);
    beginAttempt(director);
    const { output, request } = advanceToRequest(director, RUIN_BELL_STAGES[0].atSeconds);
    return { director, output, request };
}

function completedRewardFixture(seed) {
    const director = makeDirector(RUIN_BELL_CONTRACT.limits.unlockWaveIndex, seed);
    beginAttempt(director);
    acknowledgeAllStages(director);
    const ids = director.getQASnapshot().members.alive;
    for (const id of ids) check(director.notifyDefeated(id), `reward fixture defeat rejected: ${id}`);
    const remaining = RUIN_BELL_CONTRACT.limits.earliestClearSeconds
        - director.getSnapshot().eventElapsed;
    const output = director.update(remaining, context());
    const event = eventOf(output, 'ruin-bell-cleared');
    check(!!event, `reward fixture ${seed} did not clear`);
    return { director, event };
}

function rewardRuntime(fixture) {
    const game = {
        ruinBellDirector: fixture.director,
        ruinBellStructure: STRUCTURE,
        obstacleSystem: { setStructureState: () => true },
        player: { x: STRUCTURE.x, y: STRUCTURE.y + 700, radius: 24 },
        chests: [],
        shrines: [],
        enemies: [],
        enemyProjectiles: [],
        hazards: [],
        pendingChests: 0,
        pendingAltars: 0,
        pendingCrossroads: false,
        chestReward: null,
        upgradeChoices: null,
        altar: null,
        victory: null,
        musicState: { intensity: 0, target: 0, scene: 'calm' },
        _ruinBellRewarded: false,
        _ruinBellMusicOrdinal: 0,
        _clearSpot: (x, y) => ({ x, y }),
        _grantVigilXp: () => {},
        _spawnRing: () => {},
        _shake: () => {},
        audio: {
            musicEvent: (_name, cue) => cue.caption,
            chest: () => {},
            shrineChime: () => {},
        },
        captionSystem: { sound: () => {} },
        accessibility: { announce: () => {} },
        waveDirector: { announce: () => {} },
        particles: { pickupSparkle: () => {} },
        haptics: { pulse: () => {} },
        _presentChest() {
            this.pendingChests = Math.max(0, this.pendingChests - 1);
            this.chestReward = { age: 0 };
        },
        _presentAltar() {
            this.pendingAltars = Math.max(0, this.pendingAltars - 1);
            this.altar = { age: 0 };
        },
        _presentCrossroads: () => {},
        _dropBossReward(x, y, placement) {
            return CombatResolverMethods._dropBossReward.call(this, x, y, placement);
        },
    };
    game._setRuinBellHouseState = (state) =>
        GameUpdateMethods._setRuinBellHouseState.call(game, state);
    game._retireRuinBellMembers = (memberIds) =>
        GameUpdateMethods._retireRuinBellMembers.call(game, memberIds);
    game._playRuinBellMusic = (eventName, semanticOverride = null) =>
        GameUpdateMethods._playRuinBellMusic.call(game, eventName, semanticOverride);
    game._claimRuinBellReward = (reward) =>
        GameUpdateMethods._claimRuinBellReward.call(game, reward);
    return game;
}

function gameSpawnFixture(overrides = {}) {
    const blocked = overrides.blocked === true;
    return {
        enemies: [],
        player: { x: STRUCTURE.x - 225, y: STRUCTURE.y - 150, radius: 24 },
        waveState: {
            maxAlive: overrides.maxAlive ?? 180,
            healthMul: 1.35,
            speedMul: 1.12,
            damageMul: 1.18,
            index: 3,
        },
        obstacleSystem: {
            isSpawnBlocked: () => blocked,
            isBlocked: () => blocked,
        },
        _clearSpot: (x, y) => ({ x, y }),
        waveDirector: { notifySpawn: () => {} },
    };
}

// Enemy/loot constructors resolve their cached procedural sprites lazily. A
// tiny no-op canvas is sufficient for headless contract tests: the validator
// inspects simulation objects and tags, never raster pixels.
function installHeadlessCanvas() {
    if (globalThis.document?.createElement) return;
    const makeCanvas = () => {
        const canvas = { width: 1, height: 1, style: {} };
        const gradient = () => ({ addColorStop: () => {} });
        const target = {
            canvas,
            createLinearGradient: gradient,
            createRadialGradient: gradient,
            createConicGradient: gradient,
            createPattern: () => ({ setTransform: () => {} }),
            measureText: (text) => ({ width: String(text || '').length * 8 }),
            getImageData: (_x, _y, w = canvas.width, h = canvas.height) => ({
                data: new Uint8ClampedArray(Math.max(0, Math.floor(w * h * 4))),
                width: w,
                height: h,
            }),
            createImageData: (w, h) => ({
                data: new Uint8ClampedArray(Math.max(0, Math.floor(w * h * 4))),
                width: w,
                height: h,
            }),
            isPointInPath: () => false,
            isPointInStroke: () => false,
        };
        const context2d = new Proxy(target, {
            get(object, property) {
                if (Reflect.has(object, property)) return Reflect.get(object, property);
                if (typeof property === 'symbol') return undefined;
                const noop = () => {};
                Reflect.set(object, property, noop);
                return noop;
            },
            set(object, property, value) {
                Reflect.set(object, property, value);
                return true;
            },
        });
        canvas.getContext = () => context2d;
        canvas.toDataURL = () => 'data:image/png;base64,';
        canvas.cloneNode = () => makeCanvas();
        return canvas;
    };
    globalThis.document = {
        createElement: (tag) => tag === 'canvas'
            ? makeCanvas()
            : { style: {}, appendChild: () => {}, remove: () => {} },
    };
}

function fakeCanvasContext() {
    const calls = [];
    const target = { calls };
    return new Proxy(target, {
        get(object, property) {
            if (Reflect.has(object, property)) return Reflect.get(object, property);
            if (typeof property === 'symbol') return undefined;
            const method = (...args) => { calls.push({ method: String(property), args }); };
            Reflect.set(object, property, method);
            return method;
        },
        set(object, property, value) {
            Reflect.set(object, property, value);
            return true;
        },
    });
}

await section('contract, unlock, dwell, and authored timeline', () => {
    equal(RUIN_BELL_CONTRACT.limits.unlockWaveIndex, 3, 'unlock wave');
    close(RUIN_BELL_CONTRACT.limits.dwellSeconds, 1.25, 0, 'activation dwell');
    close(RUIN_BELL_CONTRACT.limits.defendRadius, 460, 0, 'cabin defense radius');
    close(RUIN_BELL_CONTRACT.limits.graceOutsideSeconds, 6, 0, 'outside grace');
    close(RUIN_BELL_CONTRACT.limits.earliestClearSeconds, 45, 0, 'earliest clear');
    close(RUIN_BELL_CONTRACT.limits.timeoutSeconds, 60, 0, 'timeout');
    equal(RUIN_BELL_CONTRACT.limits.maxAttempts, 2, 'attempt count');
    equal(ruinBellMemberCount(), 11, 'authored member count');
    deepEqual(RUIN_BELL_STAGES.map((stage) => stage.atSeconds), [3.5, 17, 33],
        'authored spawn times');
    deepEqual(RUIN_BELL_STAGES.map((stage) => stage.units.length), [3, 4, 4],
        'authored wave sizes');
    check(Object.isFrozen(RUIN_BELL_CONTRACT) && Object.isFrozen(RUIN_BELL_STAGES),
        'contract and stage list must be frozen');

    const director = makeDirector(2);
    equal(director.getSnapshot().phase, 'locked', 'wave 2 phase');
    const stillLocked = director.update(5, context({ waveIndex: 2, playerInRange: true }));
    equal(stillLocked.snapshot.phase, 'locked', 'wave 2 cannot arm bell');
    check(!eventOf(stillLocked, 'ruin-bell-unlocked'), 'wave 2 emitted unlock event');

    const unlocked = director.update(0, context({ waveIndex: 3, playerInRange: false }));
    equal(unlocked.snapshot.phase, 'dormant', 'wave 3 unlock phase');
    check(!!eventOf(unlocked, 'ruin-bell-unlocked'), 'wave 3 did not emit unlock event');
    beginAttempt(director, true);

    const requests = acknowledgeAllStages(director);
    equal(requests.length, 3, 'spawn request count');
    equal(new Set(requests.flatMap((request) => request.requiredMemberIds)).size, 11,
        'stable member ids across the three waves');
    deepEqual(director.getQASnapshot().members.manifest,
        [...new Set(requests.flatMap((request) => request.requiredMemberIds))].sort(),
        'QA manifest must expose all stable member ids');
});

await section('truthful cabin boundary, grace, and projection cost', () => {
    const geometry = makeDirector(3, 1717);
    for (const room of EMBERWOOD_RUIN_BELL_CABIN.rooms) {
        check(geometry._playerInDefenseRange({
            player: { x: STRUCTURE.x + room.x, y: STRUCTURE.y + room.y },
        }), `defense zone excludes room ${room.id}`);
    }
    for (const door of EMBERWOOD_RUIN_BELL_CABIN.doors.filter((entry) => entry.kind === 'exterior')) {
        check(geometry._playerInDefenseRange({
            player: {
                x: STRUCTURE.x + door.x + door.normal.x * 100,
                y: STRUCTURE.y + door.y + door.normal.y * 100,
            },
        }), `defense zone excludes ${door.id} approach`);
    }
    check(!geometry._playerInDefenseRange({
        player: { x: STRUCTURE.x, y: STRUCTURE.y + 700 },
    }), 'defense zone accepts a far-away player');

    const restored = makeDirector(3, 1818);
    beginAttempt(restored);
    const warning = restored.update(2, context({ playerInDefenseRange: false }));
    check(!!eventOf(warning, 'ruin-bell-defense-warning'), 'leaving cabin emitted no warning');
    close(warning.snapshot.defense.graceRemaining, 4, 0.0001, 'outside grace countdown');
    equal(warning.guidance.countdownLabel, 'RETURN', 'outside guidance countdown label');
    check(warning.guidance.nextAction.includes('Return to the cabin'),
        'outside guidance does not tell the player how to recover');
    const recovered = restored.update(0, context({ playerInDefenseRange: true }));
    check(!!eventOf(recovered, 'ruin-bell-defense-restored'), 're-entry emitted no restore receipt');
    close(recovered.snapshot.defense.graceRemaining, 6, 0.0001, 'restored grace budget');

    const abandoned = makeDirector(3, 1919);
    beginAttempt(abandoned);
    const failed = abandoned.update(6, context({ playerInDefenseRange: false }));
    const failure = eventOf(failed, 'ruin-bell-failed');
    check(!!failure, 'six seconds outside did not consume the attempt');
    equal(failure?.reason, 'left-cabin', 'abandonment failure reason');
    equal(failed.snapshot.phase, 'retry-cooldown', 'abandonment retry phase');
    equal(failure?.reward, null, 'abandonment paid a reward');

    const leanOutput = makeDirector(3, 2020).update(0, context({ includeDiagnostics: false }));
    for (const projection of ['snapshot', 'guidance', 'render', 'qa']) {
        check(!Object.hasOwn(leanOutput, projection),
            `production update eagerly allocated ${projection}`);
    }
});

let completedFixture = null;
await section('earliest clear, duplicate defeat, and reward-once contract', () => {
    const director = makeDirector(3, 777);
    const started = beginAttempt(director);
    equal(eventOf(started, 'ruin-bell-started')?.houseState, 'lit',
        'first attempt start house state');
    acknowledgeAllStages(director);
    const ids = director.getQASnapshot().members.alive;
    equal(ids.length, 11, 'all members must be alive after three exact acknowledgements');
    check(director.notifyDefeated(ids[0]), 'first stable-id defeat was rejected');
    check(!director.notifyDefeated(ids[0]), 'duplicate stable-id defeat was accepted');
    for (const id of ids.slice(1)) check(director.notifyDefeated(id), `defeat rejected for ${id}`);
    equal(director.getQASnapshot().counters.duplicateDefeats, 1,
        'duplicate defeat counter');

    const preClear = director.update(44.999 - director.getSnapshot().eventElapsed, context());
    check(!eventOf(preClear, 'ruin-bell-cleared'), 'reward emitted before 45 seconds');
    equal(preClear.snapshot.phase, 'active', 'all defeated early must hold active phase');
    const clearOutput = director.update(0.001, context());
    const clear = eventOf(clearOutput, 'ruin-bell-cleared');
    check(!!clear, 'clear did not emit at 45 seconds');
    close(clear?.completedAt, 45, 0.0001, 'completion timestamp');
    equal(clear?.houseState, 'lit', 'first-attempt clear house state');
    equal(clear?.reward?.xp, 32, 'clear XP');
    equal(clear?.reward?.choice, 'chest-or-wick-shrine', 'clear choice');
    check(!Object.hasOwn(clear?.reward || {}, 'coins'), 'clear reward must not contain coins');
    equal(clear?.rewardOnce, true, 'clear event reward-once marker');

    const after = director.update(30, context({
        defeatedMemberIds: [...ids, ...ids],
    }));
    check(!eventOf(after, 'ruin-bell-cleared'), 'cleared director emitted a duplicate reward');
    equal(after.qa.counters.rewardsEmitted, 1, 'director reward emission count');
    completedFixture = { director, event: clear };
});

await section('exact acknowledgement and technical defer', () => {
    const { director, request } = requestFixture(9191);
    check(!!request, 'technical-defer fixture has no first request');
    if (!request) return;
    check(!director.acknowledgeWave('wrong-request', request.requiredMemberIds),
        'director accepted an acknowledgement for the wrong request');
    const partial = request.requiredMemberIds.slice(0, 1);
    check(director.acknowledgeWave(request.requestId, partial),
        'director rejected queued partial acknowledgement input');
    const deferred = director.update(0, context());
    const deferEvent = eventOf(deferred, 'ruin-bell-technical-defer');
    check(!!deferEvent, 'partial acknowledgement did not technically defer');
    deepEqual(deferEvent?.cleanupMemberIds, partial, 'technical-defer cleanup ids');
    equal(deferEvent?.attemptConsumed, false, 'technical defer attempt consumption');
    equal(deferred.snapshot.attempt, 1, 'technical defer attempt number');
    equal(deferred.snapshot.attemptsFailed, 0, 'technical defer failed-attempt count');
    equal(deferred.snapshot.phase, 'technical-defer', 'technical defer phase');
    close(deferred.snapshot.eventElapsed, 3.5, 0.0001,
        'technical defer must preserve event clock');

    const cooldown = RUIN_BELL_CONTRACT.limits.retryCooldownSeconds;
    const resumed = director.update(cooldown, context());
    equal(resumed.snapshot.phase, 'warning', 'technical defer resume phase');
    equal(resumed.snapshot.attempt, 1, 'technical defer resume attempt');
    const reissued = director.update(0, context()).spawnRequests?.[0];
    check(!!reissued, 'technically deferred request was not reissued');
    if (!reissued) return;
    check(reissued.requestId !== request.requestId, 'reissued request id was not fresh');
    deepEqual(reissued.requiredMemberIds, request.requiredMemberIds,
        'reissued request changed stable member ids');
    const acknowledged = acknowledgeExact(director, reissued);
    equal(acknowledged.snapshot.phase, 'active', 'exact reissue acknowledgement phase');
});

await section('large-step terminal outputs close the spawn lane', () => {
    const assertClosed = (director, output, label, terminalType) => {
        check(!!eventOf(output, terminalType), `${label} terminal event missing`);
        equal(output.spawnRequests?.length, 0, `${label} returned a terminal spawn request`);
        equal(director.getSnapshot().pendingRequest, null,
            `${label} left a pending request after terminal output`);
        check(!(output.events || []).some((event) => event.type === 'ruin-bell-wave-requested'),
            `${label} announced a wave after terminal truth`);
    };

    // Warning has no acknowledged bodies yet. The old ordering issued the
    // 3.5s request and then failed at 60s in this exact call.
    const warning = makeDirector(3, 91910);
    beginAttempt(warning);
    const warningTimeout = warning.update(60, context());
    assertClosed(warning, warningTimeout, 'warning +60s', 'ruin-bell-failed');

    // Active has a live first stage but no pending request. Crossing 17/33/60
    // in one step must fail and clean that stage, never issue stages two/three.
    const activeFixture = requestFixture(91911);
    acknowledgeExact(activeFixture.director, activeFixture.request);
    const activeTimeout = activeFixture.director.update(
        RUIN_BELL_CONTRACT.limits.timeoutSeconds
            - activeFixture.director.getSnapshot().eventElapsed,
        context(),
    );
    assertClosed(activeFixture.director, activeTimeout,
        'active timeout boundary', 'ruin-bell-failed');
    equal(eventOf(activeTimeout, 'ruin-bell-failed')?.cleanupMemberIds?.length,
        activeFixture.request.requiredCount,
        'active timeout cleanup did not own every acknowledged body');

    // Technical defer pauses the event clock and closes its request lane. A
    // large resume step and the later one-step timeout both remain request-free.
    const technicalFixture = requestFixture(91912);
    const partial = technicalFixture.request.requiredMemberIds.slice(0, 1);
    technicalFixture.director.acknowledgeWave(technicalFixture.request.requestId, partial);
    const technical = technicalFixture.director.update(0, context());
    equal(technical.spawnRequests?.length, 0,
        'technical-defer output retained a spawn request');
    equal(technicalFixture.director.getSnapshot().pendingRequest, null,
        'technical-defer output left a pending request');
    const technicalResume = technicalFixture.director.update(60, context());
    equal(technicalResume.spawnRequests?.length, 0,
        'technical large-step resume issued an orphan request');
    equal(technicalFixture.director.getSnapshot().pendingRequest, null,
        'technical large-step resume recreated a pending request');
    const technicalTimeout = technicalFixture.director.update(
        RUIN_BELL_CONTRACT.limits.timeoutSeconds
            - technicalFixture.director.getSnapshot().eventElapsed,
        context(),
    );
    assertClosed(technicalFixture.director, technicalTimeout,
        'post-technical timeout boundary', 'ruin-bell-failed');

    // Clear keeps precedence over timeout when every stable member is already
    // defeated, but still closes the spawn lane under a +60s catch-up.
    const cleared = makeDirector(3, 91913);
    beginAttempt(cleared);
    acknowledgeAllStages(cleared);
    for (const id of cleared.getQASnapshot().members.alive) cleared.notifyDefeated(id);
    const clearCatchUp = cleared.update(60, context());
    assertClosed(cleared, clearCatchUp, 'cleared +60s', 'ruin-bell-cleared');
});

let retryFixture = null;
await section('60-second failure and one stable-id retry', () => {
    const director = makeDirector(3, 818181);
    beginAttempt(director);
    const firstRequests = acknowledgeAllStages(director);
    const manifest = director.getQASnapshot().members.manifest;
    const failedOutput = director.update(
        RUIN_BELL_CONTRACT.limits.timeoutSeconds - director.getSnapshot().eventElapsed,
        context(),
    );
    const failed = eventOf(failedOutput, 'ruin-bell-failed');
    check(!!failed, 'first attempt did not fail at 60 seconds');
    close(failedOutput.snapshot.lastFailedAt, 60, 0.0001, 'first failure timestamp');
    equal(failed?.retryAvailable, true, 'first failure retry availability');
    equal(failed?.reward, null, 'failure reward');
    equal(failed?.houseState, 'damaged', 'first failure house state');
    equal(failedOutput.snapshot.phase, 'retry-cooldown', 'first failure phase');
    equal(failedOutput.snapshot.attemptsFailed, 1, 'first failure count');
    equal(failed?.cleanupMemberIds?.length, 11, 'first failure cleanup count');

    const cooldown = RUIN_BELL_CONTRACT.limits.retryCooldownSeconds;
    const notReady = director.update(cooldown - 0.01, context());
    equal(notReady.snapshot.phase, 'retry-cooldown', 'retry became ready early');
    const ready = director.update(0.011, context());
    equal(ready.snapshot.phase, 'dormant', 'retry-ready phase');
    equal(ready.snapshot.attempt, 2, 'retry attempt number');
    check(!!eventOf(ready, 'ruin-bell-retry-ready'), 'retry-ready event missing');
    deepEqual(ready.qa.members.manifest, manifest, 'retry changed stable manifest');

    const secondStarted = beginAttempt(director);
    equal(eventOf(secondStarted, 'ruin-bell-started')?.houseState, 'damaged',
        'second attempt start house state');
    const secondRequests = acknowledgeAllStages(director);
    deepEqual(
        secondRequests.flatMap((request) => request.requiredMemberIds),
        firstRequests.flatMap((request) => request.requiredMemberIds),
        'retry request ids must be stable',
    );
    const spentOutput = director.update(
        RUIN_BELL_CONTRACT.limits.timeoutSeconds - director.getSnapshot().eventElapsed,
        context(),
    );
    const spent = eventOf(spentOutput, 'ruin-bell-failed');
    check(!!spent, 'second attempt did not emit failure');
    equal(spent?.retryAvailable, false, 'second failure offered a third attempt');
    equal(spent?.houseState, 'ruined', 'second failure house state');
    equal(spentOutput.snapshot.phase, 'spent', 'second failure phase');
    equal(spentOutput.snapshot.attemptsFailed, 2, 'second failure count');
    check(!eventOf(director.update(100, context()), 'ruin-bell-retry-ready'),
        'spent bell exposed a third attempt');
    retryFixture = { director, failedOutput };
});

let handshakeFixture = null;
await section('live GameUpdate spawn handshake and placement', () => {
    installHeadlessCanvas();
    const direct = requestFixture(5150);
    check(!!direct.request, 'spawn integration fixture has no request');
    if (!direct.request) return;

    const directGame = gameSpawnFixture();
    const result = GameUpdateMethods._spawnRuinBellWave.call(directGame, direct.request);
    check(result.deferred !== true, `valid live spawn deferred: ${result.reason || 'unknown'}`);
    equal(directGame.enemies.length, direct.request.requiredCount, 'live spawn enemy count');
    deepEqual(result.acceptedMemberIds, direct.request.requiredMemberIds,
        'live spawn accepted manifest');
    for (let index = 0; index < directGame.enemies.length; index++) {
        const enemy = directGame.enemies[index];
        const unit = direct.request.units[index];
        check(Number.isFinite(enemy.x) && Number.isFinite(enemy.y),
            `${unit.memberId} placement must be finite`);
        equal(enemy.ruinBellMemberId, unit.memberId, `${unit.memberId} stable tag`);
        equal(enemy.ruinBellInstanceId, direct.request.instanceId, `${unit.memberId} instance tag`);
        equal(enemy.ruinBellStageId, direct.request.stageId, `${unit.memberId} stage tag`);
        equal(enemy.ruinBellRole, unit.role, `${unit.memberId} role tag`);
        equal(enemy.elite, false, `${unit.memberId} elite flag`);
        const dx = enemy.x - directGame.player.x;
        const dy = enemy.y - directGame.player.y;
        check(dx * dx + dy * dy >= Math.max(170, enemy.radius + directGame.player.radius + 92) ** 2,
            `${unit.memberId} spawned too close to player`);
    }
    for (let a = 0; a < directGame.enemies.length; a++) {
        for (let b = a + 1; b < directGame.enemies.length; b++) {
            const left = directGame.enemies[a];
            const right = directGame.enemies[b];
            const dx = left.x - right.x;
            const dy = left.y - right.y;
            check(dx * dx + dy * dy >= (left.radius + right.radius + 18) ** 2,
                `live placements overlap: ${left.ruinBellMemberId} / ${right.ruinBellMemberId}`);
        }
    }

    const capped = gameSpawnFixture({ maxAlive: direct.request.requiredCount - 1 });
    const capResult = GameUpdateMethods._spawnRuinBellWave.call(capped, direct.request);
    equal(capResult.reason, 'enemy-cap', 'cap rejection reason');
    equal(capped.enemies.length, 0, 'cap rejection partially created enemies');

    const blocked = gameSpawnFixture({ blocked: true });
    const blockResult = GameUpdateMethods._spawnRuinBellWave.call(blocked, direct.request);
    equal(blockResult.reason, 'placement-blocked', 'blocked placement reason');
    equal(blocked.enemies.length, 0, 'blocked placement partially created enemies');

    const malformed = structuredClone(direct.request);
    malformed.units[malformed.units.length - 1].type = 'not-an-enemy';
    const invalid = gameSpawnFixture();
    const invalidResult = GameUpdateMethods._spawnRuinBellWave.call(invalid, malformed);
    equal(invalidResult.reason, 'invalid-unit', 'invalid manifest reason');
    equal(invalid.enemies.length, 0, 'invalid manifest partially created enemies');

    // Exercise the real synchronous Game -> director acknowledgement loop.
    const handshake = requestFixture(5252);
    const handshakeGame = gameSpawnFixture();
    const handled = [];
    handshakeGame.ruinBellDirector = handshake.director;
    handshakeGame._ruinBellContext = (extra) => context(extra);
    handshakeGame._spawnRuinBellWave = (request) =>
        GameUpdateMethods._spawnRuinBellWave.call(handshakeGame, request);
    handshakeGame._handleRuinBellEvent = (event) => handled.push(event.type);
    GameUpdateMethods._applyRuinBellOutput.call(handshakeGame, handshake.output);
    equal(handshakeGame.enemies.length, handshake.request.requiredCount,
        'handshake-created enemy count');
    equal(handshake.director.getSnapshot().pendingRequest, null,
        'handshake left a pending director request');
    equal(handshake.director.getSnapshot().phase, 'active', 'handshake director phase');
    check(handled.includes('ruin-bell-wave-spawned'),
        'handshake did not process wave-spawned follow-up');
    handshakeFixture = { game: handshakeGame, director: handshake.director };

    // The per-frame seam must drain defeated IDs exactly once and apply output.
    let updateInput = null;
    let applied = null;
    const sentinel = { events: [{ type: 'sentinel' }], spawnRequests: [] };
    const updateGame = {
        ruinBellDirector: {
            update: (dt, value) => { updateInput = { dt, value }; return sentinel; },
        },
        _ruinBellDefeatedIds: ['member-a', 'member-b'],
        _ruinBellContext: (extra) => ({ marker: true, ...extra }),
        _applyRuinBellOutput: (output) => { applied = output; },
    };
    GameUpdateMethods._updateRuinBell.call(updateGame, 0.25);
    close(updateInput?.dt, 0.25, 0, 'per-frame director dt');
    deepEqual(updateInput?.value?.defeatedMemberIds, ['member-a', 'member-b'],
        'per-frame defeated-id lane');
    equal(updateGame._ruinBellDefeatedIds.length, 0, 'defeated-id lane was not drained');
    check(applied === sentinel, 'per-frame director output was not applied');
});

await section('runtime reward seam, house state, and no coins', () => {
    check(!!completedFixture?.event, 'clear event fixture unavailable');
    if (!completedFixture?.event) return;
    const calls = {
        xp: [], choice: 0, coins: 0, house: [], music: [], announcements: 0,
    };
    const game = {
        ruinBellDirector: completedFixture.director,
        ruinBellStructure: STRUCTURE,
        obstacleSystem: {
            setStructureState: (id, state) => {
                calls.house.push({ id, state });
                return true;
            },
        },
        player: { x: 0, y: 0 },
        audio: {
            musicEvent: (name, cue) => { calls.music.push({ name, cue }); return cue.caption; },
        },
        captionSystem: { sound: () => {} },
        accessibility: { announce: () => {} },
        waveDirector: { announce: () => { calls.announcements++; } },
        particles: { pickupSparkle: () => {} },
        haptics: { pulse: () => {} },
        enemies: [],
        enemyProjectiles: [],
        hazards: [],
        musicState: { intensity: 0, target: 0, scene: 'calm' },
        _ruinBellRewarded: false,
        _ruinBellMusicOrdinal: 0,
        _grantVigilXp: (amount, x, y) => calls.xp.push({ amount, x, y }),
        _dropBossReward: () => { calls.choice++; },
        _dropCoinBurst: () => { calls.coins++; },
        _spawnRing: () => {},
        _shake: () => {},
    };
    game._setRuinBellHouseState = (state) =>
        GameUpdateMethods._setRuinBellHouseState.call(game, state);
    game._retireRuinBellMembers = (memberIds) =>
        GameUpdateMethods._retireRuinBellMembers.call(game, memberIds);
    game._playRuinBellMusic = (eventName) =>
        GameUpdateMethods._playRuinBellMusic.call(game, eventName);

    GameUpdateMethods._handleRuinBellEvent.call(game, completedFixture.event);
    GameUpdateMethods._handleRuinBellEvent.call(game, completedFixture.event);
    equal(calls.xp.length, 1, 'clear handler XP award count');
    equal(calls.xp[0]?.amount, 32, 'clear handler XP amount');
    equal(calls.choice, 1, 'clear handler choice-drop count');
    equal(calls.coins, 0, 'clear handler coin-drop count');
    equal(game._ruinBellReceipt?.choice, 'chest-or-wick-shrine',
        'clear receipt choice');
    equal(game._ruinBellReceipt?.xp, 32, 'clear receipt XP');
    check(calls.house.every((entry) => entry.id === STRUCTURE.id
        && entry.state === completedFixture.event.houseState),
    'clear event did not route its authored house state');
    equal(calls.music.length, 1, 'clear music cue count');

    const loot = {
        chests: [],
        shrines: [],
        _clearSpot: (x, y) => ({ x, y }),
    };
    CombatResolverMethods._dropBossReward.call(loot, 10, 20);
    equal(loot.chests.length, 1, 'choice reward chest count');
    equal(loot.shrines.length, 1, 'choice reward shrine count');
    check(loot.chests[0]?._sibling === loot.shrines[0]
        && loot.shrines[0]?._sibling === loot.chests[0],
    'chest and Wick Shrine must be mutually exclusive siblings');

    const sockets = EMBERWOOD_RUIN_BELL_CABIN.encounter.rewardSockets;
    const placement = {
        chest: { x: STRUCTURE.x + sockets.chest.x, y: STRUCTURE.y + sockets.chest.y },
        shrine: { x: STRUCTURE.x + sockets.shrine.x, y: STRUCTURE.y + sockets.shrine.y },
        pickupDelaySeconds: sockets.pickupDelaySeconds,
        requiresExitBeforePickup: sockets.requiresExitBeforePickup,
    };
    const bellLoot = { chests: [], shrines: [], _clearSpot: (x, y) => ({ x, y }) };
    CombatResolverMethods._dropBossReward.call(bellLoot, 0, 0, placement);
    equal(bellLoot.chests[0]?.x, placement.chest.x, 'authored Bell chest socket x');
    equal(bellLoot.shrines[0]?.x, placement.shrine.x, 'authored Bell shrine socket x');
    check(Math.hypot(
        bellLoot.chests[0].x - bellLoot.shrines[0].x,
        bellLoot.chests[0].y - bellLoot.shrines[0].y,
    ) > bellLoot.chests[0].radius + bellLoot.shrines[0].radius,
    'authored Bell reward pickup zones overlap');
    const onChest = { x: bellLoot.chests[0].x, y: bellLoot.chests[0].y, radius: 50 };
    check(!bellLoot.chests[0].update(1, onChest),
        'Bell chest auto-claimed under the player on its spawn frame');
    check(!bellLoot.chests[0].update(0, { x: onChest.x + 500, y: onChest.y, radius: 50 }),
        'leaving the Bell chest incorrectly claimed it');
    check(bellLoot.chests[0].update(0.01, onChest),
        'Bell chest did not arm after exit and deliberate re-entry');

    const failed = eventOf(retryFixture?.failedOutput, 'ruin-bell-failed');
    check(failed?.houseState === 'damaged' && failed?.reward === null,
        'failure event must damage house and pay no reward');
});

await section('reward choice claim provenance and terminal truth', () => {
    const chestFixture = completedRewardFixture(7878);
    const chestDirector = chestFixture.director;
    equal(chestFixture.event?.rewardId, chestDirector.rewardId,
        'clear event stable reward id');

    check(!chestDirector.claimReward({
        instanceId: 'foreign-instance',
        rewardId: chestDirector.rewardId,
        choice: 'chest',
    }), 'foreign Bell instance claimed the completion reward');
    check(!chestDirector.claimReward({
        instanceId: chestDirector.instanceId,
        rewardId: 'foreign-reward',
        choice: 'chest',
    }), 'foreign reward id claimed the Bell completion reward');
    check(!chestDirector.claimReward({
        instanceId: chestDirector.instanceId,
        rewardId: chestDirector.rewardId,
        choice: 'coins',
    }), 'non-authored reward choice was accepted');
    equal(chestDirector.getSnapshot().rewardClaimed, false,
        'rejected claims changed Director reward truth');

    const chestGame = rewardRuntime(chestFixture);
    // A generic boss pair can coexist in the same arrays. It is deliberately
    // untagged and must not consume the Bell's keyed completion reward.
    CombatResolverMethods._dropBossReward.call(chestGame, -600, -400);
    const genericChest = chestGame.chests[0];
    const genericShrine = chestGame.shrines[0];
    GameUpdateMethods._handleRuinBellEvent.call(chestGame, chestFixture.event);
    GameUpdateMethods._handleRuinBellEvent.call(chestGame, chestFixture.event);
    equal(chestGame.chests.length, 2, 'duplicate clear spawned another Bell chest');
    equal(chestGame.shrines.length, 2, 'duplicate clear spawned another Bell shrine');
    const bellChest = chestGame.chests[1];
    const bellShrine = chestGame.shrines[1];
    equal(genericChest.ruinBellRewardId, undefined,
        'generic boss chest received Bell provenance');
    equal(genericShrine.ruinBellRewardId, undefined,
        'generic boss shrine received Bell provenance');
    equal(bellChest.ruinBellInstanceId, chestDirector.instanceId,
        'Bell chest instance provenance');
    equal(bellShrine.ruinBellInstanceId, chestDirector.instanceId,
        'Bell shrine instance provenance');
    equal(bellChest.ruinBellRewardId, chestDirector.rewardId,
        'Bell chest reward provenance');
    equal(bellShrine.ruinBellRewardId, chestDirector.rewardId,
        'Bell shrine reward provenance');
    equal(bellChest.ruinBellRewardChoice, 'chest', 'Bell chest choice provenance');
    equal(bellShrine.ruinBellRewardChoice, 'shrine', 'Bell shrine choice provenance');

    // Clearing can happen anywhere inside the broad 460 px defense zone. The
    // sole guidance card must keep the unclaimed choice visible even after the
    // player leaves the much smaller 104 px activation ring.
    chestDirector.update(0, context({ playerInRange: false }));
    const unclaimedAway = ruinBellObjectiveSnapshot({
        screen: 'gameplay', ruinBellDirector: chestDirector, input: null,
    });
    equal(unclaimedAway?.owner, 'ruin-bell',
        'unclaimed clear lost the guidance card outside the activation ring');
    check(unclaimedAway?.accessibilityText?.includes('Choose the Chest or Wick Shrine'),
        'unclaimed clear lost its accessible reward choice outside the activation ring');

    chestGame.player.x = genericChest.x;
    chestGame.player.y = genericChest.y;
    GameUpdateMethods._updateRewardOverlays.call(chestGame, 0.01);
    check(!genericShrine.active, 'generic chest did not retire its generic sibling');
    equal(chestDirector.getSnapshot().rewardClaimed, false,
        'generic boss reward consumed the Bell reward');
    equal(chestDirector.getQASnapshot().counters.ignoredRewardClaims, 3,
        'generic boss pickup reached the Bell claim seam');
    chestGame.chestReward = null;

    // Clear the Bell pair's spawn-under-player guard and authored delay, then
    // deliberately re-enter the chest socket to make a real selection.
    chestGame.player.x = STRUCTURE.x;
    chestGame.player.y = STRUCTURE.y + 700;
    GameUpdateMethods._updateRewardOverlays.call(chestGame, 1);
    chestGame.player.x = bellChest.x;
    chestGame.player.y = bellChest.y;
    GameUpdateMethods._updateRewardOverlays.call(chestGame, 0.01);
    equal(chestDirector.getSnapshot().rewardClaimed, true,
        'actual Bell chest pickup did not claim the Director reward');
    equal(chestDirector.getSnapshot().rewardChoice, 'chest',
        'Director did not record chest choice');
    check(!bellShrine.active, 'Bell chest pickup did not retire sibling shrine');
    equal(chestGame._ruinBellReceipt?.rewardClaimed, true,
        'runtime receipt did not record Bell reward claim');
    equal(chestGame._ruinBellReceipt?.claimedChoice, 'chest',
        'runtime receipt did not record chest choice');
    check(!chestDirector.claimReward({
        instanceId: chestDirector.instanceId,
        rewardId: chestDirector.rewardId,
        choice: 'chest',
    }), 'duplicate Bell chest claim was accepted');
    equal(chestDirector.getQASnapshot().counters.rewardClaims, 1,
        'Director recorded more than one reward claim');
    equal(chestDirector.getQASnapshot().counters.duplicateRewardClaims, 1,
        'Director did not count duplicate reward claim');

    chestDirector.update(0, context({ playerInRange: true }));
    const claimedGuidance = chestDirector.getGuidanceSnapshot();
    check(claimedGuidance.inActivationRange && claimedGuidance.rewardClaimed,
        'claimed-card fixture is not near the completed Bell');
    equal(ruinBellObjectiveSnapshot({
        screen: 'gameplay', ruinBellDirector: chestDirector, input: null,
    }), null, 'claimed Bell reacquired the single Run Path card');
    const successRender = chestDirector.getRenderSnapshot();
    equal(successRender.phase, 'cleared', 'reward claim discarded cleared success phase');
    equal(successRender.bell.lit, true, 'reward claim extinguished lit success art');
    equal(successRender.rewardReady, false, 'claimed render still advertises a ready reward');

    // Exercise the second mutually-exclusive branch through the same real
    // walk-on loop, not a direct Director shortcut.
    const shrineFixture = completedRewardFixture(7979);
    const shrineGame = rewardRuntime(shrineFixture);
    GameUpdateMethods._handleRuinBellEvent.call(shrineGame, shrineFixture.event);
    const shrineChest = shrineGame.chests[0];
    const shrine = shrineGame.shrines[0];
    shrineGame.player.x = STRUCTURE.x;
    shrineGame.player.y = STRUCTURE.y + 700;
    GameUpdateMethods._updateRewardOverlays.call(shrineGame, 1);
    shrineGame.player.x = shrine.x;
    shrineGame.player.y = shrine.y;
    GameUpdateMethods._updateRewardOverlays.call(shrineGame, 0.01);
    equal(shrineFixture.director.getSnapshot().rewardClaimed, true,
        'actual Wick Shrine pickup did not claim the Director reward');
    equal(shrineFixture.director.getSnapshot().rewardChoice, 'shrine',
        'Director did not record Wick Shrine choice');
    check(!shrineChest.active, 'Wick Shrine pickup did not retire sibling chest');
    equal(shrineGame._ruinBellReceipt?.claimedChoice, 'shrine',
        'runtime receipt did not record Wick Shrine choice');
    shrineFixture.director.update(0, context({ playerInRange: true }));
    equal(ruinBellObjectiveSnapshot({
        screen: 'gameplay', ruinBellDirector: shrineFixture.director, input: null,
    }), null, 'claimed Wick Shrine path left a stale Bell card');
});

await section('single-card guidance priority', () => {
    const director = makeDirector(3, 6060);
    const game = { screen: 'gameplay', ruinBellDirector: director, input: null };
    director.update(0, context({ playerInRange: false }));
    equal(ruinBellObjectiveSnapshot(game), null,
        'away dormant bell must leave Run Path card available');

    director.update(0, context({ playerInRange: true }));
    const near = ruinBellObjectiveSnapshot(game);
    equal(near?.owner, 'ruin-bell', 'near-cabin guidance owner');
    equal(near?.phaseLabel, 'HOUSE CONTRACT', 'near-cabin guidance label');
    check(typeof near?.accessibilityText === 'string' && near.accessibilityText.includes('Ruin Bell'),
        'near-cabin card lacks accessibility text');

    director.update(0, context({ playerInRange: false }));
    equal(ruinBellObjectiveSnapshot(game), null,
        'leaving the dormant focus ring must restore Run Path');

    beginAttempt(director);
    director.update(0, context({ playerInRange: false }));
    const engaged = ruinBellObjectiveSnapshot(game);
    equal(engaged?.owner, 'ruin-bell', 'engaged guidance owner away from cabin');
    check(engaged?.bodyLabel === 'BRACE' || engaged?.bodyLabel === 'DEFEND',
        'engaged guidance must expose an encounter action');

    const retryDirector = makeDirector(3, 6070);
    beginAttempt(retryDirector);
    acknowledgeAllStages(retryDirector);
    retryDirector.update(60 - retryDirector.getSnapshot().eventElapsed, context());
    const retryGame = { screen: 'gameplay', ruinBellDirector: retryDirector, input: null };
    equal(ruinBellObjectiveSnapshot(retryGame)?.bodyLabel, 'RECOVER',
        'retry cooldown must borrow the single guidance card');

    const spentGame = { screen: 'gameplay', ruinBellDirector: retryFixture.director, input: null };
    // A spent and distant contract is not a permanent card owner, protecting
    // the normal Run Path after resolution.
    equal(ruinBellObjectiveSnapshot(spentGame), null,
        'spent bell must not permanently replace Run Path away from cabin');

    const uiSource = buildUIState.toString();
    check(/base\.runObjective\s*=\s*ruinBellObjectiveSnapshot\(\s*game(?:\s*,\s*base\.ruinBellGuidance)?\s*\)\s*\?\?\s*base\.runObjective/.test(uiSource),
        'UIStateBuilder no longer gives the eligible Ruin Bell adapter card priority');
    check(!uiSource.includes('base.ruinBellObjective ='),
        'UIStateBuilder introduced a competing Ruin Bell HUD card');
});

await section('render snapshot enrichment and pure renderer smoke', () => {
    check(!!handshakeFixture, 'render fixture unavailable');
    if (!handshakeFixture) return;
    const director = handshakeFixture.director;
    const enemies = handshakeFixture.game.enemies;
    const raw = director.getRenderSnapshot();
    close(raw.anchor?.radius, 104, 0, 'render activation radius');
    close(raw.defense?.radius, 460, 0, 'render defense radius');
    close(raw.defense?.center?.x, STRUCTURE.x, 0, 'render defense center x');
    close(raw.defense?.center?.y, STRUCTURE.y, 0, 'render defense center y');
    check(raw.anchor?.x !== raw.defense?.center?.x || raw.anchor?.y !== raw.defense?.center?.y,
        'activation and defense rings must retain their distinct authored centers');
    check(raw.roleMarks.length === enemies.length && raw.roleMarks.length > 0,
        'director render snapshot must expose semantic live role IDs');
    check(raw.roleMarks.every((mark) => !Object.hasOwn(mark, 'x') && !Object.hasOwn(mark, 'y')),
        'pure director must not invent live enemy positions');

    const enriched = GameRenderMethods._buildRuinBellRenderSnapshot.call({
        ruinBellDirector: director,
        enemies,
    });
    check(enriched !== raw && enriched.roleMarks !== raw.roleMarks,
        'Game render adapter must return a fresh enriched snapshot');
    for (const mark of enriched.roleMarks) {
        const enemy = enemies.find((candidate) => candidate.ruinBellMemberId === mark.memberId);
        check(!!enemy, `missing live enemy for role mark ${mark.memberId}`);
        close(mark.x, enemy?.x, 0, `${mark.memberId} render x`);
        close(mark.y, enemy?.y, 0, `${mark.memberId} render y`);
        close(mark.radius, enemy?.radius, 0, `${mark.memberId} render radius`);
    }
    const rawAfter = director.getRenderSnapshot();
    check(rawAfter.roleMarks.every((mark) => !Object.hasOwn(mark, 'x')),
        'render enrichment mutated director-owned semantics');

    const before = JSON.stringify(enriched);
    const ctx = fakeCanvasContext();
    const presentation = { reducedEffects: false, highContrast: false };
    check(ruinBellRenderer.drawGround(ctx, enriched, presentation),
        'active renderer ground smoke returned false');
    check(ruinBellRenderer.drawAbove(ctx, enriched, presentation),
        'active renderer semantic smoke returned false');
    const lights = [];
    check(ruinBellRenderer.registerLights({
        addLight: (...args) => lights.push(args),
    }, enriched, presentation), 'active renderer light smoke returned false');
    equal(lights.length, 1, 'Ruin Bell light count');
    check(ctx.calls.some((entry) => entry.method === 'arc'),
        'renderer smoke drew no world-space arcs');
    check(ctx.calls.some((entry) => entry.method === 'arc'
        && entry.args[0] === STRUCTURE.x && entry.args[1] === STRUCTURE.y
        && entry.args[2] === 460),
    'ground renderer omitted the cabin-centered 460px defense boundary');
    check(ctx.calls.some((entry) => entry.method === 'arc'
        && entry.args[0] === raw.anchor.x && entry.args[1] === raw.anchor.y
        && entry.args[2] === 104),
    'ground renderer lost the separate bell-centered 104px activation ring');
    check(ctx.calls.some((entry) => entry.method === 'setLineDash'
        && JSON.stringify(entry.args[0]) === JSON.stringify([18, 8, 3, 8])),
    'in-range defense boundary lacks its non-color dash-dot fence semantics');
    equal(JSON.stringify(enriched), before, 'renderer mutated its input snapshot');

    const outside = {
        ...enriched,
        visualTime: 7.5,
        defense: {
            ...enriched.defense,
            inRange: false,
            outside: true,
            graceRemaining: enriched.defense.graceSeconds * 0.5,
        },
    };
    const outsideCtx = fakeCanvasContext();
    check(ruinBellRenderer.drawGround(outsideCtx, outside, { reducedEffects: true }),
        'outside-grace reduced-effects ground smoke returned false');
    check(outsideCtx.calls.some((entry) => entry.method === 'setLineDash'
        && JSON.stringify(entry.args[0]) === JSON.stringify([9, 7])),
    'outside-grace boundary lacks its non-color emergency cadence');
    check(outsideCtx.calls.some((entry) => entry.method === 'arc'
        && entry.args[0] === STRUCTURE.x && entry.args[1] === STRUCTURE.y
        && entry.args[2] === 450),
    'outside-grace boundary omitted its solid shrinking grace arc');

    const reducedLaterCtx = fakeCanvasContext();
    ruinBellRenderer.drawGround(reducedLaterCtx, { ...outside, visualTime: 999 }, {
        reducedEffects: true,
    });
    deepEqual(reducedLaterCtx.calls, outsideCtx.calls,
        'reduced-effects defense geometry changed with visual time');

    const highContrastCtx = fakeCanvasContext();
    check(ruinBellRenderer.drawAbove(highContrastCtx, enriched, {
        reducedEffects: true,
        highContrast: true,
    }), 'high-contrast reduced-effects smoke returned false');
    check(highContrastCtx.calls.some((entry) => entry.method === 'arc'
        && entry.args[0] === STRUCTURE.x && entry.args[1] === STRUCTURE.y
        && entry.args[2] === 460),
    'high-contrast semantic pass omitted the defense boundary above the veil');
    check(highContrastCtx.calls.some((entry) => entry.method === 'arc'
        && entry.args[0] === raw.anchor.x && entry.args[1] === raw.anchor.y
        && entry.args[2] === 104),
    'high-contrast semantic pass lost the activation ring');
    equal(JSON.stringify(enriched), before,
        'high-contrast/reduced renderer mutated its input');

    const rewardFixture = completedRewardFixture(8181);
    const rewardGame = rewardRuntime(rewardFixture);
    GameUpdateMethods._handleRuinBellEvent.call(rewardGame, rewardFixture.event);
    const rewardSource = rewardFixture.director.getRenderSnapshot();
    const rewardEnriched = GameRenderMethods._buildRuinBellRenderSnapshot.call(rewardGame);
    equal(rewardEnriched?.rewardMarks?.length, 2,
        'cleared render adapter did not expose both live reward choices');
    deepEqual(rewardEnriched.rewardMarks.map((mark) => mark.choice).sort(), ['chest', 'shrine'],
        'cleared render adapter reward choices');
    for (const mark of rewardEnriched.rewardMarks) {
        const liveReward = mark.choice === 'chest' ? rewardGame.chests[0] : rewardGame.shrines[0];
        close(mark.x, liveReward.x, 0, `${mark.choice} semantic marker x`);
        close(mark.y, liveReward.y, 0, `${mark.choice} semantic marker y`);
    }
    check(!Object.hasOwn(rewardSource, 'rewardMarks'),
        'pure Director invented live reward positions');
    const rewardCtx = fakeCanvasContext();
    check(ruinBellRenderer.drawAbove(rewardCtx, rewardEnriched, presentation),
        'cleared reward semantic renderer returned false');
    const rewardLabels = rewardCtx.calls
        .filter((entry) => entry.method === 'fillText')
        .map((entry) => entry.args[0]);
    deepEqual(rewardLabels, ['CHEST', 'WICK SHRINE'],
        'cleared semantic pass did not identify both real reward entities');

    const technical = {
        ...enriched,
        phase: 'technical-defer',
        defense: { ...enriched.defense, outside: false },
    };
    const technicalCtx = fakeCanvasContext();
    check(ruinBellRenderer.drawGround(technicalCtx, technical, presentation),
        'technical-defer ground renderer returned false');
    check(technicalCtx.calls.some((entry) => entry.method === 'arc'
        && entry.args[0] === STRUCTURE.x && entry.args[1] === STRUCTURE.y
        && entry.args[2] === 460),
    'technical-defer lost the cabin defense boundary');

    const dormantSource = { visible: true, phase: 'spent', roleMarks: [], rewardReady: false };
    const dormantEnemies = {
        [Symbol.iterator]() {
            throw new Error('dormant render adapter scanned enemies');
        },
    };
    const dormantResult = GameRenderMethods._buildRuinBellRenderSnapshot.call({
        ruinBellDirector: { getRenderSnapshot: () => dormantSource },
        enemies: dormantEnemies,
    });
    equal(dormantResult, dormantSource,
        'dormant render adapter allocated instead of preserving the pure snapshot');

    const malformedResult = GameRenderMethods._buildRuinBellRenderSnapshot.call({
        ruinBellDirector: {
            getRenderSnapshot: () => ({
                visible: true, phase: 'active', roleMarks: { legacy: true }, rewardReady: false,
            }),
        },
        enemies: dormantEnemies,
    });
    deepEqual(malformedResult.roleMarks, [],
        'malformed legacy roleMarks did not fail closed without scanning enemies');
});

await section('deterministic semantic music events', () => {
    const names = Object.values(RUIN_BELL_EVENT).sort();
    deepEqual(Object.keys(RUIN_BELL_MUSIC_EVENTS).sort(), names,
        'music event registry keys');
    equal(names.length, 4, 'Ruin Bell music event count');
    const ids = new Set();
    for (const name of names) {
        const definition = RUIN_BELL_MUSIC_EVENTS[name];
        const first = resolveRuinBellMusicCue(name, 123456, 7);
        const repeat = resolveRuinBellMusicCue(name, 123456, 7);
        check(!!first, `${name} music cue missing`);
        deepEqual(first, repeat, `${name} cue determinism`);
        check(Object.isFrozen(first) && Object.isFrozen(definition),
            `${name} cue and definition must be frozen`);
        check(typeof first.semanticLabel === 'string' && first.semanticLabel.length > 4,
            `${name} semantic label missing`);
        check(typeof first.caption === 'string' && first.caption.length > 8,
            `${name} caption missing`);
        check(typeof first.announcement === 'string' && first.announcement.length > 12,
            `${name} announcement missing`);
        check(typeof first.fallbackSfx === 'string' && first.fallbackSfx.length > 2,
            `${name} fallback SFX missing`);
        check(first.combat?.scene && Number.isFinite(first.combat?.intensity)
            && first.combat.intensity >= 0 && first.combat.intensity <= 1,
        `${name} combat target invalid`);
        check(first.quantize?.unit === 'bar' && first.quantize?.edge === 'next'
            && first.quantize?.interrupt === false,
        `${name} cue must quantize non-destructively to the next bar`);
        check(Array.isArray(first.variant?.notes) && Array.isArray(first.variant?.hits),
            `${name} phrase payload invalid`);
        for (const note of first.variant?.notes || []) {
            check(Number.isInteger(note.step) && note.step >= 0 && note.step <= 15,
                `${name}/${first.variant.id} note step invalid`);
            check(Number.isFinite(note.durationSteps) && note.durationSteps > 0,
                `${name}/${first.variant.id} note duration invalid`);
            check(Number.isFinite(note.gain) && note.gain > 0 && note.gain <= 0.12,
                `${name}/${first.variant.id} note gain invalid`);
        }
        check(!ids.has(first.id), `duplicate semantic cue id ${first.id}`);
        ids.add(first.id);
    }
    equal(resolveRuinBellMusicCue('not-an-event', 1, 1), null,
        'unknown music event must fail closed');

    const warning = resolveRuinBellMusicCue(RUIN_BELL_EVENT.WARNING, 88, 0);
    const fallbackAudio = new AudioSystem();
    let fallbackCalls = 0;
    fallbackAudio[warning.fallbackSfx] = () => { fallbackCalls++; };
    const caption = fallbackAudio.musicEvent('ruinBell', warning);
    equal(caption, warning.caption, 'headless fallback caption');
    equal(fallbackCalls, 1, 'headless fallback SFX count');
    equal(fallbackAudio._combatScene, warning.combat.scene, 'headless fallback combat scene');
    close(fallbackAudio._intensity, warning.combat.intensity, 0,
        'headless fallback combat intensity');

    const trackerAudio = new AudioSystem();
    let trackerFallbacks = 0;
    const escalation = resolveRuinBellMusicCue(RUIN_BELL_EVENT.ESCALATION, 88, 1);
    trackerAudio[escalation.fallbackSfx] = () => { trackerFallbacks++; };
    trackerAudio.ctx = { currentTime: 0 };
    trackerAudio.theme = 'gameplay';
    trackerAudio._activeScore = BIOME_COMPOSITIONS.emberwood[0];
    trackerAudio.musicEvent('ruinBell', escalation);
    equal(trackerFallbacks, 0, 'tracker-ready cue incorrectly used fallback SFX');
    equal(trackerAudio._pendingRuinBellCues.length, 1,
        'tracker-ready cue was not queued for next bar');
    check(trackerAudio._pendingRuinBellCues[0] === escalation,
        'tracker queue changed the resolved deterministic cue');
});

await section('production wiring and dev-mode preservation', async () => {
    const updateSource = GameUpdateMethods._updatePlayerAndWeapons.toString();
    const resolveIndex = updateSource.indexOf('this.obstacleSystem.resolveCircle');
    const bellIndex = updateSource.indexOf('this._updateRuinBell(dt)');
    const vigilIndex = updateSource.indexOf('this._updateVigilSites(dt)');
    check(resolveIndex >= 0 && bellIndex > resolveIndex && vigilIndex > bellIndex,
        'Game update must run Ruin Bell after player collision and before Waylights');
    check(updateSource.includes("!this.ruinBellDirector?.ownsStage?.()"),
        'normal spawner is not gated by Ruin Bell stage ownership');

    const rewardSource = GameUpdateMethods._handleRuinBellEvent.toString();
    check(rewardSource.includes("event.type !== 'ruin-bell-cleared' || this._ruinBellRewarded"),
        'runtime reward seam lost its idempotent clear guard');
    check(rewardSource.includes('this._grantVigilXp(xp')
        && rewardSource.includes('this._dropBossReward(anchor.x, anchor.y, rewardPlacement)')
        && rewardSource.includes('rewardSockets'),
    'runtime reward seam lost XP or chest/shrine choice');
    check(!rewardSource.includes('_dropCoin') && !rewardSource.includes('this.coins'),
        'runtime clear seam contains a coin reward');

    const renderSource = GameRenderMethods.render.toString();
    for (const marker of [
        'ruinBellRenderer.drawGround',
        'ruinBellRenderer.drawAbove',
        'ruinBellRenderer.registerLights',
        'enemy.ruinBellMemberId',
    ]) check(renderSource.includes(marker), `Game render wiring missing ${marker}`);

    const gameSource = fs.readFileSync(path.join(ROOT, 'src/core/Game.js'), 'utf8');
    check(gameSource.includes("import { RuinBellDirector } from '../systems/RuinBellDirector.js'")
        && gameSource.includes('new RuinBellDirector({'),
    'Game boot no longer constructs the real Ruin Bell director');

    const configPath = path.join(ROOT, 'src/config/GameConfig.js');
    const configSource = fs.readFileSync(configPath, 'utf8');
    check(configSource.includes('export const DEV_MODE') && configSource.includes('dev=1'),
        'GameConfig lost the ?dev=1 capability marker');

    // Behavioral import probes prove the exported gate still recognizes only
    // the explicit query capability. A unique module URL recomputes DEV_MODE
    // without disturbing the already-loaded production module graph.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
    try {
        Object.defineProperty(globalThis, 'location', {
            configurable: true,
            value: { search: '?capture=house&dev=1&reduced=1' },
        });
        const configUrl = pathToFileURL(configPath).href;
        const enabled = await import(`${configUrl}?ruin-bell-qa=enabled`);
        equal(enabled.DEV_MODE, true, '?dev=1 behavioral gate');
        globalThis.location.search = '?capture=house&dev=0';
        const disabled = await import(`${configUrl}?ruin-bell-qa=disabled`);
        equal(disabled.DEV_MODE, false, 'non-dev query behavioral gate');
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
        else delete globalThis.location;
    }
});

const elapsed = sections.reduce((sum, item) => sum + item.ms, 0);
if (failures.length) {
    console.error(`Ruin Bell validation: FAILED - ${failures.length} problem(s), ${checks} checks.`);
    for (const failure of failures) console.error(` - ${failure}`);
    for (const item of sections.filter((entry) => entry.failures)) {
        console.error(`   [${item.name}: ${item.failures} failure(s), ${item.checks} checks, ${item.ms.toFixed(1)}ms]`);
    }
    process.exit(1);
}

console.log(
    `Ruin Bell validation: OK - ${checks} checks; 3.5/17/33s, 45-60s, `
    + `11 stable members, one retry, runtime/UI/render/audio/dev seams in ${elapsed.toFixed(1)}ms.`,
);
