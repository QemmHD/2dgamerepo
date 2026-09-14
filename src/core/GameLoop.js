import { FIXED_DT, MAX_FRAME_DT } from '../config/GameConfig.js';

export class GameLoop {
    constructor({ update, render, fixedDt = FIXED_DT, maxFrameDt = MAX_FRAME_DT }) {
        this._disposed = false;
        this._frameId = null;
        this._visibilityAttached = false;
        this._document = document;
        this._cancelFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : null;
        this.update = update;
        this.render = render;
        this.fixedDt = fixedDt;
        this.maxFrameDt = maxFrameDt;

        this.accumulator = 0;
        this.last = 0;
        this.running = false;
        this.scheduler = null;
        this.fps = 0;
        this._fpsAccum = 0;
        this._fpsFrames = 0;

        // Optional per-frame timing profiler (roadmap #4), set by main.js after
        // the Game (which owns it) is built. Times the two top-level phases here
        // — the clean single call sites — while Game times the sub-phases inside
        // update()/render(). No-op unless the dev/debug HUD has enabled it.
        this.profiler = null;

        this._tick = this._tick.bind(this);
        this._onVisibility = () => {
            if (!this._disposed && !this._document.hidden) this.resetClock();
        };
        try {
            this._document.addEventListener('visibilitychange', this._onVisibility);
            this._visibilityAttached = true;
        } catch (error) { this.dispose(); throw error; }
    }

    start() {
        if (this._disposed || this.running) return;
        this.running = true;
        this.scheduler = 'raf';
        this.resetClock();
        this._frameId = requestAnimationFrame(this._tick);
    }

    // External hosts own presentation cadence, never a second accumulator or
    // RAF chain. Timestamps use the same monotonic domain as performance.now().
    startExternal(now = performance.now()) {
        if (this._disposed || this.running) return;
        this.running = true;
        this.scheduler = 'external';
        this.resetClock(now);
    }

    stop() {
        this.running = false;
        this.scheduler = null;
        if (this._frameId !== null) this._cancelFrame?.(this._frameId);
        this._frameId = null;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.stop();
        if (this._visibilityAttached) {
            this._document.removeEventListener('visibilitychange', this._onVisibility);
            this._visibilityAttached = false;
        }
        this.profiler = null;
        this.update = null;
        this.render = null;
    }

    resetClock(now = performance.now()) {
        if (this._disposed) return;
        this.last = now;
        this.accumulator = 0;
    }

    // Shared simulation/frame-accounting policy. Preserve the exact arithmetic:
    // no delta smoothing, lower clamp, epsilon, or discarded remainder here.
    processFrame(now) {
        if (this._disposed || !this.running) return null;
        let frameDt = (now - this.last) / 1000;
        this.last = now;
        if (frameDt > this.maxFrameDt) frameDt = this.maxFrameDt;

        this._fpsAccum += frameDt;
        this._fpsFrames += 1;
        if (this._fpsAccum >= 0.5) {
            this.fps = this._fpsFrames / this._fpsAccum;
            this._fpsAccum = 0;
            this._fpsFrames = 0;
        }

        const prof = this.profiler;
        this.accumulator += frameDt;
        let steps = 0;
        while (this.running && this.accumulator >= this.fixedDt && steps < 8) {
            if (prof) prof.begin('update');
            this.update(this.fixedDt);
            if (prof) prof.end('update');
            this.accumulator -= this.fixedDt;
            steps += 1;
        }

        if (!this.running) return null;
        // Private host token, not a serializable receipt: retaining the profiler
        // preserves the original per-frame snapshot across update and render.
        return { steps, alpha: this.accumulator / this.fixedDt, profiler: prof };
    }

    renderFrame(frame) {
        if (this._disposed || !this.running || !frame) return;
        const prof = frame.profiler;
        if (prof) prof.begin('render');
        this.render(frame.alpha);
        if (prof) prof.end('render');
        if (prof) prof.frame();
    }

    _tick(now) {
        if (this._disposed || !this.running || this.scheduler !== 'raf') return;
        this._frameId = null;
        try {
            this.renderFrame(this.processFrame(now));
        } catch (err) {
            console.error('[GameLoop] frame error:', err);
        } finally {
            if (this.running && this.scheduler === 'raf' && this._frameId === null) this._frameId = requestAnimationFrame(this._tick);
        }
    }
}
