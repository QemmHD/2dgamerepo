import { GEM, MAGNET } from '../config.js';
import { TWO_PI } from '../core/MathUtils.js';
import { getXPGemSprite } from '../assets/ProceduralSprites.js';

const BOUNCE_DURATION = 0.4;

export class XPGem {
    constructor(x, y, tier = 'small') {
        const def = GEM[tier] ?? GEM.small;
        this.x = x;
        this.y = y;
        this.tier = tier;
        this.xp = def.xp;
        this.radius = def.radius;
        this.sprite = getXPGemSprite(tier);
        this.active = true;

        const angle = Math.random() * TWO_PI;
        const speed = def.bounceSpeed * (0.7 + Math.random() * 0.6);
        this.bounceVX = Math.cos(angle) * speed;
        this.bounceVY = Math.sin(angle) * speed;
        this.bounceTimer = 0;

        this.age = 0;
        this.magnetizing = false;
        this.magnetSpeed = 0;
    }

    update(dt, player) {
        this.age += dt;

        if (this.bounceTimer < BOUNCE_DURATION) {
            const t = this.bounceTimer / BOUNCE_DURATION;
            const fade = 1 - t;
            this.x += this.bounceVX * dt * fade;
            this.y += this.bounceVY * dt * fade;
            this.bounceTimer += dt;
        }

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (!this.magnetizing && dist < player.pickupRange) {
            this.magnetizing = true;
            this.magnetSpeed = MAGNET.initialSpeed;
        }

        if (this.magnetizing && dist > 0) {
            this.magnetSpeed = Math.min(
                this.magnetSpeed + MAGNET.acceleration * dt,
                MAGNET.maxSpeed
            );
            this.x += (dx / dist) * this.magnetSpeed * dt;
            this.y += (dy / dist) * this.magnetSpeed * dt;
        }

        const ndx = player.x - this.x;
        const ndy = player.y - this.y;
        const collectR = player.radius + this.radius;
        if (ndx * ndx + ndy * ndy <= collectR * collectR) {
            this.active = false;
            return this.xp;
        }
        return 0;
    }

    draw(ctx) {
        const bobY = Math.sin(this.age * 4) * 1.5;
        const popScale = this.bounceTimer < BOUNCE_DURATION
            ? 0.6 + (this.bounceTimer / BOUNCE_DURATION) * 0.4
            : 1;
        const w = this.sprite.width * popScale;
        const h = this.sprite.height * popScale;
        ctx.drawImage(this.sprite, this.x - w / 2, this.y - h / 2 + bobY, w, h);
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = this.magnetizing ? '#ffd166' : '#4ec1ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
