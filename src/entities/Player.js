import {
    PLAYER,
    SPRITE_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
} from '../config.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { getMonkeySprite } from '../assets/ProceduralSprites.js';

export class Player {
    constructor(x = PLAYER.startX, y = PLAYER.startY) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = PLAYER.radius;
        this.speed = PLAYER.speed;
        this.facingX = 1;
        this.sprite = getMonkeySprite();
        this.spriteHalf = SPRITE_SIZE / 2;
        this.bobTimer = 0;
        this.moving = false;
    }

    update(dt, input) {
        const move = input.getMovement();
        this.vx = move.x * this.speed;
        this.vy = move.y * this.speed;
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const halfW = WORLD_WIDTH / 2;
        const halfH = WORLD_HEIGHT / 2;
        this.x = clamp(this.x, -halfW + this.radius, halfW - this.radius);
        this.y = clamp(this.y, -halfH + this.radius, halfH - this.radius);

        const speedSq = this.vx * this.vx + this.vy * this.vy;
        this.moving = speedSq > 1;
        if (this.moving) this.bobTimer += dt;
        if (move.x !== 0) this.facingX = move.x < 0 ? -1 : 1;
    }

    draw(ctx) {
        const bobY = this.moving ? Math.sin(this.bobTimer * 12) * 3 : 0;
        ctx.save();
        ctx.translate(this.x, this.y + bobY);
        if (this.facingX < 0) ctx.scale(-1, 1);
        ctx.drawImage(this.sprite, -this.spriteHalf, -this.spriteHalf);
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 71, 87, 0.25)';
        ctx.setLineDash([4, 6]);
        ctx.strokeRect(
            this.x - this.spriteHalf,
            this.y - this.spriteHalf,
            this.spriteHalf * 2,
            this.spriteHalf * 2
        );
        ctx.setLineDash([]);
        ctx.restore();
    }
}
