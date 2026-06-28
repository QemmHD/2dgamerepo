import {
    ENEMY,
    ELITE,
    ELITE_AFFIXES,
    AFFIX,
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
    getSpitterFrames,
    getChargerFrames,
} from '../assets/ProceduralSprites.js';
import { EnemyProjectile } from './EnemyProjectile.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

// Frame getters all return a pre-cached array of canvases. Per-type
// animation speed (Hz) — bats flap quickly, brutes breathe slowly.
const FRAMES_BY_TYPE = {
    slime:           { get: getSlimeFrames,           hz: 5 },
    bat:             { get: getBatFrames,             hz: 10 },
    brute:           { get: getBruteFrames,           hz: 1.4 },
    crawler:         { get: getCrawlerFrames,         hz: 9 },
    spitter:         { get: getSpitterFrames,         hz: 4 },
    charger:         { get: getChargerFrames,         hz: 3 },
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

        // Behavior (ranged Spitter / dashing Charger). Plain chasers leave
        // this null and run the default chase. def is kept for behavior
        // params. Attack timers start randomized so a wave doesn't fire in
        // unison.
        this.def = def;
        this.behavior = def.behavior ?? null;
        const baseInterval = def.fireInterval ?? def.chargeInterval ?? 2;
        this.attackTimer = this.behavior ? Math.random() * baseInterval : 0;
        this.windupTimer = 0;
        this.dashTimer = 0;
        this.dashDirX = 0;
        this.dashDirY = 0;
        // Spitter bolt damage carries the elite contact-damage scaling.
        this.projectileDamage = (def.projectileDamage ?? 0) * dmgMul;

        // Elite affix (rolled only on elites). Swift bumps speed; volatile /
        // splitting are handled by Game at the death site.
        this.affix = null;
        this.affixDef = null;
        if (elite) {
            this.affix = ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)];
            this.affixDef = AFFIX[this.affix] ?? null;
            if (this.affix === 'swift' && this.affixDef) this.speed *= this.affixDef.speedMul;
        }

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

        // Weapon-identity status effects (all neutral = behaves as before).
        // slow: chase-speed debuff from Orbiting Blade. shred: armor-shred
        // stacks READ ONLY by Holy Pulse (kept local to that weapon).
        this.slowTimer = 0;
        this.slowMul = 1;
        this.shredTimer = 0;
        this.shredStacks = 0;
    }

    // Orbiting Blade stamp. Deepest slow wins; longest duration refreshes
    // (never additive, so repeated hits can't compound into a freeze).
    // Bosses are floored so they're nudged, never trivialized.
    applySlow(mul, dur) {
        const m = this.boss ? Math.max(mul, 0.85) : mul;
        if (this.slowTimer <= 0 || m < this.slowMul) this.slowMul = m;
        if (dur > this.slowTimer) this.slowTimer = dur;
    }

    // Holy Pulse stamp. Increments one stack up to a per-level cap and
    // refreshes the decay timer. The per-stack % lives in the weapon cfg
    // and is read at damage time, so shred never leaks to other weapons.
    applyShred(maxStacks, dur) {
        if (this.shredStacks < maxStacks) this.shredStacks += 1;
        this.shredTimer = dur;
    }

    update(dt, player, enemyProjectiles) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy) || 0.0001;
        const nx = dx / len;
        const ny = dy / len;

        // Slow applies transiently via a local scalar — never mutate
        // this.speed (so wave/elite scaling stays intact and slow reverses).
        const slowK = this.slowTimer > 0 ? this.slowMul : 1;
        let moveX = nx;        // default plain chase
        let moveY = ny;
        let spd = this.speed * slowK;

        if (this.behavior === 'spitter') {
            // Hold a firing gap: retreat if too close, approach if too far.
            const kd = this.def.keepDistance;
            if (len < kd - 40) { moveX = -nx; moveY = -ny; }
            else if (len > kd + 80) { moveX = nx; moveY = ny; }
            else { moveX = 0; moveY = 0; }

            this.attackTimer -= dt;
            if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // brace + telegraph while charging a shot
                if (this.windupTimer <= 0 && enemyProjectiles) {
                    const ps = this.def.projectileSpeed;
                    enemyProjectiles.push(
                        new EnemyProjectile(this.x, this.y, nx * ps, ny * ps, this.projectileDamage)
                    );
                }
            } else if (this.attackTimer <= 0 && len <= this.def.fireRange) {
                this.windupTimer = this.def.windup;
                this.attackTimer = this.def.fireInterval;
            }
        } else if (this.behavior === 'charger') {
            this.attackTimer -= dt;
            if (this.dashTimer > 0) {
                // Mid-dash: travel along the locked direction at dash speed.
                this.dashTimer -= dt;
                moveX = this.dashDirX; moveY = this.dashDirY;
                spd = this.def.dashSpeed * slowK;
            } else if (this.windupTimer > 0) {
                this.windupTimer -= dt;
                moveX = 0; moveY = 0; // brace before the lunge
                if (this.windupTimer <= 0) {
                    this.dashDirX = nx;  // lock aim at dash start, then commit
                    this.dashDirY = ny;
                    this.dashTimer = this.def.dashDuration;
                }
            } else if (this.attackTimer <= 0 && len <= this.def.triggerRange) {
                this.windupTimer = this.def.windup;
                this.attackTimer = this.def.chargeInterval;
            }
        }

        if (moveX !== 0 || moveY !== 0) {
            this.vx = moveX * spd;
            this.vy = moveY * spd;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        } else {
            this.vx = 0;
            this.vy = 0;
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
        if (this.slowTimer > 0) {
            this.slowTimer -= dt;
            if (this.slowTimer <= 0) { this.slowTimer = 0; this.slowMul = 1; }
        }
        if (this.shredTimer > 0) {
            this.shredTimer -= dt;
            if (this.shredTimer <= 0) { this.shredTimer = 0; this.shredStacks = 0; }
        }
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
            // Affix tints the halo so the elite's flavor reads at a glance;
            // plain elites keep the classic gold.
            if (this.affixDef) {
                grad.addColorStop(0, hexToHalo(this.affixDef.tint, 0.55));
                grad.addColorStop(1, hexToHalo(this.affixDef.tint, 0));
            } else {
                grad.addColorStop(0, 'rgba(255, 215, 90, 0.5)');
                grad.addColorStop(1, 'rgba(255, 200, 50, 0)');
            }
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, haloR, 0, TWO_PI);
            ctx.fill();
        }

        // Slow tell: a thin cool-blue ring (drawn pre-scale in world space,
        // like the elite halo). Timer-gated, so un-slowed enemies pay nothing.
        if (this.slowTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, this.spriteHalf * this.visualScale * 0.7, 0, TWO_PI);
            ctx.stroke();
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

// #rrggbb → rgba() at the given alpha (for the affix-tinted halo).
function hexToHalo(hex, a) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
