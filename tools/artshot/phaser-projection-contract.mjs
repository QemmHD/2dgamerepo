import { Renderer } from '../../src/systems/Renderer.js';
import { Camera } from '../../src/core/Camera.js';
import { TouchButtons } from '../../src/core/TouchButtons.js';
import { RENDER } from '../../src/config/GameConfig.js';
import { snapshotCamera, applyCameraToPhaser, projectWorldToBacking,
    logicalToClient, backingToClient } from '../../src/systems/ViewportContract.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const PROJECTION_VIEWPORTS = [
    { id: 'desktop-landscape', width: 1280, height: 720, coarse: false, fit: 'cover' },
    { id: 'desktop-contain', width: 2560, height: 720, coarse: false, fit: 'contain' },
    { id: 'phone-landscape', width: 844, height: 390, coarse: true, fit: 'cover' },
    { id: 'phone-landscape-contain', width: 1080, height: 390, coarse: true, fit: 'contain' },
    { id: 'phone-portrait', width: 390, height: 844, coarse: true, fit: 'cover' },
    { id: 'phone-portrait-contain', width: 390, height: 1080, coarse: true, fit: 'contain' },
];
const SAFE_INSETS = [
    { top: 0, right: 0, bottom: 0, left: 0 },
    { top: 47, right: 13, bottom: 34, left: 9 },
];
const ZOOMS = [0.75, 1, 2];
const SHAKES = [
    { x: 0, y: 0, rotation: 0 },
    { x: 11.25, y: -7.75, rotation: 0.023 },
];

function cameraFixture(zoom, shake) {
    const camera = new Camera();
    camera.x = 173.25; camera.y = -229.5; camera.zoom = zoom;
    camera.shakeOffsetX = shake.x; camera.shakeOffsetY = shake.y; camera.shakeAngle = shake.rotation;
    return camera;
}

function worldPoints(camera) {
    const points = [
        { id: 'world-origin', x: 0, y: 0 },
        { id: 'player-center', x: camera.x, y: camera.y },
        { id: 'camera-marker', x: camera.x + 53.25, y: camera.y - 21.5 },
        { id: 'door-wall-boundary', x: 225.125, y: -156.625 },
        { id: 'enemy', x: 402.5, y: -90.75 },
        { id: 'projectile', x: -95.25, y: 80.5 },
    ];
    for (const [id, x, y] of [['top-left', 0, 0], ['top-right', 1920, 0],
        ['bottom-right', 1920, 1080], ['bottom-left', 0, 1080]]) {
        points.push({ id: `logical-${id}`, ...camera.screenToWorld(x, y) });
    }
    return points;
}

function touchPoints(renderer) {
    const layout = TouchButtons.prototype.layout.call({ renderer });
    return [
        { id: 'touch-blink', ...layout.blink },
        { id: 'touch-kindle', ...layout.kindle },
        { id: 'touch-joystick', x: renderer.safeArea.left + 200, y: 780 - renderer.safeArea.bottom },
    ];
}

// Behavioral Node fixture: run the unchanged sizing and input calculations in
// the real Renderer, with explicit synthetic browser metrics. This complements
// (does not replace) the native Canvas-vs-Phaser browser gate below.
export function validateViewportContract(check = assert) {
    const restorers = [];
    const replace = (object, key, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        Object.defineProperty(object, key, { configurable: true, writable: true, value });
        restorers.push(() => descriptor ? Object.defineProperty(object, key, descriptor) : delete object[key]);
    };
    class Target {
        constructor() { this.listeners = new Map(); }
        addEventListener(type, callback) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(callback);
        }
        removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
        dispatch(type) { for (const callback of this.listeners.get(type) || []) callback({ type }); }
        count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
    }
    const tokens = () => {
        const set = new Set();
        return { add: value => set.add(value), remove: value => set.delete(value),
            contains: value => set.has(value), toggle(value, on) { on ? set.add(value) : set.delete(value); } };
    };
    let rafId = 0, coarse = false, safe = SAFE_INSETS[0], now = 0;
    const raf = new Map(), window = new Target(), document = new Target();
    window.visualViewport = new Target(); window.performance = { now: () => now };
    window.matchMedia = () => ({ matches: coarse });
    const hint = { classList: tokens() };
    document.documentElement = {}; document.getElementById = id => id === 'rotate-hint' ? hint : null;
    replace(globalThis, 'window', window); replace(globalThis, 'document', document);
    replace(globalThis, 'getComputedStyle', () => ({ getPropertyValue: name => `${safe[name.slice(6)] || 0}px` }));
    replace(globalThis, 'requestAnimationFrame', callback => { const id = ++rafId; raf.set(id, callback); return id; });
    replace(globalThis, 'cancelAnimationFrame', id => raf.delete(id));
    const makeCanvas = () => {
        const calls = [], context = {
            setTransform(...args) { calls.push(['transform', ...args]); },
            fillRect(...args) { calls.push(['fill', ...args]); },
            clearRect(...args) { calls.push(['clear', ...args]); },
        };
        const stage = { classList: tokens() };
        const canvas = { style: {}, width: 0, height: 0, parentElement: stage,
            getContext(_type, options) { canvas.alpha = options.alpha; return context; },
            getBoundingClientRect() {
                const width = parseFloat(canvas.style.width) || 0, height = parseFloat(canvas.style.height) || 0;
                const rotated = stage.classList.contains('rotated');
                const visualWidth = rotated ? height : width, visualHeight = rotated ? width : height;
                return { left: (window.visualViewport.width - visualWidth) / 2,
                    top: (window.visualViewport.height - visualHeight) / 2, width: visualWidth, height: visualHeight };
            },
        };
        return { canvas, calls };
    };
    let renderer, fixtureCount = 0, pointChecks = 0, maxInputError = 0, maxRasterInputError = 0;
    const rows = [];
    try {
        for (const fixture of PROJECTION_VIEWPORTS) for (const dpr of [1, 2, 3]) for (const insets of SAFE_INSETS) {
            coarse = fixture.coarse; safe = insets; now = 0;
            window.visualViewport.width = fixture.width; window.visualViewport.height = fixture.height;
            window.innerWidth = fixture.width; window.innerHeight = fixture.height; window.devicePixelRatio = dpr;
            const { canvas, calls } = makeCanvas();
            renderer = new Renderer(canvas, { alpha: true, frameSource: 'external' });
            const viewport = renderer.getViewportSnapshot();
            check(canvas.alpha === true && viewport.requestedDpr === dpr, `${fixture.id}: explicit alpha/requested DPR`);
            check(viewport.effectiveDpr === Math.min(dpr, RENDER.maxDpr), `${fixture.id}: production DPR cap preserved`);
            check(viewport.fitMode === fixture.fit && viewport.rotated === (fixture.height > fixture.width && coarse),
                `${fixture.id}: production fit/rotation preserved`);
            check(viewport.backingWidth === Math.round(viewport.cssWidth * viewport.effectiveDpr)
                && viewport.backingHeight === Math.round(viewport.cssHeight * viewport.effectiveDpr), `${fixture.id}: exact backing policy`);
            check(Object.values(viewport.safeInsets).every(value => Number.isFinite(value) && value >= 0), `${fixture.id}: finite safe area`);
            check(JSON.stringify(viewport.safeInsetsCss) === JSON.stringify(safe), `${fixture.id}: physical CSS safe insets retained`);
            check(raf.size === 0, `${fixture.id}: external Renderer owns no resize/hint RAF`);
            viewport.safeInsets.left = -1000; viewport.stage.rotationDegrees = -1000;
            check(renderer.getViewportSnapshot().safeInsets.left >= 0
                && renderer.getViewportSnapshot().stage.rotationDegrees >= 0, `${fixture.id}: snapshot detached`);
            const fresh = renderer.getViewportSnapshot();
            const sa = fresh.safeInsets;
            const safeEdges = [logicalToClient(fresh, sa.left, 540), logicalToClient(fresh, 1920 - sa.right, 540),
                logicalToClient(fresh, 960, sa.top), logicalToClient(fresh, 960, 1080 - sa.bottom)];
            const [left, right, top, bottom] = fresh.rotated
                ? [safeEdges[3], safeEdges[2], safeEdges[0], safeEdges[1]] : safeEdges;
            check(left.x >= safe.left - 1e-9 && right.x <= fixture.width - safe.right + 1e-9
                && top.y >= safe.top - 1e-9 && bottom.y <= fixture.height - safe.bottom + 1e-9,
            `${fixture.id}: logical HUD safe edges remain inside physical safe insets after rotation/crop`);
            for (const point of [...touchPoints(renderer), { id: 'origin', x: 0, y: 0 }, { id: 'corner', x: 1920, y: 1080 }]) {
                const client = logicalToClient(fresh, point.x, point.y);
                const logical = renderer.clientToInternal(client.x, client.y);
                const error = distance(logical, point);
                maxInputError = Math.max(maxInputError, error);
                check(error < 1e-9, `${fixture.id}/${point.id}: exact existing input round-trip`);
                const rendered = backingToClient(fresh, point.x * renderer.scale, point.y * renderer.scale);
                const rasterError = distance(rendered, client);
                maxRasterInputError = Math.max(maxRasterInputError, rasterError);
                check(rasterError <= 0.5, `${fixture.id}/${point.id}: backing rounding within half CSS pixel`);
                pointChecks++;
            }
            for (const zoom of ZOOMS) for (const shake of SHAKES) {
                const camera = cameraFixture(zoom, shake), snapshot = snapshotCamera(camera);
                for (const point of worldPoints(camera)) {
                    // Independent Camera.apply characterization (not the affine
                    // recorder implementation): world relative to camera,
                    // unscaled shake, then rotation around logical center.
                    const dx = (point.x - camera.x) * zoom + shake.x;
                    const dy = (point.y - camera.y) * zoom + shake.y;
                    const expected = { x: (960 + Math.cos(shake.rotation) * dx - Math.sin(shake.rotation) * dy) * renderer.scale,
                        y: (540 + Math.sin(shake.rotation) * dx + Math.cos(shake.rotation) * dy) * renderer.scale };
                    check(distance(projectWorldToBacking(snapshot, fresh, point.x, point.y), expected) < 1e-8,
                        `${fixture.id}/${zoom}/${point.id}: captured real Camera.apply projection`);
                    pointChecks++;
                }
                const target = camera.screenToWorld(1140, 630);
                check(target.x === 180 / zoom + camera.x && target.y === 90 / zoom + camera.y,
                    `${fixture.id}/${zoom}: simulation camera targeting remains unshaken`);
            }
            let notifications = 0;
            const unsubscribe = renderer.subscribeViewport(value => { notifications++; value.safeInsets.top = -1000; });
            window.dispatch('resize'); window.dispatch('resize');
            check(notifications === 1 && raf.size === 0, `${fixture.id}: external resize coalesced without RAF`);
            renderer.processPresentationFrame(16);
            check(notifications === 2 && renderer.safeArea.top >= 0, `${fixture.id}: one detached post-resize notification`);
            unsubscribe(); renderer.resize();
            check(notifications === 2, `${fixture.id}: unsubscribe takes effect`);
            let repeated = 0;
            const sameCallback = () => repeated++;
            const oldRegistration = renderer.subscribeViewport(sameCallback);
            const newRegistration = renderer.subscribeViewport(sameCallback);
            oldRegistration(); renderer.resize(); newRegistration();
            check(repeated === 3, `${fixture.id}: old unsubscribe preserves newer same-function registration`);
            renderer.beginOverlayFrame(); renderer.beginFrame();
            check(calls.filter(call => call[0] === 'clear').length === 1 && calls.filter(call => call[0] === 'fill').length === 1,
                `${fixture.id}: transparent overlay and opaque production clear are separate`);
            if (renderer.rotated) {
                renderer.processPresentationFrame(2600);
                check(hint.classList.contains('hidden') && renderer._hintHideAt === 0, `${fixture.id}: host frame advances rotate cue`);
            }
            rows.push({ id: fixture.id, requestedDpr: dpr, effectiveDpr: fresh.effectiveDpr,
                fitMode: fresh.fitMode, rotated: fresh.rotated, safeInsets: fresh.safeInsets });
            renderer.dispose(); renderer.processPresentationFrame(3000);
            check(window.count() === 0 && window.visualViewport.count() === 0
                && renderer._viewportSubscribers.size === 0 && raf.size === 0, `${fixture.id}: disposal removes every owner`);
            renderer = null; fixtureCount++;
        }
        // The default production branch still coalesces through its own RAF.
        coarse = false; window.visualViewport.width = 1280; window.visualViewport.height = 720;
        const { canvas } = makeCanvas(); renderer = new Renderer(canvas);
        window.dispatch('resize'); window.dispatch('resize');
        check(canvas.alpha === false && raf.size === 1, 'default production alpha/resize RAF behavior retained');
        renderer.dispose(); renderer = null;
        check(raf.size === 0, 'default Renderer cancels its owned resize callback');
        coarse = true; now = 0;
        window.visualViewport.width = 390; window.visualViewport.height = 844;
        renderer = new Renderer(makeCanvas().canvas, { alpha: true, frameSource: 'external' });
        let orientationResets = 0;
        renderer.onOrientationChange = () => orientationResets++;
        check(renderer.rotated && !hint.classList.contains('hidden'), 'first portrait entry expands the upright rotate cue');
        window.visualViewport.width = 844; window.visualViewport.height = 390;
        window.dispatch('orientationchange'); window.dispatch('resize'); renderer.processPresentationFrame(100);
        check(!renderer.rotated && orientationResets === 1 && !hint.classList.contains('show'),
            'landscape orientation change resets input once and removes rotate cue');
        window.visualViewport.width = 390; window.visualViewport.height = 844;
        window.dispatch('orientationchange'); renderer.processPresentationFrame(200);
        check(renderer.rotated && orientationResets === 2 && hint.classList.contains('hidden')
            && hint.classList.contains('show') && raf.size === 0, 'portrait reentry retains compact cue under sole host frame owner');
        const finalSnapshot = renderer.getViewportSnapshot();
        const start = logicalToClient(finalSnapshot, 200, 700), end = logicalToClient(finalSnapshot, 264, 700);
        const from = renderer.clientToInternal(start.x, start.y), to = renderer.clientToInternal(end.x, end.y);
        check(Math.abs(to.x - from.x - 64) < 1e-9 && Math.abs(to.y - from.y) < 1e-9,
            'portrait physical movement is not swapped or inverted');
        renderer.dispose(); renderer = null;
        return { passed: true, fixtureCount, pointChecks, maxInputError, maxRasterInputError, rows };
    } finally { renderer?.dispose(); for (const restore of restorers.reverse()) restore(); }
}

// Run in the actual WebGL page. This compares TWO independent native paths:
// real CanvasRenderingContext2D.getTransform after Camera.apply, and the actual
// pinned Phaser Camera.getViewMatrix after bridge setters + preRender. It does
// not compare the bridge's projection helper against itself.
export function verifyBrowserProjection(Phaser, renderer, check = assert) {
    const viewport = renderer.getViewportSnapshot();
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Native projection reference Canvas unavailable');
    const phaserCamera = new Phaser.Cameras.Scene2D.Camera(0, 0, viewport.backingWidth, viewport.backingHeight);
    const rows = [];
    let maxCssError = 0, maxInputError = 0;
    try {
        for (const zoom of ZOOMS) for (const shake of SHAKES) {
            const camera = cameraFixture(zoom, shake);
            context.setTransform(renderer.scale, 0, 0, renderer.scale, 0, 0);
            camera.apply(context);
            const native = context.getTransform();
            applyCameraToPhaser(snapshotCamera(camera), phaserCamera, viewport);
            phaserCamera.preRender();
            const actual = phaserCamera.getViewMatrix();
            const points = worldPoints(camera);
            // Touch centers are overlay coordinates, not shaken world points.
            // Map each center back with the native reference matrix solely to
            // place a matching diagnostic marker through the real Phaser camera.
            const inverse = native.inverse();
            for (const point of touchPoints(renderer)) {
                const x = point.x * renderer.scale, y = point.y * renderer.scale;
                points.push({ id: point.id, x: inverse.a * x + inverse.c * y + inverse.e,
                    y: inverse.b * x + inverse.d * y + inverse.f });
                const client = logicalToClient(viewport, point.x, point.y);
                maxInputError = Math.max(maxInputError, distance(renderer.clientToInternal(client.x, client.y), point));
            }
            for (const point of points) {
                const canvas = { x: native.a * point.x + native.c * point.y + native.e,
                    y: native.b * point.x + native.d * point.y + native.f };
                const webgl = actual.transformPoint(point.x, point.y, {});
                const error = distance(backingToClient(viewport, canvas.x, canvas.y), backingToClient(viewport, webgl.x, webgl.y));
                maxCssError = Math.max(maxCssError, error);
                check(error <= 0.5, `Native Canvas/Phaser projection ${point.id} zoom ${zoom}: ${error} CSS pixels`);
                rows.push({ id: point.id, zoom, shake: shake.rotation !== 0, cssError: error });
            }
        }
        check(maxInputError < 1e-8, 'Native browser existing physical input mapping round-trip');
        return { passed: true, nativeCanvasReference: true, actualPhaserCameraReference: true,
            viewport, maxCssError, maxInputError, cases: rows.length, rows,
            preservedExceptions: ['UISystem focus/aim HUD and Game Focus tap intentionally omit zoom and shake',
                'ParticleSystem screen-additive and LightingSystem translation mappers intentionally omit shake rotation'] };
    } finally { phaserCamera.destroy(); }
}
