import { Renderer } from '../../src/systems/Renderer.js';
import { Camera } from '../../src/core/Camera.js';
import { MemoryStorage } from '../../src/platform/MemoryStorage.js';
import { snapshotCamera, applyCameraToPhaser } from '../../src/systems/ViewportContract.js';
import { verifyBrowserProjection } from './phaser-projection-contract.mjs';

const receipt = { passed: false, fixture: 'PR4 native Canvas/WebGL projection', errors: [], hostStorageAccesses: 0,
    hostLockAccesses: 0, engineMemoryFacadeAccesses: 0, phase: 'module-loaded' };
const publish = () => {
    window.__phaserProjectionReceipt = JSON.parse(JSON.stringify(receipt));
    document.getElementById('projection-receipt').textContent = JSON.stringify(receipt);
};
const fail = error => {
    clearTimeout(watchdog);
    receipt.passed = false;
    receipt.errors.push(String(error?.stack || error)); publish();
    document.title = 'BOOT FAIL — Phaser projection';
    document.getElementById('projection-status').textContent = `PROJECTION FAILED: ${error?.message || error}`;
    document.documentElement.dataset.qaReady = '1';
};
const watchdog = setTimeout(() => fail(new Error(`Projection fixture timeout at ${receipt.phase}`)), 20000);
publish();
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

try {
    const params = new URL(location.href).searchParams;
    if (params.get('safe') === '1') for (const [edge, px] of Object.entries({ top: 47, right: 13, bottom: 34, left: 9 })) {
        document.documentElement.style.setProperty(`--sai-${edge}`, `${px}px`);
    }
    // The official feature probe receives only fresh memory. This fixture never
    // opens a profile, locks a production save, constructs audio, or creates Game.
    const memory = new MemoryStorage();
    let importing = true;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() {
        if (importing) { receipt.engineMemoryFacadeAccesses++; return memory; }
        receipt.hostStorageAccesses++; throw new Error('Projection fixture attempted host storage');
    } });
    Object.defineProperty(navigator, 'locks', { configurable: true, get() {
        receipt.hostLockAccesses++; throw new Error('Projection fixture attempted host locks');
    } });
    const { default: Phaser } = await import('../../src/vendor/phaser/4.2.1/phaser.esm.min.js');
    receipt.phase = 'engine-imported'; publish();
    importing = false;
    const overlay = document.getElementById('game'), world = document.getElementById('phaser-world');
    const renderer = new Renderer(overlay, { alpha: true, frameSource: 'external' });
    let viewport = renderer.getViewportSnapshot(), engine;
    const mirror = value => {
        viewport = value;
        if (engine?.isBooted) engine.scale.resize(value.backingWidth, value.backingHeight);
        world.style.width = `${value.cssWidth}px`; world.style.height = `${value.cssHeight}px`;
        if (!engine) { world.width = value.backingWidth; world.height = value.backingHeight; }
    };
    const unsubscribe = renderer.subscribeViewport(mirror);
    const camera = new Camera();
    class ProjectionScene extends Phaser.Scene {
        create() {
            receipt.phase = 'scene-created'; publish();
            this.cameras.main.setBackgroundColor('#150f18');
            this.markers = this.add.graphics();
            this.markers.lineStyle(1, 0x46344d, 1);
            for (let x = -1200; x <= 1200; x += 120) this.markers.lineBetween(x, -800, x, 800);
            for (let y = -800; y <= 800; y += 120) this.markers.lineBetween(-1200, y, 1200, y);
            this.markers.lineStyle(5, 0xffbe65, 1).lineBetween(-60, 0, 60, 0).lineBetween(0, -60, 0, 60);
            this.markers.lineStyle(4, 0x81e4df, 1).strokeCircle(350, -120, 32);
            mirror(renderer.getViewportSnapshot());
        }
        update() {
            applyCameraToPhaser(snapshotCamera(camera), this.cameras.main, viewport);
        }
    }
    const context = world.getContext('webgl', { alpha: false, antialias: true, depth: false, stencil: true, preserveDrawingBuffer: true });
    if (!context) throw new Error('Actual WebGL context unavailable');
    const started = performance.now();
    let frames = 0, checked = false;
    engine = new Phaser.Game({ type: Phaser.WEBGL, canvas: world, context,
        width: viewport.backingWidth, height: viewport.backingHeight,
        banner: false, autoFocus: false, audio: { noAudio: true }, physics: { default: false },
        input: { keyboard: false, mouse: false, touch: false, gamepad: false, windowEvents: false },
        scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
        render: { preserveDrawingBuffer: true, antialias: true, skipUnreadyShaders: false },
        fps: { smoothStep: false }, scene: [ProjectionScene],
        callbacks: { preBoot: value => {
            value.events.on(Phaser.Core.Events.PRE_STEP, timestamp => renderer.processPresentationFrame(timestamp));
            value.events.on(Phaser.Core.Events.POST_RENDER, () => {
                renderer.beginOverlayFrame();
                const ctx = renderer.ctx, safe = renderer.safeArea;
                ctx.strokeStyle = '#d27dff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(930, 540); ctx.lineTo(990, 540); ctx.moveTo(960, 510); ctx.lineTo(960, 570); ctx.stroke();
                ctx.strokeStyle = '#81e4df'; ctx.lineWidth = 2;
                ctx.strokeRect(safe.left + 8, safe.top + 8, 1904 - safe.left - safe.right, 1064 - safe.top - safe.bottom);
                if (checked || receipt.errors.length || ++frames < 3 || (renderer.rotated && performance.now() - started < 2700)) return;
                checked = true;
                try {
                    const projection = verifyBrowserProjection(Phaser, renderer);
                    const upper = overlay.getBoundingClientRect(), lower = world.getBoundingClientRect();
                    const error = Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(upper[key] - lower[key])));
                    if (error > 0.001) throw new Error(`Two-canvas visual bounds mismatch: ${error}`);
                    if (value.renderer.type !== Phaser.WEBGL) throw new Error('Phaser did not use WebGL');
                    const gl = value.renderer.gl, debug = gl.getExtension('WEBGL_debug_renderer_info');
                    const rgba = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
                    let opaque = 0, varied = 0;
                    for (let index = 0; index < rgba.length; index += 4) {
                        if (rgba[index + 3] > 240) opaque++;
                        if (rgba[index] > 40 || rgba[index + 1] > 35 || rgba[index + 2] > 45) varied++;
                    }
                    if (opaque < gl.drawingBufferWidth * gl.drawingBufferHeight * 0.95 || varied < 200) throw new Error('Actual WebGL grid pixels missing');
                    if (receipt.hostStorageAccesses || receipt.hostLockAccesses) throw new Error('Projection fixture isolation violation');
                    Object.assign(receipt, { passed: true, phase: 'complete', phaserVersion: Phaser.VERSION, projection,
                        backend: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
                        webglVersion: gl.getParameter(gl.VERSION), boundsErrorCss: error,
                        overlayAlpha: overlay.getContext('2d').getContextAttributes().alpha,
                        overlayBackground: getComputedStyle(overlay).backgroundColor,
                        stageTransform: getComputedStyle(document.getElementById('stage')).transform,
                        rotateCueTransform: getComputedStyle(document.getElementById('rotate-hint')).transform,
                        canvasCount: document.getElementById('stage').querySelectorAll('canvas').length,
                        pixels: { opaque, varied }, resizeRaf: renderer._resizeFrameId, hintRaf: renderer._hintFrameId,
                    });
                    clearTimeout(watchdog);
                    publish(); document.title = 'EMBERWAKE — projection PASS — EXC: 0';
                    document.getElementById('projection-status').textContent = `PROJECTION PASS • ${projection.cases} NATIVE POINTS • ${projection.maxCssError.toFixed(6)} CSS PX • ${viewport.rotated ? 'ROTATED ' : ''}${viewport.fitMode.toUpperCase()} • DPR ${viewport.requestedDpr} → ${viewport.effectiveDpr} • NOT GAMEPLAY ART`;
                    document.documentElement.dataset.qaReady = '1';
                } catch (error) { fail(error); }
            });
        } },
    });
    window.addEventListener('pagehide', () => { unsubscribe(); renderer.dispose(); engine.loop.stop(); engine.destroy(true, false); engine.step(performance.now(), 0); }, { once: true });
} catch (error) { fail(error); }
