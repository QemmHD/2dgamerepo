// Enemy bolt (fired by Spitters). Flies straight, expires on a timer or
// at the world edge, and damages the player on contact — respecting the
// player's i-frames exactly like contact damage so it can't chunk through
// invulnerability frames. Visual is a cached colored glow.

import { ENEMY_PROJECTILE, WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap } from '../core/MathUtils.js';
import { getGlowSprite } from '../assets/ProceduralSprites.js';

const WORLD_MARGIN = 120;

export class EnemyProjectile {
    constructor(x, y, vx, vy, damage) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.radius = ENEMY_PROJECTILE.radius;
        this.lifetime = ENEMY_PROJECTILE.lifetime;
        this.age = 0;
        this.active = true;
        this.angle = Math.atan2(vy, vx);
        this.sprite = getGlowSprite(ENEMY_PROJECTILE.color);
    }

    // Returns the damage dealt to the player this frame (0 if none), so the
    // caller can drive feedback. Deactivates on hit, expiry, or leaving the
    // world.
    update(dt, player) {
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
