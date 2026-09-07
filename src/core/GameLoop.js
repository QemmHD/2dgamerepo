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
            if (!this._disposed && !this._document.hidden) this._resetClock();
        };
        try {
            this._document.addEventListener('visibilitychange', this._onVisibility);
            this._visibilityAttached = true;
        } catch (error) { this.dispose(); throw error; }
    }

    start() {
        if (this._disposed || this.running) return;
        this.running = true;
        this._resetClock();
        this._frameId = requestAnimationFrame(this._tick);
    }

    stop() {
        this.running = false;
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

    _resetClock() {
        this.last = performance.now();
        this.accumulator = 0;
    }

    _tick(now) {
        if (this._disposed || !this.running) return;
        this._frameId = null;
        try {
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

            if (!this.running) return;
            const alpha = this.accumulator / this.fixedDt;
            if (prof) prof.begin('render');
            this.render(alpha);
            if (prof) prof.end('render');
            if (prof) prof.frame();
        } catch (err) {
            console.error('[GameLoop] frame error:', err);
        } finally {
            if (this.running && this._frameId === null) this._frameId = requestAnimationFrame(this._tick);
        }
    }
}
