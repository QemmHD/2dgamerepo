import {
    PLAYER,
    SPRITE_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    xpRequired,
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

        this.level = 1;
        this.xp = 0;
        this.xpToNext = xpRequired(1);
        this.pickupRange = PLAYER.pickupRange;
        this.xpMultiplier = 1;

        this.maxHp = PLAYER.maxHp;
        this.hp = PLAYER.maxHp;
        this.invincibleTimer = 0;
        this.hitFlashTimer = 0;
    }

    gainXP(amount) {
        if (amount <= 0) return 0;
        this.xp += amount * this.xpMultiplier;
        let levels = 0;
        while (this.xp >= this.xpToNext) {
            this.xp -= this.xpToNext;
            this.level += 1;
            levels += 1;
            this.xpToNext = xpRequired(this.level);
        }
        return levels;
    }

    takeDamage(amount) {
        if (this.invincibleTimer > 0 || this.hp <= 0) return 0;
        const dealt = Math.min(amount, this.hp);
        this.hp -= dealt;
        if (this.hp < 0) this.hp = 0;
        this.invincibleTimer = PLAYER.invincibilityDuration;
        this.hitFlashTimer = PLAYER.hitFlashDuration;
        return dealt;
    }

    isDead() {
        return this.hp <= 0;
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

        if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
        if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    }

    draw(ctx) {
        let alpha = 1;
        if (this.invincibleTimer > 0) {
            const pulse = (Math.sin(this.invincibleTimer * 26) + 1) / 2;
            alpha = 0.45 + pulse * 0.5;
        }

        const bobY = this.moving ? Math.sin(this.bobTimer * 12) * 3 : 0;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y + bobY);
        if (this.facingX < 0) ctx.scale(-1, 1);
        if (this.hitFlashTimer > 0 && typeof ctx.filter === 'string') {
            const t = this.hitFlashTimer / PLAYER.hitFlashDuration;
            ctx.filter = `brightness(${1 + t * 1.6})`;
        }
        ctx.drawImage(this.sprite, -this.spriteHalf, -this.spriteHalf);
        ctx.restore();
    }

    drawHpBar(ctx) {
        if (this.hp >= this.maxHp) return;
        const barW = 80;
        const barH = 8;
        const x = this.x - barW / 2;
        const y = this.y - this.spriteHalf - 16;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);
        ctx.fillStyle = '#5a1c1c';
        ctx.fillRect(x, y, barW, barH);
        const pct = clamp(this.hp / this.maxHp, 0, 1);
        ctx.fillStyle = pct < 0.3 ? '#ff4757' : pct < 0.6 ? '#ffa53b' : '#5fe87a';
        ctx.fillRect(x, y, barW * pct, barH);
        ctx.restore();
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(78, 193, 255, 0.45)';
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.pickupRange, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);

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
