import {
    ENEMY,
    ELITE,
    SPRITE_SIZE,
    HIT_FLASH_DURATION,
    KNOCKBACK,
    UI,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import {
    getSlimeSprite,
    getBatSprite,
    getBruteSprite,
    getCrawlerSprite,
} from '../assets/ProceduralSprites.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

const SPRITE_GETTERS = {
    slime: getSlimeSprite,
    bat: getBatSprite,
    brute: getBruteSprite,
    crawler: getCrawlerSprite,
};

// Construction-time options:
//   healthMul   scales maxHp/hp from the wave director's current state
//   speedMul    scales chase speed from the wave director
//   elite       true → applies ELITE multipliers (hp/size/damage/xp) and
//               flips on a gold halo + brighter tint. canDropChest is set
//               to true so the future chest stage can hook on.
export class Enemy {
    constructor(type, x, y, opts = {}) {
        const def = ENEMY[type];
        if (!def) throw new Error(`Unknown enemy type: ${type}`);
        const getSprite = SPRITE_GETTERS[type];
        if (!getSprite) throw new Error(`No sprite for enemy type: ${type}`);

        const elite = !!opts.elite;
        const waveHpMul = opts.healthMul ?? 1;
        const waveSpdMul = opts.speedMul ?? 1;

        const hpMul = elite ? ELITE.hpMul : 1;
        const sizeMul = elite ? ELITE.sizeMul : 1;
        const spdMul = elite ? ELITE.speedMul : 1;
        const dmgMul = elite ? ELITE.contactDamageMul : 1;
        const xpMul = elite ? ELITE.xpMul : 1;

        this.type = type;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.maxHp = def.hp * waveHpMul * hpMul;
        this.hp = this.maxHp;
        this.speed = def.speed * waveSpdMul * spdMul;
        this.radius = def.radius * sizeMul;
        this.contactDamage = def.contactDamage * dmgMul;
        this.xpValue = def.xpValue * xpMul;

        this.elite = elite;
        this.canDropChest = elite;
        this.visualScale = sizeMul;

        this.sprite = getSprite();
        this.spriteHalf = SPRITE_SIZE / 2;
        this.active = true;
        this.hitFlashTimer = 0;

        this.knockbackVx = 0;
        this.knockbackVy = 0;
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

        // Elite glow halo sits behind the sprite at world scale (before the
        // visualScale transform) so it's a roomy ring, not a tight outline.
        if (this.elite) {
            const haloR = this.spriteHalf * this.visualScale * 0.75;
            const grad = ctx.createRadialGradient(0, 0, haloR * 0.25, 0, 0, haloR);
            grad.addColorStop(0, 'rgba(255, 215, 90, 0.5)');
            grad.addColorStop(1, 'rgba(255, 200, 50, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, haloR, 0, TWO_PI);
            ctx.fill();
        }

        if (this.visualScale !== 1) ctx.scale(this.visualScale, this.visualScale);

        if (typeof ctx.filter === 'string') {
            const parts = [];
            if (this.hitFlashTimer > 0) {
                const t = this.hitFlashTimer / HIT_FLASH_DURATION;
                parts.push(`brightness(${1 + t * 1.6})`, 'saturate(0.4)');
            }
            if (this.elite) {
                parts.push('brightness(1.18)', 'saturate(1.35)', 'contrast(1.05)');
            }
            if (parts.length > 0) ctx.filter = parts.join(' ');
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
        ctx.strokeStyle = this.elite ? '#ffd166' : '#ff4757';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
    }
}
