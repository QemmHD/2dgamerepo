#!/usr/bin/env node
// Real-browser PR3 integration proof. No production runtime import, Canvas stub,
// deterministic clock, or synthetic WebGL implementation is used here.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';

const TIMEOUT = 30000;
const PARTICIPATION_LOCK = 'emberwake:save:v1:participants';
const SAVE_KEY = 'monkey-survivor:save:v1';

// Decode Chrome's actual Canvas PNG independently of the runtime pixel receipt.
// Only the browser-exported, non-interlaced RGB/RGBA8 formats are accepted.
function pngProof(png, expectedWidth, expectedHeight) {
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'real PNG signature');
    let width, height, channels;
    const chunks = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        const type = png.toString('ascii', offset + 4, offset + 8);
        const data = png.subarray(offset + 8, offset + 8 + length);
        assert.equal(data.length, length, 'complete PNG chunk');
        if (type === 'IHDR') {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            assert.equal(data[8], 8, '8-bit browser PNG');
            assert.ok([2, 6].includes(data[9]), 'RGB/RGBA browser PNG');
            assert.equal(data[12], 0, 'non-interlaced browser PNG');
            channels = data[9] === 6 ? 4 : 3;
        }
        if (type === 'IDAT') chunks.push(data);
        offset += length + 12;
        if (type === 'IEND') break;
    }
    assert.equal(width, expectedWidth);
    assert.equal(height, expectedHeight);
    const stride = width * channels;
    const filtered = inflateSync(Buffer.concat(chunks));
    assert.equal(filtered.length, height * (stride + 1));
    const pixels = Buffer.alloc(height * stride);
    const paeth = (a, b, c) => {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
        const filter = filtered[y * (stride + 1)];
        assert.ok(filter <= 4, 'valid PNG scanline filter');
        for (let x = 0; x < stride; x++) {
            const at = y * stride + x;
            const left = x >= channels ? pixels[at - channels] : 0;
            const up = y ? pixels[at - stride] : 0;
            const diagonal = y && x >= channels ? pixels[at - stride - channels] : 0;
            const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, diagonal)][filter];
            pixels[at] = (filtered[y * (stride + 1) + x + 1] + predictor) & 255;
        }
    }
    let opaque = 0, nonBlack = 0, outer = 0, outerBackground = 0, center = 0, centerEmber = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = y * stride + x * channels;
        const [r, g, b] = pixels.subarray(at, at + 3);
        const alpha = channels === 4 ? pixels[at + 3] : 255;
        if (alpha >= 240) opaque++;
        if (r + g + b > 12) nonBlack++;
        if (x < width * .2 || x > width * .8 || y < height * .2 || y > height * .8) {
            outer++;
            if (Math.abs(r - 21) <= 4 && Math.abs(g - 15) <= 4 && Math.abs(b - 24) <= 4 && alpha >= 240) outerBackground++;
        }
        if (x > width * .3 && x < width * .7 && y > height * .3 && y < height * .7) {
            center++;
            if (r > 170 && g > 70 && g < r && b < 150 && alpha >= 240) centerEmber++;
        }
    }
    const result = { width, height, opaque, nonBlack, outer, outerBackground, center, centerEmber,
        passed: opaque > width * height * .95 && nonBlack > width * height * .95
            && outerBackground > outer * .95 && centerEmber > center * .02 };
    assert.equal(result.passed, true, `independent PNG region proof ${JSON.stringify(result)}`);
    return result;
}

function optionsFrom(args) {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        assert.ok(args[i].startsWith('--'), `unexpected argument ${args[i]}`);
        const separator = args[i].indexOf('=');
        const key = args[i].slice(2, separator < 0 ? undefined : separator);
        result[key] = separator < 0 ? args[++i] : args[i].slice(separator + 1);
    }
    for (const key of ['chrome', 'base-url', 'output']) assert.ok(result[key], `missing --${key}`);
    return result;
}

async function until(read, accept, label, timeout = TIMEOUT) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        try { const value = await read(); if (accept(value)) return value; }
        catch (error) { last = error; }
        await delay(50);
    }
    throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}

class Connection {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.serial = 0;
        this.pending = new Map();
        this.events = { exceptions: [], consoleErrors: [], logErrors: [], requests: [], failedRequests: [] };
        this.pausedRequests = [];
        this.rewrites = [];
        this.interceptionErrors = [];
    }
    async open() {
        await Promise.race([
            new Promise((resolveOpen, reject) => {
                this.socket.addEventListener('open', resolveOpen, { once: true });
                this.socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
            }),
            delay(10000).then(() => { throw new Error('CDP connection timeout'); }),
        ]);
        this.socket.addEventListener('message', ({ data }) => {
            const message = JSON.parse(String(data));
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result || {});
                return;
            }
            const params = message.params;
            if (message.method === 'Fetch.requestPaused') {
                this.pausedRequests.push(params);
                if (this.onRequestPaused) void this.onRequestPaused(params).catch((error) => this.interceptionErrors.push(error.message));
            }
            if (message.method === 'Runtime.exceptionThrown') this.events.exceptions.push(params.exceptionDetails);
            if (message.method === 'Runtime.consoleAPICalled' && params.type === 'error') {
                this.events.consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description));
            }
            if (message.method === 'Log.entryAdded' && params.entry.level === 'error') this.events.logErrors.push(params.entry);
            if (message.method === 'Network.requestWillBeSent') this.events.requests.push(params.request.url);
            if (message.method === 'Network.responseReceived' && params.response.status >= 400) {
                this.events.failedRequests.push({ url: params.response.url, status: params.response.status });
            }
        });
        this.socket.addEventListener('close', () => {
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(new Error('CDP closed'));
            }
            this.pending.clear();
        });
    }
    send(method, params = {}) {
        const id = ++this.serial;
        return new Promise((resolveSend, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP ${method} timed out`));
            }, TIMEOUT);
            this.pending.set(id, { resolve: resolveSend, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
        return result.result.value;
    }
    close() { try { this.socket.close(); } catch {} }
}

// This function is serialized and installed BEFORE every document/iframe module.
// Its own trusted-input observer and inspection RAFs use captured native methods
// and are excluded from application-lifetime counts. Native services are wrapped
// transparently, not denied or replaced with fakes. The runtime's separate guards
// are asserted too, because those intentionally deny host access before it gets here.
function installBrowserProbe() {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const records = [];
    const frames = new Set();
    const contexts = new Map();
    const propertyKeys = ['onblur', 'onfocus', 'onpagehide', 'onpageshow', 'onresize', 'onorientationchange'];
    const originalProperties = Object.fromEntries(propertyKeys.map((key) => [key, window[key]]));
    const counters = {
        storageGetters: 0, storageReads: 0, storageWrites: 0,
        lockGetters: 0, lockRequests: 0, audioContexts: 0,
        trustedKeydowns: 0, trustedLastKey: '', rafRequested: 0, rafCancelled: 0,
    };
    const capture = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (!listener) return add.call(this, type, listener, options);
        const useCapture = capture(options);
        let record = records.find((entry) => entry.active && !entry.signal?.aborted && entry.target === this
            && entry.type === type && entry.listener === listener && entry.capture === useCapture);
        if (!record) {
            record = { target: this, type, listener, capture: useCapture, active: !options?.signal?.aborted,
                once: !!options?.once, signal: options?.signal, stack: new Error('listener registration').stack };
            record.wrapper = function (event) {
                if (record.once) record.active = false;
                return typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event);
            };
            records.push(record);
        }
        try { return add.call(this, type, record.wrapper, options); }
        catch (error) { record.active = false; throw error; }
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        const record = records.find((entry) => entry.active && !entry.signal?.aborted && entry.target === this
            && entry.type === type && entry.listener === listener && entry.capture === capture(options));
        if (record) record.active = false;
        return remove.call(this, type, record?.wrapper || listener, options);
    };
    window.requestAnimationFrame = (callback) => {
        counters.rafRequested++;
        let id;
        id = raf((time) => { frames.delete(id); callback(time); });
        frames.add(id);
        return id;
    };
    window.cancelAnimationFrame = (id) => {
        counters.rafCancelled++;
        frames.delete(id);
        return cancel(id);
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        const context = getContext.call(this, type, ...args);
        const entries = contexts.get(this) || new Map();
        entries.set(type, !!context);
        contexts.set(this, entries);
        return context;
    };
    function descriptor(object, key) {
        for (let current = object; current; current = Object.getPrototypeOf(current)) {
            const found = Object.getOwnPropertyDescriptor(current, key);
            if (found) return found;
        }
        return null;
    }
    const storageDescriptor = descriptor(window, 'localStorage');
    const rawStorage = () => storageDescriptor.get.call(window);
    const storageRead = Storage.prototype.getItem;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() {
        counters.storageGetters++; return rawStorage();
    } });
    Storage.prototype.getItem = function (...args) { counters.storageReads++; return storageRead.apply(this, args); };
    for (const name of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[name];
        Storage.prototype[name] = function (...args) { counters.storageWrites++; return original.apply(this, args); };
    }
    const locksDescriptor = descriptor(navigator, 'locks');
    const rawLocks = locksDescriptor ? () => locksDescriptor.get.call(navigator) : () => null;
    const manager = rawLocks();
    const rawQuery = manager ? manager.query.bind(manager) : null;
    if (locksDescriptor) Object.defineProperty(navigator, 'locks', { configurable: true, get() {
        counters.lockGetters++; return rawLocks();
    } });
    if (manager) {
        const prototype = Object.getPrototypeOf(manager);
        const request = prototype.request;
        prototype.request = function (...args) { counters.lockRequests++; return request.apply(this, args); };
    }
    for (const name of ['AudioContext', 'webkitAudioContext']) {
        if (typeof window[name] !== 'function') continue;
        const Original = window[name];
        window[name] = new Proxy(Original, { construct(target, args, newTarget) {
            counters.audioContexts++; return Reflect.construct(target, args, newTarget);
        } });
    }
    add.call(window, 'keydown', (event) => {
        if (event.isTrusted) { counters.trustedKeydowns++; counters.trustedLastKey = event.key; }
    }, true);
    const label = (target) => target === window ? 'window' : target === document ? 'document'
        : target === window.visualViewport ? 'visualViewport'
            : `${target.constructor?.name || 'EventTarget'}${target.id ? `#${target.id}` : ''}`;
    window.__phaserBrowserProbe = Object.freeze({
        async settle() { await new Promise((done) => raf(() => raf(done))); },
        selfCheck() {
            const active = () => records.filter((entry) => entry.active && !entry.signal?.aborted).length;
            const baseline = active(), pending = frames.size, checks = [];
            let calls = 0;
            const callback = () => { calls++; };
            window.addEventListener('__phaser_verifier_probe', callback);
            checks.push(active() === baseline + 1);
            window.addEventListener('__phaser_verifier_probe', callback);
            checks.push(active() === baseline + 1);
            window.dispatchEvent(new Event('__phaser_verifier_probe'));
            window.removeEventListener('__phaser_verifier_probe', callback);
            checks.push(active() === baseline && calls === 1);
            window.addEventListener('__phaser_verifier_probe', callback, { once: true });
            window.dispatchEvent(new Event('__phaser_verifier_probe'));
            checks.push(active() === baseline && calls === 2);
            const controller = new AbortController();
            window.addEventListener('__phaser_verifier_probe', callback, { signal: controller.signal });
            controller.abort();
            checks.push(active() === baseline);
            window.addEventListener('__phaser_verifier_probe', callback);
            checks.push(active() === baseline + 1);
            window.removeEventListener('__phaser_verifier_probe', callback);
            const frame = window.requestAnimationFrame(() => {});
            checks.push(frames.size === pending + 1);
            window.cancelAnimationFrame(frame);
            checks.push(frames.size === pending && active() === baseline);
            return { checks, passed: checks.every(Boolean) };
        },
        async hostState() {
            return { save: storageRead.call(rawStorage(), 'monkey-survivor:save:v1'),
                locks: rawQuery ? await rawQuery() : null };
        },
        snapshot(includeStacks = false) {
            const active = records.filter((entry) => entry.active && !entry.signal?.aborted);
            return JSON.parse(JSON.stringify({ installed: true, ...counters,
                listenersAdded: records.length, activeListenerCount: active.length,
                propertyHandlersRestored: Object.fromEntries(propertyKeys.map((key) => [key, window[key] === originalProperties[key]])),
                activeListeners: active.map((entry) => ({ target: label(entry.target), type: entry.type, capture: entry.capture,
                    ...(includeStacks ? { registrationStack: entry.stack } : {}) })),
                pendingRAF: frames.size,
                canvases: [...document.querySelectorAll('canvas')].map((canvas) => ({ id: canvas.id,
                    width: canvas.width, height: canvas.height, role: canvas.getAttribute('role'),
                    label: canvas.getAttribute('aria-label'),
                    contexts: Object.fromEntries(contexts.get(canvas) || []),
                })),
            }));
        },
    });
}

function assertQuiet(connection, label) {
    assert.deepEqual(connection.events.exceptions, [], `${label}: uncaught JavaScript exception`);
    assert.deepEqual(connection.events.consoleErrors, [], `${label}: console.error`);
    assert.deepEqual(connection.events.logErrors, [], `${label}: browser error log`);
    assert.deepEqual(connection.events.failedRequests, [], `${label}: HTTP error`);
}

function assertNoHostServices(probe, receipt, label) {
    for (const key of ['storageGetters', 'storageReads', 'storageWrites', 'lockGetters', 'lockRequests', 'audioContexts']) {
        assert.equal(probe[key], 0, `${label}: native ${key}`);
    }
    assert.equal(receipt.storage.hostStorageAccesses, 0, `${label}: runtime host-storage guard`);
    assert.equal(receipt.locks.hostLockAccesses, 0, `${label}: runtime host-lock guard`);
}

function assertLive(receipt, probe, label) {
    assert.equal(receipt.phaserVersion, receipt.expectedPinnedVersion, `${label}: pinned Phaser version`);
    assert.match(receipt.phaserVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(receipt.renderer.webgl, true, `${label}: actual WebGL renderer`);
    assert.match(receipt.renderer.contextType, /webgl/i);
    assert.equal(receipt.boot.sceneReady, true);
    assert.equal(receipt.boot.frameRendered, true);
    assert.equal(receipt.boot.gameConstructed, true);
    assert.equal(receipt.boot.simulationConnected, false);
    assert.equal(receipt.boot.isolatedSave, true);
    assert.equal(receipt.boot.audioMode, 'silent-no-context');
    assert.equal(receipt.boot.physicsEnabled, false);
    assert.equal(receipt.boot.phaserInputDrivesSimulation, false);
    assert.equal(receipt.lifetime.activeGameCount, 1);
    assert.equal(receipt.lifetime.disposed, false);
    assert.equal(receipt.lifetime.ownedSaveParticipants, 0);
    assert.equal(receipt.lifetime.canvasCount, 2);
    assert.equal(receipt.simulation.time, 0);
    assert.equal(receipt.simulation.screen, 'start');
    assert.equal(receipt.simulation.updateCalls, 0);
    assert.equal(receipt.simulation.renderCalls, 0);
    assert.equal(receipt.simulation.loopRunning, false);
    assert.equal(receipt.renderer.overlay.alpha, true, `${label}: transparent real Canvas overlay`);
    assert.match(receipt.renderer.overlay.background, /^(?:transparent|rgba\(0, 0, 0, 0\))$/);
    for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(receipt.renderer.cssViewport[key] - receipt.renderer.overlay.cssViewport[key]) < 1,
            `${label}: stacked world/overlay ${key}`);
    }
    assert.equal(receipt.pixels.passed, true, `${label}: framebuffer pixel proof`);
    assert.ok(receipt.pixels.nonBlack > 0 && receipt.pixels.nonTransparent > 0 && receipt.pixels.distinctColors > 1);
    assert.ok(receipt.pixels.emberPixels > 0 && receipt.pixels.backgroundPixels > 0);
    assert.ok(receipt.storage.memoryWrites > 0, `${label}: real SaveSystem writes isolated memory`);
    assert.equal(receipt.storage.engineMemoryFacadeAccesses, 1, `${label}: known vendor import-only memory capability probe`);
    assert.equal(receipt.errors.exceptionCount, 0);
    assert.equal(receipt.errors.unhandledRejectionCount, 0);
    assert.equal(receipt.errors.webglErrorCount, 0);
    assert.equal(probe.installed, true);
    assert.equal(probe.canvases.length, 2);
    assert.equal(probe.canvases.filter((canvas) => canvas.contexts['2d']).length, 1);
    assert.equal(probe.canvases.filter((canvas) => canvas.contexts.webgl || canvas.contexts.webgl2 || canvas.contexts['experimental-webgl']).length, 1);
    assertNoHostServices(probe, receipt, label);
}

function assertDisposed(receipt, probe, label) {
    assert.equal(receipt.lifetime.disposed, true, `${label}: disposed receipt`);
    for (const key of ['activeGameCount', 'ownedSaveParticipants', 'shellListeners', 'canvasCount', 'sceneCount', 'textureCount']) {
        assert.equal(receipt.lifetime[key], 0, `${label}: lifetime.${key}`);
    }
    assert.equal(receipt.lifetime.phaserLoopRunning, false);
    assert.equal(receipt.lifetime.phaserRAFRunning, false);
    assert.equal(probe.pendingRAF, 0, `${label}: pending native RAF`);
    assert.equal(probe.activeListenerCount, 0, `${label}: remaining listeners ${JSON.stringify(probe.activeListeners)}`);
    assert.equal(probe.canvases.length, 0);
    assert.ok(Object.values(probe.propertyHandlersRestored).every(Boolean), `${label}: native window property handlers restored`);
    assertNoHostServices(probe, receipt, label);
}

function participants(host) {
    assert.ok(host.locks, 'native Web Locks must be available in the real browser');
    return host.locks.held.filter((lock) => lock.name === PARTICIPATION_LOCK)
        .map(({ name, mode, clientId }) => ({ name, mode, clientId }))
        .sort((left, right) => left.clientId.localeCompare(right.clientId));
}

async function main() {
    const options = optionsFrom(process.argv.slice(2));
    const output = resolve(options.output);
    const base = new URL(options['base-url'].replace(/\/?$/, '/'));
    assert.ok(['http:', 'https:'].includes(base.protocol), '--base-url must be an HTTP(S) static game origin');
    await mkdir(output, { recursive: true });
    const profile = await mkdtemp(join(tmpdir(), 'emberwake-phaser-verifier-'));
    const args = ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-networking',
        '--disable-component-update', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--force-device-scale-factor=1', '--window-size=1280,720', `--user-data-dir=${profile}`,
        '--remote-debugging-port=0', 'about:blank'];
    const browser = spawn(options.chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    let launchError = null;
    browser.on('error', (error) => { launchError = error; });
    browser.stderr.on('data', (data) => { diagnostics = (diagnostics + data).slice(-16000); });
    browser.stdout.on('data', (data) => { diagnostics = (diagnostics + data).slice(-16000); });
    const exited = new Promise((done) => browser.once('exit', done));
    const connections = [];
    const report = { kind: 'actual-chrome-software-webgl-lifetime', hardwarePerformanceClaim: false,
        baseUrl: base.href, browserFlags: args.filter((value) => !value.startsWith('--user-data-dir')),
        instrumentation: 'Native DOM listeners, RAF, Canvas context acquisition, host storage/locks/audio before document modules; probe-owned observers excluded.',
        cycles: [], production: {}, contextLoss: null, passed: false };
    let browserConnection;
    try {
        const portData = await until(async () => {
            if (launchError) throw launchError;
            return readFile(join(profile, 'DevToolsActivePort'), 'utf8');
        }, Boolean, 'Chrome debugging port', 10000);
        const [port, browserPath] = portData.trim().split(/\r?\n/);
        const endpoint = `http://127.0.0.1:${port}`;
        browserConnection = new Connection(`ws://127.0.0.1:${port}${browserPath}`);
        await browserConnection.open();
        connections.push(browserConnection);
        async function newPage(url, { blockEngine = false, noWebGL = false, pauseEngine = false,
            disposeBeforeReady = false, rewriteResponse = null } = {}) {
            const response = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
            assert.equal(response.ok, true, 'create Chrome page');
            const target = await response.json();
            const connection = new Connection(target.webSocketDebuggerUrl);
            await connection.open();
            connections.push(connection);
            for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await connection.send(method);
            await connection.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720,
                deviceScaleFactor: 1, mobile: false });
            await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installBrowserProbe.toString()})()` });
            if (blockEngine) await connection.send('Network.setBlockedURLs', { urls: ['*vendor/phaser/*'] });
            if (pauseEngine) {
                await connection.send('Network.setCacheDisabled', { cacheDisabled: true });
                await connection.send('Fetch.enable', { patterns: [{ urlPattern: '*phaser.esm.min.js', requestStage: 'Request' }] });
            }
            if (rewriteResponse) {
                connection.onRequestPaused = async (request) => {
                    assert.equal(request.responseStatusCode, 200, 'fault injection starts from the actual module response');
                    const { body, base64Encoded } = await connection.send('Fetch.getResponseBody', { requestId: request.requestId });
                    const source = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
                    assert.equal(source.split(rewriteResponse.find).length, 2, 'exactly one bounded test-only module injection');
                    const rewritten = source.replace(rewriteResponse.find, rewriteResponse.replace);
                    connection.rewrites.push({ url: request.request.url, marker: rewriteResponse.marker, matches: 1 });
                    await connection.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
                        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
                        body: Buffer.from(rewritten).toString('base64') });
                };
                await connection.send('Network.setCacheDisabled', { cacheDisabled: true });
                await connection.send('Fetch.enable', { patterns: [{ urlPattern: rewriteResponse.pattern, requestStage: 'Response' }] });
            }
            if (noWebGL) await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
                const original = HTMLCanvasElement.prototype.getContext;
                HTMLCanvasElement.prototype.getContext = function(type,...args) {
                    return /webgl/i.test(type) ? null : original.call(this,type,...args);
                };
            }` });
            if (disposeBeforeReady) await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
                const original = HTMLCanvasElement.prototype.getContext;let fired=false;
                HTMLCanvasElement.prototype.getContext=function(type,...args){
                    const context=original.call(this,type,...args);
                    if(!fired&&context&&this.id==='phaser-world'&&/webgl/i.test(type)){
                        fired=true;queueMicrotask(()=>{
                            window.__phaserEarlyBefore=window.__phaserExperiment.receipt();
                            window.__phaserEarlyDispose=window.__phaserExperiment.dispose();
                            void window.__phaserEarlyDispose.catch(()=>{});
                        });
                    }return context;
                };
            }` });
            await connection.send('Page.navigate', { url });
            return connection;
        }
        async function key(connection, keyName, code, keyCode) {
            await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code,
                windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
            await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code,
                windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
        }
        async function screenshot(connection, name) {
            const result = await connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            await writeFile(join(output, name), Buffer.from(result.data, 'base64'));
        }
        const production = await newPage(new URL('index.html', base).href);
        await until(async () => {
            const state = await production.evaluate(`({readyState:document.readyState,
                canvasLabel:document.querySelector('#game')?.getAttribute('aria-label'),
                canvasCount:document.querySelectorAll('canvas').length,resources:performance.getEntriesByType('resource').length})`);
            report.currentCheck = { label: 'production main.js boot', state };
            return state;
        }, (state) => state.readyState === 'complete' && state.canvasLabel === 'EMBERWAKE main menu', 'production main.js boot');
        delete report.currentCheck;
        await production.evaluate('document.fonts.ready.then(() => window.__phaserBrowserProbe.settle())');
        await production.send('Page.bringToFront');
        await key(production, 'Tab', 'Tab', 9);
        const focus = await production.evaluate(`({active:document.activeElement?.id, status:document.getElementById('game-status')?.textContent})`);
        assert.equal(focus.active, 'game', 'trusted keyboard focuses the production Canvas');
        assert.match(focus.status, /Focused:/, 'real production menu keyboard path');
        await key(production, 'Enter', 'Enter', 13);
        await production.evaluate('window.__phaserBrowserProbe.settle()');
        const productionProbe = await production.evaluate('window.__phaserBrowserProbe.snapshot()');
        assert.equal(productionProbe.canvases.length, 1);
        assert.equal(productionProbe.canvases[0].contexts['2d'], true);
        assert.ok(!Object.keys(productionProbe.canvases[0].contexts).some((type) => /webgl/i.test(type)));
        assert.ok(productionProbe.trustedKeydowns >= 2);
        assert.equal(productionProbe.trustedLastKey, 'Enter');
        assert.ok(productionProbe.storageGetters > 0 && productionProbe.storageWrites > 0);
        assert.ok(productionProbe.lockGetters > 0 && productionProbe.lockRequests > 0);
        assert.equal(productionProbe.audioContexts, 1, 'production constructs its real native AudioContext');
        const before = await until(() => production.evaluate('window.__phaserBrowserProbe.hostState()'),
            (host) => participants(host).length === 1, 'single production native-save participant');
        assert.ok(before.save, `production persists ${SAVE_KEY}`);
        report.production = { trustedFocus: focus, probe: productionProbe, before };
        await screenshot(production, 'production-entry.png');

        const harness = await newPage(new URL('tools/artshot/phaser-harness.html', base).href);
        await until(() => harness.evaluate('!!window.__phaserHarness?.ready'), Boolean, 'Phaser harness public API');
        await harness.evaluate('window.__phaserHarness.ready');
        const frame = `document.getElementById('experiment-frame').contentWindow`;
        report.instrumentationSelfCheck = await harness.evaluate(`${frame}.__phaserBrowserProbe.selfCheck()`);
        assert.equal(report.instrumentationSelfCheck.passed, true, 'browser lifetime probe detects/removes a real listener and RAF');
        for (let index = 0; index < 10; index++) {
            const live = await harness.evaluate(`(async()=>{const w=${frame};await w.__phaserExperiment.ready;await w.__phaserBrowserProbe.settle();return {receipt:w.__phaserExperiment.receipt(),probe:w.__phaserBrowserProbe.snapshot()};})()`);
            report.currentCheck = { label: `cycle ${index + 1} live`, live };
            assertLive(live.receipt, live.probe, `cycle ${index + 1} live`);
            if (index === 0) {
                await harness.send('Page.bringToFront');
                await harness.evaluate(`document.getElementById('experiment-frame').focus();${frame}.focus()`);
                await key(harness, 'Enter', 'Enter', 13);
                await key(harness, 'Enter', 'Enter', 13);
                const afterKeys = await harness.evaluate(`({receipt:${frame}.__phaserExperiment.receipt(),probe:${frame}.__phaserBrowserProbe.snapshot()})`);
                assert.ok(afterKeys.probe.trustedKeydowns >= 2, 'trusted Enter reaches experimental iframe realm');
                assert.equal(afterKeys.receipt.simulation.screen, 'start', 'real Game must remain dormant after Enter twice');
                assert.equal(afterKeys.receipt.simulation.time, 0);
                assert.equal(afterKeys.receipt.simulation.updateCalls, 0);
                assert.equal(afterKeys.receipt.simulation.renderCalls, 0);
                assert.equal(afterKeys.receipt.simulation.loopRunning, false);
                const detached = await harness.evaluate(`(()=>{const api=${frame}.__phaserExperiment;const a=api.receipt();a.boot.simulationConnected=true;a.storage.memoryWrites=-1;a.pixels.passed=false;const b=api.receipt();return !b.boot.simulationConnected&&b.storage.memoryWrites>=0&&b.pixels.passed;})()`);
                assert.equal(detached, true, 'receipt mutation cannot alias live runtime state');
                report.experimentalTrustedKeys = afterKeys;
                await key(harness, 'Tab', 'Tab', 9);
                const nativeTabTarget = await harness.evaluate(`${frame}.document.activeElement?.id`);
                assert.equal(nativeTabTarget, 'canvas-link', 'input quarantine preserves native keyboard link focus');
                report.experimentalNativeTabTarget = nativeTabTarget;
                report.resizes = [];
                for (const size of [{ width: 960, height: 640 }, { width: 1280, height: 720 }]) {
                    await harness.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
                    await until(() => harness.evaluate(`(()=>{const w=${frame};return {viewport:w.innerWidth,
                        stage:w.document.getElementById('experiment-stage').getBoundingClientRect().width,
                        canvas:w.__phaserExperiment.receipt().renderer.cssViewport.width};})()`),
                    (value) => value.viewport === size.width && value.stage > 0 && Math.abs(value.canvas - value.stage) < 1
                        && (size.width === 960 ? value.canvas < live.receipt.renderer.cssViewport.width - 1
                            : Math.abs(value.canvas - live.receipt.renderer.cssViewport.width) < 1),
                    `actual experiment resize ${size.width}`);
                    await harness.evaluate(`${frame}.__phaserBrowserProbe.settle()`);
                    const resized = await harness.evaluate(`({receipt:${frame}.__phaserExperiment.receipt(),probe:${frame}.__phaserBrowserProbe.snapshot()})`);
                    assertLive(resized.receipt, resized.probe, `resized ${size.width}x${size.height}`);
                    for (const key of ['width', 'height']) {
                        const canvasKey = key === 'width' ? 'canvasWidth' : 'canvasHeight';
                        assert.ok(Math.abs(resized.receipt.renderer[canvasKey] - resized.receipt.renderer.cssViewport[key]) <= 1);
                        assert.equal(resized.receipt.renderer.overlay[key], resized.receipt.renderer[canvasKey]);
                    }
                    report.resizes.push({ viewport: size, ...resized });
                }
                await screenshot(harness, 'harness-live.png');
                const during = await production.evaluate('window.__phaserBrowserProbe.hostState()');
                assert.deepEqual(participants(during), participants(before), 'experiment cannot join production save participation');
                assert.equal(during.save, before.save, 'experiment cannot alter production save bytes');
                report.production.during = during;
            }
            const disposed = await harness.evaluate(`(async()=>{const w=${frame};const first=w.__phaserExperiment.dispose();const second=w.__phaserExperiment.dispose();const samePromise=first===second;await first;await w.__phaserBrowserProbe.settle();return {samePromise,receipt:w.__phaserExperiment.receipt(),probe:w.__phaserBrowserProbe.snapshot(true)};})()`);
            report.currentCheck = { label: `cycle ${index + 1} disposed`, disposed };
            assert.equal(disposed.samePromise, true, `cycle ${index + 1}: cached dispose promise`);
            assertDisposed(disposed.receipt, disposed.probe, `cycle ${index + 1} disposed`);
            report.cycles.push({ index: index + 1, live, disposed });
            delete report.currentCheck;
            console.log(`PASS Phaser browser cycle ${index + 1}/10: actual WebGL pixels; zero disposed listeners/RAF/canvases/participants`);
            if (index < 9) await harness.evaluate('window.__phaserHarness.cycle()');
        }
        await harness.evaluate('window.__phaserHarness.dispose()');
        assertQuiet(harness, 'harness ten cycles');

        const experiment = await newPage(new URL('phaser.html', base).href);
        await until(() => experiment.evaluate('!!window.__phaserExperiment?.ready'), Boolean, 'direct Phaser public API');
        await experiment.evaluate('window.__phaserExperiment.ready');
        const direct = await experiment.evaluate('({receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot()})');
        assertLive(direct.receipt, direct.probe, 'actual phaser.html');
        await screenshot(experiment, 'phaser-live.png');
        const png = await experiment.evaluate('window.__phaserExperiment.capture()');
        assert.match(png, /^data:image\/png;base64,/);
        const pngBytes = Buffer.from(png.split(',')[1], 'base64');
        await writeFile(join(output, 'phaser-framebuffer.png'), pngBytes);
        report.independentPngProof = pngProof(pngBytes, direct.receipt.renderer.canvasWidth, direct.receipt.renderer.canvasHeight);
        report.direct = direct;
        report.contextLoss = await experiment.evaluate('window.__phaserExperiment.contextLossProbe()');
        assert.equal(report.contextLoss.supported, true, 'software WebGL provides native WEBGL_lose_context');
        assert.equal(report.contextLoss.lostObserved, true, 'actual context-lost event observed');
        assert.ok(report.contextLoss.renderedAfterRestore || report.contextLoss.safeFailure,
            'context loss must restore rendering or fail safely');
        if (report.contextLoss.renderedAfterRestore) assert.equal(report.contextLoss.restoreObserved, true);
        assert.equal(report.contextLoss.lateRestoreNoResurrection, true, 'late context restore cannot revive disposed runtime');
        await experiment.evaluate('window.__phaserExperiment.dispose().then(() => window.__phaserBrowserProbe.settle())');
        report.directDisposed = await experiment.evaluate('({receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot()})');
        assertDisposed(report.directDisposed.receipt, report.directDisposed.probe, 'context-probed direct entry');
        const after = await production.evaluate('window.__phaserBrowserProbe.hostState()');
        assert.deepEqual(participants(after), participants(before), 'production retains the same sole save-lock owner');
        assert.equal(after.save, before.save, 'production native save payload is unchanged');
        report.production.after = after;
        const phaserRequests = production.events.requests.filter((url) => /(?:\/vendor\/phaser|\/src\/phaser|\/experimental|\/phaser\.html|\/phaser(?:\.min)?\.js)(?:[/?#]|$)/i.test(url));
        assert.deepEqual(phaserRequests, [], 'production index must not request experimental/Phaser resources');
        assertQuiet(experiment, 'direct Phaser/context loss');
        assertQuiet(production, 'production tab');
        report.failures = [];
        for (const scenario of [
            { name: 'engine-import', options: { blockEngine: true } },
            { name: 'webgl-unavailable', options: { noWebGL: true } },
            { name: 'isolated-save', options: { rewriteResponse: {
                pattern: '*src/systems/SaveSystem.js', find: 'constructor(options = {}) {',
                replace: "constructor(options = {}) { throw new Error('verifier-injected-save-constructor');",
                marker: 'verifier-injected-save-constructor',
            } } },
            { name: 'scene-boot', expectedException: 'verifier-injected-scene-create', options: { rewriteResponse: {
                pattern: '*src/phaser/WorldScene.js', find: 'create() {',
                replace: "create() { throw new Error('verifier-injected-scene-create');",
                marker: 'verifier-injected-scene-create',
            } } },
        ]) {
            const page = await newPage(new URL('phaser.html', base).href, scenario.options);
            await until(() => page.evaluate('!!window.__phaserExperiment?.ready'), Boolean, `${scenario.name} API`);
            const completed = await page.evaluate(`(async()=>{let timer;try{return await Promise.race([
                window.__phaserExperiment.ready.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);
            }finally{clearTimeout(timer);}})()`);
            if (!completed) {
                report.currentCheck = { label: `${scenario.name} boot did not settle`,
                    state: await page.evaluate('({receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot(true)})'),
                    interceptionErrors: page.interceptionErrors };
            }
            assert.equal(completed, true, `${scenario.name}: failure must settle without a READY/dispose deadlock`);
            const cleanupError = await page.evaluate(`(async()=>{
                const serialize=(error,depth=0)=>({name:error.name,message:error.message,stack:error.stack,
                    ...(depth<3&&error.errors?{errors:[...error.errors].map(e=>serialize(e,depth+1))}:{}),
                    ...(depth<3&&error.cause?{cause:serialize(error.cause,depth+1)}:{})});
                let error=null;try{await window.__phaserExperiment.dispose();}catch(e){error=serialize(e);}
                await window.__phaserBrowserProbe.settle();return error;
            })()`);
            const failure = await page.evaluate(`({receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot(true),
                status:document.getElementById('experiment-status').textContent,
                detail:document.getElementById('experiment-detail').textContent,
                link:document.getElementById('canvas-link').href, failed:document.body.dataset.failed})`);
            report.failures.push({ scenario: scenario.name, ...failure, cleanupError, browserEvents: page.events,
                rewrites: page.rewrites, expectedInjectedException: scenario.expectedException || null });
            assert.deepEqual(page.interceptionErrors, []);
            if (scenario.options.rewriteResponse) assert.equal(page.rewrites.length, 1);
            assert.equal(cleanupError, null, `${scenario.name}: cleanup ${JSON.stringify(cleanupError)}`);
            assert.equal(failure.receipt.failure, scenario.name, `${scenario.name}: specific truthful failure classification`);
            assert.equal(failure.failed, 'true');
            assert.match(failure.status, /PHASER EXPERIMENT FAILED/);
            assert.match(failure.detail, /not switched to the Canvas game/);
            assert.equal(failure.link, new URL('index.html', base).href);
            assertDisposed(failure.receipt, failure.probe, scenario.name);
            assert.equal(failure.receipt.simulation.updateCalls, 0);
            assert.equal(failure.receipt.simulation.renderCalls, 0);
            assert.equal(failure.receipt.errors.exceptionCount, scenario.expectedException ? page.events.exceptions.length : 0);
            assert.equal(failure.receipt.errors.unhandledRejectionCount, 0);
            if (scenario.expectedException) {
                assert.ok(page.events.exceptions.length <= 1, 'at most the intentionally injected Scene.create exception');
                assert.ok(page.events.exceptions.every((exception) => JSON.stringify(exception).includes(scenario.expectedException)));
            } else assert.deepEqual(page.events.exceptions, [], `${scenario.name}: handled failure, not uncaught exception`);
            assert.deepEqual(page.events.consoleErrors, [], `${scenario.name}: no application console.error`);
            // An intentionally blocked vendor request produces an expected
            // browser network error; retain it, do not call it a runtime error.
            if (!scenario.options.blockEngine && !scenario.expectedException) assertQuiet(page, scenario.name);
            else if (scenario.expectedException) {
                assert.deepEqual(page.events.failedRequests, []);
                assert.ok(page.events.logErrors.every((entry) => JSON.stringify(entry).includes(scenario.expectedException)),
                    'only the intentionally injected Scene.create error may be logged');
            }
            else {
                assert.deepEqual(page.events.failedRequests, []);
                const unexpectedLogs = page.events.logErrors.filter((entry) => entry.source !== 'network'
                    || !/vendor\/phaser/.test(`${entry.url || ''} ${entry.text || ''}`));
                assert.deepEqual(unexpectedLogs, [], 'only the deliberately blocked vendor request may log a network error');
            }
            await screenshot(page, `failure-${scenario.name}.png`);
        }
        const paused = await newPage(new URL('phaser.html', base).href, { pauseEngine: true });
        const pausedRequest = await until(() => paused.pausedRequests[0], Boolean, 'paused native vendor request');
        const cancellationBefore = await paused.evaluate(`(()=>{void window.__phaserExperiment.dispose();return {
            receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot()};})()`);
        assert.equal(cancellationBefore.receipt.boot.gameConstructed, false);
        assert.equal(cancellationBefore.receipt.lifetime.disposed, false, 'dispose waits for the in-flight engine import');
        await paused.send('Fetch.continueRequest', { requestId: pausedRequest.requestId });
        await paused.evaluate('window.__phaserExperiment.ready');
        await paused.evaluate('window.__phaserExperiment.dispose().then(() => window.__phaserBrowserProbe.settle())');
        const cancellationAfter = await paused.evaluate('({receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot(true)})');
        report.cancelDuringImport = { before: cancellationBefore, after: cancellationAfter };
        assertDisposed(cancellationAfter.receipt, cancellationAfter.probe, 'cancellation during actual engine import');
        assert.equal(cancellationAfter.receipt.boot.gameConstructed, false);
        assert.equal(cancellationAfter.receipt.storage.engineMemoryFacadeAccesses, 1);
        assertQuiet(paused, 'cancellation during engine import');
        const early = await newPage(new URL('phaser.html', base).href, { disposeBeforeReady: true });
        await until(() => early.evaluate('!!window.__phaserEarlyDispose'), Boolean, 'dispose microtask before Phaser READY');
        const earlyResult = await early.evaluate(`(async()=>{
            const results=await Promise.allSettled([window.__phaserEarlyDispose,window.__phaserExperiment.ready]);
            await new Promise(resolve=>setTimeout(resolve,500));await window.__phaserBrowserProbe.settle();
            return {before:window.__phaserEarlyBefore,results:results.map(result=>({status:result.status,
                ...(result.reason?{error:String(result.reason),stack:result.reason.stack}:{})})),
                cached:window.__phaserEarlyDispose===window.__phaserExperiment.dispose(),
                receipt:window.__phaserExperiment.receipt(),probe:window.__phaserBrowserProbe.snapshot(true)};
        })()`);
        report.cancelBeforeEngineReady = earlyResult;
        assert.equal(earlyResult.before.boot.gameConstructed, true);
        assert.equal(earlyResult.before.boot.sceneReady, false);
        assert.equal(earlyResult.before.boot.frameRendered, false);
        assert.equal(earlyResult.before.lifetime.activeGameCount, 1);
        assert.equal(earlyResult.cached, true);
        assert.ok(earlyResult.results.every((result) => result.status === 'fulfilled'), JSON.stringify(earlyResult.results));
        assertDisposed(earlyResult.receipt, earlyResult.probe, 'dispose before engine default textures/READY');
        assert.equal(earlyResult.receipt.simulation.updateCalls, 0);
        assert.equal(earlyResult.receipt.simulation.renderCalls, 0);
        assertQuiet(early, 'dispose before engine READY');
        const finalHost = await production.evaluate('window.__phaserBrowserProbe.hostState()');
        assert.deepEqual(participants(finalHost), participants(before), 'all failure and cancellation paths preserve the production save-lock owner');
        assert.equal(finalHost.save, before.save, 'all failure and cancellation paths preserve production save bytes');
        report.production.afterFailureAndCancellation = finalHost;
        report.production.requests = [...new Set(production.events.requests)];
        report.browserEvents = { production: production.events, harness: harness.events, experiment: experiment.events };
        report.passed = true;
        console.log('PASS production coexistence, trusted keyboard, 10 iframe lifetimes, real framebuffer, direct entry and native context-loss proof');
    } catch (error) {
        report.error = { message: error.message, stack: error.stack };
        report.failureBrowserEvents = connections.map((connection) => connection.events);
        throw error;
    } finally {
        await writeFile(join(output, 'receipt.json'), JSON.stringify(report, null, 2));
        await writeFile(join(output, 'chrome.log'), diagnostics);
        if (browserConnection) try { await browserConnection.send('Browser.close'); } catch {}
        browser.kill();
        await Promise.race([exited, delay(5000)]);
        for (const connection of connections) connection.close();
        const absolute = resolve(profile);
        assert.equal(dirname(absolute), resolve(tmpdir()), 'only remove this verifier-created temporary Chrome profile');
        assert.ok(basename(absolute).startsWith('emberwake-phaser-verifier-'));
        await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
    }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
