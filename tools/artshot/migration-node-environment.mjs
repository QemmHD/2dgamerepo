// TEST ONLY. No production imports, game construction, clock, RNG, or host I/O.
// This is a semantic-fixture environment, not a rasterizer or browser emulator.
// Run each scenario in a fresh Node process: restoring globals cannot unload ESM
// dependencies or reset their asset/readiness/procedural-sprite caches.

const WIDTH = 1920;
const HEIGHT = 1080;
const NOOP = () => {};
let installed = false;

function eventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, callback, options = {}) {
            if (!callback) return;
            const capture = typeof options === 'boolean' ? options : !!options.capture;
            const entries = listeners.get(type) || [];
            if (!entries.some((entry) => entry.callback === callback && entry.capture === capture)) {
                entries.push({ callback, capture, once: !!options?.once });
                listeners.set(type, entries);
            }
        },
        removeEventListener(type, callback, options = {}) {
            const capture = typeof options === 'boolean' ? options : !!options.capture;
            listeners.set(type, (listeners.get(type) || []).filter(
                (entry) => entry.callback !== callback || entry.capture !== capture,
            ));
        },
        dispatchEvent(event) {
            if (!event || typeof event.type !== 'string') throw new TypeError('Event requires a type');
            // Fixture events may be plain objects or native Node Event instances.
            // No DOM ancestry/bubbling is emulated; dispatch at the actual target.
            for (const key of ['target', 'currentTarget']) {
                try { Object.defineProperty(event, key, { configurable: true, value: this }); } catch { /* native readonly */ }
            }
            if (typeof event.preventDefault !== 'function') {
                event.preventDefault = () => { event.defaultPrevented = true; };
            }
            const entries = [...(listeners.get(event.type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
            for (const entry of entries) {
                if (!(listeners.get(event.type) || []).includes(entry)) continue;
                if (entry.once) this.removeEventListener(event.type, entry.callback, entry.capture);
                if (typeof entry.callback === 'function') entry.callback.call(this, event);
                else entry.callback.handleEvent(event);
            }
            return !event.defaultPrevented;
        },
    };
}

function element(tagName = 'div') {
    const attributes = new Map();
    const classes = new Set();
    const style = {
        setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] ?? ''; },
        removeProperty(name) { const old = this[name] ?? ''; delete this[name]; return old; },
    };
    return {
        ...eventTarget(), tagName: tagName.toUpperCase(), style, children: [],
        textContent: '', innerText: '', id: '', parentElement: null,
        classList: {
            add(...names) { names.forEach((name) => classes.add(name)); },
            remove(...names) { names.forEach((name) => classes.delete(name)); },
            contains(name) { return classes.has(name); },
            toggle(name, force) {
                const enabled = force === undefined ? !classes.has(name) : !!force;
                if (enabled) classes.add(name); else classes.delete(name);
                return enabled;
            },
        },
        setAttribute(name, value) {
            attributes.set(String(name), String(value));
            if (name === 'id') this.id = String(value);
        },
        getAttribute(name) { return attributes.get(String(name)) ?? null; },
        removeAttribute(name) { attributes.delete(String(name)); },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index < 0) throw new Error('Child not found');
            this.children.splice(index, 1); child.parentElement = null; return child;
        },
        remove() { if (this.parentElement) this.parentElement.removeChild(this); },
        focus() { if (globalThis.document) globalThis.document.activeElement = this; },
        blur() { if (globalThis.document?.activeElement === this) globalThis.document.activeElement = null; },
    };
}

function pixels(width, height) {
    const w = Math.max(1, Math.trunc(Number(width)) || 1);
    const h = Math.max(1, Math.trunc(Number(height)) || 1);
    if (!Number.isSafeInteger(w * h) || w * h > 32 * 1024 * 1024) throw new RangeError('Fixture pixel buffer too large');
    // Transparent data only: deliberately does not claim to draw/validate assets.
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

function canvas() {
    const surface = { ...element('canvas'), width: 300, height: 150 };
    const stack = [];
    const gradient = () => ({ addColorStop: NOOP });
    const context = {
        canvas: surface, globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
        font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
        imageSmoothingEnabled: true, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        createLinearGradient: gradient, createRadialGradient: gradient, createConicGradient: gradient,
        createPattern: () => ({ setTransform: NOOP }),
        measureText(text) { return { width: String(text).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; },
        getImageData(_x, _y, width, height) { return pixels(width, height); },
        createImageData(width, height) {
            return typeof width === 'object' ? pixels(width.width, width.height) : pixels(width, height);
        },
        getLineDash: () => [],
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        isPointInPath: () => false, isPointInStroke: () => false,
        save() {
            stack.push(Object.fromEntries(Object.entries(context).filter(
                ([key, value]) => key !== 'canvas' && typeof value !== 'function',
            )));
        },
        restore() { const state = stack.pop(); if (state) Object.assign(context, state); },
    };
    const proxy = new Proxy(context, {
        get(target, key) {
            if (Reflect.has(target, key)) return target[key];
            if (typeof key === 'symbol' || key === 'then') return undefined;
            return NOOP; // Remaining Canvas drawing methods have no pixel output.
        },
    });
    surface.getContext = (kind) => kind === '2d' ? proxy : null;
    surface.getBoundingClientRect = () => {
        const width = parseFloat(surface.style.width) || surface.width;
        const height = parseFloat(surface.style.height) || surface.height;
        const left = parseFloat(surface.style.left) || 0;
        const top = parseFloat(surface.style.top) || 0;
        return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
    };
    surface.toDataURL = () => { throw new Error('Node procedural stubs cannot produce screenshot evidence'); };
    return surface;
}

function memoryStorage() {
    const values = new Map();
    return {
        get length() { return values.size; },
        key(index) { return [...values.keys()][Number(index) >>> 0] ?? null; },
        getItem(key) { return values.get(String(key)) ?? null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); },
        clear() { values.clear(); },
    };
}

// Image loads explicitly fail into the production procedural fallback. No disk,
// network, fake successful loads, or asynchronous timer is involved.
class UnavailableImage {
    constructor() {
        Object.assign(this, eventTarget());
        this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0;
        this.complete = false; this.onload = null; this.onerror = null; this._src = '';
    }
    get src() { return this._src; }
    set src(value) {
        this._src = String(value);
        queueMicrotask(() => {
            this.complete = true;
            const event = { type: 'error', target: this };
            if (typeof this.onerror === 'function') this.onerror(event);
            this.dispatchEvent(event);
        });
    }
}

export function installNodeEnvironment() {
    if (!globalThis.process?.versions?.node) throw new Error('Node environment is test-only and cannot run in a browser');
    if (installed) throw new Error('Node fixture environment already installed');
    const originals = new Map();
    let restored = false;
    const restore = () => {
        if (restored) return;
        for (const [name, descriptor] of [...originals].reverse()) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
        restored = true;
        installed = false;
    };
    const replace = (name, value) => {
        originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, writable: true, value });
    };

    try {
        const storage = memoryStorage();
        const main = canvas();
        main.width = WIDTH; main.height = HEIGHT; main.id = 'game';
        main.style.width = `${WIDTH}px`; main.style.height = `${HEIGHT}px`;
        const body = element('body');
        const stage = element(); stage.id = 'stage'; body.appendChild(stage); stage.appendChild(main);
        const nodes = new Map([['game', main], ['stage', stage]]);
        for (const id of ['game-status', 'game-objective', 'rotate-hint']) {
            const node = element(); node.id = id; nodes.set(id, node); body.appendChild(node);
        }
        const document = {
            ...eventTarget(), body, documentElement: element('html'), activeElement: null,
            hidden: false, visibilityState: 'visible', readyState: 'complete',
            getElementById: (id) => nodes.get(id) ?? null,
            createElement: (tag) => String(tag).toLowerCase() === 'canvas' ? canvas() : element(tag),
        };
        const location = { search: '?skipOnboarding=1', hostname: 'localhost', pathname: '/tools/artshot/migration-baseline.html' };
        // No locks: real SaveSystem takes its unsupported-lock branch and mutates
        // only the memory storage above. Never joins browser/profile save locks.
        const navigator = { maxTouchPoints: 0, userAgent: 'Emberwake migration Node procedural stubs' };
        const window = {
            ...eventTarget(), document, navigator, location, localStorage: storage,
            innerWidth: WIDTH, innerHeight: HEIGHT, devicePixelRatio: 1,
            get performance() { return globalThis.performance; },
            matchMedia: (media) => ({ ...eventTarget(), media: String(media), matches: false, onchange: null }),
        };
        window.window = window; window.self = window;
        const renderer = {
            environment: 'node-procedural-stubs', canvas: main, ctx: main.getContext('2d'),
            internalWidth: WIDTH, internalHeight: HEIGHT, cssWidth: WIDTH, cssHeight: HEIGHT,
            scale: 1, dpr: 1, rotated: false, safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
            beginFrame() {
                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                this.ctx.clearRect(0, 0, main.width, main.height);
                return main.width > 0 && main.height > 0;
            },
            setDprCap(cap) { this._dprCap = cap; }, // No backing-store performance evidence in this environment.
            tryLockLandscape: NOOP,
            clientToInternal(clientX, clientY) {
                if (this.rotated) throw new Error('Node fixture supports unrotated coordinates only; verify rotation in browser');
                const rect = main.getBoundingClientRect();
                return { x: (clientX - rect.left) * WIDTH / (rect.width || 1), y: (clientY - rect.top) * HEIGHT / (rect.height || 1) };
            },
        };
        for (const [name, value] of Object.entries({
            window, document, navigator, location, localStorage: storage, Image: UnavailableImage,
            FontFace: undefined, Audio: undefined,
            getComputedStyle: (node) => node.style,
        })) replace(name, value);
        installed = true;
        return { renderer, restore };
    } catch (error) {
        restore();
        throw error;
    }
}
