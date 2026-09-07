import Phaser from '../vendor/phaser/4.2.1/phaser.esm.min.js';
import { WorldScene } from './WorldScene.js';
import { Game } from '../core/Game.js';
import { GameLoop } from '../core/GameLoop.js';
import { Input } from '../core/Input.js';
import { KeyboardInput } from '../core/KeyboardInput.js';
import { TouchJoystick } from '../core/TouchJoystick.js';
import { TouchButtons } from '../core/TouchButtons.js';
import { Renderer } from '../systems/Renderer.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';

let activeGameCount = 0;

// Only a bounded verification-stage resize. PR4 owns rotation, DPR, safe areas,
// cover/contain, camera projection and the actual retained Canvas UI bridge.
class ExperimentRenderer extends Renderer {
    resize() {
        if (this._disposed) return;
        const bounds = this.canvas.parentElement.getBoundingClientRect();
        this.cssWidth = Math.max(1, bounds.width);
        this.cssHeight = Math.max(1, bounds.height);
        this.dpr = 1;
        this.scale = this.cssWidth / this.internalWidth;
        this.canvas.width = Math.round(this.cssWidth);
        this.canvas.height = Math.round(this.cssHeight);
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.onStageResize?.(this.canvas.width, this.canvas.height);
    }
}

function bounds(canvas) {
    const { x, y, width, height } = canvas.getBoundingClientRect();
    return { x, y, width, height };
}

function pixelProof(gl) {
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const rgba = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    let nonBlack = 0, nonTransparent = 0, emberPixels = 0, backgroundPixels = 0;
    const colors = new Set();
    for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
        if (r + g + b > 12) nonBlack++;
        if (a > 240) nonTransparent++;
        if (r > 170 && g > 70 && g < r && b < 150 && a > 240) emberPixels++;
        if (r >= 12 && r <= 35 && g >= 5 && g <= 25 && b >= 12 && b <= 40 && a > 240) backgroundPixels++;
        if (colors.size < 512) colors.add((r << 24) | (g << 16) | (b << 8) | a);
    }
    const area = width * height;
    return { width, height, nonBlack, nonTransparent, distinctColors: colors.size,
        emberPixels, backgroundPixels,
        passed: area > 0 && nonBlack > area * .9 && nonTransparent > area * .95
            && emberPixels > area * .003 && backgroundPixels > area * .5 && colors.size >= 5 };
}

export class PhaserRuntime {
    constructor({ stage, state, memory, publish, onFailure }) {
        this.stage = stage;
        this.state = state;
        this.memory = memory;
        this.publish = publish;
        this.onFailure = onFailure;
        this.resources = [];
        this.listeners = [];
        this.disposed = false;
        this.disposeTask = null;
        this.countedGame = false;
        this.probing = false;
        this.visibilityProperties = [];
    }
    own(resource) { this.resources.push(resource); return resource; }
    listen(target, type, callback) {
        target.addEventListener(type, callback);
        this.listeners.push({ target, type, callback });
    }
    async boot() {
        const started = performance.now();
        const s = this.state;
        s.phaserVersion = Phaser.VERSION;
        if (Phaser.VERSION !== s.expectedPinnedVersion) throw new Error('pinned-version-mismatch');
        try {
            this.save = this.own(new SaveSystem({ storage: this.memory, participation: 'isolated' }));
            if (!this.save.available) throw new Error('memory-storage-unavailable');
            s.boot.isolatedSave = !this.save._saveParticipationRequired;
        } catch (error) { error.experimentClassification = 'isolated-save'; throw error; }
        this.audio = this.own(new AudioSystem({ contextFactory: null }));
        this.worldCanvas = document.createElement('canvas');
        this.worldCanvas.id = 'phaser-world';
        this.worldCanvas.setAttribute('aria-hidden', 'true');
        this.worldCanvas.tabIndex = -1;
        this.overlay = document.createElement('canvas');
        this.overlay.id = 'game';
        this.stage.append(this.worldCanvas, this.overlay);
        // The first context acquisition decides alpha; Renderer must reuse this
        // actual transparent 2D context, not its normal opaque production one.
        if (!this.overlay.getContext('2d', { alpha: true })) throw new Error('canvas-overlay-unavailable');
        this.renderer = this.own(new ExperimentRenderer(this.overlay));
        this.keyboard = this.own(new KeyboardInput());
        this.touch = this.own(new TouchJoystick(this.renderer));
        this.buttons = this.own(new TouchButtons(this.renderer));
        this.input = this.own(new Input({ keyboard: this.keyboard, touch: this.touch, buttons: this.buttons }));
        this.loop = this.own(new GameLoop({ update: () => { throw new Error('PR3 clock disconnected'); }, render: () => {} }));
        try {
            this.game = this.own(new Game({ renderer: this.renderer, input: this.input, loop: this.loop,
                services: { saveSystem: this.save, audio: this.audio } }));
        } catch (error) { await error.cleanup; throw error; }
        activeGameCount++;
        this.countedGame = true;
        s.boot.gameConstructed = true;
        // No gameplay feedback is active in this dormant shell. Avoid even a
        // native vibration-cancel on teardown of an untouched experiment frame.
        this.game.haptics.navigator = null;
        this.game.haptics.setStrength('off');
        s.boot.hapticsMode = 'disabled-experimental';
        // Tripwires, not a scheduler. Even an accidental future connection fails
        // visibly instead of advancing rules before the separately gated PR4.
        this.game.update = () => { s.simulation.updateCalls++; throw new Error('PR3 simulation is not connected'); };
        this.game.render = () => { s.simulation.renderCalls++; throw new Error('PR3 Canvas gameplay rendering is not connected'); };
        // The empty overlay is not a playable application. Native shell controls
        // own focus until an actual UI bridge exists; do not announce fake HUD.
        this.overlay.removeAttribute('role');
        this.overlay.removeAttribute('aria-describedby');
        this.overlay.removeAttribute('aria-label');
        this.overlay.setAttribute('aria-hidden', 'true');
        this.overlay.tabIndex = -1;
        this.listen(this.worldCanvas, 'webglcontextlost', event => {
            event.preventDefault();
            s.errors.contextLossCount++;
            this.phaser?.loop.stop();
            this.onFailure('webgl-context-lost', !this.probing);
        });
        this.listen(this.worldCanvas, 'webglcontextrestored', () => { s.errors.contextRestoreCount++; });
        this.listen(this.worldCanvas, 'webglcontextcreationerror', () => { s.errors.webglErrorCount++; });
        // Capability failure must happen before Phaser creates partial global
        // managers. Give the tagged renderer this same context exclusively;
        // this canvas has never been acquired as 2D and there is no fallback.
        const context = this.worldCanvas.getContext('webgl', { alpha: false,
            antialias: true, depth: false, stencil: true, preserveDrawingBuffer: true });
        if (!context || context.isContextLost()) {
            const error = new Error('WebGL context creation unavailable');
            error.experimentClassification = 'webgl-unavailable';
            throw error;
        }
        const booted = new Promise((resolve, reject) => { this.resolveBoot = resolve; this.rejectBoot = reject; });
        this.engineReadyTask = new Promise(resolve => { this.resolveEngineReady = resolve; });
        this.bootTimeout = setTimeout(() => this.rejectBoot?.(new Error('scene-first-frame-timeout')), 15000);
        this.scene = new WorldScene(() => { s.boot.sceneReady = true; });
        try {
            this.phaser = new Phaser.Game({
                type: Phaser.WEBGL, canvas: this.worldCanvas, context, parent: this.stage,
                width: this.overlay.width, height: this.overlay.height,
                backgroundColor: '#150f18', banner: false, autoFocus: false,
                audio: { noAudio: true }, physics: { default: false },
                input: { keyboard: false, mouse: false, touch: false, gamepad: false, windowEvents: false },
                scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
                render: { preserveDrawingBuffer: true, antialias: true, skipUnreadyShaders: false },
                fps: { smoothStep: false }, scene: [this.scene],
                callbacks: { preBoot: engine => {
                    // Retain the partially built engine even if renderer boot throws.
                    this.phaser = engine;
                    // SYSTEM_READY precedes user Scene.create. A throwing Scene
                    // must not skip a later READY listener and deadlock cleanup.
                    engine.events.once(Phaser.Core.Events.SYSTEM_READY, () => this.resolveEngineReady());
                    this.captureVisibilityLifetime(engine);
                    engine.events.on(Phaser.Core.Events.POST_RENDER, () => this.afterFrame(started));
                } },
            });
        } catch (error) {
            this.resolveEngineReady();
            error.experimentClassification = /WebGL|context/i.test(error.message) ? 'webgl-unavailable' : 'scene-boot';
            clearTimeout(this.bootTimeout);
            this.rejectBoot(error);
        }
        this.renderer.onStageResize = (width, height) => {
            if (this.disposed || !this.phaser?.isBooted) return;
            this.phaser.scale.resize(width, height);
            this.worldCanvas.style.width = '100%';
            this.worldCanvas.style.height = '100%';
            this.captureNext = true;
        };
        await booted;
        s.measurements.bootMs = performance.now() - started;
        this.snapshot();
        return this.publish();
    }
    captureVisibilityLifetime(engine) {
        // Tagged 4.2.1 VisibilityHandler installs an anonymous document listener
        // and overwrites window.onblur/onfocus, but Game.destroy does not undo
        // them. Capture ONLY the synchronous engine.start registration window.
        // Keep official vendor bytes untouched and remove only captured owners.
        const start = engine.start;
        engine.start = (...args) => {
            const own = Object.getOwnPropertyDescriptor(document, 'addEventListener');
            const add = document.addEventListener;
            const previous = { onblur: window.onblur, onfocus: window.onfocus };
            document.addEventListener = (type, callback, options) => {
                add.call(document, type, callback, options);
                if (type === 'visibilitychange') this.listeners.push({ target: document, type, callback });
            };
            try { return start.apply(engine, args); }
            finally {
                if (own) Object.defineProperty(document, 'addEventListener', own);
                else delete document.addEventListener;
                for (const key of ['onblur', 'onfocus']) {
                    if (window[key] !== previous[key]) this.visibilityProperties.push({ key, previous: previous[key], installed: window[key] });
                }
            }
        };
    }
    afterFrame(started) {
        if (this.disposed || !this.state.boot.sceneReady) return;
        const s = this.state;
        if (!s.boot.frameRendered || this.captureNext) {
            this.captureNext = false;
            const gl = this.phaser.renderer.gl;
            if (!gl || gl.isContextLost()) return;
            s.pixels = pixelProof(gl);
            const error = gl.getError();
            if (error !== gl.NO_ERROR) s.errors.webglErrorCount++;
            if (!s.pixels.passed) return;
            if (!s.boot.frameRendered) {
                s.boot.frameRendered = true;
                s.measurements.firstFrameMs = performance.now() - started;
                s.measurements.initialHeapBytes = performance.memory?.usedJSHeapSize ?? null;
                clearTimeout(this.bootTimeout);
                this.resolveBoot?.();
            }
            this.snapshot();
            this.publish();
        }
    }
    snapshot() {
        const s = this.state, engine = this.phaser, gl = engine?.renderer?.gl;
        if (gl && !gl.isContextLost()) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            s.renderer = {
                webgl: engine.renderer.type === Phaser.WEBGL, contextActive: !this.disposed,
                contextType: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
                identity: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                drawingBufferWidth: gl.drawingBufferWidth, drawingBufferHeight: gl.drawingBufferHeight,
                canvasWidth: this.worldCanvas.width, canvasHeight: this.worldCanvas.height,
                cssViewport: bounds(this.worldCanvas),
                overlay: { width: this.overlay.width, height: this.overlay.height,
                    alpha: this.renderer.ctx.getContextAttributes().alpha,
                    background: getComputedStyle(this.overlay).backgroundColor, cssViewport: bounds(this.overlay) },
            };
        }
        s.renderer.contextActive = Boolean(!this.disposed && gl && !gl.isContextLost());
        s.storage.memoryWrites = this.memory?.writes ?? 0;
        s.simulation.time = this.game?.time ?? 0;
        s.simulation.screen = this.game?.screen ?? null;
        s.simulation.loopRunning = this.loop?.running ?? false;
        s.boot.physicsEnabled = Boolean(engine?.config?.defaultPhysicsSystem);
        s.boot.audioMode = !this.audio?.ctx && engine?.config?.audio?.noAudio ? 'silent-no-context' : 'unverified';
        const shellListeners = this.resources.reduce((n, item) => n + (item._listeners?.length ?? 0), 0)
            + (this.loop?._visibilityAttached ? 1 : 0) + this.listeners.length + this.visibilityProperties.length;
        const textureCount = Object.keys(engine?.textures?.list ?? {}).length;
        s.lifetime = { activeGameCount, disposed: this.disposed,
            ownedSaveParticipants: this.save?._saveParticipationRequired && !this.save._saveParticipationDisposeRequested ? 1 : 0,
            shellListeners, phaserLoopRunning: Boolean(engine?.loop?.running),
            phaserRAFRunning: Boolean(engine?.loop?.raf?.isRunning),
            canvasCount: this.stage.querySelectorAll('canvas').length,
            sceneCount: engine?.scene?.scenes?.length ?? 0, textureCount };
        if (!this.disposed) s.measurements.textureCount = textureCount;
    }
    capture() { return this.worldCanvas.toDataURL('image/png'); }
    async contextLossProbe() {
        const gl = this.phaser?.renderer?.gl;
        const ext = gl?.getExtension('WEBGL_lose_context');
        const result = { supported: Boolean(ext), lostObserved: false, restoreObserved: false,
            renderedAfterRestore: false, safeFailure: false };
        if (!ext || this.disposed) return result;
        this.probing = true;
        const waitFor = async predicate => {
            const deadline = performance.now() + 5000;
            while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
            return predicate();
        };
        const losses = this.state.errors.contextLossCount, restores = this.state.errors.contextRestoreCount;
        ext.loseContext();
        result.lostObserved = await waitFor(() => this.state.errors.contextLossCount > losses);
        result.safeFailure = document.body.dataset.failed === 'true' && !this.loop.running;
        if (result.lostObserved) {
            await new Promise(resolve => setTimeout(resolve, 100));
            ext.restoreContext();
            result.restoreObserved = await waitFor(() => this.state.errors.contextRestoreCount > restores);
            if (result.restoreObserved && !gl.isContextLost()) {
                this.state.pixels.passed = false;
                this.captureNext = true;
                this.phaser.loop.wake();
                result.renderedAfterRestore = await waitFor(() => this.state.pixels.passed);
            }
        }
        // A second native loss proves teardown WHILE lost, followed by a late
        // native restore on the retained detached canvas. This is not run recovery.
        const secondLoss = this.state.errors.contextLossCount;
        const canvas = this.worldCanvas;
        let lateRestored = false;
        const observeLateRestore = () => { lateRestored = true; };
        canvas.addEventListener('webglcontextrestored', observeLateRestore);
        try {
            ext.loseContext();
            result.disposedWhileLost = await waitFor(() => this.state.errors.contextLossCount > secondLoss);
            await this.dispose();
            ext.restoreContext();
            result.lateRestoreObserved = await waitFor(() => lateRestored);
            this.snapshot();
            result.lateRestoreNoResurrection = this.state.lifetime.activeGameCount === 0
                && !this.phaser.loop.running && !this.phaser.loop.raf
                && this.state.lifetime.canvasCount === 0 && this.state.lifetime.sceneCount === 0;
        } finally { canvas.removeEventListener('webglcontextrestored', observeLateRestore); }
        this.probing = false;
        return result;
    }
    dispose() {
        if (this.disposeTask) return this.disposeTask;
        this.disposed = true;
        clearTimeout(this.bootTimeout);
        this.rejectBoot?.(new Error('experiment-disposed'));
        this.disposeTask = (async () => {
            const failures = [];
            this.renderer && (this.renderer.onStageResize = null);
            try {
                if (this.phaser) {
                    // Default texture images finish asynchronously. Destruction
                    // before SYSTEM_READY hits uninitialized Phaser managers; join that
                    // initialization while Game remains disconnected, then stop
                    // the newly started RAF before it can present another frame.
                    await this.engineReadyTask;
                    this.phaser.loop.stop();
                    this.phaser.destroy(true, false);
                    // destroy() is deferred. The pinned public step sees pendingDestroy
                    // first, so this executes cleanup with zero Scene/simulation updates,
                    // even when hidden, context-lost or the TimeStep is stopped.
                    this.phaser.step(performance.now(), 0);
                }
            } catch (error) { failures.push(error); }
            for (const resource of this.resources.slice().reverse()) {
                try { if (await resource.dispose() === false) throw new Error('resource refused cleanup'); }
                catch (error) { failures.push(error); }
            }
            if (this.countedGame) { activeGameCount--; this.countedGame = false; }
            for (const { target, type, callback } of this.listeners) target.removeEventListener(type, callback);
            this.listeners.length = 0;
            for (const { key, previous, installed } of this.visibilityProperties) {
                if (window[key] === installed) window[key] = previous;
            }
            this.visibilityProperties.length = 0;
            this.worldCanvas?.remove();
            this.overlay?.remove();
            this.snapshot();
            if (failures.length) throw new AggregateError(failures, 'experimental cleanup failed');
        })();
        return this.disposeTask;
    }
}
