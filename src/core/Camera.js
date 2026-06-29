import { INTERNAL_WIDTH, INTERNAL_HEIGHT, SCREEN_SHAKE } from '../config/GameConfig.js';

// Trauma-based screen shake (Squirrel Eiserloh, "Juicing Your Cameras With
// Math"): a single trauma value in 0..1 accumulates on impacts and decays
// linearly. The visible shake scales with trauma SQUARED, so light taps barely
// register while big hits slam — and overlapping hits stack toward a cap,
// giving the satisfying buildup of a dense fight. Offset + a little rotation;
// rotation reads much heavier than translation alone.
const SHAKE_MAX_OFFSET = 30;     // px at full trauma
const SHAKE_MAX_ANGLE = 0.03;    // rad at full trauma (~1.7°)
const TRAUMA_DECAY = 1.5;        // trauma drained per second
// Legacy shake(intensity) calls map their intensity onto trauma against this
// reference (SCREEN_SHAKE.intensity ≈ a normal hit → ~0.44 trauma).
const TRAUMA_REF = SCREEN_SHAKE.intensity / 0.44;

export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.target = null;
        this.smoothing = 1;

        this.trauma = 0;
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
        this.shakeAngle = 0;
    }

    follow(target) {
        this.target = target;
        if (target) {
            this.x = target.x;
            this.y = target.y;
        }
        this.trauma = 0;
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
        this.shakeAngle = 0;
    }

    // Direct trauma push, 0..1. Stacks (capped) so rapid hits build up.
    addTrauma(amount) {
        if (amount > 0) this.trauma = Math.min(1, this.trauma + amount);
    }

    // Legacy entry: intensity/duration callers map onto the trauma model.
    // Duration is ignored now (trauma decays on its own); a bigger intensity
    // just means more trauma.
    shake(intensity) {
        if (intensity > 0) this.addTrauma(Math.min(1, intensity / TRAUMA_REF));
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

        if (this.trauma > 0) {
            // shake = trauma² for the nonlinear feel; random per-axis offset +
            // rotation so it never looks like a periodic sine wobble.
            const shake = this.trauma * this.trauma;
            this.shakeOffsetX = (Math.random() * 2 - 1) * SHAKE_MAX_OFFSET * shake;
            this.shakeOffsetY = (Math.random() * 2 - 1) * SHAKE_MAX_OFFSET * shake;
            this.shakeAngle = (Math.random() * 2 - 1) * SHAKE_MAX_ANGLE * shake;
            this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
        } else {
            this.shakeOffsetX = 0;
            this.shakeOffsetY = 0;
            this.shakeAngle = 0;
        }
    }

    apply(ctx) {
        const cx = INTERNAL_WIDTH / 2;
        const cy = INTERNAL_HEIGHT / 2;
        // Rotate the whole world a hair around the screen centre during shake.
        if (this.shakeAngle !== 0) {
            ctx.translate(cx, cy);
            ctx.rotate(this.shakeAngle);
            ctx.translate(-cx, -cy);
        }
        ctx.translate(
            cx - this.x + this.shakeOffsetX,
            cy - this.y + this.shakeOffsetY
        );
    }

    screenToWorld(sx, sy) {
        return {
            x: sx + this.x - INTERNAL_WIDTH / 2,
            y: sy + this.y - INTERNAL_HEIGHT / 2,
        };
    }
}
