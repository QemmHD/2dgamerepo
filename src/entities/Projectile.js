import { WEAPON, WORLD_WIDTH, WORLD_HEIGHT, SPRITE_SS } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import { getProjectileSprite } from '../assets/ProceduralSprites.js';

const WORLD_MARGIN = 200;

// Trail glow tint by elemental payload (fire/frost/shock); default ember.
const PROJECTILE_TRAIL_COLOR = {
    fire: '#ff7a3c',
    frost: '#7fd0ff',
    ice: '#7fd0ff',
    shock: '#ffe14a',
    default: '#ffd1a0',
};

export class Projectile {
    constructor(x, y, vx, vy, opts = {}) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = opts.damage ?? WEAPON.bolt.damage;
        this.lifetime = opts.lifetime ?? WEAPON.bolt.projectileLifetime;
        this.radius = opts.radius ?? WEAPON.bolt.projectileRadius;
        // pierce = additional enemies this projectile can hit before dying.
        // 0 means it dies on first hit (original Arcane Bolt L1 behavior).
        this.pierce = opts.pierce ?? 0;
        // ricochet = times this bolt can redirect to a fresh target after a
        // KILL (independent of pierce). ricochetRange caps the redirect hop.
        this.ricochet = opts.ricochet ?? 0;
        this.ricochetRange = opts.ricochetRange ?? 0;
        // Elemental payload. A FIRE bolt carries a burn that CollisionSystem
        // stamps on every enemy it touches — so it re-applies for free on each
        // pierce pass and on every ricochet hop (same object, same payload).
        this.element = opts.element ?? null;
        this.burnDps = opts.burnDps ?? 0;
        this.burnDuration = opts.burnDuration ?? 0;
        // Tracks enemies already damaged so a single piercing projectile
        // doesn't double-hit the same target while passing through.
        this.hitEnemies = new Set();
        this.age = 0;
        this.active = true;
        this.angle = Math.atan2(vy, vx);
        // Weapons may supply a tinted sprite (e.g. the ember bolt); default is
        // the arcane bolt art.
        this.sprite = opts.sprite ?? getProjectileSprite();
        // Motion trail: a short ring of recent positions, redrawn as fading
        // additive ghosts so a bolt reads as a streak. Element tints the glow.
        this.trailX = [];
        this.trailY = [];
        this._trailAccum = 0;
        this.trailColor = opts.trailColor ?? PROJECTILE_TRAIL_COLOR[this.element] ?? PROJECTILE_TRAIL_COLOR.default;
    }

    update(dt) {
        // Sample a sparse trail (every ~16ms, capped) before moving so ghosts
        // sit behind the head.
        this._trailAccum += dt;
        if (this._trailAccum >= 0.016) {
            this._trailAccum = 0;
            this.trailX.push(this.x);
            this.trailY.push(this.y);
            if (this.trailX.length > 6) { this.trailX.shift(); this.trailY.shift(); }
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.age += dt;
        if (this.age >= this.lifetime) {
            this.active = false;
            return;
        }
        const halfW = WORLD_WIDTH / 2 + WORLD_MARGIN;
        const halfH = WORLD_HEIGHT / 2 + WORLD_MARGIN;
        if (this.x < -halfW || this.x > halfW || this.y < -halfH || this.y > halfH) {
            this.active = false;
        }
    }

    draw(ctx) {
        // Additive ghost trail behind the head — older samples fade + shrink.
        const n = this.trailX.length;
        if (n > 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = this.trailColor;
            for (let i = 0; i < n; i++) {
                const f = (i + 1) / n;           // 0 (oldest) → 1 (newest)
                ctx.globalAlpha = 0.32 * f;
                ctx.beginPath();
                ctx.arc(this.trailX[i], this.trailY[i], this.radius * (0.4 + 0.6 * f), 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Source is supersampled (SPRITE_SS×); draw at logical world size.
        const w = this.sprite.width / SPRITE_SS;
        const h = this.sprite.height / SPRITE_SS;
        ctx.drawImage(this.sprite, -w / 2, -h / 2, w, h);
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
