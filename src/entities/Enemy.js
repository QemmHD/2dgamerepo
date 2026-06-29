import {
    ENEMY,
    ELITE,
    ELITE_AFFIXES,
    AFFIX,
    ELEMENT,
    BOSS,
    BOSS_ATTACK,
    SPRITE_SIZE,
    HIT_FLASH_DURATION,
    KNOCKBACK,
    UI,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { Easing } from '../core/Easing.js';
import {
    getSlimeFrames,
    getBatFrames,
    getBruteFrames,
    getCrawlerFrames,
    getVinebackGoliathFrames,
    getStormwingAlphaFrames,
    getGloomMawFrames,
    getSpitterFrames,
    getChargerFrames,
    getMiteFrames,
    getJuggernautFrames,
    getHealerFrames,
    getShielderFrames,
    getGlowSprite,
    getSoftShadowSprite,
} from '../assets/ProceduralSprites.js';
import { EnemyProjectile } from './EnemyProjectile.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

// Frame getters all return a pre-cached array of canvases. Per-type
// animation speed (Hz) — bats flap quickly, brutes breathe slowly.
// How long the spawn-in scale pop lasts (seconds). easeOutBack overshoot.
const SPAWN_POP_DUR = 0.28;

const FRAMES_BY_TYPE = {
    slime:           { get: getSlimeFrames,           hz: 5 },
    bat:             { get: getBatFrames,             hz: 10 },
    brute:           { get: getBruteFrames,           hz: 1.4 },
    crawler:         { get: getCrawlerFrames,         hz: 9 },
    spitter:         { get: getSpitterFrames,         hz: 4 },
    charger:         { get: getChargerFrames,         hz: 3 },
    mite:            { get: getMiteFrames,            hz: 14 },
    juggernaut:      { get: getJuggernautFrames,      hz: 1.2 },
    healer:          { get: getHealerFrames,          hz: 6 },
    shielder:        { get: getShielderFrames,        hz: 3 },
    vinebackGoliath: { get: getVinebackGoliathFrames, hz: 1.6 },
    stormwingAlpha:  { get: getStormwingAlphaFrames,  hz: 7 },
    gloomMaw:        { get: getGloomMawFrames,         hz: 4 },
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
        // Contact damage = elite bonus × the wave's time-based damage ramp
        // (1.0 until late game; scales after ~15 min so late enemies hurt).
        const dmgMul = (elite ? ELITE.contactDamageMul : 1) * (opts.contactDamageMul ?? 1);
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
        // Mild flat damage resistance (bosses only, set by Game at spawn based
        // on the run minute). 0 = takes full damage.
        this.resist = 0;
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
        this.affixColor = null;
        // damageTakenMul (reflective/armored) scales incoming damage in
        // takeDamage; regenPerSecond (regenerating) is ticked in update.
        this.damageTakenMul = 1;
        this.regenPerSecond = 0;
        if (elite) {
            this.affix = ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)];
            this.affixDef = AFFIX[this.affix] ?? null;
            if (this.affixDef) {
                this.affixColor = this.affixDef.tint;
                if (this.affixDef.speedMul) this.speed *= this.affixDef.speedMul;
                if (this.affixDef.contactMul) this.contactDamage *= this.affixDef.contactMul;
                if (this.affixDef.damageTakenMul) this.damageTakenMul = this.affixDef.damageTakenMul;
                if (this.affixDef.regenFrac) this.regenPerSecond = this.maxHp * this.affixDef.regenFrac;
            }
        }

        this.frames = frameSpec.get();
        this.frameHz = frameSpec.hz;
        // Random phase so adjacent enemies don't animate in lockstep —
        // gives the swarm a more natural, varied motion feel.
        this.animOffset = Math.random() * 1000;
        this.animTimer = this.animOffset;
        // Time since spawn — drives a brief scale-in "pop" so enemies don't
        // blink into existence (easeOutBack overshoot in draw()).
        this.spawnAge = 0;
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

        // Elemental statuses (all neutral = identical to pre-element
        // behavior). Kept as flat scalars on every enemy so the hidden class
        // stays monomorphic. FIRE burn is a DoT (damage applied by Game's
        // status pass, not here); FROST chill is a SEPARATE slow channel from
        // slowMul; freeze is a hard stop; SHOCK is a damage-amp read at hit.
        this.burnTimer = 0;
        this.burnDps = 0;
        this.burnTickAccum = 0;
        this.chillTimer = 0;
        this.chillMul = 1;
        this.freezeTimer = 0;
        this.shockTimer = 0;
        this.shockStacks = 0;

        // Shielder support: a transient damage-soak granted by a nearby Shielder
        // (Game refreshes shieldTimer while in range). shieldMul < 1 reduces
        // incoming damage. Healer support is applied directly to hp by Game.
        this.shieldTimer = 0;
        this.shieldMul = 1;
        // Support behaviors throttle their own pulses (heal cadence).
        this._healAccum = 0;

        // Apex-boss state machine (only bosses carry it). Phase-2 latches at
        // def.phase2HpFraction; attackTimers are seeded randomly so a fresh
        // boss doesn't fire instantly and two bosses desync.
        if (isBoss) {
            this.phase = 1;
            this.phase2Entered = false;
            this.enrageShouted = false;
            this.bossWindupTimer = 0;
            this.activeAttack = null;
            this.attackTimers = {};
            this._bossOut = null;
            // Attack-cadence multiplier (Game lowers it at HP thresholds so a
            // wounded boss attacks faster) + one-shot HP-threshold latches
            // (75/50/25%) the Game polls to fire support waves + ramp aggression.
            this.bossCadenceMul = 1;
            this.thresholds = { t75: false, t50: false, t25: false };
            // Continuous low-HP enrage scalar (0 at full HP → 1 at death), set
            // each frame by runBossAI. Scales move speed (Enemy.update), attack
            // cadence (runBossAI), and contact damage (off baseContactDamage).
            this.enrageT = 0;
            this.baseContactDamage = this.contactDamage;
            // Charge-attack lunge state + a rotating phase for spiral barrages.
            this.bossDashTimer = 0;
            this.bossDashSpeed = 0;
            this.bossDashDirX = 0;
            this.bossDashDirY = 0;
            // Charge heading locked at TELEGRAPH time (so the lunge follows the
            // warned lane exactly — no re-aim at commit). null = not aimed yet.
            this.bossChargeDirX = null;
            this.bossChargeDirY = null;
            this.spiralPhase = 0;
            if (Array.isArray(def.attacks)) {
                for (const a of def.attacks) {
                    this.attackTimers[a.id] = Math.random() * a.cooldown;
                }
            }
        }
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

    // ── Elemental status stamps ──────────────────────────────────────────
    // FROST chill: own slow channel (never touches slowMul). Deepest wins,
    // longest refreshes. Bosses are floored so they're only nudged.
    applyChill(mul, dur) {
        const m = this.boss ? Math.max(mul, 0.80) : mul;
        if (this.chillTimer <= 0 || m < this.chillMul) this.chillMul = m;
        if (dur > this.chillTimer) this.chillTimer = dur;
    }

    // FROST freeze: hard stop. Bosses are freeze-EXEMPT (no permafreeze).
    applyFreeze(dur) {
        if (this.boss) return;
        if (dur > this.freezeTimer) this.freezeTimer = dur;
    }

    // SHOCK: stacking damage-amp (applyShred clone). Read at hit time, so it
    // auto-floors on bosses without any CC. Refreshes the decay timer.
    applyShock(maxStacks, dur) {
        if (this.shockStacks < maxStacks) this.shockStacks += 1;
        this.shockTimer = dur;
    }

    // FIRE burn: refresh-deepest-dps-wins, longest refreshes, never additive
    // (so repeated stamps can't runaway). Damage itself is applied by Game's
    // status pass, which owns the tick accumulator.
    applyBurn(dps, dur) {
        if (dps > this.burnDps || this.burnTimer <= 0) this.burnDps = dps;
        if (dur > this.burnTimer) this.burnTimer = dur;
    }

    update(dt, player, enemyProjectiles, obstacleSystem = null) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy) || 0.0001;
        const nx = dx / len;
        const ny = dy / len;

        // Slow + chill are two independent transient channels, both folded
        // into a local scalar — never mutate this.speed (so wave/elite scaling
        // stays intact and the debuffs reverse cleanly). Deepest-per-channel
        // wins within each; the product is the move speed.
        const slowK = this.slowTimer > 0 ? this.slowMul : 1;
        const chillK = this.chillTimer > 0 ? this.chillMul : 1;
        let moveX = nx;        // default plain chase
        let moveY = ny;
        let spd = this.speed * slowK * chillK;

        // FROST freeze is the only hard stop: zero movement AND gate every
        // behavior branch so a frozen enemy can't advance an attack timer,
        // fire mid-windup, finish a dash, or commit a boss special.
        const frozen = this.freezeTimer > 0;
        if (frozen) { moveX = 0; moveY = 0; spd = 0; }

        // Smarter boss chase: instead of homing on the player's CURRENT spot,
        // a boss leads their movement and steers toward where they're GOING, so
        // it cuts the player off in the arena instead of trailing behind them.
        // (Plain enemies keep the simple chase; a target without velocity — e.g.
        // a test stub — falls back to a straight chase.)
        if (this.boss && !frozen) {
            const lead = bossLead(this, player, len);
            moveX = lead.x; moveY = lead.y;
        }

        if (!frozen && this.behavior === 'spitter') {
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
        } else if (!frozen && this.behavior === 'charger') {
            this.attackTimer -= dt;
            if (this.dashTimer > 0) {
                // Mid-dash: travel along the locked direction at dash speed.
                this.dashTimer -= dt;
                moveX = this.dashDirX; moveY = this.dashDirY;
                spd = this.def.dashSpeed * slowK * chillK;
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
        } else if (!frozen && this.behavior === 'support') {
            // Healer/Shielder: hang back from the player (like a spitter) so it
            // survives to keep buffing the front line. Its aura effect itself is
            // applied by Game (which has the full enemy list).
            const kd = this.def.keepDistance ?? 340;
            if (len < kd - 50) { moveX = -nx; moveY = -ny; }
            else if (len > kd + 90) { moveX = nx; moveY = ny; }
            else { moveX = 0; moveY = 0; }
        } else if (!frozen && this.behavior === 'apexBoss') {
            // Telegraphed special attacks + phase-2 enrage. The boss chases by
            // default (moveX/moveY already = nx/ny); runBossAI drives windups
            // and commits. Brace (stand still) while a windup is charging.
            runBossAI(this, dt, player, this._bossOut);
            if (this.bossDashTimer > 0) {
                // Committed CHARGE: barrel along the locked lunge heading at the
                // dash speed (ignores bracing so the lunge actually travels).
                this.bossDashTimer -= dt;
                moveX = this.bossDashDirX; moveY = this.bossDashDirY;
                spd = this.bossDashSpeed * slowK * chillK;
            } else if (this.bossWindupTimer > 0 || this.activeAttack) {
                moveX = 0; moveY = 0;
            }
        }

        // Big-body obstacle avoidance: bosses and juggernauts are wide enough to
        // wedge against buildings on a straight chase. When the path directly
        // ahead is blocked, rotate the move heading to the nearest clear angle
        // so they flow AROUND cover instead of grinding into it (and getting
        // stuck). Skipped while dashing/bracing (they commit their heading).
        if (obstacleSystem && (this.boss || this.radius >= 85) && (moveX || moveY) && spd > 0 &&
            this.bossDashTimer <= 0 && this.bossWindupTimer <= 0 && !this.activeAttack) {
            const steered = steerAround(this.x, this.y, moveX, moveY, this.radius, obstacleSystem);
            moveX = steered.x; moveY = steered.y;
        }

        // Continuous low-HP enrage: a wounded boss moves (and lunges) faster.
        if (this.boss && this.enrageT) spd *= 1 + this.enrageT * BOSS.enrage.speedBonus;

        if (moveX !== 0 || moveY !== 0) {
            this.vx = moveX * spd;
            this.vy = moveY * spd;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        } else {
            this.vx = 0;
            this.vy = 0;
        }

        // A boss winding up / committing a telegraphed attack is planted: it
        // ignores knockback so the player's chip damage can't drift it off the
        // ground telegraph it already painted (the shockwave commits at the
        // boss's live position, so drift would desync the warning ring). The
        // impulse is dropped, not banked, so it doesn't snap on release.
        const bossPlanted = this.boss && (this.bossWindupTimer > 0 || this.activeAttack || this.bossDashTimer > 0);
        if (bossPlanted) {
            this.knockbackVx = 0;
            this.knockbackVy = 0;
        } else if (this.knockbackVx !== 0 || this.knockbackVy !== 0) {
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
        // Elemental status decay. Chill/shock reset their companion scalar on
        // expiry. Burn only ACCUMULATES here (the Game status pass owns the
        // tick → damage conversion); on expiry we zero everything so a stale
        // accumulator can't leak into the next burn.
        if (this.chillTimer > 0) {
            this.chillTimer -= dt;
            if (this.chillTimer <= 0) { this.chillTimer = 0; this.chillMul = 1; }
        }
        if (this.freezeTimer > 0) {
            this.freezeTimer -= dt;
            if (this.freezeTimer <= 0) this.freezeTimer = 0;
        }
        if (this.shockTimer > 0) {
            this.shockTimer -= dt;
            if (this.shockTimer <= 0) { this.shockTimer = 0; this.shockStacks = 0; }
        }
        if (this.burnTimer > 0) {
            this.burnTimer -= dt;
            this.burnTickAccum += dt;
            // Only clamp the timer here; the burn-tick accumulator and burnDps
            // are owned + flushed by Game._tickStatuses so the final partial
            // interval of damage is never silently dropped on expiry.
            if (this.burnTimer < 0) this.burnTimer = 0;
        }
        this.animTimer += dt;
        this.spawnAge += dt;
        if (this.shieldTimer > 0) this.shieldTimer -= dt;
        // Regenerating affix: slowly knit HP back while alive (never past max).
        if (this.regenPerSecond > 0 && this.hp < this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + this.regenPerSecond * dt);
        }
    }

    takeDamage(amount, knockbackVx = 0, knockbackVy = 0) {
        // Mild boss resistance (never full immunity — resist is clamped well
        // below 1 in config). No-op for normal enemies (resist 0).
        if (this.resist > 0) amount *= (1 - this.resist);
        // Reflective/armored elite affix: soak a chunk of every hit.
        if (this.damageTakenMul !== 1) amount *= this.damageTakenMul;
        // Shielder aura: a transient damage-soak while a Shielder is nearby.
        if (this.shieldTimer > 0 && this.shieldMul !== 1) amount *= this.shieldMul;
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

        // Boss presence: a broad ground shadow + a slow, ominous aura halo
        // behind the sprite so an apex predator reads as a major threat at a
        // glance. Both use cached sprites (no per-frame gradients) and only
        // bosses pay the cost. The aura runs hotter once phase-2 enrage latches.
        if (this.boss) {
            const p = BOSS.presence;
            const bR = this.spriteHalf * this.visualScale;
            const shadow = getSoftShadowSprite();
            const sw = bR * p.shadowScale * 2;
            const sh = sw * 0.34;
            ctx.globalAlpha = p.shadowAlpha;
            ctx.drawImage(shadow, -sw / 2, bR * 0.58 - sh / 2, sw, sh);
            const pulse = Math.sin(this.animTimer * 2.2);
            const aura = getGlowSprite(this.phase2Entered ? p.auraColorEnraged : p.auraColor);
            const ar = bR * (p.auraScale + 0.12 * pulse);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = p.auraAlpha + 0.12 * pulse;
            ctx.drawImage(aura, -ar, -ar, ar * 2, ar * 2);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }

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

        // Elemental status tells (all timer-gated, all pre-scale world space,
        // all procedural — no ctx.filter). FROST chill = thin cyan ring;
        // FREEZE = denser frosted double-ring; FIRE burn = warm pulsing halo;
        // SHOCK = yellow crackle arcs near the top.
        const baseR = this.spriteHalf * this.visualScale;
        // Shielder aura tell: a translucent hex-blue bubble around a protected
        // foe so the player can read "kill the Shielder first".
        if (this.shieldTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(127, 208, 255, 0.55)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.92, 0, TWO_PI);
            ctx.stroke();
            ctx.fillStyle = 'rgba(127, 208, 255, 0.10)';
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.92, 0, TWO_PI);
            ctx.fill();
        }
        if (this.chillTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(ELEMENT.frost.tint, 0.5);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.72, 0, TWO_PI);
            ctx.stroke();
        }
        if (this.freezeTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(ELEMENT.freeze.tint, 0.6);
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.78, 0, TWO_PI);
            ctx.stroke();
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.66, 0, TWO_PI);
            ctx.stroke();
        }
        if (this.burnTimer > 0) {
            // Use the CACHED fire glow sprite (drawn at animated alpha) rather
            // than building a radial gradient every frame — a whole burning
            // swarm would otherwise allocate a gradient per enemy per frame,
            // exactly the iOS hazard the particle/lighting systems avoid.
            const haloR = baseR * 0.8;
            const a = 0.3 + 0.2 * Math.sin(this.animTimer * 10);
            const glow = getGlowSprite(ELEMENT.fire.tint);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = a;
            ctx.drawImage(glow, -haloR, -haloR, haloR * 2, haloR * 2);
            ctx.globalAlpha = 1;
        }
        if (this.shockTimer > 0) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToHalo(ELEMENT.shock.tint, 0.6 + 0.25 * Math.min(1, this.shockStacks / 5));
            ctx.lineWidth = 2;
            const top = -baseR * 0.6;
            ctx.beginPath();
            ctx.moveTo(-baseR * 0.4, top);
            ctx.lineTo(-baseR * 0.18, top + baseR * 0.18);
            ctx.lineTo(baseR * 0.04, top - baseR * 0.06);
            ctx.lineTo(baseR * 0.3, top + baseR * 0.16);
            ctx.stroke();
        }

        // "Alive" deform: idle breathing (volume-preserving pulse so nothing
        // sits perfectly still) + a spawn-in scale pop (easeOutBack overshoot)
        // + a hit squash (stretch wide / squash flat) for the hit-flash window.
        const breath = Math.sin(this.animTimer * 3.1 + this.animOffset) * 0.03;
        let sx = 1 + breath, sy = 1 - breath;
        if (this.spawnAge < SPAWN_POP_DUR) {
            const pop = 0.35 + 0.65 * Easing.outBack(this.spawnAge / SPAWN_POP_DUR);
            sx *= pop; sy *= pop;
        }
        if (this.hitFlashTimer > 0) {
            const q = this.hitFlashTimer / HIT_FLASH_DURATION;
            sx *= 1 + 0.20 * q; sy *= 1 - 0.16 * q;
        }
        // Non-bosses lean into their horizontal movement — reads as weight.
        if (!this.boss && this.vx) ctx.rotate(clamp(this.vx * 0.00018, -0.13, 0.13));
        ctx.scale(this.visualScale * sx, this.visualScale * sy);

        const idx = Math.floor(this.animTimer * this.frameHz) % this.frames.length;
        const frame = this.frames[idx];
        ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);

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
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        // Status brightening via additive frame redraws (can't tint a
        // drawImage without ctx.filter, so we brighten the sprite's own
        // pixels — burn reads warm, freeze reads as a pale ice sheen, phase-2
        // enrage reads hot alongside the ENRAGED HP-bar tint).
        if (this.burnTimer > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.15;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        if (this.freezeTimer > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.14;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        if (this.phase2Entered) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.18;
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
        }
        if (this.hitFlashTimer > 0) {
            const t = this.hitFlashTimer / HIT_FLASH_DURATION;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, 0.9 * t);
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
            ctx.drawImage(frame, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
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

// ── Apex-boss AI ────────────────────────────────────────────────────────
// Free function (keeps Enemy.update readable). Drives the phase-2 latch,
// attack-cooldown ticking, telegraph windups, and commits. `out` is the
// boss's stashed { enemyProjectiles, hazards } channel (set in Game._spawnBoss).
// Mirrors the spitter/charger timer + windup idiom. One attack winds up at a
// time. Movement is the default chase handled by Enemy.update; this only
// drives specials. The caller braces the boss (stand still) while a windup is
// active so the telegraph reads clearly.
// Probe headings fanning out from the desired chase direction and return the
// first one whose lookahead point is clear of obstacles, so a wide body steers
// around cover instead of pressing into it. Angles alternate left/right and
// widen; falls back to the straight heading if everything is blocked (the
// per-frame resolveCircle still keeps it out of walls in that worst case).
// Predict where the player will be in `t` seconds from their current velocity.
// A target without velocity fields (a test stub) reduces to the current spot.
function leadPoint(e, player, speed) {
    const pvx = player.vx || 0, pvy = player.vy || 0;
    const dist = Math.hypot(player.x - e.x, player.y - e.y);
    // Time for a projectile/lunge at `speed` (or the boss's move speed) to close
    // the gap, clamped so we never over-lead clear across the arena.
    const t = Math.min(1.1, dist / Math.max(120, speed || e.speed || 1));
    return { x: player.x + pvx * t, y: player.y + pvy * t };
}

// Chase heading that leads the player's movement (cut-off pursuit). Returns a
// unit vector toward the predicted intercept point.
function bossLead(e, player, dist) {
    const lead = leadPoint(e, player, e.speed);
    const dx = lead.x - e.x, dy = lead.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

const STEER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.45, -1.45, 2.1, -2.1];
function steerAround(x, y, dx, dy, radius, obs) {
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    const ahead = radius + 70;
    for (const a of STEER_ANGLES) {
        const c = Math.cos(a), s = Math.sin(a);
        const rx = nx * c - ny * s;
        const ry = nx * s + ny * c;
        if (!obs.isBlocked(x + rx * ahead, y + ry * ahead, radius * 0.92)) {
            return { x: rx, y: ry };
        }
    }
    return { x: nx, y: ny };
}

function runBossAI(e, dt, player, out) {
    const def = e.def;

    // Continuous enrage scalar: 0 at full HP → 1 at death. Drives the smooth
    // speed/cadence/contact-damage ramp so the closer the boss is to dying, the
    // more frantic and dangerous it gets.
    const frac = e.maxHp > 0 ? clamp(e.hp / e.maxHp, 0, 1) : 1;
    e.enrageT = 1 - frac;
    // Contact damage scales live off the captured baseline.
    e.contactDamage = e.baseContactDamage * (1 + e.enrageT * BOSS.enrage.damageBonus);

    // Phase-2 latch: polled (there is no onDamage hook). The one-shot enrage
    // announce/retint is driven by Game off the phase2Entered flag.
    if (!e.phase2Entered && e.maxHp > 0 && e.hp / e.maxHp <= (def.phase2HpFraction ?? 0)) {
        e.phase2Entered = true;
        e.phase = 2;
    }

    // A windup in progress: count it down and commit on expiry.
    if (e.bossWindupTimer > 0) {
        e.bossWindupTimer -= dt;
        if (e.bossWindupTimer <= 0) {
            e.bossWindupTimer = 0;
            commitBossAttack(e, e.activeAttack, player, out);
            e.activeAttack = null;
        }
        return;
    }

    const attacks = def.attacks;
    if (!attacks || !out) return;

    // Tick every attack's cooldown; start the first that comes ready. Phase 2
    // shortens the reset so specials fire more often.
    for (const atk of attacks) {
        if (e.attackTimers[atk.id] == null) e.attackTimers[atk.id] = atk.cooldown;
        e.attackTimers[atk.id] -= dt;
        if (e.attackTimers[atk.id] <= 0) {
            e.activeAttack = atk;
            e.bossWindupTimer = atk.windup;
            // Attack cadence = the FASTEST of the phase-2 enrage multiplier and
            // the Game-set HP-threshold multiplier, so a wounded boss attacks
            // faster and the two systems compose instead of shadowing.
            const phaseCad = e.phase === 2 ? (BOSS_ATTACK.phase2CadenceMul ?? 1) : 1;
            const cadence = Math.min(e.bossCadenceMul ?? 1, phaseCad);
            // Continuous enrage shortens cooldowns further (composes with the
            // threshold/phase cadence) so a low-HP boss attacks much faster.
            const enrageCad = 1 - (e.enrageT ?? 0) * BOSS.enrage.cadenceCut;
            e.attackTimers[atk.id] = atk.cooldown * cadence * enrageCad;
            // Ground-decal telegraph that expands across the windup, centered
            // on the boss (it braces in place while charging, so this stays put).
            if (out.hazards) {
                if (atk.kind === 'shockwave') {
                    out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: atk.rMax, age: 0, lifetime: atk.windup, active: true });
                } else if (atk.kind === 'fan') {
                    out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 140, age: 0, lifetime: atk.windup, active: true, fan: true });
                } else if (atk.kind === 'summon') {
                    out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 160, age: 0, lifetime: atk.windup, active: true, fan: true });
                } else if (atk.kind === 'charge') {
                    // Directional lunge warning: a lane painted from the boss
                    // toward where the player is HEADED. The heading is LOCKED
                    // here and reused verbatim at commit, so the lunge follows
                    // exactly the lane that was telegraphed (it never re-aims
                    // mid-charge — the player can read it and sidestep).
                    const lead = leadPoint(e, player, atk.dashSpeed ?? 600);
                    const ca = Math.atan2(lead.y - e.y, lead.x - e.x);
                    e.bossChargeDirX = Math.cos(ca);
                    e.bossChargeDirY = Math.sin(ca);
                    out.hazards.push({
                        kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 120,
                        age: 0, lifetime: atk.windup, active: true, charge: true,
                        dirX: e.bossChargeDirX, dirY: e.bossChargeDirY,
                        reach: (atk.dashSpeed ?? 600) * (atk.dashDuration ?? 0.6),
                    });
                } else if (atk.kind === 'wall' || atk.kind === 'seekers' || atk.kind === 'zones') {
                    // New moves: a generic windup ring so the boss visibly
                    // charges (zones/walls/seekers paint their own danger on
                    // commit; this just reads the wind-up).
                    out.hazards.push({ kind: 'bossTelegraph', x: e.x, y: e.y, r: 0, rMax: 170, age: 0, lifetime: atk.windup, active: true, fan: true });
                }
            }
            break; // only one windup at a time
        }
    }
}

// Fire the committed special. Shockwave pushes an expanding damaging ring
// into the hazard pool (centered on the boss); fan pushes a radial burst of
// EnemyProjectiles into the existing enemy-bolt loop (no new damage path).
function commitBossAttack(e, atk, player, out) {
    if (!atk || !out) return;
    if (atk.kind === 'shockwave' && out.hazards) {
        out.hazards.push({
            kind: 'shockwave',
            x: e.x, y: e.y,
            r: 0, rMax: atk.rMax,
            growth: atk.growth, band: atk.band, damage: atk.damage,
            hitPlayer: false,
            age: 0, lifetime: atk.rMax / atk.growth + 0.1,
            active: true,
        });
    } else if (atk.kind === 'fan' && out.enemyProjectiles) {
        let base = Math.atan2(player.y - e.y, player.x - e.x);
        const count = atk.count ?? 1;
        const full = (atk.spread ?? 0) >= 6.28; // full-circle radial volley
        // SPIRAL barrage: rotate the whole pattern a little each cast so
        // successive volleys sweep a turning spiral the player must weave.
        if (atk.spiral) {
            base += e.spiralPhase;
            e.spiralPhase = (e.spiralPhase + (atk.spin ?? 0.5)) % TWO_PI;
        }
        for (let i = 0; i < count; i++) {
            const a = full
                ? base + (i / count) * TWO_PI
                : base + (count > 1 ? (i / (count - 1) - 0.5) * atk.spread : 0);
            out.enemyProjectiles.push(new EnemyProjectile(
                e.x, e.y,
                Math.cos(a) * atk.projectileSpeed,
                Math.sin(a) * atk.projectileSpeed,
                atk.projectileDamage
            ));
        }
    } else if (atk.kind === 'charge') {
        // Goring lunge: reuse the heading LOCKED when the telegraph lane was
        // painted, so the dash follows exactly the warned path (no mid-commit
        // re-aim). Falls back to a fresh lead if no telegraph ran (e.g. a test
        // that drives the commit directly).
        let dx = e.bossChargeDirX, dy = e.bossChargeDirY;
        if (dx == null) {
            const lead = leadPoint(e, player, atk.dashSpeed ?? 600);
            const ang = Math.atan2(lead.y - e.y, lead.x - e.x);
            dx = Math.cos(ang); dy = Math.sin(ang);
        }
        e.bossDashDirX = dx;
        e.bossDashDirY = dy;
        e.bossDashSpeed = atk.dashSpeed ?? 600;
        e.bossDashTimer = atk.dashDuration ?? 0.6;
        e.bossChargeDirX = null; // consumed
        e.bossChargeDirY = null;
    } else if (atk.kind === 'wall' && out.enemyProjectiles) {
        // A broad wall of bolts sweeping toward the player with ONE gap to
        // sprint through — forces a read + reposition, not a sidestep.
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        const px = -Math.sin(ang), py = Math.cos(ang); // unit perpendicular
        const count = atk.count ?? 13;
        const spacing = atk.spacing ?? 72;
        const spd = atk.projectileSpeed ?? 360;
        const gapHalf = atk.gap ?? 2;
        // Vary the gap location each cast (reuse the rotating spiral phase as a
        // cheap pseudo-random so successive walls don't share a safe lane).
        const gapIdx = Math.floor((((e.spiralPhase * 0.4) % 1) + 1) % 1 * count);
        e.spiralPhase = (e.spiralPhase + 1.7) % TWO_PI;
        for (let i = 0; i < count; i++) {
            if (Math.abs(i - gapIdx) <= gapHalf) continue; // leave the gap
            const off = (i - (count - 1) / 2) * spacing;
            const ox = e.x + px * off, oy = e.y + py * off;
            out.enemyProjectiles.push(new EnemyProjectile(
                ox, oy, Math.cos(ang) * spd, Math.sin(ang) * spd, atk.projectileDamage ?? 16));
        }
    } else if (atk.kind === 'seekers' && out.enemyProjectiles) {
        // A handful of slow HOMING orbs fanned out — they curve after the
        // player, so you can't just stand still after the first dodge.
        const count = atk.count ?? 4;
        const base = Math.atan2(player.y - e.y, player.x - e.x);
        const spd = atk.projectileSpeed ?? 250;
        for (let i = 0; i < count; i++) {
            const a = base + (count > 1 ? (i / (count - 1) - 0.5) * 1.6 : 0);
            out.enemyProjectiles.push(new EnemyProjectile(
                e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, atk.projectileDamage ?? 14, {
                    homing: true, turnRate: atk.turnRate ?? 2.2, maxSpeed: atk.maxSpeed ?? 360,
                    color: atk.color, lifetime: 5.0,
                }));
        }
    } else if (atk.kind === 'zones' && out.hazards) {
        // Delayed AoE: telegraphed danger circles bloom around the player, then
        // detonate — pressures the player to keep MOVING, not turtle near the boss.
        const count = atk.count ?? 5;
        const spread = atk.spreadRadius ?? 360;
        const r = atk.zoneRadius ?? 150;
        for (let i = 0; i < count; i++) {
            // First zone lands on the player's lead point; the rest scatter
            // around them so there's always somewhere to run.
            let zx, zy;
            if (i === 0) {
                const lead = leadPoint(e, player, 9999);
                zx = lead.x; zy = lead.y;
            } else {
                const a = Math.random() * TWO_PI;
                const rr = spread * (0.3 + Math.random() * 0.7);
                zx = player.x + Math.cos(a) * rr;
                zy = player.y + Math.sin(a) * rr;
            }
            out.hazards.push({
                kind: 'delayedZone', x: zx, y: zy, r, damage: atk.damage ?? 24,
                age: 0, lifetime: atk.warn ?? 0.85, hitPlayer: false, detonateAge: 0, active: true,
            });
        }
    } else if (atk.kind === 'summon' && out.summons) {
        // Queue a themed minion call for the Game to fulfill (it owns spawn
        // placement, wave scaling, and the live enemy cap).
        out.summons.push({
            x: e.x, y: e.y,
            count: atk.summonCount ?? 3,
            types: atk.summonTypes ?? null,
        });
    }
}
