import Phaser from '../vendor/phaser/4.2.1/phaser.esm.min.js';
import { WorldScene } from './WorldScene.js';
import { GameLoop } from '../core/GameLoop.js';
import { Renderer } from '../systems/Renderer.js';
import { snapshotCamera } from '../systems/ViewportContract.js';

let activeGameCount = 0;

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
            && emberPixels > 0 && backgroundPixels > area * .5 && colors.size >= 5 };
}

export class PhaserRuntime {
    constructor({ stage, state, memory, publish, onFailure, beforeSimulation, prepareAssets, prepareInput, onSimulation }) {
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
        // Internal dependency seams used by the dedicated tools fixture, never
        // exposed by the public entry or selected by a production query string.
        this.beforeSimulation = beforeSimulation;
        this.prepareAssets = prepareAssets;
        this.prepareInput = prepareInput;
        this.onSimulation = onSimulation;
        this.presentationEnabled = true;
        this.frame = null;
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
        this.renderer = this.own(new Renderer(this.overlay, { alpha: true, frameSource: 'external' }));
        this.listen(this.worldCanvas, 'webglcontextlost', event => {
            event.preventDefault();
            s.errors.contextLossCount++;
            this.loop?.stop();
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
                    engine.events.on(Phaser.Core.Events.PRE_STEP, timestamp => this.beforeFrame(timestamp));
                    engine.events.on(Phaser.Core.Events.POST_RENDER, () => this.afterFrame(started));
                } },
            });
        } catch (error) {
            this.resolveEngineReady();
            error.experimentClassification = /WebGL|context/i.test(error.message) ? 'webgl-unavailable' : 'scene-boot';
            clearTimeout(this.bootTimeout);
            this.rejectBoot(error);
        }
        await booted;
        if (this.disposed) return this.publish();
        this.unsubscribeViewport = this.renderer.subscribeViewport(viewport => this.mirrorViewport(viewport));
        this.mirrorViewport(this.renderer.getViewportSnapshot());
        this.connectionTask = this.connectSimulation();
        await this.connectionTask;
        s.measurements.bootMs = performance.now() - started;
        this.snapshot();
        return this.publish();
    }
    mirrorViewport(viewport) {
        if (this.disposed) return;
        this.viewport = viewport;
        this.phaser.scale.resize(viewport.backingWidth, viewport.backingHeight);
        this.worldCanvas.style.width = `${viewport.cssWidth}px`;
        this.worldCanvas.style.height = `${viewport.cssHeight}px`;
        this.captureNext = true;
    }
    async connectSimulation() {
        await this.beforeSimulation?.(this);
        const [{ Game }, { Input }, { KeyboardInput }, { TouchJoystick }, { TouchButtons },
            { SaveSystem }, { AudioSystem }] = await Promise.all([
            import('../core/Game.js'), import('../core/Input.js'), import('../core/KeyboardInput.js'),
            import('../core/TouchJoystick.js'), import('../core/TouchButtons.js'),
            import('../systems/SaveSystem.js'), import('../systems/AudioSystem.js'),
        ]);
        // Original PR1 loader order is also suitable for the retained menus.
        if (this.prepareAssets) await this.prepareAssets();
        else for (const [module, loader] of [
            ['LpcSprites', 'loadLpcSprites'], ['WorldTextures', 'loadWorldTextures'],
            ['CustomIcons', 'loadIconGlyphs'], ['MonsterSprites', 'loadMonsterSprites'],
            ['EnemySprites', 'loadEnemyAiSprites'], ['HeroAiSprites', 'loadHeroAiSprites'],
            ['ObstacleSprites', 'loadObstacleSprites'], ['DecorSprites', 'loadDecorSprites'],
            ['RenderedWeaponProps', 'loadRenderedProps'],
        ]) await (await import(`../assets/${module}.js`))[loader]();
        if (this.disposed) return;
        this.keyboard = this.own(new KeyboardInput());
        this.touch = this.own(new TouchJoystick(this.renderer));
        this.buttons = this.own(new TouchButtons(this.renderer));
        this.input = this.own(new Input({ keyboard: this.keyboard, touch: this.touch, buttons: this.buttons }));
        this.prepareInput?.(this);
        try {
            this.save = this.own(new SaveSystem({ storage: this.memory, participation: 'isolated' }));
            if (!this.save.available) throw new Error('memory-storage-unavailable');
            this.state.boot.isolatedSave = !this.save._saveParticipationRequired;
        } catch (error) { error.experimentClassification = 'isolated-save'; throw error; }
        this.audio = this.own(new AudioSystem({ contextFactory: null }));
        this.loop = this.own(new GameLoop({ update: dt => {
            this.state.simulation.updateCalls++;
            this.game.update(dt);
        }, render: () => {
            if (!this.presentationEnabled || this.disposed) return;
            this.state.simulation.renderCalls++;
            this.game.renderOverlay();
        } }));
        try {
            this.game = this.own(new Game({ renderer: this.renderer, input: this.input, loop: this.loop,
                services: { saveSystem: this.save, audio: this.audio } }));
        } catch (error) { await error.cleanup; throw error; }
        activeGameCount++;
        this.countedGame = true;
        this.state.boot.gameConstructed = true;
        this.game.haptics.navigator = null;
        this.game.haptics.setStrength('off');
        this.state.boot.hapticsMode = 'disabled-experimental';
        this.game.render = this.game.renderOverlay.bind(this.game);
        this.game._snapPhoto = () => {
            this.game.shareToast = { text: 'Diagnostic photo export is not available yet', timer: 4 };
        };
        this.loop.profiler = this.game.profiler;
        this.loop.startExternal(performance.now());
        this.state.boot.simulationConnected = true;
        await this.onSimulation?.(this);
        if (this.presentationEnabled && !this.disposed) this.game.renderOverlay();
    }
    beforeFrame(timestamp) {
        if (this.disposed) return;
        this.renderer.processPresentationFrame(timestamp);
        if (!this.game || !this.loop?.running) return;
        // PRE_STEP timestamp is the pinned TimeStep's raw monotonic input;
        // its smoothed delta and Scene.update delta are deliberately unused.
        this.frame = this.loop.processFrame(timestamp);
        this.state.simulation.maxFrameSteps = Math.max(this.state.simulation.maxFrameSteps || 0, this.frame?.steps || 0);
        this.scene.setPresentation({ viewport: this.viewport,
            camera: snapshotCamera(this.game.camera),
            player: { x: this.game.player.x, y: this.game.player.y },
            enemies: this.game.enemies.filter(e => e.active).map(e => ({ x: e.x, y: e.y, boss: !!e.boss })),
            projectiles: this.game.projectiles.filter(e => e.active).map(e => ({ x: e.x, y: e.y })),
        });
    }
    releaseInput() {
        if (this.disposed) return;
        this.keyboard?.keys.clear();
        this.touch?.reset();
        this.buttons?.reset();
        if (this.game) this.game._dragPhotoPrev = null;
        // A native experiment control is a separate focus scope. Use the
        // existing pause action so a held Kindle is refunded, not accidentally
        // released as an attack while the user inspects the shell/link.
        if (this.game?.screen === 'gameplay' && !this.game.paused) this.game.togglePause();
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
        if (this.game) document.body.dataset.screen = this.game.screen;
        if (this.frame) { this.loop.renderFrame(this.frame); this.frame = null; }
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
        s.simulation.legacyRAFActive = this.loop?._frameId != null;
        s.simulation.scheduler = this.loop?.scheduler ?? null;
        s.simulation.accumulator = this.loop?.accumulator ?? 0;
        s.simulation.player = this.game?.player ? { x: this.game.player.x, y: this.game.player.y, hp: this.game.player.hp } : null;
        s.simulation.enemyCount = this.game?.enemies?.filter(e => e.active).length ?? 0;
        s.simulation.projectileCount = this.game?.projectiles?.filter(e => e.active).length ?? 0;
        s.simulation.paused = !!this.game?.paused;
        s.simulation.menuTab = this.game?.menuTab ?? null;
        s.viewport = this.renderer?.getViewportSnapshot() ?? null;
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
            this.loop?.stop();
            this.unsubscribeViewport?.();
            // Join asset/module preparation before removing owners or letting
            // the public entry restore its host-storage guards. connect checks
            // disposed before constructing any late Game/input/save resources.
            try { await this.connectionTask; } catch { /* boot owns classification */ }
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
