import {
    PLAYER,
    SPRITE_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    UI,
    xpRequired,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { getMonkeyFrames } from '../assets/ProceduralSprites.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

export class Player {
    constructor(x = PLAYER.startX, y = PLAYER.startY) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = PLAYER.radius;
        this.speed = PLAYER.speed;
        this.facingX = 1;
        // Frames: [0]=idle, [1..3]=walk cycle. draw() picks one per frame
        // based on movement state — all four are cached up-front.
        this.frames = getMonkeyFrames();
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

        // Passive-driven global modifiers. Weapons read these every frame so
        // a passive level-up takes effect on the next tick. Defaults are
        // neutral identity values; restart rebuilds Player so these reset.
        this.damageMul = 1;
        this.cooldownMul = 1;

        // Defensive passives: damage taken multiplier (Thick Hide), out-of-
        // combat regen (Second Wind), and contact-damage reflect (Thorns).
        this.damageTakenMul = 1;
        this.regenPerSecond = 0;
        this.thornsReflect = 0;

        // Elemental passive modifiers (read by weapons / the burn DoT pass).
        // Neutral defaults so apply() can never produce NaN before a passive
        // bumps them. Pyromancer's Tinder scales burn; Frostbite Core deepens
        // chill and adds freeze-proc chance to frost weapons.
        this.burnDamageMul = 1;
        this.chillStrength = 0;
        this.freezeChanceBonus = 0;

        // Forward-looking stash for the chest stage.
        this.chestLuck = 0;
        this.coins = 0;
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
        // Thick Hide reduces all incoming damage uniformly (contact, enemy
        // bolts, boss) since every source routes through here.
        const incoming = amount * (this.damageTakenMul ?? 1);
        const dealt = Math.min(incoming, this.hp);
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
        // 3 walk frames cycled at ~6 Hz, idle when standing still.
        const walkIdx = this.moving
            ? 1 + (Math.floor(this.bobTimer * 6) % 3)
            : 0;
        const sprite = this.frames[walkIdx] ?? this.frames[0];
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y + bobY);
        if (this.facingX < 0) ctx.scale(-1, 1);
        ctx.drawImage(sprite, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        // Hit flash via an additive re-draw of the sprite (no ctx.filter —
        // see Enemy.draw for the iOS rationale).
        if (this.hitFlashTimer > 0) {
            const t = this.hitFlashTimer / PLAYER.hitFlashDuration;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = alpha * Math.min(1, t);
            ctx.drawImage(sprite, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        ctx.restore();
    }

    drawHpBar(ctx) {
        if (this.hp >= this.maxHp) return;
        const { width, height, marginAboveSpriteHalf } = UI.playerHealthBar;
        const ratio = clamp(this.hp / this.maxHp, 0, 1);
        drawWorldHealthBar(
            ctx,
            this.x,
            this.y - this.spriteHalf - marginAboveSpriteHalf,
            width,
            height,
            ratio,
            healthColor(ratio)
        );
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
