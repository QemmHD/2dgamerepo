#!/usr/bin/env node
// The 40th gate: an isolated empty-engine shell, not gameplay/renderer parity.
// Existing production and PR1 authorities are immutable against the PR2 base.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { detachReceipt } from '../src/phaser/Receipt.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '33d45b9d4e7aad34e56df701a28ee2a2e3e4d8e9';
const PHASER_VERSION = '4.2.1';
const PHASER_COMMIT = '41be1e462bc600064e498cba370bfa8c5c055a22';
// Independently pinned after reading the approved tagged files. These are raw
// artifact SHA-256 values, not Git blob ids or npm package-tarball integrity.
const VENDOR = 'src/vendor/phaser/4.2.1';
const EXPECTED_ARTIFACTS = Object.freeze({
    'phaser.esm.min.js': { size: 1377611, sha256: 'f4c5fd140d118c10fa9090641a03c17303bab9bfdc28e0626296777db1bb1bde' },
    'LICENSE.md': { size: 1100, sha256: 'c3a9ba7e38d4ef33dccf5fdd1046655c63df06714f84776118fe406f43db5cf2' },
});
let checks = 0;
function check(condition, message) { checks += 1; assert.ok(condition, message); }
function same(actual, expected, message) { checks += 1; assert.deepEqual(actual, expected, message); }
function text(path) { return readFileSync(resolve(ROOT, path), 'utf8'); }
function git(...args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
function pathsAtBase() { return git('ls-tree', '-r', '--name-only', BASE).split('\n').filter(Boolean); }
function importSpecifiers(source) {
    return [/\bfrom\s+["']([^"']+)["']/g, /^\s*import\s+["']([^"']+)["']/gm,
        /\bimport\s*\(\s*["']([^"']+)["']/g]
        .flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}
function inSourceOrder(source, patterns) {
    const offsets = patterns.map((pattern) => source.search(pattern));
    return offsets.every((offset, index) => offset >= 0 && (index === 0 || offset > offsets[index - 1]));
}

// Functional Storage contract, including coercion and WebIDL-style uint32 key
// indexing. No test monkey-patches the existing PR1 tools backend.
const storage = new MemoryStorage();
same([storage.length, storage.writes, storage.getItem('absent'), storage.key(0)],
    [0, 0, null, null], 'each memory store starts empty');
storage.setItem(7, null);
storage.setItem(undefined, false);
storage.setItem('empty', '');
same([storage.getItem('7'), storage.getItem(undefined), storage.getItem('empty')],
    ['null', 'false', ''], 'keys and values use String conversion without losing empty values');
same([storage.length, storage.writes], [3, 3], 'set calls and unique-key length are distinct');
storage.setItem(7, 9);
same([storage.length, storage.writes, storage.getItem(7), storage.key(0)],
    [3, 4, '9', '7'], 'overwriting preserves insertion order and records one write');
for (const index of [0, -0, NaN, Infinity, -Infinity, undefined, null, '', '0', 0.99, 4294967296]) {
    same(storage.key(index), '7', `key uint32 coercion: ${String(index)}`);
}
for (const index of [1, '1', 1.9, 4294967297]) {
    same(storage.key(index), 'undefined', `key uint32 second entry: ${String(index)}`);
}
for (const index of [-1, 3, 4294967295]) {
    same(storage.key(index), null, `out-of-range key: ${String(index)}`);
}
storage.removeItem(7);
same([storage.length, storage.writes, storage.key(0), storage.getItem(7)],
    [2, 5, 'undefined', null], 'remove uses string keys and updates enumeration');
storage.removeItem('absent');
same(storage.writes, 6, 'absent-key removal is still a mutation API call');
storage.clear();
storage.clear();
same([storage.length, storage.writes, storage.key(0)], [0, 8, null],
    'clear counts calls, including empty clears');
same(Object.keys(storage), [], 'private map and write counter cannot leak via own enumerable fields');
same(new MemoryStorage().writes, 0, 'separate instances do not share data or counters');
assert.throws(() => { storage.length = 12; }, TypeError);
assert.throws(() => { storage.writes = 12; }, TypeError);
checks += 2;
const memorySource = text('src/platform/MemoryStorage.js');
check(!/\b(?:window|document|navigator|localStorage|sessionStorage)\s*[.(\[]/.test(memorySource),
    'memory backend has no browser-global resolution');
check(!/\bimport\s/.test(memorySource), 'memory backend has no ambient platform dependency import');
const memoryRealm = spawnSync(process.execPath, ['--input-type=module', '-e', `
    let hostReads = 0;
    for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage']) {
        Object.defineProperty(globalThis, name, { configurable: true, get() {
            hostReads++; throw new Error('MemoryStorage touched ' + name);
        } });
    }
    const { MemoryStorage } = await import('./src/platform/MemoryStorage.js');
    const memory = new MemoryStorage();
    memory.setItem('a', 'b');
    if (memory.length !== 1 || memory.key(0) !== 'a' || memory.getItem('a') !== 'b') {
        throw new Error('MemoryStorage members failed in DOM-free realm');
    }
    memory.removeItem('a'); memory.clear();
    if (hostReads !== 0 || memory.length !== 0 || memory.writes !== 3) {
        throw new Error('MemoryStorage isolation failed');
    }
`], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
check(memoryRealm.status === 0, `fresh memory import and all APIs touch no browser getter: ${memoryRealm.stderr}`);
const saveRealm = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { MemoryStorage } from './src/platform/MemoryStorage.js';
    import { SaveSystem } from './src/systems/SaveSystem.js';
    let nativeReads = 0;
    globalThis.window = {};
    for (const name of ['navigator', 'localStorage']) {
        Object.defineProperty(globalThis, name, { configurable: true, get() {
            nativeReads++; throw new Error('sandbox touched host ' + name);
        } });
    }
    const storage = new MemoryStorage();
    const save = new SaveSystem({ storage, participation: 'isolated' });
    try {
        assert.equal(save.available, true);
        assert.equal(save._saveParticipationRequired, false);
        assert.equal(save._saveParticipationState, 'unsupported');
        assert.equal(storage.writes, 2); // Probe set/remove, not a real profile.
        assert.equal(save.data.version, 10);
        assert.equal(save.data.totalCoins, 2000);
        assert.equal(save.save(), true);
        assert.equal(storage.writes, 3);
        assert.equal(JSON.parse(storage.getItem('monkey-survivor:save:v1')).version, 10);
    } finally { await save.dispose(); }
    assert.equal(nativeReads, 0);
    assert.equal(storage.writes, 3);
`], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
check(saveRealm.status === 0, `real SaveSystem uses only the new explicit memory backend: ${saveRealm.stderr}`);

const shared = { count: 2 };
const receiptSource = { simulation: { updateCalls: 0, renderCalls: 0, time: 0,
    screen: 'start', loopRunning: false }, errors: [], branches: [shared, shared] };
const receipt = detachReceipt(receiptSource);
const receiptRaw = JSON.stringify(receipt);
receiptSource.simulation.time = 99;
shared.count = 7;
receiptSource.errors.push('later mutation');
same(JSON.stringify(receipt), receiptRaw, 'receipt containers never retain source aliases');
check(receipt.branches[0] !== receipt.branches[1],
    'shared acyclic source objects become independent JSON receipt branches');
receipt.branches[0].count = 33;
same(shared.count, 7, 'mutating a receipt cannot mutate its source graph');
same(detachReceipt(Object.freeze({ nested: Object.freeze([1, null, true, 'ok']) })),
    { nested: [1, null, true, 'ok'] }, 'frozen plain JSON input is supported');
const nullPrototype = Object.create(null);
nullPrototype.value = 1;
same(detachReceipt(nullPrototype), { value: 1 }, 'null-prototype JSON dictionaries are safely normalized');
const prototypeKey = JSON.parse('{"__proto__":{"polluted":true}}');
const prototypeReceipt = detachReceipt(prototypeKey);
check(Object.getPrototypeOf(prototypeReceipt) === Object.prototype
    && Object.hasOwn(prototypeReceipt, '__proto__') && prototypeReceipt.polluted === undefined,
'JSON __proto__ keys remain data rather than mutating receipt prototypes');
let getterCalls = 0;
const accessor = Object.defineProperty({}, 'trap', { enumerable: true, get() { getterCalls++; return 1; } });
const hidden = Object.defineProperty({}, 'secret', { value: 1 });
const symbolic = { [Symbol('private')]: 1 };
const sparse = new Array(2);
const extended = [1]; extended.extra = true;
const cyclic = {}; cyclic.self = cyclic;
for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => {}, Symbol('value'),
    new Date(), new Map(), new Set(), /pattern/, new Number(2),
    Object.create({ inherited: true }), accessor, hidden, symbolic, sparse, extended, cyclic,
    { nested: undefined }, [undefined], { callback() {} }]) {
    checks += 1;
    assert.throws(() => detachReceipt(value), TypeError, 'invalid receipt values fail closed');
}
same(getterCalls, 0, 'receipt validation rejects accessors without invoking them');

// Git is the source authority, including binary assets. Do not silently skip a
// missing shallow-clone base: CI must fetch the fixed audited parent.
try { git('cat-file', '-e', `${BASE}^{commit}`); }
catch { throw new Error(`PR3 safety base ${BASE} is unavailable; fetch it before this validator.`); }
const basePaths = pathsAtBase();
const oldValidators = basePaths.filter((path) => /^tools\/validate-[^/]+\.js$/.test(path));
same(oldValidators.length, 39, 'audited base contains exactly 39 original gates');
const protectedPaths = new Set(basePaths.filter((path) => path.startsWith('src/')
    || ['index.html', 'styles.css', 'site.webmanifest'].includes(path)
    || oldValidators.includes(path)
    || /^tools\/artshot\/migration-[^/]+$/.test(path)
    || ['tools/artshot/scenarios.mjs', 'tools/artshot/verify-migration-captures.mjs'].includes(path)
    || path.startsWith('docs/evidence/phaser-migration/')));
const changedPaths = git('diff', '--name-only', BASE, '--', 'src', 'index.html', 'styles.css',
    'site.webmanifest', 'tools', 'docs/evidence/phaser-migration').split('\n').filter(Boolean);
same(changedPaths.filter((path) => protectedPaths.has(path)), [],
    'all existing src/assets, production shell, 39 gates and PR1 authorities remain unchanged');
for (const path of protectedPaths) check(existsSync(resolve(ROOT, path)), `protected authority exists: ${path}`);
same(readdirSync(resolve(ROOT, 'tools')).filter((name) => /^validate-[^/]+\.js$/.test(name)).length,
    40, 'PR3 adds exactly one top-level validator');
for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock',
    'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']) {
    check(!existsSync(resolve(ROOT, name)), `no package-manager/build switch: ${name}`);
}
const ciSource = text('.github/workflows/ci.yml');
for (const path of [...oldValidators, 'tools/validate-phaser-runtime.js']) {
    check(ciSource.includes(`run: node ${path}`), `CI retains the executable gate: ${path}`);
}

// Tagged, same-origin built ESM and its complete original license. Hash checks
// are independent of the adjacent provenance manifest, so changing both cannot
// silently bless a different engine or a reformatted/minified distribution.
for (const [name, expected] of Object.entries(EXPECTED_ARTIFACTS)) {
    const bytes = readFileSync(resolve(ROOT, VENDOR, name));
    same(bytes.length, expected.size, `tagged artifact exact bytes: ${name}`);
    same(createHash('sha256').update(bytes).digest('hex'), expected.sha256,
        `tagged artifact SHA-256: ${name}`);
}
const license = text(`${VENDOR}/LICENSE.md`);
check(license.includes('The MIT License (MIT)')
    && license.includes('Copyright (c) 2026 Richard Davey, Phaser Studio Inc.')
    && license.includes('permission notice shall be included')
    && license.includes('THE SOFTWARE IS PROVIDED "AS IS"'),
'complete tagged MIT copyright, permission and disclaimer are preserved');
const engineSource = text(`${VENDOR}/phaser.esm.min.js`);
check(/export\s*\{[^}]+\bas default\s*\};?\s*$/.test(engineSource)
    && engineSource.includes('4.2.1'), 'vendored entry is the tagged built ESM export, not raw CommonJS source');
check(text('.gitattributes').split(/\r?\n/).some((line) =>
    line.trim() === 'src/vendor/phaser/4.2.1/* -text'),
'Git preserves official vendor bytes across Windows and Linux');
const provenance = JSON.parse(text(`${VENDOR}/provenance.json`));
same({ engine: provenance.engine, version: provenance.version, tag: provenance.tag,
    commit: provenance.commit, repository: provenance.repository,
    artifactPath: provenance.artifactPath, sourceUrl: provenance.sourceUrl,
    byteSize: provenance.byteSize, sha256: provenance.sha256,
    license: provenance.license, licensePath: provenance.licensePath,
    licenseSha256: provenance.licenseSha256, releaseDate: provenance.releaseDate }, {
    engine: 'Phaser', version: PHASER_VERSION, tag: `v${PHASER_VERSION}`,
    commit: PHASER_COMMIT, repository: 'https://github.com/phaserjs/phaser',
    artifactPath: 'dist/phaser.esm.min.js',
    sourceUrl: `https://raw.githubusercontent.com/phaserjs/phaser/${PHASER_COMMIT}/dist/phaser.esm.min.js`,
    byteSize: EXPECTED_ARTIFACTS['phaser.esm.min.js'].size,
    sha256: EXPECTED_ARTIFACTS['phaser.esm.min.js'].sha256,
    license: 'MIT', licensePath: 'LICENSE.md',
    licenseSha256: EXPECTED_ARTIFACTS['LICENSE.md'].sha256,
    releaseDate: '2026-07-09T14:33:40Z',
}, 'provenance identifies the independently pinned official release, commit, bytes and license');
check(/^\d{4}-\d{2}-\d{2}$/.test(provenance.vendoredDate),
    'provenance records a concrete vendoring date');
check(typeof provenance.verification === 'string' && /SHA-256/.test(provenance.verification)
    && /validate-phaser-runtime\.js/.test(provenance.verification),
'provenance explains reproducible hash verification');
check(typeof provenance.upgrade === 'string' && /Separate reviewed PR/i.test(provenance.upgrade)
    && /stable4\.x/.test(provenance.upgrade) && /approval/i.test(provenance.upgrade),
'provenance retains the explicit approval gate for a newer stable engine');
same(readdirSync(resolve(ROOT, VENDOR)).sort(), ['LICENSE.md', 'phaser.esm.min.js', 'provenance.json'],
    'vendor payload contains only one built ESM, original license and provenance');
for (const path of basePaths.filter((path) => path.startsWith('src/') && path.endsWith('.js'))) {
    const imports = importSpecifiers(text(path));
    check(imports.every((specifier) => !/(?:^|\/)phaser(?:\/|$)|\/vendor\//i.test(specifier)),
        `production import graph does not enter experimental/vendor code: ${path}`);
}
check(!/phaser\.html|src\/phaser|src\/vendor/i.test(text('index.html') + text('site.webmanifest')),
    'default entry, manifest and production links do not activate the experiment');

// These source checks lock the zero-simulation integration choices; the separate
// CDP browser gate proves actual WebGL pixels, input quarantine and teardown.
// Static configuration is not represented as device or gameplay parity proof.
for (const path of ['phaser.html', 'src/phaser/main.js', 'src/phaser/PhaserRuntime.js',
    'src/phaser/WorldScene.js']) {
    check(existsSync(resolve(ROOT, path)), `required PR3 shell exists: ${path}`);
}
const entry = text('phaser.html');
const main = text('src/phaser/main.js');
const runtime = text('src/phaser/PhaserRuntime.js');
const scene = text('src/phaser/WorldScene.js');
same([...entry.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/g)].map((match) => match[1]),
    ['./src/phaser/main.js'], 'experimental entry has one explicit module boot');
check(/type=["']module["']/.test(entry) && /PROGRESS IS NOT SAVED/.test(entry)
    && /PHASER RUNTIME EXPERIMENT/.test(entry), 'experimental entry clearly discloses scope and no saved progress');
check(/href=["']\.\/index\.html["']/.test(entry) && /OPEN CANVAS VERSION/.test(entry),
    'failure recovery is an explicit relative Canvas navigation link');
check(!/src=["'][^"']*src\/main\.js/.test(entry)
    && !/href=["'](?:\.\/)?styles\.css/.test(entry),
'experiment does not execute production boot or replace its stylesheet');
check(/name=["']robots["'][^>]+content=["']noindex["']/.test(entry),
    'experimental page is not presented as an indexed replacement game');

for (const path of readdirSync(resolve(ROOT, 'src/phaser')).filter((name) => name.endsWith('.js'))) {
    const source = text(`src/phaser/${path}`);
    const imports = importSpecifiers(source);
    check(imports.every((specifier) => specifier.startsWith('./') || specifier.startsWith('../')),
        `experimental imports remain static-site relative, with no CDN or bare packages: ${path}`);
    check(imports.every((specifier) => !specifier.includes('/tools/') && !specifier.includes('migration-clock')),
        `tools-only fixture clocks and global overrides never enter production modules: ${path}`);
    check(!/Math\.random\s*=|(?:globalThis\.)?Date\s*=|performance\.now\s*=/.test(source),
        `experimental modules do not override gameplay RNG or time: ${path}`);
}
check(runtime.includes("../vendor/phaser/4.2.1/phaser.esm.min.js")
    && scene.includes("../vendor/phaser/4.2.1/phaser.esm.min.js"),
'runtime and thin scene import the same pinned local built engine');
check(/type\s*:\s*Phaser\.WEBGL/.test(runtime) && !/Phaser\.AUTO/.test(runtime),
    'experiment requests WebGL explicitly rather than silently falling back');
check(/new\s+SaveSystem\s*\(\s*\{[^}]*storage\s*:[^}]*participation\s*:\s*['"]isolated['"]/.test(runtime)
    && /new\s+MemoryStorage\s*\(/.test(main)
    && /state,\s*memory,\s*publish/.test(main) && /this\.memory\s*=\s*memory/.test(runtime),
'real SaveSystem explicitly owns isolated memory instead of acquiring live participation');
check(/this\.save\.available\b/.test(runtime) && !/this\.save\.storageAvailable\b/.test(runtime),
    'boot checks the real SaveSystem availability API');
check(/services\s*:\s*\{[^}]*saveSystem\s*:\s*this\.save[^}]*audio\s*:\s*this\.audio/.test(runtime),
    'the real Game borrows the already-isolated save and silent audio');
same((runtime.match(/new\s+Game\s*\(/g) ?? []).length, 1,
    'runtime has one real EMBERWAKE Game construction site');
check(/new\s+AudioSystem\s*\(\s*\{\s*contextFactory\s*:\s*null/.test(runtime)
    && /audio\s*:\s*\{\s*noAudio\s*:\s*true/.test(runtime),
'both real legacy audio and Phaser audio are explicitly silent');
check(/physics\s*:\s*\{\s*default\s*:\s*false/.test(runtime),
    'Phaser does not instantiate the gameplay physics authority');
for (const device of ['keyboard', 'mouse', 'touch', 'gamepad', 'windowEvents']) {
    check(new RegExp(`\\b${device}\\s*:\\s*false`).test(runtime), `Phaser input is disabled: ${device}`);
}
check(!/\bthis\.game\.(?:update|render|_startRun|_enterGameOver|_enterWin)\s*\(/.test(runtime)
    && !/\bthis\.loop\.start\s*\(/.test(runtime),
'no simulation, gameplay rendering, terminal reward or legacy-clock invocation is connected');
check(/this\.game\.update\s*=/.test(runtime) && /simulation\.updateCalls\+\+/.test(runtime)
    && /this\.game\.render\s*=/.test(runtime) && /simulation\.renderCalls\+\+/.test(runtime),
'dormant Game update/render have counted failure tripwires, not fake success callbacks');
for (const field of ['time', 'screen', 'loopRunning']) {
    check(new RegExp(`s\\.simulation\\.${field}\\s*=`).test(runtime),
        `receipt samples actual dormant runtime state: simulation.${field}`);
}
const sceneImports = [...scene.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1]);
same(sceneImports, ['../vendor/phaser/4.2.1/phaser.esm.min.js'],
    'thin verification scene imports no gameplay, save or content systems');
check(!/\.(?:gainXP|takeDamage|addCoins|recordRun|_startRun)\s*\(/.test(scene),
    'verification primitives do not own gameplay or reward actions');

check(main.includes("import { detachReceipt } from './Receipt.js'")
    && /detachReceipt\(state\)/.test(main) && /return\s+detachReceipt\(result\)/.test(main),
'public receipt publication uses the dynamically tested strict detached JSON helper');
check(/simulationConnected\s*:\s*false/.test(main)
    && /phaserInputDrivesSimulation\s*:\s*false/.test(main),
'receipt explicitly disclaims simulation and input integration');
const bootStart = main.indexOf('async function boot() {');
const publicApiStart = main.indexOf('window.__phaserExperiment =');
const disposeStart = main.indexOf('function dispose() {');
const denialStart = main.indexOf('function denyHostAccess(');
check(bootStart >= 0 && publicApiStart > bootStart && disposeStart >= 0 && denialStart > disposeStart,
    'source order checks identify the actual boot and disposer bodies, not missing markers');
const bootSource = main.slice(bootStart, publicApiStart);
const disposeSource = main.slice(disposeStart, denialStart);
const importSequence = [
    /denyHostAccess\(window,\s*['"]localStorage['"]/,
    /denyHostAccess\(navigator,\s*['"]locks['"]/,
    /loadingTask\s*=\s*\(async\s*\(\)\s*=>\s*\{/,
    /engineImportOnly\s*=\s*true/,
    /await\s+import\(['"]\.\.\/vendor\/phaser\/4\.2\.1\/phaser\.esm\.min\.js['"]\)/,
    /finally\s*\{\s*engineImportOnly\s*=\s*false/,
    /if\s*\(disposing\)\s*return\s+null\s*;/,
    /return\s+import\(['"]\.\/PhaserRuntime\.js['"]\)/,
    /module\s*=\s*await\s+loadingTask\s*;/,
    /if\s*\(disposing\)\s*return\s+publish\(\)\s*;/,
    /runtime\s*=\s*new\s+module\.PhaserRuntime\(/,
    /await\s+runtime\.boot\(\)/,
];
check(inSourceOrder(bootSource, importSequence),
    'guards precede the owned loading task; cancellation gates Game import and runtime construction');
same([...main.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1]),
    ['../vendor/phaser/4.2.1/phaser.esm.min.js', './PhaserRuntime.js'],
    'the two owned dynamic imports are the only late module-loading paths');
const disposeSequence = [
    /disposing\s*=\s*true\s*;/,
    /disposeTask\s*=\s*\(async\s*\(\)\s*=>\s*\{/,
    /await\s+loadingTask\s*;/,
    /await\s+runtime\?\.dispose\(\)/,
    /target\.removeEventListener\(/,
    /for\s*\(const\s+restore\s+of\s+restorers\.reverse\(\)\)\s*restore\(\)/,
    /state\.lifetime\.disposed\s*=\s*true/,
];
check(inSourceOrder(disposeSource, disposeSequence),
    'disposal joins uncancellable imports and owned runtime cleanup before restoring native host guards');
check(/try\s*\{\s*await\s+loadingTask\s*;\s*\}\s*catch\s*\{/.test(disposeSource),
    'failed imports also settle under guards before cleanup continues');
// Adversarial source mutations prove these checks do not merely accept the new
// spelling: either missing cancellation check or an early guard restore fails.
check(!inSourceOrder(bootSource.replace(/if\s*\(disposing\)\s*return\s+null\s*;/, ''), importSequence),
    'source tripwire rejects importing the real Game after cancellation');
check(!inSourceOrder(bootSource.replace(/if\s*\(disposing\)\s*return\s+publish\(\)\s*;/, ''), importSequence),
    'source tripwire rejects constructing a runtime after a cancelled in-flight import');
check(!inSourceOrder(disposeSource.replace(/await\s+loadingTask\s*;/, ''), disposeSequence),
    'source tripwire rejects restoring host getters without joining late module evaluation');
check(/key\s*===\s*'localStorage'\s*&&\s*engineImportOnly/.test(main)
    && /engineMemoryFacadeAccesses\+\+/.test(main),
'the unmodified vendor import-only feature probe receives counted memory, never the native storage getter');
check(/event\.stopImmediatePropagation\(\)/.test(main)
    && /capture\s*:\s*true/.test(main) && /['"]keydown['"]/.test(main)
    && !/event\.preventDefault\s*\(/.test(main),
'early quarantine blocks legacy game actions while preserving native link and Tab defaults');
check(/PHASER EXPERIMENT FAILED/.test(main) && /engine-import/.test(main)
    && /OPEN CANVAS VERSION/.test(main), 'import/runtime failures remain explicit instead of silently booting Canvas');
check(/if\s*\(disposeTask\)\s*return\s+disposeTask/.test(main)
    && /if\s*\(this\.disposeTask\)\s*return\s+this\.disposeTask/.test(runtime),
'shell and runtime retain idempotent disposal promises');
check(/this\.phaser\.destroy\(true,\s*false\)/.test(runtime)
    && /this\.phaser\.step\(performance\.now\(\),\s*0\)/.test(runtime)
    && /resource\.dispose\(\)/.test(runtime),
'teardown drains pinned deferred engine destruction and every explicitly owned legacy service');
check(/removeEventListener/.test(main) && /restorers\.reverse\(\)/.test(main)
    && /removeEventListener/.test(runtime) && /this\.worldCanvas\?\.remove\(\)/.test(runtime)
    && /this\.overlay\?\.remove\(\)/.test(runtime),
'teardown includes experiment listeners, native descriptor restoration and both canvases');

console.log(`Phaser runtime validation passed: ${checks} checks; Phaser ${PHASER_VERSION}, base ${BASE}. WebGL pixels/lifetime require the separate browser gate.`);
