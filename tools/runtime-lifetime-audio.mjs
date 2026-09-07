// Behavioral audio lifetime checks, included by the single runtime-lifetime
// validator. These hosts never create a real AudioContext or contact the network.
import assert from 'node:assert/strict';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { installAudioLifecycle } from '../src/platform/AudioLifecycle.js';
import { MENU_COMPOSITIONS, VOICE_STINGERS } from '../src/content/music.js';

function audioParam() {
    return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
}

function contextHost() {
    const nodes = [];
    const makeNode = () => {
        const node = {
            connect() {}, disconnect() { this.disconnected = true; },
            start() {}, stop() { this.stops = (this.stops || 0) + 1; },
            gain: audioParam(), delayTime: audioParam(), threshold: audioParam(),
            knee: audioParam(), ratio: audioParam(), attack: audioParam(),
            release: audioParam(), frequency: audioParam(), Q: audioParam(),
        };
        nodes.push(node);
        return node;
    };
    return {
        nodes, state: 'running', currentTime: 0, sampleRate: 4, destination: {},
        createGain: makeNode, createDelay: makeNode, createDynamicsCompressor: makeNode,
        createBiquadFilter: makeNode, createMediaElementSource: makeNode,
        createBufferSource: makeNode,
        createBuffer() { return { getChannelData() { return new Float32Array(4); } }; },
        close() { this.closes = (this.closes || 0) + 1; return Promise.resolve(); },
    };
}

function eventHost() {
    return {
        entries: [],
        addEventListener(type, callback, options = false) {
            const capture = typeof options === 'boolean' ? options : !!options.capture;
            if (!this.entries.some((entry) => entry.type === type
                && entry.callback === callback && entry.capture === capture)) {
                this.entries.push({ type, callback, capture, options });
            }
        },
        removeEventListener(type, callback, options = false) {
            const capture = typeof options === 'boolean' ? options : !!options.capture;
            this.entries = this.entries.filter((entry) => !(entry.type === type
                && entry.callback === callback && entry.capture === capture));
        },
        fire(type) {
            for (const entry of [...this.entries]) if (entry.type === type) entry.callback();
        },
    };
}

export async function validateAudioLifetime(reportCheck) {
    let assertions = 0;
    const check = (condition, label) => { assertions++; reportCheck(condition, label); };
    const replacements = [];
    const owned = [];
    const cleanups = [];
    const streams = [];
    const equal = (actual, expected, label) => {
        assert.deepEqual(actual, expected, label);
        check(true, label);
    };
    const replace = (target, key, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, { configurable: true, writable: true, value });
        replacements.push({ target, key, descriptor });
    };
    const createAudio = (options) => {
        const audio = new AudioSystem(options);
        owned.push(audio);
        return audio;
    };
    try {
        let hostReads = 0, randomCalls = 0;
        replace(globalThis, 'window', {
            get AudioContext() { hostReads++; throw new Error('Host AudioContext getter accessed'); },
            get webkitAudioContext() { hostReads++; throw new Error('Host prefixed AudioContext getter accessed'); },
        });
        replace(Math, 'random', () => { randomCalls++; return 0.25; });
        for (const factory of [null, () => null]) {
            const audio = createAudio({ contextFactory: factory });
            if (factory === null) check(!audio.enabled, 'explicit null audio is immediately disabled');
            const before = randomCalls;
            audio.playMusic('menu');
            equal(randomCalls - before, 3, 'silent audio preserves the three-draw menu shuffle');
            check(audio._activeScore && audio.theme === 'menu', 'silent audio retains authored score state');
            equal(await audio.unlock(), false, 'silent context does not unlock');
            const disposal = audio.dispose();
            check(disposal === audio.dispose(), 'AudioSystem disposal returns the same promise');
            equal(await disposal, true, 'silent audio disposal completes');
            equal(await audio.unlock(), false, 'disposed audio cannot unlock again');
            const after = randomCalls;
            audio.playMusic('gameplay');
            equal(randomCalls, after, 'late score requests cannot consume RNG after disposal');
        }
        equal(hostReads, 0, 'explicit audio injection never resolves host AudioContext getters');

        let defaultConstructions = 0;
        const defaultContext = contextHost();
        replace(globalThis, 'window', { AudioContext: class {
            constructor() { defaultConstructions++; return defaultContext; }
        } });
        const normal = createAudio();
        check(normal.enabled && normal.ctx === null && defaultConstructions === 0,
            'default browser audio stays enabled but lazily unconstructed');
        normal._ensure();
        check(normal.ctx === defaultContext && defaultConstructions === 1,
            'default audio constructs the browser context exactly once');
        normal._ensure();
        equal(defaultConstructions, 1, 'a second ensure reuses the existing context');
        await normal.dispose();
        check(defaultContext.closes === 1 && defaultContext.nodes.every((node) => node.disconnected),
            'owned default context and graph are closed and disconnected');

        let resume;
        const suspendedContext = contextHost();
        suspendedContext.state = 'suspended';
        suspendedContext.resume = () => new Promise((resolve) => {
            resume = () => { suspendedContext.state = 'running'; resolve(); };
        });
        const suspended = createAudio({ contextFactory: () => suspendedContext });
        let starts = 0;
        suspended._startScheduler = () => { starts++; };
        const pendingUnlock = suspended.unlock();
        const disposing = suspended.dispose();
        resume();
        equal(await pendingUnlock, false, 'late resume cannot reactivate a disposed context');
        equal(await disposing, true, 'disposal is independent of a pending resume');
        check(starts === 0 && suspendedContext.closes === 1,
            'pending unlock creates no scheduler and closes its context once');

        const partialContext = contextHost();
        let gains = 0;
        const originalGain = partialContext.createGain;
        partialContext.createGain = () => {
            if (++gains === 3) throw new Error('Partial graph construction failure');
            return originalGain();
        };
        const partial = createAudio({ contextFactory: () => partialContext });
        equal(await partial.unlock(), false, 'partial graph failure fails unlock safely');
        equal(await partial.dispose(), true, 'disposal joins cleanup of a failed graph');
        check(partialContext.closes === 1 && partialContext.nodes.every((node) => node.disconnected),
            'partial graph resources are disconnected and closed exactly once');
        const rejected = createAudio({ contextFactory: null });
        rejected.ctx = { close() { return Promise.reject(new Error('Context close rejection')); } };
        equal(await rejected.dispose(), false, 'context close rejection is handled and reported');

        let decode;
        const lateContext = contextHost();
        lateContext.decodeAudioData = () => new Promise((resolve) => { decode = resolve; });
        replace(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
        const late = createAudio({ contextFactory: () => lateContext });
        late._ensure();
        const voiceId = Object.keys(VOICE_STINGERS)[0];
        const pendingVoice = late._loadVoice(voiceId);
        for (let tick = 0; !decode && tick < 10; tick++) await Promise.resolve();
        check(typeof decode === 'function', 'voice load reaches the controlled pending decoder');
        const controller = late._loadController;
        await late.dispose();
        decode({ duration: 1 });
        equal(await pendingVoice, null, 'late voice decode returns no disposed buffer');
        equal(late._voiceBuffers, {}, 'late voice decode cannot repopulate caches');
        check(!controller || controller.signal.aborted, 'owned fetch signal is aborted on disposal');

        const decoders = [];
        const sampleContext = contextHost();
        sampleContext.decodeAudioData = () => new Promise((resolve) => decoders.push(resolve));
        const samples = createAudio({ contextFactory: () => sampleContext });
        samples._ensure();
        samples._loadSamples();
        for (let tick = 0; !decoders.length && tick < 10; tick++) await Promise.resolve();
        check(decoders.length > 0, 'sample bank reaches controlled asynchronous decode');
        await samples.dispose();
        decoders.forEach((resolve) => resolve({ duration: 1 }));
        await new Promise((resolve) => setImmediate(resolve));
        equal(samples._samples, {}, 'late sample decodes cannot repopulate disposed banks');
        equal(samples._samplesState, 'skip', 'late sample completion cannot restore ready state');

        replace(globalThis, 'Audio', class {
            constructor() { this.events = new Map(); streams.push(this); }
            addEventListener(type, callback) { this.events.set(type, callback); }
            removeEventListener(type, callback) {
                if (this.events.get(type) === callback) this.events.delete(type);
            }
            play() { return new Promise((_resolve, reject) => { this.reject = reject; }); }
            pause() { this.pauses = (this.pauses || 0) + 1; }
            removeAttribute() {}
            load() {}
        });
        const streaming = createAudio({ contextFactory: () => contextHost() });
        streaming._ensure();
        const score = MENU_COMPOSITIONS.find((item) => item.kind === 'recorded');
        streaming.theme = 'menu';
        streaming._activeScore = score;
        streaming._startRecorded(score);
        const ended = streams[0].events.get('ended');
        streaming._stopRecorded(true);
        equal(streaming._fadingRecorded.size, 1, 'old recorded stream retains its tracked fade until finished');
        streaming._startRecorded(score);
        await streaming.dispose();
        equal(streaming._fadingRecorded.size, 0, 'disposal clears every old-stream fade timer');
        check(streams.every((stream) => stream.pauses === 1 && stream.events.size === 0),
            'current and fading streams stop once and lose their ended listeners');
        const beforeLateCallback = randomCalls;
        ended();
        streams.forEach((stream) => stream.reject(new Error('Late play rejection')));
        await new Promise((resolve) => setImmediate(resolve));
        check(streaming.ctx === null && randomCalls === beforeLateCallback,
            'late ended and rejected-play callbacks cannot restart music or consume RNG');

        const voices = createAudio({ contextFactory: () => contextHost() });
        voices._ensure();
        voices._playBossVoice(voiceId, { duration: 1 });
        voices.stopVoice();
        voices._playBossVoice(voiceId, { duration: 1 });
        const voiceNodes = [...voices._voiceNodes];
        await voices.dispose();
        check(voiceNodes.length === 2 && voiceNodes.every(([source, gain]) =>
            source.onended === null && source.disconnected && gain.disconnected),
        'disposal also detaches a previously fading voice, not only the current voice');

        const windowTarget = eventHost(), documentTarget = eventHost();
        documentTarget.hidden = false;
        let unlocks = 0, audioDisposals = 0;
        const pauses = [];
        const game = { screen: 'gameplay', paused: false, audio: {
            unlock() { unlocks++; }, setPaused(value) { pauses.push(value); },
            dispose() { audioDisposals++; },
        } };
        for (let cycle = 0; cycle < 10; cycle++) {
            const cleanup = installAudioLifecycle(game, { windowTarget, documentTarget });
            cleanups.push(cleanup);
            check(windowTarget.entries.length === 5 && documentTarget.entries.length === 1,
                `audio hooks cycle ${cycle}: exactly six listeners`);
            check(windowTarget.entries.slice(0, 3).every((entry) => entry.capture && entry.options.passive),
                `audio hooks cycle ${cycle}: gesture capture/passive contract`);
            const oldCallbacks = [...windowTarget.entries, ...documentTarget.entries].map((entry) => entry.callback);
            windowTarget.fire('keydown'); windowTarget.fire('pointerdown'); windowTarget.fire('touchstart');
            game.screen = 'gameplay'; game.paused = false; documentTarget.hidden = false;
            windowTarget.fire('blur'); windowTarget.fire('focus');
            documentTarget.hidden = true; documentTarget.fire('visibilitychange');
            game.screen = 'start'; windowTarget.fire('focus');
            equal(pauses.slice(-4), [true, false, true, false], `audio hooks cycle ${cycle}: original focus/pause behavior`);
            cleanup(); cleanup();
            equal(windowTarget.entries.length + documentTarget.entries.length, 0,
                `audio hooks cycle ${cycle}: no listener growth after double cleanup`);
            const before = [unlocks, pauses.length];
            oldCallbacks.forEach((callback) => callback());
            equal([unlocks, pauses.length], before, `audio hooks cycle ${cycle}: detached callbacks are inert`);
        }
        equal(unlocks, 30, 'ten install cycles receive each gesture once');
        equal(audioDisposals, 0, 'audio hook cleanup never disposes borrowed audio');
        const partialWindow = eventHost();
        const partialDocument = eventHost();
        const attachDocument = partialDocument.addEventListener.bind(partialDocument);
        partialDocument.addEventListener = (...args) => {
            attachDocument(...args);
            throw new Error('Document subscription failure');
        };
        assert.throws(() => installAudioLifecycle(game, {
            windowTarget: partialWindow, documentTarget: partialDocument,
        }), /Document subscription failure/);
        equal(partialWindow.entries.length + partialDocument.entries.length, 0,
            'partial hook installation unwinds even the listener attached before a host throws');
        return { assertions, cycles: 10, hooksPerCycle: 6, silentMenuShuffleDraws: 3,
            remainingHookListeners: windowTarget.entries.length + documentTarget.entries.length,
            remainingFadeTimers: streaming._fadingRecorded.size };
    } finally {
        try {
            for (const cleanup of cleanups.reverse()) cleanup();
            // Reject pending fake playback while its guarded handlers are installed.
            for (const stream of streams) stream.reject?.(new Error('Fixture cleanup'));
            await Promise.all(owned.map((audio) => audio.dispose()));
        } finally {
            for (const { target, key, descriptor } of replacements.reverse()) {
                if (descriptor) Object.defineProperty(target, key, descriptor);
                else delete target[key];
            }
        }
    }
}
