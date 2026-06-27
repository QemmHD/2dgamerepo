import {
    ENEMY,
    SPRITE_SIZE,
    HIT_FLASH_DURATION,
    KNOCKBACK,
    UI,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { getSlimeSprite, getBatSprite } from '../assets/ProceduralSprites.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

const SPRITE_GETTERS = {
    slime: getSlimeSprite,
    bat: getBatSprite,
};

export class Enemy {
    constructor(type, x, y) {
        const def = ENEMY[type];
        if (!def) throw new Error(`Unknown enemy type: ${type}`);
        const getSprite = SPRITE_GETTERS[type];
        if (!getSprite) throw new Error(`No sprite for enemy type: ${type}`);

        this.type = type;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.maxHp = def.hp;
        this.hp = def.hp;
        this.speed = def.speed;
        this.radius = def.radius;
        this.contactDamage = def.contactDamage;
        this.xpValue = def.xpValue;

        this.sprite = getSprite();
        this.spriteHalf = SPRITE_SIZE / 2;
        this.active = true;
        this.hitFlashTimer = 0;

        this.knockbackVx = 0;
        this.knockbackVy = 0;

        // Shared "this enemy was just damaged by a tick-style weapon (orbit
        // blade, etc.)" cooldown. Set inside the weapon's behavior; ticked
        // down here. Keeps stack-style weapons from melting the same target.
        this.weaponHitCooldown = 0;
    }

    update(dt, player) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
            this.vx = (dx / len) * this.speed;
            this.vy = (dy / len) * this.speed;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        }

        if (this.knockbackVx !== 0 || this.knockbackVy !== 0) {
            this.x += this.knockbackVx * dt;
            this.y += this.knockbackVy * dt;
            const decay = Math.exp(-dt / KNOCKBACK.timeConstant);
            this.knockbackVx *= decay;
            this.knockbackVy *= decay;
            if (Math.abs(this.knockbackVx) < 1) this.knockbackVx = 0;
            if (Math.abs(this.knockbackVy) < 1) this.knockbackVy = 0;
        }

        if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
        if (this.weaponHitCooldown > 0) this.weaponHitCooldown -= dt;
    }

    takeDamage(amount, knockbackVx = 0, knockbackVy = 0) {
        this.hp -= amount;
        this.hitFlashTimer = HIT_FLASH_DURATION;
        this.knockbackVx += knockbackVx;
        this.knockbackVy += knockbackVy;
        if (this.hp <= 0) {
            this.hp = 0;
            this.active = false;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.hitFlashTimer > 0 && typeof ctx.filter === 'string') {
            const t = this.hitFlashTimer / HIT_FLASH_DURATION;
            ctx.filter = `brightness(${1 + t * 1.6}) saturate(0.4)`;
        }
        ctx.drawImage(this.sprite, -this.spriteHalf, -this.spriteHalf);
        ctx.restore();
    }

    drawHpBar(ctx) {
        if (this.hp >= this.maxHp) return;
        const { width, height, marginAboveRadius } = UI.enemyHealthBar;
        const ratio = clamp(this.hp / this.maxHp, 0, 1);
        drawWorldHealthBar(
            ctx,
            this.x,
            this.y - this.radius - marginAboveRadius,
            width,
            height,
            ratio,
            healthColor(ratio)
        );
    }

    drawDebug(ctx) {
        ctx.save();
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
