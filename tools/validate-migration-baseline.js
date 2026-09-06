#!/usr/bin/env node
// Real Game fixtures in fresh Node realms, plus contract/isolation guard tests.
// Procedural DOM/Canvas stubs are explicit: this does not prove pixel parity.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestClock, ActionTimeline, STEP, FIXTURE_EPOCH, installDeterministicGlobals } from './artshot/migration-clock.mjs';
import { SCENARIOS } from './artshot/scenarios.mjs';
import { compareReceipts, assertSerializableReceipt } from './artshot/migration-receipt.mjs';
import { installNodeEnvironment } from './artshot/migration-node-environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0;
function check(condition, message) { assertions++; assert.ok(condition, message); }

for (const ticks of [0, 60, 600]) {
    const clock = new TestClock();
    let calls = 0;
    clock.advance(ticks, (dt) => { assert.equal(dt, STEP); calls++; });
    check(clock.ticks === ticks && calls === ticks && clock.seconds === ticks / 60, `exact clock ${ticks}`);
    const game = { time: clock.seconds };
    const before = clock.ticks;
    clock.renderFrame(game, () => {});
    check(clock.ticks === before && game.time === ticks / 60, 'render is zero ticks');
    assert.throws(() => clock.renderFrame(game, () => { game.time++; }), /advanced simulation/);
}
const clock = new TestClock([{ tick: 0, action: 'press', offsetMs: 2 }, { tick: 0, action: 'release', offsetMs: 8 }, { tick: 59, action: 'move' }]);
const actions = [];
clock.advance(1, () => {}, (action) => actions.push([action.action, clock.wallMilliseconds]));
clock.advance(59, () => {}, (action) => actions.push([action.action, clock.wallMilliseconds]));
clock.advance(0, () => {}, () => assert.fail('action consumed twice'));
check(actions.length === 3 && actions[0][1] === 2 && actions[1][1] === 8, 'between-tick actions consumed once across advance calls');
assert.throws(() => new ActionTimeline([{ tick: 2, action: 'x' }, { tick: 1, action: 'y' }]));
assert.throws(() => new ActionTimeline([{ tick: 0, action: 'x', offsetMs: 17 }]));
assert.throws(() => clock.advance(1.1, () => {}));
for (const failIn of ['action', 'update']) {
    const broken = new TestClock([{ tick: 0, action: 'move' }]);
    assert.throws(() => broken.advance(1,
        () => { if (failIn === 'update') throw new Error('update failure'); },
        () => { if (failIn === 'action') throw new Error('action failure'); }));
    assert.throws(() => broken.advance(1, () => {}), /failed|poison/i);
    assert.throws(() => broken.renderFrame({ time: 0 }, () => {}), /failed|poison/i);
    assertions += 3;
}
clock.visualTimeMs = 123;
const native = { random: Math.random, date: Date, now: performance.now };
let first;
for (let i = 0; i < 2; i++) {
    const rng = installDeterministicGlobals(42, clock);
    try {
        const sample = Array.from({ length: 16 }, () => Math.random());
        if (i) assert.deepEqual(sample, first); else first = sample;
        check(Date.now() === FIXTURE_EPOCH + 123 && +new Date() === Date.now() && performance.now() === 123, 'all controlled wall clocks frozen');
        check(new Date('2000-01-01T00:00:00Z').toISOString() === '2000-01-01T00:00:00.000Z', 'explicit Date construction unchanged');
    } finally { rng.restore(); }
}
check(Math.random === native.random && Date === native.date && performance.now === native.now, 'test globals restored');
// A separate process permits an irreversible nonconfigurable-property failure
// probe without contaminating the validator's own performance object.
const failedInstall = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { TestClock, installDeterministicGlobals } from './tools/artshot/migration-clock.mjs';
    const random = Math.random, date = Date;
    Object.defineProperty(performance, 'now', { value: performance.now, configurable: false });
    assert.throws(() => installDeterministicGlobals(7, new TestClock()));
    assert.equal(Math.random, random); assert.equal(Date, date);
`], { cwd: root, encoding: 'utf8' });
check(failedInstall.status === 0, `failed install restores globals: ${failedInstall.stderr}`);
const negativeContracts = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { installNodeEnvironment } from './tools/artshot/migration-node-environment.mjs';
    import { TestClock, installDeterministicGlobals } from './tools/artshot/migration-clock.mjs';
    import { buildSemanticReceipt } from './tools/artshot/migration-receipt.mjs';
    import { runFixture } from './tools/artshot/migration-fixture.mjs';
    const env = installNodeEnvironment();
    const [{ Game }, { Input }, { KeyboardInput }, { SaveSystem }] = await Promise.all([
        import('./src/core/Game.js'), import('./src/core/Input.js'),
        import('./src/core/KeyboardInput.js'), import('./src/systems/SaveSystem.js')]);
    let game;
    const clock = new TestClock(); const rng = installDeterministicGlobals(7, clock);
    try {
        assert.throws(() => installDeterministicGlobals(8, clock));
        game = new Game({ renderer: env.renderer, input: new Input({ keyboard: new KeyboardInput() }), loop: { fps: 60 } });
        game._startRun({ campaignEligible: true });
        const args = { game, scenario: 'contract-probe', seed: 7, clock, observations: { actions: [{ tick: 0 }] } };
        const receipt = buildSemanticReceipt(args); const before = JSON.stringify(receipt);
        game.player.x++; args.observations.actions[0].tick++;
        assert.equal(JSON.stringify(receipt), before);
        game._segmentRoadId = { unexpected: 'live object' };
        assert.throws(() => buildSemanticReceipt(args));
        game._segmentRoadId = null;
        game.kindleSystem.aiming = { kind: { unexpected: 'live object' } };
        assert.throws(() => buildSemanticReceipt(args));
    } finally { await game?.saveSystem.dispose(); rng.restore(); }
    const native = { random: Math.random, date: Date, now: performance.now };
    const dispose = SaveSystem.prototype.dispose;
    SaveSystem.prototype.dispose = async () => { throw new Error('disposal probe'); };
    try {
        await assert.rejects(runFixture({ id: 'normal-desktop', renderer: env.renderer, environment: {} }), /disposal probe/);
        assert.equal(Math.random, native.random); assert.equal(Date, native.date); assert.equal(performance.now, native.now);
    } finally { SaveSystem.prototype.dispose = dispose; env.restore(); }
`], { cwd: root, encoding: 'utf8', timeout: 30000 });
check(negativeContracts.status === 0, `detached receipts / disposal failure cleanup: ${negativeContracts.stderr}`);
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let nativeStorageAccesses = 0;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { nativeStorageAccesses++; throw new Error('Host save accessed'); } });
try {
    for (let repeat = 0; repeat < 2; repeat++) {
        const isolated = installNodeEnvironment();
        try {
            check(localStorage.length === 0, 'each fixture storage starts empty');
            localStorage.setItem('fixture', 'memory only');
            check(localStorage.getItem('fixture') === 'memory only', 'real in-memory writes are supported');
        } finally { isolated.restore(); }
    }
    check(nativeStorageAccesses === 0 && typeof Object.getOwnPropertyDescriptor(globalThis, 'localStorage').get === 'function', 'host storage untouched and descriptor restored');
} finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
}
for (const value of [NaN, Infinity, undefined, new Date(), new Map(), { f() {} }, [, 1]]) {
    assert.throws(() => assertSerializableReceipt(value)); assertions++;
}
const circular = {}; circular.self = circular;
assert.throws(() => assertSerializableReceipt(circular));
check(compareReceipts({ player: { x: 1, hp: 10 } }, { player: { x: 1 + 1e-10, hp: 10 } }).length === 0, 'tight position tolerance');
check(compareReceipts({ player: { hp: 10 } }, { player: { hp: 10 + 1e-10 } })[0].path === '$.player.hp', 'HP is exact');
check(compareReceipts({ player: { x: 1 } }, { player: { x: 1.0001 } }).length === 1, 'large position drift fails');

// Permanent tripwire: no test imports/seeds or new deterministic API in shipped source.
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]); }
for (const path of [...files(resolve(root, 'src')), resolve(root, 'index.html')].filter((path) => /\.(?:m?js|html)$/.test(path))) {
    check(!/migration-(?:clock|fixture|browser|receipt|baseline)|installDeterministicGlobals/.test(readFileSync(path, 'utf8')), `production isolation: ${path}`);
}

function run(scenario, seed = scenario.seed) {
    const result = spawnSync(process.execPath, [resolve(root, 'tools/artshot/migration-node-runner.mjs'), scenario.id, String(seed)], {
        cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${scenario.id}: ${result.error || ''}\n${result.stderr}\n${result.stdout}`);
    const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('MIGRATION_RECEIPT '));
    check(!!line, `${scenario.id}: receipt missing`);
    const receipt = JSON.parse(line.slice('MIGRATION_RECEIPT '.length));
    assertSerializableReceipt(receipt);
    check(receipt.simulationTicks === scenario.ticks && receipt.simulationSeconds === scenario.ticks / 60, `${scenario.id}: exact ticks`);
    check(receipt.exceptionCount === 0 && receipt.unhandledRejectionCount === 0 && receipt.errors.length === 0, `${scenario.id}: exception-free`);
    check(receipt.observations.actionsConsumed === scenario.actions.length, `${scenario.id}: all actions consumed once`);
    check(receipt.observations.renderOnly.simulationTicks === 0, `${scenario.id}: zero tick render`);
    return receipt;
}
for (const scenario of SCENARIOS) {
    const first = run(scenario);
    const baseline = JSON.parse(readFileSync(resolve(root, `docs/evidence/phaser-migration/${scenario.id}.json`), 'utf8'));
    const baselineDifferences = compareReceipts(baseline.node.receipt, first);
    check(baselineDifferences.length === 0, `${scenario.id}: committed baseline changed\n${JSON.stringify(baselineDifferences.slice(0, 30), null, 2)}`);
    for (let repeat = 1; repeat < 3; repeat++) {
        const differences = compareReceipts(first, run(scenario));
        check(differences.length === 0, `${scenario.id}: repeat ${repeat + 1} differs\n${JSON.stringify(differences.slice(0, 30), null, 2)}`);
    }
    if (scenario.id === 'combat-pack') {
        check(first.observations.maxPlayerProjectiles > 0 && first.observations.controlledPackDamaged > 0 && first.run.kills > 0, 'real weapon fire + controlled enemy damage + kill pipeline');
        check(first.run.gameOver && first.progression?.source === 'real-game-terminal-settlement'
            && first.progression.saved.stats.runs === 1 && first.progression.saved.stats.totalKills === first.run.kills,
        'combat death records actual isolated terminal settlement');
    }
    if (scenario.id === 'boss-entry') check(first.observations.bossWarningTick > 0 && first.observations.bossSpawnTick > first.observations.bossWarningTick && first.observations.firstBossId === 'stormwingAlpha' && first.observations.firstBossId === first.observations.firstBossWarningId && first.observations.firstBossProvenance === 'map-director' && first.boss?.alive, 'authoritative first boss warning and live spawn');
    if (scenario.id === 'touch-actions') check(first.run.blinks === 1 && first.run.kindleReleases === 1
        && Math.abs(first.player.y - first.observations.startPosition.y) > 50,
    'actual vertical movement, Blink and single between-tick Kindle release');
    const alternate = run(scenario, scenario.seed + 1);
    // Exclude seed, RNG call counts and metadata: actual simulation samples must differ.
    const randomState = (receipt) => ({ enemies: receipt.enemySamples, kills: receipt.run.kills, hp: receipt.player.hp, xp: receipt.player.xp });
    check(compareReceipts(randomState(first), randomState(alternate)).length > 0, `${scenario.id}: changed seed must change gameplay-dependent state`);
    console.log(`PASS ${scenario.id}: 3 identical repeats; changed seed differs; ${scenario.ticks} ticks; kills=${first.run.kills}`);
}
console.log(`Migration baseline: PASS (${assertions} assertions; 16 fresh-process real-Game fixtures; Node procedural environment only)`);
