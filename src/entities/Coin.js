// Run-coin pickup. Behaves like an XPGem (bounce out → idle bob → magnet
// once the player is within pickupRange → collected on touch) but
// awards run coins instead of XP. Game banks player.coins → total on
// game over.

import { MAGNET, SPRITE_SS } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap } from '../core/MathUtils.js';
import { getCoinFrames } from '../assets/ProceduralSprites.js';

const BOUNCE_DURATION = 0.4;
const SPIN_HZ = 5;

export class Coin {
    constructor(x, y, value = 1) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.radius = 14;
        this.frames = getCoinFrames();
        // Stagger spin phase per coin so bursts don't look in lockstep.
        this.spinOffset = Math.random();
        this.active = true;

        const angle = Math.random() * TWO_PI;
        const speed = 180 + Math.random() * 60;
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

        if (circleOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
            this.active = false;
            return this.value;
        }
        return 0;
    }

    draw(ctx) {
        const bobY = Math.sin(this.age * 4) * 1.5;
        const popScale = this.bounceTimer < BOUNCE_DURATION
            ? 0.6 + (this.bounceTimer / BOUNCE_DURATION) * 0.4
            : 1;
        const idx = Math.floor((this.age + this.spinOffset) * SPIN_HZ) % this.frames.length;
        const sprite = this.frames[idx];
        // Source is supersampled (SPRITE_SS×); draw at logical world size.
        const w = (sprite.width / SPRITE_SS) * popScale;
        const h = (sprite.height / SPRITE_SS) * popScale;
        ctx.drawImage(sprite, this.x - w / 2, this.y - h / 2 + bobY, w, h);
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = this.magnetizing ? '#ffd166' : '#ffe89a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
