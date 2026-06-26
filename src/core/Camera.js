import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../config.js';

export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.target = null;
        this.smoothing = 1;
    }

    follow(target) {
        this.target = target;
        if (target) {
            this.x = target.x;
            this.y = target.y;
        }
    }

    update(dt) {
        if (!this.target) return;
        if (this.smoothing >= 1) {
            this.x = this.target.x;
            this.y = this.target.y;
            return;
        }
        const t = 1 - Math.pow(1 - this.smoothing, dt * 60);
        this.x += (this.target.x - this.x) * t;
        this.y += (this.target.y - this.y) * t;
    }

    apply(ctx) {
        ctx.translate(INTERNAL_WIDTH / 2 - this.x, INTERNAL_HEIGHT / 2 - this.y);
    }

    screenToWorld(sx, sy) {
        return {
            x: sx + this.x - INTERNAL_WIDTH / 2,
            y: sy + this.y - INTERNAL_HEIGHT / 2,
        };
    }
}
