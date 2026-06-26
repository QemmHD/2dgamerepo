import { WEAPON, WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';
import { getProjectileSprite } from '../assets/ProceduralSprites.js';

const WORLD_MARGIN = 200;

export class Projectile {
    constructor(x, y, vx, vy, opts = {}) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = opts.damage ?? WEAPON.bolt.damage;
        this.lifetime = opts.lifetime ?? WEAPON.bolt.projectileLifetime;
        this.radius = opts.radius ?? WEAPON.bolt.projectileRadius;
        this.age = 0;
        this.active = true;
        this.angle = Math.atan2(vy, vx);
        this.sprite = getProjectileSprite();
    }

    update(dt) {
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
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.drawImage(this.sprite, -this.sprite.width / 2, -this.sprite.height / 2);
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
