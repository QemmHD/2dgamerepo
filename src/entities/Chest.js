// Treasure chest. Sits in the world until the player walks onto it; on
// pickup it flips `active = false` and Game opens the chest-reward overlay.
// No magnet, no timeout — chests wait politely for the player.

import { CHEST } from '../config/GameConfig.js';
import { TWO_PI, circleOverlap } from '../core/MathUtils.js';
import { getChestSprite } from '../assets/ProceduralSprites.js';

export class Chest {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = CHEST.pickupRadius;
        this.active = true;
        this.sprite = getChestSprite();
        this.bobTimer = Math.random() * TWO_PI;
    }

    update(dt, player) {
        this.bobTimer += dt;
        if (circleOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
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
        ctx.drawImage(
            this.sprite,
            this.x - this.sprite.width / 2,
            this.y + bobY - this.sprite.height / 2
        );
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
