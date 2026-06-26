import { JOYSTICK, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config.js';
import { TWO_PI, clamp } from '../utils/math.js';

export class TouchJoystick {
    constructor(renderer) {
        this.renderer = renderer;
        this.maxRadius = JOYSTICK.maxRadius;
        this.deadzone = JOYSTICK.deadzone;

        this.active = false;
        this.touchId = null;
        this.origin = { x: 0, y: 0 };
        this.current = { x: 0, y: 0 };

        this.supported = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        const target = renderer.canvas;
        const opts = { passive: false };

        this._onStart = (e) => this._handleStart(e);
        this._onMove = (e) => this._handleMove(e);
        this._onEnd = (e) => this._handleEnd(e);
        this._onCancel = () => this._reset();
        this._onBlur = () => this._reset();
        this._onVisibility = () => {
            if (document.hidden) this._reset();
        };

        target.addEventListener('touchstart', this._onStart, opts);
        target.addEventListener('touchmove', this._onMove, opts);
        target.addEventListener('touchend', this._onEnd, opts);
        target.addEventListener('touchcancel', this._onCancel, opts);

        window.addEventListener('blur', this._onBlur);
        document.addEventListener('visibilitychange', this._onVisibility);

        const blockGesture = (e) => e.preventDefault();
        document.addEventListener('gesturestart', blockGesture);
        document.addEventListener('gesturechange', blockGesture);
        document.addEventListener('gestureend', blockGesture);
    }

    _reset() {
        this.active = false;
        this.touchId = null;
    }

    _safeOrigin(pos) {
        const sa = this.renderer.safeArea;
        const margin = 12;
        const minX = sa.left + this.maxRadius + margin;
        const maxX = Math.max(minX, INTERNAL_WIDTH / 2 - this.maxRadius - margin);
        const minY = sa.top + this.maxRadius + margin;
        const maxY = Math.max(minY, INTERNAL_HEIGHT - sa.bottom - this.maxRadius - margin);
        return {
            x: clamp(pos.x, minX, maxX),
            y: clamp(pos.y, minY, maxY),
        };
    }

    _handleStart(e) {
        e.preventDefault();
        if (this.active) return;
        for (const t of e.changedTouches) {
            const pos = this.renderer.clientToInternal(t.clientX, t.clientY);
            if (pos.x <= INTERNAL_WIDTH / 2) {
                this.active = true;
                this.touchId = t.identifier;
                this.origin = this._safeOrigin(pos);
                this.current = pos;
                return;
            }
        }
    }

    _handleMove(e) {
        e.preventDefault();
        if (!this.active) return;
        for (const t of e.changedTouches) {
            if (t.identifier === this.touchId) {
                this.current = this.renderer.clientToInternal(t.clientX, t.clientY);
                return;
            }
        }
    }

    _handleEnd(e) {
        e.preventDefault();
        if (!this.active) return;
        for (const t of e.changedTouches) {
            if (t.identifier === this.touchId) {
                this._reset();
                return;
            }
        }
    }

    getVector() {
        if (!this.active) return { x: 0, y: 0 };
        const dx = this.current.x - this.origin.x;
        const dy = this.current.y - this.origin.y;
        const len = Math.hypot(dx, dy);
        if (len < this.deadzone) return { x: 0, y: 0 };
        const clamped = Math.min(len, this.maxRadius);
        const magnitude = clamped / this.maxRadius;
        return {
            x: (dx / len) * magnitude,
            y: (dy / len) * magnitude,
        };
    }

    draw(ctx) {
        if (!this.active) return;
        const r = this.maxRadius;
        ctx.save();

        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.origin.x, this.origin.y, r, 0, TWO_PI);
        ctx.fill();

        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(this.origin.x, this.origin.y, r, 0, TWO_PI);
        ctx.stroke();

        let tdx = this.current.x - this.origin.x;
        let tdy = this.current.y - this.origin.y;
        const tlen = Math.hypot(tdx, tdy);
        if (tlen > r) {
            tdx = (tdx / tlen) * r;
            tdy = (tdy / tlen) * r;
        }
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.origin.x + tdx, this.origin.y + tdy, r * 0.4, 0, TWO_PI);
        ctx.fill();

        ctx.restore();
    }
}
