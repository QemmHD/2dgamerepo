import {
    PLAYER,
    SPRITE_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    UI,
    CAPS,
    AURA,
    COMPOSURE,
    xpRequired,
} from '../config/GameConfig.js';
import { TWO_PI, clamp } from '../core/MathUtils.js';
import { Easing } from '../core/Easing.js';
import {
    getHeroFrames, heroSetFrames, getGlowSprite, getSoftShadowSprite,
} from '../assets/ProceduralSprites.js';
import { drawPixelCloak, drawPixelHat, HERO_BOB, HERO_GRID } from '../assets/PixelArt.js';
import { getWeaponProp } from '../assets/WeaponProps.js';
import { drawAuraFx, drawTrailPoint, drawSetBonus, drawRarityFx } from '../assets/CosmeticFx.js';

// The held wand sits in the sprite's OWN paw: these are the wand-hand PAW
// positions per direction / pose / frame, exported BONE-EXACTLY from the
// Blender grip-bone (the rig's GRIP empty at the right paw, projected through
// the render camera — tools/blender pipeline, anchors.json), in draw px
// relative to the sprite centre (unflipped; 'side' faces right — the x
// mirrors for 'left'; in 'up' the right paw sits on screen-LEFT, hence the
// negative x). The frames bake the walk bob + arm swing, so riding these
// anchors makes the body's real arm carry the weapon through every
// animation — no synthetic arm is drawn.
const HAND = {
    down: {
        idle: [[31.5, 48.2], [31.5, 48.2]],
        walk: [[32.4, 47.5], [31.5, 40.5], [30.3, 43.6]],
        cast: [[50.0, 11.0]],
        hurt: [[43.1, 44.7]],
    },
    side: {
        idle: [[9.1, 37.6], [9.1, 37.6]],
        walk: [[-1.9, 39.0], [12.2, 29.3], [19.0, 31.2]],
        cast: [[27.4, -7.2]],
        hurt: [[7.7, 32.0]],
    },
    up: {
        idle: [[-31.5, 47.3], [-31.5, 47.3]],
        walk: [[-32.4, 51.2], [-31.5, 38.3], [-30.3, 38.6]],
        cast: [[-50.0, 2.5]],
        hurt: [[-43.1, 44.3]],
    },
};
// Resting carry angle per direction (radians; wand grip in the hanging paw,
// tip up and slightly forward like a carried stick). Mirrored when flipped.
const CARRY = { down: -1.25, side: -0.62, up: -1.35 };
import { getCharacter, resolveCharacterHold } from '../content/characters.js';
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
        // Per-character weapon-hold style (grip/lift/scale/tilt) — purely
        // visual flavor so each hero wields its signature weapon distinctly.
        this.hold = resolveCharacterHold(characterId);
        // Paw colour for the little hand drawn gripping the held weapon (matches
        // the hero's face/hand tone so the weapon reads as actually held).
        this._pawColor = (ch.palette && ch.palette.face) || '#f0d2a5';

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
        // Transient blink/dash smear (afterimage stretch along the travel
        // path; ticked in update, null when idle). KINDLED's aimed blink
        // (Game._tryBlink) revives this exact renderer — { fromX, fromY, toX,
        // toY, age, dur } — at zero art cost; Shadow Dash no longer sets it.
        this.dashFx = null;
        // Shadow Dash (reworked): a timed movement-speed surge instead of an
        // instant blink. While speedBoostTimer > 0, move speed is multiplied by
        // speedBoostMul. Both reset on a fresh Player (restart).
        this.speedBoostTimer = 0;
        this.speedBoostMul = 1;
        // P1.2 biome-terrain movement modifiers — RE-STAMPED from scratch
        // every frame by HazardSystem.update (so they reverse the instant the
        // hero steps off a patch, with zero undo bookkeeping):
        //   terrainSlowMul  ×speed while wading brambles/quicksand (1 = free)
        //   iceSlipT        > 0 while on an ice slick → steering skids
        this.terrainSlowMul = 1;
        this.iceSlipT = 0;

        // Composure — skill-adaptive damage relief (see COMPOSURE in GameConfig).
        // 0..1 meter that fills while you avoid hits and drops when tagged; the
        // fuller it is, the more of the ENDLESS contact-damage surcharge is shrugged
        // off. `endlessSurcharge` (0..1) is fed in by Game each frame from the live
        // wave state — it gates relief to the deep-endless time inflation only, so
        // this is fully inert (surcharge 0) through the normal campaign + bosses.
        // Rebuilt with a fresh Player on restart, so it resets every run.
        this.composure = COMPOSURE.start;
        this._composureHitCd = 0;
        this.endlessSurcharge = 0;
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
        let incoming = amount * (this.damageTakenMul ?? 1) * aegis;
        // Composure: skill-adaptive relief on the ENDLESS damage surcharge only.
        // endlessSurcharge (0..1, fed by Game) gates this to the deep-endless time
        // tax, so normal play + bosses are untouched; a composed (high-meter)
        // player cancels up to maxRelief of that surcharge.
        if (COMPOSURE.enabled && this.endlessSurcharge > 0) {
            incoming *= 1 - COMPOSURE.maxRelief * this.composure * this.endlessSurcharge;
        }
        const dealt = Math.min(incoming, this.hp);
        this.hp -= dealt;
        if (this.hp < 0) this.hp = 0;
        this.invincibleTimer = PLAYER.invincibilityDuration;
        this.hitFlashTimer = PLAYER.hitFlashDuration;
        // Getting tagged breaks composure and pauses its recovery briefly.
        if (dealt > 0 && COMPOSURE.enabled) {
            this.composure = Math.max(0, this.composure - COMPOSURE.hitPenalty);
            this._composureHitCd = COMPOSURE.recoverDelay;
        }
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
        // Composure recovers while unhit (after a short post-hit pause), so
        // sustained clean play refills the skill-relief meter.
        if (COMPOSURE.enabled) {
            if (this._composureHitCd > 0) this._composureHitCd = Math.max(0, this._composureHitCd - dt);
            else if (this.composure < 1) this.composure = Math.min(1, this.composure + COMPOSURE.recoverPerSecond * dt);
        }
        // Biome terrain (P1.2) folds in the same transient way as the dash
        // surge: never mutates base speed, reverses the moment the stamp stops.
        // KINDLED Focus-Time: while aiming an ult the hero moves at ×0.60 (aimMoveMul,
        // set by Game each frame) — folded into speed like the other transient
        // move-multipliers so ONLY travel distance shrinks; every timer in this
        // method (cast/composure/bob/swing) still runs on the real dt passed in.
        const spd = this.speed * (this.speedBoostTimer > 0 ? this.speedBoostMul : 1)
            * this.terrainSlowMul * (this.aimMoveMul ?? 1);
        if (this.iceSlipT > 0) {
            // Ice slick: heading changes only BLEND in, so the hero skids —
            // momentum carries across the patch and steering goes mushy.
            // Exponential blend = frame-rate independent; off-ice control is
            // exactly the old direct set (zero behavior change at iceSlipT 0).
            const k = 1 - Math.exp(-dt * 3.0);
            this.vx += (move.x * spd - this.vx) * k;
            this.vy += (move.y * spd - this.vy) * k;
        } else {
            this.vx = move.x * spd;
            this.vy = move.y * spd;
        }
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
            const fx = ap.trailFx;
            const tp = this.trailPositions;
            for (let i = 0; i < tp.length; i++) {
                const t = tp[i];
                const k = Math.max(0, 1 - t.age / 0.6);
                if (k <= 0) continue;
                ctx.globalAlpha = k * (fx === 'hearts' ? 0.7 : 0.45);
                const b = Math.round(5 + 12 * k);          // core block size
                // Anchor at the DROPPED position (no bobY): applying the live
                // bob phase to historical points made the whole wake oscillate
                // in lockstep instead of staying planted where it fell.
                const px = Math.round(t.x), py = Math.round(t.y);
                drawTrailPoint(ctx, px, py, b, k, ap.trailColor, fx, this.auraPhase, i);
            }
            ctx.restore();
        }

        // Grounding shadow under the player — anchored at this.y (NOT cy) so it
        // stays planted on the floor while the body bobs. One cached soft-shadow
        // blit (no per-frame gradient), drawn beneath the aura + sprite.
        {
            const r = this.spriteHalf;
            const sw = r * 0.95 * 2, sh = sw * 0.30;
            ctx.save();
            ctx.globalAlpha = 0.34;
            ctx.drawImage(getSoftShadowSprite(), this.x - sw / 2, this.y + r * 0.40 - sh / 2, sw, sh);
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
            // Animated cosmetic aura (the prestige VFX layer). auraPhase advances
            // every frame so pulse/spin/flame/rainbow/starfield animate even idle.
            drawAuraFx(ctx, this.x, cy, this.spriteHalf * 1.1, ap.auraColor, ap.auraFx, this.auraPhase, 0.34);
        }
        // Rarity prestige VFX — from RARE up, the flashiest equipped cosmetic
        // glows/pulses/sparkles in its own colour (rarer = flashier). Gated by
        // the reduced-effects flag (skinOverlayEnabled mirrors !reducedEffects).
        if (ap.fxTier >= 3 && this.skinOverlayEnabled !== false) {
            drawRarityFx(ctx, this.x, cy, this.spriteHalf * 1.05, ap.fxTier, ap.fxColor, this.auraPhase);
        }
        // Set-bonus flourish — equipping a whole themed set lights up an extra
        // counter-rotating ring of motes in the set's colour (cosmetic only).
        if (ap.set) drawSetBonus(ctx, this.x, cy, this.spriteHalf * 1.1, ap.set.color, this.auraPhase);

        // Directional facing → which dir set + horizontal flip.
        let dir = 'down', flip = false;
        if (this.facing === 'up') dir = 'up';
        else if (this.facing === 'left') { dir = 'side'; flip = true; }
        else if (this.facing === 'right') dir = 'side';
        // Animation state precedence: a run-end pose override (death on game
        // over / victory on the win screen) wins over everything, then
        // hurt > cast > walk > idle.
        let state = 'idle', idx = 0;
        if (this.poseOverride) state = this.poseOverride;
        else if (this.hitFlashTimer > 0) state = 'hurt';
        else if (this.castTimer > 0) state = 'cast';
        else if (this.moving) { state = 'walk'; idx = Math.floor(this.bobTimer * 6) % 3; }
        else {
            // Goofy idle beat: a short blink + tail-wag + ear-twitch (~0.28s)
            // inside a ~2.6s open-eyed hold. Timed off auraPhase (always ticks).
            const ph = this.auraPhase % 2.6;
            idx = ph > 2.32 ? 1 : 0;
        }
        const dset = this.heroFrames.dirs[dir] || this.heroFrames.dirs.down;
        const poseArr = dset[state] || dset.idle;
        const orig = poseArr[idx % poseArr.length] || poseArr[0];
        const tintMap = ap.furColor ? this._tintMap(ap.furColor) : null;
        const sprite = (tintMap && tintMap.get(orig)) || orig;
        // Snapshot the resolved pose for the held-weapon passes (both the
        // behind-body and over-body draws), so the wand rides the exact frame
        // the body is showing this tick.
        this._pose = { dir, state, idx, flip };

        // The frames BAKE a per-frame body bob (HERO_BOB, logical px) — the
        // head/shoulders shift inside the canvas. Cosmetics are separate cached
        // canvases, so they must ride that same offset or hats sink onto the
        // brow every mid-walk step. World px per logical px = SIZE / GRID.
        let bakedBob = 0;
        if (!this.isLpcBody) {
            const hb = HERO_BOB[state] || [0];
            bakedBob = (hb[idx % hb.length] || 0) * (SPRITE_SIZE / HERO_GRID);
        }
        // Cloth lags the body: the cloak follows at half the bob and drags a
        // step behind the run direction; the hat is pinned to the head (full bob).
        const hatOy = bakedBob;
        const cloakOy = Math.round(bakedBob * 0.5);
        const cloakOx = this.moving ? -Math.sign(this.vx || 0) * 3 : 0;

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

        // Held weapon BEHIND the body for the back view (the hero holds it in
        // front of them, away from the camera, so the torso occludes it).
        if (this.loadout && this.loadout.length) this._drawHeldWeapons(ctx, bobY, alpha, 'behind');

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
        // Cast recoil: nudge the body slightly opposite the aim while the weapon
        // jabs forward, so the attack reads with weight (not a static pose).
        if (this.castTimer > 0) {
            const k = this.castTimer / CAST_DUR;
            ctx.translate(-Math.cos(this.aimAngle) * 3 * k, -Math.sin(this.aimAngle) * 3 * k);
        }

        // Cloak: drawn BEHIND the body for the front/side views (only the collar
        // + hem wings peek out). For the back view ('up') the per-direction PIXEL
        // cloak drapes OVER the body (drawn after the sprite, below) so we see the
        // full cape. LPC heroes use a single front-facing imported cape that has
        // no back variant, so it always draws behind the body (every direction).
        if (ap.cloakColor && (this.isLpcBody || dir !== 'up')) this._drawCloak(ctx, ap.cloakColor, dir, flip, cloakOx, cloakOy);

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
            // Brief white glow pop at the very start of the flash (t near 1) for
            // a satisfying "took a hit" impact. Cached white glow, additive.
            if (t > 0.6) {
                ctx.globalAlpha = alpha * (t - 0.6) / 0.4 * 0.55;
                ctx.drawImage(getGlowSprite('#ffffff'), -this.spriteHalf, -this.spriteHalf, SPRITE_SIZE, SPRITE_SIZE);
            }
        }
        ctx.restore();

        // Back-view pixel cloak drapes over the body (full cape facing away).
        // (LPC heroes already drew their cape behind the body above.)
        if (ap.cloakColor && !this.isLpcBody && dir === 'up') this._drawCloak(ctx, ap.cloakColor, dir, flip, cloakOx, cloakOy);

        // (The old themed sash + chest gem overlay was removed — the held weapon
        // now carries the weapon identity, so the torso stays clean.)

        // Accessory on the head (direction-aware pixel hat, on top) — riding the
        // baked head bob so it stays seated while walking.
        if (ap.hatShape && ap.hatShape !== 'none') {
            this._drawHat(ctx, ap.hatShape, ap.hatColor, dir, flip, hatOy);
            // Hit flash: the body pops white via an additive redraw — do the
            // same for the hat so it doesn't sit unlit on a flashing hero.
            if (this.hitFlashTimer > 0) {
                const tq = this.hitFlashTimer / PLAYER.hitFlashDuration;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = alpha * Math.min(1, tq) * 0.8;
                this._drawHat(ctx, ap.hatShape, ap.hatColor, dir, flip, hatOy);
                ctx.restore();
            }
        }
        ctx.restore();

        // Held weapon OVER the body (front pass): the signature weapon in its
        // articulated arm (unless facing away — then it was drawn behind, above).
        if (this.loadout && this.loadout.length) this._drawHeldWeapons(ctx, bobY, alpha, 'front');

        // Melee swing arc (world-space, additive) on top of everything.
        if (this.swing) this._drawSwing(ctx);
    }

    // Draw the SIGNATURE weapon IN the sprite's own paw: the run's starting
    // weapon (chosen in the menu loadout — owned[0], so an evolution/fusion of
    // it keeps the slot). The grip anchor follows the body's REAL arm through
    // every pose frame (the HAND table, measured from the sheets), so the
    // baked animation does the acting: at rest the wand rides the hanging paw
    // at a carry angle; on fire the cast pose raises the arm and the wand
    // pivots in that fist to the aim with a thrust + tip muzzle flash. The
    // other owned weapons draw NOTHING here — their projectiles/rings ARE
    // their visual — so the hero always wields exactly one wand: yours.
    _drawHeldWeapons(ctx, bobY, alpha, layer = 'front') {
        // On the run-end poses the hero drops/raises empty paws — a wand pinned
        // to the hand would fight the collapse/cheer, so skip the held prop.
        if (this._pose && (this._pose.state === 'death' || this._pose.state === 'victory')) return;
        // Orbit-kind primaries (e.g. the starter fused into Cinderhalo) are
        // held too — the hand keeps the run's chosen weapon even after fusion;
        // the spinning ring around the body stays their gameplay visual.
        let primary = null;
        for (const v of this.loadout) { if (v && v.prop && v.isPrimary) { primary = v; break; } }
        // Starting weapon carries no prop (a pure-aura/movement ability):
        // hold the first owned weapon that does, so the hand is never empty.
        if (!primary) { for (const v of this.loadout) { if (v && v.prop) { primary = v; break; } } }
        if (!primary) return;
        const P = this._pose;
        if (!P) return;
        // Back view: the hero holds the wand in front of the body (away from
        // the camera), so it draws in the behind pass and the torso occludes.
        if (layer !== (this.facing === 'up' ? 'behind' : 'front')) return;

        // Paw anchor for the exact frame the body is showing (flip mirrors x).
        const H = this.hold;                 // per-character scale/tilt flavor
        const k = this.spriteHalf / 91;      // world px per authored anchor px
        const hand = HAND[P.dir] || HAND.down;
        const arr = hand[P.state] || hand.idle;
        const a = arr[P.idx % arr.length] || arr[0];
        const hx = this.x + (P.flip ? -a[0] : a[0]) * k;
        const hy = this.y + bobY + a[1] * k;

        const firing = P.state === 'cast';
        const kick = Easing.outQuad(primary.fireFlash || 0);
        let ang;
        if (firing) {
            // Wand pivots in the raised fist toward the aim; the muzzle kicks
            // up ~7° on each shot and settles (recoil).
            ang = this.aimAngle + H.tilt - 0.12 * kick;
        } else {
            // Carried at rest, riding the arm swing (mirror the tilt when
            // flipped so the wand leans forward on both side facings).
            const c = CARRY[P.dir] + H.tilt;
            ang = P.flip ? Math.PI - c : c;
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        this._drawProp(ctx, primary, hx, hy, ang, H.scale, true, firing);
        ctx.restore();
    }

    // Draw one held prop sprite: anchor its grip at (px,py), rotate to `angle`,
    // and — while it's firing (fireFlash 0..1) — thrust it forward along its
    // own axis and burst a cached glow at the tip.
    _drawProp(ctx, v, px, py, angle, scale, gripPaw = false, doThrust = true) {
        const sprite = getWeaponProp(v.prop, v.accent, v.glow);
        if (!sprite) return;
        // Flash + thrust only apply on the aimed (cast-pose) hold: if a hit
        // interrupts the cast pose mid-flash (hurt wins the pose), the wand is
        // back at the carry angle and a muzzle burst there would point nowhere.
        const flash = doThrust ? (v.fireFlash || 0) : 0;
        const thrust = Easing.outQuad(flash) * 12 * scale;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        // The weapon itself (thrusts forward along its axis while firing); the
        // muzzle flash bursts at the tip.
        ctx.save();
        ctx.translate(thrust, 0);
        ctx.drawImage(sprite.canvas, -sprite.gripX * scale, -sprite.gripY * scale,
            sprite.w * scale, sprite.h * scale);
        if (flash > 0) {
            const tx = (sprite.tipX - sprite.gripX) * scale;
            const ty = (sprite.tipY - sprite.gripY) * scale;
            const fr = (16 + 12 * flash) * scale;
            ctx.globalCompositeOperation = 'lighter';
            // Muzzle spark: a bright forward streak + two diverging ticks along
            // the weapon axis, snapping out as it fires. Procedural, gated on flash.
            ctx.globalAlpha = flash;
            ctx.strokeStyle = '#fff7e0';
            ctx.lineWidth = Math.max(2, 3 * scale);
            ctx.lineCap = 'round';
            const sl = (10 + 14 * flash) * scale;
            ctx.beginPath();
            ctx.moveTo(tx, ty); ctx.lineTo(tx + sl, ty);
            ctx.moveTo(tx, ty); ctx.lineTo(tx + sl * 0.7, ty - sl * 0.34);
            ctx.moveTo(tx, ty); ctx.lineTo(tx + sl * 0.7, ty + sl * 0.34);
            ctx.stroke();
            // Muzzle glow burst at the tip.
            const glow = getGlowSprite(v.glow);
            ctx.globalAlpha = flash;
            ctx.drawImage(glow, tx - fr, ty - fr, fr * 2, fr * 2);
        }
        ctx.restore();
        // A paw wrapping the grip, drawn LAST so the hand visibly grips OVER the
        // handle (and stays at the hand while the weapon thrusts). Sells "held".
        if (gripPaw) {
            const pr = 10.5 * scale;
            ctx.fillStyle = this._pawColor;
            ctx.strokeStyle = 'rgba(40,24,12,0.85)';
            ctx.lineWidth = Math.max(1, 2 * scale);
            ctx.beginPath(); ctx.arc(0, 0, pr, 0, TWO_PI); ctx.fill(); ctx.stroke();
            // A thumb wrapping OVER the handle (a smaller disc riding the top
            // edge) — the detail that makes it read as a grip, not a ball.
            ctx.beginPath(); ctx.arc(pr * 0.35, -pr * 0.45, pr * 0.42, 0, TWO_PI); ctx.fill(); ctx.stroke();
            // Two faint knuckle lines so it reads as a gripping paw, not a dot.
            ctx.strokeStyle = 'rgba(40,24,12,0.5)';
            ctx.lineWidth = Math.max(1, scale);
            ctx.beginPath();
            ctx.moveTo(-pr * 0.4, -pr * 0.35); ctx.lineTo(pr * 0.55, -pr * 0.35);
            ctx.moveTo(-pr * 0.4, pr * 0.1); ctx.lineTo(pr * 0.55, pr * 0.1);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Cloak + hat: direction-aware pixel cosmetics (drawPixelCloak/Hat, shared
    // with the menu preview so the two never diverge). `dir` is down/up/side and
    // `flip` mirrors the side view for left-facing.
    _drawCloak(ctx, color, dir = 'down', flip = false, ox = 0, oy = 0) {
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
        // ox/oy: cloth lag — half the baked body bob + a step behind the run.
        drawPixelCloak(ctx, ox, oy, this.spriteHalf, dir, color, flip);
    }
    _drawHat(ctx, shape, color, dir = 'down', flip = false, oy = 0) {
        // oy: the baked head bob, so the hat stays seated on the head.
        drawPixelHat(ctx, 0, oy, this.spriteHalf, dir, shape, color, flip);
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
