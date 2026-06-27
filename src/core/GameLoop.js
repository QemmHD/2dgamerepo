import { FIXED_DT, MAX_FRAME_DT } from '../config/GameConfig.js';

export class GameLoop {
    constructor({ update, render, fixedDt = FIXED_DT, maxFrameDt = MAX_FRAME_DT }) {
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

        this._tick = this._tick.bind(this);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this._resetClock();
        });
    }

    start() {
        if (this.running) return;
        this.running = true;
        this._resetClock();
        requestAnimationFrame(this._tick);
    }

    stop() {
        this.running = false;
    }

    _resetClock() {
        this.last = performance.now();
        this.accumulator = 0;
    }

    _tick(now) {
        if (!this.running) return;
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

            this.accumulator += frameDt;
            let steps = 0;
            while (this.accumulator >= this.fixedDt && steps < 8) {
                this.update(this.fixedDt);
                this.accumulator -= this.fixedDt;
                steps += 1;
            }

            const alpha = this.accumulator / this.fixedDt;
            this.render(alpha);
        } catch (err) {
            console.error('[GameLoop] frame error:', err);
        } finally {
            if (this.running) requestAnimationFrame(this._tick);
        }
    }
}
