import {
    PLAYER,
    SPRITE_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    UI,
    CAPS,
    AURA,
    xpRequired,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { getCharacterFrames, getGlowSprite } from '../assets/ProceduralSprites.js';
import { getCharacter } from '../content/characters.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

export class Player {
    constructor(x = PLAYER.startX, y = PLAYER.startY, characterId = 'monkey') {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = PLAYER.radius;
        this.speed = PLAYER.speed;
        this.facingX = 1;
        this.characterId = characterId;
        // Frames: [0]=idle, [1..3]=walk cycle. draw() picks one per frame
        // based on movement state — all four are cached up-front. The selected
        // character recolors the shared silhouette via its palette.
        const ch = getCharacter(characterId);
        this.frames = getCharacterFrames(characterId, ch);
        this.spriteHalf = SPRITE_SIZE / 2;
        this.bobTimer = 0;
        // Free-running clock (advances even while idle) for the idle breath.
        this.aliveTimer = 0;
        this.moving = false;
        // Cosmetic trail: recent positions, drawn as a fading wake.
        this.trailPositions = [];
        this._trailTick = 0;
        // Lazily-built fur-tinted sprite frames (keyed by color).
        this._tintCache = { color: null, frames: null };

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
        // Sustained-heal budget: regen + Divine Nova route through
        // healSustained() which caps total healing to CAPS.healPerSecond over a
        // rolling 1s window. Instant heals (chests, Hearty, Ember Salve) bypass
        // this and set hp directly.
        this._healWindow = 1;
        this._healedThisSec = 0;
        this.thornsReflect = 0;

        // Elemental passive modifiers (read by weapons / the burn DoT pass).
        // Neutral defaults so apply() can never produce NaN before a passive
        // bumps them. Pyromancer's Tinder scales burn; Frostbite Core deepens
        // chill and adds freeze-proc chance to frost weapons.
        this.burnDamageMul = 1;
        this.chillStrength = 0;
        this.freezeChanceBonus = 0;

        // Offensive perk modifiers (read by weapons.js powerRoll at hit time).
        //   critChance       0..1 chance a hit crits (Emberzeal, Keen Ember)
        //   critMul          damage multiplier on a crit (Executioner raises it)
        //   lowHpDamageBonus extra damage fraction while below the rage HP
        //                    threshold (Last Light) — rewards fighting hurt
        this.critChance = 0;
        this.critMul = 2.0;
        this.lowHpDamageBonus = 0;
        // Lifesteal-on-kill (Blooddrinker). HP healed per kill, routed through
        // the sustained-heal cap so it can't out-heal a crowd.
        this.killHeal = 0;

        // Forward-looking stash for the chest stage.
        this.chestLuck = 0;
        this.coins = 0;
        // Coin-gain multiplier from loadout gear/charms (applied at banking).
        this.coinMul = 1;
        // Appearance from equipped cosmetics; set at run start. Defaults keep
        // the base monkey look if no cosmetics are wired.
        this.appearance = null;
        // Weapon-driven aura snapshot (set by Game each frame; null = skip,
        // e.g. reduced-effects mode). { color, intensity, radius, pulse }.
        this.weaponAura = null;
        this.auraPhase = 0;
        // Transient Shadow Dash visual (set by the ability; ticked in update,
        // drawn as an afterimage smear along the blink path). null when idle.
        this.dashFx = null;
        // Shadow Dash (reworked): a timed movement-speed surge instead of an
        // instant blink. While speedBoostTimer > 0, move speed is multiplied by
        // speedBoostMul. Both reset on a fresh Player (restart).
        this.speedBoostTimer = 0;
        this.speedBoostMul = 1;
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
        // Shadow Dash surge: a transient speed multiplier folded in here so it
        // never mutates the base speed (upgrades/caps stay intact and it
        // reverses cleanly when the timer runs out).
        if (this.speedBoostTimer > 0) {
            this.speedBoostTimer = Math.max(0, this.speedBoostTimer - dt);
            if (this.speedBoostTimer === 0) this.speedBoostMul = 1;
        }
        const spd = this.speed * (this.speedBoostTimer > 0 ? this.speedBoostMul : 1);
        this.vx = move.x * spd;
        this.vy = move.y * spd;
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const halfW = WORLD_WIDTH / 2;
        const halfH = WORLD_HEIGHT / 2;
        this.x = clamp(this.x, -halfW + this.radius, halfW - this.radius);
        this.y = clamp(this.y, -halfH + this.radius, halfH - this.radius);

        const speedSq = this.vx * this.vx + this.vy * this.vy;
        this.moving = speedSq > 1;
        if (this.moving) this.bobTimer += dt;
        this.aliveTimer += dt;
        if (move.x !== 0) this.facingX = move.x < 0 ? -1 : 1;

        // Record a sparse trail (cosmetic only) while moving.
        if (this.appearance && this.appearance.trailColor) {
            this._trailTick += dt;
            if (this.moving && this._trailTick >= 0.05) {
                this._trailTick = 0;
                this.trailPositions.push({ x: this.x, y: this.y, age: 0 });
                if (this.trailPositions.length > 10) this.trailPositions.shift();
            }
            for (const t of this.trailPositions) t.age += dt;
            while (this.trailPositions.length && this.trailPositions[0].age > 0.6) this.trailPositions.shift();
        }

        if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
        if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

        // Roll the sustained-heal budget window.
        this._healWindow -= dt;
        if (this._healWindow <= 0) { this._healWindow += 1; this._healedThisSec = 0; }

        // Aura pulse phase (always advances so pulsing auras animate even idle).
        this.auraPhase += dt;

        // Tick the Shadow Dash smear, then clear it when finished.
        if (this.dashFx) {
            this.dashFx.age += dt;
            if (this.dashFx.age >= this.dashFx.dur) this.dashFx = null;
        }
    }

    // Heal subject to the per-second sustained cap (CAPS.healPerSecond). Returns
    // the amount actually healed. Used by regen + Divine Nova so the player can
    // recover from mistakes but can't out-heal a late-game crowd by standing still.
    healSustained(amount) {
        if (amount <= 0 || this.hp >= this.maxHp) return 0;
        const room = Math.max(0, CAPS.healPerSecond - this._healedThisSec);
        const heal = Math.min(amount, room, this.maxHp - this.hp);
        if (heal <= 0) return 0;
        this.hp += heal;
        this._healedThisSec += heal;
        return heal;
    }

    // Build fur-tinted copies of the sprite frames once per fur color. Uses an
    // offscreen canvas + 'source-atop' so only the sprite pixels are tinted
    // (transparent background stays clear). Falls back to untinted on failure
    // (e.g. headless render harness without a real canvas).
    _tintedFrames(color) {
        if (this._tintCache.color === color) return this._tintCache.frames || this.frames;
        let out = null;
        try {
            out = this.frames.map((f) => {
                const c = document.createElement('canvas');
                c.width = f.width; c.height = f.height;
                const cx = c.getContext('2d');
                if (!cx) throw new Error('no ctx');
                cx.drawImage(f, 0, 0);
                cx.globalCompositeOperation = 'source-atop';
                cx.globalAlpha = 0.42;
                cx.fillStyle = color;
                cx.fillRect(0, 0, c.width, c.height);
                return c;
            });
        } catch (e) { out = null; }
        this._tintCache = { color, frames: out };
        return out || this.frames;
    }

    draw(ctx) {
        let alpha = 1;
        if (this.invincibleTimer > 0) {
            const pulse = (Math.sin(this.invincibleTimer * 26) + 1) / 2;
            alpha = 0.45 + pulse * 0.5;
        }

        const ap = this.appearance || {};
        const bobY = this.moving ? Math.sin(this.bobTimer * 12) * 3 : 0;

        // Cosmetic trail (world space, behind everything).
        if (ap.trailColor && this.trailPositions.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (const t of this.trailPositions) {
                const k = Math.max(0, 1 - t.age / 0.6);
                ctx.globalAlpha = k * 0.4;
                ctx.fillStyle = ap.trailColor;
                ctx.beginPath();
                ctx.arc(t.x, t.y + bobY, 16 * k + 4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Aura glow (world space, behind sprite). Uses CACHED glow sprites
        // (getGlowSprite memoizes per color) instead of a per-frame radial
        // gradient — cheaper, mobile-friendly. The weapon aura is the main
        // glow (driven by owned weapons/evolutions); the cosmetic aura, if any,
        // is a small inner tint so cosmetics still read. Drawn additively but
        // capped (AURA.maxIntensity) so it never washes out the scene.
        const cy = this.y + bobY;
        if (this.weaponAura) {
            const wa = this.weaponAura;
            let inten = wa.intensity;
            if (wa.pulse) inten *= 1 + AURA.pulseAmount * Math.sin(this.auraPhase * AURA.pulseSpeed);
            inten = clamp(inten, 0, AURA.maxIntensity);
            const r = wa.radius;
            const glow = getGlowSprite(wa.color);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = inten;
            ctx.drawImage(glow, this.x - r, cy - r, r * 2, r * 2);
            ctx.restore();
        }
        if (ap.auraColor) {
            const ar = this.spriteHalf * 1.1;
            const glow = getGlowSprite(ap.auraColor);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.28;
            ctx.drawImage(glow, this.x - ar, cy - ar, ar * 2, ar * 2);
            ctx.restore();
        }

        // 3 walk frames cycled at ~6 Hz, idle when standing still.
        const walkIdx = this.moving
            ? 1 + (Math.floor(this.bobTimer * 6) % 3)
            : 0;
        const frames = ap.furColor ? this._tintedFrames(ap.furColor) : this.frames;
        const sprite = frames[walkIdx] ?? frames[0];

        // Shadow Dash afterimage smear: fading ghost copies strung along the
        // blink path (origin → destination), drawn in world space behind the
        // real sprite so the dash reads as a streak of motion.
        if (this.dashFx) {
            const df = this.dashFx;
            const k = 1 - df.age / df.dur; // 1 → 0 over the smear's life
            const ghosts = 4;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < ghosts; i++) {
                const f = i / ghosts;
                const gx = df.fromX + (df.toX - df.fromX) * f;
                const gy = df.fromY + (df.toY - df.fromY) * f + bobY;
                ctx.globalAlpha = k * 0.3 * (1 - f * 0.5);
                ctx.save();
                ctx.translate(gx, gy);
                if (this.facingX < 0) ctx.scale(-1, 1);
                ctx.drawImage(sprite, -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
                ctx.restore();
            }
            ctx.restore();
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y + bobY);
        // Forward smear on the live sprite for the first moments of a dash.
        if (this.dashFx) {
            const stretch = 1 + 0.18 * (1 - this.dashFx.age / this.dashFx.dur);
            ctx.scale(stretch, 1 / Math.sqrt(stretch));
        }
        // Hit squash (stretch wide / squash flat for the hit-flash window) so
        // taking a hit reads with weight; a gentle idle breath otherwise so the
        // hero never sits perfectly still.
        if (this.hitFlashTimer > 0) {
            const q = this.hitFlashTimer / PLAYER.hitFlashDuration;
            ctx.scale(1 + 0.16 * q, 1 - 0.13 * q);
        } else if (!this.moving) {
            const b = Math.sin(this.aliveTimer * 3) * 0.025;
            ctx.scale(1 + b, 1 - b);
        }

        // Cloak draped behind the body (symmetric → drawn unflipped).
        if (ap.cloakColor) this._drawCloak(ctx, ap.cloakColor);

        ctx.save();
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

        // Accessory on the head (symmetric → drawn unflipped, on top).
        if (ap.hatShape && ap.hatShape !== 'none') this._drawHat(ctx, ap.hatShape, ap.hatColor);
        ctx.restore();
    }

    _drawCloak(ctx, color) {
        const h = this.spriteHalf;
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-h * 0.42, -h * 0.18);
        ctx.lineTo(h * 0.42, -h * 0.18);
        ctx.lineTo(h * 0.6, h * 0.62);
        ctx.lineTo(0, h * 0.78);
        ctx.lineTo(-h * 0.6, h * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    _drawHat(ctx, shape, color) {
        const h = this.spriteHalf;
        const topY = -h * 0.62;
        ctx.save();
        ctx.fillStyle = color || '#ffd35a';
        if (shape === 'cap') {
            ctx.beginPath();
            ctx.arc(0, topY, h * 0.32, Math.PI, 0);
            ctx.fill();
            ctx.fillRect(-h * 0.34, topY - 2, h * 0.68, 6);
        } else if (shape === 'candle') {
            ctx.fillStyle = '#e8e2cf';
            ctx.fillRect(-h * 0.07, topY - h * 0.28, h * 0.14, h * 0.3);
            ctx.fillStyle = '#ffb24a';
            ctx.beginPath();
            ctx.ellipse(0, topY - h * 0.3, h * 0.06, h * 0.11, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (shape === 'horns') {
            ctx.strokeStyle = color || '#9a6cff';
            ctx.lineWidth = 8; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-h * 0.22, topY + 6); ctx.quadraticCurveTo(-h * 0.5, topY - h * 0.2, -h * 0.32, topY - h * 0.4);
            ctx.moveTo(h * 0.22, topY + 6); ctx.quadraticCurveTo(h * 0.5, topY - h * 0.2, h * 0.32, topY - h * 0.4);
            ctx.stroke();
        } else if (shape === 'crown') {
            ctx.beginPath();
            const cw = h * 0.5, cy = topY;
            ctx.moveTo(-cw, cy);
            ctx.lineTo(-cw, cy - h * 0.16);
            ctx.lineTo(-cw * 0.5, cy - h * 0.04);
            ctx.lineTo(0, cy - h * 0.22);
            ctx.lineTo(cw * 0.5, cy - h * 0.04);
            ctx.lineTo(cw, cy - h * 0.16);
            ctx.lineTo(cw, cy);
            ctx.closePath();
            ctx.fill();
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
