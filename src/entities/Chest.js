// Treasure chest. Sits in the world until the player walks onto it; on
// pickup it flips `active = false` and Game opens the chest-reward overlay.
// No magnet, no timeout — chests wait politely for the player.

import { CHEST, SPRITE_SS } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap } from '../core/MathUtils.js';
import { getChestSprite } from '../assets/ProceduralSprites.js';

export class Chest {
    constructor(x, y, options = {}) {
        this.x = x;
        this.y = y;
        this.radius = CHEST.pickupRadius;
        this.active = true;
        this.pickupDelay = Math.max(0, Number(options.pickupDelay) || 0);
        this.requiresExitBeforePickup = options.requiresExitBeforePickup === true;
        this.sprite = getChestSprite();
        this.bobTimer = Math.random() * TWO_PI;
    }

    update(dt, player) {
        this.bobTimer += dt;
        this.pickupDelay = Math.max(0, this.pickupDelay - Math.max(0, dt));
        const overlapping = circleOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius);
        if (this.requiresExitBeforePickup) {
            if (overlapping) return false;
            this.requiresExitBeforePickup = false;
        }
        if (this.pickupDelay > 0) return false;
        if (overlapping) {
            this.active = false;
            return true;
        }
        return false;
    }

    draw(ctx) {
        const bobY = Math.sin(this.bobTimer * 2.5) * 4;
        ctx.save();
        const grad = ctx.createRadialGradient(
            this.x, this.y + bobY, 10,
            this.x, this.y + bobY, 70
        );
        grad.addColorStop(0, 'rgba(255, 209, 102, 0.40)');
        grad.addColorStop(1, 'rgba(255, 209, 102, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y + bobY, 70, 0, TWO_PI);
        ctx.fill();
        // Source is supersampled (SPRITE_SS×); draw at logical world size.
        const w = this.sprite.width / SPRITE_SS;
        const h = this.sprite.height / SPRITE_SS;
        ctx.drawImage(this.sprite, this.x - w / 2, this.y + bobY - h / 2, w, h);
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }
}
