// Enemy bolt (fired by Spitters). Flies straight, expires on a timer or
// at the world edge, and damages the player on contact — respecting the
// player's i-frames exactly like contact damage so it can't chunk through
// invulnerability frames. Visual is a cached colored glow.

import { ENEMY_PROJECTILE, WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap, clamp } from '../core/MathUtils.js';
import { getGlowSprite } from '../assets/ProceduralSprites.js';

const WORLD_MARGIN = 120;

export class EnemyProjectile {
    // opts (all optional): { homing, turnRate, maxSpeed, color, radius, lifetime }
    // Plain straight bolts pass no opts and behave exactly as before. Homing
    // bolts steer toward the player each frame (capped turn rate) — used by the
    // boss "seeker" moves so the player has to juke, not just sidestep.
    constructor(x, y, vx, vy, damage, opts = {}) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.radius = opts.radius ?? ENEMY_PROJECTILE.radius;
        this.lifetime = opts.lifetime ?? ENEMY_PROJECTILE.lifetime;
        this.age = 0;
        this.active = true;
        this.angle = Math.atan2(vy, vx);
        this.homing = !!opts.homing;
        this.turnRate = opts.turnRate ?? 0;     // radians/sec the heading can turn
        this.maxSpeed = opts.maxSpeed ?? 0;     // homing speed clamp
        this.sprite = getGlowSprite(opts.color ?? ENEMY_PROJECTILE.color);
        // Fading motion trail (matches the player-bolt look) so hostile bolts
        // read as fast-moving energy. Sampled sparsely + capped; additive.
        this.trailColor = opts.color ?? ENEMY_PROJECTILE.color;
        this.trailX = [];
        this.trailY = [];
        this._trailAccum = 0;
    }

    // Returns the damage dealt to the player this frame (0 if none), so the
    // caller can drive feedback. Deactivates on hit, expiry, or leaving the
    // world.
    update(dt, player) {
        // Homing steer: rotate the velocity toward the player by at most
        // turnRate·dt, holding (capped) speed — a lazy seek the player can
        // out-turn but not ignore.
        if (this.homing && player) {
            const desired = Math.atan2(player.y - this.y, player.x - this.x);
            let cur = Math.atan2(this.vy, this.vx);
            let diff = desired - cur;
            while (diff > Math.PI) diff -= TWO_PI;
            while (diff < -Math.PI) diff += TWO_PI;
            const maxTurn = this.turnRate * dt;
            cur += clamp(diff, -maxTurn, maxTurn);
            let speed = Math.hypot(this.vx, this.vy);
            if (this.maxSpeed) speed = Math.min(this.maxSpeed, speed);
            this.vx = Math.cos(cur) * speed;
            this.vy = Math.sin(cur) * speed;
            this.angle = cur;
        }
        // Sample the trail sparsely (every ~0.016s), capped at 6 points.
        this._trailAccum += dt;
        if (this._trailAccum >= 0.016) {
            this._trailAccum = 0;
            this.trailX.push(this.x); this.trailY.push(this.y);
            if (this.trailX.length > 6) { this.trailX.shift(); this.trailY.shift(); }
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.age += dt;
        if (this.age >= this.lifetime) { this.active = false; return 0; }

        const halfW = WORLD_WIDTH / 2 + WORLD_MARGIN;
        const halfH = WORLD_HEIGHT / 2 + WORLD_MARGIN;
        if (this.x < -halfW || this.x > halfW || this.y < -halfH || this.y > halfH) {
            this.active = false;
            return 0;
        }

        if (circleOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
            const dealt = player.takeDamage(this.damage);
            // Always consume the bolt on a player overlap (even during
            // i-frames) so it can't sit on top of the player ticking.
            this.active = false;
            return dealt;
        }
        return 0;
    }

    draw(ctx) {
        // Fading ghost trail behind the bolt — older samples fade + shrink.
        const n = this.trailX.length;
        if (n > 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = this.trailColor;
            for (let i = 0; i < n; i++) {
                const f = (i + 1) / n;
                ctx.globalAlpha = 0.30 * f;
                ctx.beginPath();
                ctx.arc(this.trailX[i], this.trailY[i], this.radius * (0.4 + 0.6 * f), 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }
        const s = this.radius * 3.2;
        ctx.drawImage(this.sprite, this.x - s / 2, this.y - s / 2, s, s);
        // Bright core so it reads as a hostile bolt, not ambient glow.
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 0.42, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = '#c97bff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
