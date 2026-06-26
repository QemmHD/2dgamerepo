import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config.js';

export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.target = null;
        this.smoothing = 1;

        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeTime = 0;
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
    }

    follow(target) {
        this.target = target;
        if (target) {
            this.x = target.x;
            this.y = target.y;
        }
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeTime = 0;
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
    }

    shake(intensity, duration) {
        if (intensity <= 0 || duration <= 0) return;
        if (intensity >= this.shakeIntensity) {
            this.shakeIntensity = intensity;
            this.shakeDuration = duration;
            this.shakeTime = 0;
        }
    }

    update(dt) {
        if (this.target) {
            if (this.smoothing >= 1) {
                this.x = this.target.x;
                this.y = this.target.y;
            } else {
                const t = 1 - Math.pow(1 - this.smoothing, dt * 60);
                this.x += (this.target.x - this.x) * t;
                this.y += (this.target.y - this.y) * t;
            }
        }

        if (this.shakeIntensity > 0) {
            this.shakeTime += dt;
            const progress = Math.min(1, this.shakeTime / this.shakeDuration);
            const remaining = 1 - progress;
            if (remaining <= 0) {
                this.shakeIntensity = 0;
                this.shakeOffsetX = 0;
                this.shakeOffsetY = 0;
            } else {
                const mag = this.shakeIntensity * remaining;
                this.shakeOffsetX = (Math.random() - 0.5) * 2 * mag;
                this.shakeOffsetY = (Math.random() - 0.5) * 2 * mag;
            }
        }
    }

    apply(ctx) {
        ctx.translate(
            INTERNAL_WIDTH / 2 - this.x + this.shakeOffsetX,
            INTERNAL_HEIGHT / 2 - this.y + this.shakeOffsetY
        );
    }

    screenToWorld(sx, sy) {
        return {
            x: sx + this.x - INTERNAL_WIDTH / 2,
            y: sy + this.y - INTERNAL_HEIGHT / 2,
        };
    }
}
