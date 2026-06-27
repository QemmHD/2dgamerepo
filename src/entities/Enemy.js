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
    getSlimeFrames,
    getBatFrames,
    getBruteFrames,
    getCrawlerFrames,
    getVinebackGoliathFrames,
    getStormwingAlphaFrames,
} from '../assets/ProceduralSprites.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

// Frame getters all return a pre-cached array of canvases. Per-type
// animation speed (Hz) — bats flap quickly, brutes breathe slowly.
const FRAMES_BY_TYPE = {
    slime:           { get: getSlimeFrames,           hz: 5 },
    bat:             { get: getBatFrames,             hz: 10 },
    brute:           { get: getBruteFrames,           hz: 1.4 },
    crawler:         { get: getCrawlerFrames,         hz: 9 },
    vinebackGoliath: { get: getVinebackGoliathFrames, hz: 1.6 },
    stormwingAlpha:  { get: getStormwingAlphaFrames,  hz: 7 },
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
        const frameSpec = FRAMES_BY_TYPE[type];
        if (!frameSpec) throw new Error(`No sprite for enemy type: ${type}`);

        const isBoss = !!def.boss;
        // Elite + boss don't stack — bosses already have their own scale and
        // are guaranteed to drop a chest. If a spawn somehow asks for elite
        // on a boss type, ignore the elite flag.
        const elite = !!opts.elite && !isBoss;
        const waveHpMul = opts.healthMul ?? 1;
        const waveSpdMul = opts.speedMul ?? 1;

        const hpMul = elite ? ELITE.hpMul : 1;
        const eliteSizeMul = elite ? ELITE.sizeMul : 1;
        const spdMul = elite ? ELITE.speedMul : 1;
        const dmgMul = elite ? ELITE.contactDamageMul : 1;
        const xpMul = elite ? ELITE.xpMul : 1;
        const baseScale = def.visualScale ?? 1;

        this.type = type;
        this.name = def.bossName ?? type;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.maxHp = def.hp * waveHpMul * hpMul;
        this.hp = this.maxHp;
        this.speed = def.speed * waveSpdMul * spdMul;
        // Elite grows the hitbox to match its bigger visual. Boss radius
        // already comes from config at the right size, so eliteSizeMul is 1
        // for bosses (elite is force-off for boss types above).
        this.radius = def.radius * eliteSizeMul;
        this.contactDamage = def.contactDamage * dmgMul;
        this.xpValue = def.xpValue * xpMul;

        this.elite = elite;
        this.boss = isBoss;
        this.canDropChest = elite || isBoss;
        this.visualScale = baseScale * eliteSizeMul;

        this.frames = frameSpec.get();
        this.frameHz = frameSpec.hz;
        // Random phase so adjacent enemies don't animate in lockstep —
        // gives the swarm a more natural, varied motion feel.
        this.animOffset = Math.random() * 1000;
        this.animTimer = this.animOffset;
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
        this.animTimer += dt;
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

        const idx = Math.floor(this.animTimer * this.frameHz) % this.frames.length;
        const frame = this.frames[idx];
        ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf);

        // Elite shimmer + hit flash use additive 'lighter' re-draws of the
        // sprite itself rather than ctx.filter. ctx.filter forces an
        // offscreen pass per drawImage on iOS WebKit (a real frame-rate
        // hazard with many flashing/elite enemies); re-drawing the cached
        // frame in 'lighter' mode brightens exactly the sprite's own pixels
        // for a fraction of the cost. globalAlpha/compositeOp reset on
        // restore().
        if (this.elite) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.18;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf);
        }
        if (this.hitFlashTimer > 0) {
            const t = this.hitFlashTimer / HIT_FLASH_DURATION;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, 0.9 * t);
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf);
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf);
        }
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
