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
import { Easing } from '../core/Easing.js';
import {
    getHeroFrames, heroSetFrames, getGlowSprite, drawWeaponSkinOverlay,
} from '../assets/ProceduralSprites.js';
import { drawPixelCloak, drawPixelHat } from '../assets/PixelArt.js';
import { getWeaponProp } from '../assets/WeaponProps.js';
import { getCharacter } from '../content/characters.js';
import { getCloakSprite } from '../assets/LpcSprites.js';
import { drawWorldHealthBar, healthColor } from '../render/DrawUtils.js';

// Player melee swing animation timing.
const SWING_DUR = 0.3;
// How long the cast (attack) pose holds after a primary-weapon shot.
const CAST_DUR = 0.22;

export class Player {
    constructor(x = PLAYER.startX, y = PLAYER.startY, characterId = 'monkey') {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = PLAYER.radius;
        this.speed = PLAYER.speed;
        this.facingX = 1;
        // 4-way facing for the directional sprite model: 'down'|'up'|'left'|'right'.
        // Kept between moves so an idle hero keeps the last-faced direction.
        this.facing = 'down';
        this.characterId = characterId;
        // Directional pose frame model: { dirs:{down,up,side}, each = {idle,
        // walk:[3], cast, hurt} }. draw() picks dir+state by facing/animState.
        const ch = getCharacter(characterId);
        this.heroFrames = getHeroFrames(characterId, ch);
        this._allHeroFrames = heroSetFrames(this.heroFrames);
        // LPC-bodied heroes get the imported cape sprite for their cloak (it
        // aligns to the LPC body); the chibi cast keeps the procedural drape.
        this.isLpcBody = !!ch.lpc;
        this.spriteHalf = SPRITE_SIZE / 2;
        this.bobTimer = 0;
        // Attack(cast) pose timer. Set by a melee swing now (triggerSwing); the
        // ranged/primary-weapon fire hook that calls triggerCast() lands in PR-B
        // (held weapons). While >0 the hero holds the cast pose.
        this.castTimer = 0;
        // Free-running clock (advances even while idle) for the idle breath.
        this.aliveTimer = 0;
        this.moving = false;
        // Cosmetic trail: recent positions, drawn as a fading wake.
        this.trailPositions = [];
        this._trailTick = 0;
        // Lazily-built fur-tint lookup (origCanvas → tinted copy), keyed by color.
        this._tintCache = { color: null, map: null };
        // Weapon-themed skin overlay (set by Game from the starting weapon) +
        // melee swing animation state ({ age, dir } or null).
        this.weaponSkin = null;
        // Gated by Game from reducedEffects (mirrors the weaponAura gate) so the
        // accessibility mode silences the extra additive overlay glow too.
        this.skinOverlayEnabled = true;
        this.swing = null;
        // Held-weapon loadout: an array of { prop, accent, glow, kind, isPrimary,
        // fireFlash } from WeaponSystem.getOwnedVisuals(), set by Game each
        // frame. aimAngle (world radians, also set by Game) points the primary
        // weapon at the nearest foe; null/empty loadout → nothing in-hand drawn.
        this.loadout = null;
        this.aimAngle = Math.PI / 2; // default: aim "down" (toward the camera)

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
        // Aegis keystone: an extra cut below half HP (read here, the one sink).
        const aegis = (this.ks_aegis && this.maxHp > 0 && this.hp / this.maxHp <= 0.5) ? 0.65 : 1;
        const incoming = amount * (this.damageTakenMul ?? 1) * aegis;
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
        if (this.swing) { this.swing.age += dt; if (this.swing.age >= SWING_DUR) this.swing = null; }
        if (this.castTimer > 0) this.castTimer = Math.max(0, this.castTimer - dt);
        // 4-way facing from the movement vector (dominant axis); kept when idle.
        if (this.moving) {
            if (Math.abs(this.vx) >= Math.abs(this.vy)) this.facing = this.vx < 0 ? 'left' : 'right';
            else this.facing = this.vy < 0 ? 'up' : 'down';
            this.facingX = this.vx < 0 ? -1 : (this.vx > 0 ? 1 : this.facingX);
        }

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

    // Build fur-tinted copies of EVERY directional pose frame once per fur
    // color, returning a Map(origCanvas → tintedCanvas). 'source-atop' tints
    // only the sprite pixels (transparent margin stays clear). Returns null on
    // failure (e.g. headless harness) so draw() falls back to the untinted frame.
    _tintMap(color) {
        if (this._tintCache.color === color) return this._tintCache.map;
        let map = null;
        try {
            map = new Map();
            for (const f of this._allHeroFrames) {
                const c = document.createElement('canvas');
                c.width = f.width; c.height = f.height;
                const cx = c.getContext('2d');
                if (!cx) throw new Error('no ctx');
                cx.drawImage(f, 0, 0);
                cx.globalCompositeOperation = 'source-atop';
                cx.globalAlpha = 0.42;
                cx.fillStyle = color;
                cx.fillRect(0, 0, c.width, c.height);
                map.set(f, c);
            }
        } catch (e) { map = null; }
        this._tintCache = { color, map };
        return map;
    }

    // Hold the cast (attack) pose briefly; called when the primary weapon fires.
    triggerCast() { this.castTimer = CAST_DUR; }

    draw(ctx) {
        let alpha = 1;
        if (this.invincibleTimer > 0) {
            const pulse = (Math.sin(this.invincibleTimer * 26) + 1) / 2;
            alpha = 0.45 + pulse * 0.5;
        }

        const ap = this.appearance || {};
        const bobY = this.moving ? Math.sin(this.bobTimer * 12) * 3 : 0;

        // Cosmetic trail (world space, behind everything) — chunky pixel puffs
        // to match the pixel-art model: a center block + four smaller satellites
        // that shrink + fade with the trail point's age.
        if (ap.trailColor && this.trailPositions.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = ap.trailColor;
            for (const t of this.trailPositions) {
                const k = Math.max(0, 1 - t.age / 0.6);
                if (k <= 0) continue;
                ctx.globalAlpha = k * 0.45;
                const b = Math.round(5 + 12 * k);          // core block size
                const px = Math.round(t.x), py = Math.round(t.y + bobY);
                ctx.fillRect(px - b / 2, py - b / 2, b, b);
                const s2 = Math.max(2, Math.round(b * 0.45));
                ctx.fillRect(px - b, py - s2 / 2, s2, s2);
                ctx.fillRect(px + b - s2, py - s2 / 2, s2, s2);
                ctx.fillRect(px - s2 / 2, py - b, s2, s2);
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

        // Directional facing → which dir set + horizontal flip.
        let dir = 'down', flip = false;
        if (this.facing === 'up') dir = 'up';
        else if (this.facing === 'left') { dir = 'side'; flip = true; }
        else if (this.facing === 'right') dir = 'side';
        // Animation state precedence: hurt > cast > walk > idle.
        let state = 'idle', idx = 0;
        if (this.hitFlashTimer > 0) state = 'hurt';
        else if (this.castTimer > 0) state = 'cast';
        else if (this.moving) { state = 'walk'; idx = Math.floor(this.bobTimer * 6) % 3; }
        const dset = this.heroFrames.dirs[dir] || this.heroFrames.dirs.down;
        const poseArr = dset[state] || dset.idle;
        const orig = poseArr[idx % poseArr.length] || poseArr[0];
        const tintMap = ap.furColor ? this._tintMap(ap.furColor) : null;
        const sprite = (tintMap && tintMap.get(orig)) || orig;

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
                if (flip) ctx.scale(-1, 1);
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

        // Cloak: drawn BEHIND the body for the front/side views (only the collar
        // + hem wings peek out). For the back view ('up') the per-direction PIXEL
        // cloak drapes OVER the body (drawn after the sprite, below) so we see the
        // full cape. LPC heroes use a single front-facing imported cape that has
        // no back variant, so it always draws behind the body (every direction).
        if (ap.cloakColor && (this.isLpcBody || dir !== 'up')) this._drawCloak(ctx, ap.cloakColor, dir, flip);

        ctx.save();
        if (flip) ctx.scale(-1, 1);
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

        // Back-view pixel cloak drapes over the body (full cape facing away).
        // (LPC heroes already drew their cape behind the body above.)
        if (ap.cloakColor && !this.isLpcBody && dir === 'up') this._drawCloak(ctx, ap.cloakColor, dir, flip);

        // Weapon-themed skin overlay (sash + chest gem + floating motif) drawn
        // over the body, under the hat — shared with the menu preview so the two
        // always match. Unflipped + in-character-space; t = idle clock.
        if (this.weaponSkin && this.skinOverlayEnabled) drawWeaponSkinOverlay(ctx, 0, 0, this.spriteHalf, this.weaponSkin, this.aliveTimer, dir);

        // Accessory on the head (direction-aware pixel hat, on top).
        if (ap.hatShape && ap.hatShape !== 'none') this._drawHat(ctx, ap.hatShape, ap.hatColor, dir, flip);
        ctx.restore();

        // Held weapons (primary in-hand aimed at the target + the rest of the
        // owned loadout in a floating halo). World-space so they rotate to the
        // aim angle independent of the body flip. Drawn over the body, under the
        // swing arc.
        if (this.loadout && this.loadout.length) this._drawHeldWeapons(ctx, bobY, alpha);

        // Melee swing arc (world-space, additive) on top of everything.
        if (this.swing) this._drawSwing(ctx);
    }

    // Draw the owned loadout on the body: the primary weapon held in-hand and
    // pointed at the aim target (with a forward thrust + tip muzzle flash while
    // it's firing), and every other owned weapon floating in a tidy halo, each
    // flicking outward when it fires. Orbit weapons are skipped here — their
    // spinning blade ring (drawn by WeaponSystem) already IS their visual.
    _drawHeldWeapons(ctx, bobY, alpha) {
        const cx = this.x, cy = this.y + bobY;
        let primary = null;
        const halo = [];
        for (const v of this.loadout) {
            if (!v || !v.prop || v.kind === 'orbit') continue;
            if (v.isPrimary && !primary) primary = v;
            else halo.push(v);
        }
        // If the equipped weapon is an orbit type (no in-hand prop), promote the
        // first halo weapon to the hand so the hero still visibly wields one.
        if (!primary && halo.length) primary = halo.shift();
        if (!primary && !halo.length) return;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Floating halo: spread the secondary weapons across the upper arc so
        // they never cover the face or feet; each points radially outward and
        // bobs gently. Behind the in-hand weapon (drawn first).
        const n = halo.length;
        if (n) {
            const R = this.spriteHalf * 0.66;
            const arc = Math.PI * 1.5;            // 270° fan across the top
            const start = -Math.PI / 2 - arc / 2; // centered on straight-up
            for (let i = 0; i < n; i++) {
                const a = n === 1 ? -Math.PI / 2 : start + (i / (n - 1)) * arc;
                const bob = Math.sin(this.aliveTimer * 2.2 + i * 1.3) * 2;
                const hx = cx + Math.cos(a) * R;
                const hy = cy + Math.sin(a) * R + bob;
                this._drawProp(ctx, halo[i], hx, hy, a, 0.62);
            }
        }

        // Primary in-hand: anchor near the body's hands, aimed at the target.
        // The hand sits a touch toward the aim direction (and downward to the
        // body) so the grip reads as held rather than floating at the center.
        const handR = this.spriteHalf * 0.18;
        const hx = cx + Math.cos(this.aimAngle) * handR;
        const hy = cy + Math.sin(this.aimAngle) * handR + this.spriteHalf * 0.12;
        this._drawProp(ctx, primary, hx, hy, this.aimAngle, 1.0);

        ctx.restore();
    }

    // Draw one held prop sprite: anchor its grip at (px,py), rotate to `angle`,
    // and — while it's firing (fireFlash 0..1) — thrust it forward along its
    // own axis and burst a cached glow at the tip. `scale` shrinks halo props.
    _drawProp(ctx, v, px, py, angle, scale) {
        const sprite = getWeaponProp(v.prop, v.accent, v.glow);
        if (!sprite) return;
        const flash = v.fireFlash || 0;
        const thrust = Easing.outQuad(flash) * 12 * scale;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.translate(thrust, 0);
        ctx.drawImage(sprite.canvas, -sprite.gripX * scale, -sprite.gripY * scale,
            sprite.w * scale, sprite.h * scale);
        if (flash > 0) {
            const tx = (sprite.tipX - sprite.gripX) * scale;
            const ty = (sprite.tipY - sprite.gripY) * scale;
            const fr = (16 + 12 * flash) * scale;
            const glow = getGlowSprite(v.glow);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = flash;
            ctx.drawImage(glow, tx - fr, ty - fr, fr * 2, fr * 2);
        }
        ctx.restore();
    }

    // Cloak + hat: direction-aware pixel cosmetics (drawPixelCloak/Hat, shared
    // with the menu preview so the two never diverge). `dir` is down/up/side and
    // `flip` mirrors the side view for left-facing.
    _drawCloak(ctx, color, dir = 'down', flip = false) {
        // LPC heroes keep the imported, recolored cape sprite (it aligns to the
        // LPC body); the single front-facing cape is reused for every direction.
        if (this.isLpcBody) {
            const cape = getCloakSprite(color);
            if (cape) {
                // Draw the cape a touch larger than the body and nudged down so
                // it flares out behind the hero instead of hiding behind them.
                const dw = SPRITE_SIZE * 1.32, off = SPRITE_SIZE * 0.075;
                ctx.drawImage(cape, -dw / 2, -dw / 2 + off, dw, dw);
                return;
            }
        }
        drawPixelCloak(ctx, 0, 0, this.spriteHalf, dir, color, flip);
    }
    _drawHat(ctx, shape, color, dir = 'down', flip = false) {
        drawPixelHat(ctx, 0, 0, this.spriteHalf, dir, shape, color, flip);
    }

    // Spawn a melee swing toward `angle` (world radians). Game calls this on a
    // cadence while a melee/blade weapon is owned + an enemy is near. Purely
    // cosmetic. A fresh swing restarts the arc so it stays in rhythm.
    triggerSwing(angle) {
        this.swing = { age: 0, dir: angle };
        this.castTimer = CAST_DUR;   // a melee swing also holds the attack pose
    }

    // The slash arc + blade trail + leading flash, drawn in world space at the
    // player (additive). Called at the end of draw().
    _drawSwing(ctx) {
        const sw = this.swing;
        if (!sw) return;
        const t = Math.min(1, sw.age / SWING_DUR);
        const e = Easing.outQuad(t);
        const spread = 1.15;
        const a0 = sw.dir - spread, a1 = sw.dir + spread;
        const R = this.radius + 30;
        const color = (this.weaponSkin && this.weaponSkin.glow) || '#cfe0ff';
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalCompositeOperation = 'lighter';
        // Trailing arc fan (blade trail) behind the leading edge.
        const trail = 5;
        for (let i = 0; i < trail; i++) {
            const tt = e - i * 0.12;
            if (tt < 0) break;
            const ang = a0 + (a1 - a0) * tt;
            ctx.globalAlpha = (1 - i / trail) * (1 - t) * 0.5;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, 7 - i);
            ctx.beginPath();
            ctx.arc(0, 0, R, ang - 0.28, ang + 0.05);
            ctx.stroke();
        }
        // Bright leading slash crescent.
        const lead = a0 + (a1 - a0) * e;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, R, lead - 0.4, lead + 0.1);
        ctx.stroke();
        // Leading-edge flash spark.
        const lx = Math.cos(lead) * R, ly = Math.sin(lead) * R;
        const fr = 16 * (1 - t) + 4;
        const fl = ctx.createRadialGradient(lx, ly, 0, lx, ly, fr);
        fl.addColorStop(0, '#ffffff');
        fl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = fl;
        ctx.beginPath(); ctx.arc(lx, ly, fr, 0, TWO_PI); ctx.fill();
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
