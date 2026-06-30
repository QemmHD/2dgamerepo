// Rare health pickup. Behaves exactly like a Coin/XPGem (bounce out → idle bob
// → magnet once the player is within pickupRange → collected on touch) but
// heals the player instead of awarding XP or coins. Dropped on a kill at a low
// roll (HEALTH_DROP.chance), like the rare large XP gem — a small, welcome
// top-up you can't rely on.

import { MAGNET, SPRITE_SS, HEALTH_DROP } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap } from '../core/MathUtils.js';
import { getHealthOrbFrames } from '../assets/ProceduralSprites.js';

const BOUNCE_DURATION = 0.4;
const PULSE_HZ = 2;

export class HealthOrb {
    constructor(x, y, heal = HEALTH_DROP.heal) {
        this.x = x;
        this.y = y;
        this.heal = heal;
        this.radius = 16;
        this.frames = getHealthOrbFrames();
        this.pulseOffset = Math.random();
        this.active = true;

        const angle = Math.random() * TWO_PI;
        const speed = 170 + Math.random() * 60;
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
            const fade = 1 - this.bounceTimer / BOUNCE_DURATION;
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
            this.magnetSpeed = Math.min(this.magnetSpeed + MAGNET.acceleration * dt, MAGNET.maxSpeed);
            this.x += (dx / dist) * this.magnetSpeed * dt;
            this.y += (dy / dist) * this.magnetSpeed * dt;
        }

        if (circleOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
            this.active = false;
            return this.heal;
        }
        return 0;
    }

    draw(ctx) {
        const bobY = Math.sin(this.age * 4) * 1.6;
        const popScale = this.bounceTimer < BOUNCE_DURATION
            ? 0.6 + (this.bounceTimer / BOUNCE_DURATION) * 0.4
            : 1;
        const idx = Math.floor((this.age + this.pulseOffset) * PULSE_HZ) % this.frames.length;
        const sprite = this.frames[idx];
        // Soft green life-glow that breathes.
        const pulse = 0.5 + 0.5 * Math.sin((this.age + this.pulseOffset) * 4);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.14 + 0.2 * pulse;
        ctx.fillStyle = '#6bff8a';
        ctx.beginPath();
        ctx.arc(this.x, this.y + bobY, this.radius * 1.6, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
        const w = (sprite.width / SPRITE_SS) * popScale;
        const h = (sprite.height / SPRITE_SS) * popScale;
        ctx.drawImage(sprite, this.x - w / 2, this.y - h / 2 + bobY, w, h);
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = this.magnetizing ? '#6bff8a' : '#aef0c0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
